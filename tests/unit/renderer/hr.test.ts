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

describe('HR part 2 helpers', () => {
  it('knows who has left: an exit status and an exit day behind us', async () => {
    const { hasLeft } = await import('../../../src/modules/hr/api');
    expect(hasLeft({ status: 'resigned', exit_at: '2026-09-01' }, '2026-09-26')).toBe(true);
    expect(hasLeft({ status: 'resigned', exit_at: '2026-10-31' }, '2026-09-26')).toBe(false);
    expect(hasLeft({ status: 'notice', exit_at: '2026-09-01' }, '2026-09-26')).toBe(false);
    expect(hasLeft({ status: 'terminated', exit_at: null }, '2026-09-26')).toBe(false);
  });

  it('words a roster row and where it was worked as the design does', async () => {
    const { rosterStatus, whereLabel } = await import('../../../src/modules/hr/TeamAttendance');
    const day = { id: 1, employee_id: 7, name: 'Nuwan', employee_no: 'E-1', department: null, on_date: '2026-09-25', check_in: '2026-09-25 09:31:00', check_out: null, work_location: 'Colombo office', corrected: false, shift: null, is_work_day: true, break_seconds: 0, net_seconds: null, late_minutes: 31, early_minutes: 0, overtime_minutes: 0, state: 'working', verdict: 'late' };
    expect(rosterStatus(day)).toBe('Working · 31m late');
    expect(rosterStatus({ ...day, state: 'leave', late_minutes: 0, leave_type: 'Casual' })).toBe('On leave · Casual');
    expect(whereLabel(day)).toEqual({ text: 'Colombo office', warn: false });
    const at = { lat: 7.290634, lng: 80.635011, accuracy: 25, note: null };
    expect(whereLabel({ ...day, location: { check_in: at, check_out: { ...at } } }).text).toBe('7.29063, 80.63501 · ±25 m');
    expect(whereLabel({ ...day, location: { check_in: { lat: null, lng: null, accuracy: null, note: 'VPN from home' }, check_out: at } })).toEqual({ text: 'No location — “VPN from home”', warn: true });
  });

  it('never prints a withheld work-pattern total, and says why', async () => {
    const { withheldReason } = await import('../../../src/modules/hr/WorkPattern');
    expect(withheldReason('low_coverage', 35)).toMatch(/only 35%/);
    expect(withheldReason('nothing_measurable', 0)).toMatch(/Nothing in this period/);
    expect(withheldReason(null, 100)).toBeNull();
  });

  it('keeps a non-working day neutral, not "working" blue', () => {
    expect(toneOf('Non-working day')).toContain('subtle');
    expect(toneOf('Working · 31m late')).toContain('9A4A06');
    expect(toneOf('Working')).toContain('primary');
  });

  it('draws the Directory, profiles and the time screens here now', async () => {
    const { NATIVE } = await import('../../../src/modules/hr/Rail');
    for (const v of ['people', 'roster', 'openatt', 'approvals', 'reports', 'workpattern', 'myaccess'] as const) expect(NATIVE.has(v)).toBe(true);
    expect(NATIVE.has('departments')).toBe(false);
  });
});

describe('HR part 2b helpers', () => {
  it('words a work schedule as a line: runs of days, hours, breaks, midnight', async () => {
    const { patternLine } = await import('../../../src/modules/hr/Schedules');
    const day = (w: number, on: boolean, a = '08:30:00', b = '17:30:00', x = false) => ({ weekday: w, name: '', is_working: on, starts_at: on ? a : null, ends_at: on ? b : null, crosses_midnight: x, required_minutes: 480 });
    const base = { id: 1, name: 'Standard', code: null, description: null, status: 'active' as const, is_default: true, employees: 3, departments: 0 };
    const office = { ...base, current: { version_id: 1, effective_from: '2026-01-01', effective_to: null, flexible: false, grace_minutes: 15, overtime_after: null, days: [1, 2, 3, 4, 5, 6, 7].map((w) => day(w, w <= 5)), breaks: [{ name: 'Lunch', weekday: null, starts_at: '12:30', ends_at: '13:15', minutes: 45, is_paid: false }] } };
    expect(patternLine(office)).toBe('Mon–Fri · 08:30–17:30 · lunch 45m');
    const night = { ...base, current: { ...office.current, flexible: true, breaks: [], days: [1, 2, 3, 4, 5, 6, 7].map((w) => day(w, w === 1 || w === 3 || w === 7, '22:00:00', '06:00:00', true)) } };
    expect(patternLine(night)).toBe('Mon, Wed, Sun · 22:00–06:00 · flexible · runs past midnight');
    expect(patternLine({ ...base, current: null })).toBe('No hours set yet');
  });

  it('says how long ago a device was seen, from a UTC stamp', async () => {
    const { ago } = await import('../../../src/modules/hr/Devices');
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(ago(null, now)).toBe('never');
    expect(ago('2026-09-26 11:59:40', now)).toBe('just now');
    expect(ago('2026-09-26 11:45:00', now)).toBe('15 min ago');
    expect(ago('2026-09-26 06:00:00', now)).toBe('6 h ago');
    expect(ago('2026-09-20 12:00:00', now)).toBe('6 days ago');
  });

  it('chips an onboarding step by what it is waiting for', async () => {
    const { stepChip } = await import('../../../src/modules/hr/onboardingParts');
    const s = { step: 'bank_details', label: 'Bank details', status: 'pending' as const, required: true, derived: true, recorded: false, why: null, note: null, completed_at: null, sort_order: 6 };
    expect(stepChip(s, 'bank_details')).toBe('Next');
    expect(stepChip({ ...s, status: 'blocked' }, 'bank_details')).toBe('Blocked');
    expect(stepChip({ ...s, status: 'skipped' }, null)).toBe('Not applicable');
    expect(stepChip({ ...s, status: 'done', derived: false, recorded: true }, null)).toBe('Recorded by HR');
    expect(stepChip({ ...s, required: false }, 'profile')).toBe('Optional');
  });
});
