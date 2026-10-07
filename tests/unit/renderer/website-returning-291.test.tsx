// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingChat, WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * A returning visitor writes in a closed conversation (worksuite-desktop#291), on the agent's screens: the ringing card
 * says whose the last chat was — "Returning visitor · last chat with you on 16 Aug" — with the visitor's new message,
 * Join chat and the reply box; the chat leaves Closed for the top of Inbox and Awaiting reply, marked Reopened and on
 * the badge, as the event arrives; the thread draws the server's notes about the reopen and the routing as it draws
 * its other notes, and links a new chat to the one before it. A server without any of it is drawn as before.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
const listeners = vi.hoisted(() => new Map<string, Set<(payload: unknown) => void>>());
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (channel: string, cb: (payload: unknown) => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(cb);
    return () => listeners.get(channel)?.delete(cb);
  },
  errorMessage: (e: unknown) => String(e),
  isMac: true,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: () => <div>The composer</div>, websiteNoteDraftKey: (id: number) => ({ module: 'website-chat', context: `note:${id}` }) }));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/modules/chat/website/widget/WidgetSettings', () => ({ WidgetSettings: () => <div>The widget settings</div> }));
const tab = { route: '/chat?view=website&section=inbox', go: vi.fn(), active: true };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: tab.active, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { setRegional } from '../../../src/core/time';
import { websiteWaiting } from '../../../src/modules/chat/channels/channels';
import { followUpsFirst, reopenedWaiting, reopenInLists, sectionRows, sortWebsiteRows, type WebsiteConversation, type WebsiteListPage, type WebsiteRow } from '../../../src/modules/chat/website/api';
import { ConversationRow } from '../../../src/modules/chat/website/ConversationRow';
import { ClosedDetail } from '../../../src/modules/chat/website/Closed';
import { returningLine, WebchatRingWindow } from '../../../src/modules/chat/website/Ringing';
import { WebsiteThread } from '../../../src/modules/chat/website/WebsiteThread';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const W = '/api/chat/widget-admin';
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' ');
const emit = (channel: string, payload: unknown) => act(() => listeners.get(channel)?.forEach((cb) => cb(payload)));

// ---- the ringing card ----------------------------------------------------------------------------------------------

const chat = (over: Partial<WebchatRingChat> = {}): WebchatRingChat => ({
  id: 7, visitor: 'Visitor 4F2A', site: 'techubiz.com', page: '/shop/adobe', place: 'Colombo, LK', device: null, returning: true,
  preview: 'Hi again — the key stopped working', priority: 'normal', offline: false, since: new Date(Date.now() - 12_000).toISOString(), stage: 'first',
  atRisk: false, mine: false, by: null, silenced: false, visits: 3, othersRinging: 2,
  returnVisit: { reopened: true, previousAt: '2026-08-16 10:00:00', previousAgentId: 5, previousAgentName: 'Nuwan Silva', previousConversationId: null, withYou: true },
  ...over,
});
let ring: WebchatRingState = { chats: [chat()], tone: 'normal', volume: 80, outcome: null, hidden: false, shortcut: true };

// ---- the lists -----------------------------------------------------------------------------------------------------

const row = (over: Partial<WebsiteRow>): WebsiteRow => ({
  id: 1, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: false, inactive: false, label: 'Visitor 1A1A', visitor_name: null, email: null,
  country: 'LK', browser: null, os: null, device: null, current_url: null, last_seen: null, status: 'open', is_offline: false, priority: 'normal',
  updated_at: ago(2 * MIN), agent: null, assigned_to: null, started_at: ago(20 * MIN), last_visitor_at: ago(19 * MIN), waiting_since: null, at_risk: false,
  awaiting_reply: false, rating: null, is_starred: false, tags: null, ...over,
});
// Anne's chat closed on 16 Aug; Ravi and Kasun are waiting, Ravi the longest.
const ANNE = row({ id: 1, visitor_name: 'Anne', company: 'Acme Ltd', status: 'closed', closed_reason: 'agent', closed_by: 'Nuwan Silva', closed_at: '2026-08-16 10:20:00', rating: 5, subject: 'Activation fixed', agent: 'Nuwan Silva', assigned_to: 5, last_agent_at: '2026-08-16 10:15:00', unread: 0 });
const RAVI = row({ id: 2, visitor_name: 'Ravi', awaiting_reply: true, waiting_since: ago(9 * MIN), last_visitor_at: ago(9 * MIN), updated_at: ago(9 * MIN) });
const KASUN = row({ id: 3, visitor_name: 'Kasun', awaiting_reply: true, waiting_since: ago(4 * MIN), last_visitor_at: ago(4 * MIN), updated_at: ago(4 * MIN) });
const CAN = { view: true, reply: true, manage: true };

