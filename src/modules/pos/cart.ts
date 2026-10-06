import { useEffect } from 'react';
import { heldWithin, POS_MAX_OPEN, POS_MAX_HELD, type PosCarts, type PosCustomer } from '@shared/pos';
import { call } from '../../core/bridge';
import { createStore, useStore } from '../../core/store';
import type { CartLineInput } from './pricing';

/**
 * The sales being rung up: products and quantities, the customer, the cashier's discount — never a price: prices
 * come from WorkSuite, or from the catalogue as a preview. Up to five sales are open at once (one on screen, the
 * customer display following it), and a sale can be held — parked — for up to a day and recalled. They are the
 * till's, kept by the main process (sealed) so a restart keeps them (shared/pos.ts `PosCarts`); none reaches
 * WorkSuite until it is paid. Pure functions, so the rules are tested without a screen.
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

/** The discount as typed, digits and one point, at most 100 — or the cashier's ceiling (`max_discount_pct`). */
export function setDiscount(s: CartState, typed: string, ceiling: number | null = null): CartState {
  let d = typed.replace(/[^\d.]/g, '');
  const dot = d.indexOf('.');
  if (dot >= 0) d = d.slice(0, dot + 1) + d.slice(dot + 1).replace(/\./g, '');
  d = d.slice(0, 6);
  const max = ceiling != null && ceiling > 0 ? Math.min(100, ceiling) : 100;
  if (Number(d) > max) d = String(max);
  return { ...s, discount: d };
}

/** The percentage off this sale carries: none where the cashier may give none, never past their ceiling. */
export function discountPct(s: CartState, allowed: boolean, ceiling: number | null = null): number {
  if (!allowed) return 0;
  const max = ceiling != null && ceiling > 0 ? Math.min(100, ceiling) : 100;
  return Math.min(max, Number(s.discount) || 0);
}

export function itemCount(s: CartState): number {
  return round4(s.lines.reduce((a, l) => a + l.quantity, 0));
}

/* ── Open sales, and held ones ───────────────────────────────────────── */

export type TillCarts = PosCarts;
export type OpenSale = TillCarts['sales'][number];
export type HeldSale = TillCarts['held'][number];

export const MAX_OPEN = POS_MAX_OPEN;

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const iso = (now: number) => new Date(now).toISOString();

export function freshSale(now: number, id = newId()): OpenSale {
  return { id, cart: EMPTY_CART, started_at: iso(now) };
}

export function initialCarts(now = Date.now()): TillCarts {
  const s = freshSale(now);
  return { sales: [s], active: s.id, held: [] };
}

export function activeSale(s: TillCarts): OpenSale {
  return s.sales.find((x) => x.id === s.active) ?? s.sales[0]!;
}

/** Sales with something in them: what closing the register waits for. */
export function openWithLines(s: TillCarts): OpenSale[] {
  return s.sales.filter((x) => x.cart.lines.length > 0);
}

/** Another sale, on screen — none past five. An empty sale already open is gone to instead of opening one more. */
export function newSale(s: TillCarts, now: number, id = newId()): TillCarts {
  const empty = s.sales.find((x) => x.cart.lines.length === 0 && !x.cart.customer);
  if (empty) return empty.id === s.active ? s : { ...s, active: empty.id };
  if (s.sales.length >= MAX_OPEN) return s;
  const n = freshSale(now, id);
  return { ...s, sales: [...s.sales, n], active: n.id };
}

export function switchSale(s: TillCarts, id: string): TillCarts {
  return s.sales.some((x) => x.id === id) ? { ...s, active: id } : s;
}

/** Ctrl+1…5: the sale in that place on the strip. */
export function switchIndex(s: TillCarts, i: number): TillCarts {
  const x = s.sales[i];
  return x ? { ...s, active: x.id } : s;
}

/** A sale dropped (paid, or discarded): the one beside it comes on screen; the last one goes back to empty. */
export function dropSale(s: TillCarts, id: string, now: number): TillCarts {
  const i = s.sales.findIndex((x) => x.id === id);
  if (i < 0) return s;
  const rest = s.sales.filter((x) => x.id !== id);
  if (!rest.length) {
    const n = freshSale(now);
    return { ...s, sales: [n], active: n.id };
  }
  const active = s.active === id ? rest[Math.min(i, rest.length - 1)]!.id : s.active;
  return { ...s, sales: rest, active };
}

export function updateActive(s: TillCarts, fn: (c: CartState) => CartState): TillCarts {
  const a = activeSale(s);
  const next = fn(a.cart);
  if (next === a.cart) return s;
  // A sale's clock starts with its first item.
  const started = a.cart.lines.length === 0 && next.lines.length > 0 ? new Date().toISOString() : a.started_at;
  return { ...s, sales: s.sales.map((x) => (x.id === a.id ? { ...x, cart: next, started_at: started } : x)) };
}

