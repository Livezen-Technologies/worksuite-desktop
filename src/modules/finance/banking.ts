import { ApiError, apiDelete, apiGet, apiPost } from '../../core/api';
import { addDays } from '../../core/time';
import { fromCents, money, shortDate } from './api';

/**
 * Banking (the server's bank-account, statement and reconciliation routes):
 * which chart accounts are bank accounts, what the bank says happened on
 * them, and the work of agreeing that with the ledger.
 *
 * NOTHING HERE POSTS. A statement line is the bank's evidence, not an entry;
 * matching one to a ledger line writes no journal — the journal already
 * exists, which is the whole point of the comparison. The only act with
 * consequences outside Finance is the lock, which freezes the account through
 * its closing date in every module.
 *
 * IDS ARRIVE AS STRINGS. These rows come straight from the database, and the
 * server's driver does not make integers native: an id is "41", a count of
 * rows imported is "3". They are compared and counted through `Number()`;
 * money stays the string it came as.
 *
 * Every key sits under `['finance', 'c', company]`, so one invalidation of the
 * company refreshes the statement, the reconciliation and the Overview's bank
 * panel together.
 */

type Id = number | string;

// ── shapes ───────────────────────────────────────────────────────────────

export interface BankAccount {
  id: Id;
  code: string;
  name: string;
  /** Null means the company's base currency. */
  currency: string | null;
  line_count: number;
  /** The account a payment that names none resolves to. */
  is_default: boolean;
}

export interface Candidate {
  id: Id;
  code: string;
  name: string;
  currency: string | null;
}

export interface BankAccounts {
  accounts: BankAccount[];
  candidates: Candidate[];
  base_currency: string | null;
  default_id: number | null;
  can?: { view?: boolean; edit?: boolean; manage?: boolean };
}

export type TxnStatus = 'unmatched' | 'matched' | 'ignored' | 'explained';

export interface Txn {
  id: Id;
  txn_date: string;
  value_date: string | null;
  description: string | null;
  counterparty: string | null;
  reference: string | null;
  amount: string;
  currency: string | null;
  running_balance: string | null;
  status: TxnStatus | string;
  /** Why it was parked. */
  note: string | null;
  filename: string | null;
}

export interface TxnPage {
  account: { id: Id; code: string; name: string; currency: string | null; type: string };
  transactions: Txn[];
  total: number;
}

/** One import: a file or a paste, and what became of its rows. */
export interface Batch {
  id: Id;
  filename: string;
  period_start: string | null;
  period_end: string | null;
  /** Null when the importer could not prove it from the balance column. */
  opening_balance: string | null;
  closing_balance: string | null;
  rows_seen: Id;
  rows_imported: Id;
  rows_duplicate: Id;
  rows_rejected: Id;
  notes: string | null;
  imported_by_name: string | null;
  created_at: string;
}

export interface ImportResult {
  statement_id: number | null;
  seen: number;
  imported: number;
  duplicates: number;
  rejected: number;
  problems: string[];
}

export interface Rec {
  id: Id;
  account_id: Id;
  period_start: string;
  period_end: string;
  statement_closing: string;
  /** Null on an open period until it is worked out live, and in the list. */
  ledger_balance: string | null;
  unpresented: string | null;
  /** Worked out live; a locked period does not keep it. */
  unrecorded?: string | null;
  difference: string | null;
  matched_total?: string;
  status: 'open' | 'locked' | string;
  locked_at: string | null;
  locked_by_name?: string | null;
  /** The lock's note — or, on a reopened period, why it was reopened. */
  note: string | null;
}

export interface RecList {
  reconciliations: Rec[];
  locked_through: string | null;
}

export interface RecState {
  reconciliation: Rec;
  /** False for a locked period: the figures are the snapshot, not recomputed. */
  live: boolean;
}

export type Kind = 'receivable' | 'payable' | 'other';

export interface Suggestion {
  journal_line_id: number;
  journal_id?: number;
  journal_no: string;
  entry_date: string;
  description: string | null;
  amount: string;
  score: number;
  /** The scorer's reasons, in words, joined by commas. */
  why: string;
  kind: Kind | string;
  document: string;
}

export interface Choice {
  journal_line_id: number;
  journal_id?: number;
  journal_no: string;
  entry_date: string;
  description: string | null;
  amount: string;
  exact: boolean;
  gap: string;
  kind: Kind | string;
  document: string;
}

export interface Match {
  id: Id;
  journal_no: string;
  entry_date: string;
  description: string | null;
  amount: string;
  kind: 'auto' | 'manual' | string;
  reconciliation_id: Id | null;
}

