import { ApiError, apiGet, apiPost, apiPut } from '../../core/api';
import { cents, fromCents, K, money, MONTHS, TYPES } from './api';
import type { FinanceView } from './Rail';

/**
 * Budgets and the year-end close: the plan somebody types against the chart,
 * and the gate a year passes before it is signed.
 *
 * NEITHER WRITES A JOURNAL. A budget is a comparison, not a transaction; a
 * year-end version is a photograph of the accounts, not a posting. Both are
 * read with `finance.reports.view`, because a plan beside the ledger and the
 * statements of a year are the ledger's figures arranged.
 *
 * THE SERVER'S ROWS ARE STRINGS. The database driver answers every column as
 * text (`numberNative` is off), so a version's `balanced` arrives as "0" —
 * which JavaScript reads as true — and an account id as "62", which never
 * equals 62. Everything is normalised here, once, before a screen sees it.
 */

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const nOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const flag = (v: unknown): boolean => v === true || v === 1 || v === '1';
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export const KC = {
  budgets: (c: number) => [...K.company(c), 'budgets'] as const,
  budget: (c: number, id: number) => [...K.company(c), 'budgets', id] as const,
  yearend: (c: number, from = '', to = '') => [...K.company(c), 'yearend', from, to] as const,
};

export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

// ── budgets: months ──────────────────────────────────────────────────────

