import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { appRoute, navApps, type AppDefinition } from '@shared/apps';
import {
  ALL_CATEGORY,
  addGroup,
  categoryOf,
  FADE_PX,
  footerNarrow,
  FULL_COLUMN,
  FULL_GRID,
  FULL_SEARCH,
  FULL_SIDEBAR,
  GRID_PAD,
  LAUNCHER_PARTS,
  launcherLayout,
  launcherSections,
  launcherView,
  moveToGroup,
  movePinned,
  noteUse,
  OTHER_GROUP,
  pinApp,
  reorderApps,
  scrollFades,
  sectionStep,
  setHidden,
  unpinApp,
  visibleArea,
  PIN_MAX,
  type LauncherPrefs,
  type Rect,
  type WindowSize,
} from '@shared/launcher';
import { app } from '../../core/app-state';
import { useFeature } from '../../core/desktop-settings';
import { appColour } from '../../core/app-look';
import { call, isMac } from '../../core/bridge';
import { prettyAccelerator } from '../../core/commands';
import { appLabel } from '../../core/i18n';
import { syncLauncherPrefsIfStale, updateLauncherPrefs, useLauncherPrefs } from '../../core/launcher-prefs';
import { noteRecentApp, readRecentApps } from '../../core/recent-apps';
import { pinSidebarItem, useSidebarPinnedKeys } from '../../core/sidebar-prefs';
import { useStore } from '../../core/store';
import { activeTab, navigate, openTab, setRoute } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { closeOverlay, openOverlay } from '../../core/ui';
import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';

/**
 * App launcher (AppLauncher, §4.3, FR-NAV-02; redesigned in worksuite-desktop#201, laid out again in worksuite-desktop#206):
 * find an app, the ones pinned and used lately, and every app the person may open, by category, as tiles.
 *
 * Three shapes, as the person chooses in Settings › App launcher (core/launcher-prefs, synced between their devices):
 *  - a popover, `min(880px, 100vw - 48px)` wide, centred on the window and 12% down it, over a dimmed and blurred
 *    app. Its height is the fixed parts plus whole rows of tiles, never a row cut through; only the grid scrolls,
 *    with a fade at the bottom while there is more;
 *  - full screen: the window below the top bar (never over the traffic lights or the window buttons), the app's
 *    dark, in one centred column at most 1160px wide: the search with its settings and close beside it, Pinned and
 *    Recent in one row, the categories in a sidebar on the left with their counts (or as chips above the apps, as
 *    the person chooses, and always where the window is too narrow for a sidebar), and the apps as larger tiles,
 *    each category under its sticky heading with its count and a rule; the grid takes what the column has left,
 *    and the footer runs along the window's bottom;
 *  - a bottom sheet in a window narrower than 480px.
 * Geometry is `launcherLayout` (shared/launcher), worked out again whenever the window is resized or moved.
 * One background, `--launcher-bg`, under the grid, the headings, the scroll fades and the footer, and one soft
 * hairline, `--launcher-line` (worksuite-desktop#233). The grid fades to that background at the top and the bottom,
 * each only while there is more past that edge, within the column.
 *
 * Typing searches at once (names and keywords, hidden apps too); the arrow keys move over the grid, Enter opens,
 * ⌘Enter opens in a new window, Esc closes, as does a click outside. Right-click a tile, or drag it, to pin it, hide
 * it, move it to a group of one's own or open it in a new window. Apps the person may not open are never here
 * (`app.apps` is through the gates). It fades and scales in and out over 120ms, not at all for reduced motion.
 */

const DRAG_TYPE = 'application/x-worksuite-app';
/** How long the launcher takes to close: its fade out. */
export const LAUNCHER_CLOSE_MS = 120;

interface WindowArea {
  win: WindowSize;
  /** The part of the window the person can see: not under the Dock or a taskbar. */
  area: Rect;
}

function readWindowArea(): WindowArea {
  return { win: { width: window.innerWidth, height: window.innerHeight }, area: visibleArea(window, window.screen as unknown as Parameters<typeof visibleArea>[1]) };
}

const sameArea = (a: WindowArea, b: WindowArea) =>
  a.win.width === b.win.width && a.win.height === b.win.height && a.area.left === b.area.left && a.area.top === b.area.top && a.area.width === b.area.width && a.area.height === b.area.height;

