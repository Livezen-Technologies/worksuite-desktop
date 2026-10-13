import { meetingNoticeActions, type MeetingAnswer } from '@shared/meeting-invitations';
import { logger } from '../main/log';
import type { ClaimedNotice, CustomNotice, Incoming } from './notifications';

const log = logger('meetings-desk');

/**
 * Meetings outside the window (WS-MTG-SRS-001 v1.1 §14.2 D07): the reminder and invitation banners, with their own
 * buttons, and the tray's list of today's meetings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BANNERS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The server raises them — `meeting.reminder` before a meeting starts, `meeting.invitation` and `meeting.update` to
 * whoever is invited — and the bell keeps them. They arrive through the notification service, which hands them here
 * (`claim`) instead of showing them plainly, and go back to it (`notify`) to be shown: so every rule of the app's
 * notifications applies to them as to any other — the Meetings switch, quiet hours and the pause, privacy, the lock,
 * and the one-device rule (docs/NOTIFICATION_DELIVERY.md): the banner is claimed under the same key as the bell's
 * entry, so only the device the server chooses shows it.
 *
 *  - Reminder: "Starts in 15 minutes · Board Room A + Meet", with Join (a meeting with somewhere to join, for somebody
 *    who may attend), Snooze 5 min, and Open.
 *  - Invitation or a change to one: when and from whom, and what it clashes with — Going, Maybe, Propose time.
 *
 * The meeting is read again for the banner's words (`GET /api/meetings/{id}`), so it says what the meeting is now; when
 * it cannot be read the banner says what the notification said. A meeting payload's `can` (MTG-U03) decides Join and
 * the answers; an older server's, which has none, offers them as before.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TRAY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Today's meetings, each opening its details — or joining, when it is live or about to start and has somewhere to
 * join — and how many invitations wait for an answer. Asked once a minute while somebody with Meetings is signed in
 * and the app is unlocked; a server without the list, or a person without Meetings, gives no lines at all.
 */

export const SNOOZE_MS = 5 * 60_000;
/** A meeting is joinable from this long before it starts, as the Meet home has it. */
export const EARLY_MS = 15 * 60_000;
const READ_TIMEOUT_MS = 8_000;

/** One row of `GET /api/meetings`, as much of it as this needs. */
export interface DeskMeeting {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  live_status?: string | null;
  status?: string | null;
  meet_uuid?: string | null;
  online_url?: string | null;
  where?: string | null;
  organizer?: string | null;
  my_rsvp?: string | null;
  my_role?: string | null;
  can?: { attend?: boolean; rsvp?: boolean } | null;
}

/** What the tray shows for Meetings. */
export interface TrayMeetings {
  today: Array<{ id: number; title: string; time: string; live: boolean; join: boolean }>;
  /** Invitations waiting for my answer. */
  waiting: number;
}

/** The server's stamp as milliseconds: ISO, or `2026-10-10 10:00:00` (UTC). Null when it does not parse. */
export function stampMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} /.test(value) && !/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
  return Number.isFinite(ms) ? ms : null;
}

const over = (m: DeskMeeting) => m.live_status === 'cancelled' || m.live_status === 'completed' || m.status === 'cancelled' || m.status === 'completed';

/** Whether there is somewhere to join it now, and the reader may: live, or starting within a quarter of an hour. */
export function joinable(m: DeskMeeting, now: number): boolean {
  if (over(m) || m.can?.attend === false || (!m.meet_uuid && !m.online_url)) return false;
  const start = stampMs(m.start_at);
  const end = stampMs(m.end_at) ?? (start === null ? null : start + 60 * 60_000);
  if (m.live_status === 'ongoing') return true;
  return start !== null && end !== null && now >= start - EARLY_MS && now <= end;
}

const localDay = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const hhmm = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** The tray's lines from the list: today's meetings in order, the live ones and the joinable ones said so. */
export function trayMeetings(rows: DeskMeeting[] | null, now: number, dayOf: (ms: number) => string = localDay, timeOf: (ms: number) => string = hhmm): TrayMeetings | null {
  if (!rows) return null;
  const today = dayOf(now);
  const list = rows
    .map((m) => ({ m, start: stampMs(m.start_at) }))
    .filter((x): x is { m: DeskMeeting; start: number } => x.start !== null && !over(x.m) && (dayOf(x.start) === today || x.m.live_status === 'ongoing'))
    .sort((a, b) => a.start - b.start)
    .map(({ m, start }) => ({ id: m.id, title: (m.title ?? '').trim() || 'A meeting', time: timeOf(start), live: m.live_status === 'ongoing', join: joinable(m, now) }));
  const waiting = rows.filter((m) => !over(m) && (m.my_rsvp === 'no_response' || m.my_rsvp === 'needs_action') && m.my_role !== 'organizer' && m.can?.rsvp !== false).length;
  return { today: list, waiting };
}

