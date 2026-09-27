import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../core/api';

/**
 * Sales & Orders (the server's OMS module, "12 · Orders (OMS)" designs).
 *
 * An order is Inventory's sales order: Inventory creates it, confirms it
 * (reserving stock), delivers, invoices and cancels it. OMS adds approval,
 * the statuses between, assignment, the timeline, the boards and reports.
 * So a write goes where it is done properly:
 *
 * - approval only through `submit` / `approve` / `reject` — never a plain
 *   status change to pending_approval / approved / rejected, which the
 *   server lets through without building or checking the approval chain;
 * - confirming and cancelling through Inventory (`/confirm` reserves stock,
 *   `/cancel` releases it); OMS refuses the one and does not release on the
 *   other;
 * - every other status move through `transition`, as `next_states` allows.
 *
 * `?org=` narrows to companies (a CSV of ids; empty = every company of mine).
 */
export type Status =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'confirmed'
  | 'processing'
  | 'ready_for_fulfillment'
  | 'fulfilled'
  | 'shipped'
  | 'out_for_delivery'
  | 'partial'
  | 'delivered'
  | 'invoiced'
  | 'completed'
  | 'cancelled'
  | 'returned'
  | 'closed';

/** Label, light chip, dark chip, and the dot's colour — the design's palette. */
export const STATUS: Record<Status, { label: string; chip: string; dot: string }> = {
  draft: { label: 'Draft', chip: 'bg-[#F1F2F6] text-[#4A5168] dark:bg-[#1B2542] dark:text-[#C9CFE6]', dot: '#94A3B8' },
  pending_approval: { label: 'Pending approval', chip: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning', dot: '#D97706' },
  approved: { label: 'Approved', chip: 'bg-[#E0F2FE] text-[#075985] dark:bg-[#0C2A3D] dark:text-[#7DD3FC]', dot: '#0EA5E9' },
  rejected: { label: 'Rejected', chip: 'bg-[#FFE4E6] text-[#9F1239] dark:bg-danger-bg dark:text-danger', dot: '#E11D48' },
  confirmed: { label: 'Confirmed', chip: 'bg-[#DBEAFE] text-[#1E40AF] dark:bg-[#16203E] dark:text-[#93B4FF]', dot: '#2563EB' },
  processing: { label: 'Processing', chip: 'bg-[#DBEAFE] text-[#1E40AF] dark:bg-[#16203E] dark:text-[#93B4FF]', dot: '#2563EB' },
  ready_for_fulfillment: { label: 'Ready for fulfilment', chip: 'bg-[#E0E7FF] text-[#3730A3] dark:bg-[#1E1B4B] dark:text-[#A5B4FC]', dot: '#4F46E5' },
  fulfilled: { label: 'Fulfilled', chip: 'bg-[#E0E7FF] text-[#3730A3] dark:bg-[#1E1B4B] dark:text-[#A5B4FC]', dot: '#4F46E5' },
  shipped: { label: 'Shipped', chip: 'bg-[#EDE9FE] text-[#5B21B6] dark:bg-[#2A1F4A] dark:text-[#C4B5FD]', dot: '#7C3AED' },
  out_for_delivery: { label: 'Out for delivery', chip: 'bg-[#EDE9FE] text-[#5B21B6] dark:bg-[#2A1F4A] dark:text-[#C4B5FD]', dot: '#7C3AED' },
  partial: { label: 'Partly delivered', chip: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning', dot: '#D97706' },
  delivered: { label: 'Delivered', chip: 'bg-[#DCFCE7] text-[#166534] dark:bg-success-bg dark:text-success', dot: '#16A34A' },
  invoiced: { label: 'Invoiced', chip: 'bg-[#DCFCE7] text-[#166534] dark:bg-success-bg dark:text-success', dot: '#16A34A' },
  completed: { label: 'Completed', chip: 'bg-[#DCFCE7] text-[#166534] dark:bg-success-bg dark:text-success', dot: '#16A34A' },
  cancelled: { label: 'Cancelled', chip: 'bg-[#F1F2F6] text-[#4A5168] dark:bg-[#1B2542] dark:text-[#C9CFE6]', dot: '#94A3B8' },
  returned: { label: 'Returned', chip: 'bg-[#FFE4E6] text-[#9F1239] dark:bg-danger-bg dark:text-danger', dot: '#E11D48' },
  closed: { label: 'Closed', chip: 'bg-[#F1F2F6] text-[#4A5168] dark:bg-[#1B2542] dark:text-[#C9CFE6]', dot: '#94A3B8' },
};
export const statusOf = (s: string | null | undefined) => STATUS[(s ?? 'draft') as Status] ?? { label: s ?? '—', chip: STATUS.draft.chip, dot: STATUS.draft.dot };

/** Still moving through the pipeline (the rail's "waiting on us"). */
export const MOVING: Status[] = ['draft', 'confirmed', 'processing', 'ready_for_fulfillment', 'shipped', 'out_for_delivery', 'partial'];
/** Out of the pipeline, one way or another. */
export const FINISHED: Status[] = ['delivered', 'invoiced', 'completed', 'cancelled'];

export const SOURCE: Record<string, string> = { manual: 'Manual', woocommerce: 'Shop', crm: 'CRM', api: 'API', import: 'Imported', quote: 'Quote', pos: 'Till' };
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Order {
  id: number;
  number: string;
  org_id: number | null;
  client_id: number | null;
  client: string | null;
  warehouse_id: number | null;
  status: Status;
  status_label: string;
  order_type: string | null;
  priority: Priority;
  source: string;
  source_ref: string | null;
  sales_user: string | null;
  assigned_to: number | null;
  assigned_name: string | null;
  order_date: string | null;
  expected_date: string | null;
  currency: string;
  total: number;
  payment_status: string | null;
  line_count: number;
  approved_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
}

export interface OrderLine {
  id: number;
  product_id: number | null;
  product: string;
  code: string | null;
  description: string | null;
  quantity: number;
  reserved_qty: number;
  delivered_qty: number;
  invoiced_qty: number;
  unit_price: number;
  line_total: number;
}

export interface ApprovalStep {
  step: number;
  permission: string;
  decision: 'pending' | 'approved' | 'rejected' | string;
  by: string | null;
  reason: string | null;
  at: string | null;
}

export interface OrderDetail extends Order {
  notes: string | null;
  terms: string | null;
  ship_to: string | null;
  subtotal: number;
  discount_total: number;
  coupon_code: string | null;
  coupon_discount: number;
  tax_total: number;
  shipping: number;
  payment_method: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  lines: OrderLine[];
  next_states: Array<{ status: Status; label: string; needs: string }>;
  /**
   * Confirming, which is Inventory's: whether it is next, whether I may, and why not. Sent by a server
   * with the 2026-09-27 Orders fixes (LHCP 3c0f3881), which also leaves `confirmed` out of `next_states`
   * and releases the stock when an order is cancelled through Orders.
   */
  confirm?: { endpoint: string; allowed: boolean; why: string | null } | null;
  approval: { steps: ApprovalStep[]; mine: boolean };
  integrations: Array<{ module: string; operation: string; status: string; external_id: string | null; error: string | null; retries: number; at: string | null }>;
  links: { deliveries: Array<{ id: number; dn_number: string; status: string; delivered_at: string | null }>; invoices: Array<{ id: number; number: string; status: string; total: number; issue_date: string | null }> };
}

export interface TimelineEvent {
  id: number;
  type: string;
  source: string | null;
  user: string | null;
  description: string | null;
  reference: string | null;
  at: string;
}

export interface Overview {
  sources: Array<{ source: string; count: number; value: number }>;
  stages: Array<{ status: Status; label: string; count: number; value: number }>;
  exits: Array<{ status: Status; label: string; count: number; value: number }>;
  recent: Array<{ id: number; number: string; status: Status; status_label: string; client: string | null; total: number; currency: string; date: string | null; priority: Priority }>;
  attention: { pending_approval: number; unassigned: number; stale: number; integration_failures: number };
  total: number;
  today: number;
  draft: number;
  pending_approval: number;
  delivered: number;
  completed: number;
  cancelled: number;
  returned: number;
  open_by_currency: Array<{ currency: string; orders: number; value: number }>;
  completed_by_currency: Array<{ currency: string; orders: number; value: number }>;
}

export interface BoardOrder {
  id: number;
  number: string;
  status: Status;
  status_label: string;
  priority: Priority;
  client: string | null;
  assigned_name: string | null;
  warehouse: string | null;
  order_date: string | null;
  expected_date: string | null;
  total: number;
  currency: string;
  outstanding_lines: number;
}
export interface BoardNote {
  id: number;
  number: string;
  status: string;
  order_id: number;
  order_number: string;
  client: string | null;
  priority: Priority;
  carrier: string | null;
  tracking_no: string | null;
  vehicle: string | null;
  driver: string | null;
  dispatched_at: string | null;
  delivery_date: string | null;
  ship_to: string | null;
  line_count: number;
}
export interface Fulfilment {
  board: { to_pick: BoardOrder[]; to_dispatch: BoardNote[]; in_transit: BoardNote[]; counts: Record<string, number> };
}

export interface ReturnRow {
  id: number;
  reference: string;
  status: string;
  reason: string | null;
  settlement: string | null;
  client: string | null;
  order_number: string | null;
  invoice_number: string | null;
  credit_note_number: string | null;
  return_date: string | null;
  received_at: string | null;
  settled_at: string | null;
  total_value: number;
  line_count: number;
}
export interface Returns {
  board: { to_approve: ReturnRow[]; to_receive: ReturnRow[]; to_credit: ReturnRow[]; settled: ReturnRow[]; no_document: Array<{ id: number; number: string; client: string | null; total: number; currency: string }>; counts: Record<string, number> };
}

export interface ListFilters {
  status?: string;
  source?: string;
  priority?: string;
  q?: string;
  mine?: boolean;
  page?: number;
  perPage?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export const K = {
  all: ['sales'] as const,
  overview: (org: string) => ['sales', 'overview', org] as const,
  orders: (org: string, f: ListFilters) => ['sales', 'orders', org, f] as const,
  order: (id: number) => ['sales', 'order', id] as const,
  timeline: (id: number) => ['sales', 'order', id, 'timeline'] as const,
  fulfilment: (org: string) => ['sales', 'fulfilment', org] as const,
  returns: (org: string) => ['sales', 'returns', org] as const,
  orgs: ['sales', 'orgs'] as const,
};

const withOrg = (org: string, rest: Record<string, string | number | undefined> = {}) => ({ ...(org ? { org } : {}), ...rest });

export function useOverview(org: string) {
  return useQuery({ queryKey: K.overview(org), queryFn: ({ signal }) => apiGet<{ overview: Overview }>('/api/oms/overview', withOrg(org), signal).then((r) => r.overview), refetchInterval: 30_000 });
}

export function useOrgs() {
  return useQuery({ queryKey: K.orgs, queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; name: string; currency: string | null; role: string | null }> }>('/api/oms/organizations', undefined, signal).then((r) => r.items ?? []), staleTime: 300_000 });
}

export function fetchOrders(org: string, f: ListFilters, signal?: AbortSignal) {
  return apiGet<{ orders: Order[]; total: number; page: number; per_page: number }>(
    '/api/oms/orders',
    withOrg(org, {
      status: f.status || undefined,
      source: f.source || undefined,
      priority: f.priority || undefined,
      q: f.q || undefined,
      mine: f.mine ? 1 : undefined,
      page: f.page ?? 1,
      per_page: f.perPage ?? 50,
      sort: f.sort,
      dir: f.dir,
    }),
    signal,
  );
}

export const fetchOrder = (id: number, signal?: AbortSignal) => apiGet<{ order: OrderDetail }>(`/api/oms/orders/${id}`, undefined, signal).then((r) => r.order);
export const fetchTimeline = (id: number, signal?: AbortSignal) => apiGet<{ events: TimelineEvent[] }>(`/api/oms/orders/${id}/timeline`, undefined, signal).then((r) => r.events ?? []);

// ── writes ────────────────────────────────────────────────────────────────

export const submit = (id: number) => apiPost<{ status: Status }>(`/api/oms/orders/${id}/submit`, {});
export const approve = (id: number, reason?: string) => apiPost<{ status: Status }>(`/api/oms/orders/${id}/approve`, reason ? { reason } : {});
export const reject = (id: number, reason: string) => apiPost<{ status: Status }>(`/api/oms/orders/${id}/reject`, { reason });
/** Inventory's confirm: reserves the stock. Answers which lines were short. */
export const confirm = (id: number) => apiPost<{ short?: string[] }>(`/api/inventory/sales-orders/${id}/confirm`, {});
/** Inventory's cancel: releases what was reserved; refused once anything was delivered. */
export const cancel = (id: number) => apiPost(`/api/inventory/sales-orders/${id}/cancel`, {});
/** Inventory's invoice: a draft invoice in Billing for what was delivered (stocked lines) or ordered (the rest), not yet invoiced. */
export const raiseInvoice = (id: number) => apiPost<{ invoice_id: number; lines: number }>(`/api/inventory/sales-orders/${id}/invoice`, {});

const UNBILLED_BEFORE = new Set<string>(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled']);

/**
 * Whether to offer "Raise invoice": a confirmed order with something not yet
 * invoiced, for someone who may raise invoices. What is billable — delivered
 * stock, ordered services — is the server's to say, and it says so when
 * nothing has been delivered yet.
 */
export function mayInvoice(o: Pick<OrderDetail, 'status' | 'lines'>, perms: readonly string[] | undefined): boolean {
  const has = (p: string) => !!perms && (perms.includes('*') || perms.includes(p));
  const allowed = has('inventory.manage') || (has('inventory.sell') && has('billing.invoice'));
  return allowed && !UNBILLED_BEFORE.has(o.status) && o.lines.some((l) => l.invoiced_qty < l.quantity);
}
export const transition = (id: number, status: Status) => apiPost<{ status: Status }>(`/api/oms/orders/${id}/transition`, { status });
export const assign = (id: number, userId: number, role: 'order' | 'sales' | 'fulfilment' | 'delivery' = 'order') => apiPost(`/api/oms/orders/${id}/assign`, { user_id: userId, role });
export const bulk = (ids: number[], action: 'status' | 'priority' | 'delete', value?: string) =>
  apiPost<{ done: number; failed: Array<{ id: number; number: string; why: string }> }>('/api/oms/orders/bulk', { action, ids, ...(action === 'status' ? { status: value } : action === 'priority' ? { priority: value } : {}) });
export const bulkAssign = (ids: number[], userId: number) => apiPost<{ assigned: number; failed: Array<{ id: number; number: string; why: string }> }>('/api/oms/orders/bulk-assign', { ids, user_id: userId, role: 'order' });

/**
 * Where an order may go from here, as buttons: what the server offers this
 * caller, less the approval moves (only submit / approve / reject may make
 * those) and with confirm and cancel sent through Inventory.
 */
export type Move = { status: Status; label: string; via: 'inventory-confirm' | 'inventory-cancel' | 'transition'; disabled?: string | null };
export function movesFor(o: Pick<OrderDetail, 'next_states' | 'confirm'>): Move[] {
  // A server that sends `confirm` cancels properly through Orders (it releases the stock, and the timeline says so).
  const fixed = o.confirm !== undefined;
  const moves: Move[] = (o.next_states ?? [])
    .filter((n) => n.status !== 'pending_approval' && n.status !== 'approved' && n.status !== 'rejected' && !(fixed && n.status === 'confirmed'))
    .map((n) => ({ status: n.status, label: n.label || statusOf(n.status).label, via: n.status === 'confirmed' ? 'inventory-confirm' : n.status === 'cancelled' && !fixed ? 'inventory-cancel' : 'transition' }));
  if (o.confirm) moves.unshift({ status: 'confirmed', label: 'Confirm', via: 'inventory-confirm', disabled: o.confirm.allowed ? null : (o.confirm.why ?? 'Not yours to confirm') });
  return moves;
}

/** Which statuses a bulk status change may set: never an approval one (see above), never confirm or cancel (Inventory's). */
export const BULK_STATUSES: Status[] = ['processing', 'ready_for_fulfillment', 'shipped', 'out_for_delivery', 'completed'];

export const assignees = () => apiGet<{ assignees: Array<{ id: number; name: string }> }>('/api/oms/assignees').then((r) => r.assignees ?? []);

// Fulfilment and returns: the boards are OMS's, the writes are Inventory's.
export const fetchFulfilment = (org: string, signal?: AbortSignal) => apiGet<Fulfilment>('/api/oms/fulfilment', withOrg(org), signal);
export const fetchReturns = (org: string, signal?: AbortSignal) => apiGet<Returns>('/api/oms/returns', withOrg(org), signal);
export const raiseDelivery = (orderId: number, body: Record<string, unknown> = {}) => apiPost<{ id: number }>(`/api/inventory/sales-orders/${orderId}/deliver`, body);
export const dispatchNote = (noteId: number, body: Record<string, unknown> = {}) => apiPost(`/api/inventory/deliveries/${noteId}/dispatch`, body);
export const cancelNote = (noteId: number) => apiPost(`/api/inventory/deliveries/${noteId}/cancel`, {});
export const deliveredNote = (noteId: number, receivedBy?: string) => apiPost(`/api/inventory/deliveries/${noteId}/delivered`, receivedBy ? { received_by: receivedBy } : {});
export const approveReturn = (id: number) => apiPost(`/api/inventory/sales-returns/${id}/approve`, {});
export const receiveReturn = (id: number) => apiPost(`/api/inventory/sales-returns/${id}/receive`, {});
export const creditReturn = (id: number) => apiPost(`/api/inventory/sales-returns/${id}/credit-note`, {});

// Building an order.
export interface ProductHit {
  id: number;
  code: string | null;
  barcode: string | null;
  name: string;
  variant_label: string | null;
  unit: string | null;
  unit_price: number;
  tax_rate: number | null;
  tracking: string | null;
  is_stocked: boolean;
  kind: string | null;
  on_hand: number | null;
  reserved: number | null;
}
export const lookupProducts = (q: string, warehouseId: number | null, signal?: AbortSignal) =>
  apiGet<{ products: ProductHit[]; exact: boolean }>('/api/inventory/products/lookup', { q, ...(warehouseId ? { warehouse_id: warehouseId } : {}) }, signal);
export const scanUnit = (code: string, warehouseId: number | null, signal?: AbortSignal) =>
  apiGet<{ found: boolean; ambiguous?: boolean; unit?: { id: number; serial_no: string; product_id: number; product: string | null; product_code: string | null; warehouse: string | null; status: string } | null; sellable?: boolean; why?: string | null }>('/api/inventory/scan', { code, ...(warehouseId ? { warehouse: warehouseId } : {}) }, signal);
export const warehouses = (signal?: AbortSignal) => apiGet<{ warehouses: Array<{ id: number; name: string; code?: string | null; org_id?: number | null; is_default?: boolean | number }> }>('/api/inventory/warehouses', undefined, signal).then((r) => r.warehouses ?? []);
export const customers = (q: string, signal?: AbortSignal) =>
  apiGet<{ accounts: Array<{ id: number; name: string; email?: string | null; phone?: string | null; account_type?: string | null }> }>('/api/crm/accounts', { q, per_page: 20 }, signal).then((r) => r.accounts ?? []);
export const createOrder = (body: Record<string, unknown>) => apiPost<{ order: { id: number; so_number?: string } }>('/api/inventory/sales-orders', body);

/** The day's date as the server reads a date: YYYY-MM-DD, local. */
/** Orders' general defaults (`oms_default_priority`, `…_warehouse` as an id, `…_currency`, …), as the New order form starts from them. */
export const orderDefaults = (org: string, signal?: AbortSignal) => apiGet<{ settings: Record<string, string> }>('/api/oms/settings', withOrg(org), signal).then((r) => r.settings ?? {});
export const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
