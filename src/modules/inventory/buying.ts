import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { num, withOrg } from './api';
import { serialList } from './control';

/**
 * Buying (the "Inv" Purchasing, TradeSheet and Vendor designs): purchase
 * orders, the goods received against them, the requests that come before
 * them, and the vendors they are raised with. Vendors are shared across the
 * companies by decision; orders, receipts and requests belong to one each.
 *
 * Prices on an order are for whoever buys: the server masks unit costs for
 * anybody without `inventory.cost`, keeps an order's hidden costs when such
 * a person saves it, and never writes a vendor's bank details from them.
 */

type Q = Record<string, string | number | boolean | undefined>;
const bodyOrg = (org: string, body: object) => (org ? { org_id: Number(org), ...body } : body);

export const KB = {
  orders: (org: string, f: object) => ['inventory', 'pos', org, f] as const,
  order: (id: number) => ['inventory', 'po', id] as const,
  receipts: (org: string, f: object) => ['inventory', 'grns', org, f] as const,
  receipt: (id: number) => ['inventory', 'grn', id] as const,
  requests: (org: string, status: string) => ['inventory', 'prs', org, status] as const,
  vendors: (f: object) => ['inventory', 'vendors', f] as const,
  vendor: (id: number) => ['inventory', 'vendor', id] as const,
  vendorRecords: (id: number, org: string) => ['inventory', 'vendor-records', id, org] as const,
  vendorSearch: (q: string) => ['inventory', 'vendor-search', q] as const,
};

// ── purchase orders ─────────────────────────────────────────────────────

export const PO_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending: 'Awaiting approval',
  approved: 'Approved',
  sent: 'Sent',
  acknowledged: 'Vendor accepted',
  partial: 'Part received',
  received: 'Received',
  billed: 'Billed',
  cancelled: 'Cancelled',
  closed: 'Closed',
  posted: 'Posted',
  ordered: 'Ordered',
};
export const poTone = (s: string): 'grey' | 'amber' | 'blue' | 'green' | 'red' =>
  s === 'draft' || s === 'cancelled' || s === 'closed' ? 'grey' : s === 'pending' || s === 'partial' ? 'amber' : s === 'received' || s === 'posted' || s === 'billed' || s === 'ordered' ? 'green' : 'blue';

export interface PurchaseOrder {
  id: number | string;
  po_number: string;
  vendor_id: number | string;
  vendor: string | null;
  warehouse_id: number | string;
  warehouse: string | null;
  status: string;
  currency: string | null;
  order_date: string | null;
  expected_date: string | null;
  required_date: string | null;
  subtotal: number | string | null;
  tax_total: number | string | null;
  freight_cost: number | string | null;
  insurance_cost: number | string | null;
  duty_cost: number | string | null;
  other_charges: number | string | null;
  total: number | string | null;
  reference_no: string | null;
  vendor_quote_no: string | null;
  incoterms: string | null;
  shipping_method: string | null;
  payment_terms_days: number | string | null;
  priority: string | null;
  notes: string | null;
  created_by_name: string | null;
  approved_by_name?: string | null;
  vendor_response?: string | null;
  vendor_promised_date?: string | null;
  line_count?: number | string;
  outstanding_qty?: number | string;
  created_at: string;
}

export interface OrderLine {
  id: number | string;
  product_id: number | string | null;
  description: string;
  code: string | null;
  product_name: string | null;
  tracking: string | null;
  quantity: number | string;
  received_qty: number | string;
  unit: string | null;
  unit_cost: number | string | null;
  discount_pct: number | string;
  tax_rate: number | string;
  line_total: number | string | null;
}

export interface OrderDetail {
  order: PurchaseOrder;
  lines: OrderLine[];
  receipts: Array<{ id: number | string; grn_number: string; status: string; received_at: string | null; posted_at: string | null; total_value: number | string | null; vendor_invoice_no: string | null }>;
  editable: boolean;
  portal: { issued: boolean; expires: string | null; url: string | null };
}

export const PER = 30;

export const fetchOrders = (org: string, wh: number | null, f: { status: string; q: string; page: number; vendor?: number | null }, signal?: AbortSignal) =>
  apiGet<{ orders: PurchaseOrder[]; total: number }>(
    '/api/inventory/purchase-orders',
    withOrg(org, { status: f.status || undefined, q: f.q.trim() || undefined, vendor_id: f.vendor ?? undefined, ...(wh ? { warehouse_id: wh } : {}), page: f.page, per_page: PER } as Q),
    signal,
  ).then((r) => ({ rows: r.orders ?? [], total: num(r.total) ?? 0 }));
