import { useEffect, useSyncExternalStore } from 'react';
import { TASK_STATUSES, TASK_STATUS_LABEL, type ProjectsOutboxItem } from '@shared/projects';
import { apiPut } from '../../core/api';
import { toast } from '../../core/toasts';
import { writeTaskField, type FieldRouter, type FieldWriter } from '../tasks/actions';
import type { Status as TasksStatus, TaskDetail as TasksDetail } from '../tasks/api';
import { API, type Can, type Comment, type TaskDetail as ProjectsTaskDetail, type TaskStatus, type TimeEntry } from './api';
import { submit } from './desk';

/**
 * A project task in the Tasks app's editor (Projects SRS v1.2 PRJ-TED, §14.2, WF-18): the rules of the modal with
 * no screen in them — what one read gives it, which endpoint owns each field, what the reader may change (and why
 * not), what offline allows, what waits in the outbox for this task, and J/K through the view behind.
 */

// ── what the modal reads ───────────────────────────────────────────────────

export interface Dep {
  /** The dependency row (what DELETE …/dependencies/{id} takes), when the server names it. */
  id: number | null;
  task_id: number;
  task_number: string | null;
  title: string;
  status: TaskStatus;
}

/** The project's side of the task: its board fields, dependencies, time, vocabulary and the reader's caps. */
export interface ProjectBlock {
  id: number;
  code: string | null;
  name: string | null;
  company: string | null;
  task_number: string | null;
  task_type: 'task' | 'bug' | 'story' | 'chore';
  status: TaskStatus;
  priority: string;
  assignee_id: number | null;
  assignee: string | null;
  reviewer_id: number | null;
  reviewer: string | null;
  sprint_id: number | null;
  sprint: string | null;
  milestone_id: number | null;
  milestone: string | null;
  parent_id: number | null;
  parent: string | null;
  story_points: number | null;
  estimated_hours: number | null;
  is_billable: boolean;
  blocked_reason: string | null;
  updated_at: string | null;
  dependencies: { waits_on: Dep[]; blocks: Dep[] };
  time: { entries: TimeEntry[]; minutes: number; estimate_minutes: number | null };
  /** The project's statuses, in board order (the server's when it sends them). */
  statuses: Array<{ id: TaskStatus; label: string }>;
  priorities: Array<{ id: string; label: string }>;
  /** The reader's Projects caps (project.task, project.time…). */
  can: Can;
  /** The pickers' choices the server sent with the task (Project 2.5): null when it sent none. */
  options: { sprints: Array<{ id: number; name: string }>; milestones: Array<{ id: number; name: string }>; members: Array<{ user_id: number; name: string }> } | null;
  /** The project is archived: nothing on its tasks can change. */
  archived: boolean;
}

/**
 * Everything the modal shows: the task as the Tasks parts take it, and its project block. `source` says which read
 * gave it — `tasks` (GET /api/tasks/{id} with its `project` block, one read) or `projects` (an older server: the
 * Projects read, GET /api/projects/tasks/{id}, shaped for the parts).
 */
export interface EditorData {
  task: TasksDetail;
  project: ProjectBlock;
  /** Per field: whether the reader may change it (the server's `can`/`can_edit`, with the project's keys). */
  fields: Record<string, boolean>;
  source: 'tasks' | 'projects';
}

export const DEFAULT_PRIORITIES = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

export const TYPE_LABEL: Record<ProjectBlock['task_type'], string> = { task: 'Task', bug: 'Bug', story: 'Story', chore: 'Chore' };

