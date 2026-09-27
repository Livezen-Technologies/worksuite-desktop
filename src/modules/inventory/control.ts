import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { num, REASON_LABEL, withOrg } from './api';

/**
 * Inventory's control documents (the "Inv" Adjustments, Transfers, Counts
 * and Tracked designs): adjustments, transfers between warehouses, stock
 * counts, and batches and serial units — plus opening stock.
 *
 * Every document moves through statuses on the server, which decides what is
 * allowed; the helpers here only decide which buttons to offer, so a refusal
 * is the exception rather than the way the screen finds out. Approval is a
 * setting (`require_adjustment_approval`, `require_transfer_approval`) the
 * detail view reports as `needs_approval`.
 */

type Q = Record<string, string | number | boolean | undefined>;
const bodyOrg = (org: string, body: object) => (org ? { org_id: Number(org), ...body } : body);

export const KC = {
  adjustments: (org: string, f: object) => ['inventory', 'adjustments', org, f] as const,
  adjustment: (id: number) => ['inventory', 'adjustment', id] as const,
  transfers: (org: string, f: object) => ['inventory', 'transfers', org, f] as const,
  transfer: (id: number) => ['inventory', 'transfer', id] as const,
  counts: (org: string, f: object) => ['inventory', 'counts', org, f] as const,
  count: (id: number) => ['inventory', 'count', id] as const,
  batches: (org: string, f: object) => ['inventory', 'batches', org, f] as const,
  serials: (org: string, f: object) => ['inventory', 'serials', org, f] as const,
  expiring: (org: string, days: number) => ['inventory', 'expiring', org, days] as const,
  serial: (id: number) => ['inventory', 'serial', id] as const,
  lookup: (org: string, q: string, wh: number | null) => ['inventory', 'lookup', org, q, wh] as const,
  productBatches: (id: number) => ['inventory', 'product-batches', id] as const,
};

// ── statuses ────────────────────────────────────────────────────────────

export const DOC_STATUS: Record<string, { label: string; tone: 'grey' | 'amber' | 'blue' | 'green' | 'red' }> = {
  draft: { label: 'Draft', tone: 'grey' },
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', tone: 'blue' },
  rejected: { label: 'Rejected', tone: 'red' },
  posted: { label: 'Posted', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
  in_transit: { label: 'In transit', tone: 'blue' },
  received: { label: 'Received', tone: 'green' },
  counting: { label: 'Counting', tone: 'amber' },
  review: { label: 'Review', tone: 'amber' },
};
export const docStatus = (s: string | null | undefined) => DOC_STATUS[s ?? ''] ?? { label: (s ?? '—').replace(/_/g, ' '), tone: 'grey' as const };

/** The reasons someone may choose; "Stock count" and "Opening balance" are the system's own. */
export const REASONS = ['damage', 'loss', 'theft', 'manual', 'expired', 'revaluation', 'found'].map((id) => ({ id, label: REASON_LABEL[id] ?? id }));
export const reasonLabel = (r: string | null | undefined) => (r ? (REASON_LABEL[r] ?? r) : '—');

export const COUNT_KINDS = [
  { id: 'random', label: 'Random sample' },
  { id: 'cycle', label: 'Cycle count' },
  { id: 'physical', label: 'Full physical count' },
  { id: 'spot', label: 'Spot check' },
] as const;
export const countKind = (k: string | null | undefined) => COUNT_KINDS.find((x) => x.id === k)?.label ?? k ?? '—';

// ── lines ───────────────────────────────────────────────────────────────

/** A product as a document line picks it (`/products/lookup`). */
export interface Pickable {
  id: number;
  code: string | null;
  barcode: string | null;
  name: string;
  variant_label: string | null;
  unit: string | null;
  tracking: 'none' | 'batch' | 'serial';
  is_stocked: number | string | boolean;
  on_hand: number | string;
  reserved: number | string;
}

export const lookupProducts = (org: string, q: string, wh: number | null, signal?: AbortSignal) =>
  apiGet<{ products: Pickable[] }>('/api/inventory/products/lookup', withOrg(org, { q, ...(wh ? { warehouse_id: wh } : {}) }), signal).then((r) => (r.products ?? []).filter((p) => !!Number(p.is_stocked)));

export const pickName = (p: { name: string; variant_label?: string | null }) => `${p.name}${p.variant_label ? ` — ${p.variant_label}` : ''}`;

/** Serial numbers typed or scanned: one per line, or separated by commas, semicolons or tabs. */
export function serialList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,;\t]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

