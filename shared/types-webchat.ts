import type { WallDisplay, WallModePrefs } from './types-prefs';

/** Website chats ringing like calls: the ring state, its chats, calls, hand-offs and outcomes. Re-exported by shared/types.ts (audit D-G13). */

/**
 * A visitor wrote again in a chat I have, or am in, and nobody has answered (worksuite-desktop#230): from the
 * `chat.widget.message` and `chat.widget.followup` events. Several messages make one entry.
 */
export interface WebchatFollowUp {
  /** The conversation. */
  id: number;
  visitor: string;
  site: string | null;
  /** The visitor's latest message and the one or two before it (theirs or ours), oldest first. */
  recent: Array<{ from: 'visitor' | 'agent'; body: string; at: string | null }>;
  /** Since when the visitor has waited for an answer. */
  since: string;
  /** New messages from the visitor since the card came up. */
  count: number;
  /** replied: the visitor wrote; reminder: still no answer; team: the team was alerted (Take over is offered). */
  stage: 'replied' | 'reminder' | 'team';
  /** The chat is mine (assigned to me), rather than one the team was alerted about. */
  mine: boolean;
  /** Who has it, when that is not me. */
  agent: string | null;
}

/**
 * A website chat ringing for this person (ENH-WCHAT-01): who, where, and how
 * long, from the server's own pending list and events — never from opening
 * the conversation, which would join it.
 */
export interface WebchatRingChat {
  id: number;
  visitor: string;
  site: string | null;
  /** The page they are reading (its title, or its address). */
  page: string | null;
  /** City and country, when known. */
  place: string | null;
  device: string | null;
  returning: boolean;
  /** What they wrote, when an event said. */
  preview: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent' | 'vip';
  /** Started while nobody was answering: a card, not a continuous ring (RING-08, "once"). */
  offline: boolean;
  /** Waiting since, a server stamp (true UTC without a zone). */
  since: string;
  /** The escalation step that reached this person: first, priority, everyone, supervisor, released. */
  stage: string | null;
  atRisk: boolean;
  /** Assigned to me and not yet opened: I ring until I join (RING-05). */
  mine: boolean;
  /** Who assigned it, for a chat that is mine. */
  by: string | null;
  /** Silenced by me until it is at risk: on all my devices where the server keeps ring sessions, else on this computer (RING-11). */
  silenced: boolean;
  /** A chat given to me that I have not joined passes on to the next available agent at this server stamp (RING-05, RING-12). */
  handoverAt?: string | null;
  /** How many times the visitor has visited, for "3rd visit" (R-01); null where the server does not say. */
  visits?: number | null;
  /** How many colleagues it rings for besides me, for "2 others ringing" (R-01); null where the server does not say. */
  othersRinging?: number | null;
  /**
   * A returning visitor (worksuite-desktop#291): their closed chat reopened when they wrote again, or a new one on the
   * same profile, and who had the last one when. Absent for a first chat, and from a server without it.
   */
  returnVisit?: WebchatReturnVisit | null;
}

/**
 * A visitor back after a closed chat (worksuite-desktop#291), as the ring says it: "Returning visitor · last chat with
 * you on 16 Aug". The server routes it to the agent of the last chat first, then the team.
 */
export interface WebchatReturnVisit {
  /** The closed conversation was reopened; false: a new one, linked to the last. */
  reopened: boolean;
  /** When the last chat was, a server stamp; null where it is not known. */
  previousAt: string | null;
  previousAgentId: number | null;
  previousAgentName: string | null;
  previousConversationId: number | null;
  /** The last chat was with me, as the ringer knows who I am. */
  withYou?: boolean;
}

/**
 * A colleague asks me into a website chat (WS-WCHAT ENH-WCHAT-03): an invitation to join it, or a transfer of it to
 * me — warm (they keep it until I accept) or handed over now. It rings like a chat until I answer it, it is cancelled,
 * or `expiresAt` passes (TEAM-23, TEAM-41).
 */
