import { ApiError, apiGet, apiPost, request } from '../../core/api';
import { cents, fromCents } from '../finance/api';
import { canAct, K, money, type Org } from './api';
import { words } from './parts';

/**
 * Money going out, in one company: corporate cards and their statements,
 * payment runs and the bank file, the accounting export, and petty cash.
 *
 * NOTHING HERE MOVES MONEY. A card line is something the bank already did; a
 * run is a list and a record that somebody paid it elsewhere; a batch is
 * lines for another system to post; a fund is a tin of cash counted by hand.
 * The server says so in its sentences, and the screens show them unchanged.
 *
 * ONE COMPANY. Every call names it — `org` on the query string, which is where
 * the server's area filter reads it too, so an id-addressed act (paying run
 * 12) is checked in the company the run belongs to rather than the person's
 * default. The web's petty-cash screen sent no company at all and so always
 * worked in the default one; this sends it.
 *
 * EVERY COLUMN MAY BE A STRING. MySQL hands counts and flags back as "0" and
 * "1", and `"0"` is truthy. Rows are converted once, here, into the shapes the
 * screens read — never tested raw.
 *
 * MONEY STAYS A STRING. Shown through `money()`; summed, where a screen must
 * (the claims picked for a run, a count against the book), in integer cents.
 */

// ── conversion ───────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

/** An id or a count: a whole number, 0 for anything that is not one. */
export const int = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** A flag as MySQL sends it: 1, "1", true. "0" is false. */
export const flag = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';

/** Text, or null for nothing. */
export const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** A DECIMAL string, untouched, or null where there is no figure. */
export const amount = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** A DECIMAL string as signed cents; null when it is not a number with at most two decimals. */
export function signedCents(v: string | number | null | undefined): number | null {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const neg = s.startsWith('-');
  const c = cents(neg ? s.slice(1) : s.replace(/^\+/, ''));
  return c === null ? null : neg ? -c : c;
}

/** The sum of DECIMAL strings in cents, or null when one of them is not a figure. */
export function sumCents(values: Array<string | null | undefined>): number | null {
  let t = 0;
  for (const v of values) {
    const c = signedCents(v ?? '0');
    if (c === null) return null;
    t += c;
  }
  return t;
}

/** "1 claim", "3 claims". */
export const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A file name the Transfers list and the disk will both take; `ext` is added where the name does not carry one. */
export const fileName = (base: string | null | undefined, ext?: string) => `${(base || 'download').replace(/[\\/:*?"<>|]/g, '-').slice(0, 200)}${ext ? `.${ext}` : ''}`;

/** "bank_transfer" → "Bank transfer". */
export const methodLabel = (m: string | null | undefined) => words(m);

/** The first of the month a date falls in: "2026-09-28" → "2026-09-01". */
export const monthStart = (ymd: string) => `${ymd.slice(0, 8)}01`;

// ── who may do what here ─────────────────────────────────────────────────

const RANK: Record<string, number> = { member: 1, approver: 2, finance: 3, admin: 4 };

/**
 * Does this person hold at least `role` in the company — the server's own
 * question (`OrgContext::canAct`), asked from what the switcher already knows,
 * so a button the server would refuse is not offered. Acting with no role is
 * the super-admin grant, which the server honours at every rank. The server
 * asks again and its refusal is the answer.
 */
export function atLeast(org: Org | null | undefined, role: 'member' | 'approver' | 'finance' | 'admin'): boolean {
  if (!org || !canAct(org)) return false;
  if (org.role === null) return true;
  return (RANK[org.role] ?? 0) >= (RANK[role] ?? 99);
}

/**
 * The server's own sentence when a read was refused on purpose — not a member,
 * not the role, several companies selected — which is a statement about the
 * company to show as said. Null for a failed request, which is not.
 */
export function refusedSentence(e: unknown): string | null {
  return e instanceof ApiError && [403, 404, 409, 422].includes(e.status) && e.message ? e.message : null;
}

// ── keys ─────────────────────────────────────────────────────────────────

