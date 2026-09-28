import { apiGet, request } from '../../core/api';
import { cents, isNegative, isZero } from '../finance/api';
import { canAct, K, money, type Org } from './api';
import type { Hit } from './parts';

/**
 * The approval queue and cash advances: what waits on this person, and the
 * money handed over before it is spent.
 *
 * THE QUEUE IS THE PERSON'S, ACROSS COMPANIES. `GET /api/expense/approvals`
 * answers everything routed to them in every company they approve in; the
 * screen honours the company selector by filtering here and counting what the
 * filter hides, so nothing can be forgotten behind it. Fetched unfiltered for
 * that reason — one request, and the "waiting elsewhere" count cannot disagree
 * with the list.
 *
 * AN ADVANCE LIVES IN ONE COMPANY. Its list and requests name that company;
 * one advance's detail and every act on it resolve the company from the
 * advance itself, so a decision taken from the cross-company queue is checked
 * against the right books.
 *
 * NOTHING HERE MOVES MONEY. "Paid out" and "settled" are records that a person
 * did something elsewhere; the server's sentences say so and are shown as said.
 *
 * Every column may arrive as a string ("0", "12"). Ids, flags and counts are
 * converted once, here, so no screen reads `"0"` as true.
 */

// ── converting what arrives ──────────────────────────────────────────────

type Raw = Record<string, unknown>;

