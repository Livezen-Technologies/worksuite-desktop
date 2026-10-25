import { apiGet, ApiError, request, type Query } from '../../core/api';
import { call } from '../../core/bridge';

/**
 * Appointments on the desktop (WS Appointments SRS v1.0 §9 D-01…D-24, the desktop boards D01–D24) over the server's
 * `/api/appointments` (server module Appointments, `app/Modules/Appointments/Config/Routes.php`).
 *
 * THE SERVER IS AUTHORITATIVE. Every slot, total, tax, deposit and commission figure here is what the server sent;
 * nothing is priced or checked for clashes on this computer. A drop on the calendar is only a request: the server
 * checks the new time as it checks a new booking, and a refusal puts the card back with the server's reason.
 *
 * Offline (D21): status moves (check in, start, complete, no-show, confirm) and client notes go through the desktop's
 * encrypted offline queue (`offline:submit`) and are replayed in order when WorkSuite answers again; the server
 * judges each one then, and a refusal stays in the outbox with its reason. Booking, moving, checkout, deposits and
 * set-up need a live answer and are off while offline.
 */

export const BASE = '/api/appointments';

export type Status = 'pending' | 'confirmed' | 'checked_in' | 'in_service' | 'completed' | 'cancelled' | 'no_show';
export const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in', in_service: 'In service', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show',
};

export interface Move { status: Status; label: string; allowed: boolean }
export interface Party { id: number; name: string; phone?: string | null; email?: string | null }

export interface Appointment {
  id: number;
  number: string;
  status: Status;
  status_label: string;
  org_id: number;
  location: { id: number; name: string };
  customer: Party;
  service: { id: number; name: string };
  provider: { id: number; name: string; color: string | null };
  starts_at: string;
  ends_at: string;
  timezone: string;
  local: { date: string | null; start: string | null; end: string | null };
  duration_min: number;
  notes: string | null;
  internal_notes: string | null;
  source: string;
  cancel_reason: string | null;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  next: Move[];
  checked_out: boolean;
  invoice: { id: number; number: string | null; status: string | null; currency: string | null; total: number; outstanding: number } | null;
  payment_status: string;
  deposit: { due: number; currency: string | null; held: number; outstanding: number } | null;
  can: { reschedule: boolean; checkout: boolean; collect: boolean; deposit: boolean; commission: boolean; [k: string]: boolean };
}

export interface HistoryEntry { id: number; type: string; from: string | null; to: string | null; description: string; source: string; by: string | null; at: string | null }
export interface Notice { id: number; kind?: string; label?: string; channel?: string; status: string; error?: string | null; at?: string | null; [k: string]: unknown }

export interface Detail {
  appointment: Appointment;
  history: HistoryEntry[];
  stock: { items?: Array<{ kind: string; description: string; quantity: number }>; consumptions?: Array<{ name: string; planned: number; actual: number; unit: string | null }>; shortages?: unknown[] } | null;
  deposit: { can_apply?: boolean; [k: string]: unknown } | null;
  commission: Array<{ id: number; description: string; amount: number; currency: string; status: string }> | null;
  notices: Notice[];
}

export interface Location { id: number; org_id: number; name: string; timezone: string }
export interface Service { id: number; org_id: number; name: string; duration_min: number; color: string | null; locations: number[]; deposit: { due?: number; currency?: string | null; [k: string]: unknown } | null }
export interface Provider { id: number; org_id: number; name: string; color: string | null; services: number[]; locations: number[] }
export interface Options { terms: { provider?: string; resource?: string; customer?: string; [k: string]: string | undefined }; locations: Location[]; services: Service[]; providers: Provider[] }

export interface Dashboard {
  date: string;
  counts: Record<Status, number>;
  total: number;
  upcoming: Appointment[];
  late: Appointment[];
  waiting: Appointment[];
  in_service: Appointment[];
  schedule: Appointment[];
}

export type Span = [string, string];
export interface CalendarDay {
  location: { id: number; name: string; timezone: string };
  date: string;
  day: Span;
  providers: Array<{ id: number; name: string; title: string | null; color: string | null; working: Span[] }>;
  appointments: Appointment[];
  resources: Array<{ id: number; name: string; holds: Span[]; [k: string]: unknown }>;
}

export interface Availability { date: string; timezone: string; providers: Array<{ id: number; name: string; duration_min: number; slots: Array<{ starts_at: string; label: string }> }> }

