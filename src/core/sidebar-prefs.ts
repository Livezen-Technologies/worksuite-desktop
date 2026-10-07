import { useEffect, useMemo } from 'react';
import { findApp } from '@shared/apps';
import { applySidebarOp, EMPTY_SIDEBAR_PREFS, normaliseSidebarPrefs, type SidebarOp, type SidebarOrderBody, type SidebarPrefsData } from '@shared/sidebar-prefs';
import { ApiError, apiDelete, apiGet, apiPut } from './api';
import { app, type AppState } from './app-state';
import { t } from './i18n';
import { createStore, useStore } from './store';
import { toast } from './toasts';

/**
 * Each person's own sidebar — pinned apps, apps removed from it, each section's order (shared/sidebar-prefs) — kept
 * by the server per person and organisation (`/api/sidebar/prefs`), with a copy on this computer per person, server
 * and organisation, read synchronously so the sidebar draws at once.
 *
 * A change shows at once and is sent at once, one after another; the server answers with the whole state. A change
 * the server refuses (or that cannot reach it) is taken back off the screen, and an error says so.
 *
 * Every call names the organisation open now (`?org=<id>`; none for All organizations): the server keeps one sidebar
 * per person and organisation.
 *
 * Guest mode has no server; a server from before the endpoint answers 404, and one whose tables are not made yet
 * refuses changes with its own 503: the copy on this computer is then the person's only one, and changes are made to
 * it alone.
 *
 * The sidebar used to show the browser apps and channels pinned from the launcher (`Preferences.pinnedApps`, a
 * setting of this computer). The first time a person's sidebar is read with no saved preferences, those are pinned
 * here, in order, once; `pinnedApps` is not read for the sidebar after that.
 */
export const SIDEBAR_PREFS_PATH = '/api/sidebar/prefs';
const cacheKey = (id: string) => `ws.sidebar.${id}`;
/** Whether the old launcher pins were moved over, to the server or into the copy kept here: each once. */
const migratedKey = (id: string, source: 'server' | 'local') => `ws.sidebar.migrated.${source === 'local' ? 'local.' : ''}${id}`;

/** Where the preferences are kept: the server, or this computer alone. */
export type SidebarSource = 'server' | 'local';

interface Pending {
  seq: number;
  op: SidebarOp;
}

export interface SidebarPrefsState {
  /** Whose preferences: person, server and organisation (null: nobody signed in). */
  id: string | null;
  /** The organisation every call names (null: All organizations, or none). */
  org: string | null;
  source: SidebarSource;
  /** The server answered for this person since they were taken up. */
  loaded: boolean;
  /** The server's last word (or this computer's copy). */
  confirmed: SidebarPrefsData;
  /** Sent and not answered yet: shown already. */
  pending: Pending[];
  /** What the sidebar shows: `confirmed` with `pending` applied. */
  data: SidebarPrefsData;
}

const INITIAL: SidebarPrefsState = { id: null, org: null, source: 'server', loaded: false, confirmed: EMPTY_SIDEBAR_PREFS, pending: [], data: EMPTY_SIDEBAR_PREFS };

export const sidebarPrefs = createStore<SidebarPrefsState>(INITIAL);

interface Cached {
  source: SidebarSource;
  data: SidebarPrefsData;
}

function readCache(id: string): Cached | null {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey(id)) ?? 'null') as { source?: unknown; data?: unknown } | null;
    if (!raw || typeof raw !== 'object') return null;
    const data = normaliseSidebarPrefs(raw.data);
    if (!data) return null;
    return { source: raw.source === 'local' ? 'local' : 'server', data };
  } catch {
    return null;
  }
}

function writeCache(id: string, source: SidebarSource, data: SidebarPrefsData): void {
  try {
    localStorage.setItem(cacheKey(id), JSON.stringify({ source, data }));
  } catch {
    // Storage full or blocked: the server's copy is still the person's.
  }
}

