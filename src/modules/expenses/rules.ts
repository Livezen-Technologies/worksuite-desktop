import { ApiError, apiGet, apiPost, apiPut, request } from '../../core/api';
import { cents, isNegative, isZero } from '../finance/api';
import { K, money } from './api';

/**
 * Budgets, spending policies and approval routing (the server's
 * `RulesController`): the controls that decide what happens to a claim.
 *
 * ONE COMPANY, ALWAYS. Every call names it as `?org=` — on the query string
 * for reads, POSTs, PUTs and DELETEs alike, which is where
 * `BaseOrgController::askedOrg()` looks first. A selection of several is
 * refused by the server rather than guessed at, and the shell never sends one.
 *
 * EVERY COLUMN MAY ARRIVE AS A STRING. `hard_stop` comes back a PHP bool from
 * the budget engine but "0"/"1" from a raw policy row, and `"0"` is truthy in
 * JavaScript. Everything is converted once, here, so a screen never asks
 * whether a flag is `"0"`.
 *
 * MONEY STAYS A STRING. Figures are shown through `money()` and compared in
 * cents; percentages exist only to size a bar.
 */

// ── query keys ──────────────────────────────────────────────────────────

/** Under the one company, so a switch never shows another company's rules. */
export const KR = {
  budgets: (orgId: number) => [...K.one(orgId), 'rules', 'budgets'] as const,
  budget: (orgId: number, id: number) => [...K.one(orgId), 'rules', 'budgets', id] as const,
  policies: (orgId: number) => [...K.one(orgId), 'rules', 'policies'] as const,
  routing: (orgId: number) => [...K.one(orgId), 'rules', 'routing'] as const,
  categories: (orgId: number) => [...K.one(orgId), 'rules', 'categories'] as const,
  centres: (orgId: number) => [...K.one(orgId), 'rules', 'cost-centres'] as const,
  people: (orgId: number) => [...K.one(orgId), 'rules', 'people'] as const,
};

// ── conversions ─────────────────────────────────────────────────────────

/** true / 1 / "1" / "true" are yes; false / 0 / "0" / "" / null are no. */
export function flag(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s !== '' && s !== '0' && s !== 'false' && s !== 'no';
  }
  return false;
}

/** A whole number, or null where there is none ("", null, not a number). */
export function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === 'boolean' || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** A row id: a positive whole number, or null. */
export const idOf = (v: unknown): number | null => {
  const n = intOrNull(v);
  return n !== null && n > 0 ? n : null;
};

const int = (v: unknown, fallback = 0) => intOrNull(v) ?? fallback;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v));

/** A percentage for a bar, or null where the server sent none (no amount to compare). */
export function pctOf(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A signed DECIMAL string as integer cents, for comparing; 0 when it is not a figure. */
export function signedCents(v: string | number | null | undefined): number {
  const s = String(v ?? '').trim().replace(/,/g, '');
  const neg = s.startsWith('-');
  const c = cents(neg || s.startsWith('+') ? s.slice(1) : s);
  return c === null ? 0 : neg ? -c : c;
}

/** "-1250.00" → "1250.00": a shortfall said as "… over" rather than as a minus. */
export const unsigned = (v: string) => v.trim().replace(/^[-+]/, '');

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What a refused read said, when it is a statement about this person — not a
 * member here, the area withheld, several companies selected. Anything else is
 * a failed request and is not worth quoting.
 */
export function readRefusal(e: unknown): string | null {
  return e instanceof ApiError && (e.status === 403 || e.status === 409) ? e.message : null;
}

// ── pickers ─────────────────────────────────────────────────────────────

/** One thing a budget or a policy can be about: its id, its name, and how the list shows it. */
export interface Choice {
  id: number;
  name: string;
  label: string;
}

type Raw = Record<string, unknown>;
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

/** The categories this company files under, the shared ones included. */
export const fetchCategories = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[] }>('/api/expense/categories2', { org: orgId }, signal).then((r) =>
    rows(r.items)
      .map((c) => ({ id: int(c.id), name: str(c.name), label: str(c.name) }))
      .filter((c) => c.id > 0),
  );

export const fetchCentres = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[] }>('/api/expense/cost-centres', { org: orgId }, signal).then((r) =>
    rows(r.items)
      .map((c) => ({ id: int(c.id), name: str(c.name), label: c.code ? `${str(c.code)} — ${str(c.name)}` : str(c.name) }))
      .filter((c) => c.id > 0),
  );

