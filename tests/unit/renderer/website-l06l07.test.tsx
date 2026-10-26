// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { LiveDeskInfo, WebchatRingState } from '@shared/types';

/**
 * L-06 "Desktop — wall mode on a second display" (WS-WCHAT MAP-UI-06; MAP-16, MAP-24, WF-M3) and L-07 "Insights
 * (reports)" (X-UI-13; UX-INS-01…03, RPT-04, RING-13, TEAM-81, VOICE-23), in the design's words.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
const listeners = new Map<string, (p: unknown) => void>();
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (channel: string, cb: (p: unknown) => void) => {
    listeners.set(channel, cb);
    return () => listeners.delete(channel);
  },
  errorMessage: (e: unknown) => String(e),
  isMac: true,
  hasDesktop: () => true,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));

import { apiGet } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import { cycleWords, WallSheet, WallSheetWindow } from '../../../src/modules/chat/website/live/WallSheet';
import { WallWindow } from '../../../src/modules/chat/website/live/LiveMapWindow';
import { NO_LIVE_PARAMS, WALL_CYCLE_MS } from '../../../src/modules/chat/website/live/LiveDashboard';
import { RingTrayWindow } from '../../../src/modules/chat/website/RingTray';
import { WebsiteLive } from '../../../src/modules/chat/website/WebsiteLive';
import { conversationsChange, minutes, timeChange, WebsiteInsights, type Insights } from '../../../src/modules/chat/website/Insights';
import type { Dashboard } from '../../../src/modules/chat/website/live/liveMap';

const stamp = (agoS: number) => new Date(Date.now() - agoS * 1000).toISOString().slice(0, 19).replace('T', ' ');
const DASH: Dashboard = {
  now: { visitors_online: 18, open: 3, pending: 1, waiting_on_us: 2, at_risk: 1, arrived_10m: 3, longest_wait_since: stamp(192), staff_in_chats: 3, on_call: { count: 1, since: stamp(134) }, at_risk_after: 180, window_seconds: 300 },
  today: { visitors: 140, returning: 26, conversations: 19, page_views: 830, missed: 1, missed_last_hour: 0, first_response_median: 42 },
  activity: [],
  summary: { pages: [], countries: [{ name: 'Sri Lanka', count: 90 }], devices: [], referrers: [], places: [] },
  widgets: [{ id: 1, name: 'techubiz.com', status: 'active', open_now: true, online: 18 }],
  home_country: 'Sri Lanka',
  server_time: stamp(0),
};
const INFO: LiveDeskInfo = {
  wall: { display: 'Display 2', name: 'LG UltraFine 27″' },
  displays: [
    { id: 1, display: 'Display 1', detail: 'Built-in · this window' },
    { id: 7, display: 'Display 2', detail: 'LG UltraFine 27″' },
  ],
  wallPrefs: { displayId: 7, keepAwake: true, cycle: true, openAtStart: false },
  wallOpen: false,
  wallGone: null,
  silencedUntil: null,
  shortcuts: true,
};
const INSIGHTS: Insights = {
  period: '30d', since: '2026-09-05 00:00:00', until: '2026-10-04 12:00:00', widget_id: null,
  widgets: [{ id: 2, name: 'techhub.com.lk' }, { id: 1, name: 'techubiz.com' }],
  conversations: { value: 412, previous: 349 },
  first_response: { value: 51, previous: 63 },
  resolution: { value: 660, previous: 650 },
  rating: { value: 4.7, rated: 96, previous: 4.6 },
  missed: { value: 17, share: 4.1, previous: 20 },
  visitors: { value: 6380, returning: 1978, returning_share: 31 },
  days: [
    { date: '2026-09-20', answered: 48, missed: 2 },
    { date: '2026-09-27', answered: 60, missed: 4 },
    { date: '2026-10-03', answered: 18, missed: 1 },
  ],
  sources: [{ name: 'google.com', count: 3062, share: 48 }, { name: 'Direct', count: 1723, share: 27 }, { name: 'facebook.com', count: 957, share: 15 }, { name: 'Other', count: 638, share: 10 }],
  devices: [{ name: 'desktop', count: 3700, share: 58 }, { name: 'mobile', count: 2297, share: 36 }, { name: 'tablet', count: 383, share: 6 }],
  agents: [
    { id: 3, name: 'Nuwan Silva', handled: 168, first_response_seconds: 42, rating: 4.8, missed_while_online: 2 },
    { id: 7, name: 'Dilini Perera', handled: 139, first_response_seconds: 55, rating: 4.7, missed_while_online: 3 },
    { id: 8, name: 'Kasun Jayasinghe', handled: 88, first_response_seconds: 64, rating: 4.5, missed_while_online: 5 },
  ],
  join_median_seconds: 18,
  team: { installed: true, multi_staff_chats: 6, agents: [{ transfers_in: 3, transfers_out: 1 }, { transfers_in: 1, transfers_out: 3 }] },
  calls: { installed: true, requested: 14, answered: 12 },
};

let info: LiveDeskInfo = INFO;
function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/visitors') return { visitors: [] };
    if (path === '/api/chat/widget-admin/dashboard') return DASH;
    // The first view in one answer (#248).
    if (path === '/api/chat/widget-admin/dashboard/summary') return { now: DASH.now, today: DASH.today, visitors: [], visitors_total: 0, widgets: DASH.widgets, server_time: DASH.server_time };
    if (path === '/api/chat/widget-admin/conversations') return { conversations: [], can: {} };
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (path === '/api/chat/widget-admin/insights') return INSIGHTS;
    if (path === '/api/chat/presence/me') return { status: 'online', choice: 'available' };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(call).mockImplementation((async (channel: string) => {
    if (channel === 'live:info') return info;
    if (channel === 'ring:state') return { chats: [], tone: 'normal', volume: 80, outcome: null, hidden: false, shortcut: true } satisfies WebchatRingState;
    return null;
  }) as never);
}

let client: QueryClient;
const show = (ui: ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  info = INFO;
  listeners.clear();
  vi.mocked(call).mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(toast).mockReset();
  app.set({ apps: [{ id: 'chat' }] as never });
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('L-06 · the Wall mode sheet (MAP-UI-06, MAP-24)', () => {
  it('confirms the display and how, in the design’s words', async () => {
    show(<WallSheetWindow />);
    const sheet = await screen.findByRole('region', { name: 'Wall mode' });
    await within(sheet).findByRole('radiogroup');
    expect(within(sheet).getByText('Wall mode')).toBeTruthy();
    expect(within(sheet).getByText('SHOW ON')).toBeTruthy();
    const screens = within(sheet).getAllByRole('radio');
    expect(screens.map((r) => r.textContent)).toEqual(['Display 1Built-in · this window', 'Display 2 ✓LG UltraFine 27″']);
    expect(screens.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);

    const names = within(sheet).getByRole('checkbox', { name: /Hide visitor names and messages/ }) as HTMLInputElement;
    // Names stay hidden on the wall: locked on.
    expect([names.checked, names.disabled]).toEqual([true, true]);
    expect(within(sheet).getByText('🔒 always')).toBeTruthy();
    expect(within(sheet).getByText('Places and events only.')).toBeTruthy();
    expect((within(sheet).getByRole('checkbox', { name: 'Keep the display awake' }) as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByRole('checkbox', { name: /Cycle map views every 60 s/ }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(within(sheet).getByText('World → Asia → Sri Lanka')).toBeTruthy());
    expect((within(sheet).getByRole('checkbox', { name: /Open wall mode when WorkSuite starts/ }) as HTMLInputElement).checked).toBe(false);
    expect(within(sheet).getByText('For a dedicated support-room screen.')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Open on Display 2' })).toBeTruthy();
  });

  it('opens on the screen picked with the choices made, and Cancel or Esc closes it', async () => {
    const onCancel = vi.fn();
    show(<WallSheet info={INFO} home="Sri Lanka" onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('radio', { name: /Display 1/ }));
    expect(screen.getByRole('radio', { name: /Display 1 ✓/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep the display awake' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Open wall mode when WorkSuite starts/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open on Display 1' }));
    expect(call).toHaveBeenCalledWith('live:wall', { displayId: 1, keepAwake: false, cycle: true, openAtStart: true });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('says the views it cycles through for the home country', () => {
    expect(cycleWords('Sri Lanka')).toBe('World → Asia → Sri Lanka');
    expect(cycleWords(null)).toBe('World → region → home country');
  });

  it('the dashboard’s Wall mode asks first on this computer (WF-M3)', async () => {
    show(<WebsiteLive view="dashboard" selected={null} onSelect={vi.fn()} onOpenChat={vi.fn()} onSection={vi.fn()} live={NO_LIVE_PARAMS} onLive={vi.fn()} />);
    await screen.findByRole('listitem', { name: /^On the site now: \d+ —/ });
    await waitFor(() => expect(call).toHaveBeenCalledWith('live:info'));
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Wall mode' }));
    expect(call).toHaveBeenCalledWith('live:open', { to: 'wallSheet' });
    expect(screen.queryByRole('dialog', { name: 'Website chats — live, wall mode' })).toBeNull();
  });
});

/** The map's own viewBox: the wall also draws the brand logo as an SVG, so find the one holding the countries. */
const mapView = (wall: HTMLElement) => wall.querySelector('[data-country]')?.closest('svg')?.getAttribute('viewBox');

