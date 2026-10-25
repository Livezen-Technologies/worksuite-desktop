import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gatewayOrigin, LABEL_GATEWAY_API, normalisePairingCode, printerKeyOf, type GatewayStatus, type LocalPrinter, type PrinterState, type ServerConnection } from '@shared/label';
import { DesktopError } from '../../main/errors';
import { CorePrintService, serverStatus, type ClaimedJob, type CorePrintDeps, type HostTransport } from './core-print';
import { checkUpdate, type EnvelopeCheck, type GatewayUpdate, type PrinterCommand } from './envelope';
import { discoveredOf, localTarget, targetFor } from './host';

/**
 * WorkSuite Print Gateway (WS-LABEL-SRS-001 §4.20 FR-GWY-01…07, D06, D07, §16) — built, per SRS Q-03, as a
 * headless/tray mode of WorkSuite Desktop: `--print-gateway` starts the app to the tray with no window, and the
 * gateway runs whether anyone is signed in or not. It is not a person: it holds no user password and no session.
 * It speaks the server's device API (`/api/label-gateways`, server docs/label-api.md "Print Gateway device API").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PAIRING AND IDENTITY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * An administrator creates the gateway on the web (W24) and gets a one-time code (PG-XXXX-XXXX, 15 minutes). On
 * this computer the WorkSuite URL and the code are entered (D06, or `--pair-url= --pair-code=` on a headless box);
 * the gateway makes its own Ed25519 device key and sends the public half with the code (`POST pair`), and gets its
 * id, a first token and the server's signing key. The private key and the token are kept in the OS key store
 * (Keychain, DPAPI, Secret Service) through SecureStore, or — on a headless Linux build with no key store — in a
 * file only this user can read (0600). Tokens last 15 minutes; a new one is had by signing
 * "label-gateway-token\n{id}\n{timestamp}\n{nonce}" with the device key (`POST {id}/token`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OUTBOUND ONLY, SIGNED JOBS ONLY, ITS OWN PRINTERS ONLY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  - It opens no listening port. Everything is an outbound HTTPS call: the heartbeat every 30 seconds (the server
 *    shows it offline after 90 without one) and the claim polled every 5 seconds (the server's 1.0.0 has no socket).
 *  - Every chunk's envelope is checked against the server key it was paired with (envelope.ts): signature, payload
 *    hash, company, printer, expiry. The last check shows on D07.
 *  - It prints only to printers it has itself and offered to the server (`printers`), which an administrator
 *    approved there (FR-GWY-05; the server hands out jobs for approved printers only). TCP goes only to those
 *    printers' own addresses. No shell, no file, no other USB write (raw-out.ts). Heartbeat commands carrying printer
 *    bytes (`calibrate`) are not signed and are not sent.
 *  - Revoked (`GATEWAY_REVOKED`), it forgets its key and token at once and stops; the server has cancelled its
 *    queued jobs (FR-GWY-06).
 */

const KEY = 'label-gateway';
const SECRET_KEY = 'label-gateway:device-key';
const SECRET_TOKEN = 'label-gateway:token';
const POLL_MS = 5_000;
const REFRESH_EARLY_MS = 60_000;
/** How often the gateway asks for a newer signed build (Label 1.1 update channel). */
export const UPDATE_CHECK_MS = 6 * 60 * 60_000;

/** This build's platform in the server's words (`gateway-releases`), or null for one it has no builds for. */
export function releasePlatform(platform: string = process.platform, arch: string = process.arch): string | null {
  if (platform === 'win32') return arch === 'x64' ? 'windows-x64' : null;
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return arch === 'x64' ? 'linux-x64' : arch === 'arm64' ? 'linux-arm64' : null;
  return null;
}

interface GatewayState {
  server: string;
  gatewayId: number;
  name: string;
  org: number | null;
  pairedAt: string;
  keys: Record<string, string>;
  heartbeatSec: number;
  /** Its printers on the server, by this computer's key. */
  printers: Record<string, { id: number; name: string; approved: boolean }>;
  revoked?: boolean;
  /** Whose gateway this is, as pairing answered (Label 1.1). */
  company?: { id: number; name: string | null } | null;
  branchId?: number | null;
  channel?: 'stable' | 'beta';
}

export interface DeviceSecrets {
  get(name: string): string | null;
  set(name: string, value: string): void;
  delete(name: string): void;
  where(): 'os' | 'file' | 'memory';
}

