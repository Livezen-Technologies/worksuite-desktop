import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { type MenuSection } from '../../components/Menu';
import { PrimaryActionButton, SidebarIconButton } from '../../components/PrimaryAction';
import { Button, DATA_TEXT, Kbd, Modal, Spinner, TextField, cx } from '../../components/ui';
import { ContextMenu } from './MessageMenus';
import { mailKeys, useFolders, useLabels } from './api';
import { app, updatePrefs } from '../../core/app-state';
import { useStore } from '../../core/store';
import { defaultFolderOffline, folderOffline, type FolderOffline } from '@shared/mailto';
import type { Preferences } from '@shared/types';
import { copyWords } from './MailSettings';
import { ALL_FOLDERS, allCount } from './allAccounts';
import { SMART_VIEWS, folderName, mailboxLetter, type SmartViewId } from './model';
import { AccountAvatar, Count, SectionHeading } from './parts';
import { accountName, accountState, syncAgo, syncAt, type SyncSummary } from './sync';
import type { AllCounts, Folder, Mailbox, SyncAccount, ViewCounts } from './types';

/** Where the list is: All Accounts (`unified`), a smart view, or a folder of one mailbox. */
export interface Place {
  box: string;
  view: SmartViewId | null;
  folder: string;
  label: number | null;
}

export interface SidebarProps {
  boxes: Mailbox[];
  loading: boolean;
  counts: ViewCounts | null;
  /** All Accounts' counts (GET views/all/counts); null from an older server. */
  allCounts: AllCounts | null;
  /** What only this computer knows: drafts not yet uploaded, sends waiting in its queue. */
  local: { drafts: number; outbox: number };
  place: Place;
  /** Labels are kept in WorkSuite's own store; they are offered where that store is the mail. */
  showLabels: boolean;
  active: boolean;
  /** The one sync status (DMO-SYN-05) and each account's row. */
  summary: SyncSummary;
  accounts: SyncAccount[];
  /** Accounts this computer is syncing now, and whether a Sync all runs. */
  running: ReadonlySet<number>;
  syncingAll: boolean;
  offline: boolean;
  pending: number;
  cacheDays: number;
  onCompose: () => void;
  /** The ⌄ part of New email: from a template, in a new window, an event, a contact (worksuite-desktop#171). */
  newMenu?: MenuSection[];
  onSearch: () => void;
  onAddMailbox: () => void;
  onPick: (p: Partial<Place>) => void;
  onSyncAll: () => void;
  onSyncAccount: (id: number) => void;
  /** Export a folder to .mbox or .eml (ENH-MAIL-03 DMO-DAT-03). */
  onExport?: (box: Mailbox, slug: string, label: string) => void;
  /** Settings › Mail: accounts, offline and storage. */
  onSettings: () => void;
  /** Favourites (DMO-NAV-01): "key|label" — "4:label:Clients|Clients", "all:inbox|Inbox", "view:unread|Unread". */
  favorites?: string[];
  onFavorites?: (next: string[]) => void;
}

/** A favourite's place in the pane. */
export function favoritePlace(key: string): Partial<Place> | null {
  if (key.startsWith('all:')) {
    const role = key.slice(4);
    return { box: 'unified', view: null, folder: role === 'junk' ? 'spam' : role, label: null };
  }
  if (key.startsWith('view:')) {
    const v = SMART_VIEWS.find((x) => x.id === key.slice(5));
    return v ? { box: 'unified', view: v.id, folder: v.folder, label: null } : null;
  }
  const m = /^(\d+):(.+)$/.exec(key);
  return m ? { box: m[1]!, view: null, folder: m[2]!, label: null } : null;
}

/** Is the list showing this favourite? */
function isPlace(key: string, place: Place): boolean {
  const p = favoritePlace(key);
  return !!p && p.box === place.box && (p.view ?? null) === place.view && p.folder === place.folder && place.label === null;
}

const FOLDER_ICON: Record<string, string> = { inbox: 'inbox', sent: 'send', drafts: 'file-text', archive: 'archive', spam: 'shield-alert', junk: 'shield-alert', trash: 'trash' };

/** A mailbox's name in the sidebar: its address, or its own name and provider when it has one. */
export function mailboxName(b: Mailbox): string {
  if (b.shared) return text('{email} · shared', { email: b.email });
  const local = b.email.split('@')[0] ?? '';
  if (b.display_name && b.display_name !== local && b.display_name !== b.email && b.provider_label) return `${b.display_name} · ${b.provider_label}`;
  return b.email;
}

/** A mailbox's unread count: the mirror's when it counted it, else the local store's. */
export function unreadOf(b: Mailbox, counts: ViewCounts | null): number | null {
  const c = counts?.mailboxes.find((m) => m.id === b.id);
  if (c?.counted) return c.unread;
  return b.unread;
}

