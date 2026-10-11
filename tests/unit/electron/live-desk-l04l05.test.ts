import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { WebchatRingChat, WebchatRingPrefs, WebchatRingState } from '@shared/types';

const trays = vi.hoisted(() => [] as Array<{ menu: unknown; title: string; tooltip: string; images: unknown[]; handlers: Record<string, (...a: unknown[]) => void> }>);
const badge = vi.hoisted(() => ({ count: -1 }));
const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void>; closed: boolean; shown: boolean }>);
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined, setBadgeCount: (n: number) => (badge.count = n) },
  BrowserWindow: class {},
  screen: {},
  powerSaveBlocker: {},
  nativeImage: { createFromPath: (p: string) => ({ path: p, setTemplateImage: () => undefined }) },
  Menu: { buildFromTemplate: (t: unknown) => t },
  Tray: class {
    entry = { menu: null as unknown, title: '', tooltip: '', images: [] as unknown[], handlers: {} as Record<string, (...a: unknown[]) => void> };
    constructor() {
      trays.push(this.entry);
    }
    setToolTip(t: string) {
      this.entry.tooltip = t;
    }
    setImage(i: unknown) {
      this.entry.images.push(i);
    }
    setTitle(t: string) {
      this.entry.title = t;
    }
    setContextMenu(m: unknown) {
      this.entry.menu = m;
    }
    popUpContextMenu() {}
    getBounds() {
      return { x: 1200, y: 0, width: 22, height: 24 };
    }
    on(name: string, fn: (...a: unknown[]) => void) {
      this.entry.handlers[name] = fn;
    }
    destroy() {}
  },
  Notification: class {
    static isSupported = () => true;
    entry: (typeof notes)[number];
    constructor(options: Record<string, unknown>) {
      this.entry = { options, events: {}, closed: false, shown: false };
      notes.push(this.entry);
    }
    on(name: string, fn: (...args: unknown[]) => void) {
      this.entry.events[name] = fn;
      return this;
    }
    show() {
      this.entry.shown = true;
    }
    close() {
      this.entry.closed = true;
    }
  },
}));

import { DesktopError } from '../../../electron/main/errors';
import { AT_RISK_ACTIONS, AtRiskAlerts, atRiskNotice, LivePulse, liveTitle, wallTarget } from '../../../electron/services/live-desk';
import { WebchatRinger, type PendingAnswer, type RingingEntry } from '../../../electron/services/webchat-ring';
import { MENU_EVERY_MS, trayMenu, TrayService, type TrayActions, type TrayModel } from '../../../electron/tray/tray';
import { LIVE_ROUTE, LIVE_TRAY_WIDTH, ringTrayBounds, windowRoute } from '../../../electron/windows/manager';
import type { HttpClient } from '../../../electron/services/http';

/**
 * L-04 "Desktop — pop-out Live map window and notification" and L-05 "Desktop — tray mini-dashboard with reply and
 * join" in the main process (WS-WCHAT MAP-UI-04/05; MAP-21, MAP-22, MAP-23, MAP-24, MAP-25, UX-ALR-03).
 */
const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const chat = (o: Partial<WebchatRingChat> = {}): WebchatRingChat => ({
  id: 11, visitor: 'Anne · Acme Ltd', site: 'techubiz.com', page: '/support/activation', place: 'Kandy, LK', device: null, returning: false, preview: 'My activation key says invalid on the second laptop',
  priority: 'normal', offline: false, since: stamp(192_000), stage: 'everyone', atRisk: true, mine: false, by: null, silenced: false, ...o,
});
const state = (o: Partial<WebchatRingState> = {}): Pick<WebchatRingState, 'chats' | 'hidden' | 'ringHere'> => ({ chats: [chat()], hidden: false, ringHere: true, ...o });

const realPlatform = process.platform;
const onPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p, configurable: true });
afterEach(() => {
  onPlatform(realPlatform);
  vi.useRealTimers();
});

