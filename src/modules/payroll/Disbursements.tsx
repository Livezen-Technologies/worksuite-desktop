import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { ConfirmSheet, ReasonSheet } from '../finance/parts';
import { humanise } from '../hr/parts';
import { approveBatch, bankFile, createBatch, fetchBatch, fetchPayouts, fetchRuns, markPaid, markSent, runTitle } from './api';
import { Badge, Card, Table, amt, td, tdr, useReadOnly } from './parts';

/**
 * Disbursements (D10): a locked run's payment batches, one batch's lines with masked accounts, and its acts — create,
 * approve (a second person), Save bank file…, sent, Mark paid… (which posts net pay to Finance, G1). The bank file is
 * produced and logged by the server; this computer checks its SHA-256 and saves it where the person chooses (0600).
 */
const PAYABLE = ['locked', 'paying', 'paid'];

export async function saveBankFile(batchId: number): Promise<string | null> {
  const f = await bankFile(batchId);
  const base64 = f.content ?? f.base64 ?? '';
  const sha256 = f.sha256 ?? f.file_sha256 ?? '';
  const name = (f.file_name ?? f.name ?? `payroll-batch-${batchId}.csv`).replace(/[^A-Za-z0-9 ._()-]/g, '_').slice(0, 120);
  if (!base64 || !sha256) throw new Error('The server did not send the file.');
  return call('payroll:saveFile', { name, base64, sha256 });
}

