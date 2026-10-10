import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { hhmm, mondayOf } from '@shared/projects';
import { errorMessage } from '../../core/bridge';
import { addDays, dayWords } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { qk, read } from './api';
import { elapsedOf, useProjectTimer } from './desk';
import { openWeb } from './parts';
// DELIVERY: my week's entries say why they are locked or sent back, and one of mine can be deleted (online).
import { dwrite, fmtDay, type QueueEntry } from './delivery';
import { Confirm, NEEDS_CONNECTION } from './screens/kit';

/**
 * The Projects app's lighter view: my time this week with what waits for my approval (Time & approvals' My week).
 * Approvals need WorkSuite: they are disabled offline and never kept (PRJ-DSK-04).
 */

/** My time this week (PRJ-TIM), the running timer with it, and the approvals waiting for me (the queue, online). */
export function TimeView({ today, waiting, offline, onLogTime, onOffline, onReview }: { today: string; waiting: number; offline: boolean; onLogTime: () => void; onOffline: (o: boolean) => void; onReview?: () => void }) {
  const [day, setDay] = useState(today);
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<QueueEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async (e: QueueEntry) => {
    setBusy(true);
    try {
      await dwrite.deleteTime(e.id);
      toast('success', 'Time deleted.');
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: qk.all });
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const q = useQuery({ queryKey: qk.week(mondayOf(day)), queryFn: ({ signal }) => read.week(mondayOf(day), { signal }) });
  const timer = useProjectTimer();
  const now = useNow(30_000).getTime();
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const entries = (q.data?.data.entries ?? []).filter((e) => !e.running);
  const monday = mondayOf(day);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const running = timer.running && mondayOf(today) === monday ? Math.floor(elapsedOf(timer.running.startedAt, now) / 60) : 0;
  const total = entries.reduce((n, e) => n + e.minutes, 0) + running;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 scroll-thin">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-[20px] font-bold text-ink">Time & approvals</h1>
          <span className="text-[12.5px] text-ink-3">
            Week of {dayWords(monday)} · {hhmm(total)} logged
          </span>
        </div>
        <Button size="sm" aria-label="Earlier week" onClick={() => setDay(addDays(monday, -7))}>
          ←
        </Button>
        {monday !== mondayOf(today) ? (
          <Button size="sm" onClick={() => setDay(today)}>
            This week
          </Button>
        ) : null}
        <Button size="sm" aria-label="Later week" disabled={monday >= mondayOf(today)} onClick={() => setDay(addDays(monday, 7))}>
          →
        </Button>
        <Button size="sm" variant="primary" icon="clock" onClick={onLogTime}>
          Log time
        </Button>
      </div>
      {waiting ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[12.5px]">
          <b className="flex-1 text-ink">
            {waiting} time {waiting === 1 ? 'entry waits' : 'entries wait'} for your approval
          </b>
          <Button size="sm" disabled={offline} title={offline ? 'Approvals wait for a connection' : onReview ? 'Opens the approval queue' : 'Opens the approval queue on the web'} onClick={() => (onReview ? onReview() : openWeb('/projects/time'))}>
            {offline ? 'Waits for a connection' : onReview ? 'Review' : 'Review on the web'}
          </Button>
        </div>
      ) : null}
      {q.isLoading ? <Spinner /> : null}
      {q.error && !q.data ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      <div className="flex flex-col gap-2">
        {days.map((d) => {
          const list = entries.filter((e) => e.on_date === d);
          const run = timer.running && d === today && running ? running : 0;
          if (!list.length && !run) return null;
          return (
            <section key={d} className="rounded-[12px] border border-line bg-surface">
              <div className="flex items-center border-b border-line px-3.5 py-1.5">
                <b className={cx('flex-1 text-[12.5px]', d === today ? 'text-primary' : 'text-ink')}>{dayWords(d, { weekday: true })}</b>
                <span className="font-mono text-[12px] font-bold text-ink">{hhmm(list.reduce((n, e) => n + e.minutes, 0) + run)}</span>
              </div>
              {(list as QueueEntry[]).map((e) => (
                <div key={e.id} className="flex flex-col border-b border-line/60 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="w-[70px] font-mono text-[11px] text-ink-3">{e.task_number ?? e.project_code ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{e.task ?? e.project ?? 'Internal · not on a project'}</span>
                    {e.note ? <span className="max-w-[30%] truncate text-ink-3">{e.note}</span> : null}
                    <span className="text-[11px] text-ink-3">{e.is_billable ? 'billable' : 'non-billable'}</span>
                    <span className="text-[11px] text-ink-3">{e.approved ? 'approved' : e.state === 'submitted' ? 'in HR timesheet' : (e.state ?? '').replace(/_/g, ' ')}</span>
                    <span className="w-[44px] text-right font-mono font-semibold text-ink">{hhmm(e.minutes)}</span>
                    {e.is_mine !== false && !e.locked && !e.running && !e.approved ? (
                      <button type="button" disabled={offline} title={offline ? NEEDS_CONNECTION : undefined} aria-label={`Delete ${hhmm(e.minutes)} on ${fmtDay(e.on_date)}`} onClick={() => setDeleting(e)} className="text-[11.5px] font-semibold text-danger hover:underline disabled:opacity-50">
                        Delete
                      </button>
                    ) : null}
                  </div>
                  {e.sent_back_note ? <span className="ps-[78px] text-[11.5px] text-danger">Sent back: {e.sent_back_note}</span> : null}
                  {e.locked ? <span className="ps-[78px] text-[11px] text-ink-3">Locked · {e.lock_reason ?? (e.state ?? 'approved').replace(/_/g, ' ')}</span> : null}
                </div>
              ))}
              {run && timer.running ? (
                <div className="flex items-center gap-2 px-3.5 py-1.5 text-[12.5px]">
                  <span className="w-[70px] font-mono text-[11px] text-ink-3">{timer.running.taskNumber ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{timer.running.task ?? timer.running.project ?? 'Internal'}</span>
                  <span className="text-[11px] font-semibold text-success">running</span>
                  <span className="w-[44px] text-right font-mono font-semibold text-ink">{hhmm(run)}</span>
                </div>
              ) : null}
            </section>
          );
        })}
        {q.data && !entries.length && !running ? <p className="py-4 text-center text-ink-3">Nothing logged this week.</p> : null}
      </div>
      {deleting ? <Confirm title="Delete time" message={`Delete ${hhmm(deleting.minutes)} on ${fmtDay(deleting.on_date)}?`} confirmLabel="Delete" danger busy={busy} onClose={() => setDeleting(null)} onConfirm={() => void remove(deleting)} /> : null}
    </div>
  );
}
