import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { grouped } from './api';

/**
 * A tender's Expenses tab (worksuite-desktop#159): the expense claims linked
 * to the bid through the claim's own "Linked to", read through the Tender
 * module's `/api/tenders/{id}/expenses`, which asks the Expense module and
 * applies its rules about who sees whose claims.
 *
 * THE FIGURES ARE THE SERVER'S. The cards — total spent, pending approval,
 * reimbursable, budget against actual — come back already added up, by status
 * and by category, from the same filter as the rows. Nothing here sums the rows
 * it happens to have loaded.
 *
 * Its query key sits under `['expenses', …]` as well as being refreshed with the
 * tender's: anything the Expenses module invalidates when a claim is decided,
 * paid or edited — and the realtime nudge `expense.claim.changed` — reaches
 * this tab without it knowing who changed what.
 */

const int = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const yes = (v: unknown) => v === true || v === 1 || v === '1';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);

export const KE = {
  tab: (id: number) => ['expenses', 'tender', id] as const,
  linkable: (id: number, q: string) => ['expenses', 'tender', id, 'linkable', q] as const,
  report: (org: string, from: string, to: string) => ['tenders', 'report', 'bid-cost', org, from, to] as const,
};

/** The quick categories, in the order the tab offers them; the server resolves each to the company's live category. */
export const QUICK = ['Bid document fee', 'Bid bond / security', 'Printing & binding', 'Courier', 'Travel', 'Site visit', 'Stamp duty', 'Other'] as const;

export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'processing' | 'paid' | 'rejected';

