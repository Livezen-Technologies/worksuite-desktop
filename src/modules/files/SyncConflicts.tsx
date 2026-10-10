import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { DriveConflict } from '@shared/types';
import { call, errorMessage, hasDesktop } from '../../core/bridge';
import { bytes, dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { computerWord } from './sync';

/**
 * Sync conflicts (Drive ENH-03 DSK-03, AC-11): a file changed here and in Drive at once — an offline photo edit,
 * say — keeps both, and the server holds the conflict open until somebody decides which is current. Every choice is
 * recoverable: keeping mine makes a new version, and a discarded copy goes to the recycle bin.
 */
type Resolution = 'keep_mine' | 'keep_server' | 'keep_both' | 'dismiss';

export function SyncConflicts({ focus }: { focus: boolean }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['files', 'sync-conflicts'], queryFn: () => call('sync:conflicts'), enabled: hasDesktop(), refetchInterval: 60_000 });
  useEffect(() => {
    if (focus && q.data) ref.current?.scrollIntoView?.({ block: 'start' });
  }, [focus, q.data]);
  const resolve = async (c: DriveConflict, resolution: Resolution) => {
    setBusy(c.id);
    try {
      const r = await call('sync:resolveConflict', { id: c.id, resolution });
      toast('success', r.message);
      await qc.invalidateQueries({ queryKey: ['files'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (!hasDesktop()) return null;
  const list = q.data ?? [];
  if (!q.isLoading && !q.error && !list.length && !focus) return null;
  return (
    <section ref={ref} aria-label="Sync conflicts" className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <Icon name="warning" size={17} className="text-warning" />
        <h2 className="flex-1 text-[15px] font-bold text-ink">Sync conflicts</h2>
        {list.length ? <span className="text-[12.5px] text-ink-3">{`${list.length} to decide`}</span> : null}
      </div>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !list.length && !q.error ? <span className="text-[13px] text-ink-3">No conflicts. When a file changes here and in Drive at the same time, both are kept and it shows here.</span> : null}
      <ul className="flex flex-col gap-2.5">
        {list.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 rounded-[12px] border border-line p-3.5 text-[13px]">
            <b className="text-ink">{c.fileName}</b>
            <span className="text-ink-2">
              {`Drive has v${c.serverVersion}${c.serverUpdatedAt ? ` from ${dateLabel(c.serverUpdatedAt)}` : ''}${c.serverSize !== null ? ` (${bytes(c.serverSize)})` : ''}; ${c.deviceName ?? `this ${computerWord()}`} changed v${c.baseVersion}${c.localSize !== null ? ` (${bytes(c.localSize)})` : ''}${c.copyName ? `, kept as “${c.copyName}”` : ''}.`}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={busy === c.id || c.copyFileId === null} title={c.copyFileId === null ? 'The device did not send its version' : undefined} onClick={() => void resolve(c, 'keep_mine')}>
                {`Keep mine as v${c.serverVersion + 1}`}
              </Button>
              <Button size="sm" disabled={busy === c.id} onClick={() => void resolve(c, 'keep_server')}>Keep Drive’s</Button>
              <Button size="sm" disabled={busy === c.id} onClick={() => void resolve(c, 'keep_both')}>Keep both</Button>
              <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => void resolve(c, 'dismiss')}>Dismiss</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
