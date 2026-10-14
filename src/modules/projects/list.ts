import { hhmm, stampMs, TASK_STATUS_LABEL } from '@shared/projects';
import type { BulkResult, Task, TaskStatus } from './api';
import { BOARD_COLUMNS, columnOf, daysBetween, isBlocked, shortDay } from './logic';

/**
 * The task list view's rules with no screen in them (PRJ-LST-01..10, §14.1): its columns, the remembered layout, the
 * quick filters, sorting (the server's rules: priority by rank, status in board order, empty values last, default the
 * board position), grouping, what a row says about when it is due, the CSV it exports and how a bulk answer reads.
 * The list is a second view of the board's tasks — the same response, filter, keys and move path, never a second set
 * of rules.
 */

// ── columns ────────────────────────────────────────────────────────────────

export const LIST_COLUMNS = ['number', 'title', 'status', 'assignee', 'priority', 'due', 'sprint', 'milestone', 'points', 'logged', 'updated'] as const;
export type ListColumn = (typeof LIST_COLUMNS)[number];

export const COLUMN_LABEL: Record<ListColumn, string> = {
  number: 'Number',
  title: 'Title',
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  due: 'Due',
  sprint: 'Sprint',
  milestone: 'Milestone',
  points: 'Pts',
  logged: 'Logged / est.',
  updated: 'Updated',
};

/** Number and Title are always shown (the column chooser cannot hide them). */
export const FIXED_COLUMNS: readonly ListColumn[] = ['number', 'title'];
export const DEFAULT_COLUMNS: ListColumn[] = ['number', 'title', 'status', 'assignee', 'priority', 'due', 'sprint', 'points', 'logged'];

/** The grid's track for each column (D05). */
export const COLUMN_WIDTH: Record<ListColumn, string> = {
  number: '86px',
  title: 'minmax(220px, 1fr)',
  status: '118px',
  assignee: '150px',
  priority: '84px',
  due: '96px',
  sprint: '96px',
  milestone: '120px',
  points: '44px',
  logged: '104px',
  updated: '92px',
};

// ── the remembered layout (PRJ-LST-02) ─────────────────────────────────────

export const GROUPS = ['status', 'assignee', 'sprint', 'milestone', 'priority', 'none'] as const;
export type GroupBy = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<GroupBy, string> = {
  status: 'Status',
  assignee: 'Assignee',
  sprint: 'Sprint',
  milestone: 'Milestone',
  priority: 'Priority',
  none: 'None',
};

export const CHIPS = ['mine', 'overdue', 'blocked', 'bugs', 'hide_completed'] as const;
export type QuickChip = (typeof CHIPS)[number];
export const CHIP_LABEL: Record<QuickChip, string> = {
  mine: 'Mine',
  overdue: 'Overdue',
  blocked: 'Blocked',
  bugs: 'Bugs',
  hide_completed: 'Hide completed',
};

/** The sort keys the server takes too (`sort=`), whitelisted. */
export const SORT_KEYS: readonly ListColumn[] = ['number', 'title', 'status', 'assignee', 'priority', 'due', 'sprint', 'milestone', 'points', 'logged', 'updated'];

export interface TaskViewPrefs {
  view: 'board' | 'list';
  group: GroupBy;
  /** "due", "-priority": a `-` sorts that key descending; first key first. */
  sort: string[];
  columns: ListColumn[];
  /** Collapsed groups, as `{group}:{key}` ("status:completed", "sprint:none"), as the web stores them. */
  collapsed: string[];
  chips: QuickChip[];
}

export const DEFAULT_TASK_VIEW: TaskViewPrefs = {
  view: 'board',
  group: 'status',
  sort: [],
  columns: DEFAULT_COLUMNS,
  collapsed: ['status:completed'],
  chips: [],
};

const MAX_COLLAPSED = 60;

/** A stored value read defensively (≤4 KB on the server): anything unknown dropped, the fixed columns kept. Null for nothing usable. */
export function normaliseTaskView(raw: unknown): TaskViewPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const columns = Array.isArray(r.columns) ? strings(r.columns).filter((c): c is ListColumn => (LIST_COLUMNS as readonly string[]).includes(c)) : DEFAULT_COLUMNS;
  const sort = strings(r.sort).filter((s) => (SORT_KEYS as readonly string[]).includes(s.replace(/^-/, '')));
  return {
    view: r.view === 'list' ? 'list' : 'board',
    group: (GROUPS as readonly unknown[]).includes(r.group) ? (r.group as GroupBy) : 'status',
    sort: [...new Map(sort.map((s) => [s.replace(/^-/, ''), s])).values()].slice(0, 3),
    columns: LIST_COLUMNS.filter((c) => FIXED_COLUMNS.includes(c) || columns.includes(c)),
    collapsed: Array.isArray(r.collapsed) ? [...new Set(strings(r.collapsed).filter((c) => c.length <= 80))].slice(0, MAX_COLLAPSED) : DEFAULT_TASK_VIEW.collapsed,
    chips: strings(r.chips).filter((c): c is QuickChip => (CHIPS as readonly string[]).includes(c)),
  };
}

