import { CATEGORIES, entryCategory, type CalendarEvent } from '../calendar/api';
import { dueOf, inScope, isOpen, type Task } from '../tasks/api';

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

/**
 * Due today, overdue and upcoming, apart (#104) — by the Tasks page's own views, so a count on Home is the length of
 * the list it opens. `me` only matters to views that ask whose a task is; these do not.
 */
export function taskBuckets(tasks: Task[], today: string, now = Date.now()): { today: Task[]; overdue: Task[]; upcoming: Task[] } {
  const of = (scope: 'today' | 'overdue' | 'upcoming') => tasks.filter((t) => inScope(t, scope, 0, today, now));
  const byDue = (a: Task, b: Task) => (dueOf(a, today, now).day ?? '~').localeCompare(dueOf(b, today, now).day ?? '~') || (a.due_at ?? '~').localeCompare(b.due_at ?? '~');
  return { today: of('today').sort(byDue), overdue: of('overdue').sort(byDue), upcoming: of('upcoming').sort(byDue) };
}

/** A count that fits a card: 1,234 → "1.2K". The exact number goes in the tooltip. */
export function compactCount(n: number): string {
  if (Math.abs(n) < 1000) return String(n);
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Unread messages, as the tile says them: past 99 it is "99+". */
export function cappedCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What is waiting for you, by kind: "1 invitation · 1 approval". Empty when nothing is. */
export function waitingBreakdown(c: { invitations: number; approvals: number; acknowledgements: number }): string {
  return [
    c.invitations ? plural(c.invitations, 'invitation') : null,
    c.approvals ? plural(c.approvals, 'approval') : null,
    c.acknowledgements ? plural(c.acknowledgements, 'acknowledgement') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ── today's agenda ──────────────────────────────────────────────────────

/** "30 min", "1 hr", "1 hr 30 min". */
export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`;
}

/** How long until something starts: "in 55 min", "in 1 hr 5 min"; "Now" once it has. */
export function untilLabel(minutes: number): string {
  return minutes <= 0 ? 'Now' : `in ${durationLabel(minutes)}`;
}

/** A meeting scheduled from a tender (#100): by its source, or — from a server that sends only the label — by that. */
export function isTenderMeeting(e: Pick<CalendarEvent, 'source' | 'source_type' | 'related'>): boolean {
  return entryCategory(e) === 'tendermeetings' || (e.source === 'businessmeeting' && /tender/i.test(e.related?.kind_label ?? ''));
}

export interface AgendaItem {
  e: CalendarEvent;
  /** Minutes since midnight, by the digits of the feed (it is on the reader's clock). */
  start: number;
  end: number;
  past: boolean;
  live: boolean;
}

/**
 * The day as the agenda shows it: all-day entries apart, the timed ones in order, which have ended and which is on,
 * where "now" falls among them, and the next meeting — the one on now, or the first still to come.
 */
export function agendaOf(events: CalendarEvent[], now: number): { allDay: CalendarEvent[]; timed: AgendaItem[]; nowAt: number; next: AgendaItem | null } {
  const at = (s: string) => {
    const m = /[T ](\d{2}):(\d{2})/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  const allDay = events.filter((e) => e.all_day);
  const timed = events
    .filter((e) => !e.all_day)
    .map((e) => {
      const start = at(e.start_at);
      // An end on another day (past midnight) runs to the end of this one.
      const end = e.end_at ? (e.end_at.slice(0, 10) > e.start_at.slice(0, 10) ? 1440 : Math.max(at(e.end_at), start)) : start + 60;
      return { e, start, end, past: end <= now, live: start <= now && now < end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const nowAt = timed.findIndex((i) => !i.past);
  const meetings = new Set(meetingsToday(events));
  const next = timed.find((i) => !i.past && meetings.has(i.e)) ?? null;
  return { allDay, timed, nowAt: nowAt < 0 ? timed.length : nowAt, next };
}

/** "All day · 3 renewals" and what they are, for the all-day group. */
export function allDayLabel(events: CalendarEvent[]): { title: string; detail: string } {
  const kinds = [...new Set(events.map((e) => entryCategory(e)))];
  const renewals = kinds.length === 1 && kinds[0] === 'renewals';
  const title = `All day · ${renewals ? plural(events.length, 'renewal') : plural(events.length, 'item')}`;
  const detail = kinds.map((k) => CATEGORIES.find((c) => c.id === k)?.label ?? 'Events').join(', ');
  return { title, detail };
}

// ── the cards, and Customize (QA-015, #104) ─────────────────────────────

export type CardId = 'work' | 'calendar' | 'summary' | 'waiting' | 'announcements' | 'activity' | 'files';

/**
 * Where a card sits in the optimized layout: the main grid (today's work beside the agenda, recent activity beside
 * recent files) or the rail on the right (the daily brief, Waiting for me, announcements). A card moves within its
 * own place; it is never put from one into the other.
 */
export type Zone = 'main' | 'rail';

export const CARDS: Array<{ id: CardId; label: string; zone: Zone }> = [
  { id: 'work', label: "Today's work", zone: 'main' },
  { id: 'calendar', label: "Today's agenda", zone: 'main' },
  { id: 'activity', label: 'Recent activity', zone: 'main' },
  { id: 'files', label: 'Recent files', zone: 'main' },
  { id: 'summary', label: 'Your daily brief', zone: 'rail' },
  { id: 'waiting', label: 'Waiting for me', zone: 'rail' },
  { id: 'announcements', label: 'Announcements', zone: 'rail' },
];

export function zoneOf(id: CardId): Zone {
  return CARDS.find((c) => c.id === id)?.zone ?? 'main';
}

/** Normal shares a row of the main grid with its neighbour; wide takes the whole row. Rail cards are always normal. */
export type CardSize = 'normal' | 'wide';

/** 2: the optimized Home (zones). A layout saved before it (no version) is migrated by `normalise`. */
export const LAYOUT_VERSION = 2;

export interface Layout {
  version: number;
  order: CardId[];
  hidden: CardId[];
  /** The main cards made wide; every other card is normal. */
  wide: CardId[];
}

export const DEFAULT_LAYOUT: Layout = { version: LAYOUT_VERSION, order: CARDS.map((c) => c.id), hidden: [], wide: [] };

/** The order every layout had before version 2: someone who never moved a card gets the new default order. */
const V1_ORDER: CardId[] = ['work', 'calendar', 'waiting', 'announcements', 'activity', 'files', 'summary'];

const known = new Set<string>(CARDS.map((c) => c.id));
const ids = (raw: unknown): CardId[] => [...new Set((Array.isArray(raw) ? raw : []).filter((x): x is CardId => typeof x === 'string' && known.has(x)))];

/**
 * A saved layout, made whole: unknown cards dropped, new ones added at the end. One saved before version 2 keeps
 * what was hidden and the order cards were put in (each within its zone); "wide" meant two of three columns then
 * and is dropped, so the main grid starts from the design's widths.
 */
export function normalise(raw: unknown): Layout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { version?: unknown; order?: unknown; hidden?: unknown; wide?: unknown };
  const old = r.version !== LAYOUT_VERSION;
  let order = ids(r.order);
  if (old && order.length === V1_ORDER.length && order.every((id, i) => id === V1_ORDER[i])) order = [...DEFAULT_LAYOUT.order];
  for (const c of CARDS) if (!order.includes(c.id)) order.push(c.id);
  return { version: LAYOUT_VERSION, order, hidden: ids(r.hidden), wide: old ? [] : ids(r.wide).filter((id) => zoneOf(id) === 'main') };
}

export function sizeOf(l: Layout, id: CardId): CardSize {
  return l.wide.includes(id) ? 'wide' : 'normal';
}

export function resize(l: Layout, id: CardId, size: CardSize): Layout {
  const wide = l.wide.filter((x) => x !== id);
  return { ...l, wide: size === 'wide' && zoneOf(id) === 'main' ? [...wide, id] : wide };
}

/**
 * How wide each shown main card is on the 9-column main grid: two normal cards share a row (5 + 4, as designed);
 * a wide one, or one left alone in its row, takes all of it.
 */
export function mainSpans(shown: CardId[], wide: CardId[]): Map<CardId, 'full' | 'major' | 'minor'> {
  const out = new Map<CardId, 'full' | 'major' | 'minor'>();
  let open: CardId | null = null;
  for (const id of shown) {
    if (wide.includes(id)) {
      if (open) out.set(open, 'full');
      open = null;
      out.set(id, 'full');
    } else if (open) {
      out.set(open, 'major');
      out.set(id, 'minor');
      open = null;
    } else open = id;
  }
  if (open) out.set(open, 'full');
  return out;
}

/** Drag-and-drop: the card goes where the other one is, within its zone. */
export function place(l: Layout, id: CardId, before: CardId): Layout {
  if (id === before || zoneOf(id) !== zoneOf(before)) return l;
  const order = l.order.filter((x) => x !== id);
  const at = order.indexOf(before);
  if (at < 0) return l;
  order.splice(at, 0, id);
  return { ...l, order };
}

/** Up or down past the next card of the same zone. */
export function move(l: Layout, id: CardId, by: -1 | 1): Layout {
  const same = l.order.filter((x) => zoneOf(x) === zoneOf(id));
  const other = same[same.indexOf(id) + by];
  if (!same.includes(id) || !other) return l;
  const order = [...l.order];
  const i = order.indexOf(id);
  const j = order.indexOf(other);
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
