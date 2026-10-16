import { app, powerMonitor } from 'electron';
import { randomUUID } from 'node:crypto';
import { statfsSync } from 'node:fs';
import os from 'node:os';
import type { Arch, DeviceClassification, DeviceInfo, DeviceTrust, Platform, ServerApi } from '@shared/types';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import { isPassingFailure, type HttpClient } from './http';
import type { OsDevice } from './os-mode';
import type { SecureStore } from './secure-store';

const log = logger('device');

/**
 * Device registration and heartbeat (FR-AUTH-03, FR-SEC-01/02, WF-23).
 *
 * On the existing WorkSuite API a desktop installation is a sync device
 * (`/api/sync/devices`): registering returns a device token that the Drive
 * sync engine uses later, and every health report returns the directives an
 * administrator has set — block, wipe, required version — so a decision made
 * in the fleet view reaches a running client within one heartbeat.
 *
 * Identity is a random id per installation and the host name the user sees;
 * never a hardware serial or MAC address (NFR-PRV-03).
 */

export interface DeviceRecord {
  id: string;
  token: string | null;
  registeredAt: string;
}

export type Directive =
  | { kind: 'none'; allowOffline: boolean }
  | { kind: 'block'; reason: string }
  | { kind: 'wipe'; reason: string }
  | { kind: 'require-update'; version: string | null; reason: string };

/** A queued administrator command (desktop_device_commands, §7.1). */
export interface DeviceCommand {
  id: string;
  command: 'REVOKE' | 'SIGN_OUT' | 'DISABLE_SYNC' | 'REQUIRE_UPDATE' | 'REFRESH_POLICY' | 'WIPE' | string;
  payload: Record<string, unknown>;
}

/**
 * How the session answers a command: a result to acknowledge, and — for the
 * commands that end the session — work to do only after the acknowledgement
 * has reached the server, because afterwards there are no credentials left.
 */
export interface CommandOutcome {
  ok: boolean;
  result: Record<string, unknown>;
  after?: () => Promise<void>;
}

export interface HeartbeatExtras {
  pendingUp: number;
  pendingDown: number;
  lastError: string | null;
}

export function platformName(): Platform {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
}

export function archName(): Arch {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/** Parses `/api/sync/devices/{id}/health` directives into one decision. */
export function parseDirectives(d: unknown): Directive {
  const x = (d ?? {}) as Record<string, unknown>;
  const reason = typeof x.reason === 'string' ? x.reason : '';
  if (x.stop === true) {
    if (x.wipe === true) return { kind: 'wipe', reason: reason || 'Your administrator removed WorkSuite from this computer.' };
    if (x.block === true) return { kind: 'block', reason: reason || 'Your administrator blocked WorkSuite on this computer.' };
    if (x.update === true) {
      return {
        kind: 'require-update',
        version: typeof x.require_version === 'string' ? x.require_version : null,
        reason: reason || 'This version of WorkSuite is no longer supported.',
      };
    }
  }
  return { kind: 'none', allowOffline: x.allow_offline !== false };
}

let lastCpu: { idle: number; total: number } | null = null;
function cpuPercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  const prev = lastCpu;
  lastCpu = { idle, total };
  if (!prev || total === prev.total) return 0;
  return Math.round((1 - (idle - prev.idle) / (total - prev.total)) * 100);
}

export class DeviceService {
  private record: DeviceRecord | null = null;
  private userId: string | null = null;
  private trust: DeviceTrust = 'STANDARD';
  private classification: DeviceClassification = 'UNKNOWN';
  private lastHeartbeatAt: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private api: ServerApi = 'core';
  onDirective: ((d: Directive) => void) | null = null;
  onTrustChanged: ((t: DeviceTrust) => void) | null = null;
  onCommand: ((c: DeviceCommand) => Promise<CommandOutcome>) | null = null;
  private handled = new Set<string>();
  extras: () => HeartbeatExtras = () => ({ pendingUp: 0, pendingDown: 0, lastError: null });
  /**
   * WorkSuite OS mode (os-mode.ts): the OS device agent's enrolment. When it gives one, this computer is that device —
   * its id, and its credential as `X-WS-Device` — and the app neither registers itself nor sends heartbeats (the agent
   * checks in for the computer). A WorkSuite OS computer that is not enrolled (a personal one) registers as before.
   */
  osEnrolment: (() => OsDevice | null) | null = null;
  private fromOs = false;

