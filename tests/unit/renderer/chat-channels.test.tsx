// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Chat's channel toolbar (worksuite-desktop#33): which channels show, their badges and warnings, switching, and
 * WhatsApp's list, thread and reply box, with the draft kept.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/chat?channel=whatsapp', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { AddChannel } from '../../../src/modules/chat/channels/AddChannel';
import { ChannelBar } from '../../../src/modules/chat/channels/ChannelBar';
import { badgeText, buildChannels, channelOf, channelRoute, channelTitle, chatUnread, rememberWhatsapp, whatsappState, type Channel } from '../../../src/modules/chat/channels/channels';
import { WhatsappChannel } from '../../../src/modules/chat/channels/WhatsappChannel';
import { messageText, preview, type WaAccount, type WaChat, type WaMessage } from '../../../src/modules/chat/channels/whatsapp';
import type { Room } from '../../../src/modules/chat/types';
import type { WebsiteRow } from '../../../src/modules/chat/website/api';

const room = (o: Partial<Room>): Room => ({ id: 1, type: 'direct', name: 'A', avatar_name: 'A', last_message: null, unread: 0, updated_at: '2026-09-30 10:00:00', pinned: false, muted: false, mentions: 0, ...o });
const account = (o: Partial<WaAccount>): WaAccount => ({ id: 1, name: 'Sales', provider: 'web_js', phone: '94771234567', status: 'connected', status_note: null, is_default: true, can_send: true, can_connect: true, unread: 0, ...o });
const chat = (o: Partial<WaChat>): WaChat => ({
  id: 7, account_id: 1, kind: 'direct', name: 'Nimal Perera', phone: '94770000007', status: 'open', unread: 0, is_pinned: 0, is_muted: 0,
  last_message: 'Is the order ready?', last_message_at: '2026-09-30 09:00:00', last_direction: 'in', awaiting_since: null, waiting_minutes: null, overdue: false, account_name: 'Sales', assigned_name: null, ...o,
});
const message = (o: Partial<WaMessage>): WaMessage => ({ id: 1, direction: 'in', kind: 'text', body: 'Hello', caption: null, status: null, error_text: null, sender_name: null, filename: null, created_at: '2026-09-30 09:00:00', sent_at: null, ...o });

beforeEach(() => {
  localStorage.clear();
  tab.route = '/chat?channel=whatsapp';
  tab.go.mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  vi.mocked(toast).mockReset();
});
afterEach(cleanup);

