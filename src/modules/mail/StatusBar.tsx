import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { bytes, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import type { OfflineMutation } from '@shared/types';
import { undoQueued } from './api';
import { syncAgo, type SyncSummary } from './sync';
import type { SyncStatus } from './types';

/**
 * The strip under the reading pane: the one sync status — the same as the
 * folder pane's footer and Settings (DMO-SYN-05/06) — with a warning naming
 * an account that has not synced for too long, what is waiting to go, the
 * selection, the reading zoom and how much mail this computer keeps.
 */
export function StatusBar({ summary, sync, waiting, zoom, localBytes, items, unread, selected, onOpenSync }: { summary: SyncSummary; sync: SyncStatus | null; waiting: number; zoom: number; localBytes: number | null; items?: number | null; unread?: number | null; selected?: number; onOpenSync?: () => void }) {
  const pushed = !!sync?.enabled && sync.mailboxes.some((m) => m.pushed);
  const dot = summary.state === 'offline' ? 'bg-warning' : summary.tone === 'danger' ? 'bg-danger' : summary.state === 'syncing' ? 'bg-primary' : 'bg-success';
  const line = summary.state === 'up_to_date' ? `${summary.headline} · ${summary.detail}` : summary.state === 'attention' ? (summary.lastOk ? text('Synced {ago}', { ago: syncAgo(summary.lastOk) }) : text('Needs attention')) : summary.headline;
  return (
    <footer role="status" aria-label={text('Mail status')} className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-surface px-3 text-[12px] text-ink-3">
      <button type="button" onClick={onOpenSync} title={text('Open Settings › Mail › Accounts')} className="flex items-center gap-1.5 hover:text-ink">
        <span aria-hidden className={cx('h-[7px] w-[7px] rounded-full', dot)} />
        {line}
      </button>
      {summary.warning && summary.state !== 'offline' ? (
        <button type="button" onClick={onOpenSync} className="flex items-center gap-1 font-semibold text-danger hover:underline">
          <Icon name="warning" size={12} />
          {text('{warning} — fix', { warning: summary.warning })}
        </button>
      ) : null}
      {summary.state === 'up_to_date' && pushed ? <span>{text('New mail pushed')}</span> : null}
      {typeof items === 'number' ? <span>{text('Items: {n}', { n: items.toLocaleString() })}</span> : null}
      {typeof unread === 'number' && unread > 0 ? <span>{text('Unread: {n}', { n: unread.toLocaleString() })}</span> : null}
      {selected && selected > 1 ? <span className="font-semibold text-ink">{text('{n} selected', { n: selected })}</span> : null}
      <span className={waiting ? 'font-semibold text-warning' : undefined}>{waiting === 1 ? text('1 action waiting') : text('{n} actions waiting', { n: waiting })}</span>
      <span className="flex-1" />
      <span>{text('Zoom {n}%', { n: zoom })}</span>
      {localBytes !== null ? <span className="font-mono">{text('Local store {size}', { size: bytes(localBytes) })}</span> : null}
    </footer>
  );
}

const ICON: Record<string, string> = { send: 'send', archive: 'archive', trash: 'trash', spam: 'spam', star: 'star', unstar: 'star', read: 'mail-open', unread: 'mail', move: 'folder-input', important: 'flag', unimportant: 'flag', inbox: 'inbox' };

/** "Waiting to send · 3": mail's changes in the offline queue, each with Undo while it has not gone. */
export function WaitingPanel({ pending }: { pending: OfflineMutation[] }) {
  const qc = useQueryClient();
  if (pending.length === 0) return null;
  const undo = async (m: OfflineMutation) => {
    try {
      await undoQueued(m.id);
      void qc.invalidateQueries({ queryKey: ['offline'] });
      void qc.invalidateQueries({ queryKey: ['mail'] });
      toast('success', text('Undone — it will not be sent.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <section aria-label={text('Waiting to send')} className="m-4 mt-0 shrink-0 overflow-hidden rounded-[12px] border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-[13.5px] font-bold text-ink">{text('Waiting to send · {n}', { n: pending.length })}</h3>
        <span className="text-[12px] text-ink-3">Retries automatically when the connection returns</span>
      </header>
      <ul role="list" className="max-h-[220px] overflow-y-auto scroll-thin">
        {pending.map((m) => {
          const kind = m.entity.startsWith('message.') ? m.entity.slice(8) : 'send';
          const failed = m.state === 'FAILED' || m.state === 'CONFLICT';
          return (
            <li key={m.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-subtle text-primary">
                <Icon name={ICON[kind] ?? 'clock'} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{m.label}</span>
                {failed ? <span className="block truncate text-[12px] text-danger">{m.error ?? text('The server refused it.')}</span> : null}
              </span>
              <span className="shrink-0 text-[12px] text-ink-3">{m.state === 'SYNCING' ? text('sending…') : text('queued {time}', { time: timeLabel(m.createdAt) })}</span>
              <button type="button" disabled={m.state === 'SYNCING'} onClick={() => void undo(m)} className="h-7 shrink-0 rounded-[6px] border border-line px-2.5 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-40">
                {failed ? text('Discard') : text('Undo')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
