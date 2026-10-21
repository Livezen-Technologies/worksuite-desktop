import { useQuery } from '@tanstack/react-query';
import { apiGetMeta, apiPost, type ApiResult, type Query } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';

/**
 * AMC & Service over the staff API (`/api/amc/…`, WorkSuite docs/amc/API.md). The server decides every rule —
 * scoping, coverage, service levels, who may give a job to whom; what is worked out here is only what is drawn
 * (hours on the timeline, which PM visits are overdue). Reads go through the main process's offline cache (the
 * manifest's READ_CACHE over `/api/amc`), so the last answers stay readable offline; writes are refused offline.
 */
export const B = '/api/amc';

export const K = {
  options: ['amc', 'options'] as const,
  dashboard: ['amc', 'dashboard'] as const,
  board: (date: string) => ['amc', 'board', date] as const,
  timeline: (date: string) => ['amc', 'timeline', date] as const,
  overdue: (date: string) => ['amc', 'overdue', date] as const,
  suggest: (visit: number, date: string, time: string) => ['amc', 'suggest', visit, date, time] as const,
  list: (list: string, q: Query) => ['amc', 'list', list, q] as const,
  record: (kind: string, id: number) => ['amc', 'record', kind, id] as const,
};

/** A read: the data, and whether it came from this computer's saved copy (offline). */
export interface Read<T> { data: T; offline: boolean; cachedAt: string | null }
export async function read<T>(path: string, query?: Query, signal?: AbortSignal): Promise<Read<T>> {
  const r: ApiResult<T> = await apiGetMeta<T>(`${B}${path}`, query, signal);
  return { data: r.data, offline: r.offline, cachedAt: r.cachedAt };
}

/** Whether the computer is offline: every AMC write is then disabled (the server is the authority). */
export function useOffline(): boolean {
  return useStore(app, (s) => s.status?.network === 'OFFLINE');
}

// ── options & permissions ──────────────────────────────────────────────────

export interface Company { id: number; name: string; today?: string; currency?: string; can: Record<string, boolean> }
export interface Technician { id: number; org_id: number; name: string; active?: boolean }
export interface Options { companies: Company[]; technicians?: Technician[]; priorities?: Record<string, string>; request_status?: Record<string, string> }

export function useOptions() {
  return useQuery({ queryKey: K.options, queryFn: ({ signal }) => read<Options>('/options', undefined, signal), staleTime: 300_000 });
}

/** Whether the person may do `perm` (the options' short key: assign, schedule, …) in a company — or in any. */
export function can(o: Options | undefined | null, perm: string, org?: number | null): boolean {
  const list = o?.companies ?? [];
  return list.some((c) => (org == null || c.id === org) && c.can?.[perm] === true);
}

// ── D-01 dashboard ─────────────────────────────────────────────────────────

export interface Dashboard {
  today?: string;
  contracts?: { active: number; waiting: number; renewal_due: number; expired: number; value?: Array<{ currency: string; amount: number }> };
  visits?: { today: number; planned: number; scheduled: number; completed: number; overdue: number };
  requests?: { open: number; unassigned: number; approval: number; at_risk: number; breached: number };
  warranties?: { active: number; expiring: number; claim: number };
  renewals?: Row[];
  overdue?: Row[];
  attention?: Row[];
}
export type Row = Record<string, unknown> & { id: number };

// ── D-02 dispatch ──────────────────────────────────────────────────────────

export interface Slot { visit_id: number; from: string; to: string; label?: string | null; client?: string | null; status?: string | null; progress?: string | null }
export interface TimelineTech { id: number; org_id: number; name: string; timeline: Slot[] }
export interface Timeline { date: string; items: TimelineTech[] }
export interface Visit {
  id: number; org_id: number; kind: string; kind_label?: string; label?: string | null; status: string; standing?: string;
  due_on?: string | null; date?: string; time?: string | null; duration_min?: number; client?: string; site?: string | null;
  equipment?: string | null; request_id?: number | null; number?: string; technician_id?: number | null;
}
export interface Board { date: string; unassigned: Visit[]; waiting: Row[]; technicians: Array<{ id: number; name: string; standing?: string; standing_label?: string; jobs?: number }> }
export interface Suggestion { id: number; name: string; eligible: boolean; free: boolean; suggested: boolean; why: string[]; jobs?: number; distance_km?: number | null; score?: number }
export interface GiveOut { booked: Array<{ visit_id: number; technician_id: number; time: string }>; refused: Array<{ visit_id: number; message: string }> }

