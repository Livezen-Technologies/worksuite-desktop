import { plainText, sanitizeHtml } from '../../core/rich';
import { addDays, currentZone } from '../../core/time';

/**
 * Tasks (`/api/tasks`, `/api/task-lists`). A task's `due_date`/`start_date`
 * is a calendar day; `due_at`/`start_at`, when set, is the true UTC instant
 * (with a Z) and the day beside it is where that instant fell for whoever set
 * it. Descriptions and comments are HTML the server has cleaned.
 */
export type Status = 'backlog' | 'todo' | 'in_progress' | 'on_hold' | 'review' | 'changes_requested' | 'done' | 'cancelled';
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export interface Task {
  id: number;
  task_key: string | null;
  list_id: number | null;
  org_id: number | null;
  org_name: string | null;
  owner_id: number;
  assignee_id: number | null;
  assignee_name: string | null;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  tags: string[];
  start_date: string | null;
  start_at: string | null;
  due_date: string | null;
  due_at: string | null;
  estimated_hours: number | null;
  progress: number;
  position: number;
  archived: boolean;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  checklist_done?: number;
  checklist_total?: number;
}

export type Editable = 'title' | 'status' | 'priority' | 'assignee_id' | 'due_date' | 'start_date' | 'progress' | 'description' | 'org_id' | 'list_id' | 'tags' | 'checklist' | 'people';

export interface Comment {
  id: number;
  user_id: number;
  user_name: string;
  body: string;
  created_at: string;
}

export interface ChecklistItem {
  id: number;
  title: string;
  done: boolean;
}

export interface TaskDetail extends Task {
  comments: Comment[];
  checklist: ChecklistItem[];
  can_edit: Record<Editable, boolean>;
}

export type Role = 'assignee' | 'reviewer' | 'follower' | 'shared';
export interface Person {
  id: number;
  user_id: number;
  name: string;
  email: string | null;
  role: Role;
  permission: 'view' | 'comment' | 'edit' | 'manage';
  is_primary: boolean;
}
export interface People {
  owner_id: number;
  people: Person[];
  can_manage: boolean;
  following: boolean;
}

export interface Activity {
  id: number;
  action: string;
  summary: string | null;
  actor: string | null;
  created_at: string;
}

export interface Attachment {
  id: number;
  comment_id: number | null;
  file_id: number;
  name: string;
  extension: string | null;
  mime_type: string | null;
  size: number;
  missing: boolean;
  added_by_name: string | null;
  created_at: string;
}

export interface TaskList {
  id: number;
  name: string;
  color: string;
  is_favorite: boolean;
  open_count: number;
}

export const STATUSES: Array<{ id: Status; label: string; dot: string }> = [
  { id: 'backlog', label: 'Backlog', dot: '#A3A9B8' },
  { id: 'todo', label: 'To Do', dot: '#8A91A6' },
  { id: 'in_progress', label: 'In Progress', dot: '#23349E' },
  { id: 'review', label: 'Review', dot: '#6B3FB5' },
  { id: 'changes_requested', label: 'Changes Requested', dot: '#B42318' },
  { id: 'on_hold', label: 'On Hold', dot: '#B45309' },
  { id: 'done', label: 'Done', dot: '#1F7A4D' },
  { id: 'cancelled', label: 'Cancelled', dot: '#A3A9B8' },
];

export const PRIORITIES: Array<{ id: Priority; label: string; tone: string }> = [
  { id: 'urgent', label: 'Urgent', tone: 'bg-danger-bg text-danger' },
  { id: 'high', label: 'High', tone: 'bg-warning-bg text-warning-ink dark:text-warning' },
  { id: 'medium', label: 'Medium', tone: 'bg-selection text-primary' },
  { id: 'low', label: 'Low', tone: 'bg-subtle text-ink-2' },
  { id: 'none', label: 'None', tone: 'bg-subtle text-ink-3' },
];

export const statusOf = (s: string) => STATUSES.find((x) => x.id === s) ?? STATUSES[1]!;
export const priorityOf = (p: string) => PRIORITIES.find((x) => x.id === p) ?? PRIORITIES[2]!;

export function isOpen(t: Pick<Task, 'status'>): boolean {
  return t.status !== 'done' && t.status !== 'cancelled';
}

