import { useQuery } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';
import { addDays } from '../../core/time';

/**
 * Billing (the server's `/api/billing`, "Bill*" designs): invoices, the
 * payments against them, and the dashboard. What a user may do follows the
 * server's own slugs — `billing.view` to read, `billing.invoice` to make and
 * edit drafts, `billing.issue` to issue, record as sent and cancel,
 * `billing.payment` to record and allocate payments. `billing.manage` stands
 * in for every one of them but viewing; `*` for all.
 *
 * An invoice is a draft until it is issued: issuing gives it a number that is
 * never reused and freezes its figures. After that only a credit or debit note
 * changes what is owed, so the lines of an issued invoice are read-only.
 */

export const can = (perms: readonly string[] | undefined, slug: string) =>
  !!perms && (perms.includes('*') || perms.includes(slug) || (slug !== 'billing.view' && slug.startsWith('billing.') && perms.includes('billing.manage')));

const withOrg = (org: string, rest: Record<string, string | number | boolean | undefined> = {}) => ({ ...(org ? { org } : {}), ...rest });

export const K = {
  all: ['billing'] as const,
  dashboard: (org: string) => ['billing', 'dashboard', org] as const,
  invoices: (org: string, f: object) => ['billing', 'invoices', org, f] as const,
  invoice: (id: number) => ['billing', 'invoice', id] as const,
  orgs: ['billing', 'orgs'] as const,
  taxes: ['billing', 'taxes'] as const,
  settings: ['billing', 'settings'] as const,
  warehouses: ['billing', 'warehouses'] as const,
};

// ── statuses ────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'pending_approval' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'cancelled' | 'refunded';

