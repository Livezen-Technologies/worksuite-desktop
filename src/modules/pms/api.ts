import { ApiError, apiGetMeta, apiUrl, request } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';

/**
 * Hotel PMS (the server's `/api/pms/v1`, `app/Modules/Pms`): the front desk,
 * the cashier and the night audit of WorkSuite Desktop (PMS-DSK-001).
 *
 * THE SERVER DECIDES. Money is a two-place decimal string in the property's
 * currency, worked out on the server; availability, prices, taxes, balances,
 * readiness and the business date are the server's. This module writes them,
 * never works them out. A refusal is shown in the server's own sentence, and
 * its `errors.code` says what to offer next (`room_not_ready` → the override,
 * `balance` → the folios that owe, `version_conflict` → reload).
 *
 * EVERY WRITE THAT CAN BE PRESSED TWICE CARRIES AN IDEMPOTENCY KEY, made once
 * per attempt: a booking, a walk-in, a check-in, a check-out, a charge, a
 * payment. A second press after a dropped answer is the same move.
 *
 * OFFLINE THE DESK READS, AND WAITS (PMS-DSK-003). The rack, the arrivals,
 * departures and in-house lists and the property's options come from the last
 * copy (READ_CACHE, `shared/pms-cache.ts`). Nothing is queued: every write
 * refuses until WorkSuite is back, so no booking or payment is made against
 * an inventory or a balance this computer cannot see.
 */

export const BASE = '/api/pms/v1';

type Query = Record<string, string | number | boolean | null | undefined>;

/** A read; `offline` when it is the last copy this computer kept. */
export async function pGetMeta<T>(path: string, query?: Query, signal?: AbortSignal): Promise<{ data: T; offline: boolean; cachedAt: string | null }> {
  const r = await apiGetMeta<T>(`${BASE}${path}`, query, signal);
  return { data: r.data, offline: r.offline, cachedAt: r.cachedAt };
}

export async function pGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  return (await pGetMeta<T>(path, query, signal)).data;
}

/** A write; the server's own sentence comes back beside what it did. */
export async function pPost<T = unknown>(path: string, body: unknown = {}, key?: string): Promise<{ data: T; message: string }> {
  const r = await request<T>('POST', `${BASE}${path}`, { body, headers: key ? { 'Idempotency-Key': key } : undefined });
  return { data: r.data, message: r.message ?? 'Done.' };
}

export async function pDelete<T = unknown>(path: string): Promise<{ data: T; message: string }> {
  const r = await request<T>('DELETE', `${BASE}${path}`);
  return { data: r.data, message: r.message ?? 'Removed.' };
}

/** A file for a guest (`POST guests/{id}/documents`, multipart): an ID, a signed registration card. */
export async function pUpload<T = unknown>(path: string, file: Blob, name: string, fields: Record<string, string | number | null | undefined>): Promise<{ data: T; message: string }> {
  const form = new FormData();
  form.append('file', file, name);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') form.append(k, String(v));
  const r = await request<T>('POST', `${BASE}${path}`, { body: form });
  return { data: r.data, message: r.message ?? 'Kept.' };
}

/** The server keeps guest documents up to 15 MB; the desktop's API proxy takes 25 MB a request. */
export const MAX_DOCUMENT = 15 * 1024 * 1024;

/** Whether WorkSuite can be reached from this computer. Every write waits for it (PMS-DSK-003). */
export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export const OFFLINE = 'You are offline. Money, bookings and check-ins wait for WorkSuite, so no room or payment is taken against what this computer cannot see.';