/** The window's size and its visible part, kept current while the launcher is open, as the window is resized or moved. */
function useWindowArea(): WindowArea {
  const [now, setNow] = useState<WindowArea>(readWindowArea);
  useEffect(() => {
    const on = () =>
      setNow((prev) => {
        const next = readWindowArea();
        return sameArea(prev, next) ? prev : next;
      });
    window.addEventListener('resize', on);
    // A window dragged under the Dock moves without resizing: look again now and then while open.
    const t = setInterval(on, 1000);
    return () => {
      window.removeEventListener('resize', on);
      clearInterval(t);
    };
  }, []);
  return now;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Whether the person asked for reduced motion; the launcher then opens and closes without moving. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(REDUCED_MOTION);
    const on = () => setReduced(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

type OpenHow = 'window' | 'new-tab' | 'current-tab';

export function Launcher() {
  const apps = useStore(app, (s) => s.apps);
  const searchOn = useFeature('launcherSearch');
  const sidebarPins = useSidebarPinnedKeys();
  const status = useStore(app, (s) => s.status);
  const userId = useStore(app, (s) => s.auth?.user?.id ?? null);
  const prefs = useLauncherPrefs();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string>(ALL_CATEGORY);
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [fades, setFades] = useState<{ top: boolean; bottom: boolean }>({ top: false, bottom: false });
  const [measuredColumns, setMeasuredColumns] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [recentIds] = useState(() => readRecentApps(userId));
  const { win, area } = useWindowArea();
  const reduced = useReducedMotion();
  const sidebarHeading = useId();
  // Full screen's Pinned and Recent share a row; once Recent wraps under Pinned, the rule between them goes.
  const recentGroup = useRef<HTMLDivElement>(null);
  const [recentWrapped, setRecentWrapped] = useState(false);

  useEffect(() => syncLauncherPrefsIfStale(), []);
  // Closing: gone once it has faded out. Unmounted sooner (another overlay opened), nothing is closed.
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => closeOverlay(), LAUNCHER_CLOSE_MS);
    return () => clearTimeout(t);
  }, [closing]);

  // A channel is in its host (WhatsApp, in Chat: #35), not an app of its own here.
  const all = useMemo(() => navApps(apps).filter((a) => a.id !== 'home'), [apps]);
  const view = launcherView({ apps: all, prefs, query, category: cat, label: appLabel });
  const list = view.tiles;
  const searching = query.trim() !== '';
  const recent = prefs.toggles.recent
    ? recentIds
        .map((r) => all.find((a) => a.id === r.id))
        .filter((a): a is AppDefinition => !!a)
        .slice(0, 6)
    : [];
  const showPinned = !searching && (view.pinned.length > 0 || !!dragging);
  const showRecent = !searching && recent.length > 0;
  const hasChips = view.categories.length > 1;
  const layout = launcherLayout(win, area, prefs, { pinned: showPinned, recent: showRecent, chips: hasChips });
  const sheet = layout.kind === 'sheet';
  const full = layout.kind === 'fullscreen';
  // Under All apps, with nothing searched, full screen and the sheet read category by category, each under its name;
  // with the categories in the sidebar, one category is under its name too, as the sidebar says which it is.
  const sections = launcherSections(view, prefs, !searching && hasChips && layout.kind !== 'popover' && (view.current === ALL_CATEGORY || layout.sidebar));
  // The columns the grid really has, when the browser says (a scrollbar can take one); else as worked out.
  const columns = measuredColumns ?? layout.columns;
  const selected = Math.min(sel, Math.max(0, list.length - 1));

  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  /** Which scroll fades to draw: each only while there is more past that edge. */
  const updateFades = () => {
    const next = scrollFades(grid.current);
    setFades((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
  };

  // Whenever what is listed or the launcher's size changes: how many columns, and is there more above or below?
  useLayoutEffect(() => {
    const el = grid.current;
    const g = el?.querySelector<HTMLElement>('[data-grid]');
    const tpl = g ? getComputedStyle(g).gridTemplateColumns : '';
    const n = tpl && !tpl.includes('(') ? tpl.trim().split(/\s+/).length : 0;
    setMeasuredColumns(n > 0 ? n : null);
    updateFades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length, cat, query, layout.kind, layout.width, layout.height, layout.rowHeight, showPinned, showRecent, measuredColumns, !!dragging]);

  useLayoutEffect(() => {
    const el = recentGroup.current;
    const first = el?.parentElement?.firstElementChild as HTMLElement | null | undefined;
    setRecentWrapped(!!el && !!first && first !== el && el.offsetTop > first.offsetTop);
  }, [layout.width, showPinned, showRecent, view.pinned.length, recent.length, searching]);

  // The scroller or what is in it changes size without a render (fonts, images, the window): look again.
  useEffect(() => {
    const el = grid.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => updateFades());
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [list.length, cat, query, layout.kind]);

  /** Closes with the launcher's fade out; at once for reduced motion. */
  const dismiss = () => {
    if (reduced) {
      closeOverlay();
      return;
    }
    setClosing(true);
  };

  const badge = (a: AppDefinition): number => (prefs.toggles.badges && status && a.badge ? (status.unread[a.badge] ?? 0) : 0);

  const open = (a: AppDefinition, how: OpenHow = prefs.openIn) => {
    closeOverlay();
    noteRecentApp(userId, a.id);
    updateLauncherPrefs((p) => noteUse(p, a.id));
    if (a.surface === 'browser') {
      void call('app:openInBrowser', { path: a.webPath });
      return;
    }
    const route = appRoute(a);
    if (how === 'window') {
      void call('windows:open', { kind: 'record', route, title: a.label });
      return;
    }
    if (how === 'current-tab') {
      const t = activeTab();
      if (t && !t.pinned) setRoute(t.id, route);
      else navigate(route);
      return;
    }
    openTab(route);
  };

  const change = (fn: (p: LauncherPrefs) => LauncherPrefs | null, refused?: string) => {
    if (!updateLauncherPrefs(fn) && refused) toast('info', refused);
  };
  const togglePin = (a: AppDefinition) =>
    prefs.pinned.includes(a.id) ? change((p) => unpinApp(p, a.id)) : change((p) => pinApp(p, a.id), `You can pin up to ${PIN_MAX} apps. Unpin one first.`);
  const toggleHidden = (a: AppDefinition) => change((p) => setHidden(p, a.id, !p.hidden.includes(a.id)));
  const toGroup = (a: AppDefinition, group: string | null) => change((p) => ({ ...moveToGroup(p, a.id, group), groupBy: 'mine' }));
  const toNewGroup = (a: AppDefinition, name: string) =>
    change((p) => {
      const made = addGroup(p, name);
      return made ? { ...moveToGroup(made.prefs, a.id, made.id), groupBy: 'mine' } : null;
    }, 'That group could not be made.');
  const toggleSidebarPin = (a: AppDefinition) => void pinSidebarItem(a.id, !sidebarPins.includes(a.id));

  /** Settings › App launcher: the settings button by the search, and Customise in the footer. */
  const customise = () => {
    closeOverlay();
    navigate('/settings/launcher');
  };

  const onKey = (e: React.KeyboardEvent) => {
    const inInput = e.target === input.current;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (menu) setMenu(null);
      else dismiss();
    } else if (e.key.startsWith('Arrow') || (!inInput && (e.key === 'Home' || e.key === 'End'))) {
      if (menu) return;
      e.preventDefault();
      setSel(
        sectionStep(
          selected,
          e.key,
          sections.map((s) => s.items.length),
          columns,
        ),
      );
    } else if (e.key === 'Enter') {
      if (menu || (e.target instanceof HTMLElement && e.target.closest('[role="menu"]'))) return;
      e.preventDefault();
      const a = list[selected];
      if (a) open(a, (isMac ? e.metaKey : e.ctrlKey) ? 'window' : undefined);
      else if (searching) openOverlay('search', query.trim());
    } else if (e.key === 'Tab' && view.categories.length > 1 && !menu) {
      e.preventDefault();
      const i = view.categories.findIndex((c) => c.id === view.current);
      setCat(view.categories[(i + (e.shiftKey ? view.categories.length - 1 : 1)) % view.categories.length]!.id);
      setSel(0);
    } else if (!inInput && !menu && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Typing anywhere in the launcher searches (where launcher search is on).
      if (searchOn) input.current?.focus();
    }
  };

  // ── dragging a tile ─────────────────────────────────────────────────
  const dragProps = (a: AppDefinition) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, a.id);
      e.dataTransfer.setData('text/plain', appLabel(a));
      e.dataTransfer.effectAllowed = 'move';
      setDragging(a.id);
      setMenu(null);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
  });
  const dropZone = (key: string, onDrop: (id: string) => void) => ({
    'data-drop': key,
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== key) setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.dataTransfer.getData(DRAG_TYPE) || dragging;
      setDragging(null);
      setOver(null);
      if (id) onDrop(id);
    },
  });
  const byId = (id: string) => all.find((a) => a.id === id);
  const dropOnTile = (target: AppDefinition) => (id: string) =>
    change((p) => {
      let next = reorderApps(p, list.map((a) => a.id), id, target.id);
      // Onto an app in another of one's own groups: into that group.
      if (p.groupBy === 'mine') {
        const g = categoryOf(target, p);
        next = moveToGroup(next, id, g === OTHER_GROUP ? null : g);
      }
      return next;
    });
  const dropOnPinned = (before: string | null) => (id: string) =>
    change((p) => {
      const withIt = pinApp(p, id);
      if (!withIt) return null;
      return before ? movePinned(withIt, withIt.pinned.indexOf(id), withIt.pinned.indexOf(before)) : withIt;
    }, `You can pin up to ${PIN_MAX} apps. Unpin one first.`);
  const dropOnCategory = (c: string) => (id: string) => {
    if (prefs.groupBy !== 'mine' || c === ALL_CATEGORY) return;
    change((p) => moveToGroup(p, id, c === OTHER_GROUP ? null : c));
  };

  const menuApp = menu ? byId(menu.id) : undefined;
  const draggedApp = dragging ? byId(dragging) : undefined;
  const shortcut = prettyAccelerator(prefs.shortcut);
  const names = prefs.toggles.names;
  const padX = sheet ? 'px-2' : full ? 'px-0' : 'px-3.5';

  const tile = (a: AppDefinition, i: number) => {
    const n = badge(a);
    const web = a.surface === 'browser';
    const name = appLabel(a);
    const sel = i === selected;
    return (
      <button
        key={a.id}
        type="button"
        role="option"
        data-index={i}
        aria-selected={sel}
        aria-label={name}
        tabIndex={-1}
        // The whole name, however much of it the tile shows.
        title={web ? `${name} · Opens in your browser` : name}
        onMouseEnter={() => setSel(i)}
        onClick={() => open(a)}
        onContextMenu={(e) => {
          e.preventDefault();
          setSel(i);
          setMenu({ id: a.id, x: e.clientX, y: e.clientY });
        }}
        {...dragProps(a)}
        {...dropZone(`tile:${a.id}`, dropOnTile(a))}
        style={{ height: layout.rowHeight }}
        className={cx(
          'relative flex min-w-0 flex-col items-center overflow-hidden text-ink outline-none',
          full ? 'gap-2.5 rounded-[14px] border border-transparent px-2' : 'gap-1.5 rounded-[12px] px-1',
          full ? (names ? 'pt-3.5 pb-3' : 'py-3.5') : names ? 'pt-2.5 pb-2' : 'py-2.5',
          sel ? 'bg-selection shadow-[inset_0_0_0_2px_var(--color-primary)]' : full ? 'hover:border-launcher-line hover:bg-subtle' : 'hover:bg-subtle',
          over === `tile:${a.id}` && dragging !== a.id && 'shadow-[inset_3px_0_0_var(--color-primary)]',
          dragging === a.id && 'opacity-40',
        )}
      >
        <span className="relative shrink-0">
          <AppTile icon={a.icon} colour={appColour(a.id)} size={layout.icon} radius={Math.round(layout.icon * 0.27)} iconSize={Math.round(layout.icon * 0.45)} />
          {n > 0 ? (
            <span data-badge className="absolute -top-1.5 -right-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-surface bg-badge px-[5px] text-[10px] font-bold text-white">
              {n > 99 ? '99+' : n}
            </span>
          ) : null}
          {web && prefs.toggles.browserMark ? (
            <span title="Opens in your browser" className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-[5px] bg-surface text-ink-3 shadow-[0_0_0_1px_var(--ws-edge)]">
              <Icon name="external" size={10} />
            </span>
          ) : null}
        </span>
        <span data-name className={cx('block max-w-full truncate font-medium', full ? 'text-[14px] leading-[18px]' : 'text-[12px] leading-4', !names && 'sr-only')}>
          {name}
        </span>
      </button>
    );
  };

  const chipRow = (label: string, items: AppDefinition[], opts: { pinned?: boolean } = {}) => (
    <div
      style={{ height: LAUNCHER_PARTS.row }}
      className={cx('flex min-w-0 shrink-0 items-start gap-1.5 overflow-x-auto scroll-thin', padX, full && 'justify-center')}
      {...(opts.pinned ? dropZone('pinned', dropOnPinned(null)) : {})}
    >
      <span className="mr-1 flex h-8 shrink-0 items-center text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{label}</span>
      {items.map((a) => (
        <button
          key={a.id}
          type="button"
          aria-label={`Open ${appLabel(a)}`}
          title={appLabel(a)}
          onClick={() => open(a)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ id: a.id, x: e.clientX, y: e.clientY });
          }}
          {...dragProps(a)}
          {...(opts.pinned ? dropZone(`pin:${a.id}`, dropOnPinned(a.id)) : {})}
          className={cx('flex h-8 max-w-[180px] shrink-0 items-center gap-1.5 rounded-[9px] border border-line bg-surface pr-2.5 pl-1 text-[12px] font-semibold text-ink hover:bg-subtle', over === `pin:${a.id}` && 'border-primary')}
        >
          <AppTile icon={a.icon} colour={appColour(a.id)} size={24} radius={7} iconSize={14} />
          <span className="min-w-0 truncate">{appLabel(a)}</span>
        </button>
      ))}
      {opts.pinned && dragging && !items.some((a) => a.id === dragging) ? (
        <span className={cx('flex h-8 shrink-0 items-center rounded-[9px] border border-dashed px-2.5 text-[12px] text-ink-3', over === 'pinned' ? 'border-primary text-primary' : 'border-line')}>Drop here to pin</span>
      ) : null}
    </div>
  );

  /** Full screen's chip: the app's name after a dot in its colour, 44px tall (worksuite-desktop launcher design). */
  const fullChip = (a: AppDefinition, opts: { pinned?: boolean } = {}) => (
    <button
      key={a.id}
      type="button"
      aria-label={`Open ${appLabel(a)}`}
      title={appLabel(a)}
      onClick={() => open(a)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ id: a.id, x: e.clientX, y: e.clientY });
      }}
      {...dragProps(a)}
      {...(opts.pinned ? dropZone(`pin:${a.id}`, dropOnPinned(a.id)) : {})}
      className={cx(
        'flex h-11 max-w-[200px] shrink-0 items-center gap-2 rounded-[10px] border px-3.5 text-[14px] hover:bg-subtle',
        opts.pinned ? 'border-launcher-line bg-surface text-ink' : 'border-launcher-line text-ink-2 hover:text-ink',
        over === `pin:${a.id}` && 'border-primary',
      )}
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-[3px] bg-[color-mix(in_srgb,var(--dot)_55%,white)]" style={{ '--dot': appColour(a.id) } as CSSProperties} />
      <span className="min-w-0 truncate">{appLabel(a)}</span>
    </button>
  );
  const rowLabel = (label: string) => <span className="me-0.5 shrink-0 text-[12px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{label}</span>;
  // Full screen: Pinned and Recent in one row, a rule between them, wrapping onto a second line rather than scrolling.
  const recentsRow =
    showPinned || showRecent ? (
      <div data-recents style={{ minHeight: LAUNCHER_PARTS.fullRow }} className="flex shrink-0 flex-wrap content-start items-center gap-x-2.5 gap-y-2 pb-6">
        {showPinned ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2" {...dropZone('pinned', dropOnPinned(null))}>
            {rowLabel('Pinned')}
            {view.pinned.map((a) => fullChip(a, { pinned: true }))}
            {dragging && !view.pinned.some((a) => a.id === dragging) ? (
              <span className={cx('flex h-11 shrink-0 items-center rounded-[10px] border border-dashed px-3.5 text-[13px] text-ink-3', over === 'pinned' ? 'border-primary text-primary' : 'border-launcher-line')}>Drop here to pin</span>
            ) : null}
          </div>
        ) : null}
        {showPinned && showRecent ? <span aria-hidden data-rule className={cx('mx-1.5 h-6 w-px shrink-0 bg-launcher-line', recentWrapped && 'hidden')} /> : null}
        {showRecent ? (
          <div ref={recentGroup} className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            {rowLabel('Recent')}
            {recent.map((a) => fullChip(a))}
          </div>
        ) : null}
      </div>
    ) : null;

  // Full screen's categories in a sidebar: a list on the left with each one's count, the one shown filled in.
  const sidebar = layout.sidebar ? (
    // Its heading on the same line as the first category's heading beside it.
    <nav
      aria-labelledby={sidebarHeading}
      data-sidebar
      className="flex shrink-0 flex-col overflow-y-auto pb-6 scroll-thin"
      style={{ width: FULL_SIDEBAR.width, paddingTop: FULL_GRID.headingMargin + FULL_GRID.headingPad }}
    >
      <h2 id={sidebarHeading} className="mb-2 px-3 text-[12px] leading-4 font-semibold tracking-[0.08em] text-ink-3 uppercase">
        Categories
      </h2>
      <div role="tablist" aria-orientation="vertical" aria-labelledby={sidebarHeading} className="flex flex-col gap-1">
        {view.categories.map((c) => {
          const on = c.id === view.current;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={on}
              title={c.label}
              onClick={() => (setCat(c.id), setSel(0))}
              {...dropZone(`cat:${c.id}`, dropOnCategory(c.id))}
              className={cx(
                'flex h-11 w-full shrink-0 items-center gap-2 rounded-[10px] border px-3 text-start text-[14px] font-medium',
                on ? 'border-primary bg-primary text-white' : 'border-transparent text-ink-2 hover:border-launcher-line hover:text-ink',
                over === `cat:${c.id}` && prefs.groupBy === 'mine' && c.id !== ALL_CATEGORY && 'ring-2 ring-primary',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              <span className="shrink-0 text-[12px] opacity-75">{c.count}</span>
            </button>
          );
        })}
      </div>
    </nav>
  ) : null;

  const chips = hasChips ? (
    <div role="tablist" aria-label="Categories" style={{ height: LAUNCHER_PARTS.chips }} className={cx('flex shrink-0 items-start gap-1.5 overflow-x-auto scroll-thin', padX, full && 'justify-center')}>
      {view.categories.map((c) => {
        const on = c.id === view.current;
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={on}
            title={c.label}
            onClick={() => (setCat(c.id), setSel(0))}
            {...dropZone(`cat:${c.id}`, dropOnCategory(c.id))}
            className={cx(
              'flex h-[30px] max-w-[200px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold',
              on ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2 hover:text-ink',
              over === `cat:${c.id}` && prefs.groupBy === 'mine' && c.id !== ALL_CATEGORY && 'ring-2 ring-primary',
            )}
          >
            <span className="min-w-0 truncate">{c.label}</span>
            <span className="text-[11px] opacity-75">{c.count}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  const gridStyle: CSSProperties = {
    gridTemplateColumns: layout.fixedColumns ? `repeat(${layout.fixedColumns}, minmax(0, 1fr))` : `repeat(auto-fill, minmax(${layout.tileMin}px, 1fr))`,
    gap: layout.gap,
  };
  const empty = (
    <div className="col-span-full flex flex-col items-center gap-2 py-14 text-center">
      <b className="text-[14px] text-ink">No apps match that search.</b>
      <button type="button" onClick={() => openOverlay('search', query.trim())} className="text-[12.5px] font-semibold text-primary hover:underline">
        Search WorkSuite for “{query.trim()}”
      </button>
    </div>
  );

  // Category headings: 24px above each name, 8px below it, sticky while its section scrolls by (worksuite-desktop#233).
  const headed = sections.some((s) => s.label);
  const stuck = headed ? LAUNCHER_PARTS.heading : 0;
  // The grid's scroller: whole rows in the popover; in full screen and the sheet, what the launcher has left, so the
  // footer stays at the bottom.
  const scrollerStyle: CSSProperties | undefined = sheet
    ? { scrollPaddingTop: stuck, scrollPaddingBottom: FADE_PX }
    : full
      ? { paddingTop: headed ? 0 : GRID_PAD.top, paddingBottom: FULL_GRID.bottom, scrollPaddingTop: stuck + GRID_PAD.top, scrollPaddingBottom: FADE_PX }
      : { paddingTop: GRID_PAD.top, paddingBottom: GRID_PAD.bottom, paddingLeft: GRID_PAD.x, paddingRight: GRID_PAD.x, scrollPaddingTop: GRID_PAD.top, scrollPaddingBottom: FADE_PX };
  const fade = (edge: 'top' | 'bottom') => (
    <div
      aria-hidden
      data-fade={edge}
      className={cx('pointer-events-none absolute inset-x-0 z-[2]', edge === 'bottom' && 'bottom-0')}
      // Under a stuck heading at the top; to the launcher's own background, so never darker than what is under it.
      style={{ height: FADE_PX, top: edge === 'top' ? stuck : undefined, background: `linear-gradient(to ${edge}, transparent, var(--launcher-bg))` }}
    />
  );

  const body = (
    <div data-grid-area className={cx('relative min-h-0', sheet || full ? 'min-w-0 flex-1' : 'shrink-0')} style={layout.grid ? { height: layout.grid.height } : undefined}>
      <div
        ref={grid}
        role="listbox"
        aria-label="Apps"
        onScroll={updateFades}
        className={cx('h-full overflow-y-auto overscroll-contain scroll-thin', sheet && 'px-2 pb-3')}
        style={scrollerStyle}
      >
        {sections.map((s) => (
          <div key={s.id} role="presentation">
            {s.label ? (
              <div
                data-heading
                style={{ marginTop: FULL_GRID.headingMargin, paddingTop: FULL_GRID.headingPad, paddingBottom: FULL_GRID.headingPad }}
                className={cx('sticky top-0 z-[1] flex items-center bg-launcher font-semibold tracking-[0.08em] text-ink-3 uppercase', full ? 'gap-3 text-[12px] leading-4' : 'px-2 text-[11px] leading-4')}
              >
                <span data-heading-label className="truncate">
                  {s.label}
                </span>
                {full ? (
                  <>
                    <span data-heading-count className="shrink-0 font-normal tracking-normal">
                      {s.items.length}
                    </span>
                    <span aria-hidden className="h-px min-w-6 flex-1 bg-launcher-line" />
                  </>
                ) : null}
              </div>
            ) : null}
            <div role="presentation" data-grid className="grid" style={gridStyle}>
              {s.items.map(({ app: a, index }) => tile(a, index))}
            </div>
          </div>
        ))}
        {!list.length ? searching ? empty : <div className="py-14 text-center text-[13px] text-ink-3">Every app is hidden. Search finds them, or show them again in Customise.</div> : null}
      </div>
      {fades.top ? fade('top') : null}
      {fades.bottom ? fade('bottom') : null}
    </div>
  );

  // The footer's keys, or only the count and Esc when it is narrow (worksuite-desktop#233). ⌘↵ (Ctrl+↵ off the Mac)
  // is the launcher's own: it opens the app in a new window.
  const footerWidth = full ? Math.min(layout.column?.width ?? layout.width, layout.width) - 2 * FULL_COLUMN.padSide : layout.width;
  const narrow = footerNarrow(footerWidth, sheet);
  const count = `${list.length} ${list.length === 1 ? 'app' : 'apps'}`;
  const hints = (
    <>
      {count} · <Key k="↑" />
      <Key k="↓" />
      <Key k="←" />
      <Key k="→" /> move · <Key k="↵" /> open · <Key k={isMac ? '⌘' : 'Ctrl'} />
      <Key k="↵" /> new window · <Key k="Esc" /> close
    </>
  );

  const footer =
    dragging && draggedApp ? (
      <DragActions
        app={draggedApp}
        pinned={prefs.pinned.includes(draggedApp.id)}
        hidden={prefs.hidden.includes(draggedApp.id)}
        zone={dropZone}
        over={over}
        onPin={() => togglePin(draggedApp)}
        onHide={() => toggleHidden(draggedApp)}
        onWindow={() => open(draggedApp, 'window')}
        height={full ? LAUNCHER_PARTS.fullFooter : LAUNCHER_PARTS.footer}
      />
    ) : full ? (
      // Full screen: along the bottom of the window, its words in the column above it.
      <div data-footer style={{ height: LAUNCHER_PARTS.fullFooter }} className="flex shrink-0 justify-center border-t border-launcher-line bg-launcher">
        <div className="flex w-full min-w-0 items-center gap-4 text-[12.5px] text-ink-3" style={{ maxWidth: FULL_COLUMN.maxWidth, paddingLeft: FULL_COLUMN.padSide, paddingRight: FULL_COLUMN.padSide }}>
          <span data-hints data-narrow={narrow || undefined} className="min-w-0 flex-1 truncate">
            {narrow ? `${count} · Esc to close` : hints}
          </span>
          <button type="button" onClick={customise} className="h-11 shrink-0 rounded-[10px] border border-launcher-line px-3.5 text-[14px] font-medium text-primary hover:bg-subtle">
            Customise
          </button>
        </div>
      </div>
    ) : (
      <div data-footer style={{ height: LAUNCHER_PARTS.footer }} className="flex shrink-0 items-center justify-between gap-3 border-t border-launcher-line bg-launcher px-3 text-[11px] text-ink-3">
        <span data-hints data-narrow={narrow || undefined} className="min-w-0 truncate">
          {narrow ? `${count} · Esc to close` : hints}
        </span>
        <button type="button" onClick={customise} className="shrink-0 font-semibold text-primary hover:underline">
          Customise
        </button>
      </div>
    );

  // `features.launcherSearch` off (desktop settings): no search box; the grid is all there is.
  const search = !searchOn ? (
    <div className="min-w-0 flex-1" />
  ) : (
    <label
      className={cx(
        'flex min-w-0 flex-1 items-center gap-2.5 border bg-well text-ink-3',
        sheet ? 'h-11 rounded-[11px] border-line px-3' : 'border-primary',
        !sheet && !full && 'h-[42px] rounded-[11px] px-3',
        full && 'gap-3 rounded-[14px] px-[18px] shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]',
      )}
      style={full ? { height: FULL_SEARCH.height } : undefined}
    >
      <Icon name="search" size={full ? 20 : 17} />
      <input
        ref={input}
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSel(0);
        }}
        placeholder="Find an app"
        aria-label="Find an app"
        className={cx('bare-focus min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3', full ? 'text-[18px]' : 'text-[14px]')}
      />
      {sheet ? null : (
        <span className="shrink-0 rounded-[6px] border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-3" title="Opens and closes the launcher">
          {shortcut}
        </span>
      )}
    </label>
  );
  const squareButton = (label: string, icon: string, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'flex shrink-0 items-center justify-center bg-subtle text-ink-2 hover:text-ink',
        sheet ? 'h-11 w-11 rounded-[11px]' : full ? 'h-14 w-14 rounded-[14px] border border-launcher-line' : 'h-[42px] w-[42px] rounded-[11px]',
      )}
    >
      <Icon name={icon} size={full ? (icon === 'x' ? 18 : 20) : icon === 'x' ? 16 : 18} />
    </button>
  );
  const settingsButton = squareButton('App launcher settings', 'settings', customise);
  const closeButton = squareButton('Close launcher', 'x', dismiss);

  const frame: CSSProperties = { left: layout.left, top: layout.top, width: layout.width, height: layout.height };
  const motion = reduced ? null : closing ? 'launcher-out' : 'launcher-in';
  const scrimMotion = reduced ? null : closing ? 'launcher-scrim-out' : 'launcher-scrim-in';
  const outside = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) dismiss();
  };

  const menuEl =
    menu && menuApp ? (
      <TileMenu
        app={menuApp}
        at={menu}
        prefs={prefs}
        sidebarPinned={sidebarPins.includes(menuApp.id)}
        onClose={() => setMenu(null)}
        onOpen={(how) => open(menuApp, how)}
        onPin={() => (setMenu(null), togglePin(menuApp))}
        onHide={() => (setMenu(null), toggleHidden(menuApp))}
        onGroup={(g) => (setMenu(null), toGroup(menuApp, g))}
        onNewGroup={(name) => (setMenu(null), toNewGroup(menuApp, name))}
        onSidebar={() => (setMenu(null), toggleSidebarPin(menuApp))}
      />
    ) : null;

  if (full) {
    // Full screen: the window below the top bar. The top bar, and the window controls in it, stay where they are,
    // dimmed; a click there closes the launcher like any click outside the column.
    return (
      <div className="no-drag fixed inset-0 z-50" data-motion={reduced ? 'reduce' : 'full'} onKeyDown={onKey}>
        <div data-scrim className={cx('absolute inset-x-0 top-0 bg-scrim', scrimMotion)} style={{ height: layout.top }} onMouseDown={outside} />
        <div
          role="dialog"
          aria-label="Apps"
          aria-modal="true"
          data-layout="fullscreen"
          data-size={prefs.size}
          data-categories={layout.sidebar ? 'sidebar' : 'chips'}
          // The app's own dark, whichever theme is on: everything in it is drawn in the dark theme's colours.
          data-theme="dark"
          className={cx('absolute flex flex-col overflow-hidden bg-launcher text-ink', motion)}
          style={frame}
          onMouseDown={(e) => {
            if (menu) setMenu(null);
            outside(e);
          }}
        >
          <div
            data-column
            className="mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col"
            style={{ maxWidth: FULL_COLUMN.maxWidth, paddingTop: FULL_COLUMN.padTop, paddingLeft: FULL_COLUMN.padSide, paddingRight: FULL_COLUMN.padSide, paddingBottom: FULL_COLUMN.padBottom }}
            onMouseDown={outside}
          >
            <div style={{ height: LAUNCHER_PARTS.fullHeader }} className="flex shrink-0 items-start gap-3" onMouseDown={outside}>
              {search}
              {settingsButton}
              {closeButton}
            </div>
            {searching ? null : recentsRow}
            {layout.sidebar ? null : chips}
            <div data-content className="flex min-h-0 flex-1" style={{ gap: layout.sidebar ? FULL_SIDEBAR.gap : 0 }} onMouseDown={outside}>
              {sidebar}
              {body}
            </div>
          </div>
          {footer}
        </div>
        {menuEl}
      </div>
    );
  }

  return (
    <div className={cx('no-drag fixed inset-0 z-50 bg-scrim backdrop-blur-[3px]', scrimMotion)} data-motion={reduced ? 'reduce' : 'full'} onMouseDown={outside} onKeyDown={onKey}>
      <div
        role="dialog"
        aria-label="Apps"
        aria-modal="true"
        data-layout={layout.kind}
        data-size={prefs.size}
        className={cx(
          'absolute flex flex-col overflow-hidden border border-line bg-launcher text-ink shadow-[0_30px_80px_-20px_rgb(var(--ws-shadow-rgb)/.45)]',
          motion,
          layout.kind === 'popover' && 'rounded-[18px]',
          sheet && 'rounded-t-[18px] border-b-0',
        )}
        style={frame}
        onMouseDown={() => menu && setMenu(null)}
      >
        {sheet ? (
          <>
            <div className="flex justify-center pt-2" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-line" />
            </div>
            <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
              <div className="text-[18px] font-bold">Apps</div>
              <div className="flex gap-1.5">
                {settingsButton}
                {closeButton}
              </div>
            </div>
            <div className="flex gap-2 px-3.5 pb-2.5">
              {search}
              {hasChips ? (
                <div className="w-[120px] shrink-0">
                  <Select label="Category" value={view.current} options={view.categories.map((c) => ({ value: c.id, label: c.id === ALL_CATEGORY ? 'All' : c.label }))} onValueChange={(v) => (setCat(String(v)), setSel(0))} />
                </div>
              ) : null}
            </div>
            {showPinned ? chipRow('Pinned', view.pinned, { pinned: true }) : null}
          </>
        ) : (
          <>
            <div style={{ height: LAUNCHER_PARTS.header }} className="flex shrink-0 items-center gap-2 px-3.5">
              {search}
              {settingsButton}
              {closeButton}
            </div>
            {showPinned ? chipRow('Pinned', view.pinned, { pinned: true }) : null}
            {showRecent ? chipRow('Recent', recent) : null}
            {chips}
            <div className="h-px shrink-0 bg-launcher-line" />
          </>
        )}
        {body}
        {footer}
      </div>
      {menuEl}
    </div>
  );
}

