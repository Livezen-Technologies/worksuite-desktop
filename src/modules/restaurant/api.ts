import { ApiError, request, type ApiResult } from '../../core/api';
import { call } from '../../core/bridge';
import { RESTAURANT_API } from '@shared/restaurant';

/**
 * Restaurant Manager's API (`/api/restaurant/v1`) as the till, the kitchen
 * screen and the printers screen use it. Requests go through the app's API
 * proxy, which adds this computer's terminal key (`X-Terminal-Key`) — the
 * renderer never holds it — so the server knows which till sent an order and
 * which station a kitchen screen is.
 *
 * THE SERVER DECIDES AND PRICES. Totals, change, splits, statuses and what a
 * person may do next (`choices`) are the server's answers, shown as they come;
 * nothing here works a figure out beyond formatting it.
 *
 * EVERY WRITE CARRIES AN IDEMPOTENCY KEY, made once per attempt: a second
 * press after a dropped connection is the same order, never another. Once
 * the server has answered, the next try is a new attempt with a new key.
 */

export const BASE = RESTAURANT_API;

/* ── shapes (as the server sends them) ───────────────────────────────── */

export type Money = string;

export interface Options {
  org: number;
  companies: Array<{ id: number; name: string }>;
  currency: string;
  can: Record<string, boolean>;
  branches: Array<{ id: number; branch_id: number; name: string; brand_id?: number | null; status?: string }>;
  courses: Record<string, string>;
  order_types?: Record<string, string>;
}

export interface PosContext {
  branch_id: number;
  terminal: { id: number; name: string; code: string; mode: string; station_id: number | null } | null;
  area_id: number | null;
  counter_id: number | null;
  default_order_type: string;
  order_types: string[];
  business_date: { id: number; business_date: string; status: string } | null;
  cashier_session: { id: number; status: string; opened_at: string | null } | null;
  policy: { offline_actions?: string[]; tenders?: string[]; table_cleaning?: boolean; kot_primary?: string; idle_lock_minutes?: number | null; required?: Record<string, unknown> };
}

export interface ModOption {
  id: number;
  name: string;
  price_delta: Money;
  is_default: boolean;
  orderable: boolean;
  state: string;
  groups: ModGroup[];
}

export interface ModGroup {
  id: number;
  name: string;
  kind: string;
  required: boolean;
  min: number;
  max: number;
  options: ModOption[];
}

export interface MenuItem {
  id: number;
  category_id: number;
  kind: string;
  name: string;
  description: string | null;
  price: Money;
  open_price: boolean;
  allergens: string[];
  course: string | null;
  station_id: number | null;
  state: string;
  orderable: boolean;
  variants: Array<{ id: number; name: string; price: Money; is_default: boolean; orderable: boolean; state: string }>;
  groups: ModGroup[];
  combo: Combo | null;
}

/** A combo as the branch menu has it (`Menu::combosFor`): fixed parts always, choice parts from what the waiter picks. */
export interface Combo {
  pricing: string;
  discount_pct: string | null;
  components: ComboComponent[];
}

export interface ComboComponent {
  id: number;
  kind: 'fixed' | 'choice' | string;
  label: string;
  item_id: number | null;
  variant_id: number | null;
  qty: string | null;
  min_choices: number;
  max_choices: number;
  options: Array<{ item_id: number; variant_id: number | null; upcharge: Money }>;
}

export interface BranchMenu {
  branch_id: number;
  channel: string;
  business_date: string;
  categories: Array<{ id: number; parent_id: number | null; name: string; course: string | null; sort: number }>;
  items: MenuItem[];
}

export interface FloorTable {
  id: number;
  area_id: number;
  floor_id: number;
  code: string;
  name: string | null;
  shape: string;
  capacity: number;
  status: string;
  status_label: string;
  in_use: boolean;
  session_id: number | null;
  version: number;
  party: { session_id: number; guests: number; opened_at: string | null; elapsed_minutes: number; waiter_name: string | null; tables: number[]; primary_table_id: number; version: number } | null;
  order: { id: number; number: string; status: string; status_label: string; total: Money; currency: string | null; lines: number; ready: number; waiting: number; held: number; version: number } | null;
  next_reservation: { id: number; name: string; guests: number; reserved_for: string | null; status: string } | null;
}

export interface Floor {
  branch_id: number;
  business_date: string | null;
  at: string;
  floors: Array<{ id: number; name: string }>;
  areas: Array<{ id: number; name: string; floor_id?: number | null }>;
  tables: FloorTable[];
  counts: Record<string, number>;
  statuses: Record<string, string>;
}

