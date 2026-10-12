// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('livekit-client', () => ({ Room: class {}, RoomEvent: {}, Track: { Source: {}, Kind: {} }, VideoPresets: { h720: {} }, DisconnectReason: {}, createLocalTracks: vi.fn() }));
const bridge = vi.hoisted(() => ({ call: vi.fn(), listeners: [] as Array<(e: unknown) => void> }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: (_c: string, fn: (e: unknown) => void) => {
    bridge.listeners.push(fn);
    return () => undefined;
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/avatars', () => ({ useUserAvatar: () => null }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), ringVolume: () => 1 }));
const query = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: query.value, path: [], go: vi.fn() }), useTabTitle: vi.fn() }));
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

import { MeetRingScreen } from '../../../src/modules/meet/MeetRingScreen';
import { AddPeopleDialog, Invitations } from '../../../src/modules/meet/InvitePeople';
import { meet } from '../../../src/modules/meet/session';

const UUID = '3f0c9a8e-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  bridge.call.mockReset().mockResolvedValue(undefined);
  bridge.listeners.length = 0;
  meet.uuid = UUID;
});
afterEach(cleanup);

describe('being rung into a meeting', () => {
  beforeEach(() => {
    query.value = new URLSearchParams({ ring: '31', uuid: UUID, name: 'Kumari', title: 'Design review', silent: '0', expires: '40' });
  });

  it('says who invites you to what, and accepting opens the meeting with nothing switched on', async () => {
    api.apiPost.mockResolvedValue({ state: 'accepted', uuid: UUID, title: 'Design review' });
    render(<MeetRingScreen />);
    expect(screen.getByText('Kumari')).toBeTruthy();
    expect(screen.getByText(/invites you to join “Design review”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('windows:open', expect.objectContaining({ kind: 'meet', route: `/meet/${UUID}?quiet=1` })));
    expect(api.apiPost).toHaveBeenCalledWith('/api/meet/rings/31/answer', { answer: 'accept', event: 'ring.accepted' });
    expect(bridge.call).toHaveBeenCalledWith('windows:close');
  });

  it('declining opens nothing', async () => {
    api.apiPost.mockResolvedValue({ state: 'declined', uuid: UUID });
    render(<MeetRingScreen />);
    fireEvent.click(screen.getByRole('button', { name: /^Decline$/ }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('windows:close'));
    expect(bridge.call).not.toHaveBeenCalledWith('windows:open', expect.anything());
  });

  it('stops when the invitation is answered on another device or cancelled', () => {
    render(<MeetRingScreen />);
    for (const fn of bridge.listeners) fn({ type: 'meet.ring.stopped', ring_id: 30 });
    expect(bridge.call).not.toHaveBeenCalledWith('windows:close');
    for (const fn of bridge.listeners) fn({ type: 'meet.ring.stopped', ring_id: 31 });
    expect(bridge.call).toHaveBeenCalledWith('windows:close');
  });

  // worksuite-desktop#347: every answer is the server's to record, naming this ring.
  it('stops on every device when the host cancels', () => {
    render(<MeetRingScreen />);
    for (const fn of bridge.listeners) fn({ type: 'meeting.invite_state_changed', meeting: UUID, invitee_id: 7, ring_id: 31, invite_state: 'ringing' });
    expect(bridge.call).not.toHaveBeenCalledWith('windows:close');
    for (const fn of bridge.listeners) fn({ type: 'meeting.invite_state_changed', meeting: UUID, invitee_id: 7, ring_id: 30, invite_state: 'cancelled' });
    expect(bridge.call).not.toHaveBeenCalledWith('windows:close');
    for (const fn of bridge.listeners) fn({ type: 'meeting.invite_state_changed', meeting: UUID, invitee_id: 7, ring_id: 31, invite_state: 'cancelled' });
    expect(bridge.call).toHaveBeenCalledWith('windows:close');
  });

  it('declines with a message the person inviting sees', async () => {
    api.apiPost.mockResolvedValue({ state: 'declined', uuid: UUID });
    render(<MeetRingScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Decline with a message' }));
    fireEvent.click(screen.getByRole('button', { name: 'In another meeting' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('windows:close'));
    expect(api.apiPost).toHaveBeenCalledWith('/api/meet/rings/31/answer', { answer: 'decline', event: 'ring.declined', reason: 'In another meeting' });
  });

  it('Not now tells the server, so the host sees Didn’t answer at once, and closes even when that fails', async () => {
    api.apiPost.mockRejectedValue(new Error('offline'));
    render(<MeetRingScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('windows:close'));
    expect(api.apiPost).toHaveBeenCalledWith('/api/meet/rings/31/answer', { answer: 'dismiss', event: 'ring.dismissed' });
  });
});

describe('inviting people into the meeting', () => {
  it('shows each invitation’s state, with Cancel while it rings and Ring again after the wait', async () => {
    meet.info = { room_settings: { invite: 'everyone' } } as never;
    api.apiGet.mockResolvedValue({
      rings: [
        { id: 1, user_id: 5, name: 'Nimal', state: 'ringing', invited_by: { id: 1, name: 'Me' }, rang_at: '', retry_in: 0 },
        { id: 2, user_id: 6, name: 'Kamal', state: 'declined', invited_by: { id: 1, name: 'Me' }, rang_at: '', retry_in: 12 },
        { id: 3, user_id: 7, name: 'Saman', state: 'unavailable', invited_by: { id: 1, name: 'Me' }, rang_at: '', retry_in: 0 },
        { id: 4, user_id: 8, name: 'Ruwan', state: 'joined', invited_by: { id: 1, name: 'Me' }, rang_at: '', retry_in: 0 },
      ],
    });
    api.apiDelete.mockResolvedValue(null);
    wrap(<Invitations />);
    expect(await screen.findByText('Ringing…')).toBeTruthy();
    expect(screen.getByText('Declined')).toBeTruthy();
    expect(screen.getByText('Offline · invite sent by notification')).toBeTruthy();
    expect(screen.queryByText('Ruwan')).toBeNull();
    const again = screen.getAllByRole('button', { name: 'Ring again' });
    expect(again).toHaveLength(1);
    expect((again[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(api.apiDelete).toHaveBeenCalledWith(`/api/meet/${UUID}/rings/1`));
  });

  // worksuite-desktop#347: what the host sees follows what actually happened.
  it('shows Declined with their reason, Didn’t answer and Couldn’t join, each with Ring again; never Accepted while it rings', async () => {
    meet.info = { room_settings: { invite: 'everyone' }, join_url: 'https://x/meet/a' } as never;
    const row = { invited_by: { id: 1, name: 'Me' }, rang_at: '', retry_in: 0 };
    api.apiGet.mockResolvedValue({
      rings: [
        { id: 11, ring_id: 11, user_id: 5, name: 'Dimuthu', state: 'declined', invite_state: 'declined', reason: 'In another meeting', ...row },
        { id: 12, ring_id: 12, user_id: 6, name: 'Kamal', state: 'no_answer', invite_state: 'no_answer', ...row },
        { id: 13, ring_id: 13, user_id: 7, name: 'Saman', state: 'no_answer', invite_state: 'failed', ...row },
        { id: 14, ring_id: 14, user_id: 8, name: 'Nimal', state: 'ringing', invite_state: 'ringing', ...row },
        { id: 15, ring_id: 15, user_id: 9, name: 'Ruwan', state: 'accepted', invite_state: 'joining', ...row },
        { id: 16, ring_id: 16, user_id: 10, name: 'Amal', state: 'unavailable', invite_state: 'busy', ...row },
      ],
    });
    api.apiDelete.mockResolvedValue(null);
    api.apiPost.mockResolvedValue({ rings: [{ user_id: 6, ring_id: 17, state: 'ringing', invite_state: 'ringing' }] });
    wrap(<Invitations />);
    expect(await screen.findByText('Declined · In another meeting')).toBeTruthy();
    expect(screen.getByText('Didn’t answer')).toBeTruthy();
    expect(screen.getByText('Couldn’t join')).toBeTruthy();
    expect(screen.getByText('Joining…')).toBeTruthy();
    expect(screen.getByText('Busy in another call')).toBeTruthy();
    expect(screen.queryByText(/Accepted/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Ring again' })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Message' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ring again' })[1]!);
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith(`/api/meet/${UUID}/ring`, { user_ids: [6] }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    await waitFor(() => expect(api.apiDelete).toHaveBeenCalledWith(`/api/meet/${UUID}/invitees/5`));
  });

  it('picks several people, never someone already in the meeting, and rings them', async () => {
    api.apiGet.mockResolvedValue({
      users: [
        { id: 5, name: 'Nimal Perera', email: 'n@x.lk', avatar: null, status: 'online', in_call: false, pending: null },
        { id: 6, name: 'Kamal Silva', email: 'k@x.lk', avatar: null, status: 'offline', in_call: false, pending: null },
        { id: 7, name: 'Saman', email: null, avatar: null, status: 'online', in_call: true, pending: null },
      ],
    });
    api.apiPost.mockResolvedValue({ rings: [{ user_id: 5, state: 'ringing' }, { user_id: 6, state: 'unavailable' }] });
    const onClose = vi.fn();
    wrap(<AddPeopleDialog onClose={onClose} />);
    const nimal = await screen.findByRole('checkbox', { name: /Nimal Perera, Available/ });
    expect((screen.getByRole('checkbox', { name: /Saman/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('In the meeting')).toBeTruthy();
    fireEvent.click(nimal);
    fireEvent.click(screen.getByRole('checkbox', { name: /Kamal Silva, Offline/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search people' }), { target: { value: 'kamal' } });
    expect(screen.queryByText('Nimal Perera')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Invite & Ring/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.apiPost).toHaveBeenCalledWith(`/api/meet/${UUID}/ring`, { user_ids: [5, 6] });
  });
});
