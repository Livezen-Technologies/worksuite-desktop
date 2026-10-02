import { useQuery } from '@tanstack/react-query';
import type { MetaPlatform } from '@shared/channels';
import { ApiError, apiGet, apiPost } from '../../../core/api';
import { text } from '../../../core/i18n';

export type { MetaPlatform };

/**
 * Messenger and Instagram as channels of Chat (worksuite-desktop#36): the Facebook Pages and Instagram professional
 * accounts shared with this person, their conversations and messages, answering within each platform's messaging
 * window, and connecting, checking, reconnecting and disconnecting accounts — from the server's Meta module
 * (`/api/meta`). Both are the server's `meta` application.
 */
export const META = '/api/meta';

export const PLATFORM_LABEL: Record<MetaPlatform, string> = { messenger: 'Messenger', instagram: 'Instagram' };
export const PLATFORM_ICON: Record<MetaPlatform, string> = { messenger: 'message-circle', instagram: 'camera' };

export interface MetaAccount {
  id: number;
  platform: MetaPlatform;
  /** The Page's name, or the Instagram username. */
  name: string;
  page_id: string;
  page_name: string;
  username: string | null;
  picture_url: string | null;
  status: 'connected' | 'token_invalid' | 'permission_missing' | 'webhook_unsubscribed' | 'error' | 'disconnected' | string;
  status_note: string | null;
  webhook_subscribed: boolean;
  is_shared: boolean;
  /** Messenger replies tagged HUMAN_AGENT up to 7 days after the person last wrote. */
  human_agent: boolean;
  role: 'owner' | 'admin' | 'agent' | 'viewer' | null;
  can_reply: boolean;
  can_connect: boolean;
  unread: number;
  conversations: number;
  connected_at: string | null;
  last_checked_at: string | null;
}

export interface MetaConversation {
  id: number;
  account_id: number;
  platform: MetaPlatform;
  participant_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_direction: 'in' | 'out' | null;
  last_inbound_at: string | null;
  unread: number;
  account_name: string;
  account_status: string;
}

export interface MetaMessage {
  id: number;
  direction: 'in' | 'out';
  kind: 'text' | 'image' | 'video' | 'audio' | 'file' | 'share' | 'story_mention' | 'location' | 'unsupported' | 'deleted' | string;
  body: string | null;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  /** A signed `/media/` address for a kept attachment. */
  media_url: string | null;
  media_status: string | null;
  media_note: string | null;
  status: 'received' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | string;
  error_code: string | null;
  error_text: string | null;
  tag: string | null;
  sender_name: string | null;
  created_at: string;
  sent_at: string | null;
}

/** Whether this person may send now, and the reason code (and sentence) when not. */
export interface MetaWindow {
  allowed: boolean;
  code: 'open' | 'human_agent' | 'no_inbound' | 'window_closed' | 'no_permission' | 'not_connected' | string;
  reason: string | null;
  tag: string | null;
  closes_at: string | null;
}

export interface MetaThread {
  conversation: MetaConversation & { account: MetaAccount; window: MetaWindow };
  messages: MetaMessage[];
  has_more: boolean;
  can_reply: boolean;
}

export interface MetaCandidate {
  id: string;
  page_id: string;
  name: string;
  page_name: string;
  username: string | null;
  picture: string | null;
  usable: boolean;
  note: string | null;
  connected: boolean;
  account_id: number | null;
}

export interface MetaConnectState {
  status: 'pending' | 'ready' | 'failed' | 'used' | 'expired';
  platform: MetaPlatform;
  error: string | null;
  candidates: MetaCandidate[];
}

export interface MetaSendResult {
  sent: number;
  failed: number;
  results: Array<{ name: string; ok: boolean; code?: string | null; error?: string | null }>;
}

export const isMetaConnected = (a: Pick<MetaAccount, 'status'>): boolean => a.status === 'connected';

/** A refusal is an answer, not a fault: somebody without the app is not asked again every few seconds. */
const refused = (e: unknown) => e instanceof ApiError && (e.forbidden || e.status === 404);

export function useMetaAccounts(enabled: boolean) {
  return useQuery({
    queryKey: ['meta', 'accounts'],
    queryFn: ({ signal }) => apiGet<{ accounts: MetaAccount[]; can_connect: boolean; ready: boolean }>(`${META}/accounts`, undefined, signal),
    enabled,
    refetchInterval: (q) => (refused(q.state.error) ? false : 30_000),
    retry: (n, e) => !refused(e) && n < 2,
  });
}

