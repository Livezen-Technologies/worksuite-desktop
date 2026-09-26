import { useQuery } from '@tanstack/react-query';
import { app } from '../../core/app-state';
import { apiGet } from '../../core/api';
import { useStore } from '../../core/store';
import { can } from './Rail';

/**
 * The HR screens' server shapes, as the web's own HR screens read them (the
 * same endpoints, so the desktop and the web cannot disagree about a leave
 * balance or a payslip). Stamps named `*_on` / `on_date` are calendar days;
 * attendance times are wall-clock times on the company's clock.
 */

// ── the dashboard (hr.view) ──────────────────────────────────────────────
export interface HrOverview {
  total: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  pending_leave: number;
  open_attendance?: number;
  unlinked: number;
  out_today: Array<{ name: string; type: string; until: string }>;
  upcoming_holidays: Array<{ on_date: string; name: string }>;
  recent_joiners: Array<{ name: string; joined_at: string }>;
  onboarding?: { total: number; items: Array<{ employee_id: number; name: string; percent: number; next: string | null; target_start_date: string | null }> };
}

// ── my profile ───────────────────────────────────────────────────────────
export interface ProfileHeader {
  id: number;
  employee_no: string;
  user_id: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  department: string | null;
  designation: string | null;
  organisation: string | null;
  type: string;
  status: string;
  joined_at: string | null;
}

export interface Employment {
  employee_no: string;
  type: string;
  status: string;
  job_level: string | null;
  work_location: string | null;
  joined_at: string | null;
  confirmed_at: string | null;
  probation_ends_at: string | null;
  contract_starts_at: string | null;
  contract_ends_at: string | null;
  exit_at: string | null;
  manager: { id: number; name: string } | null;
  shift: string | null;
  reports: Array<{ id: number; name: string; designation: string | null; status: string }>;
}

export interface EmpRequest {
  id: number;
  employee_id: number;
  employee: string | null;
  employee_no: string | null;
  kind: string;
  kind_label: string;
  subject: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  applied_note: string | null;
  can_decide: boolean;
  can_cancel: boolean;
}

export interface Profile {
  linked?: boolean;
  message?: string;
  employee: ProfileHeader;
  can: Record<string, boolean>;
  is_self: boolean;
  editable: boolean;
  unavailable: Record<string, string>;
  employment?: Employment;
  personal?: Record<string, string | boolean | null | undefined>;
  attendance?: {
    month: string;
    days_present: number;
    work_days: number;
    net_seconds: number;
    overtime_minutes: number;
    late_days: number;
    missing_check_outs: number;
    recent: Array<{ on_date: string; check_in: string | null; check_out: string | null; net_seconds: number | null; state: string; late_minutes: number; work_location: string | null }>;
  };
  leave?: {
    balances: Array<{ type: string; type_id: number; entitled?: number; used?: number; available?: number; pending?: number }>;
    recent: Array<{ id: number; starts_on: string; ends_on: string; days: string; status: string; reason: string | null; type_name: string | null }>;
  };
  requests: EmpRequest[];
}

// ── attendance ───────────────────────────────────────────────────────────
export interface AttDay {
  id: number;
  on_date: string;
  check_in: string | null;
  check_out: string | null;
  work_location: string | null;
  corrected: boolean;
  holiday?: string | null;
  shift: string | null;
  is_work_day: boolean;
  break_seconds: number;
  net_seconds: number | null;
  late_minutes: number;
  early_minutes: number;
  overtime_minutes: number;
  state: string;
  verdict?: string;
  open_state?: string | null;
  leave_type?: string;
}

export interface AttTotals {
  days_present: number;
  work_days: number;
  attendance_rate: number | null;
  net_seconds: number;
  break_seconds: number;
  overtime_minutes: number;
  late_days: number;
  early_days: number;
  missing_check_outs: number;
}

export const STATE_LABEL: Record<string, string> = {
  working: 'Working',
  on_break: 'On break',
  complete: 'Complete',
  missing_check_out: 'No check-out',
  absent: 'Absent',
  leave: 'On leave',
  off: 'Non-working day',
  holiday: 'Holiday',
};

export const VERDICT_LABEL: Record<string, string> = {
  present: 'Present',
  late: 'Late',
  early_leave: 'Early leave',
  half_day: 'Half day',
  absent: 'Absent',
  on_leave: 'On leave',
  off: 'Non-working day',
};

/** What one day of history says, as the design words it ("Late · 42m late"). */
export function dayStatus(d: AttDay): string {
  if (d.state === 'working' || d.state === 'on_break') return STATE_LABEL[d.state]!;
  if (d.holiday && !d.check_in) return 'Holiday';
  if (d.open_state === 'corrected' || d.corrected) return 'Manually corrected';
  if (d.state === 'missing_check_out') return 'No check-out';
  const v = d.verdict ?? '';
  if (v === 'late') return `Late · ${d.late_minutes}m late`;
  if (v === 'early_leave') return `Early leave · ${d.early_minutes}m early`;
  return VERDICT_LABEL[v] ?? STATE_LABEL[d.state] ?? d.state;
}

