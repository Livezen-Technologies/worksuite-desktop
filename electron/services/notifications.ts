import { localize } from '@shared/localization';
import { meetingNoticeActions, type MeetingNoticeActions } from '@shared/meeting-invitations';
import { inDnd } from '@shared/notification-block';
import { reminderAction } from '@shared/task-reminders';
import { Notification, app, nativeImage } from 'electron';
import { join } from 'node:path';
import type { NotificationItem, NotificationPermission, NotificationPrivacy, Preferences, RealtimeState } from '@shared/types';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
import { notificationPermission, presentLocked } from './locked-notifications';
import type { RealtimeEvent } from './realtime';
import type { Vault } from './vault';

const log = logger('notifications');

/**
 * CoreNotificationService events → native notifications (FR-NTF-01..06,
 * WF-06), with the in-app notification centre kept from the same data.
 *
 * Every notification passes through, in order: dedupe by id → whether the
 * person may open its app at all (an app they were not given never alerts)
 * → the user's per-module switch → do-not-disturb / paused → privacy mode (the stricter of
 * the user's choice and the organization's minimum; while the app is locked,
 * locked-notifications decides, generic unless this computer allows more) →
 * the OS adapter. The lock never stops any of it (#114).
 */

/** How far back a notification the realtime push missed is still worth popping up. */
const MISSED_WINDOW_MS = 15 * 60_000;

interface ServerNotification {
  id: string | number;
  type?: string | null;
  event_key?: string | null;
  actions?: unknown;
  desktop_allowed?: boolean;
  title?: string | null;
  body?: string | null;
  link?: string | null;
  read_at?: string | null;
  created_at?: string | null;
  category?: string | null;
  entity_type?: string | null;
  priority?: string | null;
  level?: string | null;
}

export interface Incoming {
  reminder?: { taskId: number; runId: number } | null;
  /** A meeting invitation's own answers (worksuite-desktop#97): Going, Maybe, Not going on the banner. */
  meeting?: MeetingNoticeActions | null;
  id: string;
  module: string;
  /** The server's category (`projects`, `expenses`…): muted per category from the notification settings' Desktop column. */
  category?: string | null;
  title: string;
  body: string;
  sender: string | null;
  link: string | null;
  critical: boolean;
  /** An incoming call (`chat.call.ringing`), not a message: said as a call, locked or not (worksuite-desktop#113). */
  call?: boolean;
}

interface MissedRoom {
  id: number;
  type: string;
  name: string;
  unread: number;
  muted?: boolean;
  mentions: number;
  notify_level?: string;
  last_message: { sender_id: number; created_at: string } | null;
}

interface MissedMessage {
  id: number;
  sender_id: number;
  sender_name?: string;
  type: string;
  message: string | null;
  created_at: string;
  deleted?: boolean;
  urgent?: boolean;
}

export interface Presented {
  title: string;
  body: string;
}

