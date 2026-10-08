import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { ApiError, apiGet, request } from '../../../core/api';
import { useLocalFirstQuery } from '../../../core/local-first-query';
import { call, errorMessage, on } from '../../../core/bridge';
import { app } from '../../../core/app-state';
import { createStore, useStore } from '../../../core/store';
import { toast } from '../../../core/toasts';
import { text } from '../../../core/i18n';
import { markdownLine } from '../../../core/markdown';
import { parseTs } from '../../../core/time';
import { mergeBySeq, newClientId } from '@shared/chat-seq';
import { websiteReplyMutation } from '@shared/website-reply';
import type { SubmitResult } from '@shared/ipc/contract';
import type { SavedReply } from './profile';
import { recordTiming, timed, type ServerTiming } from './timings';

const recordTimingOf = (what: string, ms: number, server: ServerTiming | null) => recordTiming({ what, at: new Date().toISOString(), ms: Math.round(ms), rows: 1, server, ok: true });

/**
 * Website chat (UI-08: "group, direct and website-chat conversations") — the
 * staff side of WorkSuite's visitor widget, served by
 * `/api/chat/widget-admin/*`.
 *
 * There is no realtime event for an agent's reply or for a visitor typing, so
 * an open thread is polled, as the web does; new visitor messages, incoming
 * chats and hand-overs arrive as `chat.widget.message`, `chat.incoming`,
 * `chat.taken` and `chat.assigned`, which refresh these queries early.
 * Stamps are true UTC without a zone.
 */
export const WEBSITE = '/api/chat/widget-admin';

export interface WebsiteRow {
  id: number;
  widget: string | null;
  widget_id: number;
  site: string | null;
  online: boolean;
  inactive: boolean;
  label: string;
  visitor_name: string | null;
  email: string | null;
  /** Their company, for "Anne · Acme Ltd" on the Closed list (C-06); absent on an older server. */
  company?: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  current_url: string | null;
  last_seen: string | null;
  status: string;
  is_offline: boolean;
  priority: string;
  updated_at: string;
  agent: string | null;
  assigned_to: number | null;
  started_at: string | null;
  last_visitor_at: string | null;
  waiting_since: string | null;
  at_risk: boolean;
  awaiting_reply: boolean;
  rating: number | null;
  /**
   * How a closed chat ended (C-06, IDL-03), for the Closed list's row: when, why — `agent`, `visitor` or `idle`; null on
   * a chat closed before the reason was kept — who closed it, and its subject. Absent on an older server.
   */
  closed_at?: string | null;
  closed_reason?: ClosedReason | null;
  closed_by?: string | null;
  subject?: string | null;
  is_starred: boolean;
  tags: string[] | null;
  /** What was said last, notices aside (CHAT-UI-00): the row's preview. */
  last_message?: (Omit<WebsiteQuote, 'file'> & { file: string | null; at: string }) | null;
  /** What the visitor has written since staff last answered. */
  unread?: number;
  /** Who is in the chat, the owner first (ENH-WCHAT-03, TEAM-04); observers are not listed. */
  team?: Array<Pick<WebsitePerson, 'user_id' | 'name' | 'avatar' | 'role'>>;
  /** What I am in this chat, if anything (TEAM-09). */
  my_role?: TeamRole | null;
  /** A voice call on in this chat now (ENH-WCHAT-05, VOICE-UI-02): "On a call · 02:14". */
  call?: { status: 'ringing' | 'active' | 'on_hold'; since: string | null } | null;
  /** The callback still to do in this chat (worksuite-desktop#223): "Callback requested" on the row. */
  callback?: { id: number; reference: string | null; status: string; due_at: string | null; overdue: boolean } | null;
  /** When the wait clock turns amber and red, in seconds; null where the site offers no callbacks (#223). */
  wait_amber?: number | null;
  wait_red?: number | null;
  /** The visitor wrote again after the team answered and is still waiting (worksuite-desktop#230); then `waiting_since` is this. */
  reply_waiting_since?: string | null;
  /** How far that has gone: a reminder sent, the team alerted, or the chat reassigned. */
  reply_stage?: 'reminded' | 'team' | 'reassigned' | null;
  /** Returning visitors (#222): the visitor's profile, which visit this is ("Returning · 3rd visit"), how we know them. */
  visitor_id?: number;
  visits?: number;
  identity?: 'signed' | 'verified' | 'returning' | 'new';
  /** When the team last wrote: a reopened chat answered since is no longer one nobody has picked up (#291). */
  last_agent_at?: string | null;
  /**
   * The visitor came back and wrote in this chat after it closed, and it reopened then (worksuite-desktop#291); null
   * or absent when it never closed, and on a server without it.
   */
  reopened_at?: string | null;
  /** The chat before this one on the visitor's profile, when this is a new chat after the reopen window (#291). */
  previous_conversation_id?: number | null;
}

/**
 * A returning visitor's chat that reopened (worksuite-desktop#291) and that nobody has answered since: it needs somebody
 * as a new chat does. Never on a server that does not say when a chat reopened.
 */
export function reopenedWaiting(r: Pick<WebsiteRow, 'reopened_at' | 'awaiting_reply' | 'status' | 'last_agent_at'>): boolean {
  if (!r.reopened_at || !r.awaiting_reply || r.status === 'closed') return false;
  return !r.last_agent_at || parseTs(r.last_agent_at).getTime() < parseTs(r.reopened_at).getTime();
}

/**
 * A visitor who wrote again in one of my chats and waits (worksuite-desktop#230), and a returning visitor whose closed
 * chat reopened and is not answered yet (#291), go to the top of the list, the longest waiting first; the rest keep
 * their order.
 */
export function followUpsFirst(rows: WebsiteRow[], mine: (r: WebsiteRow) => boolean): WebsiteRow[] {
  const since = (r: WebsiteRow): string | null => (r.reply_waiting_since && r.awaiting_reply && mine(r) ? r.reply_waiting_since : reopenedWaiting(r) ? r.reopened_at! : null);
  const at = (r: WebsiteRow) => parseTs(since(r)!).getTime() || 0;
  const top = rows.filter((r) => since(r) !== null).sort((a, b) => at(a) - at(b));
  return top.length ? [...top, ...rows.filter((r) => since(r) === null)] : rows;
}

/** The wait clock's colour (#223): amber at the callback threshold, red after it; red throughout where there is none. */
export function waitTone(seconds: number, amber: number | null | undefined, red: number | null | undefined): 'plain' | 'amber' | 'red' {
  if (!amber && !red) return 'red';
  if (red && seconds >= red) return 'red';
  if (amber && seconds >= amber) return 'amber';
  return 'plain';
}

/**
 * Marks that only move forward (LIVE-05): how far the visitor has the team's messages, and each person the visitor's.
 * By message id, and (DLV-08, a server from Phase 2) the same marks as seqs.
 */
export interface WebsiteMarks {
  visitor: { delivered: number | null; read: number | null; delivered_at: string | null; read_at: string | null; delivered_seq?: number | null; read_seq?: number | null };
  staff: Array<{ user_id: number; name: string; delivered: number | null; read: number | null; read_at: string | null; delivered_seq?: number | null; read_seq?: number | null }>;
}

/** A message by id, or by its seq where both it and the mark have one (DLV-08). */
type Marked = number | { id: number; seq?: number | null };

