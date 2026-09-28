import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_CATALOGUE, isAppVisible } from '@shared/apps';
import { tabRecordSchema } from '@shared/ipc/contract';
import { ApiError } from '../../../src/core/api';
import * as s from '../../../src/modules/salon/api';
import { dayWindow } from '../../../src/modules/salon/Calendar';
import { salonRoute, seedOf, seedParam } from '../../../src/modules/salon/parts';

afterEach(() => vi.unstubAllGlobals());

const stylist = (id: number, services: number[], over: Partial<s.Stylist> = {}): s.Stylist => ({ id, name: `S${id}`, title: null, color: null, active: true, services, locations: [], ...over });
const visit = (over: Partial<s.Visit> = {}): s.Visit => ({
  id: 1,
  number: 'GBL-APT-000001',
  client: { id: 9, name: 'Amaya Senanayake', phone: null, tier: null, reliability: 'reliable', allergy: null },
  status: 'confirmed',
  status_label: 'Confirmed',
  starts_at: '2026-09-28T04:30:00Z',
  date: '2026-09-28',
  start: '10:00',
  end: '11:00',
  items: [],
  money: { currency: 'LKR', total: 3500, deposit_due: 0, advance: 0, deposit_owed: 0, balance: 3500 },
  checked_out: false,
  ...over,
});

describe('SalonMate in the launcher', () => {
  const salon = APP_CATALOGUE.find((a) => a.id === 'salon')!;
  it('is a native app behind the salon app and salon.view', () => {
    expect(salon).toMatchObject({ surface: 'native', app: 'salon', perm: 'salon.view', webPath: '/salon' });
    expect(isAppVisible(salon, { apps: ['salon'], permissions: ['salon.view'] })).toBe(true);
    expect(isAppVisible(salon, { apps: ['salon'], permissions: [] })).toBe(false);
    expect(isAppVisible(salon, { apps: ['crm'], permissions: ['salon.view'] })).toBe(false);
  });
});

describe('a write is one attempt, under one key', () => {
  it('makes a fresh key for every attempt', () => {
    const a = s.attemptKey();
    expect(a).toMatch(/^desktop-[0-9a-f-]{36}$/);
    expect(s.attemptKey()).not.toBe(a);
  });

  it('knows a refusal the server kept from a connection that failed', () => {
    expect(s.answered(new ApiError(409, 'Taken', null, { code: 'taken' }))).toBe(true);
    expect(s.answered(new ApiError(422, 'Invalid', null))).toBe(true);
    expect(s.answered(new ApiError(0, 'No answer', 'INTERNAL'))).toBe(false);
    expect(s.answered(new ApiError(503, 'Down', null))).toBe(false);
    expect(s.answered(new Error('boom'))).toBe(false);
  });

  it('reads the gate, the next free time and the candidates from a refusal', () => {
    const gate = { ok: false, code: 'ack_required' as const, message: 'Read it', allergies: [], missing_patch: [] };
    expect(s.refusal(new ApiError(409, 'x', null, { code: 'ack_required', gate })).gate).toEqual(gate);
    expect(s.refusal(new ApiError(409, 'x', null, { next: { starts_at: '2026-09-28T05:00:00Z', label: '10:30' } })).next?.label).toBe('10:30');
    expect(s.refusal(new Error('x'))).toEqual({});
  });

  it('sends the key with a check-in, and the acknowledgement with it', async () => {
    const seen: Array<{ url: string; key: string | null; body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, key: new Headers(init.headers).get('Idempotency-Key'), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ status: 'success', message: 'Checked in.', data: { visit: {} } }), { headers: { 'Content-Type': 'application/json' } });
    });

    const r = await s.checkIn(7, { ack: true, statement: s.STATEMENT }, 'desktop-abc');

    expect(r.message).toBe('Checked in.');
    expect(seen).toEqual([{ url: 'app://bundle/__api/api/salon/v1/visits/7/status', key: 'desktop-abc', body: { action: 'check_in', ack: true, statement: s.STATEMENT } }]);
  });

  it('books a later slot as the desk’s booking, or as a walk-in who comes back', async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ status: 'success', data: { visit: {} } }), { headers: { 'Content-Type': 'application/json' } });
    });
    const body = { location_id: 16, client_id: 9, items: [{ service_id: 3, provider_id: 4 }], desk_id: 12 };

    await s.bookAt(body, '2026-09-29T05:00:00Z', true, 'k1');
    await s.bookAt(body, '2026-09-29T05:00:00Z', false, 'k2');

    expect(seen[0]).toMatchObject({ url: 'app://bundle/__api/api/salon/v1/visits', body: { source: 'desk', starts_at: '2026-09-29T05:00:00Z', desk_id: 12 } });
    expect(seen[1]).toMatchObject({ url: 'app://bundle/__api/api/salon/v1/walk-in', body: { start_now: false } });
  });
});