// ── adjustments ─────────────────────────────────────────────────────────

export interface Adjustment {
  id: number;
  reference: string;
  warehouse_id: number;
  warehouse: string | null;
  reason: string;
  status: string;
  note: string | null;
  total_value: number | string | null;
  adjusted_at: string | null;
  created_by: number | string;
  created_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  posted_at: string | null;
  reverses_id: number | string | null;
  line_count: number | string;
  created_at: string;
}

export interface AdjustmentLine {
  id: number;
  product_id: number;
  code: string | null;
  name: string;
  variant_label: string | null;
  unit: string | null;
  tracking: string;
  bin: string | null;
  batch_no: string | null;
  serial_no: string | null;
  quantity: number | string;
  unit_cost: number | string | null;
  value: number | string | null;
  note: string | null;
}

export interface AdjustmentDetail {
  adjustment: Adjustment;
  lines: AdjustmentLine[];
  needs_approval: boolean;
  can_approve: boolean;
}

export interface DocFilters {
  status: string;
  q: string;
  page: number;
}

export const PER = 30;

export const fetchAdjustments = (org: string, wh: number | null, f: DocFilters, signal?: AbortSignal) =>
  apiGet<{ adjustments: Adjustment[]; total: number }>('/api/inventory/adjustments', withOrg(org, { status: f.status || undefined, q: f.q.trim() || undefined, ...(wh ? { warehouse_id: wh } : {}), page: f.page, per_page: PER } as Q), signal).then(
    (r) => ({ rows: r.adjustments ?? [], total: num(r.total) ?? 0 }),
  );
export const fetchAdjustment = (id: number, signal?: AbortSignal) => apiGet<AdjustmentDetail>(`/api/inventory/adjustments/${id}`, undefined, signal);
export const saveAdjustment = (org: string, id: number | null, body: Record<string, unknown>) =>
  id ? apiPut<{ adjustment: Adjustment }>(`/api/inventory/adjustments/${id}`, body) : apiPost<{ adjustment: Adjustment }>('/api/inventory/adjustments', bodyOrg(org, body));
export const adjustmentAct = (id: number, act: 'submit' | 'approve' | 'reject' | 'post' | 'reverse', body?: object) => apiPost<{ adjustment?: Adjustment; id?: number }>(`/api/inventory/adjustments/${id}/${act}`, body ?? {});
export const deleteAdjustment = (id: number) => apiDelete<unknown>(`/api/inventory/adjustments/${id}`);

/**
 * What may be done to an adjustment now. `mine` is whether the reader raised
 * it: the server refuses self-approval unless they hold `inventory.manage`.
 */
export function adjustmentActions(a: Pick<Adjustment, 'status' | 'reverses_id'>, o: { needsApproval: boolean; canApprove: boolean; canAdjust: boolean; mine: boolean; manage: boolean }) {
  const s = a.status;
  const approveOk = o.canApprove && (!o.mine || o.manage);
  return {
    edit: o.canAdjust && (s === 'draft' || s === 'rejected'),
    submit: o.canAdjust && o.needsApproval && (s === 'draft' || s === 'rejected'),
    approve: approveOk && s === 'pending',
    reject: o.canApprove && s === 'pending',
    post: o.canAdjust && (o.needsApproval ? s === 'approved' : ['draft', 'pending', 'approved'].includes(s)),
    reverse: o.canAdjust && s === 'posted' && !num(a.reverses_id),
    remove: o.canAdjust && s !== 'posted',
    /** Why Approve is missing when it would otherwise show. */
    selfNote: o.canApprove && s === 'pending' && o.mine && !o.manage,
  };
}

