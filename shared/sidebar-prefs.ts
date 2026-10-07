/**
 * Each person's own sidebar: apps pinned to a Pinned section at its top, apps removed from it, and the order of each
 * section. Kept by the server per person and organisation (`/api/sidebar/prefs`, docs/BACKEND.md › Sidebar
 * preferences), or on this computer where there is no server for it (guest mode, an older server).
 *
 * Pure: no DOM, no storage, no network. The renderer keeps the preferences (src/core/sidebar-prefs.ts) and draws them
 * (src/layouts/Sidebar.tsx, src/modules/settings/SidebarSettings.tsx).
 *
 * The preferences only ever change how apps the person may open are shown: they are laid over the apps that are
 * already through the access gates, so a preference for an app the person cannot open is never drawn, and an app the
 * person gains appears in its default place. The desktop's sidebar has no submenus: every row is a top-level app
 * (`parent: null`); rows with a parent belong to another client and are left alone.
 */

export const SIDEBAR_SECTIONS = ['work', 'business'] as const;
/** `work` is above the divider, `business` below it. */
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];

/** One app the person changed; the server sends only these. */
export interface SidebarPrefRow {
  /** The app's id (`AppDefinition.id`), never its label. */
  key: string;
  parent: string | null;
  pinned: boolean;
  hidden: boolean;
  /** Its place in its own section; null: its default place. */
  position: number | null;
  /** Its place in Pinned. */
  pinned_position: number | null;
  /** The section its `position` was saved in; a position saved in another section than the app's own is not used. */
  section: string | null;
}

/** The whole state, as every answer of `/api/sidebar/prefs` carries it. */
export interface SidebarPrefsData {
  items: SidebarPrefRow[];
  updated_at: string | null;
}

export const EMPTY_SIDEBAR_PREFS: SidebarPrefsData = Object.freeze({ items: [], updated_at: null }) as SidebarPrefsData;

export type SidebarOrderBody = { scope: 'pinned'; keys: string[] } | { scope: 'section'; section: SidebarSection; keys: string[] };

/** One change, as the desktop sends it; applied here first, and on this computer alone where there is no server. */
export type SidebarOp =
  | { kind: 'pin'; key: string; pinned: boolean }
  | { kind: 'hide'; key: string; hidden: boolean }
  | { kind: 'order'; body: SidebarOrderBody }
  | { kind: 'reset' };

/** An app in its default place: which section it is in. */
export interface SidebarDefault<T> {
  item: T;
  section: SidebarSection;
}

export interface SidebarLayout<T> {
  pinned: T[];
  work: T[];
  business: T[];
}

const KEY_MAX = 100;
const SECTION_MAX = 32;
const ROWS_MAX = 500;

const asBool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';

function asPosition(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asRow(raw: unknown): SidebarPrefRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.key !== 'string' || !r.key || r.key.length > KEY_MAX) return null;
  const parent = typeof r.parent === 'string' && r.parent ? r.parent : null;
  const section = typeof r.section === 'string' && r.section && r.section.length <= SECTION_MAX ? r.section : null;
  const pinned = asBool(r.pinned);
  // As the server speaks it: no pinned position for what is not pinned.
  return { key: r.key, parent, pinned, hidden: asBool(r.hidden), position: asPosition(r.position), pinned_position: pinned ? asPosition(r.pinned_position) : null, section };
}

/**
 * The server's answer (or this computer's copy) made safe to use: unknown fields dropped, booleans and numbers as a PHP
 * server may send them ("1", "3") read as such. Null when it is not the state at all.
 */
export function normaliseSidebarPrefs(raw: unknown): SidebarPrefsData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.items)) return null;
  const items: SidebarPrefRow[] = [];
  for (const it of r.items.slice(0, ROWS_MAX)) {
    const row = asRow(it);
    if (row) items.push(row);
  }
  return { items, updated_at: typeof r.updated_at === 'string' && r.updated_at ? r.updated_at : null };
}

/**
 * Where each app is by default, in sidebar order: native apps by their own section (`AppDefinition.sidebar`), work
 * above the divider and business below it. Guest mode lists all its apps together, above the locked ones.
 */
