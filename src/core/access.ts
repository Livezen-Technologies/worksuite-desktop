import { useMemo } from 'react';
import type { AppDefinition } from '@shared/apps';
import { canOpenApp, canOpenLink, canOpenRoute, canOpenWebPath } from '@shared/access';
import { app } from './app-state';
import { useStore } from './store';
import { toast } from './toasts';

/**
 * The renderer's side of "an app you were not given is not there"
 * (shared/access.ts): the apps the bootstrap allows are `app.apps`, and every
 * way into an app — a tab, a link, a button in another app, a shortcut —
 * asks these before it shows or opens anything.
 */

/** What a refusal says; the same wherever it happens. */
export const NO_ACCESS = "You don't have access to this.";

const cache = new WeakMap<readonly AppDefinition[], Set<string>>();

/** The ids of a visible-apps list, kept per list so a selector can use them. */
export function idsOf(apps: readonly AppDefinition[]): Set<string> {
  let ids = cache.get(apps);
  if (!ids) {
    ids = new Set(apps.map((a) => a.id));
    cache.set(apps, ids);
  }
  return ids;
}

/** The ids of the apps the person may open now. */
export function visibleIds(): Set<string> {
  return idsOf(app.get().apps);
}

/** Whether the person may open this app (a catalogue id, a shell screen, or a part of an app such as calls). */
export function canOpen(id: string): boolean {
  return canOpenApp(id, visibleIds());
}

/** Whether a desktop route belongs to an app the person may open (or to none). */
export function canOpenDesktopRoute(route: string): boolean {
  return canOpenRoute(route, visibleIds());
}

/** Whether a WorkSuite web path belongs to an app the person may open (or to none). */
export function canOpenWeb(path: string): boolean {
  return canOpenWebPath(path, visibleIds());
}

/** Whether a web link (a notification's, a search hit's) opens in an app the person may open. */
export function canFollowLink(link: string | null | undefined): boolean {
  return canOpenLink(link, visibleIds());
}

/** Says no, the same way everywhere. */
export function refuse(): void {
  toast('error', NO_ACCESS);
}

/** Whether the person may open this app; re-renders when access changes. */
export function useCanOpen(id: string): boolean {
  return useStore(app, (s) => canOpenApp(id, idsOf(s.apps)));
}

/** The ids of the apps the person may open; re-renders when access changes. */
export function useVisibleIds(): Set<string> {
  const apps = useStore(app, (s) => s.apps);
  return useMemo(() => idsOf(apps), [apps]);
}
