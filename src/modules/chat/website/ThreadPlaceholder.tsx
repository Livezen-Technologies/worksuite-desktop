import { useEffect, useState, type ReactNode } from 'react';
import { text } from '../../../core/i18n';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';

/**
 * A website conversation not yet on this computer (worksuite-desktop#239): the thread's own layout in grey — the header
 * with the visitor's circle and two lines, bubbles on alternating sides, the composer (disabled until it loads) and the
 * visitor panel — shimmering only where motion is welcome. After {@link SLOW_AFTER_MS} it says it is still loading,
 * centred, with Retry.
 */
export const SLOW_AFTER_MS = 5_000;

/** The grey bubbles: who wrote (left the visitor, right the team) and how wide each is. */
const BUBBLES: Array<{ mine: boolean; w: string; h?: string }> = [
  { mine: false, w: 'w-[46%]' },
  { mine: true, w: 'w-[38%]' },
  { mine: false, w: 'w-[58%]', h: 'h-12' },
  { mine: true, w: 'w-[30%]' },
  { mine: false, w: 'w-[42%]' },
];

const bar = 'rounded-full bg-subtle motion-safe:animate-pulse';

export function ThreadPlaceholder({ mini = false, onRetry }: { mini?: boolean; onRetry: () => void }) {
  const [slow, restart] = useSlow();
  return (
    <div className="relative flex h-full min-w-0 flex-1" role="status" aria-busy="true" aria-label={text('Loading the conversation')}>
      <section aria-hidden className="flex min-w-0 flex-1 flex-col bg-ground" data-testid="thread-placeholder">
        <div className={cx('flex shrink-0 items-center gap-2 border-b border-line bg-surface', mini ? 'min-h-12 px-3 py-2' : 'min-h-14 px-3.5 py-[11px]')}>
          <span className={cx('shrink-0 rounded-full bg-subtle motion-safe:animate-pulse', mini ? 'h-[30px] w-[30px]' : 'h-[34px] w-[34px]')} />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className={cx(bar, 'h-3 w-[140px] max-w-[60%]')} />
            <span className={cx(bar, 'h-2.5 w-[200px] max-w-[80%]')} />
          </span>
        </div>
        <div className={cx('flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden py-4', mini ? 'px-3' : 'px-4')}>
          {BUBBLES.map((b, i) => (
            <span key={i} data-side={b.mine ? 'right' : 'left'} className={cx('rounded-[14px] bg-subtle motion-safe:animate-pulse', b.h ?? 'h-9', b.w, b.mine ? 'self-end' : 'self-start')} />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3.5 py-2.5">
          <textarea disabled rows={1} aria-label={text('Reply')} placeholder={text('Loading…')} className="min-h-9 flex-1 resize-none rounded-[8px] border border-line bg-subtle px-3 py-2 text-[13px] text-ink-3 disabled:cursor-not-allowed" />
          <button type="button" disabled aria-label={text('Send')} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-subtle text-ink-3 disabled:cursor-not-allowed">
            <Icon name="send" size={15} />
          </button>
        </div>
      </section>
      {!mini ? (
        <aside aria-hidden className="hidden w-[300px] shrink-0 flex-col gap-3 border-l border-line bg-surface p-4 lg:flex">
          <span className="flex items-center gap-3">
            <span className="h-12 w-12 shrink-0 rounded-full bg-subtle motion-safe:animate-pulse" />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className={cx(bar, 'h-3 w-3/4')} />
              <span className={cx(bar, 'h-2.5 w-1/2')} />
            </span>
          </span>
          {[0, 1, 2].map((i) => <span key={i} className="h-20 rounded-[12px] bg-subtle motion-safe:animate-pulse" />)}
        </aside>
      ) : null}
      {slow ? (
        <PaneNotice>
          {text('Still loading…')}
          <RetryButton onRetry={() => (restart(), onRetry())} />
        </PaneNotice>
      ) : null}
    </div>
  );
}

/** The conversation could not be read and there is no copy of it here: said in the middle, with Retry. */
export function ThreadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="relative flex h-full min-w-0 flex-1 bg-ground">
      <PaneNotice role="alert">
        <Icon name="alert" size={15} className="shrink-0 text-danger" />
        {text("Couldn't load this conversation")}
        <span aria-hidden className="text-ink-3">·</span>
        <RetryButton onRetry={onRetry} />
      </PaneNotice>
    </div>
  );
}

/** A note centred on the pane, over whatever is drawn beneath it. */
export function PaneNotice({ role = 'status', children }: { role?: 'status' | 'alert'; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div role={role} className="pointer-events-auto flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-4 py-2.5 text-[13px] text-ink-2 shadow-sm">
        {children}
      </div>
    </div>
  );
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" onClick={onRetry} className="font-semibold text-primary hover:underline focus-visible:underline focus-visible:outline-none">
      {text('Retry')}
    </button>
  );
}

/** True once loading has gone on for {@link SLOW_AFTER_MS}; Retry starts the count again. */
export function useSlow(): [boolean, () => void] {
  const [round, setRound] = useState(0);
  const [slowRound, setSlowRound] = useState(-1);
  useEffect(() => {
    const t = setTimeout(() => setSlowRound(round), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [round]);
  return [slowRound === round, () => setRound((r) => r + 1)];
}
