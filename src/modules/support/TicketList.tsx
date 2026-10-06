import { useRef, useState, type RefObject } from 'react';
import { PRIORITIES, PRIORITY_LABEL, SORTS, SORT_LABEL, STATUSES, statusLabel, type SupportSort, type Ticket } from '@shared/support';
import { text } from '../../core/i18n';
import { conversationStamp } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Select } from '../../components/Select';
import { VirtualList } from '../../components/VirtualList';
import { Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { ChannelIcon, PriorityChip, Reference, SlaChip, StatusDot, requesterLine } from './parts';

/**
 * The inbox's list (D-01, FR-WSP-05): compact rows — the status dot, the channel's icon, the reference in monospace,
 * the subject, the requester and the SLA chip — unread in bold with a blue edge. A page of fifty at a time, the next
 * asked for as the list nears its end (`next_cursor`), drawn only where it shows, so a long view scrolls as a short
 * one does.
 */
export interface ListFilters {
  status: string[];
  priority: string[];
}

export const NO_FILTERS: ListFilters = { status: [], priority: [] };

export function TicketList({
  title,
  count,
  live,
  offline,
  rows,
  selectedId,
  onSelect,
  onOpen,
  loading,
  error,
  onRetry,
  hasMore,
  loadingMore,
  onMore,
  q,
  onQ,
  sort,
  sorts,
  onSort,
  filters,
  onFilters,
  searchRef,
  now,
}: {
  title: string;
  count: number | null;
  live: boolean;
  offline: boolean;
  rows: Ticket[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  q: string;
  onQ: (q: string) => void;
  sort: SupportSort;
  sorts: readonly string[];
  onSort: (s: SupportSort) => void;
  filters: ListFilters;
  onFilters: (f: ListFilters) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  now: number;
}) {
  const [menu, setMenu] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const filtered = filters.status.length + filters.priority.length;
  const toggle = (key: keyof ListFilters, v: string) => {
    const has = filters[key].includes(v);
    onFilters({ ...filters, [key]: has ? filters[key].filter((x) => x !== v) : [...filters[key], v] });
  };
  const sections: MenuSection[] = [
    { id: 'status', label: text('Status'), items: STATUSES.map((s) => ({ id: `s-${s}`, label: text(statusLabel(s)), checked: filters.status.includes(s), onToggle: () => toggle('status', s), onSelect: () => toggle('status', s) })) },
    { id: 'priority', label: text('Priority'), items: PRIORITIES.map((p) => ({ id: `p-${p}`, label: text(PRIORITY_LABEL[p]), checked: filters.priority.includes(p), onToggle: () => toggle('priority', p), onSelect: () => toggle('priority', p) })) },
  ];
  const sortChoices = (SORTS as readonly string[]).filter((s) => sorts.includes(s)) as SupportSort[];

  return (
    <section aria-label={title} className="flex h-full min-w-0 flex-col bg-surface">
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[15px] font-extrabold text-ink">{title}</h2>
          {count !== null ? <span className="shrink-0 text-[12px] text-ink-3">{text('{count} open', { count })}</span> : null}
          {offline ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning-ink">
              <Icon name="cloud-off" size={12} /> {text('Saved copy')}
            </span>
          ) : live ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-success" title={text('Updates arrive as they happen')}>
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> {text('live')}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <label className="relative flex min-w-0 flex-1 items-center">
            <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 text-ink-3" />
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => onQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && q) {
                  e.preventDefault();
                  onQ('');
                }
              }}
              aria-label={text('Search tickets')}
              placeholder={text('Search reference, requester, text…')}
              className="h-8 w-full rounded-[8px] border border-line bg-surface pr-7 pl-8 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-primary"
            />
            <kbd aria-hidden className="pointer-events-none absolute right-2 font-sans text-[11px] text-ink-3">
              /
            </kbd>
          </label>
          <button
            ref={filterButton}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={filtered ? text('Filters ({count} on)', { count: filtered }) : text('Filters')}
            title={text('Filters')}
            onClick={() => setMenu((m) => !m)}
            className={cx('relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border', filtered ? 'border-primary/50 bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}
          >
            <Icon name="filter" size={14} />
            {filtered ? <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">{filtered}</span> : null}
          </button>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          {sortChoices.length > 1 ? (
            <Select<SupportSort> className="h-7 min-w-[150px] text-[12px]" aria-label={text('Sort by')} value={sort} onValueChange={onSort} options={sortChoices.map((s) => ({ value: s, label: text('Sort: {how}', { how: text(SORT_LABEL[s]) }) }))} />
          ) : null}
          {filtered ? (
            <button type="button" onClick={() => onFilters(NO_FILTERS)} className="font-semibold text-primary hover:underline">
              {text('Clear filters')}
            </button>
          ) : null}
        </div>
      </header>
      {menu ? <Menu label={text('Filters')} anchor={filterButton} prefer="bottom" align="end" width={240} sections={sections} onClose={() => setMenu(false)} /> : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {loading ? <Spinner /> : null}
        {error ? (
          <div className="p-3">
            <ErrorNote error={error} onRetry={onRetry} />
          </div>
        ) : null}
        {!loading && !error && !rows.length ? (
          <Empty icon="inbox" title={q || filtered ? text('No tickets match') : text('Nothing in this view')} hint={q || filtered ? text('Try other words, or clear the filters.') : text('Tickets show here as they arrive.')} />
        ) : null}
        {rows.length ? (
          <div role="listbox" aria-label={title} aria-activedescendant={selectedId ? `support-row-${selectedId}` : undefined} className="min-h-0 flex-1">
            <VirtualList
              className="h-full overflow-y-auto scroll-thin"
              items={rows}
              estimate={76}
              getKey={(t) => t.id}
              onEndReached={hasMore && !loadingMore ? onMore : undefined}
              render={(t) => <Row t={t} selected={t.id === selectedId} now={now} onSelect={onSelect} onOpen={onOpen} />}
            />
          </div>
        ) : null}
        {loadingMore ? <Spinner label={text('Loading more…')} className="py-2" /> : null}
      </div>
    </section>
  );
}

function Row({ t, selected, now, onSelect, onOpen }: { t: Ticket; selected: boolean; now: number; onSelect: (id: number) => void; onOpen: (id: number) => void }) {
  const unread = t.unread > 0;
  return (
    <div
      id={`support-row-${t.id}`}
      role="option"
      aria-selected={selected}
      data-ticket={t.id}
      onClick={() => onSelect(t.id)}
      onDoubleClick={() => onOpen(t.id)}
      className={cx(
        'relative flex cursor-default flex-col gap-0.5 border-b border-line py-2 pr-3 pl-4',
        selected ? 'bg-selection' : 'hover:bg-subtle',
        // Unread: bold, with a blue edge (D-01).
        unread && 'before:absolute before:inset-y-1.5 before:left-1 before:w-[3px] before:rounded-full before:bg-[#2563EB]',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <StatusDot status={t.status} />
        <ChannelIcon source={t.source} size={12} />
        <Reference>{t.reference}</Reference>
        <PriorityChip priority={t.priority} quiet className="py-0 text-[10.5px]" />
        <span className="ml-auto shrink-0 text-[11px] text-ink-3">{conversationStamp(t.updated_at)}</span>
      </span>
      <span className={cx('truncate text-[13px]', unread ? 'font-bold text-ink' : 'text-ink')}>{t.subject}</span>
      <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-ink-3">
        <span className="min-w-0 flex-1 truncate">{requesterLine(t.requester)}</span>
        <SlaChip sla={t.sla} now={now} className="py-0 text-[10.5px]" />
      </span>
    </div>
  );
}