export function useMetaConversations(params: { platform: MetaPlatform; account: number; unread: boolean; q: string }, enabled: boolean) {
  const q = params.q.trim();
  return useQuery({
    queryKey: ['meta', 'conversations', params.platform, params.account, params.unread, q],
    queryFn: ({ signal }) =>
      apiGet<{ conversations: MetaConversation[]; total: number }>(
        `${META}/conversations`,
        { platform: params.platform, per_page: '60', ...(params.account ? { account_id: String(params.account) } : {}), ...(params.unread ? { scope: 'unread' } : {}), ...(q ? { q } : {}) },
        signal,
      ),
    enabled,
    // The server nudges (`meta.message`); polling covers a gateway that is down.
    refetchInterval: () => (document.visibilityState === 'visible' ? 15_000 : 60_000),
    retry: (n, e) => !refused(e) && n < 2,
  });
}

export function useMetaThread(id: string) {
  return useQuery({
    queryKey: ['meta', 'conversation', id],
    queryFn: ({ signal }) => apiGet<MetaThread>(`${META}/conversations/${id}`, undefined, signal),
    refetchInterval: () => (document.visibilityState === 'visible' ? 5_000 : 30_000),
    retry: (n, e) => !refused(e) && n < 2,
  });
}

export const readMeta = (id: number | string) => apiPost<{ ok: boolean }>(`${META}/conversations/${id}/read`);

export const sendMeta = (id: number | string, body: string) => apiPost<{ ok: boolean; code: string | null; error: string | null; message: MetaMessage | null }>(`${META}/conversations/${id}/messages`, { text: body });

/** Files from this computer, each its own message, then the words (neither platform captions an attachment). */
export function sendMetaFiles(id: number | string, files: File[], caption: string) {
  const form = new FormData();
  for (const f of files) form.append('files[]', f, f.name);
  form.append('caption', caption);
  return apiPost<MetaSendResult>(`${META}/conversations/${id}/attachments`, form);
}

/** Connecting: the Facebook Login address, where the sign-in stands, and the choice. */
export const startMetaConnect = (platform: MetaPlatform, accountId?: number) =>
  apiPost<{ state: string; url: string; expires_at: string }>(`${META}/connect`, { platform, ...(accountId ? { account_id: accountId } : {}) });
export const pollMetaConnect = (state: string) => apiGet<MetaConnectState>(`${META}/connect/${state}`);
export const selectMetaConnect = (state: string, ids: string[]) => apiPost<{ ok: boolean; accounts: MetaAccount[] }>(`${META}/connect/${state}/select`, { ids });

/** An account's connection asked again; disconnecting it (its conversations stay). */
export const checkMeta = (id: number) => apiPost<{ ok: boolean; account: MetaAccount }>(`${META}/accounts/${id}/check`);
export const disconnectMeta = (id: number) => apiPost<{ ok: boolean; account: MetaAccount }>(`${META}/accounts/${id}/disconnect`);

/** A platform's badge — unread messages on its accounts — and what is wrong when an account is not connected. */
export function metaState(platform: MetaPlatform, accounts: MetaAccount[]): { badge: number; problem: string | null } {
  const mine = accounts.filter((a) => a.platform === platform);
  const badge = mine.reduce((n, a) => n + (a.unread ?? 0), 0);
  const down = mine.filter((a) => !isMetaConnected(a));
  if (!down.length) return { badge, problem: null };
  if (down.length === 1) return { badge, problem: text('{name} is not connected', { name: down[0]!.name }) };
  return { badge, problem: text('{n} accounts are not connected', { n: down.length }) };
}

/** What a status is called where it is shown as a pill. */
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    connected: 'Connected',
    token_invalid: 'Sign-in expired',
    permission_missing: 'Permission removed',
    webhook_unsubscribed: 'Not receiving messages',
    error: 'Connection error',
    disconnected: 'Disconnected',
  };
  return text(labels[status] ?? 'Not connected');
}

/**
 * Why the composer is closed, in words, from the server's reason code. The server's own sentence is used for the
 * window (it knows the platform's limit and whether Human Agent applies); the rest are said here.
 */
