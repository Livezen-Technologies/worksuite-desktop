import { randomUUID } from 'node:crypto';
import type { SubmitResult } from '@shared/ipc/contract';
import { FOLLOW_UP_DEFAULTS, type RingTestNotice, type RingTestStep, type WebchatCall, type WebchatFollowUp, type WebchatFollowUpPrefs, type WebchatHandoff, type WebchatJoined, type WebchatMic, type WebchatRingChat, type WebchatRingOutcome, type WebchatRingPrefs, type WebchatRingState } from '@shared/types';
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
  /** My ringing settings as the server keeps them (RING-29): the ringtone is what this computer plays. */
  ring_prefs?: { ringtone?: string | null } | null;
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
  /** The contact details the visitor gave before calling, or the chat already had (UX-WGT-10). */
  visitor_email?: string | null;
  visitor_phone?: string | null;
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
    // Who to call back if the line drops, on the card itself (V-04, UX-WGT-10): only what the server knows.
    ...(text(c.visitor_email, 160) ? { email: text(c.visitor_email, 160) } : {}),
    ...(text(c.visitor_phone, 40) ? { phone: text(c.visitor_phone, 40) } : {}),
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
  /** A voice call is on in the chat (V-03, WF-V3): accepting joins it too. Absent on an older server. */
  on_call?: boolean;
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
    onCall: h.on_call === true,
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
  /** How many colleagues it rings for besides me (R-01, RING-UI-01 footer); absent on an older server. */
  others_ringing?: number | null;
}

/**
 * Said when a ring stops for a reason other than me joining (RING-28), in R-03's words: the visitor by name where the
 * design names them (`{visitor}`).
 */
export const STOP_WORDS: Record<string, string> = {
  visitor_left: '{visitor} left the site before anyone joined',
  visitor_ended: '{visitor} ended the chat.',
  closed: 'The chat was closed before anyone joined.',
  blocked: 'The visitor was blocked.',
};

/** "Nuwan" for "Nuwan Silva": a colleague named the way R-03 names them. */
const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/**
 * What R-03 says under a visitor who left (RING-03, RING-UI-03): the ring stopped, and — only when the server says
 * the chat is in Missed chats now — that it is there, with the email they left.
 */
export function leftDetail(o: Pick<WebchatRingOutcome, 'missed' | 'email'>): string {
  if (!o.missed) return 'Ringing stopped.';
  return o.email ? `Ringing stopped. The chat is in Missed chats with the email they left: ${o.email}` : 'Ringing stopped. The chat is in Missed chats.';
}

/**
 * How a ring that stopped for everybody is told (R-03, RING-UI-03; RING-03, RING-28): the words, and what the card
 * draws. Null for a reason it does not tell.
 */
export function stopOutcome(reason: unknown, visitor: string, ev: Record<string, unknown>): Omit<WebchatRingOutcome, 'id' | 'at'> | null {
  if (typeof reason !== 'string' || !STOP_WORDS[reason]) return null;
  const title = STOP_WORDS[reason]!.replace('{visitor}', visitor);
  if (reason === 'visitor_left') {
    const missed = ev.missed === true;
    const email = missed ? text(ev.visitor_email, 160) : null;
    return { kind: 'visitor_left', visitor, missed, email, text: `${title}. ${leftDetail({ missed, email })}` };
  }
  if (reason === 'visitor_ended') return { kind: 'visitor_ended', visitor, text: `${title} Ringing stopped.` };
  return { kind: 'note', text: title };
}

/** "Nuwan joined the chat with Visitor 4F2A" (R-03 "SOMEONE ELSE JOINS"): a toast with View. */
function joinedOutcome(byName: string | null, visitor: string): Omit<WebchatRingOutcome, 'id' | 'at'> {
  const by = byName ?? 'A colleague';
  return { kind: 'joined', by, visitor, text: `${firstName(by)} joined the chat with ${visitor}` };
}

/**
 * A colleague joined while I was typing to the visitor (R-05, UX-ALR-04): my words are kept and the alert asks
 * "Nuwan joined — send to the chat as a participant?"; nothing is sent until I choose.
 */
export function participantOutcome(byName: string | null, visitor: string, draft: string): Omit<WebchatRingOutcome, 'id' | 'at'> {
  return { kind: 'joined', by: byName ?? 'A colleague', visitor, draft, text: `${byName ? firstName(byName) : 'A colleague'} joined — send to the chat as a participant?` };
}

