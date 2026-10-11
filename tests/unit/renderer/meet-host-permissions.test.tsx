// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('livekit-client', () => ({ Room: class {}, RoomEvent: {}, Track: { Source: {}, Kind: {} }, VideoPresets: { h720: {} }, DisconnectReason: {}, createLocalTracks: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({})), on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../../src/core/toasts', () => toasts);
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, ...api, request: vi.fn() };
});

import { DEFAULT_ROOM_SETTINGS, type MeetInfo } from '../../../src/modules/meet/api';
import { MEETING_ROLES, PERMISSIONS, can, meetingRoleOf, rowActions } from '../../../src/modules/meet/permissions';
import { PeoplePanel } from '../../../src/modules/meet/PeoplePanel';
import { HOST_GONE_MS, isRoleChangedEvent, meet, meetingRoleOfParticipant } from '../../../src/modules/meet/session';
import { meetMoreSections } from '../../../src/modules/meet/moreMenu';
import { featured } from '../../../src/modules/calls/ui/people';
import type { Participant, Room } from 'livekit-client';

// The server's permission table, byte for byte (app/Modules/Communication/Config/meet-permissions.json).
const shared = JSON.parse(readFileSync('tests/fixtures/meet-permissions.json', 'utf8')) as { roles: unknown; actions: unknown };

/**
 * Host controls only for the people who may use them (worksuite-desktop#348).
 *
 * The table is the server's (`tests/fixtures/meet-permissions.json` is the
 * server's `Config/meet-permissions.json`); the People tab, a person's row
 * menu and the waiting room are built from it, so a guest and a staff
 * participant see none of the hosts' controls, and a role given or taken away
 * in the call shows or hides them as it arrives on my connection.
 */

type Meta = { role?: string; meeting_role?: string; host?: boolean; cohost?: boolean; waiting?: boolean };

function person(identity: string, name: string, meta: Meta = {}, over: { mic?: boolean; cam?: boolean; share?: boolean } = {}) {
  return {
    identity,
    name,
    metadata: JSON.stringify(meta),
    isMicrophoneEnabled: over.mic ?? true,
    isCameraEnabled: over.cam ?? true,
    isScreenShareEnabled: over.share ?? false,
    isSpeaking: false,
  } as unknown as Participant;
}

const host = () => person('u2-aa', 'Hasarinda', { role: 'host', meeting_role: 'host', host: true });
const staff = () => person('u9-cc', 'Dimuthu', { role: 'participant', meeting_role: 'participant' });
const guest = () => person('g-dd', 'Guest', { role: 'participant', meeting_role: 'guest' });
const knocking = () => person('g-ee', 'Visitor at the door', { role: 'participant', meeting_role: 'guest', waiting: true });

/** Me in a meeting with the host, a member of staff, a guest and somebody waiting. */
function as(me: Participant, info: Partial<MeetInfo> = {}) {
  const others = [host(), staff(), guest(), knocking()].filter((p) => p.identity !== me.identity);
  meet.uuid = 'm-348';
  meet.phase = 'in';
  meet.pinned = null;
  meet.room = { localParticipant: me, remoteParticipants: new Map(others.map((p) => [p.identity, p])), metadata: '' } as unknown as Room;
  meet.info = { uuid: 'm-348', host_id: 2, cohosts: [], room_settings: { ...DEFAULT_ROOM_SETTINGS }, ...info } as MeetInfo;
}

const panel = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PeoplePanel /></QueryClientProvider>);

/** The row menu offered for somebody, by name; null when their row has none. */
function menuFor(name: string): string[] | null {
  const button = screen.queryByRole('button', { name: `Actions for ${name}` });
  if (!button) return null;
  fireEvent.click(button);
  const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent ?? '');
  fireEvent.click(button);
  return items;
}

afterEach(() => {
  cleanup();
  meet.room = null;
  meet.phase = 'loading';
  vi.useRealTimers();
});
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.apiGet.mockResolvedValue({ rings: [] });
  api.apiPost.mockResolvedValue(null);
  toasts.toast.mockReset();
});

