import type { GarageDoc } from '@shared/garage-docs';
import { ApiError, apiGet, apiUrl, request } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';

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

/** Take something away (a photo, an estimate line). */
export async function gDelete<T = unknown>(path: string): Promise<{ data: T; message: string }> {
  const r = await request<T>('DELETE', `${BASE}${path}`);
  return { data: r.data, message: r.message ?? 'Removed.' };
}

/**
 * One file onto a job (`POST jobs/{id}/media`, multipart): a check-in photo
 * in its slot, a damage close-up, an inspection item's photo, or a file for
 * the job. The server reads the type from the bytes, never the name.
 */
export async function gUpload<T = unknown>(jobId: number, file: Blob, name: string, meta: { subject: string; subject_id?: number; slot?: string; visibility?: string; caption?: string }): Promise<{ data: T; message: string }> {
  const form = new FormData();
  form.append('file', file, name);
  for (const [k, v] of Object.entries(meta)) if (v !== undefined && v !== '') form.append(k, String(v));
  const r = await request<T>('POST', `${BASE}/jobs/${jobId}/media`, { body: form });
  return { data: r.data, message: r.message ?? 'Kept.' };
}

/** The API proxy takes up to 25 MB in one request; larger files go from the web or the phone. */
export const MAX_UPLOAD = 25 * 1024 * 1024;

/** A job's photo or file, read through the desktop's API proxy (which adds the session). */
export function mediaSrc(id: number): string {
  return apiUrl(`${BASE}/media/${id}`);
}

/**
 * A photo made small enough for a workshop's Wi-Fi (FR-CHK-04: 2560 px on the
 * long side, JPEG 0.85), as the web does. What cannot be drawn here (HEIC,
 * video, PDF) goes as it is.
 */
export async function shrinkPhoto(file: Blob, max = 2560): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 3 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.85));
  } catch {
    return file;
  }
}

/**
 * A document the server prints — check-in sheet, estimate, work order sheet,
 * delivery note — or a report's CSV, through the download manager: to the
 * downloads folder, and opened when `open` (a page opens in the browser, to
 * read or print). It shows in Transfers either way.
 */
export async function download(doc: GarageDoc, name: string, open: boolean): Promise<void> {
  await call('transfers:download', { garageDoc: doc, name: name.replace(/[/\\]/g, '-').slice(0, 255) || 'garage-document', open });
}

/** Whether WorkSuite can be reached from this computer. Writes wait for it; reads may come from the last copy. */
export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export const OFFLINE = 'You are offline. This needs WorkSuite; try again once you are back online.';

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
  checkin: (id: number) => ['garage', 'checkin', id] as const,
  inspections: (id: number) => ['garage', 'inspections', id] as const,
  diagnosis: (id: number) => ['garage', 'diagnosis', id] as const,
  estimates: (id: number) => ['garage', 'estimates', id] as const,
  delivery: (id: number) => ['garage', 'delivery', id] as const,
  vehicles: (org: string, f: object) => ['garage', 'vehicles', org, f] as const,
  vehicle: (id: number) => ['garage', 'vehicle', id] as const,
  customers: (org: string, f: object) => ['garage', 'customers', org, f] as const,
  customer: (org: string, id: number) => ['garage', 'customer', org, id] as const,
  workshop: (org: string) => ['garage', 'workshop', org] as const,
  employees: (org: string, q: string) => ['garage', 'employees', org, q] as const,
  setup: (org: string) => ['garage', 'setup', org] as const,
  reports: (org: string) => ['garage', 'reports', org] as const,
  report: (name: string, f: object) => ['garage', 'report', name, f] as const,
};

// ── shapes (as the server sends them) ───────────────────────────────────

