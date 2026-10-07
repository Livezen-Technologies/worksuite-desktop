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
  catalogue: {
    version: string;
    /** When the copy was last brought up to date (a sync that finished, unchanged or not). */
    fetched_at: string;
    products: number;
    source: PosCatalogueSource;
    truncated: boolean;
    /* worksuite-desktop#296, each absent on an older app's status. */
    /** Older than two refresh intervals (`PosTillSettings.catalogue_minutes`), or never synced: "Online · synced" waits for it. */
    stale?: boolean;
    /** Why the last catalogue sync did not finish, when it did not. */
    error?: string | null;
    /** Pictures kept for offline, and the bytes they take. */
    thumbs?: { count: number; bytes: number };
  } | null;
  /** A catalogue sync under way (worksuite-desktop#296): the products read so far, of how many when WorkSuite said. */
  syncing?: { done: number; total: number | null; full: boolean } | null;
}

/**
 * The till's own settings on this computer (worksuite-desktop#296), kept with its other settings (not secrets):
 * whether a card may be taken while WorkSuite is out of reach — recorded only, nothing verifies it, so off unless the
 * shop says so; how often the catalogue is brought up to date; how much room its offline pictures may take.
 */
export interface PosTillSettings {
  card_offline: boolean;
  catalogue_minutes: number;
  thumbs_mb: number;
}

export const POS_TILL_SETTINGS_DEFAULT: PosTillSettings = { card_offline: false, catalogue_minutes: 30, thumbs_mb: 200 };

export const posTillSettingsPatchSchema = z
  .strictObject({
    card_offline: z.boolean(),
    catalogue_minutes: z.number().int().min(5).max(24 * 60),
    thumbs_mb: z.number().int().min(0).max(4096),
  })
  .partial();
export type PosTillSettingsPatch = z.infer<typeof posTillSettingsPatchSchema>;

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
  /* Phase 2 (`capabilities.stock`, `product_images`, `promotions`, `favourites`, `category_tree`): absent on an older server. */
  /** The product's category id in the tree (`category_tree`). */
  category_id?: string | null;
  /** Stock at the till's warehouse: `untracked` for a service or no warehouse known. A badge, never a refusal. */
  stock_state?: PosStockState | null;
  stock_available?: number | null;
  /** The product has a picture (`image_url`); the screens load it through the signed-in person's session. */
  image?: boolean;
  /** The first promotion that targets the product ("3 for 1,200"). */
  promo_label?: string | null;
  favourite?: boolean;
  /** worksuite-desktop#296: a small picture of it is kept on this computer (`/__local/pos-thumb/<id>`), for offline. */
  thumb?: boolean;
}

export type PosStockState = 'in_stock' | 'low' | 'out' | 'untracked';

/** A group of the catalogue's categories (`category_tree`); `product_count` counts everything below it. */
export interface PosCategoryNode {
  id: string;
  name: string;
  parent_id: string | null;
  product_count: number;
  children: PosCategoryNode[];
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
  /** Phase 2: the groups of categories, the favourites (product ids, in order), the tenders the till may offer. */
  category_tree?: PosCategoryNode[];
  favourites?: number[];
  tenders?: PosTenderOption[] | null;
}

/* ── A sale ───────────────────────────────────────────────────────────────── */

/**
 * How a sale is paid. The first four are every server's; the rest are Phase 2's configured tenders (`capabilities.tenders`):
 * LankaQR and other QR payments, a gift voucher (its code as the reference), the customer's store credit and their
 * account (both for a named customer).
 */
export const POS_TENDERS = ['cash', 'card', 'bank_transfer', 'wallet', 'qr', 'voucher', 'store_credit', 'account'] as const;
export type PosTenderMethod = (typeof POS_TENDERS)[number];
/** What every server takes when the company configured nothing (and what an older server knows). */
export const LEGACY_TENDERS: readonly PosTenderMethod[] = ['cash', 'card', 'bank_transfer', 'wallet'];
/** A card is taken on the shop's own machine, so it is as offline-capable as cash; a transfer or wallet must be seen to arrive. */
export const OFFLINE_TENDERS: ReadonlySet<PosTenderMethod> = new Set(['cash', 'card']);

