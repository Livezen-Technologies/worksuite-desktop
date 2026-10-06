import { ApiError, apiGet, apiUrl, request } from '../../core/api';
import { call } from '../../core/bridge';
import type { SalonDeskInfo, SalonDeskPairInput, SalonDeskPairing } from '@shared/types';

/**
 * SalonMate's front desk (the server's `/api/salon/v1`): the counter PC of a
 * salon, paired to one location. Part 1 is the desk online — pairing, the
 * day, check-in with the allergy read out, walk-ins and bookings, the clients
 * and the calendar. Taking money, receipts and working offline follow.
 *
 * THE DESK IS PROVED BY A KEY THE RENDERER NEVER HOLDS. Pairing goes through
 * the main process (`salon:deskPair`), which keeps the key the server hands
 * over in the OS credential store and adds it to SalonMate's requests on the
 * way out. Here the desk is only its id.
 *
 * EVERY WRITE CARRIES AN IDEMPOTENCY KEY, made once per attempt: a second
 * press after a dropped connection is the same walk-in, never another. Once
 * the server has answered — anything under 500 — it keeps that answer against
 * the key, so the next try is a new attempt with a new key (`answered`).
 *
 * TIMES ARE THE LOCATION'S. The server sends UTC stamps and, beside them, the
 * clock labels on the salon's own clock ("14:30"); the board says which day
 * it is there. Nothing here works a day out from this computer's clock.
 */

const BASE = '/api/salon/v1';

// ── shapes (as the server sends them) ───────────────────────────────────

export type VisitStatus = 'pending' | 'confirmed' | 'checked_in' | 'in_service' | 'completed' | 'cancelled' | 'no_show';
export type Severity = 'mild' | 'moderate' | 'severe';
export type Reliability = 'reliable' | 'watch' | 'unreliable';

export interface SalonLocation {
  id: number;
  org_id: number;
  name: string;
  timezone: string;
}

export interface Service {
  id: number;
  name: string;
  duration_min: number;
  price: number;
  currency: string;
  active: boolean;
  stylists: { provider_id: number; duration_min: number | null }[];
}

export interface Category {
  id: number | null;
  name: string;
  services: Service[];
}

export interface Stylist {
  id: number;
  name: string;
  title: string | null;
  /** The stylist's price tier (Senior ×1.25), where the server sends it. */
  tier?: { name: string | null; multiplier: number | null } | null;
  color: string | null;
  active: boolean;
  services: number[];
  locations: number[];
}

/** GET /options — what every screen starts from. */
export interface Options {
  locations: SalonLocation[];
  menu: Category[];
  stylists: Stylist[];
  currency?: string;
  company?: string;
  loyalty?: boolean;
  ack_severity?: Severity;
  may: Record<string, boolean>;
}

export interface VisitItem {
  appointment_id: number;
  service_id: number;
  service: string;
  provider_id: number;
  provider: string;
  provider_color: string | null;
  status: VisitStatus;
  status_label: string;
  starts_at: string;
  ends_at: string;
  start: string;
  end: string;
  duration_min: number;
  price: number;
}

export interface VisitClient {
  id: number;
  name: string;
  phone: string | null;
  tier: string | null;
  reliability: Reliability;
  allergy: { severity: Severity; substance: string } | null;
}

export interface Visit {
  id: number;
  number: string;
  client: VisitClient;
  status: VisitStatus;
  status_label: string;
  starts_at: string;
  date: string;
  start: string;
  end: string;
  items: VisitItem[];
  money: { currency: string; total: number; deposit_due: number; advance: number; deposit_owed: number; balance: number };
  /** Billing's invoice, once the visit is checked out: what it still owes is Billing's figure. */
  invoice?: { id: number; number: string | null; status: string; total: number; paid: number; owed: number } | null;
  checked_out: boolean;
}

export interface Allergy {
  id: number;
  substance: string;
  reaction: string | null;
  severity: Severity;
  withdrawn_at: string | null;
}

export interface PatchTest {
  id: number;
  product?: string | null;
  result: 'pending' | 'negative' | 'positive';
  tested_at: string | null;
  valid_until: string | null;
}

/** The check-in gate, as a 409 carries it. */
export interface Gate {
  ok: boolean;
  code: 'ack_required' | 'patch_test_required' | 'patch_test_override' | null;
  message: string;
  allergies: Allergy[];
  missing_patch: string[];
}