describe('MAP-23: an at-risk chat raises a native notification with Join and Show on map', () => {
  const deps = (o: Partial<ConstructorParameters<typeof AtRiskAlerts>[0]> = {}) => ({
    allowed: () => true, quiet: () => false, duringDnd: () => 'card' as const, sound: () => true, join: vi.fn(), showOnMap: vi.fn(), ...o,
  });
  beforeEach(() => void (notes.length = 0));

  it('says it in the design’s words: who is at risk, for how long, where, and what they wrote', () => {
    expect(atRiskNotice(chat())).toEqual({ title: 'Anne · Acme Ltd is at risk — 3:12 in Kandy', body: '“My activation key says invalid on the second laptop”' });
    expect(atRiskNotice(chat({ place: null, preview: 'x'.repeat(100) })).title).toBe('Anne · Acme Ltd is at risk — 3:12');
    expect(atRiskNotice(chat({ preview: 'x'.repeat(100) })).body).toBe(`“${'x'.repeat(79)}…”`);
    expect(AT_RISK_ACTIONS).toEqual(['Join', 'Show on map']);
  });

  it('raises it once per chat, Join joins, Show on map (or a click) shows the place, and it is withdrawn when somebody joins', () => {
    const d = deps();
    const a = new AtRiskAlerts(d);
    a.update(state({ chats: [chat(), chat({ id: 12, atRisk: false })] }));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({ title: 'Anne · Acme Ltd is at risk — 3:12 in Kandy', silent: false, actions: [{ type: 'button', text: 'Join' }, { type: 'button', text: 'Show on map' }] });
    expect(notes[0]!.shown).toBe(true);
    a.update(state());
    expect(notes).toHaveLength(1);
    notes[0]!.events.action!({}, 0);
    expect(d.join).toHaveBeenCalledWith(11);
    notes[0]!.events.action!({}, 1);
    notes[0]!.events.click!();
    expect(d.showOnMap).toHaveBeenCalledTimes(2);
    expect(d.showOnMap).toHaveBeenCalledWith(11);
    // Somebody joined: no longer ringing for me, and the notification goes.
    a.update(state({ chats: [] }));
    expect(notes[0]!.closed).toBe(true);
  });

  it('follows the ringing device (RING-10) and Focus (RING-47), and says nothing behind the lock', () => {
    new AtRiskAlerts(deps()).update(state({ ringHere: false }));
    expect(notes).toHaveLength(0);
    new AtRiskAlerts(deps({ allowed: () => false })).update(state());
    expect(notes).toHaveLength(0);
    new AtRiskAlerts(deps()).update(state({ hidden: true }));
    expect(notes).toHaveLength(0);
    // Focus kept to the card: shown without sound; at risk or as usual, with it.
    new AtRiskAlerts(deps({ quiet: () => true })).update(state());
    expect(notes[0]!.options.silent).toBe(true);
    new AtRiskAlerts(deps({ quiet: () => true, duringDnd: () => 'at_risk' })).update(state());
    expect(notes[1]!.options.silent).toBe(false);
    // Locked after it was raised: withdrawn.
    const a = new AtRiskAlerts(deps());
    a.update(state());
    a.update(state({ hidden: true }));
    expect(notes[2]!.closed).toBe(true);
  });
});

