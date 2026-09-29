import { apiGet, request, type ApiResult } from '../../core/api';
import type { Job, Job360, Transition } from './api';

/**
 * Garage stage B2 (`web-api-b2.md`): work orders from approved work, the
 * technicians on them, the labour timer (the server's clock only), labour
 * corrections that keep the original, the bays and the workshop calendar.
 * The job follows its work orders on the server; a screen only asks.
 */
const BASE = '/api/garage';

export interface Timer {
  state: 'not_started' | 'running' | 'paused' | 'stopped';
  started_at: string | null;
  paused_at: string | null;
  paused_seconds: number;
  pause_reason: string | null;
  stopped_at: string | null;
  worked_seconds: number;
}

export interface Booking {
  id: number;
  bay_id: number;
  starts_at: string;
  ends_at: string;
  status: 'reserved' | 'active' | 'completed' | 'cancelled' | 'reschedule';
  status_label: string;
  note: string | null;
  job?: { id: number; number: string; status: string; vehicle_number: string | null; make_model: string | null; customer: string | null } | null;
  work_order?: { id: number; code: string; work_type: string; status: string; status_label: string; technicians: Array<{ id: number; role: string; name: string | null }> } | null;
  busy_only?: boolean;
}

export interface WorkOrder {
  id: number;
  org_id: number;
  job_id: number;
  code: string;
  work_type: string;
  description: string | null;
  required_skill: string | null;
  required_skill_name: string | null;
  status: string;
  status_label: string;
  pause_reason: string | null;
  pause_reason_label: string | null;
  internal: boolean;
  bay: { id: number; code: string; name: string; status: string; status_label: string } | null;
  bookings: Booking[];
  estimated_minutes: number | null;
  actual_minutes: number;
  started_at: string | null;
  completed_at: string | null;
  sort: number;
  version: number;
  technicians: Array<{ id: number; name: string | null; role: string; role_label: string; assigned_at: string | null; has_skill: boolean; minutes: number; timer: Timer | null }>;
  running: number;
  lines: Array<{ item_id: number; line_key: string; line_type: string; description: string; qty: number; unit: string | null; labour_hours: number | null; product_id: number | null; decision: string }>;
  my_role: string | null;
  my_timer: Timer | null;
  can: { start: boolean; pause: boolean; complete: boolean; assign: boolean; edit: boolean; cancel: boolean };
}

export interface WorkOrdersTab {
  items: WorkOrder[];
  lines_waiting: number;
  can: { create: boolean; assign: boolean; correct_labour: boolean };
  job?: Job;
}

export interface LabourEntry {
  id: number;
  job_id: number;
  work_order: { id: number; code: string; work_type: string } | null;
  technician: { id: number; name: string | null } | null;
  started_at: string | null;
  ended_at: string | null;
  running: boolean;
  minutes: number;
  pause_reason: string | null;
  is_rework: boolean;
  is_billable: boolean;
  source: 'timer' | 'manual' | 'offline_sync';
  corrected_from_id: number | null;
  correction_reason: string | null;
  superseded_at: string | null;
  superseded: boolean;
  by: { id: number; name: string | null } | null;
  created_at: string | null;
}

export interface LabourTab {
  items: LabourEntry[];
  minutes: number;
  billable_minutes: number;
  rework_minutes: number;
  running: number;
  by_technician: Array<{ id: number; name: string | null; minutes: number; rework_minutes: number }>;
  can_correct: boolean;
}

export interface Technician {
  id: number;
  name: string | null;
  org_id: number;
  branch_id: number | null;
  workshop_id: number | null;
  skills: Array<{ code: string; name: string }>;
  has_skill: boolean | null;
  running: unknown;
  open_work_orders: number;
  booked_minutes_today: number;
  worked_minutes_today: number;
  on_work_order: boolean;
}

export interface BayRow {
  id: number;
  org_id: number;
  branch_id: number | null;
  workshop_id: number | null;
  code: string;
  name: string;
  bay_type: string;
  bay_type_label: string;
  capabilities: string[];
  cleaning_step: boolean;
  active: boolean;
  status: string;
  status_label: string;
  status_reason: string | null;
  status_changed_at: string | null;
  job: Job | null;
  occupied_by_hidden_job: boolean;
  work_orders: Array<Pick<WorkOrder, 'id' | 'code' | 'work_type' | 'status' | 'status_label'>>;
  booking: Booking | null;
  next_booking: Booking | null;
  actions: Transition[];
}

export interface Calendar {
  from: string;
  to: string;
  bays: Array<{ id: number; org_id: number; code: string; name: string; bay_type: string; status: string; status_label: string; bookings: Booking[] }>;
  technicians: Array<{ id: number; name: string | null; org_id: number; skills: Array<{ code: string; name: string }>; bookings: Booking[]; running: unknown }>;
  unscheduled: Array<WorkOrder & { job?: Job }>;
}

/** The six reasons a timer is paused for (the phone's, SM-04's `PAUSE_REASONS`). */
export const PAUSE_REASONS: Record<string, string> = {
  waiting_parts: 'Waiting for parts',
  customer_approval: 'Waiting for the customer',
  break: 'Break',
  another_job: 'Another job',
  tools: 'Tools or equipment',
  other: 'Something else',
};

