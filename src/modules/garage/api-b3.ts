import { apiGet, request, type ApiResult } from '../../core/api';
import { amount, type Job, type Job360, type Paged, type Person } from './api';

/**
 * Garage stage B3 (`web-api-b3.md`): parts through Inventory (request,
 * reserve, issue at the counter — by scan —, used, returned, removed parts),
 * quality control and rework, road tests, the final review, the invoice
 * through Billing (once), the release check, the signed handover, service
 * history and the reports. Every quantity is a copy of what Inventory did and
 * every amount is Billing's; nothing is counted or priced here.
 */
const BASE = '/api/garage';

// ── parts ───────────────────────────────────────────────────────────────

export interface Usage {
  id: number;
  approved: number;
  requested: number;
  reserved: number;
  issued: number;
  used: number;
  returned: number;
  to_reconcile: number;
  batch_no: string | null;
  serial_no: string | null;
  return_condition: string | null;
  issued_by: Person | null;
  issued_to: Person | null;
  issued_at: string | null;
  unit_cost?: string;
}

export interface PartRequest {
  id: number;
  job_id: number;
  status: string;
  status_label: string;
  product: { id: number; name: string; code: string | null; unit: string | null; tracking: 'none' | 'serial' | 'batch' };
  qty: number;
  reason: string | null;
  urgency: 'normal' | 'urgent';
  work_order_id: number | null;
  estimate_item_id: number | null;
  warehouse_id: number | null;
  reservation_id: number | null;
  requisition_ref: string | null;
  rejected_reason: string | null;
  requested_by: Person | null;
  requested_at: string | null;
  usage: Usage | null;
}

export interface RemovedPart {
  id: number;
  description: string;
  usage_id: number | null;
  disposition: string | null;
  disposition_label: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: Person | string | null;
  note: string | null;
  by: Person | string | null;
  at: string | null;
}

export interface PartsTab {
  warehouse_id: number | null;
  requests: PartRequest[];
  balance: Array<{ product_id: number; name: string; code: string | null; approved: number; requested: number; reserved: number; issued: number; used: number; returned: number; beyond_approved: number }>;
  unrequested: Array<{ estimate_item_id: number; line_key: string; product_id: number; description: string; qty: number }>;
  removed: RemovedPart[];
  can: { request: boolean; reserve: boolean; issue: boolean; return: boolean; override: boolean; removed: boolean };
}

export interface PartsOptions {
  statuses: Record<string, string>;
  urgency: Record<string, string>;
  return_conditions: Record<string, string>;
  dispositions: Record<string, string>;
}

export interface QueueItem {
  id: number;
  status: string;
  status_label: string;
  urgency: string;
  qty: number;
  reason: string | null;
  requisition_ref: string | null;
  job: { id: number; number: string; status: string; vehicle: string };
  product: { id: number; name: string; code: string | null };
  warehouse_id: number | null;
  available: number | null;
  work_order_id: number | null;
  requested_at: string | null;
  age_days: number;
}

export interface ScanAnswer {
  job: Job;
  product: { id: number; name: string; code: string | null; tracking: string; unit: string | null };
  serial_no: string | null;
  request: { id: number; status: string; qty: number; reserved_outstanding: number } | null;
  approved: number;
  issued: number;
  available: number | null;
  warehouse_id: number | null;
  over_approved: boolean;
  why: string | null;
}

export const KB3 = {
  partsOptions: ['garage', 'parts', 'options'] as const,
  parts: (jobId: number) => ['garage', 'job', jobId, 'parts'] as const,
  queue: (org: string, f: object) => ['garage', 'parts-queue', org, f] as const,
  qc: (jobId: number) => ['garage', 'job', jobId, 'qc'] as const,
  roadTests: (jobId: number) => ['garage', 'job', jobId, 'road-tests'] as const,
  review: (jobId: number, present: boolean) => ['garage', 'job', jobId, 'final-review', present] as const,
  invoice: (jobId: number) => ['garage', 'job', jobId, 'invoice'] as const,
  release: (jobId: number) => ['garage', 'job', jobId, 'release'] as const,
  reports: ['garage', 'reports'] as const,
  report: (key: string, q: object) => ['garage', 'report', key, q] as const,
  vehicleHistory: (id: number) => ['garage', 'vehicle', id, 'history'] as const,
  customerHistory: (id: number) => ['garage', 'customer', id, 'history'] as const,
};

