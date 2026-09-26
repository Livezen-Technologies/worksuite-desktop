import { useEffect, useMemo, useRef, useState } from 'react';
import { LAUNCHER_GROUPS, type AppDefinition, type LauncherGroup } from '@shared/apps';
import { app, updatePrefs } from '../../core/app-state';
import { appColour } from '../../core/app-look';
import { call } from '../../core/bridge';
import { prettyAccelerator } from '../../core/commands';
import { appLabel } from '../../core/i18n';
import { agoLabel, noteRecentApp, readRecentApps, type RecentApp } from '../../core/recent-apps';
import { useStore } from '../../core/store';
import { navigate, openTab } from '../../core/tabs';
import { closeOverlay, openOverlay } from '../../core/ui';
import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * App launcher (AppLauncher, §4.3, FR-NAV-02): find an app, the ones used
 * lately, and every app the person may open by category, as tiles. Apps
 * without a desktop module open in the browser and say so with a corner mark.
 * Arrow keys move over the grid, Enter opens, Tab steps through the
 * categories; right-click (or a tile's ⋯) opens it in a new tab or window, or
 * pins it to the sidebar. Apps the user cannot open are not listed at all.
 */
export const LAUNCHER_COLUMNS = 6;
type Cat = 'all' | LauncherGroup;

/** Where an arrow key takes the selection in a grid of `count` tiles. */
export function gridStep(index: number, key: string, count: number, columns = LAUNCHER_COLUMNS): number {
  const move = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns } as Record<string, number>)[key];
  if (move === undefined || count === 0) return index;
  const next = index + move;
  return next < 0 || next >= count ? index : next;
}

