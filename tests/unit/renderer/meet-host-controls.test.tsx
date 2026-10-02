// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('livekit-client', () => ({ Room: class {}, RoomEvent: {}, Track: { Source: {}, Kind: {} }, VideoPresets: { h720: {} }, DisconnectReason: {}, createLocalTracks: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
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

import { DEFAULT_ROOM_SETTINGS, accessModeOf, may, type MeetInfo, type RoomSettings } from '../../../src/modules/meet/api';
import { meet } from '../../../src/modules/meet/session';
import { HostControlsDrawer, HostControlsFields, cameraControl, hostControlsControl, micControl, reactControl } from '../../../src/modules/meet/HostControls';
import type { Room } from 'livekit-client';

/** A local connection: what is on, and the calls that turn it on or off. */
function local(over: { mic?: boolean; cam?: boolean } = {}) {
  const lp = {
    identity: 'u3-ab',
    isMicrophoneEnabled: over.mic ?? false,
    isCameraEnabled: over.cam ?? false,
    isScreenShareEnabled: false,
    setMicrophoneEnabled: vi.fn(async (on: boolean) => void (lp.isMicrophoneEnabled = on)),
    setCameraEnabled: vi.fn(async (on: boolean) => void (lp.isCameraEnabled = on)),
    publishData: vi.fn(async () => undefined),
    metadata: undefined,
    permissions: undefined,
  };
  return lp;
}

/** Me in the meeting, with a role and room settings. */
function as(role: 'host' | 'cohost' | 'presenter' | 'participant', settings: Partial<RoomSettings> = {}, lp = local()) {
  meet.uuid = 'm-1';
  meet.phase = 'in';
  meet.room = { localParticipant: lp, remoteParticipants: new Map() } as unknown as Room;
  meet.info = { uuid: 'm-1', role, room_settings: { ...DEFAULT_ROOM_SETTINGS, ...settings } } as MeetInfo;
  return lp;
}

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

afterEach(() => {
  cleanup();
  meet.room = null;
  meet.phase = 'loading';
});
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  toasts.toast.mockReset();
});

