import type { PosCustomer, PosSellInput, PosTender, PosTenderMethod } from '@shared/pos';
import { parseAmount, settle, settles, type PricedCart } from './pricing';

/**
 * The tender screen's rules: the payments as typed, and the sale they make. Pure, so they are tested without a
 * screen. The figures are the cart's (WorkSuite's price, or the catalogue's preview offline — `source`); the change
 * is what the cashier hands back, cash only, as WorkSuite reckons it (`Sales::drawer`).
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
    .map(({ r, v }) => ({ method: r.method, amount: Math.round(v * 100) / 100, ...(r.reference.trim() && r.method !== 'cash' ? { reference: r.reference.trim().slice(0, 80) } : {}) }));
}

/** What is still to pay after the other rows: what a new row, or the one being typed, starts at. */
export function remaining(total: number, rows: TenderRow[], except?: number): number {
  const s = settle(total, tendersOf(rows.filter((_, i) => i !== except)));
  return s.due;
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
    totals: { subtotal: c.cart.subtotal, discount: c.cart.discount, tax: c.cart.tax, total: c.cart.total },
    tenders,
    change_given: s.change,
    priced_by: c.source,
    catalogue_version: c.catalogue_version,
    ...(c.note?.trim() ? { note: c.note.trim().slice(0, 200) } : {}),
  };
}
