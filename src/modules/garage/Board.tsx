import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { ErrorNote, IconButton, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PageHead } from '../../components/PageKit';
import { errorText, gGet, gPost, K, nice, type BoardColumn } from './api';
import { JobCardView, useGarage } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * The job board (FR-BRD-01..05). A card dropped on another column asks the
 * server for that column's move; a move the job's flow refuses — or one that
 * only happens through an action, such as sending an estimate — stays where
 * it was, with the server's reason. A card opens the job, where each move it
 * can make is a button.
 */
export default function Board() {
  const g = useGarage();
  const qc = useQueryClient();
  const [branch, setBranch] = useState('');
  const [priority, setPriority] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filters = { branch, priority, overdue };
  const board = useQuery({
    queryKey: K.board(g.org, filters),
    queryFn: ({ signal }) => gGet<{ columns: BoardColumn[] }>('/board', { org: g.org, branch_id: branch, priority, overdue: overdue ? 1 : undefined }, signal),
    refetchInterval: 30_000,
  });

  const drop = async (column: string) => {
    const id = dragging;
    setOver(null);
    setDragging(null);
    if (!id || busy) return;
    const from = board.data?.columns.find((c) => c.cards.some((x) => x.id === id));
    if (from?.key === column) return;
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${id}/drop`, { column });
      toast('success', r.message);
    } catch (e) {
      toast('error', errorText(e, 'The job could not be moved.'));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['garage', 'board'] });
      void qc.invalidateQueries({ queryKey: ['garage', 'jobs'] });
      void qc.invalidateQueries({ queryKey: ['garage', 'overview'] });
    }
  };

  const branches = g.options.branches.filter((b) => b.garage);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Job board" sub="Drag a card to move the job on. A move that needs an action says which.">
        {branches.length > 1 ? (
          <Select aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: String(b.id), label: b.name }))]} className="h-8 w-44 rounded-[8px] border border-line bg-surface px-2 text-[12.5px]" />
        ) : null}
        <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} options={[{ value: '', label: 'Any priority' }, ...g.options.priorities.map((p) => ({ value: p, label: nice(p) }))]} className="h-8 w-36 rounded-[8px] border border-line bg-surface px-2 text-[12.5px]" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <Checkbox checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only
        </label>
        <IconButton icon="refresh" label="Refresh" onClick={() => void board.refetch()} />
      </PageHead>
      {board.isLoading ? (
        <Spinner />
      ) : board.error || !board.data ? (
        <ErrorNote error={board.error ?? new Error('The board could not be loaded.')} onRetry={() => void board.refetch()} />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2 scroll-thin" aria-label="Job board">
          {board.data.columns.map((col) => (
            <section
              key={col.key}
              aria-label={col.label}
              data-column={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((c) => (c === col.key ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                void drop(col.key);
              }}
              className={cx('flex w-[252px] shrink-0 flex-col overflow-hidden rounded-[12px] border', over === col.key ? 'border-primary bg-selection' : 'border-line bg-ground dark:bg-surface')}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
                <b className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{col.label}</b>
                <span className="flex h-[18px] min-w-5 items-center justify-center rounded-[9px] bg-surface px-1.5 text-[11px] font-bold text-ink-2 tabular-nums dark:bg-subtle">{col.cards.length}</span>
              </div>
              <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2 scroll-thin">
                {col.cards.map((c) => (
                  <JobCardView
                    key={c.id}
                    job={c}
                    draggable={col.key !== 'delivered'}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', String(c.id));
                      setDragging(c.id);
                    }}
                    onOpen={() => g.openJob(c.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
