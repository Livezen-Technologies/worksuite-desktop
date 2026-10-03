import { useEffect } from 'react';
import { apiGet, apiPut } from './api';
import { app, type AppState } from './app-state';
import { createStore, useStore } from './store';

/**
 * The organisation filter's memory (worksuite-desktop#214), per person and synced between their devices.
 *
 * Which organisations each screen is filtered to, whether that choice is one for every app or kept per app, and the
 * person's default organisation. Kept like the launcher's preferences (#201): in the generic per-user preferences
 * (`GET|PUT /api/prefs/desktop.orgs`), with a copy on this computer read synchronously so a screen opens on its
 * selection at once and offline. A change is made here first, marked unsent, and sent a moment later; the newer copy
 * (`updatedAt`) wins when the two meet. Guest mode has no server: its copy stays here.
 *
 * A selection is stored as `all` or a comma list of organisation ids; an empty list in code is All organisations.
 */
export const ORG_PREFS_SCOPE = 'desktop.orgs';
const PATH = `/api/prefs/${ORG_PREFS_SCOPE}`;
const cacheKey = (user: string) => `ws.orgs.${user}`;
export const ORG_PREFS_SEND_DELAY_MS = 800;
/** The key every app shares while the selection is shared. */
export const SHARED = '*';

export interface StoredOrgPrefs {
  updatedAt: number;
  /** One selection for every app (true, the default) or one per app. */
  shared: boolean;
  /** Per key (`*` or an app id): `all` or "1,3". */
  selections: Record<string, string>;
  /** The person's own default organisation; null falls back to the server's. */
  defaultOrg: string | null;
}

export const EMPTY_ORG_PREFS: StoredOrgPrefs = { updatedAt: 0, shared: true, selections: {}, defaultOrg: null };

export function normaliseOrgPrefs(raw: unknown): StoredOrgPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const selections: Record<string, string> = {};
  if (r.selections && typeof r.selections === 'object') {
    for (const [k, v] of Object.entries(r.selections as Record<string, unknown>)) if (typeof v === 'string' && k.length <= 64) selections[k] = v;
  }
  return {
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
    shared: r.shared !== false,
    selections,
    defaultOrg: typeof r.defaultOrg === 'string' && r.defaultOrg ? r.defaultOrg : null,
  };
}

/** "all" → []; "1,3" → ['1', '3']; anything else → null (nothing remembered). */
export function decodeSelection(v: string | undefined | null): string[] | null {
  if (v === undefined || v === null) return null;
  if (v === 'all') return [];
  const ids = [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
  return ids.length ? ids : null;
}

export const encodeSelection = (ids: string[]) => (ids.length ? [...new Set(ids)].join(',') : 'all');

interface OrgPrefsState {
  user: string | null;
  stored: StoredOrgPrefs | null;
  dirty: boolean;
}

export const orgPrefs = createStore<OrgPrefsState>({ user: null, stored: null, dirty: false });

function readCache(user: string): { prefs: StoredOrgPrefs | null; dirty: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey(user)) ?? 'null') as { prefs?: unknown; dirty?: unknown } | null;
    if (!raw || typeof raw !== 'object') return { prefs: null, dirty: false };
    return { prefs: normaliseOrgPrefs(raw.prefs), dirty: raw.dirty === true };
  } catch {
    return { prefs: null, dirty: false };
  }
}

function writeCache(user: string, prefs: StoredOrgPrefs | null, dirty: boolean) {
  try {
    localStorage.setItem(cacheKey(user), JSON.stringify({ prefs, dirty }));
  } catch {
    // Storage full or blocked: the server's copy is still the person's.
  }
}

function userOf(s: AppState): string | null {
  if (s.session?.mode === 'guest') return 'guest';
  const id = s.auth?.user?.id;
  return id == null ? null : String(id);
}
const online = () => app.get().session?.mode !== 'guest' && app.get().auth?.stage === 'ready';

/** Takes up the person's copy on this computer when the person changed. */
export function ensureOrgPrefs(): void {
  const user = userOf(app.get());
  if (user === orgPrefs.get().user) return;
  if (timer) clearTimeout(timer);
  timer = null;
  if (user === null) return orgPrefs.set({ user: null, stored: null, dirty: false });
  const c = readCache(user);
  orgPrefs.set({ user, stored: c.prefs, dirty: c.dirty });
}

let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;

