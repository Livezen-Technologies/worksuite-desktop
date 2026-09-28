import type { TabRecord } from '@shared/ipc/contract';
import { call } from './bridge';
import { createStore } from './store';
import { appForRoute, titleForRoute } from '../modules/registry';

/**
 * DesktopTabManager, renderer half (FR-NAV-03/04/08, §4.4).
 *
 * Tabs keep their module mounted while they are recent, so switching is
 * instant; a tab left alone longer than the suspension time is unmounted and
 * rebuilt from its route when it is next opened. The set of tabs is saved (so
 * it can be restored at start-up) and restored only where the app is still
 * visible to the user.
 *
 * Docking (FR-NAV-05/07): one tab can sit beside the active one (`sideId`,
 * the main pane's share of the width in `split`); a tab can be torn off into
 * its own window, and a torn-off window taken back in as a tab.
 */
export interface Tab {
  id: string;
  route: string;
  title: string;
  pinned: boolean;
  organizationId: string | null;
  app: string;
  lastActive: number;
  suspended: boolean;
  reloadKey: number;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  closed: Tab[];
  /** The tab docked beside the active one, or null. Never the active tab itself. */
  sideId: string | null;
  /** The main pane's share of the width while a tab is docked beside it. */
  split: number;
}

export const SPLIT_MIN = 0.25;
export const SPLIT_MAX = 0.75;
const clampSplit = (f: number) => (Number.isFinite(f) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, f)) : 0.5);

export const tabsStore = createStore<TabsState>({ tabs: [], activeId: null, closed: [], sideId: null, split: 0.5 });

let seq = 0;
const newId = () => `t${Date.now().toString(36)}${(++seq).toString(36)}`;

function make(route: string, organizationId: string | null, title?: string): Tab {
  return {
    id: newId(),
    route,
    title: title ?? titleForRoute(route),
    pinned: false,
    organizationId,
    app: appForRoute(route),
    lastActive: Date.now(),
    suspended: false,
    reloadKey: 0,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = tabsStore.get();
    const records: TabRecord[] = s.tabs.slice(0, 64).map((t) => ({ id: t.id, route: t.route, title: t.title.slice(0, 200), pinned: t.pinned, organizationId: t.organizationId, app: t.app }));
    const side = s.sideId && records.some((r) => r.id === s.sideId) ? { id: s.sideId, split: s.split } : null;
    void call('tabs:save', { tabs: records, activeId: s.activeId, side }).catch(() => undefined);
  }, 500);
}

/** A docked tab that closed, or became the active one, is no longer beside it. */
function fixSide(s: TabsState): Partial<TabsState> {
  if (s.sideId === null) return {};
  const side = s.tabs.find((t) => t.id === s.sideId);
  return !side || s.sideId === s.activeId ? { sideId: null } : {};
}

function update(fn: (s: TabsState) => Partial<TabsState>): void {
  tabsStore.set(fn);
  tabsStore.set(fixSide);
  persist();
}

/** The tab to bring forward when the one at `idx` leaves: its neighbour, never the docked one while another is left. */
function nextActive(tabs: Tab[], idx: number, sideId: string | null): string | null {
  const rest = tabs.filter((t) => t.id !== sideId);
  const pool = rest.length ? rest : tabs;
  const near = tabs.slice(idx).concat(tabs.slice(0, idx).reverse()).find((t) => pool.includes(t));
  return near?.id ?? pool[0]?.id ?? null;
}

export function activeTab(): Tab | null {
  const s = tabsStore.get();
  return s.tabs.find((t) => t.id === s.activeId) ?? null;
}

export function activate(id: string): void {
  update((s) => ({
    activeId: id,
    // Bringing the docked tab forward swaps the two panes.
    sideId: id === s.sideId && s.activeId && s.activeId !== id ? s.activeId : s.sideId,
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, lastActive: Date.now(), suspended: false } : t)),
  }));
}

/** Opens a route in a new tab. */
export function openTab(route: string, opts: { background?: boolean; title?: string; organizationId?: string | null } = {}): string {
  const tab = make(route, opts.organizationId ?? null, opts.title);
  update((s) => ({ tabs: [...s.tabs, tab], activeId: opts.background ? s.activeId : tab.id }));
  return tab.id;
}

/**
 * Navigates the way a sidebar click or a link does: within the current tab
 * when it belongs to the same app, to the app's existing tab otherwise, and
 * to a new tab only when the app has none.
 */
export function navigate(route: string, organizationId: string | null = null): void {
  const s = tabsStore.get();
  const app = appForRoute(route);
  const current = s.tabs.find((t) => t.id === s.activeId);
  if (current && current.app === app) {
    setRoute(current.id, route);
    return;
  }
  const existing = s.tabs.find((t) => t.app === app);
  if (existing) {
    setRoute(existing.id, route);
    activate(existing.id);
    return;
  }
  openTab(route, { organizationId });
}

