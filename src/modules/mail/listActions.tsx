import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { dismissKey, toast } from '../../core/toasts';
import type { MenuItem, MenuSection } from '../../components/Menu';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { MailActionError, mailKeys, messageAction, moveMessage, removeItem, removeMessages, restoreMessages, undoQueued, useFolders, type FailReason, type MessageActionName, type Outcome, type RemoveAnswer } from './api';
import { slugRole } from './allAccounts';
import type { Target } from './MessageMenus';
import { folderName } from './model';
import { sendAfterUndoWindow } from './outgoing';
import type { Folder, Mailbox, MessageRef } from './types';

/**
 * What can be done to messages from the list (worksuite-desktop#161): one
 * source for the row's hover buttons, the right-click menu, the selection's
 * toolbar and the keyboard, so all of them behave the same.
 *
 * A message that leaves the folder (Archive, Delete, Junk, Restore, Move)
 * leaves the list at once with "Archived · Undo" for a few seconds; only then
 * is the change sent — to the message's own account, through the offline
 * queue, so offline it waits in Waiting to send and the status bar counts it.
 * If the server refuses, the message comes back with the reason and Retry.
 * Read, unread and star are sent at once. Delete permanently asks first and
 * has no Undo.
 */

export type ListActionId = 'archive' | 'delete' | 'deleteForever' | 'restore' | 'junk' | 'notJunk' | 'move' | 'read' | 'unread' | 'star' | 'unstar';

interface Spec {
  label: string;
  icon: string;
  /** What the Undo pill and the toasts say happened. */
  past: string;
  server: MessageActionName;
  removes: boolean;
  danger?: boolean;
}

export const LIST_ACTIONS: Record<ListActionId, Spec> = {
  archive: { label: 'Archive', icon: 'archive', past: 'Archived', server: 'archive', removes: true },
  delete: { label: 'Delete', icon: 'trash', past: 'Deleted', server: 'trash', removes: true },
  deleteForever: { label: 'Delete permanently', icon: 'trash', past: 'Deleted permanently', server: 'trash', removes: true, danger: true },
  restore: { label: 'Restore', icon: 'undo', past: 'Restored to the Inbox', server: 'inbox', removes: true },
  junk: { label: 'Mark as junk', icon: 'spam', past: 'Moved to Junk', server: 'spam', removes: true },
  notJunk: { label: 'Not junk', icon: 'inbox', past: 'Moved to the Inbox', server: 'inbox', removes: true },
  move: { label: 'Move to folder…', icon: 'folder-input', past: 'Moved', server: 'inbox', removes: true },
  read: { label: 'Mark as read', icon: 'mail-open', past: 'Marked as read', server: 'read', removes: false },
  unread: { label: 'Mark as unread', icon: 'mail', past: 'Marked as unread', server: 'unread', removes: false },
  star: { label: 'Star', icon: 'star', past: 'Starred', server: 'star', removes: false },
  unstar: { label: 'Unstar', icon: 'star', past: 'Unstarred', server: 'unstar', removes: false },
};

/** Where the messages are, as a folder role — the same for all of them, or 'other'. */
export function placeOf(targets: Array<Pick<Target, 'folder'>>): 'trash' | 'junk' | 'archive' | 'other' {
  const roles = new Set(targets.map((t) => slugRole(t.folder)));
  if (roles.size !== 1) return 'other';
  const r = [...roles][0];
  return r === 'trash' || r === 'junk' || r === 'archive' ? r : 'other';
}

/** Organise, by folder: Deleted Items restores or deletes for good; Junk says Not junk. */
export function organiseIds(targets: Array<Pick<Target, 'folder'>>): ListActionId[] {
  const place = placeOf(targets);
  if (place === 'trash') return ['restore', 'deleteForever', 'move'];
  if (place === 'junk') return ['notJunk', 'delete', 'move'];
  if (place === 'archive') return ['delete', 'move', 'junk'];
  return ['archive', 'delete', 'move', 'junk'];
}

/** Read or unread, star or unstar: what the messages are not yet. */
export function statusIds(targets: Target[]): ListActionId[] {
  return [targets.some((t) => !t.row.is_read) ? 'read' : 'unread', targets.every((t) => t.row.is_starred) ? 'unstar' : 'star'];
}