/**
 * A Join that lost the race (RING-02; R-03 "too late"): "You pressed Join a moment late — Dilini already has this
 * chat." Who has it comes with the server's 409 (`by_name`); an older server only says it in words, which are kept.
 */
export function lateOutcome(e: { message: string; data?: unknown }): Omit<WebchatRingOutcome, 'id' | 'at'> {
  const data = e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {};
  const by = text(data.by_name, 120) ?? /^(.+?) has already taken this chat\.?$/.exec(e.message.trim())?.[1]?.trim() ?? null;
  if (!by) return { kind: 'note', text: e.message || 'Someone else has already taken this chat.' };
  return { kind: 'late', by, text: `You pressed Join a moment late — ${firstName(by)} already has this chat.` };
}

/** How long an outcome is said; one with something to do — View, Open in Missed — stays until it is used or dismissed, or this. */
const OUTCOME_MS = 5_000;
const OUTCOME_ACTION_MS = 20_000;

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
  /** How many times they have visited (R-01 "3rd visit"); absent on an older server. */
  visits?: number | null;
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
/** A count the server sent, or null when it sent none (an older server). */
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

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
    visits: count(c.visits) ?? prev?.visits ?? null,
    preview: text(c.preview, 280) ?? prev?.preview ?? null,
    priority,
    offline: c.offline ?? prev?.offline ?? false,
    since: text(c.waiting_since, 32) ?? text(c.at, 32) ?? prev?.since ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
    stage: text(c.stage, 32) ?? prev?.stage ?? null,
    atRisk: !!c.at_risk || !!prev?.atRisk,
    mine: false,
    by: null,
    silenced: prev?.silenced ?? false,
    othersRinging: prev?.othersRinging ?? null,
  };
}

