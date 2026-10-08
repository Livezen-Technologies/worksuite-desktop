import { ResizeDivider, type ResizableWidth } from '../../components/ResizeDivider';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { text } from '../../core/i18n';
import { bytes } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Checkbox } from '../../components/Checkbox';
import { RowLead } from '../../components/RowLead';
import { pickOf, type PickHow, type SelectState } from '../../components/useListSelection';
import { Avatar, Empty, ErrorNote, cx } from '../../components/ui';
import { VirtualList } from '../../components/VirtualList';
import type { ListRefresh } from '../../components/PullToRefresh';
import { CHIPS, rowStamp, type ChipId, type QueuedAction, type RowGroup } from './model';
import { AccountTag, CategoryChip } from './parts';
import { accountTags, tagShows, type AccountTagInfo } from './accountTags';
import { MAIL_DRAG } from './TodoPane';
import { rowFormat } from './ReadingSettings';
import type { MailPrefs, Mailbox, MessageRow } from './types';
import { SortMenu, sortLabel } from './SortMenu';
import type { EmptyReason } from './listLoading';

/**
 * The message list (UI-07): its title and controls, the instant search over
 * mail on this computer, the quick-filter chips, and the rows in date bands
 * (or by sender, folder…), in one of four densities. Offline, a banner says
 * what is being shown, and rows with an action waiting say so.
 */

export interface ListRow {
  row: MessageRow;
  key: string;
  queued: QueuedAction | null;
}

export interface MessageListProps {
  /** Its width beside the reading pane, dragged by its edge (left out: a fixed 420px). */
  resize?: ResizableWidth;
  title: string;
  /** Right of the title: "26 unread · 4 mailboxes", or the mailbox's kind. */
  aside?: string | null;
  groups: Array<RowGroup & { items: ListRow[] }>;
  total: number;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedKey: string | null;
  onOpen: (r: ListRow) => void;
  onStar: (r: ListRow) => void;
  prefs: MailPrefs;
  onPrefs: (patch: Partial<MailPrefs> & { applyToAll?: boolean }) => void;
  /** Group into conversations here: per folder, and only where the server can thread. */
  conversations: boolean | null;
  onConversations: (on: boolean) => void;
  chips: ChipId[];
  onChips: (c: ChipId[]) => void;
  search: string;
  onSearch: (q: string) => void;
  onSearchAll: (q: string) => void;
  unified: boolean;
  /** The mailbox shown when it is one, for its tag where it shows in every view (#227). */
  mailboxId?: number | null;
  boxes: Mailbox[];
  offline: boolean;
  offlineDays: number;
  refreshing: boolean;
  onRefresh: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** A line under the chips when a mailbox could not be asked (unified) or a filter could not run. */
  notice?: string | null;
  /** A shared team mailbox's queue tabs, above the chips. */
  team?: ReactNode;
  fill?: boolean;
  /** Focused Inbox (DMO-INB-01/03): the two tabs, and the line about new Other mail. */
  focusTabs?: {
    value: 'focused' | 'other';
    onChange: (v: 'focused' | 'other') => void;
    banner: string | null;
    unread: { focused: number; other: number };
    /** Focused holds almost nothing while Other holds more (#208): offer to turn it off, or to teach it. */
    hint?: { onTurnOff: () => void; onTeach: () => void } | null;
  } | null;
  /** Right-click on a row (DMO-SHL-08). */
  onRowMenu?: (r: ListRow, x: number, y: number) => void;
  /** Rows selected besides the open one (DMO-INB-15). */
  selection?: ReadonlySet<string>;
  onSelect?: (r: ListRow, how: PickHow) => void;
  /** The Select-all box over the list (worksuite-desktop#290): none, some or all of the rows listed are picked. */
  selectAll?: { state: SelectState; onToggle: () => void };
  /** The row's hover buttons, in place of its time (worksuite-desktop#161). */
  rowActions?: (r: ListRow) => RowAction[];
  /** Over the rows while some are selected: "3 selected · Archive · Delete · Move · Mark read · ⋯ · Clear". */
  toolbar?: ReactNode;
  /** The View menu's link to Settings › Mail › Appearance & reading. */
  onViewSettings?: () => void;
  /** Why the list is empty, in words (#208). */
  empty?: EmptyReason;
  /** Turns every quick filter off: shown beside the chips while one is on. */
  onClearFilters?: () => void;
  /** Pull to check for new mail, the "↑ 3 new emails" pill and "Checked 2 min ago" (worksuite-desktop#236). */
  refresh?: ListRefresh;
}