/** "Starts in 15 minutes", "Starts in 1 minute", "Starting now", "Started 5 minutes ago". */
export function startsIn(startMs: number, now: number): string {
  const mins = Math.round((startMs - now) / 60_000);
  if (mins > 0) return `Starts in ${mins} minute${mins === 1 ? '' : 's'}`;
  if (mins === 0) return 'Starting now';
  return `Started ${-mins} minute${mins === -1 ? '' : 's'} ago`;
}

const whenOf = (ms: number): string => `${new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${hhmm(ms)}`;

export type ReminderButton = 'Join' | 'Snooze 5 min' | 'Open';
export type InvitationButton = 'Going' | 'Maybe' | 'Not going' | 'Propose time';

const ANSWER_OF: Record<string, MeetingAnswer> = { Going: 'accepted', Maybe: 'tentative', 'Not going': 'declined' };

/** A reminder banner: its words and its buttons. Join only with somewhere to join and for somebody who may attend. */
export function reminderBanner(m: DeskMeeting | null, n: Pick<ClaimedNotice, 'title' | 'body'>, joinUrl: string | null, now: number): { title: string; body: string; actions: ReminderButton[] } {
  const start = m ? stampMs(m.start_at) : null;
  const where = m?.where?.trim() || null;
  const body = start !== null ? [startsIn(start, now), where].filter(Boolean).join(' · ') : n.body;
  const canJoin = m ? !over(m) && m.can?.attend !== false && (!!m.meet_uuid || !!m.online_url || !!joinUrl) : !!joinUrl;
  return { title: m?.title?.trim() || n.title, body, actions: [...(canJoin ? (['Join'] as const) : []), 'Snooze 5 min', 'Open'] };
}

/**
 * An invitation banner: when and from whom, what it clashes with, and the answers. Going and Maybe as the design has
 * them (Not going is a click away in the meeting), only those the server's notice offers, and none for somebody the
 * meeting says may not answer; Propose time always, which opens the meeting with its dialog.
 */
export function invitationBanner(m: DeskMeeting | null, n: Pick<ClaimedNotice, 'title' | 'body'>, answers: MeetingAnswer[], clash: string | null, when: (ms: number) => string = whenOf): { title: string; body: string; actions: InvitationButton[] } {
  const start = m ? stampMs(m.start_at) : null;
  const head = start !== null ? [when(start), m?.organizer ? `from ${m.organizer}` : null].filter(Boolean).join(' · ') : n.body;
  const body = clash ? `${head}\nClashes with ${clash}` : head;
  const may = m?.can?.rsvp !== false && !(m && over(m));
  const buttons: InvitationButton[] = may ? (['Going', 'Maybe'] as const).filter((b) => answers.includes(ANSWER_OF[b]!)) : [];
  return { title: m?.title?.trim() || n.title, body, actions: [...buttons, 'Propose time'] };
}

export interface MeetingsDeskDeps {
  get: <T>(path: string, query?: Record<string, string>, timeoutMs?: number) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  /** Shows a banner (the notification service's `notify`): its switches, quiet hours, privacy and device rule apply. */
  notify: (n: Incoming) => void;
  markRead: (ids: string[]) => Promise<void>;
  /** Signed in, unlocked, and Meetings among the apps this person may open. */
  allowed: () => boolean;
  /** Whether the person has Meet, where a meeting held on Meet is joined. */
  canMeet: () => boolean;
  /** Opens a route in the main window, as a notification's click does. */
  open: (route: string) => void;
  /** Joins a meeting held on Meet, in its own window. */
  joinMeet: (uuid: string, title: string) => void;
  /** Opens an online meeting's link (Zoom, Teams…) in the browser. */
  openExternal: (url: string) => void;
  /** What the tray shows changed. */
  onChange: (tray: TrayMeetings | null) => void;
  now?: () => number;
  every?: number;
  /** Timers, replaceable in tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface Raised {
  kind: 'reminder' | 'invitation';
  meetingId: number;
  /** The bell's notification, read when the banner is acted on. */
  readId: string | null;
  notice: Pick<ClaimedNotice, 'title' | 'body' | 'link'>;
  /** Filed as a plain banner of it would be, so the person's switches for it still apply. */
  module: string;
  category: string | null;
  joinUrl: string | null;
  view: string;
  answers: MeetingAnswer[];
  snoozes: number;
}

const statusOf = (e: unknown): number | null => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
};