export const STATUS: Record<InvoiceStatus, { label: string; chip: string }> = {
  draft: { label: 'Draft', chip: 'bg-[#F1F2F6] text-[#4A5168] dark:bg-[#1B2542] dark:text-[#C9CFE6]' },
  pending_approval: { label: 'Awaiting approval', chip: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning' },
  sent: { label: 'Sent', chip: 'bg-[#DBEAFE] text-[#1E40AF] dark:bg-[#16203E] dark:text-[#93B4FF]' },
  viewed: { label: 'Viewed', chip: 'bg-[#E0E7FF] text-[#3730A3] dark:bg-[#1E1B4B] dark:text-[#A5B4FC]' },
  partial: { label: 'Part paid', chip: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning' },
  paid: { label: 'Paid', chip: 'bg-[#DCFCE7] text-[#166534] dark:bg-success-bg dark:text-success' },
  overdue: { label: 'Overdue', chip: 'bg-[#FFE4E6] text-[#9F1239] dark:bg-danger-bg dark:text-danger' },
  cancelled: { label: 'Cancelled', chip: 'bg-[#F1F2F6] text-[#8A91A6] dark:bg-[#1B2542] dark:text-[#8A91A6]' },
  refunded: { label: 'Refunded', chip: 'bg-[#EDE9FE] text-[#5B21B6] dark:bg-[#2A1F4A] dark:text-[#C4B5FD]' },
};
export const statusOf = (s: string | null | undefined) => STATUS[(s ?? 'draft') as InvoiceStatus] ?? { label: s ?? '—', chip: STATUS.draft.chip };
export const STATUSES = Object.keys(STATUS) as InvoiceStatus[];
/** Still owed something: what "Unpaid only" means on the server. */
export const OPEN: InvoiceStatus[] = ['sent', 'viewed', 'partial', 'overdue'];

export const TYPES: Array<{ id: string; label: string }> = [
  { id: 'standard', label: 'Invoice' },
  { id: 'tax', label: 'Tax invoice' },
  { id: 'proforma', label: 'Proforma' },
  { id: 'commercial', label: 'Commercial invoice' },
];

export const METHODS: Array<{ id: string; label: string }> = [
  { id: 'bank_transfer', label: 'Bank transfer' },
  { id: 'cash', label: 'Cash' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'card', label: 'Card' },
  { id: 'online', label: 'Online' },
  { id: 'other', label: 'Other' },
];
export const methodLabel = (m: string | null | undefined) => METHODS.find((x) => x.id === m)?.label ?? (m === 'offset' ? 'Offset' : (m ?? '—'));

export const SORTS: Array<{ id: string; label: string }> = [
  { id: 'created', label: 'Newest' },
  { id: 'due', label: 'Due date' },
  { id: 'issued', label: 'Issue date' },
  { id: 'total', label: 'Amount' },
  { id: 'number', label: 'Number' },
  { id: 'client', label: 'Customer' },
];

// ── invoices ────────────────────────────────────────────────────────────

export interface Invoice {
  id: number;
  org_id: number | null;
  number: string | null;
  type: string;
  status: InvoiceStatus;
  client_id: number | null;
  client: string | null;
  project_id: number | null;
  project: string | null;
  warehouse_id: number | null;
  owner: string | null;
  owner_id: number | null;
  currency: string;
  base_currency: string;
  exchange_rate: number;
  subtotal: number;
  discount: number;
  tax_total: number;
  withholding: number;
  total: number;
  paid: number;
  credited: number;
  due: number;
  issue_date: string | null;
  due_date: string | null;
  po_number: string | null;
  file_id: number | null;
  sent_at: string | null;
  paid_at: string | null;
  days_overdue: number;
}

export interface InvoiceLine {
  id?: number;
  product_id: number | null;
  account_id?: number | null;
  description: string;
  quantity: number;
  unit?: string | null;
  unit_price: number;
  discount_pct: number;
  net_total?: number;
  tax_amount?: number;
  line_total?: number;
  source_type?: string | null;
  source_id?: number | null;
  tax_rate_ids: number[];
  taxes?: Array<{ name: string; rate: number; is_compound: boolean; amount: number }>;
}

export interface InvoiceDetail extends Invoice {
  contact: string | null;
  contact_email: string | null;
  billing_address: string | null;
  notes: string | null;
  terms: string | null;
  payment_terms_days: number | null;
  cancel_reason: string | null;
  lines: InvoiceLine[];
  tax_breakdown: Array<{ name: string; rate: number; is_compound: boolean; amount: number }>;
  allocations: {
    payments: Array<{ id: number; payment_id: number; reference: string; method: string; paid_on: string; amount: number; gateway: string | null }>;
    credits: Array<{ id: number; credit_id: number; number: string; amount: number }>;
  };
  timeline: Array<{ id: number; kind: string; title: string; body: string | null; author: string | null; at: string }>;
  /** SRS-BIL-001 additions; absent on a server before it. */
  /** The issue journal, when Finance has one. */
  journal?: { id: number; journal_no: string | null; status: string | null; reversed: boolean } | null;
  disputed?: { reason: string | null; at: string | null; by: string | null } | null;
  /**
   * Approval before issue (G-14). `status` is null until it is submitted; `required` (and `rule`) say why the
   * company's rules ask for it, null when they do not. `submitted_by` and `approved_by` are user ids.
   */
  approval?: {
    status: 'pending' | 'approved' | 'rejected' | null;
    note: string | null;
    submitted_by: number | null;
    submitted_at: string | null;
    approved_by?: number | null;
    approved_at?: string | null;
    rule?: string | null;
    required?: string | null;
    can_approve: boolean;
  } | null;
  /** The customer's email and phone, to start the Send dialog. */
  client_email?: string | null;
  client_phone?: string | null;
  viewed_at?: string | null;
}

export interface ListFilters {
  salesDate?: string | null;
  q?: string;
  status?: string;
  unpaid?: boolean;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
}

export interface InvoiceList {
  invoices: Invoice[];
  total: number;
  page: number;
  summary: Partial<Record<InvoiceStatus, { count: number; total: number; due: number }>>;
}

export const PER_PAGE = 50;

export const fetchInvoices = (org: string, f: ListFilters, signal?: AbortSignal) =>
  apiGet<InvoiceList>(
    '/api/billing/invoices',
    withOrg(org, { sales_date: f.salesDate || undefined, q: f.q?.trim() || undefined, status: f.status || undefined, unpaid: f.unpaid ? 1 : undefined, sort: f.sort || undefined, dir: f.dir, page: f.page ?? 1, per_page: PER_PAGE }),
    signal,
  );
export const fetchInvoice = (id: number, signal?: AbortSignal) => apiGet<{ invoice: InvoiceDetail; editable: boolean }>(`/api/billing/invoices/${id}`, undefined, signal);

export interface NewInvoice {
  org_id?: number;
  client_id: number;
  type: string;
  issue_date: string;
  payment_terms_days: number;
  po_number?: string;
  owner_id?: number;
  warehouse_id?: number;
  ship_to_name?: string;
  ship_to_address?: string;
  discount?: number;
  notes?: string;
  terms?: string;
  lines: Array<Omit<InvoiceLine, 'id'>>;
}

export const createInvoice = (body: NewInvoice) => apiPost<{ invoice: InvoiceDetail }>('/api/billing/invoices', body);
export const updateInvoice = (id: number, body: Record<string, unknown>) => apiPut<{ invoice: InvoiceDetail }>(`/api/billing/invoices/${id}`, body);
/** Issue: numbered, frozen. The server's sentence says the number it was given. */
export const issueInvoice = (id: number) => request<{ invoice: InvoiceDetail; posting?: { posted?: boolean; why?: string; problems?: string[] } }>('POST', `/api/billing/invoices/${id}/issue`, { body: {} });
export const markSent = (id: number, how: string) => apiPost<{ invoice: InvoiceDetail }>(`/api/billing/invoices/${id}/sent`, how.trim() ? { how: how.trim() } : {});
export const cancelInvoice = (id: number, reason: string) => apiPost<{ invoice: InvoiceDetail }>(`/api/billing/invoices/${id}/cancel`, reason.trim() ? { reason: reason.trim() } : {});
export const duplicateInvoice = (id: number) => apiPost<{ invoice: InvoiceDetail }>(`/api/billing/invoices/${id}/duplicate`, {});
export const deleteDraft = (id: number) => apiDelete(`/api/billing/invoices/${id}`);
/** The installation's PDF, filed in the Drive: `{file_id}` to download. For those without `share.download`. */
export const filePdf = (id: number) => apiPost<{ file_id: number; name: string }>(`/api/billing/invoices/${id}/pdf`, {});

// ── payments ────────────────────────────────────────────────────────────

export interface PaymentBody {
  client_id: number;
  amount: number;
  method: string;
  paid_on: string;
  currency?: string;
  org_id?: number;
  bank_account_id?: number;
  bank_reference?: string;
  note?: string;
  /** 'auto' settles the oldest first; a list settles exactly (in its own currency); null holds it on account. */
  allocate: 'auto' | Array<{ invoice_id: number; amount: number }> | null;
}

export interface PaymentResult {
  payment: { id: number; reference: string; unallocated: number };
  allocation: { allocated: string; count: number; errors: string[] };
}

export const recordPayment = (body: PaymentBody) => apiPost<PaymentResult>('/api/billing/payments', body);
export const unallocate = (allocationId: number) => apiDelete(`/api/billing/payments/allocations/${allocationId}`);

// ── dashboard ───────────────────────────────────────────────────────────

export interface Dashboard {
  base_currency: string;
  kpi: {
    outstanding: number;
    outstanding_count: number;
    overdue: number;
    overdue_count: number;
    draft: number;
    draft_count: number;
    billed_month: number;
    billed_month_count: number;
    received_month: number;
    received_today: number;
    received_today_count: number;
    unallocated: number;
    unallocated_count: number;
    credit_balance: number;
  };
  trend: Array<{ month: string; billed: number; received: number }>;
  aging: { current: number; '1_30': number; '31_60': number; '61_90': number; over_90: number; total: number };
  due_soon: Array<{ id: number; number: string; client: string | null; currency: string; due: number; due_date: string }>;
  most_overdue: Array<{ id: number; number: string; client: string | null; currency: string; due: number; due_date: string; days: number }>;
  upcoming_recurring: Array<{ id: number; name: string; client: string | null; next_run_on: string; frequency: string; due_now: boolean }>;
  recent: Array<{ subject_type: string; subject_id: number; kind: string; title: string; author: string | null; at: string }>;
}

export const fetchDashboard = (org: string, signal?: AbortSignal) => apiGet<Dashboard>('/api/billing/dashboard', withOrg(org), signal);

/** The ageing bar's five parts, oldest in red; each with its share of the whole (0–100). */
export function agingParts(a: Dashboard['aging'] | undefined): Array<{ key: string; label: string; value: number; pct: number; colour: string }> {
  const parts: Array<[string, string, string]> = [
    ['current', 'Not due', '#16A34A'],
    ['1_30', '1–30 days', '#D97706'],
    ['31_60', '31–60 days', '#EA580C'],
    ['61_90', '61–90 days', '#DC2626'],
    ['over_90', 'Over 90 days', '#9F1239'],
  ];
  const vals = parts.map(([k]) => Math.max(0, Number(a?.[k as keyof Dashboard['aging']] ?? 0)));
  const sum = vals.reduce((x, y) => x + y, 0);
  return parts.map(([key, label, colour], i) => ({ key, label, colour, value: vals[i]!, pct: sum > 0 ? (vals[i]! / sum) * 100 : 0 }));
}

// ── lookups ─────────────────────────────────────────────────────────────

export interface Customer {
  id: number;
  name: string;
  email: string | null;
  currency: string | null;
  outstanding: number;
  overdue: number;
  on_account: number;
}
export interface Tax {
  id: number;
  name: string;
  code: string | null;
  rate: number;
  kind: 'sales' | 'withholding';
  is_compound: boolean;
  is_default: boolean;
  active: boolean;
}
export interface Item {
  id: number;
  code: string | null;
  name: string;
  unit_price: number | string | null;
  unit: string | null;
}

export function useBillingOrgs() {
  return useQuery({ queryKey: K.orgs, queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; name: string; currency: string | null; role: string | null }> }>('/api/billing/organizations', undefined, signal).then((r) => r.items ?? []), staleTime: 300_000 });
}
export const searchCustomers = (q: string, org: string, signal?: AbortSignal) =>
  apiGet<{ customers: Customer[] }>('/api/billing/customers', withOrg(org, { q: q.trim() || undefined, per_page: 30 }), signal).then((r) => r.customers ?? []);
