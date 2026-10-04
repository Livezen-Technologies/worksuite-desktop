import { randomUUID } from 'node:crypto';
import type { SubmitResult } from '@shared/ipc/contract';
import { FOLLOW_UP_DEFAULTS, type WebchatCall, type WebchatFollowUp, type WebchatFollowUpPrefs, type WebchatHandoff, type WebchatJoined, type WebchatRingChat, type WebchatRingPrefs, type WebchatRingState } from '@shared/types';
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
  /** Invitations and transfers waiting for me (ENH-WCHAT-03); absent on a server without team chats. */
  handoffs?: HandoffEntry[];
  /** Visitors' voice calls ringing for me (ENH-WCHAT-05); absent on a server without them, or for whoever does not take calls. */
  calls?: CallEntry[];
}

/** A voice call card as the server sends it (WidgetCalls::card, `chat.widget.call`). */
export interface CallEntry extends WaitingContext {
  call_id: number;
  status?: string;
  call_stage?: string | null;
  requested_at?: string | null;
  last_message?: string | null;
  owner?: string | null;
}

/** A call card as this computer shows it, or null when it cannot be read. */
export function fromCall(c: CallEntry): WebchatCall | null {
  const callId = id(c.call_id);
  const cid = id(c.conversation_id);
  if (!callId || !cid) return null;
  return {
    id: callId,
    conversationId: cid,
    visitor: text(c.visitor, 120) ?? 'A visitor',
    site: text(c.site, 120),
    page: text(c.page, 200),
    place: [text(c.city, 80), text(c.country, 80)].filter(Boolean).join(', ') || null,
    preview: text(c.last_message, 280),
    owner: text(c.owner, 120),
    stage: c.call_stage === 'everyone' ? 'everyone' : 'first',
    requestedAt: text(c.requested_at, 32),
  };
}

/** Said when a call stops ringing here for a reason other than me answering it (VOICE-10, VOICE-04). */
export const CALL_WORDS: Record<string, string> = {
  cancelled: 'hung up before anyone answered.',
  missed: 'was not answered in time — the visitor can ask for a call back.',
  declined: 'was declined by everybody — the visitor can ask for a call back.',
  dropped: 'dropped.',
  ended: 'ended.',
};

/** An invitation or transfer card as the server sends it (WidgetTeam::pendingFor, `chat.widget.handoff`). */
export interface HandoffEntry extends WaitingContext {
  handoff_id: number;
  kind?: string;
  mode?: string;
  from_name?: string | null;
  department?: string | null;
  to_any?: boolean;
  note?: string | null;
  expires_at?: string | null;
  /** Seconds left by the server's clock (C-09). */
  expires_in?: number | null;
  created_at?: string | null;
}

/** A handoff card as this computer shows it, or null when it cannot be read. `now` is when it was received. */
export function fromHandoff(h: HandoffEntry, now = Date.now()): WebchatHandoff | null {
  const hid = id(h.handoff_id);
  const cid = id(h.conversation_id);
  if (!hid || !cid) return null;
  return {
    id: hid,
    conversationId: cid,
    kind: h.kind === 'transfer' ? 'transfer' : 'invite',
    mode: h.mode === 'cold' ? 'cold' : 'warm',
    visitor: text(h.visitor, 120) ?? 'A visitor',
    site: text(h.site, 120),
    page: text(h.page, 200),
    from: text(h.from_name, 120),
    department: text(h.department, 120),
    toAny: !!h.to_any,
    note: text(h.note, 500),
    expiresAt: text(h.expires_at, 32),
    createdAt: text(h.created_at, 32),
    // The server's count, made local once on arrival (C-09): never the server's stamp against this computer's clock.
    endsAt: typeof h.expires_in === 'number' && Number.isFinite(h.expires_in) ? now + Math.max(0, h.expires_in) * 1000 : null,
  };
}

