import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, apiPost, apiPut, withMailbox } from '../../core/api';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import type { OfflineMutation } from '@shared/types';
import { queueKey, type QueuedAction } from './model';
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
  return useQuery({ queryKey: mailKeys.mailboxes, queryFn: () => apiGet<{ mailboxes: Mailbox[] }>('/api/mail/mailboxes'), staleTime: 5 * 60_000 });
}

/** The sidebar's numbers. An older server has no such call: then there are none, not zeros. */
export function useViewCounts(enabled: boolean) {
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

/** Withdraw a change that has not gone yet. */
export async function undoQueued(id: string): Promise<void> {
  await call('offline:discard', { id });
}
