import { addDays, dateLabel, dayKey, parseTs, todayInZone } from '../../core/time';
import type { HistoryRow, UpcomingRow } from './api';
import type { MKey } from './i18n';

/**
 * Meet Home's rules (worksuite-desktop#67), as data: what was typed in the code box, when a meeting can be joined,
 * and a meeting's day and length in words.
 */

/** What "Enter a code or meeting link" holds: a meeting to open, a code to look up, or why it is neither. */
export function checkMeetingInput(raw: string): { uuid: string } | { code: string } | { error: MKey } | null {
  const s = raw.trim();
  if (!s) return null;
  const link = /\/meet\/([A-Za-z0-9-]{8,64})(?:[/?#]|$)/.exec(s);
  if (link) return { uuid: link[1]! };
  if (/^[a-z]+:\/\//i.test(s) || /^www\./i.test(s) || /\.[a-z]{2,}\//i.test(s)) return { error: 'err.notMeetLink' };
  const bare = s.replace(/[\s-]/g, '');
  if (/^\d+$/.test(bare)) return bare.length >= 6 && bare.length <= 12 ? { code: bare } : { error: 'err.badCode' };
  // A meeting's own id, pasted on its own.
  if (/^[A-Za-z0-9]{8}-[A-Za-z0-9-]{4,55}$/.test(s)) return { uuid: s };
  // Word codes (abc-defg-hij) are looked up as they are; anything else is not a code.
  if (/^[A-Za-z0-9]{3,12}(-[A-Za-z0-9]{3,12}){0,3}$/.test(s)) return { code: s };
  return { error: 'err.badChars' };
}

/** Joining opens a quarter of an hour before the start. */
export const EARLY_MS = 15 * 60_000;
/** A meeting with no end time is taken to run an hour. */
const DEFAULT_LENGTH_MS = 60 * 60_000;

/** An upcoming meeting can be joined when it is live, or from 15 minutes before its start until its end. */
export function upcomingJoinable(u: Pick<UpcomingRow, 'scheduled_at' | 'ends_at'>, now: number, live: boolean): boolean {
  if (live) return true;
  const start = parseTs(u.scheduled_at).getTime();
  const end = u.ends_at ? parseTs(u.ends_at).getTime() : start + DEFAULT_LENGTH_MS;
  return now >= start - EARLY_MS && now <= end;
}

/** A meeting in the history can be joined while it has not ended. */
export function historyJoinable(h: Pick<HistoryRow, 'status'>): boolean {
  return h.status === 'live' || h.status === 'open' || h.status === 'not_started';
}

/** More than this between start and end is a meeting nobody ended, not one that lasted it. */
const PLAUSIBLE_MS = 12 * 3600_000;

/**
 * A meeting's length in minutes, or null when it cannot be told. A meeting is ended only when a host ends it, so
 * one everybody simply left keeps running on paper until somebody does — days, sometimes (the "unrealistic
 * durations" in #67). Anything under a minute or over 12 hours is left out rather than shown wrongly.
 */
export function meetingMinutes(started: string | null, ended: string | null): number | null {
  if (!started || !ended) return null;
  const ms = parseTs(ended).getTime() - parseTs(started).getTime();
  if (!Number.isFinite(ms) || ms < 60_000 || ms > PLAUSIBLE_MS) return null;
  return Math.round(ms / 60_000);
}

/** "45 min", "1 h 20 min", "2 h". */
export function lengthLabel(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The length of a scheduled meeting, from its start and end. */
export function scheduledMinutes(u: Pick<UpcomingRow, 'scheduled_at' | 'ends_at'>): number | null {
  return u.ends_at ? meetingMinutes(u.scheduled_at, u.ends_at) : null;
}

/** Which day a stamp falls on, as a heading: Today, Tomorrow, or its date. */
export function dayHeading(stamp: string, words: { today: string; tomorrow: string }): string {
  const day = dayKey(parseTs(stamp));
  if (day === todayInZone()) return words.today;
  if (day === addDays(todayInZone(), 1)) return words.tomorrow;
  return dateLabel(stamp).replace(/, \d{4}$/, '');
}

/** Upcoming meetings grouped by day, in order. */
export function byDay<T extends Pick<UpcomingRow, 'scheduled_at'>>(rows: T[]): Array<{ day: string; rows: T[] }> {
  const out: Array<{ day: string; rows: T[] }> = [];
  for (const r of [...rows].sort((a, b) => parseTs(a.scheduled_at).getTime() - parseTs(b.scheduled_at).getTime())) {
    const day = dayKey(parseTs(r.scheduled_at));
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

/**
 * The meeting Rejoin offers (WS-MEET-ENH-01 D07), or null.
 *
 * The one you were last in and could still walk back into: a meeting nobody
 * ended, that you were part of, most recent first. Rejoining is the thing
 * people do most after a laptop sleeps or a window is closed by accident, and
 * the alternative is scrolling the history for the row you just left.
 *
 * A meeting whose status is `ended` is never offered, however recent — the
 * card would be a button that cannot work. Nor is one from more than a day
 * ago, because "rejoin" stops being the right word for yesterday's call.
 */
export function rejoinable<T extends Pick<HistoryRow, 'status'> & { started_at?: string | null; created_at?: string | null }>(
  rows: T[],
  now = Date.now(),
  withinMs = 24 * 3600_000,
): T | null {
  const when = (h: T): number => {
    // `created_at` is not nullable in the type, but a row from an older server
    // can arrive without it, and a missing date must not read as 1970.
    const stamp = h.started_at ?? h.created_at ?? null;
    const at = stamp ? Date.parse(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`) : NaN;

    return Number.isNaN(at) ? 0 : at;
  };

  return (
    rows
      .filter((h) => historyJoinable(h) && now - when(h) <= withinMs && when(h) > 0)
      .sort((a, b) => when(b) - when(a))[0] ?? null
  );
}
