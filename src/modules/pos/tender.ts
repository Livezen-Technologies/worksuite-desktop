import type { PosCustomer, PosSellInput, PosTender, PosTenderMethod, PosTenderOption } from '@shared/pos';
import { OFFLINE_TENDERS } from '@shared/pos';
import { deductionOf, parseAmount, settle, settles, type PricedCart } from './pricing';

/**
 * The tender screen's rules: the payments as typed, and the sale they make. Pure, so they are tested without a
 * screen. The figures are the cart's (WorkSuite's price, or the catalogue's preview offline — `source`); the change
 * is what the cashier hands back, cash only, as WorkSuite reckons it (`Sales::drawer`).
 *
 * Phase 2's tenders (`capabilities.tenders`) add LankaQR and other QR payments, a gift voucher (its code as the
 * reference, its balance looked up first), the customer's store credit and their account — the last two for a named
 * customer only, and none of them offline. WorkSuite checks them all again inside the sale (and refuses the whole sale,
 * writing nothing, when a voucher or the credit falls short); these say so before the customer is asked to wait.
 */
export interface TenderRow {
  method: PosTenderMethod;
  amount: string;
  reference: string;
}

/** The payments that carry an amount, as the sale records them. */
export function tendersOf(rows: TenderRow[]): PosTender[] {
  return rows
    .map((r) => ({ r, v: parseAmount(r.amount) }))
    .filter(({ v }) => Number.isFinite(v) && v > 0)
    .map(({ r, v }) => ({ method: r.method, amount: Math.round(v * 100) / 100, ...(r.reference.trim() && r.method !== 'cash' ? { reference: (r.method === 'voucher' ? r.reference.trim().toUpperCase() : r.reference.trim()).slice(0, 80) } : {}) }));
}

/** What is still to pay after the other rows: what a new row, or the one being typed, starts at. */
export function remaining(total: number, rows: TenderRow[], except?: number): number {
  const s = settle(total, tendersOf(rows.filter((_, i) => i !== except)));
  return s.due;
}

/** What the till knows of the balances a payment would spend (looked up through the till's door). */
export interface Balances {
  /** A voucher by its code: its balance, or null when WorkSuite has none by that code. */
  vouchers: Record<string, { balance: number; usable: boolean; expires_on?: string | null; problem?: string | null } | null>;
  /** The named customer's store credit, when read. */
  credit: number | null;
}

/**
 * Why these payments cannot be taken as they stand, or null: a tender not offered now (offline, or not the company's),
 * a voucher without its code or not checked, or for more than it holds, store credit or an account without a named
 * customer, or credit for more than the customer has.
 */
export function tenderProblem(rows: TenderRow[], o: { offered: PosTenderOption[]; customer: PosCustomer | null; balances: Balances; online: boolean; cardOffline?: boolean }): string | null {
  // Offline: cash, and a card only where the till's setting allows it (worksuite-desktop#296).
  const offlineOnly = o.cardOffline ? 'Only cash and card are taken while WorkSuite is out of reach.' : 'Only cash is taken while WorkSuite is out of reach.';
  const offlineOk = (m: PosTenderMethod) => m === 'cash' || (!!o.cardOffline && OFFLINE_TENDERS.has(m));
  for (const t of tendersOf(rows)) {
    const opt = o.offered.find((x) => x.kind === t.method);
    if (!opt) return o.online || offlineOk(t.method) ? 'That payment is not taken here.' : offlineOnly;
    if (!o.online && !offlineOk(t.method)) return offlineOnly;
    if (opt.needs_customer && !o.customer?.id) return `${opt.name || t.method}: attach the customer first (not a walk-in).`;
    if (t.method === 'voucher') {
      const code = (t.reference ?? '').toUpperCase();
      if (!code) return 'Type or scan the gift voucher’s code.';
      if (!(code in o.balances.vouchers)) return 'Check the voucher’s balance first.';
      const v = o.balances.vouchers[code];
      if (!v) return `There is no gift voucher ${code} here.`;
      if (!v.usable) return `The gift voucher ${code} cannot be used (spent, expired or void).`;
      if (t.amount > v.balance + 0.004) return `The gift voucher ${code} holds ${v.balance.toFixed(2)}.`;
    }
    if (t.method === 'store_credit' && o.balances.credit !== null && t.amount > o.balances.credit + 0.004) return `The customer has ${o.balances.credit.toFixed(2)} in store credit.`;
  }
  return null;
}

