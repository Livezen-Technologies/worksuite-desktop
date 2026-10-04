import { text } from '../../../core/i18n';
import { parseTs } from '../../../core/time';
import type { Attachment } from '../AttachmentViewer';
import { recordsIn } from '../cards/recordLinks';
import type { ChatMessage, MessageCan } from '../types';
import { quoteAuthor, type WebsiteEvent, type WebsiteMessage } from '../website/api';

/**
 * One message as the shared chat kit draws it (C-02, SRS RDC-11; worksuite-desktop#229). Team Chat and website chats
 * map their own shapes into this through the adapters below and render through the same list, bubbles, meta and
 * attachments — so a fix to how a picture or a receipt looks lands in both at once.
 */
export type KitRole = 'self' | 'staff' | 'visitor' | 'bot';

/** An attachment with what the kit can use to size and credit it. */
export type KitFile = Attachment & {
  thumb_url?: string | null;
  width?: number | null;
  height?: number | null;
  /** Who sent it, for the shared files list. */
  by?: string;
  /** `processing` while the server still prepares a video or voice note. */
  status?: string;
  duration_ms?: number | null;
};

export interface KitReaction {
  emoji: string;
  count: number;
  mine: boolean;
  names?: string[];
}

/** A share or record card on a Team Chat message (worksuite-desktop#164). */
export type Card = { kind: string; available?: boolean; why?: string; heading?: string; name?: string; owner?: string; who?: string; what?: string; link?: string; note?: string | null };

/** The Team Chat message a kit message came from: cards, calls, forwarding and editing need the original. */
export type TeamChatMessage = ChatMessage & { starred?: boolean; pinned?: unknown; card?: Card | null };

export interface KitMessage {
  /** Unique within the list (React keys). */
  key: string;
  id: number;
  kind: 'text' | 'system' | 'activity' | 'call';
  author: { id?: number | string | null; name: string; avatar?: string | null; role: KitRole };
  /** Drawn on our side, on the right. */
  own: boolean;
  /** Named above the bubble even on our side: in a website chat each colleague signs their run (TEAM-05). */
  signed?: boolean;
  body: string | null;
  files?: KitFile[];
  reply?: { author: string; snippet: string } | null;
  /** It answered a message that has since gone. */
  replyRemoved?: boolean;
  reactions?: KitReaction[];
  receipt?: 'sent' | 'delivered' | 'read';
  /** What the ticks say to a screen reader and on hover ("Read by 3", "Delivered to the visitor"). */
  receiptLabel?: string;
  /** A line under the message: "Read 10:43", "Read by you, Nimal" (LIVE-08). */
  footer?: string | null;
  /** A note or notice only staff see (TEAM-60, TEAM-63). */
  internal?: boolean;
  /** The server's stamp. */
  at: string;
  /** `at` in milliseconds, for ordering and grouping. */
  time: number;
  deleted?: boolean;
  edited?: boolean;
  starred?: boolean;
  pinned?: boolean;
  urgent?: boolean;
  pending?: boolean;
  /** What this person may do with it, as the server says. */
  can?: MessageCan;
  /**
   * A system line about a voice call (V-03): `call` is drawn as the green call pill ("Voice call started by the visitor
   * · you answered after 0:12"), `missed` red. Plain otherwise.
   */
  tone?: 'call' | 'missed';
  /** A system line that carries its time ("Nuwan joined the chat · 10:41"). */
  timed?: boolean;
  /** A page the visitor opened (ActivityEvent). */
  activity?: { url: string | null; title: string | null; seconds: number | null; newVisit: boolean };
  /** Drawn as a record or share card, without a bubble (RecordMessage). */
  card?: boolean;
  chat?: TeamChatMessage;
}

