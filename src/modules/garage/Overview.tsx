import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Kpi, PageHead, Panel } from '../hr/parts';
import { canAny, fetchBoard, fetchDashboard, jobsRoute, K, needsSetup, type Job, type Options } from './api';
import { JobSummary, OfflineBanner, Pill, StatusPill, when } from './parts';

/**
 * The garage overview (SRS §9.1, §28.1, FR-DSH-01..03): the server's figures,
 * each opening the job list that counted it; the jobs by stage; what is late,
 * waiting on the customer and ready to collect; the bays. Revenue is the
 * server's to add (behind financial visibility) — it is not worked out here.
 */
const TILES: Array<{ key: string; label: string; tone?: 'amber' | 'red' | 'green' }> = [
  { key: 'open_jobs', label: 'Open jobs' },
  { key: 'vehicles_in_workshop', label: 'Vehicles in workshop' },
  { key: 'started_today', label: 'Started today' },
  { key: 'waiting_approval', label: 'Waiting for approval', tone: 'amber' },
  { key: 'waiting_parts', label: 'Waiting for parts', tone: 'amber' },
  { key: 'overdue', label: 'Overdue', tone: 'red' },
  { key: 'ready_for_delivery', label: 'Ready for delivery', tone: 'green' },
  { key: 'technicians_working', label: 'Technicians working' },
  { key: 'bays_available', label: 'Bays available' },
];

