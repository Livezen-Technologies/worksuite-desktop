import type { PosLocalState } from '@shared/pos';
import type { PosCatalogue, PosProduct, PosSale, PosSellInput } from '@shared/pos';
import type { LocalProduct, OpenRegister, TillSettings } from '@shared/pos-local-sale';
import type { PosCapabilities, PosCompany, PosOptions, PosRegister, PosSession } from '../api';
import type { Till } from '../parts';

/**
 * The offline till, dressed as a till the POS screens already know (ENH-POS-01 §1, phase 3).
 *
 * The counter, the cart, the payment panel and the drawer screens are the module's own — the same code a
 * server-backed till runs. They read everything through `Till` and a handful of calls, so an offline till only
 * has to present itself in those shapes. Nothing here is a second POS; it is the same one, fed from this
 * computer's SQLite instead of WorkSuite.
 *
 * TWO CONVERSIONS, AND WHY THEY ARE HERE. The screens count money in major units (11.50) because that is what
 * WorkSuite sends them; the offline store counts whole cents, because an offline till is the system of record for
 * its own sales and a float that loses half a cent loses it from somebody's drawer. The screens key a product by a
 * number; the store keys it by a string id. Both conversions live in this one file, at the boundary, so neither
 * side has to know about the other.
 */

/** Cents → the major units the screens use. */
export const toMajor = (cents: number): number => Math.round(cents) / 100;
/** What a screen typed or computed → whole cents, which is what is written. */
export const toCents = (major: number): number => Math.round(major * 100);

/** What an offline till cannot do, because there is no WorkSuite behind it to do it. */
export const OFFLINE_CAPS: PosCapabilities = {
  catalogue: false,
  device_catalogue: false,
  price: false, // the till prices its own sales; there is nothing to ask
  lookup: false,
  sales: true,
  refund: false, // phase 4
  void: true,
  receipt: true,
  email: false,
  email_receipt: false,
  settle: false,
  reprice: false,
  discount_rights: false,
  review: false,
  drawer_required: true,
  late_sales: false,
  payment_missing: false,
};

export function catalogueFromLocal(products: LocalProduct[], settings: TillSettings | null): PosCatalogue {
  return {
    version: 'offline',
    fetched_at: new Date().toISOString(),
    currency: settings?.currency ?? null,
    /* The catalogue is this computer's own; 'pos' is the nearest the module's own type allows. */
    source: 'pos',
    categories: [],
    products: products.map(productFromLocal),
    truncated: false,
  };
}

export function productFromLocal(p: LocalProduct): PosProduct {
  return {
    id: p.n,
    code: p.sku,
    barcode: p.barcode,
    name: p.name,
    unit: null,
    category: null,
    price: toMajor(p.price),
    discount_pct: 0,
    tax_rate: p.taxRate,
    ...(p.stock === null ? {} : { stock: p.stock }),
  };
}

/** The one company an offline till has: this shop, on this computer. */
const COMPANY = (currency: string): PosCompany => ({ id: 1, name: 'This till', currency } as PosCompany);

/** The open register, as a session the drawer screens understand. */
export function sessionFromLocal(register: OpenRegister | null, settings: TillSettings | null, cashier: string | null): PosSession | null {
  if (!register) return null;
  return {
    id: 1,
    org_id: 1,
    register_id: 1,
    register: 'This till',
    register_code: settings?.code ?? 'T1',
    terminal_id: 1,
    currency: settings?.currency ?? 'LKR',
    status: 'open',
    opening_float: toMajor(register.float),
    opened_at: register.openedAt,
    cashier,
    closed_at: null,
    closed_by_name: null,
    expected_cash: null,
    counted_cash: null,
    variance: null,
    variance_reason: null,
    note: null,
  };
}

export function registersFromLocal(settings: TillSettings | null): PosRegister[] {
  return [{ id: 1, org_id: 1, code: settings?.code ?? 'T1', name: 'This till', branch: null } as PosRegister];
}

export function optionsFromLocal(settings: TillSettings | null): PosOptions {
  return {
    companies: [COMPANY(settings?.currency ?? 'LKR')],
    /* The reasons a shop actually gives, since there is no WorkSuite list to read. */
    cash_reasons: { in: ['Float top-up', 'Change brought in', 'Other'], out: ['Bank drop', 'Petty cash', 'Supplier paid', 'Other'] },
    denominations: {},
    capabilities: OFFLINE_CAPS,
  };
}

