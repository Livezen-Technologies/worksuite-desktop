import {
  printableText,
  RESTAURANT_API,
  type RestaurantPairing,
  type RestaurantPrinterMap,
  type RestaurantPrintJobLog,
  type RestaurantPrintOutcome,
  type RestaurantPrintPatch,
  type RestaurantPrintSettings,
  type RestaurantStatus,
} from '@shared/restaurant';
import { DesktopError, isDesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import type { HttpClient } from '../http';
import { drawerPulse, printInWindow, sendRaw, type PrintJob, type PrintResult } from '../salon-print';

const log = logger('restaurant-print');

/**
 * The print agent (Restaurant SRS §4.4, RM-DSK-003): this computer prints the
 * server's print jobs for the printers plugged into it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVER KEEPS THE QUEUE; THIS COMPUTER KEEPS THE DRIVERS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Kitchen tickets, bills and receipts are queued on the server by print route
 * (`restaurant_print_jobs`). A paired terminal claims the waiting jobs of the
 * printers it hosts (`POST print-jobs/claim` with its `X-Terminal-Key`),
 * prints each and answers `printed` or `failed` with why; the server retries,
 * falls back to the backup printer, then leaves a ticket to the kitchen screen
 * with an alert. A job claimed and never answered is retried by the server's
 * sweep, so an agent that dies mid-job loses nothing.
 *
 * What is printed is the server's own rendering — the job's `payload.text`,
 * 32 columns, with ADD / VOID / REPRINT marks — never something a page made:
 *
 *  - `escpos`: the text raw to a thermal printer (ESC @, the lines, a feed and
 *    a cut), through CUPS or the Windows spooler as SalonMate's drawer pulse
 *    goes (salon-print.ts `sendRaw`) — no native module, no shell;
 *  - `page`: the text laid out in a hidden window with no script, no network
 *    and a CSP that allows nothing (salon-print.ts `printInWindow`), printed
 *    silently through the OS driver.
 *
 * Which of the server's printers is which printer on this computer is a fact
 * about this computer: kept in its settings, filed under the server. Only the
 * mapped printers are claimed for, so a job this computer cannot print stays
 * in the queue for the one that can.
 */
const KEY = 'restaurant-print';
const TICK_MS = 4_000;
const LOG_MAX = 60;
const MAX_TEXT = 40_000;

export const DEFAULT_RESTAURANT_PRINT: RestaurantPrintSettings = { agent: true, printers: {}, drawer_printer_id: null, drawer_pin: 2 };

/** ESC @ (initialise), the text in the printer's single-byte code page, a feed, and a partial cut (GS V 66 0). */
export function escposBytes(text: string, cut: boolean, copies = 1): Buffer {
  const body = printableText(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\n\x20-\x7e]/g, '?');
  const one = Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.from(`${body}\n\n\n\n`, 'latin1'), cut ? Buffer.from([0x1d, 0x56, 0x42, 0x00]) : Buffer.alloc(0)]);
  return Buffer.concat(Array.from({ length: Math.max(1, Math.min(3, copies)) }, () => one));
}

/** The text as a page for the OS driver: monospace, as wide as the roll, nothing that runs. */
export function textPage(text: string, paper: '80mm' | '58mm'): string {
  const esc = printableText(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const size = paper === '58mm' ? 10 : 12;
  return `<style>html,body{margin:0;padding:0;background:#fff;color:#000}pre{margin:0;padding:2mm 1mm;font:${size}px/1.25 "Courier New",monospace;white-space:pre-wrap;word-break:break-word}</style><pre>${esc}</pre>`;
}

/** A claimed job, as `Printing::claim` shapes it. */
export interface ClaimedJob {
  id: number;
  document: string;
  reprint?: boolean;
  printer_id: number | null;
  payload?: { text?: unknown; copies?: unknown; document?: unknown } | null;
  printer?: { id: number; name?: string; kind?: string; connection?: string; paper?: string } | null;
}

export interface RestaurantPrintDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  http: Pick<HttpClient, 'request'>;
  origin: () => string | null;
  terminal: () => RestaurantPairing | null;
  terminalKey: () => string | null;
  /** Signed in, and may use the Restaurant app. */
  active: () => boolean;
  /** The printers installed on this computer (names). */
  installed: () => Promise<string[]>;
  changed: () => void;
  print?: (job: PrintJob) => Promise<PrintResult>;
  raw?: (printer: string, bytes: Buffer) => Promise<PrintResult>;
  now?: () => number;
}

type Stored = Record<string, RestaurantPrintSettings>;

