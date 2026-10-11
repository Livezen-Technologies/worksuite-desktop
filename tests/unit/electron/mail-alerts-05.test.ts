import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void>; closed: boolean }>);
vi.mock('electron', () => ({
  app: { isPackaged: false },
  nativeImage: { createFromPath: () => ({}) },
  Notification: class {
    static isSupported = () => true;
    static remove = () => undefined;
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
      if (this.entry.closed) return;
      this.entry.closed = true;
      this.entry.events.close?.();
    }
  },
}));

import { MailAlertService, type MailAlertHost } from '../../../electron/services/mail-alerts';
import { NotificationService } from '../../../electron/services/notifications';
import { MAIL_PAUSE_NOTE, trayMailItems, trayMailTooltip, type TrayMail } from '../../../electron/tray/tray';
import {
  decide,
  effectivePreview,
  groupKind,
  includedUnread,
  inWorkingHours,
  listedArrival,
  nativeContent,
  parseArrival,
  pausedNow,
  startPause,
  trayAccounts,
  workingHoursOf,
  type DeviceView,
  type MailPause,
} from '../../../shared/mail-alerts';
import { attentionCount } from '../../../shared/network';
import { resolveWebLink } from '../../../shared/links';
import type { Preferences } from '../../../shared/types';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';

/**
 * New-mail alerts on the desktop (ENH-MAIL-05): where an alert goes, once per message, grouped, private, paused,
 * withdrawn, answered — and the tray's and the badge's mail.
 */

const T0 = new Date('2026-10-12T10:00:00');

function event(over: Record<string, unknown> = {}) {
  return {
    type: 'mail',
    event: 'mail.received',
    mailbox_id: 3,
    account_label: 'Hasarinda · WorkSuite',
    message_id: 41,
    conversation_key: 'c-41',
    from_name: 'Dinesh Perera',
    from_addr: 'dinesh@example.lk',
    subject: 'Q4 budget — need your numbers by 3 pm',
    preview: 'Hi Hasarinda, can you send the hosting and licence lines for Q4 before the board call?',
    importance: 'high',
    attachments: 1,
    verdict: 'clean',
    link: '/mail/m/3/41',
    ...over,
  };
}

interface Rig {
  service: MailAlertService;
  host: MailAlertHost & { sent: Array<[string, unknown]>; opened: string[]; drafts: Array<[string, unknown]>; submitted: unknown[] };
  http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> };
  prefs: Preferences;
  win: { visible: boolean; focused: boolean };
  flags: { osDnd: boolean; appQuiet: boolean; sharing: boolean; locked: boolean; min: 'full' | 'sender' | 'hidden' | null };
}

function rig(over: Partial<Preferences> = {}, platform: NodeJS.Platform = 'win32', serverPrefs: Record<string, unknown> | null = null): Rig {
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true, realtime: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: true, dndEnabled: false, language: 'en', ...over } as unknown as Preferences;
  const win = { visible: false, focused: false };
  const flags = { osDnd: false, appQuiet: false, sharing: false, locked: false, min: null as 'full' | 'sender' | 'hidden' | null };
  const http = {
    get: vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/mail/mailboxes')
        return { mailboxes: [{ id: 3, display_name: 'Hasarinda · WorkSuite', unread: 2 }, { id: 5, display_name: 'Sales · shared', unread: 3, in_unified: true }, { id: 7, display_name: 'Personal · Gmail', unread: 4, auth_state: 'problem' }, { id: 9, display_name: 'Archive box', unread: 50, in_unified: false }] };
      if (path === '/api/mail/alerts/prefs') {
        if (serverPrefs) return serverPrefs;
        throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
      }
      if (path === '/api/hr/schedules/effective') return { resolved: { day_start: '08:30', day_end: '17:30', work_days: [1, 2, 3, 4, 5] } };
      if (path.startsWith('/api/mail/messages/')) return { message_id: '<m41@example.lk>', from_email: 'dinesh@example.lk', subject: 'Q4 budget — need your numbers by 3 pm' };
      return {};
    }),
    post: vi.fn(async () => ({})),
    request: vi.fn(async () => ({ summary: { count: 0 } })),
  };
  const host = {
    sent: [] as Array<[string, unknown]>,
    opened: [] as string[],
    drafts: [] as Array<[string, unknown]>,
    submitted: [] as unknown[],
    prefs: () => prefs,
    userId: () => '12',
    deviceId: () => 'install-1',
    appVersion: () => '0.2.234',
    window: () => win,
    osDnd: () => flags.osDnd,
    appQuiet: () => flags.appQuiet,
    locked: () => flags.locked,
    sharing: () => flags.sharing,
    mailAllowed: () => true,
    policyMinPreview: () => flags.min,
    send(channel: string, payload: unknown) {
      host.sent.push([channel, payload]);
    },
    open(route: string) {
      host.opened.push(route);
    },
    submit: vi.fn(async (input: unknown) => {
      host.submitted.push(input);
      return { delivered: true, queued: false, id: null, status: 200, data: null, error: null };
    }),
    saveDraft(context: string, content: unknown) {
      host.drafts.push([context, content]);
    },
    savePause(uid: string, pause: MailPause | null) {
      const all = { ...(prefs.mailAlertPause ?? {}) };
      if (pause) all[uid] = pause;
      else delete all[uid];
      prefs.mailAlertPause = all;
    },
    changed: vi.fn(),
  };
  const service = new MailAlertService(http as unknown as HttpClient, host as unknown as MailAlertHost, platform);
  return { service, host: host as unknown as Rig['host'], http, prefs, win, flags };
}

