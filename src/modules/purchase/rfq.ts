import { apiGet, apiPost } from '../../core/api';
import { PURCHASE_API } from '@shared/purchase';

/**
 * An RFQ's comparison and its per-line award (SRS-PUR-001 G-17; the "RFQ comparison" design), kept out of the screen
 * so it can be tested. The comparison is the server's (`GET /api/purchase/rfqs/{id}/comparison`): each line we asked
 * for with every vendor's bid on it, the cheapest and the fastest marked. Each line is awarded to one bid — the
 * cheapest by default, any other by choice, or none — and the award (`POST …/award {lines: [{rfq_line_id, bid_id}]}`)
 * raises one draft order per winning vendor, each sent through approval.
 */

export interface CompareBid {
  bid_id: number;
  vendor: string;
  vendor_id: number | null;
  unit_price: number | null;
  lead_days: number | null;
  total: number | null;
  currency: string | null;
  cheapest: boolean;
  fastest: boolean;
}

export interface CompareLine {
  rfq_line_id: number;
  product: string;
  qty: number;
  unit: string | null;
  target: number | null;
  bids: CompareBid[];
}

export interface Comparison {
  lines: CompareLine[];
  vendors: Array<{ bid_id: number | null; vendor: string; currency: string | null; lead_days: number | null; status: string | null }>;
  currency: string | null;
}

const n = (v: unknown): number | null => {
  const x = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(x) ? x : null;
};
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** The server's comparison, made safe to draw: bids without a price are kept (as "not quoted") but never cheapest. */
export function comparisonOf(raw: unknown): Comparison {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lines = (Array.isArray(r.lines) ? r.lines : []).map((x): CompareLine => {
    const l = (x ?? {}) as Record<string, unknown>;
    const qty = n(l.qty ?? l.quantity) ?? 0;
    return {
      rfq_line_id: Number(l.rfq_line_id ?? l.id),
      // The server sends the product as `{id, code, name}`, the target as `target_cost` per unit.
      product: (l.product && typeof l.product === 'object' ? s((l.product as Record<string, unknown>).name) : s(l.product)) ?? s(l.description) ?? 'Item',
      qty,
      unit: s(l.unit),
      target: n(l.target_cost ?? l.target),
      bids: (Array.isArray(l.bids) ? l.bids : []).map((y): CompareBid => {
        const b = (y ?? {}) as Record<string, unknown>;
        const unit = n(b.unit_price ?? b.unit_cost);
        return {
          bid_id: Number(b.bid_id ?? b.id),
          vendor: s(b.vendor) ?? 'Vendor',
          vendor_id: n(b.vendor_id),
          unit_price: unit,
          lead_days: n(b.lead_days ?? b.lead_time_days),
          total: n(b.total) ?? (unit !== null ? Math.round(unit * qty * 100) / 100 : null),
          currency: s(b.currency),
          cheapest: b.cheapest === true,
          fastest: b.fastest === true,
        };
      }),
    };
  });
  const vendors = (Array.isArray(r.vendors) ? r.vendors : []).map((x) => {
    const v = (x ?? {}) as Record<string, unknown>;
    return { bid_id: n(v.bid_id ?? v.id), vendor: s(v.vendor) ?? s(v.name) ?? 'Vendor', currency: s(v.currency), lead_days: n(v.lead_days ?? v.lead_time_days), status: s(v.status) };
  });
  const rfq = r.rfq && typeof r.rfq === 'object' ? (r.rfq as Record<string, unknown>) : {};
  return { lines, vendors, currency: s(r.currency) ?? s(rfq.currency) };
}

const priced = (b: CompareBid) => b.total !== null && b.unit_price !== null;

/** The bid to award a line to by default: the one the server marked cheapest, else the lowest priced, quickest on a tie. */
export function cheapestBid(l: CompareLine): CompareBid | null {
  const ok = l.bids.filter(priced);
  return ok.find((b) => b.cheapest) ?? [...ok].sort((a, b) => a.total! - b.total! || (a.lead_days ?? 999) - (b.lead_days ?? 999))[0] ?? null;
}

