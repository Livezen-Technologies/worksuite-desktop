import { ApiError, apiGetMeta, request } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import type { When } from '@shared/event-desk';

/**
 * WorkSuite Events (the server's `/api/events/v1`, `app/Modules/EventManager`,
 * stages A, B1 and B2): the Event Desk of WorkSuite Desktop and the
 * organiser's read of an event (Events SRS §15.2 [D], §9, §8.4).
 *
 * THE SERVER DECIDES. Counts, capacity, seats left, money and availability
 * are the server's, written as they come; a refusal is shown in the server's
 * own sentence and its `errors.code` says what to offer next. The one thing
 * the desk works out itself is a scan while WorkSuite is out of reach — and
 * then with the server's own rules, in the main process (event-desk.ts).
 *
 * Writes that can be pressed twice carry an `Idempotency-Key` made once per
 * attempt (a walk-in, taking a payment).
 */

export const BASE = '/api/events/v1';

export { type When };

type Query = Record<string, string | number | boolean | null | undefined>;

export async function eGetMeta<T>(path: string, query?: Query, signal?: AbortSignal): Promise<{ data: T; offline: boolean; cachedAt: string | null }> {
  const r = await apiGetMeta<T>(`${BASE}${path}`, query, signal);
  return { data: r.data, offline: r.offline, cachedAt: r.cachedAt };
}

export async function eGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  return (await eGetMeta<T>(path, query, signal)).data;
}

/** A write; the server's own sentence comes back beside what it did. */
export async function ePost<T = unknown>(path: string, body: unknown = {}, key?: string): Promise<{ data: T; message: string }> {
  const r = await request<T>('POST', `${BASE}${path}`, { body, headers: key ? { 'Idempotency-Key': key } : undefined });
  return { data: r.data, message: r.message ?? 'Done.' };
}

/** Whether WorkSuite can be reached from this computer. */
export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export function newKey(prefix = 'desk'): string {
  return `${prefix}-${crypto.randomUUID()}`.slice(0, 100);
}

export function errorText(e: unknown, fallback = 'That could not be done. Try again.'): string {
  return e instanceof Error && e.message.trim() ? e.message : fallback;
}

/** What the server sent beside a refusal (`errors`). */
export function errorData<T>(e: unknown): T | null {
  return e instanceof ApiError && e.data && typeof e.data === 'object' ? (e.data as T) : null;
}

/** A refusal's `errors.code` (`already_queued`, `confirm`, `forbidden`, `walkins_off`…). */
export function codeOf(e: unknown): string | null {
  const c = errorData<{ code?: unknown }>(e)?.code;
  return typeof c === 'string' ? c : null;
}

export function statusOf(e: unknown): number | null {
  return e instanceof ApiError ? e.status : null;
}

