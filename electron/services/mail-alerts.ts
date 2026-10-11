import { Notification, app, nativeImage } from 'electron';
import { join } from 'node:path';
import {
  BUFFER_MS,
  BURST_WINDOW_MS,
  REPLY_UNDO_MS,
  SOUND_GAP_MS,
  cardRow,
  decide,
  effectivePreview,
  groupContent,
  groupKind,
  groupRows,
  groupTitle,
  inboxRoute,
  includedUnread,
  isMailReceived,
  messageRoute,
  nativeContent,
  parseArrival,
  parseBurstRest,
  parseCleared,
  pauseChoices,
  pauseLabel,
  pauseOver,
  pausedNow,
  replyDraftContext,
  replyHtml,
  replySubject,
  senderOf,
  startPause,
  stricterPreview,
  summaryTitle,
  trayAccounts,
  workingHoursOf,
  type DeviceView,
  type GroupKind,
  type MailAlertAction,
  type MailAlertCard,
  type MailAlertState,
  type MailArrival,
  type MailPause,
  type NativeContent,
  type PauseMode,
  type PreviewLevel,
  type TrayMailAccount,
  type WorkingHours,
} from '@shared/mail-alerts';
import type { MutationInput, SubmitResult } from '@shared/ipc/contract';
import type { Preferences } from '@shared/types';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import { MailAlertsApi, PRESENCE_EVERY_MS, type ServerAlertPrefs } from './mail-alerts-api';
import type { RealtimeEvent } from './realtime';

const log = logger('mail-alerts');

/**
 * New-mail alerts on this computer (ENH-MAIL-05, WF-N01…N06).
 *
 * New mail is heard of from the server — its `mail.received` push, the bell's copy of it, or the unread count going
 * up (the desktop has no IMAP of its own: Mail's sync runs on the server) — and every way leads here, where one
 * message makes one alert at most (keyed by mailbox, folder and UID; NFR-MNA-03). Then, in order:
 *
 *  1. Mail off for the person, or their banners off → nothing.
 *  2. Held two seconds, so a burst is seen as one (WF-N04).
 *  3. Where it goes (Section 3.1): Mail showing that folder → the row's "New" only; paused or the system's
 *     Focus / do not disturb → the badge and the bell only, no sound; WorkSuite in front → the in-app card (D27);
 *     otherwise → the system's notification (D26). Never both.
 *  4. More than three in a minute → one alert for the account, or across accounts; one sound in ten seconds at most,
 *     and an alert that replaces one already shown makes none (MNA-GRP).
 *  5. What it shows follows the preview level, the organisation's minimum, screen sharing and the lock (MNA-PRV).
 *
 * An alert goes, wherever it is, when its message is read, archived, deleted or moved — here or anywhere
 * (`mail.alert_cleared`, MNA-EVT-06). The tray's mail lines, the pause and the badge's mail count come from here too.
 */

export interface MailAlertHost {
  prefs(): Preferences;
  userId(): string | null;
  deviceId(): string;
  appVersion(): string;
  /** The main window: shown and not minimised (not closed to the tray), and whether it has the keyboard. */
  window(): { visible: boolean; focused: boolean };
  /** The operating system's Focus / do not disturb (system-focus.ts). */
  osDnd(): boolean;
  /** WorkSuite's own quiet: its do-not-disturb hours, or every notification paused from the tray. */
  appQuiet(): boolean;
  locked(): boolean;
  /** The screen is being shared from this computer (WorkSuite Meet, or any capture it granted). */
  sharing(): boolean;
  /** The person may open Mail. */
  mailAllowed(): boolean;
  /** The organisation's minimum for every notification on this computer (desktop policy), as a preview level. */
  policyMinPreview(): PreviewLevel | null;
  /** To the main window. */
  send(channel: 'mail-alert:show' | 'mail-alert:clear' | 'mail-alert:list' | 'mail-alert:state', payload: unknown): void;
  /** Opens a route in the main window, bringing it forward. */
  open(route: string): void;
  /** Mail's own send path: the offline queue's `POST /api/mail/send` (queued when offline, sent once). */
  submit(input: MutationInput): Promise<SubmitResult>;
  /** Keeps a reply that was not sent as the composer's draft for that message. */
  saveDraft(context: string, content: unknown): void;
  /** This computer's pause for this person (Preferences.mailAlertPause). */
  savePause(userId: string, pause: MailPause | null): void;
  /** Which new mail may alert (Focused / VIPs, DMO-NTF-02) and whether it may break WorkSuite's quiet hours. */
  accept?(a: MailArrival): Promise<{ alert: boolean; breakthrough: boolean; sound?: boolean }>;
  dismiss?(a: MailArrival): void;
  /** The tray, the badge and the status changed. */
  changed(): void;
}

interface Live {
  id: string;
  kind: GroupKind | 'summary';
  items: MailArrival[];
  /** The server's "and the rest" (a burst bigger than it announces one by one), by account. */
  rest: Map<number, number>;
  conversation: string | null;
  delivery: 'card' | 'native';
  note: Notification | null;
  card: MailAlertCard | null;
}

interface PendingReply {
  id: string;
  arrival: MailArrival;
  text: string;
  timer: NodeJS.Timeout;
  note: Notification | null;
}

/** Remembered message keys: enough for a day of mail, so a message heard of twice never alerts twice. */
const SEEN_MAX = 5_000;

