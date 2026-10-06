// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * C-06, Closed chat — transcript, rating, reopen (X-UI-04; UX-CLS-01, UX-CLS-02, IDL-03, IDL-04): the Closed list in
 * the order chats ended, each row saying how it ended and its stars; the chat read back without arriving in it, with
 * its rating, Star, Block visitor and Reopen, the composer replaced by a locked notice; and the summary panel — first
 * reply, duration, priority and rating tiles, who handled it, the tags, the contact and the files shared.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
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
const tab = { route: '/chat?view=website&section=closed', go: vi.fn(), active: true };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: tab.active, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import type { WebsiteConversation, WebsiteRow } from '../../../src/modules/chat/website/api';
import { closedHow, closedLine } from '../../../src/modules/chat/website/Closed';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;

const row = (over: Partial<WebsiteRow>): WebsiteRow => ({
  id: 1, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: false, inactive: false, label: 'Visitor 1A1A', visitor_name: null, email: null,
  country: 'LK', browser: null, os: null, device: null, current_url: null, last_seen: null, status: 'closed', is_offline: false, priority: 'normal',
  updated_at: ago(2 * MIN), agent: null, assigned_to: null, started_at: ago(20 * MIN), last_visitor_at: ago(19 * MIN), waiting_since: null, at_risk: false,
  awaiting_reply: false, rating: null, is_starred: false, tags: null, ...over,
});

const ANNE = row({ id: 1, visitor_name: 'Anne', company: 'Acme Ltd', email: 'anne@acme.lk', rating: 5, subject: 'Activation fixed', closed_by: 'Nuwan Silva', closed_reason: 'agent', closed_at: ago(2 * MIN), agent: 'Nuwan Silva', priority: 'urgent' });
const IDLE = row({ id: 2, label: 'Visitor 3D11', closed_reason: 'idle', closed_at: ago(26 * 60 * MIN) });
const KAMAL = row({ id: 3, visitor_name: 'Kamal F.', rating: 4, closed_reason: 'visitor', closed_at: ago(4 * 24 * 60 * MIN), last_message: { id: 9, body: 'Thanks for the quote', file: null, from: 'visitor', agent: null, at: ago(4 * 24 * 60 * MIN) } });

const started = ago(18 * MIN);
const conversation = (over: Partial<WebsiteConversation['conversation']> = {}, rest: Partial<WebsiteConversation> = {}): WebsiteConversation => ({
  conversation: {
    id: 1, widget: 'TechHub', website: 'techubiz.com', status: 'closed', is_offline: false, inactive: false, assigned_to: 3, visitor_typing: false,
    started_at: started, closed_at: new Date(new Date(started).getTime() + 16 * MIN).toISOString(), first_response_at: new Date(new Date(started).getTime() + 58_000).toISOString(),
    rating: 5, rating_comment: 'Fast and clear', tags: 'activation,microsoft-365', is_starred: false, priority: 'urgent',
    closed_reason: 'agent', closed_by: { id: 3, name: 'Nuwan Silva', avatar: null }, ...over,
  },
  visitor: {
    id: 9, label: 'Visitor 1A1A', name: 'Anne', email: 'anne@acme.lk', phone: null, company: 'Acme Ltd', browser: 'Chrome', os: 'Windows', device: 'desktop', language: null, timezone: null,
    country: 'LK', city: 'Kandy', landing_page: null, current_url: null, current_title: null, referrer: null, utm_source: null, utm_campaign: null,
    visits: 2, first_seen: null, last_seen: ago(3 * MIN), is_blocked: false,
  },
  messages: [
    { id: 1, body: 'My activation key says invalid on the second laptop.', from: 'visitor', agent: null, at: started, file: null },
    { id: 2, body: 'Your licence covers 1 device — I’ve moved it to the new laptop. Please sign in again.', from: 'agent', agent: 'Nuwan Silva', agent_id: 3, at: ago(16 * MIN), file: null },
    { id: 3, body: 'Working now, thank you!', from: 'visitor', agent: null, at: ago(15 * MIN), file: null },
  ],
  journey: [{ url: 'https://techubiz.com/support/activation', title: 'Activation', at: started }],
  history: [],
  chats: { count: 2, first_at: '2026-09-12 08:00:00' },
  can: { view: true, reply: true, manage: true },
  ...rest,
});

let closed: WebsiteRow[] = [];
let convo = conversation();