/** The twelve month keys of a budget, YYYY-MM. A budget is a calendar year, whatever month the books' year starts in. */
export function monthsOf(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${String(year).padStart(4, '0')}-${String(i + 1).padStart(2, '0')}`);
}

/** "2026-03" as "Mar", or "March 2026". */
export function monthLabel(key: string, long = false): string {
  const m = Number(key.slice(5, 7));
  const name = MONTHS[m - 1];
  if (!name) return key;
  return long ? `${name} ${key.slice(0, 4)}` : name.slice(0, 3);
}

/** A month moved onto another year, as a copy does: 2026-07 into 2027 is 2027-07. */
export const restamp = (month: string, year: number) => `${String(year).padStart(4, '0')}${month.slice(4)}`;

// ── budgets: the grid ────────────────────────────────────────────────────

/** The account types a budget may name: profit and loss only. A balance-sheet account is a position, not a plan for a month. */
export const BUDGETABLE = ['revenue', 'cogs', 'expense', 'other_income', 'other_expense'];

/** Where over-plan is good. */
export const INCOME = ['revenue', 'other_income'];

/** The budgetable types in the chart's order, with their labels. */
export const BUDGET_TYPES = TYPES.filter((t) => BUDGETABLE.includes(t.value));

/** A budget's figures as typed: account id → month → text. */
export type Grid = Record<number, Record<string, string>>;

/** One typed cell as cents, or why it is not an amount. */
export type Cell = { cents: number } | { bad: 'negative' | 'nan' };

export function cellOf(text: string | undefined): Cell {
  const c = cents(text ?? '');
  if (c !== null) return { cents: c };
  return /^\s*-/.test(text ?? '') ? { bad: 'negative' } : { bad: 'nan' };
}

const good = (text: string | undefined) => {
  const c = cellOf(text);
  return 'cents' in c ? c.cents : 0;
};

/** A row's total in cents, the cells that are not amounts left out (they are reported, not guessed at). */
export function rowCents(row: Record<string, string> | undefined, months: string[]): number {
  if (!row) return 0;
  return months.reduce((a, m) => a + good(row[m]), 0);
}

export interface Line12 {
  months: number[];
  total: number;
}

const zero12 = (): Line12 => ({ months: Array.from({ length: 12 }, () => 0), total: 0 });

export interface GridTotals {
  byType: Record<string, Line12>;
  income: Line12;
  cost: Line12;
  /** Income less cost: the one figure that says what the plan expects to make. */
  profit: Line12;
}

/**
 * The grid's totals, in cents: by type, and income and cost apart. Adding a
 * sales target to a wages bill gives a figure that means nothing, so there is
 * no grand total — the planned profit is the one number that answers.
 */
export function gridTotals(grid: Grid, typeOf: (id: number) => string, months: string[]): GridTotals {
  const byType: Record<string, Line12> = {};
  const income = zero12();
  const cost = zero12();
  for (const [key, row] of Object.entries(grid)) {
    const type = typeOf(Number(key));
    const t = (byType[type] ??= zero12());
    const side = INCOME.includes(type) ? income : cost;
    months.forEach((m, i) => {
      const c = good(row[m]);
      t.months[i]! += c;
      t.total += c;
      side.months[i]! += c;
      side.total += c;
    });
  }
  const profit: Line12 = { months: income.months.map((v, i) => v - cost.months[i]!), total: income.total - cost.total };
  return { byType, income, cost, profit };
}

/** Cents as the grid shows them: grouped, two places, no currency. */
export const gridMoney = (c: number) => money(fromCents(c));

/**
 * What would stop a save, said before it is tried. A cell that is not an
 * amount stops the save rather than being dropped: the save REPLACES the
 * budget, so a dropped cell would delete the figure stored there.
 */
export function gridProblems(grid: Grid, months: string[], label: (id: number) => string, gone: ReadonlySet<number>): string[] {
  const nan: string[] = [];
  const negative: string[] = [];
  const stranded: string[] = [];
  for (const [key, row] of Object.entries(grid)) {
    const id = Number(key);
    let figures = false;
    for (const m of months) {
      const c = cellOf(row[m]);
      if ('bad' in c) (c.bad === 'negative' ? negative : nan).push(`${label(id)}, ${monthLabel(m, true)}`);
      else if (c.cents > 0) figures = true;
    }
    if (figures && gone.has(id)) stranded.push(label(id));
  }
  const out: string[] = [];
  if (nan.length) out.push(`${nan.length === 1 ? '1 cell is' : `${nan.length} cells are`} not an amount — check ${nan.slice(0, 3).join('; ')}${nan.length > 3 ? '; …' : ''}. Use digits and at most two decimal places.`);
  if (negative.length) out.push(`${negative.length === 1 ? '1 cell is' : `${negative.length} cells are`} negative — ${negative.slice(0, 3).join('; ')}${negative.length > 3 ? '; …' : ''}. Figures are entered as positive amounts for both income and cost.`);
  if (stranded.length) {
    out.push(
      `${stranded.join('; ')} ${stranded.length === 1 ? 'is' : 'are'} no longer an active, postable account. The server refuses a figure against ${stranded.length === 1 ? 'it' : 'them'}, and a save replaces the whole grid — so clear ${stranded.length === 1 ? 'its' : 'their'} cells to save, which takes those figures out of this draft.`,
    );
  }
  return out;
}

export interface BudgetLine {
  account_id: number;
  month: string;
  amount: string;
}

/** Every figure in the grid — not only the rows on screen — as the save sends it. Empty and nil cells are not stored. */
export function gridLines(grid: Grid, months: string[]): BudgetLine[] {
  const out: BudgetLine[] = [];
  for (const [key, row] of Object.entries(grid)) {
    for (const m of months) {
      const c = cellOf(row[m]);
      if ('cents' in c && c.cents > 0) out.push({ account_id: Number(key), month: m, amount: fromCents(c.cents) });
    }
  }
  return out;
}

/** How many figures a grid holds. */
export const gridCount = (grid: Grid, months: string[]) => gridLines(grid, months).length;

// ── budgets: the API ─────────────────────────────────────────────────────

export type BudgetStatus = 'draft' | 'approved' | 'archived';

export interface BudgetRow {
  id: number;
  year: number;
  name: string;
  status: BudgetStatus | string;
  note: string | null;
  approved_at: string | null;
  /** How many figures it holds. */
  lines: number;
  /** Every figure added, income and cost together — see the list's note. */
  total: string;
}

export interface BudgetAccount {
  id: number;
  code: string;
  name: string;
  type: string;
}

export interface BudgetList {
  currency: string | null;
  rows: BudgetRow[];
  /** Whether this person may write budgets at all (`finance.budget.manage`). */
  can_edit: boolean;
  /** The accounts a budget may be set against — the server's rule, so the editor cannot disagree with it. */
  accounts: BudgetAccount[];
}

export interface BudgetDetail {
  id: number;
  year: number;
  name: string;
  status: BudgetStatus | string;
  note: string | null;
  approved_at: string | null;
  months: string[];
  /** The accounts it has figures for, including any archived since. */
  accounts: Array<{ account_id: number; code: string; name: string; type: string; months: Record<string, string>; total: string }>;
  currency: string | null;
  /** The figures may be typed into: a draft, and a person who writes budgets. */
  can_edit: boolean;
  /** This person writes budgets — Copy and Archive, which an approved budget still offers. */
  can_manage: boolean;
}

interface RawList {
  currency?: string | null;
  rows?: Array<Record<string, unknown>>;
  can_edit?: unknown;
  accounts?: Array<Record<string, unknown>>;
}

export function normaliseBudgetList(r: RawList): BudgetList {
  return {
    currency: r.currency ?? null,
    can_edit: flag(r.can_edit),
    rows: (r.rows ?? []).map((b) => ({
      id: n(b.id),
      year: n(b.year),
      name: String(b.name ?? ''),
      status: String(b.status ?? 'draft'),
      note: str(b.note),
      approved_at: str(b.approved_at),
      lines: n(b.lines),
      total: String(b.total ?? '0'),
    })),
    accounts: (r.accounts ?? []).map((a) => ({ id: n(a.id), code: String(a.code ?? ''), name: String(a.name ?? ''), type: String(a.type ?? '') })),
  };
}

export function normaliseBudget(r: Record<string, unknown>): BudgetDetail {
  const year = n(r.year);
  const months = Array.isArray(r.months) && r.months.length === 12 ? (r.months as unknown[]).map(String) : monthsOf(year);
  const accounts = Array.isArray(r.accounts) ? (r.accounts as Array<Record<string, unknown>>) : [];
  return {
    id: n(r.id),
    year,
    name: String(r.name ?? ''),
    status: String(r.status ?? 'draft'),
    note: str(r.note),
    approved_at: str(r.approved_at),
    months,
    accounts: accounts.map((a) => ({
      account_id: n(a.account_id),
      code: String(a.code ?? ''),
      name: String(a.name ?? ''),
      type: String(a.type ?? 'expense'),
      months: Object.fromEntries(Object.entries((a.months ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
      total: String(a.total ?? '0'),
    })),
    currency: str(r.currency),
    can_edit: flag(r.can_edit),
    can_manage: flag(r.can_manage),
  };
}

/** The grid a stored budget starts from, each figure as the person would type it. */
export function gridFrom(d: BudgetDetail): Grid {
  const g: Grid = {};
  for (const a of d.accounts) g[a.account_id] = Object.fromEntries(Object.entries(a.months).map(([m, v]) => [m, money(v)]));
  return g;
}

export const fetchBudgets = (company: number, signal?: AbortSignal) => apiGet<RawList>('/api/finance/budgets', { company }, signal).then(normaliseBudgetList);

export const fetchBudget = (company: number, id: number, signal?: AbortSignal) => apiGet<Record<string, unknown>>(`/api/finance/budgets/${id}`, { company }, signal).then(normaliseBudget);

/** A new draft, empty or seeded from a year's actuals (positive months only; a credit-note month is left for somebody to fill in). */
export const createBudget = (company: number, b: { year: number; name: string; note: string; seedFrom: number | null }) =>
  apiPost<{ id?: number | string; seeded?: number | string }>('/api/finance/budgets', {
    company_id: company,
    year: b.year,
    ...(b.name.trim() ? { name: b.name.trim() } : {}),
    ...(b.note.trim() ? { note: b.note.trim() } : {}),
    ...(b.seedFrom ? { seed_from_year: b.seedFrom } : {}),
  });

/** The whole grid, replacing what is stored — inside one transaction on the server. */
export const saveBudgetLines = (company: number, id: number, lines: BudgetLine[]) => apiPut<{ written?: number | string }>(`/api/finance/budgets/${id}/lines`, { company_id: company, lines });

export const approveBudget = (company: number, id: number) => apiPost(`/api/finance/budgets/${id}/approve`, { company_id: company });

export const archiveBudget = (company: number, id: number) => apiPost(`/api/finance/budgets/${id}/archive`, { company_id: company });

/** A new draft from this one; into another year, its months are moved onto that year by the server. */
export const copyBudget = (company: number, id: number, c: { year: number; name: string }) =>
  apiPost<{ id?: number | string; written?: number | string }>(`/api/finance/budgets/${id}/copy`, { company_id: company, year: c.year, ...(c.name.trim() ? { name: c.name.trim() } : {}) });

// ── the year-end close ───────────────────────────────────────────────────

export interface Blocker {
  kind: string;
  detail: string;
}

export interface CloseVersion {
  id: number;
  version_no: number;
  period_start: string;
  period_end: string;
  balanced: boolean;
  net_profit: string | null;
  total_assets: string | null;
  status: 'generated' | 'approved' | 'superseded' | string;
  reason: string | null;
  generated_at: string | null;
  /** Not sent today (only the name is); used when it is. */
  generated_by: number | null;
  generated_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  max_journal_id: number | null;
  journal_count: number;
}

export interface CloseTask {
  id: number;
  code: string;
  title: string;
  detail: string | null;
  /** False: worth doing, and does not block signing. */
  required: boolean;
  status: 'open' | 'done' | 'skipped' | string;
  note: string | null;
  completed_by_name: string | null;
  completed_at: string | null;
}

export interface YearEndData {
  report: { id: number; title: string; status: 'draft' | 'approved' | 'locked' | string } | null;
  year: { id: number; name: string; starts_on: string; ends_on: string; status: string } | null;
  versions: CloseVersion[];
  tasks: CloseTask[];
  history: Array<{ action: string; note: string | null; created_at: string; actor_name: string | null }>;
  readiness: { ok: boolean; blockers: Blocker[]; warnings: Blocker[] };
  /** The server's id for the person asking. */
  me: number | null;
  base_currency: string | null;
}

const blockers = (v: unknown): Blocker[] =>
  Array.isArray(v) ? v.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object').map((b) => ({ kind: String(b.kind ?? ''), detail: String(b.detail ?? '') })) : [];

export function normaliseYearEnd(r: Record<string, unknown>): YearEndData {
  const rep = r.report as Record<string, unknown> | null | undefined;
  const y = r.year as Record<string, unknown> | null | undefined;
  const ready = (r.readiness ?? {}) as Record<string, unknown>;
  const b = blockers(ready.blockers);
  return {
    report: rep ? { id: n(rep.id), title: String(rep.title ?? 'Annual report'), status: String(rep.status ?? 'draft') } : null,
    year: y ? { id: n(y.id), name: String(y.name ?? ''), starts_on: String(y.starts_on ?? ''), ends_on: String(y.ends_on ?? ''), status: String(y.status ?? '') } : null,
    versions: ((r.versions ?? []) as Array<Record<string, unknown>>).map((v) => ({
      id: n(v.id),
      version_no: n(v.version_no),
      period_start: String(v.period_start ?? ''),
      period_end: String(v.period_end ?? ''),
      balanced: flag(v.balanced),
      net_profit: str(v.net_profit),
      total_assets: str(v.total_assets),
      status: String(v.status ?? 'generated'),
      reason: str(v.reason),
      generated_at: str(v.generated_at),
      generated_by: nOrNull(v.generated_by),
      generated_by_name: str(v.generated_by_name),
      approved_by_name: str(v.approved_by_name),
      approved_at: str(v.approved_at),
      max_journal_id: nOrNull(v.max_journal_id),
      journal_count: n(v.journal_count),
    })),
    tasks: ((r.tasks ?? []) as Array<Record<string, unknown>>).map((t) => ({
      id: n(t.id),
      code: String(t.code ?? ''),
      title: String(t.title ?? ''),
      detail: str(t.detail),
      required: flag(t.required),
      status: String(t.status ?? 'open'),
      note: str(t.note),
      completed_by_name: str(t.completed_by_name),
      completed_at: str(t.completed_at),
    })),
    history: ((r.history ?? []) as Array<Record<string, unknown>>).map((h) => ({ action: String(h.action ?? ''), note: str(h.note), created_at: String(h.created_at ?? ''), actor_name: str(h.actor_name) })),
    // `ok` is re-derived rather than trusted alone: a blocker listed is a blocker.
    readiness: { ok: flag(ready.ok) && b.length === 0, blockers: b, warnings: blockers(ready.warnings) },
    me: nOrNull(r.me),
    base_currency: str(r.base_currency),
  };
}

/** The close workspace for a year — the server's open year when no window is named. */
export const fetchYearEnd = (company: number, win: { from: string; to: string } | null, signal?: AbortSignal) =>
  apiGet<Record<string, unknown>>('/api/finance/annual-report', { company, ...(win ?? {}) }, signal).then(normaliseYearEnd);

/** Opens the workspace and seeds its checklist. Pressing it twice opens the same one. The window rides in the query, where the server reads it. */
export const openYearEnd = (company: number, win: { from: string; to: string } | null) => apiPost<{ id?: number }>('/api/finance/annual-report', { company_id: company }, win ?? undefined);

export const generateVersion = (company: number, report: number, reason: string | null) =>
  apiPost<{ version_no?: number | string }>(`/api/finance/annual-report/${report}/generate`, { company_id: company, reason });

export const approveVersion = (company: number, version: number) => apiPost(`/api/finance/annual-report/versions/${version}/approve`, { company_id: company });

export const lockYear = (company: number, report: number) => apiPost(`/api/finance/annual-report/${report}/lock`, { company_id: company });

export const reopenYear = (company: number, report: number, reason: string) => apiPost(`/api/finance/annual-report/${report}/lock`, { company_id: company, reopen: true, reason });

export const setCloseTask = (company: number, task: number, status: 'open' | 'done' | 'skipped') => apiPut(`/api/finance/close-tasks/${task}`, { company_id: company, status });

/** The version that counts: the newest one not superseded. */
export const currentVersion = (vs: CloseVersion[]) => vs.find((v) => v.status !== 'superseded') ?? vs[0] ?? null;

/**
 * Did the person asking generate this version? By id when the server sends
 * the generator's; otherwise by name, which is all the list carries today.
 */
export function generatedByMe(v: CloseVersion, me: number | null, myName: string | null | undefined): boolean {
  if (v.generated_by !== null && me !== null) return v.generated_by === me;
  return !!myName && !!v.generated_by_name && v.generated_by_name.trim().toLowerCase() === myName.trim().toLowerCase();
}

/**
 * An approval the server refused, as every line of it: its sentence (which
 * carries the first blocker), then any further blockers it listed.
 */
export function approveRefusal(e: unknown): string[] {
  if (e instanceof ApiError) {
    const more = blockers((e.data as { blockers?: unknown } | null)?.blockers);
    return [e.message, ...more.slice(1).map((b) => b.detail)];
  }
  return [e instanceof Error ? e.message : String(e)];
}

/** Where a blocker (or a warning) is cleared, and what that screen is called. */
export const BLOCKER_GO: Record<string, { view: FinanceView; label: string }> = {
  balance: { view: 'bs', label: 'Balance sheet' },
  unposted: { view: 'unposted', label: 'Not in the ledger' },
  unpostable: { view: 'unposted', label: 'Not in the ledger' },
  unposted_other: { view: 'unposted', label: 'Not in the ledger' },
  draft_journals: { view: 'journals', label: 'Journals' },
  reconciliation: { view: 'reconcile', label: 'Reconciliation' },
  never_reconciled: { view: 'reconcile', label: 'Reconciliation' },
  depreciation: { view: 'depreciation', label: 'Depreciation' },
};

/** A blocker's kind as a word. */
export const BLOCKER_WORD: Record<string, string> = {
  balance: 'Does not balance',
  unposted: 'Ready to post',
  unpostable: 'Cannot post as it stands',
  unposted_other: 'Other years',
  draft_journals: 'Journals not posted',
  reconciliation: 'Reconciliation open',
  never_reconciled: 'Never reconciled',
  depreciation: 'Depreciation',
  task: 'Checklist',
};

export const kindWord = (kind: string) => BLOCKER_WORD[kind] ?? kind.replace(/_/g, ' ');

/** The screen behind each checklist task. Stock is counted in Inventory, which is not a Finance screen. */
export const TASK_GO: Record<string, { view: FinanceView; label: string }> = {
  bank: { view: 'reconcile', label: 'Reconciliation' },
  unposted: { view: 'unposted', label: 'Not in the ledger' },
  journals: { view: 'journals', label: 'Journals' },
  depreciation: { view: 'depreciation', label: 'Depreciation' },
  accruals: { view: 'journals', label: 'Journals' },
  review: { view: 'pl', label: 'Profit and loss' },
};