function isMigrated(id: string, source: SidebarSource): boolean {
  try {
    return localStorage.getItem(migratedKey(id, source)) === '1';
  } catch {
    return true;
  }
}

function markMigrated(id: string, source: SidebarSource): void {
  try {
    localStorage.setItem(migratedKey(id, source), '1');
  } catch {
    // Not remembered: the next start finds the pins already there.
  }
}

/** Whose sidebar this window shows: the guest, or the person on this server in this organisation. */
export function sidebarIdentity(s: AppState): string | null {
  if (s.session?.mode === 'guest') return 'guest';
  const user = s.auth?.user?.id;
  if (user == null) return null;
  return `${user}@${s.auth?.server?.origin ?? ''}#${s.organizationId ?? 'all'}`;
}

/** A path for the organisation open now: `?org=<id>`, or nothing for All organizations. */
const scoped = (path: string, org: string | null) => (org ? `${path}?org=${encodeURIComponent(org)}` : path);

/**
 * The server has no sidebar preferences to keep: an older one (404), or one whose tables are not made yet (its own
 * 503, which carries no code — the desktop's own 503s, offline, always do).
 */
const noEndpoint = (e: unknown) => e instanceof ApiError && (e.status === 404 || (e.status === 503 && !e.code));
const notReady = (e: unknown) => e instanceof ApiError && e.status === 503 && !e.code;

const isGuestMode = () => app.get().session?.mode === 'guest';
const online = () => !isGuestMode() && app.get().auth?.stage === 'ready';
const fold = (base: SidebarPrefsData, pending: Pending[]) => pending.reduce((d, p) => applySidebarOp(d, p.op), base);

/** Bumped when the person, server or organisation changes: answers for the one before are dropped. */
let generation = 0;
/** Bumped by each answered change: a read started before it is out of date. */
let answered = 0;
let seq = 0;
let queue: Promise<unknown> = Promise.resolve();
let inflight: { gen: number; promise: Promise<void> } | null = null;
let migrating: string | null = null;

/** Takes up the copy on this computer for whoever's sidebar this is now. Synchronous: the sidebar draws with it. */
export function ensureSidebarPrefs(): void {
  const s = app.get();
  const id = sidebarIdentity(s);
  if (id === sidebarPrefs.get().id) return;
  generation++;
  if (id === null) {
    sidebarPrefs.set(INITIAL);
    return;
  }
  const c = readCache(id);
  const data = c?.data ?? EMPTY_SIDEBAR_PREFS;
  sidebarPrefs.set({ id, org: isGuestMode() ? null : (s.organizationId ?? null), source: isGuestMode() ? 'local' : (c?.source ?? 'server'), loaded: false, confirmed: data, pending: [], data });
}

/**
 * Reads the person's preferences from the server. A server without the endpoint (404, or its own 503) leaves them on
 * this computer; offline, or refused (403: not in that organisation), what is here stands. Then the old launcher
 * pins move over, once.
 */
export function syncSidebarPrefs(): Promise<void> {
  ensureSidebarPrefs();
  const { id, org } = sidebarPrefs.get();
  if (!id) return Promise.resolve();
  if (isGuestMode()) return migratePinnedApps();
  if (!online()) return Promise.resolve();
  if (inflight && inflight.gen === generation) return inflight.promise;
  const gen = generation;
  const before = answered;
  const promise = (async () => {
    try {
      const raw = await apiGet<unknown>(scoped(SIDEBAR_PREFS_PATH, org));
      if (gen !== generation) return;
      const s = sidebarPrefs.get();
      // A change answered meanwhile carries a newer state than this read.
      const confirmed = before === answered ? (normaliseSidebarPrefs(raw) ?? EMPTY_SIDEBAR_PREFS) : s.confirmed;
      sidebarPrefs.set({ source: 'server', loaded: true, confirmed, data: fold(confirmed, s.pending) });
      writeCache(id, 'server', confirmed);
    } catch (e) {
      if (gen !== generation) return;
      if (noEndpoint(e)) {
        // A server from before the endpoint, or not ready for it: this computer keeps the sidebar, quietly.
        const s = sidebarPrefs.get();
        sidebarPrefs.set({ source: 'local', loaded: true });
        writeCache(id, 'local', s.confirmed);
      } else return; // Offline or refused: what is here stands.
    } finally {
      if (inflight?.gen === gen) inflight = null;
    }
    await migratePinnedApps();
  })();
  inflight = { gen, promise };
  return promise;
}

