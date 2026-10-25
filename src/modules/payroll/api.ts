import { apiGet, apiPost, apiPut, apiUrl, request } from '../../core/api';

/**
 * Payroll on the desktop (WS-PAYROLL-SRS-001 §D1, UI-07 and the run screens), over the server's `/api/payroll`.
 *
 * THE SERVER IS AUTHORITATIVE. Nothing here adds up pay: every total, variance and journal line is what the
 * server sent, shown as it sent it. Where a payload does not carry a figure (an older server, or a caller without
 * `payroll.salary.view`) the screen says so instead of working one out.
 *
 * Maker-checker (PAY-RUN-08) is the server's to enforce; `approvalBlock()` only stops offering a button the server
 * would refuse, and says why.
 */

export type RunStatus = 'draft' | 'calculating' | 'calculated' | 'submitted' | 'approved' | 'locked' | 'paying' | 'paid' | 'failed' | 'cancelled' | 'rejected';

export interface Run {
  id: number;
  sequence?: number;
  kind: string;
  status: RunStatus | string;
  employee_count?: number;
  currency?: string | null;
  period_id?: number;
  period_code?: string | null;
  period_name?: string | null;
  period_starts_on?: string | null;
  period_ends_on?: string | null;
  group_code?: string | null;
  group_name?: string | null;
  gross_total?: string | null;
  net_total?: string | null;
  deduction_total?: string | null;
  employer_total?: string | null;
  addition_total?: string | null;
  exception_count?: number | string | null;
  created_by?: number | string | null;
  calculated_by?: number | string | null;
  /** Who prepared it, where the server names them (v1.1). */
  prepared_by?: { id: number; name?: string | null } | null;
  created_at?: string | null;
  locked_at?: string | null;
  replaced?: boolean;
  reference?: string | null;
}

export interface RunList {
  items: Run[];
  total: number;
  page: number;
  per_page: number;
  figures: boolean;
  statuses: string[];
  kinds: string[];
}

export interface RunPayslip {
  id: number;
  employee_id: number;
  employee_no?: string | null;
  employee_name?: string | null;
  department?: string | null;
  designation?: string | null;
  paid_days?: string | null;
  unpaid_days?: string | null;
  status?: string;
  balanced?: number;
  gross?: string;
  deductions?: string;
  net?: string;
  employer_cost?: string;
}

export interface RunException {
  id: number;
  code: string;
  severity: 'blocking' | 'warning' | string;
  message?: string | null;
  employee_id?: number | null;
  employee_name?: string | null;
  status?: string | null;
  accepted_by?: number | null;
}

export interface Approval {
  step: number;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | string;
  label?: string | null;
  decided_by?: number | null;
  decided_by_name?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
  requested_by?: number | null;
  condition?: string | null;
}

export interface RunDetail {
  run: Run;
  payslips: RunPayslip[];
  exceptions: RunException[];
  counts: { blocking: number; warning: number; codes?: Record<string, number> | unknown[] };
  self_employee_id: number | null;
  approvals?: Approval[];
  can: { figures: boolean; calculate: boolean; submit: boolean; approve: boolean; reopen: boolean; edit: boolean; reject?: boolean };
}

/** The run against the previous effective run (`GET runs/{id}/variance`, PAY-RUN-06), as the server measured it. */
export interface VarianceRow {
  code?: string;
  label: string;
  prev: string | null;
  current: string | null;
  diff: string | null;
  pct: string | number | null;
  flagged: boolean;
}

export interface VarianceEmployee {
  employee_id: number;
  name: string;
  prev_net: string | null;
  net: string | null;
  diff: string | null;
  pct: string | number | null;
  flagged: boolean;
  why?: string | null;
}

export interface Variance {
  previous_run_id: number | null;
  threshold: string | number;
  employees: VarianceEmployee[];
  components: VarianceRow[];
  totals: { prev_net: string | null; net: string | null; diff: string | null; pct: string | number | null };
}

