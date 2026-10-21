import { useQuery } from '@tanstack/react-query';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { currentZone, parseTs, wallToUtc } from '../../core/time';
import { toBidCost, toExpenseHistory, type BidCostSummary, type ExpenseHistoryLine } from './bidcost';

/**
 * Tenders (the server's `/api/tenders` and `/api/tender`): the bids a company
 * finds, prepares, submits and wins or loses. `tender.view` reads, and
 * following a bid or adding a note needs nothing more; `tender.manage` creates,
 * edits, moves and decides; `tender.settings` configures.
 *
 * THE COMPANY IS A FILTER. A tender belongs to one company, and the picker
 * narrows every read to it, sent as `org`, as the web does. Empty means every
 * company the reader holds. A new tender is made in one company, so the form
 * asks which when the picker is on all of them.
 *
 * MONEY STAYS A STRING. Budgets and bids are DECIMAL(18,2) on the server and
 * come back as strings ("45000000.00"); they are grouped as text rather than
 * through a float, so a seventeen-digit figure reads as the one entered. Totals
 * come per currency and are never added across them.
 *
 * Some routes send ids as strings ("840"); every row is normalised here.
 */

export const can = (perms: readonly string[] | undefined, slug: string) => !!perms && (perms.includes('*') || perms.includes(slug));

const withOrg = (org: string, rest: Record<string, string | number | boolean | undefined> = {}) => ({ ...(org ? { org } : {}), ...rest });

export const K = {
  all: ['tenders'] as const,
  orgs: ['tenders', 'orgs'] as const,
  dashboard: (org: string) => ['tenders', 'dashboard', org] as const,
  detail: (org: string) => ['tenders', 'dashboard-detail', org] as const,
  list: (org: string, f: object) => ['tenders', 'list', org, f] as const,
  board: (org: string) => ['tenders', 'board', org] as const,
  tender: (id: number) => ['tenders', 'tender', id] as const,
  owners: (org: string) => ['tenders', 'owners', org] as const,
  access: ['tenders', 'access'] as const,
};

// ── numbers ─────────────────────────────────────────────────────────────

const int = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

/** "45000000.5" as "45,000,000.50" — grouped as text, never through a float. */
export function grouped(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v).trim());
  if (!m) return null;
  const whole = m[2]!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = ((m[3] ?? '') + '00').slice(0, 2);
  return `${m[1]}${whole}.${cents}`;
}

/** A figure in its currency, or a dash where none was recorded — never 0.00 standing in for "not known". */
export function money(v: string | number | null | undefined, currency?: string | null): string {
  const g = grouped(v);
  return g === null ? '—' : `${currency ? `${currency} ` : ''}${g}`;
}

export interface CurrencyTotal {
  currency: string;
  total: string;
  known: boolean;
}

/** Per-currency totals as one line: "LKR 57,500,000.50 · USD 12,000.00". */
export function moneyList(rows: CurrencyTotal[] | undefined): string {
  const list = (rows ?? []).filter((r) => r.known !== false && grouped(r.total) !== null);
  return list.length ? list.map((r) => money(r.total, r.currency)).join(' · ') : '—';
}

/** A figure as typed, without its grouping commas; the server refuses what it cannot read and says why. */
const plain = (v: string) => v.replace(/[,\s]/g, '');

// ── the shapes ──────────────────────────────────────────────────────────

export type Tone = 'ok' | 'warning' | 'critical' | 'closed' | 'unknown';
export interface Remaining {
  days: number | null;
  text: string;
  tone: Tone;
  closed: boolean;
}
export type Outcome = 'open' | 'won' | 'lost' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'critical';

export interface Band {
  min: number;
  label: string;
  tone: string;
}
export interface StageDef {
  key: string;
  label: string;
  group: string;
  terminal: boolean;
  next: string[];
}

