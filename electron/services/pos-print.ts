import { saleFlags, type PosPrintOutcome, type PosPrintPatch, type PosPrintSettings, type PosReport, type PosSale, type PosServerReceipt } from '@shared/pos';
import { DesktopError } from '../main/errors';
import { drawerPulse, printInWindow, sendRaw, type PrintJob, type PrintResult } from './salon-print';

/**
 * POS receipts, reports and the cash drawer (the counter's thermal printer).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SILENT, AND ONLY TO THE TILL'S OWN PRINTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A till prints a receipt with every sale, so no dialog is asked each time: the receipt goes to the printer this
 * computer was set up with, in one of two ways —
 *
 *  - `escpos`: the receipt as ESC/POS bytes, raw, through CUPS (`lp -o raw`) or the Windows spooler (salon-print.ts's
 *    `sendRaw`, no shell, the printer's name never on a command line a shell reads). Fast, and the drawer's pulse goes
 *    in the same job. ESC/POS prints its code page, so text is reduced to plain Latin (a Sinhala or Tamil name prints
 *    as "?"); a shop that needs those scripts uses the driver.
 *  - `driver`: the receipt laid out as a page — every character escaped, no script, no network, the salon's hidden
 *    print window — and printed silently through the printer's own driver; the drawer is pulsed after it.
 *
 * A reprint is WorkSuite's receipt (`device/sales/{ref}/receipt`: its figures after pricing an offline sale again, its
 * order and invoice numbers, refunds and a void) where the server has it; otherwise, and for the receipt printed as the
 * sale completes, the till's own record of the sale (pos-till.ts): WorkSuite's figures when it priced the cart, the
 * catalogue's preview — marked "provisional" — when it could not be reached. A sale WorkSuite recorded with its payment
 * missing (the till sent no tenders: `status: payment_missing`) prints a "Payment missing" line for the total.
 * Settings are this computer's, filed under the server (which printers are plugged in is a fact about this computer);
 * a wipe forgets them.
 */
const KEY = 'pos-print';

export const DEFAULT_POS_PRINT: PosPrintSettings = {
  receipt_printer: null,
  paper: '80mm',
  mode: 'escpos',
  copies: 1,
  auto_print: true,
  drawer: 'off',
  drawer_pin: 2,
  header: '',
  footer: 'Thank you',
};

/** Characters on a line in the printer's Font A: 576 dots on an 80 mm roll, 384 on 58 mm. */
export const COLUMNS: Record<PosPrintSettings['paper'], number> = { '80mm': 48, '58mm': 32 };

/* ── A receipt, as rows ─────────────────────────────────────────────── */

export type ReceiptRow =
  | { kind: 'text'; text: string; align?: 'left' | 'center'; bold?: boolean; big?: boolean }
  | { kind: 'pair'; left: string; right: string; bold?: boolean }
  | { kind: 'rule' };

const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', wallet: 'Wallet' };