/** A tender the company configured (`Tenders::shape`): its kind is what a sale sends as `method`. */
export interface PosTenderOption {
  kind: PosTenderMethod;
  name: string;
  opens_drawer: boolean;
  /** May be taken with WorkSuite out of reach: cash and card only. */
  offline: boolean;
  /** Store credit and the customer's account: the sale must name a customer. */
  needs_customer: boolean;
  /** A gift voucher: its code goes as the tender's reference. */
  needs_reference: boolean;
}

/** The server's list of tenders (`tenders` on the catalogue, the heartbeat, `options.companies[].tenders`), or null when it sent none. */
export function tenderOptionsOf(v: unknown): PosTenderOption[] | null {
  if (!Array.isArray(v)) return null;
  const out: PosTenderOption[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const t = x as Record<string, unknown>;
    const kind = typeof t.kind === 'string' ? t.kind : typeof t.method === 'string' ? t.method : '';
    if (!(POS_TENDERS as readonly string[]).includes(kind) || t.active === false || out.some((o) => o.kind === kind)) continue;
    const k = kind as PosTenderMethod;
    out.push({
      kind: k,
      name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 60) : k,
      opens_drawer: t.opens_drawer === true || (t.opens_drawer === undefined && k === 'cash'),
      offline: OFFLINE_TENDERS.has(k) && t.offline !== false,
      needs_customer: t.needs_customer === true || k === 'store_credit' || k === 'account',
      needs_reference: t.needs_reference === true || k === 'voucher',
    });
  }
  return out.length ? out : null;
}

const money = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const pct = z.number().finite().min(0).max(100);
/** A manager's approval token (`Approvals::mint`: `apv_` and hex). */
const approvalId = z.string().regex(/^apv_[A-Za-z0-9]{8,120}$/);

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
  /** Phase 2 (`capabilities.customers`): the CRM customer (`clients.id`) — the sale is theirs and their points move. */
  id: z.number().int().positive().optional(),
  /** What the customer card said, for the screens (never sent as a figure WorkSuite uses). */
  tier: z.string().trim().max(60).optional(),
  points: z.number().int().min(-1_000_000_000).max(1_000_000_000).optional(),
  group: z.string().trim().max(60).optional(),
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
  /* Phase 2, all optional (an older server ignores them; none sent is priced exactly as before). */
  /** The CRM customer the sale is theirs (`customer_id`). */
  customer_id: z.number().int().positive().optional(),
  /** Online, on a server with `capabilities.promotions`: WorkSuite prices with the counter's pricing (promotions). */
  apply_promotions: z.boolean().optional(),
  /** Priced offline: the promotions the till applied (`[]` none) — WorkSuite keeps the till's price. */
  promotion_ids: z.array(z.number().int().positive()).max(50).optional(),
  coupon_code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/).optional(),
  redeem_points: z.number().int().positive().max(100_000_000).optional(),
  /** A manager's approval (`apv_…`) for a discount past the cashier's rights. Never stored with the sale. */
  approval_id: approvalId.optional(),
  /** What the cart's promotions took off, as the till showed them (its own receipt prints them). */
  promotions: z.array(z.strictObject({ label: z.string().max(80), amount: money })).max(50).optional(),
  /** Points spent, and what they took off. */
  points: z.strictObject({ redeemed: z.number().int().min(0), discount: money }).optional(),
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
  /** Phase 2: the customer's points on it, as WorkSuite answered (`loyalty`), when a customer was named. */
  loyalty?: PosSaleLoyalty | null;
  /** WorkSuite refused it for want of a manager's approval (`approval_required`, `approval_expired`…): what to ask for. */
  approval?: PosApprovalAsk | null;
}

export interface PosSaleLoyalty {
  customer_id: number | null;
  earned: number;
  redeemed: number;
  /** The balance after the sale and the customer's tier, where WorkSuite (or the customer card) said. */
  balance?: number | null;
  tier?: string | null;
}

/* ── A manager's approval ─────────────────────────────────────────────── */

