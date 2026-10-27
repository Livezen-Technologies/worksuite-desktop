import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { errorMessage, isMac } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { bytes } from '../../core/time';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { PrimaryActionButton, SidebarIconButton } from '../../components/PrimaryAction';
import { GROUPS, pathTo, splitKeys, type Counts, type Key, type TreeNode, type View } from './api';
import { useDrive } from './ctx';
import { PopMenu, below, type MenuAt, type MenuItem } from './Menu';
import { foldersHeadMenu, quickLinkMenu, railFolderMenu, type QuickLink } from './railMenu';
import { canDropInto, childrenOf, dropZone, findNode, folderCaps, folderKind, renameProblem, reorderIds, siblingsOf, sortTree, treeKey, visibleRows, type DropZone, type RailOrder, type RailRow, type RailSort } from './railTree';
import { useSync, useSyncAvailable } from './sync';

export type Place = { view: View; folder: number | null };

const row = (on: boolean, depth = 0) => cx('group relative flex h-7 w-full shrink-0 items-center gap-[9px] rounded-[8px] pr-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary', on ? 'bg-selection font-bold text-primary' : 'font-medium text-ink hover:bg-subtle', depth === 0 ? 'pl-2.5' : '');
const bar = (on: boolean) => cx('absolute top-[7px] bottom-[7px] left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent');
const badge = (on: boolean) => cx('flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-semibold tabular-nums', on ? 'bg-surface text-primary' : 'bg-subtle text-ink-2');
const more = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 opacity-0 hover:bg-surface hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100';

/** Drag types: rows from a list or the rail, and their names and folders (worksuite-desktop#328). */
const DRIVE = 'application/x-ws-drive';
const ABOUT = 'application/x-ws-drive-about';
/** A folder dragged within the rail: it may be put beside another, as well as into it. */
const RAIL = 'application/x-ws-rail';
/** Hovering a closed folder this long while dragging opens it. */
export const HOVER_OPEN_MS = 1000;

const TREE_KEY = 'files.tree-open';
const ORDER_KEY = 'files.rail-order';
function storedOpen(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(TREE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}
function storedOrder(): RailOrder {
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '{}') as Partial<RailOrder>;
    return { sort: v.sort === 'name' || v.sort === 'modified' ? v.sort : 'manual', starredFirst: v.starredFirst === true };
  } catch {
    return { sort: 'manual', starredFirst: false };
  }
}
function keep(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a convenience only */
  }
}

type Menu = { at: MenuAt; items: MenuItem[]; label: string; head?: ReactNode; width?: number; back?: number };

/**
 * The Drive rail (DriveRail): New and Upload; the places; your folders as a
 * tree you can drop onto; find by type or date; tidying up; settings; and
 * how much space is used.
 *
 * The folders are a tree (worksuite-desktop#328): each has the folder menu on
 * right-click, on its ⋯ and on ⇧F10 — the same actions as a folder row in the
 * list, filtered by what the caller may do — and can be renamed in place,
 * dragged to reorder or nest, and dropped onto (rows from the list move, ⌥
 * copies; files from Finder upload). The arrow keys walk it.
 */
