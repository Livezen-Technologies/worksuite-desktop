import { LAUNCHER_GROUPS, type AppDefinition } from './apps';

/**
 * The app launcher's rules (worksuite-desktop#201): each person's launcher preferences, how they are kept sane,
 * what the launcher lists for a search and a category, in what order, and how big it may be in this window.
 *
 * Pure: no DOM, no storage, no network. The renderer keeps the preferences (src/core/launcher-prefs.ts) and draws
 * them (src/app/overlays/Launcher.tsx, src/modules/settings/LauncherSettings.tsx).
 */

export const LAUNCHER_SIZES = ['compact', 'comfortable', 'large'] as const;
export type LauncherSize = (typeof LAUNCHER_SIZES)[number];
export const LAUNCHER_MODES = ['popover', 'fullscreen'] as const;
export type LauncherMode = (typeof LAUNCHER_MODES)[number];
export const LAUNCHER_SORTS = ['mine', 'az', 'used'] as const;
export type LauncherSort = (typeof LAUNCHER_SORTS)[number];
export const LAUNCHER_GROUP_BY = ['default', 'mine', 'none'] as const;
export type LauncherGroupBy = (typeof LAUNCHER_GROUP_BY)[number];
export const LAUNCHER_OPEN_IN = ['new-tab', 'current-tab', 'window'] as const;
export type LauncherOpenIn = (typeof LAUNCHER_OPEN_IN)[number];

/** At most this many apps in the Pinned row. */
export const PIN_MAX = 8;
export const GROUP_MAX = 20;
export const GROUP_NAME_MAX = 40;
const ORDER_MAX = 300;
const ID = /^[a-z][a-z0-9_-]{0,39}$/;

/** Icon sizes, in px, per launcher size; the bottom sheet's own. */
export const ICON_PX: Record<LauncherSize, number> = { compact: 44, comfortable: 52, large: 64 };
/** Full screen draws every size one step larger (worksuite-desktop#206). */
export const FULL_ICON_PX: Record<LauncherSize, number> = { compact: 52, comfortable: 56, large: 72 };
/** Full screen's tiles have room round the icon and a 14px name: 112px tall for a 52px icon. */
export const FULL_TILE_ROOM = { names: 60, bare: 28 } as const;
export const SHEET_ICON_PX = 48;
export const SHEET_COLUMNS = 4;
/** Narrower than this, the launcher is a bottom sheet. */
export const SHEET_BELOW = 480;
/** The popover grid's `repeat(auto-fill, minmax(88px, 1fr))`. */
export const TILE_MIN_PX = 88;
export const GRID_GAP_PX = 2;
/** Full screen's `repeat(auto-fill, minmax(116px, 1fr))`, 8px apart. */
export const FULL_TILE_MIN_PX = 116;
export const FULL_GRID_GAP_PX = 8;
/** The popover: `width: min(880px, 100vw - 48px)`, `max-height: min(640px, 100vh - 96px)`. */
export const POPOVER_MAX = { width: 880, height: 640 } as const;
export const POPOVER_GUTTER = { x: 48, y: 96 } as const;
/** Never closer than this to the window's edges, the Dock or the taskbar. */
export const EDGE_MARGIN = 24;
/** The popover's top, as a share of the window's height (Spotlight-style), so the search field never moves. */
export const POPOVER_TOP_FRACTION = 0.12;
/** The shell's top bar (layouts/TitleBar), which holds the window controls: the traffic lights on macOS. */
export const TOP_BAR_PX = 52;
/**
 * Full screen's column: `max-width: 1160px; margin: 0 auto`, 40px above, 24px each side, and nothing below: the
 * footer runs along the bottom of the window (worksuite-desktop#233), across all of it.
 */
export const FULL_COLUMN = { maxWidth: 1160, padTop: 40, padSide: 24, padBottom: 0 } as const;
/** Full screen's search: the column's width, less its settings and close buttons beside it, 56px tall. */
export const FULL_SEARCH = { height: 56 } as const;
/**
 * Full screen's categories in a sidebar: a list 240px wide on the left, 32px from the apps. Only where the column
 * keeps at least `minColumn` px for it and the apps; narrower, the categories are chips above the apps again.
 */
export const FULL_SIDEBAR = { width: 240, gap: 32, minColumn: 760 } as const;
/** Never more of the window than this (the bottom sheet). */
export const MAX_FRACTION = 0.9;

/**
 * The fixed parts of the launcher, in px. The renderer draws each at exactly this height, so the room left for the
 * grid, and so how many whole rows fit, is known before anything is drawn.
 */
