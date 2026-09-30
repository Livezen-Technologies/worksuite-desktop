import { z } from 'zod';

/**
 * WorkSuite Restaurant Manager on this computer (Restaurant SRS §4.2–4.4,
 * stage C "desktop POS / KDS / print agent"): what the renderer may ask the
 * main process, what it is told, and the rules both sides share. Pure — no
 * Electron, no network.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS COMPUTER IS A PAIRED TERMINAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The server knows its tills, kitchen screens and print hosts as terminals
 * (`restaurant_terminals`). Pairing one (`POST terminals/{id}/pair`) answers
 * with a device key, once; the main process keeps it in the OS credential
 * store and adds it as `X-Terminal-Key` to the Restaurant API's requests on
 * the way out (the API proxy for the screens, the sync loop and the print
 * agent for itself). A renderer never sees it.
 */

export const RESTAURANT_API = '/api/restaurant/v1';

const id = z.number().int().positive().max(2_147_483_647);

/* ── IPC inputs ─────────────────────────────────────────────────────────── */

export const restaurantPairInput = z.object({ org_id: id, branch_id: id, terminal_id: id });
export const restaurantUnpairInput = z.object({ revoke: z.boolean().optional(), discard: z.boolean().optional() });

/** What a till keeps for WorkSuite while it is out of reach — the server's offline ops (`POST sync`). */
export const OUTBOX_OPS = ['create_order', 'add_items', 'send'] as const;
export type RestaurantOutboxOp = (typeof OUTBOX_OPS)[number];

/** The offline permission (`offline_actions`) each op needs, as the server's `Offline::OPS`. */
export const OP_NEEDS: Record<RestaurantOutboxOp, string> = { create_order: 'create_order', add_items: 'add_items', send: 'print_kot' };

export const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A device reference, as the server takes it (`Service::validRef`). */
export const REF = /^[A-Za-z0-9_\-:.]{1,64}$/;

const modifierPick: z.ZodType<{ option_id: number; qty?: number; modifiers?: Array<{ option_id: number; qty?: number }> }> = z.object({
  option_id: id,
  qty: z.number().positive().max(99).optional(),
  modifiers: z.array(z.object({ option_id: id, qty: z.number().positive().max(99).optional() })).max(20).optional(),
});

/** A line as the till asks for it (`OrderLines::build`), with the device's own line id. */
export const restaurantLineInput = z.object({
  item_id: id,
  variant_id: id.nullable().optional(),
  qty: z.number().positive().max(999),
  notes: z.string().max(500).nullable().optional(),
  seat: z.number().int().min(1).max(99).nullable().optional(),
  course: z.string().max(20).nullable().optional(),
  price: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
  modifiers: z.array(modifierPick).max(30).optional(),
  /** A combo's choices (`OrderLines::combo`): the item picked for each choice component; the fixed parts go with it on their own. */
  combo: z.array(z.object({ component_id: id, item_id: id, variant_id: id.nullable().optional(), modifiers: z.array(modifierPick).max(30).optional() })).max(30).optional(),
  client_line_id: z.string().regex(REF),
});
export type RestaurantLineInput = z.infer<typeof restaurantLineInput>;

export const restaurantOutboxAdd = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create_order'),
    label: z.string().trim().min(1).max(200),
    data: z.object({
      uuid: z.string().regex(UUID),
      client_order_id: z.string().regex(REF).optional(),
      order_type: z.enum(['dine_in', 'takeaway']),
      table_id: id.nullable().optional(),
      guests: z.number().int().min(1).max(500).nullable().optional(),
      customer_name: z.string().max(120).nullable().optional(),
      notes: z.string().max(500).nullable().optional(),
      lines: z.array(restaurantLineInput).max(100),
      send: z.boolean().optional(),
      printed_locally: z.boolean().optional(),
    }),
  }),
  z.object({
    op: z.literal('add_items'),
    label: z.string().trim().min(1).max(200),
    data: z
      .object({ order_uuid: z.string().regex(UUID).optional(), order_id: id.optional(), lines: z.array(restaurantLineInput).min(1).max(100), send: z.boolean().optional(), printed_locally: z.boolean().optional() })
      .refine((d) => !!d.order_uuid || !!d.order_id, 'name the order'),
  }),
  z.object({
    op: z.literal('send'),
    label: z.string().trim().min(1).max(200),
    data: z.object({ order_uuid: z.string().regex(UUID).optional(), order_id: id.optional(), printed_locally: z.boolean().optional() }).refine((d) => !!d.order_uuid || !!d.order_id, 'name the order'),
  }),
]);
export type RestaurantOutboxInput = z.infer<typeof restaurantOutboxAdd>;

export const restaurantOutboxAction = z.object({ id: z.string().uuid(), action: z.enum(['retry', 'drop']) });

export const PRINT_MODES = ['escpos', 'page'] as const;
export type RestaurantPrintMode = (typeof PRINT_MODES)[number];

const printerMap = z.object({
  /** The printer on this computer the server's printer is. Null: not printed here. */
  device: z.string().trim().min(1).max(200).nullable(),
  /** `escpos`: the text raw to a thermal printer, cut at the end. `page`: laid out and printed through the OS driver. */
  mode: z.enum(PRINT_MODES),
  paper: z.enum(['80mm', '58mm']),
  cut: z.boolean(),
});
export type RestaurantPrinterMap = z.infer<typeof printerMap>;

