import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../core/bridge';
import { ErrorNote, Spinner } from '../../components/ui';
import { humanise } from '../hr/parts';
import { fetchEnrolments, type Enrolment } from './api';
import { Badge, Card, Pills, Table, amt, td, tdr, useReadOnly } from './parts';
import { AssignmentCsv } from './PayrollExtras';

/**
 * Employees on payroll (D12): who is enrolled, in which pay group, and whether they are ready to be paid. The person's
 * own details are edited in People (HR); payroll keeps pay and readiness. A double-click (or ⌘-click) opens the pay
 * profile in a new tab.
 */
type Filter = 'all' | 'ready' | 'attention' | 'unassigned';

export function readiness(e: Enrolment): Filter {
  if (!e.group_id) return 'unassigned';
  const r = (e.readiness ?? '').toLowerCase();
  if (r === 'ready' || (!r && e.bank_verified !== false && e.bank_verified !== 0)) return 'ready';
  return 'attention';
}

export default function Employees({ figures, onOpen }: { figures: boolean; onOpen: (employeeId: number, newTab: boolean) => void }) {
  const q = useQuery({ queryKey: ['payroll', 'enrolments'], queryFn: ({ signal }) => fetchEnrolments(signal) });
  const ro = useReadOnly();
  const [only, setOnly] = useState<Filter>('all');
  const [find, setFind] = useState('');
  const all = q.data?.enrolments ?? [];
  const f = find.trim().toLowerCase();
  const rows = all.filter((e) => (only === 'all' || readiness(e) === only) && (!f || `${e.employee_no ?? ''} ${e.employee_name ?? e.name ?? ''} ${e.group_name ?? ''}`.toLowerCase().includes(f)));
  const n = (k: Filter) => all.filter((e) => readiness(e) === k).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[21px] font-extrabold text-ink">Employees on payroll</h1>
          <div className="mt-0.5 text-[12px] text-ink-2">Employee details are edited in People. Payroll keeps pay and readiness.</div>
        </div>
        <button type="button" className="h-8 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle" onClick={() => void call('app:openInBrowser', { path: '/payroll/employees' })}>
          Assign employee ↗
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pills label="Readiness" value={only} onChange={setOnly} options={[{ id: 'all', label: `All ${all.length}` }, { id: 'ready', label: `Ready ${n('ready')}` }, { id: 'attention', label: `Needs attention ${n('attention')}` }, { id: 'unassigned', label: `Not assigned ${n('unassigned')}` }]} />
        <span className="flex-1" />
        <input aria-label="Find an employee" placeholder="Find an employee" value={find} onChange={(e) => setFind(e.target.value)} className="h-[30px] w-[220px] rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-primary" />
      </div>
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        <Table head={['Employee', 'Pay group', ['Basic', 'r'], 'Bank', 'EPF no.', 'People status', 'Payroll']}>
          {rows.map((e) => {
            const r = readiness(e);
            return (
              <tr key={e.id} className="cursor-default hover:bg-subtle" onDoubleClick={() => onOpen(e.employee_id, true)}>
                <td className={td}>
                  <button type="button" className="font-bold hover:underline" onClick={(ev) => onOpen(e.employee_id, ev.metaKey || ev.ctrlKey)}>
                    {e.employee_name ?? e.name ?? `#${e.employee_id}`}
                  </button>{' '}
                  <span className="text-ink-2">{e.employee_no}</span>
                </td>
                <td className={td}>{e.group_name ?? '—'}</td>
                <td className={tdr}>{figures ? amt(e.basic, e.currency ?? '') : '—'}</td>
                <td className={td}>{e.bank_verified == null ? '—' : e.bank_verified ? 'Verified' : <span className="font-semibold text-danger">Unverified</span>}</td>
                <td className={td}>{e.epf_no ?? '—'}</td>
                <td className={td}>{humanise(e.employee_status ?? 'active')}</td>
                <td className={td}>
                  <Badge status={r === 'ready' ? 'ready' : r === 'unassigned' ? 'ne' : 'blocked'}>{r === 'ready' ? 'Ready' : r === 'unassigned' ? 'Not assigned' : humanise(e.readiness ?? 'Needs attention')}</Badge>
                </td>
              </tr>
            );
          })}
        </Table>
        {q.data && !rows.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">Nobody matches.</p> : null}
      </Card>
      <AssignmentCsv figures={figures} ro={ro} />
    </div>
  );
}
