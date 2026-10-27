import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, input, PageHead } from '../../components/PageKit';
import { EXIT_STATUSES, fetchJobs, fetchPipeline, isBackward, K, moveApplication, type Card, type Stage } from './api';

/**
 * D01 · the pipeline board: a job picker, the job's stages as columns, its applications as cards with their flags.
 * Drag a card to another stage to move it; moving it back, or out of the pipeline (the drop zone on the end), asks
 * for a reason first (§3.10) — the server refuses those moves without one.
 */
interface Pending { card: Card; from: Stage; to: Stage | null }

const EXIT_LABEL: Record<string, string> = { REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', NO_SHOW: 'No show', ON_HOLD: 'On hold', TALENT_POOL: 'Talent pool' };

export default function Pipeline({ job, canMove, onJob, onWeb }: { job: number | null; canMove: boolean; onJob: (id: number) => void; onWeb: (path: string) => void }) {
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: K.jobs, queryFn: ({ signal }) => fetchJobs(signal) });
  const chosen = job ?? jobs.data?.[0]?.id ?? null;
  const board = useQuery({ queryKey: K.pipeline(chosen ?? 0), queryFn: ({ signal }) => fetchPipeline(chosen!, signal), enabled: !!chosen, refetchInterval: 60_000 });
  const [dragging, setDragging] = useState<{ card: Card; from: Stage } | null>(null);
  const [over, setOver] = useState<number | 'exit' | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [q, setQ] = useState('');
  const stages = useMemo(() => [...(board.data?.stages ?? [])].sort((a, b) => a.position - b.position), [board.data]);
  const total = stages.reduce((n, s) => n + s.applications.length, 0);
  const title = jobs.data?.find((j) => j.id === chosen)?.title ?? 'Pipeline';

  const move = useMutation({
    mutationFn: (v: { card: Card; stage?: number; status?: string; reason?: string; backward: boolean }) =>
      moveApplication(v.card.id, { stage_id: v.stage, status: v.status, reason: v.reason }, { backward: v.backward }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.pipeline(chosen ?? 0) }),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const drop = (to: Stage | null) => {
    const d = dragging;
    setDragging(null);
    setOver(null);
    if (!d || !canMove) return;
    if (to && to.id === d.from.id) return;
    if (!to || isBackward(stages, d.from.id, to.id)) return setPending({ card: d.card, from: d.from, to });
    move.mutate({ card: d.card, stage: to.id, backward: false });
  };

  const match = (c: Card) => !q.trim() || `${c.candidate.name} ${c.candidate.headline ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-6 pt-5">
        <PageHead title={title} sub={chosen ? `Pipeline · ${total} candidate${total === 1 ? '' : 's'}` : 'Pipeline'}>
          <input aria-label="Search the pipeline" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className={cx(input, 'w-[200px]')} />
          <select aria-label="Job" className={cx(input, 'w-[240px]')} value={chosen ?? ''} onChange={(e) => onJob(Number(e.target.value))}>
            {(jobs.data ?? []).map((j) => <option key={j.id} value={j.id}>{`Job: ${j.title}`}</option>)}
          </select>
          {chosen ? <button type="button" className={btn} onClick={() => onWeb(`/recruitment/jobs/${chosen}/candidates/new`)}><Icon name="plus" size={14} /> Add</button> : null}
        </PageHead>
      </div>
      {jobs.isPending || (chosen && board.isPending) ? <Spinner /> : jobs.isError ? <ErrorNote error={jobs.error} onRetry={() => void jobs.refetch()} /> : !chosen ? (
        <p className="m-6 text-[13px] text-ink-2">No open jobs yet.</p>
      ) : board.isError ? <ErrorNote error={board.error} onRetry={() => void board.refetch()} /> : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pt-2 pb-5 scroll-thin" role="list" aria-label="Stages">
          {stages.map((s) => (
            <section
              key={s.id}
              role="listitem"
              aria-label={s.name}
              onDragOver={(e) => { if (dragging && canMove) { e.preventDefault(); setOver(s.id); } }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); drop(s); }}
              className={cx('flex w-[264px] shrink-0 flex-col rounded-[12px] bg-subtle/60 p-2', over === s.id && 'ring-2 ring-primary')}
            >
              <div className="flex items-center gap-2 px-1.5 pt-1 pb-2 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">
                <span className="truncate">{s.name}</span>
                <span className="ml-auto tabular-nums">{s.applications.length}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scroll-thin">
                {s.applications.filter(match).map((c) => (
                  <PipelineCard key={c.id} card={c} draggable={canMove} onDragStart={() => setDragging({ card: c, from: s })} onDragEnd={() => { setDragging(null); setOver(null); }} />
                ))}
              </div>
            </section>
          ))}
          {canMove && dragging ? (
            <section
              aria-label="Out of the pipeline"
              onDragOver={(e) => { e.preventDefault(); setOver('exit'); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); drop(null); }}
              className={cx('flex w-[180px] shrink-0 flex-col items-center justify-center gap-1 rounded-[12px] border-2 border-dashed border-line text-[12.5px] text-ink-3', over === 'exit' && 'border-danger text-danger')}
            >
              <Icon name="user-x" size={18} />
              Out of the pipeline
            </section>
          ) : null}
        </div>
      )}
      {pending ? (
        <MovePrompt
          key={pending.card.id}
          pending={pending}
          busy={move.isPending}
          onCancel={() => setPending(null)}
          onConfirm={(reason, status) => {
            const p = pending;
            setPending(null);
            move.mutate({ card: p.card, stage: p.to?.id, status: p.to ? undefined : status, reason, backward: !!p.to });
          }}
        />
      ) : null}
    </div>
  );
}

export function PipelineCard({ card, draggable, onDragStart, onDragEnd }: { card: Card; draggable: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  const f = card.flags ?? {};
  return (
    <article
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer?.setData('text/plain', String(card.id)); onDragStart(); }}
      onDragEnd={onDragEnd}
      aria-label={card.candidate.name}
      className={cx('flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3', draggable && 'cursor-grab')}
    >
      <div className="flex items-center gap-2.5">
        <Avatar name={card.candidate.name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{card.candidate.name}</div>
          {card.candidate.headline ? <div className="truncate text-[12px] text-ink-3">{card.candidate.headline}</div> : null}
        </div>
        {card.rating_avg ? <span className="text-[12px] font-bold text-ink-2 tabular-nums" title="Average rating">{card.rating_avg.toFixed(1)}</span> : null}
      </div>
      {f.duplicate || f.knockout || f.sla_breach || card.days_in_stage ? (
        <div className="flex flex-wrap gap-1">
          {f.duplicate ? <Flag tone="amber">Possible duplicate</Flag> : null}
          {f.knockout ? <Flag tone="red">Knockout</Flag> : null}
          {f.sla_breach ? <Flag tone="red">SLA due</Flag> : null}
          {card.days_in_stage ? <span className="text-[11px] text-ink-3">{card.days_in_stage} d in stage</span> : null}
        </div>
      ) : null}
    </article>
  );
}

function Flag({ tone, children }: { tone: 'amber' | 'red'; children: string }) {
  return <span className={cx('inline-flex h-5 items-center rounded-full px-[7px] text-[11px] font-bold whitespace-nowrap', tone === 'red' ? 'bg-danger-bg text-danger' : 'bg-yellow-bg text-orange-ink dark:bg-warning-bg dark:text-warning')}>{children}</span>;
}

/** The reason for a backward move, or the status and reason for taking a candidate out of the pipeline. */
export function MovePrompt({ pending, busy, onCancel, onConfirm }: { pending: Pending; busy?: boolean; onCancel: () => void; onConfirm: (reason: string, status?: string) => void }) {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<string>('ON_HOLD');
  const exit = !pending.to;
  return (
    <Modal
      title={exit ? `Take ${pending.card.candidate.name} out of the pipeline` : `Move ${pending.card.candidate.name} back to ${pending.to!.name}`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className={btn} onClick={onCancel}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim(), exit ? status : undefined)}>Move</button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-ink-2">{exit ? 'Moving a candidate out of the pipeline needs a reason. It goes in their history.' : `Moving back from ${pending.from.name} needs a reason. It goes in the candidate's history.`}</p>
        {exit ? (
          <label className="flex flex-col gap-1 font-semibold text-ink-2">
            Status
            <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
              {EXIT_STATUSES.filter((s) => s !== 'REJECTED').map((s) => <option key={s} value={s}>{EXIT_LABEL[s]}</option>)}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 font-semibold text-ink-2">
          Reason
          <textarea aria-label="Reason" className={cx(input, 'h-20 py-2')} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </label>
      </div>
    </Modal>
  );
}