export function money(v: number, currency?: string | null): string {
  const s = (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

function stampOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const lines = (t: string): string[] =>
  t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);

/** A sale's receipt: the shop's lines, the sale, its lines, the totals, how it was paid. */
export function receiptRows(sale: PosSale, s: Pick<PosPrintSettings, 'header' | 'footer'>, o: { till: string | null; reprint?: boolean } = { till: null }): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  for (const l of lines(s.header)) rows.push({ kind: 'text', text: l, align: 'center', bold: rows.length === 0 });
  if (o.reprint) rows.push({ kind: 'text', text: '*** COPY ***', align: 'center', bold: true });
  rows.push({ kind: 'rule' });
  rows.push({ kind: 'pair', left: 'Receipt', right: sale.ref });
  if (sale.number) rows.push({ kind: 'pair', left: 'Order', right: sale.number });
  rows.push({ kind: 'pair', left: stampOf(sale.created_at), right: o.till ?? '' });
  if (sale.cashier_name) rows.push({ kind: 'pair', left: 'Cashier', right: sale.cashier_name });
  if (sale.customer?.name) rows.push({ kind: 'pair', left: 'Customer', right: sale.customer.name });
  rows.push({ kind: 'rule' });
  for (const l of sale.lines) {
    rows.push({ kind: 'text', text: l.name });
    rows.push({ kind: 'pair', left: `  ${qty(l.quantity)} x ${money(l.unit_price)}${l.discount_pct ? ` -${l.discount_pct}%` : ''}`, right: money(l.net) });
  }
  rows.push({ kind: 'rule' });
  rows.push({ kind: 'pair', left: 'Subtotal', right: money(sale.totals.subtotal) });
  if (sale.totals.discount) rows.push({ kind: 'pair', left: `Discount${sale.discount_pct ? ` ${sale.discount_pct}%` : ''}`, right: `-${money(sale.totals.discount)}` });
  rows.push({ kind: 'pair', left: 'Tax', right: money(sale.totals.tax) });
  rows.push({ kind: 'pair', left: 'TOTAL', right: money(sale.totals.total, sale.currency), bold: true });
  rows.push({ kind: 'rule' });
  for (const t of sale.tenders) rows.push({ kind: 'pair', left: `${METHOD[t.method] ?? t.method}${t.reference ? ` (${t.reference})` : ''}`, right: money(t.amount) });
  if (sale.change_given) rows.push({ kind: 'pair', left: 'Change', right: money(sale.change_given), bold: true });
  if (!sale.tenders.length || saleFlags(sale).includes('payment_missing')) rows.push({ kind: 'pair', left: 'Payment missing', right: money(sale.totals.total), bold: true });
  if (sale.priced_by === 'estimate') {
    rows.push({ kind: 'rule' });
    rows.push({ kind: 'text', text: 'Provisional: priced offline. WorkSuite confirms the figures.', align: 'center' });
  }
  const foot = lines(s.footer);
  if (foot.length) rows.push({ kind: 'rule' });
  for (const l of foot) rows.push({ kind: 'text', text: l, align: 'center' });
  return rows;
}

const STATUS: Record<string, string> = { payment_missing: '*** PAYMENT MISSING ***', voided: '*** VOIDED ***', refunded: '*** REFUNDED ***', part_refunded: '*** PART REFUNDED ***' };

