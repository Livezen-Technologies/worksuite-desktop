import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { WA_DELTA_LIMIT, mergeWaThread, prependWaPage } from '@shared/wa-thread';
import { app } from '../../../core/app-state';
import { on } from '../../../core/bridge';
import { useLocalFirstQuery } from '../../../core/local-first-query';
import { useStore } from '../../../core/store';
import { ApiError, apiGet, apiPost } from '../../../core/api';
import { formatPhone, toE164 } from '../../../core/phone';
import { createStore } from '../../../core/store';
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
  /** WhatsApp Web numbers: the engine it runs on (null: the server's default bridge). */
  engine?: string | null;
  is_live?: boolean;
  phone: string | null;
  connected_at?: string | null;
  checked_at?: string | null;
  device_label?: string | null;
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
  /** The WhatsApp id of the message this one answers. */
  reply_to?: string | null;
  /** The message this one answers, when it is in the conversation: a line of it, and who wrote it. */
  quoted?: { id: number; direction: 'in' | 'out'; kind: string; text: string; sender_name: string | null; from_wa_id: string | null } | null;
  /** Reactions on it, by emoji; `mine` is this number's own. */
  reactions?: Array<{ emoji: string; count: number; mine: boolean }>;
  /** A place, a contact card or a template: what the message carries besides its words. */
  meta?: Record<string, unknown> | null;
  /** A poll: its question and answers, the votes on each, and ours. */
  poll?: { name: string; options: string[]; multiple: boolean; counts?: Record<string, number>; mine?: string[]; voters?: number } | null;
  /** The id this app gave a message it sent, so a retry is never sent twice (Whatsapp 1.6.0). */
  client_message_id?: string | null;
  /** Shown before the server has it: a negative id, `queued` while on its way, `failed` with `retry` when it was not sent. */
  pending?: { text: string; replyTo?: string } | null;
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
  /** Older messages: `before=next_before`. What changed from now on: `since=cursor` (Whatsapp 1.6.0). */
  next_before?: number | null;
  cursor?: string | null;
  delta?: boolean;
}

export type WaScope = 'all' | 'unread' | 'waiting' | 'mine';

export const WA_SCOPES: Array<{ id: WaScope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'mine', label: 'Mine' },
];

/** A number that can carry messages now. Anything else (being set up, unlinked, failing) needs somebody to act. */
export function isConnected(a: Pick<WaAccount, 'status'>): boolean {
  return a.status === 'connected';
}

/** Unconfirmed QR records must not claim ownership of a stored phone value. */
export function confirmedWaPhone(a: WaAccount): string | null {
  if (a.provider === 'web_js' && (['setup', 'qr_required', 'connecting', 'authenticating'].includes(a.status) || (!isConnected(a) && !a.connected_at))) return null;
  return a.phone;
}

