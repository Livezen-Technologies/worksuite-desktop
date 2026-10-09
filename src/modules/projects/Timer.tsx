import { useEffect, useState } from 'react';
import { clockOf, targetLabel } from '@shared/projects';
import { call, errorMessage } from '../../core/bridge';
import { useCanOpen } from '../../core/access';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { elapsedOf, setTimerState, useProjectTimer } from './desk';

/**
 * The Projects timer outside the Projects tab (PRJ-DSK-02, D02): the mini timer window, always on top — H:MM:SS,
 * pause, stop and the entry's note — and the title bar's pill, which opens it.
 */

const act = async (fn: () => Promise<Parameters<typeof setTimerState>[0]>) => {
  try {
    setTimerState(await fn());
  } catch (e) {
    toast('error', errorMessage(e));
  }
};

export function MiniTimer() {
  const timer = useProjectTimer();
  const now = useNow(1000).getTime();
  const r = timer.running;
  useEffect(() => {
    document.title = r ? `${clockOf(elapsedOf(r.startedAt, now))} · ${r.taskNumber ?? 'Timer'}` : 'Timer';
  });
  return (
    <div className="flex h-full flex-col justify-center gap-2 bg-surface px-4 py-3 text-ink">
      <div className="flex items-center gap-2.5">
        <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', r ? 'bg-success' : 'bg-line')} aria-hidden />
        <b className="flex-1 font-mono text-[26px] leading-none tabular-nums" aria-live="off">
          {r ? clockOf(elapsedOf(r.startedAt, now)) : '0:00:00'}
        </b>
        {r ? (
          <>
            <button type="button" aria-label="Pause" title="Pause — stops now, ready to start again" onClick={() => void act(() => call('projects:timerPause'))} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line hover:bg-subtle">
              <Icon name="pause" size={14} />
            </button>
            <Button variant="danger" size="sm" onClick={() => void act(() => call('projects:timerStop', { note: r.note }))}>
              Stop
            </Button>
          </>
        ) : timer.paused ? (
          <Button variant="primary" size="sm" icon="play" disabled={timer.offline} onClick={() => void act(() => call('projects:timerResume'))}>
            Resume
          </Button>
        ) : null}
      </div>
      <span className="truncate text-[12.5px] font-semibold text-ink-2">{r ? targetLabel(r) : timer.paused ? `Paused — ${timer.paused.label}` : 'No timer running. Start one from a task (T).'}</span>
      {r ? <NoteField key={`${r.id}:${r.note ?? ''}`} initial={r.note ?? ''} /> : null}
    </div>
  );
}

/** The entry's note, typed in the mini timer: kept with the timer (on blur or Enter) and sent with its stop. */
function NoteField({ initial }: { initial: string }) {
  const [note, setNote] = useState(initial);
  const save = () => {
    if ((note.trim() || '') !== initial) void act(() => call('projects:timerNote', { note }));
  };
  return (
    <input
      value={note}
      onChange={(e) => setNote(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      maxLength={1000}
      aria-label="Note for this entry"
      placeholder="Note for this entry…"
      className="h-[30px] rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-primary"
    />
  );
}

/** "● TSK-0412 1:12:48" in the title bar while a timer runs (D01); a click opens the mini timer. */
export function TimerPill() {
  const can = useCanOpen('projects');
  const timer = useProjectTimer();
  const r = can ? timer.running : null;
  const now = useNow(r ? 1000 : 60_000).getTime();
  if (!r) return null;
  return (
    <button
      type="button"
      onClick={() => void call('projects:timerWindow').catch((e) => toast('error', errorMessage(e)))}
      title={`${targetLabel(r)} — open the mini timer`}
      aria-label={`Timer running on ${targetLabel(r)}: ${clockOf(elapsedOf(r.startedAt, now))}. Open the mini timer`}
      className="no-drag flex h-8 items-center gap-2 rounded-full bg-[#43B581]/12 px-3 text-[12.5px] font-semibold text-[#7EE2B0] hover:bg-[#43B581]/20"
    >
      <span className="h-2 w-2 rounded-full bg-[#43B581]" />
      {r.taskNumber ? <span className="font-mono">{r.taskNumber}</span> : null}
      <span className="font-mono tabular-nums">{clockOf(elapsedOf(r.startedAt, now))}</span>
    </button>
  );
}