async function write<T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>(method, `${BASE}${path}`, { body });
}

type WithJob<T = unknown> = T & { job: Job360 };

export const fetchPartsOptions = (signal?: AbortSignal) => apiGet<PartsOptions>(`${BASE}/parts/options`, undefined, signal);
export const fetchParts = (jobId: number, signal?: AbortSignal) => apiGet<{ parts: PartsTab }>(`${BASE}/jobs/${jobId}/parts`, undefined, signal);
export const fetchPartsCatalogue = (jobId: number, q: string, signal?: AbortSignal) =>
  apiGet<{ items: Array<{ id: number; code: string | null; barcode: string | null; name: string; unit: string | null; tracking: string; available: number | null; approved: number }> }>(`${BASE}/jobs/${jobId}/parts/catalogue`, { q }, signal);
export const fetchQueue = (org: string, f: { status?: string; urgency?: string; q?: string; page?: number }, signal?: AbortSignal) => apiGet<Paged<QueueItem>>(`${BASE}/parts/queue`, { org: org || undefined, ...f }, signal);
export const scanPart = (job: string, code: string, qty: string, signal?: AbortSignal) => apiGet<ScanAnswer>(`${BASE}/parts/scan`, { job, code, qty: qty || undefined }, signal);

export const requestPart = (jobId: number, body: { product_id?: number; code?: string; qty: number; reason?: string; urgency?: string; work_order_id?: number | null; client_temp_id: string }) =>
  write<WithJob<{ request: PartRequest; duplicate: boolean }>>('POST', `/jobs/${jobId}/parts/requests`, body);
export const reserveApproved = (jobId: number) => write<WithJob<{ result: { created: number; reserved: number; short: Array<{ request_id: number; product: string; why: string }>; moved: string | null } }>>('POST', `/jobs/${jobId}/parts/reserve`);
export const reservePart = (id: number) => write<WithJob<{ request: PartRequest }>>('POST', `/parts/requests/${id}/reserve`);
export const orderPart = (id: number, requisition_ref: string) => write<WithJob<{ request: PartRequest }>>('POST', `/parts/requests/${id}/order`, { requisition_ref });
export const cancelPart = (id: number, reason: string) => write<WithJob<{ request: PartRequest }>>('POST', `/parts/requests/${id}/cancel`, { reason });
export const issuePart = (body: Record<string, unknown>) => write<WithJob<{ request: PartRequest }>>('POST', '/parts/issue', body);
export const issueRequest = (id: number, body: Record<string, unknown>) => write<WithJob<{ request: PartRequest }>>('POST', `/parts/requests/${id}/issue`, body);
export const markUsed = (id: number, used: number | 'all') => write<WithJob<{ request: PartRequest }>>('POST', `/parts/requests/${id}/used`, { used });
export const returnPart = (id: number, body: { qty?: number; condition: string; serial_no?: string; batch_no?: string; note?: string }) => write<WithJob<{ request: PartRequest }>>('POST', `/parts/requests/${id}/return`, body);
export const addRemoved = (jobId: number, body: { description: string; usage_id?: number | null; request_id?: number | null; disposition?: string; note?: string }) => write<WithJob<{ removed_id: number }>>('POST', `/jobs/${jobId}/removed-parts`, body);
export const setDisposition = (id: number, body: { disposition: string; note?: string }) => write<WithJob>('PATCH', `/removed-parts/${id}`, body);

/**
 * What an issue at the counter sends. The override (above what the customer
 * approved) goes only with its reason, and only for those who may give it —
 * the server refuses the rest.
 */
export function issueBody(f: { job: string; code: string; qty: string; serial: string; batch: string; technician: string; override: boolean; reason: string }): Record<string, unknown> {
  const n = Number(f.qty);
  return {
    job: f.job.trim(),
    code: f.code.trim(),
    qty: Number.isFinite(n) && n > 0 ? n : 1,
    ...(f.serial.trim() ? { serial_no: f.serial.trim() } : {}),
    ...(f.batch.trim() ? { batch_no: f.batch.trim() } : {}),
    ...(f.technician ? { technician_id: Number(f.technician) } : {}),
    ...(f.override ? { override: true, override_reason: f.reason.trim() } : {}),
  };
}

