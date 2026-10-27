import { useQuery } from '@tanstack/react-query';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { PageHead } from '../../components/PageKit';
import { boardColumns, fetchBoard, K, money, type Band, type Column } from './api';
import { Left, PriorityPill, Score, subline } from './parts';

/**
 * The pipeline: a column per stage in working order, closing soonest at the
 * top of each. Won and lost hold every decision ever made, so they are a
 * count and a way to their lists rather than a column of cards. A card opens
 * its tender; moving one is done there, where its blockers can be read.
 */
export default function Board({ org, bands, onOpen, onList }: { org: string; bands: Band[] | undefined; onOpen: (id: number) => void; onList: (view: 'won' | 'lost') => void }) {
  const board = useQuery({ queryKey: K.board(org), queryFn: ({ signal }) => fetchBoard(org, signal), refetchInterval: 120_000 });
  if (board.isLoading) return <Spinner />;
  if (board.error || !board.data) return <ErrorNote error={board.error} onRetry={() => void board.refetch()} />;
  const cols = boardColumns(board.data);
  const working = cols.filter((c) => !c.terminal);
  const decided = cols.filter((c) => c.terminal);
  const open = working.reduce((n, c) => n + c.count, 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Pipeline" sub={`${open} open ${open === 1 ? 'tender' : 'tenders'} by stage, closing soonest first`}>
        {decided.map((c) => (
          <button key={c.key} type="button" onClick={() => onList(c.key as 'won' | 'lost')} className="flex flex-col items-end rounded-[8px] px-2 py-0.5 hover:bg-subtle">
            <span className="text-[11.5px] text-ink-3">{c.label}</span>
            <b className={cx('tabular-nums', c.key === 'won' ? 'text-success-ink dark:text-success' : 'text-ink')}>{c.count}</b>
          </button>
        ))}
      </PageHead>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2 scroll-thin" aria-label="Pipeline">
        {working.map((c) => (
          <Lane key={c.key} c={c} bands={bands} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function Lane({ c, bands, onOpen }: { c: Column; bands: Band[] | undefined; onOpen: (id: number) => void }) {
  return (
    <section aria-label={c.label} data-stage={c.key} className="flex w-[252px] shrink-0 flex-col overflow-hidden rounded-[12px] border border-line bg-ground dark:bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <b className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{c.label}</b>
        <span className="flex h-[18px] min-w-5 items-center justify-center rounded-[9px] bg-surface px-1.5 text-[11px] font-bold text-ink-2 tabular-nums dark:bg-subtle">{c.count}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 scroll-thin">
        {c.tenders.length ? (
          c.tenders.map((t) => (
            <button key={t.id} type="button" aria-label={`Open ${t.title}`} onClick={() => onOpen(t.id)} className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface px-2.5 py-2 text-left hover:border-primary/50">
              <b className="line-clamp-2 text-[12.5px] leading-snug text-ink">{t.title}</b>
              {subline(t.reference, t.organization) ? <span className="truncate text-[11.5px] text-ink-3">{subline(t.reference, t.organization)}</span> : null}
              <span className="flex items-center gap-1.5">
                <Score score={t.score} bands={bands} />
                <PriorityPill p={t.priority} />
                <span className="min-w-0 flex-1" />
                <Left r={t.remaining} className="text-[11.5px]" />
              </span>
              {t.budget_max || t.owner_name ? (
                <span className="flex items-center gap-1.5 text-[11.5px]">
                  <span className="min-w-0 flex-1 truncate text-ink-3">{t.owner_name ?? 'Nobody yet'}</span>
                  <b className="shrink-0 text-ink-2 tabular-nums">{t.budget_max ? money(t.budget_max, t.currency) : null}</b>
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <span className="px-1 py-3 text-center text-[12px] text-ink-3">Nothing here.</span>
        )}
      </div>
    </section>
  );
}