export interface JournalLine {
  account_code?: string | null;
  account_name?: string | null;
  role?: string | null;
  debit?: string | null;
  credit?: string | null;
}

export interface Posting {
  ok: boolean;
  problems: string[];
  journal_id: number | null;
  posted: boolean;
  can: { post: boolean };
  /** The journal it would write, where the server previews it (v1.1). */
  lines?: JournalLine[];
  totals?: { debit: string; credit: string; balanced: boolean } | null;
  source?: string | null;
  posts_on?: string | null;
  /** The last refused posting of this run, by hand or by the nightly queue (Payroll 1.5). */
  last_attempt?: { at: string | null; problems: string[] } | null;
}

export interface PayrollAccess {
  scope: { kind: 'all' | 'team' | 'self' | 'none'; reach?: string; why?: string };
  figures: boolean;
  figures_why?: string;
  linked: boolean;
  /** The slugs this person holds, where the server lists them. */
  can?: Record<string, boolean>;
}

export const K = {
  access: ['payroll', 'access'] as const,
  runs: (status: string, page: number) => ['payroll', 'runs', status, page] as const,
  run: (id: number) => ['payroll', 'run', id] as const,
  posting: (id: number) => ['payroll', 'posting', id] as const,
  variance: (id: number) => ['payroll', 'variance', id] as const,
};

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  calculating: 'Calculating',
  calculated: 'Calculated',
  submitted: 'In review',
  approved: 'Approved',
  locked: 'Locked',
  paying: 'Paying',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

export const KIND_LABEL: Record<string, string> = { regular: 'Regular', off_cycle: 'Off-cycle', correction: 'Correction', bonus: 'Bonus', reversal: 'Reversal' };

export const fetchAccess = (signal?: AbortSignal) => apiGet<PayrollAccess>('/api/payroll/access', undefined, signal);
export const fetchRuns = (status: string, page: number, signal?: AbortSignal) => apiGet<RunList>('/api/payroll/runs', { status: status || undefined, page, per_page: 25 }, signal);
export const fetchRun = (id: number, signal?: AbortSignal) => apiGet<RunDetail>(`/api/payroll/runs/${id}`, undefined, signal);
export const fetchPosting = (id: number, signal?: AbortSignal) => apiGet<Posting>(`/api/payroll/runs/${id}/posting`, undefined, signal);

/** A server without the variance endpoint answers 404: "no variance to show", not an error. */
export async function fetchVariance(id: number, signal?: AbortSignal, threshold?: number): Promise<Variance | null> {
  return orNull(apiGet<Variance>(`/api/payroll/runs/${id}/variance`, threshold ? { threshold } : undefined, signal));
}

export function approveRun(id: number, step: number, note: string): Promise<unknown> {
  return apiPost(`/api/payroll/runs/${id}/approve`, { step, note: note.trim() || undefined });
}

/** Rejecting needs a reason (SRS A9: "reason required on reject"), and it is sent trimmed. */
export function rejectRun(id: number, reason: string): Promise<unknown> {
  const r = reason.trim();
  if (!r) return Promise.reject(new Error('Say why this run is being sent back.'));
  return apiPost(`/api/payroll/runs/${id}/reject`, { reason: r });
}

export const submitRun = (id: number) => apiPost(`/api/payroll/runs/${id}/submit`, {});

/** The person who prepared a run, as far as the payload says. */
export function preparerOf(run: Run, approvals: Approval[] = []): number | null {
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  return n(run.prepared_by?.id) ?? n(approvals.find((a) => a.requested_by)?.requested_by) ?? n(run.calculated_by) ?? n(run.created_by);
}

/** The step waiting for a signature, lowest first. */
export function pendingStep(approvals: Approval[] = []): number {
  const open = approvals.filter((a) => a.status === 'pending').map((a) => a.step);
  return open.length ? Math.min(...open) : 1;
}