export interface CheckoutPreview {
  appointment_id: number;
  status: string;
  checked_out: boolean;
  currency: string;
  service: { description: string; product_id: number | null; unit_price: number; priced: boolean };
  warehouse: { id: number; name: string } | null;
  planned: Array<{ product_id: number; name: string; unit: string | null; planned: number; stocked: boolean; available: number | null }>;
  deposit_held: number | { held?: number; [k: string]: unknown };
  may: { discount: boolean; issue: boolean; payment: boolean };
}
export interface Quote { currency: string; lines: Array<{ kind: string; description: string; quantity: number; unit_price: number; taxes: string[] }>; subtotal: string | number; discount: string | number; tax: string | number; total: string | number }
export interface SaleProduct { id: number; code: string | null; name: string; unit: string | null; price: number; currency: string | null; stocked: boolean; available: number | null }
export interface CheckoutInput { invoice: boolean; products: Array<{ product_id: number; quantity: number }>; used: Array<{ product_id: number; quantity: number }>; discount: number; note?: string }
export interface CheckoutResult { appointment: Appointment; invoice: { id: number; number: string | null; total?: number; currency?: string; status?: string; [k: string]: unknown } | null; deposit: unknown; commission: Array<{ amount: number; currency: string; description: string }> | null }

export interface ClientRow { id: number; name: string; phone: string | null; email: string | null; [k: string]: unknown }
export interface Visit { id: number; number: string; status: Status; status_label: string; date: string | null; time: string | null; service: string; provider: string; location: string; invoice: { number: string | null; currency: string; total: number; status: string } | null }
export interface ClientNote { id: number; body: string; pinned: boolean; by: string | null; at: string | null; edited_at?: string | null; [k: string]: unknown }
export interface ClientHistory {
  customer: ClientRow & { since?: string | null };
  tally: { total: number; completed: number; upcoming: number; cancelled: number; no_show: number; favourite_service: string | null; preferred_provider: string | null };
  revenue: Array<{ currency: string; amount: number }> | null;
  owed: Array<{ currency: string; amount: number }> | null;
  timeline: Visit[];
  notes: ClientNote[] | null;
  can: { notes: number[] };
  [k: string]: unknown;
}

export interface ReportIndex { reports: Array<{ key: string; label: string; money_only: boolean; by: string[] | null; max_days: number }>; companies: number[]; money: number[]; export: boolean }
export interface Report { title?: string; from: string; to: string; tiles?: Array<{ key: string; label: string; kind: string; value: unknown; note?: string }>; columns: Array<[string, string, string]>; rows: Array<Record<string, unknown>>; totals?: Record<string, unknown> | null; [k: string]: unknown }

export interface CommissionLine { id: number; appointment_id: number; number: string; provider_id: number; provider: string; customer: string | null; service: string; date: string | null; description: string; base: number; rate_type: string; rate: number; amount: number; currency: string; status: string; note: string | null; can_manage: boolean }
export interface CommissionReport { rows: CommissionLine[]; providers: Array<{ provider_id: number; provider: string; currency: string; lines: number; accrued: number; paid: number; void: number }>; truncated: boolean; from: string; to: string }

export interface SetupProvider { id: number; org_id: number; name: string; title: string | null; color: string | null; hours_mode: string; active: boolean; locations: number[]; services: Array<{ service_id: number; duration_min: number | null }>; hours: Array<{ weekday: number; starts: string; ends: string }> }
export interface Block { id: number; starts_at: string; ends_at: string; reason: string | null }

/** T-07 (target): the server's waitlist, where the connected server has one. */
export interface WaitlistEntry { id: number; customer: Party; service: { id: number; name: string } | null; provider: { id: number; name: string } | null; date_from: string | null; date_to: string | null; part_of_day?: string | null; note?: string | null; status?: string; created_at?: string | null; match?: { starts_at: string; provider_id: number | null; label?: string } | null }
export interface WaitlistOffer { starts_at: string; provider: { id: number; name: string } | null; matches: number[]; why?: string | null }

/* ───────────────────────── reads ───────────────────────── */

