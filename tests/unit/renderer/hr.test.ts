// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({}), subscribe: () => () => undefined }, organizationName: () => 'Livezen' }));
import { addDays, hoursLabel, minutesLabel, monthGrid, rangeLabel, shiftMonth, weekDays, weekStart } from '../../../src/modules/hr/dates';
import { humanise, toneOf } from '../../../src/modules/hr/parts';
import { hrSections, webPathFor } from '../../../src/modules/hr/Rail';

describe('HR days', () => {
  it('works in whole days, Monday-first weeks', () => {
    expect(weekStart('2026-09-26')).toBe('2026-09-21');
    expect(weekStart('2026-09-21')).toBe('2026-09-21');
    expect(weekDays('2026-09-23')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('draws a month in whole weeks, marking days outside it and weekends', () => {
    const g = monthGrid('2026-10');
    expect(g.length % 7).toBe(0);
    expect(g[0]!.day).toBe('2026-09-28');
    expect(g.find((c) => c.day === '2026-10-01')!.inMonth).toBe(true);
    expect(g.find((c) => c.day === '2026-10-03')!.weekend).toBe(true);
    expect(g[g.length - 1]!.day).toBe('2026-11-01');
  });

  it('labels ranges, hours and minutes as the designs do', () => {
    expect(rangeLabel('2026-09-28', '2026-09-30')).toMatch(/28–30/);
    expect(rangeLabel('2026-09-30', '2026-10-02')).toMatch(/30.*–.*2/);
    expect(hoursLabel(9)).toBe('9h');
    expect(hoursLabel(7.5)).toBe('7.5h');
    expect(minutesLabel(512)).toBe('8h 32m');
    expect(minutesLabel(45)).toBe('45m');
    expect(minutesLabel(null)).toBe('—');
  });
});

describe('HR status chips', () => {
  it('colours a status by what it means', () => {
    expect(toneOf('Approved')).toContain('145C39');
    expect(toneOf('Pending')).toContain('9A4A06');
    expect(toneOf('Rejected')).toContain('8C2A14');
    expect(toneOf('Working')).toContain('primary');
    expect(toneOf('On leave')).toContain('5B2FA0');
    expect(toneOf('Permanent')).toContain('0B6770');
    expect(toneOf('Something else')).toContain('subtle');
    expect(humanise('needs_resubmission')).toBe('Needs resubmission');
  });
});

describe('the People rail', () => {
  const none = { requests: 0, waiting: 0, reviewsTimesheets: false };
  it('shows an ordinary employee only what is theirs', () => {
    const ids = hrSections([], none).flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain('myhr');
    expect(ids).toContain('leave');
    expect(ids).not.toContain('overview');
    expect(ids).not.toContain('people');
    expect(ids).not.toContain('roster');
    expect(hrSections([], none).some((s) => s.id === 'emp')).toBe(false);
  });

  it('shows HR staff and managers their screens, on the web\'s own permissions', () => {
    const ids = hrSections(['hr.view', 'hr.manage', 'hr.device.manage'], { ...none, reviewsTimesheets: true }).flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual(expect.arrayContaining(['overview', 'people', 'roster', 'approvals', 'openatt', 'settings', 'devices']));
    expect(hrSections(['*'], none).flatMap((s) => s.items).length).toBeGreaterThan(20);
    expect(webPathFor('devices')).toBe('/hr?tab=devices');
    expect(webPathFor('departments')).toBe('/organization');
  });
});
