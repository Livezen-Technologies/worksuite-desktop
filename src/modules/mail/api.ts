import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, apiPost, apiPut, withMailbox } from '../../core/api';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import type { OfflineMutation } from '@shared/types';
import { queueKey, type QueuedAction } from './model';
import { useLocalFirst } from './localFirst';
import type { Folder, Label, LocalMailbox, MailPrefs, Mailbox, MessageContext, MessageRef, OutboxRow, SignaturesData, SyncStatus, Template, ViewCounts } from './types';

/**
 * Mail's server calls. Reads go through the API proxy, which answers from the
 * offline cache when WorkSuite cannot be reached (the mailboxes, folders, lists
 * and messages are cached; see the registry). Changes to a message go through
 * the offline queue: they are sent now, or queued and sent in order when the
 * connection returns — and can be undone while they wait.
 */

export const mailKeys = {
  all: ['mail'] as const,
  mailboxes: ['mail', 'mailboxes'] as const,
  views: ['mail', 'views'] as const,
  folders: (box: number) => ['mail', 'folders', box] as const,
  labels: ['mail', 'labels'] as const,
  sync: ['mail', 'sync'] as const,
  prefs: ['mail', 'prefs'] as const,
  pending: ['offline', 'pending', 'mail'] as const,
  localStore: ['mail', 'local-store'] as const,
};

export function useMailboxes() {
  // Cached first (worksuite-desktop#162): the accounts show from this computer before the server answers.
  useLocalFirst(mailKeys.mailboxes, { path: '/api/mail/mailboxes' });
  return useQuery({ queryKey: mailKeys.mailboxes, queryFn: () => apiGet<{ mailboxes: Mailbox[] }>('/api/mail/mailboxes'), staleTime: 5 * 60_000 });
}