/** A 0600 file for a headless build with no OS key store (§16), written atomically. */
export function fileSecrets(file: string): DeviceSecrets {
  const read = (): Record<string, string> => {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  const write = (v: Record<string, string>) => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  };
  return {
    get: (n) => read()[n] ?? null,
    set: (n, v) => write({ ...read(), [n]: v }),
    delete: (n) => {
      const all = read();
      delete all[n];
      if (Object.keys(all).length) write(all);
      else if (existsSync(file)) unlinkSync(file);
    },
    where: () => 'file',
  };
}

/** The message a token request signs (GatewayService::tokenMessage). */
export const tokenMessage = (id: number, ts: number, nonce: string) => `label-gateway-token\n${id}\n${ts}\n${nonce}`;

export interface PrintGatewayDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  secrets: DeviceSecrets;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The printers on this computer (OS queues and LAN printers): what can be offered to the server. */
  localPrinters: () => Promise<LocalPrinter[]>;
  version: string;
  headless: boolean;
  autostart?: () => boolean;
  changed: () => void;
  now?: () => number;
  core?: Partial<Pick<CorePrintDeps, 'send' | 'status'>>;
  /** Keeps a downloaded update whose SHA-256 matched; answers where it is. */
  saveUpdate?: (name: string, bytes: Buffer) => Promise<string>;
}

class GatewayRefused extends DesktopError {}

/** The server's `YYYY-MM-DD HH:MM:SS` UTC as ISO. */
function utc(s: string | undefined | null): string | null {
  if (!s) return null;
  const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  return Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
}

export class PrintGateway {
  readonly core: CorePrintService;
  private connection: GatewayStatus['connection'] = 'unpaired';
  private lastHeartbeat: string | null = null;
  private lastCheck: GatewayStatus['lastCheck'] = null;
  private problem: string | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private poll: NodeJS.Timeout | null = null;
  private running = false;
  private local: LocalPrinter[] = [];
  private states = new Map<number, PrinterState>();
  private refreshing: Promise<string> | null = null;
  private updatesAt = 0;
  private available: GatewayUpdate | null = null;
  private updateProblem: string | null = null;

  constructor(private readonly d: PrintGatewayDeps) {
    const transport: HostTransport = {
      org: () => this.state()?.org ?? null,
      keys: async () => this.state()?.keys ?? {},
      claim: async (max) => {
        const r = await this.api<{ jobs?: ClaimedJob[] }>('POST', '/claim', { max });
        return Array.isArray(r?.jobs) ? r.jobs : [];
      },
      chunk: (jobId, n) => this.api('GET', `/jobs/${jobId}/chunks/${n}`),
      progress: (jobId, report) => this.api('POST', `/jobs/${jobId}/progress`, report),
    };
    this.core = new CorePrintService({
      transport,
      person: false,
      journal: {
        read: () => this.d.config.getConfig(`${KEY}-journal`),
        write: (v) => this.d.config.setConfig(`${KEY}-journal`, v),
      },
      target: (printer) => targetFor(this.local, printer.connection, printer.language),
      changed: () => this.d.changed(),
      onCheck: (job, r: EnvelopeCheck) => {
        this.lastCheck = { job, ok: r.ok, reason: r.ok ? null : r.reason, at: this.stamp() };
      },
      onPrinterState: (id, _key, s) => this.states.set(id, s),
      ...d.core,
      now: d.now,
    });
  }

  private nowMs(): number {
    return this.d.now?.() ?? Date.now();
  }

  private stamp(): string {
    return new Date(this.nowMs()).toISOString();
  }

  private state(): GatewayState | null {
    const s = this.d.config.getConfig<GatewayState>(KEY);
    return s && typeof s === 'object' && s.gatewayId ? s : null;
  }

  private save(s: GatewayState): void {
    this.d.config.setConfig(KEY, s);
    this.d.changed();
  }

  /* ── HTTPS to the server ────────────────────────────────────────── */

