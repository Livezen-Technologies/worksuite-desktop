import { Checkbox } from '../../components/Checkbox';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, acknowledge, createRequest, fetchLookups, fetchMine, reportIssue, toConfirm, type AssetRequest, type MyAsset } from './api';
import { Badge, Btn, Card, Field, Note, PageHead, Table, input, td, useReadOnly } from './parts';

/**
 * My equipment (D09, T-02, T-05): what I hold, confirming a handover ("I received it" / "Something is wrong"), my
 * requests and their stage, asking for equipment, and reporting a problem with something I hold — which the server
 * turns into a repair job (Assets 1.1). `?confirm=<assignment>` arrives from the D03 banner.
 */
export default function MyAssets({ confirm, problem, onAsset }: { confirm: number | null; problem: boolean; onAsset: (id: number) => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['assets', 'mine'], queryFn: ({ signal }) => fetchMine(signal) });
  const reqs = useQuery({ queryKey: ['assets', 'requests', 'mine'], queryFn: ({ signal }) => apiGet<{ requests: AssetRequest[] }>(`${BASE}/requests`, { mine: 1, per_page: 20 }, signal) });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);
  const [kind, setKind] = useState('Not working');
  const [details, setDetails] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [notYet, setNotYet] = useState('');

  if (mine.isPending) return <Spinner />;
  if (mine.error) return <ErrorNote error={mine.error} onRetry={() => void mine.refetch()} />;
  const items = mine.data?.assets ?? [];
  const waiting = items.filter(toConfirm);
  const focus = waiting.find((a) => a.assignment_id === confirm) ?? waiting[0];
  const reported = items.find((a) => a.id === pick) ?? items[0];

  const answer = async (a: MyAsset, ok: boolean) => {
    setBusy(true);
    try {
      // "Something is wrong" is a problem report on the item (a repair job), not a confirmation.
      const r = ok ? await acknowledge(a.assignment_id) : await reportIssue(a.id, { title: `Handover of ${a.asset_code}: something is wrong`, description: 'Reported from the handover confirmation on the desktop.', severity: 'normal' });
      if (r === null) setNotYet(ok ? 'Confirming a handover' : 'Reporting a problem');
      else toast('success', ok ? `Thanks — ${a.name} confirmed.` : 'IT has been told something is wrong.');
      void qc.invalidateQueries({ queryKey: ['assets'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!reported || !details.trim()) return;
    setBusy(true);
    try {
      const r = await reportIssue(reported.id, { title: `${kind}: ${reported.name}`, description: details.trim(), severity: blocking ? 'high' : 'normal' });
      if (r === null) setNotYet('Reporting a problem');
      else {
        toast('success', 'Sent to IT.');
        setDetails('');
      }
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-3">
        <PageHead title="My equipment">
          <Btn primary disabled={ro} onClick={() => setAsking(true)}>Request equipment</Btn>
        </PageHead>
        {mine.data?.note ? <Note tone="warn">{mine.data.note}</Note> : null}
        {notYet ? <Note tone="warn">{`${notYet} needs a newer WorkSuite server (Assets 1.1).`}</Note> : null}
        {focus ? (
          <Note>
            <span className="min-w-0 flex-1">{`Confirm your ${focus.name} (${focus.asset_code}) — issued ${shortDate(focus.assigned_at)}.`}</span>
            <Btn disabled={busy || ro} onClick={() => void answer(focus, false)}>Something is wrong</Btn>
            <Btn primary disabled={busy || ro} onClick={() => void answer(focus, true)}>I received it</Btn>
          </Note>
        ) : null}
        <Card>
          <Table head={['Item', 'Since', 'Note', 'Status']}>
            {items.map((a) => (
              <tr key={a.assignment_id} className="hover:bg-subtle" onDoubleClick={() => onAsset(a.id)}>
                <td className={td}><b>{a.name}</b><div className="font-mono text-[11px] text-ink-3">{a.asset_code}</div></td>
                <td className={td}>{shortDate(a.assigned_at)}</td>
                <td className={td}>{a.expected_return_at ? `Return by ${shortDate(a.expected_return_at)}` : 'Return on exit'}{a.warranty_days_left != null && a.warranty_days_left >= 0 && a.warranty_days_left <= 30 ? ` · warranty ends ${shortDate(a.warranty_end)}` : ''}</td>
                <td className={td}>{toConfirm(a) ? <Badge status="waiting">To confirm</Badge> : <Badge status="confirmed">Confirmed</Badge>}</td>
              </tr>
            ))}
          </Table>
          {!items.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">Nothing is issued to you.</p> : null}
        </Card>
        <Card title="My requests">
          {(reqs.data?.requests ?? []).filter((r) => r.is_mine).map((r) => (
            <div key={r.id} className="flex items-center gap-2 border-t border-line/70 px-3.5 py-2 text-[12.5px]">
              <span className="font-mono text-[11px]">{r.request_no ?? `#${r.id}`}</span>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <Badge status={r.status} />
            </div>
          ))}
          {reqs.data && !reqs.data.requests.some((r) => r.is_mine) ? <p className="m-0 px-3.5 pb-3 text-[12px] text-ink-3">No requests.</p> : null}
        </Card>
      </div>
      <aside aria-label="Report a problem" className={cx('flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 self-start rounded-[10px] border bg-surface p-3.5', problem ? 'border-primary' : 'border-line')}>
        <h2 className="m-0 text-[13.5px] font-bold">Report a problem</h2>
        <Field label="Item">
          <select className={input} value={reported?.id ?? ''} onChange={(e) => setPick(Number(e.target.value))}>
            {items.map((a) => (
              <option key={a.assignment_id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="What is wrong?">
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
            {['Not working', 'Battery or charging', 'Damaged', 'Slow', 'Lost or stolen', 'Something else'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="Details">
          <textarea className={cx(input, 'h-24 py-1.5')} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px]"><Checkbox checked={blocking} onChange={(e) => setBlocking(e.target.checked)} /> I can't work without it</label>
        <Btn primary disabled={ro || busy || !items.length || !details.trim()} onClick={() => void send()}>Send to IT</Btn>
      </aside>
      {asking ? <RequestDialog onClose={() => setAsking(false)} /> : null}
    </div>
  );
}

export function RequestDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['assets', 'lookups', 'categories'], queryFn: ({ signal }) => fetchLookups('categories', signal), staleTime: 300_000 });
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState(0);
  const [why, setWhy] = useState('');
  const [needed, setNeeded] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createRequest({ title: title.trim(), category_id: cat || undefined, justification: why.trim() || undefined, needed_by: needed || undefined });
      toast('success', 'Request sent to your manager.');
      void qc.invalidateQueries({ queryKey: ['assets'] });
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Request equipment" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={busy || !title.trim()} onClick={() => void submit()}>Send request</Btn></>}>
      <div className="flex flex-col gap-3">
        <Field label="What do you need?"><input className={input} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
        <Field label="Category">
          <select className={input} value={cat} onChange={(e) => setCat(Number(e.target.value))}>
            <option value={0}>—</option>
            {(cats.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Why"><textarea className={cx(input, 'h-20 py-1.5')} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
        <Field label="Needed by"><input className={input} type="date" value={needed} onChange={(e) => setNeeded(e.target.value)} /></Field>
        <p className="m-0 text-[11.5px] text-ink-3">It goes to your manager, then IT.</p>
      </div>
    </Modal>
  );
}