/** A line's worth: what it posted at, or before posting what it is expected to be. */
export function lineWorth(l: Pick<AdjustmentLine, 'quantity' | 'unit_cost' | 'value'>, posted: boolean): number | null {
  const q = num(l.quantity) ?? 0;
  if (posted) return num(l.value);
  const c = num(l.unit_cost);
  return c === null ? null : Math.round(q * c * 100) / 100;
}

export interface DraftLine {
  key: number;
  product: Pickable | null;
  qty: string;
  note: string;
  batch: string;
  expiry: string;
  serials: string;
}

export const newLine = (key: number): DraftLine => ({ key, product: null, qty: '', note: '', batch: '', expiry: '', serials: '' });

/**
 * The body an adjustment saves as, or why it cannot. A batch-tracked line
 * names its batch; a serialised line names one serial per unit, and the
 * server spreads it into a line per unit.
 */
export function adjustmentBody(h: { warehouse: number | null; reason: string; note: string }, lines: DraftLine[]): { body: Record<string, unknown>; error: string | null } {
  if (!h.warehouse) return { body: {}, error: 'Choose the warehouse.' };
  const out: Array<Record<string, unknown>> = [];
  for (const l of lines) {
    if (!l.product) continue;
    const q = Number(l.qty.replace(/,/g, '').replace('−', '-').trim());
    const name = pickName(l.product);
    if (!l.qty.trim() || !Number.isFinite(q) || q === 0) return { body: {}, error: `Give “${name}” a quantity: negative writes stock off, positive brings it on.` };
    const line: Record<string, unknown> = { product_id: l.product.id, quantity: q, note: l.note.trim() || null };
    if (l.product.tracking === 'batch') {
      if (!l.batch.trim()) return { body: {}, error: `“${name}” is batch tracked — name the batch.` };
      line.batch_no = l.batch.trim();
      if (l.expiry && q > 0) line.expiry_date = l.expiry;
    }
    if (l.product.tracking === 'serial') {
      const sn = serialList(l.serials);
      if (sn.length !== Math.abs(q)) return { body: {}, error: `“${name}” is serialised: give ${Math.abs(q)} serial ${Math.abs(q) === 1 ? 'number' : 'numbers'}, one per unit (${sn.length} given).` };
      line.serials = sn;
    }
    out.push(line);
  }
  if (!out.length) return { body: {}, error: 'Add at least one product.' };
  return { body: { warehouse_id: h.warehouse, reason: h.reason, note: h.note.trim() || null, lines: out }, error: null };
}

// ── transfers ───────────────────────────────────────────────────────────

export interface Transfer {
  id: number;
  reference: string;
  from_warehouse_id: number | string;
  to_warehouse_id: number | string;
  from_warehouse: string | null;
  to_warehouse: string | null;
  status: string;
  transfer_date: string | null;
  expected_date: string | null;
  shipped_at: string | null;
  received_at: string | null;
  carrier: string | null;
  tracking_no: string | null;
  vehicle: string | null;
  driver: string | null;
  note: string | null;
  created_by_name: string | null;
  line_count: number | string;
  total_qty: number | string;
  created_at: string;
}

export interface TransferLine {
  id: number;
  product_id: number;
  code: string | null;
  name: string;
  variant_label: string | null;
  unit: string | null;
  tracking: string;
  batch_no: string | null;
  quantity: number | string;
  sent_qty: number | string;
  received_qty: number | string;
  unit_cost: number | string | null;
  source_on_hand: number | string | null;
}

export interface TransferDetail {
  transfer: Transfer;
  lines: TransferLine[];
  needs_approval: boolean;
  can_approve: boolean;
}

export const fetchTransfers = (org: string, wh: number | null, f: DocFilters, signal?: AbortSignal) =>
  apiGet<{ transfers: Transfer[]; total: number }>('/api/inventory/transfers', withOrg(org, { status: f.status || undefined, q: f.q.trim() || undefined, ...(wh ? { warehouse_id: wh } : {}), page: f.page, per_page: PER } as Q), signal).then((r) => ({
    rows: r.transfers ?? [],
    total: num(r.total) ?? 0,
  }));