export interface TenderRow {
  id: number;
  org_id: number | null;
  reference: string | null;
  title: string;
  organization: string | null;
  client_name: string | null;
  stage: string;
  stage_label: string;
  outcome: Outcome;
  priority: Priority;
  sector: string | null;
  category: string | null;
  industry: string | null;
  country: string | null;
  budget_min: string | null;
  budget_max: string | null;
  bid_value: string | null;
  award_value: string | null;
  currency: string;
  closing_at: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  owner_id: number | null;
  owner_name: string | null;
  score: number | null;
  following: boolean;
  remaining: Remaining;
  description: string | null;
  external_url: string | null;
  lost_reason: string | null;
  competitor: string | null;
  winning_price: string | null;
  lessons: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const NO_DATE: Remaining = { days: null, text: 'No closing date', tone: 'unknown', closed: false };

/** One tender as the server sent it: ids as numbers, flags as booleans, money left as text. */
export function toTender(r: Record<string, unknown>): TenderRow {
  const rem = (r.remaining ?? null) as Remaining | null;
  return {
    id: int(r.id) ?? 0,
    org_id: int(r.org_id),
    reference: str(r.reference),
    title: String(r.title ?? ''),
    organization: str(r.organization),
    client_name: str(r.client_name),
    stage: String(r.stage ?? ''),
    stage_label: String(r.stage_label ?? r.stage ?? ''),
    outcome: (str(r.outcome) ?? 'open') as Outcome,
    priority: (str(r.priority) ?? 'normal') as Priority,
    sector: str(r.sector),
    category: str(r.category),
    industry: str(r.industry),
    country: str(r.country),
    budget_min: str(r.budget_min),
    budget_max: str(r.budget_max ?? r.value),
    bid_value: str(r.bid_value),
    award_value: str(r.award_value),
    currency: str(r.currency) ?? 'LKR',
    closing_at: str(r.closing_at),
    submitted_at: str(r.submitted_at),
    decided_at: str(r.decided_at),
    owner_id: int(r.owner_id),
    owner_name: str(r.owner_name ?? r.owner),
    score: int(r.score),
    following: r.following === true || r.following === 1 || r.following === '1',
    remaining: rem && typeof rem.text === 'string' ? { days: int(rem.days), text: rem.text, tone: rem.tone ?? 'unknown', closed: !!rem.closed } : NO_DATE,
    description: str(r.description),
    external_url: str(r.external_url),
    lost_reason: str(r.lost_reason),
    competitor: str(r.competitor),
    winning_price: str(r.winning_price),
    lessons: str(r.lessons),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

/** The band a score falls in: the first whose floor it reaches (the server sends them highest first). */
export function bandFor(score: number | null, bands: Band[] | undefined): Band | null {
  if (score === null) return null;
  const list = [...(bands ?? [])].sort((a, b) => b.min - a.min);
  return list.find((b) => score >= b.min) ?? null;
}

// ── companies ───────────────────────────────────────────────────────────

export interface Company {
  id: number;
  name: string;
  currency: string | null;
  role: string | null;
}

export function useCompanies() {
  return useQuery({
    queryKey: K.orgs,
    queryFn: ({ signal }) => apiGet<{ items: Company[] }>('/api/tender/organizations', undefined, signal).then((r) => (r.items ?? []).map((c) => ({ ...c, id: Number(c.id) }))),
    staleTime: 300_000,
  });
}

// ── the dashboard ───────────────────────────────────────────────────────

export interface DueRow {
  id: number;
  reference: string | null;
  title: string;
  organization: string | null;
  closing_at: string | null;
  stage: string;
  budget_max: string | null;
  currency: string;
  remaining: Remaining;
}

export interface Dashboard {
  counts: Record<string, number>;
  win_rate: { percent: number | null; won: number; decided: number; note: string };
  value: { pipeline_by_currency: CurrencyTotal[]; awarded_by_currency: CurrencyTotal[]; note: string };
  due_this_week: DueRow[];
  documents: { total: number; expired: number; expiring: number };
  by_stage: Record<string, number>;
  stages: StageDef[];
  bands: Band[];
}

export async function fetchDashboard(org: string, signal?: AbortSignal): Promise<Dashboard> {
  const d = await apiGet<Partial<Dashboard>>('/api/tenders/dashboard', withOrg(org), signal);
  return {
    counts: d.counts ?? {},
    win_rate: d.win_rate ?? { percent: null, won: 0, decided: 0, note: '' },
    value: { pipeline_by_currency: d.value?.pipeline_by_currency ?? [], awarded_by_currency: d.value?.awarded_by_currency ?? [], note: d.value?.note ?? '' },
    due_this_week: (d.due_this_week ?? []).map((r) => ({ ...toTender(r as unknown as Record<string, unknown>) })),
    documents: d.documents ?? { total: 0, expired: 0, expiring: 0 },
    by_stage: d.by_stage ?? {},
    stages: d.stages ?? [],
    bands: d.bands ?? [],
  };
}

export interface Detail {
  readiness: Array<{ id: number; reference: string | null; title: string; organization: string | null; closing_at: string | null; stage: string; days: number | null; required: number; done: number; missing: number; percent: number | null }>;
  overdue: Array<{ id: number; reference: string | null; title: string; organization: string | null; closing_at: string | null; stage: string; days_ago: number | null }>;
  approvals: Array<{ id: number; tender_id: number; reference: string | null; title: string; step: number; role: string | null; approver: string | null; closing_at: string | null }>;
  securities: {
    days: number;
    rows: Array<{ id: number; tender_id: number; tender_ref: string | null; title: string; kind: string; instrument: string | null; amount: number | string; currency: string | null; valid_until: string; days: number | null }>;
  };
  meetings: { days: number; rows: Array<{ id: number; tender_id: number; reference: string | null; title: string; kind: string; at: string; mode: string | null; venue: string | null; mandatory: boolean; questions_due_at: string | null }> };
  sources: Array<{ id: number; name: string; driver: string; enabled: boolean; last_run_at: string | null; last_status: string | null; imported_30: number; seen_30: number }>;
}

/** The expensive half, made safe to draw beside a front page that is already right. */
export async function fetchDetail(org: string, signal?: AbortSignal): Promise<Detail> {
  const d = await apiGet<Partial<Detail>>('/api/tenders/dashboard/detail', withOrg(org), signal);
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    readiness: arr(d?.readiness),
    overdue: arr(d?.overdue),
    approvals: arr(d?.approvals),
    securities: { days: d?.securities?.days ?? 30, rows: arr(d?.securities?.rows) },
    meetings: { days: d?.meetings?.days ?? 30, rows: arr(d?.meetings?.rows) },
    sources: arr(d?.sources),
  };
}

// ── the lists ───────────────────────────────────────────────────────────

export const PER_PAGE = 50;

export interface Filters {
  q: string;
  /** A stage key, several joined by commas, or '' for any. */
  stage: string;
  outcome: string;
  /** '' anyone, 'none' nobody, or a person's id. */
  owner: string;
  priority: string;
  /** '' any, '7' / '14' / '30' days, or 'overdue'. */
  closing: string;
  following: boolean;
  unscored: boolean;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
}

export const BLANK: Filters = { q: '', stage: '', outcome: '', owner: '', priority: '', closing: '', following: false, unscored: false, sort: 'closing', dir: 'asc', page: 1 };

export type ListView = 'new' | 'following' | 'preparing' | 'submitted' | 'evaluation' | 'won' | 'lost' | 'all';

/**
 * The rail's lists are starting points, not queries of their own: each seeds
 * the filters, which stay on screen to be changed. Each is scoped the way the
 * rail counts it — open tenders only — so a badge of 4 is not over a list of 9.
 */
export const VIEWS: Record<ListView, { title: string; blurb: string; preset: Partial<Filters> }> = {
  new: { title: 'New opportunities', blurb: 'Arrived and not yet triaged. The score is arithmetic over a few fields — not a reading of the document.', preset: { stage: 'new', outcome: 'open', sort: 'score', dir: 'desc' } },
  following: { title: 'Following', blurb: 'Being watched. Deadline reminders go to whoever owns each one.', preset: { following: true, outcome: 'open' } },
  preparing: { title: 'Being prepared', blurb: 'Documents in progress, internal review and management approval.', preset: { stage: 'preparing,internal_review,management_approval,ready', outcome: 'open' } },
  submitted: { title: 'Submitted', blurb: 'Sent to the buyer and awaiting a decision.', preset: { stage: 'submitted', outcome: 'open' } },
  evaluation: { title: 'Evaluation', blurb: 'Under evaluation, or answering clarifications.', preset: { stage: 'evaluation,clarification', outcome: 'open' } },
  won: { title: 'Won', blurb: 'Awarded to us.', preset: { outcome: 'won', sort: 'updated', dir: 'desc' } },
  lost: { title: 'Lost', blurb: 'Not awarded. The reason on each is what makes the next bid better.', preset: { outcome: 'lost', sort: 'updated', dir: 'desc' } },
  all: { title: 'All tenders', blurb: 'Every tender in the companies you are looking at, open and decided.', preset: {} },
};

export const presetOf = (view: ListView): Filters => ({ ...BLANK, ...VIEWS[view].preset });

/** The several-stage presets, offered in the stage filter by name so it can show its own value. */
export const STAGE_GROUPS = Object.values(VIEWS)
  .filter((v) => (v.preset.stage ?? '').includes(','))
  .map((v) => ({ value: v.preset.stage as string, label: v.title }));

export const SORTS: Array<[string, string]> = [
  ['closing', 'Closing date'],
  ['score', 'Score'],
  ['value', 'Budget'],
  ['priority', 'Priority'],
  ['title', 'Title'],
  ['buyer', 'Buyer'],
  ['stage', 'Stage'],
  ['created', 'Added'],
  ['updated', 'Last changed'],
];

export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'critical'];

/** The filters in the server's own spelling. */
export function listQuery(f: Filters, org: string): Record<string, string | number> {
  const q: Record<string, string | number> = { sort: f.sort, dir: f.dir.toUpperCase(), page: f.page, per_page: PER_PAGE };
  if (org) q.org = org;
  if (f.q.trim()) q.q = f.q.trim();
  if (f.stage) q.stage = f.stage;
  if (f.outcome) q.outcome = f.outcome;
  if (f.owner === 'none') q.unowned = 1;
  else if (/^\d+$/.test(f.owner)) q.owner_id = f.owner;
  if (f.priority) q.priority = f.priority;
  if (f.closing === 'overdue') q.overdue = 1;
  else if (/^\d+$/.test(f.closing)) q.closing_within = f.closing;
  if (f.following) q.following = 1;
  if (f.unscored) q.unscored = 1;
  return q;
}

export interface ListPage {
  items: TenderRow[];
  total: number;
  summary: { by_stage: Array<{ stage: string; label: string; count: number }>; ceiling_by_currency: CurrencyTotal[] };
}

export async function fetchList(org: string, f: Filters, signal?: AbortSignal): Promise<ListPage> {
  const d = await apiGet<{ items: Array<Record<string, unknown>>; total: number | string; summary?: ListPage['summary'] }>('/api/tenders', listQuery(f, org), signal);
  return {
    items: (d.items ?? []).map(toTender),
    total: Number(d.total ?? 0),
    summary: { by_stage: (d.summary?.by_stage ?? []).map((s) => ({ ...s, count: Number(s.count) })), ceiling_by_currency: d.summary?.ceiling_by_currency ?? [] },
  };
}

export interface Owner {
  id: number;
  name: string;
  /** May hold this company's bids now (someone who left may still own some). */
  holds: boolean;
  owns_any: boolean;
}

export function useOwners(org: string) {
  return useQuery({
    queryKey: K.owners(org),
    queryFn: ({ signal }) => apiGet<{ items: Owner[] }>('/api/tender/owners', withOrg(org), signal).then((r) => r.items ?? []),
    staleTime: 300_000,
  });
}

export type BulkAction = 'follow' | 'unfollow' | 'owner' | 'priority' | 'stage' | 'delete';
export interface BulkResult {
  done: Array<{ id: number; reference: string }>;
  failed: Array<{ id: number; reference?: string; why: string }>;
}

/** Decided one bid at a time, never for a selection: each records a value, a reason and what it made. */
export const NOT_IN_BULK = ['awarded', 'won', 'lost', 'cancelled'];

export async function bulkTenders(org: string, action: BulkAction, ids: number[], extra: { owner_id?: number | null; priority?: string; stage?: string } = {}): Promise<BulkResult> {
  const r = await apiPost<BulkResult>('/api/tenders/bulk', { action, ids, ...extra, ...(org ? { org } : {}) });
  return { done: r.done ?? [], failed: r.failed ?? [] };
}

// ── the board ───────────────────────────────────────────────────────────

export interface Column extends StageDef {
  count: number;
  tenders: TenderRow[];
}

export async function fetchBoard(org: string, signal?: AbortSignal): Promise<Column[]> {
  const d = await apiGet<{ columns: Array<StageDef & { count: number; tenders: Array<Record<string, unknown>> }> }>('/api/tenders/board', withOrg(org), signal);
  return (d.columns ?? []).map((c) => ({ ...c, count: Number(c.count ?? c.tenders?.length ?? 0), tenders: (c.tenders ?? []).map((t) => toTender({ ...t, stage: c.key, stage_label: c.label })) }));
}

/** Columns worth drawing: every working stage, and a finished one only when something is in it. */
export const boardColumns = (cols: Column[]) => cols.filter((c) => !c.terminal || c.count > 0);

// ── one tender ──────────────────────────────────────────────────────────

export interface ScoreReason {
  rule: string;
  points: number;
  reason: string;
  applied: boolean;
}

export interface Workspace {
  tender: TenderRow;
  requirements: { summary: { total: number; mandatory: number; missing: number; expired: number; ready: boolean }; note: string | null };
  approvals: Array<{ id: number; step: number; role_label: string | null; status: string; decided_at: string | null; comment: string | null }>;
  submissions: Array<{ id: number; method: string | null; submitted_at: string | null; receipt_no: string | null; bid_value: string | null; reference: string | null; acknowledged_at: string | null; note: string | null }>;
  evaluations: Array<{ id: number; kind: string; title: string | null; body: string | null; score: string | null; max_score: string | null; happened_at: string | null; responded_at: string | null }>;
  history: Array<{ id: number; from: string | null; to: string; note: string | null; actor: string; at: string }>;
  activity: Array<{ id: number; kind: string; body: string | null; actor_name: string | null; created_at: string }>;
  score: { score: number | null; band: string | null; reasons: ScoreReason[] } | null;
  next: Array<{ key: string; label: string }>;
  documents: TenderDoc[];
  /** What this reader may do with the tender's documents (and the files on its checklist). */
  can: DocAccess;
  budget: Budget;
  /** What chasing the bid has cost, as this reader may see it; null from a server that does not say. */
  bid_cost: BidCostSummary | null;
  /** The expense lines of the history: added, linked, unlinked, refunded. */
  expense_history: ExpenseHistoryLine[];
}

export interface DocAccess {
  view: boolean;
  download: boolean;
  upload: boolean;
  edit: boolean;
  delete: boolean;
}

export interface TenderDoc {
  id: number;
  kind: string;
  title: string;
  note: string | null;
  version: number;
  is_final: boolean;
  added_by_name: string | null;
  created_at: string;
  file: { id: number; name: string | null; size: number | null; mime_type: string | null; state: 'ready' | 'held' | 'deleted'; download_name: string } | null;
}

export interface Budget {
  lines: Array<{ id: number; category: string; label: string; quantity: string; unit_cost: string; line_total: string; note: string | null }>;
  by_category: Record<string, string>;
  total_cost: string;
  currency: string;
  /** Only where a bid has been entered: the margin is never estimated. */
  margin: { bid: string; cost: string; profit: string; percent: number } | null;
  note: string | null;
}

export async function fetchTender(id: number, signal?: AbortSignal): Promise<Workspace> {
  const d = await apiGet<Record<string, unknown>>(`/api/tenders/${id}`, undefined, signal);
  const req = (d.requirements ?? {}) as { summary?: Workspace['requirements']['summary']; note?: string | null };
  const score = (d.score ?? null) as Workspace['score'];
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    tender: toTender((d.tender ?? {}) as Record<string, unknown>),
    requirements: { summary: { total: 0, mandatory: 0, missing: 0, expired: 0, ready: false, ...(req.summary ?? {}) }, note: req.note ?? null },
    approvals: arr<Record<string, unknown>>(d.approvals).map((a) => ({ id: int(a.id) ?? 0, step: int(a.step) ?? 0, role_label: str(a.role_label), status: String(a.status ?? ''), decided_at: str(a.decided_at), comment: str(a.comment) })),
    submissions: arr<Record<string, unknown>>(d.submissions).map((x) => ({
      id: int(x.id) ?? 0,
      method: str(x.method),
      submitted_at: str(x.submitted_at),
      receipt_no: str(x.receipt_no),
      bid_value: str(x.bid_value),
      reference: str(x.reference),
      acknowledged_at: str(x.acknowledged_at),
      note: str(x.note),
    })),
    evaluations: arr<Record<string, unknown>>(d.evaluations).map((x) => ({
      id: int(x.id) ?? 0,
      kind: String(x.kind ?? 'other'),
      title: str(x.title),
      body: str(x.body),
      score: str(x.score),
      max_score: str(x.max_score),
      happened_at: str(x.happened_at),
      responded_at: str(x.responded_at),
    })),
    history: arr<Workspace['history'][number]>(d.history),
    activity: arr<Record<string, unknown>>(d.activity).map((a) => ({ id: int(a.id) ?? 0, kind: String(a.kind ?? ''), body: str(a.body), actor_name: str(a.actor_name), created_at: String(a.created_at ?? '') })),
    score: score ? { score: int(score.score), band: score.band ?? null, reasons: arr<ScoreReason>(score.reasons) } : null,
    next: arr(d.next_stages),
    documents: arr<TenderDoc>(d.documents),
    can: { view: false, download: false, upload: false, edit: false, delete: false, ...((d.attachments as { can?: Partial<DocAccess> } | undefined)?.can ?? {}) },
    budget: budgetOf(d.budget),
    bid_cost: toBidCost(d.bid_cost),
    expense_history: toExpenseHistory(d.expense_history),
  };
}

