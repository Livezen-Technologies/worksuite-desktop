// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The Live dashboard's map in the app's theme (worksuite-desktop#284): in dark mode the land is dark, the sea the card
 * it sits in and the scale brightens for more; in light the land is white on a pale sea and the scale darkens for more.
 * Every colour is a `--map-*` variable, so switching theme repaints the map at once; text and dots meet WCAG AA and 3:1
 * in both themes. Places are named, and only named — the count is in the disc — and a name that would collide is left
 * off until zooming in or a hover makes room. The longest wait counts only chats somebody is waiting in now, and a
 * long one reads in days.
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

import { contrast, luminance } from '../../../shared/color';
import { DARK_PROFILES } from '../../../shared/theme-profiles';
import { apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { WebsiteLive, type OnlineVisitor } from '../../../src/modules/chat/website/WebsiteLive';
import { longestWait, placesNow, px, py, waitWords, WORLD_BOX, type Dashboard, type Place } from '../../../src/modules/chat/website/live/liveMap';
import { MapLegend } from '../../../src/modules/chat/website/live/MapLegend';
import { hoverLabel, LiveMap, placeLabels, SHADE, shadeSteps } from '../../../src/modules/chat/website/live/WorldMapView';

const stamp = (agoS: number) => new Date(Date.now() - agoS * 1000).toISOString().slice(0, 19).replace('T', ' ');
const V = (o: Partial<OnlineVisitor>): OnlineVisitor => ({
  id: 1, label: 'Visitor 4F2A', name: null, email: null, widget_id: 1, website_name: 'techubiz.com', browser: 'Chrome', os: 'Windows', device: 'desktop',
  country: 'Sri Lanka', city: 'Colombo', lat: 6.9, lng: 79.9, current_url: 'https://techubiz.com/', current_title: null, referrer: null,
  utm_campaign: null, pages: 2, visits: 1, on_site_seconds: 240, idle_seconds: 5, conversation_id: null, conversation_status: null, chat: null, ...o,
});
const chat = (o: Partial<NonNullable<OnlineVisitor['chat']>>) => ({ awaiting: false, waiting_since: null, at_risk: false, agent: null, agent_typing: false, call: null, ...o });

/* ---------------------------------------------------------------- the theme's variables */

const CSS = readFileSync(join(__dirname, '../../../src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The `--map-*` variables the rules with this selector set. */
function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() !== selector || !m[2]!.includes('--map-')) continue;
    for (const d of m[2]!.matchAll(/(--map-[a-z0-9-]+):\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
  }
  return out;
}
const LIGHT = tokens(':root');
const DARK = tokens("[data-theme='dark']");
const WALL = { ...DARK, ...tokens("[data-theme='dark'] [data-map-wall]") };
const STATES = ['--map-browsing', '--map-chatting', '--map-waiting', '--map-at-risk', '--map-on-call'];
const SCALE = [1, 2, 3, 4, 5].map((n) => `--map-shade-${n}`);
/** The dark sea is the card the map sits in: every built-in dark profile's surface. */
const DARK_SEAS = DARK_PROFILES.map((p) => p.tokens['--ws-surface']!);

describe('the theme’s colours (styles.css)', () => {
  it('sets every map colour for light and for dark, as the issue gives them', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    expect(LIGHT).toMatchObject({
      '--map-ocean': '#eef1f8', '--map-land': '#ffffff', '--map-border': 'rgba(18, 22, 51, 0.12)',
      '--map-shade-1': '#dce1ff', '--map-shade-5': '#4f5fef', '--map-label': '#121633', '--map-halo': '#ffffff',
    });
    expect(DARK).toMatchObject({
      '--map-ocean': 'var(--ws-surface)', '--map-land': '#1e2552', '--map-border': 'rgba(255, 255, 255, 0.08)',
      '--map-shade-1': '#2c3780', '--map-shade-5': '#6676ff', '--map-label': '#e6e8f5', '--map-halo': '#0c1029',
    });
    // The wall changes the states only: a step brighter than the dark map's.
    expect(Object.keys(tokens("[data-theme='dark'] [data-map-wall]")).sort()).toEqual([...STATES].sort());
    for (const s of STATES) expect(luminance(WALL[s]!)).toBeGreaterThan(luminance(DARK[s]!));
  });

  it('has five steps of the accent: darker for more on light, brighter for more on dark', () => {
    const light = SCALE.map((n) => luminance(LIGHT[n]!));
    const dark = SCALE.map((n) => luminance(DARK[n]!));
    for (let i = 1; i < SCALE.length; i++) {
      expect(light[i]).toBeLessThan(light[i - 1]!);
      expect(dark[i]).toBeGreaterThan(dark[i - 1]!);
    }
    // Even the fewest visitors read as visited, and the most stand well off the land.
    expect(luminance(LIGHT['--map-shade-1']!)).toBeLessThan(luminance(LIGHT['--map-land']!));
    expect(luminance(DARK['--map-shade-1']!)).toBeGreaterThan(luminance(DARK['--map-land']!));
    expect(contrast(LIGHT['--map-shade-5']!, LIGHT['--map-land']!)).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK['--map-shade-5']!, DARK['--map-land']!)).toBeGreaterThanOrEqual(3);
  });

  it('names meet WCAG AA (4.5:1) on the land, the sea and their outline, in both themes', () => {
    for (const ground of [LIGHT['--map-land']!, LIGHT['--map-ocean']!, LIGHT['--map-halo']!]) expect(contrast(LIGHT['--map-label']!, ground)).toBeGreaterThanOrEqual(4.5);
    for (const ground of [DARK['--map-land']!, DARK['--map-halo']!, ...DARK_SEAS]) expect(contrast(DARK['--map-label']!, ground)).toBeGreaterThanOrEqual(4.5);
    // The outline is what a name sits on over a shaded country: dark on light, light on dark, well past AA.
    expect(contrast(LIGHT['--map-label']!, LIGHT['--map-halo']!)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK['--map-label']!, DARK['--map-halo']!)).toBeGreaterThanOrEqual(7);
  });

  it('dots, their counts and the dashed ring meet 3:1 (and counts AA) against what they sit on, in both themes and on the wall', () => {
    for (const look of [LIGHT, DARK, WALL]) {
      // Each state's arc sits between the marker's disc and its rim, both the halo's colour.
      for (const s of STATES) expect(contrast(look[s]!, look['--map-halo']!)).toBeGreaterThanOrEqual(3);
      // The count is in the disc.
      expect(contrast(look['--map-label']!, look['--map-halo']!)).toBeGreaterThanOrEqual(4.5);
      // A country-only place's dashes, on the halo laid under them and on the bare land round it.
      expect(contrast(look['--map-approx']!, look['--map-halo']!)).toBeGreaterThanOrEqual(3);
      expect(contrast(look['--map-approx']!, look['--map-land']!)).toBeGreaterThanOrEqual(3);
    }
  });
});

