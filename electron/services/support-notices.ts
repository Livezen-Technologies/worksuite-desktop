import { randomUUID } from 'node:crypto';
import { localize } from '@shared/localization';
import {
  PRIORITY_LABEL,
  SLA_TARGET_LABEL,
  SUPPORT_API,
  isLive,
  statusLabel,
  supportHint,
  supportNoticeKind,
  supportNoticePrefs,
  ticketIdOfLink,
  type Badges,
  type Message,
  type SupportNoticeKind,
  type SupportPriority,
  type TicketHint,
  type TicketShow,
} from '@shared/support';
import type { Preferences } from '@shared/types';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import type { ClaimedNotice, CustomNotice, Incoming } from './notifications';
import type { RealtimeEvent } from './realtime';

const log = logger('support-notices');

/**
 * Support on this computer when the window is not in front (WS-SUPPORT-SRS-001 D-03, FR-DSK-02/04, FR-NTF-01/03/06):
 * the desk's native banners, each with its own buttons, and the count on the rail, the Dock and the tray.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BANNERS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The server raises the notifications — a ticket assigned to me, a requester writing again on one of mine, an SLA
 * about to be missed or missed — and the bell keeps them. Those arrive through the notification service, which hands
 * them here (`claim`) instead of showing them plainly. A mention in a note is no notification of the server's: it
 * comes as the ticket's realtime hint (`mentioned`), and is made into one here.
 *
 * Hints are hints, and a notification's words are the server's at the time: the ticket is read again (with `peek`,
 * so reading it to word a banner marks nothing read) for what the banner says — who, which ticket, how long the SLA
 * has left. Without it (out of reach, an older server) the banner says what the notification said.
 *
 *  - Assigned: Open, Take later (it comes back in an hour if the ticket is still mine, still open and still unread).
 *  - A requester replied: Open, Mark read, and a reply typed in the banner (macOS and Windows) is sent to the
 *    requester as a public reply — by email when the ticket came by email.
 *  - Mentioned: Open, and a reply typed in the banner is an internal note.
 *  - SLA warning or breach: Open, Snooze 10 min; it stays on screen until acted on.
 *
 * Each kind can be switched off here, with or without its sound (Notification settings › Support); the app's own
 * switches, quiet hours and pause apply as to every banner, except that an urgent ticket still rings in quiet hours.
 * A low-priority ticket's banners can wait for one at the top of the hour instead.
 *
 * A reply the server refuses, or that cannot be sent, is kept as the ticket's draft and the ticket is opened: nothing
 * typed is lost.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COUNT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `GET badges`'s `unread`: my live tickets with something I have not read, newly assigned ones included. Asked when
 * the session starts, every minute, after the desk's hints (once for a burst), and when a screen says something was
 * read (`notifications:refresh`). A server without the v1 API has no count: it is asked again ten minutes later.
 */

export const BADGE_POLL_MS = 60_000;
export const HINT_DEBOUNCE_MS = 2_000;
export const TAKE_LATER_MS = 60 * 60_000;
export const SNOOZE_MS = 10 * 60_000;
const NO_V1_RECHECK_MS = 10 * 60_000;
const READ_TIMEOUT_MS = 10_000;

/** A banner's buttons, by kind, in order. Mac and Windows add Reply where a banner takes one. */
export const SUPPORT_ACTIONS: Record<SupportNoticeKind, readonly string[]> = {
  assigned: ['Open', 'Take later'],
  reply: ['Open', 'Mark read'],
  mention: ['Open'],
  sla: ['Open', 'Snooze 10 min'],
};

/** The button that opens the ticket's quick-reply window (D-04, FR-DSK-03), second after Open where the app has one. */
export const QUICK_REPLY_ACTION = 'Quick reply';

/** A banner's buttons: its kind's, with Quick reply after Open when the window can be opened from here. */
export function noticeActions(kind: SupportNoticeKind, quick: boolean): string[] {
  const base = [...SUPPORT_ACTIONS[kind]];
  return quick ? [base[0]!, QUICK_REPLY_ACTION, ...base.slice(1)] : base;
}

