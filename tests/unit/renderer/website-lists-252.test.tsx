// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Website chats are slow (worksuite-desktop#252: "about 20 s to load lists and respond").
 *
 * - Closed is read a page of 50 list rows at a time, with the server's cursor, never as 200 whole rows every 15 s;
 *   pages join into one list with each chat once.
 * - Every list opens at once from the copy saved on this computer, while the server is asked.
 * - A reply shows the moment Send is pressed ("Sending…") and becomes the stored message as soon as the server has it,
 *   asking again only for its thread and the open list.
 * - Each list, thread and reply is timed (request, server, rows, render) for Help › Diagnostics.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { CLOSED_PAGE, longestWaiting, sendingReplies, startWebsiteReply, useSendingReplies, useWebsiteClosed, useWebsiteInbox, waitingSummary, type WebsiteConversation, type WebsiteRow } from '../../../src/modules/chat/website/api';
import { recentTimings, renderedAfter, resetTimings, timed } from '../../../src/modules/chat/website/timings';

const LIST = '/api/chat/widget-admin/conversations';
const row = (id: number, over: Partial<WebsiteRow> = {}): WebsiteRow =>
  ({ id, widget_id: 1, site: 'worksuite.lk', label: `Visitor ${id}`, visitor_name: null, status: 'closed', closed_at: `2026-10-0${1 + (id % 5)} 10:00:00`, rating: null, ...over }) as WebsiteRow;
/** 120 closed chats, newest first, served 50 at a time with a cursor that is the last id. */
const CLOSED = Array.from({ length: 120 }, (_, i) => row(120 - i));
const page = (cursor: string | undefined) => {
  const from = cursor ? CLOSED.findIndex((r) => r.id === Number(cursor)) + 1 : 0;
  const rows = CLOSED.slice(from, from + CLOSED_PAGE);
  const more = from + CLOSED_PAGE < CLOSED.length;
  return { conversations: rows, can: { view: true, reply: true, manage: false }, has_more: more, next_cursor: more ? String(rows.at(-1)!.id) : null, timing: { ms: 40, db_ms: 12, queries: 7, rows: rows.length } };
};

let saved: Record<string, unknown> = {};
let hang = false;

beforeEach(() => {
  saved = {};
  hang = false;
  resetTimings();
  sendingReplies.set({ list: [] });
  vi.mocked(call).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string, params?: Record<string, string>) => {
    if (hang) return new Promise(() => undefined);
    if (path === LIST && params?.status === 'closed') return page(params.cursor);
    if (path === LIST) return { conversations: [row(7, { status: 'open', closed_at: null })], can: { view: true } };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(request).mockReset().mockImplementation((async (_m: string, path: string, opts?: { query?: Record<string, string>; headers?: Record<string, string> }) => {
    const key = `${path}?${new URLSearchParams(opts?.query ?? {}).toString()}`;
    if (opts?.headers?.['X-WS-Local-Read'] === '1' && saved[key]) return { data: saved[key] };
    throw new ApiError(404, 'No saved conversation.', null);
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = (qc: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

describe('Closed, a page at a time (#252)', () => {
  it('asks for 50 list rows, then the next page with the server\'s cursor, and joins them with each chat once', async () => {
    const { result } = renderHook(() => useWebsiteClosed(true), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data?.conversations).toHaveLength(50));
    expect(apiGet).toHaveBeenCalledWith(LIST, { status: 'closed', fields: 'list', limit: '50' }, expect.anything());
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data?.conversations).toHaveLength(100));
    expect(apiGet).toHaveBeenLastCalledWith(LIST, { status: 'closed', fields: 'list', limit: '50', cursor: '71' }, expect.anything());

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data?.conversations).toHaveLength(120));
    expect(result.current.hasMore).toBe(false);
    const ids = result.current.data!.conversations.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(120);
    // Nothing more to ask for: loading more at the end asks nothing.
    const asked = vi.mocked(apiGet).mock.calls.length;
    act(() => result.current.loadMore());
    expect(vi.mocked(apiGet).mock.calls.length).toBe(asked);
  });

  it('a chat on two pages (closed while paging) is listed once', async () => {
    vi.mocked(apiGet).mockImplementation((async (_p: string, params?: Record<string, string>) =>
      params?.cursor ? { conversations: [row(3), row(2)], can: {}, has_more: false, next_cursor: null } : { conversations: [row(4), row(3)], can: {}, has_more: true, next_cursor: '3' }) as never);
    const { result } = renderHook(() => useWebsiteClosed(true), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data?.conversations.map((r) => r.id)).toEqual([4, 3, 2]));
  });

  it('asks nothing while the section is not showing', async () => {
    renderHook(() => useWebsiteClosed(false), { wrapper: wrapper(client()) });
    await new Promise((r) => setTimeout(r, 20));
    expect(apiGet).not.toHaveBeenCalled();
  });
});

