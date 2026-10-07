import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { PosCatalogue, PosCustomer, PosGiveBack, PosPrintPatch, PosPrintSettings, PosProduct, PosReport, PosSale, PosSellInput, PosTillStatus } from '@shared/pos';
import { apiGet, ApiError, request } from '../../core/api';
import { call, on } from '../../core/bridge';
import { estimateCart, withDiscount, type CartLineInput, type PricedCart } from './pricing';

/**
 * POS's two halves, for the screens.
 *
 * The drawer — options, registers, sessions, cash in and out, the close — is WorkSuite's staff API (`/api/pos`),
 * reached through the app's proxy with the signed-in person's session, exactly as the web's POS pages reach it.
 *
 * The till — pairing, the catalogue copy, the sales and their outbox, the printer, the customer display — is the main
 * process's (`pos:*`, electron/services/pos-ipc.ts): the till's credential never reaches this window.
 *
 * What the till sells and at what price — the catalogue, a barcode lookup, the cart's price — is POS's own
 * (`/api/pos/catalogue`, `products/lookup`, `price`, `pos.access`: a cashier needs no Inventory permission) where
 * WorkSuite announces it (`options.capabilities`); only an older server without them has Inventory stand in. Refunds,
 * voids, WorkSuite's receipt and e-mailing it are the till's door's (`pos:giveBack`, `pos:receipt`, `pos:email`: one
 * of this till's sales by its receipt number, the cashier named). See docs/BACKEND.md.
 */
const BASE = '/api/pos';

export const PK = {
  all: ['pos'] as const,
  till: ['pos', 'till'] as const,
  catalogue: ['pos', 'catalogue'] as const,
  options: ['pos', 'options'] as const,
  registers: ['pos', 'registers'] as const,
  session: (id: number) => ['pos', 'session', id] as const,
  sales: (f: unknown) => ['pos', 'sales', f] as const,
  sale: (ref: string) => ['pos', 'sale', ref] as const,
  setup: ['pos', 'setup'] as const,
  print: ['pos', 'print'] as const,
  printers: ['pos', 'printers'] as const,
};

/* ── The server's shapes ─────────────────────────────────────────────── */

export interface PosCan {
  sell: boolean;
  open: boolean;
  close: boolean;
  cash_in: boolean;
  cash_out: boolean;
  view_all: boolean;
  settings: boolean;
  terminals: boolean;
  /** `pos.sale.refund` / `pos.sale.void` in this company (absent on an older server: no). */
  refund?: boolean;
  void?: boolean;
  /** `pos.sale.discount`: whether the person may take money off a sale at all. */
  discount?: boolean;
  /** `pos.sale.discount.override`: past the company's ceiling. */
  discount_override?: boolean;
  /** The most they may take off, in percent: null no ceiling, 0 none. */
  max_discount_pct?: number | null;
  /** #293: `pos.sale.voucher.accept` — may take a gift voucher as payment (absent on an older server: as before, yes). */
  voucher?: boolean;
}

/** How a drawer closes in the company (the POS settings). */
export interface PosRules {
  /** Counted note by note: one typed figure is refused. */
  count_to_close: boolean;
  /** The figure the drawer should hold is not shown. */
  blind_close: boolean;
  /** A count this far out closes without a reason. */
  variance_tolerance: number;
}

export interface PosCompany {
  id: number;
  name: string;
  currency: string;
  today: string | null;
  can: PosCan;
  rules?: PosRules;
  /** Phase 2: the tenders this company takes, active, in order (`capabilities.tenders`). */
  tenders?: unknown;
  /** Phase 2: the figure past which a manager approves a refund, void or cash out (`approvals`). */
  approvals?: { manager_above_amount?: number; cash_drop_limit?: number; held_expiry_hours?: number; may_approve?: boolean };
}

