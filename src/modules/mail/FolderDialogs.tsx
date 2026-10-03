import { useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Button, Modal, TextField, cx } from '../../components/ui';
import { emptyFolder, folderOp, isCoreFolder, mailKeys, useFolders, type FolderOp } from './api';
import { folderName } from './model';
import type { Folder, Mailbox } from './types';

/**
 * The dialogs behind a folder's right-click menu (worksuite-desktop#162):
 * New subfolder…, Rename…, Move to…, Delete folder… and Empty folder.
 */

/** What a folder dialog acts on. */
export interface FolderTarget {
  box: Mailbox;
  slug: string;
  label: string;
}

export type FolderDialog = { kind: 'subfolder' | 'rename' | 'move' | 'delete' | 'empty'; target: FolderTarget };

/** Per-folder count choice: unread (the default) or total, remembered on this computer. */
const COUNTS_KEY = 'ws.mail.counts';

export function readCountModes(): Record<string, 'total'> {
  try {
    const v = JSON.parse(window.localStorage.getItem(COUNTS_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, 'total'>) : {};
  } catch {
    return {};
  }
}

export function writeCountModes(m: Record<string, 'total'>): void {
  try {
    window.localStorage.setItem(COUNTS_KEY, JSON.stringify(m));
  } catch {
    // Blocked storage: the choice lasts until the window closes.
  }
}

/**
 * Mark everything in a folder read: shown at once (the folder's count and the
 * list's dots), sent now or queued, and put back from the server if it is
 * refused — when the queue reports the refusal, Mail asks the server again.
 */
export function optimisticReadAll(qc: QueryClient, box: number, slug: string): () => void {
  const key = mailKeys.folders(box);
  const before = qc.getQueryData<{ folders: Folder[] }>(key);
  if (before) qc.setQueryData(key, { ...before, folders: before.folders.map((f) => (f.slug === slug ? { ...f, unread: 0 } : f)) });
  qc.setQueriesData<{ pages: Array<{ data: { messages: Array<{ is_read: boolean; folder_slug?: string | null }> } }>; pageParams: unknown[] }>({ queryKey: ['mail', 'messages', String(box), slug] }, (d) =>
    d ? { ...d, pages: d.pages.map((p) => ({ ...p, data: { ...p.data, messages: p.data.messages.map((m) => ({ ...m, is_read: true })) } })) } : d,
  );
  return () => {
    if (before) qc.setQueryData(key, before);
    void qc.invalidateQueries({ queryKey: ['mail'] });
  };
}

/** Run a folder change and say what happened: done, waiting for the connection, or refused (and put back). */
export async function runFolderOp(qc: QueryClient, op: FolderOp, t: FolderTarget, extra: Record<string, unknown> = {}, done?: string): Promise<boolean> {
  const rollback = op === 'read-all' ? optimisticReadAll(qc, t.box.id, t.slug) : null;
  try {
    const outcome = await folderOp(op, t.box.id, t.slug, t.label, extra);
    void qc.invalidateQueries({ queryKey: ['offline'] });
    if (outcome === 'queued') toast('info', text('Offline — this happens when you reconnect. Undo it in Waiting to send.'));
    else {
      void qc.invalidateQueries({ queryKey: ['mail'] });
      toast('success', done ?? text('Done.'));
    }
    return true;
  } catch (e) {
    rollback?.();
    toast('error', errorMessage(e));
    return false;
  }
}

export function FolderDialogs({ dialog, offline, onClose }: { dialog: FolderDialog; offline: boolean; onClose: () => void }) {
  const t = dialog.target;
  if (dialog.kind === 'subfolder' || dialog.kind === 'rename') return <NameFolder kind={dialog.kind} target={t} onClose={onClose} />;
  if (dialog.kind === 'move') return <MoveFolder target={t} onClose={onClose} />;
  return <ConfirmFolder kind={dialog.kind} target={t} offline={offline} onClose={onClose} />;
}

function NameFolder({ kind, target, onClose }: { kind: 'subfolder' | 'rename'; target: FolderTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(kind === 'rename' ? target.label : '');
  const [busy, setBusy] = useState(false);
  const clean = name.trim();
  const save = async () => {
    if (!clean) return;
    setBusy(true);
    const ok =
      kind === 'rename'
        ? await runFolderOp(qc, 'rename', target, { name: clean }, text('Folder renamed.'))
        : await runFolderOp(qc, 'create', target, { name: clean, parent: target.slug }, text('Folder created.'));
    setBusy(false);
    if (ok) onClose();
  };
  const title = kind === 'rename' ? text('Rename {folder}', { folder: target.label }) : text('New folder in {folder}', { folder: target.label });
  return (
    <Modal
      title={title}
      labelledBy="mail-folder-name"
      width={420}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!clean || (kind === 'rename' && clean === target.label)} onClick={() => void save()}>
            {kind === 'rename' ? text('Rename') : text('Create')}
          </Button>
        </>
      }
    >
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label={text('Name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus hint={text('In {email}', { email: target.box.email })} />
      </form>
    </Modal>
  );
}

/** The folders a folder can be moved under: the top, Inbox, and every folder of the account's own outside its own subtree. */
export function moveTargets(folders: Folder[], slug: string): Array<{ slug: string; name: string }> {
  const path = slug.startsWith('label:') ? slug.slice(6) : slug;
  const inside = (s: string) => {
    if (!s.startsWith('label:')) return false;
    const p = s.slice(6);
    return p === path || p.startsWith(`${path}/`) || p.startsWith(`${path}.`);
  };
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '';
  const out = [{ slug: '', name: text('Top level') }, { slug: 'inbox', name: text('Inbox') }];
  for (const f of folders) if (!isCoreFolder(f.slug) && !inside(f.slug)) out.push({ slug: f.slug, name: folderName(f.name) });
  // Where it already is is not a move.
  return out.filter((o) => (o.slug === '' ? parent !== '' : o.slug === 'inbox' ? parent.toUpperCase() !== 'INBOX' : o.slug.slice(6) !== parent));
}

function MoveFolder({ target, onClose }: { target: FolderTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const folders = useFolders(target.box.id, true);
  const choices = moveTargets(folders.data?.folders ?? [], target.slug);
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (to === null) return;
    setBusy(true);
    const ok = await runFolderOp(qc, 'move', target, { parent: to }, text('Folder moved.'));
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal
      title={text('Move {folder} to…', { folder: target.label })}
      labelledBy="mail-folder-move"
      width={420}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={to === null} onClick={() => void save()}>
            {text('Move')}
          </Button>
        </>
      }
    >
      <ul role="listbox" aria-label={text('Folders of {email}', { email: target.box.email })} className="max-h-[320px] overflow-y-auto p-2">
        {choices.map((c) => (
          <li key={c.slug || 'top'}>
            <button type="button" role="option" aria-selected={to === c.slug} onClick={() => setTo(c.slug)} className={cx('w-full rounded-[8px] px-3 py-1.5 text-left text-[13px]', to === c.slug ? 'bg-selection font-semibold text-primary' : 'text-ink hover:bg-subtle')}>
              {c.name}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ConfirmFolder({ kind, target, offline, onClose }: { kind: 'delete' | 'empty'; target: FolderTarget; offline: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    if (kind === 'delete') {
      const ok = await runFolderOp(qc, 'delete', target, { confirm: true }, text('Folder deleted.'));
      setBusy(false);
      if (ok) onClose();
      return;
    }
    try {
      const n = await emptyFolder(target.box.id, target.slug, (done, total) => setProgress(text('{done} of {total} deleted…', { done: done.toLocaleString(), total: total.toLocaleString() })));
      void qc.invalidateQueries({ queryKey: ['mail'] });
      toast('success', text('{n} messages permanently deleted.', { n: n.toLocaleString() }));
      onClose();
    } catch (e) {
      void qc.invalidateQueries({ queryKey: ['mail'] });
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  const title = kind === 'delete' ? text('Delete {folder}?', { folder: target.label }) : text('Empty {folder}?', { folder: target.label });
  const body =
    kind === 'delete'
      ? text('The folder, its subfolders and every message in them are deleted from {email} on the mail server and every device. This cannot be undone.', { email: target.box.email })
      : text('Every message in {folder} is permanently deleted from {email} on the mail server and every device. This cannot be undone.', { folder: target.label, email: target.box.email });
  const blocked = kind === 'empty' && offline;
  return (
    <Modal
      title={title}
      labelledBy="mail-folder-confirm"
      width={440}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {text('Cancel')}
          </Button>
          <Button variant="danger" loading={busy} disabled={blocked} onClick={() => void go()}>
            {kind === 'delete' ? text('Delete folder') : text('Empty folder')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 p-5 text-[13px] text-ink">
        <p>{body}</p>
        {blocked ? <p className="text-warning">{text('Emptying a folder needs a connection: a permanent delete is never left waiting.')}</p> : null}
        {progress ? (
          <p role="status" className="text-ink-3">
            {progress}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
