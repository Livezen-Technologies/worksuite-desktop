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
import { CallService, ringRoute } from '../../../electron/services/calls';

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

describe('media servers from the bootstrap', () => {
  it('takes the announced LiveKit origin, secure schemes only', () => {
    expect(mediaServersOf({ livekit_url: 'wss://lk.worksuite.lk' })).toEqual(['wss://lk.worksuite.lk']);
    expect(mediaServersOf({ livekit_url: 'wss://lk.worksuite.lk:7880/rtc' })).toEqual(['wss://lk.worksuite.lk:7880']);
    expect(mediaServersOf({ livekit_url: 'ws://lk.example' })).toEqual([]);
    expect(mediaServersOf({ livekit_url: null })).toEqual([]);
    expect(mediaServersOf(undefined)).toEqual([]);
  });
});
