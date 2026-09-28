import { useEffect, useRef, useState } from 'react';
import { useStore } from '../core/store';
import { activate, adoptWindow, closeOthers, closeTab, closeToRight, detachTab, dockSide, duplicateTab, moveTab, openTab, reloadTab, tabsStore, togglePin, undockSide, type Tab } from '../core/tabs';
import { TAB_DRAG, WINDOW_DRAG, dragHas, dropPoint, droppedWindow, releasedOutside, watchDragPointer } from '../core/dock-drag';
import { Icon } from '../components/Icon';
import { cx } from '../components/ui';
import { t } from '../core/i18n';

/**
 * Tab strip, 40 px (§4.12, FR-NAV-03): drag to reorder, middle-click to
 * close, a context menu with the full tab manager, overflow menu, "+".
 *
 * Docking (FR-NAV-05/07): drag a tab out of the window to tear it off into
 * its own; drop a torn-off window's handle on the strip to take it back in
 * as a tab there. The tab docked beside the active one is marked.
 */
export function TabStrip() {
  const tabs = useStore(tabsStore, (s) => s.tabs);
  const activeId = useStore(tabsStore, (s) => s.activeId);
  const sideId = useStore(tabsStore, (s) => s.sideId);
  const [menu, setMenu] = useState<{ tab: Tab; x: number; y: number } | null>(null);
  const [overflow, setOverflow] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const [windowOver, setWindowOver] = useState(false);

  useEffect(() => watchDragPointer(), []);

  // A torn-off window's handle dropped here comes back as a tab at that place.
  const takeWindow = (e: React.DragEvent, index?: number) => {
    const id = droppedWindow(e);
    if (id === null) return false;
    e.preventDefault();
    e.stopPropagation();
    setWindowOver(false);
    void adoptWindow(id, { index });
    return true;
  };

  useEffect(() => {
    if (!menu && !overflow) return;
    const close = () => {
      setMenu(null);
      setOverflow(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu, overflow]);

  return (
    <div
      className={cx('flex h-[40px] shrink-0 items-end gap-0.5 border-b border-line px-2', windowOver ? 'bg-selection' : 'bg-[color-mix(in_srgb,var(--ws-ground)_70%,var(--ws-line))]')}
      role="tablist"
      aria-label="Open tabs"
      onDragOver={(e) => {
        if (!dragHas(e, WINDOW_DRAG)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setWindowOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setWindowOver(false);
      }}
      onDrop={(e) => takeWindow(e)}
    >
      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto scroll-thin">
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          const side = tab.id === sideId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              draggable
              onDragStart={(e) => {
                dragFrom.current = i;
                e.dataTransfer.setData(TAB_DRAG, tab.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragHas(e, WINDOW_DRAG)) e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                if (takeWindow(e, i)) return;
                if (dragFrom.current !== null && dragFrom.current !== i) moveTab(dragFrom.current, i);
                dragFrom.current = null;
              }}
              onDragEnd={(e) => {
                dragFrom.current = null;
                // Let go outside the window, on nothing that took it: the tab becomes its own window there.
                if (e.dataTransfer.dropEffect === 'none' && releasedOutside(e)) void detachTab(tab.id, dropPoint(e));
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  if (!tab.pinned) closeTab(tab.id);
                } else if (e.button === 0) activate(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') activate(tab.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ tab, x: e.clientX, y: e.clientY });
              }}
              className={cx(
                'group flex h-[34px] max-w-[220px] min-w-[110px] shrink-0 cursor-default items-center gap-2 rounded-t-[9px] px-3 text-[13px]',
                active ? 'bg-ground font-semibold text-ink' : side ? 'bg-ground/70 text-ink' : 'text-ink-2 hover:bg-ground/60',
                tab.pinned && 'min-w-0 max-w-[140px]',
              )}
              title={side ? `${tab.title} — docked beside` : tab.title}
            >
              {side ? <Icon name="layout-side" size={14} className="shrink-0 text-ink-3" label="Docked beside" /> : null}
              {tab.pinned ? <Icon name="pin" size={13} className="shrink-0 text-ink-3" /> : tab.app === 'home' ? <Icon name="home" size={15} className="shrink-0" /> : null}
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              {!tab.pinned ? (
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => closeTab(tab.id)}
                  className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-line hover:text-ink', !active && 'opacity-0 group-hover:opacity-100')}
                >
                  <Icon name="x" size={13} />
                </button>
              ) : null}
            </div>
          );
        })}
        <button type="button" aria-label={t('shell.newTab')} title={t('shell.newTab')} onClick={() => openTab('/home')} className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-2 hover:bg-ground/70">
          <Icon name="plus" size={16} />
        </button>
      </div>
      {tabs.length > 6 ? (
        <button type="button" aria-label="All tabs" onMouseDown={(e) => e.stopPropagation()} onClick={() => setOverflow((v) => !v)} className="mb-1 flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-ground/70">
          <Icon name="chevron-down" size={16} />
        </button>
      ) : null}

      {menu ? (
        <Menu x={menu.x} y={menu.y}>
          <MenuItem onClick={() => closeTab(menu.tab.id)} disabled={menu.tab.pinned}>
            Close
          </MenuItem>
          <MenuItem onClick={() => closeOthers(menu.tab.id)}>Close others</MenuItem>
          <MenuItem onClick={() => closeToRight(menu.tab.id)}>Close tabs to the right</MenuItem>
          <hr className="my-1 border-line" />
          <MenuItem onClick={() => togglePin(menu.tab.id)}>{menu.tab.pinned ? 'Unpin' : 'Pin'}</MenuItem>
          <MenuItem onClick={() => duplicateTab(menu.tab.id)}>Duplicate</MenuItem>
          <MenuItem onClick={() => reloadTab(menu.tab.id)}>Reload</MenuItem>
          <hr className="my-1 border-line" />
          {menu.tab.id === sideId ? (
            <MenuItem onClick={undockSide}>Undock from beside</MenuItem>
          ) : (
            <MenuItem onClick={() => dockSide(menu.tab.id)} disabled={tabs.length < 2}>
              Dock beside
            </MenuItem>
          )}
          <MenuItem onClick={() => void detachTab(menu.tab.id)}>Move to new window</MenuItem>
        </Menu>
      ) : null}
      {overflow ? (
        <Menu x={window.innerWidth - 280} y={92}>
          {tabs.map((tab) => (
            <MenuItem key={tab.id} onClick={() => activate(tab.id)}>
              <span className={cx('truncate', tab.id === activeId && 'font-bold')}>{tab.title}</span>
            </MenuItem>
          ))}
        </Menu>
      ) : null}
    </div>
  );
}

export function Menu({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const left = Math.min(x, window.innerWidth - 260);
  const top = Math.min(y, window.innerHeight - 320);
  return (
    <div role="menu" onMouseDown={(e) => e.stopPropagation()} className="animate-in fixed z-50 w-[240px] rounded-[10px] border border-line bg-surface p-1 shadow-xl" style={{ left, top }}>
      {children}
    </div>
  );
}

export function MenuItem({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onClick();
        window.dispatchEvent(new MouseEvent('mousedown'));
      }}
      className="flex h-8 w-full items-center rounded-[7px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle disabled:opacity-40"
    >
      {children}
    </button>
  );
}
