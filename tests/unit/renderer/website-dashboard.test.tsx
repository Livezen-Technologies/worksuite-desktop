// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The Live dashboard (worksuite-desktop C-00): six figures that open the views they count, a live pill counting up
 * from the last answer, the map with its legend, country rows and Now/Today, everybody on the site grouped by who
 * needs us first with Join, Open and Start chat, and the Full map and Wall mode (names hidden) with Esc to come back.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  // The visitor panel's composer asks for its draft (C-07).
  call: vi.fn(async () => null),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { toast } from '../../../src/core/toasts';
import { WebsiteLive, type OnlineVisitor } from '../../../src/modules/chat/website/WebsiteLive';

/** A server stamp this many seconds ago, as the server writes them (UTC, no zone). */
const stamp = (agoS: number) => new Date(Date.now() - agoS * 1000).toISOString().slice(0, 19).replace('T', ' ');
const V = (o: Partial<OnlineVisitor>): OnlineVisitor => ({
  id: 1, label: 'Visitor 4F2A', name: null, email: null, widget_id: 1, website_name: 'techubiz.com', browser: 'Chrome', os: 'Windows', device: 'desktop',
  country: 'Sri Lanka', city: 'Colombo', lat: 6.9, lng: 79.9, current_url: 'https://techubiz.com/shop/adobe-creative-cloud', current_title: null, referrer: null,
  utm_campaign: null, pages: 2, visits: 1, on_site_seconds: 240, idle_seconds: 5, conversation_id: null, conversation_status: null, chat: null, ...o,
});
const chat = (o: Partial<NonNullable<OnlineVisitor['chat']>>) => ({ awaiting: false, waiting_since: null, at_risk: false, agent: null, agent_typing: false, call: null, ...o });
const VISITORS = [
  V({ id: 1, name: 'Anne', city: 'Kandy', lat: 7.3, lng: 80.6, current_url: 'https://techubiz.com/support/activation', conversation_id: 11, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(192), at_risk: true }) }),
  V({ id: 2, conversation_id: 12, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(98) }) }),
  V({ id: 3, label: 'Visitor 9C1E', city: 'Galle', lat: 6.0, lng: 80.2, conversation_id: 13, conversation_status: 'open', chat: chat({ agent: 'You', call: { status: 'active', since: stamp(134) } }) }),
  V({ id: 4, name: 'Kasun P.', conversation_id: 14, conversation_status: 'open', chat: chat({ agent: 'Nuwan' }) }),
  V({ id: 5, name: 'Ravi M.', country: 'United Arab Emirates', city: 'Dubai', lat: 25.2, lng: 55.3, conversation_id: 15, conversation_status: 'open', chat: chat({ agent: 'Dilini', agent_typing: true }) }),
  V({ id: 6, label: 'Visitor 7A3D', visits: 3, current_url: 'https://techubiz.com/shop/microsoft-365' }),
  V({ id: 7, label: 'Visitor B210', widget_id: 2, country: 'India', city: 'Mumbai', lat: 19.1, lng: 72.9, referrer_host: 'google.com', on_site_seconds: 60, current_url: 'https://techubiz.com/pricing' }),
  V({ id: 8, label: 'Visitor 2C88', city: null, lat: null, lng: null, geo_source: 'timezone', on_site_seconds: 10, current_url: 'https://techubiz.com/' }),
  V({ id: 9, label: 'Visitor 51EF', country: 'United Kingdom', city: 'London', lat: 51.5, lng: -0.1, on_site_seconds: 360, current_url: 'https://techubiz.com/blog/office-2024-vs-365' }),
];
const DASH = {
  now: { visitors_online: 9, open: 4, pending: 1, waiting_on_us: 2, at_risk: 1, arrived_10m: 3, longest_wait_since: stamp(192), staff_in_chats: 3, on_call: { count: 1, since: stamp(134) }, at_risk_after: 180, window_seconds: 300 },
  today: { visitors: 140, returning: 26, conversations: 19, page_views: 830, missed: 1, missed_last_hour: 0, first_response_median: 42 },
  activity: [{ id: 1, kind: 'chat_started', visitor_id: 5, who: 'Ravi M.', site: 'techubiz.com', title: null, url: null, country: 'United Arab Emirates', city: 'Dubai', at: stamp(240) }],
  summary: { pages: [], countries: [{ name: 'Sri Lanka', count: 90 }], devices: [], referrers: [], places: [{ country: 'Sri Lanka', city: 'Colombo', lat: 6.9, lng: 79.9, count: 44 }, { country: 'Japan', city: null, lat: null, lng: null, count: 5 }] },
  widgets: [{ id: 1, name: 'techubiz.com', status: 'active', open_now: true, online: 8 }, { id: 2, name: 'techhub.com.lk', status: 'active', open_now: true, online: 1 }],
  server_time: stamp(0),
};