// ── quality control ─────────────────────────────────────────────────────

export interface QcItem {
  id: number;
  label: string;
  mandatory: boolean;
  result: 'pass' | 'fail' | null;
  passed: boolean | null;
  note: string | null;
  work_order_id: number | null;
  answered_by: Person | string | null;
  answered_at: string | null;
  media: number[];
}

export interface QcAttempt {
  id: number;
  attempt: number;
  status: string;
  status_label: string;
  inspector: Person | null;
  started_at: string | null;
  completed_at: string | null;
  reason: string | null;
  items?: QcItem[];
  open_items: number;
  failed_items: number;
}

export interface Rework {
  id: number;
  qc_id: number;
  attempt: number;
  work_order: { id: number; code: string; status: string } | null;
  reason: string;
  technician: Person | null;
  status: 'open' | 'done';
  minutes: number;
  billable: boolean;
  at: string | null;
  completed_at: string | null;
}

export interface QcTab {
  current: (QcAttempt & { items: QcItem[] }) | null;
  attempts: QcAttempt[];
  rework: Rework[];
  self_qc_allowed: boolean;
  you_worked_on_it: boolean;
  can: { check: boolean; decide: boolean };
}

export const fetchQc = (jobId: number, signal?: AbortSignal) => apiGet<{ qc: QcTab; statuses: Record<string, string> }>(`${BASE}/jobs/${jobId}/qc`, undefined, signal);
export const startQc = (jobId: number) => write<WithJob>('POST', `/jobs/${jobId}/qc`);
export const answerQc = (qcId: number, items: Array<{ id: number; result?: 'pass' | 'fail' | null; note?: string; work_order_id?: number | null }>) => write<WithJob>('PATCH', `/qc/${qcId}`, { items });
export const decideQc = (qcId: number, body: { result: 'passed' | 'failed'; reason?: string; work_orders?: number[]; technician_id?: number }) => write<WithJob>('POST', `/qc/${qcId}/decide`, body);

/** Whether this reader may not check the job because they worked on it (FR-QC-04) — the server says so; this only explains it early. */
export const selfQcBlocked = (qc: Pick<QcTab, 'self_qc_allowed' | 'you_worked_on_it'>) => qc.you_worked_on_it && !qc.self_qc_allowed;

/** The work orders a failed check sends back: those given, else the ones named on failed items. */
export function reworkOrders(current: { items: QcItem[] } | null, chosen: number[]): number[] {
  if (chosen.length) return chosen;
  return [...new Set((current?.items ?? []).filter((i) => i.result === 'fail' && i.work_order_id).map((i) => i.work_order_id!))];
}

// ── road tests ──────────────────────────────────────────────────────────

export interface RoadTest {
  id: number;
  driver: Person | null;
  started_at: string | null;
  ended_at: string | null;
  start_odometer: number | null;
  end_odometer: number | null;
  distance_km: number | null;
  duration_s: number | null;
  route: string | null;
  issue_confirmed: boolean | null;
  repair_verified: boolean | null;
  new_issue: string | null;
  result: 'passed' | 'failed' | null;
  notes: string | null;
  at: string | null;
  points_count?: number;
}

export interface RoadTestsTab {
  required: boolean;
  result_since_qc: 'passed' | 'failed' | null;
  tests: RoadTest[];
  can: { record: boolean; send_back: boolean };
}

export const recordRoadTest = (jobId: number, body: Record<string, unknown>) => write<WithJob<{ road_test: RoadTest; duplicate: boolean }>>('POST', `/jobs/${jobId}/road-tests`, body);
export const updateRoadTest = (id: number, body: { result?: string; new_issue?: string; notes?: string; work_orders?: number[]; technician_id?: number; reason?: string }) => write<WithJob<{ road_test: RoadTest }>>('PATCH', `/road-tests/${id}`, body);

// ── final review, invoice, release, handover ────────────────────────────

export interface ReviewItem {
  key: string;
  label: string;
  ok: boolean;
  state: 'ok' | 'blocked' | 'confirm' | 'not_required';
  detail: string | null;
}

export interface Review {
  items: ReviewItem[];
  clear: boolean;
  missing: string[];
}

