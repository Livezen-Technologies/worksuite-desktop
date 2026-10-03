import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { appRoute, navApps, type AppDefinition } from '@shared/apps';
import {
  ALL_CATEGORY,
  addGroup,
  categoryOf,
  columnsFor,
  gridStep,
  launcherLayout,
  launcherView,
  moveToGroup,
  movePinned,
  noteUse,
  OTHER_GROUP,
  pinApp,
  reorderApps,
  setHidden,
  unpinApp,
  visibleArea,
  PIN_MAX,
  type LauncherPrefs,
  type Rect,
} from '@shared/launcher';
import { app, updatePrefs } from '../../core/app-state';
import { appColour } from '../../core/app-look';
import { call, isMac } from '../../core/bridge';
import { prettyAccelerator } from '../../core/commands';
import { appLabel } from '../../core/i18n';
import { syncLauncherPrefsIfStale, updateLauncherPrefs, useLauncherPrefs } from '../../core/launcher-prefs';
import { noteRecentApp, readRecentApps } from '../../core/recent-apps';
import { useStore } from '../../core/store';
import { activeTab, navigate, openTab, setRoute } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { closeOverlay, openOverlay } from '../../core/ui';
import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';

/**
 * App launcher (AppLauncher, §4.3, FR-NAV-02; redesigned in worksuite-desktop#201): find an app, the ones pinned and
 * used lately, and every app the person may open, by category, as tiles.
 *
 * A popover of about 760×600 under the title bar, never more than 90% of the visible window and never under the
 * Dock or taskbar; a bottom sheet in a window narrower than 480px; or all of the window, as the person chooses in
 * Settings › App launcher (core/launcher-prefs, synced between their devices). The grid takes as many 88px columns as
 * fit. Typing searches at once — names and keywords, hidden apps too; the arrow keys move over the grid, Enter opens,
 * ⌘Enter opens in a new window, Esc closes. Right-click a tile, or drag it, to pin it, hide it, move it to a group of
 * one's own or open it in a new window. Apps the person may not open are never here (`app.apps` is through the gates).
 */

const ANCHOR_TOP = 56;
const EMPTY: string[] = [];
const DRAG_TYPE = 'application/x-worksuite-app';

/** The visible part of the window, kept current as it is resized or moved. */
function useVisibleArea(): Rect {
  const read = () => visibleArea(window, window.screen as unknown as Parameters<typeof visibleArea>[1]);
  const [area, setArea] = useState<Rect>(read);
  useEffect(() => {
    const on = () => setArea((prev) => {
      const next = read();
      return prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height ? prev : next;
    });
    window.addEventListener('resize', on);
    // A window dragged under the Dock moves without resizing: look again now and then while open.
    const t = setInterval(on, 1000);
    return () => {
      window.removeEventListener('resize', on);
      clearInterval(t);
    };
  }, []);
  return area;
}

type OpenHow = 'window' | 'new-tab' | 'current-tab';

