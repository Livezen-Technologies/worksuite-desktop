import qrcode from 'qrcode-generator';
import { code128Encodable, code128Svg } from '@shared/code128';
import { saleFlags, saleReductions, serverReductions, vatRows, type PosPrintOutcome, type PosReduction, type PosPrintPatch, type PosPrintSettings, type PosReceiptBlock, type PosReceiptTemplate, type PosReport, type PosSale, type PosServerReceipt } from '@shared/pos';
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COMPANY'S RECEIPT TEMPLATE (Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Where the company published a receipt template (the till's door: `GET receipt-template`, and every receipt's
 * `template`), the receipt walks its blocks in their order with the server's own words (`Receipt::designed`): the
 * company and address, header lines, tax numbers, the details, the customer and tier, the lines, totals, tax by rate,
 * payments and change, points, refunds, the footer in each language, and the receipt number as a Code 128 barcode or a
 * QR code — at the template's paper width (58 or 80 mm; A4 keeps the printer's). Its fields (`{receipt_no}`,
 * `{points}`…) are filled from the receipt; one it does not have prints as nothing. The logo is not printed (ESC/POS
 * would need it rastered). Without a template the receipt is exactly what it always was, byte for byte.
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
  | { kind: 'rule' }
  /** The receipt number as a Code 128 barcode (scanned back for a return), its digits printed under it. */
  | { kind: 'barcode'; text: string }
  /** A QR code (a template's `barcode` block, `format: qr`), its text printed under it. */
  | { kind: 'qr'; text: string };

const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', wallet: 'Wallet', qr: 'QR payment', voucher: 'Gift voucher', store_credit: 'Store credit', account: 'On account' };

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
  // The coupon, the promotions, the points and the cashier's discount (with its reason), each its own line (#293).
  pushReductions(rows, saleReductions(sale));
  // The tax by rate ("VAT 18%"), from the lines WorkSuite (or the preview) priced.
  for (const v of vatRows(sale.lines, sale.totals.tax)) rows.push({ kind: 'pair', left: v.label, right: money(v.amount) });
  rows.push({ kind: 'pair', left: 'TOTAL', right: money(sale.totals.total, sale.currency), bold: true });
  rows.push({ kind: 'rule' });
  for (const t of sale.tenders) rows.push({ kind: 'pair', left: `${METHOD[t.method] ?? t.method}${t.reference ? ` (${t.reference})` : ''}`, right: money(t.amount) });
  if (sale.change_given) rows.push({ kind: 'pair', left: 'Change', right: money(sale.change_given), bold: true });
  if (!sale.tenders.length || saleFlags(sale).includes('payment_missing')) rows.push({ kind: 'pair', left: 'Payment missing', right: money(sale.totals.total), bold: true });
  if (sale.loyalty && (sale.loyalty.earned || sale.loyalty.balance != null)) {
    rows.push({ kind: 'rule' });
    if (sale.loyalty.earned) rows.push({ kind: 'pair', left: 'Points earned', right: String(sale.loyalty.earned) });
    if (sale.loyalty.balance != null) rows.push({ kind: 'pair', left: 'Points balance', right: String(sale.loyalty.balance) });
  }
  if (sale.priced_by === 'estimate') {
    rows.push({ kind: 'rule' });
    rows.push({ kind: 'text', text: 'Provisional: priced offline. WorkSuite confirms the figures.', align: 'center' });
  }
  const foot = lines(s.footer);
  if (foot.length) rows.push({ kind: 'rule' });
  for (const l of foot) rows.push({ kind: 'text', text: l, align: 'center' });
  if (code128Encodable(sale.ref)) rows.push({ kind: 'barcode', text: sale.ref });
  return rows;
}

