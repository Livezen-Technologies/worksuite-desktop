import { useStore } from '../../core/store';
import { app } from '../../core/app-state';
import { ApiError, apiDelete, apiGetMeta, apiPost, apiPut, type Query } from '../../core/api';
import { API, type Can, type Health, type ProjectStatus, type TaskStatus } from './api';
import { withOrg } from './company';

/**
 * The Projects portfolio's API on the desktop (PRJ-REG, PRJ-TPL, PRJ-CLI, PRJ-MEM, PRJ-STS, PRJ-NTF): All projects,
 * Templates, Clients, the New project dialog, a project's page (overview, team, settings, activity, files), the
 * Activity log and Module settings.
 *
 * The contract is the web's (worksuite web/src/pages/project/types.ts and api.ts), field for field. Reads go through
 * `apiGetMeta`, so the API proxy keeps the last answer for offline (READ_CACHE, `/api/projects`); every write here
 * needs WorkSuite — none is queue-safe — so the screens disable them offline ("… needs a connection").
 *
 * Portfolio-level reads carry the shared company selector's `org` (company.tsx); one project's reads do not.
 */

// ── shapes ─────────────────────────────────────────────────────────────────

export type MemberRole = 'manager' | 'lead' | 'member' | 'reviewer' | 'observer';

export interface FullProject {
  id: number;
  code: string;
  name: string;
  org_id: number | null;
  org_name: string | null;
  client: string | null;
  client_id: number | null;
  category: string | null;
  category_id: number | null;
  category_color: string | null;
  manager: string | null;
  manager_id: number | null;
  priority: string;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  baseline_end_date: string | null;
  estimated_hours: string;
  budget: string;
  currency: string;
  hourly_rate: string;
  is_billable: boolean;
  is_template: boolean;
  days_left: number | null;
  description: string | null;
  completed_at: string | null;
  progress?: number;
  tasks?: number;
  tasks_done?: number;
  tasks_overdue?: number;
  members?: number;
  budget_used_percent?: number;
  spent?: string;
  health?: Health;
  health_reasons?: string[];
}

export interface RegisterResponse {
  projects: FullProject[];
  total: number;
  page: number;
  per_page: number;
  status_counts: Record<string, number>;
  can?: Can;
}

export interface Budget {
  budget: string;
  labour: string;
  expenses: string;
  spent: string;
  remaining: string;
  used_percent: number;
  over: boolean;
  currency: string;
  expense_count: number;
  eac: string | null;
  warn_percent: number;
}

export interface Member {
  id: number;
  user_id: number;
  name: string;
  email: string;
  role: MemberRole;
  capacity_hours: string;
  hourly_rate: string;
  open_tasks: number;
  open_estimate_hours: string;
  load_percent: number | null;
  joined_at: string | null;
}

export interface FormerMember {
  id: number;
  user_id: number;
  name: string;
  role: MemberRole;
  left_at: string;
  minutes: number;
}

export interface Baseline {
  end_date: string | null;
  budget: string | null;
  hours: string | null;
  reason: string | null;
  change_number: string | null;
  set_by: string | null;
  set_at: string;
}

export interface MilestoneLite {
  id: number;
  name: string;
  due_date: string | null;
  status: string;
  bill_amount: string;
  tasks: number;
  tasks_done: number;
  progress: number;
  achieved_at: string | null;
  overdue: boolean;
  owner: string | null;
}

export interface ActivityRow {
  id?: number;
  action: string;
  detail: string | null;
  actor: string | null;
  at: string;
  project?: string | null;
  code?: string | null;
  project_id?: number | null;
  task_id?: number | null;
  task_number?: string | null;
}

