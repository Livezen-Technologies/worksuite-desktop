import { useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { PRIORITIES, PRIORITY_LABEL, SORTS, SORT_LABEL, STATUSES, statusLabel, type SupportSort, type Ticket } from '@shared/support';
import { text } from '../../core/i18n';
import { conversationStamp } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Select } from '../../components/Select';
import { RowLead } from '../../components/RowLead';
import { pickOf, type PickHow } from '../../components/useListSelection';
import { VirtualList } from '../../components/VirtualList';
import { Button, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { ticketCount } from './bulk';
import { ChannelIcon, PriorityChip, Reference, SlaChip, StatusDot, channelIcon, channelLabel, requesterLine, statusDotTitle } from './parts';

/**
 * The inbox's list (D-01, FR-WSP-05): compact rows — the status dot, the channel's icon, the reference in monospace,
 * the subject, the requester and the SLA chip — unread in bold with a blue edge. A page of fifty at a time, the next
 * asked for as the list nears its end (`next_cursor`), drawn only where it shows, so a long view scrolls as a short
 * one does. Filtered by status, priority and channel (`source=`, #298); New ticket (C) beside the filters for
 * whoever may raise one.
 */
export interface ListFilters {
  status: string[];
  priority: string[];
  /** The channels (`source`), #298. */
  source: string[];
}

export const NO_FILTERS: ListFilters = { status: [], priority: [], source: [] };

/** The channels the filter offers, in this order, of those the server knows (`GET meta`'s `sources`). */
export const CHANNEL_FILTERS = ['email', 'chat', 'phone', 'walk_in', 'manual', 'portal', 'form', 'widget_offline', 'whatsapp', 'api'] as const;

/**
 * Picking tickets (worksuite-desktop#333), as Mail's list does: the checkbox in the row's lead column on hover, ⇧ for a
 * range, ⌘ / Ctrl to toggle; once anything is picked every row shows its box and `bar` (the bulk bar) stands in place
 * of the list's title.
 */
export interface ListSelection {
  selected: ReadonlySet<number>;
  selecting: boolean;
  onPick: (id: number, how: PickHow) => void;
  /** The bulk bar and "Select all matching", shown while anything is picked. */
  bar: ReactNode;
}

/**
 * What the count beside the title says (worksuite-desktop#333): the view's own count, in the view's terms — "Resolved ·
 * 1 ticket", never "1 open" over a list of resolved tickets. Searched or filtered, how many are listed ("12+ listed"
 * while more pages wait).
 */
export function countWords(count: number | null, narrowed: boolean, listed: number, more: boolean): string | null {
  if (narrowed) return listed || !more ? text('{count} listed', { count: `${listed}${more ? '+' : ''}` }) : null;
  return count === null ? null : ticketCount(count);
}

/** The row's status dot's tooltip and name: "Status: Resolved — Solved: …" (`statusDotTitle`). */
export const statusDotLabel = statusDotTitle;

/** The channels to filter by: the desk's own, as far as this server has them (all of them when it says nothing). */
export function channelChoices(sources: readonly string[] | null | undefined): string[] {
  return sources?.length ? CHANNEL_FILTERS.filter((c) => sources.includes(c)) : [...CHANNEL_FILTERS];
}

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
  channels = CHANNEL_FILTERS,
  onNew,
  searchRef,
  now,
  selection,
  onRowMenu,
  onShortcuts,
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
  /** The channels the filter offers (`channelChoices`). */
  channels?: readonly string[];
  /** New ticket (C, #298); none for somebody who may not raise one. */
  onNew?: (() => void) | null;
  searchRef: RefObject<HTMLInputElement | null>;
  now: number;
  /** Several tickets picked at once (#333); none for a list that only reads. */
  selection?: ListSelection;
  /** The right-click menu on a row (#333). */
  onRowMenu?: (e: MouseEvent, id: number) => void;
  /** The keyboard shortcuts popover (`?`). */
  onShortcuts?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const filtered = filters.status.length + filters.priority.length + filters.source.length;
  const toggle = (key: keyof ListFilters, v: string) => {
    const has = filters[key].includes(v);
    onFilters({ ...filters, [key]: has ? filters[key].filter((x) => x !== v) : [...filters[key], v] });
  };
  const sections: MenuSection[] = [
    { id: 'status', label: text('Status'), items: STATUSES.map((s) => ({ id: `s-${s}`, label: text(statusLabel(s)), checked: filters.status.includes(s), onToggle: () => toggle('status', s), onSelect: () => toggle('status', s) })) },
    { id: 'priority', label: text('Priority'), items: PRIORITIES.map((p) => ({ id: `p-${p}`, label: text(PRIORITY_LABEL[p]), checked: filters.priority.includes(p), onToggle: () => toggle('priority', p), onSelect: () => toggle('priority', p) })) },
    {
      id: 'source',
      label: text('Channel'),
      items: channels.map((c) => ({ id: `c-${c}`, label: channelLabel(c), icon: channelIcon(c), checked: filters.source.includes(c), onToggle: () => toggle('source', c), onSelect: () => toggle('source', c) })),
    },
  ];
  const sortChoices = (SORTS as readonly string[]).filter((s) => sorts.includes(s)) as SupportSort[];
  const words = countWords(count, !!q.trim() || filtered > 0, rows.length, hasMore);

  return (
    <section aria-label={title} className="flex h-full min-w-0 flex-col bg-surface">
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-3 pt-3 pb-2">
        {selection?.selecting ? selection.bar : null}
        <div className={cx('flex min-w-0 items-center gap-2', selection?.selecting && 'hidden')}>
          <h2 className="truncate text-[15px] font-extrabold text-ink">{title}</h2>
          {words ? (
            <span data-list-count className="shrink-0 text-[12px] text-ink-3">
              · {words}
            </span>
          ) : null}
          {offline ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning-ink">
              <Icon name="cloud-off" size={12} /> {text('Saved copy')}
            </span>
          ) : live ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-success" title={text('Live: this list updates as tickets change, without refreshing')}>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" /> {text('live')}
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
          {onNew ? (
            <Button variant="primary" size="sm" icon="plus" onClick={onNew} aria-keyshortcuts="C" title={text('New ticket (C)')} className="h-8 shrink-0">
              {text('New ticket')}
            </Button>
          ) : null}
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
          {onShortcuts ? (
            <button type="button" onClick={onShortcuts} aria-keyshortcuts="?" title={text('Keyboard shortcuts (?)')} aria-label={text('Keyboard shortcuts')} className="ml-auto flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink">
              <Icon name="keyboard" size={14} />
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
          <div role="listbox" aria-label={title} aria-multiselectable={selection ? true : undefined} aria-activedescendant={selectedId ? `support-row-${selectedId}` : undefined} className="min-h-0 flex-1">
            <VirtualList
              className="h-full overflow-y-auto scroll-thin"
              items={rows}
              estimate={76}
              getKey={(t) => t.id}
              onEndReached={hasMore && !loadingMore ? onMore : undefined}
              render={(t) => <Row t={t} selected={t.id === selectedId} now={now} onSelect={onSelect} onOpen={onOpen} selection={selection} onMenu={onRowMenu} />}
            />
          </div>
        ) : null}
        {loadingMore ? <Spinner label={text('Loading more…')} className="py-2" /> : null}
      </div>
    </section>
  );
}