export interface OrderLine {
  id: number;
  parent_id: number | null;
  item_id: number | null;
  kind: string;
  name: string;
  variant_name: string | null;
  qty: string;
  unit_price: Money;
  modifiers_total: Money;
  line_total: Money;
  course: string | null;
  seat: number | null;
  notes: string | null;
  status: string;
  status_label: string;
  comp: boolean;
  void_reason: string | null;
  version: number;
  modifiers: Array<{ id: number; name: string; qty: string; price_delta: Money; group_name: string | null }>;
  choices: string[];
}

export interface Order {
  id: number;
  uuid: string;
  number: string;
  branch_id: number;
  order_type: string;
  order_type_label: string;
  status: string;
  status_label: string;
  session_id: number | null;
  table_id: number | null;
  table_label: string | null;
  guests: number | null;
  customer: { name: string | null; phone: string | null };
  allergy_warning: string | null;
  waiter_name: string | null;
  currency: string | null;
  subtotal: Money;
  discount_total: Money;
  charge_total: Money;
  tax_total: Money;
  rounding: Money;
  total: Money;
  paid_total: Money;
  balance: Money;
  notes: string | null;
  offline: boolean;
  version: number;
  lines: OrderLine[];
  courses: Array<{ course: string; label: string; status: string }>;
  choices: string[];
}

export interface Quote {
  currency: string;
  subtotal: Money;
  discount_total: Money;
  charge_total: Money;
  tax_total: Money;
  rounding: Money;
  total: Money;
  prices_include_tax: boolean;
  lines: Array<{ order_item_id: number; name: string; qty: string; seat: number | null; gross: Money; discount: Money; tax: Money; comp: boolean }>;
  charges: Array<{ name?: string; amount?: Money }>;
  taxes: Array<{ name?: string; rate?: string; amount?: Money }>;
}

export interface Bill {
  id: number;
  number: string;
  order_id: number;
  split_mode: string;
  split_mode_label: string;
  split_index: number;
  split_count: number;
  status: string;
  status_label: string;
  currency: string | null;
  subtotal: Money;
  discount_total: Money;
  charge_total: Money;
  tax_total: Money;
  rounding: Money;
  total: Money;
  paid_total: Money;
  balance: Money;
  printed_count: number;
  client_id?: number | null;
  invoice_id?: number | null;
  version: number;
  lines?: Array<{ id: number; kind: string; description: string; qty: string; amount: Money }>;
}

export interface Ticket {
  id: number;
  number: string;
  kind: string;
  mark: string | null;
  order_id: number;
  order_number?: string | null;
  station_id: number;
  station_name: string | null;
  status: string;
  status_label: string;
  table_label: string | null;
  order_type: string | null;
  course: string | null;
  received_at: string | null;
  elapsed_minutes: number;
  tone: 'ok' | 'warn' | 'late';
  late: boolean;
  print_status: string | null;
  notes?: string | null;
  allergy_warning?: string | null;
  version: number;
  choices?: string[];
  items?: Array<{ id: number; order_item_id: number; name: string; variant_name: string | null; qty: string; modifiers: string[]; notes: string | null; seat: number | null; course: string | null; allergens: string[]; status: string }>;
}

export interface Board {
  branch_id: number;
  station_id: number | null;
  at: string;
  stations: Array<{ id: number; name: string; kind: string; kds: boolean; warn_minutes: number; late_minutes: number }>;
  tickets: Ticket[];
  bumped: Ticket[];
  all_day: Array<{ name: string; variant_name: string | null; qty: string }>;
  held: Array<{ order_item_id: number; order_number: string; name: string; qty: string; course: string | null }>;
}

export interface Expo {
  branch_id: number;
  at: string;
  orders: Array<{ order_id: number; number: string; status: string; order_type: string; table_label: string | null; waiter_name: string | null; tickets: Ticket[]; releasable: boolean; version: number }>;
}

export interface CashierSession {
  id: number;
  branch_id: number;
  status: string;
  status_label: string;
  currency: string | null;
  opening_float: Money;
  blind: boolean;
  expected_cash: Money | null;
  counted_cash: Money | null;
  variance: Money | null;
  opened_at: string | null;
  closed_at: string | null;
  user_name: string | null;
  version: number;
}