function send(op: SidebarOp, org: string | null): Promise<unknown> {
  switch (op.kind) {
    case 'pin':
      return apiPut(scoped(`${SIDEBAR_PREFS_PATH}/pin`, org), { key: op.key, pinned: op.pinned });
    case 'hide':
      return apiPut(scoped(`${SIDEBAR_PREFS_PATH}/hide`, org), { key: op.key, hidden: op.hidden });
    case 'order':
      return apiPut(scoped(`${SIDEBAR_PREFS_PATH}/order`, org), op.body);
    case 'reset':
      return apiDelete(scoped(SIDEBAR_PREFS_PATH, org));
  }
}

/** A change on this computer alone (guest mode, an older server). */
function applyLocal(op: SidebarOp): void {
  const s = sidebarPrefs.get();
  if (!s.id) return;
  const confirmed = applySidebarOp(s.confirmed, op, new Date().toISOString());
  sidebarPrefs.set({ confirmed, data: fold(confirmed, s.pending) });
  writeCache(s.id, 'local', confirmed);
}

/**
 * Makes a change: on screen at once, then at the server, one change after another. Resolves true once it is kept;
 * false when it was refused or could not be sent — it is then off the screen again and, unless `quiet`, an error says so.
 */
function change(op: SidebarOp, opts: { quiet?: boolean } = {}): Promise<boolean> {
  ensureSidebarPrefs();
  const start = sidebarPrefs.get();
  if (!start.id) return Promise.resolve(false);
  if (start.source === 'local') {
    applyLocal(op);
    return Promise.resolve(true);
  }
  const { id, org } = start;
  const gen = generation;
  const mine = ++seq;
  const pending = [...start.pending, { seq: mine, op }];
  sidebarPrefs.set({ pending, data: fold(start.confirmed, pending) });
  const drop = () => sidebarPrefs.get().pending.filter((p) => p.seq !== mine);
  const run = async (): Promise<boolean> => {
    if (gen !== generation) return false;
    if (sidebarPrefs.get().source === 'local') {
      sidebarPrefs.set({ pending: drop() });
      applyLocal(op);
      return true;
    }
    try {
      const raw = await send(op, org);
      if (gen !== generation) return false;
      answered++;
      const s = sidebarPrefs.get();
      const confirmed = normaliseSidebarPrefs(raw) ?? applySidebarOp(s.confirmed, op);
      const rest = drop();
      sidebarPrefs.set({ confirmed, pending: rest, data: fold(confirmed, rest) });
      writeCache(id, 'server', confirmed);
      return true;
    } catch (e) {
      if (gen !== generation) return false;
      const s = sidebarPrefs.get();
      const rest = drop();
      if ((noEndpoint(e) && !s.loaded) || notReady(e)) {
        // An older server (not read from yet, and no such endpoint), or one not ready for it: kept here from now on.
        const confirmed = applySidebarOp(s.confirmed, op, new Date().toISOString());
        sidebarPrefs.set({ source: 'local', loaded: true, confirmed, pending: rest, data: fold(confirmed, rest) });
        writeCache(id, 'local', confirmed);
        return true;
      }
      sidebarPrefs.set({ pending: rest, data: fold(s.confirmed, rest) });
      if (!opts.quiet) toast('error', t('sidebar.saveFailed'));
      return false;
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/** Pins an app to the top of the sidebar (which shows it again, when it was removed), or unpins it. */
export function pinSidebarItem(key: string, pinned: boolean): Promise<boolean> {
  return change({ kind: 'pin', key, pinned });
}

/** Removes an app from this person's sidebar (it still opens from the launcher and its links), or brings it back. */
export function hideSidebarItem(key: string, hidden: boolean): Promise<boolean> {
  return change({ kind: 'hide', key, hidden });
}

/** Saves the order of Pinned, or of one section: every app shown there, in order. */
export function orderSidebar(body: SidebarOrderBody): Promise<boolean> {
  return change({ kind: 'order', body });
}

/** Back to the default sidebar: nothing pinned, nothing removed, the default order. */
export function resetSidebar(): Promise<boolean> {
  return change({ kind: 'reset' });
}

/**
 * The browser apps and channels pinned to the sidebar from the launcher before (`Preferences.pinnedApps`), pinned
 * the new way once — when the person has no preferences saved yet — in their order. Once to the server, and once
 * into the copy here while there is no server for it (so a server made ready later still gets them).
 */
async function migratePinnedApps(): Promise<void> {
  const { id, data, source } = sidebarPrefs.get();
  if (!id || migrating === id || isMigrated(id, source)) return;
  const prefs = app.get().prefs;
  if (!prefs) return;
  if (data.items.length) return markMigrated(id, source);
  const keys = [...new Set(prefs.pinnedApps ?? [])].filter((k) => !!findApp(k));
  migrating = id;
  try {
    let all = true;
    for (const key of keys) {
      if (sidebarPrefs.get().id !== id) return;
      if (!(await change({ kind: 'pin', key, pinned: true }, { quiet: true }))) all = false;
    }
    if (all && sidebarPrefs.get().id === id) markMigrated(id, sidebarPrefs.get().source);
  } finally {
    migrating = null;
  }
}

let cacheMemo: { id: string; data: SidebarPrefsData } | null = null;
function readCacheMemo(id: string): SidebarPrefsData {
  if (cacheMemo?.id !== id) cacheMemo = { id, data: readCache(id)?.data ?? EMPTY_SIDEBAR_PREFS };
  return cacheMemo.data;
}

/** The preferences, kept current in a component. */
export function useSidebarPrefs(): SidebarPrefsData {
  const id = useStore(app, sidebarIdentity);
  const held = useStore(sidebarPrefs, (s) => s.id);
  const data = useStore(sidebarPrefs, (s) => s.data);
  // Somebody else's a moment ago: theirs, read here, until the store takes it up after this render.
  useEffect(() => {
    if (held !== id) ensureSidebarPrefs();
  }, [held, id]);
  if (held === id) return data;
  return id === null ? EMPTY_SIDEBAR_PREFS : readCacheMemo(id);
}

/** Where the preferences are kept, for Settings › Sidebar. */
export function useSidebarSource(): SidebarSource {
  const guest = useStore(app, (s) => s.session?.mode === 'guest');
  const source = useStore(sidebarPrefs, (s) => s.source);
  return guest ? 'local' : source;
}

/** The ids of the apps pinned to the sidebar (the launcher's "Pin to the sidebar"). */
export function useSidebarPinnedKeys(): string[] {
  const data = useSidebarPrefs();
  return useMemo(() => data.items.filter((r) => r.parent === null && r.pinned && !r.hidden).map((r) => r.key), [data]);
}

/** Keeps the preferences with whoever is signed in, in whichever organisation: the copy here at once, then the server's. Called by the shell. */
export function initSidebarPrefs(): () => void {
  let last: string | undefined;
  const check = () => {
    const now = `${sidebarIdentity(app.get())}|${online()}`;
    if (now === last) return;
    last = now;
    ensureSidebarPrefs();
    void syncSidebarPrefs();
  };
  check();
  return app.subscribe(check);
}

/** For tests: forget everything held in memory. */
export function resetSidebarPrefsForTests(): void {
  generation++;
  answered = 0;
  seq = 0;
  queue = Promise.resolve();
  inflight = null;
  migrating = null;
  cacheMemo = null;
  sidebarPrefs.set(INITIAL);
}
