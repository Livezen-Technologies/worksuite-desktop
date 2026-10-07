import { approvalAskOf, type PosApprovalAsk, type PosApprovalNeed, type PosDeskAnswer, type PosDeskOp, type PosReport } from '@shared/pos';
import { call } from '../../core/bridge';
import { formatMoney } from './pricing';

/**
 * Phase 2's counter, through the till's own door (`pos:desk`, electron/services/pos-till.ts `desk`): held sales on the
 * server, gift vouchers and store credit, a manager's approval (by PIN, or asked of a manager elsewhere), customers and
 * loyalty, today's top sellers, and the drawer's X report. The main process names the cashier and holds the credential;
 * this reads WorkSuite's answers. Every reader here is pure — tested without a server — and none of these is offered
 * unless the server announces it (`options.capabilities`, see api.ts).
 */

/** WorkSuite said no: its sentence, its code (`gone`, `pin_wrong`, `customer_exists`…) and, for a duplicate customer, the candidates. */
export class DeskError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly body: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'DeskError';
  }
}

const n = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null);
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : []);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** An answer that is not a success, as the error the screens show. */
export function deskFailure(a: PosDeskAnswer, fallback: string): DeskError {
  return new DeskError(s(a.body?.message) ?? fallback, a.status, s(a.body?.code), a.body);
}

async function desk(op: PosDeskOp, fallback: string, ok: (status: number) => boolean = (st) => st >= 200 && st < 300): Promise<Record<string, unknown>> {
  const a = await call('pos:desk', op);
  if (!ok(a.status)) throw deskFailure(a, fallback);
  return a.body ?? {};
}

/* ── Held sales on the server (`capabilities.held`) ─────────────────── */

export interface ServerHeld {
  id: number;
  register: string | null;
  label: string | null;
  note: string | null;
  customer: { name: string | null; phone: string | null; email: string | null; client_id: number | null } | null;
  lines: Array<{ product_id: number; quantity: number; name: string | null }>;
  discount_pct: number;
  item_count: number;
  total: number | null;
  currency: string | null;
  held_by: string | null;
  held_at: string | null;
  expires_at: string | null;
}

export function heldOf(v: unknown): ServerHeld | null {
  const h = obj(v);
  const id = n(h?.id);
  if (!h || !Number.isInteger(id) || id <= 0) return null;
  const c = obj(h.customer);
  return {
    id,
    register: s(h.register),
    label: s(h.label),
    note: s(h.note),
    customer: c ? { name: s(c.name), phone: s(c.phone), email: s(c.email), client_id: n(c.client_id) > 0 ? n(c.client_id) : null } : null,
    lines: list(h.lines)
      .map((l) => ({ product_id: n(l.product_id), quantity: n(l.quantity), name: s(l.name) }))
      .filter((l) => Number.isInteger(l.product_id) && l.product_id > 0 && l.quantity > 0),
    discount_pct: n(h.discount_pct),
    item_count: n(h.item_count),
    total: h.total == null ? null : n(h.total),
    currency: s(h.currency),
    held_by: s(h.held_by_name),
    held_at: s(h.held_at),
    expires_at: s(h.expires_at),
  };
}

export async function listServerHeld(): Promise<{ items: ServerHeld[]; expiry_hours: number | null }> {
  const b = await desk({ op: 'held' }, 'The held sales could not be read.');
  return { items: list(b.items).map(heldOf).filter((h): h is ServerHeld => !!h), expiry_hours: b.expiry_hours == null ? null : n(b.expiry_hours) };
}

export async function parkOnServer(p: Omit<Extract<PosDeskOp, { op: 'park' }>, 'op'>): Promise<ServerHeld> {
  const b = await desk({ op: 'park', ...p }, 'The sale could not be held on WorkSuite.');
  const h = heldOf(b.held);
  if (!h) throw new DeskError('WorkSuite held the sale but did not say how.', 200, null, b);
  return h;
}

