import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { WebchatRingPrefs, WebchatRingState } from '@shared/types';
import type { SubmitResult } from '@shared/ipc/contract';

const trays = vi.hoisted(() => [] as Array<{ menu: unknown; title: string; handlers: Record<string, (...a: unknown[]) => void>; popped: unknown[] }>);
const badge = vi.hoisted(() => ({ count: -1 }));
const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void>; closed: boolean }>);
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined, setBadgeCount: (n: number) => (badge.count = n) },
  BrowserWindow: class {},
  screen: {},
  nativeImage: { createFromPath: () => ({ setTemplateImage: () => undefined }) },
  Menu: { buildFromTemplate: (t: unknown) => t },
  Tray: class {
    entry = { menu: null as unknown, title: '', handlers: {} as Record<string, (...a: unknown[]) => void>, popped: [] as unknown[] };
    constructor() {
      trays.push(this.entry);
    }
    setToolTip() {}
    setImage() {}
    setTitle(t: string) {
      this.entry.title = t;
    }
    setContextMenu(m: unknown) {
      this.entry.menu = m;
    }
    popUpContextMenu(m: unknown) {
      this.entry.popped.push(m);
    }
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
      this.entry = { options, events: {}, closed: false };
      notes.push(this.entry);
    }
    on(name: string, fn: (...args: unknown[]) => void) {
      this.entry.events[name] = fn;
      return this;
    }
    show() {}
    close() {
      this.entry.closed = true;
    }
  },
}));

import { DesktopError } from '../../../electron/main/errors';
import { hideOutcome, participantOutcome, WebchatRinger, type PendingAnswer, type RingingEntry } from '../../../electron/services/webchat-ring';
import { ringingCount, MENU_EVERY_MS, trayMenu, TrayService, type TrayActions, type TrayModel } from '../../../electron/tray/tray';
import { ringTrayBounds } from '../../../electron/windows/manager';
import { NotificationService } from '../../../electron/services/notifications';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';
import type { Preferences } from '../../../shared/types';

/**
 * R-05 "Native incoming-chat window — reply and join from the alert" and R-06 "Tray menu — reply and join, title bar
 * and dock" in the main process (RING-UI-06/07, X-UI-10/11; RING-40…46, UX-ALR-01/02/04, RDC-15).
 */
const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const entry = (over: Partial<RingingEntry> = {}): RingingEntry => ({ id: 3, conversation_id: 3, visitor: 'Visitor 4F2A', site: 'techubiz.com', kind: 'waiting', mine: false, since: stamp(5000), silenced: false, others_ringing: 2, ...over });
const sent: SubmitResult = { delivered: true, queued: false, id: null, status: 200, data: null, error: null, code: null };

function ringer(answer: PendingAnswer, over: Partial<{ locked: boolean; reply: SubmitResult }> = {}) {
  const post = vi.fn(async (_path: string, _body?: unknown, _opts?: unknown): Promise<unknown> => ({}));
  const opened: number[] = [];
  const reply = vi.fn(async (_id: number, _text: string) => over.reply ?? sent);
  const prefs: WebchatRingPrefs = { window: true, duringDnd: 'card', shortcut: true, volume: 80 };
  const r = new WebchatRinger({
    http: { get: vi.fn(async () => answer), post, request: vi.fn(async () => ({})) } as unknown as HttpClient,
    signedIn: () => true,
    locked: () => over.locked ?? false,
    me: () => 5,
    prefs: () => prefs,
    quiet: () => false,
    open: (id) => opened.push(id),
    reply,
    onChanged: (_s: WebchatRingState) => undefined,
    deviceId: () => 'desktop-12',
    focused: () => false,
  });
  return { r, post, opened, reply };
}

afterEach(() => vi.useRealTimers());

