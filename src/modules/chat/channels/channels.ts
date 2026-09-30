import type { Room } from '../types';
import type { WebsiteRow } from '../website/api';
import { isConnected, type WaAccount } from './whatsapp';

/**
 * The messaging channels down the left of Chat (worksuite-desktop#33): Chat itself, website chat and WhatsApp.
 * A channel is in the toolbar once this person has it: website chat when they staff it, WhatsApp once a number is
 * shared with them. Anything else is offered under "Add a channel".
 */
export type ChannelId = 'chat' | 'website' | 'whatsapp';

export interface Channel {
  id: ChannelId;
  label: string;
  icon: string;
  /** Unread (Chat, WhatsApp) or waiting (website) conversations. */
  badge: number;
  /** Set when the channel cannot carry messages: the tooltip and the list say why. */
  problem: string | null;
}

/** Which channel a Chat route is on. Website chats keep the routes they always had. */
export function channelOf(query: URLSearchParams): ChannelId {
  if (query.get('view') === 'website' || query.get('website')) return 'website';
  if (query.get('channel') === 'whatsapp') return 'whatsapp';
  return 'chat';
}

const LAST_WA = 'ws.chat.whatsapp.last';

/** The WhatsApp conversation to come back to when the channel is picked again. */
export function rememberWhatsapp(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_WA, id);
  } catch {
    // A convenience: the channel opens on its list instead.
  }
}

/** Where picking a channel goes. Chat reopens its last conversation itself. */
export function channelRoute(id: ChannelId): string {
  if (id === 'website') return '/chat?view=website';
  if (id === 'whatsapp') {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WA);
    } catch {
      last = null;
    }
    return last && /^\d+$/.test(last) ? `/chat?channel=whatsapp&wa=${last}` : '/chat?channel=whatsapp';
  }
  return '/chat';
}

/** Chat's badge: unread messages, leaving out archived and muted conversations (a muted one is not to nag). */
export function chatUnread(rooms: Room[]): number {
  return rooms.reduce((n, r) => n + (!r.archived && !r.muted ? r.unread : 0), 0);
}

/** Website chat's badge: visitors waiting for an answer. */
export function websiteWaiting(rows: WebsiteRow[]): number {
  return rows.filter((r) => r.awaiting_reply).length;
}

/** WhatsApp's badge, and what is wrong with it if a shared number is not connected. */
export function whatsappState(accounts: WaAccount[]): { badge: number; problem: string | null } {
  const badge = accounts.reduce((n, a) => n + (a.unread ?? 0), 0);
  const down = accounts.filter((a) => !isConnected(a));
  if (!down.length) return { badge, problem: null };
  if (down.length === accounts.length && accounts.length > 1) return { badge, problem: 'None of your WhatsApp numbers is connected' };
  return { badge, problem: down.length === 1 ? `${down[0]!.name} is not connected` : `${down.length} numbers are not connected` };
}

/** The toolbar's channels. The one open now is always there, even before it has anything in it. */
export function buildChannels(input: { active: ChannelId; rooms: Room[]; website: { access: boolean; rows: WebsiteRow[] }; whatsapp: { access: boolean; accounts: WaAccount[] } }): Channel[] {
  const out: Channel[] = [{ id: 'chat', label: 'Chat', icon: 'chat', badge: chatUnread(input.rooms), problem: null }];
  if (input.website.access || input.active === 'website') out.push({ id: 'website', label: 'Web Chat', icon: 'globe', badge: websiteWaiting(input.website.rows), problem: null });
  if (input.whatsapp.access && (input.whatsapp.accounts.length || input.active === 'whatsapp')) out.push({ id: 'whatsapp', label: 'WhatsApp', icon: 'phone', ...whatsappState(input.whatsapp.accounts) });
  return out;
}

/** A badge's text: never wider than the icon it sits on. */
export function badgeText(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** The toolbar button's name for a screen reader, and its tooltip. */
export function channelTitle(c: Channel, what: 'unread' | 'waiting' = c.id === 'website' ? 'waiting' : 'unread'): string {
  const parts = [c.label];
  if (c.badge) parts.push(`${c.badge} ${what}`);
  if (c.problem) parts.push(c.problem);
  return parts.join(' · ');
}

/**
 * The conversation list's width, Chat's and WhatsApp's alike (worksuite-desktop#34): dragged on its right edge,
 * remembered on this computer. Never so narrow that a name and its time do not fit, and never so wide that the
 * conversation beside it has less than 480px (536px is that and the 56px channel toolbar).
 */
export const LIST_WIDTH = { defaultWidth: 300, min: 240, max: () => Math.min(560, window.innerWidth - 536) };