export function setRoute(id: string, route: string): void {
  update((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, route, app: appForRoute(route), title: t.route === route ? t.title : titleForRoute(route), suspended: false } : t)),
  }));
}

export function setTitle(id: string, title: string): void {
  const t = tabsStore.get().tabs.find((x) => x.id === id);
  if (!t || t.title === title) return;
  update((s) => ({ tabs: s.tabs.map((x) => (x.id === id ? { ...x, title } : x)) }));
}

function remove(s: TabsState, id: string, remember: boolean): Partial<TabsState> {
  const idx = s.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return {};
  const tab = s.tabs[idx]!;
  const tabs = s.tabs.filter((t) => t.id !== id);
  const closed = remember ? [...s.closed.slice(-19), tab] : s.closed;
  if (tabs.length === 0) {
    const home = make('/home', null);
    return { tabs: [home], activeId: home.id, closed, sideId: null };
  }
  const sideId = s.sideId === id ? null : s.sideId;
  const activeId = s.activeId === id ? nextActive(tabs, idx, sideId) : s.activeId;
  return { tabs, activeId, closed, sideId };
}

export function closeTab(id: string): void {
  update((s) => remove(s, id, true));
}

// ── docking (FR-NAV-05/07) ───────────────────────────────────────────────

/** Docks a tab beside the active one. The active tab itself goes beside the tab used before it. */
export function dockSide(id: string): void {
  update((s) => {
    if (!s.tabs.some((t) => t.id === id)) return {};
    if (id !== s.activeId) return { sideId: id, tabs: s.tabs.map((t) => (t.id === id ? { ...t, suspended: false, lastActive: Date.now() } : t)) };
    const other = [...s.tabs].filter((t) => t.id !== id).sort((a, b) => b.lastActive - a.lastActive)[0];
    if (!other) return {};
    return { activeId: other.id, sideId: id, tabs: s.tabs.map((t) => (t.id === other.id ? { ...t, suspended: false, lastActive: Date.now() } : t)) };
  });
}

/** The docked tab goes back to being a tab like the others. */
export function undockSide(): void {
  update(() => ({ sideId: null }));
}

/** The docked tab and the active one change places. */
export function swapSides(): void {
  const s = tabsStore.get();
  if (s.sideId) activate(s.sideId);
}

export function setSplit(f: number): void {
  const split = clampSplit(f);
  if (split !== tabsStore.get().split) update(() => ({ split }));
}

/**
 * Tears a tab off into its own window, placed where the pointer let go of
 * it. The tab leaves the strip (not into "recently closed": it is open).
 */
export async function detachTab(id: string, at?: { x: number; y: number }): Promise<boolean> {
  const t = tabsStore.get().tabs.find((x) => x.id === id);
  if (!t) return false;
  try {
    await call('windows:detach', { route: t.route, title: t.title, at: at ? { x: Math.round(at.x), y: Math.round(at.y) } : undefined });
  } catch {
    return false;
  }
  update((s) => remove(s, id, false));
  return true;
}

/** Opens a tab at a place in the strip (a window docked back, dropped between two tabs). */
export function insertTab(route: string, opts: { title?: string; index?: number; side?: boolean } = {}): string {
  const tab = make(route, null, opts.title);
  update((s) => {
    const tabs = [...s.tabs];
    tabs.splice(Math.max(0, Math.min(opts.index ?? tabs.length, tabs.length)), 0, tab);
    if (opts.side && s.activeId) return { tabs, sideId: tab.id };
    return { tabs, activeId: tab.id };
  });
  return tab.id;
}

/** A torn-off window dropped on the main window: it closes and its page comes back here as a tab. */
export async function adoptWindow(windowId: number, opts: { index?: number; side?: boolean } = {}): Promise<string | null> {
  const r = await call('windows:adopt', { windowId }).catch(() => null);
  if (!r) return null;
  return insertTab(r.route, { title: r.title || undefined, index: opts.index, side: opts.side });
}

export function closeOthers(id: string): void {
  update((s) => ({
    tabs: s.tabs.filter((t) => t.id === id || t.pinned),
    closed: [...s.closed, ...s.tabs.filter((t) => t.id !== id && !t.pinned)].slice(-20),
    activeId: id,
    sideId: s.sideId === id ? s.activeId : s.sideId,
  }));
}