export class MailAlertService {
  readonly api: MailAlertsApi;
  private seen = new Map<string, number>();
  private cleared = new Set<string>();
  private buffer: MailArrival[] = [];
  /** The rest of a big burst the server summed up (`kind: summary`), waiting with the buffer, by account. */
  private bufferRest = new Map<number, number>();
  /** …and what of it is being shown, with the alerts of the last minute. */
  private recentRest = new Map<number, { count: number; at: number }>();
  /** …and what of it came while paused. */
  private heldRest = 0;
  private bufferTimer: NodeJS.Timeout | null = null;
  /** What was alerted in the last minute, for the burst rule. */
  private recent: MailArrival[] = [];
  private live = new Map<string, Live>();
  private lastSound = Number.NEGATIVE_INFINITY;
  /** What arrived while paused: the resume summary counts it (MNA-TRY-04). */
  private held = new Map<string, MailArrival>();
  private wasPaused = false;
  private generation = 0;
  private mutedKeys = new Set<string>();
  private server: ServerAlertPrefs = { preview: null, minPreview: null, sound: null };
  private hours: WorkingHours | null = null;
  private hoursKnown = false;
  private accounts: TrayMailAccount[] = [];
  private pending = new Map<string, PendingReply>();
  private latest: MailAlertCard | null = null;
  private tick: NodeJS.Timeout | null = null;
  private countsTimer: NodeJS.Timeout | null = null;
  /** The end of a pause that ends by itself, to the second (the 30 s tick catches the rest). */
  private pauseEnd: NodeJS.Timeout | null = null;
  private countsNudge: NodeJS.Timeout | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;
  /** The main window's place, as it reports it (`mailAlert:view`). */
  private place: { module: string | null; box: string | null; folder: string | null } = { module: null, box: null, folder: null };
  /** Messages that may break WorkSuite's quiet hours (a VIP's, when allowed: DMO-NTF-03). */
  private breakthrough = new Set<string>();
  /** When each message of the last minute was alerted: the burst rule counts these. */
  private alertedAt = new Map<string, number>();
  private seq = 0;
  private started = false;
  readonly platform: NodeJS.Platform;

  constructor(
    http: Pick<HttpClient, 'get' | 'post' | 'request'>,
    private readonly host: MailAlertHost,
    platform: NodeJS.Platform = process.platform,
  ) {
    this.api = new MailAlertsApi(http);
    this.platform = platform;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;
    this.wasPaused = this.isPaused();
    void this.loadServerPrefs();
    void this.loadHours();
    void this.refreshCounts();
    this.countsTimer = setInterval(() => void this.refreshCounts(), 120_000);
    this.countsTimer.unref?.();
    // The pause runs out, and working hours begin and end, without anybody saying so.
    this.tick = setInterval(() => this.checkPause(), 30_000);
    this.tick.unref?.();
    this.armPauseEnd();
    void this.heartbeat();
    this.presenceTimer = setInterval(() => void this.heartbeat(), PRESENCE_EVERY_MS);
    this.presenceTimer.unref?.();
  }