export function Launcher() {
  const apps = useStore(app, (s) => s.apps);
  const pinned = useStore(app, (s) => s.prefs?.pinnedApps ?? []);
  const status = useStore(app, (s) => s.status);
  const userId = useStore(app, (s) => s.auth?.user?.id ?? null);
  const [filter, setFilter] = useState('');
  const [cat, setCat] = useState<Cat>('all');
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [now] = useState(() => Date.now());
  const [recentIds] = useState(() => readRecentApps(userId));

  const all = useMemo(() => apps.filter((a) => a.id !== 'home'), [apps]);
  const needle = filter.trim().toLowerCase();
  const matching = all.filter((a) => !needle || appLabel(a).toLowerCase().includes(needle) || (a.keywords ?? '').includes(needle));
  const cats = [
    { id: 'all' as Cat, label: 'All apps', n: matching.length },
    ...LAUNCHER_GROUPS.map((g) => ({ id: g.id as Cat, label: g.label, n: matching.filter((a) => a.group === g.id).length })).filter((c) => c.n > 0),
  ];
  const current = cats.some((c) => c.id === cat) ? cat : 'all';
  // The grid reads category by category, in the launcher's own order.
  const order: string[] = LAUNCHER_GROUPS.map((g) => g.id);
  const list = matching.filter((a) => current === 'all' || a.group === current).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.order - b.order);
  const selected = Math.min(sel, Math.max(0, list.length - 1));
  const recent = recentIds
    .map((r) => ({ r, a: all.find((a) => a.id === r.id) }))
    .filter((x): x is { r: RecentApp; a: AppDefinition } => !!x.a)
    .slice(0, 4);

  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const badge = (a: AppDefinition): number => (status && a.badge ? (status.unread[a.badge] ?? 0) : 0);

  const open = (a: AppDefinition, how: 'tab' | 'new-tab' | 'window' = 'tab') => {
    closeOverlay();
    noteRecentApp(userId, a.id);
    if (a.surface === 'browser') {
      void call('app:openInBrowser', { path: a.webPath });
      return;
    }
    if (how === 'tab') navigate(`/${a.id}`);
    else if (how === 'new-tab') openTab(`/${a.id}`);
    else void call('windows:open', { kind: 'record', route: `/${a.id}`, title: a.label });
  };
  const togglePin = (a: AppDefinition) => {
    const next = pinned.includes(a.id) ? pinned.filter((p) => p !== a.id) : [...pinned, a.id];
    void updatePrefs({ pinnedApps: next });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (menu) setMenu(null);
      else closeOverlay();
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      setSel(gridStep(selected, e.key, list.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const a = list[selected];
      if (a) open(a, (e.metaKey || e.ctrlKey) && a.surface === 'native' ? 'window' : 'tab');
      else if (needle) openOverlay('search', filter.trim());
    } else if (e.key === 'Tab' && cats.length > 1) {
      e.preventDefault();
      const i = cats.findIndex((c) => c.id === current);
      setCat(cats[(i + (e.shiftKey ? cats.length - 1 : 1)) % cats.length]!.id);
      setSel(0);
    }
  };

  const menuApp = menu ? all.find((a) => a.id === menu.id) : undefined;

  return (
    <div className="no-drag fixed inset-0 z-50 bg-[rgba(15,27,61,.38)] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()} onKeyDown={onKey}>
      <div
        role="dialog"
        aria-label="Apps"
        className="animate-in absolute top-[84px] left-1/2 flex max-h-[calc(100vh-110px)] w-[900px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-[24px] bg-[rgba(250,251,253,.97)] shadow-[0_40px_100px_rgba(11,21,48,.35),0_0_0_1px_rgba(15,27,61,.06)] dark:bg-surface"
        onMouseDown={() => menu && setMenu(null)}
      >
        <div className="flex flex-col gap-3.5 px-[22px] pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <label className="flex h-12 flex-1 items-center gap-3 rounded-[16px] border-2 border-primary bg-surface px-4 text-ink-3 shadow-[0_0_0_4px_rgba(35,52,158,.12)]">
              <Icon name="search" size={19} />
              <input
                autoFocus
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setSel(0);
                }}
                placeholder="Find an app"
                aria-label="Find an app"
                className="bare-focus min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
              />
              <button type="button" title="Search everything" onClick={() => openOverlay('search', filter.trim())} className="rounded-[6px] border border-line px-[7px] py-[3px] font-mono text-[11px] text-ink-3 hover:text-ink">
                {prettyAccelerator('Mod+K')}
              </button>
            </label>
            <button type="button" aria-label="Close" onClick={closeOverlay} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2 hover:text-ink">
              <Icon name="x" size={18} />
            </button>
          </div>
          {recent.length && !needle ? (
            <div className="flex flex-col gap-2">
              <span className="text-[11.5px] font-bold text-ink-3">Recent</span>
              <div className="flex flex-wrap gap-2">
                {recent.map(({ r, a }) => (
                  <button key={a.id} type="button" onClick={() => open(a)} className="flex items-center gap-2.5 rounded-[14px] border border-line bg-surface py-2 pr-3 pl-2 text-left hover:border-primary/40">
                    <AppTile icon={a.icon} colour={appColour(a.id)} size={34} radius={11} iconSize={17} />
                    <span className="flex flex-col">
                      <b className="text-[12.5px] text-ink">{appLabel(a)}</b>
                      <span className="text-[11px] text-ink-3">{agoLabel(r.at, now)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div role="tablist" aria-label="Categories" className="flex flex-wrap gap-1.5">
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === current}
                onClick={() => (setCat(c.id), setSel(0))}
                className={cx('flex h-[34px] items-center gap-[7px] rounded-full border pr-3 pl-3.5 text-[12.5px] font-semibold', c.id === current ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2 hover:text-ink')}
              >
                {c.label}
                <span className={cx('flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[10.5px]', c.id === current ? 'bg-white/20' : 'bg-subtle text-ink-3')}>{c.n}</span>
              </button>
            ))}
          </div>
        </div>
        <div ref={grid} role="listbox" aria-label="Apps" className="grid min-h-[200px] flex-1 grid-cols-6 content-start gap-1.5 overflow-y-auto px-[18px] pt-1.5 pb-[18px] scroll-thin">
          {list.map((a, i) => {
            const n = badge(a);
            const web = a.surface === 'browser';
            return (
              <div key={a.id} className="group relative" onMouseEnter={() => setSel(i)}>
                <button
                  type="button"
                  role="option"
                  data-index={i}
                  aria-selected={i === selected}
                  tabIndex={-1}
                  title={`${appLabel(a)} · ${web ? 'Opens in your browser' : 'Desktop app'}`}
                  onClick={() => open(a)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSel(i);
                    setMenu({ id: a.id, x: e.clientX, y: e.clientY });
                  }}
                  className={cx('flex w-full flex-col items-center gap-2 rounded-[18px] px-1.5 pt-3.5 pb-3', i === selected && 'bg-surface shadow-[0_0_0_2px_var(--color-primary),0_8px_20px_rgba(15,27,61,.08)] dark:bg-ground')}
                >
                  <span className="relative">
                    <AppTile icon={a.icon} colour={appColour(a.id)} size={58} radius={17} iconSize={26} />
                    {n > 0 ? (
                      <span className="absolute -top-1.5 -right-[7px] flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#FAFBFD] bg-badge px-[5px] text-[10.5px] font-bold text-white dark:border-surface">{n > 99 ? '99+' : n}</span>
                    ) : null}
                    {web ? (
                      <span title="Opens in your browser" className="absolute -right-[5px] -bottom-[5px] flex h-5 w-5 items-center justify-center rounded-full bg-surface text-ink-2 shadow-[0_2px_6px_rgba(15,27,61,.22)]">
                        <Icon name="external" size={11} />
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-full truncate text-[13px] font-semibold text-ink">{appLabel(a)}</span>
                  <span className="text-[10.5px] text-ink-3">{web ? 'In browser' : 'Desktop app'}</span>
                </button>
                <button
                  type="button"
                  aria-label={`More for ${appLabel(a)}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ id: a.id, x: r.left, y: r.bottom + 4 });
                  }}
                  className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-subtle hover:text-ink focus:opacity-100"
                >
                  <Icon name="more" size={14} />
                </button>
              </div>
            );
          })}
          {!list.length ? (
            <div className="col-span-6 flex flex-col items-center gap-2 py-14 text-center">
              <b className="text-[14px] text-ink">No app called “{filter.trim()}”</b>
              <button type="button" onClick={() => openOverlay('search', filter.trim())} className="text-[12.5px] font-semibold text-primary hover:underline">
                Search WorkSuite for “{filter.trim()}”
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-[18px] border-t border-line bg-ground px-[22px] py-2.5 text-[11.5px] text-ink-3">
          <span>
            <b className="font-mono text-ink-2">↑ ↓ ← →</b> move
          </span>
          <span>
            <b className="font-mono text-ink-2">Enter</b> open
          </span>
          <span>
            <b className="font-mono text-ink-2">Esc</b> close
          </span>
          <span className="flex-1" />
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Desktop app
          </span>
          <span className="flex items-center gap-[5px]">
            <Icon name="external" size={12} />
            Opens in your browser
          </span>
        </div>
      </div>
      {menu && menuApp ? (
        <div role="menu" aria-label={`${appLabel(menuApp)} options`} className="fixed z-[60] w-56 rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_16px_40px_rgba(15,27,61,.2)]" style={{ left: Math.min(menu.x, window.innerWidth - 236), top: Math.min(menu.y, window.innerHeight - 170) }}>
          <MenuItem icon="chevron-right" label="Open" onClick={() => open(menuApp)} />
          {menuApp.surface === 'native' ? (
            <>
              <MenuItem icon="plus" label="Open in a new tab" onClick={() => open(menuApp, 'new-tab')} />
              <MenuItem icon="external" label="Open in a new window" onClick={() => open(menuApp, 'window')} />
            </>
          ) : null}
          <MenuItem icon={pinned.includes(menuApp.id) ? 'pin-off' : 'pin'} label={pinned.includes(menuApp.id) ? 'Unpin from the sidebar' : 'Pin to the sidebar'} onClick={() => (setMenu(null), togglePin(menuApp))} />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onMouseDown={(e) => e.stopPropagation()} onClick={onClick} className="flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle">
      <Icon name={icon} size={15} className="text-ink-3" />
      {label}
    </button>
  );
}
