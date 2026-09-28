import { ApiError, apiGet, apiPost, apiPut } from '../../core/api';

/**
 * Finance (the server's `/api/finance`): the company's double-entry books —
 * the chart, journals and periods, and the reports read from them.
 *
 * THE COMPANY IS THE SUBJECT, NOT A FILTER. Every call names one company, as
 * `?company=` on a read and `company_id` in a write's body, and every query key
 * carries it: a key without it would show one company's figures under
 * another's heading for as long as the refetch takes, and on a screen of
 * plausible money that is the dangerous kind of stale. There is no "every
 * company" here except the consolidated report, which says so.
 *
 * MONEY STAYS A STRING. Amounts are DECIMAL(18,2) on the server and come back
 * as strings; they are formatted as text and summed as integer cents, never
 * through a float, so "0.1 + 0.2" is never 0.30000000000000004 and an eleven-
 * digit balance keeps its cents.
 *
 * A MISSING FIGURE IS NOT A ZERO. Without `finance.reports.view` the server
 * sends the shape of things — which accounts, which journals — and leaves the
 * amount keys out. The screens show a dash and say why, never 0.00.
 *
 * REFUSALS ARE LISTS. A write the server refuses answers every problem at once
 * in `data.problems`; the screens show all of them, not the first.
 */

export const can = (perms: readonly string[] | undefined, slug: string) => !!perms && (perms.includes('*') || perms.includes(slug));

export interface Company {
  id: number;
  name: string;
  base_currency: string | null;
  fiscal_year_start_month: number | null;
  books_opened_at: string | null;
  has_books: boolean;
}

export const K = {
  all: ['finance'] as const,
  companies: (uid: string) => ['finance', 'companies', uid] as const,
  access: ['finance', 'access'] as const,
  moduleAccess: ['finance', 'module-access'] as const,
  currencies: ['finance', 'currencies'] as const,
  company: (c: number) => ['finance', 'c', c] as const,
  dashboard: (c: number) => ['finance', 'c', c, 'dashboard'] as const,
  accounts: (c: number) => ['finance', 'c', c, 'accounts'] as const,
  journals: (c: number) => ['finance', 'c', c, 'journals'] as const,
  journal: (c: number, id: number) => ['finance', 'c', c, 'journal', id] as const,
  periods: (c: number) => ['finance', 'c', c, 'periods'] as const,
};

// ── money ────────────────────────────────────────────────────────────────

/**
 * An amount as the web writes it: grouped, fixed decimals, sign kept, from the
 * string the server sent. A value that is not a number renders as zero rather
 * than as its garbage — it is a bug upstream, not a figure.
 */
export function money(amount: string | number | null | undefined, currency = '', decimals = 2): string {
  const s = String(amount ?? '').trim().replace(/,/g, '');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  const d = Number.isInteger(decimals) && decimals >= 0 && decimals <= 8 ? decimals : 2;
  const zero = d === 0 ? '0' : `0.${'0'.repeat(d)}`;
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return `${currency} ${zero}`.trim();
  const sign = m[1] === '-' ? '-' : '';
  const whole = (m[2] || '0').replace(/^0+(?=\d)/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (d === 0) return `${currency} ${sign}${grouped}`.trim();
  const frac = ((m[3] ?? '') + '0'.repeat(d)).slice(0, d);
  return `${currency} ${sign}${grouped}.${frac}`.trim();
}

/** Zero, empty, or not a number at all (which is not a figure to show). */
export function isZero(amount: string | number | null | undefined): boolean {
  const s = String(amount ?? '').trim().replace(/,/g, '');
  return s === '' || /^[+-]?0*(\.0*)?$/.test(s) || !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s);
}

/** Below zero, read from the string. */
export const isNegative = (amount: string | number | null | undefined) => /^\s*-/.test(String(amount ?? '')) && !isZero(amount);

