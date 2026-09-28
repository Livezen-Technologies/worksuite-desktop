import { apiGet, request } from '../../core/api';
import { call } from '../../core/bridge';
import type { SalonPaper, SalonPrintOutcome, SalonPrintPatch, SalonPrintSettings } from '@shared/types';
import { amount, write, type Visit } from './api';

/**
 * The desk's money (D05–D07, D11, D13, POS-01…07): pricing a visit, taking
 * payment into the POS register, the register itself, the day's close, and
 * the printer and drawer that go with them.
 *
 * THE FIGURES ARE THE SERVER'S. The bill, what the advance and credit cover,
 * the change, what the drawer should hold and how far out a count is — all
 * come from WorkSuite. The one sum made here is the one a cashier makes aloud:
 * what was handed over against what is due, to say "over by 262.50 — change
 * or credit?" before the press. The server does it again, and what it answers
 * is what the Paid screen and the receipt show.
 */
const BASE = '/api/salon/v1';

export type TenderMethod = 'cash' | 'card' | 'bank_transfer' | 'wallet' | 'online';

export const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  wallet: 'LankaQR / wallet',
  bank_transfer: 'Bank transfer',
  online: 'Online',
  credit: 'Store credit used',
  advance: 'Advance applied',
  points: 'Points',
  credit_kept: 'Kept as store credit',
};

export interface CheckoutLine {
  kind: 'service' | 'product';
  appointment_id: number;
  product_id: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  tier: string | null;
  multiplier: number | null;
  provider_id: number | null;
  provider: string | null;
  net: number;
  total: number;
}

export interface CheckoutQuote {
  visit_id: number;
  number: string;
  currency: string;
  /** The invoice's id once the visit is checked out: the rest is paid against it. */
  invoiced: number | null;
  lines: CheckoutLine[];
  tier: { name: string; discount: number } | null;
  gross: number;
  tier_discount: number;
  points_value: number;
  points: number;
  points_balance: number;
  point_value: number;
  discount: number;
  tax: number;
  total: number;
  advance: number;
  credit_available: number;
  credit: number;
  to_pay: number;
  points_to_earn: number;
  loyalty: boolean;
  overpay_default: 'credit' | 'change';
  may: { discount: boolean; issue: boolean; payment: boolean; commission: boolean };
}

export interface RetailLine {
  product_id: number;
  quantity: number;
  seller_id: number | null;
}

/** What changes the price: points, store credit, retail. */
export interface PriceInputs {
  redeem_points: number;
  use_credit: boolean;
  retail: RetailLine[];
}

export interface Tender {
  method: TenderMethod;
  amount: number;
  reference: string | null;
}

export interface PayResult {
  ok: boolean;
  message?: string;
  tenders?: Array<{ method: string; amount: number; reference: string | null; change?: number }>;
  change?: number;
  credit_kept?: number;
  cash_in?: number;
  owed?: number;
  settled?: boolean;
  points?: { earned: number; balance: number } | null;
  store_credit?: number;
  pos_sale?: { id: number; number: string; session_id: number } | null;
  problems?: string[];
}

export interface CheckoutResult {
  invoice?: { id: number; number: string | null; status: string; total: number; paid?: number; owed?: number; why?: string };
  /** Null when the invoice stayed a draft: no money was taken. */
  paid: PayResult | null;
  next_visit?: { date: string; weeks: number } | null;
  message?: string;
  visit: Visit;
}

export interface RegisterSession {
  id: number;
  opened_at: string | null;
  mine: boolean;
  opening_float: number;
  /** Hidden under a blind close. */
  expected: number | null;
  sales: { cash_in: number; cash_change: number; count: number; total: number; credit_kept: number };
  tenders: Record<string, number> | [];
}

export interface RegisterState {
  register: { id: number; code: string; name: string } | null;
  message?: string;
  session?: RegisterSession | null;
  last_close?: { closed_at: string; counted: number } | null;
  denominations?: number[];
  rules?: { count_to_close: boolean; blind: boolean };
}

export interface CloseResult {
  variance: number;
  z: { session_id: number; tenders: Record<string, number> | []; sales: RegisterSession['sales']; expected: number };
}

