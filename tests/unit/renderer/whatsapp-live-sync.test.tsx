// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * WhatsApp kept in step without reloading (Whatsapp 1.6.0): pushed changes refresh a conversation at once, a loaded
 * conversation asks only for what changed, older messages load a page at a time, and a message shows the moment it is
 * sent and can be retried without being sent twice.
 */
const tab = { route: '/chat?channel=whatsapp&wa=7', go: vi.fn() };
const pushes: Array<(e: unknown) => void> = [];
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: (channel: string, fn: (e: unknown) => void) => { if (channel === 'realtime:event') pushes.push(fn); return () => { pushes.splice(pushes.indexOf(fn), 1); }; },
  hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/access', async (orig) => ({ ...(await orig<object>()), useCanOpen: () => true }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go };
  },
  useTabTitle: () => undefined,
}));

import { mergeWaThread, trimWaThread } from '../../../shared/wa-thread';
import { apiGet, apiPost } from '../../../src/core/api';
import { WhatsappChannel } from '../../../src/modules/chat/channels/WhatsappChannel';
import { fetchWaThread, sendWaNow, useWaLive, type WaAccount, type WaChat, type WaMessage, type WaThread } from '../../../src/modules/chat/channels/whatsapp';

const account: WaAccount = { id: 1, name: 'Sales', provider: 'web_js', phone: '94771234567', status: 'connected', status_note: null, is_default: true, can_send: true, can_connect: true, unread: 0 };
const chat = {
  id: 7, account_id: 1, kind: 'direct', name: 'Kasun', phone: '+94767793692', wa_id: '94767793692', status: 'open', unread: 0, is_pinned: 0, is_muted: 0,
  last_message: 'hello', last_message_at: '2026-09-30 09:00:00', last_direction: 'in', awaiting_since: null, waiting_minutes: null, overdue: false, account_name: 'Sales', assigned_name: null,
} as unknown as WaChat;
const base = { caption: null, status: null, error_text: null, sender_name: null, filename: null, sent_at: null, created_at: '2026-09-30 09:00:00', direction: 'in' as const, kind: 'text' };
const msg = (id: number, body: string, extra: Partial<WaMessage> = {}): WaMessage => ({ ...base, id, external_id: `w${id}`, body, ...extra });
const thread = (messages: WaMessage[], extra: Partial<WaThread> = {}): WaThread => ({ chat: { ...chat, window: { allowed: true, reason: null }, account } as unknown as WaThread['chat'], has_more: false, can_send: true, messages, cursor: '2026-10-08 10:00:00', ...extra });

beforeEach(() => {
  localStorage.clear();
  pushes.length = 0;
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiGet).mockReset();
});
afterEach(() => cleanup());

