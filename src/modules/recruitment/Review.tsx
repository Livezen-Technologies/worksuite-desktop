import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { FileViewer } from '../../components/FileViewer';
import { Avatar, ErrorNote, Kbd, Modal, Spinner, cx } from '../../components/ui';
import { btn, btnBad, btnPrimary, input, PageHead } from '../hr/parts';
import {
  applicationOf, cvOf, fetchCandidate, fetchJobs, fetchPipeline, fetchQueue, filePath, K, moveApplication, optionLabel, queueKey,
  rejectApplication, stageOfCategory, undoReject, type Option, type QueueItem, type Stage,
} from './api';

/**
 * D02 · the review queue: new applications for a job, one at a time, with the CV shown by the desktop's own viewer
 * (pdf.js, nothing of the document runs). J / K next and previous, A advance to the next stage, S shortlist, R reject
 * with a reason (the server holds the email back for its undo window).
 */
export default function Review({ job, canMove, reasons, onJob }: { job: number | null; canMove: boolean; reasons: Option[]; onJob: (id: number) => void }) {
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: K.jobs, queryFn: ({ signal }) => fetchJobs(signal) });
  const chosen = job ?? jobs.data?.[0]?.id ?? null;
  const queue = useQuery({ queryKey: K.queue(chosen), queryFn: ({ signal }) => fetchQueue(chosen, signal), enabled: !!chosen });
  const board = useQuery({ queryKey: K.pipeline(chosen ?? 0), queryFn: ({ signal }) => fetchPipeline(chosen!, signal), enabled: !!chosen });
  const items = queue.data ?? [];
  const [at, setAt] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [done, setDone] = useState<Set<number>>(() => new Set());
  const left = items.filter((i) => !done.has(i.id));
  const index = Math.min(at, Math.max(0, left.length - 1));
  const current: QueueItem | undefined = left[index];
  const stages = useMemo(() => [...(board.data?.stages ?? [])].sort((a, b) => a.position - b.position), [board.data]);

  const finish = (id: number) => {
    setDone((d) => new Set(d).add(id));
    void qc.invalidateQueries({ queryKey: K.pipeline(chosen ?? 0) });
  };

  const move = useMutation({
    mutationFn: async ({ item, stage }: { item: QueueItem; stage: Stage }) => {
      const app = applicationOf(item, chosen);
      if (!app) throw new Error('This candidate has no application for this job.');
      await moveApplication(app, { stage_id: stage.id });
      return { item, stage };
    },
    onSuccess: ({ item, stage }) => { finish(item.id); toast('success', `${item.name} moved to ${stage.name}.`); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: async ({ item, reason, note }: { item: QueueItem; reason: string; note: string }) => {
      const app = applicationOf(item, chosen);
      if (!app) throw new Error('This candidate has no application for this job.');
      await rejectApplication(app, { reason_id: reason, note });
      return { item, app };
    },
    onSuccess: ({ item, app }) => {
      finish(item.id);
      toast('info', `${item.name} rejected. The email waits for the undo window.`, { label: 'Undo', run: () => void undoReject(app).then(() => { setDone((d) => { const n = new Set(d); n.delete(item.id); return n; }); }).catch((e) => toast('error', errorMessage(e))) });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const advance = () => {
    if (!current || !canMove) return;
    const from = stageOfCategory(stages, 'APPLIED');
    const next = stages.find((s) => s.position > (from?.position ?? -Infinity));
    if (next) move.mutate({ item: current, stage: next });
  };
  const shortlist = () => {
    if (!current || !canMove) return;
    const s = stageOfCategory(stages, 'SHORTLISTED');
    if (s) move.mutate({ item: current, stage: s });
    else toast('error', 'This job has no shortlist stage.');
  };

  // The keys read this render's state through a ref: one listener for the screen's life.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    onKey.current = (e: KeyboardEvent) => {
      if (rejecting) return;
      const k = queueKey(e);
      if (!k) return;
      e.preventDefault();
      if (k === 'next') setAt((i) => Math.min(i + 1, Math.max(0, left.length - 1)));
      else if (k === 'prev') setAt((i) => Math.max(0, i - 1));
      else if (k === 'advance') advance();
      else if (k === 'shortlist') shortlist();
      else if (k === 'reject' && current && canMove) setRejecting(true);
    };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-6 pt-5">
        <PageHead title="Review queue" sub={`${left.length} new · ${jobs.data?.find((j) => j.id === chosen)?.title ?? ''}`}>
          <span className="text-[12px] text-ink-3"><Kbd>J</Kbd> / <Kbd>K</Kbd> to move · <Kbd>A</Kbd> advance · <Kbd>S</Kbd> shortlist · <Kbd>R</Kbd> reject</span>
          <select aria-label="Job" className={cx(input, 'w-[240px]')} value={chosen ?? ''} onChange={(e) => { setAt(0); setDone(new Set()); onJob(Number(e.target.value)); }}>
            {(jobs.data ?? []).map((j) => <option key={j.id} value={j.id}>{`Job: ${j.title}`}</option>)}
          </select>
        </PageHead>
      </div>
      {jobs.isPending || queue.isPending ? <Spinner /> : queue.isError ? <ErrorNote error={queue.error} onRetry={() => void queue.refetch()} /> : !left.length ? (
        <p className="m-6 text-[13px] text-ink-2">Nothing waiting for review.</p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 px-6 pb-5">
          <ul aria-label="Candidates to review" className="w-[240px] shrink-0 overflow-y-auto rounded-[12px] border border-line bg-surface scroll-thin">
            {left.map((c, i) => (
              <li key={c.id}>
                <button type="button" aria-current={i === index ? 'true' : undefined} onClick={() => setAt(i)} className={cx('flex w-full items-center gap-2.5 border-b border-line/70 px-3 py-2.5 text-left', i === index ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                  <Avatar name={c.name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{c.name}</span>
                    {c.headline ? <span className="block truncate text-[12px] text-ink-3">{c.headline}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {current ? <Candidate key={current.id} item={current} canMove={canMove} busy={move.isPending || reject.isPending} onShortlist={shortlist} onAdvance={advance} onReject={() => setRejecting(true)} /> : null}
        </div>
      )}
      {rejecting && current ? (
        <RejectPrompt name={current.name} reasons={reasons} onCancel={() => setRejecting(false)} onConfirm={(reason, note) => { setRejecting(false); reject.mutate({ item: current, reason, note }); }} />
      ) : null}
    </div>
  );
}

function Candidate({ item, canMove, busy, onShortlist, onAdvance, onReject }: { item: QueueItem; canMove: boolean; busy: boolean; onShortlist: () => void; onAdvance: () => void; onReject: () => void }) {
  const p = useQuery({ queryKey: K.candidate(item.id), queryFn: ({ signal }) => fetchCandidate(item.id, signal) });
  const cv = cvOf(p.data?.files);
  const skills = (p.data?.skills ?? []).map((s) => (typeof s === 'string' ? s : s.name));
  return (
    <>
      <div className="min-w-0 flex-1 overflow-hidden rounded-[12px] border border-line bg-surface">
        {p.isPending ? <Spinner /> : cv ? <FileViewer key={cv.id} path={filePath(cv)} name={cv.name} /> : <p className="m-6 text-[13px] text-ink-2">No CV attached.</p>}
      </div>
      <aside aria-label="Candidate" className="flex w-[280px] shrink-0 flex-col gap-3 overflow-y-auto rounded-[12px] border border-line bg-surface p-4 text-[13px] scroll-thin">
        <div>
          <b className="text-[15px] text-ink">{item.name}</b>
          {p.data?.headline ?? item.headline ? <div className="text-ink-3">{p.data?.headline ?? item.headline}</div> : null}
          {p.data?.location ? <div className="text-ink-3">{p.data.location}</div> : null}
        </div>
        {p.data?.experience?.length ? (
          <div>
            <div className="mb-1 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">Experience</div>
            {p.data.experience.map((x, i) => <div key={i} className="text-ink-2">{[x.title, x.company].filter(Boolean).join(' — ')}</div>)}
          </div>
        ) : null}
        {skills.length ? (
          <div>
            <div className="mb-1 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">Skills</div>
            <div className="text-ink-2">{skills.join(' · ')}</div>
          </div>
        ) : null}
        {canMove ? (
          <div className="mt-auto flex flex-col gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={onShortlist}>Shortlist · S</button>
            <button type="button" className={btn} disabled={busy} onClick={onAdvance}>Advance · A</button>
            <button type="button" className={btnBad} disabled={busy} onClick={onReject}>Reject · R</button>
          </div>
        ) : null}
      </aside>
    </>
  );
}

export function RejectPrompt({ name, reasons, onCancel, onConfirm }: { name: string; reasons: Option[]; onCancel: () => void; onConfirm: (reason: string, note: string) => void }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal
      title={`Reject ${name}`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className={btn} onClick={onCancel}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={!reason} onClick={() => onConfirm(reason, note.trim())}>Reject</button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink-2">
          Reason
          <select aria-label="Reason" className={input} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
            <option value="">Choose a reason…</option>
            {reasons.map((r) => <option key={r.id} value={String(r.id)}>{optionLabel(r)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-semibold text-ink-2">
          Internal note
          <textarea aria-label="Internal note" className={cx(input, 'h-20 py-2')} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="text-[12px] text-ink-3">The candidate's email is held back for the undo window.</p>
      </div>
    </Modal>
  );
}
