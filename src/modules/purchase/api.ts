import type { QueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { docOf, PURCHASE_API, type ApprovalDoc } from '@shared/purchase';
import { can, num, withOrg } from '../inventory/api';
import type { OrderDetail, PurchaseOrder } from './buying';

/**
 * Purchasing's own calls (SRS-PUR-001 G-21). Orders, receipts, requests, RFQs, bills, payments, returns and vendors are
 * Inventory's tables on the server and keep their `/api/inventory/…` addresses (G-29: the code stays in Inventory, the
 * app is registered as `purchase`); what the purchasing build adds — submit, send and close, the cross-document
 * approvals queue, per-line award, the quality hold, payment runs, agreements, scorecards and the new reports — is
 * under `/api/purchase/…` (shared/purchase.ts). A server from before them answers 404, and the screens say so.
 */

type Q = Record<string, string | number | boolean | undefined>;
const bodyOrg = (org: string, body: object) => (org ? { org_id: Number(org), ...body } : body);

export const KP = {
  dash: (org: string) => ['purchase', 'dash', org] as const,
  approvals: (org: string) => ['purchase', 'approvals', org] as const,
  match: (id: number) => ['purchase', 'match', id] as const,
  rfqs: (org: string, status: string) => ['purchase', 'rfqs', org, status] as const,
  rfq: (id: number) => ['purchase', 'rfq', id] as const,
  comparison: (id: number) => ['purchase', 'comparison', id] as const,
  bills: (org: string, f: object) => ['purchase', 'bills', org, f] as const,
  bill: (id: number) => ['purchase', 'bill', id] as const,
  payables: (org: string) => ['purchase', 'payables', org] as const,
  payments: (org: string, f: object) => ['purchase', 'payments', org, f] as const,
  runs: (org: string) => ['purchase', 'runs', org] as const,
  run: (id: number) => ['purchase', 'run', id] as const,
  returns: (org: string, status: string) => ['purchase', 'returns', org, status] as const,
  ret: (id: number) => ['purchase', 'return', id] as const,
  qc: (org: string, status: string) => ['purchase', 'qc', org, status] as const,
  agreements: (org: string, status: string) => ['purchase', 'agreements', org, status] as const,
  agreement: (id: number) => ['purchase', 'agreement', id] as const,
  scorecard: (id: number, period: string) => ['purchase', 'scorecard', id, period] as const,
  report: (key: string, org: string, f: object) => ['purchase', 'report', key, org, f] as const,
  receivable: (org: string) => ['purchase', 'receivable', org] as const,
};

/** After a write: every Purchasing list, and Inventory's counts that read the same tables. */
export function refreshPurchase(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['purchase'] });
  void qc.invalidateQueries({ queryKey: ['inventory'] });
}

// ── who may do what (G-04) ──────────────────────────────────────────────

export interface PurchaseCan {
  /** Raise a purchase request. */
  request: boolean;
  /** Raise, edit, submit, send and close orders; RFQs; agreements. */
  order: boolean;
  /** Receive goods, hold and release them. */
  receive: boolean;
  /** Decide a step of an approval chain (the server says whether this person may decide this step). */
  approve: boolean;
  /** Enter and submit vendor bills; returns. */
  bill: boolean;
  /** Record payments and payment runs. */
  pay: boolean;
  /** Set payments against bills. */
  allocate: boolean;
  /** Purchasing › Settings. */
  settings: boolean;
  /** See stock costs. */
  cost: boolean;
}

/**
 * The narrow permissions of G-04 (docs/purchasing-core.md). `inventory.purchase` is the umbrella for the buying side
 * (request, order, receive) but not for paying: `payables.*` stand alone, which is what separates buying from paying.
 * `inventory.manage` and super-admin allow everything (Inventory's `can`). The server checks every one again.
 */