const ms = (stamp: string) => {
  const t = parseTs(stamp).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** A Team Chat message, for the person signed in as `me`; `origin` finds record links in its text. */
export function fromChatMessage(m: TeamChatMessage, me: string | number | null | undefined, origin?: string | null): KitMessage {
  const own = me !== null && me !== undefined && String(m.sender_id) === String(me);
  const kind = m.type === 'system' ? 'system' : m.type === 'call' && m.call_uuid && !m.deleted ? 'call' : 'text';
  const r = own ? m.receipt : null;
  return {
    key: `m${m.id}`,
    id: m.id,
    kind,
    author: { id: m.sender_id, name: m.sender_name, role: own ? 'self' : 'staff' },
    own,
    body: m.message,
    files: m.file ? [{ ...m.file, by: m.sender_name }] : [],
    reply: m.reply_preview ? { author: m.reply_preview.sender_name, snippet: m.reply_preview.snippet } : null,
    reactions: m.reactions,
    receipt: r?.status,
    receiptLabel: r ? (r.status === 'read' ? `Read by ${r.read}` : r.status === 'delivered' ? 'Delivered' : 'Sent') : undefined,
    at: m.created_at,
    time: ms(m.created_at),
    deleted: m.deleted,
    edited: m.edited,
    starred: !!m.starred,
    pinned: !!m.pinned,
    urgent: !!m.urgent,
    can: m.can ?? {},
    card: kind === 'text' && !m.deleted && (!!m.card || recordsIn(m.message, origin).length > 0),
    chat: m,
  };
}

/** A widget file's address: the staff route through the API (`/chat/…` → `/api/chat/…`), as the attachment preview reads it. */
export function websiteFileUrl(url: string): string {
  return url.startsWith('/chat/') ? `/api${url}` : url;
}

export interface WebsiteContext {
  me: number | null;
  /** The visitor's name as the thread shows it. */
  visitor: string;
  /** Replying is open (the chat is not closed and this person may reply). */
  canReply: boolean;
  status?: 'sent' | 'delivered' | 'read';
  footer?: string | null;
  /** How long after writing a message it can still be deleted for the visitor (#229). */
  deleteMinutes?: number;
}

/** A website chat message (RDC-11): the visitor's, a colleague's, the bot's, a notice or an internal note. */
export function fromWebsiteMessage(m: WebsiteMessage, ctx: WebsiteContext): KitMessage {
  const internal = m.visibility === 'internal';
  const author =
    m.from === 'visitor'
      ? { name: ctx.visitor, role: 'visitor' as const }
      : m.from === 'bot'
        ? { name: m.agent ?? text('Automated message'), avatar: m.avatar ?? null, role: 'bot' as const }
        : { id: m.agent_id ?? null, name: m.agent ?? text('A colleague'), avatar: m.avatar ?? null, role: m.agent_id !== null && m.agent_id !== undefined && m.agent_id === ctx.me ? ('self' as const) : ('staff' as const) };
  const q = m.reply;
  const file = m.file ? websiteFileUrl(m.file.url) : null;
  return {
    key: `w${m.id}`,
    id: m.id,
    kind: m.from === 'system' ? 'system' : 'text',
    author,
    // The team answers from one side, whoever of it writes; the bot speaks from the visitor's side, as the widget shows it.
    own: m.from === 'agent',
    signed: m.from === 'agent',
    body: m.body,
    files:
      m.file && file && !m.deleted
        ? [{ filename: m.file.name ?? m.file.filename, mime: m.file.mime, size: m.file.size, is_image: m.file.is_image, url: m.file.preview_url ? websiteFileUrl(m.file.preview_url) : file, download_url: file, thumb_url: m.file.thumb_url ? websiteFileUrl(m.file.thumb_url) : null, width: m.file.width ?? null, height: m.file.height ?? null, by: author.name }]
        : [],
    deleted: m.deleted,
    reply: q ? { author: quoteAuthor(q, ctx.visitor), snippet: q.body ?? (q.file ? `📎 ${q.file}` : text('A removed message')) } : null,
    replyRemoved: !q && !!m.reply_to,
    receipt: ctx.status,
    receiptLabel: ctx.status ? (ctx.status === 'read' ? text('Read by the visitor') : ctx.status === 'delivered' ? text('Delivered to the visitor') : text('Sent')) : undefined,
    footer: ctx.footer ?? null,
    internal,
    at: m.at,
    time: ms(m.at),
    timed: m.from === 'system',
    // Reactions are never added in a website chat (RDC-12); a quote goes to the visitor, so never of a note.
    // Deleting reaches the visitor too, for what I wrote, within the server's window (#229); the server has the last word.
    can: { reply: ctx.canReply && m.from !== 'system' && !internal && !m.deleted, react: false, copy: !m.deleted, delete_everyone: m.from === 'agent' && !m.deleted && author.role === 'self' && Date.now() - ms(m.at) < (ctx.deleteMinutes ?? 15) * 60_000 },
  };
}

/** "48 s", "2 min", "1 h 5 min": how long a page held the visitor. */
export function dwell(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const rest = Math.round((seconds % 3600) / 60);
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** A URL's path, or the URL itself when it is not one. */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/** A page the visitor opened, as a line in the thread (ActivityEvent, RDC-11): "→ Opened /shop/x · 2 min". */
export function fromWidgetEvent(e: WebsiteEvent, index = 0): KitMessage {
  const where = e.url ? pathOf(e.url) : (e.title ?? text('a page'));
  const what = e.kind === 'page_view' ? text('Opened {page}', { page: where }) : e.title ?? e.kind.replace(/_/g, ' ');
  return {
    key: `e${e.id ?? `${e.at}-${index}`}`,
    id: e.id ?? -(index + 1),
    kind: 'activity',
    author: { name: text('Visitor'), role: 'visitor' },
    own: false,
    body: `→ ${what}${e.seconds !== null && e.seconds !== undefined ? ` · ${dwell(e.seconds)}` : ''}`,
    at: e.at,
    time: ms(e.at),
    activity: { url: e.url, title: e.title, seconds: e.seconds ?? null, newVisit: !!e.new_visit },
  };
}

/**
 * The visitor's events that belong in this chat's thread: the visit the chat started in, from its first page on. The
 * timeline reaches back across earlier visits, which are the drawer's history, not this conversation.
 */
export function eventsForThread(events: WebsiteEvent[] | null | undefined, startedAt: string | null | undefined): WebsiteEvent[] {
  const all = events ?? [];
  if (!all.length) return [];
  const started = startedAt ? ms(startedAt) : Number.POSITIVE_INFINITY;
  let from = 0;
  all.forEach((e, i) => {
    if (e.new_visit && ms(e.at) <= started) from = i;
  });
  return all.slice(from);
}

/** Messages and events in one timeline, oldest first; a page opened in the same second comes before what was said on it. */
export function byTime(items: KitMessage[]): KitMessage[] {
  return items
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.time - b.m.time || (a.m.kind === 'activity' ? 0 : 1) - (b.m.kind === 'activity' ? 0 : 1) || a.i - b.i)
    .map((x) => x.m);
}
