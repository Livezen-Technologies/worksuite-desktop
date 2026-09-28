import { ApiError, apiGet } from '../../core/api';
import { isZero, K, shortDate } from './api';

/**
 * The reports read from the books: the general ledger, the trial balance, the
 * profit and loss, the balance sheet, the cash flow and the changes in equity.
 *
 * EVERY ONE NEEDS `finance.reports.view`, AT THE ROUTE. Unlike the journals
 * list, which sends the shape and leaves the amounts out, these endpoints
 * refuse outright without the grant — there is no report of dashes to draw.
 * So a refusal is shown for what it is, naming the grant, and never as "no
 * figures" or as a failed request somebody should retry.
 *
 * POSTED JOURNALS ONLY. The server reads `Ledger::IN_BOOKS` for all six; a
 * report that counted drafts would balance while describing a position the
 * company is not in. The screens say so rather than assume it is known.
 *
 * THE WINDOW IS THE SERVER'S WHEN NONE IS GIVEN. An empty date is not sent:
 * the statements then cover the open financial year, the trial balance and
 * the ledger everything posted. Every screen captions the window from the
 * answer, never from its own idea of what the default was.
 */

/** The ledger's page. The server's ceiling; past it the page says it was cut short. */
export const LEDGER_LIMIT = 5000;

/** Keys: the company, then every filter — a date left out would serve the last window's figures under the new heading. */
export const RK = {
  ledger: (c: number, account: string, from: string, to: string) => [...K.company(c), 'ledger', account, from, to] as const,
  trial: (c: number, from: string, to: string) => [...K.company(c), 'trial-balance', from, to] as const,
  pl: (c: number, from: string, to: string) => [...K.company(c), 'profit-and-loss', from, to] as const,
  bs: (c: number, asOf: string) => [...K.company(c), 'balance-sheet', asOf] as const,
  cf: (c: number, from: string, to: string) => [...K.company(c), 'cash-flow', from, to] as const,
  eq: (c: number, from: string, to: string) => [...K.company(c), 'changes-in-equity', from, to] as const,
};

// ── the general ledger ───────────────────────────────────────────────────

export interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  type: string;
  normal_balance: 'debit' | 'credit' | string;
  /** An archived account keeps its ledger, and its code may since belong to another. */
  status?: string | null;
}

export interface LedgerRow {
  journal_id: number;
  journal_no: string;
  entry_date: string;
  reference: string | null;
  description: string | null;
  /** The journal's own words, for a line that has none. */
  journal_description: string | null;
  debit: string;
  credit: string;
  /** Running, in the account's NORMAL direction — the server's arithmetic, not ours. */
  balance: string;
  status: string;
  source_type: string | null;
  source_id: number | null;
  reverses_id: number | null;
  reversed_by_id: number | null;
}

export interface LedgerData {
  account: LedgerAccount;
  /** Everything posted before `from`; zero, and meaningless, without one. */
  opening: string;
  rows: LedgerRow[];
  /** The whole window's closing figure, even when `rows` was cut short. */
  closing: string;
  truncated: boolean;
  limit: number;
}

export const fetchLedger = (company: number, q: { account: string; from: string; to: string }, signal?: AbortSignal) =>
  apiGet<LedgerData>('/api/finance/ledger', { company, account: q.account, from: q.from, to: q.to, limit: LEDGER_LIMIT }, signal);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** What a link into the ledger asked for (`&account=12&from=…&to=…`), each part only if it is well formed. */
export function readLedgerQuery(query: URLSearchParams): { account: string; from: string; to: string } {
  const account = query.get('account') ?? '';
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  return { account: /^\d+$/.test(account) ? account : '', from: ISO.test(from) ? from : '', to: ISO.test(to) ? to : '' };
}

/** The rest of an address into the ledger, for `onGo('ledger', …)`. */
export function ledgerExtra(account: number | string, from?: string | null, to?: string | null): string {
  return `${account !== '' ? `&account=${account}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;
}

// ── the trial balance ────────────────────────────────────────────────────

export interface TrialRow {
  account_id: number;
  code: string;
  name: string;
  type: string;
  normal_balance: string;
  /** Two rows can both read 6100 — the archived account and its replacement. */
  status?: string | null;
  debit: string;
  credit: string;
}