/** The budget as the server sent it; `by_category` arrives as [] when empty (a PHP empty array). */
function budgetOf(v: unknown): Budget {
  const b = (v ?? {}) as Partial<Budget> & { lines?: Array<Record<string, unknown>> };
  return {
    lines: (b.lines ?? []).map((l) => ({
      id: int(l.id) ?? 0,
      category: String(l.category ?? 'other'),
      label: String(l.label ?? ''),
      quantity: String(l.quantity ?? '0'),
      unit_cost: String(l.unit_cost ?? '0'),
      line_total: String(l.line_total ?? '0'),
      note: str(l.note),
    })),
    by_category: b.by_category && !Array.isArray(b.by_category) ? b.by_category : {},
    total_cost: String(b.total_cost ?? '0.00'),
    currency: b.currency ?? 'LKR',
    margin: b.margin ?? null,
    note: b.note ?? null,
  };
}

export const fetchBlockers = (id: number, stage: string) => apiGet<{ stage: string; blockers: string[]; clear: boolean }>(`/api/tenders/${id}/blockers`, { stage });
export const moveStage = (id: number, stage: string, override = false, note?: string) =>
  apiPost<{ tasks?: { created: number; message: string } }>(`/api/tenders/${id}/stage`, { stage, ...(override ? { override: true } : {}), ...(note ? { note } : {}) });