export const MK = {
  cards: (org: number) => [...K.one(org), 'cards'] as const,
  txns: (org: number, f: TxnFilter) => [...K.one(org), 'cards', 'txns', f] as const,
  suggest: (org: number, txn: number) => [...K.one(org), 'cards', 'suggest', txn] as const,
  payable: (org: number) => [...K.one(org), 'payable'] as const,
  runs: (org: number) => [...K.one(org), 'runs'] as const,
  methods: (org: number) => [...K.one(org), 'payment-methods'] as const,
  postings: (org: number) => [...K.one(org), 'postings'] as const,
  posting: (org: number, id: number) => [...K.one(org), 'postings', id] as const,
  funds: (org: number) => [...K.one(org), 'petty'] as const,
  fund: (org: number, id: number) => [...K.one(org), 'petty', id] as const,
};

/** A write, with the server's own sentence about what it did (several answer with no data but that). */
async function write<T = unknown>(method: 'POST' | 'PUT' | 'DELETE', path: string, org: number, body?: unknown): Promise<{ data: T; message: string | null }> {
  const r = await request<T>(method, path, { query: { org }, body });
  return { data: r.data, message: r.message ?? null };
}

/** A receipt goes up first, on its own; its id is part of the write it proves. The server's limit, said before the upload. */
export async function uploadReceipt(org: number, file: File): Promise<number> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Receipt exceeds the 10 MB limit');
  const fd = new FormData();
  fd.append('file', file);
  const r = await apiPost<{ id?: unknown }>('/api/expense/receipts', fd, { org });
  const id = int(r?.id);
  if (!id) throw new Error('The receipt did not upload.');
  return id;
}

// ── corporate cards ──────────────────────────────────────────────────────

export const BRANDS = ['visa', 'mastercard', 'amex', 'fuel', 'virtual', 'other'] as const;
export const CARD_STATES = ['active', 'blocked', 'closed'] as const;
const BRAND_WORD: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', fuel: 'Fuel', virtual: 'Virtual', other: 'Other' };
export const brandLabel = (b: string | null | undefined) => (b ? (BRAND_WORD[b] ?? words(b)) : '');

export interface Card {
  id: number;
  label: string;
  brand: string;
  last4: string | null;
  status: string;
  holder: string | null;
  currency: string;
  transactions: number;
  unmatched: number;
  unmatched_value: string;
  /**
   * The stored columns a save writes whether or not it was sent (`Cards::save`
   * nulls what is missing), carried so an edit to the label does not also
   * unassign the card and forget its limit.
   */
  keep: { holder_user_id: number | null; currency: string | null; credit_limit: string | null; statement_day: number | null; expires_on: string | null };
}

export function toCard(r: Raw): Card {
  return {
    id: int(r.id),
    label: String(r.label ?? ''),
    brand: String(r.brand ?? 'other'),
    last4: text(r.last4),
    status: String(r.status ?? 'active'),
    holder: text(r.holder),
    currency: String(r.currency ?? ''),
    transactions: int(r.transactions),
    unmatched: int(r.unmatched),
    unmatched_value: amount(r.unmatched_value) ?? '0.00',
    keep: {
      holder_user_id: int(r.holder_user_id) || null,
      currency: text(r.currency),
      credit_limit: amount(r.credit_limit),
      statement_day: int(r.statement_day) || null,
      expires_on: text(r.expires_on),
    },
  };
}

/** "Travel Visa ···· 4242". */
export const cardName = (label: string | null | undefined, last4: string | null | undefined) => `${label ?? ''}${last4 ? ` ···· ${last4}` : ''}`;

export interface CardsPayload {
  items: Card[];
  currency: string;
  note: string | null;
}

export const fetchCards = (org: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[]; currency?: string; note?: string }>('/api/expense/cards', { org }, signal).then((r): CardsPayload => ({ items: (r.items ?? []).map(toCard), currency: r.currency ?? '', note: r.note ?? null }));

export interface CardDraft {
  label: string;
  brand: string;
  last4: string;
  status: string;
}

