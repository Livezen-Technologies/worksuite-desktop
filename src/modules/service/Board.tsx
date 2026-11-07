import { useState } from 'react';
import { BOARD_COLUMNS, nextStatuses, statusLabel, type ServiceStatus } from '@shared/service';
import { ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import { useBoard, useTransition, type JobRow } from './api';
import { deviceName } from './parts';

/**
 * The Kanban repair board (blueprint §6): a column per active status. Dropping a card on a column asks the server
 * for that transition; a column the job cannot move to from where it is takes no drop.
 */
export default function Board({ offline, onOpen }: { offline: boolean; onOpen: (id: string) => void }) {
  const board = useBoard();
  const [drag, setDrag] = useState<JobRow | null>(null);
  if (board.isPending) return <Spinner />;
  if (board.isError) return <div className="p-4"><ErrorNote error={board.error} onRetry={() => void board.refetch()} /></div>;
  const jobs = board.data.data.items;
  const allowed = drag ? nextStatuses(String(drag.status)) : [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-4">
      <div className="flex items-center gap-2"><h1 className="text-[18px] font-bold">Repair board</h1>{board.data.offline ? <OfflineNote cachedAt={board.data.cachedAt} /> : null}</div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto scroll-thin">
        {BOARD_COLUMNS.map((col) => {
          const cards = jobs.filter((j) => j.status === col);
          return (
            <Column key={col} status={col} droppable={!offline && !!drag && allowed.includes(col)} drag={drag} onDropped={() => setDrag(null)}>
              {cards.map((j) => (
                <button key={j.id} type="button" draggable={!offline} onDragStart={() => setDrag(j)} onDragEnd={() => setDrag(null)} onClick={() => onOpen(j.id)}
                  className="mb-1.5 w-full rounded-[8px] border border-line bg-surface p-2 text-left text-[12.5px] hover:bg-subtle">
                  <div className="flex justify-between font-semibold"><span>{j.number}</span>{j.overdue ? <span className="text-danger">Overdue</span> : null}</div>
                  <div className="truncate">{deviceName(j.device)}</div>
                  <div className="truncate text-ink-3">{j.customer?.name ?? '—'} · {j.technician?.name ?? 'Unassigned'}</div>
                </button>
              ))}
            </Column>
          );
        })}
      </div>
    </div>
  );
}

function Column({ status, droppable, drag, onDropped, children }: { status: ServiceStatus; droppable: boolean; drag: JobRow | null; onDropped: () => void; children: React.ReactNode }) {
  const move = useTransition({ id: drag?.id ?? '', version: drag?.version });
  return (
    <section aria-label={statusLabel(status)} onDragOver={(e) => { if (droppable) e.preventDefault(); }}
      onDrop={() => { if (droppable && drag) { move.mutate({ to: status }); onDropped(); } }}
      className={`flex w-[220px] shrink-0 flex-col rounded-[10px] border p-2 ${droppable ? 'border-primary bg-selection' : 'border-line bg-rail dark:bg-surface'}`}>
      <h2 className="mb-2 text-[12px] font-bold text-ink-2">{statusLabel(status)} <span className="text-ink-3">({Array.isArray(children) ? children.length : 0})</span></h2>
      {move.isError ? <p className="mb-1 text-[11.5px] text-danger">{(move.error as Error).message}</p> : null}
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{children}</div>
    </section>
  );
}
