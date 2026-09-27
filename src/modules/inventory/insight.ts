import { apiGet, apiPost } from '../../core/api';
import { cost, num, withOrg } from './api';

/**
 * Insight (the "Inv" Reports and Replenishment designs): the reports the
 * server works out from the movement ledger and the cost layers, and what
 * is below its minimum. Every report carries the server's note on how its
 * figures were arrived at, shown in full. Cost figures are the server's to
 * mask: someone without `inventory.cost` is not offered the reports that
 * are all money, and sees a dash where the others hold it.
 */

type Q = Record<string, string | number | boolean | undefined>;

export const KI = {
  report: (key: string, org: string, f: object) => ['inventory', 'report', key, org, f] as const,
  replenishment: (org: string, wh: number | null) => ['inventory', 'replenishment', org, wh] as const,
};

// ── reports ─────────────────────────────────────────────────────────────

export type ReportFilter = 'warehouse' | 'days' | 'serialStatus' | 'only';

export interface ReportDef {
  key: string;
  label: string;
  group: 'Stock' | 'Movement' | 'Money' | 'Serials';
  /** All money: not offered without `inventory.cost` (the server refuses it). */
  needsCost: boolean;
  filters: ReportFilter[];
}

export const REPORTS: ReportDef[] = [
  { key: 'valuation', label: 'Stock valuation', group: 'Stock', needsCost: true, filters: ['warehouse'] },
  { key: 'balance', label: 'Stock balance', group: 'Stock', needsCost: false, filters: ['warehouse'] },
  { key: 'aging', label: 'Stock aging', group: 'Stock', needsCost: true, filters: ['warehouse'] },
  { key: 'warehouse', label: 'By warehouse', group: 'Stock', needsCost: false, filters: [] },
  { key: 'movement', label: 'Movement', group: 'Movement', needsCost: false, filters: ['warehouse', 'days'] },
  { key: 'fast', label: 'Fast moving', group: 'Movement', needsCost: false, filters: ['days'] },
  { key: 'dead', label: 'Dead stock', group: 'Movement', needsCost: false, filters: ['days'] },
  { key: 'abc', label: 'ABC analysis', group: 'Movement', needsCost: true, filters: ['days'] },
  { key: 'expiry', label: 'Expiry', group: 'Movement', needsCost: false, filters: ['days'] },
  { key: 'profitability', label: 'Product profitability', group: 'Money', needsCost: true, filters: [] },
  { key: 'vendor', label: 'By vendor', group: 'Money', needsCost: true, filters: [] },
  { key: 'serials', label: 'Serial register', group: 'Serials', needsCost: false, filters: ['warehouse', 'serialStatus'] },
  { key: 'serial-movement', label: 'Serial movement', group: 'Serials', needsCost: false, filters: [] },
  { key: 'serial-warranty', label: 'Serial warranty', group: 'Serials', needsCost: false, filters: ['days'] },
  { key: 'serial-labels', label: 'Serial labels & tags', group: 'Serials', needsCost: false, filters: ['only'] },
];

export const reportsFor = (canCost: boolean) => REPORTS.filter((r) => canCost || !r.needsCost);

export interface ReportParams {
  warehouse: number | null;
  days: string;
  serialStatus: string;
  only: string;
}

/** The query a report is asked with: only the filters it reads. The serial register names the warehouse `warehouse`, the rest `warehouse_id`. */
export function reportQuery(def: ReportDef, p: ReportParams): Q {
  const q: Q = {};
  if (def.filters.includes('warehouse') && p.warehouse) q[def.key === 'serials' ? 'warehouse' : 'warehouse_id'] = p.warehouse;
  if (def.filters.includes('days') && p.days) q.days = p.days;
  if (def.filters.includes('serialStatus') && p.serialStatus) q.status = p.serialStatus;
  if (def.filters.includes('only')) q.only = p.only;
  return q;
}

