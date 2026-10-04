// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * C-05, Offline enquiries (X-UI-03; UX-OFF-01, UX-MISS-02, MIS-01/02): a list with the reason chip — outside hours or
 * nobody online — and whether each was answered or the visitor is back; a detail with their message, email, phone and
 * page, a staff-only note, Assign, Close and Reply by email, read without arriving in the chat; and the note that a
 * returning visitor moves to Live chats and rings once. An older server without the list keeps the inbox's rows.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({})) }));
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
const tab = { route: '/chat?view=website&section=offline', go: vi.fn(), active: true };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: tab.active, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet, apiPost, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { sectionRows, type WebsiteConversation, type WebsiteRow } from '../../../src/modules/chat/website/api';
import { enquiryStamp, repliedLine, whyOffline, type OfflineEnquiry } from '../../../src/modules/chat/website/Offline';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MALINI: OfflineEnquiry = {
  id: 1, widget_id: 1, widget: 'techubiz.com', visitor: 'Malini Perera', company: 'Lanka Traders', email: 'malini@lankatraders.lk', phone: '+94 77 123 4567',
  place: 'Kandy, LK', url: 'https://techubiz.com/shop/microsoft-365', status: 'pending', received_at: ago(3 * 3_600_000), last_visitor_at: ago(3 * 3_600_000),
  preview: 'We need 20 Microsoft 365 Business seats…', reason: 'hours', hours: 'Mon–Fri, 8:30 AM–5:30 PM', online: false, left_at: ago(3 * 3_600_000),
  replied: null, assigned_to: null, agent: null,
};
const THARINDU: OfflineEnquiry = {
  ...MALINI, id: 2, visitor: 'Tharindu J.', company: null, email: 't@j.lk', phone: null, url: null, preview: 'Can I pay by bank transfer?', reason: 'no_agents', hours: null,
  online: true, left_at: null, received_at: ago(5 * 3_600_000),
};
const KUMARI: OfflineEnquiry = {
  ...MALINI, id: 3, visitor: 'Kumari D.', company: null, preview: 'Do you deliver?', reason: null, received_at: ago(6 * 3_600_000),
  replied: { how: 'email', at: ago(3_600_000), by: 'Dilini Fernando' },
};

const conversation = (): WebsiteConversation => ({
  conversation: { id: 1, widget: 'TechHub', website: 'techubiz.com', status: 'pending', is_offline: true, inactive: true, assigned_to: null, visitor_typing: false, started_at: MALINI.received_at, closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
  visitor: {
    id: 9, label: 'Visitor 1A2B', name: 'Malini Perera', email: 'malini@lankatraders.lk', phone: '+94 77 123 4567', company: 'Lanka Traders', browser: 'Safari', os: 'macOS', device: 'desktop',
    language: null, timezone: null, country: 'LK', city: 'Kandy', landing_page: null, current_url: 'https://techubiz.com/checkout', current_title: null,
    referrer: 'https://www.facebook.com/', utm_source: null, utm_campaign: null, visits: 1, first_seen: null, last_seen: MALINI.left_at, is_blocked: false,
  },
  messages: [
    { id: 1, body: 'We need 20 Microsoft 365 Business Standard seats for our new office from November.', from: 'visitor', agent: null, at: MALINI.received_at!, file: null },
    { id: 2, body: 'Please call in the morning.', from: 'visitor', agent: null, at: MALINI.received_at!, file: null },
    { id: 3, body: 'Asked Kasun for the volume price.', from: 'agent', agent: 'Samali Perera', at: ago(3_600_000), file: null, visibility: 'internal' },
  ],
  journey: [1, 2, 3, 4, 5].map((n) => ({ url: `https://techubiz.com/p${n}`, title: null, at: ago(4 * 3_600_000) })),
  history: [],
  can: { view: true, reply: true, manage: false },
});

let enquiries: OfflineEnquiry[] = [];
let legacy = false;
let inbox: WebsiteRow[] = [];

function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations') return { conversations: inbox, can: { view: true, reply: true, manage: false } };
    if (path === '/api/chat/widget-admin/visitors') return { visitors: [] };
    if (path === '/api/chat/widget-admin/missed/count') return { count: 0 };
    if (path === '/api/chat/widget-admin/offline') {
      if (legacy) throw new ApiError(404, 'Not found', null);
      return { offline: enquiries, count: enquiries.filter((e) => !e.replied).length };
    }
    if (path === '/api/chat/widget-admin/callbacks/counts') return { todo: 0, overdue: 0, mine: 0 };
    if (path === '/api/chat/widget-admin/agents') return { agents: [{ id: 7, name: 'Me' }, { id: 9, name: 'Dilini Fernando' }] };
    if (path === '/api/chat/widget-admin/conversations/1') return conversation();
    throw new Error(`unexpected ${path}`);
  }) as never);
  const state: WebchatRingState = { chats: [], handoffs: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false };
  vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state : null)) as never);
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const list = () => screen.getByRole('region', { name: 'Conversations' });
const nav = () => screen.getByRole('navigation', { name: 'Website chats' });

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  enquiries = [MALINI, THARINDU, KUMARI];
  legacy = false;
  inbox = [];
  tab.route = '/chat?view=website&section=offline';
  tab.go.mockReset();
  vi.mocked(apiPost).mockClear();
  vi.mocked(request).mockClear();
  vi.mocked(toast).mockClear();
  app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
  serve();
});
afterEach(() => cleanup());