export interface People {
  users: Choice[];
  branches: Choice[];
  departments: Choice[];
}

/**
 * The roster's pickers: the company's members (as users — a budget or a
 * policy for one person is about their user id), its branches and its
 * departments. The server answers this to approvers and above.
 */
export const fetchPeople = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[]; branches?: Raw[]; departments?: Raw[] }>('/api/expense/members', { org: orgId }, signal).then(
    (r): People => ({
      users: rows(r.items)
        .map((m) => ({ id: int(m.user_id), name: str(m.name), label: m.email ? `${str(m.name)} · ${str(m.email)}` : str(m.name) }))
        .filter((m) => m.id > 0),
      branches: rows(r.branches)
        .map((b) => ({ id: int(b.id), name: str(b.name), label: str(b.name) }))
        .filter((b) => b.id > 0),
      departments: rows(r.departments)
        .map((d) => ({ id: int(d.id), name: str(d.name), label: str(d.name) }))
        .filter((d) => d.id > 0),
    }),
  );

/** The list a scope picks from, or null where there is none to offer (a project: typed as its number). */
export function pickList(scope: string, lists: { categories?: Choice[]; centres?: Choice[]; people?: People }): Choice[] | null {
  switch (scope) {
    case 'category':
      return lists.categories ?? null;
    case 'cost_centre':
      return lists.centres ?? null;
    case 'branch':
      return lists.people?.branches ?? null;
    case 'department':
      return lists.people?.departments ?? null;
    case 'user':
      return lists.people?.users ?? null;
    default:
      return null;
  }
}

/**
 * Which option a stored scope was, from its name. The budget list sends the
 * scope's NAME and not its id, so an edit has to find it again: one exact
 * match, or the "#12" the server writes when the row it names is gone.
 * Two options with the same name are not guessed between.
 */
export function scopeIdFor(options: Choice[] | null | undefined, scopeName: string): number | null {
  const hash = /^#(\d+)$/.exec(scopeName.trim());
  if (hash) return Number(hash[1]);
  const want = scopeName.trim().toLowerCase();
  if (!want || !options) return null;
  const hits = options.filter((o) => o.name.trim().toLowerCase() === want);
  return hits.length === 1 ? hits[0]!.id : null;
}

// ── budgets ─────────────────────────────────────────────────────────────

export const BUDGET_SCOPES = ['organization', 'branch', 'department', 'cost_centre', 'project', 'category', 'user'] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

export const PERIODS = ['month', 'quarter', 'year', 'custom'] as const;
export type PeriodKind = (typeof PERIODS)[number];

export const PERIOD_WORDS: Record<PeriodKind, string> = { month: 'A month', quarter: 'A quarter', year: 'A financial year', custom: 'Dates I choose' };

/** How a scope reads in a picker. */
export const SCOPE_WORDS: Record<string, string> = {
  organization: 'The whole organization',
  everyone: 'Everyone',
  branch: 'A branch',
  department: 'A department',
  cost_centre: 'A cost centre',
  project: 'A project',
  category: 'A category',
  role: 'A role',
  user: 'One person',
};

/** How a scope reads beside a name: "Cost centre", "Person". */
export const SCOPE_NOUN: Record<string, string> = {
  branch: 'Branch',
  department: 'Department',
  cost_centre: 'Cost centre',
  project: 'Project',
  category: 'Category',
  role: 'Role',
  user: 'Person',
};

/** The run rate extended to the period's end — arithmetic, labelled as such wherever it shows. */
export interface Forecast {
  amount: string;
  basis: string;
  over_by: string | null;
}

export interface Budget {
  id: number;
  name: string;
  scope: string;
  /** "The whole organization", the department's name, or "#12" when the row it named is gone. Absent on one budget's own read. */
  scope_name: string;
  currency: string;
  amount: string;
  /** Submitted, not yet decided. Might evaporate. */
  committed: string;
  /** Decided yes, not yet paid. Will almost certainly happen. */
  approved: string;
  paid: string;
  used: string;
  remaining: string;
  pct: number | null;
  claims: number;
  hard_stop: boolean;
  alert_at_pct: number;
  /** The period as a label ("September 2026", "quarter to 30 Sep 2026") — not its kind. */
  period: string;
  period_start: string;
  period_end: string;
  forecast: Forecast | null;
}

export interface BudgetList {
  items: Budget[];
  currency: string;
  can_edit: boolean;
  /** The server's own caveat about "at this rate", shown as sent. */
  note: string;
}