export interface FullDetail {
  project: FullProject;
  progress: { total: number; done: number; overdue: number; blocked: number; progress: number };
  budget: Budget;
  time: { minutes: number; billable_minutes: number; hours: string; billable_hours: string; cost: string; estimate_hours: string };
  health: { status: Health; reasons: string[] };
  members: Member[];
  former_members: FormerMember[];
  milestones: MilestoneLite[];
  risks: Array<{ id: number; title: string; impact: string; probability: string; score: number; level: string; status: string; owner: string | null }>;
  activity: ActivityRow[];
  baselines: Baseline[];
  linked: {
    drive_files: number | null;
    expense_total: string;
    expense_count: number;
    asset_count: number;
    next_event: { title: string; at: string } | null;
    tender: { id: number; code: string; status: string | null } | null;
  };
  /** The template the project was made from (Projects 2.2, #337). */
  template?: { key: string; name: string; version: number | null; at: string | null } | null;
  /** The budget in lines: labour by role, and expenses (Projects 2.2). */
  budget_lines?: Array<{ id: number; label: string; kind: 'labour' | 'expense'; role: string | null; hours: string; rate: string; amount: string; note: string | null }>;
  next_statuses: ProjectStatus[];
  can: Can;
}

export interface WorkloadGrid {
  weeks: string[];
  people: Array<{ user_id: number; name: string; cells: Array<{ hours: string; capacity: string; percent: number | null }> }>;
}

export interface Client {
  id: number;
  name: string;
  org_id: number | null;
  org_name: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  status: 'active' | 'archived';
  live: number;
  projects: number;
  crm: { linked: boolean; account_id: number | null; label: string | null };
  contact_visible: boolean;
}

export interface ClientDetail {
  client: Client;
  projects: Array<{ id: number; code: string; name: string; status: ProjectStatus }>;
  budget_live: string;
  ready_to_invoice: string;
  currency: string;
  company: { id: number; name: string; currency: string } | null;
  can?: Can;
}

export interface Category {
  id: number;
  name: string;
  color: string | null;
  status: string;
  projects: number;
}

export interface Template {
  id: number;
  code: string;
  name: string;
  description: string | null;
  milestones: number;
  tasks: number;
  checklists: number;
  dependencies: number;
  roles: number;
  risks: number;
  sprints: number;
}

export interface Person {
  id: number;
  name: string;
  email: string;
  employee_no: string | null;
}

export type AlertKey = 'task_assigned' | 'task_overdue' | 'milestone_due' | 'milestone_achieved' | 'budget_warn' | 'sprint_ending' | 'change_waiting' | 'change_decided' | 'time_sent_back' | 'added_to_project';

export interface Settings {
  project_prefix: string;
  task_prefix: string;
  change_prefix: string;
  number_pad: number;
  default_currency: string;
  reporting_currency: string;
  budget_warn_percent: number;
  working_hours_per_day: number;
  working_days: number[];
  time_approvers: 'manager_and_leads' | 'manager_only';
  max_entry_hours: number;
  wip_limits: Partial<Record<TaskStatus, number>>;
  alerts: Partial<Record<AlertKey, boolean>>;
  holiday_calendar: string | null;
  next_code: string;
}

export interface FullDashboard {
  company: { id: number; name: string; currency: string } | null;
  currency: string;
  rate_date: string | null;
  kpi: Partial<{
    total: number; live: number; active: number; completed: number; delayed: number; on_hold: number; at_risk: number; watch: number;
    tasks: number; tasks_open: number; tasks_overdue: number; members: number; hours_logged: string; minutes_week: number; billable_percent_week: number;
    upcoming_milestones: number; milestones_30d: number; milestones_overdue: number; open_risks: number; risks_high: number;
    waiting_time: number; waiting_changes: number; budget: string; spent: string; remaining: string; used_percent: number;
  }>;
  by_status?: Record<string, number>;
  attention: Array<{ id: number; code: string; name: string; manager: string | null; health: Health; progress: number; budget_used_percent: number; reasons: string[] }>;
  upcoming_milestones?: Array<{ id: number; name: string; due_date: string; project: string; code: string; project_id: number; days_left: number }>;
  workload?: Array<{ user_id: number; name: string; open: number; open_hours: string; capacity_hours: string; percent: number | null }>;
  recent?: ActivityRow[];
  can?: Can;
}

export interface CopyParts {
  milestones: boolean;
  tasks: boolean;
  dependencies: boolean;
  roles: boolean;
  risks: boolean;
}

// ── keys ───────────────────────────────────────────────────────────────────