function Row({
  t,
  selected,
  now,
  onSelect,
  onOpen,
  selection,
  onMenu,
}: {
  t: Ticket;
  selected: boolean;
  now: number;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  selection?: ListSelection;
  onMenu?: (e: MouseEvent, id: number) => void;
}) {
  const unread = t.unread > 0;
  const picked = selection?.selected.has(t.id) ?? false;
  return (
    <div
      id={`support-row-${t.id}`}
      role="option"
      aria-selected={selected || picked}
      data-ticket={t.id}
      data-picked={picked || undefined}
      onClick={(e) => {
        // ⌘ / Ctrl toggles, ⇧ picks the range (#333); a plain click reads the ticket.
        const how = selection ? pickOf(e) : null;
        if (how) {
          e.preventDefault();
          selection!.onPick(t.id, how);
        } else onSelect(t.id);
      }}
      onDoubleClick={() => onOpen(t.id)}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(e, t.id);
            }
          : undefined
      }
      className={cx(
        'group relative flex cursor-default flex-col gap-0.5 border-b border-line py-2 pr-3 pl-1',
        picked ? 'bg-selection/70' : selected ? 'bg-selection' : 'hover:bg-subtle',
        // Unread: bold, with a blue edge (D-01).
        unread && 'before:absolute before:inset-y-1.5 before:left-0.5 before:w-[3px] before:rounded-full before:bg-[#2563EB]',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {selection ? <RowLead checked={picked} selecting={selection.selecting} onPick={(how) => selection.onPick(t.id, how)} label={text('Select {ref}', { ref: t.reference })} /> : <RowLead />}
        <StatusDot status={t.status} />
        <ChannelIcon source={t.source} size={12} />
        <Reference>{t.reference}</Reference>
        <PriorityChip priority={t.priority} quiet className="py-0 text-[10.5px]" />
        {t.snoozed_until && Date.parse(t.snoozed_until) > now ? <Icon name="snooze" size={12} className="text-ink-3" label={text('Snoozed')} /> : null}
        <span className="ml-auto shrink-0 text-[11px] text-ink-3">{conversationStamp(t.updated_at)}</span>
      </span>
      <span className={cx('truncate pl-[34px] text-[13px]', unread ? 'font-bold text-ink' : 'text-ink')}>{t.subject}</span>
      <span className="flex min-w-0 items-center gap-2 pl-[34px] text-[11.5px] text-ink-3">
        <span className="min-w-0 flex-1 truncate">{requesterLine(t.requester)}</span>
        <SlaChip sla={t.sla} now={now} className="py-0 text-[10.5px]" />
      </span>
    </div>
  );
}