export const LAUNCHER_PARTS = {
  /** The popover's 1px border, top and bottom. */
  border: 2,
  /** The popover's search row. */
  header: 66,
  /** Full screen's search row: 56px, and 16px under it. */
  fullHeader: 72,
  /** Full screen's one row of Pinned and Recent: 44px chips, and 24px under them. */
  fullRow: 68,
  /** The Pinned and the Recent rows, each. */
  row: 40,
  /** The category chips. */
  chips: 40,
  divider: 1,
  footer: 40,
  /** Full screen's footer: 44px buttons with 10px above and below. */
  fullFooter: 64,
  /** A category heading in full screen. */
  heading: 32,
} as const;
/** The grid's padding inside its scroller; the bottom fade sits over the bottom padding. */
export const GRID_PAD = { top: 8, bottom: 12, x: 10 } as const;
/** The scroll fades, top and bottom: `linear-gradient(transparent, var(--launcher-bg))`, 32px (worksuite-desktop#233). */
export const FADE_PX = 32;
/**
 * The grid in sections (worksuite-desktop#233): each category heading 24px above its name (16px of margin, then 8px
 * of the heading's own padding) and 8px below it, sticky while its section scrolls by; when it sticks, it is
 * `LAUNCHER_PARTS.heading` tall (8 + a 16px line + 8). In full screen, 24px under the last section, before the footer.
 */
export const FULL_GRID = { bottom: 24, headingMargin: 16, headingPad: 8 } as const;
/** Narrower than this (the footer's own width), the footer says only the count and Esc to close. */
export const FOOTER_NARROW_BELOW = 640;

export const DEFAULT_LAUNCHER_SHORTCUT = 'Mod+Shift+K';

export interface LauncherUserGroup {
  id: string;
  name: string;
  apps: string[];
}

export interface LauncherToggles {
  /** The Recent row. */
  recent: boolean;
  /** Unread counts on Mail, Chat and Tasks. */
  badges: boolean;
  /** The arrow on apps that open in the browser. */
  browserMark: boolean;
  /** App names under the icons; off, an icon-only grid. */
  names: boolean;
  /** Full screen: the categories in a list on the left, with their counts; off, chips above the apps. */
  sidebar: boolean;
}

/**
 * `launcher_prefs`, as stored for the person (`/api/prefs/desktop.launcher`) and mirrored on this computer.
 * `pinned` and `order` are null until the person sets them: the organization's defaults stand in until then.
 */
export interface StoredLauncherPrefs {
  size: LauncherSize;
  mode: LauncherMode;
  pinned: string[] | null;
  hidden: string[];
  groups: LauncherUserGroup[];
  groupBy: LauncherGroupBy;
  order: string[] | null;
  sort: LauncherSort;
  openIn: LauncherOpenIn;
  shortcut: string;
  toggles: LauncherToggles;
  /** How often each app was opened from the launcher ("Most used"). */
  usage: Record<string, number>;
  /** When this copy was changed (ms); the newer of this computer's copy and the server's wins. */
  updatedAt: number;
}

/** The preferences with the organization's defaults filled in: what the launcher and Settings work with. */
export interface LauncherPrefs extends StoredLauncherPrefs {
  pinned: string[];
  order: string[];
}

/** The organization's launcher defaults (desktop policy `launcher_pinned`, `launcher_order`). */
export interface LauncherOrgDefaults {
  pinned?: readonly string[] | null;
  order?: readonly string[] | null;
}

export const DEFAULT_TOGGLES: LauncherToggles = { recent: true, badges: true, browserMark: true, names: true, sidebar: true };