describe('MAP-22: the figures the menu-bar icon carries, read with the main window closed', () => {
  it('reads the dashboard, tells only of changes, and stops for somebody who is not website staff', async () => {
    const answers: unknown[] = [{ now: { visitors_online: 18, waiting_on_us: 2, at_risk: 1 } }, { now: { visitors_online: 18, waiting_on_us: 2, at_risk: 1 } }];
    const get = vi.fn(async () => {
      const a = answers.shift();
      if (!a) throw new DesktopError('HTTP_ERROR' as never, 'Forbidden', 403);
      return a;
    });
    const changed = vi.fn();
    const p = new LivePulse({ http: { get } as unknown as HttpClient, allowed: () => true, onChanged: changed });
    p.start();
    await vi.waitFor(() => expect(p.get()).toEqual({ online: 18, waiting: 2, atRisk: 1 }));
    await p.read();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/chat/widget-admin/dashboard');
    p.stop();
    expect(p.get()).toBeNull();
    expect(changed).toHaveBeenLastCalledWith(null);
  });

  it('“18 · 2 waiting” in the menu bar, red while one is at risk; the click opens the mini-dashboard, ringing or not', () => {
    onPlatform('darwin');
    trays.length = 0;
    // The menu follows a change within two seconds (#346): time moves on before it is read.
    vi.useFakeTimers();
    const settle = () => vi.advanceTimersByTime(MENU_EVERY_MS);
    const a: TrayActions = {
      open: vi.fn(), openRoute: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn(), pauseNotifications: vi.fn(), openSettings: vi.fn(), checkUpdates: vi.fn(), quit: vi.fn(), lock: vi.fn(),
      pauseRemoteControl: vi.fn(), stopRemoteControl: vi.fn(), joinWebchat: vi.fn(), quickAsk: vi.fn(), aiChanges: vi.fn(), ringingSettings: vi.fn(), showRingMenu: vi.fn(() => true),
      liveDashboard: vi.fn(), liveMap: vi.fn(),
    };
    const model: TrayModel = {
      signedIn: true, userName: 'Nuwan', organization: 'Livezen', offline: false, pending: 0, error: null, unreadChat: 0, unreadMail: 0, unreadOther: 0, badge: true,
      notificationsPausedUntil: null, attendance: null, updateReady: false, remoteControl: null, quickAsk: null, aiChanges: 0, apps: ['chat'],
      webchatRinging: [{ id: 11, label: 'Anne · Acme Ltd' }, { id: 12, label: 'Visitor 4F2A' }], live: { online: 18, atRisk: true },
    };
    const t = new TrayService(a);
    t.start();
    t.update(model);
    // Waiting on me, as the badge counts it (MAP-25).
    expect(trays[0]!.title).toBe(' 18 · 2 waiting');
    expect(String((trays[0]!.images.at(-1) as { path: string }).path)).toMatch(/tray[\\/]unread\.png$/);
    t.update({ live: { online: 18, atRisk: false }, webchatRinging: [] });
    expect(trays[0]!.title).toBe(' 18 · 0 waiting');
    expect(String((trays[0]!.images.at(-1) as { path: string }).path)).toMatch(/normalTemplate\.png$/);
    expect(trays[0]!.tooltip).toBe('WorkSuite — 18 visitors on your sites');
    // Nothing rings, and the click still opens the mini-dashboard.
    settle();
    expect(trays[0]!.menu).toBeNull();
    trays[0]!.handlers.click!({}, { x: 1200, y: 0, width: 22, height: 24 });
    expect(a.showRingMenu).toHaveBeenCalledTimes(1);
    // Without the Live figures (not website staff), the menu as before.
    t.update({ live: null });
    expect(trays[0]!.title).toBe('');
    settle();
    expect(trays[0]!.menu).not.toBeNull();
    vi.useRealTimers();
  });

  it('the plain menu offers the Live dashboard and the Live map window with their shortcuts', () => {
    const a = { showRingMenu: vi.fn(() => true), liveDashboard: vi.fn(), liveMap: vi.fn() } as unknown as TrayActions;
    const m = { signedIn: true, apps: ['chat'], webchatRinging: [], live: { online: 18, atRisk: false }, userName: null, organization: null, offline: false, pending: 0 } as unknown as TrayModel;
    // One "Live · 18 on your sites" line, the dashboard and the map window in its submenu (#346).
    const live = trayMenu(m, a).find((i) => i.label === 'Live · 18 on your sites')!;
    const items = live.submenu as Array<{ label: string; accelerator?: string; registerAccelerator?: boolean; click: () => void }>;
    const dash = items.find((i) => i.label === 'Open Live dashboard')!;
    const map = items.find((i) => i.label === 'Show Live map window')!;
    // Keys beside the lines on Windows and macOS; Ubuntu's tray cannot draw them.
    if (process.platform === 'linux') expect([dash.accelerator, map.accelerator]).toEqual([undefined, undefined]);
    else expect([dash.accelerator, dash.registerAccelerator, map.accelerator, map.registerAccelerator]).toEqual(['CmdOrCtrl+Shift+D', false, 'CmdOrCtrl+Shift+M', false]);
    map.click();
    expect(a.liveMap).toHaveBeenCalled();
    items.find((i) => i.label === 'Live dashboard…')!.click();
    expect(a.showRingMenu).toHaveBeenCalledWith(null);
    expect(trayMenu({ ...m, live: null }, a).some((i) => String(i.label).startsWith('Live'))).toBe(false);
  });
});