/* ---------------------------------------------------------------- the map as drawn */

/** Three cities in a row at world scale, 36 px apart: their markers clear of each other, the middle one's name with no room. */
const STEP = (36 * (WORLD_BOX.w / 732) * 360) / 1000;
const ROW = [
  V({ id: 1, country: 'Nigeria', city: 'Lagos', lat: 9, lng: 0 }), V({ id: 2, country: 'Nigeria', city: 'Lagos', lat: 9, lng: 0 }), V({ id: 3, country: 'Nigeria', city: 'Lagos', lat: 9, lng: 0 }),
  V({ id: 4, country: 'Chad', city: 'Kano', lat: 9, lng: STEP }),
  V({ id: 5, country: 'Sudan', city: 'Abuja', lat: 9, lng: 2 * STEP }), V({ id: 6, country: 'Sudan', city: 'Abuja', lat: 9, lng: 2 * STEP }),
];
/** Colombo, Kandy and Galle (one marker at world scale), a country-only visitor, and London. */
const SRI_LANKA = [
  V({ id: 1, chat: chat({ awaiting: true, waiting_since: stamp(98) }) }),
  V({ id: 2, city: 'Kandy', lat: 7.3, lng: 80.6, chat: chat({ agent: 'Nuwan' }) }),
  V({ id: 3, city: 'Galle', lat: 6.0, lng: 80.2 }),
  V({ id: 4, city: null, lat: null, lng: null, geo_source: 'timezone' }),
  V({ id: 5, country: 'United Kingdom', city: 'London', lat: 51.5, lng: -0.1 }),
];
const svgOf = (c: HTMLElement) => c.querySelector('svg')!;
const labelsOf = (c: HTMLElement) => [...c.querySelectorAll('[data-label]')].map((t) => t.textContent);