export function Launcher() {
  const apps = useStore(app, (s) => s.apps);
  const sidebarPins = useStore(app, (s) => s.prefs?.pinnedApps ?? EMPTY);
  const status = useStore(app, (s) => s.status);
  const userId = useStore(app, (s) => s.auth?.user?.id ?? null);
  const prefs = useLauncherPrefs();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string>(ALL_CATEGORY);
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [recentIds] = useState(() => readRecentApps(userId));
  const area = useVisibleArea();
  const layout = launcherLayout(area, prefs, ANCHOR_TOP);
  const sheet = layout.kind === 'sheet';

  useEffect(() => syncLauncherPrefsIfStale(), []);

  // A channel is in its host (WhatsApp, in Chat: #35), not an app of its own here.
  const all = useMemo(() => navApps(apps).filter((a) => a.id !== 'home'), [apps]);
  const view = launcherView({ apps: all, prefs, query, category: cat, label: appLabel });
  const list = view.tiles;
  const searching = query.trim() !== '';
  const columns = layout.columns ?? columnsFor(layout.width - 32);
  const selected = Math.min(sel, Math.max(0, list.length - 1));
  const recent = prefs.toggles.recent
    ? recentIds
        .map((r) => all.find((a) => a.id === r.id))
        .filter((a): a is AppDefinition => !!a)
        .slice(0, 6)
    : [];

  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

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
  const toggleSidebarPin = (a: AppDefinition) => void updatePrefs({ pinnedApps: sidebarPins.includes(a.id) ? sidebarPins.filter((p) => p !== a.id) : [...sidebarPins, a.id] });

  const customise = () => {
    closeOverlay();
    navigate('/settings/launcher');
  };

  const onKey = (e: React.KeyboardEvent) => {
    const inInput = e.target === input.current;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (menu) setMenu(null);
      else closeOverlay();
    } else if (e.key.startsWith('Arrow') || (!inInput && (e.key === 'Home' || e.key === 'End'))) {
      if (menu) return;
      e.preventDefault();
      setSel(gridStep(selected, e.key, list.length, columns));
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
      // Typing anywhere in the launcher searches.
      input.current?.focus();
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
        className={cx(
          'relative flex min-w-0 flex-col items-center gap-1.5 rounded-[12px] px-1 pt-2.5 pb-2 text-ink outline-none',
          sel ? 'bg-selection shadow-[inset_0_0_0_2px_var(--color-primary)]' : 'hover:bg-subtle',
          over === `tile:${a.id}` && dragging !== a.id && 'shadow-[inset_3px_0_0_var(--color-primary)]',
          dragging === a.id && 'opacity-40',
        )}
      >
        <span className="relative">
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
        <span className={cx('max-w-full truncate text-[12px] font-medium', !prefs.toggles.names && 'sr-only')}>{name}</span>
      </button>
    );
  };

  const chipRow = (label: string, items: AppDefinition[], opts: { pinned?: boolean } = {}) => (
    <div className={cx('flex min-w-0 items-center gap-1.5 overflow-x-auto scroll-thin', sheet ? 'px-2' : 'px-3.5')} {...(opts.pinned ? dropZone('pinned', dropOnPinned(null)) : {})}>
      <span className="mr-1 shrink-0 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{label}</span>
      {items.map((a) => (
        <button
          key={a.id}
          type="button"
          aria-label={`Open ${appLabel(a)}`}
          onClick={() => open(a)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ id: a.id, x: e.clientX, y: e.clientY });
          }}
          {...dragProps(a)}
          {...(opts.pinned ? dropZone(`pin:${a.id}`, dropOnPinned(a.id)) : {})}
          className={cx('flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-line bg-surface pr-2.5 pl-1 text-[12px] font-semibold text-ink hover:bg-subtle', over === `pin:${a.id}` && 'border-primary')}
        >
          <AppTile icon={a.icon} colour={appColour(a.id)} size={24} radius={7} iconSize={14} />
          {appLabel(a)}
        </button>
      ))}
      {opts.pinned && dragging && !items.some((a) => a.id === dragging) ? (
        <span className={cx('flex h-8 shrink-0 items-center rounded-[9px] border border-dashed px-2.5 text-[12px] text-ink-3', over === 'pinned' ? 'border-primary text-primary' : 'border-line')}>Drop here to pin</span>
      ) : null}
    </div>
  );

  const showPinned = !searching && (view.pinned.length > 0 || !!dragging);
  const showRecent = !searching && recent.length > 0;

  const chips =
    view.categories.length > 1 ? (
      <div role="tablist" aria-label="Categories" className={cx('flex shrink-0 gap-1.5 overflow-x-auto pb-2.5 scroll-thin', sheet ? 'px-2' : 'px-3.5')}>
        {view.categories.map((c) => {
          const on = c.id === view.current;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => (setCat(c.id), setSel(0))}
              {...dropZone(`cat:${c.id}`, dropOnCategory(c.id))}
              className={cx(
                'flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold',
                on ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2 hover:text-ink',
                over === `cat:${c.id}` && prefs.groupBy === 'mine' && c.id !== ALL_CATEGORY && 'ring-2 ring-primary',
              )}
            >
              {c.label}
              <span className="text-[11px] opacity-75">{c.count}</span>
            </button>
          );
        })}
      </div>
    ) : null;

  const gridStyle: CSSProperties = { gridTemplateColumns: layout.columns ? `repeat(${layout.columns}, minmax(0, 1fr))` : 'repeat(auto-fill, minmax(88px, 1fr))' };
  const empty = (
    <div className="col-span-full flex flex-col items-center gap-2 py-14 text-center">
      <b className="text-[14px] text-ink">No apps match that search.</b>
      <button type="button" onClick={() => openOverlay('search', query.trim())} className="text-[12.5px] font-semibold text-primary hover:underline">
        Search WorkSuite for “{query.trim()}”
      </button>
    </div>
  );

  // The bottom sheet reads category by category, each under its name.
  const sections: Array<{ id: string; label: string | null; items: Array<{ a: AppDefinition; i: number }> }> = [];
  if (sheet && !searching && view.current === ALL_CATEGORY && view.categories.length > 1) {
    list.forEach((a, i) => {
      const c = categoryOf(a, prefs);
      const last = sections.at(-1);
      if (last?.id === c) last.items.push({ a, i });
      else sections.push({ id: c, label: view.categories.find((x) => x.id === c)?.label ?? null, items: [{ a, i }] });
    });
  } else sections.push({ id: 'all', label: null, items: list.map((a, i) => ({ a, i })) });

  const body = (
    <div ref={grid} role="listbox" aria-label="Apps" className={cx('min-h-0 flex-1 overflow-y-auto scroll-thin', sheet ? 'px-2 pb-3' : 'px-2.5 pt-2.5 pb-1.5')}>
      {sections.map((s) => (
        <div key={s.id} role="presentation">
          {s.label ? <div className="px-2 pt-2.5 pb-0.5 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{s.label}</div> : null}
          <div role="presentation" className="grid gap-0.5" style={gridStyle}>
            {s.items.map(({ a, i }) => tile(a, i))}
          </div>
        </div>
      ))}
      {!list.length ? (searching ? empty : <div className="py-14 text-center text-[13px] text-ink-3">Every app is hidden. Search finds them, or show them again in Customise.</div>) : null}
    </div>
  );

  const footer = dragging && draggedApp ? (
    <DragActions
      app={draggedApp}
      pinned={prefs.pinned.includes(draggedApp.id)}
      hidden={prefs.hidden.includes(draggedApp.id)}
      zone={dropZone}
      over={over}
      onPin={() => togglePin(draggedApp)}
      onHide={() => toggleHidden(draggedApp)}
      onWindow={() => open(draggedApp, 'window')}
    />
  ) : (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-3.5 py-2 text-[11px] text-ink-3">
      <span className="min-w-0 truncate">
        {list.length} {list.length === 1 ? 'app' : 'apps'}
        {sheet ? null : ` · Arrow keys to move · Enter to open · ${isMac ? '⌘' : 'Ctrl+'}Enter for a new window · Esc to close`}
      </span>
      <button type="button" onClick={customise} className="shrink-0 font-semibold text-primary hover:underline">
        Customise
      </button>
    </div>
  );

  const search = (
    <label className={cx('flex min-w-0 flex-1 items-center gap-2.5 rounded-[11px] border bg-well px-3 text-ink-3', sheet ? 'h-11 border-line' : 'h-[42px] border-primary')}>
      <Icon name="search" size={17} />
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
        className="bare-focus min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
      />
      {sheet ? null : <span className="shrink-0 rounded-[6px] border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-3" title="Opens and closes the launcher">{shortcut}</span>}
    </label>
  );
  const squareButton = (label: string, icon: string, onClick: () => void) => (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cx('flex shrink-0 items-center justify-center rounded-[11px] bg-subtle text-ink-2 hover:text-ink', sheet ? 'h-11 w-11' : 'h-[42px] w-[42px]')}>
      <Icon name={icon} size={icon === 'x' ? 16 : 18} />
    </button>
  );

  const frame: CSSProperties = { left: layout.left, top: layout.top, width: layout.width, height: layout.height };

  return (
    <div className="no-drag fixed inset-0 z-50 bg-[rgba(15,27,61,.32)] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()} onKeyDown={onKey}>
      <div
        role="dialog"
        aria-label="Apps"
        data-layout={layout.kind}
        data-size={prefs.size}
        className={cx(
          'animate-in absolute flex flex-col overflow-hidden border border-line bg-surface text-ink shadow-[0_30px_80px_-20px_rgb(var(--ws-shadow-rgb)/.45)]',
          layout.kind === 'popover' && 'rounded-[18px]',
          layout.kind === 'sheet' && 'rounded-t-[18px] border-b-0',
          layout.kind === 'fullscreen' && 'rounded-none border-0',
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
                {squareButton('Customise launcher', 'sliders', customise)}
                {squareButton('Close launcher', 'x', closeOverlay)}
              </div>
            </div>
            <div className="flex gap-2 px-3.5 pb-2.5">
              {search}
              {view.categories.length > 1 ? (
                <div className="w-[120px] shrink-0">
                  <Select label="Category" value={view.current} options={view.categories.map((c) => ({ value: c.id, label: c.id === ALL_CATEGORY ? 'All' : c.label }))} onValueChange={(v) => (setCat(String(v)), setSel(0))} />
                </div>
              ) : null}
            </div>
            {showPinned ? <div className="pb-2">{chipRow('Pinned', view.pinned, { pinned: true })}</div> : null}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5">
              {search}
              {squareButton('Customise launcher', 'sliders', customise)}
              {squareButton('Close launcher', 'x', closeOverlay)}
            </div>
            {showPinned ? <div className="pb-2">{chipRow('Pinned', view.pinned, { pinned: true })}</div> : null}
            {showRecent ? <div className="pb-2">{chipRow('Recent', recent)}</div> : null}
            {chips}
            <div className="h-px shrink-0 bg-line" />
          </>
        )}
        {body}
        {footer}
      </div>
      {menu && menuApp ? (
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
      ) : null}
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
}) {
  const target = (key: string, icon: string, label: string, run: () => void, show = true) =>
    show ? (
      <div key={key} {...props.zone(`act:${key}`, run)} className={cx('flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-dashed text-[12px] font-semibold', props.over === `act:${key}` ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2')}>
        <Icon name={icon} size={14} />
        {label}
      </div>
    ) : null;
  return (
    <div className="flex shrink-0 gap-2 border-t border-line px-3.5 py-2" aria-label={`Drop ${appLabel(props.app)} to`}>
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

