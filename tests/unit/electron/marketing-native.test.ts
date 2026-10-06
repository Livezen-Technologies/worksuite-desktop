import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void> }>);
vi.mock('electron', () => ({
  app: { isPackaged: false, setBadgeCount: () => undefined },
  Menu: { buildFromTemplate: (t: unknown) => t },
  Tray: class {},
  nativeImage: { createFromPath: () => ({ setTemplateImage: () => undefined }) },
  Notification: class {
    static isSupported = () => true;
    entry: (typeof notes)[number];
    constructor(options: Record<string, unknown>) {
      this.entry = { options, events: {} };
      notes.push(this.entry);
    }
    on(name: string, fn: (...args: unknown[]) => void) {
      this.entry.events[name] = fn;
      return this;
    }
    show() {}
    close() {}
  },
}));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => true), on: () => () => undefined, isMac: false }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canOpenLink, visibleAppIds } from '@shared/access';
import { DEEP_LINK_RULES, parseDeepLink } from '@shared/deeplink';
import { resolveWebLink } from '@shared/links';
import type { Preferences } from '@shared/types';
import { MarketingPulse, trayMarketing, type MarketingPulseAnswer, type MarketingPulseDeps } from '../../../electron/services/marketing-pulse';
import { CallbackReminders, callbackNotice, LATE_MS, SNOOZE_MS, utcMs, type CallbackItem, type CallbackRemindersDeps } from '../../../electron/services/marketing-reminders';
import { NEXT_CONTACT_LABEL, NEXT_CONTACT_SHORTCUT, NextContactKey, nextContactRoute, wantNextContactKey, type NextContactState } from '../../../electron/services/marketing-shortcut';
import { NotificationService } from '../../../electron/services/notifications';
import { trayMarketingItems, trayMenu, type TrayActions, type TrayModel } from '../../../electron/tray/tray';
import type { Database } from '../../../electron/services/db';
import type { HttpClient } from '../../../electron/services/http';
import type { Vault } from '../../../electron/services/vault';

/**
 * WorkSuite Desktop's own Marketing features (WS-MKT-SRS-001 MKT-DSK-01, MKT-CAL-12; the D01 design): worksuite://
 * links into the module, the global Next contact key held only while WorkSuite is not in front, the tray's queue and
 * sending counts, and callback reminders to the minute with Call now and Snooze 15 min.
 */

describe('worksuite://marketing links', () => {
  it('open the module, my call queue, a contact and a campaign, in the web’s address grammar', () => {
    const at = (url: string) => {
      const r = parseDeepLink(url);
      return r.ok ? { module: r.link.module, route: r.link.route, newWindow: r.link.newWindow } : r.reason;
    };
    expect(at('worksuite://marketing')).toEqual({ module: 'marketing', route: '/marketing', newWindow: false });
    expect(at('worksuite://marketing/queue')).toEqual({ module: 'marketing', route: '/marketing?view=queue', newWindow: false });
    expect(at('worksuite://marketing/contacts/42')).toEqual({ module: 'marketing', route: '/marketing?view=contacts&contact=42', newWindow: false });
    expect(at('worksuite://marketing/campaigns/12?window=1')).toEqual({ module: 'marketing', route: '/marketing?view=campaigns&campaign=12', newWindow: true });
    expect(at('worksuite:///marketing/QUEUE')).toEqual({ module: 'marketing', route: '/marketing?view=queue', newWindow: false });
  });

  it('take nothing else: other records, paths, tricks', () => {
    for (const bad of ['worksuite://marketing/lists/3', 'worksuite://marketing/contacts/../users', 'worksuite://marketing/contacts/1.2', 'worksuite://marketing/contacts', 'worksuite://marketing/queue?claim=1', 'worksuite://marketing/contacts/%2e%2e'])
      expect(parseDeepLink(bad).ok).toBe(false);
  });

  it('cover the four the module’s manifest declares', () => {
    for (const p of ['marketing', 'marketing/queue', 'marketing/contacts/:id', 'marketing/campaigns/:id']) expect(DEEP_LINK_RULES.some((r) => r.pattern === p && r.module === 'marketing')).toBe(true);
  });

  it('a server link, a reminder and the key open in the Marketing tab, for people who have Marketing only', () => {
    const route = nextContactRoute({ nonce: 7, campaign: 3 });
    expect(resolveWebLink(route)).toEqual({ kind: 'tab', route, app: 'marketing' });
    expect(resolveWebLink('/marketing?view=campaigns&campaign=12')).toEqual({ kind: 'tab', route: '/marketing?view=campaigns&campaign=12', app: 'marketing' });
    expect(canOpenLink(route, visibleAppIds({ apps: ['marketing'], permissions: ['*'] }))).toBe(true);
    expect(canOpenLink(route, visibleAppIds({ apps: ['crm'], permissions: ['*'] }))).toBe(false);
  });
});