const cards = (r: Rig) => r.host.sent.filter(([c]) => c === 'mail-alert:show').map(([, p]) => p as { card: { id: string; kind: string; title: string; rows: Array<{ key: string; subject: string | null; preview: string | null; sender: string }>; more: number }; sound: boolean });
const sounding = () => notes.filter((n) => n.options.silent === false);
const open = () => notes.filter((n) => !n.closed);

beforeEach(() => {
  notes.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('where an alert goes (Section 3.1, MNA-EVT-05)', () => {
  const view = (o: Partial<DeviceView>): DeviceView => ({ visible: true, focused: true, module: 'files', mail: null, ...o });
  const a = { mailbox: 3, folder: 'inbox' };
  const calm = { paused: false, dnd: false };

  it('decides by what this computer shows', () => {
    expect(decide(view({ module: 'mail', mail: { box: '3', folder: 'inbox' } }), calm, a)).toBe('list');
    expect(decide(view({ module: 'mail', mail: { box: 'unified', folder: 'inbox' } }), calm, a)).toBe('list');
    // Mail in front, but another folder or another account: a card.
    expect(decide(view({ module: 'mail', mail: { box: '3', folder: 'sent' } }), calm, a)).toBe('card');
    expect(decide(view({ module: 'mail', mail: { box: '5', folder: 'inbox' } }), calm, a)).toBe('card');
    expect(decide(view({ module: 'files' }), calm, a)).toBe('card');
    // Not focused, minimised or in the tray: the system's notification.
    expect(decide(view({ focused: false }), calm, a)).toBe('native');
    expect(decide(view({ visible: false, focused: false }), calm, a)).toBe('native');
    // Paused, or the system's Focus: the badge and the bell only — but the row still comes into a folder in front.
    expect(decide(view({ focused: false }), { paused: true, dnd: false }, a)).toBe('quiet');
    expect(decide(view({}), { paused: false, dnd: true }, a)).toBe('quiet');
    expect(decide(view({ module: 'mail', mail: { box: '3', folder: 'inbox' } }), { paused: true, dnd: false }, a)).toBe('list');
  });

  it('shows the in-app card and no native notification while WorkSuite is in front in Files (AC-MNA-02)', async () => {
    const r = rig();
    r.win.visible = r.win.focused = true;
    r.service.setPlace({ module: 'files', box: null, folder: null });
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(0);
    expect(cards(r)).toHaveLength(1);
    expect(cards(r)[0]!.card).toMatchObject({ kind: 'single', title: 'Dinesh Perera', high: true, replyable: true });
  });

  it('shows the system notification while minimised (AC-MNA-01), and nothing but the row in the folder in front', async () => {
    const r = rig();
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(1);
    expect(cards(r)).toHaveLength(0);

    const inMail = rig();
    inMail.win.visible = inMail.win.focused = true;
    inMail.service.setPlace({ module: 'mail', box: '3', folder: 'inbox' });
    notes.length = 0;
    inMail.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(0);
    expect(cards(inMail)).toHaveLength(0);
    expect(inMail.host.sent).toContainEqual(['mail-alert:list', { keys: ['3:inbox:41'] }]);
  });

  it('keeps quiet during the system’s Focus or WorkSuite’s quiet hours: no pop-up, no sound', async () => {
    const r = rig();
    r.flags.osDnd = true;
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    r.flags.osDnd = false;
    r.flags.appQuiet = true;
    r.service.handleRealtime(event({ message_id: 42 }));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(0);
    expect(cards(r)).toHaveLength(0);
  });
});

describe('one alert per message per device (NFR-MNA-03)', () => {
  it('alerts once for a message heard of by the push, the bell and the count going up', async () => {
    const r = rig();
    r.service.handleRealtime(event());
    r.service.handleRealtime({ type: 'notification', id: 901, event: 'mail.received', title: 'New email from Dinesh Perera', link: '/mail/m/3/41', data: event() });
    r.service.ingestListed([listedArrival({ id: 41, is_read: false, mailbox: { id: 3 }, folder_slug: 'inbox', from_name: 'Dinesh Perera', from_email: 'dinesh@example.lk', subject: 'Q4 budget', created_at: new Date(T0.getTime() - 60_000).toISOString() }, T0.getTime())!], false);
    await vi.advanceTimersByTimeAsync(2_100);
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(1);
    expect(r.service.claim({ event: 'mail.received' })).toBe(true);
    expect(r.service.claim({ event: 'task.assigned' })).toBe(false);
  });

  it('never alerts for spam, quarantined, rejected or still-checking mail (MNA-EVT-02)', () => {
    for (const verdict of ['spam', 'quarantined', 'rejected', 'checking', 'malware']) expect(parseArrival(event({ verdict }))).toBeNull();
    expect(parseArrival(event({ verdict: 'bulk' }))?.verdict).toBe('bulk');
    expect(parseArrival(event({ verdict: undefined }))?.verdict).toBe('unknown');
  });

  it('replaces the conversation’s alert with its newest message (tag per conversation, a group per account)', async () => {
    const r = rig();
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(15_000);
    r.service.handleRealtime(event({ message_id: 44, subject: 'Re: Q4 budget' }));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(2);
    expect(notes[0]!.closed).toBe(true);
    expect(notes[1]!.options).toMatchObject({ id: 'mail-conv:3:c-41', groupId: 'mail-account-3', groupTitle: 'Hasarinda · WorkSuite' });
  });
});

describe('grouping and volume (MNA-GRP, WF-N04)', () => {
  const six = [
    { message_id: 1, mailbox_id: 3, account_label: 'Hasarinda · WorkSuite', conversation_key: 'a' },
    { message_id: 2, mailbox_id: 5, account_label: 'Sales · shared', conversation_key: 'b' },
    { message_id: 3, mailbox_id: 5, account_label: 'Sales · shared', conversation_key: 'c' },
    { message_id: 4, mailbox_id: 6, account_label: 'Hasarinda · M365', conversation_key: 'd' },
    { message_id: 5, mailbox_id: 3, account_label: 'Hasarinda · WorkSuite', conversation_key: 'e' },
    { message_id: 6, mailbox_id: 6, account_label: 'Hasarinda · M365', conversation_key: 'f' },
  ];

  it('6 emails in 30 s across 3 accounts make one grouped alert and one sound (AC-MNA-05)', async () => {
    const r = rig();
    for (const [i, e] of six.entries()) {
      r.service.handleRealtime(event(e));
      await vi.advanceTimersByTimeAsync(i === 5 ? 2_100 : 5_000);
    }
    expect(open()).toHaveLength(1);
    expect(open()[0]!.options.title).toBe('6 new emails · 3 accounts');
    expect(String(open()[0]!.options.body).split('\n')).toHaveLength(6);
    expect(String(open()[0]!.options.body)).toContain('and 1 more');
    expect(sounding()).toHaveLength(1);
  });

  it('a burst inside the two seconds is one alert from the start', async () => {
    const r = rig();
    for (const e of six) r.service.handleRealtime(event(e));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(1);
    expect(sounding()).toHaveLength(1);
    expect(notes[0]!.options.actions).toEqual([{ type: 'button', text: 'Open Inbox' }, { type: 'button', text: 'Mark all as read' }]);
  });

  it('more than three in one account is that account’s alert, with two senders and “and N more” (MNA-GRP-02)', async () => {
    const r = rig();
    r.win.visible = r.win.focused = true;
    for (let i = 1; i <= 4; i++) r.service.handleRealtime(event({ message_id: 100 + i, mailbox_id: 5, account_label: 'Sales · shared', conversation_key: `s${i}`, from_name: `Sender ${i}` }));
    await vi.advanceTimersByTimeAsync(2_100);
    const c = cards(r).at(-1)!.card;
    expect(c).toMatchObject({ kind: 'account', title: '4 new emails in Sales · shared', more: 2 });
    expect(c.rows).toHaveLength(2);
    expect(groupKind([{ mailbox: 1 }, { mailbox: 1 }, { mailbox: 1 }])).toBe('single');
  });

  it('sounds at most once in ten seconds (MNA-GRP-04)', async () => {
    const r = rig();
    r.service.handleRealtime(event({ message_id: 1, conversation_key: 'x' }));
    await vi.advanceTimersByTimeAsync(4_000);
    r.service.handleRealtime(event({ message_id: 2, conversation_key: 'y' }));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes.map((n) => n.options.silent)).toEqual([false, true]);
    await vi.advanceTimersByTimeAsync(70_000);
    r.service.handleRealtime(event({ message_id: 3, conversation_key: 'z' }));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes[2]!.options.silent).toBe(false);
  });

  it('is silent when Mail sound is off', async () => {
    const r = rig({ mailAlertSound: false });
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes[0]!.options.silent).toBe(true);
  });
});