let open: WebsiteRow[] = [];
let closed: WebsiteRow[] = [];

// ---- the thread ----------------------------------------------------------------------------------------------------

const thread = (over: Partial<WebsiteConversation['conversation']> = {}, rest: Partial<WebsiteConversation> = {}): WebsiteConversation => ({
  conversation: { id: 41, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: false, assigned_to: null, visitor_typing: false, started_at: ago(10 * MIN), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false, ...over },
  visitor: {
    id: 9, label: 'Visitor 4F2A', name: 'Anne', email: null, phone: null, company: null, browser: 'Chrome', os: 'Windows', device: 'desktop', language: null, timezone: null,
    country: 'LK', city: 'Colombo', landing_page: null, current_url: null, current_title: null, referrer: null, utm_source: null, utm_campaign: null, visits: 3, first_seen: null, last_seen: ago(10_000), is_blocked: false,
  },
  messages: [
    { id: 1, body: 'My activation key says invalid.', from: 'visitor', agent: null, at: '2026-08-16 10:00:00', file: null },
    { id: 2, body: 'Fixed — please sign in again.', from: 'agent', agent: 'Nuwan Silva', agent_id: 5, at: '2026-08-16 10:15:00', file: null },
    { id: 3, body: 'Visitor returned · conversation reopened', from: 'system', agent: null, agent_id: null, at: ago(2 * MIN), file: null, visibility: 'internal' },
    { id: 4, body: 'Hi again — the key stopped working', from: 'visitor', agent: null, at: ago(2 * MIN), file: null },
    { id: 5, body: 'Ringing Nuwan Silva (previous agent)', from: 'system', agent: null, agent_id: null, at: ago(2 * MIN), file: null, visibility: 'internal' },
    { id: 6, body: 'Ringing the team', from: 'system', agent: null, agent_id: null, at: ago(MIN), file: null, visibility: 'internal' },
    { id: 7, body: 'No one available · offered callback', from: 'system', agent: null, agent_id: null, at: ago(MIN / 2), file: null, visibility: 'internal' },
  ],
  journey: [],
  history: [{ id: 30, status: 'closed', started_at: '2026-08-16 10:00:00', rating: 5, other_device: false }],
  can: CAN,
  ...rest,
});
let convo = thread();

const wrap = (ui: ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => ({ qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) });

beforeAll(() => setRegional({ timezone: 'UTC', locale: 'en-GB' }));

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  ring = { chats: [chat()], tone: 'normal', volume: 80, outcome: null, hidden: false, shortcut: true };
  open = [RAVI, KASUN];
  closed = [ANNE];
  convo = thread();
  tab.route = '/chat?view=website&section=inbox';
  tab.go.mockReset();
  listeners.clear();
  app.set({ auth: { stage: 'ready', user: { id: '5' } } as never });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string, params?: Record<string, string>) => {
    if (path === `${W}/conversations`) return { conversations: params?.status === 'closed' ? closed : open, can: CAN };
    if (path === `${W}/conversations/41`) return convo;
    if (path === `${W}/missed/count`) return { count: 0 };
    if (path === `${W}/callbacks/counts`) return { todo: 0, overdue: 0, mine: 0 };
    if (path === `${W}/offline`) return { offline: [], count: 0 };
    if (path === `${W}/visitors`) return { visitors: [] };
    if (path === `${W}/canned`) return { responses: [] };
    if (path === `${W}/agents`) return { agents: [] };
    return {};
  }) as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string) => (channel === 'ring:state' ? ring : channel === 'offline:pending' ? [] : null)) as never);
});
afterEach(() => cleanup());

