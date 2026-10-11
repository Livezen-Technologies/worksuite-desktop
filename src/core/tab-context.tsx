import { notificationContext } from '@shared/notification-target';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { call, errorMessage } from './bridge';
import { toast } from './toasts';
import { canOpen, canOpenDesktopRoute, refuse } from './access';
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
  /** Opens a WorkSuite web link: natively if the desktop can, else in the browser; never in an app the person may not open. */
  openLink: (link: string | null | undefined) => void;
}

const Ctx = createContext<TabApi | null>(null);

/**
 * Opens a WorkSuite web link (a notification, a chat card, a search hit):
 * in its desktop tab, or in the browser for an app without a desktop module
 * yet, or a page of no app. A link into an app the person may not open is
 * refused, saying so — never handed to the browser instead.
 */
export function openWebLink(link: string | null | undefined): void {
  const target = resolveWebLink(link, undefined);
  if (target.kind === 'none') return;
  if (target.app && !canOpen(target.app)) {
    refuse(target.app);
    return;
  }
  if (target.kind === 'tab') navigateGlobal(target.route);
  else void call('app:openInBrowser', { path: target.path }).catch((e) => toast('error', errorMessage(e)));
}

/** A route in a window of its own, when the person may open its app. */
export function openRouteInWindow(route: string, title?: string): void {
  if (!canOpenDesktopRoute(route)) return refuse(route);
  void call('windows:open', { kind: 'record', route, title }).catch((e) => toast('error', errorMessage(e)));
}

export function TabProvider({ tabId, route, active, children, onGo, onTitle }: { tabId: string; route: string; active: boolean; children: ReactNode; onGo?: (route: string) => void; onTitle?: (title: string) => void }) {
  useEffect(() => {
    if (!active) return;
    const report = () => { if (document.hasFocus()) void call('notifications:context', { viewing: notificationContext(route) }).catch(() => undefined); };
    report(); window.addEventListener('focus', report);
    return () => window.removeEventListener('focus', report);
  }, [active, route]);
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
      openInWindow: (r, title) => openRouteInWindow(r, title),
      setTitle: (t) => {
        if (!onGo) return setTitle(tabId, t);
        document.title = t;
        onTitle?.(t);
      },
      openLink: openWebLink,
    };
  }, [tabId, route, active, go, onGo, onTitle]);
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
