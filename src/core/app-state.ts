import { appearanceOf, applyAppearance, type AppearancePrefs } from '@shared/theme-profiles';
import type { InputOf, LockState } from '@shared/ipc/contract';
import type { AppInfo, AuthState, Bootstrap, Preferences, PreferenceLock, StatusSnapshot, SyncStatus, Transfer, UpdateStatus } from '@shared/types';
import { grantOf } from '@shared/access';
import { visibleApps, type AppDefinition } from '@shared/apps';
import type { LocalStatus } from '@shared/local-workspace';
import type { AccountKind, AccountsState, AddingAccount, UnknownLink } from '@shared/accounts';
import type { BrowserSignIn, CloudStatus } from '@shared/cloud';
import type { ConnectRun } from '@shared/discovery';
import { call, hasDesktop, on } from './bridge';
import { createStore } from './store';
import { setRegional } from './time';
import { setLanguage } from './i18n';
import { updateDockBadge, updateTaskbarOverlay } from './dock-badge';

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
   * open behind it. `moveOffer`: signed in from guest mode, so the move-your-data question is due. `adding`: the
   * add-account flow is open (Connection & Startup screens 1, 2, 6) — null (or absent) when it is not.
   */
  session: { mode: 'guest' | 'account'; signingIn: boolean; moveOffer: boolean; adding?: AddingAccount | null };
  /** The Local Profile, in guest mode. */
  local: LocalStatus | null;
  /** Accounts side by side (Connection & Startup): null until the desktop answers `accounts:state`. */
  accounts: AccountsState | null;
  /** The connect run on screen 7, from `connect:progress`. */
  connect: ConnectRun | null;
  /** The browser sign-in in progress (screen 3), from `signin:changed`. */
  signin: BrowserSignIn | null;
  /** The active Personal account's Cloud side, from `cloud:changed`. */
  cloud: CloudStatus | null;
  /** A link to a server that is not added (screen 16), from `accounts:unknownLink`; null once answered. */
  unknownLink: UnknownLink | null;
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
  session: { mode: 'account', signingIn: false, moveOffer: false, adding: null },
  local: null,
  accounts: null,
  connect: null,
  signin: null,
  cloud: null,
  unknownLink: null,
});

/**
 * Add Account (Connection & Startup screens 1, 2, 6): the startup selector (`choose`), Personal or Enterprise, with an
 * address or setup link to start from. The desktop is told too (`accounts:addStart`), so a `worksuite://setup` link
 * arriving now lands in this flow; a desktop without accounts answers UNSUPPORTED, which changes nothing here.
 */
export function startAdding(step: AddingAccount['step'], prefill?: string): void {
  const adding: AddingAccount = prefill ? { step, prefill } : { step };
  app.set({ session: { ...app.get().session, adding }, connect: null });
  const kind: AccountKind | undefined = step === 'choose' ? undefined : step;
  void call('accounts:addStart', kind ? { kind } : {}).catch(() => undefined);
}

/** Leaves Add Account: back to the account that is open (or the startup selector when there is none). */
export function cancelAdding(): void {
  const run = app.get().connect;
  if (run?.state === 'running') void call('connect:cancel', { runId: run.runId }).catch(() => undefined);
  app.set({ session: { ...app.get().session, adding: null }, connect: null });
  void call('accounts:addCancel').catch(() => undefined);
}

/**
 * Which `connect:progress` runs this window follows: the one on screen 7 (same runId), or any when none is on screen.
 * A run started elsewhere (Settings' Re-run discovery) never replaces the one being looked at.
 */
export function acceptsRun(current: ConnectRun | null, next: ConnectRun): boolean {
  return !current || current.runId === next.runId;
}

/** Whether this window is in guest mode (#149). */
export function isGuest(): boolean {
  return app.get().session.mode === 'guest';
}

const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** The first apply is the page's own start (the preload drew the profile already); later ones ease in. */
let themed = false;

/**
 * The mode and colour profile (worksuite-desktop#234), density and contrast, onto this page at once. Every window
 * runs this for each change — its own, `settings:changed`, `appearance:changed` — and for the computer's
 * appearance changing under System.
 */
function applyTheme(prefs: Preferences | null): void {
  const r = applyAppearance(document, appearanceOf(prefs), !!media?.matches, { transition: themed });
  themed = true;
  const root = document.documentElement;
  root.dataset.density = prefs?.density ?? 'comfortable';
  if (prefs?.highContrast) root.dataset.contrast = 'more';
  else delete root.dataset.contrast;
  app.set({ resolvedTheme: r.theme });
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
  // Accounts side by side (Connection & Startup). A desktop without them answers UNSUPPORTED: the store stays null.
  void (async () => {
    try {
      const a = await call('accounts:state');
      if (a && typeof a === 'object') app.set({ accounts: a });
    } catch {
      // Not available in this version.
    }
  })();
  on<AccountsState>('accounts:changed', (a) => app.set({ accounts: a }));
  on<ConnectRun>('connect:progress', (r) => {
    if (r && typeof r === 'object' && acceptsRun(app.get().connect, r)) app.set({ connect: r });
  });
  on<UnknownLink>('accounts:unknownLink', (l) => {
    if (l && typeof l === 'object' && typeof l.host === 'string') app.set({ unknownLink: l });
  });
  on<BrowserSignIn | null>('signin:changed', (b) => app.set({ signin: b }));
  on<CloudStatus>('cloud:changed', (c) => app.set({ cloud: c }));
  on<StatusSnapshot>('status:changed', (s) => app.set({ status: s }));
  if (info.platform === 'windows') {
    // The taskbar button's overlay with the count (ENH-MAIL-05 MNA-TRY-03): Windows draws no badge count itself.
    const sync = () => {
      const s = app.get();
      void updateTaskbarOverlay(s.status, s.auth?.stage === 'ready', s.prefs?.badgeCount !== false);
    };
    sync();
    app.subscribe(sync);
  }
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
  // The colour profile from the window manager, to every page of the app at once (#234).
  on<AppearancePrefs>('appearance:changed', (a) => {
    const p = app.get().prefs;
    if (!p || !a || typeof a !== 'object') return;
    const prefs = { ...p, appearance: a, theme: a.mode };
    app.set({ prefs });
    applyTheme(prefs);
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
