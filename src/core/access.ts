import { useMemo } from 'react';
import { GUEST_APPS, findApp, type AppDefinition } from '@shared/apps';
import { GUEST_VISIBLE, canOpenApp, canOpenLink, canOpenRoute, canOpenWebPath, guestLockedApp, routeOwner, type VisibleApps } from '@shared/access';
import { askForAccess } from './access-request';
import { app, isGuest } from './app-state';
import { openSignInPanel } from './session';
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
/** Guest mode's ids: a Set (for `has`) that says it is guest mode's, so shell screens and parts of apps stay closed. */
const GUEST_IDS: Set<string> & VisibleApps = Object.assign(new Set(GUEST_APPS.map((a) => a.id)), { guest: GUEST_VISIBLE.guest });

/**
 * The ids of a visible-apps list, kept per list so a selector can use them. Guest mode's list (#149) answers as
 * guest mode: its apps and Settings, nothing else (shared/access GUEST_VISIBLE).
 */
export function idsOf(apps: readonly AppDefinition[]): Set<string> {
  if (apps === GUEST_APPS) return GUEST_IDS;
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

/**
 * Says no, the same way everywhere. In guest mode (#149) an app that needs an account opens the in-app
 * "Sign in to use …" panel instead — from the sidebar, a link, a deep link or ⌘K alike.
 */
export function refuse(target?: string): void {
  const locked = isGuest() && target ? guestLockedApp(target) : null;
  if (isGuest()) {
    openSignInPanel(locked ?? target ?? '');
    return;
  }
  // An app the server gives by name can be asked for, from the refusal itself (the "Access denied" screen's request).
  const def = target ? requestableApp(target) : null;
  toast('error', NO_ACCESS, def ? { label: 'Ask for access', run: () => askForAccess({ slug: def.app!, label: def.label, ...(target?.startsWith('/') ? { path: target } : {}) }) } : undefined);
}

/** The app a refused target belongs to, when the server gives it by name (its `app` slug); null otherwise. */
export function requestableApp(target: string): AppDefinition | null {
  const id = target.includes('/') || target.includes('?') ? routeOwner(target.startsWith('/') ? target : `/${target}`) : target;
  const def = findApp(id);
  return def?.app ? def : null;
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