/** What WorkSuite asks a manager to approve (`approval`: `Approvals::refusal`). */
export const POS_APPROVAL_ACTIONS = ['discount', 'refund', 'void', 'cash_out', 'price_override'] as const;
export type PosApprovalAction = (typeof POS_APPROVAL_ACTIONS)[number];

export interface PosApprovalAsk {
  action: PosApprovalAction;
  /** Money, or the percentage for a discount. */
  amount: number;
  /** What it is over: the company's figure, or the cashier's ceiling for a discount; null when not said. */
  threshold: number | null;
  /** The sale it is bound to (its receipt number), when any. */
  subject: string | null;
}

/** The codes that mean "a manager can approve this": asked, or an approval that no longer fits. */
export const POS_APPROVAL_CODES: ReadonlySet<string> = new Set(['approval_required', 'approval_invalid', 'approval_used', 'approval_expired', 'approval_mismatch']);

/** The approval WorkSuite asks for in a refusal (`approval`), or null. */
export function approvalAskOf(v: unknown, fallbackAction?: PosApprovalAction): PosApprovalAsk | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  const action = (POS_APPROVAL_ACTIONS as readonly string[]).includes(String(a.action)) ? (a.action as PosApprovalAction) : fallbackAction;
  const amount = typeof a.amount === 'number' ? a.amount : typeof a.amount === 'string' ? Number(a.amount) : NaN;
  if (!action || !Number.isFinite(amount) || amount < 0) return null;
  const threshold = typeof a.threshold === 'number' && Number.isFinite(a.threshold) ? a.threshold : null;
  const subject = typeof a.subject === 'string' && a.subject.trim() ? a.subject.trim().slice(0, 80) : null;
  return { action, amount, threshold, subject };
}

/** A refusal that a manager's approval would lift: the code, WorkSuite's sentence and what to ask for. */
export interface PosApprovalNeed {
  code: string;
  message: string;
  ask: PosApprovalAsk;
}

/**
 * Why WorkSuite flagged a sale for review (`pos_sale_books.flags`): it priced it differently (`price_differs` — for a
 * sale made offline, the till's price was kept and differs from WorkSuite's now), the till sent no tenders so it is
 * recorded unpaid (`payment_missing`), it was sold while a register that has since closed was open (`late`), a product
 * it sold offline is no longer sold (`product_archived`), or it took stock below zero (`negative_stock`). A flag is
 * never a refusal: the sale stands.
 */
export const POS_SALE_FLAGS = ['price_differs', 'payment_missing', 'late', 'product_archived', 'negative_stock'] as const;
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
  /** Where each part went (`to`: `cash`, `credit`, `voucher`, or the method), Phase 2. */
  tenders: Array<{ method: string; amount: number; to?: string }>;
  refund_to?: string | null;
  lines: Array<{ product_id: number | null; quantity: number }>;
  reason: string | null;
  credit_note: string | null;
  at: string | null;
}

/** The receipt as WorkSuite recorded the sale (`Receipt::data`): its figures after pricing again, refunds, status. */
export interface PosServerReceipt {
  company: { name: string; address: string | null; phone: string | null; tax_number: string | null; email?: string | null; registration?: string | null };
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
  /* Phase 2, additive. */
  /** The till that took it (`till {code, name}`) and what the customer handed over. */
  till?: { code: string; name: string } | null;
  tendered?: number;
  /** The promotions it shows (`show_on_receipt`), summed per promotion. */
  promotions?: Array<{ label: string; amount: number }>;
  /** The customer's tier and points (`SaleExtras::forBook`), null without a customer. */
  loyalty?: { tier: string | null; earned: number; redeemed: number; balance: number | null } | null;
  /** The company's published receipt template (`capabilities.receipt_templates`): absent, the receipt is today's. */
  template?: PosReceiptTemplate | null;
}

/* ── The receipt template (Phase 2 S3) ────────────────────────────────── */

export const POS_RECEIPT_BLOCKS = ['logo', 'company', 'header', 'tax_numbers', 'details', 'customer', 'lines', 'totals', 'taxes', 'payments', 'points', 'refunds', 'footer', 'barcode'] as const;
export type PosReceiptBlockType = (typeof POS_RECEIPT_BLOCKS)[number];

