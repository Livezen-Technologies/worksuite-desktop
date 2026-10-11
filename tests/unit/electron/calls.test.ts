import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined },
  BrowserWindow: class {},
  screen: {},
  desktopCapturer: {},
  systemPreferences: {},
  webContents: {},
}));

import { mediaServersOf } from '../../../electron/services/bootstrap';
import { CallService, meetRingRoute, ringRoute } from '../../../electron/services/calls';

const ringing = { uuid: '3f0c9a8e-1b2c-4d5e-8f90-a1b2c3d4e5f6', room_id: 42, caller_name: "Samali O'Neil Perera", room_name: 'Garage module — design', mode: 'video', silent: false, expires_in: 44 };

/**
 * Chat calls in the shell: an incoming call opens the ring window with what it
 * needs, once, and a call window that closes hangs up on the server.
 */
describe('incoming calls', () => {
  it('builds the ring window route, percent-encoded, from the ring', () => {
    const route = ringRoute(ringing)!;
    expect(route.startsWith('/calls/ring?')).toBe(true);
    expect(route).not.toMatch(/[+ ]/);
    const q = new URLSearchParams(route.split('?')[1]);
    expect(q.get('uuid')).toBe(ringing.uuid);
    expect(q.get('name')).toBe("Samali O'Neil Perera");
    expect(q.get('room')).toBe('Garage module — design');
    expect(q.get('mode')).toBe('video');
    expect(q.get('expires')).toBe('44');
  });

  it('refuses anything that is not a call', () => {
    expect(ringRoute(null)).toBeNull();
    expect(ringRoute({ ...ringing, uuid: '../../etc' })).toBeNull();
    expect(ringRoute({ ...ringing, room_id: 'x' as unknown as number })).toBeNull();
  });

  it('rings once per call, and not while locked or signed out', () => {
    const open = vi.fn();
    let allowed = false;
    const calls = new CallService({ open } as never, { get: vi.fn(), post: vi.fn() } as never, () => allowed);
    calls.handle({ type: 'chat.call.ringing', ...ringing } as never);
    expect(open).not.toHaveBeenCalled();
    allowed = true;
    calls.handle({ type: 'chat.call.ringing', ...ringing } as never);
    calls.handle({ type: 'chat.call.ringing', ...ringing } as never);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toBe('ring');
  });

  it('tells the server the ring is showing, once, so the caller reads Ringing (worksuite-desktop#113)', () => {
    const post = vi.fn().mockResolvedValue(null);
    const calls = new CallService({ open: vi.fn() } as never, { get: vi.fn(), post } as never, () => true);
    calls.handle({ type: 'chat.call.ringing', ...ringing } as never);
    calls.handle({ type: 'chat.call.ringing', ...ringing } as never);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(`/api/chat/calls/${ringing.uuid}/delivered`);
  });

  it('does not say a ring is showing when it is not', () => {
    const post = vi.fn().mockResolvedValue(null);
    const calls = new CallService({ open: vi.fn() } as never, { get: vi.fn(), post } as never, () => false);
    calls.handle({ type: 'chat.call.ringing', ...ringing } as never);
    expect(post).not.toHaveBeenCalled();
  });

  it('hangs up a call whose window closes', () => {
    const post = vi.fn().mockResolvedValue(null);
    const calls = new CallService({ open: vi.fn() } as never, { get: vi.fn(), post } as never, () => true);
    const onActive = vi.fn();
    calls.onActiveChanged = onActive;
    let closed: (() => void) | undefined;
    const win = { id: 7, once: (_e: string, fn: () => void) => (closed = fn) };
    calls.setActive(win as never, ringing.uuid);
    expect(onActive).toHaveBeenLastCalledWith(true);
    closed!();
    expect(post).toHaveBeenCalledWith(`/api/chat/calls/${ringing.uuid}/end`);
    expect(onActive).toHaveBeenLastCalledWith(false);
  });

  it('does not hang up a call the window already left', () => {
    const post = vi.fn().mockResolvedValue(null);
    const calls = new CallService({ open: vi.fn() } as never, { get: vi.fn(), post } as never, () => true);
    let closed: (() => void) | undefined;
    const win = { id: 8, once: (_e: string, fn: () => void) => (closed = fn) };
    calls.setActive(win as never, ringing.uuid);
    calls.setActive(win as never, null);
    closed!();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('meeting invitations (worksuite-desktop#79)', () => {
  const invite = { ring_id: 31, uuid: ringing.uuid, title: 'Design review', inviter_name: 'Kumari', silent: true, expires_in: 40 };

  it('opens Meet’s ring screen with who is inviting to what', () => {
    const route = meetRingRoute(invite)!;
    expect(route.startsWith('/meet/ring?')).toBe(true);
    const q = new URLSearchParams(route.split('?')[1]);
    expect(q.get('ring')).toBe('31');
    expect(q.get('title')).toBe('Design review');
    expect(q.get('name')).toBe('Kumari');
    expect(q.get('silent')).toBe('1');
    expect(meetRingRoute({ ...invite, ring_id: 0 })).toBeNull();
    expect(meetRingRoute({ ...invite, uuid: '../x' })).toBeNull();
  });

  it('rings once per invitation, never for a meeting this computer is in, and only when Meet may open', () => {
    const open = vi.fn();
    let meetAllowed = false;
    const calls = new CallService({ open } as never, { get: vi.fn(), post: vi.fn() } as never, () => true, () => meetAllowed);
    calls.handle({ type: 'meet.ring', ...invite } as never);
    expect(open).not.toHaveBeenCalled();
    meetAllowed = true;
    calls.handle({ type: 'meet.ring', ...invite } as never);
    calls.handle({ type: 'meet.ring', ...invite } as never);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toBe('ring');

    calls.setActive({ id: 3, once: vi.fn() } as never, 'aaaaaaaa-1b2c-4d5e-8f90-a1b2c3d4e5f6', { kind: 'meet', title: 'x' });
    calls.handle({ type: 'meet.ring', ...invite, ring_id: 32, uuid: 'aaaaaaaa-1b2c-4d5e-8f90-a1b2c3d4e5f6' } as never);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('asks for a ring it may have missed, from an older server too', async () => {
    const get = vi.fn().mockImplementation((path: string) => (path === '/api/meet/rings/ringing' ? Promise.resolve(invite) : Promise.resolve(null)));
    const open = vi.fn();
    const calls = new CallService({ open } as never, { get, post: vi.fn() } as never, () => true);
    await calls.check();
    expect(open).toHaveBeenCalledWith('ring', expect.stringContaining('/meet/ring?'), expect.any(String), true);

    const failing = new CallService({ open: vi.fn() } as never, { get: vi.fn().mockRejectedValue(new Error('404')), post: vi.fn() } as never, () => true);
    await expect(failing.check()).resolves.toBeUndefined();
  });
});

describe('meeting invitations that move on (worksuite-desktop#347)', () => {
  const invite = { ring_id: 31, uuid: ringing.uuid, title: 'Design review', inviter_name: 'Kumari', silent: true, expires_in: 40 };

  it('rings again after a ring into the same meeting stopped', () => {
    const open = vi.fn();
    const calls = new CallService({ open } as never, { get: vi.fn(), post: vi.fn() } as never, () => true);
    calls.handle({ type: 'meet.ring', ...invite } as never);
    calls.handle({ type: 'meet.ring.stopped', ring_id: 31, uuid: ringing.uuid, state: 'no_answer' } as never);
    calls.handle({ type: 'meet.ring', ...invite, ring_id: 32 } as never);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('never shows a ring the host cancelled, or that was answered on another device, while it waited to show', async () => {
    let allow: (v: boolean) => void = () => undefined;
    const open = vi.fn();
    const calls = new CallService({ open } as never, { get: vi.fn(), post: vi.fn() } as never, () => true);
    calls.attention = () => new Promise<boolean>((r) => (allow = r));
    calls.handle({ type: 'meet.ring', ...invite } as never);
    calls.handle({ type: 'meeting.invite_state_changed', meeting: ringing.uuid, invitee_id: 7, ring_id: 31, invite_state: 'cancelled' } as never);
    allow(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
  });

  it('is not stopped by the ring still ringing, or by a different ring', async () => {
    let allow: (v: boolean) => void = () => undefined;
    const open = vi.fn();
    const calls = new CallService({ open } as never, { get: vi.fn(), post: vi.fn() } as never, () => true);
    calls.attention = () => new Promise<boolean>((r) => (allow = r));
    calls.handle({ type: 'meet.ring', ...invite } as never);
    calls.handle({ type: 'meeting.invite_state_changed', meeting: ringing.uuid, invitee_id: 7, ring_id: 31, invite_state: 'ringing' } as never);
    calls.handle({ type: 'meet.ring.stopped', ring_id: 30, uuid: ringing.uuid } as never);
    allow(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('media servers from the bootstrap', () => {
  it('takes the announced LiveKit origin, secure schemes only', () => {
    expect(mediaServersOf({ livekit_url: 'wss://lk.worksuite.lk' })).toEqual(['wss://lk.worksuite.lk']);
    expect(mediaServersOf({ livekit_url: 'wss://lk.worksuite.lk:7880/rtc' })).toEqual(['wss://lk.worksuite.lk:7880']);
    expect(mediaServersOf({ livekit_url: 'ws://lk.example' })).toEqual([]);
    expect(mediaServersOf({ livekit_url: null })).toEqual([]);
    expect(mediaServersOf(undefined)).toEqual([]);
  });
});