interface PaneMemory {
  favorites?: boolean;
  all: boolean;
  accounts: boolean;
  views: boolean;
  labels: boolean;
  /** Accounts whose folder trees are open. */
  expanded: number[];
}

const MEMORY_KEY = 'ws.mail.pane';

/** The pane's open and collapsed sections, remembered on this computer (DMO-ALL-01). */
export function readPaneMemory(): PaneMemory | null {
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<PaneMemory>) : null;
    if (!v || typeof v !== 'object') return null;
    return { all: v.all !== false, accounts: v.accounts !== false, views: v.views !== false, labels: v.labels !== false, expanded: Array.isArray(v.expanded) ? v.expanded.filter((n): n is number => typeof n === 'number') : [] };
  } catch {
    return null;
  }
}

function writePaneMemory(m: PaneMemory): void {
  try {
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(m));
  } catch {
    // Private window or blocked storage: the pane just opens as it always does.
  }
}

export function MailSidebar(p: SidebarProps) {
  const [memory, setMemory] = useState<PaneMemory>(() => readPaneMemory() ?? { all: true, accounts: true, views: true, labels: true, expanded: [] });
  const remember = (patch: Partial<PaneMemory>) =>
    setMemory((m) => {
      const next = { ...m, ...patch };
      writePaneMemory(next);
      return next;
    });
  const [naming, setNaming] = useState<{ kind: 'folder' | 'label'; box: Mailbox | null } | null>(null);
  const [folderMenu, setFolderMenu] = useState<FolderMenu | null>(null);
  // A folder's properties, and what this computer keeps of each folder (DMO-OFF-01, DMO-DAT-05).
  const [props, setProps] = useState<{ box: Mailbox; slug: string; label: string } | null>(null);
  const offlinePrefs = useStore(app, (s) => s.prefs ?? null);
  const many = p.boxes.length > 1;
  const inAll = p.place.box === 'unified' && !p.place.view && p.place.label === null;
  // An older server counts no All Accounts folders: the inbox is then the sum of each included account's unread.
  const fallbackInbox = p.boxes.filter((b) => b.in_unified !== false).reduce((n, b) => n + (unreadOf(b, p.counts) ?? 0), 0);
  const views = SMART_VIEWS.filter((v) => v.id !== 'important' || (p.counts?.views.important ?? null) !== null);
  const placeId = Number(p.place.box);
  // The account being looked at, or the default one, shows its folders until it is collapsed.
  const expanded = (b: Mailbox) => memory.expanded.includes(b.id) || (!memory.expanded.includes(-b.id) && (placeId === b.id || (!many && p.boxes[0]?.id === b.id) || (Number.isNaN(placeId) && !!b.is_default)));
  const toggleAccount = (b: Mailbox) => {
    const open = expanded(b);
    const rest = memory.expanded.filter((x) => x !== b.id && x !== -b.id);
    remember({ expanded: open ? [...rest, -b.id] : [...rest, b.id] });
  };
  const account = (id: number) => p.accounts.find((a) => a.mailbox === id) ?? null;
  return (
    <nav aria-label="Mail" className="flex w-[260px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex gap-2 p-3 pb-1">
        <PrimaryActionButton data-guide="mail.compose" label={text('New email')} shortcut="N" onClick={p.onCompose} menu={p.newMenu} menuLabel={text('New')} className="flex-1" />
        <SidebarIconButton icon="search" onClick={p.onSearch} label={text('Search mail')} shortcut="/" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
        {p.favorites?.length ? (
          <>
            <SectionHeading label={text('Favorites')} open={memory.favorites !== false} onToggle={() => remember({ favorites: memory.favorites === false })} />
            {memory.favorites !== false ? (
              <ul role="list" aria-label={text('Favorites')}>
                {p.favorites.map((entry) => {
                  const [key = '', label = key] = entry.split('|');
                  const target = favoritePlace(key);
                  if (!target) return null;
                  return (
                    <li key={key} onContextMenu={(e) => {
                      e.preventDefault();
                      setFolderMenu({ x: e.clientX, y: e.clientY, key, label, box: null, slug: null });
                    }}>
                      <Row icon="star" iconClass="text-warning" label={label} active={isPlace(key, p.place)} onClick={() => p.onPick(target)} />
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        ) : null}
        {many ? (
          <>
            <SectionHeading label={text('All Accounts')} open={memory.all} onToggle={() => remember({ all: !memory.all })}>
              <SyncAllButton summary={p.summary} accounts={p.accounts} boxes={p.boxes} running={p.running} syncingAll={p.syncingAll} offline={p.offline} onSyncAll={p.onSyncAll} onRetry={p.onSyncAccount} />
            </SectionHeading>
            {memory.all ? (
              <ul role="list" aria-label={text('All Accounts')}>
                {ALL_FOLDERS.map((f) => {
                  const c = allCount(f.role, p.allCounts, { ...p.local, inbox: fallbackInbox });
                  if (c.hidden) return null;
                  const here = inAll && p.place.folder === (f.role === 'junk' ? 'spam' : f.role);
                  return (
                    <li key={f.role} onContextMenu={(e) => {
                      e.preventDefault();
                      setFolderMenu({ x: e.clientX, y: e.clientY, key: `all:${f.role}`, label: text(f.label), box: null, slug: null });
                    }}>
                      <Row icon={f.icon} iconClass={f.role === 'outbox' && c.n ? 'text-danger' : undefined} label={text(f.label)} count={c.n} countTitle={c.title} strong={f.role === 'inbox' && !!c.n} active={here} onClick={() => p.onPick({ box: 'unified', view: null, folder: f.role === 'junk' ? 'spam' : f.role, label: null })} />
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        ) : null}

        <SectionHeading label={text('Accounts')} open={memory.accounts} onToggle={() => remember({ accounts: !memory.accounts })} onAdd={p.onAddMailbox} addLabel={text('Add a mailbox')}>
          {!many ? <SyncAllButton summary={p.summary} accounts={p.accounts} boxes={p.boxes} running={p.running} syncingAll={p.syncingAll} offline={p.offline} onSyncAll={p.onSyncAll} onRetry={p.onSyncAccount} /> : null}
        </SectionHeading>
        {memory.accounts ? (
          <ul role="list" aria-label={text('Accounts')}>
            {p.loading ? <Spinner label="" className="p-2" /> : null}
            {p.boxes.map((b) => {
              const n = unreadOf(b, p.counts);
              const open = expanded(b);
              const a = account(b.id);
              return (
                <li key={b.id}>
                  <AccountRow
                    box={b}
                    account={a}
                    running={p.running.has(b.id) || !!a?.running}
                    offline={p.offline}
                    open={open}
                    count={n}
                    active={p.place.box === String(b.id) && !p.place.view && p.place.folder === 'inbox'}
                    onToggle={() => toggleAccount(b)}
                    onPick={() => p.onPick({ box: String(b.id), view: null, folder: 'inbox', label: null })}
                    onSync={() => p.onSyncAccount(b.id)}
                  />
                  {open ? <FolderTree box={b} place={p.place} active={p.active} onPick={p.onPick} onAdd={() => setNaming({ kind: 'folder', box: b })} onMenu={(x, y, f) => setFolderMenu({ x, y, key: `${b.id}:${f.slug}`, label: f.slug.startsWith('label:') ? folderName(f.name) : f.name, box: b, slug: f.slug })} /> : null}
                </li>
              );
            })}
            {!p.loading && p.boxes.length === 0 ? (
              <li className="px-2 py-1.5 text-[12.5px] text-ink-3">
                {text('No mailbox yet.')}{' '}
                <button type="button" className="font-semibold text-primary underline" onClick={p.onAddMailbox}>
                  {text('Add a mailbox')}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}

        <SectionHeading label={text('Smart views')} open={memory.views} onToggle={() => remember({ views: !memory.views })} />
        {memory.views ? (
          <ul role="list">
            {views.map((v) => {
              const n = p.counts ? ((p.counts.views as Record<string, number | null | undefined>)[v.id] ?? null) : null;
              // Today and Has attachments are lists, not badges: a count beside them is noise.
              const shown = v.id === 'today' || v.id === 'attachments' ? null : n;
              return (
                <li
                  key={v.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setFolderMenu({ x: e.clientX, y: e.clientY, key: `view:${v.id}`, label: text(v.label), box: null, slug: null });
                  }}
                >
                  <Row icon={v.icon} iconClass={v.id === 'starred' ? 'text-warning' : v.id === 'important' ? 'text-danger' : undefined} label={text(v.label)} count={shown} active={p.place.view === v.id} onClick={() => p.onPick({ box: 'unified', view: v.id, folder: v.folder, label: null })} />
                </li>
              );
            })}
          </ul>
        ) : null}

        {p.showLabels ? <LabelSection open={memory.labels} onToggle={() => remember({ labels: !memory.labels })} onAdd={() => setNaming({ kind: 'label', box: null })} place={p.place} active={p.active} onPick={p.onPick} /> : null}
      </div>
      <SyncDetails summary={p.summary} pending={p.pending} cacheDays={p.cacheDays} accounts={p.accounts} boxes={p.boxes} running={p.running} syncingAll={p.syncingAll} offline={p.offline} onSyncAll={p.onSyncAll} onSyncAccount={p.onSyncAccount} onSettings={p.onSettings} />
      {naming ? <NameDialog kind={naming.kind} mailbox={naming.box} onClose={() => setNaming(null)} /> : null}
      {folderMenu ? (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          label={text('Folder actions')}
          onClose={() => setFolderMenu(null)}
          sections={folderSections(folderMenu, p, () => setNaming({ kind: 'folder', box: folderMenu.box }), offlinePrefs, () => setProps({ box: folderMenu.box!, slug: folderMenu.slug!, label: folderMenu.label }))}
        />
      ) : null}
      {props ? <FolderProperties box={props.box} slug={props.slug} label={props.label} prefs={offlinePrefs} onClose={() => setProps(null)} /> : null}
    </nav>
  );
}

function Row({ icon, iconClass, lead, label, title, count, countTitle, strong, active, nested, warn, onClick }: { icon?: string; iconClass?: string; lead?: ReactNode; label: string; title?: string; count?: number | null; countTitle?: string | null; strong?: boolean; active: boolean; nested?: boolean; warn?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={countTitle ? `${title ?? label} · ${countTitle}` : (title ?? label)}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex h-[30px] w-full items-center gap-2.5 rounded-[8px] pr-1.5 text-left text-[13.5px]',
        nested ? 'pl-7' : 'pl-2.5',
        active ? 'bg-selection font-semibold text-primary before:absolute before:-left-2 before:top-1 before:bottom-1 before:w-[3px] before:rounded-full before:bg-primary' : 'text-ink hover:bg-subtle',
        strong && !active && 'font-semibold',
      )}
    >
      {lead ?? (icon ? <Icon name={icon} size={16} className={cx('shrink-0', iconClass ?? (active ? 'text-primary' : 'text-ink-2'))} /> : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {warn ? <Icon name="warning" size={14} className="shrink-0 text-danger" label={text('Sign-in problem')} /> : null}
      <Count n={count} strong={strong} active={active} />
    </button>
  );
}

/** An account's row: open its folders, its inbox, and its own sync button — a spinner while it syncs, Retry when it failed (DMO-SYN-01/02/04). */
function AccountRow({ box, account, running, offline, open, count, active, onToggle, onPick, onSync }: { box: Mailbox; account: SyncAccount | null; running: boolean; offline: boolean; open: boolean; count: number | null; active: boolean; onToggle: () => void; onPick: () => void; onSync: () => void }) {
  const failed = !running && (account?.last_result === 'failed' || box.auth_state === 'problem');
  const why = account?.error ?? box.last_error ?? text('The last sync did not finish.');
  const name = mailboxName(box);
  const status = account ? accountState(account) : null;
  return (
    <div className={cx('group relative flex h-[30px] items-center rounded-[8px]', active ? 'bg-selection' : 'hover:bg-subtle')}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? text('Hide the folders of {name}', { name }) : text('Show the folders of {name}', { name })} className="inline-flex h-6 w-5 shrink-0 items-center justify-center text-ink-3 hover:text-ink">
        <Icon name="chevron-down" size={12} className={cx('transition-transform motion-reduce:transition-none', open ? '' : '-rotate-90')} />
      </button>
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? 'page' : undefined}
        title={failed ? text('{name} · sync failed: {why}', { name, why }) : status ? `${name} · ${status.label}` : box.email}
        className={cx('flex min-w-0 flex-1 items-center gap-2 pr-1 text-left text-[13.5px]', active ? 'font-semibold text-primary' : 'text-ink', !!count && !active && 'font-semibold')}
      >
        <AccountAvatar letter={mailboxLetter(box)} colour={box.colour} size={18} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <Count n={count} strong={!!count} active={active} />
      </button>
      {failed ? (
        <button type="button" onClick={onSync} disabled={offline} title={offline ? text('You’re offline — mail will sync when you reconnect') : text('Sync failed: {why} — retry', { why })} className="mr-1 inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[6px] bg-danger-bg px-1.5 text-[11.5px] font-bold text-danger hover:brightness-95 disabled:opacity-50">
          <Icon name="warning" size={12} />
          {text('Retry')}
        </button>
      ) : (
        <button
          type="button"
          onClick={onSync}
          disabled={offline || running}
          aria-label={running ? text('Syncing {name}…', { name }) : text('Sync {name}', { name })}
          title={offline ? text('You’re offline — mail will sync when you reconnect') : running ? text('Syncing…') : account?.last_ok_at ? text('Last synced {ago} · sync now', { ago: syncAgo(account.last_ok_at) }) : text('Sync now')}
          className={cx('mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-surface hover:text-ink disabled:cursor-default', running ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100')}
        >
          <Icon name="refresh" size={13} className={running ? 'animate-spin motion-reduce:animate-none' : undefined} />
        </button>
      )}
    </div>
  );
}

/**
 * The ↻ on the All Accounts header (DMO-SYN-01…03): runs Sync all; spins
 * while anything syncs; hovering or focusing it lists each account with its
 * last successful sync and its state, failed ones with Retry.
 */
function SyncAllButton({ summary, accounts, boxes, running, syncingAll, offline, onSyncAll, onRetry }: { summary: SyncSummary; accounts: SyncAccount[]; boxes: Mailbox[]; running: ReadonlySet<number>; syncingAll: boolean; offline: boolean; onSyncAll: () => void; onRetry: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spin = syncingAll || summary.state === 'syncing';
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  const rows = accounts.filter((a) => a.included || boxes.length <= 1);
  return (
    <span className="relative" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onKeyDown={(e) => (e.key === 'Escape' ? setOpen(false) : undefined)}>
      <button
        type="button"
        onClick={onSyncAll}
        disabled={offline}
        aria-label={offline ? text('You’re offline — mail will sync when you reconnect') : spin ? text('Syncing — pressing again won’t start another') : text('Sync all accounts')}
        aria-keyshortcuts="Control+Shift+R"
        aria-describedby={open ? 'mail-sync-all-card' : undefined}
        className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink disabled:opacity-50"
      >
        <Icon name="refresh" size={13} className={spin ? 'animate-spin motion-reduce:animate-none' : undefined} />
      </button>
      {open ? (
        <div id="mail-sync-all-card" role="tooltip" className="absolute left-0 top-7 z-30 w-[300px] rounded-[10px] border border-line bg-surface p-2 text-[12.5px] shadow-lg">
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <b className="text-ink">{spin ? summary.headline : text('Sync all accounts')}</b>
            <Kbd aria-hidden>{text('Ctrl+Shift+R')}</Kbd>
          </div>
          <AccountRows accounts={rows} boxes={boxes} running={running} offline={offline} onSync={onRetry} />
          <p className="mt-1.5 border-t border-line px-1.5 pt-1.5 text-[11.5px] text-ink-3">{offline ? text('You’re offline — mail will sync when you reconnect') : spin ? text('Sync is running — pressing again won’t start another.') : text('Last successful sync per account. Click to sync all now.')}</p>
        </div>
      ) : null}
    </span>
  );
}

/**
 * Each account's sync state: name, state, last synced (in the tooltip), the error and Retry. With `onFix`
 * (the card's details) every account gets Sync now and a failed one Fix (worksuite-desktop#172).
 */
function AccountRows({ accounts, boxes, running, offline, onSync, onFix }: { accounts: SyncAccount[]; boxes: Mailbox[]; running: ReadonlySet<number>; offline: boolean; onSync: (id: number) => void; onFix?: () => void }) {
  return (
    <ul role="list" className="flex flex-col gap-0.5">
      {accounts.map((a) => {
        const b = boxes.find((x) => x.id === a.mailbox);
        const busy = running.has(a.mailbox) || a.running;
        const st = accountState(busy ? { ...a, running: true } : a);
        const name = accountName(a, b);
        return (
          <li key={a.mailbox} className={cx('flex items-center gap-2 rounded-[8px] px-1.5 py-1', st.tone === 'danger' && 'bg-danger-bg')}>
            {b ? <AccountAvatar letter={mailboxLetter(b)} colour={b.colour} size={18} /> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink" title={name}>{name}</span>
              <span className={cx('block', onFix ? 'break-words' : 'truncate', st.tone === 'danger' ? 'text-danger' : st.tone === 'warning' ? 'text-warning' : 'text-ink-3')} title={a.last_ok_at ? text('Last successful sync: {at}', { at: syncAt(a.last_ok_at) }) : st.label}>
                {st.label}
              </span>
            </span>
            {st.tone === 'danger' && !offline ? (
              <button type="button" onClick={() => onSync(a.mailbox)} className="h-6 shrink-0 rounded-[6px] bg-danger px-2 text-[11.5px] font-bold text-white hover:brightness-95">
                {text('Retry')}
              </button>
            ) : onFix && !offline ? (
              <button type="button" disabled={busy} onClick={() => onSync(a.mailbox)} aria-label={text('Sync {name} now', { name })} className="h-6 shrink-0 rounded-[6px] border border-line px-2 text-[11.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
                {text('Sync now')}
              </button>
            ) : null}
            {onFix && st.tone === 'danger' ? (
              <button type="button" onClick={onFix} aria-label={text('Fix {name}', { name })} className="h-6 shrink-0 rounded-[6px] border border-line px-2 text-[11.5px] font-semibold text-ink hover:bg-subtle">
                {text('Fix')}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The footer card, with every account's details on click (worksuite-desktop#172): Sync all, Sync now, Fix. */
function SyncDetails(p: { summary: SyncSummary; pending: number; cacheDays: number; accounts: SyncAccount[]; boxes: Mailbox[]; running: ReadonlySet<number>; syncingAll: boolean; offline: boolean; onSyncAll: () => void; onSyncAccount: (id: number) => void; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => (root.current && !root.current.contains(e.target as Node) ? setOpen(false) : undefined);
    const esc = (e: KeyboardEvent) => (e.key === 'Escape' ? setOpen(false) : undefined);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const spin = p.syncingAll || p.summary.state === 'syncing';
  const rows = p.accounts.filter((a) => a.included || p.boxes.length <= 1);
  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mail-sync-details" title={text('Each account’s sync status')} className="block w-full text-left">
        <SyncCard summary={p.summary} pending={p.pending} cacheDays={p.cacheDays} />
      </button>
      {open ? (
        <div id="mail-sync-details" role="dialog" aria-label={text('Sync status')} className="absolute right-2 bottom-full left-2 z-30 mb-1 rounded-[10px] border border-line bg-surface p-2 text-[12.5px] shadow-lg">
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
            <b className="min-w-0 break-words text-ink">{p.summary.headline}</b>
            <button type="button" onClick={p.onSyncAll} disabled={p.offline} aria-label={spin ? text('Syncing — pressing again won’t start another') : text('Sync all accounts')} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] border border-line px-2 font-semibold text-ink hover:bg-subtle disabled:opacity-50">
              <Icon name="refresh" size={13} className={spin ? 'animate-spin motion-reduce:animate-none' : undefined} />
              {text('Sync all')}
            </button>
          </div>
          {p.summary.liveLine ? <p className={cx('px-1.5 pb-1 text-[11.5px]', p.summary.live < p.summary.pushTotal ? 'text-warning' : 'text-ink-3')}>{p.summary.liveLine}</p> : null}
          <AccountRows accounts={rows} boxes={p.boxes} running={p.running} offline={p.offline} onSync={p.onSyncAccount} onFix={p.onSettings} />
          <button type="button" onClick={p.onSettings} className="mt-1.5 w-full border-t border-line px-1.5 pt-1.5 text-left text-[11.5px] font-semibold text-primary hover:underline">
            {text('Mail accounts, offline and storage settings')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** An account's folders, under its row (DMO-ALL-13: per-account trees stay as they were). */
function FolderTree({ box, place, active, onPick, onAdd, onMenu }: { box: Mailbox; place: Place; active: boolean; onPick: (p: Partial<Place>) => void; onAdd: () => void; onMenu: (x: number, y: number, f: Folder) => void }) {
  const folders = useFolders(box.id, active);
  const list = (folders.data?.folders ?? []).filter((f) => f.slug !== 'starred' && f.slug !== 'important');
  const here = (f: Folder) => !place.view && place.label === null && place.folder === f.slug && place.box === String(box.id);
  return (
    <ul role="list" aria-label={text('Folders of {email}', { email: box.email })}>
      {folders.isLoading ? <Spinner label="" className="p-2" /> : null}
      {folders.error ? <li className="px-2 text-[12px] text-danger">{errorMessage(folders.error)}</li> : null}
      {list.map((f) => {
        const custom = !FOLDER_ICON[f.slug];
        // Unread in the folders mail arrives in; Sent, Drafts and Trash count nothing worth a badge.
        const n = ['sent', 'trash', 'drafts'].includes(f.slug) ? null : f.unread;
        return (
          <li
            key={f.slug}
            onContextMenu={(e) => {
              e.preventDefault();
              onMenu(e.clientX, e.clientY, f);
            }}
          >
            <Row nested icon={FOLDER_ICON[f.slug] ?? 'folder'} iconClass={custom ? 'text-warning' : undefined} label={custom ? folderName(f.name) : f.name} count={n} strong={!!n} active={here(f)} onClick={() => onPick({ box: String(box.id), view: null, folder: f.slug, label: null })} />
          </li>
        );
      })}
      {!folders.isLoading ? (
        <li>
          <button type="button" onClick={onAdd} className="flex h-[26px] w-full items-center gap-2.5 rounded-[8px] pl-7 text-left text-[12.5px] text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="plus" size={14} />
            {text('New folder')}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

interface FolderMenu {
  x: number;
  y: number;
  /** The favourite's key: "4:label:Clients", "all:inbox". */
  key: string;
  label: string;
  /** The account and folder, for a real folder. */
  box: Mailbox | null;
  slug: string | null;
}

const ROLE_CHOICES: Array<{ role: string; label: string }> = [
  { role: 'drafts', label: 'Drafts' },
  { role: 'sent', label: 'Sent' },
  { role: 'archive', label: 'Archive' },
  { role: 'trash', label: 'Deleted Items' },
  { role: 'junk', label: 'Junk Email' },
];

/** A folder's right-click menu (DMO-NAV-03, DMO-ALL-06): Favorites, its role in All Accounts, a new folder, sync. */
/** The offline choices a folder offers (ENH-MAIL-03 DMO-OFF-01). */
export const OFFLINE_CHOICES: Array<{ id: FolderOffline; label: string; hint: string }> = [
  { id: 'recent', label: 'Keep recent messages', hint: 'Within the mailbox’s keep period' },
  { id: 'headers', label: 'Headers only', hint: 'Messages open from the server' },
  { id: 'online', label: 'Online only', hint: 'Nothing kept on this computer' },
];

const setFolderOffline = (prefs: Pick<Preferences, 'mailFolderOffline'> | null, box: Mailbox, slug: string, v: FolderOffline) => {
  const key = `${box.id}:${slug}`;
  const next = { ...(prefs?.mailFolderOffline ?? {}) };
  if (v === defaultFolderOffline(slug)) delete next[key];
  else next[key] = v;
  void updatePrefs({ mailFolderOffline: next });
};

function folderSections(m: FolderMenu, p: SidebarProps, onNewFolder: () => void, prefs: Pick<Preferences, 'mailFolderOffline'> | null = null, onProperties?: () => void): MenuSection[] {
  const favs = p.favorites ?? [];
  const isFav = favs.some((e) => e.split('|')[0] === m.key);
  const sections: MenuSection[] = [];
  if (p.onFavorites) {
    sections.push({
      id: 'fav',
      items: [
        isFav
          ? { id: 'unfav', label: text('Remove from Favorites'), icon: 'star', onSelect: () => p.onFavorites!(favs.filter((e) => e.split('|')[0] !== m.key)) }
          : { id: 'fav', label: text('Add to Favorites'), icon: 'star', onSelect: () => p.onFavorites!([...favs, `${m.key}|${m.label}`].slice(0, 40)) },
      ],
    });
  }
  if (m.box && m.slug && m.slug !== 'inbox') {
    const box = m.box;
    const slug = m.slug;
    sections.push({
      id: 'role',
      items: [
        {
          id: 'role',
          label: text('Use this folder as'),
          icon: 'folder-input',
          description: text('In All Accounts, for {email}', { email: box.email }),
          submenu: [
            {
              id: 'roles',
              items: ROLE_CHOICES.map((r) => ({
                id: r.role,
                label: text(r.label),
                onSelect: () =>
                  void apiPut('/api/mail/folders/role', { mailbox: box.id, folder: slug, role: r.role })
                    .then(() => toast('success', text('{folder} is now this account’s {role}.', { folder: m.label, role: text(r.label) })))
                    .catch((e) => toast('error', errorMessage(e))),
              })),
            },
          ],
        },
      ],
    });
  }
  if (m.box) {
    const box = m.box;
    sections.push({
      id: 'more',
      items: [
        { id: 'new', label: text('New folder'), icon: 'folder-plus', onSelect: onNewFolder },
        { id: 'sync', label: text('Sync {email}', { email: box.email }), icon: 'refresh', disabled: p.offline, reason: text('You’re offline — mail will sync when you reconnect'), onSelect: () => p.onSyncAccount(box.id) },
        ...(m.slug && p.onExport ? [{ id: 'export', label: text('Export folder…'), icon: 'download', disabled: p.offline, reason: text('Available when you are back online.'), onSelect: () => p.onExport!(box, m.slug!, m.label) }] : []),
        ...(m.slug
          ? [
              {
                id: 'offline',
                label: text('On this computer'),
                icon: 'cloud-off',
                description: text(OFFLINE_CHOICES.find((c) => c.id === folderOffline(prefs ?? {}, String(box.id), m.slug!))!.label),
                submenu: [{ id: 'choices', items: OFFLINE_CHOICES.map((c) => ({ id: c.id, label: text(c.label), description: text(c.hint), radio: true, checked: folderOffline(prefs ?? {}, String(box.id), m.slug!) === c.id, onSelect: () => setFolderOffline(prefs, box, m.slug!, c.id) })) }],
              },
              ...(onProperties ? [{ id: 'properties', label: text('Properties'), icon: 'info', onSelect: onProperties }] : []),
            ]
          : []),
      ],
    });
  }
  return sections;
}

function LabelSection({ open, onToggle, onAdd, place, active, onPick }: { open: boolean; onToggle: () => void; onAdd: () => void; place: Place; active: boolean; onPick: (p: Partial<Place>) => void }) {
  const labels = useLabels(active);
  const list = (labels.data?.labels ?? []).filter((l) => !l.is_hidden);
  if (!labels.isLoading && list.length === 0 && !labels.error) {
    return <SectionHeading label={text('Labels')} open={false} onToggle={onToggle} onAdd={onAdd} addLabel={text('New label')} />;
  }
  return (
    <>
      <SectionHeading label={text('Labels')} open={open} onToggle={onToggle} onAdd={onAdd} addLabel={text('New label')} />
      {open ? (
        <ul role="list">
          {list.map((l) => (
            <li key={l.id}>
              <Row
                lead={
                  <span className={cx('inline-flex shrink-0', DATA_TEXT)} style={{ '--c': l.color || 'var(--ws-ink-3)' } as CSSProperties}>
                    <Icon name="tag" size={16} />
                  </span>
                }
                label={l.name}
                count={l.messages ?? null}
                active={place.label === l.id}
                onClick={() => onPick({ box: 'unified', view: null, folder: `label:${l.id}`, label: l.id })}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** The folder pane's footer: the one sync status (DMO-SYN-05/07) — the same words as the status bar and Settings. */
export function SyncCard({ summary, pending, cacheDays }: { summary: SyncSummary; pending: number; cacheDays: number }) {
  const cache = cacheDays === 0 ? text('headers only offline') : text('offline cache {n} days', { n: cacheDays });
  const tone = summary.tone;
  const icon = summary.state === 'offline' || tone === 'danger' || tone === 'warning' ? 'warning' : summary.state === 'syncing' ? 'refresh' : summary.state === 'paused' ? 'pause' : 'check';
  const headline = summary.state === 'offline' && pending ? text('Offline · {n} actions waiting', { n: pending }) : summary.headline;
  return (
    <span role="status" aria-live="polite" className="m-2 mt-0 flex items-start gap-2.5 rounded-[10px] border border-line bg-surface p-2.5 text-[12px] leading-snug hover:bg-subtle">
      <span className={cx('mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]', tone === 'danger' ? 'bg-danger-bg text-danger' : tone === 'warning' ? 'bg-warning-bg text-warning' : tone === 'success' ? 'bg-success-bg text-success' : 'bg-subtle text-ink-2')}>
        <Icon name={icon} size={14} className={summary.state === 'syncing' ? 'animate-spin motion-reduce:animate-none' : undefined} />
      </span>
      <span className="min-w-0">
        <span className={cx('block truncate font-semibold', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-ink')} title={headline}>
          {headline}
        </span>
        <span className="block truncate text-ink-3" title={summary.detail ? `${summary.detail} · ${cache}` : cache}>
          {summary.detail ? `${summary.detail} · ${cache}` : cache}
        </span>
      </span>
    </span>
  );
}

/** A new folder (in the mailbox named) or a new label. */
function NameDialog({ kind, mailbox, onClose }: { kind: 'folder' | 'label'; mailbox: Mailbox | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (kind === 'folder') await apiPost('/api/mail/folders-tree', { name: name.trim(), ...(mailbox ? { mailbox: mailbox.id } : {}) });
      else await apiPost('/api/mail/labels', { name: name.trim() });
      void qc.invalidateQueries({ queryKey: kind === 'folder' ? ['mail', 'folders'] : mailKeys.labels });
      toast('success', kind === 'folder' ? text('Folder created.') : text('Label created.'));
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={kind === 'folder' ? text('New folder') : text('New label')}
      labelledBy="mail-name-title"
      width={420}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            {text('Create')}
          </Button>
        </>
      }
    >
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <TextField label={text('Name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus hint={kind === 'folder' && mailbox ? text('In {email}', { email: mailbox.email }) : undefined} />
      </form>
    </Modal>
  );
}

/**
 * A folder's properties (ENH-MAIL-03 DMO-NAV-03, DMO-DAT-05, DMO-OFF-01):
 * what this computer keeps of it, and what the server keeps — the
 * organisation's copy and archive policy, which is what takes the place of
 * Outlook's AutoArchive.
 */
function FolderProperties({ box, slug, label, prefs, onClose }: { box: Mailbox; slug: string; label: string; prefs: Pick<Preferences, 'mailFolderOffline'> | null; onClose: () => void }) {
  const folders = useFolders(box.id, true);
  const f = (folders.data?.folders ?? []).find((x) => x.slug === slug) ?? null;
  const current = folderOffline(prefs ?? {}, String(box.id), slug);
  return (
    <Modal title={text('{folder} — properties', { folder: label })} labelledBy="mail-folder-props" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-3 p-4 text-[13px] text-ink">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-ink-3">{text('Account')}</dt>
          <dd>{box.email}</dd>
          {f ? (
            <>
              <dt className="text-ink-3">{text('Messages')}</dt>
              <dd>{f.total.toLocaleString()}</dd>
              <dt className="text-ink-3">{text('Unread')}</dt>
              <dd>{(f.unread ?? 0).toLocaleString()}</dd>
            </>
          ) : null}
        </dl>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 font-semibold">{text('On this computer')}</legend>
          {OFFLINE_CHOICES.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input type="radio" name="folder-offline" checked={current === c.id} onChange={() => setFolderOffline(prefs, box, slug, c.id)} />
              <span>
                {text(c.label)} <span className="text-ink-3">· {text(c.hint)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <section aria-label={text('On the server')}>
          <h3 className="mb-1 font-semibold">{text('On the server')}</h3>
          <p className="text-ink-2">
            {box.copy
              ? text('Your organisation keeps a copy of {what} on the WorkSuite server. Old mail is archived there by that policy — there is no AutoArchive on this computer.', { what: copyWords(box.copy.copy_mode, box.copy.window_months) })
              : text('Your organisation keeps no copy of this mailbox on the WorkSuite server; the mail provider’s own retention applies. There is no AutoArchive on this computer.')}
          </p>
        </section>
      </div>
    </Modal>
  );
}