export interface InvoiceRead {
  id: number;
  number: string | null;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  payment_terms_days: number | null;
  currency: string;
  deleted: boolean;
  subtotal?: string;
  discount?: string;
  tax?: string;
  total?: string;
  paid?: string;
  credited?: string;
  outstanding?: string;
  lines?: Array<{ description: string; quantity: string; unit_price: string; discount_pct: string; total: string }>;
  payments?: Array<{ reference: string | null; method: string | null; paid_on: string | null; amount: string }>;
}

export interface InvoicePreview {
  currency: string;
  rate: string | number | null;
  lines: Array<{ estimate_item_id: number; line_type: string; description: string; approved_qty: string | number; payer: string; qty: string | number; unit: string | null; unit_price: string; discount_pct: string; basis: 'used' | 'time' | 'approved'; note: string | null }>;
  excluded: Array<{ description: string; qty?: string | number; why: string }>;
  problems: string[];
  totals: { subtotal: string; discount: string; tax: string; total: string } | null;
}

export interface Release {
  basis: 'paid' | 'credit' | null;
  why: string | null;
  invoice_status: string | null;
}

export interface Handover {
  id: number;
  handed_over_at: string | null;
  odometer: number | null;
  fuel_level: number | null;
  delivered_by: Person | null;
  received_by: string | null;
  items_returned: string[];
  removed_parts_returned: boolean;
  release_basis: string | null;
  override: { reason: string | null; by: string | null } | null;
  signature: { signer: string | null; relation: string | null; signed_at: string | null } | null;
  document_hash: string | null;
  document_intact: boolean;
  notes: string | null;
  summary: string | null;
}

export interface DeliveryTab {
  final_review: Review | null;
  invoice: InvoiceRead | null;
  invoice_preview: InvoicePreview | null;
  release: Release | null;
  handover: Handover | null;
  belongings: string[];
  can: { ready: boolean; invoice: boolean; issue: boolean; handover: boolean; override_release: boolean };
}

export const fetchReview = (jobId: number, present: boolean, signal?: AbortSignal) => apiGet<{ review: Review; belongings: string[] }>(`${BASE}/jobs/${jobId}/final-review`, present ? { customer_items_present: 1 } : undefined, signal);
export const markReady = (jobId: number, body: { customer_items_present: boolean; note?: string }) => write<WithJob>('POST', `/jobs/${jobId}/ready`, body);
export const fetchInvoice = (jobId: number, signal?: AbortSignal) => apiGet<{ invoice: InvoiceRead | null; preview: InvoicePreview | null; release: Release | null; can: { create: boolean; issue: boolean; terms: boolean } }>(`${BASE}/jobs/${jobId}/invoice`, undefined, signal);
export const raiseInvoice = (jobId: number, body: { payment_terms_days: number; issue: boolean; notes?: string }) => write<WithJob<{ invoice: InvoiceRead; estimate_lines: { invoiced: number[]; not_done: Array<{ id: number; description: string }> } }>>('POST', `/jobs/${jobId}/invoice`, body);
export const fetchRelease = (jobId: number, signal?: AbortSignal) => apiGet<{ release: Release; may_override: boolean }>(`${BASE}/jobs/${jobId}/release`, undefined, signal);
export const handOver = (jobId: number, body: Record<string, unknown>) => write<WithJob<{ document_hash: string }>>('POST', `/jobs/${jobId}/handover`, body);

/** The body of `POST jobs/{id}/handover`: what the counter recorded, the signature, and the override only with its reason. */
export function handoverBody(f: { odometer: string; fuel: string; receivedBy: string; relation: string; signature: string; items: string[]; removedReturned: boolean; notes: string; summary: string; override: string; odometerReason: string }): Record<string, unknown> {
  return {
    odometer: Number(f.odometer),
    fuel_level: f.fuel,
    received_by_name: f.receivedBy.trim(),
    signature: { image: f.signature, signer_name: f.receivedBy.trim(), relation: f.relation.trim() || null, device: 'WorkSuite Desktop' },
    items_returned: f.items,
    removed_parts_returned: f.removedReturned,
    ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
    ...(f.summary.trim() ? { summary: f.summary.trim() } : {}),
    ...(f.override.trim() ? { override_reason: f.override.trim() } : {}),
    ...(f.odometerReason.trim() ? { odometer_override_reason: f.odometerReason.trim() } : {}),
  };
}

// ── history and reports ─────────────────────────────────────────────────

