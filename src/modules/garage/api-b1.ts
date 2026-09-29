import { useQuery } from '@tanstack/react-query';
import { apiGet, request, type ApiResult } from '../../core/api';
import type { Job360, Media, Person } from './api';

/**
 * Garage stage B1 (`web-api-b1.md`): inspections and the vehicle health check,
 * diagnosis, estimates with versions, the customer's decision recorded by
 * staff, and additional work. Money is the server's decimal text — never
 * worked out here: "what if these were approved" is asked of `preview`.
 */
const BASE = '/api/garage';

// ── inspections ─────────────────────────────────────────────────────────

export interface InspectionItem {
  id: number;
  section: string | null;
  sort: number;
  label: string;
  result_type: 'traffic_light' | 'pass_fail' | 'measurement' | 'text' | 'photo';
  unit: string | null;
  spec: string | null;
  thresholds: { amber_below: string | null; red_below: string | null; amber_above: string | null; red_above: string | null } | null;
  mandatory: boolean;
  result: 'green' | 'amber' | 'red' | 'pass' | 'fail' | null;
  result_label: string | null;
  measurement: string | null;
  note: string | null;
  recommendation: string | null;
  customer_visible: boolean;
  next_step: 'none' | 'estimate' | 'deferred';
  estimate_item_id: number | null;
  answered_by: string | null;
  answered_at: string | null;
  media: Media[];
}

export interface Inspection {
  id: number;
  job_id: number;
  inspection_type: string;
  type_label: string;
  template: { id: number; code: string; name: string; version: number } | null;
  status: 'in_progress' | 'completed' | 'pending';
  status_label: string;
  performed_by: Person | null;
  started_at: string | null;
  completed_at: string | null;
  summary: { good: number; attention: number; urgent: number; unanswered: number; total: number } | null;
  customer_summary: string | null;
  items: InspectionItem[];
}

export interface TemplateRow {
  id: number;
  org_id: number;
  code: string;
  name: string;
  inspection_type: string;
  type_label: string;
  vehicle_type: string | null;
  version: number;
  active: boolean;
  items: number;
}

export interface Report {
  id: number;
  type: string;
  type_label: string;
  completed_at: string | null;
  summary: Inspection['summary'];
  customer_summary: string | null;
  items: Array<{ section: string | null; label: string; result: string | null; result_label: string | null; measurement: string | null; unit: string | null; note: string | null; recommendation: string | null; later: boolean; photos: Array<{ id: number; kind: string; caption: string | null; url: string }> }>;
}

export const fetchInspections = (jobId: number, signal?: AbortSignal) => apiGet<{ items: Inspection[] }>(`${BASE}/jobs/${jobId}/inspections`, undefined, signal);
export const fetchTemplates = (org: number, signal?: AbortSignal) => apiGet<{ items: TemplateRow[]; types: Record<string, string>; result_types: Record<string, string> }>(`${BASE}/inspection-templates`, { org, active: 1 }, signal);
export const fetchLibrary = (signal?: AbortSignal) => apiGet<{ items: Array<{ key: string; name: string; inspection_type: string; items: number; sections: number | string[] }> }>(`${BASE}/inspection-templates/library`, undefined, signal);
export const fetchTemplate = (id: number, signal?: AbortSignal) => apiGet<{ template: TemplateRow & { items: Array<{ id: number; section: string | null; label: string; result_type: string; unit: string | null; spec: string | null; mandatory: boolean; customer_visible: boolean }> } }>(`${BASE}/inspection-templates/${id}`, undefined, signal);
export const fetchReport = (id: number, signal?: AbortSignal) => apiGet<{ report: Report }>(`${BASE}/inspections/${id}/report`, undefined, signal);

async function write<T>(method: 'POST' | 'PATCH' | 'DELETE' | 'PUT', path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>(method, `${BASE}${path}`, { body });
}

export const startInspection = (jobId: number, body: { template_id?: number; inspection_type?: string }) => write<{ inspection: Inspection; job_status: string }>('POST', `/jobs/${jobId}/inspections`, body);
export const answerItems = (id: number, items: Array<Partial<Pick<InspectionItem, 'result' | 'measurement' | 'note' | 'recommendation' | 'customer_visible'>> & { id: number }>) => write<{ inspection: Inspection }>('PATCH', `/inspections/${id}/items`, { items });
export const completeInspection = (id: number) => write<{ inspection: Inspection; job_status: string }>('POST', `/inspections/${id}/complete`);
export const setCustomerSummary = (id: number, customer_summary: string) => write<{ inspection: Inspection }>('PATCH', `/inspections/${id}`, { customer_summary });
export const nextStep = (id: number, itemId: number, next_step: 'estimate' | 'deferred' | 'none') => write<{ inspection: Inspection; line_id?: number }>('POST', `/inspections/${id}/items/${itemId}/next-step`, { next_step });
export const copyFromLibrary = (key: string, org: number) => write<{ template: TemplateRow }>('POST', `/inspection-templates/library/${key}`, { org_id: org });

