// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * A Meet meeting's card in a conversation (worksuite-desktop#71): its name, who started it and when, live or ended,
 * and one action — Join, Return to meeting, or View details.
 */
const listeners = new Map<string, (v: unknown) => void>();
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: (channel: string, fn: (v: unknown) => void) => {
    listeners.set(channel, fn);
    return () => listeners.delete(channel);
  },
  hasDesktop: () => true,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  platform: 'linux',
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { apiGet } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { MeetingCard, meetingCardState } = await import('../../../src/modules/chat/MeetingCard');
type Message = Parameters<typeof MeetingCard>[0]['m'];

const UUID = 'b5d1c8e2-4f7a-4c1e-9a3b-2e6f8d0c1a77';
const message = (over: Partial<Message> = {}): Message => ({
  id: 7,
  room_id: 3,
  sender_id: 2,
  sender_name: 'Nimal Perera',
  type: 'call',
  message: null,
  file: null,
  reactions: [],
  reply_preview: null,
  edited: false,
  deleted: false,
  receipt: null,
  client_message_id: null,
  call_uuid: UUID,
  call_kind: 'meeting',
  call_state: 'live',
  call_mode: 'video',
  call_title: 'Weekly design review',
  call_started_at: '2026-09-30 09:00:00',
  created_at: '2026-09-30 08:59:00',
  ...over,
});

function show(m: Message, own = false, compact = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MeetingCard m={m} own={own} roomId="3" compact={compact} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listeners.clear();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  vi.mocked(apiGet).mockReset();
  vi.mocked(toast).mockReset();
});
afterEach(cleanup);

describe('the card’s state', () => {
  it('offers Join to a live meeting, Return when this computer is in it, details once ended, and nothing once removed', () => {
    expect(meetingCardState({ call_state: 'live' }, false)).toEqual({ status: 'live', action: 'join' });
    expect(meetingCardState({ call_state: 'live' }, true)).toEqual({ status: 'live', action: 'return' });
    expect(meetingCardState({ call_state: 'ended' }, false)).toEqual({ status: 'ended', action: 'details' });
    expect(meetingCardState({ call_state: 'ended' }, true)).toEqual({ status: 'ended', action: 'details' });
    expect(meetingCardState({ call_state: 'gone' }, false)).toEqual({ status: 'removed', action: null });
  });
});

describe('the meeting card', () => {
  it('shows the meeting’s name, who started it and when, and that it is live', () => {
    show(message());
    const card = screen.getByRole('article', { name: /Weekly design review — Live/ });
    expect(card.textContent).toContain('Weekly design review');
    expect(card.textContent).toContain('Started by Nimal Perera');
    expect(card.textContent).toContain('Live');
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
  });

  it('says “Started by you” on your own, and falls back to “Meeting” with no name', () => {
    show(message({ call_title: '  ' }), true);
    expect(screen.getByRole('article').textContent).toContain('Started by you');
    expect(screen.getByRole('article').textContent).toContain('Meeting');
  });

  it('joins in the meeting’s window, showing that it is joining and not sending twice', async () => {
    let done: () => void = () => undefined;
    vi.mocked(call).mockImplementation(((channel: string) => (channel === 'windows:open' ? new Promise<void>((r) => (done = r)) : Promise.resolve([]))) as never);
    show(message());
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    const busy = await screen.findByRole('button', { name: /Joining/ });
    expect(busy.hasAttribute('disabled')).toBe(true);
    fireEvent.click(busy);
    expect(vi.mocked(call).mock.calls.filter(([c]) => c === 'windows:open')).toHaveLength(1);
    expect(vi.mocked(call)).toHaveBeenCalledWith('windows:open', expect.objectContaining({ kind: 'meet', route: `/meet/${UUID}`, title: 'Weekly design review' }));
    await act(async () => done());
    expect(await screen.findByRole('button', { name: 'Join' })).toBeTruthy();
  });

  it('says what went wrong when the meeting cannot be opened', async () => {
    vi.mocked(call).mockImplementation(((channel: string) => (channel === 'windows:open' ? Promise.reject(new Error('No window')) : Promise.resolve([]))) as never);
    show(message());
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'No window'));
  });

  it('offers Return to meeting when this computer is already in it, and follows the calls as they change', async () => {
    vi.mocked(call).mockImplementation(((channel: string) => Promise.resolve(channel === 'calls:list' ? [{ windowId: 4, uuid: UUID, kind: 'meet', title: 'Weekly design review', since: 1 }] : null)) as never);
    show(message());
    expect(await screen.findByRole('button', { name: 'Return to meeting' })).toBeTruthy();
    act(() => listeners.get('calls:changed')?.([]));
    expect(await screen.findByRole('button', { name: 'Join' })).toBeTruthy();
    act(() => listeners.get('calls:changed')?.([{ windowId: 5, uuid: 'another', kind: 'meet', title: 'x', since: 1 }]));
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
  });

  it('once ended, offers View details: when it started, how long it ran, who was in it and its recording', async () => {
    vi.mocked(apiGet).mockResolvedValue([
      { uuid: 'other', kind: 'meeting', created_at: '2026-09-29 10:00:00', duration: 60, participants: [], recording: null },
      { uuid: UUID, kind: 'meeting', created_at: '2026-09-30 09:00:00', duration: 45 * 60, participants: ['Nimal Perera', { name: 'Ayesha Silva' }], recording: { id: 9, title: 'Weekly design review', ready: true } },
    ] as never);
    show(message({ call_state: 'ended' }));
    expect(screen.getByRole('article', { name: /Ended/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('Nimal Perera, Ayesha Silva'));
    expect(dialog.textContent).toContain('Meeting details');
    expect(dialog.textContent).toContain('45 min');
    expect(dialog.textContent).toContain('Recorded — in Meet → Recordings');
    expect(apiGet).toHaveBeenCalledWith('/api/chat/rooms/3/calls', undefined, expect.anything());
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('leaves out a length no meeting could have run, and says so when its details are gone', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce([{ uuid: UUID, kind: 'meeting', created_at: '2026-09-01 09:00:00', duration: 30 * 24 * 3600, participants: [], recording: null }] as never);
    show(message({ call_state: 'ended' }));
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('Started'));
    expect(dialog.textContent).not.toContain('Length');
    cleanup();

    vi.mocked(apiGet).mockResolvedValueOnce([] as never);
    show(message({ call_state: 'ended' }));
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(await screen.findByText('The details of this meeting are no longer available.')).toBeTruthy();
  });

  it('shows a removed meeting with no action', () => {
    show(message({ call_state: 'gone' }));
    expect(screen.getByRole('article', { name: /Removed/ })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('cuts a long name short, with the whole of it on hover', () => {
    const long = 'Quarterly planning for the finance, operations and people teams across all of our offices';
    show(message({ call_title: long }));
    const name = screen.getByText(long);
    expect(name.getAttribute('title')).toBe(long);
    expect(name.className).toContain('truncate');
  });

  it('is smaller in the chat drawer', () => {
    show(message(), false, true);
    expect(screen.getByRole('article').className).toContain('max-w-[340px]');
    cleanup();
    show(message());
    expect(screen.getByRole('article').className).toContain('max-w-[440px]');
  });
});
