import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;
const shown = vi.hoisted(() => [] as Array<{ title: string; body: string; silent: boolean; on: Record<string, Handler> }>);
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  nativeImage: { createFromPath: () => ({}) },
  Notification: class {
    static isSupported = () => true;
    private handlers: Record<string, Handler> = {};
    constructor(private readonly o: { title: string; body: string; silent: boolean }) {}
    on(event: string, h: Handler) {
      this.handlers[event] = h;
      return this;
    }
    show() {
      shown.push({ title: this.o.title, body: this.o.body, silent: this.o.silent, on: this.handlers });
    }
    close() {}
  },
}));

import { NotificationService } from '../../../electron/services/notifications';
import { LOCKED_MESSAGE, lockedClickTarget, notificationPermission, presentLocked } from '../../../electron/services/locked-notifications';
import { RealtimeService } from '../../../electron/services/realtime';
import { normalizePolicy } from '../../../electron/services/policy';
import type { Database } from '../../../electron/services/db';
import type { HttpClient } from '../../../electron/services/http';
import type { Vault } from '../../../electron/services/vault';
import type { Preferences } from '../../../shared/types';

const { SettingsService } = await import('../../../electron/services/settings');

const hhmm = (ms: number) => {
  const d = new Date(Date.now() + ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);
const message = (id: number, extra: Record<string, unknown> = {}) => ({ type: 'chat.message', message_id: id, room_id: 12, room_name: 'Design', sender: 'Asha', preview: 'The budget is in', ...extra });

function service(over: Partial<Preferences> = {}, server: { rooms?: unknown[]; messages?: unknown[] } = {}) {
  const db = { tx: (f: () => void) => f(), run: () => undefined, all: () => [] } as unknown as Database;
  const vault = { encrypt: (x: unknown) => JSON.stringify(x), decrypt: () => null } as unknown as Vault;
  const get = vi.fn(async (path: string) => {
    if (path === '/api/chat/rooms') return { rooms: server.rooms ?? [] };
    if (path === '/api/chat/messages') return { messages: server.messages ?? [] };
    if (path === '/api/notifications') return { items: [] };
    return {};
  });
  const http = { get, post: vi.fn(async () => ({})) } as unknown as HttpClient;
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: true, dndEnabled: false, dndFrom: hhmm(-3_600_000), dndTo: hhmm(3_600_000), ...over } as Preferences;
  const s = new NotificationService(db, () => vault, http, () => prefs);
  let locked = true;
  s.isLocked = () => locked;
  const changed = vi.fn();
  s.onChanged = changed;
  return { s, get, prefs, changed, unlock: () => (locked = false), lock: () => (locked = true) };
}

beforeEach(() => {
  shown.length = 0;
});

describe('what a banner shows while WorkSuite is locked (#114)', () => {
  const chat = { module: 'chat', title: 'Asha · Design', body: 'The budget is in', sender: 'Asha' };
  it('hides the message by default', () => {
    expect(presentLocked(chat, { notificationPrivacy: 'FULL' })).toEqual({ title: 'WorkSuite', body: LOCKED_MESSAGE });
    expect(LOCKED_MESSAGE).toBe('New message in WorkSuite.');
  });
  it('shows the sender, the preview, or both, as this computer allows', () => {
    expect(presentLocked(chat, { notificationPrivacy: 'FULL', lockedNotificationSender: true })).toEqual({ title: 'WorkSuite', body: 'New message from Asha' });
    expect(presentLocked(chat, { notificationPrivacy: 'FULL', lockedNotificationPreview: true })).toEqual({ title: 'New message in WorkSuite', body: 'The budget is in' });
    expect(presentLocked(chat, { notificationPrivacy: 'FULL', lockedNotificationSender: true, lockedNotificationPreview: true })).toEqual({ title: 'Asha · Design', body: 'The budget is in' });
  });
  it('never shows more than "What banners show" allows', () => {
    const all = { lockedNotificationSender: true, lockedNotificationPreview: true };
    expect(presentLocked(chat, { notificationPrivacy: 'SENDER_ONLY', ...all })).toEqual({ title: 'WorkSuite', body: 'New message from Asha' });
    expect(presentLocked(chat, { notificationPrivacy: 'GENERIC', ...all })).toEqual({ title: 'WorkSuite', body: LOCKED_MESSAGE });
  });
  it('keeps every other notification generic', () => {
    expect(presentLocked({ module: 'files', title: 'Shared', body: 'Budget.xlsx', sender: null }, { notificationPrivacy: 'FULL', lockedNotificationSender: true, lockedNotificationPreview: true })).toEqual({ title: 'WorkSuite', body: 'New WorkSuite notification' });
  });
  it('follows the organization minimum: settings clamp the toggles and report them managed', () => {
    let stored: unknown;
    const db = { getConfig: () => stored, setConfig: (_: string, v: unknown) => { stored = v; } } as unknown as Database;
    const settings = new SettingsService(db);
    expect(settings.effective()).toMatchObject({ lockedNotificationSender: false, lockedNotificationPreview: false });
    settings.update({ lockedNotificationSender: true, lockedNotificationPreview: true });
    expect(settings.effective()).toMatchObject({ lockedNotificationSender: true, lockedNotificationPreview: true });
    settings.setPolicy(normalizePolicy({ notification_min_privacy: 'SENDER_ONLY' }, true));
    expect(settings.effective()).toMatchObject({ lockedNotificationSender: true, lockedNotificationPreview: false });
    settings.setPolicy(normalizePolicy({ notification_min_privacy: 'GENERIC' }, true));
    expect(settings.effective()).toMatchObject({ lockedNotificationSender: false, lockedNotificationPreview: false });
    expect(settings.locks().map((l) => l.key)).toEqual(expect.arrayContaining(['lockedNotificationSender', 'lockedNotificationPreview']));
  });
});

