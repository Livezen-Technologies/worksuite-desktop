import { applyDarkProfile } from '@shared/theme-profiles';
import type { InputOf, LockState } from '@shared/ipc/contract';
import type { AppInfo, AuthState, Bootstrap, Preferences, PreferenceLock, StatusSnapshot, SyncStatus, Transfer, UpdateStatus } from '@shared/types';
import { grantOf } from '@shared/access';
import { visibleApps, type AppDefinition } from '@shared/apps';
import type { LocalStatus } from '@shared/local-workspace';
import { call, hasDesktop, on } from './bridge';
import { createStore } from './store';
import { setRegional } from './time';
import { setLanguage } from './i18n';
import { updateDockBadge } from './dock-badge';

/**
 * Renderer-side mirror of the desktop's state, kept current by main-process
 * events. Components read it with `useStore(app, selector)`.
 */
export interface AppState {
  ready: boolean;
  info: AppInfo | null;
  auth: AuthState | null;
  bootstrap: Bootstrap | null;
  apps: AppDefinition[];
  status: StatusSnapshot | null;
  prefs: Preferences | null;
  locks: PreferenceLock[];
  lock: LockState | null;
  update: UpdateStatus | null;
  organizationId: string | null;
  transfers: Transfer[];
  /** Drive sync on this computer. */
  sync: SyncStatus | null;
  resolvedTheme: 'light' | 'dark';
  /**
   * Guest mode or an account (#149): the same window, shell and module screens either way; guest mode's apps are
   * `GUEST_APPS` and their data the Local Profile's. `signingIn`: a guest on the sign-in screen, guest mode still
   * open behind it. `moveOffer`: signed in from guest mode, so the move-your-data question is due.
   */
  session: { mode: 'guest' | 'account'; signingIn: boolean; moveOffer: boolean };
  /** The Local Profile, in guest mode. */
  local: LocalStatus | null;
}

export const app = createStore<AppState>({
  ready: false,
  info: null,
  auth: null,
  bootstrap: null,
  apps: [],
  status: null,
  prefs: null,
  locks: [],
  lock: null,
  update: null,
  organizationId: null,
  transfers: [],
  sync: null,
  resolvedTheme: 'light',
  session: { mode: 'account', signingIn: false, moveOffer: false },
  local: null,
});

/** Whether this window is in guest mode (#149). */
export function isGuest(): boolean {
  return app.get().session.mode === 'guest';
}

const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme(prefs: Preferences | null): void {
  const theme = prefs?.theme ?? 'system';
  const dark = theme === 'dark' || (theme === 'system' && !!media?.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  applyDarkProfile(root, prefs?.darkColorProfile, dark);
  root.dataset.density = prefs?.density ?? 'comfortable';
  if (prefs?.highContrast) root.dataset.contrast = 'more';
  else delete root.dataset.contrast;
  app.set({ resolvedTheme: dark ? 'dark' : 'light' });
}

/**
 * Every bootstrap — at sign-in, on an organization switch, after
 * `access.changed` or the periodic check — lands here: `apps` is the one list
 * of what the person may open (core/access), and the Shell closes the tabs of
 * any app that left it.
 */
function applyBootstrap(b: Bootstrap | null): void {
  // Guest mode's apps stand until an account signs in.
  if (!b && isGuest()) return;
  const apps = b ? visibleApps(grantOf(b)) : [];
  if (b) setRegional({ timezone: b.user.timezone, locale: b.user.locale, timeFormat: b.user.timeFormat });
  const current = app.get().organizationId;
  const orgId = b && current && b.organizations.some((o) => o.id === current) ? current : null;
  app.set({ bootstrap: b, apps, organizationId: orgId });
}

export async function initAppState(): Promise<void> {
  if (!hasDesktop()) {
    app.set({ ready: true });
    return;
  }
  const [info, auth, settings, status, update, lock] = await Promise.all([
    call('app:info'),
    call('auth:state'),
    call('settings:get'),
    call('status:snapshot'),
    call('updates:status'),
    call('security:state'),
  ]);
  app.set({ info, auth, prefs: settings.preferences, locks: settings.locks, status, update, lock });
  applyTheme(settings.preferences);
  setLanguage(settings.preferences.language);
  if (auth.stage === 'ready') {
    applyBootstrap(await call('session:bootstrap'));
    call('transfers:list').then((t) => app.set({ transfers: t }), () => undefined);
    call('sync:status').then((s) => app.set({ sync: s }), () => undefined);
  }

  on<AuthState>('auth:changed', async (a) => {
    // Signed in from guest mode: guest mode ends here, without a restart or another window, and the move question is due.
    if (a.stage === 'ready' && isGuest()) app.set({ session: { mode: 'account', signingIn: false, moveOffer: true }, local: null, apps: [] });
    // Signed out: nothing of the account stays, and guest mode opens only when chosen again.
    if (a.stage !== 'ready' && app.get().auth?.stage === 'ready') app.set({ session: { mode: 'account', signingIn: false, moveOffer: false } });
    app.set({ auth: a });
    if (a.stage === 'ready') {
      applyBootstrap(await call('session:bootstrap'));
      call('transfers:list').then((t) => app.set({ transfers: t }), () => undefined);
      call('sync:status').then((s) => app.set({ sync: s }), () => undefined);
    } else if (a.stage !== 'expired') {
      applyBootstrap(null);
    }
  });
  on<Bootstrap | null>('session:changed', (b) => applyBootstrap(b));
  on<StatusSnapshot>('status:changed', (s) => app.set({ status: s }));
  if (info.platform === 'macos') {
    // The Dock badge is painted onto the icon on macOS (see dock-badge); it only repaints when the count changes.
    const sync = () => {
      const s = app.get();
      void updateDockBadge(s.status, s.auth?.stage === 'ready', s.prefs?.badgeCount !== false);
    };
    sync();
    app.subscribe(sync);
  }
  on<Preferences>('settings:changed', (p) => {
    app.set({ prefs: p });
    applyTheme(p);
    setLanguage(p.language);
  });
  on<LockState>('lock:changed', (l) => app.set({ lock: l }));
  on<UpdateStatus>('update:changed', (u) => app.set({ update: u }));
  on<Transfer[]>('transfers:changed', (t) => app.set({ transfers: t }));
  on<SyncStatus>('sync:changed', (s) => app.set({ sync: s }));
  on<{ organizationId: string | null }>('organization:changed', (o) => app.set({ organizationId: o.organizationId }));
  media?.addEventListener('change', () => applyTheme(app.get().prefs));
  app.set({ ready: true });
}

export async function updatePrefs(patch: Partial<Preferences>): Promise<void> {
  const r = await call('settings:set', patch as InputOf<'settings:set'>);
  app.set({ prefs: r.preferences, locks: r.locks });
  applyTheme(r.preferences);
  setLanguage(r.preferences.language);
}

export function isLocked(key: keyof Preferences): PreferenceLock | undefined {
  return app.get().locks.find((l) => l.key === key);
}

export function organizationName(id: string | null): string {
  const b = app.get().bootstrap;
  if (!b) return '';
  if (id === null) return b.organizations.length > 1 ? 'All organizations' : (b.organizations[0]?.name ?? b.user.organizationName ?? 'WorkSuite');
  return b.organizations.find((o) => o.id === id)?.name ?? 'Organization';
}
