import type { QueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { cents, fromCents, refusal } from '../finance/api';
import { canAct, count, K, type Org } from './api';

/**
 * Suppliers: the vendors a group buys from, and the subscriptions it pays for
 * on a cycle (the server's `/api/expense/vendors` and `/subscriptions`).
 *
 * EVERY COLUMN MAY ARRIVE AS A STRING. The list shapes its rows in PHP, but
 * the claim rows under a subscription and the vendor picklist are raw database
 * rows, where an id is "12" and a flag is "0". Each one is converted once, here
 * — a screen that tested `if (row.auto_renew)` against "0" would call every
 * subscription auto-renewing.
 *
 * VENDORS ARE GROUP-WIDE; THEIR TOTALS ARE NOT. `vendors` has no company, but
 * the purchases beside each one are summed from claims, which do — so the list
 * is asked for one company and keyed under it.
 *
 * SUBSCRIPTIONS MAY BELONG TO NO COMPANY. `org_id` null means "every company":
 * the row shows under every selection and its cost counts in every company's
 * totals. Moving it into one is its own act with its own endpoint.
 *
 * MONEY STAYS A STRING, AND NEVER CROSSES A CURRENCY. The totals here are added
 * in cents, per currency. The server's overview adds every row's monthly
 * figure whatever its currency and the web labels the result LKR; that figure
 * is not used.
 */

// ── the shapes ───────────────────────────────────────────────────────────

export interface SubDomain {
  id: number;
  name: string;
  registrar: string | null;
  expires_on: string | null;
  days_left: number | null;
  /** "in 40 days", "expired 3 days ago" — the server's words. */
  left: string;
  auto_renew: boolean | null;
}

export interface Sub {
  id: number;
  name: string;
  description: string | null;
  vendor: string | null;
  category: string | null;
  /** Null means "every company", not "unknown". */
  org_id: number | null;
  org: string | null;
  /** The ids as well as the names: the editor round-trips them, and seeding a picker from a name is how the wrong vendor gets attached. */
  vendor_id: number | null;
  category_id: number | null;
  billing_cycle: string;
  /** The price of ONE unit. */
  amount: string;
  currency: string;
  quantity: number;
  /** What one cycle costs: `amount` times `quantity`, worked out by the server. */
  charge: string;
  monthly_equiv: string;
  /** The rate as well as what it produced — a blank rate box on a foreign-currency row would overwrite the booked one. */
  exchange_rate: string;
  base_amount: string;
  base_currency: string;
  start_date: string;
  end_date: string | null;
  auto_renew: boolean;
  status: string;
  /** Null unless active: a paused subscription renews on no date at all. */
  next_renewal: string | null;
  days_until: number | null;
  /** The STATED renewal date; null means it is worked out from the start date. */
  renews_on: string | null;
  renewal_is_set: boolean;
  /** Only a stated date can be overdue — the calculation rolls past it. */
  overdue: boolean;
  /** Follows a domain in Hosting, whose registrar owns the renewal date and auto-renew. */
  domain_linked: boolean;
  /** Null for somebody who may not open that register. */
  domain: SubDomain | null;
}

export interface Vendor {
  id: number;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  tax_number: string | null;
  status: string;
  total_purchases: string;
  total_paid: string;
  last_transaction: string | null;
  claim_count: number;
}

export type DocKind = 'invoice' | 'payment_receipt';

export interface SubDoc {
  id: number;
  kind: string;
  title: string;
  amount: string | null;
  currency: string | null;
  document_date: string | null;
  reference: string | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string | null;
  /** False when the bytes have gone from the Drive — no link is drawn for a download that would 404. */
  has_file: boolean;
  file_name: string | null;
  file_size: number | null;
}

export interface SubClaim {
  id: number;
  claim_no: string | null;
  description: string;
  amount: string;
  currency: string;
  status: string;
  spent_on: string;
  claimant: string | null;
}

export interface SubClaims {
  items: SubClaim[];
  total: number;
  /** In `sum_currency`: the base amounts, added. */
  sum: string;
  /** Null when the claims disagree about their base currency — then the sum cannot be labelled. */
  sum_currency: string | null;
  /** Claims not yet converted, so not in the sum. */
  unconverted: number;
  shown: number;
  /** The list is what this reader may see, not every claim filed. */
  scoped: boolean;
}

export interface Named {
  id: number;
  name: string;
}

// ── converting what arrives ──────────────────────────────────────────────

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const opt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const text = (v: unknown, dflt = ''): string => (v === null || v === undefined ? dflt : String(v));

/** A flag as the database may send it: "0" is false, "1" and true are true. */
export function flag(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['1', 'true', 't', 'yes', 'on'].includes(v.trim().toLowerCase());
  return false;
}

/** A positive whole id, or null ("0", "", null and garbage are not ids). */
export function idOf(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A whole number that may be negative (days overdue), or null. */
function int(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function toSub(raw: unknown): Sub {
  const r = obj(raw);
  const d = r.domain && typeof r.domain === 'object' ? obj(r.domain) : null;
  const amount = text(r.amount, '0.00');
  const currency = text(r.currency);
  return {
    id: idOf(r.id) ?? 0,
    name: text(r.name),
    description: opt(r.description),
    vendor: opt(r.vendor),
    category: opt(r.category),
    org_id: idOf(r.org_id),
    org: opt(r.org),
    vendor_id: idOf(r.vendor_id),
    category_id: idOf(r.category_id),
    billing_cycle: text(r.billing_cycle, 'monthly'),
    amount,
    currency,
    quantity: Math.max(1, int(r.quantity) ?? 1),
    charge: text(r.charge, amount),
    monthly_equiv: text(r.monthly_equiv, '0.00'),
    exchange_rate: text(r.exchange_rate, '1.000000'),
    base_amount: text(r.base_amount, amount),
    base_currency: text(r.base_currency, currency),
    start_date: text(r.start_date),
    end_date: opt(r.end_date),
    auto_renew: flag(r.auto_renew),
    status: text(r.status, 'active'),
    next_renewal: opt(r.next_renewal),
    days_until: int(r.days_until),
    renews_on: opt(r.renews_on),
    renewal_is_set: flag(r.renewal_is_set),
    overdue: flag(r.overdue),
    domain_linked: flag(r.domain_linked),
    domain: d
      ? {
          id: idOf(d.id) ?? 0,
          name: text(d.name),
          registrar: opt(d.registrar),
          expires_on: opt(d.expires_on),
          days_left: int(d.days_left),
          left: text(d.left),
          auto_renew: d.auto_renew === null || d.auto_renew === undefined ? null : flag(d.auto_renew),
        }
      : null,
  };
}

export function toVendor(raw: unknown): Vendor {
  const r = obj(raw);
  return {
    id: idOf(r.id) ?? 0,
    name: text(r.name),
    contact_person: opt(r.contact_person),
    email: opt(r.email),
    phone: opt(r.phone),
    tax_number: opt(r.tax_number),
    status: text(r.status, 'active'),
    total_purchases: text(r.total_purchases, '0.00'),
    total_paid: text(r.total_paid, '0.00'),
    last_transaction: opt(r.last_transaction),
    claim_count: count(r.claim_count),
  };
}

export function toDoc(raw: unknown): SubDoc {
  const r = obj(raw);
  return {
    id: idOf(r.id) ?? 0,
    kind: text(r.kind, 'invoice'),
    title: text(r.title),
    amount: opt(r.amount),
    currency: opt(r.currency),
    document_date: opt(r.document_date),
    reference: opt(r.reference),
    notes: opt(r.notes),
    uploaded_by: opt(r.uploaded_by),
    created_at: opt(r.created_at),
    has_file: flag(r.has_file),
    file_name: opt(r.file_name),
    file_size: int(r.file_size),
  };
}

export function toClaims(raw: unknown): SubClaims {
  const r = obj(raw);
  const items = (Array.isArray(r.items) ? r.items : []).map((x): SubClaim => {
    const c = obj(x);
    return {
      id: idOf(c.id) ?? 0,
      claim_no: opt(c.claim_no),
      description: text(c.description),
      amount: text(c.amount, '0.00'),
      currency: text(c.currency),
      status: text(c.status),
      spent_on: text(c.spent_on),
      claimant: opt(c.claimant),
    };
  });
  return {
    items,
    total: count(r.total ?? items.length),
    sum: text(r.sum, '0.00'),
    sum_currency: opt(r.sum_currency),
    unconverted: count(r.unconverted),
    shown: count(r.shown ?? items.length),
    scoped: r.scoped === undefined ? true : flag(r.scoped),
  };
}

const toNamed = (raw: unknown): Named => {
  const r = obj(raw);
  return { id: idOf(r.id) ?? 0, name: text(r.name) };
};

// ── words ────────────────────────────────────────────────────────────────

/** The cycles `subscriptions.billing_cycle` accepts, in order of length. */
export const CYCLES: Array<{ value: string; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannual', label: 'Every 6 months' },
  { value: 'annual', label: 'Annual' },
  { value: 'biennial', label: 'Every 2 years' },
  { value: 'triennial', label: 'Every 3 years' },
  // Domains are routinely bought five or ten years at a time.
  { value: 'quinquennial', label: 'Every 5 years' },
  { value: 'decennial', label: 'Every 10 years' },
];

export const cycleLabel = (c: string) => CYCLES.find((x) => x.value === c)?.label ?? c;

export const KIND_LABEL: Record<DocKind, string> = { invoice: 'invoice', payment_receipt: 'payment receipt' };

/** The currencies offered, after the configured one — which is always offered, even when this list has never heard of it. */
export const CURRENCIES = ['LKR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'INR', 'SGD'];

export function currencyChoices(base: string, current?: string | null): string[] {
  return [...new Set([base, current ?? '', ...CURRENCIES].map((c) => c.trim().toUpperCase()).filter(Boolean))];
}

/**
 * When a renewal is, in words. 1 is special-cased as well as 0: "in 1 days"
 * appears on the row a person is most likely to be reading carefully.
 */
export function inDays(d: number | null): string {
  if (d === null) return '';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d < 0 ? `${-d} days ago` : `in ${d} days`;
}

/**
 * One definition of when to worry, so the badge, the text beside it and the
 * list cannot disagree: overdue or within a week is red, within a month amber.
 */
export function renewalTone(d: number | null, overdue = false): 'red' | 'amber' | 'grey' {
  if (overdue) return 'red';
  if (d === null) return 'grey';
  return d <= 7 ? 'red' : d <= 30 ? 'amber' : 'grey';
}

/** Everything visible in a row, so what you can read you can search. */
export function matchesTerm(s: Sub, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [s.name, s.vendor, s.category, s.description, s.org, s.billing_cycle, cycleLabel(s.billing_cycle)].some((v) => (v ?? '').toLowerCase().includes(q));
}

// ── what the list adds up to ─────────────────────────────────────────────

export interface CurrencyCost {
  currency: string;
  /** Cents. */
  monthly: number;
  annual: number;
}

export interface SubSummary {
  active: number;
  /** Active and renewing in the next 30 days. */
  dueSoon: number;
  /** Active, with a stated renewal date that has passed. */
  overdue: number;
  /** One line per currency — never one figure across several. */
  costs: CurrencyCost[];
}

/**
 * The KPI figures, from the same rows the list shows, so the totals and the
 * rows are one read of one question. The monthly cost is each active row's
 * monthly equivalent added in cents, per currency; the annual is twelve of
 * those, as the server works it out.
 */
export function summarise(rows: Sub[]): SubSummary {
  const by = new Map<string, number>();
  let active = 0;
  let dueSoon = 0;
  let overdue = 0;
  for (const s of rows) {
    if (s.status !== 'active') continue;
    active += 1;
    if (s.overdue) overdue += 1;
    else if (s.days_until !== null && s.days_until >= 0 && s.days_until <= 30) dueSoon += 1;
    const c = cents(s.monthly_equiv);
    if (c === null) continue;
    by.set(s.currency, (by.get(s.currency) ?? 0) + c);
  }
  const costs = [...by.entries()].map(([currency, monthly]) => ({ currency, monthly, annual: monthly * 12 })).sort((a, b) => b.monthly - a.monthly || a.currency.localeCompare(b.currency));
  return { active, dueSoon, overdue, costs };
}

/**
 * What renews soon, soonest first — and what is already overdue, first of
 * all. The server's overview leaves an overdue renewal out of its list (its
 * days are negative), which hides the one that most needs somebody.
 */
export function renewing(rows: Sub[], limit = 15): Sub[] {
  return rows
    .filter((s) => s.status === 'active' && (s.overdue || (s.days_until !== null && s.days_until >= 0 && s.days_until <= 30)))
    .sort((a, b) => (a.days_until ?? 0) - (b.days_until ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ── who may do what ──────────────────────────────────────────────────────

/**
 * May this person change this subscription? `expense.manage`, and standing in
 * its company: a subscription in a company they can only read is not theirs to
 * change, and one in no company needs standing somewhere. Decoration over the
 * server's own checks, never a substitute — a button whose only outcome is a
 * 403 teaches people to distrust the screen.
 */
export function mayWriteSub(s: { org_id: number | null }, orgs: Org[], manage: boolean): boolean {
  if (!manage) return false;
  if (s.org_id === null) return orgs.some(canAct);
  const o = orgs.find((x) => x.id === s.org_id);
  return !!o && canAct(o);
}

/** Where a move may send it: companies this person may act in — the server refuses anything else on both ends. */
export const moveTargets = (orgs: Org[]) => orgs.filter(canAct);

/** The company a write about this subscription is asked in: its own, else the one on screen. */
export const writeOrg = (s: { org_id: number | null }, orgId: number | null): number | null => s.org_id ?? orgId;

/** What the list is showing, in a sentence's worth of words. */
export function scopeWords(all: boolean, org: string, orgId: number | null, orgs: Org[]): string {
  if (all || org === '') return 'every company you belong to';
  if (orgId !== null) return orgs.find((o) => o.id === orgId)?.name ?? 'this company';
  const n = org.split(',').filter(Boolean).length;
  return `the ${n} companies selected`;
}

/**
 * Why filing an expense against this subscription is not possible, in the
 * reader's own situation — three things stop it and each needs its own
 * sentence, ordered by what the reader would fix first. Null when nothing does.
 */
export function fileBlocked({ subOrgId, subOrg, orgId, several, acting }: { subOrgId: number | null; subOrg: string | null; orgId: number | null; several: boolean; acting: Org | null }): string | null {
  if (several) return 'You have several companies selected. Choose a single one to file an expense against this.';
  if (orgId === null) return null;
  if (subOrgId !== null && subOrgId !== orgId) return `This subscription belongs to ${subOrg ?? 'another company'}. Switch to it to file an expense against it.`;
  if (acting && !canAct(acting)) return `You can read ${acting.name}'s figures but are not a member of it, so you cannot file an expense there.`;
  return null;
}

/**
 * What a claim filed from a subscription starts from. `charge`, not `amount`:
 * the stored figure is the UNIT price, and prefilling it would understate a
 * 25-seat licence twenty-five-fold in the field that becomes the payment.
 * Only the link is decided; everything else stays editable on the form.
 */
export interface ClaimPreset {
  subscription_id: number;
  category_id: number | '';
  vendor_id: number | '';
  amount: string;
  currency: string;
  description: string;
}

export const claimPreset = (s: Sub): ClaimPreset => ({
  subscription_id: s.id,
  category_id: s.category_id ?? '',
  vendor_id: s.vendor_id ?? '',
  amount: s.charge,
  currency: s.currency,
  description: s.name,
});

// ── the form ─────────────────────────────────────────────────────────────

export type EditorMode = 'create' | 'edit' | 'copy';

export interface Draft {
  name: string;
  cycle: string;
  amount: string;
  qty: string;
  start: string;
  end: string;
  note: string;
  vendorId: string;
  categoryId: string;
  /** '' until the configured currency is known. */
  currency: string;
  rate: string;
  baseOverride: string;
}

/** "305.500000" → "305.5"; "1.000000" → "1". */
export function trimRate(r: string): string {
  if (!/^\d+(\.\d*)?$/.test(r)) return r;
  return r.includes('.') ? r.replace(/0+$/, '').replace(/\.$/, '') : r;
}

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const RATE = /^\d+(\.\d{1,6})?$/;

/** An amount as the server will take it (commas allowed), and above zero. */
export const amountOk = (v: string) => {
  const s = v.trim().replace(/,/g, '');
  return AMOUNT.test(s) && (cents(s) ?? 0) > 0;
};

export const rateOk = (v: string) => {
  const s = v.trim().replace(/,/g, '');
  return RATE.test(s) && Number(s) > 0;
};

/**
 * `amount × rate` to two places, TRUNCATED — what the server's `bcmul` stores —
 * worked in whole numbers so a float never decides a cent. Null when either
 * is not a number the server would take.
 */
export function mulTruncate(amount: string, rate: string): string | null {
  const a = amount.trim().replace(/,/g, '');
  const r = rate.trim().replace(/,/g, '');
  if (!AMOUNT.test(a) || !RATE.test(r)) return null;
  const c = cents(a);
  if (c === null) return null;
  const [w, f = ''] = r.split('.');
  const micro = BigInt(w || '0') * 1_000_000n + BigInt((f + '000000').slice(0, 6));
  return fromCents(Number((BigInt(c) * micro) / 1_000_000n));
}

/**
 * The form's starting point. A copy's name arrives suffixed, so two rows with
 * one name — which no later import could tell apart — are never made silently.
 * The base-currency override is seeded ONLY when it really was one (the stored
 * base is not what the rate produces); seeding it always would pin the base to
 * its old value the moment anybody edited the amount.
 */
export function seedDraft(sub: Sub | undefined, mode: EditorMode, today: string): Draft {
  if (!sub) return { name: '', cycle: 'monthly', amount: '', qty: '1', start: today, end: '', note: '', vendorId: '', categoryId: '', currency: '', rate: '', baseOverride: '' };
  const rate = sub.exchange_rate !== '1.000000' ? trimRate(sub.exchange_rate) : '';
  const computed = mulTruncate(sub.amount, sub.exchange_rate);
  const override = computed !== null && cents(sub.base_amount) !== cents(computed) ? sub.base_amount : '';
  return {
    name: mode === 'copy' ? `${sub.name} (copy)` : sub.name,
    cycle: sub.billing_cycle,
    amount: sub.amount,
    qty: String(sub.quantity),
    start: sub.start_date,
    end: sub.end_date ?? '',
    note: sub.description ?? '',
    vendorId: sub.vendor_id ? String(sub.vendor_id) : '',
    categoryId: sub.category_id ? String(sub.category_id) : '',
    currency: sub.currency,
    rate,
    baseOverride: override,
  };
}

/** What stops the form being sent, said while it is typed. The server checks again, and knows more. */
export function draftProblems(d: Draft, base: string): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('Give it a name.');
  if (!amountOk(d.amount)) out.push('Enter the amount per cycle — a number above zero, at most two decimal places.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.start)) out.push('Enter the start date.');
  if (d.end && /^\d{4}-\d{2}-\d{2}$/.test(d.start) && d.end < d.start) out.push('The end date is before the start date.');
  const foreign = d.currency !== '' && d.currency !== base;
  if (foreign && !rateOk(d.rate)) out.push(`Enter the exchange rate: what 1 ${d.currency} is in ${base}.`);
  if (foreign && d.baseOverride.trim() !== '' && !amountOk(d.baseOverride)) out.push(`The ${base} amount is not a number the books can take.`);
  return out;
}

/**
 * The body the form sends.
 *
 * EMPTY STRINGS, NOT NULLS, FOR THE OPTIONAL FIELDS: the server reads null as
 * "leave it alone" and '' as "clear it", so an unpicked vendor sent as null
 * could never be detached. An empty quantity is '' — "leave it alone", not
 * "set it to 1", which would quietly rewrite a 25-seat licence to one seat.
 * Auto-renew is set only on the way in: an edit must not re-arm it on a
 * subscription somebody turned it off for.
 */
export function subBody(d: Draft, mode: EditorMode, base: string): Record<string, unknown> {
  const foreign = d.currency !== '' && d.currency !== base;
  const body: Record<string, unknown> = {
    name: d.name.trim(),
    billing_cycle: d.cycle,
    amount: d.amount.trim(),
    quantity: d.qty === '' ? '' : Number(d.qty),
    start_date: d.start,
    end_date: d.end,
    description: d.note,
    vendor_id: d.vendorId,
    category_id: d.categoryId,
    currency: d.currency || base,
    exchange_rate: foreign ? d.rate.trim() : '1',
    base_amount: foreign ? d.baseOverride.trim() : '',
  };
  if (mode !== 'edit') body.auto_renew = true;
  return body;
}

// ── keys ─────────────────────────────────────────────────────────────────

/** Subscriptions under the selection they were read for; vendors under the one company. */
export const SK = {
  list: (scope: string) => [...K.scope(scope), 'subs', 'list'] as const,
  one: (org: string, id: number) => [...K.scope(org), 'subs', 'one', id] as const,
  docs: (org: string, id: number, kind: DocKind) => [...K.scope(org), 'subs', 'docs', id, kind] as const,
  claims: (org: string, id: number) => [...K.scope(org), 'subs', 'claims', id] as const,
  base: (org: string) => [...K.scope(org), 'subs', 'base'] as const,
  vendorPick: (org: string) => [...K.scope(org), 'subs', 'vendors'] as const,
  categories: (org: string) => [...K.scope(org), 'subs', 'categories'] as const,
  vendors: (orgId: number) => [...K.one(orgId), 'vendors'] as const,
};

/**
 * After a subscription changes: every selection's subscriptions (a move takes
 * it out of one and into another) and the dashboards, whose renewal count
 * reads them.
 */
export const bumpSubs = (qc: QueryClient) =>
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'expenses' && q.queryKey[1] === 's' && (q.queryKey[3] === 'subs' || q.queryKey[3] === 'dashboard') });

/** After a vendor changes: the vendor lists and the pickers that offer them. */
export const bumpVendors = (qc: QueryClient) =>
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'expenses' && (q.queryKey[3] === 'vendors' || (q.queryKey[3] === 'subs' && q.queryKey[4] === 'vendors')) });

// ── reads ────────────────────────────────────────────────────────────────

const rows = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** `scope` '' is every company the person belongs to — the endpoint's own rule. */
export const fetchSubs = (scope: string, signal?: AbortSignal) => apiGet<unknown>('/api/expense/subscriptions', scope ? { org: scope } : undefined, signal).then((r) => rows(r).map(toSub));

/** One subscription, from the server's scoped read ("not yours" and "not there" are one answer), with its document counts. */
export const fetchSub = (id: number, signal?: AbortSignal) =>
  apiGet<{ subscription?: unknown; documents?: Record<string, unknown> }>(`/api/expense/subscriptions/${id}`, undefined, signal).then((r) => {
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(r?.documents ?? {})) counts[k] = count(v);
    return { subscription: toSub(r?.subscription), documents: counts };
  });

export const fetchDocs = (id: number, kind: DocKind, signal?: AbortSignal) =>
  apiGet<{ documents?: unknown }>(`/api/expense/subscriptions/${id}/documents`, { kind }, signal).then((r) => rows(r?.documents).map(toDoc));

export const fetchSubClaims = (id: number, orgId: number | null, signal?: AbortSignal) =>
  apiGet<unknown>(`/api/expense/subscriptions/${id}/expenses`, orgId ? { org: orgId } : undefined, signal).then(toClaims);

/** The installation's currency — what the server converts a subscription into. */
export const fetchBaseCurrency = (signal?: AbortSignal) => apiGet<{ default_currency?: string }>('/api/expense/settings', undefined, signal).then((r) => (r?.default_currency || 'LKR').toUpperCase());

/** Active vendors only, for a picker. */
export const fetchVendorPick = (signal?: AbortSignal) => apiGet<unknown>('/api/expense/vendors/list', undefined, signal).then((r) => rows(r).map(toNamed));

export const fetchCategories = (org: string, signal?: AbortSignal) => apiGet<unknown>('/api/expense/categories', org ? { org } : undefined, signal).then((r) => rows(r).map(toNamed));

/** Every vendor, with what this company has spent with each. */
export const fetchVendors = (orgId: number, signal?: AbortSignal) => apiGet<unknown>('/api/expense/vendors', { org: orgId }, signal).then((r) => rows(r).map(toVendor));

// ── writes ───────────────────────────────────────────────────────────────

/*
 * The company rides as `?org=` on a write. The server's area check reads it
 * and makes it the company the request is about — which is also how a new
 * subscription lands in the company on screen rather than whichever one the
 * server last remembered.
 */
const inOrg = (path: string, org: number | null) => (org ? `${path}?org=${org}` : path);

/** Made in the company given — the form never chooses one; Move does. */
export const createSub = (orgId: number, body: Record<string, unknown>) => apiPost<{ id?: number | string; name?: string }>('/api/expense/subscriptions', body, { org: orgId });

/** Only the keys sent are changed — one field, or the whole form. */
export const updateSub = (id: number, body: Record<string, unknown>, org: number | null) => apiPut<{ id?: number }>(inOrg(`/api/expense/subscriptions/${id}`, org), body);

/** Null is "every company". Both ends are checked by the server. */
export const moveSub = (id: number, target: number | null) => apiPost<{ id?: number; org_id?: number | null; org?: string | null }>(`/api/expense/subscriptions/${id}/move`, { org_id: target });

export const deleteSub = (id: number, org: number | null) => apiDelete(inOrg(`/api/expense/subscriptions/${id}`, org));

/**
 * Pause, resume, cancel or reactivate: one field on the ordinary save, which
 * changes the status and nothing else. Says what happened, or the server's
 * refusal as written.
 */
export async function setSubStatus(qc: QueryClient, s: Pick<Sub, 'id' | 'name' | 'org_id'>, status: 'active' | 'paused' | 'cancelled', orgId: number | null): Promise<boolean> {
  try {
    await updateSub(s.id, { status }, writeOrg(s, orgId));
    toast(
      'success',
      status === 'paused'
        ? `${s.name} paused — it will not renew until it is resumed.`
        : status === 'cancelled'
          ? `${s.name} cancelled — it no longer renews or counts in the totals.`
          : `${s.name} is active again.`,
    );
    void bumpSubs(qc);
    return true;
  } catch (e) {
    toast('error', refusal(e));
    return false;
  }
}

export interface DocUpload {
  file: File;
  kind: DocKind;
  title: string;
  amount: string;
  /** The subscription's currency, so a transcribed amount is never a bare number. */
  currency: string;
  date: string;
  reference: string;
}

export function docForm(u: DocUpload): FormData {
  const body = new FormData();
  body.append('file', u.file);
  body.append('kind', u.kind);
  if (u.title.trim()) body.append('title', u.title.trim());
  if (u.amount.trim()) {
    body.append('amount', u.amount.trim());
    if (u.currency) body.append('currency', u.currency);
  }
  if (u.date) body.append('document_date', u.date);
  if (u.reference.trim()) body.append('reference', u.reference.trim());
  return body;
}

export const attachDoc = (id: number, body: FormData, org: number | null) =>
  apiPost<{ id?: number; renewal?: { from?: string; to?: string } | null }>(`/api/expense/subscriptions/${id}/documents`, body, org ? { org } : undefined);

export const removeDoc = (id: number, doc: number) => apiDelete(`/api/expense/subscriptions/${id}/documents/${doc}`);

/** Saved and opened by the desktop, which carries the session — a bare link would be an unauthenticated request. */
export const openDoc = (sub: number, doc: SubDoc) => call('transfers:download', { expenseFile: { kind: 'sub-document', sub, doc: doc.id }, name: doc.file_name || doc.title || 'document', open: true });

export const createVendor = (orgId: number, body: Record<string, string>) => apiPost<{ id?: number; name?: string }>('/api/expense/vendors', body, { org: orgId });

export const setVendorStatus = (orgId: number, id: number, status: 'active' | 'archived') => apiPut(inOrg(`/api/expense/vendors/${id}`, orgId), { status });

export const deleteVendor = (orgId: number, id: number) => apiDelete(inOrg(`/api/expense/vendors/${id}`, orgId));

// ── what the server did, in a sentence ───────────────────────────────────

/**
 * The upload's outcome. A payment receipt moves the renewal forward — once,
 * from the anniversary, never past the end date — and the person is told
 * where it moved to; a subscription that follows a domain is told why it did not.
 */
export function filedSentence(res: { renewal?: { to?: string } | null } | null | undefined, kind: DocKind, sub: Pick<Sub, 'domain_linked' | 'domain'>, date: (iso: string) => string): string {
  const to = res?.renewal?.to;
  if (to) return `Filed. The next renewal moved to ${date(to)}.`;
  if (kind === 'payment_receipt' && sub.domain_linked) return `Filed. The renewal date follows ${sub.domain?.name ?? 'its domain'}'s expiry, so the receipt did not move it.`;
  return 'Filed.';
}

/** A file size a person reads: 840 KB, 2.4 MB. */
export function fileSize(n: number | null): string {
  if (n === null || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
