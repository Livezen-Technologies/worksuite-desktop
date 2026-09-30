import type { PosProduct, PosSaleLine, PosTender, PosTenderMethod } from '@shared/pos';
import { OFFLINE_TENDERS } from '@shared/pos';

/**
 * Display arithmetic only (ported from the mobile till's pricing.ts). WorkSuite prices every sale; with the line down
 * the register still has to show a total to take money against, so this is the same arithmetic run on the catalogue's
 * one-unit prices — integer cents, half away from zero, the cashier's discount spread over the lines by largest
 * remainder before the tax — and the sale is marked `priced_by: 'estimate'` (provisional). Nothing here is sent to
 * WorkSuite as a price it uses.
 */

export interface CartLineInput {
  product_id: number;
  quantity: number;
}

export interface PricedCart {
  currency: string;
  lines: PosSaleLine[];
  /** The goods after their list discounts. */
  subtotal: number;
  line_discount: number;
  discount_pct: number;
  /** The cashier's discount. subtotal − discount + tax = total. */
  discount: number;
  tax: number;
  total: number;
}

const cents = (v: number) => Math.round(Math.abs(v) * 100 + 1e-7) * Math.sign(v);
const money = (c: number) => Math.round(c) / 100;
/** Half away from zero, as Billing's `Money::percent`. */
const percentOf = (c: number, pct: number) => {
  const raw = (c * pct) / 100;
  return Math.sign(raw) * Math.floor(Math.abs(raw) + 0.5 + 1e-9);
};

/** Split `total` cents across weights so the parts sum exactly to it (Billing's `Money::allocate`). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum === 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  const left = total - shares.reduce((a, s) => a + s, 0);
  const order = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w || a.i - b.i);
  for (let k = 0; k < left; k++) shares[order[k % order.length]!.i]! += 1;
  return shares;
}

/** The ceiling message, as WorkSuite words it (Orders' `oms_max_discount_pct`). */
export function ceilingMessage(taken: number, ceiling: number): string {
  return `That would take ${taken.toFixed(1)}% off this sale, and ${ceiling}% is the most allowed.`;
}

export type Estimate = { cart: PricedCart; error: string | null };

/** The cart as WorkSuite would price it from this catalogue (quantity bands aside: the catalogue carries one unit). */
export function estimateCart(lines: CartLineInput[], products: Map<number, PosProduct>, discountPct: number, ceiling: number | null, currency: string): Estimate {
  const known = lines.map((l) => ({ l, p: products.get(l.product_id) })).filter((x): x is { l: CartLineInput; p: PosProduct } => !!x.p && x.l.quantity > 0);
  const gross = known.map(({ l, p }) => Math.round(l.quantity * p.price * 100 + 1e-7));
  const lineOff = known.map(({ p }, i) => percentOf(gross[i]!, p.discount_pct));
  const nets = gross.map((g, i) => g - lineOff[i]!);
  const subtotal = nets.reduce((a, x) => a + x, 0);
  const lineOffTotal = lineOff.reduce((a, x) => a + x, 0);
  const pct = Math.max(0, Math.min(100, discountPct || 0));
  const off = pct > 0 ? percentOf(subtotal, pct) : 0;
  const spread = off > 0 && subtotal > 0 ? allocate(Math.min(off, subtotal), nets) : nets.map(() => 0);
  const out = known.map(({ l, p }, i) => {
    const taxable = nets[i]! - spread[i]!;
    const tax = p.tax_rate > 0 ? percentOf(taxable, p.tax_rate) : 0;
    return { line: { product_id: p.id, code: p.code, name: p.name, quantity: l.quantity, unit_price: p.price, discount_pct: p.discount_pct, tax_rate: p.tax_rate, net: money(nets[i]!), tax: money(tax), total: money(taxable + tax) }, tax };
  });
  const taxTotal = out.reduce((a, x) => a + x.tax, 0);
  const deduction = Math.min(off, subtotal);
  const cart: PricedCart = {
    currency,
    lines: out.map((x) => x.line),
    subtotal: money(subtotal),
    line_discount: money(lineOffTotal),
    discount_pct: pct,
    discount: money(deduction),
    tax: money(taxTotal),
    total: money(subtotal - deduction + taxTotal),
  };
  const grossTotal = subtotal + lineOffTotal;
  if (ceiling && ceiling > 0 && off > 0 && grossTotal > 0 && ((lineOffTotal + off) / grossTotal) * 100 > ceiling + 0.0001) {
    return { cart, error: ceilingMessage(((lineOffTotal + off) / grossTotal) * 100, ceiling) };
  }
  return { cart, error: null };
}