export type JobStatus =
  | 'DRAFT' | 'CHECKED_IN' | 'INSPECTION' | 'DIAGNOSIS' | 'ESTIMATE_PREPARATION' | 'AWAITING_CUSTOMER_APPROVAL' | 'APPROVED' | 'WAITING_PARTS'
  | 'READY_TO_START' | 'IN_PROGRESS' | 'PAUSED' | 'ADDITIONAL_APPROVAL_REQUIRED' | 'QUALITY_CHECK' | 'ROAD_TEST' | 'READY_FOR_DELIVERY'
  | 'INVOICE_PENDING' | 'COMPLETED' | 'CANCELLED';

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface Branch { id: number; name: string; code: string; active: boolean; garage: boolean; warehouse_id?: number | null; warehouse?: string | null; hours?: Record<string, { open: string; close: string }> | null; invoice_prefix?: string | null }
export interface Technician { id: number; employee_id: number; user_id: number | null; name: string; skills: string[]; is_lead: boolean; active: boolean; branch_id?: number | null; workshop_id?: number | null; rate_class?: string }
export interface Model { id: number; vehicle_type: string; make: string; model: string; active: boolean }
export interface WorkshopRow { id: number; branch_id: number; name: string; code: string | null; active: boolean }
export interface Bay {
  id: number; branch_id: number; workshop_id: number; code: string; name: string | null; bay_type: string; capabilities: string[]; status: string; status_note: string | null;
  status_at: string | null; active: boolean; current?: { job_id: number; number: string; vehicle: string } | null;
}
export interface Rate { id: number; branch_id: number | null; rate_class: string; label: string; rate_type: string; rate: number; active: boolean }
export interface ServiceType { id: number; name: string; code: string | null; duration_minutes: number; required_skill: string | null; bay_type: string | null; active: boolean }

export interface CheckinConfig {
  areas: string[]; slots: string[]; required_slots: string[]; min_photos: number; signature: boolean; complaints: string[];
  conditions: string[]; fuel: number[]; views: string[]; marks: string[]; accessories: string[]; units: string;
}

export interface SetupStep { key: string; title: string; what: string; kind: 'required' | 'default' | 'skip'; done: boolean; skipped: boolean; todo: string }
export interface SetupStatus { steps: SetupStep[]; ready: boolean; complete: boolean; completed_at: string | null; next: string | null; done: number; total: number; inventory: boolean; manage?: boolean }

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
  /* What the rest of the screens are built from (the server always sends them; an older answer may not). */
  workshops?: WorkshopRow[];
  bays?: Bay[];
  service_types?: ServiceType[];
  rates?: Rate[];
  advisors?: { id: number; name: string }[];
  statuses?: Partial<Record<JobStatus, string>>;
  steps?: string[];
  bay_types?: string[];
  bay_statuses?: string[];
  bay_manual?: string[];
  skills?: string[];
  checkin?: CheckinConfig;
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

export interface Customer { id: number; name: string; phone: string | null; email: string | null; contact_person?: string | null; address?: string | null; tax_number?: string | null }

export interface VehicleBrief {
  id: number; vehicle_number: string; vin: string | null; vehicle_type: string; make: string | null; model: string | null; year: number | null;
  colour: string | null; odometer: number | null; client_id: number | null; customer_name: string | null; customer_phone: string | null;
  org_id?: number; variant?: string | null; fuel_type?: string | null;
  open?: { id: number; number: string; status: JobStatus }[];
}

export interface Note { id: number; body: string; visibility: 'INTERNAL' | 'CUSTOMER'; by: string | null; at: string }

export interface MediaItem { id: number; subject_type: string; subject_id: number | null; slot: string | null; mime: string; bytes: number; caption: string | null; visibility: 'INTERNAL' | 'CUSTOMER'; by: string | null; at: string; url: string }
export interface Activity { id: number; kind: string; text: string; at: string; job_id: number | null; by: string | null }

export interface Mark { id?: number; view: string; zone: string; kind: string; note: string | null; media_id: number | null }

export interface CheckinState {
  id: number | null; odometer: number | null; fuel_level: number | null; accessories: string[]; valuables: string;
  estimated_handover_at: string | null; requested_services: string | null; complaints: string[];
  conditions: Record<string, { value: string; note: string | null }>;
  marks: Mark[];
  photos: MediaItem[]; signer_name: string | null; signer_relation: string | null;
  signature: { id: number; name: string; relation: string | null; at: string; current: boolean } | null;
  completed_at: string | null; completed_by: string | null;
  missing?: { key: string; text: string }[];
}

