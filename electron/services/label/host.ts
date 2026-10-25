import { LABEL_API, printerKeyOf, type DiscoveredPrinter, type HostSettings, type HostStatus, type LabelLanguage, type LabelSettingsPatch, type LocalPrinter, type PrinterState, type ServerConnection } from '@shared/label';
import { DesktopError } from '../../main/errors';
import type { HttpClient } from '../http';
import { CorePrintService, serverStatus, type ClaimedJob, type CorePrintDeps, type HostTransport, type PrintTarget } from './core-print';
import type { PrinterCommand } from './envelope';
import { discoverLan } from './raw-out';

/**
 * This computer as a Label Studio print host (WS-LABEL-SRS-001 FR-DSK-02…06, D04, D05) for the person signed in,
 * over the server's "Desktop print host" API (server docs/label-api.md):
 *
 *   POST /api/labels/hosts/desktop                      {device_id,name,platform,version} → {host_id, server_key}
 *   POST /api/labels/hosts/desktop/{id}/printers        {discovered:[…]} — printers created unapproved
 *   POST /api/labels/hosts/desktop/{id}/heartbeat       {printers:[{printer_id,status}]} → {commands}
 *   POST /api/labels/hosts/desktop/{id}/claim · GET …/jobs/{job}/chunks/{n} · POST …/jobs/{job}/progress
 *
 * Its printers are the OS's own queues (getPrintersAsync) and the LAN printers added here (D04's Discover). An
 * administrator approves each before it prints (FR-GWY-05); the server only hands out jobs for approved printers,
 * and this host only prints to a printer it has itself (the allow-list in `target`). Which printers are on this
 * computer is a fact about this computer: the settings and the journal are kept here, filed under the server.
 *
 * Heartbeat commands: `discover` reports the printers again, `cancel` stops the printer's job here; `status`,
 * `calibrate` and `cancel` carry printer bytes, which are sent only when the command's signed envelope verifies
 * (Label 1.1, envelope.ts `checkCommand`). A command without one, or that does not verify, sends nothing.
 */
const KEY = 'label-host';
const TICK_MS = 5_000;
const BEAT_MS = 30_000;

interface Registered {
  hostId: number | null;
  registeredAt: string | null;
  keys: Record<string, string>;
  /** The server's printers of this host, by this computer's key. */
  printers: Record<string, { id: number; approved: boolean; name: string; status: string }>;
}

interface Stored {
  settings: HostSettings;
  reg: Registered;
  journal: Record<string, unknown>;
}

export const DEFAULT_HOST_SETTINGS: HostSettings = { host: true, stationPrinter: null, lan: [] };

/** A guess at an OS queue's language from its name; the server's catalog is what decides (§12.2). */
export function guessLanguage(name: string): LabelLanguage {
  if (/zebra|\bz[dt]\d|\bg[kx]\d|zpl/i.test(name)) return 'zpl';
  if (/\btsc\b|tspl|\bte\d{3}/i.test(name)) return 'tspl';
  if (/honeywell|datamax|intermec|\bpc\d{2}/i.test(name)) return 'dpl';
  if (/\bsato\b/i.test(name)) return 'sbpl';
  if (/brother|\bql-|\bpt-/i.test(name)) return 'escp';
  return 'unknown';
}

/** What a manufacturer the name suggests, for the server's catalog (Catalog::resolve). */
export function guessMaker(name: string): string {
  const m = /(zebra|tsc|honeywell|datamax|intermec|sato|brother|godex|citizen|epson|dymo|xprinter)/i.exec(name);
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase() : 'Generic';
}

/** A local printer as the server's discovery takes it (Printers::discovered). */
export function discoveredOf(p: LocalPrinter): Record<string, unknown> {
  return p.connection === 'tcp'
    ? { name: p.name, connection: { kind: 'ethernet', address: p.address, port: p.port ?? 9100 }, manufacturer: guessMaker(p.name), model: p.name, language: p.language === 'unknown' ? undefined : p.language }
    : { name: p.name, os_name: p.address, connection: { kind: 'os' }, manufacturer: guessMaker(p.name), model: p.name, language: p.language === 'unknown' ? undefined : p.language };
}

