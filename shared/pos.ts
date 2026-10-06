/**
 * POS — the till on this computer: what crosses IPC between the register's screens and the main process, and the
 * checks on it (the typed contract's POS part, spread into shared/ipc/contract.ts).
 *
 * THE SERVER IS AUTHORITATIVE FOR MONEY. The screens show WorkSuite's prices when it answers and the catalogue's
 * one-unit prices as an optimistic preview when it does not; a sale carries which it was (`priced_by`). The main
 * process never prices anything: it numbers the sale, keeps it sealed and sends it, in order, through the till's own
 * door (`/api/pos/device/sales`), where WorkSuite records it under the receipt number (idempotent).
 */
import { z } from 'zod';

/* ── What the till is ─────────────────────────────────────────────────────── */

/** A till as WorkSuite describes it (`GET api/pos/setup`, the pairing's and the heartbeat's answer). */
export interface PosTerminal {
  id: number;
  code: string;
  name: string;
  org_id: number;
  org_name: string | null;
  branch_name: string | null;
  warehouse_id: number | null;
  warehouse_name: string | null;
}

/**
 * Where the till stands:
 *  - `paired`: it holds a credential the server last accepted (or has not yet refused);
 *  - `revoked`: the server refused the credential (revoked, expired, re-paired elsewhere) — pair it again;
 *  - `pos_off`: POS is switched off on the server; sales wait.
 */
export type PosTillState = 'paired' | 'revoked' | 'pos_off';

export interface PosTillStatus {
  /** Null: this computer is not a till on this server. The credential itself never appears here. */
  till: { terminal: PosTerminal; paired_at: string; state: PosTillState; prefix: string } | null;
  /** Sales waiting to reach WorkSuite, and those it refused (they stay for a person to decide). */
  waiting: number;
  refused: number;
  /** Whether the last call to WorkSuite was answered. */
  reachable: boolean;
  last_contact: string | null;
  last_sync: string | null;
  /** A sentence for the status bar when something needs a person. */
  problem: string | null;
  /** What the company's desktop policy lets this computer do. */
  can_queue: boolean;
  can_keep: boolean;
  catalogue: { version: string; fetched_at: string; products: number; source: PosCatalogueSource; truncated: boolean } | null;
}

/* ── The catalogue ────────────────────────────────────────────────────────── */

/** `pos`: WorkSuite's till catalogue (`GET api/pos/catalogue`); `inventory`: Inventory's product list, read as a stand-in. */
export type PosCatalogueSource = 'pos' | 'inventory';

export interface PosProduct {
  id: number;
  code: string | null;
  barcode: string | null;
  name: string;
  unit: string | null;
  category: string | null;
  /** One unit before tax, as WorkSuite listed it — a preview; the sale is priced by WorkSuite. */
  price: number;
  /** A price list's own discount on the product, in percent. */
  discount_pct: number;
  tax_rate: number;
}

export interface PosCatalogue {
  version: string;
  fetched_at: string;
  currency: string | null;
  source: PosCatalogueSource;
  categories: string[];
  products: PosProduct[];
  /** More products than a copy carries: the rest are found by asking WorkSuite (online). */
  truncated: boolean;
}

/* ── A sale ───────────────────────────────────────────────────────────────── */

export const POS_TENDERS = ['cash', 'card', 'bank_transfer', 'wallet'] as const;
export type PosTenderMethod = (typeof POS_TENDERS)[number];
/** A card is taken on the shop's own machine, so it is as offline-capable as cash; a transfer or wallet must be seen to arrive. */
export const OFFLINE_TENDERS: ReadonlySet<PosTenderMethod> = new Set(['cash', 'card']);

const money = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const pct = z.number().finite().min(0).max(100);

export const posLineSchema = z.strictObject({
  product_id: z.number().int().positive(),
  code: z.string().max(64).nullable(),
  name: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive().max(100_000),
  unit_price: money,
  discount_pct: pct,
  tax_rate: pct,
  net: money,
  tax: money,
  total: money,
});
export type PosSaleLine = z.infer<typeof posLineSchema>;