export interface PrintJob {
  id: number;
  document: string;
  ref_type: string;
  ref_id: number;
  printer_id: number | null;
  status: string;
  status_label: string;
  attempts: number;
  last_error: string | null;
  reprint: boolean;
  created_at: string | null;
  printed_at: string | null;
}

export interface Printer {
  id: number;
  branch_id: number;
  name: string;
  kind: string;
  connection: string;
  address: string | null;
  host_terminal_id: number | null;
  paper: string;
  status: string;
  active: boolean;
}

export interface Terminal {
  id: number;
  branch_id: number;
  name: string;
  code: string;
  mode: string;
  station_id: number | null;
  paired: boolean;
  active: boolean;
  last_seen_at: string | null;
}

export interface Structure {
  branches: Array<{ id: number; branch_id: number; name: string }>;
  terminals: Terminal[];
  printers: Printer[];
  stations: Array<{ id: number; name: string; branch_id: number }>;
}

export interface Conflict {
  id: number;
  branch_id: number;
  terminal_id: number | null;
  client_ref: string | null;
  entity: string;
  entity_id: number | null;
  kind: string;
  kind_label: string;
  message: string | null;
  status: string;
  created_at: string | null;
  client_payload: Record<string, unknown> | null;
}

export interface Approval {
  id: number;
  action: string;
  action_label: string;
  amount: Money;
  reason: string;
  status: string;
  status_label: string;
  order_id: number | null;
  requested_by_name: string | null;
  expires_at: string | null;
}

/** A discount, comp, price override (or a refund, a void…) as the server records it (`Adjustments::shape`). */
export interface Adjustment {
  id: number;
  kind: string;
  kind_label: string;
  order_id: number | null;
  order_item_id: number | null;
  bill_id: number | null;
  payment_id: number | null;
  amount: Money;
  pct: string | null;
  currency: string | null;
  reason: string;
  requested_by_name: string | null;
  approver_name: string | null;
  status: string;
  removed_at: string | null;
  created_at: string | null;
}

/** A payment on a bill (`Payments::shape`); a refund is a payment of its own with `refund_of_id`. */
export interface Payment {
  id: number;
  bill_id: number;
  order_id: number;
  method: string;
  method_label: string;
  amount: Money;
  tendered: Money;
  change_given: Money;
  currency: string | null;
  status: string;
  status_label: string;
  provider_ref: string | null;
  refunded_total: Money;
  refund_of_id: number | null;
  created_at: string | null;
  version: number;
}

/** A customer from CRM with the restaurant's tab (`Customers::listRow`); the phone masked unless the person manages customers. */
export interface Customer {
  client_id: number;
  name: string;
  phone: string | null;
  email: string | null;
  restaurant: boolean;
  has_allergies: boolean;
  visits: number;
}

/** A move a booking may make now, as the server offers it to this person (`ReservationMachine::choices`). */
export interface ReservationChoice {
  to: string;
  on: string;
  label: string;
  needs: string[];
}

export interface Reservation {
  id: number;
  branch_id: number;
  area_id: number | null;
  table_id: number | null;
  table_code: string | null;
  client_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  reserved_for: string | null;
  ends_at: string | null;
  local_date: string;
  local_time: string;
  duration_minutes: number;
  guests: number;
  occasion: string | null;
  special_requests: string | null;
  notes: string | null;
  status: string;
  status_label: string;
  source: string;
  session_id: number | null;
  version: number;
  choices: ReservationChoice[];
}

export interface Timeline {
  branch_id: number;
  date: string;
  tables: Array<{
    table_id: number;
    code: string;
    capacity: number;
    area_id: number;
    status: string;
    blocks: Array<{ kind: 'reservation' | 'party'; id: number; name?: string; guests: number; from: string | null; to: string | null; status: string }>;
  }>;
}

export interface Availability {
  reserved_for: string | null;
  duration_minutes: number;
  open: boolean;
  tables: Array<{ id: number; code: string; capacity: number; area_id: number; floor_id: number }>;
  suggestions: Array<{ reserved_for: string; tables: number }>;
}

export interface LiveEvent {
  seq: number;
  entity: string;
  id: number;
  version: number;
  kind: string;
}

/* ── errors ──────────────────────────────────────────────────────────── */

/** What a refusal carries for the screen, beside its sentence (`ServiceController::fault`, `RestaurantController::refused`). */
export interface Refusal {
  code: string | null;
  message: string;
  approval: { action: string; amount: Money; pct?: number; subject_type?: string; subject_id?: number; order_id?: number; branch_id?: number } | null;
  status: number;
}

