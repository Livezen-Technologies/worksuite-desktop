import { apiDelete, apiGetMeta, request, type ApiResult } from '../../../core/api';
import { call } from '../../../core/bridge';
import type { ProjectReportFormat, ProjectReportKind } from '@shared/projects';
import { API, type Can, type ChangeRequest, type Health, type ProjectListResponse } from '../api';
import { withOrg, type Company } from '../company';

/**
 * Governance in the Projects app (W12–W15): Budget & cost, Risks, Change requests and Reports — the web's contract
 * (web/src/pages/project/types.ts, api.ts), field for field, for these screens.
 *
 * Reads go through the app's API proxy, so READ_CACHE (`/api/projects`) answers them offline; every write here needs
 * WorkSuite (a risk, a change request and its decision, a schedule) and is disabled offline. Portfolio-level reads
 * carry the chosen company as `org` — in the request and in the query key (`company.tsx`); a read about one project
 * (`project_id`) carries none.
 */

type Params = Record<string, string | number | boolean | null | undefined>;
type Signal = { signal?: AbortSignal };

/** Drops empty values so a filter left at "any" is not sent as `?x=`. */
export function clean(p: Params = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    out[k] = v === true ? '1' : String(v);
  }
  return out;
}

const scoped = (p: Params = {}) => clean(withOrg(p));

// ── shapes ─────────────────────────────────────────────────────────────────

/** One step in how a project's budget moved: baseline, approved changes, edits, now. */
export interface BudgetStep {
  at: string | null;
  label: string;
  kind: 'baseline' | 'change' | 'pending_change' | 'edit' | 'current';
  delta: string | null;
  amount: string;
  ref: string | null;
}

export interface BudgetRow {
  id: number;
  code: string;
  name: string;
  currency: string;
  budget: string;
  labour: string;
  expenses: string;
  remaining: string;
  used_percent: number;
  over: boolean;
  eac: string | null;
  warn_percent: number;
}

/** GET /projects/budget — one company's portfolio (`org`, else the caller's own). */
export interface PortfolioBudget {
  company: Company | null;
  currency: string;
  rate_date: string | null;
  unconverted: Array<{ id: number; code: string; currency: string }>;
  totals: {
    budget: string;
    spent: string;
    labour: string;
    expenses: string;
    used_percent: number;
    live_projects: number;
    billable_minutes: number;
    claims: number;
    over_budget: number;
    over_budget_by: string | null;
    worst: { id: number; code: string } | null;
  };
  projects: BudgetRow[];
  can?: Can;
}

/** GET /projects/{id}/cost */
export interface ProjectCost {
  history: BudgetStep[];
  labour_by_person: Array<{ user_id: number; name: string; amount: string; minutes: number }>;
  currency: string;
}

export type RiskStatus = 'open' | 'mitigating' | 'closed' | 'realised';

export interface Risk {
  id: number;
  project_id: number;
  project: string;
  project_code: string;
  title: string;
  description: string | null;
  impact: string;
  probability: string;
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  status: RiskStatus;
  mitigation: string | null;
  owner: string | null;
  owner_id: number | null;
  due_date: string | null;
  review_overdue: boolean;
  closed_at: string | null;
}

/** GET /projects/risks */
export interface RiskListResponse {
  risks: Risk[];
  counts: { open: number; mitigating: number; realised: number; closed: number; all: number };
  /** Open and mitigating risks by impact × probability: impact → probability → count. */
  heat: Record<string, Record<string, number>>;
  can?: Can;
}

export interface Impact {
  budget: string;
  end_date: string | null;
  hours: string;
}

/** A change request as the full screen reads it: the decide view's fields and what approval does. */
export interface ChangeRequestFull extends ChangeRequest {
  requested_by_id?: number | null;
  decided_at?: string | null;
  before?: Impact;
  after?: Impact;
  after_used_percent?: number | null;
  health_now?: Health | null;
  health_after?: Health | null;
  moved_baseline?: boolean;
  can_withdraw?: boolean;
}

export interface ChangeListFull {
  changes: ChangeRequestFull[];
  counts?: Partial<Record<'waiting' | 'approved' | 'rejected' | 'withdrawn' | 'all', number>>;
  can?: Can;
}

export interface ClientLite {
  id: number;
  name: string;
}

export interface Person {
  id: number;
  name: string;
  email: string;
  employee_no: string | null;
}

export interface ReportResponse {
  kind: string;
  from: string | null;
  to: string | null;
  company: Company | null;
  currency: string;
  rate_date: string | null;
  summary: Array<{ label: string; value: string; sub?: string }>;
  columns: Array<{ key: string; label: string; align?: 'left' | 'right'; mono?: boolean }>;
  rows: Array<Record<string, string | number | null>>;
  chart: Array<{ label: string; a: number; b: number }> | null;
  chart_legend: [string, string] | null;
}

export type ReportRange = 'yesterday' | 'last_week' | 'week_to_date' | 'last_month' | 'month_to_date' | 'last_30_days';
export type ReportFrequency = 'daily' | 'weekly' | 'monthly';

export interface ReportSchedule {
  id: number;
  name: string | null;
  title: string;
  kind: string;
  kind_label: string;
  range: ReportRange;
  range_label: string;
  dated: boolean;
  client_id: number | null;
  project_id: number | null;
  org_id: number | null;
  company: string | null;
  format: ProjectReportFormat;
  frequency: ReportFrequency;
  weekday: number | null;
  month_day: number | null;
  time: string;
  timezone: string;
  recipients: Array<{ id: number; name: string }>;
  owner: { id: number; name: string };
  is_active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_sent_at: string | null;
  last_error: string | null;
  mine: boolean;
}