/** WorkSuite's receipt for a sale (`Receipt::data`), laid out the same way; the till's header and footer around it. */
export function serverReceiptRows(r: PosServerReceipt, s: Pick<PosPrintSettings, 'header' | 'footer'>, o: { till: string | null; reprint?: boolean } = { till: null }): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  const head = lines(s.header);
  if (head.length) for (const l of head) rows.push({ kind: 'text', text: l, align: 'center', bold: rows.length === 0 });
  else if (r.company.name) {
    rows.push({ kind: 'text', text: r.company.name, align: 'center', bold: true });
    for (const l of [r.company.address, r.company.phone, r.company.tax_number ? `Tax no. ${r.company.tax_number}` : null]) if (l) rows.push({ kind: 'text', text: l, align: 'center' });
  }
  if (o.reprint) rows.push({ kind: 'text', text: '*** COPY ***', align: 'center', bold: true });
  if (STATUS[r.status]) rows.push({ kind: 'text', text: STATUS[r.status]!, align: 'center', bold: true });
  rows.push({ kind: 'rule' });
  rows.push({ kind: 'pair', left: 'Receipt', right: r.receipt_no });
  if (r.invoice_number) rows.push({ kind: 'pair', left: 'Invoice', right: r.invoice_number });
  else if (r.order_number) rows.push({ kind: 'pair', left: 'Order', right: r.order_number });
  rows.push({ kind: 'pair', left: r.at ?? '', right: o.till ?? r.register ?? '' });
  if (r.cashier) rows.push({ kind: 'pair', left: 'Cashier', right: r.cashier });
  if (r.customer?.name) rows.push({ kind: 'pair', left: 'Customer', right: r.customer.name });
  rows.push({ kind: 'rule' });
  for (const l of r.lines) {
    rows.push({ kind: 'text', text: l.description });
    rows.push({ kind: 'pair', left: `  ${qty(l.quantity)} x ${money(l.unit_price)}${l.discount_pct ? ` -${l.discount_pct}%` : ''}`, right: money(l.amount) });
  }
  rows.push({ kind: 'rule' });
  rows.push({ kind: 'pair', left: 'Subtotal', right: money(r.totals.subtotal) });
  if (r.totals.discount) rows.push({ kind: 'pair', left: 'Discount', right: `-${money(r.totals.discount)}` });
  if (r.taxes.length) for (const t of r.taxes) rows.push({ kind: 'pair', left: `Tax ${t.name}`, right: money(t.amount) });
  else rows.push({ kind: 'pair', left: 'Tax', right: money(r.totals.tax) });
  rows.push({ kind: 'pair', left: 'TOTAL', right: money(r.totals.total, r.currency), bold: true });
  rows.push({ kind: 'rule' });
  for (const t of r.tenders) rows.push({ kind: 'pair', left: `${t.label}${t.reference ? ` (${t.reference})` : ''}`, right: money(t.amount) });
  if (r.change) rows.push({ kind: 'pair', left: 'Change', right: money(r.change), bold: true });
  // Nothing was taken as far as WorkSuite knows (the till sent no tenders) until Billing records the payment.
  if (r.payment_missing || r.status === 'payment_missing') rows.push({ kind: 'pair', left: 'Payment missing', right: money(r.totals.total), bold: true });
  if (r.refunds.length) {
    rows.push({ kind: 'rule' });
    for (const x of r.refunds) rows.push({ kind: 'pair', left: `${x.kind === 'void' ? 'Void' : 'Refund'} ${x.ref}`, right: `-${money(x.amount)}` });
    if (r.void_reason) rows.push({ kind: 'text', text: r.void_reason });
  }
  const foot = lines(s.footer || r.footer);
  if (foot.length) rows.push({ kind: 'rule' });
  for (const l of foot) rows.push({ kind: 'text', text: l, align: 'center' });
  return rows;
}

/** An X or Z report, or any summary the screens made from WorkSuite's figures. */
export function reportRows(r: PosReport, s: Pick<PosPrintSettings, 'header'>): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  for (const l of lines(s.header)) rows.push({ kind: 'text', text: l, align: 'center', bold: rows.length === 0 });
  rows.push({ kind: 'text', text: r.title, align: 'center', bold: true, big: true });
  if (r.subtitle) rows.push({ kind: 'text', text: r.subtitle, align: 'center' });
  rows.push({ kind: 'rule' });
  for (const x of r.rows) rows.push('rule' in x ? { kind: 'rule' } : { kind: 'pair', left: x.label, right: x.value, bold: x.strong });
  return rows;
}

/* ── ESC/POS ─────────────────────────────────────────────────────────── */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const PLAIN: Record<string, string> = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '×': 'x', '•': '*', '…': '...', ' ': ' ' };

/** Text as a receipt printer's code page takes it: plain Latin, accents dropped, anything else "?". */
export function plain(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, (c) => PLAIN[c] ?? '?');
}

/** Two columns on one line: the left cut short if it must, the right kept whole. */
export function pairLine(left: string, right: string, width: number): string {
  const r = right.slice(0, width);
  const room = Math.max(0, width - r.length - 1);
  const l = left.length > room ? left.slice(0, room) : left;
  return l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r;
}