export function defaultStoredPrefs(): StoredLauncherPrefs {
  return {
    size: 'compact',
    mode: 'popover',
    pinned: null,
    hidden: [],
    groups: [],
    groupBy: 'default',
    order: null,
    sort: 'mine',
    openIn: 'new-tab',
    shortcut: DEFAULT_LAUNCHER_SHORTCUT,
    toggles: { ...DEFAULT_TOGGLES },
    usage: {},
    updatedAt: 0,
  };
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** App ids: strings of the catalogue's shape, once each, at most `max`. */
export function cleanIds(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string' && ID.test(x) && !out.includes(x)) out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

/** A shortcut the launcher can use: at least ⌘/Ctrl or Alt, and one plain key. */
export function isUsableShortcut(acc: unknown): acc is string {
  if (typeof acc !== 'string' || acc.length > 40) return false;
  const parts = acc.split('+');
  const key = parts.at(-1) ?? '';
  const mods = parts.slice(0, -1);
  if (!key || ['Mod', 'Ctrl', 'Alt', 'Shift'].includes(key)) return false;
  if (!mods.every((m) => ['Mod', 'Ctrl', 'Alt', 'Shift'].includes(m))) return false;
  return mods.some((m) => m === 'Mod' || m === 'Ctrl' || m === 'Alt');
}

/**
 * Anything may be in storage or on the server — an older shape, a hand-edited row. Every field is coerced to its
 * type, and a bad value costs a default rather than a launcher that will not open.
 */
export function normaliseStored(raw: unknown): StoredLauncherPrefs {
  const d = defaultStoredPrefs();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const t = (o.toggles && typeof o.toggles === 'object' ? o.toggles : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const groups: LauncherUserGroup[] = [];
  if (Array.isArray(o.groups)) {
    for (const g of o.groups as unknown[]) {
      if (!g || typeof g !== 'object' || groups.length >= GROUP_MAX) continue;
      const r = g as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name.trim().slice(0, GROUP_NAME_MAX) : '';
      const id = typeof r.id === 'string' && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : '';
      if (!name || !id || groups.some((x) => x.id === id)) continue;
      // An app is in one group at most: the first that has it.
      const apps = cleanIds(r.apps, ORDER_MAX).filter((a) => !seen.has(a));
      apps.forEach((a) => seen.add(a));
      groups.push({ id, name, apps });
    }
  }
  const usage: Record<string, number> = {};
  if (o.usage && typeof o.usage === 'object') {
    for (const [k, v] of Object.entries(o.usage as Record<string, unknown>).slice(0, ORDER_MAX)) {
      if (ID.test(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) usage[k] = Math.floor(v);
    }
  }
  const flag = (k: keyof LauncherToggles) => (typeof t[k] === 'boolean' ? (t[k] as boolean) : DEFAULT_TOGGLES[k]);
  return {
    size: pick(o.size, LAUNCHER_SIZES, d.size),
    mode: pick(o.mode, LAUNCHER_MODES, d.mode),
    pinned: o.pinned == null ? null : cleanIds(o.pinned, PIN_MAX),
    hidden: cleanIds(o.hidden, ORDER_MAX),
    groups,
    groupBy: pick(o.groupBy, LAUNCHER_GROUP_BY, d.groupBy),
    order: o.order == null ? null : cleanIds(o.order, ORDER_MAX),
    sort: pick(o.sort, LAUNCHER_SORTS, d.sort),
    openIn: pick(o.openIn, LAUNCHER_OPEN_IN, d.openIn),
    shortcut: isUsableShortcut(o.shortcut) ? o.shortcut : d.shortcut,
    toggles: { recent: flag('recent'), badges: flag('badges'), browserMark: flag('browserMark'), names: flag('names'), sidebar: flag('sidebar') },
    usage,
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) && o.updatedAt > 0 ? o.updatedAt : 0,
  };
}

/** The person's preferences, or the defaults, with the organization's pinned apps and order where the person has none. */
export function resolvePrefs(stored: StoredLauncherPrefs | null, org?: LauncherOrgDefaults | null): LauncherPrefs {
  const s = stored ?? defaultStoredPrefs();
  return { ...s, pinned: s.pinned ?? cleanIds(org?.pinned ?? [], PIN_MAX), order: s.order ?? cleanIds(org?.order ?? [], ORDER_MAX) };
}

/** Reset to default: the defaults, following the organization's pinned apps and order again. */
export function resetPrefs(now: number): StoredLauncherPrefs {
  return { ...defaultStoredPrefs(), updatedAt: now };
}

// ── changes ─────────────────────────────────────────────────────────────

/** Pins an app at the end of the row; null when the row is full. */
export function pinApp(p: LauncherPrefs, id: string): LauncherPrefs | null {
  if (p.pinned.includes(id)) return p;
  if (p.pinned.length >= PIN_MAX) return null;
  return { ...p, pinned: [...p.pinned, id], hidden: p.hidden.filter((h) => h !== id) };
}

export function unpinApp(p: LauncherPrefs, id: string): LauncherPrefs {
  return { ...p, pinned: p.pinned.filter((x) => x !== id) };
}

/** Moves a pinned app from one place in the row to another. */
export function movePinned(p: LauncherPrefs, from: number, to: number): LauncherPrefs {
  if (from === to || from < 0 || from >= p.pinned.length) return p;
  const next = [...p.pinned];
  const [id] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id!);
  return { ...p, pinned: next };
}

/** Hides or shows an app in the grid. A hidden app leaves the Pinned row; search still finds it. */
export function setHidden(p: LauncherPrefs, id: string, hidden: boolean): LauncherPrefs {
  if (hidden) return p.hidden.includes(id) ? p : { ...p, hidden: [...p.hidden, id], pinned: p.pinned.filter((x) => x !== id) };
  return { ...p, hidden: p.hidden.filter((x) => x !== id) };
}

function groupId(name: string, taken: LauncherUserGroup[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'group';
  let id = base;
  for (let i = 2; taken.some((g) => g.id === id); i++) id = `${base}-${i}`;
  return id;
}

/** A group of the person's own; null when the name is empty or there are already GROUP_MAX. */
export function addGroup(p: LauncherPrefs, name: string): { prefs: LauncherPrefs; id: string } | null {
  const n = name.trim().slice(0, GROUP_NAME_MAX);
  if (!n || p.groups.length >= GROUP_MAX) return null;
  const id = groupId(n, p.groups);
  return { prefs: { ...p, groups: [...p.groups, { id, name: n, apps: [] }] }, id };
}

export function renameGroup(p: LauncherPrefs, id: string, name: string): LauncherPrefs {
  const n = name.trim().slice(0, GROUP_NAME_MAX);
  if (!n) return p;
  return { ...p, groups: p.groups.map((g) => (g.id === id ? { ...g, name: n } : g)) };
}

/** Removes a group; its apps go back to "Other apps". */
export function removeGroup(p: LauncherPrefs, id: string): LauncherPrefs {
  return { ...p, groups: p.groups.filter((g) => g.id !== id) };
}

/** Moves an app into one of the person's groups, or out of every group (null). */
export function moveToGroup(p: LauncherPrefs, appId: string, group: string | null): LauncherPrefs {
  if (group !== null && !p.groups.some((g) => g.id === group)) return p;
  return { ...p, groups: p.groups.map((g) => ({ ...g, apps: g.id === group ? [...g.apps.filter((a) => a !== appId), appId] : g.apps.filter((a) => a !== appId) })) };
}

/** The person's group an app is in, if any. */
export function groupOfApp(p: Pick<LauncherPrefs, 'groups'>, appId: string): string | null {
  return p.groups.find((g) => g.apps.includes(appId))?.id ?? null;
}

/**
 * Drag to reorder: `dragged` goes just before `target` in the order the person sees (`shown`), and the launcher sorts
 * by My order from then on. Apps not shown keep their places after the ones that are.
 */
export function reorderApps(p: LauncherPrefs, shown: readonly string[], dragged: string, target: string | null): LauncherPrefs {
  if (dragged === target) return p;
  const list = shown.filter((id) => id !== dragged);
  const at = target === null ? list.length : list.indexOf(target);
  list.splice(at < 0 ? list.length : at, 0, dragged);
  const rest = p.order.filter((id) => !list.includes(id));
  return { ...p, order: [...list, ...rest].slice(0, ORDER_MAX), sort: 'mine' };
}

/** One more opening of an app ("Most used"). */
export function noteUse(p: LauncherPrefs, id: string): LauncherPrefs {
  return { ...p, usage: { ...p.usage, [id]: (p.usage[id] ?? 0) + 1 } };
}

// ── what the launcher lists ─────────────────────────────────────────────

type Labeller = (a: AppDefinition) => string;
const plainLabel: Labeller = (a) => a.label;

/**
 * How well an app answers a search, 0 for not at all. Every word typed must match: the name (from its start
 * best, then any word of it, then anywhere), or a keyword's start ("bill" finds Invoices by `billing`).
 */
export function matchScore(a: AppDefinition, query: string, label: Labeller = plainLabel): number {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const name = label(a).toLowerCase();
  const nameWords = name.split(/[^a-z0-9]+/i).filter(Boolean);
  const keys = `${a.keywords ?? ''} ${a.id} ${a.label.toLowerCase()}`.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  let score = 0;
  for (const w of words) {
    if (name.startsWith(w)) score += 100;
    else if (nameWords.some((n) => n.startsWith(w))) score += 60;
    else if (name.includes(w)) score += 40;
    else if (keys.some((k) => k.startsWith(w))) score += 20;
    else if (w.length >= 3 && keys.some((k) => k.includes(w))) score += 10;
    else return 0;
  }
  return score;
}

/** The apps that answer a search, best first. */
export function searchApps(apps: readonly AppDefinition[], query: string, label: Labeller = plainLabel): AppDefinition[] {
  return apps
    .map((a, i) => ({ a, i, s: matchScore(a, query, label) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.a);
}

export const ALL_CATEGORY = 'all';
export const OTHER_GROUP = 'other';

/** The category an app is under, as the person groups them. */
export function categoryOf(a: AppDefinition, p: Pick<LauncherPrefs, 'groupBy' | 'groups'>): string {
  if (p.groupBy === 'none') return ALL_CATEGORY;
  if (p.groupBy === 'mine') return groupOfApp(p, a.id) ?? OTHER_GROUP;
  return a.group;
}

/** The categories, in order: the default ones, the person's groups then "Other apps", or none. */
export function categoryList(p: Pick<LauncherPrefs, 'groupBy' | 'groups'>): Array<{ id: string; label: string }> {
  if (p.groupBy === 'none') return [];
  if (p.groupBy === 'mine') return [...p.groups.map((g) => ({ id: g.id, label: g.name })), { id: OTHER_GROUP, label: 'Other apps' }];
  return LAUNCHER_GROUPS.map((g) => ({ id: g.id, label: g.label }));
}

/** Sorts by the person's choice: My order, A to Z, or Most used. */
export function sortApps(apps: readonly AppDefinition[], p: Pick<LauncherPrefs, 'sort' | 'order' | 'usage'>, label: Labeller = plainLabel): AppDefinition[] {
  const byName = (a: AppDefinition, b: AppDefinition) => label(a).localeCompare(label(b));
  if (p.sort === 'az') return [...apps].sort(byName);
  if (p.sort === 'used') return [...apps].sort((a, b) => (p.usage[b.id] ?? 0) - (p.usage[a.id] ?? 0) || byName(a, b));
  const at = (id: string) => {
    const i = p.order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...apps].sort((a, b) => at(a.id) - at(b.id) || a.order - b.order);
}

export interface LauncherCategory {
  id: string;
  label: string;
  count: number;
}

export interface LauncherView {
  /** The grid, in order. */
  tiles: AppDefinition[];
  /** "All apps" and every category with apps in it (the person's groups even when empty, to drop apps on). */
  categories: LauncherCategory[];
  /** The category shown: the one asked for, or All apps when it has gone. */
  current: string;
  /** The Pinned row: apps the person may open, in their order. */
  pinned: AppDefinition[];
  /** Apps in the grid when nothing is searched: everything not hidden. */
  shownCount: number;
}

/**
 * What the launcher shows. Without a search: every app not hidden, in the person's sort, category by category under
 * All apps. With one: every app that answers — hidden ones too — best first. Apps are only ever those the person may
 * open (the caller passes `apps` already through the access gates).
 */
export function launcherView(input: { apps: readonly AppDefinition[]; prefs: LauncherPrefs; query?: string; category?: string; label?: Labeller }): LauncherView {
  const { apps, prefs } = input;
  const label = input.label ?? plainLabel;
  const query = (input.query ?? '').trim();
  const pool = query ? searchApps(apps, query, label) : sortApps(apps.filter((a) => !prefs.hidden.includes(a.id)), prefs, label);
  const cats = categoryList(prefs);
  const counted = cats.map((c) => ({ ...c, count: pool.filter((a) => categoryOf(a, prefs) === c.id).length })).filter((c) => c.count > 0 || (prefs.groupBy === 'mine' && c.id !== OTHER_GROUP && !query));
  const categories: LauncherCategory[] = cats.length ? [{ id: ALL_CATEGORY, label: 'All apps', count: pool.length }, ...counted] : [];
  const asked = input.category ?? ALL_CATEGORY;
  const current = categories.some((c) => c.id === asked) ? asked : ALL_CATEGORY;
  let tiles = current === ALL_CATEGORY ? pool : pool.filter((a) => categoryOf(a, prefs) === current);
  if (!query && current === ALL_CATEGORY && cats.length) {
    // All apps reads category by category, in the categories' own order.
    const rank = new Map(cats.map((c, i) => [c.id, i]));
    tiles = tiles.map((a, i) => ({ a, i })).sort((x, y) => (rank.get(categoryOf(x.a, prefs)) ?? 99) - (rank.get(categoryOf(y.a, prefs)) ?? 99) || x.i - y.i).map((x) => x.a);
  }
  const byId = new Map(apps.map((a) => [a.id, a]));
  const pinned = prefs.pinned.map((id) => byId.get(id)).filter((a): a is AppDefinition => !!a).slice(0, PIN_MAX);
  return { tiles, categories, current, pinned, shownCount: apps.filter((a) => !prefs.hidden.includes(a.id)).length };
}

// ── size and place ──────────────────────────────────────────────────────

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WindowGeometry {
  innerWidth: number;
  innerHeight: number;
  outerWidth?: number;
  outerHeight?: number;
  screenX?: number;
  screenY?: number;
}

export interface ScreenWorkArea {
  availLeft?: number;
  availTop?: number;
  availWidth?: number;
  availHeight?: number;
}

/**
 * The part of the window the person can see: the window's content, less whatever of it lies outside the screen's
 * work area — under the Dock or the taskbar, or off the screen's edge. Without a work area to go by, the whole window.
 */
export function visibleArea(win: WindowGeometry, screen?: ScreenWorkArea | null): Rect {
  const all: Rect = { left: 0, top: 0, width: Math.max(0, win.innerWidth), height: Math.max(0, win.innerHeight) };
  const aw = screen?.availWidth ?? 0;
  const ah = screen?.availHeight ?? 0;
  if (!screen || aw <= 0 || ah <= 0 || win.screenX === undefined || win.screenY === undefined) return all;
  const side = Math.max(0, ((win.outerWidth ?? win.innerWidth) - win.innerWidth) / 2);
  const top = Math.max(0, (win.outerHeight ?? win.innerHeight) - win.innerHeight - side);
  // Where the content's top-left corner is on the screen.
  const x0 = win.screenX + side;
  const y0 = win.screenY + top;
  const ax = screen.availLeft ?? 0;
  const ay = screen.availTop ?? 0;
  const left = Math.max(0, ax - x0);
  const topIn = Math.max(0, ay - y0);
  const right = Math.min(win.innerWidth, ax + aw - x0);
  const bottom = Math.min(win.innerHeight, ay + ah - y0);
  // Nothing of it on the work area (another screen's numbers): the whole window rather than nothing.
  if (right - left < 200 || bottom - topIn < 200) return all;
  return { left, top: topIn, width: right - left, height: bottom - topIn };
}

/** A tile's height: its padding, the icon, and the name's one line under it (none when names are off). */
export function tileHeight(icon: number, names: boolean): number {
  return names ? icon + 40 : icon + 20;
}

/** A full screen tile's height: more room round the icon, and a larger name (`FULL_TILE_ROOM`). */
export function fullTileHeight(icon: number, names: boolean): number {
  return icon + (names ? FULL_TILE_ROOM.names : FULL_TILE_ROOM.bare);
}

/** The grid's scroller: as many whole rows as fit in `available`, never a row cut through. At least one row. */
export function wholeRows(available: number, rowHeight: number, gap: number, pad: { top: number; bottom: number } = GRID_PAD): { rows: number; height: number } {
  const rows = Math.max(1, Math.floor((available - pad.top - pad.bottom + gap) / (rowHeight + gap)));
  return { rows, height: pad.top + rows * rowHeight + (rows - 1) * gap + pad.bottom };
}

/** Which of the launcher's optional fixed parts are showing. */
export interface LauncherParts {
  pinned: boolean;
  recent: boolean;
  chips: boolean;
}

/** The height of everything in the popover but the grid. */
export function popoverChrome(p: LauncherParts): number {
  const P = LAUNCHER_PARTS;
  return P.border + P.header + (p.pinned ? P.row : 0) + (p.recent ? P.row : 0) + (p.chips ? P.chips : 0) + P.divider + P.footer;
}

/**
 * The height of everything in full screen but the grid, the column's padding included: the search row, one row for
 * Pinned and Recent together, the category chips when they are not in the sidebar, and the footer.
 */
export function fullscreenChrome(p: LauncherParts, sidebar = false): number {
  const P = LAUNCHER_PARTS;
  return FULL_COLUMN.padTop + P.fullHeader + (p.pinned || p.recent ? P.fullRow : 0) + (p.chips && !sidebar ? P.chips : 0) + P.fullFooter + FULL_COLUMN.padBottom;
}

/** Whether full screen shows its categories in the sidebar: asked for, there are categories, and the column has room. */
export function fullscreenSidebar(column: number, asked: boolean, chips: boolean): boolean {
  return asked && chips && column - 2 * FULL_COLUMN.padSide >= FULL_SIDEBAR.minColumn;
}

export interface LauncherLayout {
  kind: 'popover' | 'sheet' | 'fullscreen';
  /** The launcher's box in the window's content, in CSS px. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Icon size in px. */
  icon: number;
  /** A tile's height. */
  rowHeight: number;
  /** A tile's narrowest width (`minmax(tileMin, 1fr)`), and the gap between tiles. */
  tileMin: number;
  gap: number;
  /** A fixed column count (the sheet's 4); null: as many `tileMin` columns as fit. */
  fixedColumns: number | null;
  /** How many columns the grid has. */
  columns: number;
  /** The popover's grid scroller: its height, in whole rows, and how many rows that is. Null: what is left. */
  grid: { height: number; rows: number } | null;
  /** Full screen: its centred column's width, and the most of it the grid may take. */
  column: { width: number; gridRoom: number } | null;
  /** Full screen: the categories are in a sidebar on the left (`fullscreenSidebar`). */
  sidebar: boolean;
}

/** The size of the window's content, in CSS px. */
export interface WindowSize {
  width: number;
  height: number;
}

/**
 * The popover (worksuite-desktop#206). `width: min(880px, 100vw - 48px)`, centred on the window itself, never on a
 * part of it; if the Dock or a taskbar covers one side, narrower on both sides alike so it stays centred and clear of
 * it. Its top is 12% of the way down the window (Spotlight-style), at least 24px inside the visible area and 16px
 * under the top bar, so the search field does not move whatever is listed. Its height is the fixed parts plus as many
 * whole rows as fit in `min(640px, 100vh - 96px)` and 24px above the bottom of the visible area.
 */
export function popoverRect(win: WindowSize, area: Rect, parts: LauncherParts, row: { height: number; gap?: number }): Rect & { grid: { height: number; rows: number } } {
  const W = win.width;
  const H = win.height;
  let width = Math.min(POPOVER_MAX.width, W - POPOVER_GUTTER.x);
  const safeLeft = Math.max(0, area.left) + EDGE_MARGIN;
  const safeRight = Math.min(W, area.left + area.width) - EDGE_MARGIN;
  const half = Math.min(W / 2 - safeLeft, safeRight - W / 2);
  if (2 * half >= SHEET_BELOW) width = Math.min(width, 2 * half);
  width = Math.max(0, Math.floor(width));
  const left = Math.round((W - width) / 2);
  const visBottom = Math.min(H, area.top + area.height);
  const top = Math.max(area.top + EDGE_MARGIN, TOP_BAR_PX + 16, Math.round(H * POPOVER_TOP_FRACTION));
  const max = Math.min(POPOVER_MAX.height, H - POPOVER_GUTTER.y, visBottom - EDGE_MARGIN - top);
  const chrome = popoverChrome(parts);
  const grid = wholeRows(max - chrome, row.height, row.gap ?? GRID_GAP_PX);
  return { left, top, width, height: chrome + grid.height, grid };
}

/**
 * Full screen (worksuite-desktop#206): the window's content below the top bar, so never over the traffic lights or
 * the window buttons, and above the Dock; in it, one column at most 1080px wide, centred.
 */
export function fullscreenRect(win: WindowSize, area: Rect): Rect & { column: number } {
  const top = Math.max(TOP_BAR_PX, area.top);
  const bottom = Math.min(win.height, area.top + area.height);
  return { left: 0, top, width: win.width, height: Math.max(0, bottom - top), column: Math.min(FULL_COLUMN.maxWidth, win.width) };
}

/**
 * Where the launcher goes and how big it is: the popover (`popoverRect`), a bottom sheet in a window narrower than
 * 480px, or full screen (`fullscreenRect`). `area` is the part of the window the person can see (`visibleArea`);
 * `parts`, which of the fixed rows are showing.
 */
export function launcherLayout(
  win: WindowSize,
  area: Rect,
  prefs: Pick<LauncherPrefs, 'mode' | 'size'> & { toggles?: Partial<Pick<LauncherToggles, 'names' | 'sidebar'>> },
  parts: LauncherParts = { pinned: false, recent: false, chips: true },
): LauncherLayout {
  const names = prefs.toggles?.names ?? true;
  if (win.width < SHEET_BELOW) {
    const height = Math.floor(area.height * MAX_FRACTION);
    return { kind: 'sheet', left: area.left, top: area.top + area.height - height, width: area.width, height, icon: SHEET_ICON_PX, rowHeight: tileHeight(SHEET_ICON_PX, names), tileMin: 0, gap: GRID_GAP_PX, fixedColumns: SHEET_COLUMNS, columns: SHEET_COLUMNS, grid: null, column: null, sidebar: false };
  }
  if (prefs.mode === 'fullscreen') {
    const icon = FULL_ICON_PX[prefs.size];
    const r = fullscreenRect(win, area);
    const sidebar = fullscreenSidebar(r.column, prefs.toggles?.sidebar ?? DEFAULT_TOGGLES.sidebar, parts.chips);
    const gridWidth = r.column - 2 * FULL_COLUMN.padSide - (sidebar ? FULL_SIDEBAR.width + FULL_SIDEBAR.gap : 0);
    return {
      kind: 'fullscreen',
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      icon,
      rowHeight: fullTileHeight(icon, names),
      tileMin: FULL_TILE_MIN_PX,
      gap: FULL_GRID_GAP_PX,
      fixedColumns: null,
      columns: columnsFor(gridWidth, FULL_TILE_MIN_PX, FULL_GRID_GAP_PX),
      grid: null,
      column: { width: r.column, gridRoom: Math.max(0, r.height - fullscreenChrome(parts, sidebar)) },
      sidebar,
    };
  }
  const icon = ICON_PX[prefs.size];
  const rowHeight = tileHeight(icon, names);
  const p = popoverRect(win, area, parts, { height: rowHeight });
  return {
    kind: 'popover',
    left: p.left,
    top: p.top,
    width: p.width,
    height: p.height,
    icon,
    rowHeight,
    tileMin: TILE_MIN_PX,
    gap: GRID_GAP_PX,
    fixedColumns: null,
    columns: columnsFor(p.width - LAUNCHER_PARTS.border - 2 * GRID_PAD.x),
    grid: p.grid,
    column: null,
    sidebar: false,
  };
}

/** A row of tiles, or a category's heading, in full screen's grid. */
export interface GridBlock {
  height: number;
  /** The gap above it. */
  gapBefore: number;
  heading?: boolean;
}

/**
 * How tall full screen's grid is: all of it when it fits in `room`; otherwise down to the end of the last whole row
 * that fits, so it never stops through a row, nor on a heading with none of its row under it. `blocks` are the
 * grid's rows and headings, top to bottom.
 */
export function fitGridHeight(blocks: ReadonlyArray<GridBlock>, room: number, pad: { top: number; bottom: number } = GRID_PAD): number {
  let y = 0;
  let fit = 0;
  let all = true;
  for (const b of blocks) {
    y += b.gapBefore + b.height;
    if (pad.top + y + pad.bottom <= room) {
      if (!b.heading) fit = y;
    }
    else {
      all = false;
      break;
    }
  }
  if (all) return pad.top + y + pad.bottom;
  // Not even one row fits: all the room there is.
  return fit > 0 ? pad.top + fit + pad.bottom : Math.max(0, room);
}

/** One section of the grid: a category under its heading, or every tile under none. */
export interface LauncherSection {
  id: string;
  label: string | null;
  /** Each tile, and its place in `view.tiles` (for the keyboard). */
  items: Array<{ app: AppDefinition; index: number }>;
}

/**
 * The grid in sections. With `headings` (All apps, nothing searched, more than one category): category by category,
 * each under its name: Communication, Work, Business, People, Operations, Admin, or the person's own groups. Without:
 * one section, no heading.
 */
export function launcherSections(view: Pick<LauncherView, 'tiles' | 'categories'>, prefs: Pick<LauncherPrefs, 'groupBy' | 'groups'>, headings: boolean): LauncherSection[] {
  if (!headings) return [{ id: ALL_CATEGORY, label: null, items: view.tiles.map((app, index) => ({ app, index })) }];
  const out: LauncherSection[] = [];
  view.tiles.forEach((app, index) => {
    const c = categoryOf(app, prefs);
    const last = out.at(-1);
    if (last?.id === c) last.items.push({ app, index });
    else out.push({ id: c, label: view.categories.find((x) => x.id === c)?.label ?? null, items: [{ app, index }] });
  });
  return out;
}

/** A grid in sections as rows and headings, top to bottom, for `fitGridHeight`. */
export function sectionBlocks(
  sections: ReadonlyArray<{ label: string | null; items: readonly unknown[] }>,
  columns: number,
  rowHeight: number,
  gap: number,
  heading: number = LAUNCHER_PARTS.heading,
): GridBlock[] {
  const out: GridBlock[] = [];
  for (const s of sections) {
    if (s.label) out.push({ height: heading, gapBefore: 0, heading: true });
    const rows = Math.ceil(s.items.length / Math.max(1, columns));
    for (let r = 0; r < rows; r++) out.push({ height: rowHeight, gapBefore: r === 0 ? 0 : gap });
  }
  return out;
}

/** Whether a scroller has more below what shows: when the bottom fade is drawn. */
export function hasMoreBelow(el: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight > 1;
}

/** Whether a scroller has been scrolled down from its top: when the top fade is drawn. */
export function hasMoreAbove(el: { scrollTop: number }): boolean {
  return el.scrollTop > 1;
}

/** Which of the scroll fades to draw (worksuite-desktop#233): each only while there is more past that edge. */
export function scrollFades(el: { scrollTop: number; clientHeight: number; scrollHeight: number } | null | undefined): { top: boolean; bottom: boolean } {
  if (!el) return { top: false, bottom: false };
  return { top: hasMoreAbove(el), bottom: hasMoreBelow(el) };
}

/** Whether the footer is too narrow for the keys, and says only the count and Esc to close. */
export function footerNarrow(width: number, sheet = false): boolean {
  return sheet || width < FOOTER_NARROW_BELOW;
}

/** How many columns `repeat(auto-fill, minmax(88px, 1fr))` makes in a grid this wide. */
export function columnsFor(width: number, min = TILE_MIN_PX, gap = GRID_GAP_PX): number {
  if (!(width > 0)) return 1;
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/** Where a key takes the selection in a grid of `count` tiles, `columns` to a row. */
export function gridStep(index: number, key: string, count: number, columns: number): number {
  if (count === 0) return index;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const move = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns } as Record<string, number>)[key];
  if (move === undefined) return index;
  const next = index + move;
  return next < 0 || next >= count ? index : next;
}

/**
 * `gridStep` for a grid in sections (`sizes`: how many tiles each has), where every section starts a new row: up and
 * down go to the row above or below, the next section's too, in the same column or the row's last tile if it is
 * shorter. Left, right, Home and End go through the tiles in order.
 */
export function sectionStep(index: number, key: string, sizes: readonly number[], columns: number): number {
  const count = sizes.reduce((n, s) => n + s, 0);
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return gridStep(index, key, count, columns);
  if (count === 0) return index;
  const cols = Math.max(1, columns);
  const rows: Array<{ start: number; length: number }> = [];
  let start = 0;
  for (const s of sizes) {
    for (let r = 0; r * cols < s; r++) rows.push({ start: start + r * cols, length: Math.min(cols, s - r * cols) });
    start += s;
  }
  const at = rows.findIndex((r) => index >= r.start && index < r.start + r.length);
  const to = rows[at + (key === 'ArrowDown' ? 1 : -1)];
  if (at < 0 || !to) return index;
  return to.start + Math.min(index - rows[at]!.start, to.length - 1);
}

// ── its shortcut ────────────────────────────────────────────────────────

export type ShortcutProblem = { kind: 'modifier' } | { kind: 'taken'; command: string };

/**
 * Whether the launcher may use this shortcut: it needs ⌘/Ctrl or Alt (a plain key is typing), and must not be one
 * another command answers — Search's ⌘K above all. `others` is every other command's shortcut, by command.
 */
export function launcherShortcutProblem(acc: string, others: Readonly<Record<string, string>>): ShortcutProblem | null {
  if (!isUsableShortcut(acc)) return { kind: 'modifier' };
  if (acc === 'Mod+K') return { kind: 'taken', command: 'search' };
  const owner = Object.entries(others).find(([id, a]) => id !== 'launcher' && a === acc);
  return owner ? { kind: 'taken', command: owner[0] } : null;
}