export interface BudgetClaim {
  id: number;
  claim_no: string | null;
  spent_on: string;
  base_amount: string;
  description: string;
  status: string;
  claimant: string | null;
}

export interface BudgetDetail extends Budget {
  /** Largest first, at most 100. */
  claim_list: BudgetClaim[];
}

function toForecast(v: unknown): Forecast | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Raw;
  const amount = strOrNull(f.amount);
  if (amount === null) return null;
  const over = strOrNull(f.over_by);
  return { amount, basis: str(f.basis), over_by: over !== null && !isZero(over) ? over : null };
}

export function toBudget(b: Raw): Budget {
  return {
    id: int(b.id),
    name: str(b.name),
    scope: str(b.scope) || 'organization',
    scope_name: str(b.scope_name),
    currency: str(b.currency),
    amount: str(b.amount) || '0.00',
    committed: str(b.committed) || '0.00',
    approved: str(b.approved) || '0.00',
    paid: str(b.paid) || '0.00',
    used: str(b.used) || '0.00',
    remaining: str(b.remaining) || '0.00',
    pct: pctOf(b.pct),
    claims: Math.max(0, int(b.claims)),
    hard_stop: flag(b.hard_stop),
    alert_at_pct: int(b.alert_at_pct, 80),
    period: str(b.period),
    period_start: str(b.period_start).slice(0, 10),
    period_end: str(b.period_end).slice(0, 10),
    forecast: toForecast(b.forecast),
  };
}

export const fetchBudgets = (orgId: number, signal?: AbortSignal) =>
  apiGet<Raw>('/api/expense/budgets', { org: orgId }, signal).then(
    (r): BudgetList => ({
      items: rows(r.items).map(toBudget),
      currency: str(r.currency),
      can_edit: flag(r.can_edit),
      note: str(r.note),
    }),
  );

export const fetchBudget = (orgId: number, id: number, signal?: AbortSignal) =>
  apiGet<Raw>(`/api/expense/budgets/${id}`, { org: orgId }, signal).then(
    (r): BudgetDetail => ({
      ...toBudget(r),
      claim_list: rows(r.claim_list).map((c) => ({
        id: int(c.id),
        claim_no: strOrNull(c.claim_no),
        spent_on: str(c.spent_on).slice(0, 10),
        base_amount: str(c.base_amount) || '0.00',
        description: str(c.description),
        status: str(c.status),
        claimant: strOrNull(c.claimant),
      })),
    }),
  );

/** Over its figure: the remainder is below zero. */
export const isOver = (b: Pick<Budget, 'remaining'>) => isNegative(b.remaining);

/** The bar's width: a proportion, clamped to the track. Never a figure. */
export const meterWidth = (pct: number | null) => Math.max(0, Math.min(100, pct ?? 0));

/** The bar's colour: over, near (80% or more), a hard limit, or room. */
export function meterTone(b: Pick<Budget, 'pct' | 'remaining' | 'hard_stop'>): 'over' | 'near' | 'hard' | 'room' {
  if (isOver(b) || (b.pct ?? 0) > 100) return 'over';
  if ((b.pct ?? 0) >= 80) return 'near';
  return b.hard_stop ? 'hard' : 'room';
}

/**
 * The period's kind, read back from its label. The list sends the label the
 * engine writes ("September 2026", "quarter to 30 Sep 2026", "year to …",
 * "1 Sep – 15 Oct 2026") and not the kind, so an edit that posted the label
 * back would be read as a month.
 */
export function periodKind(label: string): PeriodKind {
  const s = label.trim().toLowerCase();
  if (s.startsWith('quarter to')) return 'quarter';
  if (s.startsWith('year to')) return 'year';
  if (s.includes('–') || / - /.test(s)) return 'custom';
  return 'month';
}

export type BudgetState = '' | 'over' | 'near' | 'hard';
export type BudgetSort = 'used' | 'name' | 'amount' | 'remaining' | 'scope';
export const BUDGET_SORTS: Array<[BudgetSort, string]> = [
  ['used', 'Most used'],
  ['name', 'Name'],
  ['amount', 'Budget'],
  ['remaining', 'Remaining'],
  ['scope', 'Scope'],
];

/** The periods on the list, as their labels, for the filter. */
export const budgetPeriods = (all: Budget[]) => [...new Set(all.map((b) => b.period).filter(Boolean))].sort();