// Reports answer in many shapes; they are read, never written.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportData = any;

export const fetchReport = (key: string, org: string, q: Q, signal?: AbortSignal) => apiGet<ReportData>(`/api/inventory/reports/${key}`, withOrg(org, q), signal);

export type Fmt = 'text' | 'code' | 'qty' | 'cost' | 'status' | 'move' | 'pct' | 'days' | 'date' | 'stamp' | 'class';
export interface Col {
  key: string;
  label: string;
  fmt?: Fmt;
  width?: number;
}

export interface ReportView {
  headline: string | null;
  tiles: Array<[string, string]>;
  chips: Array<[string, number]>;
  tables: Array<{ title: string | null; rows: ReportData[]; cols: Col[]; empty: string }>;
  notes: string[];
  basis: string | null;
}

/** A serial's stored state, in the words a person would use. */
export const SERIAL_STATE: Record<string, string> = {
  in_stock: 'Available',
  delivered: 'Delivered',
  returned: 'Returned',
  in_service: 'In service',
  scrapped: 'Scrapped',
  reserved: 'Reserved',
  sold: 'Sold',
};

const n = (v: number, one: string, many: string) => `${v.toLocaleString()} ${v === 1 ? one : many}`;
const money = (v: unknown, cur: string | null) => cost(v, cur);

/**
 * What a report's answer shows: its headline figure, any tiles or chips, its
 * tables and its notes. Pure, so every report's reading is testable without
 * drawing it.
 */