export const setFollowing = (id: number, following: boolean) => apiPost<{ following: boolean }>(`/api/tenders/${id}/follow`, { following });
export const addNote = (id: number, body: string) => apiPost(`/api/tenders/${id}/notes`, { body });
export const rescore = (id: number) => apiPost(`/api/tenders/${id}/score`, {});

/** What a refused win or loss says beyond its sentence. */
export function refusalOf(e: unknown): { mayOverride: boolean; blockers: string[] } {
  const d = e instanceof ApiError && e.data && typeof e.data === 'object' ? (e.data as { may_override?: boolean; blockers?: string[] }) : {};
  return { mayOverride: !!d.may_override, blockers: Array.isArray(d.blockers) ? d.blockers : [] };
}

export interface WinDraft {
  award: string;
  note: string;
}
export interface LoseDraft {
  reason: string;
  competitor: string;
  price: string;
  lessons: string;
}

export const recordWin = (id: number, d: WinDraft, override = false) =>
  apiPost<{ message: string; created?: Record<string, { id: number; name?: string }> }>(`/api/tenders/${id}/win`, { award_value: plain(d.award) || null, ...(d.note.trim() ? { note: d.note.trim() } : {}), ...(override ? { override: true } : {}) });
export const recordLoss = (id: number, d: LoseDraft, override = false) =>
  apiPost(`/api/tenders/${id}/lose`, { lost_reason: d.reason.trim(), competitor: d.competitor.trim() || null, winning_price: plain(d.price) || null, lessons: d.lessons.trim() || null, ...(override ? { override: true } : {}) });