/** Recalled: the held sale (gone from the list for every till) and its lines priced again for this cashier, when they could be. */
export async function recallFromServer(id: number): Promise<{ held: ServerHeld; problem: string | null }> {
  const b = await desk({ op: 'recall', id }, 'The held sale could not be recalled.');
  const h = heldOf(b.held);
  if (!h) throw new DeskError('WorkSuite recalled the sale but did not say what was in it.', 200, null, b);
  return { held: h, problem: s(b.cart_problem) };
}

export async function discardOnServer(id: number): Promise<void> {
  await desk({ op: 'discard', id }, 'The held sale could not be discarded.');
}

/* ── Gift vouchers and store credit ─────────────────────────────────── */

export interface Voucher {
  code: string;
  balance: number;
  currency: string | null;
  usable: boolean;
  status: string;
  expires_on: string | null;
  /** Why it cannot be spent, in WorkSuite's words (#293), when it said. */
  problem?: string | null;
}

export function voucherOf(v: unknown): Voucher | null {
  const x = obj(v);
  const code = s(x?.code);
  if (!x || !code) return null;
  return { code, balance: n(x.balance), currency: s(x.currency), usable: x.usable !== false && (s(x.status) ?? 'active') === 'active', status: s(x.status) ?? 'active', expires_on: s(x.expires_on), ...(s(x.problem) ? { problem: s(x.problem) } : {}) };
}

export async function lookupVoucher(code: string): Promise<Voucher | null> {
  const a = await call('pos:desk', { op: 'voucher', code: code.trim().toUpperCase() });
  if (a.status === 404) return null;
  if (a.status !== 200) throw deskFailure(a, 'The voucher could not be checked.');
  return voucherOf(a.body?.voucher);
}

export async function storeCredit(clientId: number): Promise<{ balance: number; currency: string | null }> {
  const b = await desk({ op: 'credit', client_id: clientId }, 'The store credit could not be read.');
  return { balance: n(b.balance), currency: s(b.currency) };
}

/* ── A manager's approval (`capabilities.approvals`, `remote_approvals`) ── */

export interface Approver {
  id: number;
  name: string;
  initials: string;
  /** Only a manager with a PIN can approve at the counter. */
  has_pin: boolean;
}

export function approverOf(v: unknown): Approver | null {
  const x = obj(v);
  const id = n(x?.id);
  const name = s(x?.name);
  if (!x || !Number.isInteger(id) || id <= 0 || !name) return null;
  const initials =
    s(x.initials) ??
    name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  return { id, name, initials, has_pin: x.has_pin === true };
}

export async function listApprovers(): Promise<Approver[]> {
  const b = await desk({ op: 'approvers' }, 'The managers could not be listed.');
  return list(b.items).map(approverOf).filter((a): a is Approver => !!a);
}

/** An approval to send with the action again (`approval_id`), and who gave it. Kept in memory only, never with a sale. */
export interface Approval {
  id: string;
  action: PosApprovalAsk['action'];
  amount: number;
  approver: string | null;
  expires_at: string | null;
}

export function approvalOf(v: unknown, ask: PosApprovalAsk): Approval | null {
  const x = obj(v);
  const id = s(x?.approval_id);
  if (!x || !id || !/^apv_[A-Za-z0-9]{8,120}$/.test(id)) return null;
  const by = obj(x.approver);
  return { id, action: ask.action, amount: x.amount == null ? ask.amount : n(x.amount, ask.amount), approver: s(by?.name) ?? s(x.decided_by_name), expires_at: s(x.expires_at) ?? s(x.approval_expires_at) };
}

/** A manager's PIN at the counter: sent once through the main process, never kept. Throws WorkSuite's refusal (`pin_wrong`, `pin_locked`…). */
export async function approveByPin(approverId: number, pin: string, ask: PosApprovalAsk, reason: string): Promise<Approval> {
  const a = await call('pos:approve', { approver_id: approverId, pin, action: ask.action, amount: ask.amount, ...(ask.subject ? { subject: ask.subject } : {}), ...(reason.trim() ? { reason: reason.trim().slice(0, 200) } : {}) });
  if (a.status !== 201 && a.status !== 200) throw deskFailure(a, 'The manager’s approval was not given.');
  const ap = approvalOf(a.body, ask);
  if (!ap) throw new DeskError('WorkSuite approved, but sent no approval this till can use. Ask again.', a.status, null, a.body);
  return ap;
}