describe('the ringing card says whose the last chat was (#291)', () => {
  it('mine: "Returning visitor · last chat with you on 16 Aug", the visitor’s new message, Join chat and the reply box', async () => {
    wrap(<WebchatRingWindow />);
    const card = await screen.findByRole('region', { name: 'WorkSuite incoming website chat' });
    const w = within(card);
    expect(w.getByText('Returning visitor · last chat with you on 16 Aug')).toBeTruthy();
    expect(w.getByText('Hi again — the key stopped working')).toBeTruthy();
    expect(w.getByRole('button', { name: 'Join chat' })).toBeTruthy();
    expect(w.getByLabelText('Reply and join')).toBeTruthy();
    expect(w.getByRole('button', { name: 'Send and join' })).toBeTruthy();
    // Join chat joins as for a new chat.
    vi.mocked(call).mockResolvedValueOnce({ ok: true, why: null } as never);
    fireEvent.click(w.getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 7, open: true });
  });

  it('a colleague’s last chat names them; nobody’s says only when', async () => {
    ring = { ...ring, chats: [chat({ returnVisit: { ...chat().returnVisit!, previousAgentId: 9, withYou: false } })] };
    wrap(<WebchatRingWindow />);
    expect(await screen.findByText('Returning visitor · last chat with Nuwan on 16 Aug')).toBeTruthy();
    emit('ring:changed', { ...ring, chats: [chat({ returnVisit: { ...chat().returnVisit!, previousAgentId: null, previousAgentName: null, withYou: false } })] });
    expect(screen.getByText('Returning visitor · last chat on 16 Aug')).toBeTruthy();
    expect(returningLine({ ...chat().returnVisit!, previousAt: null })).toBe('Returning visitor');
  });

  it('among several ringing chats, the returning visitor’s card says it too', async () => {
    ring = { ...ring, chats: [chat({ id: 8, visitor: 'Visitor 77B0', returning: false, returnVisit: undefined, preview: 'Do you ship to Galle?' }), chat()] };
    wrap(<WebchatRingWindow />);
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows.find((li) => li.getAttribute('aria-label') === 'Visitor 4F2A')!).getByText('Returning visitor · last chat with you on 16 Aug')).toBeTruthy();
    expect(within(rows.find((li) => li.getAttribute('aria-label') === 'Visitor 77B0')!).queryByText(/Returning visitor/)).toBeNull();
  });

  it('a chat that rang before rings again with its card, after the last ring ended', async () => {
    ring = { ...ring, chats: [], tone: 'off', outcome: { id: 7, kind: 'joined', by: 'Dilini', visitor: 'Visitor 4F2A', text: 'Dilini joined the chat with Visitor 4F2A', at: Date.now() } };
    wrap(<WebchatRingWindow />);
    await screen.findByRole('button', { name: 'View' });
    emit('ring:changed', { ...ring, chats: [chat()], tone: 'normal', outcome: null });
    expect(screen.getByRole('region', { name: 'WorkSuite incoming website chat' })).toBeTruthy();
    expect(screen.getByText('Returning visitor · last chat with you on 16 Aug')).toBeTruthy();
  });

  it('an older server: no returning line, the card as before; behind the lock nothing of it', async () => {
    ring = { ...ring, chats: [chat({ returnVisit: undefined })] };
    wrap(<WebchatRingWindow />);
    await screen.findByText('Hi again — the key stopped working');
    expect(screen.queryByText(/Returning visitor/)).toBeNull();
    expect(screen.getByText('3rd visit')).toBeTruthy();
    emit('ring:changed', { ...ring, hidden: true, chats: [chat({ visitor: 'A visitor', preview: null, returnVisit: null })] });
    expect(screen.queryByText(/Returning visitor/)).toBeNull();
  });
});

