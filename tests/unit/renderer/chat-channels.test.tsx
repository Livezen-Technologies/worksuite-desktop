// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Chat's channel toolbar (worksuite-desktop#33): which channels show, their badges and warnings, switching, and
 * WhatsApp's list, thread and reply box, with the draft kept. WhatsApp as Chat's channel (#35): its attachments,
 * files and templates, starting a conversation, and its channel settings.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/open-document', async (orig) => ({ ...(await orig<object>()), openDocument: vi.fn(async () => undefined), openInOffice: vi.fn() }));
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
import { openDocument, openInOffice } from '../../../src/core/open-document';
import { toast } from '../../../src/core/toasts';
import { closePreview } from '../../../src/modules/chat/AttachmentViewer';
import { AddChannel } from '../../../src/modules/chat/channels/AddChannel';
import { ChannelBar } from '../../../src/modules/chat/channels/ChannelBar';
import { badgeText, buildChannels, channelOf, channelRoute, channelTitle, chatUnread, rememberWhatsapp, whatsappState, type Channel } from '../../../src/modules/chat/channels/channels';
import { WhatsappChannel } from '../../../src/modules/chat/channels/WhatsappChannel';
import { WhatsappSettings } from '../../../src/modules/chat/channels/WhatsappSettings';
import { fileRefusal, messageText, numberName, numberState, preview, waAttachment, waLimits, waNumber, type WaAccount, type WaChat, type WaMessage } from '../../../src/modules/chat/channels/whatsapp';
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
  waNumber.set({ id: 0 });
  tab.route = '/chat?channel=whatsapp';
  tab.go.mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  vi.mocked(toast).mockReset();
});
afterEach(() => {
  closePreview();
  cleanup();
});

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

  it('shows WhatsApp, now only in Chat (#35), to whoever has it and a number or may connect one — never without access', () => {
    const at = (whatsapp: { access: boolean; accounts: WaAccount[]; canConnect?: boolean }, chat?: boolean) => buildChannels({ active: 'chat', chat, rooms: [], website: { access: false, rows: [] }, whatsapp }).map((c) => c.id);
    expect(at({ access: true, accounts: [], canConnect: true })).toEqual(['chat', 'whatsapp']);
    expect(at({ access: true, accounts: [], canConnect: false })).toEqual(['chat']);
    expect(at({ access: false, accounts: [account({})], canConnect: true })).toEqual(['chat']);
    // WhatsApp without Chat: Chat for WhatsApp alone.
    expect(buildChannels({ active: 'whatsapp', chat: false, rooms: [], website: { access: false, rows: [] }, whatsapp: { access: true, accounts: [account({})] } }).map((c) => c.id)).toEqual(['whatsapp']);
  });

  it('puts the unread messages on the shared numbers on the WhatsApp icon', () => {
    const [, wa] = buildChannels({ active: 'chat', rooms: [], website: { access: false, rows: [] }, whatsapp: { access: true, accounts: [account({ unread: 3 }), account({ id: 2, unread: 9 })] } });
    expect(wa).toMatchObject({ id: 'whatsapp', badge: 12 });
    render(<ChannelBar channels={[wa!]} active="chat" onPick={() => undefined} onAdd={() => undefined} />);
    expect(screen.getByRole('button', { name: 'WhatsApp · 12 unread' }).textContent).toContain('12');
  });

  it('reads an attachment kept in the Drive, and the files the workspace allows', () => {
    expect(waAttachment(message({ kind: 'text' }))).toBeNull();
    expect(waAttachment(message({ kind: 'image', file_id: 31, filename: 'shelf.jpg', mime_type: 'image/jpeg', size: 2048 }))).toEqual({ driveFile: 31, filename: 'shelf.jpg', mime: 'image/jpeg', size: 2048, url: '/api/files/31/download', download_url: '/api/files/31/download' });
    const limits = waLimits({ whatsapp_allow_video: '0', whatsapp_max_attach_mb: '2' });
    expect(fileRefusal({ name: 'clip.mp4', type: 'video/mp4', size: 10 }, limits)).toBe('clip.mp4: videos cannot be sent on WhatsApp here.');
    expect(fileRefusal({ name: 'big.pdf', type: 'application/pdf', size: 3 * 1024 * 1024 }, limits)).toBe('big.pdf is larger than 2 MB.');
    expect(fileRefusal({ name: 'quote.pdf', type: 'application/pdf', size: 1024 }, limits)).toBeNull();
    // Never more than the app's API proxy takes in one request.
    expect(waLimits({ whatsapp_max_attach_mb: '64' }).maxBytes).toBe(25 * 1024 * 1024);
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

  // #155: each number on the rail, its tooltip naming it, a status dot apart from the unread count.
  it('puts the WhatsApp numbers on the rail, each with its status dot and, separately, its unread count', () => {
    const onPick = vi.fn();
    const accounts = [
      account({ id: 1, name: 'Sales', unread: 2 }),
      account({ id: 2, name: 'Support', phone: '94771112223', status: 'qr_required', unread: 0 }),
      account({ id: 3, name: 'Front desk', phone: null, status: 'disconnected', unread: 5 }),
    ];
    const { rerender } = render(<ChannelBar channels={channels} active="whatsapp" onPick={() => undefined} onAdd={() => undefined} numbers={{ accounts, selected: 0, onPick }} />);
    const rail = screen.getByRole('group', { name: 'WhatsApp numbers' });
    const sales = within(rail).getByRole('button', { name: 'Sales · +94 77 123 4567 · Connected · 2 unread' });
    expect(sales.title).toBe('Sales · +94 77 123 4567 · Connected · 2 unread');
    const support = within(rail).getByRole('button', { name: 'Support · +94 77 111 2223 · Waiting for scan' });
    const desk = within(rail).getByRole('button', { name: 'Front desk · Not connected · 5 unread' });
    const dot = (b: HTMLElement) => b.querySelector('[data-status]') as HTMLElement;
    expect([dot(sales).dataset.status, dot(support).dataset.status, dot(desk).dataset.status]).toEqual(['connected', 'waiting', 'down']);
    expect([dot(sales).className, dot(support).className, dot(desk).className].map((c) => /bg-(success|warning|danger)/.exec(c)?.[1])).toEqual(['success', 'warning', 'danger']);
    // The count is its own mark, never the status dot.
    const count = sales.querySelector('[data-unread]') as HTMLElement;
    expect(count.textContent).toBe('2');
    expect(count).not.toBe(dot(sales));
    expect(count.className).not.toMatch(/bg-(success|warning|danger)/);
    expect(support.querySelector('[data-unread]')).toBeNull();
    // The numbers say what is wrong: the WhatsApp icon carries no warning of its own meanwhile.
    const wa = screen.getByRole('button', { name: /^WhatsApp · 120 unread/ });
    expect(wa.querySelector('.bg-warning')).toBeNull();
    fireEvent.click(support);
    expect(onPick).toHaveBeenCalledWith(2);
    rerender(<ChannelBar channels={channels} active="whatsapp" onPick={() => undefined} onAdd={() => undefined} numbers={{ accounts, selected: 2, onPick }} />);
    const picked = screen.getByRole('button', { name: /^Support/ });
    expect(picked.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(picked);
    expect(onPick).toHaveBeenLastCalledWith(0);
    // Another channel open: no numbers, and the warning is back on the icon.
    rerender(<ChannelBar channels={channels} active="chat" onPick={() => undefined} onAdd={() => undefined} numbers={{ accounts, selected: 0, onPick }} />);
    expect(screen.queryByRole('group', { name: 'WhatsApp numbers' })).toBeNull();
    expect(screen.getByRole('button', { name: /^WhatsApp · 120 unread/ }).querySelector('.bg-warning')).toBeTruthy();
  });

  it('reads where a number stands, and names it with its number', () => {
    expect(numberState({ status: 'connected' })).toEqual({ tone: 'connected', label: 'Connected' });
    expect(numberState({ status: 'qr_required' })).toEqual({ tone: 'waiting', label: 'Waiting for scan' });
    expect(numberState({ status: 'connecting' })).toEqual({ tone: 'waiting', label: 'Connecting' });
    expect(numberState({ status: 'expired' })).toEqual({ tone: 'down', label: 'Not connected' });
    expect(numberName({ name: 'Support', phone: '94771234567' })).toBe('Support · +94 77 123 4567');
    expect(numberName({ name: 'Support', phone: null })).toBe('Support');
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
      if (path === '/api/whatsapp/settings') return { settings: { whatsapp_allow_video: '0' }, can_edit: false };
      if (path === '/api/whatsapp/templates') return { templates: [{ id: 3, account_id: null, name: 'Order update', kind: 'template', body: 'Hello {{1}}, your order {{2}} is ready.', slots: [1, 2] }, { id: 4, account_id: '2', name: 'Other number', kind: 'template', body: 'Hi', slots: [] }, { id: 5, account_id: null, name: 'Thanks', kind: 'quick_reply', body: 'Thanks!', slots: [] }] };
      throw new Error(`unexpected ${path}`);
    }) as never);
  }

  const mount = (o: { onSettings?: () => void; accounts?: WaAccount[] } = {}) => wrap(<WhatsappChannel accounts={o.accounts ?? [account({})]} loading={false} error={null} retry={() => undefined} onConnect={null} onSettings={o.onSettings} />);

  it('lists the conversations, and opens one', async () => {
    serve();
    wrap(<WhatsappChannel accounts={[account({})]} loading={false} error={null} retry={() => undefined} onConnect={null} />);
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
    wrap(<WhatsappChannel accounts={[account({})]} loading={false} error={null} retry={() => undefined} onConnect={null} />);
    const box = await screen.findByRole('textbox', { name: 'Message Nimal Perera on WhatsApp' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/chats/7/read'));
    expect(screen.getByText('Packing it now')).toBeTruthy();
    expect(screen.getByText(/Kasun · .* · Read/)).toBeTruthy();
    // The draft is kept per conversation: it asks for this one's when it opens.
    expect(call).toHaveBeenCalledWith('offline:getDraft', { module: 'whatsapp', context: 'chat:7' });
    fireEvent.change(box, { target: { value: 'Ready at 4pm' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/chats/7/messages', { kind: 'text', text: 'Ready at 4pm', client_message_id: expect.any(String) }));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
    expect(call).toHaveBeenCalledWith('offline:deleteDraft', { module: 'whatsapp', context: 'chat:7' });
  });

  it('keeps a message that was not sent in the conversation, with a retry that reuses its id', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve();
    vi.mocked(apiPost).mockImplementation((async (path: string) => (path.endsWith('/messages') ? { ok: false, error: 'The phone is offline.' } : { ok: true })) as never);
    wrap(<WhatsappChannel accounts={[account({})]} loading={false} error={null} retry={() => undefined} onConnect={null} />);
    const box = await screen.findByRole('textbox', { name: 'Message Nimal Perera on WhatsApp' });
    fireEvent.change(box, { target: { value: 'Ready at 4pm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Not sent — The phone is offline\./)).toBeTruthy();
    expect(screen.getByText('Ready at 4pm')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(vi.mocked(apiPost).mock.calls.filter(([path]) => path === '/api/whatsapp/chats/7/messages')).toHaveLength(2));
    const ids = vi.mocked(apiPost).mock.calls.filter(([path]) => path === '/api/whatsapp/chats/7/messages').map((c) => (c[1] as { client_message_id: string }).client_message_id);
    expect(ids[0]).toBe(ids[1]);
  });

  it('says why a reply cannot be sent', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve(thread({ allowed: false }));
    wrap(<WhatsappChannel accounts={[account({})]} loading={false} error={null} retry={() => undefined} onConnect={null} />);
    expect(await screen.findByText(/more than 24 hours since they last wrote.*Send an approved template instead/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    const box = screen.getByRole('textbox', { name: 'Message Nimal Perera on WhatsApp' });
    fireEvent.change(box, { target: { value: 'A draft for reconnecting' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(vi.mocked(apiPost).mock.calls.some(([path]) => path === '/api/whatsapp/chats/7/messages')).toBe(false);
  });

  it('sends an approved template once the 24-hour window has closed, its placeholders filled in', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve(thread({ allowed: false }));
    vi.mocked(apiPost).mockResolvedValue({ ok: true } as never);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Send a template' }));
    const list = await screen.findByRole('list', { name: 'Templates' });
    // Only this number's approved templates (or everybody's): not another number's, not a saved reply.
    expect(within(list).getAllByRole('button').map((b) => b.querySelector('b')?.textContent)).toEqual(['Order update']);
    fireEvent.click(within(list).getByRole('button'));
    const send = screen.getAllByRole('button', { name: 'Send' }).at(-1) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: '{{1}}' }), { target: { value: 'Nimal' } });
    fireEvent.change(screen.getByRole('textbox', { name: '{{2}}' }), { target: { value: 'SO-12' } });
    expect(screen.getByText('Hello Nimal, your order SO-12 is ready.')).toBeTruthy();
    fireEvent.click(send);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/chats/7/messages', { kind: 'template', template_id: 3, variables: ['Nimal', 'SO-12'] }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Templates' })).toBeNull());
  });

  it('offers no template to a viewer of the number', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve(thread({ allowed: false, canSend: false }));
    mount();
    expect(await screen.findByText('You can read this number’s conversations but not answer them.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send a template' })).toBeNull();
  });

  it('shows the conversation’s attachments and opens them in the shared preview, or on this computer', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    const t = thread();
    t.messages.push(
      message({ id: 3, kind: 'image', body: null, caption: 'The shelf', file_id: 31, filename: 'shelf.jpg', mime_type: 'image/jpeg', size: 2048 }),
      message({ id: 4, kind: 'document', body: 'quote.pdf', file_id: 32, filename: 'quote.pdf', mime_type: 'application/pdf', size: 4096 }),
      message({ id: 5, kind: 'document', body: 'prices.xlsx', file_id: 33, filename: 'prices.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      message({ id: 6, kind: 'video', body: null, media_note: 'Larger than the workspace keeps.' }),
    );
    serve(t);
    mount();
    const picture = await screen.findByRole('button', { name: 'Open shelf.jpg' });
    expect(picture.querySelector('img')?.getAttribute('src')).toContain('/api/files/31/download');
    expect(screen.getByText('The shelf')).toBeTruthy();
    expect(screen.getByText('Larger than the workspace keeps.')).toBeTruthy();
    fireEvent.click(picture);
    expect(await screen.findByRole('dialog', { name: /shelf\.jpg/ })).toBeTruthy();
    closePreview();
    fireEvent.click(screen.getByRole('button', { name: 'Open quote.pdf' }));
    expect(openDocument).toHaveBeenCalledWith({ fileId: '32' }, 'quote.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Open prices.xlsx' }));
    expect(openInOffice).toHaveBeenCalledWith({ kind: 'api', path: '/api/files/33/download', name: 'prices.xlsx' });
  });

  it('sends files with the words as their caption, refusing what the workspace does not allow', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve();
    vi.mocked(apiPost).mockImplementation((async (path: string) => (path.endsWith('/attachments') ? { sent: 1, failed: 0, results: [{ name: 'quote.pdf', ok: true }] } : { ok: true })) as never);
    const { container } = mount();
    const box = await screen.findByRole('textbox', { name: 'Message Nimal Perera on WhatsApp' });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/whatsapp/settings', undefined, expect.anything()));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' });
    const clip = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    // The workspace's settings have arrived: videos are switched off.
    await act(async () => undefined);
    fireEvent.change(input, { target: { files: [pdf, clip] } });
    expect(toast).toHaveBeenCalledWith('error', 'clip.mp4: videos cannot be sent on WhatsApp here.');
    const tray = screen.getByRole('list', { name: 'Files ready to send' });
    expect(within(tray).getByText('quote.pdf')).toBeTruthy();
    expect(within(tray).queryByText('clip.mp4')).toBeNull();
    fireEvent.change(box, { target: { value: 'Your quote' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/chats/7/attachments', expect.any(FormData)));
    const form = vi.mocked(apiPost).mock.calls.find((c) => c[0] === '/api/whatsapp/chats/7/attachments')![1] as FormData;
    expect((form.getAll('files[]') as File[]).map((f) => f.name)).toEqual(['quote.pdf']);
    expect(form.get('caption')).toBe('Your quote');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Files ready to send' })).toBeNull());
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('offers no voice or video call in a WhatsApp conversation', async () => {
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve();
    mount();
    await screen.findByRole('region', { name: 'WhatsApp with Nimal Perera' });
    expect(screen.queryByRole('button', { name: /voice call|video call|^call/i })).toBeNull();
  });

  it('opens the channel settings from the list', async () => {
    serve();
    const onSettings = vi.fn();
    mount({ onSettings });
    fireEvent.click(await screen.findByRole('button', { name: 'WhatsApp settings' }));
    expect(onSettings).toHaveBeenCalled();
  });

  it('starts a conversation with a number from an old link or Contacts, then opens it', async () => {
    tab.route = '/chat?channel=whatsapp&to=94771112223';
    serve();
    vi.mocked(apiPost).mockResolvedValue({ chat_id: 55 } as never);
    mount({ accounts: [account({}), account({ id: 2, name: 'Support', is_default: false })] });
    const number = await screen.findByRole('textbox', { name: /Phone number/ });
    expect((number as HTMLInputElement).value).toBe('94771112223');
    fireEvent.click(screen.getByRole('combobox', { name: /Send from/ }));
    fireEvent.click(screen.getByRole('option', { name: /Support/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/chats', { account_id: 2, phone: '94771112223' }));
    expect(tab.go).toHaveBeenCalledWith('/chat?channel=whatsapp&wa=55');
  });

  // #155: Link again opens the number's QR code beside the list, where "Pick a conversation" was — not a dialog.
  it('shows a number that is not connected, and links it again by QR code in the pane beside the list', async () => {
    serve(thread(), []);
    vi.mocked(apiPost).mockResolvedValue({ ok: true } as never);
    const down = account({ status: 'error', status_note: 'The phone unlinked this device.' });
    const qr = vi.mocked(apiGet).getMockImplementation()!;
    vi.mocked(apiGet).mockImplementation((async (path: string, ...rest: unknown[]) => (path === '/api/whatsapp/accounts/1/qr' ? { ok: true, qr: '2@abc,def', state: 'qr', linked: false, status_note: null, error: null } : (qr as (...a: unknown[]) => unknown)(path, ...rest))) as never);
    mount({ accounts: [down] });
    const banner = (await screen.findByText('Sales is not connected.')).closest('[role="status"]') as HTMLElement;
    expect(within(banner).getByText('The phone unlinked this device.')).toBeTruthy();
    // With nothing open, the pane offers the reconnection itself.
    const card = screen.getByRole('region', { name: 'Reconnect Sales' });
    expect(within(card).getByText('Sales is not connected')).toBeTruthy();
    expect(screen.queryByText('Pick a conversation')).toBeNull();
    // The banner's Link again is a real button, and the code opens beside the list.
    const link = within(banner).getByRole('button', { name: 'Link again' });
    expect(link.className).toContain('rounded');
    fireEvent.click(link);
    const pane = await screen.findByRole('region', { name: 'Link Sales' });
    expect(within(pane).getByText('Link Sales to WhatsApp')).toBeTruthy();
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/accounts/1/link'));
    expect(await within(pane).findByRole('img', { name: 'QR code to link WhatsApp' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(pane).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Link Sales' })).toBeNull();
    expect(await screen.findByText('No WhatsApp conversations yet')).toBeTruthy();
  });

  // #155: dimmed while the number is down, with the reason as the tooltip; connected numbers' rows are not.
  it('dims the conversations of a number that is down, saying why', async () => {
    serve(thread(), [chat({ id: 7, account_id: 2, account_name: 'Support' }), chat({ id: 8, name: 'Kamal', account_id: 1 })]);
    mount({ accounts: [account({}), account({ id: 2, name: 'Support', status: 'disconnected', is_default: false })] });
    const list = await screen.findByRole('complementary', { name: 'WhatsApp conversations' });
    const down = (await within(list).findByText('Nimal Perera')).closest('button')!;
    expect(down.title).toBe('Can’t reply until Support is linked.');
    expect(down.className).toContain('opacity-60');
    const up = within(list).getByText('Kamal').closest('button')!;
    expect(up.title).toBe('');
    expect(up.className).not.toContain('opacity-60');
  });

  // #155: the time and the badges share one right-hand column on every row.
  it('puts the time and the badges in one column: the unread count under the time, Waiting as a soft pill or, with unread, a dot', async () => {
    serve(thread(), [
      chat({ id: 1, name: 'Unread only', unread: 3 }),
      chat({ id: 2, name: 'Waiting only', awaiting_since: '2026-09-30 08:00:00', waiting_minutes: 45 }),
      chat({ id: 3, name: 'Both', unread: 2, awaiting_since: '2026-09-30 08:00:00', waiting_minutes: 130, overdue: true }),
      chat({ id: 4, name: 'Neither' }),
    ]);
    mount();
    const list = await screen.findByRole('complementary', { name: 'WhatsApp conversations' });
    const row = async (name: string) => (await within(list).findByText(name)).closest('button')!;
    const meta = (b: HTMLElement) => b.querySelector('[data-meta]') as HTMLElement;
    for (const name of ['Unread only', 'Waiting only', 'Both', 'Neither']) {
      const b = await row(name);
      // Every row has the column, its first line the time.
      expect(meta(b)).toBeTruthy();
      expect(meta(b).firstElementChild?.textContent).not.toBe('');
      expect(b.className).toContain('min-h-[64px]');
      expect(b.className).toContain('focus-visible:ring-2');
    }
    const unread = meta(await row('Unread only'));
    expect(unread.querySelector('[data-unread]')?.textContent).toBe('3');
    expect(within(unread).queryByText('Waiting')).toBeNull();
    const waiting = meta(await row('Waiting only'));
    const pill = within(waiting).getByText('Waiting');
    expect(pill.className).toContain('bg-warning-bg');
    expect(pill.title).toBe('Waiting 45 min');
    const both = meta(await row('Both'));
    expect(both.querySelector('[data-unread]')?.textContent).toBe('2');
    expect(within(both).queryByText('Waiting')).toBeNull();
    expect((both.querySelector('[data-waiting-dot]') as HTMLElement).title).toBe('Waiting 2 h · overdue');
    expect(meta(await row('Neither')).querySelector('[data-unread], [data-waiting-dot]')).toBeNull();
  });

  // #155: "Support ·" says which number a conversation is on only while every number is shown.
  it('names the number a conversation is on only when All numbers is chosen', async () => {
    serve(thread(), [chat({ account_name: 'Support', account_id: 2 })]);
    const accounts = [account({}), account({ id: 2, name: 'Support', is_default: false })];
    mount({ accounts });
    const list = await screen.findByRole('complementary', { name: 'WhatsApp conversations' });
    const row = (await within(list).findByText('Nimal Perera')).closest('button')!;
    expect(row.querySelector('[data-channel]')?.textContent).toBe('Support ·');
    act(() => waNumber.set({ id: 2 }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/whatsapp/chats', expect.objectContaining({ account_id: '2' }), expect.anything()));
    const again = (await within(list).findByText('Nimal Perera')).closest('button')!;
    expect(again.querySelector('[data-channel]')).toBeNull();
    // A single number: never.
    cleanup();
    waNumber.set({ id: 0 });
    mount({ accounts: [account({})] });
    const single = (await screen.findByText('Nimal Perera')).closest('button')!;
    expect(single.querySelector('[data-channel]')).toBeNull();
  });

  // #155: a lighter empty card, with the shortcut that does start a WhatsApp conversation.
  it('says how to start a chat when nothing is open, and ⌘N / Ctrl+N starts a WhatsApp conversation', async () => {
    serve(thread(), []);
    mount();
    expect(await screen.findByText('Pick a conversation')).toBeTruthy();
    expect(screen.getByText('Ctrl+N', { selector: 'kbd' }).parentElement?.textContent).toBe('Press Ctrl+N to start a new chat.');
    cleanup();
    tab.route = '/chat?channel=whatsapp&new=1';
    mount();
    expect(await screen.findByRole('textbox', { name: /Phone number/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(tab.go).toHaveBeenCalledWith('/chat?channel=whatsapp');
  });

  it('with no number yet, offers to connect one, or says who can', () => {
    const onConnect = vi.fn();
    wrap(<WhatsappChannel accounts={[]} loading={false} error={null} retry={() => undefined} onConnect={onConnect} />);
    expect(screen.getByText('No WhatsApp number yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect a number' }));
    expect(onConnect).toHaveBeenCalled();
    cleanup();
    wrap(<WhatsappChannel accounts={[]} loading={false} error={null} retry={() => undefined} onConnect={null} />);
    expect(screen.getByText('Ask whoever manages WhatsApp numbers to share one with you.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect a number' })).toBeNull();
  });
});

describe('WhatsApp channel settings', () => {
  const settings = (accounts: WaAccount[], o: { onConnect?: (() => void) | null; onRelink?: (a: WaAccount) => void } = {}) =>
    wrap(<WhatsappSettings accounts={accounts} loading={false} onConnect={o.onConnect ?? null} onRelink={o.onRelink ?? (() => undefined)} onClose={() => undefined} />);

  it('lists the numbers and where each stands, with what this person may do', () => {
    settings([account({ role: 'owner', provider_label: 'WhatsApp Web' }), account({ id: 2, name: 'Support', is_default: false, status: 'error', status_note: 'The phone unlinked this device.', can_connect: false, role: 'agent' })]);
    const sales = screen.getByRole('listitem', { name: 'Sales' });
    expect(within(sales).getByText('Connected')).toBeTruthy();
    expect(within(sales).getByText('Default')).toBeTruthy();
    expect(within(sales).getByText('+94 77 123 4567 · WhatsApp Web · Owner')).toBeTruthy();
    expect(within(sales).getByRole('button', { name: 'Check connection' })).toBeTruthy();
    expect(within(sales).getByRole('button', { name: 'More actions for Sales' })).toBeTruthy();
    expect(within(sales).queryByRole('button', { name: 'Unlink from phone' })).toBeNull();
    expect(within(sales).queryByRole('button', { name: 'Make default' })).toBeNull();
    const support = screen.getByRole('listitem', { name: 'Support' });
    expect(within(support).getByText('Not connected')).toBeTruthy();
    expect(within(support).getByText('The phone unlinked this device.')).toBeTruthy();
    // The server says this person may not change Support: nothing is offered.
    expect(within(support).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Connect a number' })).toBeNull();
  });

  it('checks a connection, makes a number the default, links one again and unlinks one after asking', async () => {
    vi.mocked(apiPost).mockResolvedValue({ ok: true, error: null } as never);
    const onRelink = vi.fn();
    const onConnect = vi.fn();
    const down = account({ id: 2, name: 'Support', is_default: false, status: 'disconnected' });
    settings([account({}), down], { onRelink, onConnect });
    const sales = screen.getByRole('listitem', { name: 'Sales' });
    fireEvent.click(within(sales).getByRole('button', { name: 'Check connection' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/accounts/1/check'));
    const support = screen.getByRole('listitem', { name: 'Support' });
    fireEvent.click(within(support).getByRole('button', { name: 'Make default' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/accounts/2/default'));
    fireEvent.click(within(support).getByRole('button', { name: 'Link again' }));
    expect(onRelink).toHaveBeenCalledWith(down);
    fireEvent.click(within(sales).getByRole('button', { name: 'More actions for Sales' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unlink from phone' }));
    expect(within(sales).getByRole('alert').textContent).toContain('Unlink Sales from the phone? Its conversations stay here.');
    fireEvent.click(within(sales).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/accounts/1/unlink'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Sales is unlinked.'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect a number' }));
    expect(onConnect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More on the web' }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/whatsapp' });
  });

  it('does not display an unconfirmed phone while a QR scan is pending (#157)', () => {
    settings([account({ status: 'qr_required', phone: '+94770000000', connected_at: '2026-09-01 09:00:00' })]);
    expect(screen.getByText(/Number not linked yet/)).toBeTruthy();
    expect(screen.queryByText(/94 77 000 0000/)).toBeNull();
  });

  it('shows confirmed phone formatting and available connection metadata (#157)', () => {
    settings([account({ phone: '94770000000', connected_at: '2026-10-03 09:02:00', device_label: 'Mac – WorkSuite' })]);
    expect(screen.getByText(/\+94 77 000 0000/)).toBeTruthy();
    expect(screen.getByText(/Last connected:/)).toBeTruthy();
    expect(screen.getByText('Connected on: Mac – WorkSuite')).toBeTruthy();
  });

  it('shows the actual connection-check refusal rather than a generic success (#157)', async () => {
    vi.mocked(apiPost).mockResolvedValue({ ok: false, note: 'Waiting for the QR code to be scanned.' } as never);
    settings([account({})]);
    fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Waiting for the QR code to be scanned.'));
    expect(toast).toHaveBeenCalledWith('error', 'Waiting for the QR code to be scanned.');
  });

  it('is reached from Add a channel too', () => {
    const onSettings = vi.fn();
    wrap(<AddChannel website={{ access: false, canSetUp: false }} whatsapp={{ access: true, canConnect: false, accounts: [account({})] }} onClose={() => undefined} onConnected={() => undefined} onSettings={onSettings} />);
    fireEvent.click(within(screen.getByRole('region', { name: 'WhatsApp' })).getByRole('button', { name: 'Settings' }));
    expect(onSettings).toHaveBeenCalled();
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
