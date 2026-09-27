import { useQuery } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { addDays, dayWords, listStamp, parseTs, timeLabel, dayKey, todayInZone } from '../../core/time';

/**
 * Inventory (the server's `/api/inventory`, "Inv*" designs): the catalogue,
 * where stock is, and what moved it. Every read is gated on `inventory.view`;
 * `inventory.catalogue` adds and edits products and categories, and
 * `inventory.manage` stands in for every capability but viewing.
 *
 * COST IS NOT ZERO. Without `inventory.cost` the server sends `null` for every
 * cost price, average cost, value and variance, and the screens draw a dash —
 * never 0.00, which would read as free stock.
 *
 * The server hands DECIMAL columns back as strings on some routes ("950.0000"),
 * so every quantity and amount goes through `num()` before it is drawn.
 *
 * The company picker narrows everything: its id rides on each request as
 * `org_id`, as the web does. Empty means every company the user holds.
 */

export const can = (perms: readonly string[] | undefined, slug: string) => !!perms && (perms.includes('*') || perms.includes(slug) || (slug !== 'inventory.view' && slug.startsWith('inventory.') && perms.includes('inventory.manage')));

type Q = Record<string, string | number | boolean | undefined>;
export const withOrg = (org: string, rest: Q = {}): Q => ({
  ...(org ? { org_id: org } : {}),
  ...rest,
});
const bodyOrg = (org: string, body: object) => (org ? { org_id: Number(org), ...body } : body);

export const K = {
  all: ['inventory'] as const,
  companies: ['inventory', 'companies'] as const,
  warehouses: (org: string) => ['inventory', 'warehouses', org] as const,
  dashboard: (org: string, wh: number | null) => ['inventory', 'dashboard', org, wh] as const,
  detail: (org: string, wh: number | null) => ['inventory', 'dashboard-detail', org, wh] as const,
  products: (org: string, f: object) => ['inventory', 'products', org, f] as const,
  product: (id: number, org: string) => ['inventory', 'product', id, org] as const,
  trade: (id: number, org: string) => ['inventory', 'trade', id, org] as const,
  timeline: (id: number, org: string) => ['inventory', 'timeline', id, org] as const,
  categories: (org: string) => ['inventory', 'categories', org] as const,
  brands: (org: string) => ['inventory', 'brands', org] as const,
  units: ['inventory', 'units'] as const,
  stock: (org: string, f: object) => ['inventory', 'stock', org, f] as const,
  movements: (org: string, f: object) => ['inventory', 'movements', org, f] as const,
  search: (org: string, q: string) => ['inventory', 'search', org, q] as const,
};

// ── numbers ─────────────────────────────────────────────────────────────

/** A quantity or amount as the server sent it (a number, or a DECIMAL string), or null. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "2" not "2.0000": stock of two bolts is a count; up to four places when there are any. */
export function qty(v: unknown, unit?: string | null): string {
  const n = num(v);
  if (n === null) return '—';
  const body = Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return unit ? `${body} ${unit}` : body;
}

/** A signed movement: "+40", "−6". */
export function signed(v: unknown): string {
  const n = num(v);
  if (n === null) return '—';
  return n > 0 ? `+${qty(n)}` : n < 0 ? `−${qty(-n)}` : '0';
}