function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string, params?: Record<string, string>) => {
    if (path === '/api/chat/widget-admin/conversations') return { conversations: params?.status === 'closed' ? closed : [], can: { view: true, reply: true, manage: true } };
    if (path === '/api/chat/widget-admin/visitors') return { visitors: [] };
    if (path === '/api/chat/widget-admin/missed/count') return { count: 0 };
    if (path === '/api/chat/widget-admin/callbacks/counts') return { todo: 0, overdue: 0, mine: 0 };
    if (path === '/api/chat/widget-admin/offline') return { offline: [], count: 0 };
    if (path === '/api/chat/widget-admin/conversations/1') return convo;
    throw new Error(`unexpected ${path}`);
  }) as never);
  const state: WebchatRingState = { chats: [], handoffs: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false };
  vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state : null)) as never);
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const list = () => screen.getByRole('region', { name: 'Conversations' });
const posted = () => vi.mocked(request).mock.calls.map(([method, path, opts]) => [method, path, (opts as { body?: unknown } | undefined)?.body]);

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  closed = [ANNE, IDLE, KAMAL];
  convo = conversation();
  tab.route = '/chat?view=website&section=closed';
  tab.go.mockReset();
  vi.mocked(request).mockClear();
  vi.mocked(toast).mockClear();
  app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
  serve();
});
afterEach(() => cleanup());

describe('the Closed list (C-06)', () => {
  it('asks for closed chats, keeps the server’s order of closing, and has no Open / Mine pills', async () => {
    wrap(<WebsiteWorkspace />);
    await within(list()).findByText('Anne · Acme Ltd');
    // A page of list fields at a time (worksuite-desktop#252).
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/conversations', { status: 'closed', fields: 'list', limit: '50' }, expect.anything());
    const names = Array.from(list().querySelectorAll('[data-website-row] b')).map((b) => b.textContent);
    expect(names).toEqual(['Anne · Acme Ltd', 'Visitor 3D11', 'Kamal F.']);
    expect(within(list()).queryByRole('group', { name: 'Show' })).toBeNull();
    expect((within(list()).getByLabelText('Search visitors') as HTMLInputElement).placeholder).toBe('Search closed chats…');
  });

  it('each row says how it ended and shows the stars it got', async () => {
    wrap(<WebsiteWorkspace />);
    const anne = (await within(list()).findByText('Anne · Acme Ltd')).closest('button')!;
    expect(within(anne).getByText('Activation fixed · Nuwan')).toBeTruthy();
    expect(within(anne).getByRole('img', { name: 'Rated 5 out of 5' }).textContent).toBe('★★★★★');
    const idle = within(list()).getByText('Visitor 3D11').closest('button')!;
    expect(within(idle).getByText('Inactive · closed automatically')).toBeTruthy();
    expect(within(idle).queryByRole('img', { name: /Rated/ })).toBeNull();
    const kamal = within(list()).getByText('Kamal F.').closest('button')!;
    expect(within(kamal).getByRole('img', { name: 'Rated 4 out of 5' }).textContent).toBe('★★★★☆');
    fireEvent.click(anne);
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=closed&website=1');
  });

  it('says so when there are none', async () => {
    closed = [];
    wrap(<WebsiteWorkspace />);
    expect(await within(list()).findByText('No closed chats')).toBeTruthy();
  });

  it('puts the end in words', () => {
    expect(closedLine({ closed_reason: 'visitor', closed_by: null, subject: null, last_message: KAMAL.last_message, email: null })).toBe('Thanks for the quote · ended by the visitor');
    expect(closedLine({ closed_reason: null, closed_by: null, subject: null, last_message: null, email: 'a@b.lk' })).toBe('a@b.lk');
    expect(closedHow({ closed_at: null, closed_reason: 'idle', closed_by: null })).toBe('Closed automatically as inactive');
    expect(closedHow({ closed_at: null, closed_reason: 'visitor', closed_by: null })).toBe('Ended by the visitor');
    expect(closedHow({ closed_at: ago(MIN), closed_reason: 'agent', closed_by: { id: 3, name: 'Nuwan Silva' } })).toMatch(/^Closed by Nuwan at .+/);
    expect(closedHow({ closed_at: null, closed_reason: null, closed_by: null })).toBe('Closed');
  });
});