/** Add or edit a card. An edit sends back what is stored beside what changed; see `Card.keep`. */
export function saveCard(org: number, draft: CardDraft, card: Card | null) {
  const body = { ...(card ? card.keep : {}), label: draft.label.trim(), brand: draft.brand, last4: draft.last4.trim(), status: draft.status };
  return card ? write<{ message?: string }>('PUT', `/api/expense/cards/${card.id}`, org, body) : write<{ message?: string }>('POST', '/api/expense/cards', org, body);
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  rejected: number;
  matched: number;
  problems: string[];
  message: string;
}

const toImport = (r: Raw | null): ImportResult => ({
  imported: int(r?.imported),
  duplicates: int(r?.duplicates),
  rejected: int(r?.rejected),
  matched: int(r?.matched),
  problems: Array.isArray(r?.problems) ? (r!.problems as unknown[]).map(String) : [],
  message: String(r?.message ?? ''),
});

/** A statement: the bank's CSV file, or its contents pasted. The server's 8 MB limit, said before the upload. */
export async function importStatement(org: number, card: number, from: File | string): Promise<ImportResult> {
  const path = `/api/expense/cards/${card}/import`;
  if (typeof from === 'string') return toImport(await apiPost<Raw>(path, { csv: from, filename: 'pasted.csv' }, { org }));
  if (from.size > 8 * 1024 * 1024) throw new Error('That file is larger than 8 MB. A card statement should be well under it — check it is a CSV and not a PDF.');
  const fd = new FormData();
  fd.append('file', from);
  return toImport(await apiPost<Raw>(path, fd, { org }));
}

export type TxnStatus = 'unmatched' | 'matched' | 'ignored';

export interface CardTxn {
  id: number;
  txn_date: string;
  merchant: string;
  reference: string | null;
  amount: string;
  currency: string;
  status: string;
  claim_id: number | null;
  claim_no: string | null;
  /** 'auto' when the import's rule linked it: exact amount, within three days, one candidate. */
  match_kind: string | null;
  card: string | null;
  last4: string | null;
  /** Why a line was set aside, where somebody said. */
  note: string | null;
}

export function toTxn(r: Raw): CardTxn {
  return {
    id: int(r.id),
    txn_date: String(r.txn_date ?? ''),
    merchant: String(r.merchant ?? ''),
    reference: text(r.reference),
    amount: amount(r.amount) ?? '0.00',
    currency: String(r.currency ?? ''),
    status: String(r.status ?? 'unmatched'),
    claim_id: int(r.claim_id) || null,
    claim_no: text(r.claim_no),
    match_kind: text(r.match_kind),
    card: text(r.card),
    last4: text(r.last4),
    note: text(r.description),
  };
}

/** A refund is a negative line on a card statement (the import turns the bank's sign round). */
export const isRefund = (t: Pick<CardTxn, 'amount'>) => (signedCents(t.amount) ?? 0) < 0;

export const TXN_WORD: Record<string, string> = { unmatched: 'Unmatched', matched: 'Matched', ignored: 'Set aside' };
export const TXN_TONE: Record<string, 'amber' | 'green' | 'grey'> = { unmatched: 'amber', matched: 'green', ignored: 'grey' };

export interface TxnFilter {
  status: '' | TxnStatus;
  card: string;
  q: string;
  sort: 'date' | 'amount' | 'merchant' | 'status';
  dir: 'asc' | 'desc';
}

export const TXN_SORTS: Array<[TxnFilter['sort'], string]> = [
  ['date', 'Date'],
  ['amount', 'Amount'],
  ['merchant', 'Merchant'],
  ['status', 'Status'],
];

export const TXN_PER_PAGE = 50;

export interface TxnPage {
  items: CardTxn[];
  total: number;
  summary: { total: number; unmatched: number; unmatched_value: string };
  currency: string;
}

/**
 * A page of statement lines. The list pages; the summary does not — it counts
 * the whole company, which is what "12 unmatched" has to mean.
 */
