import { useQuery } from '@tanstack/react-query';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { PageHead } from '../hr/parts';
import { gGet, K, nice, type Overview as Data } from './api';
import { JobCardView, Section, Tile, useGarage } from './parts';
import { StatGrid, type StatTone } from '../../components/StatCard';

/** Today at a glance (FR-DSH-01..03): jobs by stage — each a way into its list — what is late, and the bays. */
export default function Overview() {
  const g = useGarage();
  const q = useQuery({ queryKey: K.overview(g.org), queryFn: ({ signal }) => gGet<Data>('/overview', { org: g.org }, signal), refetchInterval: 60_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The overview could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const d = q.data;
  const c = d.counts;
  const tile = (label: string, value: number | undefined, list: string | undefined, icon: string, tone: StatTone) => (
    <Tile key={label} label={label} value={String(value ?? 0)} icon={icon} tone={tone} onClick={list ? () => g.go('jobs', { list }) : undefined} />
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
      <StatGrid min={190}>
        {tile('Open jobs', c.open, 'open', 'wrench', 'blue')}
        {tile('Checked in today', d.checked_in_today, undefined, 'log-in', 'violet')}
        {tile('Awaiting approval', c.approval, 'approval', 'hourglass', 'amber')}
        {tile('Waiting for parts', c.parts, 'parts', 'package', 'amber')}
        {tile('In progress', c.progress, 'progress', 'hammer', 'cyan')}
        {tile('Ready for delivery', c.ready, 'ready', 'car', 'green')}
        {tile('Overdue', c.overdue, 'overdue', 'alert', c.overdue ? 'red' : 'neutral')}
        {tile('Delivered today', d.delivered_today, undefined, 'check-circle', 'green')}
        {tile('Bays available', d.bays.AVAILABLE, undefined, 'warehouse', 'neutral')}
      </StatGrid>
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
        <Section
          title="Bays"
          action={
            <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => g.go('workshop')}>
              Bay board
            </button>
          }
        >
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
