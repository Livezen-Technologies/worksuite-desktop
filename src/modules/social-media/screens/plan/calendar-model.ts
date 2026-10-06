/**
 * W03 / D01 calendar arithmetic, kept out of the views so it runs once per data change (NFR-08: 500 posts drawn in
 * under 1.5 s): the days a month or week view covers, and the posts bucketed by the viewer's day once.
 */
import { postWhen, type Post } from '../../api';
import { calendarBucket, type CalendarBucket } from '../../lib/status';
import { addDays, inZone, weekStart } from '../../lib/time';

export type CalendarView = 'month' | 'week' | 'list';

export interface Placed {
  post: Post;
  at: string;
  ymd: string;
  minutes: number;
  bucket: CalendarBucket;
}

/** The days a view covers, first to last inclusive. A month runs Monday to Sunday over whole weeks. */
export function viewDays(view: CalendarView, anchor: string): string[] {
  if (view === 'week') {
    const mon = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const start = weekStart(first);
  const nextMonth = addDays(first, 32).slice(0, 7);
  const last = addDays(`${nextMonth}-01`, -1);
  const end = addDays(weekStart(last), 6);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Each post on its day in the viewer's zone, sorted by time; posts without a time stay out (they're Unscheduled). */
export function bucketByDay(posts: Post[], tz: string): Map<string, Placed[]> {
  const byDay = new Map<string, Placed[]>();
  for (const post of posts) {
    const at = postWhen(post);
    if (!at) continue;
    const z = inZone(at, tz);
    const row: Placed = { post, at, ymd: z.ymd, minutes: z.minutes, bucket: calendarBucket(post.status) };
    const list = byDay.get(z.ymd);
    if (list) list.push(row);
    else byDay.set(z.ymd, [row]);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.minutes - b.minutes || a.post.id - b.post.id);
  return byDay;
}

/** Move by one month or one week. */
export function step(view: CalendarView, anchor: string, dir: 1 | -1): string {
  if (view === 'week') return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return d.toISOString().slice(0, 10);
}

/** "October 2026", or "6 – 12 October 2026" for a week. */
export function rangeLabel(view: CalendarView, anchor: string): string {
  const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
  if (view !== 'week') return fmt(anchor, { month: 'long', year: 'numeric' });
  const mon = weekStart(anchor);
  const sun = addDays(mon, 6);
  const same = mon.slice(0, 7) === sun.slice(0, 7);
  return `${fmt(mon, same ? { day: 'numeric' } : { day: 'numeric', month: 'long' })} – ${fmt(sun, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** "Mon 06". */
export function dayHead(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', timeZone: 'UTC' }).replace(',', '');
}

/** "Thursday 9 October". */
export function dayLong(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(',', '');
}

export const DRAG_TYPE = 'application/x-worksuite-social-post';

/** What is being dragged: a placed post, or a draft from Unscheduled. */
export interface DragPayload {
  id: number;
  kind: 'post' | 'draft';
}

export function readDrag(dt: DataTransfer | null): DragPayload | null {
  const raw = dt?.getData(DRAG_TYPE) || dt?.getData('text/plain') || '';
  const m = /^(post|draft):(\d+)$/.exec(raw);
  return m ? { kind: m[1] as DragPayload['kind'], id: Number(m[2]) } : null;
}

export function writeDrag(dt: DataTransfer, p: DragPayload): void {
  const v = `${p.kind}:${p.id}`;
  dt.setData(DRAG_TYPE, v);
  dt.setData('text/plain', v);
  dt.effectAllowed = 'move';
}

/** The week grid: 07:00–22:00 (D01). */
export const WEEK_FROM = 7 * 60;
export const WEEK_TO = 22 * 60;
export const HOUR_PX = 48;

/** A drop's height in the week grid as a time of day, snapped to 15 minutes. */
export function minutesAt(offsetY: number): number {
  const raw = WEEK_FROM + (offsetY / HOUR_PX) * 60;
  const snapped = Math.round(raw / 15) * 15;
  return Math.min(WEEK_TO - 15, Math.max(WEEK_FROM, snapped));
}