export interface CheckinScreen { config: CheckinConfig; checkin: CheckinState; last_odometer: number | null; missing: { key: string; text: string }[]; editable: boolean; can: { odometer_override: boolean } }

export interface JobView {
  job: JobCard & {
    workshop: { id: number; name: string } | null; branch: { id: number; name: string } | null;
    requested_services: string | null; odometer_in: number | null; fuel_in: number | null; cancel_reason: string | null; source: string;
    pipeline?: string; waiting_reason?: string | null; service_advisor_id?: number | null; started_at?: string | null; cancelled_at?: string | null;
    cancel_note?: string | null; created_by?: string | null; step?: number;
  };
  customer: Customer | null;
  prefs?: { whatsapp: string | null; preferred_channel: string | null; notes: string | null };
  vehicle: VehicleBrief | null;
  checkin: (Partial<CheckinState> & { complaints: string[]; completed_at: string | null }) | null;
  diagnostics?: { id: number; complaint: string; source: string; finding: string | null; cause: string | null; recommendation: string | null; priority: string | null; no_fault: boolean; status: string }[];
  history: { from: string | null; to: string; label: string; waiting: string | null; reason: string | null; by: string | null; at: string }[];
  media?: MediaItem[];
  notes: Note[];
  activity?: Activity[];
  choices: { to: JobStatus; label: string }[];
  steps?: string[];
  cancel_reasons: string[];
  can: { edit: boolean; checkin: boolean; cancel: boolean; publish?: boolean; odometer_override?: boolean };
}

export interface VehicleJob {
  id: number; number: string; status: JobStatus; priority: Priority; job_type: string; checkin_at: string | null; completed_at: string | null; odometer: number | null;
  requested: string | null; total: number; target: string | null;
  /* On completed jobs (FR-HIS-01). */
  complaints?: string[]; repairs?: string[]; parts?: string[]; technicians?: string[]; invoice?: { number: string; status: string } | null;
  warranty_until?: string | null; warranty_km?: number | null; odometer_out?: number | null; parts_cost?: number | null; labour_minutes?: number;
}

export interface Vehicle360 {
  vehicle: VehicleBrief & {
    engine_number: string | null; transmission: string | null; engine_cc: number | null; engine_hours: number | null; driver_name: string | null; driver_phone: string | null;
    registration_date: string | null; insurance: Record<string, string | null> | null; warranty: Record<string, string | null> | null; notes: string | null; odometer_at: string | null;
  };
  customer: Customer | null;
  last_service: { job_id: number; number: string; at: string | null; odometer: number | null } | null;
  current_job: VehicleJob | null;
  open_jobs: VehicleJob[];
  history: VehicleJob[];
  mileage: { reading: number; source: string; at: string; override: string | null; job_id: number | null }[];
  km_per_day: number | null;
  owners: { client_id: number; name: string | null; from: string | null; to: string | null; note: string | null }[];
  photos: { id: number; job_id: number; number: string; slot: string | null; subject_type: string; visibility: string; at: string; url: string }[];
  notes: Note[];
  activity: Activity[];
  can: { manage: boolean; create_job: boolean; odometer_override: boolean };
}

export interface CustomerRow { id: number; name: string; phone: string | null; email: string | null; vehicles: number; open_jobs: number }

export interface CustomerView extends Customer {
  prefs: { whatsapp: string | null; preferred_channel: string | null; notes: string | null };
  vehicles: { id: number; vehicle_number: string; make: string | null; model: string | null; year: number | null; odometer: number | null }[];
  open_jobs: number; completed_jobs: number; outstanding: number | null;
}

export interface WorkshopData {
  branches: Branch[]; warehouses: { id: number; name: string; code: string; branch_id: number | null }[]; workshops: WorkshopRow[]; bays: Bay[];
  technicians: Technician[]; rates: Rate[]; service_types: ServiceType[]; models: Model[]; skills: string[]; manage: boolean; assign: boolean; financials: boolean;
  inspection_templates: InspectionTemplate[]; inspection_types: string[];
}