export function purchaseCan(perms: readonly string[] | undefined): PurchaseCan {
  const has = (p: string) => !!perms && (perms.includes('*') || perms.includes(p));
  const buyer = can(perms, 'inventory.purchase');
  const manager = can(perms, 'inventory.manage');
  return {
    request: buyer || has('purchase.request') || has('purchase.order'),
    order: buyer || has('purchase.order'),
    receive: buyer || has('purchase.receive'),
    approve: can(perms, 'inventory.approve'),
    bill: manager || has('payables.bill'),
    pay: manager || has('payables.pay'),
    allocate: manager || has('payables.allocate'),
    settings: can(perms, 'inventory.settings') || has('purchase.settings'),
    cost: can(perms, 'inventory.cost'),
  };
}

export function usePurchaseCan(): PurchaseCan {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  return purchaseCan(perms);
}

// ── offline ─────────────────────────────────────────────────────────────

/** Every write's reason while offline: the copy is read only; the server is the only place a document changes. */
export const OFFLINE_WRITE = 'You are offline. Purchasing is shown as last seen; changing it waits for the connection.';

/** True while WorkSuite cannot be reached. */
export function usePurchaseOffline(): boolean {
  return useStore(app, (s) => s.status?.network ?? null) === 'OFFLINE';
}

// ── dashboard (S-01) ────────────────────────────────────────────────────

export interface PurchaseDashboard {
  spend: Array<{ month: string; orders: number; committed: number }>;
  counts: Record<string, number>;
  values?: Record<string, number>;
  open_value: number | null;
  awaiting: { approval: number; receipt: number; billing: number; bill_okay?: number };
  payables: { buckets: Record<string, { label: string; amount: number; count: number }>; total: number; on_account?: number; net_owed?: number };
  top_vendors: Array<{ id: number; name: string; orders: number; committed: number | null }>;
  attention: {
    late_deliveries: Array<{ id: number; po_number: string; vendor: string | null; total: number | null; status: string; due: string; days_late: number }>;
    overdue_bills: Array<{ id: number; bill_number: string; vendor_invoice_no: string | null; vendor: string | null; outstanding: number | null; due_date: string; days_late: number }>;
  };
  currency?: string | null;
}

export const fetchDashboard = (org: string, signal?: AbortSignal) => apiGet<PurchaseDashboard>('/api/inventory/purchase/dashboard', withOrg(org), signal);

// ── the approvals queue (G-14) ──────────────────────────────────────────

export interface QueueItem {
  doc: ApprovalDoc;
  id: number;
  number: string;
  vendor: string | null;
  total: number | null;
  currency: string | null;
  step: number | null;
  steps: number | null;
  label: string | null;
  requested_by: string | null;
  created_at: string | null;
}

/** One row of `GET /api/purchase/approvals`, however it names the document; null for one this app cannot open. */
export function queueItemOf(r: unknown): QueueItem | null {
  if (!r || typeof r !== 'object') return null;
  const x = r as Record<string, unknown>;
  const doc = docOf(x.doc_type ?? x.doc ?? x.document ?? x.type ?? x.entity_type);
  const id = num(x.id ?? x.entity_id);
  if (!doc || !id) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    doc,
    id,
    number: str(x.number) ?? str(x.reference) ?? str(x.po_number) ?? str(x.bill_number) ?? `#${id}`,
    vendor: str(x.vendor),
    total: num(x.amount ?? x.total),
    currency: str(x.currency),
    step: num(x.step) || null,
    steps: num(x.steps ?? x.step_count),
    label: str(x.step_label) ?? str(x.label) ?? str(x.level),
    requested_by: str(x.requester) ?? str(x.requested_by) ?? str(x.requested_by_name) ?? str(x.created_by_name),
    created_at: str(x.submitted_at) ?? str(x.created_at),
  };
}

export const fetchApprovals = (org: string, signal?: AbortSignal) =>
  apiGet<{ items?: unknown[]; approvals?: unknown[] } | unknown[]>(`${PURCHASE_API}/approvals`, withOrg(org, { mine: 1 }), signal).then((r) =>
    (Array.isArray(r) ? r : (r.items ?? r.approvals ?? [])).map(queueItemOf).filter((x): x is QueueItem => !!x),
  );

// ── orders: what the purchasing build adds (G-01, G-05, G-06, G-13, G-02, G-03) ─────