/**
 * Why this person may not approve this run now, or null when they may. The server decides; this mirrors its rules
 * so the button is not offered for a refusal: not in review, no permission, the preparer (maker-checker), blocking
 * exceptions outstanding, or already signed at another step.
 */
export function approvalBlock(d: Pick<RunDetail, 'run' | 'counts' | 'can' | 'approvals'>, me: number): string | null {
  if (d.run.status !== 'submitted') return 'Only a run that is in review can be approved.';
  if (!d.can.approve) return 'Approving a payroll run needs the payroll approve permission.';
  const prep = preparerOf(d.run, d.approvals);
  if (me > 0 && prep !== null && prep === me) return 'You prepared this run, so somebody else has to approve it.';
  if ((d.counts?.blocking ?? 0) > 0) return `${d.counts.blocking} blocking ${d.counts.blocking === 1 ? 'issue is' : 'issues are'} still open.`;
  if (me > 0 && (d.approvals ?? []).some((a) => a.status === 'approved' && Number(a.decided_by) === me) && (d.approvals ?? []).length > 1) return 'You have already approved this run at another step.';
  return null;
}

/** Same as approval, without the blocking-issue rule: sending a run back is always open to an approver who did not prepare it. */
export function rejectBlock(d: Pick<RunDetail, 'run' | 'can' | 'approvals'>, me: number): string | null {
  if (d.run.status !== 'submitted') return 'Only a run that is in review can be sent back.';
  if (!(d.can.reject ?? d.can.approve)) return 'Rejecting a payroll run needs the payroll approve permission.';
  const prep = preparerOf(d.run, d.approvals);
  if (me > 0 && prep !== null && prep === me) return 'You prepared this run, so somebody else has to review it.';
  return null;
}

/** "+2.1%" from what the server sent; null when it sent nothing. */
export function percent(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export const runTitle = (r: Run) => [r.period_name ?? r.period_code ?? `Run ${r.id}`, r.group_name ?? r.group_code, r.kind !== 'regular' ? KIND_LABEL[r.kind] ?? r.kind : null].filter(Boolean).join(' · ');

// ── the rest of the contract (docs/payroll-api.md, Payroll 1.2.0) ─────────────────────────────────────────────────

/** A 404 or 405 is "this server does not have it yet": the screen says so instead of failing. */
export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if ([404, 405].includes((e as { status?: number }).status ?? 0)) return null;
    throw e;
  }
}

export interface Dashboard {
  next_period: { id: number; name: string; starts_on: string; ends_on: string; attendance_cutoff: string | null; payment_date: string | null; days_to_cutoff: number | null } | null;
  runs_by_status: Record<string, number>;
  current_run: { id: number; status: string; net_total: string | null; employee_count: number } | null;
  open_exceptions: number;
  unposted: { runs: number; payments: number };
  pending_approvals: number;
  blackout: { active: boolean; from: string; to: string } | null;
  settlements_open: number;
  inputs_open: number;
  trend: Array<{ period: string; gross: string | null; net: string | null; employer: string | null; headcount: number }>;
}

export interface Group {
  id: number;
  org_id: number;
  code: string;
  name: string;
  currency: string;
  cadence: string;
  proration_basis?: string | null;
  is_active?: number | boolean;
  confidential?: boolean;
  employee_count?: number;
}

export interface Period {
  id: number;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  attendance_cutoff?: string | null;
  payment_date?: string | null;
  status: string;
}

export interface Enrolment {
  id: number;
  employee_id: number;
  employee_no?: string | null;
  employee_name?: string | null;
  name?: string | null;
  department?: string | null;
  group_id?: number | null;
  group_name?: string | null;
  basic?: string | null;
  currency?: string | null;
  bank_verified?: boolean | number | null;
  epf_no?: string | null;
  employee_status?: string | null;
  readiness?: string | null;
  cost_centre?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
}