/** Line → the bid picked for it (null: not awarded now). */
export type Picks = Record<number, number | null>;

export function defaultPicks(c: Comparison): Picks {
  return Object.fromEntries(c.lines.map((l) => [l.rfq_line_id, cheapestBid(l)?.bid_id ?? null]));
}

/** Pick a bid for a line, or (the same bid again, or null) leave the line out. A bid without a price cannot be picked. */
export function pick(c: Comparison, picks: Picks, lineId: number, bidId: number | null): Picks {
  const line = c.lines.find((l) => l.rfq_line_id === lineId);
  if (!line) return picks;
  if (bidId === null || picks[lineId] === bidId) return { ...picks, [lineId]: null };
  const bid = line.bids.find((b) => b.bid_id === bidId);
  if (!bid || !priced(bid)) return picks;
  return { ...picks, [lineId]: bidId };
}

export interface AwardGroup {
  vendor: string;
  lines: number;
  total: number;
  currency: string | null;
}

/** One draft order per winning vendor: who, how many lines, how much. */
export function awardGroups(c: Comparison, picks: Picks): AwardGroup[] {
  const out = new Map<string, AwardGroup>();
  for (const l of c.lines) {
    const bid = l.bids.find((b) => b.bid_id === picks[l.rfq_line_id]);
    if (!bid || !priced(bid)) continue;
    const g = out.get(bid.vendor) ?? { vendor: bid.vendor, lines: 0, total: 0, currency: bid.currency };
    g.lines += 1;
    g.total = Math.round((g.total + bid.total!) * 100) / 100;
    out.set(bid.vendor, g);
  }
  return [...out.values()];
}

/** Against the target cost of the lines awarded: how much under (negative) or over, and by what share. */
export function savings(c: Comparison, picks: Picks): { target: number; awarded: number; diff: number; pct: number } | null {
  let target = 0;
  let awarded = 0;
  for (const l of c.lines) {
    const bid = l.bids.find((b) => b.bid_id === picks[l.rfq_line_id]);
    if (!bid || !priced(bid) || l.target === null) continue;
    target += l.target * (l.qty || 1);
    awarded += bid.total!;
  }
  if (target <= 0) return null;
  const diff = Math.round((awarded - target) * 100) / 100;
  return { target, awarded, diff, pct: Math.round((diff / target) * 1000) / 10 };
}

/** The award's body, or why it cannot go: at least one line, and a reason recorded (the server asks for one too). */
export function awardBody(c: Comparison, picks: Picks, reason: string): { body: { lines: Array<{ rfq_line_id: number; bid_id: number }>; reason: string } | null; error: string | null } {
  const lines = c.lines.filter((l) => picks[l.rfq_line_id] !== null && picks[l.rfq_line_id] !== undefined).map((l) => ({ rfq_line_id: l.rfq_line_id, bid_id: picks[l.rfq_line_id]! }));
  if (!lines.length) return { body: null, error: 'Pick a bid on at least one line.' };
  for (const x of lines) {
    const bid = c.lines.find((l) => l.rfq_line_id === x.rfq_line_id)?.bids.find((b) => b.bid_id === x.bid_id);
    if (!bid || !priced(bid)) return { body: null, error: 'A line is awarded to a bid with no price. Pick another.' };
  }
  if (!reason.trim()) return { body: null, error: 'Say why these vendors were chosen. Lowest price is a fine reason; it just has to be recorded.' };
  return { body: { lines, reason: reason.trim().slice(0, 500) }, error: null };
}

export const fetchComparison = (id: number, signal?: AbortSignal) => apiGet<unknown>(`${PURCHASE_API}/rfqs/${id}/comparison`, undefined, signal).then(comparisonOf);
export const awardRfq = (id: number, body: { lines: Array<{ rfq_line_id: number; bid_id: number }>; reason: string }) =>
  apiPost<{ orders?: Array<{ id: number; number?: string; po_number?: string; vendor?: string | null }> }>(`${PURCHASE_API}/rfqs/${id}/award`, body);
