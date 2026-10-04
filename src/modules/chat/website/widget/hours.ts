import { text } from '../../../../core/i18n';
import { DAYS, type HoursDay } from './design';

/**
 * Business hours as the design draws them (S-10; WS-WCHAT X-UI-22, UX-SET-11; HRS-01): the timezone with its offset,
 * "Open now · closes 17:30" worked out from the week being edited, and the week as bars across the day.
 *
 * The rules are the server's (WidgetGate::isOpenNow): a day is open from its opening to its closing time on the hours'
 * own calendar, and a day switched off is closed all day. Opening next is said as the widgets list says it
 * (WidgetHours::opensAt): "08:30", "08:30 tomorrow", "08:30 Monday".
 */

/** The zones offered when this computer cannot list its own. */
export const ZONES = ['Asia/Colombo', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];

/** Every zone this computer knows, the saved one first when it is not among them. */
export function zoneList(current: string): string[] {
  let all: string[] = ZONES;
  try {
    const listed = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (listed?.length) all = listed.includes('UTC') ? listed : [...listed, 'UTC'];
  } catch {
    // An older engine: the short list.
  }
  return all.includes(current) ? all : [current, ...all];
}

/** The clock in a zone: its weekday (0 Sunday), "HH:MM" and minutes past midnight; null for a zone it does not know. */
export function clockIn(zone: string, now: Date = new Date()): { weekday: number; hm: string; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const h = Number(get('hour')) % 24;
    const m = Number(get('minute'));
    if (weekday < 0 || !Number.isFinite(h) || !Number.isFinite(m)) return null;
    return { weekday, hm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, minutes: h * 60 + m };
  } catch {
    return null;
  }
}

/** "UTC+05:30", "UTC−04:00", "UTC" — the zone's offset now. */
export function offsetOf(zone: string, now: Date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = /GMT([+-−])(\d{1,2})(?::?(\d{2}))?/.exec(name);
    if (!m) return 'UTC';
    return `UTC${m[1] === '-' ? '−' : '+'}${m[2]!.padStart(2, '0')}:${m[3] ?? '00'}`;
  } catch {
    return 'UTC';
  }
}

/** "Asia/Colombo (UTC+05:30)": the timezone as the design's list shows it. */
export const zoneLabel = (zone: string, now: Date = new Date()) => `${zone.replace(/_/g, ' ')} (${offsetOf(zone, now)})`;

const minutesOf = (t: string): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

export interface OpenState {
  open: boolean;
  /** Open: when it closes today, "17:30". */
  closes: string | null;
  /** Closed: when it opens next, "08:30", "08:30 tomorrow", "08:30 Monday"; null with no open day. */
  opens: string | null;
}

/** Whether the week being edited has the widget open at this moment, in its own timezone, and until or from when. */
export function openState(days: HoursDay[], zone: string, now: Date = new Date()): OpenState {
  const c = clockIn(zone, now) ?? clockIn('UTC', now)!;
  const by = new Map(days.map((d) => [d.weekday, d]));
  const today = by.get(c.weekday);
  if (today?.is_open && c.minutes >= minutesOf(today.opens_at) && c.minutes <= minutesOf(today.closes_at)) {
    return { open: true, closes: today.closes_at.slice(0, 5), opens: null };
  }
  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = by.get((c.weekday + ahead) % 7);
    if (!d?.is_open) continue;
    if (ahead === 0 && c.minutes >= minutesOf(d.opens_at)) continue;
    const at = d.opens_at.slice(0, 5);
    return { open: false, closes: null, opens: ahead === 0 ? at : ahead === 1 ? text('{time} tomorrow', { time: at }) : `${at} ${DAYS[d.weekday]}` };
  }
  return { open: false, closes: null, opens: null };
}

/** "Open now · closes 17:30", "Closed now · opens 08:30 Monday", "Closed all week". */
export function openLine(s: OpenState): string {
  if (s.open) return text('Open now · closes {time}', { time: s.closes ?? '' });
  return s.opens ? text('Closed now · opens {time}', { time: s.opens }) : text('Closed all week');
}

export interface DayBar {
  weekday: number;
  /** "Mon". */
  label: string;
  /** Where the open hours start and how long they run, as fractions of the day; null when closed all day. */
  start: number | null;
  span: number;
  /** `usual`: the hours most open days keep; `other`: a day with hours of its own, drawn lighter (the design's Saturday). */
  tone: 'usual' | 'other' | 'closed';
  /** "Mon 08:30–17:30", "Sun closed": what the bar says to a screen reader. */
  words: string;
}

/** The week, Monday first, as the "This week" chart draws it. */
export function weekBars(days: HoursDay[]): DayBar[] {
  const open = days.filter((d) => d.is_open);
  const key = (d: HoursDay) => `${d.opens_at.slice(0, 5)}-${d.closes_at.slice(0, 5)}`;
  const counts = new Map<string, number>();
  for (const d of open) counts.set(key(d), (counts.get(key(d)) ?? 0) + 1);
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return [1, 2, 3, 4, 5, 6, 0].map((w) => {
    const d = days.find((x) => x.weekday === w);
    const label = DAYS[w]!.slice(0, 3);
    if (!d?.is_open) return { weekday: w, label, start: null, span: 1, tone: 'closed' as const, words: text('{day} closed', { day: label }) };
    const from = minutesOf(d.opens_at);
    const to = Math.max(from, minutesOf(d.closes_at));
    return { weekday: w, label, start: from / 1440, span: Math.max(0, to - from) / 1440, tone: key(d) === usual ? ('usual' as const) : ('other' as const), words: `${label} ${d.opens_at.slice(0, 5)}–${d.closes_at.slice(0, 5)}` };
  });
}

/** What is wrong with the week before the server is asked: a day that closes before it opens is never open. */
export function weekProblems(days: HoursDay[]): Partial<Record<number, string>> {
  const out: Partial<Record<number, string>> = {};
  for (const d of days) {
    if (d.is_open && minutesOf(d.closes_at) <= minutesOf(d.opens_at)) out[d.weekday] = text('{day} closes before it opens', { day: DAYS[d.weekday]! });
  }
  return out;
}