const int = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const intOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : int(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
/** A flag as PHP may send it: true, 1, "1", "true". Never `"0"` as true. */
export const flag = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
const daysOf = (v: unknown): number => Math.max(0, int(v));

/** A positive figure, read from the string — a zero or a refund written as "-0.00" is not money owed. */
export const positive = (v: string | null | undefined) => !isZero(v) && !isNegative(v);

/** A decimal string as integer cents, for ordering. Not for display. */
export function centsOf(v: string | number | null | undefined): number {
  const s = String(v ?? '').trim().replace(/,/g, '');
  const neg = s.startsWith('-');
  const c = cents(neg ? s.slice(1) : s);
  if (c !== null) return neg ? -c : c;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ── roles ────────────────────────────────────────────────────────────────

const RANK: Record<string, number> = { member: 1, approver: 2, finance: 3, admin: 4 };

/**
 * Does this person hold at least `role` in a company — the per-company half of
 * every check, the permission being the other. A super-administrator acts in
 * every company without being a member of any (`can_act` without `member`),
 * as the server's `OrgContext::canAct` lets them.
 */
export function holds(o: Org | null | undefined, role: 'member' | 'approver' | 'finance' | 'admin'): boolean {
  if (!o || !canAct(o)) return false;
  if (!o.member) return true;
  return (RANK[o.role ?? ''] ?? 0) >= RANK[role]!;
}

// ── the queue ────────────────────────────────────────────────────────────

export type EntityType = 'claim' | 'advance';

export interface QueueItem {
  /** `claim-12`, `advance-3`: the queue mixes the two, and ids collide across them. */
  key: string;
  approval_id: number;
  org_id: number;
  org: string | null;
  entity_type: EntityType;
  entity_id: number;
  step: number;
  /** The step's name ("Line manager", "Finance"). */
  label: string | null;
  waiting_since: string | null;
  days_waiting: number;
  ref: string;
  /** In the claim's company currency. */
  base_amount: string | null;
  base_currency: string | null;
  description: string;
  /** A claim's date; an advance's is when it was asked for. */
  spent_on: string | null;
  claimant: string | null;
  category: string | null;
  /** What the policy engine said about a claim, in its own words. */
  policy: Hit[];
}

function toHits(v: unknown): Hit[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is Raw => !!h && typeof h === 'object')
    .map((h): Hit => ({ rule: str(h.rule), policy: strOrNull(h.policy), message: str(h.message), severity: h.severity === 'block' ? 'block' : 'warn' }))
    .filter((h) => h.message !== '');
}

export function toQueueItem(r: Raw): QueueItem {
  const type: EntityType = r.entity_type === 'advance' ? 'advance' : 'claim';
  const id = int(r.entity_id);
  return {
    key: `${type}-${id}`,
    approval_id: int(r.approval_id),
    org_id: int(r.org_id),
    org: strOrNull(r.org),
    entity_type: type,
    entity_id: id,
    step: int(r.step),
    label: strOrNull(r.label),
    waiting_since: strOrNull(r.waiting_since),
    days_waiting: daysOf(r.days_waiting),
    ref: str(r.ref),
    base_amount: strOrNull(r.base_amount),
    base_currency: strOrNull(r.base_currency),
    description: str(r.description),
    spent_on: strOrNull(r.spent_on),
    claimant: strOrNull(r.claimant),
    category: strOrNull(r.category),
    policy: toHits(r.policy),
  };
}

/**
 * The currency an item's amount is in. A claim's row names it. An advance's
 * row labels its `base_amount` — converted into the COMPANY's currency — with
 * the advance's own (`a.currency AS base_currency` in `ClaimController::queue`),
 * so an advance asked for in dollars would read as dollars while holding
 * rupees; the company's currency is the true label.
 */
export function currencyOf(item: QueueItem, orgs: Org[]): string {
  if (item.entity_type === 'advance') return orgs.find((o) => o.id === item.org_id)?.currency ?? item.base_currency ?? '';
  return item.base_currency ?? '';
}

/** "today", "1 day", "9 days". */
export const waited = (days: number) => (days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`);

/**
 * The selection honoured, and what it hides counted. An empty selection is
 * every company: nothing is hidden.
 */
export function scopeQueue(items: QueueItem[], selected: number[]): { shown: QueueItem[]; elsewhere: number } {
  if (!selected.length) return { shown: items, elsewhere: 0 };
  const shown = items.filter((i) => selected.includes(i.org_id));
  return { shown, elsewhere: items.length - shown.length };
}

export interface QueueFilter {
  q: string;
  kind: '' | EntityType;
  only: '' | 'flagged' | 'week';
}

export function filterQueue(items: QueueItem[], f: QueueFilter): QueueItem[] {
  const needle = f.q.trim().toLowerCase();
  return items.filter((r) => {
    if (f.kind && r.entity_type !== f.kind) return false;
    if (f.only === 'flagged' && r.policy.length === 0) return false;
    if (f.only === 'week' && r.days_waiting < 7) return false;
    if (!needle) return true;
    return `${r.ref} ${r.description} ${r.claimant ?? ''} ${r.org ?? ''}`.toLowerCase().includes(needle);
  });
}

export type QueueSort = 'waiting' | 'amount' | 'claimant' | 'ref';

export const QUEUE_SORTS: Array<{ value: QueueSort; label: string }> = [
  { value: 'waiting', label: 'Sort: Longest waiting' },
  { value: 'amount', label: 'Sort: Amount' },
  { value: 'claimant', label: 'Sort: Claimant' },
  { value: 'ref', label: 'Sort: Reference' },
];

/**
 * Ordered for the direction asked. Longest-waiting is the default, and
 * descending is its natural direction, so the queue opens oldest first: the
 * interesting item is the one that has been sitting longest.
 */
export function sortQueue(items: QueueItem[], sort: QueueSort, dir: 'asc' | 'desc'): QueueItem[] {
  const cmp = (a: QueueItem, b: QueueItem) => {
    switch (sort) {
      case 'amount':
        return centsOf(a.base_amount) - centsOf(b.base_amount);
      case 'claimant':
        return (a.claimant ?? '').localeCompare(b.claimant ?? '');
      case 'ref':
        return a.ref.localeCompare(b.ref);
      default:
        return a.days_waiting - b.days_waiting;
    }
  };
  const sign = dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => sign * cmp(a, b));
}

export const fetchQueue = (signal?: AbortSignal) =>
  apiGet<{ items?: Raw[] }>('/api/expense/approvals', undefined, signal).then((r) => (Array.isArray(r?.items) ? r.items.map(toQueueItem) : []));

/** A write, with the server's own sentence about what it did (it is the only record of which rule answered). */
async function send<T>(path: string, body: unknown): Promise<{ data: T; message: string | null }> {
  const r = await request<T>('POST', path, { body });
  return { data: r.data, message: r.message ?? null };
}

/**
 * One decision on one item. Claims and advances have their own routes, and
 * each owns its ladder: who may decide, which step, whether it has moved on.
 */
export const decideOne = (item: Pick<QueueItem, 'entity_type' | 'entity_id'>, approve: boolean, note: string) =>
  send<unknown>(item.entity_type === 'advance' ? `/api/expense/advances/${item.entity_id}/decide` : `/api/expense/claims2/${item.entity_id}/decide`, {
    decision: approve ? 'approved' : 'rejected',
    note,
  });

export interface BulkOutcome {
  message: string;
  done: Array<{ id: number; type: EntityType | null }>;
  failed: Array<{ id: number; type: EntityType | null; why: string }>;
}

const typeOf = (v: unknown): EntityType | null => (v === 'claim' || v === 'advance' ? v : null);

/**
 * One request for the whole selection, as `{type, id}` pairs the server
 * dispatches to each item's own ladder. A loop of single calls would throw
 * away the refusals, which are the useful half: "you cannot approve your own"
 * is the one somebody needs to see. Not one transaction — one ineligible item
 * cannot undo the decisions on the others.
 */
export async function decideMany(items: Array<Pick<QueueItem, 'entity_type' | 'entity_id'>>, approve: boolean, note: string): Promise<BulkOutcome> {
  const r = await send<{ done?: Raw[]; failed?: Raw[] } | null>('/api/expense/approvals/bulk-decide', {
    items: items.map((i) => ({ type: i.entity_type, id: i.entity_id })),
    decision: approve ? 'approved' : 'rejected',
    note,
  });
  const done = Array.isArray(r.data?.done) ? r.data.done.map((d) => ({ id: int(d.id), type: typeOf(d.type) })) : [];
  const failed = Array.isArray(r.data?.failed) ? r.data.failed.map((f) => ({ id: int(f.id), type: typeOf(f.type), why: str(f.why) || 'Refused.' })) : [];
  return { message: r.message ?? `${done.length} item(s) ${approve ? 'approved' : 'rejected'}.`, done, failed };
}

/** Each refusal with the reference a person recognises, not the row id. */
export function namedRefusals(failed: BulkOutcome['failed'], items: QueueItem[]): Array<{ key: string; ref: string; why: string }> {
  return failed.map((f, i) => {
    const hit = items.find((it) => it.entity_id === f.id && (f.type === null || it.entity_type === f.type));
    return { key: `${f.type ?? 'x'}-${f.id}-${i}`, ref: hit?.ref || `#${f.id}`, why: f.why };
  });
}

