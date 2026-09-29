import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, apiGetMeta, request, type ApiResult } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { currentZone, wallToUtc } from '../../core/time';

/**
 * Garage & Vehicle Service Center (the server's `/api/garage/*`, WS-GARAGE-SRS-001
 * P1 stage A): the same JSON API the office web page uses, through the main
 * process's proxy — the renderer never holds a token.
 *
 * THE SERVER DECIDES (C9). Every status, label, guard sentence and figure is
 * the server's. A job's moves are the `transitions` it sends with the job
 * card, and a board drop is a request: the card stays where it is until the
 * server says yes, and its refusal is shown as it was written.
 *
 * PERMISSIONS ARE PER COMPANY. `GET options` says, per company, what the
 * reader may do there (`can`). Screens hide what nobody may do; the server
 * still refuses whatever slips through (403, or 404 for what is not theirs
 * to see).
 *
 * WRITES ARE ONLINE ONLY. Lists, the board and the overview are read from the
 * offline copy when WorkSuite cannot be reached (READ_CACHE); a write needs
 * the server — the check-in, the state machine and the numbering are its.
 */

const BASE = '/api/garage';

// ── the shapes, as the server sends them ────────────────────────────────

/** What each company lets the reader do — `GET options` → `companies[].can`. */
export type CanKey =
  | 'dashboard'
  | 'view'
  | 'create'
  | 'edit'
  | 'assign'
  | 'start'
  | 'complete'
  | 'cancel'
  | 'vehicles'
  | 'manage_vehicles'
  | 'checkin'
  | 'inspect'
  | 'diagnose'
  | 'estimates'
  | 'approve'
  | 'work'
  | 'parts_request'
  | 'parts_issue'
  | 'qc'
  | 'reports'
  | 'settings'
  | 'money'
  | 'publish_media'
  | 'override_odometer';

export type Labels = Record<string, string>;

export interface Branch {
  branch_id: number;
  name: string;
  code: string | null;
  enabled: boolean;
  warehouse_id: number | null;
  price_list_id: number | null;
  labor_rate_id: number | null;
  hours: Record<string, [string, string]> | null;
}

export interface Company {
  id: number;
  name: string;
  currency: string;
  today: string;
  distance_unit: string;
  setup_complete: boolean;
  branches: Branch[];
  can: Partial<Record<CanKey, boolean>>;
}

export interface Options {
  companies: Company[];
  scope: string;
  my_branches: number[];
  statuses: Labels;
  columns: Record<string, { label: string; statuses: string[] }>;
  priorities: Labels;
  job_types: Labels;
  sources: Labels;
  waiting_reasons: Labels;
  cancel_reasons: Labels;
  vehicle_types: Labels;
  fuels: Labels;
  transmissions: Labels;
  odometer_sources: Labels;
  checkin: {
    areas: Labels;
    conditions: Labels;
    damage_marks: Labels;
    views: Labels;
    photo_slots: Labels;
    complaints: Labels;
    fuel_marks: Record<string, number>;
    requirable: Labels;
  };
  media_contexts: Labels;
  bay_types: Labels;
  bay_statuses: Labels;
  rate_types: Labels;
  default_skills: Labels;
}

