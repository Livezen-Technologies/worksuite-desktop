import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({})), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGetMeta: vi.fn(), request: vi.fn() }));

const { ApiError, apiGetMeta, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { at, codeOf, eGet, eGetMeta, ePost, errorData, errorText, fieldErrors, money, newKey, nice, statusOf } = await import('../../../src/modules/events/api');
const { deskForget, deskQueueResolve, deskScan, deskSearch, printJobs } = await import('../../../src/modules/events/desk');
const { routeOf, screenOf } = await import('../../../src/modules/events/routes');

const meta = vi.mocked(apiGetMeta);
const req = vi.mocked(request);
const bridge = vi.mocked(call);

/** WorkSuite Events' client: the server decides; the desk writes what it sent and asks again (audit D-G07). */
describe('Events api', () => {
  beforeEach(() => {
    meta.mockReset();
    req.mockReset();
    bridge.mockClear();
  });

  it("writes the server's figure grouped as written, never recomputed", () => {
    expect(money('25000.00', 'LKR')).toBe('LKR 25,000.00');
    expect(money('1234567.5')).toBe('1,234,567.50');
    expect(money(-1500, 'USD')).toBe('USD -1,500.00');
    expect(money('0007')).toBe('7.00');
    expect(money('about 5', 'LKR')).toBe('LKR about 5');
    expect(money(null, 'LKR')).toBe('—');
    expect(money('')).toBe('—');
  });

  it("words the server's codes for people", () => {
    expect(nice('WAITING_FOR_PAYMENT')).toBe('Waiting for payment');
    expect(nice('checked_in')).toBe('Checked in');
    expect(nice(null)).toBe('');
  });

  it("writes an instant in the event's zone, with the zone only when asked", () => {
    const w = { date: '2026-10-20', time: '09:00', zone: 'Asia/Colombo' } as never;
    expect(at(w, { day: false })).toBe('09:00');
    expect(at(w, { day: false, zone: true })).toBe('09:00 (Asia/Colombo)');
    expect(at(w)).toMatch(/20.*09:00$/);
    expect(at(null)).toBe('—');
    expect(at('not a date')).toBe('not a date');
  });

  it("reads a refusal's sentence, code, status and field errors", () => {
    const e = new ApiError(422, 'Answer every question.', 'invalid', { code: 'invalid_answers', errors: { phone: 'Give a phone number.', size: 3 }, field: 'email' });
    expect(errorText(e)).toBe('Answer every question.');
    expect(errorText(new Error('  '))).toBe('That could not be done. Try again.');
    expect(errorText('x', 'Nope')).toBe('Nope');
    expect(codeOf(e)).toBe('invalid_answers');
    expect(statusOf(e)).toBe(422);
    expect(statusOf(new Error('x'))).toBeNull();
    expect(errorData(new Error('x'))).toBeNull();
    expect(fieldErrors(e)).toEqual({ phone: 'Give a phone number.', email: 'Answer every question.' });
    expect(fieldErrors(new ApiError(409, 'Taken.', null, { code: 'already_queued' }))).toEqual({});
  });

  it('reads under the Events API and keeps the offline copy marked', async () => {
    meta.mockResolvedValueOnce({ data: [1], offline: true, cachedAt: '2026-10-26T10:00:00Z', message: null } as never).mockResolvedValueOnce({ data: { ok: 1 }, offline: false, cachedAt: null, message: null } as never);
    expect(await eGetMeta('/events', { page: 1 })).toEqual({ data: [1], offline: true, cachedAt: '2026-10-26T10:00:00Z' });
    expect(meta).toHaveBeenLastCalledWith('/api/events/v1/events', { page: 1 }, undefined);
    expect(await eGet('/events/4')).toEqual({ ok: 1 });
  });

  it("writes with an idempotency key when there is one, and returns the server's sentence", async () => {
    req.mockResolvedValueOnce({ data: { id: 9 }, offline: false, cachedAt: null, message: 'Checked in.' } as never).mockResolvedValueOnce({ data: null, offline: false, cachedAt: null, message: null } as never);
    expect(await ePost('/events/4/walk-ins', { name: 'A' }, 'desk-1')).toEqual({ data: { id: 9 }, message: 'Checked in.' });
    expect(req).toHaveBeenLastCalledWith('POST', '/api/events/v1/events/4/walk-ins', { body: { name: 'A' }, headers: { 'Idempotency-Key': 'desk-1' } });
    expect((await ePost('/events/4/close')).message).toBe('Done.');
    expect(req).toHaveBeenLastCalledWith('POST', '/api/events/v1/events/4/close', { body: {}, headers: undefined });
  });

  it('makes one key per attempt, short enough for the header', () => {
    const k = newKey('pay');
    expect(k).toMatch(/^pay-[0-9a-f-]{36}$/);
    expect(newKey()).not.toBe(newKey());
    expect(newKey('x'.repeat(120)).length).toBe(100);
  });

  it('scans and searches through the main process, which keeps the offline rules', async () => {
    await deskScan(4, { code: 'EV-123' }, 'checkin' as never);
    expect(bridge).toHaveBeenLastCalledWith('eventdesk:scan', { event_id: 4, code: 'EV-123', mode: 'checkin' });
    await deskScan(4, { registration_id: 77 }, 'checkout' as never);
    expect(bridge).toHaveBeenLastCalledWith('eventdesk:scan', { event_id: 4, registration_id: 77, mode: 'checkout' });
    await deskSearch(4, 'Perera');
    expect(bridge).toHaveBeenLastCalledWith('eventdesk:search', { event_id: 4, q: 'Perera', limit: 20 });
    await deskQueueResolve(4, 'u-1', 'drop');
    expect(bridge).toHaveBeenLastCalledWith('eventdesk:queueResolve', expect.objectContaining({ event_id: 4 }));
    await deskForget(4);
    expect(bridge).toHaveBeenLastCalledWith('eventdesk:forget', { event_id: 4, discard: false });
    await printJobs(4, [1, 2]);
    expect(bridge).toHaveBeenLastCalledWith('eventdesk:printJobs', { event_id: 4, job_ids: [1, 2] });
  });

  it('reads every address the server links to, and writes each back', () => {
    const q = (s = '') => new URLSearchParams(s);
    expect(screenOf(['events'], q())).toEqual({ kind: 'events' });
    expect(screenOf(['events', '0'], q())).toEqual({ kind: 'events' });
    expect(screenOf(['events', '4', 'checkin', 'reconciliation'], q())).toEqual({ kind: 'event', id: 4, view: 'review', list: null });
    expect(screenOf(['4', 'checkin', 'sessions'], q())).toMatchObject({ view: 'program' });
    expect(screenOf(['events', '4', 'waitlist'], q())).toEqual({ kind: 'event', id: 4, view: 'registrations', list: 'waitlist' });
    expect(screenOf(['events', '4', 'walk-ins'], q())).toMatchObject({ view: 'registrations', list: 'walkins' });
    expect(screenOf(['events', '4', 'anything'], q())).toMatchObject({ view: 'overview' });
    expect(screenOf(['events', '4'], q('view=badges'))).toMatchObject({ view: 'badges' });
    expect(screenOf(['events', '4'], q('view=nope'))).toMatchObject({ view: null });
    expect(screenOf(['events', 'attendees', '9'], q('event=4'))).toEqual({ kind: 'attendee', id: 9, event: 4 });
    expect(routeOf({ kind: 'event', id: 4, view: 'registrations', list: 'wait list' })).toBe('/events/4/registrations?list=wait%20list');
    expect(routeOf({ kind: 'event', id: 4, view: 'overview' })).toBe('/events/4');
    expect(routeOf({ kind: 'attendee', id: 9, event: null })).toBe('/events/attendees/9');
    for (const path of ['/events/4/desk', '/events/4/registrations/12', '/events/4/attendees/9']) expect(routeOf(screenOf(path.split('/').filter(Boolean), q()))).toBe(path);
  });
});
