import type { WebContents } from 'electron';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeFileName } from '@shared/filename';
import {
  ApprovalBanners,
  DEFAULT_SALES_PRINT,
  deliveryNoteHtml,
  labelPath,
  looksLikeZpl,
  reportExportPath,
  type DeliveryLineRecord,
  type DeliveryRecord,
  type LabelFormat,
  type SalesPrintOutcome,
  type SalesPrintPatch,
  type SalesPrintSettings,
  type SalesSaveReport,
} from '@shared/sales';
import type { IpcRouter } from '../ipc/router';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import type { ClaimedNotice, Incoming } from './notifications';
import { printInWindow, sendRaw, type PrintJob, type PrintResult } from './salon-print';

const log = logger('sales-desk');

/**
 * WorkSuite Sales on this computer (WS-OMS-SRS-001 v1.1 FR-DSK-05/06, FR-APR-10, FR-LBL-06).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * APPROVE FROM THE BANNER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * An order waiting on my decision (`oms.approval`) arrives through the notification service, which hands it here
 * (`claim`) instead of showing it plainly. Its banner has Approve and Open (the server's words where it sent them):
 *
 *  - Approve decides my step with `POST /api/oms/orders/{id}/approve` — the same call the Approve button makes, behind
 *    the same permission — sending the step the banner was about, so a step somebody else already took is not decided
 *    again. The bell's entry is marked read and the count asked again. When the server refuses (the step was taken,
 *    the order moved on, I may not), the order opens with the reason, so nothing is decided by accident.
 *  - Open opens the approvals queue with the order's drawer.
 *
 * Locked, or without the Sales app, a button opens the app instead (the notification service's rule for every banner
 * with buttons); with content hidden there are no buttons.
 *
 * The count of approvals waiting on me (`/api/badges`' `sales`, the server's Badge::pending) is the notification
 * service's, so it is asked with the other counts; an `oms.approval.changed` or `oms.badge` event asks again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRINTING ON THIS COMPUTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * One printer per kind, remembered per server (which printers are plugged in is a fact about this computer):
 *
 *  - Labels: the server's label for the shipment (`GET …/shipments/{id}/labels`), which logs the print — a reprint
 *    keeps its tracking number (AC-20). As raw ZPL it goes straight to the thermal printer through CUPS (`lp -o raw`)
 *    or the Windows spooler, the same path the tills' drawers use (salon-print.ts `sendRaw`); bytes that are not ZPL
 *    are refused rather than printed as a page of code. As PDF it goes through CUPS to the printer's driver; Windows
 *    has no such path for a PDF, so there it is saved and opened for the person to print.
 *  - Delivery notes: WorkSuite has no printable delivery note, so the page is laid out here from Inventory's record of
 *    the note (`GET /api/inventory/deliveries/{id}`) — every value escaped, printed in a hidden window with no script
 *    and no network — with the note's number as a barcode the Shipping desk scans back.
 *  - Silently when the person said so and a printer is chosen; otherwise the system's dialog.
 *
 * Reports are saved as the server's PDF wherever the person chooses (this process's own dialog), and only a file
 * saved here can be shown in its folder.
 */

export interface SalesDeskDeps {
  http: Pick<HttpClient, 'raw' | 'url' | 'post' | 'get'>;
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  origin: () => string | null;
  /** Shows a banner (the notification service's `notify`): its switches, quiet hours and privacy apply. */
  notify: (n: Incoming) => void;
  markRead: (ids: string[]) => Promise<void>;
  /** Signed in, unlocked, with the Sales app. */
  enabled: () => boolean;
  /** Opens a desktop route in the main window, as a banner's click does. */
  open: (route: string) => void;
  /** Ask for the counts again (the approval count is among them). */
  refreshCounts: () => void;
  toast: (kind: 'success' | 'error' | 'info', text: string) => void;
  /** The printers this computer has, as the sending window sees them. */
  printers: (sender: WebContents) => Promise<string[]>;
  /** The save dialog, parented to the sending window. */
  saveDialog: (sender: WebContents, defaultPath: string) => Promise<string | null>;
  documents: () => string;
  /** Somewhere to keep a label this computer cannot print silently, and opening it. */
  temp: () => string;
  openPath: (path: string) => Promise<void>;
  reveal: (path: string) => void;
  platform?: NodeJS.Platform;
  print?: (job: PrintJob) => Promise<PrintResult>;
  raw?: (printer: string, bytes: Buffer) => Promise<PrintResult>;
  pdf?: (printer: string, bytes: Buffer) => Promise<PrintResult>;
  now?: () => Date;
}