/** What WorkSuite announces it can do for a till (not on every server yet: absent means no). */
export interface PosCapabilities {
  catalogue?: boolean;
  price?: boolean;
  lookup?: boolean;
  device_catalogue?: boolean;
  sales?: boolean;
  refund?: boolean;
  void?: boolean;
  receipt?: boolean;
  email?: boolean;
  email_receipt?: boolean;
  settle?: boolean;
  reprice?: boolean;
  discount_rights?: boolean;
  review?: boolean;
  /** A sale needs an open register (refused `drawer_closed`); every server that says so means it, and so does this till. */
  drawer_required?: boolean;
  /** A sale made while a since-closed register was open is still taken into it, flagged `late`. */
  late_sales?: boolean;
  /** A till sale with no tenders is recorded unpaid and flagged `payment_missing`. */
  payment_missing?: boolean;
  /** Sales carry `flags` (`price_differs`, `payment_missing`, `late`). */
  flags?: boolean;
  customer_display?: boolean;
  /* Phase 2 S1: sales and control. */
  held?: boolean;
  tenders?: boolean;
  vouchers?: boolean;
  store_credit?: boolean;
  approvals?: boolean;
  remote_approvals?: boolean;
  refund_to?: boolean;
  line_condition?: boolean;
  journal?: boolean;
  export?: boolean;
  /* Phase 2 S2: the catalogue, prices and promotions, customers and loyalty. */
  stock?: boolean;
  category_tree?: boolean;
  product_images?: boolean;
  top_sellers?: boolean;
  favourites?: boolean;
  promotions?: boolean;
  coupons?: boolean;
  price_rules?: boolean;
  customers?: boolean;
  loyalty?: boolean;
  /* Phase 2 S3: reports and devices. */
  overview?: boolean;
  reports?: boolean;
  session_report?: boolean;
  session_review?: boolean;
  receipt_templates?: boolean;
  device_unpair?: boolean;
  device_rename?: boolean;
  /* #293: discount, coupon and gift voucher on the payment screen. */
  /** A fixed amount off with a reason (`discount_type: amount`). */
  discount_amount?: boolean;
  /** `POST coupons/validate`, and `coupon_report` on the price. */
  coupon_validate?: boolean;
  /** Gift vouchers on by default and their own right (`can.voucher`). */
  voucher_accept?: boolean;
  /** A void or full refund gives a coupon's use back. */
  coupon_restore?: boolean;
  /** The sale keeps its discount and coupon (`adjustments` on the receipt). */
  sale_adjustments?: boolean;
}

export interface PosOptions {
  companies: PosCompany[];
  cash_reasons: { in: string[]; out: string[] };
  denominations: Record<string, number[]>;
  capabilities?: PosCapabilities;
}

export interface PosRegister {
  id: number;
  org_id: number;
  code: string;
  name: string;
  branch: string | null;
  warehouse: string | null;
  terminal_id: number | null;
  terminal: string | null;
  active: boolean;
  session: { id: number; opened_at: string | null; cashier: string | null; is_mine: boolean } | null;
}

export interface PosSession {
  id: number;
  org_id: number;
  register_id: number;
  register: string | null;
  register_code: string | null;
  terminal_id: number | null;
  currency: string;
  status: 'open' | 'closed';
  opening_float: number;
  opened_at: string | null;
  cashier: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  expected_cash: number | null;
  counted_cash: number | null;
  variance: number | null;
  variance_reason: string | null;
  note: string | null;
  /** Blind close: the expected cash never leaves the server while the drawer is open. */
  blind?: boolean;
  takings?: { cash_in: number | null; cash_change: number | null; moved_in: number; moved_out: number; expected: number | null };
  denominations?: number[];
}

export interface PosMovement {
  id: number;
  direction: 'in' | 'out';
  amount: number;
  reason: string;
  reference: string | null;
  by: string | null;
  at: string | null;
}

export interface PosCount {
  id: number;
  kind: 'open' | 'close';
  total: number;
  lines: Array<{ value: number; count: number; amount: number }>;
}