describe('first sync, re-sync, backfill and imports never alert (MNA-GRP-03, AC-MNA-12)', () => {
  it('drops events from an import, a first sync or a backfill', () => {
    for (const flag of [{ source: 'import' }, { source: 'initial' }, { source: 'backfill' }, { source: 'resync' }, { initial: true }, { import: true }]) expect(parseArrival(event(flag))).toBeNull();
  });

  it('remembers what the count found during an import, and does not alert for it later', async () => {
    const r = rig();
    const rows = Array.from({ length: 10 }, (_, i) => listedArrival({ id: 500 + i, is_read: false, mailbox: { id: 3 }, folder_slug: 'inbox', from_email: `x${i}@example.lk`, subject: `Imported ${i}`, created_at: new Date(T0.getTime() - 120_000).toISOString() }, T0.getTime())!);
    r.service.ingestListed(rows, true);
    r.service.handleRealtime(event({ message_id: 503 }));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(0);
  });

  it('a jump the size of an import is quiet; old mail found later is a backfill', async () => {
    const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: false, dndEnabled: false, language: 'en' } as unknown as Preferences;
    let count = 10;
    const http = {
      get: vi.fn(async (path: string) => (path === '/api/mail/unread' ? { count } : path === '/api/mail/messages' ? { messages: [{ id: 7, is_read: false, mailbox: { id: 3 }, folder_slug: 'inbox', subject: 'x', created_at: new Date(T0.getTime() - 120_000).toISOString() }] } : {})),
      post: vi.fn(async () => ({})),
      request: vi.fn(async () => ({})),
    };
    const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
    const n = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, http as unknown as HttpClient, () => prefs);
    const got: Array<{ rows: number; quiet: boolean }> = [];
    n.mailArrivals = (rows, quiet) => got.push({ rows: rows.length, quiet });
    const poll = (first: boolean) => (n as unknown as { pollMail: (f: boolean) => Promise<void> }).pollMail(first);
    await poll(true);
    count += 2_000;
    await poll(false);
    count += 1;
    await poll(false);
    expect(got).toEqual([{ rows: 1, quiet: true }, { rows: 1, quiet: false }]);
    // The poll's own banner is not shown as well: the new-mail alerts have it.
    expect(notes).toHaveLength(0);
    expect(listedArrival({ id: 8, is_read: false, created_at: new Date(T0.getTime() - 2 * 3_600_000).toISOString() }, T0.getTime())).toBeNull();
  });
});

