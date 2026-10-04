// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { LiveDeskInfo, WebchatRingChat, WebchatRingState } from '@shared/types';

/**
 * L-04 "Desktop — pop-out Live map window and notification" and L-05 "Desktop — tray mini-dashboard with reply and
 * join" (WS-WCHAT MAP-UI-04/05, X-UI-12; MAP-19, MAP-21, MAP-22, MAP-23, MAP-25, UX-ALR-03), in the design's words.
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

import { ApiError, apiGet } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { app } from '../../../src/core/app-state';
import { RingTrayWindow } from '../../../src/modules/chat/website/RingTray';
import { needsRows, yoursRows } from '../../../src/modules/chat/website/live/LiveDesk';
import { focusBox, LiveMapWindow, windowPresets } from '../../../src/modules/chat/website/live/LiveMapWindow';
import { NO_LIVE_PARAMS } from '../../../src/modules/chat/website/live/LiveDashboard';
import { px, py, type Dashboard } from '../../../src/modules/chat/website/live/liveMap';
import { WebsiteLive, type OnlineVisitor } from '../../../src/modules/chat/website/WebsiteLive';

const stamp = (agoS: number) => new Date(Date.now() - agoS * 1000).toISOString().slice(0, 19).replace('T', ' ');
const V = (o: Partial<OnlineVisitor>): OnlineVisitor => ({
  id: 1, label: 'Visitor 4F2A', name: null, email: null, widget_id: 1, website_name: 'techubiz.com', browser: 'Chrome', os: 'Windows', device: 'desktop',
  country: 'Sri Lanka', city: 'Colombo', region: 'Western Province', geo_source: 'geoip', lat: 6.9, lng: 79.9, current_url: 'https://techubiz.com/shop/adobe-creative-cloud', current_title: null, referrer: null,
  utm_campaign: null, pages: 2, visits: 1, on_site_seconds: 240, idle_seconds: 5, conversation_id: null, conversation_status: null, chat: null, ...o,
});
const chat = (o: Partial<NonNullable<OnlineVisitor['chat']>>) => ({ awaiting: false, waiting_since: null, at_risk: false, agent: null, agent_typing: false, call: null, mine: false, ...o });
const VISITORS = [
  V({ id: 2, conversation_id: 12, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(98) }) }),
  V({ id: 1, name: 'Anne · Acme Ltd', city: 'Kandy', lat: 7.3, lng: 80.6, current_url: 'https://techubiz.com/support/activation', conversation_id: 11, conversation_status: 'open', chat: chat({ awaiting: true, waiting_since: stamp(192), at_risk: true }) }),
  V({ id: 3, label: 'Visitor 9C1E', city: 'Galle', lat: 6.0, lng: 80.2, conversation_id: 13, conversation_status: 'open', chat: chat({ agent: 'Kavindu Perera', mine: true, call: { status: 'active', since: stamp(134) } }) }),
  V({ id: 4, name: 'Kasun P.', conversation_id: 14, conversation_status: 'open', chat: chat({ agent: 'Nuwan' }) }),
  V({ id: 6, label: 'Visitor 7A3D', visits: 3, current_url: 'https://techubiz.com/shop/microsoft-365' }),
];
const DASH: Dashboard = {
  now: { visitors_online: 18, open: 3, pending: 1, waiting_on_us: 2, at_risk: 1, arrived_10m: 3, longest_wait_since: stamp(192), staff_in_chats: 3, on_call: { count: 1, since: stamp(134) }, at_risk_after: 180, window_seconds: 300 },
  today: { visitors: 140, returning: 26, conversations: 19, page_views: 830, missed: 1, missed_last_hour: 0, first_response_median: 42 },
  activity: [],
  summary: { pages: [], countries: [{ name: 'Sri Lanka', count: 90 }], devices: [], referrers: [], places: [] },
  widgets: [{ id: 1, name: 'techubiz.com', status: 'active', open_now: true, online: 18 }],
  home_country: 'Sri Lanka',
  server_time: stamp(0),
};
const INFO: LiveDeskInfo = { wall: { display: 'Display 2', name: 'LG 27″' }, silencedUntil: null, shortcuts: true };
const ringChat = (o: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 11, visitor: 'Anne · Acme Ltd', site: 'techubiz.com', page: '/support/activation', place: 'Kandy, LK', device: null, returning: false, preview: 'My activation key says invalid on the second laptop',
  priority: 'normal', offline: false, since: stamp(192), stage: 'everyone', atRisk: true, mine: false, by: null, silenced: false, ...o,
});
const ring = (o: Partial<WebchatRingState> = {}): WebchatRingState => ({ chats: [ringChat({})], tone: 'normal', volume: 80, outcome: null, hidden: false, shortcut: true, ...o });

let dashboard: () => unknown = () => DASH;
function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/visitors') return { visitors: VISITORS };
    if (path === '/api/chat/widget-admin/dashboard') return dashboard();
    if (path === '/api/chat/widget-admin/conversations') return { conversations: [{ id: 12, last_message: { body: 'Is there a student price?' } }], can: {} };
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (path === '/api/chat/presence/me') return { status: 'online', choice: 'available' };
    if (/\/visitors\/\d+\/activity$/.test(path)) return { events: [], chats: [], contact: null, language: null, landing_page: null };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(call).mockImplementation((async (channel: string, input?: { value?: boolean }) => {
    if (channel === 'ring:state') return ring();
    if (channel === 'live:info') return INFO;
    if (channel === 'windows:setAlwaysOnTop') return input?.value ?? false;
    if (channel === 'ring:joinSend') return { ok: true, why: null };
    return null;
  }) as never);
}

let client: QueryClient;
const show = (ui: ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  dashboard = () => DASH;
  listeners.clear();
  vi.mocked(call).mockReset();
  vi.mocked(apiGet).mockReset();
  localStorage.clear();
  window.location.hash = '#/window/live-map';
  app.set({ apps: [{ id: 'chat' }] as never });
  serve();
});
afterEach(() => cleanup());

describe('L-04 · the main window is the web app’s Live dashboard (MAP-19), with Pop out (MAP-21)', () => {
  it('pops the map out into its own window, and my own call reads “· You”', async () => {
    show(<WebsiteLive view="dashboard" selected={null} onSelect={vi.fn()} onOpenChat={vi.fn()} onSection={vi.fn()} live={NO_LIVE_PARAMS} onLive={vi.fn()} />);
    await screen.findByRole('listitem', { name: /^On the site now: 18/ });
    expect(screen.getByRole('button', { name: 'Full map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wall mode' })).toBeTruthy();
    const pop = screen.getByRole('button', { name: 'Pop out' });
    expect(pop.getAttribute('title')).toBe('Open the Live map in its own window (⌘⇧M)');
    fireEvent.click(pop);
    expect(call).toHaveBeenCalledWith('live:open', { to: 'map' });
    const row = await screen.findByRole('listitem', { name: 'Visitor 9C1E' });
    await waitFor(() => expect(row.textContent).toMatch(/On a call 02:1\d · You/));
  });
});

describe('L-04 · the Live map window (MAP-UI-04, MAP-21, UX-ALR-03)', () => {
  it('draws the design: Live map · All sites, 📌 On top, Live, the four figures, the Asia preset, Needs you and the footer', async () => {
    show(<LiveMapWindow />);
    const win = await screen.findByRole('region', { name: 'Live map window' });
    const w = within(win);
    expect(w.getByText('Live map')).toBeTruthy();
    expect(w.getByText('· All sites')).toBeTruthy();
    expect(w.getByRole('button', { name: /On top/ }).textContent).toBe('📌 On top');
    await w.findByRole('listitem', { name: 'On site: 18' });
    expect(w.getAllByRole('listitem').filter((li) => /^(On site|Waiting|At risk|Chats): /.test(li.getAttribute('aria-label') ?? '')).map((li) => li.getAttribute('aria-label'))).toEqual(['On site: 18', 'Waiting: 2', 'At risk: 1', 'Chats: 4']);
    // World, the region and the home country by its code; the region first (MAP-UI-04 "Asia preset").
    const zooms = w.getByRole('group', { name: 'Zoom to' });
    expect(within(zooms).getAllByRole('button').map((b) => b.textContent)).toEqual(['World', 'Asia', 'LK']);
    expect(within(zooms).getByRole('button', { name: 'Asia' }).getAttribute('aria-pressed')).toBe('true');
    // No + and − over the window's map: the presets sit in their place.
    expect(w.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    // Who needs you, without a heading in the window (MAP-UI-04): the at-risk row first.
    expect(within(await w.findByRole('list', { name: 'Needs you' })).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Anne · Acme Ltd', 'Visitor 4F2A']);
    expect(w.getByText('Drag to another display · ⌘⇧M shows or hides')).toBeTruthy();
    fireEvent.click(w.getByRole('button', { name: 'Wall mode ↗' }));
    expect(call).toHaveBeenCalledWith('live:open', { to: 'wall' });
  });

  it('the at-risk row first, open with what Anne wrote and Send & join; the next with Reply and Join', async () => {
    show(<LiveMapWindow />);
    const anne = await screen.findByRole('listitem', { name: 'Anne · Acme Ltd' });
    expect(anne.textContent).toContain('Anne · Acme Ltd · Kandy');
    expect(anne.textContent).toMatch(/At risk 3:1\d · \/support\/activation/);
    expect(within(anne).getByText('"My activation key says invalid on the second laptop"')).toBeTruthy();
    expect(within(anne).queryByRole('button', { name: 'Reply' })).toBeNull();
    const next = screen.getByRole('listitem', { name: 'Visitor 4F2A' });
    expect(next.textContent).toMatch(/Visitor 4F2A · Colombo/);
    expect(next.textContent).toMatch(/Waiting 1:\d\d · \/shop\/adobe-creative-cloud/);
    expect(within(next).getByRole('button', { name: 'Reply' })).toBeTruthy();

    fireEvent.change(within(anne).getByLabelText('Reply to Anne · Acme Ltd'), { target: { value: 'Sorry Anne — I can move the licence for you now' } });
    const send = within(anne).getByRole('button', { name: 'Send and join' });
    expect(send.textContent).toBe('Send & join');
    fireEvent.click(send);
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 11, message: 'Sorry Anne — I can move the licence for you now', visitor: 'Anne · Acme Ltd' }));

    // Reply on the next row opens it, with what the inbox says they wrote last; Join joins it even though it is not ringing for me.
    fireEvent.click(within(next).getByRole('button', { name: 'Reply' }));
    expect(within(screen.getByRole('listitem', { name: 'Visitor 4F2A' })).getByText('"Is there a student price?"')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('listitem', { name: 'Visitor 4F2A' })).getByRole('button', { name: 'Join Visitor 4F2A' }));
    expect(call).toHaveBeenCalledWith('ring:join', { id: 12, visitor: 'Visitor 4F2A' });
  });

  it('pins on top and remembers it; ⌘⇧M hides it again; Show on map opens that visitor’s row', async () => {
    show(<LiveMapWindow />);
    await screen.findByRole('listitem', { name: 'Anne · Acme Ltd' });
    const pin = screen.getByRole('button', { name: /On top/ });
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pin);
    await waitFor(() => expect(pin.getAttribute('aria-pressed')).toBe('true'));
    expect(call).toHaveBeenCalledWith('windows:setAlwaysOnTop', { value: true });
    expect(localStorage.getItem('ws.liveMap.onTop')).toBe('1');

    fireEvent.keyDown(window, { key: 'M', metaKey: true, shiftKey: true });
    expect(call).toHaveBeenCalledWith('live:open', { to: 'toggleMap' });
    fireEvent.keyDown(window, { key: 'd', metaKey: true, shiftKey: true });
    expect(call).toHaveBeenCalledWith('live:open', { to: 'dashboard' });

    act(() => listeners.get('live:focus')?.({ conversationId: 12 }));
    await waitFor(() => expect(within(screen.getByRole('listitem', { name: 'Visitor 4F2A' })).getByLabelText('Reply to Visitor 4F2A')).toBeTruthy());
    // The map left its preset for the visitor's place.
    expect(within(screen.getByRole('group', { name: 'Zoom to' })).getByRole('button', { name: 'Asia' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('opens again pinned and on the preset it was left on', async () => {
    localStorage.setItem('ws.liveMap.onTop', '1');
    localStorage.setItem('ws.liveMap.preset', 'lk');
    show(<LiveMapWindow />);
    await screen.findByRole('listitem', { name: 'Anne · Acme Ltd' });
    expect(call).toHaveBeenCalledWith('windows:setAlwaysOnTop', { value: true });
    expect(within(screen.getByRole('group', { name: 'Zoom to' })).getByRole('button', { name: 'LK' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(screen.getByRole('group', { name: 'Zoom to' })).getByRole('button', { name: 'World' }));
    expect(localStorage.getItem('ws.liveMap.preset')).toBe('world');
  });
});

describe('L-05 · the tray mini-dashboard with reply and join (MAP-UI-05, X-UI-12, MAP-22, UX-ALR-03)', () => {
  it('draws the design: Website chats · Live · Online, ON SITE / WAITING / AT RISK / REPLY, a small map, NEEDS YOU · 2, YOURS · 1 and the menu', async () => {
    show(<RingTrayWindow />);
    const tray = await screen.findByRole('region', { name: 'WorkSuite tray — live dashboard' });
    const t = within(tray);
    expect(t.getByText('Website chats')).toBeTruthy();
    expect(t.getByText('Live')).toBeTruthy();
    await t.findByText('Online');
    expect(t.getAllByRole('listitem').filter((li) => /^(On site|Waiting|At risk|Reply): /.test(li.getAttribute('aria-label') ?? '')).map((li) => li.getAttribute('aria-label'))).toEqual(['On site: 18', 'Waiting: 2', 'At risk: 1', 'Reply: 0:42']);
    expect(t.getByRole('img', { name: /^Map of visitors on the site now/ })).toBeTruthy();
    await t.findByText('Needs you · 2');
    expect(t.getByText('Yours · 1')).toBeTruthy();
    const mine = t.getByRole('listitem', { name: 'Visitor 9C1E' });
    expect(mine.textContent).toMatch(/Visitor 9C1E · Galle/);
    expect(mine.textContent).toMatch(/On a call 02:1\d/);
    fireEvent.click(within(mine).getByRole('button', { name: 'Open Visitor 9C1E' }));
    expect(call).toHaveBeenCalledWith('live:open', { to: 'chat', id: 13 });

    const items = ['Open Live dashboard⌘⇧D', 'Show Live map window⌘⇧M', 'Wall mode on Display 2LG 27″ ›', 'Silence for 15 minutes', 'Quit WorkSuite'];
    await waitFor(() => expect(items.every((label) => t.getAllByRole('button').some((b) => b.textContent === label))).toBe(true));
    const item = (label: string) => t.getAllByRole('button').find((b) => b.textContent === label)!;
    fireEvent.click(item('Open Live dashboard⌘⇧D'));
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'dashboard' });
    fireEvent.click(item('Show Live map window⌘⇧M'));
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'liveMap' });
    fireEvent.click(item('Wall mode on Display 2LG 27″ ›'));
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'wall' });
    fireEvent.click(item('Silence for 15 minutes'));
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'silence' });
    fireEvent.click(item('Quit WorkSuite'));
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'quit' });
  });

  it('replies and joins from the tray, the draft shared with the call window; Esc puts it away, ⌘⇧D opens the dashboard', async () => {
    vi.mocked(call).mockImplementation((async (channel: string) => {
      if (channel === 'ring:state') return ring({ drafts: { 11: 'Sorry Anne' } });
      if (channel === 'live:info') return INFO;
      if (channel === 'ring:joinSend') return { ok: true, why: null };
      return null;
    }) as never);
    show(<RingTrayWindow />);
    const anne = await screen.findByRole('listitem', { name: 'Anne · Acme Ltd' });
    const box = within(anne).getByLabelText('Reply to Anne · Acme Ltd') as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe('Sorry Anne'));
    fireEvent.change(box, { target: { value: 'Sorry Anne — I can move the licence for you now' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 11, message: 'Sorry Anne — I can move the licence for you now', visitor: 'Anne · Acme Ltd' }));
    fireEvent.click(within(screen.getByRole('listitem', { name: 'Visitor 4F2A' })).getByRole('button', { name: 'Join Visitor 4F2A' }));
    expect(call).toHaveBeenCalledWith('ring:join', { id: 12, visitor: 'Visitor 4F2A' });
    fireEvent.keyDown(box, { key: 'd', ctrlKey: true, shiftKey: true });
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'dashboard' });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'close' });
  });

  it('says how long it is silenced for, and keeps the ringing menu for anybody the dashboard refuses', async () => {
    vi.mocked(call).mockImplementation((async (channel: string) => {
      if (channel === 'ring:state') return ring();
      if (channel === 'live:info') return { ...INFO, silencedUntil: new Date(Date.now() + 10 * 60_000).toISOString() };
      return null;
    }) as never);
    show(<RingTrayWindow />);
    const tray = await screen.findByRole('region', { name: 'WorkSuite tray — live dashboard' });
    await waitFor(() => expect(within(tray).getAllByRole('button').some((b) => /^Silence for 15 minutesuntil /.test(b.textContent ?? ''))).toBe(true));
    cleanup();

    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    dashboard = () => {
      throw new ApiError(403, 'You need the "View live chat widgets and conversations" permission', null, null);
    };
    show(<RingTrayWindow />);
    expect(await screen.findByText('Website chat ringing')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'WorkSuite tray — live dashboard' })).toBeNull();
    expect(screen.getByText('Open Website Chats')).toBeTruthy();
  });
});

describe('the rows and the map’s places', () => {
  it('Needs you is worst first; Yours is mine and not waiting on me', () => {
    const now = Date.now();
    expect(needsRows(VISITORS, now).map((v) => v.conversation_id)).toEqual([11, 12]);
    expect(yoursRows(VISITORS).map((v) => v.conversation_id)).toEqual([13]);
  });

  it('the window’s presets name the home country by its code; Show on map goes to the city, or the country', () => {
    expect(windowPresets('Sri Lanka').map((p) => p.label)).toEqual(['World', 'Asia', 'LK']);
    expect(windowPresets(null).map((p) => p.label)).toEqual(['World']);
    const b = focusBox({ lat: 7.3, lng: 80.6, country: 'Sri Lanka' })!;
    expect(b.x + b.w / 2).toBeCloseTo(px(80.6));
    expect(b.y + b.h / 2).toBeCloseTo(py(7.3));
    expect(focusBox({ lat: null, lng: null, country: 'Sri Lanka' })!.w).toBeGreaterThan(0);
    expect(focusBox({ lat: null, lng: null, country: null })).toBeNull();
  });
});