/** While a tile is dragged, the footer offers what can be done with it by dropping it there. */
function DragActions(props: {
  app: AppDefinition;
  pinned: boolean;
  hidden: boolean;
  over: string | null;
  zone: (key: string, onDrop: (id: string) => void) => Record<string, unknown>;
  onPin: () => void;
  onHide: () => void;
  onWindow: () => void;
  height: number;
}) {
  const target = (key: string, icon: string, label: string, run: () => void, show = true) =>
    show ? (
      <div key={key} {...props.zone(`act:${key}`, run)} className={cx('flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-dashed text-[12px] font-semibold', props.over === `act:${key}` ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2')}>
        <Icon name={icon} size={14} />
        {label}
      </div>
    ) : null;
  return (
    <div style={{ height: props.height }} className="flex shrink-0 items-center gap-2 border-t border-launcher-line bg-launcher px-3" aria-label={`Drop ${appLabel(props.app)} to`}>
      {target('pin', props.pinned ? 'pin-off' : 'pin', props.pinned ? 'Unpin' : 'Pin', props.onPin)}
      {target('hide', props.hidden ? 'eye' : 'eye-off', props.hidden ? 'Show' : 'Hide', props.onHide)}
      {target('window', 'external', 'Open in new window', props.onWindow, props.app.surface === 'native')}
    </div>
  );
}

function TileMenu(props: {
  app: AppDefinition;
  at: { x: number; y: number };
  prefs: LauncherPrefs;
  sidebarPinned: boolean;
  onClose: () => void;
  onOpen: (how: OpenHow) => void;
  onPin: () => void;
  onHide: () => void;
  onGroup: (g: string | null) => void;
  onNewGroup: (name: string) => void;
  onSidebar: () => void;
}) {
  const { app: a, prefs } = props;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const pinned = prefs.pinned.includes(a.id);
  const hidden = prefs.hidden.includes(a.id);
  const inGroup = prefs.groups.find((g) => g.apps.includes(a.id))?.id ?? null;
  const height = 300 + prefs.groups.length * 34;
  return (
    <div
      role="menu"
      aria-label={`${appLabel(a)} options`}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[60] max-h-[80vh] w-60 overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_16px_40px_rgb(var(--ws-shadow-rgb)/.2)] scroll-thin"
      style={{ left: Math.max(8, Math.min(props.at.x, window.innerWidth - 248)), top: Math.max(8, Math.min(props.at.y, window.innerHeight - Math.min(height, window.innerHeight * 0.8) - 8)) }}
    >
      <MenuItem icon="chevron-right" label="Open" onClick={() => props.onOpen(prefs.openIn)} />
      {a.surface === 'native' ? (
        <>
          <MenuItem icon="plus" label="Open in a new tab" onClick={() => props.onOpen('new-tab')} />
          <MenuItem icon="external" label="Open in new window" onClick={() => props.onOpen('window')} />
        </>
      ) : null}
      <Sep />
      <MenuItem icon={pinned ? 'pin-off' : 'pin'} label={pinned ? 'Unpin' : 'Pin'} onClick={props.onPin} />
      <MenuItem icon={hidden ? 'eye' : 'eye-off'} label={hidden ? 'Show in the grid' : 'Hide'} onClick={props.onHide} />
      <MenuItem icon={props.sidebarPinned ? 'pin-off' : 'pin'} label={props.sidebarPinned ? 'Unpin from the sidebar' : 'Pin to the sidebar'} onClick={props.onSidebar} />
      <Sep />
      <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Move to group</div>
      {prefs.groups.map((g) => (
        <MenuItem key={g.id} icon={inGroup === g.id ? 'check' : 'folder'} label={g.name} onClick={() => props.onGroup(g.id)} />
      ))}
      {inGroup ? <MenuItem icon="minus" label="No group" onClick={() => props.onGroup(null)} /> : null}
      {naming ? (
        <form
          className="px-1.5 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) props.onNewGroup(name);
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setNaming(false);
            }}
            placeholder="Group name"
            aria-label="New group name"
            className="h-8 w-full rounded-[7px] border border-line bg-well px-2 text-[13px] text-ink outline-none focus:border-primary"
          />
        </form>
      ) : (
        <MenuItem icon="folder-plus" label="New group…" onClick={() => setNaming(true)} />
      )}
    </div>
  );
}

/** A key in the footer's hints, as a chip. */
function Key({ k }: { k: string }) {
  return <kbd className="mx-px inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] border border-launcher-line bg-subtle px-1 align-[-3px] font-sans text-[10px] leading-none font-semibold text-ink-2">{k}</kbd>;
}

function Sep() {
  return <div role="separator" className="my-1 h-px bg-line" />;
}

function MenuItem({ icon, label, onClick }: { icon: string; label: ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle">
      <Icon name={icon} size={15} className="text-ink-3" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