export const fetchTimeline = (date: string, signal?: AbortSignal) => read<Timeline>('/dispatch/timeline', { date }, signal);
export const fetchBoard = (date: string, signal?: AbortSignal) => read<Board>('/dispatch', { date }, signal);
export const fetchSuggest = (visit: number, date: string, time: string, signal?: AbortSignal) =>
  read<{ items: Suggestion[] }>(`/dispatch/suggest/${visit}`, { date, time }, signal).then((r) => r.data.items ?? []);

/** Planned maintenance overdue: the PM visits standing `overdue` over the last three months up to the day. */
export async function fetchOverduePm(date: string, signal?: AbortSignal): Promise<Visit[]> {
  const from = shiftDay(date, -91);
  const r = await read<{ items: Visit[] }>('/visits', { from, to: date }, signal);
  return overduePm(r.data.items ?? []);
}
export const overduePm = (visits: Visit[]) => visits.filter((v) => v.standing === 'overdue' && v.kind === 'preventive');

/** Gives visits out on a day from a start time (`POST dispatch/give-out`), to one technician or the server's pick. */
export const giveOut = (visitIds: number[], date: string, start: string, technicianId?: number | null) =>
  apiPost<GiveOut>(`${B}/dispatch/give-out`, { visit_ids: visitIds.slice(0, 200), date, start, ...(technicianId ? { technician_id: technicianId } : {}) });
/** Books one visit to a technician at a time (`POST visits/{id}/schedule`) — a drag onto the timeline. */
export const scheduleVisit = (visit: number, date: string, time: string, technicianId: number) => apiPost(`${B}/visits/${visit}/schedule`, { date, time, technician_id: technicianId });
/** Gives a request (no visit yet) to a technician and books it (`POST requests/{id}/schedule`). */
export const scheduleRequest = (request: number, date: string, time: string, technicianId: number) => apiPost(`${B}/requests/${request}/schedule`, { date, time, technician_id: technicianId });

// ── D-03 requests ──────────────────────────────────────────────────────────

export interface RequestDetail { request: Row; visits?: Visit[]; messages?: Row[]; history?: Row[]; can?: Record<string, boolean> }
export const requestAction = (id: number, action: 'contact' | 'reopen' | 'hold' | 'resume' | 'resolve' | 'assign', body: Record<string, unknown> = {}) => apiPost(`${B}/requests/${id}/${action}`, body);

// ── lists (paged, docs/amc/API.md §1) ──────────────────────────────────────

export interface Page<T> { items: T[]; total: number; page: number; per_page: number; sort?: string; dir?: string }
export const PER_PAGE = 50;

export interface ListDef {
  view: string;
  /** API list path. */
  path: string;
  title: string;
  /** The record's query key in the address (`&request=12`). */
  param: string;
  /** Its detail path and the key its record comes under. */
  detail: (id: number) => string;
  key: string;
  extra?: Query;
  columns: Array<{ key: string; label: string }>;
  sorts: string[];
  /** Filter on `status` / `state`. */
  filter?: { param: string; options: Array<[string, string]> };
}