export interface DeskDay {
  date: string;
  currency: string;
  figures: {
    bookings: number;
    done: number;
    to_come: number;
    taken: { total: number; not_new: number; by_method: Array<{ method: string; label: string; receipts: number; amount: number; new_money: boolean }> } | null;
    owed: { amount: number; invoices: number } | null;
  };
  not_checked_out: Array<{ id: number; number: string; client: string; status: string }>;
  unpaid: Array<{ id: number; number: string; invoice: string | null; owed: number }>;
  completed: number;
  no_shows: number;
  commission: number;
  queue: number;
}

export interface RetailItem {
  id: number;
  code: string | null;
  name: string;
  price: number;
  currency: string;
  category: string | null;
  stock: number | null;
  badge: 'untracked' | 'out' | 'low' | 'in';
}

/* ── Reading ────────────────────────────────────────────────────────── */

export const fetchCheckout = (visitId: number, signal?: AbortSignal) => apiGet<CheckoutQuote>(`${BASE}/visits/${visitId}/checkout`, undefined, signal);
export const fetchRegister = (deskId: number, signal?: AbortSignal) => apiGet<RegisterState>(`${BASE}/desk/register`, { desk: deskId }, signal);
export const fetchDay = (deskId: number, signal?: AbortSignal) => apiGet<DeskDay>(`${BASE}/desk/day`, { desk: deskId }, signal);
export const fetchRetail = (deskId: number, q: string, signal?: AbortSignal) => apiGet<{ items: RetailItem[]; categories: string[] }>(`${BASE}/desk/retail`, { desk: deskId, q }, signal);

export const MK = {
  checkout: (visitId: number) => ['salon', 'checkout', visitId] as const,
  register: (deskId: number) => ['salon', 'register', deskId] as const,
  day: (deskId: number) => ['salon', 'day', deskId] as const,
  retail: (deskId: number, q: string) => ['salon', 'retail', deskId, q] as const,
  print: ['salon', 'print'] as const,
};

/** The bill again, for points, credit or retail (no money moves). */
export async function quoteCheckout(visitId: number, inputs: PriceInputs): Promise<CheckoutQuote> {
  const r = await request<CheckoutQuote>('POST', `${BASE}/visits/${visitId}/checkout/quote`, { body: priceBody(inputs) });
  return r.data;
}

export function priceBody(i: PriceInputs): Record<string, unknown> {
  return { redeem_points: i.redeem_points, use_credit: i.use_credit, retail: i.retail.map((r) => ({ product_id: r.product_id, quantity: r.quantity, seller_id: r.seller_id })) };
}

/* ── Money ──────────────────────────────────────────────────────────── */

export interface PayBody {
  tenders: Tender[];
  keep_as_credit: boolean;
  desk_id: number;
}

/** Invoice the visit and take the money, into the desk's register (CHK-01…06). One key per attempt. */
export async function checkout(visitId: number, inputs: PriceInputs, pay: PayBody, key: string): Promise<{ data: CheckoutResult; message: string | null }> {
  return write<CheckoutResult>(`/visits/${visitId}/checkout`, { ...priceBody(inputs), ...pay }, key);
}

/** The rest of an invoiced visit, against its invoice. */
export async function payRest(visitId: number, pay: PayBody & { use_credit: boolean }, key: string): Promise<{ data: CheckoutResult; message: string | null }> {
  const r = await write<PayResult & { visit: Visit }>(`/visits/${visitId}/payments`, pay, key);
  return { data: { paid: r.data, visit: r.data.visit, message: r.message ?? undefined }, message: r.message };
}

/**
 * The register. The server does not keep these under a key: opening and
 * closing are safe to press again (it refuses the second), and cash in or
 * out is never pressed again by itself — a dropped answer is looked up.
 */
export async function openRegister(deskId: number, float: number, denominations: CountLine[] | null, note: string | null): Promise<RegisterState> {
  const r = await request<RegisterState>('POST', `${BASE}/desk/register/open`, { body: { desk: deskId, opening_float: float, denominations, note } });
  return r.data;
}