export const fetchTransfer = (id: number, signal?: AbortSignal) => apiGet<TransferDetail>(`/api/inventory/transfers/${id}`, undefined, signal);
export const createTransfer = (org: string, body: Record<string, unknown>) => apiPost<{ transfer: Transfer }>('/api/inventory/transfers', bodyOrg(org, body));
export const transferAct = (id: number, act: 'approve' | 'ship' | 'receive' | 'cancel', body?: object) => apiPost<{ transfer?: Transfer; short?: string[] }>(`/api/inventory/transfers/${id}/${act}`, body ?? {});
export const deleteTransfer = (id: number) => apiDelete<unknown>(`/api/inventory/transfers/${id}`);

export function transferActions(t: Pick<Transfer, 'status'>, o: { needsApproval: boolean; canApprove: boolean; canTransfer: boolean }) {
  const s = t.status;
  const open = s === 'draft' || s === 'pending';
  return {
    approve: o.canApprove && o.needsApproval && open,
    ship: o.canTransfer && (s === 'approved' || (!o.needsApproval && open)),
    receive: o.canTransfer && s === 'in_transit',
    cancel: o.canTransfer && (open || s === 'approved'),
    remove: o.canTransfer && (open || s === 'cancelled'),
  };
}

export function transferBody(
  h: { from: number | null; to: number | null; date: string; expected: string; carrier: string; tracking: string; note: string },
  lines: Array<{ product: Pickable | null; qty: string; batchId: number | null }>,
): { body: Record<string, unknown>; error: string | null } {
  if (!h.from || !h.to) return { body: {}, error: 'Choose where the stock is going from and to.' };
  if (h.from === h.to) return { body: {}, error: 'A transfer needs two different warehouses.' };
  const out: Array<Record<string, unknown>> = [];
  for (const l of lines) {
    if (!l.product) continue;
    const q = Number(l.qty.replace(/,/g, '').trim());
    const name = pickName(l.product);
    if (!Number.isFinite(q) || q <= 0) return { body: {}, error: `Give “${name}” a quantity to move.` };
    if (l.product.tracking === 'serial') return { body: {}, error: `“${name}” is serialised: move it with an adjustment at each end, so every unit is named.` };
    if (l.product.tracking === 'batch' && !l.batchId) return { body: {}, error: `“${name}” is batch tracked — choose the batch.` };
    out.push({ product_id: l.product.id, quantity: q, ...(l.batchId ? { batch_id: l.batchId } : {}) });
  }
  if (!out.length) return { body: {}, error: 'Add at least one product.' };
  return {
    body: {
      from_warehouse_id: h.from,
      to_warehouse_id: h.to,
      transfer_date: h.date || undefined,
      expected_date: h.expected || undefined,
      carrier: h.carrier.trim() || undefined,
      tracking_no: h.tracking.trim() || undefined,
      note: h.note.trim() || undefined,
      lines: out,
    },
    error: null,
  };
}

// ── counts ──────────────────────────────────────────────────────────────

export interface Count {
  id: number;
  reference: string;
  warehouse_id: number | string;
  warehouse: string | null;
  kind: string;
  scope: string;
  status: string;
  scheduled_for: string | null;
  started_at: string | null;
  posted_at: string | null;
  adjustment_id: number | string | null;
  variance_value: number | string | null;
  note: string | null;
  counted_by_name: string | null;
  line_count: number | string;
  counted_lines: number | string;
  variance_lines: number | string;
  created_at: string;
}

export interface CountLine {
  id: number;
  product_id: number;
  code: string | null;
  name: string;
  variant_label: string | null;
  unit: string | null;
  tracking: string;
  bin: string | null;
  expected_qty: number | string;
  counted_qty: number | string | null;
  variance_qty: number | string | null;
  unit_cost: number | string | null;
  variance_value: number | string | null;
  on_hand_now: number | string | null;
  drifted: boolean;
}