  constructor(
    private readonly db: Database,
    private readonly secrets: SecureStore,
    private readonly http: HttpClient,
  ) {
    if (!db.getConfig<string>('install-id')) db.setConfig('install-id', randomUUID());
  }

  installId(): string {
    return this.db.getConfig<string>('install-id') ?? 'unknown';
  }

  private key(userId: string): string {
    return `device:${userId}`;
  }

  deviceName(): string {
    const host = os.hostname().replace(/\.local$/i, '');
    return host || `${platformName()} computer`;
  }

  current(): DeviceRecord | null {
    return this.record;
  }

  deviceToken(): string | null {
    return this.record?.token ?? null;
  }

  /** `X-WS-Device`: the registration's id, or on WorkSuite OS the device credential the OS services send too. */
  headerValue(): string | null {
    if (!this.record) return null;
    return this.fromOs ? this.record.token : this.record.id;
  }

  /** Whether this computer's device is WorkSuite OS's enrolment (not one this app registered). */
  isOsEnrolled(): boolean {
    return this.fromOs;
  }

  getTrust(): DeviceTrust {
    return this.trust;
  }

  getClassification(): DeviceClassification {
    return this.classification;
  }

  /**
   * A fresh registration, and with it a fresh device credential: for a
   * computer that was signed out of Drive sync from another device, whose
   * stored credential the server no longer accepts.
   */
  async reenrol(userId: string, api: ServerApi): Promise<DeviceRecord> {
    if (this.osEnrolment?.()) {
      throw new DesktopError('DEVICE_NOT_REGISTERED', "Your organization's server does not recognise this computer's WorkSuite OS enrolment. Ask your administrator to check it.");
    }
    this.secrets.delete(this.key(userId));
    this.record = null;
    return this.register(userId, api);
  }

  load(userId: string): DeviceRecord | null {
    this.userId = userId;
    const os = this.osEnrolment?.() ?? null;
    this.fromOs = !!os;
    if (os) {
      this.record = { id: os.id, token: os.credential, registeredAt: this.record?.id === os.id ? this.record.registeredAt : new Date().toISOString() };
      // Enrolled by the organization through WorkSuite OS: a managed computer.
      this.trust = 'TRUSTED';
      this.classification = 'MANAGED';
      return this.record;
    }
    const raw = this.secrets.get(this.key(userId));
    this.record = null;
    if (raw) {
      try {
        this.record = JSON.parse(raw) as DeviceRecord;
      } catch {
        this.secrets.delete(this.key(userId));
      }
    }
    const cachedTrust = this.db.getConfig<DeviceTrust>(`trust:${userId}`);
    if (cachedTrust) this.trust = cachedTrust;
    return this.record;
  }

  /**
   * Registers this installation for the user, or confirms the existing registration.
   *
   * The confirmation is only a heartbeat: when it cannot be had for now — out of reach, too slow, the server or the
   * proxy in front of it answering 5xx, a rate limit — the registration we have stands and the five-minute heartbeat
   * confirms it later. Only the network used to count, so a passing 502 or 429 here failed a sign-in whose password
   * was right and sent the person back to the sign-in screen (LOGIN-001).
   */
  async ensureRegistered(userId: string, api: ServerApi): Promise<DeviceRecord> {
    this.api = api;
    this.load(userId);
    if (this.fromOs && this.record) return this.record;
    if (this.record) {
      try {
        await this.heartbeat();
        return this.record;
      } catch (e) {
        if (!(isDesktopError(e) && (e.code === 'NOT_FOUND' || e.code === 'DEVICE_NOT_REGISTERED'))) {
          // Offline or a transient error: keep the registration we have.
          if (this.record && isPassingFailure(e)) return this.record;
          throw e;
        }
        log.info('stored device no longer exists on the server; registering again');
        this.secrets.delete(this.key(userId));
        this.record = null;
      }
    }
    return this.register(userId, api);
  }

