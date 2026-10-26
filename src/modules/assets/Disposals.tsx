import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, decideDisposal, fetchAssets, raiseDisposal, statusLabel, type Can, type Disposal } from './api';
import { Badge, Btn, Card, Field, Note, PageHead, Table, amt, input, td, tdr, useReadOnly } from './parts';

/**
 * Disposal & write-off (D19): every disposal with its proceeds, book value and the server's gain or loss; Approve or
 * Reject for someone else in the company with "Approve disposals" (never the person who raised it — the server's
 * rule); and raising one — sold, scrapped, donated, recycled, or written off as lost or stolen.
 */
const METHODS = ['sold', 'scrapped', 'donated', 'recycled', 'lost', 'stolen'];

export default function Disposals({ can, preset }: { org: number; can: Can; active: boolean; preset: number | null }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assets', 'disposals'], queryFn: ({ signal }) => apiGet<{ disposals: Disposal[] }>(`${BASE}/disposals`, { per_page: 100 }, signal) });
  const assets = useQuery({ queryKey: ['assets', 'list', 'disposable'], queryFn: ({ signal }) => fetchAssets({ per_page: 100 }, signal), staleTime: 60_000 });
  const [asset, setAsset] = useState(preset ?? 0);
  const [method, setMethod] = useState(preset ? 'lost' : 'sold');
  const [proceeds, setProceeds] = useState('0.00');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
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
  const chosen = (assets.data?.assets ?? []).find((a) => a.id === asset);

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_600px] flex-col gap-3">
        <PageHead title="Disposal & write-off" />
        <Card>
          {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} /></div> : null}
          <Table head={['Asset', 'Method', ['Proceeds', 'r'], ['Book value', 'r'], ['Gain / loss', 'r'], 'Status', '']}>
            {(q.data?.disposals ?? []).map((d) => (
              <tr key={d.id}>
                <td className={td}><b>{`${d.asset_code} ${d.asset}`}</b><div className="text-[11px] text-ink-3">{`${d.requested_by ?? '—'} · ${shortDate(d.created_at)}`}</div></td>
                <td className={td}>{statusLabel(d.method)}</td>
                <td className={tdr}>{amt(d.proceeds, d.currency)}</td>
                <td className={tdr}>{amt(d.net_book_value, d.currency)}</td>
                <td className={cx(tdr, d.gain_loss.startsWith('-') ? 'text-danger' : 'text-success')}>{amt(d.gain_loss, d.currency)}</td>
                <td className={td}><Badge status={d.status} /></td>
                <td className={td}>
                  {d.status === 'pending' && (can.approve || can.finance) ? (
                    <span className="flex gap-1.5">
                      <Btn danger disabled={busy || ro} onClick={() => void act(() => decideDisposal(d.id, 'reject'), 'Disposal rejected.')}>Reject</Btn>
                      <Btn primary disabled={busy || ro} onClick={() => void act(() => decideDisposal(d.id, 'approve'), 'Disposal approved.')}>Approve</Btn>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        <p className="m-0 text-[11.5px] text-ink-3">Lost, stolen and retired are written off here, so the cost leaves the accounts with the asset.</p>
      </div>
      <aside aria-label="Raise disposal" className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
        <h2 className="m-0 text-[13.5px] font-bold">{chosen ? `${method === 'lost' || method === 'stolen' ? 'Write off' : 'Dispose of'} ${chosen.asset_code}` : 'Raise disposal'}</h2>
        <Field label="Asset">
          <select className={input} value={asset} onChange={(e) => setAsset(Number(e.target.value))}>
            <option value={0}>Choose…</option>
            {(assets.data?.assets ?? []).filter((a) => a.status !== 'assigned').map((a) => (
              <option key={a.id} value={a.id}>{`${a.asset_code} · ${a.name}`}</option>
            ))}
          </select>
        </Field>
        {chosen ? <div className="text-[12px] text-ink-2">{`Book value ${amt(chosen.net_book_value, chosen.currency)} · ${chosen.company ?? 'No company'}`}</div> : null}
        <div className="flex gap-2">
          <Field label="Method" className="flex-1">
            <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>{statusLabel(m)}</option>
              ))}
            </select>
          </Field>
          <Field label="Date" className="flex-1"><input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {method === 'sold' ? <Field label="Proceeds"><input className={input} inputMode="decimal" value={proceeds} onChange={(e) => setProceeds(e.target.value)} /></Field> : null}
        <Field label="Reason"><textarea className={cx(input, 'h-20 py-1.5')} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Note>The journal and the gain or loss are worked out by the server; it is approved by someone else in this company with "Approve disposals".</Note>
        <Btn primary disabled={ro || busy || !asset || !reason.trim()} onClick={() => void act(() => raiseDisposal({ asset_id: asset, method, proceeds: method === 'sold' ? proceeds : '0.00', disposal_date: date, reason: reason.trim() }), 'Sent for approval.').then(() => setReason(''))}>Send for approval</Btn>
      </aside>
    </div>
  );
}
