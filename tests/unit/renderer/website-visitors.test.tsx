// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * Visitors online and the Live dashboard (worksuite-desktop#231): two views, each lit alone in the menu and apart from
 * Live chats; a visitor is selected by a click or the arrow keys, kept in the address, and their details open beside
 * the list with Start chat, Open chat, Invite a colleague and Block; Enter or a double-click goes to their chat; the
 * dashboard's figures open the views they count (C-00); and a visitor who leaves is said to have left.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({ conversation_id: 77 })), request: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })) }));
vi.mock('../../../src/modules/chat/website/WebsiteThread', () => ({ WebsiteThread: ({ id }: { id: string }) => <div>Thread {id}</div> }));
vi.mock('../../../src/modules/chat/website/widget/WidgetSettings', () => ({ WidgetSettings: () => <div>The widget settings</div> }));
const tab = { route: '/chat?view=website&section=visitors', go: vi.fn(), active: true };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: tab.active, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { visitorStatus } from '../../../src/modules/chat/website/api';
import type { OnlineVisitor } from '../../../src/modules/chat/website/WebsiteLive';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const visitor = (over: Partial<OnlineVisitor>): OnlineVisitor => ({
  id: 1, label: 'Visitor 1', name: null, email: null, widget_id: 1, website_name: 'techubiz.com', browser: 'Chrome', os: 'Windows', device: 'desktop',
  country: 'Sri Lanka', city: 'Colombo', current_url: 'https://techubiz.com/pricing', current_title: 'Pricing', landing_page: null, referrer: null,
  utm_campaign: null, pages: 3, visits: 1, on_site_seconds: 300, idle_seconds: 10, conversation_id: null, conversation_status: null, chat: null, ...over,
});
let online: OnlineVisitor[] = [];
const ONLINE = [
  visitor({ id: 1, name: 'Hasitha', conversation_id: 41, conversation_status: 'open', chat: { awaiting: true, waiting_since: ago(60_000), at_risk: false, agent: null } }),
  visitor({ id: 2, name: 'Kasun', city: 'Galle', conversation_id: 42, conversation_status: 'open', chat: { awaiting: false, waiting_since: null, at_risk: false, agent: 'Nimal Silva' } }),
  visitor({ id: 3, label: 'Visitor 7A3D', city: 'Kandy', visits: 4 }),
];
const DASHBOARD = {
  now: { visitors_online: 3, open: 2, pending: 0, waiting_on_us: 1, at_risk: 0, window_seconds: 300 },
  today: { visitors: 12, returning: 3, conversations: 5, missed: 1, page_views: 40, first_response_median: 75 },
  summary: { pages: [], countries: [], devices: [{ name: 'desktop', count: 3 }], referrers: [{ name: 'google.com', count: 2 }] },
  widgets: [{ id: 1, name: 'TechHub', online: 3 }],
};

function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations') return { conversations: [], can: { view: true, reply: true, manage: true } };
    if (path === '/api/chat/widget-admin/visitors') return { visitors: online };
    if (path === '/api/chat/widget-admin/dashboard') return DASHBOARD;
    if (path === '/api/chat/widget-admin/missed/count') return { count: 1 };
    if (path === '/api/chat/widget-admin/callbacks') return { callbacks: [] };
    if (path === '/api/chat/widget-admin/canned') return { responses: [{ id: 5, shortcut: null, title: 'Greeting', body: 'Hi! Looking for pricing?' }] };
    const m = /^\/api\/chat\/widget-admin\/visitors\/(\d+)\/activity$/.exec(path);
    if (m) {
      return {
        events: [
          { id: 1, kind: 'page_view', url: 'https://techubiz.com/', title: 'Home', at: ago(200_000), new_visit: true },
          { id: 2, kind: 'page_view', url: 'https://techubiz.com/pricing', title: 'Pricing', at: ago(60_000), new_visit: false },
        ],
        chats: m[1] === '3' ? [{ id: 30, status: 'closed', started_at: '2026-09-28 10:00:00', closed_at: '2026-09-28 10:20:00' }] : [],
        contact: m[1] === '3' ? { id: 5, name: 'Ruwan Jayasuriya' } : null,
        language: 'si-LK',
        landing_page: 'https://techubiz.com/',
      };
    }
    throw new Error(`unexpected ${path}`);
  }) as never);
  const state: WebchatRingState = { chats: [], handoffs: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false };
  vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state : null)) as never);
}