// ── sorting (PRJ-LST-05) ───────────────────────────────────────────────────

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
/** Board order: backlog, the columns (blocked with In progress), then cancelled. */
const STATUS_ORDER: TaskStatus[] = ['backlog', ...BOARD_COLUMNS, 'cancelled'];
/** A status group's place: the board's columns (blocked work under In progress). */
export const statusRank = (s: TaskStatus): number => STATUS_ORDER.indexOf(columnOf(s) ?? s);
/** Sorting by status, as the server sorts (TaskListOrder::STATUS_ORDER): blocked right after In progress. */
const SORT_STATUS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'testing', 'completed', 'cancelled'];

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A task's value for a sort key: null is "empty" and always goes last. */
function sortValue(t: Task, key: string): string | number | null {
  switch (key) {
    case 'number': {
      const m = /(\d+)\s*$/.exec(t.task_number ?? '');
      return m ? Number(m[1]) : t.id;
    }
    case 'title':
      return t.title.toLowerCase();
    case 'status':
      return SORT_STATUS.indexOf(t.status);
    case 'assignee':
      return t.assignee ? t.assignee.toLowerCase() : null;
    case 'priority':
      return PRIORITY_RANK[t.priority] ?? null;
    case 'due':
      return t.due_date ? t.due_date.slice(0, 10) : null;
    case 'sprint':
      return t.sprint ? t.sprint.toLowerCase() : null;
    case 'milestone':
      return t.milestone ? t.milestone.toLowerCase() : null;
    case 'points':
      return num(t.story_points);
    case 'logged':
      return t.logged_minutes ?? 0;
    case 'updated':
      return stampMs(t.updated_at);
    default:
      return null;
  }
}

/** The board's own order: column, then position. The list's default. */
export function byBoardPosition(a: Task, b: Task): number {
  return statusRank(a.status) - statusRank(b.status) || a.position - b.position || a.id - b.id;
}

export function sortTasks(tasks: readonly Task[], sort: readonly string[]): Task[] {
  const keys = sort.map((s) => ({
    key: s.replace(/^-/, ''),
    dir: s.startsWith('-') ? -1 : 1,
  }));
  return [...tasks].sort((a, b) => {
    for (const { key, dir } of keys) {
      const x = sortValue(a, key);
      const y = sortValue(b, key);
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (c) return c * dir;
    }
    return byBoardPosition(a, b);
  });
}

/** A header click: asc → desc → off. Shift-click adds (or cycles) a key after the others; a plain click sorts by it alone. */
export function nextSort(sort: readonly string[], key: ListColumn, add: boolean): string[] {
  const at = sort.findIndex((s) => s.replace(/^-/, '') === key);
  const cur = at < 0 ? null : sort[at]!.startsWith('-') ? 'desc' : 'asc';
  const next = cur === null ? key : cur === 'asc' ? `-${key}` : null;
  if (!add) return next ? [next] : [];
  const rest = [...sort];
  if (at >= 0) rest.splice(at, 1, ...(next ? [next] : []));
  else if (next) rest.push(next);
  return rest.slice(0, 3);
}

export function sortOf(sort: readonly string[], key: ListColumn): 'ascending' | 'descending' | 'none' {
  const s = sort.find((x) => x.replace(/^-/, '') === key);
  return !s ? 'none' : s.startsWith('-') ? 'descending' : 'ascending';
}

// ── filters (PRJ-LST-06) ───────────────────────────────────────────────────

const isDone = (t: Pick<Task, 'status'>) => t.status === 'completed' || t.status === 'cancelled';
export const isLate = (t: Pick<Task, 'status' | 'due_date'>, today: string): boolean => !isDone(t) && !!t.due_date && t.due_date.slice(0, 10) < today;

/** The board's text filter: number, title, assignee and tags. Both views use it. */
export function textFilter<T extends Pick<Task, 'task_number' | 'title' | 'assignee' | 'tags'>>(tasks: readonly T[], needle: string | null): T[] {
  const n = (needle ?? '').trim().toLowerCase();
  return n ? tasks.filter((t) => `${t.task_number ?? ''} ${t.title} ${t.assignee ?? ''} ${t.tags ?? ''}`.toLowerCase().includes(n)) : [...tasks];
}

