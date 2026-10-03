// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingChat, WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * The Website Chats inbox as drawn in WS-WCHAT-SRS v1.5 (CHAT-UI-00): Open, Mine and Closed over the list, rows
 * with the on-site dot, waiting timer and chips, a chat silenced on this computer marked amber (RING-UI-04), the
 * "Pick a conversation" empty state, and J / K through the list.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})) }));
const realtime: Array<(e: unknown) => void> = [];
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (channel: string, cb: (e: unknown) => void) => {
    if (channel === 'realtime:event') realtime.push(cb);
    return () => undefined;
  },
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })) }));
vi.mock('../../../src/modules/chat/website/WebsiteThread', () => ({ WebsiteThread: ({ id }: { id: string }) => <div>Thread {id}</div> }));
const tab = { route: '/chat?view=website', go: vi.fn(), active: true };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: tab.active, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import type { WebsiteCallback, WebsiteRow } from '../../../src/modules/chat/website/api';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const row = (over: Partial<WebsiteRow>): WebsiteRow => ({
  id: 1, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: true, inactive: false, label: 'Visitor 1', visitor_name: null,
  email: null, country: null, browser: null, os: null, device: null, current_url: null, last_seen: null, status: 'open',
  is_offline: false, priority: 'normal', updated_at: ago(0), agent: null, assigned_to: null, started_at: null,
  last_visitor_at: null, waiting_since: null, at_risk: false, awaiting_reply: false, rating: null, is_starred: false, tags: null,
  ...over,
});
const ROWS = [
  row({ id: 1, visitor_name: 'Hasitha', awaiting_reply: true, waiting_since: ago(3 * 60_000 + 5_000), current_url: 'https://techubiz.com/pricing' }),
  row({ id: 2, visitor_name: 'Ahmed', online: false, awaiting_reply: true, waiting_since: ago(9 * 60_000), priority: 'vip' }),
  row({ id: 3, visitor_name: 'Kasun P.', assigned_to: 7, agent: 'Me', last_visitor_at: ago(120_000) }),
];
const ring = (over: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 2, visitor: 'Ahmed', site: 'techubiz.com', page: null, place: null, device: null, returning: false, preview: 'Is the Windows 7 ISO still available?',
  priority: 'vip', offline: false, since: ago(9 * 60_000), stage: 'everyone', atRisk: false, mine: false, by: null, silenced: true, ...over,
});

let callbacks: WebsiteCallback[] = [];
let missedList: unknown[] = [];

function serve(rows = ROWS, chats: WebchatRingChat[] = [ring({})], handoffs: NonNullable<WebchatRingState['handoffs']> = []) {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations') return { conversations: rows, can: { view: true, reply: true, manage: false } };
    if (path === '/api/chat/widget-admin/visitors') return { visitors: [{ id: 1 }, { id: 2 }] };
    if (path === '/api/chat/widget-admin/missed/count') return { count: 1 };
    if (path === '/api/chat/widget-admin/missed') return { missed: missedList, count: missedList.length };
    if (path === '/api/chat/widget-admin/callbacks') return { callbacks };
    throw new Error(`unexpected ${path}`);
  }) as never);
  const state: WebchatRingState = { chats, handoffs, tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false };
  vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state : null)) as never);
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const list = () => screen.getByRole('region', { name: 'Conversations' });

beforeEach(() => {
  localStorage.clear();
  tab.route = '/chat?view=website';
  tab.active = true;
  tab.go.mockReset();
  app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
  callbacks = [];
  missedList = [];
  serve();
});
afterEach(() => cleanup());