export interface RowAction {
  id: string;
  label: string;
  icon: string;
  pressed?: boolean;
  /** The button pressed: a menu (Snooze) opens under it. */
  onSelect: (button: HTMLElement) => void;
}

export { sortLabel };

/**
 * The View menu (worksuite-desktop#208): the choices people change often, compact. Density as a list,
 * the reading pane as one segmented row (Right · Below · Hidden), conversations for this folder, and a
 * link to Settings › Mail › Appearance & reading for the rest (the action bar, text size, Focused Inbox).
 * No item has an icon, so no section has some and not others. It is anchored to its own button — no
 * `avoid` area: the header under the button is not the toolbar it sits in (that pushed it over the list).
 */
export function viewMenuSections(p: Pick<MessageListProps, 'prefs' | 'onPrefs' | 'conversations' | 'onConversations' | 'onViewSettings'>): MenuSection[] {
  const view = p.prefs.view ?? 'compact';
  const pane = p.prefs.pane ?? 'right';
  return [
    {
      id: 'density',
      label: text('Density'),
      items: [
        { id: 'classic', label: text('Classic'), radio: true, checked: view === 'classic', onSelect: () => p.onPrefs({ view: 'classic' }) },
        { id: 'compact', label: text('Compact'), radio: true, checked: view === 'compact', onSelect: () => p.onPrefs({ view: 'compact' }) },
        { id: 'super', label: text('Super compact'), radio: true, checked: view === 'super', onSelect: () => p.onPrefs({ view: 'super' }) },
        { id: 'table', label: text('Full list'), radio: true, checked: view === 'table', onSelect: () => p.onPrefs({ view: 'table' }) },
      ],
    },
    {
      id: 'pane',
      label: text('Reading pane'),
      segmented: true,
      items: [
        { id: 'right', label: text('Right'), radio: true, checked: pane === 'right', onSelect: () => p.onPrefs({ pane: 'right' }) },
        { id: 'bottom', label: text('Below'), radio: true, checked: pane === 'bottom', onSelect: () => p.onPrefs({ pane: 'bottom' }) },
        { id: 'hidden', label: text('Hidden'), radio: true, checked: pane === 'hidden', onSelect: () => p.onPrefs({ pane: 'hidden' }) },
      ],
    },
    {
      id: 'conversations',
      items: [
        {
          id: 'threads',
          label: text('Group into conversations'),
          checked: !!p.conversations,
          disabled: p.conversations === null,
          reason: text('A combined list or a filtered one is not grouped into conversations.'),
          onSelect: () => p.onConversations(!p.conversations),
        },
        { id: 'all-folders', label: text('Apply this view to all folders'), onSelect: () => p.onPrefs({ applyToAll: true }) },
      ],
    },
    ...(p.onViewSettings
      ? [{ id: 'more', items: [{ id: 'view-settings', label: text('More view settings…'), description: text('Action bar, text size, Focused Inbox'), onSelect: p.onViewSettings }] }]
      : []),
  ];
}