describe('L-06 · the wall on its display (MAP-16, MAP-24)', () => {
  it('cycles the map World → Asia → Sri Lanka every 60 s when the sheet says so', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    show(<WallWindow />);
    const wall = await screen.findByRole('dialog', { name: 'Website chats — live, wall mode' });
    const view = () => mapView(wall);
    await waitFor(() => expect(call).toHaveBeenCalledWith('live:info'));
    // The map's code loads on demand (#248).
    await waitFor(() => expect(view()).toBeTruthy());
    const world = view();
    expect(world).toMatch(/^0 /);
    await act(async () => void vi.advanceTimersByTime(WALL_CYCLE_MS));
    const asia = view();
    expect(asia).not.toBe(world);
    await act(async () => void vi.advanceTimersByTime(WALL_CYCLE_MS));
    expect(view()).not.toBe(asia);
    await act(async () => void vi.advanceTimersByTime(WALL_CYCLE_MS));
    expect(view()).toBe(world);
  });

  it('stays on the world when cycling is off', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    info = { ...INFO, wallPrefs: { ...INFO.wallPrefs!, cycle: false } };
    show(<WallWindow />);
    const wall = await screen.findByRole('dialog', { name: 'Website chats — live, wall mode' });
    await waitFor(() => expect(call).toHaveBeenCalledWith('live:info'));
    await waitFor(() => expect(mapView(wall)).toBeTruthy());
    const world = mapView(wall);
    expect(world).toMatch(/^0 /);
    await act(async () => void vi.advanceTimersByTime(WALL_CYCLE_MS));
    expect(mapView(wall)).toBe(world);
  });
});

