import { currentLocale, currentLanguage, text } from './i18n';
/**
 * Time on WorkSuite's terms (FR-L10N-02). Two kinds of stamp arrive looking
 * identical ("2026-09-25 10:00:00"):
 *
 *  - true UTC (chat, mail, notifications, activity, dashboard feed): parse
 *    with `parseTs`, which adds the Z;
 *  - floating wall clock (the calendar feed, already on the reader's clock):
 *    never add a Z; label with `wallTimeLabel`.
 *
 * Times display in the user's zone: user → organization → OS.
 */
let regionalLocale: string | undefined;
const displayLocale = () => currentLanguage() === 'en' ? regionalLocale : currentLocale();
let zone: string | undefined;
let hour12: boolean | undefined;

export function setRegional(opts: { timezone?: string | null; locale?: string | null; timeFormat?: string | null }): void {
  regionalLocale = opts.locale || undefined;
  zone = opts.timezone || undefined;
  hour12 = opts.timeFormat === '12' || opts.timeFormat === '12h' ? true : opts.timeFormat === '24' || opts.timeFormat === '24h' ? false : undefined;
  try {
    if (zone) new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    zone = undefined;
  }
}

export function currentZone(): string {
  return zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** How far a zone is ahead of UTC, in minutes, at an instant. */
function offsetAt(at: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(at));
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - Math.floor(at / 60_000) * 60_000) / 60_000;
}

/**
 * Wall-clock digits on the WorkSuite clock ("2026-09-26", 10:30 as 630
 * minutes) as the UTC instant they name, ISO with a Z — for writes that store
 * instants (a meeting's time). Read twice so a daylight-saving change between
 * the guess and the answer is taken into account.
 */
export function wallToUtc(ymd: string, minutes: number, tz = currentZone()): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = wall - offsetAt(wall, tz) * 60_000;
  return new Date(wall - offsetAt(first, tz) * 60_000).toISOString();
}

export function parseTs(stamp: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return new Date(`${stamp}T12:00:00Z`);
  return new Date(stamp.replace(' ', 'T') + (stamp.includes('T') || /[zZ]|[+-]\d{2}:?\d{2}$/.test(stamp) ? '' : 'Z'));
}

function opts(base: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  const o: Intl.DateTimeFormatOptions = zone ? { ...base, timeZone: zone } : { ...base };
  if (hour12 !== undefined && 'hour' in base) o.hour12 = hour12;
  return o;
}

export function timeLabel(stamp: string | null | undefined): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(displayLocale(), opts({ hour: 'numeric', minute: '2-digit' }));
}

/** Wall-clock digits as written (calendar feed). */
export function wallTimeLabel(stamp: string | null | undefined): string {
  const m = stamp ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(stamp) : null;
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!));
  const base: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' };
  if (hour12 !== undefined) base.hour12 = hour12;
  return d.toLocaleTimeString(displayLocale(), base);
}

/** The minutes-since-midnight of a wall-clock stamp. */
export function wallMinutes(stamp: string): number {
  const m = /[T ](\d{2}):(\d{2})/.exec(stamp);
  return m ? +m[1]! * 60 + +m[2]! : 0;
}

/** One formatter per time zone: building one for every message made a 90,000-message list take seconds (#162). */
let dayFormat: { zone: string | undefined; fmt: Intl.DateTimeFormat } | null = null;

export function dayKey(d: Date): string {
  if (!dayFormat || dayFormat.zone !== zone) dayFormat = { zone, fmt: new Intl.DateTimeFormat('en-CA', opts({ year: 'numeric', month: '2-digit', day: '2-digit' })) };
  return dayFormat.fmt.format(d);
}

/** Today on the reader's calendar, YYYY-MM-DD. */
export function todayInZone(): string {
  return dayKey(new Date());
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayLabel(ymd: string, style: 'long' | 'short' = 'long'): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString(displayLocale(), style === 'long' ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A plain date in words, on no clock: "24 Sep", "Thursday 24 September 2026". */
export function dayWords(ymd: string, o: { weekday?: boolean; long?: boolean; year?: boolean } = {}): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(displayLocale(), { ...(o.weekday ? { weekday: 'long' as const } : {}), day: 'numeric', month: o.long ? 'long' : 'short', ...(o.year ? { year: 'numeric' as const } : {}), timeZone: 'UTC' });
}

/** "2026-09" as "September 2026". */
export function monthWords(ym: string): string {
  const d = new Date(`${ym}-15T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString(displayLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** A bare date stays a day; a stamp is shown on the reader's calendar. */
export function dateLabel(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dayLabel(value, 'short');
  const d = parseTs(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(displayLocale(), opts({ day: 'numeric', month: 'short', year: 'numeric' }));
}

/** "12 min ago", "Yesterday", "3 Sep" — for lists. */
export function relative(stamp: string | null | undefined, now = Date.now()): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return text('just now');
  if (s < 3600 && currentLanguage() === 'en') return `${Math.round(s / 60)} min ago`;
  if (s < 3600) return new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'always', style: 'short' }).format(-Math.round(s / 60), 'minute');
  if (dayKey(d) === dayKey(new Date(now))) return timeLabel(stamp);
  if (dayKey(d) === dayKey(new Date(now - 86_400_000))) return text('Yesterday');
  if (s < 6 * 86_400) return d.toLocaleDateString(displayLocale(), opts({ weekday: 'short' }));
  return d.toLocaleDateString(displayLocale(), opts({ day: 'numeric', month: 'short' }));
}

/** List timestamp: time today, else a short date (mail and chat lists). */
export function listStamp(stamp: string | null | undefined): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return '';
  if (dayKey(d) === todayInZone()) return timeLabel(stamp);
  if (dayKey(d) === addDays(todayInZone(), -1)) return text('Yesterday');
  return d.toLocaleDateString(displayLocale(), opts({ day: 'numeric', month: 'short' }));
}

export function greeting(now = new Date()): string {
  // The hour as a number whatever the time format: a 12-hour setting would make it "10 am", which is no number.
  const h = Number(new Intl.DateTimeFormat('en-GB', { ...opts({ hour: '2-digit' }), hour12: false }).format(now)) % 24;
  if (h < 12) return text('Good morning');
  if (h < 17) return text('Good afternoon');
  return text('Good evening');
}

export function bytes(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x < 10 ? x.toFixed(1) : Math.round(x)} ${units[i]}`;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m} min`;
  return `${s}s`;
}