/** A cost or value. Null is "not yours to see", drawn as a dash. */
export function cost(v: unknown, currency?: string | null): string {
  const n = num(v);
  if (n === null) return '—';
  const s = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${s}` : s;
}

/** A price or value in whole units, for a column: "34,500". */
export function whole(v: unknown, currency?: string | null): string {
  const n = num(v);
  if (n === null) return '—';
  const s = Math.round(n).toLocaleString();
  return currency ? `${currency} ${s}` : s;
}

/** A tile's figure: "LKR 18.4M", "LKR 318k". */
export function short(v: unknown, currency?: string | null): string {
  const n = num(v);
  if (n === null) return '—';
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `${(n / 1_000_000).toFixed(a >= 100_000_000 ? 0 : 1).replace(/\.0$/, '')}M` : a >= 10_000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString();
  return currency ? `${currency} ${s}` : s;
}

// ── when ────────────────────────────────────────────────────────────────

/**
 * A stamp at exactly midnight is a day the server stored as a date: opening
 * stock "as at" a day, a document dated by hand. Read as an instant it would
 * show as the hour the reader's zone is off UTC ("5:30 AM"), so it is shown
 * as the day it names.
 */
export const isDay = (stamp: string | null | undefined) => !!stamp && /^\d{4}-\d{2}-\d{2}[ T]00:00:00(\.0+)?Z?$/.test(stamp);

/** For a list: the time today, "Yesterday", else the day — a stored date as that day. */
export function stampWords(stamp: string | null | undefined): string {
  if (!stamp) return '';
  if (!isDay(stamp)) return listStamp(stamp);
  const day = stamp.slice(0, 10);
  return day === todayInZone() ? 'Today' : day === addDays(todayInZone(), -1) ? 'Yesterday' : dayWords(day);
}

/** For a movement: "25 Sep 10:12", or the day alone for a stored date. */
export function stampFull(stamp: string): string {
  if (isDay(stamp)) return dayWords(stamp.slice(0, 10));
  const d = parseTs(stamp);
  return Number.isNaN(d.getTime()) ? stamp : `${dayWords(dayKey(d))} ${timeLabel(stamp)}`;
}

// ── labels ──────────────────────────────────────────────────────────────

/** What each movement type is called where a person reads it (the web's MOVE_LABEL). */
export const MOVE_LABEL: Record<string, string> = {
  opening: 'Opening',
  purchase: 'Received',
  sale: 'Sold',
  delivery: 'Delivered',
  adjustment: 'Adjusted',
  transfer_out: 'Transferred out',
  transfer_in: 'Transferred in',
  assembly_consume: 'Consumed',
  assembly_produce: 'Produced',
  appointment: 'Appointment',
  return_in: 'Returned in',
  return_out: 'Returned out',
  count: 'Counted',
  scrap: 'Scrapped',
  conversion: 'Converted',
};
export const moveLabel = (t: string | null | undefined) => (t ? (MOVE_LABEL[t] ?? t.replace(/_/g, ' ')) : '—');

export const REASON_LABEL: Record<string, string> = {
  damage: 'Damage',
  loss: 'Loss',
  theft: 'Theft',
  manual: 'Manual',
  expired: 'Expired',
  audit: 'Stock count',
  opening: 'Opening balance',
  revaluation: 'Revaluation',
  found: 'Found',
};

export const TRACKING: Array<{ id: Tracking; label: string; short: string }> = [
  { id: 'none', label: 'Plain quantity', short: 'Quantity' },
  { id: 'batch', label: 'Batch tracked', short: 'Batch' },
  { id: 'serial', label: 'Serialised', short: 'Serial' },
];
export const trackingLabel = (t: string | null | undefined, s = false) => {
  const x = TRACKING.find((k) => k.id === t);
  return x ? (s ? x.short : x.label) : '—';
};

export const KINDS: Array<{ id: string; label: string }> = [
  { id: 'product', label: 'Product' },
  { id: 'service', label: 'Service' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'bundle', label: 'Bundle' },
  { id: 'digital', label: 'Digital' },
  { id: 'variable', label: 'Variable' },
  { id: 'combo', label: 'Combo' },
];
export const kindLabel = (k: string | null | undefined) => KINDS.find((x) => x.id === k)?.label ?? k ?? '—';

export const COSTING: Array<{ id: 'fifo' | 'average'; label: string }> = [
  { id: 'fifo', label: 'FIFO' },
  { id: 'average', label: 'Weighted average' },
];
export const costingLabel = (c: string | null | undefined) => COSTING.find((x) => x.id === c)?.label ?? c ?? '—';

/** The web's own deep links (`/inventory?view=`), for the screens that stay in the browser. */
export const WEB_VIEW = {
  adj: 'adjustments',
  trf: 'transfers',
  cnt: 'counts',
  trk: 'tracked',
  pur: 'purchasing',
  so: 'sales',
  ven: 'vendors',
  mfg: 'manufacturing',
  rep: 'reports',
  rpl: 'replenishment',
  lk: 'lookups',
  set: 'admin',
  acc: 'myaccess',
} as const;

// ── companies and warehouses ────────────────────────────────────────────

export interface Company {
  id: number;
  name: string;
  currency: string | null;
}

export function useCompanies() {
  return useQuery({
    queryKey: K.companies,
    queryFn: ({ signal }) => apiGet<{ companies: Company[]; single: boolean }>('/api/inventory/companies', undefined, signal).then((r) => r.companies ?? []),
    staleTime: 300_000,
  });
}

/** The currency figures are in: the chosen company's, or the one every company shares; else none. */
export function currencyOf(companies: Company[] | undefined, org: string): string | null {
  const list = companies ?? [];
  if (org) return list.find((c) => String(c.id) === org)?.currency ?? null;
  const all = [...new Set(list.map((c) => c.currency).filter(Boolean))];
  return all.length === 1 ? (all[0] as string) : null;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  kind: string;
  is_default: boolean;
  status: string;
  units: number;
  value: number | null;
  product_count: number;
}

export const fetchWarehouses = (org: string, signal?: AbortSignal) => apiGet<{ warehouses: Warehouse[] }>('/api/inventory/warehouses', withOrg(org), signal).then((r) => r.warehouses ?? []);

// ── dashboard ───────────────────────────────────────────────────────────

export interface Dashboard {
  totals: {
    stocked_products: number;
    units: number;
    reserved: number;
    incoming: number;
    value: number | null;
    out_of_stock: number;
    low_stock: number;
    expiring_batches: number;
  };
  counts: {
    products: number;
    warehouses: number;
    vendors: number;
    categories: number;
    stocked: number;
    unstocked: number;
  };
  categories: Array<{ id: number; name: string; product_count: number }>;
  pending: {
    purchase_orders: number;
    sales_orders: number;
    adjustments: number;
    transfers: number;
    counts: number;
    assemblies: number;
  };
  movement: Array<{ day: string; received: number; issued: number }>;
  warehouses: Array<{
    id: number;
    code: string;
    name: string;
    kind: string;
    units: number;
    value?: number | null;
    low?: number;
    capacity?: number | null;
    capacity_unit?: string | null;
  }>;
  top: Array<{
    id: number;
    code: string;
    name: string;
    issued: number;
    value?: number;
  }>;
  recent: Array<{
    id: number;
    quantity: number;
    ref_type: string;
    ref_no: string | null;
    moved_at: string;
    code: string;
    name: string;
    warehouse: string | null;
    user: string | null;
  }>;
  can: {
    cost: boolean;
    catalogue: boolean;
    adjust: boolean;
    transfer: boolean;
    approve: boolean;
    purchase: boolean;
    sell: boolean;
    manufacture: boolean;
    settings: boolean;
  };
}

export interface DashboardDetail {
  dead: {
    days: number;
    products: number;
    units: number;
    value: number | null;
    rows: Array<{
      id: number;
      code: string;
      name: string;
      units: number;
      value: number | null;
      last_moved: string | null;
    }>;
  };
  cover: {
    days: number;
    rows: Array<{
      id: number;
      code: string;
      name: string;
      available: number;
      per_day: number;
      days: number;
    }>;
  };
  reorder: {
    products: number;
    rows: Array<{
      id: number;
      code: string;
      name: string;
      available: number;
      minimum: number;
      incoming: number;
      suggest: number;
      lead_days: number | null;
    }>;
  };
  accuracy: {
    last: {
      id: number;
      reference: string | null;
      at: string | null;
      warehouse: string | null;
      variance: number | null;
    } | null;
    counted_90: number;
  };
  negative: {
    products: number;
    rows: Array<{
      id: number;
      code: string;
      name: string;
      warehouse: string | null;
      on_hand: number;
    }>;
  };
  can_cost: boolean;
}

const whQ = (wh: number | null) => (wh ? { warehouse_id: wh } : {});
export const fetchDashboard = (org: string, wh: number | null, signal?: AbortSignal) => apiGet<Dashboard>('/api/inventory/dashboard', withOrg(org, whQ(wh)), signal);
export const fetchDetail = (org: string, wh: number | null, signal?: AbortSignal) => apiGet<DashboardDetail>('/api/inventory/dashboard/detail', withOrg(org, whQ(wh)), signal);

/** The "needs attention" line: what is waiting, worded, and where it lives. */
export function attention(d: Dashboard | undefined): Array<{
  key: string;
  label: string;
  view: keyof typeof WEB_VIEW | 'stock';
  tone: 'amber' | 'red';
}> {
  if (!d) return [];
  const p = d.pending;
  const t = d.totals;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const out: ReturnType<typeof attention> = [];
  if (t.out_of_stock)
    out.push({
      key: 'out',
      label: n(t.out_of_stock, 'product out of stock', 'products out of stock'),
      view: 'stock',
      tone: 'red',
    });
  if (t.low_stock)
    out.push({
      key: 'low',
      label: n(t.low_stock, 'product at or below minimum', 'products at or below minimum'),
      view: 'stock',
      tone: 'amber',
    });
  if (t.expiring_batches)
    out.push({
      key: 'exp',
      label: n(t.expiring_batches, 'batch expiring', 'batches expiring'),
      view: 'trk',
      tone: 'amber',
    });
  if (p.adjustments)
    out.push({
      key: 'adj',
      label: n(p.adjustments, 'adjustment awaiting approval', 'adjustments awaiting approval'),
      view: 'adj',
      tone: 'amber',
    });
  if (p.transfers)
    out.push({
      key: 'trf',
      label: n(p.transfers, 'transfer in flight', 'transfers in flight'),
      view: 'trf',
      tone: 'amber',
    });
  if (p.counts)
    out.push({
      key: 'cnt',
      label: n(p.counts, 'count open', 'counts open'),
      view: 'cnt',
      tone: 'amber',
    });
  if (p.purchase_orders)
    out.push({
      key: 'po',
      label: n(p.purchase_orders, 'order awaiting delivery', 'orders awaiting delivery'),
      view: 'pur',
      tone: 'amber',
    });
  if (p.sales_orders)
    out.push({
      key: 'so',
      label: n(p.sales_orders, 'sales order to ship', 'sales orders to ship'),
      view: 'so',
      tone: 'amber',
    });
  if (p.assemblies)
    out.push({
      key: 'mfg',
      label: n(p.assemblies, 'job on the floor', 'jobs on the floor'),
      view: 'mfg',
      tone: 'amber',
    });
  return out;
}

// ── search ──────────────────────────────────────────────────────────────

export interface SearchHit {
  type: string;
  id: number;
  code: string | null;
  label: string;
  product_id?: number;
}

export const searchInventory = (q: string, org: string, signal?: AbortSignal) =>
  apiGet<{ results: SearchHit[]; exact: SearchHit | null }>('/api/inventory/search', withOrg(org, { q }), signal).then((r) => ({ results: r.results ?? [], exact: r.exact ?? null }));

/** The product a hit leads to, when it leads to one (a product, or a serial's product). */
export const hitProduct = (h: SearchHit): number | null => (h.type === 'product' ? h.id : h.product_id ? h.product_id : null);

export const HIT_LABEL: Record<string, string> = {
  product: 'Product',
  serial: 'Serial',
  batch: 'Batch',
  warehouse: 'Warehouse',
  vendor: 'Vendor',
  purchase_order: 'Purchase order',
  sales_order: 'Sales order',
  receipt: 'Goods received',
  delivery: 'Delivery',
  transfer: 'Transfer',
  adjustment: 'Adjustment',
  assembly: 'Assembly',
};

/** Where a hit that is not a product opens in the browser. */
export const HIT_VIEW: Record<string, string> = {
  batch: 'tracked',
  serial: 'tracked',
  warehouse: 'admin',
  vendor: 'vendors',
  purchase_order: 'purchasing',
  receipt: 'purchasing',
  sales_order: 'sales',
  delivery: 'sales',
  transfer: 'transfers',
  adjustment: 'adjustments',
  assembly: 'manufacturing',
};

// ── products ────────────────────────────────────────────────────────────

export type Tracking = 'none' | 'batch' | 'serial';

export interface Product {
  id: number;
  parent_id: number | null;
  is_variant: boolean;
  code: string | null;
  barcode: string | null;
  name: string;
  variant_label: string | null;
  kind: string;
  tracking: Tracking;
  costing_method: string;
  unit: string | null;
  unit_code: string | null;
  unit_price: number;
  cost_price: number | null;
  average_cost: number | null;
  currency: string;
  tax_rate: number;
  category_id: number | null;
  category: string | null;
  brand_id: number | null;
  brand: string | null;
  image_file_id: number | null;
  is_stocked: boolean;
  active: boolean;
  reorder_point: number | null;
  tags: string | null;
  on_hand?: number;
  reserved?: number;
  incoming?: number;
  available?: number;
  low?: boolean;
  sold_qty?: number;
  sold_value?: number;
  description?: string | null;
  notes?: string | null;
  allow_negative?: boolean;
  reorder_qty?: number | null;
  max_stock?: number | null;
  lead_time_days?: number | null;
  shelf_life_days?: number | null;
  hs_code?: string | null;
  unit_id?: number | null;
  weight?: number | null;
  weight_unit?: string | null;
}

export interface ProductFilters {
  q: string;
  category: number | null;
  stock: '' | 'in' | 'low' | 'out';
  archived: boolean;
  page: number;
}

export const PER_PAGE = 50;

export const fetchProducts = (org: string, f: ProductFilters, signal?: AbortSignal) =>
  apiGet<{ products: Product[]; total: number }>(
    '/api/inventory/products',
    withOrg(org, {
      q: f.q.trim() || undefined,
      category_id: f.category ?? undefined,
      stock: f.stock || undefined,
      include_archived: f.archived ? 1 : undefined,
      page: f.page,
      per_page: PER_PAGE,
    }),
    signal,
  ).then((r) => ({ products: r.products ?? [], total: num(r.total) ?? 0 }));

export interface Level {
  warehouse_id: number;
  warehouse_code: string;
  warehouse: string;
  on_hand: number;
  reserved: number;
  incoming: number;
  available: number;
  average_cost: number | null;
  last_movement_at: string | null;
}

export interface ProductDetail {
  product: Product;
  levels: Level[];
  variants: Array<{
    id: number;
    code: string | null;
    barcode: string | null;
    variant_label: string | null;
    unit_price: number;
    cost_price: number | null;
    active: number | boolean;
    on_hand: number;
    reserved: number;
  }>;
  attributes: Array<{
    attribute_id: number;
    attribute: string;
    kind: string;
    unit: string | null;
    value: string | null;
    text_value: string | null;
    is_variantal: number | boolean;
  }>;
  bundle: Array<{
    id: number;
    component_id: number;
    quantity: number;
    code: string | null;
    name: string;
    unit: string | null;
  }>;
  prices: Array<{
    id: number;
    price_list: string;
    kind: string;
    currency: string;
    min_qty: number;
    price: number;
    discount_pct: number;
  }>;
  totals: {
    on_hand: number;
    reserved: number;
    incoming: number;
    available: number;
  };
  consumption: {
    issued: number;
    days: number;
    per_day: number;
    on_hand: number;
    days_cover: number | null;
  } | null;
  /** Tracking and costing cannot change: stock is on hand somewhere in the group. */
  stock_locked?: boolean;
}

export const fetchProduct = (id: number, org: string, signal?: AbortSignal) => apiGet<ProductDetail>(`/api/inventory/products/${id}`, withOrg(org), signal);

export interface TradeLine {
  id: number;
  number: string | null;
  type?: string;
  kind?: 'bill' | 'order';
  status: string;
  issue_date?: string | null;
  doc_date?: string | null;
  currency: string | null;
  customer?: string | null;
  party?: string | null;
  quantity: number;
  unit_price?: number;
  unit_cost?: number | null;
  net_total: number | null;
}

export interface Trade {
  sales: TradeLine[];
  purchases: TradeLine[];
  sold_qty: number;
  sold_value: number;
}

export const fetchTrade = (id: number, org: string, signal?: AbortSignal) => apiGet<Trade>(`/api/inventory/products/${id}/trade`, withOrg(org), signal);

export interface TimelineMove {
  id: number;
  quantity: number;
  unit_cost: number | null;
  value: number | null;
  balance_after: number;
  ref_type: string;
  ref_id: number | null;
  ref_no: string | null;
  reason: string | null;
  note: string | null;
  moved_at: string;
  warehouse: string | null;
  batch_no: string | null;
  serial_no: string | null;
  user: string | null;
}

export interface Timeline {
  movements: TimelineMove[];
  activity: Array<{
    id: number;
    action: string;
    summary: string | null;
    created_at: string;
    user: string | null;
  }>;
}

export const fetchTimeline = (id: number, org: string, signal?: AbortSignal) => apiGet<Timeline>(`/api/inventory/products/${id}/timeline`, withOrg(org), signal);

/** What a movement was, in words: "Received · GRN-00188 · SN 4K02-00931". */
export function moveWhat(m: { ref_type: string; ref_no: string | null; reason?: string | null; batch_no?: string | null; serial_no?: string | null }): string {
  const reason = m.reason && m.ref_type === 'adjustment' ? (REASON_LABEL[m.reason] ?? m.reason.replace(/_/g, ' ')) : null;
  return [moveLabel(m.ref_type), m.ref_no, reason, m.serial_no ? `SN ${m.serial_no}` : null, m.batch_no ? `B:${m.batch_no}` : null].filter(Boolean).join(' · ');
}

// ── the product form ────────────────────────────────────────────────────

export interface ProductDraft {
  name: string;
  code: string;
  barcode: string;
  kind: string;
  category_id: number | null;
  brand_id: number | null;
  unit_id: number | null;
  tracking: Tracking;
  costing_method: 'fifo' | 'average';
  unit_price: string;
  cost_price: string;
  tax_rate: string;
  reorder_point: string;
  reorder_qty: string;
  lead_time_days: string;
  description: string;
  is_stocked: boolean;
}

export function draftOf(p?: Product | null): ProductDraft {
  const s = (v: unknown) => {
    const n = num(v);
    return n === null ? '' : String(n);
  };
  return {
    name: p?.name ?? '',
    code: p?.code ?? '',
    barcode: p?.barcode ?? '',
    kind: p?.kind ?? 'product',
    category_id: p?.category_id ?? null,
    brand_id: p?.brand_id ?? null,
    unit_id: p?.unit_id ?? null,
    tracking: p?.tracking ?? 'none',
    costing_method: p?.costing_method === 'average' ? 'average' : 'fifo',
    unit_price: p ? s(p.unit_price) : '',
    cost_price: p ? s(p.cost_price) : '',
    tax_rate: p ? s(p.tax_rate) : '',
    reorder_point: s(p?.reorder_point),
    reorder_qty: s(p?.reorder_qty),
    lead_time_days: s(p?.lead_time_days),
    description: p?.description ?? '',
    is_stocked: p?.is_stocked ?? true,
  };
}

/** A typed amount: "10,900" → 10900; blank → null; nonsense → NaN (refused before sending). */
export function parseAmount(v: string): number | null {
  const t = v.replace(/,/g, '').trim();
  if (t === '') return null;
  return Number(t);
}

/**
 * The body a draft saves as. A blank number is sent as null ("not set"),
 * and the cost price is left out for someone who may not see it — the
 * server keeps the old one either way, and sending a masked null would read
 * as "clear it".
 */
export function bodyOf(d: ProductDraft, canCost: boolean): { body: Record<string, unknown>; error: string | null } {
  if (!d.name.trim()) return { body: {}, error: 'Give the product a name.' };
  const nums: Array<[string, string, string]> = [
    ['unit_price', d.unit_price, 'The selling price'],
    ['tax_rate', d.tax_rate, 'The tax rate'],
    ['reorder_point', d.reorder_point, 'The reorder point'],
    ['reorder_qty', d.reorder_qty, 'The reorder quantity'],
    ['lead_time_days', d.lead_time_days, 'The lead time'],
  ];
  if (canCost) nums.push(['cost_price', d.cost_price, 'The cost price']);
  const body: Record<string, unknown> = {
    name: d.name.trim(),
    code: d.code.trim() || null,
    barcode: d.barcode.trim() || null,
    kind: d.kind,
    category_id: d.category_id,
    brand_id: d.brand_id,
    unit_id: d.unit_id,
    tracking: d.tracking,
    costing_method: d.costing_method,
    description: d.description.trim() || null,
    is_stocked: d.is_stocked ? 1 : 0,
  };
  for (const [k, v, label] of nums) {
    const n = parseAmount(v);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return { body: {}, error: `${label} must be a number, zero or more.` };
    body[k] = n;
  }
  if (body.unit_price === null) body.unit_price = 0;
  return { body, error: null };
}

export const createProduct = (org: string, body: Record<string, unknown>) => apiPost<{ product: Product }>('/api/inventory/products', bodyOrg(org, body));
export const updateProduct = (id: number, body: Record<string, unknown>) => apiPut<{ product: Product }>(`/api/inventory/products/${id}`, body);
export const archiveProduct = (id: number) => apiDelete<unknown>(`/api/inventory/products/${id}`);
export const restoreProduct = (id: number) => apiPost<unknown>(`/api/inventory/products/${id}/restore`);

// ── categories, brands, units ───────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  code: string | null;
  parent_id: number | null;
  path: string;
  depth: number;
  sort_order: number;
  status: string;
  product_count: number;
}

export const fetchCategories = (org: string, signal?: AbortSignal) => apiGet<{ categories: Category[] }>('/api/inventory/categories', withOrg(org), signal).then((r) => r.categories ?? []);
export const createCategory = (org: string, name: string, parentId: number | null) => apiPost<{ id: number }>('/api/inventory/categories', bodyOrg(org, { name, parent_id: parentId }));
export const updateCategory = (id: number, patch: { name?: string; parent_id?: number | null }) => apiPut<unknown>(`/api/inventory/categories/${id}`, patch);
export const deleteCategory = (id: number) => apiDelete<unknown>(`/api/inventory/categories/${id}`);

export interface TreeNode extends Category {
  /** Products here and in every category beneath. */
  total: number;
  level: number;
}

/**
 * The categories as the tree reads top to bottom: each parent, then its
 * children by their own order, each carrying the count of everything filed
 * beneath it. A category whose parent is not in the list (archived, or in a
 * company not being looked at) is shown at the top rather than lost.
 */
export function treeOf(cats: Category[]): TreeNode[] {
  const ids = new Set(cats.map((c) => c.id));
  const kids = new Map<number | null, Category[]>();
  for (const c of cats) {
    const p = c.parent_id !== null && ids.has(c.parent_id) ? c.parent_id : null;
    kids.set(p, [...(kids.get(p) ?? []), c]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const total = (c: Category): number => c.product_count + (kids.get(c.id) ?? []).reduce((s, k) => s + total(k), 0);
  const out: TreeNode[] = [];
  const walk = (parent: number | null, level: number) => {
    for (const c of kids.get(parent) ?? []) {
      out.push({ ...c, total: total(c), level });
      walk(c.id, level + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The categories a category may move under: not itself, and nothing beneath it. */
export function parentsFor(tree: TreeNode[], id: number): TreeNode[] {
  const self = tree.find((c) => c.id === id);
  if (!self) return tree;
  const under = `${self.path}${self.id}/`;
  return tree.filter((c) => c.id !== id && !`${c.path}${c.id}/`.startsWith(under));
}

export interface Brand {
  id: number;
  name: string;
  code: string | null;
  status: string;
  product_count: number;
}
export interface Unit {
  id: number;
  name: string;
  code: string;
  kind: string;
  status: string;
}

export const fetchBrands = (org: string, signal?: AbortSignal) => apiGet<{ brands: Brand[] }>('/api/inventory/brands', withOrg(org), signal).then((r) => r.brands ?? []);
export const fetchUnits = (signal?: AbortSignal) => apiGet<{ units: Unit[] }>('/api/inventory/units', undefined, signal).then((r) => r.units ?? []);

// ── stock and movements ─────────────────────────────────────────────────

export interface StockRow {
  product_id: number;
  code: string | null;
  name: string;
  unit: string | null;
  tracking: string;
  category: string | null;
  warehouse_id: number | null;
  warehouse: string | null;
  /** How many warehouses hold it, when the rows are across all of them. */
  warehouse_count?: number;
  on_hand: number;
  reserved: number;
  available: number;
  incoming: number;
  reorder_point: number | null;
  average_cost: number | null;
  value: number | null;
  last_movement_at: string | null;
  low: boolean;
}

export interface StockFilters {
  q: string;
  filter: '' | 'low' | 'out' | 'reserved';
  zero: boolean;
  page: number;
}

export const fetchStock = (org: string, wh: number | null, f: StockFilters, signal?: AbortSignal) =>
  apiGet<{ stock: StockRow[]; total?: number; value_total?: number | null }>(
    '/api/inventory/stock',
    withOrg(org, {
      ...whQ(wh),
      q: f.q.trim() || undefined,
      filter: f.filter || undefined,
      include_zero: f.zero ? 1 : undefined,
      page: f.page,
      per_page: PER_PAGE,
    }),
    signal,
  ).then((r) => ({
    stock: r.stock ?? [],
    total: num(r.total),
    value: r.value_total ?? null,
  }));

export interface Movement {
  id: number;
  product_id: number;
  code: string | null;
  name: string;
  unit: string | null;
  warehouse: string | null;
  warehouse_code: string | null;
  bin: string | null;
  batch_no: string | null;
  serial_no: string | null;
  quantity: number;
  unit_cost: number | null;
  value: number | null;
  balance_after: number;
  ref_type: string;
  ref_id: number | null;
  ref_no: string | null;
  reason: string | null;
  note: string | null;
  moved_at: string;
  user: string | null;
}

export interface MovementFilters {
  q: string;
  type: string;
  direction: '' | 'in' | 'out';
  from: string;
  to: string;
  page: number;
}

export const fetchMovements = (org: string, wh: number | null, f: MovementFilters, signal?: AbortSignal) =>
  apiGet<{ movements: Movement[]; total: number }>(
    '/api/inventory/stock/movements',
    withOrg(org, {
      ...whQ(wh),
      q: f.q.trim() || undefined,
      ref_type: f.type || undefined,
      direction: f.direction || undefined,
      from: f.from || undefined,
      to: f.to || undefined,
      page: f.page,
      per_page: PER_PAGE,
    }),
    signal,
  ).then((r) => ({ movements: r.movements ?? [], total: num(r.total) ?? 0 }));