export interface SupportNoticeDeps {
  http: HttpClient;
  /** Shows a banner (the notification service's `notify`): its switches, quiet hours and privacy apply. */
  notify: (n: Incoming) => void;
  /** Marks the bell's notifications read. */
  markRead: (ids: string[]) => Promise<void>;
  /** The signed-in person's id. */
  me: () => number | null;
  /** Whether the person has the Support app. */
  enabled: () => boolean;
  prefs: () => Preferences;
  /** Opens a link as a notification's click does. */
  open: (link: string) => void;
  /**
   * Opens the ticket's quick-reply window (D-04) over whatever is in front. Without it (an older caller) banners have
   * no Quick reply button, and an empty reply opens the ticket.
   */
  quickReply?: (ticketId: number) => void;
  /** A reply typed in a banner that was not sent: kept as the ticket's draft, and the ticket opened. */
  refused: (ticketId: number, text: string, mode: 'reply' | 'note', error: string) => void;
  /** The count changed. */
  onChanged: () => void;
}

/** "30 min", "1 h 5 min", "2 d 3 h": how long, as a banner says it. */
export function spanWords(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

const oneLine = (s: string, max = 200) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The newest message the requester wrote (what a "replied" banner quotes). */
export function lastFromRequester(show: Pick<TicketShow, 'messages'>): Message | null {
  for (let i = show.messages.length - 1; i >= 0; i--) if (show.messages[i]!.from === 'requester' && !show.messages[i]!.internal) return show.messages[i]!;
  return null;
}

/**
 * What a support banner says: from the ticket as it now stands when it could be read, else from the notification.
 * `message`: the mention's.
 */
export function noticeText(kind: SupportNoticeKind, n: Pick<ClaimedNotice, 'title' | 'body' | 'event'>, show: TicketShow | null, now: number, language = 'en', message: Message | null = null): { title: string; body: string; sender: string | null } {
  const L = (s: string, vars?: Record<string, string | number>) => localize(s, language, vars);
  if (!show) return { title: n.title, body: n.body, sender: null };
  const t = show.ticket;
  const requester = t.requester.name || t.requester.email || L('The requester');
  const ref = t.reference;
  switch (kind) {
    case 'assigned':
      return {
        title: L('Ticket {ref} assigned to you', { ref }),
        body: [oneLine(t.subject, 120), [requester, L(PRIORITY_LABEL[t.priority as SupportPriority] ?? t.priority), t.category?.name].filter(Boolean).join(' · ')].join('\n'),
        sender: requester,
      };
    case 'reply': {
      const m = lastFromRequester(show);
      const files = m ? show.attachments.filter((a) => a.message_id === m.id).length : 0;
      return {
        title: L('{who} replied on {ref}', { who: requester, ref }),
        body: m ? `“${oneLine(m.body, 180)}”${files ? ` · ${files === 1 ? L('1 file') : L('{n} files', { n: files })}` : ''}` : n.body,
        sender: requester,
      };
    }
    case 'mention': {
      const who = message?.author?.name || message?.author_name || L('Someone');
      return { title: L('{who} mentioned you · {ref}', { who, ref }), body: message ? `“${oneLine(message.body, 200)}”` : oneLine(t.subject, 120), sender: who };
    }
    case 'sla': {
      const breach = n.event === 'support.sla_breach';
      const timer = (t.sla_timers ?? []).find((x) => x.target === t.sla.target) ?? null;
      const target = t.sla.target ? L(SLA_TARGET_LABEL[t.sla.target]).toLowerCase() : L('SLA');
      const due = Date.parse(timer?.due_at ?? t.sla.due_at ?? '');
      const title = breach
        ? L('SLA breached — {ref} {target}', { ref, target })
        : Number.isFinite(due) && due > now
          ? L('SLA warning — {ref} {target} breaches in {time}', { ref, target, time: spanWords(due - now) })
          : L('SLA warning — {ref} {target}', { ref, target });
      return { title, body: [requester, oneLine(t.subject, 100), L(statusLabel(t.status))].join(' · '), sender: requester };
    }
  }
}

interface Shown {
  kind: SupportNoticeKind;
  /** The bell's notification (none for a mention). */
  readId: string | null;
  ticketId: number;
  link: string;
  event: string | null;
  title: string;
  body: string;
}

export class SupportNotices {
  private unread = 0;
  /** The whole answer last read: the tray's dashboard shows more of it than the count (support-desk.ts). */
  private last: Badges | null = null;
  private running = false;
  private poll: NodeJS.Timeout | null = null;
  private nudge: NodeJS.Timeout | null = null;
  private digestTimer: NodeJS.Timeout | null = null;
  private digest: Array<{ title: string; link: string }> = [];
  private timers = new Set<NodeJS.Timeout>();
  /** Notifications and mentions already taken: each raises one banner. */
  private claimed = new Set<string>();
  private noV1Until = 0;
  private generation = 0;

  constructor(private readonly d: SupportNoticeDeps) {}

  start(): void {
    this.stop();
    this.running = true;
    void this.refreshBadges();
    this.poll = setInterval(() => void this.refreshBadges(), BADGE_POLL_MS);
    this.poll.unref?.();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.poll) clearInterval(this.poll);
    if (this.nudge) clearTimeout(this.nudge);
    if (this.digestTimer) clearTimeout(this.digestTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.poll = this.nudge = this.digestTimer = null;
    this.digest = [];
    this.claimed.clear();
    this.noV1Until = 0;
    this.last = null;
    if (this.unread) {
      this.unread = 0;
      this.d.onChanged();
    }
  }

  /** The badges as last read, or null (not yet, no Support, a server without them). */
  badges(): Badges | null {
    return this.running && this.d.enabled() ? this.last : null;
  }

  /** The rail's, the Dock's and the tray's count: 0 for somebody without the desk. */
  count(): number {
    return this.running && this.d.enabled() ? this.unread : 0;
  }

  async refreshBadges(): Promise<void> {
    if (!this.running || !this.d.enabled() || Date.now() < this.noV1Until) return;
    const gen = this.generation;
    try {
      const r = await this.d.http.get<{ badges?: Partial<Badges> }>(`${SUPPORT_API}/badges`, { timeoutMs: READ_TIMEOUT_MS });
      if (gen !== this.generation) return;
      const n = Math.max(0, Math.floor(Number(r?.badges?.unread ?? 0)) || 0);
      const whole: Badges = { assigned_open: 0, unassigned: 0, overdue: 0, at_risk: 0, ...(r?.badges ?? {}), unread: n };
      const moved = JSON.stringify(whole) !== JSON.stringify(this.last);
      this.last = whole;
      if (n !== this.unread || moved) {
        this.unread = n;
        this.d.onChanged();
      }
    } catch (e) {
      // A server without v1 has no count; anything else keeps the last one until the next answer.
      if (isDesktopError(e) && (e.status === 404 || e.status === 405)) this.noV1Until = Date.now() + NO_V1_RECHECK_MS;
      else log.debug('support badges unavailable', { code: isDesktopError(e) ? e.code : String(e) });
    }
  }

  /** The realtime hints: the desk's and a ticket's move the count; a mention raises its banner. */
  handle(e: RealtimeEvent): void {
    if (!this.running) return;
    const h = supportHint(e);
    if (!h || h.type === 'support.presence') return;
    this.soon();
    if (h.type === 'support.ticket' && h.kind === 'message' && h.mentioned && h.message_id) void this.mention(h);
  }

  /** A burst of hints asks for the count once. */
  private soon(): void {
    if (this.nudge) return;
    this.nudge = setTimeout(() => {
      this.nudge = null;
      void this.refreshBadges();
    }, HINT_DEBOUNCE_MS);
    this.nudge.unref?.();
  }

  /**
   * A notification of the server's about the desk: shown here, with its own buttons (true), or left to the
   * notification service to show plainly (false: not the desk's, or not the person's app).
   */
  claim(n: ClaimedNotice): boolean {
    const kind = supportNoticeKind(n.event);
    if (!kind || !this.running || !this.d.enabled()) return false;
    if (!this.claimed.has(n.id)) {
      this.remember(n.id);
      void this.raise(kind, n);
    }
    return true;
  }

  private remember(id: string): void {
    this.claimed.add(id);
    if (this.claimed.size > 500) this.claimed.delete(this.claimed.values().next().value!);
  }

  /** The ticket as it now stands, or null: with `peek`, so wording a banner reads nothing. */
  private async ticket(id: number): Promise<TicketShow | null> {
    try {
      return await this.d.http.get<TicketShow>(`${SUPPORT_API}/tickets/${id}`, { query: { peek: 1 }, timeoutMs: READ_TIMEOUT_MS });
    } catch (e) {
      log.debug('support ticket unavailable for a banner', { code: isDesktopError(e) ? e.code : String(e) });
      return null;
    }
  }

  private async raise(kind: SupportNoticeKind, n: ClaimedNotice): Promise<void> {
    const prefs = supportNoticePrefs(this.d.prefs().supportNotices);
    // Off here: the bell has it, and no banner says it.
    if (!prefs[kind].banner) return;
    const ticketId = ticketIdOfLink(n.link);
    const gen = this.generation;
    const show = ticketId ? await this.ticket(ticketId) : null;
    if (gen !== this.generation || !this.running) return;
    const link = n.link ?? (ticketId ? `/tickets?ticket=${ticketId}` : '/tickets');
    const text = noticeText(kind, n, show, Date.now(), this.d.prefs().language);
    const shown: Shown = { kind, readId: /^\d+$/.test(n.id) ? n.id : null, ticketId: ticketId ?? 0, link, event: n.event, title: text.title, body: text.body };
    // A low-priority ticket's banner waits for the top of the hour (an SLA's never does).
    if (show?.ticket.priority === 'low' && kind !== 'sla' && prefs.lowPriority === 'digest') return this.hold(shown);
    this.show(`support:${n.id}`, shown, text.sender, show);
  }

  /** A mention in a note (the ticket's hint): read, then said — unless it was mine. */
  private async mention(h: TicketHint): Promise<void> {
    const id = `mention:${h.message_id}`;
    if (this.claimed.has(id)) return;
    this.remember(id);
    const prefs = supportNoticePrefs(this.d.prefs().supportNotices);
    if (!prefs.mention.banner || !this.d.enabled()) return;
    const gen = this.generation;
    const show = await this.ticket(h.ticket_id);
    if (!show || gen !== this.generation || !this.running) return;
    const message = show.messages.find((m) => m.id === h.message_id) ?? null;
    const me = this.d.me();
    if (message?.author?.id && message.author.id === me) return;
    const link = `/tickets?ticket=${h.ticket_id}`;
    const text = noticeText('mention', { title: '', body: '', event: null }, show, Date.now(), this.d.prefs().language, message);
    const shown: Shown = { kind: 'mention', readId: null, ticketId: h.ticket_id, link, event: null, title: text.title, body: text.body };
    if (show.ticket.priority === 'low' && prefs.lowPriority === 'digest') return this.hold(shown);
    this.show(`support-mention:${h.message_id}`, shown, text.sender, show, message?.id ?? null);
  }

  private show(id: string, s: Shown, sender: string | null, show: TicketShow | null, messageId: number | null = null): void {
    const prefs = supportNoticePrefs(this.d.prefs().supportNotices);
    const language = this.d.prefs().language;
    const requester = show ? show.ticket.requester.name || show.ticket.requester.email : null;
    const author = show && messageId ? show.messages.find((m) => m.id === messageId)?.author?.name : null;
    const replyTo =
      s.kind === 'reply' && s.ticketId
        ? localize('Reply to {who}', language, { who: requester || localize('the requester', language) })
        : s.kind === 'mention' && s.ticketId
          ? localize('Note to {who} (staff only)', language, { who: author || localize('the team', language) })
          : null;
    const actions = noticeActions(s.kind, !!this.d.quickReply && !!s.ticketId);
    const custom: CustomNotice = {
      actions,
      reply: replyTo,
      persistent: s.kind === 'sla' && prefs.slaPersistent,
      sound: prefs[s.kind].sound,
      onAction: (index) => this.act(s, actions[index] ?? null, show),
      onReply: (text) => this.reply(s, text, show, messageId),
    };
    this.d.notify({
      id,
      readId: s.readId,
      module: 'support',
      category: 'support',
      title: s.title,
      body: s.body,
      sender,
      link: s.link,
      critical: false,
      // Quiet hours silence the desk's banners, but not an urgent ticket's (FR-NTF-06).
      breakthrough: show?.ticket.priority === 'urgent',
      custom,
    });
  }

  /** A button. */
  async act(s: Shown, action: string | null, show: TicketShow | null): Promise<void> {
    switch (action) {
      case 'Open':
        this.d.open(s.link);
        if (s.readId) await this.d.markRead([s.readId]).catch(() => undefined);
        return;
      case QUICK_REPLY_ACTION:
        if (s.ticketId && this.d.quickReply) this.d.quickReply(s.ticketId);
        else this.d.open(s.link);
        if (s.readId) await this.d.markRead([s.readId]).catch(() => undefined);
        return;
      case 'Take later':
        return this.later(s, TAKE_LATER_MS);
      case 'Snooze 10 min':
        return this.later(s, SNOOZE_MS);
      case 'Mark read': {
        const last = show?.messages.at(-1)?.id;
        await Promise.allSettled([
          s.readId ? this.d.markRead([s.readId]) : Promise.resolve(),
          s.ticketId ? this.d.http.post(`${SUPPORT_API}/tickets/${s.ticketId}/read`, last ? { message_id: last } : {}) : Promise.resolve(),
        ]);
        void this.refreshBadges();
        return;
      }
      default:
        return;
    }
  }

  /**
   * Take later and Snooze: the banner comes back after a while — if it still needs me. An assignment: the ticket still
   * mine, still open, still unread. An SLA: the ticket still open and its clock not met or paused.
   */
  private later(s: Shown, ms: number): void {
    const gen = this.generation;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (gen !== this.generation || !this.running) return;
      void (async () => {
        const show = s.ticketId ? await this.ticket(s.ticketId) : null;
        if (gen !== this.generation || !this.running) return;
        if (show && !stillDue(s.kind, show, this.d.me())) return;
        const text = noticeText(s.kind, { title: s.title, body: s.body, event: s.event }, show, Date.now(), this.d.prefs().language);
        this.show(`support-again:${s.readId ?? s.ticketId}:${Date.now()}`, { ...s, title: text.title, body: text.body }, text.sender, show);
      })();
    }, ms);
    timer.unref?.();
    this.timers.add(timer);
  }

  /**
   * A reply typed in the banner: to the requester (a "replied" banner) or an internal note (a mention), sent with a
   * retry key. Nothing typed opens the ticket's quick-reply window (or the ticket, without one); a refusal keeps the
   * words as the ticket's draft and opens it.
   */
  async reply(s: Shown, text: string | null, show: TicketShow | null, messageId: number | null = null): Promise<void> {
    if (!text || !s.ticketId) {
      if (s.ticketId && this.d.quickReply) this.d.quickReply(s.ticketId);
      else this.d.open(s.link);
      return;
    }
    const internal = s.kind === 'mention';
    try {
      await this.d.http.post(`${SUPPORT_API}/tickets/${s.ticketId}/messages`, { body: text, internal, client_id: `notice:${randomUUID()}` });
      const read = messageId ?? show?.messages.at(-1)?.id ?? null;
      await Promise.allSettled([s.readId ? this.d.markRead([s.readId]) : Promise.resolve(), this.d.http.post(`${SUPPORT_API}/tickets/${s.ticketId}/read`, read ? { message_id: read } : {})]);
      void this.refreshBadges();
    } catch (e) {
      const why = isDesktopError(e) ? e.message : String(e);
      log.info('a reply from a support banner was not sent', { code: isDesktopError(e) ? e.code : 'ERROR' });
      this.d.refused(s.ticketId, text, internal ? 'note' : 'reply', why);
    }
  }

  /** A low-priority ticket's banner, kept for the top of the hour. */
  private hold(s: Shown): void {
    this.digest.push({ title: s.title, link: s.link });
    if (this.digestTimer) return;
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(60, 0, 0);
    this.digestTimer = setTimeout(() => this.flush(), Math.max(1_000, next.getTime() - now.getTime()));
    this.digestTimer.unref?.();
  }

  /** The hour's low-priority banners as one: what they were, the first three, and how many more. */
  flush(): void {
    this.digestTimer = null;
    const items = this.digest.splice(0);
    if (!items.length || !this.running) return;
    const language = this.d.prefs().language;
    const more = items.length - 3;
    this.d.notify({
      id: `support-digest:${Date.now()}`,
      module: 'support',
      category: 'support',
      title: items.length === 1 ? items[0]!.title : localize('{n} low-priority support updates', language, { n: items.length }),
      body: [...items.slice(0, 3).map((i) => i.title), more > 0 ? localize('+{n} more', language, { n: more }) : null].filter(Boolean).join('\n'),
      sender: null,
      link: items.length === 1 ? items[0]!.link : '/tickets',
      critical: false,
    });
  }
}

/** Whether a banner taken later or snoozed still needs me when it comes back. */
export function stillDue(kind: SupportNoticeKind, show: TicketShow, me: number | null): boolean {
  const t = show.ticket;
  if (!isLive(t.status) || t.merged_into || t.deleted_at) return false;
  if (kind === 'assigned') return !!me && t.assignee?.id === me && (t.unread > 0 || t.status === 'new');
  if (kind === 'sla') return t.sla.state === 'at_risk' || t.sla.state === 'breached';
  return true;
}