describe('the permission table', () => {
  it('is the table the server enforces', () => {
    expect(MEETING_ROLES).toEqual(shared.roles);
    expect(PERMISSIONS).toEqual(shared.actions);
  });

  it('gives the room to the host and co-hosts, the meeting to the host, and the rest to everybody', () => {
    for (const a of ['admit', 'mute', 'ask_unmute', 'remove', 'lock', 'stop_screen_share', 'spotlight'] as const) {
      expect([can('host', a), can('co_host', a), can('participant', a), can('guest', a)]).toEqual([true, true, false, false]);
    }
    for (const a of ['set_cohost', 'end_for_all', 'transfer_host'] as const) {
      expect([can('host', a), can('co_host', a), can('participant', a), can('guest', a)]).toEqual([true, false, false, false]);
    }
    for (const a of ['pin_self', 'raise_hand', 'react', 'chat'] as const) expect(can('guest', a)).toBe(true);
    expect(can('participant', 'invite')).toBe(true);
    expect(can('participant', 'invite', { invite: 'hosts' })).toBe(false);
    expect(can('co_host', 'record', { record: 'hosts' })).toBe(true);
    expect(can('host', 'record', { recording: false })).toBe(false);
  });

  it('reads one role per person, and a guest is always a guest', () => {
    expect(meetingRoleOf('presenter', false)).toBe('participant');
    expect(meetingRoleOf('host', true)).toBe('guest');
    expect(meetingRoleOfParticipant(person('g-x', 'Guest', { meeting_role: 'host', host: true }))).toBe('guest');
    expect(meetingRoleOfParticipant(person('u5-x', 'Older server', { cohost: true }))).toBe('co_host');
  });

  it('builds the row menu from it: a guest and a staff participant get Pin for me, and nothing of the host\'s', () => {
    const someone = { self: false, role: 'participant' as const, micOn: true, cameraOn: true, sharing: true, pinned: false, spotlit: false };
    expect(rowActions('guest', someone)).toEqual(['pin']);
    expect(rowActions('participant', someone)).toEqual(['pin']);
    expect(rowActions('co_host', someone)).toEqual(['pin', 'spotlight', 'mute', 'camera_off', 'stop_share', 'make_presenter', 'remove']);
    expect(rowActions('host', someone)).toEqual(['pin', 'spotlight', 'mute', 'camera_off', 'stop_share', 'make_cohost', 'make_presenter', 'make_host', 'remove']);
    expect(rowActions('co_host', { ...someone, role: 'host', micOn: false })).toEqual(['pin', 'spotlight', 'ask_unmute']);
  });
});

