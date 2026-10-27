import { apiDelete, apiGetMeta, apiPost, apiPut } from '../../core/api';
import { API, type Can, type Task, type TaskStatus, type TimeEntry } from './api';
import { orgParam, withOrg } from './company';

/**
 * Projects' delivery screens — Timeline & Gantt, Milestones, Sprints, Team workload and Time & approvals — the
 * shapes they read and every call they make. The contract is the web's (worksuite web/src/pages/project/types.ts and
 * api.ts), field for field; the same endpoints, through the app's API proxy, so READ_CACHE keeps each answer for
 * offline. Portfolio-level reads carry the chosen company (`withOrg`) in the request and in the query key; a read
 * about one project carries none.
 *
 * Every write here needs WorkSuite: none is safe to replay later (an approval, an invoice, a sprint's start), so
 * the screens disable them offline. Logging time is the exception, and goes through the outbox (`desk.ts: submit`).
 */

type Signal = { signal?: AbortSignal };
type Params = Record<string, string | number | boolean | null | undefined>;

/** Drops empty values so a filter left at "any" is not sent. */
export function clean(p: Params = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    out[k] = v === true ? '1' : String(v);
  }
  return out;
}

// ── shapes ─────────────────────────────────────────────────────────────────

export type DependencyType = 'finish_start' | 'start_start' | 'finish_finish';

export interface ScheduleTask {
  id: number;
  task_number: string | null;
  title: string;
  status: TaskStatus;
  progress: number;
  start_date: string | null;
  due_date: string | null;
  estimated_hours: string | null;
  duration_days: number;
  earliest_start: number;
  earliest_finish: number;
  latest_start: number;
  latest_finish: number;
  slack: number;
  critical: boolean;
  /** Calendar dates from the project start, skipping weekends and HR holidays. */
  start: string | null;
  finish: string | null;
  milestone_id: number | null;
}

/** GET /projects/{id}/schedule */
export interface Schedule {
  tasks: ScheduleTask[];
  dependencies: Array<{ id: number; task_id: number; depends_on_id: number; type: DependencyType; lag_days: number }>;
  duration_days: number;
  critical_path: number[];
  cycle: number[] | null;
  hours_per_day: number;
  project_start: string | null;
  planned_end: string | null;
  baseline_end: string | null;
  forecast_finish: string | null;
  /** Working days between the planned end and the forecast; negative = early. */
  working_days_late: number | null;
  milestones: Array<{ id: number; name: string; due_date: string | null; status: string }>;
  holidays: string[];
  /** ISO weekday numbers, 1 = Monday. */
  working_days: number[];
}

export type InvoiceStatus = 'not_billable' | 'not_invoiced' | 'ready' | 'invoiced';

export interface Milestone {
  id: number;
  project_id: number;
  project: string;
  project_code: string;
  name: string;
  due_date: string | null;
  status: 'open' | 'achieved' | 'missed' | 'cancelled';
  owner: string | null;
  owner_id: number | null;
  bill_amount: string;
  currency: string;
  tasks: number;
  tasks_done: number;
  progress: number;
  overdue: boolean;
  days: number | null;
  achieved_at: string | null;
  description: string | null;
  achieved_note: string | null;
  /** The Billing invoice the milestone's line is on (null until invoiced); its number stays null while a draft. */
  invoice_status: InvoiceStatus;
  invoice_id: number | null;
  invoice_number: string | null;
  invoice_paid: boolean;
}

/** GET /projects/milestones */
export interface MilestoneListResponse {
  milestones: Milestone[];
  counts: { open: number; overdue: number; achieved: number; missed: number; all: number };
  ready: { total: string; currency: string; count: number };
  can: Can;
}

/** POST /projects/milestones/invoice — the drafts Billing made (number null until issued). */
export interface MilestoneInvoiceResult {
  invoices: Array<{ id: number; number: string | null }>;
  count: number;
  skipped: string[];
}