/** How far along: the checklist when there is one, else what was set. */
export function progressOf(t: Pick<Task, 'progress' | 'checklist_done' | 'checklist_total' | 'status'>): number {
  if (t.status === 'done') return 100;
  if (t.checklist_total) return Math.round(((t.checklist_done ?? 0) / t.checklist_total) * 100);
  return Math.max(0, Math.min(100, t.progress ?? 0));
}

/** An instant's day and minutes on the WorkSuite clock. */
function wall(iso: string, tz = currentZone()): { ymd: string; minutes: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '00';
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')) };
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export type DueGroup = 'overdue' | 'today' | 'week' | 'later' | 'none';

/**
 * When a task is due, as the list and the cards say it: the day on your
 * clock ("Today 6 PM", "Yesterday", "Fri", "12 Oct"), how urgent that is,
 * and which group it falls in. A day without a time is due by the end of it.
 */
export function dueOf(t: Pick<Task, 'due_date' | 'due_at' | 'status'>, today: string, now = Date.now()): { day: string | null; label: string; group: DueGroup; tone: 'overdue' | 'soon' | 'plain' | 'done' } {
  const at = t.due_at ? wall(t.due_at) : null;
  const day = at ? at.ymd : t.due_date;
  if (!day) return { day: null, label: '', group: 'none', tone: 'plain' };
  const open = isOpen(t);
  const late = open && (at ? Date.parse(t.due_at!) < now : day < today);
  const d = new Date(`${day}T12:00:00Z`);
  const diff = Math.round((d.getTime() - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const time = at ? ` ${clock(at.minutes)}` : '';
  const name =
    diff === 0 ? `Today${time}` : diff === -1 ? `Yesterday${time}` : diff === 1 ? `Tomorrow${time}` : diff > 1 && diff < 7 ? `${WEEKDAY[d.getUTCDay()]}${time}` : `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}${d.getUTCFullYear() !== Number(today.slice(0, 4)) ? ` ${d.getUTCFullYear()}` : ''}`;
  const endOfWeek = addDays(today, 6 - ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const group: DueGroup = late ? 'overdue' : day === today ? 'today' : day <= endOfWeek && day > today ? 'week' : day < today ? 'overdue' : 'later';
  return { day, label: name, group: open ? group : 'later', tone: !open ? 'done' : late ? 'overdue' : diff <= 0 ? 'soon' : 'plain' };
}

export type Scope = 'all' | 'mine' | 'today' | 'overdue' | 'upcoming' | 'done' | 'shared' | `list:${number}`;

export const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: 'all', label: 'All active' },
  { id: 'mine', label: 'Assigned to me' },
  { id: 'today', label: 'Due today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'done', label: 'Completed' },
  { id: 'shared', label: 'Shared with me' },
];

/** Upcoming: due in the next week, after today. */
export const UPCOMING_DAYS = 7;

/** Which tasks a view shows (the shared ones come from their own request). */
export function inScope(t: Task, scope: Scope, me: number, today: string, now = Date.now()): boolean {
  if (scope === 'shared') return true;
  if (scope === 'done') return t.status === 'done';
  if (scope.startsWith('list:')) return t.list_id === Number(scope.slice(5));
  if (!isOpen(t)) return false;
  if (scope === 'mine') return t.assignee_id === me;
  // Due today, overdue and upcoming are apart (worksuite-desktop#104): something due at 9 this morning, at noon, is overdue, not "today".
  if (scope === 'today') return dueOf(t, today, now).group === 'today';
  if (scope === 'overdue') return dueOf(t, today, now).group === 'overdue';
  if (scope === 'upcoming') {
    const d = dueOf(t, today, now);
    return d.group !== 'overdue' && d.day !== null && d.day > today && d.day <= addDays(today, UPCOMING_DAYS);
  }
  return true;
}

/** The counts beside each view and list: what is still open there. */
export function counts(tasks: Task[], shared: Task[], lists: TaskList[], me: number, today: string, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SCOPES) if (s.id !== 'done' && s.id !== 'shared') out[s.id] = tasks.filter((t) => inScope(t, s.id, me, today, now)).length;
  out.shared = shared.filter(isOpen).length;
  for (const l of lists) out[`list:${l.id}`] = tasks.filter((t) => t.list_id === l.id && isOpen(t)).length;
  return out;
}

/** Rich text to show in a task: the strict profile (see core/rich). */
export function sanitizeRich(html: string | null | undefined, imageUrl?: (fileId: string) => string): string {
  return sanitizeHtml(html, { profile: 'strict', imageUrl });
}

export { plainText };