describe('the Offline enquiries list (C-05, UX-OFF-01)', () => {
  it('heads the list with its line, and counts the unanswered ones in the menu', async () => {
    wrap(<WebsiteWorkspace />);
    expect(await within(list()).findByText('Malini Perera')).toBeTruthy();
    expect(within(list()).getByText('Offline enquiries')).toBeTruthy();
    expect(within(list()).getByText('Messages left while nobody was available or outside business hours.')).toBeTruthy();
    const entry = within(nav()).getByRole('button', { name: /Offline enquiries/ });
    expect(within(entry).getByText('2')).toBeTruthy();
    // Its own list: no Open / Mine / Closed pills.
    expect(within(list()).queryByRole('group', { name: 'Show' })).toBeNull();
  });

  it('each row has the first words, the reason chip and whether it was answered or the visitor is back', async () => {
    wrap(<WebsiteWorkspace />);
    const malini = (await within(list()).findByText('Malini Perera')).closest('button')!;
    expect(within(malini).getByText('“We need 20 Microsoft 365 Business seats…”')).toBeTruthy();
    expect(within(malini).getByText('Outside hours')).toBeTruthy();
    expect(within(malini).getByText('Not replied')).toBeTruthy();

    const tharindu = within(list()).getByText('Tharindu J.').closest('button')!;
    expect(within(tharindu).getByText('Nobody online')).toBeTruthy();
    expect(within(tharindu).getByText('Back on the site')).toBeTruthy();

    const kumari = within(list()).getByText('Kumari D.').closest('button')!;
    expect(within(kumari).getByText('Emailed by Dilini')).toBeTruthy();
    expect(within(kumari).queryByText('Not replied')).toBeNull();

    fireEvent.click(malini);
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=offline&website=1');
  });

  it('narrows by the search box', async () => {
    wrap(<WebsiteWorkspace />);
    await within(list()).findByText('Malini Perera');
    fireEvent.change(within(list()).getByLabelText('Search visitors'), { target: { value: 'lanka' } });
    expect(within(list()).getByText('Malini Perera')).toBeTruthy();
    expect(within(list()).queryByText('Tharindu J.')).toBeNull();
  });

  it('on an older server without the list, shows the inbox rows flagged offline as before', async () => {
    legacy = true;
    inbox = [{ id: 44, label: 'Visitor 44', visitor_name: 'Nimal', email: null, is_offline: true, online: false, status: 'pending', assigned_to: null, awaiting_reply: true, priority: 'normal', widget_id: 1 } as unknown as WebsiteRow];
    wrap(<WebsiteWorkspace />);
    const row = (await within(list()).findByText('Nimal')).closest('button')!;
    expect(within(row).getByText('Offline')).toBeTruthy();
  });

  it('an enquiry whose visitor came back and wrote is a live chat too (MIS-02)', () => {
    const row = (over: Partial<WebsiteRow>) => ({ id: 1, online: true, is_offline: true, status: 'pending', ...over }) as unknown as WebsiteRow;
    expect(sectionRows([row({})], 'live', null)).toHaveLength(0);
    expect(sectionRows([row({ status: 'open' })], 'live', null)).toHaveLength(1);
    expect(sectionRows([row({ status: 'open' })], 'offline', null)).toHaveLength(1);
  });

  it('says why and how in words', () => {
    expect(whyOffline({ reason: 'hours', hours: 'Mon–Fri, 8:30 AM–5:30 PM' })).toBe('Outside business hours (Mon–Fri, 8:30 AM–5:30 PM)');
    expect(whyOffline({ reason: 'no_agents', hours: null })).toBe('Nobody was online to answer');
    expect(whyOffline({ reason: null, hours: null })).toBeNull();
    expect(repliedLine({ how: 'chat', at: null, by: 'Samali Perera' })).toBe('Replied by Samali');
    expect(repliedLine(null)).toBeNull();
    expect(enquiryStamp(null)).toBe('');
  });
});