describe('every list opens at once from its saved copy (#252)', () => {
  it('the open inbox shows what this computer saved while the server is asked', async () => {
    hang = true;
    saved[`${LIST}?`] = { conversations: [row(11, { status: 'open', visitor_name: 'Saved Sam' })], can: { view: true } };
    const { result } = renderHook(() => useWebsiteInbox(false), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data?.conversations[0]?.visitor_name).toBe('Saved Sam'));
    // Stamped 0: a saved copy, so the server's answer still replaces it.
    expect(result.current.dataUpdatedAt).toBe(0);
    expect(apiGet).toHaveBeenCalled();
  });

  it('Closed\'s first page too, from the copy saved for that same request', async () => {
    hang = true;
    saved[`${LIST}?status=closed&fields=list&limit=50`] = { conversations: [row(5, { visitor_name: 'Closed Carla' })], can: {}, has_more: true, next_cursor: '5' };
    const { result } = renderHook(() => useWebsiteClosed(true), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data?.conversations.map((r) => r.visitor_name)).toEqual(['Closed Carla']));
  });

  it('a saved copy that is not a list is not drawn', async () => {
    hang = true;
    saved[`${LIST}?`] = { status: 'ok' };
    const { result } = renderHook(() => useWebsiteInbox(false), { wrapper: wrapper(client()) });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.data).toBeUndefined();
  });

  it('the server\'s answer replaces the saved copy', async () => {
    saved[`${LIST}?`] = { conversations: [row(11, { status: 'open', visitor_name: 'Saved Sam' })], can: { view: true } };
    const { result } = renderHook(() => useWebsiteInbox(false), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data?.conversations.map((r) => r.id)).toEqual([7]));
  });
});

describe('a reply shows at once and is confirmed in place (#252)', () => {
  const thread = (): WebsiteConversation =>
    ({ conversation: { id: 41, status: 'open' }, visitor: { id: 9, label: 'Visitor 4F2A' }, messages: [{ id: 1, body: 'Is the licence yearly?', from: 'visitor', agent: null, at: '2026-10-05 09:00:00', file: null }], can: { reply: true } }) as unknown as WebsiteConversation;

  it('is "sending" the moment it is sent, then the stored message, and asks again only for its thread and the open list', async () => {
    app.set({ auth: { user: { id: '3' } }, bootstrap: { user: { name: 'Nuwan Silva' } } } as never);
    const qc = client();
    qc.setQueryData(['website', 'conversation', '41'], thread());
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSendingReplies(41), { wrapper: wrapper(qc) });

    let finish!: ReturnType<typeof startWebsiteReply>;
    act(() => {
      finish = startWebsiteReply(qc, 41, 'Yes, yearly.', 1);
    });
    expect(result.current.map((r) => r.body)).toEqual(['Yes, yearly.']);

    act(() => finish({ delivered: true, queued: false, data: { id: 77, at: '2026-10-05 09:01:00', timing: { ms: 30, db_ms: 8, queries: 15, rows: 1 } } }));
    expect(result.current).toEqual([]);
    const messages = qc.getQueryData<WebsiteConversation>(['website', 'conversation', '41'])!.messages;
    expect(messages.at(-1)).toMatchObject({ id: 77, body: 'Yes, yearly.', from: 'agent', agent: 'Nuwan Silva', agent_id: 3, reply_to: 1, at: '2026-10-05 09:01:00' });
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([['website', 'conversation', '41'], ['website', 'inbox', 'open']]);
    expect(recentTimings().find((t) => t.what === 'reply')?.server?.queries).toBe(15);

    // The poll that brings the same message back does not draw it twice.
    act(() => finish({ delivered: true, queued: false, data: { id: 77 } }));
    expect(qc.getQueryData<WebsiteConversation>(['website', 'conversation', '41'])!.messages.filter((m) => m.id === 77)).toHaveLength(1);
  });

  it('one refused, or gone to the outbox, leaves the "sending" list and adds nothing', () => {
    const qc = client();
    qc.setQueryData(['website', 'conversation', '41'], thread());
    const { result } = renderHook(() => useSendingReplies(41), { wrapper: wrapper(qc) });
    let a!: ReturnType<typeof startWebsiteReply>;
    let b!: ReturnType<typeof startWebsiteReply>;
    act(() => {
      a = startWebsiteReply(qc, 41, 'one');
      b = startWebsiteReply(qc, 41, 'two');
    });
    expect(result.current).toHaveLength(2);
    act(() => a({ delivered: false, queued: false }));
    act(() => b(null));
    expect(result.current).toEqual([]);
    expect(qc.getQueryData<WebsiteConversation>(['website', 'conversation', '41'])!.messages).toHaveLength(1);
  });

  it('only this conversation\'s are shown in it', () => {
    const qc = client();
    const { result } = renderHook(() => useSendingReplies(41), { wrapper: wrapper(qc) });
    act(() => void startWebsiteReply(qc, 42, 'elsewhere'));
    expect(result.current).toEqual([]);
  });
});

