// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The Live dashboard opens at once (worksuite-desktop#248). Five sites and 130 people on them.
 *
 *  - From the copy this computer kept, marked "Updated 2 min ago · refreshing", with no full-page spinner.
 *  - Without one, the layout with a placeholder in each card and the list, each filling in as its own answer lands —
 *    the summary first (the cards, the fifty who need us most, the sites), the visitor list and the map's answer asked
 *    for at the same moment, the map's code last and only once its card is on screen.
 *  - "All sites" until the sites are known, never "All sites · 0"; the figure counted as the list counts.
 *  - A card that cannot be read says so with its own Retry; after five seconds with nothing, "Still loading… · Retry".
 *  - Kept in memory: back on the tab it is all there at once, and the Live map window and the tray reuse it.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, request } from '../../../src/core/api';
import { WebsiteLive, type OnlineVisitor } from '../../../src/modules/chat/website/WebsiteLive';
import { COUNTRY_BOXES } from '../../../src/modules/chat/website/live/countryBoxes';
import { agoWords, mergeLive, siteParams, type LiveSummary } from '../../../src/modules/chat/website/live/liveData';
import { useLiveDesk } from '../../../src/modules/chat/website/live/LiveDesk';
import { shapeBoxes, type Dashboard } from '../../../src/modules/chat/website/live/liveMap';
import { WORLD_SHAPES } from '../../../src/modules/chat/website/live/worldMap';
import { WORLD_POINTS } from '../../../src/modules/chat/website/live/worldMapPoints';

const W = '/api/chat/widget-admin';
const stamp = (agoS: number) => new Date(Date.now() - agoS * 1000).toISOString().slice(0, 19).replace('T', ' ');
const SITES = 5;
const PRESENT = 130;
const visitor = (i: number): OnlineVisitor => ({
  id: i, label: `Visitor ${String(i).padStart(4, '0')}`, name: null, email: null, widget_id: (i % SITES) + 1, website_name: `site${(i % SITES) + 1}.lk`,
  browser: 'Chrome', os: 'Windows', device: 'desktop', country: 'Sri Lanka', city: 'Colombo', lat: 6.9, lng: 79.9, current_url: `https://site.lk/p${i}`, current_title: null,
  referrer: null, utm_campaign: null, pages: 2, visits: 1, on_site_seconds: 240, idle_seconds: 5,
  conversation_id: i <= 12 ? 1000 + i : null, conversation_status: i <= 12 ? 'open' : null,
  chat: i <= 12 ? { awaiting: true, waiting_since: stamp(60 + i), at_risk: i <= 3, agent: null } : null,
});
const VISITORS = Array.from({ length: PRESENT }, (_, i) => visitor(i + 1));
const WIDGETS = Array.from({ length: SITES }, (_, i) => ({ id: i + 1, name: `site${i + 1}.lk`, status: 'active', open_now: true, online: PRESENT / SITES }));
const NOW: Dashboard['now'] = { visitors_online: PRESENT, open: 40, pending: 0, waiting_on_us: 12, at_risk: 3, arrived_10m: 43, longest_wait_since: stamp(72), staff_in_chats: 4, on_call: { count: 0, since: null }, at_risk_after: 180, window_seconds: 120 };
const summary = (o: Partial<LiveSummary> = {}): LiveSummary => ({
  now: NOW, today: { missed: 2, missed_last_hour: 1, first_response_median: 42 }, visitors: VISITORS.slice(0, 50), visitors_total: PRESENT,
  sources: [{ name: 'google.com', count: 60 }], widgets: WIDGETS, window_seconds: 120, server_time: stamp(0), ...o,
});
const dashboard = (o: Partial<Dashboard> = {}): Dashboard => ({
  // The full answer read a moment earlier than the list: the figure on screen is the list's.
  now: { ...NOW, visitors_online: 127 },
  today: { visitors: 400, returning: 60, conversations: 50, missed: 2, missed_last_hour: 1, page_views: 2000, first_response_median: 42 },
  activity: [],
  summary: { pages: [], countries: [{ name: 'Sri Lanka', count: 300 }], devices: [], referrers: [], places: [{ country: 'Sri Lanka', city: 'Colombo', lat: 6.9, lng: 79.9, count: 300 }] },
  widgets: WIDGETS, home_country: 'Sri Lanka', server_time: stamp(0), ...o,
});

/** What each path answers, after how long (ms); a function may throw. `never` never answers. */
type Answer = { after?: number; body?: unknown; fail?: unknown; never?: boolean };
let answers: Record<string, Answer | (() => Answer)>;
/** What this computer kept, by path. */
let saved: Record<string, unknown>;

