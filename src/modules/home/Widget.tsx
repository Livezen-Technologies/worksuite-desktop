import type { DragEvent, ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { compactCount, type CardId } from './today';

/** The drag type of a Home card being moved (#104). */
export const CARD_DRAG = 'application/x-worksuite-home-card';

/**
 * One Home card (#104, optimized): the same header everywhere — title, an optional count, one "›" link — and its
 * own loading, error (with Retry) and empty states, so one slow or failing source never holds up the rest. Empty
 * is a line, not a tall blank card. The grip moves the card; dropping a card on another of its zone puts it there.
 */
export function Widget({
  id,
  title,
  icon,
  count,
  countTone = 'muted',
  action,
  loading,
  error,
  onRetry,
  empty,
  className,
  onPlace,
  children,
  tone = 'plain',
  aside,
}: {
  id: CardId;
  title: string;
  /** Shown before the title on the dark card only; the light cards are titled by words alone, as designed. */
  icon?: string;
  count?: number | null;
  countTone?: 'muted' | 'warning' | 'danger' | 'indigo';
  action?: ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Said when there is nothing: a short line, optionally with what to do. */
  empty?: ReactNode | null;
  /** Where it sits in the grid (its column span). */
  className?: string;
  onPlace?: (moved: CardId, before: CardId) => void;
  children?: ReactNode;
  tone?: 'plain' | 'navy';
  /** Small text at the right of the header, before the action ("Updated 1:00 PM"). */
  aside?: ReactNode;
}) {
  const tones = { muted: 'bg-subtle text-ink-2', warning: 'bg-warning-bg text-warning', danger: 'bg-danger-bg text-danger', indigo: 'bg-selection text-primary' };
  const navy = tone === 'navy';
  const drop = (e: DragEvent) => {
    const moved = e.dataTransfer.getData(CARD_DRAG) as CardId;
    if (!moved || !onPlace) return;
    e.preventDefault();
    onPlace(moved, id);
  };
  return (
    <section
      aria-label={title}
      data-card={id}
      onDragOver={(e) => {
        if (onPlace && e.dataTransfer.types.includes(CARD_DRAG)) e.preventDefault();
      }}
      onDrop={drop}
      className={cx('group/card flex min-w-0 flex-col rounded-[14px] border', navy ? 'border-transparent bg-navy text-navy-ink dark:bg-navy-2' : 'border-line bg-surface', className)}
    >
      <header className="flex shrink-0 items-center gap-2 px-5 pt-[18px] pb-3">
        {onPlace ? (
          <span
            draggable
            role="img"
            aria-label={`Move ${title}`}
            title="Drag to move"
            onDragStart={(e) => {
              e.dataTransfer.setData(CARD_DRAG, id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={cx('-ml-3 -mr-1 cursor-grab opacity-0 group-hover/card:opacity-60 hover:!opacity-100 focus:opacity-100', navy ? 'text-navy-ink' : 'text-ink-3')}
          >
            <Icon name="more-vertical" size={14} />
          </span>
        ) : null}
        {navy && icon ? <Icon name={icon} size={16} className="text-teal-light" /> : null}
        <h2 className={cx('min-w-0 truncate font-semibold tracking-[-0.01em]', navy ? 'text-[15px] text-white' : 'text-[16px] text-ink')}>{title}</h2>
        {count ? (
          <span title={count.toLocaleString()} className={cx('rounded-full px-2 py-px text-[11.5px] font-bold tabular', tones[countTone])}>
            {compactCount(count)}
          </span>
        ) : null}
        <span className="flex-1" />
        {aside ? <span className={cx('shrink-0 text-[11px]', navy ? 'text-navy-ink/80' : 'text-ink-3')}>{aside}</span> : null}
        {action}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-4">
        {loading ? (
          <div aria-busy="true" aria-label={`Loading ${title}`} className="flex flex-col gap-2 py-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className={cx('h-4 animate-pulse rounded motion-reduce:animate-none', navy ? 'bg-white/10' : 'bg-subtle')} style={{ width: `${90 - i * 18}%` }} />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className={cx('flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px]', navy ? 'bg-white/10 text-white' : 'bg-danger-bg text-danger')}>
            <Icon name="alert" size={15} />
            <span className="min-w-0 flex-1">{error instanceof Error ? error.message : 'This could not be loaded.'}</span>
            {onRetry ? (
              <button type="button" onClick={onRetry} className="font-semibold underline">
                Retry
              </button>
            ) : null}
          </div>
        ) : empty ? (
          <div className={cx('flex items-center gap-2 py-1 text-[13px]', navy ? 'text-navy-ink' : 'text-ink-3')}>{empty}</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** The "All tasks ›" of a card's header. */
export function HeaderLink({ children, onClick, light, label }: { children: ReactNode; onClick: () => void; light?: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cx('flex shrink-0 items-center gap-0.5 text-[13px] font-medium hover:underline', light ? 'text-teal-light' : 'text-primary')}>
      {children}
      <Icon name="chevron-right" size={14} />
    </button>
  );
}