/** A project status as the Tasks parts read one (only Progress cares: done means 100%). */
export function tasksStatusOf(s: string): TasksStatus {
  const map: Record<string, TasksStatus> = { completed: 'done', in_review: 'review', testing: 'review', blocked: 'on_hold' };
  return map[s] ?? ((['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as string[]).includes(s) ? (s as TasksStatus) : 'todo');
}

/** A status read back from either app, in the project's words (`done` is the Tasks app's: stored as completed). */
export function projectStatusOf(s: unknown): TaskStatus {
  const v = String(s ?? '');
  if (v === 'done') return 'completed';
  if (v === 'review') return 'in_review';
  if (v === 'on_hold') return 'blocked';
  return (TASK_STATUSES as readonly string[]).includes(v) ? (v as TaskStatus) : 'todo';
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** The project's statuses: the server's list (ids, or {id|key|value, label}), else the board's own vocabulary. */
export function statusesOf(v: unknown): ProjectBlock['statuses'] {
  const list = Array.isArray(v) ? v : [];
  const out: ProjectBlock['statuses'] = [];
  for (const x of list) {
    const o = obj(x);
    const id = String(o ? (o.id ?? o.key ?? o.value ?? '') : x);
    if (!(TASK_STATUSES as readonly string[]).includes(id) || out.some((s) => s.id === id)) continue;
    out.push({ id: id as TaskStatus, label: str(o?.label) ?? TASK_STATUS_LABEL[id as TaskStatus] });
  }
  return out.length ? out : TASK_STATUSES.map((id) => ({ id, label: TASK_STATUS_LABEL[id] }));
}

function prioritiesOf(v: unknown): ProjectBlock['priorities'] {
  const list = Array.isArray(v) ? v : [];
  const out = list.map((x) => {
    const o = obj(x);
    const id = String(o ? (o.id ?? o.key ?? o.value ?? '') : x);
    return { id, label: str(o?.label) ?? id.charAt(0).toUpperCase() + id.slice(1) };
  });
  return out.filter((p) => p.id).length ? out.filter((p) => p.id) : DEFAULT_PRIORITIES;
}

function depsOf(v: unknown): Dep[] {
  return (Array.isArray(v) ? v : []).flatMap((x) => {
    const o = obj(x);
    const task = num(o?.task_id);
    return o && task ? [{ id: num(o.id), task_id: task, task_number: str(o.task_number), title: String(o.title ?? ''), status: projectStatusOf(o.status) }] : [];
  });
}

/** Only true/false values: a field map, not the Projects caps summary. */
function boolMap(v: unknown): Record<string, boolean> {
  const o = obj(v);
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, x]) => typeof x === 'boolean')) as Record<string, boolean>;
}

/**
 * The project block. The task's own row (`task`) gives the status, priority, people and dates; the board fields come
 * from `p.fields` (Project 2.5) or the row; `p` itself is the project (its own `status` is the project's, never the
 * task's).
 */
function blockOf(task: Raw, p: Raw): ProjectBlock {
  const f = obj(p.fields) ?? {};
  const get = (k: string) => (k in f ? f[k] : task[k]);
  const deps = obj(p.dependencies) ?? obj(task.dependencies) ?? {};
  const time = obj(p.time) ?? obj(task.time) ?? {};
  const estimate = num(get('estimated_hours'));
  const type = String(get('task_type') ?? 'task');
  const opts = obj(p.options);
  const company = obj(p.company);
  const list = (v: unknown) => (Array.isArray(v) ? v : []).flatMap((x) => (obj(x) && num((x as Raw).id) ? [{ id: Number((x as Raw).id), name: String((x as Raw).name ?? '') }] : []));
  return {
    id: num(p.id) ?? num(task.project_id) ?? 0,
    code: str(p.code) ?? str(task.project_code),
    name: str(p.name) ?? str(typeof task.project === 'string' ? task.project : null),
    company: company ? str(company.name) : (str(p.company) ?? str(task.company) ?? null),
    task_number: str(p.task_number) ?? str(task.task_number) ?? str(task.task_key),
    task_type: (['task', 'bug', 'story', 'chore'].includes(type) ? type : 'task') as ProjectBlock['task_type'],
    status: projectStatusOf(task.status),
    priority: String(task.priority ?? 'medium'),
    assignee_id: num(task.assignee_id),
    assignee: str(task.assignee) ?? str(task.assignee_name),
    reviewer_id: num(get('reviewer_id')),
    reviewer: str(get('reviewer')),
    sprint_id: num(get('sprint_id')),
    sprint: str(get('sprint')),
    milestone_id: num(get('milestone_id')),
    milestone: str(get('milestone')),
    parent_id: num(get('parent_id')),
    parent: [str(get('parent_number')), str(get('parent'))].filter(Boolean).join(' · ') || null,
    story_points: num(get('story_points')),
    estimated_hours: estimate,
    is_billable: !!get('is_billable'),
    blocked_reason: str(get('blocked_reason')),
    updated_at: str(task.updated_at),
    dependencies: { waits_on: depsOf(deps.waits_on), blocks: depsOf(deps.blocks) },
    time: {
      entries: (Array.isArray(time.entries) ? time.entries : []) as TimeEntry[],
      minutes: num(time.minutes) ?? num(task.logged_minutes) ?? 0,
      estimate_minutes: num(time.estimate_minutes) ?? (estimate !== null ? Math.round(estimate * 60) : null),
    },
    statuses: statusesOf(p.statuses),
    priorities: prioritiesOf(p.priorities),
    can: (obj(p.can) ?? {}) as Can,
    options: opts
      ? {
          sprints: list(opts.sprints),
          milestones: list(opts.milestones),
          members: list(opts.members).map((m) => ({ user_id: m.id, name: m.name })),
        }
      : null,
    archived: !!p.archived,
  };
}