export interface SprintStats {
  total_points: number;
  done_points: number;
  total_tasks: number;
  done_tasks: number;
  committed_points: number;
  added_points: number;
  percent: number;
  days: Array<{ date: string; remaining: number | null; done: number | null; ideal: number }>;
}

export interface Sprint extends SprintStats {
  id: number;
  project_id: number;
  project: string;
  project_code: string;
  name: string;
  goal: string | null;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  start_date: string | null;
  end_date: string | null;
  retrospective: string | null;
  started_at: string | null;
}

export type SprintTask = Task & { story_points?: number | null };

/** GET /projects/sprints/{id} */
export interface SprintDetail {
  sprint: Sprint;
  tasks: SprintTask[];
  velocity: { sprints: Array<{ id: number; name: string; committed: number; delivered: number }>; average: number };
  /** Points still to burn per remaining working day, and a plain verdict. */
  forecast: { label: 'on_pace' | 'behind' | 'ahead' | 'not_started' | 'done'; needs_per_day: number | null; ideal_today: number | null };
  day_of: { day: number; of: number } | null;
  can: Can;
}

/** GET /projects/workload, GET /projects/{id}/workload */
export interface WorkloadGrid {
  /** The Monday of each week. */
  weeks: string[];
  people: Array<{ user_id: number; name: string; cells: Array<{ hours: string; capacity: string; percent: number | null }> }>;
}

export type TimeState = 'running' | 'pending' | 'approved' | 'sent_back' | 'submitted' | 'invoiced';

/** A time entry as the queue and the week read it: the base entry and what approval adds. */
export type QueueEntry = TimeEntry & {
  hours?: string;
  approver?: string | null;
  lock_reason?: string | null;
  sent_back_note?: string | null;
  value?: string | null;
  currency?: string | null;
};

/** GET /projects/time/queue */
export interface TimeQueue {
  week_start: string;
  week_end: string;
  entries: QueueEntry[];
  /** Left out because they cannot be approved by you: your own and running timers. */
  skipped: { own: number; running: number };
  projects: Array<{ id: number; code: string; name: string }>;
  people: Array<{ id: number; name: string }>;
  can: Can;
}

export interface TimeSummaryRow {
  id: number;
  name: string;
  code: string | null;
  minutes: number;
  hours: string;
  billable_hours: string;
  duration: string;
}

/** GET /projects/time/summary */
export interface TimeSummary {
  from: string;
  to: string;
  by_project: TimeSummaryRow[];
  by_user: TimeSummaryRow[];
}

export interface MemberLite {
  id: number;
  user_id: number;
  name: string;
  role: string;
}

// ── query keys (under ['projects'], so the outbox's refresh reaches them) ──

export const dqk = {
  schedule: (id: number) => ['projects', 'schedule', id] as const,
  milestones: (p: Params) => ['projects', 'milestones', clean(withOrg(p))] as const,
  sprints: (p: Params) => ['projects', 'sprints', clean(withOrg(p))] as const,
  sprint: (id: number) => ['projects', 'sprint', id] as const,
  workload: (id: number | null) => ['projects', 'workload', id, id ? '' : orgParam()] as const,
  timeQueue: (p: Params) => ['projects', 'time', 'queue', clean(withOrg(p))] as const,
  timeSummary: (p: Params) => ['projects', 'time', 'summary', clean(withOrg(p))] as const,
  liveProjects: () => ['projects', 'live', orgParam()] as const,
  tasksOf: (id: number) => ['projects', 'tasks', id, 'open'] as const,
};

// ── reads ──────────────────────────────────────────────────────────────────