export const K = {
  all: ['appointments'] as const,
  options: ['appointments', 'options'] as const,
  dashboard: (date: string) => ['appointments', 'dashboard', date] as const,
  day: (loc: number, date: string) => ['appointments', 'day', loc, date] as const,
  range: (q: object) => ['appointments', 'range', q] as const,
  detail: (id: number) => ['appointments', 'detail', id] as const,
  availability: (q: object) => ['appointments', 'availability', q] as const,
  clients: (q: string) => ['appointments', 'clients', q] as const,
  client: (id: number) => ['appointments', 'client', id] as const,
  checkout: (id: number) => ['appointments', 'checkout', id] as const,
  reports: ['appointments', 'reports'] as const,
  report: (k: string, q: object) => ['appointments', 'report', k, q] as const,
  commission: (q: object) => ['appointments', 'commission', q] as const,
  setup: (what: string) => ['appointments', 'setup', what] as const,
  waitlist: ['appointments', 'waitlist'] as const,
  outbox: ['appointments', 'outbox'] as const,
  alerts: ['appointments', 'alerts'] as const,
};

export const fetchOptions = (signal?: AbortSignal) => apiGet<Options>(`${BASE}/options`, undefined, signal);
export const fetchDashboard = (date: string | null, signal?: AbortSignal) => apiGet<Dashboard>(`${BASE}/dashboard`, date ? { date } : undefined, signal);
export const fetchDay = (location: number, date: string, signal?: AbortSignal) => apiGet<CalendarDay>(`${BASE}/calendar`, { location, date }, signal);
export const fetchList = (q: { from: string; to: string; status?: string; provider?: number | null; location?: number | null; customer?: number | null; q?: string }, signal?: AbortSignal) =>
  apiGet<{ items: Appointment[]; total: number; truncated: boolean }>(BASE, q as Query, signal);
export const fetchDetail = (id: number, signal?: AbortSignal) => apiGet<Detail>(`${BASE}/${id}`, undefined, signal);
export const fetchAvailability = (q: { location: number; service: number; provider: number | 'any'; date: string; except?: number }, signal?: AbortSignal) =>
  apiGet<Availability>(`${BASE}/availability`, q as Query, signal);
export const searchClients = (q: string, signal?: AbortSignal) => apiGet<{ items: ClientRow[] }>(`${BASE}/customers`, { q }, signal);
export const fetchClientList = (q: string, signal?: AbortSignal) => apiGet<{ items: ClientRow[] }>(`${BASE}/customers/history`, { q }, signal);
export const fetchClient = (id: number, signal?: AbortSignal) => apiGet<ClientHistory>(`${BASE}/customers/${id}/history`, undefined, signal);
export const fetchCheckout = (id: number, signal?: AbortSignal) => apiGet<CheckoutPreview>(`${BASE}/${id}/checkout`, undefined, signal);
export const fetchSaleProducts = (location: number, q: string, signal?: AbortSignal) => apiGet<{ items: SaleProduct[] }>(`${BASE}/sale-products`, { location, q }, signal);
export const fetchReports = (signal?: AbortSignal) => apiGet<ReportIndex>(`${BASE}/reports`, undefined, signal);
export const fetchReport = (key: string, q: { from: string; to: string; location?: number | null; by?: string | null }, signal?: AbortSignal) =>
  apiGet<Report>(`${BASE}/reports/${encodeURIComponent(key)}`, q as Query, signal);
export const fetchCommission = (q: { from: string; to: string; provider?: number | null; status?: string | null }, signal?: AbortSignal) =>
  apiGet<CommissionReport>(`${BASE}/commissions`, q as Query, signal);
export const fetchProviders = (signal?: AbortSignal) => apiGet<{ items: SetupProvider[] }>(`${BASE}/setup/providers`, undefined, signal);
export const fetchBlocks = (provider: number, signal?: AbortSignal) => apiGet<{ items: Block[] }>(`${BASE}/setup/providers/${provider}/blocks`, undefined, signal);
export const fetchDeposits = (id: number, signal?: AbortSignal) => apiGet<{ items: Array<{ id: number; reference: string | null; method: string; amount: number; free: number; currency: string; paid_on: string; note: string | null }>; currency: string | null }>(`${BASE}/${id}/deposits`, undefined, signal);

const missing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);

/**
 * D04 week (server 1.1 `GET /calendar/week`: `date` any day of the week, weeks start Monday, `location` or `provider`).
 * On a server without it (404 / 405) the week is read from the list over the same seven days, as before.
 */