// ── timesheet ────────────────────────────────────────────────────────────
export interface TimeLog {
  id: number;
  on_date: string;
  project_id: number | null;
  project: string | null;
  task_id: number | null;
  task: string | null;
  task_number: string | null;
  description: string;
  started_at: string | null;
  ended_at: string | null;
  minutes: number;
  billable: boolean;
  running: boolean;
  timesheet_id: number | null;
  approved: boolean;
  invoiced: boolean;
  locked: boolean;
}

export interface LogsResponse {
  from: string;
  to: string;
  employee_id: number;
  logs: TimeLog[];
  days: Array<{ on_date: string; minutes: number; billable_minutes: number; logs: number; check_in: string | null; check_out: string | null }>;
  totals: { minutes: number; billable_minutes: number; entries: number };
  by_project: Array<{ id: number | null; label: string; minutes: number }>;
  by_task: Array<{ id: number | null; label: string; minutes: number }>;
}

export interface Sheet {
  id: number;
  employee_id: number;
  employee: string | null;
  starts_on: string;
  ends_on: string;
  status: string;
  note: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  minutes: number;
  can_decide: boolean;
}

// ── leave ────────────────────────────────────────────────────────────────
export interface LeaveType {
  id: number;
  name: string;
  code: string | null;
  days_per_year: string | number;
  paid: boolean | number;
  requires_approval: boolean | number;
  status: string;
  allows_half_day?: boolean;
  allows_short_leave?: boolean;
}

export interface LeaveTypes {
  types: LeaveType[];
  portions: Record<string, string>;
  day_minutes: number;
  half_day_days: number;
  short_max_minutes: number;
}

export interface LeaveReq {
  id: number;
  employee_id: number;
  employee_no: string | null;
  employee_name: string | null;
  type_name: string | null;
  starts_on: string;
  ends_on: string;
  days: string;
  status: string;
  reason: string | null;
  portion?: string;
  minutes?: number | null;
  starts_at?: string | null;
  responsible_person_id?: number | null;
  responsible_status?: string | null;
  responsible_note?: string | null;
  resubmit_note?: string | null;
  can_decide?: boolean;
  decide_as?: string;
}

export interface Balance {
  type: string;
  type_id: number;
  entitled: number;
  carried_in?: number;
  taken: number;
  available: number;
}

export interface CoverAsk {
  id: number;
  employee_name: string;
  employee_no: string | null;
  type_name: string;
  starts_on: string;
  ends_on: string;
  days: number;
  reason: string | null;
  asked_at: string | null;
}

export interface LeaveReview {
  request: { id: number; type_name: string | null; paid: boolean | null; starts_on: string; ends_on: string; days: number; portion: string; minutes: number | null; starts_at: string | null; reason: string | null; status: string; requested_on: string | null; notice_days: number | null };
  employee: { id: number; name?: string | null; department?: string | null; job_title?: string | null };
  balances: Array<{ type_id: number; type_name: string; requested: boolean; entitled: number; taken: number; remaining: number }>;
  pending: { count: number; days: number };
  history: { year: number; approved_days: number; approved_count: number; rejected_count: number; cancelled_count: number };
  overlap: { department_known: boolean; items: Array<{ employee_name: string | null; type_name: string | null; starts_on: string; ends_on: string; days: number }> };
  attendance: { window_days: number; days_present: number; days_late: number; missing_check_outs: number } | null;
  responsible: { user_id: number; name: string; status: string | null; note: string | null } | null;
  evidence: Array<{ id: number; title: string; filename: string; url: string }>;
}

// ── requests ─────────────────────────────────────────────────────────────
export interface RequestsResponse {
  requests: EmpRequest[];
  kinds: Record<string, string>;
  pending: number;
}

export const PROFILE_FIELDS: Array<[string, string]> = [
  ['personal_email', 'Personal email'],
  ['mobile', 'Mobile'],
  ['telephone', 'Telephone'],
  ['preferred_name', 'Preferred name'],
  ['marital_status', 'Marital status'],
  ['emergency_name', 'Emergency contact'],
  ['emergency_relation', 'Emergency relationship'],
  ['emergency_phone', 'Emergency phone'],
  ['address_1', 'Address line 1'],
  ['address_2', 'Address line 2'],
  ['city', 'City'],
  ['province', 'Province / State'],
  ['postal_code', 'Postal code'],
  ['country', 'Country'],
];

