import { ApiError, apiGet, apiPost } from '../../core/api';
import { addDays } from '../../core/time';
import { can, money } from './api';

/**
 * Who owes what: the receivables and payables ageing, and the documents that
 * never reached the ledger — the reads, the retry, and the sentences both
 * screens build from them.
 *
 * Every key sits under `['finance', 'c', company]`, so anything that posts
 * (a journal, a retried document) refreshes these by invalidating the
 * company. The ageing key carries its date as well: without it, changing the
 * date would show the previous date's figures under the new heading until the
 * refetch landed, and every one of them would look plausible.
 */

export type Side = 'receivables' | 'payables';

export type BucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';

/** The server's buckets (`Ageing::BUCKETS`), in days past the due date — or the document date when there is none. */
export const BUCKETS: Array<{ key: BucketKey; label: string }> = [
  { key: 'current', label: 'Not yet due' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90plus', label: 'Over 90 days' },
];

export interface AgeingRow {
  /** Null for documents with no customer or supplier ("Unattributed"). */
  party_id: number | null;
  party_name: string;
  /** In the company's base currency. */
  buckets: Partial<Record<BucketKey, string>>;
  total: string;
  /** Days past due of the party's oldest open document. */
  oldest: number | null;
}

export interface AgeingDoc {
  id: number;
  number: string | null;
  party_id: number | null;
  party_name: string;
  doc_date: string;
  due_date: string | null;
  /** The document's own currency; `open` is in it, `open_base` in the company's. */
  currency: string | null;
  total: string;
  open: string;
  open_base: string;
  bucket: BucketKey | string;
  days: number;
  /** A credit note (receivables) or a debit note (payables): negative money. */
  is_credit: boolean;
}

export interface TieOut {
  subledger: string;
  control: string;
  difference: string;
  agrees: boolean;
  account: { id: number; code: string; name: string } | null;
  /** Set when no control account is nominated, in place of the comparison. */
  note?: string;
}

export interface Ageing {
  as_of: string;
  rows: AgeingRow[];
  documents: AgeingDoc[];
  totals: Partial<Record<BucketKey, string>>;
  total: string;
  tie_out: TieOut;
  currency: string | null;
}

export const ageingKey = (company: number, side: Side, asOf: string) => ['finance', 'c', company, 'ageing', side, asOf] as const;

export const fetchAgeing = (company: number, side: Side, asOf: string, signal?: AbortSignal) => apiGet<Ageing>(`/api/finance/${side}`, { company, as_of: asOf }, signal);

/** The words that differ between the two mirrors. */
export function sideWords(side: Side) {
  return side === 'receivables'
    ? { title: 'Receivables ageing', owed: 'owed to you', who: 'Customer', credit: 'credit note' }
    : { title: 'Payables ageing', owed: 'you owe', who: 'Supplier', credit: 'debit note' };
}

/** A party's key: its id, or 0 for the unattributed group (which the server sends as null). */
export const partyKey = (partyId: number | null) => partyId ?? 0;

/** The open documents behind one party's row. */
export function docsFor(docs: AgeingDoc[], partyId: number | null): AgeingDoc[] {
  const k = partyKey(partyId);
  return docs.filter((d) => partyKey(d.party_id) === k);
}

/** "12 days", "1 day", or "not due" for a document not yet past its due date. */
export function ageLabel(days: number): string {
  if (days <= 0) return 'not due';
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * The tie-out as two sentences: the verdict, and what it compared. A
 * disagreement says so in plain words with the difference spelled out — it is
 * the one figure on the screen that says whether the rest can be believed.
 */
export function tieSentences(tie: TieOut, currency: string): { headline: string; detail: string } {
  const headline = tie.agrees ? 'This agrees with the ledger' : `This does NOT agree with the ledger — out by ${money(tie.difference, currency)}`;
  if (tie.note) return { headline, detail: tie.note };
  const account = tie.account ? `${tie.account.code} ${tie.account.name}` : 'control';
  let detail = `The documents below come to ${money(tie.subledger, currency)}; the ${account} account stands at ${money(tie.control, currency)}.`;
  if (!tie.agrees) detail += ' A difference here means a journal went to the wrong account — every entry can balance and still be wrong.';
  return { headline, detail };
}

/** The last day of the month before `today`'s, from the digits. */
export function endOfLastMonth(today: string): string {
  return addDays(`${today.slice(0, 7)}-01`, -1);
}

// ── not in the ledger ────────────────────────────────────────────────────

export type UnpostedKind =
  | 'invoice'
  | 'credit_note'
  | 'bill'
  | 'debit_note'
  | 'payment'
  | 'vendor_payment'
  | 'expense_claim'
  | 'expense_reimbursement'
  | 'asset'
  | 'asset_disposal';

export interface UnpostedDoc {
  kind: UnpostedKind | string;
  id: number;
  number: string | null;
  /** Null for a reimbursement run with no paid date. */
  date: string | null;
  /** Null for a run or claim carrying no currency — never to be printed as "null". */
  currency: string | null;
  total: string;
  can_post: boolean;
  /** Why the ledger would refuse it now — re-derived on every read, not stored. */
  problems: string[];
}

export const KIND_LABEL: Record<UnpostedKind, string> = {
  invoice: 'Invoice',
  credit_note: 'Credit note',
  bill: 'Bill',
  debit_note: 'Debit note',
  payment: 'Receipt',
  vendor_payment: 'Vendor payment',
  expense_claim: 'Expense claim',
  expense_reimbursement: 'Reimbursement run',
  asset: 'Fixed asset',
  asset_disposal: 'Asset disposal',
};

export const kindLabel = (kind: string) => KIND_LABEL[kind as UnpostedKind] ?? kind.replace(/_/g, ' ');

/** One document's identity across kinds: ids are per table, so an invoice and a bill can share one. */
export const docKey = (d: Pick<UnpostedDoc, 'kind' | 'id'>) => `${d.kind}-${d.id}`;

export const unpostedKey = (company: number) => ['finance', 'c', company, 'unposted'] as const;

export const fetchUnposted = (company: number, signal?: AbortSignal) => apiGet<{ documents: UnpostedDoc[] }>('/api/finance/unposted', { company }, signal).then((r) => r.documents ?? []);

export interface Posted {
  ok?: boolean;
  id?: number | null;
  journal_no?: string | null;
}

/** Try the ledger again. Safe to repeat: a document cannot post twice. */
export const retryPosting = (company: number, d: Pick<UnpostedDoc, 'kind' | 'id'>) => apiPost<Posted>(`/api/finance/unposted/${d.kind}/${d.id}`, { company_id: company });

/** The server's own success sentence ("Posted as JE-000031"), rebuilt from the journal it names. */
export const postedSentence = (r: Posted | null | undefined) => (r?.journal_no ? `Posted as ${r.journal_no}` : 'Posted');

/** "3 documents not in the ledger". */
export const unpostedHeadline = (n: number) => `${n} document${n === 1 ? '' : 's'} not in the ledger`;

// ── a read that was refused ──────────────────────────────────────────────

/**
 * Why a read failed, in words: the missing grant when that is the cause (the
 * route answers "Missing permission: finance.reports.view"), the server's own
 * sentence for any other refusal ("That company is not available to you."),
 * and null for anything that is not a refusal — a failed request, which says
 * nothing about what is owed.
 */
export function refusedRead(e: unknown, perms: readonly string[] | undefined): string | null {
  if (!(e instanceof ApiError) || !e.forbidden) return null;
  if (!can(perms, 'finance.reports.view') || e.message.includes('finance.reports.view')) {
    return 'This report is figures, and figures are a separate grant: finance.reports.view, which you do not hold.';
  }
  return e.message;
}