/** Park the sale on screen (it must have something in it), with a note; the newest held comes first. */
export function holdSale(s: TillCarts, id: string, note: string, now: number): TillCarts {
  const x = s.sales.find((y) => y.id === id);
  if (!x || !x.cart.lines.length) return s;
  const held: HeldSale = { id: x.id, cart: x.cart, started_at: x.started_at, held_at: iso(now), note: note.trim().slice(0, 120) };
  const dropped = dropSale(s, id, now);
  return { ...dropped, held: [held, ...dropped.held].slice(0, POS_MAX_HELD) };
}

/**
 * Bring a held sale back on screen: into the empty sale on screen if it is empty, else as one more open sale. Null
 * when five are open already.
 */
export function recallSale(s: TillCarts, id: string): TillCarts | null {
  const h = s.held.find((x) => x.id === id);
  if (!h) return s;
  const held = s.held.filter((x) => x.id !== id);
  const back: OpenSale = { id: h.id, cart: h.cart, started_at: h.started_at };
  const a = activeSale(s);
  if (!a.cart.lines.length && !a.cart.customer) return { sales: s.sales.map((x) => (x.id === a.id ? back : x)), active: back.id, held };
  if (s.sales.length >= MAX_OPEN) return null;
  return { sales: [...s.sales, back], active: back.id, held };
}

export function discardHeld(s: TillCarts, id: string): TillCarts {
  return { ...s, held: s.held.filter((x) => x.id !== id) };
}

/** Held sales older than a day are discarded; the state is the same object when none was. */
export function expireHeld(s: TillCarts, now: number): TillCarts {
  const held = heldWithin(s.held, now);
  return held.length === s.held.length ? s : { ...s, held };
}

/* ── The store ───────────────────────────────────────────────────────── */

/** The till's open and held sales: one per window, as the main process keeps them. */
export const carts = createStore<TillCarts>(initialCarts());

export function activeCart(): CartState {
  return activeSale(carts.get()).cart;
}

const onActive = (fn: (c: CartState) => CartState) => carts.set((s) => updateActive(s, fn));

export const cartActions = {
  add: (id: number, qty = 1) => onActive((c) => addLine(c, id, qty)),
  qty: (id: number, qty: number) => onActive((c) => setQty(c, id, qty)),
  remove: (id: number) => onActive((c) => removeLine(c, id)),
  customer: (c: PosCustomer | null) => onActive((x) => setCustomer(x, c)),
  discount: (d: string, ceiling: number | null = null) => onActive((c) => setDiscount(c, d, ceiling)),
  /** Empty the sale on screen (it stays open). */
  clear: () => onActive(() => EMPTY_CART),
  /** The sale on screen was paid: it goes, and the next comes on screen. */
  paid: () => carts.set((s) => dropSale(s, s.active, Date.now())),
  /** False when five sales are open already, none of them empty. */
  newSale: (): boolean => {
    const before = carts.get();
    const full = before.sales.length >= MAX_OPEN && !before.sales.some((x) => !x.cart.lines.length && !x.cart.customer);
    carts.set((s) => newSale(s, Date.now()));
    return !full;
  },
  switchTo: (id: string) => carts.set((s) => switchSale(s, id)),
  switchIndex: (i: number) => carts.set((s) => switchIndex(s, i)),
  discard: (id: string) => carts.set((s) => dropSale(s, id, Date.now())),
  hold: (id: string, note = '') => carts.set((s) => holdSale(s, id, note, Date.now())),
  /** False when five sales are open already. */
  recall: (id: string): boolean => {
    const next = recallSale(carts.get(), id);
    if (!next) return false;
    carts.set(next);
    return true;
  },
  discardHeld: (id: string) => carts.set((s) => discardHeld(s, id)),
  expire: () => carts.set((s) => expireHeld(s, Date.now())),
  reset: () => carts.set(initialCarts()),
};

/** The sale on screen. */
export function useCart(): CartState {
  return useStore(carts, (s) => activeSale(s).cart);
}

export function useCarts(): TillCarts {
  return useStore(carts, (s) => s);
}

/**
 * Keep the till's open and held sales with the main process: read once for the till paired now, then saved a moment
 * after each change. Nothing is saved before they were read, so an empty start never overwrites what was kept; where
 * this computer cannot keep them (no desktop bridge), they live in memory. Held sales past their day are dropped
 * every minute.
 */
export function useKeptCarts(tillKey: string | null): void {
  useEffect(() => {
    if (!tillKey) return;
    let live = true;
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    cartActions.reset();
    call('pos:carts').then(
      (kept) => {
        if (!live) return;
        if (kept) carts.set(expireHeld(kept, Date.now()));
        ready = true;
      },
      () => undefined,
    );
    const off = carts.subscribe(() => {
      if (!ready) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void call('pos:cartsSave', carts.get()).catch(() => undefined), 300);
    });
    const tick = setInterval(() => cartActions.expire(), 60_000);
    return () => {
      live = false;
      off();
      clearInterval(tick);
      if (timer) {
        clearTimeout(timer);
        if (ready) void call('pos:cartsSave', carts.get()).catch(() => undefined);
      }
    };
  }, [tillKey]);
}
