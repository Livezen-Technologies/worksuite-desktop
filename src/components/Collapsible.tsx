import { useEffect, useId, useRef, useState, type ReactNode, type TransitionEvent } from 'react';
import { app } from '../core/app-state';
import { useStore } from '../core/store';
import { Icon } from './Icon';
import { cx } from './ui';

/**
 * A settings section that opens and closes under its header (worksuite-desktop#244): the title, a short summary of
 * what is set while it is closed ("Indigo · light"), and a chevron, on one `<button aria-expanded aria-controls>`.
 *
 * Each section is an ordinary block in the page's flow — put them in a `flex flex-col gap-*` column; the section
 * itself never shrinks there, so a long body can never be squeezed under the next one. A closed body is out of the
 * layout altogether (`hidden`), so nothing in it shows, takes a click or is read out. Opening and closing animate the
 * body's grid row from 0fr to 1fr — no measured heights, so content that arrives later is never cut off — and while it
 * closes the body is already `inert`. With reduced motion (or where the preference cannot be read) it simply opens and
 * closes.
 *
 * Several sections can be open at once. With `persist`, whether one is open is remembered for the signed-in person on
 * this computer. `forceOpen` opens it when something inside needs attention (a field Save is waiting on).
 *
 * `card`: a stand-alone card, as Settings' cards are. `row`: a row inside a card, divided from the next one.
 */

type Phase = 'open' | 'opening' | 'closing' | 'closed';

const STORE_PREFIX = 'worksuite.sections.v1.';
/** How long the open/close takes; the close falls back to this when no transitionend arrives. */
const DURATION_MS = 200;

const storeKey = (uid: string) => `${STORE_PREFIX}${uid || 'anyone'}`;

function readAll(uid: string): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(uid)) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Whether `id` was left open by this person, or undefined when they never chose. */
export function recallSection(uid: string, id: string): boolean | undefined {
  const v = readAll(uid)[id];
  return typeof v === 'boolean' ? v : undefined;
}

export function rememberSection(uid: string, id: string, open: boolean) {
  try {
    localStorage.setItem(storeKey(uid), JSON.stringify({ ...readAll(uid), [id]: open }));
  } catch {
    /* not remembering is a preference lost, not a failure */
  }
}

/** Animate only when the person has said nothing against motion and the preference can be read. */
function motionAllowed(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: no-preference)')?.matches === true;
}

export interface CollapsibleSectionProps {
  title: ReactNode;
  /** What is set, shown beside the title while the section is closed. */
  summary?: ReactNode;
  children: ReactNode;
  /** A stable name for remembering whether it is open, e.g. `website.widget.launcher`. */
  persist?: string;
  defaultOpen?: boolean;
  /** Opens the section (without remembering it) when something inside needs attention. */
  forceOpen?: boolean;
  variant?: 'card' | 'row';
  /** The heading level of the title. */
  level?: 2 | 3 | 4;
  className?: string;
  bodyClassName?: string;
  'data-testid'?: string;
}

export function CollapsibleSection({ title, summary, children, persist, defaultOpen = true, forceOpen = false, variant = 'card', level = variant === 'card' ? 2 : 3, className, bodyClassName, 'data-testid': testId }: CollapsibleSectionProps) {
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const base = useId();
  const buttonId = `${base}-button`;
  const titleId = `${base}-title`;
  const summaryId = `${base}-summary`;
  const bodyId = `${base}-body`;
  const [open, setOpen] = useState<boolean>(() => forceOpen || (persist ? (recallSection(uid, persist) ?? defaultOpen) : defaultOpen));
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);

  // Something inside needs attention: open at once (state adjusted while rendering, not in an effect).
  const [wasForced, setWasForced] = useState(forceOpen);
  if (forceOpen !== wasForced) {
    setWasForced(forceOpen);
    if (forceOpen && !open) {
      setOpen(true);
      setPhase('open');
    }
  }

  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
    timer.current = null;
    frame.current = null;
  };
  useEffect(() => stop, []);

  const toggle = () => {
    const next = !open;
    stop();
    setOpen(next);
    if (persist) rememberSection(uid, persist, next);
    if (!motionAllowed()) {
      setPhase(next ? 'open' : 'closed');
      return;
    }
    if (next) {
      // In the layout at 0fr first, then to 1fr on a later frame, so the row has somewhere to grow from.
      setPhase('opening');
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          setPhase((p) => (p === 'opening' ? 'open' : p));
        });
      });
    } else {
      setPhase('closing');
      timer.current = setTimeout(() => {
        timer.current = null;
        setPhase((p) => (p === 'closing' ? 'closed' : p));
      }, DURATION_MS + 80);
    }
  };

  const onTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || phase !== 'closing') return;
    stop();
    setPhase('closed');
  };

  const H = `h${level}` as 'h2' | 'h3' | 'h4';
  const card = variant === 'card';
  const showSummary = !open && summary !== undefined && summary !== null && summary !== '';

  return (
    <section data-testid={testId} data-open={open ? 'true' : 'false'} className={cx('flex shrink-0 flex-col', card ? 'rounded-[12px] border border-line bg-surface' : 'border-b border-line/70 last:border-b-0', className)}>
      <H className="m-0 flex">
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-labelledby={titleId}
          aria-describedby={showSummary ? summaryId : undefined}
          onClick={toggle}
          className={cx(
            'group flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            card ? 'min-h-[48px] rounded-[12px] px-4 py-3 hover:bg-subtle/60' : 'min-h-[36px] rounded-[6px] py-2 hover:text-ink',
            card && open ? 'rounded-b-none' : null,
          )}
        >
          <span id={titleId} className={cx('min-w-0 break-words', card ? 'text-[15px] font-bold text-ink' : 'text-[13px] font-semibold text-ink-2')}>{title}</span>
          <span id={summaryId} hidden={!showSummary} className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{showSummary ? summary : null}</span>
          {showSummary ? null : <span aria-hidden className="flex-1" />}
          <Icon name="chevron-down" size={16} className={cx('shrink-0 text-ink-3 transition-transform duration-200 motion-reduce:transition-none', open ? 'rotate-0' : '-rotate-90')} />
        </button>
      </H>
      <div
        id={bodyId}
        role={card ? 'region' : undefined}
        aria-labelledby={card ? buttonId : undefined}
        hidden={phase === 'closed'}
        inert={!open}
        data-phase={phase}
        onTransitionEnd={onTransitionEnd}
        className={cx(phase === 'closed' ? null : 'grid', 'transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none')}
        style={{ gridTemplateRows: phase === 'open' ? '1fr' : '0fr', visibility: phase === 'closed' ? 'hidden' : undefined }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={cx(card ? 'border-t border-line/70 px-4 pt-3.5 pb-4' : 'pb-3', bodyClassName)}>{children}</div>
        </div>
      </div>
    </section>
  );
}