describe('the map as drawn', () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
  });

  it('fills every country, border, marker and name from the theme’s variables, never a fixed colour', () => {
    const { container } = render(<LiveMap places={placesNow(SRI_LANKA)} box={WORLD_BOX} />);
    const svg = svgOf(container);
    expect(svg.parentElement!.className).toContain('bg-[var(--map-ocean)]');
    for (const el of svg.querySelectorAll('*')) {
      expect(el.getAttribute('fill') ?? 'none').toBe('none');
      expect(el.getAttribute('stroke')).toBeNull();
    }
    const lk = svg.querySelector('[data-country="LK"]')!;
    const gb = svg.querySelector('[data-country="GB"]')!;
    const fr = svg.querySelector('[data-country="FR"]')!;
    expect(lk.getAttribute('class')).toContain('fill-[var(--map-shade-5)]');
    expect(gb.getAttribute('class')).toContain('fill-[var(--map-shade-1)]');
    expect(fr.getAttribute('class')).toContain('fill-[var(--map-land)]');
    expect(fr.getAttribute('class')).toContain('stroke-[var(--map-border)]');
    // A hairline: 0.5 px at this zoom.
    expect(Number(fr.getAttribute('stroke-width'))).toBeCloseTo(0.5 * (1000 / 732), 5);
    // A marker: the halo it sits in, its states' arcs, its count in the theme's ink.
    const colombo = svg.querySelector('[data-place^="Sri Lanka|Colombo"]')!;
    expect(colombo.querySelector('[data-halo]')!.getAttribute('class')).toBe('fill-[var(--map-halo)]');
    expect([...colombo.querySelectorAll('[data-arc]')].map((a) => a.getAttribute('class'))).toEqual(['stroke-[var(--map-waiting)]', 'stroke-[var(--map-chatting)]', 'stroke-[var(--map-browsing)]']);
    expect(colombo.querySelector('text')!.getAttribute('class')).toBe('fill-[var(--map-label)]');
    for (const t of svg.querySelectorAll('[data-label]')) expect(t.getAttribute('class')).toBe('fill-[var(--map-label)] stroke-[var(--map-halo)]');
  });

  it('changes nothing in the drawing when the theme changes: the variables repaint it at once', () => {
    const places = placesNow(SRI_LANKA);
    const view = render(<LiveMap places={places} box={WORLD_BOX} />);
    const before = view.container.innerHTML;
    document.documentElement.dataset.theme = 'dark';
    view.rerender(<LiveMap places={places} box={WORLD_BOX} />);
    expect(view.container.innerHTML).toBe(before);
  });

  it('keeps the dashed ring for a country-only place, over the halo so it shows on dark land', () => {
    const { container } = render(<LiveMap places={placesNow(SRI_LANKA)} box={WORLD_BOX} />);
    const ring = svgOf(container).querySelector('[data-place="Sri Lanka|≈"]')!;
    const [under, dashes] = [...ring.querySelectorAll('circle')];
    expect(under!.getAttribute('class')).toBe('fill-[var(--map-halo)] stroke-[var(--map-halo)]');
    expect(dashes!.hasAttribute('data-approx')).toBe(true);
    expect(dashes!.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(dashes!.getAttribute('class')).toBe('stroke-[var(--map-approx)]');
    expect(Number(under!.getAttribute('stroke-width'))).toBeGreaterThan(Number(dashes!.getAttribute('stroke-width')));
    expect(ring.querySelector('text')!.textContent).toBe('1');
  });

  it('names places by name only, the count in the disc, the country not named twice', () => {
    const { container } = render(<LiveMap places={placesNow(SRI_LANKA)} box={WORLD_BOX} />);
    // At world scale Sri Lanka's three are one marker named for the country; its country-only ring is not named again.
    expect(labelsOf(container).sort()).toEqual(['London', 'Sri Lanka']);
    expect(svgOf(container).querySelector('[data-place^="Sri Lanka|Colombo"] text')!.textContent).toBe('3');
  });

  it('leaves off the quieter of two names that would collide, and shows it on hover or zoom', () => {
    const places = placesNow(ROW);
    const view = render(<LiveMap places={places} box={WORLD_BOX} />);
    const svg = svgOf(view.container);
    expect(svg.querySelectorAll('[data-place]')).toHaveLength(3);
    expect(labelsOf(view.container).sort()).toEqual(['Abuja', 'Lagos']);
    const kano = svg.querySelector('[data-place^="Chad|Kano"]')!;
    fireEvent.pointerEnter(kano);
    expect(svg.querySelector('[data-hover]')?.textContent).toBe('Kano');
    fireEvent.pointerLeave(kano);
    expect(svg.querySelector('[data-hover]')).toBeNull();
    // Closer in there is room for all three.
    view.rerender(<LiveMap places={places} box={{ x: px(-8), y: py(16), w: 160, h: 64 }} />);
    expect(labelsOf(view.container).sort()).toEqual(['Abuja', 'Kano', 'Lagos']);
  });

  it('the label placer: busiest first, never overlapping, nothing outside the view, a hover label for any place', () => {
    const places = placesNow(ROW);
    const u = 1000 / 732;
    const all = () => true;
    const named = placeLabels(places, { x: 0, y: -31, w: 1000, h: 546 }, u, all);
    expect([...named.values()].map((l) => l.text).sort()).toEqual(['Abuja', 'Lagos']);
    // The busiest goes left of its marker, as its right is taken by its neighbour's.
    expect(named.get(places.find((p) => p.city === 'Lagos')!.key)!.anchor).toBe('end');
    expect(placeLabels(places, { x: 0, y: -31, w: 1000, h: 546 }, u, (p) => p.city !== 'Abuja').size).toBe(1);
    const kano = places.find((p) => p.city === 'Kano')!;
    expect(hoverLabel(kano, { x: 0, y: -31, w: 1000, h: 546 }, u)).toMatchObject({ text: 'Kano', anchor: 'start' });
    // Closer in, the wall's larger names fit too.
    const wall = placeLabels(places, { x: 0, y: -31, w: 1000, h: 546 }, u / 3, all, { font: 14, k: 1.2 });
    expect(wall.size).toBe(3);
    // A name already on the map is not put there again, however much room there is.
    const twice = placesNow([V({ id: 1, country: 'Sri Lanka', city: null, lat: null, lng: null }), V({ id: 2, country: 'Sri Lanka', city: null, lat: 51.5, lng: -0.1 }), V({ id: 3, country: 'Sri Lanka', city: null, lat: 51.5, lng: -0.1 })]);
    expect([...placeLabels(twice, { x: 0, y: -31, w: 1000, h: 546 }, u, all).entries()].map(([key, l]) => [key, l.text])).toEqual([['Sri Lanka||51.5|-0.1', 'Sri Lanka']]);
  });

  it('shades by rank: five steps from the fewest to the most, one count alone the top step', () => {
    const p = (country: string, count: number) => ({ country, count }) as Place;
    expect(Object.fromEntries(shadeSteps([p('Sri Lanka', 9), p('India', 3), p('United Kingdom', 1), p('United Arab Emirates', 1)]))).toEqual({ LK: 5, IN: 3, GB: 1, AE: 1 });
    expect(Object.fromEntries(shadeSteps([p('Sri Lanka', 2), p('Sri Lanka', 2)]))).toEqual({ LK: 5 });
    expect([...shadeSteps(['LK', 'IN', 'GB', 'FR', 'DE'].map((c, i) => p(c, i + 1))).values()]).toEqual([1, 2, 3, 4, 5]);
    expect(SHADE).toHaveLength(5);
  });

  it('on the wall, larger markers and names', () => {
    const places = placesNow(SRI_LANKA);
    const plain = render(<LiveMap places={places} box={WORLD_BOX} />);
    const size = (c: HTMLElement) => Number(c.querySelector('[data-label]')!.getAttribute('font-size'));
    const arc = (c: HTMLElement) => Number(c.querySelector('[data-arc]')!.getAttribute('stroke-width'));
    const [font, width] = [size(plain.container), arc(plain.container)];
    cleanup();
    const wall = render(<LiveMap places={places} box={WORLD_BOX} wall />);
    expect(size(wall.container)).toBeGreaterThan(font);
    expect(arc(wall.container)).toBeGreaterThan(width);
  });

  it('the legend draws the states and shapes in the map’s own colours', () => {
    render(<MapLegend />);
    const swatches = within(screen.getByRole('list', { name: 'Map legend' })).getAllByRole('listitem').map((i) => i.querySelector('span')!.className);
    expect(swatches.slice(0, 5).map((c) => /border-\[var\((--map-[a-z-]+)\)\]/.exec(c)?.[1])).toEqual(STATES);
    expect(swatches[6]).toContain('border-dashed');
    expect(swatches[6]).toContain('border-[var(--map-approx)]');
    for (const c of swatches) expect(c).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});

/* ---------------------------------------------------------------- the longest wait */

describe('the longest wait', () => {
  const now = Date.now();
  const d = (o: Partial<Dashboard['now']> = {}): Pick<Dashboard, 'now'> => ({
    now: { visitors_online: 5, open: 9, pending: 0, waiting_on_us: 8, at_risk: 0, window_seconds: 300, longest_wait_since: stamp(532 * 3600 + 52), ...o },
  });

  it('reads in days past one, hours and minutes past an hour, else m:ss', () => {
    expect(waitWords(59)).toBe('0:59');
    expect(waitWords(192)).toBe('3:12');
    expect(waitWords(3600)).toBe('1 h 0 min');
    expect(waitWords(2 * 3600 + 5 * 60 + 9)).toBe('2 h 5 min');
    expect(waitWords(86_400)).toBe('1 day');
    expect(waitWords(532 * 3600 + 52)).toBe('22 days');
  });

  it('counts only chats somebody is waiting in now: not closed or ended ones, nor a visitor gone quiet past the window', () => {
    const here = [
      V({ id: 1, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(192) }) }),
      V({ id: 2, conversation_status: 'closed', chat: chat({ awaiting: true, waiting_since: stamp(40 * 86_400) }) }),
      V({ id: 3, conversation_status: 'ended', chat: chat({ awaiting: true, waiting_since: stamp(9 * 86_400) }) }),
      V({ id: 4, conversation_status: 'open', idle_seconds: 301, chat: chat({ awaiting: true, waiting_since: stamp(5 * 86_400) }) }),
      V({ id: 5, conversation_status: 'open', chat: chat({ agent: 'Nuwan', waiting_since: stamp(3 * 86_400) }) }),
      V({ id: 6, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(98) }) }),
    ];
    expect(longestWait(d(), here, now)).toBeCloseTo(192, -1);
    // Nobody here waiting: no "longest", whatever chats the server still counts as open.
    expect(longestWait(d(), here.slice(1, 5), now)).toBeNull();
    // Before the visitor list is known, the server's figure stands in.
    expect(longestWait(d(), null, now)).toBeCloseTo(532 * 3600 + 52, -1);
    expect(longestWait(d({ waiting_on_us: 0 }), here, now)).toBeNull();
  });
});

