import { stampMs, type ProjectsOutboxItem } from '@shared/projects';
import type { Task, TaskStatus, TimeEntry } from './api';

/**
 * Projects' rules with no screen in them: the board's columns and its keyboard, what a card says about when it is
 * due, My work's groups by the reader's own day (NFR-06), the sprint's day, the day's time line, and how queued
 * changes show on the cards while they wait (PRJ-DSK-04).
 */

// ── the board ──────────────────────────────────────────────────────────────

/** The board's columns (D01). Backlog shows only when something is in it; blocked work stays in progress, flagged. */
export const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'testing', 'completed'];

/** The column a task sits in, or null for one the board does not show (cancelled). */
export function columnOf(status: TaskStatus): TaskStatus | null {
  if (status === 'blocked') return 'in_progress';
  if (status === 'cancelled') return null;
  return status;
}

export function isBlocked(t: Pick<Task, 'status' | 'blocked_reason'>): boolean {
  return t.status === 'blocked' || !!t.blocked_reason;
}

export interface Column {
  status: TaskStatus;
  tasks: Task[];
}

export function buildColumns(tasks: Task[]): Column[] {
  const statuses: TaskStatus[] = tasks.some((t) => t.status === 'backlog') ? ['backlog', ...BOARD_COLUMNS] : BOARD_COLUMNS;
  return statuses.map((status) => ({
    status,
    tasks: tasks.filter((t) => columnOf(t.status) === status).sort((a, b) => a.position - b.position || a.id - b.id),
  }));
}

export type BoardKey = 'down' | 'up' | 'left' | 'right';

/**
 * The selection after J, K, ← or → (D01): J and K go down and up a column, ← and → go to the next column that has
 * cards, keeping the row as near as it can. With nothing selected any key selects the first card. Null only for
 * an empty board.
 */
export function boardKey(columns: ReadonlyArray<ReadonlyArray<number>>, selected: number | null, key: BoardKey): number | null {
  const first = columns.find((c) => c.length)?.[0] ?? null;
  if (selected === null) return first;
  const col = columns.findIndex((c) => c.includes(selected));
  if (col < 0) return first;
  const row = columns[col]!.indexOf(selected);
  if (key === 'down') return columns[col]![Math.min(row + 1, columns[col]!.length - 1)]!;
  if (key === 'up') return columns[col]![Math.max(row - 1, 0)]!;
  const step = key === 'right' ? 1 : -1;
  for (let c = col + step; c >= 0 && c < columns.length; c += step) {
    const cards = columns[c]!;
    if (cards.length) return cards[Math.min(row, cards.length - 1)]!;
  }
  return selected;
}

/** Shift+← / Shift+→: the column a card moves to, or null at the edge. */
export function nextColumn(statuses: readonly TaskStatus[], current: TaskStatus, dir: 'left' | 'right'): TaskStatus | null {
  const from = statuses.indexOf(columnOf(current) ?? current);
  const to = from + (dir === 'right' ? 1 : -1);
  return from < 0 || to < 0 || to >= statuses.length ? null : statuses[to]!;
}