export const KB2 = {
  workOrders: (jobId: number) => ['garage', 'job', jobId, 'work-orders'] as const,
  labour: (jobId: number) => ['garage', 'job', jobId, 'labour'] as const,
  technicians: (org: number, wo: number) => ['garage', 'technicians', org, wo] as const,
  bays: (org: string, branch: string) => ['garage', 'bays', org, branch] as const,
  mine: (tab: string, org: string) => ['garage', 'my-work', tab, org] as const,
  calendar: (org: string, from: string, to: string) => ['garage', 'calendar', org, from, to] as const,
};

async function write<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, version?: number): Promise<ApiResult<T>> {
  return request<T>(method, `${BASE}${path}`, { body, headers: version !== undefined ? { 'If-Match': String(version) } : undefined });
}

export const fetchWorkOrders = (jobId: number, signal?: AbortSignal) => apiGet<WorkOrdersTab>(`${BASE}/jobs/${jobId}/work-orders`, undefined, signal);
export const fetchSuggestions = (jobId: number, signal?: AbortSignal) => apiGet<{ groups: Array<{ work_type: string; description: string | null; required_skill: string | null; estimated_minutes: number | null; lines: number[] }>; lines_waiting: number }>(`${BASE}/jobs/${jobId}/work-orders/suggest`, undefined, signal);
export const fetchLabour = (jobId: number, signal?: AbortSignal) => apiGet<LabourTab>(`${BASE}/jobs/${jobId}/labour`, undefined, signal);
export const fetchTechnicians = (org: number, workOrderId: number, branchId: number | null, signal?: AbortSignal) =>
  apiGet<{ items: Technician[] }>(`${BASE}/technicians`, { org, work_order_id: workOrderId, branch_id: branchId ?? undefined }, signal);
export const fetchBays = (org: string, branch: string, signal?: AbortSignal) => apiGet<{ items: BayRow[]; updated_at: string | null }>(`${BASE}/bays`, { org: org || undefined, branch_id: branch || undefined }, signal);
export const fetchMine = (tab: string, org: string, signal?: AbortSignal) =>
  apiGet<{ tab: string; tabs: Array<{ key: string; label: string; count: number }>; items: Array<WorkOrder & { job: Job }> }>(`${BASE}/my/work-orders`, { tab, org: org || undefined }, signal);
export const fetchCalendar = (org: string, from: string, to: string, signal?: AbortSignal) => apiGet<Calendar>(`${BASE}/calendar`, { org: org || undefined, from, to }, signal);

export type WoAnswer = { work_order: WorkOrder; job?: Job; warnings?: string[]; already?: boolean; booking_id?: number | null };

export const createWorkOrders = (jobId: number, body: Record<string, unknown>) => write<{ work_orders: WorkOrder[]; job: Job }>('POST', `/jobs/${jobId}/work-orders`, body);
export const timer = (woId: number, action: 'start' | 'resume' | 'pause' | 'stop', body: { reason?: string } = {}) => write<WoAnswer>('POST', `/work-orders/${woId}/timer/${action}`, body);
export const completeWorkOrder = (woId: number) => write<WoAnswer>('POST', `/work-orders/${woId}/complete`);
export const assignWorkOrder = (woId: number, body: { technicians: Array<{ id: number; role: string }>; service_bay_id: number | null; starts_at?: string; minutes?: number; note?: string }, version?: number) =>
  write<WoAnswer>('POST', `/work-orders/${woId}/assign`, body, version);
export const cancelWorkOrder = (woId: number, reason: string) => write<WoAnswer>('POST', `/work-orders/${woId}/cancel`, { reason });
export const workOrderNote = (woId: number, body: { body: string; visibility: 'internal' | 'customer' }) => write<WoAnswer>('POST', `/work-orders/${woId}/notes`, body);
export const correctLabour = (entryId: number, body: Record<string, unknown>) => write<{ labour: LabourTab; entry_id: number }>('POST', `/labour/${entryId}/correct`, body);
export const addLabour = (woId: number, body: Record<string, unknown>) => write<unknown>('POST', `/work-orders/${woId}/labour`, body);
export const setBayStatus = (bayId: number, body: { to: string; reason?: string }) => write<{ bay: BayRow }>('PATCH', `/bays/${bayId}/status`, body);
export const book = (body: Record<string, unknown>) => write<{ booking: Booking; warnings?: string[] }>('POST', '/calendar/assignments', body);
export const releaseBooking = (id: number) => write<unknown>('DELETE', `/calendar/assignments/${id}`);

/** Seconds worked on a timer by now, as its own fields say: (paused at | stopped at | now) − started − paused. */
export function workedSeconds(t: Timer | null, now = Date.now()): number {
  if (!t?.started_at) return 0;
  const end = t.state === 'paused' && t.paused_at ? Date.parse(t.paused_at) : t.state === 'stopped' && t.stopped_at ? Date.parse(t.stopped_at) : now;
  return Math.max(0, Math.round((end - Date.parse(t.started_at)) / 1000) - (t.paused_seconds ?? 0));
}

/** "1:05:09" / "42:17". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** "1 h 10 min" for minutes. */
export function minutesLabel(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}

/** Whether the server has stage B2 on the job card (`work_orders`, null without the permission to see them). */
export const hasWorkOrders = (job: Job360) => job.work_orders !== null && job.work_orders !== undefined;
