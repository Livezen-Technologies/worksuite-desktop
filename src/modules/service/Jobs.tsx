import { useState } from 'react';
import { money } from '@shared/service';
import { clickOnKey } from '../../components/press';
import { Button, cx, ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import { useJobs } from './api';
import { deviceName, input, StatusChip, when } from './parts';

const SCOPES: Array<[string, string]> = [['all', 'All'], ['active', 'Active'], ['waiting', 'Waiting'], ['ready_for_pickup', 'Ready'], ['overdue', 'Overdue']];

/** The repair list (blueprint §5): search, scope, sort, paging; a row opens its job card. */
export default function Jobs({ scope, onScope, selected, onOpen }: { scope: string; onScope: (s: string) => void; selected: string | null; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('created_at');
  const list = useJobs({ scope, q: q.trim() || undefined, sort, dir: 'desc', page, per_page: 50 });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.data.total / list.data.data.per_page)) : 1;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[18px] font-bold">Repair jobs</h1>
        {list.data?.offline ? <OfflineNote cachedAt={list.data.cachedAt} /> : null}
        <span className="flex-1" />
        <div role="tablist" aria-label="Scope" className="flex gap-1">
          {SCOPES.map(([v, l]) => <button key={v} role="tab" type="button" aria-selected={scope === v} onClick={() => { onScope(v); setPage(1); }} className={cx('rounded-[7px] px-2 py-1 text-[12.5px]', scope === v ? 'bg-yellow-bg font-bold text-warning dark:bg-selection dark:text-primary' : 'text-ink-2 hover:bg-subtle')}>{l}</button>)}
        </div>
        <input aria-label="Search jobs" placeholder="Job, customer, IMEI, serial" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className={cx(input, 'w-[220px]')} />
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-[7px] border border-line bg-surface px-1.5 py-1 text-[13px]">
          <option value="created_at">Newest</option><option value="promised_at">Promised date</option><option value="priority">Priority</option>
        </select>
      </div>
      {list.isPending ? <Spinner /> : list.isError ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : (
        <>
          <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-line bg-surface scroll-thin">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface text-left text-ink-3"><tr>{['Job', 'Device / Customer', 'Status', 'Technician', 'Promised', 'Payment', 'Total'].map((h) => <th key={h} className="px-2.5 py-1.5 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {list.data.data.items.map((r) => (
                  <tr key={r.id} tabIndex={0} onKeyDown={clickOnKey} onClick={() => onOpen(r.id)} aria-selected={selected === r.id} className={cx('cursor-pointer border-t border-line hover:bg-subtle', selected === r.id ? 'bg-yellow-bg dark:bg-selection' : '')}>
                    <td className="px-2.5 py-1.5 font-semibold">{r.number}{r.under_warranty ? <span title="Under warranty" className="ml-1 text-success">●</span> : null}</td>
                    <td className="max-w-[260px] px-2.5 py-1.5"><div className="truncate font-medium">{deviceName(r.device)}</div><div className="truncate text-ink-3">{r.customer?.name ?? '—'}</div></td>
                    <td className="px-2.5 py-1.5"><StatusChip status={r.status} /></td>
                    <td className="px-2.5 py-1.5">{r.technician?.name ?? <span className="text-ink-3">Unassigned</span>}</td>
                    <td className={cx('px-2.5 py-1.5', r.overdue ? 'font-semibold text-danger' : '')}>{when(r.promised_at)}</td>
                    <td className="px-2.5 py-1.5 capitalize">{r.payment_status ?? '—'}</td>
                    <td className="px-2.5 py-1.5">{money(r.total, r.currency ?? 'LKR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.data.data.items.length ? <p className="p-4 text-[13px] text-ink-3">No jobs match.</p> : null}
          </div>
          <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <span>{list.data.data.total} jobs · page {page} of {pages}</span><span className="flex-1" />
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </>
      )}
    </div>
  );
}