/** Naive-UTC server stamps ("2026-09-25 10:00:00") → ISO with Z. */
export function utcStamp(s: string | null | undefined): string {
  if (!s) return new Date().toISOString();
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function moduleOf(n: { category?: string | null; type?: string | null; entity_type?: string | null; link?: string | null }): string {
  const link = n.link ?? '';
  const fromLink = /^\/([a-z-]+)/.exec(link)?.[1];
  const raw = (n.category || n.entity_type || fromLink || n.type || 'system').toLowerCase();
  // `projects` is the server's category for tasks: without it, task alerts could not be muted by the Tasks switch.
  const map: Record<string, string> = { hrm: 'hr', leave: 'hr', attendance: 'hr', task: 'tasks', projects: 'tasks', calendar: 'calendar', event: 'calendar', lead: 'crm', drive: 'files', file: 'files', message: 'chat' };
  return map[raw] ?? raw.split(/[._:]/)[0] ?? 'system';
}

export function mapServerNotification(n: ServerNotification): NotificationItem {
  return {
    id: String(n.id),
    module: moduleOf(n),
    title: n.title ?? 'Notification',
    body: n.body ?? '',
    link: n.link ?? null,
    read: !!n.read_at,
    createdAt: utcStamp(n.created_at),
    actor: null,
  };
}

/** Privacy modes (FR-NTF-04). */
export function present(n: Incoming, privacy: NotificationPrivacy, moduleLabel: string, language = 'en'): Presented {
  switch (privacy) {
    case 'FULL':
      return { title: n.title, body: n.body };
    case 'SENDER_ONLY':
      return { title: localize(moduleLabel, language), body: n.sender ? localize('New from {sender}', language, { sender: n.sender }) : localize('New {module} notification', language, { module: localize(moduleLabel, language).toLowerCase() }) };
    case 'GENERIC':
      return { title: 'WorkSuite', body: localize('New WorkSuite notification', language) };
  }
}

/** Whether `now` falls inside a do-not-disturb window that may cross midnight (shared with the settings' explanation). */
export { inDnd };

const MODULE_LABELS: Record<string, string> = {
  mail: 'Mail',
  chat: 'Chat',
  calendar: 'Calendar',
  tasks: 'Tasks',
  hr: 'HR',
  crm: 'CRM',
  files: 'Files',
  support: 'Support',
  salon: 'SalonMate',
  system: 'WorkSuite',
};

export class NotificationService {
  private shown: string[] = [];
  /** Whether the list has been read once since sign-in: what was there then is not news. */
  private listed = false;
  private pausedUntil: number | null = null;
  /** The website-chat call window is showing: a ringing chat needs no toast as well. */
  ringerShowing: () => boolean = () => false;
  private live = new Map<string, Notification>();
  private unread = { mail: 0, chat: 0, notifications: 0, tasks: 0 };
  private lastMailCount: number | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private mailTimer: NodeJS.Timeout | null = null;
  private userId: string | null = null;
  /** The system's error for the last banner it refused (macOS, Windows): Settings explains it (#114). */
  private lastFailure: string | null = null;
  /** Since when realtime may have missed chat messages (asleep, reconnecting): caught up on the resync (#114). */
  private gapSince: number | null = null;
  onChanged: () => void = () => undefined;
  onClick: (link: string | null, module: string) => void = () => undefined;
  isLocked: () => boolean = () => false;
  isFocused: () => boolean = () => false;
  prefs: () => Preferences;
  /** Whether the person may open the app a notification is about (main wires shared/access `notificationAllowed`). */
  moduleEnabled: (n: Pick<Incoming, 'module' | 'category' | 'link'>) => boolean = () => true;

  constructor(
    private readonly db: Database,
    private readonly vault: () => Vault,
    private readonly http: HttpClient,
    prefs: () => Preferences,
  ) {
    this.prefs = prefs;
  }

  start(userId: string): void {
    this.userId = userId;
    this.listed = false;
    void this.refreshList();
    void this.refreshCounts();
    this.pollTimer = setInterval(() => {
      void this.refreshCounts();
      // The list too, so one the realtime push missed (asleep, reconnecting) still pops up (worksuite-desktop#16).
      void this.refreshList(true);
    }, 60_000);
    this.pollTimer.unref?.();
    // Mail has no realtime events; its unread count is polled, gently — the
    // unified count opens one IMAP session per account on the server.
    void this.pollMail(true);
    this.mailTimer = setInterval(() => void this.pollMail(false), 120_000);
    this.mailTimer.unref?.();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.mailTimer) clearInterval(this.mailTimer);
    this.pollTimer = null;
    this.mailTimer = null;
    for (const n of this.live.values()) n.close();
    this.live.clear();
    this.userId = null;
    this.lastMailCount = null;
    this.unread = { mail: 0, chat: 0, notifications: 0, tasks: 0 };
    this.gapSince = null;
  }

  counts() {
    return { ...this.unread };
  }

  pausedUntilIso(): string | null {
    return this.pausedUntil && this.pausedUntil > Date.now() ? new Date(this.pausedUntil).toISOString() : null;
  }

  pause(minutes: number | null): string | null {
    this.pausedUntil = minutes && minutes > 0 ? Date.now() + minutes * 60_000 : null;
    this.onChanged();
    return this.pausedUntilIso();
  }

  async refreshCounts(): Promise<void> {
    try {
      const [chat, notif, badges] = await Promise.allSettled([
        this.http.get<{ count?: number }>('/api/chat/unread'),
        this.http.get<{ count?: number }>('/api/notifications/unread-count'),
        this.http.get<{ badges?: Record<string, number> }>('/api/badges'),
      ]);
      if (chat.status === 'fulfilled') this.unread.chat = Number(chat.value.count ?? 0);
      if (notif.status === 'fulfilled') this.unread.notifications = Number(notif.value.count ?? 0);
      if (badges.status === 'fulfilled') this.unread.tasks = Number(badges.value.badges?.tasks ?? 0);
      this.onChanged();
    } catch (e) {
      log.debug('count refresh failed', { error: String(e) });
    }
  }

  private async pollMail(first: boolean): Promise<void> {
    // No Mail for this person: nothing to count, nothing to announce.
    if (!this.moduleEnabled({ module: 'mail', link: '/mail' })) {
      this.lastMailCount = null;
      if (this.unread.mail) {
        this.unread.mail = 0;
        this.onChanged();
      }
      return;
    }
    try {
      const data = await this.http.get<{ count?: number }>('/api/mail/unread', { query: { unified: 1 }, timeoutMs: 60_000 });
      const count = Number(data.count ?? 0);
      const before = this.lastMailCount;
      this.lastMailCount = count;
      this.unread.mail = count;
      this.onChanged();
      if (!first && before !== null && count > before) {
        const n = count - before;
        let sender: string | null = null;
        let subject = '';
        try {
          const list = await this.http.get<{ messages?: Array<{ from_name?: string; from_email?: string; subject?: string; is_read?: boolean }> }>(
            '/api/mail/messages',
            { query: { unified: 1, folder: 'inbox', per_page: 1 } },
          );
          const top = list.messages?.[0];
          if (top && !top.is_read) {
            sender = top.from_name || top.from_email || null;
            subject = top.subject ?? '';
          }
        } catch {
          /* the count alone is enough */
        }
        this.notify({
          id: `mail:${Date.now()}`,
          module: 'mail',
          title: sender ? `${sender}` : n === 1 ? 'New email' : `${n} new emails`,
          body: subject || (n === 1 ? 'You have a new email.' : `You have ${n} new emails.`),
          sender,
          link: '/mail',
          critical: false,
        });
      }
    } catch (e) {
      if (!(isDesktopError(e) && (e.code === 'APP_ACCESS_DENIED' || e.code === 'PERMISSION_DENIED' || e.code === 'NOT_FOUND'))) {
        log.debug('mail poll failed', { code: isDesktopError(e) ? e.code : String(e) });
      }
    }
  }

  /**
   * The list from the server. With `announce`, an unread one this app has not shown yet, from the last few minutes,
   * pops up as it would have from the realtime push: the push is the fast way, this is the one that does not miss.
   */
  async refreshList(announce = false): Promise<{ items: NotificationItem[]; unread: number }> {
    if (!this.userId) return { items: [], unread: 0 };
    try {
      const data = await this.http.get<{ items?: ServerNotification[]; unread?: number }>('/api/notifications');
      const raw = data.items ?? [];
      const items = raw.map(mapServerNotification);
      this.unread.notifications = Number(data.unread ?? items.filter((i) => !i.read).length);
      this.cache(items);
      if (announce && this.listed) {
        const since = Date.now() - MISSED_WINDOW_MS;
        raw.forEach((n, k) => {
          const i = items[k]!;
          if (i.read || this.shown.includes(i.id) || Date.parse(i.createdAt) < since) return;
          if (n.desktop_allowed !== false) this.notify({ reminder: (n.event_key ?? n.type) === 'task.reminder' ? reminderAction(n.link, n.actions) : null, meeting: meetingNoticeActions(n.event_key ?? n.type, n.actions), id: i.id, module: i.module, category: n.category ?? null, title: i.title, body: i.body, sender: null, link: i.link, critical: n.priority === 'critical' || n.priority === 'emergency' || n.level === 'critical' || n.level === 'emergency' });
        });
      }
      this.listed = true;
      // Anything already on the server is not "new": never pop a toast for it.
      for (const i of items) this.remember(i.id);
      this.onChanged();
      return { items, unread: this.unread.notifications };
    } catch (e) {
      log.debug('notification list unavailable; using cache', { code: isDesktopError(e) ? e.code : String(e) });
      const items = this.cached();
      return { items, unread: items.filter((i) => !i.read).length };
    }
  }

  private cache(items: NotificationItem[]): void {
    if (!this.userId) return;
    const uid = this.userId;
    this.db.tx(() => {
      this.db.run('DELETE FROM notification_cache WHERE user_id = ?', uid);
      for (const i of items.slice(0, 200)) {
        this.db.run(
          'INSERT OR REPLACE INTO notification_cache (user_id, id, module, payload, read, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          uid,
          i.id,
          i.module,
          this.vault().encrypt({ title: i.title, body: i.body, link: i.link, actor: i.actor }),
          i.read ? 1 : 0,
          i.createdAt,
        );
      }
    });
  }

  cached(): NotificationItem[] {
    if (!this.userId) return [];
    const rows = this.db.all<{ id: string; module: string; payload: string; read: number; created_at: string }>(
      'SELECT id, module, payload, read, created_at FROM notification_cache WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
      this.userId,
    );
    return rows.map((r) => {
      const p = this.vault().decrypt<{ title: string; body: string; link: string | null; actor: string | null }>(r.payload);
      return { id: r.id, module: r.module, title: p?.title ?? 'Notification', body: p?.body ?? '', link: p?.link ?? null, read: r.read === 1, createdAt: r.created_at, actor: p?.actor ?? null };
    });
  }

  async markRead(ids: string[]): Promise<void> {
    await Promise.allSettled(ids.map((id) => this.http.post(`/api/notifications/${encodeURIComponent(id)}/read`)));
    if (this.userId) for (const id of ids) this.db.run('UPDATE notification_cache SET read = 1 WHERE user_id = ? AND id = ?', this.userId, id);
    for (const id of ids) this.live.get(id)?.close();
    await this.refreshCounts();
  }

  async markAllRead(): Promise<void> {
    await this.http.post('/api/notifications/read-all');
    if (this.userId) this.db.run('UPDATE notification_cache SET read = 1 WHERE user_id = ?', this.userId);
    for (const n of this.live.values()) n.close();
    this.live.clear();
    await this.refreshCounts();
  }

  private remember(id: string): boolean {
    if (this.shown.includes(id)) return false;
    this.shown.push(id);
    if (this.shown.length > 500) this.shown.splice(0, this.shown.length - 500);
    return true;
  }

  /** Realtime events that concern notifications and badges. */
  handleRealtime(e: RealtimeEvent): void {
    switch (e.type) {
      case 'notification': {
        const id = String(e.id ?? '');
        if (!id) return;
        this.unread.notifications += 1;
        const link = typeof e.link === 'string' ? e.link : null;
        this.notify({
          id,
          reminder: e.event === 'task.reminder' ? reminderAction(link, e.actions) : null,
          meeting: meetingNoticeActions(typeof e.event === 'string' ? e.event : null, e.actions),
          module: moduleOf({ category: e.category as string, link }),
          category: typeof e.category === 'string' ? e.category : null,
          title: String(e.title ?? 'Notification'),
          body: String(e.body ?? ''),
          sender: null,
          link,
          critical: e.priority === 'critical' || e.priority === 'emergency' || e.level === 'critical' || e.level === 'emergency',
        });
        void this.refreshList(true);
        break;
      }
      case 'chat.message': {
        this.unread.chat += 1;
        this.onChanged();
        if (e.desktop === false || e.alert === false || e.muted === true) return;
        const room = e.room_name ? String(e.room_name) : null;
        const sender = String(e.sender ?? 'Someone');
        this.notify({
          id: `chat:${String(e.message_id ?? e.event_id ?? Date.now())}`,
          module: 'chat',
          title: room ? `${sender} · ${room}` : sender,
          body: String(e.preview ?? ''),
          sender,
          link: `/chat?room=${String(e.room_id ?? '')}`,
          critical: e.urgent === true,
        });
        break;
      }
      case 'chat.read':
        void this.refreshCounts();
        break;
      case 'chat.call.ringing': {
        if (e.desktop === false) return;
        const caller = String(e.caller_name ?? 'Someone');
        this.notify({
          id: `call:${String(e.uuid ?? e.event_id ?? Date.now())}`,
          module: 'chat',
          title: `Incoming ${e.mode === 'video' ? 'video' : 'voice'} call from ${caller}`,
          body: e.room_name ? String(e.room_name) : 'Answer or decline in the call window',
          sender: caller,
          link: `/chat?room=${String(e.room_id ?? '')}`,
          critical: true,
          call: true,
        });
        break;
      }
      // Website chat (the visitor widget). A chat ringing for somebody to
      // take it is persistent, like a call; the others are ordinary.
      case 'chat.incoming':
      case 'chat.at_risk': {
        // The call window is the alert (RING-40); a toast on top would say it twice.
        if (this.ringerShowing()) break;
        const conv = String(e.conversation_id ?? '');
        const visitor = String(e.visitor_label ?? e.visitor ?? 'A visitor');
        const site = e.site ? String(e.site) : 'your website';
        this.notify({
          id: `webchat:${conv}:${String(e.event_id ?? Date.now())}`,
          module: 'chat',
          title: e.type === 'chat.at_risk' ? `${visitor} is still waiting · ${site}` : `Website chat · ${site}`,
          body: e.type === 'chat.at_risk' ? 'Nobody has replied yet.' : `${visitor}${e.preview ? `: ${String(e.preview)}` : ' started a chat'}`,
          sender: visitor,
          link: `/chat?website=${conv}`,
          critical: true,
        });
        break;
      }
      case 'chat.widget.message': {
        const conv = String(e.conversation_id ?? '');
        const visitor = String(e.visitor ?? 'Visitor');
        this.notify({
          id: `webchat:${conv}:${String(e.message_id ?? e.event_id ?? Date.now())}`,
          module: 'chat',
          title: `${visitor} · website chat`,
          body: String(e.preview ?? ''),
          sender: visitor,
          link: `/chat?website=${conv}`,
          critical: false,
        });
        break;
      }
      case 'chat.assigned': {
        if (this.ringerShowing()) break;
        const conv = String(e.conversation_id ?? '');
        this.notify({
          id: `webchat-assigned:${conv}:${String(e.at ?? Date.now())}`,
          module: 'chat',
          title: 'A website chat was assigned to you',
          body: `${String(e.visitor ?? 'A visitor')}${e.site ? ` · ${String(e.site)}` : ''}`,
          sender: null,
          link: `/chat?website=${conv}`,
          critical: false,
        });
        break;
      }
      case 'chat.taken': {
        // Somebody took it: every ringing alert for that chat goes, on every screen.
        const prefix = `webchat:${String(e.conversation_id ?? '')}:`;
        for (const [key, note] of this.live) {
          if (key.startsWith(prefix)) {
            note.close();
            this.live.delete(key);
          }
        }
        break;
      }
      case 'chat.call.stopped': {
        // Answered elsewhere or ended: dismiss the ringing notification everywhere.
        const key = `call:${String(e.uuid ?? '')}`;
        this.live.get(key)?.close();
        this.live.delete(key);
        break;
      }
      default:
        break;
    }
  }

  private suppressed(n: Incoming): string | null {
    const p = this.prefs();
    if (!p.notificationsEnabled || !p.backgroundServices.notifications) return 'disabled';
    if (!this.moduleEnabled(n)) return 'module-off';
    if (p.moduleNotifications[n.module] === false) return 'module-muted';
    if (n.category && p.moduleNotifications[`cat:${n.category}`] === false) return 'category-muted';
    if (n.critical) return null;
    if (this.pausedUntil && this.pausedUntil > Date.now()) return 'paused';
    if (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, new Date())) return 'dnd';
    return null;
  }

  notify(n: Incoming): void {
    if (!this.remember(n.id)) return;
    this.onChanged();
    const why = this.suppressed(n);
    if (why) {
      log.debug('notification suppressed', { module: n.module, why });
      return;
    }
    if (!Notification.isSupported()) return;
    const locked = this.isLocked();
    const privacy: NotificationPrivacy = locked ? 'GENERIC' : this.prefs().notificationPrivacy;
    const shown = locked ? presentLocked(n, this.prefs()) : present(n, privacy, MODULE_LABELS[n.module] ?? n.module.charAt(0).toUpperCase() + n.module.slice(1), this.prefs().language);
    const icon = process.platform === 'darwin' ? undefined : nativeImage.createFromPath(join(app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources'), 'icons', '128x128.png'));
    const note = new Notification({
      title: shown.title,
      body: shown.body,
      silent: !this.prefs().notificationSounds,
      icon,
      urgency: n.critical ? 'critical' : 'normal',
      actions:
        privacy !== 'FULL'
          ? undefined
          : n.reminder
            ? [{ type: 'button', text: 'Snooze 15 min' }, { type: 'button', text: 'Mark Complete' }]
            : n.meeting?.answers.length
              ? n.meeting.answers.map((a) => ({ type: 'button' as const, text: a.label }))
              : undefined,
      timeoutType: n.critical ? 'never' : 'default',
    });
    note.on('click', () => {
      this.onClick(n.link, n.module);
      if (/^\d+$/.test(n.id)) void this.markRead([n.id]).catch(() => undefined);
    });
    const recipient = this.userId;
    note.on('action', (_event, index) => {
      if (n.meeting && !n.reminder && recipient === this.userId) {
        const answer = n.meeting.answers[index];
        if (!answer) return;
        if (this.isLocked() || !this.moduleEnabled(n)) { this.onClick(n.link, n.module); return; }
        void this.answerMeeting(n.meeting.meetingId, answer.rsvp).then(() => this.markRead([n.id])).then(() => note.close()).catch((error) => {
          log.debug('Meeting answer failed', { error: String(error) });
          this.onClick(n.link, n.module);
        });
        return;
      }
      if (!n.reminder || recipient !== this.userId) return;
      if (this.isLocked() || !this.moduleEnabled(n)) { this.onClick(n.link, n.module); return; }
      const action = index === 0
        ? this.http.post(`/api/task-reminder-runs/${n.reminder.runId}/snooze`, { minutes: 15 })
        : index === 1 ? this.http.request('PATCH', `/api/tasks/${n.reminder.taskId}`, { body: { field: 'status', value: 'done' } }) : null;
      if (!action) return;
      void action.then(() => this.markRead([n.id])).then(() => note.close()).catch((error) => {
        log.debug('Task reminder action failed', { error: String(error) });
        this.onClick(n.link, n.module);
      });
    });
    note.on('close', () => this.live.delete(n.id));
    note.on('show', () => (this.lastFailure = null));
    note.on('failed', (_event, error) => {
      this.lastFailure = String(error);
      log.info('the system refused a notification', { error: this.lastFailure.slice(0, 200) });
    });
    this.live.set(n.id, note);
    note.show();
  }

  /**
   * Answer a meeting invitation from its banner: through the Calendar, which everybody invited has, or Meetings'
   * own answer for a server or a person without the Calendar's.
   */
  private async answerMeeting(id: number, rsvp: string): Promise<void> {
    try {
      await this.http.post(`/api/calendar/conflicts/invitations/meetings/${id}/rsvp`, { rsvp });
    } catch (e) {
      if (!(isDesktopError(e) && (e.code === 'NOT_FOUND' || e.code === 'APP_ACCESS_DENIED' || e.code === 'PERMISSION_DENIED'))) throw e;
      await this.http.post(`/api/meetings/${id}/rsvp`, { rsvp });
    }
  }

  /** Whether the operating system lets this app show notifications at all. */
  supported(): boolean {
    return Notification.isSupported();
  }

  test(): boolean {
    this.notify({ id: `test:${Date.now()}`, module: 'system', title: 'Notifications are working', body: 'This is how WorkSuite notifications will look.', sender: 'WorkSuite', link: null, critical: false });
    return Notification.isSupported();
  }

  /** Whether this computer shows banners, as far as can be told, and what to check (#114). */
  permission(): NotificationPermission {
    return notificationPermission(process.platform, Notification.isSupported(), this.lastFailure);
  }

  /** Chat messages may be missed from now on (the computer sleeps, the socket dropped). */
  markGap(at = Date.now()): void {
    if (this.gapSince === null || at < this.gapSince) this.gapSince = at;
  }

  /** The socket dropped: what came in since its last heartbeat (the watchdog allows 90 s of silence) may be lost. */
  realtimeState(s: RealtimeState): void {
    if (s === 'down') this.markGap(Date.now() - 90_000);
  }

  /**
   * After a reconnect: messages that arrived while realtime was away pop up as
   * they would have — once (the same `chat:<message id>` the push uses), not
   * from muted conversations, and only from the last few minutes.
   */
  async catchUpChat(): Promise<void> {
    const gap = this.gapSince;
    this.gapSince = null;
    const me = this.userId;
    if (gap === null || !me) return;
    const since = Math.max(gap - 5_000, Date.now() - MISSED_WINDOW_MS);
    try {
      const { rooms = [] } = await this.http.get<{ rooms?: MissedRoom[] }>('/api/chat/rooms');
      const missed = rooms
        .filter((r) => r.unread > 0 && !r.muted && r.notify_level !== 'none' && (r.notify_level !== 'mentions' || r.mentions > 0))
        .filter((r) => r.last_message && String(r.last_message.sender_id) !== me && Date.parse(utcStamp(r.last_message.created_at)) >= since)
        .slice(0, 5);
      for (const room of missed) {
        const { messages = [] } = await this.http.get<{ messages?: MissedMessage[] }>('/api/chat/messages', { query: { room_id: room.id } });
        const fresh = messages.filter((m) => !m.deleted && String(m.sender_id) !== me && Date.parse(utcStamp(m.created_at)) >= since).slice(-Math.min(room.unread, 3));
        for (const m of fresh) {
          if (this.userId !== me) return;
          const sender = m.sender_name || 'Someone';
          this.notify({
            id: `chat:${m.id}`,
            module: 'chat',
            title: room.type === 'direct' ? sender : `${sender} · ${room.name}`,
            body: m.type === 'text' ? (m.message ?? '').slice(0, 200) : 'Sent an attachment',
            sender,
            link: `/chat?room=${room.id}`,
            critical: m.urgent === true,
          });
        }
      }
    } catch (e) {
      log.debug('chat catch-up failed', { code: isDesktopError(e) ? e.code : String(e) });
    }
  }

  clearUser(userId: string): void {
    this.db.run('DELETE FROM notification_cache WHERE user_id = ?', userId);
  }
}
