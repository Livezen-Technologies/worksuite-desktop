import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGetMeta } from '../../core/api';
import { call, DesktopError, errorMessage } from '../../core/bridge';
import { wallTimeLabel } from '../../core/time';

/**
 * My attendance today, and clocking in and out — shared by the HR page and the
 * title bar so the two can never disagree. Both read one query; clocking goes
 * through the main process (`hr:clock`), which also updates the tray menu and
 * announces `hr.attendance.changed`, which refreshes this query everywhere.
 */
export interface AttendanceBreak {
  id: number;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}

export interface AttendanceDay {
  check_in: string | null;
  check_out: string | null;
  on_break: boolean;
  net_seconds: number;
  late_minutes: number;
  state: string;
  work_location: string | null;
  /** The shift's name and hours, as judged for this day. */
  shift?: string | null;
  expected_in?: string | null;
  expected_out?: string | null;
  required_minutes?: number | null;
  break_seconds?: number;
  overtime_minutes?: number;
  breaks?: AttendanceBreak[];
}

export interface AttendanceMe {
  linked: boolean;
  employee?: { id: number; employee_no: string };
  date?: string;
  timezone?: string;
  today?: AttendanceDay | null;
  month?: { days_present: number; work_days: number; attendance_rate: number; net_seconds: number; late_days: number; overtime_minutes: number; missing_check_outs: number };
  policy?: {
    checkin_note_required: boolean;
    checkout_note_required: boolean;
    break_tracking?: boolean;
    location_mode?: 'off' | 'record' | 'required';
    location_skips_30d?: number;
    resume_locations?: string[];
  };
  /** Where a day can be worked: the company's list. */
  locations?: string[];
  rules?: { shift_name?: string | null; day_start?: string | null; day_end?: string | null; required_minutes?: number | null; break_minutes?: number | null };
}

export function useAttendance(enabled = true) {
  const q = useQuery({
    queryKey: ['hr', 'attendance'],
    queryFn: ({ signal }) => apiGetMeta<AttendanceMe>('/api/hr/attendance/me', undefined, signal),
    enabled,
    staleTime: 60_000,
  });
  const a = q.data?.data;
  const today = a?.today ?? null;
  const clockedIn = !!(today?.check_in && !today.check_out);
  const needNote = !!(clockedIn ? a?.policy?.checkout_note_required : a?.policy?.checkin_note_required);
  /** When `net_seconds` was counted: the answer's arrival, or the cache's. */
  const countedAt = q.data?.offline && q.data.cachedAt ? Date.parse(q.data.cachedAt) || q.dataUpdatedAt : q.dataUpdatedAt;
  return { q, a, today, clockedIn, needNote, countedAt };
}

/**
 * Seconds worked today, as the web counts them: the server's `net_seconds`
 * (breaks already taken out), running on from when it was counted while the
 * person is working and not on a break.
 *
 * NOT `now - check_in`. Attendance stamps are wall-clock times on the
 * company's clock (the answer's `timezone`), not UTC, so parsing one as an
 * instant is off by the zone — in Colombo it put a 22:25 clock-in at 03:55 the
 * next morning, and the running time at zero.
 */
export function workedSeconds(today: AttendanceDay | null, clockedIn: boolean, now: number, countedAt: number): number {
  const base = today?.net_seconds ?? 0;
  const running = clockedIn && !today?.on_break && countedAt > 0;
  return running ? base + Math.max(0, (now - countedAt) / 1000) : base;
}

/** A clock-in or clock-out time, as the wall-clock digits the server sent. */
export function attendanceTime(stamp: string | null | undefined): string {
  return wallTimeLabel(stamp);
}

/** A clock that ticks, for elapsed time. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  return now;
}

export type NoteType = 'normal' | 'overtime' | 'customer_visit' | 'off_site' | 'wfh' | 'early_departure' | 'missed_break' | 'technical_issue' | 'other';

export async function clockAttendance(direction: 'in' | 'out', extra: { note?: string; workLocation?: string | null; noteType?: NoteType | null; geoNote?: string } = {}): Promise<void> {
  await call('hr:clock', {
    direction,
    note: extra.note?.trim() || undefined,
    workLocation: extra.workLocation || undefined,
    noteType: extra.noteType || undefined,
    geoNote: extra.geoNote?.trim() || undefined,
  });
}

export async function attendanceBreak(action: 'start' | 'end'): Promise<void> {
  await call('hr:break', { action });
}

/** Where the day has got to, as the title bar and the popover show it. */
export type DayPhase = 'none' | 'working' | 'break' | 'done';

export function dayPhase(today: AttendanceDay | null | undefined): DayPhase {
  if (!today?.check_in) return 'none';
  if (today.check_out) return 'done';
  return today.on_break ? 'break' : 'working';
}

/** Seconds of break today, running on while one is open. */
export function breakSecondsNow(today: AttendanceDay | null, now: number, countedAt: number): number {
  const base = today?.break_seconds ?? 0;
  return today?.on_break && !today.check_out && countedAt > 0 ? base + Math.max(0, (now - countedAt) / 1000) : base;
}

/** The break open now, if any. */
export function openBreak(today: AttendanceDay | null): AttendanceBreak | null {
  return today?.breaks?.find((b) => !b.ended_at) ?? null;
}

/**
 * How long the open break has run: the break total counted by the server,
 * less the breaks already closed, running on since it was counted. Break
 * stamps are wall-clock times on the company's clock, so they are never
 * parsed as instants here (see `workedSeconds`).
 */
export function openBreakSeconds(today: AttendanceDay | null, now: number, countedAt: number): number {
  if (!today?.on_break) return 0;
  const closed = (today.breaks ?? []).filter((b) => b.ended_at).reduce((n, b) => n + Math.max(0, wallSeconds(b.ended_at!) - wallSeconds(b.started_at)), 0);
  return Math.max(0, breakSecondsNow(today, now, countedAt) - closed);
}

function wallSeconds(stamp: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(stamp);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)) / 1000 : 0;
}

/** "4h 12m". */
export function hoursMinutes(seconds: number): string {
  const m = Math.max(0, Math.floor(seconds / 60));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** "4:12:38". */
export function clockDigits(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** "General shift · 09:00–17:30". */
export function shiftLine(a: AttendanceMe | undefined, today: AttendanceDay | null): string {
  const name = today?.shift ?? a?.rules?.shift_name ?? 'General shift';
  const from = today?.expected_in ?? a?.rules?.day_start ?? null;
  const to = today?.expected_out ?? a?.rules?.day_end ?? null;
  return from && to ? `${name} · ${from.slice(0, 5)}–${to.slice(0, 5)}` : name;
}

/** The minutes the day asks for, when the rules say. */
export function requiredMinutes(a: AttendanceMe | undefined, today: AttendanceDay | null): number | null {
  const m = today?.required_minutes ?? a?.rules?.required_minutes ?? null;
  return typeof m === 'number' && m > 0 ? m : null;
}

/** "Sat 26 Sep", from the company's Y-m-d. */
export function companyDateLabel(ymd: string | undefined): string {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null;
  if (!m) return '';
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function clockError(e: unknown): string {
  return e instanceof DesktopError && e.code === 'NETWORK_UNREACHABLE' ? 'Clocking in needs a connection to WorkSuite.' : errorMessage(e);
}
