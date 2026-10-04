// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * C-04, Missed chats — follow up and mark handled (X-UI-02; UX-MISS-01…03): To follow up and Handled with their
 * counts, rows with the visitor's first words, how long they waited before leaving and the contact they left; a
 * detail that reads the chat back without arriving in it (`review`), with Reply by email and Mark handled; and the
 * note that a returning visitor reopens the chat and rings again.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})) }));
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
const tab = { route: '/chat?view=website&section=missed', go: vi.fn(), active: true };
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
import { toast } from '../../../src/core/toasts';
import type { WebsiteConversation } from '../../../src/modules/chat/website/api';
import { handledLine, type Missed } from '../../../src/modules/chat/website/Missed';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const RAVI: Missed = {
  id: 1, widget_id: 1, widget: 'techubiz.com', visitor: 'Ravi Silva', email: 'ravi@studio.lk', phone: null, place: 'Colombo, LK',
  url: 'https://techubiz.com/shop/coreldraw', status: 'open', missed_at: ago(55 * 60_000), started_at: ago(60 * 60_000), last_visitor_at: ago(60 * 60_000),
  preview: 'Do you have CorelDRAW for Mac?', online: false, left_at: ago(56 * 60_000), waited_seconds: 260, handled: null,
};
const B19: Missed = {
  id: 2, widget_id: 1, widget: 'techubiz.com', visitor: 'Visitor 7B19', email: null, phone: null, place: null, url: null, status: 'open',
  missed_at: ago(26 * 3_600_000), started_at: ago(26 * 3_600_000), last_visitor_at: ago(26 * 3_600_000), preview: 'Price for Windows 11 Pro?', online: false,
  left_at: ago(26 * 3_600_000), waited_seconds: 300, handled: { how: 'marked', at: ago(25 * 3_600_000), by: 'Dilini Fernando' },
};

const conversation = (over: Partial<WebsiteConversation['visitor'] & object> = {}): WebsiteConversation => ({
  conversation: { id: 1, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: true, assigned_to: null, visitor_typing: false, started_at: ago(60 * 60_000), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
  visitor: {
    id: 9, label: 'Visitor 1A2B', name: 'Ravi Silva', email: 'ravi@studio.lk', phone: null, company: null, browser: 'Chrome', os: 'Windows', device: 'desktop', language: null, timezone: null,
    country: 'LK', city: 'Colombo', landing_page: null, current_url: 'https://techubiz.com/shop/coreldraw', current_title: null, referrer: 'https://www.google.com/search?q=corel', utm_source: null, utm_campaign: null,
    visits: 2, first_seen: null, last_seen: ago(56 * 60_000), is_blocked: false, ...over,
  },
  messages: [
    { id: 1, body: 'Hi, do you have CorelDRAW for Mac?', from: 'visitor', agent: null, at: ago(60 * 60_000), file: null },
    { id: 2, body: 'Sorry for the wait — leave your email and we’ll reply there.', from: 'bot', agent: 'Ask details', at: ago(58 * 60_000), file: null },
    { id: 3, body: 'ravi@studio.lk', from: 'visitor', agent: null, at: ago(57 * 60_000), file: null },
  ],
  journey: [
    { url: 'https://techubiz.com/', title: 'Home', at: ago(62 * 60_000) },
    { url: 'https://techubiz.com/shop', title: 'Shop', at: ago(61 * 60_000) },
    { url: 'https://techubiz.com/shop/coreldraw', title: 'CorelDRAW', at: ago(60 * 60_000) },
  ],
  history: [],
  can: { view: true, reply: true, manage: false },
});

let todo: Missed[] = [];
let handled: Missed[] = [];
let tabs = true;
let convo = conversation();

function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string, params?: Record<string, string>) => {
    if (path === '/api/chat/widget-admin/conversations') return { conversations: [], can: { view: true, reply: true, manage: false } };
    if (path === '/api/chat/widget-admin/visitors') return { visitors: [] };
    if (path === '/api/chat/widget-admin/missed/count') return { count: todo.length };
    if (path === '/api/chat/widget-admin/missed') {
      const list = params?.status === 'handled' ? handled : todo;
      return tabs ? { missed: list, count: todo.length, handled: handled.length } : { missed: todo, count: todo.length };
    }
    if (path === '/api/chat/widget-admin/callbacks/counts') return { todo: 0, overdue: 0, mine: 0 };
    if (path === '/api/chat/widget-admin/conversations/1') return convo;
    throw new Error(`unexpected ${path}`);
  }) as never);
  const state: WebchatRingState = { chats: [], handoffs: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false };
  vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state : null)) as never);
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const list = () => screen.getByRole('region', { name: 'Conversations' });

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  todo = [RAVI];
  handled = [B19];
  tabs = true;
  convo = conversation();
  tab.route = '/chat?view=website&section=missed';
  tab.go.mockReset();
  vi.mocked(apiPost).mockClear();
  vi.mocked(toast).mockClear();
  app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
  serve();
});
afterEach(() => cleanup());