export const fetchOrder = (id: number, signal?: AbortSignal) => apiGet<OrderDetail>(`/api/inventory/purchase-orders/${id}`, undefined, signal);
export const saveOrder = (org: string, id: number | null, body: Record<string, unknown>) =>
  id ? apiPut<{ order: PurchaseOrder }>(`/api/inventory/purchase-orders/${id}`, body) : apiPost<{ order: PurchaseOrder }>('/api/inventory/purchase-orders', bodyOrg(org, body));
export const orderAct = (id: number, act: 'approve' | 'cancel' | 'receive' | 'pdf', body?: object) => apiPost<{ order?: PurchaseOrder; id?: number; file_id?: number; name?: string }>(`/api/inventory/purchase-orders/${id}/${act}`, body ?? {});
export const deleteOrder = (id: number) => apiDelete<unknown>(`/api/inventory/purchase-orders/${id}`);

/** What may be done to an order now. Receiving needs `inventory.purchase`; approving `inventory.approve`. */
export function orderActions(o: Pick<PurchaseOrder, 'status'>, received: number, c: { purchase: boolean; approve: boolean }) {
  const s = o.status;
  const open = s === 'draft' || s === 'pending';
  return {
    edit: c.purchase && open,
    approve: c.approve && open,
    receive: c.purchase && ['approved', 'sent', 'acknowledged', 'partial'].includes(s),
    cancel: c.purchase && !['cancelled', 'received', 'closed'].includes(s) && received <= 0,
    remove: c.purchase && (open || s === 'cancelled'),
  };
}

export interface POLineDraft {
  key: number;
  id: number | null;
  product: { id: number; code: string | null; name: string; variant_label?: string | null } | null;
  qty: string;
  cost: string;
}

export interface PODraft {
  vendor: { id: number; name: string } | null;
  warehouse: number | null;
  expected: string;
  reference: string;
  freight: string;
  insurance: string;
  duty: string;
  notes: string;
  lines: POLineDraft[];
}

const amountOf = (v: string) => {
  const t = v.replace(/,/g, '').trim();
  return t === '' ? null : Number(t);
};

/**
 * The body an order saves as. A blank unit cost is left out, so the server
 * uses the catalogue's (or, for someone who cannot see costs, keeps the
 * line's own) rather than reading a blank as free.
 */
export function orderBody(d: PODraft, canCost: boolean): { body: Record<string, unknown>; error: string | null } {
  if (!d.vendor) return { body: {}, error: 'Choose the vendor.' };
  if (!d.warehouse) return { body: {}, error: 'Choose where it is delivered.' };
  const charges: Record<string, number> = {};
  for (const [k, v, label] of [
    ['freight_cost', d.freight, 'Freight'],
    ['insurance_cost', d.insurance, 'Insurance'],
    ['duty_cost', d.duty, 'Duty'],
  ] as const) {
    const n = amountOf(v);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return { body: {}, error: `${label} must be a number, zero or more.` };
    charges[k] = n ?? 0;
  }
  const lines: Array<Record<string, unknown>> = [];
  for (const l of d.lines) {
    if (!l.product) continue;
    const q = amountOf(l.qty);
    if (q === null || !Number.isFinite(q) || q <= 0) return { body: {}, error: `Give “${l.product.name}” a quantity to order.` };
    const line: Record<string, unknown> = { id: l.id ?? undefined, product_id: l.product.id, quantity: q };
    if (canCost) {
      const c = amountOf(l.cost);
      if (c !== null && (!Number.isFinite(c) || c < 0)) return { body: {}, error: `The unit cost of “${l.product.name}” must be a number, zero or more.` };
      if (c !== null) line.unit_cost = c;
    }
    lines.push(line);
  }
  if (!lines.length) return { body: {}, error: 'Add at least one product.' };
  return {
    body: { vendor_id: d.vendor.id, warehouse_id: d.warehouse, expected_date: d.expected || null, reference_no: d.reference.trim() || null, notes: d.notes.trim() || null, ...charges, lines },
    error: null,
  };
}

// ── goods receipts ──────────────────────────────────────────────────────

