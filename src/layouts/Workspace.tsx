import { Suspense } from 'react';
import { useStore } from '../core/store';
import { tabsStore } from '../core/tabs';
import { TabProvider } from '../core/tab-context';
import { navigate } from '../core/tabs';
import { moduleFor } from '../modules/registry';
import { ModuleBoundary, Spinner } from '../components/ui';

/**
 * The workspace: every live tab stays mounted and hidden when inactive, so
 * switching is immediate (NFR-PERF-02); suspended tabs are unmounted and
 * rebuilt from their route on activation (FR-NAV-08). Each module renders
 * inside its own error boundary (FR-REG-03).
 */
export function Workspace() {
  const tabs = useStore(tabsStore, (s) => s.tabs);
  const activeId = useStore(tabsStore, (s) => s.activeId);
  return (
    <main className="relative min-h-0 min-w-0 flex-1 bg-ground">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        if (tab.suspended && !active) return null;
        const mod = moduleFor(tab.app);
        if (!mod) return null;
        const C = mod.component;
        return (
          <section key={`${tab.id}:${tab.reloadKey}`} role="tabpanel" aria-label={tab.title} hidden={!active} className="absolute inset-0 overflow-hidden">
            <ModuleBoundary name={mod.manifest.name} onDiagnostics={() => navigate('/diagnostics')} resetKey={tab.route}>
              <Suspense fallback={<Spinner />}>
                <TabProvider tabId={tab.id} route={tab.route} active={active}>
                  <C tabId={tab.id} route={tab.route} active={active} />
                </TabProvider>
              </Suspense>
            </ModuleBoundary>
          </section>
        );
      })}
    </main>
  );
}
