import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, request } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { text } from '../../../core/i18n';
import { parseTs } from '../../../core/time';

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
}

/**
 * A visitor who wrote again in one of my chats and waits (worksuite-desktop#230) goes to the top of the list, the
 * longest waiting first; the rest keep their order.
 */
export function followUpsFirst(rows: WebsiteRow[], mine: (r: WebsiteRow) => boolean): WebsiteRow[] {
  const waiting = (r: WebsiteRow) => !!r.reply_waiting_since && r.awaiting_reply && mine(r);
  const top = rows.filter(waiting).sort((a, b) => a.reply_waiting_since!.localeCompare(b.reply_waiting_since!));
  return top.length ? [...top, ...rows.filter((r) => !waiting(r))] : rows;
}

/** The wait clock's colour (#223): amber at the callback threshold, red after it; red throughout where there is none. */
export function waitTone(seconds: number, amber: number | null | undefined, red: number | null | undefined): 'plain' | 'amber' | 'red' {
  if (!amber && !red) return 'red';
  if (red && seconds >= red) return 'red';
  if (amber && seconds >= amber) return 'amber';
  return 'plain';
}

/** Message-id marks that only move forward (LIVE-05): how far the visitor has the team's messages, and each person the visitor's. */
export interface WebsiteMarks {
  visitor: { delivered: number | null; read: number | null; delivered_at: string | null; read_at: string | null };
  staff: Array<{ user_id: number; name: string; delivered: number | null; read: number | null; read_at: string | null }>;
}

/** A team message's state for the visitor (LIVE-08): sent, delivered to their widget, or read with its panel open. */
export function visitorHas(id: number, marks: WebsiteMarks | null | undefined): 'sent' | 'delivered' | 'read' {
  const v = marks?.visitor;
  if (v?.read && v.read >= id) return 'read';
  if (v?.delivered && v.delivered >= id) return 'delivered';
  return 'sent';
}

/** Who of the team has read the visitor's message (LIVE-08): "you" first. */
export function readBy(id: number, marks: WebsiteMarks | null | undefined, me: number | null): string[] {
  const who = (marks?.staff ?? []).filter((s) => s.read !== null && s.read >= id);
  return [...who.filter((s) => s.user_id === me).map(() => 'you'), ...who.filter((s) => s.user_id !== me).map((s) => s.name)];
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

/** A row's preview: who said it last, unless it was the visitor, then the words or the file. */
export function lastSaid(m: NonNullable<WebsiteRow['last_message']>, myName: string | null): string {
  const what = m.body ?? (m.file ? `📎 ${m.file}` : '');
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
  };
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
}

export type CallbackOutcome = 'answered' | 'no_answer' | 'wrong_number';

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

/** The visitor who has waited longest for a reply, the one "Open the longest waiting" opens. */
export function longestWaiting(rows: WebsiteRow[]): WebsiteRow | null {
  let best: WebsiteRow | null = null;
  let bestAt = Number.NaN;
  for (const r of rows) {
    if (!r.awaiting_reply) continue;
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
  const n = rows.filter((r) => r.awaiting_reply).length;
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

export function useWebsiteInbox(closed: boolean, enabled = true) {
  return useQuery({
    queryKey: ['website', 'inbox', closed ? 'closed' : 'open'],
    queryFn: ({ signal }) => apiGet<{ conversations: WebsiteRow[]; can: WebsiteCan }>(`${WEBSITE}/conversations`, closed ? { status: 'closed' } : undefined, signal),
    enabled,
    // Somebody who does not staff website chat is told once, not every 15 s.
    refetchInterval: (query) => (query.state.error instanceof ApiError && (query.state.error.forbidden || query.state.error.status === 404) ? false : 15_000),
    retry: (n, e) => !(e instanceof ApiError && (e.forbidden || e.status === 404)) && n < 2,
  });
}

/**
 * A search of every conversation, closed ones too, by visitor, email, site, page and what was said (CHAT-UI-00).
 * Two characters at least, as the server asks; the last results stay while the next ones load.
 */
export function useWebsiteSearch(needle: string, closed: boolean) {
  return useQuery({
    queryKey: ['website', 'inbox', 'search', closed ? 'closed' : 'all', needle],
    queryFn: ({ signal }) => apiGet<{ conversations: WebsiteRow[]; can: WebsiteCan }>(`${WEBSITE}/conversations`, closed ? { q: needle, status: 'closed' } : { q: needle }, signal),
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

/**
 * `review` reads a chat back without arriving in it (C-04): the server neither joins, claims nor handles it, so a
 * missed chat's detail can be looked at before anybody decides what to do, and a returning visitor still rings.
 */
export function useWebsiteConversation(id: string, { review = false }: { review?: boolean } = {}) {
  return useQuery({
    queryKey: review ? ['website', 'conversation', id, 'review'] : ['website', 'conversation', id],
    queryFn: ({ signal }) => apiGet<WebsiteConversation>(`${WEBSITE}/conversations/${id}`, review ? { review: '1' } : undefined, signal),
    // No realtime event for replies or visitor typing: poll, slower in the background.
    refetchInterval: () => (document.visibilityState === 'visible' ? 5_000 : 30_000),
  });
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

export function useCanned(enabled: boolean) {
  return useQuery({
    queryKey: ['website', 'canned'],
    queryFn: ({ signal }) => apiGet<{ responses: Array<{ id: number; shortcut: string | null; title: string; body: string }> }>(`${WEBSITE}/canned`, undefined, signal),
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
