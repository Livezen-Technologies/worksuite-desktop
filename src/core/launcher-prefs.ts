import { normaliseStored, resetPrefs, resolvePrefs, type LauncherOrgDefaults, type LauncherPrefs, type StoredLauncherPrefs } from '@shared/launcher';
import { apiGet, apiPut } from './api';
import { useEffect } from 'react';
import { app, type AppState } from './app-state';
import { effectiveShortcuts } from './commands';
import { createStore, useStore } from './store';

/**
 * The app launcher's preferences (worksuite-desktop#201), per person and synced between their devices.
 *
 * The server keeps them, in the generic per-user preferences every WorkSuite screen uses (`GET|PUT
 * /api/prefs/desktop.launcher`, a row of `user_prefs`); this computer keeps a copy, read synchronously, so the
 * launcher opens at once and works offline. A change is made here first, marked unsent, and sent a moment later;
 * the newer of the two copies (`updatedAt`) wins when they meet. Guest mode has no server: its copy stays here.
 */
export const LAUNCHER_SCOPE = 'desktop.launcher';
const PATH = `/api/prefs/${LAUNCHER_SCOPE}`;
const cacheKey = (user: string) => `ws.launcher.${user}`;
/** How long a change waits before it is sent, so a few clicks make one request. */
export const SEND_DELAY_MS = 800;

export interface LauncherPrefsState {
  /** Whose preferences these are (null: nobody signed in). */
  user: string | null;
  /** The person's own choices; null until they make one (the defaults stand in). */
  stored: StoredLauncherPrefs | null;
  /** Changed here and not yet on the server. */
  dirty: boolean;
}

export const launcherPrefs = createStore<LauncherPrefsState>({ user: null, stored: null, dirty: false });

interface Cached {
  prefs: StoredLauncherPrefs | null;
  dirty: boolean;
}

function readCache(user: string): Cached {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey(user)) ?? 'null') as { prefs?: unknown; dirty?: unknown } | null;
    if (!raw || typeof raw !== 'object') return { prefs: null, dirty: false };
    return { prefs: raw.prefs == null ? null : normaliseStored(raw.prefs), dirty: raw.dirty === true };
  } catch {
    return { prefs: null, dirty: false };
  }
}

function writeCache(user: string, c: Cached): void {
  try {
    localStorage.setItem(cacheKey(user), JSON.stringify(c));
  } catch {
    // Storage full or blocked: the server's copy is still the person's.
  }
}

function currentUserOf(s: AppState): string | null {
  if (s.session.mode === 'guest') return 'guest';
  const id = s.auth?.user?.id;
  return id == null ? null : String(id);
}
const currentUser = () => currentUserOf(app.get());

const online = () => app.get().session.mode !== 'guest' && app.get().auth?.stage === 'ready';

/** The organization's defaults, from the desktop policy. */
export function orgDefaults(): LauncherOrgDefaults {
  const p = app.get().bootstrap?.policy;
  return { pinned: p?.launcher_pinned ?? [], order: p?.launcher_order ?? [] };
}