export function closeToRight(id: string): void {
  update((s) => {
    const idx = s.tabs.findIndex((t) => t.id === id);
    const keep = s.tabs.filter((t, i) => i <= idx || t.pinned);
    const gone = s.tabs.filter((t, i) => i > idx && !t.pinned);
    return { tabs: keep, closed: [...s.closed, ...gone].slice(-20), activeId: keep.some((t) => t.id === s.activeId) ? s.activeId : id };
  });
}

export function togglePin(id: string): void {
  update((s) => {
    const tabs = s.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
    // Pinned tabs sit at the left.
    return { tabs: [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)] };
  });
}

export function duplicateTab(id: string): void {
  const t = tabsStore.get().tabs.find((x) => x.id === id);
  if (t) openTab(t.route, { title: t.title, organizationId: t.organizationId });
}

export function reloadTab(id: string): void {
  update((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, reloadKey: t.reloadKey + 1, suspended: false } : t)) }));
}

export function moveTab(from: number, to: number): void {
  update((s) => {
    const tabs = [...s.tabs];
    const [t] = tabs.splice(from, 1);
    if (!t) return {};
    tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, t);
    return { tabs };
  });
}

export function restoreClosed(): void {
  const s = tabsStore.get();
  const t = s.closed[s.closed.length - 1];
  if (!t) return;
  update((st) => ({ closed: st.closed.slice(0, -1), tabs: [...st.tabs, { ...t, id: newId(), lastActive: Date.now(), suspended: false }] }));
  const last = tabsStore.get().tabs[tabsStore.get().tabs.length - 1];
  if (last) activate(last.id);
}

export function activateIndex(n: number): void {
  const tabs = tabsStore.get().tabs;
  const t = n >= 9 ? tabs[tabs.length - 1] : tabs[n - 1];
  if (t) activate(t.id);
}

/** FR-NAV-08: unmount tabs idle longer than the suspension time. */
export function suspendIdle(minutes: number): void {
  const now = Date.now();
  const s = tabsStore.get();
  let changed = false;
  const tabs = s.tabs.map((t) => {
    if (t.id !== s.activeId && t.id !== s.sideId && !t.suspended && now - t.lastActive > minutes * 60_000) {
      changed = true;
      return { ...t, suspended: true };
    }
    return t;
  });
  if (changed) tabsStore.set({ tabs });
}

/** FR-AUTH-07 / WF-03: tabs opened in an organization the user left are closed. */
export function closeTabsOutside(organizationId: string | null): number {
  if (organizationId === null) return 0;
  const s = tabsStore.get();
  const gone = s.tabs.filter((t) => t.organizationId !== null && t.organizationId !== organizationId);
  if (gone.length === 0) return 0;
  const tabs = s.tabs.filter((t) => !gone.includes(t));
  const home = tabs.length ? null : make('/home', null);
  update(() => ({ tabs: home ? [home] : tabs, activeId: home ? home.id : tabs.some((t) => t.id === s.activeId) ? s.activeId : (tabs[0]?.id ?? null) }));
  return gone.length;
}

/** Drops tabs whose app the user can no longer open (FR-REG-04, WF-28). */
export function closeTabsForApps(allowed: Set<string>): string[] {
  const s = tabsStore.get();
  const gone = s.tabs.filter((t) => !allowed.has(t.app));
  if (gone.length === 0) return [];
  const tabs = s.tabs.filter((t) => allowed.has(t.app));
  const home = tabs.length ? null : make('/home', null);
  update(() => ({ tabs: home ? [home] : tabs, activeId: home ? home.id : tabs.some((t) => t.id === s.activeId) ? s.activeId : (tabs[0]?.id ?? null) }));
  return [...new Set(gone.map((t) => t.app))];
}

export async function restoreTabs(allowed: Set<string>): Promise<boolean> {
  try {
    const saved = await call('tabs:restore');
    const tabs: Tab[] = saved.tabs
      .filter((r) => allowed.has(appForRoute(r.route)))
      .map((r) => ({ ...r, app: appForRoute(r.route), lastActive: Date.now(), suspended: true, reloadKey: 0 }));
    if (tabs.length === 0) return false;
    const activeId = tabs.some((t) => t.id === saved.activeId) ? saved.activeId : tabs[0]!.id;
    const sideId = saved.side && saved.side.id !== activeId && tabs.some((t) => t.id === saved.side!.id) ? saved.side.id : null;
    tabsStore.set({
      tabs: tabs.map((t) => (t.id === activeId || t.id === sideId ? { ...t, suspended: false } : t)),
      activeId,
      closed: [],
      sideId,
      split: clampSplit(saved.side?.split ?? 0.5),
    });
    return saved.restored;
  } catch {
    return false;
  }
}

export function resetTabs(): void {
  const home = make('/home', null);
  tabsStore.set({ tabs: [home], activeId: home.id, closed: [], sideId: null, split: 0.5 });
}