/** The allow-list: a claim's printer is printed to only if it is one of this computer's own. */
export function targetFor(local: LocalPrinter[], c: ServerConnection | null | undefined, language?: string | null): PrintTarget | null {
  const key = printerKeyOf(c);
  const p = key ? local.find((x) => x.key === key) : undefined;
  if (!p) return null;
  const lang = (language && ['zpl', 'tspl', 'epl', 'dpl', 'sbpl', 'escp', 'pdf'].includes(language) ? language : p.language) as LabelLanguage;
  return { key: p.key, connection: p.connection, address: p.address, port: p.port, language: lang };
}

/** One of this computer's printers by its key, as a send target. */
export function localTarget(local: LocalPrinter[], key: string): PrintTarget | null {
  const p = local.find((x) => x.key === key);
  return p ? { key: p.key, connection: p.connection, address: p.address, port: p.port, language: p.language } : null;
}

const httpStatus = (e: unknown) => (e instanceof DesktopError ? e.status : null);

export interface LabelHostDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  http: Pick<HttpClient, 'request'>;
  origin: () => string | null;
  /** Signed in, and may use Label Studio. */
  active: () => boolean;
  installId: () => string;
  computerName: () => string;
  version: string;
  /** The OS's printers. */
  osPrinters: () => Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>;
  changed: () => void;
  now?: () => number;
  /** For tests. */
  core?: Partial<Pick<CorePrintDeps, 'send' | 'status'>>;
  discover?: (known: Set<string>) => Promise<DiscoveredPrinter[]>;
}

export class LabelHost {
  readonly core: CorePrintService;
  private timer: NodeJS.Timeout | null = null;
  private lastBeat = 0;
  private local: LocalPrinter[] = [];
  private states = new Map<string, { state: PrinterState; at: string; message: string | null }>();
  private problem: string | null = null;

  constructor(private readonly d: LabelHostDeps) {
    const base = () => `${LABEL_API}/hosts/desktop/${this.hostId()}`;
    const transport: HostTransport = {
      org: () => null, // the person's session scopes the host's jobs; the envelope's company is the server's
      keys: async () => this.stored().reg.keys,
      claim: async (max) => {
        const r = await d.http.request<{ jobs?: ClaimedJob[] }>('POST', `${base()}/claim`, { body: { max }, timeoutMs: 20_000 });
        return Array.isArray(r?.jobs) ? r.jobs : [];
      },
      chunk: (jobId, n) => d.http.request('GET', `${base()}/jobs/${jobId}/chunks/${n}`, { timeoutMs: 60_000 }),
      progress: async (jobId, report) => {
        try {
          return await d.http.request('POST', `${base()}/jobs/${jobId}/progress`, { body: report, timeoutMs: 15_000 });
        } catch (e) {
          if (httpStatus(e) === 409) throw Object.assign(new Error('LEASE_LOST'), { code: 'LEASE_LOST' });
          throw e;
        }
      },
      resume: async (jobId) => {
        await d.http.request('POST', `${LABEL_API}/jobs/${jobId}/resume`, { body: { reason: 'The printer is ready again.' } });
      },
      cancel: async (jobId) => {
        await d.http.request('POST', `${LABEL_API}/jobs/${jobId}/cancel`, { body: { reason: 'Cancelled at the printer.' } });
      },
    };
    this.core = new CorePrintService({
      transport,
      person: true,
      journal: {
        read: () => this.stored().journal as never,
        write: (v) => this.write({ journal: v as never }),
      },
      target: (printer) => targetFor(this.local, printer.connection, printer.language),
      changed: d.changed,
      onPrinterState: (_id, key, state, message) => this.states.set(key, { state, message, at: this.stamp() }),
      ...d.core,
      now: d.now,
    });
  }

  private stamp(): string {
    return new Date(this.d.now?.() ?? Date.now()).toISOString();
  }