/** The sidebar's numbers. An older server has no such call: then there are none, not zeros. */
export function useViewCounts(enabled: boolean) {
  useLocalFirst(mailKeys.views, enabled ? { path: '/api/mail/views' } : null);
  return useQuery({
    queryKey: mailKeys.views,
    queryFn: async () => {
      try {
        return await apiGet<ViewCounts>('/api/mail/views');
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
}

export function useFolders(box: number, enabled: boolean) {
  useLocalFirst(mailKeys.folders(box), enabled ? { path: '/api/mail/folders', query: { mailbox: box } } : null);
  return useQuery({ queryKey: mailKeys.folders(box), queryFn: () => apiGet<{ folders: Folder[] }>('/api/mail/folders', { mailbox: box }), enabled, staleTime: 60_000 });
}

export function useLabels(enabled: boolean) {
  return useQuery({ queryKey: mailKeys.labels, queryFn: () => apiGet<{ labels: Label[] }>('/api/mail/labels'), enabled, staleTime: 5 * 60_000 });
}

export function useSyncStatus(enabled: boolean) {
  return useQuery({ queryKey: mailKeys.sync, queryFn: () => apiGet<SyncStatus>('/api/mail/sync/status'), enabled, staleTime: 15_000, refetchInterval: 30_000 });
}

/** How this person lays the list out (server-kept, so it follows them to every computer). */
export function useMailPrefs() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: mailKeys.prefs,
    queryFn: async () => (await apiGet<{ prefs: MailPrefs | unknown[] }>('/api/mail/prefs')).prefs,
    staleTime: 10 * 60_000,
  });
  // An empty JSON object comes back from PHP as a list.
  const prefs: MailPrefs = q.data && !Array.isArray(q.data) ? q.data : {};
  const save = useMutation({
    mutationFn: (patch: Partial<MailPrefs>) => apiPut<{ prefs: MailPrefs }>('/api/mail/prefs', patch),
    onMutate: (patch) => {
      qc.setQueryData(mailKeys.prefs, { ...prefs, ...patch });
    },
  });
  return { prefs, loaded: q.isFetched, set: (patch: Partial<MailPrefs>) => save.mutate(patch) };
}

/** Mail's changes waiting in the offline queue. */
export function usePendingMail() {
  return useQuery({
    queryKey: mailKeys.pending,
    queryFn: async () => {
      try {
        return (await call('offline:pending')).filter((m: OfflineMutation) => m.module === 'mail');
      } catch {
        return [] as OfflineMutation[];
      }
    },
    staleTime: 5_000,
  });
}

/**
 * What Mail keeps on this computer, by kind and by mailbox, and the organization's limit (D04, D09).
 * `live`: refreshed every few seconds while bodies are downloading, else every half minute (#190).
 */
export function useMailStats(enabled = true, live = false) {
  return useQuery({
    queryKey: [...mailKeys.localStore, 'stats'],
    queryFn: async () => {
      try {
        return await call('offline:mailStats');
      } catch {
        return null;
      }
    },
    enabled,
    staleTime: live ? 2_000 : 60_000,
    refetchInterval: live ? (q) => (Object.values(q.state.data?.bodies ?? {}).some((b) => b.running) ? 3_000 : 30_000) : false,
  });
}

/** How much mail this computer keeps (the offline cache's mail answers); `live` keeps it current while Settings is open (#190). */
export function useLocalStore(live = false) {
  return useQuery({
    queryKey: mailKeys.localStore,
    queryFn: async () => {
      try {
        return await call('offline:moduleBytes', { module: 'mail' });
      } catch {
        return null;
      }
    },
    staleTime: live ? 2_000 : 60_000,
    refetchInterval: live ? 10_000 : false,
  });
}

export function useMessageContext(ref: MessageRef | null, email: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['mail', 'context', ref?.mailbox ?? null, ref?.folder ?? '', ref?.uid ?? ''],
    queryFn: () => apiGet<MessageContext>(`/api/mail/messages/${ref!.uid}/context`, withMailbox({ folder: ref!.folder, ...(email ? { email } : {}) }, ref!.mailbox)),
    enabled: enabled && !!ref,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useOutbox(enabled: boolean) {
  return useQuery({ queryKey: ['mail', 'outbox'], queryFn: () => apiGet<{ messages: OutboxRow[] }>('/api/mail/outbox'), enabled, staleTime: 30_000 });
}

export function useTemplates(enabled: boolean) {
  return useQuery({ queryKey: ['mail', 'templates'], queryFn: () => apiGet<{ templates: Template[] }>('/api/mail/templates'), enabled, staleTime: 5 * 60_000 });
}

/** Quick Parts (DMO-CMP-07): saved snippets inserted by name; none from an older server. */
export function useQuickParts(enabled: boolean) {
  return useQuery({
    queryKey: ['mail', 'quick-parts'],
    queryFn: async () => {
      try {
        return (await apiGet<{ quick_parts: Array<{ id: number; name: string; html: string; org: boolean }> }>('/api/mail/quick-parts')).quick_parts;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return [];
        throw e;
      }
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useSignatures(enabled: boolean) {
  return useQuery({ queryKey: ['mail', 'signatures'], queryFn: () => apiGet<SignaturesData>('/api/mail/signatures'), enabled, staleTime: 5 * 60_000 });
}

export function useLocalMailboxes(enabled: boolean) {
  return useQuery({ queryKey: ['mail', 'local-mailboxes'], queryFn: () => apiGet<{ mailboxes: LocalMailbox[] }>('/api/mail/local-mailboxes'), enabled, staleTime: 30_000 });
}

export function useOAuthProviders(enabled: boolean) {
  return useQuery({ queryKey: ['mail', 'oauth-providers'], queryFn: () => apiGet<{ providers: string[] }>('/api/mail/oauth/providers'), enabled, staleTime: 5 * 60_000 });
}

/** What happened to a change: done now, or waiting in the queue. */
export type Outcome = 'done' | 'queued';

/**
 * A change through the offline queue, or straight to the server where there is
 * no desktop shell (tests, a plain browser). A refusal throws.
 */
async function submit(input: { entity: string; entityId: string | null; label: string; path: string; body: Record<string, unknown> }): Promise<Outcome> {
  return (await submitFull(input)).outcome;
}

/** Why a change was refused, as the server says (worksuite-desktop#235): permission, connection, quota or the server's. */
export type FailReason = 'permission' | 'connection' | 'quota' | 'server';

/** A refused change, with the reason a person can act on. */
export class MailActionError extends Error {
  constructor(
    message: string,
    readonly reason: FailReason,
    readonly status: number | null,
    /** The server's own code and answer, for a refusal that says more (a send blocked by protection, P-UI-15). */
    readonly code: string | null = null,
    readonly data: unknown = null,
  ) {
    super(message);
    this.name = 'MailActionError';
  }
}

function reasonOf(status: number | null, data: unknown, code: string | null): FailReason {
  const d = (data ?? {}) as { errors?: { reason?: unknown } | null; reason?: unknown };
  const r = d.errors?.reason ?? d.reason;
  if (r === 'permission' || r === 'connection' || r === 'quota' || r === 'server') return r;
  if (status === 403 || code === 'PERMISSION_DENIED') return 'permission';
  if (status === null || status === 502 || status === 503 || status === 504 || code === 'NETWORK_UNREACHABLE') return 'connection';
  return 'server';
}

/** As `submit`, with the server's answer and the queue's id for a change that waits. */
async function submitFull(input: { entity: string; entityId: string | null; label: string; path: string; body: Record<string, unknown> }): Promise<{ outcome: Outcome; data: unknown; queueId: string | null }> {
  let r: Awaited<ReturnType<typeof call<'offline:submit'>>>;
  try {
    r = await call('offline:submit', { module: 'mail', method: 'POST', queueIfOffline: true, ...input, label: input.label.slice(0, 200) });
  } catch (e) {
    if ((e as { code?: string }).code !== 'UNSUPPORTED') throw e;
    try {
      return { outcome: 'done', data: await apiPost(input.path, input.body), queueId: null };
    } catch (err) {
      if (err instanceof ApiError) throw new MailActionError(err.message, reasonOf(err.status, err.data, err.code), err.status, err.code, err.data);
      throw err;
    }
  }
  if (r.queued) return { outcome: 'queued', data: null, queueId: r.id };
  if (!r.delivered) throw new MailActionError(r.error ?? text('The mail server did not make that change.'), reasonOf(r.status, r.data, r.code), r.status, r.code, r.data);
  return { outcome: 'done', data: r.data, queueId: null };
}

const ACTION_LABELS: Record<string, string> = {
  archive: 'Archive “{subject}”',
  trash: 'Delete “{subject}”',
  spam: 'Report “{subject}” as spam',
  read: 'Mark “{subject}” as read',
  unread: 'Mark “{subject}” as unread',
  star: 'Star “{subject}”',
  unstar: 'Unstar “{subject}”',
  important: 'Mark “{subject}” as important',
  unimportant: 'Mark “{subject}” as not important',
  inbox: 'Move “{subject}” to the inbox',
};

export type MessageActionName = 'archive' | 'trash' | 'spam' | 'read' | 'unread' | 'star' | 'unstar' | 'important' | 'unimportant' | 'inbox';

export function messageAction(ref: MessageRef, action: MessageActionName, subject: string): Promise<Outcome> {
  return submit({
    entity: `message.${action}`,
    entityId: queueKey(ref.mailbox, ref.folder, ref.uid),
    label: text(ACTION_LABELS[action] ?? action, { subject: subject || text('(no subject)') }),
    path: `/api/mail/messages/${ref.uid}/action`,
    body: { action, folder: ref.folder, ...(ref.mailbox ? { mailbox: ref.mailbox } : {}) },
  });
}

/** A message to delete or bring back, by its whole identity (worksuite-desktop#209, #235). */
export interface RemoveItem {
  uid: number;
  uidvalidity?: number;
  message_id?: string;
  mid_hash?: string;
  /** Undo: the UID the delete answered with in the Trash. */
  trash_uid?: number;
}

/** What became of one: trashed, deleted (for good), gone (not on the server — already deleted), restored, or failed. */
export interface RemoveResult {
  folder: string;
  uid: number;
  status: 'trashed' | 'deleted' | 'gone' | 'restored' | 'failed';
  reason?: FailReason;
  response?: string;
  at?: { folder: string; uid: number };
}

export interface RemoveAnswer {
  outcome: Outcome;
  results: RemoveResult[];
  /** The queue's id while it waits offline (Undo withdraws it). */
  queueId: string | null;
}

/** The identity of a listed message, for a delete or its Undo. */
export function removeItem(row: { id: number | string; uidvalidity?: number | null; message_id?: string | null; message_id_hash?: string | null }): RemoveItem {
  return {
    uid: Number(row.id),
    ...(row.uidvalidity ? { uidvalidity: row.uidvalidity } : {}),
    ...(row.message_id ? { message_id: row.message_id } : row.message_id_hash ? { mid_hash: row.message_id_hash } : {}),
  };
}

/**
 * Delete messages of ONE folder in one account, in one request (a UID set at the server): to the account's Trash,
 * or for good in the Trash itself. Through the change queue, so offline it waits. Each message is answered on its
 * own; a refusal of the whole request throws a MailActionError with its reason.
 */
export async function removeMessages(group: { mailbox: string | null; folder: string; items: RemoveItem[] }, permanent: boolean, label: string): Promise<RemoveAnswer> {
  const one = group.items.length === 1 ? group.items[0]! : null;
  const r = await submitFull({
    entity: 'message.trash' satisfies `message.${QueuedAction}`,
    entityId: one ? queueKey(group.mailbox, group.folder, one.uid) : null,
    label,
    path: '/api/mail/messages/remove',
    body: { folder: group.folder, items: group.items, ...(permanent ? { permanent: true } : {}), ...(group.mailbox ? { mailbox: group.mailbox } : {}) },
  });
  const results = ((r.data as { results?: RemoveResult[] } | null)?.results ?? []).filter((x) => x && typeof x === 'object');
  return { outcome: r.outcome, results, queueId: r.queueId };
}

/** Undo a delete: the messages back from the Trash into `folder`. */
export async function restoreMessages(group: { mailbox: string | null; folder: string; items: RemoveItem[] }, label: string): Promise<RemoveAnswer> {
  const r = await submitFull({
    entity: 'message.move' satisfies `message.${QueuedAction}`,
    entityId: null,
    label,
    path: '/api/mail/messages/restore',
    body: { items: group.items.map((i) => ({ ...i, folder: group.folder })), ...(group.mailbox ? { mailbox: group.mailbox } : {}) },
  });
  const results = ((r.data as { results?: RemoveResult[] } | null)?.results ?? []).filter((x) => x && typeof x === 'object');
  return { outcome: r.outcome, results, queueId: r.queueId };
}

/**
 * Junk or Not junk with training (ENH-MAIL-04 MPR-UX-06, MPR-TRN): `POST messages/{id}/junk` and `/not-junk` move
 * the message in its own account and teach the filter. Through the offline queue like any move. An older server
 * without them (404) gets the plain move it always had. Not junk answers whether to offer "Always trust sender";
 * on malware or phishing the server refuses it (422 "Request review instead") and that refusal is thrown.
 */
export async function junkMessage(ref: MessageRef, kind: 'junk' | 'not_junk', subject: string): Promise<{ outcome: Outcome; offerTrust: boolean }> {
  const what = subject || text('(no subject)');
  try {
    const r = await submitFull({
      entity: kind === 'junk' ? 'message.spam' : 'message.inbox',
      entityId: queueKey(ref.mailbox, ref.folder, ref.uid),
      label: kind === 'junk' ? text('Mark “{subject}” as junk', { subject: what }) : text('Mark “{subject}” as not junk', { subject: what }),
      path: `/api/mail/messages/${ref.uid}/${kind === 'junk' ? 'junk' : 'not-junk'}`,
      body: { folder: ref.folder, ...(ref.mailbox ? { mailbox: ref.mailbox } : {}) },
    });
    return { outcome: r.outcome, offerTrust: !!(r.data as { offer_trust_sender?: boolean } | null)?.offer_trust_sender };
  } catch (e) {
    if (e instanceof MailActionError && e.status === 404) return { outcome: await messageAction(ref, kind === 'junk' ? 'spam' : 'inbox', subject), offerTrust: false };
    throw e;
  }
}

/** Move to a folder by its slug or path. */
export function moveMessage(ref: MessageRef, to: string, toName: string, subject: string): Promise<Outcome> {
  return submit({
    entity: 'message.move' satisfies `message.${QueuedAction}`,
    entityId: queueKey(ref.mailbox, ref.folder, ref.uid),
    label: text('Move “{subject}” to {folder}', { subject: subject || text('(no subject)'), folder: toName }),
    path: '/api/mail/folders-tree/move',
    body: { from: ref.folder, to: to.replace(/^label:/, ''), uids: [Number(ref.uid)], ...(ref.mailbox ? { mailbox: ref.mailbox } : {}) },
  });
}

/** A label on or off a message kept in WorkSuite's own store. */
export async function setLabel(uid: string, labelId: number, on: boolean): Promise<void> {
  await apiPost(`/api/mail/messages/${uid}/label`, { label_id: labelId, on });
}

/** Send now (queued when offline) — the same body the server's send takes. */
export async function sendMessage(body: Record<string, unknown>, label: string): Promise<Outcome> {
  return submit({ entity: 'message.send', entityId: null, label, path: '/api/mail/send', body });
}

export type StateAction = 'pin' | 'unpin' | 'snooze' | 'unsnooze' | 'flag' | 'unflag' | 'complete' | 'focus' | 'categorise' | 'uncategorise';

const STATE_LABELS: Record<StateAction, string> = {
  pin: 'Pin {what}',
  unpin: 'Unpin {what}',
  snooze: 'Snooze {what}',
  unsnooze: 'Unsnooze {what}',
  flag: 'Flag {what}',
  unflag: 'Clear the flag on {what}',
  complete: 'Mark {what} complete',
  focus: 'Move {what} to another tab',
  categorise: 'Categorise {what}',
  uncategorise: 'Remove a category from {what}',
};

/**
 * Pin, snooze, flag, Focused and categories on one or more messages
 * (POST api/mail/states) — through the offline queue, so they work offline
 * and go in order when the connection returns (DMO-OFF-03, AC-DMO-12).
 */
export function stateAction(action: StateAction, items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}, subject = ''): Promise<Outcome> {
  const what = items.length === 1 ? `“${subject || text('(no subject)')}”` : text('{n} messages', { n: items.length });
  return submit({
    entity: `state.${action}`,
    entityId: items.length === 1 ? `${String(items[0]!.mailbox ?? 0)}:${String(items[0]!.folder)}:${String(items[0]!.uid)}`.slice(0, 128) : null,
    label: text(STATE_LABELS[action], { what }),
    path: '/api/mail/states',
    body: { action, items, ...extra },
  });
}

/** Withdraw a change that has not gone yet. */
export async function undoQueued(id: string): Promise<void> {
  await call('offline:discard', { id });
}

/** A folder's right-click menu (worksuite-desktop#162): the calls that change a folder. */
export type FolderOp = 'read-all' | 'create' | 'rename' | 'move' | 'delete';

const FOLDER_LABELS: Record<FolderOp, string> = {
  'read-all': 'Mark everything in {folder} as read',
  create: 'Create the folder {name}',
  rename: 'Rename {folder} to {name}',
  move: 'Move the folder {folder}',
  delete: 'Delete the folder {folder}',
};

/**
 * A change to a folder of a connected mailbox, by its slug — through the
 * offline queue, so it is made now or when the connection returns, in order
 * with the other changes, and can be undone while it waits.
 */
export function folderOp(op: FolderOp, mailbox: number, folder: string, folderLabel: string, extra: Record<string, unknown> = {}): Promise<Outcome> {
  return submit({
    entity: `folder.${op}`,
    entityId: `${mailbox}:${folder}`.slice(0, 128),
    label: text(FOLDER_LABELS[op], { folder: folderLabel, name: String(extra.name ?? '') }),
    path: `/api/mail/folder-ops/${op}`,
    body: { mailbox, folder, ...extra },
  });
}

/** Core folders are never renamed, moved or deleted (the server refuses them too). */
export const CORE_FOLDERS = ['inbox', 'sent', 'drafts', 'trash', 'spam', 'junk', 'archive', 'outbox', 'starred', 'important'];

export function isCoreFolder(slug: string): boolean {
  if (CORE_FOLDERS.includes(slug.toLowerCase())) return true;
  if (!slug.startsWith('label:')) return true;
  const path = slug.slice(6).toUpperCase();
  return path === '' || path === '[GMAIL]' || path.startsWith('[GMAIL]/') || ['SENT ITEMS', 'SENT MESSAGES', 'JUNK E-MAIL', 'DELETED ITEMS', 'DELETED MESSAGES'].includes(path);
}

/** Only Deleted Items and Junk are emptied. */
export function isEmptyableFolder(slug: string): boolean {
  return ['trash', 'spam', 'junk'].includes(slug.toLowerCase());
}

/**
 * Empty Deleted Items or Junk: permanently, a batch per call until none are left.
 * Online only — a permanent delete is not something to leave waiting in a queue.
 */
export async function emptyFolder(mailbox: number, folder: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  let done = 0;
  for (let i = 0; i < 1000; i++) {
    const r = await apiPost<{ deleted: number; remaining: number; total: number }>('/api/mail/folder-ops/empty', { mailbox, folder });
    done += r.deleted;
    onProgress?.(done, done + r.remaining);
    if (r.remaining === 0 || r.deleted === 0) break;
  }
  return done;
}

/** Sync one folder now: it is walked first on a pass that runs now. */
export async function syncFolder(mailbox: number, folder: string): Promise<void> {
  await apiPost('/api/mail/folder-ops/sync', { mailbox, folder });
}

export interface FolderInfo {
  folder: string;
  account: string;
  messages: number | null;
  unread: number | null;
  bytes: number | null;
  /** The size counts only what the server's copy holds of the folder. */
  bytes_partial: boolean;
  synced_at: string | null;
  source: 'mirror' | 'server';
}

/** A folder's size, counts and last sync; null from a server without the call. */
export function useFolderInfo(mailbox: number, folder: string, enabled: boolean) {
  return useQuery({
    queryKey: ['mail', 'folder-info', mailbox, folder],
    queryFn: async () => {
      try {
        return await apiGet<FolderInfo>('/api/mail/folder-ops/properties', { mailbox, folder });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}