export interface PosBindable {
  id: number;
  code: string;
  name: string;
  org_id: number;
  org_name: string | null;
  branch_name: string | null;
  warehouse_id: number | null;
  warehouse_name: string | null;
  in_use: boolean;
  device_name: string | null;
}

/* ── The drawer (staff API) ──────────────────────────────────────────── */

export const fetchOptions = (signal?: AbortSignal) => apiGet<PosOptions>(`${BASE}/options`, undefined, signal);
export const fetchRegisters = (signal?: AbortSignal) => apiGet<{ items: PosRegister[]; session: PosSession | null }>(`${BASE}/registers`, undefined, signal);
export const fetchSession = (id: number, signal?: AbortSignal) => apiGet<{ session: PosSession; movements: PosMovement[]; counts: PosCount[] }>(`${BASE}/sessions/${id}`, undefined, signal);
export const fetchSetup = (signal?: AbortSignal) => apiGet<{ terminals: PosBindable[] }>(`${BASE}/setup`, undefined, signal);

export async function openSession(body: { register_id: number; opening_float: number; denominations?: Array<{ value: number; count: number }>; note?: string }): Promise<{ id: number; message: string | null }> {
  const r = await request<{ id: number }>('POST', `${BASE}/sessions`, { body });
  return { id: r.data.id, message: r.message ?? null };
}

/** Cash in or out of the drawer; `approval_id` a manager's approval for cash out past the company's figure (Phase 2). */
export async function cashMove(sessionId: number, body: { direction: 'in' | 'out'; amount: number; reason: string; reference?: string; approval_id?: string }): Promise<string | null> {
  return (await request('POST', `${BASE}/sessions/${sessionId}/cash`, { body })).message ?? null;
}

export async function closeSession(sessionId: number, body: CloseBody): Promise<{ variance: number | null; message: string | null }> {
  const r = await request<{ variance?: number }>('POST', `${BASE}/sessions/${sessionId}/close`, { body });
  return { variance: typeof r.data?.variance === 'number' ? r.data.variance : null, message: r.message ?? null };
}

export interface CloseBody {
  denominations?: Array<{ value: number; count: number }>;
  counted_cash?: number;
  variance_reason?: string;
}

/**
 * What the signed-in person may take off a sale here: nothing without `can.discount`; up to `can.max_discount_pct`
 * (0 is none), with no ceiling under `can.discount_override`. An older server that does not say offers no discount.
 */
export function discountRights(can: PosCan | null | undefined): { allowed: boolean; ceiling: number | null } {
  if (!can?.discount) return { allowed: false, ceiling: null };
  if (can.discount_override) return { allowed: true, ceiling: null };
  const max = typeof can.max_discount_pct === 'number' && Number.isFinite(can.max_discount_pct) ? can.max_discount_pct : null;
  if (max !== null && max <= 0) return { allowed: false, ceiling: null };
  return { allowed: true, ceiling: max };
}

/** Whether a refund / void of this till's sales can be offered: the server does it, and the person may. */
export function mayGiveBack(caps: PosCapabilities, can: PosCan | null | undefined, kind: 'refund' | 'void'): boolean {
  return !!caps[kind] && !!can?.[kind];
}

/* ── The till (main process) ─────────────────────────────────────────── */