describe('pausing and the resume summary (MNA-TRY-02/04, AC-MNA-09)', () => {
  it('pauses for an hour: no pop-ups or sounds, counts still move, and one summary at the end', async () => {
    const r = rig();
    r.service.start();
    await vi.advanceTimersByTimeAsync(10);
    const state = await r.service.pause('1h', new Date());
    expect(state).toMatchObject({ paused: true, pauseLabel: 'Paused until 11:00' });
    expect(r.http.request).toHaveBeenCalledWith('PUT', '/api/mail/alerts/pause', { body: { mode: '1h' } });
    for (let i = 1; i <= 12; i++) r.service.handleRealtime(event({ message_id: 700 + i, conversation_key: `p${i}` }));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(0);
    r.service.handleRealtime({ type: 'mail', event: 'mail.counts', mailbox: 3 });
    const before = r.http.get.mock.calls.filter(([p]) => p === '/api/mail/mailboxes').length;
    await vi.advanceTimersByTimeAsync(3_100);
    expect(r.http.get.mock.calls.filter(([p]) => p === '/api/mail/mailboxes').length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({ title: 'While alerts were paused: 12 new emails', silent: true });
    expect(r.service.state().pause).toBeNull();
    r.service.stop();
  });

  it('resumes by hand with one summary, counting what the server knew too', async () => {
    const r = rig();
    r.win.visible = r.win.focused = true;
    await r.service.pause('manual');
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    r.http.request.mockResolvedValueOnce({ summary: { count: 3 } });
    await r.service.pause(null);
    const c = cards(r);
    expect(c).toHaveLength(1);
    expect(c[0]!.card).toMatchObject({ kind: 'summary', title: 'While alerts were paused: 3 new emails' });
    expect(r.http.request).toHaveBeenLastCalledWith('PUT', '/api/mail/alerts/pause', { body: { mode: 'off' } });
  });

  it('works out the pauses, and outside working hours from HR’s schedule', () => {
    const hours = workingHoursOf({ resolved: { day_start: '08:30', day_end: '17:30', work_days: [1, 2, 3, 4, 5] } })!;
    expect(hours).toEqual({ start: '08:30', end: '17:30', days: [1, 2, 3, 4, 5] });
    expect(workingHoursOf({ resolved: { day_start: null } })).toBeNull();
    const monday10 = new Date('2026-10-12T10:00:00');
    const monday19 = new Date('2026-10-12T19:00:00');
    const saturday10 = new Date('2026-10-17T10:00:00');
    expect(inWorkingHours(hours, monday10)).toBe(true);
    expect(inWorkingHours(hours, monday19)).toBe(false);
    expect(inWorkingHours(hours, saturday10)).toBe(false);
    const outside = startPause('outside_hours', monday10, hours)!;
    expect(pausedNow(outside, monday10, hours)).toBe(false);
    expect(pausedNow(outside, monday19, hours)).toBe(true);
    expect(startPause('outside_hours', monday10, null)).toBeNull();
    const tomorrow = startPause('tomorrow', monday19, hours)!;
    expect(new Date(tomorrow.until!).getHours()).toBe(8);
    expect(pausedNow(tomorrow, new Date('2026-10-13T07:59:00'), hours)).toBe(true);
    expect(pausedNow(tomorrow, new Date('2026-10-13T08:00:00'), hours)).toBe(false);
  });
});

describe('withdrawal (MNA-EVT-06, WF-N06, AC-MNA-07)', () => {
  it('closes the notification when the message is read elsewhere, and recounts', async () => {
    const r = rig();
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(open()).toHaveLength(1);
    r.service.handleRealtime({ type: 'mail', event: 'mail.alert_cleared', mailbox_id: 3, message_ids: [41], reason: 'read' });
    expect(open()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(r.http.get).toHaveBeenCalledWith('/api/mail/mailboxes');
  });

  it('takes a card away, a group’s row out, and never alerts for one cleared before its two seconds were up', async () => {
    const r = rig();
    r.win.visible = r.win.focused = true;
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    const id = cards(r)[0]!.card.id;
    r.service.handleRealtime({ type: 'mail', event: 'mail.alert_cleared', mailbox_id: 3, message_ids: [41], reason: 'archived' });
    expect(r.host.sent).toContainEqual(['mail-alert:clear', { ids: [id] }]);

    for (let i = 1; i <= 4; i++) r.service.handleRealtime(event({ message_id: 200 + i, mailbox_id: 5, conversation_key: `g${i}` }));
    await vi.advanceTimersByTimeAsync(2_100);
    r.service.handleRealtime({ type: 'mail', event: 'mail.alert_cleared', mailbox_id: 5, message_ids: [201], reason: 'moved' });
    const update = cards(r).at(-1)!;
    expect(update.card.rows.map((x) => x.key)).not.toContain('5:inbox:201');
    expect(update.sound).toBe(false);

    r.service.handleRealtime(event({ message_id: 300, conversation_key: 'late' }));
    r.service.seenHere({ mailbox: 3, folder: 'inbox', uid: 300 });
    const n = cards(r).length;
    await vi.advanceTimersByTimeAsync(2_100);
    expect(cards(r)).toHaveLength(n);
  });

  it('marks read, archives and flags from the notification, and the alert goes', async () => {
    const r = rig();
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes[0]!.options.actions).toEqual([{ type: 'button', text: 'Mark as read' }, { type: 'button', text: 'Archive' }, { type: 'button', text: 'Flag' }]);
    notes[0]!.events.action!({}, 1);
    await vi.waitFor(() => expect(r.http.post).toHaveBeenCalledWith('/api/mail/messages/41/action', { action: 'archive', folder: 'inbox', mailbox: 3 }));
    await vi.waitFor(() => expect(notes[0]!.closed).toBe(true));
  });

  it('opens the exact message, with its account and folder, from a click (MNA-WIN-05, AC-MNA-11)', async () => {
    const r = rig();
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    notes[0]!.events.click!();
    expect(r.host.opened).toEqual(['/mail?box=3&folder=inbox&msg=41&mbx=3']);
  });
});

describe('privacy (MNA-PRV, AC-MNA-08)', () => {
  it('Hidden writes nothing of the message to the system notification', async () => {
    const r = rig({ mailAlertPreview: 'hidden' });
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    const o = notes[0]!.options;
    expect(o).toMatchObject({ title: 'WorkSuite Mail', body: 'New email in Hasarinda · WorkSuite', hasReply: false });
    const all = JSON.stringify(o);
    for (const secret of ['Dinesh', 'Q4 budget', 'hosting', 'dinesh@example.lk']) expect(all).not.toContain(secret);
    expect(o.actions).toBeUndefined();
  });

  it('hides previews while the screen is shared, for the organisation’s minimum, and while locked', async () => {
    const r = rig();
    r.flags.sharing = true;
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes[0]!.options.body).toBe('New email in Hasarinda · WorkSuite');

    const org = rig({}, 'win32', { preview_level: 'full', min_preview_level: 'sender', sound: true });
    org.service.start();
    await vi.advanceTimersByTimeAsync(10);
    org.service.handleRealtime(event({ message_id: 77, conversation_key: 'o' }));
    await vi.advanceTimersByTimeAsync(2_100);
    const shown = notes.at(-1)!.options;
    expect(shown.title).toBe('Dinesh Perera');
    expect(String(shown.body)).not.toContain('Q4 budget');
    expect(org.service.state().minPreview).toBe('sender');
    org.service.stop();

    expect(effectivePreview('full', null, { sharing: false, locked: true })).toBe('hidden');
    expect(effectivePreview('full', 'hidden', { sharing: false, locked: false })).toBe('hidden');
    expect(effectivePreview('sender', 'full', { sharing: false, locked: false })).toBe('sender');
  });

  it('never shows a confidential message’s preview', () => {
    const a = parseArrival(event({ confidential: true }))!;
    expect(a.preview).toBe('');
    expect(nativeContent(a, 'full', 'win32').body).not.toContain('hosting');
  });

  it('shows the full content: account, sender, subject, two lines of preview, importance, attachments and Checked (MNA-WIN-02)', () => {
    const a = parseArrival(event())!;
    const win = nativeContent(a, 'full', 'win32');
    expect(win.title).toBe('Dinesh Perera');
    expect(win.body.split('\n')).toEqual(['High importance · Q4 budget — need your numbers by 3 pm', 'Hi Hasarinda, can you send the hosting and licence lines for Q4 before the board call?', 'WorkSuite Mail · Hasarinda · WorkSuite · Checked · 1 attachment']);
    expect(nativeContent(a, 'full', 'darwin').subtitle).toBe('WorkSuite Mail · Hasarinda · WorkSuite');
  });
});