export const restaurantPrintPatch = z
  .object({
    /** This computer claims and prints the server's jobs for the printers mapped below. */
    agent: z.boolean(),
    /** Server printer id → this computer's printer. */
    printers: z.record(z.string().regex(/^\d{1,10}$/), printerMap.nullable()),
    /** The server printer whose device the cash drawer is plugged into. */
    drawer_printer_id: id.nullable(),
    drawer_pin: z.union([z.literal(2), z.literal(5)]),
  })
  .partial();
export type RestaurantPrintPatch = z.infer<typeof restaurantPrintPatch>;

export const restaurantPrintTest = z.object({ printer_id: id });
/** A document the server rendered (`text`, 32 or 48 columns) that no print route took: printed here, on the receipt printer. */
export const restaurantPrintText = z.object({ text: z.string().min(1).max(40_000), printer_id: id.nullable().optional(), copies: z.number().int().min(1).max(3).optional() });

/* ── What the renderer is told ─────────────────────────────────────────── */

export interface RestaurantPairing {
  terminal_id: number;
  org_id: number;
  branch_id: number;
  name: string;
  code: string;
  /** pos, kds, expo, customer_display, print_host, back_office */
  mode: string;
  station_id: number | null;
  area_id: number | null;
  counter_id: number | null;
  pos_register_id: number | null;
  paired_at: string;
}

export type RestaurantOutboxState = 'waiting' | 'conflict' | 'refused';

export interface RestaurantOutboxItem {
  id: string;
  seq: number;
  /** The device's own reference (`client_ref`): the server answers it once. */
  ref: string;
  op: RestaurantOutboxOp;
  data: Record<string, unknown>;
  label: string;
  /** The order uuid made by an earlier queued `create_order` this item needs. */
  needs: string | null;
  state: RestaurantOutboxState;
  attempts: number;
  message: string | null;
  conflict_ids: number[];
  /** The order as the server has it, once it does. */
  order: { id: number; uuid: string; number: string; status: string } | null;
  created_at: string;
  updated_at: string;
}

export interface RestaurantPrintJobLog {
  job_id: number;
  document: string;
  printer_id: number | null;
  printer_name: string | null;
  device: string | null;
  ok: boolean;
  message: string;
  reprint: boolean;
  at: string;
}

export interface RestaurantStatus {
  pairing: RestaurantPairing | null;
  reachable: boolean;
  last_contact: string | null;
  last_sync: { at: string; applied: number; conflicts: number; refused: number } | null;
  /** Why the terminal is not working as one, in the server's words (a revoked key, a person without the permission). */
  problem: string | null;
  waiting: number;
  conflicts: number;
  refused: number;
  /** Items other people left at this terminal. */
  others: number;
  can_queue: boolean;
  why_not: string | null;
  copy: { taken_at: string; menu: boolean; floor: boolean } | null;
  /** The branch's newest live event at the last heartbeat: where the screens start catching up (`live?after=`). */
  last_seq: number;
  agent: { enabled: boolean; mapped: number; last_claim_at: string | null; problem: string | null; printers: Array<{ id: number; status: 'online' | 'error' }> };
}

export interface RestaurantCopy {
  terminal_id: number;
  branch_id: number;
  taken_at: string;
  pos: unknown;
  menu: unknown;
  floor: unknown;
}

export interface RestaurantPrintSettings {
  agent: boolean;
  printers: Record<string, RestaurantPrinterMap>;
  drawer_printer_id: number | null;
  drawer_pin: 2 | 5;
}

export interface RestaurantPrintOutcome {
  ok: boolean;
  device: string | null;
  message: string;
}

/* ── Rules both sides read ─────────────────────────────────────────────── */

/**
 * The Restaurant API paths the key goes to. Every route there reads the
 * terminal from the header when it cares (orders, kitchen, printing, sync);
 * nothing else on the server ever sees it.
 */
export function isRestaurantPath(path: string): boolean {
  return path === RESTAURANT_API || path.startsWith(`${RESTAURANT_API}/`) || path.startsWith(`${RESTAURANT_API}?`);
}

/**
 * Routes a page may not call: pairing answers with the key; the queue's
 * playback, the terminal's heartbeat and the print agent's claim and answer
 * are this computer's, done by the main process with the key.
 */
export const RESTAURANT_MAIN_ONLY: RegExp[] = [
  /^\/api\/restaurant\/v1\/terminals\/\d+\/pair\/?$/,
  /^\/api\/restaurant\/v1\/sync\/?$/,
  /^\/api\/restaurant\/v1\/sync\/heartbeat\/?$/,
  /^\/api\/restaurant\/v1\/print-jobs\/claim\/?$/,
  /^\/api\/restaurant\/v1\/print-jobs\/\d+\/(printed|failed)\/?$/,
];

/** Whether the proxy refuses this call from a page (by method: reading the print queue stays open). */
export function restaurantMainOnly(pathOnly: string, method: string): boolean {
  if (method === 'GET' || method === 'HEAD') return false;
  return RESTAURANT_MAIN_ONLY.some((re) => re.test(pathOnly));
}

/** The text a kitchen or receipt printer is sent: printable characters only, lines kept, trailing space gone. */
export function printableText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}
