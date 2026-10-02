import { describe, expect, it, vi } from 'vitest';
import { GuestMeetService } from '../../../electron/services/guest-meet';
import { IpcRouter } from '../../../electron/ipc/router';
import { guestDestination, isGuestMeetingHash } from '@shared/guest-meet';
const UUID = '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1b';
const INFO = { guests: true, ended: false, locked: false, title: 'Public meeting', sfu_url: 'wss://media.example.test', chat: 'everyone' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
describe('guest meeting authority', () => {
  it('accepts HTTPS links and hex codes, rejecting credentials and non-meeting URLs', () => {
    expect(guestDestination(`https://example.test/meet/${UUID}`, null)).toEqual({ origin: 'https://example.test', uuid: UUID });
    expect(guestDestination('4F2 9A1 C07', 'example.test')).toEqual({ origin: 'https://example.test', code: '4f29a1c07' });
    for (const input of ['https://user:password@example.test/meet/' + UUID, 'http://example.test/meet/' + UUID, 'https://example.test/files/123', 'invalid']) expect(() => guestDestination(input, 'https://example.test')).toThrow();
    expect(isGuestMeetingHash(`#/window/meet?route=${encodeURIComponent(`/guest-meet/${UUID}?server=https://example.test`)}`)).toBe(true);
    expect(isGuestMeetingHash('#/window/record?route=%2Ffiles')).toBe(false);
  });
  it('uses only public endpoints and omits account credentials, including code lookup', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ uuid: UUID })).mockResolvedValueOnce(reply(INFO)).mockResolvedValueOnce(reply({ token: 'scoped-media', url: INFO.sfu_url, identity: 'g-123' }));
    const service = new GuestMeetService({ fetch, server: () => 'https://example.test' });
    const info = await service.prepare('4F2 9A1 C07');
    service.bind(42, info);
    expect(await service.join(42, 'Visitor', 'secret')).toMatchObject({ token: 'scoped-media' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`https://example.test/api/meet/guest-resolve?code=4f29a1c07`, `https://example.test/api/meet/${UUID}/public`, `https://example.test/api/meet/${UUID}/guest`]);
    for (const [, init] of fetch.mock.calls) {
      expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error');
      expect(init.headers.Authorization).toBeUndefined(); expect(init.headers.Cookie).toBeUndefined();
    }
    expect(JSON.parse(fetch.mock.calls[2]![1].body)).toEqual({ name: 'Visitor', pass: 'secret' });
    await expect(service.join(99, 'Visitor')).rejects.toThrow('guest meeting window');
    service.forget(42); await expect(service.info(42)).rejects.toThrow('guest meeting window');
  });
  it.each([{ ended: true }, { locked: true }, { guests: false }, { sfu_url: 'ws://insecure.test' }, { sfu_url: undefined }])('refuses unsafe or unavailable meetings: %j', async (override) => {
    const service = new GuestMeetService({ fetch: vi.fn(async () => reply({ ...INFO, ...override })), server: () => 'https://example.test' });
    await expect(service.prepare(UUID)).rejects.toThrow();
  });
  it('preserves clear server refusals and disallows a changed media authority', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(INFO)).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Passcode required' }), { status: 403 })).mockResolvedValueOnce(reply({ url: 'wss://different.test', token: 'token' }));
    const service = new GuestMeetService({ fetch, server: () => 'https://example.test' });
    const info = await service.prepare(UUID); service.bind(1, info);
    await expect(service.join(1, 'Guest')).rejects.toThrow('Passcode required');
    await expect(service.join(1, 'Guest')).rejects.toThrow('media server changed');
  });
  it('blocks private IPC in a guest window even when an account is signed in elsewhere', async () => {
    const router = new IpcRouter({ handle: vi.fn(), removeHandler: vi.fn() }, { isTrustedSender: () => true, isLocked: () => false, isSignedIn: () => true, isGuestSender: (id) => id === 7, hasPermission: () => true, audit: vi.fn(), onAbuse: vi.fn() });
    const privateHandler = vi.fn();
    router.handle('session:bootstrap', privateHandler);
    router.handle('guest:info', async () => ({ ...INFO, uuid: UUID, origin: 'https://example.test', host_name: null, needs_passcode: false, chat: 'everyone' as const }));
    const sender = { id: 7 };
    expect(await router.dispatch('session:bootstrap', { sender } as never, undefined)).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(privateHandler).not.toHaveBeenCalled();
    expect(await router.dispatch('guest:info', { sender } as never, undefined)).toMatchObject({ uuid: UUID });
  });
});