/** Sales taxes a line can carry (active ones); withholding is applied by the server on its own. */
export const fetchTaxes = (signal?: AbortSignal) => apiGet<{ taxes: Tax[] }>('/api/billing/taxes', undefined, signal).then((r) => (r.taxes ?? []).filter((t) => t.kind === 'sales' && t.active));
export const fetchSettings = (signal?: AbortSignal) => apiGet<{ settings: Record<string, string | number | boolean | null> }>('/api/billing/settings', undefined, signal).then((r) => r.settings ?? {});
export const fetchWarehouses = (signal?: AbortSignal) => apiGet<{ warehouses: Array<{ id: number; name: string; code?: string | null }> }>('/api/billing/warehouses', undefined, signal).then((r) => r.warehouses ?? []);
export const searchItems = (q: string, signal?: AbortSignal) => apiGet<{ items: Item[] }>('/api/billing/items', { q: q.trim() || undefined }, signal).then((r) => r.items ?? []);
export const searchBilling = (q: string, org: string, signal?: AbortSignal) =>
  apiGet<{ results: Array<{ type: 'invoice' | 'note' | 'payment' | 'customer'; id: number; title: string; subtitle: string | null; meta: string | null; status: string | null }> }>('/api/billing/search', withOrg(org, { q }), signal).then((r) => r.results ?? []);
