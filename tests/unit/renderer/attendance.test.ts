// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attendanceTime, breakSecondsNow, clockDigits, companyDateLabel, dayPhase, hoursMinutes, openBreakSeconds, requiredMinutes, shiftLine, workedSeconds, type AttendanceDay } from '../../../src/modules/hr/attendance';

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

describe('the title-bar clock (ClockIn)', () => {
  it('names where the day has got to', () => {
    expect(dayPhase(null)).toBe('none');
    expect(dayPhase(day({ check_in: null }))).toBe('none');
    expect(dayPhase(day())).toBe('working');
    expect(dayPhase(day({ on_break: true }))).toBe('break');
    expect(dayPhase(day({ check_out: '2026-09-26 06:30:00' }))).toBe('done');
  });

  it('writes hours as the design does', () => {
    expect(hoursMinutes(4 * 3600 + 12 * 60 + 38)).toBe('4h 12m');
    expect(hoursMinutes(0)).toBe('0h 00m');
    expect(clockDigits(4 * 3600 + 12 * 60 + 38)).toBe('4:12:38');
    expect(clockDigits(-5)).toBe('0:00:00');
  });

  it('times the open break from the server\'s break total, less the breaks already over, without reading stamps as instants', () => {
    const counted = 2_000_000;
    const today = day({
      on_break: true,
      break_seconds: 30 * 60 + 5 * 60,
      breaks: [
        { id: 1, started_at: '2026-09-26 10:00:00', ended_at: '2026-09-26 10:30:00', note: null },
        { id: 2, started_at: '2026-09-26 12:30:00', ended_at: null, note: null },
      ],
    });
    expect(openBreakSeconds(today, counted, counted)).toBe(5 * 60);
    expect(openBreakSeconds(today, counted + 60_000, counted)).toBe(6 * 60);
    expect(openBreakSeconds(day(), counted, counted)).toBe(0);
    expect(breakSecondsNow(day({ break_seconds: 600 }), counted + 60_000, counted)).toBe(600);
  });

  it('says the shift from the day, or from the rules', () => {
    expect(shiftLine(undefined, day({ shift: 'General shift', expected_in: '09:00', expected_out: '17:30' }))).toBe('General shift · 09:00–17:30');
    expect(shiftLine({ linked: true, rules: { shift_name: 'Night', day_start: '22:00:00', day_end: '06:00:00' } }, null)).toBe('Night · 22:00–06:00');
    expect(requiredMinutes({ linked: true, rules: { required_minutes: 480 } }, null)).toBe(480);
    expect(requiredMinutes(undefined, day({ required_minutes: 0 }))).toBeNull();
  });

  it('dates the footer from the company\'s own Y-m-d', () => {
    expect(companyDateLabel('2026-09-26')).toMatch(/26/);
    expect(companyDateLabel(undefined)).toBe('');
  });
});
