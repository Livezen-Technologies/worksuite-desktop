import type { WebchatRingChat, WebchatRingPrefs, WebchatRingState } from '@shared/types';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import type { RealtimeEvent } from './realtime';

const log = logger('webchat-ring');

export const WEBSITE = '/api/chat/widget-admin';

/** What `GET widget-admin/assignments/pending` answers (IncomingChats::waitingFor, LiveActivity::pendingFor). */
export interface PendingAnswer {
  /** Chats assigned to me and not yet opened. */
  pending?: Array<{ conversation_id: number; site?: string | null; visitor?: string | null; by?: string | null; at?: string | null }>;
  /** Unassigned, unanswered chats the escalation ladder has brought to me. */
  waiting?: WaitingContext[];
  /** The organisation's ring cap in seconds; 0 rings until somebody joins. */
  ring_seconds?: number;
  /**
   * The server's ring sessions (RING-09), where it keeps them: every open session that has reached me, in order, each
   * with my silence, its handover time and tone. When present it is the whole truth and `pending`/`waiting` are not read.
   */
  ringing?: RingingEntry[];
  /** Whether this device plays my ring (RING-10); null when the server does not choose. */
  ring_here?: boolean | null;
}

/** One ringing chat as the server's ring sessions describe it (RingSessions::ringingFor). */
export interface RingingEntry extends WaitingContext {
  id?: number;
  kind?: 'waiting' | 'assigned';
  mine?: boolean;
  since?: string | null;
  silenced?: boolean;
  handover_at?: string | null;
  by?: string | null;
}

/** Said when a ring stops for a reason other than me joining (RING-28). */
export const STOP_WORDS: Record<string, string> = {
  visitor_left: 'The visitor left the site before anyone joined. The chat is in Missed chats.',
  visitor_ended: 'The visitor ended the chat.',
  closed: 'The chat was closed before anyone joined.',
  blocked: 'The visitor was blocked.',
};

/** A waiting chat's context, as `IncomingChats::context` and `chat.incoming` carry it. */
export interface WaitingContext {
  conversation_id: number;
  visitor?: string | null;
  site?: string | null;
  page?: string | null;
  city?: string | null;
  country?: string | null;
  device?: string | null;
  browser?: string | null;
  returning?: boolean;
  priority?: string | null;
  offline?: boolean;
  waiting_since?: string | null;
  at?: string | null;
  at_risk?: boolean;
  stage?: string | null;
  preview?: string | null;
}

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent', 'vip']);
const LOUD = new Set(['high', 'urgent', 'vip']);
const text = (v: unknown, max = 160): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const id = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

function fromContext(c: WaitingContext, prev: WebchatRingChat | undefined): WebchatRingChat | null {
  const cid = id(c.conversation_id);
  if (!cid) return null;
  const priority = PRIORITIES.has(String(c.priority)) ? (String(c.priority) as WebchatRingChat['priority']) : 'normal';
  return {
    id: cid,
    visitor: text(c.visitor, 120) ?? prev?.visitor ?? 'A visitor',
    site: text(c.site, 120) ?? prev?.site ?? null,
    page: text(c.page, 200) ?? prev?.page ?? null,
    place: [text(c.city, 80), text(c.country, 80)].filter(Boolean).join(', ') || prev?.place || null,
    device: [text(c.device, 40), text(c.browser, 40)].filter(Boolean).join(' · ') || prev?.device || null,
    returning: c.returning ?? prev?.returning ?? false,
    preview: text(c.preview, 280) ?? prev?.preview ?? null,
    priority,
    offline: c.offline ?? prev?.offline ?? false,
    since: text(c.waiting_since, 32) ?? text(c.at, 32) ?? prev?.since ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
    stage: text(c.stage, 32) ?? prev?.stage ?? null,
    atRisk: !!c.at_risk || !!prev?.atRisk,
    mine: false,
    by: null,
    silenced: prev?.silenced ?? false,
  };
}

/** A chat from the server's ring session, as this computer shows it: the server's silence and handover time win. */
export function fromRinging(r: RingingEntry, prev: WebchatRingChat | undefined): WebchatRingChat | null {
  const base = fromContext({ ...r, conversation_id: Number(r.conversation_id ?? r.id), waiting_since: r.since ?? r.waiting_since }, prev);
  if (!base) return null;
  return { ...base, mine: !!r.mine, by: text(r.by, 120), silenced: !!r.silenced && !base.atRisk, handoverAt: text(r.handover_at, 32) };
}

