import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { app } from '../../core/app-state';
import { request } from '../../core/api';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { bytes, listStamp } from '../../core/time';
import { Icon } from '../../components/Icon';
import { ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import { EMPTY, GROUPS, TITLES, can, fileKey, folderKey, kindOf, type DriveFile, type DriveFolder, type DriveList, type Key, type View } from './api';
import { fileMenu, folderMenu, keyOf, useDrive, type Item } from './ctx';
import { Details } from './Details';
import { lockPassword } from './locks';
import { useMarquee } from './marquee';
import { PopMenu, below, type MenuItem } from './Menu';
import type { Place } from './Rail';
import { FileIcon, FolderIcon, Tile } from './Thumb';
import { UnlockPrompt } from './Dialogs';
import { Select } from '../../components/Select';

type Layout = 'list' | 'grid';
const LAYOUT_KEY = 'files.layout';
const DETAILS_KEY = 'files.details';

const SORTS: Array<[string, string]> = [
  ['modified:desc', 'Modified (newest)'],
  ['modified:asc', 'Modified (oldest)'],
  ['name:asc', 'Name (A–Z)'],
  ['name:desc', 'Name (Z–A)'],
  ['created:desc', 'Created (newest)'],
  ['size:desc', 'Size (largest)'],
  ['size:asc', 'Size (smallest)'],
  ['type:asc', 'Type'],
];
const TYPES: Array<[string, string]> = [
  ['', 'All types'],
  ['document', 'Documents'],
  ['spreadsheet', 'Spreadsheets'],
  ['presentation', 'Presentations'],
  ['pdf', 'PDFs'],
  ['image', 'Images'],
  ['video', 'Video'],
  ['audio', 'Audio'],
  ['archive', 'Archives'],
  ['code', 'Code'],
];

function stored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* a convenience only */
  }
}

interface Page {
  files: DriveFile[];
  folders: DriveFolder[];
  breadcrumb: Array<{ id: number; name: string }>;
  folder: DriveFolder | null;
  total: number;
  locked: boolean;
  offline: boolean;
  cachedAt: string | null;
}

/** A locked folder is read through `files/browse`, the one list that checks the password. */
async function lockedPage(id: number, pw: string, signal: AbortSignal): Promise<Page> {
  const r = await request<{ breadcrumb: Array<{ id: number; name: string }>; locked: boolean; folders: Array<Record<string, unknown>>; files: Array<Record<string, unknown>> }>('GET', '/api/files/browse', { query: { folder_id: id }, headers: { 'X-Folder-Password': pw }, signal });
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    locked: r.data.locked,
    breadcrumb: r.data.breadcrumb,
    folder: null,
    offline: r.offline,
    cachedAt: r.cachedAt,
    folders: r.data.folders.map((f) => ({ id: n(f.id), parent_id: f.parent_id ? n(f.parent_id) : null, name: String(f.name), description: (f.description as string) ?? null, path: (f.path as string) ?? null, color: (f.color as string) ?? null, is_archived: !!Number(f.is_archived), is_locked: !!f.is_locked, file_count: n(f.file_count), total_size: n(f.total_size), starred: false, access: (f.access as DriveFolder['access']) ?? null })),
    files: r.data.files.map((f) => ({ id: n(f.id), name: String(f.name), description: null, extension: (f.extension as string) ?? null, kind: kindOf(String(f.name), f.extension as string), mime_type: (f.mime_type as string) ?? null, size: n(f.size), folder_id: id, folder_name: '', folder_path: null, has_thumb: false, version: n(f.version), downloads: n(f.downloads_count), owner_id: null, owner_name: null, created_at: (f.created_at as string) ?? null, updated_at: (f.created_at as string) ?? null, opened_at: null, deleted_at: null, starred: !!f.is_favorite, access: (f.access as DriveFile['access']) ?? null })),
    total: r.data.files.length,
  };
}

/**
 * A folder, or a list across the Drive (Recent, Starred, Images, This week…):
 * DriveFolder and DriveGrid. List or grid; select with a click, Ctrl/⌘ and
 * Shift, or by dragging a rectangle over empty space (`marquee.ts`); the
 * selection bar acts on all of them; right-click for the menu;
 * drop files from Finder to upload, or drag rows onto a folder to move them.
 */