export interface TrialBalance {
  rows: TrialRow[];
  total_debit: string;
  total_credit: string;
  balanced: boolean;
  difference: string;
  from: string | null;
  to: string | null;
  /** Which question was answered: a position at a date, or the movements in a window. */
  mode: 'position' | 'movement';
}

export const fetchTrialBalance = (company: number, from: string, to: string, signal?: AbortSignal) => apiGet<TrialBalance>('/api/finance/trial-balance', { company, from, to }, signal);

/**
 * What the figures are, from the server's `mode` rather than restated here: a
 * screen that describes the report's behaviour in its own words is a second
 * copy of that behaviour, and copies go stale.
 */
export function trialCaption(d: Pick<TrialBalance, 'mode' | 'from' | 'to'>): string {
  if (d.mode === 'movement') {
    return `Movements posted between ${shortDate(d.from)}${d.to ? ` and ${shortDate(d.to)}` : ' and today'} — what changed in the window, not what each account stands at.`;
  }
  return d.to ? `Balances as at ${shortDate(d.to)} — everything posted up to that date.` : 'Balances to date — everything posted.';
}

// ── the profit and loss, and the balance sheet ───────────────────────────

export interface StatementLine {
  account_id: number;
  code: string;
  name: string;
  /** Shown the way a reader expects: revenue and liabilities positive. */
  amount: string;
}

/** A heading from the chart, with the accounts under it. */
export interface StatementSection {
  name: string;
  lines: StatementLine[];
  total: string;
}

export interface StatementGroup {
  sections: StatementSection[];
  total: string;
}

export interface ProfitAndLossStatement {
  from: string;
  to: string;
  groups: Partial<Record<'revenue' | 'cogs' | 'expense' | 'other_income' | 'other_expense', StatementGroup>>;
  subtotals: Partial<Record<'revenue' | 'cogs' | 'gross_profit' | 'expenses' | 'operating_profit' | 'other_income' | 'other_expense', string>>;
  net_profit: string;
}

export interface BalanceSheetStatement {
  as_of: string;
  year_start: string;
  groups: Partial<Record<'asset' | 'liability' | 'equity', StatementGroup>>;
  totals: {
    assets: string;
    liabilities: string;
    equity_in_books?: string;
    /** Computed: 3300 stays empty until a year-end close writes to it. */
    profit_for_the_year: string;
    /** Earlier years' result still sitting unclosed in the P&L accounts. */
    profit_brought_forward: string;
    equity?: string;
    liabilities_and_equity: string;
  };
  difference: string;
  balanced: boolean;
}

/** A statement and the same window a year back — not last fiscal year, so five months never sit beside twelve. */
export interface WithComparative<T> {
  statement: T;
  comparative: T;
  base_currency: string | null;
}

export const fetchProfitAndLoss = (company: number, from: string, to: string, signal?: AbortSignal) =>
  apiGet<WithComparative<ProfitAndLossStatement>>('/api/finance/profit-and-loss', { company, from, to }, signal);

export const fetchBalanceSheet = (company: number, asOf: string, signal?: AbortSignal) =>
  apiGet<WithComparative<BalanceSheetStatement>>('/api/finance/balance-sheet', { company, as_of: asOf }, signal);

export interface MergedLine {
  account_id: number;
  code: string;
  name: string;
  /** Null: the account did not move in that window (a zero, not a missing year). */
  amount: string | null;
  prior: string | null;
}

export interface MergedSection {
  name: string;
  total: string | null;
  prior: string | null;
  lines: MergedLine[];
}

/**
 * A group's sections with the comparative beside them, MATCHED BY ACCOUNT.
 *
 * An account that did not move last year is absent from that side entirely,
 * so lining the two lists up by position would shift every row below it. And
 * the other way round: an account that moved last year and not this one is
 * absent from THIS side — dropping it, as matching on the current lines alone
 * does, leaves a prior column that does not add up to its own subtotal. So
 * those are kept too, after this year's lines, with no figure for now.
 */