// ── reassigning a step ───────────────────────────────────────────────────

export interface Member {
  user_id: number;
  name: string;
  email: string | null;
  role: string | null;
  active: boolean;
}

export const fetchMembers = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[] }>('/api/expense/members', { org: orgId }, signal).then((r) =>
    (Array.isArray(r?.items) ? r.items : []).map((m) => ({
      user_id: int(m.user_id),
      name: str(m.name) || `User ${int(m.user_id)}`,
      email: strOrNull(m.email),
      role: strOrNull(m.role),
      active: m.status === undefined || m.status === null || m.status === 'active',
    })),
  );

/**
 * Who a step may be handed to: active members who approve in that company,
 * never the person it is already with. The server checks only membership, so
 * a step handed to a plain member would wait on somebody who cannot decide it;
 * the list keeps to people who can.
 */
export function reassignable(members: Member[], me: number): Member[] {
  return members.filter((m) => m.active && m.user_id !== me && (RANK[m.role ?? ''] ?? 0) >= RANK.approver!).sort((a, b) => a.name.localeCompare(b.name));
}

export const reassignStep = (approvalId: number, userId: number) => send<null>(`/api/expense/approvals/${approvalId}/reassign`, { user_id: userId });

// ── look-alike claims ────────────────────────────────────────────────────

