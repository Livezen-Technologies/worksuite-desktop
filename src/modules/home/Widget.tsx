import type { DragEvent, ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { compactCount, type CardId, type CardSize } from './today';

/** The drag type of a Home card being moved (#104). */
export const CARD_DRAG = 'application/x-worksuite-home-card';

/**
 * One Home widget (#104): the same header everywhere — icon, title, count, one action — and its own loading, error
 * (with Retry) and empty states, so one slow or failing source never holds up the rest. Empty is a line, not a
 * tall blank card. The grip moves the card; dropping a card on another puts it there.
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
  size = 'normal',
  onPlace,
  children,
  tone = 'plain',
}: {
  id: CardId;
  title: string;
  icon: string;
  count?: number | null;
  countTone?: 'muted' | 'warning' | 'danger' | 'indigo';
  action?: ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Said when there is nothing: a short line, optionally with what to do. */
  empty?: ReactNode | null;
  size?: CardSize;
  onPlace?: (moved: CardId, before: CardId) => void;
  children?: ReactNode;
  tone?: 'plain' | 'navy';
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
      className={cx('group/card flex min-w-0 flex-col rounded-[12px] border', navy ? 'border-transparent bg-navy text-white' : 'border-line bg-surface', size === 'wide' && 'lg:col-span-2')}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 px-4">
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
            className={cx('-ml-2 cursor-grab opacity-0 group-hover/card:opacity-60 hover:!opacity-100 focus:opacity-100', navy ? 'text-navy-ink' : 'text-ink-3')}
          >
            <Icon name="more-vertical" size={14} />
          </span>
        ) : null}
        <Icon name={icon} size={16} className={navy ? 'text-teal-light' : 'text-ink-2'} />
        <h2 className={cx('min-w-0 truncate text-[14px] font-bold', navy ? 'text-white' : 'text-ink')}>{title}</h2>
        {count ? (
          <span title={count.toLocaleString()} className={cx('rounded-full px-2 py-px text-[11.5px] font-bold tabular', tones[countTone])}>
            {compactCount(count)}
          </span>
        ) : null}
        <span className="flex-1" />
        {action}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        {loading ? (
          <div aria-busy="true" aria-label={`Loading ${title}`} className="flex flex-col gap-2 py-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className={cx('h-4 animate-pulse rounded', navy ? 'bg-white/10' : 'bg-subtle')} style={{ width: `${90 - i * 18}%` }} />
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

/** A small text action in a widget's header. */
export function HeaderLink({ children, onClick, light }: { children: ReactNode; onClick: () => void; light?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('shrink-0 text-[12.5px] font-semibold hover:underline', light ? 'text-teal-light' : 'text-primary')}>
      {children}
    </button>
  );
}
