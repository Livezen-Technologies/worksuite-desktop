import type { PosCustomer } from '@shared/pos';
import { createStore, useStore } from '../../core/store';
import type { CartLineInput } from './pricing';

/**
 * The cart being rung up: products and quantities, the customer, the cashier's discount. In memory only — the sale
 * is kept (sealed) by the main process once it is complete — and never a price: prices come from WorkSuite, or from
 * the catalogue as a preview. Pure functions, so the rules are tested without a screen.
 */
export interface CartState {
  lines: CartLineInput[];
  customer: PosCustomer | null;
  /** The cashier's percentage off, as typed. */
  discount: string;
}

export const EMPTY_CART: CartState = { lines: [], customer: null, discount: '' };

const MAX_QUANTITY = 100_000;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function addLine(s: CartState, productId: number, qty = 1): CartState {
  const have = s.lines.find((l) => l.product_id === productId);
  return {
    ...s,
    lines: have
      ? s.lines.map((l) => (l.product_id === productId ? { ...l, quantity: Math.min(MAX_QUANTITY, round4(l.quantity + qty)) } : l))
      : [...s.lines, { product_id: productId, quantity: Math.min(MAX_QUANTITY, round4(qty)) }],
  };
}

export function setQty(s: CartState, productId: number, qty: number): CartState {
  const q = Number.isFinite(qty) ? Math.min(MAX_QUANTITY, round4(qty)) : 0;
  return { ...s, lines: q <= 0 ? s.lines.filter((l) => l.product_id !== productId) : s.lines.map((l) => (l.product_id === productId ? { ...l, quantity: q } : l)) };
}

export function removeLine(s: CartState, productId: number): CartState {
  return { ...s, lines: s.lines.filter((l) => l.product_id !== productId) };
}

export function setCustomer(s: CartState, c: PosCustomer | null): CartState {
  const clean = c ? (Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v)) as PosCustomer) : null;
  return { ...s, customer: clean && Object.keys(clean).length ? clean : null };
}

/** The discount as typed, digits and one point, at most 100. */
export function setDiscount(s: CartState, typed: string): CartState {
  let d = typed.replace(/[^\d.]/g, '');
  const dot = d.indexOf('.');
  if (dot >= 0) d = d.slice(0, dot + 1) + d.slice(dot + 1).replace(/\./g, '');
  d = d.slice(0, 6);
  if (Number(d) > 100) d = '100';
  return { ...s, discount: d };
}

export function discountPct(s: CartState, allowed: boolean): number {
  return allowed ? Math.min(100, Number(s.discount) || 0) : 0;
}

export function itemCount(s: CartState): number {
  return round4(s.lines.reduce((a, l) => a + l.quantity, 0));
}

/** The register's cart: one per window, cleared after each sale. */
export const cart = createStore<CartState>(EMPTY_CART);

export const cartActions = {
  add: (id: number, qty = 1) => cart.set((s) => addLine(s, id, qty)),
  qty: (id: number, qty: number) => cart.set((s) => setQty(s, id, qty)),
  remove: (id: number) => cart.set((s) => removeLine(s, id)),
  customer: (c: PosCustomer | null) => cart.set((s) => setCustomer(s, c)),
  discount: (d: string) => cart.set((s) => setDiscount(s, d)),
  clear: () => cart.set(EMPTY_CART),
};

export function useCart(): CartState {
  return useStore(cart, (s) => s);
}