/**
 * The list as filtered and sorted. A budget with no percentage — nothing
 * spent against it, or no amount to compare — sorts LAST under "most used"
 * whichever way the arrow points: it is the one that needs no attention, and
 * "most used" opening with a row of dashes is the sort not doing its job.
 */
export function shownBudgets(all: Budget[], f: { q: string; period: string; state: BudgetState; sort: BudgetSort; dir: 'asc' | 'desc' }): Budget[] {
  const needle = f.q.trim().toLowerCase();
  const kept = all.filter((b) => {
    if (f.period && b.period !== f.period) return false;
    if (f.state === 'over' && !isOver(b)) return false;
    if (f.state === 'near' && !(b.pct !== null && b.pct >= 80 && !isOver(b))) return false;
    if (f.state === 'hard' && !b.hard_stop) return false;
    return !needle || `${b.name} ${b.scope_name}`.toLowerCase().includes(needle);
  });
  const byName = (a: Budget, b: Budget) => a.name.localeCompare(b.name);
  const cmp = (a: Budget, b: Budget): number => {
    switch (f.sort) {
      case 'name':
        return byName(a, b);
      case 'amount':
        return signedCents(a.amount) - signedCents(b.amount);
      case 'remaining':
        return signedCents(a.remaining) - signedCents(b.remaining);
      case 'scope':
        return a.scope_name.localeCompare(b.scope_name);
      default:
        if (a.pct === null && b.pct === null) return byName(a, b);
        if (a.pct === null) return 1;
        if (b.pct === null) return -1;
        return a.pct - b.pct;
    }
  };
  const sorted = [...kept].sort(cmp);
  if (f.dir === 'asc') return sorted;
  if (f.sort !== 'used') return sorted.reverse();
  const scored = sorted.filter((b) => b.pct !== null);
  return [...scored.reverse(), ...sorted.filter((b) => b.pct === null)];
}

/** "LKR 84,500.00 of LKR 100,000.00 used across 12 claims." */
export const usedSentence = (b: Budget) => `${money(b.used, b.currency)} of ${money(b.amount, b.currency)} used across ${plural(b.claims, 'claim')}.`;

/** What the hard-stop switch means, said. */
export const hardSentence = (hard: boolean) =>
  hard ? 'A hard limit: a claim that would break it is refused.' : 'A soft limit: a claim that would break it is warned about, and a person decides.';

/** "At this rate, LKR 130,000.00 — LKR 30,000.00 over." The basis and the caveat go beside it. */
export function forecastSentence(f: Forecast, currency: string): string {
  return f.over_by ? `At this rate, ${money(f.amount, currency)} — ${money(f.over_by, currency)} over.` : `At this rate, ${money(f.amount, currency)}.`;
}

export interface BudgetDraft {
  name: string;
  scope: BudgetScope;
  /** Null until one is chosen; an edit may find it from the stored name (`scopeIdFor`). */
  scope_id: number | null;
  /** Typed: a project has no list to pick from. */
  scope_typed: string;
  amount: string;
  period: PeriodKind;
  period_start: string;
  period_end: string;
  alert_at_pct: string;
  hard_stop: boolean;
}

const isBudgetScope = (s: string): s is BudgetScope => (BUDGET_SCOPES as readonly string[]).includes(s);

/** A new budget, or an existing one as the form edits it. */
export function budgetDraft(b: Budget | null, today: string): BudgetDraft {
  if (!b) return { name: '', scope: 'organization', scope_id: null, scope_typed: '', amount: '', period: 'month', period_start: today, period_end: '', alert_at_pct: '80', hard_stop: false };
  const kind = periodKind(b.period);
  const hash = /^#(\d+)$/.exec(b.scope_name.trim());
  return {
    name: b.name,
    scope: isBudgetScope(b.scope) ? b.scope : 'organization',
    scope_id: null,
    scope_typed: hash ? hash[1]! : '',
    amount: b.amount,
    period: kind,
    period_start: b.period_start,
    period_end: kind === 'custom' ? b.period_end : '',
    alert_at_pct: String(b.alert_at_pct || 80),
    hard_stop: b.hard_stop,
  };
}

/**
 * What the form refuses before the server sees it — only what the server
 * would otherwise do silently wrong: it clamps the warning line to 1–100, so
 * an empty box would become 1%.
 */
export function budgetProblems(d: BudgetDraft): string[] {
  const out: string[] = [];
  const pct = d.alert_at_pct.trim();
  if (!/^\d+$/.test(pct) || Number(pct) < 1 || Number(pct) > 100) out.push('Warn at has to be a whole percentage from 1 to 100.');
  return out;
}