describe('the Next contact key (⌘⇧N / Ctrl+Shift+N from other apps)', () => {
  const ok: NextContactState = { signedIn: true, locked: false, marketing: true, agent: null, focused: false };

  it('is wanted only signed in, unlocked, with Marketing, not ruled out as an agent, and with no WorkSuite window in front', () => {
    expect(wantNextContactKey(ok)).toBe(true);
    expect(wantNextContactKey({ ...ok, agent: true })).toBe(true);
    expect(wantNextContactKey({ ...ok, agent: false })).toBe(false);
    expect(wantNextContactKey({ ...ok, focused: true })).toBe(false);
    expect(wantNextContactKey({ ...ok, locked: true })).toBe(false);
    expect(wantNextContactKey({ ...ok, signedIn: false })).toBe(false);
    expect(wantNextContactKey({ ...ok, marketing: false })).toBe(false);
  });

  it('leads to the workspace with a new claim, narrowed to a campaign when there is one', () => {
    expect(NEXT_CONTACT_SHORTCUT).toBe('CommandOrControl+Shift+N');
    // The renderer says the same key on My call queue (calls-parts.tsx, in the shell's grammar).
    expect(readFileSync(join(__dirname, '../../../src/modules/marketing/calls-parts.tsx'), 'utf8')).toContain(`NEXT_CONTACT_GLOBAL = '${NEXT_CONTACT_SHORTCUT.replace('CommandOrControl', 'Mod')}'`);
    expect(NEXT_CONTACT_LABEL).toBe('CmdOrCtrl+Shift+N');
    expect(nextContactRoute({ nonce: 1700 })).toBe('/marketing?view=queue&tab=work&claim=1700');
    expect(nextContactRoute({ nonce: 1700, campaign: 9 })).toBe('/marketing?view=queue&tab=work&claim=1700&call=9');
    expect(nextContactRoute({ nonce: 1700, campaign: -1 })).toBe('/marketing?view=queue&tab=work&claim=1700');
    expect(nextContactRoute()).toMatch(/^\/marketing\?view=queue&tab=work&claim=\d+$/);
  });

  it('is held while wanted, given back on focus, and pressed through to the workspace', () => {
    let state = { ...ok };
    const held = new Map<string, () => void>();
    const press = vi.fn();
    const key = new NextContactKey({ register: vi.fn((acc: string, fn: () => void) => (held.set(acc, fn), true)), unregister: vi.fn((acc: string) => void held.delete(acc)), state: () => state, press });
    expect(key.sync()).toBe(true);
    expect([...held.keys()]).toEqual(['CommandOrControl+Shift+N']);
    held.get(NEXT_CONTACT_SHORTCUT)!();
    expect(press).toHaveBeenCalledTimes(1);
    // A second sync with nothing changed does not register again.
    expect(key.sync()).toBe(true);
    state = { ...ok, focused: true };
    expect(key.sync()).toBe(false);
    expect(held.size).toBe(0);
    state = { ...ok, locked: true };
    expect(key.sync()).toBe(false);
    state = { ...ok };
    expect(key.sync()).toBe(true);
    key.release();
    expect(held.size).toBe(0);
    expect(key.isHeld()).toBe(false);
  });

  it('does without the key when another app holds it, and asks again at the next change; never throws', () => {
    const register = vi.fn().mockReturnValueOnce(false).mockImplementationOnce(() => {
      throw new Error('taken');
    }).mockReturnValue(true);
    const key = new NextContactKey({ register, unregister: vi.fn(), state: () => ok, press: vi.fn() });
    expect(key.sync()).toBe(false);
    expect(key.sync()).toBe(false);
    expect(key.sync()).toBe(true);
    expect(register).toHaveBeenCalledTimes(3);
    const broken = new NextContactKey({ register, unregister: vi.fn(), state: () => { throw new Error('no session'); }, press: vi.fn() });
    expect(broken.sync()).toBe(false);
  });
});