export async function fetchWeek(q: { date: string; location: number | null; provider: number | null }, signal?: AbortSignal): Promise<{ items: Appointment[]; from: string; to: string }> {
  const from = weekStart(q.date);
  const to = addDays(from, 6);
  try {
    const r = await apiGet<WeekWire>(`${BASE}/calendar/week`, { date: q.date, ...(q.location ? { location: q.location } : {}), ...(q.provider ? { provider: q.provider } : {}) } as Query, signal);
    return weekItems(r, from, to);
  } catch (e) {
    if (!missing(e)) throw e;
    const r = await fetchList({ from, to, location: q.location, provider: q.provider }, signal);
    return { items: r.items, from, to };
  }
}

interface WeekWire { from?: string; to?: string; days?: Array<{ date: string; appointments?: Appointment[] }> }

/** The week endpoint's days flattened to the rows the calendar draws. */
export function weekItems(r: WeekWire, from: string, to: string): { items: Appointment[]; from: string; to: string } {
  return { items: (r.days ?? []).flatMap((d) => d.appointments ?? []), from: r.from ?? from, to: r.to ?? to };
}

interface WaitlistWire {
  items?: Array<Record<string, unknown>>;
  offers?: WaitlistOffer[];
  freed?: Array<{ label?: string; detail?: string | null; entries?: number[]; starts_at?: string; provider?: { id: number; name: string } | null }>;
}

const party = (v: unknown): { id: number; name: string } | null =>
  v && typeof v === 'object' ? (v as { id: number; name: string }) : typeof v === 'string' ? { id: 0, name: v } : null;

/** The server's waitlist (1.1 and the web names: `state`, `match`, `wants`, `freed`) in the desk's shape. */
export function waitlistFrom(r: WaitlistWire): { items: WaitlistEntry[]; offers: WaitlistOffer[] } {
  const items: WaitlistEntry[] = (r.items ?? []).map((e) => {
    const c = party(e.customer) ?? { id: 0, name: '' };
    const match = (e.match ?? null) as WaitlistEntry['match'];
    return {
      id: Number(e.id),
      customer: { id: c.id, name: c.name, phone: null, email: null } as Party,
      service: party(e.service),
      provider: party(e.provider),
      date_from: (e.date_from ?? e.from ?? null) as string | null,
      date_to: (e.date_to ?? e.to ?? null) as string | null,
      part_of_day: (e.part_of_day ?? null) as string | null,
      note: (e.note ?? e.notes ?? e.wants ?? null) as string | null,
      status: (e.state ?? e.status ?? undefined) as string | undefined,
      created_at: (e.created_at ?? e.added_at ?? null) as string | null,
      match,
    };
  });
  const offers: WaitlistOffer[] = r.offers ?? (r.freed ?? []).filter((f) => f.starts_at).map((f) => ({ starts_at: f.starts_at!, provider: f.provider ?? null, matches: f.entries ?? [], why: f.detail ?? f.label ?? null }));
  return { items, offers };
}