/** Brings this computer's copy and the server's together: the newer wins. Quiet offline. */
export function syncOrgPrefs(): Promise<void> {
  ensureOrgPrefs();
  if (inflight) return inflight;
  const user = orgPrefs.get().user;
  if (!user || !online()) return Promise.resolve();
  inflight = (async () => {
    try {
      const res = await apiGet<{ prefs: unknown }>(PATH);
      if (orgPrefs.get().user !== user) return;
      const remote = normaliseOrgPrefs(res?.prefs);
      const { stored, dirty } = orgPrefs.get();
      if (dirty && stored && (!remote || stored.updatedAt >= remote.updatedAt)) await send(user, stored);
      else if (remote) {
        orgPrefs.set({ stored: remote, dirty: false });
        writeCache(user, remote, false);
      }
    } catch {
      // Offline or refused: what is here stands.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function send(user: string, prefs: StoredOrgPrefs) {
  await apiPut(PATH, { prefs });
  if (orgPrefs.get().user !== user || orgPrefs.get().stored !== prefs) return;
  orgPrefs.set({ dirty: false });
  writeCache(user, prefs, false);
}

/** Sends an unsent change now (the timer's work; tests call it directly). */
export async function flushOrgPrefs(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const { user, stored, dirty } = orgPrefs.get();
  if (!user || !stored || !dirty || !online()) return;
  try {
    await send(user, stored);
  } catch {
    // Offline: sent at the next sync.
  }
}

function current(): StoredOrgPrefs {
  ensureOrgPrefs();
  return orgPrefs.get().stored ?? EMPTY_ORG_PREFS;
}

function save(patch: (p: StoredOrgPrefs) => StoredOrgPrefs, now = Date.now()) {
  const before = current();
  const next = { ...patch(before), updatedAt: Math.max(now, before.updatedAt + 1) };
  orgPrefs.set({ stored: next, dirty: true });
  const user = orgPrefs.get().user;
  if (!user) return;
  writeCache(user, next, true);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushOrgPrefs(), ORG_PREFS_SEND_DELAY_MS);
}

const keyFor = (p: StoredOrgPrefs, module: string) => (p.shared ? SHARED : module);

/** The selection remembered for an app ([] = All organisations), or null when there is none. */
export function recallOrgSelection(module: string): string[] | null {
  const p = current();
  return decodeSelection(p.selections[keyFor(p, module)]);
}

/** Remembers an app's selection — for every app while the selection is shared. */
export function rememberOrgSelection(module: string, ids: string[]): void {
  save((p) => ({ ...p, selections: { ...p.selections, [keyFor(p, module)]: encodeSelection(ids) } }));
}

/**
 * A one-organisation app's remembered choice: '' for All, an id, or null when nothing it can use is remembered (a
 * shared selection of several organisations means nothing to a screen that shows one).
 */
export function recallOrgChoice(module: string): string | null {
  const ids = recallOrgSelection(module);
  if (ids === null || ids.length > 1) return null;
  // Only an organisation the person still has: a module never asks for one it cannot know.
  const held = app.get().bootstrap?.organizations;
  if (ids[0] && held && !held.some((o) => o.id === ids[0])) return null;
  return ids[0] ?? '';
}

export function rememberOrgChoice(module: string, id: string): void {
  rememberOrgSelection(module, id ? [id] : []);
}

/** The person's default organisation: their own choice, else the server's. */
export function defaultOrganisation(): string | null {
  return current().defaultOrg ?? app.get().bootstrap?.defaultOrganizationId ?? null;
}

/** Only the person's own default (null when they have not chosen one): a screen's first selection when nothing is remembered. */
export function chosenDefaultOrganisation(): string | null {
  return current().defaultOrg;
}

export function setDefaultOrganisation(id: string): void {
  save((p) => ({ ...p, defaultOrg: id }));
}

export function orgSelectionShared(): boolean {
  return current().shared;
}

/** One selection for every app, or one per app. Switching keeps what is on screen: the shared one seeds each app. */
export function setOrgSelectionShared(shared: boolean): void {
  save((p) => ({ ...p, shared }));
}

/** The preferences, kept current in a component. */
export function useOrgPrefs(): StoredOrgPrefs {
  const user = useStore(app, userOf);
  const held = useStore(orgPrefs, (s) => s.user);
  const stored = useStore(orgPrefs, (s) => s.stored);
  useEffect(() => {
    if (held !== user) ensureOrgPrefs();
  }, [held, user]);
  if (held !== user) {
    // Somebody else signed in: their copy, from this computer, until the store takes it up.
    return user === null ? EMPTY_ORG_PREFS : (readCacheMemo(user) ?? EMPTY_ORG_PREFS);
  }
  return stored ?? EMPTY_ORG_PREFS;
}

let memo: { user: string; prefs: StoredOrgPrefs | null } | null = null;
function readCacheMemo(user: string) {
  if (memo?.user !== user) memo = { user, prefs: readCache(user).prefs };
  return memo.prefs;
}

/** Keeps the preferences with whoever is signed in. Called by the shell. */
export function initOrgPrefs(): () => void {
  let user: string | null | undefined;
  const check = () => {
    const now = userOf(app.get());
    if (now === user) return;
    user = now;
    ensureOrgPrefs();
    void syncOrgPrefs();
  };
  check();
  return app.subscribe(check);
}

/** For tests: forget everything held in memory. */
export function resetOrgPrefsForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  inflight = null;
  memo = null;
  orgPrefs.set({ user: null, stored: null, dirty: false });
}

/**
 * A screen's organisation selection, remembered (for every app while it is shared, else for this one) and checked
 * against the organisations the person still has. Nothing remembered — or nothing still held — is `fallback`.
 */
export function useOrgSelection(module: string, known: string[], fallback: string[]): [string[], (ids: string[]) => void] {
  const prefs = useOrgPrefs();
  const stored = decodeSelection(prefs.selections[prefs.shared ? SHARED : module]);
  let ids = fallback;
  if (stored !== null) {
    const held = known.length ? stored.filter((id) => known.includes(id)) : stored;
    if (stored.length === 0 || held.length) ids = held;
  }
  return [ids, (next: string[]) => rememberOrgSelection(module, next)];
}
