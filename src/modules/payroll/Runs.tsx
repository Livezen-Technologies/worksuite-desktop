import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { apiGet } from '../../core/api';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { shortDate } from '../finance/api';
import { fetchGroups, KIND_LABEL, PILLS, STATUS_LABEL, type RunList } from './api';
import { Badge, Card, Kbd, Pills, Table, amt, td, tdr, useReadOnly } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * Payroll runs (D02): status pills, a pay-group filter, and the list. ↑↓ move, ↵ opens, ⌘↵ opens in a new window,
 * a double-click opens in a new tab. Amounts only for somebody who may see figures.
 */
export default function Runs({ figures, active, onOpen, onNew }: { figures: boolean; active: boolean; onOpen: (id: number, how?: 'tab' | 'here' | 'window', approve?: boolean) => void; onNew: () => void }) {
  const ro = useReadOnly();
  const [status, setStatus] = useState('');
  const [group, setGroup] = useState(0);
  const [page, setPage] = useState(1);
  const [cursor, setAt] = useState({ key: '', i: 0 });
  const fkey = `${status}|${group}|${page}`;
  const at = cursor.key === fkey ? cursor.i : 0;
  const body = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ['payroll', 'runs', status, group, page],
    queryFn: ({ signal }) => apiGet<RunList>('/api/payroll/runs', { status: status || undefined, group_id: group || undefined, page, per_page: 25 }, signal),
    placeholderData: keepPreviousData,
  });
  const groups = useQuery({ queryKey: ['payroll', 'groups'], queryFn: ({ signal }) => fetchGroups(signal), staleTime: 300_000 });
  const items = q.data?.items ?? [];
  const show = figures && q.data?.figures !== false;
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / Math.max(1, q.data.per_page))) : 1;
  useEffect(() => {
    if (active) body.current?.focus({ preventScroll: true });
  }, [active]);

  const onKey = (e: KeyboardEvent) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAt({ key: fkey, i: Math.min(items.length - 1, at + 1) });
      }
    else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAt({ key: fkey, i: Math.max(0, at - 1) });
      }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const r = items[at];
      if (r) onOpen(r.id, e.metaKey || e.ctrlKey ? 'window' : 'here');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[21px] font-extrabold tracking-[-.3px] text-ink">Payroll runs</h1>
          <div className="mt-0.5 text-[12px] text-ink-2">Double-click a run to open it in a new tab</div>
        </div>
        <button type="button" disabled={ro} onClick={onNew} className="inline-flex h-8 items-center rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-50">
          New run
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pills label="Status" value={status} onChange={(v) => (setStatus(v), setPage(1))} options={[{ id: '', label: 'All' }, ...PILLS.map((s) => ({ id: s, label: STATUS_LABEL[s] ?? s }))]} />
        <span className="flex-1" />
        <Select aria-label="Pay group" value={group} onChange={(e) => (setGroup(Number(e.target.value)), setPage(1))} className="h-[30px] rounded-[7px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink">
          <option value={0}>All pay groups</option>
          {(groups.data?.groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        <div ref={body} tabIndex={0} role="grid" aria-label="Payroll runs" aria-activedescendant={items[at] ? `run-${items[at]!.id}` : undefined} onKeyDown={onKey} className="outline-none">
          <Table head={['Run', 'Pay group', 'Period', 'Type', ['Staff', 'r'], ['Net', 'r'], 'Status', 'Updated']}>
            {items.map((r, i) => (
              <tr tabIndex={0} onKeyDown={clickOnKey}
                key={r.id}
                id={`run-${r.id}`}
                aria-selected={i === at}
                onClick={() => setAt({ key: fkey, i })}
                onDoubleClick={() => onOpen(r.id, 'tab')}
                className={cx('cursor-default', i === at ? 'bg-selection shadow-[inset_3px_0_0_var(--color-primary)] dark:bg-selection' : r.status === 'submitted' ? 'bg-rail dark:bg-warning-bg/30' : 'hover:bg-subtle')}
              >
                <td className={td}>
                  <button type="button" className="font-mono text-[11px] text-primary hover:underline" onClick={() => onOpen(r.id, 'here', r.status === 'submitted')}>
                    {r.reference ?? `RUN-${r.id}`}
                  </button>
                </td>
                <td className={td}><b>{r.group_name ?? r.group_code ?? '—'}</b></td>
                <td className={td}>{r.period_name ?? (r.period_starts_on ? shortDate(r.period_starts_on) : '—')}</td>
                <td className={td}>{KIND_LABEL[r.kind] ?? r.kind}</td>
                <td className={tdr}>{r.employee_count ?? '—'}</td>
                <td className={tdr}>{show ? amt(r.net_total, r.currency ?? '') : '—'}</td>
                <td className={td}><Badge status={r.status}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                <td className={td}>{r.created_at ? shortDate(r.created_at) : ''}</td>
              </tr>
            ))}
          </Table>
          {q.data && !items.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">No runs match.</p> : null}
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-3.5 text-[11px] text-ink-2">
        <span><Kbd>↑↓</Kbd> move</span>
        <span><Kbd>↵</Kbd> open</span>
        <span><Kbd>⌘↵</Kbd> open in new window</span>
        <span>Amounts are hidden without the payroll figures grant</span>
        {pages > 1 ? (
          <span className="ml-auto flex items-center gap-2">
            <button type="button" className="font-semibold text-primary disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            {`Page ${page} of ${pages}`}
            <button type="button" className="font-semibold text-primary disabled:opacity-40" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
