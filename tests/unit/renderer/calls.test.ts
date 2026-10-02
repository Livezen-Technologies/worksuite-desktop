import { describe, expect, it, vi } from 'vitest';

vi.mock('livekit-client', () => ({ Room: class {}, RoomEvent: {}, Track: { Source: {}, Kind: {} }, VideoPresets: { h720: {} }, createLocalTracks: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: vi.fn(), errorMessage: (e: unknown) => String(e) }));
vi.mock('../../../src/core/api', () => ({ ApiError: class {}, apiGet: vi.fn(), apiPost: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { deviceProblem, shareOn, NO_ANSWER_MS, ringPhase, statusLine, stoppedAs, type Phase } from '../../../src/modules/calls/session';
import { canCall } from '../../../src/modules/chat/types';
import { routeQuery } from '../../../src/modules/calls/start';

const named = (name: string) => Object.assign(new Error(name), { name });

describe('call routes', () => {
  it('encodes every character a route does not allow', () => {
    const q = routeQuery({ room_id: 5, mode: 'audio', name: "Samali O'Neil (Design) + co" });
    expect(q).toMatch(/^[A-Za-z0-9_\-.:=&%]*$/);
    expect(new URLSearchParams(q).get('name')).toBe("Samali O'Neil (Design) + co");
  });

  it('leaves out what is not set', () => {
    expect(routeQuery({ room_id: 5, name: undefined, uuid: null })).toBe('room_id=5');
  });
});

describe('device problems', () => {
  it('names a blocked microphone and points at the privacy settings', () => {
    const p = deviceProblem(named('NotAllowedError'));
    expect(p.message).toContain('Microphone blocked (NotAllowedError)');
    expect(p.pane).toBe('microphone');
  });

  it('tells a missing device and a busy one apart', () => {
    expect(deviceProblem(named('NotFoundError'), 'camera').message).toContain('No camera was found');
    expect(deviceProblem(named('NotReadableError')).message).toContain('in use by another app');
    expect(deviceProblem(named('NotReadableError')).pane).toBeNull();
  });
});

/** A direct call's states, as the call window says them (worksuite-desktop#113). */
describe('call states', () => {
  const st = (phase: Phase, over: Partial<Parameters<typeof statusLine>[0]> = {}) => statusLine({ phase, answering: false, unreachable: null, reconnecting: false, remoteLost: false, lost: false, ...over }, '1:05', null)[0];

  it('says Calling, Ringing, Connecting and Connected with the clock', () => {
    expect(st('placing')).toBe('Calling…');
    expect(st('placing', { answering: true })).toBe('Connecting…');
    expect(st('calling')).toBe('Calling…');
    expect(st('ringing')).toBe('Ringing…');
    expect(st('connecting')).toBe('Connecting…');
    expect(st('connected')).toBe('Connected · 1:05');
  });

  it('keeps the clock while a dropped connection comes back, on either side', () => {
    expect(st('connected', { reconnecting: true })).toBe('Reconnecting… · 1:05');
    expect(st('connected', { remoteLost: true })).toBe('Reconnecting… · 1:05');
    expect(statusLine({ phase: 'ended', answering: false, unreachable: null, reconnecting: false, remoteLost: false, lost: true }, null, '4:10')[0]).toBe('Call ended · connection lost · 4:10');
  });

  it('says Busy, Declined and No answer', () => {
    expect(st('unreachable', { unreachable: { reason: 'busy' } })).toBe('Busy');
    expect(st('unreachable', { unreachable: { reason: 'declined' } })).toBe('Declined');
    expect(st('unreachable', { unreachable: { reason: 'no_answer' } })).toBe('No answer');
    expect(st('unreachable', { unreachable: { reason: 'offline' } })).toBe('Not available right now');
  });

  it('is Calling until a device of the other side shows the ring', () => {
    const me = { user_id: 7, name: 'Samali', state: 'joined', delivered: true };
    expect(ringPhase([me, { user_id: 8, name: 'Kasun', state: 'ringing', delivered: false }])).toBe('calling');
    expect(ringPhase([me, { user_id: 8, name: 'Kasun', state: 'ringing', delivered: true }])).toBe('ringing');
    // A server that does not say: Ringing, as before.
    expect(ringPhase([me, { user_id: 8, name: 'Kasun', state: 'ringing' }])).toBe('ringing');
  });

  it('reads how a call stopped before anybody talked, for the caller only', () => {
    expect(stoppedAs('declined', null, false, true)).toBe('declined');
    expect(stoppedAs('declined', 'busy', false, true)).toBe('busy');
    expect(stoppedAs('missed', null, false, true)).toBe('no_answer');
    expect(stoppedAs('cancelled', null, false, true)).toBeNull();
    expect(stoppedAs('declined', null, true, true)).toBeNull();
    expect(stoppedAs('declined', null, false, false)).toBeNull();
  });

  it('rings as long as the server does', () => {
    expect(NO_ANSWER_MS).toBe(45_000);
  });
});

describe('calling actions in a conversation', () => {
  it('are offered where WorkSuite can ring somebody, and nowhere else', () => {
    expect(canCall({ type: 'direct' })).toBe(true);
    expect(canCall({ type: 'group', can_call: true })).toBe(true);
    expect(canCall({ type: 'group', can_call: false })).toBe(false);
    expect(canCall({ type: 'widget' })).toBe(false);
    expect(canCall({ type: 'system' })).toBe(false);
    expect(canCall(undefined)).toBe(false);
  });
});


it.each([['NotAllowedError', 'Screen capture was refused'], ['NotFoundError', 'no longer available'], ['NotReadableError', 'could not start or be published']])('explains screen capture startup failure %s', async (name, message) => {
  const { call } = await import('../../../src/core/bridge');
  vi.mocked(call).mockResolvedValue(undefined as never);
  const lp = { isScreenShareEnabled: false, setScreenShareEnabled: vi.fn().mockRejectedValue(named(name)) };
  await expect(shareOn(lp as never, { id: 'screen:1:0', name: 'Screen 1', audio: false })).rejects.toThrow(message);
  expect(call).toHaveBeenCalledWith('media:screenPick', { id: 'screen:1:0', audio: false });
});