export const dread = {
  schedule: (id: number, { signal }: Signal = {}) => apiGetMeta<Schedule>(`${API}/${id}/schedule`, undefined, signal),
  /** status=open|overdue|achieved|missed|all, project_id */
  milestones: (p: Params, { signal }: Signal = {}) => apiGetMeta<MilestoneListResponse>(`${API}/milestones`, clean(withOrg(p)), signal),
  sprints: (p: Params, { signal }: Signal = {}) => apiGetMeta<{ sprints: Sprint[]; can?: Can }>(`${API}/sprints`, clean(withOrg(p)), signal),
  sprint: (id: number, { signal }: Signal = {}) => apiGetMeta<SprintDetail>(`${API}/sprints/${id}`, undefined, signal),
  workload: (projectId: number | null, { signal }: Signal = {}) => apiGetMeta<WorkloadGrid>(projectId ? `${API}/${projectId}/workload` : `${API}/workload`, projectId ? undefined : clean(withOrg()), signal),
  /** week (any date in it), project_id, user_id, billable=1|0 */
  timeQueue: (p: Params, { signal }: Signal = {}) => apiGetMeta<TimeQueue>(`${API}/time/queue`, clean(withOrg(p)), signal),
  /** from, to, project_id */
  timeSummary: (p: Params, { signal }: Signal = {}) => apiGetMeta<TimeSummary>(`${API}/time/summary`, clean(withOrg(p)), signal),
  /** The live projects in reach, for the pickers. */
  liveProjects: ({ signal }: Signal = {}) => apiGetMeta<{ projects: Array<{ id: number; code: string; name: string }> }>(API, clean(withOrg({ scope: 'live', per_page: 200 })), signal),
  /** A project's members, for owner pickers. */
  members: (id: number, { signal }: Signal = {}) => apiGetMeta<{ members?: MemberLite[] }>(`${API}/${id}`, undefined, signal),
  openTasks: (id: number, { signal }: Signal = {}) => apiGetMeta<{ tasks: Task[] }>(`${API}/tasks`, { project_id: id, open: 1 }, signal),
};

// ── writes (online only) ───────────────────────────────────────────────────

export const dwrite = {
  createMilestone: (body: Record<string, unknown>) => apiPost<{ id: number }>(`${API}/milestones`, body),
  updateMilestone: (id: number, body: Record<string, unknown>) => apiPut(`${API}/milestones/${id}`, body),
  deleteMilestone: (id: number) => apiDelete(`${API}/milestones/${id}`),
  /** Achieved with open tasks needs force and a reason (409 first); the reason stays on the record. */
  milestoneStatus: (id: number, body: { status: string; force?: boolean; reason?: string }) => apiPost(`${API}/milestones/${id}/status`, body),
  /** Hands achieved, billable milestones to Billing as drafts. No ids = every ready one in reach. */
  invoiceMilestones: (ids?: number[]) => apiPost<MilestoneInvoiceResult>(`${API}/milestones/invoice`, { ids }),

  createSprint: (body: Record<string, unknown>) => apiPost<{ id: number }>(`${API}/sprints`, body),
  updateSprint: (id: number, body: Record<string, unknown>) => apiPut(`${API}/sprints/${id}`, body),
  deleteSprint: (id: number) => apiDelete(`${API}/sprints/${id}`),
  /** completed takes retrospective and move_to_sprint_id (null = back to the backlog). */
  sprintStatus: (id: number, body: { status: string; retrospective?: string; move_to_sprint_id?: number | null }) => apiPost(`${API}/sprints/${id}/status`, body),

  approve: (ids: number[]) => apiPost<{ approved: number; skipped: number }>(`${API}/time/approve`, { ids }),
  sendBack: (ids: number[], note: string) => apiPost<{ sent_back: number }>(`${API}/time/send-back`, { ids, note }),
  setBillable: (ids: number[], is_billable: boolean) => apiPost(`${API}/time/billable`, { ids, is_billable }),
  deleteTime: (id: number) => apiDelete(`${API}/time/${id}`),
};