/**
 * GET /api/tasks/{id} on a server with the task editor (Project 2.5): the Tasks task with its `project` block and
 * per-field `can`. Null when the answer has no project block — an older server, or a task on no project.
 */
export function fromTasksRead(raw: unknown): EditorData | null {
  const r = obj(raw);
  const p = r ? obj(r.project) : null;
  if (!r || !p) return null;
  const block = blockOf(r, p);
  if (!block.id) return null;
  // `can_edit` has the Tasks keys and the project's; `read_only` names what this reader may not change.
  const fields: Record<string, boolean> = { ...boolMap(r.can_edit) };
  for (const k of Array.isArray(p.read_only) ? p.read_only : []) fields[String(k)] = false;
  if (typeof r.can_comment === 'boolean') fields.comment = r.can_comment;
  const t = r as unknown as TasksDetail;
  return {
    task: { ...t, status: tasksStatusOf(block.status), tags: Array.isArray(t.tags) ? t.tags : typeof r.tags === 'string' ? splitTags(r.tags) : [], comments: t.comments ?? [], checklist: t.checklist ?? [], can_edit: { ...(t.can_edit ?? {}) } as TasksDetail['can_edit'] },
    project: block,
    fields,
    source: 'tasks',
  };
}

const splitTags = (s: string | null | undefined): string[] => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** The fields a reader with `project.task` may change; without it, the assignee's (PRJ-TED-06). */
const ALL_FIELDS = ['title', 'status', 'priority', 'assignee_id', 'reviewer_id', 'start_date', 'due_date', 'progress', 'description', 'tags', 'checklist', 'task_type', 'sprint_id', 'milestone_id', 'parent_id', 'story_points', 'estimated_hours', 'is_billable', 'blocked_reason', 'dependencies'];
const ASSIGNEE_FIELDS = ['status', 'progress', 'description', 'checklist'];

/** An older server: the Projects read (GET /api/projects/tasks/{id}) shaped for the Tasks parts. */
export function fromProjectsRead(d: ProjectsTaskDetail, me: number): EditorData {
  const t = d.task;
  const raw = d as unknown as Raw;
  const block = blockOf({ ...(t as unknown as Raw), dependencies: d.dependencies, time: d.time }, { id: t.project_id, code: t.project_code, name: t.project, can: d.can, statuses: raw.statuses });
  const caps = d.can ?? {};
  const fields = Object.fromEntries(ALL_FIELDS.map((f) => [f, caps.task ? true : t.assignee_id === me && me > 0 && ASSIGNEE_FIELDS.includes(f)]));
  const task: TasksDetail = {
    id: t.id,
    task_key: t.task_number,
    list_id: null,
    org_id: null,
    org_name: str(raw.company),
    owner_id: 0,
    assignee_id: t.assignee_id,
    assignee_name: t.assignee,
    title: t.title,
    description: t.description,
    status: tasksStatusOf(t.status),
    priority: 'medium',
    tags: splitTags(t.tags),
    start_date: t.start_date,
    start_at: null,
    due_date: t.due_date,
    due_at: null,
    estimated_hours: num(t.estimated_hours),
    progress: t.progress ?? 0,
    position: t.position,
    archived: false,
    completed_at: t.completed_at,
    created_at: null,
    updated_at: t.updated_at,
    comments: (d.comments ?? []).map((c: Comment) => ({ id: c.id, user_id: c.author_id ?? 0, user_name: c.author ?? 'Someone', body: c.body, created_at: c.at })),
    checklist: d.checklist ?? [],
    can_edit: Object.fromEntries(['title', 'status', 'priority', 'assignee_id', 'due_date', 'start_date', 'progress', 'description', 'org_id', 'list_id', 'tags', 'checklist', 'people'].map((f) => [f, !!fields[f]])) as TasksDetail['can_edit'],
  };
  return { task, project: block, fields, source: 'projects' };
}

