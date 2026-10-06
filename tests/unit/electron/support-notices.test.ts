import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void>; closed: boolean }>);
vi.mock('electron', () => ({
  app: { isPackaged: false, setBadgeCount: () => undefined },
  Menu: { buildFromTemplate: (t: unknown) => t },
  Tray: class {},
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
import { NotificationService } from '../../../electron/services/notifications';
import { SupportNotices, noticeText, spanWords, stillDue, TAKE_LATER_MS, SNOOZE_MS } from '../../../electron/services/support-notices';
import { DesktopError } from '../../../electron/main/errors';
import { supportNoticeKind, supportNoticePrefs, ticketIdOfLink, SUPPORT_NOTICE_DEFAULTS } from '../../../shared/support';
import { attentionCount, trayTooltip } from '../../../shared/network';
import { trayMenu, type TrayModel } from '../../../electron/tray/tray';
import type { Preferences } from '../../../shared/types';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';

/**
 * Support's native banners (WS-SUPPORT-SRS-001 D-03, FR-DSK-02/04, FR-NTF-01/03/06): the server's notifications about
 * the desk shown with their own buttons — Open and Take later, Open and Mark read with a reply box, a mention answered
 * with a note, an SLA with Snooze that stays — each kind switchable with its sound, low-priority ones gathered hourly,
 * and the desk's count for the rail, the Dock and the tray.
 */
const realPlatform = process.platform;
const onPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p, configurable: true });

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 1284, reference: 'CFX-001284', subject: 'Microsoft 365 licences not activating', status: 'open', priority: 'normal', source: 'email',
  requester: { name: 'Saman Kumara', email: 'saman@acme.lk', phone: null, kind: 'contact', user_id: null, contact_id: 7, company_id: null },
  assignee: { id: 5, name: 'Ayesha Fernando' }, category: { id: 3, name: 'Licensing' }, team: null, department: null, tags: [],
  sla: { state: 'at_risk', target: 'resolution', due_at: '2026-10-04T10:30:00Z', policy_id: 1, paused_ms: 0 },
  sla_timers: [{ target: 'resolution', due_at: '2026-10-04T10:30:00Z', state: 'running', at: null }],
  unread: 2, version: 7, merged_into: null, deleted_at: null, ...over,
});
const show = (over: Record<string, unknown> = {}, t: Record<string, unknown> = {}) => ({
  ticket: ticket(t),
  messages: [
    { id: 1, body: 'Three users get 0xC004C003', author: null, author_name: 'Saman Kumara', from: 'requester', internal: false },
    { id: 2, body: '@Ayesha can you approve the seat transfer?', author: { id: 4, name: 'Nimal Perera' }, author_name: 'Nimal Perera', from: 'staff', internal: true },
    { id: 3, body: 'Affected users are kumari@, dilan@ and roshan@', author: null, author_name: 'Saman Kumara', from: 'requester', internal: false },
  ],
  attachments: [{ id: 9, message_id: 3, name: 'roshan-mac.png' }],
  events: [], has_earlier: false, last_read_message_id: 0, can: {}, transitions: [], remote_desk: null, ...over,
});

let prefs: Preferences;
function setup(opts: { badges?: number; ticket?: unknown; enabled?: boolean } = {}) {
  prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: true, dndEnabled: false, language: 'en' } as unknown as Preferences;
  const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn(), getConfig: () => null, setConfig: () => undefined } as unknown as Database;
  const http = {
    get: vi.fn(async (path: string) => {
      if (path === '/api/support/v1/badges') return { badges: { unread: opts.badges ?? 3, assigned_open: 9, unassigned: 2, overdue: 1, at_risk: 1 } };
      if (path === '/api/support/v1/tickets/1284') {
        if (opts.ticket instanceof Error) throw opts.ticket;
        return opts.ticket ?? show();
      }
      if (path === '/api/notifications') return { items: [], unread: 0 };
      return {};
    }),
    post: vi.fn(async (_path: string, _body?: unknown) => ({})),
  };
  const service = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, http as unknown as HttpClient, () => prefs);
  (service as unknown as { userId: string }).userId = '5';
  service.onClick = vi.fn();
  const changed = vi.fn();
  const refused = vi.fn();
  const open = vi.fn();
  const support = new SupportNotices({
    http: http as unknown as HttpClient,
    notify: (n) => service.notify(n),
    markRead: (ids) => service.markRead(ids),
    me: () => 5,
    enabled: () => opts.enabled ?? true,
    prefs: () => prefs,
    open,
    refused,
    onChanged: changed,
  });
  service.claim = (n) => support.claim(n);
  support.start();
  const push = (event: string, id = 77, over: Record<string, unknown> = {}) =>
    service.handleRealtime({ type: 'notification', id, event, title: 'Ticket CFX-001284 assigned to you', body: 'Microsoft 365 licences not activating', link: '/tickets?ticket=1284', category: 'support', priority: 'normal', level: 'info', ...over } as never);
  return { service, support, http, push, changed, refused, open };
}