describe('the People tab', () => {
  it('shows a guest no waiting room, no Mute all and no host actions on anybody', () => {
    as(guest());
    panel();
    expect(screen.queryByText(/Waiting to join/)).toBeNull();
    expect(screen.queryByText('Visitor at the door')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mute all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Admit' })).toBeNull();
    expect(menuFor('Hasarinda')).toEqual(['Pin for me']);
    expect(menuFor('Dimuthu')).toEqual(['Pin for me']);
  });

  it('shows a member of staff the same', () => {
    as(staff());
    panel();
    expect(screen.queryByText(/Waiting to join/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mute all' })).toBeNull();
    expect(menuFor('Hasarinda')).toEqual(['Pin for me']);
    expect(menuFor('Guest')).toEqual(['Pin for me']);
  });

  it('gives the host the waiting room and every action, and only the host Make co-host', () => {
    as(host());
    panel();
    expect(screen.getByText(/Waiting to join · 1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Admit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mute all' })).toBeTruthy();
    expect(menuFor('Dimuthu')).toEqual(['Pin for me', 'Spotlight for everyone', 'Mute', 'Turn off camera', 'Make co-host', 'Make presenter', 'Make host…', 'Remove from the meeting']);
    // A guest has no account to hold a role.
    expect(menuFor('Guest')).toEqual(['Pin for me', 'Spotlight for everyone', 'Mute', 'Turn off camera', 'Remove from the meeting']);
  });

  it('shows a co-host\'s controls the moment the role arrives on their connection, and hides them as it goes', () => {
    const me = staff();
    as(me);
    panel();
    expect(screen.queryByRole('button', { name: 'Mute all' })).toBeNull();

    // The server pushed the new role to my connection (`UpdateParticipant`): nothing else happens first.
    act(() => {
      (me as unknown as { metadata: string }).metadata = JSON.stringify({ role: 'cohost', meeting_role: 'co_host', cohost: true });
      meet.changed();
    });
    expect(screen.getByRole('button', { name: 'Mute all' })).toBeTruthy();
    expect(screen.getByText(/Waiting to join · 1/)).toBeTruthy();
    expect(menuFor('Guest')).toEqual(['Pin for me', 'Spotlight for everyone', 'Mute', 'Turn off camera', 'Remove from the meeting']);
    expect(menuFor('Hasarinda')).toEqual(['Pin for me', 'Spotlight for everyone']);

    act(() => {
      (me as unknown as { metadata: string }).metadata = JSON.stringify({ role: 'participant', meeting_role: 'participant' });
      meet.changed();
    });
    expect(screen.queryByRole('button', { name: 'Mute all' })).toBeNull();
    expect(screen.queryByText(/Waiting to join/)).toBeNull();
    expect(menuFor('Guest')).toEqual(['Pin for me']);
  });

  it('asks the server for each host action, and pins for me without it', () => {
    as(host());
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Mute all' }));
    expect(api.apiPost).toHaveBeenLastCalledWith('/api/meet/m-348/mute', { all: true });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Guest' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Turn off camera' }));
    expect(api.apiPost).toHaveBeenLastCalledWith('/api/meet/m-348/mute', { identity: 'g-dd', source: 'camera' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Guest' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Spotlight for everyone' }));
    expect(api.apiPost).toHaveBeenLastCalledWith('/api/meet/m-348/spotlight', { identity: 'g-dd' });
    const calls = api.apiPost.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Dimuthu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin for me' }));
    expect(api.apiPost.mock.calls.length).toBe(calls);
    expect(meet.pinned).toBe('u9-cc');
    expect(meet.focus).toBe('u9-cc');
  });
});

describe('the More menu', () => {
  it('has no host controls for a participant or a guest, and End for everyone is the host\'s', () => {
    const state = { role: 'participant' as const, canManage: false, settings: {}, mayRecord: false, mayStopRecording: false, recordingActive: false, recordingCommand: 'idle' as const,
      recordingMine: false, mayTranscribe: false, transcribingHere: false, transcribingElsewhere: null, locked: false, boardOnStage: false, controlling: null,
      words: { hostControls: 'Host controls', qa: 'Q&A', polls: 'Polls' } };
    const noop = vi.fn();
    const m = meetMoreSections(state, { releaseControl: noop, startRecording: noop, stopRecording: noop, recordingSettings: noop, startTranscription: noop, stopTranscription: noop,
      setLocked: noop, hostControls: noop, livestreaming: noop, panel: noop, toggleBoardOnStage: noop, copyLink: noop });
    expect(m.map((s) => s.id)).toEqual(['tools']);
    expect(m[0]!.items.map((i) => i.id)).toEqual(['activities', 'info']);

    as(staff());
    expect(meet.can('end_for_all')).toBe(false);
    as(host());
    expect(meet.can('end_for_all')).toBe(true);
    as(person('u8-bb', 'Chamari', { role: 'cohost', meeting_role: 'co_host', cohost: true }));
    expect(meet.can('end_for_all')).toBe(false);
    expect(meet.can('set_cohost')).toBe(false);
    expect(meet.can('mute')).toBe(true);
  });
});

describe('the spotlight, and the host leaving', () => {
  it('puts whoever is pinned or spotlighted large, after a shared screen', () => {
    const a = { id: 'a', name: 'A', self: false, speaking: true, micOn: true, camera: null, screen: null, screenPaused: false };
    const b = { ...a, id: 'b', speaking: false };
    expect(featured([a, b], null, 'b')!.id).toBe('b');
    expect(featured([a, b], null, null)!.id).toBe('a');
    const sharing = { ...a, id: 'c', screen: {} as never };
    expect(featured([a, b, sharing], null, 'b')!.id).toBe('c');

    as(staff());
    (meet.room as unknown as { metadata: string }).metadata = JSON.stringify({ spotlight: 'g-dd' });
    expect(meet.spotlight).toBe('g-dd');
    expect(meet.focus).toBe('g-dd');
    meet.pinned = 'u2-aa';
    expect(meet.focus).toBe('u2-aa');
    meet.pinned = 'u404-gone';
    expect(meet.focus).toBe('g-dd');
  });

  it('knows the role-changed event the server sends', () => {
    expect(isRoleChangedEvent({ type: 'meeting.role_changed', meeting: 'm-348', subject_id: 9, meeting_role: 'co_host' })).toBe(true);
    expect(isRoleChangedEvent({ type: 'meet.control', meeting: 'm-348' })).toBe(false);
    expect(HOST_GONE_MS).toBeLessThanOrEqual(10_000);
  });
});