// ── inspections, diagnosis, estimates (part 2) ──────────────────────────

export type Light = 'GREEN' | 'AMBER' | 'RED' | 'PASS' | 'FAIL';

export interface InspectionItem {
  id: number; section: string; label: string; result_type: 'traffic' | 'passfail' | 'number' | 'text' | 'photo'; result: Light | null;
  value: string | null; unit: string | null; note: string | null; visibility: 'INTERNAL' | 'CUSTOMER'; media: number[];
}

export interface InspectionCounts { green: number; amber: number; red: number; open: number; total?: number }

export interface Inspection {
  id: number; job_id: number; inspection_type: string; status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'; summary: InspectionCounts | null;
  customer_note: string | null; internal_note?: string | null; inspector?: string; started_at: string | null; completed_at: string | null; items: InspectionItem[];
}

export interface TemplateItem { label: string; type: InspectionItem['result_type']; unit?: string | null; suggest?: { line_type?: string; description?: string; labour_minutes?: number } | null }
export interface InspectionTemplate { id: number; name: string; inspection_type: string; vehicle_type: string | null; brand: string | null; job_type: string | null; sections: { name: string; items: TemplateItem[] }[]; active: boolean }

export interface Recommendation {
  id: number; source_type: string; description: string; priority: 'RED' | 'AMBER' | 'GREEN'; status: 'OPEN' | 'ESTIMATED' | 'DEFERRED' | 'DECLINED';
  labour_minutes: number | null; product_id: number | null; estimate_line_id: number | null; due_date: string | null; due_km: number | null;
}

export interface InspectionsView {
  inspections: Inspection[]; recommendations: Recommendation[]; templates: InspectionTemplate[]; suggested: number | null; types: string[];
  can: { perform: boolean; publish: boolean; estimate: boolean };
}

export interface Finding {
  id: number; complaint: string; source: string; finding: string | null; cause: string | null; recommendation: string | null; labour_minutes: number | null;
  parts: { product_id: number | null; qty: number; description: string | null }[]; priority: 'RED' | 'AMBER' | 'GREEN' | null; no_fault: boolean;
  status: 'OPEN' | 'RESOLVED'; resolved_by: string | null; signed_off: boolean; signed_off_by: string | null;
}

export interface DiagnosisView {
  items: Finding[]; codes: { id: number; diagnostic_id: number | null; code: string; description: string | null; scanner: string | null; scanned_at: string | null }[];
  signoff_required: boolean; can: { create: boolean; signoff: boolean };
}

export type EstimateStatus = 'DRAFT' | 'PENDING_INTERNAL_APPROVAL' | 'SENT' | 'VIEWED' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | 'SUPERSEDED' | 'EXPIRED';
export type Decision = 'APPROVED' | 'REJECTED' | 'DEFERRED';

export interface EstimateLine {
  id: number; line_type: string; description: string; product_id: number | null; rate_class: string | null; labour_minutes: number | null; qty: number;
  unit_price: number; discount_pct: number; tax_rate: number; net: number; tax: number; total: number; coverage: string; priority: string | null;
  decision: 'PROPOSED' | Decision; availability: string | null; source_type: string | null;
}

export interface EstimateVersion {
  id: number; version: number; kind: 'MAIN' | 'SUPPLEMENTARY'; status: EstimateStatus; currency: string; subtotal: number; discount: number; tax: number; total: number; approved_total: number;
  deferred_total: number; valid_until: string | null; change_summary: string | null; sent_at: string | null; viewed_at: string | null; decided_at: string | null;
  created_at: string | null; created_by: string; lines: EstimateLine[];
}

export interface Approval { id: number; version: number; method: string; approver: string; note: string | null; outcome: string; approved_total: number; signed: boolean; decisions: Record<string, Decision>; at: string; recorded_by: string }