/** Takes up the person's copy on this computer, when the person changed. Synchronous: the launcher opens with it. */
export function ensureLauncherPrefs(): void {
  const user = currentUser();
  if (user === launcherPrefs.get().user) return;
  if (timer) clearTimeout(timer);
  timer = null;
  if (user === null) {
    launcherPrefs.set({ user: null, stored: null, dirty: false });
    return;
  }
  const c = readCache(user);
  launcherPrefs.set({ user, stored: c.prefs, dirty: c.dirty });
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSync = 0;
let inflight: Promise<void> | null = null;

/**
 * Brings this computer's copy and the server's together: the newer wins, and an unsent change here is sent.
 * Fails quietly offline — the copy here stands, still marked unsent.
 */
export function syncLauncherPrefs(): Promise<void> {
  ensureLauncherPrefs();
  if (inflight) return inflight;
  const user = launcherPrefs.get().user;
  if (!user || !online()) return Promise.resolve();
  lastSync = Date.now();
  inflight = (async () => {
    try {
      const res = await apiGet<{ prefs: unknown }>(PATH);
      if (launcherPrefs.get().user !== user) return;
      const remote = res?.prefs == null ? null : normaliseStored(res.prefs);
      const { stored, dirty } = launcherPrefs.get();
      if (dirty && stored && (!remote || stored.updatedAt >= remote.updatedAt)) {
        await send(user, stored);
      } else if (remote) {
        launcherPrefs.set({ stored: remote, dirty: false });
        writeCache(user, { prefs: remote, dirty: false });
      }
    } catch {
      // Offline or refused: what is here stands.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Syncs when the last sync is older than `ms` — each time the launcher opens. */
export function syncLauncherPrefsIfStale(ms = 30_000): void {
  if (Date.now() - lastSync >= ms) void syncLauncherPrefs();
}

async function send(user: string, prefs: StoredLauncherPrefs): Promise<void> {
  await apiPut(PATH, { prefs });
  // Changed again while on its way: that change is sent by its own timer.
  if (launcherPrefs.get().user !== user || launcherPrefs.get().stored !== prefs) return;
  launcherPrefs.set({ dirty: false });
  writeCache(user, { prefs, dirty: false });
}

/** Sends an unsent change now (the timer's work; tests and sign-out call it directly). */
export async function flushLauncherPrefs(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const { user, stored, dirty } = launcherPrefs.get();
  if (!user || !stored || !dirty || !online()) return;
  try {
    await send(user, stored);
  } catch {
    // Offline: sent at the next sync.
  }
}

/** Saves the person's preferences: here at once, on the server a moment later. */
export function saveLauncherPrefs(next: StoredLauncherPrefs, now = Date.now()): void {
  ensureLauncherPrefs();
  const user = launcherPrefs.get().user;
  const prefs = { ...next, updatedAt: Math.max(now, (launcherPrefs.get().stored?.updatedAt ?? 0) + 1) };
  launcherPrefs.set({ stored: prefs, dirty: true });
  if (!user) return;
  writeCache(user, { prefs, dirty: true });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushLauncherPrefs(), SEND_DELAY_MS);
}

/** The preferences as the launcher uses them, with the organization's defaults filled in. */
export function currentLauncherPrefs(): LauncherPrefs {
  ensureLauncherPrefs();
  return resolvePrefs(launcherPrefs.get().stored, orgDefaults());
}

/** Changes the preferences; `fn` returning null (a full Pinned row, say) changes nothing and returns false. */
export function updateLauncherPrefs(fn: (p: LauncherPrefs) => LauncherPrefs | null): boolean {
  const next = fn(currentLauncherPrefs());
  if (!next) return false;
  saveLauncherPrefs(next);
  return true;
}

/** Reset to default: the defaults, and the organization's pinned apps and order. */
export function resetLauncherPrefs(): void {
  saveLauncherPrefs(resetPrefs(Date.now()));
}

/** The launcher's shortcut, for the shell's keymap. */
export function launcherShortcut(): string {
  return currentLauncherPrefs().shortcut;
}

/** Every command's shortcut as the shell answers them: the person's own, and the launcher's from its preferences. */
export function shellShortcuts(overrides: Record<string, string> | undefined): Record<string, string> {
  return { ...effectiveShortcuts(overrides), launcher: launcherShortcut() };
}

/** The preferences, kept current in a component. */
export function useLauncherPrefs(): LauncherPrefs {
  const user = useStore(app, currentUserOf);
  const held = useStore(launcherPrefs, (s) => s.user);
  const stored = useStore(launcherPrefs, (s) => s.stored);
  const policy = useStore(app, (s) => s.bootstrap?.policy);
  // Somebody else signed in a moment ago: their copy, read here, until the store takes it up after this render.
  useEffect(() => {
    if (held !== user) ensureLauncherPrefs();
  }, [held, user]);
  const own = held === user ? stored : user === null ? null : readCacheMemo(user);
  return resolveCached(own, policy?.launcher_pinned, policy?.launcher_order);
}

let cacheMemo: { user: string; prefs: StoredLauncherPrefs | null } | null = null;
function readCacheMemo(user: string): StoredLauncherPrefs | null {
  if (cacheMemo?.user !== user) cacheMemo = { user, prefs: readCache(user).prefs };
  return cacheMemo.prefs;
}

let memo: { stored: unknown; pinned: unknown; order: unknown; value: LauncherPrefs } | null = null;
function resolveCached(stored: StoredLauncherPrefs | null, pinned: string[] | undefined, order: string[] | undefined): LauncherPrefs {
  if (memo && memo.stored === stored && memo.pinned === pinned && memo.order === order) return memo.value;
  const value = resolvePrefs(stored, { pinned, order });
  memo = { stored, pinned, order, value };
  return value;
}

/**
 * Keeps the preferences with whoever is signed in: the copy here at once, then the server's. Called by the shell.
 */
export function initLauncherPrefs(): () => void {
  let user: string | null | undefined;
  const check = () => {
    const now = currentUser();
    if (now === user) return;
    user = now;
    ensureLauncherPrefs();
    void syncLauncherPrefs();
  };
  check();
  return app.subscribe(check);
}

/** For tests: forget everything held in memory. */
export function resetLauncherPrefsForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  inflight = null;
  lastSync = 0;
  memo = null;
  cacheMemo = null;
  launcherPrefs.set({ user: null, stored: null, dirty: false });
}