/** The body the server reads. The id is sent only for a scope that names one. */
export function budgetBody(d: BudgetDraft, scopeId: number | null): Record<string, unknown> {
  return {
    name: d.name.trim(),
    scope: d.scope,
    scope_id: d.scope === 'organization' ? null : scopeId,
    amount: d.amount.trim(),
    period: d.period,
    period_start: d.period_start,
    ...(d.period === 'custom' ? { period_end: d.period_end } : {}),
    alert_at_pct: Number(d.alert_at_pct.trim()),
    hard_stop: d.hard_stop,
  };
}

export const saveBudget = (orgId: number, body: Record<string, unknown>, id: number | null) =>
  id ? apiPut<{ message?: string } | null>(`/api/expense/budgets/${id}?org=${orgId}`, body) : apiPost<{ message?: string } | null>('/api/expense/budgets', body, { org: orgId });

/** Closes it (the server keeps the row, and its figures stay in reports). Resolves to the server's sentence. */
export const closeBudget = (orgId: number, id: number) => request<null>('DELETE', `/api/expense/budgets/${id}`, { query: { org: orgId } }).then((r) => r.message ?? null);

// ── policies ────────────────────────────────────────────────────────────

export const POLICY_SCOPES = ['everyone', 'branch', 'department', 'cost_centre', 'role', 'user'] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

export interface Policy {
  id: number;
  name: string;
  description: string | null;
  scope: string;
  scope_id: number | null;
  role_slug: string | null;
  /** A policy naming a category applies to that category only. */
  category_id: number | null;
  currency: string;
  max_per_claim: string | null;
  max_per_day: string | null;
  max_per_month: string | null;
  max_per_year: string | null;
  /** Zero means always. */
  receipt_required_above: string | null;
  reason_required_above: string | null;
  max_age_days: number | null;
  block_weekends: boolean;
  /** `hard` refuses the claim; `warn` lets it through, flagged for the approver. */
  enforcement: 'hard' | 'warn';
  /** Lower runs first — the order policies are evaluated in. */
  priority: number;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
}

export interface PolicyList {
  items: Policy[];
  currency: string;
  can_edit: boolean;
}

export function toPolicy(p: Raw): Policy {
  return {
    id: int(p.id),
    name: str(p.name),
    description: strOrNull(p.description),
    scope: str(p.scope) || 'everyone',
    scope_id: idOf(p.scope_id),
    role_slug: strOrNull(p.role_slug),
    category_id: idOf(p.category_id),
    currency: str(p.currency),
    max_per_claim: strOrNull(p.max_per_claim),
    max_per_day: strOrNull(p.max_per_day),
    max_per_month: strOrNull(p.max_per_month),
    max_per_year: strOrNull(p.max_per_year),
    receipt_required_above: strOrNull(p.receipt_required_above),
    reason_required_above: strOrNull(p.reason_required_above),
    max_age_days: idOf(p.max_age_days),
    block_weekends: flag(p.block_weekends),
    enforcement: str(p.enforcement) === 'warn' ? 'warn' : 'hard',
    priority: int(p.priority, 100),
    status: str(p.status) || 'active',
    effective_from: strOrNull(p.effective_from),
    effective_to: strOrNull(p.effective_to),
  };
}

export const fetchPolicies = (orgId: number, signal?: AbortSignal) =>
  apiGet<Raw>('/api/expense/policies', { org: orgId }, signal).then(
    (r): PolicyList => ({
      items: rows(r.items).map(toPolicy),
      currency: str(r.currency),
      can_edit: flag(r.can_edit),
    }),
  );

/**
 * A policy's rules as the list reads them: "LKR 5,000.00 a claim · receipt
 * above LKR 2,500.00 · no weekend dates". Empty when it sets nothing.
 */
export function policyLimits(p: Policy, currency: string): string[] {
  const out: string[] = [];
  if (p.max_per_claim !== null) out.push(`${money(p.max_per_claim, currency)} a claim`);
  if (p.max_per_day !== null) out.push(`${money(p.max_per_day, currency)} a day`);
  if (p.max_per_month !== null) out.push(`${money(p.max_per_month, currency)} a month`);
  if (p.max_per_year !== null) out.push(`${money(p.max_per_year, currency)} a financial year`);
  if (p.receipt_required_above !== null) out.push(isZero(p.receipt_required_above) ? 'receipt always' : `receipt above ${money(p.receipt_required_above, currency)}`);
  if (p.reason_required_above !== null) out.push(isZero(p.reason_required_above) ? 'explanation always' : `explanation above ${money(p.reason_required_above, currency)}`);
  if (p.max_age_days !== null) out.push(`nothing older than ${plural(p.max_age_days, 'day')}`);
  if (p.block_weekends) out.push('no weekend dates');
  return out;
}