/** When a handoff runs out here (ms), or null when it rings until somebody takes it (C-09). */
export function handoffEnds(h: Pick<WebchatHandoff, 'expiresAt' | 'endsAt'>): number | null {
  if (typeof h.endsAt === 'number') return h.endsAt;
  return h.expiresAt ? stampMs(h.expiresAt) : null;
}

/** Said to whoever an invitation or transfer was for when it resolves without them. */
export const HANDOFF_WORDS: Record<string, string> = {
  cancelled: 'It was cancelled.',
  expired: 'It expired.',
};

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
  // Not "in Missed chats": a chat is marked missed only once the widget's missed time has passed.
  visitor_left: 'The visitor left the site before anyone joined.',
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

/** The last few messages an event carries (worksuite-desktop#230), oldest first; null when it carries none. */
export function recentOf(v: unknown): WebchatFollowUp['recent'] | null {
  if (!Array.isArray(v)) return null;
  const out = v
    .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : null))
    .filter((m): m is Record<string, unknown> => !!m && !!text(m.body, 400))
    .map((m) => ({ from: m.from === 'agent' ? ('agent' as const) : ('visitor' as const), body: text(m.body, 400)!, at: text(m.at, 40) }));
  return out.length ? out.slice(-3) : null;
}

/** How long Snooze holds a card (worksuite-desktop#230). */
export const SNOOZE_MS = 5 * 60_000;
/** A card for a visitor still unanswered after this long has done what it can; the list and the team have it. */
const FOLLOW_UP_KEEP_MS = 2 * 60 * 60_000;

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
export function toneFor(chats: WebchatRingChat[], opts: { ringSeconds: number; quiet: boolean; duringDnd: WebchatRingPrefs['duringDnd']; now: number; ringHere?: boolean | null; handoffs?: number; calls?: number }): WebchatRingState['tone'] {
  // Another of my devices plays the ring (RING-10): this one shows it without sound.
  if (opts.ringHere === false) return 'off';
  // A visitor waiting on the line rings like a chat at risk: through Do not disturb unless it only shows cards (VOICE-10).
  if ((opts.calls ?? 0) > 0) return opts.quiet && opts.duringDnd === 'card' ? 'off' : 'strong';
  const live = chats.filter((c) => !c.silenced && !c.offline && (c.atRisk || opts.ringSeconds <= 0 || opts.now - stampMs(c.since) < opts.ringSeconds * 1000));
  // A colleague asking me in rings too, like a chat that has reached me (TEAM-23).
  if (!live.length) return (opts.handoffs ?? 0) > 0 && !(opts.quiet && opts.duringDnd !== 'ring') ? 'normal' : 'off';
  const strong = live.some((c) => c.atRisk || LOUD.has(c.priority));
  if (opts.quiet) {
    if (opts.duringDnd === 'card') return 'off';
    if (opts.duringDnd === 'at_risk') return live.some((c) => c.atRisk) ? 'strong' : 'off';
  }
  return strong ? 'strong' : 'normal';
}

/**
 * How tall the call window is for what it shows: one card — a chat, or an invitation or transfer — then a row for
 * each of the others (up to three), or just an outcome.
 */