describe('the channels', () => {
  it('reads the channel from the route, keeping the website routes Chat always had', () => {
    expect(channelOf(new URLSearchParams(''))).toBe('chat');
    expect(channelOf(new URLSearchParams('room=4'))).toBe('chat');
    expect(channelOf(new URLSearchParams('view=website'))).toBe('website');
    expect(channelOf(new URLSearchParams('website=12'))).toBe('website');
    expect(channelOf(new URLSearchParams('channel=whatsapp&wa=3'))).toBe('whatsapp');
  });

  it('goes back to the WhatsApp conversation you had open', () => {
    expect(channelRoute('whatsapp')).toBe('/chat?channel=whatsapp');
    rememberWhatsapp('42');
    expect(channelRoute('whatsapp')).toBe('/chat?channel=whatsapp&wa=42');
    expect(channelRoute('chat')).toBe('/chat');
    expect(channelRoute('website')).toBe('/chat?view=website');
  });

  it('counts unread messages, leaving out archived and muted conversations', () => {
    expect(chatUnread([room({ unread: 3 }), room({ unread: 2, muted: true }), room({ unread: 5, archived: true }), room({ unread: 1 })])).toBe(4);
  });

  it('says which WhatsApp numbers are not connected', () => {
    expect(whatsappState([account({ unread: 2 }), account({ id: 2, unread: 5 })])).toEqual({ badge: 7, problem: null });
    expect(whatsappState([account({}), account({ id: 2, name: 'Support', status: 'error' })]).problem).toBe('Support is not connected');
    expect(whatsappState([account({ status: 'setup' }), account({ id: 2, status: 'error' })]).problem).toBe('None of your WhatsApp numbers is connected');
    expect(whatsappState([account({ status: 'error' }), account({ id: 2, status: 'error' }), account({ id: 3 })]).problem).toBe('2 numbers are not connected');
  });

  it('shows a channel once this person has it, and the one open now always', () => {
    const rows = [{ awaiting_reply: true }, { awaiting_reply: false }, { awaiting_reply: true }] as WebsiteRow[];
    const none = buildChannels({ active: 'chat', rooms: [], website: { access: false, rows: [] }, whatsapp: { access: true, accounts: [] } });
    expect(none.map((c) => c.id)).toEqual(['chat']);
    const all = buildChannels({ active: 'chat', rooms: [room({ unread: 2 })], website: { access: true, rows }, whatsapp: { access: true, accounts: [account({ unread: 4 })] } });
    expect(all.map((c) => [c.id, c.badge])).toEqual([['chat', 2], ['website', 2], ['whatsapp', 4]]);
    // No access at all: not even the route shows it.
    expect(buildChannels({ active: 'whatsapp', rooms: [], website: { access: false, rows: [] }, whatsapp: { access: false, accounts: [] } }).map((c) => c.id)).toEqual(['chat']);
    // Access but no number yet: shown while it is open (its empty state says how to connect one).
    expect(buildChannels({ active: 'whatsapp', rooms: [], website: { access: false, rows: [] }, whatsapp: { access: true, accounts: [] } }).map((c) => c.id)).toEqual(['chat', 'whatsapp']);
  });

  it('names a channel with its count and its problem', () => {
    expect(badgeText(7)).toBe('7');
    expect(badgeText(150)).toBe('99+');
    expect(channelTitle({ id: 'whatsapp', label: 'WhatsApp', icon: 'phone', badge: 3, problem: 'Sales is not connected' })).toBe('WhatsApp · 3 unread · Sales is not connected');
    expect(channelTitle({ id: 'website', label: 'Web Chat', icon: 'globe', badge: 2, problem: null })).toBe('Web Chat · 2 waiting');
    expect(channelTitle({ id: 'chat', label: 'Chat', icon: 'chat', badge: 0, problem: null })).toBe('Chat');
  });

  it('reads WhatsApp rows and messages as a person would', () => {
    expect(preview({ last_message: 'On my way', last_direction: 'out' })).toBe('You: On my way');
    expect(preview({ last_message: null, last_direction: null })).toBe('No messages yet');
    expect(messageText(message({ kind: 'image', body: null, caption: 'The shelf' }))).toBe('Photo\nThe shelf');
    expect(messageText(message({ kind: 'document', filename: 'quote.pdf' }))).toBe('Document · quote.pdf');
  });
});