  private allStored(): Record<string, Stored> {
    const v = this.d.config.getConfig<Record<string, Stored>>(KEY);
    return v && typeof v === 'object' ? v : {};
  }

  private stored(): Stored {
    const o = this.d.origin();
    const s = o ? this.allStored()[o] : undefined;
    return {
      settings: { ...DEFAULT_HOST_SETTINGS, ...s?.settings, lan: [...(s?.settings?.lan ?? [])] },
      reg: { hostId: null, registeredAt: null, keys: {}, printers: {}, ...s?.reg },
      journal: s?.journal ?? {},
    };
  }

  private write(patch: Partial<Stored>): void {
    const o = this.d.origin();
    if (!o) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    this.d.config.setConfig(KEY, { ...this.allStored(), [o]: { ...this.stored(), ...patch } });
  }

  private hostId(): number {
    const id = this.stored().reg.hostId;
    if (!id) throw new DesktopError('NOT_FOUND', 'This computer is not registered as a label print host yet.');
    return id;
  }

  /* ── Settings and printers ──────────────────────────────────────── */

  settings(): HostSettings {
    return this.stored().settings;
  }

  update(patch: LabelSettingsPatch): HostSettings {
    const s = this.settings();
    let lan = s.lan;
    if (patch.addLan) {
      const p = { port: 9100, language: 'zpl' as const, ...patch.addLan };
      lan = [...lan.filter((x) => !(x.address === p.address && x.port === p.port)), p];
    }
    if (patch.removeLan) lan = lan.filter((x) => `tcp:${x.address}:${x.port}` !== patch.removeLan);
    const next: HostSettings = { host: patch.host ?? s.host, stationPrinter: patch.stationPrinter !== undefined ? patch.stationPrinter : s.stationPrinter, lan };
    this.write({ settings: next });
    this.d.changed();
    return next;
  }

  /** Every printer on this computer, with what the server knows of it (D04). */
  async printers(): Promise<LocalPrinter[]> {
    const reg = this.stored().reg.printers;
    const os = await this.d.osPrinters().catch(() => []);
    const list: LocalPrinter[] = [
      ...os.map((p) => ({ key: `os:${p.name}`, name: p.displayName || p.name, connection: 'spooler' as const, address: p.name, port: null, language: guessLanguage(`${p.name} ${p.displayName}`), isDefault: p.isDefault })),
      ...this.settings().lan.map((p) => ({ key: `tcp:${p.address}:${p.port}`, name: p.name, connection: 'tcp' as const, address: p.address, port: p.port, language: p.language, isDefault: false })),
    ].map((p) => {
      const st = this.states.get(p.key);
      const r = reg[p.key];
      return { ...p, serverId: r ? String(r.id) : null, approved: !!r?.approved, state: st?.state ?? (r ? (r.status.toLowerCase() as PrinterState) : 'unknown'), stateAt: st?.at ?? null, message: st?.message ?? null };
    });
    this.local = list;
    return list;
  }

  /** The server's printers of this host (needs label.printer.view; else what registering created is what is known). */
  private async serverPrinters(hostId: number, created: Array<{ id: number; name: string; connection?: ServerConnection; approved?: boolean; status?: string }>): Promise<Registered['printers']> {
    const map: Registered['printers'] = { ...this.stored().reg.printers };
    let rows = created;
    try {
      const r = await this.d.http.request<{ items?: typeof created } | typeof created>('GET', `${LABEL_API}/printers`, { query: { host_type: 'desktop', per_page: 200 } });
      const items = Array.isArray(r) ? r : (r?.items ?? []);
      rows = [...items.filter((p) => (p as { host_id?: number }).host_id === hostId), ...created];
    } catch {
      /* not this person's to see: keep what is known */
    }
    for (const p of rows) {
      const key = printerKeyOf(p.connection);
      if (key) map[key] = { id: Number(p.id), approved: !!p.approved, name: p.name, status: p.status ?? 'UNKNOWN' };
    }
    return map;
  }