describe('inline reply through the send path (MNA-WIN-04, AC-MNA-01)', () => {
  it('sends “Sending them in 10 minutes.” after the undo window, through Mail’s send, then marks the message read', async () => {
    const r = rig({}, 'darwin');
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes[0]!.options).toMatchObject({ hasReply: true, replyPlaceholder: 'Reply to Dinesh Perera' });
    notes[0]!.events.reply!({ reply: 'Sending them in 10 minutes.' });
    await vi.advanceTimersByTimeAsync(10);
    expect(r.host.submitted).toHaveLength(0);
    expect(notes[1]!.options).toMatchObject({ title: 'Sending your reply to Dinesh Perera', silent: true, actions: [{ type: 'button', text: 'Undo' }] });
    await vi.advanceTimersByTimeAsync(8_100);
    expect(r.host.submitted[0]).toMatchObject({
      module: 'mail',
      entity: 'message.send',
      method: 'POST',
      path: '/api/mail/send',
      queueIfOffline: true,
      body: { to: ['dinesh@example.lk'], subject: 'Re: Q4 budget — need your numbers by 3 pm', body_text: 'Sending them in 10 minutes.', body_html: '<div>Sending them in 10 minutes.</div>', in_reply_to: '<m41@example.lk>', reply_mode: 'reply', mailbox: '3' },
    });
    await vi.waitFor(() => expect(r.http.post).toHaveBeenCalledWith('/api/mail/messages/41/action', { action: 'read', folder: 'inbox', mailbox: 3 }));
    expect(notes[0]!.closed).toBe(true);
  });

  it('a refused reply becomes the reply’s draft, and a “not sent” notification opens it', async () => {
    const r = rig({}, 'win32');
    vi.mocked(r.host.submit).mockResolvedValueOnce({ delivered: false, queued: false, id: null, status: 422, data: null, error: 'Sending is paused for this mailbox.', code: 'REFUSED' });
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    notes[0]!.events.reply!({ reply: 'On it.' });
    await vi.advanceTimersByTimeAsync(8_100);
    await vi.waitFor(() => expect(notes.some((n) => n.options.title === 'Your reply to Dinesh Perera was not sent')).toBe(true));
    const failed = notes.find((n) => n.options.title === 'Your reply to Dinesh Perera was not sent')!;
    expect(failed.options.actions).toEqual([{ type: 'button', text: 'Open draft' }]);
    expect(r.host.drafts[0]).toEqual(['compose:reply:<m41@example.lk>', expect.objectContaining({ to: 'dinesh@example.lk', subject: 'Re: Q4 budget — need your numbers by 3 pm', html: '<div>On it.</div>', from: '3' })]);
    failed.events.action!({}, 0);
    expect(r.host.opened.at(-1)).toBe('/mail?box=3&folder=inbox&msg=41&mbx=3&reply=1');
  });

  it('Undo inside the window keeps the words as a draft and sends nothing', async () => {
    const r = rig();
    r.win.visible = r.win.focused = true;
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    const card = cards(r)[0]!.card;
    const res = await r.service.action({ id: card.id, key: '3:inbox:41', action: 'reply', text: 'Will do' });
    expect(res.sending?.id).toBeTruthy();
    expect((await r.service.action({ id: res.sending!.id, action: 'undo' })).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(r.host.submitted).toHaveLength(0);
    expect(r.host.drafts).toHaveLength(1);
  });

  it('offers no inline reply on Linux: a click opens the message', async () => {
    const r = rig({}, 'linux');
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes[0]!.options.hasReply).toBe(false);
    expect(notes[0]!.options.actions).toBeUndefined();
  });
});

