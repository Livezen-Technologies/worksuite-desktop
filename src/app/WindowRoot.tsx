import { Suspense, useEffect, useState } from 'react';
import { call, isMac } from '../core/bridge';
import { TabProvider } from '../core/tab-context';
import { appForRoute, moduleFor } from '../modules/registry';
import { ModuleBoundary, Spinner, IconButton, cx } from '../components/ui';
import { app } from '../core/app-state';
import { useStore } from '../core/store';

/**
 * Secondary windows (FR-NAV-05/09): a record or a mini chat in its own
 * window, with a slim title bar. Always-on-top is offered only for the kinds
 * the shell allows (chat, timer).
 */
export function WindowRoot({ hash }: { hash: string }) {
  const [kind, qs] = hash.replace('#/window/', '').split('?') as [string, string | undefined];
  const initial = new URLSearchParams(qs ?? '').get('route') ?? '/home';
  const [route, setRoute] = useState(initial);
  const [pinned, setPinned] = useState(kind === 'chat-mini');
  const apps = useStore(app, (s) => s.apps);
  const id = appForRoute(route);
  const mod = moduleFor(id);
  const allowed = mod && (mod.always || apps.some((a) => a.id === id));

  useEffect(() => {
    void call('windows:state').then((s) => setPinned(s.alwaysOnTop), () => undefined);
  }, []);

  const title = mod?.manifest.name ?? 'WorkSuite';
  return (
    <div className="flex h-full flex-col">
      <div className={cx('drag flex h-10 shrink-0 items-center gap-2 bg-navy text-[13px] font-semibold text-white')} style={{ paddingLeft: isMac ? 78 : 12, paddingRight: isMac ? 8 : 140 }}>
        <span className="flex-1 truncate">{title}</span>
        {kind === 'chat-mini' || kind === 'timer' ? (
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
              <TabProvider tabId={`window-${kind}`} route={route} active onGo={setRoute}>
                <mod.component tabId={`window-${kind}`} route={route} active />
              </TabProvider>
            </Suspense>
          </ModuleBoundary>
        )}
      </div>
    </div>
  );
}