/** The discount lines under the subtotal: each with its amount, a reason on the line below. */
function pushReductions(rows: ReceiptRow[], list: PosReduction[]): void {
  for (const x of list) {
    rows.push({ kind: 'pair', left: x.label, right: `-${money(x.amount)}` });
    if (x.note) rows.push({ kind: 'text', text: `  ${x.note}` });
  }
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
  pushReductions(rows, serverReductions(r));
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
  if (r.loyalty && (r.loyalty.earned || r.loyalty.balance != null)) {
    rows.push({ kind: 'rule' });
    if (r.loyalty.earned) rows.push({ kind: 'pair', left: 'Points earned', right: String(r.loyalty.earned) });
    if (r.loyalty.balance != null) rows.push({ kind: 'pair', left: 'Points balance', right: String(r.loyalty.balance) });
  }
  const foot = lines(s.footer || r.footer);
  if (foot.length) rows.push({ kind: 'rule' });
  for (const l of foot) rows.push({ kind: 'text', text: l, align: 'center' });
  if (code128Encodable(r.receipt_no)) rows.push({ kind: 'barcode', text: r.receipt_no });
  return rows;
}

/* ── A receipt by the company's template ────────────────────────────── */

/** A receipt as data, whichever record it prints from — the till's own sale, or WorkSuite's receipt. */
export interface ReceiptDoc {
  company: { name: string; address: string | null; phone: string | null; email: string | null; tax_number: string | null; registration: string | null };
  receipt_no: string;
  invoice_no: string | null;
  order_no: string | null;
  at: string;
  till: { code: string; name: string } | null;
  cashier: string | null;
  customer: string | null;
  currency: string;
  lines: Array<{ description: string; quantity: number; unit_price: number; discount_pct: number; amount: number }>;
  totals: { subtotal: number; discount: number; tax: number; total: number };
  promotions: Array<{ label: string; amount: number }>;
  /** What came off, line by line (#293): the coupon, promotions, points, the cashier's discount and its reason. */
  reductions: PosReduction[];
  taxes: Array<{ label: string; amount: number }>;
  tenders: Array<{ label: string; amount: number; reference: string | null }>;
  tendered: number;
  change: number;
  payment_missing: boolean;
  refunds: Array<{ ref: string; kind: string; amount: number }>;
  loyalty: { tier: string | null; earned: number; balance: number | null } | null;
  status: string;
  /** Priced offline: "provisional". */
  provisional: boolean;
}

/** The till's own sale as a receipt: the company is the till's (its name, and the printer's header lines as the address). */
export function docOfSale(sale: PosSale, o: { company: string | null; header: string; till: { code: string; name: string } | null }): ReceiptDoc {
  const head = lines(o.header);
  return {
    company: { name: o.company ?? head[0] ?? '', address: (o.company ? head : head.slice(1)).join(', ') || null, phone: null, email: null, tax_number: null, registration: null },
    receipt_no: sale.ref,
    invoice_no: null,
    order_no: sale.number,
    at: stampOf(sale.created_at),
    till: o.till,
    cashier: sale.cashier_name,
    customer: sale.customer?.name ?? null,
    currency: sale.currency,
    lines: sale.lines.map((l) => ({ description: l.name, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, amount: l.net })),
    totals: sale.totals,
    promotions: sale.promotions ?? [],
    // A sale that kept no parts (#293) prints by a template as it always did: one "Discount", its promotions under it.
    reductions: sale.coupon || sale.discount_type || sale.discount_reason ? saleReductions(sale) : serverReductions({ totals: sale.totals, promotions: sale.promotions }),
    taxes: vatRows(sale.lines, sale.totals.tax),
    tenders: sale.tenders.map((t) => ({ label: METHOD[t.method] ?? t.method, amount: t.method === 'cash' ? Math.max(0, Math.round((t.amount - sale.change_given) * 100) / 100) : t.amount, reference: t.reference ?? null })),
    tendered: Math.round(sale.tenders.reduce((a, t) => a + t.amount, 0) * 100) / 100,
    change: sale.change_given,
    payment_missing: !sale.tenders.length || saleFlags(sale).includes('payment_missing'),
    refunds: (sale.returns ?? []).map((r) => ({ ref: r.ref, kind: r.kind, amount: r.amount })),
    loyalty: sale.loyalty ? { tier: sale.loyalty.tier ?? sale.customer?.tier ?? null, earned: sale.loyalty.earned, balance: sale.loyalty.balance ?? null } : null,
    status: sale.voided ? 'voided' : 'paid',
    provisional: sale.priced_by === 'estimate',
  };
}