/** What was used and how, kept against one appointment (REC-01). */
export interface ServiceRecord {
  id: number;
  formula: string | null;
  technique: string | null;
  timing: string | null;
}

/** The last formula a client had for a service, offered when it is done again (REC-05). */
export interface LastFormula {
  formula: string | null;
  technique: string | null;
  timing: string | null;
  at: string | null;
}

/** GET /visits/{id}: what the check-in panel and the service record read. */
export interface VisitDetail {
  visit: Visit;
  allergies: Allergy[];
  patch_tests: PatchTest[];
  missing_patch: string[];
  ack_statement: string;
  preferences?: Record<string, string>;
  records?: Array<{ appointment_id: number; record: ServiceRecord | null; last: LastFormula | null }>;
  advances?: Array<{ id: number; amount: number; method?: string; date?: string | null }> | null;
}

export interface FloorStylist {
  provider_id: number;
  name: string;
  color: string | null;
  /** In the chair now, and how far through (0–100) by the clock. */
  current: { client: string; service: string; until: string; progress?: number; visit_id?: number; appointment_id?: number; status?: string } | null;
  next: { label: string; client: string } | null;
}

/** GET /today */
export interface TodayBoard {
  date: string;
  timezone: string;
  now_label: string;
  location: { id: number; name: string; opens: string | null; closes: string | null };
  currency: string;
  figures: {
    bookings: number;
    done: number;
    to_come: number;
    taken: { total: number } | null;
    /** What invoices at this location still owe (CAL-01); null without Billing's permission. */
    owed?: { amount: number; invoices: number } | null;
    /** Booked minutes over bookable ones today, and no-shows over the last 30 days, as percentages. */
    utilisation?: number | null;
    no_show_rate?: number | null;
  };
  arriving: Visit[];
  late: Visit[];
  floor: FloorStylist[];
  /** What needs somebody now (CAL-06): online bookings to confirm, time off, reviews, deposits owed, the desks' queues. */
  attention?: Array<{ kind: string; count: number; label: string; action: string; view: string }>;
  visits: Visit[];
}

/** Approved HR leave on the day: a whole day, a half (the server splits the stylist's own hours), or a short absence. */
export interface StylistLeave {
  portion: 'full' | 'half_morning' | 'half_afternoon' | 'short' | string;
  starts_at: string | null;
  minutes: number | null;
}

/** GET /calendar */
export interface CalendarDay {
  date: string;
  hours: { weekday: number | string; opens: string; closes: string }[];
  stylists: (Stylist & { working: [string, string][]; leave?: StylistLeave[]; blocks?: Array<{ starts_at: string; ends_at: string; reason: string | null }> })[];
  visits: Visit[];
}

export interface ChainStep {
  service_id: number;
  provider_id: number;
  starts_at: string;
  label: string;
}

export interface StartOption {
  starts_at: string;
  label: string;
  free: boolean;
  chain: ChainStep[];
}

/** GET /availability */
export interface AvailabilityDay {
  date: string;
  timezone: string;
  starts: StartOption[];
}

/** GET /quote-visit */
export interface VisitQuote {
  lines: { service_id: number; price: number; duration_min: number }[];
  total: number;
  currency: string;
  deposit: { due: number; reason: string | null };
}

export interface ClientRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  tier: string | null;
  points: number;
  reliability: Reliability;
  visits: number;
  store_credit: number;
  allergy: { severity: Severity; substance: string } | null;
}

