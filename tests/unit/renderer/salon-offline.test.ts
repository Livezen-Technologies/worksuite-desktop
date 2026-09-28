import { describe, expect, it } from 'vitest';
import type { SalonCopy } from '@shared/types';
import { ApiError } from '../../../src/core/api';
import type { Visit, VisitItem } from '../../../src/modules/salon/api';
import { dayWindow } from '../../../src/modules/salon/Calendar';
import { boardFromCopy, calendarFromCopy, copyHolds, instantAt, optionsFromCopy, unreachable, waitingLine, weekdayOf } from '../../../src/modules/salon/offline';

/* 10:00 on Monday 28 September in Colombo (UTC+05:30). */
const NOW = Date.parse('2026-09-28T04:30:00Z');

const item = (over: Partial<VisitItem> = {}): VisitItem => ({
  appointment_id: 1,
  service_id: 3,
  service: 'Cut',
  provider_id: 9,
  provider: 'Nimali Perera',
  provider_color: null,
  status: 'confirmed',
  status_label: 'Confirmed',
  starts_at: '2026-09-28T05:30:00Z',
  ends_at: '2026-09-28T06:30:00Z',
  start: '11:00',
  end: '12:00',
  duration_min: 60,
  price: 3500,
  ...over,
});

const visit = (id: number, over: Partial<Visit> = {}, it: Partial<VisitItem> = {}): Visit => ({
  id,
  number: `GBL-APT-${id}`,
  client: { id: 100 + id, name: `Client ${id}`, phone: null, tier: null, reliability: 'reliable', allergy: null },
  status: 'confirmed',
  status_label: 'Confirmed',
  starts_at: it.starts_at ?? '2026-09-28T05:30:00Z',
  date: '2026-09-28',
  start: it.start ?? '11:00',
  end: it.end ?? '12:00',
  items: [item({ appointment_id: id, ...it })],
  money: { currency: 'LKR', total: 3500, deposit_due: 0, advance: 0, deposit_owed: 0, balance: 3500 },
  checked_out: false,
  ...over,
});

function copy(visits: Visit[], over: Partial<SalonCopy> = {}): SalonCopy {
  return {
    desk_id: 5,
    refreshed_at: '2026-09-28T04:00:00Z',
    pulled_at: '2026-09-28T04:29:00Z',
    timezone: 'Asia/Colombo',
    location: { id: 16, name: 'Colombo 05', hours: [{ weekday: 1, opens: '09:00:00', closes: '19:00:00' }] },
    menu: [{ id: 1, name: 'Hair', services: [] }],
    stylists: [
      { id: 9, name: 'Nimali Perera', title: null, color: '#f00', active: true, services: [3], locations: [16] },
      { id: 10, name: 'Kasun Silva', title: null, color: null, active: true, services: [3], locations: [16] },
      { id: 11, name: 'Gone', title: null, color: null, active: false, services: [3], locations: [16] },
    ],
    visits,
    settings: { currency: 'LKR', company: 'Lotus', ack_severity: 'moderate', cache_days_ahead: 14, loyalty: true },
    options: { may: { 'salon.visit.book': true }, currency: 'LKR', company: 'Lotus Salon', ack_severity: 'severe', locations: [{ id: 16, org_id: 17, name: 'Colombo 05', timezone: 'Asia/Colombo' }] },
    desk: { id: 5, org_id: 17, location_id: 16, location: 'Colombo 05', name: 'Front desk', status: 'active', device_id: 'x', register: null, approved_at: null, revoked_at: null },
    ...over,
  } as SalonCopy;
}

describe("today's board from the desk's copy, by the server's rules", () => {
  it('puts the late, the arriving and those in the chair where the server would', () => {
    const b = boardFromCopy(
      copy([
        visit(1, { status: 'confirmed', starts_at: '2026-09-28T04:00:00Z', start: '09:30' }, { starts_at: '2026-09-28T04:00:00Z', ends_at: '2026-09-28T05:00:00Z', start: '09:30', end: '10:30', provider_id: 10 }),
        visit(2, { status: 'confirmed', starts_at: '2026-09-28T04:20:00Z', start: '09:50' }, { starts_at: '2026-09-28T04:20:00Z', ends_at: '2026-09-28T05:20:00Z', provider_id: 10, status: 'pending' }),
        visit(3, { status: 'in_service' }, { starts_at: '2026-09-28T04:00:00Z', ends_at: '2026-09-28T05:00:00Z', start: '09:30', end: '10:30', status: 'in_service' }),
        visit(4, {}, { start: '11:00' }),
        visit(5, { status: 'cancelled' }),
        visit(6, { date: '2026-09-29' }),
      ]),
      NOW,
    );
    expect(b.date).toBe('2026-09-28');
    expect(b.now_label).toBe('10:00');
    expect(b.late.map((v) => v.id)).toEqual([1]);
    expect(b.arriving.map((v) => v.id)).toEqual([2, 4]);
    expect(b.figures).toEqual({ bookings: 4, done: 1, to_come: 3, taken: null });
    expect(b.location).toMatchObject({ opens: '09:00', closes: '19:00' });
    expect(b.floor).toEqual([
      { provider_id: 9, name: 'Nimali Perera', color: '#f00', current: { client: 'Client 3', service: 'Cut', until: '10:30' }, next: { label: '11:00', client: 'Client 4' } },
      /* Booked across now and confirmed: in the chair, as the server counts it. */
      /* Client 2's pending 09:50 has begun without them: neither in the chair nor next. */
      { provider_id: 10, name: 'Kasun Silva', color: null, current: { client: 'Client 1', service: 'Cut', until: '10:30' }, next: null },
    ]);
  });
});

