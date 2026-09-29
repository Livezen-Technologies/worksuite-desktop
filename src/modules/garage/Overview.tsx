import { useQuery } from '@tanstack/react-query';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { PageHead } from '../hr/parts';
import { gGet, K, nice, type Overview as Data } from './api';
import { JobCardView, Section, Tile, useGarage } from './parts';

/** Today at a glance: jobs by stage, what is late, and the bays. */
export default function Overview() {
  const g = useGarage();
  const q = useQuery({ queryKey: K.overview(g.org), queryFn: ({ signal }) => gGet<Data>('/overview', { org: g.org }, signal), refetchInterval: 60_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The overview could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const d = q.data;
  const c = d.counts;
  const tile = (label: string, value: number | undefined, list?: string) => (
    <button key={label} type="button" disabled={!list} onClick={() => list && g.go('jobs', { list })} className="text-left disabled:cursor-default">
      <Tile label={label} value={String(value ?? 0)} />
    </button>
  );

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Overview" sub="The workshop today.">
        {g.may('garage.job.create') ? (
          <Button variant="primary" icon="user-plus" onClick={() => g.go('walkin')}>
            New walk-in
          </Button>
        ) : null}
      </PageHead>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tile('Open jobs', c.open, 'open')}
        {tile('Checked in today', d.checked_in_today)}
        {tile('Awaiting approval', c.approval, 'approval')}
        {tile('In progress', c.progress, 'progress')}
        {tile('Ready for delivery', c.ready, 'ready')}
        {tile('Overdue', c.overdue, 'overdue')}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Overdue" className="lg:col-span-2">
          {d.overdue.length === 0 ? (
            <p className="text-[13px] text-ink-3">Nothing is late.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {d.overdue.map((j) => (
                <JobCardView key={j.id} job={j} onOpen={() => g.openJob(j.id)} />
              ))}
            </div>
          )}
        </Section>
        <Section title="Bays">
          {Object.keys(d.bays).length === 0 ? (
            <p className="text-[13px] text-ink-3">No bays yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
              {Object.entries(d.bays).map(([s, n]) => (
                <li key={s} className="flex items-center justify-between">
                  <span className="text-ink-2">{nice(s)}</span>
                  <b className="tabular-nums">{n}</b>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section
        title="Latest open jobs"
        action={
          <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => g.go('board')}>
            Open the board
          </button>
        }
      >
        {d.recent.length === 0 ? (
          <p className="text-[13px] text-ink-3">No open jobs. A walk-in starts with the vehicle’s plate.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {d.recent.map((j) => (
              <JobCardView key={j.id} job={j} onOpen={() => g.openJob(j.id)} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