/** The row's hover buttons, right of the row in place of its time. */
export function hoverIds(t: Target): Array<ListActionId | 'snooze'> {
  const place = placeOf([t]);
  const read: ListActionId = t.row.is_read ? 'unread' : 'read';
  if (place === 'trash') return ['restore', 'deleteForever', read];
  if (place === 'junk') return ['notJunk', 'delete', read];
  return [place === 'archive' ? 'junk' : 'archive', 'delete', read, 'snooze', t.row.is_starred ? 'unstar' : 'star'];
}

/** "Archive", or "Archive 12" with several. */
export function actionLabel(id: ListActionId, n = 1): string {
  const base = text(LIST_ACTIONS[id].label);
  return n > 1 && id !== 'move' ? `${base} ${n}` : base;
}

const refOf = (t: Target): MessageRef => ({ uid: String(t.row.id), folder: t.folder, mailbox: t.mailbox });

/** At most this many in one request (the server's limit); a folder's selection goes in pieces of this. */
export const DELETE_BATCH = 500;

/**
 * The messages by the account and folder each is really in — a combined view's rows each name their own — in
 * pieces of DELETE_BATCH: one request per folder (worksuite-desktop#235).
 */
export function byFolder(targets: Target[]): Target[][] {
  const groups = new Map<string, Target[]>();
  for (const t of targets) {
    const k = `${t.mailbox ?? ''}\u0000${t.folder}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: Target[][] = [];
  for (const g of groups.values()) for (let i = 0; i < g.length; i += DELETE_BATCH) out.push(g.slice(i, i + DELETE_BATCH));
  return out;
}

/** What a failed delete says, by its reason. */
export function reasonText(r: FailReason): string {
  if (r === 'permission') return text('You don’t have permission to delete in this mailbox');
  if (r === 'connection') return text('The mail server could not be reached');
  if (r === 'quota') return text('The mailbox is full');
  return text('The mail server refused it');
}

/** The sidebar's numbers move with the rows: the folder's total and unread, the account's unread, the Trash. */
function moveCounts(qc: QueryClient, targets: Target[], sign: 1 | -1, toTrash: boolean): void {
  const byBox = new Map<string, Target[]>();
  for (const t of targets) if (t.mailbox) byBox.set(t.mailbox, [...(byBox.get(t.mailbox) ?? []), t]);
  for (const [box, ts] of byBox) {
    qc.setQueryData<{ folders: Folder[] }>(mailKeys.folders(Number(box)), (d) => {
      if (!d?.folders) return d;
      return {
        ...d,
        folders: d.folders.map((f) => {
          const here = ts.filter((t) => t.folder === f.slug);
          const n = here.length;
          const unread = here.filter((t) => !t.row.is_read).length;
          if (n) return { ...f, total: Math.max(0, f.total + sign * n), unread: Math.max(0, f.unread + sign * unread) };
          if (toTrash && f.slug === 'trash') return { ...f, total: Math.max(0, f.total - sign * ts.filter((t) => t.folder !== 'trash').length) };
          return f;
        }),
      };
    });
    const unreadInbox = ts.filter((t) => t.folder === 'inbox' && !t.row.is_read).length;
    if (unreadInbox) {
      qc.setQueryData<{ mailboxes: Mailbox[] }>(mailKeys.mailboxes, (d) => (d?.mailboxes ? { ...d, mailboxes: d.mailboxes.map((m) => (String(m.id) === box && m.unread !== null ? { ...m, unread: Math.max(0, m.unread + sign * unreadInbox) } : m)) } : d));
    }
  }
}

/** One delete that failed, for the grouped toast and its Details. */
export interface DeleteFailure {
  t: Target;
  reason: FailReason;
  why: string;
}

const DELETED_TOAST = 'mail-deleted';
const FAILED_TOAST = 'mail-delete-failed';

type Dest = { slug: string; name: string };

export interface ListActionsOptions {
  /** The list's key for a message: what is hidden while it waits out its Undo. */
  keyOf: (t: Target) => string;
  setHidden: Dispatch<SetStateAction<ReadonlySet<string>>>;
  /** Archive into the message's own account; an account without an Archive folder asks once (null: cancelled). */
  archiveTo?: (ref: MessageRef) => Promise<Dest | 'default' | null> | 'default';
  /** Messages just taken out of the list (the open one moves on to the next). */
  onRemoved?: (keys: string[]) => void;
  /** Seconds of Undo. */
  undoSeconds?: number;
}

export function useListActions(o: ListActionsOptions): { run: (id: ListActionId, targets: Target[], to?: Dest) => Promise<void>; dialog: ReactNode } {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Target[] | null>(null);
  const show = (keys: string[]) =>
    o.setHidden((h) => {
      if (!keys.some((k) => h.has(k))) return h;
      const next = new Set(h);
      for (const k of keys) next.delete(k);
      return next;
    });
  const hide = (keys: string[]) => o.setHidden((h) => new Set([...h, ...keys]));
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['mail'] }), qc.invalidateQueries({ queryKey: ['offline'] })]);

  /*
   * DELETE (worksuite-desktop#235). The rows leave the list at once, the next message opens, the counts move,
   * and ONE toast says "Deleted · Undo" — the deletes of the next few seconds join it ("4 messages deleted").
   * After the Undo window the change goes through the change queue, one request per folder with the messages'
   * whole identity, and the server finds each one: at its UID, else by Message-ID; one on the server nowhere is
   * already deleted and stays gone without a word. A real failure (permission, connection, quota) brings the
   * row back with one grouped error — Retry runs the whole lookup again — and is in the account's sync log.
   */
  const undoBatch = useRef<{ n: number; undo: Array<() => void>; seq: number } | null>(null);
  const failBatch = useRef<{ items: DeleteFailure[]; permanent: boolean } | null>(null);
  const [details, setDetails] = useState<DeleteFailure[] | null>(null);

  const reportFailures = (failures: DeleteFailure[], permanent: boolean) => {
    const prev = failBatch.current && failBatch.current.permanent === permanent ? failBatch.current.items : [];
    const keysNow = new Set(failures.map((f) => o.keyOf(f.t)));
    const items = [...prev.filter((f) => !keysNow.has(o.keyOf(f.t))), ...failures];
    failBatch.current = { items, permanent };
    const one = items.length === 1 ? items[0]! : null;
    const what = one
      ? text('“{subject}” couldn’t be deleted: {why}', { subject: one.t.row.subject || text('(no subject)'), why: reasonText(one.reason) })
      : text('{n} couldn’t be deleted', { n: items.length });
    const retry = { label: text('Retry'), run: () => {
      const again = failBatch.current?.items.map((f) => f.t) ?? [];
      failBatch.current = null;
      void runDelete(again, permanent, true);
    } };
    toast('error', what, retry, undefined, { key: FAILED_TOAST, actions: [{ label: text('Details'), run: () => setDetails(failBatch.current?.items ?? items) }] });
  };

  const announceDeleted = (n: number, undo: () => void) => {
    const batch = undoBatch.current ?? { n: 0, undo: [], seq: 0 };
    batch.n += n;
    batch.undo.push(undo);
    const seq = ++batch.seq;
    undoBatch.current = batch;
    const what = batch.n === 1 ? text('Deleted') : text('{n} messages deleted', { n: batch.n });
    const seconds = o.undoSeconds ?? 5;
    toast('info', what, { label: text('Undo'), run: () => {
      undoBatch.current = null;
      for (const u of batch.undo) u();
    } }, seconds * 1000, { key: DELETED_TOAST });
    // The group ends with its toast: the last delete's window, not the first's.
    setTimeout(() => {
      if (undoBatch.current === batch && batch.seq === seq) undoBatch.current = null;
    }, seconds * 1000);
  };

  /** Send a delete: a request per folder, each answered message by message. */
  const sendDelete = (targets: Target[], permanent: boolean) =>
    Promise.all(
      byFolder(targets).map(async (g): Promise<{ g: Target[]; a?: RemoveAnswer; e?: unknown }> => {
        const label = g.length === 1 ? text('Delete “{subject}”', { subject: g[0]!.row.subject || text('(no subject)') }) : text('Delete {n} messages', { n: g.length });
        try {
          // A Trash (by its role, whatever its name) is emptied for good, never moved into itself.
          return { g, a: await removeMessages({ mailbox: g[0]!.mailbox, folder: g[0]!.folder, items: g.map((t) => removeItem(t.row)) }, permanent || slugRole(g[0]!.folder) === 'trash', label) };
        } catch (e) {
          return { g, e };
        }
      }),
    );

  /** Undo after the delete went: what reached the Trash comes back; what waits in the queue is withdrawn. */
  const undoSent = async (sent: Awaited<ReturnType<typeof sendDelete>>) => {
    const failures: DeleteFailure[] = [];
    for (const s of sent) {
      if (!s.a) continue;
      if (s.a.outcome === 'queued') {
        if (s.a.queueId) await undoQueued(s.a.queueId).catch(() => undefined);
        continue;
      }
      const back = s.g.filter((_, i) => s.a!.results[i]?.status === 'trashed');
      if (!back.length) continue;
      try {
        const r = await restoreMessages({ mailbox: back[0]!.mailbox, folder: back[0]!.folder, items: back.map((t, i) => ({ ...removeItem(t.row), ...(s.a!.results[i]?.at?.folder === 'trash' ? { trash_uid: s.a!.results[i]!.at!.uid } : {}) })) }, text('Undo delete'));
        r.results.forEach((x, i) => x.status === 'failed' && back[i] && failures.push({ t: back[i]!, reason: x.reason ?? 'server', why: x.response ?? '' }));
      } catch (e) {
        for (const t of back) failures.push({ t, reason: e instanceof MailActionError ? e.reason : 'server', why: errorMessage(e) });
      }
    }
    void refresh();
    if (failures.length) toast('error', failures.length === 1 ? text('“{subject}” couldn’t be restored: {why}', { subject: failures[0]!.t.row.subject || text('(no subject)'), why: reasonText(failures[0]!.reason) }) : text('{n} couldn’t be restored', { n: failures.length }));
  };

  async function runDelete(targets: Target[], permanent: boolean, retry = false): Promise<void> {
    if (!targets.length) return;
    const keys = targets.map(o.keyOf);
    hide(keys);
    o.onRemoved?.(keys);
    moveCounts(qc, targets, -1, !permanent);
    if (failBatch.current) {
      // Retried or deleted again: no longer among the failures.
      failBatch.current.items = failBatch.current.items.filter((f) => !keys.includes(o.keyOf(f.t)));
      if (!failBatch.current.items.length) {
        failBatch.current = null;
        dismissKey(FAILED_TOAST);
      }
    }
    let undone = false;
    let sent: Promise<Awaited<ReturnType<typeof sendDelete>>> | null = null;
    const restoreRows = () => {
      undone = true;
      show(keys);
      moveCounts(qc, targets, 1, !permanent);
      if (sent) void sent.then(undoSent);
    };
    const go = async () => {
      if (undone) return;
      sent = sendDelete(targets, permanent);
      const done = await sent;
      if (undone) return;
      const failures: DeleteFailure[] = [];
      let queued = false;
      for (const s of done) {
        if (s.e !== undefined || !s.a) {
          for (const t of s.g) failures.push({ t, reason: s.e instanceof MailActionError ? s.e.reason : 'server', why: errorMessage(s.e) });
          continue;
        }
        if (s.a.outcome === 'queued') {
          queued = true;
          continue;
        }
        s.g.forEach((t, i) => {
          const r = s.a!.results[i];
          if (r?.status === 'failed') failures.push({ t, reason: r.reason ?? 'server', why: r.response ?? '' });
        });
      }
      if (failures.length) {
        show(failures.map((f) => o.keyOf(f.t)));
        moveCounts(qc, failures.map((f) => f.t), 1, !permanent);
      }
      // Said before the list is asked again: offline, that refetch waits for the connection.
      if (failures.length) reportFailures(failures, permanent);
      else if (queued) toast('info', text('Offline — this happens when you reconnect. Undo it in Waiting to send.'));
      void refresh();
    };
    // Delete permanently was confirmed instead, and a Retry was already waited out once: sent now, no Undo.
    if (permanent || retry) {
      if (permanent && !retry) toast('info', targets.length === 1 ? text('Deleted permanently') : text('{n} messages deleted permanently', { n: targets.length }), undefined, undefined, { key: DELETED_TOAST });
      return void go();
    }
    announceDeleted(targets.length, restoreRows);
    setTimeout(() => void go(), (o.undoSeconds ?? 5) * 1000);
  }

  /** Each message in its own account and folder; what failed, and whether any waits offline. */
  const send = async (id: ListActionId, targets: Target[], dests: Map<Target, Dest>) => {
    const spec = LIST_ACTIONS[id];
    const results = await Promise.allSettled(
      targets.map((t): Promise<Outcome> => {
        const ref = refOf(t);
        const to = dests.get(t);
        if (to) return ['archive', 'spam', 'inbox', 'trash'].includes(to.slug) ? messageAction(ref, to.slug as MessageActionName, t.row.subject) : moveMessage(ref, to.slug, to.name, t.row.subject);
        return messageAction(ref, spec.server, t.row.subject);
      }),
    );
    const failed = targets.filter((_, i) => results[i]!.status === 'rejected');
    const why = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    const queued = results.some((r) => r.status === 'fulfilled' && r.value === 'queued');
    return { failed, queued, why: why ? errorMessage(why.reason) : '' };
  };

  // Success says nothing more: the row has already changed, or gone with its Undo.
  const report = (total: number, r: { failed: Target[]; queued: boolean; why: string }, again: (failed: Target[]) => void) => {
    if (r.failed.length) {
      const what = r.failed.length === 1 ? text('“{subject}” was not changed: {why}', { subject: r.failed[0]!.row.subject || text('(no subject)'), why: r.why }) : text('{n} of {total} were not changed: {why}', { n: r.failed.length, total, why: r.why });
      toast('error', what, { label: text('Retry'), run: () => again(r.failed) });
    } else if (r.queued) toast('info', text('Offline — this happens when you reconnect. Undo it in Waiting to send.'));
  };

  const run = async (id: ListActionId, targets: Target[], to?: Dest, confirmed = false): Promise<void> => {
    if (targets.length === 0) return;
    const spec = LIST_ACTIONS[id];
    if (id === 'deleteForever' && !confirmed) return setConfirm(targets);
    // Delete (worksuite-desktop#235). In the Trash it is for good, and asked first.
    if ((id === 'delete' || id === 'deleteForever') && !to) {
      const inTrash = (t: Target) => slugRole(t.folder) === 'trash';
      if (targets.some(inTrash) && !confirmed) return setConfirm(targets);
      return runDelete(targets, targets.every(inTrash));
    }
    const dests = new Map<Target, Dest>();
    let acting = targets;
    if (to) for (const t of targets) dests.set(t, to);
    else if (id === 'move') return;
    // Archive goes to each account's own Archive; an account without one is asked once, and leaving that question leaves its messages alone.
    if (id === 'archive' && o.archiveTo) {
      const byBox = new Map<string, Target[]>();
      for (const t of targets) byBox.set(t.mailbox ?? '', [...(byBox.get(t.mailbox ?? '') ?? []), t]);
      acting = [];
      for (const group of byBox.values()) {
        const asked = o.archiveTo(refOf(group[0]!));
        const where = asked instanceof Promise ? await asked : asked;
        if (where === null) continue;
        if (where !== 'default') for (const t of group) dests.set(t, where);
        acting.push(...group);
      }
      if (acting.length === 0) return;
    }
    if (!spec.removes) {
      const r = await send(id, acting, dests);
      await refresh();
      report(acting.length, r, (failed) => void run(id, failed, to, true));
      return;
    }
    const keys = acting.map(o.keyOf);
    hide(keys);
    o.onRemoved?.(keys);
    const finish = async () => {
      const r = await send(id, acting, dests);
      await refresh();
      // Gone from the server's list by now; a refused one comes back, a queued one shows as waiting.
      show(keys);
      report(acting.length, r, (failed) => void run(id, failed, to, true));
    };
    // Delete permanently was confirmed instead; a Retry was already waited out once.
    if (id === 'deleteForever' || confirmed) return void finish();
    const where = id === 'move' && to ? text('Moved to {folder}', { folder: to.name }) : text(spec.past);
    const label = acting.length === 1 ? `${where} · “${acting[0]!.row.subject || text('(no subject)')}”` : text('{what} · {n} messages', { what: where, n: acting.length });
    sendAfterUndoWindow(label, finish, () => show(keys), o.undoSeconds ?? 5, label, true);
  };

  const dialog = confirm ? (
    <Modal
      title={confirm.length === 1 ? text('Delete this message permanently?') : text('Delete {n} messages permanently?', { n: confirm.length })}
      labelledBy="mail-delete-forever"
      width={420}
      onClose={() => setConfirm(null)}
      footer={
        <>
          <Button onClick={() => setConfirm(null)}>{text('Cancel')}</Button>
          <Button
            variant="danger"
            onClick={() => {
              const ts = confirm;
              setConfirm(null);
              void run('deleteForever', ts, undefined, true);
            }}
          >
            {text('Delete permanently')}
          </Button>
        </>
      }
    >
      <p className="p-5 text-[13.5px] text-ink-2">{text('It is removed from the mail server for good. This cannot be undone.')}</p>
    </Modal>
  ) : null;

  const failed = details ? (
    <Modal title={text('Couldn’t be deleted')} labelledBy="mail-delete-failed" width={520} onClose={() => setDetails(null)}>
      <ul role="list" aria-label={text('Messages not deleted')} className="flex max-h-[360px] flex-col gap-2 overflow-y-auto p-4 text-[13px] scroll-thin">
        {details.map((f) => (
          <li key={o.keyOf(f.t)} className="rounded-[8px] border border-line p-2.5">
            <div className="font-semibold text-ink">{f.t.row.subject || text('(no subject)')}</div>
            <div className="text-ink-2">{reasonText(f.reason)}</div>
            <div className="mt-1 font-mono text-[11.5px] text-ink-3">
              {[f.t.row.mailbox?.email ?? f.t.mailbox ?? '', f.t.folder, `UID ${f.t.row.id}`, f.why].filter(Boolean).join(' · ')}
            </div>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-4 text-[12px] text-ink-3">{text('Each one is in the account’s sync log under Fetch errors, with what the server answered.')}</p>
    </Modal>
  ) : null;

  return { run, dialog: dialog || failed ? <>{dialog}{failed}</> : null };
}

/** Move to folder…: the folders of the messages' account. */
export function MoveDialog({ mailbox, from, onPick, onClose }: { mailbox: string; from: string; onPick: (to: Dest) => void; onClose: () => void }) {
  const folders = useFolders(Number(mailbox), true);
  const list = (folders.data?.folders ?? []).filter((f) => f.slug !== from && !['starred', 'important', 'outbox', 'drafts', 'sent'].includes(f.slug));
  return (
    <Modal title={text('Move to folder')} labelledBy="mail-move-to" width={420} onClose={onClose} footer={<Button onClick={onClose}>{text('Cancel')}</Button>}>
      <div className="p-4">
        {folders.isLoading ? <Spinner /> : null}
        <ul role="list" aria-label={text('Folders')} className="max-h-[320px] overflow-y-auto rounded-[10px] border border-line scroll-thin">
          {list.map((f) => (
            <li key={f.slug}>
              <button type="button" onClick={() => onPick({ slug: f.slug, name: folderName(f.name) })} className="flex h-9 w-full items-center px-3 text-left text-[13.5px] hover:bg-subtle">
                {folderName(f.name)}
              </button>
            </li>
          ))}
          {!folders.isLoading && list.length === 0 ? <li className="px-3 py-2 text-[13px] text-ink-3">{text('No other folders.')}</li> : null}
        </ul>
      </div>
    </Modal>
  );
}

export interface MenuContext {
  run: (id: ListActionId, targets: Target[]) => void;
  /** The key a command has in the person's scheme, for the menu's right column. */
  keyFor: (command: string) => string | undefined;
  offline: boolean;
  /** One message: open it with a reply, reply all or forward. */
  respond?: (t: Target, mode: 'reply' | 'reply_all' | 'forward') => void;
  /** Move to folder… (the messages are in one account). */
  move?: (targets: Target[]) => void;
  /** Pin, Snooze, Flag, Categorize, Sweep and the Focused move (MessageMenus). */
  state: MenuSection[];
  quickSteps: MenuSection[];
  rule?: (t: Target) => void;
  block?: (t: Target) => void;
  conversation?: MenuItem[];
  task?: (t: Target) => void;
  calendar?: (t: Target) => void;
  saveAttachments?: (t: Target) => void;
  /** Link to tender, customer or deal… — one message or all those selected. */
  linkRecord?: (targets: Target[]) => void;
  /** Convert to ticket… (#298): where Support takes email and the person may convert it. */
  ticket?: (t: Target) => void;
  /** View ticket: a message already made a ticket, for somebody with Support. */
  viewTicket?: (ticketId: number) => void;
  window?: (t: Target) => void;
  copyLink?: (t: Target) => void;
  source?: (t: Target) => void;
  selectFolder?: () => void;
  selectSender?: (t: Target) => void;
}

const COMMAND_OF: Partial<Record<ListActionId, string>> = { archive: 'archive', delete: 'delete', deleteForever: 'deleteForever', junk: 'spam', move: 'move', read: 'read', unread: 'unread', star: 'flag', unstar: 'flag' };

/**
 * The right-click menu (worksuite-desktop#161): Respond, Organise, Status,
 * Quick Steps, Rules, WorkSuite, Other and Select — for one message, or for
 * all those selected (then only what applies to many).
 */
export function listMenuSections(targets: Target[], c: MenuContext): MenuSection[] {
  if (targets.length === 0) return [];
  const one = targets.length === 1 ? targets[0]! : null;
  const n = targets.length;
  const item = (id: ListActionId): MenuItem => {
    const offlineOnly = id === 'deleteForever' && c.offline;
    const oneAccount = new Set(targets.map((t) => t.mailbox ?? '')).size === 1;
    if (id === 'move') return { id, label: actionLabel(id), icon: LIST_ACTIONS[id].icon, shortcut: c.keyFor('move'), disabled: !c.move || !oneAccount || !targets[0]!.mailbox, reason: oneAccount ? text('Only mail in a connected mailbox can be moved from here.') : text('Pick messages from one account to move them together.'), onSelect: () => c.move?.(targets) };
    return { id, label: actionLabel(id, n), icon: LIST_ACTIONS[id].icon, danger: LIST_ACTIONS[id].danger, shortcut: COMMAND_OF[id] ? c.keyFor(COMMAND_OF[id]!) : undefined, disabled: offlineOnly, reason: text('Available when you are back online.'), onSelect: () => c.run(id, targets) };
  };
  const sections: MenuSection[] = [];
  if (one && c.respond) {
    sections.push({
      id: 'respond',
      label: text('Respond'),
      items: [
        { id: 'reply', label: text('Reply'), icon: 'reply', shortcut: c.keyFor('reply'), onSelect: () => c.respond!(one, 'reply') },
        { id: 'reply-all', label: text('Reply all'), icon: 'reply-all', shortcut: c.keyFor('replyAll'), onSelect: () => c.respond!(one, 'reply_all') },
        { id: 'forward', label: text('Forward'), icon: 'forward', shortcut: c.keyFor('forward'), onSelect: () => c.respond!(one, 'forward') },
      ],
    });
  }
  sections.push({ id: 'organise-list', label: text('Organise'), items: organiseIds(targets).map(item) });
  sections.push({ id: 'status', label: text('Status'), items: statusIds(targets).map(item) });
  // Pin, Snooze, Flag and Categorize carry on the Status section; Sweep and Focused follow.
  sections.push(...c.state.map((s, i) => (i === 0 ? { ...s, id: `${s.id}-state` } : s)));
  sections.push(...c.quickSteps);
  if (one) {
    const rules: MenuItem[] = [];
    if (c.rule && one.row.from_email) rules.push({ id: 'rule', label: text('Always move mail from this sender…'), icon: 'filter', description: one.row.from_email, onSelect: () => c.rule!(one) });
    if (c.block && one.mailbox && one.row.from_email) rules.push({ id: 'block', label: text('Block sender'), icon: 'warning', danger: true, disabled: c.offline, reason: text('Available when you are back online.'), onSelect: () => c.block!(one) });
    rules.push(...(c.conversation ?? []));
    if (rules.length) sections.push({ id: 'rules', label: text('Rules'), items: rules });
    const ws: MenuItem[] = [];
    if (c.task) ws.push({ id: 'task', label: text('Create task…'), icon: 'list-todo', onSelect: () => c.task!(one) });
    if (c.calendar) ws.push({ id: 'calendar', label: text('Add to calendar'), icon: 'calendar-plus', disabled: c.offline, reason: text('Available when you are back online.'), onSelect: () => c.calendar!(one) });
    if (c.saveAttachments && one.row.has_attachment && one.mailbox) ws.push({ id: 'attachments', label: text('Save attachments to Files'), icon: 'paperclip', disabled: c.offline, reason: text('Available when you are back online.'), onSelect: () => c.saveAttachments!(one) });
    if (c.linkRecord) ws.push(linkItem(targets, c));
    const linked = one.row.support_ticket;
    if (linked && c.viewTicket) ws.push({ id: 'ticket', label: text('View ticket {ref}', { ref: linked.reference }), icon: 'life-buoy', onSelect: () => c.viewTicket!(linked.id) });
    else if (!linked && c.ticket) ws.push({ id: 'ticket', label: text('Convert to ticket…'), icon: 'life-buoy', disabled: c.offline, reason: text('Available when you are back online.'), onSelect: () => c.ticket!(one) });
    if (ws.length) sections.push({ id: 'worksuite', label: text('WorkSuite'), items: ws });
    const other: MenuItem[] = [];
    if (c.window) other.push({ id: 'window', label: text('Open in new window'), icon: 'app-window', shortcut: c.keyFor('openWindow'), onSelect: () => c.window!(one) });
    if (c.copyLink) other.push({ id: 'link', label: text('Copy link'), icon: 'link', onSelect: () => c.copyLink!(one) });
    if (c.source) other.push({ id: 'source', label: text('View original'), icon: 'external', disabled: c.offline, reason: text('Available when you are back online.'), onSelect: () => c.source!(one) });
    if (other.length) sections.push({ id: 'other', label: text('Other'), items: other });
  }
  if (!one && c.linkRecord) sections.push({ id: 'worksuite', label: text('WorkSuite'), items: [linkItem(targets, c)] });
  const select: MenuItem[] = [];
  if (c.selectFolder) select.push({ id: 'select-all', label: text('Select all in this folder'), icon: 'check-check', shortcut: c.keyFor('selectAll'), onSelect: c.selectFolder });
  if (c.selectSender && one?.row.from_email) select.push({ id: 'select-sender', label: text('Select all from this sender'), icon: 'users', description: one.row.from_email, onSelect: () => c.selectSender!(one) });
  if (select.length) sections.push({ id: 'select', label: text('Select'), items: select });
  return sections;
}

function linkItem(targets: Target[], c: MenuContext): MenuItem {
  return {
    id: 'link-record',
    label: targets.length === 1 ? text('Link to tender, customer or deal…') : text('Link {n} to tender, customer or deal…', { n: targets.length }),
    icon: 'link',
    disabled: c.offline,
    reason: text('Available when you are back online.'),
    onSelect: () => c.linkRecord!(targets),
  };
}

/** The bar's own short words, where the menu's are longer. */
const BAR_LABEL: Partial<Record<ListActionId, string>> = { move: 'Move', read: 'Mark read', unread: 'Mark unread' };

/**
 * Over the list while messages are selected (worksuite-desktop#290): "3 selected · Archive · Delete · Move · Mark read
 * · ⋯ · Clear" — the folder's own actions (Restore and Delete permanently in Deleted Items, Not junk in Junk), read or
 * unread, and ⋯ with the rest of the menu (star, flag, snooze, categories, rules…). Select all is the box over the
 * list's lead column, not a button here.
 */
export function SelectionBar({ targets, run, more, onClear }: { targets: Target[]; run: (id: ListActionId, targets: Target[]) => void; more: (x: number, y: number) => void; onClear: () => void }) {
  const n = targets.length;
  const ids = [...organiseIds(targets).filter((id) => id !== 'junk'), statusIds(targets)[0]!];
  // Move goes to one account's folders, as in the menu: messages from several accounts are moved account by account.
  const oneAccount = new Set(targets.map((t) => t.mailbox ?? '')).size === 1;
  const noMove = !oneAccount ? text('Pick messages from one account to move them together.') : !targets[0]?.mailbox ? text('Only mail in a connected mailbox can be moved from here.') : null;
  return (
    <div role="toolbar" aria-label={text('{n} selected', { n })} className="flex flex-wrap items-center gap-1 border-t border-line bg-selection py-1.5 pr-3 pl-4 text-[12.5px]">
      <span className="mr-1 font-semibold text-ink">{text('{n} selected', { n })}</span>
      {ids.map((id) => (
        <button key={id} type="button" data-bar-action={id} disabled={id === 'move' && !!noMove} title={id === 'move' ? (noMove ?? undefined) : undefined} onClick={() => run(id, targets)} className={cx('inline-flex h-7 items-center gap-1 rounded-[6px] px-2 font-semibold hover:bg-surface disabled:opacity-45 disabled:hover:bg-transparent', LIST_ACTIONS[id].danger ? 'text-danger' : 'text-ink')}>
          <Icon name={LIST_ACTIONS[id].icon} size={14} />
          {text(BAR_LABEL[id] ?? LIST_ACTIONS[id].label)}
        </button>
      ))}
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={text('More actions')}
        title={text('More actions')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          more(r.left, r.bottom);
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink hover:bg-surface"
      >
        <Icon name="more" size={14} />
      </button>
      <span className="flex-1" />
      <button type="button" onClick={onClear} aria-label={text('Clear selection')} title={text('Clear selection')} className="h-7 rounded-[6px] px-2 font-semibold text-primary hover:bg-surface">
        {text('Clear')}
      </button>
    </div>
  );
}