export function refusal(e: unknown): Refusal {
  if (e instanceof ApiError) {
    const d = (e.data && typeof e.data === 'object' ? e.data : {}) as { code?: unknown; approval?: unknown };
    return {
      code: typeof d.code === 'string' ? d.code : e.code,
      message: e.message,
      approval: d.approval && typeof d.approval === 'object' ? (d.approval as Refusal['approval']) : null,
      status: e.status,
    };
  }
  return { code: null, message: e instanceof Error ? e.message : String(e), approval: null, status: 0 };
}

/** The server wants somebody to approve this first (a void after the kitchen, a discount above the limit). */
export function needsApproval(r: Refusal): boolean {
  return r.code === 'approval_required' || r.code === 'approval_needed';
}

/** WorkSuite did not answer (the proxy's 503, or no connection at all). */
export function unreachable(e: unknown): boolean {
  return e instanceof ApiError && (e.offline || e.status === 0 || e.code === 'NETWORK_UNREACHABLE');
}

/* ── calls ───────────────────────────────────────────────────────────── */

type Query = Record<string, string | number | boolean | null | undefined>;

let org: number | null = null;
/** Every call names the company the terminal is paired in (`?org=`). */
export function setOrg(id: number | null): void {
  org = id;
}

function q(query?: Query): Query {
  return { ...(org ? { org } : {}), ...(query ?? {}) };
}

export async function get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  return (await request<T>('GET', `${BASE}${path}`, { query: q(query), signal })).data;
}

export function getMeta<T>(path: string, query?: Query, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request<T>('GET', `${BASE}${path}`, { query: q(query), signal });
}

export function newKey(): string {
  return `desk-${globalThis.crypto.randomUUID()}`;
}

/** A write, once: the key is made per attempt and sent with it. */
export async function write<T>(path: string, body: unknown = {}, key: string = newKey()): Promise<ApiResult<T>> {
  return request<T>('POST', `${BASE}${path}`, { query: q(), body, headers: { 'Idempotency-Key': key } });
}

/* ── the main process ────────────────────────────────────────────────── */

export const bridge = {
  pairing: () => call('restaurant:pairing'),
  status: () => call('restaurant:status'),
  syncNow: () => call('restaurant:syncNow'),
  copy: () => call('restaurant:copy'),
  outbox: () => call('restaurant:outbox'),
  printSettings: () => call('restaurant:printSettings'),
  printJobs: () => call('restaurant:printJobs'),
};

/** Query keys, in one place so a live event can refresh what it touched. */
export const K = {
  all: ['restaurant'] as const,
  pairing: ['restaurant', 'pairing'] as const,
  status: ['restaurant', 'status'] as const,
  copy: ['restaurant', 'copy'] as const,
  outbox: ['restaurant', 'outbox'] as const,
  options: (org: number | null) => ['restaurant', 'options', org] as const,
  pos: (branch: number) => ['restaurant', 'pos', branch] as const,
  menu: (branch: number, channel: string) => ['restaurant', 'menu', branch, channel] as const,
  floor: (branch: number) => ['restaurant', 'floor', branch] as const,
  order: (id: number) => ['restaurant', 'order', id] as const,
  orders: (branch: number) => ['restaurant', 'orders', branch] as const,
  bills: (order: number) => ['restaurant', 'bills', order] as const,
  kitchen: (branch: number, station: number | null) => ['restaurant', 'kitchen', branch, station] as const,
  expo: (branch: number) => ['restaurant', 'expo', branch] as const,
  cashier: ['restaurant', 'cashier'] as const,
  structure: (org: number, branch: number) => ['restaurant', 'structure', org, branch] as const,
  printJobs: (branch: number) => ['restaurant', 'print-jobs', branch] as const,
  conflicts: (branch: number) => ['restaurant', 'conflicts', branch] as const,
  approvals: ['restaurant', 'approvals'] as const,
  adjustments: (order: number) => ['restaurant', 'adjustments', order] as const,
  payments: (order: number) => ['restaurant', 'payments', order] as const,
  reservations: (branch: number, date: string) => ['restaurant', 'reservations', branch, date] as const,
  timeline: (branch: number, date: string) => ['restaurant', 'timeline', branch, date] as const,
};

/** Money as the server wrote it, with the company's currency. */
export function money(v: Money | null | undefined, currency?: string | null): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  const text = Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
  return currency ? `${currency} ${text}` : text;
}

/** A quantity without trailing zeros: "2.000" → "2". */
export function qty(v: string | number): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : String(v);
}
