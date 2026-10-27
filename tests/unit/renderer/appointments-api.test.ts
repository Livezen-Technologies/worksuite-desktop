import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({})), request: vi.fn() }));

const { ApiError, apiGet, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const api = await import('../../../src/modules/appointments/api');

const req = vi.mocked(request);
const bridge = vi.mocked(call);
const get = vi.mocked(apiGet);
const appt = { id: 31, number: 'APT-0031', customer: { name: 'Kumari' } } as never;
const answer = <T>(data: T, message: string | null = null) => ({ data, offline: false, cachedAt: null, message }) as never;

/** The appointment desk's client: the server books, moves and judges every write; offline moves wait in order (audit D-G07). */
describe('Appointments api', () => {
  beforeEach(() => {
    req.mockReset();
    bridge.mockReset();
    get.mockClear();
  });

  it("returns the server's sentence with a write, and an empty one when it sent none", async () => {
    req.mockResolvedValueOnce(answer({ appointment: { id: 1 } }, 'Booked for 10:00.')).mockResolvedValueOnce(answer({}, null));
    expect(await api.book({ location_id: 1, service_id: 2, provider_id: 'any', customer_id: 3, starts_at: '2026-10-27T04:30:00Z' })).toEqual({ data: { appointment: { id: 1 } }, message: 'Booked for 10:00.' });
    expect(req).toHaveBeenLastCalledWith('POST', '/api/appointments', { body: expect.objectContaining({ provider_id: 'any' }) });
    expect((await api.removeBlock(9)).message).toBe('');
    expect(req).toHaveBeenLastCalledWith('DELETE', '/api/appointments/setup/blocks/9', { body: undefined });
  });

  it("reads a booking refusal's reason and the server's next free time", () => {
    const next = { starts_at: '2026-10-27T05:00:00Z', label: '10:30', provider: 'Dilani' };
    expect(api.refusal(new ApiError(409, 'Dilani is busy then.', 'conflict', { next }))).toEqual({ message: 'Dilani is busy then.', next });
    expect(api.refusal(new ApiError(409, 'Closed.', null, null))).toEqual({ message: 'Closed.', next: null });
    expect(api.refusal(new Error('Network'))).toEqual({ message: 'Network', next: null });
    expect(api.refusal('odd')).toEqual({ message: 'odd', next: null });
  });

  it('sends a status move now, or keeps it in the offline queue, and says which', async () => {
    bridge.mockResolvedValueOnce({ delivered: true, queued: false, data: { appointment: { id: 31 } } } as never);
    expect(await api.setStatus(appt, 'checked_in')).toEqual({ delivered: true, queued: false, message: 'Checked in.', appointment: { id: 31 } });
    expect(bridge).toHaveBeenLastCalledWith('offline:submit', {
      module: 'appointments',
      entity: 'appointment',
      entityId: '31',
      label: 'APT-0031 · Kumari → Checked in',
      method: 'POST',
      path: '/api/appointments/31/status',
      body: { status: 'checked_in' },
      queueIfOffline: true,
    });
    bridge.mockResolvedValueOnce({ delivered: false, queued: true } as never);
    const queued = await api.setStatus(appt, 'cancelled', 'Client called');
    expect(queued).toMatchObject({ delivered: false, queued: true, appointment: null });
    expect(queued.message).toMatch(/outbox/);
    expect(bridge.mock.calls.at(-1)?.[1]).toMatchObject({ body: { status: 'cancelled', reason: 'Client called' } });
    bridge.mockResolvedValueOnce({ delivered: false, queued: false, error: 'No longer fits.' } as never);
    await expect(api.setStatus(appt, 'no_show')).rejects.toThrow('No longer fits.');
  });

  it('keeps a client note offline like a status move', async () => {
    bridge.mockResolvedValueOnce({ delivered: false, queued: true } as never);
    expect((await api.addNote(5, 2, 'Prefers mornings', true)).queued).toBe(true);
    expect(bridge).toHaveBeenLastCalledWith('offline:submit', expect.objectContaining({ entity: 'customer_note', entityId: '5', path: '/api/appointments/customers/5/notes', body: { org_id: 2, body: 'Prefers mornings', pinned: true } }));
    bridge.mockResolvedValueOnce({ delivered: false, queued: false } as never);
    await expect(api.addNote(5, 2, 'x', false)).rejects.toThrow('The note was not saved.');
  });

  it('sends a waitlist entry under both the 1.1 and the web names, and holds an offer 15 minutes by default', async () => {
    req.mockResolvedValue(answer({}));
    await api.addToWaitlist({ customer_id: 1, location_id: 2, service_id: 3, date_from: '2026-11-01', date_to: '2026-11-07', note: 'Any evening' });
    expect(req.mock.calls.at(-1)?.[2]).toEqual({ body: { customer_id: 1, location_id: 2, service_id: 3, date_from: '2026-11-01', date_to: '2026-11-07', note: 'Any evening', from: '2026-11-01', to: '2026-11-07', notes: 'Any evening' } });
    await api.offerFromWaitlist(8);
    expect(req).toHaveBeenLastCalledWith('POST', '/api/appointments/waitlist/8/offer', { body: { hold_min: 15 } });
  });

  it('records a deposit in Billing, which owns money', async () => {
    req.mockResolvedValueOnce(answer({ payment: { id: 4 } }));
    await api.recordPayment({ client_id: 1, amount: 2500, currency: 'LKR', method: 'cash' });
    expect(req).toHaveBeenLastCalledWith('POST', '/api/billing/payments', { body: { client_id: 1, amount: 2500, currency: 'LKR', method: 'cash' } });
  });

  it("asks for today's dashboard unless a day is named", async () => {
    await api.fetchDashboard(null);
    expect(get).toHaveBeenLastCalledWith('/api/appointments/dashboard', undefined, undefined);
    await api.fetchDashboard('2026-10-27');
    expect(get).toHaveBeenLastCalledWith('/api/appointments/dashboard', { date: '2026-10-27' }, undefined);
  });

  it("reads times on the location's clock", () => {
    expect(api.dateIn('2026-10-26T20:00:00Z', 'Asia/Colombo')).toBe('2026-10-27');
    expect(api.dateIn('2026-10-26T20:00:00Z', 'UTC')).toBe('2026-10-26');
    expect(api.minutesIn('2026-10-27T04:30:00Z', 'Asia/Colombo')).toBe(600);
    expect(api.hhmm(605)).toBe('10:05');
    expect(api.hhmm(0)).toBe('00:00');
    expect(api.snap(52)).toBe(45);
    expect(api.snap(53)).toBe(60);
    expect(api.snap(20, 10)).toBe(20);
    expect(api.dayLabel('2026-10-27')).toBe('Tue 27 Oct');
  });

  it('counts minutes late, never below zero', () => {
    const now = Date.parse('2026-10-27T05:00:00Z');
    expect(api.lateBy({ starts_at: '2026-10-27T04:45:30Z' }, now)).toBe(14);
    expect(api.lateBy({ starts_at: '2026-10-27T05:30:00Z' }, now)).toBe(0);
  });

  it('writes an amount the server sent, grouped, with its currency', () => {
    expect(api.money(1234.5, 'LKR')).toBe('LKR 1,234.50');
    expect(api.money('99')).toBe('99.00');
    expect(api.money('n/a')).toBe('n/a');
    expect(api.money(null)).toBe('—');
  });

  it('saves a report CSV through the desktop, capped', async () => {
    bridge.mockResolvedValueOnce('/tmp/x.csv' as never);
    await api.saveCsv('report.csv', 'a'.repeat(8_000_010));
    const arg = bridge.mock.calls.at(-1)?.[1] as { name: string; text: string };
    expect(bridge.mock.calls.at(-1)?.[0]).toBe('files:saveText');
    expect(arg.name).toBe('report.csv');
    expect(arg.text.length).toBe(8_000_000);
  });
});
