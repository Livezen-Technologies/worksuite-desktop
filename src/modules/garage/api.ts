import { ApiError, apiGet, request } from '../../core/api';
import { call } from '../../core/bridge';

/**
 * Garage & Service Center (the server's `/api/garage/v1`): the workshop layer
 * over CRM's customers, HR's technicians, Inventory's parts and Billing's
 * invoices. `garage.access` opens it; the finer grants come back in
 * `options.can`, flattened the way the web reads them
 * (`garage.parts.issue` → `parts_issue`).
 *
 * THE COMPANY IS ONE COMPANY. A job belongs to one company, and the server
 * answers for the company sent as `org` (or the reader's own when none is).
 *
 * EVERY WRITE THAT CAN BE PRESSED TWICE CARRIES AN IDEMPOTENCY KEY, made once
 * per attempt, so a second press after a dropped connection is the same move.
 *
 * THE TIMER KEEPS RUNNING OFFLINE (NFR-05). A start or a pause that cannot
 * reach WorkSuite goes to the offline queue with the moment it was pressed
 * (`at`), and the server books it at that moment when the line is back.
 */

export const BASE = '/api/garage/v1';

type Query = Record<string, string | number | boolean | null | undefined>;

export function gGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  return apiGet<T>(`${BASE}${path}`, query, signal);
}

/** A write; the server's own sentence comes back beside what it made. */
export async function gPost<T = unknown>(path: string, body: unknown = {}, key?: string): Promise<{ data: T; message: string }> {
  const r = await request<T>('POST', `${BASE}${path}`, { body, headers: key ? { 'Idempotency-Key': key } : undefined });
  return { data: r.data, message: r.message ?? 'Done.' };
}

export function newKey(prefix = 'garage'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
}

export function errorText(e: unknown, fallback = 'That could not be done. Try again.'): string {
  return e instanceof Error && e.message.trim() ? e.message : fallback;
}

/** What the server sent beside a refusal (`errors`): the open jobs, the likely duplicates. */
export function errorData<T>(e: unknown): T | null {
  return e instanceof ApiError && e.data && typeof e.data === 'object' ? (e.data as T) : null;
}

const unreachable = (e: unknown) => e instanceof ApiError && e.status === 0;

export type TimerAction = 'start' | 'pause';

/**
 * Start or pause a work order's timer. Online it is an ordinary write; with
 * WorkSuite out of reach it is queued with the time it was pressed, and
 * `queued` says so.
 */
export async function timer(workOrderId: number, action: TimerAction, body: { technician_id: number; reason?: string; note?: string }, label: string, now = new Date()): Promise<{ queued: boolean; message: string }> {
  try {
    const r = await gPost(`/work-orders/${workOrderId}/${action}`, body, newKey(`wo-${action}`));
    return { queued: false, message: r.message };
  } catch (e) {
    if (!unreachable(e)) throw e;
  }
  const r = await call('offline:submit', {
    module: 'garage',
    entity: 'work_order',
    entityId: String(workOrderId),
    label,
    method: 'POST',
    path: `${BASE}/work-orders/${workOrderId}/${action}`,
    body: { ...body, at: now.toISOString() },
    queueIfOffline: true,
  });
  if (r.delivered) return { queued: false, message: action === 'start' ? 'Timer started.' : 'Timer paused.' };
  if (!r.queued) throw new Error(r.error ?? 'The timer was not changed.');
  return { queued: true, message: action === 'start' ? 'Offline — the start is kept with its time and sent when WorkSuite is back.' : 'Offline — the pause is kept with its time and sent when WorkSuite is back.' };
}

export const K = {
  all: ['garage'] as const,
  options: (org: string) => ['garage', 'options', org] as const,
  overview: (org: string) => ['garage', 'overview', org] as const,
  board: (org: string, f: object) => ['garage', 'board', org, f] as const,
  jobs: (org: string, f: object) => ['garage', 'jobs', org, f] as const,
  job: (id: number) => ['garage', 'job', id] as const,
  work: (id: number) => ['garage', 'work', id] as const,
  mywork: ['garage', 'mywork'] as const,
  parts: (org: string, view: string, q: string) => ['garage', 'parts', org, view, q] as const,
  search: (org: string, q: string) => ['garage', 'search', org, q] as const,
};

// ── shapes (as the server sends them) ───────────────────────────────────