describe('the lists: out of Closed, to the top of Inbox and Awaiting reply, as the event arrives (#291)', () => {
  const list = () => screen.getByRole('region', { name: 'Conversations' });
  const names = () => Array.from(list().querySelectorAll('[data-website-row] b')).map((b) => b.textContent);

  it('Closed loses it; Inbox has it first, open and waiting, Reopened, with the new words; Awaiting reply too', async () => {
    tab.route = '/chat?view=website&section=closed';
    const { qc, rerender } = wrap(<WebsiteWorkspace />);
    await within(list()).findByText('Anne · Acme Ltd');
    emit('realtime:event', { type: 'chat.widget.message', conversation_id: 1, visitor: 'Anne', preview: 'Hi again — the key stopped working', message_id: 88, at: ago(0) });
    await waitFor(() => expect(within(list()).queryByText('Anne · Acme Ltd')).toBeNull());

    tab.route = '/chat?view=website&section=inbox';
    rerender(<QueryClientProvider client={qc}><WebsiteWorkspace /></QueryClientProvider>);
    expect(names()).toEqual(['Anne', 'Ravi', 'Kasun']);
    const anne = list().querySelector('[data-website-row="1"]') as HTMLElement;
    expect(within(anne).getByText('Reopened')).toBeTruthy();
    expect(within(anne).getByText('Hi again — the key stopped working')).toBeTruthy();
    expect(within(anne).getByText(/^Waiting/)).toBeTruthy();
    expect(within(anne).getByLabelText('1 unread')).toBeTruthy();
    expect(within(list()).getByRole('button', { name: 'Open · 3' })).toBeTruthy();
    // The menu's counts: Inbox and Awaiting reply count it now.
    const nav = screen.getByRole('navigation', { name: 'Website chats' });
    expect(within(within(nav).getByRole('button', { name: /Inbox/ })).getByText('3')).toBeTruthy();
    expect(within(within(nav).getByRole('button', { name: /Awaiting reply/ })).getByText('3')).toBeTruthy();

    // Awaiting reply, longest waiting first: the returning visitor nobody has answered yet comes before them.
    tab.route = '/chat?view=website&section=awaiting';
    rerender(<QueryClientProvider client={qc}><WebsiteWorkspace /></QueryClientProvider>);
    const grid = screen.getByRole('grid', { name: 'Awaiting reply' });
    const order = Array.from(grid.querySelectorAll('[data-website-row]')).map((r) => r.getAttribute('data-website-row'));
    expect(order).toEqual(['1', '2', '3']);
    expect(within(grid.querySelector('[data-website-row="1"]') as HTMLElement).getByText('Reopened')).toBeTruthy();
  });

  it('a ring on a chat held as closed moves it as well; the badge counts it', () => {
    const qc = new QueryClient();
    qc.setQueryData(['website', 'inbox', 'open'], { conversations: [RAVI, KASUN], can: CAN } satisfies WebsiteListPage);
    qc.setQueryData(['website', 'inbox', 'closed', 'pages'], { pages: [{ conversations: [ANNE, row({ id: 4, status: 'closed' })], can: CAN }], pageParams: [null] });
    qc.setQueryData(['website', 'inbox', 'search', 'all', 'anne'], { conversations: [ANNE], can: CAN });
    expect(websiteWaiting(qc.getQueryData<WebsiteListPage>(['website', 'inbox', 'open'])!.conversations)).toBe(2);
    expect(reopenInLists(qc, { type: 'chat.incoming', conversation_id: 1, visitor: 'Anne', preview: 'Hello?', at: '2026-10-07 09:00:00', returning: { reopened: true, previous_at: '2026-08-16 10:00:00', previous_agent_id: 5 } })).toBe(true);
    const rows = qc.getQueryData<WebsiteListPage>(['website', 'inbox', 'open'])!.conversations;
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ status: 'open', awaiting_reply: true, closed_at: null, reopened_at: '2026-10-07 09:00:00', waiting_since: '2026-10-07 09:00:00', last_message: { body: 'Hello?', from: 'visitor' } });
    expect(websiteWaiting(rows)).toBe(3);
    expect(sectionRows(rows, 'awaiting', 5).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(reopenedWaiting(rows[0]!)).toBe(true);
    const pages = qc.getQueryData<{ pages: WebsiteListPage[] }>(['website', 'inbox', 'closed', 'pages'])!.pages;
    expect(pages[0]!.conversations.map((r) => r.id)).toEqual([4]);
    expect(qc.getQueryData<WebsiteListPage>(['website', 'inbox', 'search', 'all', 'anne'])!.conversations[0]!.status).toBe('open');
    // Said once: the same event again changes nothing.
    expect(reopenInLists(qc, { type: 'chat.widget.message', conversation_id: 1, preview: 'Hello?' })).toBe(false);
    expect(qc.getQueryData<WebsiteListPage>(['website', 'inbox', 'open'])!.conversations.filter((r) => r.id === 1)).toHaveLength(1);
  });

  it('answered since it reopened, it is an ordinary waiting chat again', () => {
    const back = row({ id: 1, visitor_name: 'Anne', awaiting_reply: true, reopened_at: ago(5 * MIN), waiting_since: ago(MIN), last_agent_at: ago(3 * MIN) });
    expect(reopenedWaiting(back)).toBe(false);
    const order = followUpsFirst(sortWebsiteRows([KASUN, back, RAVI], 'waiting'), () => false).map((r) => r.id);
    expect(order).toEqual([2, 3, 1]);
    // Still unanswered: first.
    expect(followUpsFirst(sortWebsiteRows([KASUN, { ...back, last_agent_at: ago(60 * MIN) }, RAVI], 'waiting'), () => false).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('an older server, or a chat no list holds as closed: the lists wait for the read, as before', () => {
    const qc = new QueryClient();
    qc.setQueryData(['website', 'inbox', 'open'], { conversations: [RAVI, KASUN], can: CAN });
    // A new chat, a message in an open one, an assignment of a closed one without a returning visitor: nothing here.
    expect(reopenInLists(qc, { type: 'chat.incoming', conversation_id: 99 })).toBe(false);
    expect(reopenInLists(qc, { type: 'chat.widget.message', conversation_id: 2, preview: 'Still there?' })).toBe(false);
    qc.setQueryData(['website', 'inbox', 'closed', 'pages'], { pages: [{ conversations: [ANNE], can: CAN }], pageParams: [null] });
    expect(reopenInLists(qc, { type: 'chat.assigned', conversation_id: 1 })).toBe(false);
    expect(reopenInLists(qc, { type: 'chat.taken', conversation_id: 1 })).toBe(false);
    expect(qc.getQueryData<WebsiteListPage>(['website', 'inbox', 'open'])!.conversations.map((r) => r.id)).toEqual([2, 3]);
    // A row from a server without `reopened_at` has no Reopened mark.
    expect(reopenedWaiting(RAVI)).toBe(false);
  });

  it('the card list’s row says Reopened while the chat is open, not once it closed', () => {
    const r = row({ id: 1, visitor_name: 'Anne', awaiting_reply: true, waiting_since: ago(MIN), reopened_at: ago(MIN) });
    wrap(<ConversationRow r={r} me={5} myName="Nuwan Silva" active={false} onOpen={() => undefined} onMenu={() => undefined} />);
    expect(screen.getByText('Reopened')).toBeTruthy();
    cleanup();
    wrap(<ConversationRow r={{ ...r, status: 'closed' }} me={5} myName="Nuwan Silva" active={false} onOpen={() => undefined} onMenu={() => undefined} />);
    expect(screen.queryByText('Reopened')).toBeNull();
  });

  it('read under Closed as it reopens: "Open again", and Open chat takes it to the open thread', async () => {
    convo = thread({ id: 1, status: 'open', reopened_at: ago(MIN) });
    vi.mocked(apiGet).mockImplementation((async (path: string) => (path === `${W}/conversations/1` ? convo : {})) as never);
    const opened = vi.fn();
    wrap(<ClosedDetail id="1" onReopened={opened} />);
    expect(await screen.findByText(/Open again/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe('the thread: the server’s notes, and the chat before this one (#291)', () => {
  it('draws "Visitor returned · conversation reopened" and every routing step as the thread’s other notes', async () => {
    wrap(<WebsiteThread id="41" />);
    await screen.findByText('Hi again — the key stopped working');
    const notes = Array.from(document.querySelectorAll('[data-system]')).map((n) => n.textContent?.trim() ?? '');
    for (const words of ['Visitor returned · conversation reopened', 'Ringing Nuwan Silva (previous agent)', 'Ringing the team', 'No one available · offered callback']) {
      expect(notes.some((n) => n.startsWith(words))).toBe(true);
    }
    // Notes only staff see: the lock, never a bubble of anybody's.
    const reopened = Array.from(document.querySelectorAll('[data-system]')).find((n) => n.textContent?.trim().startsWith('Visitor returned'))!;
    expect(reopened.querySelector('[title="Only staff see this"]')).toBeTruthy();
    expect(reopened.closest('[data-bubble]')).toBeNull();
  });

  it('a new chat after the reopen window links the one before it, opened under Closed — never joined by a look', async () => {
    convo = thread({ previous_conversation_id: 30 });
    wrap(<WebsiteThread id="41" />);
    const link = await screen.findByRole('button', { name: /Previous chats/ });
    expect(link.textContent).toContain('16 Aug 2026');
    fireEvent.click(link);
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=closed&website=30');
  });

  it('without `previous_conversation_id` (an older server, or the same chat reopened) there is no such link', async () => {
    wrap(<WebsiteThread id="41" />);
    await screen.findByText('Hi again — the key stopped working');
    expect(screen.queryByRole('button', { name: /^Previous chats/ })).toBeNull();
  });
});