// ── the closing time ────────────────────────────────────────────────────

/** A stored closing instant as the date and time on the reader's clock, for the form. */
export function wallParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = parseTs(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: currentZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/**
 * What the form sends: the instant with its Z when a time is given (read on the
 * reader's clock); a day alone, which the server closes at the end of on the
 * company's calendar; '' to clear it.
 */
export function closingValue(date: string, time: string): string {
  if (!date) return '';
  if (!time) return date;
  const [h, m] = time.split(':').map(Number) as [number, number];
  return wallToUtc(date, h * 60 + m);
}

// ── new and edit ────────────────────────────────────────────────────────

export interface Draft {
  title: string;
  organization: string;
  reference: string;
  date: string;
  time: string;
  budget_max: string;
  budget_min: string;
  bid_value: string;
  currency: string;
  category: string;
  industry: string;
  country: string;
  sector: string;
  priority: string;
  external_url: string;
  description: string;
  /** The owner's id, or '' for nobody. */
  owner: string;
}

export function draftOf(t: TenderRow | null): Draft {
  const w = wallParts(t?.closing_at ?? null);
  return {
    title: t?.title ?? '',
    organization: t?.organization ?? '',
    reference: t?.reference ?? '',
    date: w.date,
    time: w.time,
    budget_max: t?.budget_max ?? '',
    budget_min: t?.budget_min ?? '',
    bid_value: t?.bid_value ?? '',
    currency: t?.currency ?? '',
    category: t?.category ?? '',
    industry: t?.industry ?? '',
    country: t?.country ?? '',
    sector: t?.sector ?? '',
    priority: t?.priority ?? 'normal',
    external_url: t?.external_url ?? '',
    description: t?.description ?? '',
    owner: t?.owner_id ? String(t.owner_id) : '',
  };
}

const TEXT: Array<keyof Draft> = ['title', 'organization', 'reference', 'category', 'industry', 'country', 'external_url', 'description', 'sector', 'priority'];
const AMOUNTS: Array<keyof Draft> = ['budget_max', 'budget_min', 'bid_value'];

const sameAmount = (a: string, b: string) => {
  const x = grouped(plain(a));
  const y = grouped(plain(b));
  return x !== null && y !== null ? x === y : plain(a) === plain(b);
};

/**
 * Only what changed, so a save never re-writes a field somebody else changed
 * a moment ago — and never re-arms the closing reminders with a closing date
 * that did not move.
 */
export function editChanges(before: Draft, after: Draft): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of TEXT) if (after[k].trim() !== before[k].trim()) out[k] = after[k].trim();
  for (const k of AMOUNTS) if (!sameAmount(after[k], before[k])) out[k] = plain(after[k]) || null;
  if (after.currency.trim().toUpperCase() !== before.currency.trim().toUpperCase() && after.currency.trim()) out.currency = after.currency.trim().toUpperCase();
  if (after.date !== before.date || after.time !== before.time) out.closing_at = closingValue(after.date, after.time);
  if (after.owner !== before.owner) out.owner_id = after.owner || null;
  return out;
}