export interface SalaryRevision {
  id: number;
  kind: string;
  effective_from: string;
  gross?: string | null;
  previous_gross?: string | null;
  status: string;
  reason?: string | null;
  proposed_by?: number | null;
  approved_by?: number | null;
  /** What the change puts into the next run for months already closed (D14), where the server works it out. */
  arrears?: string | null;
}

export interface Loan {
  id: number;
  reference?: string | null;
  employee_id: number;
  employee_name?: string | null;
  kind: string;
  principal: string;
  instalment: string | null;
  instalments?: number | null;
  recovered?: string | null;
  outstanding?: string | null;
  status: string;
  starts_on?: string | null;
  disbursed_at?: string | null;
  disbursement_journal_no?: string | null;
  recorded_by?: number | null;
}

export interface InputRow {
  id: number;
  employee_id: number;
  employee_name: string | null;
  component_code: string;
  component_kind?: string | null;
  amount: string | null;
  quantity: string | null;
  note: string | null;
  source: string | null;
  source_module: string | null;
  source_ref: string | null;
  status: 'open' | 'paid' | 'cancelled' | string;
  /** Payroll 1.6: the supporting file filed in Core Files, when there is one. */
  file_id?: number | string | null;
}

export interface ImportResult {
  dry_run: boolean;
  valid: number;
  errors: Array<{ row: number; error: string }>;
  preview: Array<Record<string, unknown>>;
  created: number[];
}

export interface Settlement {
  id: number;
  employee_id: number;
  employee_name: string | null;
  offboarding_case_id: number | null;
  last_working_date: string | null;
  status: string;
  net: string | null;
  open_items: number;
}

export interface SettlementItem {
  key: string;
  kind: 'earning' | 'deduction' | string;
  label: string;
  amount: string | null;
  source: string;
  ref: string | null;
  status: 'open' | 'done' | 'waived' | string;
  blocking: boolean;
}

export interface SettlementDetail {
  settlement: Settlement & { items: SettlementItem[] };
  clearance: Array<{ label: string; status: string; owner?: string | null }>;
  blocking: string[];
  totals: { earnings: string; deductions: string; net: string };
  can: { run: boolean };
}

export interface Batch {
  id: number;
  run_id?: number;
  reference?: string | null;
  method?: string | null;
  status: string;
  value_date?: string | null;
  line_count?: number;
  total?: string | null;
  currency?: string | null;
  failed?: number;
}

export interface BatchLine {
  id: number;
  employee_name: string | null;
  bank?: string | null;
  account?: string | null;
  amount: string | null;
  status: string;
}

export interface BatchDetail {
  batch: Batch;
  lines: BatchLine[];
  postings: Array<{ id: number; amount: string; journal_no: string | null }>;
  files: Array<{ id: number; sequence: number; format: string; file_name: string; file_sha256: string; line_count: number; created_at: string }>;
  can: Record<string, boolean>;
}

export interface Component {
  id: number;
  code: string;
  name: string;
  kind: string;
  class?: string | null;
  method?: string | null;
  version?: number | null;
  is_active?: number | boolean;
}

export interface Structure {
  id: number;
  code: string;
  name: string;
  is_active: boolean | number;
  items: Array<{ component_id: number; code: string; name: string; calc: string; amount?: string | null; percent?: string | null; formula?: string | null; sort?: number }>;
}

export interface Pack {
  rule_id: number;
  code: string;
  name: string;
  class: string;
  method: string;
  versions: Array<{ id: number; effective_from: string; effective_to: string | null; rate?: string | null; checksum?: string | null }>;
}

export interface Template {
  language: 'en' | 'si' | 'ta' | 'ar';
  show_employer_contributions: boolean;
  show_ytd: boolean;
  footer: string;
  logo: boolean;
  rtl?: boolean;
}

export interface SettingNode {
  group: string;
  key: string;
  label: string;
  type: 'bool' | 'int' | 'string' | 'enum' | string;
  default: unknown;
  value: unknown;
  fixed?: boolean;
  options?: string[];
}