function reached(m: Marked, id: number | null | undefined, seq: number | null | undefined): boolean {
  const mine = typeof m === 'number' ? { id: m, seq: null } : m;
  if (typeof mine.seq === 'number' && mine.seq > 0 && typeof seq === 'number' && seq > 0) return seq >= mine.seq;
  return !!id && id >= mine.id;
}

/**
 * A team message's state for the visitor (LIVE-08): sent, delivered to their widget, or read with its panel open. Only
 * the visitor's own acknowledgement moves it (DLV-08): never on send.
 */
export function visitorHas(m: Marked, marks: WebsiteMarks | null | undefined): 'sent' | 'delivered' | 'read' {
  const v = marks?.visitor;
  if (!v) return 'sent';
  if (reached(m, v.read, v.read_seq)) return 'read';
  if (reached(m, v.delivered, v.delivered_seq)) return 'delivered';
  return 'sent';
}

/** Who of the team has read the visitor's message (LIVE-08): "you" first. */
export function readBy(m: Marked, marks: WebsiteMarks | null | undefined, me: number | null): string[] {
  const who = (marks?.staff ?? []).filter((s) => reached(m, s.read, s.read_seq));
  return [...who.filter((s) => s.user_id === me).map(() => 'you'), ...who.filter((s) => s.user_id !== me).map((s) => s.name)];
}

/**
 * A `chat.widget.delivered` / `read` event (DLV-08) over the marks a thread holds: the visitor's acknowledgement moves
 * the ticks now, without asking for the thread again. Null when it cannot be applied (no marks yet, a colleague's
 * mark, an older server's event without ids): the caller refetches.
 */
export function marksWith(marks: WebsiteMarks | null | undefined, e: { type: string; by?: string; message_id?: number; seq?: number | null; at?: string }): WebsiteMarks | null {
  if (!marks || e.by !== 'visitor' || typeof e.message_id !== 'number') return null;
  const kind = e.type === 'chat.widget.read' ? 'read' : e.type === 'chat.widget.delivered' ? 'delivered' : null;
  if (!kind) return null;
  const v = { ...marks.visitor };
  const up = (a: number | null | undefined, b: number | null | undefined) => (typeof b === 'number' && b > 0 ? Math.max(a ?? 0, b) : (a ?? null));
  // Read is delivered too.
  for (const k of kind === 'read' ? (['read', 'delivered'] as const) : (['delivered'] as const)) {
    const sk = k === 'read' ? 'read_seq' : 'delivered_seq';
    v[k] = up(v[k], e.message_id);
    v[sk] = up(v[sk], e.seq);
  }
  if (kind === 'read' && e.at) v.read_at = e.at;
  if (e.at && !v.delivered_at) v.delivered_at = e.at;
  return { ...marks, visitor: v };
}