export interface MatchRow {
  line_id: number;
  code: string | null;
  description: string;
  unit: string | null;
  ordered: number;
  received: number;
  returned: number;
  billed: number;
  to_receive: number;
  to_bill: number;
  unit_cost: number | null;
  landed_unit_cost: number | null;
  issues: string[];
}

export interface Duplicate {
  id: number;
  number: string;
  vendor: string | null;
  total: number | null;
  date: string | null;
  score: number | null;
  why: string[] | string | null;
}

/** An order as its show answers it, with what the purchasing build adds where the server sends it. */
export type OrderFull = OrderDetail & {
  order: PurchaseOrder & {
    exchange_rate?: number | string | null;
    base_currency?: string | null;
    base_total?: number | string | null;
    billed_total?: number | string | null;
    paid_total?: number | string | null;
    closed_reason?: string | null;
  };
  bills?: Array<{ id: number; bill_number: string; vendor_invoice_no?: string | null; status: string; due_date?: string | null; total: number | string | null; paid_total?: number | string | null }>;
  returns?: Array<{ id: number; reference: string; status: string; total_value?: number | string | null }>;
  /** The chain as the purchasing build sends it (G-01). */
  approval?: unknown;
  /** The chain as an older server sends it. */
  approvals?: unknown;
  match?: { rows: MatchRow[]; matched: boolean } | null;
  duplicates?: Duplicate[];
};

export const fetchOrderFull = (id: number, signal?: AbortSignal) => apiGet<OrderFull>(`/api/inventory/purchase-orders/${id}`, undefined, signal);
export const fetchMatch = (id: number, signal?: AbortSignal) =>
  apiGet<{ lines?: MatchRow[]; rows?: MatchRow[]; matched: boolean }>(`/api/inventory/purchase/match/${id}`, undefined, signal).then((r) => ({ rows: r.rows ?? r.lines ?? [], matched: !!r.matched }));
/** Send (G-05): 422 `not_sent` when no channel delivered it, unless `mark_sent` (it went another way). */
export const sendOrder = (id: number, body: { to: string[]; cc: string[]; subject?: string; message: string; attach_pdf: boolean; portal_link: boolean; whatsapp?: boolean; whatsapp_to?: string; mark_sent?: boolean }) =>
  apiPost<{ order?: PurchaseOrder; result?: unknown }>(`${PURCHASE_API}/orders/${id}/send`, body);
export const closeOrder = (id: number, reason: string) => apiPost<{ order?: PurchaseOrder }>(`${PURCHASE_API}/orders/${id}/close`, { reason: reason.trim() });

/** What an order's money is in the company's own: the rate captured on it (G-02). Null when it is in base already. */
export function fxOf(o: Pick<OrderFull['order'], 'currency' | 'exchange_rate' | 'base_currency' | 'base_total' | 'total'>, companyCurrency: string | null): { currency: string; rate: number; base: string; baseTotal: number | null } | null {
  const rate = num(o.exchange_rate);
  const base = o.base_currency ?? companyCurrency;
  if (!o.currency || !base || o.currency === base || !rate || rate <= 0) return null;
  const total = num(o.total);
  return { currency: o.currency, rate, base, baseTotal: num(o.base_total) ?? (total !== null ? Math.round(total * rate * 100) / 100 : null) };
}

/** The share of the order's freight, insurance and duty each unit carries, by line: the match's landed cost less the unit price (G-03). */
export function landedShare(r: Pick<MatchRow, 'unit_cost' | 'landed_unit_cost'>): number | null {
  if (r.unit_cost === null || r.landed_unit_cost === null) return null;
  const s = Math.round((Number(r.landed_unit_cost) - Number(r.unit_cost)) * 100) / 100;
  return s > 0 ? s : 0;
}

// ── requests (S-02) ─────────────────────────────────────────────────────

export const createRequest = (org: string, body: { warehouse_id: number; needed_by: string | null; reason: string | null; lines: Array<{ product_id: number; quantity: number; note?: string | null }> }) =>
  apiPost<{ id?: number; request?: { id: number } }>('/api/inventory/requests', bodyOrg(org, body));

