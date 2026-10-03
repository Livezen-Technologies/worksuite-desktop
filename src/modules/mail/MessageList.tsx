import { useRef, useState, type ReactNode } from 'react';
import { text } from '../../core/i18n';
import { bytes } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Avatar, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { VirtualList } from '../../components/VirtualList';
import { CHIPS, mailboxBadge, rowStamp, type ChipId, type QueuedAction, type RowGroup } from './model';
import { AccountBadge, CategoryChip } from './parts';
import { MAIL_DRAG } from './TodoPane';
import type { GroupKey, MailPrefs, Mailbox, MessageRow, SortKey } from './types';

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
  focusTabs?: { value: 'focused' | 'other'; onChange: (v: 'focused' | 'other') => void; banner: string | null; unread: { focused: number; other: number } } | null;
  /** Right-click on a row (DMO-SHL-08). */
  onRowMenu?: (r: ListRow, x: number, y: number) => void;
  /** Rows selected besides the open one (DMO-INB-15). */
  selection?: ReadonlySet<string>;
  onSelect?: (r: ListRow, how: 'toggle' | 'range') => void;
}

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'date', label: 'Date' },
  { id: 'sender', label: 'Sender' },
  { id: 'subject', label: 'Subject' },
  { id: 'size', label: 'Size' },
  { id: 'read', label: 'Read status' },
  { id: 'attachment', label: 'Attachments' },
  { id: 'flag', label: 'Importance' },
  { id: 'star', label: 'Starred' },
];

const GROUPS: Array<{ id: GroupKey; label: string }> = [
  { id: 'none', label: 'No grouping' },
  { id: 'date', label: 'Date' },
  { id: 'sender', label: 'Sender' },
  { id: 'folder', label: 'Folder' },
  { id: 'label', label: 'Label' },
  { id: 'priority', label: 'Importance' },
];

export function sortLabel(prefs: MailPrefs): string {
  const s = prefs.sort ?? 'date';
  const dir = prefs.dir ?? 'desc';
  if (s === 'date') return dir === 'desc' ? text('Newest first') : text('Oldest first');
  const name = SORTS.find((x) => x.id === s)?.label ?? s;
  return `${text(name)} ${dir === 'desc' ? '↓' : '↑'}`;
}