/** A new tender's body; the title is the one thing it cannot be without. */
export function createBody(d: Draft, org: number | null): { body: Record<string, string> | null; error: string | null } {
  if (!d.title.trim()) return { body: null, error: 'A tender needs a title.' };
  const body: Record<string, string> = { title: d.title.trim() };
  if (d.organization.trim()) body.organization = d.organization.trim();
  if (d.reference.trim()) body.reference = d.reference.trim();
  if (d.date) body.closing_at = closingValue(d.date, d.time);
  if (plain(d.budget_max)) body.budget_max = plain(d.budget_max);
  if (d.industry.trim()) body.industry = d.industry.trim();
  if (org) body.org = String(org);
  return { body, error: null };
}

export const createTender = (body: Record<string, string>) => apiPost<{ id: number }>('/api/tenders', body);
export const updateTender = (id: number, changes: Record<string, string | null>) => apiPut(`/api/tenders/${id}`, changes);

export interface ImportResult {
  seen: number;
  dry_run: boolean;
  imported: Array<{ id?: number; row?: number; title?: string }>;
  duplicates: Array<{ row: number; why: string }>;
  rejected: Array<{ row: number; why: string }>;
}

export const importCsv = (csv: string, confirm: boolean, org: number | null) => apiPost<ImportResult>('/api/tender/import/csv', { csv, confirm, ...(org ? { org: String(org) } : {}) });

