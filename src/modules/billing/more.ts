import { apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';

/**
 * Billing part 2: payments (the list, one payment, allocating, refunding, its
 * receipt and transfer slips), credit and debit notes, customers, recurring
 * profiles, reports and settings. The same `/api/billing/*` the web's screens
 * use. A refund needs `billing.credit` (not `billing.payment`); notes need
 * `billing.credit`; profiles `billing.recurring`; settings `billing.settings`.
 */

const withOrg = (org: string, rest: Record<string, string | number | boolean | undefined> = {}) => ({ ...(org ? { org } : {}), ...rest });

export const KB = {
  payments: (org: string, f: object) => ['billing', 'payments', org, f] as const,
  payment: (id: number) => ['billing', 'payment', id] as const,
  slips: (id: number) => ['billing', 'payment', id, 'slips'] as const,
  notes: (org: string, f: object) => ['billing', 'notes', org, f] as const,
  note: (id: number) => ['billing', 'note', id] as const,
  customers: (org: string, f: object) => ['billing', 'customers', org, f] as const,
  customer: (id: number, org: string) => ['billing', 'customer', id, org] as const,
  profiles: ['billing', 'profiles'] as const,
  profile: (id: number, org: string) => ['billing', 'profile', id, org] as const,
  report: (kind: string, p: object) => ['billing', 'report', kind, p] as const,
  allTaxes: ['billing', 'all-taxes'] as const,
  rates: ['billing', 'rates'] as const,
  modes: (org: string) => ['billing', 'modes', org] as const,
  currencies: ['billing', 'currencies'] as const,
  access: ['billing', 'access'] as const,
  moduleSettings: (org: string) => ['billing', 'module-settings', org] as const,
};

// ── payments ────────────────────────────────────────────────────────────

export interface Payment {
  id: number;
  reference: string;
  client_id: number | null;
  client: string | null;
  method: string;
  direction: 'in' | 'out';
  amount: number;
  currency: string;
  exchange_rate: number;
  base_amount: number;
  unallocated: number;
  paid_on: string;
  bank_reference: string | null;
  note: string | null;
  file_id: number | null;
  refund_of_id: number | null;
  recorded_by: string | null;
  created_at: string | null;
  gateway: string | null;
  gateway_ref: string | null;
  gateway_status: string | null;
  verified_at: string | null;
}

export interface PaymentDetail extends Payment {
  allocations: Array<{ id: number; invoice_id: number; number: string | null; amount: number; invoice_total: number; due_date: string | null; status: string }>;
  refunds: Array<{ id: number; reference: string; amount: number; paid_on: string; note: string | null }>;
}

export interface Slip {
  id: number;
  name: string;
  mime: string | null;
  size: number;
  note: string | null;
  sha256: string | null;
  uploaded_by: string | null;
  created_at: string | null;
  is_image: boolean;
}

export const PER_PAGE = 50;

export const fetchPayments = (org: string, f: { q: string; method: string; unallocated: boolean; page: number }, signal?: AbortSignal) =>
  apiGet<{ payments: Payment[]; total: number; summary: { in?: { total: number; unallocated: number }; out?: { total: number; unallocated: number } } }>(
    '/api/billing/payments',
    withOrg(org, { q: f.q.trim() || undefined, method: f.method || undefined, unallocated: f.unallocated ? 1 : undefined, page: f.page, per_page: PER_PAGE }),
    signal,
  );
export const fetchPayment = (id: number, signal?: AbortSignal) => apiGet<{ payment: PaymentDetail }>(`/api/billing/payments/${id}`, undefined, signal).then((r) => r.payment);
export const updatePayment = (id: number, body: { bank_reference?: string; note?: string; method?: string; paid_on?: string }) => apiPut<{ payment: PaymentDetail }>(`/api/billing/payments/${id}`, body);
export const deletePayment = (id: number) => apiDelete(`/api/billing/payments/${id}`);
/** `via_gateway` sends the money back through the gateway that took it (G-02); without it, it records a refund already made. */
export const refundPayment = (id: number, body: { amount: number; reason?: string; paid_on?: string; via_gateway?: boolean }) =>
  apiPost<{ payment: PaymentDetail; refund_ref?: string | null }>(`/api/billing/payments/${id}/refund`, body);
/** Allocate within the payment's own currency: 'auto' settles the oldest first, a list settles exactly. */
export const allocatePayment = (id: number, allocate: 'auto' | Array<{ invoice_id: number; amount: number }>) =>
  request<{ payment: PaymentDetail; allocation: { allocated: string; count: number; errors: string[] } }>('POST', `/api/billing/payments/${id}/allocate`, { body: { allocate } });
/**
 * Settle an invoice in ANOTHER currency (G-17, `POST payments/{id}/allocate-fx`): `payment_amount` is in the payment's
 * currency and `rate` is one unit of it in the invoice's, so the invoice is settled by payment_amount × rate and the
 * server posts the realised gain or loss. One invoice per call.
 */
export const allocateFx = (id: number, body: { invoice_id: number; payment_amount: number; rate: number }) => request<Record<string, unknown>>('POST', `/api/billing/payments/${id}/allocate-fx`, { body });
/** The receipt, filed in the Drive: its file id, to download. */
export const receiptPdf = (id: number) => apiPost<{ file_id: number; name: string }>(`/api/billing/payments/${id}/receipt`, {});
export const fetchSlips = (id: number, signal?: AbortSignal) => apiGet<{ receipts: Slip[] }>(`/api/billing/payments/${id}/slips`, undefined, signal).then((r) => r.receipts ?? []);
export function uploadSlip(id: number, file: File, note?: string) {
  const form = new FormData();
  form.append('file', file, file.name);
  if (note?.trim()) form.append('note', note.trim());
  return request<{ receipts: Slip[] }>('POST', `/api/billing/payments/${id}/slips`, { body: form });
}
export const removeSlip = (id: number, slip: number) => apiDelete<{ receipts: Slip[] }>(`/api/billing/payments/${id}/slips/${slip}`);

// ── credit and debit notes ──────────────────────────────────────────────

export interface Note {
  id: number;
  number: string | null;
  kind: 'credit' | 'debit';
  status: string;
  client_id: number | null;
  client: string | null;
  invoice_id: number | null;
  invoice_number: string | null;
  currency: string;
  total: number;
  applied: number;
  remaining: number;
  issue_date: string | null;
  reason: string | null;
  org_id?: number | null;
}
export interface NoteDetail extends Note {
  lines: Array<{ id: number; description: string; quantity: number; unit_price: number; discount_pct: number; net_total: number; tax_amount: number; line_total: number }>;
  allocations: Array<{ id: number; invoice_id: number; number: string | null; amount: number }>;
}

export const fetchNotes = (org: string, f: { kind: 'credit' | 'debit'; q: string; page: number }, signal?: AbortSignal) =>
  apiGet<{ notes: Note[]; total: number }>('/api/billing/credit-notes', withOrg(org, { kind: f.kind, q: f.q.trim() || undefined, page: f.page, per_page: PER_PAGE }), signal);
export const fetchNote = (id: number, signal?: AbortSignal) => apiGet<{ note: NoteDetail }>(`/api/billing/credit-notes/${id}`, undefined, signal).then((r) => r.note);
export const createNote = (body: { kind: 'credit' | 'debit'; client_id?: number; invoice_id?: number; org_id?: number; reason?: string; lines: Array<{ description: string; quantity: number; unit_price: number; tax_rate_ids?: number[] }> }) =>
  apiPost<{ note: NoteDetail }>('/api/billing/credit-notes', body);
export const deleteNote = (id: number) => apiDelete(`/api/billing/credit-notes/${id}`);
/** Issue: numbered; a credit note raised against an invoice is applied to it at once. */
export const issueNote = (id: number) => request<{ note: NoteDetail; applied: string | null }>('POST', `/api/billing/credit-notes/${id}/issue`, { body: {} });
export const applyNote = (id: number, invoiceId: number, amount: number) => apiPost<{ applied: string }>(`/api/billing/credit-notes/${id}/apply`, { invoice_id: invoiceId, amount });
/** Take a credit note off an invoice (G-16): the invoice owes it again and the note's balance comes back. */
export const unapplyNote = (id: number, invoiceId: number) => request<{ note?: NoteDetail }>('POST', `/api/billing/credit-notes/${id}/unapply`, { body: { invoice_id: invoiceId } });
/** Pay a credit note's unused balance out to the customer (G-16), from a bank account by a payment mode. */
export const refundCredit = (id: number, body: { amount: number; mode_id: number; method?: string; bank_account_id?: number }) =>
  request<{ refund_id: number; reference: string; posting?: unknown }>('POST', `/api/billing/credit-notes/${id}/refund`, { body });
export const notePdf = (id: number) => apiPost<{ file_id: number; name: string }>(`/api/billing/credit-notes/${id}/pdf`, {});
/** A customer's issued invoices still owing, in one currency — what a note or a payment can go against. */
export const openInvoicesOf = (clientId: number, signal?: AbortSignal) =>
  apiGet<{ invoices: Array<{ id: number; number: string | null; currency: string; due: number; total: number; due_date: string | null; status: string; org_id?: number | null }> }>(
    '/api/billing/invoices',
    { client_id: clientId, unpaid: 1, per_page: 100 },
    signal,
  ).then((r) => r.invoices ?? []);

// ── customers ───────────────────────────────────────────────────────────

export interface CustomerRow {
  id: number;
  name: string;
  email: string | null;
  account_type: string | null;
  currency: string;
  outstanding: number;
  overdue: number;
  billed: number;
  invoice_count: number;
  on_account: number;
}
export interface CustomerDetail {
  customer: { id: number; name: string; email: string | null; phone: string | null; currency: string | null; account_type: string | null; billing_address: string | null };
  summary: { outstanding: number; overdue: number; billed: number; paid: number; on_account: number; invoice_count: number };
  aging: { current: number; '1_30': number; '31_60': number; '61_90': number; over_90: number; total: number };
  invoices: Array<{ id: number; number: string | null; type: string; status: string; currency: string; total: number; due: number; issue_date: string | null; due_date: string | null }>;
  payments: Array<{ id: number; reference: string; method: string; direction: 'in' | 'out'; amount: number; currency: string; paid_on: string; unallocated: number }>;
  recurring: Array<{ id: number; name: string; frequency: string; next_run_on: string | null; status: string }>;
}

export const fetchCustomers = (org: string, f: { q: string; owing: boolean; page: number }, signal?: AbortSignal) =>
  apiGet<{ customers: CustomerRow[] }>('/api/billing/customers', withOrg(org, { q: f.q.trim() || undefined, owing: f.owing ? 1 : undefined, page: f.page, per_page: 100 }), signal).then((r) => r.customers ?? []);
export const fetchCustomer = (id: number, org: string, signal?: AbortSignal) => apiGet<CustomerDetail>(`/api/billing/customers/${id}`, withOrg(org), signal);

// ── recurring ───────────────────────────────────────────────────────────

export const FREQUENCIES: Array<{ id: string; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'semiannual', label: 'Twice a year' },
  { id: 'annual', label: 'Yearly' },
];
export const frequencyLabel = (f: string) => FREQUENCIES.find((x) => x.id === f)?.label ?? (f === 'custom' ? 'Custom' : f);