/** The meeting a notice is about: from its actions, or its link (`/meetings?meeting=12`). */
export function meetingIdOf(n: Pick<ClaimedNotice, 'link'> & { actions?: unknown }, event: string | null): number | null {
  const fromActions = meetingNoticeActions(event, n.actions)?.meetingId ?? null;
  if (fromActions) return fromActions;
  const m = /[?&]meeting=(\d+)/.exec(n.link ?? '') ?? /^\/meetings\/(\d+)/.exec(n.link ?? '');
  const id = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export class MeetingsDesk {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<void> | null = null;
  private rows: DeskMeeting[] | null = null;
  private shown = 'null';
  private claimed = new Set<string>();
  private snoozed = new Set<unknown>();
  private generation = 0;
  private running = false;

  constructor(private readonly d: MeetingsDeskDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  start(): void {
    this.stop();
    this.running = true;
    this.generation++;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.d.every ?? 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.snoozed) (this.d.clearTimer ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>)))(t);
    this.snoozed.clear();
    this.claimed.clear();
    this.rows = null;
    this.publish();
  }

  /** Ask now: an answer given, a meeting moved, the person's apps changed. */
  poke(): void {
    if (this.timer) void this.refresh();
  }

  publish(): void {
    const tray = this.d.allowed() ? trayMeetings(this.rows, this.now()) : null;
    const key = JSON.stringify(tray);
    if (key === this.shown) return;
    this.shown = key;
    try {
      this.d.onChange(tray);
    } catch (e) {
      log.debug('meetings tray listener failed', { error: String(e) });
    }
  }

  refresh(): Promise<void> {
    this.busy ??= this.load().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async load(): Promise<void> {
    if (!this.d.allowed()) {
      this.rows = null;
      this.publish();
      return;
    }
    try {
      const answer = await this.d.get<{ meetings?: DeskMeeting[]; data?: DeskMeeting[] }>('/api/meetings', { scope: 'upcoming' });
      this.rows = Array.isArray(answer?.meetings) ? answer.meetings : Array.isArray(answer?.data) ? answer.data : [];
    } catch (e) {
      const status = statusOf(e);
      // No list on this server, or no Meetings for this person: no lines, silently. Offline, the last answer stays.
      if (status === 401 || status === 403 || status === 404) this.rows = null;
      else log.debug('meetings unavailable for the tray', { status });
    }
    this.publish();
  }

  /** The tray's line for a meeting: join it when it can be joined, else open it. */
  openFromTray(id: number): void {
    const m = this.rows?.find((r) => r.id === id) ?? null;
    if (m && joinable(m, this.now())) this.join(m, null);
    else this.d.open(`/meetings?meeting=${id}`);
  }

  /**
   * A server notification Meetings shows its own way: true when it took it. Reminders and invitations (and changes
   * to an invitation) about a meeting it can name; anything else is shown plainly, as before.
   */
  claim(n: ClaimedNotice & { actions?: unknown }): boolean {
    const kind = n.event === 'meeting.reminder' ? 'reminder' : n.event === 'meeting.invitation' || n.event === 'meeting.update' ? 'invitation' : null;
    if (!kind || !this.running || !this.d.allowed()) return false;
    const meetingId = meetingIdOf(n, n.event);
    if (!meetingId) return false;
    const offered = meetingNoticeActions(n.event, n.actions);
    // A change that asks for no answer (the organiser's own, a time already answered) is said plainly.
    if (kind === 'invitation' && !offered?.answers.length) return false;
    if (!this.claimed.has(n.id)) {
      this.claimed.add(n.id);
      if (this.claimed.size > 500) this.claimed.delete(this.claimed.values().next().value!);
      void this.raise({
        kind,
        meetingId,
        readId: /^\d+$/.test(n.id) ? n.id : null,
        notice: { title: n.title, body: n.body, link: n.link },
        module: n.module || 'meetings',
        category: n.category ?? null,
        joinUrl: offered?.join ?? null,
        view: offered?.view ?? n.link ?? `/meetings?meeting=${meetingId}`,
        answers: (offered?.answers ?? []).map((a) => a.rsvp),
        snoozes: 0,
      }, n.id);
    }
    return true;
  }

  private async meeting(id: number): Promise<DeskMeeting | null> {
    try {
      const r = await this.d.get<{ meeting?: DeskMeeting }>(`/api/meetings/${id}`, undefined, READ_TIMEOUT_MS);
      return r?.meeting ?? null;
    } catch (e) {
      log.debug('meeting unavailable for a banner', { status: statusOf(e) });
      return null;
    }
  }

  /** What an invitation clashes with, from the Calendar's Waiting for me; null when nothing, or it cannot be asked. */
  private async clash(id: number): Promise<string | null> {
    try {
      const r = await this.d.get<{ invitations?: Array<{ source: string; id: number; conflicts?: Array<{ title: string | null; busy_only: boolean }> }> }>('/api/calendar/conflicts/invitations', undefined, READ_TIMEOUT_MS);
      const c = (r?.invitations ?? []).find((i) => i.source === 'meeting' && i.id === id)?.conflicts?.[0];
      return c ? (c.busy_only || !c.title ? 'something else you have' : c.title) : null;
    } catch {
      return null;
    }
  }

  private async raise(r: Raised, id: string): Promise<void> {
    const gen = this.generation;
    const [m, clash] = await Promise.all([this.meeting(r.meetingId), r.kind === 'invitation' ? this.clash(r.meetingId) : Promise.resolve(null)]);
    if (gen !== this.generation || !this.running) return;
    this.show(r, m, clash, id);
  }

  private show(r: Raised, m: DeskMeeting | null, clash: string | null, id: string): void {
    const banner = r.kind === 'reminder' ? reminderBanner(m, r.notice, r.joinUrl, this.now()) : invitationBanner(m, r.notice, r.answers, clash);
    const actions: string[] = banner.actions;
    const custom: CustomNotice = {
      actions,
      // A reminder stays until it is acted on: it is about now.
      persistent: r.kind === 'reminder',
      onAction: (index) => this.act(r, m, actions[index] ?? null),
    };
    this.d.notify({
      id: r.snoozes ? `meeting-snooze:${id}:${r.snoozes}` : `meeting:${id}`,
      // The same key as the bell's entry on every device, so one device shows it (NOTIFICATION_DELIVERY.md).
      attentionKey: r.readId && !r.snoozes ? `notification:${r.readId}` : null,
      readId: r.readId,
      module: r.module,
      category: r.category,
      title: banner.title,
      body: banner.body,
      sender: m?.organizer ?? null,
      link: r.view,
      critical: false,
      custom,
    });
  }

  private join(m: DeskMeeting, joinUrl: string | null): void {
    void this.d.post(`/api/meetings/${m.id}/attend`, { action: 'join' }).catch(() => undefined);
    if (m.meet_uuid && this.d.canMeet()) this.d.joinMeet(m.meet_uuid, m.title);
    else if (m.online_url || joinUrl) this.d.openExternal((m.online_url || joinUrl)!);
    else this.d.open(`/meetings?meeting=${m.id}`);
  }

  /** Answer from the banner: through the Calendar's Waiting for me, which everybody invited has, else Meetings' own. */
  private async answer(id: number, rsvp: MeetingAnswer): Promise<void> {
    try {
      await this.d.post(`/api/calendar/conflicts/invitations/meetings/${id}/rsvp`, { rsvp });
    } catch (e) {
      const status = statusOf(e);
      if (status !== 404 && status !== 403 && status !== 405) throw e;
      await this.d.post(`/api/meetings/${id}/rsvp`, { rsvp });
    }
  }

  /** A banner's button. */
  async act(r: Raised, m: DeskMeeting | null, button: string | null): Promise<void> {
    const read = () => (r.readId ? this.d.markRead([r.readId]).catch(() => undefined) : Promise.resolve());
    switch (button) {
      case 'Join': {
        if (m) this.join(m, r.joinUrl);
        else if (r.joinUrl) this.d.openExternal(r.joinUrl);
        else this.d.open(r.view);
        await read();
        return;
      }
      case 'Snooze 5 min': {
        const set = this.d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
        const gen = this.generation;
        const t = set(() => {
          this.snoozed.delete(t);
          if (gen !== this.generation || !this.running || !this.d.allowed()) return;
          void this.raise({ ...r, snoozes: r.snoozes + 1 }, r.readId ?? String(r.meetingId));
        }, SNOOZE_MS);
        (t as { unref?: () => void } | null)?.unref?.();
        this.snoozed.add(t);
        return;
      }
      case 'Open':
        this.d.open(`/meetings?meeting=${r.meetingId}`);
        await read();
        return;
      case 'Propose time':
        this.d.open(`/meetings?meeting=${r.meetingId}&propose=1`);
        return;
      case 'Going':
      case 'Maybe':
      case 'Not going': {
        try {
          await this.answer(r.meetingId, ANSWER_OF[button]!);
          await read();
          this.poke();
        } catch (e) {
          // Over (410), or refused: the meeting says why.
          log.debug('meeting answer from a banner failed', { status: statusOf(e) });
          this.d.open(`/meetings?meeting=${r.meetingId}`);
        }
        return;
      }
      default:
        return;
    }
  }
}
