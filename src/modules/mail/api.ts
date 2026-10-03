import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, apiPost, apiPut, withMailbox } from '../../core/api';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import type { OfflineMutation } from '@shared/types';
import { queueKey, type QueuedAction } from './model';
import { useLocalFirst } from './localFirst';
import type { Folder, Label, LocalMailbox, MailPrefs, Mailbox, MessageContext, MessageRef, OutboxRow, Signature, SyncStatus, Template, ViewCounts } from './types';

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

/** What Mail keeps on this computer, by kind and by mailbox, and the organization's limit (D04, D09). */
export function useMailStats(enabled = true) {
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
    staleTime: 60_000,
  });
}

/** How much mail this computer keeps (the offline cache's mail answers). */
export function useLocalStore() {
  return useQuery({
    queryKey: mailKeys.localStore,
    queryFn: async () => {
      try {
        return await call('offline:moduleBytes', { module: 'mail' });
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
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
  return useQuery({ queryKey: ['mail', 'signatures'], queryFn: () => apiGet<{ signatures: Signature[] }>('/api/mail/signatures'), enabled, staleTime: 5 * 60_000 });
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
  let r: Awaited<ReturnType<typeof call<'offline:submit'>>>;
  try {
    r = await call('offline:submit', { module: 'mail', method: 'POST', queueIfOffline: true, ...input, label: input.label.slice(0, 200) });
  } catch (e) {
    if ((e as { code?: string }).code !== 'UNSUPPORTED') throw e;
    await apiPost(input.path, input.body);
    return 'done';
  }
  if (r.queued) return 'queued';
  if (!r.delivered) throw new Error(r.error ?? text('The mail server did not make that change.'));
  return 'done';
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