/** Order: at risk, then assigned to me, then oldest waiting (RING-23). */
export function orderChats(chats: WebchatRingChat[]): WebchatRingChat[] {
  const rank = (c: WebchatRingChat) => (c.atRisk ? 0 : c.mine ? 1 : 2);
  return [...chats].sort((a, b) => rank(a) - rank(b) || a.since.localeCompare(b.since) || a.id - b.id);
}

/**
 * The ringing list from the server's answer, keeping what this computer knows
 * that the answer does not say: a preview an event carried, and a silence.
 * A chat that has become at risk loses its silence (RING-06, RING-11).
 */
export function mergeAnswer(answer: PendingAnswer, prev: Map<number, WebchatRingChat>): WebchatRingChat[] {
  const out = new Map<number, WebchatRingChat>();
  // The server keeps ring sessions: its list, silences and handover times are the truth (RING-09, RING-11).
  if (Array.isArray(answer.ringing)) {
    for (const r of answer.ringing) {
      const c = fromRinging(r, prev.get(Number(r.conversation_id ?? r.id)));
      if (c) out.set(c.id, c);
    }
    return orderChats([...out.values()]);
  }
  for (const w of answer.waiting ?? []) {
    const c = fromContext(w, prev.get(Number(w.conversation_id)));
    if (c) out.set(c.id, c);
  }
  for (const p of answer.pending ?? []) {
    const pid = id(p.conversation_id);
    if (!pid) continue;
    const before = out.get(pid) ?? prev.get(pid);
    out.set(pid, {
      ...(before ?? fromContext({ conversation_id: pid, visitor: p.visitor, site: p.site, at: p.at }, undefined)!),
      visitor: text(p.visitor, 120) ?? before?.visitor ?? 'A visitor',
      site: text(p.site, 120) ?? before?.site ?? null,
      since: text(p.at, 32) ?? before?.since ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      mine: true,
      by: text(p.by, 120),
    });
  }
  for (const c of out.values()) {
    const was = prev.get(c.id);
    if (c.atRisk && was && !was.atRisk) c.silenced = false;
  }
  return orderChats([...out.values()]);
}