export type RequestState = 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired';

export interface ManagerRequest {
  id: number;
  status: RequestState;
  decided_by: string | null;
  note: string | null;
  approval: Approval | null;
}

export function requestOf(v: unknown, ask: PosApprovalAsk): ManagerRequest | null {
  const x = obj(v);
  const id = n(x?.id);
  if (!x || !Number.isInteger(id) || id <= 0) return null;
  const st = s(x.status);
  const status: RequestState = st === 'approved' || st === 'denied' || st === 'cancelled' || st === 'expired' ? st : 'pending';
  return { id, status, decided_by: s(x.decided_by_name), note: s(x.decision_note), approval: status === 'approved' ? approvalOf(x, ask) : null };
}

export async function askManager(ask: PosApprovalAsk, reason: string): Promise<ManagerRequest> {
  const b = await desk({ op: 'ask', action: ask.action, amount: ask.amount, ...(ask.subject ? { subject: ask.subject } : {}), ...(reason.trim() ? { reason: reason.trim().slice(0, 200) } : {}) }, 'The request could not be sent to the managers.');
  const r = requestOf(b.request, ask);
  if (!r) throw new DeskError('WorkSuite took the request but did not say which it was.', 201, null, b);
  return r;
}

export async function pollRequest(id: number, ask: PosApprovalAsk): Promise<ManagerRequest> {
  const b = await desk({ op: 'request', id }, 'The request could not be read.');
  const r = requestOf(b.request, ask);
  if (!r) throw new DeskError('WorkSuite answered, but not with the request.', 200, null, b);
  return r;
}

export async function cancelRequest(id: number): Promise<void> {
  await desk({ op: 'cancel', id }, 'The request could not be withdrawn.', (st) => (st >= 200 && st < 300) || st === 409);
}

/** What the override asks for, in words: "Refund of 3,250.00 (over 3,000.00)", "15% off (your limit 10%)". */
export function askSummary(ask: PosApprovalAsk, currency: string): { what: string; over: string | null } {
  const pct = (v: number) => `${Math.round(v * 100) / 100}%`;
  const what =
    ask.action === 'discount'
      ? pct(ask.amount)
      : formatMoney(ask.amount, currency);
  const over = ask.threshold == null ? null : ask.action === 'discount' ? pct(ask.threshold) : formatMoney(ask.threshold, currency);
  return { what, over };
}

/** A refusal a manager's approval would lift, from a staff-API error (`errors.code`, `errors.approval`). */
export function needFromStaff(e: { status?: number; code?: string | null; message: string; details?: unknown }, action: PosApprovalAsk['action'], amount: number): PosApprovalNeed | null {
  if (!e.code || !/^approval_/.test(e.code)) return null;
  const ask = approvalAskOf(obj(e.details)?.approval, action) ?? { action, amount, threshold: null, subject: null };
  return { code: e.code, message: e.message, ask };
}

/* ── Customers and loyalty (`capabilities.customers`, `loyalty`) ───── */

export interface CrmCustomer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  group: string | null;
  points: number;
  store_credit: number | null;
}

export function crmCustomerOf(v: unknown): CrmCustomer | null {
  const x = obj(v);
  const id = n(x?.id);
  const name = s(x?.name);
  if (!x || !Number.isInteger(id) || id <= 0 || !name) return null;
  return { id, name, phone: s(x.phone), email: s(x.email), group: s(x.customer_group), points: Math.floor(n(x.points_balance)), store_credit: x.store_credit == null ? null : n(x.store_credit) };
}

export interface CustomerCard extends CrmCustomer {
  spend_12m: number;
  visits_12m: number;
  tier: string | null;
  next_tier: { name: string; spend_to_go: number } | null;
  loyalty: { enabled: boolean; point_value: number; points_value: number; min_redeem: number; max_redeem_pct: number } | null;
  last: Array<{ ref: string; at: string | null; total: number; items: string[]; voided: boolean; refunded: number }>;
}