export const fetchTxns = (org: number, f: TxnFilter, page: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[]; total?: unknown; summary?: Raw; currency?: string }>(
    '/api/expense/card-transactions',
    { org, status: f.status, card_id: f.card, q: f.q.trim(), sort: f.sort, dir: f.dir, page, per_page: TXN_PER_PAGE },
    signal,
  ).then(
    (r): TxnPage => ({
      items: (r.items ?? []).map(toTxn),
      total: int(r.total),
      summary: { total: int(r.summary?.total), unmatched: int(r.summary?.unmatched), unmatched_value: amount(r.summary?.unmatched_value) ?? '0.00' },
      currency: r.currency ?? '',
    }),
  );

export interface Suggestion {
  id: number;
  claim_no: string;
  claimant: string | null;
  spent_on: string;
  amount: string;
  currency: string;
  description: string;
  /** The reason in words: "the amount is exactly the same, the same day". */
  why: string;
  score: number;
}

export const fetchSuggestions = (org: number, txn: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[] }>(`/api/expense/card-transactions/${txn}/suggest`, { org }, signal).then((r) =>
    (r.items ?? []).map(
      (c): Suggestion => ({
        id: int(c.id),
        claim_no: String(c.claim_no ?? ''),
        claimant: text(c.claimant),
        spent_on: String(c.spent_on ?? ''),
        amount: amount(c.amount) ?? '0.00',
        currency: String(c.currency ?? ''),
        description: String(c.description ?? ''),
        why: String(c.why ?? ''),
        score: int(c.score),
      }),
    ),
  );

/** One act, three meanings: link to a claim, set aside as needing none, or undo either. */
export type MatchAct = { claim_id: number } | { ignore: true; why: string } | { unlink: true };

export const matchTxn = (org: number, txn: number, act: MatchAct) => write('POST', `/api/expense/card-transactions/${txn}/match`, org, act);

// ── reimbursement runs ───────────────────────────────────────────────────

export interface PayableClaim {
  id: number;
  claim_no: string;
  description: string;
  spent_on: string;
  /** In the company's currency: what the run pays. */
  base_amount: string;
  category: string | null;
}

export interface PayablePerson {
  user_id: number;
  name: string;
  claims: PayableClaim[];
  count: number;
  total: string;
  /** Company money this person already holds in unsettled advances — a fact to see before paying, not a refusal. */
  advance_outstanding: string | null;
}

export interface Payable {
  people: PayablePerson[];
  total: string;
  currency: string;
}

export const fetchPayable = (org: number, signal?: AbortSignal) =>
  apiGet<{ people?: Raw[]; total?: unknown; currency?: string }>('/api/expense/payable', { org }, signal).then(
    (r): Payable => ({
      people: (r.people ?? []).map((p) => {
        const claims = (Array.isArray(p.claims) ? (p.claims as Raw[]) : []).map(
          (c): PayableClaim => ({
            id: int(c.id),
            claim_no: String(c.claim_no ?? ''),
            description: String(c.description ?? ''),
            spent_on: String(c.spent_on ?? ''),
            base_amount: amount(c.base_amount) ?? '0.00',
            category: text(c.category),
          }),
        );
        return { user_id: int(p.user_id), name: String(p.name ?? 'Somebody'), claims, count: int(p.count) || claims.length, total: amount(p.total) ?? '0.00', advance_outstanding: amount(p.advance_outstanding) };
      }),
      total: amount(r.total) ?? '0.00',
      currency: r.currency ?? '',
    }),
  );

export const payableIds = (people: PayablePerson[]) => people.flatMap((p) => p.claims.map((c) => c.id));

/** What the claims picked for a run add up to, in cents — the total the run will be built with. */
export function pickedCents(people: PayablePerson[], picked: ReadonlySet<number>): number | null {
  return sumCents(people.flatMap((p) => p.claims.filter((c) => picked.has(c.id)).map((c) => c.base_amount)));
}