beforeEach(() => {
  notes.length = 0;
  onPlatform('darwin');
});
afterEach(() => {
  onPlatform(realPlatform);
  vi.useRealTimers();
});

describe('the rules', () => {
  it('knows the desk’s notifications and the ticket a link names', () => {
    expect(supportNoticeKind('support.ticket_assigned')).toBe('assigned');
    expect(supportNoticeKind('support.customer_replied')).toBe('reply');
    expect(supportNoticeKind('support.sla_breach')).toBe('sla');
    expect(supportNoticeKind('support.rule_notice')).toBeNull();
    expect(supportNoticeKind('chat.message')).toBeNull();
    expect(ticketIdOfLink('/tickets?ticket=1284')).toBe(1284);
    expect(ticketIdOfLink('/tickets?view=mine&ticket=12#x')).toBe(12);
    expect(ticketIdOfLink('/support/ticket/9')).toBe(9);
    expect(ticketIdOfLink('/tickets?ticket=abc')).toBeNull();
    expect(ticketIdOfLink('/mail?msg=3')).toBeNull();
  });

  it('fills the choices not made with the defaults', () => {
    expect(supportNoticePrefs(undefined)).toEqual(SUPPORT_NOTICE_DEFAULTS);
    expect(supportNoticePrefs({ mention: { banner: false, sound: false }, lowPriority: 'banner' })).toMatchObject({ mention: { banner: false, sound: false }, assigned: { banner: true, sound: true }, lowPriority: 'banner', slaPersistent: true });
  });

  it('counts each thing needing me once on the Dock: support tickets by the desk’s count, not their notifications too', () => {
    expect(attentionCount(2, 5)).toBe(7);
    expect(attentionCount(2, 5, 3, 2)).toBe(8);
    expect(attentionCount(0, 1, 0, 4)).toBe(0);
  });

  it('words the banners from the ticket as it stands', () => {
    const now = Date.parse('2026-10-04T10:00:00Z');
    const s = show() as never;
    expect(noticeText('assigned', { title: 'x', body: 'y', event: 'support.ticket_assigned' }, s, now)).toEqual({ title: 'Ticket CFX-001284 assigned to you', body: 'Microsoft 365 licences not activating\nSaman Kumara · Normal · Licensing', sender: 'Saman Kumara' });
    expect(noticeText('reply', { title: 'x', body: 'y', event: null }, s, now).body).toBe('“Affected users are kumari@, dilan@ and roshan@” · 1 file');
    expect(noticeText('sla', { title: 'x', body: 'y', event: 'support.sla_warning' }, s, now).title).toBe('SLA warning — CFX-001284 resolution breaches in 30 min');
    expect(noticeText('sla', { title: 'x', body: 'y', event: 'support.sla_breach' }, s, now).title).toBe('SLA breached — CFX-001284 resolution');
    expect(noticeText('assigned', { title: 'Server title', body: 'Server body', event: null }, null, now)).toEqual({ title: 'Server title', body: 'Server body', sender: null });
    expect(spanWords(65 * 60_000)).toBe('1 h 5 min');
  });

  it('brings back a banner taken later only while it still needs me', () => {
    expect(stillDue('assigned', show() as never, 5)).toBe(true);
    expect(stillDue('assigned', show({}, { unread: 0 }) as never, 5)).toBe(false);
    expect(stillDue('assigned', show({}, { assignee: { id: 9, name: 'Kavindi' } }) as never, 5)).toBe(false);
    expect(stillDue('sla', show({}, { status: 'resolved' }) as never, 5)).toBe(false);
    expect(stillDue('sla', show({}, { sla: { state: 'met', target: null, due_at: null, policy_id: 1, paused_ms: 0 } }) as never, 5)).toBe(false);
  });
});

