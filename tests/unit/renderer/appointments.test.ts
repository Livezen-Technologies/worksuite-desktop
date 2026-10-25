import { describe, expect, it } from 'vitest';
import { addDays, arriving, laneOf, minutesIn, movable, primaryMove, toCsv, waitlistFrom, weekItems, weekStart, zonedInstant, type Appointment } from '../../../src/modules/appointments/api';
import { daySheetHtml, receiptHtml } from '../../../src/modules/appointments/print';
import { parseDeepLink } from '../../../shared/deeplink';

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 1, number: 'APT-000001', status: 'confirmed', status_label: 'Confirmed', org_id: 1, location: { id: 1, name: 'Colombo 07' },
  customer: { id: 9, name: 'Nadeesha <Perera>', phone: '077', email: null }, service: { id: 2, name: 'Cut' }, provider: { id: 3, name: 'Kasun', color: null },
  starts_at: '2026-10-25T04:30:00Z', ends_at: '2026-10-25T05:15:00Z', timezone: 'Asia/Colombo', local: { date: '2026-10-25', start: '10:00', end: '10:45' },
  duration_min: 45, notes: null, internal_notes: null, source: 'staff', cancel_reason: null, checked_in_at: null, started_at: null, completed_at: null,
  next: [{ status: 'checked_in', label: 'Checked in', allowed: true }, { status: 'cancelled', label: 'Cancelled', allowed: true }],
  checked_out: false, invoice: null, payment_status: 'none', deposit: null,
  can: { reschedule: true, checkout: false, collect: false, deposit: false, commission: false },
  ...over,
});

describe('time on the location clock', () => {
  it('reads and writes wall-clock times in the location zone', () => {
    expect(minutesIn('2026-10-25T04:30:00Z', 'Asia/Colombo')).toBe(600);
    expect(zonedInstant('2026-10-25', 600, 'Asia/Colombo')).toBe('2026-10-25T04:30:00Z');
    expect(zonedInstant('2026-03-29', 9 * 60, 'Europe/London')).toBe('2026-03-29T08:00:00Z');
  });
  it('steps days and finds Monday', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
  });
});

describe('the desk rules come from the server', () => {
  it('drags only Pending and Confirmed the server lets move', () => {
    expect(movable(appt())).toBe(true);
    expect(movable(appt({ status: 'checked_in' }))).toBe(false);
    expect(movable(appt({ can: { ...appt().can, reschedule: false } }))).toBe(false);
  });
  it('puts cards in lanes and offers the allowed next move', () => {
    expect(laneOf(appt())).toBe('arriving');
    expect(laneOf(appt({ status: 'completed', can: { ...appt().can, checkout: true } }))).toBe('checkout');
    expect(laneOf(appt({ status: 'completed' }))).toBeNull();
    expect(primaryMove(appt())?.status).toBe('checked_in');
    expect(primaryMove(appt({ next: [{ status: 'checked_in', label: 'x', allowed: false }] }))).toBeNull();
    const now = Date.parse('2026-10-25T03:00:00Z');
    expect(arriving([appt(), appt({ id: 2, starts_at: '2026-10-25T09:00:00Z' })], now).map((a) => a.id)).toEqual([1]);
  });
});

describe('printing and export', () => {
  it('escapes what the server sent', () => {
    const html = receiptHtml({ business: 'Lotus', location: 'C7', invoice: 'INV-1', at: 'now', client: '<b>x</b>', servedBy: 'K', lines: [], totals: [{ label: 'TOTAL', amount: '1.00' }], payment: null });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(daySheetHtml('C7', 'Sun', [{ provider: 'Kasun', rows: [appt()] }], { notes: true, internal: true, phones: true, printedBy: 'I' })).toContain('Nadeesha &lt;Perera&gt;');
  });
  it('neutralises formula cells in CSV', () => {
    expect(toCsv(['a'], [['=SUM(1)'], ['x,y']])).toBe("a\n'=SUM(1)\n\"x,y\"");
  });
  it('opens appointment links natively', () => {
    const r = parseDeepLink('worksuite://appointments/12');
    expect(r.ok && r.link.route).toBe('/appointments?tab=today&apt=12');
  });
});

describe('server 1.1 calendar week and waitlist', () => {
  it('flattens the week endpoint\'s days', () => {
    const r = weekItems({ from: '2026-10-19', days: [{ date: '2026-10-19', appointments: [appt({ id: 1 })] }, { date: '2026-10-20', appointments: [appt({ id: 2 })] }, { date: '2026-10-21' }] }, 'x', '2026-10-25');
    expect(r.items.map((a) => a.id)).toEqual([1, 2]);
    expect(r.from).toBe('2026-10-19');
    expect(r.to).toBe('2026-10-25');
  });
  it('reads the web waitlist names (state, match, freed)', () => {
    const w = waitlistFrom({
      items: [{ id: 4, customer: { id: 9, name: 'Nadeesha' }, service: 'Cut', provider: null, wants: 'Sat morning', added_at: '2026-10-20', state: 'match', match: { starts_at: '2026-10-25T04:30:00Z', provider_id: 3, label: 'Sun 10:00' } }],
      freed: [{ label: 'Kasun 10:00', starts_at: '2026-10-25T04:30:00Z', entries: [4] }],
    });
    expect(w.items[0]).toMatchObject({ id: 4, status: 'match', note: 'Sat morning', service: { name: 'Cut' }, match: { provider_id: 3 } });
    expect(w.offers).toEqual([{ starts_at: '2026-10-25T04:30:00Z', provider: null, matches: [4], why: 'Kasun 10:00' }]);
  });
});
