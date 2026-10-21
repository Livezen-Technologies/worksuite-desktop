import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Spinner, cx } from '../../components/ui';
import { offlineResponseRefusal, showOthersResponses } from '@shared/board';
import { decide, fetchApprovals, fetchCircular, fetchMinutes, fmtDate, fmtTime, K, needsStepUp, respondCircular, titleCase, type Approval, type Circular, type SigningBody } from './api';
import { Muted, Panel, Status } from './parts';

const KIND: Record<Approval['kind'], string> = { SIGNATURE: 'Sign', CIRCULAR: 'Respond', MINUTES: 'Review', AGENDA: 'Approve', PAPER: 'Review', PACK: 'Approve' };

/** D-08 Approvals & signing (FR-SIG-01..04), with circular responses online and offline (FR-VOT-08, FR-CIR-05). */
export default function Approvals({ circular, offline }: { circular: number | null; offline: boolean }) {
  const list = useQuery({ queryKey: K.approvals, queryFn: ({ signal }) => fetchApprovals(signal), enabled: !offline });
  const queue = useQuery({ queryKey: ['board', 'queue'], queryFn: () => call('board:queueList') });
  const items = list.data ?? [];
  const [selId, setSelId] = useState<number | null>(null);
  const sel = items.find((a) => a.id === selId) ?? items.find((a) => a.kind === 'CIRCULAR' && a.record_id === circular) ?? items[0] ?? null;
  const circId = sel?.kind === 'CIRCULAR' ? sel.record_id : circular;

  return (
    <div className="grid h-full grid-cols-[260px_1fr_300px]">
      <nav aria-label="Approvals waiting on you" className="overflow-y-auto border-r border-line bg-surface scroll-thin">
        <div className="px-3.5 pt-3.5 pb-2"><h1 className="text-[15px] font-bold">Approvals</h1><Muted>{items.length} waiting on you</Muted></div>
        {list.isPending && !offline ? <Spinner /> : null}
        <ul>
          {items.map((a) => (
            <li key={a.id}>
              <button type="button" aria-current={sel?.id === a.id ? 'true' : undefined} onClick={() => setSelId(a.id)} className={cx('flex w-full items-center gap-2 border-b border-line px-3.5 py-2.5 text-left', sel?.id === a.id ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-bold">{a.title}</div><div className="truncate text-[11.5px] text-ink-3">{a.sub}</div></div>
                <Status tone={a.overdue ? 'danger' : a.due_label ? 'warning' : 'indigo'}>{a.due_label ?? KIND[a.kind]}</Status>
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
      {circId && (sel?.kind === 'CIRCULAR' || !sel) ? <CircularRespond id={circId} offline={offline} /> : sel ? <SignPane a={sel} /> : <p className="m-6 text-[13px] text-ink-3">{offline ? 'Approvals need a connection. Offline responses you recorded are listed on the left.' : 'Nothing is waiting on you.'}</p>}
    </div>
  );
}

/** A password field shown when the server asks for a fresh proof before signing or voting (428 step-up, FR-SIG-03). */
function StepUp({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block rounded-[8px] bg-warning/10 p-2 text-[12px]" role="group" aria-label="Confirm it is you">
      WorkSuite asks you to confirm it is you. Enter your password.
      <input type="password" autoComplete="current-password" aria-label="Password" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded border border-line bg-surface p-1.5" />
    </label>
  );
}

function SignPane({ a }: { a: Approval }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<'draw' | 'ack'>('draw');
  const pad = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [stepUp, setStepUp] = useState<string | null>(null);
  const needsSign = a.kind === 'SIGNATURE';
  const isMinutes = a.kind === 'SIGNATURE' || a.kind === 'MINUTES';
  const doc = useQuery({ queryKey: ['board', 'minutesDoc', a.record_id], queryFn: ({ signal }) => fetchMinutes(a.record_id, signal), enabled: isMinutes });
  const m = doc.data;
  const done = useMutation({
    mutationFn: async () => {
      if (!needsSign) return decide(a, 'approve');
      // FR-SIG-04: the OS's own check first where it has one; the server asks for its own step-up (428) when it wants one.
      const v = await call('board:verify', { reason: `sign ${a.title}` });
      if (v.method === 'touch-id' && !v.verified) throw new Error('Verification was cancelled. Nothing was signed.');
      const body: SigningBody = method === 'draw' ? { type: 'DRAWN', image_data: pad.current?.toDataURL('image/png') ?? undefined } : { type: 'ACKNOWLEDGEMENT' };
      if (stepUp) body.current_password = stepUp;
      return decide(a, 'approve', body);
    },
    onSuccess: () => { setStepUp(null); toast('success', needsSign ? 'Signed.' : 'Approved.'); void qc.invalidateQueries({ queryKey: K.approvals }); },
    onError: (e) => { if (needsStepUp(e) && stepUp === null) setStepUp(''); else toast('error', errorMessage(e)); },
  });
  const back = useMutation({
    mutationFn: () => decide(a, 'changes'),
    onSuccess: () => { toast('success', 'Sent back for changes.'); void qc.invalidateQueries({ queryKey: K.approvals }); },
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
  const sha = m?.final_sha256 ?? m?.current_version?.sha256 ?? null;

  return (
    <>
      <div className="flex justify-center overflow-y-auto bg-subtle p-8 scroll-thin">
        <article aria-label="Document preview" className="h-fit w-[420px] bg-white p-8 font-serif text-[12px] text-[#111] shadow">
          <h2 className="text-center text-[13px] font-bold uppercase">{a.title}</h2>
          {isMinutes ? (doc.isPending ? <Spinner /> : <div className="mt-3 space-y-2">{(m?.blocks ?? []).filter((b) => b.text).map((b) => <p key={b.id} className="whitespace-pre-wrap">{b.text}</p>)}</div>) : <p className="mt-3">{a.sub}</p>}
          {needsSign ? <div className="mt-10 border-t-2 border-dashed border-[#3B5BDB] bg-[#EEF1FD] px-2 pt-1 text-[11px] text-[#3B5BDB]">Sign here</div> : null}
        </article>
      </div>
      <aside className="flex flex-col gap-3 border-l border-line bg-surface p-3.5">
        <h2 className="text-[14px] font-bold">{needsSign ? 'Sign' : KIND[a.kind]}</h2>
        {needsSign ? (
          <>
            <div role="tablist" className="flex gap-1.5">
              {(['draw', 'ack'] as const).map((k) => <Button key={k} size="sm" role="tab" aria-selected={method === k} variant={method === k ? 'primary' : 'secondary'} onClick={() => setMethod(k)}>{k === 'draw' ? 'Draw' : 'Acknowledge'}</Button>)}
            </div>
            {method === 'draw' ? <canvas ref={pad} width={260} height={90} aria-label="Signature pad" className="rounded-[8px] border border-line bg-white" /> : <Muted>Your signature is recorded as an acknowledgement, with how you confirmed it is you.</Muted>}
            <div className="text-[12px]">You are signing<div className="font-semibold">{a.title}{m?.current_version ? ` · ${m.current_version.version}` : ''}</div><div className="break-all font-mono text-[11px] text-ink-3">SHA-256 {sha ?? '—'}</div></div>
            <p className="rounded-[8px] bg-subtle p-2 text-[12px]">Your computer's verification (Touch ID where available) and, when it asks, WorkSuite's own step-up confirm it is you before the signature is applied.</p>
            {stepUp !== null ? <StepUp value={stepUp} onChange={setStepUp} /> : null}
          </>
        ) : <Muted>{[a.sub, a.role ? titleCase(a.role) : null].filter(Boolean).join(' · ')}</Muted>}
        <div className="mt-auto flex flex-col gap-1.5">
          {!needsSign && (a.kind === 'PAPER' || a.kind === 'MINUTES' || a.kind === 'AGENDA') ? <Button loading={back.isPending} onClick={() => back.mutate()}>Request changes</Button> : null}
          <Button variant="primary" loading={done.isPending} disabled={(needsSign && method === 'draw' && !drawn) || stepUp === ''} onClick={() => done.mutate()}>{needsSign ? 'Verify & sign' : 'Approve'}</Button>
        </div>
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
  const [stepUp, setStepUp] = useState<string | null>(null);
  const circ: Circular | undefined = c.data;
  const respond = useMutation({
    mutationFn: async (choice: 'approve' | 'reject' | 'abstain') => {
      if (!isOffline) {
        // A circular that must be signed takes the signing body with an approval (and the step-up when the server asks).
        const signing: SigningBody | undefined = circ?.sign_required && choice === 'approve' ? { type: 'ACKNOWLEDGEMENT', ...(stepUp ? { current_password: stepUp } : {}) } : undefined;
        return { online: true as const, r: await respondCircular(id, choice.toUpperCase() as 'APPROVE', comment, signing) };
      }
      const q = await call('board:respondOffline', { circularId: id, choice, comment: comment.trim() || undefined });
      return { online: false as const, r: q };
    },
    onSuccess: (r, choice) => {
      if (r.online) { setStepUp(null); toast('success', 'Response recorded.'); void qc.invalidateQueries({ queryKey: K.circular(id) }); void qc.invalidateQueries({ queryKey: K.approvals }); }
      else { setQueued(`${choice[0]!.toUpperCase()}${choice.slice(1)} · queued on this device ${fmtTime(r.r.at)}`); void qc.invalidateQueries({ queryKey: ['board', 'queue'] }); }
    },
    onError: (e) => { if (needsStepUp(e) && stepUp === null) setStepUp(''); else toast('error', errorMessage(e)); },
  });
  if (c.isPending && !isOffline) return <Spinner />;
  const refusal = isOffline ? (circ ? offlineResponseRefusal(circ) : null) : null;
  const responded = !!circ?.me?.response;
  const others = (circ?.recipients ?? []).filter((r) => r.response);
  return (
    <section className="col-span-2 overflow-y-auto p-6 scroll-thin" aria-label="Circular">
      {isOffline ? <div role="status" className="mb-3 rounded-[8px] bg-warning/10 p-2.5 text-[12.5px] text-warning">Offline — your response will be sent when you reconnect. The time you respond is kept and signed on this device; the server checks it was before the deadline.</div> : null}
      <div className="max-w-[640px]">
        <div className="flex items-center gap-2"><Status tone="indigo">Circular resolution</Status>{circ?.secret ? <Status>Secret</Status> : null}</div>
        <h2 className="mt-2 text-[17px] font-bold">{circ ? `${circ.number} ${circ.title}` : `Circular ${id}`}</h2>
        {circ ? <p className="mt-2 rounded-[8px] bg-subtle p-3 font-serif text-[13px]">{circ.resolution_text}</p> : null}
        {circ ? (
          <div className="mt-3 text-[12.5px]">
            <div>Approvals so far: <b>{circ.approvals ?? 0} of {circ.required ?? '—'} needed</b>{circ.progress ? <span className="text-ink-3"> · {circ.progress} responded</span> : null}</div>
            <div className="text-ink-3">Deadline {circ.deadline_at ? `${fmtDate(circ.deadline_at)} ${fmtTime(circ.deadline_at)}` : '—'}{circ.sign_required ? ' · approval is signed' : ''}</div>
          </div>
        ) : null}
        {responded ? <p className="mt-3 text-[13px]">You responded: <b>{titleCase(circ!.me!.response)}</b></p> : null}
        {queued ? <p className="mt-3 text-[13px]" role="status">Your response: <b>{queued}</b></p> : null}
        {!responded && !queued ? (
          <>
            <label className="mt-4 block text-[12.5px]">Comment (optional, visible to the secretary)
              <textarea maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1 h-[70px] w-full rounded-[8px] border border-line bg-surface p-2" />
            </label>
            {refusal ? <p className="mt-2 text-[12.5px] text-danger" role="alert">{refusal}</p> : null}
            {stepUp !== null ? <div className="mt-2"><StepUp value={stepUp} onChange={setStepUp} /></div> : null}
            {isOffline && !circ ? <p className="mt-2 text-[12.5px] text-ink-3">Open this circular once while online (or keep its meeting's pack offline) to respond offline.</p> : null}
            <div className="mt-3 flex gap-2">
              {(['reject', 'abstain', 'approve'] as const).map((ch) => (
                <Button key={ch} size="lg" variant={ch === 'approve' ? 'primary' : 'secondary'} disabled={!!refusal || respond.isPending || circ?.me?.eligible === false || stepUp === ''} onClick={() => respond.mutate(ch)}>{ch[0]!.toUpperCase() + ch.slice(1)}</Button>
              ))}
            </div>
          </>
        ) : null}
        {circ && showOthersResponses(circ, responded) && others.length ? (
          <Panel title="Other signatories" className="mt-4">
            <ul className="space-y-1.5 text-[12.5px]">{others.map((r) => <li key={r.user_id}><b>{r.name}</b> · {titleCase(r.response)}{r.comment ? ` — “${r.comment}”` : ''}</li>)}</ul>
          </Panel>
        ) : null}
      </div>
    </section>
  );
}