describe('the Website Chats inbox (CHAT-UI-00)', () => {
  it('with nothing open, says who is waiting and goes straight to the longest wait or the visitors online', async () => {
    wrap(<WebsiteWorkspace />);
    expect(await screen.findByText('2 visitors are waiting for a reply. The longest has waited 9 minutes.')).toBeTruthy();
    expect(screen.getByText('Pick a conversation')).toBeTruthy();
    expect(screen.getByText(/to move through the list/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the longest waiting' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=2');
    fireEvent.click(await screen.findByRole('button', { name: 'Visitors online · 2' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=live');
  });

  it('draws each row with its timer, chips and site, and marks a chat silenced here', async () => {
    wrap(<WebsiteWorkspace />);
    const hasitha = (await within(list()).findByText('Hasitha')).closest('button')!;
    expect(within(hasitha).getByText(/^3:0\d$/).className).toContain('text-danger');
    expect(within(hasitha).getByText('Awaiting reply')).toBeTruthy();
    expect(within(hasitha).getByText('Reading /pricing')).toBeTruthy();
    expect(within(hasitha).getByText('On the site now')).toBeTruthy();

    const ahmed = within(list()).getByText('Ahmed').closest('button')!;
    expect(await within(ahmed).findByRole('img', { name: 'Silenced on this computer' })).toBeTruthy();
    expect(ahmed.className).toContain('bg-warning-bg');
    expect(within(ahmed).getByText('“Is the Windows 7 ISO still available?”')).toBeTruthy();
    expect(within(ahmed).getByText('VIP')).toBeTruthy();
    expect(within(ahmed).getByText('techubiz.com · away')).toBeTruthy();

    const kasun = within(list()).getByText('Kasun P.').closest('button')!;
    expect(within(kasun).getByText('You')).toBeTruthy();
    expect(within(kasun).getByText('With you')).toBeTruthy();
  });

  it('says what was said last and how much is unread', async () => {
    serve([
      row({ id: 1, visitor_name: 'Hasitha', unread: 2, last_message: { id: 9, body: 'Is there an education discount?', file: null, from: 'visitor', agent: null, at: ago(60_000) } }),
      row({ id: 3, visitor_name: 'Kasun P.', assigned_to: 7, agent: 'Me', last_message: { id: 8, body: 'Yes, island-wide.', file: null, from: 'agent', agent: 'Samali Perera', at: ago(60_000) } }),
      row({ id: 4, visitor_name: 'Dilan', last_message: { id: 7, body: null, file: 'invoice.pdf', from: 'agent', agent: 'Nimal Silva', at: ago(60_000) } }),
    ], []);
    app.set({ auth: { stage: 'ready', user: { id: '7' } }, bootstrap: { user: { name: 'Samali Perera' } } } as never);
    wrap(<WebsiteWorkspace />);
    const hasitha = (await within(list()).findByText('Hasitha')).closest('button')!;
    expect(within(hasitha).getByText('Is there an education discount?').className).toContain('font-semibold');
    expect(within(hasitha).getByLabelText('2 unread').textContent).toBe('2');
    const kasun = within(list()).getByText('Kasun P.').closest('button')!;
    expect(within(kasun).getByText('You: Yes, island-wide.')).toBeTruthy();
    expect(within(kasun).queryByLabelText(/unread/)).toBeNull();
    expect(within(list()).getByText('Nimal Silva: 📎 invoice.pdf')).toBeTruthy();
  });

  it('searches what was said on the server, closed chats too, once typing pauses', async () => {
    const found = row({ id: 8, visitor_name: 'Old customer', status: 'closed', online: false, last_message: { id: 5, body: 'The invoice shows the wrong company name', file: null, from: 'visitor', agent: null, at: ago(86_400_000) } });
    const base = vi.mocked(apiGet).getMockImplementation()!;
    vi.mocked(apiGet).mockImplementation((async (path: string, query?: Record<string, string>) => (query?.q ? { conversations: query.q === 'wrong company' ? [found] : [], can: { view: true, reply: true, manage: false } } : base(path, query as never))) as never);
    wrap(<WebsiteWorkspace />);
    await within(list()).findByText('Hasitha');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search visitors' }), { target: { value: 'wrong company' } });
    expect(await within(list()).findByText('Old customer', undefined, { timeout: 2000 })).toBeTruthy();
    expect(within(list()).queryByText('Hasitha')).toBeNull();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/api/chat/widget-admin/conversations', { q: 'wrong company' }, expect.anything());
    fireEvent.change(screen.getByRole('textbox', { name: 'Search visitors' }), { target: { value: 'nobody said this' } });
    expect(await within(list()).findByText('Nothing matches “nobody said this”', undefined, { timeout: 2000 })).toBeTruthy();
  });

  it('Mine includes chats I take part in, and a chat several staff are in shows their faces (ENH-WCHAT-03)', async () => {
    serve([
      row({ id: 1, visitor_name: 'Hasitha', assigned_to: 9, agent: 'Nuwan', my_role: 'participant',
        team: [{ user_id: 9, name: 'Nuwan Perera', avatar: null, role: 'owner' }, { user_id: 7, name: 'Me Myself', avatar: null, role: 'participant' }] }),
      row({ id: 2, visitor_name: 'Ahmed', assigned_to: 9, agent: 'Nuwan' }),
    ], []);
    wrap(<WebsiteWorkspace />);
    const hasitha = (await within(list()).findByText('Hasitha')).closest('button')!;
    expect(within(hasitha).getByText('Participant')).toBeTruthy();
    expect(within(hasitha).getByLabelText('In this chat: Nuwan Perera, Me Myself')).toBeTruthy();
    fireEvent.click(within(list()).getByRole('button', { name: 'Mine · 1' }));
    expect(within(list()).getByText('Hasitha')).toBeTruthy();
    expect(within(list()).queryByText('Ahmed')).toBeNull();
  });

  it('Invited lists the invitations and transfers waiting for me, with Join chat and Decline (TEAM-09)', async () => {
    serve(ROWS, [], [
      { id: 21, conversationId: 4, kind: 'invite', mode: 'warm', visitor: 'Visitor 77AB', site: 'techubiz.com', page: null, from: 'Nuwan', department: null, toAny: false,
        note: 'Education pricing?', expiresAt: new Date(Date.now() + 90_000).toISOString(), createdAt: new Date().toISOString() },
      { id: 22, conversationId: 5, kind: 'transfer', mode: 'warm', visitor: 'Visitor 12', site: null, page: null, from: 'Dilini', department: 'Billing', toAny: false,
        note: null, expiresAt: null, createdAt: null },
    ]);
    tab.route = '/chat?view=website&section=invited';
    wrap(<WebsiteWorkspace />);
    const nav = screen.getByRole('navigation', { name: 'Website chats' });
    await waitFor(() => expect(within(nav).getByRole('button', { name: /Invited/ }).textContent).toBe('Invited2'));
    expect(within(list()).getByText('Nuwan invites you to join · techubiz.com')).toBeTruthy();
    expect(within(list()).getByText('“Education pricing?”')).toBeTruthy();
    expect(within(list()).getByText('Dilini asks you to take over (the Billing team)')).toBeTruthy();
    fireEvent.click(within(list()).getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: true });
    fireEvent.click(within(list()).getAllByRole('button', { name: 'Decline' })[1]!);
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 22, accept: false });
    // Opening one reads the chat.
    fireEvent.click(within(list()).getByText('Visitor 77AB'));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=invited&website=4');
  });

  it('a row on a voice call says so, with how long (ENH-WCHAT-05, VOICE-UI-02)', async () => {
    serve([row({ id: 1, visitor_name: 'Hasitha', call: { status: 'active', since: ago(134_000) } }), row({ id: 2, visitor_name: 'Ahmed', call: { status: 'ringing', since: ago(5_000) } })], []);
    wrap(<WebsiteWorkspace />);
    const hasitha = (await within(list()).findByText('Hasitha')).closest('button')!;
    expect(within(hasitha).getByText(/^On a call · 2:1\d$/)).toBeTruthy();
    const ahmed = within(list()).getByText('Ahmed').closest('button')!;
    expect(within(ahmed).getByText(/^Calling · 0:0\d$/)).toBeTruthy();
  });

  it('Missed chats lists the visitors waiting to be called back, and logs how the call went (VOICE-16)', async () => {
    callbacks = [{ id: 5, conversation_id: 9, phone: '+94 77 123 4567', best_time: 'After 5pm', visitor: 'Kamal', site: 'techubiz.com', missed_call: true, created_at: ago(600_000) }];
    serve(ROWS, []);
    tab.route = '/chat?view=website&section=missed';
    wrap(<WebsiteWorkspace />);
    const nav = screen.getByRole('navigation', { name: 'Website chats' });
    await waitFor(() => expect(within(nav).getByRole('button', { name: /Missed chats/ }).textContent).toBe('Missed chats2'));
    const group = await screen.findByRole('group', { name: 'Call backs' });
    expect(within(group).getByText('Call backs · 1')).toBeTruthy();
    expect(within(group).getByText('+94 77 123 4567')).toBeTruthy();
    expect(within(group).getByText(/After 5pm/)).toBeTruthy();
    expect(within(group).getByText('Missed call')).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'No answer' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/callbacks/5/done', { outcome: 'no_answer' }));
    fireEvent.click(within(group).getByText('Kamal'));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=missed&website=9');
  });

  it('a row says Typing… while its visitor types, and stops at once (LIVE-02)', async () => {
    wrap(<WebsiteWorkspace />);
    const kasun = (await within(list()).findByText('Kasun P.')).closest('button')!;
    act(() => realtime.forEach((cb) => cb({ type: 'chat.widget.typing', conversation_id: 3, who: 'visitor', state: 'start' })));
    expect(within(kasun).getByText('Typing…')).toBeTruthy();
    act(() => realtime.forEach((cb) => cb({ type: 'chat.widget.typing', conversation_id: 3, who: 'visitor', state: 'stop' })));
    expect(within(kasun).queryByText('Typing…')).toBeNull();
  });

  it('Open, Mine and Closed over the list, with their counts', async () => {
    wrap(<WebsiteWorkspace />);
    await within(list()).findByText('Hasitha');
    fireEvent.click(within(list()).getByRole('button', { name: 'Mine · 1' }));
    expect(within(list()).queryByText('Hasitha')).toBeNull();
    expect(within(list()).getByText('Kasun P.')).toBeTruthy();
    fireEvent.click(within(list()).getByRole('button', { name: 'Open · 3' }));
    expect(within(list()).getByText('Hasitha')).toBeTruthy();
    fireEvent.click(within(list()).getByRole('button', { name: 'Closed' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=closed');
  });

  it('J and K move through the list, but not while typing or from a tab behind', async () => {
    tab.route = '/chat?view=website&section=inbox&website=1';
    wrap(<WebsiteWorkspace />);
    await within(list()).findByText('Hasitha');
    fireEvent.keyDown(window, { key: 'j' });
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=2');
    tab.go.mockClear();
    fireEvent.keyDown(window, { key: 'k' });
    expect(tab.go).not.toHaveBeenCalled(); // already at the top
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search visitors' }), { key: 'j' });
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(tab.go).not.toHaveBeenCalled();
    cleanup();
    tab.active = false;
    wrap(<WebsiteWorkspace />);
    await within(list()).findByText('Hasitha');
    fireEvent.keyDown(window, { key: 'j' });
    expect(tab.go).not.toHaveBeenCalled();
  });
});