describe('pairing goes through the main process', () => {
  it('asks the desktop to pair, and gets the desk back without a key', async () => {
    const deskPair = vi.fn(async () => ({ desk: { id: 12, name: 'Front desk', status: 'active' }, message: 'Front desk is paired.' }));
    vi.stubGlobal('window', { worksuite: { salon: { deskPair } } });

    const r = await s.pairDesk({ location_id: 16, name: 'Front desk', pos_register_id: null });

    expect(deskPair).toHaveBeenCalledWith({ location_id: 16, name: 'Front desk', pos_register_id: null });
    expect(r.desk.id).toBe(12);
  });

  it('reads where a paired desk stands', () => {
    const list = { items: [{ id: 12, status: 'requested' }, { id: 13, status: 'active' }], may: { manage: false }, registers: [] } as unknown as s.DeskList;
    expect(s.deskState(list, 12)).toBe('requested');
    expect(s.deskState(list, 13)).toBe('active');
    expect(s.deskState(list, 99)).toBe('gone');
    expect(s.deskState(undefined, 12)).toBeNull();
  });
});

describe('the desk’s rules', () => {
  it('reads an allergy out from the salon’s threshold up', () => {
    expect(s.atLeast('severe', 'moderate')).toBe(true);
    expect(s.atLeast('moderate', 'moderate')).toBe(true);
    expect(s.atLeast('mild', 'moderate')).toBe(false);
    expect(s.atLeast('mild', 'mild')).toBe(true);
  });

  it('flags a client by the worst allergy still on file', () => {
    const a = (id: number, severity: s.Severity, withdrawn_at: string | null = null): s.Allergy => ({ id, substance: `A${id}`, reaction: null, severity, withdrawn_at });
    expect(s.worstAllergy([a(1, 'mild'), a(2, 'severe', '2026-01-01'), a(3, 'moderate')])).toEqual({ severity: 'moderate', substance: 'A3' });
    expect(s.worstAllergy([a(2, 'severe', '2026-01-01')])).toBeNull();
  });

  it('offers only stylists who do every chosen service, here', () => {
    const all = [stylist(1, [10, 11]), stylist(2, [10]), stylist(3, [10, 11], { active: false }), stylist(4, [10, 11], { locations: [99] }), stylist(5, [10, 11], { locations: [16] })];
    expect(s.capable(all, [10, 11], 16).map((x) => x.id)).toEqual([1, 5]);
    expect(s.capable(all, [10], 16).map((x) => x.id)).toEqual([1, 2, 5]);
  });

  it('finds the first free start from now, and calls it now within ten minutes', () => {
    const now = Date.parse('2026-09-28T04:30:00Z');
    const day = {
      date: '2026-09-28',
      timezone: 'Asia/Colombo',
      starts: [
        { starts_at: '2026-09-28T04:00:00Z', label: '09:30', free: true, chain: [] },
        { starts_at: '2026-09-28T04:30:00Z', label: '10:00', free: false, chain: [] },
        { starts_at: '2026-09-28T04:35:00Z', label: '10:05', free: true, chain: [] },
        { starts_at: '2026-09-28T05:30:00Z', label: '11:00', free: true, chain: [] },
      ],
    };
    const first = s.nextFree(day, now);
    expect(first?.label).toBe('10:05');
    expect(s.freeNow(first, now)).toBe(true);
    expect(s.freeNow(day.starts[3]!, now)).toBe(false);
    expect(s.nextFree(undefined, now)).toBeNull();
  });

  it('lists who is ready to pay: in the chair or done, not yet checked out', () => {
    const board = { visits: [visit({ id: 1, status: 'in_service' }), visit({ id: 2, status: 'completed', checked_out: true }), visit({ id: 3, status: 'confirmed' }), visit({ id: 4, status: 'checked_in' })] } as s.TodayBoard;
    expect(s.readyToPay(board).map((v) => v.id)).toEqual([1, 4]);
  });
});