export interface Profile {
  id: number;
  name: string;
  client_id: number | null;
  client: string | null;
  owner: string | null;
  frequency: string;
  interval_count: number;
  schedule: string;
  start_date: string | null;
  end_date: string | null;
  next_run_on: string | null;
  last_run_on: string | null;
  occurrences_done: number;
  occurrences_limit: number | null;
  generated: number;
  currency: string;
  status: 'active' | 'paused' | 'finished';
  auto_issue: boolean;
  due_now: boolean;
  lead_days: number | null;
  raise_on: string | null;
  org_id: number | null;
  managed: { by: string; id: number; reference: string; live: boolean; why: string } | null;
  cannot_run: string | null;
}
export interface ProfileDetail extends Profile {
  payment_terms_days: number | null;
  notes: string | null;
  terms: string | null;
  lines: Array<{ id: number; product_id: number | null; description: string; quantity: number; unit_price: number; discount_pct: number; tax_rate_ids: number[] }>;
  invoices: Array<{ id: number; number: string | null; status: string; issue_date: string | null; due_date: string | null; currency: string; total: number; paid: number; balance: number }>;
  history: Array<{ id: number; number: string | null; status: string; issue_date: string | null; due_date: string | null; currency: string; total: number; paid: number; balance: number }>;
  payments: Array<{ id: number; reference: string; paid_on: string; method: string; direction: 'in' | 'out'; currency: string; allocated: number; invoice_id: number | null; invoice_number: string | null }>;
  trade: { generated_count: number; history_count: number; billed: number; history_billed: number; received: number; outstanding: number; currency: string | null; truncated: boolean };
}