/** A chat from the server's ring session, as this computer shows it: the server's silence and handover time win. */
export function fromRinging(r: RingingEntry, prev: WebchatRingChat | undefined): WebchatRingChat | null {
  const base = fromContext({ ...r, conversation_id: Number(r.conversation_id ?? r.id), waiting_since: r.since ?? r.waiting_since }, prev);
  if (!base) return null;
  return { ...base, mine: !!r.mine, by: text(r.by, 120), silenced: !!r.silenced && !base.atRisk, handoverAt: text(r.handover_at, 32), othersRinging: count(r.others_ringing) ?? prev?.othersRinging ?? null };
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

/** An outcome behind WorkSuite's lock: what happened, without the visitor, the colleague or the email. */
export function hideOutcome(o: WebchatRingOutcome): WebchatRingOutcome {
  const words: Record<string, string> = {
    joined: 'A colleague joined the chat.',
    late: 'Someone else already has this chat.',
    visitor_left: 'A visitor left the site before anyone joined. Ringing stopped.',
    visitor_ended: 'A visitor ended the chat. Ringing stopped.',
  };
  // A draft kept for me (UX-ALR-04) is not shown behind the lock either; it is still there after the unlock.
  return { ...o, text: (o.kind && words[o.kind]) || o.text, visitor: o.visitor ? 'A visitor' : o.visitor, by: null, email: null, draft: null };
}

/** Server stamps are true UTC without a zone. */
export function stampMs(s: string): number {
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * What the tone does (RING-21, RING-47): nothing when every chat is silenced,
 * an offline enquiry (a card, not a ring), past the organisation's cap, or
 * quiet by the person's Do not disturb choice; the stronger tone when the top
 * chat — the one that sounds — is at risk, high, urgent or VIP.
 */
export function toneFor(chats: WebchatRingChat[], opts: { ringSeconds: number; quiet: boolean; duringDnd: WebchatRingPrefs['duringDnd']; now: number; ringHere?: boolean | null; handoffs?: number; calls?: number }): WebchatRingState['tone'] {
  // Another of my devices plays the ring (RING-10): this one shows it without sound.
  if (opts.ringHere === false) return 'off';
  // A visitor waiting on the line rings like a chat at risk: through Do not disturb unless it only shows cards (VOICE-10).
  if ((opts.calls ?? 0) > 0) return opts.quiet && opts.duringDnd === 'card' ? 'off' : 'strong';
  const live = chats.filter((c) => !c.silenced && !c.offline && (c.atRisk || opts.ringSeconds <= 0 || opts.now - stampMs(c.since) < opts.ringSeconds * 1000));
  // A colleague asking me in rings too, like a chat that has reached me (TEAM-23).
  if (!live.length) return (opts.handoffs ?? 0) > 0 && !(opts.quiet && opts.duringDnd !== 'ring') ? 'normal' : 'off';
  // Only the top card sounds (R-02, RING-23): its tone, not the loudest of the chats under it. At risk is always on top.
  const top = orderChats(live)[0]!;
  const strong = top.atRisk || LOUD.has(top.priority);
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
    // Every chat silenced for me: the compact "still waiting" card (R-04, RING-24).
    if (s.chats.length && s.chats.every((c) => c.silenced)) return 150;
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
  /** Bring the main window forward on a chat in Missed chats (R-03 "Open in Missed"). */
  openMissed?: (conversationId: number) => void;
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
  /**
   * Whether the realtime connection is up (worksuite-desktop#251): while it is not, the list is read every 10 s instead
   * of every 15, so a new chat still rings within seconds.
   */
  realtimeUp?: () => boolean;
  /**
   * A chat found ringing by reading the list, not by a realtime event (the socket was down, or the frame was lost):
   * told as the event would have been — the system notification with Join and Reply when the card is not showing.
   */
  announce?: (chat: WebchatRingChat) => void;
  /** The test chat notification (#251): shown by the system, and whether it said it was. */
  testNotify?: () => Promise<RingTestNotice>;
}

/** What the server answers for a test ring (RingController::test). */
interface RingTestAnswer {
  routed?: boolean;
  why?: string | null;
  widgets?: string[];
  status?: string;
  available?: boolean;
  test_id?: string;
  sent?: boolean;
  realtime?: boolean;
}

/** How long a refusal (403/404: not website staff, or no website chat) stands before the list is asked for again. */
export const REFUSED_RETRY_MS = 5 * 60_000;
/** How often the list is read while realtime is down (#251); 15 s otherwise. */
export const FALLBACK_POLL_MS = 10_000;
/** How long the test ring waits for its realtime event. */
export const TEST_WAIT_MS = 5_000;

/**
 * The test's steps from what happened (worksuite-desktop#251): routed to you · received by this computer · desktop
 * notification shown. The sound is the window's to play and say.
 */
export function ringTestSteps(a: RingTestAnswer | null, error: string | null, received: 'realtime' | 'none' | null, notice: RingTestNotice | null): RingTestStep[] {
  const presence: Record<string, string> = { busy: 'Busy', dnd: 'Do not disturb', away: 'Away', offline: 'Offline' };
  const routed: RingTestStep = error
    ? { id: 'routed', label: 'Routed to you', state: 'fail', detail: error }
    : !a?.routed
      ? { id: 'routed', label: 'Routed to you', state: 'fail', detail: a?.why ?? 'No website chat would ring for you.' }
      : {
          id: 'routed',
          label: 'Routed to you',
          state: a.available === false ? 'warn' : 'ok',
          detail:
            a.available === false
              ? `New chats ring for you on ${(a.widgets ?? []).join(', ')}, but you show as ${presence[a.status ?? ''] ?? a.status ?? 'not available'}, so none is given to you by turn.`
              : `New chats on ${(a.widgets ?? []).join(', ')} ring for you.`,
        };
  const got: RingTestStep =
    received === 'realtime'
      ? { id: 'received', label: 'Received by this computer', state: 'ok', detail: 'Over the live connection, at once.' }
      : received === 'none'
        ? {
            id: 'received',
            label: 'Received by this computer',
            state: 'warn',
            detail: a?.realtime === false ? 'Live updates are off on this server: chats reach this computer by checking every 10–15 seconds.' : 'The live connection did not deliver it: chats reach this computer by checking every 10–15 seconds until it is back.',
          }
        : { id: 'received', label: 'Received by this computer', state: error ? 'fail' : 'pending', detail: null };
  const shown: RingTestStep = !notice
    ? { id: 'notification', label: 'Desktop notification shown', state: 'pending', detail: null }
    : notice.state === 'shown'
      ? { id: 'notification', label: 'Desktop notification shown', state: 'ok', detail: notice.detail }
      : notice.state === 'unknown'
        ? { id: 'notification', label: 'Desktop notification shown', state: 'warn', detail: notice.detail }
        : { id: 'notification', label: 'Desktop notification shown', state: 'fail', detail: notice.detail };
  return [routed, got, shown];
}

/** What `joinAndSend` does after joining: a mini chat on the card (#225), nothing more, or the thread opened (R-05). */
export interface JoinSendOptions {
  /** False: no mini chat (a reply typed in a system notification or the tray's menu). */
  stay?: boolean;
  /** Bring WorkSuite forward on the thread (R-05, UX-ALR-01; RING-41): the native window's Send & join and Join chat. */
  open?: boolean;
  /** The saved reply the words came from, counted once sent (RDC-03). */
  cannedId?: number;
  /**
   * A Needs you row of the tray's mini-dashboard or the Live map window (UX-ALR-03): a chat waiting on us that may not
   * ring for me (the escalation has not reached me, say). Who the visitor is, so it can be joined all the same.
   */
  visitor?: string;
}

/**
 * A chat waiting on us that is not ringing for me, as a Needs you row names it (L-04, L-05; UX-ALR-03): joined and
 * answered by the same requests, and told the same way when a colleague was first.
 */
export function liveRowChat(conversationId: number, visitor: string): WebchatRingChat {
  return {
    id: conversationId, visitor: visitor.slice(0, 200) || 'A visitor', site: null, page: null, place: null, device: null, returning: false, preview: null,
    priority: 'normal', offline: false, since: new Date().toISOString().slice(0, 19).replace('T', ' '), stage: null, atRisk: false, mine: false, by: null, silenced: false,
  };
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
  /** Its name and whether it is a headset, for the call card's device line (V-04, VOICE-14). */
  private micLabel: string | null = null;
  private micHeadset = false;
  private ringSeconds = 0;
  /** Whether the server has this computer play the ring; null when it does not choose (no ring sessions there). */
  private ringHere: boolean | null = null;
  /** My ringtone as the server keeps it (RING-29, P-02); classic until it says. */
  private ringtone = 'classic';
  /** The server keeps ring sessions: silence is sent to it, and its list is the truth. */
  private sessions = false;
  /** The server has no heartbeat (an older WorkSuite): this computer decides alone. */
  private noHeartbeat = false;
  private beatTimer: NodeJS.Timeout | null = null;
  private outcome: WebchatRingState['outcome'] = null;
  /** The chat I joined last and how many colleagues its ring stopped for (R-03 "YOU JOIN"). */
  private youJoined: WebchatRingState['youJoined'] = null;
  private timer: NodeJS.Timeout | null = null;
  private soon: NodeJS.Timeout | null = null;
  private outcomeTimer: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout | null = null;
  /**
   * Not website staff, or no website chat on this server (the server refused): asked again after REFUSED_RETRY_MS, at
   * the next sign-in or on a reconnect. It was until the next sign-in only, so one refusal — a server mid-update, its
   * routes briefly missing — silenced every chat on this computer for as long as the app stayed signed in (#251).
   */
  private refused = false;
  private refusedAt = 0;
  /** When the list was last read, for the faster reading while realtime is down (#251). */
  private lastRead = 0;
  /** Chats this computer has been told about, by event or by notice, so a list read does not announce them again. */
  private announced = new Set<number>();
  /** The test ring waiting for its event (#251). */
  private testWait: { id: string; resolve: () => void } | null = null;
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
  /** What I have typed to each ringing visitor (R-05, R-06; UX-ALR-04), shared by the call window and the tray. */
  private drafts = new Map<number, string>();
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
      // While realtime is down the list is the only way a new chat reaches this computer (#251); a refusal is asked
      // about again after a while rather than never.
      const now = Date.now();
      if (this.refused && now - this.refusedAt >= REFUSED_RETRY_MS) this.refused = false;
      if (this.deps.realtimeUp && !this.deps.realtimeUp() && now - this.lastRead >= FALLBACK_POLL_MS) void this.reconcile();
    }, 5_000);
    this.tick.unref?.();
  }

  stop(): void {
    this.running = false;
    this.announced.clear();
    this.testWait?.resolve();
    this.testWait = null;
    for (const t of [this.timer, this.soon, this.outcomeTimer, this.tick, this.beatTimer]) if (t) clearTimeout(t);
    this.timer = this.soon = this.outcomeTimer = this.tick = this.beatTimer = null;
    this.chats.clear();
    this.handoffs.clear();
    this.calls.clear();
    this.followUps.clear();
    this.snoozed.clear();
    this.drafts.clear();
    this.ringHere = null;
    this.sessions = false;
    this.outcome = null;
    this.youJoined = null;
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
      calls: hidden ? calls.map((c) => ({ ...c, visitor: 'A visitor', page: null, place: null, preview: null, owner: null, email: null, phone: null })) : calls,
      answerShortcut: this.answerShortcut,
      mic: this.mic(),
      tone: toneFor(chats, { ringSeconds: this.ringSeconds, quiet: this.deps.quiet(), duringDnd: prefs.duringDnd, now, ringHere: this.ringHere, handoffs: handoffs.length, calls: calls.length }),
      volume: Math.max(0, Math.min(100, prefs.volume)),
      ringtone: this.ringtone,
      ringOn: prefs.ringOn ?? 'both',
      // Behind the lock an outcome says what happened, never to whom or by whom.
      outcome: hidden && this.outcome ? hideOutcome(this.outcome) : this.outcome,
      youJoined: hidden ? null : this.youJoined,
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
      // Only for chats still ringing, and nothing of it behind the lock.
      drafts: hidden ? {} : Object.fromEntries([...this.drafts].filter(([cid, t]) => t && this.chats.has(cid))),
    };
  }

  /**
   * What is typed to a ringing visitor (R-05, R-06; UX-ALR-04), as the call window or the tray's menu says it: kept
   * here so it is the same in both, and so a colleague joining first does not lose it.
   */
  setDraft(conversationId: number, words: string): void {
    const t = words.slice(0, 4000);
    if ((this.drafts.get(conversationId) ?? '') === t) return;
    if (!t.trim()) this.drafts.delete(conversationId);
    else if (this.chats.has(conversationId)) this.drafts.set(conversationId, t);
    else return;
    this.changed();
  }

  /**
   * A colleague got the chat first (R-03, RING-28): with words typed to the visitor, they are kept and the alert asks
   * whether to send them as a participant (UX-ALR-04); without, it is said as R-03 says it.
   */
  private takenByOther(cid: number, byName: string | null, visitor: string, plain: Omit<WebchatRingOutcome, 'id' | 'at'>, typed?: string | null): void {
    const draft = (typed ?? this.drafts.get(cid) ?? '').trim();
    this.drafts.delete(cid);
    // Asked in the call window, which must be on to ask it; off, a banner's refused reply is kept as the chat's draft.
    if (draft && this.deps.prefs().window) this.say(cid, '', participantOutcome(byName, visitor, draft));
    else this.say(cid, '', plain);
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
  async joinAndSend(conversationId: number, message: string | null, opts: JoinSendOptions = {}): Promise<{ ok: boolean; why: string | null }> {
    const c = this.chats.get(conversationId) ?? (opts.visitor ? liveRowChat(conversationId, opts.visitor) : undefined);
    if (!c) return { ok: false, why: 'This chat is no longer ringing.' };
    const text = message?.trim() || null;
    const key = { headers: { 'Idempotency-Key': `ring-join-${conversationId}-${randomUUID()}` } };
    const canned = text && opts.cannedId ? { canned_id: opts.cannedId } : {};
    try {
      try {
        await this.deps.http.post(`${WEBSITE}/conversations/${conversationId}/join-reply`, text ? { message: text, ...canned } : {}, key);
      } catch (e) {
        // A server from before Join & send: Accept, then the reply, as two requests.
        if (!(isDesktopError(e) && e.status === 404 && !/conversation/i.test(e.message))) throw e;
        if (!c.mine) await this.deps.http.post(`${WEBSITE}/conversations/${conversationId}/accept`);
        if (text) await this.deps.http.post(`${WEBSITE}/conversations/${conversationId}/reply`, { message: text }, key);
      }
    } catch (e) {
      // A moment late (R-03): who has it, in the design's words; anything else, why it did not work.
      const late = isDesktopError(e) && e.status === 409 ? lateOutcome(e) : null;
      const why = late ? late.text : `Could not join: ${e instanceof Error ? e.message : 'the server did not answer'}`;
      if (late) {
        this.chats.delete(conversationId);
        // What I was sending is kept, and nothing goes without my choosing (UX-ALR-04).
        // A reply typed in a banner (`stay: false`) is kept by the notification as the chat's draft instead (RDC-15).
        if (late.kind === 'late' && opts.stay !== false) this.takenByOther(conversationId, late.by ?? null, c.visitor, late, text);
        else this.say(conversationId, why, late);
      } else this.say(conversationId, why);
      this.changed();
      return { ok: false, why };
    }
    this.chats.delete(conversationId);
    this.drafts.delete(conversationId);
    this.joinedNow(c);
    this.minimisedFor = null;
    if (opts.open) {
      // The native window's Send & join and Join chat (R-05, UX-ALR-01; RING-41): the thread opens with the message in it.
      this.changed();
      this.deps.open(conversationId);
      this.reconcileSoon();
      return { ok: true, why: null };
    }
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
    const ev = e as unknown as Record<string, unknown>;
    // The test chat notification arrived (#251): never a chat, never on the card.
    if (e.type === 'chat.ring.test') {
      if (this.testWait && ev.test_id === this.testWait.id) this.testWait.resolve();
      return;
    }
    if (!this.running || this.refused) return;
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
        // The ring stopped for everybody, for a reason (RING-03, RING-28), told as R-03 tells it.
        const by = id(ev.by);
        const me = by !== null && by === this.deps.me();
        // My own join: the server counts who it stopped ringing for, more surely than the card did (R-03 "YOU JOIN").
        if (ev.reason === 'joined' && me && this.youJoined?.id === cid && count(ev.stopped_for) !== null) {
          this.youJoined = { id: cid, colleagues: count(ev.stopped_for) };
          this.changed();
        }
        const c = this.chats.get(cid);
        if (!c) return;
        this.chats.delete(cid);
        if (ev.reason === 'joined') {
          if (by !== null && !me) this.takenByOther(cid, text(ev.by_name, 120), c.visitor, joinedOutcome(text(ev.by_name, 120), c.visitor));
          else this.drafts.delete(cid);
        } else {
          this.drafts.delete(cid);
          const o = stopOutcome(ev.reason, c.visitor, ev);
          if (o) this.say(cid, o.text, o);
        }
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
        this.announced.add(cid);
        const c = fromContext(ev as unknown as WaitingContext, this.chats.get(cid));
        if (c) this.chats.set(cid, { ...c, mine: this.chats.get(cid)?.mine ?? false, by: this.chats.get(cid)?.by ?? null });
        this.changed();
        this.reconcileSoon();
        break;
      }
      case 'chat.assigned': {
        this.announced.add(cid);
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
        const c = this.chats.get(cid);
        if (!c) return;
        this.chats.delete(cid);
        const by = id(ev.by);
        if (ev.how === 'closed') {
          this.drafts.delete(cid);
          this.say(cid, STOP_WORDS.closed!);
        } else if (by !== null && by !== this.deps.me()) this.takenByOther(cid, text(ev.by_name, 120), c.visitor, joinedOutcome(text(ev.by_name, 120), c.visitor));
        else this.drafts.delete(cid);
        this.changed();
        break;
      }
      default:
        break;
    }
  }

  /**
   * Join (RING-02/22): accept a waiting chat — or open one assigned to me, which joins it — and bring WorkSuite forward on
   * it. `visitor`: a Needs you row of the tray or the Live map window, which may not be ringing for me (UX-ALR-03).
   */
  async join(conversationId: number, then?: 'transfer', visitor?: string): Promise<boolean> {
    const c = this.chats.get(conversationId) ?? (visitor ? liveRowChat(conversationId, visitor) : undefined);
    if (!c) return false;
    if (!c.mine) {
      try {
        await this.deps.http.post(`${WEBSITE}/conversations/${conversationId}/accept`);
      } catch (e) {
        if (isDesktopError(e) && e.status === 409) {
          // A moment too late: the server says who has it (RING-02; R-03 "You pressed Join a moment late").
          this.chats.delete(conversationId);
          const late = lateOutcome(e);
          if (late.kind === 'late') this.takenByOther(conversationId, late.by ?? null, c.visitor, late);
          else this.say(conversationId, late.text, late);
          this.changed();
          return false;
        }
        this.say(conversationId, `Could not join: ${e instanceof Error ? e.message : 'the server did not answer'}`);
        this.changed();
        return false;
      }
    }
    this.chats.delete(conversationId);
    this.drafts.delete(conversationId);
    this.joinedNow(c);
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
    // With a voice call on in the chat, accepting says which (V-03, WF-V3): the chat opens on it and joins its audio.
    let callId: number | undefined;
    try {
      const r = await this.deps.http.post<{ call_id?: number | null } | null>(`${WEBSITE}/handoffs/${handoffId}/${accept ? 'accept' : 'decline'}`);
      callId = id(r?.call_id) ?? undefined;
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
    this.clearOutcome();
    this.changed();
    if (accept) this.deps.open(h.conversationId, callId);
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
    // Ctrl/Cmd+Shift+A and the tray answer as the card's Answer does (V-04): not behind WorkSuite's lock — the call
    // would open the chat and the microphone with nobody shown to be there — and not without a microphone (VOICE-11).
    // Declining stays open to both, so the ring can still be stopped.
    if (accept && (this.deps.locked() || this.hasMic === false)) {
      this.say(c.conversationId, this.deps.locked() ? 'Unlock WorkSuite to answer the call.' : 'No microphone on this computer — plug one in to answer.');
      this.changed();
      return false;
    }
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
    this.clearOutcome();
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
  setMic(has: boolean, label: string | null = null, headset = false): void {
    const name = has ? text(label, 120) : null;
    const isHeadset = has && headset;
    const named = name !== this.micLabel || isHeadset !== this.micHeadset;
    this.micLabel = name;
    this.micHeadset = isHeadset;
    if (this.hasMic === has) {
      // Only its name changed (another headset plugged in): the card's device line says so; the server need not know.
      if (named) this.changed();
      return;
    }
    this.hasMic = has;
    this.changed();
    void this.beat();
  }

  /** The device line's microphone (V-04), or null before the main window has looked. */
  private mic(): WebchatMic | null {
    return this.hasMic === null ? null : { ready: this.hasMic, label: this.micLabel, headset: this.micHeadset };
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
      this.drafts.delete(conversationId);
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

  /**
   * "Send a test chat notification" (Settings › Ringing, worksuite-desktop#251): the server says whether a new chat
   * would be routed to me and sends a test to my own devices; this computer says whether it received it and whether
   * the system showed its notification. No conversation is made. The sound is played and checked by the window.
   */
  async testRing(): Promise<RingTestStep[]> {
    let answer: RingTestAnswer | null = null;
    try {
      answer = await this.deps.http.post<RingTestAnswer>('/api/chat/ring/test', {});
    } catch (e) {
      const why = isDesktopError(e) && e.status === 404 ? 'This server cannot send a test yet: it needs the Communication update with worksuite-desktop#251.' : isDesktopError(e) && e.status === 403 ? 'You cannot see website chats, so none rings for you.' : e instanceof Error ? e.message : 'The server did not answer.';
      return ringTestSteps(null, why, null, null);
    }
    const testId = typeof answer?.test_id === 'string' ? answer.test_id : null;
    let received: 'realtime' | 'none' = 'none';
    if (testId && answer?.sent !== false) {
      received = await new Promise<'realtime' | 'none'>((resolve) => {
        const timer = setTimeout(() => {
          if (this.testWait?.id === testId) this.testWait = null;
          resolve('none');
        }, TEST_WAIT_MS);
        timer.unref?.();
        this.testWait = {
          id: testId,
          resolve: () => {
            clearTimeout(timer);
            this.testWait = null;
            resolve('realtime');
          },
        };
      });
    }
    const notice = this.deps.testNotify ? await this.deps.testNotify() : { state: 'unknown' as const, detail: null };
    return ringTestSteps(answer, null, received, notice);
  }

  /** Settings changed (Do not disturb, volume, the window): say it again. */
  refresh(): void {
    this.last = '';
    this.emit();
  }

  async reconcile(): Promise<void> {
    if (!this.running || !this.deps.signedIn()) return;
    if (this.refused && Date.now() - this.refusedAt < REFUSED_RETRY_MS) return;
    this.lastRead = Date.now();
    try {
      const answer = await this.deps.http.get<PendingAnswer>(`${WEBSITE}/assignments/pending`, { query: { device_id: this.deps.deviceId() } });
      if (!this.running) return;
      this.refused = false;
      this.ringSeconds = Math.max(0, Number(answer?.ring_seconds ?? 0) || 0);
      this.sessions = Array.isArray(answer?.ringing);
      if (typeof answer?.ring_here === 'boolean') this.ringHere = answer.ring_here;
      const tone = answer?.ring_prefs?.ringtone;
      if (typeof tone === 'string' && /^[a-z0-9_-]{1,20}$/.test(tone)) this.ringtone = tone;
      const next = mergeAnswer(answer ?? {}, this.chats);
      this.chats = new Map(next.map((c) => [c.id, c]));
      // A chat this computer had heard nothing about — the socket was down, or the frame was lost — is announced as
      // the event would have announced it (#251); one that stopped ringing may be announced again if it rings again.
      for (const c of next) {
        if (this.announced.has(c.id)) continue;
        this.announced.add(c.id);
        if (!c.silenced) this.deps.announce?.(c);
      }
      for (const cid of this.announced) if (!this.chats.has(cid)) this.announced.delete(cid);
      for (const cid of this.drafts.keys()) if (!this.chats.has(cid)) this.drafts.delete(cid);
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
        // Not website staff, or no website chat on this server: nothing rings here — until asked again (#251).
        this.refused = true;
        this.refusedAt = Date.now();
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

  /**
   * Say how something ended, for a few seconds (RING-28). `o` draws it as R-03 does — its words win over `words`; one
   * with something to do (View, Open in Missed) is said for longer, until it is used or dismissed.
   */
  private say(conversationId: number, words: string, o?: Omit<WebchatRingOutcome, 'id' | 'at'>): void {
    // Words kept for me (UX-ALR-04) stay until I choose what to do with them: another note does not replace them.
    if (this.outcome?.draft && !o?.draft) return;
    this.outcome = { kind: 'note', ...o, id: conversationId, text: o?.text || words, at: Date.now() };
    const act = this.outcome.kind === 'joined' || (this.outcome.kind === 'visitor_left' && !!this.outcome.missed);
    if (this.outcomeTimer) clearTimeout(this.outcomeTimer);
    this.outcomeTimer = null;
    if (this.outcome.draft) return;
    this.outcomeTimer = setTimeout(() => {
      this.outcome = null;
      this.outcomeTimer = null;
      this.emit();
    }, act ? OUTCOME_ACTION_MS : OUTCOME_MS);
    this.outcomeTimer.unref?.();
  }

  /**
   * I joined (RING-22; R-03 "YOU JOIN"): nothing more to say about the ring, and "ringing stopped for N colleagues" —
   * as many as the card said it rang for besides me, until the server's count comes with its stop event.
   */
  private joinedNow(c: WebchatRingChat): void {
    this.clearOutcome();
    this.youJoined = { id: c.id, colleagues: c.mine ? 0 : (c.othersRinging ?? null) };
  }

  /**
   * The outcome card's buttons (R-03): View the chat a colleague joined, Open in Missed for a visitor who left before
   * anyone joined — never the inbox, where opening it would join it — or Dismiss.
   */
  async outcomeAction(action: 'view' | 'missed' | 'dismiss' | 'participant'): Promise<void> {
    const o = this.outcome;
    if (this.outcomeTimer) clearTimeout(this.outcomeTimer);
    this.outcomeTimer = null;
    this.outcome = null;
    this.changed();
    if (!o || action === 'dismiss') return;
    if (action === 'participant') return this.sendAsParticipant(o);
    if (action === 'view' && o.kind === 'joined') this.deps.open(o.id);
    else if (action === 'missed' && o.kind === 'visitor_left' && o.missed) (this.deps.openMissed ?? this.deps.open)(o.id);
  }

  /**
   * "Send to the chat" on the kept words (UX-ALR-04): a reply to a chat a colleague has, so the server joins me as a
   * participant (TEAM-02) — sent as the conversation's composer sends one. Refused, the words stay with the reason.
   */
  private async sendAsParticipant(o: WebchatRingOutcome): Promise<void> {
    if (!o.draft) return;
    const r = this.deps.reply ? await this.deps.reply(o.id, o.draft) : null;
    if (r && (r.delivered || r.queued)) {
      this.say(o.id, r.queued && !r.delivered ? 'Your reply will be sent when you are back online.' : 'Sent — you are in the chat as a participant.');
      this.changed();
      return;
    }
    const { id: cid, at: _at, ...kept } = o;
    this.say(cid, '', { ...kept, text: `Not sent: ${r?.error ?? 'open the chat to reply.'} Send to the chat as a participant?` });
    this.changed();
  }

  /** Nothing more to say — except words kept for me, which wait for my choice (UX-ALR-04). */
  private clearOutcome(): void {
    if (this.outcome?.draft) return;
    this.outcome = null;
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