export const STATUS: Record<string, { label: string; tone: 'grey' | 'blue' | 'amber' | 'green' | 'red' }> = {
  draft: { label: 'Draft', tone: 'grey' },
  submitted: { label: 'Submitted', tone: 'amber' },
  approved: { label: 'Approved', tone: 'blue' },
  processing: { label: 'Being paid', tone: 'blue' },
  paid: { label: 'Paid', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
};

export const statusOf = (s: string) => STATUS[s] ?? { label: s ? s[0]!.toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—', tone: 'grey' as const };

export interface TenderExpense {
  id: number;
  claim_no: string | null;
  spent_on: string | null;
  category: string | null;
  category_id: number | null;
  description: string;
  claimant: string | null;
  user_id: number | null;
  amount: string | null;
  currency: string;
  base_amount: string | null;
  base_currency: string;
  status: string;
  has_receipt: boolean;
  refundable: boolean;
  refunded: boolean;
}

export interface Totals {
  count: number;
  currency: string | null;
  unconverted: number;
  spent: string;
  pending: string;
  reimbursable: string;
  paid: string;
  rejected: string;
  refundable: string;
  refunded: string;
  written_off: string;
  by_status: Record<string, { count: number; sum: string }>;
  by_category: Array<{ category_id: number | null; name: string; count: number; sum: string }>;
}

export interface Variance {
  spent: string;
  planned: string;
  percent: number;
  over: boolean;
  remaining: string;
}

export interface ExpenseCan {
  view: boolean;
  create: boolean;
  link: boolean;
  unlink: boolean;
  refund: boolean;
  budget: boolean;
}

export interface TenderExpenses {
  visible: boolean;
  why: string | null;
  can: ExpenseCan;
  org_id: number | null;
  items: TenderExpense[];
  total: number;
  totals: Totals | null;
  currency: string | null;
  planned: { amount: string; currency: string } | null;
  variance: Variance | null;
  written_off: string | null;
  categories: Array<{ name: string; id: number | null; refundable: boolean }>;
  prefill: Record<string, number>;
}

const NO: ExpenseCan = { view: false, create: false, link: false, unlink: false, refund: false, budget: false };

export function toExpense(r: Record<string, unknown>): TenderExpense {
  return {
    id: int(r.id) ?? 0,
    claim_no: str(r.claim_no),
    spent_on: str(r.spent_on),
    category: str(r.category),
    category_id: int(r.category_id),
    description: String(r.description ?? '').replace(/\s*\[cb:[^\]]*\]\s*$/, ''),
    claimant: str(r.claimant),
    user_id: int(r.user_id),
    amount: str(r.amount),
    currency: String(r.currency ?? ''),
    base_amount: str(r.base_amount),
    base_currency: String(r.base_currency ?? ''),
    status: String(r.status ?? ''),
    has_receipt: int(r.receipt_file_id) !== null,
    refundable: yes(r.refundable),
    refunded: str(r.refunded_at) !== null,
  };
}

export function toTotals(v: unknown): Totals | null {
  const t = obj(v);
  if (!Object.keys(t).length) return null;
  const s = (k: string) => String(t[k] ?? '0.00');
  return {
    count: int(t.count) ?? 0,
    currency: str(t.currency),
    unconverted: int(t.unconverted) ?? 0,
    spent: s('spent'),
    pending: s('pending'),
    reimbursable: s('reimbursable'),
    paid: s('paid'),
    rejected: s('rejected'),
    refundable: s('refundable'),
    refunded: s('refunded'),
    written_off: s('written_off'),
    by_status: Object.fromEntries(Object.entries(obj(t.by_status)).map(([k, x]) => [k, { count: int(obj(x).count) ?? 0, sum: String(obj(x).sum ?? '0.00') }])),
    by_category: list(t.by_category).map((c) => ({ category_id: int(c.category_id), name: String(c.name ?? 'Uncategorised'), count: int(c.count) ?? 0, sum: String(c.sum ?? '0.00') })),
  };
}

export function toVariance(v: unknown): Variance | null {
  const x = obj(v);
  if (!Object.keys(x).length) return null;
  return { spent: String(x.spent ?? '0.00'), planned: String(x.planned ?? '0.00'), percent: Number(x.percent ?? 0) || 0, over: yes(x.over), remaining: String(x.remaining ?? '0.00') };
}

export function toTenderExpenses(d: Record<string, unknown>): TenderExpenses {
  const planned = obj(d.planned);
  return {
    visible: d.visible === undefined ? true : yes(d.visible),
    why: str(d.why),
    can: { ...NO, ...Object.fromEntries(Object.entries(obj(d.can)).map(([k, v]) => [k, yes(v)])) },
    org_id: int(d.org_id),
    items: list(d.items).map(toExpense),
    total: int(d.total) ?? 0,
    totals: toTotals(d.totals),
    currency: str(d.currency),
    planned: planned.amount !== undefined ? { amount: String(planned.amount), currency: String(planned.currency ?? '') } : null,
    variance: toVariance(d.variance),
    written_off: str(d.written_off),
    categories: list(d.categories).map((c) => ({ name: String(c.name ?? ''), id: int(c.id), refundable: yes(c.refundable) })),
    prefill: Object.fromEntries(Object.entries(obj(d.prefill)).filter(([, v]) => int(v) !== null).map(([k, v]) => [k, int(v)!])),
  };
}

export const fetchTenderExpenses = (id: number, signal?: AbortSignal) => apiGet<Record<string, unknown>>(`/api/tenders/${id}/expenses`, undefined, signal).then((d) => toTenderExpenses(d ?? {}));

export const fetchLinkable = (id: number, q: string, signal?: AbortSignal) =>
  apiGet<{ items?: Array<Record<string, unknown>> }>(`/api/tenders/${id}/expenses/linkable`, q ? { q } : undefined, signal).then((d) => list(d?.items).map(toExpense));

export const linkExpense = (id: number, claimId: number) => apiPost(`/api/tenders/${id}/expenses/link`, { claim_id: claimId });
export const unlinkExpense = (id: number, claimId: number) => apiDelete(`/api/tenders/${id}/expenses/${claimId}`);
export const markRefunded = (id: number, claimId: number, note?: string) => apiPost(`/api/tenders/${id}/expenses/${claimId}/refunded`, note ? { note } : {});
export const saveBidBudget = (id: number, amount: string) => apiPut<{ planned?: { amount: string; currency: string } | null }>(`/api/tenders/${id}/bid-budget`, { amount: amount.replace(/[,\s]/g, '') });

// ── words ───────────────────────────────────────────────────────────────

/** "18500.00" as "18,500"; "2500.50" as "2,500.50" — through the text, never a float. */
export function whole(v: string | number | null | undefined): string {
  const g = grouped(v);
  if (g === null) return '—';
  return g.endsWith('.00') ? g.slice(0, -3) : g;
}

/** A figure in its currency, grouped, without empty cents. */
export const amount = (v: string | number | null | undefined, ccy: string | null | undefined) => {
  const w = whole(v);
  return w === '—' ? w : `${ccy ? `${ccy} ` : ''}${w}`;
};

/** "Spent LKR 18,500 of LKR 25,000 planned (74%)". */
export function varianceLine(v: Variance, ccy: string | null | undefined): string {
  return `Spent ${amount(v.spent, ccy)} of ${amount(v.planned, ccy)} planned (${v.percent}%)`;
}

/** The over-budget warning, or nothing while within plan. */
export function overBy(v: Variance | null, ccy: string | null | undefined): string | null {
  if (!v || !v.over) return null;
  return `Over the bid budget by ${amount(v.remaining.replace(/^-/, ''), ccy)}.`;
}

/** The tab's name, with how many are linked: "Expenses · 3", or the bare word for none. */
export const expensesTabLabel = (n: number | null | undefined) => (n ? `Expenses · ${n}` : 'Expenses');

/** The Expense form's opening values from here: the tender (locked by the form), its project if it has one, a quick category. */
export function presetFor(prefill: Record<string, number>, categoryId: number | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (prefill.tender_id) out.tender_id = prefill.tender_id;
  if (prefill.project_id) out.project_id = prefill.project_id;
  if (categoryId) out.category_id = categoryId;
  return out;
}

// ── the report ──────────────────────────────────────────────────────────

export interface BidCostRow {
  id: number;
  reference: string | null;
  title: string;
  stage_label: string;
  outcome: string;
  bid_cost: string;
  expenses: number;
}

export interface BidCostReport {
  visible: boolean;
  why: string | null;
  currency: string | null;
  total: string;
  by_outcome: Record<'won' | 'lost' | 'open' | 'cancelled', { count: number; cost: string; with_cost: number }>;
  cost_per_win: string | null;
  rows: BidCostRow[];
  note: string | null;
}

export function toBidCostReport(d: Record<string, unknown>): BidCostReport {
  const by = obj(d.by_outcome);
  const one = (k: string) => ({ count: int(obj(by[k]).count) ?? 0, cost: String(obj(by[k]).cost ?? '0.00'), with_cost: int(obj(by[k]).with_cost) ?? 0 });
  return {
    visible: d.visible === undefined ? true : yes(d.visible),
    why: str(d.why),
    currency: str(d.currency),
    total: String(d.total ?? '0.00'),
    by_outcome: { won: one('won'), lost: one('lost'), open: one('open'), cancelled: one('cancelled') },
    cost_per_win: str(d.cost_per_win),
    rows: list(d.rows).map((r) => ({
      id: int(r.id) ?? 0,
      reference: str(r.reference),
      title: String(r.title ?? ''),
      stage_label: String(r.stage_label ?? ''),
      outcome: String(r.outcome ?? 'open'),
      bid_cost: String(r.bid_cost ?? '0.00'),
      expenses: int(r.expenses) ?? 0,
    })),
    note: str(d.note),
  };
}

export const fetchBidCostReport = (org: string, from: string, to: string, signal?: AbortSignal) =>
  apiGet<Record<string, unknown>>('/api/tender/reports/bid-cost', { ...(org ? { org } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }, signal).then((d) => toBidCostReport(d ?? {}));

// ── the tender's own payload ────────────────────────────────────────────

export interface BidCostSummary {
  visible: boolean;
  why: string | null;
  totals: Totals | null;
  currency: string | null;
  planned: { amount: string; currency: string } | null;
  variance: Variance | null;
  written_off: string | null;
}

/** `bid_cost` on `/api/tenders/{id}`, or null from a server that does not send it. */
export function toBidCost(v: unknown): BidCostSummary | null {
  const d = obj(v);
  if (!Object.keys(d).length) return null;
  const planned = obj(d.planned);
  return {
    visible: yes(d.visible),
    why: str(d.why),
    totals: toTotals(d.totals),
    currency: str(d.currency),
    planned: planned.amount !== undefined ? { amount: String(planned.amount), currency: String(planned.currency ?? '') } : null,
    variance: toVariance(d.variance),
    written_off: str(d.written_off),
  };
}

/** One line of the tender's history about an expense. */
export interface ExpenseHistoryLine {
  id: number;
  kind: string;
  body: string;
  actor: string | null;
  at: string;
}

export const toExpenseHistory = (v: unknown): ExpenseHistoryLine[] =>
  list(v).map((a) => ({ id: int(a.id) ?? 0, kind: String(a.kind ?? ''), body: String(a.body ?? ''), actor: str(a.actor_name), at: String(a.created_at ?? '') }));