  private async register(userId: string, api: ServerApi): Promise<DeviceRecord> {
    const body = {
      name: this.deviceName(),
      platform: platformName(),
      os_version: `${os.type()} ${os.release()}`,
      app_version: app.getVersion(),
      hostname: os.hostname(),
      arch: archName(),
      install_id: this.installId(),
      client: 'worksuite-desktop',
    };
    try {
      const path = api === 'desktop-v1' ? '/desktop/v1/devices/register' : '/api/sync/devices';
      const data = await this.http.post<{ device?: { id?: unknown }; token?: string; trust?: string; device_id?: unknown }>(path, body);
      const id = data.device?.id ?? data.device_id;
      if (id === undefined || id === null) throw new DesktopError('SERVER_ERROR', 'The server did not return a device id.');
      this.record = { id: String(id), token: typeof data.token === 'string' ? data.token : null, registeredAt: new Date().toISOString() };
      try {
        this.secrets.set(this.key(userId), JSON.stringify(this.record));
      } catch (e) {
        // Registered all the same, and kept for this run: the OS store refusing a write must not fail the sign-in.
        log.warn('device registration not saved to secure storage; kept for this run only', { error: String((e as Error)?.message ?? e) });
      }
      if (typeof data.trust === 'string') this.setTrust(data.trust as DeviceTrust);
      log.info('device registered', { id: this.record.id });
      return this.record;
    } catch (e) {
      if (isDesktopError(e) && e.status === 422) {
        throw new DesktopError('DEVICE_LIMIT', e.message);
      }
      if (isDesktopError(e) && e.status === 403) {
        throw new DesktopError('DESKTOP_ACCESS_DISABLED', 'Desktop access is disabled by your organization.');
      }
      throw e;
    }
  }

  private setTrust(t: DeviceTrust): void {
    if (!['TRUSTED', 'STANDARD', 'RESTRICTED', 'REVOKED'].includes(t)) return;
    if (t === this.trust) return;
    this.trust = t;
    if (this.userId) this.db.setConfig(`trust:${this.userId}`, t);
    this.onTrustChanged?.(t);
  }

  /** One health report; applies whatever directive comes back. */
  async heartbeat(): Promise<Directive> {
    // WorkSuite OS: the device agent checks in for this computer and carries out its organization's commands.
    if (this.fromOs && this.record) return { kind: 'none', allowOffline: true };
    if (!this.record) throw new DesktopError('DEVICE_NOT_REGISTERED', 'This computer is not registered.');
    let diskUsed: number | null = null;
    let diskFree: number | null = null;
    try {
      const s = statfsSync(app.getPath('userData'));
      diskFree = Number(s.bavail) * Number(s.bsize);
      const total = Number(s.blocks) * Number(s.bsize);
      diskUsed = total > 0 ? Math.round((1 - diskFree / total) * 100) : null;
    } catch {
      /* statfs unsupported */
    }
    const x = this.extras();
    const body = {
      cpu: cpuPercent(),
      memory: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      disk: diskUsed,
      disk_free: diskFree,
      on_battery: powerMonitor.isOnBatteryPower(),
      network: 'online',
      sync_state: 'idle',
      pending_up: x.pendingUp,
      pending_down: x.pendingDown,
      last_error: x.lastError,
      app_version: app.getVersion(),
    };
    const path =
      this.api === 'desktop-v1'
        ? '/desktop/v1/devices/heartbeat'
        : `/api/sync/devices/${encodeURIComponent(this.record.id)}/health`;
    const data = await this.http.post<{ directives?: unknown; trust?: string; commands?: unknown }>(path, { ...body, device_id: this.record.id });
    this.lastHeartbeatAt = new Date().toISOString();
    if (typeof data.trust === 'string') this.setTrust(data.trust as DeviceTrust);
    await this.runCommands(Array.isArray(data.commands) ? data.commands : []);
    const directive = parseDirectives(data.directives);
    this.onDirective?.(directive);
    void this.refreshTrust();
    return directive;
  }

