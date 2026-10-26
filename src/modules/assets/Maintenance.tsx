import { Checkbox } from '../../components/Checkbox';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { toast } from '../../core/toasts';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, fetchAssets, saveJob, statusLabel, type Can, type Job } from './api';
import { Badge, Btn, Card, Field, PageHead, Pills, Table, amt, input, td, tdr, useReadOnly } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * Maintenance & repairs (D14): the jobs by state, Start / Cancel for several at once, the selected job's completion
 * (final cost, the work done, a warranty claim), and Schedule job. Whether an asset stays in repair while it has other
 * open jobs is the server's; the cost totals are the server's.
 */
export default function Maintenance({ can, onAsset }: { org: number; can: Can; active: boolean; onAsset: (id: number) => void }) {
  const ro = useReadOnly() || !(can.maintain || can.manage);
  const qc = useQueryClient();
  const [status, setStatus] = useState('open');
  const [sel, setSel] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [claim, setClaim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['assets', 'jobs', status], queryFn: ({ signal }) => apiGet<{ jobs: Job[] }>(`${BASE}/maintenance`, { status: status === 'open' ? undefined : status, per_page: 100 }, signal) });
  const jobs = (q.data?.jobs ?? []).filter((j) => (status === 'open' ? !['completed', 'cancelled'].includes(j.status) : true));
  const cur = jobs.find((j) => j.id === sel) ?? null;
  const done = () => void qc.invalidateQueries({ queryKey: ['assets'] });

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      done();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_600px] flex-col gap-3">
        <PageHead title="Maintenance & repairs">
          {picked.size ? (
            <>
              <Btn disabled={busy || ro} onClick={() => void act(() => apiPost(`${BASE}/maintenance/bulk`, { action: 'start', ids: [...picked] }), 'Started.').then(() => setPicked(new Set()))}>Start</Btn>
              <Btn disabled={busy || ro} onClick={() => void act(() => apiPost(`${BASE}/maintenance/bulk`, { action: 'cancel', ids: [...picked] }), 'Cancelled.').then(() => setPicked(new Set()))}>Cancel</Btn>
            </>
          ) : null}
          <Btn primary disabled={ro} onClick={() => setAdding(true)}>Schedule job</Btn>
        </PageHead>
        <Pills label="Status" value={status} onChange={(s) => (setStatus(s), setPicked(new Set()))} options={[{ id: 'open', label: 'Open' }, { id: 'scheduled', label: 'Scheduled' }, { id: 'in_progress', label: 'In progress' }, { id: 'completed', label: 'Completed' }, { id: 'cancelled', label: 'Cancelled' }]} />
        <Card>
          {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
          <Table head={['', 'Job', 'Asset', 'Kind', 'Due', 'Who', ['Cost', 'r'], 'Status']}>
            {jobs.map((j) => (
              <tr tabIndex={0} onKeyDown={clickOnKey} key={j.id} onClick={() => setSel(j.id)} className={cx('cursor-default', j.id === sel ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                <td className={td}><Checkbox aria-label={`Select job ${j.id}`} checked={picked.has(j.id)} onClick={(e) => e.stopPropagation()} onChange={() => setPicked((p) => { const x = new Set(p); if (x.has(j.id)) x.delete(j.id); else x.add(j.id); return x; })} /></td>
                <td className={td}><span className="font-mono text-[11px]">{`MJ-${String(j.id).padStart(4, '0')}`}</span></td>
                <td className={td}><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onAsset(j.asset_id)}>{j.asset}</button></td>
                <td className={td}>{statusLabel(j.kind)}</td>
                <td className={td}>{shortDate(j.scheduled_for)}</td>
                <td className={td}>{j.vendor ?? j.technician ?? <span className="text-ink-3">Unassigned</span>}</td>
                <td className={tdr}>{Number(j.cost) ? amt(j.cost, j.currency) : '—'}</td>
                <td className={td}><Badge status={j.overdue ? 'overdue' : j.status}>{j.overdue ? 'Overdue' : undefined}</Badge></td>
              </tr>
            ))}
          </Table>
          {q.data && !jobs.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">No jobs.</p> : null}
        </Card>
      </div>
      {cur && !['completed', 'cancelled'].includes(cur.status) ? (
        <aside aria-label="Complete job" className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
          <div className="font-mono text-[11px] text-ink-3">{`MJ-${String(cur.id).padStart(4, '0')}`}</div>
          <h2 className="m-0 text-[13.5px] font-bold">{`Complete: ${cur.asset} · ${statusLabel(cur.kind)}`}</h2>
          <Field label={`Final cost (${cur.currency})`}><input className={input} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          <Field label="Work done"><textarea className={cx(input, 'h-20 py-1.5')} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-[12.5px]"><Checkbox checked={claim} onChange={(e) => setClaim(e.target.checked)} /> Warranty claim</label>
          {cur.status === 'scheduled' ? <Btn disabled={busy || ro} onClick={() => void act(() => saveJob(cur.id, { status: 'in_progress' }), 'Started.')}>Start</Btn> : null}
          <Btn primary disabled={busy || ro} onClick={() => void act(() => saveJob(cur.id, { status: 'completed', ...(cost.trim() ? { cost: cost.trim() } : {}), notes: notes.trim() || undefined, warranty_claim: claim ? 1 : 0 }), 'Job completed.').then(() => (setCost(''), setNotes('')))}>Complete job</Btn>
        </aside>
      ) : null}
      {adding ? <NewJob onClose={() => setAdding(false)} onDone={() => (setAdding(false), done())} /> : null}
    </div>
  );
}

function NewJob({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const assets = useQuery({ queryKey: ['assets', 'list', 'for-jobs'], queryFn: ({ signal }) => fetchAssets({ per_page: 100 }, signal) });
  const [asset, setAsset] = useState(0);
  const [kind, setKind] = useState('preventive');
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 10));
  const [who, setWho] = useState('');
  const [offline, setOffline] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await saveJob(null, { asset_id: asset, kind, scheduled_for: when, technician: who.trim() || undefined, notes: notes.trim() || undefined, take_offline: offline ? 1 : 0 });
      toast('success', 'Job scheduled.');
      onDone();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Schedule job" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={busy || !asset} onClick={() => void go()}>Schedule</Btn></>}>
      <div className="flex flex-col gap-3">
        <Field label="Asset">
          <select className={input} value={asset} onChange={(e) => setAsset(Number(e.target.value))}>
            <option value={0}>Choose…</option>
            {(assets.data?.assets ?? []).map((a) => (
              <option key={a.id} value={a.id}>{`${a.asset_code} · ${a.name}`}</option>
            ))}
          </select>
        </Field>
        <Field label="Kind">
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="preventive">Preventive</option>
            <option value="scheduled">Scheduled service</option>
            <option value="corrective">Corrective</option>
            <option value="repair">Repair</option>
          </select>
        </Field>
        <Field label="Due"><input className={input} type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Technician"><input className={input} value={who} onChange={(e) => setWho(e.target.value)} /></Field>
        <Field label="Notes"><textarea className={cx(input, 'h-16 py-1.5')} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-[12.5px]"><Checkbox checked={offline} onChange={(e) => setOffline(e.target.checked)} /> Take it out of service now</label>
      </div>
    </Modal>
  );
}