describe('R-05: Send & join from the native window (UX-ALR-01, RING-41, WF-X1)', () => {
  it('joins and sends in one request, with the saved reply it came from, and opens the thread — no mini chat', async () => {
    const { r, post, opened } = ringer({ ringing: [entry()] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.setDraft(3, 'Hi! It’s yearly — for 5 seats I can send a quote');
    expect(r.state().drafts).toEqual({ 3: 'Hi! It’s yearly — for 5 seats I can send a quote' });
    const res = await r.joinAndSend(3, 'Hi! It’s yearly — for 5 seats I can send a quote', { open: true, cannedId: 12 });
    expect(res).toEqual({ ok: true, why: null });
    const [path, body] = post.mock.calls.find(([p]) => String(p).endsWith('/join-reply'))!;
    expect(path).toBe('/api/chat/widget-admin/conversations/3/join-reply');
    expect(body).toEqual({ message: 'Hi! It’s yearly — for 5 seats I can send a quote', canned_id: 12 });
    expect(opened).toEqual([3]);
    expect(r.state().joined).toBeNull();
    expect(r.state().chats).toHaveLength(0);
    expect(r.state().drafts).toEqual({});
    r.stop();
  });

  it('Join chat without words opens the thread too, and sends no saved-reply count', async () => {
    const { r, post, opened } = ringer({ ringing: [entry()] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    await r.joinAndSend(3, null, { open: true, cannedId: 12 });
    expect(post.mock.calls.find(([p]) => String(p).endsWith('/join-reply'))?.[1]).toEqual({});
    expect(opened).toEqual([3]);
    r.stop();
  });

  it('keeps a draft only for a chat still ringing, and none behind the lock', async () => {
    const { r } = ringer({ ringing: [entry()] }, { locked: true });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.setDraft(99, 'not ringing');
    r.setDraft(3, 'Hello');
    expect(r.state().drafts).toEqual({});
    r.stop();
  });
});

describe('UX-ALR-04: a colleague joins while I am typing', () => {
  it('keeps my words and asks "Nuwan joined — send to the chat as a participant?"; nothing is sent, and it does not time out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { r, post, reply } = ringer({ ringing: [entry()] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.setDraft(3, 'Hi! It’s yearly');
    r.handle({ type: 'chat.ring.stopped', conversation_id: 3, reason: 'joined', by: 8, by_name: 'Nuwan Perera' } as never);
    expect(r.state().outcome).toMatchObject({ id: 3, kind: 'joined', by: 'Nuwan Perera', draft: 'Hi! It’s yearly', text: 'Nuwan joined — send to the chat as a participant?' });
    expect(post.mock.calls.some(([p]) => String(p).includes('/reply'))).toBe(false);
    expect(reply).not.toHaveBeenCalled();
    // A later note does not replace it, and it waits for my choice.
    r.handle({ type: 'chat.widget.call', what: 'ringing', call_id: 9, conversation_id: 4, visitor: 'Kamal' } as never);
    r.handle({ type: 'chat.widget.call', what: 'cancelled', call_id: 9, conversation_id: 4 } as never);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.state().outcome?.draft).toBe('Hi! It’s yearly');
    // Behind the lock it says nothing of it.
    expect(hideOutcome(r.state().outcome!)).toMatchObject({ draft: null, by: null, text: 'A colleague joined the chat.' });

    await r.outcomeAction('participant');
    expect(reply).toHaveBeenCalledWith(3, 'Hi! It’s yearly');
    expect(r.state().outcome).toMatchObject({ kind: 'note', text: 'Sent — you are in the chat as a participant.' });
    r.stop();
  });

  it('Discard drops the words without sending; with nothing typed it is R-03’s toast', async () => {
    const { r, reply } = ringer({ ringing: [entry(), entry({ id: 4, conversation_id: 4, visitor: 'Kasun' })] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(2));
    r.setDraft(3, 'One moment');
    r.handle({ type: 'chat.taken', conversation_id: 3, by: 8, by_name: 'Dilini' } as never);
    expect(r.state().outcome?.text).toBe('Dilini joined — send to the chat as a participant?');
    await r.outcomeAction('dismiss');
    expect(r.state().outcome).toBeNull();
    expect(reply).not.toHaveBeenCalled();
    r.handle({ type: 'chat.ring.stopped', conversation_id: 4, reason: 'joined', by: 8, by_name: 'Dilini' } as never);
    expect(r.state().outcome).toMatchObject({ kind: 'joined', text: 'Dilini joined the chat with Kasun' });
    expect(r.state().outcome?.draft).toBeUndefined();
    r.stop();
  });

  it('Send & join a moment late keeps what I sent and asks, instead of "already has this chat"', async () => {
    const { r, post } = ringer({ ringing: [entry()] });
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/join-reply')) throw new DesktopError('CONFLICT', 'Nuwan has already taken this chat.', 409, { by: 8, by_name: 'Nuwan' });
      return {};
    });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    const res = await r.joinAndSend(3, 'For 5 seats I can send a quote', { open: true });
    expect(res.ok).toBe(false);
    expect(r.state().outcome).toMatchObject({ draft: 'For 5 seats I can send a quote', text: 'Nuwan joined — send to the chat as a participant?' });
    await r.outcomeAction('dismiss');
    // A banner's reply (no call window to ask in) is told as R-03 tells it; the banner keeps the words as the draft.
    await r.reconcile();
    await r.joinAndSend(3, 'From the banner', { stay: false });
    expect(r.state().outcome).toMatchObject({ kind: 'late', text: 'You pressed Join a moment late — Nuwan already has this chat.' });
    expect(r.state().outcome?.draft).toBeUndefined();
    r.stop();
  });

  it('a refused participant reply keeps the words and says why', async () => {
    const { r } = ringer({ ringing: [entry()] }, { reply: { ...sent, delivered: false, status: 409, error: 'This chat already has as many staff as it can (3).' } });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.setDraft(3, 'Hello');
    r.handle({ type: 'chat.ring.stopped', conversation_id: 3, reason: 'joined', by: 8, by_name: 'Nuwan' } as never);
    await r.outcomeAction('participant');
    expect(r.state().outcome).toMatchObject({ draft: 'Hello', text: 'Not sent: This chat already has as many staff as it can (3). Send to the chat as a participant?' });
    expect(participantOutcome(null, 'X', 'w').text).toBe('A colleague joined — send to the chat as a participant?');
    r.stop();
  });
});

describe('R-06: the tray, its ringing menu and the badge (RING-43, RING-44, UX-ALR-02)', () => {
  const model: TrayModel = {
    signedIn: true, userName: 'Nuwan', organization: 'Livezen', offline: false, pending: 0, error: null, unreadChat: 2, unreadMail: 0, unreadOther: 1, badge: true,
    notificationsPausedUntil: null, attendance: null, updateReady: false, remoteControl: null, quickAsk: null, aiChanges: 0, apps: ['chat'],
    webchatRinging: [{ id: 1, label: 'Anne · Acme Ltd' }, { id: 2, label: 'Kasun P.' }, { id: 3, label: 'Visitor 4F2A', silenced: true }],
  };
  const actions = (): TrayActions => ({
    open: vi.fn(), openRoute: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn(), pauseNotifications: vi.fn(), openSettings: vi.fn(), checkUpdates: vi.fn(), quit: vi.fn(), lock: vi.fn(),
    pauseRemoteControl: vi.fn(), stopRemoteControl: vi.fn(), joinWebchat: vi.fn(), quickAsk: vi.fn(), aiChanges: vi.fn(), ringingSettings: vi.fn(), showRingMenu: vi.fn(() => true),
  });
  const realPlatform = process.platform;
  const onPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p, configurable: true });
  beforeEach(() => {
    trays.length = 0;
    badge.count = -1;
  });
  afterEach(() => onPlatform(realPlatform));

  it('the menu lists the ringing chats with Join, Reply from here…, Open Website Chats and Ringing settings…', () => {
    const a = actions();
    // First while it rings: one line, its chats and actions in the submenu (#346).
    const ring = trayMenu(model, a)[0]!;
    expect(ring.label).toBe('3 website chats ringing');
    const items = ring.submenu as Array<{ label?: string; type?: string; click?: () => void }>;
    expect(items.map((i) => i.label ?? i.type)).toEqual(['Join — Anne · Acme Ltd', 'Join — Kasun P.', 'Join — Visitor 4F2A', 'Reply from here…', 'separator', 'Open Website Chats', 'Ringing settings…']);
    items.find((i) => i.label === 'Reply from here…')!.click!();
    expect(a.showRingMenu).toHaveBeenCalledWith(null);
    // An older caller without the ringing menu keeps the plain one.
    expect((trayMenu(model, { ...a, showRingMenu: undefined })[0]!.submenu as Array<{ label?: string }>).some((i) => i.label === 'Reply from here…')).toBe(false);
  });

  it('counts what rings and is not silenced on the badge, beside what is unread (RING-44)', () => {
    expect(ringingCount(model)).toBe(2);
    expect(ringingCount({ ...model, webchatCalls: [{ id: 9, label: 'Kamal' }] })).toBe(3);
    expect(ringingCount({ ...model, apps: ['mail'] })).toBe(0);
    onPlatform('win32');
    const t = new TrayService(actions());
    t.start();
    t.update(model);
    // Unread chat 2 + notifications 1, and 2 ringing.
    expect(badge.count).toBe(5);
    t.update({ webchatRinging: [] });
    expect(badge.count).toBe(3);
  });

  it('a click opens the ringing menu by the icon while chats ring; otherwise WorkSuite (Windows)', () => {
    onPlatform('win32');
    const a = actions();
    const t = new TrayService(a);
    t.start();
    t.update(model);
    trays[0]!.handlers.click!({}, { x: 1800, y: 1040, width: 24, height: 40 });
    expect(a.showRingMenu).toHaveBeenCalledWith({ x: 1800, y: 1040, width: 24, height: 40 });
    expect(a.open).not.toHaveBeenCalled();
    t.update({ webchatRinging: [] });
    trays[0]!.handlers.click!({}, { x: 1800, y: 1040, width: 24, height: 40 });
    expect(a.open).toHaveBeenCalledTimes(1);
  });

  it('on macOS, while chats ring, the click opens the ringing menu and a right-click the plain one', () => {
    onPlatform('darwin');
    vi.useFakeTimers();
    const a = actions();
    const t = new TrayService(a);
    t.start();
    t.update(model);
    // The menu follows within two seconds (#346).
    vi.advanceTimersByTime(MENU_EVERY_MS);
    expect(trays[0]!.menu).toBeNull();
    trays[0]!.handlers.click!({}, { x: 0, y: 0, width: 0, height: 0 });
    // No bounds from the click: the icon's own.
    expect(a.showRingMenu).toHaveBeenCalledWith({ x: 1200, y: 0, width: 22, height: 24 });
    trays[0]!.handlers['right-click']!();
    expect(trays[0]!.popped).toHaveLength(1);
    t.update({ webchatRinging: [] });
    vi.advanceTimersByTime(MENU_EVERY_MS);
    expect(trays[0]!.menu).not.toBeNull();
    vi.useRealTimers();
  });

  it('places the ringing menu under the menu-bar icon, over a bottom taskbar, or in the usual corner', () => {
    const area = { x: 0, y: 25, width: 1440, height: 875 };
    expect(ringTrayBounds(area, { x: 1200, y: 0, width: 22, height: 24 }, 400, 'darwin')).toEqual({ x: 1041, y: 29, width: 340, height: 400 });
    const win = { x: 0, y: 0, width: 1920, height: 1040 };
    expect(ringTrayBounds(win, { x: 1880, y: 1045, width: 24, height: 35 }, 400, 'win32')).toEqual({ x: 1572, y: 636, width: 340, height: 400 });
    expect(ringTrayBounds(win, null, 400, 'win32')).toEqual({ x: 1572, y: 636, width: 340, height: 400 });
    expect(ringTrayBounds(win, { x: 0, y: 0, width: 0, height: 0 }, 400, 'linux')).toEqual({ x: 1572, y: 4, width: 340, height: 400 });
    expect(ringTrayBounds(win, null, 5000, 'linux').height).toBe(1024);
  });
});