/** A form's refusal (`invalid_answers`): field key → the server's sentence. */
export function fieldErrors(e: unknown): Record<string, string> {
  const d = errorData<{ errors?: unknown; field?: unknown }>(e);
  const out: Record<string, string> = {};
  if (d?.errors && typeof d.errors === 'object') for (const [k, v] of Object.entries(d.errors as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  if (typeof d?.field === 'string' && e instanceof Error) out[d.field] ??= e.message;
  return out;
}

// ── writing what the server sent ─────────────────────────────────────────

/** An instant as the server sent it, in the event's zone ("20 Oct, 09:00"); the zone only when asked. */
export function at(w: When | string | null | undefined, opts: { day?: boolean; zone?: boolean } = {}): string {
  if (!w) return '—';
  if (typeof w === 'string') {
    const t = new Date(w.includes('T') ? w : `${w.replace(' ', 'T')}Z`);
    return Number.isNaN(t.getTime()) ? w : t.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  const d = new Date(`${w.date}T12:00:00Z`);
  const day = Number.isNaN(d.getTime()) ? w.date : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const text = opts.day === false ? w.time : `${day}, ${w.time}`;
  return opts.zone ? `${text} (${w.zone})` : text;
}

/** "25000.00" in LKR → "LKR 25,000.00": the server's figure, grouped as written, never recomputed. */
export function money(amount: string | number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const s = String(amount).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return currency ? `${currency} ${s}` : s;
  const whole = m[2]!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency ? `${currency} ` : ''}${m[1]}${whole}.${(m[3] ?? '').padEnd(2, '0')}`;
}

export function nice(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ── what the server answers ──────────────────────────────────────────────

export interface EventItem {
  id: number;
  org_id: number;
  code: string;
  name: string;
  summary: string | null;
  type_label: string | null;
  delivery_mode: string;
  status: string;
  status_label: string;
  registration_state_label: string | null;
  display_label: string | null;
  timezone: string;
  start: When | null;
  end: When | null;
  capacity: number | null;
  version: number;
  counts?: { registered: number; confirmed: number };
}

export interface Options {
  permissions: string[];
  scope?: unknown;
  tabs?: string[];
}

export interface Gate {
  id: number;
  event_id: number;
  name: string;
  code: string | null;
  venue: { id: number; name: string } | null;
  direction: string;
  direction_label: string;
  allowed_ticket_types: Array<{ id: number; name: string }>;
  auto_checkin: boolean | null;
  auto_checkin_effective: boolean;
  auto_print: boolean;
  active: boolean;
  today: { checked_in: number; checked_out: number; denied: number };
}

export interface Device {
  id: number;
  event_id: number;
  name: string;
  gate: { id: number; name: string } | null;
  platform: string | null;
  app_version: string | null;
  device_ref: { type: string; id: string | null; label: string | null; trusted: boolean };
  status: string;
  status_label: string;
  online: boolean;
  last_seen: When | null;
  last_sync: When | null;
  last_scan: When | null;
  queue_size: number;
  cache_expires: When | null;
  wipe_requested: boolean;
  revoked: { at: When | null; reason: string | null; by: string | null } | null;
}

export interface Summary {
  inside: number;
  checked_in: number;
  expected: number;
  today: { checked_in: number; checked_out: number; denied: number; walk_ins: number; day: string };
  by_gate: Record<string, { checked_in: number; checked_out: number; denied: number }>;
  devices: { total: number; online: number; queued: number };
  reconciliation_open: number;
}

export interface Recent {
  id: number;
  action: string;
  result: string;
  label: string;
  colour: string;
  registration_id: number | null;
  number: string | null;
  name: string | null;
  gate: { id: number; name: string } | null;
  device_id: number | null;
  at: When | null;
  by: string | null;
  source: string;
  flag: string | null;
  counts_attendance: boolean;
  note: string | null;
  provisional_number: string | null;
}

export interface SearchHit {
  registration_id: number;
  number: string;
  name: string;
  company: string | null;
  ticket: { id: number; name: string };
  status: string;
  status_label: string;
  payment_status?: string | null;
  payment_due?: boolean;
  presence: { state: string; last_in: When | string | null };
  photo_file_id?: number | null;
}

export interface ReconItem {
  id: number;
  kind: string;
  kind_label: string;
  registration: { id: number; number: string; status: string; status_label: string } | null;
  server_status: string | null;
  detail: string;
  status: string;
  status_label: string;
  records: Recent[];
  resolved_at: When | null;
  resolution_note: string | null;
  resolved_by: string | null;
  created_at: When | null;
  options: Array<{ on?: string; to?: string; perm?: string; needs?: string[] } | string>;
  version: number;
}

export interface TicketType {
  id: number;
  code: string | null;
  name: string;
  kind: string;
  role: string;
  price: string;
  currency: string;
  free: boolean;
  left: number | null;
  availability: string;
  availability_label: string;
  active: boolean;
}

export interface FormField {
  key: string;
  type: string;
  label: string;
  help?: string | null;
  required?: boolean;
  options?: Array<string | { value: string; label: string }>;
  ticket_type_ids?: number[];
  condition?: { field: string; op: string; value?: unknown } | null;
  consent?: { type: string; text: string; version?: string | number } | null;
  default?: unknown;
}

export interface PaymentView {
  payment_status: string | null;
  payment_status_label: string | null;
  currency: string;
  price: string;
  discount: string | null;
  amount: string | null;
  due: string | null;
  invoice: { id: number; number: string; status: string; total: string; paid: string; outstanding: string } | null;
  pay_by: When | null;
  instructions: string | null;
  options: string[];
}

export interface Session {
  id: number;
  title: string;
  status: string;
  status_label: string;
  day: number | null;
  start: When | null;
  end: When | null;
  room: { id: number; name: string } | null;
  capacity: number | null;
  registration_required: boolean;
  attended?: number;
  track?: { id: number; name: string; color: string | null } | null;
  speakers?: Array<{ speaker_id: number; name: string; role_label?: string }>;
  seats?: { capacity: number | null; taken: number; left: number | null; availability_label?: string } | null;
  delivery_mode?: string;
}

export interface Registration {
  id: number;
  event_id: number;
  number: string;
  attendee: { id: number; name: string; email: string | null; phone: string | null; company: string | null } | null;
  ticket: { id: number; name: string } | null;
  group_id: number | null;
  source: string;
  status: string;
  status_label: string;
  payment_status: string | null;
  price: string | null;
  currency: string | null;
  registered_at: When | null;
  confirmed_at: When | null;
  version: number;
}

export interface Attendee {
  id: number;
  org_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  country: string | null;
  type: string;
  anonymized: boolean;
}

export interface Paged<T> {
  items: T[];
  meta?: { total: number; page: number; per_page: number; pages: number };
}

/** Everybody's query keys, so a scan can refresh what it changed. */
export const K = {
  events: ['events', 'list'] as const,
  options: (org: number) => ['events', 'options', org] as const,
  event: (id: number) => ['events', 'event', id] as const,
  live: (id: number) => ['events', 'live', id] as const,
  gates: (id: number) => ['events', 'gates', id] as const,
  devices: (id: number) => ['events', 'devices', id] as const,
};