export interface Report {
  run?: { id: number; period_name?: string | null; group_name?: string | null; currency?: string | null } | null;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, string | number | null>;
  can?: { export?: boolean };
}

export interface AuditItem {
  id: number;
  event: string;
  label?: string | null;
  actor_name?: string | null;
  created_at: string;
  reason?: string | null;
  after?: string | null;
}

export const P = '/api/payroll';
export const fetchDashboard = (signal?: AbortSignal) => orNull(apiGet<Dashboard>(`${P}/dashboard`, undefined, signal));
export const fetchGroups = (signal?: AbortSignal) => apiGet<{ groups: Group[]; can?: { edit?: boolean } }>(`${P}/groups`, undefined, signal);
export const fetchPeriods = (group: number, signal?: AbortSignal) => apiGet<{ periods: Period[] }>(`${P}/groups/${group}/periods`, undefined, signal);
export const generatePeriods = (group: number, year: number) => apiPost<{ created: unknown[]; skipped: number }>(`${P}/groups/${group}/periods/generate`, { year });
export const createRun = (period_id: number, kind: string) => apiPost<{ id?: number; run_id?: number }>(`${P}/runs`, { period_id, kind });
export const calculateRun = (id: number) => apiPost(`${P}/runs/${id}/calculate`, {});
export const validateRun = (id: number) =>
  apiPost<{ ok: boolean; blocking: Array<{ code: string; employee_id?: number; employee_name?: string; message: string }>; warnings: Array<{ code: string; employee_id?: number; employee_name?: string; message: string }>; counts: { employees: number; blocking: number; warnings: number } }>(`${P}/runs/${id}/validate`, {});