export function Rail({
  place, counts, tree, used, quota, ancestors, onPlace, newItems, onUpload, onDrop, canPartners,
}: {
  place: Place;
  counts: Counts | undefined;
  tree: TreeNode[];
  used: number;
  quota: number | null;
  ancestors: number[];
  onPlace: (p: Place) => void;
  newItems: MenuItem[];
  onUpload: () => void;
  onDrop: (e: DragEvent, folder: number | null) => void;
  canPartners: boolean;
}) {
  const d = useDrive();
  const [shut, setShut] = useState<Record<string, boolean>>({ set: true });
  const [openIds, setOpenIds] = useState<number[]>(storedOpen);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [over, setOver] = useState<{ id: number | 'root'; zone: DropZone } | null>(null);
  const [order, setOrder] = useState<RailOrder>(storedOrder);
  const [renaming, setRenaming] = useState<{ id: number; value: string; error: string | null; busy: boolean } | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);
  const dragging = useRef<number | null>(null);
  const hover = useRef<{ id: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const isOn = (v: View) => place.view === v && (v !== 'folder' || place.folder === null);
  const expanded = new Set([...openIds, ...ancestors]);
  const sorted = sortTree(tree, order);
  const rows = visibleRows(sorted, expanded);
  const sync = useSync();
  const syncOn = useSyncAvailable();
  // The folder to tab into: the one being looked at, else the first.
  const current = rows.find((r) => r.id === focusId)?.id ?? rows.find((r) => place.view === 'folder' && r.id === place.folder)?.id ?? rows[0]?.id ?? null;

  const setOpen = (next: number[]) => {
    setOpenIds(next);
    keep(TREE_KEY, next.slice(-400));
  };
  const toggleOpen = (id: number) => setOpen(expanded.has(id) ? openIds.filter((x) => x !== id && !ancestors.includes(x)) : [...openIds, id]);
  const expand = (id: number) => !expanded.has(id) && setOpen([...openIds, id]);
  const saveOrder = (next: RailOrder) => {
    setOrder(next);
    keep(ORDER_KEY, next);
  };

  // Keyboard focus follows the tree's own idea of where it is.
  useEffect(() => {
    if (!wantFocus.current || focusId === null) return;
    wantFocus.current = false;
    treeRef.current?.querySelector<HTMLElement>(`[data-folder="${focusId}"]`)?.focus();
  }, [focusId, rows.length]);
  useEffect(() => () => clearTimeout(hover.current?.timer), []);
  const focusRow = (id: number) => {
    wantFocus.current = true;
    setFocusId(id);
    // Already the focused id: focus it now, as no render follows.
    if (id === focusId) treeRef.current?.querySelector<HTMLElement>(`[data-folder="${id}"]`)?.focus();
  };

  /* ---- Menus ---- */

  const kept = (n: TreeNode) => {
    const roots = (sync?.folders ?? []).map((f) => f.folderId);
    if (!syncOn || !roots.length) return false;
    const above = pathTo(tree, n.id) ?? [];
    return roots.some((r) => r === null || r === n.id || above.includes(r));
  };
  const folderItems = (n: TreeNode) => railFolderMenu(n, d, { syncAvailable: syncOn, synced: kept(n), docs: !d.officeRouting.legacy }, { rename: startRename });
  const openFolderMenu = (n: TreeNode, at: MenuAt, back?: number) => setMenu({ at, items: folderItems(n), label: `Actions — ${n.name}`, back });
  const closeMenu = () => {
    const back = menu?.back;
    setMenu(null);
    if (back !== undefined) focusRow(back);
  };

  /* ---- Rename in place ---- */

  // Which rename is open, read synchronously: focusing the row again blurs the field before React re-renders,
  // and that blur must not save what Esc just threw away.
  const editing = useRef<number | null>(null);
  function startRename(n: TreeNode) {
    if (!folderCaps(n).has('rename')) return;
    editing.current = n.id;
    setFocusId(n.id);
    setRenaming({ id: n.id, value: n.name, error: null, busy: false });
  }
  const finishRename = async (save: boolean) => {
    const r = renaming;
    if (!r || r.busy || editing.current !== r.id) return;
    const n = findNode(tree, r.id);
    const name = r.value.trim();
    const close = () => {
      editing.current = null;
      setRenaming(null);
      focusRow(r.id);
    };
    if (!n || !save || name === n.name) return close();
    const problem = renameProblem(name, siblingsOf(tree, n.id), n.id);
    if (problem) return setRenaming({ ...r, error: problem });
    setRenaming({ ...r, busy: true, error: null });
    try {
      await d.renameTo({ type: 'folder', f: n }, name);
      close();
    } catch (e) {
      setRenaming({ ...r, busy: false, error: errorMessage(e) });
    }
  };

  /* ---- The keyboard ---- */

  const onTreeKey = (e: KeyboardEvent) => {
    if (renaming || e.target !== e.currentTarget.ownerDocument.activeElement || !(e.target as HTMLElement).dataset.folder) return;
    const move = treeKey(rows, current, e, isMac);
    if (!move) return;
    e.preventDefault();
    e.stopPropagation();
    const n = findNode(tree, move.id);
    if (move.kind === 'focus') focusRow(move.id);
    else if (move.kind === 'expand' || move.kind === 'collapse') toggleOpen(move.id);
    else if (move.kind === 'open') onPlace({ view: 'folder', folder: move.id });
    else if (move.kind === 'rename' && n) startRename(n);
    else if (move.kind === 'bin' && n && folderKind(n) !== 'shared' && folderCaps(n).has('delete')) d.trash([{ type: 'folder', f: n }]);
    else if (move.kind === 'menu' && n) {
      const el = treeRef.current?.querySelector<HTMLElement>(`[data-folder="${n.id}"]`);
      if (el) openFolderMenu(n, below(el), n.id);
    }
  };

  /* ---- Dragging and dropping ---- */

  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRIVE) || e.dataTransfer.types.includes('Files');
  const stopHover = () => {
    clearTimeout(hover.current?.timer);
    hover.current = null;
  };
  const dragStart = (n: TreeNode, e: DragEvent) => {
    const key: Key = `d:${n.id}`;
    dragging.current = n.id;
    e.dataTransfer.setData(DRIVE, JSON.stringify([key]));
    e.dataTransfer.setData(ABOUT, JSON.stringify({ [key]: { name: n.name, parent: n.parent_id } }));
    e.dataTransfer.setData(RAIL, String(n.id));
    e.dataTransfer.effectAllowed = 'copyMove';
  };
  const dragEnd = () => {
    dragging.current = null;
    stopHover();
    setOver(null);
  };
  const rowDrop = (r: RailRow) => ({
    onDragOver: (e: DragEvent) => {
      if (!accepts(e)) return;
      const rail = dragging.current;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      // Beside another folder only when dragging a folder of the rail, in your own order.
      const zone = rail !== null ? dropZone(e.clientY - rect.top, rect.height, order.sort === 'manual') : 'inside';
      const into = zone === 'inside' ? r.id : r.parent;
      if (rail !== null && (rail === r.id || !canDropInto(tree, [rail], into))) {
        setOver(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') || e.altKey ? 'copy' : 'move';
      if (over?.id !== r.id || over.zone !== zone) setOver({ id: r.id, zone });
      // A closed folder opens after a second's hover, to drop deeper.
      if (zone === 'inside' && r.hasChildren && !r.expanded) {
        if (hover.current?.id !== r.id) {
          stopHover();
          hover.current = { id: r.id, timer: setTimeout(() => (expand(r.id), (hover.current = null)), HOVER_OPEN_MS) };
        }
      } else stopHover();
    },
    onDragLeave: (e: DragEvent) => {
      if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
      stopHover();
      setOver((o) => (o?.id === r.id ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const zone = over?.id === r.id ? over.zone : 'inside';
      dragEnd();
      const rail = Number(e.dataTransfer.getData(RAIL)) || null;
      const n = rail !== null ? findNode(tree, rail) : null;
      if (n && zone !== 'inside') {
        // Put beside another: into its folder if it was elsewhere, then in that place among them.
        if (!canDropInto(tree, [n.id], r.parent)) return;
        const ids = reorderIds(childrenOf(sorted, r.parent).map((x) => x.id), n.id, r.id, zone);
        d.reorder(ids, n.parent_id !== r.parent ? { folder: n, parent: r.parent } : undefined);
        return;
      }
      if (n && n.parent_id === r.id && !e.altKey) return;
      // Rows from the list: never a folder into itself or anything inside it.
      const raw = e.dataTransfer.getData(DRIVE);
      if (raw) {
        try {
          const { folders } = splitKeys(JSON.parse(raw) as Key[]);
          if (!canDropInto(tree, folders, r.id)) return void toast('error', 'A folder can’t go inside itself or a folder within it.');
        } catch {
          return;
        }
      }
      onDrop(e, r.id);
    },
  });
  const rootDrop = {
    onDragOver: (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') || e.altKey ? 'copy' : 'move';
      if (over?.id !== 'root') setOver({ id: 'root', zone: 'inside' });
    },
    onDragLeave: (e: DragEvent) => {
      if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
      setOver((o) => (o?.id === 'root' ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const rail = Number(e.dataTransfer.getData(RAIL)) || null;
      const n = rail !== null ? findNode(tree, rail) : null;
      dragEnd();
      if (n && n.parent_id === null && !e.altKey) return;
      if (n?.is_system) return;
      onDrop(e, null);
    },
  };

  /* ---- Drawing ---- */

  const head = (key: string, label: string, count: number, extra?: { menu: (at: MenuAt) => void }) => {
    const toggle = (
      <button
        type="button"
        aria-expanded={!shut[key]}
        onClick={() => setShut({ ...shut, [key]: !shut[key] })}
        onContextMenu={extra ? (e) => (e.preventDefault(), extra.menu({ x: e.clientX, y: e.clientY })) : undefined}
        className={cx('flex h-6 shrink-0 items-center gap-1.5 pr-1.5 pl-2 text-left text-[11px] font-bold tracking-[0.3px] text-ink-3', extra ? 'min-w-0 flex-1' : 'mt-1.5')}
      >
        <span className="flex-1">{label}</span>
        {shut[key] ? <span className="flex h-4 min-w-[18px] items-center justify-center rounded-lg bg-subtle px-[5px] text-[10.5px]">{count}</span> : null}
        <Icon name="chevron-down" size={13} className={cx('shrink-0 transition-transform', shut[key] && '-rotate-90')} />
      </button>
    );
    if (!extra) return toggle;
    return (
      <div className="group mt-1.5 flex shrink-0 items-center">
        {toggle}
        <button type="button" aria-label={`${label} options`} aria-haspopup="menu" onClick={(e) => extra.menu(below(e.currentTarget, 'right', 260))} className={more}>
          <Icon name="more" size={13} />
        </button>
      </div>
    );
  };

  const item = (v: View, label: string, icon: string, count?: number, tint?: string): ReactNode => {
    const on = isOn(v);
    const quick = (at: MenuAt) => {
      const items = quickLinkMenu(v as QuickLink, d, {
        open: () => onPlace({ view: v, folder: null }),
        storage: () => onPlace({ view: 'storage', folder: null }),
        openIn: (where) => d.openPlaceIn({ view: v, folder: null }, where),
      });
      if (items) setMenu({ at, items, label });
    };
    const hasMenu = ['folder', 'recent', 'starred', 'shared', 'my_shares'].includes(v);
    return (
      <button
        key={v}
        type="button"
        aria-current={on ? 'page' : undefined}
        title={label}
        onClick={() => onPlace({ view: v, folder: null })}
        onContextMenu={hasMenu ? (e) => (e.preventDefault(), quick({ x: e.clientX, y: e.clientY })) : undefined}
        className={row(on)}
        {...(v === 'folder' ? rootDrop : {})}
      >
        <span className={bar(on)} />
        <Icon name={icon} size={16} className={cx('w-[18px] shrink-0', on ? 'text-primary' : (tint ?? 'text-ink-2'))} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count ? <span className={badge(on)}>{count.toLocaleString()}</span> : null}
        {v === 'folder' && over?.id === 'root' ? <span className="absolute inset-0 rounded-[8px] ring-2 ring-primary" /> : null}
      </button>
    );
  };

  const folderRow = (r: RailRow): ReactNode => {
    const n = r.node;
    const on = place.view === 'folder' && place.folder === n.id;
    const edit = renaming?.id === n.id ? renaming : null;
    const system = !!n.is_system;
    const zone = over?.id === n.id ? over.zone : null;
    const errorId = `rail-rename-${n.id}`;
    return (
      <div
        key={n.id}
        role="treeitem"
        data-folder={n.id}
        aria-level={r.depth + 1}
        aria-setsize={r.size}
        aria-posinset={r.pos}
        aria-expanded={r.hasChildren ? r.expanded : undefined}
        aria-selected={on}
        aria-current={on ? 'page' : undefined}
        aria-label={n.name}
        tabIndex={current === n.id ? 0 : -1}
        title={system ? `${n.path ?? n.name} · ${n.system_by ?? 'Created by WorkSuite'}` : (n.path ?? n.name)}
        draggable={!edit && !system}
        onFocus={(e) => e.target === e.currentTarget && setFocusId(n.id)}
        onClick={() => !edit && (setFocusId(n.id), onPlace({ view: 'folder', folder: n.id }))}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setFocusId(n.id);
          openFolderMenu(n, { x: e.clientX, y: e.clientY }, n.id);
        }}
        onDragStart={(e) => dragStart(n, e)}
        onDragEnd={dragEnd}
        {...rowDrop(r)}
        className={cx(row(on, r.depth), 'cursor-default')}
        style={{ paddingLeft: 4 + r.depth * 18 }}
      >
        <span className={bar(on)} />
        <span
          role="presentation"
          onClick={(e) => {
            e.stopPropagation();
            if (r.hasChildren) toggleOpen(n.id);
          }}
          className="flex w-3.5 shrink-0 justify-center text-ink-3"
        >
          {r.hasChildren ? <Icon name={r.expanded ? 'chevron-down' : 'chevron-right'} size={12} /> : null}
        </span>
        <span className="flex w-[18px] shrink-0 justify-center" style={{ color: n.color ?? '#0E7C86' }}>
          <Icon name={n.is_locked ? 'lock' : 'folder'} size={16} strokeWidth={1.9} />
        </span>
        {edit ? (
          <input
            autoFocus
            aria-label={`Rename “${n.name}”`}
            aria-invalid={!!edit.error}
            aria-describedby={edit.error ? errorId : undefined}
            value={edit.value}
            disabled={edit.busy}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenaming({ ...edit, value: e.target.value, error: null })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                void finishRename(true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                void finishRename(false);
              }
            }}
            onBlur={() => void finishRename(!edit.error)}
            className={cx('h-6 min-w-0 flex-1 rounded-[5px] border bg-surface px-1.5 text-[13px] font-medium text-ink outline-none', edit.error ? 'border-danger' : 'border-primary')}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{n.name}</span>
        )}
        {system ? (
          <span role="img" aria-label={n.system_by ?? 'Created by WorkSuite'} title={n.system_by ?? 'Created by WorkSuite'} className="flex shrink-0 text-ink-3">
            <Icon name="lock" size={11} />
          </span>
        ) : null}
        {n.pinned && !edit ? <Icon name="pin" size={11} aria-label="Pinned" className="shrink-0 text-ink-3" /> : null}
        {n.starred && !edit ? <Icon name="star" size={11} className="shrink-0 fill-current text-stage-amber" /> : null}
        {!edit ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`More actions for ${n.name}`}
            aria-haspopup="menu"
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              setFocusId(n.id);
              openFolderMenu(n, below(e.currentTarget, 'left', 280), n.id);
            }}
            className={more}
          >
            <Icon name="more" size={13} />
          </button>
        ) : null}
        {zone === 'inside' ? <span className="pointer-events-none absolute inset-0 rounded-[8px] ring-2 ring-primary" /> : null}
        {zone === 'before' ? <span data-drop="before" className="pointer-events-none absolute -top-px right-1 left-1 h-0.5 rounded bg-primary" /> : null}
        {zone === 'after' ? <span data-drop="after" className="pointer-events-none absolute right-1 -bottom-px left-1 h-0.5 rounded bg-primary" /> : null}
        {edit?.error ? (
          <span id={errorId} role="alert" className="absolute top-full right-1 left-6 z-10 mt-0.5 rounded-[6px] bg-danger px-2 py-1 text-[11.5px] font-medium text-white shadow">
            {edit.error}
          </span>
        ) : null}
      </div>
    );
  };

  const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const syncLine = syncOn && sync?.folders.length ? syncSummary(sync) : null;
  const foldersMenu = (at: MenuAt) =>
    setMenu({
      at,
      label: 'Folders',
      items: foldersHeadMenu(d, order, {
        sort: (sort: RailSort) => saveOrder({ ...order, sort }),
        starredFirst: (starredFirst) => saveOrder({ ...order, starredFirst }),
        collapseAll: () => setOpen([]),
      }),
    });

  return (
    <nav aria-label="Drive" className="flex w-[240px] shrink-0 flex-col border-r border-line bg-surface text-[13px]">
      <div className="flex gap-1.5 px-3 pt-3 pb-2">
        <PrimaryActionButton label="New" hint="New file, folder or document" onMenu={(el) => setMenu({ at: below(el, 'left', 300), items: newItems, label: 'New', width: 300, head: <div className="px-2.5 py-2 text-[11px] font-bold tracking-[0.6px] text-ink-2">NEW</div> })} className="flex-1" />
        <SidebarIconButton icon="upload" label="Upload files" onClick={onUpload} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-0.5 pb-1.5 scroll-thin">
        {item('home', 'Home', 'home')}
        {item('folder', 'My Drive', 'folder', counts?.files)}
        {item('recent', 'Recent', 'clock', counts?.recent)}
        {item('starred', 'Starred', 'star', counts?.starred)}
        {item('shared', 'Shared with me', 'users', counts?.shared_new)}
        {item('my_shares', 'Shared by me', 'send')}
        {head('fold', 'Folders', tree.length, { menu: foldersMenu })}
        {!shut.fold ? (
          tree.length ? (
            <div ref={treeRef} role="tree" aria-label="Folders" onKeyDown={onTreeKey} className="flex flex-col">
              {rows.map(folderRow)}
            </div>
          ) : (
            <span className="px-2.5 py-1 text-[12px] text-ink-3">No folders yet.</span>
          )
        ) : null}
        {head('find', 'Filters', GROUPS.length)}
        {!shut.find
          ? GROUPS.map((g) => {
              const on = g.views.includes(place.view);
              return (
                <button key={g.id} type="button" aria-current={on ? 'page' : undefined} title={g.hint ?? g.label} onClick={() => onPlace({ view: g.views[0]!, folder: null })} className={row(on)}>
                  <span className={bar(on)} />
                  <Icon name={g.icon} size={16} className={cx('w-[18px] shrink-0', on ? 'text-primary' : 'text-ink-2')} />
                  <span className="min-w-0 flex-1 truncate">{g.label}</span>
                </button>
              );
            })
          : null}
        {head('tidy', 'Tidy up', 4)}
        {!shut.tidy ? (
          <>
            {item('duplicates', 'Duplicates', 'copy')}
            {item('large', 'Large files', 'weight')}
            {item('storage', 'Storage', 'disk')}
            {item('trash', 'Recycle bin', 'trash', counts?.trash)}
          </>
        ) : null}
        {head('set', 'Settings', (canPartners ? 4 : 3) + (syncOn ? 1 : 0))}
        {!shut.set ? (
          <>
            {item('settings', 'Drive settings', 'settings')}
            {syncOn ? item('devices', 'Sync devices', 'laptop') : null}
            {item('links', 'Secure links', 'link')}
            {item('notifications', 'Drive notifications', 'bell')}
            {canPartners ? item('companies', 'Sharing between companies', 'building') : null}
          </>
        ) : null}
      </div>
      <div className="mx-2.5 mb-2.5 flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3 py-2.5">
        <div className="flex items-baseline gap-1.5">
          <b className="text-[13px] whitespace-nowrap text-ink">{bytes(used)}</b>
          <span className="min-w-0 flex-1 text-[12px] text-ink-2">{quota ? `of ${bytes(quota)} used` : 'used'}</span>
          <button type="button" onClick={() => onPlace({ view: 'storage', folder: null })} className="text-[11.5px] font-bold text-primary hover:underline">Manage</button>
        </div>
        {quota ? (
          <div role="meter" aria-label="Storage used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="flex h-1.5 overflow-hidden rounded-[3px] bg-subtle">
            <span className={cx('h-1.5 rounded-[3px]', pct > 90 ? 'bg-danger' : 'bg-primary')} style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        {syncLine ? (
          <button type="button" onClick={() => onPlace({ view: 'devices', folder: null })} className="flex items-start gap-1.5 text-left text-[12px] leading-[1.35] text-ink-2 hover:text-ink">
            <Icon name={syncLine.icon} size={13} className={cx('mt-px shrink-0', syncLine.tone)} />
            <span className="min-w-0 flex-1">{syncLine.text}</span>
          </button>
        ) : null}
      </div>
      {menu ? <PopMenu at={menu.at} items={menu.items} label={menu.label} width={menu.width} head={menu.head} onClose={closeMenu} /> : null}
    </nav>
  );
}

/** The line under the storage meter: what sync on this computer is doing. */
function syncSummary(s: NonNullable<ReturnType<typeof useSync>>): { icon: string; tone: string; text: string } {
  const pending = s.folders.reduce((n, f) => n + f.pending.up + f.pending.down, 0);
  const n = s.folders.length;
  const folders = `${n} ${n === 1 ? 'folder' : 'folders'}`;
  if (s.state === 'syncing') return { icon: 'refresh', tone: 'text-primary', text: pending ? `Syncing ${pending.toLocaleString()} ${pending === 1 ? 'item' : 'items'}` : 'Syncing…' };
  if (s.state === 'paused') return { icon: 'pause', tone: 'text-ink-3', text: `Sync paused · ${folders}` };
  if (s.state === 'offline') return { icon: 'cloud-off', tone: 'text-ink-3', text: 'Waiting for the server' };
  if (s.state === 'error' || s.state === 'disconnected' || s.state === 'blocked' || s.folders.some((f) => f.heldDeletions)) return { icon: 'warning', tone: 'text-warning', text: 'Sync needs attention' };
  return { icon: 'check-circle', tone: 'text-success', text: `Up to date · ${folders} on this computer` };
}