export interface HistoryRow {
  job_id: number;
  number: string;
  date: string | null;
  checked_in: string | null;
  odometer: number | null;
  odometer_out: number | null;
  vehicle: { id: number; vehicle_number: string; make_model: string | null } | null;
  job_type: string | null;
  service_type: string | null;
  complaints: string[];
  repairs: Array<{ line_type: string; description: string; qty: string | number }>;
  parts: Array<{ product_id: number; name: string; qty: string | number; serial_no: string | null }>;
  technicians: Array<{ id: number; name: string | null; role: string }>;
  labour_hours: number | string | null;
  invoice_id: number | null;
  invoice: { id: number; number: string | null; status: string; currency?: string; total?: string; paid?: string; outstanding?: string } | null;
}

/** A history row from either stage: stage A's Vehicle 360° rows lack the B3 columns and name technicians plainly. */
export type HistoryLike = Omit<Partial<HistoryRow>, 'technicians'> & Pick<HistoryRow, 'job_id' | 'number'> & { technicians?: Array<string | { id?: number; name: string | null; role?: string | null }> };

export interface HistoryTotals {
  currency: string;
  invoiced: string;
  paid: string;
  jobs: number;
}

export const fetchVehicleHistory = (id: number, signal?: AbortSignal) => apiGet<{ vehicle: unknown; jobs: HistoryRow[]; count: number; totals: HistoryTotals[] | null }>(`${BASE}/vehicles/${id}/history`, undefined, signal);
export const fetchCustomerHistory = (id: number, signal?: AbortSignal) =>
  apiGet<{ customer: unknown; vehicles: Array<{ vehicle: { id: number; vehicle_number: string; make_model: string | null }; jobs: number; last_service: string | null; last_odometer: number | null }>; jobs: HistoryRow[]; count: number; totals: HistoryTotals[] | null }>(`${BASE}/customers/${id}/history`, undefined, signal);

/** The people on a history row: stage B3 names them as `{name, role}`, stage A as plain names. */
export function peopleOf(people: ReadonlyArray<string | { id?: number; name: string | null; role?: string | null }> | null | undefined): string {
  return (people ?? [])
    .map((p) => (typeof p === 'string' ? p : p.name))
    .filter((n): n is string => !!n)
    .filter((n, i, all) => all.indexOf(n) === i)
    .join(', ');
}

/** A history row's invoice in a line: its number and status, with the amounts for those who may see money. */
export function invoiceLine(i: HistoryRow['invoice'], money: (v: string, c?: string) => string): string {
  if (!i) return '';
  const head = [i.number ?? `#${i.id}`, i.status].join(' · ');
  if (i.total === undefined) return head;
  const owed = i.outstanding !== undefined && Number(i.outstanding) > 0 ? `, ${money(i.outstanding, i.currency)} outstanding` : '';
  return `${head} · ${money(i.total, i.currency)}${owed}`;
}

/** Amounts per currency as the server added them, side by side; none is a dash. */
export const moneyList = (rows: ReadonlyArray<{ currency: string; amount: string }>) => (rows.length ? rows.map((r) => amount(r.amount, r.currency)).join(' · ') : '—');

export interface ReportMeta {
  key: string;
  title: string;
  money: boolean;
}

export interface ReportData {
  key: string;
  title: string;
  from: string;
  to: string;
  generated_at: string | null;
  columns: Array<{ key: string; label: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  totals: Record<string, unknown> | null;
  notes: string[];
}

export const fetchReports = (signal?: AbortSignal) => apiGet<{ items: ReportMeta[]; may_export: boolean }>(`${BASE}/reports`, undefined, signal);
export const fetchReport = (key: string, q: Record<string, string>, signal?: AbortSignal) => apiGet<ReportData>(`${BASE}/reports/${key}`, q, signal);

/** Reports that need a record to be about. */
export const REPORT_NEEDS: Record<string, 'vehicle_id' | 'customer_id'> = { 'vehicle-history': 'vehicle_id', 'customer-history': 'customer_id' };

/** A report cell as text: money and numbers as the server sent them, lists joined, nothing as a dash. */
export function cell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map(cell).join(', ');
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).map(cell).join(' ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

// ── on the job card ─────────────────────────────────────────────────────

export const hasKey = (k: 'parts' | 'qc' | 'road_tests' | 'delivery') => (job: Job360) => job[k] !== null && job[k] !== undefined;
