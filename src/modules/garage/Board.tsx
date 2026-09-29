import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, input, PageHead, Sheet } from '../hr/parts';
import { fetchBoard, fetchJob, K, OFFLINE_WRITE, refusalOf, transition, type BoardColumn, type Job, type Options } from './api';
import { initialsOf, JobSummary, OfflineBanner, when } from './parts';

/**
 * The job board (SRS §10, §28.2, FR-BRD-01..05): every open job the reader may
 * see, in the columns the server draws from SM-01.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DROP ASKS; IT NEVER MOVES A CARD BY ITSELF (C9)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Dropping a card on a column — or Alt+→ / Alt+← on a card, for the keyboard —
 * sends `POST jobs/{id}/transition {column}` with the version the board
 * showed. The card does not move here: the board is read again when the
 * server says yes, and when it says no the card stays where it was and the
 * server's sentence is shown ("Estimate not approved: record the customer's
 * decision on the estimate."). A move that needs words (asking for changes to
 * an estimate) asks for them first (FR-BRD-04) — which moves those are, the
 * job card's `transitions` say.
 */
export type MoveOutcome = { kind: 'moved'; message: string } | { kind: 'refused'; message: string; conflict: boolean } | { kind: 'ask'; label: string } | { kind: 'same' } | { kind: 'offline' };

/**
 * Asks the server to move a job to a column. With `reason` undefined, first
 * reads the job's transitions to know whether the move needs a reason; if
 * it does, answers `ask` and sends nothing. The server's answer is the outcome.
 */
export async function requestMove(job: Job, column: Pick<BoardColumn, 'code' | 'label' | 'statuses'>, online: boolean, reason?: string): Promise<MoveOutcome> {
  if (job.column === column.code) return { kind: 'same' };
  if (!online) return { kind: 'offline' };
  try {
    if (reason === undefined) {
      const card = await fetchJob(job.id);
      const asks = card.data.job.transitions.find((t) => column.statuses.includes(t.to) && t.allowed && t.needs.includes('reason'));
      if (asks) return { kind: 'ask', label: asks.label };
    }
    const r = await transition(job.id, { column: column.code, ...(reason ? { reason } : {}) }, job.version);
    return { kind: 'moved', message: r.message || `${job.number} moved to ${column.label}.` };
  } catch (e) {
    const p = refusalOf(e);
    return { kind: 'refused', message: p.message, conflict: p.code === 'version_conflict' };
  }
}

/** The column a keyboard move goes to: the next or the previous one. */
export function neighbour(columns: BoardColumn[], code: string | null, step: 1 | -1): BoardColumn | null {
  const i = columns.findIndex((c) => c.code === code);
  return i < 0 ? null : (columns[i + step] ?? null);
}