export const tillStatus = () => call('pos:till');
export const pairTill = (terminal_id: number, take_over = false, device_name?: string) => call('pos:pair', { terminal_id, take_over, ...(device_name?.trim() ? { device_name: device_name.trim().slice(0, 120) } : {}) });
export const renameDevice = (device_name: string) => call('pos:rename', { device_name });
export const forgetTill = (discard = false, unpair = false) => call('pos:forget', { discard, ...(unpair ? { unpair } : {}) });
export const readCatalogue = () => call('pos:catalogue');
export const refreshCatalogue = (capable?: boolean) => call('pos:catalogueRefresh', capable === undefined ? {} : { capable });
export const sell = (input: PosSellInput) => call('pos:sell', input);
export const listSales = (f: { session_id?: number; since?: string; limit?: number } = {}) => call('pos:sales', f);
export const readSale = (ref: string) => call('pos:sale', { ref });
export const syncNow = () => call('pos:syncNow');
/** Send a refused sale again (into `sessionId`, the register open now, when it was refused for its drawer), or drop it. */
export const resolveSale = (ref: string, action: 'retry' | 'drop', sessionId?: number) => call('pos:resolve', { ref, action, ...(sessionId ? { session_id: sessionId } : {}) });
export const printSettings = () => call('pos:printSettings');
export const setPrintSettings = (p: PosPrintPatch) => call('pos:printSettingsSet', p);
export const printReceipt = (ref: string, reprint = true, server = false) => call('pos:printReceipt', { ref, reprint, server });
export const serverReceipt = (ref: string) => call('pos:receipt', { ref });
export const giveBack = (input: PosGiveBack) => call('pos:giveBack', input);
export const emailReceipt = (ref: string, email?: string) => call('pos:email', email ? { ref, email } : { ref });
export const printReport = (r: PosReport) => call('pos:printReport', r);
export const printTest = () => call('pos:printTest');
export const openDrawer = () => call('pos:openDrawer');
export const openDisplay = () => call('pos:displayOpen');
export const closeDisplay = () => call('pos:displayClose');
export const listPrinters = () => call('print:printers', undefined);

/* IPC, not the network: these answer with the line down. */
const LOCAL = { networkMode: 'always' as const, retry: false as const };

export function useTill() {
  return useQuery<PosTillStatus>({ queryKey: PK.till, queryFn: tillStatus, ...LOCAL, refetchInterval: 20_000 });
}

export function useCatalogue(enabled = true) {
  return useQuery<PosCatalogue | null>({ queryKey: PK.catalogue, queryFn: readCatalogue, ...LOCAL, enabled });
}

export function useSales(f: { session_id?: number; since?: string }, enabled = true) {
  return useQuery<PosSale[]>({ queryKey: PK.sales(f), queryFn: () => listSales(f), ...LOCAL, enabled });
}

export function usePrintSettings() {
  return useQuery<PosPrintSettings>({ queryKey: PK.print, queryFn: printSettings, ...LOCAL });
}

/** The main process says when the till's status, catalogue or sales changed. */
export function usePosChanged(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      on('pos:changed', () => {
        void qc.invalidateQueries({ queryKey: PK.till });
        void qc.invalidateQueries({ queryKey: PK.catalogue });
        void qc.invalidateQueries({ queryKey: ['pos', 'sales'] });
      }),
    [qc],
  );
}

/** A query WorkSuite did not answer: the line is down, or waiting for it. */
export function unreachable(q: { isError: boolean; error: unknown; fetchStatus: string }): boolean {
  return q.fetchStatus === 'paused' || (q.isError && q.error instanceof ApiError && q.error.offline);
}

/* ── Products by code ────────────────────────────────────────────────── */

/** A product by barcode or code: the catalogue first; WorkSuite when it is not there and the line is up. */
export function findInCatalogue(products: PosProduct[], code: string): PosProduct | null {
  const c = code.trim();
  if (!c) return null;
  return products.find((p) => p.barcode === c) ?? products.find((p) => p.code === c) ?? products.find((p) => p.code?.toLowerCase() === c.toLowerCase()) ?? null;
}

const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const s = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);

