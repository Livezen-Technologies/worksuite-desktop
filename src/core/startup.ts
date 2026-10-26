import { STARTUP_KEY, startupTarget } from '@shared/desktop-settings';
import { canOpenDesktopRoute } from './access';
import { app, isGuest } from './app-state';
import { startRoute } from './session';
import { activeTab, openTab } from './tabs';
import { toast } from './toasts';

/**
 * The startup screen (desktop settings `startup.screen`, the person's or the organisation's): applied once, when the
 * tabs have been brought back. `home` opens Home, `last` stays on the tab that was in front, `app:<id>` opens that app
 * and `route:<path>` that page — each only where the person may open it now (an app turned off or no longer given
 * opens Home instead, and says so). Returns the route opened, or null when the tab in front stays.
 */
export function applyStartupScreen(restored: boolean): string | null {
  const s = app.get();
  const screen = s.desktopSettings?.effective[STARTUP_KEY]?.value ?? 'last';
  const last = restored ? (activeTab()?.route ?? null) : null;
  const { route, fallback } = startupTarget(screen, { apps: s.apps, canOpenRoute: canOpenDesktopRoute, lastRoute: last, home: startRoute() });
  if (fallback && !isGuest()) toast('info', fallback);
  if (!route) return null;
  if (activeTab()?.route === route) return route;
  openTab(route);
  return route;
}