export interface CustomerBrief {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface JobVehicle {
  id: number;
  vehicle_number: string;
  make: string | null;
  model: string | null;
  make_model: string | null;
  year: number | null;
  colour: string | null;
  vehicle_type: string;
  odometer: number | null;
  fleet: boolean;
}

export interface Person {
  id: number;
  name: string | null;
}

/** A job as lists, the board and a customer's history show it. */
export interface Job {
  id: number;
  org_id: number;
  branch_id: number | null;
  number: string;
  status: string;
  status_label: string;
  column: string | null;
  waiting_reason: string | null;
  priority: string;
  job_type: string;
  source: string;
  vehicle: JobVehicle | null;
  customer: CustomerBrief | null;
  service_advisor: Person | null;
  technicians: Array<Person & { role: string }>;
  bay: { id: number; code: string; name: string } | null;
  requested_work: string | null;
  target_completion_at: string | null;
  overdue: boolean;
  checkin_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  version: number;
}

export interface Transition {
  to: string;
  label: string;
  on: string;
  allowed: boolean;
  why: string | null;
  needs: string[];
}

export interface Media {
  id: number;
  kind: 'photo' | 'video' | 'document';
  mime: string | null;
  name: string | null;
  bytes: number | null;
  context: string;
  context_id: number | null;
  slot: string | null;
  caption: string | null;
  visibility: 'internal' | 'customer';
  client_temp_id: string | null;
  taken_at: string | null;
  created_at: string | null;
  by: Person | null;
  url: string;
}

export interface DamageMark {
  id?: number;
  view: string;
  zone: string;
  mark: string;
  x: number | null;
  y: number | null;
  note: string | null;
  media_id: number | null;
}

export interface Checkin {
  status: 'draft' | 'completed' | 'not_started';
  odometer: number | null;
  fuel_level: number | null;
  complaints: Array<{ id: number; text: string; quick_pick: string | null }>;
  requested_services: string[];
  conditions: Array<{ area: string; value: string; note: string | null }>;
  damage: DamageMark[];
  accessories: string[];
  valuables: string | null;
  estimated_handover_at: string | null;
  signer: { name: string; relation: string | null; signed: boolean } | null;
  photos: Media[];
  completed_at: string | null;
  missing: string[];
}

export interface Note {
  id: number;
  body: string;
  visibility: 'internal' | 'customer';
  work_order_id: number | null;
  by: Person | null;
  at: string | null;
}

export interface TimelineRow {
  id: number;
  at: string | null;
  event: string;
  summary: string;
  job_id: number | null;
  by: Person | null;
  data: unknown;
}

/** Job 360° — `GET jobs/{id}`. Stage B adds its own keys (inspections, estimate, work orders…) beside these. */
export interface Job360 extends Job {
  pipeline: { code: string; name: string; version: number; inspection_required: boolean; express: boolean; road_test_required: boolean } | null;
  workshop: { id: number; code: string; name: string } | null;
  service_type: { id: number; code: string; name: string } | null;
  notes: string | null;
  odometer_in: number | null;
  fuel_level: number | null;
  started_at: string | null;
  currency: string;
  totals: { estimate: string | null; approved: string | null; final: string | null } | null;
  invoice_id: number | null;
  cancel: { code: string; reason: string | null; at: string | null; by: Person | null } | null;
  checkin: Checkin;
  diagnostics: Array<{ id: number; complaint_id: number | null; complaint: string | null; finding: string | null; cause: string | null; recommended_repair: string | null; priority: string | null; status: string; signed_off_at: string | null }>;
  media: Media[];
  job_notes: Note[];
  status_history: Array<{ from: string | null; to: string; label: string; via: string | null; waiting_reason: string | null; reason: string | null; by: Person | null; at: string | null }>;
  timeline: TimelineRow[];
  transitions: Transition[];
  can: { edit: boolean; checkin: boolean; cancel: boolean; assign: boolean; publish_media: boolean; override_odometer: boolean };
  [stageKey: string]: unknown;
}

export interface BoardColumn {
  code: string;
  label: string;
  statuses: string[];
  count: number;
  jobs: Job[];
}

export interface Bay {
  id: number;
  org_id: number;
  branch_id: number | null;
  code: string;
  name: string;
  bay_type: string;
  status: string;
  status_label: string;
  status_reason: string | null;
  job: Job | null;
}

export interface BoardData {
  columns: BoardColumn[];
  bays: Bay[];
  updated_at: string | null;
}

export type Kpi = { value: number | null; total?: number; filter: Record<string, string> | null };
export interface Dashboard {
  kpis: Record<string, Kpi>;
  /**
   * Stage B3: Billing's issued garage invoices by issue date, per currency, in
   * the companies where the reader may see money; null for everybody else and
   * absent on an older server.
   */
  revenue?: { date: string; today: Array<{ currency: string; amount: string }>; month: Array<{ currency: string; amount: string }>; invoices_today: number } | null;
}

export interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  account_type: string | null;
  vehicles: number;
  open_jobs: number;
}

export interface CustomerDetail {
  customer: CustomerBrief & { contact_person: string | null; address: string | null; account_type: string | null; tax_number: string | null; whatsapp: string | null; preferred_contact: string | null; crm_link: string | null };
  vehicles: Array<{ id: number; vehicle_number: string; vin: string | null; make: string | null; model: string | null; year: number | null; customer_id: number }>;
  open_jobs: Job[];
  history: Job[];
  balance: { outstanding: number; currency: string; overdue: number } | null;
}

