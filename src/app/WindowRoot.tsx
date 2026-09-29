import { Suspense, useEffect, useState } from 'react';
import { canOpenApp } from '@shared/access';
import { useVisibleIds } from '../core/access';
import { call, isMac } from '../core/bridge';
import { TabProvider } from '../core/tab-context';
import { appForRoute, moduleFor } from '../modules/registry';
import { ModuleBoundary, Spinner, IconButton, cx } from '../components/ui';
import { useWindowBarHidden } from './windowChrome';
import { WINDOW_DRAG } from '../core/dock-drag';
import { Icon } from '../components/Icon';

/**
 * Secondary windows (FR-NAV-05/09): a record, a mini chat, a call or a
 * meeting in its own window, with a slim title bar. Always-on-top is offered
 * only for the kinds the shell allows (chat, timer, calls). A ring has no
 * title bar: it is answered or declined, not managed; a voice call draws its
 * own, on its gradient (CallWindow).
 *
 * A record window is a tab torn off the main window (FR-NAV-05/07): it can
 * dock back as a tab, or beside the main window's open tab, with a button or
 * by dragging its handle onto the main window. It tells the main process
 * where it has moved to, so it opens there again at the next start.
 */
const PINNABLE = new Set(['chat-mini', 'timer', 'call', 'video-call']);
export function WindowRoot({ hash }: { hash: string }) {
  const [kind, qs] = hash.replace('#/window/', '').split('?') as [string, string | undefined];
  const initial = new URLSearchParams(qs ?? '').get('route') ?? '/home';
  const [route, setRoute] = useState(initial);
  const [pinned, setPinned] = useState(kind === 'chat-mini');
  const [named, setNamed] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  const dockable = kind === 'record';
  const visible = useVisibleIds();
  const id = appForRoute(route);
  const mod = moduleFor(id);
  // The same decision as the main window's (shared/access); the main process closes such a window when access goes.
  const allowed = mod && canOpenApp(mod.id, visible);
  const barHidden = useWindowBarHidden();

  useEffect(() => {
    void call('windows:state').then(
      (s) => {
        setPinned(s.alwaysOnTop);
        setWindowId(s.id);
      },
      () => undefined,
    );
  }, []);

  const title = named ?? mod?.manifest.name ?? 'WorkSuite';

  useEffect(() => {
    if (!dockable) return;
    const t = setTimeout(() => void call('windows:describe', { route, title }).catch(() => undefined), 400);
    return () => clearTimeout(t);
  }, [dockable, route, title]);
  return (
    <div className="flex h-full flex-col">
      <div className={cx('drag flex h-10 shrink-0 items-center gap-2 bg-navy text-[13px] font-semibold text-white', (kind === 'ring' || kind === 'call' || barHidden) && 'hidden')} style={{ paddingLeft: isMac ? 78 : 12, paddingRight: isMac ? 8 : 140 }}>
        {dockable && windowId ? (
          <span
            draggable
            title="Drag onto the main window to dock"
            onDragStart={(e) => {
              e.dataTransfer.setData(WINDOW_DRAG, String(windowId));
              e.dataTransfer.effectAllowed = 'move';
            }}
            className="no-drag flex max-w-[60%] min-w-0 cursor-grab items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 hover:bg-white/10 active:cursor-grabbing"
          >
            <Icon name="app-window" size={14} className="shrink-0 text-navy-ink" />
            <span className="truncate">{title}</span>
          </span>
        ) : null}
        {dockable && windowId ? (
          // The rest of the bar still moves the window.
          <span className="flex-1" />
        ) : (
          <span className="flex-1 truncate">{title}</span>
        )}
        {dockable ? (
          <>
            <IconButton icon="layout-side" label="Dock beside the main window's tab" className="no-drag text-navy-ink hover:bg-white/10 hover:text-white" onClick={() => void call('windows:dock', { side: true })} size={15} />
            <IconButton icon="panel-close" label="Dock to main window" className="no-drag text-navy-ink hover:bg-white/10 hover:text-white" onClick={() => void call('windows:dock', {})} size={15} />
          </>
        ) : null}
        {PINNABLE.has(kind) ? (
          <IconButton
            icon={pinned ? 'pin-off' : 'pin'}
            label={pinned ? 'Stop keeping on top' : 'Keep on top'}
            className="no-drag text-navy-ink hover:bg-white/10 hover:text-white"
            onClick={() => void call('windows:setAlwaysOnTop', { value: !pinned }).then(setPinned)}
            size={15}
          />
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 bg-ground">
        {!mod || !allowed ? (
          <div className="p-6 text-[13px] text-ink-2">You don't have access to this.</div>
        ) : (
          <ModuleBoundary name={mod.manifest.name} onDiagnostics={() => setRoute('/diagnostics')} resetKey={route}>
            <Suspense fallback={<Spinner />}>
              <TabProvider tabId={`window-${kind}`} route={route} active onGo={setRoute} onTitle={setNamed}>
                <mod.component tabId={`window-${kind}`} route={route} active />
              </TabProvider>
            </Suspense>
          </ModuleBoundary>
        )}
      </div>
    </div>
  );
}