/** Who a policy applies to: "Everyone", "Role: manager", "Department: Finance" (or "#3" where the name is not to hand). */
export function policyScope(p: Pick<Policy, 'scope' | 'scope_id' | 'role_slug'>, lists: { centres?: Choice[]; people?: People }): string {
  if (p.scope === 'everyone') return 'Everyone';
  if (p.scope === 'role') return `Role: ${p.role_slug ?? '—'}`;
  const noun = SCOPE_NOUN[p.scope] ?? p.scope.replace(/_/g, ' ');
  const named = pickList(p.scope, lists)?.find((o) => o.id === p.scope_id)?.name;
  return named ? `${noun}: ${named}` : `${noun} #${p.scope_id ?? '—'}`;
}

export type PolicyShow = 'active' | 'archived' | '';
export type PolicySort = 'priority' | 'name' | 'scope' | 'effect';
export const POLICY_SORTS: Array<[PolicySort, string]> = [
  ['priority', 'Priority'],
  ['name', 'Name'],
  ['scope', 'Applies to'],
  ['effect', 'Effect'],
];

/**
 * The list as filtered and sorted. The server orders by PRIORITY — the order
 * they are evaluated in — so that is the default, and reversing it is offered
 * rather than replacing it. Archived policies are a filter, hidden by default:
 * a claim refused last quarter still names the policy that refused it.
 */
export function shownPolicies(all: Policy[], f: { q: string; show: PolicyShow; effect: '' | 'hard' | 'warn'; sort: PolicySort; dir: 'asc' | 'desc' }): Policy[] {
  const needle = f.q.trim().toLowerCase();
  const kept = all.filter((p) => {
    if (f.show === 'active' && p.status === 'archived') return false;
    if (f.show === 'archived' && p.status !== 'archived') return false;
    if (f.effect && p.enforcement !== f.effect) return false;
    return !needle || `${p.name} ${p.description ?? ''} ${p.role_slug ?? ''}`.toLowerCase().includes(needle);
  });
  const cmp = (a: Policy, b: Policy): number => {
    switch (f.sort) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'scope':
        return a.scope.localeCompare(b.scope);
      case 'effect':
        return a.enforcement.localeCompare(b.enforcement);
      default:
        return a.priority - b.priority || a.id - b.id;
    }
  };
  const sorted = [...kept].sort(cmp);
  return f.dir === 'desc' ? sorted.reverse() : sorted;
}

export const CAPS = [
  ['max_per_claim', 'Most on one claim'],
  ['max_per_day', 'Most in a day'],
  ['max_per_month', 'Most in a month'],
  ['max_per_year', 'Most in a financial year'],
] as const;

export interface PolicyDraft {
  name: string;
  description: string;
  scope: PolicyScope;
  scope_id: number | null;
  scope_typed: string;
  role_slug: string;
  category_id: number | null;
  max_per_claim: string;
  max_per_day: string;
  max_per_month: string;
  max_per_year: string;
  receipt_required_above: string;
  reason_required_above: string;
  max_age_days: string;
  block_weekends: boolean;
  enforcement: 'hard' | 'warn';
  priority: string;
}

const isPolicyScope = (s: string): s is PolicyScope => (POLICY_SCOPES as readonly string[]).includes(s);

export function policyDraft(p: Policy | null): PolicyDraft {
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    scope: p && isPolicyScope(p.scope) ? p.scope : 'everyone',
    scope_id: p?.scope_id ?? null,
    scope_typed: p?.scope_id ? String(p.scope_id) : '',
    role_slug: p?.role_slug ?? '',
    category_id: p?.category_id ?? null,
    max_per_claim: p?.max_per_claim ?? '',
    max_per_day: p?.max_per_day ?? '',
    max_per_month: p?.max_per_month ?? '',
    max_per_year: p?.max_per_year ?? '',
    receipt_required_above: p?.receipt_required_above ?? '',
    reason_required_above: p?.reason_required_above ?? '',
    max_age_days: p?.max_age_days ? String(p.max_age_days) : '',
    block_weekends: p?.block_weekends ?? false,
    enforcement: p?.enforcement ?? 'hard',
    priority: String(p?.priority ?? 100),
  };
}