export interface VehicleBrief {
  id: number;
  org_id?: number;
  vehicle_number: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  customer_id: number | null;
  customer: CustomerBrief | { name: string } | null;
  open_job: { id: number; job_number: string; status: string } | null;
  matched?: 'number' | 'vin';
}

export interface Reading {
  id: number;
  reading: number;
  source: string;
  job_id: number | null;
  override_reason: string | null;
  by: Person | null;
  at: string | null;
}

export interface Vehicle {
  id: number;
  org_id: number;
  branch_id: number | null;
  vehicle_number: string;
  vin: string | null;
  engine_number: string | null;
  vehicle_type: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  make_model: string | null;
  year: number | null;
  colour: string | null;
  fuel_type: string | null;
  transmission: string | null;
  engine_capacity_cc: number | null;
  engine_hours: number | null;
  odometer: number | null;
  odometer_unit: 'km' | 'mi';
  odometer_updated_at: string | null;
  customer_id: number | null;
  registration_date: string | null;
  insurance: { insurer: string | null; policy: string | null; expires_on: string | null } | null;
  warranty: { provider: string | null; until: string | null; until_km: number | null; notes: string | null } | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  customer: CustomerBrief | null;
  readings: Reading[];
  owners: Array<{ customer_id: number; customer: string | null; from: string | null; to: string | null }>;
  open_job: { id: number; job_number: string; status: string } | null;
}

export interface Vehicle360 {
  header: {
    vehicle: Vehicle;
    customer: CustomerBrief | null;
    mileage: number | null;
    last_service: { job_id: number; number: string; odometer: number | null; date: string | null } | null;
    next_service: unknown;
    current_job: Job | null;
  };
  /** Stage A's rows; stage B3 sends its fuller history rows here (`api-b3` HistoryRow). */
  service_history: Array<{ job_id: number; number: string; date: string | null; odometer: number | null; job_type: string | null; service_type: string | null; complaints: string[]; technicians: Array<string | { id?: number; name: string | null; role?: string | null }>; invoice_id: number | null }>;
  open_jobs: Job[];
  inspections: Array<{ id: number; job_id: number; type: string; status: string; completed_at: string | null; summary: unknown }>;
  repairs: Array<{ job_id: number; line_type: string; description: string; qty: string | number; decision: string }>;
  parts_replaced: Array<{ job_id: number; product_id: number; name: string; qty: string | number; serial_no: string | null; date: string | null }>;
  mileage: { readings: Reading[]; per_day: number | null };
  invoices: Array<{ invoice_id: number; job_id: number; number: string | null; status: string; issue_date: string | null; currency?: string; total?: string }>;
  warranty: { available: boolean; items: unknown[] };
  /** Each piece of work once: an estimate line (`item_id`) or an inspection item left for later (`inspection_item_id`); key by `source` and id. */
  deferred: Array<{ source?: 'estimate' | 'inspection'; item_id: number | null; inspection_item_id?: number | null; job_id: number; line_type: string; description: string; vhc: string | null; decided_at: string | null; follow_up_on?: string | null }>;
  media: Array<Media & { job_id: number }>;
  notes: Array<{ id: number; job_id: number; body: string; visibility: string; by: Person | null; at: string | null }>;
  owners: Array<{ customer_id: number; customer: string | null; from: string | null; to: string | null }>;
  activity: TimelineRow[];
}