/** One block of a template, in print order (`ReceiptTemplates::normalize`): its type, whether it prints, its options. */
export interface PosReceiptBlock {
  type: PosReceiptBlockType;
  on: boolean;
  align?: 'left' | 'center' | 'right';
  show_address?: boolean;
  show_phone?: boolean;
  show_email?: boolean;
  lines?: string[];
  label?: string;
  show_registration?: boolean;
  show_invoice?: boolean;
  show_till?: boolean;
  show_cashier?: boolean;
  show_discount?: boolean;
  /** The footer, by language (`en`, `si`, `ta`…). */
  text?: Record<string, string>;
  format?: 'code128' | 'qr';
  value?: 'receipt_no' | 'e_receipt_url';
}

/** A company's published receipt template (`GET device/receipt-template`, a receipt's `template`). */
export interface PosReceiptTemplate {
  id: number;
  version: number;
  paper: '80mm' | '58mm' | 'a4';
  blocks: PosReceiptBlock[];
  vars: { return_days: number | null };
}

const ALIGN = new Set(['left', 'center', 'right']);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : v === 1 || v === '1' || v === 'true' ? true : v === 0 || v === '0' || v === 'false' ? false : d);
const txt = (v: unknown, max: number): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');

/**
 * A template as WorkSuite sends it, read for what this till prints — known blocks once each, in their order, their
 * options checked — or null when it is none (no template published: today's receipt, exactly).
 */
export function receiptTemplateOf(v: unknown): PosReceiptTemplate | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  if (!Array.isArray(t.blocks)) return null;
  const seen = new Set<string>();
  const blocks: PosReceiptBlock[] = [];
  for (const raw of t.blocks) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    const type = String(b.type ?? '');
    if (!(POS_RECEIPT_BLOCKS as readonly string[]).includes(type) || seen.has(type)) continue;
    seen.add(type);
    const one: PosReceiptBlock = { type: type as PosReceiptBlockType, on: bool(b.on, true) };
    if (typeof b.align === 'string' && ALIGN.has(b.align)) one.align = b.align as PosReceiptBlock['align'];
    for (const k of ['show_address', 'show_phone', 'show_email', 'show_invoice', 'show_till', 'show_cashier', 'show_discount'] as const) if (k in b) one[k] = bool(b[k], true);
    if ('show_registration' in b) one.show_registration = bool(b.show_registration, false);
    if (type === 'header') one.lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => txt(l, 120)).filter(Boolean).slice(0, 8);
    if (type === 'tax_numbers') one.label = txt(b.label, 40);
    if (type === 'footer') {
      const text: Record<string, string> = {};
      if (typeof b.text === 'string') text.en = txt(b.text, 300);
      else if (b.text && typeof b.text === 'object') for (const [lang, words] of Object.entries(b.text as Record<string, unknown>).slice(0, 4)) if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) text[lang] = txt(words, 300);
      one.text = text;
    }
    if (type === 'barcode') {
      one.format = b.format === 'qr' ? 'qr' : 'code128';
      one.value = b.value === 'e_receipt_url' ? 'e_receipt_url' : 'receipt_no';
    }
    blocks.push(one);
  }
  if (!blocks.length) return null;
  const paper = t.paper === '58mm' || t.paper === 'a4' ? t.paper : '80mm';
  const vars = t.vars && typeof t.vars === 'object' ? (t.vars as Record<string, unknown>) : {};
  const days = typeof vars.return_days === 'number' && Number.isFinite(vars.return_days) ? Math.max(0, Math.min(3650, Math.floor(vars.return_days))) : null;
  return { id: Number(t.id) || 0, version: Number(t.version) || 0, paper, blocks, vars: { return_days: days } };
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
  /** Phase 2: points the customer spends on it, as typed, and a coupon code. */
  redeem: z.string().max(10).optional(),
  coupon: z.string().max(40).optional(),
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
/** What a line came back as (`capabilities.line_condition`): resaleable and opened go back to stock, damaged and faulty do not. */
export const POS_LINE_CONDITIONS = ['resaleable', 'opened', 'damaged', 'faulty'] as const;
export type PosLineCondition = (typeof POS_LINE_CONDITIONS)[number];
/** Where a refund's money goes (`capabilities.refund_to`): as it was paid, cash from this drawer, or store credit. */
export const POS_REFUND_TO = ['original', 'cash', 'store_credit'] as const;
export type PosRefundTo = (typeof POS_REFUND_TO)[number];

