import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Spinner, cx } from '../../components/ui';
import { offlineResponseRefusal, showOthersResponses } from '@shared/board';
import { approve, fetchApprovals, fetchCircular, fmtDate, fmtTime, K, respondCircular, sign, type Approval, type Circular } from './api';
import { Muted, Panel, Status } from './parts';

const KIND: Record<Approval['kind'], string> = { sign: 'Sign', circular: 'Approve', minutes: 'Review', agenda: 'Approve' };

/** D-08 Approvals & signing (FR-SIG-01..04), with circular responses online and offline (FR-VOT-08, FR-CIR-05). */
export default function Approvals({ circular, offline }: { circular: number | null; offline: boolean }) {
  const list = useQuery({ queryKey: K.approvals, queryFn: ({ signal }) => fetchApprovals(signal), enabled: !offline });
  const queue = useQuery({ queryKey: ['board', 'queue'], queryFn: () => call('board:queueList') });
  const items = list.data ?? [];
  const [selId, setSelId] = useState<number | null>(null);
  const sel = items.find((a) => a.id === selId) ?? items.find((a) => a.kind === 'circular' && a.ref_id === circular) ?? items[0] ?? null;
  const circId = sel?.kind === 'circular' ? sel.ref_id : circular;

  return (
    <div className="grid h-full grid-cols-[260px_1fr_300px]">
      <nav aria-label="Approvals waiting on you" className="overflow-y-auto border-r border-line bg-surface scroll-thin">
        <div className="px-3.5 pt-3.5 pb-2"><h1 className="text-[15px] font-bold">Approvals</h1><Muted>{items.length} waiting on you</Muted></div>
        {list.isPending && !offline ? <Spinner /> : null}
        <ul>
          {items.map((a) => (
            <li key={a.id}>
              <button type="button" aria-current={sel?.id === a.id ? 'true' : undefined} onClick={() => setSelId(a.id)} className={cx('flex w-full items-center gap-2 border-b border-line px-3.5 py-2.5 text-left', sel?.id === a.id ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-bold">{a.title}</div><div className="truncate text-[11.5px] text-ink-3">{a.subtitle}</div></div>
                <Status tone={a.due ? 'warning' : 'indigo'}>{a.due ? fmtDate(a.due) : KIND[a.kind]}</Status>
              </button>
            </li>
          ))}
        </ul>
        {(queue.data ?? []).filter((q) => q.kind === 'circular').length ? (
          <div className="p-3.5">
            <div className="mb-1 text-[11px] font-bold text-ink-3 uppercase">Responses recorded offline</div>
            <ul className="space-y-1 text-[12px]">
              {queue.data!.filter((q) => q.kind === 'circular').map((q) => (
                <li key={q.id}>Circular {q.circularId} · {q.outcome === 'pending' ? 'queued on this device' : q.outcome === 'accepted' ? 'accepted' : <span className="text-danger">rejected: {q.error}</span>}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>
      {circId && (sel?.kind === 'circular' || !sel) ? <CircularRespond id={circId} offline={offline} /> : sel ? <SignPane a={sel} /> : <p className="m-6 text-[13px] text-ink-3">{offline ? 'Approvals need a connection. Offline responses you recorded are listed on the left.' : 'Nothing is waiting on you.'}</p>}
    </div>
  );
}

function SignPane({ a }: { a: Approval }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<'draw' | 'saved' | 'certificate'>('draw');
  const pad = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const doc = a.document;
  const needsSign = a.kind === 'sign' || a.kind === 'minutes';
  const done = useMutation({
    mutationFn: async () => {
      if (!needsSign) return approve(a);
      if (!doc) throw new Error('The document is not ready to sign.');
      // FR-SIG-04: the OS's own check first where it has one; otherwise the server asks for its step-up.
      const v = await call('board:verify', { reason: `sign ${a.title}` });
      if (v.method === 'touch-id' && !v.verified) throw new Error('Verification was cancelled. Nothing was signed.');
      return sign(a, { method, image: method === 'draw' ? pad.current?.toDataURL('image/png') ?? null : null, sha256: doc.sha256, version: doc.version, verification: v.verified ? 'touch-id' : 'server' });
    },
    onSuccess: () => { toast('success', needsSign ? 'Signed.' : 'Approved.'); void qc.invalidateQueries({ queryKey: K.approvals }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  useEffect(() => {
    const c = pad.current;
    if (!c) return;
    const ctx = c.getContext?.('2d');
    if (!ctx) return;
    let down = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    const start = (e: PointerEvent) => { down = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const move = (e: PointerEvent) => { if (!down) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); setDrawn(true); };
    const end = () => { down = false; };
    c.addEventListener('pointerdown', start);
    c.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => { c.removeEventListener('pointerdown', start); c.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
  }, [method, a.id]);

  return (
    <>
      <div className="flex justify-center overflow-y-auto bg-subtle p-8 scroll-thin">
        <article aria-label="Document preview" className="h-fit w-[420px] bg-white p-8 font-serif text-[12px] text-[#111] shadow">
          <h2 className="text-center text-[13px] font-bold uppercase">{doc?.title ?? a.title}</h2>
          <p className="mt-3 whitespace-pre-wrap">{doc?.body ?? ''}</p>
          <div className="mt-10 flex justify-between gap-4 text-[11px]">
            {(doc?.signed_by ?? []).map((s) => <div key={s.name} className="border-t border-[#999] pt-1">{s.name}<div className="text-[#15803d]">✓ signed {fmtDate(s.at)}</div></div>)}
            {needsSign ? <div className="border-t-2 border-dashed border-[#3B5BDB] bg-[#EEF1FD] px-2 pt-1 text-[#3B5BDB]">Sign here</div> : null}
          </div>
        </article>
      </div>
      <aside className="flex flex-col gap-3 border-l border-line bg-surface p-3.5">
        <h2 className="text-[14px] font-bold">{needsSign ? 'Sign' : 'Approve'}</h2>
        {needsSign ? (
          <>
            <div role="tablist" className="flex gap-1.5">
              {(['draw', 'saved', 'certificate'] as const).map((m) => <Button key={m} size="sm" role="tab" aria-selected={method === m} variant={method === m ? 'primary' : 'secondary'} onClick={() => setMethod(m)}>{m === 'draw' ? 'Draw' : m === 'saved' ? 'Saved' : 'Certificate'}</Button>)}
            </div>
            {method === 'draw' ? <canvas ref={pad} width={260} height={90} aria-label="Signature pad" className="rounded-[8px] border border-line bg-white" /> : <Muted>{method === 'saved' ? 'Your saved signature is applied.' : 'Your signing certificate is used.'}</Muted>}
            <div className="text-[12px]">You are signing<div className="font-semibold">{doc?.title ?? a.title} · version {doc?.version ?? '—'}</div><div className="break-all font-mono text-[11px] text-ink-3">SHA-256 {doc?.sha256 ?? '—'}</div></div>
            <p className="rounded-[8px] bg-subtle p-2 text-[12px]">Your computer's verification (Touch ID or Windows Hello where available, else WorkSuite's step-up) confirms it is you before the signature is applied.</p>
          </>
        ) : <Muted>{a.subtitle}</Muted>}
        <Button className="mt-auto" variant="primary" loading={done.isPending} disabled={needsSign && method === 'draw' && !drawn} onClick={() => done.mutate()}>{needsSign ? 'Verify & sign' : 'Approve'}</Button>
      </aside>
    </>
  );
}

/** Responding to a circular (CircularRespond / OfflineVote designs): online, or recorded on this device when allowed. */
export function CircularRespond({ id, offline }: { id: number; offline: boolean }) {
  const qc = useQueryClient();
  const net = useStore(app, (s) => s.status?.network ?? 'ONLINE');
  const isOffline = offline || net === 'OFFLINE';
  const c = useQuery({ queryKey: K.circular(id), queryFn: ({ signal }) => fetchCircular(id, signal), enabled: !isOffline, staleTime: Infinity });
  const [comment, setComment] = useState('');
  const [queued, setQueued] = useState<string | null>(null);
  const circ: Circular | undefined = c.data;
  const respond = useMutation({
    mutationFn: async (choice: 'approve' | 'reject' | 'abstain') => {
      if (!isOffline) return { online: true as const, r: await respondCircular(id, choice, comment) };
      const q = await call('board:respondOffline', { circularId: id, choice, comment: comment.trim() || undefined });
      return { online: false as const, r: q };
    },
    onSuccess: (r, choice) => {
      if (r.online) { toast('success', 'Response recorded.'); void qc.invalidateQueries({ queryKey: K.circular(id) }); void qc.invalidateQueries({ queryKey: K.approvals }); }
      else { setQueued(`${choice[0]!.toUpperCase()}${choice.slice(1)} · queued on this device ${fmtTime(r.r.at)}`); void qc.invalidateQueries({ queryKey: ['board', 'queue'] }); }
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (c.isPending && !isOffline) return <Spinner />;
  const refusal = isOffline ? (circ ? offlineResponseRefusal(circ) : null) : null;
  const responded = !!circ?.my_response;
  return (
    <section className="col-span-2 overflow-y-auto p-6 scroll-thin" aria-label="Circular">
      {isOffline ? <div role="status" className="mb-3 rounded-[8px] bg-warning/10 p-2.5 text-[12.5px] text-warning">Offline — your response will be sent when you reconnect. The time you respond is kept and signed on this device; the server checks it was before the deadline.</div> : null}
      <div className="max-w-[640px]">
        <div className="flex items-center gap-2"><Status tone="indigo">Circular resolution</Status>{circ?.secret ? <Status>Secret</Status> : null}</div>
        <h2 className="mt-2 text-[17px] font-bold">{circ ? `${circ.number} ${circ.title}` : `Circular ${id}`}</h2>
        {circ ? <p className="mt-2 rounded-[8px] bg-subtle p-3 font-serif text-[13px]">{circ.text}</p> : null}
        {circ ? (
          <div className="mt-3 text-[12.5px]">
            <div>Approvals so far: <b>{circ.approvals ?? 0} of {circ.required ?? '—'} needed</b></div>
            <div className="text-ink-3">Deadline {circ.deadline ? `${fmtDate(circ.deadline)} ${fmtTime(circ.deadline)}` : '—'}</div>
          </div>
        ) : null}
        {responded ? <p className="mt-3 text-[13px]">You responded: <b>{circ!.my_response!.choice}</b></p> : null}
        {queued ? <p className="mt-3 text-[13px]" role="status">Your response: <b>{queued}</b></p> : null}
        {!responded && !queued ? (
          <>
            <label className="mt-4 block text-[12.5px]">Comment (optional, visible to the secretary)
              <textarea maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1 h-[70px] w-full rounded-[8px] border border-line bg-surface p-2" />
            </label>
            {refusal ? <p className="mt-2 text-[12.5px] text-danger" role="alert">{refusal}</p> : null}
            {isOffline && !circ ? <p className="mt-2 text-[12.5px] text-ink-3">Open this circular once while online (or keep its meeting's pack offline) to respond offline.</p> : null}
            <div className="mt-3 flex gap-2">
              {(['reject', 'abstain', 'approve'] as const).map((ch) => (
                <Button key={ch} size="lg" variant={ch === 'approve' ? 'primary' : 'secondary'} disabled={!!refusal || respond.isPending || circ?.can_respond === false} onClick={() => respond.mutate(ch)}>{ch[0]!.toUpperCase() + ch.slice(1)}</Button>
              ))}
            </div>
          </>
        ) : null}
        {circ && showOthersResponses(circ, responded) && circ.responses?.length ? (
          <Panel title="Other signatories" className="mt-4">
            <ul className="space-y-1.5 text-[12.5px]">{circ.responses.map((r) => <li key={r.name}><b>{r.name}</b> · {r.choice}{r.comment ? ` — “${r.comment}”` : ''}</li>)}</ul>
          </Panel>
        ) : null}
      </div>
    </section>
  );
}