export function chipFilter(tasks: readonly Task[], chips: readonly QuickChip[], me: number, today: string): Task[] {
  return tasks.filter(
    (t) =>
      (!chips.includes('mine') || t.assignee_id === me) &&
      (!chips.includes('overdue') || isLate(t, today)) &&
      (!chips.includes('blocked') || isBlocked(t)) &&
      (!chips.includes('bugs') || t.task_type === 'bug') &&
      (!chips.includes('hide_completed') || !isDone(t)),
  );
}

// ── groups (PRJ-LST-04) ────────────────────────────────────────────────────

export interface Group {
  /** `{group}:{key}`, as `collapsed` stores it; '' for no grouping. */
  key: string;
  label: string;
  tasks: Task[];
  points: number;
  /** "WIP 4 of 3" when a status group is over its limit. */
  wip: string | null;
  /** Assignee groups: "3 open · 120%". */
  note: string | null;
  /** The status a new task in this group starts in (N). */
  status: TaskStatus;
}

export interface Member {
  user_id: number;
  name: string;
  capacity_hours?: string | null;
  load_percent?: number | null;
}

const pointsOf = (tasks: readonly Task[]) => tasks.reduce((n, t) => n + (num(t.story_points) ?? 0), 0);

/**
 * The rows under their headers, in the list's sort within each. Status groups follow the board's columns (blocked
 * work under In progress, as on the board); every other grouping puts the empty value last ("No sprint").
 */
export function groupTasks(
  sorted: readonly Task[],
  group: GroupBy,
  opts: {
    wip?: Partial<Record<TaskStatus, number>>;
    members?: readonly Member[];
  } = {},
): Group[] {
  if (group === 'none')
    return [
      {
        key: '',
        label: 'All tasks',
        tasks: [...sorted],
        points: pointsOf(sorted),
        wip: null,
        note: null,
        status: 'todo',
      },
    ];
  const buckets = new Map<string, { label: string; order: number | string; tasks: Task[]; status: TaskStatus }>();
  const put = (k: string, label: string, order: number | string, t: Task, status: TaskStatus = 'todo') => {
    const b = buckets.get(k) ?? { label, order, tasks: [], status };
    b.tasks.push(t);
    buckets.set(k, b);
  };
  for (const t of sorted) {
    if (group === 'status') {
      const s = columnOf(t.status) ?? t.status;
      put(s, TASK_STATUS_LABEL[s], statusRank(s), t, s === 'cancelled' ? 'todo' : s);
    } else if (group === 'priority') {
      const r = PRIORITY_RANK[t.priority];
      put(r === undefined ? '' : t.priority, PRIORITY_LABEL[t.priority] ?? 'No priority', r ?? 99, t);
    } else if (group === 'assignee') {
      put(t.assignee_id ? String(t.assignee_id) : '', t.assignee ?? 'Unassigned', t.assignee_id ? (t.assignee ?? '').toLowerCase() : '￿', t);
    } else if (group === 'sprint') {
      put(t.sprint_id ? String(t.sprint_id) : '', t.sprint ?? 'No sprint', t.sprint_id ? (t.sprint ?? '').toLowerCase() : '￿', t);
    } else {
      put(t.milestone_id ? String(t.milestone_id) : '', t.milestone ?? 'No milestone', t.milestone_id ? (t.milestone ?? '').toLowerCase() : '￿', t);
    }
  }
  const out = [...buckets.entries()]
    .sort(([, a], [, b]) => (typeof a.order === 'number' && typeof b.order === 'number' ? a.order - b.order : String(a.order).localeCompare(String(b.order))))
    .map(([k, b]): Group => {
      const limit = group === 'status' ? opts.wip?.[k as TaskStatus] : undefined;
      let note: string | null = null;
      if (group === 'assignee') {
        const open = b.tasks.filter((t) => !isDone(t));
        const m = k ? opts.members?.find((x) => String(x.user_id) === k) : undefined;
        const capacity = num(m?.capacity_hours);
        const estimate = open.reduce((n, t) => n + (num(t.estimated_hours) ?? 0), 0);
        const load = m?.load_percent ?? (capacity ? Math.round((estimate / capacity) * 100) : null);
        note = [`${open.length} open`, load !== null && load !== undefined && k ? `load ${load}%` : null].filter(Boolean).join(' · ');
      }
      return {
        key: `${group}:${k || 'none'}`,
        label: b.label,
        tasks: b.tasks,
        points: pointsOf(b.tasks),
        wip: limit && b.tasks.length > limit ? `WIP ${b.tasks.length} of ${limit}` : null,
        note,
        status: b.status,
      };
    });
  return out;
}

// ── what a row says ────────────────────────────────────────────────────────