describe('a chat message arriving while locked (#114)', () => {
  it('pops up with the generic text and the sound, and updates the badge without an unlock', () => {
    const { s, changed } = service();
    s.handleRealtime(message(1));
    expect(shown).toEqual([expect.objectContaining({ title: 'WorkSuite', body: LOCKED_MESSAGE, silent: false })]);
    expect(s.counts().chat).toBe(1);
    expect(changed).toHaveBeenCalled();
  });
  it('shows the sender and preview when allowed, and is silent when sounds are off', () => {
    const { s } = service({ lockedNotificationSender: true, lockedNotificationPreview: true, notificationSounds: false });
    s.handleRealtime(message(1));
    expect(shown).toEqual([expect.objectContaining({ title: 'Asha · Design', body: 'The budget is in', silent: true })]);
  });
  it('shows whether or not a window is focused, minimised or closed to the tray', () => {
    const { s } = service();
    s.isFocused = () => false;
    s.handleRealtime(message(1));
    s.isFocused = () => true;
    s.handleRealtime(message(2));
    expect(shown).toHaveLength(2);
  });
  it('respects a muted conversation, Do Not Disturb, the Chat switch and pause — but still counts it', () => {
    const muted = service();
    muted.s.handleRealtime(message(1, { muted: true }));
    muted.s.handleRealtime(message(2, { alert: false }));
    expect(muted.s.counts().chat).toBe(2);
    const dnd = service({ dndEnabled: true });
    dnd.s.handleRealtime(message(3));
    const off = service({ moduleNotifications: { chat: false } });
    off.s.handleRealtime(message(4));
    const paused = service();
    paused.s.pause(30);
    paused.s.handleRealtime(message(5));
    expect(shown).toEqual([]);
    // An urgent message reaches you through Do Not Disturb, still without its content.
    dnd.s.handleRealtime(message(6, { urgent: true }));
    expect(shown).toEqual([expect.objectContaining({ body: LOCKED_MESSAGE })]);
  });
  it('does not alert for an app the organization did not give the person', () => {
    const { s } = service();
    s.moduleEnabled = () => false;
    s.handleRealtime(message(1));
    expect(shown).toEqual([]);
  });
  it('shows content again once unlocked', () => {
    const { s, unlock } = service();
    unlock();
    s.handleRealtime(message(1));
    expect(shown).toEqual([expect.objectContaining({ title: 'Asha · Design', body: 'The budget is in' })]);
  });
});