/** People who can be the sale agent (needs `users.view`; without it the agent is the one raising it). */
export const fetchPeople = (signal?: AbortSignal) => apiGet<{ items: Array<{ id: number; name: string }> }>('/api/users', { per_page: 100 }, signal).then((r) => r.items ?? []);
/** A company's bank accounts (needs `finance.view`; without it the company's default is used). */
export const fetchBankAccounts = (org: number, signal?: AbortSignal) =>
  apiGet<{ accounts: Array<{ id: number; code: string | null; name: string; currency: string | null; is_default?: boolean }>; default_id?: number | null }>('/api/finance/bank-accounts', { company: org }, signal);

// ── working out ─────────────────────────────────────────────────────────

/** A line's amount before tax: quantity × rate, less its discount. The server's figures replace it once saved. */
export const lineNet = (l: Pick<InvoiceLine, 'quantity' | 'unit_price' | 'discount_pct'>) => {
  const v = Number(l.quantity || 0) * Number(l.unit_price || 0) * (1 - Math.min(100, Math.max(0, Number(l.discount_pct || 0))) / 100);
  return Math.round(v * 100) / 100;
};

/** The due date for a date and payment terms, as the server works it out. */
export const dueFor = (issue: string, termsDays: number) => (/^\d{4}-\d{2}-\d{2}$/.test(issue) ? addDays(issue, Math.max(0, Math.round(termsDays || 0))) : '');

/** An invoice's name in a list or a tab: its number, or "Draft" with the id until it is issued. */
export const invoiceName = (i: Pick<Invoice, 'id' | 'number'>) => i.number ?? `Draft #${i.id}`;

/** The open-invoice tabs: add (once, at the end) or remove one, keeping the rest in order. */
export function openTab(tabs: number[], id: number): number[] {
  return tabs.includes(id) ? tabs : [...tabs, id];
}
export function closeTab(tabs: number[], id: number): number[] {
  return tabs.filter((t) => t !== id);
}

/** The money in words the lists use: "LKR 1,840,000.00". */
export const amount = (n: number | null | undefined, currency?: string | null) =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : `${currency ? `${currency} ` : ''}${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