export const acceptException = (id: number, reason: string) => apiPost(`${P}/exceptions/${id}/accept`, { reason });
export const fetchEnrolments = (signal?: AbortSignal) => apiGet<{ enrolments: Enrolment[]; can?: { edit?: boolean } }>(`${P}/enrolments`, undefined, signal);
export const fetchSalary = (employee: number, signal?: AbortSignal) => apiGet<{ revisions: SalaryRevision[]; enrolment: Enrolment | null; kinds: string[] }>(`${P}/employees/${employee}/salary`, undefined, signal);
export const proposeSalary = (employee: number, body: { kind: string; effective_from: string; gross: string; reason: string }) => apiPost(`${P}/employees/${employee}/salary`, body);
export const approveSalary = (id: number) => apiPost(`${P}/salary-revisions/${id}/approve`, {});
export const fetchLoans = (employee?: number, signal?: AbortSignal) => apiGet<{ loans: Loan[]; can?: Record<string, boolean> }>(`${P}/loans`, employee ? { employee } : undefined, signal);
export const approveLoan = (id: number) => apiPost(`${P}/loans/${id}/approve`, {});
export const cancelLoan = (id: number, reason: string) => apiPost(`${P}/loans/${id}/cancel`, { reason });
export const fetchInputs = (period: number, signal?: AbortSignal) => orNull(apiGet<{ inputs: InputRow[]; locked: boolean }>(`${P}/periods/${period}/inputs`, undefined, signal));
export const addInput = (period: number, row: { employee_id: number; component_code: string; amount: string; quantity?: string; note?: string }) => apiPost(`${P}/periods/${period}/inputs`, row);
export const importInputs = (period: number, csv: string, dryRun: boolean) => apiPost<ImportResult>(`${P}/periods/${period}/inputs/import`, { csv, dry_run: dryRun });
export const cancelInput = (id: number, reason: string) => apiPost(`${P}/inputs/${id}/cancel`, { reason });
export const fetchSettlements = (signal?: AbortSignal) => orNull(apiGet<{ settlements: Settlement[] }>(`${P}/settlements`, undefined, signal));
export const fetchSettlement = (id: number, signal?: AbortSignal) => apiGet<SettlementDetail>(`${P}/settlements/${id}`, undefined, signal);
export const settlementRun = (id: number) => apiPost<{ run_id: number }>(`${P}/settlements/${id}/run`, {});
export const refreshSettlement = (id: number) => apiPost(`${P}/settlements/${id}/refresh`, {});
export const fetchPayouts = (run: number, signal?: AbortSignal) => apiGet<{ batches: Batch[]; can?: Record<string, boolean> }>(`${P}/runs/${run}/payouts`, undefined, signal);
export const fetchBatch = (id: number, signal?: AbortSignal) => apiGet<BatchDetail>(`${P}/payouts/${id}`, undefined, signal);
export const createBatch = (run: number) => apiPost<{ id?: number; batch_id?: number }>(`${P}/runs/${run}/payouts`, {});
export const approveBatch = (id: number) => apiPost(`${P}/payouts/${id}/approve`, {});
export const bankFile = (id: number) => apiPost<{ file_name?: string; name?: string; content?: string; base64?: string; sha256?: string; file_sha256?: string }>(`${P}/payouts/${id}/file`, {});
export const markSent = (id: number, reference: string) => apiPost(`${P}/payouts/${id}/sent`, { reference });
export const markPaid = (id: number, reference: string) => apiPost<{ settled: number; posting: { journal_no: string | null } | null; problems: string[] }>(`${P}/payouts/${id}/mark-paid`, { reference });
export const fetchComponents = (signal?: AbortSignal) => apiGet<{ components: Component[]; can?: { edit?: boolean } }>(`${P}/components`, undefined, signal);
export const fetchStructures = (signal?: AbortSignal) => orNull(apiGet<{ structures: Structure[] }>(`${P}/structures`, undefined, signal));
export const fetchPacks = (signal?: AbortSignal) => orNull(apiGet<{ packs: Pack[] }>(`${P}/statutory/packs`, undefined, signal));
export const fetchTemplate = (signal?: AbortSignal) => orNull(apiGet<Template>(`${P}/payslip-template`, undefined, signal));
export const saveTemplate = (t: Template) => apiPut(`${P}/payslip-template`, t);
export const fetchSettings = (signal?: AbortSignal) => orNull(apiGet<{ settings: Record<string, unknown>; tree: SettingNode[] }>(`${P}/settings`, undefined, signal));
export const saveSettings = (v: Record<string, unknown>) => apiPut(`${P}/settings`, v);
export const fetchReport = (key: string, run: number | null, extra: Record<string, string | number | undefined> = {}, signal?: AbortSignal) => orNull(apiGet<Report>(`${P}/reports/${key}`, { run: run ?? undefined, ...extra }, signal));
export const fetchAudit = (run: number, signal?: AbortSignal) => apiGet<{ items: AuditItem[]; total: number }>(`${P}/audit`, { run }, signal);

/** The keys of the report menu (D21) and the statutory classes (D11). */
export const REPORTS: Array<{ key: string; label: string; group: string }> = [
  { key: 'register', label: 'Payroll register', group: 'Runs' },
  { key: 'variance', label: 'Variance', group: 'Runs' },
  { key: 'bank', label: 'Bank summary', group: 'Runs' },
  { key: 'departments', label: 'By department', group: 'Cost' },
  { key: 'trend', label: '12-month trend', group: 'Cost' },
  { key: 'components', label: 'By component', group: 'Cost' },
  { key: 'ytd', label: 'Year to date', group: 'Statutory' },
  { key: 'loans', label: 'Loans', group: 'Statutory' },
];
export const STATUTORY = [
  { cls: 'epf', label: 'EPF – C form' },
  { cls: 'etf', label: 'ETF return' },
  { cls: 'paye', label: 'APIT schedule' },
];

/**
 * Splits a CSV the person dropped into rows for the import preview. The server checks every row (dry run) before
 * anything is saved; this only reads the file, so the count shown while dropping is honest.
 */