function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/visitors') return { visitors: VISITORS };
    if (path === '/api/chat/widget-admin/dashboard') return DASH;
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (/\/visitors\/\d+\/activity$/.test(path)) return { events: [], chats: [], contact: null, language: null, landing_page: null };
    throw new Error(`unexpected ${path}`);
  }) as never);
}

const props = { onSelect: vi.fn(), onOpenChat: vi.fn(), onSection: vi.fn() };
let client: QueryClient;
const ui = (selected: number | null = null) => (
  <QueryClientProvider client={client}>
    <WebsiteLive view="dashboard" selected={selected} {...props} />
  </QueryClientProvider>
);
const mount = (selected: number | null = null) => render(ui(selected));
const list = () => screen.getByRole('region', { name: 'On the site now' });
const group = (name: string) => within(list()).getByRole('group', { name });
const row = (name: string) => within(list()).getByRole('listitem', { name });
const map = () => screen.getByRole('region', { name: 'Where they are' });
/** Shown once both answers are in: the figures and the rows. */
const ready = async () => {
  await screen.findByRole('listitem', { name: /^On the site now: 9/ });
  await within(list()).findByRole('group', { name: 'Needs you' });
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // What the inbox knows was said last: the "In a chat" rows read it.
  client.setQueryData(['website', 'inbox', 'open'], { conversations: [{ id: 14, last_message: { id: 1, body: 'Do you offer a trial?', from: 'visitor', agent: null, file: null, at: stamp(30) } }], can: {} });
  Object.values(props).forEach((f) => f.mockReset());
  vi.mocked(apiPost).mockReset();
  vi.mocked(toast).mockReset();
  serve();
});
afterEach(() => cleanup());

describe('the header and the six figures', () => {
  it('says it is live, counting up from the last answer, with the sites to choose from', async () => {
    mount();
    await ready();
    expect(screen.getByRole('heading', { name: 'Live dashboard' })).toBeTruthy();
    expect(screen.getByText(/^Live · updated \d+ s ago$/)).toBeTruthy();
    expect(screen.getByText('Who is on your sites right now, what they are doing, and where they are.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Site' }).textContent).toContain('All sites · 2');
  });

  it('shows each figure with what is under it, and each opens the view it counts', async () => {
    mount();
    await ready();
    const tiles = within(screen.getByRole('list', { name: 'Right now' })).getAllByRole('listitem');
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual([
      'On the site now: 9 — see who',
      'Waiting on us: 2 — open those chats',
      'At risk: 1 — open those chats',
      'Open chats: 5 — open the inbox',
      'On a call: 1 — open the inbox',
      'First reply: 0:42 — open missed chats',
    ]);
    expect(tiles[0]!.textContent).toContain('+3 in 10 min');
    expect(tiles[1]!.textContent).toMatch(/longest 3:1\d/);
    expect(tiles[2]!.textContent).toContain('past 3:00');
    expect(tiles[3]!.textContent).toContain('3 staff');
    expect(tiles[4]!.textContent).toMatch(/02:1\d/);
    expect(tiles[5]!.textContent).toContain('median today');
    tiles.forEach((t) => fireEvent.click(t));
    expect(props.onSection.mock.calls.map((c) => c[0])).toEqual(['visitors', 'awaiting', 'awaiting', 'inbox', 'inbox', 'missed']);
  });

  it('asks for one site when it is chosen', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Site' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'techhub.com.lk' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/dashboard', { widget_id: '2' }, expect.anything()));
    // The list narrows to that site's visitors.
    await waitFor(() => expect(within(list()).getAllByRole('listitem').map((r) => r.getAttribute('aria-label'))).toEqual(['Visitor B210']));
  });
});