// ── days ───────────────────────────────────────────────────────────────────

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Whole days from one calendar day to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** The Sunday that ends the week a day is in (weeks start on Monday). */
export function endOfWeek(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

/** "14 Oct". */
export function shortDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

/** When an open task is due, as a card says it: "14 Oct", "Today", "Wed 14", or how late: "15 d late". */
export function dueOf(t: Pick<Task, 'due_date' | 'status'>, today: string): { label: string; late: boolean } {
  if (!t.due_date) return { label: '', late: false };
  const day = t.due_date.slice(0, 10);
  const open = t.status !== 'completed' && t.status !== 'cancelled';
  const diff = daysBetween(today, day);
  if (open && diff < 0) return { label: `${-diff} d late`, late: true };
  if (diff === 0) return { label: 'Today', late: false };
  if (diff === 1) return { label: 'Tomorrow', late: false };
  if (diff > 1 && diff < 7) return { label: `${WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${Number(day.slice(8))}`, late: false };
  return { label: shortDay(day), late: false };
}

// ── My work (D03) ──────────────────────────────────────────────────────────

export interface MyWorkGroups {
  overdue: Task[];
  today: Task[];
  week: Task[];
  later: Task[];
}

/**
 * My work's groups on the reader's own calendar (NFR-06): overdue before today, today, the rest of this week (to
 * Sunday), and later (or no date). The server's grouping is its own day's; this is mine. Each task once, open ones
 * only, soonest first.
 */
export function groupMyWork(tasks: readonly Task[], today: string): MyWorkGroups {
  const seen = new Set<number>();
  const out: MyWorkGroups = { overdue: [], today: [], week: [], later: [] };
  const sunday = endOfWeek(today);
  for (const t of tasks) {
    if (seen.has(t.id) || t.status === 'completed' || t.status === 'cancelled') continue;
    seen.add(t.id);
    const due = t.due_date?.slice(0, 10) ?? null;
    if (!due) out.later.push(t);
    else if (due < today) out.overdue.push(t);
    else if (due === today) out.today.push(t);
    else if (due <= sunday) out.week.push(t);
    else out.later.push(t);
  }
  const byDue = (a: Task, b: Task) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (a.task_number ?? '').localeCompare(b.task_number ?? '');
  for (const k of Object.keys(out) as Array<keyof MyWorkGroups>) out[k].sort(byDue);
  return out;
}

export type MyWorkFilter = 'all' | 'mine' | 'review' | 'bugs';

export function filterMyWork(tasks: readonly Task[], filter: MyWorkFilter, me: number, reviews: readonly Task[] = []): Task[] {
  if (filter === 'mine') return tasks.filter((t) => t.assignee_id === me);
  if (filter === 'review') {
    const ids = new Set(reviews.map((r) => r.id));
    return [...reviews, ...tasks.filter((t) => !ids.has(t.id) && t.reviewer_id === me && t.status === 'in_review')];
  }
  if (filter === 'bugs') return tasks.filter((t) => t.task_type === 'bug');
  return [...tasks];
}

// ── sprints ────────────────────────────────────────────────────────────────

export function activeSprint<S extends { status: string; start_date: string | null; end_date: string | null }>(sprints: readonly S[] | undefined, today: string): S | null {
  const list = sprints ?? [];
  return list.find((s) => s.status === 'active') ?? list.find((s) => !!s.start_date && !!s.end_date && s.start_date <= today && today <= s.end_date!) ?? null;
}

/** "day 4 of 9" (D01): calendar days from the sprint's start, both ends counted. */
export function sprintDay(s: { start_date: string | null; end_date: string | null }, today: string): { day: number; of: number } | null {
  if (!s.start_date || !s.end_date) return null;
  const of = daysBetween(s.start_date, s.end_date) + 1;
  if (of < 1) return null;
  return { day: Math.max(1, Math.min(of, daysBetween(s.start_date, today) + 1)), of };
}

// ── queued changes on the cards (D04) ──────────────────────────────────────

export type PendingMark = 'Move waiting' | 'Note waiting' | 'Time waiting' | 'Needs your choice';

/**
 * The board as I left it: a move still in the outbox shows the card where I put it, and every card with something
 * waiting says what (D04's "Move waiting", "Note waiting"). A move that needs my choice says so instead.
 */
export function withPending(tasks: readonly Task[], outbox: readonly ProjectsOutboxItem[]): { tasks: Task[]; marks: Map<number, PendingMark> } {
  const marks = new Map<number, PendingMark>();
  const moved = new Map<number, TaskStatus>();
  for (const i of [...outbox].sort((a, b) => a.seq - b.seq)) {
    if (i.taskId === null || i.state === 'refused') continue;
    if (i.kind === 'move' && i.status) {
      moved.set(i.taskId, i.status);
      marks.set(i.taskId, i.state === 'conflict' ? 'Needs your choice' : 'Move waiting');
    } else if (!marks.has(i.taskId)) marks.set(i.taskId, i.kind === 'comment' ? 'Note waiting' : 'Time waiting');
  }
  return { tasks: tasks.map((t) => (moved.has(t.id) ? { ...t, status: moved.get(t.id)! } : t)), marks };
}

/** "Cached for offline · last change 10:42": the newest change among the board's tasks. */
export function lastChange(tasks: readonly Pick<Task, 'updated_at'>[]): number | null {
  let best: number | null = null;
  for (const t of tasks) {
    const at = stampMs(t.updated_at);
    if (at !== null && (best === null || at > best)) best = at;
  }
  return best;
}

// ── today's time (D03) ─────────────────────────────────────────────────────

export interface DaySegment {
  key: string;
  /** Where on the 08:00–20:00 line, in percent. */
  left: number;
  width: number;
  projectId: number | null;
  label: string;
  running: boolean;
}

/** The day's line (D03): each entry with a start, placed between `fromHour` and `toHour` on the reader's clock. */
export function daySegments(entries: readonly TimeEntry[], running: { startedAt: string; projectId: number | null; label: string } | null, now: number, minutesOfDay: (ms: number) => number, fromHour = 8, toHour = 20): DaySegment[] {
  const span = (toHour - fromHour) * 60;
  const place = (startMin: number, minutes: number) => {
    const a = Math.max(0, Math.min(span, startMin - fromHour * 60));
    const b = Math.max(0, Math.min(span, startMin + minutes - fromHour * 60));
    return { left: (a / span) * 100, width: ((b - a) / span) * 100 };
  };
  const out: DaySegment[] = [];
  for (const e of entries) {
    const at = stampMs(e.started_at);
    if (at === null || e.running) continue;
    const p = place(minutesOfDay(at), e.minutes);
    if (p.width > 0) out.push({ key: `e${e.id}`, ...p, projectId: e.project_id, label: [e.project, e.task].filter(Boolean).join(' · ') || 'Not on a project', running: false });
  }
  if (running) {
    const at = stampMs(running.startedAt);
    if (at !== null) {
      const p = place(minutesOfDay(at), Math.max(1, (now - at) / 60_000));
      if (p.width > 0) out.push({ key: 'running', ...p, projectId: running.projectId, label: `${running.label} · running now`, running: true });
    }
  }
  return out;
}

/** Today's time by project (D03), the running timer included, largest first. */
export function perProject(entries: readonly TimeEntry[], running: { projectId: number | null; project: string | null; seconds: number } | null): Array<{ projectId: number | null; label: string; minutes: number }> {
  const by = new Map<string, { projectId: number | null; label: string; minutes: number }>();
  const add = (projectId: number | null, label: string | null, minutes: number) => {
    const k = String(projectId ?? 'none');
    const had = by.get(k) ?? { projectId, label: label ?? 'Not on a project', minutes: 0 };
    had.minutes += minutes;
    by.set(k, had);
  };
  for (const e of entries) if (!e.running) add(e.project_id, e.project, e.minutes);
  if (running) add(running.projectId, running.project, Math.floor(running.seconds / 60));
  return [...by.values()].sort((a, b) => b.minutes - a.minutes);
}