export function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) out.push(row);
  return out;
}

/** The run statuses the runs list counts (D02 pills), in the order the design shows them. */
export const PILLS = ['draft', 'submitted', 'locked', 'paying', 'paid', 'cancelled'];

// ── Payroll 1.3–1.6 (docs/payroll-api.md): holds, partial recalculation, reversal, attachments, expenses,
// assignment CSV, statutory identifiers, gratuity provision. Each answers null on a server without it (404/405). ──

export interface Hold {
  id: number;
  employee_id: number;
  action: 'hold' | 'exclude' | string;
  reason: string | null;
  created_by?: number | null;
  created_at?: string | null;
  released_at?: string | null;
  released_by?: number | null;
  release_note?: string | null;
}

export const fetchHolds = (run: number, signal?: AbortSignal) => orNull(apiGet<{ holds: Hold[] }>(`${P}/runs/${run}/holds`, undefined, signal));
export const addHold = (run: number, body: { employee_id: number; action: 'hold' | 'exclude'; reason: string }) => apiPost<{ id: number }>(`${P}/runs/${run}/holds`, body);
export const releaseHold = (id: number, note: string) => apiPost(`${P}/holds/${id}/release`, { note });
export const recalculateSelected = (run: number, employeeIds: number[]) =>
  apiPost<{ employees: number; net: string | null; exceptions: { blocking: number; warning: number } }>(`${P}/runs/${run}/recalculate`, { employee_ids: employeeIds });
/** PAY-RUN-01: the reversal run (kind `reversal`, locked, empty) supersedes this one; the server reverses the journal. */
export const reverseRun = (run: number, reason: string) => apiPost<{ run_id: number }>(`${P}/runs/${run}/reverse`, { reason });
/** Statuses a run can be reversed from: it is effective (locked or further) and not already replaced. */
export const reversible = (r: Run) => ['locked', 'paying', 'paid'].includes(r.status) && !r.replaced && r.kind !== 'reversal';

/** PAY-INP-04: a supporting file on an input, filed in Core Files. */
export function uploadInputAttachment(input: number, file: File): Promise<{ file_id: number | string }> {
  const form = new FormData();
  form.append('file', file, file.name);
  return request<{ file_id: number | string }>('POST', `${P}/inputs/${input}/attachment`, { body: form }).then((r) => r.data);
}
export const ATTACHMENT_MAX = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = /\.(pdf|png|jpe?g|webp|csv|txt)$/i;

export interface ClaimableExpense { id: number; claim_no: string | null; user_id?: number; claimant: string | null; employee_id: number | null; employee_no?: string | null; base_amount: string; spent_on: string | null; description: string | null }
export const fetchClaimable = (org: number, signal?: AbortSignal) => orNull(apiGet<{ enabled: boolean; claims: ClaimableExpense[] }>(`${P}/expenses/claimable`, { org_id: org }, signal));
export const sendExpenses = (org: number, claimIds?: number[]) => apiPost<{ sent: number; failed: Array<{ claim: number; error: string }> }>(`${P}/expenses/send`, { org_id: org, ...(claimIds ? { claim_ids: claimIds } : {}) });

/** PAY-ASG-06: the pay assignments as the server writes them (CSV text), or null on a server without it. */
export async function exportEnrolments(org: number, gross: boolean): Promise<string | null> {
  const res = await fetch(apiUrl(`${P}/enrolments/export`, { org_id: org, gross: gross ? 1 : undefined }), { headers: { Accept: 'text/csv' } });
  if (res.status === 404 || res.status === 405) return null;
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { message?: string } | null;
    throw Object.assign(new Error(j?.message ?? `The server answered ${res.status}.`), { status: res.status });
  }
  return res.text();
}
export interface EnrolmentImport { dry_run: boolean; valid: number; errors: Array<{ row: number; error: string }>; preview: Array<{ row: number; employee_no: string; group_code: string; action: string }>; enrolled?: number; updated?: number; proposed?: number }
/** A 422 carries the same body (nothing written): it is shown, not thrown. */
export async function importEnrolments(org: number, csv: string, dryRun: boolean): Promise<EnrolmentImport> {
  try {
    return await apiPost<EnrolmentImport>(`${P}/enrolments/import`, { org_id: org, csv, dry_run: dryRun });
  } catch (e) {
    const x = e as { status?: number; data?: unknown };
    const d = x.data as Partial<EnrolmentImport> | null | undefined;
    if (x.status === 422 && d && typeof d === 'object' && Array.isArray(d.errors)) return { dry_run: true, valid: d.valid ?? 0, preview: d.preview ?? [], ...d, errors: d.errors };
    throw e;
  }
}

