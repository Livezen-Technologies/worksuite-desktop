/**
 * Times in Social Media Manager (SMM-SCH-002, NFR-10): stored and sent as UTC, shown on the reader's clock, with the
 * brand's own zone beside it where they differ ("10:30 · 10:30 Asia/Colombo"). Weeks start on Monday, as the
 * calendar and the slot grid draw them.
 */
import { addDays, currentZone, parseTs, todayInZone, wallToUtc } from '../../../core/time';

export { addDays, currentZone, todayInZone, wallToUtc };

export interface ZonedParts {
  ymd: string;
  /** Minutes since midnight. */
  minutes: number;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
}

const partFormats = new Map<string, Intl.DateTimeFormat>();

/** A UTC stamp as the date, time and weekday on a zone's clock. */
export function inZone(stamp: string | Date, tz = currentZone()): ZonedParts {
  const d = typeof stamp === 'string' ? parseTs(stamp) : stamp;
  let f = partFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    partFormats.set(tz, f);
  }
  const p = f.formatToParts(d);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '';
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(g('weekday')) + 1;
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')), weekday: wd || 1 };
}

export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "10:30" as 630. */
export function parseHhmm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** 1 = Monday … 7 = Sunday, for a plain date. */
export function weekdayOf(ymd: string): number {
  const d = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The Monday on or before a date. */
export function weekStart(ymd: string): string {
  return addDays(ymd, 1 - weekdayOf(ymd));
}

export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function weekdayWord(ymd: string): string {
  return WEEKDAYS_SHORT[weekdayOf(ymd) - 1]!;
}

function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${weekdayWord(ymd)} ${String(d.getUTCDate()).padStart(2, '0')} ${d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

/**
 * When something goes out, on the reader's clock, as the design writes it: "Today 16:30", "Tomorrow 09:00",
 * "Tue 10:30" within the week, else "Thu 09 Oct, 10:30".
 */
export function whenLabel(stamp: string | null | undefined, tz = currentZone(), today = todayInZone()): string {
  if (!stamp) return '';
  const p = inZone(stamp, tz);
  const t = hhmm(p.minutes);
  if (p.ymd === today) return `Today ${t}`;
  if (p.ymd === addDays(today, 1)) return `Tomorrow ${t}`;
  if (p.ymd === addDays(today, -1)) return `Yesterday ${t}`;
  const days = (Date.parse(`${p.ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if (days > 0 && days < 7) return `${weekdayWord(p.ymd)} ${t}`;
  return `${shortDate(p.ymd)}, ${t}`;
}

/** "03 Oct 11:00:02" for a log line. */
export function logStamp(stamp: string | null | undefined, tz = currentZone()): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return '';
  const p = inZone(d, tz);
  const day = new Date(`${p.ymd}T12:00:00Z`);
  const sec = String(d.getUTCSeconds()).padStart(2, '0');
  return `${String(day.getUTCDate()).padStart(2, '0')} ${day.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })} ${hhmm(p.minutes)}:${sec}`;
}

/** "Thu 09 Oct 2026, 10:30" — the composer's chosen time. */
export function longWhen(stamp: string, tz = currentZone()): string {
  const p = inZone(stamp, tz);
  return `${shortDate(p.ymd)} ${p.ymd.slice(0, 4)}, ${hhmm(p.minutes)}`;
}

/** The brand's clock beside the reader's, when the two differ: "10:30 Asia/Colombo". Null when they agree. */
export function brandClock(stamp: string | null | undefined, brandTz: string | null | undefined, tz = currentZone()): string | null {
  if (!stamp || !brandTz || brandTz === tz) return null;
  try {
    const mine = inZone(stamp, tz);
    const theirs = inZone(stamp, brandTz);
    if (mine.ymd === theirs.ymd && mine.minutes === theirs.minutes) return null;
    return `${theirs.ymd === mine.ymd ? '' : `${shortDate(theirs.ymd)} `}${hhmm(theirs.minutes)} ${brandTz}`;
  } catch {
    return null;
  }
}

/** A date and wall time on a zone's clock → the UTC instant, ISO. */
export function zonedToUtc(ymd: string, minutes: number, tz = currentZone()): string {
  return wallToUtc(ymd, minutes, tz);
}

/** "2026-10-09T10:30" for a datetime-local input, on a zone's clock. */
export function toLocalInput(stamp: string, tz = currentZone()): string {
  const p = inZone(stamp, tz);
  return `${p.ymd}T${hhmm(p.minutes)}`;
}

export function fromLocalInput(v: string, tz = currentZone()): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return wallToUtc(m[1]!, Number(m[2]) * 60 + Number(m[3]), tz);
}

/** Minutes until a stamp (negative once it has passed). */
export function minutesUntil(stamp: string | null | undefined, now = Date.now()): number | null {
  if (!stamp) return null;
  const t = parseTs(stamp).getTime();
  return Number.isNaN(t) ? null : Math.round((t - now) / 60_000);
}

/** "4 min", "3 h", "2 d" — an inbox row's age. */
export function ageLabel(stamp: string | null | undefined, now = Date.now()): string {
  const m = minutesUntil(stamp, now);
  if (m === null) return '';
  const a = Math.max(0, -m);
  if (a < 1) return 'now';
  if (a < 60) return `${a} min`;
  if (a < 60 * 24) return `${Math.floor(a / 60)} h`;
  return `${Math.floor(a / 1440)} d`;
}

/** "reply within 1 h", "overdue by 20 min" for a reply target (SMM-INB-008). */
export function dueLabel(stamp: string | null | undefined, now = Date.now()): { text: string; state: 'ok' | 'at_risk' | 'overdue' } | null {
  const m = minutesUntil(stamp, now);
  if (m === null) return null;
  const span = (x: number) => (x < 60 ? `${x} min` : x < 1440 ? `${Math.round(x / 60)} h` : `${Math.round(x / 1440)} d`);
  if (m < 0) return { text: `overdue by ${span(-m)}`, state: 'overdue' };
  return { text: `reply within ${span(Math.max(1, m))}`, state: m <= 15 ? 'at_risk' : 'ok' };
}
