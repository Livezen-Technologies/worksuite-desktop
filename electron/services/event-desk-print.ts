import { BrowserWindow } from 'electron';
import type { DeskPrintOutcome, DeskPrintPatch, DeskPrintSettings } from '@shared/event-desk';
import { DesktopError } from '../main/errors';
import type { HttpClient } from './http';
import { printDocument } from './salon-print';

/**
 * The Event Desk's badges (Events SRS §8.4, EV-BDG-010..013): printed on this
 * computer's own printer, straight from the server's badge page.
 *
 * What is printed is WorkSuite's page for the print jobs named
 * (`GET events/{id}/badge-prints/sheet?ids=` — each badge at its template's
 * size, the QR drawn in), fetched here: a page cannot hand this process
 * something else to print silently. It is laid out in a hidden window with no
 * preload, no network and no script (the same window SalonMate's receipts
 * use). The printer is the one this desk was set up with — silently, without
 * the OS dialog, when the desk says so — and the page is the template's size,
 * or the label the printer is loaded with. Each job is then reported to
 * WorkSuite as printed or failed (`POST badge-prints/{id}/printed|failed`),
 * which is the print log EV-BDG-012 asks for.
 *
 * Settings are this computer's, filed under the server: which printers are
 * plugged in is a fact about the computer. A full wipe forgets them.
 */
const KEY = 'event-desk-print';
const EVENTS = '/api/events/v1';
const MAX_HTML = 5_000_000;

export const DEFAULT_DESK_PRINT: DeskPrintSettings = { badge_printer: null, silent: true, page: 'template', printer_name: null, take_phone_jobs: false };

/** The badge's size from the page WorkSuite sent (`@page{size:105mm 148mm}`), in microns, or null. */
export function badgeSize(html: string): { width: number; height: number } | null {
  const m = /@page\s*\{\s*size\s*:\s*([\d.]+)mm\s+([\d.]+)mm/i.exec(html);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w >= 20 && w <= 300 && h >= 20 && h <= 300)) return null;
  return { width: Math.round(w * 1000), height: Math.round(h * 1000) };
}

export interface BadgePrintJob {
  html: string;
  deviceName: string | null;
  silent: boolean;
  pageSize: { width: number; height: number } | null;
}

export type BadgePrintResult = { ok: true } | { ok: false; reason: string };

/** Print the page from a hidden window of its own: no preload, no network, no script. */
export async function printBadgesInWindow(job: BadgePrintJob): Promise<BadgePrintResult> {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1000,
    webPreferences: { partition: 'ws-event-badges', sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, images: true },
  });
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printDocument(job.html))}`);
    return await new Promise<BadgePrintResult>((resolve) => {
      win.webContents.print(
        {
          silent: job.silent,
          deviceName: job.deviceName ?? undefined,
          printBackground: true,
          margins: { marginType: 'none' },
          ...(job.pageSize ? { pageSize: job.pageSize } : { usePrinterDefaultPageSize: true }),
        },
        (ok, reason) => resolve(ok ? { ok: true } : { ok: false, reason: reason || 'cancelled' }),
      );
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export interface EventDeskPrintDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  http: Pick<HttpClient, 'raw' | 'url'>;
  origin: () => string | null;
  print?: (job: BadgePrintJob) => Promise<BadgePrintResult>;
}

type Stored = Record<string, DeskPrintSettings>;

export class EventDeskPrint {
  private readonly print: (job: BadgePrintJob) => Promise<BadgePrintResult>;

  constructor(private readonly deps: EventDeskPrintDeps) {
    this.print = deps.print ?? printBadgesInWindow;
  }

  private all(): Stored {
    const v = this.deps.config.getConfig<Stored>(KEY);
    return v && typeof v === 'object' ? v : {};
  }

  /** This computer's badge printer for the server it is signed in to. */
  settings(): DeskPrintSettings {
    const o = this.deps.origin();
    return { ...DEFAULT_DESK_PRINT, ...(o ? this.all()[o] : undefined) };
  }

  /** Change them. A printer named must be one this computer has. */
  update(patch: DeskPrintPatch, installed: string[]): DeskPrintSettings {
    const o = this.deps.origin();
    if (!o) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    if (patch.badge_printer && !installed.includes(patch.badge_printer)) throw new DesktopError('NOT_FOUND', `There is no printer called “${patch.badge_printer}” on this computer.`);
    const was = this.settings();
    const next: DeskPrintSettings = { ...was, ...patch, printer_name: 'printer_name' in patch ? patch.printer_name?.trim() || null : was.printer_name };
    this.deps.config.setConfig(KEY, { ...this.all(), [o]: next });
    return next;
  }

  forgetAll(): void {
    this.deps.config.deleteConfig(KEY);
  }

  private async report(jobId: number, on: 'printed' | 'failed', body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await this.deps.http.raw('POST', this.deps.http.url(`${EVENTS}/badge-prints/${jobId}/${on}`), {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Print these jobs' badges on this desk's printer and tell WorkSuite how it
   * went (EV-BDG-012). One page for them all, in the order given.
   */
  async printJobs(eventId: number, jobIds: number[], installed: string[]): Promise<DeskPrintOutcome> {
    const s = this.settings();
    const printer = s.badge_printer;
    if (printer && !installed.includes(printer)) {
      return { ok: false, printed: [], failed: [], message: `The printer “${printer}” is not on this computer any more. Choose another under Badge printer.` };
    }
    const res = await this.deps.http.raw('GET', this.deps.http.url(`${EVENTS}/events/${eventId}/badge-prints/sheet`, { ids: jobIds.join(',') }), { headers: { Accept: 'text/html' } });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('text/html')) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, printed: [], failed: [], message: body?.message ?? 'WorkSuite did not send the badges.' };
    }
    const html = await res.text();
    if (html.length > MAX_HTML) return { ok: false, printed: [], failed: [], message: 'The badges WorkSuite sent are too large to print at once. Print fewer.' };

    const r = await this.print({ html, deviceName: printer, silent: s.silent && !!printer, pageSize: s.page === 'template' ? badgeSize(html) : null });
    if (!r.ok && r.reason === 'cancelled') {
      /* Not printed, and not a printer's failure: the job stays waiting to be printed. */
      return { ok: false, printed: [], failed: [], message: 'Printing was cancelled; the badges are still waiting to print.' };
    }
    const printed: number[] = [];
    const failed: number[] = [];
    for (const id of jobIds) {
      const told = r.ok ? await this.report(id, 'printed', { printer: printer ?? undefined }) : await this.report(id, 'failed', { error: r.reason.slice(0, 250) });
      if (r.ok && told) printed.push(id);
      else failed.push(id);
    }
    if (!r.ok) return { ok: false, printed, failed, message: `The badges could not be printed: ${r.reason}.` };
    return {
      ok: failed.length === 0,
      printed,
      failed,
      message: failed.length === 0 ? `${printed.length === 1 ? 'Badge' : `${printed.length} badges`} sent to ${printer ?? 'the printer'}.` : `Printed, but WorkSuite was not told about ${failed.length} of them; mark them in the print queue.`,
    };
  }
}
