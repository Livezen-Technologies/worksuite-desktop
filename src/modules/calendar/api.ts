import { addDays, currentZone, dayLabel } from '../../core/time';

/**
 * Calendar (`/api/calendar/*`). The feed is on the reader's clock: every
 * `start_at`/`end_at` is naive "YYYY-MM-DD HH:MM:SS" wall-clock digits in the
 * person's WorkSuite zone — own events are stored exactly as typed, and the
 * server converts meetings, tasks and tenders before sending them. So times
 * are shown and placed by their digits, never re-read as UTC, and new times
 * go back as naive "YYYY-MM-DDTHH:MM" (a zone suffix would be stored as
 * digits too). Start, end and all-day always travel together on a write.
 */
export interface CalendarEvent {
  source: string;
  id: number | string;
  title: string;
  description?: string | null;
  category?: string | null;
  location?: string | null;
  color: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  editable: boolean;
  can_manage?: boolean;
  my_role?: 'viewer' | 'editor' | null;
  invited?: boolean;
  my_rsvp?: string | null;
  edit_block?: string | null;
  manage_block?: string | null;
  meeting_uuid?: string | null;
  join_url?: string | null;
  remind_minutes?: number | null;
  recur_freq?: string | null;
  recur_until?: string | null;
  recurring?: boolean;
  occurrence_date?: string | null;
  uuid?: string;
  meeting_no?: string;
  priority?: string;
  status?: string;
  subtitle?: string;
  link?: string;
  route?: string;
}

export interface Participant {
  user_id: number;
  name: string;
  status: string;
  role: 'viewer' | 'editor' | null;
  is_you: boolean;
}

export interface EventDetail extends CalendarEvent {
  participants: Participant[];
}

/**
 * The SHOW filters of CalendarWeek: which sources each one covers, and its
 * colour. `apps`: the catalogue apps a category's entries come from — it is
 * listed only while the person has one of them (none = the calendar's own, or HR's).
 */
export const CATEGORIES: Array<{ id: string; label: string; color: string; sources: (s: string) => boolean; apps?: string[] }> = [
  { id: 'events', label: 'Events', color: '#0E7C86', sources: (s) => s === 'event' },
  { id: 'meetings', label: 'Meetings', color: '#23349E', sources: (s) => s === 'meeting' || s === 'businessmeeting', apps: ['meet', 'meetings'] },
  { id: 'tasks', label: 'Tasks', color: '#9A4A06', sources: (s) => s === 'task', apps: ['tasks'] },
  { id: 'leave', label: 'Your leave', color: '#6B3FB5', sources: (s) => s === 'leave' },
  { id: 'holidays', label: 'Public holidays', color: '#B42318', sources: (s) => s === 'holiday' },
  { id: 'projects', label: 'Projects & sprints', color: '#1F7A4D', sources: (s) => s.startsWith('project_'), apps: ['projects'] },
  { id: 'tenders', label: 'Tender closing', color: '#B45309', sources: (s) => s === 'tender', apps: ['tenders'] },
  { id: 'assets', label: 'Assets (licence, warranty, maintenance)', color: '#4A5168', sources: (s) => s.startsWith('asset_'), apps: ['assets'] },
  { id: 'renewals', label: 'Subscription renewals', color: '#B83280', sources: (s) => s === 'subscription', apps: ['subscriptions'] },
];

export function categoryOf(source: string): string {
  return CATEGORIES.find((c) => c.sources(source))?.id ?? 'events';
}

/** The event's colour: its own for events, the category's for everything else. */
/**
 * An event drawn in its own colour, readable in both themes: the colour
 * itself on a 10% tint in light, and in dark a lightened mix of it on a
 * stronger tint (a deep indigo title on the dark grid could not be read).
 * Set `--ev` to the colour in the element's style.
 */
export const EVENT_TONE =
  'text-[color:var(--ev)] bg-[color:color-mix(in_srgb,var(--ev)_10%,transparent)] dark:text-[color:color-mix(in_srgb,var(--ev)_42%,white)] dark:bg-[color:color-mix(in_srgb,var(--ev)_24%,transparent)]';

/** The colour only as text (the day's list): lightened in dark, as above. */
export const EVENT_TEXT = 'text-[color:var(--ev)] dark:text-[color:color-mix(in_srgb,var(--ev)_42%,white)]';