export interface CountDetail {
  count: Count;
  lines: CountLine[];
  drifted: number;
}

export const fetchCounts = (org: string, wh: number | null, f: DocFilters, signal?: AbortSignal) =>
  apiGet<{ counts: Count[]; total: number }>('/api/inventory/counts', withOrg(org, { status: f.status || undefined, ...(wh ? { warehouse_id: wh } : {}), page: f.page, per_page: PER } as Q), signal).then((r) => ({
    rows: r.counts ?? [],
    total: num(r.total) ?? 0,
  }));
export const fetchCount = (id: number, signal?: AbortSignal) => apiGet<CountDetail>(`/api/inventory/counts/${id}`, undefined, signal);
export const createCount = (org: string, body: Record<string, unknown>) => apiPost<{ id: number }>('/api/inventory/counts', bodyOrg(org, body));
export const countAct = (id: number, act: 'start' | 'post' | 'cancel') => apiPost<{ lines?: number; adjustment_id?: number; drifted?: string[] }>(`/api/inventory/counts/${id}/${act}`, {});
export const saveCountLines = (id: number, lines: Array<{ id: number; counted_qty: number | null }>) => apiPut<{ saved: number; uncounted: number }>(`/api/inventory/counts/${id}/lines`, { lines });
export const deleteCount = (id: number) => apiDelete<unknown>(`/api/inventory/counts/${id}`);

/**
 * A typed count. Blank is "not counted" — not zero, which would write the
 * whole line off — and anything that is not a number, zero or more, is
 * refused rather than guessed.
 */
export function countedOf(text: string): { value: number | null; ok: boolean } {
  const t = text.replace(/,/g, '').trim();
  if (t === '') return { value: null, ok: true };
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? { value: n, ok: true } : { value: null, ok: false };
}

// ── batches and serials ─────────────────────────────────────────────────

export interface Batch {
  id: number;
  product_id: number;
  code: string | null;
  name: string;
  unit: string | null;
  batch_no: string;
  mfg_date: string | null;
  expiry_date: string | null;
  supplier_batch: string | null;
  vendor: string | null;
  unit_cost: number | null;
  received_qty: number;
  on_hand: number;
  status: string;
  days_to_expiry: number | null;
  expired: boolean;
}

export interface SerialRow {
  id: number;
  product_id: number | string;
  serial_no: string;
  code: string | null;
  name: string;
  status: string;
  warehouse: string | null;
  batch_no: string | null;
  client: string | null;
  warranty_end: string | null;
  uid: string | null;
  nfc_uid: string | null;
  barcode: string | null;
}

export interface Expiring {
  batch_id: number;
  product_id: number;
  batch_no: string;
  code: string | null;
  name: string;
  unit: string | null;
  expiry_date: string;
  days_to_expiry: number;
  expired: boolean;
  on_hand: number;
  value: number | null;
}

export interface Unit {
  id: number;
  serial_no: string;
  uid: string | null;
  nfc_uid: string | null;
  barcode: string | null;
  product_id: number;
  product: string | null;
  product_code: string | null;
  warehouse: string | null;
  bin: string | null;
  status: string;
  client: string | null;
  grn_id: number | null;
  delivery_id: number | null;
  warranty_start: string | null;
  warranty_end: string | null;
  received_at: string | null;
  unit_cost: number | null;
  notes: string | null;
}

export interface UnitDetail {
  unit: Unit | null;
  history: Array<{ id: number; type: string; what: string; ref: string | null; note: string | null; warehouse: string | null; user: string | null; at: string }>;
  sellable: boolean;
}