describe('no duplicates after unlocking, sleeping or reconnecting (#114)', () => {
  const room = (extra: Record<string, unknown> = {}) => ({ id: 12, type: 'group', name: 'Design', unread: 2, muted: false, mentions: 0, last_message: { sender_id: 9, created_at: stamp(10_000) }, ...extra });
  const msgs = [
    { id: 1, sender_id: 9, sender_name: 'Asha', type: 'text', message: 'Seen live', created_at: stamp(20_000) },
    { id: 2, sender_id: 9, sender_name: 'Asha', type: 'text', message: 'Missed while asleep', created_at: stamp(10_000) },
    { id: 3, sender_id: 5, sender_name: 'Me', type: 'text', message: 'My own', created_at: stamp(5_000) },
  ];

  it('catches up what realtime missed, once, after the gap — not what was already shown', async () => {
    const { s, unlock } = service({}, { rooms: [room()], messages: msgs });
    s.start('5');
    s.handleRealtime(message(1));
    expect(shown).toHaveLength(1);
    s.markGap(Date.now() - 60_000); // the computer went to sleep
    unlock();
    await s.catchUpChat(); // the realtime resync after resume
    expect(shown.map((n) => n.body)).toEqual([LOCKED_MESSAGE, 'Missed while asleep']);
    await s.catchUpChat(); // a second resync: no gap, nothing new
    s.markGap(Date.now() - 60_000);
    await s.catchUpChat(); // another reconnect: the same messages are not shown again
    s.handleRealtime(message(2)); // nor when the push finally arrives
    expect(shown).toHaveLength(2);
    s.stop();
  });

  it('marks the gap when the socket drops, and does nothing without one', async () => {
    const { s, get } = service({}, { rooms: [room()], messages: msgs });
    s.start('5');
    await s.catchUpChat();
    expect(get).not.toHaveBeenCalledWith('/api/chat/rooms');
    s.realtimeState('connected');
    await s.catchUpChat();
    expect(get).not.toHaveBeenCalledWith('/api/chat/rooms');
    s.realtimeState('down');
    await s.catchUpChat();
    expect(get).toHaveBeenCalledWith('/api/chat/rooms');
    expect(shown.map((n) => n.body)).toEqual([LOCKED_MESSAGE, LOCKED_MESSAGE]);
    s.stop();
  });

  it('retries missed messages after the network is unavailable on resume', async () => {
    const { s, get } = service({}, { rooms: [room()], messages: msgs });
    s.start('5');
    get.mockRejectedValueOnce(new Error('Network unavailable'));
    s.markGap(Date.now() - 60_000);
    await s.catchUpChat();
    expect(shown).toEqual([]);
    await s.catchUpChat();
    expect(shown).toHaveLength(2);
    await s.catchUpChat();
    expect(shown).toHaveLength(2);
    s.stop();
  });

  it('retries partial catch-up without repeating messages already delivered', async () => {
    const { s, get } = service({}, { rooms: [room(), room({ id: 13 })], messages: msgs });
    s.start('5');
    get.mockResolvedValueOnce({ rooms: [room(), room({ id: 13 })] });
    get.mockResolvedValueOnce({ messages: msgs });
    get.mockRejectedValueOnce(new Error('Connection lost'));
    s.markGap(Date.now() - 60_000);
    await s.catchUpChat();
    expect(shown).toHaveLength(2);
    await s.catchUpChat();
    expect(shown).toHaveLength(2);
    s.stop();
  });

  it('retries a failed catch-up on the regular poll without another reconnect', async () => {
    vi.useFakeTimers();
    const { s, get } = service({}, { rooms: [room()], messages: msgs });
    try {
      s.start('5');
      get.mockRejectedValueOnce(new Error('Network unavailable'));
      s.markGap(Date.now() - 60_000);
      await s.catchUpChat();
      expect(shown).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(shown).toHaveLength(2);
    } finally {
      s.stop();
    }
  });

  it('skips muted conversations, mention-only ones without a mention, and old messages', async () => {
    const { s } = service({}, { rooms: [room({ muted: true }), room({ id: 13, notify_level: 'mentions' }), room({ id: 14, last_message: { sender_id: 9, created_at: stamp(3_600_000) } })], messages: msgs });
    s.start('5');
    s.markGap(Date.now() - 7_200_000);
    await s.catchUpChat();
    expect(shown).toEqual([]);
    s.stop();
  });
});