export interface Paged<T> {
  items: T[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

export interface WizardStep {
  key: string;
  title: string;
  required: boolean;
  status: 'done' | 'pending' | 'skipped' | 'default' | 'later';
  number: number;
}

export interface Wizard {
  org_id: number;
  may_manage: boolean;
  complete: boolean;
  required_left: number;
  steps: WizardStep[];
}

// ── reading ─────────────────────────────────────────────────────────────

type Query = Record<string, string | number | boolean | null | undefined>;

export const K = {
  all: ['garage'] as const,
  options: ['garage', 'options'] as const,
  dashboard: (org: string, branch: string) => ['garage', 'dashboard', org, branch] as const,
  board: (org: string, f: object) => ['garage', 'board', org, f] as const,
  jobs: (org: string, f: object) => ['garage', 'jobs', org, f] as const,
  job: (id: number) => ['garage', 'job', id] as const,
  customers: (org: string, q: string) => ['garage', 'customers', org, q] as const,
  customer: (id: number) => ['garage', 'customer', id] as const,
  vehicles: (org: string, f: object) => ['garage', 'vehicles', org, f] as const,
  vehicle: (id: number) => ['garage', 'vehicle', id] as const,
  vehicle360: (id: number) => ['garage', 'vehicle360', id] as const,
  search: (org: string, q: string) => ['garage', 'walk-in', org, q] as const,
  wizard: (org: number) => ['garage', 'setup', org] as const,
  records: (kind: string, org: number) => ['garage', 'setup', kind, org] as const,
  branches: (org: number) => ['garage', 'setup', 'branches', org] as const,
  pipelines: (org: number) => ['garage', 'pipelines', org] as const,
};

const withOrg = (org: string | number | null | undefined, rest: Query = {}): Query => ({ ...(org ? { org: String(org) } : {}), ...rest });

export function fetchOptions(signal?: AbortSignal): Promise<ApiResult<Options>> {
  return apiGetMeta<Options>(`${BASE}/options`, undefined, signal);
}

/** The options every screen starts from: the companies, what the reader may do in each, and every list of choices. */
export function useOptions() {
  return useQuery({ queryKey: K.options, queryFn: ({ signal }) => fetchOptions(signal), staleTime: 5 * 60_000 });
}

export function fetchDashboard(org: string, branch: string, signal?: AbortSignal) {
  return apiGetMeta<Dashboard>(`${BASE}/dashboard`, withOrg(org, { branch_id: branch || undefined }), signal);
}

export interface BoardFilters {
  branch_id?: string;
  advisor?: string;
  technician?: string;
  priority?: string;
  q?: string;
}

export function fetchBoard(org: string, f: BoardFilters, signal?: AbortSignal) {
  return apiGetMeta<BoardData>(`${BASE}/board`, withOrg(org, { ...f }), signal);
}

/** The filters `GET jobs` takes, as route parameters carry them (a dashboard tile's `filter`, a rail list). */
export const JOB_FILTERS = ['status', 'column', 'branch_id', 'workshop_id', 'advisor', 'technician', 'mine', 'overdue', 'priority', 'vehicle_id', 'customer_id', 'started', 'from', 'to', 'q'] as const;
export type JobFilter = Partial<Record<(typeof JOB_FILTERS)[number], string>>;

/** The job-list filter a route carries: only the keys `GET jobs` knows, and nothing empty. */
export function jobFilterOf(query: URLSearchParams): JobFilter {
  const out: JobFilter = {};
  for (const k of JOB_FILTERS) {
    const v = query.get(k);
    if (v !== null && v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

/** A job-list filter (a tile's, a rail item's) as the route that shows it. */
export function jobsRoute(filter: Record<string, string> | null | undefined, list?: string): string {
  const q = new URLSearchParams({ view: 'jobs' });
  if (list) q.set('list', list);
  for (const [k, v] of Object.entries(filter ?? {})) if ((JOB_FILTERS as readonly string[]).includes(k) && v !== '') q.set(k, v);
  return `/garage?${q.toString()}`;
}

export function fetchJobs(org: string, f: JobFilter & { page?: number; per_page?: number }, signal?: AbortSignal) {
  return apiGetMeta<Paged<Job>>(`${BASE}/jobs`, withOrg(org, { ...f }), signal);
}

export function fetchJob(id: number, signal?: AbortSignal) {
  return apiGetMeta<{ job: Job360 }>(`${BASE}/jobs/${id}`, undefined, signal);
}

export function fetchTimeline(id: number, signal?: AbortSignal) {
  return apiGet<{ items: TimelineRow[] }>(`${BASE}/jobs/${id}/timeline`, undefined, signal);
}

export function searchWalkIn(org: string, q: string, signal?: AbortSignal) {
  return apiGet<{ customers: CustomerRow[]; vehicles: VehicleBrief[] }>(`${BASE}/walk-in/search`, withOrg(org, { q }), signal);
}

export function fetchCustomers(org: string, q: string, signal?: AbortSignal) {
  return apiGetMeta<{ items: CustomerRow[] }>(`${BASE}/customers`, withOrg(org, { q: q || undefined, limit: 100 }), signal);
}

export function fetchCustomer(id: number, signal?: AbortSignal) {
  return apiGet<CustomerDetail>(`${BASE}/customers/${id}`, undefined, signal);
}

export function fetchVehicles(org: string, f: { q?: string; customer_id?: string; page?: number }, signal?: AbortSignal) {
  return apiGetMeta<Paged<VehicleBrief & { make_model?: string | null; odometer?: number | null }>>(`${BASE}/vehicles`, withOrg(org, { ...f }), signal);
}

export function lookupVehicles(org: string | number, number: string, vin: string, signal?: AbortSignal) {
  return apiGet<{ items: VehicleBrief[] }>(`${BASE}/vehicles/lookup`, withOrg(org, { number: number || undefined, vin: vin || undefined }), signal);
}

export function fetchVehicle(id: number, signal?: AbortSignal) {
  return apiGet<{ vehicle: Vehicle }>(`${BASE}/vehicles/${id}`, undefined, signal);
}

export function fetchVehicle360(id: number, signal?: AbortSignal) {
  return apiGet<Vehicle360>(`${BASE}/vehicles/${id}/360`, undefined, signal);
}

export function fetchWizard(org: number, signal?: AbortSignal) {
  return apiGet<Wizard>(`${BASE}/setup`, { org }, signal);
}

export function fetchRecords<T = SetupRecord>(kind: string, org: number, signal?: AbortSignal) {
  return apiGet<{ items: T[] }>(`${BASE}/setup/${kind}`, { org }, signal);
}

export function fetchBranches(org: number, signal?: AbortSignal) {
  return apiGet<{ items: Branch[]; warehouses: Array<{ id: number; name: string }> }>(`${BASE}/setup/branches`, { org }, signal);
}

export function fetchCandidates(org: number, signal?: AbortSignal) {
  return apiGet<{ items: Person[] }>(`${BASE}/setup/technicians/candidates`, { org }, signal);
}

export function fetchPipelines(org: number, signal?: AbortSignal) {
  return apiGet<{ items: Array<{ org_id: number; id: number; code: string; name: string; express: boolean; inspection_required: boolean; is_default: boolean; active: boolean }> }>(`${BASE}/pipelines`, { org }, signal);
}

/** The address a media row's bytes are read from (an `<img>`, a download). */
export function mediaPath(m: Pick<Media, 'id'>): string {
  return `${BASE}/media/${m.id}`;
}

export type SetupRecord = Record<string, unknown> & { id: number; org_id: number; active?: boolean };

// ── writing ─────────────────────────────────────────────────────────────

/** A write, with the job version it was based on when it changes a job (`If-Match`). */
async function write<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, version?: number | null): Promise<ApiResult<T>> {
  return request<T>(method, `${BASE}${path}`, { body, headers: version !== undefined && version !== null ? { 'If-Match': String(version) } : undefined });
}

export const transition = (id: number, body: { to?: string; column?: string; reason?: string; reason_code?: string; waiting_reason?: string }, version?: number | null) =>
  write<{ job: Job360 | null }>('POST', `/jobs/${id}/transition`, body, version);
export const cancelJob = (id: number, body: { reason_code: string; reason?: string }, version?: number | null) => write<{ job: Job360 | null }>('POST', `/jobs/${id}/cancel`, body, version);
export const patchJob = (id: number, body: Record<string, unknown>, version?: number | null) => write<{ job: Job360 | null }>('PATCH', `/jobs/${id}`, body, version);
export const saveCheckin = (id: number, body: Record<string, unknown>) => write<{ job: Job360 | null }>('POST', `/jobs/${id}/checkin`, body);
export const addNote = (id: number, body: { body: string; visibility: 'internal' | 'customer' }) => write<{ job: Job360 | null }>('POST', `/jobs/${id}/notes`, body);
export const setMediaVisibility = (id: number, visibility: 'internal' | 'customer') => write<{ media: Media }>('PATCH', `/media/${id}`, { visibility });
export const removeMedia = (id: number) => write<unknown>('DELETE', `/media/${id}`);
export const walkIn = (body: Record<string, unknown>) => write<{ job: Job360; added?: Added }>('POST', '/walk-in', body);
export const createCustomer = (body: Record<string, unknown>) => write<{ customer: CustomerBrief }>('POST', '/customers', body);
export const createVehicle = (body: Record<string, unknown>) => write<{ vehicle: Vehicle }>('POST', '/vehicles', body);
export const updateVehicle = (id: number, body: Record<string, unknown>) => write<{ vehicle: Vehicle }>('PUT', `/vehicles/${id}`, body);
export const recordOdometer = (id: number, body: { reading: number; override_reason?: string }) => write<{ vehicle: Vehicle }>('POST', `/vehicles/${id}/odometer`, body);
export const markStep = (step: string, org: number, action: 'skip' | 'done' | 'reopen') => write<Wizard>('POST', `/setup/steps/${step}`, { org_id: org, action });
export const saveBranch = (branchId: number, body: Record<string, unknown>) => write<unknown>('PUT', `/setup/branches/${branchId}`, body);
export const saveRecord = (kind: string, id: number | null, body: Record<string, unknown>) =>
  id ? write<{ item: SetupRecord }>('PUT', `/setup/${kind}/${id}`, body) : write<{ item: SetupRecord }>('POST', `/setup/${kind}`, body);

/**
 * A photo, video or document onto a job (multipart, `POST jobs/{id}/media`).
 * `client_temp_id` makes a second press after a dropped connection the same
 * file, never another.
 */
export function uploadMedia(jobId: number, file: Blob, name: string, meta: { context: string; slot?: string | null; caption?: string | null; context_id?: number | null; clientTempId: string }) {
  const form = new FormData();
  form.append('file', file, name);
  form.append('context', meta.context);
  if (meta.slot) form.append('slot', meta.slot);
  if (meta.caption) form.append('caption', meta.caption);
  if (meta.context_id) form.append('context_id', String(meta.context_id));
  form.append('client_temp_id', meta.clientTempId);
  form.append('taken_at', new Date().toISOString());
  return request<{ media: Media; duplicate: boolean }>('POST', `${BASE}/jobs/${jobId}/media`, { body: form });
}

/** What the proxy carries in one request; a larger file goes up from the web or the phone. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function tempId(): string {
  return `desktop-${crypto.randomUUID()}`;
}

// ── refusals ────────────────────────────────────────────────────────────

export interface Added {
  customer?: CustomerBrief;
  vehicle?: VehicleBrief | Vehicle;
}

/** What a refusal carries for a screen to act on (the contract's `errors`). */
export interface Refusal {
  status: number;
  message: string;
  field: string | null;
  missing: string[];
  code: string | null;
  existing: { id: number; name?: string; vehicle_number?: string; phone?: string | null; email?: string | null } | null;
  openJob: { id: number; job_number: string; status: string } | null;
  added: Added | null;
  server: Job360 | null;
  offline: boolean;
}

export function refusalOf(e: unknown): Refusal {
  const api = e instanceof ApiError ? e : null;
  const d = (api?.data && typeof api.data === 'object' ? api.data : {}) as Record<string, unknown>;
  const obj = <T>(v: unknown): T | null => (v && typeof v === 'object' ? (v as T) : null);
  return {
    status: api?.status ?? 0,
    message: e instanceof Error ? e.message : String(e),
    field: typeof d.field === 'string' ? d.field : null,
    missing: Array.isArray(d.missing) ? d.missing.map(String) : [],
    code: typeof d.code === 'string' ? d.code : null,
    existing: obj(d.existing),
    openJob: obj(d.open_job),
    added: obj(d.added),
    server: obj(d.server),
    offline: api?.offline ?? false,
  };
}

// ── permissions ─────────────────────────────────────────────────────────

/** Whether the reader may do this in that company. */
export function canIn(options: Options | undefined, orgId: number | null | undefined, key: CanKey): boolean {
  return !!options?.companies.find((c) => c.id === orgId)?.can[key];
}

/** Whether the reader may do this in any company in view (`org` narrows to one; '' is every company). */
export function canAny(options: Options | undefined, key: CanKey, org = ''): boolean {
  return (options?.companies ?? []).some((c) => (!org || String(c.id) === org) && !!c.can[key]);
}

/** The companies in view where the reader may do this. */
export function companiesWhere(options: Options | undefined, key: CanKey, org = ''): Company[] {
  return (options?.companies ?? []).filter((c) => (!org || String(c.id) === org) && !!c.can[key]);
}

/**
 * Companies whose garage is not set up yet, for somebody who may set it up
 * (FR-APP-04): they are sent to the wizard until the minimum is done.
 */
export function needsSetup(options: Options | undefined, org = ''): Company[] {
  return (options?.companies ?? []).filter((c) => (!org || String(c.id) === org) && !c.setup_complete && !!c.can.settings);
}

/**
 * Whether the reader may add a customer: a customer is a CRM account, so
 * besides the garage's own permission it takes CRM's `crm.account` (WorkSuite
 * grants it installation-wide; the server checks it again).
 */
export function useMayAddCustomer(): boolean {
  return useStore(app, (s) => {
    const p = s.bootstrap?.permissions ?? [];
    return p.includes('*') || p.includes('crm.account');
  });
}

// ── connection ──────────────────────────────────────────────────────────

/** Whether WorkSuite can be reached: writes wait for it (the status bar says the same). */
export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export const OFFLINE_WRITE = 'You are offline. This needs WorkSuite; try again once you are back online.';

// ── saying things ───────────────────────────────────────────────────────

/** "84,250 km" — grouped digits and the company's unit; a dash for no reading. */
export function distance(n: number | null | undefined, unit = 'km'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${Math.round(n).toLocaleString('en-US')} ${unit}`;
}

/** The fuel level's nearest mark ("1/2") for a 0–100 figure. */
export function fuelMark(level: number | null | undefined, marks: Record<string, number>): string | null {
  if (level === null || level === undefined) return null;
  let best: string | null = null;
  let gap = Infinity;
  for (const [k, v] of Object.entries(marks)) {
    const g = Math.abs(v - level);
    if (g < gap) {
      gap = g;
      best = k;
    }
  }
  return best;
}

export type Tone = 'blue' | 'amber' | 'red' | 'green' | 'grey' | 'violet';

/**
 * One colour rule for every status (SRS §28 design notes): blue in progress,
 * amber waiting or needing attention, red overdue or failed, green done,
 * violet QC and additional work — and always with the server's label beside it.
 */
export function statusTone(status: string): Tone {
  if (status === 'completed' || status === 'ready_for_delivery') return 'green';
  if (status === 'cancelled') return 'grey';
  if (status === 'quality_check' || status === 'road_test' || status === 'additional_approval_required') return 'violet';
  if (['awaiting_customer_approval', 'waiting_parts', 'paused', 'approved', 'invoice_pending', 'draft', 'estimate_preparation'].includes(status)) return 'amber';
  return 'blue';
}

export function priorityTone(p: string): Tone | null {
  return p === 'urgent' ? 'red' : p === 'high' ? 'amber' : p === 'low' ? 'grey' : null;
}

/** "Toyota Prius · WP CAB-1234", leaving out what is not recorded. */
export function vehicleLine(v: Pick<JobVehicle, 'make_model' | 'make' | 'model' | 'vehicle_number'> | null | undefined): string {
  if (!v) return 'No vehicle';
  const model = v.make_model ?? [v.make, v.model].filter(Boolean).join(' ');
  return [model || null, v.vehicle_number].filter(Boolean).join(' · ');
}

/** A decimal the server sent as text ("12345.5"), grouped as text — never through a float; a dash for none. */
export function amount(v: string | number | null | undefined, currency?: string | null): string {
  if (v === null || v === undefined || v === '') return '—';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v).trim());
  if (!m) return String(v);
  const whole = m[2]!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = ((m[3] ?? '') + '00').slice(0, 2);
  return `${currency ? `${currency} ` : ''}${m[1]}${whole}.${cents}`;
}

/** A `datetime-local` value (the reader's clock) as the instant it names, ISO with Z; null for none. */
export function localToIso(v: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return wallToUtc(m[1]!, Number(m[2]) * 60 + Number(m[3]), currentZone());
}

/** An instant as a `datetime-local` value on the reader's clock. */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: currentZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '00';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}