export type JobStatus =
  | 'DRAFT' | 'CHECKED_IN' | 'INSPECTION' | 'DIAGNOSIS' | 'ESTIMATE_PREPARATION' | 'AWAITING_CUSTOMER_APPROVAL' | 'APPROVED' | 'WAITING_PARTS'
  | 'READY_TO_START' | 'IN_PROGRESS' | 'PAUSED' | 'ADDITIONAL_APPROVAL_REQUIRED' | 'QUALITY_CHECK' | 'ROAD_TEST' | 'READY_FOR_DELIVERY'
  | 'INVOICE_PENDING' | 'COMPLETED' | 'CANCELLED';

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface Branch { id: number; name: string; code: string; active: boolean; garage: boolean }
export interface Technician { id: number; employee_id: number; user_id: number | null; name: string; skills: string[]; is_lead: boolean; active: boolean }
export interface Model { id: number; vehicle_type: string; make: string; model: string; active: boolean }

export interface Options {
  org: number;
  companies: { id: number; name: string }[];
  currency: string;
  units: string;
  can: Record<string, boolean>;
  setup: { complete: boolean; done: number; total: number; next: string | null };
  branches: Branch[];
  technicians: Technician[];
  models: Model[];
  priorities: Priority[];
  job_types: string[];
  vehicle_types: string[];
  fuels: string[];
  transmissions: string[];
  complaints: string[];
  cancel_reasons: string[];
  require_vin: boolean;
}

export interface JobCard {
  id: number; number: string; status: JobStatus; status_label: string; priority: Priority; job_type: string;
  vehicle: { id: number; number: string; make: string | null; model: string | null; type: string } | null;
  fleet: boolean;
  customer: { id: number; name: string; phone: string | null } | null;
  advisor: string; advisor_initials: string; target: string | null; overdue: boolean; late_minutes: number;
  checkin_at: string | null; created_at: string | null; completed_at: string | null; additional: boolean; total: number | null;
}

export interface BoardColumn { key: string; label: string; statuses: JobStatus[]; cards: JobCard[] }

export interface Overview {
  counts: Record<string, number>;
  overdue: JobCard[];
  checked_in_today: number;
  delivered_today: number;
  bays: Record<string, number>;
  recent: JobCard[];
}

export interface JobList { view: string; total: number; page: number; per_page: number; counts: Record<string, number>; jobs: JobCard[] }

export interface Customer { id: number; name: string; phone: string | null; email: string | null }

export interface VehicleBrief {
  id: number; vehicle_number: string; vin: string | null; vehicle_type: string; make: string | null; model: string | null; year: number | null;
  colour: string | null; odometer: number | null; client_id: number | null; customer_name: string | null; customer_phone: string | null;
  open?: { id: number; number: string; status: JobStatus }[];
}

export interface Note { id: number; body: string; visibility: 'INTERNAL' | 'CUSTOMER'; by: string | null; at: string }

export interface JobView {
  job: JobCard & {
    workshop: { id: number; name: string } | null; branch: { id: number; name: string } | null;
    requested_services: string | null; odometer_in: number | null; fuel_in: number | null; cancel_reason: string | null; source: string;
  };
  customer: Customer | null;
  vehicle: VehicleBrief | null;
  checkin: { complaints: string[]; completed_at: string | null } | null;
  history: { from: string | null; to: string; label: string; waiting: string | null; reason: string | null; by: string | null; at: string }[];
  notes: Note[];
  choices: { to: JobStatus; label: string }[];
  cancel_reasons: string[];
  can: { edit: boolean; checkin: boolean; cancel: boolean };
}

export type WorkOrderStatus = 'PENDING' | 'READY' | 'ASSIGNED' | 'IN_PROGRESS' | 'PAUSED' | 'WAITING_PARTS' | 'COMPLETED' | 'QC_FAILED' | 'REWORK' | 'CANCELLED';

export interface WorkOrder {
  id: number; job_id: number; code: string; work_type: string; description: string | null; status: WorkOrderStatus; is_additional: boolean;
  estimated_minutes: number; logged_minutes: number; started_at: string | null; completed_at: string | null;
  bay: { id: number; code: string; name: string | null } | null;
  technicians: { id: number; name: string; role: 'LEAD' | 'ASSISTANT' | 'SPECIALIST'; user_id: number | null; running: boolean }[];
  lines: { id: number; type: string; description: string; qty: number; labour_minutes: number | null }[];
}

export type PartStatus = 'REQUESTED' | 'RESERVED' | 'PURCHASE_REQUESTED' | 'ISSUED' | 'PARTIALLY_RETURNED' | 'CONSUMED' | 'CANCELLED';

