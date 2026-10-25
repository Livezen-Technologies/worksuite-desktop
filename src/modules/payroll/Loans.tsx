import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { ReasonSheet } from '../finance/parts';
import { humanise } from '../hr/parts';
import { approveLoan, cancelLoan, fetchLoans, type Loan } from './api';
import { Badge, Card, Table, amt, td, tdr, useReadOnly } from './parts';

/**
 * Loans and advances (D16): every loan with what is left to recover, and one loan's detail. Approving is
 * `payroll.approve` and never by whoever recorded it (four-eyes, the server's rule). Recording a loan and recovering
 * it are on the web; the recovery itself is a pay rule.
 */
export default function Loans({ figures }: { figures: boolean }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const q = useQuery({ queryKey: ['payroll', 'loans', 0], queryFn: ({ signal }) => fetchLoans(undefined, signal), enabled: figures });
  const [sel, setSel] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<Loan | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['payroll', 'loans'] });
  const approve = useMutation({ mutationFn: (id: number) => approveLoan(id), onSuccess: () => (toast('success', 'Approved.'), refresh()), onError: (e) => toast('error', refusal(e)) });
  if (!figures) return <p className="m-0 text-[13px] text-ink-2">Loans and advances need the payroll figures grant.</p>;
  const loans = q.data?.loans ?? [];
  const pick = loans.find((l) => l.id === sel) ?? loans[0] ?? null;
  const active = loans.filter((l) => l.status === 'active');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[21px] font-extrabold text-ink">Loans &amp; advances</h1>
          <div className="mt-0.5 text-[12px] text-ink-2">{`${active.length} active`}</div>
        </div>
        <button type="button" className="h-8 rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50" disabled={ro} onClick={() => void call('app:openInBrowser', { path: '/payroll/loans' })}>New loan ↗</button>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-2.5">
        <Card>
          <Table head={['Loan', 'Employee', 'Type', ['Instalment', 'r'], ['Balance', 'r'], 'Status']}>
            {loans.map((l) => (
              <tr key={l.id} onClick={() => setSel(l.id)} aria-selected={pick?.id === l.id} className={cx('cursor-default', pick?.id === l.id ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                <td className={cx(td, 'font-mono text-[11px]')}>{l.reference ?? `L-${l.id}`}</td>
                <td className={td}><b>{l.employee_name}</b></td>
                <td className={td}>{humanise(l.kind)}</td>
                <td className={tdr}>{amt(l.instalment)}</td>
                <td className={tdr}>{amt(l.outstanding)}</td>
                <td className={td}><Badge status={l.status}>{humanise(l.status)}</Badge></td>
              </tr>
            ))}
          </Table>
          {q.data && !loans.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No loans.</p> : null}
        </Card>
        {pick ? (
          <Card title={`${pick.reference ?? `L-${pick.id}`} · ${humanise(pick.kind)}`}>
            <dl className="m-0 grid grid-cols-[110px_1fr] gap-y-1.5 px-3.5 text-[12.5px]">
              <dt className="text-ink-2">Employee</dt><dd className="m-0 font-semibold">{pick.employee_name}</dd>
              <dt className="text-ink-2">Principal</dt><dd className="m-0">{amt(pick.principal)}</dd>
              <dt className="text-ink-2">Schedule</dt><dd className="m-0">{pick.instalments ? `${pick.instalments} × ${amt(pick.instalment)}` : amt(pick.instalment)}{pick.starts_on ? ` from ${shortDate(pick.starts_on)}` : ''}</dd>
              <dt className="text-ink-2">Recovered</dt><dd className="m-0">{amt(pick.recovered)}</dd>
              <dt className="text-ink-2">Outstanding</dt><dd className="m-0 font-bold">{amt(pick.outstanding)}</dd>
              {pick.disbursement_journal_no ? (<><dt className="text-ink-2">Paid out</dt><dd className="m-0">{`${pick.disbursed_at ? shortDate(pick.disbursed_at) : ''} · ${pick.disbursement_journal_no}`}</dd></>) : null}
            </dl>
            <div className="flex gap-2 px-3.5 py-3">
              {pick.status === 'draft' && !ro && pick.recorded_by !== me ? <button type="button" className="h-7 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white" onClick={() => approve.mutate(pick.id)}>Approve</button> : null}
              {(pick.status === 'draft' || pick.status === 'active') && !ro ? <button type="button" className="h-7 rounded-[7px] border border-line px-2.5 text-[12px] font-semibold text-danger" onClick={() => setCancelling(pick)}>Cancel…</button> : null}
            </div>
          </Card>
        ) : null}
      </div>
      {cancelling ? <ReasonSheet title="Cancel this loan" body="Nothing more is recovered. The reason is kept." label="Reason" action="Cancel loan" danger onOk={(r) => void cancelLoan(cancelling.id, r).then(() => (setCancelling(null), refresh()), (e) => toast('error', refusal(e)))} onClose={() => setCancelling(null)} /> : null}
    </div>
  );
}