  /** WF-23 step 3: run each queued command once, and acknowledge it. */
  private async runCommands(raw: unknown[]): Promise<void> {
    for (const r of raw) {
      const c = r as Partial<DeviceCommand>;
      if (c === null || typeof c !== 'object' || (typeof c.id !== 'string' && typeof c.id !== 'number') || typeof c.command !== 'string') continue;
      const cmd: DeviceCommand = { id: String(c.id), command: c.command, payload: (c.payload && typeof c.payload === 'object' ? c.payload : {}) as Record<string, unknown> };
      if (this.handled.has(cmd.id)) continue;
      this.handled.add(cmd.id);
      let outcome: CommandOutcome;
      try {
        outcome = this.onCommand ? await this.onCommand(cmd) : { ok: false, result: { error: 'no handler' } };
      } catch (e) {
        outcome = { ok: false, result: { error: String((e as Error).message ?? e) } };
      }
      try {
        await this.http.post(`/desktop/v1/devices/commands/${encodeURIComponent(cmd.id)}/ack`, { status: outcome.ok ? 'DONE' : 'FAILED', result: outcome.result });
      } catch (e) {
        log.warn('command acknowledgement failed', { command: cmd.command, error: String(e) });
      }
      log.info('device command', { command: cmd.command, ok: outcome.ok });
      if (outcome.after) await outcome.after();
    }
  }

  /** Trust as the organization set it in the fleet view (§11.3). */
  private async refreshTrust(): Promise<void> {
    if (!this.record || this.api === 'desktop-v1') return;
    try {
      const data = await this.http.get<{ devices?: Array<{ id?: unknown; trusted?: unknown; state?: unknown }> }>('/api/sync/fleet');
      const me = data.devices?.find((d) => String(d.id) === this.record?.id);
      if (!me) return;
      if (me.state === 'blocked') this.setTrust('RESTRICTED');
      else this.setTrust(me.trusted === true || me.trusted === 1 || me.trusted === '1' ? 'TRUSTED' : 'STANDARD');
      this.classification = me.trusted ? 'MANAGED' : 'UNKNOWN';
    } catch {
      /* the fleet view may be unavailable; keep the last known trust */
    }
  }

  start(): void {
    this.stop();
    if (this.fromOs) return;
    const tick = () => {
      this.heartbeat().catch((e) => log.debug('heartbeat failed', { code: isDesktopError(e) ? e.code : String(e) }));
    };
    this.timer = setInterval(tick, 5 * 60_000);
    this.timer.unref?.();
  }

  /** On resume from sleep and on network change (WF-23 triggers). */
  poke(): void {
    if (this.record) this.heartbeat().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Another account's database and secrets were bound (Connection & Startup §1.3): what was held in memory for the
   * account before — its registration, trust, heartbeat — is dropped; the next `load` / `ensureRegistered` reads the
   * new account's own (its `install-id`, its `trust:*`), so nothing registers again.
   */
  rebind(): void {
    this.stop();
    this.record = null;
    this.userId = null;
    this.trust = 'STANDARD';
    this.classification = 'UNKNOWN';
    this.lastHeartbeatAt = null;
    this.fromOs = false;
    this.handled.clear();
  }

  /** Forgets this device for the user (sign-out with wipe, revoke). */
  forget(userId: string): void {
    this.secrets.delete(this.key(userId));
    this.db.deleteConfig(`trust:${userId}`);
    this.record = null;
  }

  info(secureStorage: DeviceInfo['secureStorage']): DeviceInfo {
    return {
      id: this.record?.id ?? null,
      name: this.deviceName(),
      platform: platformName(),
      arch: archName(),
      osVersion: `${os.type()} ${os.release()}`,
      appVersion: app.getVersion(),
      trust: this.trust,
      classification: this.classification,
      registeredAt: this.record?.registeredAt ?? null,
      lastHeartbeatAt: this.lastHeartbeatAt,
      secureStorage,
    };
  }
}