export const fetchBatches = (org: string, q: string, signal?: AbortSignal) => apiGet<{ batches: Batch[] }>('/api/inventory/stock/batches', withOrg(org, { q: q.trim() || undefined, in_stock: 1, per_page: 200 }), signal).then((r) => r.batches ?? []);
export const fetchProductBatches = (productId: number, signal?: AbortSignal) => apiGet<{ batches: Batch[] }>('/api/inventory/stock/batches', { product_id: productId, in_stock: 1, per_page: 200 }, signal).then((r) => r.batches ?? []);
export const fetchSerials = (org: string, wh: number | null, f: { q: string; status: string; page: number }, signal?: AbortSignal) =>
  apiGet<{ serials: SerialRow[]; total: number }>('/api/inventory/stock/serials', withOrg(org, { q: f.q.trim() || undefined, status: f.status || undefined, ...(wh ? { warehouse_id: wh } : {}), page: f.page, per_page: 50 } as Q), signal).then(
    (r) => ({ rows: r.serials ?? [], total: num(r.total) ?? 0 }),
  );
export const fetchExpiring = (org: string, days: number, signal?: AbortSignal) => apiGet<{ batches: Expiring[]; window_days: number; expired: number }>('/api/inventory/stock/expiring', withOrg(org, { days }), signal);
export const fetchUnit = (id: number, signal?: AbortSignal) => apiGet<UnitDetail>(`/api/inventory/serials/${id}`, undefined, signal);
export const scanCode = (org: string, code: string) => apiGet<{ found: boolean; ambiguous: boolean; unit: Unit | null; sellable: boolean; why: string | null }>('/api/inventory/scan', withOrg(org, { code }));
export const tagUnit = (id: number, nfc: string) => apiPut<unknown>(`/api/inventory/serials/${id}/tag`, { nfc_uid: nfc });

export const SERIAL_STATUS: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'grey'> = { in_stock: 'blue', reserved: 'amber', sold: 'green', delivered: 'green', returned: 'amber', in_service: 'grey', scrapped: 'red' };

/** The ways a unit is known — the tags the list shows beside it. */
export const tagsOf = (s: Pick<SerialRow, 'barcode' | 'uid' | 'nfc_uid'>) => [s.barcode ? 'barcode' : null, s.uid ? 'QR' : null, s.nfc_uid ? 'NFC' : null].filter(Boolean).join(' · ') || '—';

// ── opening stock ───────────────────────────────────────────────────────

export const recordOpening = (org: string, body: Record<string, unknown>) => apiPost<{ recorded: number; skipped: string[] }>('/api/inventory/stock/opening', bodyOrg(org, body));

export function openingBody(
  h: { warehouse: number | null; asAt: string },
  lines: Array<{ product: Pickable | null; qty: string; cost: string; batch: string; expiry: string; serials: string }>,
): { body: Record<string, unknown>; error: string | null } {
  if (!h.warehouse) return { body: {}, error: 'Choose the warehouse.' };
  const out: Array<Record<string, unknown>> = [];
  for (const l of lines) {
    if (!l.product) continue;
    const q = Number(l.qty.replace(/,/g, '').trim());
    const name = pickName(l.product);
    if (!Number.isFinite(q) || q <= 0) return { body: {}, error: `Give “${name}” the quantity that was on the shelf.` };
    const cost = l.cost.trim() ? Number(l.cost.replace(/,/g, '').trim()) : null;
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return { body: {}, error: `The unit cost of “${name}” must be a number, zero or more.` };
    const line: Record<string, unknown> = { product_id: l.product.id, quantity: q, ...(cost !== null ? { unit_cost: cost } : {}) };
    if (l.product.tracking === 'batch') {
      if (!l.batch.trim()) return { body: {}, error: `“${name}” is batch tracked — give the opening batch number.` };
      line.batch_no = l.batch.trim();
      if (l.expiry) line.expiry_date = l.expiry;
    }
    if (l.product.tracking === 'serial') {
      const sn = serialList(l.serials);
      if (sn.length !== q) return { body: {}, error: `“${name}” is serialised: give ${q} serial ${q === 1 ? 'number' : 'numbers'} (${sn.length} given).` };
      line.serials = sn.join('\n');
    }
    out.push(line);
  }
  if (!out.length) return { body: {}, error: 'Add at least one product.' };
  return { body: { warehouse_id: h.warehouse, as_at: h.asAt || undefined, lines: out }, error: null };
}