/* ---------------------------------------------------------------- on the dashboard */

const VISITORS = [
  V({ id: 1, name: 'Anne', city: 'Kandy', lat: 7.3, lng: 80.6, conversation_id: 11, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(192), at_risk: true }) }),
  V({ id: 2, conversation_id: 12, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(98) }) }),
  V({ id: 3, label: 'Visitor 2C88', city: null, lat: null, lng: null, geo_source: 'timezone' }),
  V({ id: 4, label: 'Visitor 51EF', country: 'United Kingdom', city: 'London', lat: 51.5, lng: -0.1 }),
];
const DASH = {
  // Eight still open on the server, the oldest from a visitor who left 22 days ago and was never closed.
  now: { visitors_online: 4, open: 9, pending: 0, waiting_on_us: 8, at_risk: 1, arrived_10m: 1, longest_wait_since: stamp(532 * 3600 + 52), staff_in_chats: 2, on_call: { count: 0, since: null }, at_risk_after: 180, window_seconds: 300 },
  today: { visitors: 40, returning: 6, conversations: 9, page_views: 230, missed: 1, missed_last_hour: 0, first_response_median: 42 },
  activity: [],
  summary: { pages: [], countries: [{ name: 'Sri Lanka', count: 30 }], devices: [], referrers: [], places: [{ country: 'Sri Lanka', city: 'Colombo', lat: 6.9, lng: 79.9, count: 30 }] },
  widgets: [{ id: 1, name: 'techubiz.com', status: 'active', open_now: true, online: 4 }],
  server_time: stamp(0),
};