export function Explorer({ place, active, onPlace, ask, initialQ }: { place: Place; active: boolean; onPlace: (p: Place) => void; ask: { key: Key; tab?: string; n: number } | null; initialQ: string }) {
  const d = useDrive();
  const { query } = useTab();
  const me = useStore(app, (s) => Number(s.auth?.user?.id ?? 0));
  const [layout, setLayoutState] = useState<Layout>(() => stored(LAYOUT_KEY, 'list', ['list', 'grid'] as const));
  const [details, setDetailsState] = useState(() => stored(DETAILS_KEY, 'on', ['on', 'off'] as const) === 'on');
  const [q, setQ] = useState(initialQ);
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState('modified:desc');
  const [selected, setSelected] = useState<Set<Key>>(() => (query.get('file') ? new Set([fileKey(Number(query.get('file')))]) : new Set()));
  const [anchor, setAnchor] = useState<Key | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[]; label: string } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [unlockTick, setUnlockTick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const marquee = useMarquee(scroller, { selected, onChange: setSelected });
  const folderView = place.view === 'folder';
  const view = place.view;
  const [sortBy, dir] = sort.split(':') as [string, string];
  const group = GROUPS.find((g) => g.views.includes(view) && g.views.length > 1);

  const list = useInfiniteQuery({
    queryKey: ['files', 'list', view, place.folder, q.trim(), kind, sort, unlockTick],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }): Promise<Page> => {
      const pw = folderView && place.folder ? lockPassword(place.folder) : null;
      if (pw && place.folder) return lockedPage(place.folder, pw, signal);
      const r = await request<DriveList>('GET', '/api/drive/list', {
        query: { view: folderView ? undefined : view, folder_id: folderView ? place.folder : undefined, include_folders: folderView || view === 'starred' ? 1 : undefined, q: q.trim() || undefined, kind: kind || undefined, sort: sortBy, dir, page: pageParam, per_page: 100, counts: 0 },
        signal,
      });
      // Locked asks everybody, its owner too (as `files/browse` does).
      const locked = !!r.data.folder?.is_locked;
      return { files: locked ? [] : r.data.files, folders: locked ? [] : (r.data.folders ?? []), breadcrumb: r.data.breadcrumb ?? [], folder: r.data.folder ?? null, total: r.data.total, locked, offline: r.offline, cachedAt: r.cachedAt };
    },
    getNextPageParam: (last, pages) => (pages.reduce((n, p) => n + p.files.length, 0) < last.total && last.files.length ? pages.length + 1 : undefined),
    refetchInterval: 60_000,
  });
  const pages = list.data?.pages ?? [];
  const first = pages[0];
  const files = pages.flatMap((p) => p.files);
  const folders = first?.folders ?? [];
  const items: Item[] = [...folders.map((f) => ({ type: 'folder' as const, f })), ...files.map((f) => ({ type: 'file' as const, f }))];
  const byKey = new Map(items.map((i) => [keyOf(i), i] as const));
  const chosen = [...selected].map((k) => byKey.get(k)).filter((x): x is Item => !!x);
  const chosenFiles = chosen.filter((i): i is Extract<Item, { type: 'file' }> => i.type === 'file').map((i) => i.f);
  const folderAccess = first?.folder?.access ?? null;
  const mayAdd = folderView ? (place.folder === null ? true : can(folderAccess, 'add_files')) : false;
  const current = first?.folder ?? null;

  // A new place starts with nothing chosen (a link may name the file to show).
  const placeKey = `${view}:${place.folder}`;
  const [seenPlace, setSeenPlace] = useState(placeKey);
  if (seenPlace !== placeKey) {
    setSeenPlace(placeKey);
    setSelected(query.get('file') ? new Set([fileKey(Number(query.get('file')))]) : new Set());
    setQ(initialQ);
    setKind('');
  }

  // Asked to show one item's details (a menu's Versions, a new folder): choose it and open the panel.
  const [seenAsk, setSeenAsk] = useState(ask?.n ?? 0);
  const [detailsTab, setDetailsTab] = useState<string | undefined>(ask?.tab);
  if (ask && ask.n !== seenAsk) {
    setSeenAsk(ask.n);
    setSelected(new Set([ask.key]));
    setAnchor(ask.key);
    setDetailsTab(ask.tab);
    setDetailsState(true);
  }

  const setLayout = (l: Layout) => (setLayoutState(l), store(LAYOUT_KEY, l));
  const setDetails = (on: boolean) => (setDetailsState(on), store(DETAILS_KEY, on ? 'on' : 'off'));

  const pick = (item: Item, e: MouseEvent) => {
    const k = keyOf(item);
    if (e.shiftKey && anchor) {
      const keys = items.map(keyOf);
      const [a, b] = [keys.indexOf(anchor), keys.indexOf(k)].sort((x, y) => x - y) as [number, number];
      if (a >= 0) {
        setSelected(new Set(keys.slice(a, b + 1)));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      setSelected(next);
    } else setSelected(new Set([k]));
    setAnchor(k);
  };
  const toggle = (item: Item) => {
    const k = keyOf(item);
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
    setAnchor(k);
  };
  const menuFor = (item: Item): MenuItem[] => (item.type === 'file' ? fileMenu(item.f, d, files) : folderMenu(item.f, d));
  const openMenu = (item: Item, at: { x: number; y: number }) => {
    if (!selected.has(keyOf(item))) setSelected(new Set([keyOf(item)]));
    setMenu({ at, items: menuFor(item), label: `Actions — ${item.f.name}` });
  };
  const spaceMenu = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-row]')) return;
    e.preventDefault();
    const items: MenuItem[] = [
      ...(mayAdd ? [{ label: 'New folder', hint: '⇧⌘N', icon: 'folder-plus', run: d.newFolder }, { label: 'Upload files…', icon: 'upload', run: d.upload }, { sep: true } as const] : []),
      { label: 'Select all', hint: '⌘A', icon: 'check', run: () => setSelected(new Set(items_())) },
      { label: 'Refresh', icon: 'refresh', run: d.refresh },
    ];
    setMenu({ at: { x: e.clientX, y: e.clientY }, items, label: 'Folder' });
  };
  const items_ = () => items.map(keyOf);

  // Keys, while Files is in front and nothing is typed into or asked.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) {
        if (e.key === 'Escape' && t.getAttribute('aria-label')?.startsWith('Search')) (t as HTMLInputElement).blur();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const one = chosen.length === 1 ? chosen[0]! : null;
      if (mod && e.key.toLowerCase() === 'a') setSelected(new Set(items_()));
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'n' && mayAdd) d.newFolder();
      else if (e.key === 'Escape') setSelected(new Set());
      else if ((e.key === 'Delete' || (e.key === 'Backspace' && mod)) && chosen.length) d.trash(chosen.filter((i) => can(i.f.access, 'delete')));
      else if (e.key === 'F2' && one && can(one.f.access, 'rename')) d.rename(one);
      else if (e.key === 'Enter' && one) d.open(one, files);
      else if (e.key === ' ' && one?.type === 'file') d.preview(files, files.indexOf(one.f));
      else if (e.key === 'Backspace' && folderView && place.folder) onPlace({ view: 'folder', folder: first?.breadcrumb.at(-2)?.id ?? null });
      else if (e.key === '/') document.querySelector<HTMLInputElement>('input[aria-label="Search files and folders"]')?.focus();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const keys = items_();
        const at = anchor ? keys.indexOf(anchor) : -1;
        const next = keys[Math.max(0, Math.min(keys.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) {
          setSelected(new Set([next]));
          setAnchor(next);
          document.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Dragging rows: onto a folder moves them.
  const dragStart = (item: Item, e: DragEvent) => {
    const keys = selected.has(keyOf(item)) ? [...selected] : [keyOf(item)];
    e.dataTransfer.setData('application/x-ws-drive', JSON.stringify(keys));
    e.dataTransfer.effectAllowed = 'move';
  };
  const dropOn = (folder: DriveFolder) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-ws-drive') && !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(folder.id);
    },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(null);
      setDropping(false);
      d.drop(e, folder.id);
    },
  });

  const title = folderView ? (current?.name ?? (place.folder ? (first?.breadcrumb.at(-1)?.name ?? 'Folder') : 'My Drive')) : TITLES[view];
  const selectedSize = chosenFiles.reduce((n, f) => n + f.size, 0);
  const one = chosen.length === 1 ? chosen[0]! : null;
  const showDetails = details && !!one;
  const locked = !!first?.locked;
  const owner = (f: DriveFile) => (f.owner_id && f.owner_id === me ? 'Me' : (f.owner_name ?? '—'));

  return (
    <div className="flex min-w-0 flex-1">
      <main
        aria-label={title}
        onContextMenu={spaceMenu}
        onDragOver={(e) => {
          if (mayAdd && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDropping(false);
          d.drop(e, place.folder);
        }}
        className="relative flex min-w-0 flex-1 flex-col bg-surface"
      >
        <div className="flex flex-col gap-3 px-6 pt-4 pb-2.5">
          {folderView ? (
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2">
              {place.folder ? (
                <button type="button" onClick={() => onPlace({ view: 'folder', folder: null })} className="shrink-0 hover:text-ink hover:underline">My Drive</button>
              ) : null}
              {(first?.breadcrumb ?? []).slice(0, -1).map((b) => (
                <span key={b.id} className="flex min-w-0 items-center gap-1.5">
                  <span>›</span>
                  <button type="button" onClick={() => onPlace({ view: 'folder', folder: b.id })} className="truncate hover:text-ink hover:underline">{b.name}</button>
                </span>
              ))}
              {place.folder ? <span>›</span> : null}
              <button
                type="button"
                aria-haspopup={current ? 'menu' : undefined}
                onClick={(e) => current && setMenu({ at: below(e.currentTarget), items: folderMenu(current, d), label: `Actions — ${current.name}` })}
                className="flex h-7 min-w-0 items-center gap-1 rounded-[7px] bg-ground px-2 text-[15px] font-bold text-ink"
              >
                <span className="truncate">{title}</span>
                {current ? <Icon name="chevron-down" size={13} /> : null}
              </button>
              {current?.is_locked ? <span className="ml-1.5 flex items-center gap-1 rounded-xl bg-warning-bg px-2 py-0.5 text-[11.5px] font-bold text-warning"><Icon name="lock" size={11} /> Password locked</span> : null}
              <span className="flex-1" />
              {folderAccess && !folderAccess.owner ? <span className="shrink-0 text-[12px] text-ink-3">Shared with you · {folderAccess.level === 'full' ? 'Full access' : folderAccess.level === 'edit' ? 'Can edit' : 'Can view'}</span> : null}
              {mayAdd ? (
                <>
                  <button type="button" onClick={d.newFolder} className="h-9 shrink-0 rounded-[8px] border border-line bg-surface px-3 font-semibold whitespace-nowrap text-ink hover:bg-subtle">New folder</button>
                  <button type="button" onClick={d.upload} className="h-9 shrink-0 rounded-[8px] bg-primary px-3.5 font-bold whitespace-nowrap text-white hover:bg-primary-hover">Upload</button>
                </>
              ) : null}
            </nav>
          ) : (
            <div className="flex items-center gap-4">
              <h1 className="text-[20px] font-bold text-ink">{group ? TITLES[view] : title}</h1>
              {view === 'my_shares' ? (
                <span role="tablist" className="flex rounded-[9px] bg-subtle p-[3px] text-[12.5px] font-semibold">
                  <button type="button" role="tab" aria-selected="false" onClick={() => onPlace({ view: 'shared', folder: null })} className="px-3 py-1 text-ink-2 hover:text-ink">Shared with me</button>
                  <span role="tab" aria-selected="true" className="rounded-[7px] bg-surface px-3 py-1 text-ink shadow-sm">Shared by me</span>
                </span>
              ) : null}
            </div>
          )}
          {group ? (
            <div role="tablist" aria-label={group.label} className="flex flex-wrap gap-1.5">
              {group.views.map((v) => (
                <button key={v} type="button" role="tab" aria-selected={v === view} onClick={() => onPlace({ view: v as View, folder: null })} className={cx('h-7 rounded-[14px] px-3 text-[12px] font-semibold', v === view ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}>
                  {TITLES[v as View]}
                </button>
              ))}
            </div>
          ) : null}
          <div role="toolbar" aria-label="Explorer" className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <label className="flex h-9 w-[280px] min-w-[180px] shrink items-center gap-2 rounded-[8px] border border-line px-2.5 text-ink-3 focus-within:border-primary">
              <Icon name="search" size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search files and folders" placeholder={folderView ? (place.folder ? 'Search in this folder' : 'Search your Drive') : `Search ${TITLES[view].toLowerCase()}`} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none bare-focus" />
            </label>
            {folderView || view === 'recent' || view === 'starred' || view === 'my_shares' || view === 'large' || ['today', 'yesterday', 'week', 'month'].includes(view) ? (
              <Select aria-label="Filter by file type" value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-ink">
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            ) : null}
            <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-ink">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <span className="flex overflow-hidden rounded-[8px] border border-line">
              {(
                [
                  ['list', 'List view', 'list'],
                  ['grid', 'Grid view', 'grid'],
                ] as const
              ).map(([k, l, icon]) => (
                <button key={k} type="button" aria-label={l} title={l} aria-pressed={layout === k} onClick={() => setLayout(k)} className={cx('flex h-[34px] w-9 items-center justify-center', layout === k ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
                  <Icon name={icon} size={16} />
                </button>
              ))}
            </span>
            <button type="button" aria-label="Refresh" title="Refresh" onClick={d.refresh} className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
              <Icon name="refresh" size={15} />
            </button>
            <button type="button" aria-label="Details" title="Details" aria-pressed={details} onClick={() => setDetails(!details)} className={cx('flex h-9 w-9 items-center justify-center rounded-[8px] border border-line', details ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
              <Icon name="panel-open" size={15} />
            </button>
            {list.data?.pages[0]?.offline ? <OfflineNote cachedAt={list.data.pages[0].cachedAt} /> : null}
          </div>
        </div>
        {chosen.length > 1 || (chosen.length === 1 && layout === 'list' && !details) ? (
          <SelectionBar items={chosen} size={selectedSize} onClear={() => setSelected(new Set())} />
        ) : null}
        <div ref={scroller} data-files-space onMouseDown={marquee.onMouseDown} className="relative min-h-0 flex-1 overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : null}
          {list.error && !list.data ? <div className="px-6"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : null}
          {locked && place.folder ? <UnlockPrompt folderId={place.folder} name={title} onUnlocked={() => setUnlockTick((n) => n + 1)} /> : null}
          {list.isSuccess && !locked && !items.length ? (
            <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-selection text-primary"><Icon name={folderView ? 'folder-open' : 'search'} size={24} /></span>
              <b className="text-[14px] text-ink">{q.trim() ? `Nothing matches “${q.trim()}”.` : folderView ? 'This folder is empty' : 'Nothing here'}</b>
              <span className="text-[12.5px] text-ink-3">{q.trim() ? 'Try other words, or another type.' : folderView ? (mayAdd ? 'Drop files here from Finder, or use Upload.' : 'Nothing has been put here yet.') : (EMPTY[view] ?? '')}</span>
            </div>
          ) : null}
          {items.length && layout === 'list' ? (
            <div role="table" aria-label="Files" className="text-[13px]">
              <div role="row" className="sticky top-0 z-[1] grid grid-cols-[36px_minmax(0,2.6fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_40px] items-center border-y border-line bg-ground px-6 py-[7px] text-[11px] font-bold tracking-[0.4px] text-ink-2">
                <span>
                  <input type="checkbox" aria-label="Select all" checked={items.length > 0 && selected.size === items.length} onChange={(e) => setSelected(e.target.checked ? new Set(items_()) : new Set())} className="h-4 w-4 accent-[var(--color-primary)]" />
                </span>
                <span role="columnheader">NAME</span>
                <span role="columnheader">{folderView ? 'OWNER' : 'LOCATION'}</span>
                <span role="columnheader">MODIFIED</span>
                <span role="columnheader">SIZE</span>
                <span />
              </div>
              {items.map((item) => {
                const k = keyOf(item);
                const on = selected.has(k);
                const isFolder = item.type === 'folder';
                return (
                  <div
                    key={k}
                    role="row"
                    data-row={k}
                    aria-selected={on}
                    draggable
                    onDragStart={(e) => dragStart(item, e)}
                    onClick={(e) => pick(item, e)}
                    onDoubleClick={() => d.open(item, files)}
                    onContextMenu={(e) => (e.preventDefault(), e.stopPropagation(), openMenu(item, { x: e.clientX, y: e.clientY }))}
                    {...(isFolder ? dropOn(item.f) : {})}
                    className={cx('grid cursor-default grid-cols-[36px_minmax(0,2.6fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_40px] items-center border-b border-line/70 px-6 py-1.5 select-none', on ? 'bg-selection' : 'hover:bg-ground', isFolder && dragOver === item.f.id && 'outline-2 -outline-offset-2 outline-primary')}
                  >
                    <span onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${item.f.name}`} checked={on} onChange={() => toggle(item)} className="h-4 w-4 accent-[var(--color-primary)]" />
                    </span>
                    <span role="cell" className="flex min-w-0 items-center gap-2.5">
                      {isFolder ? <FolderIcon color={item.f.color} locked={item.f.is_locked} /> : <FileIcon f={item.f} />}
                      <span className="truncate font-semibold text-ink">{item.f.name}</span>
                      {item.f.starred ? <Icon name="star" size={13} label="Starred" className="shrink-0 fill-current text-[#E9A23B]" /> : null}
                      {isFolder && item.f.is_locked ? <span className="shrink-0 rounded-[5px] bg-warning-bg px-1.5 py-0.5 text-[10.5px] font-bold text-warning">Locked</span> : null}
                    </span>
                    <span role="cell" className="truncate pr-2 text-ink-2">{isFolder ? (item.f.owner_name ?? (item.f.access?.owner ? 'Me' : '—')) : folderView ? owner(item.f) : item.f.folder_path || item.f.folder_name}</span>
                    <span role="cell" className="text-ink-2">{isFolder ? `${item.f.file_count.toLocaleString()} ${item.f.file_count === 1 ? 'file' : 'files'}` : listStamp(item.f.updated_at ?? item.f.created_at)}</span>
                    <span role="cell" className="font-mono text-[12px] text-ink-2">{isFolder ? (item.f.total_size ? bytes(item.f.total_size) : '—') : bytes(item.f.size)}</span>
                    <button type="button" aria-label={`More actions for ${item.f.name}`} onClick={(e) => (e.stopPropagation(), openMenu(item, below(e.currentTarget, 'right')))} className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] text-[16px] font-bold text-ink-2 hover:bg-subtle">⋯</button>
                  </div>
                );
              })}
            </div>
          ) : null}
          {items.length && layout === 'grid' ? (
            <div className="flex flex-col gap-3 px-5 pb-5">
              {folders.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
                  {folders.map((f) => {
                    const item: Item = { type: 'folder', f };
                    const on = selected.has(folderKey(f.id));
                    return (
                      <button key={f.id} type="button" data-row={folderKey(f.id)} draggable onDragStart={(e) => dragStart(item, e)} onClick={(e) => pick(item, e)} onDoubleClick={() => d.open(item)} onContextMenu={(e) => (e.preventDefault(), e.stopPropagation(), openMenu(item, { x: e.clientX, y: e.clientY }))} {...dropOn(f)} className={cx('flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left', on ? 'border-primary bg-selection' : 'border-line bg-surface hover:bg-ground', dragOver === f.id && 'ring-2 ring-primary')}>
                        <FolderIcon color={f.color} locked={f.is_locked} size={28} />
                        <span className="flex min-w-0 flex-col">
                          <b className="truncate text-[13px] text-ink">{f.name}</b>
                          <span className="text-[11px] text-ink-3">{f.file_count.toLocaleString()} files{f.total_size ? ` · ${bytes(f.total_size)}` : ''}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
                {files.map((f) => {
                  const item: Item = { type: 'file', f };
                  const on = selected.has(fileKey(f.id));
                  return (
                    <button key={f.id} type="button" data-row={fileKey(f.id)} draggable onDragStart={(e) => dragStart(item, e)} onClick={(e) => pick(item, e)} onDoubleClick={() => d.open(item, files)} onContextMenu={(e) => (e.preventDefault(), e.stopPropagation(), openMenu(item, { x: e.clientX, y: e.clientY }))} className={cx('flex flex-col overflow-hidden rounded-[11px] bg-surface text-left', on ? 'border-2 border-primary' : 'border border-line hover:border-ink-3')}>
                      <span className="relative block w-full">
                        <Tile f={f} />
                        {f.starred ? <span className="absolute top-[7px] right-[7px] flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[#E9A23B] shadow"><Icon name="star" size={11} className="fill-current" /></span> : null}
                      </span>
                      <span className="flex flex-col gap-0.5 px-2.5 py-2">
                        <span className="truncate text-[12.5px] font-semibold text-ink">{f.name}</span>
                        <span className="text-[11px] text-ink-3">{(f.extension ?? '').toUpperCase() || 'File'} · {bytes(f.size)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {marquee.rect ? (
            <div
              aria-hidden
              data-marquee
              className="pointer-events-none absolute z-20 rounded-[3px] border border-primary bg-primary/10"
              style={{ left: marquee.rect.left, top: marquee.rect.top, width: marquee.rect.right - marquee.rect.left, height: marquee.rect.bottom - marquee.rect.top }}
            />
          ) : null}
          {list.hasNextPage ? (
            <div className="flex justify-center py-4">
              <button type="button" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
                {list.isFetchingNextPage ? 'Loading…' : `Show more (${(first!.total - files.length).toLocaleString()} left)`}
              </button>
            </div>
          ) : null}
        </div>
        {items.length ? (
          <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line px-6 text-[11.5px] text-ink-3">
            <span>{folders.length ? `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'} · ` : ''}{first?.total.toLocaleString()} {first?.total === 1 ? 'file' : 'files'}</span>
            {chosen.length ? <span>{chosen.length} selected{selectedSize ? ` · ${bytes(selectedSize)}` : ''}</span> : null}
          </div>
        ) : null}
        {dropping ? (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-[14px] border-2 border-dashed border-primary bg-selection/70 text-[15px] font-bold text-primary">
            Drop to upload to {title}
          </div>
        ) : null}
      </main>
      {showDetails && one ? <Details key={`${keyOf(one)}:${seenAsk}`} item={one} list={files} tab={detailsTab as Parameters<typeof Details>[0]['tab']} onClose={() => setDetails(false)} /> : null}
      {menu ? <PopMenu at={menu.at} items={menu.items} label={menu.label} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

/** The dark bar over a selection: what can be done to all of it. */
function SelectionBar({ items, size, onClear }: { items: Item[]; size: number; onClear: () => void }) {
  const d = useDrive();
  const files = items.filter((i): i is Extract<Item, { type: 'file' }> => i.type === 'file').map((i) => i.f);
  const all = (cap: string) => items.every((i) => can(i.f.access, cap));
  const one = items.length === 1 ? items[0]! : null;
  const btn = 'flex h-[30px] items-center rounded-[7px] px-2.5 text-white hover:bg-white/10';
  return (
    <div role="toolbar" aria-label="Selection" className="mx-6 mb-2 flex h-[42px] shrink-0 items-center gap-1 rounded-[10px] bg-[#0F1B3D] pr-2 pl-3.5 text-[12.5px] font-semibold text-white">
      <span className="mr-2.5">{items.length} selected{size ? ` · ${bytes(size)}` : ''}</span>
      {one && can(one.f.access, 'share') ? <button type="button" className={btn} onClick={() => d.share(one)}>Share…</button> : null}
      {all('move') ? <button type="button" className={btn} onClick={() => d.move(items, 'move')}>Move…</button> : null}
      {files.length === items.length && all('download') ? <button type="button" className={btn} onClick={() => d.move(items, 'copy')}>Copy to…</button> : null}
      {files.length && files.every((f) => can(f.access, 'download')) ? <button type="button" className={btn} onClick={() => d.download(files)}>Download</button> : null}
      {files.length > 1 && files.length === items.length && all('download') ? <button type="button" className={btn} onClick={() => d.zip(files)}>Zip</button> : null}
      {one && can(one.f.access, 'chat_share') ? <button type="button" className={btn} onClick={() => d.sendToChat(one)}>Send to Chat…</button> : null}
      {all('delete') ? <button type="button" className={cx(btn, 'text-[#FFB4A3]')} onClick={() => d.trash(items)}>Move to trash</button> : null}
      <span className="flex-1" />
      <button type="button" onClick={onClear} className="h-[30px] rounded-[7px] border border-[#33477E] px-2.5 text-white hover:bg-white/10">Clear</button>
    </div>
  );
}
