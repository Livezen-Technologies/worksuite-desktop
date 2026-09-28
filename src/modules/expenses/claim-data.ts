import { apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';
import { call } from '../../core/bridge';
import { cents, fromCents } from '../finance/api';
import { K, money } from './api';
import type { Hit } from './parts';

/**
 * Claims: the lists (mine, team, organization), one claim with everything
 * attached to it, and filing one.
 *
 * EVERY COLUMN MAY ARRIVE AS A STRING. The server's database driver answers
 * "12", "0" and "1" for ids, counts and flags, so each is converted once here
 * — a `"0"` read as truthy is how a claim with no receipt says "attached".
 *
 * READS SPAN THE SELECTION, WRITES HAPPEN IN ONE COMPANY. The lists and a claim
 * are keyed under the selection (`K.scope`), filing's lookups under the one
 * company (`K.one`), so the shell's invalidation reaches both.
 */

export type ClaimScope = 'mine' | 'team' | 'organization';
export type ClaimKind = 'expense' | 'mileage' | 'per_diem';

type Raw = Record<string, unknown>;

// ── conversion ───────────────────────────────────────────────────────────

/** A flag the server may send as true, 1 or "1" — and never "0" as yes. */
export const flag = (v: unknown): boolean => v === true || v === 1 || v === '1';

/** An id or a count; null for nothing, zero or not a number. */
export function idOf(v: unknown): number | null {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0 ? null : Math.trunc(n);
}

/** A text column: null when empty. */
export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim() === '' ? null : s;
}

/**
 * Whatever the payload gave us, as a list. A PHP array that picked up string
 * keys upstream arrives as an OBJECT, and then a refusal would have no
 * `.length` and the screen would show nothing — for a claim it refused.
 */
export function asList<T = unknown>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === 'object') return Object.values(x) as T[];
  return [];
}

/**
 * The cash-book import writes an idempotency key into the description's tail
 * (`… · voucher E-221 [cb:ONLINE_PAYMENTS:221]`). It belongs to the importer,
 * so it is stripped for DISPLAY only — removing it from storage would break
 * the guard that stops a second import duplicating every record.
 */
export const clean = (d: string | null | undefined): string => (d ?? '').replace(/\s*\[cb:[^\]]*\]\s*$/, '').trim();

export const KIND_WORD: Record<ClaimKind, string> = { expense: 'expense', mileage: 'mileage', per_diem: 'per diem' };

const kindOf = (v: unknown): ClaimKind => (v === 'mileage' || v === 'per_diem' ? v : 'expense');

// ── the list ─────────────────────────────────────────────────────────────

export interface ClaimRow {
  id: number;
  claim_no: string | null;
  kind: ClaimKind;
  spent_on: string;
  amount: string | null;
  currency: string;
  base_amount: string | null;
  base_currency: string;
  description: string;
  status: string;
  flagged: boolean;
  has_receipt: boolean;
  user_id: number | null;
  category: string | null;
  claimant: string | null;
  cost_centre: string | null;
  project: string | null;
  department: string | null;
}

export function toRow(r: Raw): ClaimRow {
  return {
    id: idOf(r.id) ?? 0,
    claim_no: str(r.claim_no),
    kind: kindOf(r.kind),
    spent_on: String(r.spent_on ?? ''),
    amount: str(r.amount),
    currency: String(r.currency ?? ''),
    base_amount: str(r.base_amount),
    base_currency: String(r.base_currency ?? ''),
    description: String(r.description ?? ''),
    status: String(r.status ?? ''),
    flagged: r.policy_state === 'flagged',
    has_receipt: idOf(r.receipt_file_id) !== null,
    user_id: idOf(r.user_id),
    category: str(r.category),
    claimant: str(r.claimant),
    cost_centre: str(r.cost_centre),
    project: str(r.project),
    department: str(r.department),
  };
}

export interface ClaimFilters {
  q?: string;
  status?: string;
  category_id?: string;
  from?: string;
  to?: string;
  flagged?: boolean;
}

export interface ClaimPage {
  items: ClaimRow[];
  page: number;
  /** Every claim the filter matches, not the rows loaded. */
  total: number;
  /** The whole filtered set's base amounts, added up by the server. */
  sum: string | null;
  /** The currency the sum is in; null when the companies selected keep different ones. */
  currency: string | null;
  mixed: boolean;
}

export const PER_PAGE = 50;