export const LISTS: Record<string, ListDef> = {
  requests: {
    view: 'requests', path: '/requests', title: 'Requests', param: 'request', detail: (id) => `/requests/${id}`, key: 'request',
    columns: [{ key: 'number', label: 'Number' }, { key: 'subject', label: 'Subject' }, { key: 'client', label: 'Customer' }, { key: 'priority_label', label: 'Priority' }, { key: 'status_label', label: 'Status' }, { key: 'technician', label: 'Technician' }],
    sorts: ['created', 'number', 'client', 'priority', 'status', 'due'],
    filter: { param: 'status', options: [['open', 'Open'], ['', 'All'], ['new', 'New'], ['assigned', 'Assigned'], ['resolved', 'Resolved'], ['closed', 'Closed']] },
  },
  contracts: {
    view: 'contracts', path: '/contracts', title: 'Contracts', param: 'contract', detail: (id) => `/contracts/${id}`, key: 'contract',
    columns: [{ key: 'number', label: 'Number' }, { key: 'title', label: 'Title' }, { key: 'client', label: 'Customer' }, { key: 'type_label', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'ends_on', label: 'Ends' }],
    sorts: ['number', 'client', 'ends_on', 'starts_on', 'value', 'status', 'created'],
    filter: { param: 'status', options: [['', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['suspended', 'Suspended'], ['expired', 'Expired']] },
  },
  renewals: {
    view: 'renewals', path: '/contracts', title: 'Renewals', param: 'contract', detail: (id) => `/contracts/${id}`, key: 'contract', extra: { renewal: 1 },
    columns: [{ key: 'number', label: 'Number' }, { key: 'title', label: 'Title' }, { key: 'client', label: 'Customer' }, { key: 'ends_on', label: 'Ends' }, { key: 'status', label: 'Status' }],
    sorts: ['ends_on', 'number', 'client', 'value'],
  },
  estimates: {
    view: 'estimates', path: '/estimates', title: 'Estimates', param: 'estimate', detail: (id) => `/estimates/${id}`, key: 'estimate',
    columns: [{ key: 'number', label: 'Number' }, { key: 'title', label: 'Title' }, { key: 'client', label: 'Customer' }, { key: 'status', label: 'Status' }, { key: 'valid_until', label: 'Valid until' }],
    sorts: ['created_at', 'number', 'client', 'status', 'valid_until'],
    filter: { param: 'status', options: [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['approved', 'Approved'], ['declined', 'Declined']] },
  },
  units: {
    view: 'units', path: '/equipment', title: 'Units', param: 'unit', detail: (id) => `/equipment/${id}`, key: 'equipment',
    columns: [{ key: 'name', label: 'Unit' }, { key: 'client', label: 'Customer' }, { key: 'site', label: 'Site' }, { key: 'category', label: 'Category' }, { key: 'serial_number', label: 'Serial' }],
    sorts: ['name', 'client', 'site', 'category', 'serial_number', 'installed_on'],
  },
  warranties: {
    view: 'warranties', path: '/warranties', title: 'Warranties', param: 'warranty', detail: (id) => `/warranties/${id}`, key: 'warranty',
    columns: [{ key: 'number', label: 'Number' }, { key: 'type_label', label: 'Type' }, { key: 'equipment', label: 'Unit' }, { key: 'provider', label: 'Provider' }, { key: 'state', label: 'State' }, { key: 'ends_on', label: 'Ends' }],
    sorts: ['ends_on', 'starts_on', 'number', 'type', 'provider', 'created'],
    filter: { param: 'state', options: [['live', 'Live'], ['', 'All'], ['active', 'Active'], ['expiring', 'Expiring'], ['expired', 'Expired'], ['claim', 'Claim']] },
  },
};

export function fetchPage(def: ListDef, q: { page: number; sort: string; dir: 'asc' | 'desc'; q: string; filter: string }, signal?: AbortSignal): Promise<Read<Page<Row>>> {
  return read<Page<Row>>(def.path, { ...def.extra, page: q.page, per_page: PER_PAGE, sort: q.sort, dir: q.dir, q: q.q, ...(def.filter ? { [def.filter.param]: q.filter } : {}) }, signal).then((r) => ({ ...r, data: asPage(r.data, q.page) }));
}

/** A paged answer, or an older plain array, as a page. */
export function asPage(v: unknown, page = 1): Page<Row> {
  if (Array.isArray(v)) return { items: v as Row[], total: v.length, page, per_page: v.length };
  const o = (v ?? {}) as Partial<Page<Row>>;
  const items = Array.isArray(o.items) ? o.items : [];
  return { items, total: typeof o.total === 'number' ? o.total : items.length, page: o.page ?? page, per_page: o.per_page ?? PER_PAGE, sort: o.sort, dir: o.dir };
}

export const pages = (p: Page<unknown>) => Math.max(1, Math.ceil(p.total / Math.max(1, p.per_page || PER_PAGE)));

// ── time helpers (display only) ────────────────────────────────────────────

export function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}
export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
/** "08:30" → minutes after midnight; anything else null. Accepts an ISO stamp's time too. */
export function minutesOf(t: string | null | undefined): number | null {
  const m = /(?:^|T)([01]\d|2[0-3]):([0-5]\d)/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** The hour a drop at `x` pixels lands on, on a timeline from `startHour` with `hourPx` per hour, to the half hour. */
export function dropTime(x: number, startHour: number, hourPx: number, endHour = 20): string {
  const min = Math.round((((Number.isFinite(x) ? x : 0) / hourPx) * 60) / 30) * 30 + startHour * 60;
  return hhmm(Math.min(Math.max(min, startHour * 60), endHour * 60 - 30));
}

export const label = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? (String((v as { name?: unknown }).name ?? (v as { label?: unknown }).label ?? '') || '—') : String(v));