  stop(): void {
    this.generation++;
    this.mutedKeys.clear();
    // The web may notify again at once, rather than when the heartbeat goes stale (MNA-WEB-07).
    if (this.started) void this.api.gone(this.host.deviceId()).catch(() => undefined);
    this.started = false;
    for (const t of [this.tick, this.countsTimer, this.presenceTimer]) if (t) clearInterval(t);
    for (const t of [this.bufferTimer, this.countsNudge, this.pauseEnd]) if (t) clearTimeout(t);
    this.tick = this.countsTimer = this.presenceTimer = this.bufferTimer = this.countsNudge = this.pauseEnd = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.note?.close();
    }
    this.pending.clear();
    for (const l of [...this.live.values()]) this.close(l, false);
    this.live.clear();
    this.host.send('mail-alert:clear', { all: true });
    this.seen.clear();
    this.cleared.clear();
    this.buffer = [];
    this.bufferRest.clear();
    this.recentRest.clear();
    this.heldRest = 0;
    this.recent = [];
    this.alertedAt.clear();
    this.breakthrough.clear();
    this.held.clear();
    this.accounts = [];
    this.latest = null;
    this.server = { preview: null, minPreview: null, sound: null };
  }

  /** The main window says where it is: the app in front, and in Mail the account (or All Accounts) and folder. */
  setPlace(p: { module: string | null; box: string | null; folder: string | null }): void {
    this.place = { module: p.module, box: p.box, folder: p.folder };
  }

  /** What this computer shows now (Section 3.1). */
  view(): DeviceView {
    const w = this.host.window();
    const { module, box, folder } = this.place;
    return { visible: w.visible, focused: w.focused, module, mail: module === 'mail' && box && folder ? { box, folder } : null };
  }

  // ── what is heard ──────────────────────────────────────────────────────────

  /**
   * A server notification Mail shows its own way: a new email's bell entry never pops up as a plain banner (it is
   * in the bell already; the alert is this service's). True when it took it.
   */
  claim(n: { event: string | null }): boolean {
    // The realtime push itself (with the whole payload) reaches `handleRealtime`; a bell entry the push missed, found
    // in the list later, stays in the bell — a late alert with half its words is worse than none.
    return n.event === 'mail.received';
  }

  /** Mail's realtime events: new mail, an alert cleared, and the counts moving. */
  handleRealtime(e: RealtimeEvent): void {
    if ((e.type === 'notification' && isMailReceived(e)) || (e.type === 'mail' && e.event === 'mail.received')) {
      const a = parseArrival(e);
      if (a) this.ingest(a);
      else this.ingestRest(e);
      return;
    }
    if (e.type === 'notification.read') {
      const contexts = Array.isArray(e.contextKeys) ? e.contextKeys : [];
      if (e.all) {
        const known = [...this.buffer, ...this.recent, ...this.held.values(), ...[...this.live.values()].flatMap((l) => l.items)];
        for (const mailbox of new Set(known.map((a) => a.mailbox))) this.withdrawMailbox(mailbox);
      } else {
        const messages = contexts.flatMap((context) => {
          const m = String(context).match(/^mail:(\d+):(\d+)$/);
          return m ? [{ mailbox: Number(m[1]), uid: Number(m[2]) }] : [];
        });
        if (messages.length) this.withdraw(messages);
      }
      return;
    }
    if (e.type !== 'mail') return;
    if (e.event === 'mail.alert_cleared') {
      const c = parseCleared(e);
      if (c?.all) this.withdrawMailbox(c.mailbox);
      else if (c) this.withdraw(c.uids.map((uid) => ({ mailbox: c.mailbox, uid, folder: c.folder })));
      return;
    }
    if (e.event === 'mail.counts' || e.event === 'mail.changed') this.nudgeCounts();
  }

  /**
   * After the socket was down (asleep, reconnecting): the alerts the push missed in the last few minutes, from the
   * server's own list — each still once (the same key), and none already cleared.
   */
  async catchUp(now = Date.now()): Promise<void> {
    if (!this.host.userId() || !this.host.mailAllowed()) return;
    try {
      for (const r of await this.api.recent()) {
        if (r.cleared || !r.data || !(now - r.createdAt <= 15 * 60_000)) continue;
        const a = parseArrival({ event: 'mail.received', ...r.data }, now);
        if (a) this.ingest(a);
      }
    } catch {
      // An older server: the count going up still finds new mail.
    }
  }

  /**
   * New messages seen another way (the unread count went up and the newest were listed): the same path as the
   * push, so one heard of both ways alerts once. `quiet`: a first look, an import or a re-sync — remembered, never
   * alerted (MNA-GRP-03, AC-MNA-12).
   */
  ingestListed(rows: unknown[], quiet: boolean): void {
    for (const r of rows) {
      const a = parseArrival(r);
      if (!a) continue;
      if (quiet) this.remember(a.key);
      else this.ingest(a);
    }
  }

  /** The server summed up the rest of a burst: it joins the group with the messages it announced (MNA-EVT-07). */
  private ingestRest(e: unknown): void {
    const r = parseBurstRest(e);
    if (!r || !this.host.userId() || !this.host.mailAllowed()) return;
    const id = String((e as { id?: unknown }).id ?? '');
    if (id && !this.remember(`rest:${id}`)) return;
    this.bufferRest.set(r.mailbox, (this.bufferRest.get(r.mailbox) ?? 0) + r.count);
    this.armBuffer();
  }

  private armBuffer(): void {
    if (this.bufferTimer) return;
    this.bufferTimer = setTimeout(() => {
      this.bufferTimer = null;
      this.flush();
    }, BUFFER_MS);
    this.bufferTimer.unref?.();
  }

  private remember(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.set(key, Date.now());
    if (this.seen.size > SEEN_MAX) {
      const drop = this.seen.size - SEEN_MAX;
      let i = 0;
      for (const k of this.seen.keys()) {
        if (i++ >= drop) break;
        this.seen.delete(k);
      }
    }
    return true;
  }

  /** One message, once: buffered for grouping. */
  ingest(a: MailArrival): void {
    if (!this.host.userId() || !this.host.mailAllowed()) return;
    if (this.cleared.has(a.key) || !this.remember(a.key)) return;
    // The account's name, from the tray's list when the event did not say it.
    void this.admit(a.account ? a : { ...a, account: this.accounts.find((x) => x.id === a.mailbox)?.label ?? 'Mail' });
  }

  private async admit(a: MailArrival): Promise<void> {
    const generation = this.generation;
    const user = this.host.userId();
    let breakthrough = false;
    if (this.host.accept) {
      try {
        const r = await this.host.accept(a);
        if (!r.alert) return;
        breakthrough = r.breakthrough;
        if (r.sound === false) {
          this.mutedKeys.add(a.key);
          if (this.mutedKeys.size > 500) this.mutedKeys.delete(this.mutedKeys.values().next().value!);
        }
      } catch {
        // Which mail may alert could not be worked out: if in doubt, say it (WF-DO01 fails open).
      }
    }
    if (generation !== this.generation || user !== this.host.userId() || this.cleared.has(a.key)) return;
    if (breakthrough) this.breakthrough.add(a.key);
    this.buffer.push(a);
    this.armBuffer();
  }

  /** Banners for mail at all on this computer (the settings): off, and only the badge and the bell move. */
  private bannersOn(): boolean {
    const p = this.host.prefs();
    return p.notificationsEnabled !== false && p.backgroundServices?.notifications !== false && p.moduleNotifications?.mail !== false && (p.mailAlerts ?? 'all') !== 'none';
  }

  /** The buffer's two seconds are up: decide, group and show. */
  flush(now = Date.now()): void {
    const batch = this.buffer.filter((a) => !this.cleared.has(a.key));
    const rest = new Map(this.bufferRest);
    this.buffer = [];
    this.bufferRest.clear();
    if (!batch.length && !rest.size) return;
    const view = this.view();
    const paused = this.isPaused();
    const dnd = this.host.osDnd();
    const appQuiet = this.host.appQuiet();
    const shown: MailArrival[] = [];
    const listed: MailArrival[] = [];
    let delivery: 'card' | 'native' | null = null;
    for (const a of batch) {
      const quietHere = appQuiet && !this.breakthrough.has(a.key);
      this.breakthrough.delete(a.key);
      const d = decide(view, { paused, dnd: dnd || quietHere }, a);
      if (d === 'list') listed.push(a);
      else if (d === 'quiet') {
        if (paused) this.held.set(a.key, a);
      } else {
        delivery = d;
        shown.push(a);
      }
    }
    if (listed.length) this.host.send('mail-alert:list', { keys: listed.map((a) => a.key) });
    // The rest of a big burst: held while paused, else with the group (it never shows on its own).
    let extra = [...rest.values()].reduce((n, c) => n + c, 0);
    if (extra && (paused || dnd || appQuiet)) {
      if (paused) this.heldRest += extra;
      extra = 0;
    }
    if (extra && !delivery) delivery = view.visible && view.focused ? 'card' : 'native';
    if ((!shown.length && !extra) || !delivery || !this.bannersOn()) return;
    if (extra) for (const [mailbox, count] of rest) this.recentRest.set(mailbox, { count: (this.recentRest.get(mailbox)?.count ?? 0) + count, at: now });
    for (const [mailbox, r] of this.recentRest) if (now - r.at >= BURST_WINDOW_MS) this.recentRest.delete(mailbox);

    for (const a of shown) this.alertedAt.set(a.key, now);
    this.recent = [...this.recent, ...shown].filter((a) => now - (this.alertedAt.get(a.key) ?? 0) < BURST_WINDOW_MS && !this.cleared.has(a.key));
    for (const [k, t] of this.alertedAt) if (now - t >= BURST_WINDOW_MS) this.alertedAt.delete(k);
    const restNow = new Map([...this.recentRest].map(([m, r]) => [m, r.count] as const));
    const kind = groupKind([...this.recent, ...[...restNow].flatMap(([mailbox, count]) => Array.from({ length: Math.min(count, 10) }, () => ({ mailbox })))]);
    if (kind === 'single') {
      shown.forEach((a, i) => this.showSingle(a, delivery!, i > 0, now));
      return;
    }
    // A burst: one alert for all of it. The single alerts it takes over go; an earlier group is replaced, silently.
    const items = [...this.recent].reverse();
    const keys = new Set(items.map((a) => a.key));
    let replacing = false;
    for (const l of [...this.live.values()]) {
      if (l.kind === 'summary') continue;
      if (l.kind !== 'single' || l.items.some((a) => keys.has(a.key))) {
        replacing = true;
        this.close(l, false);
      }
    }
    this.showGroup(kind, items, restNow, delivery, replacing, now);
  }

  // ── showing ────────────────────────────────────────────────────────────────

  private level(): PreviewLevel {
    const chosen = this.host.prefs().mailAlertPreview ?? this.server.preview ?? 'full';
    const min = stricterPreview(this.server.minPreview ?? 'full', this.host.policyMinPreview() ?? 'full');
    // Confidential mail's preview is never shown at any level (MNA-PRV-03): `nativeContent` and `cardRow` leave it out.
    return effectivePreview(chosen, min, { sharing: this.host.sharing(), locked: this.host.locked() });
  }

  /** Never fuller than the server wrote the event: it has left out what its level hides. */
  private levelFor(items: readonly MailArrival[]): PreviewLevel {
    return items.reduce<PreviewLevel>((lvl, a) => stricterPreview(lvl, a.level), this.level());
  }

  private restOf(l: Pick<Live, 'rest'>): number {
    return [...l.rest.values()].reduce((n, c) => n + c, 0);
  }

  private soundOn(): boolean {
    const p = this.host.prefs();
    return (p.mailAlertSound ?? this.server.sound ?? true) && p.notificationSounds !== false;
  }

  /**
   * One sound in ten seconds at most (MNA-GRP-04), and one for a burst: while mail keeps coming (others alerted in the
   * last minute) the next sound waits the minute out — so six emails in half a minute ring once (AC-MNA-05). An alert
   * that replaces one already there makes none.
   */
  private takeSound(replacing: boolean, now: number, others: number): boolean {
    const gap = others > 0 ? BURST_WINDOW_MS : SOUND_GAP_MS;
    if (replacing || !this.soundOn() || now - this.lastSound < Math.max(gap, SOUND_GAP_MS)) return false;
    this.lastSound = now;
    return true;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`;
  }

  private showSingle(a: MailArrival, delivery: 'card' | 'native', silent: boolean, now: number): void {
    // A new message in a conversation already alerted replaces its alert (tag per conversation, MNA-WIN-06).
    const before = [...this.live.values()].find((l) => l.kind === 'single' && l.conversation === a.conversation);
    if (before) this.close(before, false);
    const sound = !silent && !this.mutedKeys.has(a.key) && this.takeSound(false, now, this.recent.filter((x) => x.key !== a.key).length);
    const level = this.levelFor([a]);
    const live: Live = { id: this.nextId('mail'), kind: 'single', items: [a], rest: new Map(), conversation: a.conversation, delivery, note: null, card: null };
    if (delivery === 'card') {
      live.card = this.cardFor(live, level);
      this.live.set(live.id, live);
      this.latest = live.card;
      this.host.send('mail-alert:show', { card: live.card, sound });
      this.host.changed();
      return;
    }
    const content = nativeContent(a, level, this.platform);
    const replyable = level === 'full' && !a.confidential && !this.host.locked() && (this.platform === 'darwin' || this.platform === 'win32');
    const buttons = level === 'hidden' || this.host.locked() || !this.actionsSupported() ? [] : ['Mark as read', 'Archive', 'Flag'];
    live.note = this.notify(content, {
      tag: `mail-conv:${a.conversation}`,
      group: a.mailbox,
      groupTitle: a.account,
      silent: !sound,
      reply: replyable ? `Reply to ${senderOf(a)}` : null,
      buttons,
      onClick: () => this.act(live, 'open', a.key),
      onButton: (i) => this.act(live, (['read', 'archive', 'flag'] as const)[i] ?? 'open', a.key),
      onReply: (text) => this.act(live, 'reply', a.key, text),
      onClose: () => { if (this.live.has(live.id)) for (const a of live.items) this.host.dismiss?.(a); this.live.delete(live.id); },
    });
    this.live.set(live.id, live);
    this.latest = this.cardFor(live, level);
    this.host.changed();
  }

  private showGroup(kind: Exclude<GroupKind, 'single'>, items: MailArrival[], rest: Map<number, number>, delivery: 'card' | 'native', replacing: boolean, now: number): void {
    const sound = items.some((a) => !this.mutedKeys.has(a.key)) && this.takeSound(replacing, now, 0);
    const level = this.levelFor(items);
    const account = kind === 'account' ? (items[0]?.mailbox ?? [...rest.keys()][0] ?? null) : null;
    const live: Live = { id: this.nextId('mail-group'), kind, items, rest, conversation: null, delivery, note: null, card: null };
    live.card = this.cardFor(live, level);
    this.latest = live.card;
    if (delivery === 'card') {
      this.live.set(live.id, live);
      this.host.send('mail-alert:show', { card: live.card, sound });
      this.host.changed();
      return;
    }
    const content = groupContent(kind, items, level, this.platform, this.restOf(live), [...rest.keys()]);
    live.note = this.notify(content, {
      tag: kind === 'account' ? `mail-group:${account}` : 'mail-group:all',
      group: account,
      groupTitle: kind === 'account' ? (items[0]?.account ?? this.accounts.find((x) => x.id === account)?.label ?? null) : null,
      silent: !sound,
      reply: null,
      buttons: this.actionsSupported() && !this.host.locked() ? [live.card.inbox.label, 'Mark all as read'] : [],
      onClick: () => this.act(live, 'open-inbox'),
      onButton: (i) => this.act(live, i === 0 ? 'open-inbox' : 'read-all'),
      onReply: () => undefined,
      onClose: () => { if (this.live.has(live.id)) for (const a of live.items) this.host.dismiss?.(a); this.live.delete(live.id); },
    });
    this.live.set(live.id, live);
    this.host.changed();
  }

  /** The card for an alert (D27), which the main window shows, or keeps for Ctrl+Shift+N. */
  private cardFor(l: Live, level: PreviewLevel): MailAlertCard {
    const now = Date.now();
    const kind = l.kind;
    const items = l.items;
    const single = kind === 'single';
    const extra = this.restOf(l);
    const grouped = single ? { rows: items, more: 0 } : groupRows(kind === 'account' ? 'account' : 'accounts', items);
    const rows = grouped.rows;
    const more = grouped.more + extra;
    const accounts = new Set([...items.map((a) => a.mailbox), ...l.rest.keys()]).size;
    const oldest = items.reduce((t, a) => Math.min(t, a.at), now);
    const mins = Math.max(1, Math.round((now - oldest) / 60_000));
    const firstBox = items[0]?.mailbox ?? [...l.rest.keys()][0] ?? null;
    const account = kind === 'account' && firstBox ? { mailbox: firstBox, account: items[0]?.account || this.accounts.find((x) => x.id === firstBox)?.label || '' } : null;
    const title = single
      ? (level === 'hidden' ? `New email in ${items[0]?.account || 'your inbox'}` : senderOf(items[0]!))
      : kind === 'summary'
        ? summaryTitle(items.length + extra)
        : groupTitle(kind, items, extra, [...l.rest.keys()]);
    return {
      id: l.id,
      kind,
      title,
      subtitle: single ? items[0]?.account || null : kind === 'accounts' || kind === 'summary' ? `${accounts === 1 ? '1 account' : `${accounts} accounts`} · last ${mins} min` : null,
      rows: (single ? items : rows).map((a) => cardRow(a, level)),
      more,
      high: items.some((a) => a.importance === 'high') && level !== 'hidden',
      level,
      replyable: single && level === 'full' && !items[0]?.confidential && !this.host.locked(),
      inbox: account ? { label: `Open ${account.account || 'account'} inbox`, route: inboxRoute(account.mailbox) } : { label: 'Open Inbox', route: inboxRoute(null) },
      at: new Date(now).toISOString(),
    };
  }

  private actionsSupported(): boolean {
    return this.platform === 'darwin' || this.platform === 'win32';
  }

  private icon() {
    if (this.platform === 'darwin') return undefined;
    try {
      return nativeImage.createFromPath(join(app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources'), 'icons', '128x128.png'));
    } catch {
      return undefined;
    }
  }

  private notify(
    content: NativeContent,
    o: { tag: string; group: number | null; groupTitle: string | null; silent: boolean; reply: string | null; buttons: string[]; onClick: () => void; onButton: (i: number) => void; onReply: (text: string) => void; onClose: () => void },
  ): Notification | null {
    if (!Notification.isSupported()) return null;
    const note = new Notification({
      title: content.title,
      ...(content.subtitle ? { subtitle: content.subtitle } : {}),
      body: content.body,
      silent: o.silent,
      icon: this.icon(),
      // Windows: a header per account in Action Center, and one toast per conversation (MNA-WIN-06).
      id: o.tag,
      ...(o.group ? { groupId: `mail-account-${o.group}`, ...(o.groupTitle ? { groupTitle: o.groupTitle } : {}) } : {}),
      hasReply: !!o.reply,
      ...(o.reply ? { replyPlaceholder: o.reply } : {}),
      ...(o.buttons.length ? { actions: o.buttons.map((text) => ({ type: 'button' as const, text })) } : {}),
      urgency: 'normal',
      timeoutType: 'default',
    });
    note.on('click', () => o.onClick());
    note.on('action', (_e, index) => o.onButton(index));
    note.on('reply', (details, legacy) => {
      // Electron passes the words in the event's details, and in an older second argument some versions still fill.
      const text = [(details as { reply?: unknown } | undefined)?.reply, legacy].map((v) => (typeof v === 'string' ? v.trim() : '')).find(Boolean) ?? '';
      if (text) o.onReply(text);
      else o.onClick();
    });
    note.on('close', () => o.onClose());
    note.on('failed', (_e, error) => log.info('the system refused a mail notification', { error: String(error).slice(0, 200) }));
    note.show();
    return note;
  }

  /** An alert goes: its notification closes, its card leaves the main window. */
  private close(l: Live, update = true): void {
    this.live.delete(l.id);
    l.note?.close();
    if (this.platform === 'darwin' && l.note && typeof Notification.remove === 'function') {
      try {
        Notification.remove(l.kind === 'single' ? `mail-conv:${l.conversation}` : `mail-group:${l.items[0]?.mailbox ?? 'all'}`);
      } catch {
        /* an older system */
      }
    }
    if (l.delivery === 'card' || l.card) this.host.send('mail-alert:clear', { ids: [l.id] });
    if (this.latest?.id === l.id) this.latest = null;
    if (update) this.host.changed();
  }

  // ── acting from an alert ────────────────────────────────────────────────────

  /**
   * What a card or a notification asks for (`mailAlert:action`). Locked, or without Mail any more, everything opens
   * WorkSuite instead; a refusal opens the message, so nothing is lost.
   */
  async action(input: { id?: string | null; key?: string | null; action: MailAlertAction; text?: string | null }): Promise<{ ok: boolean; sending?: { id: string; at: number } | null }> {
    const l = input.id ? (this.live.get(input.id) ?? null) : input.key ? ([...this.live.values()].find((x) => x.items.some((a) => a.key === input.key)) ?? null) : null;
    if (input.action === 'undo') return { ok: input.id ? this.undoReply(input.id) : false };
    if (!l) {
      // A card the main window still shows after this computer forgot it (a restart): open what it names.
      if (input.action === 'open-inbox') this.host.open(inboxRoute(null));
      else if (input.key) {
        const [mailbox, folder, uid] = input.key.split(':');
        if (mailbox && folder && uid) this.host.open(messageRoute({ mailbox: Number(mailbox), folder, uid: Number(uid) }));
      }
      return { ok: false };
    }
    return this.act(l, input.action, input.key ?? undefined, input.text ?? undefined);
  }

  private async act(l: Live, action: MailAlertAction, key?: string, text?: string): Promise<{ ok: boolean; sending?: { id: string; at: number } | null }> {
    const a = (key ? l.items.find((x) => x.key === key) : null) ?? (l.kind === 'single' ? (l.items[0] ?? null) : null);
    if (action === 'dismiss') {
      // Dismissed, it stays in the bell (MNA-APP-05); only the card goes.
      this.live.delete(l.id);
      return { ok: true };
    }
    if (action === 'open-inbox') {
      const one = l.kind === 'account' ? (l.items[0]?.mailbox ?? null) : null;
      this.host.open(inboxRoute(one));
      this.close(l);
      return { ok: true };
    }
    if (action === 'open' || this.host.locked() || !this.host.mailAllowed()) {
      this.host.open(a ? messageRoute(a) : inboxRoute(null));
      if (action === 'open' && a) this.withdraw([{ mailbox: a.mailbox, uid: a.uid, folder: a.folder }], false);
      return { ok: action === 'open' };
    }
    if (action === 'reply') {
      if (!a) return { ok: false };
      if (!text?.trim()) {
        this.host.open(messageRoute(a, true));
        return { ok: true };
      }
      return { ok: true, sending: this.queueReply(a, text.trim(), l) };
    }
    const targets = action === 'read-all' ? l.items : a ? [a] : [];
    if (!targets.length) return { ok: false };
    try {
      if (action === 'flag') {
        await this.api.act(targets[0]!, 'star');
        await this.api.flag(targets[0]!).catch(() => undefined);
        // Flagged, the message is still new: only its alert goes from here.
        this.withdraw(targets.map((t) => ({ mailbox: t.mailbox, uid: t.uid, folder: t.folder })), false);
      } else {
        const verb = action === 'archive' ? 'archive' : 'read';
        await Promise.all(targets.map((t) => this.api.act(t, verb)));
        this.withdraw(targets.map((t) => ({ mailbox: t.mailbox, uid: t.uid, folder: t.folder })));
      }
      this.nudgeCounts();
      return { ok: true };
    } catch (e) {
      log.debug('a mail alert action failed', { action, code: isDesktopError(e) ? e.code : String(e) });
      this.host.open(targets.length === 1 ? messageRoute(targets[0]!) : inboxRoute(null));
      return { ok: false };
    }
  }

  // ── a quick reply (MNA-WIN-04, AC-MNA-01) ───────────────────────────────────

  /**
   * A reply typed in a notification or a card: it waits Mail's undo window, then goes through Mail's own send path
   * (the outbox's `POST /api/mail/send` — the server's outbound scan and Sent copy, queued if offline), from the
   * mailbox the message came to, threaded on it. Sent, the message is marked read and its alert goes. Refused, the
   * words become the reply's draft and a "not sent" notification opens it.
   */
  private queueReply(a: MailArrival, text: string, l: Live | null): { id: string; at: number } {
    const id = this.nextId('reply');
    const at = Date.now() + REPLY_UNDO_MS;
    // The alert's own notification is answered; a silent one says it is going, with Undo where the system has buttons.
    if (l?.note) l.note.close();
    const note =
      l?.delivery === 'native'
        ? this.notify(
            { title: `Sending your reply to ${senderOf(a)}`, body: `In ${Math.round(REPLY_UNDO_MS / 1000)} s · ${replySubject(a.subject)}` },
            { tag: `mail-reply:${id}`, group: null, groupTitle: null, silent: true, reply: null, buttons: this.actionsSupported() ? ['Undo'] : [], onClick: () => undefined, onButton: () => void this.undoReply(id), onReply: () => undefined, onClose: () => undefined },
          )
        : null;
    const timer = setTimeout(() => void this.sendReply(id), REPLY_UNDO_MS);
    timer.unref?.();
    this.pending.set(id, { id, arrival: a, text, timer, note });
    return { id, at };
  }

  /** Takes a reply back inside its window: the words open as the reply's draft. */
  undoReply(id: string): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    p.note?.close();
    this.pending.delete(id);
    this.keepDraft(p.arrival, p.text, null);
    this.host.open(messageRoute(p.arrival, true));
    return true;
  }

  private keepDraft(a: MailArrival, text: string, messageId: string | null): void {
    try {
      this.host.saveDraft(replyDraftContext(messageId, a.subject), { to: a.fromAddr ?? '', cc: '', bcc: '', subject: replySubject(a.subject), html: replyHtml(text), quote: '', from: String(a.mailbox), attachments: [], v: 2 });
    } catch (e) {
      log.debug('a reply draft could not be kept', { error: String(e) });
    }
  }

  private async sendReply(id: string): Promise<void> {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.note?.close();
    const a = p.arrival;
    let original: { messageId: string | null; from: string | null; subject: string | null } = { messageId: null, from: null, subject: null };
    try {
      original = await this.api.message(a);
    } catch {
      // Unreachable now: the reply still goes (queued), to the sender the alert named.
    }
    const to = original.from ?? a.fromAddr;
    const subject = replySubject(original.subject ?? a.subject);
    let error: string | null = null;
    if (!to) error = 'The sender’s address is not known.';
    else {
      try {
        const r = await this.host.submit({
          module: 'mail',
          entity: 'message.send',
          entityId: null,
          label: `Send “${subject}” to ${to}`.slice(0, 200),
          method: 'POST',
          path: '/api/mail/send',
          body: { to: [to], cc: [], bcc: [], subject, body_html: replyHtml(p.text), body_text: p.text, ...(original.messageId ? { in_reply_to: original.messageId } : {}), reply_mode: 'reply', mailbox: String(a.mailbox), attachments: [] },
          queueIfOffline: true,
        });
        if (!r.delivered && !r.queued) error = r.error ?? 'The server refused it.';
      } catch (e) {
        error = isDesktopError(e) ? e.message : String(e);
      }
    }
    if (error) return this.replyFailed(a, p.text, original.messageId, error);
    await this.api.act(a, 'read').catch(() => undefined);
    this.withdraw([{ mailbox: a.mailbox, uid: a.uid, folder: a.folder }]);
    this.nudgeCounts();
  }

  private replyFailed(a: MailArrival, text: string, messageId: string | null, error: string): void {
    log.info('a reply from a mail alert was not sent', { code: error.slice(0, 120) });
    this.keepDraft(a, text, messageId);
    const open = () => this.host.open(messageRoute(a, true));
    this.notify(
      { title: `Your reply to ${senderOf(a)} was not sent`, body: `${error} It is kept as a draft.` },
      { tag: `mail-reply-failed:${a.key}`, group: null, groupTitle: null, silent: false, reply: null, buttons: this.actionsSupported() ? ['Open draft'] : [], onClick: open, onButton: open, onReply: () => undefined, onClose: () => undefined },
    );
    this.host.send('mail-alert:clear', { failed: { key: a.key, error } });
  }

  // ── withdrawal (MNA-EVT-06, WF-N06) ─────────────────────────────────────────

  /**
   * Messages read, archived, deleted or moved, here or anywhere: their alerts go — the notification, the card, a
   * group's row — and what is still waiting for its two seconds, or held by a pause, is dropped.
   */
  withdraw(list: Array<{ mailbox: number; uid: number; folder?: string | null }>, recount = true): void {
    const keys = new Set<string>();
    const match = (a: MailArrival) => list.some((m) => m.mailbox === a.mailbox && m.uid === a.uid && (!m.folder || m.folder === a.folder));
    for (const m of list) keys.add(`${m.mailbox}:${m.folder ?? 'inbox'}:${m.uid}`);
    for (const k of keys) this.cleared.add(k);
    this.buffer = this.buffer.filter((a) => !match(a));
    this.recent = this.recent.filter((a) => !match(a));
    for (const [k, a] of this.held) if (match(a)) this.held.delete(k);
    for (const l of [...this.live.values()]) {
      const left = l.items.filter((a) => !match(a));
      if (left.length === l.items.length) continue;
      for (const a of l.items) if (match(a)) this.cleared.add(a.key);
      if ((!left.length && !this.restOf(l)) || l.kind === 'single') {
        this.close(l, false);
        continue;
      }
      l.items = left;
      if (l.delivery === 'card') {
        l.card = this.cardFor(l, this.level());
        this.host.send('mail-alert:show', { card: l.card, sound: false, update: true });
      }
    }
    if (this.latest && this.latest.rows.every((r) => this.cleared.has(r.key))) this.latest = null;
    if (recount) this.nudgeCounts();
    this.host.changed();
  }

  /** "Mark all as read" in an Inbox, anywhere: every alert of that mailbox goes, the server's "and the rest" with them. */
  withdrawMailbox(mailbox: number): void {
    const known = [...this.buffer, ...this.recent, ...this.held.values(), ...[...this.live.values()].flatMap((l) => l.items)].filter((a) => a.mailbox === mailbox && a.folder === 'inbox');
    this.bufferRest.delete(mailbox);
    this.recentRest.delete(mailbox);
    for (const l of [...this.live.values()]) if (l.rest.delete(mailbox) && !l.items.length && !this.restOf(l)) this.close(l, false);
    this.withdraw(known.map((a) => ({ mailbox: a.mailbox, uid: a.uid, folder: a.folder })));
  }

  /** The main window opened or acted on a message: its alert has done its job (`mailAlert:clear`). */
  seenHere(m: { mailbox: number; folder: string; uid: number }): void {
    this.withdraw([m]);
  }

  // ── pausing (MNA-TRY-02/04, WF-N05) ─────────────────────────────────────────

  private pauseOf(): MailPause | null {
    const uid = this.host.userId();
    if (!uid) return null;
    return this.host.prefs().mailAlertPause?.[uid] ?? null;
  }

  isPaused(now = new Date()): boolean {
    return pausedNow(this.pauseOf(), now, this.hours);
  }

  /** Pause, or resume with `null`. Stored for this person on this computer, and told to the server for the web. */
  async pause(mode: PauseMode | null, now = new Date()): Promise<MailAlertState> {
    const uid = this.host.userId();
    if (!uid) return this.state(now);
    if (mode === null) {
      this.host.savePause(uid, null);
      let server = 0;
      try {
        server = (await this.api.pause('off')).summary;
      } catch {
        /* an older server: this computer's own count */
      }
      this.resumed(server);
    } else {
      const p = startPause(mode, now, this.hours);
      if (!p) return this.state(now);
      // Pausing again keeps what is already held, and when it started.
      const was = this.pauseOf();
      this.host.savePause(uid, was ? { ...p, since: was.since } : p);
      this.wasPaused = this.isPaused(now);
      this.armPauseEnd(now.getTime());
      void this.api.pause(mode).catch(() => undefined);
    }
    this.host.changed();
    void this.heartbeat();
    return this.state(now);
  }

  private armPauseEnd(now = Date.now()): void {
    if (this.pauseEnd) clearTimeout(this.pauseEnd);
    this.pauseEnd = null;
    const until = this.pauseOf()?.until;
    if (!until || !this.started) return;
    this.pauseEnd = setTimeout(() => {
      this.pauseEnd = null;
      this.checkPause();
    }, Math.max(0, Date.parse(until) - now) + 50);
    this.pauseEnd.unref?.();
  }

  /** Every 30 s: a pause that ran out ends, and working hours starting count as a resume. */
  checkPause(now = new Date()): void {
    const p = this.pauseOf();
    const uid = this.host.userId();
    if (p && uid && pauseOver(p, now)) {
      this.host.savePause(uid, null);
      void this.api.pause('off').catch(() => undefined);
      this.wasPaused = false;
      this.resumed(0);
      this.host.changed();
      return;
    }
    const paused = this.isPaused(now);
    if (this.wasPaused && !paused) this.resumed(0);
    if (this.wasPaused !== paused) this.host.changed();
    this.wasPaused = paused;
  }

  /** One summary of what came while paused, instead of each alert (MNA-TRY-04, AC-MNA-09). */
  private resumed(serverCount: number): void {
    this.wasPaused = false;
    const items = [...this.held.values()].filter((a) => !this.cleared.has(a.key)).sort((x, y) => y.at - x.at);
    const rest = this.heldRest;
    this.held.clear();
    this.heldRest = 0;
    const n = Math.max(items.length + rest, serverCount);
    if (!n || !this.bannersOn() || this.host.osDnd()) return;
    const view = this.view();
    const delivery = view.visible && view.focused ? 'card' : 'native';
    const live: Live = { id: this.nextId('mail-summary'), kind: 'summary', items, rest: new Map(), conversation: null, delivery, note: null, card: null };
    const level = this.level();
    live.card = { ...this.cardFor(live, level), title: summaryTitle(n), more: Math.max(0, n - Math.min(5, items.length)), rows: items.slice(0, 5).map((a) => cardRow(a, level)) };
    this.live.set(live.id, live);
    this.latest = live.card;
    if (delivery === 'card') {
      this.host.send('mail-alert:show', { card: live.card, sound: false });
      return;
    }
    const content = items.length ? groupContent('accounts', items, level, this.platform) : { title: 'WorkSuite Mail', body: '' };
    live.note = this.notify(
      { ...content, title: summaryTitle(n), body: level === 'hidden' ? 'Open WorkSuite to read them.' : content.body },
      { tag: 'mail-summary', group: null, groupTitle: null, silent: true, reply: null, buttons: this.actionsSupported() && items.length ? ['Open Inbox', 'Mark all as read'] : [], onClick: () => this.act(live, 'open-inbox'), onButton: (i) => this.act(live, i === 0 ? 'open-inbox' : 'read-all'), onReply: () => undefined, onClose: () => { if (this.live.has(live.id)) for (const a of live.items) this.host.dismiss?.(a); this.live.delete(live.id); } },
    );
  }

  // ── counts, the tray and the settings ───────────────────────────────────────

  private nudgeCounts(): void {
    if (this.countsNudge) return;
    this.countsNudge = setTimeout(() => {
      this.countsNudge = null;
      void this.refreshCounts();
    }, 3_000);
    this.countsNudge.unref?.();
  }

  /** Unread per included account and sign-in problems (MNA-TRY-01), the badge's mail count (MNA-TRY-03). */
  async refreshCounts(): Promise<void> {
    if (!this.host.userId() || !this.host.mailAllowed()) {
      if (this.accounts.length) {
        this.accounts = [];
        this.host.changed();
      }
      return;
    }
    try {
      const next = trayAccounts(await this.api.mailboxes());
      if (JSON.stringify(next) !== JSON.stringify(this.accounts)) {
        this.accounts = next;
        this.host.changed();
      }
    } catch (e) {
      log.debug('mail counts unavailable', { code: isDesktopError(e) ? e.code : String(e) });
    }
  }

  private async loadServerPrefs(): Promise<void> {
    try {
      this.server = await this.api.prefs();
      this.host.changed();
    } catch {
      // An older server: this computer's settings alone.
    }
  }

  /** The person's working hours from HR; none (no employee record, no HR) hides "Outside working hours". */
  private async loadHours(): Promise<void> {
    try {
      this.hours = workingHoursOf(await this.api.workingHours());
    } catch {
      this.hours = null;
    }
    this.hoursKnown = true;
    this.host.changed();
  }

  /** The desktop is running for this person (MNA-WEB-07): the web then does not notify as well. */
  async heartbeat(): Promise<void> {
    const uid = this.host.userId();
    if (!uid) return;
    try {
      await this.api.presence({ device_id: this.host.deviceId(), platform: this.platform, app_version: this.host.appVersion(), alerts: this.bannersOn() && !this.isPaused() });
    } catch (e) {
      // A server without the heartbeat: stop asking until the next sign-in.
      if (isDesktopError(e) && (e.code === 'NOT_FOUND' || e.code === 'PERMISSION_DENIED' || e.code === 'APP_ACCESS_DENIED') && this.presenceTimer) {
        clearInterval(this.presenceTimer);
        this.presenceTimer = null;
      }
    }
  }

  /** The included inboxes' unread, for the badge (0 for somebody without Mail). */
  unread(): number {
    return this.host.mailAllowed() ? includedUnread(this.accounts) : 0;
  }

  /** The newest alert, for Ctrl+Shift+N (MNA-A11-01). */
  latestCard(): MailAlertCard | null {
    return this.latest;
  }

  state(now = new Date()): MailAlertState {
    const pause = this.pauseOf();
    const chosen = this.host.prefs().mailAlertPreview ?? this.server.preview ?? 'full';
    const min = stricterPreview(this.server.minPreview ?? 'full', this.host.policyMinPreview() ?? 'full');
    return {
      pause,
      paused: pausedNow(pause, now, this.hours),
      pauseLabel: pause ? pauseLabel(pause, now) : null,
      pauseChoices: pauseChoices(now, this.hours),
      hoursNote: this.hours ? null : this.hoursKnown ? 'Outside working hours needs your working hours in HR.' : 'Reading your working hours…',
      preview: stricterPreview(chosen, min),
      minPreview: min === 'full' ? null : min,
      sharing: this.host.sharing(),
      sound: this.soundOn(),
      accounts: this.accounts,
      unread: this.unread(),
      hasLatest: !!this.latest,
    };
  }

  /** Saves the person's preview level and sound on the server too (per user, MNA-PRV-01); an older server ignores it. */
  async savePrefs(p: { preview?: PreviewLevel; sound?: boolean }): Promise<void> {
    try {
      await this.api.savePrefs({ ...(p.preview ? { preview_level: p.preview } : {}), ...(typeof p.sound === 'boolean' ? { sound: p.sound } : {}) });
      if (p.preview) this.server = { ...this.server, preview: p.preview };
      if (typeof p.sound === 'boolean') this.server = { ...this.server, sound: p.sound };
    } catch {
      /* kept on this computer */
    }
    this.host.changed();
  }
}