export const STATUSES = ['submitted', 'approved', 'processing', 'paid', 'rejected'];

export function toPage(r: Raw, page: number): ClaimPage {
  return {
    items: asList<Raw>(r.items).map(toRow),
    page: idOf(r.page) ?? page,
    total: idOf(r.total) ?? 0,
    sum: str(r.sum),
    currency: str(r.currency),
    mixed: flag(r.mixed_currency),
  };
}

export const fetchClaims = (org: string, scope: ClaimScope, f: ClaimFilters, page: number, signal?: AbortSignal) =>
  apiGet<Raw>(
    '/api/expense/claims2',
    { scope, org, page, per_page: PER_PAGE, q: f.q, status: f.status, category_id: f.category_id, from: f.from, to: f.to, flagged: f.flagged ? 1 : undefined },
    signal,
  ).then((r) => toPage(r ?? {}, page));

/** The next page to ask for, or nothing once every matching claim is loaded. */
export const nextPage = (pages: ClaimPage[]): number | undefined => {
  const last = pages[pages.length - 1];
  if (!last) return undefined;
  const loaded = pages.reduce((n, p) => n + p.items.length, 0);
  return loaded < last.total && last.items.length > 0 ? last.page + 1 : undefined;
};

export interface Category {
  id: number;
  name: string;
  active: boolean;
  /** Belongs to every company (org 0), rather than to one. */
  shared: boolean;
}

export const fetchCategories = (org: string, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[] }>('/api/expense/categories2', { org }, signal).then((r) =>
    asList<Raw>(r?.items).map((c) => ({ id: idOf(c.id) ?? 0, name: String(c.name ?? ''), active: c.status === 'active', shared: flag(c.shared) || c.org_id === 0 || c.org_id === '0' })),
  );

/**
 * What the selected claims add up to, in cents — or null when they are in
 * different currencies (a consolidated list can hold rupees and dirhams, and
 * their sum is not a figure in either).
 */
export function selectionTotal(rows: ClaimRow[]): string | null {
  if (!rows.length) return null;
  const ccy = rows[0]!.base_currency;
  let total = 0;
  for (const r of rows) {
    if (r.base_currency !== ccy || r.base_amount === null) return null;
    const c = cents(r.base_amount);
    if (c === null) return null;
    total += c;
  }
  return money(fromCents(total), ccy);
}

// ── deciding ─────────────────────────────────────────────────────────────

export interface BulkResult {
  message: string;
  done: number[];
  failed: Array<{ id: number; why: string }>;
}

/**
 * One decision over many claims. `Claims::decide()` owns every rule and the
 * server loops it, so each claim is its own unit of work: the answer lists
 * which were refused and the library's sentence for each.
 */
export async function bulkDecide(ids: number[], decision: 'approved' | 'rejected', note: string): Promise<BulkResult> {
  const r = await request<{ done?: Raw[]; failed?: Raw[] }>('POST', '/api/expense/claims2/bulk-decide', { body: { ids, decision, note } });
  const done = asList<Raw>(r.data?.done).map((d) => idOf(d.id) ?? 0);
  const failed = asList<Raw>(r.data?.failed).map((f) => ({ id: idOf(f.id) ?? 0, why: String(f.why ?? 'Refused.') }));
  const verb = decision === 'approved' ? 'approved' : 'rejected';
  const message = r.message || (failed.length ? `${done.length} ${verb}, ${failed.length} could not be.` : `${done.length} claim(s) ${verb}.`);
  return { message, done, failed };
}

/**
 * `revision` is the version the drawer is showing, so the decision can be
 * refused when the claimant edited while it was open — approving 90,000 having
 * read 12,000 is what an approval workflow exists to prevent.
 */
export const decideClaim = (id: number, approve: boolean, note: string, revision: number | null) =>
  apiPost<Raw>(`/api/expense/claims2/${id}/decide`, { decision: approve ? 'approved' : 'rejected', note, revision: revision ?? undefined }).then((r) => ({
    message: str(r?.message),
    /* Approved, but the ledger refused to post it: said, not buried in a key nobody reads. */
    unposted: asList<unknown>(r?.posting_problems).map(String),
  }));

export const reopenClaim = (id: number, reason: string) => apiPost<Raw>(`/api/expense/claims2/${id}/reopen`, { reason }).then((r) => str(r?.message));

export const editClaim = (id: number, body: { amount: string; spent_on: string; description: string; reason: string }) =>
  apiPut<Raw>(`/api/expense/claims2/${id}`, body).then((r) => str(r?.message));

