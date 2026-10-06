import { addDays, currentZone, dayKey, dayWords, relative, stampDayLabel, timeLabel, wallToUtc } from '../../../core/time';

export { addDays };

/**
 * How Marketing shows numbers, rates and times (design "WorkSuite Marketing — Modern UI": system mono for keys, IDs,
 * numbers and merge tags). Pure functions, shared by every screen and tested on their own. Dates and times are on the
 * reader's clock and in their language — the app's own (core/time: user → organisation → OS zone, FR-L10N-02).
 */

/** `4,812`; a missing value is an em dash, never a zero. */
export function count(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
}

/** `31.4%` from a value already in percent (0..100); one decimal. */
export function pct(n: number | null | undefined, digits = 1): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

/** `82.5%` from a part of a whole; `—` when the whole is nothing. */
export function share(part: number | null | undefined, whole: number | null | undefined, digits = 1): string {
  if (typeof part !== 'number' || typeof whole !== 'number' || whole <= 0) return '—';
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

/** A part as a 0..100 width for a bar. */
export function ratio(part: number | null | undefined, whole: number | null | undefined): number {
  if (typeof part !== 'number' || typeof whole !== 'number' || whole <= 0) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

/** A UTC stamp without a zone (`2026-10-02 10:41:00`), or an ISO one, as a Date; null when unreadable. */
export function parseStamp(s: string | null | undefined): Date | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00Z`);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `12 Sep 2026` on the reader's calendar. */
export function day(s: string | null | undefined): string {
  if (!s) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayWords(s, { year: true });
  return parseStamp(s) ? stampDayLabel(s, 'year') : '—';
}

/** `12 Sep 2026 16:02` — a ledger row (append-only evidence reads best in full). */
export function full(s: string | null | undefined): string {
  return s && parseStamp(s) ? `${stampDayLabel(s, 'year')} ${timeLabel(s)}` : '—';
}

/** `14:00`, `tomorrow 10:30`, `6 Oct 09:00` — when something is due, on the reader's clock. */
export function due(s: string | null | undefined, now: Date = new Date()): string {
  const d = parseStamp(s);
  if (!s || !d) return '—';
  if (d.getTime() <= now.getTime()) return 'now';
  const t = timeLabel(s);
  const today = dayKey(now);
  const that = dayKey(d);
  if (that === today) return t;
  if (that === addDays(today, 1)) return `tomorrow ${t}`;
  return `${stampDayLabel(s, 'short')} ${t}`;
}

/** `5 min ago`, `Yesterday`, `Mon`, `30 Sep` — the last-activity column, as the app's lists say it. */
export function ago(s: string | null | undefined, now: Date = new Date()): string {
  return s && parseStamp(s) ? relative(s, now.getTime()) : '';
}

/** Minutes until a stamp, never below zero (an idle claim's release, "auto-release in 18 min"). */
export function minutesUntil(s: string | null | undefined, now: Date = new Date()): number | null {
  const d = parseStamp(s);
  return d ? Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 60_000)) : null;
}

/** `03:12` — a call's running time. */
export function clock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${String(m).padStart(2, '0')}:${r}`;
}

/** A day and a time on the reader's clock (`2026-10-06`, `09:00`) as the UTC stamp the server takes (`2026-10-06 03:30:00`). */
export function localToUtc(date: string, time: string): string | null {
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !t || +t[1]! > 23 || +t[2]! > 59) return null;
  const iso = wallToUtc(date, +t[1]! * 60 + +t[2]!, currentZone());
  return Number.isNaN(Date.parse(iso)) ? null : iso.slice(0, 19).replace('T', ' ');
}

/** `YYYY-MM-DD` on the reader's calendar, for a date input. */
export function isoDay(d: Date): string {
  return dayKey(d);
}

/** `09:00` on the reader's clock, for a time input (always 24-hour, as the input takes it). */
export function isoTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: currentZone() }).formatToParts(d);
  const part = (k: string) => parts.find((x) => x.type === k)?.value ?? '00';
  return `${part('hour')}:${part('minute')}`;
}

/** A stamp's time of day on the reader's clock and in their format (`9:00`, `9:00 am`); empty when unreadable. */
export function clockLabel(s: string | null | undefined): string {
  return s && parseStamp(s) ? timeLabel(s) : '';
}

/** `6 Oct 9:00`, with the year when it is not this one — on the reader's calendar and clock. */
export function when(s: string | null | undefined, withTime = true): string {
  const d = parseStamp(s);
  if (!s || !d) return '—';
  const date = stampDayLabel(s, isoDay(d).slice(0, 4) === isoDay(new Date()).slice(0, 4) ? 'short' : 'year');
  return withTime ? `${date} ${timeLabel(s)}` : date;
}

/**
 * A phone number as someone without contact-edit permission sees it (MKT-AUD-07): `+94 77 123 4521` → `+94 77 *** 4521`,
 * `077 123 4521` → `077 *** 4521`, `06 12 34 56 78` → `06 1*** 56 78`. By digits, whatever the grouping: the prefix
 * (all but the last seven) and the last four stay, the three or more between are hidden as one `***`.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const p = phone.trim();
  const total = p.replace(/\D/g, '').length;
  if (total < 7) return p;
  let seen = 0;
  // Hidden digits become a private-use mark in place; a run of them, with the separators between, becomes one `***`.
  const marked = p.replace(/\d/g, (d) => (seen++ >= total - 7 && seen <= total - 4 ? '\uE000' : d));
  return marked.replace(/\uE000(?:[^\d\uE000]*\uE000)*/g, '***');
}

/** `1 contact`, `3 contacts`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}