// ── keys ─────────────────────────────────────────────────────────────────

export const BK = {
  accounts: (c: number) => ['finance', 'c', c, 'bank-accounts'] as const,
  head: (c: number, a: Id) => ['finance', 'c', c, 'bank', String(a), 'head'] as const,
  txns: (c: number, a: Id, f: { status?: string; from?: string; to?: string }) => ['finance', 'c', c, 'bank', String(a), 'txns', f] as const,
  unmatched: (c: number, a: Id, to: string) => ['finance', 'c', c, 'bank', String(a), 'unmatched', to] as const,
  statements: (c: number, a: Id) => ['finance', 'c', c, 'bank', String(a), 'statements'] as const,
  recs: (c: number, a: Id) => ['finance', 'c', c, 'bank', String(a), 'recs'] as const,
  rec: (c: number, id: Id) => ['finance', 'c', c, 'rec', String(id)] as const,
  suggestions: (c: number, t: Id) => ['finance', 'c', c, 'bank-txn', String(t), 'suggestions'] as const,
  choices: (c: number, t: Id, kind: string, q: string) => ['finance', 'c', c, 'bank-txn', String(t), 'choices', kind, q] as const,
};

/** A page of statement lines. The server allows up to 500; 50 keeps a screen quick. */
export const PER_PAGE = 50;

/** The server's ceiling on an upload, checked before sending as well. */
export const MAX_BYTES = 8 * 1024 * 1024;

// ── reads ────────────────────────────────────────────────────────────────

export const fetchBankAccounts = (company: number, signal?: AbortSignal) => apiGet<BankAccounts>('/api/finance/bank-accounts', { company }, signal);

export const fetchTxns = (company: number, account: Id, f: { status?: string; from?: string; to?: string; page?: number; per_page?: number }, signal?: AbortSignal) =>
  apiGet<TxnPage>(`/api/finance/bank-accounts/${account}/transactions`, { company, status: f.status, from: f.from, to: f.to, page: f.page, per_page: f.per_page ?? PER_PAGE }, signal);

export const fetchStatements = (company: number, account: Id, signal?: AbortSignal) =>
  apiGet<{ statements: Batch[] }>(`/api/finance/bank-accounts/${account}/statements`, { company }, signal).then((r) => r.statements ?? []);

export const fetchRecs = (company: number, account: Id, signal?: AbortSignal) => apiGet<RecList>(`/api/finance/bank-accounts/${account}/reconciliations`, { company }, signal);

export const fetchRec = (company: number, id: Id, signal?: AbortSignal) => apiGet<RecState>(`/api/finance/reconciliations/${id}`, { company }, signal);

export const fetchSuggestions = (company: number, txn: Id, signal?: AbortSignal) =>
  apiGet<{ suggestions: Suggestion[]; matches: Match[] }>(`/api/finance/bank-transactions/${txn}/suggestions`, { company }, signal);

export const fetchChoices = (company: number, txn: Id, kind: string, q: string, signal?: AbortSignal) =>
  apiGet<{ choices: Choice[] }>(`/api/finance/bank-transactions/${txn}/choices`, { company, kind, q: q.trim() || undefined }, signal).then((r) => r.choices ?? []);

// ── writes ───────────────────────────────────────────────────────────────
// The company rides twice, as the web sends it (`?company=`) and in the body:
// the server reads the query first and the body after.

export const setBankAccount = (company: number, id: Id, body: { is_reconcilable: 0 | 1; currency?: string }) =>
  apiPost<unknown>(`/api/finance/accounts/${id}/bank`, { company_id: company, ...body }, { company });

/** A file goes as multipart, untouched; pasted rows go as `text`. */
export function importStatement(company: number, account: Id, what: { file: File } | { text: string }) {
  let body: FormData | Record<string, unknown>;
  if ('file' in what) {
    const f = new FormData();
    f.append('file', what.file);
    f.append('company_id', String(company));
    body = f;
  } else {
    body = { company_id: company, text: what.text };
  }
  return apiPost<ImportResult>(`/api/finance/bank-accounts/${account}/statements`, body, { company });
}

export const parkLine = (company: number, txn: Id, why: string) => apiPost<null>(`/api/finance/bank-transactions/${txn}/ignore`, { company_id: company, why }, { company });

export const openRec = (company: number, account: Id, body: { period_start: string; period_end: string; statement_closing: string }) =>
  apiPost<{ id: number; reopened?: boolean }>(`/api/finance/bank-accounts/${account}/reconciliations`, { company_id: company, ...body }, { company });