describe('the banners', () => {
  it('an assignment: worded from the ticket, Open and Take later, with its sound', async () => {
    const { push, http, open } = setup();
    push('support.ticket_assigned');
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    expect(http.get).toHaveBeenCalledWith('/api/support/v1/tickets/1284', expect.objectContaining({ query: { peek: 1 } }));
    expect(notes[0]!.options).toMatchObject({ title: 'Ticket CFX-001284 assigned to you', silent: false, hasReply: false, timeoutType: 'default', actions: [{ type: 'button', text: 'Open' }, { type: 'button', text: 'Take later' }] });
    notes[0]!.events.action!({}, 0);
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith('/tickets?ticket=1284'));
    // Read in the bell too.
    expect(http.post).toHaveBeenCalledWith('/api/notifications/77/read');
  });

  it('is shown once, however it arrives: pushed, and found again in the list', async () => {
    const { push, service, http } = setup();
    push('support.ticket_assigned');
    http.get.mockImplementation((async (path: string) => (path === '/api/notifications' ? { items: [{ id: 77, event_key: 'support.ticket_assigned', title: 'T', body: 'B', link: '/tickets?ticket=1284', category: 'support', created_at: new Date().toISOString() }], unread: 1 } : path === '/api/support/v1/tickets/1284' ? show() : {})) as never);
    await service.refreshList(true);
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(notes).toHaveLength(1);
  });

  it('Take later brings it back in an hour while the ticket is still mine and unread', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { push } = setup();
    push('support.ticket_assigned');
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    notes[0]!.events.action!({}, 1);
    await vi.waitFor(() => expect(notes[0]!.closed).toBe(true));
    await vi.advanceTimersByTimeAsync(TAKE_LATER_MS);
    await vi.waitFor(() => expect(notes).toHaveLength(2));
    expect(notes[1]!.options.title).toBe('Ticket CFX-001284 assigned to you');
  });

  it('a requester’s reply: quoted, with a reply box that answers them publicly', async () => {
    const { push, http } = setup();
    push('support.customer_replied', 78, { title: 'Saman Kumara replied on CFX-001284', body: 'Affected users…' });
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    expect(notes[0]!.options).toMatchObject({ title: 'Saman Kumara replied on CFX-001284', hasReply: true, replyPlaceholder: 'Reply to Saman Kumara', actions: [{ type: 'button', text: 'Open' }, { type: 'button', text: 'Mark read' }] });
    notes[0]!.events.reply!({ reply: '  Reassigning those seats now.  ' });
    await vi.waitFor(() => expect(notes[0]!.closed).toBe(true));
    const sent = http.post.mock.calls.find((c) => c[0] === '/api/support/v1/tickets/1284/messages') as unknown as [string, Record<string, unknown>];
    expect(sent[1]).toMatchObject({ body: 'Reassigning those seats now.', internal: false });
    expect(String(sent[1].client_id)).toMatch(/^notice:/);
    expect(http.post).toHaveBeenCalledWith('/api/support/v1/tickets/1284/read', { message_id: 3 });
  });

  it('a reply that cannot be sent is kept as the ticket’s draft', async () => {
    const { push, http, refused } = setup();
    http.post.mockImplementation((async (path: string) => {
      if (path.endsWith('/messages')) throw new DesktopError('PERMISSION_DENIED', 'You cannot reply here.', 403);
      return {};
    }) as never);
    push('support.customer_replied', 78);
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    notes[0]!.events.reply!({ reply: 'Hello' });
    await vi.waitFor(() => expect(refused).toHaveBeenCalledWith(1284, 'Hello', 'reply', 'You cannot reply here.'));
  });

  it('Mark read reads it in the bell and on the desk', async () => {
    const { push, http } = setup();
    push('support.customer_replied', 78);
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    notes[0]!.events.action!({}, 1);
    await vi.waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/support/v1/tickets/1284/read', { message_id: 3 }));
    expect(http.post).toHaveBeenCalledWith('/api/notifications/78/read');
  });

  it('an SLA warning stays until acted on, and Snooze brings it back in ten minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { push } = setup();
    push('support.sla_warning', 79, { priority: 'high', level: 'warning' });
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    expect(notes[0]!.options).toMatchObject({ timeoutType: 'never', urgency: 'critical', actions: [{ type: 'button', text: 'Open' }, { type: 'button', text: 'Snooze 10 min' }] });
    notes[0]!.events.action!({}, 1);
    await vi.waitFor(() => expect(notes[0]!.closed).toBe(true));
    await vi.advanceTimersByTimeAsync(SNOOZE_MS);
    await vi.waitFor(() => expect(notes).toHaveLength(2));
  });

  it('a mention (the ticket’s hint): who said what, answered with a note — never my own', async () => {
    const { support, http } = setup();
    support.handle({ type: 'support.ticket', kind: 'message', ticket_id: 1284, reference: 'CFX-001284', version: 8, message_id: 2, internal: true, from: 'staff', mentioned: true });
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    expect(notes[0]!.options).toMatchObject({ title: 'Nimal Perera mentioned you · CFX-001284', body: '“@Ayesha can you approve the seat transfer?”', hasReply: true, replyPlaceholder: 'Note to Nimal Perera (staff only)', silent: true });
    notes[0]!.events.reply!({ reply: 'Approved.' });
    await vi.waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/support/v1/tickets/1284/messages', expect.objectContaining({ body: 'Approved.', internal: true })));
    // The same hint again, and a mention I wrote myself: nothing.
    support.handle({ type: 'support.ticket', kind: 'message', ticket_id: 1284, message_id: 2, mentioned: true });
    const mine = show({ messages: [{ id: 5, body: '@me', author: { id: 5, name: 'Ayesha Fernando' }, from: 'staff', internal: true }] });
    http.get.mockImplementation((async (path: string) => (path === '/api/support/v1/tickets/1284' ? mine : {})) as never);
    support.handle({ type: 'support.ticket', kind: 'message', ticket_id: 1284, message_id: 5, mentioned: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(notes).toHaveLength(1);
  });

  it('says what the notification said when the ticket cannot be read', async () => {
    const { push } = setup({ ticket: new DesktopError('NOT_FOUND', 'Not found', 404) });
    push('support.ticket_assigned');
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    expect(notes[0]!.options).toMatchObject({ title: 'Ticket CFX-001284 assigned to you', body: 'Microsoft 365 licences not activating' });
  });

  it('keeps to the choices: a kind off, its sound off', async () => {
    const { push } = setup();
    prefs = { ...prefs, supportNotices: { ...SUPPORT_NOTICE_DEFAULTS, assigned: { banner: false, sound: true }, sla: { banner: true, sound: false } } };
    push('support.ticket_assigned');
    push('support.sla_breach', 80);
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    expect(notes[0]!.options).toMatchObject({ silent: true, title: 'SLA breached — CFX-001284 resolution' });
  });

  it('quiet hours silence it, except an urgent ticket’s', async () => {
    const { push } = setup({ ticket: show({}, { priority: 'urgent' }) });
    prefs = { ...prefs, dndEnabled: true, dndFrom: '00:00', dndTo: '23:59' };
    push('support.ticket_assigned');
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    const quiet = setup();
    prefs = { ...prefs, dndEnabled: true, dndFrom: '00:00', dndTo: '23:59' };
    notes.length = 0;
    quiet.push('support.ticket_assigned', 90);
    await new Promise((r) => setTimeout(r, 20));
    expect(notes).toHaveLength(0);
  });

  it('gathers a low-priority ticket’s banners into one at the top of the hour', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { push, support } = setup({ ticket: show({}, { priority: 'low' }) });
    push('support.ticket_assigned', 81);
    push('support.customer_replied', 82);
    await vi.advanceTimersByTimeAsync(50);
    expect(notes).toHaveLength(0);
    support.flush();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({ title: '2 low-priority support updates' });
    expect(String(notes[0]!.options.body)).toContain('Ticket CFX-001284 assigned to you');
  });

  it('leaves the desk’s notifications alone for somebody without Support, and others always', () => {
    const none = setup({ enabled: false });
    expect(none.support.claim({ id: '1', event: 'support.ticket_assigned', title: '', body: '', link: null, category: 'support', priority: null })).toBe(false);
    const { support } = setup();
    expect(support.claim({ id: '2', event: 'task.reminder', title: '', body: '', link: null, category: 'projects', priority: null })).toBe(false);
  });
});