describe('the host controls fields', () => {
  it('come in four groups, each switch named and described', () => {
    render(<HostControlsFields value={DEFAULT_ROOM_SETTINGS} onChange={vi.fn()} />);
    for (const name of ['Participant permissions', 'Chat', 'Meeting access', 'Activities']) expect(screen.getByRole('heading', { name })).toBeTruthy();
    const perms = screen.getByRole('region', { name: 'Participant permissions' });
    for (const name of ['Share their screen', 'Send reactions', 'Use their microphone', 'Use their camera']) {
      const sw = within(perms).getByRole('switch', { name });
      expect(sw.getAttribute('aria-checked')).toBe('true');
      expect(document.getElementById(sw.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
    }
    // Q&A, polls and raised hands (#92) are grouped as shared activities, beside the whiteboard, recording and transcription.
    const acts = screen.getByRole('region', { name: 'Activities' });
    for (const name of ['Draw on the whiteboard', 'Q&A', 'Polls', 'Raise hand', 'Recording', 'Co-hosts can record', 'Live transcription', 'Participants see transcripts and minutes']) expect(within(acts).getByRole('switch', { name })).toBeTruthy();
  });

  it('hands back each change as the setting it is', () => {
    const onChange = vi.fn();
    render(<HostControlsFields value={DEFAULT_ROOM_SETTINGS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Use their microphone' }));
    expect(onChange).toHaveBeenLastCalledWith({ microphone: false });
    fireEvent.click(screen.getByRole('switch', { name: 'Share their screen' }));
    expect(onChange).toHaveBeenLastCalledWith({ present: 'presenters' });
    fireEvent.click(screen.getByRole('switch', { name: 'Participants can write in the chat' }));
    expect(onChange).toHaveBeenLastCalledWith({ chat: 'hosts' });
    fireEvent.click(screen.getByRole('switch', { name: 'Host must join first' }));
    expect(onChange).toHaveBeenLastCalledWith({ join_before_host: false });
  });

  it('changes the access mode with what it means to a server before the modes', () => {
    const onChange = vi.fn();
    render(<HostControlsFields value={DEFAULT_ROOM_SETTINGS} onChange={onChange} />);
    expect((screen.getByRole('radio', { name: /Trusted/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Restricted/ }));
    expect(onChange).toHaveBeenLastCalledWith({ access_mode: 'restricted', access: 'invited', waiting_room: true });
    fireEvent.click(screen.getByRole('radio', { name: /Open/ }));
    expect(onChange).toHaveBeenLastCalledWith({ access_mode: 'open', access: 'anyone', waiting_room: false });
  });

  it('does not offer guests a restricted meeting, and says why', () => {
    render(<HostControlsFields value={{ ...DEFAULT_ROOM_SETTINGS, access_mode: 'restricted' }} onChange={vi.fn()} />);
    const guests = screen.getByRole('switch', { name: 'Allow guests to request access' }) as HTMLButtonElement;
    expect(guests.disabled).toBe(true);
    expect(guests.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById(guests.getAttribute('aria-describedby')!)?.textContent).toMatch(/guests cannot be invited/);
  });

  it('reads the settings of an older server as the mode they meant', () => {
    expect(accessModeOf({ access: 'invited' })).toBe('restricted');
    expect(accessModeOf({ access: 'anyone', waiting_room: false })).toBe('open');
    expect(accessModeOf({ access: 'signed_in', waiting_room: true })).toBe('trusted');
    const { access_mode: _m, guest_requests: _g, ...old } = DEFAULT_ROOM_SETTINGS;
    render(<HostControlsFields value={{ ...old, access: 'signed_in', waiting_room: false }} onChange={vi.fn()} />);
    expect((screen.getByRole('radio', { name: /Open/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('switch', { name: 'Allow guests to request access' }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('the host controls button and drawer', () => {
  it('is there for the host and co-hosts, never for a participant or presenter', () => {
    as('host');
    expect(hostControlsControl(false, vi.fn())).toHaveLength(1);
    as('cohost');
    expect(hostControlsControl(true, vi.fn())[0]).toMatchObject({ id: 'host-controls', icon: 'shield', label: 'Host controls', tone: 'active' });
    as('presenter');
    expect(hostControlsControl(false, vi.fn())).toEqual([]);
    as('participant');
    expect(hostControlsControl(false, vi.fn())).toEqual([]);
  });

  it('opens as a dialog with its heading focused, and Escape closes it', () => {
    as('host');
    const onClose = vi.fn();
    wrap(<HostControlsDrawer onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Host controls' });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Host controls' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('saves a change to this meeting at once, for everybody in it', async () => {
    as('host');
    api.apiPut.mockResolvedValue({});
    api.apiGet.mockResolvedValue({ uuid: 'm-1', role: 'host', room_settings: { ...DEFAULT_ROOM_SETTINGS, camera: false } });
    wrap(<HostControlsDrawer onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'This meeting' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/apply to everyone in this meeting/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Use their camera' }));
    await waitFor(() => expect(api.apiPut).toHaveBeenCalledWith('/api/meet/m-1/settings', { camera: false }));
    await waitFor(() => expect(toasts.toast).toHaveBeenCalledWith('success', 'Saved. Everyone in the meeting has the change.'));
  });

  it('keeps my defaults apart: a draft, saved only as my defaults, never to the meeting', async () => {
    as('host');
    api.apiGet.mockResolvedValue({ settings: DEFAULT_ROOM_SETTINGS, saved: false, available: true });
    api.apiPut.mockImplementation(async (_url: string, body: RoomSettings) => ({ settings: body, saved: true, available: true }));
    wrap(<HostControlsDrawer onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'My defaults for new meetings' }));
    await screen.findByText(/You have not saved defaults yet/);
    expect(screen.getByText(/This meeting does not change/)).toBeTruthy();
    expect(api.apiGet).toHaveBeenCalledWith('/api/meet/defaults', undefined, expect.anything());

    fireEvent.click(screen.getByRole('radio', { name: /Restricted/ }));
    expect(api.apiPut).not.toHaveBeenCalled();
    expect(screen.getByText('Not saved yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save as my defaults' }));
    await waitFor(() => expect(api.apiPut).toHaveBeenCalledWith('/api/meet/defaults', expect.objectContaining({ access_mode: 'restricted' })));
    expect(api.apiPut).not.toHaveBeenCalledWith('/api/meet/m-1/settings', expect.anything());
  });

  it('switches scope with the arrow keys', () => {
    as('host');
    api.apiGet.mockResolvedValue({ settings: DEFAULT_ROOM_SETTINGS, saved: true });
    wrap(<HostControlsDrawer onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'This meeting' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'My defaults for new meetings' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'My defaults for new meetings' }));
  });

  it('copies this meeting’s settings into my defaults', async () => {
    as('cohost', { microphone: false });
    api.apiPut.mockResolvedValue({ settings: {}, saved: true });
    wrap(<HostControlsDrawer onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save this meeting’s settings as my defaults' }));
    await waitFor(() => expect(api.apiPut).toHaveBeenCalledWith('/api/meet/defaults', expect.objectContaining({ microphone: false })));
  });
});

describe('a participant whose permissions the host turned off', () => {
  it('sees the microphone, camera and reactions buttons off, with why', () => {
    as('participant', { microphone: false, camera: false, reactions: false });
    const lp = local();
    expect(micControl(lp)).toMatchObject({ disabled: true, label: 'The host has turned off microphones for participants' });
    expect(cameraControl(lp)).toMatchObject({ disabled: true, label: 'The host has turned off cameras for participants' });
    expect(reactControl()).toMatchObject({ disabled: true, label: 'The host has turned off reactions' });
    // The hosts are never limited.
    as('cohost', { microphone: false, camera: false, reactions: false });
    expect(micControl(lp).disabled).toBeUndefined();
    expect(reactControl().menu?.length).toBeGreaterThan(0);
  });

  it('has the microphone and camera stopped as soon as the host turns them off, and is told', async () => {
    const lp = as('participant', {}, local({ mic: true, cam: true }));
    api.apiGet.mockResolvedValue({ uuid: 'm-1', role: 'participant', room_settings: { ...DEFAULT_ROOM_SETTINGS, microphone: false, camera: false } });
    await meet.reload();
    expect(lp.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(lp.setCameraEnabled).toHaveBeenCalledWith(false);
    expect(toasts.toast).toHaveBeenCalledWith('info', 'The host turned off microphones for participants. Your microphone is off.');
    expect(toasts.toast).toHaveBeenCalledWith('info', 'The host turned off cameras for participants. Your camera is off.');
  });

  it('is told when it is allowed again, and nothing turns on by itself', async () => {
    const lp = as('participant', { microphone: false });
    api.apiGet.mockResolvedValue({ uuid: 'm-1', role: 'participant', room_settings: { ...DEFAULT_ROOM_SETTINGS, microphone: true } });
    await meet.reload();
    expect(toasts.toast).toHaveBeenCalledWith('info', 'The host allowed microphones again. Unmute when you are ready.');
    expect(lp.setMicrophoneEnabled).not.toHaveBeenCalled();
    await meet.toggleMic();
    expect(lp.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it('cannot turn a microphone on while it is off for participants', async () => {
    const lp = as('participant', { microphone: false });
    await meet.toggleMic();
    expect(lp.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(meet.error).toBe('The host has turned off microphones for participants');
    meet.note(null);
  });

  it('leaves the host and co-hosts as they were, and says nothing to them', async () => {
    const lp = as('host', {}, local({ mic: true }));
    api.apiGet.mockResolvedValue({ uuid: 'm-1', role: 'host', room_settings: { ...DEFAULT_ROOM_SETTINGS, microphone: false, chat: 'hosts' } });
    await meet.reload();
    expect(lp.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(toasts.toast).not.toHaveBeenCalled();
  });

  it('is told when chat, the whiteboard or screen sharing is turned off', async () => {
    as('participant');
    api.apiGet.mockResolvedValue({ uuid: 'm-1', role: 'participant', room_settings: { ...DEFAULT_ROOM_SETTINGS, chat: 'hosts', whiteboard: false, present: 'presenters' } });
    await meet.reload();
    expect(toasts.toast).toHaveBeenCalledWith('info', 'The host turned off chat for participants.');
    expect(toasts.toast).toHaveBeenCalledWith('info', 'The host turned off drawing on the whiteboard.');
    expect(toasts.toast).toHaveBeenCalledWith('info', 'The host turned off screen sharing for participants.');
  });

  it('draws nothing and sends no reaction while those are off', () => {
    const lp = as('participant', { whiteboard: false, reactions: false });
    meet.strokes = [];
    meet.draw({ color: '#000', width: 3, points: [[0, 0], [1, 1]] });
    meet.react('👍');
    expect(meet.strokes).toEqual([]);
    expect(lp.publishData).not.toHaveBeenCalled();
    as('participant', {}, lp);
    meet.react('👍');
    expect(lp.publishData).toHaveBeenCalledWith(expect.anything(), { reliable: true, topic: 'meet.reaction' });
    const sent = (lp.publishData.mock.calls[0] as unknown as [Uint8Array])[0];
    expect(JSON.parse(new TextDecoder().decode(sent))).toEqual({ e: '👍' });
    expect(meet.reactions.at(-1)).toMatchObject({ emoji: '👍', name: 'You' });
  });
});

describe('what a role may do, with Host controls', () => {
  it('never limits the hosts, and keeps a running recording stoppable', () => {
    const off = { ...DEFAULT_ROOM_SETTINGS, microphone: false, camera: false, whiteboard: false, recording: false, transcription: false, record: 'hosts' } as RoomSettings;
    expect(may.microphone('participant', off)).toBe(false);
    expect(may.microphone('presenter', off)).toBe(false);
    expect(may.camera('cohost', off)).toBe(true);
    expect(may.draw('host', off)).toBe(true);
    expect(may.record('host', off)).toBe(false);
    expect(may.transcribe('host', off)).toBe(false);
    as('cohost', off);
    expect(meet.mayStopRecording).toBe(true);
    // An older server sends none of these: everything stays as it was.
    const { microphone: _a, camera: _b, recording: _c, ...old } = DEFAULT_ROOM_SETTINGS;
    expect(may.microphone('participant', old)).toBe(true);
    expect(may.record('host', old)).toBe(true);
  });
});
