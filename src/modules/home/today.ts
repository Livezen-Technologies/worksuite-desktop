import type { CalendarEvent } from '../calendar/api';
import { dueOf, isOpen, type Task } from '../tasks/api';

/**
 * What Home counts as today's work, and how it lays its cards out.
 *
 * TODAY'S TASKS WERE EMPTY FOR PEOPLE WITH TASKS DUE TODAY (QA-014), for two
 * reasons. Home asked only for `filter=active`, which is the tasks you created
 * or are the first assignee of; a task you were added to afterwards is only in
 * `filter=shared`, as the Tasks page knows. And it compared `due_date` with
 * today — the day on the clock of whoever set a time on it, not yours — where
 * the Tasks page reads `due_at` through `dueOf`. Both now read the same way.
 */

/** Both lists, once each: yours, then those shared with you. */
export function mergeTasks(mine: Task[], shared: Task[]): Task[] {
  const seen = new Set(mine.map((t) => t.id));
  return [...mine, ...shared.filter((t) => !seen.has(t.id) && (seen.add(t.id), true))];
}

/** Open, and due today on your clock — the counter. Overdue is not "due today". */
export function dueToday(tasks: Task[], today: string, now = Date.now()): Task[] {
  return tasks.filter((t) => isOpen(t) && dueOf(t, today, now).day === today);
}

/** Open and due by the end of today, overdue first, then by time — the card. */
export function todaysWork(tasks: Task[], today: string, now = Date.now()): Task[] {
  return tasks
    .map((t) => ({ t, d: dueOf(t, today, now) }))
    .filter(({ t, d }) => isOpen(t) && d.day !== null && d.day <= today)
    .sort((a, b) => (a.d.day! < b.d.day! ? -1 : a.d.day! > b.d.day! ? 1 : (a.t.due_at ?? '~').localeCompare(b.t.due_at ?? '~')))
    .map(({ t }) => t);
}

/** Meetings today — what the counter says it counts (it counted every timed event). */
export function meetingsToday(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => !e.all_day && (e.source === 'meeting' || e.source === 'businessmeeting' || !!e.meeting_uuid || !!e.join_url));
}

// ── the cards, and Customize (QA-015) ──────────────────────────────────

export type CardId = 'work' | 'calendar' | 'waiting' | 'activity' | 'files' | 'summary';

export const CARDS: Array<{ id: CardId; label: string }> = [
  { id: 'work', label: "Today's work" },
  { id: 'calendar', label: 'Calendar' },
  { id: 'waiting', label: 'Waiting for me' },
  { id: 'activity', label: 'Activity' },
  { id: 'files', label: 'Recent files' },
  { id: 'summary', label: 'Daily summary' },
];

export interface Layout {
  order: CardId[];
  hidden: CardId[];
}

export const DEFAULT_LAYOUT: Layout = { order: CARDS.map((c) => c.id), hidden: [] };

const known = new Set<string>(CARDS.map((c) => c.id));

/** A saved layout, made whole: unknown cards dropped, new ones added at the end. */
export function normalise(raw: unknown): Layout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { order?: unknown; hidden?: unknown };
  const order = (Array.isArray(r.order) ? r.order : []).filter((x): x is CardId => typeof x === 'string' && known.has(x));
  const unique = [...new Set(order)];
  for (const c of CARDS) if (!unique.includes(c.id)) unique.push(c.id);
  const hidden = [...new Set((Array.isArray(r.hidden) ? r.hidden : []).filter((x): x is CardId => typeof x === 'string' && known.has(x)))];
  return { order: unique, hidden };
}

export function move(l: Layout, id: CardId, by: -1 | 1): Layout {
  const i = l.order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= l.order.length) return l;
  const order = [...l.order];
  [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...l, order };
}

export function toggle(l: Layout, id: CardId): Layout {
  return { ...l, hidden: l.hidden.includes(id) ? l.hidden.filter((x) => x !== id) : [...l.hidden, id] };
}

/** This computer's Home layout for this person — a convenience, so a storage that refuses is no layout. */
export function loadLayout(userId: string | number | null | undefined): Layout {
  try {
    const raw = localStorage.getItem(`ws.home.layout:${userId ?? ''}`);
    return raw ? normalise(JSON.parse(raw)) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(userId: string | number | null | undefined, l: Layout): void {
  try {
    localStorage.setItem(`ws.home.layout:${userId ?? ''}`, JSON.stringify(l));
  } catch {
    /* a convenience */
  }
}