export function refusalText(w: Pick<MetaWindow, 'code' | 'reason'>, platform: MetaPlatform, account: string): string {
  const name = PLATFORM_LABEL[platform];
  switch (w.code) {
    case 'no_permission':
      return text('You can read this account’s conversations but not reply on it. Ask whoever manages it for agent access.');
    case 'not_connected':
      return text('{account} is not connected, so nothing can be sent until it is reconnected.', { account });
    case 'no_inbound':
      return text('On {platform} a business can only answer: this person has not written yet.', { platform: name });
    case 'window_closed':
      return w.reason ?? text('It is too long since this person last wrote, so {platform} will not deliver a reply until they write again.', { platform: name });
    default:
      return w.reason ?? text('Messages cannot be sent here now.');
  }
}

/** What a reason code a send came back with means, for the toast. */
export function sendErrorText(code: string | null | undefined, fallback: string | null | undefined): string {
  const known: Record<string, string> = {
    token_invalid: 'The connection to Meta has expired or was revoked. Reconnect the account.',
    permission_missing: 'Meta refused: a permission this needs was removed. Reconnect the account.',
    attachment_unsupported: 'That kind of file cannot be sent on this platform.',
    attachment_too_large: 'That file is too large for this platform.',
    rate_limited: 'Meta is limiting how fast this account sends. Try again in a little while.',
    recipient_unavailable: 'This person cannot be reached on this account any more.',
  };
  return fallback ?? text(code && known[code] ? known[code] : 'Not sent.');
}

/** What each platform carries: Messenger any file to 25 MB; Instagram pictures (8 MB), video and sound (25 MB), no documents. */
export function metaFileRefusal(platform: MetaPlatform, f: Pick<File, 'type' | 'size' | 'name'>): string | null {
  const t = f.type.toLowerCase();
  const kind = t.startsWith('image/') ? 'image' : t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : 'file';
  const mb = 1024 * 1024;
  if (platform === 'instagram') {
    if (kind === 'file') return text('{name}: Instagram only carries pictures, video and sound.', { name: f.name });
    if (kind === 'image' && !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(t)) return text('{name}: Instagram takes JPEG, PNG, GIF or WebP pictures.', { name: f.name });
    if (kind === 'image' && f.size > 8 * mb) return text('{name} is larger than {n} MB.', { name: f.name, n: 8 });
  }
  if (f.size > 25 * mb) return text('{name} is larger than {n} MB.', { name: f.name, n: 25 });
  return null;
}

/** The file chooser's filter, so Instagram is not offered documents. */
export const ACCEPT: Record<MetaPlatform, string | undefined> = { messenger: undefined, instagram: 'image/jpeg,image/png,image/gif,image/webp,video/*,audio/*' };

/** What the list shows under a name: the last message, "You: " when it was ours. */
export function metaPreview(c: Pick<MetaConversation, 'last_message' | 'last_direction'>): string {
  const body = (c.last_message ?? '').trim();
  if (!body) return text('No messages yet');
  return c.last_direction === 'out' ? `${text('You')}: ${body}` : body;
}

/** What a message that is not text reads as in the thread. */
export function metaMessageText(m: Pick<MetaMessage, 'kind' | 'body' | 'filename'>): string {
  if (m.kind === 'text') return m.body ?? '';
  const label: Record<string, string> = {
    image: 'Photo', video: 'Video', audio: 'Voice message', file: 'File', share: 'Shared post', story_mention: 'Mentioned you in their story',
    location: 'Location', unsupported: 'A message this app cannot show', deleted: 'Message unsent',
  };
  const what = text(label[m.kind] ?? 'Attachment');
  return m.filename ? `${what} · ${m.filename}` : what;
}

/** A kept attachment, for the shared preview (pictures, video, sound) or to open and download by its signed address. */
export function metaAttachment(m: MetaMessage): { id: number; filename: string; mime: string; size: number; url: string; download_url: string } | null {
  if (!m.media_url) return null;
  return { id: m.id, filename: m.filename ?? metaMessageText(m), mime: m.mime_type ?? '', size: m.size ?? 0, url: m.media_url, download_url: m.media_url };
}

/** Who a conversation is with, and on which account: shown on every row and thread so nobody answers from the wrong one. */
export function accountLabel(platform: MetaPlatform, accountName: string): string {
  return `${PLATFORM_LABEL[platform]} · ${accountName}`;
}