describe('the count (FR-DSK-04)', () => {
  it('is the desk’s unread from GET badges, asked again after a hint', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { support, http, changed } = setup({ badges: 4 });
    await vi.waitFor(() => expect(support.count()).toBe(4));
    expect(changed).toHaveBeenCalled();
    const asked = () => http.get.mock.calls.filter((c) => c[0] === '/api/support/v1/badges').length;
    const before = asked();
    support.handle({ type: 'support.changed', organization_id: 10, kind: 'message' });
    support.handle({ type: 'support.changed', organization_id: 10, kind: 'status' });
    await vi.advanceTimersByTimeAsync(2_100);
    expect(asked()).toBe(before + 1);
  });

  it('is nothing for somebody without the desk, or a server without it', async () => {
    expect(setup({ enabled: false }).support.count()).toBe(0);
    const old = setup();
    old.http.get.mockImplementation((async () => {
      throw new DesktopError('NOT_FOUND', 'No route', 404);
    }) as never);
    old.support.stop();
    old.support.start();
    await new Promise((r) => setTimeout(r, 10));
    expect(old.support.count()).toBe(0);
  });

  it('the bell’s support notifications are counted apart, for the badge', async () => {
    const { push, service } = setup();
    push('support.ticket_assigned', 91);
    expect(service.counts().supportNotices).toBe(1);
    await service.markRead(['91']);
    expect(service.counts().supportNotices).toBe(0);
  });
});