export interface SaleContext {
  session_id: number;
  register_id: number | null;
  currency: string;
  customer: PosCustomer | null;
  cart: PricedCart;
  source: 'server' | 'estimate';
  catalogue_version: string | null;
  note?: string;
  /* Phase 2 — each only where the server announced it (the screens decide; see `phase2Of`). */
  /** Ask WorkSuite for the counter's pricing (promotions) when the sale arrives: online, `capabilities.promotions`. */
  promotions?: boolean;
  coupon?: string | null;
  redeem?: number;
  approval_id?: string | null;
  /** #293: the cashier's discount as given — a fixed amount (`value` the money), or a percentage with a reason. */
  discount?: { type: 'pct' | 'amount'; value: number; reason?: string };
}

/**
 * Phase 2's part of the sale. Priced by WorkSuite online: the promotions it took (`apply_promotions`), the coupon and
 * the points. Priced here offline: `promotion_ids` — the promotions the till applied, none (`[]`), so WorkSuite keeps
 * the till's price. The CRM customer either way; a manager's approval where one was given.
 */
export function phase2Of(c: SaleContext): Partial<PosSellInput> {
  const out: Partial<PosSellInput> = {};
  if (c.customer?.id) out.customer_id = c.customer.id;
  if (c.source === 'estimate') {
    if (c.promotions) out.promotion_ids = [];
  } else {
    if (c.promotions) out.apply_promotions = true;
    if (c.coupon) out.coupon_code = c.coupon;
    if (c.redeem && c.redeem > 0 && c.customer?.id) out.redeem_points = c.redeem;
  }
  if (c.approval_id) out.approval_id = c.approval_id;
  // #293: a coupon WorkSuite applied prints as its own line (`Coupon CODE`), not again among the promotions.
  const coupon = c.source !== 'estimate' && c.coupon && c.cart.coupon?.valid && (c.cart.coupon_discount ?? c.cart.coupon.amount) > 0 ? { code: c.coupon, amount: c.cart.coupon_discount ?? c.cart.coupon.amount } : null;
  const promos = (c.cart.promotions ?? []).filter((p) => !(coupon && p.coupon));
  if (promos.length) out.promotions = promos.map((p) => ({ label: p.label.slice(0, 80), amount: p.amount }));
  if (coupon) out.coupon = coupon;
  if (c.cart.points_redeemed && c.cart.points_discount) out.points = { redeemed: c.cart.points_redeemed, discount: c.cart.points_discount };
  return out;
}

/** The sale to ring up, or why not yet. */
export function buildSale(c: SaleContext, rows: TenderRow[]): PosSellInput | { error: string } {
  if (!c.cart.lines.length) return { error: 'The cart is empty.' };
  if (!/^[A-Z]{3}$/.test(c.currency)) return { error: 'The company’s currency is not known yet. Open the register with WorkSuite reachable once.' };
  const tenders = tendersOf(rows);
  if (!tenders.length) return { error: 'Take a payment first.' };
  const s = settle(c.cart.total, tenders);
  if (s.overCharged) return { error: 'A card, transfer or wallet cannot be charged more than the sale. Take the difference in cash, or lower it.' };
  if (!settles(c.cart.total, tenders)) return { error: `${s.due.toFixed(2)} is still due.` };
  return {
    session_id: c.session_id,
    register_id: c.register_id,
    currency: c.currency,
    customer: c.customer,
    lines: c.cart.lines,
    discount_pct: c.cart.discount_pct,
    // The order's discount: promotions, the cashier's and points together (subtotal − discount + tax = total).
    totals: { subtotal: c.cart.subtotal, discount: deductionOf(c.cart), tax: c.cart.tax, total: c.cart.total },
    tenders,
    change_given: s.change,
    priced_by: c.source,
    catalogue_version: c.catalogue_version,
    ...(c.note?.trim() ? { note: c.note.trim().slice(0, 200) } : {}),
    ...phase2Of(c),
    ...discountOf(c),
  };
}

/**
 * The cashier's discount as the sale states it (#293): a fixed amount (`discount_pct` then the share WorkSuite or the
 * preview said it came to), and its reason — only where some discount was given. None: nothing, as before.
 */
export function discountOf(c: Pick<SaleContext, 'discount' | 'cart'>): Partial<PosSellInput> {
  if (!c.discount || !(c.cart.discount > 0)) return {};
  const reason = c.discount.reason?.trim().slice(0, 200);
  return {
    ...(c.discount.type === 'amount' && c.discount.value > 0 ? { discount_type: 'amount' as const, discount_value: Math.round(c.discount.value * 100) / 100 } : {}),
    ...(reason ? { discount_reason: reason } : {}),
  };
}