describe('timings for Help › Diagnostics (#252)', () => {
  it('records each request\'s time, rows and the server\'s own numbers, then the render, and hands them to the main process', async () => {
    vi.useFakeTimers();
    await timed('conversations:closed', async () => page(undefined), (d) => d.conversations.length);
    renderedAfter('conversations:closed');
    const [t] = recentTimings();
    expect(t).toMatchObject({ what: 'conversations:closed', rows: 50, ok: true, server: { ms: 40, db_ms: 12, queries: 7, rows: 50 } });
    expect(typeof t!.ms).toBe('number');
    expect(typeof t!.render_ms).toBe('number');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(call).toHaveBeenCalledWith('diagnostics:timings', { entries: [expect.objectContaining({ what: 'conversations:closed', rows: 50 })] });
  });

  it('a failed request is recorded as failed; a cancelled one is not recorded', async () => {
    await expect(timed('conversation', async () => { throw new ApiError(500, 'Boom', null); })).rejects.toThrow('Boom');
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(timed('conversation', async () => { throw abort; })).rejects.toThrow('aborted');
    expect(recentTimings().map((t) => [t.what, t.ok])).toEqual([['conversation', false]]);
  });

  it('the lists time their requests', async () => {
    const { result } = renderHook(() => useWebsiteClosed(true), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(recentTimings().find((t) => t.what === 'conversations:closed')).toMatchObject({ rows: 50, server: { queries: 7 } });
  });
});

describe('the rows of a long Closed list are drawn only where they show (#252)', () => {
  it('120 closed chats draw a screenful, not 120 rows', async () => {
    const { VirtualList } = await import('../../../src/components/VirtualList');
    // jsdom has no layout: give the scroller a 720px viewport.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 320, height: 720, top: 0, left: 0, right: 320, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    render(<VirtualList items={CLOSED} estimate={66} getKey={(r) => r.id} render={(r) => <div data-testid="closed-row">{r.label}</div>} />);
    const shown = screen.getAllByTestId('closed-row').length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(40);
  });
});

describe('"waiting" is a live chat waiting (#252)', () => {
  it('an offline enquiry still in its queue is not "1 visitor is waiting… waited 20 days"', () => {
    const now = Date.now();
    const at = (ms: number) => new Date(now - ms).toISOString();
    const enquiry = row(1, { status: 'pending', is_offline: true, awaiting_reply: true, waiting_since: at(20 * 86_400_000) });
    const live = row(2, { status: 'open', is_offline: false, awaiting_reply: true, waiting_since: at(3 * 60_000) });
    expect(waitingSummary([enquiry], now)).toBe('Nobody is waiting for a reply.');
    expect(longestWaiting([enquiry, live])?.id).toBe(2);
    expect(waitingSummary([enquiry, live], now)).toBe('1 visitor is waiting for a reply. They have waited 3 minutes.');
    // An enquiry the visitor came back to and wrote in while staff are online is a live chat again (C-05).
    expect(longestWaiting([{ ...enquiry, status: 'open' }])?.id).toBe(1);
  });
});
