import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('livekit-client', () => ({ Room: class {}, RoomEvent: {}, Track: { Source: {}, Kind: {} }, VideoPresets: { h720: {} }, DisconnectReason: {}, createLocalTracks: vi.fn() }));
const bridge = vi.hoisted(() => ({ listeners: new Map<string, Array<(e: unknown) => void>>() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (channel: string, fn: (e: unknown) => void) => {
    bridge.listeners.set(channel, [...(bridge.listeners.get(channel) ?? []), fn]);
    return () => bridge.listeners.set(channel, (bridge.listeners.get(channel) ?? []).filter((f) => f !== fn));
  },
  errorMessage: (e: unknown) => String(e),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ ApiError: class extends Error {}, apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

import { badgeRole, clock, inviteActions, inviteLabel, inviteStateOf, isInviteEvent, nextRead, type Ring } from '../../../src/modules/meet/invites';
import { meet } from '../../../src/modules/meet/session';
import { queryClient } from '../../../src/core/query';

/**
 * How each invitation into a meeting that is on stands (worksuite-desktop#347):
 * one label and one set of actions per state the server sends, and nothing
 * here deciding the state itself.
 */

const NOW = Date.parse('2026-10-11T10:00:12Z');
const ring = (over: Partial<Ring> = {}): Ring => ({ id: 31, ring_id: 31, user_id: 7, name: 'Dimuthu', state: 'ringing', invite_state: 'ringing', rang_at: '2026-10-11 10:00:00', state_changed_at: '2026-10-11 10:00:00', invited_by: { id: 2, name: 'Me' }, retry_in: 0, ...over });

describe('what each invitation says, and what can be done about it', () => {
  const table: Array<[Partial<Ring>, string, string[]]> = [
    [{ invite_state: 'ringing' }, 'Ringing… 0:12', ['cancel']],
    [{ invite_state: 'no_answer', state: 'no_answer' }, 'Didn’t answer', ['ring_again', 'remove']],
    [{ invite_state: 'declined', state: 'declined', reason: 'In another meeting' }, 'Declined · In another meeting', ['ring_again', 'remove']],
    [{ invite_state: 'declined', state: 'declined' }, 'Declined', ['ring_again', 'remove']],
    [{ invite_state: 'cancelled', state: 'cancelled' }, 'Invite cancelled', ['ring_again', 'remove']],
    [{ invite_state: 'accepted', state: 'accepted' }, 'Joining…', ['cancel']],
    [{ invite_state: 'joining', state: 'accepted' }, 'Joining…', ['cancel']],
    [{ invite_state: 'failed', state: 'no_answer' }, 'Couldn’t join', ['ring_again']],
    [{ invite_state: 'joined', state: 'joined' }, 'In the meeting', []],
    [{ invite_state: 'offline', state: 'unavailable' }, 'Offline · invite sent by notification', ['copy_link']],
    [{ invite_state: 'busy', state: 'unavailable' }, 'Busy in another call', ['ring_again', 'message']],
  ];

  it.each(table)('%o reads “%s”', (over, label, actions) => {
    const r = ring(over);
    expect(inviteLabel(r, NOW)).toBe(label);
    expect(inviteActions(inviteStateOf(r))).toEqual(actions);
  });

  it('never says Accepted because the ring arrived', () => {
    for (const s of ['ringing', 'no_answer', 'declined', 'cancelled', 'failed', 'offline', 'busy'] as const) {
      expect(inviteLabel(ring({ invite_state: s }), NOW)).not.toMatch(/Accepted|Joining/);
    }
  });

  it('says Do not disturb rather than Offline when that is why it did not ring', () => {
    expect(inviteLabel(ring({ invite_state: 'offline', reason: 'do_not_disturb' }), NOW)).toBe('Do not disturb · invite sent by notification');
  });

  it('reads an older server’s states as what they mean', () => {
    expect(inviteStateOf({ state: 'accepted' })).toBe('joining');
    expect(inviteStateOf({ state: 'unavailable' })).toBe('offline');
    expect(inviteStateOf({ state: 'no_answer', invite_state: null })).toBe('no_answer');
    expect(inviteLabel(ring({ invite_state: undefined, state: 'accepted' }), NOW)).toBe('Joining…');
  });

  it('counts the ring in minutes and seconds', () => {
    expect(clock(7)).toBe('0:07');
    expect(clock(62)).toBe('1:02');
    expect(inviteLabel(ring({ state_changed_at: '2026-10-11 09:59:00' }), NOW)).toBe('Ringing… 1:12');
  });
});

describe('Didn’t answer at 45 s', () => {
  it('reads the list again just after the server’s clock settles the ring', () => {
    const readAt = NOW;
    // 2 s left on the ring: read again 2.3 s from now, not at the usual 3 s.
    expect(nextRead([ring({ expires_in: 2 })], readAt, NOW)).toBe(2_300);
    expect(nextRead([ring({ expires_in: 33 })], readAt, NOW)).toBe(3_000);
    expect(nextRead([ring({ invite_state: 'joining', state: 'accepted', expires_in: 1 })], readAt, NOW)).toBe(1_300);
    expect(nextRead([ring({ invite_state: 'declined', state: 'declined' })], readAt, NOW)).toBe(20_000);
    expect(nextRead([ring({ expires_in: 0 })], readAt, NOW + 5_000)).toBe(250);
  });
});

describe('the badge', () => {
  it('shows the meeting’s creator as Host, whatever the connection says', () => {
    expect(badgeRole(2, 'cohost', { host_id: 2, cohosts: [5] })).toBe('host');
    expect(badgeRole(2, 'participant', { host_id: 2 })).toBe('host');
  });

  it('shows the co-hosts the meeting names, and leaves everybody else to their connection', () => {
    expect(badgeRole(5, 'participant', { host_id: 2, cohosts: [5] })).toBe('cohost');
    expect(badgeRole(9, 'presenter', { host_id: 2, cohosts: [5] })).toBe('presenter');
    expect(badgeRole(0, 'participant', { host_id: 2 })).toBe('participant');
    expect(badgeRole(2, 'host', null)).toBe('host');
  });
});

describe('keeping the list to the server’s word', () => {
  let off: () => void = () => undefined;
  beforeEach(() => {
    bridge.listeners.clear();
    meet.uuid = 'meet-uuid-0040';
    off = meet.watchInvites();
  });
  afterEach(() => off());

  it('reads the invitations again the moment one moves', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const event = { type: 'meeting.invite_state_changed', meeting: 'meet-uuid-0040', invitee_id: 7, ring_id: 31, invite_state: 'declined' };
    expect(isInviteEvent(event)).toBe(true);
    for (const fn of bridge.listeners.get('realtime:event') ?? []) fn(event);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['meet', 'meet-uuid-0040', 'rings'] });
    spy.mockClear();
    for (const fn of bridge.listeners.get('realtime:event') ?? []) fn({ ...event, meeting: 'another' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reads them again after reconnecting instead of keeping what they said', () => {
    const before = meet.ringsVersion;
    for (const fn of bridge.listeners.get('realtime:resync') ?? []) fn(undefined);
    expect(meet.ringsVersion).toBe(before + 1);
  });
});