/** Due, late in words (D05): "2 days late", "1 day late", "Today", "17 Oct". */
export function dueWords(t: Pick<Task, 'due_date' | 'status'>, today: string): { label: string; late: boolean } {
  if (!t.due_date) return { label: '', late: false };
  const day = t.due_date.slice(0, 10);
  const diff = daysBetween(today, day);
  if (!isDone(t) && diff < 0)
    return {
      label: `${-diff} ${diff === -1 ? 'day' : 'days'} late`,
      late: true,
    };
  if (diff === 0) return { label: 'Today', late: false };
  if (diff === 1) return { label: 'Tomorrow', late: false };
  return { label: shortDay(day), late: false };
}

/** Logged / estimate: "9:30 / 8 h", over in red. */
export function loggedWords(t: Pick<Task, 'logged_minutes' | 'estimated_hours' | 'over_estimate'>): { label: string; over: boolean } {
  const est = num(t.estimated_hours);
  const over = t.over_estimate ?? (est !== null && est > 0 && (t.logged_minutes ?? 0) > est * 60);
  return {
    label: `${hhmm(t.logged_minutes ?? 0)}${est !== null ? ` / ${Number(est.toFixed(2))} h` : ''}`,
    over,
  };
}

/** "14 Oct 10:42" for Updated. */
export function updatedWords(stamp: string | null, today: string): string {
  const ms = stampMs(stamp);
  if (ms === null) return '';
  const d = new Date(ms);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return ymd === today ? time : `${shortDay(ymd)} ${time}`;
}

// ── CSV (PRJ-LST-10) ───────────────────────────────────────────────────────

const cell = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};

export function csvValue(t: Task, c: ListColumn, today: string): string | number | null {
  switch (c) {
    case 'number':
      return t.task_number ?? `#${t.id}`;
    case 'title':
      return [t.task_type === 'bug' ? '[Bug] ' : '', t.title, isBlocked(t) && t.blocked_reason ? ` (blocked: ${t.blocked_reason})` : ''].join('');
    case 'status':
      return TASK_STATUS_LABEL[t.status] ?? t.status;
    case 'assignee':
      return t.assignee;
    case 'priority':
      return PRIORITY_LABEL[t.priority] ?? t.priority;
    case 'due':
      return t.due_date ? t.due_date.slice(0, 10) + (isLate(t, today) ? ` (${dueWords(t, today).label})` : '') : '';
    case 'sprint':
      return t.sprint;
    case 'milestone':
      return t.milestone ?? null;
    case 'points':
      return t.story_points ?? null;
    case 'logged':
      return loggedWords(t).label;
    case 'updated':
      return t.updated_at;
  }
}

/** The rows and columns as shown, UTF-8 with a BOM so Excel reads Sinhala and Tamil right. */
export function toCsv(rows: readonly Task[], columns: readonly ListColumn[], today: string): string {
  const lines = [columns.map((c) => cell(COLUMN_LABEL[c])).join(',')];
  for (const t of rows) lines.push(columns.map((c) => cell(csvValue(t, c, today))).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** "PRJ-0018 tasks 2026-10-14.csv", within what the save dialog takes. */
export function csvFileName(code: string | null | undefined, today: string): string {
  const base = `${(code ?? 'Project').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 40) || 'Project'} tasks ${today}`;
  return `${base}.csv`;
}

// ── bulk (PRJ-LST-08) ──────────────────────────────────────────────────────

export const BULK_MAX = 200;

/** "2 updated, 1 refused — TSK-0409: Say why the task is blocked". */
export function bulkSummary(r: BulkResult, verb = 'updated'): string {
  const head = [`${r.done.length} ${verb}`, r.refused.length ? `${r.refused.length} refused` : null].filter(Boolean).join(', ');
  if (!r.refused.length) return head;
  const named = r.refused.slice(0, 3).map((x) => `${x.number ?? `#${x.id}`}: ${x.reason}`);
  return `${head} — ${named.join('; ')}${r.refused.length > 3 ? ` and ${r.refused.length - 3} more` : ''}`;
}

// ── the keyboard over rows and group headers (PRJ-LST-09) ──────────────────

export type ListItem = { type: 'group'; key: string } | { type: 'row'; id: number };

/** The next item for J/K, ↑/↓, Home and End. Nothing focused: the first. */
export function listKey(items: readonly ListItem[], at: number, key: 'down' | 'up' | 'home' | 'end'): number {
  if (!items.length) return -1;
  if (key === 'home') return 0;
  if (key === 'end') return items.length - 1;
  if (at < 0) return 0;
  return Math.max(0, Math.min(items.length - 1, at + (key === 'down' ? 1 : -1)));
}

/** Rows drawn at once; more come as the list scrolls (or as the keyboard reaches them). */
export const CHUNK = 150;
