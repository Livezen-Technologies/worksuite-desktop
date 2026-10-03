import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, apiPost } from '../../../core/api';
import type { WaDisplay } from './wa-names';

/**
 * WhatsApp as a channel of Chat (worksuite-desktop#33, #35): the numbers shared with this person, their
 * conversations, messages and attachments, approved templates and the numbers' connection, from the server's
 * WhatsApp inbox (`/api/whatsapp`). Broadcasts, editing templates and labels, and sharing a number stay on the web.
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
  /** This person's part on the number: owner, admin, agent or viewer. */
  role?: string | null;
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
  /** The contact's WhatsApp picture as a signed `/media/` address, when the server has one (it does not fetch them yet). */
  avatar_url?: string | null;
  /** #176: the number (digits) or group id, the group's subject and size, and who the server says it is. */
  wa_id?: string | null;
  subject?: string | null;
  member_count?: number | null;
  display?: WaDisplay | null;
  phone_e164?: string | null;
  wa_profile_name?: string | null;
  book_contact_id?: number | null;
}

export interface WaMessage {
  external_id?: string | null;
  id: number;
  direction: 'in' | 'out';
  kind: string;
  body: string | null;
  caption: string | null;
  status: string | null;
  error_text: string | null;
  sender_name: string | null;
  filename: string | null;
  /** The attachment, kept in the Drive: absent when nothing was kept (too large, or the download failed). */
  file_id?: number | null;
  mime_type?: string | null;
  size?: number | null;
  media_status?: string | null;
  media_note?: string | null;
  created_at: string;
  sent_at: string | null;
  /** In a group, who said it (#176): their number, and the name the server found for it. */
  from_wa_id?: string | null;
  author_name?: string | null;
  author_e164?: string | null;
  author_contact_id?: number | null;
}