export interface Duplicate {
  id: number;
  reason: string;
  claim_id: number;
  other_claim_id: number;
  claim_no: string;
  other_no: string | null;
  amount: string | null;
  currency: string | null;
  spent_on: string | null;
  claimant: string | null;
}

export const fetchDuplicates = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[]; note?: string }>('/api/expense/duplicates', { org: orgId }, signal).then((r) => ({
    note: strOrNull(r?.note),
    items: (Array.isArray(r?.items) ? r.items : []).map(
      (d): Duplicate => ({
        id: int(d.id),
        reason: str(d.reason),
        claim_id: int(d.claim_id),
        other_claim_id: int(d.other_claim_id),
        claim_no: str(d.claim_no) || `#${int(d.claim_id)}`,
        other_no: strOrNull(d.other_no),
        amount: strOrNull(d.amount),
        currency: strOrNull(d.currency),
        spent_on: strOrNull(d.spent_on),
        claimant: strOrNull(d.claimant),
      }),
    ),
  }));

/** `duplicate: true` records the judgement; it rejects nothing by itself. */
export const decideDuplicate = (id: number, duplicate: boolean) => send<null>(`/api/expense/duplicates/${id}/decide`, { duplicate });

// ── advances ─────────────────────────────────────────────────────────────

export interface Advance {
  id: number;
  org_id: number;
  user_id: number;
  advance_no: string;
  kind: string;
  purpose: string;
  /** In the advance's own currency. */
  amount: string | null;
  currency: string | null;
  /** In the company's currency. */
  base_amount: string | null;
  status: string;
  needed_by: string | null;
  claimant: string | null;
  project: string | null;
  vendor: string | null;
  /** Frozen at settlement, in the company's currency. */
  settled_amount: string | null;
  refund_amount: string | null;
  topup_amount: string | null;
  disbursed_at: string | null;
  disbursed_method: string | null;
  settled_at: string | null;
  decision_note: string | null;
  created_at: string | null;
}

export function toAdvance(a: Raw): Advance {
  return {
    id: int(a.id),
    org_id: int(a.org_id),
    user_id: int(a.user_id),
    advance_no: str(a.advance_no),
    kind: str(a.kind),
    purpose: str(a.purpose),
    amount: strOrNull(a.amount),
    currency: strOrNull(a.currency),
    base_amount: strOrNull(a.base_amount),
    status: str(a.status),
    needed_by: strOrNull(a.needed_by),
    claimant: strOrNull(a.claimant),
    project: strOrNull(a.project),
    vendor: strOrNull(a.vendor),
    settled_amount: strOrNull(a.settled_amount),
    refund_amount: strOrNull(a.refund_amount),
    topup_amount: strOrNull(a.topup_amount),
    disbursed_at: strOrNull(a.disbursed_at),
    disbursed_method: strOrNull(a.disbursed_method),
    settled_at: strOrNull(a.settled_at),
    decision_note: strOrNull(a.decision_note),
    created_at: strOrNull(a.created_at),
  };
}

export interface AdvanceList {
  items: Advance[];
  /** The company's currency. */
  currency: string;
  outstanding: { count: number; total: string };
  role: string | null;
}

export type AdvanceScope = 'mine' | 'organization';

export const fetchAdvances = (orgId: number, scope: AdvanceScope, signal?: AbortSignal) =>
  apiGet<Raw>('/api/expense/advances', { org: orgId, scope }, signal).then(
    (r): AdvanceList => ({
      items: (Array.isArray(r?.items) ? (r.items as Raw[]) : []).map(toAdvance),
      currency: str(r?.currency),
      outstanding: { count: Math.max(0, int((r?.outstanding as Raw | undefined)?.count)), total: str((r?.outstanding as Raw | undefined)?.total) || '0.00' },
      role: strOrNull(r?.role),
    }),
  );

/**
 * "Mine" as it says. For finance and administrators the server ignores the
 * scope and lists everyone's (`Advances::listing`), so the list is narrowed
 * here to the advances this person holds.
 */
export const mineOnly = (rows: Advance[], me: number) => rows.filter((a) => a.user_id === me);