/** What a measurement says against its thresholds — shown as the reader types; the server sets the result from the same rule. */
export function measured(value: string, t: InspectionItem['thresholds']): 'green' | 'amber' | 'red' | null {
  if (!t || value.trim() === '' || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const n = (x: string | null) => (x === null || x === '' ? null : Number(x));
  const [ab, rb, aa, ra] = [n(t.amber_below), n(t.red_below), n(t.amber_above), n(t.red_above)];
  if ((rb !== null && v < rb) || (ra !== null && v > ra)) return 'red';
  if ((ab !== null && v < ab) || (aa !== null && v > aa)) return 'amber';
  if (ab === null && rb === null && aa === null && ra === null) return null;
  return 'green';
}

// ── diagnosis ───────────────────────────────────────────────────────────

export interface Diagnostic {
  id: number;
  complaint_id: number | null;
  complaint: string | null;
  finding: string | null;
  cause: string | null;
  recommended_repair: string | null;
  required_parts: Array<{ product_id: number; qty: string; note: string | null; name: string | null; sku: string | null }>;
  estimated_labour_hours: string | null;
  priority: string | null;
  status: 'open' | 'resolved';
  status_label: string;
  no_fault_found: boolean;
  resolved_at: string | null;
  signed_off_at: string | null;
  signed_off_by: Person | string | null;
  codes: Array<{ id: number; code: string; description: string | null; scanned_at: string | null; scanner: string | null; raw: string | null }>;
  media: Media[];
  on_estimate: boolean;
  created_at: string | null;
}

export const fetchDiagnostics = (jobId: number, signal?: AbortSignal) => apiGet<{ items: Diagnostic[]; priorities: Record<string, string>; statuses: Record<string, string> }>(`${BASE}/jobs/${jobId}/diagnostics`, undefined, signal);
export const addDiagnostic = (jobId: number, body: Record<string, unknown>) => write<{ items: Diagnostic[]; job_status: string }>('POST', `/jobs/${jobId}/diagnostics`, body);
export const updateDiagnostic = (id: number, body: Record<string, unknown>) => write<{ items: Diagnostic[]; job_status: string }>('PATCH', `/diagnostics/${id}`, body);
export const addCode = (id: number, body: { code: string; description?: string; scanner?: string }) => write<unknown>('POST', `/diagnostics/${id}/codes`, body);
export const removeCode = (id: number, codeId: number) => write<unknown>('DELETE', `/diagnostics/${id}/codes/${codeId}`);
export const signOff = (id: number) => write<{ items: Diagnostic[]; job_status: string }>('POST', `/diagnostics/${id}/sign-off`);
export const diagnosticToEstimate = (id: number) => write<EstimateAnswer>('POST', `/diagnostics/${id}/to-estimate`);

// ── estimates ───────────────────────────────────────────────────────────

export interface Availability {
  status: 'in_stock' | 'reservable' | 'needs_purchase' | 'not_stocked';
  label: string;
  here: number;
  company: number;
}

export interface Line {
  id: number;
  line_key: string;
  sort: number;
  line_type: string;
  type_label: string;
  product_id: number | null;
  warehouse_id: number | null;
  description: string;
  qty: string;
  unit: string | null;
  unit_price: string;
  discount_pct: string;
  tax_rate_ids: number[];
  labour_hours: string | null;
  labor_rate_id: number | null;
  rate_type: string | null;
  coverage: string;
  payer: string;
  source: string;
  source_id: number | null;
  vhc: 'green' | 'amber' | 'red' | null;
  safety: boolean;
  decision: string;
  decision_label: string;
  decided_at: string | null;
  follow_up_on: string | null;
  chargeable: boolean;
  net: string;
  tax: string;
  total: string;
  availability: Availability | null;
}

export interface Approval {
  id: number;
  method: string;
  method_label: string;
  outcome: string;
  approver_name: string | null;
  comment: string | null;
  decided_at: string | null;
  recorded_by: Person | string | null;
  safety_acknowledged: boolean;
  signed: boolean;
  lines: Array<{ item_id: number; decision: string }>;
}

export interface Version {
  id: number;
  estimate_id: number;
  job_id: number;
  version_no: number;
  label: string;
  kind: 'initial' | 'revision' | 'supplementary';
  kind_label: string;
  status: string;
  status_label: string;
  latest: boolean;
  editable: boolean;
  change_summary: string | null;
  currency: string;
  totals: { subtotal: string; discount: string; tax: string; total: string; approved: string | null };
  max_discount_pct: string;
  by_payer: Record<string, string>;
  valid_until: string | null;
  expires_at: string | null;
  created_at: string | null;
  created_by: Person | string | null;
  sent_at: string | null;
  sent_by: Person | string | null;
  sent_channel: string | null;
  viewed_at: string | null;
  approved_at: string | null;
  superseded_at: string | null;
  lines: Line[];
  approvals: Approval[];
  links: Array<{ id: number; created_at: string | null; expires_at: string | null; revoked_at: string | null; last_used_at: string | null; uses: number; live: boolean; by: Person | string | null; revoked_by: Person | string | null }>;
  discount_approval: { request_id: number; step: string; asked_by: string | null; asked_at: string | null; may_decide: boolean } | null;
  additional_work: number[];
}

export interface EstimateTab {
  estimate: { id: number; number: string; currency: string; current_version_id: number | null } | null;
  versions: Version[];
  totals: { estimate: string | null; approved: string | null };
  recommendations: {
    diagnostics: Array<{ id: number; complaint: string | null; finding: string | null; recommended_repair: string | null; priority: string | null; estimated_labour_hours: string | null }>;
    inspection: Array<{ id: number; inspection_id: number; section: string | null; label: string; result: string | null; measurement: string | null; unit: string | null; recommendation: string | null; next_step: string; on_estimate: boolean }>;
  };
  deferred: Line[];
  deferred_elsewhere: Array<Line & { job_id: number; job_number: string }>;
  discount_limit_pct: string;
  can: { create: boolean; edit: boolean; send: boolean; record_decision: boolean; override_discount: boolean };
}

/** What most estimate writes answer: the tab as it is now, and where the job went. */
export interface EstimateAnswer {
  estimate: EstimateTab;
  job_status: string;
  job_version: number;
  line_id?: number;
  version_id?: number;
  status?: string;
  outcome?: string;
  link?: { id: number; token: string; url: string; expires_at: string | null };
  text?: string;
  warnings?: string[];
}

export interface EstimateOptions {
  line_types: Record<string, string>;
  payers: Record<string, string>;
  coverage: Record<string, string>;
  sources: Record<string, string>;
  availability: Record<string, string>;
  decisions: Record<string, string>;
  line_states: Record<string, string>;
  version_statuses: Record<string, string>;
  version_kinds: Record<string, string>;
  channels: Record<string, string>;
  methods: Record<string, string>;
  staff_methods: Record<string, string>;
  inspection_types: Record<string, string>;
  inspection_results: Record<string, string>;
  recommendations: Record<string, string>;
  companies: Array<{
    id: number;
    currency: string;
    validity_days: number;
    link_days: number;
    my_discount_limit_pct: string;
    may_override_discount: boolean;
    signature_required: boolean;
    auto_approve_limit: string;
    tax_rates: Array<{ id: number; name: string; rate: string; is_default: boolean }>;
    labour_rates: Array<{ id: number; code: string; name: string; rate_type: string; amount: string; currency: string; is_default: boolean }>;
  }>;
}

export const KB1 = {
  options: ['garage', 'estimates', 'options'] as const,
  estimate: (jobId: number) => ['garage', 'job', jobId, 'estimate'] as const,
  inspections: (jobId: number) => ['garage', 'job', jobId, 'inspections'] as const,
  diagnostics: (jobId: number) => ['garage', 'job', jobId, 'diagnostics'] as const,
  additional: (jobId: number) => ['garage', 'job', jobId, 'additional-work'] as const,
  templates: (org: number) => ['garage', 'inspection-templates', org] as const,
  discounts: (org: string) => ['garage', 'discount-approvals', org] as const,
};

export function useEstimateOptions(enabled = true) {
  return useQuery({ queryKey: KB1.options, queryFn: ({ signal }) => apiGet<EstimateOptions>(`${BASE}/estimates/options`, undefined, signal), staleTime: 5 * 60_000, enabled });
}

export const fetchEstimate = (jobId: number, signal?: AbortSignal) => apiGet<{ estimate: EstimateTab }>(`${BASE}/jobs/${jobId}/estimate`, undefined, signal);
export const openEstimate = (jobId: number) => write<EstimateAnswer>('POST', `/jobs/${jobId}/estimate`);
export const pullRecommendations = (jobId: number) => write<EstimateAnswer>('POST', `/jobs/${jobId}/estimate/pull`);
export const carryDeferred = (jobId: number, itemId: number) => write<EstimateAnswer>('POST', `/jobs/${jobId}/estimate/carry/${itemId}`);
export const newVersion = (estimateId: number, change_summary: string) => write<EstimateAnswer>('POST', `/estimates/${estimateId}/versions`, { change_summary });
export const updateVersion = (id: number, change_summary: string) => write<EstimateAnswer>('PATCH', `/versions/${id}`, { change_summary });
export const addLine = (versionId: number, body: Record<string, unknown>) => write<EstimateAnswer>('POST', `/versions/${versionId}/lines`, body);
export const updateLine = (id: number, body: Record<string, unknown>) => write<EstimateAnswer>('PATCH', `/estimate-lines/${id}`, body);
export const removeLine = (id: number) => write<EstimateAnswer>('DELETE', `/estimate-lines/${id}`);
export const sendVersion = (id: number, body: { channel: string; change_summary?: string }) => write<EstimateAnswer>('POST', `/versions/${id}/send`, body);
export const newLink = (id: number) => write<EstimateAnswer>('POST', `/versions/${id}/links`);
export const revokeLink = (id: number) => write<EstimateAnswer>('DELETE', `/estimate-links/${id}`);
export const decideDiscount = (id: number, body: { decision: 'approve' | 'reject' | 'return'; comment?: string }) => write<EstimateAnswer>('POST', `/versions/${id}/discount`, body);
export const recallVersion = (id: number) => write<EstimateAnswer>('POST', `/versions/${id}/recall`);
export const previewDecisions = (id: number, lines: Array<{ id: number; decision: string }>) => write<{ approved: { subtotal: string; discount: string; tax: string; total: string }; lines: unknown; currency: string }>('POST', `/versions/${id}/preview`, { lines });
export const recordApproval = (id: number, body: Record<string, unknown>) => write<EstimateAnswer>('POST', `/versions/${id}/approvals`, body);
export const recordChanges = (id: number, body: { method: string; approver_name: string; comment: string }) => write<EstimateAnswer>('POST', `/versions/${id}/changes`, body);
export const fetchDiscountQueue = (org: string, signal?: AbortSignal) => apiGet<{ items: Array<{ version_id: number; label: string; job_id: number; job_number: string; currency: string; total: string; discount: string; max_discount_pct: string; asked_by: string | null; asked_at: string | null }> }>(`${BASE}/estimates/discount-approvals`, org ? { org } : undefined, signal);

/** Lines the customer has to decide on: every line of the version — a staff-recorded answer covers them all. */
export function undecided(v: Pick<Version, 'lines'>, picks: Record<number, string>): number[] {
  return v.lines.filter((l) => !picks[l.id]).map((l) => l.id);
}

/** Lines declined (rejected or later) that are marked for safety: declining them needs the customer's acknowledgement. */
export function declinedSafety(v: Pick<Version, 'lines'>, picks: Record<number, string>): Line[] {
  return v.lines.filter((l) => (l.safety || l.vhc === 'red') && (picks[l.id] === 'rejected' || picks[l.id] === 'deferred'));
}

/** The version shown when none was picked: the latest. */
export function currentVersion(tab: Pick<EstimateTab, 'versions'>, picked: number | null): Version | null {
  return tab.versions.find((v) => v.id === picked) ?? tab.versions.find((v) => v.latest) ?? tab.versions[0] ?? null;
}

// ── additional work ─────────────────────────────────────────────────────

export interface AdditionalWork {
  id: number;
  status: string;
  status_label: string;
  finding: string;
  work_order: { id: number; code: string } | null;
  media_ids: number[];
  estimate_version_id: number | null;
  raised_by: Person | null;
  raised_at: string | null;
  decided_at: string | null;
  customer_ack: string | null;
  closed_reason: string | null;
  lines: Array<{ id: number; line_type: string; description: string; qty: string; decision: string; unit_price?: string; total?: string }>;
}

export const fetchAdditional = (jobId: number, signal?: AbortSignal) => apiGet<{ items: AdditionalWork[]; job_status: string }>(`${BASE}/jobs/${jobId}/additional-work`, undefined, signal);
export const raiseAdditional = (jobId: number, body: { work_order_id: number | null; finding: string; media_ids?: number[]; lines: Array<Record<string, unknown>> }) => write<{ items: AdditionalWork[]; job_status: string; id: number }>('POST', `/jobs/${jobId}/additional-work`, body);
export const withdrawAdditional = (id: number, reason: string) => write<{ items: AdditionalWork[]; job_status: string; warnings?: string[] }>('POST', `/additional-work/${id}/withdraw`, { reason });

// ── on the job card ─────────────────────────────────────────────────────

/** Whether the server has stage B1 (the job card carries its keys, even as null). */
export const hasB1 = (job: Job360) => 'additional_work' in job || 'inspections' in job;

/** Parts from the catalogue, for a part line (Inventory's lookup; needs Inventory). */
export const lookupParts = (q: string, signal?: AbortSignal) =>
  apiGet<{ products: Array<{ id: number; code: string | null; name: string; unit: string | null; on_hand: number | null }> }>('/api/inventory/products/lookup', { q }, signal);
