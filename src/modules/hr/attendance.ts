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
export interface AttendanceDay {
  check_in: string | null;
  check_out: string | null;
  on_break: boolean;
  net_seconds: number;
  late_minutes: number;
  state: string;
  work_location: string | null;
}

export interface AttendanceMe {
  linked: boolean;
  employee?: { id: number; employee_no: string };
  date?: string;
  timezone?: string;
  today?: AttendanceDay | null;
  month?: { days_present: number; work_days: number; attendance_rate: number; net_seconds: number; late_days: number; overtime_minutes: number; missing_check_outs: number };
  policy?: { checkin_note_required: boolean; checkout_note_required: boolean };
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

export async function clockAttendance(direction: 'in' | 'out', note?: string): Promise<void> {
  await call('hr:clock', { direction, note: note?.trim() || undefined });
}

export function clockError(e: unknown): string {
  return e instanceof DesktopError && e.code === 'NETWORK_UNREACHABLE' ? 'Clocking in needs a connection to WorkSuite.' : errorMessage(e);
}