// ── one claim ────────────────────────────────────────────────────────────

export interface Approval {
  id: number;
  step: number;
  label: string | null;
  approver: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  revision: number;
  /** False for a step from a round that ended when the claim was edited or reopened. */
  live: boolean;
}

export interface Version {
  id: number;
  version: number;
  event: string;
  reason: string | null;
  author: string | null;
  created_at: string | null;
}

export interface Duplicate {
  id: number;
  reason: string;
  claim_no: string | null;
  spent_on: string | null;
  amount: string | null;
  currency: string;
  other_status: string | null;
}

export interface CardTxn {
  merchant: string | null;
  txn_date: string | null;
  amount: string | null;
  currency: string;
  card: string | null;
  last4: string | null;
  auto: boolean;
}

export interface ReadField {
  value: string | null;
  confidence: string;
  why: string;
}

export interface ReceiptInfo {
  name: string;
  mime: string;
  size: number;
  previewable: boolean;
  is_image: boolean;
}

export interface ActivityRow {
  created_at: string | null;
  summary: string;
  actor: string | null;
}

export interface ClaimDetail extends ClaimRow {
  org_id: number | null;
  organization: string | null;
  exchange_rate: string | null;
  quantity: string | null;
  tax_amount: string | null;
  vendor: string | null;
  branch: string | null;
  cost_centre_code: string | null;
  subscription_id: number | null;
  /** The attached receipt's row, which also busts the image cache when it is replaced. */
  receipt_id: number | null;
  revision: number;
  receipt: ReceiptInfo | null;
  approvals: Approval[];
  versions: Version[];
  /** Why THIS reader may not edit it — decided by the method the save uses. Null means they may. */
  edit_block: string | null;
  policy: Hit[];
  duplicates: Duplicate[];
  activity: ActivityRow[];
  card_txn: CardTxn | null;
  receipt_read: Record<string, ReadField> | null;
  /** True when a read was stored at all (its fields may still be empty). */
  was_read: boolean;
}