function serve() {
  vi.mocked(apiGet).mockImplementation(((path: string) => {
    const a0 = answers[path] ?? (path === `${W}/canned` ? { body: { responses: [] } } : path === `${W}/conversations` ? { body: { conversations: [], can: {} } } : { fail: new Error(`unexpected ${path}`) });
    const a = typeof a0 === 'function' ? a0() : a0;
    if (a.never) return new Promise(() => undefined);
    return new Promise((resolve, reject) => {
      const settle = () => (a.fail ? reject(a.fail) : resolve(a.body));
      if (a.after) setTimeout(settle, a.after);
      else settle();
    });
  }) as never);
  vi.mocked(request).mockImplementation((async (_method: string, path: string, opts?: { headers?: Record<string, string> }) => {
    if (opts?.headers?.['X-WS-Local-Read'] === '1' && saved[path] !== undefined) return { data: saved[path], offline: true, cachedAt: stamp(120), message: null };
    throw new ApiError(404, 'No saved conversation.', 'CACHE_MISS');
  }) as never);
}

const props = { onSelect: vi.fn(), onOpenChat: vi.fn(), onSection: vi.fn() };
let client: QueryClient;
const ui = () => (
  <QueryClientProvider client={client}>
    <WebsiteLive view="dashboard" selected={null} {...props} />
  </QueryClientProvider>
);
const tiles = () => within(screen.getByRole('list', { name: 'Right now' })).getAllByRole('listitem').map((t) => t.getAttribute('aria-label'));
const listCard = () => screen.getByRole('region', { name: 'On the site now' });
const mapCard = () => screen.getByRole('region', { name: 'Where they are' });
const site = () => screen.getByRole('button', { name: 'Site' }).textContent;
/** Let fake time pass, and the answers and renders it releases settle. */
const pass = async (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    // An answer settled at the last tick schedules its render a tick later (TanStack's batch): let those run too.
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
  });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  answers = {
    [`${W}/dashboard/summary`]: { body: summary() },
    [`${W}/visitors`]: { body: { visitors: VISITORS } },
    [`${W}/dashboard`]: { body: dashboard() },
  };
  saved = {};
  Object.values(props).forEach((f) => f.mockReset());
  vi.mocked(apiGet).mockReset();
  vi.mocked(request).mockReset();
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('#248 · the dashboard opens at once', () => {
  it('from the copy kept on this computer, marked how old it is, with no full-page spinner', async () => {
    saved = { [`${W}/dashboard/summary`]: summary({ server_time: stamp(125) }), [`${W}/visitors`]: { visitors: VISITORS } };
    for (const path of Object.keys(answers)) answers[path] = { never: true };
    const t0 = performance.now();
    render(ui());
    await screen.findByText('Updated 2 min ago · refreshing');
    const ms = performance.now() - t0;
    console.info(`[#248] the saved copy on screen, ${SITES} sites and ${PRESENT} visitors: ${ms.toFixed(0)} ms`);

    expect(tiles()[0]).toBe(`On the site now: ${PRESENT} — see who`);
    expect(tiles()[1]).toBe('Waiting on us: 12 — open those chats');
    expect(site()).toContain(`All sites · ${SITES}`);
    expect(within(listCard()).getByRole('heading').textContent).toBe(`On the site now · ${PRESENT}`);
    expect(screen.queryByText('Loading…')).toBeNull();
    // Well inside the 200 ms the page and its saved copy are given (the margin is for a loaded test machine).
    expect(ms).toBeLessThan(1_000);
  });

  it('without one: the layout and placeholders at once, "All sites" never "· 0", then each card as its answer lands', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    answers[`${W}/dashboard/summary`] = { after: 250, body: summary() };
    answers[`${W}/visitors`] = { after: 600, body: { visitors: VISITORS } };
    answers[`${W}/dashboard`] = { after: 1_500, body: dashboard() };
    render(ui());
    await pass(0);

    // All three asked for at once; nothing waits for anything else.
    const asked = vi.mocked(apiGet).mock.calls.map(([p]) => p);
    expect(asked).toEqual(expect.arrayContaining([`${W}/dashboard/summary`, `${W}/visitors`, `${W}/dashboard`]));

    expect(screen.getByRole('heading', { name: 'Live dashboard' })).toBeTruthy();
    expect(tiles()).toEqual(['On the site now: loading', 'Waiting on us: loading', 'At risk: loading', 'Open chats: loading', 'On a call: loading', 'First reply: loading']);
    expect(site()).toBe('All sites ▾');
    expect(screen.getByText('Refreshing…')).toBeTruthy();
    expect(within(listCard()).getByTestId('rows-placeholder')).toBeTruthy();
    expect(within(listCard()).getByRole('heading').textContent).toBe('On the site now');
    expect(within(mapCard()).getByTestId('map-placeholder')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();

    // By 300 ms: the summary — the cards, the fifty who need us most, the sites.
    await pass(300);
    expect(tiles()[0]).toBe(`On the site now: ${PRESENT} — see who`);
    expect(tiles()[2]).toBe('At risk: 3 — open those chats');
    expect(site()).toContain(`All sites · ${SITES}`);
    expect(screen.getByText(/^Live · updated \d+ s ago$/)).toBeTruthy();
    expect(within(listCard()).getByRole('heading').textContent).toBe(`On the site now · ${PRESENT}`);
    expect(within(listCard()).getByRole('group', { name: 'Needs you' })).toBeTruthy();

    // Within the second: the whole list. The figure is the list's count, as the sidebar's is.
    await pass(700);
    expect(tiles()[0]).toBe(`On the site now: ${PRESENT} — see who`);
    expect(screen.getByRole('button', { name: `All ${PRESENT} visitors online →` })).toBeTruthy();

    // The map's answer, later: the figure does not move to the full answer's older count.
    await pass(1_000);
    expect(tiles()[0]).toBe(`On the site now: ${PRESENT} — see who`);
  });

  it('after five seconds with nothing, says it is still loading, centred, with Retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    for (const path of Object.keys(answers)) answers[path] = { never: true };
    render(ui());
    await pass(4_900);
    expect(screen.queryByText('Still loading…')).toBeNull();
    await pass(200);
    const note = screen.getByText('Still loading…').closest('[role="status"]') as HTMLElement;
    expect(note).toBeTruthy();
    const before = vi.mocked(apiGet).mock.calls.filter(([p]) => p === `${W}/dashboard/summary`).length;
    answers[`${W}/dashboard/summary`] = { body: summary() };
    fireEvent.click(within(note).getByRole('button', { name: 'Retry' }));
    await pass(10);
    expect(vi.mocked(apiGet).mock.calls.filter(([p]) => p === `${W}/dashboard/summary`).length).toBeGreaterThan(before);
    expect(tiles()[0]).toBe(`On the site now: ${PRESENT} — see who`);
    expect(screen.queryByText('Still loading…')).toBeNull();
  });
});