/** WorkSuite's receipt as a receipt doc. */
export function docOfServer(r: PosServerReceipt): ReceiptDoc {
  return {
    company: { name: r.company.name, address: r.company.address, phone: r.company.phone, email: r.company.email ?? null, tax_number: r.company.tax_number, registration: r.company.registration ?? null },
    receipt_no: r.receipt_no,
    invoice_no: r.invoice_number,
    order_no: r.order_number,
    at: r.at ?? '',
    till: r.till ?? null,
    cashier: r.cashier,
    customer: r.customer?.name ?? null,
    currency: r.currency,
    lines: r.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, amount: l.amount })),
    totals: r.totals,
    promotions: r.promotions ?? [],
    reductions: serverReductions(r),
    taxes: r.taxes.map((t) => ({ label: t.name, amount: t.amount })),
    tenders: r.tenders,
    tendered: r.tendered ?? r.tenders.reduce((a, t) => a + t.amount, 0) + r.change,
    change: r.change,
    payment_missing: !!r.payment_missing || r.status === 'payment_missing',
    refunds: r.refunds.map((x) => ({ ref: x.ref, kind: x.kind, amount: x.amount })),
    loyalty: r.loyalty ? { tier: r.loyalty.tier, earned: r.loyalty.earned, balance: r.loyalty.balance } : null,
    status: r.status,
    provisional: false,
  };
}

/** A template's text with its fields filled from the receipt (`ReceiptTemplates::fill`): one it lacks prints as nothing. */
export function fillFields(text: string, d: ReceiptDoc, vars: PosReceiptTemplate['vars']): string {
  const map: Record<string, string> = {
    '{receipt_no}': d.receipt_no,
    '{invoice_no}': d.invoice_no ?? '',
    '{date}': d.at,
    '{till}': d.till?.code ?? '',
    '{cashier}': d.cashier ?? '',
    '{customer}': d.customer ?? '',
    '{points}': d.loyalty?.balance != null ? String(d.loyalty.balance) : '',
    '{return_days}': vars.return_days != null ? String(vars.return_days) : '',
    '{company}': d.company.name,
    '{branch_phone}': d.company.phone ?? '',
    '{e_receipt_url}': '',
  };
  return text.replace(/\{[a-z_]+\}/g, (k) => map[k] ?? k);
}

const qtyOf = (n: number) => String(Math.round(n * 1000) / 1000);
const pctOf = (n: number) => String(Math.round(n * 100) / 100);

/** Mostly letters ESC/POS's code page can print: a Sinhala or Tamil footer would come out as question marks. */
function latinEnough(t: string): boolean {
  const chars = [...t.replace(/\s+/g, '')];
  if (!chars.length) return false;
  return chars.filter((c) => plain(c) !== '?').length / chars.length >= 0.7;
}

/**
 * The receipt by the company's template: its blocks, in order, as the server lays them out (`Receipt::designed`).
 * `latin`: for ESC/POS, footer texts in a script the printer cannot print are left out (the driver prints them all).
 */