export interface EstimatesView {
  versions: EstimateVersion[]; approvals: Approval[]; recommendations: Recommendation[]; job_status: JobStatus; currency: string; rates: Rate[];
  line_types: string[]; coverage: string[]; discount_limit: number;
  can: { create: boolean; edit: boolean; send: boolean; record: boolean; discount_override: boolean };
}

export const AVAILABILITY_LABEL: Record<string, string> = { IN_STOCK: 'In stock', INCOMING: 'Arriving', PARTIAL: 'Part in stock', NEEDS_PURCHASE: 'Needs buying' };

export type WorkOrderStatus = 'PENDING' | 'READY' | 'ASSIGNED' | 'IN_PROGRESS' | 'PAUSED' | 'WAITING_PARTS' | 'COMPLETED' | 'QC_FAILED' | 'REWORK' | 'CANCELLED';

export interface WorkOrder {
  id: number; job_id: number; code: string; work_type: string; description: string | null; status: WorkOrderStatus; is_additional: boolean;
  estimated_minutes: number; logged_minutes: number; started_at: string | null; completed_at: string | null;
  required_skill?: string | null; actual_minutes?: number; cancel_reason?: string | null; slot?: { starts_at: string; ends_at: string; status: string } | null;
  bay: { id: number; code: string; name: string | null } | null;
  technicians: { id: number; name: string; role: 'LEAD' | 'ASSISTANT' | 'SPECIALIST'; user_id: number | null; running: boolean }[];
  lines: { id: number; type: string; description: string; qty: number; labour_minutes: number | null }[];
}

export type PartStatus = 'REQUESTED' | 'RESERVED' | 'PURCHASE_REQUESTED' | 'ISSUED' | 'PARTIALLY_RETURNED' | 'CONSUMED' | 'CANCELLED';

export interface PartUsage {
  id: number; job_id: number; work_order_id: number | null; product_id: number; description: string; source: 'ESTIMATE' | 'REQUEST'; status: PartStatus;
  approved_qty: number; requested_qty: number; reserved_qty: number; issued_qty: number; used_qty: number; returned_qty: number;
  urgency: 'LOW' | 'NORMAL' | 'URGENT'; reason: string | null; requested_by: string | null; created_at: string | null;
  unit_cost?: number | null; serial_no?: string | null; batch_no?: string | null; purchase_request_id?: number | null;
  job_number?: string; vehicle?: string;
}

export interface LabourEntry {
  id: number; work_order_id: number; technician_id: number; technician: string; started_at: string; ended_at: string | null; minutes: number; running: boolean;
  pause_reason: string | null; note: string | null; source: 'TIMER' | 'MANUAL' | 'OFFLINE_SYNC'; is_rework: boolean; is_billable: boolean; voided: boolean;
  corrected_from_id: number | null; reason: string | null;
}

export interface AdditionalWork {
  id: number; work_order_id: number | null; finding: string; priority: 'RED' | 'AMBER' | 'GREEN'; labour_minutes: number; parts: { product_id: number; qty: number }[];
  status: 'RAISED' | 'ESTIMATED' | 'APPROVED' | 'DECLINED'; estimate_id: number | null; raised_by: string | null; at: string | null;
}

/** A job's work (`GET jobs/{id}/work`); the job card's summary reads only the first three. */
export interface WorkView {
  job_status: JobStatus; work_orders: WorkOrder[]; parts: PartUsage[];
  labour?: LabourEntry[]; additional?: AdditionalWork[];
  removed?: { id: number; work_order_id: number | null; description: string; qty: number; disposition: string; note: string | null; at: string }[];
  me?: number | null; bays?: Bay[]; technicians?: Technician[]; skills?: string[]; pause_reasons?: string[]; conditions?: string[]; dispositions?: string[];
  can?: { assign: boolean; execute: boolean; request: boolean; issue: boolean; return: boolean; correct: boolean; price: boolean; override: boolean; financials: boolean };
}

// ── quality, road test, delivery (part 4) ───────────────────────────────