export async function lookupProduct(code: string, caps: PosCapabilities | undefined, org?: number | null): Promise<PosProduct | null> {
  if (caps?.lookup) {
    try {
      const p = await apiGet<Record<string, unknown>>(`${BASE}/products/lookup`, { code, ...(org ? { org } : {}) });
      return { id: n(p.id), code: s(p.code), barcode: s(p.barcode), name: s(p.name) ?? code, unit: s(p.unit), category: s(p.category), price: n(p.price), discount_pct: n(p.discount_pct), tax_rate: n(p.tax_rate) };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }
  // An older server without POS's lookup: Inventory's, for people who may read it.
  try {
    const r = await apiGet<{ products?: Array<Record<string, unknown>>; exact?: boolean }>('/api/inventory/products/lookup', { q: code });
    const p = r.exact ? r.products?.[0] : undefined;
    return p ? { id: n(p.id), code: s(p.code), barcode: s(p.barcode), name: s(p.name) ?? code, unit: s(p.unit), category: null, price: n(p.unit_price), discount_pct: 0, tax_rate: n(p.tax_rate) } : null;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

/* ── The cart's price ────────────────────────────────────────────────── */

export interface CartPrice {
  cart: PricedCart | null;
  /** `server`: WorkSuite priced it. `estimate`: the catalogue's preview (WorkSuite out of reach, or not asked yet). */
  source: 'server' | 'estimate';
  /** WorkSuite's sentence (or the preview's) when the cart cannot be sold as it is. */
  error: string | null;
  pending: boolean;
}

/**
 * WorkSuite's price for the cart: `POST api/pos/price` (the till's company, the cashier's discount rights) where the
 * server announces it; only on an older server, each line's price from Inventory's price book (`GET api/inventory/price`, the quantity's band and list), added up the same way the
 * preview is. The catalogue's preview shows at once and stays when WorkSuite does not answer.
 */
let inventoryPriceRefused = false;

/**
 * Phase 2's counter pricing, asked of WorkSuite only where it announces each part: promotions (`capabilities.promotions`),
 * the CRM customer (`customers`), a coupon (`coupons`) and points (`loyalty`). None of them: the request is exactly
 * the old one, and so is the answer.
 */
export interface CounterPricing {
  customer_id?: number;
  coupon_code?: string;
  redeem_points?: number;
}

export function pricingBody(caps: PosCapabilities | undefined, p: CounterPricing): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (caps?.promotions) out.apply_promotions = true;
  if (caps?.customers && p.customer_id) out.customer_id = p.customer_id;
  if (caps?.coupons && p.coupon_code) {
    out.coupon_code = p.coupon_code;
    // #293: a coupon that does not apply is said in `coupon`, and the cart priced without it, rather than refusing the price.
    if (caps.coupon_validate) out.coupon_report = true;
  }
  if (caps?.loyalty && p.customer_id && p.redeem_points && p.redeem_points > 0) out.redeem_points = Math.floor(p.redeem_points);
  return out;
}

/** The cart as WorkSuite priced it (`POST price`), with Phase 2's parts where it sent them. */
export function pricedOf(d: Record<string, unknown>, currency: string, discountPct: number): PricedCart {
  const out: PricedCart = {
    currency: s(d.currency) ?? currency,
    lines: (Array.isArray(d.lines) ? (d.lines as Array<Record<string, unknown>>) : []).map((l) => ({
      product_id: n(l.product_id),
      code: s(l.code),
      name: s(l.name) ?? '',
      quantity: n(l.quantity),
      unit_price: n(l.unit_price),
      discount_pct: n(l.discount_pct),
      tax_rate: n(l.tax_rate),
      net: n(l.net),
      tax: n(l.tax),
      total: n(l.total),
    })),
    subtotal: n(d.subtotal),
    line_discount: n(d.line_discount),
    discount_pct: n(d.discount_pct, discountPct),
    discount: n(d.discount),
    tax: n(d.tax),
    total: n(d.total),
  };
  if ('deduction' in d) out.deduction = n(d.deduction);
  if ('promotion_discount' in d) out.promotion_discount = n(d.promotion_discount);
  if ('points_discount' in d) out.points_discount = n(d.points_discount);
  if ('points_redeemed' in d) out.points_redeemed = Math.floor(n(d.points_redeemed));
  if (Array.isArray(d.promotions)) {
    out.promotions = (d.promotions as Array<Record<string, unknown>>)
      .map((p) => ({ id: n(p.id), label: s(p.label) ?? s(p.name) ?? '', amount: n(p.amount), ...(p.coupon === true ? { coupon: true } : {}) }))
      .filter((p) => Number.isInteger(p.id) && p.id > 0 && p.amount > 0);
  }
  // #293, each only where the server sent it.
  if (d.discount_type === 'amount') {
    out.discount_type = 'amount';
    out.discount_value = n(d.discount_value);
  }
  if ('coupon_discount' in d) out.coupon_discount = n(d.coupon_discount);
  if (d.coupon && typeof d.coupon === 'object') {
    const c = d.coupon as Record<string, unknown>;
    const code = s(c.code);
    if (code) out.coupon = { code, amount: n(c.amount), valid: c.valid !== false, reason: s(c.reason), message: s(c.message) };
  }
  if (Array.isArray(d.pricing_notes)) out.notes = (d.pricing_notes as unknown[]).map((x) => s(x)).filter((x): x is string => !!x).slice(0, 5);
  return out;
}

/** How the cashier's discount goes to the price door: a fixed amount where the server takes one (#293), else the percentage. */
export function discountBody(caps: PosCapabilities | undefined, pct: number, amount: number | null): Record<string, unknown> {
  return amount !== null && amount > 0 && caps?.discount_amount ? { discount_type: 'amount', discount_value: amount } : { discount_pct: pct };
}

export async function priceCart(
  lines: CartLineInput[],
  discountPct: number,
  products: Map<number, PosProduct>,
  currency: string,
  ceiling: number | null,
  caps: PosCapabilities | undefined,
  org?: number | null,
  counter: CounterPricing = {},
  approvedPct: number | null = null,
  /** The cashier's discount as a fixed amount (#293), with `discountPct` the share it comes to. */
  amount: number | null = null,
): Promise<PricedCart> {
  if (caps?.price) {
    // A discount a manager approved past the cashier's rights: priced without it here, taken locally (`withDiscount`).
    const approved = approvedPct !== null;
    const c = await request<Record<string, unknown>>('POST', `${BASE}/price`, {
      body: { lines, ...(approved ? { discount_pct: 0 } : discountBody(caps, discountPct, amount)), ...(org ? { org_id: org } : {}), ...pricingBody(caps, counter) },
    });
    const priced = pricedOf(c.data, currency, approved ? 0 : discountPct);
    return approved ? withDiscount(priced, approvedPct, caps.discount_amount ? amount : null) : priced;
  }
  return legacyPrice(lines, discountPct, products, currency, ceiling, amount);
}

/**
 * Whether a coupon may be used on this cart and what it takes off (`POST coupons/validate`, `capabilities.coupon_validate`,
 * #293): WorkSuite runs its promotions on the cart and writes nothing. `reason` names why not (`not_found`, `expired`,
 * `min_spend` …), `message` says it in WorkSuite's words.
 */
export interface CouponCheck {
  valid: boolean;
  code: string;
  reason: string | null;
  message: string;
  amount: number;
  promotion: string | null;
}

export async function validateCoupon(code: string, lines: CartLineInput[], o: { org?: number | null; customer_id?: number } = {}): Promise<CouponCheck> {
  const r = await request<Record<string, unknown>>('POST', `${BASE}/coupons/validate`, {
    body: { coupon_code: code, lines, ...(o.org ? { org_id: o.org } : {}), ...(o.customer_id ? { customer_id: o.customer_id } : {}) },
  });
  const d = r.data ?? {};
  return { valid: d.valid === true, code: s(d.code) ?? code, reason: s(d.reason), message: s(d.message) ?? r.message ?? '', amount: n(d.amount), promotion: s(d.promotion) };
}

async function legacyPrice(lines: CartLineInput[], discountPct: number, products: Map<number, PosProduct>, currency: string, ceiling: number | null, amount: number | null = null): Promise<PricedCart> {
  if (inventoryPriceRefused) throw new ApiError(403, 'Inventory prices are not readable here.', null);
  const priced = new Map(products);
  await Promise.all(
    lines.map(async (l) => {
      const p = products.get(l.product_id);
      if (!p) return;
      const r = await apiGet<{ price?: number; discount_pct?: number; tax_rate?: number }>('/api/inventory/price', { product_id: l.product_id, qty: l.quantity, kind: 'sell' }).catch((e: unknown) => {
        // A cashier without Inventory: stop asking, the preview stands (until the server has `price`).
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) inventoryPriceRefused = true;
        throw e;
      });
      priced.set(l.product_id, { ...p, price: n(r.price, p.price), discount_pct: n(r.discount_pct, p.discount_pct), tax_rate: n(r.tax_rate, p.tax_rate) });
    }),
  );
  const e = estimateCart(lines, priced, discountPct, ceiling, currency, amount);
  if (e.error) throw new ApiError(422, e.error, 'validation_failed');
  return e.cart;
}

export function useCartPrice(
  lines: CartLineInput[],
  discountPct: number,
  products: Map<number, PosProduct>,
  currency: string,
  ceiling: number | null,
  caps: PosCapabilities | undefined,
  online: boolean,
  org?: number | null,
  counter: CounterPricing = {},
  /** The discount a manager approved (its percentage), past the cashier's own ceiling. */
  approvedPct: number | null = null,
  /** The cashier's discount as a fixed amount (#293); `discountPct` is then the share it comes to. */
  amount: number | null = null,
): CartPrice {
  // Offline (and while WorkSuite is asked) the preview takes no promotion: the sale says so (`promotion_ids: []`).
  const estimate = useMemo(() => estimateCart(lines, products, discountPct, approvedPct !== null ? null : ceiling, currency, amount), [lines, products, discountPct, ceiling, currency, approvedPct, amount]);
  const signature = JSON.stringify([lines, discountPct, counter.customer_id ?? null, counter.coupon_code ?? null, counter.redeem_points ?? null, approvedPct, amount]);
  const [debounced, setDebounced] = useState(signature);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(signature), 250);
    return () => clearTimeout(t);
  }, [signature]);
  const settled = debounced === signature;
  const server = useQuery<PricedCart, Error>({
    queryKey: ['pos', 'price', debounced, currency, !!caps?.price, !!caps?.promotions, org ?? null],
    queryFn: () => {
      const [l, d, customer_id, coupon_code, redeem_points, approved, fixed] = JSON.parse(debounced) as [CartLineInput[], number, number | null, string | null, number | null, number | null, number | null];
      return priceCart(l, d, products, currency, ceiling, caps, org, { ...(customer_id ? { customer_id } : {}), ...(coupon_code ? { coupon_code } : {}), ...(redeem_points ? { redeem_points } : {}) }, approved, fixed);
    },
    enabled: online && lines.length > 0 && settled,
    staleTime: 60_000,
    retry: false,
  });
  if (!lines.length) return { cart: null, source: 'estimate', error: null, pending: false };
  if (online && settled && server.data) return { cart: server.data, source: 'server', error: null, pending: false };
  if (online && settled && server.error instanceof ApiError && server.error.status === 422) return { cart: estimate.cart, source: 'estimate', error: server.error.message, pending: false };
  return { cart: estimate.cart, source: 'estimate', error: estimate.error, pending: online && (!settled || server.isFetching) };
}

/** A customer as typed, or null. */
export function customerOf(c: PosCustomer | null): PosCustomer | null {
  return c && (c.name || c.email || c.phone) ? c : null;
}