export const autoMatch = (company: number, account: Id) => apiPost<{ matched: number; considered: number }>(`/api/finance/bank-accounts/${account}/auto-match`, { company_id: company }, { company });

export const matchLine = (company: number, txn: Id, journalLineId: number) =>
  apiPost<null>(`/api/finance/bank-transactions/${txn}/match`, { company_id: company, journal_line_id: journalLineId }, { company });

export const unmatch = (company: number, match: Id) => apiDelete<null>(`/api/finance/bank-matches/${match}?company=${company}`, { company_id: company });

export const lockRec = (company: number, id: Id, note = '') => apiPost<null>(`/api/finance/reconciliations/${id}/lock`, { company_id: company, note }, { company });

export const unlockRec = (company: number, id: Id, why: string) => apiPost<null>(`/api/finance/reconciliations/${id}/unlock`, { company_id: company, why }, { company });

// ── money, in cents ──────────────────────────────────────────────────────

/**
 * A signed amount as integer cents, or null when it is not one. Unlike
 * `cents()` (which reads what somebody typed into a debit or credit box, and
 * so has no sign) this reads the server's figures, which do: an overdrawn
 * ledger, money out on a statement, a difference in either direction.
 */
export function signedCents(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/,/g, '');
  const m = /^([+-]?)(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const n = Number(m[2] || '0') * 100 + Number(((m[3] ?? '') + '00').slice(0, 2));
  return m[1] === '-' ? -n : n;
}

/**
 * The reconciliation's arithmetic, stated the way an accountant states it:
 * what the bank says it held, plus what the ledger has recorded that the bank
 * has not seen, minus what the bank has recorded that the ledger has not,
 * should equal what the ledger says. Added up here in cents only to show the
 * working; the difference itself is always the server's.
 */
export function arithmetic(r: Pick<Rec, 'statement_closing' | 'ledger_balance' | 'unpresented' | 'unrecorded' | 'difference'>): { expected: string | null; agreed: boolean } {
  const closing = signedCents(r.statement_closing);
  const ledgerOnly = signedCents(r.unpresented);
  const bankOnly = signedCents(r.unrecorded);
  const expected = closing === null || ledgerOnly === null || bankOnly === null ? null : fromCents(closing + ledgerOnly - bankOnly);
  const d = signedCents(r.difference);
  return { expected, agreed: d === 0 };
}

/**
 * Why "Agree and lock" is off, in the order somebody would fix them — the
 * same two conditions the server checks, said before the click rather than
 * after it. An empty list means the server should accept the lock.
 *
 * `unmatched` counts every unmatched line on the account up to the closing
 * date, not only those inside the period: that is what the server counts.
 */
export function lockBlockers(r: Pick<Rec, 'difference' | 'period_end'>, unmatched: number | null, currency = ''): string[] {
  const out: string[] = [];
  const d = signedCents(r.difference);
  if (d === null) out.push('The difference could not be worked out, so there is nothing to agree yet.');
  else if (d !== 0) out.push(`The difference is ${money(r.difference, currency)}. It has to be nil — match what is left, or park it with a reason.`);
  if (unmatched === null) out.push('The unmatched lines are still being counted.');
  else if (unmatched > 0) out.push(`${unmatched} statement ${unmatched === 1 ? 'line' : 'lines'} on or before ${shortDate(r.period_end)} ${unmatched === 1 ? 'is' : 'are'} still unmatched. Match or park ${unmatched === 1 ? 'it' : 'them'}, or shorten the period.`);
  return out;
}

// ── suggestions ──────────────────────────────────────────────────────────

/**
 * How strong a suggestion is, from the server's points: an exact amount is
 * 100, a close one 40; the same day adds 30, one to three days 15; the
 * statement's reference found on the entry adds 25. Anything under 30 is
 * never sent. The words are the reasons; this is only the headline.
 */
export function strength(score: number): { label: string; tone: 'green' | 'blue' | 'amber' } {
  if (score >= 125) return { label: 'Strong', tone: 'green' };
  if (score >= 100) return { label: 'Exact amount', tone: 'blue' };
  return { label: 'Close', tone: 'amber' };
}