/** The waitlist (server 1.1 `GET /waitlist`); `null` means the connected server does not have it yet (404 / 405). */
export async function fetchWaitlist(signal?: AbortSignal): Promise<{ items: WaitlistEntry[]; offers: WaitlistOffer[] } | null> {
  try {
    return waitlistFrom(await apiGet<WaitlistWire>(`${BASE}/waitlist`, undefined, signal));
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/* ───────────────────────── writes ───────────────────────── */

/** A write that needs WorkSuite now; the server's own sentence comes back with the answer. */
export async function send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<{ data: T; message: string }> {
  const r = await request<T>(method, path, { body });
  return { data: r.data, message: r.message ?? '' };
}

/** The 409 a booking or a move can come back with: why, and the server's next free time when it has one. */
export function refusal(e: unknown): { message: string; next: { starts_at: string; label?: string; provider?: string } | null } {
  if (e instanceof ApiError) {
    const d = (e.data ?? {}) as { next?: { starts_at: string; label?: string; provider?: string } | null };
    return { message: e.message, next: d.next ?? null };
  }
  return { message: e instanceof Error ? e.message : String(e), next: null };
}

export const book = (input: { location_id: number; service_id: number; provider_id: number | 'any'; customer_id: number; starts_at: string; notes?: string; internal_notes?: string }) =>
  send<{ appointment: Appointment }>('POST', BASE, input);
export const reschedule = (id: number, body: { starts_at: string; provider_id?: number; reason?: string }) => send<{ appointment: Appointment }>('POST', `${BASE}/${id}/reschedule`, body);
export const addClient = (input: { name: string; phone?: string; email?: string }) => send<{ customer: ClientRow }>('POST', `${BASE}/customers`, input);
export const quote = (id: number, input: CheckoutInput) => send<Quote>('POST', `${BASE}/${id}/checkout/quote`, input);
export const checkout = (id: number, input: CheckoutInput) => send<CheckoutResult>('POST', `${BASE}/${id}/checkout`, input);
export const linkDeposit = (id: number, paymentId: number) => send<{ appointment: Appointment; confirmed: boolean }>('POST', `${BASE}/${id}/deposits`, { payment_id: paymentId });
export const applyDeposit = (id: number) => send<{ appointment: Appointment }>('POST', `${BASE}/${id}/deposits/apply`);
export const retryNotice = (id: number) => send<{ notices: Notice[] }>('POST', `${BASE}/notices/${id}/retry`);
export const markCommission = (ids: number[], to: 'paid' | 'void' | 'accrued', note?: string) => send<{ changed: number }>('POST', `${BASE}/commissions/mark`, { ids, to, note });
export const addBlock = (provider: number, body: { starts_at: string; ends_at: string; reason?: string }) => send<unknown>('POST', `${BASE}/setup/providers/${provider}/blocks`, body);
export const removeBlock = (id: number) => send<unknown>('DELETE', `${BASE}/setup/blocks/${id}`);
/** `POST /waitlist` — both the 1.1 names (`date_from`, `notes`) and the web ones (`from`, `note`) are sent; the server reads either. */
export const addToWaitlist = (body: { customer_id: number; location_id: number | null; service_id: number; provider_id?: number | null; date_from: string; date_to: string; part_of_day?: string; note?: string }) =>
  send<{ id?: number; entry?: WaitlistEntry }>('POST', `${BASE}/waitlist`, { ...body, from: body.date_from, to: body.date_to, notes: body.note });
/** One-click book the entry's matched time (a normal booking; a refusal comes back as a booking's would). */
export const bookFromWaitlist = (id: number, body: { starts_at: string; provider_id: number | null }) => send<{ appointment: Appointment }>('POST', `${BASE}/waitlist/${id}/book`, body);
/** Hold the matched freed time for the client (`hold_min`, default 15) and let the server email them. */
export const offerFromWaitlist = (id: number, holdMin = 15) => send<unknown>('POST', `${BASE}/waitlist/${id}/offer`, { hold_min: holdMin });

/**
 * A payment recorded in Billing (it owns money), for this client. The desk records it there first, then says what it is
 * for: an invoice (checkout) or an appointment's deposit.
 */
export const recordPayment = (body: { client_id: number; org_id?: number; amount: number; currency: string; method: 'cash' | 'card' | 'bank_transfer' | 'online' | 'other'; bank_reference?: string; note?: string; allocate?: Array<{ invoice_id: number; amount: number }> }) =>
  send<{ payment: { id: number; number?: string | null; [k: string]: unknown } }>('POST', '/api/billing/payments', body);

export interface Queued { delivered: boolean; queued: boolean; message: string; appointment: Appointment | null }

/**
 * A status move: sent now, or — when WorkSuite cannot be reached — kept in the encrypted offline queue and sent in
 * order when it answers again. The server judges the move again then (409 when it no longer fits).
 */
export async function setStatus(a: Pick<Appointment, 'id' | 'number' | 'customer'>, status: Status, reason?: string): Promise<Queued> {
  const r = await call('offline:submit', {
    module: 'appointments',
    entity: 'appointment',
    entityId: String(a.id),
    label: `${a.number} · ${a.customer.name} → ${STATUS_LABEL[status]}`.slice(0, 200),
    method: 'POST',
    path: `${BASE}/${a.id}/status`,
    body: { status, ...(reason ? { reason } : {}) },
    queueIfOffline: true,
  });
  if (r.delivered) {
    const d = (r.data ?? {}) as { appointment?: Appointment };
    return { delivered: true, queued: false, message: `${STATUS_LABEL[status]}.`, appointment: d.appointment ?? null };
  }
  if (r.queued) return { delivered: false, queued: true, message: `Offline — “${STATUS_LABEL[status]}” is kept in the outbox and sent when WorkSuite is back.`, appointment: null };
  throw new Error(r.error ?? 'WorkSuite did not take that.');
}

/** A staff-only client note: queued offline like a status move. */
export async function addNote(customerId: number, orgId: number, body: string, pinned: boolean): Promise<Queued> {
  const r = await call('offline:submit', {
    module: 'appointments',
    entity: 'customer_note',
    entityId: String(customerId),
    label: `Client note · ${body.slice(0, 60)}`,
    method: 'POST',
    path: `${BASE}/customers/${customerId}/notes`,
    body: { org_id: orgId, body, pinned },
    queueIfOffline: true,
  });
  if (r.delivered) return { delivered: true, queued: false, message: 'Note saved.', appointment: null };
  if (r.queued) return { delivered: false, queued: true, message: 'Offline — the note is kept in the outbox and saved when WorkSuite is back.', appointment: null };
  throw new Error(r.error ?? 'The note was not saved.');
}

export const editNote = (id: number, change: { body?: string; pinned?: boolean }) => send<{ notes: ClientNote[] }>('PUT', `${BASE}/customer-notes/${id}`, change);
export const withdrawNote = (id: number) => send<{ notes: ClientNote[] }>('DELETE', `${BASE}/customer-notes/${id}`);

/* ───────────────────────── time, on the location's clock ───────────────────────── */

/** Minutes since local midnight of an instant on a zone's clock. */
export function minutesIn(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** The calendar day ("2026-10-25") an instant falls on, on a zone's clock. */
export function dateIn(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** The UTC instant of a wall-clock time ("2026-10-27", 600) on a zone's clock. */
export function zonedInstant(date: string, minutes: number, tz: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  // The zone's offset at that moment, found by reading the guess back on its clock (twice, for a DST edge).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const seen = minutesIn(new Date(t).toISOString(), tz);
    const seenDate = dateIn(new Date(t), tz);
    const dayShift = seenDate === date ? 0 : seenDate > date ? 1440 : -1440;
    t -= (seen + dayShift - minutes) * 60_000;
  }
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday of the week a day is in. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((wd + 6) % 7));
}

export function dayLabel(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export const today = (tz?: string) => dateIn(new Date(), tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone);

/** Snap a minute to a step (the calendar's 15 minutes). */
export const snap = (min: number, step = 15) => Math.round(min / step) * step;

/** A drop on the calendar asks to move only what the server lets move: Pending and Confirmed. */
export const movable = (a: Pick<Appointment, 'status' | 'can'>) => (a.status === 'pending' || a.status === 'confirmed') && !!a.can?.reschedule;

/** Where a card sits on the Today board (D01). */
export type Lane = 'arriving' | 'waiting' | 'in_service' | 'checkout';
export function laneOf(a: Appointment): Lane | null {
  if (a.status === 'pending' || a.status === 'confirmed') return 'arriving';
  if (a.status === 'checked_in') return 'waiting';
  if (a.status === 'in_service') return 'in_service';
  if (a.status === 'completed' && !a.checked_out && a.can.checkout) return 'checkout';
  return null;
}

/** The arriving lane: anyone late, and whoever is due in the next two hours. */
export function arriving(rows: Appointment[], now = Date.now()): Appointment[] {
  return rows
    .filter((a) => laneOf(a) === 'arriving' && Date.parse(a.starts_at) <= now + 2 * 3600_000)
    .sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
}

export const lateBy = (a: Pick<Appointment, 'starts_at'>, now = Date.now()) => Math.max(0, Math.floor((now - Date.parse(a.starts_at)) / 60_000));

/** The move a card's main button offers, of those the server says this person may make. */
export function primaryMove(a: Appointment): Move | null {
  const order: Status[] = ['checked_in', 'in_service', 'completed', 'confirmed'];
  for (const s of order) {
    const m = a.next.find((n) => n.status === s && n.allowed);
    if (m) return m;
  }
  return null;
}

/** An amount the server sent, grouped, with its currency. */
export function money(v: number | string | null | undefined, cur?: string | null): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur ? `${cur} ${s}` : s;
}

/** CSV of rows, for the reports' Export (quotes doubled; a leading = + - @ neutralised). */
export function toCsv(head: string[], rows: Array<Array<unknown>>): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

/** Save a CSV through the desktop's save dialog; the path chosen, or null when cancelled. */
export const saveCsv = (name: string, text: string) => call('files:saveText', { name, text: text.slice(0, 8_000_000) });