// ── my access ───────────────────────────────────────────────────────────

export interface ModuleAccess {
  permissions: Array<{ slug: string; name: string; held: boolean }>;
  why: string | null;
}

export const fetchModuleAccess = (signal?: AbortSignal) => apiGet<ModuleAccess>('/api/access/module/Tender', undefined, signal);

// ── competitors (`/api/tenders/{id}/competitors`) ───────────────────────
/*
 * Who else bid, and at what price. The server opens this once the tender is
 * submitted (`available`, with a `reason` before then), sorts by bid price and
 * says whether this person may change it (`can.edit`). Nothing is worked out
 * here beyond showing the lowest of what it sent.
 */

export interface Competitor {
  id: number;
  company_name: string;
  /** A decimal string, as the server keeps it. */
  bid_price: string;
  currency: string;
  remarks: string | null;
  created_by: { id: number; name: string } | null;
  updated_by: { id: number; name: string } | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Competitors {
  available: boolean;
  reason: string | null;
  currency: string;
  can: { edit: boolean };
  competitors: Competitor[];
}

export interface CompetitorDraft {
  company_name: string;
  bid_price: string;
  currency: string;
  remarks: string;
}

export const KC = { competitors: (id: number) => ['tenders', 'competitors', id] as const };

export const fetchCompetitors = (id: number, signal?: AbortSignal) => apiGet<Competitors>(`/api/tenders/${id}/competitors`, undefined, signal);

/** The body as the contract has it: trimmed, the price without grouping, empty remarks sent as null. */
export function competitorBody(d: CompetitorDraft): { company_name: string; bid_price: string; currency?: string; remarks: string | null } {
  const currency = d.currency.trim().toUpperCase();
  return { company_name: d.company_name.trim(), bid_price: plain(d.bid_price), ...(currency ? { currency } : {}), remarks: d.remarks.trim() || null };
}

export const createCompetitor = (id: number, d: CompetitorDraft) => apiPost<{ competitor: Competitor }>(`/api/tenders/${id}/competitors`, competitorBody(d));
export const updateCompetitor = (id: number, cid: number, d: CompetitorDraft) => apiPut<{ competitor: Competitor }>(`/api/tenders/${id}/competitors/${cid}`, competitorBody(d));
export const deleteCompetitor = (id: number, cid: number) => apiDelete<{ id: number }>(`/api/tenders/${id}/competitors/${cid}`);

/** The lowest bid's id (ties: the first, as the server sorted them). */
export function lowestBid(list: Competitor[]): number | null {
  let best: Competitor | null = null;
  for (const c of list) if (!best || Number(c.bid_price) < Number(best.bid_price)) best = c;
  return best?.id ?? null;
}

/** A 422's errors, one sentence per field. */
export function fieldErrors(e: unknown): Record<string, string> | null {
  if (!(e instanceof ApiError) || e.status !== 422 || !e.data || typeof e.data !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.data as Record<string, unknown>)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (typeof first === 'string') out[k] = first;
  }
  return Object.keys(out).length ? out : null;
}
