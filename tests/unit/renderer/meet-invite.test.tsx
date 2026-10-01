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
    expect(api.apiPost).toHaveBeenCalledWith('/api/meet/rings/31/answer', { answer: 'accept' });
    expect(bridge.call).toHaveBeenCalledWith('windows:close');
  });

  it('declining opens nothing', async () => {
    api.apiPost.mockResolvedValue({ state: 'declined', uuid: UUID });
    render(<MeetRingScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Decline/ }));
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
    expect(screen.getByText(/Unavailable/)).toBeTruthy();
    expect(screen.queryByText('Ruwan')).toBeNull();
    const again = screen.getAllByRole('button', { name: 'Ring again' });
    expect((again[0] as HTMLButtonElement).disabled).toBe(true);
    expect((again[1] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(api.apiDelete).toHaveBeenCalledWith(`/api/meet/${UUID}/rings/1`));
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