// ── RFQs (S-02, G-17) ───────────────────────────────────────────────────

export interface Rfq {
  id: number;
  reference: string;
  title: string | null;
  status: string;
  warehouse: string | null;
  request_id: number | null;
  issue_date: string | null;
  closing_date: string | null;
  line_count: number;
  invited: number;
  responded: number;
  awarded_vendor: string | null;
  created_by_name: string | null;
}

export const fetchRfqs = (org: string, status: string, signal?: AbortSignal) =>
  apiGet<{ quotations: Rfq[]; total: number }>('/api/inventory/quotations', withOrg(org, { status: status || undefined, per_page: 100 } as Q), signal).then((r) => r.quotations ?? []);
export const fetchRfq = (id: number, signal?: AbortSignal) =>
  apiGet<{ quotation: Rfq & { notes?: string | null; award_reason?: string | null }; lines: Array<{ id: number; product_name: string | null; description: string; code: string | null; quantity: number | string; unit: string | null }>; bids: Array<{ id: number; vendor: string; vendor_id: number; status: string; currency: string; total: number | string | null; lead_time_days: number | null; responded_at: string | null }> }>(
    `/api/inventory/quotations/${id}`,
    undefined,
    signal,
  );
export const rfqFromRequest = (requestId: number) => apiPost<{ id?: number; quotation?: { id: number } }>(`/api/inventory/quotations/from-request/${requestId}`, {});
export const sendRfq = (id: number) => apiPost<unknown>(`${PURCHASE_API}/rfqs/${id}/send`, {});

// ── bills and payables (S-08, S-09) ─────────────────────────────────────

export interface Bill {
  id: number;
  bill_number: string;
  vendor_invoice_no: string | null;
  vendor_id: number;
  vendor: string | null;
  po_id: number | null;
  po_number: string | null;
  kind: string;
  status: string;
  bill_date: string | null;
  due_date: string | null;
  currency: string;
  total: number | null;
  paid_total: number | null;
  outstanding?: number | null;
  dispute_note: string | null;
  match_state?: string | null;
}

export const BILL_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Waiting on approval',
  pending: 'Waiting on approval',
  approved: 'Approved',
  part_paid: 'Part paid',
  partial: 'Part paid',
  paid: 'Paid',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
};
export const billTone = (s: string): 'grey' | 'amber' | 'blue' | 'green' | 'red' =>
  s === 'paid' ? 'green' : s === 'disputed' ? 'red' : s === 'submitted' || s === 'pending' || s === 'part_paid' || s === 'partial' ? 'amber' : s === 'approved' ? 'blue' : 'grey';

export const fetchBills = (org: string, f: { status: string; vendor?: number | null; page: number }, signal?: AbortSignal) =>
  apiGet<{ bills: Bill[]; total: number }>('/api/inventory/bills', withOrg(org, { status: f.status || undefined, vendor_id: f.vendor ?? undefined, page: f.page, per_page: 50 } as Q), signal).then((r) => ({ rows: r.bills ?? [], total: num(r.total) ?? 0 }));
export const fetchBill = (id: number, signal?: AbortSignal) =>
  apiGet<{
    bill: Bill & { notes?: string | null; subtotal?: number | null; tax_total?: number | null };
    lines: Array<{ id: number; description: string; code: string | null; quantity: number; unit: string | null; unit_cost: number | null; line_total: number; ordered_qty?: number; received_qty?: number; billed_qty?: number }>;
    approvals?: unknown;
    approval?: unknown;
    payments?: Array<{ id: number; reference: string; paid_on: string; amount: number; method: string }>;
    may_approve?: boolean;
  }>(`/api/inventory/bills/${id}`, undefined, signal);

/** Ageing of what is owed, per currency with a base total where the server gives one (G-02), else in one. */
export interface Payables {
  buckets: Record<string, { label: string; amount: number; count: number }>;
  total: number;
  currencies?: Array<{ currency: string; buckets: Record<string, { label: string; amount: number; count: number }>; total: number; base_total?: number | null }>;
  base_currency?: string | null;
  base_total?: number | null;
  /** Owed in more than one currency. */
  mixed?: boolean;
  on_account?: number;
}
export const fetchPayables = (org: string, signal?: AbortSignal) => apiGet<Payables>(`${PURCHASE_API}/payables`, withOrg(org), signal);

