import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { PosCatalogue, PosCustomer, PosPrintPatch, PosPrintSettings, PosProduct, PosReport, PosSale, PosSellInput, PosTillStatus } from '@shared/pos';
import { apiGet, ApiError, request } from '../../core/api';
import { call, on } from '../../core/bridge';
import { estimateCart, type CartLineInput, type PricedCart } from './pricing';

/**
 * POS's two halves, for the screens.
 *
 * The drawer — options, registers, sessions, cash in and out, the close — is WorkSuite's staff API (`/api/pos`),
 * reached through the app's proxy with the signed-in person's session, exactly as the web's POS pages reach it.
 *
 * The till — pairing, the catalogue copy, the sales and their outbox, the printer, the customer display — is the main
 * process's (`pos:*`, electron/services/pos-ipc.ts): the till's credential never reaches this window.
 *
 * What the staff API does not have yet (a till catalogue, cart pricing, a barcode lookup, refunds and voids) is asked
 * for where WorkSuite announces it (`options.capabilities`) and otherwise done the way this server can: Inventory's
 * prices for the cart, the catalogue's preview when neither answers. See docs/BACKEND.md.
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
  /** Not on every server yet: whether the person may take money off a sale, and how much. */
  discount?: boolean;
  max_discount_pct?: number | null;
}

export interface PosCompany {
  id: number;
  name: string;
  currency: string;
  today: string | null;
  can: PosCan;
}

/** What WorkSuite announces it can do for a till (not on every server yet: absent means no). */
export interface PosCapabilities {
  catalogue?: boolean;
  price?: boolean;
  lookup?: boolean;
  refund?: boolean;
  void?: boolean;
  receipt?: boolean;
  email_receipt?: boolean;
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

export async function cashMove(sessionId: number, body: { direction: 'in' | 'out'; amount: number; reason: string; reference?: string }): Promise<string | null> {
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

/** Refund or void a sale — where WorkSuite announces it (`capabilities.refund` / `.void`). */
export async function reverseSale(ref: string, action: 'refund' | 'void', body: { reason: string; lines?: Array<{ product_id: number; quantity: number }>; method?: string }): Promise<string | null> {
  return (await request('POST', `${BASE}/sales/${encodeURIComponent(ref)}/${action}`, { body })).message ?? null;
}

/* ── The till (main process) ─────────────────────────────────────────── */

export const tillStatus = () => call('pos:till');
export const pairTill = (terminal_id: number, take_over = false) => call('pos:pair', { terminal_id, take_over });
export const forgetTill = (discard = false) => call('pos:forget', { discard });
export const readCatalogue = () => call('pos:catalogue');
export const refreshCatalogue = () => call('pos:catalogueRefresh');
export const sell = (input: PosSellInput) => call('pos:sell', input);
export const listSales = (f: { session_id?: number; since?: string; limit?: number } = {}) => call('pos:sales', f);
export const readSale = (ref: string) => call('pos:sale', { ref });
export const syncNow = () => call('pos:syncNow');
export const resolveSale = (ref: string, action: 'retry' | 'drop') => call('pos:resolve', { ref, action });
export const printSettings = () => call('pos:printSettings');
export const setPrintSettings = (p: PosPrintPatch) => call('pos:printSettingsSet', p);
export const printReceipt = (ref: string, reprint = true) => call('pos:printReceipt', { ref, reprint });
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

export async function lookupProduct(code: string, caps: PosCapabilities | undefined): Promise<PosProduct | null> {
  if (caps?.lookup) {
    try {
      const p = await apiGet<Record<string, unknown>>(`${BASE}/products/lookup`, { code });
      return { id: n(p.id), code: s(p.code), barcode: s(p.barcode), name: s(p.name) ?? code, unit: s(p.unit), category: s(p.category), price: n(p.price), discount_pct: n(p.discount_pct), tax_rate: n(p.tax_rate) };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }
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
 * WorkSuite's price for the cart: `POST api/pos/price` where the server announces it; otherwise each line's price
 * from Inventory's price book (`GET api/inventory/price`, the quantity's band and list), added up the same way the
 * preview is. The catalogue's preview shows at once and stays when WorkSuite does not answer.
 */
let inventoryPriceRefused = false;

export async function priceCart(lines: CartLineInput[], discountPct: number, products: Map<number, PosProduct>, currency: string, ceiling: number | null, caps: PosCapabilities | undefined): Promise<PricedCart> {
  if (caps?.price) {
    const c = await request<Record<string, unknown>>('POST', `${BASE}/price`, { body: { lines, discount_pct: discountPct } });
    const d = c.data;
    return {
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
  }
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
  const e = estimateCart(lines, priced, discountPct, ceiling, currency);
  if (e.error) throw new ApiError(422, e.error, 'validation_failed');
  return e.cart;
}

export function useCartPrice(lines: CartLineInput[], discountPct: number, products: Map<number, PosProduct>, currency: string, ceiling: number | null, caps: PosCapabilities | undefined, online: boolean): CartPrice {
  const estimate = useMemo(() => estimateCart(lines, products, discountPct, ceiling, currency), [lines, products, discountPct, ceiling, currency]);
  const signature = JSON.stringify([lines, discountPct]);
  const [debounced, setDebounced] = useState(signature);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(signature), 250);
    return () => clearTimeout(t);
  }, [signature]);
  const settled = debounced === signature;
  const server = useQuery<PricedCart, Error>({
    queryKey: ['pos', 'price', debounced, currency, !!caps?.price],
    queryFn: () => {
      const [l, d] = JSON.parse(debounced) as [CartLineInput[], number];
      return priceCart(l, d, products, currency, ceiling, caps);
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
