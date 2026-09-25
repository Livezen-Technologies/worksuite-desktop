import { app } from '../../core/app-state';
import { apiUrl } from '../../core/api';

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
}

export interface ChatFile {
  id: number;
  kind: string;
  filename: string;
  mime: string;
  size: number;
  is_image: boolean;
  duration_ms: number | null;
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
  can?: MessageCan;
  receipt: { status: 'sent' | 'delivered' | 'read'; read: number; total: number } | null;
  client_message_id: string | null;
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