/** The scorer's reasons as a list: "the amount is exactly right, the same day" → two. */
export function reasons(why: string | null | undefined): string[] {
  return (why ?? '')
    .split(/,\s+(?=the |a |\d)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Receivable, payable or a hand-written journal: the three sides a person thinks in. */
export const KINDS: Array<{ id: 'any' | Kind; label: string }> = [
  { id: 'any', label: 'Anything' },
  { id: 'receivable', label: 'Customer side' },
  { id: 'payable', label: 'Supplier side' },
  { id: 'other', label: 'Journals' },
];

// ── statement lines ──────────────────────────────────────────────────────

export const TXN_LABEL: Record<string, string> = { unmatched: 'Not matched', matched: 'Matched', ignored: 'Parked', explained: 'Explained' };
export const TXN_TONE: Record<string, 'amber' | 'green' | 'grey' | 'blue'> = { unmatched: 'amber', matched: 'green', ignored: 'grey', explained: 'blue' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The three counts after an import. "Already on file" is the one people need: it proves the duplicate guard worked. */
export function importSummary(r: Pick<ImportResult, 'imported' | 'duplicates' | 'rejected'>): string {
  const imported = Number(r.imported) || 0;
  const dup = Number(r.duplicates) || 0;
  const bad = Number(r.rejected) || 0;
  return `${plural(imported, 'line', 'lines')} loaded. ${dup} ${dup === 1 ? 'was' : 'were'} already on file. ${bad} could not be read.`;
}

/** A batch in the history: its dates and what became of its rows. */
export function batchLine(b: Pick<Batch, 'rows_imported' | 'rows_duplicate' | 'rows_rejected'>): string {
  const dup = Number(b.rows_duplicate) || 0;
  const bad = Number(b.rows_rejected) || 0;
  return [`${Number(b.rows_imported) || 0} loaded`, dup > 0 ? `${dup} already on file` : '', bad > 0 ? `${bad} could not be read` : ''].filter(Boolean).join(', ');
}

/** The server's own sentence after "Match what is obvious". */
export function autoMatchSummary(r: { matched: number; considered: number } | null | undefined): string {
  const m = Number(r?.matched) || 0;
  const c = Number(r?.considered) || 0;
  return m === 0 ? 'Nothing matched unambiguously. Where two ledger lines both fit, neither is chosen.' : `${m} of ${plural(c, 'line', 'lines')} matched.`;
}

/**
 * An import the server refused: its sentence AND the per-line problems. The
 * sentence ("This exact file was already loaded on 14 May…") says what to do;
 * the lines say which rows. `problemsOf` would keep only one of the two.
 */
export function importRefusal(e: unknown): { message: string; problems: string[] } {
  if (e instanceof ApiError) {
    const d = e.data as { problems?: unknown } | null;
    const problems = Array.isArray(d?.problems) ? d!.problems.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [];
    return { message: e.message, problems: problems.filter((p) => !e.message.includes(p)) };
  }
  return { message: e instanceof Error ? e.message : String(e), problems: [] };
}

/** Too big to send: the server refuses over 8 MB, so the file is not uploaded to be told so. */
export const tooBig = (f: { size: number }) => f.size > MAX_BYTES;

// ── periods ──────────────────────────────────────────────────────────────

/** Last month on the reader's calendar: the usual period to reconcile. */
export function lastMonth(today: string): { start: string; end: string } {
  const end = addDays(`${today.slice(0, 8)}01`, -1);
  return { start: `${end.slice(0, 8)}01`, end };
}

/**
 * The statement to prefill a new period from: the latest BY PERIOD (not by
 * upload order — loading March after July must not back-date the offer) among
 * those whose closing balance the importer proved. One without a proved
 * balance is one whose balance column is not trusted, and prefilling from it
 * would turn that doubt into an authoritative-looking number.
 */
export function provedStatement<T extends Pick<Batch, 'closing_balance' | 'period_end'>>(list: T[]): T | null {
  return (
    list
      .filter((s) => s.closing_balance !== null && s.closing_balance !== '' && !!s.period_end)
      .sort((a, b) => String(b.period_end).localeCompare(String(a.period_end)))[0] ?? null
  );
}

/** What the server would refuse in a new period, said while it is typed. The server checks again. */
export function periodProblems(p: { start: string; end: string; closing: string }, today: string): string[] {
  const out: string[] = [];
  if (!p.start || !p.end) out.push('Give the period as two dates.');
  else if (p.end < p.start) out.push('The period ends before it starts.');
  else if (p.end > today) out.push('A period cannot close in the future — there is no statement for it yet.');
  if (p.closing.trim() === '') out.push('Enter the closing balance from the statement.');
  else if (signedCents(p.closing) === null) out.push('The closing balance is not a number. Use digits, a minus sign if overdrawn, and at most two decimals.');
  return out;
}