// ── who may change what ────────────────────────────────────────────────────

export const NEEDS_CONNECTION = 'Needs a connection';
export const READ_ONLY = 'You can see this but not change it';
export const ARCHIVED = 'The project is archived — its tasks can no longer change';

/** What may still change offline (PRJ-TED-10): the status — comments and logged time have their own outbox path. */
const OFFLINE_FIELDS = new Set(['status']);

/** Project fields: without a per-field answer from the server, `project.task` decides (PRJ-TED-06). */
const PROJECT_KEYS = new Set(['task_type', 'sprint_id', 'milestone_id', 'reviewer_id', 'parent_id', 'story_points', 'estimated_hours', 'is_billable', 'blocked_reason', 'dependencies']);

/** Whether the reader may change a field now, and if not, why — the field is shown read-only, never hidden (PRJ-TED-08). */
export function access(data: EditorData, field: string, offline: boolean): { ok: boolean; reason: string | null } {
  const may = field in data.fields ? data.fields[field]! : PROJECT_KEYS.has(field) ? !!data.project.can.task : !!data.task.can_edit?.[field as keyof TasksDetail['can_edit']];
  if (data.project.archived) return { ok: false, reason: ARCHIVED };
  if (!may) return { ok: false, reason: READ_ONLY };
  if (offline && !OFFLINE_FIELDS.has(field)) return { ok: false, reason: NEEDS_CONNECTION };
  return { ok: true, reason: null };
}

// ── which endpoint owns a field ────────────────────────────────────────────

/** Saved by the project's rule (PUT /api/projects/tasks/{id}: foreign links, member check, the vocabulary). */
export const PROJECT_FIELDS: readonly string[] = ['priority', 'assignee_id', 'reviewer_id', 'task_type', 'sprint_id', 'milestone_id', 'parent_id', 'story_points', 'estimated_hours', 'is_billable', 'blocked_reason'];
/** What the project's PUT also takes, for an older server whose Tasks endpoints do not know the project's people. */
const PROJECT_TOO: readonly string[] = ['title', 'description', 'tags', 'start_date', 'due_date', 'progress'];

export type Route = 'tasks' | 'project' | 'move';

/**
 * Where a change goes (§14.2): the status is the board's move (the project's applyStatus, one outbox entry with the
 * board and the list, kept offline); the project's fields go to PUT /api/projects/tasks/{id}; the Tasks fields to
 * /api/tasks/{id} — or, on an older server that gave the task through the Projects read, to the project's PUT too.
 */
export function routeOf(field: string, source: EditorData['source']): Route {
  if (field === 'status') return 'move';
  if (PROJECT_FIELDS.includes(field)) return 'project';
  if (source === 'projects' && PROJECT_TOO.includes(field)) return 'project';
  return 'tasks';
}

/** A field's value as the project's PUT takes it. */
export function projectBody(field: string, value: unknown): Record<string, unknown> {
  if (field === 'tags') return { tags: Array.isArray(value) ? value.join(', ') : value };
  if ((field === 'due_date' || field === 'start_date') && typeof value === 'string') return { [field]: value ? value.slice(0, 10) : null };
  if (value === '' && /_id$/.test(field)) return { [field]: null };
  return { [field]: value };
}

/** What a status change carries: the status, and the reason when it is Blocked. */
export type StatusValue = TaskStatus | { status: TaskStatus; blocked_reason?: string | null };

/**
 * The project task's field router for patchTask(): each field to the endpoint that owns its rule. `base` is the
 * task as the modal read it (its number and `updated_at`, for the move's conflict check, NFR-09).
 */
export function projectRouter(base: { id: number; number: string | null; title: string; updatedAt: string | null }, source: EditorData['source'], tasksWriter: FieldWriter = writeTaskField): FieldRouter {
  const move: FieldWriter = async (_task, _field, value) => {
    const v = value as StatusValue;
    const status = typeof v === 'string' ? v : v.status;
    const reason = typeof v === 'string' ? null : (v.blocked_reason ?? null);
    const r = await submit({ kind: 'move', taskId: base.id, status, ...(reason ? { blockedReason: reason } : {}), baseUpdatedAt: base.updatedAt, label: `Move ${base.number ?? base.title} to ${TASK_STATUS_LABEL[status]}` });
    if (r.error && !r.queued) throw new Error(r.error);
    if (r.queued) toast('info', 'Offline — the move is kept and sent when you reconnect.');
  };
  const project: FieldWriter = async (_task, field, value) => {
    await apiPut(`${API}/tasks/${base.id}`, projectBody(field, value));
  };
  return (field) => {
    const r = routeOf(field, source);
    return r === 'move' ? move : r === 'project' ? project : tasksWriter;
  };
}