export function cardOf(v: unknown): CustomerCard | null {
  const base = crmCustomerOf(v);
  const x = obj(v);
  if (!base || !x) return null;
  const tier = obj(x.tier);
  const next = obj(x.next_tier);
  const l = obj(x.loyalty);
  return {
    ...base,
    spend_12m: n(x.spend_12m),
    visits_12m: Math.floor(n(x.visits_12m)),
    tier: s(tier?.name),
    next_tier: next && s(next.name) ? { name: s(next.name)!, spend_to_go: n(next.spend_to_go) } : null,
    loyalty: l ? { enabled: l.enabled === true, point_value: n(l.point_value), points_value: n(l.points_value), min_redeem: Math.floor(n(l.min_redeem)), max_redeem_pct: n(l.max_redeem_pct) } : null,
    last: list(x.last_purchases)
      .slice(0, 5)
      .map((p) => ({ ref: s(p.ref) ?? '', at: s(p.at), total: n(p.total), items: (Array.isArray(p.items) ? p.items : []).map((i) => (typeof i === 'string' ? i : s(obj(i)?.name) ?? '')).filter(Boolean), voided: p.voided === true, refunded: n(p.refunded) })),
  };
}

export async function findCustomers(q: string): Promise<CrmCustomer[]> {
  const b = await desk({ op: 'customers', q: q.trim().slice(0, 80) }, 'Customers could not be searched.');
  return list(b.items).map(crmCustomerOf).filter((c): c is CrmCustomer => !!c);
}

export async function readCustomer(id: number): Promise<CustomerCard> {
  const b = await desk({ op: 'customer', id }, 'The customer could not be read.');
  const c = cardOf(b.customer);
  if (!c) throw new DeskError('WorkSuite answered, but not with the customer.', 200, null, b);
  return c;
}

/** A new CRM customer — or, when WorkSuite already has one like it (409 `customer_exists`), the candidates to pick from. */
export async function createCustomer(p: { name: string; phone?: string; email?: string }): Promise<{ customer: CrmCustomer } | { candidates: CrmCustomer[]; message: string }> {
  const a = await call('pos:desk', { op: 'customerCreate', name: p.name.trim().slice(0, 150), ...(p.phone?.trim() ? { phone: p.phone.trim().slice(0, 40) } : {}), ...(p.email?.trim() ? { email: p.email.trim().slice(0, 150) } : {}) });
  if (a.status === 409 && s(a.body?.code) === 'customer_exists') {
    return { candidates: list(a.body?.candidates).map(crmCustomerOf).filter((c): c is CrmCustomer => !!c), message: s(a.body?.message) ?? 'WorkSuite already has a customer like this one.' };
  }
  if (a.status !== 201 && a.status !== 200) throw deskFailure(a, 'The customer could not be added.');
  const c = crmCustomerOf(a.body?.customer);
  if (!c) throw new DeskError('WorkSuite added the customer but did not say who.', a.status, null, a.body);
  return { customer: c };
}

/**
 * The most points that may be spent on a sale: what the customer has, at most `max_redeem_pct` of what it comes to
 * after promotions and the cashier's discount, whole points only — WorkSuite checks it again (`Loyalty::redeem`).
 */
export function maxRedeem(points: number, loyalty: CustomerCard['loyalty'], payable: number): number {
  if (!loyalty?.enabled || loyalty.point_value <= 0 || points <= 0) return 0;
  const cap = Math.floor(((payable * Math.max(0, Math.min(100, loyalty.max_redeem_pct))) / 100 / loyalty.point_value) + 1e-9);
  const most = Math.max(0, Math.min(points, cap));
  return most >= Math.max(1, loyalty.min_redeem) ? most : 0;
}

/* ── Top sellers today (`capabilities.top_sellers`) ──────────────────── */

export async function topSellersToday(limit = 10): Promise<Array<{ product_id: number; name: string; quantity: number }>> {
  const b = await desk({ op: 'topSellers', limit }, 'Today’s top sellers could not be read.');
  return list(b.items)
    .map((i) => ({ product_id: n(i.product_id), name: s(i.name) ?? '', quantity: n(i.quantity) }))
    .filter((i) => Number.isInteger(i.product_id) && i.product_id > 0);
}