export interface Payment {
  id: number;
  reference: string;
  vendor_id: number;
  vendor: string | null;
  paid_on: string;
  method: string;
  currency: string;
  amount: number;
  unallocated: number;
  bank_reference: string | null;
  allocation_count: number;
  run_id?: number | null;
}
export const fetchPayments = (org: string, f: { page: number }, signal?: AbortSignal) =>
  apiGet<{ payments: Payment[]; total: number }>('/api/inventory/payments', withOrg(org, { page: f.page, per_page: 50 }), signal).then((r) => ({ rows: r.payments ?? [], total: num(r.total) ?? 0 }));
export const recordPayment = (org: string, body: { vendor_id: number; amount: number; method: string; paid_on: string; bank_reference: string | null; note: string | null; currency?: string | null; exchange_rate?: number | null }) =>
  apiPost<{ id: number }>('/api/inventory/payments', bodyOrg(org, body));
export const allocateOldest = (paymentId: number) => apiPost<unknown>(`/api/inventory/payments/${paymentId}/allocate`, { auto: true });

// ── payment runs (G-20) ─────────────────────────────────────────────────

export interface PaymentRun {
  id: number;
  reference: string;
  status: string;
  currency: string | null;
  total: number | null;
  bill_count: number;
  due_by: string | null;
  pay_on: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  exported_at: string | null;
  paid_at: string | null;
  /** True for whoever proposed it: somebody else approves it. */
  mine?: boolean;
  /** The server's answer: may I approve it (an approver, and not whoever proposed it). */
  can_approve?: boolean;
  bills?: Array<{ id: number; bill_number: string; vendor: string | null; due_date: string | null; amount: number; currency: string | null; bank?: string | null }>;
}

/** A run as the server's row has it (`pay_date`, `created_by`, `approved_by` as names, `can_approve`), in the screen's words. */
export function runOf(raw: unknown, bills?: unknown): PaymentRun {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const out = { ...(r as unknown as PaymentRun) };
  out.pay_on = str(r.pay_on) ?? str(r.pay_date);
  out.due_by = str(r.due_by) ?? str((r.filters as Record<string, unknown> | null)?.due_by);
  out.created_by_name = str(r.created_by_name) ?? str(r.created_by);
  out.approved_by_name = str(r.approved_by_name) ?? str(r.approved_by);
  if (typeof r.can_approve === 'boolean') out.can_approve = r.can_approve;
  if (Array.isArray(bills ?? r.bills)) {
    out.bills = ((bills ?? r.bills) as Array<Record<string, unknown>>).map((b) => ({
      id: Number(b.id),
      bill_number: String(b.bill_number ?? ''),
      vendor: b.vendor && typeof b.vendor === 'object' ? String((b.vendor as { name?: unknown }).name ?? '') : str(b.vendor),
      due_date: str(b.due_date),
      amount: Number(b.amount ?? 0),
      currency: str(b.currency),
      bank: str(b.bank),
    }));
  }
  return out;
}
export const fetchRuns = (org: string, signal?: AbortSignal) =>
  apiGet<{ runs?: unknown[] }>(`${PURCHASE_API}/payment-runs`, withOrg(org), signal).then((r) => (r.runs ?? []).map((x) => runOf(x)));
export const fetchRun = (id: number, signal?: AbortSignal) => apiGet<{ run: unknown; bills?: unknown[] }>(`${PURCHASE_API}/payment-runs/${id}`, undefined, signal).then((r) => runOf(r.run, r.bills ?? []));
export const proposeRun = (org: string, body: { due_by: string; pay_date: string; vendor_id?: number | null; currency?: string | null }) =>
  apiPost<{ run?: { id: number } }>(`${PURCHASE_API}/payment-runs`, bodyOrg(org, body));