describe('RDC-15: the native incoming-chat banner answers too (R-05)', () => {
  it('with the call window off, a ringing chat’s banner takes a reply, which goes the way Send & join does', async () => {
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    notes.length = 0;
    const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: false, dndEnabled: false, language: 'en' } as unknown as Preferences;
    const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
    const service = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})) } as unknown as HttpClient, () => prefs);
    (service as unknown as { userId: string }).userId = '5';
    service.onClick = vi.fn();
    service.sendWebsiteReply = vi.fn(async () => sent);
    service.handleRealtime({ type: 'chat.incoming', conversation_id: 41, visitor: 'Visitor 4F2A', site: 'techubiz.com', preview: 'Is the Adobe licence lifetime or yearly?', event_id: 'e1' } as never);
    expect(notes[0]!.options).toMatchObject({ title: 'Website chat · techubiz.com', hasReply: true, replyPlaceholder: 'Reply to Visitor 4F2A' });
    notes[0]!.events.reply!({ reply: 'It’s yearly' });
    await vi.waitFor(() => expect(service.sendWebsiteReply).toHaveBeenCalledWith(41, 'It’s yearly'));
    // The call window is the alert while it shows: no banner on top of it.
    service.ringerShowing = () => true;
    service.handleRealtime({ type: 'chat.incoming', conversation_id: 42, visitor: 'Kasun', event_id: 'e2' } as never);
    expect(notes).toHaveLength(1);
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });
});