export interface Receipt {
  id: number | string;
  grn_number: string;
  po_id: number | string | null;
  po_number: string | null;
  vendor: string | null;
  warehouse: string | null;
  warehouse_id: number | string;
  status: string;
  received_at: string | null;
  vendor_invoice_no: string | null;
  delivery_note_no: string | null;
  other_charges: number | string | null;
  total_value: number | string | null;
  notes: string | null;
  posted_at: string | null;
  line_count?: number | string;
}

export interface ReceiptLine {
  id: number | string;
  po_line_id: number | string | null;
  product_id: number | string;
  code: string | null;
  product_name: string;
  unit: string | null;
  tracking: string;
  quantity: number | string;
  rejected_qty: number | string;
  reject_reason: string | null;
  unit_cost: number | string | null;
  landed_cost: number | string | null;
  batch_no: string | null;
  expiry_date: string | null;
  serials: string | null;
  bin: string | null;
}

export const fetchReceipts = (org: string, wh: number | null, f: { status: string; page: number }, signal?: AbortSignal) =>
  apiGet<{ receipts: Receipt[]; total: number }>('/api/inventory/receipts', withOrg(org, { status: f.status || undefined, ...(wh ? { warehouse_id: wh } : {}), page: f.page, per_page: PER } as Q), signal).then((r) => ({
    rows: r.receipts ?? [],
    total: num(r.total) ?? 0,
  }));
export const fetchReceipt = (id: number, signal?: AbortSignal) => apiGet<{ receipt: Receipt; lines: ReceiptLine[] }>(`/api/inventory/receipts/${id}`, undefined, signal);
export const postReceipt = (id: number, body: Record<string, unknown>) => apiPost<{ receipt: Receipt; over_received: string[] }>(`/api/inventory/receipts/${id}/post`, body);
export const cancelReceipt = (id: number) => apiPost<unknown>(`/api/inventory/receipts/${id}/cancel`, {});

export const REJECT_REASONS = [
  { value: 'damaged', label: 'Damaged in transit' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'short_supply', label: 'Short supply' },
  { value: 'over_supply', label: 'Over-supplied' },
  { value: 'expired', label: 'Expired or too near expiry' },
  { value: 'quality', label: 'Quality' },
  { value: 'documentation', label: 'Paperwork' },
  { value: 'other', label: 'Other' },
];

export interface ReceiptLineDraft {
  accepted: string;
  rejected: string;
  reason: string;
  batch: string;
  expiry: string;
  serials: string;
}

/** The corrections a receipt posts with: what really came, what was turned away, batches and serials. */
export function receiptBody(h: { invoice: string; delivery: string; charges: string; notes: string }, lines: Array<{ line: ReceiptLine; d: ReceiptLineDraft }>): { body: Record<string, unknown>; error: string | null } {
  const charges = amountOf(h.charges);
  if (charges !== null && (!Number.isFinite(charges) || charges < 0)) return { body: {}, error: 'Freight and duty must be a number, zero or more.' };
  const out: Array<Record<string, unknown>> = [];
  for (const { line, d } of lines) {
    const name = line.product_name;
    const a = amountOf(d.accepted);
    const r = amountOf(d.rejected) ?? 0;
    if (a === null || !Number.isFinite(a) || a < 0) return { body: {}, error: `Say how many of “${name}” were accepted (0 or more).` };
    if (!Number.isFinite(r) || r < 0) return { body: {}, error: `The rejected quantity of “${name}” must be 0 or more.` };
    const row: Record<string, unknown> = { id: Number(line.id), quantity: a, rejected_qty: r };
    if (r > 0) row.reject_reason = d.reason || 'other';
    if (line.tracking === 'batch' && a > 0) {
      if (!d.batch.trim()) return { body: {}, error: `“${name}” is batch tracked — name the batch.` };
      row.batch_no = d.batch.trim();
      if (d.expiry) row.expiry_date = d.expiry;
    }
    if (line.tracking === 'serial' && a > 0) {
      const sn = serialList(d.serials);
      if (sn.length !== a) return { body: {}, error: `“${name}” is serialised: give ${a} serial ${a === 1 ? 'number' : 'numbers'}, one per unit (${sn.length} given).` };
      row.serials = sn;
    }
    out.push(row);
  }
  return { body: { vendor_invoice_no: h.invoice.trim() || null, delivery_note_no: h.delivery.trim() || null, other_charges: charges ?? 0, notes: h.notes.trim() || null, lines: out }, error: null };
}

// ── requests ────────────────────────────────────────────────────────────