export const fetchProfiles = (signal?: AbortSignal) => apiGet<{ profiles: Profile[]; due_now: number }>('/api/billing/recurring', undefined, signal);
export const fetchProfile = (id: number, org: string, signal?: AbortSignal) => apiGet<{ profile: ProfileDetail; upcoming: string[] }>(`/api/billing/recurring/${id}`, withOrg(org), signal);
export const createProfile = (body: Record<string, unknown>) => apiPost<{ profile: ProfileDetail }>('/api/billing/recurring', body);
export const updateProfile = (id: number, body: Record<string, unknown>) => apiPut<{ profile: ProfileDetail }>(`/api/billing/recurring/${id}`, body);
export const deleteProfile = (id: number) => apiDelete(`/api/billing/recurring/${id}`);
/** Bills the current period and moves the schedule on; the server's sentence says whether it was issued. */
export const runProfile = (id: number) => request<{ invoice_id: number; number: string | null; profile: ProfileDetail }>('POST', `/api/billing/recurring/${id}/run`, { body: { advance: true } });

// ── reports ─────────────────────────────────────────────────────────────

export type BillReport = 'aging' | 'revenue' | 'tax' | 'customers' | 'payments' | 'products';
export const BILL_REPORTS: Array<{ id: BillReport; label: string }> = [
  { id: 'aging', label: 'Aging' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'tax', label: 'Tax' },
  { id: 'customers', label: 'Customers' },
  { id: 'payments', label: 'Payments' },
  { id: 'products', label: 'What sold' },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportAnswer = Record<string, any>;
export const fetchBillReport = (kind: BillReport, p: { org: string; from: string; to: string; group?: string }, signal?: AbortSignal) =>
  apiGet<ReportAnswer>(`/api/billing/reports/${kind}`, withOrg(p.org, kind === 'aging' ? {} : { from: p.from, to: p.to, ...(kind === 'revenue' ? { group: p.group } : {}) }), signal);

// ── settings ────────────────────────────────────────────────────────────

export interface TaxRow {
  id: number;
  name: string;
  code: string | null;
  rate: number;
  kind: 'sales' | 'withholding';
  is_compound: boolean;
  region: string | null;
  is_default: boolean;
  active: boolean;
}
export const fetchAllTaxes = (signal?: AbortSignal) => apiGet<{ taxes: TaxRow[] }>('/api/billing/taxes', undefined, signal).then((r) => r.taxes ?? []);
export const addTax = (body: { name: string; code?: string; rate: number; kind: 'sales' | 'withholding'; is_compound?: boolean; is_default?: boolean }) => apiPost('/api/billing/taxes', body);
export const updateTax = (id: number, body: Partial<TaxRow>) => apiPut(`/api/billing/taxes/${id}`, body);
/** Retire: the rate stays on the invoices that used it, and is no longer offered. */
export const retireTax = (id: number) => apiDelete(`/api/billing/taxes/${id}`);

export interface Rates {
  base_currency: string;
  latest: Record<string, number>;
  history: Array<{ id: number; currency: string; rate: number; effective_on: string; source: string | null; entered_by: string | null }>;
}
export const fetchRates = (signal?: AbortSignal) => apiGet<Rates>('/api/billing/rates', undefined, signal);
/** A rate is the base currency's value of ONE unit of `currency` (base = amount × rate). */
export const addRate = (body: { currency: string; rate: number; effective_on: string }) => request('POST', '/api/billing/rates', { body });
export const removeRate = (id: number) => apiDelete(`/api/billing/rates/${id}`);

export interface Mode {
  id: number;
  org_id: number;
  name: string;
  kind: string;
  instructions: string | null;
  bank_account_id: number | null;
  is_active: boolean;
  sort_order: number;
  payments: number;
  shared: boolean;
}
export const fetchModes = (org: string, signal?: AbortSignal) => apiGet<{ rows: Mode[] }>('/api/billing/payment-modes', withOrg(org), signal).then((r) => r.rows ?? []);
export const saveMode = (m: Partial<Mode>, org: string) =>
  m.id ? apiPut(`/api/billing/payment-modes/${m.id}`, m) : apiPost('/api/billing/payment-modes', m, { org: org || '0' });
export const removeMode = (id: number) => apiDelete(`/api/billing/payment-modes/${id}`);

export interface CurrencyRow {
  id: number;
  code: string;
  name: string;
  symbol: string | null;
  decimals: number;
  is_active: boolean;
  is_base: boolean;
  documents: number;
}
export const fetchCurrencies = (signal?: AbortSignal) => apiGet<{ base: string; rows: CurrencyRow[]; base_locked: string | null }>('/api/billing/currencies', undefined, signal);
export const saveCurrency = (c: Partial<CurrencyRow>) => (c.id ? apiPut(`/api/billing/currencies/${c.id}`, c) : apiPost('/api/billing/currencies', c));
export const makeBase = (id: number) => apiPost(`/api/billing/currencies/${id}/base`, {});
export const removeCurrency = (id: number) => apiDelete(`/api/billing/currencies/${id}`);

export interface BillingAccess {
  companies: Array<{ id: number; name: string; currency: string | null; role: string | null }>;
  scoped: string[];
  unscoped: string[];
  unassigned: Record<string, number>;
  why: string;
  boundary_note: string;
  permissions: Array<{ slug: string; name: string; held: boolean; via?: string | null }>;
}
export const fetchBillingAccess = (signal?: AbortSignal) => apiGet<BillingAccess>('/api/billing/access', undefined, signal);

// ── pure helpers ────────────────────────────────────────────────────────

/** A multi-line note's total before tax, to the cent: the server's figures replace it once saved. */
export const notesTotal = (lines: Array<{ quantity: number | string; unit_price: number | string }>) => Math.round(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0) * 100) / 100;