export const posTenderSchema = z.strictObject({
  method: z.enum(POS_TENDERS),
  amount: z.number().finite().positive().max(1_000_000_000),
  reference: z.string().trim().max(80).nullable().optional(),
});
export type PosTender = z.infer<typeof posTenderSchema>;

export const posCustomerSchema = z.strictObject({
  name: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(150).optional(),
});
export type PosCustomer = z.infer<typeof posCustomerSchema>;

export const posSellSchema = z.strictObject({
  session_id: z.number().int().positive(),
  register_id: z.number().int().positive().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  customer: posCustomerSchema.nullable(),
  lines: z.array(posLineSchema).min(1).max(300),
  discount_pct: pct,
  totals: z.strictObject({ subtotal: money, discount: money, tax: money, total: money }),
  tenders: z.array(posTenderSchema).min(1).max(8),
  change_given: z.number().finite().min(0).max(1_000_000_000),
  /** `server`: WorkSuite priced the cart (`price`); `estimate`: the catalogue's preview, WorkSuite out of reach. */
  priced_by: z.enum(['server', 'estimate']),
  catalogue_version: z.string().max(64).nullable(),
  note: z.string().trim().max(200).optional(),
});
export type PosSellInput = z.infer<typeof posSellSchema>;

/**
 * A sale rung up at this till, as it keeps it (sealed, `pos_sales`): what was sold, who sold it and where it stands.
 * `waiting` is on its way; `sent` WorkSuite has (its number is the order's); `refused` WorkSuite would not take, with
 * its reason, until a person sends it again or drops it.
 */
export type PosSaleState = 'waiting' | 'sent' | 'refused';

export interface PosSale extends PosSellInput {
  ref: string;
  created_at: string;
  terminal_id: number;
  cashier_id: number;
  cashier_name: string | null;
  state: PosSaleState;
  /** WorkSuite's number for it (the order), once it has it. */
  number: string | null;
  message: string | null;
  attempts: number;
  sent_at: string | null;
  /** What WorkSuite made the sale come to once it arrived (priced again from `product_id`), when it said. */
  server_total?: number | null;
  /** Why somebody should look at it — WorkSuite's sentence(s): a total it prices differently, a payment missing, a late sale (never refused: the customer has gone). */
  review?: string | null;
  /** Why it is flagged, as WorkSuite's codes (`flags`): `price_differs`, `payment_missing`, `late`. */
  flags?: PosSaleFlag[];
  /** Why WorkSuite refused it, when it said (`code`): `drawer_closed`, `session_not_here`, … */
  code?: string | null;
  /** Refunds and the void WorkSuite recorded against it, as it answered them. */
  returns?: PosReturn[];
  voided?: boolean;
}

/**
 * Why WorkSuite flagged a sale for review (`pos_sale_books.flags`): it priced it differently (`price_differs`), the till
 * sent no tenders so it is recorded unpaid (`payment_missing`), or it was sold while a register that has since closed
 * was open (`late`). A flag is never a refusal: the sale stands.
 */
export const POS_SALE_FLAGS = ['price_differs', 'payment_missing', 'late'] as const;
export type PosSaleFlag = (typeof POS_SALE_FLAGS)[number];

/** The flags WorkSuite put on a sale; an older server said only `review`, which meant the price differed. */
export function saleFlags(s: Pick<PosSale, 'flags' | 'review'>): PosSaleFlag[] {
  const known = (s.flags ?? []).filter((f): f is PosSaleFlag => (POS_SALE_FLAGS as readonly string[]).includes(f));
  return known.length ? known : s.review ? ['price_differs'] : [];
}

/**
 * Refusals about the drawer: no register open for the sale (`drawer_closed` — none open, or the one named closed
 * before the sale was made), or the session named is another till's (`session_not_here`). Sent again, such a sale
 * goes into the register open at this till now.
 */