// ── approvals ("Waiting on me") ──────────────────────────────────────────
export interface ApprovalsResponse {
  today: string;
  cards: { pending_leave: number; pending_requests: number; changes_requested: number; overdue: number; approved_today: number; declined_today: number; pending_resignations?: number; pending_offboarding?: number };
  leave: Array<{ id: number; employee_id: number; employee: string; type: string; starts_on: string; ends_on: string; days: number; reason: string | null; status: string; note: string | null; as: string; overdue: boolean }>;
  requests: Array<{ id: number; employee_id: number; employee: string; type: string; kind_key: string; subject: string | null; reason: string | null; status: string; created_at: string | null }>;
  resignations?: Array<{ id: number; employee: string; type: string; last_working_date: string | null; status: string }>;
  offboarding?: Array<{ id: number; case_id: number; employee: string; title: string; what: string; due_on: string | null }>;
}

// ── documents ────────────────────────────────────────────────────────────
export interface EmployeeDoc {
  id: number;
  title: string;
  category: string;
  category_label: string;
  visibility: string;
  visibility_label: string;
  status: 'active' | 'archived';
  filename: string;
  extension: string;
  mime: string | null;
  size: number;
  size_label: string;
  version: number;
  previewable: boolean;
  expires_on: string | null;
  expired: boolean;
  note: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface DocList {
  documents: EmployeeDoc[];
  total: number;
  categories: Record<string, string>;
  visibilities: Record<string, string>;
  counts: Record<string, number>;
  rights: { upload: boolean; replace: boolean; rename: boolean; archive: boolean; delete: boolean; visibility: boolean; events: boolean; is_self: boolean };
  limits: { max_bytes: number; types: string[] };
  linked?: boolean;
}

// ── pay ──────────────────────────────────────────────────────────────────
export interface Payslip {
  reference: string;
  period_name: string | null;
  period_starts_on: string | null;
  period_ends_on: string | null;
  payment_date: string | null;
  gross: string | null;
  deductions: string | null;
  net: string | null;
  currency?: string | null;
  paid_days: string | null;
  state: 'current' | 'under_revision' | 'cancelled';
  revision_note: string | null;
  payment: { state: 'paid' | 'instructed' | 'scheduled' | 'returned' | 'failed' | 'held' | 'not_scheduled'; on: string | null; detail: string | null };
}

export interface PayLine {
  component_code: string;
  label: string;
  kind: string;
  class: string;
  amount: string;
  rate: string | null;
  quantity: string | null;
}

export const PAYMENT_LABEL: Record<Payslip['payment']['state'], string> = {
  paid: 'Paid',
  instructed: 'Sent to your bank',
  scheduled: 'Scheduled',
  returned: 'Came back',
  failed: 'Did not go through',
  held: 'Waiting on your bank details',
  not_scheduled: 'Not scheduled yet',
};

/**
 * The rail's counts: requests waiting on me (my team's plus colleagues who
 * named me as cover) and everything in "Waiting on me" — the same sums as
 * the web's badges.
 */
export function useHrCounts(): { requests: number; waiting: number; reviewsTimesheets: boolean } {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const staff = can(perms, 'hr.view');
  const team = useQuery({ queryKey: ['hr', 'requests', 'team', 'pending'], queryFn: ({ signal }) => apiGet<RequestsResponse>('/api/hr/requests', { scope: 'team', status: 'pending' }, signal), retry: false, staleTime: 30_000 });
  const cover = useQuery({ queryKey: ['hr', 'cover', 'mine'], queryFn: ({ signal }) => apiGet<{ requests: CoverAsk[] }>('/api/hr/leave/cover/mine', undefined, signal), retry: false, staleTime: 30_000 });
  const approvals = useQuery({ queryKey: ['hr', 'leave-approvals'], queryFn: ({ signal }) => apiGet<ApprovalsResponse>('/api/hr/leave/approvals', undefined, signal), retry: false, staleTime: 30_000 });
  const access = useQuery({ queryKey: ['hr', 'access'], queryFn: ({ signal }) => apiGet<{ timesheets?: { review?: boolean } }>('/api/hr/access', undefined, signal), enabled: staff, retry: false, staleTime: 300_000 });
  const c = approvals.data?.cards;
  return {
    requests: (team.data?.pending ?? 0) + (cover.data?.requests.length ?? 0),
    waiting: (c?.pending_leave ?? 0) + (c?.pending_requests ?? 0) + (c?.changes_requested ?? 0) + (c?.pending_resignations ?? 0) + (c?.pending_offboarding ?? 0),
    reviewsTimesheets: can(perms, 'hr.manage') || access.data?.timesheets?.review === true,
  };
}

/** Money as the server writes it ("312,450.00"), with the currency the design shows. */
export function money(v: string | null | undefined, currency = 'LKR'): string {
  return v == null || v === '' ? '—' : `${currency} ${v}`;
}