describe('the badge and the tray (MNA-TRY-01/03, D28)', () => {
  it('counts the unread of the included inboxes, once', async () => {
    const r = rig();
    await r.service.refreshCounts();
    expect(r.service.unread()).toBe(9);
    expect(includedUnread(trayAccounts({ mailboxes: [{ id: 1, unread: 2 }, { id: 2, unread: 5, in_unified: false }, { id: 3, unread: 1, archived: true }] }))).toBe(2);
    // Chat 2, the bell 4 of which 3 are "New email" entries, mail 6: 2 + 1 + 6.
    expect(attentionCount(2, 4, 0, 0, 6, 3)).toBe(9);
    expect(attentionCount(2, 4)).toBe(6);
  });

  const mail = (o: Partial<TrayMail> = {}): TrayMail => ({
    accounts: [
      { id: 3, label: 'Hasarinda · WorkSuite', unread: 2, problem: false },
      { id: 5, label: 'Sales · shared', unread: 3, problem: false },
      { id: 7, label: 'Personal · Gmail', unread: 0, problem: true },
    ],
    unread: 5,
    paused: false,
    pauseLabel: null,
    pauseSet: false,
    choices: [
      { mode: '1h', label: 'For 1 hour', detail: 'until 11:42' },
      { mode: 'tomorrow', label: 'Until tomorrow', detail: '08:00' },
      { mode: 'outside_hours', label: 'Outside working hours', detail: '17:30–08:30' },
      { mode: 'manual', label: 'Until I turn them on', detail: '' },
    ],
    hoursNote: null,
    ...o,
  });

  it('lists the connection, unread per account, the sign-in problem, New email and the pause choices', () => {
    const routes: string[] = [];
    const paused: Array<string | null> = [];
    const items = trayMailItems({ signedIn: true, apps: ['mail'], offline: false, mail: mail() }, { openRoute: (r) => routes.push(r), mailPause: (m) => paused.push(m) });
    expect(items.map((i) => i.label ?? i.type)).toEqual(['Connected · mail alerts on', 'Unread mail', 'Hasarinda · WorkSuite — 2', 'Sales · shared — 3', 'Personal · Gmail — ⚠ Sign-in needed', 'New email', 'Pause mail alerts', 'separator']);
    const sub = items.find((i) => i.label === 'Pause mail alerts')!.submenu as Array<{ label?: string; type?: string; click?: () => void; enabled?: boolean }>;
    expect(sub.map((i) => i.label ?? i.type)).toEqual(['For 1 hour (until 11:42)', 'Until tomorrow (08:00)', 'Outside working hours (17:30–08:30)', 'Until I turn them on', 'separator', MAIL_PAUSE_NOTE]);
    sub[0]!.click!();
    (items[2]!.click as () => void)();
    (items[4]!.click as () => void)();
    expect(paused).toEqual(['1h']);
    expect(routes).toEqual(['/mail?box=3&folder=inbox', '/settings/mail?tab=accounts']);
    expect(trayMailItems({ signedIn: true, apps: ['chat'], offline: false, mail: mail() }, { openRoute: () => undefined })).toEqual([]);
  });

  it('says a pause, offers Resume, and explains a missing Outside working hours', () => {
    const paused: Array<string | null> = [];
    const items = trayMailItems(
      { signedIn: true, apps: ['mail'], offline: false, mail: mail({ paused: true, pauseSet: true, pauseLabel: 'Paused until 11:42', choices: mail().choices.filter((c) => c.mode !== 'outside_hours'), hoursNote: 'Outside working hours needs your working hours in HR.' }) },
      { openRoute: () => undefined, mailPause: (m) => paused.push(m) },
    );
    expect(items[0]!.label).toBe('Connected · mail alerts paused until 11:42');
    const sub = items.find((i) => String(i.label).startsWith('Mail alerts:'))!.submenu as Array<{ label?: string; click?: () => void }>;
    expect(sub.map((i) => i.label)).toContain('Outside working hours needs your working hours in HR.');
    expect(sub.map((i) => i.label)).not.toContain('Outside working hours (17:30–08:30)');
    sub.find((i) => i.label === 'Resume mail alerts')!.click!();
    expect(paused).toEqual([null]);
  });

  it('reads “WorkSuite — 6 unread emails” in the tooltip, with a pause', () => {
    expect(trayMailTooltip('WorkSuite — 8 unread (2 chat, 6 mail)', { apps: ['mail'], unreadChat: 0, mail: mail({ unread: 6 }) })).toBe('WorkSuite — 6 unread emails');
    expect(trayMailTooltip('WorkSuite — all up to date', { apps: ['mail', 'chat'], unreadChat: 2, mail: mail({ unread: 6, paused: true, pauseLabel: 'Paused until 11:42' }) })).toBe('WorkSuite — 6 unread emails · 2 unread chats · mail alerts paused until 11:42');
  });

  it('sends the desktop heartbeat for the web (MNA-WEB-07), and stops when the server has none', async () => {
    const r = rig();
    await r.service.heartbeat();
    expect(r.http.post).toHaveBeenCalledWith('/api/mail/alerts/presence', { device_id: 'install-1', platform: 'win32', app_version: '0.2.234', alerts: true });
  });
});