export const POS_DRAWER_REFUSALS: ReadonlySet<string> = new Set(['drawer_closed', 'session_not_here']);

/** A refund or void as WorkSuite recorded it (`Returns::shape`): what went back, how, and what left the drawer. */
export interface PosReturn {
  /** The till's own number for it (`<receipt>-R1`, `<receipt>-V`): sent again, it is the same refund. */
  ref: string;
  kind: 'refund' | 'void';
  status: string;
  amount: number;
  /** Cash handed back out of the drawer. */
  cash_out: number;
  tenders: Array<{ method: string; amount: number }>;
  lines: Array<{ product_id: number | null; quantity: number }>;
  reason: string | null;
  credit_note: string | null;
  at: string | null;
}

/** The receipt as WorkSuite recorded the sale (`Receipt::data`): its figures after pricing again, refunds, status. */
export interface PosServerReceipt {
  company: { name: string; address: string | null; phone: string | null; tax_number: string | null };
  receipt_no: string;
  order_number: string | null;
  invoice_number: string | null;
  register: string | null;
  cashier: string | null;
  customer: { name: string; email: string | null } | null;
  at: string | null;
  currency: string;
  lines: Array<{ description: string; quantity: number; unit_price: number; discount_pct: number; amount: number; tax: number; total: number }>;
  taxes: Array<{ name: string; amount: number }>;
  totals: { subtotal: number; discount: number; tax: number; total: number };
  tenders: Array<{ label: string; amount: number; reference: string | null }>;
  change: number;
  refunds: Array<{ ref: string; kind: string; amount: number; cash: number; reason: string | null }>;
  refunded: number;
  /** The till sent no tenders: nothing was taken as far as WorkSuite knows (a "Payment missing" line). */
  payment_missing?: boolean;
  status: 'paid' | 'payment_missing' | 'part_refunded' | 'refunded' | 'voided' | string;
  void_reason: string | null;
  footer: string;
}

/* ── Printing ─────────────────────────────────────────────────────────────── */

export interface PosPrintSettings {
  /** The thermal printer at the counter; null: the print dialog asks. */
  receipt_printer: string | null;
  paper: '80mm' | '58mm';
  /** `escpos`: plain ESC/POS bytes straight to the printer (fast, Latin script); `driver`: a page through the printer's driver (any script). */
  mode: 'escpos' | 'driver';
  copies: number;
  /** Print the receipt as soon as a sale is complete. */
  auto_print: boolean;
  /** A cash drawer on the receipt printer's RJ-11 port, opened with ESC p. */
  drawer: 'off' | 'printer';
  drawer_pin: 2 | 5;
  /** Lines above and below every receipt (the shop's name and address, a returns policy). */
  header: string;
  footer: string;
}

export interface PosPrintOutcome {
  ok: boolean;
  printer: string | null;
  message: string;
}

const text = (max: number) => z.string().max(max);

export const posPrintPatchSchema = z
  .strictObject({
    receipt_printer: z.string().trim().min(1).max(200).nullable(),
    paper: z.enum(['80mm', '58mm']),
    mode: z.enum(['escpos', 'driver']),
    copies: z.number().int().min(1).max(3),
    auto_print: z.boolean(),
    drawer: z.enum(['off', 'printer']),
    drawer_pin: z.union([z.literal(2), z.literal(5)]),
    header: text(400),
    footer: text(400),
  })
  .partial();
export type PosPrintPatch = z.infer<typeof posPrintPatchSchema>;

/** An X or Z report, a shift summary: rows the screens made from WorkSuite's figures, printed as they are. */
export const posReportSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().max(160).optional(),
  rows: z
    .array(z.strictObject({ label: z.string().max(80), value: z.string().max(40), strong: z.boolean().optional() }).or(z.strictObject({ rule: z.literal(true) })))
    .max(200),
});
export type PosReport = z.infer<typeof posReportSchema>;

/* ── Open and held sales ─────────────────────────────────────────────────── */