export const posGiveBackSchema = z.strictObject({
  ref,
  kind: z.enum(['refund', 'void']),
  reason: z.string().trim().min(3).max(200),
  lines: z
    .array(z.strictObject({ product_id: z.number().int().positive(), quantity: z.number().finite().positive().max(100_000), condition: z.enum(POS_LINE_CONDITIONS).optional() }))
    .min(1)
    .max(300)
    .optional(),
  restock: z.boolean().optional(),
  refund_to: z.enum(POS_REFUND_TO).optional(),
  approval_id: approvalId.optional(),
});
export type PosGiveBack = z.infer<typeof posGiveBackSchema>;

/**
 * The till's door for Phase 2's counter (`api/pos/device/*`, the till's credential, the signed-in cashier named by the
 * main process — never by the screen): held sales, tenders and balances, approval requests, customers and loyalty, top
 * sellers and stock, and the drawer's X report. Each is one operation the main process maps to its path; the answer is
 * WorkSuite's, status and body, read by the screens (src/modules/pos/desk.ts).
 */
const heldLine = z.strictObject({ product_id: z.number().int().positive(), quantity: z.number().finite().positive().max(100_000), name: z.string().trim().max(200).optional() });
const heldCustomer = z.strictObject({ name: z.string().trim().max(150).optional(), phone: z.string().trim().max(40).optional(), email: z.string().trim().max(150).optional(), client_id: z.number().int().positive().optional() });
const id = z.number().int().positive();
const amount = z.number().finite().min(0).max(999_999_999);
const askFields = { action: z.enum(POS_APPROVAL_ACTIONS), amount, subject: z.string().trim().max(80).optional(), reason: z.string().trim().max(200).optional() };
export const posDeskSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('tenders') }),
  z.strictObject({ op: z.literal('held') }),
  z.strictObject({
    op: z.literal('park'),
    lines: z.array(heldLine).min(1).max(200),
    discount_pct: pct.optional(),
    customer: heldCustomer.optional(),
    note: z.string().trim().max(200).optional(),
    label: z.string().trim().max(120).optional(),
    total: z.number().finite().min(0).max(1_000_000_000).optional(),
  }),
  z.strictObject({ op: z.literal('recall'), id }),
  z.strictObject({ op: z.literal('discard'), id }),
  z.strictObject({ op: z.literal('voucher'), code: z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/) }),
  z.strictObject({ op: z.literal('credit'), client_id: id }),
  z.strictObject({ op: z.literal('approvers') }),
  z.strictObject({ op: z.literal('ask'), ...askFields }),
  z.strictObject({ op: z.literal('request'), id }),
  z.strictObject({ op: z.literal('cancel'), id }),
  z.strictObject({ op: z.literal('customers'), q: z.string().trim().min(2).max(80) }),
  z.strictObject({ op: z.literal('customer'), id }),
  z.strictObject({
    op: z.literal('customerCreate'),
    name: z.string().trim().min(1).max(150),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(150).optional(),
    customer_group: z.string().trim().max(60).optional(),
  }),
  z.strictObject({ op: z.literal('loyalty') }),
  z.strictObject({ op: z.literal('topSellers'), limit: z.number().int().min(1).max(50).optional() }),
  z.strictObject({ op: z.literal('stock'), ids: z.array(id).max(200).optional() }),
  z.strictObject({ op: z.literal('report'), session_id: id.optional() }),
  z.strictObject({ op: z.literal('template') }),
]);
export type PosDeskOp = z.infer<typeof posDeskSchema>;

/** WorkSuite's answer through the till's door, as it came: the status and the JSON body. */
export interface PosDeskAnswer {
  status: number;
  body: Record<string, unknown> | null;
}

/** A manager's PIN at the counter (`POST device/approvals`): passed through once, never kept. */
export const posApproveSchema = z.strictObject({ approver_id: id, pin: z.string().regex(/^\d{4,8}$/), ...askFields });

