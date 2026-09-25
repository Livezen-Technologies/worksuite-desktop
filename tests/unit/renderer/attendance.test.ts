// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attendanceTime, workedSeconds, type AttendanceDay } from '../../../src/modules/hr/attendance';

/**
 * Attendance stamps are wall-clock times on the company's clock, not UTC. Read
 * as UTC, a 22:25 Colombo clock-in showed as 03:55 the next morning and the
 * running time sat at zero — in the title bar, the HR page and the tray.
 */
const day = (over: Partial<AttendanceDay> = {}): AttendanceDay => ({
  check_in: '2026-09-25 22:25:10',
  check_out: null,
  on_break: false,
  net_seconds: 600,
  late_minutes: 0,
  state: 'working',
  work_location: null,
  ...over,
});

describe('attendance time', () => {
  it('shows a clock-in as the digits the server sent, whatever this computer\'s zone', () => {
    expect(attendanceTime('2026-09-25 22:25:10')).toMatch(/10:25|22:25/);
    expect(attendanceTime(null)).toBe('');
  });

  it('runs on from the server\'s own count while working', () => {
    const counted = 1_000_000;
    expect(workedSeconds(day(), true, counted + 90_000, counted)).toBe(690);
  });

  it('stands still on a break, and once clocked out', () => {
    const counted = 1_000_000;
    expect(workedSeconds(day({ on_break: true }), true, counted + 90_000, counted)).toBe(600);
    expect(workedSeconds(day({ check_out: '2026-09-25 23:00:00' }), false, counted + 90_000, counted)).toBe(600);
  });

  it('never counts backwards', () => {
    expect(workedSeconds(day(), true, 500, 1_000)).toBe(600);
  });
});
