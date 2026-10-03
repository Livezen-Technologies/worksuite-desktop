// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Access from '../../../src/core/access';

/**
 * The chat list's conversation menu (worksuite-desktop#183): what it offers for each kind of conversation and
 * channel, the shortcuts, muting out of the badge, the multi-select, deleting with Undo, and presence from one
 * place.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), request: vi.fn(async () => ({ data: {}, offline: false, cachedAt: null })) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/access', async (orig) => ({ ...(await orig<typeof Access>()), useCanOpen: (id: string) => id === 'chat', canOpenWeb: () => false }));
const tab = { route: '/chat', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: true, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiGetMeta, apiPost, apiPut, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import ChatPage from '../../../src/modules/chat/ChatPage';
import { chatUnread } from '../../../src/modules/chat/channels/channels';
import type { WaAccount, WaChat } from '../../../src/modules/chat/channels/whatsapp';
import { WhatsappChannel } from '../../../src/modules/chat/channels/WhatsappChannel';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';
import { bulkMenu, roomMenu, shortcutAction, websiteMenu, whatsappMenu } from '../../../src/modules/chat/menus';
import { forgetPresence, presenceOf, recordPresence } from '../../../src/modules/chat/presence';
import { UNDO_MS, withFlags } from '../../../src/modules/chat/RoomActions';
import type { Room } from '../../../src/modules/chat/types';
import type { WebsiteRow } from '../../../src/modules/chat/website/api';
import type { MenuSection } from '../../../src/components/Menu';

const room = (o: Partial<Room>): Room => ({ id: 1, type: 'direct', name: 'Kasun', avatar_name: 'Kasun', last_message: null, unread: 0, updated_at: '2026-10-01 10:00:00', pinned: false, muted: false, mentions: 0, role: 'member', ...o });
const labels = (sections: MenuSection[]) => sections.flatMap((s) => s.items.map((i) => i.label));
const item = (sections: MenuSection[], label: string) => sections.flatMap((s) => s.items).find((i) => i.label === label);
const ctx = { pinned: 0, mac: false };

let rooms: Room[] = [];
const submitted = () => vi.mocked(call).mock.calls.filter(([ch]) => ch === 'offline:submit').map(([, input]) => input as { path: string; body: Record<string, unknown> });

beforeEach(() => {
  tab.route = '/chat';
  tab.go.mockReset();
  forgetPresence();
  rooms = [
    room({ id: 1, name: 'Kasun', unread: 2, other_user_id: 8 }),
    room({ id: 2, type: 'group', name: 'Design', role: 'owner', unread: 4, muted: true }),
    room({ id: 3, name: 'Nimal', other_user_id: 9, pinned: true }),
    room({ id: 4, name: 'Dilani', other_user_id: 10, marked_unread: true, unread: 1 }),
  ];
  vi.mocked(apiGetMeta).mockReset().mockImplementation(async () => ({ data: { rooms: rooms.map((r) => ({ ...r })) }, offline: false, cachedAt: null }) as never);
  vi.mocked(apiGet).mockReset().mockImplementation(async (path: string) => {
    if (path === '/api/chat/presence') return { presence: { 8: 'online', 9: 'offline', 10: 'away' } } as never;
    if (path === '/api/chat/presence/me') return { status: 'online', choice: 'available' } as never;
    if (path.startsWith('/api/chat/widget-admin')) return { conversations: [], can: { view: false } } as never;
    if (path === '/api/chat/calls/history') return [] as never;
    return {} as never;
  });
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({ ok: true } as never);
  // The server keeps what it was sent, as the list reads it again.
  vi.mocked(call).mockReset().mockImplementation((async (ch: string, input: { path: string; body: Record<string, unknown> }) => {
    if (ch !== 'offline:submit') return undefined;
    const one = /\/rooms\/(\d+)\/flags$/.exec(input.path);
    const ids = one ? [Number(one[1])] : ((input.body.room_ids as number[]) ?? []);
    rooms = rooms.map((r) => (ids.includes(r.id) ? withFlags(r, input.body) : r));
    return { delivered: true, queued: false, data: null, error: null };
  }) as never);
  vi.mocked(toast).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ChatPage tabId="t1" route="/chat" active />
    </QueryClientProvider>,
  );
  return qc;
}
const row = (name: string) => screen.getAllByRole('button').find((b) => b.hasAttribute('data-room-row') && within(b).queryByText(name)) as HTMLElement;

describe('what the menu offers for each kind of conversation', () => {
  it('a direct conversation: open, status, organise, notifications, the person, and block, export, clear, delete', () => {
    const m = roomMenu(room({ unread: 2, can_call: true }), ctx, vi.fn());
    expect(labels(m)).toEqual(['Open in new window', 'Mark as read', 'Pin', 'Archive', 'Add to favourites', 'Mute', 'Contact info', 'Start call', 'Start video call', 'Block', 'Export chat', 'Clear chat', 'Delete chat']);
    expect(labels(item(m, 'Mute')!.submenu!)).toEqual(['For 8 hours', 'For 1 week', 'Until I turn it back on']);
    expect(item(m, 'Delete chat')).toMatchObject({ danger: true, shortcut: 'Ctrl+Backspace' });
    expect(item(m, 'Mark as read')!.shortcut).toBe('Ctrl+Shift+U');
    // Mac shortcuts read as the Mac's.
    expect(item(roomMenu(room({}), { pinned: 0, mac: true }, vi.fn()), 'Archive')!.shortcut).toBe('⌘E');
    // Its state turns the items round.
    expect(labels(roomMenu(room({ pinned: true, archived: true, favorite: true, muted: true, blocked: true }), ctx, vi.fn()))).toEqual(expect.arrayContaining(['Mark as unread', 'Unpin', 'Unarchive', 'Remove from favourites', 'Unmute', 'Unblock']));
  });

  it('a group: its info and leaving; adding members for its admins; deleting it for everyone for its owner only', () => {
    const member = labels(roomMenu(room({ type: 'group', role: 'member' }), ctx, vi.fn()));
    expect(member).toEqual(expect.arrayContaining(['Group info', 'Leave group', 'Delete chat', 'Export chat', 'Clear chat']));
    expect(member).not.toContain('Add members');
    expect(member).not.toContain('Delete group');
    expect(member).not.toContain('Block');
    expect(labels(roomMenu(room({ type: 'group', role: 'admin' }), ctx, vi.fn()))).toContain('Add members');
    expect(labels(roomMenu(room({ type: 'group', role: 'admin' }), ctx, vi.fn()))).not.toContain('Delete group');
    const owner = roomMenu(room({ type: 'group', role: 'owner' }), ctx, vi.fn());
    expect(item(owner, 'Delete group')).toMatchObject({ danger: true, description: 'For everyone in it' });
    // A department channel is left, never deleted for everyone.
    expect(labels(roomMenu(room({ type: 'department', role: 'owner' }), ctx, vi.fn()))).not.toContain('Delete group');
  });

  it("a meeting's conversation: its details, rename for whoever runs it, and leave", () => {
    const attendee = labels(roomMenu(room({ type: 'meeting', name: 'Instant meeting' }), ctx, vi.fn()));
    expect(attendee).toEqual(expect.arrayContaining(['Open meeting details', 'Leave']));
    expect(attendee).not.toContain('Rename');
    expect(attendee).not.toContain('Delete chat');
    expect(labels(roomMenu(room({ type: 'meeting', role: 'owner' }), ctx, vi.fn()))).toContain('Rename');
  });

  it("WorkSuite's own notices: mute, mark read and archive only", () => {
    expect(labels(roomMenu(room({ type: 'system', unread: 3 }), ctx, vi.fn()))).toEqual(['Mark as read', 'Archive', 'Mute']);
    expect(labels(roomMenu(room({ type: 'system' }), ctx, vi.fn()))).toEqual(['Archive', 'Mute']);
  });

  it('pins five at most, and says why a sixth cannot be', () => {
    const pin = item(roomMenu(room({}), { pinned: 5, mac: false }, vi.fn()), 'Pin')!;
    expect(pin.disabled).toBe(true);
    expect(pin.reason).toBe('You can pin up to 5 conversations.');
    expect(item(roomMenu(room({ pinned: true }), { pinned: 5, mac: false }, vi.fn()), 'Unpin')!.disabled).toBe(false);
  });

  it('runs the action it names', () => {
    const run = vi.fn();
    item(roomMenu(room({}), ctx, run), 'Archive')!.onSelect!();
    item(item(roomMenu(room({}), ctx, run), 'Mute')!.submenu!, 'For 1 week')!.onSelect!();
    expect(run.mock.calls).toEqual([['archive'], ['mute-week']]);
  });

  it('WhatsApp adds contacts, assigning and waiting or done; Website chats assign, transfer and close', () => {
    const wa = { id: 7, kind: 'direct', name: 'Nimal', phone: '94770000007', status: 'open', unread: 1, is_pinned: 0, is_muted: 0, assigned_name: null } as unknown as WaChat;
    const w = whatsappMenu(wa, vi.fn());
    expect(labels(w)).toEqual(['Open on the web', 'Mark as read', 'Pin', 'Mute', 'Add to contacts', 'Assign to…', 'Mark as waiting', 'Mark as done']);
    expect(labels(item(w, 'Assign to…')!.submenu!)).toEqual(['Assign to me', 'Someone else…']);
    expect(labels(whatsappMenu({ ...wa, status: 'resolved', kind: 'group' }, vi.fn()))).toEqual(expect.arrayContaining(['Reopen']));
    expect(labels(whatsappMenu({ ...wa, kind: 'group' }, vi.fn()))).not.toContain('Add to contacts');

    const web = { id: 3, status: 'open', assigned_to: 7, visitor_name: 'Visitor', label: 'Visitor' } as unknown as WebsiteRow;
    const run = vi.fn();
    const m = websiteMenu(web, 7, [{ id: 7, name: 'Me' }, { id: 8, name: 'Kasun' }], run);
    expect(labels(m)).toEqual(['Open', 'Transfer', 'Unassign', 'Close conversation']);
    item(item(m, 'Transfer')!.submenu!, 'Kasun')!.onSelect!();
    expect(run).toHaveBeenCalledWith('transfer', 8);
    expect(labels(websiteMenu({ ...web, assigned_to: null }, 7, [], vi.fn()))).toEqual(['Open', 'Assign to me', 'Assign to…', 'Close conversation']);
    expect(labels(websiteMenu({ ...web, status: 'closed' }, 7, [], vi.fn()))).toEqual(['Open', 'Reopen conversation']);
  });

  it('several conversations: mark read, archive, mute and delete', () => {
    expect(labels(bulkMenu([room({ unread: 1 }), room({ id: 2 })], vi.fn()))).toEqual(['Mark as read', 'Archive', 'Mute', 'Delete chats']);
    expect(labels(bulkMenu([room({ archived: true, muted: true }), room({ id: 2, type: 'system', archived: true, muted: true })], vi.fn()))).toEqual(['Mark as unread', 'Unarchive', 'Unmute', 'Delete 1 chats']);
  });
});

describe('the shortcuts', () => {
  const key = (k: string, o: Partial<KeyboardEvent> = {}) => ({ key: k, metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, ...o });
  it('Mod+Shift+U, Mod+E, Mod+Shift+M, Mod+Backspace and Mod+Shift+P', () => {
    expect(shortcutAction(key('U', { shiftKey: true }), room({ unread: 1 }), false)).toBe('read');
    expect(shortcutAction(key('u', { shiftKey: true }), room({}), false)).toBe('unread');
    expect(shortcutAction(key('e'), room({}), false)).toBe('archive');
    expect(shortcutAction(key('e'), room({ archived: true }), false)).toBe('unarchive');
    expect(shortcutAction(key('M', { shiftKey: true }), room({}), false)).toBe('mute-always');
    expect(shortcutAction(key('M', { shiftKey: true }), room({ muted: true }), false)).toBe('unmute');
    expect(shortcutAction(key('Backspace'), room({}), false)).toBe('delete');
    expect(shortcutAction(key('P', { shiftKey: true }), room({}), false)).toBe('pin');
    // ⌘ on a Mac; Ctrl there is not the shortcut.
    expect(shortcutAction(key('e', { ctrlKey: false, metaKey: true }), room({}), true)).toBe('archive');
    expect(shortcutAction(key('e'), room({}), true)).toBeNull();
    // Nothing deletes or pins WorkSuite's own notices.
    expect(shortcutAction(key('Backspace'), room({ type: 'system' }), false)).toBeNull();
    expect(shortcutAction(key('P', { shiftKey: true }), room({ type: 'system' }), false)).toBeNull();
    expect(shortcutAction(key('e', { ctrlKey: false }), room({}), false)).toBeNull();
  });
});

describe('muting', () => {
  it('leaves a muted conversation out of the total, but an @mention in it still counts', () => {
    expect(chatUnread([room({ unread: 3 }), room({ id: 2, unread: 5, muted: true }), room({ id: 3, unread: 4, muted: true, mentions: 1 })])).toBe(4);
  });

  it('changes the list at once: a mute, a read, a mark unread', () => {
    expect(withFlags(room({ unread: 3 }), { muted: true, muted_minutes: 480 })).toMatchObject({ muted: true, muted_until: expect.any(String) });
    expect(withFlags(room({ unread: 3, mentions: 1 }), { read: true })).toMatchObject({ unread: 0, mentions: 0, marked_unread: false });
    expect(withFlags(room({}), { unread: true })).toMatchObject({ unread: 1, marked_unread: true });
  });
});

describe('presence from one place', () => {
  it('keeps the newest answer about each person, whoever asked', () => {
    recordPresence({ 8: 'online' }, 2000);
    recordPresence({ 8: 'offline', 9: 'away' }, 1000);
    expect(presenceOf(8)).toBe('online');
    expect(presenceOf(9)).toBe('away');
    recordPresence({ 8: 'offline' }, 3000);
    expect(presenceOf(8)).toBe('offline');
    expect(presenceOf(null)).toBeUndefined();
  });
});

describe('the chat list', () => {
  it('shows pins, mutes (a grey count), a hand-marked unread dot and presence on the rows', async () => {
    renderPage();
    await waitFor(() => expect(row('Design')).toBeTruthy());
    expect(within(row('Design')).getByLabelText('4 unread, muted').className).toContain('bg-ink-3');
    expect(within(row('Design')).getByLabelText('Muted')).toBeTruthy();
    expect(within(row('Kasun')).getByText('2').className).toContain('bg-primary');
    expect(within(row('Nimal')).getByLabelText('Pinned')).toBeTruthy();
    expect(within(row('Dilani')).getByLabelText('Marked unread')).toBeTruthy();
    await waitFor(() => expect(within(row('Kasun')).getByLabelText('Online')).toBeTruthy());
    expect(presenceOf(8)).toBe('online');
  });

  it('right-click opens the menu; Archive moves it to Archived at once and saves through the offline queue', async () => {
    renderPage();
    await waitFor(() => expect(row('Kasun')).toBeTruthy());
    fireEvent.contextMenu(row('Kasun'), { clientX: 40, clientY: 50 });
    const menu = await screen.findByRole('menu', { name: 'Actions — Kasun' });
    expect(within(menu).getByRole('menuitem', { name: /Open in new window/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Archive/ }));
    await waitFor(() => expect(submitted()).toHaveLength(1));
    expect(submitted()[0]).toMatchObject({ path: '/api/chat/rooms/1/flags', body: { archived: true }, method: 'POST', queueIfOffline: true });
    expect(screen.getByRole('button', { name: /Archived\s*1/ })).toBeTruthy();
  });

  it('refuses a sixth pin before asking the server', async () => {
    rooms = [1, 2, 3, 4, 5].map((id) => room({ id, name: `P${id}`, pinned: true })).concat(room({ id: 6, name: 'Sixth' }));
    renderPage();
    await waitFor(() => expect(row('Sixth')).toBeTruthy());
    row('Sixth').focus();
    fireEvent.keyDown(row('Sixth'), { key: 'P', ctrlKey: true, shiftKey: true });
    expect(toast).toHaveBeenCalledWith('error', 'You can pin up to 5 conversations. Unpin one first.');
    expect(submitted()).toHaveLength(0);
  });

  it('selects with Ctrl-click and Shift-click, and acts on all of them from the toolbar', async () => {
    renderPage();
    await waitFor(() => expect(row('Kasun')).toBeTruthy());
    fireEvent.click(row('Kasun'));
    expect(tab.go).toHaveBeenCalledWith('/chat?room=1');
    fireEvent.click(row('Dilani'), { ctrlKey: true });
    const bar = screen.getByRole('toolbar', { name: 'Selected conversations' });
    expect(within(bar).getByText('1 selected')).toBeTruthy();
    fireEvent.click(row('Kasun'), { shiftKey: true });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    expect(row('Kasun').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(bar).getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(submitted()).toHaveLength(1));
    expect(submitted()[0]!.path).toBe('/api/chat/rooms/flags');
    expect((submitted()[0]!.body.room_ids as number[]).sort()).toEqual([1, 4]);
    expect(submitted()[0]!.body.muted).toBe(true);
    expect(screen.queryByRole('toolbar', { name: 'Selected conversations' })).toBeNull();
  });

  it('Select mode: clicking picks instead of opening, and right-click acts on the picked ones', async () => {
    renderPage();
    await waitFor(() => expect(row('Kasun')).toBeTruthy());
    tab.go.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Select conversations' }));
    fireEvent.click(row('Kasun'));
    fireEvent.click(row('Nimal'));
    expect(tab.go).not.toHaveBeenCalled();
    fireEvent.contextMenu(row('Nimal'));
    const menu = await screen.findByRole('menu', { name: 'Conversation actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Mark as read/ }));
    await waitFor(() => expect(submitted()).toHaveLength(1));
    expect(submitted()[0]!.body).toMatchObject({ read: true });
  });

  it('moves with the arrows, and the shortcuts act on the focused conversation', async () => {
    renderPage();
    await waitFor(() => expect(row('Kasun')).toBeTruthy());
    row('Nimal').focus();
    fireEvent.keyDown(row('Nimal'), { key: 'ArrowDown' });
    expect(document.activeElement).not.toBe(row('Nimal'));
    const focused = document.activeElement as HTMLElement;
    expect(focused.hasAttribute('data-room-row')).toBe(true);
    fireEvent.keyDown(focused, { key: 'e', ctrlKey: true });
    await waitFor(() => expect(submitted()).toHaveLength(1));
    expect(submitted()[0]!.body).toEqual({ archived: true });
    fireEvent.keyDown(row('Nimal'), { key: 'U', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(submitted()).toHaveLength(2));
    expect(submitted()[1]).toMatchObject({ path: '/api/chat/rooms/3/flags', body: { unread: true } });
  });

  it('deletes after asking, with Undo for five seconds; the server is told only after', async () => {
    renderPage();
    await waitFor(() => expect(row('Kasun')).toBeTruthy());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    row('Kasun').focus();
    fireEvent.keyDown(row('Kasun'), { key: 'Backspace', ctrlKey: true });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete this chat?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(row('Kasun')).toBeUndefined());
    const undo = vi.mocked(toast).mock.calls.find(([, text]) => text === 'Chat with Kasun deleted.');
    expect(undo?.[2]?.label).toBe('Undo');
    expect(undo?.[3]).toBe(UNDO_MS);
    act(() => undo![2]!.run());
    await waitFor(() => expect(row('Kasun')).toBeTruthy());
    await act(async () => void vi.advanceTimersByTime(UNDO_MS + 100));
    expect(apiPost).not.toHaveBeenCalledWith('/api/chat/rooms/1/delete');

    // Without Undo, the server deletes it for me after five seconds.
    fireEvent.contextMenu(row('Kasun'));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Delete chat/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(row('Kasun')).toBeUndefined());
    expect(apiPost).not.toHaveBeenCalledWith('/api/chat/rooms/1/delete');
    await act(async () => void vi.advanceTimersByTime(UNDO_MS + 100));
    expect(apiPost).toHaveBeenCalledWith('/api/chat/rooms/1/delete');
  });

  it('clears after asking, keeping starred messages unless told otherwise; deleting a group for everyone asks separately', async () => {
    renderPage();
    await waitFor(() => expect(row('Design')).toBeTruthy());
    fireEvent.contextMenu(row('Design'));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Clear chat/ }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('checkbox', { name: 'Keep starred messages' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear chat' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/rooms/2/clear', { keep_starred: true }));

    fireEvent.contextMenu(row('Design'));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Delete group/ }));
    const sure = await screen.findByRole('dialog');
    expect(within(sure).getByText('Delete this group for everyone?')).toBeTruthy();
    fireEvent.click(within(sure).getByRole('button', { name: 'Delete for everyone' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/rooms/2/delete-for-everyone'));
  });

  it('exports through the download manager, as text or a zip with media', async () => {
    renderPage();
    await waitFor(() => expect(row('Kasun')).toBeTruthy());
    fireEvent.contextMenu(row('Kasun'));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Export chat/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Zip file (.zip)' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include media' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { chatExport: { room: 1, format: 'zip', media: true }, name: 'Chat - Kasun.zip' }));
  });
});

describe('the same menu on the other channels', () => {
  const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

  it('WhatsApp: right-click a conversation, mark it done', async () => {
    tab.route = '/chat?channel=whatsapp';
    const wa = { id: 7, account_id: 1, kind: 'direct', name: 'Nimal Perera', phone: '94770000007', status: 'open', unread: 0, is_pinned: 0, is_muted: 0, last_message: 'Hi', last_message_at: '2026-10-01 09:00:00', last_direction: 'in', awaiting_since: null, waiting_minutes: null, overdue: false, account_name: 'Sales', assigned_name: null };
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/whatsapp/chats' ? { chats: [wa] } : {}) as never);
    const account = { id: 1, name: 'Sales', provider: 'web_js', phone: '94771234567', status: 'connected', status_note: null, is_default: true, can_send: true, can_connect: true, unread: 0 } as WaAccount;
    wrap(<WhatsappChannel accounts={[account]} loading={false} error={null} retry={() => undefined} onConnect={null} />);
    const name = await screen.findByText('Nimal Perera');
    fireEvent.contextMenu(name.closest('button')!);
    const menu = await screen.findByRole('menu', { name: 'Actions — Nimal Perera' });
    expect(within(menu).getByRole('menuitem', { name: /Add to contacts/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Mark as done/ }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/whatsapp/chats/7', { status: 'resolved' }));
  });

  it('Website: right-click a visitor, close the conversation', async () => {
    tab.route = '/chat?view=website';
    const row = { id: 12, widget_id: 1, label: 'Visitor 12', visitor_name: 'Amaya', email: null, site: 'shop', status: 'open', assigned_to: null, agent: null, online: true, current_url: null, awaiting_reply: true, at_risk: false, priority: 'normal', waiting_since: null, last_visitor_at: '2026-10-01 09:00:00', updated_at: '2026-10-01 09:00:00' };
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/chat/widget-admin/conversations' ? { conversations: [row], can: { view: true, reply: true } } : path.endsWith('/agents') ? { agents: [] } : path.endsWith('/visitors') ? { visitors: [] } : path.endsWith('/missed/count') ? { count: 0 } : {}) as never);
    app.set({ auth: { stage: 'ready', user: { id: '7' } } } as never);
    vi.mocked(call).mockImplementation((async (ch: string) => (ch === 'ring:state' ? { chats: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false } : null)) as never);
    wrap(<WebsiteWorkspace />);
    const name = await screen.findByText('Amaya');
    fireEvent.contextMenu(name.closest('button')!);
    const menu = await screen.findByRole('menu', { name: 'Actions — Amaya' });
    expect(within(menu).getByRole('menuitem', { name: /Assign to me/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Close conversation/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Conversation closed.'));
    expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/12/action', { body: { action: 'close' } });
    app.set({ auth: undefined } as never);
  });
});
