// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The staff website thread on the Desktop (plan 1.9): replies through the outbox with a client id, Sending / Sent /
 * Not sent · Retry, the server's copy merged by seq; and the thread kept whole by `sync?after_seq=` on a gap, on focus
 * and after a reconnect, a repeated announcement costing nothing.
 */
const bus = vi.hoisted(() => ({ handlers: new Map<string, Set<(p: unknown) => void>>() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => undefined),
  on: (channel: string, cb: (p: unknown) => void) => {
    if (!bus.handlers.has(channel)) bus.handlers.set(channel, new Set());
    bus.handlers.get(channel)!.add(cb);
    return () => bus.handlers.get(channel)!.delete(cb);
  },
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { watchedBySeq } from '../../../shared/chat-seq';
import { retryWebsiteReply, sendingReplies, sendWebsiteReply, useSendingReplies, type WebsiteConversation } from '../../../src/modules/chat/website/api';
import { useWebsiteSync } from '../../../src/modules/chat/website/sync';

const KEY = ['website', 'conversation', '41'];
const emit = (channel: string, payload?: unknown) => act(() => bus.handlers.get(channel)?.forEach((h) => h(payload)));
const thread = (): WebsiteConversation =>
  ({
    conversation: { id: 41, status: 'open' },
    visitor: { id: 9, label: 'Visitor 4F2A' },
    messages: [
      { id: 1, seq: 1, body: 'Is the licence yearly?', from: 'visitor', agent: null, at: '2026-10-05 09:00:00', file: null },
      { id: 2, seq: 2, body: 'One moment', from: 'agent', agent: 'Nuwan', at: '2026-10-05 09:00:10', file: null, client_id: 'c-0' },
    ],
    last_seq: 2,
    can: { reply: true },
  }) as unknown as WebsiteConversation;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = (qc: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const syncCalls = () => vi.mocked(request).mock.calls.filter(([, path]) => path === '/api/chat/widget-admin/conversations/41/sync');

beforeEach(() => {
  bus.handlers.clear();
  sendingReplies.set({ list: [] });
  app.set({ auth: { user: { id: '3' } }, bootstrap: { user: { name: 'Nuwan Silva' } } } as never);
  vi.mocked(call).mockReset();
  vi.mocked(request).mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a reply through the outbox', () => {
  it('goes with a client id, and the stored message takes its place in seq order', async () => {
    const qc = client();
    qc.setQueryData(KEY, thread());
    vi.mocked(call).mockImplementation((async (_c: string, m: { body: { client_id: string } }) => ({ delivered: true, queued: false, id: null, status: 201, data: { id: 3, seq: 3, client_id: m.body.client_id, at: '2026-10-05 09:01:00', duplicate: false }, error: null, code: null })) as never);
    await act(() => sendWebsiteReply(qc, 41, 'Yes, yearly.', 1, 5).then(() => undefined));

    const sent = vi.mocked(call).mock.calls[0]![1] as { body: { client_id: string; canned_id: number; reply_to: number } };
    expect(sent.body).toMatchObject({ message: 'Yes, yearly.', reply_to: 1, canned_id: 5, client_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    const messages = qc.getQueryData<WebsiteConversation>(KEY)!.messages;
    expect(messages.map((m) => [m.id, m.seq])).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect(messages.at(-1)).toMatchObject({ client_id: sent.body.client_id, body: 'Yes, yearly.' });
    expect(sendingReplies.get().list).toEqual([]);
  });

  it('refused, says Not sent with the reason, and Retry sends it again under the same client id', async () => {
    const qc = client();
    qc.setQueryData(KEY, thread());
    const { result } = renderHook(() => useSendingReplies(41), { wrapper: wrapper(qc) });
    vi.mocked(call)
      .mockResolvedValueOnce({ delivered: false, queued: false, id: null, status: 422, data: null, error: 'This chat is closed.', code: 'SERVER_ERROR' } as never)
      .mockResolvedValueOnce({ delivered: true, queued: false, id: null, status: 200, data: { id: 3, seq: 3, duplicate: true }, error: null, code: null } as never);

    await act(() => sendWebsiteReply(qc, 41, 'Are you there?').then(() => undefined));
    expect(result.current).toEqual([expect.objectContaining({ state: 'failed', error: 'This chat is closed.', body: 'Are you there?' })]);

    await act(() => retryWebsiteReply(qc, result.current[0]!.key));
    const ids = vi.mocked(call).mock.calls.map(([, m]) => (m as { body: { client_id: string } }).body.client_id);
    expect(ids[0]).toBe(ids[1]);
    expect(result.current).toEqual([]);
    expect(qc.getQueryData<WebsiteConversation>(KEY)!.messages.filter((m) => m.id === 3)).toHaveLength(1);
  });

  it('offline, goes to the outbox on this computer and leaves the Sending list for its Pending line', async () => {
    const qc = client();
    vi.mocked(call).mockResolvedValueOnce({ delivered: false, queued: true, id: 'q1', status: null, data: null, error: null, code: null } as never);
    await act(() => sendWebsiteReply(qc, 41, 'Back soon').then(() => undefined));
    expect(sendingReplies.get().list).toEqual([]);
    expect((vi.mocked(call).mock.calls[0]![1] as { queueIfOffline: boolean }).queueIfOffline).toBe(true);
  });
});

describe('the thread kept whole by seq', () => {
  const mount = (qc = client()) => {
    qc.setQueryData(KEY, thread());
    const hook = renderHook(() => useWebsiteSync('41', qc.getQueryData(KEY), true), { wrapper: wrapper(qc) });
    return { qc, hook };
  };

  it('drops an announcement it already has, and fetches only what came after its cursor on a gap', async () => {
    const { qc } = mount();
    emit('realtime:event', { type: 'chat.widget.message', conversation_id: 41, seq: 2 });
    expect(syncCalls()).toHaveLength(0);

    vi.mocked(request).mockResolvedValueOnce({ data: { conversation_id: 41, status: 'open', last_seq: 4, has_more: false, cursor: '41.4.x', deleted: [], messages: [{ id: 3, seq: 3, body: 'Any news?', from: 'visitor' }, { id: 4, seq: 4, body: 'Hello?', from: 'visitor' }] }, offline: false, cachedAt: null } as never);
    emit('realtime:event', { type: 'chat.widget.message', conversation_id: 41, seq: 4 });
    await waitFor(() => expect(qc.getQueryData<WebsiteConversation>(KEY)!.messages).toHaveLength(4));
    expect(syncCalls()[0]![2]).toMatchObject({ query: { after_seq: 2 } });

    emit('realtime:event', { type: 'chat.widget.message', conversation_id: 41, seq: 4 });
    expect(syncCalls()).toHaveLength(1);
  });

  it('asks again on focus with its cursor, and a 304 changes nothing', async () => {
    const { qc } = mount();
    vi.mocked(request).mockResolvedValueOnce({ data: { conversation_id: 41, last_seq: 2, messages: [], deleted: [], has_more: false, cursor: '41.2.a' }, offline: false, cachedAt: null } as never);
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(syncCalls()).toHaveLength(1));

    vi.mocked(request).mockRejectedValueOnce(new ApiError(304, 'Not modified', null));
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(syncCalls()).toHaveLength(2));
    expect(syncCalls()[1]![2]).toMatchObject({ query: { after_seq: 2, cursor: '41.2.a' } });
    expect(qc.getQueryData<WebsiteConversation>(KEY)!.messages).toHaveLength(2);
  });

  it('asks again after a reconnect, and says it keeps this chat by seq while it is open', async () => {
    const { hook } = mount();
    expect(watchedBySeq('website:41')).toBe(true);
    vi.mocked(request).mockRejectedValue(new ApiError(304, 'Not modified', null));
    emit('realtime:resync');
    await waitFor(() => expect(syncCalls()).toHaveLength(1));
    hook.unmount();
    expect(watchedBySeq('website:41')).toBe(false);
  });

  it('on a server without sync, reads the thread again instead', async () => {
    const { qc } = mount();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    vi.mocked(request).mockRejectedValue(new ApiError(404, 'Not found', null));
    emit('realtime:event', { type: 'chat.widget.message', conversation_id: 41, seq: 3 });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY }));
  });
});
