import { describe, expect, it } from 'vitest';
import { wallToUtc } from '../../../src/core/time';
import { dayDiff, endOf, movable, rangeLabel, shifted, step, viewRange, type CalendarEvent } from '../../../src/modules/calendar/api';

const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  source: 'event',
  id: 1,
  title: 'Standup',
  color: null,
  start_at: '2026-09-26 10:00:00',
  end_at: '2026-09-26 11:00:00',
  all_day: false,
  editable: true,
  ...over,
});

/** The calendar's feed is wall-clock digits; every move is arithmetic on those digits. */
describe('calendar arithmetic', () => {
  it('shifts a stamp by minutes, across midnight either way, as the naive form the server takes', () => {
    expect(shifted('2026-09-26 10:00:00', 60)).toBe('2026-09-26T11:00');
    expect(shifted('2026-09-26 23:30:00', 60)).toBe('2026-09-27T00:30');
    expect(shifted('2026-09-26 00:15:00', -30)).toBe('2026-09-25T23:45');
    expect(shifted('2026-09-26 10:00:00', 3 * 1440)).toBe('2026-09-29T10:00');
    expect(shifted('2026-12-31 22:00:00', 180)).toBe('2027-01-01T01:00');
  });

  it('gives an entry without an end an hour, and lets only your events and your meetings move', () => {
    expect(endOf(ev({ end_at: null }))).toBe('2026-09-26 11:00:00');
    expect(movable(ev())).toBe(true);
    expect(movable(ev({ source: 'businessmeeting' }))).toBe(true);
    expect(movable(ev({ editable: false }))).toBe(false);
    expect(movable(ev({ source: 'task' }))).toBe(false);
    expect(movable(ev({ source: 'holiday', editable: true }))).toBe(false);
  });

  it('knows which days each view shows, Monday first', () => {
    expect(viewRange('day', '2026-09-26')).toEqual({ from: '2026-09-26', to: '2026-09-26', days: ['2026-09-26'] });
    const week = viewRange('week', '2026-09-26');
    expect([week.from, week.to, week.days.length]).toEqual(['2026-09-21', '2026-09-27', 7]);
    const month = viewRange('month', '2026-09-26');
    expect([month.from, month.to, month.days.length]).toEqual(['2026-08-31', '2026-10-11', 42]);
  });

  it('labels a week within a month, across months and across years', () => {
    expect(rangeLabel('week', '2026-09-26')).toBe('21 – 27 September 2026');
    expect(rangeLabel('week', '2026-09-30')).toBe('28 September – 4 October 2026');
    expect(rangeLabel('week', '2026-12-30')).toBe('28 December 2026 – 3 January 2027');
    expect(rangeLabel('month', '2026-09-26')).toBe('September 2026');
  });

  it('steps by a day, a week or a month, and counts days between dates', () => {
    expect(step('day', '2026-09-26', 1)).toBe('2026-09-27');
    expect(step('week', '2026-09-26', -1)).toBe('2026-09-19');
    expect(step('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(dayDiff('2026-09-26', '2026-09-27')).toBe(1);
    expect(dayDiff('2026-10-01', '2026-09-28')).toBe(-3);
    expect(dayDiff('2026-03-07', '2026-03-09')).toBe(2);
  });

  it('turns wall-clock digits into the instant they name, daylight saving included', () => {
    expect(wallToUtc('2026-09-26', 10 * 60 + 30, 'Asia/Colombo')).toBe('2026-09-26T05:00:00.000Z');
    expect(wallToUtc('2026-09-26', 10 * 60 + 30, 'America/New_York')).toBe('2026-09-26T14:30:00.000Z');
    expect(wallToUtc('2026-12-01', 10 * 60 + 30, 'America/New_York')).toBe('2026-12-01T15:30:00.000Z');
    expect(wallToUtc('2026-03-08', 3 * 60 + 30, 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
    expect(wallToUtc('2026-09-26', 0, 'UTC')).toBe('2026-09-26T00:00:00.000Z');
  });
});