export const approveRun = (id: number) => apiPost<{ run?: PaymentRun }>(`${PURCHASE_API}/payment-runs/${id}/approve`, {});
export const markRunPaid = (id: number, body: { paid_on: string; bank_reference: string | null }) => apiPost<{ run?: PaymentRun }>(`${PURCHASE_API}/payment-runs/${id}/mark-paid`, body);

// ── returns (S-07, G-19) ────────────────────────────────────────────────

export interface PurchaseReturn {
  id: number;
  reference: string;
  vendor: string | null;
  po_id: number | null;
  po_number: string | null;
  grn_id: number | null;
  warehouse: string | null;
  status: string;
  reason: string;
  settlement: string;
  return_date: string | null;
  total_value: number | null;
  carrier: string | null;
  tracking_no: string | null;
  notes?: string | null;
}
export const RETURN_REASONS = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'expired', label: 'Expired' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'over_supply', label: 'Over-supplied' },
  { value: 'quality', label: 'Quality' },
  { value: 'not_required', label: 'No longer needed' },
  { value: 'other', label: 'Other' },
];
export const SETTLEMENTS = [
  { value: 'credit', label: 'Debit note against them' },
  { value: 'replacement', label: 'Replacement' },
  { value: 'refund', label: 'Refund' },
];
export const fetchReturns = (org: string, status: string, signal?: AbortSignal) =>
  apiGet<{ returns: PurchaseReturn[] }>('/api/inventory/returns', withOrg(org, { status: status || undefined, per_page: 100 } as Q), signal).then((r) => r.returns ?? []);
export const fetchReturn = (id: number, signal?: AbortSignal) =>
  apiGet<{ return: PurchaseReturn; lines: Array<{ id: number; product_name: string | null; code: string | null; quantity: number; unit: string | null; line_total: number | null; batch_no: string | null }>; approvals?: unknown; approval?: unknown; may_approve?: boolean }>(
    `/api/inventory/returns/${id}`,
    undefined,
    signal,
  );
export const createReturn = (org: string, body: { grn_id: number; warehouse_id: number; reason: string; settlement: string; notes: string | null }) =>
  apiPost<{ return?: { id: number }; id?: number }>('/api/inventory/returns', bodyOrg(org, body));
export const returnAct = (id: number, act: 'approve' | 'ship' | 'debit-note' | 'cancel', body: object = {}) => apiPost<unknown>(`/api/inventory/returns/${id}/${act}`, body);

// ── quality hold (G-07) ─────────────────────────────────────────────────

export interface QcItem {
  id: number;
  grn_id: number | null;
  grn_number: string | null;
  po_id: number | null;
  po_number: string | null;
  vendor: string | null;
  product: string;
  code: string | null;
  quantity: number;
  unit: string | null;
  warehouse: string | null;
  bin: string | null;
  batch_no: string | null;
  status: string;
  held_at: string | null;
  note: string | null;
}

/** One hold as `GET /api/purchase/qc` sends it (`receipt_id`, `qty` still open, `vendor {id, name}`, `batch`). */
export function qcItemOf(raw: unknown): QcItem {
  const x = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const vendor = x.vendor && typeof x.vendor === 'object' ? str((x.vendor as { name?: unknown }).name) : str(x.vendor);
  return {
    id: Number(x.id),
    grn_id: num(x.receipt_id ?? x.grn_id),
    grn_number: str(x.receipt_number) ?? str(x.grn_number),
    po_id: num(x.po_id),
    po_number: str(x.po_number),
    vendor,
    product: str(x.product) ?? str(x.code) ?? 'Item',
    code: str(x.code),
    quantity: num(x.qty ?? x.quantity) ?? 0,
    unit: str(x.unit),
    warehouse: str(x.warehouse),
    bin: str(x.bin),
    batch_no: str(x.batch) ?? str(x.batch_no),
    status: str(x.status) ?? 'held',
    held_at: str(x.received_at) ?? str(x.held_at),
    note: str(x.note),
  };
}
export const fetchQc = (org: string, status: string, signal?: AbortSignal) =>
  apiGet<{ items?: unknown[]; reasons?: string[] }>(`${PURCHASE_API}/qc`, withOrg(org, { status: status || 'all' } as Q), signal).then((r) => ({ items: (r.items ?? []).map(qcItemOf), reasons: r.reasons ?? [] }));