describe('the Missed chats list (C-04, UX-MISS-01)', () => {
  it('heads the list with what is owed, the line under it, and To follow up / Handled with their counts', async () => {
    wrap(<WebsiteWorkspace />);
    expect(await within(list()).findByText('1 to follow up')).toBeTruthy();
    expect(within(list()).getByText('Visitors who wrote and left before anyone replied.')).toBeTruthy();
    const show = within(list()).getByRole('group', { name: 'Show' });
    expect(within(show).getByRole('button', { name: 'To follow up · 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(show).getByRole('button', { name: 'Handled · 1' })).toBeTruthy();
  });

  it('a row to follow up: the visitor, when, what they asked, how long they waited and the contact they left', async () => {
    wrap(<WebsiteWorkspace />);
    const ravi = (await within(list()).findByText('Ravi Silva')).closest('button')!;
    expect(within(ravi).getByText('“Do you have CorelDRAW for Mac?”')).toBeTruthy();
    expect(within(ravi).getByText('Left after 4:20')).toBeTruthy();
    expect(within(ravi).getByText('Email left')).toBeTruthy();
    expect(within(ravi).getByText(/^(Today|Yesterday)/)).toBeTruthy();
    fireEvent.click(ravi);
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=missed&website=1');
    // Opening is no longer handling: nothing was posted.
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('Handled lists who dealt with each, dimmed, and says when there was no way back', async () => {
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await within(list()).findByRole('button', { name: 'Handled · 1' }));
    const b19 = (await within(list()).findByText('Visitor 7B19')).closest('button')!;
    expect(within(b19).getByText('Handled by Dilini · no contact left')).toBeTruthy();
    expect(b19.className).toContain('opacity-60');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/missed', { status: 'handled' }, expect.anything()));
    expect(within(list()).queryByText('Ravi Silva')).toBeNull();
  });

  it('a visitor back on the site is said so on the row instead of how long they waited (UX-MISS-03)', async () => {
    todo = [{ ...RAVI, online: true, left_at: null, waited_seconds: null }];
    wrap(<WebsiteWorkspace />);
    const ravi = (await within(list()).findByText('Ravi Silva')).closest('button')!;
    expect(within(ravi).getByText('Back on the site')).toBeTruthy();
    expect(within(ravi).queryByText(/Left after/)).toBeNull();
  });

  it('narrows by the search box, and an older server without the tabs shows the one list', async () => {
    todo = [RAVI, { ...B19, id: 3, handled: null, visitor: 'Visitor 99C0', preview: 'Do you deliver?' }];
    tabs = false;
    wrap(<WebsiteWorkspace />);
    await within(list()).findByText('Visitor 99C0');
    expect(within(list()).queryByRole('button', { name: /^Handled/ })).toBeNull();
    fireEvent.change(within(list()).getByLabelText('Search visitors'), { target: { value: 'corel' } });
    expect(within(list()).queryByText('Visitor 99C0')).toBeNull();
    expect(within(list()).getByText('Ravi Silva')).toBeTruthy();
  });

  it('says who handled it and how, in words', () => {
    expect(handledLine({ handled: { how: 'replied', at: null, by: 'Samali Perera' }, email: 'k@shop.lk', phone: null })).toBe('Replied by Samali');
    expect(handledLine({ handled: { how: 'marked', at: null, by: null }, email: null, phone: '+94 77' })).toBe('Handled');
    expect(handledLine({ handled: null, email: null, phone: null })).toBeNull();
  });
});

describe('the missed chat detail (C-04, UX-MISS-01…03)', () => {
  it('reads the chat back without arriving: the transcript, how it ended, contact and visit facts, and the note about returning', async () => {
    tab.route = '/chat?view=website&section=missed&website=1';
    wrap(<WebsiteWorkspace />);
    expect(await screen.findByText('Hi, do you have CorelDRAW for Mac?')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/1', { review: '1' }, expect.anything());
    expect(screen.queryByText('Thread 1')).toBeNull();

    expect(screen.getByText(/^Left the site at .+ · techubiz\.com\/shop\/coreldraw$/)).toBeTruthy();
    expect(screen.getByText(/· started from \/$/)).toBeTruthy();
    expect(screen.getByText(/^Visitor left at .+ · nobody replied · counted as missed$/)).toBeTruthy();

    const facts = screen.getByRole('complementary', { name: 'Contact and visit' });
    expect(within(facts).getByText('ravi@studio.lk')).toBeTruthy();
    expect(within(facts).getByText('No phone left')).toBeTruthy();
    expect(within(facts).getByText('Colombo, LK · Chrome · Windows')).toBeTruthy();
    expect(within(facts).getByText('2nd visit · 3 pages · from google.com')).toBeTruthy();
    expect(within(facts).getByRole('note').textContent).toBe('If Ravi comes back to the site, this chat reopens and rings again.');
  });

  it('Mark handled posts once and refreshes the lists', async () => {
    tab.route = '/chat?view=website&section=missed&website=1';
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark handled' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/missed/1/handle'));
    expect(toast).toHaveBeenCalledWith('success', 'Marked as handled');
  });

  it('Reply by email sends the reply to the address they left and into the chat', async () => {
    tab.route = '/chat?view=website&section=missed&website=1';
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reply by email' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/^To ravi@studio\.lk\. It is added to the chat too/)).toBeTruthy();
    const send = within(dialog).getByRole('button', { name: 'Send email' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Your reply'), { target: { value: 'Yes — CorelDRAW 2024 runs on macOS 13 and later.' } });
    fireEvent.click(send);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/missed/1/email', { message: 'Yes — CorelDRAW 2024 runs on macOS 13 and later.' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast).toHaveBeenCalledWith('success', 'Emailed to ravi@studio.lk');
  });

  it('without an email address, Reply by email is unavailable; Open chat goes to the conversation itself', async () => {
    convo = conversation({ email: null });
    todo = [{ ...RAVI, email: null }];
    tab.route = '/chat?view=website&section=missed&website=1';
    wrap(<WebsiteWorkspace />);
    const reply = (await screen.findByRole('button', { name: 'Reply by email' })) as HTMLButtonElement;
    expect(reply.disabled).toBe(true);
    expect(reply.title).toBe('They left no email address');
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=1');
  });

  it('a handled one says who handled it and offers no Mark handled; a returning visitor is said to be back (UX-MISS-03)', async () => {
    todo = [{ ...RAVI, online: true, left_at: null, waited_seconds: null, handled: { how: 'marked', at: ago(1000), by: 'Dilini Fernando' } }];
    tab.route = '/chat?view=website&section=missed&website=1';
    wrap(<WebsiteWorkspace />);
    expect(await screen.findByText('Handled by Dilini', { selector: 'header *' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark handled' })).toBeNull();
    expect(screen.getByText(/^Back on the site now · techubiz\.com\/shop\/coreldraw$/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toBe('Ravi is back on the site — the chat is open again and rings when they write.');
    expect(screen.queryByText(/counted as missed/)).toBeNull();
  });
});