// ── what waits for this task ───────────────────────────────────────────────

/**
 * This task in the outbox (PRJ-TED-10): the status as I left it (a queued move shows where I put it), what waits to
 * be sent, and what needs my choice — a move in conflict, or anything the server refused.
 */
export function pendingFor(outbox: readonly ProjectsOutboxItem[], taskId: number): { status: TaskStatus | null; waiting: string[]; choices: Array<{ id: string; label: string; message: string | null }> } {
  let status: TaskStatus | null = null;
  const waiting: string[] = [];
  const choices: Array<{ id: string; label: string; message: string | null }> = [];
  for (const i of [...outbox].sort((a, b) => a.seq - b.seq)) {
    if (i.taskId !== taskId) continue;
    if (i.state === 'conflict' || i.state === 'refused') {
      choices.push({ id: i.id, label: i.label, message: i.message });
      continue;
    }
    if (i.kind === 'move' && i.status) status = i.status;
    waiting.push(i.label);
  }
  return { status, waiting, choices };
}

// ── time entries ───────────────────────────────────────────────────────────

/** An entry's state as the Time section says it (PRJ-TED-04): Pending, Approved, Sent back, Invoiced… and whether it is locked. */
export function entryState(e: TimeEntry & { sent_back_note?: string | null; lock_reason?: string | null; invoiced?: boolean; lock_state?: string | null }): { key: string; label: string; locked: boolean } {
  // The server's words (Project 2.5 `lock_state`: Pending, Approved, Sent back, Invoiced, Submitted, Running), else its state.
  const s = (e.lock_state ? e.lock_state.toLowerCase().replace(/ /g, '_') : (e.state ?? '')).toLowerCase();
  const key = e.running ? 'running' : e.invoiced || s === 'invoiced' ? 'invoiced' : s === 'sent_back' || e.sent_back_note ? 'sent_back' : s === 'submitted' ? 'submitted' : e.approved || s === 'approved' ? 'approved' : 'pending';
  const label = { running: 'Running', invoiced: 'Invoiced', sent_back: 'Sent back', submitted: 'In HR timesheet', approved: 'Approved', pending: 'Pending' }[key]!;
  return { key, label, locked: !!e.locked || key === 'invoiced' || key === 'submitted' || key === 'approved' };
}

// ── J/K through the view behind (PRJ-TED-09) ───────────────────────────────

let order: readonly number[] = [];
const orderListeners = new Set<() => void>();

function setOrder(ids: readonly number[]): void {
  if (ids.length === order.length && ids.every((x, i) => x === order[i])) return;
  order = ids;
  for (const l of orderListeners) l();
}

/**
 * The task ids of the view behind the modal, in its order (the board's columns, the list's rows, My work's groups,
 * the week's entries, a milestone's tasks). Null leaves it to another view (the list inside the board).
 */
export function usePublishTaskOrder(ids: readonly number[] | null): void {
  const key = ids ? ids.join(',') : null;
  useEffect(() => {
    if (key === null) return;
    const mine = key ? key.split(',').map(Number) : [];
    setOrder(mine);
    return () => {
      if (order.join(',') === key) setOrder([]);
    };
  }, [key]);
}

export function useTaskOrder(): readonly number[] {
  return useSyncExternalStore(
    (fn) => (orderListeners.add(fn), () => orderListeners.delete(fn)),
    () => order,
    () => order,
  );
}

/** The task after (J) or before (K) this one in the view behind; null at either end or when it is not there. */
export function stepTask(ids: readonly number[], current: number, dir: 1 | -1): number | null {
  const at = ids.indexOf(current);
  if (at < 0) return null;
  return ids[at + dir] ?? null;
}

/** The web's address of a project task, for Copy link. */
export function taskLink(origin: string, projectId: number, taskId: number): string {
  return `${origin}/projects/${projectId}/tasks/${taskId}`;
}