/** A sum in cents as the screens show money. */
export const centsMoney = (c: number | null, currency: string) => (c === null ? '—' : money(fromCents(c), currency));

export interface Run {
  id: number;
  reference: string;
  method: string;
  currency: string;
  total: string;
  claim_count: number;
  status: string;
  /** The bank's reference for the transfer: the only thing tying this row to it. */
  txn_reference: string | null;
  receipt_token: string | null;
  receipt_name: string | null;
  paid_at: string | null;
  paid_name: string | null;
  created_name: string | null;
  created_at: string | null;
}

export const toRun = (r: Raw): Run => ({
  id: int(r.id),
  reference: String(r.reference ?? ''),
  method: String(r.method ?? ''),
  currency: String(r.currency ?? ''),
  total: amount(r.total) ?? '0.00',
  claim_count: int(r.claim_count),
  status: String(r.status ?? 'draft'),
  txn_reference: text(r.txn_reference),
  receipt_token: text(r.receipt_token),
  receipt_name: text(r.receipt_name),
  paid_at: text(r.paid_at),
  paid_name: text(r.paid_name),
  created_name: text(r.created_name),
  created_at: text(r.created_at),
});

/** Built and not yet paid: it may be paid, or cancelled. A paid run is the record that money left and stays. */
export const runOpen = (r: Pick<Run, 'status'>) => r.status !== 'paid' && r.status !== 'cancelled';

/** The server lists the newest hundred and says nothing of the rest. */
export const LIST_CAP = 100;

export const fetchRuns = (org: number, signal?: AbortSignal) => apiGet<{ items?: Raw[] }>('/api/expense/runs', { org }, signal).then((r) => (r.items ?? []).map(toRun));

/** The methods the server accepts (`ExpenseEngine::PAYMENT_METHODS`), never a typed list that drifts from it. */
export const fetchMethods = (signal?: AbortSignal) => apiGet<{ items?: string[] }>('/api/expense/payment-methods', undefined, signal).then((r) => (r.items ?? []).map(String));

export interface PaymentDetails {
  reference: string;
  receipt: File | null;
}

/**
 * Build a run. The receipt goes up first; if it does not, nothing is built —
 * a run that says it has proof and has none is worse than one without.
 */
export async function buildRun(org: number, claimIds: number[], method: string, d: PaymentDetails) {
  const receipt = d.receipt ? await uploadReceipt(org, d.receipt) : null;
  return apiPost<{ message?: string; skipped?: string[] }>('/api/expense/runs', { claim_ids: claimIds, method, txn_reference: d.reference.trim() || null, receipt_file_id: receipt }, { org });
}

/** Record that the transfer happened elsewhere. Nothing is sent where nothing was given: an omitted reference keeps the one recorded at build. */
export async function payRun(org: number, run: number, d: PaymentDetails) {
  const receipt = d.receipt ? await uploadReceipt(org, d.receipt) : null;
  return write('POST', `/api/expense/runs/${run}/pay`, org, { txn_reference: d.reference.trim() || null, receipt_file_id: receipt });
}

export const cancelRun = (org: number, run: number) => write('DELETE', `/api/expense/runs/${run}`, org);

// ── the accounting export ────────────────────────────────────────────────

export interface Posting {
  id: number;
  reference: string;
  period_start: string;
  period_end: string;
  currency: string;
  total_debit: string;
  total_credit: string;
  line_count: number;
  claim_count: number;
  /** Debits and credits computed apart and compared. A batch that does not balance will not export. */
  balanced: boolean;
  status: string;
  created_name: string | null;
}

export const toPosting = (r: Raw): Posting => ({
  id: int(r.id),
  reference: String(r.reference ?? ''),
  period_start: String(r.period_start ?? ''),
  period_end: String(r.period_end ?? ''),
  currency: String(r.currency ?? ''),
  total_debit: amount(r.total_debit) ?? '0.00',
  total_credit: amount(r.total_credit) ?? '0.00',
  line_count: int(r.line_count),
  claim_count: int(r.claim_count),
  balanced: flag(r.balanced),
  status: String(r.status ?? 'draft'),
  created_name: text(r.created_name),
});