export interface PurchaseRequest {
  id: number | string;
  reference: string;
  warehouse: string | null;
  status: string;
  source: string;
  needed_by: string | null;
  reason: string | null;
  requested_by_name: string | null;
  created_at: string;
  lines: Array<{ id: number | string; product_id: number | string; code: string | null; name: string; unit: string | null; quantity: number | string; ordered_qty: number | string; vendor: string | null; note: string | null }>;
}

export const fetchRequests = (org: string, status: string, signal?: AbortSignal) =>
  apiGet<{ requests: PurchaseRequest[] }>('/api/inventory/requests', withOrg(org, { status: status || undefined, per_page: 100 }), signal).then((r) => r.requests ?? []);
export const requestAct = (id: number, act: 'approve' | 'order') => apiPost<{ ids?: number[] }>(`/api/inventory/requests/${id}/${act}`, {});
export const requestsFromReplenishment = (org: string, wh: number | null) => apiPost<{ ids: number[] }>('/api/inventory/requests/from-replenishment', bodyOrg(org, wh ? { warehouse_id: wh } : {}));

// ── vendors ─────────────────────────────────────────────────────────────

export const VENDOR_TYPES = [
  { value: 'manufacturer', label: 'Manufacturer' },
  { value: 'distributor', label: 'Distributor' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'service', label: 'Service provider' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'importer', label: 'Importer' },
  { value: 'wholesaler', label: 'Wholesaler' },
  { value: 'retail', label: 'Retail supplier' },
];
export const vendorType = (t: string | null | undefined) => VENDOR_TYPES.find((x) => x.value === t)?.label ?? t ?? '—';
export const VENDOR_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'blacklisted', label: 'Blacklisted' },
];
export const vendorTone = (s: string): 'green' | 'grey' | 'red' => (s === 'active' ? 'green' : s === 'inactive' || s === 'archived' ? 'grey' : 'red');

export interface VendorRow {
  id: number;
  name: string;
  code: string | null;
  vendor_type: string | null;
  status: string;
  is_favourite: boolean;
  rating: number | null;
  email: string | null;
  phone: string | null;
  contact_person: string | null;
  city: string | null;
  payment_terms_days: number | null;
  lead_time_days: number | null;
  order_count: number;
  lapsed_documents: number;
  spend: number | null;
  currency: string | null;
}

export interface Vendor {
  id: number;
  name: string;
  code: string | null;
  legal_name: string | null;
  vendor_type: string | null;
  category: string | null;
  priority: string | null;
  tags: string | null;
  status: string;
  status_reason: string | null;
  rating: number | null;
  is_favourite: boolean;
  registration_no: string | null;
  tax_number: string | null;
  vat_number: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  mobile: string | null;
  currency: string | null;
  payment_terms_days: number | null;
  credit_days: number | null;
  credit_limit: number | null;
  payment_method: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  account_no: string | null;
  bank_swift: string | null;
  lead_time_days: number | null;
  min_order_value: number | null;
  incoterms: string | null;
  shipping_method: string | null;
  internal_notes: string | null;
}

export interface VendorDetail {
  vendor: Vendor;
  contacts: Array<{ id: number; name: string; job_title: string | null; department: string | null; email: string | null; phone: string | null; mobile: string | null; is_primary: boolean }>;
  addresses: Array<{ id: number; kind: string; label: string | null; street: string | null; city: string | null; country: string | null; is_default: boolean }>;
  documents: Array<{ id: number; kind: string; title: string; reference: string | null; expires_on: string | null; days_to_expiry: number | null; expired: boolean }>;
  compliance: { items: Array<{ key: string; label: string; state: string; date: string | null; days: number | null }>; expired: number; expiring: number };
  contract: { reference: string | null; start: string | null; end: string | null; value: number | null; state: string } | null;
  performance: { receipts: number; on_time_pct: number | null; avg_lead_days: number | null; reject_pct: number | null; rated_receipts: number };
  can: { edit: boolean; cost: boolean };
  trade?: { orders: number; open_orders: number; ordered_value: number; received_value: number; last_order: string | null };
}

export const fetchVendors = (f: { q: string; status: string; type: string; favourites: boolean; page: number }, signal?: AbortSignal) =>
  apiGet<{ vendors: VendorRow[]; total: number }>('/api/inventory/vendors', { q: f.q.trim() || undefined, status: f.status || undefined, type: f.type || undefined, favourites: f.favourites ? 1 : undefined, page: f.page, per_page: 50 }, signal).then(
    (r) => ({ rows: r.vendors ?? [], total: num(r.total) ?? 0 }),
  );