/* ── Paying ──────────────────────────────────────────────────────────── */

export interface Settlement {
  cash: number;
  other: number;
  /** Change the drawer hands back: only cash is ever given back. */
  change: number;
  paid: number;
  /** total − paid: above 0 still due. */
  due: number;
  /** A card, transfer or wallet for more than the total. */
  overCharged: boolean;
}

/** What a set of tenders does against a total — the rule WorkSuite checks too (`Sales::drawer`). */
export function settle(total: number, tenders: Pick<PosTender, 'method' | 'amount'>[]): Settlement {
  const t = cents(total);
  const cash = tenders.filter((x) => x.method === 'cash').reduce((a, x) => a + cents(x.amount), 0);
  const other = tenders.filter((x) => x.method !== 'cash').reduce((a, x) => a + cents(x.amount), 0);
  const over = Math.max(0, cash + other - t);
  const change = Math.min(over, cash);
  const paid = cash + other - change;
  return { cash: money(cash), other: money(other), change: money(change), paid: money(paid), due: money(Math.max(0, t - paid)), overCharged: other > t };
}

/** Whether these tenders settle the total: nothing due, and no card charged for more than the sale. */
export function settles(total: number, tenders: Pick<PosTender, 'method' | 'amount'>[]): boolean {
  const s = settle(total, tenders);
  return total >= 0 && s.due <= 0 && !s.overCharged && tenders.some((t) => t.amount > 0);
}

/** Amounts a cashier is likely to be handed: exact, then the total rounded up to notes worth at least a twentieth of it. */
export function quickCash(total: number, denominations: number[]): number[] {
  const steps = [...new Set(denominations.filter((d) => d >= 1 && d >= total / 20))].sort((a, b) => a - b);
  const out = [total];
  for (const step of steps) {
    const up = Math.ceil(total / step) * step;
    if (up > total && !out.includes(up)) out.push(up);
    if (out.length >= 4) break;
  }
  return out;
}

/** Which tenders may be taken now: all online; offline only cash and the shop's own card machine. */
export function allowedTenders(online: boolean): PosTenderMethod[] {
  return (['cash', 'card', 'bank_transfer', 'wallet'] as PosTenderMethod[]).filter((m) => online || OFFLINE_TENDERS.has(m));
}

/* ── Counting the drawer ─────────────────────────────────────────────── */

export interface CountLine {
  value: number;
  count: number;
}

/** A count's total: notes and coins × how many (WorkSuite's `Counting::clean` adds them the same way). */
export function countTotal(lines: CountLine[]): number {
  return money(lines.reduce((a, l) => a + cents(l.value) * Math.max(0, Math.floor(l.count || 0)), 0));
}

/** Only the piles that were counted, as WorkSuite reads them. */
export function countBody(lines: CountLine[]): CountLine[] {
  return lines.filter((l) => l.count > 0).map((l) => ({ value: l.value, count: Math.floor(l.count) }));
}

/** counted − expected, or null when the figure is hidden (blind close) or nothing was counted. */
export function variance(counted: number | null, expected: number | null): number | null {
  if (counted == null || expected == null || !Number.isFinite(counted)) return null;
  return money(cents(counted) - cents(expected));
}

export function parseAmount(v: string): number {
  const s = v.replace(/,/g, '').trim();
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function formatMoney(v: number | null | undefined, currency?: string | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
}