export function colourOf(e: CalendarEvent): string {
  if (e.source === 'event' && e.color && /^#[0-9a-f]{6}$/i.test(e.color)) return e.color;
  return CATEGORIES.find((c) => c.sources(e.source))?.color ?? '#23349E';
}

export const SWATCHES = ['#23349E', '#0E7C86', '#1F7A4D', '#B45309', '#6B3FB5', '#B42318'];

export const REMINDERS: Array<[number | null, string]> = [
  [15, '15 minutes before'],
  [0, 'At start time'],
  [5, '5 minutes before'],
  [10, '10 minutes before'],
  [30, '30 minutes before'],
  [60, '1 hour before'],
  [1440, '1 day before'],
  [null, 'No reminder'],
];

/** "2026-09-26 14:30:00" → minutes since midnight (by the digits). */
export function minutesOf(stamp: string): number {
  const m = /[T ](\d{2}):(\d{2})/.exec(stamp);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function dayOf(stamp: string): string {
  return stamp.slice(0, 10);
}

/** Naive local "YYYY-MM-DDTHH:MM" for day + minutes, as the server wants it. */
export function naive(ymd: string, minutes: number): string {
  const day = addDays(ymd, Math.floor(minutes / 1440));
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "YYYY-MM-DD HH:MM:SS" → the value a datetime-local input shows. */
export function toInput(stamp: string | null | undefined): string {
  return stamp ? stamp.replace(' ', 'T').slice(0, 16) : '';
}

/** Now on the WorkSuite clock: the day and minutes since midnight. */
export function nowWall(now = Date.now()): { ymd: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: currentZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const g = (k: string) => parts.find((p) => p.type === k)?.value ?? '00';
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')) };
}

export function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return addDays(ymd, -((d.getUTCDay() + 6) % 7));
}

export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** The 6 × 7 days a month view shows, Monday first. */
export function monthGrid(ymd: string): string[] {
  const first = weekStart(monthStart(ymd));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Side-by-side columns for a day's overlapping timed events: each gets its
 * column and how many columns its cluster needs.
 */
export function layoutDay<T extends { start: number; end: number }>(items: T[]): Array<T & { col: number; cols: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Array<T & { col: number; cols: number }> = [];
  let cluster: Array<T & { col: number; cols: number }> = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) c.cols = cols;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.col));
    let col = 0;
    while (taken.has(col)) col++;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

/** Where a non-event entry opens: a native tab route, or a web path. */
export function destinationOf(e: CalendarEvent): { route?: string; web?: string } | null {
  if (e.source === 'businessmeeting') return { route: `/meetings?meeting=${e.id}` };
  if (e.source === 'meeting' && e.uuid) return { route: `/meet/${e.uuid}` };
  if (e.source === 'task') return { route: `/tasks?task=${e.id}` };
  if (e.link) return { web: e.link };
  if (e.route) return { web: e.route };
  return null;
}

/** A feed stamp moved by some minutes, as the naive "YYYY-MM-DDTHH:MM" the server takes. */
export function shifted(stamp: string, minutes: number): string {
  return naive(dayOf(stamp), minutesOf(stamp) + minutes);
}

/** An entry's end, or an hour after its start when it has none. */
export function endOf(e: CalendarEvent): string {
  return e.end_at ?? shifted(e.start_at, 60).replace('T', ' ') + ':00';
}

/** Whose times the calendar may move by dragging: your own events, and meetings you organise or host. */
export function movable(e: CalendarEvent): boolean {
  return e.editable && (e.source === 'event' || e.source === 'businessmeeting');
}

export type View = 'day' | 'week' | 'month';

/** The days a view shows around a date, and what its heading says. */
export function viewRange(view: View, date: string): { from: string; to: string; days: string[] } {
  if (view === 'day') return { from: date, to: date, days: [date] };
  if (view === 'week') {
    const from = weekStart(date);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return { from, to: days[6]!, days };
  }
  const days = monthGrid(date);
  return { from: days[0]!, to: days[41]!, days };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(ymd: string): string {
  return `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
}

/** "21 – 27 September 2026", "28 September – 4 October 2026", "September 2026", "Saturday 26 September 2026". */
export function rangeLabel(view: View, date: string): string {
  if (view === 'month') return monthLabel(date);
  if (view === 'day') return dayLabel(date);
  const { from, to } = viewRange('week', date);
  const d = (x: string) => Number(x.slice(8));
  if (from.slice(0, 7) === to.slice(0, 7)) return `${d(from)} – ${d(to)} ${monthLabel(to)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${d(from)} ${MONTHS[Number(from.slice(5, 7)) - 1]} – ${d(to)} ${monthLabel(to)}`;
  return `${d(from)} ${monthLabel(from)} – ${d(to)} ${monthLabel(to)}`;
}

/** Where ‹ and › go from a date in a view. */
export function step(view: View, date: string, n: number): string {
  if (view === 'month') return addMonths(date, n);
  return addDays(date, n * (view === 'week' ? 7 : 1));
}

/** Whole days from one date to another. */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