export interface PartUsage {
  id: number; job_id: number; work_order_id: number | null; product_id: number; description: string; source: 'ESTIMATE' | 'REQUEST'; status: PartStatus;
  approved_qty: number; requested_qty: number; reserved_qty: number; issued_qty: number; used_qty: number; returned_qty: number;
  urgency: 'LOW' | 'NORMAL' | 'URGENT'; reason: string | null; requested_by: string | null; created_at: string | null;
  job_number?: string; vehicle?: string;
}

export interface WorkView { job_status: JobStatus; work_orders: WorkOrder[]; parts: PartUsage[] }

export type MyWorkItem = WorkOrder & { job_number: string; priority: Priority; target: string | null; job_status: JobStatus; vehicle: string; my_role: string; my_technician_id: number };

export interface MyWork { technician: boolean; running: { work_order_id: number; started_at: string } | null; work: MyWorkItem[]; pause_reasons: string[] }

export interface PartHit { id: number; code: string | null; name: string; unit_price: number; availability: string | null }

// ── words and numbers ───────────────────────────────────────────────────

/** "front_bumper" → "Front bumper". */
export function nice(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A UTC "Y-m-d H:i:s" (or ISO) from the server, as a moment. */
export function utc(s: string): number {
  return new Date(s.includes('T') ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : `${s.replace(' ', 'T')}Z`).getTime();
}

export function when(s: string | null | undefined, withTime = true): string {
  if (!s) return '—';
  const t = utc(s);
  if (Number.isNaN(t)) return s;
  return withTime ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** 150 → "2 h 30 min". */
export function span(minutes: number | null | undefined): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

export function lateBy(minutes: number): string {
  if (minutes < 60) return `${minutes} min late`;
  const h = Math.floor(minutes / 60);
  return h < 48 ? `${h} h late` : `${Math.floor(h / 24)} days late`;
}

/** 1.5 → "1.5", 2 → "2". */
export function qty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** "1:05:12" between a UTC start and now. */
export function elapsed(since: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - utc(since)) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** What was approved (or asked for) and is not yet out. */
export function remaining(u: PartUsage): number {
  const limit = u.source === 'ESTIMATE' ? u.approved_qty : u.requested_qty;
  return Math.max(0, Math.round((limit - u.issued_qty + u.returned_qty) * 1000) / 1000);
}

/** "approved 2 · issued 1 · used 1". */
export function partCounts(u: PartUsage): string {
  return [
    u.source === 'ESTIMATE' ? `approved ${qty(u.approved_qty)}` : `asked ${qty(u.requested_qty)}`,
    u.reserved_qty > 0 && u.issued_qty === 0 ? `held ${qty(u.reserved_qty)}` : '',
    u.issued_qty > 0 ? `issued ${qty(u.issued_qty)}` : '',
    u.used_qty > 0 ? `used ${qty(u.used_qty)}` : '',
    u.returned_qty > 0 ? `returned ${qty(u.returned_qty)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Whether this person may: the options' answer for the company (`garage.parts.issue`
 * is read as `parts_issue`), and the person's own permissions for what the
 * options do not list (returns, overrides), as the web reads them.
 */
export function mayIn(opts: Options | undefined, perm: string, perms: readonly string[] = []): boolean {
  const v = opts?.can?.[perm.replace(/^garage\./, '').replace(/\./g, '_')];
  if (typeof v === 'boolean') return v;
  return perms.includes('*') || perms.includes(perm);
}

/** The work groups on the technician's screen, in the order they are done. */
export const WORK_GROUPS: { key: string; label: string; has: (w: MyWorkItem) => boolean }[] = [
  { key: 'now', label: 'Working now', has: (w) => w.status === 'IN_PROGRESS' || w.status === 'REWORK' },
  { key: 'todo', label: 'To do', has: (w) => ['ASSIGNED', 'READY', 'PENDING'].includes(w.status) },
  { key: 'parts', label: 'Waiting for parts', has: (w) => w.status === 'WAITING_PARTS' },
  { key: 'paused', label: 'Paused', has: (w) => w.status === 'PAUSED' },
  { key: 'done', label: 'Done today', has: (w) => w.status === 'COMPLETED' },
];

export const PAUSE_LABEL: Record<string, string> = { break: 'Break', parts: 'Waiting for parts', approval: 'Waiting for approval', shift_end: 'End of shift', other: 'Something else' };