export function MessageList(p: MessageListProps) {
  const view = p.prefs.view ?? 'compact';
  const flat = p.groups.flatMap((g) => g.items);
  const [menu, setMenu] = useState<'density' | 'sort' | null>(null);
  const densityBtn = useRef<HTMLButtonElement>(null);
  const sortBtn = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const items: Array<{ kind: 'head'; g: RowGroup & { items: ListRow[] } } | { kind: 'row'; r: ListRow }> = [];
  for (const g of p.groups) {
    if (g.label && view !== 'table') items.push({ kind: 'head', g });
    for (const r of g.items) items.push({ kind: 'row', r });
  }

  const densitySections: MenuSection[] = [
    {
      id: 'density',
      label: text('Density'),
      items: [
        { id: 'classic', label: text('Classic'), icon: 'grid', radio: true, checked: view === 'classic', onSelect: () => p.onPrefs({ view: 'classic' }) },
        { id: 'compact', label: text('Compact'), icon: 'align-justify', radio: true, checked: view === 'compact', onSelect: () => p.onPrefs({ view: 'compact' }) },
        { id: 'super', label: text('Super compact'), icon: 'rows', radio: true, checked: view === 'super', onSelect: () => p.onPrefs({ view: 'super' }) },
        { id: 'table', label: text('Full list'), icon: 'table', radio: true, checked: view === 'table', onSelect: () => p.onPrefs({ view: 'table' }) },
      ],
    },
    {
      id: 'pane',
      label: text('Reading pane'),
      items: [
        { id: 'right', label: text('Right of the list'), radio: true, checked: (p.prefs.pane ?? 'right') === 'right', onSelect: () => p.onPrefs({ pane: 'right' }) },
        { id: 'bottom', label: text('Below the list'), radio: true, checked: p.prefs.pane === 'bottom', onSelect: () => p.onPrefs({ pane: 'bottom' }) },
        { id: 'hidden', label: text('Hidden'), radio: true, checked: p.prefs.pane === 'hidden', onSelect: () => p.onPrefs({ pane: 'hidden' }) },
      ],
    },
    {
      id: 'toolbar',
      label: text('Action bar'),
      items: [
        { id: 'docked', label: text('Docked across the pane'), radio: true, checked: (p.prefs.toolbar ?? 'docked') === 'docked', onSelect: () => p.onPrefs({ toolbar: 'docked' }) },
        { id: 'floating', label: text('Floating pill'), radio: true, checked: p.prefs.toolbar === 'floating', onSelect: () => p.onPrefs({ toolbar: 'floating' }) },
        { id: 'compact', label: text('Compact'), radio: true, checked: p.prefs.toolbar === 'compact', onSelect: () => p.onPrefs({ toolbar: 'compact' }) },
        { id: 'minimal', label: text('Minimal'), radio: true, checked: p.prefs.toolbar === 'minimal', onSelect: () => p.onPrefs({ toolbar: 'minimal' }) },
      ],
    },
    {
      id: 'conversations',
      label: text('Conversations'),
      items: [
        {
          id: 'threads',
          label: text('Group into conversations'),
          icon: 'message-circle',
          checked: !!p.conversations,
          disabled: p.conversations === null,
          reason: text('A combined list or a filtered one is not grouped into conversations.'),
          description: text('Remembered separately for each folder.'),
          onSelect: () => p.onConversations(!p.conversations),
        },
      ],
    },
    {
      id: 'remember',
      items: [{ id: 'all-folders', label: text('Apply this view to all folders'), icon: 'check-check', description: text('These settings are remembered for each folder.'), onSelect: () => p.onPrefs({ applyToAll: true }) }],
    },
  ];
  const sort = p.prefs.sort ?? 'date';
  const dir = p.prefs.dir ?? 'desc';
  const sortSections: MenuSection[] = [
    {
      id: 'sort',
      label: text('Sort by'),
      items: SORTS.map((s) => ({
        id: s.id,
        label: sort === s.id ? `${text(s.label)} ${dir === 'desc' ? '↓' : '↑'}` : text(s.label),
        radio: true,
        checked: sort === s.id,
        onSelect: () => p.onPrefs(sort === s.id ? { dir: dir === 'desc' ? 'asc' : 'desc' } : { sort: s.id, dir: 'desc' }),
      })),
    },
    {
      id: 'group',
      label: text('Group by'),
      items: GROUPS.map((g) => ({ id: g.id, label: text(g.label), radio: true, checked: (p.prefs.group ?? 'date') === g.id, onSelect: () => p.onPrefs({ group: g.id }) })),
    },
  ];

  return (
    <section aria-label="Messages" className={cx('flex min-h-0 flex-col bg-surface', p.fill ? 'min-w-0 flex-1' : 'w-[420px] shrink-0 border-r border-line')}>
      <div ref={bar} className="px-4 pt-3 pb-2">
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
          <button ref={sortBtn} type="button" aria-haspopup="menu" aria-expanded={menu === 'sort'} onClick={() => setMenu(menu === 'sort' ? null : 'sort')} aria-label="Sort and group" title="Sort and group" className={cx('inline-flex h-8 items-center gap-0.5 rounded-[8px] px-1.5 text-ink-2 hover:bg-subtle', menu === 'sort' && 'bg-subtle')}>
            <Icon name="transfers" size={16} />
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
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
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-1.5" role="group" aria-label="Quick filters">
          {CHIPS.map((c) => {
            const on = p.chips.includes(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => p.onChips(on ? p.chips.filter((x) => x !== c.id) : [...p.chips, c.id])} className={cx('h-[26px] shrink-0 rounded-full border px-2.5 text-[12.5px] font-semibold', on ? 'border-ink bg-ink text-surface' : 'border-line text-ink hover:bg-subtle')}>
                {c.label}
              </button>
            );
          })}
          <span className="flex-1" />
          <button type="button" onClick={() => setMenu('sort')} className="shrink-0 truncate text-[12.5px] text-ink-3 hover:text-ink">
            {sortLabel(p.prefs)}
          </button>
        </div>
        {p.notice ? <p className="mt-1.5 text-[12px] text-ink-3">{p.notice}</p> : null}
      </div>
      {view === 'table' && flat.length ? <TableHead unified={p.unified} /> : null}
      <div className="min-h-0 flex-1 border-t border-line" role="listbox" tabIndex={0} aria-label="Messages" aria-activedescendant={p.selectedKey && flat.some((r) => r.key === p.selectedKey) ? `mail-row-${p.selectedKey}` : undefined}>
        {p.loading ? <Spinner /> : p.error && flat.length === 0 ? <div className="p-4"><ErrorNote error={p.error} onRetry={p.onRetry} /></div> : flat.length === 0 ? <Empty icon="inbox" title={p.search ? text('No messages match') : text('Nothing here')} hint={p.search ? text('Press Enter to search every mailbox, older mail too.') : undefined} /> : null}
        {items.length > 0 ? (
          items.length > 150 ? (
            <VirtualList items={items} estimate={view === 'classic' ? 78 : view === 'compact' ? 52 : 36} getKey={(it) => (it.kind === 'head' ? `h:${it.g.key}` : it.r.key)} onEndReached={() => p.hasMore && !p.loadingMore && p.onMore()} render={(it) => (it.kind === 'head' ? <GroupHead g={it.g} /> : <Row r={it.r} {...p} view={view} />)} />
          ) : (
            <div className="h-full overflow-y-auto scroll-thin">
              {items.map((it) => (it.kind === 'head' ? <GroupHead key={`h:${it.g.key}`} g={it.g} /> : <Row key={it.r.key} r={it.r} {...p} view={view} />))}
              {p.hasMore ? (
                <div className="p-3 text-center">
                  <button type="button" onClick={p.onMore} disabled={p.loadingMore} className="text-[12.5px] font-semibold text-primary hover:underline">
                    {p.loadingMore ? text('Loading more…') : text('Show more')}
                  </button>
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </div>
      {menu === 'density' ? <Menu sections={densitySections} label={text('Layout and density')} anchor={densityBtn} avoid={bar} prefer="bottom" align="end" width={270} onClose={() => setMenu(null)} /> : null}
      {menu === 'sort' ? <Menu sections={sortSections} label={text('Sort and group')} anchor={sortBtn} avoid={bar} prefer="bottom" align="end" width={250} onClose={() => setMenu(null)} /> : null}
    </section>
  );
}

function GroupHead({ g }: { g: RowGroup & { items: ListRow[] } }) {
  return (
    <div role="presentation" className="flex h-7 items-center justify-between border-b border-line bg-subtle px-4 text-[11.5px] font-bold uppercase tracking-wide text-ink-2">
      <span className="truncate">{g.label}</span>
      <span className="tabular">{g.items.length}</span>
    </div>
  );
}

function TableHead({ unified }: { unified: boolean }) {
  return (
    <div role="presentation" className="grid h-7 items-center gap-3 border-t border-line px-4 text-[11.5px] font-semibold text-ink-3" style={{ gridTemplateColumns: unified ? '20px 220px 1fr 170px 64px 70px' : '20px 220px 1fr 64px 70px' }}>
      <span />
      <span>From</span>
      <span>Subject</span>
      {unified ? <span>Mailbox</span> : null}
      <span className="text-right">Size</span>
      <span className="text-right">Received</span>
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

/** Pin, flag, snooze and categories on a row: icons with names, never colour alone (DMO-ACC-03). */
function StateMarks({ m }: { m: MessageRow }) {
  const due = m.flag?.due_at ? text('Due {when}', { when: rowStamp(m.flag.due_at) }) : text('Flagged');
  return (
    <>
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

function Row({ r, view, selectedKey, onOpen, onStar, unified, boxes, prefs, onRowMenu, selection, onSelect }: MessageListProps & { r: ListRow; view: NonNullable<MailPrefs['view']> }) {
  const m = r.row;
  // Settings › Reading › Show message previews in the list (D10).
  const preview = prefs.previews === false ? '' : m.preview;
  const selected = r.key === selectedKey || !!selection?.has(r.key);
  const unread = !m.is_read;
  const box = m.mailbox ? boxes.find((b) => b.id === m.mailbox!.id) : null;
  const badge = unified && m.mailbox ? <AccountBadge text={mailboxBadge(box ?? { email: m.mailbox.email })} colour={box?.colour ?? m.mailbox.colour} title={m.mailbox.email} /> : null;
  const queued = r.queued ? <span className="shrink-0 text-[11.5px] font-semibold text-warning">{text(QUEUED_LABEL[r.queued])}</span> : null;
  const sender = m.from_name || m.from_email || text('(unknown sender)');
  const subject = m.subject || text('(no subject)');
  const stamp = rowStamp(m.created_at);
  const team = m.team ? <TeamTag t={m.team} /> : null;
  const common = {
    id: `mail-row-${r.key}`,
    role: 'option',
    'aria-selected': selected,
    'data-mail-row': r.key,
    // Dragged onto My Day: an event or a task from the message (DMO-CAL-07, DMO-TSK-04).
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(MAIL_DRAG, r.key);
      e.dataTransfer.effectAllowed = 'copy';
    },
    onClick: (e: React.MouseEvent) => {
      // Ctrl/⌘-click adds to the selection, Shift-click selects a range (DMO-INB-15).
      if (onSelect && (e.ctrlKey || e.metaKey)) return onSelect(r, 'toggle');
      if (onSelect && e.shiftKey) return onSelect(r, 'range');
      onOpen(r);
    },
    onContextMenu: onRowMenu
      ? (e: React.MouseEvent) => {
          e.preventDefault();
          onRowMenu(r, e.clientX, e.clientY);
        }
      : undefined,
    className: cx('relative w-full cursor-default border-b border-line text-left', selected ? 'bg-selection' : 'hover:bg-subtle', r.queued && r.queued !== 'read' && r.queued !== 'star' && r.queued !== 'unstar' && 'opacity-60'),
  } as const;
  const dot = <span aria-hidden className={cx('h-[7px] w-[7px] shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')} />;
  const count = m.count && m.count > 1 ? <span className="shrink-0 text-[12px] font-semibold text-ink-3">{m.count}</span> : null;
  const label = text(unread ? '{sender}, {subject}, unread, {time}' : '{sender}, {subject}, {time}', { sender, subject, time: stamp });

  if (view === 'table') {
    return (
      <div {...common} aria-label={label} className={cx(common.className, 'grid h-[36px] items-center gap-3 px-4 text-[13px]')} style={{ gridTemplateColumns: unified ? '20px 220px 1fr 170px 64px 70px' : '20px 220px 1fr 64px 70px' }}>
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
        <span className={cx('truncate', unread ? 'font-bold text-ink' : 'text-ink')}>{sender}</span>
        <span className="flex min-w-0 items-center gap-2 truncate">
          {queued}
          <StateMarks m={m} />
          <span className={cx('truncate', unread ? 'font-bold text-ink' : 'font-semibold text-ink')}>{subject}</span>
          {preview ? <span className="truncate text-ink-3">— {preview}</span> : null}
        </span>
        {unified ? (m.mailbox ? (
          <span className="flex min-w-0 items-center gap-1.5" title={m.mailbox.email}>
            {badge}
            <span className="truncate text-[12px] text-ink-3">{m.mailbox.email}</span>
          </span>
        ) : <span />) : null}
        <span className="text-right font-mono text-[12px] text-ink-2 tabular">{m.size ? bytes(m.size) : ''}</span>
        <span className="text-right text-[12px] text-ink-3">{stamp}</span>
      </div>
    );
  }
  if (view === 'super') {
    return (
      <div {...common} aria-label={label} className={cx(common.className, 'flex h-[34px] items-center gap-2.5 px-4 text-[13px]')}>
        {dot}
        <span className={cx('w-[34%] shrink-0 truncate', unread ? 'font-bold text-ink' : 'text-ink')}>{sender}</span>
        {count}
        <span className="min-w-0 flex-1 truncate">
          <span className={cx(unread ? 'font-bold text-ink' : 'font-semibold text-ink')}>{subject}</span>
          {preview ? <span className="text-ink-3"> — {preview}</span> : null}
        </span>
        <StateMarks m={m} />
        {queued}
        {badge}
        <span className="shrink-0 text-[12px] text-ink-3">{stamp}</span>
      </div>
    );
  }
  if (view === 'classic') {
    return (
      <div {...common} aria-label={label} className={cx(common.className, 'flex gap-3 px-4 py-2.5')}>
        <Avatar name={sender} size={36} className="mt-0.5" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className={cx('min-w-0 flex-1 truncate text-[13.5px]', unread ? 'font-bold text-ink' : 'font-semibold text-ink')}>{sender}</span>
            {count}
            {queued}
            {badge}
            <span className="shrink-0 text-[12px] text-ink-3">{stamp}</span>
          </span>
          <span className={cx('truncate text-[13.5px]', unread ? 'font-bold text-ink' : 'text-ink')}>{subject}</span>
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{preview}</span>
            {m.has_attachment ? <Icon name="paperclip" size={13} className="shrink-0 text-ink-3" label="Has attachments" /> : null}
            {m.is_starred ? <Icon name="star" size={13} className="shrink-0 fill-current text-warning" label="Starred" /> : null}
            <StateMarks m={m} />
            {team}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div {...common} aria-label={label} className={cx(common.className, 'flex flex-col gap-0.5 px-4 py-2')}>
      <span className="flex items-center gap-2">
        {dot}
        <span className={cx('min-w-0 flex-1 truncate text-[13.5px]', unread ? 'font-bold text-ink' : 'text-ink')}>{sender}</span>
        {count}
        {m.has_attachment ? <Icon name="paperclip" size={13} className="shrink-0 text-ink-3" label="Has attachments" /> : null}
        {m.is_starred ? <Icon name="star" size={13} className="shrink-0 fill-current text-warning" label="Starred" /> : null}
        {queued}
        {badge}
        <span className="shrink-0 text-[12px] text-ink-3">{stamp}</span>
      </span>
      <span className="flex items-center gap-2 pl-[15px]">
        <span className="min-w-0 flex-1 truncate text-[13px]">
          <span className={cx(unread ? 'font-bold text-ink' : 'font-semibold text-ink')}>{subject}</span>
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
