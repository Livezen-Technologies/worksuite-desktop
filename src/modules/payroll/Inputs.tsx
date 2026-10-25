import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal } from '../finance/api';
import { ReasonSheet } from '../finance/parts';
import { humanise } from '../hr/parts';
import { cancelInput, csvRows, fetchGroups, fetchInputs, fetchPeriods, importInputs, type ImportResult } from './api';
import { Badge, Card, NotYet, Table, amt, td, tdr, useReadOnly } from './parts';

/**
 * Period inputs (D15): the one-time lines a run will pay — overtime and unpaid leave from People, commission from
 * Sales or SalonMate (each paid once, by its source reference), and lines typed in. Drop a CSV on the page to check
 * it: the server reads every row as a dry run and nothing is saved until the rows are reviewed and imported.
 */
export default function Inputs({ periodId }: { periodId: number | null }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['payroll', 'groups'], queryFn: ({ signal }) => fetchGroups(signal), staleTime: 300_000 });
  const [group, setGroup] = useState(0);
  const g = group || groups.data?.groups[0]?.id || 0;
  const periods = useQuery({ queryKey: ['payroll', 'periods', g], queryFn: ({ signal }) => fetchPeriods(g, signal), enabled: g > 0 });
  const [picked, setPicked] = useState(0);
  const list = periods.data?.periods ?? [];
  const p = picked || (periodId && list.some((x) => x.id === periodId) ? periodId : list.find((x) => x.status !== 'closed')?.id) || 0;
  const q = useQuery({ queryKey: ['payroll', 'inputs', p], queryFn: ({ signal }) => fetchInputs(p, signal), enabled: p > 0 });
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<{ name: string; csv: string; rows: number } | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const locked = !!q.data?.locked;

  const dry = useMutation({ mutationFn: (csv: string) => importInputs(p, csv, true), onSuccess: setCheck, onError: (e) => toast('error', refusal(e)) });
  const commit = useMutation({
    mutationFn: () => importInputs(p, file!.csv, false),
    onSuccess: (r) => (toast('success', `${r.created.length} lines added.`), setFile(null), setCheck(null), void qc.invalidateQueries({ queryKey: ['payroll', 'inputs', p] })),
    onError: (e) => toast('error', refusal(e)),
  });

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (ro || locked || !p) return;
    const f = e.dataTransfer.files[0];
    if (!f || !/\.csv$/i.test(f.name)) return void toast('error', 'Drop a .csv file.');
    if (f.size > 2_000_000) return void toast('error', 'That file is too big to check here.');
    const csv = await f.text();
    const rows = Math.max(0, csvRows(csv).length - 1);
    setFile({ name: f.name, csv, rows });
    setCheck(null);
    dry.mutate(csv);
  };

  return (
    <div className="relative flex flex-col gap-3" onDragOver={(e) => (e.preventDefault(), !ro && !locked && setOver(true))} onDragLeave={() => setOver(false)} onDrop={(e) => void onDrop(e)}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[21px] font-extrabold text-ink">Period inputs</h1>
          <div className="mt-0.5 text-[12px] text-ink-2">{locked ? 'The period has a locked run. Inputs can no longer change.' : 'Drop a CSV here to check it before anything is saved.'}</div>
        </div>
        <Select aria-label="Pay group" value={g} onChange={(e) => (setGroup(Number(e.target.value)), setPicked(0))} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink">
          {(groups.data?.groups ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <Select aria-label="Period" value={p} onChange={(e) => setPicked(Number(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink">
          {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      </div>

      {file ? (
        <Card title={`${file.name} · ${file.rows} rows`} action={<button type="button" className="text-[12px] font-semibold text-ink-2 hover:underline" onClick={() => (setFile(null), setCheck(null))}>Discard</button>}>
          {dry.isPending ? <Spinner /> : check ? (
            <div className="flex flex-col gap-2 px-3.5 pb-3 text-[12.5px]">
              <span>{`${check.valid} rows can be added · ${check.errors.length} cannot`}</span>
              {check.errors.slice(0, 20).map((x) => <span key={x.row} className="text-danger">{`Row ${x.row}: ${x.error}`}</span>)}
              <button type="button" disabled={!check.valid || commit.isPending || ro} onClick={() => commit.mutate()} className="self-start rounded-[7px] bg-primary px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">
                {commit.isPending ? 'Adding…' : `Add ${check.valid} rows`}
              </button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        {q.data === null ? <NotYet what="Period inputs" /> : null}
        {q.data ? (
          <Table head={['Employee', 'Component', ['Qty', 'r'], ['Amount', 'r'], 'Source', 'Status', '']}>
            {q.data.inputs.map((i) => (
              <tr key={i.id} className={cx(i.source_module && 'bg-ground')}>
                <td className={td}>{i.employee_name ?? `#${i.employee_id}`}</td>
                <td className={cx(td, 'font-mono text-[11px]')}>{i.component_code}</td>
                <td className={tdr}>{i.quantity ?? ''}</td>
                <td className={tdr}>{amt(i.amount)}</td>
                <td className={cx(td, 'text-ink-2')}>{[i.source_module ? humanise(i.source_module) : humanise(i.source ?? 'manual'), i.source_ref ?? i.note].filter(Boolean).join(' · ')}</td>
                <td className={td}><Badge status={i.status === 'paid' ? 'done' : i.status}>{humanise(i.status)}</Badge></td>
                <td className={tdr}>{i.status === 'open' && !ro && !locked ? <button type="button" className="font-semibold text-danger hover:underline" onClick={() => setCancelling(i.id)}>Cancel</button> : null}</td>
              </tr>
            ))}
          </Table>
        ) : null}
        {q.data && !q.data.inputs.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No inputs for this period.</p> : null}
        <p className="m-0 px-3.5 py-2 text-[11px] text-ink-2">Grey rows come from People or another module and are paid once, by their source reference.</p>
      </Card>

      {over ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[12px] border-2 border-dashed border-primary bg-[#EAEDFB]/80 text-[14px] font-bold text-[#23349E] dark:bg-selection/80 dark:text-primary">
          Drop to check the CSV · nothing is saved until you review the rows
        </div>
      ) : null}
      {cancelling ? (
        <ReasonSheet title="Cancel this input" body="It will not be paid. The reason is kept." label="Reason" action="Cancel input" danger onOk={(r) => void cancelInput(cancelling, r).then(() => (setCancelling(null), void qc.invalidateQueries({ queryKey: ['payroll', 'inputs', p] })), (e) => toast('error', refusal(e)))} onClose={() => setCancelling(null)} />
      ) : null}
    </div>
  );
}