/* ── The drawer's X report (`capabilities.session_report`) ───────────── */

export interface SessionReport {
  kind: 'x' | 'z';
  title: string;
  hidden: boolean;
  rows: PosReport['rows'];
}

/**
 * WorkSuite's X (or Z) report of the drawer (`SessionReport::build`), as rows the screen shows and the printer prints.
 * A blind drawer still open hides its money (`hidden`): those rows say so, never a figure.
 */
export function sessionReportOf(v: unknown, currency: string): SessionReport | null {
  const r = obj(v);
  if (!r) return null;
  const sales = obj(r.sales) ?? {};
  const drawer = obj(r.drawer) ?? {};
  const hidden = r.hidden === true;
  const m = (x: unknown) => (x == null ? '—' : formatMoney(n(x)));
  const rows: PosReport['rows'] = [];
  const row = (label: string, value: string, strong = false) => rows.push({ label: label.slice(0, 80), value: value.slice(0, 40), ...(strong ? { strong } : {}) });
  row('Sales', String(Math.floor(n(sales.transactions))));
  row('Items', String(Math.round(n(sales.items) * 1000) / 1000));
  row('Gross', m(sales.gross));
  row('Discounts', m(sales.discounts));
  row('Tax', m(sales.tax));
  row(`Refunds (${Math.floor(n(sales.refund_count))})`, m(sales.refunds));
  row(`Voids (${Math.floor(n(sales.void_count))})`, m(sales.voids));
  row('Net', m(sales.net), true);
  rows.push({ rule: true });
  for (const t of list(r.tenders)) row(s(t.label) ?? s(t.method) ?? '', m(t.amount));
  if (Array.isArray(r.tenders) && r.tenders.length) rows.push({ rule: true });
  row('Opening float', m(drawer.opening_float));
  row('Cash in', m(drawer.moved_in));
  row('Cash out', m(drawer.moved_out));
  row('Cash refunds', m(drawer.refund_cash));
  row(`Expected ${currency}`.trim(), hidden ? '—' : m(drawer.expected), true);
  if (drawer.counted != null) row('Counted', m(drawer.counted));
  if (drawer.variance != null) row('Difference', m(drawer.variance), true);
  return { kind: r.kind === 'z' ? 'z' : 'x', title: s(r.title) ?? (r.kind === 'z' ? 'Z report' : 'X report'), hidden, rows: rows.slice(0, 200) };
}

export async function drawerReport(sessionId?: number): Promise<{ raw: Record<string, unknown> } | null> {
  const a = await call('pos:desk', { op: 'report', ...(sessionId ? { session_id: sessionId } : {}) });
  if (a.status === 404) return null;
  if (a.status !== 200) throw deskFailure(a, 'The drawer’s report could not be read.');
  return { raw: obj(a.body?.report) ?? {} };
}

/* ── Stock at the till's warehouse (`capabilities.stock`) ────────────── */

/**
 * The catalogue's stock goes stale (its version does not change with stock): the levels read again through the
 * till's door (`GET stock`), every product, as badges over the copy.
 */
export function stockOf(v: unknown): Map<number, { state: 'in_stock' | 'low' | 'out' | 'untracked'; available: number | null }> {
  const out = new Map<number, { state: 'in_stock' | 'low' | 'out' | 'untracked'; available: number | null }>();
  for (const i of list(obj(v)?.items)) {
    const id = n(i.product_id);
    const st = s(i.stock_state);
    if (!Number.isInteger(id) || id <= 0) continue;
    const state = st === 'low' || st === 'out' || st === 'untracked' || st === 'in_stock' ? st : i.out_of_stock === true ? 'out' : i.low_stock === true ? 'low' : 'in_stock';
    out.set(id, { state, available: i.stock_available == null ? null : n(i.stock_available) });
  }
  return out;
}

export async function stockLevels(): Promise<ReturnType<typeof stockOf>> {
  return stockOf(await desk({ op: 'stock' }, 'Stock could not be read.'));
}