describe('the realtime connection after sleep (#114)', () => {
  it('replaces a socket that still says connected but went silent, and keeps a live one', async () => {
    const sockets: Array<{ url: string; closed: boolean; onmessage?: (m: { data: string }) => void; close: () => void }> = [];
    class FakeWS {
      closed = false;
      onmessage?: (m: { data: string }) => void;
      onclose?: () => void;
      constructor(public url: string) {
        sockets.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    const http = { get: vi.fn(async () => ({ ticket: 't', url: 'wss://example.com/ws', enabled: true })) } as unknown as HttpClient;
    const rt = new RealtimeService(http, () => 'https://example.com', false, FakeWS as unknown as new (url: string) => WebSocket);
    const states: string[] = [];
    rt.onState = (s) => states.push(s);
    const resync = vi.fn();
    rt.onResync = resync;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      rt.start();
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      sockets[0]!.onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
      rt.kick();
      expect(sockets).toHaveLength(1);
      vi.setSystemTime(Date.now() + 40_000); // asleep: no frames, no close
      rt.kick(); // powerMonitor 'resume'
      await vi.waitFor(() => expect(sockets).toHaveLength(2));
      expect(sockets[0]!.closed).toBe(true);
      expect(states).toContain('down');
      sockets[1]!.onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
      expect(resync).toHaveBeenCalledTimes(1);
    } finally {
      rt.stop();
      vi.useRealTimers();
    }
  });
});

describe('clicking a banner while locked (#114)', () => {
  it('opens the restricted chat window when chat is allowed while locked', () => {
    expect(lockedClickTarget('/chat?room=12', { lockedAllowChat: true })).toEqual({ kind: 'restricted-chat', room: '12' });
  });
  it('asks for the unlock otherwise, and for anything that is not a conversation', () => {
    expect(lockedClickTarget('/chat?room=12', { lockedAllowChat: false })).toEqual({ kind: 'unlock' });
    expect(lockedClickTarget('/chat?website=4', { lockedAllowChat: true })).toEqual({ kind: 'unlock' });
    expect(lockedClickTarget('/files?file=9', { lockedAllowChat: true })).toEqual({ kind: 'unlock' });
    expect(lockedClickTarget(null, { lockedAllowChat: true })).toEqual({ kind: 'unlock' });
  });
  it('hands the click to main with the link, whatever the lock', () => {
    const { s } = service();
    const click = vi.fn();
    s.onClick = click;
    s.handleRealtime(message(1));
    shown[0]!.on.click!();
    expect(click).toHaveBeenCalledWith('/chat?room=12', 'chat');
  });
});

describe('when the system does not show notifications (#114)', () => {
  it('says the computer cannot show them', () => {
    expect(notificationPermission('linux', false, null)).toMatchObject({ state: 'unsupported' });
  });
  it('is honest that the permission cannot be read, and names where to look', () => {
    const mac = notificationPermission('darwin', true, null);
    expect(mac.state).toBe('unknown');
    expect(mac.detail).toMatch(/System Settings › Notifications/);
    expect(notificationPermission('win32', true, null).detail).toMatch(/Settings › System › Notifications/);
  });
  it('reports the system refusing a banner, until one shows again', () => {
    const { s } = service();
    expect(s.permission().state).toBe('unknown');
    s.handleRealtime(message(1));
    shown[0]!.on.failed!({}, 'Notifications are disabled for this app');
    expect(s.permission()).toMatchObject({ state: 'blocked', failure: 'Notifications are disabled for this app' });
    s.handleRealtime(message(2));
    shown[1]!.on.show!();
    expect(s.permission().state).toBe('unknown');
  });
});

afterEach(() => vi.useRealTimers());

describe('locked notification switches (#115)', () => {
  it('hides chat banners while keeping delivery, updates and polling active', async () => {
    const { s, changed, get } = service({ lockedChatNotifications: false });
    s.start('7'); s.handleRealtime(message(811));
    expect(shown).toHaveLength(0); expect(changed).toHaveBeenCalled();
    await s.refreshCounts(); expect(get).toHaveBeenCalled(); s.stop();
  });
  it('controls call banners independently of chat banners', () => {
    const { s } = service({ lockedChatNotifications: false, lockedCallNotifications: true });
    s.handleRealtime({ type: 'chat.call.ringing', uuid: 'call-12345678', room_id: 12, caller_name: 'Asha' });
    expect(shown).toHaveLength(1); expect(shown[0]?.body).toBe('Incoming WorkSuite call');
    const hidden = service({ lockedCallNotifications: false });
    hidden.s.handleRealtime({ type: 'chat.call.ringing', uuid: 'call-87654321', room_id: 12 });
    expect(shown).toHaveLength(1);
    hidden.s.handleRealtime(message(812)); expect(shown).toHaveLength(2);
  });
  it('mutes locked sounds without changing unlocked sounds', () => {
    const { s, unlock } = service({ lockedNotificationSounds: false });
    s.handleRealtime(message(813)); expect(shown[0]?.silent).toBe(true);
    unlock(); s.handleRealtime(message(814)); expect(shown[1]?.silent).toBe(false);
  });
  it('uses caller-name permission rather than message previews for call alerts', () => {
    const call = { module: 'chat', category: 'incoming-call', title: 'Call', body: 'Private room', sender: 'Asha' };
    expect(presentLocked(call, { notificationPrivacy: 'FULL', lockedNotificationPreview: true })).toEqual({ title: 'WorkSuite', body: 'Incoming WorkSuite call' });
    expect(presentLocked(call, { notificationPrivacy: 'FULL', lockedShowCallerDetails: true }).body).toBe('Incoming call from Asha');
    expect(presentLocked(call, { notificationPrivacy: 'GENERIC', lockedShowCallerDetails: true }).body).toBe('Incoming WorkSuite call');
  });
});