/** "Nimal is typing", "Nimal and Dilini are typing". */
export function typingWords(names: string[]): string {
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are typing…`;
}

/** A role in one website chat (TEAM-01): who answers for it, who is helping, who is reading along unseen. */
export type TeamRole = 'owner' | 'participant' | 'observer';

export interface WebsitePerson {
  user_id: number;
  name: string;
  avatar: string | null;
  role: TeamRole;
  invited_by?: number | null;
  invited_by_name?: string | null;
  joined_at?: string | null;
  /** At their desk or not, as Team Chat says it (C-08, UX-DRW-03); absent from an older server. */
  presence?: 'online' | 'busy' | 'dnd' | 'away' | 'offline';
}

/** An invitation or transfer still waiting for an answer, in its chat's "In this chat" panel. */
export interface WebsitePending {
  id: number;
  kind: 'invite' | 'transfer';
  mode: 'warm' | 'cold';
  from: number | null;
  from_name: string | null;
  to: string;
  to_users: number[];
  note: string | null;
  expires_at: string | null;
  /** Seconds left by the server's clock when it answered (C-08): the panel's countdown, true on a skewed computer. */
  expires_in?: number | null;
  created_at: string | null;
}

/** Several staff in one chat (TEAM-UI-01): who is in it, what is pending, and what I may do. */
export interface WebsiteTeam {
  people: WebsitePerson[];
  pending: WebsitePending[];
  my_role: TeamRole | null;
  max: number;
  transfer_count: number;
  can: { invite: boolean; transfer: boolean; leave: boolean; remove: boolean; note: boolean; monitor: boolean; join: boolean; take_over: boolean };
}

/** A colleague for the invite and transfer pickers (TEAM-20, TEAM-21). */
export interface Colleague {
  id: number;
  name: string;
  email: string | null;
  status?: 'available' | 'busy' | 'away' | 'offline';
  open_chats?: number;
  department_id?: number | null;
  department?: string | null;
  /** Staffs this chat's website; somebody who does not can still be asked, and is marked. */
  on_staff?: boolean;
  in_chat?: TeamRole | null;
}

/** Whether I own or take part in a chat: Mine (TEAM-09). */
export function isMine(r: Pick<WebsiteRow, 'assigned_to' | 'my_role'>, me: number | null): boolean {
  return me !== null && (r.assigned_to === me || r.my_role === 'owner' || r.my_role === 'participant');
}

/** A file's name that says it is a picture. */
const PICTURE = /\.(?:jpe?g|png|gif|webp|heic|heif|bmp|avif|svg)$/i;

/** A file on a row (worksuite-desktop#261): "📷 Photo" for a picture, "📎 File: invoice.pdf" for anything else. */
export function fileLine(name: string): string {
  return PICTURE.test(name.trim()) ? `📷 ${text('Photo')}` : `📎 ${text('File: {name}', { name })}`;
}

/** "★★★★☆ Rated 4": the visitor's rating, on a row whose chat has nothing later to show (#261). */
export function ratedLine(n: number): string {
  const r = Math.max(0, Math.min(5, Math.round(n)));
  return `${'★'.repeat(r)}${'☆'.repeat(5 - r)} ${text('Rated {n}', { n: r })}`;
}

/**
 * A row's preview: who said it last, unless it was the visitor, then the words — plain and on one line, never
 * Markdown's marks (worksuite-desktop#261) — or what was sent instead: "📷 Photo", "📎 File: invoice.pdf". Empty only
 * when the message has neither words nor a file: the row then says what happened (rowPreview).
 */
export function lastSaid(m: NonNullable<WebsiteRow['last_message']>, myName: string | null): string {
  const what = markdownLine(m.body ?? '') || (m.file ? fileLine(m.file) : '');
  if (!what) return '';
  const who = m.from === 'visitor' ? null : m.from === 'bot' ? text('Bot') : m.agent && m.agent === myName ? text('You') : (m.agent ?? text('Agent'));
  return who ? `${who}: ${what}` : what;
}

export interface WebsiteCan {
  view: boolean;
  reply: boolean;
  manage: boolean;
}

export interface WebsiteMessage {
  id: number;
  body: string | null;
  from: 'visitor' | 'agent' | 'bot' | 'system';
  agent: string | null;
  at: string;
  /**
   * The file (#229): `name` is the readable one (the original, or "Photo – 4 Oct 2026, 11:31.jpg"); `thumb_url` and
   * `preview_url` are small copies the server made — an iPhone photo too — and `url` the original to download.
   */
  file: { url: string; filename: string; mime: string; size: number; is_image: boolean; id?: number; name?: string; thumb_url?: string | null; preview_url?: string | null; width?: number | null; height?: number | null; kind?: string } | null;
  /** Deleted for the visitor too (#229): no words, no file. */
  deleted?: boolean;
  /** Who wrote it, and their photo (TEAM-05). */
  agent_id?: number | null;
  avatar?: string | null;
  /** `internal`: a note only staff see, never sent to the visitor (TEAM-60). */
  visibility?: 'public' | 'internal';
  /** The message this one answers (RDC-10): an excerpt both the agent and the visitor see above it. */
  reply_to?: number | null;
  reply?: WebsiteQuote | null;
  /** Its place in the conversation (DLV-05): the thread is drawn in this order. Absent from an older server. */
  /** Its reactions, staff's and the visitor's (server Communication 1.60.0; absent before). */
  reactions?: Array<{ emoji: string; count: number; mine: boolean; names?: string[] }>;
  seq?: number | null;
  /** The id the sending device gave it (DLV-01): my reply on its way gives way to the copy carrying this. */
  client_id?: string | null;
}

/**
 * One thing the visitor did on the site (`chat_widget_events`, WidgetAdminController::timeline): a page they opened,
 * how long it held them (`seconds`, null for the page they are on or a gap too long to be reading), and whether it
 * opened a new visit.
 */
export interface WebsiteEvent {
  id?: number;
  kind: 'page_view' | (string & {});
  url: string | null;
  title: string | null;
  at: string;
  seconds: number | null;
  new_visit: boolean;
}

/** A quoted message: its first words, who wrote it, and its file's name. */
export interface WebsiteQuote {
  id: number;
  body: string | null;
  from: 'visitor' | 'agent' | 'bot';
  agent: string | null;
  file: string | null;
}

/** Who wrote a message, as a quote or a preview says it. */
export function quoteAuthor(q: Pick<WebsiteQuote, 'from' | 'agent'>, visitor: string): string {
  return q.from === 'visitor' ? visitor : q.from === 'bot' ? 'Automated message' : (q.agent ?? 'Agent');
}

export interface WebsiteVisitor {
  id: number;
  label: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  language: string | null;
  timezone: string | null;
  country: string | null;
  city: string | null;
  landing_page: string | null;
  current_url: string | null;
  current_title: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  visits: number | null;
  first_seen: string | null;
  last_seen: string | null;
  is_blocked: boolean;
}

/** Why a chat closed (IDL-03): an agent finished it, the visitor ended it, or it went quiet and closed itself. */
export type ClosedReason = 'agent' | 'visitor' | 'idle';

/** A contact details form sent into a website chat (`ContactForm::forStaff`). */
export interface ContactFormState {
  asked_at: string;
  asked_by: string | null;
  fields: Array<'name' | 'email' | 'phone' | 'company'>;
  open: boolean;
  done_at: string | null;
  outcome: 'shared' | 'skipped' | 'withdrawn' | null;
}

export interface WebsiteConversation {
  conversation: {
    id: number;
    widget: string | null;
    website: string | null;
    status: string;
    is_offline: boolean;
    inactive: boolean;
    assigned_to: number | null;
    visitor_typing: boolean;
    started_at: string | null;
    closed_at: string | null;
    rating: number | null;
    rating_comment: string | null;
    /** Why it closed and who closed it (C-06, IDL-03); absent on an older server. */
    closed_reason?: ClosedReason | null;
    closed_by?: { id: number; name: string; avatar?: string | null } | null;
    /** When the team first answered: the closed summary's First reply tile (UX-CLS-02). */
    first_response_at?: string | null;
    subject?: string | null;
    /** The server stores them as one comma-separated line; a list from a newer one is read the same (see `tagList`). */
    tags: string[] | string | null;
    is_starred: boolean;
    priority?: string;
    /** The largest file this website's visitors may be sent (RDC-04); absent on an older server, which means 5 MB. */
    max_upload_kb?: number;
    /** Its widget: the composer offers the saved replies for every widget and this one's (CAN-01, S-09); absent on an older server. */
    widget_id?: number;
    /** When the visitor came back and it reopened (worksuite-desktop#291); null or absent otherwise. */
    reopened_at?: string | null;
    /** The visitor's chat before this one, when this is a new chat after the reopen window (#291). */
    previous_conversation_id?: number | null;
  };
  /** The contact details form sent to the visitor, and how it ended (server Communication 1.58.0; absent before). */
  contact_form?: ContactFormState | null;
  visitor: WebsiteVisitor | null;
  messages: WebsiteMessage[];
  journey?: Array<{ url: string | null; title: string | null; at: string }>;
  /** The visitor's timeline, oldest first, with dwell times and visit breaks (C-02 ActivityEvent; #229); absent on an older server. */
  events?: WebsiteEvent[];
  history?: Array<{ id: number; status: string; started_at: string | null; rating: number | null; other_device: boolean }>;
  /** How many chats this customer has had here, this one included, and when the first began (C-06: "2nd chat · first on 12 Sep"). */
  chats?: { count: number; first_at: string | null };
  /** Null or absent on a server without team chats. */
  team?: WebsiteTeam | null;
  /** Delivered and read, both ways (ENH-WCHAT-04, LIVE-08); null on a server without them. */
  marks?: WebsiteMarks | null;
  /** Who else of the team is typing here now. */
  agents_typing?: string[];
  /** The latest voice call in this chat (ENH-WCHAT-05); null when there has been none, absent on a server without calls. */
  call?: WebsiteCall | null;
  /** Whether I take website voice calls here: answer, join, hold, offer. */
  can_call?: boolean;
  /** The callback the visitor asked for (worksuite-desktop#223): one still to do, else the last; absent on an older server. */
  callback?: WebsiteCallback | null;
  /** The WhatsApp chats this visitor continued on, matched by their reference (#224). */
  whatsapp?: Array<{ account: string; chat_id: number; ref: string; linked_at: string | null; link: string }>;
  can?: WebsiteCan;
  /**
   * The shared kit's message actions (P-04, RDC-12): minutes Delete for the visitor is offered (0: no limit), and whether
   * Save to Drive has a Drive to save into. Absent on an older server: 15 minutes, and no Save to Drive.
   */
  delete_window_minutes?: number;
  can_save_to_drive?: boolean;
  /** Returning visitors (#222): the profile behind this chat; absent or null on a server without them. */
  profile?: { visitor_id: number; identity: 'signed' | 'verified' | 'returning' | 'new'; visits: number; suggestions: number } | null;
  /** The conversation's highest seq, counting what I cannot see (DLV-05); absent from an older server. */
  last_seq?: number | null;
}

/** A voice call in a website chat as the thread has it (WidgetCalls::forThread). */
export interface WebsiteCall {
  call_id: number;
  conversation_id: number;
  status: 'ringing' | 'active' | 'on_hold' | 'ended' | 'missed' | 'cancelled' | 'declined' | 'dropped';
  call_stage?: 'first' | 'everyone' | null;
  requested_at: string | null;
  answered_at: string | null;
  answered_by: number | null;
  answered_by_name: string | null;
  duration: number | null;
  visitor?: string | null;
  /** I am in the call's room, as the server has it. */
  on_call: boolean;
  /** It rings for me now. */
  rings_me: boolean;
  /** Who of the team is on it. */
  on: Array<{ user_id: number; name: string }>;
  /** Recorded (VOICE-22): the in-call bar's "Recording", else "not recorded" (V-03). Absent on an older server. */
  recorded?: boolean;
  /** My call notes so far, kept by the server while the call is on (V-03); absent on an older server. */
  my_notes?: string;
}

/** Whether a call is ringing or on. */
export const callLive = (c: Pick<WebsiteCall, 'status'> | null | undefined): boolean => !!c && (c.status === 'ringing' || c.status === 'active' || c.status === 'on_hold');

/**
 * A visitor waiting to be contacted (VOICE-16; worksuite-desktop#223). The fields after `created_at` come from a
 * server with structured callbacks: a reference, how and when, a due time, and what has been done.
 */
export interface WebsiteCallback {
  id: number;
  conversation_id: number;
  phone: string | null;
  best_time: string | null;
  visitor: string;
  site: string | null;
  /** Asked for after a call nobody answered. */
  missed_call: boolean;
  created_at: string;
  reference?: string | null;
  name?: string | null;
  email?: string | null;
  channel?: 'call' | 'whatsapp' | 'email';
  /** "by phone", "on WhatsApp", "by email". */
  how?: string;
  message?: string | null;
  due_at?: string | null;
  overdue?: boolean;
  status?: 'open' | 'unreachable' | 'contacted' | 'done';
  outcome?: string | null;
  attempts?: number;
  retry_at?: string | null;
  waited_seconds?: number | null;
  assignee?: string | null;
  contacted_at?: string | null;
  handled_at?: string | null;
  /** Where they asked: queue, home, away, call (a missed voice call). */
  source?: string | null;
  assigned_to?: number | null;
  /** The staff note Mark done… (V-02) or an action left on it. */
  note?: string | null;
  /** Who handled it, by name. */
  handled_by?: string | null;
  /** The Call-backs card (V-02): "Malini Perera · Lanka Traders". */
  company?: string | null;
  /** The page they called from, else the one they are on: "· techubiz.com/shop/coreldraw" (V-02). */
  page_url?: string | null;
  /** Asked for while the business hours were closed: "(outside hours)" (V-02). */
  outside_hours?: boolean;
  /** Call back logged an attempt whose outcome is still to be said (V-02, UX-CALL-04). */
  called_at?: string | null;
}

export type CallbackOutcome = 'answered' | 'no_answer' | 'wrong_number';

/** Mark done…'s answers on Voice calls › Call-backs (V-02, UX-CALL-03); `keep_open` is No answer — keep it open. */
export type CallbackDoneOutcome = 'sorted' | 'follow_up' | 'keep_open' | 'wrong_number';

export function useCallbacks(enabled: boolean) {
  return useQuery({
    queryKey: ['website', 'callbacks'],
    queryFn: ({ signal }) => apiGet<{ callbacks: WebsiteCallback[] }>(`${WEBSITE}/callbacks`, undefined, signal).then((d) => d.callbacks ?? []),
    enabled,
    staleTime: 15_000,
    // An older server has no call backs: nothing to list.
    retry: false,
  });
}

/** A website chat's priority, as the server keeps it (IncomingChats::PRIORITIES). */
export type WebsitePriority = 'low' | 'normal' | 'high' | 'urgent' | 'vip';

export const PRIORITIES: Array<{ id: WebsitePriority; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'vip', label: 'VIP' },
];

/** The workspace's sections (WebChatInbox, left). */
export type Section = 'inbox' | 'live' | 'offline' | 'missed' | 'callbacks' | 'mine' | 'invited' | 'unassigned' | 'awaiting' | 'starred' | 'closed';

/** Which open rows a section shows. */
export function sectionRows(rows: WebsiteRow[], section: Section, me: number | null): WebsiteRow[] {
  switch (section) {
    case 'live':
      // An offline enquiry whose visitor came back and wrote while staff are online is live again (C-05, MIS-02): the
      // server opens it (`pending` → `open`) and it rings once; it stays under Offline enquiries too.
      return rows.filter((r) => r.online && (!r.is_offline || r.status === 'open'));
    case 'offline':
      return rows.filter((r) => r.is_offline);
    case 'mine':
      return rows.filter((r) => isMine(r, me));
    case 'unassigned':
      return rows.filter((r) => r.assigned_to === null);
    case 'awaiting':
      return rows.filter((r) => r.awaiting_reply);
    case 'starred':
      return rows.filter((r) => r.is_starred);
    default:
      return rows;
  }
}

export type WebsiteFilter = 'waiting' | 'mine' | 'open' | 'closed';

export const WEBSITE_FILTERS: Array<{ id: WebsiteFilter; label: string }> = [
  { id: 'waiting', label: 'Waiting' },
  { id: 'mine', label: 'Mine' },
  { id: 'open', label: 'All open' },
  { id: 'closed', label: 'Closed' },
];

/** The rows a filter shows, from the open list (or the closed one). */
export function filterRows(rows: WebsiteRow[], filter: WebsiteFilter, me: number | null): WebsiteRow[] {
  if (filter === 'waiting') return rows.filter((r) => r.awaiting_reply);
  if (filter === 'mine') return rows.filter((r) => isMine(r, me));
  return rows;
}

/** Oldest waiting first while waiting matters; most recent first otherwise. */
export function sortRows(rows: WebsiteRow[], filter: WebsiteFilter): WebsiteRow[] {
  const key = (r: WebsiteRow) => (filter === 'waiting' ? (r.waiting_since ?? r.last_visitor_at ?? r.started_at ?? '') : r.updated_at);
  return [...rows].sort((a, b) => (filter === 'waiting' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))));
}

/** How the list views order their rows (UX-LIST-01): longest waiting first unless asked otherwise. */
export type WebsiteSort = 'waiting' | 'recent' | 'name';

export const WEBSITE_SORTS: Array<{ id: WebsiteSort; label: string }> = [
  { id: 'waiting', label: 'Longest waiting first' },
  { id: 'recent', label: 'Newest activity' },
  { id: 'name', label: 'Visitor name' },
];

/**
 * The list views' order (UX-LIST-01). Longest waiting first: visitors waiting for a reply first, the longest wait at
 * the top, then the rest by their latest activity. Newest activity: what was said or done last, newest first.
 * Visitor name: A to Z.
 */
export function sortWebsiteRows(rows: WebsiteRow[], sort: WebsiteSort): WebsiteRow[] {
  const stamp = (v: string | null | undefined) => {
    const t = v ? parseTs(v).getTime() : Number.NaN;
    return Number.isNaN(t) ? 0 : t;
  };
  const activity = (r: WebsiteRow) => stamp(r.last_message?.at ?? r.last_visitor_at ?? r.updated_at);
  const name = (r: WebsiteRow) => (r.visitor_name || r.label || '').toLowerCase();
  if (sort === 'name') return [...rows].sort((a, b) => name(a).localeCompare(name(b)) || a.id - b.id);
  if (sort === 'recent') return [...rows].sort((a, b) => activity(b) - activity(a) || b.id - a.id);
  const waits = (r: WebsiteRow) => r.awaiting_reply && r.status !== 'closed';
  return [...rows].sort((a, b) => {
    if (waits(a) !== waits(b)) return waits(a) ? -1 : 1;
    if (waits(a)) return (stamp(waitingSince(a)) || Infinity) - (stamp(waitingSince(b)) || Infinity) || a.id - b.id;
    return activity(b) - activity(a) || b.id - a.id;
  });
}

/** The pills over the workspace's list (CHAT-UI-00): Open, Mine and Closed. */
export type ListPill = 'open' | 'mine' | 'closed';

/** When a visitor started waiting: the ring's own stamp, else their last message. */
export function waitingSince(r: Pick<WebsiteRow, 'waiting_since' | 'last_visitor_at'>): string | null {
  return r.waiting_since ?? r.last_visitor_at ?? null;
}

/**
 * Waiting for a reply in a live chat: not an offline enquiry still in its queue, which waits for an answer by email
 * under Offline enquiries — counted there — and once made "1 visitor is waiting… waited 20 days" here (#252).
 */
export const waitsLive = (r: WebsiteRow): boolean => r.awaiting_reply && !(r.is_offline && r.status === 'pending');

/** The visitor who has waited longest for a reply, the one "Open the longest waiting" opens. */
export function longestWaiting(rows: WebsiteRow[]): WebsiteRow | null {
  let best: WebsiteRow | null = null;
  let bestAt = Number.NaN;
  for (const r of rows) {
    if (!waitsLive(r)) continue;
    const since = waitingSince(r);
    const at = since ? parseTs(since).getTime() : Number.NaN;
    // A row without a stamp still counts, but any stamped one has waited longer as far as anybody can tell.
    if (best === null || (!Number.isNaN(at) && (Number.isNaN(bestAt) || at < bestAt))) {
      best = r;
      bestAt = at;
    }
  }
  return best;
}

function minutesText(m: number): string {
  if (m < 60) return m === 1 ? text('1 minute') : text('{n} minutes', { n: m });
  if (m >= 1440) {
    const d = Math.floor(m / 1440);
    return d === 1 ? text('1 day') : text('{n} days', { n: d });
  }
  const h = Math.floor(m / 60);
  const hours = h === 1 ? text('1 hour') : text('{n} hours', { n: h });
  const rest = m % 60;
  return rest ? `${hours} ${rest === 1 ? text('1 minute') : text('{n} minutes', { n: rest })}` : hours;
}

/** The "Pick a conversation" line (CHAT-UI-00): how many are waiting, and for how long the longest has. */
export function waitingSummary(rows: WebsiteRow[], now: number): string {
  const n = rows.filter(waitsLive).length;
  if (!n) return text('Nobody is waiting for a reply.');
  const head = n === 1 ? text('1 visitor is waiting for a reply.') : text('{n} visitors are waiting for a reply.', { n });
  const since = waitingSince(longestWaiting(rows) ?? { waiting_since: null, last_visitor_at: null });
  const at = since ? parseTs(since).getTime() : Number.NaN;
  if (Number.isNaN(at)) return head;
  const waited = minutesText(Math.max(1, Math.floor((now - at) / 60_000)));
  return `${head} ${n === 1 ? text('They have waited {time}.', { time: waited }) : text('The longest has waited {time}.', { time: waited })}`;
}

/**
 * J and K move through the list (CHAT-UI-00): the next or the previous conversation, stopping at either end. With
 * nothing open, either key opens the first.
 */
export function stepRow(ids: number[], current: number | null, step: 1 | -1): number | null {
  if (!ids.length) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return ids[0]!;
  return ids[Math.min(ids.length - 1, Math.max(0, at + step))]!;
}

/** A page of a website list as the server answers it; paging and `timing` from a server with #252. */
export interface WebsiteListPage {
  conversations: WebsiteRow[];
  can: WebsiteCan;
  sites?: Array<{ widget_id: number; site: string; widget?: string | null }>;
  has_more?: boolean;
  next_cursor?: string | null;
  timing?: ServerTiming;
}

/** A saved copy is a list only when it has one: anything else waits for the server. */
export const isWebsiteList = (hit: unknown): boolean => !!hit && typeof hit === 'object' && Array.isArray((hit as { conversations?: unknown }).conversations);

const deniedOrGone = (e: unknown): boolean => e instanceof ApiError && (e.forbidden || e.status === 404);

/**
 * This computer's saved copy of a GET (the main process keeps the website lists' answers, #239, #252), shown while the
 * first answer is on its way, so a list opens at once with what it showed last. Never over a live answer or an error,
 * and stamped 0, so the server is still asked at once. `wrap` shapes it for the query (a first page, for paging).
 */
export function useSavedCopy(key: QueryKey, path: string, params: Record<string, string> | undefined, accept: (hit: unknown) => boolean, enabled: boolean, wrap: (hit: unknown) => unknown = (hit) => hit): void {
  const qc = useQueryClient();
  const keyJson = JSON.stringify(key);
  const paramsJson = JSON.stringify(params ?? null);
  useEffect(() => {
    const k = JSON.parse(keyJson) as QueryKey;
    if (!enabled || qc.getQueryData(k) !== undefined) return;
    const controller = new AbortController();
    const query = JSON.parse(paramsJson) as Record<string, string> | null;
    void Promise.resolve()
      .then(() => request<unknown>('GET', path, { query: query ?? undefined, signal: controller.signal, headers: { 'X-WS-Local-Read': '1' } }))
      .then((hit) => {
        const state = qc.getQueryState(k);
        if (!controller.signal.aborted && hit && accept(hit.data) && (!state || (state.data === undefined && state.error === null))) qc.setQueryData(k, wrap(hit.data), { updatedAt: 0 });
      })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `accept` and `wrap` are shape helpers, read when the copy arrives
  }, [qc, keyJson, path, paramsJson, enabled]);
}

/**
 * The open conversations: every section's rows and counts are drawn from this one list, so it is read whole (the
 * server keeps it to the ongoing chats). From the copy saved here at once, then from the server every 15 s, and at once
 * on a realtime event; a new answer keeps the rows that did not change, so the list updates in place.
 */
export function useWebsiteInbox(closed: boolean, enabled = true) {
  useSavedCopy(['website', 'inbox', closed ? 'closed' : 'open'], `${WEBSITE}/conversations`, closed ? { status: 'closed' } : undefined, isWebsiteList, enabled);
  return useQuery({
    queryKey: ['website', 'inbox', closed ? 'closed' : 'open'],
    queryFn: ({ signal }) => timed('conversations', () => apiGet<WebsiteListPage>(`${WEBSITE}/conversations`, closed ? { status: 'closed' } : undefined, signal), (d) => d?.conversations?.length ?? null),
    enabled,
    // Somebody who does not staff website chat is told once, not every 15 s.
    refetchInterval: (query) => (deniedOrGone(query.state.error) ? false : 15_000),
    retry: (n, e) => !deniedOrGone(e) && n < 2,
  });
}

/** A realtime event about a website chat, as far as the lists read it. */
interface ListEvent {
  type: string;
  conversation_id?: unknown;
  from?: unknown;
  preview?: unknown;
  message_id?: unknown;
  at?: unknown;
  returning?: unknown;
  [k: string]: unknown;
}

/** Now as the server writes a stamp: true UTC, no zone. */
const serverNow = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** The rows a cached list holds: a list, or the Closed list's pages. */
function cachedRows(data: unknown): WebsiteRow[] {
  const d = data as { conversations?: WebsiteRow[]; pages?: Array<{ conversations?: WebsiteRow[] } | null> } | undefined;
  if (Array.isArray(d?.conversations)) return d.conversations;
  return Array.isArray(d?.pages) ? d.pages.flatMap((p) => p?.conversations ?? []) : [];
}

/**
 * A returning visitor writes in a closed chat and it reopens (worksuite-desktop#291): the lists say so now, not at
 * their next read. The row leaves Closed and goes to the top of the open list — open, waiting on us, with the visitor's
 * new words — so it is in Inbox and Awaiting reply and on the badge at once; the read the same event asks for then
 * brings the server's own row. What moves it, for a chat this computer holds as closed: a visitor's message
 * (`chat.widget.message`), a ring (`chat.incoming`), or a returning visitor's chat given to somebody (`chat.assigned`
 * with `returning`). True when a list changed. A chat no list holds as closed is left to the read, a new one too.
 */
export function reopenInLists(qc: QueryClient, e: ListEvent): boolean {
  const reopens = e.type === 'chat.incoming' || (e.type === 'chat.widget.message' && e.from !== 'agent' && e.from !== 'bot') || (e.type === 'chat.assigned' && !!e.returning && typeof e.returning === 'object');
  const id = Number(e.conversation_id);
  if (!reopens || !Number.isSafeInteger(id) || id <= 0) return false;
  const lists = qc.getQueriesData<unknown>({ queryKey: ['website', 'inbox'] });
  const was = lists.flatMap(([, data]) => cachedRows(data)).find((r) => r.id === id && r.status === 'closed');
  if (!was) return false;
  const at = typeof e.at === 'string' && e.at.trim() ? e.at : serverNow();
  const said = typeof e.preview === 'string' && e.preview.trim() ? e.preview : null;
  const back: WebsiteRow = {
    ...was,
    status: 'open',
    closed_at: null,
    closed_reason: null,
    closed_by: null,
    inactive: false,
    online: true,
    last_seen: at,
    awaiting_reply: true,
    waiting_since: at,
    last_visitor_at: at,
    updated_at: at,
    reopened_at: at,
    unread: (was.unread ?? 0) + 1,
    last_message: said ? { id: Number(e.message_id) || 0, body: said, from: 'visitor', agent: null, file: null, at } : (was.last_message ?? null),
  };
  const without = (rows: WebsiteRow[]) => rows.filter((r) => r.id !== id);
  const moved = (key: QueryKey, old: unknown): unknown => {
    const [, , list, scope] = key as unknown[];
    const d = old as { conversations?: WebsiteRow[]; pages?: Array<{ conversations?: WebsiteRow[] } | null> } | undefined;
    if (list !== 'open' && !cachedRows(old).some((r) => r.id === id)) return old;
    // Closed, and a search of closed chats: it is not there any more.
    if (list === 'closed' || (list === 'search' && scope === 'closed')) {
      if (Array.isArray(d?.pages)) return { ...d, pages: d.pages.map((p) => (p && Array.isArray(p.conversations) ? { ...p, conversations: without(p.conversations) } : p)) };
      return Array.isArray(d?.conversations) ? { ...d, conversations: without(d.conversations) } : old;
    }
    if (!Array.isArray(d?.conversations)) return old;
    // The open list: at the top. A search of every chat: open, where it was.
    if (list === 'open') return { ...d, conversations: [back, ...without(d.conversations)] };
    return { ...d, conversations: d.conversations.map((r) => (r.id === id ? back : r)) };
  };
  for (const [key, data] of lists) {
    const next = moved(key, data);
    // Read when it was, still: this is not an answer from the server.
    if (next !== data) qc.setQueryData(key, next, { updatedAt: qc.getQueryState(key)?.dataUpdatedAt });
  }
  return true;
}

/** The lists follow a returning visitor's reopened chat as it happens (#291): see {@link reopenInLists}. */
export function useReturningVisitors(enabled = true): void {
  const qc = useQueryClient();
  useEffect(() => (enabled ? on<ListEvent>('realtime:event', (e) => void reopenInLists(qc, e)) : undefined), [qc, enabled]);
}

/** How many closed chats a page of the Closed list holds (#252). */
export const CLOSED_PAGE = 50;
const CLOSED_QUERY = { status: 'closed', fields: 'list', limit: String(CLOSED_PAGE) };

/**
 * Closed chats, a page at a time (worksuite-desktop#252): Closed only grows, and reading two hundred whole rows every
 * 15 s — 2 KB each, with devices, pages and teams nobody reads in a list of finished chats — was a large part of what
 * made the lists slow. Fifty rows of list fields at a time, the next page as the list is scrolled to its end, the first
 * from the copy saved on this computer at once; asked again once a minute (a closed chat changes rarely).
 */
export function useWebsiteClosed(enabled = true) {
  const key = ['website', 'inbox', 'closed', 'pages'];
  const path = `${WEBSITE}/conversations`;
  useSavedCopy(key, path, CLOSED_QUERY, isWebsiteList, enabled, (hit) => ({ pages: [hit], pageParams: [null] }));
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => timed('conversations:closed', () => apiGet<WebsiteListPage>(path, pageParam ? { ...CLOSED_QUERY, cursor: pageParam } : CLOSED_QUERY, signal), (d) => d?.conversations?.length ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last?.has_more && last.next_cursor ? last.next_cursor : undefined),
    enabled,
    refetchInterval: (query) => (deniedOrGone(query.state.error) ? false : 60_000),
    retry: (n, e) => !deniedOrGone(e) && n < 2,
  });
  const pages = q.data?.pages;
  const data = useMemo(() => {
    if (!pages) return undefined;
    // A chat closed while paging moves to the top: each id once, where it is newest.
    const seen = new Set<number>();
    const conversations = pages.flatMap((p) => p?.conversations ?? []).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    return { conversations, can: pages[0]?.can ?? ({} as WebsiteCan) };
  }, [pages]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  return {
    ...q,
    data,
    hasMore: !!hasNextPage,
    loadingMore: isFetchingNextPage,
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
  };
}

/**
 * A search of every conversation, closed ones too, by visitor, email, site, page and what was said (CHAT-UI-00).
 * Two characters at least, as the server asks; the last results stay while the next ones load.
 */
export function useWebsiteSearch(needle: string, closed: boolean) {
  return useQuery({
    queryKey: ['website', 'inbox', 'search', closed ? 'closed' : 'all', needle],
    queryFn: ({ signal }) => timed('conversations:search', () => apiGet<{ conversations: WebsiteRow[]; can: WebsiteCan }>(`${WEBSITE}/conversations`, closed ? { q: needle, status: 'closed' } : { q: needle }, signal), (d) => d?.conversations?.length ?? null),
    enabled: needle.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    retry: false,
  });
}

/**
 * Whether this person staffs website chat at all. The server's own answer —
 * a refusal hides the website tab rather than showing a page of errors.
 */
export function useWebsiteAccess(): boolean {
  const q = useWebsiteInbox(false);
  return q.isSuccess && q.data.can?.view !== false;
}

/** A saved copy is a conversation only when it has one: anything else waits for the server. */
const isConversation = (hit: unknown): boolean => {
  const c = hit as Partial<WebsiteConversation> | null;
  return !!c && typeof c === 'object' && !!c.conversation && typeof c.conversation === 'object' && Array.isArray(c.messages);
};

/**
 * `review` reads a chat back without arriving in it (C-04): the server neither joins, claims nor handles it, so a
 * missed chat's detail can be looked at before anybody decides what to do, and a returning visitor still rings. From
 * the copy saved on this computer at once when it was read before (worksuite-desktop#261), then from the server.
 */
export function useWebsiteConversation(id: string, { review = false }: { review?: boolean } = {}) {
  const key = review ? ['website', 'conversation', id, 'review'] : ['website', 'conversation', id];
  useSavedCopy(key, `${WEBSITE}/conversations/${id}`, review ? { review: '1' } : undefined, isConversation, true);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => timed('conversation', () => apiGet<WebsiteConversation>(`${WEBSITE}/conversations/${id}`, review ? { review: '1' } : undefined, signal), (d) => d?.messages?.length ?? null),
    // No realtime event for replies or visitor typing: poll, slower in the background.
    refetchInterval: () => (document.visibilityState === 'visible' ? 5_000 : 30_000),
  });
}

/**
 * The conversations opened last, kept in memory so going back to one is instant (worksuite-desktop#239). Older ones
 * are let go once nothing shows them; the saved copy on disk still opens them at once.
 */
export const RECENT_CONVERSATIONS = 8;
const recentlyOpened: string[] = [];

/** Remembers `id` as opened now, and lets go of the one opened longest ago beyond the limit. */
export function rememberOpened(qc: QueryClient, id: string, limit = RECENT_CONVERSATIONS): void {
  const at = recentlyOpened.indexOf(id);
  if (at >= 0) recentlyOpened.splice(at, 1);
  recentlyOpened.unshift(id);
  while (recentlyOpened.length > limit) {
    const old = recentlyOpened.pop()!;
    const key = ['website', 'conversation', old];
    // Still on screen somewhere (a second pane): kept; it goes the next time the list moves on.
    if (qc.getQueryCache().findAll({ queryKey: key }).some((q) => q.getObserversCount() > 0)) continue;
    qc.removeQueries({ queryKey: key });
  }
}

/** For tests: forget which conversations were opened. */
export function resetRecentlyOpened(): void {
  recentlyOpened.length = 0;
}

/**
 * The open thread (worksuite-desktop#239): from memory when it was opened lately, else from the copy saved on this
 * computer, while the server is asked in the background; polled as before. Held in memory for as long as it is among
 * the last {@link RECENT_CONVERSATIONS} opened.
 */
export function useOpenConversation(id: string) {
  const qc = useQueryClient();
  useEffect(() => rememberOpened(qc, id), [qc, id]);
  return useLocalFirstQuery<WebsiteConversation>({
    queryKey: ['website', 'conversation', id],
    path: `${WEBSITE}/conversations/${id}`,
    // No realtime event for replies or visitor typing: poll, slower in the background.
    interval: 5_000,
    gcTime: Infinity,
    accept: isConversation,
    // Timed for Help › Diagnostics (#252).
    wrapFetch: (fetch) => timed('conversation', fetch, (d) => d?.messages?.length ?? null),
  });
}

/**
 * A reply on its way (worksuite-desktop#252; plan 1.9): drawn in the thread the moment Send is pressed, marked
 * "Sending…", and replaced by the message the server stored — with its "Sent" tick — as soon as the server says so,
 * without waiting for the thread to be read again. One that went to the outbox leaves this list at once (the outbox
 * shows its own, Pending, kept on this computer). One the server refused stays, "Not sent", with the reason, Retry
 * (under the same client id, so the server never stores it twice) and Discard.
 */
export interface SendingReply {
  key: string;
  conversationId: number;
  body: string;
  at: string;
  /** Made before the first try, sent on every one (DLV-01). */
  clientId: string;
  state: 'sending' | 'failed';
  error: string | null;
  replyTo: number | null;
  cannedId: number | null;
}

export const sendingReplies = createStore<{ list: SendingReply[] }>({ list: [] });
let sendingSeq = 0;

/** The replies still on their way in this conversation. */
export function useSendingReplies(conversationId: number): SendingReply[] {
  const list = useStore(sendingReplies, (s) => s.list);
  return useMemo(() => list.filter((r) => r.conversationId === conversationId), [list, conversationId]);
}

/** The server's stamp, as the thread's messages carry it: UTC without a zone. */
const serverStamp = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

const patchSending = (key: string, changes: Partial<SendingReply>) => sendingReplies.set((s) => ({ list: s.list.map((x) => (x.key === key ? { ...x, ...changes } : x)) }));

/**
 * Show a reply at once; call what this returns with the outbox's answer. Delivered: the stored message goes into the
 * thread by seq (as the server will list it, merged by id and client id) and only that thread and the open list are
 * asked again — not every website query, as a reply used to (the closed list, missed chats and the rest, all at once
 * behind the reply). Refused: kept, Not sent. Queued, or no answer at all: let go.
 */
export function startWebsiteReply(
  qc: QueryClient,
  conversationId: number,
  body: string,
  replyTo: number | null = null,
  opts: { clientId?: string; cannedId?: number | null; key?: string } = {},
): (r: { delivered: boolean; queued: boolean; data?: unknown; error?: string | null } | null) => void {
  const clientId = opts.clientId ?? newClientId();
  const key = opts.key ?? `sending-${++sendingSeq}`;
  const started = Date.now();
  if (opts.key && sendingReplies.get().list.some((x) => x.key === key)) patchSending(key, { state: 'sending', error: null });
  else sendingReplies.set((s) => ({ list: [...s.list, { key, conversationId, body, at: new Date().toISOString(), clientId, state: 'sending', error: null, replyTo, cannedId: opts.cannedId ?? null }] }));
  let done = false;
  return (r) => {
    if (done) return;
    done = true;
    const posted = r?.delivered ? ((r.data ?? null) as { id?: number; at?: string; seq?: number | null; client_id?: string | null; timing?: ServerTiming } | null) : null;
    if (posted && typeof posted.id === 'number') {
      const s = app.get();
      const me = s.auth?.user?.id ? Number(s.auth.user.id) : null;
      const message: WebsiteMessage = {
        id: posted.id, body, from: 'agent', agent: s.bootstrap?.user?.name ?? null, agent_id: me, at: posted.at ?? serverStamp(new Date()),
        file: null, visibility: 'public', reply_to: replyTo, reply: null,
        ...(typeof posted.seq === 'number' ? { seq: posted.seq } : {}), client_id: posted.client_id ?? clientId,
      };
      qc.setQueriesData<WebsiteConversation>({ queryKey: ['website', 'conversation', String(conversationId)] }, (d) =>
        d && Array.isArray(d.messages) && !d.messages.some((m) => m.id === message.id) ? { ...d, messages: mergeBySeq(d.messages, [message]) } : d,
      );
      recordTimingOf('reply', Date.now() - started, posted.timing ?? null);
    }
    if (r && !r.delivered && !r.queued) {
      // Refused: the words stay, Not sent, with the server's reason and Retry.
      patchSending(key, { state: 'failed', error: r.error ?? text('The server refused it.') });
      return;
    }
    sendingReplies.set((st) => ({ list: st.list.filter((x) => x.key !== key) }));
    if (r?.delivered) {
      void qc.invalidateQueries({ queryKey: ['website', 'conversation', String(conversationId)] });
      void qc.invalidateQueries({ queryKey: ['website', 'inbox', 'open'] });
    }
  };
}

/**
 * Send a reply to a visitor through the outbox (RDC-07, plan 1.9): drawn at once, sent with its client id, pending on
 * this computer while offline and sent once on reconnecting. Resolves with the outbox's answer.
 */
export async function sendWebsiteReply(qc: QueryClient, conversationId: number, words: string, replyTo: number | null = null, cannedId: number | null = null): Promise<SubmitResult> {
  const clientId = newClientId();
  const finish = startWebsiteReply(qc, conversationId, words, replyTo, { clientId, cannedId });
  const r = await call('offline:submit', websiteReplyMutation(conversationId, words, replyTo, cannedId, clientId)).catch((e: unknown) => {
    finish(null);
    throw e;
  });
  finish(r);
  if (r.queued) void qc.invalidateQueries({ queryKey: ['offline'] });
  return r;
}

/** Send a Not sent reply again, under the same client id: the server answers a repeat with the copy it has. */
export async function retryWebsiteReply(qc: QueryClient, key: string): Promise<void> {
  const p = sendingReplies.get().list.find((x) => x.key === key);
  if (!p || p.state !== 'failed') return;
  const finish = startWebsiteReply(qc, p.conversationId, p.body, p.replyTo, { clientId: p.clientId, cannedId: p.cannedId, key });
  try {
    const r = await call('offline:submit', websiteReplyMutation(p.conversationId, p.body, p.replyTo, p.cannedId, p.clientId));
    finish(r);
    if (r.queued) void qc.invalidateQueries({ queryKey: ['offline'] });
  } catch (e) {
    finish({ delivered: false, queued: false, error: errorMessage(e) });
  }
}

/** Let go of a Not sent reply. */
export function discardWebsiteReply(key: string): void {
  sendingReplies.set((s) => ({ list: s.list.filter((x) => x.key !== key) }));
}

/** What the open thread has loaded, wherever it came from: the composer's suggestions read it. */
export function openConversationData(qc: QueryClient, id: string): WebsiteConversation | undefined {
  return qc.getQueriesData<WebsiteConversation>({ queryKey: ['website', 'conversation', id] }).find(([key, data]) => key[3] !== 'review' && data)?.[1];
}

/**
 * Change the open thread's loaded copy in place, under whatever key holds it (the key carries the account's scope after
 * the id, so an exact key misses it). @returns whether there was a copy to change
 */
export function updateOpenConversation(qc: QueryClient, id: string, fn: (d: WebsiteConversation) => WebsiteConversation): boolean {
  let hit = false;
  qc.setQueriesData<WebsiteConversation>({ queryKey: ['website', 'conversation', id], predicate: (q) => q.queryKey[3] !== 'review' }, (d) => {
    if (!d) return d;
    hit = true;
    return fn(d);
  });
  return hit;
}

export function useAgents(enabled: boolean, conversationId?: number) {
  return useQuery({
    queryKey: ['website', 'agents', conversationId ?? 'all'],
    queryFn: ({ signal }) =>
      apiGet<{ agents: Colleague[]; departments?: Array<{ id: number; name: string; available: number }> }>(`${WEBSITE}/agents`, conversationId ? { conversation_id: String(conversationId) } : undefined, signal),
    enabled,
    // For a picker, who is available now matters: asked again each time it opens.
    staleTime: conversationId ? 0 : 5 * 60_000,
  });
}

export interface CannedPayload {
  responses: SavedReply[];
  can?: { view: boolean; reply: boolean; manage: boolean };
}

/**
 * The saved replies (CAN-01, RDC-03). With a widget, only those for every widget and that widget's own, as its
 * conversations' composer offers them (S-09); without one, all of them, as Website chats › Saved replies lists them.
 */
export function useCanned(enabled: boolean, widgetId?: number | null) {
  return useQuery({
    queryKey: ['website', 'canned', widgetId || 'all'],
    queryFn: ({ signal }) => apiGet<CannedPayload>(`${WEBSITE}/canned`, widgetId ? { widget_id: String(widgetId) } : undefined, signal),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** A conversation's tags as a list, however the server sent them. */
export function tagList(tags: string[] | string | null | undefined): string[] {
  const all = Array.isArray(tags) ? tags : (tags ?? '').split(',');
  return [...new Set(all.map((t) => t.trim()).filter(Boolean))];
}

export async function websiteAction(id: number | string, action: string, extra: Record<string, unknown> = {}): Promise<void> {
  await request('POST', `${WEBSITE}/conversations/${id}/action`, { body: { action, ...extra } });
}

/** What the server's bulk endpoint does (INB-08): close, reopen, star, unstar, assign, priority. */
export type WebsiteBulkAction = 'assign' | 'priority' | 'star' | 'unstar' | 'close' | 'reopen';

/** Its extra fields: whom to assign to (null to unassign) and which priority. */
export interface WebsiteBulkExtra {
  user_id?: number | null;
  priority?: WebsitePriority;
}

/** The most the server takes in one bulk action (INB-08). */
export const BULK_LIMIT = 200;

/**
 * One action on several website chats (INB-08, UX-LIST-02): `POST conversations/bulk`. Assigning goes one by one on
 * the server, so each assignee is alerted. Resolves to the server's own sentence ("2 updated").
 */
export async function websiteBulk(ids: number[], action: WebsiteBulkAction, extra: WebsiteBulkExtra = {}): Promise<string | null> {
  const res = await request<{ count: number }>('POST', `${WEBSITE}/conversations/bulk`, { body: { ids, action, ...extra } });
  return res.message ?? null;
}

/** `websiteBulk` for a screen: the server's sentence as a toast, a refusal as an error, and the lists read again. */
export function useWebsiteBulk() {
  const qc = useQueryClient();
  return (ids: number[], action: WebsiteBulkAction, extra: WebsiteBulkExtra = {}): Promise<boolean> =>
    websiteBulk(ids, action, extra).then(
      (message) => {
        toast('success', message ?? text('Updated.'));
        void qc.invalidateQueries({ queryKey: ['website'] });
        return true;
      },
      (e) => {
        toast('error', errorMessage(e));
        return false;
      },
    );
}

/**
 * Several staff in one chat (ENH-WCHAT-03): invite, transfer, leave, remove, a note, and a supervisor's monitor,
 * join and take over — each the server's own answer, refusals with its sentence.
 */
export const team = {
  invite: (id: number, body: { user_ids?: number[]; department_id?: number; note?: string }) => request('POST', `${WEBSITE}/conversations/${id}/invites`, { body }),
  transfer: (id: number, body: { to_user_id?: number; department_id?: number; any?: boolean; mode: 'warm' | 'cold'; note?: string }) =>
    request('POST', `${WEBSITE}/conversations/${id}/transfer`, { body }),
  leave: (id: number) => request('POST', `${WEBSITE}/conversations/${id}/leave`),
  remove: (id: number, userId: number) => request('DELETE', `${WEBSITE}/conversations/${id}/participants/${userId}`),
  note: (id: number, message: string, mentions: number[]) => request<{ id: number; at: string; mentioned: number[] }>('POST', `${WEBSITE}/conversations/${id}/note`, { body: { message, mentions } }),
  cancel: (handoffId: number) => request('DELETE', `${WEBSITE}/handoffs/${handoffId}`),
  monitor: (id: number) => request('POST', `${WEBSITE}/conversations/${id}/monitor`),
  join: (id: number) => request('POST', `${WEBSITE}/conversations/${id}/join`),
  takeOver: (id: number) => request('POST', `${WEBSITE}/conversations/${id}/take-over`),
};

/** A role in words, as the "In this chat" panel says it. */
export const ROLE_LABEL: Record<TeamRole, string> = { owner: 'Owner', participant: 'Participant', observer: 'Monitoring' };

/** What a visitor is doing, in the list's one word. */
export function visitorStatus(v: { conversation_status: string | null; idle_seconds: number; chat?: { awaiting: boolean } | null }): ['Waiting' | 'Chatting' | 'Active' | 'Inactive', string] {
  // Waiting: their chat is open and they spoke last (worksuite-desktop#231).
  if ((v.conversation_status === 'open' || v.conversation_status === 'pending') && v.chat?.awaiting) return ['Waiting', 'text-[#9A4A06] dark:text-warning'];
  if (v.conversation_status === 'open' || v.conversation_status === 'pending') return ['Chatting', 'text-primary'];
  return v.idle_seconds < 120 ? ['Active', 'text-success'] : ['Inactive', 'text-ink-3'];
}