export function newKey(prefix = 'pms'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`.slice(0, 100);
}

export function errorText(e: unknown, fallback = 'That could not be done. Try again.'): string {
  return e instanceof Error && e.message.trim() ? e.message : fallback;
}

/** What the server sent beside a refusal (`errors`): the code, the candidates, the folios that owe. */
export function errorData<T>(e: unknown): T | null {
  return e instanceof ApiError && e.data && typeof e.data === 'object' ? (e.data as T) : null;
}

/** A refusal's `errors.code` (`room_not_ready`, `balance`, `version_conflict`…). */
export function codeOf(e: unknown): string | null {
  const c = errorData<{ code?: unknown }>(e)?.code;
  return typeof c === 'string' ? c : null;
}

export function statusOf(e: unknown): number | null {
  return e instanceof ApiError ? e.status : null;
}

// ── writing what the server sent ─────────────────────────────────────────

/**
 * "25000.00" in LKR → "LKR 25,000.00". The figure is the server's decimal
 * string, grouped as written — never parsed into a float and rounded here.
 */
export function money(amount: string | number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const s = String(amount).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return currency ? `${currency} ${s}` : s;
  const whole = m[2]!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (m[3] ?? '').padEnd(2, '0');
  return `${currency ? `${currency} ` : ''}${m[1]}${whole}.${cents}`;
}

/** Whether a decimal string from the server is nought ("0.00", "-0.00"). */
export function isZero(amount: string | null | undefined): boolean {
  return !amount || /^-?0+(\.0+)?$/.test(amount.trim());
}

/** Whether a decimal string is below nought. */
export function isNegative(amount: string | null | undefined): boolean {
  return !!amount && amount.trim().startsWith('-') && !isZero(amount);
}

/** "2026-09-18" → "18 Sep"; with the weekday, "Fri 18 Sep". A business date is a day, on no clock. */
export function day(ymd: string | null | undefined, weekday = false): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { ...(weekday ? { weekday: 'short' as const } : {}), day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A UTC "Y-m-d H:i:s" stamp from the server, on this computer's clock. */
export function stamp(s: string | null | undefined): string {
  if (!s) return '—';
  const t = new Date(s.includes('T') ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(t.getTime()) ? s : t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "front_desk" → "Front desk". */
export function nice(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Adds days to a YYYY-MM-DD date (a date on no clock). */
export function plusDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const K = {
  all: ['pms'] as const,
  /** Screens that follow the house as it moves (rack, lists, housekeeping): refreshed by the server's live nudges. */
  live: ['pms', 'live'] as const,
  properties: ['pms', 'properties'] as const,
  options: (org: number, property: number) => ['pms', 'options', org, property] as const,
  rack: (property: number) => ['pms', 'live', 'rack', property] as const,
  arrivals: (property: number, date: string) => ['pms', 'live', 'arrivals', property, date] as const,
  departures: (property: number, date: string) => ['pms', 'live', 'departures', property, date] as const,
  inHouse: (property: number) => ['pms', 'live', 'in-house', property] as const,
  hkTasks: (property: number) => ['pms', 'live', 'hk-tasks', property] as const,
  dashboard: (property: number) => ['pms', 'live', 'dashboard', property] as const,
  reservations: (property: number, f: object) => ['pms', 'reservations', property, f] as const,
  reservation: (id: number) => ['pms', 'reservation', id] as const,
  history: (id: number) => ['pms', 'reservation', id, 'history'] as const,
  deposit: (id: number) => ['pms', 'reservation', id, 'deposit'] as const,
  checkin: (id: number) => ['pms', 'reservation', id, 'check-in'] as const,
  checkout: (id: number) => ['pms', 'reservation', id, 'check-out'] as const,
  candidates: (line: number, any: boolean) => ['pms', 'candidates', line, any] as const,
  stay: (id: number) => ['pms', 'stay', id] as const,
  folio: (id: number) => ['pms', 'folio', id] as const,
  services: (property: number) => ['pms', 'services', property] as const,
  search: (q: string) => ['pms', 'search', q] as const,
  guests: (org: number, q: string) => ['pms', 'guests', org, q] as const,
  guest: (id: number) => ['pms', 'guest', id] as const,
  guestReservations: (id: number) => ['pms', 'guest', id, 'reservations'] as const,
  availability: (f: object) => ['pms', 'availability', f] as const,
  room: (id: number) => ['pms', 'room', id] as const,
  roomHistory: (id: number) => ['pms', 'room', id, 'history'] as const,
  cashier: (property: number) => ['pms', 'cashier', property] as const,
  shift: (id: number) => ['pms', 'shift', id] as const,
  audit: (property: number) => ['pms', 'audit', property] as const,
  auditRun: (id: number) => ['pms', 'audit-run', id] as const,
  request: (id: number) => ['pms', 'request', id] as const,
  requests: (property: number) => ['pms', 'live', 'requests', property] as const,
  hkTask: (id: number) => ['pms', 'hk-task', id] as const,
  hkStaff: (property: number) => ['pms', 'hk-staff', property] as const,
  maintenance: (property: number, f: object) => ['pms', 'live', 'maintenance', property, f] as const,
  issue: (id: number) => ['pms', 'issue', id] as const,
  roomIssues: (id: number) => ['pms', 'room', id, 'issues'] as const,
  lostFound: (property: number, f: object) => ['pms', 'lost-found', property, f] as const,
  lostItem: (id: number) => ['pms', 'lost-item', id] as const,
  folios: (property: number, status: string) => ['pms', 'folios', property, status] as const,
  outbox: (property: number, status: string) => ['pms', 'outbox', property, status] as const,
  kpis: (property: number, from: string, to: string) => ['pms', 'kpis', property, from, to] as const,
  reports: (property: number) => ['pms', 'reports', property] as const,
  report: (property: number, key: string, f: object) => ['pms', 'report', property, key, f] as const,
  calendar: (property: number, from: string, days: number) => ['pms', 'live', 'calendar', property, from, days] as const,
  directory: ['chat', 'directory'] as const,
};

/**
 * A file the server answers with (a report's CSV, a guest's document): its
 * bytes and the name it gives, through the same API proxy as every read. A
 * refusal comes back as JSON and is thrown in the server's sentence.
 */
export async function pFile(path: string, query?: Query): Promise<{ bytes: Uint8Array<ArrayBuffer>; name: string | null; type: string }> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`${BASE}${path}`, query), { headers: { Accept: '*/*' } });
  } catch {
    throw new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'INTERNAL');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('json')) {
    let message = `The server answered ${res.status}.`;
    try {
      const j = (await res.json()) as { message?: unknown };
      if (typeof j.message === 'string') message = j.message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status || 500, message, null);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? null;
  return { bytes: new Uint8Array(await res.arrayBuffer()), name: name ? decodeURIComponent(name) : null, type };
}

/** A move the server offers on a record (`options`): the action, its words and what it needs said. */
export interface ActionOption {
  action: string;
  to?: string;
  label: string;
  needs: string[];
}

// ── shapes, as the server sends them ─────────────────────────────────────

export interface Badge {
  status: string;
  label: string;
  colour: string;
  icon: string;
}

export interface Property {
  id: number;
  org_id: number;
  code: string;
  name: string;
  status: 'setup' | 'active' | 'inactive';
  status_label: string;
  currency: string;
  timezone: string;
  check_in_time: string | null;
  check_out_time: string | null;
  business_date: string | null;
  rooms?: number;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  legal_name?: string | null;
  tax_registration?: string | null;
}

export interface BusinessDay {
  business_date: string | null;
  status: string | null;
  status_label: string | null;
  calendar_date: string;
  days_behind: number;
  night_audit_time: string | null;
  timezone: string;
  last_closed: string | null;
}

export interface Labelled {
  value: string;
  label: string;
}

export interface Options {
  org_id: number;
  permissions: string[];
  scope: string;
  properties: Property[];
  business_date: BusinessDay | null;
  reservation_statuses: Array<Labelled & { colour: string; icon: string; consumes: boolean }>;
  room_display: Badge[];
  housekeeping_statuses: Labelled[];
  service_statuses: Labelled[];
  outage_kinds: Labelled[];
  night_audit_steps: Labelled[];
  booking_types: Labelled[];
  guarantees: Labelled[];
  vip_levels: Labelled[];
  document_kinds: Labelled[];
  sources: Array<{ id: number; code: string; name: string; kind: string; active?: boolean }>;
}

/** A guest as operations screens show them (PMS-SEC-011): never a folio, a payment or an ID. */
export interface ServiceCard {
  name: string | null;
  title?: string | null;
  vip_level: string | null;
  language?: string | null;
  special_requirements?: string | null;
  flags?: string[];
}

export interface RackGuest {
  guest: ServiceCard;
  reservation_id?: number;
  reservation_room_id?: number;
  confirmation_no?: string;
  status?: string;
  status_label?: string;
  arrival_date?: string;
  departure_date?: string;
  adults?: number;
  children?: number;
  eta?: string | null;
  balance?: Array<{ currency: string; balance: string }>;
}

export interface RackRoom {
  id: number;
  number: string;
  name: string | null;
  room_type_id: number;
  room_type: string | null;
  room_type_name?: string | null;
  building_id: number | null;
  building: string | null;
  floor_id: number | null;
  floor: string | null;
  hk_zone: string | null;
  beds: number | null;
  occupancy: 'vacant' | 'occupied';
  hk_status: string;
  hk_status_label: string;
  service_status: string;
  is_sellable: boolean;
  ready: boolean;
  badge: Badge;
  vip: boolean;
  due_in: boolean;
  due_out: boolean;
  in_house: RackGuest[];
  arriving: RackGuest[];
  hk_task: { id: number; status: string; assigned_to: number | null } | null;
  open_issues: number;
  status_at: string | null;
  version: number;
  actions: Array<{ action: RackAction; label: string }>;
}

export type RackAction = 'new_reservation' | 'walk_in' | 'block_room' | 'maintenance' | 'view_room' | 'open_folio' | 'post_charge' | 'room_move' | 'check_out' | 'extend_stay';

export interface Rack {
  property_id: number;
  business_date: string;
  rooms: RackRoom[];
  floors: Array<{ building_id: number | null; building: string | null; floor_id: number | null; floor: string | null; rooms: number[] }>;
  counts: Record<string, number>;
  legend: Badge[];
  room_types: Array<{ id: number; code: string; name: string }>;
  lists: Partial<Record<'arrivals' | 'departures' | 'in_house', number>>;
  server_time: string;
}

export interface Readiness {
  assigned: boolean;
  in_service: boolean;
  vacant: boolean;
  ready: boolean;
  hk_status: string | null;
  blockers: string[];
  overridable: boolean;
}

export interface ArrivalRoom {
  reservation_room_id: number;
  line_no: number;
  room_type_id: number;
  room_type: string | null;
  arrival_date: string;
  departure_date: string;
  adults: number;
  children: number;
  room_id: number | null;
  room_number: string | null;
  readiness: Readiness;
  due_today?: boolean;
  can_check_in?: boolean;
  needs_override?: boolean;
}

export interface ArrivalCard {
  reservation_id: number;
  confirmation_no: string;
  status: string;
  status_label: string;
  guest_id: number;
  guest_name: string | null;
  vip_level: string | null;
  eta: string | null;
  special_requests: string | null;
  guarantee_type: string;
  id_verified: boolean;
  deposit: { status: string; required: string; paid: string } | null;
  version: number;
  rooms: ArrivalRoom[];
}

export interface Preference {
  id: number;
  category: string;
  preference: string;
  note: string | null;
  is_flag: boolean;
}

export interface CheckInScreen extends ArrivalCard {
  business_date: string;
  preferences: Preference[];
  id_required: boolean;
  has_identity: boolean;
  early_checkin: { offered: boolean; package_id?: number; name?: string; price?: string; check_in_time?: string };
  can_override: boolean;
}

export interface KeyResult {
  ok: boolean;
  status: string;
  message: string;
}

export interface FolioShape {
  id: number;
  folio_no: string;
  property_id: number;
  reservation_id: number | null;
  stay_id: number | null;
  label: string;
  payee_type: 'guest' | 'company' | 'agent';
  payee_client_id: number | null;
  payee_name: string | null;
  status: 'open' | 'settled' | 'transferred_ar' | 'closed';
  status_label: string;
  balance: string;
  currency: string;
  opened_business_date: string | null;
  settled_at: string | null;
  closed_at: string | null;
  invoice_id: number | null;
  receipt_no: string | null;
  ar_reference: string | null;
  version: number;
}

export interface FolioItem {
  id: number;
  folio_id: number;
  item_type: string;
  item_type_label: string;
  service_id: number | null;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  tax_amount: string;
  total: string;
  currency: string;
  taxes: Array<{ name: string; amount: string; rate?: string | number | null }>;
  business_date: string;
  source: string;
  source_ref: string | null;
  parent_item_id: number | null;
  routed_from_folio_id: number | null;
  is_void: boolean;
  void_reason: string | null;
  terminal: string | null;
  posted_by: string | null;
  posted_at: string | null;
  locked: boolean;
}

export interface Payment {
  id: number;
  folio_id: number | null;
  reservation_id: number | null;
  stay_id: number | null;
  kind: 'payment' | 'deposit' | 'refund';
  kind_label: string;
  method: string;
  method_label: string;
  amount: string;
  currency: string;
  base_amount: string;
  status: string;
  status_label: string;
  provider: string | null;
  provider_ref: string | null;
  card_last4: string | null;
  refund_of_id: number | null;
  reason: string | null;
  cashier_session_id: number | null;
  terminal: string | null;
  business_date: string;
  by: string | null;
  at: string;
  refundable: string | null;
}

export interface FolioView extends FolioShape {
  items: FolioItem[];
  payments: Payment[] | null;
  totals: { charges: string; taxes: string; payments: string | null; refunds: string | null; balance: string };
  tax_summary: Array<{ name: string; amount: string }>;
  options: Array<{ to: string; label: string; on: string; perm: string | null; needs: string[] }>;
}

export interface Stay {
  id: number;
  property_id: number;
  reservation_id: number;
  confirmation_no: string | null;
  reservation_room_id: number;
  room_id: number;
  room_number: string | null;
  room_type_id: number | null;
  room_type: string | null;
  guest_id: number;
  guest_name: string | null;
  vip_level: string | null;
  status: 'in_house' | 'checked_out';
  status_label: string;
  arrival_date: string;
  departure_date: string;
  nights: number;
  adults: number;
  children: number;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checked_out_at: string | null;
  override_reason: string | null;
  override_by: string | null;
  id_verified: boolean;
  guarantee_verified: boolean;
  registration_card_file_id: number | null;
  posting_allowed: boolean;
  credit_limit: string | null;
  credit_left: string | null;
  currency: string;
  key_status: string | null;
  key_status_label: string | null;
  version: number;
  folios: FolioShape[] | null;
  routing: Array<{ id: number; target_folio_id: number; charge_types: string[]; service_ids: number[]; whole_reservation: boolean; valid_from: string | null; valid_to: string | null }> | null;
  moves: Array<{ from_room_id: number | null; to_room_id: number | null; move_type: string; rate_change: string | null; reason: string | null; business_date: string | null; at: string }>;
}

export interface Deposit {
  id: number;
  reservation_id: number;
  status: string;
  status_label: string;
  required: string;
  due_date: string | null;
  paid: string;
  refunded: string;
  applied: string;
  forfeited: string;
  available: string;
  remaining: string;
  refundable: string;
  non_refundable: string;
  currency: string;
  overdue: boolean;
  version: number;
}

export interface CheckOutStay extends Stay {
  folio_views: FolioView[];
  owed: string;
  early: boolean;
  blockers: string[];
  minibar_waiting: Array<{ id: number; product: string; quantity: string | number; amount: string; currency: string }>;
}

export interface CheckOutScreen {
  reservation_id: number;
  confirmation_no: string;
  business_date: string;
  stays: CheckOutStay[];
  deposit: Deposit | null;
  late_checkout: { offered: boolean; package_id?: number; name?: string; price?: string; check_out_time?: string };
  apply_deposit: boolean;
}

export interface ReservationSummary {
  id: number;
  property_id: number;
  confirmation_no: string;
  status: string;
  status_label: string;
  badge: [string, string] | null;
  booking_type: string;
  guest_id: number;
  guest_name: string | null;
  vip_level: string | null;
  arrival_date: string;
  departure_date: string;
  nights: number;
  adults: number;
  children: number;
  rooms: number;
  total_amount: string;
  currency: string;
  channel_ref: string | null;
  option_date: string | null;
  version: number;
}

export interface ReservationLine {
  id: number;
  line_no: number;
  status: string;
  status_label: string;
  room_type_id: number;
  room_type: string | null;
  rate_plan_id: number;
  rate_plan: string | null;
  room_id: number | null;
  room_number: string | null;
  upgrade_type: string | null;
  arrival_date: string;
  departure_date: string;
  adults: number;
  children: number;
  total_amount: string;
  version: number;
  nights: Array<{ date: string; amount: string; is_override: boolean; override_reason: string | null; room_id: number | null; posted: boolean }>;
}

export interface ReservationView extends ReservationSummary {
  guest: { id: number; name: string; vip_level: string; preferences: Preference[] } | null;
  source: { id: number; code: string; name: string } | null;
  company_client_id: number | null;
  promo_code: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  eta: string | null;
  guarantee_type: string;
  guarantee_ref: string | null;
  deposit_required: string;
  cancel_reason: string | null;
  cancel_fee: string;
  cancelled_at: string | null;
  business_date: string | null;
  created_at: string;
  rooms_detail: ReservationLine[];
  addons: Array<{ id: number; package: string | null; quantity: string; total_amount: string; status: string }>;
  status_history: Array<{ from: string | null; to: string; reason: string | null; business_date: string | null; by: string | null; at: string }>;
  options: Array<{ to: string; label: string; on: string; perm: string | null; needs: string[] }>;
  cancellation: { fee: string; why: string } | null;
}

export interface Candidate {
  room_id: number;
  number: string;
  room_type_id: number;
  room_type: string | null;
  floor: string | null;
  hk_status: string;
  occupancy: string;
  ready: boolean;
  score: number;
  fits: boolean;
  warnings: string[];
  /** Another room type than the one booked (an upgrade or a downgrade). */
  upgrade: boolean;
}

export interface GuestHit {
  guest_id: number | null;
  client_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  vip_level: string;
  nationality?: string | null;
  is_guest?: boolean;
  matched_on?: string[];
}

export interface GuestProfile {
  id: number;
  org_id: number;
  client_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  nationality: string | null;
  country: string | null;
  language: string | null;
  vip_level: string;
  vip_note: string | null;
  guest_type: string | null;
  special_requirements: string | null;
  notes: string | null;
  preferences: Preference[];
  has_identity: boolean;
  identity_verified: boolean;
  stays: number;
  last_stay: string | null;
  version: number;
}

export interface GuestDocument {
  id: number;
  kind: string;
  kind_label: string;
  is_identity: boolean;
  file_name: string;
  mime: string;
  bytes: number;
  retain_until: string | null;
  redacted: boolean;
  note: string | null;
}

export interface RateOffer {
  rate_plan_id: number;
  code: string;
  name: string;
  meal_plan: string | null;
  refundable: boolean;
  available: boolean;
  reasons: string[];
  total: string;
  per_room: string;
  average_nightly: string;
  nights: Array<{ date: string; amount: string }>;
}

export interface TypeOffer {
  room_type_id: number;
  code: string;
  name: string;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  is_dormitory: boolean;
  available: number;
  enough: boolean;
  fits: boolean;
  why_not: string | null;
  rates: RateOffer[];
}

export interface Availability {
  property_id: number;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  rooms: number;
  currency: string;
  business_date: string;
  results: TypeOffer[];
}

export interface Service {
  id: number;
  code: string;
  name: string;
  department: string;
  charge_type: string;
  default_price: string;
  currency: string;
  active: boolean;
}

export interface Shift {
  id: number;
  property_id: number;
  user_id: number;
  cashier: string | null;
  terminal: string;
  status: 'open' | 'closed' | 'reconciled';
  status_label: string;
  business_date: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: string;
  counted_cash: string | null;
  expected_cash: string | null;
  variance: string | null;
  variance_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  currency: string;
  totals: { cash_in: string; cash_out: string; postings: number; count: number; methods: Array<{ method: string; label: string; in: string; out: string; count: number }> } | null;
}

export interface Blocker {
  id: number;
  kind: string;
  kind_label: string;
  ref_type: string | null;
  ref_id: number | null;
  text: string;
  status: 'open' | 'resolved' | 'overridden';
  reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

export interface AuditReport {
  business_date: string;
  currency: string;
  generated_at: string;
  revenue: Record<string, string>;
  revenue_by_department?: Record<string, string>;
  taxes: Record<string, string>;
  tax_total: string;
  payments: Record<string, string | Record<string, string>>;
  rooms: { total: number; out_of_inventory: number; available: number; sold: number; complimentary: number; occupancy_pct: string | number; adr: string; revpar: string };
  movements: Record<string, number>;
  open_folios_owe?: string | Record<string, string>;
  cashier_shifts?: unknown;
  overrides?: Array<{ kind: string; text: string; reason: string; by: string | null; at: string }>;
}

export interface Audit {
  id: number;
  property_id: number;
  business_date: string;
  status: 'pending' | 'running' | 'failed' | 'completed';
  status_label: string;
  current_step: string | null;
  attempts: number;
  started_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  failure: string | null;
  steps: Array<{ key: string; label: string; done: boolean; failed: boolean; result: unknown }>;
  report: AuditReport | null;
}

export interface AuditScreen {
  business_date: BusinessDay;
  audit: Audit | null;
  blockers: Blocker[];
  checks: Array<{ kind: string; label: string; open: number; overridden: number }>;
  can_start: boolean;
  history: Array<{ id: number; business_date: string; status: string; completed_at: string | null; attempts: number }>;
}

export interface Widget {
  name: string;
  key: string | null;
  label: string;
  value: number | string | null;
  unit?: string | null;
  data: Record<string, unknown> | null;
  link: { route: string; params: Record<string, string | number> } | null;
}

export interface HkTask {
  id: number;
  room_id: number;
  room_number: string;
  room_type: string | null;
  floor: string | null;
  task_type: string;
  task_type_label: string;
  priority: string;
  priority_label: string;
  status: string;
  status_label: string;
  assigned_name: string | null;
  checklist_open: number;
  minutes: number | null;
  flags?: { vip: boolean; due_in: boolean; due_out: boolean; occupied: boolean };
}

export interface RoomDetail {
  room: RackRoom & { bed_type?: string | null; max_occupancy?: number | null; amenities?: string[] | null; accessible?: boolean; smoking?: boolean; sellable_note?: string | null };
  housekeeping_options: Array<{ to: string; on: string; label: string; needs: string[]; perm: string | null }>;
  outages: Array<{ id: number; kind: string; kind_label?: string; start_date: string; end_date: string | null; reason: string | null; status: string }>;
  future_nights?: number;
}

export interface GuestRequest {
  id: number;
  property_id: number;
  request_type: string;
  type_label: string;
  department_label: string;
  description: string | null;
  status: string;
  status_label: string;
  priority: string;
  room_number: string | null;
  confirmation_no: string | null;
  guest: ServiceCard | null;
  assigned_name: string | null;
  due_at: string | null;
  overdue: boolean;
  created_at: string;
}

export interface HkTaskFull extends HkTask {
  property_id: number;
  business_date: string;
  assigned_to: number | null;
  credits: number;
  checklist: Array<{ key: string; label: string; required?: boolean; done: boolean }>;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  inspected_by: string | null;
  inspected_at: string | null;
  inspection_result: string | null;
  version: number;
  options?: ActionOption[];
  primary?: string | null;
  room?: { hk_status: string; hk_status_label: string; badge: Badge; version: number };
  /** The task's photos (`Photos::listed`), each served by `GET housekeeping-tasks/{id}/photos/{fileId}`. */
  photos?: Array<{ id: number; url: string }>;
}

/** The server keeps up to 12 photos a record, 10 MB each (`Pms\Libraries\Photos`). */
export const MAX_PHOTO = 10 * 1024 * 1024;
export const MAX_PHOTOS = 12;

export interface HkStaff {
  user_id: number;
  name: string;
  department: string | null;
  tasks: number;
  done: number;
  credits: number;
  credits_done: number;
}

export interface Restock {
  id: number;
  product: string | null;
  code?: string | null;
  quantity: number | string;
  kind: string;
  kind_label: string;
  chargeable: boolean;
  amount?: string | null;
  currency?: string | null;
}

export interface Issue {
  id: number;
  property_id: number;
  room_id: number | null;
  room_number: string | null;
  title: string;
  description: string | null;
  category: string;
  category_label: string;
  priority: string;
  status: string;
  status_label: string;
  reported_by: string | null;
  reported_via: string;
  assigned_to: number | null;
  assigned_name: string | null;
  outage: { id: number; kind: string; kind_label: string; start_date: string; end_date: string; status: string } | null;
  parts_used: Array<{ product_id: number | null; name: string; quantity: number | string; note: string | null; by: string | null; at: string }>;
  photos: Array<{ id: number; url: string }>;
  resolution: string | null;
  business_date: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  version: number;
  options?: ActionOption[];
}

export interface IssueList {
  items: Issue[];
  categories: Record<string, string>;
  statuses: string[] | Record<string, string>;
  priorities: Record<string, string>;
}

export interface LostItem {
  id: number;
  property_id: number;
  item: string;
  description: string | null;
  location: string | null;
  room_id: number | null;
  room_number: string | null;
  found_by: string | null;
  found_at: string | null;
  photo: { id: number; url: string } | null;
  storage_place: string | null;
  guest: (ServiceCard & { id: number }) | null;
  status: string;
  status_label: string;
  claimant: string | null;
  returned_to: string | null;
  returned_at: string | null;
  disposed_at: string | null;
  disposal_reason: string | null;
  keep_until: string | null;
  due_for_disposal: boolean;
  version: number;
  options?: ActionOption[];
}

export interface OutboxRow {
  id: number;
  topic: string;
  ref_type: string | null;
  ref_id: number | null;
  status: string;
  status_label: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  done_at: string | null;
  created_at: string;
}

export interface Kpi {
  date?: string;
  rooms_available: number;
  out_of_order: number;
  house_use: number;
  rooms_sold: number;
  complimentary: number;
  room_revenue: string;
  arrivals_expected: number;
  arrivals: number;
  departures: number;
  stayovers: number;
  no_shows: number;
  cancellations: number;
  created: number;
  occupancy_pct: string | number;
  adr: string;
  revpar: string;
  no_show_rate: string | number;
  cancellation_rate: string | number;
}

export interface ReportCatalogue {
  reports: Array<{ key: string; title: string; group: string; group_label: string; filters: string[] }>;
  groups: Labelled[] | Record<string, string>;
  export: boolean;
  formats: string[];
}

export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'int' | 'money' | 'pct' | 'date' | 'datetime';
}

export interface ReportResult {
  key: string;
  title: string;
  property: string;
  period: { from: string; to: string };
  currency: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  totals: Record<string, unknown> | null;
  generated_at: string;
}

export interface CalendarBar {
  reservation_id: number;
  reservation_room_id: number;
  confirmation_no: string;
  guest_name: string;
  vip_level: string;
  status: string;
  status_label: string;
  colour: string;
  room_id: number | null;
  room_type_id: number;
  start: string;
  end: string;
  nights: number;
  arrival_date: string;
  departure_date: string;
  in_house: boolean;
  adults: number;
  children: number;
  version: number;
  continues_before: boolean;
  continues_after: boolean;
}

export interface CalendarData {
  property_id: number;
  from: string;
  days: number;
  dates: string[];
  business_date: string;
  rooms: Array<{ id: number; number: string; room_type_id: number; room_type: string | null; floor: string | null; building: string | null; badge: Badge }>;
  bars: CalendarBar[];
  unassigned: CalendarBar[];
  outages: Array<{ id: number; room_id: number; kind: string; start: string; end: string; reason: string }>;
  room_types: Array<{ id: number; code: string; name: string }>;
  legend: Array<{ status: string; label: string; colour: string }>;
}

/** The server's `{key: label}` or `[{value, label}]`, as a list. */
export function labelled(x: Labelled[] | Record<string, string> | string[] | null | undefined): Labelled[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map((v) => (typeof v === 'string' ? { value: v, label: nice(v) } : v));
  return Object.entries(x).map(([value, label]) => ({ value, label }));
}