/** Before the server: an order that is not a whole number would be saved as 0 and run first. */
export function policyProblems(d: PolicyDraft): string[] {
  return /^-?\d+$/.test(d.priority.trim()) ? [] : ['Order has to be a whole number. Lower runs first.'];
}

/**
 * The body the server reads. What the form does not show — the dates it is in
 * force between, and whether it is archived — is carried from the stored row,
 * because the server writes every column on a save and would otherwise clear
 * them (an archived policy edited would quietly start refusing claims again).
 */
export function policyBody(d: PolicyDraft, original: Policy | null, scopeId: number | null): Record<string, unknown> {
  const named = d.scope !== 'everyone' && d.scope !== 'role';
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    scope: d.scope,
    scope_id: named ? scopeId : null,
    role_slug: d.scope === 'role' ? d.role_slug.trim() : null,
    category_id: d.category_id,
    max_per_claim: d.max_per_claim.trim(),
    max_per_day: d.max_per_day.trim(),
    max_per_month: d.max_per_month.trim(),
    max_per_year: d.max_per_year.trim(),
    receipt_required_above: d.receipt_required_above.trim(),
    reason_required_above: d.reason_required_above.trim(),
    max_age_days: d.max_age_days.trim(),
    block_weekends: d.block_weekends,
    enforcement: d.enforcement,
    priority: Number(d.priority.trim()),
    effective_from: original?.effective_from ?? null,
    effective_to: original?.effective_to ?? null,
    status: original?.status ?? 'active',
  };
}

export const savePolicy = (orgId: number, body: Record<string, unknown>, id: number | null) =>
  id ? apiPut<{ message?: string } | null>(`/api/expense/policies/${id}?org=${orgId}`, body) : apiPost<{ message?: string } | null>('/api/expense/policies', body, { org: orgId });

/** Archived rather than deleted: refusals it produced still name it. Resolves to the server's sentence. */
export const archivePolicy = (orgId: number, id: number) => request<null>('DELETE', `/api/expense/policies/${id}`, { query: { org: orgId } }).then((r) => r.message ?? null);

// ── approval routing ────────────────────────────────────────────────────

export interface RuleStep {
  resolver: string;
  role: string | null;
  user_id: number | null;
  label: string | null;
  /** Skipped (and said) when it resolves to nobody, rather than stalling. The server's default. */
  skip_if_unresolved: boolean;
}

export interface ApprovalRule {
  id: number;
  name: string;
  entity: 'claim' | 'advance';
  min_amount: string | null;
  max_amount: string | null;
  priority: number;
  status: string;
  category_id: number | null;
  department_id: number | null;
  cost_centre_id: number | null;
  project_id: number | null;
  steps: RuleStep[];
}

/** A chain nobody can move: a step with no approver, at the front of its claim. */
export interface Stalled {
  approval_id: number;
  entity_type: string;
  entity_id: number;
  label: string | null;
  days_waiting: number;
  reason: string;
}

export interface Routing {
  items: ApprovalRule[];
  stalled: Stalled[];
  currency: string;
  can_edit: boolean;
  resolvers: Array<{ key: string; label: string }>;
}

export const ROLES = ['approver', 'finance', 'admin'] as const;

function toStep(s: Raw): RuleStep {
  return {
    resolver: str(s.resolver) || 'manager',
    role: strOrNull(s.role),
    user_id: idOf(s.user_id),
    label: strOrNull(s.label),
    skip_if_unresolved: s.skip_if_unresolved === undefined || s.skip_if_unresolved === null ? true : flag(s.skip_if_unresolved),
  };
}

export function toRule(r: Raw): ApprovalRule {
  return {
    id: int(r.id),
    name: str(r.name),
    entity: str(r.entity) === 'advance' ? 'advance' : 'claim',
    min_amount: strOrNull(r.min_amount),
    max_amount: strOrNull(r.max_amount),
    priority: int(r.priority, 100),
    status: str(r.status) || 'active',
    category_id: idOf(r.category_id),
    department_id: idOf(r.department_id),
    cost_centre_id: idOf(r.cost_centre_id),
    project_id: idOf(r.project_id),
    steps: rows(r.steps).map(toStep),
  };
}