export function ringerHeight(s: Pick<WebchatRingState, 'chats' | 'outcome' | 'handoffs' | 'calls' | 'joined'>): number {
  const all = s.chats.length + (s.handoffs?.length ?? 0) + (s.calls?.length ?? 0);
  // The card measures itself (`fit`); these are its first guesses (#225): a chat just joined as a mini chat, one chat
  // ringing as the full card with its reply box, several as compact cards.
  if (!s.calls?.length && !s.handoffs?.length) {
    if (!s.chats.length && s.joined) return 440;
    if (s.chats.length === 1) return 430;
    if (s.chats.length > 1) return 44 + Math.min(3, s.chats.length) * 118 + (s.chats.length > 3 ? 26 : 0);
  }
  if (!all) return 120;
  const rows = Math.min(3, all - 1);
  return 272 + rows * 46 + (all > 4 ? 26 : 0) + (!s.calls?.length && !s.chats.length && s.handoffs?.[0]?.note ? 40 : 0);
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
  /** Bring the main window forward on a website chat; with a call, its thread joins the call's audio; `transfer`, with the transfer dialog open. */
  open: (conversationId: number, callId?: number, then?: 'transfer') => void;
  /** Bring the main window forward on the website chats inbox. */
  openInbox?: () => void;
  /** Send a reply into a chat I am in, as its composer would (kept and sent later when offline). */
  reply?: (conversationId: number, text: string) => Promise<SubmitResult>;
  onChanged: (state: WebchatRingState) => void;
  /** This installation as a ringing device (RING-10, RING-49): stable across restarts. */
  deviceId: () => string;
  /** WorkSuite's main window is in front. */
  focused: () => boolean;
  /** When a visitor writes again in my chat (worksuite-desktop#230): the card, the notification, the chime, and when I count as away. */
  followUpPrefs?: () => WebchatFollowUpPrefs;
  /** Seconds since the last keyboard or mouse input on this computer. */
  idleSeconds?: () => number;
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
  /** Invitations and transfers waiting for me, by handoff id (ENH-WCHAT-03). */
  private handoffs = new Map<number, WebchatHandoff>();
  /** Visitors' voice calls ringing for me, by call id (ENH-WCHAT-05). */
  private calls = new Map<number, WebchatCall>();
  /** Whether this computer has a microphone, as its main window last found; null until it says (VOICE-11). */
  private hasMic: boolean | null = null;
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
  /** The chat I just joined from the card: a mini chat there until I open the full chat or minimise it (#225). */
  private joined: WebchatJoined | null = null;
  /** The card was minimised while exactly these were ringing; anything new brings it back. */
  private minimisedFor: string | null = null;
  /** The card's measured height. */
  private fitHeight: number | null = null;
  /** Visitors who wrote again in my chats while I was away from them, by conversation (worksuite-desktop#230). */
  private followUps = new Map<number, WebchatFollowUp>();
  /** Snoozed follow-ups, until when (epoch ms). */
  private snoozed = new Map<number, number>();
  /** The website conversation in front in the main window, as its page says; null when none is. */
  private viewingId: number | null = null;
  /** Each time the "visitor replied" chime should play once. */
  private chimes = 0;
  shortcut = false;
  answerShortcut = false;

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
    // The organisation's cap and Do not disturb change with the clock, not with events; so do snoozes running out
    // and my coming back to a conversation (#230).
    this.tick = setInterval(() => {
      this.sweepFollowUps();
      this.emit();
    }, 5_000);
    this.tick.unref?.();
  }

  stop(): void {
    this.running = false;
    for (const t of [this.timer, this.soon, this.outcomeTimer, this.tick, this.beatTimer]) if (t) clearTimeout(t);
    this.timer = this.soon = this.outcomeTimer = this.tick = this.beatTimer = null;
    this.chats.clear();
    this.handoffs.clear();
    this.calls.clear();
    this.followUps.clear();
    this.snoozed.clear();
    this.ringHere = null;
    this.sessions = false;
    this.outcome = null;
    this.emit();
  }

  state(): WebchatRingState {
    const chats = orderChats([...this.chats.values()]);
    const followUps = this.shownFollowUps();
    const prefs = this.deps.prefs();
    const hidden = this.deps.locked();
    const now = Date.now();
    // One that ran out stops ringing at once; the server says so at the next read.
    const handoffs = [...this.handoffs.values()].filter((h) => (handoffEnds(h) ?? Infinity) > now).sort((a, b) => a.id - b.id);
    const calls = [...this.calls.values()].sort((a, b) => a.id - b.id);
    return {
      chats: hidden ? chats.map((c) => ({ ...c, visitor: 'A visitor', page: null, place: null, device: null, preview: null, by: null })) : chats,
      handoffs: hidden ? handoffs.map((h) => ({ ...h, visitor: 'A visitor', page: null, note: null, from: null })) : handoffs,
      calls: hidden ? calls.map((c) => ({ ...c, visitor: 'A visitor', page: null, place: null, preview: null, owner: null })) : calls,
      answerShortcut: this.answerShortcut,
      tone: toneFor(chats, { ringSeconds: this.ringSeconds, quiet: this.deps.quiet(), duringDnd: prefs.duringDnd, now, ringHere: this.ringHere, handoffs: handoffs.length, calls: calls.length }),
      volume: Math.max(0, Math.min(100, prefs.volume)),
      outcome: this.outcome,
      hidden,
      shortcut: this.shortcut,
      elsewhere: this.ringHere === false && chats.length + handoffs.length + calls.length > 0,
      ringHere: this.ringHere,
      // Behind the lock, nothing of the chat I joined is shown.
      joined: hidden ? null : this.joined,
      minimised: this.minimisedFor !== null && this.minimisedFor === this.ringingKey(),
      fit: this.fitHeight,
      followUps: hidden ? followUps.map((f) => ({ ...f, visitor: 'A visitor', recent: [], agent: null })) : followUps,
      chime: this.chimes,
      followUpCard: this.followUpPrefs().card,
    };
  }

  private followUpPrefs(): WebchatFollowUpPrefs {
    return { ...FOLLOW_UP_DEFAULTS, ...(this.deps.followUpPrefs?.() ?? {}) };
  }

  /**
   * Whether I am looking at this conversation now (worksuite-desktop#230): it is the one in front in WorkSuite's main
   * window, the window is in front (not minimised, not behind another app), the app is not locked, and there has
   * been keyboard or mouse input within the time I chose. Anything else and a visitor's message is unattended.
   */
  attending(conversationId: number): boolean {
    if (this.viewingId !== conversationId || !this.deps.focused() || this.deps.locked()) return false;
    const idle = this.deps.idleSeconds?.() ?? 0;
    return idle < this.followUpPrefs().idleMinutes * 60;
  }

  /** The main window says which website conversation is in front (or none): looking at one clears its card. */
  setViewing(conversationId: number | null): void {
    this.viewingId = conversationId;
    if (conversationId !== null && this.followUps.has(conversationId) && this.attending(conversationId)) {
      this.followUps.delete(conversationId);
      this.snoozed.delete(conversationId);
      this.changed();
    }
  }

  /** The follow-ups to show: not snoozed, longest waiting first. */
  private shownFollowUps(now = Date.now()): WebchatFollowUp[] {
    return [...this.followUps.values()].filter((f) => (this.snoozed.get(f.id) ?? 0) <= now).sort((a, b) => stampMs(a.since) - stampMs(b.since));
  }

  /** Every five seconds: a card I came back to goes, a snooze that ran out brings its card back with the chime, and an old one is let go. */
  private sweepFollowUps(): void {
    const now = Date.now();
    let changed = false;
    for (const [cid, f] of this.followUps) {
      if (this.attending(cid) || now - stampMs(f.since) > FOLLOW_UP_KEEP_MS) {
        this.followUps.delete(cid);
        this.snoozed.delete(cid);
        changed = true;
      }
    }
    for (const [cid, until] of this.snoozed) {
      if (until > now) continue;
      this.snoozed.delete(cid);
      if (this.followUps.has(cid)) {
        this.ding();
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** The chime, once — unless sounds are off, Do not disturb is on, or the volume is nothing. */
  private ding(): void {
    if (this.followUpPrefs().sound && !this.deps.quiet() && this.deps.prefs().volume > 0) this.chimes++;
  }

  /**
   * A visitor wrote (worksuite-desktop#230). In a chat I have or am in that the team has already answered, and while
   * I am away from it, that is a follow-up: a card (or the one there, with the new words and one more in its count),
   * the chime, and the badge. A chat still ringing has its ringing card instead.
   */
  private visitorWrote(cid: number, ev: Record<string, unknown>): void {
    const me = this.deps.me();
    const owner = id(ev.assigned_to);
    const participants = Array.isArray(ev.participants) ? ev.participants.map((x) => id(x)).filter((x): x is number => x !== null) : [];
    const before = this.followUps.get(cid);
    const mineOrIn = me !== null && (owner === me || participants.includes(me));
    if (!before && !(ev.followup === true && mineOrIn)) return;
    if (this.chats.has(cid)) return;
    if (this.attending(cid)) {
      if (before && this.followUps.delete(cid)) this.changed();
      return;
    }
    const said = text(ev.preview, 400);
    const at = text(ev.at, 40);
    const recent = recentOf(ev.recent) ?? [...(before?.recent ?? []), ...(said ? [{ from: 'visitor' as const, body: said, at }] : [])].slice(-3);
    this.followUps.set(cid, {
      id: cid,
      visitor: text(ev.visitor, 120) ?? before?.visitor ?? 'A visitor',
      site: text(ev.site, 120) ?? before?.site ?? null,
      recent,
      since: text(ev.waiting_since, 40) ?? before?.since ?? at ?? new Date().toISOString(),
      count: (before?.count ?? 0) + 1,
      stage: before?.stage ?? 'replied',
      mine: owner === null ? (before?.mine ?? true) : owner === me,
      agent: before?.agent ?? null,
    });
    if ((this.snoozed.get(cid) ?? 0) <= Date.now()) this.ding();
    this.changed();
  }

  /**
   * The server's follow-up steps (worksuite-desktop#230): a reminder to me, the team alerted (a card with Take over
   * for the others), and the end of it — answered, taken over or reassigned.
   */
  private followUpStep(cid: number, ev: Record<string, unknown>): void {
    const stage = ev.stage;
    if (stage === 'answered' || stage === 'taken' || stage === 'reassigned') {
      const had = this.followUps.delete(cid);
      this.snoozed.delete(cid);
      if (had) this.changed();
      return;
    }
    if (stage !== 'reminder' && stage !== 'team') return;
    if (this.chats.has(cid) || this.attending(cid)) return;
    const me = this.deps.me();
    const owner = id(ev.assigned_to);
    const before = this.followUps.get(cid);
    const mine = owner !== null && owner === me;
    this.followUps.set(cid, {
      id: cid,
      visitor: text(ev.visitor, 120) ?? before?.visitor ?? 'A visitor',
      site: text(ev.site, 120) ?? before?.site ?? null,
      recent: recentOf(ev.recent) ?? before?.recent ?? (text(ev.preview, 400) ? [{ from: 'visitor', body: text(ev.preview, 400)!, at: null }] : []),
      since: text(ev.waiting_since, 40) ?? before?.since ?? new Date().toISOString(),
      count: Math.max(1, before?.count ?? 1),
      stage: stage === 'team' ? 'team' : before?.stage === 'team' ? 'team' : 'reminder',
      mine,
      agent: mine ? null : (text(ev.agent, 120) ?? before?.agent ?? null),
    });
    if ((this.snoozed.get(cid) ?? 0) <= Date.now()) this.ding();
    this.changed();
  }

  /**
   * The follow-up card's actions (worksuite-desktop#230): Send (a reply, as the conversation's composer sends one,
   * without leaving what I am doing), Open chat, Snooze 5 min, and Take over for a colleague's chat the team was
   * alerted about.
   */
  async followUp(cid: number, action: 'reply' | 'open' | 'snooze' | 'takeOver', message?: string): Promise<{ ok: boolean; why: string | null }> {
    const f = this.followUps.get(cid);
    if (action === 'snooze') {
      if (!f) return { ok: false, why: 'This visitor has been answered.' };
      this.snoozed.set(cid, Date.now() + SNOOZE_MS);
      this.changed();
      return { ok: true, why: null };
    }
    if (action === 'open') {
      this.followUps.delete(cid);
      this.snoozed.delete(cid);
      this.changed();
      this.deps.open(cid);
      return { ok: true, why: null };
    }
    if (action === 'takeOver') {
      try {
        await this.deps.http.post(`${WEBSITE}/conversations/${cid}/take-over`);
      } catch (e) {
        const why = isDesktopError(e) && e.status === 409 ? e.message || 'Someone else has this chat now.' : `Could not take it over: ${e instanceof Error ? e.message : 'the server did not answer'}`;
        this.say(cid, why);
        this.changed();
        return { ok: false, why };
      }
      this.followUps.delete(cid);
      this.snoozed.delete(cid);
      this.changed();
      this.deps.open(cid);
      return { ok: true, why: null };
    }
    const words = message?.trim() ?? '';
    if (!words) return { ok: false, why: 'Type a reply first.' };
    if (!this.deps.reply) return { ok: false, why: 'Open the chat to reply.' };
    const r = await this.deps.reply(cid, words);
    if (!r.delivered && !r.queued) return { ok: false, why: r.error ?? 'The reply was not sent.' };
    this.followUps.delete(cid);
    this.snoozed.delete(cid);
    this.say(cid, r.queued && !r.delivered ? 'Your reply will be sent when you are back online.' : 'Reply sent.');
    this.changed();
    return { ok: true, why: null };
  }

  /** How many visitors wait on me in my chats: the badge's part (worksuite-desktop#230). */
  followUpCount(): number {
    return this.shownFollowUps().length;
  }

  /** Whether this chat is ringing for me now. */
  isRinging(conversationId: number): boolean {
    return this.chats.has(conversationId);
  }

  /** What is ringing, as one string: minimising holds while it stays the same. */
  private ringingKey(): string {
    // A visitor writing again in my chat brings a minimised card back too (#230).
    return [...[...this.chats.keys()].map((k) => `c${k}`), ...[...this.handoffs.keys()].map((k) => `h${k}`), ...[...this.calls.keys()].map((k) => `v${k}`), ...this.shownFollowUps().map((f) => `f${f.id}:${f.count}:${f.stage}`)].sort().join(',');
  }

  /**
   * Join chat and Join & send on the card (worksuite-desktop#225). One request claims the chat for me — first come,
   * so two people never both get it — posts what I wrote, and stops the ring for everybody; the card then becomes a
   * mini chat on it. A moment too late, it says who has it and nothing is sent. With `stay: false` (a reply typed in
   * a system notification) there is no mini chat.
   */
  async joinAndSend(conversationId: number, message: string | null, opts: { stay?: boolean } = {}): Promise<{ ok: boolean; why: string | null }> {
    const c = this.chats.get(conversationId);
    if (!c) return { ok: false, why: 'This chat is no longer ringing.' };
    const text = message?.trim() || null;
    const key = { headers: { 'Idempotency-Key': `ring-join-${conversationId}-${randomUUID()}` } };
    try {
      try {
        await this.deps.http.post(`${WEBSITE}/conversations/${conversationId}/join-reply`, text ? { message: text } : {}, key);
      } catch (e) {
        // A server from before Join & send: Accept, then the reply, as two requests.
        if (!(isDesktopError(e) && e.status === 404 && !/conversation/i.test(e.message))) throw e;
        if (!c.mine) await this.deps.http.post(`${WEBSITE}/conversations/${conversationId}/accept`);
        if (text) await this.deps.http.post(`${WEBSITE}/conversations/${conversationId}/reply`, { message: text }, key);
      }
    } catch (e) {
      const why = isDesktopError(e) && e.status === 409 ? e.message || 'Someone else has already taken this chat.' : `Could not join: ${e instanceof Error ? e.message : 'the server did not answer'}`;
      if (isDesktopError(e) && e.status === 409) this.chats.delete(conversationId);
      this.say(conversationId, why);
      this.changed();
      return { ok: false, why };
    }
    this.chats.delete(conversationId);
    this.outcome = null;
    this.minimisedFor = null;
    if (opts.stay !== false) {
      this.joined = { conversationId, visitor: c.visitor, site: c.site, place: c.place, device: c.device, page: c.page, preview: c.preview, since: c.since, sent: text ? [text] : [] };
    }
    this.changed();
    this.reconcileSoon();
    return { ok: true, why: null };
  }

  /** A reply from the mini chat (#225): sent as the conversation's composer sends one, and shown under the last. */
  async replyJoined(message: string): Promise<{ ok: boolean; why: string | null }> {
    const j = this.joined;
    const text = message.trim();
    if (!j || !text) return { ok: false, why: 'There is no chat to reply to.' };
    if (!this.deps.reply) return { ok: false, why: 'Open the full chat to reply.' };
    const r = await this.deps.reply(j.conversationId, text);
    if (!r.delivered && !r.queued) return { ok: false, why: r.error ?? 'The reply was not sent.' };
    if (this.joined?.conversationId === j.conversationId) {
      this.joined = { ...this.joined, sent: [...this.joined.sent, text] };
      this.changed();
    }
    return { ok: true, why: null };
  }

  /** The mini chat closes: Open full chat brings WorkSuite forward on it; minimising just puts the card away. */
  closeJoined(open: boolean): void {
    const j = this.joined;
    this.joined = null;
    this.changed();
    if (open && j) this.deps.open(j.conversationId);
  }

  /** Minimise (#225): the mini chat closes, or the card goes away while these chats ring — the tone goes on. */
  minimise(): void {
    if (this.joined) return this.closeJoined(false);
    this.minimisedFor = this.ringingKey();
    this.changed();
  }

  /** The card measured itself: the window takes its height. */
  fit(height: number): void {
    if (this.fitHeight === height) return;
    this.fitHeight = height;
    this.changed();
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
      case 'chat.widget.call': {
        // A visitor calling (VOICE-10): it rings until somebody answers, the visitor hangs up or nobody did in time.
        if (ev.what === 'ringing') {
          const c = fromCall(ev as unknown as CallEntry);
          if (c) this.calls.set(c.id, c);
          this.changed();
          break;
        }
        const callId = id(ev.call_id);
        if (callId === null || !this.calls.has(callId)) return;
        const c = this.calls.get(callId)!;
        this.calls.delete(callId);
        const by = id(ev.by);
        if (ev.what === 'answered') {
          if (by !== this.deps.me()) this.say(cid, `${text(ev.by_name, 120) ?? 'A colleague'} answered the call.`);
        } else if (typeof ev.what === 'string' && CALL_WORDS[ev.what]) this.say(cid, `The call from ${c.visitor} ${CALL_WORDS[ev.what]}`);
        this.changed();
        break;
      }
      case 'chat.widget.handoff': {
        // A colleague asks me in (TEAM-23): it rings until I answer, it is cancelled or it runs out.
        const h = fromHandoff(ev as unknown as HandoffEntry);
        if (h) this.handoffs.set(h.id, h);
        this.changed();
        break;
      }
      case 'chat.widget.handoff.resolved': {
        const hid = id(ev.handoff_id);
        if (hid === null || !this.handoffs.has(hid)) return;
        const h = this.handoffs.get(hid)!;
        this.handoffs.delete(hid);
        const by = id(ev.by);
        if (by !== this.deps.me()) {
          const what = h.kind === 'invite' ? 'The invitation' : 'The transfer';
          if (ev.status === 'accepted') this.say(cid, `${text(ev.by_name, 120) ?? 'A colleague'} took it first.`);
          else if (typeof ev.status === 'string' && HANDOFF_WORDS[ev.status]) this.say(cid, `${what} for ${h.visitor}: ${HANDOFF_WORDS[ev.status]!.toLowerCase()}`);
        }
        this.changed();
        break;
      }
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
        this.visitorWrote(cid, ev);
        break;
      }
      case 'chat.widget.followup':
        this.followUpStep(cid, ev);
        break;
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
  async join(conversationId: number, then?: 'transfer'): Promise<boolean> {
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
    this.deps.open(conversationId, undefined, then);
    this.reconcileSoon();
    return true;
  }

  /** "Open inbox" on the card of several chats (#225): the card is put away and WorkSuite comes forward on them. */
  openInbox(): void {
    this.minimisedFor = this.ringingKey();
    this.changed();
    this.deps.openInbox?.();
  }

  /**
   * Answer an invitation or a transfer (TEAM-24, TEAM-41): Join chat or Accept brings WorkSuite forward on the chat;
   * Decline tells whoever asked. Somebody who was a moment too late is told who took it.
   */
  async answer(handoffId: number, accept: boolean): Promise<boolean> {
    const h = this.handoffs.get(handoffId);
    if (!h) return false;
    try {
      await this.deps.http.post(`${WEBSITE}/handoffs/${handoffId}/${accept ? 'accept' : 'decline'}`);
    } catch (e) {
      if (isDesktopError(e) && (e.status === 409 || e.status === 404 || e.status === 403)) {
        this.handoffs.delete(handoffId);
        this.say(h.conversationId, e.message || 'This is no longer waiting for you.');
        this.changed();
        return false;
      }
      this.say(h.conversationId, `Could not ${accept ? 'join' : 'decline'}: ${e instanceof Error ? e.message : 'the server did not answer'}`);
      this.changed();
      return false;
    }
    this.handoffs.delete(handoffId);
    this.outcome = null;
    this.changed();
    if (accept) this.deps.open(h.conversationId);
    this.reconcileSoon();
    return true;
  }

  /**
   * Answer a visitor's call, or decline it (VOICE-10, VOICE-12): the first to answer takes it, and WorkSuite comes
   * forward on the chat, whose thread joins the call's audio. A moment too late, the card says who answered.
   */
  async answerCall(callId: number, accept: boolean): Promise<boolean> {
    const c = this.calls.get(callId);
    if (!c) return false;
    try {
      await this.deps.http.post(`${WEBSITE}/calls/${callId}/${accept ? 'answer' : 'decline'}`);
    } catch (e) {
      if (isDesktopError(e) && (e.status === 409 || e.status === 404 || e.status === 403)) {
        this.calls.delete(callId);
        this.say(c.conversationId, e.message || 'This call is no longer ringing for you.');
        this.changed();
        return false;
      }
      this.say(c.conversationId, `Could not ${accept ? 'answer' : 'decline'}: ${e instanceof Error ? e.message : 'the server did not answer'}`);
      this.changed();
      return false;
    }
    this.calls.delete(callId);
    this.outcome = null;
    this.changed();
    if (accept) this.deps.open(c.conversationId, callId);
    this.reconcileSoon();
    return true;
  }

  /** The oldest call ringing, for Ctrl/Cmd+Shift+A and the tray. */
  topCall(): WebchatCall | null {
    return [...this.calls.values()].sort((a, b) => a.id - b.id)[0] ?? null;
  }

  /** Whether this computer has a microphone (VOICE-11): told by the main window, sent with the next heartbeat. */
  setMic(has: boolean): void {
    if (this.hasMic === has) return;
    this.hasMic = has;
    void this.beat();
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
        // A computer without a microphone is not rung for visitors' calls (VOICE-11).
        ...(this.hasMic === null ? {} : { has_mic: this.hasMic }),
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
      // The server's list of invitations and transfers is the truth, where it has one (ENH-WCHAT-03).
      if (Array.isArray(answer?.handoffs)) {
        this.handoffs = new Map(answer.handoffs.map((x: HandoffEntry) => fromHandoff(x)).filter((h): h is WebchatHandoff => h !== null).map((h) => [h.id, h]));
      }
      // And of visitors' calls ringing for me (ENH-WCHAT-05).
      if (Array.isArray(answer?.calls)) {
        this.calls = new Map(answer.calls.map(fromCall).filter((c): c is WebchatCall => c !== null).map((c) => [c.id, c]));
      }
      this.changed();
    } catch (e) {
      if (isDesktopError(e) && (e.status === 403 || e.status === 404)) {
        // Not website staff, or no website chat on this server: nothing rings here.
        this.refused = true;
        this.chats.clear();
        this.handoffs.clear();
        this.calls.clear();
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