/** Spread into `contract` (shared/ipc/contract.ts): the same checks as every channel there. */
export const posContract = {
  'pos:till': { input: none, session: true },
  /** `device_name`: what the till's dashboard calls this computer (Phase 2 lets the person name it). */
  'pos:pair': { input: z.strictObject({ terminal_id: z.number().int().positive(), take_over: z.boolean().optional(), device_name: z.string().trim().min(1).max(120).optional() }), session: true, rate: 2, sensitive: true },
  /** `unpair`: hand the till back on the server too (`capabilities.device_unpair`), not only forget it here. */
  'pos:forget': { input: z.strictObject({ discard: z.boolean().optional(), unpair: z.boolean().optional() }).optional(), session: true, rate: 2, sensitive: true },
  'pos:catalogue': { input: none, session: true, rate: 10 },
  /** The till's own settings (worksuite-desktop#296): card offline, the catalogue's refresh, the pictures' room. */
  'pos:tillSettings': { input: none, session: true },
  'pos:tillSettingsSet': { input: posTillSettingsPatchSchema, session: true, rate: 5 },
  /** `capable`: what `options.capabilities.catalogue` said — false goes straight to Inventory's list (an older server). */
  'pos:catalogueRefresh': { input: z.strictObject({ capable: z.boolean().optional() }).optional().or(z.null()), session: true, rate: 1 },
  'pos:sell': { input: posSellSchema, session: true, rate: 4, sensitive: true },
  'pos:sales': {
    input: z.strictObject({ session_id: z.number().int().positive().optional(), since: z.string().datetime().optional(), limit: z.number().int().min(1).max(500).optional() }).optional(),
    session: true,
    rate: 20,
  },
  'pos:sale': { input: z.strictObject({ ref }), session: true, rate: 20 },
  /** `catalogue`: bring the catalogue copy up to date as well, now (Sync now, the till opened). */
  'pos:syncNow': { input: z.strictObject({ catalogue: z.boolean().optional() }).optional().or(z.null()), session: true, rate: 2 },
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
  'pos:desk': { input: posDeskSchema, session: true, rate: 10 },
  'pos:approve': { input: posApproveSchema, session: true, rate: 2, sensitive: true },
  'pos:rename': { input: z.strictObject({ device_name: z.string().trim().min(1).max(120) }), session: true, rate: 2, sensitive: true },
};

/** A sale WorkSuite would take only with a manager's approval: nothing was sold; what to ask for. */
export type PosSellOutcome = { sale: PosSale; queued: boolean; printed: PosPrintOutcome | null } | { needs: PosApprovalNeed };
export type PosGiveBackOutcome = { sale: PosSale; refund: PosReturn; message: string } | { needs: PosApprovalNeed };

export interface PosOutputs {
  'pos:till': PosTillStatus;
  'pos:pair': { status: PosTillStatus; message: string };
  'pos:forget': PosTillStatus;
  'pos:catalogue': PosCatalogue | null;
  'pos:tillSettings': PosTillSettings;
  'pos:tillSettingsSet': PosTillSettings;
  'pos:catalogueRefresh': PosCatalogue;
  'pos:sell': PosSellOutcome;
  'pos:sales': PosSale[];
  'pos:sale': PosSale | null;
  'pos:syncNow': PosTillStatus;
  'pos:resolve': PosTillStatus;
  'pos:printSettings': PosPrintSettings;
  'pos:printSettingsSet': PosPrintSettings;
  'pos:printReceipt': PosPrintOutcome;
  'pos:receipt': PosServerReceipt | null;
  'pos:giveBack': PosGiveBackOutcome;
  'pos:email': { message: string };
  'pos:printReport': PosPrintOutcome;
  'pos:printTest': PosPrintOutcome;
  'pos:openDrawer': PosPrintOutcome;
  'pos:displayOpen': { opened: boolean; secondary: boolean };
  'pos:displayClose': boolean;
  'pos:carts': PosCarts | null;
  'pos:cartsSave': boolean;
  'pos:desk': PosDeskAnswer;
  'pos:approve': PosDeskAnswer;
  'pos:rename': { device_name: string; message: string };
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
