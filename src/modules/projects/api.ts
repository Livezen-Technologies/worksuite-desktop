import { apiDelete, apiGetMeta, apiPost, apiPut, type ApiResult } from '../../core/api';
import { TASK_STATUS_LABEL, type ProjectTaskStatus } from '@shared/projects';

/**
 * WorkSuite Projects' API (`/api/projects/...`), the shapes the desktop reads.
 *
 * The contract is the web's (worksuite web/src/pages/project/types.ts and api.ts); what is mirrored here is what
 * these screens use, field for field. Reads go through the app's API proxy, which keeps the last answer for offline
 * (READ_CACHE, `/api/projects`); writes that may wait offline (a move, a comment, time) go through the outbox
 * (`desk.ts`), the rest straight to the server and only online.
 *
 * Some endpoints are new on the server (the Projects API is being completed alongside, P4): every screen reads its
 * answer defensively and says plainly when the server has nothing for it.
 */

export const API = '/api/projects';

export type Cap = 'view' | 'manage' | 'task' | 'time' | 'time_approve' | 'budget' | 'approve' | 'settings';
export type Can = Partial<Record<Cap, boolean>>;
export type Health = 'on_track' | 'watch' | 'at_risk' | 'closed';
export type ProjectStatus = 'planning' | 'pending_approval' | 'active' | 'on_hold' | 'completed' | 'cancelled' | 'archived';
export type TaskStatus = ProjectTaskStatus;

export interface Project {
  id: number;
  code: string;
  name: string;
  client: string | null;
  manager: string | null;
  manager_id: number | null;
  priority: string;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  currency: string;
  progress?: number;
  tasks?: number;
  tasks_done?: number;
  tasks_overdue?: number;
  health?: Health;
  health_reasons?: string[];
  category_color?: string | null;
}

export interface ProjectListResponse {
  projects: Project[];
  total: number;
  status_counts?: Record<string, number>;
  can?: Can;
}