export interface ClientCandidate {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

/** A photo kept with a service record: staff-only unless the client consented to its use. */
export interface RecordMedia {
  id: number;
  kind: 'before' | 'after' | 'other';
  mime: string;
  public: boolean;
  url: string;
}

/** A service record as the client's card lists it, with its photos. */
export interface ClientRecord {
  id: number;
  appointment_id: number;
  service: string;
  service_id: number | null;
  provider: string | null;
  formula: string | null;
  technique: string | null;
  timing: string | null;
  date: string | null;
  by: string | null;
  media: RecordMedia[];
}

/** GET /clients/{id}: the parts the desk shows. */
export interface ClientCard {
  client: { id: number; name: string; email: string | null; phone: string | null; mobile: string | null };
  profile: { tier: string | null; points: number; reliability: Reliability; visits: number; preferred: string | null };
  allergies: Allergy[];
  patch_tests: PatchTest[];
  visits: Visit[];
  next_visit: Visit | null;
  loyalty: { points: number } | null;
  credit: { balance: number; currency: string } | null;
  invoices: { id: number; number: string | null; owed: number; currency: string }[] | null;
  /** What the client asked for: a quiet room, tea with no sugar. */
  preferences?: Record<string, string>;
  records?: ClientRecord[];
  may: { edit: boolean };
}

/** GET /desks */
export interface DeskList {
  items: SalonDeskInfo[];
  may: { manage: boolean };
  registers: { id: number; org_id: number; code: string; name: string; terminal_id: number | null }[];
  /** The stock locations a desk may take stock from (DSK-02); older servers send none. */
  warehouses?: StockLocation[];
  /** The receipt layouts a desk prints with (POS-08); older servers send none. */
  templates?: ReceiptTemplate[];
}

export interface StockLocation {
  id: number;
  org_id: number | null;
  code: string | null;
  name: string;
  kind: string | null;
}

export interface ReceiptTemplate {
  id: string;
  name: string;
  about: string;
}

// ── query keys ──────────────────────────────────────────────────────────

export const K = {
  all: ['salon'] as const,
  pairing: ['salon', 'pairing'] as const,
  desks: ['salon', 'desks'] as const,
  options: (org: number | null) => ['salon', 'options', org] as const,
  today: (loc: number) => ['salon', 'today', loc] as const,
  calendar: (loc: number, date: string) => ['salon', 'calendar', loc, date] as const,
  range: (loc: number, from: string, to: string, f: string) => ['salon', 'range', loc, from, to, f] as const,
  visit: (id: number) => ['salon', 'visit', id] as const,
  clients: (org: number, q: string) => ['salon', 'clients', org, q] as const,
  client: (id: number) => ['salon', 'client', id] as const,
  availability: (loc: number, date: string, items: string) => ['salon', 'availability', loc, date, items] as const,
  quote: (loc: number, client: number, items: string) => ['salon', 'quote', loc, client, items] as const,
};

// ── the desk ────────────────────────────────────────────────────────────

export const pairing = (): Promise<SalonDeskPairing | null> => call('salon:deskPairing');
export const pairDesk = (input: SalonDeskPairInput) => call('salon:deskPair', input);
export const forgetDesk = (): Promise<void> => call('salon:deskForget');

export const fetchDesks = (signal?: AbortSignal) => apiGet<DeskList>(`${BASE}/desks`, undefined, signal);
export const fetchOptions = (org: number | null, signal?: AbortSignal) => apiGet<Options>(`${BASE}/options`, org ? { org } : undefined, signal);

/** Where a paired desk stands: on the server's list, or gone from it. */
export function deskState(list: DeskList | undefined, deskId: number): SalonDeskInfo['status'] | 'gone' | null {
  if (!list) return null;
  return list.items.find((d) => d.id === deskId)?.status ?? 'gone';
}

// ── reads ───────────────────────────────────────────────────────────────

export const fetchToday = (loc: number, signal?: AbortSignal) => apiGet<TodayBoard>(`${BASE}/today`, { location: loc }, signal);
export const fetchCalendar = (loc: number, date: string, signal?: AbortSignal) => apiGet<CalendarDay>(`${BASE}/calendar`, { location: loc, date }, signal);
export const fetchVisit = (id: number, signal?: AbortSignal) => apiGet<VisitDetail>(`${BASE}/visits/${id}`, undefined, signal);
export const fetchClients = (org: number, q: string, limit = 20, signal?: AbortSignal) => apiGet<{ items: ClientRow[] }>(`${BASE}/clients`, { org, q, limit }, signal);
export const fetchClient = (id: number, signal?: AbortSignal) => apiGet<ClientCard>(`${BASE}/clients/${id}`, undefined, signal);
export const fetchAvailability = (loc: number, date: string, items: string, signal?: AbortSignal) => apiGet<AvailabilityDay>(`${BASE}/availability`, { location: loc, date, items }, signal);
export const fetchQuote = (loc: number, client: number | null, items: string, signal?: AbortSignal) =>
  apiGet<VisitQuote>(`${BASE}/quote-visit`, { location: loc, client: client ?? undefined, items }, signal);

/** What the week and list views narrow the book to; the server filters by the same rules. */
export interface VisitFilter {
  stylist?: number | null;
  /** Comma-separated statuses. */
  status?: string;
  allergy?: boolean;
  q?: string;
}

/**
 * Every visit at a location from one salon day to another, both included —
 * page by page, as the server answers 200 at a time (CAL-02's week and list).
 */
export async function fetchVisitRange(loc: number, from: string, to: string, f: VisitFilter = {}, signal?: AbortSignal): Promise<Visit[]> {
  const out: Visit[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const r: { items: Visit[]; next: string | null } = await apiGet(
      `${BASE}/visits`,
      { location: loc, from, to, limit: 200, cursor: cursor ?? undefined, stylist: f.stylist ?? undefined, status: f.status || undefined, allergy: f.allergy ? 1 : undefined, q: f.q?.trim() || undefined },
      signal,
    );
    out.push(...r.items);
    cursor = r.next;
    if (!cursor) break;
  }
  return out;
}

/** The Monday of the week a day falls in. */
export function weekOf(ymd: string): string {
  return addDays(ymd, 1 - (new Date(`${ymd}T12:00:00Z`).getUTCDay() || 7));
}

// ── writes ──────────────────────────────────────────────────────────────

/** A key for one attempt at a write. */
export function attemptKey(): string {
  return `desktop-${crypto.randomUUID()}`;
}

/**
 * Whether the server answered this attempt — and so keeps that answer against
 * its key. The next try is then a new attempt, with a new key; only a
 * connection that failed, or a 5xx, is tried again under the same one.
 */
export function answered(e: unknown): boolean {
  return e instanceof ApiError && e.status > 0 && e.status < 500;
}

/** The structured part of a refusal: `code`, `gate`, `next`, `candidates`. */
export function refusal<T extends object = { code?: string; gate?: Gate; next?: { starts_at: string; label: string } | null; candidates?: ClientCandidate[] }>(e: unknown): Partial<T> {
  return e instanceof ApiError && e.data && typeof e.data === 'object' ? (e.data as Partial<T>) : {};
}

/** A write the server keeps under the attempt's key: a retry after a dropped line is the same attempt. */
export async function write<T>(path: string, body: unknown, key: string): Promise<{ data: T; message: string | null }> {
  const r = await request<T>('POST', `${BASE}${path}`, { body, headers: { 'Idempotency-Key': key } });
  return { data: r.data, message: r.message ?? null };
}

export interface CheckInExtra {
  ack?: boolean;
  statement?: string;
  patch_override?: string;
}

export const checkIn = (visitId: number, extra: CheckInExtra, key: string) => write<{ visit: Visit }>(`/visits/${visitId}/status`, { action: 'check_in', ...extra }, key);

export interface WalkInBody {
  location_id: number;
  client_id: number;
  items: { service_id: number; provider_id: number }[];
  desk_id: number;
}

export const startWalkIn = (body: WalkInBody, extra: CheckInExtra, key: string) =>
  write<{ visit: Visit; gate?: Gate | null }>('/walk-in', { ...body, start_now: true, ...extra }, key);

/** A later slot: a booking made at the desk, or a walk-in who comes back later. */
export const bookAt = (body: WalkInBody, startsAt: string, asBooking: boolean, key: string) =>
  asBooking
    ? write<{ visit: Visit }>('/visits', { ...body, starts_at: startsAt, source: 'desk' }, key)
    : write<{ visit: Visit }>('/walk-in', { ...body, starts_at: startsAt, start_now: false }, key);

export const addClient = (org: number, input: { name: string; mobile?: string; email?: string; confirm_new?: boolean }, key: string) =>
  write<{ client: ClientRow }>('/clients', { org, ...input }, key);

export const addAllergy = (clientId: number, input: { substance: string; reaction?: string; severity: Severity }, key: string) =>
  write<unknown>(`/clients/${clientId}/allergies`, input, key);

// ── service records and their photos (D17, REC-01…05) ───────────────────

/** Keep what was done for one appointment. One record each: saving again changes it. */
export const saveRecord = (appointmentId: number, input: { formula: string; technique: string; timing: string }, key: string) =>
  write<{ record: ServiceRecord | null }>(`/appointments/${appointmentId}/record`, input, key);

/** A before or after photo for a saved record, checked by WorkSuite for what it really is. */
export async function addPhoto(recordId: number, file: Blob, name: string, kind: 'before' | 'after' | 'other'): Promise<{ id: number; message: string | null }> {
  const form = new FormData();
  form.set('file', file, name);
  form.set('kind', kind);
  const r = await request<{ id: number }>('POST', `${BASE}/records/${recordId}/media`, { body: form });
  return { id: r.data.id, message: r.message ?? null };
}

/** Whether a photo may be used on the website, under the client's consent (REC-04). */
export async function publishPhoto(org: number, mediaId: number, on: boolean): Promise<string | null> {
  const r = await request<null>('POST', `${BASE}/media/${mediaId}/publish`, { body: { org, on } });
  return r.message ?? null;
}

/** A kept photo, as an image the desk may show: served by SalonMate to staff who may see the client. */
export const mediaUrl = (id: number) => apiUrl(`${BASE}/media/${id}`);

/** WhatsApp, for a mobile number WorkSuite holds in E.164. */
export function whatsAppUrl(e164: string | null | undefined): string | null {
  const digits = (e164 ?? '').replace(/\D+/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

// ── rules the screens share ─────────────────────────────────────────────

export const SEVERITIES: Severity[] = ['mild', 'moderate', 'severe'];

/** Whether an allergy of this severity must be read out before check-in. */
export function atLeast(severity: string, threshold: string): boolean {
  return SEVERITIES.indexOf(severity as Severity) >= Math.max(0, SEVERITIES.indexOf(threshold as Severity));
}

/** The allergy a client is flagged by in lists: the most severe one still on file. */
export function worstAllergy(allergies: Allergy[]): { severity: Severity; substance: string } | null {
  const live = allergies.filter((a) => !a.withdrawn_at).sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity));
  return live[0] ? { severity: live[0].severity, substance: live[0].substance } : null;
}

/** The words confirmed at check-in (`Safety::STATEMENT`), for when the visit's own could not be read. */
export const STATEMENT = 'I have told the stylist about these allergies and the client confirms nothing has changed.';

/** The stylists who do every chosen service (CTR-04). */
export function capable(stylists: Stylist[], services: number[], locationId: number): Stylist[] {
  return stylists.filter((s) => s.active !== false && (s.locations.length === 0 || s.locations.includes(locationId)) && services.every((id) => s.services.includes(id)));
}

/** The first free start from now on (five minutes' grace), or none. */
export function nextFree(day: AvailabilityDay | undefined, now: number): StartOption | null {
  return day?.starts.find((s) => s.free && Date.parse(s.starts_at) >= now - 5 * 60_000) ?? null;
}

/** "Free now": within ten minutes. */
export function freeNow(slot: StartOption | null, now: number): boolean {
  return !!slot && Date.parse(slot.starts_at) - now <= 10 * 60_000;
}

/** Checked in, in the chair or done, and not yet paid. */
export function readyToPay(board: TodayBoard): Visit[] {
  return board.visits.filter((v) => ((v.status === 'checked_in' || v.status === 'in_service' || v.status === 'completed') && !v.checked_out) || owing(v));
}

/** Checked out, and the invoice still owes: the rest is taken against it. */
export function owing(v: Visit): boolean {
  return v.checked_out && (v.invoice?.owed ?? 0) > 0;
}

/** What is left to pay: the invoice's figure once there is one, else the visit's balance after any advance. */
export function stillToPay(v: Visit): number {
  return v.checked_out ? (v.invoice?.owed ?? 0) : v.money.balance;
}

/** "HH:MM" on a zone's clock. */
export function clockAt(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return `${parts.find((p) => p.type === 'hour')?.value ?? '00'}:${parts.find((p) => p.type === 'minute')?.value ?? '00'}`;
}

/** Minutes past midnight of "HH:MM" (or the time at the end of "YYYY-MM-DD HH:MM[:SS]"). */
export function minutesOf(hm: string | null | undefined): number {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(hm ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function greeting(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** "LKR 3,500.00" — or without the currency where the column says it. */
export function amount(n: number | null | undefined, currency = ''): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${v}` : v;
}

/** "Mon 28 Sep" for a YYYY-MM-DD, read as that calendar day wherever this computer is. */
export function shortDay(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "21 Sep 2026" (or "21 Sep" with `year` false) for a YYYY-MM-DD, as the desk's cards write a date. */
export function dayMonth(ymd: string | null | undefined, year = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  if (!m) return '—';
  return `${String(Number(m[3])).padStart(2, '0')} ${MONTHS[Number(m[2]) - 1] ?? ''}${year ? ` ${m[1]}` : ''}`;
}

export function longDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The calendar day it is now at a location. */
export function todayAt(timezone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
