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
let zone: string | undefined;
let locale: string | undefined;
let hour12: boolean | undefined;

export function setRegional(opts: { timezone?: string | null; locale?: string | null; timeFormat?: string | null }): void {
  zone = opts.timezone || undefined;
  locale = opts.locale || undefined;
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
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale, opts({ hour: 'numeric', minute: '2-digit' }));
}

/** Wall-clock digits as written (calendar feed). */
export function wallTimeLabel(stamp: string | null | undefined): string {
  const m = stamp ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(stamp) : null;
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!));
  const base: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' };
  if (hour12 !== undefined) base.hour12 = hour12;
  return d.toLocaleTimeString(locale, base);
}

/** The minutes-since-midnight of a wall-clock stamp. */
export function wallMinutes(stamp: string): number {
  const m = /[T ](\d{2}):(\d{2})/.exec(stamp);
  return m ? +m[1]! * 60 + +m[2]! : 0;
}

export function dayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', opts({ year: 'numeric', month: '2-digit', day: '2-digit' })).format(d);
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
  return d.toLocaleDateString(locale, style === 'long' ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A bare date stays a day; a stamp is shown on the reader's calendar. */
export function dateLabel(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dayLabel(value, 'short');
  const d = parseTs(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale, opts({ day: 'numeric', month: 'short', year: 'numeric' }));
}

/** "12 min ago", "Yesterday", "3 Sep" — for lists. */
export function relative(stamp: string | null | undefined, now = Date.now()): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (dayKey(d) === dayKey(new Date(now))) return timeLabel(stamp);
  if (dayKey(d) === dayKey(new Date(now - 86_400_000))) return 'Yesterday';
  if (s < 6 * 86_400) return d.toLocaleDateString(locale, opts({ weekday: 'short' }));
  return d.toLocaleDateString(locale, opts({ day: 'numeric', month: 'short' }));
}

/** List timestamp: time today, else a short date (mail and chat lists). */
export function listStamp(stamp: string | null | undefined): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return '';
  if (dayKey(d) === todayInZone()) return timeLabel(stamp);
  if (dayKey(d) === addDays(todayInZone(), -1)) return 'Yesterday';
  return d.toLocaleDateString(locale, opts({ day: 'numeric', month: 'short' }));
}

export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', opts({ hour: '2-digit', hour12: false })).format(now)) % 24;
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
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