/** A typed amount as integer cents: 0 for empty, null when it is not a number with at most two decimals. */
export function cents(v: string): number | null {
  const s = v.trim().replace(/,/g, '');
  if (s === '') return 0;
  if (!/^\d*(\.\d{0,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w || '0') * 100 + Number((f + '00').slice(0, 2));
}

export function fromCents(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

// ── refusals ─────────────────────────────────────────────────────────────

/** Every problem the server named, or its one message. */
export function problemsOf(e: unknown): string[] {
  if (e instanceof ApiError) {
    const d = e.data as { problems?: unknown } | null;
    const list = Array.isArray(d?.problems) ? d!.problems.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [];
    return list.length ? list : [e.message];
  }
  return [e instanceof Error ? e.message : String(e)];
}

/** One line for a toast: the single problem, or "3 problems: …". */
export function refusal(e: unknown): string {
  const list = problemsOf(e);
  return list.length > 1 ? `${list.length} problems: ${list.join(' ')}` : (list[0] ?? 'That did not work.');
}

// ── dates ────────────────────────────────────────────────────────────────

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09-25" as "25 September 2026", from its digits — never through `new Date()`, which shifts a bare date. */
export function longDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-09-25" as "25 Sep 2026". */
export function shortDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]!.slice(0, 3)} ${y}`;
}

/** A calendar date some months on, the day clamped to the month's length. */
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// ── companies and access ─────────────────────────────────────────────────

export const fetchCompanies = (signal?: AbortSignal) => apiGet<{ companies: Company[] }>('/api/finance/companies', undefined, signal).then((r) => r.companies ?? []);

export interface AccessExplain {
  super: boolean;
  companies: Array<{ id: number; name: string; role: string; has_books: boolean }>;
  excluded: Array<{ id: number; name: string; role: string; why: string }>;
  ledger_roles: string[];
  permissions: Array<{ slug: string; name: string; held: boolean }>;
}
export const fetchAccess = (signal?: AbortSignal) => apiGet<AccessExplain>('/api/finance/access', undefined, signal);

export interface ModuleAccess {
  why?: string | null;
  permissions: Array<{ slug: string; name: string; held: boolean }>;
}
export const fetchModuleAccess = (signal?: AbortSignal) => apiGet<ModuleAccess>('/api/access/module/Finance', undefined, signal);

export const fetchCurrencies = (signal?: AbortSignal) => apiGet<{ currencies: Array<{ code: string; name: string }> }>('/api/finance/currencies', undefined, signal).then((r) => r.currencies ?? []);

export const openBooks = (company: number, body: { base_currency: string; fiscal_year_start_month: number; first_year: number }) =>
  apiPost<{ message?: string }>(`/api/finance/companies/${company}/open-books`, body);

// ── the overview ─────────────────────────────────────────────────────────

export interface BankSummary {
  lines: number;
  matched: number;
  unmatched: number;
  first_seen: string;
  last_seen: string;
  closing: string | null;
  ledger: string;
  difference: string | null;
  in_open: number;
  out_open: number;
  in_value: string;
  out_value: string;
  no_ledger_payments_out: boolean;
  locked_through: string | null;
}

export interface TieOut {
  agrees: boolean;
  difference?: string;
  control?: string;
  subledger?: string;
}

export interface Owed {
  total: string;
  tie_out?: TieOut | null;
  buckets?: Record<string, string> | null;
}

export interface Dashboard {
  has_books: boolean;
  as_of?: string;
  currency?: string | null;
  balanced?: boolean;
  accounts_used?: number;
  unposted?: number;
  awaiting_post?: number;
  may_read_figures?: boolean;
  difference?: string;
  total_debit?: string;
  total_credit?: string;
  receivables?: Owed;
  payables?: Owed;
  unposted_documents?: number;
  unposted_split?: { documents: number; claims: number };
  staff_payable?: { code: string; name: string; total: string } | null;
  bank?: BankSummary | null;
  year?: { name: string; starts_on: string; ends_on: string; revenue: string; cogs: string; gross: string; expenses: string; net: string } | null;
}
export const fetchDashboard = (company: number, signal?: AbortSignal) => apiGet<Dashboard>('/api/finance/dashboard', { company }, signal);

// ── the chart ────────────────────────────────────────────────────────────

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense' | 'other_income' | 'other_expense';

export interface Account {
  id: number;
  code: string;
  name: string;
  type: AccountType | string;
  normal_balance: string;
  is_postable: boolean;
  is_system: boolean;
  status?: string;
  /** Absent on an installation without the migration. */
  cost_behaviour?: string;
  children: Account[];
}

export const TYPES: Array<{ value: AccountType; label: string; normal: 'debit' | 'credit' }> = [
  { value: 'asset', label: 'Asset', normal: 'debit' },
  { value: 'liability', label: 'Liability', normal: 'credit' },
  { value: 'equity', label: 'Equity', normal: 'credit' },
  { value: 'revenue', label: 'Revenue', normal: 'credit' },
  { value: 'cogs', label: 'Cost of goods sold', normal: 'debit' },
  { value: 'expense', label: 'Expense', normal: 'debit' },
  { value: 'other_income', label: 'Other income', normal: 'credit' },
  { value: 'other_expense', label: 'Other expense', normal: 'debit' },
];

/** The account types a fixed-or-variable classification means anything for. */
export const COSTABLE = ['cogs', 'expense', 'other_expense'];

export const BEHAVIOURS: Array<[string, string]> = [
  ['unclassified', 'Not classified'],
  ['fixed', 'Fixed'],
  ['variable', 'Variable'],
  ['semi_variable', 'Partly fixed'],
];

/** The tree as rows, each with its depth, in the tree's order. */
export function flattenAccounts(nodes: Account[], depth = 0, out: Array<Account & { depth: number }> = []): Array<Account & { depth: number }> {
  for (const n of nodes) {
    out.push({ ...n, depth });
    if (n.children?.length) flattenAccounts(n.children, depth + 1, out);
  }
  return out;
}

/** What a journal line may name: live, postable accounts. */
export function postable(nodes: Account[]): Account[] {
  return flattenAccounts(nodes).filter((a) => a.is_postable && a.status !== 'archived');
}

export const fetchAccounts = (company: number, signal?: AbortSignal) => apiGet<{ accounts: Account[] }>('/api/finance/accounts', { company }, signal).then((r) => r.accounts ?? []);

export const createAccount = (company: number, a: { code: string; name: string; type: string; parent_id: number | null; is_postable: boolean }) =>
  apiPost<{ id?: number }>('/api/finance/accounts', { company_id: company, ...a });

export const archiveAccount = (company: number, id: number) => apiPost<{ message?: string }>(`/api/finance/accounts/${id}/archive`, { company_id: company });

/** The route reads the company from the query string, not the body. */
export const setBehaviour = (company: number, id: number, behaviour: string) => apiPut(`/api/finance/accounts/${id}/behaviour?company=${company}`, { behaviour });

// ── journals ─────────────────────────────────────────────────────────────

export type JournalStatus = 'draft' | 'pending' | 'approved' | 'posted' | 'reversed' | 'cancelled';

export interface Journal {
  id: number;
  journal_no: string;
  entry_date: string;
  description: string | null;
  reference: string | null;
  status: JournalStatus | string;
  currency: string;
  /** Absent without `finance.reports.view`. Always the company's currency. */
  total_debit?: string;
  total_credit?: string;
  base_currency?: string | null;
  /** The total as the journal was struck, when that was another currency. */
  currency_total?: string | null;
  source_type: string | null;
  reverses_id: number | null;
  reversed_by_id: number | null;
}

export const fetchJournals = (company: number, signal?: AbortSignal) =>
  apiGet<{ journals: Journal[]; may_read_figures?: boolean; base_currency?: string | null }>('/api/finance/journals', { company }, signal);

export interface JournalLine {
  id: number;
  line_no: number;
  account_id: number;
  account_code: string | null;
  account_name: string | null;
  account_status: string | null;
  description: string | null;
  /** Absent, not zero, when figures are withheld. */
  debit?: string;
  credit?: string;
}

export interface JournalDetail {
  journal: Journal;
  lines: JournalLine[];
  base_currency?: string | null;
}

export const fetchJournal = (company: number, id: number, signal?: AbortSignal) => apiGet<JournalDetail>(`/api/finance/journals/${id}`, { company }, signal);

/**
 * The next step from each status. Offered by status, not by permission: a
 * journal waiting for somebody else's approval is not hidden from its author,
 * and the refusal ("somebody other than the person who wrote it has to
 * approve it") is the explanation.
 */
export const NEXT: Partial<Record<string, { label: string; path: 'submit' | 'approve' | 'post'; done: string }>> = {
  draft: { label: 'Submit for approval', path: 'submit', done: 'Sent for approval.' },
  pending: { label: 'Approve', path: 'approve', done: 'Approved.' },
  approved: { label: 'Post to the ledger', path: 'post', done: 'Posted — it is in the books.' },
};

export const advanceJournal = (company: number, id: number, path: 'submit' | 'approve' | 'post') => apiPost<{ message?: string }>(`/api/finance/journals/${id}/${path}`, { company_id: company });

/**
 * A reversal can succeed and still have something to say — the contra is in
 * the books but the original could not be marked as reversed by it — so the
 * server answers `problems` with a success too.
 */
export const reverseJournal = (company: number, id: number, reason: string, date?: string) =>
  apiPost<{ journal_no?: string; problems?: string[] }>(`/api/finance/journals/${id}/reverse`, { company_id: company, reason, ...(date ? { entry_date: date } : {}) });

export interface DraftLine {
  key: string;
  account_id: string;
  description: string;
  debit: string;
  credit: string;
}

/**
 * What the server would refuse in a draft, said while it is typed. The same
 * rules, and not the authority: the server checks all of them again, and the
 * ones this cannot know (is the period open, is the account in a reconciled
 * range).
 */
export function draftProblems(lines: DraftLine[]): { problems: string[]; dr: number; cr: number; bad: boolean } {
  let dr = 0;
  let cr = 0;
  let bad = false;
  for (const l of lines) {
    const d = cents(l.debit);
    const c = cents(l.credit);
    if (d === null || c === null) {
      bad = true;
      continue;
    }
    dr += d;
    cr += c;
  }
  const out: string[] = [];
  const real = lines.filter((l) => l.account_id !== '' || l.debit.trim() !== '' || l.credit.trim() !== '');
  if (real.length < 2) out.push('A journal needs at least two lines — one line cannot balance.');
  if (bad) out.push('An amount is not a number. Use digits and at most two decimal places.');
  real.forEach((l, i) => {
    const n = i + 1;
    const d = cents(l.debit) ?? 0;
    const c = cents(l.credit) ?? 0;
    if (l.account_id === '') out.push(`Line ${n}: no account chosen.`);
    if (d > 0 && c > 0) out.push(`Line ${n}: a line is either a debit or a credit, not both.`);
    if (d === 0 && c === 0) out.push(`Line ${n}: has no amount.`);
  });
  if (!bad && dr !== cr) out.push(`Debits and credits must be equal — out by ${fromCents(Math.abs(dr - cr))}.`);
  if (!bad && dr === 0) out.push('A journal for nothing has no effect.');
  return { problems: out, dr, cr, bad };
}

export const createJournal = (
  company: number,
  j: { entry_date: string; description: string; reference: string; lines: DraftLine[] },
) =>
  apiPost<{ id?: number }>('/api/finance/journals', {
    company_id: company,
    entry_date: j.entry_date,
    description: j.description,
    reference: j.reference,
    lines: j.lines
      .filter((l) => l.account_id !== '')
      .map((l) => ({
        account_id: Number(l.account_id),
        description: l.description || null,
        debit: cents(l.debit) === null ? '0' : l.debit.trim().replace(/,/g, '') || '0',
        credit: cents(l.credit) === null ? '0' : l.credit.trim().replace(/,/g, '') || '0',
      })),
  });

// ── periods ──────────────────────────────────────────────────────────────

export interface FiscalYear {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string;
  status: string;
}

export interface Period {
  id: number;
  fiscal_year_id: number;
  name: string;
  starts_on: string;
  ends_on: string;
  status: 'open' | 'locked' | 'closed' | string;
  note: string | null;
}

export const fetchPeriods = (company: number, signal?: AbortSignal) => apiGet<{ years: FiscalYear[]; periods: Period[] }>('/api/finance/periods', { company }, signal);

export const addYear = (company: number) => apiPost<{ message?: string }>('/api/finance/years', { company_id: company });

export const setPeriodStatus = (company: number, id: number, status: 'open' | 'locked', reason = '') =>
  apiPost<{ message?: string }>(`/api/finance/periods/${id}/status`, { company_id: company, status, reason });