/** Drops empty values so a filter left at "any" is not sent as `?x=` (the web's `clean`). */
export function clean(p: Query = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    out[k] = v === true ? '1' : String(v);
  }
  return out;
}

/** Every key starts with 'projects', so the module's `invalidateQueries({ queryKey: qk.all })` refreshes these too. */
export const pk = {
  register: (p: Query) => ['projects', 'register', clean(withOrg(p))] as const,
  full: (id: number) => ['projects', 'full', id] as const,
  templates: (org: string | number | null) => ['projects', 'templates', String(org ?? '')] as const,
  people: (org: string | number | null) => ['projects', 'people', String(org ?? '')] as const,
  clients: (p: Query) => ['projects', 'clients', clean(withOrg(p))] as const,
  client: (id: number) => ['projects', 'client', id] as const,
  categories: ['projects', 'categories'] as const,
  settings: ['projects', 'settings'] as const,
  workload: (id: number) => ['projects', 'workload', id] as const,
  activity: (p: Query) => ['projects', 'activity', clean(withOrg(p))] as const,
  dashboard: (org: string) => ['projects', 'dashboard-full', org] as const,
};

// ── reads ──────────────────────────────────────────────────────────────────

type Signal = { signal?: AbortSignal };

export const preads = {
  /** q, status, client_id, category_id, manager_id, priority, health, scope=live|archived, page, per_page; org */
  register: (p: Query, { signal }: Signal = {}) => apiGetMeta<RegisterResponse>(API, clean(withOrg(p)), signal),
  full: (id: number, { signal }: Signal = {}) => apiGetMeta<FullDetail>(`${API}/${id}`, undefined, signal),
  /** The chosen company's templates, or with `org` that company's. */
  templates: (org?: number | string | null, { signal }: Signal = {}) => apiGetMeta<{ templates: Template[] }>(`${API}/templates`, clean(org ? { org } : withOrg()), signal),
  people: (org?: number | string | null, { signal }: Signal = {}) => apiGetMeta<{ people: Person[] }>(`${API}/people`, clean(org ? { org } : withOrg()), signal),
  /** The chosen company's clients and the shared ones; archived=1 lists archived ones; q searches; org names a company. */
  clients: (p: Query = {}, { signal }: Signal = {}) => apiGetMeta<{ clients: Client[]; can?: Can }>(`${API}/clients`, clean(withOrg(p)), signal),
  client: (id: number, { signal }: Signal = {}) => apiGetMeta<ClientDetail>(`${API}/clients/${id}`, undefined, signal),
  categories: ({ signal }: Signal = {}) => apiGetMeta<{ categories: Category[] }>(`${API}/categories`, undefined, signal),
  settings: ({ signal }: Signal = {}) => apiGetMeta<{ settings: Settings; can?: Can }>(`${API}/settings`, undefined, signal),
  workload: (id: number, { signal }: Signal = {}) => apiGetMeta<WorkloadGrid>(`${API}/${id}/workload`, undefined, signal),
  activity: (p: Query, { signal }: Signal = {}) => apiGetMeta<{ activity: ActivityRow[]; total: number; page: number; per_page: number }>(`${API}/activity`, clean(withOrg(p)), signal),
  dashboard: ({ signal }: Signal = {}) => apiGetMeta<FullDashboard>(`${API}/dashboard`, clean(withOrg()), signal),
};

// ── writes (online only) ───────────────────────────────────────────────────