function wrap(t: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
    while (line.length > width) {
      out.push(line.slice(0, width));
      line = line.slice(width);
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/**
 * The receipt as ESC/POS bytes: initialise, the code page, the rows (alignment and emphasis as commands, text as
 * ASCII), the drawer's pulse when asked (first, so the drawer opens while it prints), a feed and a partial cut.
 */
export function escpos(rows: ReceiptRow[], width: number, o: { pulse?: Buffer | null; copies?: number } = {}): Buffer {
  const one: number[] = [];
  const push = (...b: number[]) => one.push(...b);
  const text = (t: string) => one.push(...Buffer.from(plain(t), 'latin1'), LF);
  for (const r of rows) {
    if (r.kind === 'rule') {
      push(ESC, 0x61, 0);
      text('-'.repeat(width));
    } else if (r.kind === 'pair') {
      push(ESC, 0x61, 0);
      if (r.bold) push(ESC, 0x45, 1);
      text(pairLine(plain(r.left), plain(r.right), width));
      if (r.bold) push(ESC, 0x45, 0);
    } else {
      push(ESC, 0x61, r.align === 'center' ? 1 : 0);
      if (r.bold) push(ESC, 0x45, 1);
      if (r.big) push(GS, 0x21, 0x11);
      for (const l of wrap(plain(r.text), r.big ? Math.floor(width / 2) : width)) text(l);
      if (r.big) push(GS, 0x21, 0x00);
      if (r.bold) push(ESC, 0x45, 0);
    }
  }
  push(ESC, 0x61, 0, ESC, 0x64, 4, GS, 0x56, 0x42, 0x00);
  const init = [ESC, 0x40, ESC, 0x74, 0x00];
  const copies = Math.min(3, Math.max(1, o.copies ?? 1));
  const parts: Buffer[] = [Buffer.from(init)];
  if (o.pulse) parts.push(o.pulse);
  for (let i = 0; i < copies; i++) parts.push(Buffer.from(one));
  return Buffer.concat(parts);
}

/* ── The same receipt as a page (the driver) ────────────────────────── */

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function receiptHtml(rows: ReceiptRow[], paper: PosPrintSettings['paper']): string {
  const w = paper === '58mm' ? 219 : 302;
  const body = rows
    .map((r) => {
      if (r.kind === 'rule') return '<hr>';
      if (r.kind === 'pair') return `<div class="p${r.bold ? ' b' : ''}"><span>${esc(r.left)}</span><span>${esc(r.right)}</span></div>`;
      return `<div class="${[r.align === 'center' ? 'c' : '', r.bold ? 'b' : '', r.big ? 'g' : ''].join(' ').trim()}">${esc(r.text)}</div>`;
    })
    .join('');
  return `<style>body{margin:0;width:${w}px;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#000}div{padding:0 6px;overflow-wrap:anywhere}.p{display:flex;justify-content:space-between;gap:8px}.p span:last-child{white-space:nowrap}.c{text-align:center}.b{font-weight:700}.g{font-size:16px}hr{border:0;border-top:1px dashed #000;margin:4px 6px}</style></head><body>${body}</body></html>`;
}

/* ── The service ─────────────────────────────────────────────────────── */

export interface PosPrintDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  origin: () => string | null;
  print?: (job: PrintJob) => Promise<PrintResult>;
  raw?: (printer: string, bytes: Buffer) => Promise<PrintResult>;
}

type Stored = Record<string, PosPrintSettings>;

export class PosPrint {
  private readonly print: (job: PrintJob) => Promise<PrintResult>;
  private readonly raw: (printer: string, bytes: Buffer) => Promise<PrintResult>;

  constructor(private readonly d: PosPrintDeps) {
    this.print = d.print ?? printInWindow;
    this.raw = d.raw ?? ((p, b) => sendRaw(p, b));
  }

  private all(): Stored {
    const v = this.d.config.getConfig<Stored>(KEY);
    return v && typeof v === 'object' ? v : {};
  }

  settings(): PosPrintSettings {
    const o = this.d.origin();
    return { ...DEFAULT_POS_PRINT, ...(o ? this.all()[o] : undefined) };
  }

  /** Change them. A printer named must be one this computer has. */
  update(patch: PosPrintPatch, installed: string[]): PosPrintSettings {
    const o = this.d.origin();
    if (!o) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    if (patch.receipt_printer && !installed.includes(patch.receipt_printer)) throw new DesktopError('NOT_FOUND', `There is no printer called “${patch.receipt_printer}” on this computer.`);
    const next = { ...this.settings(), ...patch };
    this.d.config.setConfig(KEY, { ...this.all(), [o]: next });
    return next;
  }

  forgetAll(): void {
    this.d.config.deleteConfig(KEY);
  }

  private async out(rows: ReceiptRow[], installed: string[], o: { kick?: boolean; copies?: number } = {}): Promise<PosPrintOutcome> {
    const s = this.settings();
    const printer = s.receipt_printer;
    if (printer && !installed.includes(printer)) return { ok: false, printer, message: `The printer “${printer}” is not on this computer any more. Choose another in Printers.` };
    const pulse = o.kick && s.drawer === 'printer' && printer ? drawerPulse(s.drawer_pin) : null;
    const copies = o.copies ?? s.copies;
    if (s.mode === 'escpos') {
      if (!printer) return { ok: false, printer, message: 'Choose the receipt printer in Printers: ESC/POS goes straight to it.' };
      const r = await this.raw(printer, escpos(rows, COLUMNS[s.paper], { pulse, copies }));
      return r.ok ? { ok: true, printer, message: `Sent to ${printer}.` } : { ok: false, printer, message: `It could not be printed: ${r.reason}` };
    }
    const r = await this.print({ html: receiptHtml(rows, s.paper), paper: s.paper, deviceName: printer, silent: !!printer, copies });
    if (pulse && printer) await this.raw(printer, pulse);
    if (r.ok) return { ok: true, printer, message: printer ? `Sent to ${printer}.` : 'Printed.' };
    return { ok: false, printer, message: r.reason === 'cancelled' ? 'Printing was cancelled.' : `It could not be printed: ${r.reason}.` };
  }

  /** A sale's receipt; the drawer opens with it when cash was taken. */
  receipt(sale: PosSale, installed: string[], o: { till: string | null; reprint?: boolean; kick?: boolean }): Promise<PosPrintOutcome> {
    const s = this.settings();
    return this.out(receiptRows(sale, s, { till: o.till, reprint: o.reprint }), installed, { kick: o.kick, copies: o.reprint ? 1 : s.copies });
  }

  /** WorkSuite's receipt for a sale (a reprint). */
  serverReceipt(r: PosServerReceipt, installed: string[], o: { till: string | null; reprint?: boolean }): Promise<PosPrintOutcome> {
    return this.out(serverReceiptRows(r, this.settings(), o), installed, { copies: o.reprint ? 1 : this.settings().copies });
  }

  report(r: PosReport, installed: string[]): Promise<PosPrintOutcome> {
    return this.out(reportRows(r, this.settings()), installed, { copies: 1 });
  }

  test(installed: string[]): Promise<PosPrintOutcome> {
    const s = this.settings();
    const rows: ReceiptRow[] = [
      ...lines(s.header).map((t): ReceiptRow => ({ kind: 'text', text: t, align: 'center', bold: true })),
      { kind: 'text', text: 'WorkSuite POS test receipt', align: 'center', bold: true },
      { kind: 'rule' },
      { kind: 'pair', left: 'Paper', right: s.paper },
      { kind: 'pair', left: 'Mode', right: s.mode === 'escpos' ? 'ESC/POS' : 'Printer driver' },
      { kind: 'pair', left: '1234567890'.repeat(3), right: 'right' },
      { kind: 'rule' },
      { kind: 'text', text: 'If both edges of the ruled lines are on the paper, the roll width is right.', align: 'center' },
    ];
    return this.out(rows, installed, { copies: 1 });
  }

  /** Open the drawer, through the receipt printer. */
  async drawer(installed: string[]): Promise<PosPrintOutcome> {
    const s = this.settings();
    const printer = s.receipt_printer;
    if (s.drawer !== 'printer') return { ok: false, printer, message: 'No cash drawer is set up on this computer.' };
    if (!printer) return { ok: false, printer, message: 'Choose the receipt printer the drawer is plugged into.' };
    if (!installed.includes(printer)) return { ok: false, printer, message: `The printer “${printer}” is not on this computer any more.` };
    const r = await this.raw(printer, drawerPulse(s.drawer_pin));
    return r.ok ? { ok: true, printer, message: 'Drawer opened.' } : { ok: false, printer, message: `The drawer did not open: ${r.reason}` };
  }
}