export interface WebchatHandoff {
  id: number;
  conversationId: number;
  kind: 'invite' | 'transfer';
  mode: 'warm' | 'cold';
  visitor: string;
  site: string | null;
  page: string | null;
  /** Who asks; null when WorkSuite sends it (a transfer nobody took, back to everybody). */
  from: string | null;
  /** The department it rings, when it was sent to one. */
  department: string | null;
  /** The next available agent, or everybody covering the website. */
  toAny: boolean;
  /** The note for staff, shown on the card (TEAM-22, TEAM-43). */
  note: string | null;
  /** Server stamp; null rings until somebody takes it. */
  expiresAt: string | null;
  createdAt: string | null;
  /**
   * When it runs out by this computer's clock (ms), from the server's own count of seconds left (C-09): the INVITATION
   * and TRANSFER TO YOU countdowns run true on a computer whose clock is off. Absent from an older server.
   */
  endsAt?: number | null;
  /** A voice call is on in the chat (V-03, WF-V3): joining the chat joins the call too, and the card says so. */
  onCall?: boolean;
}

/** A visitor's voice call ringing for me (WS-WCHAT ENH-WCHAT-05, VOICE-10). */
export interface WebchatCall {
  /** The call's id. */
  id: number;
  conversationId: number;
  visitor: string;
  site: string | null;
  page: string | null;
  place: string | null;
  /** The visitor's latest words, for context. */
  preview: string | null;
  /** Who owns the chat, if anybody. */
  owner: string | null;
  /** Rung as one of the chat's people, or as one of everybody who takes calls. */
  stage: 'first' | 'everyone';
  /** Server stamp. */
  requestedAt: string | null;
  /** What the visitor gave before calling, or the chat already knew (UX-WGT-10); absent on an older server. */
  email?: string | null;
  phone?: string | null;
}

/** The microphone a visitor's call would use on this computer, as the main window found it (V-04, VOICE-11, VOICE-14). */
export interface WebchatMic {
  /** This computer has a microphone at all: without one it is not rung, and cannot answer. */
  ready: boolean;
  /** The device's name ("Jabra Evolve2"), once the system names it; null before the microphone was ever allowed. */
  label: string | null;
  /** The microphone has a speaker of its own — a headset — so the call is heard through it. */
  headset: boolean;
}

/** The website call this computer is on, as the tray says it (VOICE-UI-03). */
export interface WebchatOnCall {
  conversationId: number;
  visitor: string;
  /** Epoch ms it was answered. */
  since: number;
  held: boolean;
}

export interface WebchatRingState {
  /** Ordered: at risk, assigned to me, then oldest waiting (RING-23). */
  chats: WebchatRingChat[];
  /** Invitations and transfers waiting for me, oldest first (TEAM-23). */
  handoffs?: WebchatHandoff[];
  /** Visitors' voice calls ringing for me, oldest first: shown before everything else (VOICE-10). */
  calls?: WebchatCall[];
  /** Ctrl/Cmd+Shift+A answers the top call now. */
  answerShortcut?: boolean;
  /** The microphone a call would use (V-04 device line); null until the main window has looked. */
  mic?: WebchatMic | null;
  /** What the tone does now: off (none left unsilenced, Do not disturb, the organisation's cap), or which tone. */
  tone: 'off' | 'normal' | 'strong';
  volume: number;
  /** My ringtone, kept on the server with my other ringing settings so every device sounds the same (RING-29). */
  ringtone?: string;
  /** Where the ring plays (RING-42): with a headset on, the speakers too, unless I chose the system's output only. */
  ringOn?: 'both' | 'default';
  /** How a ring ended, said for a few seconds (RING-28); `kind` and the rest draw it as R-03 does. */
  outcome: WebchatRingOutcome | null;
  /**
   * The chat I just joined, and how many colleagues its ring stopped for (R-03 "You joined the chat · ringing stopped
   * for 2 colleagues"); null where the count is not known.
   */
  youJoined?: { id: number; colleagues: number | null } | null;
  /** Locked: the window says a chat is waiting, and nothing about who. */
  hidden: boolean;
  /** Ctrl/Cmd+Shift+J is registered now. */
  shortcut: boolean;
  /** Another of my devices plays the ring — the browser I chose, say — so this computer shows it without sound (RING-10). */
  elsewhere?: boolean;
  /** Whether the server has this computer play my ring (RING-10, RING-49); null where it does not choose. */
  ringHere?: boolean | null;
  /** The chat I just joined from the card (worksuite-desktop#225): the card is a mini chat on it until I open the full chat or minimise it. */
  joined?: WebchatJoined | null;
  /** The card is minimised while these chats ring; a new one brings it back. The tone goes on. */
  minimised?: boolean;
  /** The card's own height, as it measured itself: the window fits it, so there is no empty space under it. */
  fit?: number | null;
  /** Visitors who wrote again in my chats while I was away from them, longest waiting first (worksuite-desktop#230). */
  followUps?: WebchatFollowUp[];
  /** Goes up by one each time the "visitor replied" chime should play once. */
  chime?: number;
  /** Whether the follow-up card shows over other apps (Settings › Website chats). */
  followUpCard?: boolean;
  /**
   * What I have typed to each ringing visitor, by conversation (R-05, R-06; UX-ALR-04): the call window and the tray's
   * menu share it, and it is kept if a colleague joins first. Empty behind the lock.
   */
  drafts?: Record<number, string>;
}

