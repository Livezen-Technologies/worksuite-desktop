// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * A WhatsApp message in Chat: a reply shows the message it answers, reactions show under it and can be set or taken
 * away, and a picture that was not kept can be fetched again.
 */
const tab = { route: '/chat?channel=whatsapp&wa=7', go: vi.fn() };
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/access', async (orig) => ({ ...(await orig<object>()), useCanOpen: () => true }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { WhatsappChannel } from '../../../src/modules/chat/channels/WhatsappChannel';
import type { WaAccount, WaChat } from '../../../src/modules/chat/channels/whatsapp';

const account: WaAccount = { id: 1, name: 'Sales', provider: 'web_js', phone: '94771234567', status: 'connected', status_note: null, is_default: true, can_send: true, can_connect: true, unread: 0 };
const chat = {
  id: 7, account_id: 1, kind: 'direct', name: 'Kasun', phone: '+94767793692', wa_id: '94767793692', status: 'open', unread: 0, is_pinned: 0, is_muted: 0,
  last_message: 'hello', last_message_at: '2026-09-30 09:00:00', last_direction: 'in', awaiting_since: null, waiting_minutes: null, overdue: false, account_name: 'Sales', assigned_name: null,
} as unknown as WaChat;
const base = { caption: null, status: null, error_text: null, sender_name: null, filename: null, sent_at: null, created_at: '2026-09-30 09:00:00' };

beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/whatsapp/chats') return { chats: [chat], total: 1 };
    if (path === '/api/contacts/phone-index') return { region: 'LK', contacts: [] };
    if (path === '/api/whatsapp/settings') return { settings: {}, can_edit: false };
    if (path === '/api/whatsapp/chats/7/profile') return { available: false };
    if (path === '/api/whatsapp/chats/7') {
      return {
        chat: { ...chat, window: { allowed: true, reason: null }, account }, has_more: false, can_send: true,
        messages: [
          { ...base, id: 1, external_id: 'w1', direction: 'in', kind: 'text', body: 'What is the license validity?', reactions: [{ emoji: '👍', count: 1, mine: true }] },
          { ...base, id: 2, external_id: 'w2', direction: 'out', kind: 'text', body: 'One year', sender_name: 'Hasarinda', reply_to: 'w1', quoted: { id: 1, direction: 'in', kind: 'text', text: 'What is the license validity?', sender_name: null, from_wa_id: '94767793692' } },
          { ...base, id: 3, external_id: 'w3', direction: 'in', kind: 'image', body: null, media_status: 'failed', media_note: 'The download failed.' },
          { ...base, id: 4, external_id: 'w4', direction: 'in', kind: 'poll', body: 'Which day?', poll: { name: 'Which day?', options: ['Tuesday', 'Friday'], multiple: false, counts: { Friday: 1 }, mine: [], voters: 1 } },
          { ...base, id: 5, external_id: 'w5', direction: 'in', kind: 'location', body: 'Office', meta: { latitude: 6.9271, longitude: 79.8612, name: 'Office', address: 'Colombo' } },
        ],
      };
    }
    throw new Error(`unexpected ${path}`);
  }) as never);
});
afterEach(() => cleanup());

function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WhatsappChannel accounts={[account]} loading={false} error={null} retry={() => undefined} onConnect={null} /></QueryClientProvider>);
}

describe('WhatsApp reply, react and pictures', () => {
  it('shows the message a reply answers, and jumps to it', async () => {
    mount();
    const quote = await screen.findByRole('button', { name: 'Replying to Kasun: What is the license validity?' });
    const target = document.querySelector('[data-wa-message="1"]') as HTMLElement;
    target.scrollIntoView = vi.fn();
    fireEvent.click(quote);
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('reacts from the picker, and takes our own reaction away from its chip', async () => {
    mount();
    await screen.findByRole('button', { name: 'Replying to Kasun: What is the license validity?' });
    const first = document.querySelector('[data-wa-message="1"]') as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: 'React' }));
    fireEvent.click(within(first).getByRole('menuitem', { name: 'React ❤️' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/messages/1/react', { emoji: '❤️' }));
    fireEvent.click(within(first).getByRole('button', { name: '👍 1, yours' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/messages/1/react', { emoji: '' }));
  });

  it('offers to load a picture that was not kept', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Load picture' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/messages/3/media', {}));
  });

  it('votes on a poll, shows a place, and sends a poll from the row above the reply box', async () => {
    mount();
    const poll = await screen.findByRole('group', { name: 'Poll: Which day?' });
    expect(within(poll).getByText('Choose one · 1 voted')).toBeTruthy();
    fireEvent.click(within(poll).getByRole('button', { name: /Tuesday/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/messages/4/vote', { options: ['Tuesday'] }));
    expect(screen.getByText('Colombo')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('group', { name: 'Send something else' })).getByRole('button', { name: 'Poll' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Create a poll')).toBeTruthy();
    fireEvent.change(within(dialog).getByPlaceholderText('Ask a question'), { target: { value: 'Lunch?' } });
    fireEvent.change(within(dialog).getByLabelText('Answer 1'), { target: { value: 'Yes' } });
    fireEvent.change(within(dialog).getByLabelText('Answer 2'), { target: { value: 'No' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send poll' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/chats/7/messages', { kind: 'poll', question: 'Lunch?', options: ['Yes', 'No'], multiple: false }));
  });
});
