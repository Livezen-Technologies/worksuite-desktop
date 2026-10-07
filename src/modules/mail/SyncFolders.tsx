import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Button, ErrorNote, Spinner, Switch, cx } from '../../components/ui';
import { mailboxLetter } from './model';
import { AccountAvatar } from './parts';
import type { FolderSyncState, Mailbox, SyncFolder, SyncFoldersAnswer } from './types';

/**
 * Settings › Mail › Accounts › Folders (worksuite-desktop#286): every folder
 * of an account and what the server's sync does with it — Up to date,
 * Downloading N of M, Waiting, Error (with the reason) or Skipped — and a
 * switch to sync a folder the server skips (Exchange's Calendar, Contacts,
 * Tasks, Notes, Journal, RSS Feeds, Conversation History, Sync Issues and
 * Outbox are skipped as not mail) or to stop syncing one. The choice is kept
 * on the server, for every computer; INBOX is always synced.
 */

/** A folder's state in words, for its row. */
export function folderStateWord(f: Pick<SyncFolder, 'state' | 'have' | 'want' | 'reason'>): string {
  switch (f.state) {
    case 'up_to_date':
      return text('Up to date');
    case 'downloading':
      return f.want !== null ? text('Downloading {n} of {total}', { n: f.have.toLocaleString(), total: f.want.toLocaleString() }) : text('Downloading');
    case 'waiting':
      return text('Waiting for its turn');
    case 'error':
      return f.reason ? text('Error — {why}', { why: f.reason }) : text('Error');
    case 'skipped':
      return f.reason === 'off' ? text('Skipped (turned off)') : text('Skipped (not a mail folder)');
    default:
      return String(f.state);
  }
}

function stateTone(state: FolderSyncState | string): string {
  return state === 'error' ? 'text-danger' : state === 'up_to_date' ? 'text-success' : state === 'downloading' ? 'text-primary' : 'text-ink-3';
}

/**
 * What to send for "sync it" or "don't": null when that is what the folder's kind would do anyway (a mail folder
 * synced, a calendar skipped), so the server goes back to deciding by kind; otherwise the choice itself.
 */
export function choiceFor(f: Pick<SyncFolder, 'kind'>, sync: boolean): boolean | null {
  return sync === (f.kind === null) ? null : sync;
}

export function SyncFolders({ box, onClose }: { box: Mailbox; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ['mail', 'sync-folders', box.id] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiGet<SyncFoldersAnswer>(`/api/mail/mailboxes/${box.id}/sync-folders`),
    // While folders are still coming in, their numbers follow along.
    refetchInterval: (query) => ((query.state.data?.folders ?? []).some((f) => f.state === 'downloading' || f.state === 'waiting') ? 5_000 : false),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const folders = q.data?.folders ?? [];
  const canChoose = q.data?.can_choose !== false;
  const choose = async (f: SyncFolder, sync: boolean) => {
    setBusy(f.path);
    try {
      const r = await apiPut<SyncFoldersAnswer>(`/api/mail/mailboxes/${box.id}/sync-folders`, { path: f.path, sync: choiceFor(f, sync) });
      qc.setQueryData<SyncFoldersAnswer>(key, (old) => (old ? { ...old, folders: r.folders } : r));
      void qc.invalidateQueries({ queryKey: ['mail', 'sync'] });
      toast('success', sync ? text('{name} will be synced.', { name: f.name }) : text('{name} will not be synced.', { name: f.name }));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const skipped = folders.filter((f) => f.state === 'skipped').length;
  const old = q.error instanceof ApiError && q.error.status === 404;
  return (
    <div role="dialog" aria-modal="true" aria-label={text('Folders · {email}', { email: box.email })} className="fixed inset-y-0 right-0 z-50 flex w-[620px] max-w-full flex-col border-l border-line bg-surface shadow-2xl">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <AccountAvatar letter={mailboxLetter(box)} colour={box.colour} size={24} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] text-ink">{text('Folders · {email}', { email: box.email })}</b>
          <span className="block truncate text-[12px] text-ink-3">{folders.length ? text('{n} folders · {skipped} not synced', { n: folders.length, skipped }) : text('Which folders the server syncs')}</span>
        </span>
        <button type="button" onClick={onClose} aria-label={text('Close')} className="h-8 w-8 rounded-[8px] text-ink-3 hover:bg-subtle hover:text-ink">
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 scroll-thin">
        <p className="mb-3 text-[12.5px] text-ink-3">{text('Calendar, Contacts, Tasks, Notes and other folders that are not mail are not synced unless you turn them on. Older mail beyond the offline window downloads when you scroll to it, so it never counts as unfinished.')}</p>
        {q.isLoading ? <Spinner /> : old ? <p className="text-[13px] text-ink-3">{text('This WorkSuite server does not report folder sync states yet.')}</p> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        {!canChoose && folders.length ? <p className="mb-3 rounded-[8px] bg-subtle p-2 text-[12.5px] text-ink-2">{text('Only someone who manages this mailbox’s folders can change which are synced.')}</p> : null}
        {folders.length ? (
          <ul role="list" aria-label={text('Folders')} className="flex flex-col gap-0.5">
            {folders.map((f) => {
              const inbox = f.path.toUpperCase() === 'INBOX';
              return (
                <li key={f.path} aria-label={f.name} className="grid grid-cols-[minmax(140px,1fr)_minmax(150px,1fr)_auto] items-center gap-x-3 rounded-[6px] px-2 py-1.5 text-[12.5px] even:bg-subtle/60">
                  <span className="min-w-0 break-words text-ink">
                    {f.name}
                    {f.role ? <span className="text-ink-3"> · {f.role}</span> : null}
                  </span>
                  <span className={cx('font-semibold', stateTone(f.state))}>{folderStateWord(f)}</span>
                  <Switch label={text('Sync {name}', { name: f.name })} checked={f.sync} disabled={inbox || !canChoose || busy !== null} onChange={(v) => void choose(f, v)} />
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <footer className="flex border-t border-line p-3">
        <span className="flex-1" />
        <Button onClick={onClose}>{text('Close')}</Button>
      </footer>
    </div>
  );
}