export function formatWaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (/^94\d{9}$/.test(digits)) return `+94 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return digits ? `+${digits}` : '';
}

/**
 * On its way up — the session is starting or signing in — rather than down: said as "connecting", not as a fault
 * (#176: a number read "not connected · Starting the session" while its messages kept arriving).
 */
export function isConnecting(a: Pick<WaAccount, 'status'>): boolean {
  return a.status === 'connecting' || a.status === 'authenticating';
}

/**
 * Where a number stands, as the rail's status dot says it (worksuite-desktop#155): green connected, orange on its way
 * (waiting for its QR code to be scanned, starting, signing in), red down (unlinked, expired, failing).
 */
export type NumberTone = 'connected' | 'waiting' | 'down';

export function numberState(a: Pick<WaAccount, 'status'>): { tone: NumberTone; label: string } {
  if (isConnected(a)) return { tone: 'connected', label: 'Connected' };
  if (a.status === 'qr_required' || a.status === 'setup') return { tone: 'waiting', label: 'Waiting for scan' };
  if (isConnecting(a)) return { tone: 'waiting', label: 'Connecting' };
  // A link that failed says so ("Error", with its reason beside it), rather than reading as merely not connected (#323).
  if (a.status === 'error') return { tone: 'down', label: 'Error' };
  return { tone: 'down', label: 'Not connected' };
}

/** A number as its tooltip names it: "Support · +94 77 123 4567". */
export function numberName(a: Pick<WaAccount, 'name' | 'phone'>): string {
  const e164 = toE164(a.phone);
  const phone = e164 ? formatPhone(e164) : (a.phone ?? '').trim();
  return phone ? `${a.name} · ${phone}` : a.name;
}

/**
 * The number the WhatsApp list shows (0: all of them), chosen on the channel rail or in the list's header. Kept for
 * the session only: opening WhatsApp again starts on every number.
 */
export const waNumber = createStore<{ id: number }>({ id: 0 });

/** A refusal is an answer, not a fault: somebody without WhatsApp is not asked again every few seconds. */
const refused = (e: unknown) => e instanceof ApiError && (e.forbidden || e.status === 404);

/** While pushed changes arrive, the checks behind them only catch what a push missed. */
const LIVE_POLL_MS = 60_000;

/** Whether the realtime socket is up, so WhatsApp changes arrive as they happen. */
export function useWaPushed(): boolean {
  return useStore(app, (s) => s.status?.realtime === 'connected');
}

export function useWaAccounts(enabled: boolean) {
  const pushed = useWaPushed();
  return useLocalFirstQuery<{ accounts: WaAccount[]; default_id: number | null }>({ queryKey: ['whatsapp', 'accounts'], path: `${WA}/accounts`, enabled, interval: pushed ? LIVE_POLL_MS : 30_000 });
}

export function useWaChats(params: { account: number; scope: WaScope; q: string }, enabled: boolean) {
  const pushed = useWaPushed();
  const q = params.q.trim();
  return useLocalFirstQuery<{ chats: WaChat[]; total: number }>({
    queryKey: ['whatsapp', 'chats', params.account, params.scope, q], path: `${WA}/chats`,
    params: { scope: params.scope, per_page: '60', ...(params.account ? { account_id: String(params.account) } : {}), ...(q ? { q } : {}) },
    enabled, interval: pushed ? LIVE_POLL_MS : 15_000,
  });
}

/** One conversation: what is held, then only what changed since (`since=`), merged in. */
export async function fetchWaThread(id: string, held: WaThread | undefined, signal?: AbortSignal): Promise<WaThread> {
  const path = `${WA}/chats/${id}`;
  if (held?.cursor) {
    const delta = await apiGet<WaThread>(path, { since: held.cursor }, signal);
    // A delta that may have been cut short is not trusted: the conversation is loaded in full.
    if (!delta.delta || delta.messages.length < WA_DELTA_LIMIT) return mergeWaThread(held, delta);
  }
  return mergeWaThread(held, await apiGet<WaThread>(path, undefined, signal));
}

export function useWaThread(id: string) {
  const pushed = useWaPushed();
  return useLocalFirstQuery<WaThread>({ queryKey: ['whatsapp', 'chat', id], path: `${WA}/chats/${id}`, interval: pushed ? LIVE_POLL_MS : 5_000, fetch: (signal, held) => fetchWaThread(id, held, signal) });
}

/** The page of messages before the earliest one held, put in front of the conversation. */
export async function loadOlderWa(qc: QueryClient, id: string): Promise<void> {
  const [entry] = qc.getQueriesData<WaThread>({ queryKey: ['whatsapp', 'chat', id] });
  const held = entry?.[1];
  if (!entry || !held?.next_before) return;
  const page = await apiGet<WaThread>(`${WA}/chats/${id}`, { before: String(held.next_before) });
  qc.setQueryData<WaThread>(entry[0], (d) => (d ? prependWaPage(d, page) : d));
}

interface WaPush { type?: string; event?: string; account_id?: number; chat_id?: number }

/**
 * WhatsApp changes pushed over the realtime socket (the main process passes each on as `realtime:event`): a message
 * refreshes its conversation at once — only what changed — and the list a moment later; a number's connection
 * refreshes the numbers. When the socket comes back, everything catches up, since pushes may have been missed.
 */
export function useWaLive(enabled: boolean): void {
  const qc = useQueryClient();
  const pushed = useWaPushed();
  const was = useRef(pushed);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const lists = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; void qc.invalidateQueries({ queryKey: ['whatsapp', 'chats'] }); }, 400);
    };
    const off = on<WaPush>('realtime:event', (e) => {
      if (e?.type !== 'whatsapp' || typeof e.event !== 'string') return;
      if (e.event.startsWith('whatsapp.connection.')) { void qc.invalidateQueries({ queryKey: ['whatsapp', 'accounts'] }); return; }
      if (e.chat_id) void qc.invalidateQueries({ queryKey: ['whatsapp', 'chat', String(e.chat_id)] });
      lists();
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [enabled, qc]);
  useEffect(() => {
    if (enabled && pushed && !was.current) void qc.invalidateQueries({ queryKey: ['whatsapp'] });
    was.current = pushed;
  }, [enabled, pushed, qc]);
}

/** A new id for a message about to be sent. */
export function newClientId(): string {
  try { return crypto.randomUUID(); } catch { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; }
}

export function sendWa(chatId: number | string, text: string, replyTo?: string, clientId?: string) {
  return apiPost<{ ok: boolean; error?: string; message?: WaMessage; duplicate?: boolean }>(`${WA}/chats/${chatId}/messages`, { kind: 'text', text, ...(replyTo ? { reply_to: replyTo } : {}), ...(clientId ? { client_message_id: clientId } : {}) });
}

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/**
 * A message shown the moment it is sent: it appears as "Sending", becomes the server's copy when that lands, or
 * stays as "Not sent" with a retry that reuses its id, so the server never sends it twice.
 */
export async function sendWaNow(qc: QueryClient, chatId: number | string, text: string, replyTo: string | undefined, senderName: string | null, clientId = newClientId()): Promise<boolean> {
  const key = { queryKey: ['whatsapp', 'chat', String(chatId)] };
  const update = (fn: (messages: WaMessage[]) => WaMessage[]) => qc.setQueriesData<WaThread>(key, (d) => (d ? { ...d, messages: fn(d.messages) } : d));
  const mine = (m: WaMessage) => m.id < 0 && m.client_message_id === clientId;
  // A check already on its way would answer without this message and wipe it from the screen.
  await qc.cancelQueries(key);
  const existing = qc.getQueriesData<WaThread>(key).some(([, d]) => d?.messages.some(mine));
  if (existing) update((ms) => ms.map((m) => (mine(m) ? { ...m, status: 'queued', error_text: null } : m)));
  else {
    const stamp = now();
    update((ms) => [...ms, {
      id: -Date.now(), external_id: null, direction: 'out', kind: 'text', body: text, caption: null, status: 'queued', error_text: null, sender_name: senderName,
      filename: null, created_at: stamp, sent_at: stamp, reply_to: replyTo ?? null, client_message_id: clientId, pending: { text, replyTo },
    }]);
  }
  try {
    const r = await sendWa(chatId, text, replyTo, clientId);
    if (r.ok === false && !r.message) throw new Error(r.error ?? 'Not sent.');
    if (r.message) {
      const landed = { ...r.message, client_message_id: clientId };
      update((ms) => mergeWaThread({ messages: ms }, { messages: [landed], delta: true }).messages);
    }
    void qc.invalidateQueries({ queryKey: ['whatsapp', 'chats'] });
    return r.ok !== false;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    update((ms) => ms.map((m) => (mine(m) ? { ...m, status: 'failed', error_text: why } : m)));
    return false;
  }
}

/** React to a message as this number (an empty emoji takes the reaction away). */
export function reactWa(messageId: number, emoji: string) {
  return apiPost<{ reactions: NonNullable<WaMessage['reactions']> }>(`${WA}/messages/${messageId}/react`, { emoji });
}

/** Fetch a message's picture, video or file again when it was not kept the first time. */
export function refetchWaMedia(messageId: number) {
  return apiPost<{ media_status: string; file_id: number }>(`${WA}/messages/${messageId}/media`, {});
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

export interface WaEngines { default: string | null; engines: Array<{ id: string; label: string; available: boolean }> }

/** The engines a WhatsApp Web number can run on here: whatsapp-web.js (a browser) or Baileys (no browser). */
export function useWaEngines(enabled: boolean) {
  return useQuery({
    queryKey: ['whatsapp', 'engines'],
    queryFn: ({ signal }) => apiGet<WaEngines>(`${WA}/engines`, undefined, signal),
    enabled,
    staleTime: 5 * 60_000,
    retry: (n, e) => !refused(e) && n < 1,
  });
}

/** Move a number to the other engine: unlinked from the one it leaves, it is linked once more on the new one. */
export const moveWaEngine = (id: number, engine: string) => apiPost<{ ok: boolean; changed: boolean }>(`${WA}/accounts/${id}/engine`, { engine });

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