describe('#248 · each card fails on its own', () => {
  it("the figures and the map say Couldn't load with their own Retry, while the list still shows everybody", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    answers[`${W}/dashboard/summary`] = { fail: new ApiError(500, 'Server error', null) };
    answers[`${W}/dashboard`] = { fail: new ApiError(500, 'Server error', null) };
    render(ui());
    // Two retries, a second and two apart.
    await pass(4_000);
    const alerts = screen.getAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toEqual(["Couldn't load·Retry", "Couldn't load·Retry"]);
    expect(within(mapCard()).getByRole('alert')).toBeTruthy();
    expect(within(listCard()).queryByRole('alert')).toBeNull();
    expect(within(listCard()).getByRole('heading').textContent).toBe(`On the site now · ${PRESENT}`);
    expect(screen.queryByText('Still loading…')).toBeNull();

    answers[`${W}/dashboard/summary`] = { body: summary() };
    answers[`${W}/dashboard`] = { body: dashboard() };
    fireEvent.click(within(alerts[0]!).getByRole('button', { name: 'Retry' }));
    await pass(10);
    expect(tiles()[1]).toBe('Waiting on us: 12 — open those chats');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it("the list says Couldn't load with its Retry when nobody can be read, and the figures still show", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    answers[`${W}/dashboard/summary`] = { fail: new ApiError(404, 'Not found', null) };
    answers[`${W}/visitors`] = { fail: new ApiError(500, 'Server error', null) };
    render(ui());
    await pass(4_000);
    // A server before #248 has no summary: the full answer stands in for the figures.
    expect(tiles()[1]).toBe('Waiting on us: 12 — open those chats');
    const failed = within(listCard()).getByRole('alert');
    expect(failed.textContent).toBe("Couldn't load·Retry");
    answers[`${W}/visitors`] = { body: { visitors: VISITORS } };
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }));
    await pass(10);
    expect(within(listCard()).queryByRole('alert')).toBeNull();
    expect(within(listCard()).getByRole('heading').textContent).toBe(`On the site now · ${PRESENT}`);
  });
});

describe('#248 · the map comes last', () => {
  it('loads its code only once its card is on screen', async () => {
    const seen: Array<(e: Array<{ isIntersecting: boolean }>) => void> = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) {
        seen.push(cb);
      }
      observe() {}
      disconnect() {}
    });
    render(ui());
    await screen.findByRole('listitem', { name: `On the site now: ${PRESENT} — see who` });
    expect(within(mapCard()).getByTestId('map-placeholder')).toBeTruthy();
    expect(within(mapCard()).queryByRole('img', { name: /^Map of visitors on the site now/ })).toBeNull();
    expect(seen.length).toBeGreaterThan(0);

    act(() => seen.forEach((cb) => cb([{ isIntersecting: true }])));
    expect(await within(mapCard()).findByRole('img', { name: /^Map of visitors on the site now/ })).toBeTruthy();
    expect(within(mapCard()).queryByTestId('map-placeholder')).toBeNull();
  });
});