export function templateRows(d: ReceiptDoc, tpl: PosReceiptTemplate, o: { reprint?: boolean; latin?: boolean } = {}): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  const fill = (t: string) => fillFields(t, d, tpl.vars);
  const al = (b: PosReceiptBlock): 'left' | 'center' => (b.align === 'left' ? 'left' : 'center');
  let marked = false;
  const mark = () => {
    if (marked) return;
    marked = true;
    if (o.reprint) rows.push({ kind: 'text', text: '*** COPY ***', align: 'center', bold: true });
    if (STATUS[d.status]) rows.push({ kind: 'text', text: STATUS[d.status]!, align: 'center', bold: true });
  };
  for (const b of tpl.blocks) {
    if (!b.on) continue;
    switch (b.type) {
      case 'logo':
        break;
      case 'company':
        if (d.company.name) rows.push({ kind: 'text', text: d.company.name, align: 'center', bold: true });
        if (b.show_address !== false && d.company.address) rows.push({ kind: 'text', text: d.company.address, align: 'center' });
        if (b.show_phone !== false && d.company.phone) rows.push({ kind: 'text', text: d.company.phone, align: 'center' });
        if (b.show_email !== false && d.company.email) rows.push({ kind: 'text', text: d.company.email, align: 'center' });
        break;
      case 'header':
        for (const l of b.lines ?? []) {
          const t = fill(l).trim();
          if (t) rows.push({ kind: 'text', text: t, align: al(b) });
        }
        break;
      case 'tax_numbers':
        if (d.company.tax_number) rows.push({ kind: 'text', text: `${b.label || 'Tax no.'} ${d.company.tax_number}`, align: 'center' });
        if (b.show_registration && d.company.registration) rows.push({ kind: 'text', text: `Reg. no. ${d.company.registration}`, align: 'center' });
        break;
      case 'details':
        mark();
        rows.push({ kind: 'rule' });
        rows.push({ kind: 'pair', left: 'Receipt', right: d.receipt_no });
        if (b.show_invoice !== false && d.invoice_no) rows.push({ kind: 'pair', left: 'Invoice', right: d.invoice_no });
        else if (d.order_no) rows.push({ kind: 'pair', left: 'Order', right: d.order_no });
        if (b.show_till !== false && d.till) rows.push({ kind: 'pair', left: 'Till', right: d.till.code });
        if (b.show_cashier !== false && d.cashier) rows.push({ kind: 'pair', left: 'Cashier', right: d.cashier });
        rows.push({ kind: 'pair', left: 'Date', right: d.at });
        break;
      case 'customer':
        if (d.customer) rows.push({ kind: 'pair', left: 'Customer', right: d.customer + (d.loyalty?.tier ? ` · ${d.loyalty.tier}` : '') });
        break;
      case 'lines':
        mark();
        rows.push({ kind: 'rule' });
        for (const l of d.lines) {
          rows.push({ kind: 'text', text: l.description });
          rows.push({ kind: 'pair', left: `  ${qtyOf(l.quantity)} x ${money(l.unit_price)}${b.show_discount !== false && l.discount_pct > 0 ? ` less ${pctOf(l.discount_pct)}%` : ''}`, right: money(l.amount) });
        }
        break;
      case 'totals':
        rows.push({ kind: 'rule' });
        rows.push({ kind: 'pair', left: 'Subtotal', right: money(d.totals.subtotal) });
        pushReductions(rows, d.reductions);
        rows.push({ kind: 'pair', left: `TOTAL ${d.currency}`, right: money(d.totals.total), bold: true });
        break;
      case 'taxes':
        for (const x of d.taxes) rows.push({ kind: 'pair', left: x.label, right: money(x.amount) });
        break;
      case 'payments':
        for (const x of d.tenders) rows.push({ kind: 'pair', left: `${x.label}${x.reference ? ` ${x.reference}` : ''}`, right: money(x.amount) });
        if (d.change > 0) {
          rows.push({ kind: 'pair', left: 'Tendered', right: money(d.tendered) });
          rows.push({ kind: 'pair', left: 'Change', right: money(d.change), bold: true });
        }
        if (d.payment_missing) rows.push({ kind: 'pair', left: 'Payment missing', right: money(d.totals.total), bold: true });
        break;
      case 'points':
        if (d.loyalty) {
          if (d.loyalty.earned) rows.push({ kind: 'pair', left: 'Points earned', right: String(d.loyalty.earned) });
          if (d.loyalty.balance != null) rows.push({ kind: 'pair', left: 'Points balance', right: String(d.loyalty.balance) });
        }
        break;
      case 'refunds':
        for (const r of d.refunds) rows.push({ kind: 'pair', left: `${r.kind === 'void' ? 'Voided' : 'Refunded'} ${r.ref}`, right: `-${money(r.amount)}` });
        break;
      case 'footer': {
        const texts = Object.values(b.text ?? {})
          .map((t) => fill(t).trim())
          .filter((t) => t && (!o.latin || latinEnough(t)));
        rows.push({ kind: 'rule' });
        for (const t of texts) for (const l of t.split(/\r?\n/)) if (l.trim()) rows.push({ kind: 'text', text: l.trim(), align: al(b) });
        break;
      }
      case 'barcode':
        // The e-receipt link is not on the till's records: the receipt number stands in, as the server does.
        if (b.format === 'qr') rows.push({ kind: 'qr', text: d.receipt_no });
        else if (code128Encodable(d.receipt_no)) rows.push({ kind: 'barcode', text: d.receipt_no });
        break;
    }
  }
  if (!marked && (o.reprint || STATUS[d.status])) {
    const at = rows.length;
    mark();
    // Nothing named the receipt: the marks go at the top.
    rows.unshift(...rows.splice(at));
  }
  if (d.provisional) {
    rows.push({ kind: 'rule' });
    rows.push({ kind: 'text', text: 'Provisional: priced offline. WorkSuite confirms the figures.', align: 'center' });
  }
  return rows;
}

