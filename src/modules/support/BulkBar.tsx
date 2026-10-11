import type { MouseEvent } from 'react';
import type { Ticket } from '@shared/support';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { ticketCount } from './bulk';
import type { MenuOnly, useTicketActions } from './TicketActions';

/**
 * The bulk bar (#333, FR-WSP-04): over the list while any ticket is picked — how many, then Status, Assign, Priority
 * and Tag (each the right-click menu's part on its own), Merge for two or more, Delete (Restore in the bin), and Clear.
 * Only what the person may do to the tickets picked is there.
 *
 * Select all takes the tickets loaded: the list's API pages with a cursor and has no "every id matching" answer, so
 * when a whole page is picked and more match, the bar says the rest are not picked and offers to load them.
 */
export function BulkBar({
  targets,
  loaded,
  more,
  actions,
  onSelectAll,
  onLoadMore,
  onClear,
}: {
  targets: Ticket[];
  /** How many tickets the list has loaded. */
  loaded: number;
  /** More match than are loaded. */
  more: boolean;
  actions: ReturnType<typeof useTicketActions>;
  onSelectAll: () => void;
  onLoadMore: (() => void) | null;
  onClear: () => void;
}) {
  const may = actions.can(targets);
  const n = targets.length;
  const at = (only: MenuOnly) => (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    actions.openMenu(targets, r.left, r.bottom + 4, only);
  };
  const all = n > 0 && n === loaded;
  return (
    <div className="shrink-0 border-b border-line bg-selection/60">
      <div role="toolbar" aria-label={text('Selected tickets')} className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        <span className="mr-1 px-1 text-[12.5px] font-bold text-ink" aria-live="polite">
          {text('{count} selected', { count: n })}
        </span>
        {may.status.length ? <BarButton icon="circle-dot" label={text('Status')} onClick={at('status')} menu /> : null}
        {may.assign || may.take ? <BarButton icon="user" label={text('Assign')} onClick={at('assign')} menu keys="A" /> : null}
        {may.edit ? <BarButton icon="flag" label={text('Priority')} onClick={at('priority')} menu keys="P" /> : null}
        {may.edit ? <BarButton icon="tag" label={text('Tag')} onClick={at('tags')} menu keys="#" /> : null}
        {may.merge ? <BarButton icon="merge" label={text('Merge')} onClick={() => actions.run(targets, { action: 'merge', primary_id: targets[0]?.id })} /> : null}
        {may.delete ? <BarButton icon="trash" label={text('Delete')} danger onClick={() => actions.run(targets, { action: 'delete' })} /> : null}
        {may.restore ? <BarButton icon="undo" label={text('Restore')} onClick={() => actions.run(targets, { action: 'restore' })} /> : null}
        <button
          type="button"
          onClick={onClear}
          aria-keyshortcuts="Escape"
          title={text('Clear the selection (Esc)')}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-semibold text-ink-2 hover:bg-subtle hover:text-ink"
        >
          <Icon name="x" size={13} /> {text('Clear')}
        </button>
      </div>
      {all && more ? (
        <p className="flex flex-wrap items-center gap-x-2 px-3 pb-1.5 text-[12px] text-ink-2">
          {text('All {count} loaded are selected; more match this view and are not.', { count: ticketCount(n) })}
          {onLoadMore ? (
            <button type="button" onClick={onLoadMore} className="font-semibold text-primary hover:underline">
              {text('Load more')}
            </button>
          ) : null}
        </p>
      ) : null}
      {!all && loaded > n && n > 0 ? (
        <p className="px-3 pb-1.5 text-[12px] text-ink-3">
          <button type="button" onClick={onSelectAll} aria-keyshortcuts="Control+A Meta+A" className="font-semibold text-primary hover:underline">
            {text('Select all {count}', { count: ticketCount(loaded, more) })}
          </button>
        </p>
      ) : null}
    </div>
  );
}

function BarButton({ icon, label, onClick, menu = false, danger = false, keys }: { icon: string; label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; menu?: boolean; danger?: boolean; keys?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup={menu ? 'menu' : undefined}
      aria-keyshortcuts={keys}
      title={keys ? `${label} (${keys})` : label}
      className={cx('inline-flex h-7 items-center gap-1 rounded-[6px] border border-line bg-surface px-2 text-[12px] font-semibold hover:bg-subtle', danger ? 'text-danger' : 'text-ink')}
    >
      <Icon name={icon} size={13} /> {label}
      {menu ? <Icon name="chevron-down" size={12} className="text-ink-3" /> : null}
    </button>
  );
}
