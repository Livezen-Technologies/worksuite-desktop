import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { humanise } from '../../components/PageKit';
import { fetchSettlement, fetchSettlements, refreshSettlement, settlementRun } from './api';
import { Badge, Card, NotYet, Table, amt, td, tdr, useReadOnly } from './parts';

/**
 * Final settlements (D17, PAY-FNF-01..04): each one starts from an HR offboarding case. The items — leave
 * encashment, gratuity, notice pay, loans, unreturned assets — and the clearance come from the server; the settlement
 * run is refused (409) while any clearance item on the case is open, and the screen says which.
 */
export default function Settlements({ open, onOpen, onRun }: { open: number | null; onOpen: (id: number) => void; onRun: (runId: number) => void }) {
  const q = useQuery({ queryKey: ['payroll', 'settlements'], queryFn: ({ signal }) => fetchSettlements(signal) });
  const list = q.data?.settlements ?? [];
  const id = open ?? list[0]?.id ?? null;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="m-0 text-[21px] font-extrabold text-ink">Final settlements</h1>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data === null ? <Card><NotYet what="Final settlement" /></Card> : null}
      {q.data ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-2.5">
          <Card>
            {list.map((s) => (
              <button key={s.id} type="button" onClick={() => onOpen(s.id)} aria-current={s.id === id ? 'true' : undefined} className={cx('flex w-full items-center gap-2 border-b border-line/70 px-3.5 py-2.5 text-left text-[12.5px]', s.id === id ? 'bg-selection dark:bg-selection' : 'hover:bg-subtle')}>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{s.employee_name}</b>
                  <span className="text-[11.5px] text-ink-2">{s.last_working_date ? `Last day ${shortDate(s.last_working_date)}` : ''}{s.open_items ? ` · ${s.open_items} open` : ''}</span>
                </span>
                <Badge status={s.open_items ? 'waiting' : s.status}>{humanise(s.status)}</Badge>
              </button>
            ))}
            {!list.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No settlements. One opens when an offboarding case in People is completed.</p> : null}
          </Card>
          {id ? <Detail id={id} onRun={onRun} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Detail({ id, onRun }: { id: number; onRun: (runId: number) => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payroll', 'settlement', id], queryFn: ({ signal }) => fetchSettlement(id, signal) });
  const again = useMutation({ mutationFn: () => refreshSettlement(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['payroll', 'settlement', id] }), onError: (e) => toast('error', refusal(e)) });
  const run = useMutation({ mutationFn: () => settlementRun(id), onSuccess: (r) => onRun(r.run_id), onError: (e) => toast('error', refusal(e)) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const { settlement: s, totals, blocking, clearance } = q.data;
  return (
    <div className="flex flex-col gap-2.5">
      <Card>
        <div className="flex flex-wrap items-start gap-2 px-3.5 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] text-ink-2">{`FS-${s.id}${s.offboarding_case_id ? ` · offboarding case ${s.offboarding_case_id}` : ''}`}</div>
            <h2 className="m-0 text-[17px] font-extrabold text-ink">{s.employee_name}</h2>
            <div className="text-[11.5px] text-ink-2">{s.last_working_date ? `Last day ${shortDate(s.last_working_date)}` : ''}</div>
          </div>
          <button type="button" disabled={ro || again.isPending} onClick={() => again.mutate()} className="h-8 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink disabled:opacity-50">Read the case again</button>
          <button type="button" disabled={ro || !q.data.can.run || blocking.length > 0 || run.isPending} title={blocking.length ? blocking.join(' ') : undefined} onClick={() => run.mutate()} className="h-8 rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50">Create settlement run</button>
        </div>
        {blocking.length ? <p className="m-0 px-3.5 pb-2 text-[12.5px] font-semibold text-warning">{`Waiting for clearance: ${blocking.join(' · ')}`}</p> : null}
        <Table head={['Item', 'From', 'Status', ['Amount', 'r']]}>
          {s.items.map((i) => (
            <tr key={i.key}>
              <td className={td}>{i.label}</td>
              <td className={cx(td, 'text-ink-2')}>{humanise(i.source)}</td>
              <td className={td}><Badge status={i.status === 'open' && i.blocking ? 'blocked' : i.status}>{humanise(i.status)}</Badge></td>
              <td className={tdr}>{i.status === 'waived' ? '—' : i.kind === 'deduction' ? `−${amt(i.amount).replace('-', '')}` : amt(i.amount)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={td} colSpan={3}>Net before tax</td>
            <td className={tdr}>{amt(totals.net)}</td>
          </tr>
        </Table>
        <p className="m-0 px-3.5 py-2 text-[11px] text-ink-2">Clearance items come live from the People offboarding case. A waived item is not deducted.</p>
      </Card>
      {clearance.length ? (
        <Card title="Clearance">
          <div className="flex flex-col gap-1.5 px-3.5 pb-3 text-[12.5px]">
            {clearance.map((c, i) => (
              <div key={i} className="flex gap-2"><span className="flex-1">{c.label}{c.owner ? ` · ${c.owner}` : ''}</span><Badge status={c.status}>{humanise(c.status)}</Badge></div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
