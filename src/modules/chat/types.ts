import { app } from '../../core/app-state';
import { apiUrl } from '../../core/api';
import { isOfficeFile, mediaToken, openDocument, openInOffice } from '../../core/open-document';

/** Chat shapes, as `/api/chat/rooms` and `/api/chat/messages` return them. Stamps are UTC without a zone. */
export interface Room {
  id: number;
  type: string;
  name: string;
  avatar_name: string;
  other_user_id?: number | null;
  last_message: { text: string; sender_id: number; created_at: string; type: string } | null;
  unread: number;
  updated_at: string;
  pinned: boolean;
  muted: boolean;
  mentions: number;
  favorite?: boolean;
  archived?: boolean;
  notify_level?: string;
  /** Whether the server offers calls here (worksuite-desktop#113). Absent from an older server. */
  can_call?: boolean;
  /** Marked unread by hand: the list shows a dot with nothing new in it (worksuite-desktop#183). */
  marked_unread?: boolean;
  /** When a timed mute ends (ISO); null for "until I turn it back on". */
  muted_until?: string | null;
  /** My role in it: owner, admin or member (worksuite-desktop#183). Absent from an older server. */
  role?: string;
  /** I blocked the other person in this direct conversation. */
  blocked?: boolean;
}

/** Conversations nobody can ring: a website visitor's chat and WorkSuite's own notices. */
const NOT_CALLABLE = new Set(['widget', 'system']);

/**
 * Whether a conversation offers voice and video calls: the server says, and a
 * channel that cannot carry a WorkSuite call never offers one — no call button
 * may suggest calling that the channel does not support (worksuite-desktop#113).
 */
export function canCall(r: Pick<Room, 'type' | 'can_call'> | null | undefined): boolean {
  return !!r && r.can_call !== false && !NOT_CALLABLE.has(r.type);
}

/** The person a conversation's avatar shows: the other person in a direct message; nobody for a group, which keeps its own shape and initials. */
export function roomPerson(r: Pick<Room, 'type' | 'other_user_id'> | null | undefined): number | null {
  return r && r.type === 'direct' && typeof r.other_user_id === 'number' ? r.other_user_id : null;
}

export interface ChatFile {
  id: number;
  kind: string;
  filename: string;
  mime: string;
  size: number;
  is_image: boolean;
  duration_ms: number | null;
  /** A voice message's loudness, 64 steps of 0–100, as its sender's device measured it (#285); absent from an older server. */
  waveform?: number[] | null;
  /** An AAC copy of a voice message, for a player that cannot play the Opus original (#285); absent from an older server. */
  m4a_url?: string | null;
  width: number | null;
  height: number | null;
  preview: string | null;
  status: string;
  url: string | null;
  download_url: string | null;
  thumb_url: string | null;
  poster_url: string | null;
}

/** What the server says this person may do with a message (MessageActions::can). */
export interface MessageCan {
  reply?: boolean;
  react?: boolean;
  copy?: boolean;
  edit?: boolean;
  delete_me?: boolean;
  delete_everyone?: boolean;
  forward?: boolean;
}

export interface ChatMessage {
  id: number;
  room_id: number;
  sender_id: number;
  sender_name: string;
  type: string;
  message: string | null;
  file: ChatFile | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean; names?: string[] }>;
  reply_to?: number | null;
  reply_preview: { id?: number; sender_name: string; snippet: string } | null;
  edited: boolean;
  deleted: boolean;
  /** Sent as urgent: it reaches people who only want priority notifications. */
  urgent?: boolean;
  can?: MessageCan;
  receipt: { status: 'sent' | 'delivered' | 'read'; read: number; total: number } | null;
  /** Whether this person has played the voice message (#285); absent from an older server. */
  listened?: boolean;
  client_message_id: string | null;
  /** A call's card: the call or Meet meeting it stands for, and how it stands now. */
  call_uuid?: string | null;
  call_state?: 'live' | 'ended' | 'gone' | null;
  call_kind?: 'call' | 'meeting' | null;
  call_mode?: string | null;
  call_outcome?: string | null;
  call_duration?: number | null;
  /** A meeting's name and when it started (worksuite-desktop#71); absent from an older server. */
  call_title?: string | null;
  call_started_at?: string | null;
  created_at: string;
}

/**
 * An attachment's address, usable in <img>/<audio>. The server signs its media
 * links as `/media/<token>` at its own root (no credentials needed, allowed by
 * the page's CSP for that server only); attachments stored before the Drive
 * move are `/chat/files/<token>` under the API and go through the app's proxy,
 * which adds the session.
 */
export function mediaUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u.startsWith('/media/')) {
    const origin = app.get().auth?.server?.origin;
    return origin ? `${origin}${u}` : null;
  }
  if (u.startsWith('/chat/files/')) return apiUrl(`/api${u}`);
  if (u.startsWith('/api/')) return apiUrl(u);
  return null;
}

/**
 * "Open" on an attachment: downloaded and opened on this computer — a PDF in
 * PDF Studio, a Word, Excel or PowerPoint file in its installed application —
 * never in the browser. An address the app cannot fetch itself falls back to `link`.
 */
export function openAttachment(f: Pick<ChatFile, 'download_url' | 'filename'>, link: (url: string) => void): void {
  const token = mediaToken(f.download_url);
  // A Word, Excel or PowerPoint file opens in a WorkSuite DOC / Sheet / Slides tab.
  if (token && isOfficeFile(f.filename)) openInOffice({ kind: 'api', path: `/media/${token}?download=1`, name: f.filename });
  else if (token) void openDocument({ chatMedia: token }, f.filename);
  else if (f.download_url) link(f.download_url);
}