/** A payment's amount in an invoice's currency at `rate` (one unit of the payment's currency in the invoice's), to the cent. */
export const converted = (amount: number, rate: number) => Math.round(amount * rate * 100) / 100;

/** How much of a payment can still be refunded: only what is not set against invoices. */
export const refundable = (p: Pick<PaymentDetail, 'direction' | 'unallocated'>) => (p.direction === 'in' ? Math.max(0, Number(p.unallocated) || 0) : 0);

/**
 * Spread `amount` across a customer's open invoices, oldest due first, as the
 * server's "settle the oldest first" does — so the amounts shown before
 * allocating are the ones it would choose. Returns the amount per invoice id.
 */
export function oldestFirst(invoices: Array<{ id: number; due: number; due_date: string | null }>, amount: number): Record<number, number> {
  const out: Record<number, number> = {};
  let left = Math.round(amount * 100);
  const sorted = [...invoices].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.id - b.id);
  for (const i of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, Math.round(Number(i.due) * 100));
    if (take > 0) {
      out[i.id] = take / 100;
      left -= take;
    }
  }
  return out;
}

/** The next few dates a profile will run on (the server's `upcoming`), in words. */
export const profileState = (p: Pick<Profile, 'status' | 'due_now' | 'cannot_run' | 'managed'>): { label: string; tone: 'red' | 'amber' | 'green' | 'grey' | 'violet' } =>
  p.managed?.live
    ? { label: `run by ${p.managed.by}`, tone: 'violet' }
    : p.cannot_run
      ? { label: 'cannot run', tone: 'red' }
      : p.status === 'paused'
        ? { label: 'paused', tone: 'amber' }
        : p.status === 'finished'
          ? { label: 'finished', tone: 'grey' }
          : p.due_now
            ? { label: 'due now', tone: 'red' }
            : { label: 'active', tone: 'green' };
