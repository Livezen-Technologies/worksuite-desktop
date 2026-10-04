// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The full map zoomed to a country (worksuite-desktop L-02, WS-WCHAT MAP-UI-02) and wall mode with names hidden (L-03,
 * MAP-UI-03): the presets with the home country, the state chips with their colours, the legend beside them, the edge
 * chips, the selected place's panel with its precision and today's figures, several sites at once, the view kept in
 * the address; and the dark wall with its big figures, a ticker by place and event only, the sites, the screen kept
 * awake and full screen, and Esc to leave.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiGet } from '../../../src/core/api';
import { justNow, liveParamsOf, liveQuery, NO_LIVE_PARAMS, precisionNote, type LiveParams } from '../../../src/modules/chat/website/live/LiveDashboard';
import { boxOfParam, countryBox, type Dashboard, mapParam, outsideOf, padded, panned, placesNow, presetsFor, sameBox, WORLD_BOX, zoomAt } from '../../../src/modules/chat/website/live/liveMap';
import { WebsiteLive, type OnlineVisitor } from '../../../src/modules/chat/website/WebsiteLive';

const stamp = (agoS: number) => new Date(Date.now() - agoS * 1000).toISOString().slice(0, 19).replace('T', ' ');
const V = (o: Partial<OnlineVisitor>): OnlineVisitor => ({
  id: 1, label: 'Visitor 4F2A', name: null, email: null, widget_id: 1, website_name: 'techubiz.com', browser: 'Chrome', os: 'Windows', device: 'desktop',
  country: 'Sri Lanka', city: 'Colombo', region: 'Western Province', geo_source: 'geoip', lat: 6.9, lng: 79.9, current_url: 'https://techubiz.com/shop/adobe-creative-cloud', current_title: null, referrer: null,
  utm_campaign: null, pages: 2, visits: 1, on_site_seconds: 240, idle_seconds: 5, conversation_id: null, conversation_status: null, chat: null, ...o,
});
const chat = (o: Partial<NonNullable<OnlineVisitor['chat']>>) => ({ awaiting: false, waiting_since: null, at_risk: false, agent: null, agent_typing: false, call: null, ...o });
const VISITORS = [
  V({ id: 1, name: 'Anne', email: 'anne@example.com', city: 'Kandy', region: 'Central Province', lat: 7.3, lng: 80.6, current_url: 'https://techubiz.com/support/activation', conversation_id: 11, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(192), at_risk: true }) }),
  V({ id: 2, conversation_id: 12, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(98) }) }),
  V({ id: 3, label: 'Visitor 9C1E', city: 'Galle', region: 'Southern Province', lat: 6.0, lng: 80.2, conversation_id: 13, conversation_status: 'open', chat: chat({ agent: 'You', call: { status: 'active', since: stamp(134) } }) }),
  V({ id: 4, name: 'Kasun P.', conversation_id: 14, conversation_status: 'open', chat: chat({ agent: 'Nuwan' }) }),
  V({ id: 5, name: 'Ravi M.', country: 'United Arab Emirates', city: 'Dubai', region: null, geo_source: 'header', lat: 25.2, lng: 55.3, conversation_id: 15, conversation_status: 'open', chat: chat({ agent: 'Dilini', agent_typing: true }) }),
  V({ id: 6, label: 'Visitor 7A3D', visits: 3, current_url: 'https://techubiz.com/shop/microsoft-365' }),
  V({ id: 7, label: 'Visitor B210', widget_id: 2, country: 'India', city: 'Mumbai', region: null, geo_source: 'header', lat: 19.1, lng: 72.9, referrer_host: 'google.com', on_site_seconds: 60, current_url: 'https://techubiz.com/pricing' }),
  V({ id: 8, label: 'Visitor 2C88', city: null, region: null, lat: null, lng: null, geo_source: 'timezone', on_site_seconds: 10, current_url: 'https://techubiz.com/' }),
  V({ id: 9, label: 'Visitor 51EF', widget_id: 3, country: 'United Kingdom', city: 'London', region: null, geo_source: 'header', lat: 51.5, lng: -0.1, on_site_seconds: 360, current_url: 'https://techubiz.com/blog/office-2024-vs-365' }),
];
const act_ = (o: Partial<NonNullable<Dashboard['activity']>[number]>): NonNullable<Dashboard['activity']>[number] => ({ id: 1, kind: 'page_view', visitor_id: 1, who: 'Somebody Named', site: 'techubiz.com', title: null, url: null, country: null, city: null, at: stamp(300), ...o });
const DASH = {
  now: { visitors_online: 9, open: 4, pending: 1, waiting_on_us: 2, at_risk: 1, arrived_10m: 3, longest_wait_since: stamp(192), staff_in_chats: 3, on_call: { count: 1, since: stamp(134) }, at_risk_after: 180, window_seconds: 300 },
  today: { visitors: 140, returning: 26, conversations: 19, page_views: 830, missed: 1, missed_last_hour: 0, first_response_median: 42 },
  activity: [
    act_({ id: 1, kind: 'chat_started', visitor_id: 5, who: 'Ravi M.', country: 'United Arab Emirates', city: 'Dubai', at: stamp(240) }),
    act_({ id: 2, visitor_id: 7, who: 'Visitor B210', country: 'India', city: 'Mumbai', url: 'https://techubiz.com/', arrived: true, referrer_host: 'google.com', at: stamp(250) }),
    act_({ id: 3, visitor_id: 9, who: 'Visitor 51EF', country: 'United Kingdom', city: 'London', url: 'https://techubiz.com/pricing?email=anne@example.com', at: stamp(260) }),
    act_({ id: 4, visitor_id: 8, who: 'Visitor 2C88', country: 'Sri Lanka', city: null, approx: true, arrived: true, referrer_host: null, url: 'https://techubiz.com/', at: stamp(270) }),
  ],
  summary: {
    pages: [], countries: [{ name: 'Sri Lanka', count: 90 }], devices: [], referrers: [],
    places: [{ country: 'Sri Lanka', city: 'Colombo', lat: 6.9, lng: 79.9, count: 14, chats: 3 }, { country: 'Japan', city: null, lat: null, lng: null, count: 5, chats: 0 }],
  },
  widgets: [
    { id: 1, name: 'techubiz.com', status: 'active', open_now: true, online: 11 },
    { id: 2, name: 'techhub.com.lk', status: 'active', open_now: true, online: 5 },
    { id: 3, name: 'licensepaluk.lk', status: 'active', open_now: false, online: 2 },
  ],
  home_country: 'Sri Lanka',
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

/** The dashboard as the workspace holds it: its view in an address, rewritten on each change. */
let address = new URLSearchParams();
function Harness({ start }: { start: LiveParams }) {
  const [live, setLive] = useState(start);
  return (
    <WebsiteLive
      view="dashboard"
      selected={null}
      {...props}
      live={live}
      onLive={(patch) => {
        const next = { ...live, ...patch };
        address = liveQuery('dashboard', next, null);
        setLive(next);
      }}
    />
  );
}

const mount = (start: LiveParams = NO_LIVE_PARAMS) =>
  render(
    <QueryClientProvider client={client}>
      <Harness start={start} />
    </QueryClientProvider>,
  );
const ready = async () => {
  await screen.findByRole('listitem', { name: /^On the site now: 9/ });
};
/** The full map once both answers are in: the busiest place picked. */
const readyMap = async () => {
  await screen.findByRole('region', { name: 'Selected place' });
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Selected place' })).getAllByRole('group').length).toBeGreaterThan(0));
};
const full = () => screen.getByRole('main');
const panel = () => screen.getByRole('region', { name: 'Selected place' });
const mapCard = () => screen.getByRole('region', { name: 'Map' });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.values(props).forEach((f) => f.mockReset());
  address = new URLSearchParams();
  serve();
});
afterEach(() => cleanup());