export interface LocalTillInput {
  state: PosLocalState;
  register: OpenRegister | null;
  settings: TillSettings | null;
  params: URLSearchParams;
  go: Till['go'];
  openSync?: () => void;
}

/** The whole `Till` the POS screens read, built from what this computer knows. */
export function tillFromLocal({ state, register, settings, params, go, openSync }: LocalTillInput): Till {
  const currency = settings?.currency ?? 'LKR';
  return {
    status: {
      till: { terminal: { id: 1, code: settings?.code ?? 'T1', name: 'This till', org_id: 1, org_name: null, branch_name: null, warehouse_id: null, warehouse_name: null }, paired_at: register?.openedAt ?? new Date().toISOString(), state: 'paired', prefix: settings?.code ?? 'T1' },
      waiting: 0,
      refused: 0,
      /* Not "offline" in the server-backed sense: there is no server to be out of reach of. */
      reachable: true,
      last_contact: null,
      last_sync: null,
      problem: null,
      can_queue: true,
      can_keep: true,
      catalogue: { version: 'offline', fetched_at: new Date().toISOString(), products: 0, source: 'pos', truncated: false },
    } as Till['status'],
    options: optionsFromLocal(settings),
    company: COMPANY(currency),
    caps: OFFLINE_CAPS,
    currency,
    session: sessionFromLocal(register, settings, state.signedIn?.displayName ?? null),
    registers: registersFromLocal(settings),
    offline: false,
    /* Only a manager or an owner may take money off a sale; the main process refuses it either way. */
    discount: { allowed: (state.permissions as string[]).includes('discount'), ceiling: null },
    params,
    go,
    ...(openSync ? { openSync } : {}),
  } as Till;
}

/** A sale the payment panel put together → what the offline till writes. */
export function sellToLocal(input: PosSellInput, byNumber: Map<number, LocalProduct>): Parameters<typeof import('@shared/pos')['posSellSchema']['parse']>[0] extends never ? never : { lines: Array<{ productId: string | null; name?: string; unitPrice?: number; qty: number; taxRate?: number; discount?: number }>; tenders: Array<{ kind: 'cash' | 'card' | 'voucher' | 'other'; amount: number; reference?: string | null }>; customer?: string | null } {
  return {
    lines: input.lines.map((l) => {
      const local = byNumber.get(l.product_id);
      return local
        ? { productId: local.id, qty: l.quantity, discount: toCents((l.unit_price * l.quantity * (l.discount_pct || 0)) / 100) }
        : { productId: null, name: l.name, unitPrice: toCents(l.unit_price), qty: l.quantity, taxRate: l.tax_rate, discount: 0 };
    }),
    tenders: input.tenders.map((t) => ({ kind: tenderKind(t.method), amount: toCents(t.amount), reference: t.reference ?? null })),
    ...(input.customer?.name ? { customer: input.customer.name } : {}),
  };
}

/** The module's tender names → the four an offline till keeps. Anything unknown is "other", never dropped. */
function tenderKind(method: string): 'cash' | 'card' | 'voucher' | 'other' {
  const m = method.toLowerCase();
  if (m === 'cash') return 'cash';
  if (m.includes('card') || m === 'credit' || m === 'debit') return 'card';
  if (m.includes('voucher') || m.includes('gift')) return 'voucher';
  return 'other';
}

/**
 * A sale the offline till wrote → the `PosSale` the payment panel shows and the receipt prints. There is no
 * WorkSuite to give it a number or an order, so those are null and its state is the one a till uses for a sale
 * that is finished and going nowhere.
 */
export function saleFromLocal(input: PosSellInput, written: { ref: string; soldAt: string; change: number }, cashier: string | null): PosSale {
  return {
    ...input,
    ref: written.ref,
    created_at: written.soldAt,
    terminal_id: 1,
    cashier_id: 1,
    cashier_name: cashier,
    /* Nothing is waiting to be sent: an offline till's sale is complete where it was made. */
    state: 'sent',
    number: null,
    message: null,
    attempts: 0,
    sent_at: written.soldAt,
    change_given: written.change,
  } as PosSale;
}