describe('on the dashboard', () => {
  let client: QueryClient;
  const props = { onSelect: vi.fn(), onOpenChat: vi.fn(), onSection: vi.fn() };
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <WebsiteLive view="dashboard" selected={null} {...props} />
      </QueryClientProvider>,
    );
  const ready = () => screen.findByRole('listitem', { name: /^On the site now: 4/ });
  const map = () => screen.getByRole('region', { name: 'Where they are' });

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/chat/widget-admin/visitors') return { visitors: VISITORS };
      if (path === '/api/chat/widget-admin/dashboard') return DASH;
      throw new Error(`unexpected ${path}`);
    }) as never);
  });
  afterEach(() => {
    cleanup();
    app.set({ resolvedTheme: 'light' });
  });

  it('says “longest” for the chats waiting now, not one left open for 22 days', async () => {
    mount();
    await ready();
    const waiting = screen.getByRole('listitem', { name: /^Waiting on us: 8/ });
    await screen.findByRole('group', { name: 'Needs you' });
    expect(waiting.textContent).toMatch(/longest 3:1\d/);
    expect(waiting.textContent).not.toMatch(/532|days/);
  });

  it('says “darker = more” on light and “brighter = more” on dark, switching with the theme', async () => {
    mount();
    await ready();
    expect(within(map()).getByText('Shaded by visitors now · darker = more')).toBeTruthy();
    act(() => app.set({ resolvedTheme: 'dark' }));
    expect(within(map()).getByText('Shaded by visitors now · brighter = more')).toBeTruthy();
    fireEvent.click(within(map()).getByRole('radio', { name: 'Today' }));
    expect(within(map()).getByText('Shaded by visitors today · brighter = more')).toBeTruthy();
    act(() => app.set({ resolvedTheme: 'light' }));
    expect(within(map()).getByText('Shaded by visitors today · darker = more')).toBeTruthy();
  });

  it('Wall mode draws its map and legend in the dark theme’s colours, its dots brighter and names larger', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Wall mode' }));
    const wall = screen.getByRole('dialog', { name: 'Website chats — live, wall mode' });
    expect(wall.getAttribute('data-theme')).toBe('dark');
    const frame = await within(wall).findByRole('img', { name: /^Map of visitors on the site now/ });
    expect(frame.closest('[data-map-wall]')).toBeTruthy();
    expect(within(wall).getByRole('list', { name: 'Map legend' }).closest('[data-map-wall]')).toBeTruthy();
    expect(Number(frame.querySelector('[data-label]')!.getAttribute('font-size'))).toBeCloseTo(14 * (1000 / 732), 5);
    expect(within(within(wall).getByRole('list', { name: 'Right now' })).getAllByRole('listitem')[1]!.textContent).toMatch(/longest 3:1\d/);
  });
});
