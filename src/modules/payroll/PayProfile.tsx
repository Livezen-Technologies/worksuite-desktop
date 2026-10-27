import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { Field, Sheet, btn, btnPrimary, humanise, input } from '../../components/PageKit';
import { approveSalary, fetchLoans, fetchSalary, proposeSalary } from './api';
import { Badge, Card, Table, amt, td, tdr, useReadOnly } from './parts';
import { StatutoryIdsCard } from './PayrollExtras';

/**
 * An employee's pay profile (D13): the pay assignment, salary history with its approvals, and loans — with Change
 * salary (D14), which proposes a revision for a second person to approve. Arrears for months already closed are the
 * server's to work out and go into the next run; the sheet says so rather than adding them up here.
 */
type Tab = 'pay' | 'ids' | 'history' | 'loans';

export default function PayProfile({ employee, figures, onBack }: { employee: number; figures: boolean; onBack: () => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const [tab, setTab] = useState<Tab>('pay');
  const [changing, setChanging] = useState(false);
  const q = useQuery({ queryKey: ['payroll', 'salary', employee], queryFn: ({ signal }) => fetchSalary(employee, signal) });
  const loans = useQuery({ queryKey: ['payroll', 'loans', employee], queryFn: ({ signal }) => fetchLoans(employee, signal), enabled: figures && tab === 'loans' });
  const approve = useMutation({
    mutationFn: (id: number) => approveSalary(id),
    onSuccess: () => (toast('success', 'Approved.'), void qc.invalidateQueries({ queryKey: ['payroll', 'salary', employee] })),
    onError: (e) => toast('error', refusal(e)),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const e = q.data.enrolment;
  const name = e?.employee_name ?? e?.name ?? `Employee ${employee}`;
  const current = q.data.revisions.find((r) => r.status === 'approved' || r.status === 'active');

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="self-start text-[12px] font-semibold text-primary hover:underline">← Employees</button>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[21px] font-extrabold text-ink">{name}</h1>
          <div className="mt-0.5 text-[12px] text-ink-2">{[e?.employee_no, e?.group_name, e?.starts_on ? `since ${shortDate(e.starts_on)}` : null].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" className={btn} onClick={() => void call('app:openInBrowser', { path: `/hr/employees/${employee}` })}>Open in People ↗</button>
        <button type="button" className={btnPrimary} disabled={ro} onClick={() => setChanging(true)}>Change salary</button>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-line">
        {(['pay', 'ids', 'history', 'loans'] as Tab[]).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={t === tab} onClick={() => setTab(t)} className={cx('h-9 border-b-2 px-2.5 text-[12.5px] font-semibold', t === tab ? 'border-primary text-primary' : 'border-transparent text-ink-2')}>
            {t === 'pay' ? 'Pay & assignment' : t === 'ids' ? 'Statutory IDs' : t === 'history' ? 'History' : 'Loans'}
          </button>
        ))}
      </div>
      {tab === 'pay' ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Card title="Assignment">
            <dl className="m-0 grid grid-cols-[140px_1fr] gap-y-1.5 px-3.5 pb-3 text-[12.5px]">
              <dt className="text-ink-2">Pay group</dt><dd className="m-0">{e?.group_name ?? 'Not assigned'}</dd>
              <dt className="text-ink-2">Cost centre</dt><dd className="m-0">{e?.cost_centre ?? '—'}</dd>
              <dt className="text-ink-2">Bank</dt><dd className="m-0">{e?.bank_verified == null ? '—' : e.bank_verified ? 'Verified' : 'Not verified'}</dd>
              <dt className="text-ink-2">EPF no.</dt><dd className="m-0">{e?.epf_no ?? '—'}</dd>
            </dl>
          </Card>
          <Card title="Current salary">
            <div className="px-3.5 pb-3 text-[12.5px]">
              <div className="text-[20px] font-extrabold tabular-nums">{figures ? amt(current?.gross ?? e?.basic, e?.currency ?? '') : '—'}</div>
              <div className="text-ink-2">{current ? `From ${shortDate(current.effective_from)} · ${humanise(current.kind)}` : 'No approved salary yet'}</div>
            </div>
          </Card>
        </div>
      ) : tab === 'ids' ? (
        <StatutoryIdsCard employee={employee} ro={ro} />
      ) : tab === 'history' ? (
        <Card>
          <Table head={['From', 'Kind', ['Gross', 'r'], 'Reason', 'Status', '']}>
            {q.data.revisions.map((r) => (
              <tr key={r.id}>
                <td className={td}>{shortDate(r.effective_from)}</td>
                <td className={td}>{humanise(r.kind)}</td>
                <td className={tdr}>{figures ? amt(r.gross) : '—'}</td>
                <td className={cx(td, 'whitespace-normal text-ink-2')}>{r.reason ?? ''}</td>
                <td className={td}><Badge status={r.status === 'proposed' || r.status === 'pending' ? 'waiting' : r.status === 'approved' ? 'done' : 'ne'}>{humanise(r.status)}</Badge></td>
                <td className={tdr}>
                  {(r.status === 'proposed' || r.status === 'pending') && r.proposed_by !== me && !ro ? (
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => approve.mutate(r.id)}>Approve</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
          {!q.data.revisions.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No salary recorded.</p> : null}
        </Card>
      ) : (
        <Card>
          {!figures ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Loans need the payroll figures grant.</p> : loans.isLoading ? <Spinner /> : (
            <Table head={['Loan', 'Type', ['Instalment', 'r'], ['Balance', 'r'], 'Status']}>
              {(loans.data?.loans ?? []).map((l) => (
                <tr key={l.id}>
                  <td className={cx(td, 'font-mono text-[11px]')}>{l.reference ?? `L-${l.id}`}</td>
                  <td className={td}>{humanise(l.kind)}</td>
                  <td className={tdr}>{amt(l.instalment)}</td>
                  <td className={tdr}>{amt(l.outstanding)}</td>
                  <td className={td}><Badge status={l.status}>{humanise(l.status)}</Badge></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {changing ? <SalaryChange employee={employee} name={name} kinds={q.data.kinds} current={current?.gross ?? null} onClose={() => setChanging(false)} onDone={() => (setChanging(false), void qc.invalidateQueries({ queryKey: ['payroll', 'salary', employee] }))} /> : null}
    </div>
  );
}

/** Change salary (D14): a proposal. History keeps the old amount; approved runs never change. */
export function SalaryChange({ employee, name, kinds, current, onClose, onDone }: { employee: number; name: string; kinds: string[]; current: string | null; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState(kinds.includes('revision') ? 'revision' : (kinds[0] ?? 'revision'));
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01');
  const [gross, setGross] = useState('');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => proposeSalary(employee, { kind, effective_from: from, gross: gross.replace(/,/g, '').trim(), reason: reason.trim() }),
    onSuccess: () => (toast('success', 'Proposed. A second person approves it.'), onDone()),
    onError: (e) => toast('error', refusal(e)),
  });
  const ok = /^\d+(\.\d{1,2})?$/.test(gross.replace(/,/g, '').trim()) && reason.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(from);
  const back = from < new Date().toISOString().slice(0, 8) + '01';
  return (
    <Sheet
      title="Change salary"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={!ok || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save change'}</button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-2">{`${name}${current ? ` · now ${amt(current)}` : ''}`}</p>
      <Field label="Reason">
        <Select aria-label="Kind of change" className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => <option key={k} value={k}>{humanise(k)}</option>)}
        </Select>
      </Field>
      <Field label="Effective from"><input type="date" aria-label="Effective from" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="New gross salary"><input aria-label="New gross salary" inputMode="decimal" className={input} value={gross} onChange={(e) => setGross(e.target.value)} /></Field>
      <Field label="Why"><textarea aria-label="Why" rows={3} className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {back ? <p className="m-0 rounded-[8px] bg-warning-bg px-2.5 py-2 text-[12px] font-semibold text-warning">This goes back into months already closed. The server works out the arrears and they go into the next run, with EPF and tax on them.</p> : null}
      <p className="m-0 text-[11.5px] text-ink-3">History keeps the old amounts. Approved runs never change.</p>
    </Sheet>
  );
}