export async function moveCash(deskId: number, direction: 'in' | 'out', value: number, reason: string): Promise<string | null> {
  const r = await request<null>('POST', `${BASE}/desk/register/cash`, { body: { desk: deskId, direction, amount: value, reason } });
  return r.message ?? null;
}

export async function closeRegister(deskId: number, count: { denominations: CountLine[] } | { counted_cash: number }, reason: string | null): Promise<{ data: CloseResult; message: string | null }> {
  const r = await request<CloseResult>('POST', `${BASE}/desk/register/close`, { body: { desk: deskId, ...count, variance_reason: reason } });
  return { data: r.data, message: r.message ?? null };
}

/* ── The cashier's arithmetic ───────────────────────────────────────── */

/** Cents, so two money figures compare exactly. */
export const cents = (n: number) => Math.round(n * 100);

/** Round sums a client might hand over: the next 500, 1,000 and 5,000 above what is due. */
export function suggestions(due: number): number[] {
  const out = new Set<number>();
  for (const step of [500, 1000, 5000]) {
    const n = Math.ceil(due / step) * step;
    if (n > due) out.add(n);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

/** A key on the cash keypad: digits, 00, a point, and back. At most two decimals. */
export function pressKey(value: string, key: string): string {
  if (key === 'back') return value.slice(0, -1);
  if (key === 'clear') return '';
  if (key === '.') return value.includes('.') ? value : `${value || '0'}.`;
  if (!/^\d{1,2}$/.test(key)) return value;
  const [whole = '', dec] = value.split('.');
  if (dec !== undefined && dec.length + key.length > 2) return value;
  if (dec === undefined && whole.length + key.length > 9) return value;
  const next = `${value}${key}`;
  return next.replace(/^0+(?=\d)/, '');
}

/** A money figure typed into a field: digits and one point. */
export function moneyTyped(v: string): string {
  const clean = v.replace(/[^\d.]/g, '');
  const [whole, ...rest] = clean.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole!;
}

export interface Handed {
  tenders: Tender[];
  /** In cents: what was handed over, and how far that is over (or under, negative) what is due. */
  handed: number;
  over: number;
  cash: number;
  missingReference: boolean;
}

/** What was handed over, against what is due. */
export function handedOver(tenders: Tender[], due: number | null): Handed {
  const live = tenders.filter((t) => t.amount > 0);
  const handed = live.reduce((c, t) => c + cents(t.amount), 0);
  return {
    tenders: live,
    handed,
    over: due === null ? 0 : handed - cents(due),
    cash: live.filter((t) => t.method === 'cash').reduce((c, t) => c + cents(t.amount), 0),
    missingReference: live.some((t) => t.method !== 'cash' && t.method !== 'online' && !t.reference?.trim()),
  };
}

/* ── Counting the drawer ────────────────────────────────────────────── */

export interface CountLine {
  value: number;
  count: number;
}

/** Note by note, as typed: piles with nothing in them are left out. */
export function countLines(counts: Record<string, string>): CountLine[] {
  return Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count: Math.floor(Number(count) || 0) }))
    .filter((l) => l.value > 0 && l.count > 0)
    .sort((a, b) => b.value - a.value);
}

export function countTotal(counts: Record<string, string>): number {
  return countLines(counts).reduce((c, l) => c + cents(l.value) * l.count, 0) / 100;
}

/** The server answers an empty map as `[]`. */
export function tenderMap(t: Record<string, number> | [] | undefined): Record<string, number> {
  return t && !Array.isArray(t) ? t : {};
}

/* ── Printing and the drawer (the main process holds the printers) ─── */

export const printSettings = (): Promise<SalonPrintSettings> => call('salon:printSettings', undefined);
export const setPrintSettings = (patch: SalonPrintPatch): Promise<SalonPrintSettings> => call('salon:printSettingsSet', patch);
export const printReceipt = (visitId: number, paper?: SalonPaper): Promise<SalonPrintOutcome> => call('salon:printReceipt', { visit_id: visitId, paper });
export const printTest = (paper?: SalonPaper): Promise<SalonPrintOutcome> => call('salon:printTest', { paper });
export const printPage = (html: string, paper?: SalonPaper): Promise<SalonPrintOutcome> => call('salon:printPage', { html, paper });
export const openDrawer = (): Promise<SalonPrintOutcome> => call('salon:openDrawer', undefined);
export const listPrinters = () => call('print:printers', undefined);