/** The paper a template prints on, where the till's printer can: 58 or 80 mm (A4 keeps the printer's own roll). */
export function paperOf(tpl: PosReceiptTemplate | null | undefined, fallback: PosPrintSettings['paper']): PosPrintSettings['paper'] {
  return tpl && (tpl.paper === '58mm' || tpl.paper === '80mm') ? tpl.paper : fallback;
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
    } else if (r.kind === 'barcode') {
      one.push(...barcodeBytes(r.text, width));
    } else if (r.kind === 'qr') {
      one.push(...qrBytes(r.text, width));
      push(ESC, 0x61, 1);
      text(r.text.slice(0, width));
      push(ESC, 0x61, 0);
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

/**
 * A Code 128 barcode in the printer's own command (`GS k`, function B, set B): centred, 60 dots tall, two dots a
 * module on an 80 mm roll (one on 58 mm, so it fits), the number printed under it (HRI).
 */
export function barcodeBytes(data: string, width: number): number[] {
  if (!code128Encodable(data)) return [];
  const body = [...Buffer.from(`{B${data}`, 'latin1')];
  return [ESC, 0x61, 1, GS, 0x68, 60, GS, 0x77, width >= 48 ? 2 : 1, GS, 0x48, 2, GS, 0x66, 0, GS, 0x6b, 73, body.length, ...body, LF, ESC, 0x61, 0];
}

/**
 * A QR code in the printer's own commands (`GS ( k`, model 2, error correction M), centred: modules of 6 dots on an
 * 80 mm roll, 4 on 58 mm. Empty for text too long for one code.
 */
export function qrBytes(data: string, width: number): number[] {
  const body = [...Buffer.from(plain(data), 'latin1')];
  if (!body.length || body.length > 700) return [];
  const len = body.length + 3;
  return [
    ESC, 0x61, 1,
    GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, width >= 48 ? 6 : 4,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31,
    GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...body,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30,
    LF, ESC, 0x61, 0,
  ];
}

/** The QR code as an SVG for the page (the driver). */
function qrSvg(text: string): string {
  try {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 3, margin: 2 });
  } catch {
    return '';
  }
}