/** The HTTP status of a failed call, or null. */
export function statusOf(e: unknown): number | null {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

// ── words ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-10-30" → its parts, or null. */
function partsOf(d: string | null | undefined): { y: number; m: number; d: number } | null {
  const x = d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null;
  return x ? { y: Number(x[1]), m: Number(x[2]) - 1, d: Number(x[3]) } : null;
}

/** "30 Oct", or "30 Oct 2027" when not this year. */
export function fmtDay(d: string | null | undefined, year = false): string {
  const p = partsOf(d);
  if (!p) return '—';
  return `${p.d} ${MONTHS[p.m]}${year || p.y !== new Date().getFullYear() ? ` ${p.y}` : ''}`;
}

/** "Fri 9" */
export function fmtWeekday(d: string | null | undefined): string {
  const p = partsOf(d);
  return p ? `${DAYS[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()]} ${p.d}` : '—';
}

/** "6 – 16 Oct", "22 Sep – 3 Oct". */
export function fmtRange(a: string | null, b: string | null): string {
  const x = partsOf(a);
  const y = partsOf(b);
  if (!x || !y) return x ? fmtDay(a) : y ? fmtDay(b) : 'No dates';
  if (x.m === y.m && x.y === y.y) return `${x.d} – ${y.d} ${MONTHS[y.m]}`;
  return `${fmtDay(a)} – ${fmtDay(b)}`;
}

/** "5 – 11 Oct 2026" for the week starting on a Monday. */
export function weekLabel(start: string): string {
  const a = partsOf(start);
  if (!a) return start;
  const e = new Date(Date.UTC(a.y, a.m, a.d + 6));
  const left = a.m === e.getUTCMonth() ? `${a.d}` : `${a.d} ${MONTHS[a.m]}`;
  return `${left} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
}

/** A grouped amount without currency: 12,400,000. */
export function num(v: string | number | null | undefined, dp = 0): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** "21 days left", "4 days late", "Due today". */
export function daysLeftText(days: number | null | undefined): { text: string; late: boolean } {
  if (days === null || days === undefined) return { text: '', late: false };
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} late`, late: true };
  if (days === 0) return { text: 'Due today', late: false };
  return { text: `${days} day${days === 1 ? '' : 's'} left`, late: false };
}

/** The words for each state (and a tone that repeats them: colour is never alone, NFR-08). */
export const TIME_STATE: Record<string, { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'bg-success-bg text-success' },
  pending: { label: 'Pending', tone: 'bg-warning-bg text-warning-ink' },
  approved: { label: 'Approved', tone: 'bg-success-bg text-success' },
  sent_back: { label: 'Sent back', tone: 'bg-danger-bg text-danger' },
  submitted: { label: 'In HR timesheet', tone: 'bg-violet-bg text-violet-ink dark:bg-violet/25' },
  invoiced: { label: 'Invoiced', tone: 'bg-violet-bg text-violet-ink dark:bg-violet/25' },
};

export const MILESTONE_STATE: Record<string, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'bg-selection text-primary' },
  overdue: { label: 'Overdue', tone: 'bg-danger-bg text-danger' },
  achieved: { label: 'Achieved', tone: 'bg-success-bg text-success' },
  missed: { label: 'Missed', tone: 'bg-danger-bg text-danger' },
  cancelled: { label: 'Cancelled', tone: 'bg-subtle text-ink-3' },
};

export const INVOICE_STATE: Record<InvoiceStatus, string> = {
  not_billable: '—',
  not_invoiced: 'Not invoiced',
  ready: 'Ready to invoice',
  invoiced: 'Invoiced',
};

export const SPRINT_STATUS: Record<Sprint['status'], { label: string; tone: string }> = {
  planned: { label: 'Planned', tone: 'bg-subtle text-ink-2' },
  active: { label: 'Active', tone: 'bg-selection text-primary' },
  completed: { label: 'Completed', tone: 'bg-success-bg text-success' },
  cancelled: { label: 'Cancelled', tone: 'bg-subtle text-ink-3' },
};

export const FORECAST: Record<SprintDetail['forecast']['label'], { label: string; tone: string }> = {
  on_pace: { label: 'On pace', tone: 'text-ink' },
  behind: { label: 'Behind', tone: 'text-danger' },
  ahead: { label: 'Ahead', tone: 'text-success' },
  not_started: { label: 'Not started', tone: 'text-ink-3' },
  done: { label: 'Done', tone: 'text-success' },
};
