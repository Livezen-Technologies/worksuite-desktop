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

/* ── The contract ─────────────────────────────────────────────────────────── */

const none = z.undefined().or(z.null()).optional();
const ref = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,59}$/);

/** Spread into `contract` (shared/ipc/contract.ts): the same checks as every channel there. */
export const posContract = {
  'pos:till': { input: none, session: true },
  'pos:pair': { input: z.strictObject({ terminal_id: z.number().int().positive(), take_over: z.boolean().optional() }), session: true, rate: 2, sensitive: true },
  'pos:forget': { input: z.strictObject({ discard: z.boolean().optional() }).optional(), session: true, rate: 2, sensitive: true },
  'pos:catalogue': { input: none, session: true, rate: 10 },
  'pos:catalogueRefresh': { input: none, session: true, rate: 1 },
  'pos:sell': { input: posSellSchema, session: true, rate: 4, sensitive: true },
  'pos:sales': {
    input: z.strictObject({ session_id: z.number().int().positive().optional(), since: z.string().datetime().optional(), limit: z.number().int().min(1).max(500).optional() }).optional(),
    session: true,
    rate: 20,
  },
  'pos:sale': { input: z.strictObject({ ref }), session: true, rate: 20 },
  'pos:syncNow': { input: none, session: true, rate: 2 },
  'pos:resolve': { input: z.strictObject({ ref, action: z.enum(['retry', 'drop']) }), session: true, rate: 5, sensitive: true },
  'pos:printSettings': { input: none, session: true },
  'pos:printSettingsSet': { input: posPrintPatchSchema, session: true, rate: 5 },
  'pos:printReceipt': { input: z.strictObject({ ref, reprint: z.boolean().optional() }), session: true, rate: 3 },
  'pos:printReport': { input: posReportSchema, session: true, rate: 2 },
  'pos:printTest': { input: none, session: true, rate: 2 },
  'pos:openDrawer': { input: none, session: true, rate: 1, sensitive: true },
  'pos:displayOpen': { input: none, session: true, rate: 2 },
  'pos:displayClose': { input: none, session: true, rate: 2 },
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
  'pos:printReport': PosPrintOutcome;
  'pos:printTest': PosPrintOutcome;
  'pos:openDrawer': PosPrintOutcome;
  'pos:displayOpen': { opened: boolean; secondary: boolean };
  'pos:displayClose': boolean;
}

/** A receipt number: the till's prefix and a six-digit sequence (`T01-7F3A2B-000042`). */
export function formatReceipt(prefix: string, n: number): string {
  return `${prefix}-${String(Math.max(1, Math.floor(n))).padStart(6, '0')}`;
}