const KEY = 'sales-print';
const MAX_LABEL = 5_000_000;
type Stored = Record<string, SalesPrintSettings>;

/** A PDF to a CUPS printer through its driver (not raw): `lp -d <printer>`, the bytes on stdin, no shell. */
export function sendPdf(printer: string, bytes: Buffer, run: typeof spawn = spawn): Promise<PrintResult> {
  return new Promise((resolve) => {
    let err = '';
    let settled = false;
    const done = (r: PrintResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = run('lp', ['-d', printer, '-t', 'WorkSuite label'], { stdio: ['pipe', 'ignore', 'pipe'], shell: false, windowsHide: true });
    } catch (e) {
      done({ ok: false, reason: e instanceof Error ? e.message : String(e) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, reason: 'The printer did not answer in time.' });
    }, 20_000);
    child.stderr?.on('data', (d: Buffer) => {
      if (err.length < 2000) err += String(d);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'lp is not available on this computer.' : e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0 ? { ok: true } : { ok: false, reason: err.trim().split('\n').pop() || `lp exited with ${code}` });
    });
    child.stdin?.end(bytes);
  });
}

export class SalesDesk {
  private readonly saved = new Set<string>();
  private readonly approvals: ApprovalBanners;

  constructor(private readonly d: SalesDeskDeps) {
    this.approvals = new ApprovalBanners({
      post: (path, body) => d.http.post(path, body),
      notify: (n) => d.notify(n),
      markRead: (ids) => d.markRead(ids),
      enabled: () => d.enabled(),
      open: (route) => d.open(route),
      refreshCounts: () => d.refreshCounts(),
      toast: (kind, text) => {
        if (kind === 'error') log.debug('approve from a banner failed', { text: text.slice(0, 200) });
        d.toast(kind, text);
      },
    });
  }

  // ── approvals (shared/sales.ts ApprovalBanners) ─────────────────────────

  /** True when the notification is an approval waiting on me, now shown here with Approve and Open. */
  claim(n: ClaimedNotice): boolean {
    return this.approvals.claim(n);
  }

  /** The realtime events that change the approval count. */
  handle(e: { type?: string }): void {
    this.approvals.handle(e);
  }

  // ── printers ───────────────────────────────────────────────────────────

  private all(): Stored {
    const v = this.d.config.getConfig<Stored>(KEY);
    return v && typeof v === 'object' ? v : {};
  }

  settings(): SalesPrintSettings {
    const o = this.d.origin();
    return { ...DEFAULT_SALES_PRINT, ...(o ? this.all()[o] : undefined) };
  }

  /** Change them. A printer named must be one this computer has. */
  update(patch: SalesPrintPatch, installed: string[]): SalesPrintSettings {
    const o = this.d.origin();
    if (!o) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    for (const k of ['note_printer', 'label_printer'] as const) {
      const name = patch[k];
      if (name && !installed.includes(name)) throw new DesktopError('NOT_FOUND', `There is no printer called “${name}” on this computer.`);
    }
    const next: SalesPrintSettings = { ...this.settings(), ...patch } as SalesPrintSettings;
    this.d.config.setConfig(KEY, { ...this.all(), [o]: next });
    return next;
  }

  forgetAll(): void {
    this.d.config.deleteConfig(KEY);
  }

  private gone(printer: string, kind: string): SalesPrintOutcome {
    return { ok: false, printer, via: null, message: `The ${kind} printer “${printer}” is not on this computer any more. Choose another in Sales › Settings › Printers.` };
  }

  /** A delivery note on the delivery-note printer, laid out from Inventory's record of it. */
  async printNote(deliveryId: number, installed: string[], copies = 1): Promise<SalesPrintOutcome> {
    const s = this.settings();
    const printer = s.note_printer;
    if (printer && !installed.includes(printer)) return this.gone(printer, 'delivery-note');
    const got = await this.d.http.get<{ delivery?: DeliveryRecord & { so_id?: number | null }; lines?: DeliveryLineRecord[] }>(`/api/inventory/deliveries/${deliveryId}`);
    const note = got?.delivery;
    if (!note?.dn_number) throw new DesktopError('NOT_FOUND', 'Inventory did not send that delivery note.');
    let order: { number?: string; client?: string | null } | null = null;
    if (note.so_id) order = await this.d.http.get<{ order?: { number?: string; client?: string | null } }>(`/api/oms/orders/${note.so_id}`).then((r) => r?.order ?? null, () => null);
    const html = deliveryNoteHtml({ ...note, so_number: note.so_number ?? order?.number ?? null, client_name: note.client_name ?? order?.client ?? null }, got.lines ?? [], { printedAt: (this.d.now?.() ?? new Date()).toISOString().slice(0, 16).replace('T', ' ') });
    const silent = s.silent && !!printer;
    const r = await (this.d.print ?? printInWindow)({ html, paper: 'a4', deviceName: printer, silent, copies });
    if (r.ok) return { ok: true, printer, via: 'page', message: printer ? `${note.dn_number} sent to ${printer}.` : `${note.dn_number} printed.` };
    return { ok: false, printer, via: 'page', message: r.reason === 'cancelled' ? 'Printing was cancelled.' : `It could not be printed: ${r.reason}.` };
  }