describe('L-02 · the full map zoomed to a country', () => {
  it('has the design’s header, presets with the home country, state chips with counts and the legend beside them', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Full map' }));
    expect(screen.getByRole('heading', { name: 'Map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Live dashboard' })).toBeTruthy();
    expect(within(full()).getByRole('radio', { name: 'Now' }).getAttribute('aria-checked')).toBe('true');
    // World, Asia, South Asia and the organisation's own country (MAP-08).
    expect(within(screen.getByRole('group', { name: 'Zoom to' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['World', 'Asia', 'South Asia', 'Sri Lanka']);
    expect(screen.getByRole('button', { name: 'Site' }).textContent).toBe('All sites ▾');
    expect(within(screen.getByRole('group', { name: 'Show visitors' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['All · 9', 'Needs you · 2', 'In a chat · 3', 'Browsing · 4']);
    expect(within(screen.getByRole('list', { name: 'Map legend' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual([
      'Browsing', 'Chatting', 'Waiting on us', 'At risk', 'On a call', 'City', 'Country only ≈',
    ]);
    expect(within(mapCard()).getByText('Detailed outlines load when you zoom past a region · drag to pan · scroll or pinch to zoom')).toBeTruthy();
    expect(within(mapCard()).getByRole('button', { name: 'Show everyone' }).textContent).toBe('⤢');
    // The view is in the address once it settles: the world.
    expect(address.get('map')).toBe('world');
  });

  it('zoomed to Sri Lanka: the edge chip, the timezone-only ring, the detail outline and Colombo picked', async () => {
    mount({ ...NO_LIVE_PARAMS, map: 'lk' });
    await readyMap();
    expect(within(screen.getByRole('group', { name: 'Zoom to' })).getByRole('button', { name: 'Sri Lanka' }).getAttribute('aria-pressed')).toBe('true');
    const away = within(within(mapCard()).getByRole('list', { name: 'Outside this view' })).getAllByRole('listitem').map((i) => i.textContent);
    expect(away).toContain('↖ India · 1 outside this view');
    expect(within(mapCard()).getByText('Sri Lanka ≈ 1 · timezone only')).toBeTruthy();
    expect(within(mapCard()).getByText('Colombo 3')).toBeTruthy();
    expect(within(mapCard()).getByText('Kandy 1')).toBeTruthy();
    // Past a region's zoom, Sri Lanka's 1:10m outline replaces the world's (MAP-09).
    const svg = within(mapCard()).getByRole('img');
    await waitFor(() => expect(svg.querySelector('[data-detail="LK"]')).toBeTruthy());
    // The busiest place is picked, with a dashed ring.
    expect(svg.querySelector('[data-place="Sri Lanka|Colombo|6.9|79.9"] [data-picked]')?.getAttribute('stroke-dasharray')).toBeTruthy();

    expect(within(panel()).getByRole('heading').textContent).toBe('Colombo');
    expect(within(panel()).getByText('Western Province, Sri Lanka · 3 on the site now')).toBeTruthy();
    expect(within(panel()).getByText('City · GeoIP')).toBeTruthy();
    expect(within(panel()).getByText('Today: 14 visitors · 3 chats')).toBeTruthy();
    expect(within(panel()).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Needs you', 'In a chat', 'Browsing']);
    // Each row says where, as the design's "Visitor 4F2A · Colombo".
    expect(within(panel()).getByRole('listitem', { name: 'Visitor 4F2A' }).textContent).toContain('· Colombo');
    expect(within(within(panel()).getByRole('listitem', { name: 'Visitor 4F2A' })).getByRole('button', { name: 'Join' })).toBeTruthy();
    expect(within(within(panel()).getByRole('listitem', { name: 'Kasun P.' })).getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(within(within(panel()).getByRole('listitem', { name: 'Visitor 7A3D' })).getByRole('button', { name: 'Start chat' })).toBeTruthy();
    expect(within(panel()).getByText('How precise is this')).toBeTruthy();
    expect(within(panel()).getByText('5 of 6 Sri Lankan visitors have a city from GeoIP (rounded to about 10 km). 1 is placed by browser timezone only, so it is shown on the country, not a city.')).toBeTruthy();

    // Picking another place keeps it in the address.
    fireEvent.click(within(mapCard()).getByRole('button', { name: /^Kandy: 1 · At risk$/ }));
    expect(within(panel()).getByRole('heading').textContent).toBe('Kandy');
    expect(address.get('place')).toBe('Sri Lanka|Kandy|7.3|80.6');
    // The timezone-only ring: the country, and how it was placed.
    fireEvent.click(within(mapCard()).getByRole('button', { name: /^Sri Lanka \(country only\): 1/ }));
    expect(within(panel()).getByRole('heading').textContent).toBe('Sri Lanka ≈');
    expect(within(panel()).getByText('Country only · browser timezone')).toBeTruthy();
  });

  it('chips filter the map and stay in the address; zoom by scroll, ⤢ brings everybody back', async () => {
    mount({ ...NO_LIVE_PARAMS, map: 'lk' });
    await readyMap();
    fireEvent.click(screen.getByRole('button', { name: 'Needs you · 2' }));
    expect(screen.getByRole('button', { name: 'Needs you · 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(address.get('filter')).toBe('needs');
    expect(within(mapCard()).queryByRole('button', { name: /^Colombo: / })).toBeTruthy();
    expect(within(mapCard()).queryByRole('button', { name: /^Galle: / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All · 9' }));

    const frame = within(mapCard()).getByRole('img').parentElement!;
    fireEvent.wheel(frame, { deltaY: 400, clientX: 300, clientY: 200 });
    expect(within(screen.getByRole('group', { name: 'Zoom to' })).getByRole('button', { name: 'Sri Lanka' }).getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(address.get('map')).toMatch(/^-?\d+\.\d\d,-?\d+\.\d\d,\d+\.\d\d$/));
    fireEvent.click(within(mapCard()).getByRole('button', { name: 'Show everyone' }));
    await waitFor(() => expect(within(mapCard()).queryByRole('list', { name: 'Outside this view' })).toBeNull());
  });

  it('shows one site, several, or all of them (MAP-14)', async () => {
    mount({ ...NO_LIVE_PARAMS, map: 'world' });
    await readyMap();
    fireEvent.click(screen.getByRole('button', { name: 'Site' }));
    // A site's box takes it out of those shown: the other two remain, asked for together.
    const check = screen.getByRole('menuitemcheckbox', { name: 'licensepaluk.lk' }).querySelector('[data-menu-check]')!;
    fireEvent.click(check);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/dashboard', { widget_ids: '1,2' }, expect.anything()));
    expect(address.get('sites')).toBe('1,2');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Site' }).textContent).toBe('2 sites ▾'));
    expect(screen.getByRole('button', { name: 'All · 8' })).toBeTruthy();
  });
});

describe('L-03 · wall mode, names hidden', () => {
  it('is dark and full screen, with the design’s header, big figures, ticker by place and event, and the sites', async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const enter = vi.fn(async () => undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: enter });
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Wall mode' }));
    const wall = screen.getByRole('dialog', { name: 'Website chats — live, wall mode' });
    expect(address.get('wall')).toBe('1');
    expect(wall.className).toContain('bg-[#0b1430]');
    // The screen is kept awake and the whole screen taken (MAP-16, WF-M3).
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    expect(enter).toHaveBeenCalled();

    expect(within(wall).getByText('Website chats — live')).toBeTruthy();
    expect(within(wall).getByText('Live')).toBeTruthy();
    expect(within(wall).getByText('All sites · techubiz.com, techhub.com.lk, licensepaluk.lk')).toBeTruthy();
    expect(within(wall).getByText('Names hidden on this screen')).toBeTruthy();
    expect(within(wall).getByRole('button', { name: 'Esc to exit' })).toBeTruthy();

    const tiles = within(within(wall).getByRole('list', { name: 'Right now' })).getAllByRole('listitem');
    expect(tiles.map((t) => t.textContent?.replace(/\d:\d\d/g, 'm:ss'))).toEqual([
      'On the site now9+3 in 10 min', 'Waiting on us2longest m:ss', 'At risk1past m:ss', 'In a chat31 on a call', 'First replym:ssmedian today', 'Missed today10 in last hour',
    ]);

    const ticker = within(within(wall).getByRole('list', { name: 'Just now' })).getAllByRole('listitem').map((i) => i.querySelector('span:nth-child(2)')?.textContent);
    expect(ticker[0]).toMatch(/^A visitor in Kandy has waited 3:1\d — at risk$/);
    expect(ticker.slice(1)).toEqual([
      'A visitor in Colombo is waiting for a reply',
      'Voice call answered · Galle',
      'Chat started · Dubai',
      'Arrived from google.com · Mumbai',
      'Opened /pricing · London',
      'Arrived · Sri Lanka ≈',
    ]);
    // The two that need somebody stand out.
    const rows = within(within(wall).getByRole('list', { name: 'Just now' })).getAllByRole('listitem');
    expect(rows[0]!.querySelector('span:nth-child(2)')?.className).toContain('font-bold');
    expect(rows[2]!.querySelector('span:nth-child(2)')?.className).toContain('font-medium');

    expect(within(within(wall).getByRole('list', { name: 'Sites' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual([
      '● techubiz.com11', '● techhub.com.lk5', '● licensepaluk.lk · closed2',
    ]);
    // The map names places only, its count in the disc; the legend is drawn on it.
    expect(within(wall).getByText('London')).toBeTruthy();
    expect(within(wall).queryByText('London 1')).toBeNull();
    expect(within(wall).getByRole('list', { name: 'Map legend' })).toBeTruthy();
  });

  it('shows no personal data anywhere (MNFR-04)', async () => {
    mount({ ...NO_LIVE_PARAMS, wall: true });
    await ready();
    const wall = await screen.findByRole('dialog', { name: 'Website chats — live, wall mode' });
    const all = wall.textContent ?? '';
    for (const personal of ['Anne', 'anne@example.com', 'Kasun', 'Ravi', 'Somebody Named', 'Visitor 7A3D', 'Visitor B210', 'Visitor 2C88', 'Nuwan', 'Dilini', 'email=']) {
      expect(all).not.toContain(personal);
    }
    for (const t of [...wall.querySelectorAll('title')].map((x) => x.textContent ?? '')) expect(t).not.toMatch(/Anne|Kasun|Ravi|Visitor/);
  });

  it('leaves on Esc, its button, or when full screen ends, letting the screen sleep again', async () => {
    const release = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn(async () => ({ release })) } });
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: vi.fn(async () => undefined) });
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Wall mode' }));
    await act(async () => undefined);
    // Full screen ends (the system's Esc): the wall goes with it.
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    fireEvent(document, new Event('fullscreenchange'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(release).toHaveBeenCalled();
    expect(address.get('wall')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Wall mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Esc to exit' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Wall mode' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Live dashboard' })).toBeTruthy();
  });
});

describe('the pieces', () => {
  it('reads and writes the view in the address (MAP-15)', () => {
    const q = liveQuery('dashboard', { map: 'lk', filter: 'needs', when: 'today', place: 'Sri Lanka|≈', sites: [1, 3], wall: false }, 7);
    expect(q.toString()).toBe('view=website&section=dashboard&visitor=7&map=lk&filter=needs&when=today&place=Sri+Lanka%7C%E2%89%88&sites=1%2C3');
    expect(liveParamsOf(q)).toEqual({ map: 'lk', filter: 'needs', when: 'today', place: 'Sri Lanka|≈', sites: [1, 3], wall: false });
    expect(liveParamsOf(new URLSearchParams('filter=nonsense&sites=x,0,2&wall=1'))).toEqual({ ...NO_LIVE_PARAMS, sites: [2], wall: true });
  });

  it('presets, a view by centre and zoom, and zooming about a point', () => {
    const presets = presetsFor('Sri Lanka', true);
    expect(presets.map((p) => p.key)).toEqual(['world', 'asia', 'south-asia', 'lk']);
    expect(presetsFor('United Kingdom', true).map((p) => p.label)).toEqual(['World', 'Europe', 'United Kingdom']);
    expect(sameBox(boxOfParam('lk', presets), padded(countryBox('LK')!, 0.3))).toBe(true);
    // Any country by its code, even one that is not a preset.
    expect(sameBox(boxOfParam('jp', presets), padded(countryBox('JP')!, 0.3))).toBe(true);
    const at = boxOfParam('80.00,7.50,20.00', presets);
    expect(mapParam(at, presets)).toBe('80.00,7.50,20.00');
    expect(boxOfParam(null, presets)).toEqual(WORLD_BOX);
    // The point under the pointer stays put.
    const z = zoomAt(WORLD_BOX, 0.5, { x: 700, y: 200 });
    expect((700 - z.x) / z.w).toBeCloseTo((700 - WORLD_BOX.x) / WORLD_BOX.w);
    expect(z.w).toBe(500);
    // A pan never takes the centre off the map.
    expect(panned(WORLD_BOX, 5000, 0).x + WORLD_BOX.w / 2).toBe(1000);
  });

  it('points to who is outside the view, busiest first', () => {
    const lk = padded(countryBox('LK')!, 0.3);
    const out = outsideOf(placesNow(VISITORS), lk);
    expect(out.map((o) => `${o.arrow} ${o.country} · ${o.count}`)).toEqual(['↖ United Arab Emirates · 1', '↖ India · 1', '↖ United Kingdom · 1']);
  });

  it('says how precise a country’s locations are, without a demonym it does not know', () => {
    const at = (o: Partial<OnlineVisitor>) => V({ country: 'Peru', ...o });
    expect(precisionNote('Peru', [at({ geo_source: 'header' }), at({ lat: null, lng: null, geo_source: 'timezone' }), at({ lat: null, lng: null, geo_source: 'timezone' })])).toBe(
      '1 of 3 visitors in Peru has a city from your CDN (rounded to about 10 km). 2 are placed by browser timezone only, so they are shown on the country, not a city.',
    );
    expect(precisionNote('Sri Lanka', [V({ geo_source: 'header' }), V({ geo_source: 'geoip' })])).toBe('2 of 2 Sri Lankan visitors have a city from your CDN or GeoIP (rounded to about 10 km).');
  });

  it('the ticker names nobody, and marks a country-only place ≈', () => {
    const rows = justNow({ activity: [act_({ arrived: true, referrer_host: null, country: 'Japan', approx: true }), act_({ id: 2, kind: 'identified', who: 'Anne', country: 'Japan', city: 'Tokyo' })] }, [], Date.now());
    expect(rows.map((r) => r.text)).toEqual(['Arrived · Japan ≈', 'A visitor shared their details · Tokyo']);
  });
});