/** Desk settings WorkSuite keeps too, so owners see how each desk prints (PUT desks/{id}/settings). */
export async function saveDeskSettings(deskId: number, s: SalonPrintSettings): Promise<void> {
  await request('PUT', `${BASE}/desks/${deskId}/settings`, {
    body: { receipt_printer: s.receipt_printer, a4_printer: s.a4_printer, paper: s.paper, silent: s.silent, auto_print: s.auto_print, copies: s.copies },
  });
}

/* ── Pages printed from the server's figures ────────────────────────── */

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, body: string, width: number): string {
  return (
    `<title>${esc(title)}</title><style>` +
    'body{margin:0;font:12px/1.4 "Noto Sans","Noto Sans Sinhala","Noto Sans Tamil",Arial,sans-serif;color:#000}' +
    `.p{width:${width - 20}px;margin:0 auto;padding:10px}h1{font-size:15px;text-align:center;margin:0 0 4px}.c{text-align:center}` +
    'table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.r{text-align:right;white-space:nowrap;padding-left:8px}hr{border:0;border-top:1px dashed #000;margin:6px 0}' +
    `</style><div class="p">${body}</div>`
  );
}

function rows(pairs: Array<[string, string]>): string {
  return `<table>${pairs.map(([l, r]) => `<tr><td>${esc(l)}</td><td class="r">${esc(r)}</td></tr>`).join('')}</table>`;
}

const WIDTH = { '80mm': 302, '58mm': 219 } as const;

export interface PageHeading {
  company: string;
  location: string;
  date: string;
  paper: '80mm' | '58mm';
}

/** The Z-report, from what the close answered: nothing is added up here. */
export function zReport(r: CloseResult, code: string, h: PageHeading, currency: string): string {
  const z = r.z;
  return page(
    `Z-report ${code}`,
    `<h1>${esc(h.company)}</h1><div class="c">${esc(h.location)}</div><div class="c"><b>Z-REPORT · ${esc(code)}</b></div><div class="c">${esc(h.date)} · session #${esc(z.session_id)}</div><hr>` +
      rows([
        ['Sales', String(z.sales.count)],
        [`Sales total ${currency}`, amount(z.sales.total)],
        ['Cash in', amount(z.sales.cash_in)],
        ['Change given', amount(z.sales.cash_change)],
        ['Kept as store credit', amount(z.sales.credit_kept)],
      ]) +
      '<hr>' +
      rows(Object.entries(tenderMap(z.tenders)).map(([m, v]) => [METHOD_LABEL[m] ?? m, amount(v)])) +
      '<hr>' +
      rows([
        ['Drawer should hold', amount(z.expected)],
        ['Difference', r.variance === 0 ? 'None' : amount(r.variance)],
      ]),
    WIDTH[h.paper],
  );
}

/** The salon's side of the day, as the server gave it. */
export function daySummary(d: DeskDay, h: PageHeading): string {
  const t = d.figures.taken;
  return page(
    `Day summary ${d.date}`,
    `<h1>${esc(h.company)}</h1><div class="c">${esc(h.location)} · ${esc(d.date)}</div><hr>` +
      (t
        ? rows([...t.by_method.map((m): [string, string] => [`${m.label} (${m.receipts})${m.new_money ? '' : ' — not new money'}`, amount(m.amount)]), [`Taken ${d.currency}`, amount(t.total)]]) + '<hr>'
        : '') +
      rows([
        ['Bookings', String(d.figures.bookings)],
        ['Visits completed', String(d.completed)],
        ['No-shows', String(d.no_shows)],
        ['Invoices still owing', String(d.unpaid.length)],
        ['Not checked out', String(d.not_checked_out.length)],
      ]),
    WIDTH[h.paper],
  );
}