describe('the closed chat (C-06, UX-CLS-01)', () => {
  beforeEach(() => {
    tab.route = '/chat?view=website&section=closed&website=1';
  });

  it('reads the transcript back without arriving, with the rating after it and the locked notice in place of the composer', async () => {
    wrap(<WebsiteWorkspace />);
    expect(await screen.findByText('My activation key says invalid on the second laptop.')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/1', { review: '1' }, expect.anything());
    expect(screen.queryByText('Thread 1')).toBeNull();

    expect(screen.getByText(/^Closed by Nuwan at .+ · 16 min · techubiz\.com$/)).toBeTruthy();
    expect(screen.getByText(/· started from \/support\/activation$/)).toBeTruthy();
    const transcript = screen.getByRole('region', { name: 'Transcript' });
    expect(within(transcript).getByText('Rated 5 by the visitor · “Fast and clear”')).toBeTruthy();
    expect(within(transcript).getByRole('note').textContent).toBe('This chat is closed. Reopen it to reply; the visitor sees your message if they are still on the site.');
    expect(screen.queryByRole('textbox', { name: /message/i })).toBeNull();
  });

  it('Reopen reopens it and goes to the open thread to reply', async () => {
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(posted()).toContainEqual(['POST', '/api/chat/widget-admin/conversations/1/action', { action: 'reopen' }]));
    await waitFor(() => expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=1'));
    expect(toast).toHaveBeenCalledWith('success', 'Chat reopened.');
  });

  it('Star stars it; Block visitor asks for how long and why', async () => {
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Star' }));
    await waitFor(() => expect(posted()).toContainEqual(['POST', '/api/chat/widget-admin/conversations/1/action', { action: 'star', on: true }]));

    fireEvent.click(screen.getByRole('button', { name: 'Block visitor' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Spam' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(posted()).toContainEqual(['POST', '/api/chat/widget-admin/conversations/1/action', { action: 'block', reason: 'Spam', days: 7 }]));
  });

  it('somebody who may only look gets no Reopen, Star or Block, and cannot edit the tags', async () => {
    convo = conversation({}, { can: { view: true, reply: false, manage: false } });
    wrap(<WebsiteWorkspace />);
    await screen.findByText('Working now, thank you!');
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Star' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Block visitor' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Tag' })).toBeNull();
  });
});

describe('the closed summary (C-06, UX-CLS-02)', () => {
  beforeEach(() => {
    tab.route = '/chat?view=website&section=closed&website=1';
  });

  it('tiles for first reply, duration, priority and rating; who handled it and when it closed', async () => {
    wrap(<WebsiteWorkspace />);
    const panel = await screen.findByRole('complementary', { name: 'Chat summary' });
    const tile = (label: string) => within(panel).getByText(label).parentElement!.textContent;
    expect(tile('First reply')).toBe('First reply0:58');
    expect(tile('Duration')).toBe('Duration16 min');
    expect(tile('Priority')).toBe('PriorityUrgent');
    expect(tile('Rating')).toBe('Rating★ 5.0');
    expect(within(panel).getByText('Closed')).toBeTruthy();
    expect(within(panel).getByText(/^Handled by/).textContent).toMatch(/^Handled by Nuwan · closed Today .+/);
  });

  it('the tags stay editable, and the contact says how many chats they have had', async () => {
    wrap(<WebsiteWorkspace />);
    const panel = await screen.findByRole('complementary', { name: 'Chat summary' });
    expect(within(panel).getByText('activation')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove tag activation' }));
    await waitFor(() => expect(posted()).toContainEqual(['POST', '/api/chat/widget-admin/conversations/1/action', { action: 'tag', tags: 'microsoft-365' }]));

    expect(within(panel).getByText('anne@acme.lk')).toBeTruthy();
    expect(within(panel).getByText('Kandy, LK')).toBeTruthy();
    expect(within(panel).getByText(/^2nd chat · first on /)).toBeTruthy();
  });

  it('an idle close was nobody’s: no handler, not rated, and the header says it closed itself', async () => {
    convo = conversation({ closed_reason: 'idle', closed_by: null, first_response_at: null, rating: null, rating_comment: null, priority: 'normal' }, { chats: { count: 1, first_at: started } });
    wrap(<WebsiteWorkspace />);
    const panel = await screen.findByRole('complementary', { name: 'Chat summary' });
    expect(within(panel).getByText('First reply').parentElement!.textContent).toBe('First reply—');
    expect(within(panel).getByText('Not rated')).toBeTruthy();
    expect(within(panel).getByText(/^Nobody replied/)).toBeTruthy();
    expect(within(panel).getByText('First chat')).toBeTruthy();
    expect(screen.getByText(/^Closed automatically as inactive at .+ · 16 min · techubiz\.com$/)).toBeTruthy();
    expect(screen.queryByText(/Rated \d by the visitor/)).toBeNull();
  });
});