export interface QualityCheck {
  id: number; attempt: number; status: 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'REWORK_REQUIRED'; inspector_id: number | null; inspector: string | null;
  started_at: string | null; completed_at: string | null; fail_reason: string | null; note: string | null;
  items: { id: number; label: string; mandatory: boolean; result: 'PASS' | 'FAIL' | 'NA' | null; note: string | null }[];
}

export interface RoadTest {
  id: number; driver: string | null; start_km: number; end_km: number; minutes: number | null; route: string | null; issue_confirmed_fixed: boolean; repair_verified: boolean;
  new_issue: string | null; notes: string | null; result: 'PASSED' | 'FAILED'; at: string;
}

export interface ChargeLine { line_id: number; type: string; product_id: number | null; description: string; qty: number; approved_qty: number; unit_price: number; discount_pct: number; tax_rate: number; net: number; coverage: string }

export interface GarageInvoice { id: number; number: string | null; status: string; total: number; paid: number; credited: number; outstanding: number; currency: string; issue_date: string | null; due_date: string | null }

export interface DeliveryView {
  job_status: JobStatus; checks: QualityCheck[]; rework: { id: number; work_order_id: number; reason: string; check_id: number | null; road_test_id: number | null; completed_at: string | null; at: string }[];
  road_tests: RoadTest[]; road_test_needed: boolean; review: { key: string; label: string; ok: boolean; detail: string }[];
  work_orders: { id: number; code: string; work_type: string; status: WorkOrderStatus; technicians: WorkOrder['technicians'] }[];
  handover: {
    delivered_at: string; odometer_out: number; fuel_out: number | null; delivered_by: string | null; received_by: string; received_relation: string | null; items: string[];
    removed_returned: boolean; release_basis: 'PAID' | 'CREDIT' | 'OVERRIDE'; override_reason: string | null; notes: string | null;
  } | null;
  odometer_in: number | null; odometer_now: number | null; accessories: string[]; customer: string | null; client_id: number; me: number; self_qc: boolean;
  charges?: { lines: ChargeLine[]; covered: ChargeLine[]; total: number }; invoice?: GarageInvoice | null;
  release?: { basis: 'PAID' | 'CREDIT' | null; outstanding: number; credit_limit: number | null; owed_elsewhere: number; message: string };
  can: { perform: boolean; approve: boolean; road_test: boolean; complete: boolean; invoice: boolean; pay: boolean; override: boolean; credit: boolean; money: boolean };
}

// ── reports ─────────────────────────────────────────────────────────────

export interface ReportList { reports: { key: string; title: string; about: string }[]; export: boolean }
export interface Report { title: string; about: string; columns: { key: string; label: string; money?: boolean }[]; rows: Record<string, string | number | null>[] }

export type MyWorkItem = WorkOrder & { job_number: string; priority: Priority; target: string | null; job_status: JobStatus; vehicle: string; my_role: string; my_technician_id: number };

export interface MyWork { technician: boolean; running: { work_order_id: number; started_at: string } | null; work: MyWorkItem[]; pause_reasons: string[] }

export interface PartHit { id: number; code: string | null; name: string; unit_price: number; availability: string | null; tax_rate?: number; unit?: string | null }

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

/** 2500 → "LKR 2,500.00"; a dash for nothing. Figures are the server's; this only writes them. */
export function money(v: number | null | undefined, currency = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${currency ? `${currency} ` : ''}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** For a `datetime-local` field, from a UTC stamp; and back to an ISO moment. */
export function toLocalInput(s: string | null | undefined): string {
  if (!s) return '';
  const t = utc(s);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** A fuel level as the gauge reads (the check-in's steps). */
export const FUEL_LABEL: Record<number, string> = { 0: 'Empty', 25: '¼', 50: '½', 75: '¾', 100: 'Full' };

/** What a refusal's `errors` names as its code (`odometer_reason`, `discount`, `setup`…). */
export function codeOf(e: unknown): string | null {
  const c = errorData<{ code?: unknown }>(e)?.code;
  return typeof c === 'string' ? c : null;
}
