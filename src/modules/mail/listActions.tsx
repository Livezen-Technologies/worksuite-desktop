import { useQueryClient } from '@tanstack/react-query';
import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import type { MenuItem, MenuSection } from '../../components/Menu';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { messageAction, moveMessage, useFolders, type MessageActionName, type Outcome } from './api';
import { slugRole } from './allAccounts';
import type { Target } from './MessageMenus';
import { folderName } from './model';
import { sendAfterUndoWindow } from './outgoing';
import type { MessageRef } from './types';

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

  return { run, dialog };
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

/**
 * Over the list while messages are selected: what applies to all of them —
 * "Archive 12", "Delete 12", read, star — and More with the rest of the menu.
 */
export function SelectionBar({ targets, total, run, more, onSelectAll, onClear }: { targets: Target[]; total: number; run: (id: ListActionId, targets: Target[]) => void; more: (x: number, y: number) => void; onSelectAll: () => void; onClear: () => void }) {
  const n = targets.length;
  const ids = [...organiseIds(targets).filter((id) => id !== 'move' && id !== 'junk'), ...statusIds(targets)];
  return (
    <div role="toolbar" aria-label={text('{n} selected', { n })} className="flex flex-wrap items-center gap-1 border-t border-line bg-selection px-3 py-1.5 text-[12.5px]">
      <span className="mr-1 font-semibold text-ink">{text('{n} selected', { n })}</span>
      {ids.map((id) => (
        <button key={id} type="button" onClick={() => run(id, targets)} className={cx('inline-flex h-7 items-center gap-1 rounded-[6px] px-2 font-semibold hover:bg-surface', LIST_ACTIONS[id].danger ? 'text-danger' : 'text-ink')}>
          <Icon name={LIST_ACTIONS[id].icon} size={14} />
          {actionLabel(id, n)}
        </button>
      ))}
      <button
        type="button"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          more(r.left, r.bottom);
        }}
        className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 font-semibold text-ink hover:bg-surface"
      >
        <Icon name="more" size={14} />
        {text('More')}
      </button>
      <span className="flex-1" />
      {n < total ? (
        <button type="button" onClick={onSelectAll} className="h-7 rounded-[6px] px-2 font-semibold text-primary hover:bg-surface">
          {text('Select all {n}', { n: total })}
        </button>
      ) : null}
      <button type="button" onClick={onClear} aria-label={text('Clear selection')} title={text('Clear selection')} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-2 hover:bg-surface hover:text-ink">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
