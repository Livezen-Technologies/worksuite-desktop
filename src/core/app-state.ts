import type { InputOf, LockState } from '@shared/ipc/contract';
import type { AppInfo, AuthState, Bootstrap, Preferences, PreferenceLock, StatusSnapshot, Transfer, UpdateStatus } from '@shared/types';
import { visibleApps, type AppDefinition } from '@shared/apps';
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
  resolvedTheme: 'light' | 'dark';
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
  resolvedTheme: 'light',
});

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme(prefs: Preferences | null): void {
  const theme = prefs?.theme ?? 'system';
  const dark = theme === 'dark' || (theme === 'system' && !!media?.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.density = prefs?.density ?? 'comfortable';
  app.set({ resolvedTheme: dark ? 'dark' : 'light' });
}

function applyBootstrap(b: Bootstrap | null): void {
  const apps = b ? visibleApps({ apps: b.apps, permissions: b.permissions, serverApps: b.serverApps }) : [];
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
  }

  on<AuthState>('auth:changed', async (a) => {
    app.set({ auth: a });
    if (a.stage === 'ready') {
      applyBootstrap(await call('session:bootstrap'));
      call('transfers:list').then((t) => app.set({ transfers: t }), () => undefined);
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