export default function Board({ org, options, online, onJob }: { org: string; options: Options; online: boolean; onJob: (id: number) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [advisor, setAdvisor] = useState('');
  const [priority, setPriority] = useState('');
  const [dragging, setDragging] = useState<Job | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [refused, setRefused] = useState<{ job: string; message: string } | null>(null);
  const [ask, setAsk] = useState<{ job: Job; column: BoardColumn; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const filters = { branch_id: branch || undefined, advisor: advisor || undefined, priority: priority || undefined, q: q.trim() || undefined };
  const board = useQuery({ queryKey: K.board(org, filters), queryFn: ({ signal }) => fetchBoard(org, filters, signal), refetchInterval: 30_000, placeholderData: (p) => p });
  const columns = board.data?.data.columns ?? [];
  const advisors = [...new Map(columns.flatMap((c) => c.jobs).flatMap((j) => (j.service_advisor ? [[j.service_advisor.id, j.service_advisor] as const] : []))).values()];
  const branches = options.companies.filter((c) => !org || String(c.id) === org).flatMap((c) => c.branches.filter((b) => b.branch_id > 0).map((b) => ({ value: String(b.branch_id), label: options.companies.length > 1 ? `${b.name} · ${c.name}` : b.name })));
  const offline = !online || !!board.data?.offline;

  const move = async (job: Job, column: BoardColumn, why?: string) => {
    setRefused(null);
    setMoving(job.id);
    const out = await requestMove(job, column, !offline, why);
    setMoving(null);
    if (out.kind === 'same') return;
    if (out.kind === 'offline') return toast('error', OFFLINE_WRITE);
    if (out.kind === 'ask') {
      setReason('');
      return setAsk({ job, column, label: out.label });
    }
    if (out.kind === 'moved') toast('success', out.message);
    else {
      // The card stays where it was: the server said no, and why.
      setRefused({ job: job.number, message: out.message });
      toast('error', out.message);
    }
    void qc.invalidateQueries({ queryKey: K.all });
  };
  const drop = (column: BoardColumn) => {
    const job = dragging;
    setDragging(null);
    setOver(null);
    if (job) void move(job, column);
  };
  // Arrows walk the cards; Alt+arrows ask to move the card a column along.
  const onCardKey = (e: KeyboardEvent<HTMLButtonElement>, job: Job) => {
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const to = neighbour(columns, job.column, e.key === 'ArrowRight' ? 1 : -1);
      e.preventDefault();
      if (to) void move(job, to);
      return;
    }
    const here = e.currentTarget;
    const lane = here.closest('[data-column]');
    let next: Element | null | undefined = null;
    if (e.key === 'ArrowDown') next = here.nextElementSibling;
    else if (e.key === 'ArrowUp') next = here.previousElementSibling;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      let l = e.key === 'ArrowRight' ? lane?.nextElementSibling : lane?.previousElementSibling;
      while (l && !l.querySelector('[data-job]')) l = e.key === 'ArrowRight' ? l.nextElementSibling : l.previousElementSibling;
      next = l?.querySelector('[data-job]');
    } else return;
    e.preventDefault();
    if (next instanceof HTMLElement) next.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Job board" sub="Drag a card to ask for the move — or Alt+→ / Alt+← on a card. WorkSuite decides; a move it refuses stays put and says why.">
        <label className="flex h-[34px] w-[220px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input data-garage-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job, plate, VIN, customer" aria-label="Search the board" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
        {branches.length > 1 ? <Select label="Branch" value={branch} onValueChange={setBranch} options={[{ value: '', label: 'Every branch' }, ...branches]} /> : null}
        <Select label="Advisor" value={advisor} onValueChange={setAdvisor} options={[{ value: '', label: 'Every advisor' }, ...advisors.map((a) => ({ value: String(a.id), label: a.name ?? `#${a.id}` }))]} />
        <Select label="Priority" value={priority} onValueChange={setPriority} options={[{ value: '', label: 'Any priority' }, ...Object.entries(options.priorities).map(([v, label]) => ({ value: v, label }))]} />
      </PageHead>
      {board.data?.offline ? <OfflineBanner cachedAt={board.data.cachedAt} /> : null}
      {refused ? (
        <div role="alert" className="flex items-start gap-2 rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          <Icon name="alert" size={15} className="mt-px shrink-0" />
          <span className="flex-1">
            <b>{refused.job} was not moved.</b> {refused.message}
          </span>
          <button type="button" className="font-semibold underline" onClick={() => setRefused(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {board.isLoading ? <Spinner /> : board.error ? <ErrorNote error={board.error} onRetry={() => void board.refetch()} /> : null}
      <div className="flex min-h-0 flex-1 gap-2.5 overflow-x-auto pb-2 scroll-thin" aria-label="Job board">
        {columns.map((c) => (
          <section
            key={c.code}
            aria-label={c.label}
            data-column={c.code}
            onDragOver={(e: DragEvent) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(c.code);
            }}
            onDragLeave={() => setOver((o) => (o === c.code ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              drop(c);
            }}
            className={cx('flex w-[236px] shrink-0 flex-col overflow-hidden rounded-[12px] border border-line bg-[#F6F7FA] dark:bg-surface', over === c.code && dragging && dragging.column !== c.code && 'ring-2 ring-primary')}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
              <b className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{c.label}</b>
              <span className="flex h-[18px] min-w-5 items-center justify-center rounded-[9px] bg-surface px-1.5 text-[11px] font-bold text-ink-2 tabular-nums dark:bg-subtle">{c.count}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 scroll-thin">
              {c.jobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  data-job={j.id}
                  draggable={!offline}
                  aria-busy={moving === j.id}
                  aria-label={`${j.number}, ${j.status_label}. Open the job card; Alt and an arrow asks to move it.`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', String(j.id));
                    e.dataTransfer.effectAllowed = 'move';
                    setDragging(j);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  onKeyDown={(e) => onCardKey(e, j)}
                  onClick={() => onJob(j.id)}
                  className={cx('flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-2.5 py-2 text-left hover:border-primary/50', (dragging?.id === j.id || moving === j.id) && 'opacity-50', j.overdue && 'border-l-[3px] border-l-danger')}
                >
                  <JobSummary job={j} options={options} />
                  <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                    {j.service_advisor ? (
                      <span title={`Service advisor: ${j.service_advisor.name ?? ''}`} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-selection text-[9.5px] font-bold text-primary">
                        {initialsOf(j.service_advisor.name) || '?'}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{[j.technicians.map((t) => t.name).filter(Boolean).join(', '), j.bay?.code].filter(Boolean).join(' · ') || (j.waiting_reason ? `Waiting: ${options.waiting_reasons[j.waiting_reason] ?? j.waiting_reason}` : j.status_label)}</span>
                    <span className={cx('shrink-0', j.overdue && 'font-bold text-danger')}>{when(j.target_completion_at)}</span>
                  </span>
                </button>
              ))}
              {!c.jobs.length ? <span className="px-1 py-3 text-center text-[12px] text-ink-3">Nothing here.</span> : null}
            </div>
          </section>
        ))}
      </div>
      {ask ? (
        <Sheet
          title={ask.label}
          width={440}
          onClose={() => setAsk(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsk(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={!reason.trim()}
                onClick={() => {
                  const a = ask;
                  setAsk(null);
                  void move(a.job, a.column, reason.trim());
                }}
              >
                Ask to move
              </button>
            </>
          }
        >
          <span className="text-[12.5px] text-ink-2">
            Moving {ask.job.number} to {ask.column.label} needs a reason. It is kept in the job’s history.
          </span>
          <input autoFocus aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value)} className={input} maxLength={500} />
        </Sheet>
      ) : null}
    </div>
  );
}