export function toFields(v: unknown): Record<string, ReadField> | null {
  let x = v;
  if (typeof x === 'string') {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out: Record<string, ReadField> = {};
  for (const [k, f] of Object.entries(x as Record<string, Raw>)) {
    out[k] = { value: str(f?.value), confidence: String(f?.confidence ?? 'none'), why: String(f?.why ?? '') };
  }
  return out;
}

export function toDetail(r: Raw): ClaimDetail {
  const rec = r.receipt as Raw | null | undefined;
  const card = r.card_txn as Raw | null | undefined;
  const read = r.receipt_read as Raw | null | undefined;
  return {
    ...toRow(r),
    org_id: idOf(r.org_id),
    organization: str(r.organization),
    exchange_rate: str(r.exchange_rate),
    quantity: str(r.quantity),
    tax_amount: str(r.tax_amount),
    vendor: str(r.vendor),
    branch: str(r.branch),
    cost_centre_code: str(r.cost_centre_code),
    subscription_id: idOf(r.subscription_id),
    receipt_id: idOf(r.receipt_file_id),
    revision: idOf(r.revision) ?? 1,
    receipt: rec ? { name: String(rec.name ?? 'receipt'), mime: String(rec.mime ?? ''), size: Number(rec.size ?? 0) || 0, previewable: flag(rec.previewable), is_image: flag(rec.is_image) } : null,
    approvals: asList<Raw>(r.approvals).map((a) => ({
      id: idOf(a.id) ?? 0,
      step: Number(a.step ?? 0) || 0,
      label: str(a.label),
      approver: str(a.approver),
      status: String(a.status ?? 'pending'),
      decided_by: str(a.decided_by),
      decided_at: str(a.decided_at),
      note: str(a.note),
      revision: idOf(a.revision) ?? 1,
      live: a.live === undefined ? true : flag(a.live),
    })),
    versions: asList<Raw>(r.versions).map((v) => ({ id: idOf(v.id) ?? 0, version: Number(v.version ?? 0) || 0, event: String(v.event ?? ''), reason: str(v.reason), author: str(v.author), created_at: str(v.created_at) })),
    edit_block: str(r.edit_block),
    policy: asList<Raw>(r.policy).map((p) => ({ rule: String(p.rule ?? ''), policy: str(p.policy), message: String(p.message ?? ''), severity: p.severity === 'block' ? 'block' : 'warn' })),
    duplicates: asList<Raw>(r.duplicates).map((d) => ({ id: idOf(d.id) ?? 0, reason: String(d.reason ?? ''), claim_no: str(d.claim_no), spent_on: str(d.spent_on), amount: str(d.amount), currency: String(d.currency ?? ''), other_status: str(d.other_status) })),
    activity: asList<Raw>(r.activity).map((a) => ({ created_at: str(a.created_at), summary: String(a.summary ?? ''), actor: str(a.actor) })),
    card_txn: card ? { merchant: str(card.merchant), txn_date: str(card.txn_date), amount: str(card.amount), currency: String(card.currency ?? ''), card: str(card.card), last4: str(card.last4), auto: card.match_kind === 'auto' } : null,
    receipt_read: read ? toFields(read.fields) : null,
    was_read: !!read,
  };
}

export const fetchClaim = (id: number, signal?: AbortSignal) => apiGet<Raw>(`/api/expense/claims2/${id}`, undefined, signal).then((r) => toDetail(r ?? {}));

/** One step of the approval trail, in words. */
export function approvalLine(a: Pick<Approval, 'status' | 'approver' | 'decided_by'>): string {
  if (a.status === 'pending') return a.approver ? `waiting with ${a.approver}` : 'waiting, with nobody assigned';
  if (a.status === 'skipped') return 'skipped';
  return `${a.status} by ${a.decided_by ?? 'somebody'}`;
}

/** The trail grouped into rounds, oldest first — one per version that was sent for approval. */
export function rounds(list: Approval[]): Array<{ revision: number; live: boolean; steps: Approval[] }> {
  const out: Array<{ revision: number; live: boolean; steps: Approval[] }> = [];
  for (const a of list) {
    const last = out[out.length - 1];
    if (last && last.revision === a.revision) {
      last.steps.push(a);
      last.live = last.live && a.live;
    } else out.push({ revision: a.revision, live: a.live, steps: [a] });
  }
  return out;
}

/** A readable size: 2.4 MB, 380 KB. */
export function sizeWords(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ── receipts ─────────────────────────────────────────────────────────────

/** What `ReceiptController::upload` accepts — its own list, so the picker never offers what it refuses. */
export const RECEIPT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.docx,.xlsx';
export const RECEIPT_MAX = 10 * 1024 * 1024;

export interface Uploaded {
  id: number;
  token: string;
  name: string;
  is_image: boolean;
}

/**
 * The bytes go to `/receipts` first, which enforces the size ceiling, the
 * extension list and the random storage token; a claim is only ever given
 * the id or token that upload returned. Two upload paths drift until one
 * accepts what the other refuses.
 */
export async function uploadReceipt(file: File): Promise<Uploaded> {
  const form = new FormData();
  form.append('file', file);
  const r = await apiPost<Raw>('/api/expense/receipts', form);
  const id = idOf(r?.id);
  if (!id) throw new Error('The upload returned no id.');
  return { id, token: String(r.token ?? ''), name: String(r.name ?? file.name), is_image: flag(r.is_image) };
}

export const attachReceipt = (claimId: number, receiptId: number) => apiPost(`/api/expense/claims2/${claimId}/receipt`, { receipt_id: receiptId });

export const detachReceipt = (claimId: number) => apiDelete(`/api/expense/claims2/${claimId}/receipt`);

/** A claim's receipt to the downloads folder (and opened, when asked) — through Transfers, with the session's credentials. */
export const saveReceipt = (claimId: number, name: string, open = false) =>
  call('transfers:download', { expenseFile: { kind: 'claim-receipt', claim: claimId }, name: safeName(name), ...(open ? { open: true } : {}) });

export const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 200) || 'receipt';

export const readReceipt = (token: string) => apiPost<Raw>(`/api/expense/receipts/${encodeURIComponent(token)}/read`, {}).then((r) => ({ fields: toFields(r?.fields), message: str(r?.message) }));

// ── filing ───────────────────────────────────────────────────────────────

export interface ClaimSettings {
  currency: string;
  requireProject: boolean;
  requireCostCentre: boolean;
  reading: { ok: boolean; message: string | null } | null;
}

export const fetchSettings = (orgId: number, signal?: AbortSignal) =>
  apiGet<Raw>('/api/expense/settings2', { org: orgId }, signal).then((r): ClaimSettings => {
    const s = (r?.settings ?? {}) as Raw;
    const rr = r?.receipt_reading as Raw | null | undefined;
    return {
      currency: str(s.currency) ?? 'LKR',
      requireProject: flag(s.require_project),
      requireCostCentre: flag(s.require_cost_centre),
      reading: rr ? { ok: flag(rr.ok), message: str(rr.message) } : null,
    };
  });

export interface CostCentre {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

export const fetchCostCentres = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[] }>('/api/expense/cost-centres', { org: orgId }, signal).then((r) =>
    asList<Raw>(r?.items).map((c): CostCentre => ({ id: idOf(c.id) ?? 0, code: String(c.code ?? ''), name: String(c.name ?? ''), active: c.status === 'active' })),
  );

export interface RelatedType {
  key: string;
  label: string;
  /** The claim column this type writes. */
  field: string;
  /** False when the underlying table has no company column (shared across companies). */
  scoped: boolean;
  /** The type exists but has nothing in it yet. */
  empty: boolean;
  items: Array<{ id: number; label: string }>;
}

/**
 * What a claim may be related to, in one request under `expense.view` — a
 * person filing their own expense should not need `project.view` to fill in
 * the form.
 */
export const fetchRelated = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ types?: Raw[] }>('/api/expense/related', { org: orgId }, signal).then((r) =>
    asList<Raw>(r?.types).map(
      (t): RelatedType => ({
        key: String(t.key ?? ''),
        label: String(t.label ?? ''),
        field: String(t.field ?? ''),
        scoped: flag(t.scoped),
        empty: flag(t.empty),
        items: asList<Raw>(t.items).map((i) => ({ id: idOf(i.id) ?? 0, label: String(i.label ?? '') })),
      }),
    ),
  );