export interface SprintLite {
  id: number;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

export interface ProjectDetail {
  project: Project;
  progress?: { total: number; done: number; overdue: number; blocked: number; progress: number };
  members?: Array<{ id: number; user_id: number; name: string; role: string; capacity_hours?: string | null; load_percent?: number | null }>;
  sprints?: SprintLite[];
  can?: Can;
}

export interface Task {
  id: number;
  task_number: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: string;
  task_type: 'task' | 'bug' | 'story' | 'chore';
  project_id: number | null;
  project: string | null;
  project_code: string | null;
  sprint_id: number | null;
  sprint: string | null;
  /** The list view's Milestone and Points columns (TaskRows::shape); absent on an older server. */
  milestone_id?: number | null;
  milestone?: string | null;
  story_points?: number | null;
  over_estimate?: boolean;
  assignee_id: number | null;
  assignee: string | null;
  reviewer_id: number | null;
  reviewer: string | null;
  estimated_hours: string | null;
  logged_hours: string;
  logged_minutes: number;
  start_date: string | null;
  due_date: string | null;
  overdue: boolean;
  blocked_reason: string | null;
  is_billable: boolean;
  tags: string | null;
  progress: number;
  position: number;
  completed_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
  timer_running: boolean;
}

export interface TaskListResponse {
  tasks: Task[];
  wip_limits?: Partial<Record<TaskStatus, number>>;
  can?: Can;
  /** Project 2.4.0 (PRJ-LST-10): how many tasks match, and whether this answer holds only part of them. */
  total?: number;
  truncated?: boolean;
}

/** What `POST tasks/bulk` changes on every ticked task (PRJ-LST-08). */
export interface BulkSet {
  status?: TaskStatus;
  blocked_reason?: string | null;
  assignee_id?: number | null;
  priority?: string;
  sprint_id?: number | null;
  due_date?: string | null;
}

/** Its answer: not all-or-nothing — each task done or refused with the single edit's reason. */
export interface BulkResult {
  done: number[];
  refused: Array<{ id: number; number: string | null; reason: string }>;
}

export interface Comment {
  id: number;
  author: string | null;
  author_id: number | null;
  body: string;
  at: string;
}

export interface TimeEntry {
  id: number;
  user: string;
  user_id: number;
  project: string | null;
  project_code: string | null;
  project_id: number | null;
  task: string | null;
  task_number: string | null;
  task_id: number | null;
  on_date: string;
  started_at: string | null;
  minutes: number;
  duration: string;
  is_billable: boolean;
  note: string | null;
  running: boolean;
  approved: boolean;
  state?: string;
  locked?: boolean;
  is_mine?: boolean;
}

export interface TaskDetail {
  task: Task;
  dependencies?: { waits_on: Array<{ task_id: number; task_number: string | null; title: string; status: TaskStatus }>; blocks: Array<{ task_id: number; task_number: string | null; title: string; status: TaskStatus }> };
  time?: { entries: TimeEntry[]; minutes: number; estimate_minutes: number | null };
  comments?: Comment[];
  checklist?: Array<{ id: number; title: string; done: boolean }>;
  can?: Can;
}

export interface NavCounts {
  projects: number;
  my_work: number;
  milestones_due: number;
  time_waiting: number;
  risks_open: number;
  changes_waiting: number;
}

export interface MyWork {
  overdue: Task[];
  today: Task[];
  this_week: Task[];
  later: Task[];
  waiting: { approvals: number; reviews: Task[]; changes: Array<{ id: number; number: string | null; title: string; project_code: string }> };
  today_minutes: number;
}

export interface Dashboard {
  currency: string;
  kpi: Partial<{ live: number; active: number; delayed: number; at_risk: number; watch: number; tasks_open: number; tasks_overdue: number; upcoming_milestones: number; waiting_time: number; waiting_changes: number; used_percent: number }>;
  attention: Array<{ id: number; code: string; name: string; manager: string | null; health: Health; progress: number; budget_used_percent: number; reasons: string[] }>;
  upcoming_milestones?: Array<{ id: number; name: string; due_date: string; project: string; code: string; project_id: number; days_left: number }>;
  can?: Can;
}

export interface TimeWeek {
  entries: TimeEntry[];
  week_start: string;
  week_end: string;
  total_minutes: number;
}

export interface ChangeRequest {
  id: number;
  number: string | null;
  project_id: number;
  project: string;
  project_code: string;
  title: string;
  description: string | null;
  kind: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'withdrawn';
  budget_delta: string;
  days_delta: number;
  hours_delta: string;
  requested_by: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
  currency: string;
  is_mine: boolean;
  can_decide: boolean;
}

export interface ChangeListResponse {
  changes: ChangeRequest[];
  counts?: Partial<Record<'waiting' | 'approved' | 'rejected' | 'withdrawn' | 'all', number>>;
}

// ── reads ──────────────────────────────────────────────────────────────────

type Signal = { signal?: AbortSignal };
export const qk = {
  all: ['projects'] as const,
  list: ['projects', 'list'] as const,
  counts: ['projects', 'counts'] as const,
  dashboard: ['projects', 'dashboard'] as const,
  detail: (id: number) => ['projects', 'detail', id] as const,
  tasks: (id: number) => ['projects', 'tasks', id] as const,
  task: (id: number) => ['projects', 'task', id] as const,
  myWork: ['projects', 'my-work'] as const,
  week: (day: string) => ['projects', 'time', day] as const,
  changes: ['projects', 'changes'] as const,
};

export const read = {
  list: ({ signal }: Signal = {}) => apiGetMeta<ProjectListResponse>(API, { scope: 'live', per_page: 200 }, signal),
  counts: ({ signal }: Signal = {}) => apiGetMeta<NavCounts>(`${API}/counts`, undefined, signal),
  dashboard: ({ signal }: Signal = {}) => apiGetMeta<Dashboard>(`${API}/dashboard`, undefined, signal),
  detail: (id: number, { signal }: Signal = {}) => apiGetMeta<ProjectDetail>(`${API}/${id}`, undefined, signal),
  tasks: (id: number, { signal }: Signal = {}) => apiGetMeta<TaskListResponse>(`${API}/tasks`, { project_id: id }, signal),
  task: (id: number, { signal }: Signal = {}) => apiGetMeta<TaskDetail>(`${API}/tasks/${id}`, undefined, signal),
  myWork: ({ signal }: Signal = {}) => apiGetMeta<MyWork>(`${API}/my-work`, undefined, signal),
  week: (day: string, { signal }: Signal = {}) => apiGetMeta<TimeWeek>(`${API}/time`, { week: day, scope: 'mine' }, signal),
  changes: ({ signal }: Signal = {}) => apiGetMeta<ChangeListResponse>(`${API}/changes`, { status: 'waiting' }, signal),
};

// ── writes that need WorkSuite (never kept offline) ────────────────────────

export const write = {
  createTask: (body: { project_id: number; title: string; status: TaskStatus; task_type?: string; priority?: string; due_date?: string | null; assignee_id?: number | null }) =>
    apiPost<{ id: number; task_number: string }>(`${API}/tasks`, body),
  /** An inline edit in the list (assignee, priority, due): the task's own PUT, online only (PRJ-LST-07). */
  updateTask: (id: number, body: { assignee_id?: number | null; priority?: string; due_date?: string | null; sprint_id?: number | null }) => apiPut<{ id: number }>(`${API}/tasks/${id}`, body),
  /** Bulk on ticked rows (PRJ-LST-08): each id through the single-edit code; online only. */
  bulk: (body: { ids: number[]; set: BulkSet } | { ids: number[]; delete: true }) => apiPost<BulkResult>(`${API}/tasks/bulk`, body),
  deleteTask: (id: number) => apiDelete(`${API}/tasks/${id}`),
  /** An approval: online only (PRJ-DSK-04). Reject needs a note. */
  decideChange: (id: number, body: { decision: 'approve' | 'reject'; note?: string }) => apiPost(`${API}/changes/${id}/decide`, body),
};

/** An answer's data, or a fallback while it is loading or failed. */
export function dataOf<T>(r: ApiResult<T> | undefined): T | undefined {
  return r?.data ?? undefined;
}

// ── words ──────────────────────────────────────────────────────────────────

export const statusLabel = (s: string): string => TASK_STATUS_LABEL[s as TaskStatus] ?? s.replace(/_/g, ' ');

/** Status chips (D03): the tokens, so both themes are right; the word is always there (NFR-08, colour never alone). */
export const STATUS_TONE: Record<string, string> = {
  backlog: 'bg-subtle text-ink-2',
  todo: 'bg-subtle text-ink-2',
  in_progress: 'bg-selection text-primary',
  in_review: 'bg-violet-bg text-violet-ink dark:bg-violet/25',
  testing: 'bg-warning-bg text-warning-ink',
  blocked: 'bg-danger-bg text-danger',
  completed: 'bg-success-bg text-success',
  cancelled: 'bg-subtle text-ink-3',
};

export const HEALTH: Record<Health, { label: string; dot: string }> = {
  on_track: { label: 'On track', dot: 'bg-success' },
  watch: { label: 'Watch', dot: 'bg-warning' },
  at_risk: { label: 'At risk', dot: 'bg-danger' },
  closed: { label: 'Closed', dot: 'bg-ink-3' },
};

/** "TSK-0412" or, without a number, the title. */
export const taskRef = (t: Pick<Task, 'task_number' | 'title'>): string => t.task_number ?? t.title;