  private async raw(method: string, path: string, body: unknown, token: string | null): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const s = this.state();
    if (!s?.server) throw new DesktopError('NOT_FOUND', 'This gateway is not paired.');
    const res = await this.d.fetch(`${s.server}${LABEL_GATEWAY_API}/${s.gatewayId}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-WorkSuite-Client': 'print-gateway' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'error',
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, json };
  }

  private static code(json: Record<string, unknown> | null): string {
    return String((json?.errors as { code?: string } | null | undefined)?.code ?? json?.code ?? '');
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    let r = await this.raw(method, path, body, await this.token());
    if (r.status === 401 && PrintGateway.code(r.json) === 'TOKEN_EXPIRED') r = await this.raw(method, path, body, await this.token(true));
    if (PrintGateway.code(r.json) === 'GATEWAY_REVOKED') {
      this.revoked();
      throw new GatewayRefused('DEVICE_REVOKED', 'This gateway was revoked in WorkSuite.', r.status);
    }
    if (r.status < 200 || r.status >= 300) {
      const err = new GatewayRefused('SERVER_ERROR', String(r.json?.message ?? `WorkSuite answered ${r.status}.`), r.status);
      if (PrintGateway.code(r.json) === 'LEASE_LOST') throw Object.assign(new Error(err.message), { code: 'LEASE_LOST', status: 409 });
      throw err;
    }
    return ((r.json?.data ?? r.json) as T) ?? (null as T);
  }

  /** A token with more than a minute left, else a new one signed for with the device key (FR-GWY-06). */
  private async token(force = false): Promise<string> {
    const cur = this.d.secrets.get(SECRET_TOKEN);
    if (!force && cur) {
      const { token, expires } = JSON.parse(cur) as { token: string; expires: string };
      if (Date.parse(expires) - this.nowMs() > REFRESH_EARLY_MS) return token;
    }
    this.refreshing ??= this.refresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const s = this.state();
    const pem = this.d.secrets.get(SECRET_KEY);
    if (!s || !pem) throw new DesktopError('NOT_FOUND', 'This gateway has no device key; pair it again.');
    const timestamp = Math.floor(this.nowMs() / 1000);
    const nonce = randomBytes(16).toString('hex');
    const signature = sign(null, Buffer.from(tokenMessage(s.gatewayId, timestamp, nonce), 'utf8'), createPrivateKey(pem)).toString('base64');
    const r = await this.raw('POST', '/token', { timestamp, nonce, signature }, null);
    if (PrintGateway.code(r.json) === 'GATEWAY_REVOKED') {
      this.revoked();
      throw new GatewayRefused('DEVICE_REVOKED', 'This gateway was revoked in WorkSuite.', r.status);
    }
    const data = (r.json?.data ?? r.json) as { token?: string; expires_at?: string } | null;
    if (r.status !== 200 || !data?.token) throw new GatewayRefused('SERVER_ERROR', String(r.json?.message ?? 'WorkSuite did not give the gateway a token.'), r.status);
    this.d.secrets.set(SECRET_TOKEN, JSON.stringify({ token: data.token, expires: utc(data.expires_at) ?? new Date(this.nowMs() + 15 * 60_000).toISOString() }));
    return data.token;
  }

  /* ── Pairing (D06) ──────────────────────────────────────────────── */

  async pair(input: { url: string; code: string; name: string }): Promise<GatewayStatus> {
    const server = gatewayOrigin(input.url);
    if (!server) throw new DesktopError('IPC_VALIDATION_FAILED', 'Enter the WorkSuite address, starting https://.');
    const code = normalisePairingCode(input.code);
    if (!code) throw new DesktopError('IPC_VALIDATION_FAILED', 'The pairing code looks like PG-82KD-91AX.');
    if (this.state() && !this.state()!.revoked) throw new DesktopError('CONFLICT', 'This computer is already a gateway. Unpair it first.');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64');
    const res = await this.d.fetch(`${server}${LABEL_GATEWAY_API}/pair`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-WorkSuite-Client': 'print-gateway' },
      body: JSON.stringify({ code, public_key: pub, platform: process.platform, version: this.d.version, name: input.name }),
      redirect: 'error',
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const data = (json?.data ?? json) as { gateway_id?: number; token?: string; expires_at?: string; server_key?: { key_id?: string; public_key?: string }; heartbeat_sec?: number; organization_id?: number | null; company?: { id?: number; name?: string | null } | null; branch_id?: number | null; name?: string } | null;
    if (!res.ok || !data?.gateway_id || !data.token) throw new GatewayRefused('SERVER_ERROR', String(json?.message ?? 'The code was not accepted. Codes work once, for 15 minutes.'), res.status);
    this.d.secrets.set(SECRET_KEY, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
    this.d.secrets.set(SECRET_TOKEN, JSON.stringify({ token: data.token, expires: utc(data.expires_at) ?? new Date(this.nowMs() + 15 * 60_000).toISOString() }));
    const keys = data.server_key?.key_id && data.server_key.public_key ? { [data.server_key.key_id]: data.server_key.public_key } : {};
    const company = data.company && typeof data.company.id === 'number' ? { id: data.company.id, name: typeof data.company.name === 'string' ? data.company.name : null } : null;
    this.save({
      server,
      gatewayId: Number(data.gateway_id),
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : input.name,
      org: company?.id ?? (typeof data.organization_id === 'number' ? data.organization_id : null),
      company,
      branchId: typeof data.branch_id === 'number' ? data.branch_id : null,
      pairedAt: this.stamp(),
      keys,
      heartbeatSec: data.heartbeat_sec ?? 30,
      printers: {},
    });
    this.connection = 'connecting';
    await this.reportPrinters().catch((e) => (this.problem = e instanceof Error ? e.message : String(e)));
    if (this.state() && !this.state()!.revoked) this.start();
    return this.status();
  }

  /** Unpair here: the key and token are forgotten. Revoking it in WorkSuite (W24) cancels what was queued for it. */
  async unpair(): Promise<GatewayStatus> {
    this.wipe();
    this.d.config.deleteConfig(KEY);
    this.connection = 'unpaired';
    this.d.changed();
    return this.status();
  }

  private wipe(): void {
    this.stop();
    this.d.secrets.delete(SECRET_KEY);
    this.d.secrets.delete(SECRET_TOKEN);
    this.core.forgetAll();
  }

  /** The server revoked this gateway (FR-GWY-06): forget the identity at once and stop. */
  revoked(): void {
    const s = this.state();
    this.wipe();
    if (s) this.save({ ...s, revoked: true, printers: {} });
    this.connection = 'revoked';
    this.d.changed();
  }

  /* ── Running ────────────────────────────────────────────────────── */

  start(): void {
    const s = this.state();
    if (!s || s.revoked || this.running) return;
    this.running = true;
    this.connection = 'connecting';
    this.poll = setInterval(() => void this.tick(), POLL_MS);
    this.poll.unref?.();
    this.heartbeat = setInterval(() => void this.beat(), Math.max(10, s.heartbeatSec || 30) * 1000);
    this.heartbeat.unref?.();
    void this.beat();
  }

  stop(): void {
    this.running = false;
    for (const t of [this.poll, this.heartbeat]) if (t) clearInterval(t);
    this.poll = this.heartbeat = null;
    if (this.connection !== 'revoked') this.connection = this.state() ? 'offline' : 'unpaired';
  }

  /** FR-GWY-03: version and printer statuses every 30 seconds; the server's commands come back. */
  async beat(): Promise<void> {
    if (!this.running) return;
    try {
      const r = await this.api<{ commands?: PrinterCommand[] }>('POST', '/heartbeat', {
        version: this.d.version,
        printers: [...this.states.entries()].map(([printer_id, s]) => ({ printer_id, status: serverStatus(s) })),
      });
      this.lastHeartbeat = this.stamp();
      this.connection = 'online';
      this.problem = null;
      for (const c of r?.commands ?? []) {
        if (c.type === 'discover') await this.reportPrinters().catch(() => undefined);
        if (c.type === 'cancel' && c.printer_id) {
          const j = this.core.jobs().find((x) => x.printerId === String(c.printer_id) && (x.state === 'printing' || x.state === 'waiting_printer'));
          if (j) await this.core.cancel(j.id).catch(() => undefined);
        }
        // Label 1.1: printer bytes only under a verified command envelope (envelope.ts checkCommand).
        if ((c.type === 'status' || c.type === 'calibrate' || c.type === 'cancel') && c.printer_id && (c.bytes_base64 || c.envelope)) {
          const key = Object.entries(this.state()?.printers ?? {}).find(([, p]) => p.id === c.printer_id)?.[0];
          const out = await this.core.command(c, key ? localTarget(this.local, key) : null).catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
          if (!out.ok) this.problem = out.reason;
        }
      }
      if (this.nowMs() - this.updatesAt > UPDATE_CHECK_MS) await this.checkUpdates().catch(() => undefined);
    } catch (e) {
      if (this.connection !== 'revoked') this.connection = 'offline';
      this.problem = e instanceof Error ? e.message : String(e);
    }
    this.d.changed();
  }

  async tick(): Promise<number> {
    if (!this.running) return 0;
    this.local = await this.d.localPrinters().catch(() => this.local);
    const n = await this.core.tick();
    if (this.connection !== 'revoked') this.problem = this.core.health().problem ?? this.problem;
    return n;
  }

  /**
   * Label 1.1 update channel: asks for the newest signed build above this one. It is offered only when the manifest
   * verifies with the server key this gateway was paired with and is for this gateway (envelope.ts `checkUpdate`).
   */
  async checkUpdates(): Promise<GatewayStatus> {
    const s = this.state();
    const platform = releasePlatform();
    this.updatesAt = this.nowMs();
    if (!s || s.revoked || !platform) return this.status();
    try {
      const r = await this.api<{ update?: unknown } | null>('GET', `/updates?${new URLSearchParams({ platform, channel: s.channel ?? 'stable', current: this.d.version })}`);
      if (!r?.update) {
        this.available = null;
        this.updateProblem = null;
      } else {
        const c = checkUpdate(r.update, s.keys, s.gatewayId);
        this.available = c.ok ? c.update : null;
        this.updateProblem = c.ok ? null : c.reason;
      }
    } catch (e) {
      // An older server has no update channel (404): nothing to offer, nothing wrong.
      if ((e as { status?: number }).status !== 404) this.updateProblem = e instanceof Error ? e.message : String(e);
    }
    this.d.changed();
    return this.status();
  }

  /** Downloads the offered build and keeps it only if its SHA-256 is the signed one. */
  async downloadUpdate(): Promise<{ path: string; version: string }> {
    const u = this.available;
    if (!u) throw new DesktopError('NOT_FOUND', 'There is no update to download.');
    if (!this.d.saveUpdate) throw new DesktopError('UNSUPPORTED', 'This build cannot keep downloads.');
    const res = await this.d.fetch(u.url, { method: 'GET', redirect: 'follow' });
    if (!res.ok) throw new DesktopError('SERVER_ERROR', `The download answered ${res.status}.`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = createHash('sha256').update(bytes).digest('hex');
    if (got !== u.sha256) {
      this.updateProblem = 'The downloaded build is not the one WorkSuite signed (SHA-256 differs). It was not kept.';
      this.d.changed();
      throw new DesktopError('POLICY_DENIED', this.updateProblem);
    }
    const name = (u.url.split('/').pop() ?? '').split('?')[0]!.replace(/[^A-Za-z0-9._-]/g, '-') || `print-gateway-${u.version}`;
    return { path: await this.d.saveUpdate(name, bytes), version: u.version };
  }

  /** Discovery to the server (FR-GWY-05): what this computer has, offered unapproved; and their statuses. */
  async reportPrinters(): Promise<void> {
    this.local = await this.d.localPrinters();
    const s0 = this.state();
    const r = await this.api<{ created?: Array<{ id: number; name: string; connection?: ServerConnection; approved?: boolean }> }>('POST', '/printers', {
      discovered: this.local.map(discoveredOf),
      status: Object.values(s0?.printers ?? {}).map((p) => ({ printer_id: p.id, status: serverStatus(this.states.get(p.id) ?? 'unknown') })),
    });
    const s = this.state();
    if (!s) return;
    const printers = { ...s.printers };
    for (const p of r?.created ?? []) {
      const k = printerKeyOf(p.connection);
      if (k) printers[k] = { id: Number(p.id), name: p.name, approved: !!p.approved };
    }
    this.save({ ...s, printers });
  }

  status(): GatewayStatus {
    const s = this.state();
    const tok = this.d.secrets.get(SECRET_TOKEN);
    const cur = this.core.current();
    return {
      paired: !!s && !s.revoked,
      connection: s?.revoked ? 'revoked' : s ? this.connection : 'unpaired',
      gatewayId: s ? String(s.gatewayId) : null,
      name: s?.name ?? null,
      server: s?.server ?? null,
      org: s?.org ?? null,
      pairedAt: s?.pairedAt ?? null,
      lastHeartbeatAt: this.lastHeartbeat,
      tokenExpiresAt: tok ? ((JSON.parse(tok) as { expires?: string }).expires ?? null) : null,
      keyStore: s && !s.revoked ? this.d.secrets.where() : null,
      headless: this.d.headless,
      autostart: this.d.autostart?.() ?? false,
      version: this.d.version,
      updateChannel: s ? (s.channel ?? 'stable') : null,
      company: s?.company ?? null,
      update: this.available ? { version: this.available.version, channel: this.available.channel, notes: this.available.notes, sha256: this.available.sha256 } : null,
      updateProblem: this.updateProblem,
      printers: Object.entries(s?.printers ?? {}).map(([key, p]) => ({ id: String(p.id), key, name: p.name, approved: p.approved, state: this.states.get(p.id) ?? 'unknown' })),
      current: cur ? { id: cur.id, ref: cur.ref, printer: cur.printerId, confirmed: cur.confirmed, total: cur.total } : null,
      lastCheck: this.lastCheck,
      problem: this.problem,
    };
  }
}