export class RestaurantPrintAgent {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly print: (job: PrintJob) => Promise<PrintResult>;
  private readonly raw: (printer: string, bytes: Buffer) => Promise<PrintResult>;
  private log: RestaurantPrintJobLog[] = [];
  private health = new Map<number, 'online' | 'error'>();
  private lastClaim: string | null = null;
  private problem: string | null = null;

  constructor(private readonly d: RestaurantPrintDeps) {
    this.print = d.print ?? printInWindow;
    this.raw = d.raw ?? ((p, b) => sendRaw(p, b));
  }

  private stamp(): string {
    return new Date(this.d.now?.() ?? Date.now()).toISOString();
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  private all(): Stored {
    const v = this.d.config.getConfig<Stored>(KEY);
    return v && typeof v === 'object' ? v : {};
  }

  settings(): RestaurantPrintSettings {
    const o = this.d.origin();
    const s = o ? this.all()[o] : undefined;
    return { ...DEFAULT_RESTAURANT_PRINT, ...s, printers: { ...(s?.printers ?? {}) } };
  }

  /** Change them. A device named must be one this computer has; a null mapping removes it. */
  update(patch: RestaurantPrintPatch, installed: string[]): RestaurantPrintSettings {
    const o = this.d.origin();
    if (!o) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    const cur = this.settings();
    const printers = { ...cur.printers };
    for (const [id, m] of Object.entries(patch.printers ?? {})) {
      if (m === null || m.device === null) {
        delete printers[id];
        continue;
      }
      if (!installed.includes(m.device)) throw new DesktopError('NOT_FOUND', `There is no printer called “${m.device}” on this computer.`);
      printers[id] = m;
    }
    const next: RestaurantPrintSettings = {
      agent: patch.agent ?? cur.agent,
      printers,
      drawer_printer_id: patch.drawer_printer_id !== undefined ? patch.drawer_printer_id : cur.drawer_printer_id,
      drawer_pin: patch.drawer_pin ?? cur.drawer_pin,
    };
    this.d.config.setConfig(KEY, { ...this.all(), [o]: next });
    this.d.changed();
    return next;
  }

  forgetAll(): void {
    this.d.config.deleteConfig(KEY);
    this.log = [];
    this.health.clear();
  }

  /* ── The loop ─────────────────────────────────────────────────────── */

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Claim and print what waits for this computer's printers. One round at a time. */
  async tick(): Promise<number> {
    if (this.busy) return 0;
    const t = this.d.terminal();
    const key = this.d.terminalKey();
    const s = this.settings();
    const ids = Object.keys(s.printers).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!t || !key || !this.d.active() || !s.agent || ids.length === 0) return 0;
    this.busy = true;
    let n = 0;
    try {
      const data = await this.d.http.request<{ jobs?: ClaimedJob[] }>('POST', `${RESTAURANT_API}/print-jobs/claim`, {
        query: { org: t.org_id },
        body: { printer_ids: ids, limit: 10 },
        headers: { 'X-Terminal-Key': key },
        timeoutMs: 20_000,
      });
      this.lastClaim = this.stamp();
      this.problem = null;
      const installed = data?.jobs?.length ? await this.d.installed() : [];
      for (const job of data?.jobs ?? []) {
        await this.one(t, key, job, s, installed);
        n++;
      }
    } catch (e) {
      /* Out of reach: the jobs wait on the server. A refusal is worth showing (a revoked key). */
      if (!(isDesktopError(e) && e.code === 'NETWORK_UNREACHABLE')) this.problem = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
    if (n > 0 || this.problem) this.d.changed();
    return n;
  }

  private async one(t: RestaurantPairing, key: string, job: ClaimedJob, s: RestaurantPrintSettings, installed: string[]): Promise<void> {
    const pid = job.printer_id ?? job.printer?.id ?? null;
    const map = pid ? s.printers[String(pid)] : undefined;
    const text = typeof job.payload?.text === 'string' ? job.payload.text : null;
    const copies = Number(job.payload?.copies) || 1;
    let r: PrintResult;
    if (!map?.device) r = { ok: false, reason: 'This computer has no printer set for it.' };
    else if (!text) r = { ok: false, reason: 'The job has nothing to print.' };
    else if (!installed.includes(map.device)) r = { ok: false, reason: `The printer “${map.device}” is not on this computer any more.` };
    else r = await this.out(map, text.slice(0, MAX_TEXT), copies);

    if (pid) this.health.set(pid, r.ok ? 'online' : 'error');
    const entry: RestaurantPrintJobLog = {
      job_id: job.id,
      document: String(job.document ?? job.payload?.document ?? ''),
      printer_id: pid,
      printer_name: job.printer?.name ?? null,
      device: map?.device ?? null,
      ok: r.ok,
      message: r.ok ? 'Printed.' : r.reason,
      reprint: !!job.reprint,
      at: this.stamp(),
    };
    this.log = [entry, ...this.log].slice(0, LOG_MAX);
    try {
      await this.d.http.request('POST', `${RESTAURANT_API}/print-jobs/${job.id}/${r.ok ? 'printed' : 'failed'}`, {
        query: { org: t.org_id },
        body: r.ok ? {} : { error: r.reason.slice(0, 480) },
        headers: { 'X-Terminal-Key': key },
        timeoutMs: 20_000,
      });
    } catch (e) {
      /* The server's sweep counts an unanswered claim as a failed try; it is noted here too. */
      log.warn('print job answer not sent', { job: job.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async out(map: RestaurantPrinterMap, text: string, copies: number): Promise<PrintResult> {
    if (map.mode === 'escpos') return this.raw(map.device!, escposBytes(text, map.cut, copies));
    const r = await this.print({ html: textPage(text, map.paper), paper: map.paper, deviceName: map.device, silent: true, copies: Math.max(1, Math.min(3, copies)) });
    return r.ok ? r : { ok: false, reason: r.reason === 'cancelled' ? 'Printing was cancelled.' : r.reason };
  }

  /* ── On request ───────────────────────────────────────────────────── */

  private async local(printerId: number | null, text: string, copies: number, installed: string[]): Promise<RestaurantPrintOutcome> {
    const s = this.settings();
    const id = printerId ?? s.drawer_printer_id ?? Number(Object.keys(s.printers)[0] ?? 0);
    const map = id ? s.printers[String(id)] : undefined;
    if (!map?.device) return { ok: false, device: null, message: 'Choose this computer’s receipt printer in Printers first.' };
    if (!installed.includes(map.device)) return { ok: false, device: map.device, message: `The printer “${map.device}” is not on this computer any more.` };
    const r = await this.out(map, text, copies);
    if (id) this.health.set(id, r.ok ? 'online' : 'error');
    return r.ok ? { ok: true, device: map.device, message: `Sent to ${map.device}.` } : { ok: false, device: map.device, message: `It could not be printed: ${r.reason}` };
  }

  /** A test slip on one of the server's printers, as mapped here. */
  test(printerId: number, installed: string[]): Promise<RestaurantPrintOutcome> {
    const t = this.d.terminal();
    const lines = ['WORKSUITE RESTAURANT', 'Test print', '-'.repeat(32), `Terminal ${t?.code ?? ''} ${t?.name ?? ''}`.trim(), `Printer #${printerId}`, this.stamp().slice(0, 16).replace('T', ' ') + ' UTC', '-'.repeat(32), '12345678901234567890123456789012'];
    return this.local(printerId, lines.join('\n'), 1, installed);
  }

  /** A document the server rendered that no print route took (a bill with no bill route): printed here. */
  text(text: string, printerId: number | null, copies: number, installed: string[]): Promise<RestaurantPrintOutcome> {
    return this.local(printerId, text.slice(0, MAX_TEXT), copies, installed);
  }

  /** Open the cash drawer through the receipt printer it is plugged into. */
  async drawer(installed: string[]): Promise<RestaurantPrintOutcome> {
    const s = this.settings();
    const map = s.drawer_printer_id ? s.printers[String(s.drawer_printer_id)] : undefined;
    if (!map?.device) return { ok: false, device: null, message: 'No cash drawer is set up on this computer.' };
    if (!installed.includes(map.device)) return { ok: false, device: map.device, message: `The printer “${map.device}” is not on this computer any more.` };
    const r = await this.raw(map.device, drawerPulse(s.drawer_pin));
    return r.ok ? { ok: true, device: map.device, message: 'Drawer opened.' } : { ok: false, device: map.device, message: `The drawer did not open: ${r.reason}` };
  }

  /* ── What the screens and the heartbeat read ──────────────────────── */

  jobs(): RestaurantPrintJobLog[] {
    return this.log;
  }

  printers(): Array<{ id: number; status: 'online' | 'error' }> {
    return [...this.health.entries()].map(([id, status]) => ({ id, status }));
  }

  status(): RestaurantStatus['agent'] {
    const s = this.settings();
    return { enabled: s.agent, mapped: Object.keys(s.printers).length, last_claim_at: this.lastClaim, problem: this.problem, printers: this.printers() };
  }
}
