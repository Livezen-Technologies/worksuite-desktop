import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { Checkbox } from '../../components/Checkbox';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal } from '../finance/api';
import { ReasonSheet } from '../finance/parts';
import { humanise } from '../hr/parts';
import { ATTACHMENT_MAX, attachmentName, ATTACHMENT_TYPES, cancelInput, csvRows, fetchClaimable, fetchGroups, fetchInputs, fetchPeriods, importInputs, sendExpenses, uploadInputAttachment, type ImportResult } from './api';
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
  const org = groups.data?.groups.find((x) => x.id === g)?.org_id ?? 0;
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

      {org ? <ExpensesToPayroll org={org} ro={ro || locked} onSent={() => void qc.invalidateQueries({ queryKey: ['payroll', 'inputs', p] })} /> : null}

      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        {q.data === null ? <NotYet what="Period inputs" /> : null}
        {q.data ? (
          <Table head={['Employee', 'Component', ['Qty', 'r'], ['Amount', 'r'], 'Source', 'Status', 'File', '']}>
            {q.data.inputs.map((i) => (
              <tr key={i.id} className={cx(i.source_module && 'bg-ground')}>
                <td className={td}>{i.employee_name ?? `#${i.employee_id}`}</td>
                <td className={cx(td, 'font-mono text-[11px]')}>{i.component_code}</td>
                <td className={tdr}>{i.quantity ?? ''}</td>
                <td className={tdr}>{amt(i.amount)}</td>
                <td className={cx(td, 'text-ink-2')}>{[i.source_module ? humanise(i.source_module) : humanise(i.source ?? 'manual'), i.source_ref ?? i.note].filter(Boolean).join(' · ')}</td>
                <td className={td}><Badge status={i.status === 'paid' ? 'done' : i.status}>{humanise(i.status)}</Badge></td>
                <td className={td}><Attachment id={i.id} has={!!i.file_id} canAdd={!ro && !locked && i.status === 'open'} onDone={() => void qc.invalidateQueries({ queryKey: ['payroll', 'inputs', p] })} /></td>
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

/** PAY-INP-04: the supporting file on an input — open it, or add one (≤ 10 MB; PDF, image, CSV or text). */
function Attachment({ id, has, canAdd, onDone }: { id: number; has: boolean; canAdd: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const open = () =>
    void attachmentName(id)
      .then((name) => call('transfers:download', { payrollDoc: { kind: 'input-attachment', id: String(id) }, name, open: true }))
      .catch((e) => toast('error', errorMessage(e)));
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > ATTACHMENT_MAX) return void toast('error', 'The file is over 10 MB.');
    if (!ATTACHMENT_TYPES.test(f.name)) return void toast('error', 'Attach a PDF, PNG, JPEG, WebP, CSV or text file.');
    setBusy(true);
    try {
      await uploadInputAttachment(id, f);
      toast('success', 'Attached.');
      onDone();
    } catch (e) {
      toast('error', [404, 405].includes((e as { status?: number }).status ?? 0) ? 'Attachments need a newer WorkSuite server (Payroll 1.6).' : refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      {has ? <button type="button" className="font-semibold text-primary hover:underline" onClick={open}>Open</button> : null}
      {canAdd ? (
        <label className={cx('cursor-pointer font-semibold text-primary hover:underline', busy && 'opacity-50')}>
          {busy ? 'Attaching…' : has ? 'Replace' : 'Attach'}
          <input type="file" className="hidden" aria-label={`Attach a file to input ${id}`} accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
      ) : null}
    </span>
  );
}

/** PAY-INP-06: approved, unpaid expense claims sent to payroll as non-taxable reimbursement inputs, each once. */
function ExpensesToPayroll({ org, ro, onSent }: { org: number; ro: boolean; onSent: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payroll', 'claimable', org], queryFn: ({ signal }) => fetchClaimable(org, signal), retry: false });
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const send = useMutation({
    mutationFn: () => sendExpenses(org, ticked.size ? [...ticked] : undefined),
    onSuccess: (r) => {
      toast(r.failed.length ? 'error' : 'success', `${r.sent} sent to payroll.${r.failed.length ? ` ${r.failed.length} not: ${r.failed.map((f) => f.error).join(' ')}` : ''}`);
      setTicked(new Set());
      void qc.invalidateQueries({ queryKey: ['payroll', 'claimable', org] });
      onSent();
    },
    onError: (e) => toast('error', refusal(e)),
  });
  if (!q.data || !q.data.claims.length) return null; // a server without it, no permission, or nothing waiting
  const claims = q.data.claims;
  return (
    <Card
      title={`Expense claims to pay through payroll · ${claims.length}`}
      action={q.data.enabled ? <button type="button" disabled={ro || send.isPending} onClick={() => send.mutate()} className="h-7 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white disabled:opacity-50">{send.isPending ? 'Sending…' : ticked.size ? `Send ${ticked.size}` : 'Send all'}</button> : null}
    >
      {!q.data.enabled ? <p className="m-0 px-3.5 pb-2 text-[12px] text-ink-2">Paying expenses through payroll is off in Payroll settings.</p> : null}
      <Table head={['', 'Claim', 'Claimant', 'Spent', ['Amount', 'r'], 'For']}>
        {claims.map((c) => (
          <tr key={c.id}>
            <td className={td}><Checkbox aria-label={`Send claim ${c.claim_no ?? c.id}`} disabled={!q.data!.enabled || ro} checked={ticked.has(c.id)} onChange={() => setTicked((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} /></td>
            <td className={cx(td, 'font-mono text-[11px]')}>{c.claim_no ?? `#${c.id}`}</td>
            <td className={td}>{c.claimant ?? '—'}{c.employee_id ? '' : <span className="text-danger"> · not on payroll</span>}</td>
            <td className={td}>{c.spent_on ?? ''}</td>
            <td className={tdr}>{amt(c.base_amount)}</td>
            <td className={cx(td, 'whitespace-normal text-ink-2')}>{c.description ?? ''}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