export interface ReportScheduleInput {
  name?: string | null;
  kind: string;
  range: ReportRange;
  format: ProjectReportFormat;
  frequency: ReportFrequency;
  weekday?: number | null;
  month_day?: number | null;
  time: string;
  client_id?: number | null;
  project_id?: number | null;
  org_id?: number | null;
  recipients: number[];
  is_active?: boolean;
}

// ── query keys (under qk.all, so one invalidate refreshes the module) ──────

export const gk = {
  budget: (p: Params) => ['projects', 'budget', scoped(p)] as const,
  cost: (id: number) => ['projects', 'cost', id] as const,
  risks: (p: Params) => ['projects', 'risks', scoped(p)] as const,
  changes: (p: Params) => ['projects', 'changes', 'all', scoped(p)] as const,
  reports: (p: Params) => ['projects', 'reports', scoped(p)] as const,
  reportSchedules: ['projects', 'report-schedules'] as const,
  clients: () => ['projects', 'clients', scoped()] as const,
  live: () => ['projects', 'list', 'live', scoped()] as const,
  peopleIn: (org: number | null) => ['projects', 'people', 'in', org] as const,
};

// ── reads ──────────────────────────────────────────────────────────────────

export const gov = {
  budget: (p: Params, { signal }: Signal = {}) => apiGetMeta<PortfolioBudget>(`${API}/budget`, scoped(p), signal),
  cost: (id: number, { signal }: Signal = {}) => apiGetMeta<ProjectCost>(`${API}/${id}/cost`, undefined, signal),
  /** status=open|mitigating|realised|closed|all, project_id */
  risks: (p: Params, { signal }: Signal = {}) => apiGetMeta<RiskListResponse>(`${API}/risks`, scoped(p), signal),
  /** status=waiting|approved|rejected|withdrawn|all, project_id */
  changes: (p: Params, { signal }: Signal = {}) => apiGetMeta<ChangeListFull>(`${API}/changes`, scoped(p), signal),
  /** kind, from, to, client_id, project_id; one company */
  reports: (p: Params, { signal }: Signal = {}) => apiGetMeta<ReportResponse>(`${API}/reports`, scoped(p), signal),
  reportSchedules: ({ signal }: Signal = {}) => apiGetMeta<{ schedules: ReportSchedule[]; can_see_all: boolean }>(`${API}/report-schedules`, undefined, signal),
  clients: ({ signal }: Signal = {}) => apiGetMeta<{ clients: ClientLite[] }>(`${API}/clients`, scoped(), signal),
  live: ({ signal }: Signal = {}) => apiGetMeta<ProjectListResponse>(API, scoped({ scope: 'live', per_page: 200 }), signal),
  people: (org: number | null, { signal }: Signal = {}) => apiGetMeta<{ people: Person[] }>(`${API}/people`, clean(org ? { org } : withOrg()), signal),
};

// ── writes: each needs WorkSuite (never kept offline) ─────────────────────

/** A write's answer with the server's own sentence, when it sent one. */
async function send<T = unknown>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>(method, path, { body });
}

export const govWrite = {
  createRisk: (body: Record<string, unknown>) => send<{ id: number }>('POST', `${API}/risks`, body),
  updateRisk: (id: number, body: Record<string, unknown>) => send('PUT', `${API}/risks/${id}`, body),
  deleteRisk: (id: number) => apiDelete(`${API}/risks/${id}`),
  createChange: (body: Record<string, unknown>) => send<{ id: number; number: string }>('POST', `${API}/changes`, body),
  /** Reject needs a note; move_baseline also moves the baseline end date when the change approves days. */
  decideChange: (id: number, body: { decision: 'approve' | 'reject'; note?: string; move_baseline?: boolean }) => send('POST', `${API}/changes/${id}/decide`, body),
  withdrawChange: (id: number) => send('POST', `${API}/changes/${id}/withdraw`),
  createReportSchedule: (body: ReportScheduleInput) => send<{ schedule: ReportSchedule }>('POST', `${API}/report-schedules`, body),
  /** Any subset; `{ is_active }` alone pauses or resumes. */
  updateReportSchedule: (id: number, body: Partial<ReportScheduleInput>) => send<{ schedule: ReportSchedule }>('PUT', `${API}/report-schedules/${id}`, body),
  deleteReportSchedule: (id: number) => apiDelete(`${API}/report-schedules/${id}`),
  sendReportScheduleNow: (id: number) => send<{ schedule: ReportSchedule; sent: number; error: string | null }>('POST', `${API}/report-schedules/${id}/send-now`),
};

/**
 * A report saved on this computer as the server renders it (CSV, Excel or PDF): through the download manager
 * (`transfers:download` with `projectsReport`), so it lands in Downloads — or where the person is asked — and shows
 * in Transfers like every other WorkSuite file. The main process builds the address from what is named here.
 */
export function exportReport(p: { kind: ProjectReportKind; format: ProjectReportFormat; from?: string | null; to?: string | null; client_id?: string | number | null; project_id?: number | null }) {
  const query = clean(withOrg({ from: p.from, to: p.to, client_id: p.client_id, project_id: p.project_id }));
  return call('transfers:download', { projectsReport: { kind: p.kind, format: p.format, query }, name: `projects-${p.kind}.${p.format}`, open: false });
}