export const KINDS: Array<{ value: string; label: string }> = [
  { value: 'employee', label: 'General' },
  { value: 'travel', label: 'Travel' },
  { value: 'project', label: 'Project' },
  { value: 'vendor', label: 'Vendor' },
];

export const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;

/** How the money was handed over — the server's list, in its order. */
export const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'mobile_wallet', label: 'Mobile wallet' },
];

export const methodLabel = (m: string | null) => (m ? (PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m.replace(/_/g, ' ')) : '');

/**
 * Where a settled advance came out, named from each side rather than signed:
 * a negative figure in a "refund due" column is read backwards by everybody
 * at least once. Anything not yet settled has no balance to name.
 */
export function settledBalance(a: Pick<Advance, 'status' | 'refund_amount' | 'topup_amount'>): { side: 'open' | 'due_back' | 'owed' | 'even'; amount: string | null } {
  if (a.status !== 'settled') return { side: 'open', amount: null };
  if (positive(a.refund_amount)) return { side: 'due_back', amount: a.refund_amount };
  if (positive(a.topup_amount)) return { side: 'owed', amount: a.topup_amount };
  return { side: 'even', amount: null };
}

export interface AdvanceFilter {
  q: string;
  status: string;
}

export function filterAdvances(rows: Advance[], f: AdvanceFilter): Advance[] {
  const needle = f.q.trim().toLowerCase();
  return rows.filter((a) => {
    if (f.status && a.status !== f.status) return false;
    if (!needle) return true;
    return `${a.advance_no} ${a.purpose} ${a.claimant ?? ''}`.toLowerCase().includes(needle);
  });
}

export type AdvanceSort = 'created' | 'amount' | 'status' | 'person';

export const ADVANCE_SORTS: Array<{ value: AdvanceSort; label: string }> = [
  { value: 'created', label: 'Sort: Newest' },
  { value: 'amount', label: 'Sort: Amount' },
  { value: 'status', label: 'Sort: Status' },
  { value: 'person', label: 'Sort: Person' },
];

export function sortAdvances(rows: Advance[], sort: AdvanceSort, dir: 'asc' | 'desc'): Advance[] {
  const cmp = (x: Advance, y: Advance) => {
    switch (sort) {
      case 'amount':
        return centsOf(x.base_amount ?? x.amount) - centsOf(y.base_amount ?? y.amount);
      case 'status':
        return x.status.localeCompare(y.status);
      case 'person':
        return (x.claimant ?? '').localeCompare(y.claimant ?? '');
      default:
        return x.id - y.id;
    }
  };
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => sign * cmp(a, b));
}

// ── one advance ──────────────────────────────────────────────────────────

export interface AdvanceLine {
  claim_id: number;
  claim_no: string;
  status: string;
  spent_on: string | null;
  description: string;
  base_amount: string | null;
}

export interface Step {
  id: number;
  step: number;
  label: string | null;
  approver: string | null;
  approver_id: number | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  revision: number;
  /** False for a step from a round that ended when the record was edited. */
  live: boolean;
}

export interface Position {
  advance: Advance;
  lines: AdvanceLine[];
  /** The company's currency: every figure below is in it. */
  currency: string;
  advanced: string;
  accounted: string;
  pending: string;
  refund_due: string;
  company_due: string;
  settleable: boolean;
  blocked_by: string | null;
  approvals: Step[];
}

export function toPosition(r: Raw): Position {
  const lines = Array.isArray(r.lines) ? (r.lines as Raw[]) : [];
  const steps = Array.isArray(r.approvals) ? (r.approvals as Raw[]) : [];
  return {
    advance: toAdvance((r.advance as Raw | undefined) ?? {}),
    lines: lines.map((l) => ({ claim_id: int(l.claim_id), claim_no: str(l.claim_no), status: str(l.status), spent_on: strOrNull(l.spent_on), description: str(l.description), base_amount: strOrNull(l.base_amount) })),
    currency: str(r.currency),
    advanced: str(r.advanced) || '0.00',
    accounted: str(r.accounted) || '0.00',
    pending: str(r.pending) || '0.00',
    refund_due: str(r.refund_due) || '0.00',
    company_due: str(r.company_due) || '0.00',
    settleable: flag(r.settleable),
    blocked_by: strOrNull(r.blocked_by),
    approvals: steps.map((s) => ({
      id: int(s.id),
      step: int(s.step),
      label: strOrNull(s.label),
      approver: strOrNull(s.approver),
      approver_id: intOrNull(s.approver_id),
      status: str(s.status),
      decided_by: strOrNull(s.decided_by),
      decided_at: strOrNull(s.decided_at),
      note: strOrNull(s.note),
      revision: int(s.revision) || 1,
      live: s.live === undefined ? true : flag(s.live),
    })),
  };
}