  /** A shipment's label on the label printer: raw ZPL, or the server's PDF. */
  async printLabel(shipmentId: number, installed: string[], o: { reason?: string; format?: LabelFormat } = {}): Promise<SalesPrintOutcome> {
    const s = this.settings();
    const format = o.format ?? s.label_format;
    const printer = s.label_printer;
    if (!printer) return { ok: false, printer: null, via: null, message: 'Choose the label printer in Sales › Settings › Printers.' };
    if (!installed.includes(printer)) return this.gone(printer, 'label');
    const res = await this.d.http.raw('GET', this.d.http.url(labelPath(shipmentId, format, o.reason)), { headers: { Accept: format === 'zpl' ? 'text/plain, application/zpl, */*' : 'application/pdf' } });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, printer, via: null, message: body?.message ?? `WorkSuite did not send the label (${res.status}).` };
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_LABEL) return { ok: false, printer, via: null, message: 'The label WorkSuite sent is too large to print.' };
    if (format === 'zpl') {
      if (!looksLikeZpl(bytes.toString('latin1'))) return { ok: false, printer, via: 'raw', message: 'WorkSuite did not send ZPL for this label. Print it as PDF instead (Settings › Printers).' };
      const r = await (this.d.raw ?? ((p: string, b: Buffer) => sendRaw(p, b)))(printer, bytes);
      return r.ok ? { ok: true, printer, via: 'raw', message: `Label sent to ${printer}.` } : { ok: false, printer, via: 'raw', message: `The label did not print: ${r.reason}` };
    }
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, printer, via: 'pdf', message: 'WorkSuite did not send a PDF for this label.' };
    if ((this.d.platform ?? process.platform) === 'win32' && !this.d.pdf) {
      // Windows has no path for a PDF to a printer without a viewer: saved and opened, to print from there.
      const path = join(this.d.temp(), `label-${shipmentId}.pdf`);
      await writeFile(path, bytes);
      await this.d.openPath(path);
      return { ok: true, printer, via: 'pdf', message: 'The label is open to print — Windows cannot print a PDF silently.', opened: path };
    }
    const r = await (this.d.pdf ?? ((p: string, b: Buffer) => sendPdf(p, b)))(printer, bytes);
    return r.ok ? { ok: true, printer, via: 'pdf', message: `Label sent to ${printer}.` } : { ok: false, printer, via: 'pdf', message: `The label did not print: ${r.reason}` };
  }

  // ── reports ────────────────────────────────────────────────────────────

  /** The report as the server's PDF, where the person chooses. Null when they cancel. */
  async saveReport(r: SalesSaveReport, sender: WebContents): Promise<string | null> {
    const name = `${safeFileName(r.name, 'report').replace(/\.pdf$/i, '')}.pdf`;
    const path = await this.d.saveDialog(sender, join(this.d.documents(), name));
    if (!path) return null;
    const res = await this.d.http.raw('GET', this.d.http.url(reportExportPath(r, 'pdf')), { headers: { Accept: 'application/pdf' } });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('pdf')) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new DesktopError('SERVER_ERROR', body?.message ?? 'WorkSuite did not send the report as a PDF.', res.status);
    }
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    this.saved.add(path);
    return path;
  }

  /** Show a report this process saved in its folder; nothing else. */
  revealSaved(path: string): boolean {
    if (!this.saved.has(path)) return false;
    this.d.reveal(path);
    return true;
  }

  register(router: IpcRouter): void {
    router.handle('sales:printSettings', () => this.settings());
    router.handle('sales:printSettingsSet', async (input, c) => this.update(input, await this.d.printers(c.sender)));
    router.handle('sales:printNote', async (input, c) => this.printNote(input.delivery_id, await this.d.printers(c.sender), input.copies ?? 1));
    router.handle('sales:printLabel', async (input, c) => this.printLabel(input.shipment_id, await this.d.printers(c.sender), { reason: input.reason, format: input.format }));
    router.handle('sales:saveReport', (input, c) => this.saveReport(input, c.sender));
    router.handle('sales:reveal', (input) => this.revealSaved(input.path));
  }
}