/** Only a batch nobody has exported can be voided: an exported one may already be in the books. */
export const voidable = (p: Pick<Posting, 'status'>) => p.status === 'draft';

export interface PostingLine {
  id: number;
  line_no: number;
  entry_date: string;
  account_code: string;
  account_name: string | null;
  cost_centre: string | null;
  debit: string;
  credit: string;
  memo: string | null;
}

export interface PostingDetail extends Posting {
  lines: PostingLine[];
}

export const fetchPostings = (org: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[]; note?: string; currency?: string }>('/api/expense/postings', { org }, signal).then((r) => ({ items: (r.items ?? []).map(toPosting), note: r.note ?? null, currency: r.currency ?? '' }));

export const fetchPosting = (org: number, id: number, signal?: AbortSignal) =>
  apiGet<Raw>(`/api/expense/postings/${id}`, { org }, signal).then(
    (r): PostingDetail => ({
      ...toPosting(r),
      lines: (Array.isArray(r.lines) ? (r.lines as Raw[]) : []).map((l) => ({
        id: int(l.id),
        line_no: int(l.line_no),
        entry_date: String(l.entry_date ?? ''),
        account_code: String(l.account_code ?? ''),
        account_name: text(l.account_name),
        cost_centre: text(l.cost_centre),
        debit: amount(l.debit) ?? '0.00',
        credit: amount(l.credit) ?? '0.00',
        memo: text(l.memo),
      })),
    }),
  );

export const prepareBatch = (org: number, from: string, to: string) => apiPost<{ message?: string; reference?: string; unmapped?: string[] }>('/api/expense/postings', { from, to }, { org });

export const voidBatch = (org: number, id: number) => write('DELETE', `/api/expense/postings/${id}`, org);

// ── petty cash ───────────────────────────────────────────────────────────

export interface Float {
  max: string;
  min: string;
  /** At or below the minimum, where a minimum is set. */
  low: boolean;
  /** What would bring it back to the maximum; 0 when there is no ceiling or it is already there. */
  suggested: string;
}

export interface Fund {
  id: number;
  name: string;
  custodian: string | null;
  currency: string;
  status: string;
  /** Computed from the transactions every time — never stored, so it cannot drift from the tin. */
  balance: string;
  float: Float;
}

export interface FundTxn {
  id: number;
  txn_type: string;
  amount: string;
  category: string | null;
  description: string;
  txn_date: string;
}

export interface Recon {
  id: number;
  counted: string;
  computed: string;
  /** Counted minus the book: above zero is more cash than expected, below is a shortfall. */
  variance: string;
  note: string | null;
  at: string | null;
}

export interface FundDetail extends Fund {
  has_opening: boolean;
  transactions: FundTxn[];
  reconciliations: Recon[];
}

const toFloat = (f: Raw | null | undefined): Float => ({ max: amount(f?.max) ?? '0.00', min: amount(f?.min) ?? '0.00', low: flag(f?.low), suggested: amount(f?.suggested) ?? '0.00' });

export const toFund = (r: Raw): Fund => ({
  id: int(r.id),
  name: String(r.name ?? ''),
  custodian: text(r.custodian),
  currency: String(r.currency ?? ''),
  status: String(r.status ?? 'open'),
  balance: amount(r.balance) ?? '0.00',
  float: toFloat(r.float as Raw | undefined),
});

export const fetchFunds = (org: number, signal?: AbortSignal) => apiGet<Raw[]>('/api/expense/petty-cash', { org }, signal).then((r) => (Array.isArray(r) ? r : []).map(toFund));