export const fetchAdvance = (id: number, signal?: AbortSignal) => apiGet<Raw>(`/api/expense/advances/${id}`, undefined, signal).then(toPosition);

/** The step waiting now: the first pending one in the live round. */
export const liveStep = (p: Pick<Position, 'approvals'>): Step | null => p.approvals.filter((s) => s.live && s.status === 'pending').sort((a, b) => a.step - b.step)[0] ?? null;

/**
 * May this person decide the advance in front of them: it is still asked for,
 * and the step waiting is theirs — or they administer the company, which the
 * server allows so a step whose approver has left is not stuck for ever. The
 * server still refuses their own, and says so.
 */
export function mayDecideAdvance(p: Pick<Position, 'advance' | 'approvals'>, me: number, org: Org | null | undefined): boolean {
  if (p.advance.status !== 'requested') return false;
  const step = liveStep(p);
  if (!step) return false;
  return (step.approver_id !== null && step.approver_id === me) || holds(org, 'admin');
}

/** What settling says before it is done: the figures, who owes whom, and that they freeze. */
export function settleSummary(p: Pick<Position, 'advanced' | 'accounted' | 'refund_due' | 'company_due' | 'currency'>, who: string | null): string[] {
  const m = (v: string) => money(v, p.currency);
  const side = positive(p.refund_due) ? `${m(p.refund_due)} is due back from ${who ?? 'them'}.` : positive(p.company_due) ? `The company owes them a further ${m(p.company_due)}.` : 'It comes out exactly even.';
  return [`${m(p.advanced)} advanced, ${m(p.accounted)} accounted for.`, side, 'These figures are frozen once settled — a later correction to a claim will not change them.'];
}

export const disburseAdvance = (id: number, method: string) => send<null>(`/api/expense/advances/${id}/disburse`, { method });

export const settleAdvance = (id: number) => send<null>(`/api/expense/advances/${id}/settle`, {});

export const attachClaim = (id: number, claimId: number) => send<null>(`/api/expense/advances/${id}/attach`, { claim_id: claimId });

// ── charging a claim to an advance ───────────────────────────────────────

export interface ClaimPick {
  id: number;
  claim_no: string;
  spent_on: string | null;
  description: string;
  base_amount: string | null;
  base_currency: string | null;
  status: string;
  user_id: number;
}

/**
 * The claimant's claims in the advance's company, for charging one to it. The
 * claimant asks for their own; finance asks for the company's, narrowed to
 * the claimant. Narrowed here too, because a caller the server will not show
 * the company's claims gets their own back — which are not the claimant's.
 */
export function fetchClaimsFor(orgId: number, claimantId: number, me: number, signal?: AbortSignal): Promise<ClaimPick[]> {
  const query = claimantId === me ? { org: orgId, scope: 'mine', per_page: 200 } : { org: orgId, scope: 'organization', user_id: claimantId, per_page: 200 };
  return apiGet<{ items?: Raw[] }>('/api/expense/claims2', query, signal).then((r) =>
    (Array.isArray(r?.items) ? r.items : [])
      .map(
        (c): ClaimPick => ({
          id: int(c.id),
          claim_no: str(c.claim_no),
          spent_on: strOrNull(c.spent_on),
          description: str(c.description),
          base_amount: strOrNull(c.base_amount),
          base_currency: strOrNull(c.base_currency),
          status: str(c.status),
          user_id: int(c.user_id),
        }),
      )
      .filter((c) => c.user_id === claimantId),
  );
}