  /** Register this computer and offer its printers to WorkSuite; they wait for an administrator's approval. */
  async register(): Promise<HostStatus> {
    const r = await this.d.http.request<{ host_id?: number; server_key?: { key_id?: string; public_key?: string } }>('POST', `${LABEL_API}/hosts/desktop`, {
      body: { device_id: this.d.installId(), name: this.d.computerName(), platform: process.platform, version: this.d.version },
    });
    if (!r?.host_id) throw new DesktopError('SERVER_ERROR', 'WorkSuite did not register this computer as a print host.');
    const keys = r.server_key?.key_id && r.server_key.public_key ? { [r.server_key.key_id]: r.server_key.public_key } : {};
    this.write({ reg: { ...this.stored().reg, hostId: r.host_id, registeredAt: this.stamp(), keys } });
    const local = await this.printers();
    let created: Array<{ id: number; name: string; connection?: ServerConnection; approved?: boolean }> = [];
    this.problem = null;
    try {
      const a = await this.d.http.request<{ created?: typeof created }>('POST', `${LABEL_API}/hosts/desktop/${r.host_id}/printers`, { body: { discovered: local.map(discoveredOf) } });
      created = a?.created ?? [];
    } catch (e) {
      this.problem = httpStatus(e) === 403 ? 'Offering printers to WorkSuite needs the “Add printers” permission (label.printer.add).' : e instanceof Error ? e.message : String(e);
    }
    this.write({ reg: { ...this.stored().reg, printers: await this.serverPrinters(r.host_id, created) } });
    this.d.changed();
    return this.status();
  }

  async discover(): Promise<DiscoveredPrinter[]> {
    const known = new Set(this.settings().lan.map((p) => `tcp:${p.address}:${p.port}`));
    return (this.d.discover ?? ((k) => discoverLan({ known: k })))(known);
  }

  async status(): Promise<HostStatus> {
    const s = this.stored();
    const h = this.core.health();
    return { enabled: s.settings.host, hostId: s.reg.hostId ? String(s.reg.hostId) : null, registeredAt: s.reg.registeredAt, lastClaimAt: h.lastClaimAt, problem: h.problem ?? this.problem, printers: await this.printers(), jobs: this.core.jobs() };
  }

  /* ── The loop ───────────────────────────────────────────────────── */

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    if (!this.d.origin() || !this.d.active() || !this.settings().host || !this.stored().reg.hostId) return 0;
    await this.printers();
    const now = this.d.now?.() ?? Date.now();
    if (now - this.lastBeat >= BEAT_MS) {
      this.lastBeat = now;
      await this.beat().catch(() => undefined);
    }
    return this.core.tick();
  }

  /** Statuses to the server; its commands back (FR-DSK-02, FR-PRN-02). */
  private async beat(): Promise<void> {
    const reg = this.stored().reg.printers;
    const printers = Object.entries(reg)
      .filter(([k]) => this.states.has(k))
      .map(([k, p]) => ({ printer_id: p.id, status: serverStatus(this.states.get(k)!.state) }));
    const r = await this.d.http.request<{ commands?: PrinterCommand[] }>('POST', `${LABEL_API}/hosts/desktop/${this.hostId()}/heartbeat`, { body: { printers } });
    for (const c of r?.commands ?? []) {
      if (c.type === 'discover') await this.register().catch(() => undefined);
      if (c.type === 'cancel' && c.printer_id) {
        const j = this.core.jobs().find((x) => x.printerId === String(c.printer_id) && (x.state === 'printing' || x.state === 'waiting_printer'));
        if (j) await this.core.cancel(j.id).catch(() => undefined);
      }
      if ((c.type === 'status' || c.type === 'calibrate' || c.type === 'cancel') && c.printer_id && (c.bytes_base64 || c.envelope)) {
        const key = Object.entries(reg).find(([, p]) => p.id === c.printer_id)?.[0];
        const out = await this.core.command(c, key ? localTarget(this.local, key) : null).catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
        if (!out.ok) this.problem = out.reason;
      }
    }
  }

  forgetAll(): void {
    this.d.config.deleteConfig(KEY);
    this.states.clear();
  }
}