/* ── The same receipt as a page (the driver) ────────────────────────── */

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function receiptHtml(rows: ReceiptRow[], paper: PosPrintSettings['paper']): string {
  const w = paper === '58mm' ? 219 : 302;
  const body = rows
    .map((r) => {
      if (r.kind === 'rule') return '<hr>';
      if (r.kind === 'barcode') return `<div class="c k">${code128Svg(r.text, { height: 44, module: 1 })}</div><div class="c">${esc(r.text)}</div>`;
      if (r.kind === 'qr') return `<div class="c k">${qrSvg(r.text)}</div><div class="c">${esc(r.text)}</div>`;
      if (r.kind === 'pair') return `<div class="p${r.bold ? ' b' : ''}"><span>${esc(r.left)}</span><span>${esc(r.right)}</span></div>`;
      return `<div class="${[r.align === 'center' ? 'c' : '', r.bold ? 'b' : '', r.big ? 'g' : ''].join(' ').trim()}">${esc(r.text)}</div>`;
    })
    .join('');
  return `<style>body{margin:0;width:${w}px;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#000}div{padding:0 6px;overflow-wrap:anywhere}.p{display:flex;justify-content:space-between;gap:8px}.p span:last-child{white-space:nowrap}.c{text-align:center}.b{font-weight:700}.g{font-size:16px}hr{border:0;border-top:1px dashed #000;margin:4px 6px}.k{margin-top:8px}.k svg{max-width:100%;height:auto}</style></head><body>${body}</body></html>`;
}

/* ── The service ─────────────────────────────────────────────────────── */

export interface PosPrintDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  origin: () => string | null;
  print?: (job: PrintJob) => Promise<PrintResult>;
  raw?: (printer: string, bytes: Buffer) => Promise<PrintResult>;
  /** The company's published receipt template (the till's door), or null: today's receipt. */
  template?: () => PosReceiptTemplate | null;
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

  private async out(rows: ReceiptRow[], installed: string[], o: { kick?: boolean; copies?: number; paper?: PosPrintSettings['paper'] } = {}): Promise<PosPrintOutcome> {
    const s = { ...this.settings(), ...(o.paper ? { paper: o.paper } : {}) };
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

  private template(): PosReceiptTemplate | null {
    try {
      return this.d.template?.() ?? null;
    } catch {
      return null;
    }
  }

  /** A sale's receipt; the drawer opens with it when cash was taken. By the company's template where one is published. */
  receipt(sale: PosSale, installed: string[], o: { till: string | null; reprint?: boolean; kick?: boolean; company?: string | null; code?: string | null }): Promise<PosPrintOutcome> {
    const s = this.settings();
    const tpl = this.template();
    const rows = tpl
      ? templateRows(docOfSale(sale, { company: o.company ?? null, header: s.header, till: o.code ? { code: o.code, name: o.till ?? o.code } : null }), tpl, { reprint: o.reprint, latin: s.mode === 'escpos' })
      : receiptRows(sale, s, { till: o.till, reprint: o.reprint });
    return this.out(rows, installed, { kick: o.kick, copies: o.reprint ? 1 : s.copies, paper: paperOf(tpl, s.paper) });
  }

  /** WorkSuite's receipt for a sale (a reprint): by the template it carries, or the one the till has. */
  serverReceipt(r: PosServerReceipt, installed: string[], o: { till: string | null; reprint?: boolean }): Promise<PosPrintOutcome> {
    const s = this.settings();
    const tpl = r.template !== undefined ? r.template : this.template();
    const rows = tpl ? templateRows(docOfServer(r), tpl, { reprint: o.reprint, latin: s.mode === 'escpos' }) : serverReceiptRows(r, s, o);
    return this.out(rows, installed, { copies: o.reprint ? 1 : s.copies, paper: paperOf(tpl, s.paper) });
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
