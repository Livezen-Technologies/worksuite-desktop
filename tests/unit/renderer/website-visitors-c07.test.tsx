// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Visitors online — reading now, speak first (worksuite-desktop C-07, X-UI-06; UX-VIS-01…04, VIS-07): the table says
 * who and where with a status dot, the page they are reading, how long on the site, pages, which visit and when last
 * active; the selected visitor's panel draws a schematic of their page from its title and the widget's figures (time
 * on page, scroll depth, a section only when reported), this visit newest first with how they arrived, and the shared
 * composer with saved-reply chips and a Saved replies button to speak first.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({ conversation_id: 77 })), request: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiGet, apiPost } from '../../../src/core/api';
import { toast } from '../../../src/core/toasts';
import { WebsiteLive, type OnlineVisitor } from '../../../src/modules/chat/website/WebsiteLive';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const visitor = (over: Partial<OnlineVisitor>): OnlineVisitor => ({
  id: 1, label: 'Visitor 1', name: null, email: null, widget_id: 1, website_name: 'techubiz.com', browser: 'Chrome', os: 'Windows', device: 'desktop',
  country: 'LK', city: 'Colombo', current_url: 'https://techubiz.com/', current_title: 'Home', landing_page: null, referrer: null,
  utm_campaign: null, pages: 1, visits: 1, on_site_seconds: 20, idle_seconds: 5, conversation_id: null, conversation_status: null, chat: null, ...over,
});
const ONLINE = [
  visitor({ id: 1, label: 'Visitor 7A3D', current_url: 'https://techubiz.com/shop/microsoft-365', current_title: 'Microsoft 365 Business', pages: 6, visits: 3,
    on_site_seconds: 245, idle_seconds: 3, referrer: 'https://www.google.com/search', referrer_host: 'google.com', page_seconds: 120, scroll: 60,
    section: 'the pricing card', previous_visit_at: '2026-10-02 18:20:00' }),
  visitor({ id: 2, label: 'Visitor 4F2A', current_url: 'https://techubiz.com/shop/adobe-creative-cloud', pages: 4, on_site_seconds: 380, conversation_id: 9,
    conversation_status: 'open', chat: { awaiting: true, waiting_since: ago(98_000), at_risk: false, agent: null } }),
  visitor({ id: 3, label: 'Visitor 51EF', city: 'London', country: 'GB', current_url: 'https://techubiz.com/blog/office-2024-vs-365', pages: 3, visits: 2, on_site_seconds: 380, idle_seconds: 200, page_seconds: 90, scroll: 35 }),
  visitor({ id: 4, label: 'Visitor 2C88', city: null, country: 'Sri Lanka', geo_source: 'timezone' }),
];
const ACTIVITY = {
  events: [
    { id: 1, kind: 'page_view', url: 'https://techubiz.com/', title: 'Home', at: ago(245_000), seconds: null, new_visit: true },
    { id: 2, kind: 'page_view', url: 'https://techubiz.com/shop', title: 'Shop', at: ago(205_000), seconds: 40, new_visit: false },
    { id: 3, kind: 'page_view', url: 'https://techubiz.com/pricing', title: 'Pricing', at: ago(180_000), seconds: 60, new_visit: false },
    { id: 4, kind: 'page_view', url: 'https://techubiz.com/shop/microsoft-365', title: 'Microsoft 365 Business', at: ago(120_000), seconds: null, new_visit: false },
  ],
  chats: [],
  contact: null,
  language: null,
};
const REPLIES = [
  { id: 5, shortcut: 'welcome', title: 'Welcome', body: 'Hi! Welcome to Techubiz.' },
  { id: 6, shortcut: 'm365', title: 'Microsoft 365', body: 'Comparing Microsoft 365 plans? I can help you pick one.' },
];

const props = { onSelect: vi.fn(), onOpenChat: vi.fn(), onSection: vi.fn() };
let client: QueryClient;
const ui = (selected: number | null) => <QueryClientProvider client={client}><WebsiteLive view="visitors" selected={selected} {...props} /></QueryClientProvider>;
const mount = (selected: number | null = null) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui(selected));
};
const rows = () => within(screen.getByRole('listbox', { name: 'Visitors online' })).getAllByRole('option');
const row = (name: string) => rows().find((r) => r.textContent?.includes(name))!;
const cells = (name: string) => Array.from(row(name).children).map((c) => c.textContent);
const panel = () => screen.findByRole('region', { name: 'Visitor details' });

