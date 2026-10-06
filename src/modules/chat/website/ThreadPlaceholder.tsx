import { useEffect, useState, type ReactNode } from 'react';
import { text } from '../../../core/i18n';
import { Icon } from '../../../components/Icon';
import { Avatar, cx } from '../../../components/ui';

/**
 * A website conversation not yet on this computer (worksuite-desktop#239): the thread's own layout in grey — the header
 * with the visitor's circle and two lines, bubbles on alternating sides, the composer (disabled until it loads) and the
 * visitor panel — shimmering only where motion is welcome. After {@link SLOW_AFTER_MS} it says it is still loading,
 * centred, with Retry.
 *
 * Opened from a list (worksuite-desktop#261), the header is no placeholder: the row already knows who it is, so their
 * name, circle and where they are (or how the chat ended) are drawn at once, and only what the row cannot know waits.
 * Closed, missed and offline chats, read back without a composer, have the same placeholder in their own look.
 */
export const SLOW_AFTER_MS = 5_000;

/** What the list row knows about a conversation, drawn as its header while the rest loads (#261). */
export interface PaneHead {
  name: string;
  /** Under the name: where the visitor is, or how the chat ended. */
  line?: string | null;
  presence?: 'online' | 'away' | null;
}

/** `thread`: the open conversation, with its composer; `detail`: a closed, missed or offline chat read back. */
export type PaneLook = 'thread' | 'detail';

/** The grey bubbles: who wrote (left the visitor, right the team) and how wide each is. */
const BUBBLES: Array<{ mine: boolean; w: string; h?: string }> = [
  { mine: false, w: 'w-[46%]' },
  { mine: true, w: 'w-[38%]' },
  { mine: false, w: 'w-[58%]', h: 'h-12' },
  { mine: true, w: 'w-[30%]' },
  { mine: false, w: 'w-[42%]' },
];

const bar = 'rounded-full bg-subtle motion-safe:animate-pulse';

/** The header: the row's visitor when there is a row, else the visitor's circle and two lines in grey. */
function HeadBar({ head, mini, look }: { head?: PaneHead; mini: boolean; look: PaneLook }) {
  const detail = look === 'detail';
  const size = detail ? 38 : mini ? 30 : 34;
  return (
    <div data-testid="pane-head" className={cx('flex shrink-0 items-center border-b border-line bg-surface', detail ? 'min-h-16 gap-3 px-5 py-2.5' : mini ? 'min-h-12 gap-2 px-3 py-2' : 'min-h-14 gap-2 px-3.5 py-[11px]')}>
      {head ? (
        <>
          <Avatar name={head.name} size={size} presence={head.presence ?? null} />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className={cx('truncate text-ink', detail && 'text-[15px]')}>{head.name}</b>
            {head.line ? (
              <span className={cx('truncate', detail ? 'text-[12px]' : 'text-[11.5px] font-semibold', head.presence === 'online' ? 'text-success' : 'text-ink-3')}>{head.line}</span>
            ) : (
              <span aria-hidden className={cx(bar, 'mt-1.5 h-2.5 w-[200px] max-w-[80%]')} />
            )}
          </span>
        </>
      ) : (
        <>
          <span aria-hidden className="shrink-0 rounded-full bg-subtle motion-safe:animate-pulse" style={{ width: size, height: size }} />
          <span aria-hidden className="flex flex-1 flex-col gap-1.5">
            <span className={cx(bar, 'h-3 w-[140px] max-w-[60%]')} />
            <span className={cx(bar, 'h-2.5 w-[200px] max-w-[80%]')} />
          </span>
        </>
      )}
    </div>
  );
}

export function ThreadPlaceholder({ mini = false, head, look = 'thread', onRetry }: { mini?: boolean; head?: PaneHead; look?: PaneLook; onRetry: () => void }) {
  const [slow, restart] = useSlow();
  return (
    <div className="relative flex h-full min-w-0 flex-1" role="status" aria-busy="true" aria-label={text('Loading the conversation')}>
      <section className="flex min-w-0 flex-1 flex-col bg-ground" data-testid="thread-placeholder">
        <HeadBar head={head} mini={mini} look={look} />
        <div aria-hidden className={cx('flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden py-4', mini ? 'px-3' : look === 'detail' ? 'px-[22px]' : 'px-4')}>
          {BUBBLES.map((b, i) => (
            <span key={i} data-side={b.mine ? 'right' : 'left'} className={cx('rounded-[14px] bg-subtle motion-safe:animate-pulse', b.h ?? 'h-9', b.w, b.mine ? 'self-end' : 'self-start')} />
          ))}
        </div>
        {look === 'thread' ? (
          <div aria-hidden className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3.5 py-2.5">
            <textarea disabled rows={1} aria-label={text('Reply')} placeholder={text('Loading…')} className="min-h-9 flex-1 resize-none rounded-[8px] border border-line bg-subtle px-3 py-2 text-[13px] text-ink-3 disabled:cursor-not-allowed" />
            <button type="button" disabled aria-label={text('Send')} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-subtle text-ink-3 disabled:cursor-not-allowed">
              <Icon name="send" size={15} />
            </button>
          </div>
        ) : null}
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
          <span aria-hidden className="text-ink-3">·</span>
          <RetryButton onRetry={() => (restart(), onRetry())} />
        </PaneNotice>
      ) : null}
    </div>
  );
}

/**
 * The conversation could not be read and there is no copy of it here: said in the middle, with Retry — under the
 * row's header when it was opened from a list (#261), so it is still clear whose chat it is.
 */
export function ThreadFailed({ head, mini = false, look = 'thread', onRetry }: { head?: PaneHead; mini?: boolean; look?: PaneLook; onRetry: () => void }) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-ground">
      {head ? <HeadBar head={head} mini={mini} look={look} /> : null}
      <div className="relative min-h-0 flex-1">
        <PaneNotice role="alert">
          <Icon name="alert" size={15} className="shrink-0 text-danger" />
          {text("Couldn't load this conversation")}
          <span aria-hidden className="text-ink-3">·</span>
          <RetryButton onRetry={onRetry} />
        </PaneNotice>
      </div>
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