/**
 * What the tray's mini-dashboard and the Live map window need from this computer (L-04, L-05; MAP-21, MAP-22, MAP-24).
 */
export interface LiveDeskInfo {
  /**
   * Where "Wall mode on Display 2" opens: the display in words ("Display 2") and the screen's own name ("LG 27″") when
   * the system says it. The first screen that is not the main one; the main one when there is only one.
   */
  wall: { display: string; name: string | null } | null;
  /**
   * The screens the Wall mode sheet offers (L-06, MAP-UI-06 "SHOW ON"), in the system's order: "Display 1" and what it
   * is — "Built-in · this window", or the screen's own name ("LG UltraFine 27″"). Optional for an older main process.
   */
  displays?: WallDisplay[];
  /** The sheet's choices as last saved (MAP-24): the screen, keep awake, cycle the map, open when WorkSuite starts. */
  wallPrefs?: WallModePrefs;
  /** Wall mode is up on a screen now: the tray's item closes it (MAP-24 "Esc or the tray menu closes it"). */
  wallOpen?: boolean;
  /** When the wall's screen was unplugged and its window closed (MAP-24 "the tray says so"); null once opened again. */
  wallGone?: string | null;
  /** "Silence for 15 minutes" from the tray: until this ISO time; null when not silenced. */
  silencedUntil: string | null;
  /** ⌘⇧M and ⌘⇧D answer from other apps (registered while WorkSuite is not in front). */
  shortcuts: boolean;
}

/**
 * How a ring ended, as the call window tells it (R-03, RING-UI-03; RING-02, RING-03, RING-28). `text` is the whole
 * thing in plain words (the tray, a screen reader, an older window); `kind` and the rest are what the card draws:
 *
 * - `joined`: a colleague (`by`) joined the chat with `visitor` — a toast with View;
 * - `late`: I pressed Join a moment late — `by` already has it;
 * - `visitor_left`: the visitor left the site before anyone joined — in Missed chats when `missed`, with the `email`
 *   they left, Open in Missed and Dismiss;
 * - `visitor_ended`: the visitor ended the chat;
 * - `note`: anything else (closed, blocked, a pass, a call or an invitation resolving, an error).
 */
export interface WebchatRingOutcome {
  id: number;
  text: string;
  at: number;
  kind?: 'joined' | 'late' | 'visitor_left' | 'visitor_ended' | 'note';
  visitor?: string | null;
  by?: string | null;
  email?: string | null;
  missed?: boolean;
  /**
   * What I had typed to the visitor when a colleague got there first (R-05, UX-ALR-04): kept, never sent unless I
   * choose "Send to the chat" — then it goes as a participant's reply (TEAM-02). Absent behind the lock.
   */
  draft?: string | null;
}

/** A chat joined from the ringing card, shown there as a mini chat (worksuite-desktop#225). */
export interface WebchatJoined {
  conversationId: number;
  visitor: string;
  site: string | null;
  place: string | null;
  device: string | null;
  page: string | null;
  /** What the visitor wrote, as the card showed it. */
  preview: string | null;
  since: string;
  /** What I have sent from the card, oldest first. */
  sent: string[];
}