beforeEach(() => {
  Object.values(props).forEach((f) => f.mockReset());
  vi.mocked(apiPost).mockClear();
  vi.mocked(toast).mockClear();
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/visitors') return { visitors: ONLINE };
    if (path === '/api/chat/widget-admin/dashboard') return { now: {}, today: {}, summary: {}, widgets: [{ id: 1, name: 'Techubiz', online: 4 }] };
    if (path === '/api/chat/widget-admin/canned') return { responses: REPLIES };
    if (/\/visitors\/\d+\/activity$/.test(path)) return ACTIVITY;
    throw new Error(`unexpected ${path}`);
  }) as never);
});
afterEach(() => cleanup());

describe('the Visitors online table (UX-VIS-01)', () => {
  it('has the heading with the count, the line under it and All sites', async () => {
    mount();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.getByRole('heading', { name: 'Visitors online' }).parentElement?.textContent).toBe('Visitors online· 4');
    expect(screen.getByText('Everyone on your sites right now. Select someone to see what they are reading.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Site' }).textContent).toContain('All sites');
    // The sites' names come from the summary, or — from a server without it — the full answer (#248).
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['website', 'dashboard', 0] }).some((q) => q.state.data !== undefined)).toBe(true));
    fireEvent.click(screen.getByRole('combobox', { name: 'Site' }));
    expect(screen.getByRole('option', { name: 'Techubiz' })).toBeTruthy();
    expect(screen.getByText('Select a visitor to see their pages and start a conversation.')).toBeTruthy();
  });

  it('says who and where, the page, time on the site, pages, which visit and when last active, with a status dot', async () => {
    mount();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(cells('Visitor 7A3D')).toEqual(['Visitor 7A3D· Colombo', '/shop/microsoft-365', '4m', '6', '3rd', 'Now']);
    expect(cells('Visitor 4F2A')).toEqual(['Visitor 4F2A· Colombo', '/shop/adobe-creative-cloud', '6m', '4', '1st', expect.stringMatching(/^Waiting 1:3\d$/)]);
    expect(cells('Visitor 51EF')).toEqual(['Visitor 51EF· London', '/blog/office-2024-vs-365', '6m', '3', '2nd', '3 min ago']);
    // Placed by the browser's clock alone: the country, marked ≈.
    expect(cells('Visitor 2C88')).toEqual(['Visitor 2C88· Sri Lanka ≈', '/', '0m', '1', '1st', 'Just arrived']);

    const dot = (name: string) => within(row(name)).getByRole('img').getAttribute('aria-label');
    expect([dot('Visitor 7A3D'), dot('Visitor 4F2A'), dot('Visitor 51EF')]).toEqual(['Browsing', 'Waiting on us', 'Idle']);
  });
});