describe('the enquiry detail (C-05, UX-OFF-01, UX-MISS-02)', () => {
  beforeEach(() => {
    tab.route = '/chat?view=website&section=offline&website=1';
  });

  it('reads it without arriving: their message, email, phone, page, the visitor and why nobody answered', async () => {
    wrap(<WebsiteWorkspace />);
    const message = await screen.findByRole('region', { name: 'Their message' });
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/1', { review: '1' }, expect.anything());
    expect(screen.queryByText('Thread 1')).toBeNull();
    expect(screen.getByText('Malini Perera · Lanka Traders')).toBeTruthy();
    expect(screen.getByText(/^Left a message .+ · not on the site now$/)).toBeTruthy();

    expect(within(message).getByText(/^We need 20 Microsoft 365 Business Standard seats.+\s+Please call in the morning\.$/)).toBeTruthy();
    expect(within(message).getByText('malini@lankatraders.lk')).toBeTruthy();
    expect(within(message).getByText('+94 77 123 4567')).toBeTruthy();
    expect(within(message).getByText('/shop/microsoft-365')).toBeTruthy();

    const visitor = screen.getByRole('complementary', { name: 'Visitor' });
    expect(within(visitor).getByText('Kandy, LK · Safari · macOS')).toBeTruthy();
    expect(within(visitor).getByText('1st visit · 5 pages · from facebook.com')).toBeTruthy();
    expect(within(visitor).getByText('Outside business hours (Mon–Fri, 8:30 AM–5:30 PM)')).toBeTruthy();

    expect(screen.getByRole('note').textContent).toBe('If Malini returns while staff are online, the chat moves to Live chats and rings once.');
    // Not on the site: nothing to open the chat for.
    expect(screen.queryByRole('button', { name: 'Open chat' })).toBeNull();
  });

  it('a note for the team lists the notes and adds one, staff only', async () => {
    wrap(<WebsiteWorkspace />);
    const notes = await screen.findByRole('region', { name: 'Note for the team' });
    expect(within(notes).getByText('Asked Kasun for the volume price.')).toBeTruthy();
    expect(within(notes).getByText('staff only', { exact: false })).toBeTruthy();
    fireEvent.change(within(notes).getByPlaceholderText('Add a note…'), { target: { value: 'Quote by noon.' } });
    fireEvent.click(within(notes).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/1/note', { body: { message: 'Quote by noon.', mentions: [] } }));
    expect(toast).toHaveBeenCalledWith('success', 'Note added');
  });

  it('Reply by email posts to the conversation and says where it went', async () => {
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reply by email' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/^To malini@lankatraders\.lk\./)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Your reply'), { target: { value: 'Quotation attached.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send email' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/1/email', { message: 'Quotation attached.' }));
    expect(toast).toHaveBeenCalledWith('success', 'Emailed to malini@lankatraders.lk');
  });

  it('Assign gives it to somebody, and Close closes it and goes back to the list', async () => {
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Assign' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Dilini Fernando' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/1/action', { body: { action: 'assign', user_id: 9 } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Assigned to Dilini Fernando'));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/1/action', { body: { action: 'close' } }));
    await waitFor(() => expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=offline'));
  });

  it('a visitor back on the site: said in the header and the note, with Open chat', async () => {
    enquiries = [{ ...MALINI, online: true, left_at: null }];
    wrap(<WebsiteWorkspace />);
    expect(await screen.findByText(/· back on the site now$/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toBe('Malini is back on the site — the chat is in Live chats and rings once.');
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=inbox&website=1');
  });
});