describe('merging what changed', () => {
  it('replaces changed messages, adds new ones and keeps older pages', () => {
    const held = thread([msg(5, 'old'), msg(6, 'hello', { status: 'sent' })], { has_more: true, next_before: 5 });
    const merged = mergeWaThread(held, thread([msg(6, 'hello', { status: 'read' }), msg(7, 'new')], { delta: true, has_more: false, next_before: null }));
    expect(merged.messages.map((m) => [m.id, m.status ?? null])).toEqual([[5, null], [6, 'read'], [7, null]]);
    expect(merged.has_more).toBe(true);
    expect(merged.next_before).toBe(5);
  });

  it('swaps the copy being sent for the server one with the same client id, and keeps the saved copy short', () => {
    const held = thread([msg(1, 'a'), { ...msg(-1, 'mine'), client_message_id: 'c1', status: 'queued' }]);
    const merged = mergeWaThread(held, thread([msg(2, 'mine', { client_message_id: 'c1', status: 'sent' })], { delta: true }));
    expect(merged.messages.map((m) => m.id)).toEqual([1, 2]);
    const long = trimWaThread(thread(Array.from({ length: 5 }, (_, i) => msg(i + 1, `m${i}`))), 3);
    expect(long.messages.map((m) => m.id)).toEqual([3, 4, 5]);
    expect(long.next_before).toBe(3);
    expect(long.has_more).toBe(true);
  });

  it('asks a loaded conversation only for what changed since its cursor', async () => {
    vi.mocked(apiGet).mockResolvedValue(thread([msg(3, 'new')], { delta: true, cursor: '2026-10-08 10:01:00' }) as never);
    const next = await fetchWaThread('7', thread([msg(1, 'a'), msg(2, 'b')]));
    expect(apiGet).toHaveBeenCalledWith('/api/whatsapp/chats/7', { since: '2026-10-08 10:00:00' }, undefined);
    expect(next.messages.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(next.cursor).toBe('2026-10-08 10:01:00');
  });
});

describe('sending', () => {
  it('shows the message at once, then the server copy', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['whatsapp', 'chat', '7', { scope: 'x' }], thread([msg(1, 'hi')]));
    let land!: (v: unknown) => void;
    vi.mocked(apiPost).mockReturnValue(new Promise((r) => { land = r; }) as never);
    const sent = sendWaNow(qc, 7, 'On my way', undefined, 'Hasarinda', 'c-1');
    await waitFor(() => expect(qc.getQueryData<WaThread>(['whatsapp', 'chat', '7', { scope: 'x' }])!.messages.at(-1)).toMatchObject({ body: 'On my way', status: 'queued', client_message_id: 'c-1' }));
    expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/chats/7/messages', { kind: 'text', text: 'On my way', client_message_id: 'c-1' });
    land({ ok: true, message: msg(2, 'On my way', { direction: 'out', status: 'sent' }) });
    expect(await sent).toBe(true);
    expect(qc.getQueryData<WaThread>(['whatsapp', 'chat', '7', { scope: 'x' }])!.messages.map((m) => [m.id, m.status])).toEqual([[1, null], [2, 'sent']]);
  });

  it('keeps a message that was not sent, and retries it with the same id', async () => {
    const qc = new QueryClient();
    const key = ['whatsapp', 'chat', '7', { scope: 'x' }];
    qc.setQueryData(key, thread([]));
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('No connection'));
    expect(await sendWaNow(qc, 7, 'Hello', undefined, null, 'c-2')).toBe(false);
    expect(qc.getQueryData<WaThread>(key)!.messages).toMatchObject([{ status: 'failed', error_text: 'No connection', client_message_id: 'c-2' }]);
    vi.mocked(apiPost).mockResolvedValueOnce({ ok: true, duplicate: true, message: msg(9, 'Hello', { direction: 'out', status: 'sent' }) } as never);
    expect(await sendWaNow(qc, 7, 'Hello', undefined, null, 'c-2')).toBe(true);
    expect(vi.mocked(apiPost).mock.calls.map((c) => (c[1] as { client_message_id: string }).client_message_id)).toEqual(['c-2', 'c-2']);
    expect(qc.getQueryData<WaThread>(key)!.messages.map((m) => m.id)).toEqual([9]);
  });
});

describe('live and older messages', () => {
  it('refreshes a conversation the moment a change for it is pushed', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(() => useWaLive(true), { wrapper });
    pushes.forEach((fn) => fn({ type: 'whatsapp', event: 'whatsapp.message.received', account_id: 1, chat_id: 7 }));
    pushes.forEach((fn) => fn({ type: 'chat.message', room_id: 7 }));
    pushes.forEach((fn) => fn({ type: 'whatsapp', event: 'whatsapp.connection.reconnecting', account_id: 1 }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['whatsapp', 'chat', '7'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['whatsapp', 'accounts'] });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('loads earlier messages in front of the conversation', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string, params?: Record<string, string>) => {
      if (path === '/api/whatsapp/chats') return { chats: [chat], total: 1 };
      if (path === '/api/contacts/phone-index') return { region: 'LK', contacts: [] };
      if (path === '/api/whatsapp/settings') return { settings: {}, can_edit: false };
      if (path === '/api/whatsapp/chats/7/profile') return { available: false };
      if (path === '/api/whatsapp/chats/7' && params?.before === '10') return thread([msg(8, 'Earliest hello')], { has_more: false, next_before: null });
      if (path === '/api/whatsapp/chats/7') return thread([msg(10, 'Latest')], { has_more: true, next_before: 10 });
      throw new Error(`unexpected ${path}`);
    }) as never);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WhatsappChannel accounts={[account]} loading={false} error={null} retry={() => undefined} onConnect={null} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Load earlier messages' }));
    expect(await screen.findByText('Earliest hello')).toBeTruthy();
    expect(screen.getByText('Latest')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull());
  });
});