export const fetchFund = (org: number, id: number, signal?: AbortSignal) =>
  apiGet<Raw>(`/api/expense/petty-cash/${id}`, { org }, signal).then(
    (r): FundDetail => ({
      ...toFund(r),
      has_opening: flag(r.has_opening),
      transactions: (Array.isArray(r.transactions) ? (r.transactions as Raw[]) : []).map((t) => ({
        id: int(t.id),
        txn_type: String(t.txn_type ?? ''),
        amount: amount(t.amount) ?? '0.00',
        category: text(t.category),
        description: String(t.description ?? ''),
        txn_date: String(t.txn_date ?? ''),
      })),
      reconciliations: (Array.isArray(r.reconciliations) ? (r.reconciliations as Raw[]) : []).map((x) => ({
        id: int(x.id),
        counted: amount(x.counted) ?? '0.00',
        computed: amount(x.computed) ?? '0.00',
        variance: amount(x.variance) ?? '0.00',
        note: text(x.note),
        at: text(x.at),
      })),
    }),
  );

/** A ceiling, where one is set. */
export const hasCeiling = (f: Pick<Fund, 'float'>) => (signedCents(f.float.max) ?? 0) > 0;

/** The refill that brings the fund back to its ceiling, or '' where there is none to suggest. */
export const suggestedRefill = (f: Pick<Fund, 'float'>) => ((signedCents(f.float.suggested) ?? 0) > 0 ? f.float.suggested : '');

/**
 * The fund's own rules, said while the amount is typed: an amount at all, no
 * spending cash the tin does not hold, no refill past the ceiling. The same
 * sentences the server refuses with; the server checks all of them again.
 */
export function spendProblem(type: 'opening' | 'in' | 'out', typed: string, balance: string): string | null {
  const a = cents(typed);
  if (typed.trim() === '') return null;
  if (a === null || a <= 0) return 'Enter a valid amount greater than zero';
  const b = signedCents(balance) ?? 0;
  if (type === 'out' && a > b) return 'That is more than the fund holds — you cannot spend cash the tin does not have';
  return null;
}

export function refillProblem(typed: string, f: Pick<Fund, 'balance' | 'float'>): string | null {
  if (typed.trim() === '') return null;
  const a = cents(typed);
  if (a === null || a <= 0) return 'Enter a valid refill amount greater than zero';
  const max = signedCents(f.float.max) ?? 0;
  if (max > 0 && (signedCents(f.balance) ?? 0) + a > max) return `That would put the fund above its maximum float of ${f.float.max}`;
  return null;
}

/** A physical count against the book, in cents: counted minus the balance. Null until the count is a figure. */
export function countDifference(counted: string, balance: string): number | null {
  if (counted.trim() === '') return null;
  const c = cents(counted);
  const b = signedCents(balance);
  return c === null || b === null ? null : c - b;
}

/** A variance in words: which way the tin is out, and by how much. */
export function varianceWords(c: number, currency: string): string {
  if (c === 0) return 'No difference — the tin agrees with the book';
  return c > 0 ? `${money(fromCents(c), currency)} more than the book` : `${money(fromCents(-c), currency)} short`;
}

export const createFund = (org: number, f: { name: string; max_float: string; min_float: string; currency: string }) =>
  write<{ id?: number }>('POST', '/api/expense/petty-cash', org, { name: f.name.trim(), max_float: f.max_float.trim() || '0', min_float: f.min_float.trim() || '0', currency: f.currency });

export const postFundTxn = (org: number, fund: number, t: { txn_type: 'opening' | 'in' | 'out'; amount: string; description: string; txn_date: string }) =>
  write<{ balance?: string }>('POST', `/api/expense/petty-cash/${fund}/txn`, org, { ...t, amount: t.amount.trim(), description: t.description.trim() });

export const reconcileFund = (org: number, fund: number, counted: string, note: string) =>
  write<{ variance?: string }>('POST', `/api/expense/petty-cash/${fund}/reconcile`, org, { counted: counted.trim(), note: note.trim() || null });

export const refillFund = (org: number, fund: number, amt: string, note: string) => write('POST', `/api/expense/petty-cash/${fund}/refill`, org, { amount: amt.trim(), note: note.trim() || null });

export const closeFund = (org: number, fund: number) => write('POST', `/api/expense/petty-cash/${fund}/close`, org, {});
