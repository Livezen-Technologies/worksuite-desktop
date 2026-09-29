import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btnSmall, Cell, PageHead, row, THead } from '../hr/parts';
import { fetchJobs, jobFilterOf, jobsRoute, K, vehicleLine, type JobFilter, type Options } from './api';
import { LISTS, OfflineBanner, OverduePill, PriorityPill, StatusPill, when } from './parts';

/**
 * The jobs (SRS §8 Jobs): a preset from the rail — where the jobs are on the
 * board, overdue, mine — or a dashboard tile's filter, narrowed further by a
 * search and the priority and branch. Every row is the server's, newest first;
 * a row opens its job card.
 */
export default function Jobs({ org, options, list, query, onJob, onGo }: { org: string; options: Options; list: string | null; query: URLSearchParams; onJob: (id: number) => void; onGo: (route: string) => void }) {
  const preset = LISTS.find((l) => l.id === (list ?? 'open'));
  const carried = jobFilterOf(query);
  const [q, setQ] = useState(carried.q ?? '');
  const [priority, setPriority] = useState(carried.priority ?? '');
  const [branch, setBranch] = useState(carried.branch_id ?? '');
  const [page, setPage] = useState(1);
  const filter: JobFilter = { ...(preset?.filter ?? {}), ...carried, q: q.trim() || undefined, priority: priority || undefined, branch_id: branch || undefined };
  const jobs = useQuery({ queryKey: K.jobs(org, { ...filter, page }), queryFn: ({ signal }) => fetchJobs(org, { ...filter, page, per_page: 50 }, signal), placeholderData: (p) => p, refetchInterval: 60_000 });
  const data = jobs.data?.data;
  const branches = options.companies.filter((c) => !org || String(c.id) === org).flatMap((c) => c.branches.filter((b) => b.branch_id > 0).map((b) => ({ value: String(b.branch_id), label: options.companies.length > 1 ? `${b.name} · ${c.name}` : b.name })));
  const fromTile = !list && Object.keys(carried).some((k) => k !== 'q');

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title={preset && !fromTile ? preset.label : 'Jobs'} sub={data ? `${data.meta.total} ${data.meta.total === 1 ? 'job' : 'jobs'}${fromTile ? ' · from the overview' : ''}` : undefined}>
        <label className="flex h-[34px] w-[240px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input
            data-garage-search
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Job number, plate, VIN, customer"
            aria-label="Search jobs"
            className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
        </label>
        <Select label="Priority" value={priority} onValueChange={(v) => (setPriority(v), setPage(1))} options={[{ value: '', label: 'Any priority' }, ...Object.entries(options.priorities).map(([value, label]) => ({ value, label }))]} />
        {branches.length > 1 ? <Select label="Branch" value={branch} onValueChange={(v) => (setBranch(v), setPage(1))} options={[{ value: '', label: 'Every branch' }, ...branches]} /> : null}
        {fromTile ? (
          <button type="button" className={btnSmall} onClick={() => onGo(jobsRoute({}, 'open'))}>
            Clear the filter
          </button>
        ) : null}
      </PageHead>
      {jobs.data?.offline ? <OfflineBanner cachedAt={jobs.data.cachedAt} /> : null}
      {jobs.isLoading ? <Spinner /> : jobs.error ? <ErrorNote error={jobs.error} onRetry={() => void jobs.refetch()} /> : null}
      {data ? (
        <section className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Jobs">
          <THead cols={[['Job', 150], ['Vehicle', null], ['Customer', 180], ['Status', 170], ['Advisor', 130], ['Promised', 120]]} />
          {data.items.length ? (
            data.items.map((j) => (
              <button key={j.id} type="button" onClick={() => onJob(j.id)} className={cx(row, 'w-full text-left hover:bg-subtle focus-visible:bg-subtle')}>
                <Cell w={150}>
                  <span className="flex items-center gap-1.5">
                    <b className="tabular-nums">{j.number}</b>
                    <PriorityPill priority={j.priority} options={options} />
                  </span>
                </Cell>
                <Cell w={null}>{vehicleLine(j.vehicle)}</Cell>
                <Cell w={180} className="text-ink-2">
                  {j.customer?.name ?? '—'}
                </Cell>
                <Cell w={170}>
                  <span className="flex items-center gap-1">
                    <StatusPill status={j.status} label={j.status_label} />
                    {j.overdue ? <OverduePill /> : null}
                  </span>
                </Cell>
                <Cell w={130} className="text-ink-2">
                  {j.service_advisor?.name ?? '—'}
                </Cell>
                <Cell w={120} className={j.overdue ? 'font-semibold text-danger' : 'text-ink-2'}>
                  {when(j.target_completion_at) || '—'}
                </Cell>
              </button>
            ))
          ) : (
            <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">No job matches.</div>
          )}
          {data.meta.pages > 1 ? (
            <div className="flex items-center justify-end gap-2 border-t border-line px-3.5 py-2 text-[12.5px] text-ink-2">
              <span>
                Page {data.meta.page} of {data.meta.pages}
              </span>
              <button type="button" className={btnSmall} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button type="button" className={btnSmall} disabled={page >= data.meta.pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