export const fetchRouting = (orgId: number, signal?: AbortSignal) =>
  apiGet<Raw>('/api/expense/approval-rules', { org: orgId }, signal).then(
    (r): Routing => ({
      items: rows(r.items).map(toRule),
      stalled: rows(r.stalled).map((s) => ({
        approval_id: int(s.approval_id),
        entity_type: str(s.entity_type),
        entity_id: int(s.entity_id),
        label: strOrNull(s.label),
        days_waiting: Math.max(0, int(s.days_waiting)),
        reason: str(s.reason),
      })),
      currency: str(r.currency),
      can_edit: flag(r.can_edit),
      resolvers: rows(r.resolvers).map((x) => ({ key: str(x.key), label: str(x.label) })),
    }),
  );

/** "Expense claims · from LKR 50,000.00 · under LKR 200,000.00 · order 10". */
export function ruleLine(r: ApprovalRule, currency: string): string {
  return [
    r.entity === 'advance' ? 'Cash advances' : 'Expense claims',
    r.min_amount !== null ? `from ${money(r.min_amount, currency)}` : null,
    r.max_amount !== null ? `under ${money(r.max_amount, currency)}` : null,
    `order ${r.priority}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A step as the chain shows it: its own label, or its resolver in words. */
export const stepWords = (s: RuleStep) => s.label ?? (s.resolver === 'role' && s.role ? `${s.role.charAt(0).toUpperCase()}${s.role.slice(1)} role` : s.resolver.replace(/_/g, ' '));

export interface RuleDraft {
  name: string;
  entity: 'claim' | 'advance';
  min_amount: string;
  max_amount: string;
  priority: string;
  steps: RuleStep[];
}

export function ruleDraft(r: ApprovalRule | null): RuleDraft {
  return {
    name: r?.name ?? '',
    entity: r?.entity ?? 'claim',
    min_amount: r?.min_amount ?? '',
    max_amount: r?.max_amount ?? '',
    priority: String(r?.priority ?? 100),
    steps: r?.steps.length ? r.steps.map((s) => ({ ...s })) : [{ resolver: 'manager', role: null, user_id: null, label: null, skip_if_unresolved: true }],
  };
}

export const ruleProblems = (d: RuleDraft): string[] => (/^-?\d+$/.test(d.priority.trim()) ? [] : ['Order has to be a whole number. The first matching rule wins.']);

/**
 * The body the server reads. Steps are replaced wholesale on a save; a step's
 * label and its skip flag, which the form does not show, travel with it. The
 * filters the form does not offer (category, department, cost centre,
 * project) and the status are carried from the stored rule.
 */
export function ruleBody(d: RuleDraft, original: ApprovalRule | null): Record<string, unknown> {
  return {
    name: d.name.trim(),
    entity: d.entity,
    min_amount: d.min_amount.trim(),
    max_amount: d.max_amount.trim(),
    priority: Number(d.priority.trim()),
    category_id: original?.category_id ?? null,
    department_id: original?.department_id ?? null,
    cost_centre_id: original?.cost_centre_id ?? null,
    project_id: original?.project_id ?? null,
    status: original?.status ?? 'active',
    steps: d.steps.map((s) => ({
      resolver: s.resolver,
      role: s.resolver === 'role' ? (s.role ?? 'approver') : null,
      user_id: s.resolver === 'user' ? s.user_id : null,
      label: s.label,
      skip_if_unresolved: s.skip_if_unresolved,
    })),
  };
}

export const saveRule = (orgId: number, body: Record<string, unknown>, id: number | null) =>
  id ? apiPut<{ message?: string } | null>(`/api/expense/approval-rules/${id}?org=${orgId}`, body) : apiPost<{ message?: string } | null>('/api/expense/approval-rules', body, { org: orgId });

export const archiveRule = (orgId: number, id: number) => request<null>('DELETE', `/api/expense/approval-rules/${id}`, { query: { org: orgId } }).then((r) => r.message ?? null);

export interface Preview {
  ok: boolean;
  message: string;
  steps: Array<{ step: number; label: string; resolves_to: string | null; problem: string | null }>;
}

/** Resolves the chain against the caller as the claimant. Creates nothing. */
export const previewRule = (orgId: number, id: number) =>
  apiPost<Raw>(`/api/expense/approval-rules/${id}/preview`, {}, { org: orgId }).then(
    (r): Preview => ({
      ok: flag(r?.ok),
      message: str(r?.message),
      steps: rows(r?.steps).map((s) => ({ step: int(s.step), label: str(s.label), resolves_to: strOrNull(s.resolves_to), problem: strOrNull(s.problem) })),
    }),
  );