export default function Overview({ org, options, onGo, onJob, onSetup }: { org: string; options: Options; onGo: (route: string) => void; onJob: (id: number) => void; onSetup: () => void }) {
  const [branch, setBranch] = useState('');
  const dash = useQuery({ queryKey: K.dashboard(org, branch), queryFn: ({ signal }) => fetchDashboard(org, branch, signal), refetchInterval: 60_000, enabled: canAny(options, 'dashboard', org) });
  const board = useQuery({ queryKey: K.board(org, { branch_id: branch }), queryFn: ({ signal }) => fetchBoard(org, { branch_id: branch || undefined }, signal), refetchInterval: 60_000, enabled: canAny(options, 'view', org) });
  const setup = needsSetup(options, org);
  const branches = options.companies.filter((c) => !org || String(c.id) === org).flatMap((c) => c.branches.filter((b) => b.branch_id > 0).map((b) => ({ value: String(b.branch_id), label: options.companies.length > 1 ? `${b.name} · ${c.name}` : b.name })));

  if (!canAny(options, 'dashboard', org)) return <p className="m-6 text-[13px] text-ink-2">The overview is for those who may see the garage dashboard.</p>;
  const k = dash.data?.data.kpis ?? {};
  const cols = board.data?.data.columns ?? [];
  const all = cols.flatMap((c) => c.jobs);
  const late = all.filter((j) => j.overdue && j.status !== 'completed');
  const approval = cols.find((c) => c.code === 'approval')?.jobs ?? [];
  const ready = cols.find((c) => c.code === 'ready')?.jobs ?? [];
  const busiest = Math.max(1, ...cols.filter((c) => c.code !== 'delivered').map((c) => c.count));

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Overview" sub="Today in the workshop, as WorkSuite counts it">
        {branches.length > 1 ? <Select label="Branch" value={branch} onValueChange={setBranch} options={[{ value: '', label: 'Every branch' }, ...branches]} /> : null}
      </PageHead>
      {dash.data?.offline ? <OfflineBanner cachedAt={dash.data.cachedAt} /> : null}
      {setup.length ? (
        <button type="button" onClick={onSetup} className="flex items-center gap-2.5 rounded-[10px] border border-[#F3D19E] bg-[#FFF8EC] px-3.5 py-2.5 text-left text-[13px] text-[#7A3E05] hover:border-[#E0A94F] dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
          <Icon name="list-todo" size={17} />
          <span className="flex-1">
            <b>{setup.map((c) => c.name).join(', ')}</b> {setup.length === 1 ? 'is' : 'are'} not set up yet. Configure the workshop before the first service job.
          </span>
          <b>Start set-up</b>
        </button>
      ) : null}
      {dash.isLoading ? <Spinner /> : dash.error ? <ErrorNote error={dash.error} onRetry={() => void dash.refetch()} /> : null}
      {dash.data ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5" aria-label="Figures">
          {TILES.map((t) => {
            const kpi = k[t.key];
            if (!kpi) return null;
            const value = kpi.value === null ? '—' : kpi.total !== undefined ? `${kpi.value} / ${kpi.total}` : kpi.value;
            const go = kpi.filter ? () => onGo(jobsRoute(kpi.filter)) : t.key === 'bays_available' ? () => onGo('/garage?view=board') : undefined;
            return <Kpi key={t.key} label={t.label} value={value} tone={kpi.value ? t.tone : undefined} onClick={go} sub={kpi.filter ? 'Open the list' : undefined} />;
          })}
        </div>
      ) : null}
      {board.data ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <Panel title="Jobs by stage" sub="Open jobs in each column of the board">
            <div className="flex flex-col gap-1.5 px-3.5 py-3">
              {cols
                .filter((c) => c.code !== 'delivered')
                .map((c) => (
                  <button key={c.code} type="button" onClick={() => onGo(jobsRoute({ column: c.code }))} className="flex items-center gap-2.5 rounded-[6px] text-left text-[12.5px] hover:bg-subtle">
                    <span className="w-[120px] shrink-0 truncate text-ink-2">{c.label}</span>
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-subtle">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${(c.count / busiest) * 100}%` }} />
                    </span>
                    <b className="w-8 shrink-0 text-right text-ink tabular-nums">{c.count}</b>
                  </button>
                ))}
            </div>
          </Panel>
          <Panel title="Service bays" sub={board.data.data.bays.length ? `${board.data.data.bays.filter((b) => b.status === 'available').length} of ${board.data.data.bays.length} free` : 'No bays set up'}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-3">
              {board.data.data.bays.map((b) => (
                <button key={b.id} type="button" disabled={!b.job} onClick={() => b.job && onJob(b.job.id)} className="flex flex-col gap-0.5 rounded-[9px] border border-line bg-surface px-2.5 py-2 text-left enabled:hover:border-primary/50">
                  <span className="flex items-center gap-1.5">
                    <b className="text-[12.5px] text-ink">{b.code}</b>
                    <Pill tone={b.status === 'available' ? 'green' : b.status === 'occupied' ? 'blue' : 'amber'}>{b.status_label}</Pill>
                  </span>
                  <span className="truncate text-[11.5px] text-ink-3">{b.job ? `${b.job.number} · ${b.job.vehicle?.vehicle_number ?? ''}` : (b.status_reason ?? b.name)}</span>
                </button>
              ))}
            </div>
          </Panel>
          <JobPanel title="Overdue" empty="Nothing is late." jobs={late} options={options} onJob={onJob} tone="red" />
          <JobPanel title="Waiting for the customer" empty="No estimate is waiting for a decision." jobs={approval} options={options} onJob={onJob} />
          <JobPanel title="Ready for collection" empty="No vehicle is waiting to be collected." jobs={ready} options={options} onJob={onJob} />
        </div>
      ) : null}
    </div>
  );
}

function JobPanel({ title, empty, jobs, options, onJob, tone }: { title: string; empty: string; jobs: Job[]; options: Options; onJob: (id: number) => void; tone?: 'red' }) {
  return (
    <Panel title={title} sub={jobs.length ? `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}` : undefined} bodyClassName="max-h-[260px]">
      {jobs.length ? (
        jobs.slice(0, 12).map((j) => (
          <button key={j.id} type="button" onClick={() => onJob(j.id)} className="flex w-full items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-left last:border-b-0 hover:bg-subtle">
            <JobSummary job={j} options={options} />
            <span className="flex-1" />
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <StatusPill status={j.status} label={j.status_label} />
              <span className={cx('text-[11.5px]', tone === 'red' ? 'font-semibold text-danger' : 'text-ink-3')}>{j.target_completion_at ? `Promised ${when(j.target_completion_at)}` : ''}</span>
            </span>
          </button>
        ))
      ) : (
        <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-3">{empty}</div>
      )}
    </Panel>
  );
}
