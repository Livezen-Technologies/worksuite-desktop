import { Suspense, useRef, useState } from 'react';
import { canOpenApp } from '@shared/access';
import { useVisibleIds } from '../core/access';
import { useStore } from '../core/store';
import { adoptWindow, detachTab, dockSide, navigate, setSplit, swapSides, tabsStore, undockSide } from '../core/tabs';
import { TabProvider } from '../core/tab-context';
import { moduleFor } from '../modules/registry';
import { ModuleBoundary, Spinner, IconButton, cx } from '../components/ui';
import { moduleRecovery, useOptionalQueryClient } from '../components/moduleRecovery';
import { TAB_DRAG, WINDOW_DRAG, dragHas, droppedWindow } from '../core/dock-drag';

/**
 * The workspace: every live tab stays mounted and hidden when inactive, so
 * switching is immediate (NFR-PERF-02); suspended tabs are unmounted and
 * rebuilt from their route on activation (FR-NAV-08). Each module renders
 * inside its own error boundary (FR-REG-03).
 *
 * Docking (FR-NAV-07): one tab can be docked beside the active one, with a
 * divider to share the width. Drag a tab — or a torn-off window's handle —
 * to the right-hand side of the workspace to dock it there; a window's
 * handle dropped anywhere else comes back as a tab.
 *
 * A tab of an app the person may no longer open renders nothing while it is
 * being closed (Shell).
 */
const DIVIDER = 6;

export function Workspace() {
  const tabs = useStore(tabsStore, (s) => s.tabs);
  const activeId = useStore(tabsStore, (s) => s.activeId);
  const visible = useVisibleIds();
  const sideId = useStore(tabsStore, (s) => s.sideId);
  const split = useStore(tabsStore, (s) => s.split);
  const qc = useOptionalQueryClient();
  const ref = useRef<HTMLElement>(null);
  const [zone, setZone] = useState<'side' | 'tab' | null>(null);
  const [resizing, setResizing] = useState(false);
  const docked = !!sideId && tabs.some((t) => t.id === sideId);
  const pct = `${(split * 100).toFixed(2)}%`;

  const zoneAt = (e: React.DragEvent): 'side' | 'tab' | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    const right = e.clientX > r.left + r.width * 0.6;
    if (dragHas(e, TAB_DRAG)) return right && tabs.length > 1 ? 'side' : null;
    if (dragHas(e, WINDOW_DRAG)) return right ? 'side' : 'tab';
    return null;
  };

  return (
    <main
      ref={ref}
      className="relative min-h-0 min-w-0 flex-1 bg-ground"
      onDragOver={(e) => {
        const z = zoneAt(e);
        if (!z) {
          if (zone) setZone(null);
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (z !== zone) setZone(z);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setZone(null);
      }}
      onDrop={(e) => {
        const z = zoneAt(e);
        setZone(null);
        if (!z) return;
        e.preventDefault();
        const windowId = droppedWindow(e);
        if (windowId !== null) {
          void adoptWindow(windowId, { side: z === 'side' });
          return;
        }
        const tabId = e.dataTransfer.getData(TAB_DRAG);
        if (tabId && z === 'side') dockSide(tabId);
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const side = docked && tab.id === sideId;
        if (tab.suspended && !active && !side) return null;
        const mod = moduleFor(tab.app);
        if (!mod || !canOpenApp(mod.id, visible)) return null;
        const C = mod.component;
        const shown = active || side;
        const style = !docked || !shown ? undefined : active ? { left: 0, width: `calc(${pct} - ${DIVIDER / 2}px)` } : { left: `calc(${pct} + ${DIVIDER / 2}px)`, right: 0 };
        return (
          <section
            key={`${tab.id}:${tab.reloadKey}`}
            role="tabpanel"
            aria-label={side ? `${tab.title} (docked beside)` : tab.title}
            hidden={!shown}
            className={cx('absolute inset-y-0 overflow-hidden', !style && 'inset-x-0', resizing && 'pointer-events-none select-none')}
            style={style}
          >
            <div className="flex h-full flex-col">
              {side ? <SideBar id={tab.id} title={tab.title} /> : null}
              <div className="relative min-h-0 flex-1">
                <ModuleBoundary name={mod.manifest.name} {...moduleRecovery(mod, qc, navigate)} resetKey={tab.route}>
                  <Suspense fallback={<Spinner />}>
                    <TabProvider tabId={tab.id} route={tab.route} active={shown}>
                      <C tabId={tab.id} route={tab.route} active={shown} />
                    </TabProvider>
                  </Suspense>
                </ModuleBoundary>
              </div>
            </div>
          </section>
        );
      })}
      {docked ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the docked tab"
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          className={cx('absolute inset-y-0 z-10 cursor-col-resize bg-line hover:bg-primary/50 focus-visible:bg-primary/60', resizing && 'bg-primary/60')}
          style={{ left: `calc(${pct} - ${DIVIDER / 2}px)`, width: DIVIDER }}
          onPointerDown={(e) => {
            const r = ref.current?.getBoundingClientRect();
            if (!r) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            setResizing(true);
            const move = (ev: PointerEvent) => setSplit((ev.clientX - r.left) / r.width);
            const up = () => {
              setResizing(false);
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          onDoubleClick={() => setSplit(0.5)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              setSplit(split + (e.key === 'ArrowLeft' ? -0.05 : 0.05));
            }
          }}
        />
      ) : null}
      {zone ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-20 flex">
          <div className={cx('m-2 flex flex-1 items-center justify-center rounded-[10px] text-[13px] font-semibold', zone === 'tab' && 'border-2 border-dashed border-primary bg-selection/70 text-primary')}>{zone === 'tab' ? 'Open as a tab' : null}</div>
          <div className={cx('m-2 flex w-[40%] items-center justify-center rounded-[10px] text-[13px] font-semibold', zone === 'side' ? 'border-2 border-dashed border-primary bg-selection/70 text-primary' : 'border-2 border-dashed border-line')}>Dock beside</div>
        </div>
      ) : null}
    </main>
  );
}

/** The docked tab's own bar: its name, and what can be done with it. */
function SideBar({ id, title }: { id: string; title: string }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-surface pr-1 pl-3 text-[12.5px] font-semibold text-ink">
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </span>
      <IconButton icon="repeat" label="Swap sides" size={14} onClick={swapSides} />
      <IconButton icon="app-window" label="Move to new window" size={14} onClick={() => void detachTab(id)} />
      <IconButton icon="x" label="Undock" size={14} onClick={undockSide} />
    </div>
  );
}