/**
 * The sales open at the counter (at most five, one on screen) and those held — parked — for up to a day: what was
 * rung up, the customer and the cashier's discount, never a price. They are the till's, kept sealed by the main
 * process where the desktop policy lets this computer keep data (in memory otherwise), so a restart keeps them; none
 * reaches WorkSuite until it is paid.
 */
export const POS_MAX_OPEN = 5;
export const POS_MAX_HELD = 50;
/** A held sale older than this is discarded. */
export const POS_HOLD_TTL_MS = 24 * 60 * 60 * 1000;

const cartSchema = z.strictObject({
  lines: z.array(z.strictObject({ product_id: z.number().int().positive(), quantity: z.number().finite().positive().max(100_000) })).max(300),
  customer: posCustomerSchema.nullable(),
  discount: z.string().max(8),
});
const saleId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const stamp = z.string().datetime();

export const posCartsSchema = z.strictObject({
  sales: z.array(z.strictObject({ id: saleId, cart: cartSchema, started_at: stamp })).min(1).max(POS_MAX_OPEN),
  active: saleId,
  held: z.array(z.strictObject({ id: saleId, cart: cartSchema, started_at: stamp, held_at: stamp, note: z.string().max(120) })).max(POS_MAX_HELD),
});
export type PosCarts = z.infer<typeof posCartsSchema>;

/** The held sales still within their day. */
export function heldWithin<T extends { held_at: string }>(held: T[], now: number): T[] {
  return held.filter((h) => {
    const at = Date.parse(h.held_at);
    return Number.isFinite(at) && now - at < POS_HOLD_TTL_MS;
  });
}

/* ── The contract ─────────────────────────────────────────────────────────── */

const none = z.undefined().or(z.null()).optional();
const ref = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,59}$/);

/** A refund (every line, or the quantities named) or a void of one of this till's sales, with the reason. */
export const posGiveBackSchema = z.strictObject({
  ref,
  kind: z.enum(['refund', 'void']),
  reason: z.string().trim().min(3).max(200),
  lines: z
    .array(z.strictObject({ product_id: z.number().int().positive(), quantity: z.number().finite().positive().max(100_000) }))
    .min(1)
    .max(300)
    .optional(),
  restock: z.boolean().optional(),
});
export type PosGiveBack = z.infer<typeof posGiveBackSchema>;

/** Spread into `contract` (shared/ipc/contract.ts): the same checks as every channel there. */
export const posContract = {
  'pos:till': { input: none, session: true },
  'pos:pair': { input: z.strictObject({ terminal_id: z.number().int().positive(), take_over: z.boolean().optional() }), session: true, rate: 2, sensitive: true },
  'pos:forget': { input: z.strictObject({ discard: z.boolean().optional() }).optional(), session: true, rate: 2, sensitive: true },
  'pos:catalogue': { input: none, session: true, rate: 10 },
  /** `capable`: what `options.capabilities.catalogue` said — false goes straight to Inventory's list (an older server). */
  'pos:catalogueRefresh': { input: z.strictObject({ capable: z.boolean().optional() }).optional().or(z.null()), session: true, rate: 1 },
  'pos:sell': { input: posSellSchema, session: true, rate: 4, sensitive: true },
  'pos:sales': {
    input: z.strictObject({ session_id: z.number().int().positive().optional(), since: z.string().datetime().optional(), limit: z.number().int().min(1).max(500).optional() }).optional(),
    session: true,
    rate: 20,
  },
  'pos:sale': { input: z.strictObject({ ref }), session: true, rate: 20 },
  'pos:syncNow': { input: none, session: true, rate: 2 },
  /** `session_id`: a sale refused for its drawer (`POS_DRAWER_REFUSALS`) is sent again into the register open now. */
  'pos:resolve': { input: z.strictObject({ ref, action: z.enum(['retry', 'drop']), session_id: z.number().int().positive().optional() }), session: true, rate: 5, sensitive: true },
  'pos:printSettings': { input: none, session: true },
  'pos:printSettingsSet': { input: posPrintPatchSchema, session: true, rate: 5 },
  /** `server`: print WorkSuite's receipt (`capabilities.receipt`) when it answers, the till's own otherwise. */
  'pos:printReceipt': { input: z.strictObject({ ref, reprint: z.boolean().optional(), server: z.boolean().optional() }), session: true, rate: 3 },
  'pos:receipt': { input: z.strictObject({ ref }), session: true, rate: 10 },
  'pos:giveBack': { input: posGiveBackSchema, session: true, rate: 3, sensitive: true },
  'pos:email': { input: z.strictObject({ ref, email: z.string().trim().email().max(150).optional() }), session: true, rate: 3 },
  'pos:printReport': { input: posReportSchema, session: true, rate: 2 },
  'pos:printTest': { input: none, session: true, rate: 2 },
  'pos:openDrawer': { input: none, session: true, rate: 1, sensitive: true },
  'pos:displayOpen': { input: none, session: true, rate: 2 },
  'pos:displayClose': { input: none, session: true, rate: 2 },
  'pos:carts': { input: none, session: true, rate: 10 },
  'pos:cartsSave': { input: posCartsSchema, session: true, rate: 20 },
};