describe('UX-ALR-03: reply and join from a Needs you row that is not ringing for me', () => {
  function ringer(answer: PendingAnswer) {
    const post = vi.fn(async (_path: string, _body?: unknown, _opts?: unknown): Promise<unknown> => ({}));
    const opened: number[] = [];
    const prefs: WebchatRingPrefs = { window: true, duringDnd: 'card', shortcut: true, volume: 80 };
    const r = new WebchatRinger({
      http: { get: vi.fn(async () => answer), post, request: vi.fn(async () => ({})) } as unknown as HttpClient,
      signedIn: () => true, locked: () => false, me: () => 5, prefs: () => prefs, quiet: () => false, open: (id) => opened.push(id),
      onChanged: () => undefined, deviceId: () => 'desktop-12', focused: () => false,
    });
    return { r, post, opened };
  }
  const entry = (o: Partial<RingingEntry> = {}): RingingEntry => ({ id: 3, conversation_id: 3, visitor: 'Kasun P.', site: 'techubiz.com', kind: 'waiting', mine: false, since: stamp(5000), silenced: false, ...o });

  it('Send & join posts the words through the same join-reply; Join accepts and opens the chat', async () => {
    const { r, post, opened } = ringer({ ringing: [entry()] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    // Without a visitor named, a chat that does not ring is refused as before.
    expect(await r.joinAndSend(12, 'Hi')).toEqual({ ok: false, why: 'This chat is no longer ringing.' });
    expect(await r.joinAndSend(12, 'Hi — one moment', { visitor: 'Visitor 4F2A' })).toEqual({ ok: true, why: null });
    expect(post.mock.calls.find(([p]) => String(p).endsWith('/12/join-reply'))?.[1]).toEqual({ message: 'Hi — one moment' });
    expect(await r.join(14, undefined, 'Visitor 51EF')).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/14/accept');
    expect(opened).toEqual([14]);
    r.stop();
  });

  it('a colleague first: who has it is said, as for a ringing chat', async () => {
    const { r, post } = ringer({ ringing: [] });
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/12/accept')) throw new DesktopError('HTTP_ERROR' as never, 'Nuwan Silva has already taken this chat.', 409);
      return {};
    });
    r.start();
    expect(await r.join(12, undefined, 'Visitor 4F2A')).toBe(false);
    expect(r.state().outcome).toMatchObject({ kind: 'late', text: 'You pressed Join a moment late — Nuwan already has this chat.' });
    r.stop();
  });
});

describe('MAP-21, MAP-24: the windows', () => {
  it('“Wall mode on Display 2 · LG 27″”: the first screen that is not the main one, or the main one alone', () => {
    expect(wallTarget([{ id: 1, label: 'Built-in Retina Display' }, { id: 7, label: 'LG 27″' }], 1)).toEqual({ id: 7, display: 'Display 2', name: 'LG 27″' });
    expect(wallTarget([{ id: 1, label: '' }], 1)).toEqual({ id: 1, display: 'Display 1', name: null });
    expect(wallTarget([], 1)).toBeNull();
    expect(liveTitle(18, 2)).toBe('18 · 2 waiting');
  });

  it('the mini-dashboard is the design’s 380 wide; the Live map and wall windows are the Live dashboard’s, so they close with Chat', () => {
    const area = { x: 0, y: 25, width: 1440, height: 875 };
    expect(ringTrayBounds(area, { x: 1200, y: 0, width: 22, height: 24 }, 640, 'darwin', LIVE_TRAY_WIDTH)).toEqual({ x: 1021, y: 29, width: 380, height: 640 });
    expect(windowRoute('app://bundle/index.html#/window/live-map')).toBe(LIVE_ROUTE);
    expect(windowRoute('app://bundle/index.html#/window/live-map?focus=11')).toBe(LIVE_ROUTE);
    expect(windowRoute('app://bundle/index.html#/window/wall')).toBe(LIVE_ROUTE);
    expect(windowRoute('app://bundle/index.html#/window/ring-tray')).toBeNull();
    expect(LIVE_ROUTE).toBe('/chat?view=website&section=dashboard');
  });
});