export const pwrites = {
  /** body.org_id is the company; without it the server uses the chosen one, else the caller's own. */
  create: (body: Record<string, unknown>) => apiPost<{ id: number; code: string }>(API, body),
  fromTemplate: (body: Record<string, unknown> & { template_id: number; copy: CopyParts }) => apiPost<{ id: number; code: string }>(`${API}/from-template`, body),
  update: (id: number, body: Record<string, unknown>) => apiPut(`${API}/${id}`, body),
  remove: (id: number, force = false) => apiDelete(`${API}/${id}`, { force }),
  setStatus: (id: number, status: ProjectStatus, force = false) => apiPost(`${API}/${id}/status`, { status, force }),
  /** Moves the baseline end date with a reason; the old one stays in `baselines`. */
  rebaseline: (id: number, body: { reason: string; end_date?: string | null; budget?: string | null; hours?: string | null }) => apiPost(`${API}/${id}/rebaseline`, body),
  setTemplate: (id: number, is_template: boolean) => apiPost(`${API}/${id}/template`, { is_template }),
  saveAsTemplate: (id: number, name: string) => apiPost<{ id: number; code: string }>(`${API}/${id}/save-as-template`, { name }),
  startTimer: (body: { project_id: number; is_billable?: boolean }) => apiPost(`${API}/time/start`, body),
  addMember: (id: number, body: { user_id: number; role: string; capacity_hours: string; hourly_rate: string }) => apiPost(`${API}/${id}/members`, body),
  updateMember: (id: number, memberId: number, body: { role?: string; capacity_hours?: string; hourly_rate?: string }) => apiPut(`${API}/${id}/members/${memberId}`, body),
  removeMember: (id: number, memberId: number) => apiDelete(`${API}/${id}/members/${memberId}`),
  /** Re-adds a former member: reopens their row, keeps their logged time and its rate. */
  readdMember: (id: number, memberId: number) => apiPost(`${API}/${id}/members/${memberId}/readd`),
  createClient: (body: Record<string, unknown>) => apiPost<{ id: number }>(`${API}/clients`, body),
  updateClient: (id: number, body: Record<string, unknown>) => apiPut(`${API}/clients/${id}`, body),
  archiveClient: (id: number, archived: boolean) => apiPost(`${API}/clients/${id}/archive`, { archived }),
  createCategory: (body: { name: string; color?: string }) => apiPost<{ id: number }>(`${API}/categories`, body),
  updateCategory: (id: number, body: { name?: string; color?: string; status?: string }) => apiPut(`${API}/categories/${id}`, body),
  saveSettings: (body: Partial<Settings>) => apiPut(`${API}/settings`, body),
};

/** The HTTP status of a refusal (409: the server asks for a confirmation, with the reason as its message). */
export function errorStatus(e: unknown): number | null {
  return e instanceof ApiError ? e.status : null;
}

export function errorText(e: unknown, fallback = 'That did not work.'): string {
  return (e instanceof Error && e.message) || fallback;
}

/** Whether the signed-in person holds a permission (`*` holds them all) — the rail's gates; screens use the server's `can`. */
export function usePermission(): (perm: string) => boolean {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  return (perm: string) => !!perms && (perms.includes('*') || perms.includes(perm));
}

// ── words (the web's kit) ──────────────────────────────────────────────────

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: string }> = {
  planning: { label: 'Planning', tone: 'bg-subtle text-ink-2' },
  pending_approval: { label: 'Pending approval', tone: 'bg-violet-bg text-violet-ink dark:bg-violet/25' },
  active: { label: 'Active', tone: 'bg-selection text-primary' },
  on_hold: { label: 'On hold', tone: 'bg-warning-bg text-warning-ink' },
  completed: { label: 'Completed', tone: 'bg-success-bg text-success' },
  cancelled: { label: 'Cancelled', tone: 'bg-subtle text-ink-3' },
  archived: { label: 'Archived', tone: 'bg-subtle text-ink-3' },
};

export const HEALTH_CHIP: Record<Health, { label: string; tone: string }> = {
  on_track: { label: 'On track', tone: 'bg-success-bg text-success' },
  watch: { label: 'Watch', tone: 'bg-warning-bg text-warning-ink' },
  at_risk: { label: 'At risk', tone: 'bg-danger-bg text-danger' },
  closed: { label: '—', tone: 'text-ink-3' },
};

export const PRIORITY: Record<string, { label: string }> = {
  critical: { label: 'Critical' },
  high: { label: 'High' },
  medium: { label: 'Medium' },
  low: { label: 'Low' },
};

export const ROLE: Record<string, { label: string; tone: string }> = {
  manager: { label: 'Manager', tone: 'bg-ink text-surface' },
  lead: { label: 'Lead', tone: 'bg-selection text-primary' },
  member: { label: 'Member', tone: 'bg-subtle text-ink-2' },
  reviewer: { label: 'Reviewer', tone: 'bg-violet-bg text-violet-ink dark:bg-violet/25' },
  observer: { label: 'Observer', tone: 'border border-line text-ink-2' },
};