const pulse = (over: Partial<MarketingPulseAnswer> = {}): MarketingPulseAnswer => ({
  queue: { waiting: 38, callbacks_today: 9, held: null },
  sending: [{ id: 4, name: 'Vendor re-permission', sent: 620, recipients: 1000 }],
  contacts: 4812,
  drafts: 2,
  ...over,
});

describe('Marketing in the tray', () => {
  it('reads the server’s pulse as the D01 lines', () => {
    expect(trayMarketing(pulse())).toEqual({ queueWaiting: 38, callbacksToday: 9, sending: { count: 1, pct: 62 } });
    expect(trayMarketing(pulse({ queue: null }))).toEqual({ queueWaiting: null, callbacksToday: null, sending: { count: 1, pct: 62 } });
    expect(trayMarketing(pulse({ sending: [] }))).toEqual({ queueWaiting: 38, callbacksToday: 9, sending: null });
    expect(trayMarketing(pulse({ queue: null, sending: [] }))).toBeNull();
    expect(trayMarketing(null)).toBeNull();
    // Two campaigns: how far through, across both.
    expect(trayMarketing(pulse({ sending: [{ id: 1, name: 'A', sent: 50, recipients: 100 }, { id: 2, name: 'B', sent: 0, recipients: 300 }] }))?.sending).toEqual({ count: 2, pct: 13 });
  });

  const model: TrayModel = {
    signedIn: true, userName: 'Sanduni', organization: 'Livezen', offline: false, pending: 0, error: null, unreadChat: 0, unreadMail: 0, unreadOther: 0,
    badge: true, notificationsPausedUntil: null, attendance: null, updateReady: false, remoteControl: null, webchatRinging: [], quickAsk: null, aiChanges: 0, apps: ['marketing'],
    marketing: { queueWaiting: 38, callbacksToday: 9, sending: { count: 1, pct: 62 } },
  };
  const actions = (): TrayActions => ({
    open: vi.fn(), openRoute: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn(), pauseNotifications: vi.fn(), openSettings: vi.fn(), checkUpdates: vi.fn(), quit: vi.fn(), lock: vi.fn(),
    pauseRemoteControl: vi.fn(), stopRemoteControl: vi.fn(), joinWebchat: vi.fn(), quickAsk: vi.fn(), aiChanges: vi.fn(), ringingSettings: vi.fn(), marketingNextContact: vi.fn(),
  });

  it('shows the queue, today’s callbacks, what is sending and Next contact, just above Open WorkSuite', () => {
    const a = actions();
    const items = trayMenu(model, a);
    const labels = items.map((i) => i.label ?? i.type);
    const at = labels.indexOf('Call queue waiting 38');
    expect(labels.slice(at, at + 6)).toEqual(['Call queue waiting 38', 'Callbacks today 9', 'Sending now 1 · 62%', 'Next contact', 'separator', 'Open WorkSuite']);
    const by = (label: string) => items.find((i) => i.label === label)!;
    (by('Call queue waiting 38').click as () => void)();
    expect(a.openRoute).toHaveBeenLastCalledWith('/marketing?view=queue');
    (by('Callbacks today 9').click as () => void)();
    expect(a.openRoute).toHaveBeenLastCalledWith('/marketing?view=queue&tab=callbacks');
    expect(by('Sending now 1 · 62%').enabled).toBe(false);
    // The key is shown, never registered by the menu: main holds it only while WorkSuite is not in front.
    expect(by('Next contact')).toMatchObject({ accelerator: 'CmdOrCtrl+Shift+N', registerAccelerator: false });
    (by('Next contact').click as () => void)();
    expect(a.marketingNextContact).toHaveBeenCalledTimes(1);
  });

  it('offers no queue lines to somebody with no call queue, and nothing without Marketing or signed out', () => {
    const a = actions();
    expect(trayMarketingItems({ ...model, marketing: { queueWaiting: null, callbacksToday: null, sending: { count: 2, pct: 40 } } }, a).map((i) => i.label ?? i.type)).toEqual(['Sending now 2 · 40%', 'separator']);
    expect(trayMarketingItems({ ...model, apps: ['crm'] }, a)).toEqual([]);
    expect(trayMarketingItems({ ...model, signedIn: false }, a)).toEqual([]);
    expect(trayMarketingItems({ ...model, marketing: null }, a)).toEqual([]);
    expect(trayMenu({ ...model, apps: ['crm'] }, a).some((i) => String(i.label).startsWith('Call queue'))).toBe(false);
  });

  function watcher(answers: Array<MarketingPulseAnswer | Error>, over: Partial<MarketingPulseDeps> = {}) {
    let i = 0;
    const onChange = vi.fn();
    const deps = {
      get: vi.fn(async () => {
        const a = answers[Math.min(i++, answers.length - 1)]!;
        if (a instanceof Error) throw a;
        return a;
      }) as unknown as MarketingPulseDeps['get'],
      allowed: vi.fn(() => true),
      onChange,
      every: 3_600_000,
      ...over,
    };
    return { w: new MarketingPulse(deps), deps: { ...deps, onChange } };
  }
  const refused = (status: number) => Object.assign(new Error('no'), { status });

  it('asks /api/marketing/pulse, and tells the tray only when what it shows changes', async () => {
    const { w, deps } = watcher([pulse(), pulse({ contacts: 4813 }), pulse({ queue: { waiting: 37, callbacks_today: 9, held: 4 } })]);
    w.start();
    await w.refresh();
    expect(deps.get).toHaveBeenCalledWith('/api/marketing/pulse');
    expect(deps.onChange).toHaveBeenLastCalledWith({ queueWaiting: 38, callbacksToday: 9, sending: { count: 1, pct: 62 } }, expect.objectContaining({ contacts: 4812 }));
    const calls = deps.onChange.mock.calls.length;
    await w.refresh();
    expect(deps.onChange.mock.calls.length).toBe(calls);
    await w.refresh();
    expect(deps.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ queueWaiting: 37 }), expect.anything());
    expect(w.get()?.queue?.held).toBe(4);
    w.stop();
    expect(deps.onChange).toHaveBeenLastCalledWith(null, null);
  });

  it('has no lines on a server without a pulse or for somebody refused, and keeps the last counts offline', async () => {
    const { w, deps } = watcher([pulse(), Object.assign(new Error('offline'), { code: 'NETWORK_UNREACHABLE' }), refused(404)]);
    w.start();
    await w.refresh();
    expect(deps.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ queueWaiting: 38 }), expect.anything());
    await w.refresh();
    expect(deps.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ queueWaiting: 38 }), expect.anything());
    await w.refresh();
    expect(deps.onChange).toHaveBeenLastCalledWith(null, null);
    w.stop();

    const no = watcher([pulse()], { allowed: () => false });
    no.w.start();
    await no.w.refresh();
    expect(no.deps.get).not.toHaveBeenCalled();
    expect(no.w.get()).toBeNull();
    no.w.stop();
  });

  it('is asked again when poked (wake, apps changed), but not while stopped', async () => {
    const { w, deps } = watcher([pulse()]);
    w.poke();
    expect(deps.get).not.toHaveBeenCalled();
    w.start();
    await w.refresh();
    w.poke();
    await w.refresh();
    expect((deps.get as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    w.stop();
  });
});