describe('the selected visitor (UX-VIS-02/03)', () => {
  it('heads the panel with who, how long on the site, Block and Close', async () => {
    mount(1);
    const card = await panel();
    expect(within(card).getByRole('heading', { name: 'Visitor 7A3D' })).toBeTruthy();
    expect(within(card).getByText('On the site · 4 min')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Block visitor' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Close the details' }));
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
  });

  it('draws a schematic of the page they are reading, with the time on it, how far down and the section reported', async () => {
    mount(1);
    const card = await panel();
    expect(within(card).getByText('Reading now')).toBeTruthy();
    expect(within(card).getByText('Live')).toBeTruthy();
    expect(within(card).getByRole('img', { name: 'Schematic of Microsoft 365 Business · techubiz.com/shop/microsoft-365 · 60% down the page' })).toBeTruthy();
    expect(within(card).getByText('2 min').parentElement?.textContent).toBe('2 min on this page');
    expect(within(card).getByText('Looking at the pricing card')).toBeTruthy();
    // A pointer only because the widget reported a section.
    expect(card.querySelectorAll('svg path[d^="M1 1l11 7"]')).toHaveLength(1);
  });

  it('without a section reported, says how far down instead, and draws no pointer', async () => {
    mount(3);
    const card = await panel();
    expect(within(card).getByText('35% down the page')).toBeTruthy();
    expect(within(card).queryByText(/^Looking at/)).toBeNull();
    expect(card.querySelectorAll('svg path[d^="M1 1l11 7"]')).toHaveLength(0);
  });

  it('lists this visit newest first, the current page highlighted, and how they arrived; then where, browser, visit and last visit', async () => {
    mount(1);
    const card = await panel();
    expect(within(card).getByText('6 pages · 4 min')).toBeTruthy();
    const pages = await within(card).findByRole('list', { name: 'Pages this visit' });
    expect(within(pages).getAllByRole('listitem').map((p) => p.textContent)).toEqual([
      '/shop/microsoft-365Now · 2 min', '/pricing1 min', '/shop40 s', '/Arrived from google.com',
    ]);
    expect(within(pages).getAllByRole('listitem')[0]!.getAttribute('aria-current')).toBe('page');
    for (const chip of ['Colombo, LK', 'Chrome · Windows', '3rd visit', /^Last: \S/]) expect(within(card).getAllByText(chip).length).toBeGreaterThan(0);
  });
});

describe('speak first (UX-VIS-04, VIS-07)', () => {
  it('has the hint, the saved replies as chips by shortcut, and the shared composer', async () => {
    mount(1);
    const card = await panel();
    expect(within(card).getByText('Start the conversation — it opens the widget on their page')).toBeTruthy();
    const chips = await within(card).findByLabelText('Saved replies', { selector: 'div' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['/welcome', '/m365']);
    for (const name of ['Attach', 'Emoji', 'Saved replies', 'AI tools', 'Send']) expect(within(card).getByRole('button', { name })).toBeTruthy();
    // Plain text: no WhatsApp formatting and no counter.
    expect(within(card).queryByLabelText('Message formatting')).toBeNull();
  });

  it('the Saved replies button opens the "/" menu at the caret, and Esc takes the "/" out again', async () => {
    mount(1);
    const card = await panel();
    const box = within(card).getByRole('textbox', { name: 'Message to Visitor 7A3D' });
    await within(card).findByRole('button', { name: '/m365' });
    fireEvent.click(within(card).getByRole('button', { name: 'Saved replies' }));
    expect(box).toHaveProperty('value', '/');
    expect(await within(card).findByText('Microsoft 365')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveProperty('value', '');
  });

  it('a chip and an edit, then Send: the first message creates the chat, counts the saved reply and opens the chat', async () => {
    mount(1);
    const card = await panel();
    fireEvent.click(await within(card).findByRole('button', { name: '/m365' }));
    const box = within(card).getByRole('textbox', { name: 'Message to Visitor 7A3D' });
    fireEvent.change(box, { target: { value: 'Hi! Comparing Microsoft 365 plans? I can help you pick one' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/visitors/1/message', { message: 'Hi! Comparing Microsoft 365 plans? I can help you pick one', canned_id: 6 }));
    await waitFor(() => expect(props.onOpenChat).toHaveBeenCalledWith(77));
    expect(toast).toHaveBeenCalledWith('success', 'Message sent.');
  });

  it('a blocked visitor is said to be, and the words stay in the box', async () => {
    const { ApiError } = await vi.importActual<typeof CoreApi>('../../../src/core/api');
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(409, 'That visitor is blocked', null));
    mount(1);
    const card = await panel();
    const box = within(card).getByRole('textbox', { name: 'Message to Visitor 7A3D' });
    fireEvent.change(box, { target: { value: 'Hello there' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'That visitor is blocked.'));
    expect(box).toHaveProperty('value', 'Hello there');
    expect(props.onOpenChat).not.toHaveBeenCalled();
  });

  it('somebody waiting in a chat has Open the chat and Invite a colleague instead', async () => {
    mount(2);
    const card = await panel();
    expect(within(card).getByText(/^Waiting 1:3\d$/)).toBeTruthy();
    expect(within(card).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Open the chat' }));
    expect(props.onOpenChat).toHaveBeenLastCalledWith(9);
  });
});