export function sidebarDefaults<T extends { surface: string; sidebar?: SidebarSection }>(listed: readonly T[], guest = false): Array<SidebarDefault<T>> {
  const native = listed.filter((a) => a.surface === 'native');
  if (guest) return native.map((item) => ({ item, section: 'work' as const }));
  return native.filter((a) => a.sidebar === 'work' || a.sidebar === 'business').map((item) => ({ item, section: item.sidebar! }));
}

/** The desktop's own rows: top level (the desktop has no submenus), the first row per key. */
function rowsByKey(rows: readonly SidebarPrefRow[]): Map<string, SidebarPrefRow> {
  const out = new Map<string, SidebarPrefRow>();
  for (const r of rows) if (r.parent === null && !out.has(r.key)) out.set(r.key, r);
  return out;
}

const byNullLast = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);

/**
 * One section in the person's order: apps with a saved position by it; each app without one (new to the person, or
 * restored) right after the app it follows by default — first, when it is first by default.
 */
function placeSection<T extends { id: string }>(items: readonly T[], positionOf: (id: string) => number | null): T[] {
  const indexed = items.map((item, i) => ({ item, i, p: positionOf(item.id) }));
  const placed = indexed.filter((x) => x.p !== null).sort((a, b) => a.p! - b.p! || a.i - b.i);
  for (const x of indexed) {
    if (x.p !== null) continue;
    // The nearest app before it by default that is already placed.
    let at = -1;
    let best = -1;
    placed.forEach((y, j) => {
      if (y.i < x.i && y.i > best) {
        best = y.i;
        at = j;
      }
    });
    placed.splice(at + 1, 0, x);
  }
  return placed.map((x) => x.item);
}

/**
 * The sidebar as the person sees it: Pinned first (by `pinned_position`), then each section in their order. The
 * server's own merge (`SidebarPrefs::apply`) is the reference: a position saved in another section than the one the
 * app is in now is not used (the app has moved; its old place means nothing here).
 *
 * `defaults` are the apps in their default places, in sidebar order; `allowed` every app the person may open (through
 * the access gates already), which is also where a pinned app that is not in the sidebar by default (a browser app, a
 * channel) is found. Only allowed apps are ever returned; hidden ones never; a row is never a reason to add an app.
 */
export function mergeSidebar<T extends { id: string }>(defaults: ReadonlyArray<SidebarDefault<T>>, allowed: readonly T[], rows: readonly SidebarPrefRow[]): SidebarLayout<T> {
  const allow = new Map<string, T>();
  for (const a of allowed) if (!allow.has(a.id)) allow.set(a.id, a);
  const prefs = rowsByKey(rows);
  const seen = new Set<string>();
  const usable = defaults.filter((d) => {
    if (!allow.has(d.item.id) || seen.has(d.item.id)) return false;
    seen.add(d.item.id);
    return true;
  });
  const defaultRank = new Map(usable.map((d, i) => [d.item.id, i]));
  const allowedRank = new Map([...allow.keys()].map((id, i) => [id, i]));
  const rank = (id: string) => defaultRank.get(id) ?? usable.length + (allowedRank.get(id) ?? 0);

  const pinnedRows = [...prefs.values()].filter((r) => r.pinned && !r.hidden && allow.has(r.key));
  pinnedRows.sort((a, b) => byNullLast(a.pinned_position, b.pinned_position) || rank(a.key) - rank(b.key));
  const pinned = pinnedRows.map((r) => allow.get(r.key)!);
  const isPinned = new Set(pinnedRows.map((r) => r.key));

  const section = (s: SidebarSection) =>
    placeSection(
      usable.filter((d) => d.section === s && !isPinned.has(d.item.id) && !prefs.get(d.item.id)?.hidden).map((d) => d.item),
      (id) => {
        const r = prefs.get(id);
        return r && (r.section === null || r.section === s) ? r.position : null;
      },
    );
  return { pinned, work: section('work'), business: section('business') };
}