export function MessageList(p: MessageListProps) {
  const view = p.prefs.view ?? 'compact';
  // Every account's tag at once, so no two share a label (#227).
  const tagPrefs = p.prefs.accountTags;
  const tags = useMemo(() => accountTags(p.boxes, { accountTags: tagPrefs }), [p.boxes, tagPrefs]);
  const flat = p.groups.flatMap((g) => g.items);
  const [menu, setMenu] = useState<'density' | 'sort' | null>(null);
  const densityBtn = useRef<HTMLButtonElement>(null);
  const sortBtn = useRef<HTMLButtonElement>(null);
  const sortChip = useRef<HTMLButtonElement>(null);
  // Sort & Group opens under whichever button opened it: the toolbar's or the "Date · Newest" chip.
  const [sortAt, setSortAt] = useState<'top' | 'chip'>('top');
  const toggleSort = (at: 'top' | 'chip') => {
    if (menu === 'sort' && sortAt === at) return setMenu(null);
    setSortAt(at);
    setMenu('sort');
  };
  const items: Array<{ kind: 'head'; g: RowGroup & { items: ListRow[] } } | { kind: 'row'; r: ListRow }> = [];
  for (const g of p.groups) {
    if (g.label && view !== 'table') items.push({ kind: 'head', g });
    for (const r of g.items) items.push({ kind: 'row', r });
  }

  const densitySections = viewMenuSections(p);
  return (
    <section aria-label="Messages" className={cx('relative flex min-h-0 flex-col bg-surface', p.fill ? 'min-w-0 flex-1' : cx('shrink-0 border-r border-line', !p.resize && 'w-[420px]'))} style={!p.fill && p.resize ? { width: p.resize.width } : undefined}>
      {/* Beside the reading pane, its width is the person's: drag the edge (#304). */}
      {!p.fill && p.resize ? <ResizeDivider state={p.resize} label={text('Resize the message list')} /> : null}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-[19px] font-bold text-ink selectable" title={p.aside ? `${p.title} · ${p.aside}` : p.title}>
            {p.title}
          </h1>
          {p.aside && p.fill ? <span className="shrink-0 truncate text-[12.5px] text-ink-3">{p.aside}</span> : null}
          <button type="button" onClick={p.onRefresh} aria-label="Refresh" title="Refresh" className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
            <Icon name="refresh" size={16} className={p.refreshing ? 'animate-spin' : undefined} />
          </button>
          <button ref={densityBtn} type="button" aria-haspopup="menu" aria-expanded={menu === 'density'} onClick={() => setMenu(menu === 'density' ? null : 'density')} aria-label="Layout and density" title="Layout and density" className={cx('inline-flex h-8 items-center gap-0.5 rounded-[8px] px-1.5 text-ink-2 hover:bg-subtle', menu === 'density' && 'bg-subtle')}>
            <Icon name="grid" size={16} />
            <Icon name="chevron-down" size={12} />
          </button>
          <button ref={sortBtn} type="button" aria-haspopup="menu" aria-expanded={menu === 'sort' && sortAt === 'top'} onClick={() => toggleSort('top')} aria-label={text('Sort and group')} title={text('Sort and group')} className={cx('inline-flex h-8 items-center gap-0.5 rounded-[8px] px-1.5 text-ink-2 hover:bg-subtle', menu === 'sort' && sortAt === 'top' && 'bg-subtle')}>
            <Icon name="transfers" size={16} />
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
        {p.refresh ? <div className="-mt-0.5 flex min-w-0">{p.refresh.checked}</div> : null}
        {p.offline ? (
          <div role="status" className="mt-2 flex items-start gap-2.5 rounded-[10px] border border-[var(--ws-note-line)] bg-[var(--ws-note-bg)] px-3 py-2 text-[12.5px] leading-snug text-ink">
            <Icon name="wifi-off" size={16} className="mt-0.5 shrink-0 text-warning" />
            <span>{p.offlineDays > 0 ? text("You're offline. Showing the last {n} days saved on this computer. Actions you take are queued and sent when you reconnect.", { n: p.offlineDays }) : text("You're offline. Showing what is saved on this computer. Actions you take are queued and sent when you reconnect.")}</span>
          </div>
        ) : (
          <form
            role="search"
            className="mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (p.search.trim().length >= 2) p.onSearchAll(p.search.trim());
            }}
          >
            <label className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] focus-within:border-primary">
              <Icon name="search" size={15} className="text-ink-3" />
              <input
                data-mail-search
                value={p.search}
                onChange={(e) => p.onSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && p.search) {
                    e.preventDefault();
                    p.onSearch('');
                  }
                }}
                placeholder="Search all mailboxes — instant, from this computer"
                aria-label="Search mail"
                className="bare-focus min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
              />
              {p.search ? (
                <button type="button" onClick={() => p.onSearch('')} aria-label="Clear search" className="text-ink-3 hover:text-ink">
                  <Icon name="x" size={14} />
                </button>
              ) : null}
            </label>
          </form>
        )}
        {p.team}
        {p.focusTabs ? (
          <div className="mt-2">
            <div role="tablist" aria-label={text('Focused Inbox')} className="flex gap-4 border-b border-line">
              {(['focused', 'other'] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={p.focusTabs!.value === t} onClick={() => p.focusTabs!.onChange(t)} className={cx('-mb-px flex h-8 items-center gap-1.5 border-b-2 text-[13.5px] font-semibold', p.focusTabs!.value === t ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
                  {t === 'focused' ? text('Focused') : text('Other')}
                  {t === 'focused' && p.focusTabs!.unread.focused ? <span className="text-[12px] text-ink-3">{p.focusTabs!.unread.focused}</span> : null}
                </button>
              ))}
            </div>
            {p.focusTabs.value === 'focused' && p.focusTabs.banner ? (
              <button type="button" onClick={() => p.focusTabs!.onChange('other')} className="mt-1.5 flex w-full items-center gap-1.5 rounded-[8px] bg-subtle px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:text-ink">
                <Icon name="inbox" size={13} />
                <span className="min-w-0 flex-1 truncate">{p.focusTabs.banner}</span>
              </button>
            ) : null}
            {p.focusTabs.value === 'focused' && p.focusTabs.hint ? (
              <p role="note" data-focused-hint className="mt-1.5 flex flex-wrap items-center gap-x-1.5 rounded-[8px] border border-line px-2.5 py-1.5 text-[12.5px] text-ink-2">
                <span>{text('Most new mail is in Other.')}</span>
                <button type="button" onClick={p.focusTabs.hint.onTurnOff} className="font-semibold text-primary hover:underline">
                  {text('Turn off Focused Inbox')}
                </button>
                <span aria-hidden>·</span>
                <button type="button" onClick={p.focusTabs.hint.onTeach} title={text('Open Other and move what matters to Focused: it learns from each move.')} className="font-semibold text-primary hover:underline">
                  {text('Teach Focused')}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="mt-2 flex items-center">
          {/* Select all (#290): in the rows' lead column, so it lines up with their checkboxes. */}
          {p.selectAll ? (
            <span className="-mr-1.5 -ml-1 flex w-7 shrink-0 items-center justify-center">
              <Checkbox aria-label={text('Select all')} title={text('Select all')} checked={p.selectAll.state === 'all'} indeterminate={p.selectAll.state === 'some'} disabled={flat.length === 0} onChange={p.selectAll.onToggle} />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-1.5" role="group" aria-label="Quick filters">
            {CHIPS.map((c) => {
              const on = p.chips.includes(c.id);
              return (
                <button key={c.id} type="button" aria-pressed={on} data-chip={c.id} onClick={() => p.onChips(on ? p.chips.filter((x) => x !== c.id) : [...p.chips, c.id])} className={cx('inline-flex h-[26px] shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12.5px] font-semibold', on ? 'border-primary bg-primary text-white' : 'border-line text-ink hover:bg-subtle')}>
                  {on ? <Icon name="check" size={12} /> : null}
                  {c.label}
                </button>
              );
            })}
            {p.onClearFilters ? (
              <button type="button" onClick={p.onClearFilters} className="shrink-0 px-1 text-[12.5px] font-semibold text-primary hover:underline">
                {text('Clear filters')}
              </button>
            ) : null}
            <span className="flex-1" />
            <button ref={sortChip} type="button" aria-haspopup="menu" aria-expanded={menu === 'sort' && sortAt === 'chip'} onClick={() => toggleSort('chip')} title={text('Sort and group')} className={cx('inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1 text-[12.5px] text-ink-3 hover:bg-subtle hover:text-ink', menu === 'sort' && sortAt === 'chip' && 'bg-subtle text-ink')}>
              <Icon name="transfers" size={13} />
              <span className="truncate">{sortLabel(p.prefs)}</span>
            </button>
          </div>
        </div>
        {p.notice ? <p className="mt-1.5 text-[12px] text-ink-3">{p.notice}</p> : null}
      </div>
      {p.toolbar}
      {view === 'table' && flat.length ? <TableHead unified={p.unified} /> : null}
      <div className="relative flex min-h-0 flex-1 flex-col border-t border-line">
        {/* Pull to check for new mail, and "↑ 3 new emails" while scrolled down (#236). */}
        {p.refresh?.indicator}
        {p.refresh?.pill}
        <div className="@container flex min-h-0 flex-1 flex-col" role="listbox" tabIndex={0} aria-label="Messages" aria-activedescendant={p.selectedKey && flat.some((r) => r.key === p.selectedKey) ? `mail-row-${p.selectedKey}` : undefined}>
          {items.length > 150 ? (
            <VirtualList className="min-h-0 flex-1 overflow-y-auto scroll-thin" scrollRef={p.refresh?.attach} items={items} estimate={view === 'classic' ? 78 : view === 'compact' ? 52 : 36} getKey={(it) => (it.kind === 'head' ? `h:${it.g.key}` : it.r.key)} onEndReached={() => p.hasMore && !p.loadingMore && p.onMore()} render={(it) => (it.kind === 'head' ? <GroupHead g={it.g} /> : <Row r={it.r} {...p} tags={tags} view={view} />)} />
          ) : (
            <div
              ref={p.refresh?.attach}
              className="min-h-0 flex-1 overflow-y-auto scroll-thin"
              data-mail-scroll
              onScroll={(e) => {
                // The next 100 as the end comes into view, not on a click (#208).
                const el = e.currentTarget;
                if (p.hasMore && !p.loadingMore && items.length > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_END) p.onMore();
              }}
            >
              {p.loading ? (
                <Placeholders view={view} label={text('Loading the latest messages…')} />
              ) : p.error && flat.length === 0 ? (
                <div className="p-4">
                  <ErrorNote error={p.error} onRetry={p.onRetry} />
                </div>
              ) : flat.length === 0 && p.loadingMore ? (
                <Placeholders view={view} label={text('Loading more…')} />
              ) : flat.length === 0 ? (
                <EmptyList reason={p.empty ?? { kind: p.search ? 'search' : 'caught-up', title: p.search ? text('No messages match') : text('All caught up'), hint: p.search ? text('Press Enter to search every mailbox, older mail too.') : null }} onClearFilters={p.onClearFilters} />
              ) : null}
              {items.map((it) => (it.kind === 'head' ? <GroupHead key={`h:${it.g.key}`} g={it.g} /> : <Row key={it.r.key} r={it.r} {...p} tags={tags} view={view} />))}
              {items.length > 0 && p.loadingMore ? <Placeholders view={view} label={text('Loading more…')} rows={3} /> : null}
              {items.length > 0 && p.hasMore && !p.loadingMore ? (
                <div className="p-3 text-center">
                  <button type="button" onClick={p.onMore} className="text-[12.5px] font-semibold text-primary hover:underline">
                    {text('Show more')}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
      {menu === 'density' ? <Menu sections={densitySections} label={text('Layout and density')} anchor={densityBtn} prefer="bottom" align="end" width={264} onClose={() => setMenu(null)} /> : null}
      {menu === 'sort' ? <SortMenu anchor={sortAt === 'chip' ? sortChip : sortBtn} prefs={p.prefs} conversations={p.conversations} onPrefs={p.onPrefs} onConversations={p.onConversations} onClose={() => setMenu(null)} /> : null}
    </section>
  );
}

/** How close to the end (px) scrolling asks for the next page. */
const NEAR_END = 600;

/** Rows in the shape of the list while its messages load (#208): never a blank pane. */
function Placeholders({ view, label, rows = 8 }: { view: NonNullable<MailPrefs['view']>; label: string; rows?: number }) {
  const h = view === 'classic' ? 'h-[72px]' : view === 'compact' ? 'h-[52px]' : 'h-[34px]';
  return (
    <div role="status" aria-label={label} data-placeholder-rows>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden data-placeholder-row className={cx('flex flex-col justify-center gap-1.5 border-b border-line px-4', h)}>
          <span className="h-2.5 w-2/5 animate-pulse rounded bg-subtle motion-reduce:animate-none" />
          {view === 'super' || view === 'table' ? null : <span className="h-2.5 w-4/5 animate-pulse rounded bg-subtle motion-reduce:animate-none" />}
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** An empty list says why (#208): headers still arriving, filters, a search, or all caught up. */
function EmptyList({ reason, onClearFilters }: { reason: EmptyReason; onClearFilters?: () => void }) {
  return (
    <div data-empty-reason={reason.kind}>
      <Empty icon={reason.kind === 'syncing' ? 'refresh' : reason.kind === 'caught-up' ? 'check' : 'inbox'} title={reason.title} hint={reason.hint ?? undefined} />
      {reason.kind === 'filtered' && onClearFilters ? (
        <div className="-mt-2 text-center">
          <button type="button" onClick={onClearFilters} className="text-[13px] font-semibold text-primary hover:underline">
            {text('Clear filters')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GroupHead({ g }: { g: RowGroup & { items: ListRow[] } }) {
  return (
    <div role="presentation" data-group-head={g.key} className="flex h-7 items-center justify-between border-b border-line bg-subtle px-4 text-[11.5px] font-bold uppercase tracking-wide text-ink-2">
      <span className="truncate">{g.label}</span>
      <span className="tabular">{g.items.length}</span>
    </div>
  );
}

/** The Full list's columns, after the lead: star, from, subject, (mailbox,) size, received. */
const tableColumns = (unified: boolean) => (unified ? '20px 220px 1fr 170px 64px 70px' : '20px 220px 1fr 64px 70px');

function TableHead({ unified }: { unified: boolean }) {
  return (
    <div role="presentation" className="flex h-7 items-center border-t border-line pr-4 pl-3 text-[11.5px] font-semibold text-ink-3">
      <span className="w-7 shrink-0" />
      <span className="grid min-w-0 flex-1 items-center gap-3" style={{ gridTemplateColumns: tableColumns(unified) }}>
        <span />
        <span>From</span>
        <span>Subject</span>
        {unified ? <span>Mailbox</span> : null}
        <span className="text-right">Size</span>
        <span className="text-right">Received</span>
      </span>
    </div>
  );
}

const QUEUED_LABEL: Record<QueuedAction, string> = {
  archive: 'Archive queued',
  trash: 'Delete queued',
  spam: 'Spam queued',
  read: 'Read queued',
  unread: 'Unread queued',
  star: 'Star queued',
  unstar: 'Unstar queued',
  move: 'Move queued',
  send: 'Send queued',
};

/** Pin, flag, snooze, categories and the message's Support ticket on a row: icons with names, never colour alone (DMO-ACC-03). */
function StateMarks({ m }: { m: MessageRow }) {
  const due = m.flag?.due_at ? text('Due {when}', { when: rowStamp(m.flag.due_at) }) : text('Flagged');
  return (
    <>
      {m.support_ticket ? (
        <span data-ticket-marker title={text('Ticket {ref}', { ref: m.support_ticket.reference })} className="flex shrink-0 items-center gap-0.5 text-ink-3">
          <Icon name="life-buoy" size={13} label={text('Ticket {ref}', { ref: m.support_ticket.reference })} />
          <span aria-hidden className="font-mono text-[11px]">{m.support_ticket.reference}</span>
        </span>
      ) : null}
      {m.pinned ? <Icon name="pin" size={13} className="shrink-0 text-primary" label={text('Pinned')} /> : null}
      {m.snoozed_until ? <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-warning" title={text('Snoozed until {when}', { when: rowStamp(m.snoozed_until) })}><Icon name="snooze" size={13} />{rowStamp(m.snoozed_until)}</span> : null}
      {m.flag ? (m.flag.completed_at ? <Icon name="check" size={13} className="shrink-0 text-success" label={text('Flag complete')} /> : <Icon name="flag" size={13} className="shrink-0 fill-current text-danger" label={due} />) : null}
      {(m.categories ?? []).slice(0, 2).map((c) => (
        <CategoryChip key={c.id} name={c.name} colour={c.colour} />
      ))}
      {(m.categories?.length ?? 0) > 2 ? <span className="shrink-0 text-[11px] text-ink-3" title={(m.categories ?? []).map((c) => c.name).join(', ')}>+{(m.categories?.length ?? 0) - 2}</span> : null}
    </>
  );
}

function Row({ r, view, selectedKey, onOpen, onStar, unified, mailboxId, prefs, onRowMenu, selection, onSelect, rowActions, tags, refresh }: MessageListProps & { r: ListRow; view: NonNullable<MailPrefs['view']>; tags: Map<number, AccountTagInfo> }) {
  const m = r.row;
  // Settings › Reading › Show message previews in the list (D10).
  const preview = prefs.previews === false ? '' : m.preview;
  const picked = !!selection?.has(r.key);
  const selected = r.key === selectedKey || picked;
  const unread = !m.is_read;
  // Conditional formatting (DMO-INB-18): the row's colour and weight, by the first rule that takes it.
  const fmt = rowFormat(m, prefs.formatRules);
  const ink = fmt?.cls ?? 'text-ink';
  const strong = unread || !!fmt?.bold;
  // Which account it came to (#227): its tag in the combined views, and in every view for an account set so.
  const tag = tags.get(m.mailbox?.id ?? (unified ? -1 : (mailboxId ?? -1)));
  const badge = tag && tagShows(tag, prefs.accountTag, unified) ? <AccountTag tag={tag} mode={prefs.accountTag} /> : null;
  const queued = r.queued ? <span className="shrink-0 text-[11.5px] font-semibold text-warning">{text(QUEUED_LABEL[r.queued])}</span> : null;
  const sender = m.from_name || m.from_email || text('(unknown sender)');
  const subject = m.subject || text('(no subject)');
  const stamp = rowStamp(m.created_at);
  const team = m.team ? <TeamTag t={m.team} /> : null;
  const actions = rowActions?.(r) ?? [];
  // The time makes room for the hover buttons.
  const stampCls = actions.length ? 'group-hover:invisible group-focus-within:invisible' : undefined;
  const middle = view === 'super' || view === 'table';
  // The lead column (#290): the unread dot, or the checkbox in its place under the mouse and on every row while any
  // is picked; centred on the sender's line (classic rows are taller, so it sits at their top).
  const lead = <RowLead unread={unread} checked={picked} selecting={(selection?.size ?? 0) > 0} onPick={onSelect ? (how) => onSelect(r, how) : undefined} label={text('Select “{subject}”', { subject })} className={view === 'classic' ? 'self-start' : undefined} />;
  const extras = actions.length ? (
    <span role="group" aria-label={text('Actions for “{subject}”', { subject })} className={cx('absolute right-2 z-[1] hidden items-center gap-0.5 rounded-[8px] border border-line bg-surface px-0.5 shadow-sm group-hover:flex group-focus-within:flex', middle ? 'top-1/2 -translate-y-1/2' : 'top-1')}>
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          aria-label={a.label}
          title={a.label}
          aria-pressed={a.pressed}
          data-row-action={a.id}
          onClick={(e) => {
            e.stopPropagation();
            a.onSelect(e.currentTarget);
          }}
          className={cx('inline-flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-subtle', a.pressed ? 'text-warning' : 'text-ink-2 hover:text-ink')}
        >
          <Icon name={a.icon} size={15} className={a.pressed ? 'fill-current' : undefined} />
        </button>
      ))}
    </span>
  ) : null;
  const common = {
    id: `mail-row-${r.key}`,
    role: 'option',
    'aria-selected': selected,
    'data-mail-row': r.key,
    // New mail is marked and slides in (#236); the key keeps the place when mail comes above the view.
    ...(refresh?.rowProps(r.key) ?? {}),
    // Dragged onto My Day: an event or a task from the message (DMO-CAL-07, DMO-TSK-04).
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(MAIL_DRAG, r.key);
      e.dataTransfer.effectAllowed = 'copy';
    },
    onClick: (e: React.MouseEvent) => {
      // Ctrl/⌘-click adds to the selection, Shift-click selects a range (DMO-INB-15); a plain click opens.
      const how = onSelect ? pickOf(e) : null;
      if (how) return onSelect!(r, how);
      onOpen(r);
    },
    onContextMenu: onRowMenu
      ? (e: React.MouseEvent) => {
          e.preventDefault();
          onRowMenu(r, e.clientX, e.clientY);
        }
      : undefined,
    // An even 12px on the left, so the lead column never meets the list's edge (#290).
    className: cx('group relative w-full cursor-default border-b border-line pr-4 pl-3 text-left', selected ? 'bg-selection' : 'hover:bg-subtle', r.queued && r.queued !== 'read' && r.queued !== 'star' && r.queued !== 'unstar' && 'opacity-60', refresh?.freshClass(r.key)),
  } as const;
  const count = m.count && m.count > 1 ? <span className="shrink-0 text-[12px] font-semibold text-ink-3">{m.count}</span> : null;
  const label = text(unread ? '{sender}, {subject}, unread, {time}' : '{sender}, {subject}, {time}', { sender, subject, time: stamp });

  if (view === 'table') {
    return (
      <div {...common} aria-label={label} className={cx(common.className, 'flex h-[36px] items-center text-[13px]')}>
        {extras}
        {lead}
        <span className="grid min-w-0 flex-1 items-center gap-3" style={{ gridTemplateColumns: tableColumns(unified) }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStar(r);
            }}
            aria-label={m.is_starred ? 'Unstar' : 'Star'}
            aria-pressed={m.is_starred}
            className={m.is_starred ? 'text-warning' : 'text-ink-3 hover:text-ink'}
          >
            <Icon name="star" size={15} className={m.is_starred ? 'fill-current' : undefined} />
          </button>
          <span className={cx('truncate', strong ? cx('font-bold', ink) : ink)}>{sender}</span>
          <span className="flex min-w-0 items-center gap-2 truncate">
            {queued}
            <StateMarks m={m} />
            <span className={cx('truncate', strong ? cx('font-bold', ink) : cx('font-semibold', ink))}>{subject}</span>
            {preview ? <span className="truncate text-ink-3">— {preview}</span> : null}
            {m.has_attachment ? <Icon name="paperclip" size={13} className="shrink-0 text-ink-3" label="Has attachments" /> : null}
          </span>
          {unified ? (m.mailbox ? (
            <span className="flex min-w-0 items-center gap-1.5" title={m.mailbox.email}>
              {badge}
              <span className="truncate text-[12px] text-ink-3">{m.mailbox.email}</span>
            </span>
          ) : <span />) : null}
          <span className="text-right font-mono text-[12px] text-ink-2 tabular">{m.size ? bytes(m.size) : ''}</span>
          <span className={cx('text-right text-[12px] text-ink-3', stampCls)}>{stamp}</span>
        </span>
      </div>
    );
  }
  if (view === 'super') {
    return (
      <div {...common} aria-label={label} className={cx(common.className, 'flex h-[34px] items-center text-[13px]')}>
        {extras}
        {lead}
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className={cx('w-[34%] shrink-0 truncate', strong ? cx('font-bold', ink) : ink)}>{sender}</span>
          {count}
          <span className="min-w-0 flex-1 truncate">
            <span className={cx(strong ? cx('font-bold', ink) : cx('font-semibold', ink))}>{subject}</span>
            {preview ? <span className="text-ink-3"> — {preview}</span> : null}
          </span>
          {m.has_attachment ? <Icon name="paperclip" size={13} className="shrink-0 text-ink-3" label="Has attachments" /> : null}
          <StateMarks m={m} />
          {queued}
          {badge}
          <span className={cx('shrink-0 text-[12px] text-ink-3', stampCls)}>{stamp}</span>
        </span>
      </div>
    );
  }
  if (view === 'classic') {
    return (
      <div {...common} aria-label={label} className={cx(common.className, 'flex py-2.5')}>
        {extras}
        {lead}
        <span className="flex min-w-0 flex-1 gap-3">
          <Avatar name={sender} size={36} className="mt-0.5" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <span className={cx('min-w-0 flex-1 truncate text-[13.5px]', strong ? cx('font-bold', ink) : cx('font-semibold', ink))}>{sender}</span>
              {count}
              {queued}
              {badge}
              <span className={cx('shrink-0 text-[12px] text-ink-3', stampCls)}>{stamp}</span>
            </span>
            <span className={cx('truncate text-[13.5px]', strong ? cx('font-bold', ink) : ink)}>{subject}</span>
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{preview}</span>
              {m.has_attachment ? <Icon name="paperclip" size={13} className="shrink-0 text-ink-3" label="Has attachments" /> : null}
              {m.is_starred ? <Icon name="star" size={13} className="shrink-0 fill-current text-warning" label="Starred" /> : null}
              <StateMarks m={m} />
              {team}
            </span>
          </span>
        </span>
      </div>
    );
  }
  return (
    <div {...common} aria-label={label} className={cx(common.className, 'flex flex-col gap-0.5 py-2')}>
      {extras}
      <span className="flex items-center">
        {lead}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cx('min-w-0 flex-1 truncate text-[13.5px]', strong ? cx('font-bold', ink) : ink)}>{sender}</span>
          {count}
          {m.has_attachment ? <Icon name="paperclip" size={13} className="shrink-0 text-ink-3" label="Has attachments" /> : null}
          {m.is_starred ? <Icon name="star" size={13} className="shrink-0 fill-current text-warning" label="Starred" /> : null}
          {queued}
          {badge}
          <span className={cx('shrink-0 text-[12px] text-ink-3', stampCls)}>{stamp}</span>
        </span>
      </span>
      <span className="flex items-center gap-2 pl-7">
        <span className="min-w-0 flex-1 truncate text-[13px]">
          <span className={cx(strong ? cx('font-bold', ink) : cx('font-semibold', ink))}>{subject}</span>
          {preview ? <span className="text-ink-3"> — {preview}</span> : null}
        </span>
        <StateMarks m={m} />
        {team}
      </span>
    </div>
  );
}

function TeamTag({ t }: { t: NonNullable<MessageRow['team']> }) {
  const label = t.status === 'closed' ? text('Done') : t.status === 'answered' ? text('Pending') : t.assignee_id ? text('Open') : text('New');
  const tone = t.status === 'closed' ? 'bg-success-bg text-success' : t.status === 'answered' ? 'bg-warning-bg text-warning' : 'bg-selection text-primary';
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className={cx('rounded-[5px] px-1.5 py-0.5 text-[11px] font-bold', tone)}>{label}</span>
      {t.snoozed_until ? <Icon name="clock" size={13} className="text-ink-3" label={text('Snoozed until {time}', { time: rowStamp(t.snoozed_until) })} /> : null}
      {t.notes ? <span className="text-[11px] text-ink-3">{t.notes === 1 ? text('1 internal note') : text('{n} internal notes', { n: t.notes })}</span> : null}
      {t.assignee_name ? <Avatar name={t.assignee_name} size={20} /> : <span className="h-5 w-5 rounded-full border border-dashed border-ink-3" title="Nobody assigned yet" />}
    </span>
  );
}