export const releaseQc = (id: number) => apiPost<unknown>(`${PURCHASE_API}/qc/${id}/release`, {});
export const rejectQc = (id: number, body: { reason: string; note?: string | null; return: boolean }) => apiPost<{ return_id?: number | null }>(`${PURCHASE_API}/qc/${id}/reject`, body);

// ── agreements (G-18) ───────────────────────────────────────────────────

export interface Agreement {
  id: number;
  reference: string;
  kind: string;
  vendor_id: number;
  vendor: string | null;
  status: string;
  valid_from: string | null;
  valid_to: string | null;
  currency: string | null;
  cap: number | null;
  released: number | null;
  remaining: number | null;
  schedule: string | null;
  next_run: string | null;
  lines?: Array<{ id: number; product_id: number | null; product: string | null; code: string | null; unit_price: number | null; max_qty: number | null; released_qty: number | null }>;
}

/** An agreement as the server sends it (`type`, `vendor {id, name}`, lines with `unit_cost`, a schedule object). */
export function agreementOf(raw: unknown): Agreement {
  const a = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const sched = a.schedule && typeof a.schedule === 'object' ? (a.schedule as Record<string, unknown>) : null;
  return {
    id: Number(a.id),
    reference: str(a.reference) ?? str(a.number) ?? `#${String(a.id)}`,
    kind: str(a.type) ?? str(a.kind) ?? 'blanket',
    vendor_id: Number(a.vendor_id),
    vendor: a.vendor && typeof a.vendor === 'object' ? str((a.vendor as { name?: unknown }).name) : str(a.vendor),
    status: str(a.status) ?? 'active',
    valid_from: str(a.valid_from),
    valid_to: str(a.valid_to),
    currency: str(a.currency),
    cap: num(a.cap),
    released: num(a.released),
    remaining: num(a.remaining),
    schedule: sched ? (sched.active === false ? null : `${str(sched.frequency) ?? 'on a schedule'}`) : str(a.schedule),
    next_run: sched ? str(sched.next_run) : str(a.next_run),
    lines: Array.isArray(a.lines)
      ? (a.lines as Array<Record<string, unknown>>).map((l) => ({
          id: Number(l.id),
          product_id: num(l.product_id),
          product: str(l.product) ?? str(l.description),
          code: str(l.code),
          unit_price: num(l.unit_price ?? l.unit_cost),
          max_qty: num(l.max_qty ?? l.qty_cap),
          released_qty: num(l.released_qty),
        }))
      : undefined,
  };
}
export const fetchAgreements = (org: string, status: string, signal?: AbortSignal) =>
  apiGet<{ agreements: unknown[] }>(`${PURCHASE_API}/agreements`, withOrg(org, { status: status || undefined } as Q), signal).then((r) => (r.agreements ?? []).map(agreementOf));
export const fetchAgreement = (id: number, signal?: AbortSignal) => apiGet<{ agreement: unknown }>(`${PURCHASE_API}/agreements/${id}`, undefined, signal).then((r) => agreementOf(r.agreement));
export const saveAgreement = (org: string, id: number | null, body: Record<string, unknown>) =>
  (id ? apiPut<{ agreement: unknown }>(`${PURCHASE_API}/agreements/${id}`, body) : apiPost<{ agreement: unknown }>(`${PURCHASE_API}/agreements`, bodyOrg(org, body))).then((r) => ({ agreement: agreementOf(r.agreement) }));
export const releaseAgreement = (id: number, lines: Array<{ agreement_line_id: number; qty: number }>) =>
  apiPost<{ order?: { id: number; number?: string; po_number?: string } }>(`${PURCHASE_API}/agreements/${id}/release`, { lines });

// ── vendor scorecard (G-25) ─────────────────────────────────────────────