/** The apps removed from the sidebar that would come back on Restore: in the sidebar by default, and allowed. */
export function hiddenSidebarItems<T extends { id: string }>(defaults: ReadonlyArray<SidebarDefault<T>>, allowed: readonly T[], rows: readonly SidebarPrefRow[]): T[] {
  const prefs = rowsByKey(rows);
  const allow = new Set(allowed.map((a) => a.id));
  return defaults.filter((d) => allow.has(d.item.id) && prefs.get(d.item.id)?.hidden).map((d) => d.item);
}

const blank = (key: string): SidebarPrefRow => ({ key, parent: null, pinned: false, hidden: false, position: null, pinned_position: null, section: null });
const isDefaultRow = (r: SidebarPrefRow) => !r.pinned && !r.hidden && r.position === null && r.pinned_position === null;

function patchRow(items: SidebarPrefRow[], key: string, fn: (r: SidebarPrefRow) => SidebarPrefRow): SidebarPrefRow[] {
  const i = items.findIndex((r) => r.key === key && r.parent === null);
  const next = fn(i >= 0 ? items[i]! : blank(key));
  const out = items.slice();
  if (i >= 0) {
    if (isDefaultRow(next)) out.splice(i, 1);
    else out[i] = next;
  } else if (!isDefaultRow(next)) out.push(next);
  return out;
}

/**
 * A change, as the server makes it (`SidebarPrefs::pin`, `hide`, `order`): pinning puts the app at the end of Pinned
 * and shows it again if it was removed; unpinning returns it to its own place; hiding also unpins, and keeps its
 * position; an order gives the listed apps positions 0…n−1 (in Pinned, for apps pinned already; or in their section,
 * which is kept with each); reset forgets everything. Rows that end up the same as the default are dropped, as the
 * server sends only those that differ.
 */
export function applySidebarOp(data: SidebarPrefsData, op: SidebarOp, now: string | null = data.updated_at): SidebarPrefsData {
  let items = data.items;
  switch (op.kind) {
    case 'reset':
      return { items: [], updated_at: now };
    case 'pin': {
      const current = items.find((r) => r.key === op.key && r.parent === null);
      if (op.pinned) {
        if (current?.pinned) {
          if (!current.hidden) return data;
          items = patchRow(items, op.key, (r) => ({ ...r, hidden: false }));
          break;
        }
        const last = items.reduce((m, r) => (r.pinned && r.parent === null && r.pinned_position !== null ? Math.max(m, r.pinned_position) : m), -1);
        items = patchRow(items, op.key, (r) => ({ ...r, pinned: true, hidden: false, pinned_position: last + 1 }));
      } else {
        if (!current?.pinned && current?.pinned_position == null) return data;
        items = patchRow(items, op.key, (r) => ({ ...r, pinned: false, pinned_position: null }));
      }
      break;
    }
    case 'hide':
      items = patchRow(items, op.key, (r) => (op.hidden ? { ...r, hidden: true, pinned: false, pinned_position: null } : { ...r, hidden: false }));
      break;
    case 'order': {
      const { body } = op;
      body.keys.forEach((key, i) => {
        items = patchRow(items, key, (r) => (body.scope === 'pinned' ? (r.pinned ? { ...r, pinned_position: i } : r) : { ...r, position: i, section: body.section }));
      });
      break;
    }
  }
  return { items, updated_at: now };
}

/** `keys` with `moving` put just before or after `target`; the same array when nothing moves. */
export function reorderKeys(keys: readonly string[], moving: string, target: string, place: 'before' | 'after'): string[] {
  if (moving === target || !keys.includes(moving) || !keys.includes(target)) return keys as string[];
  const rest = keys.filter((k) => k !== moving);
  const at = rest.indexOf(target) + (place === 'after' ? 1 : 0);
  rest.splice(at, 0, moving);
  return rest.every((k, i) => k === keys[i]) ? (keys as string[]) : rest;
}

/** `keys` with `key` moved one place up (-1) or down (+1); the same array at either end. */
export function moveKey(keys: readonly string[], key: string, delta: -1 | 1): string[] {
  const i = keys.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= keys.length) return keys as string[];
  const out = keys.slice();
  out[i] = keys[j]!;
  out[j] = key;
  return out;
}