/** Server stamps are true UTC without a zone. */
export function stampMs(s: string): number {
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * What the tone does (RING-21, RING-47): nothing when every chat is silenced,
 * an offline enquiry (a card, not a ring), past the organisation's cap, or
 * quiet by the person's Do not disturb choice; the stronger tone for at-risk
 * and high, urgent and VIP chats.
 */
export function toneFor(chats: WebchatRingChat[], opts: { ringSeconds: number; quiet: boolean; duringDnd: WebchatRingPrefs['duringDnd']; now: number; ringHere?: boolean | null }): WebchatRingState['tone'] {
  // Another of my devices plays the ring (RING-10): this one shows it without sound.
  if (opts.ringHere === false) return 'off';
  const live = chats.filter((c) => !c.silenced && !c.offline && (c.atRisk || opts.ringSeconds <= 0 || opts.now - stampMs(c.since) < opts.ringSeconds * 1000));
  if (!live.length) return 'off';
  const strong = live.some((c) => c.atRisk || LOUD.has(c.priority));
  if (opts.quiet) {
    if (opts.duringDnd === 'card') return 'off';
    if (opts.duringDnd === 'at_risk') return live.some((c) => c.atRisk) ? 'strong' : 'off';
  }
  return strong ? 'strong' : 'normal';
}

/** How tall the call window is for what it shows: one card, then a row for each other chat (up to three), or just an outcome. */
export function ringerHeight(s: Pick<WebchatRingState, 'chats' | 'outcome'>): number {
  if (!s.chats.length) return 120;
  const rows = Math.min(3, s.chats.length - 1);
  return 272 + rows * 46 + (s.chats.length > 4 ? 26 : 0);
}

export interface WebchatRingDeps {
  http: HttpClient;
  /** Signed in, and the app lock not showing (the window then says nothing about who). */
  signedIn: () => boolean;
  locked: () => boolean;
  me: () => number | null;
  prefs: () => WebchatRingPrefs;
  /** Do not disturb, or notifications paused. */
  quiet: () => boolean;
  /** Bring the main window forward on a website chat. */
  open: (conversationId: number) => void;
  onChanged: (state: WebchatRingState) => void;
  /** This installation as a ringing device (RING-10, RING-49): stable across restarts. */
  deviceId: () => string;
  /** WorkSuite's main window is in front. */
  focused: () => boolean;
}

/** How often this computer tells the server it is here to ring (RING-10). */
export const HEARTBEAT_MS = 20_000;

/**
 * Website chats ring like calls on this computer (WS-WCHAT ENH-01, R3):
 * continuously, until somebody joins or the server no longer lists the chat
 * for this person. The server decides who is rung and when (the escalation
 * ladder); this keeps the list — from its events and a reconciliation every
 * 15 s, so a lost frame can neither leave a ring going nor silence a live
 * one (RING-09) — and says what the tone, the call window, the tray and the
 * operating system do about it.
 *
 * It never reads a conversation: on this server, opening one joins it, and
 * the visitor would be told somebody arrived who has not.
 */
export class WebchatRinger {
  private chats = new Map<number, WebchatRingChat>();
  private ringSeconds = 0;
  /** Whether the server has this computer play the ring; null when it does not choose (no ring sessions there). */
  private ringHere: boolean | null = null;
  /** The server keeps ring sessions: silence is sent to it, and its list is the truth. */
  private sessions = false;
  /** The server has no heartbeat (an older WorkSuite): this computer decides alone. */
  private noHeartbeat = false;
  private beatTimer: NodeJS.Timeout | null = null;
  private outcome: WebchatRingState['outcome'] = null;
  private timer: NodeJS.Timeout | null = null;
  private soon: NodeJS.Timeout | null = null;
  private outcomeTimer: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout | null = null;
  /** Not website staff (the server refused): asked again only at the next sign-in. */
  private refused = false;
  private running = false;
  private last = '';
  shortcut = false;

  constructor(private readonly deps: WebchatRingDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.refused = false;
    this.noHeartbeat = false;
    void this.beat().then(() => this.reconcile());
    this.timer = setInterval(() => void this.reconcile(), 15_000);
    this.timer.unref?.();
    this.beatTimer = setInterval(() => void this.beat(), HEARTBEAT_MS);
    this.beatTimer.unref?.();
    // The organisation's cap and Do not disturb change with the clock, not with events.
    this.tick = setInterval(() => this.emit(), 5_000);
    this.tick.unref?.();
  }

  stop(): void {
    this.running = false;
    for (const t of [this.timer, this.soon, this.outcomeTimer, this.tick, this.beatTimer]) if (t) clearTimeout(t);
    this.timer = this.soon = this.outcomeTimer = this.tick = this.beatTimer = null;
    this.chats.clear();
    this.ringHere = null;
    this.sessions = false;
    this.outcome = null;
    this.emit();
  }

  state(): WebchatRingState {
    const chats = orderChats([...this.chats.values()]);
    const prefs = this.deps.prefs();
    const hidden = this.deps.locked();
    return {
      chats: hidden ? chats.map((c) => ({ ...c, visitor: 'A visitor', page: null, place: null, device: null, preview: null, by: null })) : chats,
      tone: toneFor(chats, { ringSeconds: this.ringSeconds, quiet: this.deps.quiet(), duringDnd: prefs.duringDnd, now: Date.now(), ringHere: this.ringHere }),
      volume: Math.max(0, Math.min(100, prefs.volume)),
      outcome: this.outcome,
      hidden,
      shortcut: this.shortcut,
      elsewhere: this.ringHere === false && chats.length > 0,
      ringHere: this.ringHere,
    };
  }

  /** Realtime frames that start, change or end a ring. */
  handle(e: RealtimeEvent): void {
    if (!this.running || this.refused) return;
    const ev = e as unknown as Record<string, unknown>;
    // Which of my devices plays the ring changed: a browser took it, or gave it back (RING-10).
    if (e.type === 'chat.ring.device') {
      const here = ev.where === 'all' || !ev.device_id || ev.device_id === this.deps.deviceId();
      if (here !== this.ringHere) {
        this.ringHere = here;
        this.changed();
      }
      return;
    }
    const cid = id(ev.conversation_id);
    if (!cid) return;
    switch (e.type) {
      case 'chat.ring.stopped': {
        // The ring stopped for everybody, for a reason (RING-03, RING-28). A join is said with who.
        if (!this.chats.has(cid)) return;
        this.chats.delete(cid);
        const by = id(ev.by);
        if (ev.reason === 'joined') {
          if (by !== null && by !== this.deps.me()) this.say(cid, `${text(ev.by_name, 120) ?? 'A colleague'} joined the chat.`);
        } else if (typeof ev.reason === 'string' && STOP_WORDS[ev.reason]) this.say(cid, STOP_WORDS[ev.reason]!);
        this.changed();
        break;
      }
      case 'chat.ring.silenced': {
        // Silenced, or taken back, on one of my devices: the same here (RING-11).
        const c = this.chats.get(cid);
        if (c && c.silenced !== !!ev.silenced) {
          this.chats.set(cid, { ...c, silenced: !!ev.silenced && !c.atRisk });
          this.changed();
        }
        if (!c && !ev.silenced) this.reconcileSoon();
        break;
      }
      case 'chat.incoming': {
        const c = fromContext(ev as unknown as WaitingContext, this.chats.get(cid));
        if (c) this.chats.set(cid, { ...c, mine: this.chats.get(cid)?.mine ?? false, by: this.chats.get(cid)?.by ?? null });
        this.changed();
        this.reconcileSoon();
        break;
      }
      case 'chat.assigned': {
        const before = this.chats.get(cid);
        const base = before ?? fromContext({ conversation_id: cid, visitor: text(ev.visitor), site: text(ev.site), at: text(ev.at) }, undefined);
        if (base) this.chats.set(cid, { ...base, mine: true, by: text(ev.by, 120) });
        this.changed();
        this.reconcileSoon();
        break;
      }
      case 'chat.at_risk': {
        const c = this.chats.get(cid);
        if (c) this.chats.set(cid, { ...c, atRisk: true, silenced: false });
        this.changed();
        this.reconcileSoon();
        break;
      }
      case 'chat.widget.message': {
        const c = this.chats.get(cid);
        const preview = text(ev.preview, 280);
        if (c && preview) {
          this.chats.set(cid, { ...c, preview });
          this.changed();
        }
        break;
      }
      case 'chat.taken': {
        if (!this.chats.has(cid)) return;
        this.chats.delete(cid);
        const by = id(ev.by);
        const name = text(ev.by_name, 120);
        if (ev.how === 'closed') this.say(cid, 'The chat was closed before anyone joined.');
        else if (by !== null && by !== this.deps.me()) this.say(cid, `${name ?? 'A colleague'} joined the chat.`);
        this.changed();
        break;
      }
      default:
        break;
    }
  }

  /** Join (RING-02/22): accept a waiting chat — or open one assigned to me, which joins it — and bring WorkSuite forward on it. */
  async join(conversationId: number): Promise<boolean> {
    const c = this.chats.get(conversationId);
    if (!c) return false;
    if (!c.mine) {
      try {
        await this.deps.http.post(`${WEBSITE}/conversations/${conversationId}/accept`);
      } catch (e) {
        if (isDesktopError(e) && e.status === 409) {
          // A moment too late: the server says who has it (RING-02, "too late").
          this.chats.delete(conversationId);
          this.say(conversationId, e.message || 'Someone else has already taken this chat.');
          this.changed();
          return false;
        }
        this.say(conversationId, `Could not join: ${e instanceof Error ? e.message : 'the server did not answer'}`);
        this.changed();
        return false;
      }
    }
    this.chats.delete(conversationId);
    this.outcome = null;
    this.changed();
    this.deps.open(conversationId);
    this.reconcileSoon();
    return true;
  }

  /** The top chat still ringing, for Ctrl/Cmd+Shift+J and the tray. */
  top(): WebchatRingChat | null {
    return orderChats([...this.chats.values()]).find((c) => !c.silenced) ?? orderChats([...this.chats.values()])[0] ?? null;
  }

  /**
   * Silence one chat for me until it is at risk (RING-11): on all my devices where the server keeps ring sessions, on
   * this computer where it does not. Shown at once; a refusal (at risk, or it stopped ringing) puts it back and says why.
   */
  async silence(conversationId: number, on: boolean): Promise<void> {
    const c = this.chats.get(conversationId);
    if (!c || c.silenced === on) return;
    this.chats.set(conversationId, { ...c, silenced: on });
    this.changed();
    if (!this.sessions) return;
    try {
      await this.deps.http.request(on ? 'POST' : 'DELETE', `${WEBSITE}/conversations/${conversationId}/silence`);
    } catch (e) {
      // An older server without silence: kept on this computer.
      if (isDesktopError(e) && (e.status === 404 || e.status === 503)) return;
      const now = this.chats.get(conversationId);
      if (now) this.chats.set(conversationId, { ...now, silenced: !on });
      this.say(conversationId, isDesktopError(e) && e.status === 409 ? e.message : `Could not silence it: ${e instanceof Error ? e.message : 'the server did not answer'}`);
      this.changed();
    }
  }

  /**
   * Pass a chat given to me straight on (RING-12): to the next available agent, or with nobody else available, to
   * everybody covering the website. It stops ringing here at once.
   */
  async pass(conversationId: number): Promise<boolean> {
    const c = this.chats.get(conversationId);
    if (!c || !c.mine) return false;
    try {
      const r = await this.deps.http.post<{ passed?: string }>(`${WEBSITE}/conversations/${conversationId}/pass`);
      this.chats.delete(conversationId);
      this.say(conversationId, r?.passed === 'handed' ? 'Passed to the next available agent.' : 'Passed to everybody covering the website.');
      this.changed();
      this.reconcileSoon();
      return true;
    } catch (e) {
      this.say(conversationId, isDesktopError(e) && e.status === 409 ? e.message : `Could not pass it on: ${e instanceof Error ? e.message : 'the server did not answer'}`);
      this.changed();
      return false;
    }
  }

  /**
   * This computer's heartbeat as a ringing device (RING-10, RING-49), every 20 s: the server answers whether it plays
   * my ring — the desktop app does when it is running, unless I chose the browser. An older server without it: this
   * computer decides alone, as before.
   */
  async beat(): Promise<void> {
    if (!this.running || this.refused || this.noHeartbeat || !this.deps.signedIn()) return;
    try {
      const r = await this.deps.http.post<{ ring_here?: boolean }>('/api/chat/ring/heartbeat', {
        device_id: this.deps.deviceId(),
        kind: 'desktop',
        focused: this.deps.focused(),
        can_play_audio: this.deps.prefs().volume > 0,
      });
      const here = typeof r?.ring_here === 'boolean' ? r.ring_here : null;
      if (here !== this.ringHere) {
        this.ringHere = here;
        this.changed();
      }
    } catch (e) {
      if (isDesktopError(e) && (e.status === 404 || e.status === 405)) {
        this.noHeartbeat = true;
        if (this.ringHere !== null) {
          this.ringHere = null;
          this.changed();
        }
        return;
      }
      log.debug('ring heartbeat failed', { error: String(e) });
    }
  }

  /** Settings changed (Do not disturb, volume, the window): say it again. */
  refresh(): void {
    this.last = '';
    this.emit();
  }

  async reconcile(): Promise<void> {
    if (!this.running || this.refused || !this.deps.signedIn()) return;
    try {
      const answer = await this.deps.http.get<PendingAnswer>(`${WEBSITE}/assignments/pending`, { query: { device_id: this.deps.deviceId() } });
      if (!this.running) return;
      this.ringSeconds = Math.max(0, Number(answer?.ring_seconds ?? 0) || 0);
      this.sessions = Array.isArray(answer?.ringing);
      if (typeof answer?.ring_here === 'boolean') this.ringHere = answer.ring_here;
      const next = mergeAnswer(answer ?? {}, this.chats);
      this.chats = new Map(next.map((c) => [c.id, c]));
      this.changed();
    } catch (e) {
      if (isDesktopError(e) && (e.status === 403 || e.status === 404)) {
        // Not website staff, or no website chat on this server: nothing rings here.
        this.refused = true;
        this.chats.clear();
        this.changed();
        return;
      }
      log.debug('pending read failed', { error: String(e) });
    }
  }

  private reconcileSoon(): void {
    if (this.soon) clearTimeout(this.soon);
    this.soon = setTimeout(() => {
      this.soon = null;
      void this.reconcile();
    }, 1_500);
    this.soon.unref?.();
  }

  private say(conversationId: number, words: string): void {
    this.outcome = { id: conversationId, text: words, at: Date.now() };
    if (this.outcomeTimer) clearTimeout(this.outcomeTimer);
    this.outcomeTimer = setTimeout(() => {
      this.outcome = null;
      this.outcomeTimer = null;
      this.emit();
    }, 5_000);
    this.outcomeTimer.unref?.();
  }

  private changed(): void {
    this.emit();
  }

  private emit(): void {
    const s = this.state();
    const key = JSON.stringify(s);
    if (key === this.last) return;
    this.last = key;
    this.deps.onChanged(s);
  }
}