export interface WaThread {
  chat: {
    id: number;
    name: string;
    wa_id: string;
    kind?: string;
    subject?: string | null;
    member_count?: number | null;
    display?: WaDisplay | null;
    phone_e164?: string | null;
    wa_profile_name?: string | null;
    account_id: number;
    unread: number;
    window: { allowed: boolean; reason: string | null };
    account: WaAccount;
    avatar_url?: string | null;
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

/**
 * On its way up — the session is starting or signing in — rather than down: said as "connecting", not as a fault
 * (#176: a number read "not connected · Starting the session" while its messages kept arriving).
 */
export function isConnecting(a: Pick<WaAccount, 'status'>): boolean {
  return a.status === 'connecting' || a.status === 'authenticating';
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

export function sendWa(chatId: number | string, text: string, replyTo?: string) {
  return apiPost<{ ok: boolean; error?: string }>(`${WA}/chats/${chatId}/messages`, { kind: 'text', text, ...(replyTo ? { reply_to: replyTo } : {}) });
}

/** An approved template, with its placeholders filled in order: what may be sent once the 24-hour window has closed. */
export function sendWaTemplate(chatId: number | string, templateId: number, variables: string[]) {
  return apiPost<{ ok: boolean; error?: string }>(`${WA}/chats/${chatId}/messages`, { kind: 'template', template_id: templateId, ...(variables.length ? { variables } : {}) });
}

export interface WaSendResult {
  sent: number;
  failed: number;
  results: Array<{ name: string; ok?: boolean; error?: string }>;
}

/** Files from this computer, with a caption, as the web sends them (the server keeps each in the Drive). */
export function sendWaFiles(chatId: number | string, files: File[], caption: string, voice = false) {
  const form = new FormData();
  for (const f of files) form.append('files[]', f, f.name);
  form.append('caption', caption);
  form.append('voice', voice ? '1' : '0');
  return apiPost<WaSendResult>(`${WA}/chats/${chatId}/attachments`, form);
}

/** A conversation with a number nobody has written from, on one of your numbers; only a template reaches them first. */
export function startWa(accountId: number, phone: string) {
  return apiPost<{ chat_id: number }>(`${WA}/chats`, { account_id: accountId, phone });
}

/** The workspace's WhatsApp settings: which attachments may be sent, and how large. */
export interface WaLimits {
  kinds: { image: boolean; video: boolean; audio: boolean; document: boolean };
  maxBytes: number;
}

/** What the API proxy takes in one request: a larger file is sent from the web. */
export const PROXY_LIMIT = 25 * 1024 * 1024;

export function waLimits(settings: Record<string, unknown> | undefined): WaLimits {
  const on = (k: string) => String(settings?.[k] ?? '1') === '1';
  const mb = Math.max(1, Number(settings?.whatsapp_max_attach_mb ?? 64) || 64);
  return { kinds: { image: on('whatsapp_allow_image'), video: on('whatsapp_allow_video'), audio: on('whatsapp_allow_audio'), document: on('whatsapp_allow_document') }, maxBytes: Math.min(mb * 1024 * 1024, PROXY_LIMIT) };
}

/** What a file is to WhatsApp's settings. */
export function fileKind(f: Pick<File, 'type'>): keyof WaLimits['kinds'] {
  const t = f.type.toLowerCase();
  return t.startsWith('image/') ? 'image' : t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : 'document';
}

/** Why a file cannot be sent, or null when it can. */
export function fileRefusal(f: Pick<File, 'type' | 'size' | 'name'>, limits: WaLimits): string | null {
  const kind = fileKind(f);
  if (!limits.kinds[kind]) return `${f.name}: ${kind === 'document' ? 'documents' : `${kind}s`} cannot be sent on WhatsApp here.`;
  if (f.size > limits.maxBytes) return `${f.name} is larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`;
  return null;
}

export function useWaSettings(enabled: boolean) {
  return useQuery({
    queryKey: ['whatsapp', 'settings'],
    queryFn: ({ signal }) => apiGet<{ settings: Record<string, unknown>; can_edit: boolean }>(`${WA}/settings`, undefined, signal),
    enabled,
    staleTime: 5 * 60_000,
    retry: (n, e) => !refused(e) && n < 2,
  });
}

export interface WaTemplate {
  id: number;
  account_id: number | string | null;
  name: string;
  kind: 'quick_reply' | 'template' | string;
  body: string;
  status?: string | null;
  slots: number[];
}

/** The approved templates that may be sent from this number (one of no number is everybody's). */
export function useWaTemplates(accountId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['whatsapp', 'templates'],
    queryFn: ({ signal }) => apiGet<{ templates: WaTemplate[] }>(`${WA}/templates`, { kind: 'template' }, signal),
    enabled,
    staleTime: 60_000,
    retry: (n, e) => !refused(e) && n < 2,
    select: (d) => d.templates.filter((t) => t.kind === 'template' && (t.account_id === null || Number(t.account_id) === accountId)),
  });
}

/** A number's connection, asked again; making it the default; unlinking it from the phone (the history stays). */
export const checkWa = (id: number) => apiPost<{ status?: string }>(`${WA}/accounts/${id}/check`);
export const makeDefaultWa = (id: number) => apiPost<{ ok: boolean }>(`${WA}/accounts/${id}/default`);
export const unlinkWa = (id: number) => apiPost<{ ok: boolean; error: string | null }>(`${WA}/accounts/${id}/unlink`);

/** A message's attachment, for the shared preview (pictures, video, sound, text) or to download from the Drive. */
export function waAttachment(m: WaMessage): { driveFile: number; filename: string; mime: string; size: number; url: string; download_url: string } | null {
  if (!m.file_id) return null;
  const url = `/api/files/${m.file_id}/download`;
  return { driveFile: m.file_id, filename: m.filename ?? (m.kind === 'document' ? (m.body ?? 'Document') : `WhatsApp ${m.kind}`), mime: m.mime_type ?? '', size: m.size ?? 0, url, download_url: url };
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