describe('On the site now', () => {
  it('groups everybody by who needs us first, with their clocks and what they are doing', async () => {
    mount();
    await ready();
    expect(within(list()).getByRole('heading').textContent).toBe('On the site now · 9');
    const needs = within(group('Needs you')).getAllByRole('listitem');
    expect(needs.map((r) => r.getAttribute('aria-label'))).toEqual(['Anne', 'Visitor 4F2A']);
    expect(needs[0]!.textContent).toMatch(/Anne · Kandy/);
    expect(needs[0]!.textContent).toMatch(/Waiting · \/support\/activation/);
    expect(within(needs[0]!).getByLabelText(/^Waiting 3:1\d$/)).toBeTruthy();
    expect(needs[0]!.className).toContain('bg-danger-bg');
    expect(needs[1]!.className).toContain('bg-warning-bg');

    expect(row('Visitor 9C1E').textContent).toMatch(/On a call 02:1\d · You/);
    expect(row('Kasun P.').textContent).toContain('Nuwan · “Do you offer a trial?”');
    expect(row('Ravi M.').textContent).toContain('Dilini · typing…');

    const browsing = within(group('Browsing')).getAllByRole('listitem').map((r) => r.textContent);
    expect(browsing).toEqual([
      expect.stringContaining('Visitor 2C88 · Sri Lanka ≈/ · just arrived'),
      expect.stringContaining('/pricing · from google.com · 1m'),
      expect.stringContaining('/shop/microsoft-365 · 3rd visit · 4m'),
      expect.stringContaining('/blog/office-2024-vs-365 · 6m'),
    ]);

    fireEvent.click(within(list()).getByRole('button', { name: 'All 9 visitors online →' }));
    expect(props.onSection).toHaveBeenLastCalledWith('visitors');
  });

  it('Join takes the chat and opens it; a moment late, it says who has it', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({});
    mount();
    await ready();
    fireEvent.click(within(row('Anne')).getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(props.onOpenChat).toHaveBeenCalledWith(11));
    expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/11/accept');

    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(409, 'Nimal has already joined this chat.', null));
    fireEvent.click(within(row('Visitor 4F2A')).getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Nimal has already joined this chat.'));
    expect(props.onOpenChat).toHaveBeenCalledTimes(1);
  });

  it('Open goes to the chat, and Start chat opens the visitor over the list, closed by × or Esc', async () => {
    const view = mount();
    await ready();
    fireEvent.click(within(row('Kasun P.')).getByRole('button', { name: 'Open' }));
    expect(props.onOpenChat).toHaveBeenLastCalledWith(14);

    fireEvent.click(within(row('Visitor 7A3D')).getByRole('button', { name: 'Start chat' }));
    expect(props.onSelect).toHaveBeenLastCalledWith(6);
    view.rerender(ui(6));
    const card = await within(list()).findByRole('region', { name: 'Visitor details' });
    await waitFor(() => expect(document.activeElement).toBe(within(card).getByRole('textbox', { name: 'Message to Visitor 7A3D' })));
    expect(row('Visitor 7A3D').getAttribute('aria-current')).toBe('true');

    fireEvent.click(within(card).getByRole('button', { name: 'Close the details' }));
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
    props.onSelect.mockClear();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe('the map', () => {
  it('says where they are, with the legend, the countries, the caption and the at-risk callout', async () => {
    mount();
    await ready();
    expect(within(map()).getByRole('heading').textContent).toBe('Where they are · 4 countries, 6 cities');
    expect(within(map()).getByRole('img', { name: /^Map of visitors on the site now: 9 visitors, 7 places$/ })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Map legend' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual([
      'Browsing', 'Chatting', 'Waiting on us', 'At risk', 'On a call', 'City', 'Country only ≈',
    ]);
    const countries = within(within(map()).getByRole('list', { name: 'Countries' })).getAllByRole('listitem').map((i) => i.textContent);
    expect(countries).toEqual(['🇱🇰Sri Lanka6', '🇦🇪United Arab Emirates1', '🇮🇳India1', '🇬🇧United Kingdom1']);
    expect(within(map()).getByText('Shaded by visitors now · darker = more')).toBeTruthy();
    expect(within(map()).getByText(/^Anne · at risk 3:1\d$/)).toBeTruthy();
    expect(within(map()).getByText(/^City dots come from your CDN or the server's GeoIP database\./)).toBeTruthy();
    // The timezone-only visitor is a dashed ring on their country, never a city: Colombo's place has five on it.
    const svg = within(map()).getByRole('img');
    expect(svg.querySelector('[data-place="Sri Lanka|≈"] [data-approx]')?.getAttribute('stroke-dasharray')).toBeTruthy();
    // At world scale Colombo, Kandy and Galle would overlap: one marker for Sri Lanka, its ring an arc per state, worst first.
    const arcs = (key: string) => [...svg.querySelectorAll(`[data-place="${key}"] [data-arc]`)].map((x) => x.getAttribute('data-arc'));
    const colombo = 'Sri Lanka|Colombo|6.9|79.9';
    expect(arcs(`${colombo}||Sri Lanka|Kandy|7.3|80.6||Sri Lanka|Galle|6|80.2`)).toEqual(['at_risk', 'waiting', 'on_call', 'chatting', 'browsing']);
    // Named, and only named: the count is in the disc (#284); the country-only ring beside it is not named twice.
    expect(within(svg).getAllByText('Sri Lanka')).toHaveLength(1);
    expect(within(svg).queryByText(/Sri Lanka \d|≈/)).toBeNull();
    // Zooms: the world, the region most of them are in, and their country.
    expect(within(within(map()).getByRole('group', { name: 'Zoom to' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['World', 'Asia', 'Sri Lanka']);
    fireEvent.click(within(map()).getByRole('button', { name: 'Sri Lanka' }));
    expect(within(map()).getByRole('button', { name: 'Sri Lanka' }).getAttribute('aria-pressed')).toBe('true');
    // Who is off the edge, by country, with an arrow towards them (MAP-08).
    const away = within(within(map()).getByRole('list', { name: 'Outside this view' })).getAllByRole('listitem').map((i) => i.textContent);
    expect(away).toContain('↖ India · 1 outside this view');
    expect(away).toHaveLength(3);
    // Close in, they part: Colombo has somebody waiting, somebody in a chat and somebody browsing.
    expect(arcs(colombo)).toEqual(['waiting', 'chatting', 'browsing']);
    expect(within(within(map()).getByRole('img')).getByText('Colombo')).toBeTruthy();
    fireEvent.click(within(map()).getByRole('button', { name: 'Zoom out' }));
    expect(within(map()).getByRole('button', { name: 'Sri Lanka' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Today shows the day’s places instead', async () => {
    mount();
    await ready();
    fireEvent.click(within(map()).getByRole('radio', { name: 'Today' }));
    expect(within(map()).getByRole('radio', { name: 'Today' }).getAttribute('aria-checked')).toBe('true');
    expect(within(map()).getByText('Shaded by visitors today · darker = more')).toBeTruthy();
    expect(within(map()).getByRole('heading').textContent).toBe('Where they are · 2 countries, 1 city');
    expect(within(within(map()).getByRole('list', { name: 'Countries' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['🇱🇰Sri Lanka44', '🇯🇵Japan5']);
    expect(within(map()).queryByText(/at risk/)).toBeNull();
    fireEvent.click(within(map()).getByRole('radio', { name: 'Now' }));
    expect(within(map()).getByText('Shaded by visitors now · darker = more')).toBeTruthy();
  });
});

describe('Full map and Wall mode', () => {
  it('Full map opens the map large with a place’s people beside it, and Esc comes back', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Full map' }));
    expect(screen.getByRole('heading', { name: 'Map' })).toBeTruthy();
    const place = screen.getByRole('region', { name: 'Selected place' });
    // The busiest place first: Colombo, with its people and how precise the location is.
    expect(within(place).getByRole('heading').textContent).toBe('Colombo');
    expect(within(place).getByText('How precise is this')).toBeTruthy();
    expect(within(place).getByRole('listitem', { name: 'Kasun P.' })).toBeTruthy();

    // Pick another place on the map.
    fireEvent.click(screen.getByRole('button', { name: /^London: 1 · Browsing$/ }));
    expect(within(place).getByRole('heading').textContent).toBe('London');
    // Filters narrow the map to who needs us.
    fireEvent.click(screen.getByRole('button', { name: 'Needs you · 2' }));
    expect(screen.queryByRole('button', { name: /^London: / })).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('heading', { name: 'Live dashboard' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Full map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Live dashboard' }));
    expect(screen.getByRole('heading', { name: 'Live dashboard' })).toBeTruthy();
  });

  it('Wall mode fills the window with nobody named, and Esc leaves it', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Wall mode' }));
    const wall = screen.getByRole('dialog', { name: 'Website chats — live, wall mode' });
    expect(within(wall).getByText('Names hidden on this screen')).toBeTruthy();
    for (const name of ['Anne', 'Kasun P.', 'Ravi M.', 'Visitor 7A3D']) expect(within(wall).queryByText(new RegExp(name))).toBeNull();
    // The wall's map has no callout (MAP-UI-03): the ticker says it, by place only.
    expect(within(wall).queryByText(/^At risk 3:1\d$/)).toBeNull();
    expect(within(wall).getByText(/^A visitor in Kandy has waited 3:1\d — at risk$/)).toBeTruthy();
    expect(within(within(wall).getByRole('list', { name: 'Right now' })).getAllByRole('listitem').map((t) => t.querySelector('span')?.textContent)).toEqual([
      'On the site now', 'Waiting on us', 'At risk', 'In a chat', 'First reply', 'Missed today',
    ]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Live dashboard' })).toBeTruthy();
  });
});
