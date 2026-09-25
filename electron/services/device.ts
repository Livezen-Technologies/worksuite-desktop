import { app, powerMonitor } from 'electron';
import { randomUUID } from 'node:crypto';
import { statfsSync } from 'node:fs';
import os from 'node:os';
import type { Arch, DeviceClassification, DeviceInfo, DeviceTrust, Platform, ServerApi } from '@shared/types';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
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
  extras: () => HeartbeatExtras = () => ({ pendingUp: 0, pendingDown: 0, lastError: null });

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

  getTrust(): DeviceTrust {
    return this.trust;
  }

  load(userId: string): DeviceRecord | null {
    this.userId = userId;
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

  /** Registers this installation for the user, or confirms the existing registration. */
  async ensureRegistered(userId: string, api: ServerApi): Promise<DeviceRecord> {
    this.api = api;
    this.load(userId);
    if (this.record) {
      try {
        await this.heartbeat();
        return this.record;
      } catch (e) {
        if (!(isDesktopError(e) && (e.code === 'NOT_FOUND' || e.code === 'DEVICE_NOT_REGISTERED'))) {
          // Offline or a transient error: keep the registration we have.
          if (isDesktopError(e) && e.code === 'NETWORK_UNREACHABLE') return this.record;
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
      this.secrets.set(this.key(userId), JSON.stringify(this.record));
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
    const data = await this.http.post<{ directives?: unknown; trust?: string }>(path, { ...body, device_id: this.record.id });
    this.lastHeartbeatAt = new Date().toISOString();
    if (typeof data.trust === 'string') this.setTrust(data.trust as DeviceTrust);
    const directive = parseDirectives(data.directives);
    this.onDirective?.(directive);
    void this.refreshTrust();
    return directive;
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
