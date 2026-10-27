import { Checkbox } from '../../components/Checkbox';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, bulkRequests, decideRequest, fetchAssets, fulfilRequest, type AssetRequest, type Can } from './api';
import { RequestDialog } from './MyAssets';
import { Badge, Btn, Card, Field, Kbd, PageHead, Pills, input, useReadOnly } from './parts';

/**
 * Requests & approvals (D10) and fulfilling one (D11): the queue by stage, the selected request with its chain
 * (submitted → manager → IT → issue), Approve (⌘↵) and Reject (⌘⌫) with a note, Space to select several and decide
 * them together, and Issue… for one IT approved — choosing a matching asset that is in stock. Who may decide each
 * step is the server's; a request someone raised themselves is never offered to them to approve.
 */
type Stage = 'waiting' | 'open' | 'ready' | 'closed';
const OPEN = new Set(['pending', 'manager_approved', 'it_approved']);

export function stageOf(r: AssetRequest): Stage {
  if (r.status === 'it_approved') return 'ready';
  if (r.status === 'pending' || r.status === 'manager_approved') return r.is_mine ? 'open' : 'waiting';
  return 'closed';
}

export default function Requests({ can, active, open }: { org: number; can: Can; active: boolean; open: number | null }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>('waiting');
  const [sel, setSel] = useState<number | null>(open);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [fulfil, setFulfil] = useState<AssetRequest | null>(null);
  const q = useQuery({
    queryKey: ['assets', 'requests', 'all'],
    queryFn: ({ signal }) => apiGet<{ requests: AssetRequest[] }>(`${BASE}/requests`, { scope: can.approve || can.manage ? 'all' : undefined, per_page: 100 }, signal),
    placeholderData: keepPreviousData,
  });
  const all = q.data?.requests ?? [];
  const count = (s: Stage) => all.filter((r) => (s === 'open' ? OPEN.has(r.status) : stageOf(r) === s)).length;
  const rows = all.filter((r) => (stage === 'open' ? OPEN.has(r.status) : stageOf(r) === stage));
  const cur = rows.find((r) => r.id === sel) ?? rows[0] ?? null;
  const mayDecide = !!cur && !cur.is_mine && (cur.status === 'pending' || cur.status === 'manager_approved') && (cur.can_decide ?? !!(can.approve || can.manage));
  const done = () => void qc.invalidateQueries({ queryKey: ['assets'] });

  const decide = async (decision: 'approve' | 'reject') => {
    if (!cur || busy || ro) return;
    if (decision === 'reject' && !note.trim()) return toast('error', 'Say why it is rejected.');
    setBusy(true);
    try {
      await decideRequest(cur.id, decision, note.trim());
      toast('success', decision === 'approve' ? `${cur.request_no ?? 'Request'} approved.` : `${cur.request_no ?? 'Request'} rejected.`);
      setNote('');
      done();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const decideMany = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      const r = await bulkRequests([...picked], decision);
      if (r.failed?.length) toast('error', r.failed.map((f) => f.why).join(' '));
      else toast('success', `${picked.size} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      setPicked(new Set());
      done();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && !!e.target.closest('input, textarea, select');
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && mayDecide) {
        e.preventDefault();
        void decide('approve');
      }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace' && mayDecide) {
        e.preventDefault();
        void decide('reject');
      }
      else if (typing) return;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = Math.max(0, rows.findIndex((r) => r.id === cur?.id));
        const n = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (n) setSel(n.id);
      } else if (e.key === ' ' && cur && stage === 'waiting') {
        e.preventDefault();
        setPicked((p) => {
          const x = new Set(p);
          if (x.has(cur.id)) x.delete(cur.id);
          else x.add(cur.id);
          return x;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3">
        <PageHead title="Requests">
          <Btn primary disabled={ro} onClick={() => setAsking(true)}>New</Btn>
        </PageHead>
        <Pills label="Stage" value={stage} onChange={(s) => (setStage(s), setPicked(new Set()))} options={[{ id: 'waiting', label: 'Waiting for me', n: count('waiting') }, { id: 'open', label: 'All open', n: count('open') }, { id: 'ready', label: 'Ready to issue', n: count('ready') }, { id: 'closed', label: 'Closed' }]} />
        <Card>
          {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => setSel(r.id)} aria-selected={r.id === cur?.id} className={cx('flex w-full items-start gap-2 border-t border-line/70 px-3.5 py-2.5 text-left text-[12.5px]', r.id === cur?.id ? 'bg-selection dark:bg-selection' : 'hover:bg-subtle')}>
              {stage === 'waiting' ? <Checkbox aria-label={`Select ${r.request_no ?? r.id}`} checked={picked.has(r.id)} onChange={() => undefined} onClick={(e) => (e.stopPropagation(), setPicked((p) => { const x = new Set(p); if (x.has(r.id)) x.delete(r.id); else x.add(r.id); return x; }))} /> : null}
              <span className="min-w-0 flex-1">
                <b className="block truncate">{r.title}</b>
                <span className="text-[11.5px] text-ink-3">{[r.request_no, r.requester, r.needed_by ? `by ${shortDate(r.needed_by)}` : null].filter(Boolean).join(' · ')}</span>
                {r.is_mine && stage !== 'closed' ? <span className="block text-[11px] text-ink-3">Raised by you — someone else decides</span> : null}
              </span>
              {stage === 'ready' && (can.assign || can.manage) ? <Btn disabled={ro} onClick={(e) => (e.stopPropagation(), setFulfil(r))}>Issue…</Btn> : <Badge status={r.status} />}
            </button>
          ))}
          {q.data && !rows.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">Nothing here.</p> : null}
        </Card>
        {picked.size ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3.5 py-2 text-[12.5px]">
            <span className="flex-1">{`${picked.size} selected`}</span>
            <Btn danger disabled={busy || ro} onClick={() => void decideMany('reject')}>Reject</Btn>
            <Btn primary disabled={busy || ro} onClick={() => void decideMany('approve')}>{`Approve ${picked.size}`}</Btn>
          </div>
        ) : null}
        <div className="flex gap-3 text-[11px] text-ink-2"><span><Kbd>↑↓</Kbd> move</span><span><Kbd>Space</Kbd> select</span></div>
      </div>
      {cur ? (
        <section aria-label={cur.request_no ?? 'Request'} className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 self-start rounded-[10px] border border-line bg-surface p-4">
          <div>
            <div className="font-mono text-[11px] text-ink-3">{cur.request_no}</div>
            <h2 className="m-0 text-[17px] font-bold">{cur.title}</h2>
            <div className="text-[12px] text-ink-2">{[cur.requester, cur.category].filter(Boolean).join(' · ')}</div>
          </div>
          {cur.justification ? <blockquote className="m-0 border-l-2 border-line pl-3 text-[12.5px] text-ink-2">{cur.justification}</blockquote> : null}
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px]">
            <li><Badge status="approved">Done</Badge> {`Submitted · ${shortDate(cur.created_at)}`}</li>
            <li><Badge status={cur.manager_at ? 'approved' : cur.status === 'pending' ? 'pending' : 'reserved'}>{cur.manager_at ? 'Done' : cur.status === 'pending' ? 'Now' : 'Next'}</Badge> {`Manager${cur.manager_by ? ` — ${cur.manager_by}` : ''}${cur.manager_note ? ` · “${cur.manager_note}”` : ''}`}</li>
            <li><Badge status={cur.it_at ? 'approved' : cur.status === 'manager_approved' ? 'pending' : 'reserved'}>{cur.it_at ? 'Done' : cur.status === 'manager_approved' ? 'Now' : 'Next'}</Badge> {`IT${cur.it_by ? ` — ${cur.it_by}` : ' (not the manager)'}`}</li>
            <li><Badge status={cur.fulfilled_at ? 'approved' : cur.status === 'it_approved' ? 'pending' : 'reserved'}>{cur.fulfilled_at ? 'Done' : 'Then'}</Badge> {cur.asset_code ? `Issued ${cur.asset_code} ${cur.asset ?? ''}` : 'Issue'}</li>
          </ol>
          {mayDecide ? (
            <>
              <Field label="Note"><textarea className={cx(input, 'h-16 py-1.5')} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="flex flex-wrap gap-2">
                <Btn danger disabled={busy || ro} onClick={() => void decide('reject')}>Reject · ⌘⌫</Btn>
                <span className="flex-1" />
                <Btn primary disabled={busy || ro} onClick={() => void decide('approve')}>Approve · ⌘↵</Btn>
              </div>
            </>
          ) : cur.status === 'it_approved' && (can.assign || can.manage) ? (
            <Btn primary disabled={ro} onClick={() => setFulfil(cur)}>Issue…</Btn>
          ) : null}
        </section>
      ) : null}
      {asking ? <RequestDialog onClose={() => setAsking(false)} /> : null}
      {fulfil ? <Fulfil r={fulfil} onClose={() => setFulfil(null)} onDone={() => (setFulfil(null), done())} /> : null}
    </div>
  );
}

/** D11: the assets in stock that could fill the request (its category, available), and Issue. */
function Fulfil({ r, onClose, onDone }: { r: AssetRequest; onClose: () => void; onDone: () => void }) {
  const stock = useQuery({ queryKey: ['assets', 'list', 'available', r.category], queryFn: ({ signal }) => fetchAssets({ status: 'available', per_page: 100 }, signal) });
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const list = (stock.data?.assets ?? []).filter((a) => !r.category || a.category === r.category);
  const choice = pick || list[0]?.id || 0;
  const go = async () => {
    if (!choice) return;
    setBusy(true);
    try {
      await fulfilRequest(r.id, choice);
      toast('success', `Issued to ${r.requester ?? 'the requester'}.`);
      onDone();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const a = list.find((x) => x.id === choice);
  return (
    <Modal title={`Issue against ${r.request_no ?? 'request'} · ${r.requester ?? ''}`} onClose={onClose} width={560} footer={<><Btn onClick={onClose}>Cancel · Esc</Btn><Btn primary disabled={busy || !choice} onClick={() => void go()}>{a ? `Issue ${a.asset_code}` : 'Issue'}</Btn></>}>
      {stock.isPending ? <Spinner /> : null}
      <div role="radiogroup" aria-label="Asset" className="flex flex-col gap-1.5">
        {list.map((x) => (
          <label key={x.id} className={cx('flex cursor-pointer items-center gap-2 rounded-[8px] border px-3 py-2 text-[12.5px]', x.id === choice ? 'border-primary bg-selection dark:bg-selection' : 'border-line')}>
            <input type="radio" name="asset" checked={x.id === choice} onChange={() => setPick(x.id)} />
            <span className="font-mono text-[11px]">{x.asset_code}</span>
            <span className="min-w-0 flex-1 truncate">{x.name}</span>
            <Badge status={x.condition} />
          </label>
        ))}
        {stock.data && !list.length ? <p className="m-0 text-[12.5px] text-ink-3">{`Nothing ${r.category ? `in ${r.category} ` : ''}is available. Ask Purchase, or free one up.`}</p> : null}
      </div>
    </Modal>
  );
}
