import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { call } from './bridge';
import { app } from './app-state';
import { navigate as navigateGlobal, openTab, setRoute, setTitle } from './tabs';
import { parseRoute } from '../modules/registry';
import { resolveWebLink } from '@shared/links';

/**
 * What a module can do with the tab it lives in: read its route, move within
 * it, open records in new tabs or windows, and name itself.
 */
export interface TabApi {
  tabId: string;
  route: string;
  active: boolean;
  path: string[];
  query: URLSearchParams;
  /** Same-tab navigation within the module. */
  go: (route: string) => void;
  /** Sidebar-style navigation (may switch tabs). */
  navigate: (route: string) => void;
  openInNewTab: (route: string, title?: string) => void;
  openInWindow: (route: string, title?: string) => void;
  setTitle: (title: string) => void;
  /** Opens a WorkSuite web link: natively if the desktop can, else in the browser. */
  openLink: (link: string | null | undefined) => void;
}

const Ctx = createContext<TabApi | null>(null);

export function openWebLink(link: string | null | undefined): void {
  const target = resolveWebLink(link, undefined);
  if (target.kind === 'tab') {
    const allowed = new Set(app.get().apps.map((a) => a.id));
    if (allowed.has(target.app) || ['home', 'notifications', 'settings'].includes(target.app)) navigateGlobal(target.route);
    else void call('app:openInBrowser', { path: link ?? '/' });
  } else if (target.kind === 'browser') {
    void call('app:openInBrowser', { path: target.path });
  }
}

export function TabProvider({ tabId, route, active, children, onGo }: { tabId: string; route: string; active: boolean; children: ReactNode; onGo?: (route: string) => void }) {
  const go = useCallback((r: string) => (onGo ? onGo(r) : setRoute(tabId, r)), [tabId, onGo]);
  const api = useMemo<TabApi>(() => {
    const { path, query } = parseRoute(route);
    return {
      tabId,
      route,
      active,
      path,
      query,
      go,
      navigate: (r) => navigateGlobal(r),
      openInNewTab: (r, title) => openTab(r, { title }),
      openInWindow: (r, title) => void call('windows:open', { kind: 'record', route: r, title }),
      setTitle: (t) => (onGo ? (document.title = t) : setTitle(tabId, t)),
      openLink: openWebLink,
    };
  }, [tabId, route, active, go, onGo]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useTab(): TabApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTab outside a tab');
  return v;
}

/** Sets the tab title while the component is mounted. */
export function useTabTitle(title: string | null | undefined): void {
  const { setTitle: set } = useTab();
  useEffect(() => {
    if (title) set(title);
  }, [title, set]);
}