describe('callback reminders to the minute (MKT-CAL-12)', () => {
  const T0 = Date.UTC(2026, 9, 6, 8, 0, 0);
  const cb = (over: Partial<CallbackItem> = {}): CallbackItem => ({
    queue_id: 5, at: '2026-10-06 08:30:00', contact_id: 77, name: 'Iresha Dias', phone: '+94 77 123 4567', campaign_id: 3, campaign: 'Vendor follow-up calls',
    assignee: { id: 9, name: 'Sanduni' }, notes: 'Call after 2 pm', ...over,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  function reminders(lists: Array<CallbackItem[] | Error>, over: Partial<CallbackRemindersDeps> = {}) {
    let i = 0;
    const deps = {
      get: vi.fn(async () => {
        const l = lists[Math.min(i++, lists.length - 1)]!;
        if (l instanceof Error) throw l;
        return { items: l, all: false };
      }) as unknown as CallbackRemindersDeps['get'],
      notify: vi.fn(),
      allowed: vi.fn(() => true),
      every: 3_600_000,
      sweepEvery: 3_600_000,
      ...over,
    };
    return { r: new CallbackReminders(deps), deps };
  }

  it('reads the server’s stamps as UTC, and words the banner as the design does', () => {
    expect(utcMs('2026-10-06 08:30:00')).toBe(Date.UTC(2026, 9, 6, 8, 30));
    expect(utcMs('2026-10-06T08:30:00+05:30')).toBe(Date.UTC(2026, 9, 6, 3, 0));
    expect(Number.isNaN(utcMs('soon'))).toBe(true);
    const n = callbackNotice(cb(), { nonce: 1234 });
    expect(n).toMatchObject({
      id: 'callback:5:2026-10-06 08:30:00',
      module: 'marketing',
      category: 'marketing',
      title: 'Callback due · Iresha Dias',
      body: 'Vendor follow-up calls · “Call after 2 pm”',
      link: '/marketing?view=queue&tab=work&claim=1234&call=3',
      critical: false,
      callback: { queueId: 5, at: '2026-10-06 08:30:00' },
    });
    expect(callbackNotice(cb({ notes: null }), { nonce: 1, snooze: 2 })).toMatchObject({ id: 'callback:5:2026-10-06 08:30:00:s2', body: 'Vendor follow-up calls' });
  });

  it('rings once, at the minute promised — not before, and not again', async () => {
    const { r, deps } = reminders([[cb()]]);
    r.start();
    await r.refresh();
    expect(deps.get).toHaveBeenCalledWith('/api/marketing/calls/callbacks');
    expect(r.pending()).toEqual([{ queueId: 5, at: '2026-10-06 08:30:00', due: Date.UTC(2026, 9, 6, 8, 30), snooze: 0 }]);
    await vi.advanceTimersByTimeAsync(29 * 60_000 + 59_000);
    expect(deps.notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ id: 'callback:5:2026-10-06 08:30:00', title: 'Callback due · Iresha Dias' }));
    await r.refresh();
    r.sweep();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('rings one missed a little (asleep) at once, but not one missed by more than an hour', async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 6, 8, 40));
    const { r, deps } = reminders([[cb(), cb({ queue_id: 6, at: '2026-10-06 06:00:00' })]]);
    r.start();
    await r.refresh();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ id: 'callback:5:2026-10-06 08:30:00' }));
    expect(LATE_MS).toBe(60 * 60_000);
    r.stop();
  });

  it('forgets a callback made or moved before it rang, and rings a moved one at its new time', async () => {
    const { r, deps } = reminders([[cb()], [cb({ at: '2026-10-06 09:15:00' })]]);
    r.start();
    await r.refresh();
    await r.refresh();
    expect(r.pending().map((p) => p.at)).toEqual(['2026-10-06 09:15:00']);
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(deps.notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(45 * 60_000);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ id: 'callback:5:2026-10-06 09:15:00' }));
    r.stop();
  });

  it('never sets a timer further ahead than ten minutes, and the sweep catches what a timer missed', async () => {
    const { r, deps } = reminders([[cb({ at: '2026-10-06 11:00:00' })]]);
    r.start();
    await r.refresh();
    // The clock jumps (the computer slept): the sweep rings it.
    vi.setSystemTime(Date.UTC(2026, 9, 6, 11, 0, 5));
    r.sweep();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('snoozes 15 minutes on this computer, as a banner of its own', async () => {
    const { r, deps } = reminders([[cb()]]);
    r.start();
    await r.refresh();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    r.snooze({ queueId: 5, at: '2026-10-06 08:30:00' });
    await vi.advanceTimersByTimeAsync(SNOOZE_MS - 1_000);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.notify).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'callback:5:2026-10-06 08:30:00:s1' }));
    r.snooze({ queueId: 5, at: '2026-10-06 08:30:00' });
    await vi.advanceTimersByTimeAsync(SNOOZE_MS);
    expect(deps.notify).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'callback:5:2026-10-06 08:30:00:s2' }));
    r.stop();
  });

  it('says nothing without Marketing, clears on a refusal, keeps its timers offline, and stops with the session', async () => {
    const off = reminders([[cb({ at: '2026-10-06 08:00:00' })]], { allowed: () => false });
    off.r.start();
    await off.r.refresh();
    expect(off.deps.get).not.toHaveBeenCalled();
    expect(off.deps.notify).not.toHaveBeenCalled();
    off.r.stop();

    const net = reminders([[cb()], Object.assign(new Error('offline'), { code: 'NETWORK_UNREACHABLE' }), Object.assign(new Error('no'), { status: 403 })]);
    net.r.start();
    await net.r.refresh();
    await net.r.refresh();
    expect(net.r.pending()).toHaveLength(1);
    await net.r.refresh();
    expect(net.r.pending()).toHaveLength(0);
    net.r.stop();

    const stopped = reminders([[cb()]]);
    stopped.r.start();
    await stopped.r.refresh();
    stopped.r.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(stopped.deps.notify).not.toHaveBeenCalled();
  });

  it('sets its timers again on waking', async () => {
    const { r, deps } = reminders([[cb()]]);
    r.start();
    await r.refresh();
    vi.setSystemTime(Date.UTC(2026, 9, 6, 8, 31));
    r.resume();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    r.stop();
  });
});