/** Claims that could still be charged: not rejected, and not already on this advance. */
export const chargeable = (claims: ClaimPick[], lines: AdvanceLine[]) => claims.filter((c) => c.status !== 'rejected' && !lines.some((l) => l.claim_id === c.id));

// ── asking for one ───────────────────────────────────────────────────────

export interface AdvanceDraft {
  kind: string;
  amount: string;
  purpose: string;
  needed_by: string;
  project_id: string;
  vendor_id: string;
}

export const blankDraft = (): AdvanceDraft => ({ kind: 'travel', amount: '', purpose: '', needed_by: '', project_id: '', vendor_id: '' });

/** What the server would refuse, said while it is typed. The server checks every one again. */
export function draftProblem(d: AdvanceDraft): string | null {
  const c = cents(d.amount);
  if (c === null) return 'The amount is not a number. Use digits and at most two decimal places.';
  if (c <= 0) return 'Enter an amount greater than zero.';
  if (d.purpose.trim().length < 5) return 'Say what the advance is for. Somebody has to approve it on that basis.';
  if (d.kind === 'project' && !d.project_id) return 'A project advance has to name the project.';
  if (d.kind === 'vendor' && !d.vendor_id) return 'A vendor advance has to name the vendor.';
  return null;
}

/**
 * The outstanding-advance guard is an "are you sure", not a wall: there are
 * real reasons to hold two, and refusing outright would push people to ask by
 * email instead. Recognised by the server's own words.
 */
export const isOutstandingGuard = (message: string) => message.includes('still to settle');

export const requestAdvance = (orgId: number, d: AdvanceDraft, allowMultiple: boolean) =>
  send<{ id?: number | string; advance_no?: string } | null>('/api/expense/advances', {
    org_id: orgId,
    kind: d.kind,
    amount: d.amount.trim().replace(/,/g, ''),
    purpose: d.purpose.trim(),
    needed_by: d.needed_by || null,
    project_id: d.kind === 'project' && d.project_id ? Number(d.project_id) : null,
    vendor_id: d.kind === 'vendor' && d.vendor_id ? Number(d.vendor_id) : null,
    allow_multiple: allowMultiple,
  });

/** The projects and vendors an advance may name, from the same list the claim form reads. */
export const fetchRelated = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ types?: Raw[] }>('/api/expense/related', { org: orgId }, signal).then((r) => {
    const out: Record<string, Array<{ id: number; label: string }>> = {};
    for (const t of Array.isArray(r?.types) ? r.types : []) {
      out[str(t.key)] = (Array.isArray(t.items) ? (t.items as Raw[]) : []).map((i) => ({ id: int(i.id), label: str(i.label) }));
    }
    return out;
  });

// ── keys ─────────────────────────────────────────────────────────────────

/**
 * Under the foundation's prefixes, so its invalidations reach them: the whole
 * queue under `K.queue` (the rail's count is `[...K.queue, 'total']`), a
 * company's lists under `K.one`.
 */
export const QK = {
  queue: [...K.queue, 'items'] as const,
  members: (orgId: number) => [...K.one(orgId), 'members'] as const,
  duplicates: (orgId: number) => [...K.one(orgId), 'duplicates'] as const,
  advances: (orgId: number, scope: AdvanceScope) => [...K.one(orgId), 'advances', scope] as const,
  related: (orgId: number) => [...K.one(orgId), 'related'] as const,
  claimsFor: (orgId: number, userId: number) => [...K.one(orgId), 'claims-for', userId] as const,
  /** One advance, whichever company it is in: it is opened from the cross-company queue too. */
  advance: (id: number) => ['expenses', 'advance', id] as const,
};

/**
 * What a decision or a settlement changes: the queue and the rail's count,
 * every selection's dashboard and claim lists, every company's advances, and
 * the advance itself.
 */
export const TOUCHED: ReadonlyArray<readonly unknown[]> = [K.queue, ['expenses', 's'], ['expenses', 'o'], ['expenses', 'advance']];
