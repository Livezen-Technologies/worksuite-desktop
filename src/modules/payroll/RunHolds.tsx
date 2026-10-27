import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Checkbox } from '../../components/Checkbox';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { ReasonSheet } from '../../components/RecordKit';
import { addHold, fetchHolds, recalculateSelected, releaseHold, type RunDetail } from './api';
import { Badge, Card, NotYet, Table, amt, td } from './parts';

/**
 * Holds and partial recalculation (PAY-RUN-05/07, Payroll 1.3): hold someone (calculated, left out of payout batches)
 * or exclude them (not calculated, draft and calculated runs only), release a hold with a note, and recalculate only
 * the people ticked. The server decides what each does to the run; the figures shown afterwards are its answer.
 */
export default function RunHolds({ d, ro }: { d: RunDetail; ro: boolean }) {
  const qc = useQueryClient();
  const id = d.run.id;
  const q = useQuery({ queryKey: ['payroll', 'holds', id], queryFn: ({ signal }) => fetchHolds(id, signal) });
  const [employee, setEmployee] = useState(0);
  const [action, setAction] = useState<'hold' | 'exclude'>('hold');
  const [reason, setReason] = useState('');
  const [releasing, setReleasing] = useState<number | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const refresh = () => void qc.invalidateQueries({ queryKey: ['payroll'] });
  const names = new Map(d.payslips.map((p) => [p.employee_id, p.employee_name ?? p.employee_no ?? `#${p.employee_id}`]));
  const editable = ['draft', 'calculated'].includes(d.run.status);

  const add = useMutation({
    mutationFn: () => addHold(id, { employee_id: employee, action, reason: reason.trim() }),
    onSuccess: () => (toast('success', action === 'hold' ? 'Held. They stay out of payout batches.' : 'Excluded from this run.'), setReason(''), setEmployee(0), refresh()),
    onError: (e) => toast('error', refusal(e)),
  });
  const recalc = useMutation({
    mutationFn: () => recalculateSelected(id, [...ticked]),
    onSuccess: (r) => (toast('success', `Recalculated ${r.employees} ${r.employees === 1 ? 'person' : 'people'}.${r.exceptions?.blocking ? ` ${r.exceptions.blocking} blocking issues.` : ''}`), setTicked(new Set()), refresh()),
    onError: (e) => toast('error', refusal(e)),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data === null) return <Card><NotYet what="Holds and partial recalculation" /></Card>;
  const holds = q.data?.holds ?? [];
  const toggle = (e: number) => setTicked((s) => { const n = new Set(s); if (n.has(e)) n.delete(e); else n.add(e); return n; });

  return (
    <div className="flex flex-col gap-2.5">
      <Card title="Held and excluded">
        <Table head={['Employee', 'What', 'Reason', 'Since', 'Released', '']}>
          {holds.map((h) => (
            <tr key={h.id}>
              <td className={td}>{names.get(h.employee_id) ?? `#${h.employee_id}`}</td>
              <td className={td}><Badge status={h.action === 'hold' ? 'blocked' : 'ne'}>{h.action === 'hold' ? 'Held' : 'Excluded'}</Badge></td>
              <td className={cx(td, 'whitespace-normal text-ink-2')}>{h.reason ?? ''}</td>
              <td className={td}>{h.created_at ? shortDate(h.created_at.slice(0, 10)) : ''}</td>
              <td className={cx(td, 'text-ink-2')}>{h.released_at ? `${shortDate(h.released_at.slice(0, 10))}${h.release_note ? ` · ${h.release_note}` : ''}` : '—'}</td>
              <td className={td}>{!h.released_at && !ro ? <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setReleasing(h.id)}>Release…</button> : null}</td>
            </tr>
          ))}
        </Table>
        {!holds.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Nobody is held or excluded on this run.</p> : null}
        {!ro && editable ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5 text-[12.5px]">
            <Select aria-label="Employee to hold" value={employee} onChange={(e) => setEmployee(Number(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-ink">
              <option value={0}>Employee…</option>
              {d.payslips.map((p) => <option key={p.employee_id} value={p.employee_id}>{p.employee_name ?? p.employee_no ?? `#${p.employee_id}`}</option>)}
            </Select>
            <Select aria-label="Hold or exclude" value={action} onChange={(e) => setAction(e.target.value as 'hold' | 'exclude')} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-ink">
              <option value="hold">Hold (calculated, not paid)</option>
              <option value="exclude">Exclude (not calculated)</option>
            </Select>
            <input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 min-w-[180px] flex-1 rounded-[7px] border border-line bg-surface px-2 text-ink outline-none focus:border-primary" />
            <button type="button" disabled={!employee || !reason.trim() || add.isPending} onClick={() => add.mutate()} className="h-8 rounded-[7px] bg-primary px-3 font-bold text-white disabled:opacity-50">{action === 'hold' ? 'Hold' : 'Exclude'}</button>
          </div>
        ) : null}
      </Card>

      {d.run.status === 'calculated' && d.can.calculate ? (
        <Card title="Recalculate selected" action={<button type="button" disabled={ro || !ticked.size || recalc.isPending} onClick={() => recalc.mutate()} className="h-7 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white disabled:opacity-50">{recalc.isPending ? 'Recalculating…' : `Recalculate ${ticked.size || ''}`.trim()}</button>}>
          <p className="m-0 px-3.5 pb-2 text-[12px] text-ink-2">Only the people ticked are worked out again; everyone else on the run is left as it is.</p>
          <Table head={['', 'Employee', 'Net']}>
            {d.payslips.map((p) => (
              <tr key={p.id}>
                <td className={td}><Checkbox aria-label={`Recalculate ${p.employee_name ?? p.employee_id}`} checked={ticked.has(p.employee_id)} onChange={() => toggle(p.employee_id)} /></td>
                <td className={td}>{p.employee_name ?? `#${p.employee_id}`}</td>
                <td className={td}>{d.can.figures ? amt(p.net) : '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}

      {releasing ? (
        <ReasonSheet
          title="Release this hold"
          body="They go back into the run's payout. The note is kept with the hold."
          label="Note"
          action="Release"
          onOk={(note) => void releaseHold(releasing, note).then(() => (setReleasing(null), toast('success', 'Released.'), refresh()), (e) => toast('error', refusal(e)))}
          onClose={() => setReleasing(null)}
        />
      ) : null}
    </div>
  );
}