describe('the server’s contract (ENH-MAIL-05 §7)', () => {
  it('reads the bell’s realtime copy with its payload, and never shows more than the level the server wrote', async () => {
    const r = rig();
    const data = { kind: 'message', mailbox_id: 3, account_label: 'Hasarinda · WorkSuite', message_id: 41, folder: 'inbox', conversation_key: 'c-41', from_name: 'Dinesh Perera', from_addr: 'dinesh@example.lk', importance: 'normal', attachments: 0, verdict: 'CLEAN', link: '/mail/m/3/41', preview_level: 'sender', confidential: false, received_at: T0.toISOString(), paused: false, sound: true };
    r.service.handleRealtime({ type: 'notification', id: 901, event: 'mail.received', title: 'New email from Dinesh Perera', body: null, link: '/mail/m/3/41', data });
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes[0]!.options).toMatchObject({ title: 'Dinesh Perera' });
    expect(String(notes[0]!.options.body)).toContain('New email');
    expect(notes[0]!.options.hasReply).toBe(false);
  });

  it('counts the server’s “and the rest” of a big burst in the group', async () => {
    const r = rig();
    for (let i = 1; i <= 10; i++) r.service.handleRealtime(event({ message_id: 900 + i, mailbox_id: 5, account_label: 'Sales · shared', conversation_key: `r${i}` }));
    r.service.handleRealtime({ type: 'notification', id: 77, event: 'mail.received', data: { kind: 'summary', mailbox_id: 5, account_label: 'Sales · shared', count: 15, senders: ['A', 'B'], link: '/mail?mailbox=5&folder=inbox' } });
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options.title).toBe('25 new emails in Sales · shared');
    expect(String(notes[0]!.options.body)).toContain('and 23 more');
  });

  it('withdraws a native mail alert when its bell entry is read on another device', async () => {
    const r = rig();
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    expect(open()).toHaveLength(1);
    r.service.handleRealtime({ type: 'notification.read', ids: ['901'], contextKeys: ['mail:3:41'], all: false });
    expect(open()).toHaveLength(0);
  });

  it('clears every alert of a mailbox on “all”', async () => {
    const r = rig();
    r.service.handleRealtime(event());
    await vi.advanceTimersByTimeAsync(2_100);
    r.service.handleRealtime({ type: 'mail', event: 'mail.alert_cleared', mailbox: 3, mailbox_id: 3, message_ids: [], reason: 'read', folder: 'inbox', all: true });
    expect(open()).toHaveLength(0);
  });

  it('opens the server’s deep links in the desktop’s Mail', () => {
    expect(resolveWebLink('/mail/m/3/41')).toEqual({ kind: 'tab', route: '/mail?box=3&folder=inbox&msg=41&mbx=3', app: 'mail' });
    expect(resolveWebLink('/mail?mailbox=5&folder=inbox')).toEqual({ kind: 'tab', route: '/mail?box=5&folder=inbox', app: 'mail' });
  });

  it('catches up on alerts the push missed, once, leaving out cleared and old ones', async () => {
    const r = rig();
    r.http.get.mockImplementation(async (path: string) =>
      path === '/api/mail/alerts/recent'
        ? { alerts: [
            { id: 3, cleared: false, created_at: new Date(T0.getTime() - 60_000).toISOString(), data: event({ message_id: 51, conversation_key: 'm1' }) },
            { id: 2, cleared: true, created_at: new Date(T0.getTime() - 60_000).toISOString(), data: event({ message_id: 52, conversation_key: 'm2' }) },
            { id: 1, cleared: false, created_at: new Date(T0.getTime() - 3_600_000).toISOString(), data: event({ message_id: 53, conversation_key: 'm3' }) },
          ] }
        : {},
    );
    await r.service.catchUp();
    await r.service.catchUp();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(notes).toHaveLength(1);
  });

  it('says it has gone when signed out, so the web may notify again', async () => {
    const r = rig();
    r.service.start();
    await vi.advanceTimersByTimeAsync(10);
    r.service.stop();
    expect(r.http.request).toHaveBeenCalledWith('DELETE', '/api/mail/alerts/presence', { body: { device_id: 'install-1' } });
  });
});
