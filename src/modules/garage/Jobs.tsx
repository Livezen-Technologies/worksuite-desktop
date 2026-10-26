import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { PageHead } from '../hr/parts';
import { gGet, K, lateBy, when, type JobList } from './api';
import { input, PriorityPill, StatusPill, useGarage } from './parts';
import { clickOnKey } from '../../components/press';

export const LISTS: { key: string; label: string }[] = [
  { key: 'open', label: 'All open' },
  { key: 'new', label: 'New & checked in' },
  { key: 'diagnosis', label: 'Inspection & diagnosis' },
  { key: 'estimate', label: 'Estimates' },
  { key: 'approval', label: 'Awaiting approval' },
  { key: 'parts', label: 'Waiting for parts' },
  { key: 'progress', label: 'In progress' },
  { key: 'qc', label: 'Quality check' },
  { key: 'ready', label: 'Ready for delivery' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

/** The job lists the web has, one per stage, with the plate, customer or number to search. */
export default function Jobs({ list }: { list: string }) {
  const g = useGarage();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [text]);
  const view = LISTS.some((l) => l.key === list) ? list : 'open';
  const data = useQuery({
    queryKey: K.jobs(g.org, { view, q, page }),
    queryFn: ({ signal }) => gGet<JobList>('/jobs', { view, q, page, org: g.org }, signal),
    placeholderData: keepPreviousData,
  });
  const d = data.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / Math.max(1, d.per_page))) : 1;

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title={LISTS.find((l) => l.key === view)?.label ?? 'Jobs'} sub={d ? `${d.total} ${d.total === 1 ? 'job' : 'jobs'}` : undefined}>
        <input className={cx(input, 'w-64')} placeholder="Plate, job number or customer" aria-label="Search jobs" value={text} onChange={(e) => setText(e.target.value)} />
      </PageHead>
      <nav className="flex flex-wrap gap-1" aria-label="Job lists">
        {LISTS.map((l) => (
          <button
            key={l.key}
            type="button"
            aria-current={view === l.key ? 'page' : undefined}
            onClick={() => g.go('jobs', { list: l.key })}
            className={cx('h-7 rounded-[8px] px-2.5 text-[12px] font-semibold', view === l.key ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}
          >
            {l.label}
            {d?.counts[l.key] ? <span className="ml-1 tabular-nums opacity-75">{d.counts[l.key]}</span> : null}
          </button>
        ))}
      </nav>
      {data.isLoading ? (
        <Spinner />
      ) : data.error || !d ? (
        <ErrorNote error={data.error ?? new Error('The jobs could not be loaded.')} onRetry={() => void data.refetch()} />
      ) : d.jobs.length === 0 ? (
        <p className="text-[13px] text-ink-3">No jobs here.</p>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-subtle text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <tr>
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Promised</th>
                <th className="px-3 py-2">Advisor</th>
              </tr>
            </thead>
            <tbody>
              {d.jobs.map((j) => (
                <tr tabIndex={0} onKeyDown={clickOnKey} key={j.id} className="cursor-pointer border-t border-line hover:bg-subtle" onClick={() => g.openJob(j.id)}>
                  <td className="px-3 py-2">
                    <button type="button" className="font-mono text-[12px] font-semibold text-primary" onClick={() => g.openJob(j.id)}>
                      {j.number}
                    </button>{' '}
                    <PriorityPill priority={j.priority} />
                  </td>
                  <td className="px-3 py-2">
                    <b className="tracking-wide">{j.vehicle?.number ?? '—'}</b>
                    <span className="block text-[11.5px] text-ink-3">{[j.vehicle?.make, j.vehicle?.model].filter(Boolean).join(' ')}</span>
                  </td>
                  <td className="px-3 py-2">{j.customer?.name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={j.status} label={j.status_label} />
                  </td>
                  <td className={cx('px-3 py-2', j.overdue && 'font-semibold text-danger')}>{j.overdue ? lateBy(j.late_minutes) : when(j.target)}</td>
                  <td className="px-3 py-2 text-ink-2">{j.advisor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[12.5px] text-ink-2">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">
            {page} of {pages}
          </span>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