export type StatutoryKind = 'nic' | 'tin' | 'epf_no' | 'etf_no' | 'gpssa_no' | 'emirates_id' | 'labour_card';
export interface StatutoryId { kind: StatutoryKind | string; label: string; set: boolean; last4: string | null; updated_at: string | null }
export interface StatutoryIds { ids: StatutoryId[]; can: { edit?: boolean; reveal?: boolean }; duplicates?: string[] }
export const fetchStatutoryIds = (employee: number, signal?: AbortSignal) => orNull(apiGet<StatutoryIds>(`${P}/employees/${employee}/statutory-ids`, undefined, signal));
export const saveStatutoryIds = (employee: number, values: Record<string, string>) => apiPut<StatutoryIds>(`${P}/employees/${employee}/statutory-ids`, values);
/** The server writes the audit row before it answers; the value is shown, never kept. */
export const revealStatutoryId = (employee: number, kind: string) => apiPost<{ kind: string; value: string }>(`${P}/employees/${employee}/statutory-ids/${encodeURIComponent(kind)}/reveal`, {});
/** What the server takes: letters, digits, `-` and `/`, at most 40; empty clears. */
export const statutoryIdOk = (v: string) => v === '' || /^[A-Za-z0-9/-]{1,40}$/.test(v);

export interface GratuityAccrual { id: number; as_of: string; pack: string | null; employees: number; liability: string; delta: string; status: string; journal_no: string | null; problems: string[] | null }
export interface GratuityProvision {
  pack: string | null;
  as_of: string;
  liability: string;
  employees: Array<{ employee_id: number; employee_no: string | null; name: string | null; amount: string; basis: string | null }>;
  accruals: GratuityAccrual[];
  can: { accrue?: boolean };
}
export const fetchGratuity = (org: number, asOf: string | null, signal?: AbortSignal) => orNull(apiGet<GratuityProvision>(`${P}/gratuity/provision`, { org_id: org, as_of: asOf ?? undefined }, signal));
export const accrueGratuity = (org: number, asOf: string) => apiPost<{ accrual: GratuityAccrual }>(`${P}/gratuity/accrue`, { org_id: org, as_of: asOf });

/** The companies the person's pay groups are in, for the endpoints that take `org_id`. */
export const groupCompanies = (groups: Group[] | undefined): number[] => [...new Set((groups ?? []).map((g) => g.org_id).filter((x) => Number.isFinite(x) && x > 0))];

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/csv': 'csv', 'text/plain': 'txt' };

/** The attachment's file name as the server sends it (headers only; the body is left unread), for saving it. */
export async function attachmentName(input: number): Promise<string> {
  const fallback = `Input ${input} attachment`;
  const ctl = new AbortController();
  try {
    const res = await fetch(apiUrl(`${P}/inputs/${input}/attachment`), { signal: ctl.signal });
    const cd = res.headers.get('content-disposition') ?? '';
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
    const ext = EXT[(res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()];
    ctl.abort();
    const name = named ? decodeURIComponent(named).replace(/[/\\]/g, '-').trim() : '';
    return name || (ext ? `${fallback}.${ext}` : fallback);
  } catch {
    return fallback;
  }
}
