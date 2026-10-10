import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Spinner, cx } from '../../../components/ui';
import { useProjectCompany } from '../company';
import { dqk, dread, fmtDay, num, type WorkloadGrid } from '../delivery';
import { openWeb } from '../parts';
import { PageHead, ProjectPick, useReportOffline } from './kit';

/**
 * Team workload (PRJ-MEM, the web's "Team workload"), in the desktop: each person's load by week — the estimated
 * hours of the tasks due that week ÷ their capacity — across every project in reach (the chosen company's), or one
 * project's. Every cell prints its percentage, so the colour is never the only signal (NFR-08); the totals are the
 * week's figures added up.
 */

/** Heat cell colours: the number is in the cell too. */
function heatTone(p: number | null): string {
  if (p === null || p <= 0) return 'bg-subtle text-ink-3';
  if (p > 100) return 'bg-danger-bg font-bold text-danger';
  if (p > 85) return 'bg-warning-bg text-warning-ink';
  if (p > 50) return 'bg-primary/25 text-ink';
  return 'bg-selection text-primary';
}

export function WorkloadScreen({ onOffline }: { onOffline: (o: boolean) => void }) {
  const { current } = useProjectCompany();
  const [project, setProject] = useState<number | null>(null);
  const q = useQuery({ queryKey: dqk.workload(project), queryFn: ({ signal }) => dread.workload(project, { signal }) });
  useReportOffline(!!q.data?.offline, onOffline);
  const grid = q.data?.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Team workload"
        actions={
          <>
            <ProjectPick value={project} onChange={setProject} />
            <Button size="sm" icon="external" onClick={() => openWeb('/projects/workload')}>
              Open on the web
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 scroll-thin">
        <section className="rounded-[12px] border border-line bg-surface">
          <div className="border-b border-line px-3.5 py-2">
            <h2 className="text-[13.5px] font-bold text-ink">Load by week</h2>
            <p className="text-[11.5px] text-ink-3">
              {project ? 'this project' : `across every project you can see${current ? ` in ${current.name}` : ''}`} · estimated hours of tasks due that week ÷ capacity
            </p>
          </div>
          <div className="p-3.5">
            {q.isLoading ? <Spinner /> : null}
            {q.error && !grid ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
            {grid ? <Heat grid={grid} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

export function Heat({ grid }: { grid: WorkloadGrid }) {
  if (!grid.people.length) return <p className="py-3 text-center text-ink-3">No one has capacity or open work in these weeks.</p>;
  const head = (label: string, k: string, strong = false) => (
    <th key={k} scope="col" className={cx('px-1 py-1 text-center text-[11.5px] text-ink-3', strong ? 'font-semibold' : 'font-normal')}>
      {label}
    </th>
  );
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[36rem] border-separate border-spacing-1 text-[11.5px]">
        <caption className="sr-only">Load by week, as a percentage of capacity</caption>
        <thead>
          <tr>
            <th scope="col" className="w-44">
              <span className="sr-only">Person</span>
            </th>
            {grid.weeks.map((w) => head(fmtDay(w), w))}
            {head('Hours', 'h', true)}
            {head('Capacity', 'c', true)}
            {head('Load', 'l', true)}
          </tr>
        </thead>
        <tbody>
          {grid.people.map((p) => {
            const hours = p.cells.reduce((n, c) => n + Number(c.hours || 0), 0);
            const capacity = p.cells.reduce((n, c) => n + Number(c.capacity || 0), 0);
            const load = capacity > 0 ? Math.round((hours / capacity) * 100) : null;
            return (
              <tr key={p.user_id}>
                <th scope="row" className="px-1 py-1.5 text-left text-[12px] font-normal whitespace-nowrap text-ink">
                  {p.name}
                </th>
                {p.cells.map((c, i) => (
                  <td key={grid.weeks[i] ?? i} title={`${num(c.hours, 1)} h of ${num(c.capacity, 1)} h`} className={cx('rounded-[6px] py-1.5 text-center font-mono', heatTone(c.percent))}>
                    {c.percent ? `${Math.round(c.percent)}%` : '—'}
                  </td>
                ))}
                <td className="text-center font-mono text-ink-2">{num(hours, 1)}</td>
                <td className="text-center font-mono text-ink-2">{num(capacity, 1)}</td>
                <td className={cx('rounded-[6px] text-center font-mono', heatTone(load))}>{load === null ? '—' : `${load}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
