// @vitest-environment jsdom
import type { EventEmitter } from 'node:events';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn(), devices: vi.fn(), rooms: [] as unknown[] }));
vi.mock('../../../src/core/bridge', () => ({ call: mocks.call, errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/modules/meet/devices', () => ({
  useMeetDevices: mocks.devices,
  Preview: () => <p>Camera preview</p>,
  DeviceSettings: () => <p>Microphone level · Test speaker</p>,
}));
vi.mock('livekit-client', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeRoom extends Emitter {
    localParticipant = { identity: 'g-visitor', name: 'Visitor', isLocal: true, metadata: JSON.stringify({ waiting: true, door: 'waiting_room' }), permissions: { canPublish: false, canPublishData: false, canPublishSources: [] as number[] }, trackPublications: new Map(), setMicrophoneEnabled: vi.fn(), setCameraEnabled: vi.fn(), setScreenShareEnabled: vi.fn(), isMicrophoneEnabled: false, isCameraEnabled: false };
    remoteParticipants = new Map();
    options: unknown;
    constructor(options: unknown) { super(); this.options = options; mocks.rooms.push(this); }
    connect = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => { this.emit('disconnected', 1); });
  }
  return { Room: FakeRoom, RoomEvent: { ParticipantPermissionsChanged: 'permission', ParticipantMetadataChanged: 'metadata', ParticipantConnected: 'connected', ParticipantDisconnected: 'left', TrackSubscribed: 'track', TrackUnsubscribed: 'untrack', LocalTrackPublished: 'published', LocalTrackUnpublished: 'unpublished', TrackMuted: 'muted', TrackUnmuted: 'unmuted', Reconnecting: 'reconnecting', Reconnected: 'reconnected', Disconnected: 'disconnected', DataReceived: 'data' }, DisconnectReason: { ROOM_DELETED: 2, PARTICIPANT_REMOVED: 3 }, Track: { Kind: { Audio: 'audio' } } };
});
import { GuestMeeting } from '../../../src/modules/meet/GuestMeeting';
import { GuestJoinForm } from '../../../src/modules/meet/GuestJoinForm';
const INFO = { uuid: '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1b', origin: 'https://example.test', title: 'Planning', host_name: 'Host', ended: false, locked: false, needs_passcode: true, guests: true, chat: 'everyone' };
type Fake = EventEmitter & { localParticipant: { metadata: string; permissions: { canPublish: boolean; canPublishData: boolean }; setMicrophoneEnabled: ReturnType<typeof vi.fn>; setCameraEnabled: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; options: unknown };
describe('guest meeting screens', () => {
  beforeEach(() => {
    mocks.rooms.length = 0; mocks.call.mockReset(); mocks.devices.mockReset();
    mocks.devices.mockReturnValue({ prefs: { mic: true, cam: false, micId: 'mic', camId: 'cam', speakerId: 'speaker' } });
    mocks.call.mockImplementation(async (ch: string) => ch === 'guest:info' ? INFO : ch === 'guest:join' ? { token: 'scoped-token', url: 'wss://media.test', identity: 'g-visitor', door: 'waiting_room' } : undefined);
  });
  afterEach(cleanup);
  it('keeps a signed-out deep-link destination in the join form without signing in', async () => {
    render(<GuestJoinForm initialInput={INFO.uuid} server={INFO.origin} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith('guest:open', { input: INFO.uuid, server: INFO.origin }));
    expect(mocks.call.mock.calls.some(([ch]) => ch.startsWith('auth:'))).toBe(false);
  });
  it('previews devices and waits for admission before publishing; reconnects and leaves without an account', async () => {
    render(<GuestMeeting />);
    expect(await screen.findByText('Camera preview')).toBeTruthy();
    expect(screen.getByText('Microphone level · Test speaker')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your display name'), { target: { value: 'Visitor' } });
    fireEvent.change(screen.getByLabelText('Passcode'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join as Guest' }));
    expect(await screen.findByText(/Waiting for the host to let you in/)).toBeTruthy();
    expect(mocks.call).toHaveBeenCalledWith('guest:join', { name: 'Visitor', pass: '1234' });
    const room = mocks.rooms[0] as Fake;
    expect(room.options).toMatchObject({ audioOutput: { deviceId: 'speaker' } });
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    act(() => {
      room.localParticipant.metadata = JSON.stringify({ waiting: false });
      room.localParticipant.permissions.canPublish = true;
      room.localParticipant.permissions.canPublishData = true;
      room.emit('permission', null, room.localParticipant);
    });
    expect(await screen.findByText('People')).toBeTruthy();
    await waitFor(() => expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true));
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(false);
    expect(screen.getAllByText('Visitor · Guest').length).toBeGreaterThan(0);
    act(() => { room.emit('reconnecting'); });
    expect(screen.getByText(/Reconnecting…/)).toBeTruthy();
    act(() => { room.emit('reconnected'); room.emit('permission', null, room.localParticipant); });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Leave meeting' }));
    expect(await screen.findByText('You left the meeting.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejoin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join Another Meeting' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
    expect(mocks.call.mock.calls.some(([ch]) => ch.startsWith('auth:') || ch.startsWith('ai:') || ch.startsWith('session:'))).toBe(false);
  });
  it('shows ended meetings and does not offer Rejoin', async () => {
    mocks.call.mockResolvedValue({ ...INFO, ended: true });
    render(<GuestMeeting />);
    expect(await screen.findByText('This meeting has ended.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rejoin' })).toBeNull();
  });
});