export interface Scorecard {
  on_time: number | null;
  lead_time: number | null;
  rejection_rate: number | null;
  price_variance: number | null;
  response_time: number | null;
  score: number | null;
  weights: Record<string, number>;
}
export const fetchScorecard = (vendorId: number, period: string, signal?: AbortSignal) => apiGet<Scorecard>(`${PURCHASE_API}/vendors/${vendorId}/scorecard`, { period }, signal);

// ── reports (S-11, G-26) ────────────────────────────────────────────────

export interface ReportTable {
  columns: Array<{ key: string; label: string; kind?: 'money' | 'number' | 'percent' | 'text' | 'days' }>;
  rows: Array<Record<string, unknown>>;
  total?: Record<string, unknown> | null;
  /** The server's words on how it was worked out (`basis`), and the formats it can export. */
  basis?: string | null;
  formats?: string[];
}

const LABELS: Record<string, string> = {
  label: 'Name',
  name: 'Name',
  orders: 'Orders',
  net: 'Spend',
  spend: 'Spend',
  share: 'Share',
  quantity: 'Quantity',
  receipts: 'Receipts',
  on_time_pct: 'On time',
  avg_lead_days: 'Lead time',
  reject_pct: 'Rejected',
  days: 'Days',
  avg_days: 'Average days',
  savings: 'Savings',
  target: 'Target',
  awarded: 'Awarded',
  amount: 'Amount',
};

/** Any report's answer as columns and rows: the server's own columns when it sends them, else from its first row. */
export function reportTable(r: unknown): ReportTable {
  const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const rows = (Array.isArray(x.rows) ? x.rows : Array.isArray(x.data) ? x.data : Array.isArray(r) ? r : []).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
  const first = rows[0] ?? {};
  // A column's kind: the server's when it names one, else what its key and first value say.
  const kindOf = (k: string): ReportTable['columns'][number]['kind'] =>
    k.endsWith('pct') || k === 'share' ? 'percent' : typeof first[k] === 'number' ? (/(net|spend|amount|total|value|savings|cost|ordered|received|billed|committed)/.test(k) ? 'money' : /(days|_to_)/.test(k) ? 'days' : 'number') : 'text';
  const total = ((x.totals ?? x.total) as Record<string, unknown> | undefined) ?? null;
  const extra = { basis: typeof x.basis === 'string' ? x.basis : null, formats: Array.isArray(x.formats) ? (x.formats as string[]) : undefined };
  if (Array.isArray(x.columns) && x.columns.length) {
    const columns = (x.columns as Array<Record<string, unknown>>).map((c) => ({ key: String(c.key), label: String(c.label ?? c.key), kind: ((c.kind ?? c.type) as ReportTable['columns'][number]['kind']) ?? kindOf(String(c.key)) }));
    return { columns, rows, total, ...extra };
  }
  const columns = Object.keys(first)
    .filter((k) => k !== 'id' && !k.endsWith('_id'))
    .map((k) => ({ key: k, label: LABELS[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), kind: kindOf(k) }));
  return { columns, rows, total, ...extra };
}

export const fetchReport = (key: string, org: string, f: { from: string; to: string; by?: string }, signal?: AbortSignal) => {
  // The established ones answer at Inventory's analytics; the new ones (G-26) at Purchasing's.
  if (key === 'spend') return apiGet<unknown>('/api/inventory/purchase/spend', withOrg(org, { by: f.by ?? 'vendor', from: f.from, to: f.to }), signal).then(reportTable);
  if (key === 'vendor-performance') return apiGet<unknown>('/api/inventory/purchase/vendor-performance', withOrg(org, { from: f.from, to: f.to }), signal).then(reportTable);
  return apiGet<unknown>(`${PURCHASE_API}/reports/${key}`, withOrg(org, { from: f.from, to: f.to }), signal).then(reportTable);
};

// ── settings (G-12, G-30) ───────────────────────────────────────────────

export const fetchSettings = (org: string, signal?: AbortSignal) => apiGet<{ settings: Record<string, unknown>; org_id: number | null; overridden: string[] }>(`${PURCHASE_API}/settings`, withOrg(org), signal);
