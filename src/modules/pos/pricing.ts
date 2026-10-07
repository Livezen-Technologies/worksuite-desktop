import type { PosProduct, PosSaleLine, PosTender, PosTenderMethod, PosTenderOption } from '@shared/pos';
import { LEGACY_TENDERS, OFFLINE_TENDERS } from '@shared/pos';

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
  /** The cashier's discount. subtotal − discount + tax = total (with Phase 2's pricing, − deduction). */
  discount: number;
  tax: number;
  total: number;
  /* Phase 2, the counter's pricing (`apply_promotions`, `customer_id`, `coupon_code`, `redeem_points`): absent otherwise. */
  /** What promotions took off, each (`promotions`), and in all; `coupon` marks the one a coupon unlocked. */
  promotions?: Array<{ id: number; label: string; amount: number; coupon?: boolean }>;
  promotion_discount?: number;
  /* #293 (`capabilities.discount_amount`, `coupon_validate`): absent on an older server. */
  /** The cashier's discount was a fixed amount (`discount_value`); `discount_pct` is then the share it came to. */
  discount_type?: 'pct' | 'amount';
  discount_value?: number;
  /** What the coupon's promotion took off (part of `promotion_discount`). */
  coupon_discount?: number;
  /** The coupon the cart names: what it took off, or why it took nothing (`reason`, `message`). */
  coupon?: { code: string; amount: number; valid: boolean; reason: string | null; message: string | null } | null;
  points_discount?: number;
  points_redeemed?: number;
  /** Promotions + the cashier's discount + points: the order's discount. */
  deduction?: number;
  /** WorkSuite's notes on it (an unusable coupon ignored…). */
  notes?: string[];
}

/** The whole deduction: promotions, the cashier's discount, points (the cashier's alone on an older server). */
export function deductionOf(c: PricedCart): number {
  return c.deduction ?? c.discount;
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

/** What the cashier's discount comes off: the goods after their list discounts and the promotions (a coupon is one). */
export function discountBase(c: Pick<PricedCart, 'subtotal' | 'promotion_discount'>): number {
  return Math.max(0, Math.round((c.subtotal - (c.promotion_discount ?? 0)) * 100) / 100);
}

/** The percentage a fixed amount comes to, of what it comes off, to four places; all of it past that or of nothing. */
export function shareOf(amount: number, base: number): number {
  if (!(amount > 0)) return 0;
  if (!(base > 0) || amount >= base) return 100;
  return Math.round((amount / base) * 100 * 10_000) / 10_000;
}

/** The message WorkSuite gives for an amount past what is left of the sale. */
export function overMessage(base: number): string {
  return `A discount cannot be more than the sale comes to (${base.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).`;
}

/**
 * The cart as WorkSuite would price it from this catalogue (quantity bands aside: the catalogue carries one unit).
 * `amount`: the cashier's discount as a fixed amount (#293) rather than `discountPct`.
 */
export function estimateCart(lines: CartLineInput[], products: Map<number, PosProduct>, discountPct: number, ceiling: number | null, currency: string, amount: number | null = null): Estimate {
  const known = lines.map((l) => ({ l, p: products.get(l.product_id) })).filter((x): x is { l: CartLineInput; p: PosProduct } => !!x.p && x.l.quantity > 0);
  const gross = known.map(({ l, p }) => Math.round(l.quantity * p.price * 100 + 1e-7));
  const lineOff = known.map(({ p }, i) => percentOf(gross[i]!, p.discount_pct));
  const nets = gross.map((g, i) => g - lineOff[i]!);
  const subtotal = nets.reduce((a, x) => a + x, 0);
  const lineOffTotal = lineOff.reduce((a, x) => a + x, 0);
  const fixed = amount !== null && amount > 0 ? Math.round(amount * 100) : null;
  const pct = fixed !== null ? shareOf(fixed / 100, subtotal / 100) : Math.max(0, Math.min(100, discountPct || 0));
  const off = fixed !== null ? Math.min(fixed, subtotal) : pct > 0 ? percentOf(subtotal, pct) : 0;
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
    ...(fixed !== null ? { discount_type: 'amount' as const, discount_value: money(fixed) } : {}),
  };
  if (fixed !== null && fixed > subtotal) return { cart, error: overMessage(money(subtotal)) };
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

/**
 * Which tenders may be taken now: the company's configured ones (`capabilities.tenders`), else the four every server
 * takes — all online; offline only those that may be (cash and the shop's own card machine).
 */
export function allowedTenders(online: boolean, configured?: PosTenderOption[] | null): PosTenderOption[] {
  const list: PosTenderOption[] = configured?.length
    ? configured
    : LEGACY_TENDERS.map((k) => ({ kind: k, name: '', opens_drawer: k === 'cash', offline: OFFLINE_TENDERS.has(k), needs_customer: false, needs_reference: false }));
  return list.filter((t) => online || (t.offline && OFFLINE_TENDERS.has(t.kind)));
}

/** The kinds only (the screens' older shape). */
export function allowedMethods(online: boolean, configured?: PosTenderOption[] | null): PosTenderMethod[] {
  return allowedTenders(online, configured).map((t) => t.kind);
}

/**
 * A discount a manager approved past the cashier's own rights: WorkSuite prices the sale under the approver's rights
 * when it arrives (`approval_id`), but its price door answers only for the cashier — so the cart is priced there
 * without the discount and the percentage is taken here the way WorkSuite takes it (`Cart::quote`): off the goods
 * after their list discounts and promotions, spread over the lines by largest remainder before the tax, points after.
 * A preview: the sale is priced again by WorkSuite.
 */
export function withDiscount(c: PricedCart, pct: number, amount: number | null = null): PricedCart {
  const p = Math.max(0, Math.min(100, pct || 0));
  if ((p <= 0 && !(amount && amount > 0)) || !c.lines.length) return c;
  const nets = c.lines.map((l) => Math.round(l.net * 100));
  const goods = nets.reduce((a, x) => a + x, 0);
  const promo = Math.min(Math.round((c.promotion_discount ?? 0) * 100), goods);
  const points = Math.round((c.points_discount ?? 0) * 100);
  // A fixed amount (#293) comes off where the percentage would, never more than is left.
  const off = amount && amount > 0 ? Math.min(Math.round(amount * 100), goods - promo) : percentOf(goods - promo, p);
  const deduction = Math.min(goods, promo + off + points);
  const spread = allocate(deduction, nets);
  let tax = 0;
  const lines = c.lines.map((l, i) => {
    const taxable = nets[i]! - spread[i]!;
    const t = l.tax_rate > 0 ? percentOf(taxable, l.tax_rate) : 0;
    tax += t;
    return { ...l, tax: money(t), total: money(taxable + t) };
  });
  return {
    ...c,
    lines,
    discount_pct: amount && amount > 0 ? shareOf(off / 100, (goods - promo) / 100) : p,
    discount: money(off),
    tax: money(tax),
    total: money(goods - deduction + tax),
    ...(c.deduction !== undefined || promo || points ? { deduction: money(deduction) } : {}),
    ...(amount && amount > 0 ? { discount_type: 'amount' as const, discount_value: amount } : {}),
  };
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