describe('a callback banner (MKT-CAL-12)', () => {
  beforeEach(() => {
    notes.length = 0;
  });

  function setup(over: Partial<Preferences> = {}) {
    const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: false, dndEnabled: false, ...over } as unknown as Preferences;
    const http = { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})), request: vi.fn(async () => ({})) };
    const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
    const service = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, http as unknown as HttpClient, () => prefs);
    service.onClick = vi.fn();
    service.snoozeCallback = vi.fn();
    return { service, prefs, http };
  }
  const notice = () => callbackNotice({ queue_id: 5, at: '2026-10-06 08:30:00', contact_id: 77, name: 'Iresha Dias', phone: null, campaign_id: 3, campaign: 'Vendor follow-up calls', assignee: null, notes: 'Call after 2 pm' }, { nonce: 99 });

  it('offers Call now and Snooze 15 min; Call now opens the workspace on the callback’s campaign', () => {
    const { service } = setup();
    service.notify(notice());
    service.notify(notice());
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({
      title: 'Callback due · Iresha Dias',
      body: 'Vendor follow-up calls · “Call after 2 pm”',
      actions: [
        { type: 'button', text: 'Call now' },
        { type: 'button', text: 'Snooze 15 min' },
      ],
    });
    notes[0]!.events.action!({}, 0);
    expect(service.onClick).toHaveBeenCalledWith('/marketing?view=queue&tab=work&claim=99&call=3', 'marketing');
    expect(service.snoozeCallback).not.toHaveBeenCalled();
  });

  it('snoozes on this computer; a click opens the link as any banner does', () => {
    const { service, http } = setup();
    service.notify(notice());
    notes[0]!.events.action!({}, 1);
    expect(service.snoozeCallback).toHaveBeenCalledWith({ queueId: 5, at: '2026-10-06 08:30:00' });
    expect(http.post).not.toHaveBeenCalled();
    notes[0]!.events.click!();
    expect(service.onClick).toHaveBeenCalledWith('/marketing?view=queue&tab=work&claim=99&call=3', 'marketing');
  });

  it('has no buttons when banners hide their content, and acts on nothing from behind the lock', () => {
    const sender = setup({ notificationPrivacy: 'SENDER_ONLY' } as Partial<Preferences>);
    sender.service.notify(notice());
    expect(notes[0]!.options).toMatchObject({ title: 'Marketing', actions: undefined });
    notes.length = 0;
    const locked = setup();
    locked.service.isLocked = () => true;
    locked.service.notify(notice());
    expect(notes[0]!.options).toMatchObject({ title: 'WorkSuite', actions: undefined });
    notes[0]!.events.action!({}, 1);
    expect(locked.service.snoozeCallback).not.toHaveBeenCalled();
    expect(locked.service.onClick).toHaveBeenCalled();
  });

  it('is silenced by the Marketing switch, and by an app the person no longer has', () => {
    const muted = setup({ moduleNotifications: { marketing: false } } as Partial<Preferences>);
    muted.service.notify(notice());
    expect(notes).toHaveLength(0);
    const gone = setup();
    gone.service.moduleEnabled = () => false;
    gone.service.notify(notice());
    expect(notes).toHaveLength(0);
  });

  it('lets a campaign notice from the server through, under Marketing', () => {
    const { service } = setup();
    service.handleRealtime({ type: 'notification', id: 81, event: 'marketing.campaign.paused', category: 'marketing', title: '“Vendor re-permission” paused', body: 'Bounce guard reached 5.3%. Review before resuming.', link: '/marketing?view=campaigns&campaign=12' });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({ title: '“Vendor re-permission” paused', body: 'Bounce guard reached 5.3%. Review before resuming.' });
    notes[0]!.events.click!();
    expect(service.onClick).toHaveBeenCalledWith('/marketing?view=campaigns&campaign=12', 'marketing');
  });
});