describe('the channel toolbar', () => {
  const channels: Channel[] = [
    { id: 'chat', label: 'Chat', icon: 'chat', badge: 4, problem: null },
    { id: 'website', label: 'Web Chat', icon: 'globe', badge: 0, problem: null },
    { id: 'whatsapp', label: 'WhatsApp', icon: 'phone', badge: 120, problem: 'Sales is not connected' },
  ];

  it('shows each channel with its tooltip, badge and selected state, and switches', () => {
    const onPick = vi.fn();
    const onAdd = vi.fn();
    render(<ChannelBar channels={channels} active="whatsapp" onPick={onPick} onAdd={onAdd} />);
    const nav = screen.getByRole('navigation', { name: 'Channels' });
    const chatBtn = within(nav).getByRole('button', { name: 'Chat · 4 unread' });
    expect(chatBtn.title).toBe('Chat · 4 unread');
    expect(chatBtn.getAttribute('aria-current')).toBeNull();
    const wa = within(nav).getByRole('button', { name: 'WhatsApp · 120 unread · Sales is not connected' });
    expect(wa.getAttribute('aria-current')).toBe('page');
    expect(wa.textContent).toContain('99+');
    fireEvent.click(within(nav).getByRole('button', { name: 'Web Chat' }));
    expect(onPick).toHaveBeenCalledWith('website');
    fireEvent.click(within(nav).getByRole('button', { name: 'Add a channel' }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('moves along with the arrow keys, Home and End', () => {
    render(<ChannelBar channels={channels} active="chat" onPick={() => undefined} onAdd={() => undefined} />);
    const buttons = screen.getAllByRole('button');
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1]!, { key: 'End' });
    expect(document.activeElement).toBe(buttons[3]);
    fireEvent.keyDown(buttons[3]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(buttons[3]);
    fireEvent.keyDown(buttons[3]!, { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
  });
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('WhatsApp in Chat', () => {
  const thread = (o: { canSend?: boolean; status?: string; allowed?: boolean; unread?: number } = {}) => ({
    chat: { id: 7, name: 'Nimal Perera', wa_id: '94770000007', account_id: 1, unread: o.unread ?? 0, window: { allowed: o.allowed ?? true, reason: o.allowed === false ? 'It is more than 24 hours since they last wrote, so only an approved template can be sent.' : null }, account: account({ status: o.status ?? 'connected' }) },
    messages: [message({ id: 1, body: 'Is the order ready?' }), message({ id: 2, direction: 'out', body: 'Packing it now', status: 'read', sender_name: 'Kasun' })],
    has_more: false,
    can_send: o.canSend ?? true,
  });

  function serve(t = thread(), chats: WaChat[] = [chat({ unread: 2 }), chat({ id: 8, name: 'Shop group', kind: 'group', last_direction: 'out', last_message: 'Thanks', awaiting_since: '2026-09-30 08:00:00', waiting_minutes: 45, overdue: true })]) {
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/whatsapp/chats') return { chats, total: chats.length };
      if (path === '/api/whatsapp/chats/7') return t;
      throw new Error(`unexpected ${path}`);
    }) as never);
  }

  it('lists the conversations, and opens one', async () => {
    serve();
    wrap(<WhatsappChannel accounts={[account({})]} loading={false} error={null} retry={() => undefined} onConnect={null} onRelink={() => undefined} />);
    const list = await screen.findByRole('complementary', { name: 'WhatsApp conversations' });
    await within(list).findByText('Nimal Perera');
    expect(within(list).getByText('You: Thanks')).toBeTruthy();
    expect(within(list).getByText('Waiting', { selector: 'span' }).className).toContain('bg-danger');
    fireEvent.click(within(list).getByText('Nimal Perera'));
    expect(tab.go).toHaveBeenCalledWith('/chat?channel=whatsapp&wa=7');
    expect(screen.getByText('Pick a conversation')).toBeTruthy();
  });

  it('marks a conversation read, sends a reply and clears the draft', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve(thread({ unread: 2 }));
    vi.mocked(apiPost).mockResolvedValue({ ok: true } as never);
    wrap(<WhatsappChannel accounts={[account({})]} loading={false} error={null} retry={() => undefined} onConnect={null} onRelink={() => undefined} />);
    const box = await screen.findByRole('textbox', { name: 'Message Nimal Perera on WhatsApp' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/chats/7/read'));
    expect(screen.getByText('Packing it now')).toBeTruthy();
    expect(screen.getByText(/Kasun · .* · Read/)).toBeTruthy();
    // The draft is kept per conversation: it asks for this one's when it opens.
    expect(call).toHaveBeenCalledWith('offline:getDraft', { module: 'whatsapp', context: 'chat:7' });
    fireEvent.change(box, { target: { value: 'Ready at 4pm' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/chats/7/messages', { kind: 'text', text: 'Ready at 4pm' }));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
    expect(call).toHaveBeenCalledWith('offline:deleteDraft', { module: 'whatsapp', context: 'chat:7' });
  });

  it('keeps the words when the send fails', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve();
    vi.mocked(apiPost).mockResolvedValue({ ok: false, error: 'The phone is offline.' } as never);
    wrap(<WhatsappChannel accounts={[account({})]} loading={false} error={null} retry={() => undefined} onConnect={null} onRelink={() => undefined} />);
    const box = await screen.findByRole('textbox', { name: 'Message Nimal Perera on WhatsApp' });
    fireEvent.change(box, { target: { value: 'Ready at 4pm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Not sent. The phone is offline. Your message is kept.'));
    expect((box as HTMLTextAreaElement).value).toBe('Ready at 4pm');
  });

  it('says why a reply cannot be sent', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve(thread({ allowed: false }));
    wrap(<WhatsappChannel accounts={[account({})]} loading={false} error={null} retry={() => undefined} onConnect={null} onRelink={() => undefined} />);
    expect(await screen.findByText(/more than 24 hours since they last wrote.*Templates are sent from WhatsApp on the web/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a number that is not connected, with the way to link it again', async () => {
    serve(thread(), []);
    const onRelink = vi.fn();
    const down = account({ status: 'error', status_note: 'The phone unlinked this device.' });
    wrap(<WhatsappChannel accounts={[down]} loading={false} error={null} retry={() => undefined} onConnect={null} onRelink={onRelink} />);
    expect(await screen.findByText('Sales is not connected.')).toBeTruthy();
    expect(screen.getByText('The phone unlinked this device.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Link again' }));
    expect(onRelink).toHaveBeenCalledWith(down);
    expect(await screen.findByText('No WhatsApp conversations yet')).toBeTruthy();
  });

  it('with no number yet, offers to connect one, or says who can', () => {
    const onConnect = vi.fn();
    wrap(<WhatsappChannel accounts={[]} loading={false} error={null} retry={() => undefined} onConnect={onConnect} onRelink={() => undefined} />);
    expect(screen.getByText('No WhatsApp number yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect a number' }));
    expect(onConnect).toHaveBeenCalled();
    cleanup();
    wrap(<WhatsappChannel accounts={[]} loading={false} error={null} retry={() => undefined} onConnect={null} onRelink={() => undefined} />);
    expect(screen.getByText('Ask whoever manages WhatsApp numbers to share one with you.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect a number' })).toBeNull();
  });
});

describe('Add a channel', () => {
  it('lists the integrations and where each stands', () => {
    wrap(<AddChannel website={{ access: true, canSetUp: true }} whatsapp={{ access: true, canConnect: true, accounts: [account({}), account({ id: 2, name: 'Support', status: 'error' })] }} onClose={() => undefined} onConnected={() => undefined} />);
    const wa = screen.getByRole('region', { name: 'WhatsApp' });
    expect(within(wa).getByText('1 number connected')).toBeTruthy();
    expect(within(wa).getByText('Support needs linking again.')).toBeTruthy();
    expect(within(wa).getByRole('button', { name: 'Link Support' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Web Chat' })).getByText('Connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set up on the web' }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/website-chats?tab=widgets' });
  });

  it('says so when WhatsApp is not available to this person', () => {
    wrap(<AddChannel website={{ access: false, canSetUp: false }} whatsapp={{ access: false, canConnect: false, accounts: [] }} onClose={() => undefined} onConnected={() => undefined} />);
    const wa = screen.getByRole('region', { name: 'WhatsApp' });
    expect(within(wa).getByText('Not available to you')).toBeTruthy();
    expect(within(wa).queryByRole('button')).toBeNull();
  });

  it('connects a number: names it, links the phone by QR code, and reports it connected', async () => {
    let scans = 0;
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path === '/api/whatsapp/accounts') return { id: 9 };
      return { ok: true };
    }) as never);
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/whatsapp/accounts/9/qr') return scans++ === 0 ? { ok: true, qr: '2@abc,def', state: 'qr', linked: false, status_note: null, error: null } : { ok: true, qr: null, state: 'ready', linked: true, status_note: 'Linked to +94 77 123 4567', error: null };
      throw new Error(`unexpected ${path}`);
    }) as never);
    const onConnected = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wrap(<AddChannel website={{ access: false, canSetUp: false }} whatsapp={{ access: true, canConnect: true, accounts: [] }} onClose={() => undefined} onConnected={onConnected} />);
      fireEvent.click(screen.getByRole('button', { name: 'Connect a number' }));
      const name = screen.getByRole('textbox', { name: /Name/ });
      expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(name, { target: { value: 'Front desk' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/accounts', { name: 'Front desk', provider: 'web_js' }));
      expect(await screen.findByText('Link Front desk to WhatsApp')).toBeTruthy();
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/accounts/9/link'));
      expect(await screen.findByRole('img', { name: 'QR code to link WhatsApp' })).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
      });
      expect(await screen.findByText('Linked')).toBeTruthy();
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/accounts/9/check'));
      await waitFor(() => expect(onConnected).toHaveBeenCalledWith('whatsapp'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what went wrong when the number cannot be created', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('Your administrator has switched off connecting numbers.'));
    wrap(<AddChannel initial={{ at: 'whatsapp' }} website={{ access: false, canSetUp: false }} whatsapp={{ access: true, canConnect: true, accounts: [] }} onClose={() => undefined} onConnected={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), { target: { value: 'Sales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Your administrator has switched off connecting numbers.');
  });
});