export interface OpenAdvance {
  id: number;
  advance_no: string;
  amount: string | null;
  currency: string;
}

export const fetchOpenAdvances = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Raw[] }>('/api/expense/advances', { org: orgId, scope: 'mine', status: 'disbursed' }, signal).then((r) =>
    asList<Raw>(r?.items).map((a): OpenAdvance => ({ id: idOf(a.id) ?? 0, advance_no: String(a.advance_no ?? ''), amount: str(a.amount), currency: String(a.currency ?? '') })),
  );

/**
 * The company's own mileage and per diem schedule. The server matches the
 * vehicle, the country and the city EXACTLY, so the form offers what the
 * schedule holds rather than a box to type a near-miss into.
 */
export interface Schedule {
  vehicles: string[];
  countries: string[];
  cities: Array<{ city: string; country: string | null }>;
}

export function toSchedule(r: Raw): Schedule {
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  const pd = asList<Raw>(r.per_diem);
  const cities = new Map<string, string | null>();
  for (const p of pd) {
    const c = str(p.city);
    if (c && !cities.has(c)) cities.set(c, str(p.country));
  }
  return {
    vehicles: uniq(asList<Raw>(r.mileage).map((m) => str(m.vehicle))),
    countries: uniq(pd.map((p) => str(p.country))),
    cities: [...cities.entries()].map(([city, country]) => ({ city, country })).sort((a, b) => a.city.localeCompare(b.city)),
  };
}

export const fetchSchedule = (orgId: number, signal?: AbortSignal) => apiGet<Raw>('/api/expense/rates', { org: orgId }, signal).then((r) => toSchedule(r ?? {}));

/** The currencies offered, with the company's own first — it may be one this list has never heard of. */
export const CURRENCIES = ['LKR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'INR', 'SGD'];

export function currencyOptions(base: string | null | undefined): Array<{ value: string; label: string }> {
  const first = (base ?? '').trim().toUpperCase();
  return [...new Set(first ? [first, ...CURRENCIES] : CURRENCIES)].map((c) => ({ value: c, label: c }));
}

/** The form, as the server reads it: every value a string, '' for not given. */
export type ClaimForm = Record<string, string>;

/**
 * What is still missing, NAMED — a grey button that will not say what it
 * wants is the worst of both. The per-kind list follows what `vet()` refuses.
 */
export function missingFor(f: ClaimForm): string[] {
  const out =
    f.kind === 'mileage'
      ? [!f.quantity && 'a distance', !f.category_id && 'a category', !f.description?.trim() && 'what it was for']
      : f.kind === 'per_diem'
        ? [!f.from_date && 'a start date', !f.to_date && 'an end date', !f.category_id && 'a category', !f.description?.trim() && 'what it was for']
        : [!f.amount && 'an amount', !f.category_id && 'a category', !f.description?.trim() && 'what it was for', !f.spent_on && 'the date'];
  return out.filter((x): x is string => !!x);
}

/** What goes to the server: empty fields left out, so an empty picker is "not given" rather than id 0. */
export function payloadOf(f: ClaimForm, receiptToken: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v !== '' && v !== undefined && v !== null) out[k] = v;
  if (receiptToken) out.receipt_token = receiptToken;
  return out;
}

