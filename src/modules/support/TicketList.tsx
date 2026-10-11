import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { PRIORITIES, PRIORITY_LABEL, SORTS, SORT_LABEL, STATUSES, statusLabel, type SupportSort, type SupportStatus, type Ticket } from '@shared/support';
import { text } from '../../core/i18n';
import { conversationStamp } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { RowLead } from '../../components/RowLead';
import { pickOf, type PickHow } from '../../components/useListSelection';
import { Select } from '../../components/Select';
import { VirtualList } from '../../components/VirtualList';
import { Button, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { ticketCount } from './bulk';
import { ChannelIcon, PriorityChip, Reference, STATUS_TONE, SlaChip, channelIcon, channelLabel, requesterLine } from './parts';

/**
 * The inbox's list (D-01, FR-WSP-05): compact rows — the status dot, the channel's icon, the reference in monospace,
 * the subject, the requester and the SLA chip — unread in bold with a blue edge. A page of fifty at a time, the next
 * asked for as the list nears its end (`next_cursor`), drawn only where it shows, so a long view scrolls as a short
 * one does. Filtered by status, priority and channel (`source=`, #298); New ticket (C) beside the filters for
 * whoever may raise one.
 *
 * Picking several (#333): each row's checkbox (the lead column, as in Mail), ⌘/Ctrl-click toggles a row and ⇧-click
 * picks the run from the last one picked; the bulk bar (`bulk`) shows over the rows while any is picked. A right-click
 * opens the row's menu — on the rows picked, when it is one of them. The heading says the view and how many tickets it
 * has, the server's count: "Open · 12 tickets", "Resolved · 1 ticket".
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
  countMore = false,
  picked,
  onPick = null,
  onRowMenu = null,
  bulk = null,
}: {
  title: string;
  count: number | null;
  /** The count is only of the tickets loaded and more match ("50+ tickets"): a search or a filter the server does not count. */
  countMore?: boolean;
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
  /** The tickets picked for the bulk bar (#333). */
  picked?: ReadonlySet<number>;
  onPick?: ((id: number, how: PickHow) => void) | null;
  /** A right-click on a row, at the mouse. */
  onRowMenu?: ((t: Ticket, x: number, y: number) => void) | null;
  /** The bulk bar, shown over the rows while any is picked. */
  bulk?: ReactNode;
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

  return (
    <section aria-label={title} className="flex h-full min-w-0 flex-col bg-surface">
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[15px] font-extrabold text-ink">{title}</h2>
          {count !== null ? (
            <span data-list-count className="shrink-0 text-[12px] text-ink-3">
              · {ticketCount(count, countMore)}
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
        </div>
      </header>
      {bulk}
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
              render={(t) => (
                <Row
                  t={t}
                  selected={t.id === selectedId}
                  picked={picked?.has(t.id) ?? false}
                  selecting={(picked?.size ?? 0) > 0}
                  now={now}
                  onSelect={onSelect}
                  onOpen={onOpen}
                  onPick={onPick}
                  onMenu={onRowMenu}
                />
              )}
            />
          </div>
        ) : null}
        {loadingMore ? <Spinner label={text('Loading more…')} className="py-2" /> : null}
      </div>
    </section>
  );
}

/** What a row's status dot means, said under the mouse and to a screen reader: the dot is the status's colour alone. */
const STATUS_MEANING: Record<SupportStatus, string> = {
  new: 'Nobody has answered it yet',
  open: 'Waiting for the desk',
  in_progress: 'Somebody is working on it',
  pending_customer: 'Waiting for the requester',
  pending_internal: 'Waiting for a colleague',
  escalated: 'Escalated for more help',
  resolved: 'Fixed: waiting to be closed, or for the requester to write back',
  closed: 'Finished',
};

/** "Status: Resolved — Fixed: …": the row's status dot's tooltip and name. */
export function statusDotLabel(status: SupportStatus): string {
  const meaning = STATUS_MEANING[status];
  return meaning ? text('Status: {status} — {meaning}', { status: text(statusLabel(status)), meaning: text(meaning) }) : text('Status: {status}', { status: text(statusLabel(status)) });
}

function RowStatusDot({ status }: { status: SupportStatus }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.open;
  const label = statusDotLabel(status);
  return <span role="img" aria-label={label} title={label} data-status-dot={status} className={cx('inline-block h-2 w-2 shrink-0 rounded-full', tone.dot)} />;
}

function Row({
  t,
  selected,
  picked,
  selecting,
  now,
  onSelect,
  onOpen,
  onPick,
  onMenu,
}: {
  t: Ticket;
  selected: boolean;
  picked: boolean;
  selecting: boolean;
  now: number;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onPick: ((id: number, how: PickHow) => void) | null;
  onMenu: ((t: Ticket, x: number, y: number) => void) | null;
}) {
  const unread = t.unread > 0;
  // The lines under the first start where its reference does, past the lead column.
  const indent = onPick ? 'pl-[34px]' : 'pl-[18px]';
  return (
    <div
      id={`support-row-${t.id}`}
      role="option"
      aria-selected={selected}
      data-ticket={t.id}
      data-picked={picked || undefined}
      onClick={(e) => {
        // ⌘/Ctrl-click picks the row, ⇧-click the run to it (#333); a plain click reads it.
        const how = onPick ? pickOf(e) : null;
        if (how && onPick) {
          e.preventDefault();
          onPick(t.id, how);
          return;
        }
        onSelect(t.id);
      }}
      onDoubleClick={() => onOpen(t.id)}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(t, e.clientX, e.clientY);
            }
          : undefined
      }
      className={cx(
        'group relative flex cursor-default flex-col gap-0.5 border-b border-line py-2 pr-3 pl-1.5',
        selected ? 'bg-selection' : picked ? 'bg-selection/50' : 'hover:bg-subtle',
        // Unread: bold, with a blue edge (D-01).
        unread && 'before:absolute before:inset-y-1.5 before:left-1 before:w-[3px] before:rounded-full before:bg-[#2563EB]',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {onPick ? <RowLead checked={picked} selecting={selecting} onPick={(how) => onPick(t.id, how)} label={text('Select {ref}', { ref: t.reference })} className="-mr-1" /> : <span className="w-2 shrink-0" />}
        <RowStatusDot status={t.status} />
        <ChannelIcon source={t.source} size={12} />
        <Reference>{t.reference}</Reference>
        <PriorityChip priority={t.priority} quiet className="py-0 text-[10.5px]" />
        <span className="ml-auto shrink-0 text-[11px] text-ink-3">{conversationStamp(t.updated_at)}</span>
      </span>
      <span className={cx('truncate text-[13px]', indent, unread ? 'font-bold text-ink' : 'text-ink')}>{t.subject}</span>
      <span className={cx('flex min-w-0 items-center gap-2 text-[11.5px] text-ink-3', indent)}>
        <span className="min-w-0 flex-1 truncate">{requesterLine(t.requester)}</span>
        <SlaChip sla={t.sla} now={now} className="py-0 text-[10.5px]" />
      </span>
    </div>
  );
}