export const searchVendors = (q: string, signal?: AbortSignal) => apiGet<{ vendors: VendorRow[] }>('/api/inventory/vendors', { q: q.trim() || undefined, status: 'active', per_page: 30 }, signal).then((r) => r.vendors ?? []);
export const fetchVendor = (id: number, signal?: AbortSignal) => apiGet<VendorDetail>(`/api/inventory/vendors/${id}`, undefined, signal);
export const fetchVendorRecords = (id: number, org: string, signal?: AbortSignal) =>
  apiGet<{
    purchase_orders: Array<{ id: number | string; po_number: string; status: string; order_date: string | null; total: number | string | null; currency: string | null; warehouse: string | null }>;
    receipts: Array<{ id: number | string; grn_number: string; status: string; received_at: string | null; po_number: string | null }>;
    activity: Array<{ id: number | string; kind: string; summary: string; created_at: string; user: string | null }>;
  }>(`/api/inventory/vendors/${id}/records`, withOrg(org, { per_page: 25 }), signal);
export const saveVendor = (id: number | null, body: Record<string, unknown>) => (id ? apiPut<{ vendor: Vendor }>(`/api/inventory/vendors/${id}`, body) : apiPost<{ vendor: Vendor }>('/api/inventory/vendors', body));
export const archiveVendor = (id: number) => apiDelete<unknown>(`/api/inventory/vendors/${id}`);
export const checkDuplicates = (body: Record<string, unknown>) => apiPost<{ matches: Array<{ vendor_id: number; name: string; code: string | null; confidence: string; reasons: string[] }> }>('/api/inventory/vendors/check-duplicates', body);

/** The vendor fields the form edits, as text. */
export const VENDOR_TEXT = [
  'name',
  'code',
  'legal_name',
  'category',
  'tags',
  'registration_no',
  'tax_number',
  'vat_number',
  'email',
  'website',
  'phone',
  'mobile',
  'currency',
  'payment_method',
  'bank_name',
  'bank_branch',
  'account_no',
  'bank_swift',
  'incoterms',
  'shipping_method',
  'status_reason',
  'internal_notes',
] as const;
export const VENDOR_NUMBERS = ['payment_terms_days', 'credit_days', 'credit_limit', 'lead_time_days', 'min_order_value'] as const;
export const VENDOR_MONEY_HIDDEN = ['credit_limit', 'bank_name', 'bank_branch', 'account_no', 'bank_swift'] as const;

export type VendorForm = Record<(typeof VENDOR_TEXT)[number] | (typeof VENDOR_NUMBERS)[number] | 'vendor_type' | 'status' | 'priority', string>;

export function vendorForm(v?: Partial<Vendor> | null): VendorForm {
  const f = {} as VendorForm;
  for (const k of VENDOR_TEXT) f[k] = (v?.[k as keyof Vendor] as string | null | undefined) ?? '';
  for (const k of VENDOR_NUMBERS) {
    const n = v?.[k as keyof Vendor];
    f[k] = n === null || n === undefined ? '' : String(n);
  }
  f.vendor_type = v?.vendor_type ?? 'supplier';
  f.status = v?.status ?? 'active';
  f.priority = v?.priority ?? 'normal';
  if (!v) f.currency = '';
  return f;
}

/**
 * Only what changed, so a save never writes a field back as it came — above
 * all, never a masked (blank) bank detail over the real one. The server now
 * refuses those from anybody who cannot see them; this keeps the rest honest.
 */
export function vendorChanges(before: VendorForm, after: VendorForm, canCost: boolean): { body: Record<string, unknown>; error: string | null } {
  if (!after.name.trim()) return { body: {}, error: 'Give the vendor a name.' };
  const body: Record<string, unknown> = {};
  for (const k of Object.keys(after) as Array<keyof VendorForm>) {
    if (!canCost && (VENDOR_MONEY_HIDDEN as readonly string[]).includes(k)) continue;
    if (after[k] === before[k]) continue;
    if ((VENDOR_NUMBERS as readonly string[]).includes(k)) {
      const n = amountOf(after[k]);
      if (n !== null && (!Number.isFinite(n) || n < 0)) return { body: {}, error: `${k.replace(/_/g, ' ')} must be a number, zero or more.` };
      body[k] = n;
    } else body[k] = after[k].trim() === '' ? null : after[k].trim();
  }
  return { body, error: null };
}