export const MILESTONE_STATE: Record<string, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'bg-selection text-primary' },
  overdue: { label: 'Overdue', tone: 'bg-danger-bg text-danger' },
  achieved: { label: 'Achieved', tone: 'bg-success-bg text-success' },
  missed: { label: 'Missed', tone: 'bg-danger-bg text-danger' },
  cancelled: { label: 'Cancelled', tone: 'bg-subtle text-ink-3' },
};

export const RISK_LEVEL: Record<string, { label: string; tone: string }> = {
  critical: { label: 'Critical', tone: 'bg-danger-bg text-danger' },
  high: { label: 'High', tone: 'bg-warning-bg text-warning-ink' },
  medium: { label: 'Medium', tone: 'bg-warning-bg text-warning-ink' },
  low: { label: 'Low', tone: 'bg-subtle text-ink-2' },
};

/** Words for a move, from where the project is going. */
export const MOVE_LABEL: Partial<Record<ProjectStatus, string>> = {
  planning: 'Back to planning',
  pending_approval: 'Send for approval',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

// ── formatting (the web's kit) ─────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseDay(d: string | null | undefined): Date | null {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** "30 Oct", or "30 Oct 2027" when not this year. */
export function fmtDay(d: string | null | undefined, opts: { year?: boolean } = {}): string {
  const x = parseDay(d);
  if (!x) return '—';
  const y = opts.year || x.getFullYear() !== new Date().getFullYear();
  return `${x.getDate()} ${MONTHS[x.getMonth()]}${y ? ` ${x.getFullYear()}` : ''}`;
}

/** Minutes as H:MM. */
export function hm(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes ?? 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** "21 days left", "4 days late", "Due today". */
export function daysLeftText(days: number | null | undefined): { text: string; late: boolean } {
  if (days === null || days === undefined) return { text: '', late: false };
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} late`, late: true };
  if (days === 0) return { text: 'Due today', late: false };
  return { text: `${days} day${days === 1 ? '' : 's'} left`, late: false };
}

/** A grouped amount without currency: 12,400,000. */
export function num(v: string | number | null | undefined, dp = 0): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** "LKR 12.4M", "USD 42,000". */
export function shortMoney(v: string | number | null | undefined, currency?: string | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const body = a >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : a >= 100_000 ? `${(n / 1_000).toFixed(0)}K` : num(n);
  return currency ? `${currency} ${body}` : body;
}

/** Text colour for a budget-used or load percentage against the warn line. */
export function usedTone(pct: number | null | undefined, warn = 80): string {
  if (pct === null || pct === undefined) return 'text-ink-3';
  if (pct > 100) return 'font-bold text-danger';
  if (pct >= warn) return 'text-warning-ink';
  return 'text-ink-2';
}

/** Bar fill for a load or used percentage. */
export function usedFill(pct: number | null | undefined, warn = 85): string {
  if (pct === null || pct === undefined) return 'bg-line';
  if (pct > 100) return 'bg-danger';
  if (pct > warn) return 'bg-warning';
  return 'bg-primary';
}

export const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "6 milestones · 38 tasks · 4 roles" — what a template brings. */
export function templateSummary(t: Template, withRisks = false): string {
  const parts: string[] = [];
  if (t.milestones) parts.push(plural(t.milestones, 'milestone'));
  if (t.sprints) parts.push(plural(t.sprints, 'sprint'));
  if (t.tasks) parts.push(plural(t.tasks, 'task'));
  if (t.roles) parts.push(plural(t.roles, 'role'));
  if (withRisks && t.risks) parts.push(plural(t.risks, 'risk'));
  return parts.join(' · ');
}

/** "task_moved" → "Task moved" */
export function actionWords(action: string): string {
  const s = action.replace(/[_.]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A project's page: /projects/{id} for its overview, /projects/{id}/{tab} for the rest (the web's `projectPath`). */
export const projectPath = (id: number, tab?: string): string => `/projects/${id}${tab && tab !== 'overview' ? `/${tab}` : ''}`;
