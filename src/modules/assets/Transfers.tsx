import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, createTransfer, decideTransfer, fetchAssets, fetchPeople, type Can, type Transfer } from './api';
import { Badge, Btn, Card, Field, Note, PageHead, Pills, Table, input, td, useReadOnly } from './parts';

/**
 * Transfers (D12): pending, completed and rejected moves, Approve & move or Reject for someone who may decide — the
 * person who raised a move never decides it (the server refuses; the screen says so) — and a new transfer to a
 * person or a location. A move between companies posts its journals in both companies' books on the server.
 */
export default function Transfers({ org, can }: { org: number; can: Can; active: boolean }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const q = useQuery({ queryKey: ['assets', 'transfers', status, org], queryFn: ({ signal }) => apiGet<{ transfers: Transfer[] }>(`${BASE}/transfers`, { status, org: org || undefined, per_page: 100 }, signal) });
  const assets = useQuery({ queryKey: ['assets', 'list', 'transferable', org], queryFn: ({ signal }) => fetchAssets({ per_page: 100, org: org || undefined }, signal), staleTime: 60_000 });
  const people = useQuery({ queryKey: ['assets', 'people', org], queryFn: ({ signal }) => fetchPeople(org || null, signal), staleTime: 300_000 });
  const [asset, setAsset] = useState(0);
  const [toType, setToType] = useState<'employee' | 'location'>('employee');
  const [to, setTo] = useState(0);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const done = () => void qc.invalidateQueries({ queryKey: ['assets'] });

  const decide = async (t: Transfer, d: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await decideTransfer(t.id, d);
      toast('success', d === 'approve' ? `${t.asset_code} moved.` : 'Transfer rejected.');
      done();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!asset || (toType === 'employee' ? !to : !label.trim())) return;
    setBusy(true);
    try {
      await createTransfer({ asset_id: asset, to_holder_type: toType, to_holder_id: toType === 'employee' ? to : undefined, to_holder_label: toType === 'location' ? label.trim() : undefined, transfer_date: date, note: why.trim() || undefined });
      toast('success', 'Sent for approval.');
      setWhy('');
      done();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-3">
        <PageHead title="Transfers" />
        <Pills label="Status" value={status} onChange={setStatus} options={[{ id: 'pending', label: 'Pending' }, { id: 'approved', label: 'Completed' }, { id: 'rejected', label: 'Rejected' }]} />
        <Card>
          {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
          <Table head={['Asset', 'From → to', 'Raised', 'Status', '']}>
            {(q.data?.transfers ?? []).map((t) => (
              <tr key={t.id}>
                <td className={td}><b>{t.asset}</b><div className="font-mono text-[11px] text-ink-3">{t.asset_code}</div></td>
                <td className={td}>{`${t.from ?? '—'} → ${t.to ?? '—'}`}</td>
                <td className={td}>{`${t.requested_by ?? '—'} · ${shortDate(t.created_at)}`}</td>
                <td className={td}><Badge status={t.status} /></td>
                <td className={td}>
                  {t.blocked ? (
                    <span className="text-[11.5px] text-ink-3">{t.blocked}</span>
                  ) : t.status === 'pending' && (t.can_decide ?? (can.approve || can.manage)) ? (
                    t.mine ? (
                      <span className="text-[11.5px] text-ink-3">You raised this — another approver decides</span>
                    ) : (
                      <span className="flex gap-1.5">
                        <Btn danger disabled={busy || ro} onClick={() => void decide(t, 'reject')}>Reject</Btn>
                        <Btn primary disabled={busy || ro} onClick={() => void decide(t, 'approve')}>Approve & move</Btn>
                      </span>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
          {q.data && !q.data.transfers.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">No transfers.</p> : null}
        </Card>
      </div>
      <aside aria-label="New transfer" className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
        <h2 className="m-0 text-[13.5px] font-bold">New transfer</h2>
        <Field label="Asset">
          <select className={input} value={asset} onChange={(e) => setAsset(Number(e.target.value))}>
            <option value={0}>Choose…</option>
            {(assets.data?.assets ?? []).map((a) => (
              <option key={a.id} value={a.id}>{`${a.asset_code} · ${a.name}`}</option>
            ))}
          </select>
        </Field>
        <Pills label="Move to" value={toType} onChange={setToType} options={[{ id: 'employee', label: 'Person' }, { id: 'location', label: 'Location' }]} />
        {toType === 'employee' ? (
          <Field label="Person">
            <select className={input} value={to} onChange={(e) => setTo(Number(e.target.value))}>
              <option value={0}>Choose…</option>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Site › room"><input className={input} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        )}
        <Field label="Date"><input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reason"><input className={input} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
        <Note>A company-to-company move also posts a journal in both companies' books.</Note>
        <Btn primary disabled={ro || busy || !asset} onClick={() => void send()}>Send for approval</Btn>
      </aside>
    </div>
  );
}