describe('the tray (FR-DSK-04)', () => {
  const model = { signedIn: true, userName: 'Ayesha', organization: 'CreativeFX', offline: false, pending: 0, error: null, unreadChat: 2, unreadMail: 0, unreadOther: 1, unreadSupport: 4, unreadSupportNotices: 1, badge: true, notificationsPausedUntil: null, attendance: null, updateReady: false, remoteControl: null, webchatRinging: [], quickAsk: null, aiChanges: 0, apps: ['chat', 'support'] } as TrayModel;
  const actions = { open: vi.fn(), openRoute: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn(), pauseNotifications: vi.fn(), openSettings: vi.fn(), checkUpdates: vi.fn(), quit: vi.fn(), lock: vi.fn(), pauseRemoteControl: vi.fn(), stopRemoteControl: vi.fn(), joinWebchat: vi.fn(), quickAsk: vi.fn(), aiChanges: vi.fn(), ringingSettings: vi.fn() };

  it('lists the support tickets waiting, and opens My tickets from there', () => {
    const line = trayMenu(model, actions).find((i) => typeof i.label === 'string' && i.label.includes('Support 4'))!;
    expect(line.label).toBe('Unread Chat 2 · Support 4');
    (line.click as () => void)();
    expect(actions.openRoute).toHaveBeenCalledWith('/support?view=mine');
    expect(trayMenu({ ...model, apps: ['chat'] }, actions).some((i) => typeof i.label === 'string' && i.label.includes('Support'))).toBe(false);
  });

  it('says so in the tooltip', () => {
    expect(trayTooltip({ error: null, offline: false, pending: 0, monitoring: null, syncing: 0, unreadChat: 0, unreadMail: 0, unreadOther: 0, unreadSupport: 2 })).toBe('WorkSuite — 2 support tickets waiting');
  });
});