export interface PosOutputs {
  'pos:till': PosTillStatus;
  'pos:pair': { status: PosTillStatus; message: string };
  'pos:forget': PosTillStatus;
  'pos:catalogue': PosCatalogue | null;
  'pos:catalogueRefresh': PosCatalogue;
  'pos:sell': { sale: PosSale; queued: boolean; printed: PosPrintOutcome | null };
  'pos:sales': PosSale[];
  'pos:sale': PosSale | null;
  'pos:syncNow': PosTillStatus;
  'pos:resolve': PosTillStatus;
  'pos:printSettings': PosPrintSettings;
  'pos:printSettingsSet': PosPrintSettings;
  'pos:printReceipt': PosPrintOutcome;
  'pos:receipt': PosServerReceipt | null;
  'pos:giveBack': { sale: PosSale; refund: PosReturn; message: string };
  'pos:email': { message: string };
  'pos:printReport': PosPrintOutcome;
  'pos:printTest': PosPrintOutcome;
  'pos:openDrawer': PosPrintOutcome;
  'pos:displayOpen': { opened: boolean; secondary: boolean };
  'pos:displayClose': boolean;
  'pos:carts': PosCarts | null;
  'pos:cartsSave': boolean;
}

/**
 * The tax on a receipt, by rate (`VAT 18%`), from the lines' rates and taxes: one row per rate charged, or a single
 * row of the total when no line says its rate. The rows add up to the sale's tax.
 */
export function vatRows(lines: Array<Pick<PosSaleLine, 'tax_rate' | 'tax'>>, total: number): Array<{ label: string; amount: number }> {
  const by = new Map<number, number>();
  for (const l of lines) if (l.tax_rate > 0) by.set(l.tax_rate, (by.get(l.tax_rate) ?? 0) + l.tax);
  if (!by.size) return [{ label: 'VAT', amount: total }];
  const rows = [...by].sort((a, b) => b[0] - a[0]).map(([rate, amount]) => ({ label: `VAT ${Number(rate.toFixed(2))}%`, amount: Math.round(amount * 100) / 100 }));
  // Whatever the lines leave over (a server's rounding) goes on the biggest rate, so the rows meet the total.
  const rest = Math.round((total - rows.reduce((a, r) => a + r.amount, 0)) * 100) / 100;
  if (rest) rows[0]!.amount = Math.round((rows[0]!.amount + rest) * 100) / 100;
  return rows;
}

/** A receipt number: the till's prefix and a six-digit sequence (`T01-7F3A2B-000042`). */
export function formatReceipt(prefix: string, n: number): string {
  return `${prefix}-${String(Math.max(1, Math.floor(n))).padStart(6, '0')}`;
}