export interface Budget {
  id: number;
  name: string;
  used: string | null;
  amount: string | null;
  currency: string;
  pct: number | null;
}

export interface Preview {
  ready: boolean;
  fx_missing: boolean;
  message: string | null;
  base_amount: string | null;
  base_currency: string;
  rate: { rate: string; source: string; on: string } | null;
  blocks: Hit[];
  warnings: Hit[];
  budgets: Budget[];
  routing: string | null;
}

const hits = (x: unknown): Hit[] => asList<Raw>(x).map((h) => ({ rule: String(h.rule ?? ''), policy: str(h.policy), message: String(h.message ?? '') }));

export function toPreview(r: Raw): Preview {
  const fx = r.exchange_rate as Raw | null | undefined;
  return {
    ready: flag(r.ready) || r.ready === 'true',
    fx_missing: flag(r.fx_missing),
    message: str(r.message),
    base_amount: str(r.base_amount),
    base_currency: String(r.base_currency ?? ''),
    rate: fx ? { rate: String(fx.rate ?? ''), source: String(fx.source ?? ''), on: String(fx.on ?? '') } : null,
    blocks: hits(r.blocks),
    warnings: hits(r.warnings),
    budgets: asList<Raw>(r.budgets).map((b) => ({ id: idOf(b.id) ?? 0, name: String(b.name ?? ''), used: str(b.used), amount: str(b.amount), currency: String(b.currency ?? ''), pct: b.pct === null || b.pct === undefined || b.pct === '' ? null : Number(b.pct) })),
    routing: str(r.routing),
  };
}

/** A rate other than one: worth saying what it was and where it came from. */
export const converted = (p: Preview) => !!p.rate && p.rate.rate !== '' && Number(p.rate.rate) !== 1;

/**
 * The same policy and budget engines the save runs, against the form as it
 * stands. It never writes, and it shares its code with `create`, so it cannot
 * promise something the save then refuses.
 */
export const previewClaim = (orgId: number, body: Record<string, string>, signal?: AbortSignal) =>
  request<Raw>('POST', '/api/expense/claims2/preview', { query: { org: orgId }, body, signal }).then((r) => toPreview(r.data ?? {}));

export interface Filed {
  id: number | null;
  claim_no: string | null;
  message: string | null;
  workings: string[];
}

export const fileClaim = (orgId: number, body: Record<string, string>) =>
  apiPost<Raw>('/api/expense/claims2', body, { org: orgId }).then(
    (r): Filed => ({ id: idOf(r?.id), claim_no: str(r?.claim_no), message: str(r?.message), workings: asList<unknown>(r?.workings).map(String) }),
  );

/** The refusals a failed save carried, when it carried them as rules. */
export function blocksOf(e: unknown): Hit[] {
  const d = (e as { data?: unknown } | null)?.data as Raw | null | undefined;
  return d && typeof d === 'object' ? hits(d.blocks) : [];
}

// ── query keys ───────────────────────────────────────────────────────────

export const CK = {
  list: (org: string, scope: ClaimScope, f: ClaimFilters) => [...K.scope(org), 'claims', scope, f] as const,
  claims: (org: string) => [...K.scope(org), 'claims'] as const,
  claim: (org: string, id: number) => [...K.scope(org), 'claim', id] as const,
  categories: (org: string) => [...K.scope(org), 'categories'] as const,
  companyCategories: (orgId: number) => [...K.one(orgId), 'categories'] as const,
  settings: (orgId: number) => [...K.one(orgId), 'settings'] as const,
  costCentres: (orgId: number) => [...K.one(orgId), 'cost-centres'] as const,
  related: (orgId: number) => [...K.one(orgId), 'related'] as const,
  advances: (orgId: number) => [...K.one(orgId), 'advances', 'open-mine'] as const,
  schedule: (orgId: number) => [...K.one(orgId), 'rates'] as const,
  preview: (orgId: number, body: Record<string, string>) => [...K.one(orgId), 'claim-preview', body] as const,
};