describe('the salon’s clock, not this computer’s', () => {
  it('reads a UTC stamp on the location’s clock', () => {
    expect(s.clockAt('2026-09-28T04:30:00Z', 'Asia/Colombo')).toBe('10:00');
    expect(s.clockAt('not a time', 'Asia/Colombo')).toBe('');
  });

  it('knows which day it is at the salon', () => {
    expect(s.todayAt('Asia/Colombo', new Date('2026-09-28T19:00:00Z'))).toBe('2026-09-29');
    expect(s.todayAt('America/Los_Angeles', new Date('2026-09-28T05:00:00Z'))).toBe('2026-09-27');
  });

  it('counts minutes, days and money the same way everywhere', () => {
    expect(s.minutesOf('14:30')).toBe(870);
    expect(s.minutesOf('2026-09-28 09:15:00')).toBe(555);
    expect(s.minutesOf(null)).toBe(0);
    expect(s.addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(s.amount(13737.5, 'LKR')).toBe('LKR 13,737.50');
    expect(s.amount(null)).toBe('—');
    expect(s.greeting(9)).toBe('Good morning');
    expect(s.greeting(18)).toBe('Good evening');
  });

  it('draws the calendar from opening hours, widened to fit every booking', () => {
    const day = {
      date: '2026-09-28',
      hours: [{ weekday: 1, opens: '08:00', closes: '20:00' }],
      stylists: [],
      visits: [visit({ items: [{ start: '20:15', end: '21:05' } as s.VisitItem] }), visit({ status: 'cancelled', items: [{ start: '06:00', end: '07:00' } as s.VisitItem] })],
    } as s.CalendarDay;
    // 28 September 2026 is a Monday; the cancelled 06:00 booking does not widen the day.
    expect(dayWindow(day, '2026-09-28')).toEqual([8 * 60, 22 * 60]);
    expect(dayWindow(undefined, '2026-09-28')).toEqual([9 * 60, 19 * 60]);
  });
});

describe('a walk-in started with what is known', () => {
  it('travels in an address a tab can keep, whatever is in it', () => {
    const route = tabRecordSchema.shape.route;
    const seed = seedParam({ client_id: 29, service_ids: [3, 5], provider_id: 4, date: '2026-09-29' });
    for (const r of [salonRoute('book', { seed }), salonRoute('clients', { client: 29 }), salonRoute('calendar', { date: '2026-09-29' }), salonRoute('walkin', { note: "it's (all) here * ~ + ok!" })]) {
      expect(route.safeParse(r).success, r).toBe(true);
    }
    expect(seedOf(new URLSearchParams(salonRoute('book', { seed }).split('?')[1]))).toEqual({ client_id: 29, service_ids: [3, 5], provider_id: 4, date: '2026-09-29' });
    expect(salonRoute('today', { client: null, date: '' })).toBe('/salon?view=today');
  });

  it('carries ids, never a name, and stays short', () => {
    const seed = seedParam({ client_id: 29, service_ids: Array.from({ length: 40 }, (_, i) => i + 1) });
    expect(JSON.parse(seed).service_ids).toHaveLength(12);
    expect(salonRoute('book', { seed }).length).toBeLessThan(512);
  });

  it('reads its seed, and survives a bad one', () => {
    expect(seedOf(new URLSearchParams({ seed: JSON.stringify({ client_id: 9, service_ids: [3] }) }))).toEqual({ client_id: 9, service_ids: [3] });
    expect(seedOf(new URLSearchParams({ seed: '{nope' }))).toEqual({});
    expect(seedOf(new URLSearchParams())).toEqual({});
  });
});