export default function Disbursements({ runId, onRun }: { runId: number | null; onRun: (id: number) => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ['payroll', 'runs', 'payable'], queryFn: ({ signal }) => fetchRuns('', 1, signal) });
  const payable = (runs.data?.items ?? []).filter((r) => PAYABLE.includes(r.status));
  const id = runId ?? payable[0]?.id ?? null;
  const batches = useQuery({ queryKey: ['payroll', 'payouts', id], queryFn: ({ signal }) => fetchPayouts(id!, signal), enabled: !!id });
  const [sel, setSel] = useState<number | null>(null);
  const b = sel ?? batches.data?.batches[0]?.id ?? null;
  const detail = useQuery({ queryKey: ['payroll', 'batch', b], queryFn: ({ signal }) => fetchBatch(b!, signal), enabled: !!b });
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [sending, setSending] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['payroll'] });
  const fail = (e: unknown) => toast('error', refusal(e));
  const make = useMutation({ mutationFn: () => createBatch(id!), onSuccess: (r) => (setSel(Number(r.id ?? r.batch_id) || null), refresh()), onError: fail });
  const approve = useMutation({ mutationFn: () => approveBatch(b!), onSuccess: () => (toast('success', 'Approved.'), refresh()), onError: fail });
  const d = detail.data;
  const cur = d?.batch.currency ?? '';
  const can = d?.can ?? {};

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <h1 className="m-0 flex-1 text-[21px] font-extrabold text-ink">Payment batches</h1>
        <Select aria-label="Run" value={id ?? 0} onChange={(e) => (setSel(null), onRun(Number(e.target.value)))} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink">
          {payable.map((r) => <option key={r.id} value={r.id}>{runTitle(r)}</option>)}
        </Select>
        <button type="button" disabled={ro || !id || make.isPending || batches.data?.can?.create === false} onClick={() => make.mutate()} className="h-8 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink disabled:opacity-50">New batch</button>
      </div>
      {runs.data && !payable.length ? <p className="m-0 text-[12.5px] text-ink-3">A run is paid once it is approved and locked.</p> : null}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)] items-start gap-2.5">
        <Card>
          {batches.isLoading ? <Spinner /> : batches.error ? <div className="p-3"><ErrorNote error={batches.error} /></div> : null}
          {(batches.data?.batches ?? []).map((x) => (
            <button key={x.id} type="button" onClick={() => setSel(x.id)} aria-current={x.id === b ? 'true' : undefined} className={cx('flex w-full flex-col items-start gap-0.5 border-b border-line/70 px-3.5 py-2.5 text-left text-[12.5px]', x.id === b ? 'bg-selection dark:bg-selection' : 'hover:bg-subtle')}>
              <span className="flex w-full items-center gap-2"><b className="flex-1 font-mono text-[11.5px]">{x.reference ?? `PAY-${x.id}`}</b><Badge status={x.failed ? 'failed' : x.status}>{x.failed ? `${x.failed} failed` : humanise(x.status)}</Badge></span>
              <span className="text-[11.5px] text-ink-2">{[humanise(x.method ?? 'bank'), x.line_count != null ? `${x.line_count} lines` : null, x.total ? amt(x.total, x.currency ?? '') : null].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {batches.data && !batches.data.batches.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No batch yet.</p> : null}
        </Card>
        {d ? (
          <Card>
            <div className="flex flex-wrap items-start gap-2 px-3.5 pt-3 pb-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11.5px] text-ink-2">{d.batch.reference ?? `PAY-${d.batch.id}`}</div>
                <div className="text-[13px] text-ink-2">{[amt(d.batch.total, cur), humanise(d.batch.method ?? 'bank'), d.batch.value_date ? `value date ${shortDate(d.batch.value_date)}` : null].filter(Boolean).join(' · ')}</div>
              </div>
              {can.approve ? <button type="button" disabled={ro || approve.isPending} onClick={() => approve.mutate()} className="h-8 rounded-[7px] border border-line px-3 text-[12.5px] font-semibold text-ink disabled:opacity-50">Approve</button> : null}
              {can.file ? <button type="button" disabled={ro} onClick={() => setSaving(true)} className="h-8 rounded-[7px] border border-line px-3 text-[12.5px] font-semibold text-ink disabled:opacity-50">Save bank file…</button> : null}
              {can.sent ? <button type="button" disabled={ro} onClick={() => setSending(true)} className="h-8 rounded-[7px] border border-line px-3 text-[12.5px] font-semibold text-ink disabled:opacity-50">Sent to bank…</button> : null}
              {can.settle || can.mark_paid ? <button type="button" disabled={ro} onClick={() => setPaying(true)} className="h-8 rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50">Mark paid…</button> : null}
            </div>
            <Table head={['Employee', 'Bank · account', ['Amount', 'r'], 'Status']}>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td className={td}>{l.employee_name}</td>
                  <td className={cx(td, 'text-ink-2')}>{[l.bank, l.account].filter(Boolean).join(' · ')}</td>
                  <td className={tdr}>{amt(l.amount)}</td>
                  <td className={td}><Badge status={l.status === 'settled' ? 'paid' : l.status}>{humanise(l.status)}</Badge></td>
                </tr>
              ))}
            </Table>
            {d.files.length ? <p className="m-0 px-3.5 py-2 text-[11px] text-ink-2">{`Files made: ${d.files.map((f) => `${f.file_name} (${f.created_at.slice(0, 16)}, ${f.file_sha256.slice(0, 8)}…)`).join(' · ')}`}</p> : null}
            {d.postings.length ? <p className="m-0 px-3.5 pb-2 text-[11px] text-ink-2">{`In the books: ${d.postings.map((p) => p.journal_no ?? p.id).join(', ')}`}</p> : null}
          </Card>
        ) : detail.isLoading ? <Spinner /> : null}
      </div>
      {saving && b ? (
        <ConfirmSheet
          title="Save salary file"
          body={`The file holds full account numbers for ${d?.lines.length ?? 0} people. Saving it is logged with your name, the time, this computer and the file's SHA-256.`}
          action="Save…"
          onYes={() =>
            void saveBankFile(b).then(
              (path) => (setSaving(false), path ? toast('success', 'Bank file saved.') : null, refresh()),
              (e) => (setSaving(false), toast('error', e instanceof Error && 'status' in e ? refusal(e) : errorMessage(e))),
            )
          }
          onClose={() => setSaving(false)}
        />
      ) : null}
      {sending && b ? <ReasonSheet title="Sent to the bank" body="The bank's reference for this upload." label="Reference" action="Record" onOk={(r) => void markSent(b, r).then(() => (setSending(false), refresh()), fail)} onClose={() => setSending(false)} /> : null}
      {paying && b ? (
        <ReasonSheet
          title="Mark paid"
          body="Every line sent to the bank is settled in full and net pay is posted to Finance (Payroll payable to Bank)."
          label="Bank reference"
          action="Mark paid"
          onOk={(r) => void markPaid(b, r).then((x) => (setPaying(false), toast(x.problems?.length ? 'error' : 'success', x.problems?.length ? x.problems.join(' ') : `${x.settled} paid${x.posting?.journal_no ? ` · ${x.posting.journal_no}` : ''}.`), refresh()), fail)}
          onClose={() => setPaying(false)}
        />
      ) : null}
    </div>
  );
}