export function mergeSections(now?: StatementGroup | null, before?: StatementGroup | null): MergedSection[] {
  const out: MergedSection[] = [];
  const byName = new Map<string, MergedSection>();
  const byAccount = new Map<number, MergedLine>();
  for (const s of now?.sections ?? []) {
    const m: MergedSection = { name: s.name, total: s.total, prior: null, lines: [] };
    for (const l of s.lines) {
      const line: MergedLine = { account_id: l.account_id, code: l.code, name: l.name, amount: l.amount, prior: null };
      m.lines.push(line);
      byAccount.set(l.account_id, line);
    }
    out.push(m);
    byName.set(s.name, m);
  }
  for (const s of before?.sections ?? []) {
    let m = byName.get(s.name);
    if (!m) {
      m = { name: s.name, total: null, prior: null, lines: [] };
      out.push(m);
      byName.set(s.name, m);
    }
    m.prior = s.total;
    for (const l of s.lines) {
      const hit = byAccount.get(l.account_id);
      if (hit) hit.prior = l.amount;
      else m.lines.push({ account_id: l.account_id, code: l.code, name: l.name, amount: null, prior: l.amount });
    }
  }
  return out;
}

const anyLines = (groups?: Partial<Record<string, StatementGroup>>) => Object.values(groups ?? {}).some((g) => (g?.sections?.length ?? 0) > 0);

/**
 * Was there a last year? A company in its first year has no prior column,
 * and that is a dash, not 0.00 — a zero says "we sold nothing last year", a
 * dash says "there was no last year".
 */
export const hadPriorPL = (p?: ProfitAndLossStatement | null) => !!p && (!isZero(p.net_profit) || anyLines(p.groups));

export const hadPriorBS = (p?: BalanceSheetStatement | null) => !!p && (!isZero(p.totals?.assets) || !isZero(p.totals?.liabilities_and_equity) || anyLines(p.groups));

// ── cash flow and changes in equity ──────────────────────────────────────

export interface CashLine {
  account_id: number;
  code: string;
  name: string;
  /** The chart heading the activity was decided by — shown, so a wrong call is visible. */
  section: string;
  amount: string;
}

export interface CashActivity {
  name: string;
  lines: CashLine[];
  total: string;
}

export interface CashFlowStatement {
  from: string;
  to: string;
  activities: Partial<Record<'operating' | 'investing' | 'financing', CashActivity>>;
  opening_cash: string;
  closing_cash: string;
  movement: string;
  derived: string;
  difference: string;
  reconciles: boolean;
}

export interface EquityStatement {
  from: string;
  to: string;
  opening: string;
  profit_brought_forward: string;
  movements: CashLine[];
  movements_total: string;
  profit: string;
  closing: string;
  closing_per_balance_sheet: string;
  reconciles: boolean;
}

export const ACTIVITIES = ['operating', 'investing', 'financing'] as const;

export const fetchCashFlow = (company: number, from: string, to: string, signal?: AbortSignal) =>
  apiGet<{ statement: CashFlowStatement; comparative?: CashFlowStatement; base_currency: string | null }>('/api/finance/cash-flow', { company, from, to }, signal);

export const fetchChangesInEquity = (company: number, from: string, to: string, signal?: AbortSignal) =>
  apiGet<{ statement: EquityStatement; base_currency: string | null }>('/api/finance/changes-in-equity', { company, from, to }, signal);

// ── windows, refusals, files ─────────────────────────────────────────────

/** A window that ends before it starts, which no journal can fall in. */
export const backwards = (from: string, to: string) => from !== '' && to !== '' && from > to;

/**
 * The grant a refusal names, when the refusal is a missing grant. The
 * permission filter answers "Missing permission: finance.reports.view"; a 403
 * for a company that is not the caller's is a different refusal and is not
 * one of these.
 */
export function missingGrant(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 403) return null;
  const m = /missing permission:\s*([a-z0-9_.]+)/i.exec(e.message);
  return m ? m[1]! : null;
}

/** The server's own sentence for a refusal it meant (a 4xx), or null for a request that simply failed. */
export function refusedWhy(e: unknown): string | null {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 ? e.message : null;
}

/** A count as a person writes it: 5,000. */
export const count = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The file a report is saved as: the company, the report, the window — so two companies' P&Ls never collide. */
export function csvName(company: string, report: string, from: string, to: string, lines = false): string {
  const who = company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${who ? `${who}-` : ''}${report}${lines ? '-transactions' : ''}-${from}-to-${to}.csv`;
}

/** The web's page that lays one report out to print, and prints itself. */
export const printPath = (report: string, company: number, from: string, to: string) => `/finance/print/${report}?company=${company}&from=${from}&to=${to}`;