describe('the calendar from the copy', () => {
  it("draws a day the copy holds, with the salon's hours as each stylist's", () => {
    const c = copy([visit(1), visit(2, { date: '2026-09-29' })]);
    const day = calendarFromCopy(c, '2026-09-28');
    expect(day.visits.map((v) => v.id)).toEqual([1]);
    expect(day.stylists.map((s) => s.id)).toEqual([9, 10]);
    expect(day.stylists[0]!.working).toEqual([['2026-09-28T03:30:00Z', '2026-09-28T13:30:00Z']]);
    expect(dayWindow(day, '2026-09-28')).toEqual([9 * 60, 19 * 60]);
    expect(calendarFromCopy(c, '2026-09-27').stylists[0]!.working).toEqual([]); // a Sunday, closed
  });

  it('holds yesterday to the days ahead, and no further', () => {
    const c = copy([]);
    expect(copyHolds(c, '2026-09-27', NOW)).toBe(true);
    expect(copyHolds(c, '2026-09-26', NOW)).toBe(false);
    expect(copyHolds(c, '2026-10-12', NOW)).toBe(true);
    expect(copyHolds(c, '2026-10-13', NOW)).toBe(false);
  });

  it('turns the salon clock into an instant, across a change of clocks', () => {
    expect(instantAt('2026-09-28', '09:00', 'Asia/Colombo')).toBe('2026-09-28T03:30:00Z');
    expect(instantAt('2026-03-29', '09:00', 'Europe/London')).toBe('2026-03-29T08:00:00Z');
    expect(instantAt('2026-03-28', '09:00', 'Europe/London')).toBe('2026-03-28T09:00:00Z');
    expect(weekdayOf('2026-09-27')).toBe(7);
  });
});

describe('the desk opened from the copy', () => {
  it("is what /options said when the copy was taken, the company's own words first", () => {
    const o = optionsFromCopy(copy([]));
    expect(o).toMatchObject({ currency: 'LKR', company: 'Lotus Salon', ack_severity: 'severe', loyalty: true, may: { 'salon.visit.book': true } });
    expect(o.locations).toEqual([{ id: 16, org_id: 17, name: 'Colombo 05', timezone: 'Asia/Colombo' }]);
    expect(o.stylists).toHaveLength(3);

    const bare = optionsFromCopy(copy([], { options: null }));
    expect(bare).toMatchObject({ currency: 'LKR', company: 'Lotus', ack_severity: 'moderate', may: {} });
    expect(bare.locations).toEqual([{ id: 16, org_id: 17, name: 'Colombo 05', timezone: 'Asia/Colombo' }]);
  });

  it('knows a query WorkSuite did not answer from one it refused', () => {
    expect(unreachable({ isError: false, error: null, fetchStatus: 'paused' })).toBe(true);
    expect(unreachable({ isError: true, error: new ApiError(503, 'x', 'NETWORK_UNREACHABLE'), fetchStatus: 'idle' })).toBe(true);
    expect(unreachable({ isError: true, error: new ApiError(403, 'x', null), fetchStatus: 'idle' })).toBe(false);
    expect(unreachable({ isError: false, error: null, fetchStatus: 'fetching' })).toBe(false);
  });

  it('says what waits', () => {
    const base = { desk_id: 5, copy: null, others: 0, reachable: true, last_contact: null, last_sync: null, problem: null, can_write: true, why_not: null, can_keep_copy: true };
    expect(waitingLine({ ...base, waiting: 0, refused: 0 })).toBeNull();
    expect(waitingLine({ ...base, waiting: 3, refused: 1 })).toBe('3 changes waiting to send · 1 needs you');
    expect(waitingLine({ ...base, waiting: 1, refused: 0 })).toBe('1 change waiting to send');
  });
});
