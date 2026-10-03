import type { Room } from '../types';
import type { WebsiteRow } from '../website/api';
import { metaState, type MetaAccount, type MetaPlatform } from './meta';
import { isConnected, isConnecting, type WaAccount } from './whatsapp';

/**
 * The messaging channels down the left of Chat (worksuite-desktop#33): Chat itself, website chat, WhatsApp, and
 * Messenger and Instagram (#36). A channel is in the toolbar once this person has it: website chat when they staff
 * it, WhatsApp once a number is shared with them, Messenger or Instagram once an account of it is. Anything else is
 * offered under "Add a channel".
 */
export type ChannelId = 'chat' | 'website' | 'whatsapp' | MetaPlatform;

export const isMetaChannel = (id: ChannelId): id is MetaPlatform => id === 'messenger' || id === 'instagram';

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
  const channel = query.get('channel');
  if (channel === 'whatsapp' || channel === 'messenger' || channel === 'instagram') return channel;
  return 'chat';
}

const LAST_WA = 'ws.chat.whatsapp.last';
const lastMeta = (platform: MetaPlatform) => `ws.chat.${platform}.last`;

/** The WhatsApp conversation to come back to when the channel is picked again. */
export function rememberWhatsapp(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_WA, id);
  } catch {
    // A convenience: the channel opens on its list instead.
  }
}

/** The Messenger or Instagram conversation to come back to. */
export function rememberMeta(platform: MetaPlatform, id: string | null): void {
  try {
    if (id) localStorage.setItem(lastMeta(platform), id);
  } catch {
    // A convenience: the channel opens on its list instead.
  }
}

/** Where picking a channel goes. Chat reopens its last conversation itself. */
export function channelRoute(id: ChannelId): string {
  if (id === 'website') return '/chat?view=website';
  if (id === 'whatsapp' || isMetaChannel(id)) {
    let last: string | null = null;
    try {
      last = localStorage.getItem(id === 'whatsapp' ? LAST_WA : lastMeta(id));
    } catch {
      last = null;
    }
    const param = id === 'whatsapp' ? 'wa' : 'mc';
    return last && /^\d+$/.test(last) ? `/chat?channel=${id}&${param}=${last}` : `/chat?channel=${id}`;
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
  // Starting up is not a fault (#176): said as such, so it does not read as a number that needs linking again.
  if (down.every(isConnecting)) return { badge, problem: down.length === 1 ? `${down[0]!.name} is connecting` : `${down.length} numbers are connecting` };
  if (down.length === accounts.length && accounts.length > 1) return { badge, problem: 'None of your WhatsApp numbers is connected' };
  return { badge, problem: down.length === 1 ? `${down[0]!.name} is not connected` : `${down.length} numbers are not connected` };
}

/**
 * The toolbar's channels. The one open now is always there, even before it has anything in it. WhatsApp shows for
 * whoever has WhatsApp once a number is shared with them (or they may connect one), its badge the unread messages
 * on those numbers.
 */
export function buildChannels(input: {
  active: ChannelId;
  chat?: boolean;
  rooms: Room[];
  website: { access: boolean; rows: WebsiteRow[] };
  whatsapp: { access: boolean; accounts: WaAccount[]; canConnect?: boolean };
  meta?: { access: boolean; accounts: MetaAccount[] };
}): Channel[] {
  // Chat itself is there for whoever has Chat; someone who has only WhatsApp (#35) has only its channel.
  const out: Channel[] = input.chat === false ? [] : [{ id: 'chat', label: 'Chat', icon: 'chat', badge: chatUnread(input.rooms), problem: null }];
  if (input.website.access || input.active === 'website') out.push({ id: 'website', label: 'Web Chat', icon: 'globe', badge: websiteWaiting(input.website.rows), problem: null });
  if (input.whatsapp.access && (input.whatsapp.accounts.length || input.whatsapp.canConnect || input.active === 'whatsapp')) out.push({ id: 'whatsapp', label: 'WhatsApp', icon: 'phone', ...whatsappState(input.whatsapp.accounts) });
  // Messenger and Instagram (#36) once an account of theirs is shared with this person, or it is open now; connecting
  // the first one is under "Add a channel".
  const meta = input.meta;
  if (meta?.access) {
    for (const [id, label, icon] of [['messenger', 'Messenger', 'message-circle'], ['instagram', 'Instagram', 'camera']] as const) {
      if (meta.accounts.some((a) => a.platform === id) || input.active === id) out.push({ id, label, icon, ...metaState(id, meta.accounts) });
    }
  }
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