export function reportView(key: string, d: ReportData, cur: string | null): ReportView {
  const v: ReportView = { headline: null, tiles: [], chips: [], tables: [], notes: [], basis: d?.basis ?? null };
  const table = (rows: ReportData[] | undefined, cols: Col[], title: string | null = null, empty = 'Nothing in this report.') => v.tables.push({ title, rows: rows ?? [], cols, empty });

  switch (key) {
    case 'valuation':
      v.headline = `${money(d.total_value, cur)} on the shelf`;
      table(d.rows, [
        { key: 'code', label: 'Code', fmt: 'code', width: 110 },
        { key: 'name', label: 'Product' },
        { key: 'quantity', label: 'Quantity', fmt: 'qty', width: 100 },
        { key: 'unit_cost', label: 'Unit cost', fmt: 'cost', width: 100 },
        { key: 'value', label: 'Value', fmt: 'cost', width: 120 },
      ]);
      break;
    case 'balance':
      v.headline = num(d.total_value) !== null ? `${money(d.total_value, cur)} on the shelf` : null;
      table(d.rows, [
        { key: 'code', label: 'Code', fmt: 'code', width: 110 },
        { key: 'name', label: 'Product' },
        { key: 'category', label: 'Category', width: 130 },
        { key: 'on_hand', label: 'On hand', fmt: 'qty', width: 90 },
        { key: 'reserved', label: 'Reserved', fmt: 'qty', width: 90 },
        { key: 'available', label: 'Available', fmt: 'qty', width: 90 },
        { key: 'value', label: 'Value', fmt: 'cost', width: 110 },
      ]);
      break;
    case 'aging':
      v.tiles = Object.values((d.buckets ?? {}) as Record<string, { label: string; value: number; quantity: number }>).map((b) => [b.label, `${money(b.value, cur)} · ${Number(b.quantity).toLocaleString()} units`]);
      table(
        d.products,
        [
          { key: 'code', label: 'Code', fmt: 'code', width: 110 },
          { key: 'name', label: 'Product' },
          { key: 'oldest_days', label: 'Oldest', fmt: 'days', width: 90 },
          { key: 'quantity', label: 'Quantity', fmt: 'qty', width: 100 },
          { key: 'value', label: 'Value', fmt: 'cost', width: 110 },
        ],
        'Oldest first',
      );
      break;
    case 'warehouse':
      table(d.rows, [
        { key: 'code', label: 'Code', fmt: 'code', width: 90 },
        { key: 'name', label: 'Warehouse' },
        { key: 'kind', label: 'Kind', width: 100 },
        { key: 'products', label: 'Products', width: 80 },
        { key: 'units', label: 'Units', fmt: 'qty', width: 100 },
        { key: 'reserved', label: 'Reserved', fmt: 'qty', width: 90 },
        { key: 'value', label: 'Value', fmt: 'cost', width: 110 },
        { key: 'capacity_pct', label: 'Capacity', fmt: 'pct', width: 80 },
      ]);
      break;
    case 'movement':
      v.headline = `Over ${d.window_days} days`;
      table(
        d.days,
        [
          { key: 'day', label: 'Day', fmt: 'date' },
          { key: 'received', label: 'Received', fmt: 'qty', width: 100 },
          { key: 'issued', label: 'Issued', fmt: 'qty', width: 100 },
          { key: 'in_value', label: 'In value', fmt: 'cost', width: 110 },
          { key: 'out_value', label: 'Out value', fmt: 'cost', width: 110 },
        ],
        'By day',
        'Nothing moved in that window.',
      );
      table(
        d.by_type,
        [
          { key: 'ref_type', label: 'Reason', fmt: 'move' },
          { key: 'movements', label: 'Movements', width: 100 },
          { key: 'quantity', label: 'Quantity', fmt: 'qty', width: 100 },
          { key: 'value', label: 'Value', fmt: 'cost', width: 110 },
        ],
        'By reason',
        'Nothing moved in that window.',
      );
      break;
    case 'fast':
      v.headline = `Fastest over ${d.window_days} days`;
      table(d.rows, [
        { key: 'code', label: 'Code', fmt: 'code', width: 110 },
        { key: 'name', label: 'Product' },
        { key: 'issued', label: 'Issued', fmt: 'qty', width: 90 },
        { key: 'per_day', label: 'Per day', fmt: 'qty', width: 80 },
        { key: 'on_hand', label: 'On hand', fmt: 'qty', width: 90 },
        { key: 'turns_per_year', label: 'Turns / yr', width: 80 },
        { key: 'days_cover', label: 'Cover', fmt: 'days', width: 80 },
      ]);
      break;
    case 'dead':
      v.headline = `Not issued in ${d.window_days} days${num(d.total_value) !== null ? ` — ${money(d.total_value, cur)} tied up` : ''}`;
      table(d.rows, [
        { key: 'code', label: 'Code', fmt: 'code', width: 110 },
        { key: 'name', label: 'Product' },
        { key: 'on_hand', label: 'On hand', fmt: 'qty', width: 90 },
        { key: 'value', label: 'Value', fmt: 'cost', width: 110 },
        { key: 'days_idle', label: 'Idle', fmt: 'days', width: 80 },
        { key: 'last_issued', label: 'Last issued', fmt: 'stamp', width: 120 },
      ]);
      v.notes.push('A dash under "Last issued" means it has never been issued at all.');
      break;
    case 'abc':
      if (d.note) {
        v.notes.push(d.note);
        break;
      }
      v.headline = `A ${d.counts?.A ?? 0} · B ${d.counts?.B ?? 0} · C ${d.counts?.C ?? 0} over ${d.window_days} days`;
      table(d.rows, [
        { key: 'class', label: 'Class', fmt: 'class', width: 60 },
        { key: 'code', label: 'Code', fmt: 'code', width: 110 },
        { key: 'name', label: 'Product' },
        { key: 'quantity', label: 'Issued', fmt: 'qty', width: 90 },
        { key: 'value', label: 'Value', fmt: 'cost', width: 110 },
        { key: 'share_pct', label: 'Share', fmt: 'pct', width: 70 },
        { key: 'cumulative_pct', label: 'Cumulative', fmt: 'pct', width: 90 },
      ]);
      break;
    case 'expiry':
      v.headline = `Expiring within ${d.window_days} days${num(d.expired_value) ? ` — ${money(d.expired_value, cur)} already expired` : ''}`;
      table(d.rows, [
        { key: 'batch_no', label: 'Batch', fmt: 'code', width: 110 },
        { key: 'name', label: 'Product' },
        { key: 'warehouse', label: 'Warehouse', width: 130 },
        { key: 'expiry_date', label: 'Expires', fmt: 'date', width: 100 },
        { key: 'days_to_expiry', label: 'Days', fmt: 'days', width: 70 },
        { key: 'on_hand', label: 'On hand', fmt: 'qty', width: 90 },
        { key: 'value', label: 'Value', fmt: 'cost', width: 100 },
      ]);
      break;
    case 'profitability':
      v.headline = `${d.from} to ${d.to}`;
      v.tiles = [
        ['Revenue', money(d.totals?.revenue, cur)],
        ['Cost of goods', money(d.totals?.cost, cur)],
        ['Margin', money(d.totals?.margin, cur)],
        ['Margin %', num(d.totals?.margin_pct) !== null ? `${d.totals.margin_pct}%` : '—'],
      ];
      table(d.rows, [
        { key: 'code', label: 'Code', fmt: 'code', width: 110 },
        { key: 'name', label: 'Product' },
        { key: 'quantity', label: 'Delivered', fmt: 'qty', width: 90 },
        { key: 'revenue', label: 'Revenue', fmt: 'cost', width: 110 },
        { key: 'cost', label: 'Cost', fmt: 'cost', width: 110 },
        { key: 'margin', label: 'Margin', fmt: 'cost', width: 110 },
        { key: 'margin_pct', label: 'Margin %', fmt: 'pct', width: 80 },
      ]);
      if (d.excluded) v.notes.push(`${n(d.excluded.invoices, 'invoice', 'invoices')} worth ${money(d.excluded.revenue, cur)}: ${d.excluded.note}`);
      break;
    case 'vendor':
      v.headline = `${d.from} to ${d.to}`;
      table(d.rows, [
        { key: 'name', label: 'Vendor' },
        { key: 'orders', label: 'Orders', width: 70 },
        { key: 'ordered_value', label: 'Ordered', fmt: 'cost', width: 120 },
        { key: 'receipts', label: 'Receipts', width: 80 },
        { key: 'received_value', label: 'Received', fmt: 'cost', width: 120 },
        { key: 'on_time_pct', label: 'On time', fmt: 'pct', width: 80 },
        { key: 'rating', label: 'Rating', width: 70 },
      ]);
      v.basis = 'On time is counted only over receipts against an order that gave an expected date. A vendor never judged shows a dash rather than 0%.';
      break;
    case 'serials':
      v.headline = n(d.total ?? 0, 'unit', 'units');
      v.chips = ((d.summary ?? []) as Array<{ status: string; count: number }>).map((s) => [SERIAL_STATE[s.status] ?? s.status, s.count]);
      table(d.rows, [
        { key: 'serial_no', label: 'Serial', fmt: 'code', width: 130 },
        { key: 'name', label: 'Product' },
        { key: 'status', label: 'State', fmt: 'status', width: 100 },
        { key: 'warehouse', label: 'Warehouse', width: 120 },
        { key: 'client', label: 'Customer', width: 140 },
        { key: 'invoice_no', label: 'Invoice', fmt: 'code', width: 110 },
        { key: 'warranty_end', label: 'Warranty ends', fmt: 'date', width: 110 },
        { key: 'unit_cost', label: 'Unit cost', fmt: 'cost', width: 100 },
      ]);
      if (d.capped) v.notes.push(`Showing the newest 1,000 of ${Number(d.total).toLocaleString()}. Narrow it by state or warehouse to see the rest — the count above is the true total.`);
      v.basis = 'One row per physical unit. A unit keeps its warehouse after it is sold, so a warehouse narrows the whole history, not only what is still on a shelf.';
      break;
    case 'serial-movement':
      table(d.rows, [
        { key: 'at', label: 'When', fmt: 'stamp', width: 130 },
        { key: 'serial_no', label: 'Serial', fmt: 'code', width: 130 },
        { key: 'name', label: 'Product' },
        { key: 'type', label: 'Movement', fmt: 'move', width: 120 },
        { key: 'ref', label: 'Reference', fmt: 'code', width: 110 },
        { key: 'warehouse', label: 'Warehouse', width: 120 },
        { key: 'user', label: 'By', width: 120 },
      ]);
      v.basis = 'Only movements that name a unit. Everything a serialised product does is one of these, so a gap here is a gap in the ledger.';
      break;
    case 'serial-warranty':
      v.headline = `${n(d.expired ?? 0, 'unit', 'units')} already out of warranty`;
      table(d.rows, [
        { key: 'serial_no', label: 'Serial', fmt: 'code', width: 130 },
        { key: 'name', label: 'Product' },
        { key: 'status', label: 'State', fmt: 'status', width: 100 },
        { key: 'client', label: 'Customer', width: 150 },
        { key: 'warranty_end', label: 'Ends', fmt: 'date', width: 100 },
        { key: 'days_left', label: 'Days left', fmt: 'days', width: 80 },
      ]);
      v.basis = `Units whose warranty ends within ${d.window_days} days, soonest first; below zero it has already run out. Units with no warranty recorded are not counted.`;
      break;
    case 'serial-labels':
      if (d.note) {
        v.notes.push(d.note);
        break;
      }
      v.tiles = [
        ['Units', Number(d.counts?.total ?? 0).toLocaleString()],
        ['No NFC tag', Number(d.counts?.without_nfc ?? 0).toLocaleString()],
        ['No barcode', Number(d.counts?.without_barcode ?? 0).toLocaleString()],
        ['No QR', Number(d.counts?.without_qr ?? 0).toLocaleString()],
      ];
      table(d.rows, [
        { key: 'serial_no', label: 'Serial', fmt: 'code', width: 130 },
        { key: 'name', label: 'Product' },
        { key: 'status', label: 'State', fmt: 'status', width: 100 },
        { key: 'warehouse', label: 'Warehouse', width: 120 },
        { key: 'barcode', label: 'Barcode', fmt: 'code', width: 130 },
        { key: 'nfc_uid', label: 'NFC tag', fmt: 'code', width: 130 },
      ]);
      v.basis = 'A QR reference is made for every unit and a barcode falls back to the serial, so the figure that means work is the NFC one — a tag has to be stuck on by somebody.';
      break;
  }
  return v;
}

// ── replenishment ───────────────────────────────────────────────────────

export interface ReorderItem {
  product_id: number;
  code: string | null;
  name: string;
  unit: string | null;
  warehouse_id: number;
  warehouse: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  incoming: number;
  minimum: number;
  maximum: number | null;
  suggested: number;
  per_day: number | null;
  days_cover: number | null;
  lead_days: number | null;
  vendor_id: number | null;
  vendor: string | null;
}

export const fetchReplenishment = (org: string, wh: number | null, signal?: AbortSignal) =>
  apiGet<{ items: ReorderItem[]; basis: string; window_days: number }>('/api/inventory/stock/replenishment', withOrg(org, wh ? { warehouse_id: wh } : {}), signal);

/** Purchase requests for what is below its minimum — all of it, or the products picked. */
export const raiseRequests = (org: string, wh: number | null, productIds: number[]) =>
  apiPost<{ ids: number[] }>('/api/inventory/requests/from-replenishment', { ...(org ? { org_id: Number(org) } : {}), ...(wh ? { warehouse_id: wh } : {}), ...(productIds.length ? { product_ids: productIds } : {}) });