let client: QueryClient;
const mount = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WebsiteWorkspace /></QueryClientProvider>);
};
/** The tab follows the address it was sent to, as the real one does. */
const follow = (view: ReturnType<typeof mount>) => {
  tab.route = String(tab.go.mock.lastCall?.[0]);
  view.rerender(<QueryClientProvider client={client}><WebsiteWorkspace /></QueryClientProvider>);
};
const menu = () => screen.getByRole('navigation', { name: 'Website chats' });
const rows = () => screen.getByRole('listbox', { name: 'Visitors online' });
const pick = (name: string, choice: string) => {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(screen.getByRole('option', { name: choice }));
};
const option = (name: RegExp) => within(rows()).getAllByRole('option').find((o) => name.test(o.textContent ?? ''))!;

beforeEach(() => {
  localStorage.clear();
  tab.route = '/chat?view=website&section=visitors';
  tab.go.mockReset();
  online = [...ONLINE];
  app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
  vi.mocked(apiPost).mockClear();
  vi.mocked(request).mockClear();
  serve();
});
afterEach(() => cleanup());

describe('the LIVE menu (worksuite-desktop#231)', () => {
  it('has Visitors online and the Live dashboard as two views, each lit alone and apart from Live chats', async () => {
    const view = mount();
    expect(await screen.findByRole('heading', { name: 'Visitors online' })).toBeTruthy();
    const current = () => within(menu()).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.textContent);
    expect(current()).toEqual([expect.stringMatching(/^Visitors online/)]);

    fireEvent.click(within(menu()).getByRole('button', { name: 'Live dashboard' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=dashboard');
    follow(view);
    expect(await screen.findByRole('heading', { name: 'Live dashboard' })).toBeTruthy();
    expect(current()).toEqual(['Live dashboard']);

    // Live chats is a list of conversations, not the dashboard.
    fireEvent.click(within(menu()).getByRole('button', { name: 'Live chats' }));
    follow(view);
    expect(screen.queryByRole('heading', { name: 'Live dashboard' })).toBeNull();
    expect(current()).toEqual(['Live chats']);
  });
});

describe('Visitors online', () => {
  it('a click selects a visitor into the address, and their details open beside the list', async () => {
    const view = mount();
    await waitFor(() => expect(within(rows()).getAllByRole('option')).toHaveLength(3));
    expect(screen.getByText('Select a visitor to see their pages and start a conversation.')).toBeTruthy();

    fireEvent.click(option(/Visitor 7A3D/));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=visitors&visitor=3');
    follow(view);
    const card = await screen.findByRole('region', { name: 'Visitor details' });
    expect(option(/Visitor 7A3D/).getAttribute('aria-selected')).toBe('true');
    await within(card).findByText('si-LK');
    expect(within(card).getByText('Ruwan Jayasuriya')).toBeTruthy();
    // This visit, newest first: the page they are reading now, then where they landed.
    const pages = within(within(card).getByRole('list', { name: 'Pages this visit' })).getAllByRole('listitem');
    expect(pages.map((p) => p.textContent)).toEqual([expect.stringMatching(/^\/pricingNow/), '/Arrived directly']);
    expect(pages[0]!.getAttribute('aria-current')).toBe('page');
    expect(within(card).getByRole('button', { name: /closed/ })).toBeTruthy();

    // Escape closes them.
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=visitors');
  });

  it('the arrow keys move, Enter goes to the chat, and a double-click does too', async () => {
    tab.route = '/chat?view=website&section=visitors&visitor=1';
    mount();
    await screen.findByRole('region', { name: 'Visitor details' });
    const first = option(/Hasitha/);
    expect(first.tabIndex).toBe(0);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=visitors&visitor=2');
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=41');
    fireEvent.doubleClick(option(/Kasun/));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=42');
  });

  it('says Waiting, Chatting or Browsing, filters by it, and the status goes to the chat or to Start chat', async () => {
    const view = mount();
    await waitFor(() => expect(within(rows()).getAllByRole('option')).toHaveLength(3));
    expect(within(option(/Hasitha/)).getByRole('button', { name: /^Waiting 1:0\d$/ })).toBeTruthy();
    expect(within(option(/Kasun/)).getByRole('button', { name: 'Chatting' })).toBeTruthy();

    fireEvent.click(within(option(/Kasun/)).getByRole('button', { name: 'Chatting' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=42');

    // Somebody browsing: LAST ACTIVE says Now, and goes to Start chat (C-07).
    fireEvent.click(within(option(/Visitor 7A3D/)).getByRole('button', { name: 'Now' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=visitors&visitor=3');
    follow(view);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message to Visitor 7A3D' })));

    pick('Show', 'Waiting');
    expect(within(rows()).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Hasitha')]);
  });

  it('starts a chat with a saved reply, and blocks somebody browsing', async () => {
    tab.route = '/chat?view=website&section=visitors&visitor=3';
    mount();
    const card = await screen.findByRole('region', { name: 'Visitor details' });
    // A saved-reply chip above the composer puts its words in the box; Send speaks first, counting the reply's use.
    fireEvent.click(await within(card).findByRole('button', { name: 'Greeting' }));
    expect(within(card).getByRole('textbox', { name: 'Message to Visitor 7A3D' })).toHaveProperty('value', 'Hi! Looking for pricing?');
    fireEvent.click(within(card).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/visitors/3/message', { message: 'Hi! Looking for pricing?', canned_id: 5 }));
    await waitFor(() => expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=77'));

    // Block, for as long as chosen: on the visitor, who has no chat.
    fireEvent.click(within(card).getByRole('button', { name: 'Block visitor' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Block' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/visitors/3/block', { days: 7, reason: null }));
  });

  it('a visitor in a chat has Open the chat, Invite a colleague and Block on their chat', async () => {
    tab.route = '/chat?view=website&section=visitors&visitor=2';
    mount();
    const card = await screen.findByRole('region', { name: 'Visitor details' });
    expect(within(card).getByText('In a chat with Nimal Silva')).toBeTruthy();
    // Already in a chat: no composer to speak first.
    expect(within(card).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Invite a colleague' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=42&invite=1');
    fireEvent.click(within(card).getByRole('button', { name: 'Block visitor' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Block' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/42/action', { body: { action: 'block', reason: null, days: 7 } }));
    fireEvent.click(within(card).getByRole('button', { name: 'Open the chat' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=42');
  });

  it('says when the selected visitor has left the site, and keeps what it showed', async () => {
    tab.route = '/chat?view=website&section=visitors&visitor=3';
    mount();
    const card = await screen.findByRole('region', { name: 'Visitor details' });
    await within(card).findByText('si-LK');
    online = ONLINE.slice(0, 2);
    await client.refetchQueries({ queryKey: ['website', 'visitors'] });
    expect(await within(card).findByRole('status')).toHaveProperty('textContent', expect.stringMatching(/^Left the site · /));
    expect(within(card).getByText('Ruwan Jayasuriya')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Start chat' })).toBeNull();
  });
});

describe('the Live dashboard', () => {
  // The dashboard's own design (worksuite-desktop C-00) is covered in website-dashboard.test.tsx; here, that it is
  // reached from the menu and still opens the views it counts and selects into the address.
  it('each figure opens the view it counts, and All visitors online goes to Visitors online', async () => {
    tab.route = '/chat?view=website&section=dashboard';
    online = [...ONLINE, ...Array.from({ length: 8 }, (_, i) => visitor({ id: 10 + i, label: `Visitor X${i}` }))];
    mount();
    // Counted as the visitor list counts them, so the figure, All 11 visitors online and the sidebar agree (#248).
    fireEvent.click(await screen.findByRole('listitem', { name: 'On the site now: 11 — see who' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=visitors');
    fireEvent.click(screen.getByRole('listitem', { name: /^Waiting on us: 1/ }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=awaiting');
    fireEvent.click(screen.getByRole('listitem', { name: /^Open chats: 2/ }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox');
    fireEvent.click(screen.getByRole('listitem', { name: /^First reply: 1:15/ }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=missed');

    fireEvent.click(await screen.findByRole('button', { name: 'All 11 visitors online →' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=visitors');
  });

  it('selects a visitor on the dashboard too', async () => {
    tab.route = '/chat?view=website&section=dashboard';
    mount();
    fireEvent.click(await screen.findByRole('listitem', { name: 'Hasitha' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=dashboard&visitor=1');
  });
});

describe('visitorStatus', () => {
  it('says Waiting when their open chat waits on us', () => {
    expect(visitorStatus({ conversation_status: 'open', idle_seconds: 5, chat: { awaiting: true } })[0]).toBe('Waiting');
    expect(visitorStatus({ conversation_status: 'open', idle_seconds: 5, chat: { awaiting: false } })[0]).toBe('Chatting');
    expect(visitorStatus({ conversation_status: 'closed', idle_seconds: 5, chat: { awaiting: true } })[0]).toBe('Active');
  });
});