describe('#248 · kept in memory', () => {
  it('back on the tab, everything is there on the first frame, and nothing is asked again', async () => {
    const first = render(ui());
    await screen.findByRole('button', { name: `All ${PRESENT} visitors online →` });
    first.unmount();
    const asked = vi.mocked(apiGet).mock.calls.length;

    render(ui());
    // No waiting: the first render has the figures, the sites and the list.
    expect(tiles()[0]).toBe(`On the site now: ${PRESENT} — see who`);
    expect(site()).toContain(`All sites · ${SITES}`);
    expect(screen.getByRole('button', { name: `All ${PRESENT} visitors online →` })).toBeTruthy();
    expect(screen.queryByTestId('rows-placeholder')).toBeNull();
    expect(vi.mocked(apiGet).mock.calls.filter(([p]) => p !== `${W}/canned` && p !== `${W}/conversations`).length).toBe(
      vi.mocked(apiGet).mock.calls.slice(0, asked).filter(([p]) => p !== `${W}/canned` && p !== `${W}/conversations`).length,
    );
  });

  it('the Live map window and the tray read the same answers', async () => {
    render(ui());
    await screen.findByRole('button', { name: `All ${PRESENT} visitors online →` });
    const asked = vi.mocked(apiGet).mock.calls.length;
    function Desk() {
      const desk = useLiveDesk();
      return <p>{desk.d ? `waiting ${desk.d.now.waiting_on_us} · ${desk.visitors.length} here` : 'none'}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <Desk />
      </QueryClientProvider>,
    );
    expect(screen.getByText(`waiting 12 · ${PRESENT} here`)).toBeTruthy();
    expect(vi.mocked(apiGet).mock.calls.slice(asked).filter(([p]) => p === `${W}/dashboard/summary` || p === `${W}/visitors`)).toHaveLength(0);
  });

  it('a server without the summary: the Live map window falls back to the full answer', async () => {
    answers[`${W}/dashboard/summary`] = { fail: new ApiError(404, 'Not found', null) };
    function Desk() {
      const desk = useLiveDesk();
      return <p>{desk.d ? `waiting ${desk.d.now.waiting_on_us}` : 'none'}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <Desk />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('waiting 12')).toBeTruthy();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`${W}/dashboard`, undefined, expect.anything()));
  });
});

describe('#248 · the pieces', () => {
  it('merges the summary and the full answer, the newer figures winning', () => {
    const s = summary({ now: { ...NOW, waiting_on_us: 5 } });
    const f = dashboard({ now: { ...NOW, waiting_on_us: 9 } });
    expect(mergeLive(undefined, 0, undefined, 0)).toBeUndefined();
    expect(mergeLive(s, 2, f, 1)!.now.waiting_on_us).toBe(5);
    expect(mergeLive(s, 1, f, 2)!.now.waiting_on_us).toBe(9);
    // The summary alone: the figures and sites, with an empty map and feed until the full answer is in.
    const only = mergeLive(s, 1, undefined, 0)!;
    expect([only.widgets.length, only.activity, only.summary.countries, only.today.first_response_median]).toEqual([SITES, [], [], 42]);
    // The full answer's map stays when the summary is newer.
    expect(mergeLive(s, 2, f, 1)!.summary.places).toHaveLength(1);
  });

  it('says how old a copy is, and asks for the sites shown', () => {
    expect([agoWords(40), agoWords(125), agoWords(3 * 3600 + 5), agoWords(2 * 86_400)]).toEqual(['40 s', '2 min', '3 h', '2 d']);
    expect([siteParams([]), siteParams([2]), siteParams([1, 3])]).toEqual([undefined, { widget_id: '2' }, { widget_ids: '1,3' }]);
  });

  it("the countries' boxes kept for the dashboard agree with the world's outlines they came from", () => {
    const fromShapes = shapeBoxes(WORLD_SHAPES, WORLD_POINTS);
    expect(Object.keys(COUNTRY_BOXES).sort()).toEqual([...fromShapes.keys()].sort());
    for (const [code, b] of fromShapes) {
      const [x, y, w, h] = COUNTRY_BOXES[code]!;
      expect([x, y, w, h].map((n, i) => Math.abs(n - [b.x, b.y, b.w, b.h][i]!) < 0.001)).toEqual([true, true, true, true]);
    }
  });
});
