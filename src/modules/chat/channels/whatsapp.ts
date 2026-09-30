import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, apiPost } from '../../../core/api';

/**
 * WhatsApp as a channel of Chat (worksuite-desktop#33): the numbers shared with this person, their conversations and
 * messages, from the server's WhatsApp inbox (`/api/whatsapp`). Broadcasts, templates, labels and the numbers'
 * settings stay on the web, where they are edited.
 */
export const WA = '/api/whatsapp';

export interface WaAccount {
  id: number;
  name: string;
  provider: 'cloud_api' | 'web_js' | 'simulator' | string;
  provider_label?: string;
  is_live?: boolean;
  phone: string | null;
  colour?: string | null;
  status: string;
  status_note: string | null;
  is_default: boolean;
  can_send?: boolean;
  can_connect?: boolean;
  unread?: number;
  chats?: number;
}

export interface WaChat {
  id: number;
  account_id: number;
  kind: string;
  name: string;
  phone: string | null;
  status: string;
  unread: number;
  is_pinned: number;
  is_muted: number;
  last_message: string | null;
  last_message_at: string | null;
  last_direction: 'in' | 'out' | null;
  awaiting_since: string | null;
  waiting_minutes: number | null;
  overdue: boolean;
  account_name: string;
  assigned_name: string | null;
}

export interface WaMessage {
  id: number;
  direction: 'in' | 'out';
  kind: string;
  body: string | null;
  caption: string | null;
  status: string | null;
  error_text: string | null;
  sender_name: string | null;
  filename: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface WaThread {
  chat: {
    id: number;
    name: string;
    wa_id: string;
    account_id: number;
    unread: number;
    window: { allowed: boolean; reason: string | null };
    account: WaAccount;
  };
  messages: WaMessage[];
  has_more: boolean;
  can_send: boolean;
}

export type WaScope = 'all' | 'unread' | 'waiting' | 'mine';

export const WA_SCOPES: Array<{ id: WaScope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'mine', label: 'Mine' },
];

/** A number that can carry messages now. Anything else (being set up, unlinked, failing) needs somebody to act. */
export function isConnected(a: WaAccount): boolean {
  return a.status === 'connected';
}

/** A refusal is an answer, not a fault: somebody without WhatsApp is not asked again every few seconds. */
const refused = (e: unknown) => e instanceof ApiError && (e.forbidden || e.status === 404);

export function useWaAccounts(enabled: boolean) {
  return useQuery({
    queryKey: ['whatsapp', 'accounts'],
    queryFn: ({ signal }) => apiGet<{ accounts: WaAccount[]; default_id: number | null }>(`${WA}/accounts`, undefined, signal),
    enabled,
    refetchInterval: (q) => (refused(q.state.error) ? false : 30_000),
    retry: (n, e) => !refused(e) && n < 2,
  });
}

export function useWaChats(params: { account: number; scope: WaScope; q: string }, enabled: boolean) {
  const q = params.q.trim();
  return useQuery({
    queryKey: ['whatsapp', 'chats', params.account, params.scope, q],
    queryFn: ({ signal }) =>
      apiGet<{ chats: WaChat[]; total: number }>(
        `${WA}/chats`,
        { scope: params.scope, per_page: '60', ...(params.account ? { account_id: String(params.account) } : {}), ...(q ? { q } : {}) },
        signal,
      ),
    enabled,
    // No realtime event for WhatsApp in the desktop app yet: poll, slower in the background.
    refetchInterval: () => (document.visibilityState === 'visible' ? 15_000 : 60_000),
    retry: (n, e) => !refused(e) && n < 2,
  });
}

export function useWaThread(id: string) {
  return useQuery({
    queryKey: ['whatsapp', 'chat', id],
    queryFn: ({ signal }) => apiGet<WaThread>(`${WA}/chats/${id}`, undefined, signal),
    refetchInterval: () => (document.visibilityState === 'visible' ? 5_000 : 30_000),
    retry: (n, e) => !refused(e) && n < 2,
  });
}

export function sendWa(chatId: number | string, text: string) {
  return apiPost<{ ok: boolean; error?: string }>(`${WA}/chats/${chatId}/messages`, { kind: 'text', text });
}

export function readWa(chatId: number | string) {
  return apiPost<{ ok: boolean }>(`${WA}/chats/${chatId}/read`);
}

/** What the list shows under a name: the last message, "You: " when it was ours. */
export function preview(c: Pick<WaChat, 'last_message' | 'last_direction'>): string {
  const text = (c.last_message ?? '').trim();
  if (!text) return 'No messages yet';
  return c.last_direction === 'out' ? `You: ${text}` : text;
}

/** What a message that is not text reads as in the thread. */
export function messageText(m: WaMessage): string {
  if (m.kind === 'text' || m.kind === 'template') return m.body ?? '';
  const label: Record<string, string> = { image: 'Photo', video: 'Video', audio: 'Voice message', document: 'Document', sticker: 'Sticker', location: 'Location', contacts: 'Contact card' };
  const what = label[m.kind] ?? 'Attachment';
  const name = m.filename ?? (m.kind === 'document' ? m.body : null);
  return [name ? `${what} · ${name}` : what, m.caption].filter(Boolean).join('\n');
}