describe('L-06 · the tray closes the wall and says when its display went (MAP-24)', () => {
  const tray = async () => {
    window.location.hash = '#/window/ring-tray?live=1';
    show(<RingTrayWindow />);
    return screen.findByRole('region', { name: 'WorkSuite tray — live dashboard' });
  };

  it('offers Close wall mode while the wall is up', async () => {
    info = { ...INFO, wallOpen: true };
    const t = await tray();
    const close = await within(t).findByRole('button', { name: /Close wall mode/ });
    fireEvent.click(close);
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'wall' });
  });

  it('says the wall closed when its display was unplugged', async () => {
    info = { ...INFO, wallGone: new Date().toISOString() };
    const t = await tray();
    expect((await within(t).findByRole('status')).textContent).toBe('Wall mode closed — its display was disconnected.');
    expect(within(t).getByRole('button', { name: /Wall mode on Display 2/ })).toBeTruthy();
  });
});

describe('L-07 · Insights (X-UI-13; UX-INS-01…03)', () => {
  it('shows the six figures with their change, the chart, sources, devices and agents, in the design’s words', async () => {
    show(<WebsiteInsights period="30d" widget={null} onChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeTruthy();
    expect(screen.getByText('How website chat is doing across all your widgets.')).toBeTruthy();
    const tiles = within(await screen.findByRole('list', { name: 'Figures' })).getAllByRole('listitem');
    expect(tiles.map((t) => t.textContent)).toEqual([
      'Conversations412+18% vs previous',
      'Avg first response0:51−12 s',
      'Avg resolution11 minsame',
      'Avg rating4.7from 96 rated',
      'Missed174.1% of chats',
      'Visitors6,38031% returning',
    ]);
    // Better is green; Missed is the red tile.
    expect(within(tiles[0]!).getByText('+18% vs previous').className).toContain('text-[#2b7a4b]');
    expect(within(tiles[1]!).getByText('−12 s').className).toContain('text-[#2b7a4b]');
    expect(tiles[4]!.getAttribute('data-tone')).toBe('red');
    expect(within(tiles[4]!).getByText('4.1% of chats').className).toContain('text-[#a63224]');

    const chart = screen.getByRole('region', { name: 'Conversations per day' });
    expect(within(chart).getByText('Answered')).toBeTruthy();
    expect(within(chart).getByText('Missed')).toBeTruthy();
    expect(within(chart).getAllByRole('listitem', { name: /answered/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      '20 Sep: 48 answered, 2 missed', '27 Sep: 60 answered, 4 missed', '3 Oct: 18 answered, 1 missed',
    ]);
    expect(within(chart).getByText('20 Sep')).toBeTruthy();
    expect(within(chart).getByText('3 Oct')).toBeTruthy();

    const side = screen.getByRole('region', { name: 'Traffic sources' });
    expect(within(within(side).getByRole('list', { name: 'Traffic sources' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['google.com48%', 'Direct27%', 'facebook.com15%', 'Other10%']);
    expect(within(side).getByRole('heading', { name: 'Devices' })).toBeTruthy();
    expect(within(within(side).getByRole('list', { name: 'Devices' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['Desktop 58%', 'Mobile 36%', 'Tablet 6%']);

    const rows = within(screen.getByRole('table', { name: 'Agents' })).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'AgentHandledFirst responseRatingMissed while online',
      'Nuwan Silva1680:424.82',
      'Dilini Perera1390:554.73',
      'Kasun Jayasinghe881:044.55',
    ]);
    expect(screen.getByText(/Median time to join 0:18 · 4 transfers · 6 chats with more than one of the team · 12 of 14 calls answered — per agent in the CSV\./)).toBeTruthy();
  });

  it('changes period and widget, and exports the CSV (UX-INS-02, RPT-04)', async () => {
    const onChange = vi.fn();
    show(<WebsiteInsights period="30d" widget={null} onChange={onChange} />);
    await screen.findByRole('list', { name: 'Figures' });
    const period = screen.getByRole('radiogroup', { name: 'Period' });
    expect(within(period).getAllByRole('radio').map((r) => `${r.textContent}:${r.getAttribute('aria-checked')}`)).toEqual(['7 days:false', '30 days:true', 'All time:false']);
    fireEvent.click(within(period).getByRole('radio', { name: '7 days' }));
    expect(onChange).toHaveBeenCalledWith({ period: '7d', widget: null });
    expect(screen.getByRole('combobox', { name: 'Widget' }).textContent).toContain('All widgets');

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(call).toHaveBeenCalledWith('transfers:download', expect.objectContaining({ websiteInsights: { period: '30d' }, open: false }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Exporting — see Transfers.'));
  });

  it('asks the server for the period and the widget', async () => {
    show(<WebsiteInsights period="all" widget={1} onChange={vi.fn()} />);
    await screen.findByRole('list', { name: 'Figures' });
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/insights', { period: 'all', widget_id: 1 }, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(call).toHaveBeenCalledWith('transfers:download', expect.objectContaining({ websiteInsights: { period: 'all', widget: 1 } }));
  });

  it('words a change as the design does', () => {
    expect(conversationsChange(412, 349)).toEqual({ sub: '+18% vs previous', tone: 'good' });
    expect(conversationsChange(300, 400)).toEqual({ sub: '−25% vs previous', tone: 'plain' });
    expect(conversationsChange(10, null)).toEqual({ tone: 'plain' });
    expect(timeChange(51, 63, 's')).toEqual({ sub: '−12 s', tone: 'good' });
    expect(timeChange(130, 51, 's')).toEqual({ sub: '+1 min', tone: 'bad' });
    expect(timeChange(660, 650, 'min')).toEqual({ sub: 'same', tone: 'plain' });
    expect(timeChange(null, 650, 'min')).toEqual({ tone: 'plain' });
    expect([minutes(45), minutes(660), minutes(4800)]).toEqual(['45 s', '11 min', '1 h 20 min']);
  });
});
