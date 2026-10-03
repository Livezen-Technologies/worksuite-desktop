import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void>; closed: boolean }>);
vi.mock('electron', () => ({
  app: { isPackaged: false },
  nativeImage: { createFromPath: () => ({}) },
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
import { NotificationService, mailRoute } from '../../../electron/services/notifications';
import type { Preferences } from '../../../shared/types';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';

/**
 * A new email's banner (WorkSuite Mail design): sender, subject and preview,
 * with Reply, Archive and Mark read — which act on that message without
 * opening the app, Reply opening it with the reply started.
 */
function setup(top: Record<string, unknown> | null = { id: 41, from_name: 'Pat Lee', from_email: 'pat@example.org', subject: 'Revised BOQ', preview: 'The committee reviewed it', is_read: false, mailbox: { id: 3 }, folder_slug: 'inbox' }, over: Partial<Preferences> = {}, rest: Array<Record<string, unknown>> = []) {
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: false, dndEnabled: false, language: 'en', ...over } as unknown as Preferences;
  let count = 2;
  const http = {
    get: vi.fn(async (path: string): Promise<Record<string, unknown>> => {
      if (path === '/api/mail/unread') return { count };
      if (path === '/api/mail/messages') return { messages: top ? [top, ...rest] : rest };
      if (path === '/api/mail/focus/context') return { overrides: [{ sender: '@shop.example', target: 'other' }], vips: ['boss@example.org'], known: [], moves: {} };
      return {};
    }),
    post: vi.fn(async () => ({})),
    request: vi.fn(async () => ({})),
  };
  const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
  const service = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, http as unknown as HttpClient, () => prefs);
  service.onClick = vi.fn();
  const poll = (first: boolean) => (service as unknown as { pollMail: (f: boolean) => Promise<void> }).pollMail(first);
  return { service, http, poll, more: (n: number) => (count += n) };
}

beforeEach(() => {
  notes.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('new mail banners', () => {
  it('names the sender, the subject and the start of the message, with Reply, Archive and Mark read', async () => {
    const { poll, more } = setup();
    await poll(true);
    more(1);
    await poll(false);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({
      title: 'Pat Lee',
      body: 'Revised BOQ · The committee reviewed it',
      actions: [
        { type: 'button', text: 'Reply' },
        { type: 'button', text: 'Archive' },
        { type: 'button', text: 'Delete' },
        { type: 'button', text: 'Flag' },
        { type: 'button', text: 'Mark read' },
      ],
    });
    expect(mailRoute({ uid: 41, mailbox: 3, folder: 'inbox' })).toBe('/mail?msg=41&mbx=3');
  });

  it('archives and marks read from the banner, and Reply opens the message with the reply started', async () => {
    const { poll, more, http, service } = setup();
    await poll(true);
    more(1);
    await poll(false);
    notes[0]!.events.action!({}, 1);
    await vi.waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/mail/messages/41/action', { action: 'archive', folder: 'inbox', mailbox: 3 }));
    await vi.waitFor(() => expect(notes[0]!.closed).toBe(true));
    notes[0]!.events.action!({}, 4);
    await vi.waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/mail/messages/41/action', { action: 'read', folder: 'inbox', mailbox: 3 }));
    notes[0]!.events.action!({}, 2);
    await vi.waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/mail/messages/41/action', { action: 'trash', folder: 'inbox', mailbox: 3 }));
    notes[0]!.events.action!({}, 3);
    await vi.waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/mail/states', expect.objectContaining({ action: 'flag', items: [{ mailbox: 3, folder: 'inbox', uid: '41' }] })));
    expect(http.post).toHaveBeenCalledWith('/api/mail/messages/41/action', { action: 'star', folder: 'inbox', mailbox: 3 });
    notes[0]!.events.action!({}, 0);
    expect(service.onClick).toHaveBeenCalledWith('/mail?msg=41&mbx=3&reply=1', 'mail');
    notes[0]!.events.click!();
    expect(service.onClick).toHaveBeenCalledWith('/mail?msg=41&mbx=3', 'mail');
  });

  it('offers no buttons for several new emails at once, and opens the app instead of acting while locked', async () => {
    const many = setup();
    await many.poll(true);
    many.more(3);
    await many.poll(false);
    expect(notes[0]!.options.actions).toBeUndefined();
    expect(notes[0]!.options.body).toContain('Revised BOQ');

    notes.length = 0;
    const one = setup();
    await one.poll(true);
    one.more(1);
    await one.poll(false);
    one.service.isLocked = () => true;
    await one.service.mailAction({ id: 'x', module: 'mail', title: '', body: '', sender: null, link: null, critical: false }, { uid: 41, mailbox: 3, folder: 'inbox' }, 1);
    expect(one.http.post).not.toHaveBeenCalled();
    expect(one.service.onClick).toHaveBeenCalledWith('/mail?msg=41&mbx=3', 'mail');
  });

  it('opens the message when the server refuses the action', async () => {
    const { poll, more, http, service } = setup();
    await poll(true);
    more(1);
    await poll(false);
    http.post.mockRejectedValueOnce(new Error('refused'));
    notes[0]!.events.action!({}, 1);
    await vi.waitFor(() => expect(service.onClick).toHaveBeenCalledWith('/mail?msg=41&mbx=3', 'mail'));
  });

  it('counts again soon after the server’s sync pushes a change', async () => {
    vi.useFakeTimers();
    const { service, http } = setup();
    service.handleRealtime({ type: 'mail', event: 'mail.counts', mailbox: 3 });
    service.handleRealtime({ type: 'mail', event: 'mail.changed', mailbox: 3 });
    service.handleRealtime({ type: 'mail', event: 'mail.sync.progress', mailbox: 3 });
    expect(http.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(http.get.mock.calls.filter(([p]) => p === '/api/mail/unread')).toHaveLength(1);
    service.stop();
  });
});

describe('which new mail alerts, and quiet hours (ENH-MAIL-03 DMO-NTF-02/03)', () => {
  const shop = { id: 50, from_name: 'Shop', from_email: 'deals@shop.example', subject: 'Sale', preview: '', is_read: false, mailbox: { id: 3 }, folder_slug: 'inbox' };
  const boss = { id: 51, from_name: 'Boss', from_email: 'Boss@example.org', subject: 'Now', preview: '', is_read: false, mailbox: { id: 3 }, folder_slug: 'inbox' };
  const run = async (top: Record<string, unknown>, over: Partial<Preferences>, rest: Array<Record<string, unknown>> = [], n = 1) => {
    notes.length = 0;
    const s = setup(top, over, rest);
    await s.poll(true);
    s.more(n);
    await s.poll(false);
    return s;
  };

  it('Focused only: Other mail stays quiet; the newest Focused one of several is named', async () => {
    await run(shop, { mailAlerts: 'focused' });
    expect(notes).toHaveLength(0);
    await run(shop, { mailAlerts: 'focused' }, [boss], 2);
    expect(notes[0]!.options).toMatchObject({ title: 'Boss', body: 'Now' });
  });

  it('VIPs only, none, and every message', async () => {
    await run(shop, { mailAlerts: 'vip' });
    expect(notes).toHaveLength(0);
    await run(boss, { mailAlerts: 'vip' });
    expect(notes[0]!.options.title).toBe('Boss');
    await run(boss, { mailAlerts: 'none' });
    expect(notes).toHaveLength(0);
    await run(shop, { mailAlerts: 'all' });
    expect(notes[0]!.options.title).toBe('Shop');
  });

  it('a VIP breaks through quiet hours only when allowed; others wait', async () => {
    const quiet = { dndEnabled: true, dndFrom: '00:00', dndTo: '23:59' } as Partial<Preferences>;
    await run(boss, quiet);
    expect(notes).toHaveLength(0);
    await run(boss, { ...quiet, mailVipBreakthrough: true });
    expect(notes[0]!.options.title).toBe('Boss');
    await run(shop, { ...quiet, mailVipBreakthrough: true });
    expect(notes).toHaveLength(0);
  });
});
