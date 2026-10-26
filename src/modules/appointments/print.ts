import { call } from '../../core/bridge';
import { money, type Appointment } from './api';

/**
 * What the desk prints (D13 receipt, D12 deposit receipt, D23 day sheets), through the desktop's one print service
 * (`print:print` / `print:toPdf`, electron/services/print.ts): a hidden window with no script and no network lays the
 * page out; the OS dialog gives the preview and the printer. Every figure on a receipt is one the server sent back.
 *
 * Desk settings (D20) are this computer's: which location this desk is, its printers and paper, its alerts. They are
 * conveniences, not records, so they live in this window's storage and fall back to defaults when it is empty.
 */

export interface DeskSettings {
  location: number | null;
  receiptPrinter: string | null;
  a4Printer: string | null;
  paper: '80mm' | '58mm';
  autoPrint: boolean;
  alertLate: boolean;
}

export const DEFAULT_DESK: DeskSettings = { location: null, receiptPrinter: null, a4Printer: null, paper: '80mm', autoPrint: true, alertLate: true };
const KEY = 'ws.appointments.desk';

export function readDesk(): DeskSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_DESK, ...(JSON.parse(raw) as Partial<DeskSettings>) } : DEFAULT_DESK;
  } catch {
    return DEFAULT_DESK;
  }
}

export function writeDesk(s: DeskSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage off: the settings last this session */
  }
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface ReceiptLine { label: string; amount: string }
export interface Receipt {
  business: string;
  location: string;
  invoice: string | null;
  at: string;
  client: string;
  servedBy: string;
  lines: ReceiptLine[];
  totals: ReceiptLine[];
  payment: ReceiptLine | null;
  footer?: string;
}

/** The 80 mm (or 58 mm) roll receipt. */
export function receiptHtml(r: Receipt, paper: DeskSettings['paper'] = '80mm'): string {
  const w = paper === '58mm' ? '54mm' : '72mm';
  const row = (l: ReceiptLine, bold = false) => `<tr${bold ? ' class="b"' : ''}><td>${esc(l.label)}</td><td class="r">${esc(l.amount)}</td></tr>`;
  return `<style>@page{size:${paper === '58mm' ? '58mm' : '80mm'} auto;margin:3mm}body{font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;width:${w};margin:0;color:#000}
h1{font-size:13px;text-align:center;margin:0}p{margin:0}.c{text-align:center}.r{text-align:right}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}
.b td{font-weight:700}hr{border:0;border-top:1px dashed #000;margin:4px 0}</style>
<h1>${esc(r.business)}</h1><p class="c">${esc(r.location)}</p><hr>
<p>${esc(r.invoice ?? '')}<span style="float:right">${esc(r.at)}</span></p><p>Client: ${esc(r.client)}</p><p>Served by: ${esc(r.servedBy)}</p><hr>
<table>${r.lines.map((l) => row(l)).join('')}</table><hr>
<table>${r.totals.map((l, i) => row(l, i === r.totals.length - 1 || /total|to pay/i.test(l.label))).join('')}${r.payment ? row(r.payment, true) : ''}</table><hr>
<p class="c">${esc(r.footer ?? 'Thank you')}</p>`;
}

/** The deposit's own slip (D12 "Print a deposit receipt"). */
export function depositHtml(a: Appointment, amount: number, currency: string, method: string, reference: string | null, paper: DeskSettings['paper']): string {
  return receiptHtml(
    {
      business: a.location.name,
      location: `${a.number} · ${a.local.date ?? ''} ${a.local.start ?? ''}`,
      invoice: 'DEPOSIT',
      at: new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
      client: a.customer.name,
      servedBy: a.provider.name,
      lines: [{ label: a.service.name, amount: '' }],
      totals: [{ label: 'Deposit received', amount: money(amount, currency) }],
      payment: { label: method + (reference ? ` · ${reference}` : ''), amount: money(amount) },
      footer: 'Held against the appointment. Thank you',
    },
    paper,
  );
}

export interface SheetOptions { notes: boolean; internal: boolean; phones: boolean; printedBy: string }

/** One A4 page per stylist (D23). */
export function daySheetHtml(location: string, date: string, groups: Array<{ provider: string; rows: Appointment[]; pinned?: Record<number, string> }>, o: SheetOptions): string {
  const page = (g: (typeof groups)[number]) => {
    const minutes = g.rows.reduce((s, a) => s + (a.duration_min || 0), 0);
    const rows = g.rows
      .map((a) => {
        const note = [o.notes && g.pinned?.[a.customer.id] ? `Note: ${g.pinned[a.customer.id]}` : '', o.internal && a.internal_notes ? a.internal_notes : '', a.notes ?? ''].filter(Boolean).map(esc).join('<br>');
        return `<tr><td class="t">${esc(a.local.start)}–${esc(a.local.end)}</td><td><b>${esc(a.customer.name)}</b>${o.phones && a.customer.phone ? ` · ${esc(a.customer.phone)}` : ''}<br>${esc(a.service.name)} · ${esc(a.status_label)}${note ? `<div class="n">${note}</div>` : ''}</td><td class="box"></td></tr>`;
      })
      .join('');
    return `<section><h1>${esc(g.provider)}</h1><p>${esc(date)} · ${esc(location)} · ${g.rows.length} appointment${g.rows.length === 1 ? '' : 's'} · ${Math.floor(minutes / 60)} h ${minutes % 60} min booked</p>
<table>${rows || '<tr><td colspan="3">Nothing booked.</td></tr>'}</table><footer>Printed ${esc(new Date().toLocaleString('en-GB'))} by ${esc(o.printedBy)} · WorkSuite Appointments</footer></section>`;
  };
  return `<style>@page{size:A4;margin:14mm}body{font:12px/1.4 system-ui,sans-serif;color:#000}section{page-break-after:always;min-height:260mm;position:relative}section:last-child{page-break-after:auto}
h1{font-size:20px;margin:0 0 2px}p{margin:0 0 10px;color:#333}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ccc;padding:7px 4px;vertical-align:top}.t{width:90px;font-weight:700;white-space:nowrap}
.box{width:18px;border:1px solid #999}.n{margin-top:3px;font-size:11px;color:#444}footer{position:absolute;bottom:0;font-size:10px;color:#666}</style>${groups.map(page).join('')}`;
}

export async function printPage(html: string, title: string, printer: string | null): Promise<boolean> {
  return call('print:print', { html, title, ...(printer ? { deviceName: printer } : {}) });
}

export async function savePdf(html: string, title: string): Promise<string | null> {
  return call('print:toPdf', { html, title });
}

export async function printers(): Promise<Array<{ name: string; displayName: string; isDefault: boolean }>> {
  try {
    return await call('print:printers');
  } catch {
    return [];
  }
}
