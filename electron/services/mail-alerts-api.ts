import { isPreviewLevel, type PauseMode, type PreviewLevel } from '@shared/mail-alerts';
import type { HttpClient } from './http';

/**
 * The server's side of new-mail alerts (ENH-MAIL-05 §7), in one place: every address the desktop calls for them, and
 * what it reads from each answer (the server's MailAlertsController and Alerts\MailAlerts, ENH-MAIL-05 §7). Where the
 * server has not answered (an older server: 404), the desktop keeps working on its own settings.
 *
 *   GET  /api/mail/alerts/prefs      preview_level, min_preview_level, sound, pause_mode, pause_until, paused_at
 *   PUT  /api/mail/alerts/prefs      { preview_level?, sound? }
 *   PUT  /api/mail/alerts/pause      { mode: 1h | tomorrow | outside_hours | manual | off } → { summary: { count } }
 *   POST /api/mail/alerts/presence   { device_id, platform, app_version, alerts }  the desktop heartbeat (MNA-WEB-07)
 *   DELETE /api/mail/alerts/presence { device_id }  signed out or quitting: the web may notify again at once
 *   GET  /api/mail/alerts/recent     ?after_id — the latest `mail.received` with their payload, for a missed push
 *   POST /api/mail/messages/{uid}/action  { action: read | archive | star, folder, mailbox }  the existing actions
 *   POST /api/mail/states            { action: flag, items }                              WorkSuite's follow-up flag
 *   GET  /api/mail/messages/{uid}    the replied-to message's Message-ID and sender (peek: it stays unread)
 *   GET  /api/mail/mailboxes         unread, included in All Accounts, sign-in state — the tray and the badge
 *   GET  /api/hr/schedules/effective the person's working hours (HR), for "Outside working hours"
 *
 * Realtime (`type: mail`): `mail.received` (the §7 payload, also on the bell's `notification` push) and
 * `mail.alert_cleared` { mailbox_id, message_ids[], reason }.
 */

type Http = Pick<HttpClient, 'get' | 'post' | 'request'>;

export const MAIL_ALERTS_API = {
  prefs: '/api/mail/alerts/prefs',
  pause: '/api/mail/alerts/pause',
  presence: '/api/mail/alerts/presence',
  recent: '/api/mail/alerts/recent',
  action: (uid: number) => `/api/mail/messages/${uid}/action`,
  states: '/api/mail/states',
  message: (uid: number) => `/api/mail/messages/${uid}`,
  mailboxes: '/api/mail/mailboxes',
  send: '/api/mail/send',
  workingHours: '/api/hr/schedules/effective',
} as const;

/** The heartbeat's pace: the server counts the desktop present for a little over two of them. */
export const PRESENCE_EVERY_MS = 60_000;

export interface ServerAlertPrefs {
  preview: PreviewLevel | null;
  /** The organisation's minimum for this person (MNA-PRV-01), or null when the server does not say. */
  minPreview: PreviewLevel | null;
  sound: boolean | null;
}

export function readServerPrefs(raw: unknown): ServerAlertPrefs {
  const r = (raw && typeof raw === 'object' ? ((raw as { prefs?: unknown }).prefs ?? raw) : {}) as Record<string, unknown>;
  const policy = (r.policy && typeof r.policy === 'object' ? r.policy : {}) as Record<string, unknown>;
  const min = r.min_preview_level ?? policy.min_preview_level;
  return {
    preview: isPreviewLevel(r.preview_level) ? r.preview_level : null,
    minPreview: isPreviewLevel(min) ? min : null,
    sound: typeof r.sound === 'boolean' ? r.sound : null,
  };
}

export class MailAlertsApi {
  constructor(private readonly http: Http) {}

  async prefs(): Promise<ServerAlertPrefs> {
    return readServerPrefs(await this.http.get(MAIL_ALERTS_API.prefs));
  }

  async savePrefs(p: { preview_level?: PreviewLevel; sound?: boolean }): Promise<void> {
    await this.http.request('PUT', MAIL_ALERTS_API.prefs, { body: p });
  }

  /** Pause (or `off`): the server keeps the person's pause for the web; this computer keeps its own. */
  async pause(mode: PauseMode | 'off'): Promise<{ summary: number }> {
    const r = await this.http.request<{ summary?: { count?: unknown } }>('PUT', MAIL_ALERTS_API.pause, { body: { mode } });
    return { summary: Math.max(0, Number(r?.summary?.count ?? 0) || 0) };
  }

  async presence(body: { device_id: string; platform: string; app_version: string; alerts: boolean }): Promise<void> {
    await this.http.post(MAIL_ALERTS_API.presence, body);
  }

  /** Signed out or quitting: the web need not wait for the heartbeat to go stale. */
  async gone(deviceId: string): Promise<void> {
    await this.http.request('DELETE', MAIL_ALERTS_API.presence, { body: { device_id: deviceId } });
  }

  /** The latest new-mail alerts with their payload, newest first: what a push missed while the socket was down. */
  async recent(): Promise<Array<{ id: number; cleared: boolean; createdAt: number; data: Record<string, unknown> | null }>> {
    const r = await this.http.get<{ alerts?: Array<{ id?: unknown; cleared?: unknown; created_at?: unknown; data?: unknown }> }>(MAIL_ALERTS_API.recent);
    return (r?.alerts ?? []).map((a) => ({
      id: Number(a.id) || 0,
      cleared: a.cleared === true,
      createdAt: typeof a.created_at === 'string' ? Date.parse(a.created_at) : NaN,
      data: a.data && typeof a.data === 'object' ? (a.data as Record<string, unknown>) : null,
    }));
  }

  /** read | archive | star — the same call the desktop's existing mail banner and the reader make. */
  async act(m: { uid: number; folder: string; mailbox: number }, action: 'read' | 'archive' | 'star'): Promise<void> {
    await this.http.post(MAIL_ALERTS_API.action(m.uid), { action, folder: m.folder, mailbox: m.mailbox });
  }

  /** WorkSuite's own follow-up flag (DMO-NTF-01): due today at 17:00, beside the provider's star. */
  async flag(m: { uid: number; folder: string; mailbox: number }, now = new Date()): Promise<void> {
    const due = new Date(now);
    due.setHours(17, 0, 0, 0);
    await this.http.post(MAIL_ALERTS_API.states, { action: 'flag', items: [{ mailbox: m.mailbox, folder: m.folder, uid: String(m.uid) }], dates: { start_at: now.toISOString(), due_at: due.toISOString(), reminder_at: null } });
  }

  /** The replied-to message, read without marking it read. */
  async message(m: { uid: number; folder: string; mailbox: number }): Promise<{ messageId: string | null; from: string | null; subject: string | null }> {
    const r = await this.http.get<{ message_id?: unknown; from_email?: unknown; subject?: unknown }>(MAIL_ALERTS_API.message(m.uid), { query: { folder: m.folder, mailbox: m.mailbox, peek: 1 } });
    const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { messageId: s(r?.message_id), from: s(r?.from_email), subject: s(r?.subject) };
  }

  mailboxes(): Promise<unknown> {
    return this.http.get(MAIL_ALERTS_API.mailboxes);
  }

  workingHours(): Promise<unknown> {
    return this.http.get(MAIL_ALERTS_API.workingHours);
  }
}
