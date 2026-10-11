import type { DriveFolder, TreeNode } from './api';

/**
 * The Files rail's folder tree as logic (worksuite-desktop#328): which actions
 * a folder's menu offers, the order folders are shown in, what the keyboard
 * does in the tree, and where a dragged folder may go. Pure, so it is tested
 * without a screen; Rail.tsx draws it and DriveCtx carries the actions out.
 */

/* ---- What a folder's menu offers ---- */

export type RailAction =
  | 'open' | 'open-tab' | 'open-window'
  | 'new-folder' | 'upload-files' | 'upload-folder' | 'new-doc'
  | 'share' | 'copy-link' | 'manage-access'
  | 'rename' | 'move' | 'copy' | 'colour' | 'star' | 'pin'
  | 'offline'
  | 'details' | 'activity' | 'versions'
  | 'zip' | 'reveal'
  | 'bin' | 'leave' | 'remove';

export type RailGroup = 'open' | 'create' | 'share' | 'organise' | 'offline' | 'info' | 'other' | 'danger';

/** Own: mine. Shared: somebody else's, shared with me. System: the product's, which keeps its name and place. */
export type FolderKind = 'own' | 'shared' | 'system';

/** What this computer and this account offer, beside the folder's own access. */
export interface RailEnv {
  /** Drive sync is allowed here (the desktop app, and policy). */
  syncAvailable: boolean;
  /** The folder is kept on this computer: Available offline is on, and it can be shown in Finder. */
  synced: boolean;
  /** New document ▸ is offered (WorkSuite Office, or the server's own blank files). */
  docs: boolean;
}

/** Everything an owner may do: the tree lists the caller's own folders, which come without an `access`. */
const OWNER_CAPS = ['open', 'preview', 'download', 'copy_link', 'chat_share', 'edit', 'add_files', 'rename', 'share', 'manage_permissions', 'move', 'delete', 'restore'];
/** Never on a system folder, whatever the access says (the server refuses them too). */
const SYSTEM_LOCKED = ['rename', 'move', 'delete'];

export function folderKind(f: Pick<DriveFolder, 'access' | 'is_system'>): FolderKind {
  if (f.is_system) return 'system';
  return f.access && !f.access.owner ? 'shared' : 'own';
}

/** What the caller may do with a folder: the server's word when the row carries it, an owner's otherwise. */
export function folderCaps(f: Pick<DriveFolder, 'access' | 'is_system'>): Set<string> {
  const caps = new Set(f.access ? f.access.capabilities : OWNER_CAPS);
  if (f.is_system) for (const c of SYSTEM_LOCKED) caps.delete(c);
  return caps;
}

/**
 * The folder menu's actions, group by group, each only when it can be used:
 * Rename, Move and Bin are gone from a view-only share; a system folder
 * keeps its name and place; a folder shared with me offers Leave folder (shared
 * with me as a person) or Remove from my Drive (through a team or role) instead
 * of the bin.
 */
export function railActions(f: Pick<DriveFolder, 'access' | 'is_system' | 'is_locked'>, env: RailEnv): Array<{ group: RailGroup; actions: RailAction[] }> {
  const caps = folderCaps(f);
  const kind = folderKind(f);
  const owner = kind !== 'shared';
  const has = (c: string) => caps.has(c);
  const groups: Array<{ group: RailGroup; actions: Array<RailAction | false> }> = [
    { group: 'open', actions: ['open', 'open-tab', 'open-window'] },
    { group: 'create', actions: has('add_files') ? ['new-folder', 'upload-files', 'upload-folder', env.docs && 'new-doc'] : [] },
    { group: 'share', actions: [has('share') && 'share', 'copy-link', has('share') && 'manage-access'] },
    {
      group: 'organise',
      actions: [has('rename') && 'rename', has('move') && 'move', has('download') && 'copy', has('edit') && 'colour', 'star', 'pin'],
    },
    // Keeping a folder on this computer is its owner's choice, and a password-locked folder never syncs.
    { group: 'offline', actions: [env.syncAvailable && owner && !f.is_locked && 'offline'] },
    { group: 'info', actions: ['details', 'activity', 'versions'] },
    { group: 'other', actions: [has('download') && 'zip', env.synced && 'reveal'] },
    { group: 'danger', actions: [kind === 'shared' ? (f.access?.via === 'direct' ? 'leave' : 'remove') : has('delete') && 'bin'] },
  ];
  return groups
    .map((g) => ({ group: g.group, actions: g.actions.filter((a): a is RailAction => !!a) }))
    .filter((g) => g.actions.length > 0);
}

/* ---- The order folders are shown in ---- */

export type RailSort = 'name' | 'modified' | 'manual';

export interface RailOrder {
  sort: RailSort;
  starredFirst: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Siblings in the order the rail shows them, all the way down: pinned folders
 * first, then (when asked) starred ones, then by name, by when they last
 * changed (newest first) or in the order they were dragged into (manual).
 */
export function sortTree(nodes: TreeNode[], order: RailOrder): TreeNode[] {
  const rank = (n: TreeNode) => (n.pinned ? 0 : 2) + (order.starredFirst && !n.starred ? 1 : 0);
  const by = (a: TreeNode, b: TreeNode): number => {
    if (order.sort === 'modified') {
      const d = (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
      if (d) return d;
    }
    if (order.sort === 'manual') {
      const d = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (d) return d;
    }
    return collator.compare(a.name, b.name) || a.id - b.id;
  };
  return [...nodes].sort((a, b) => rank(a) - rank(b) || by(a, b)).map((n) => (n.children.length ? { ...n, children: sortTree(n.children, order) } : n));
}

/* ---- Finding things in the tree ---- */

export function findNode(nodes: TreeNode[], id: number): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** The folders beside this one (itself included), in the order given. */
export function siblingsOf(nodes: TreeNode[], id: number): TreeNode[] {
  if (nodes.some((n) => n.id === id)) return nodes;
  for (const n of nodes) {
    const hit = siblingsOf(n.children, id);
    if (hit.length) return hit;
  }
  return [];
}

/** The folders directly inside a folder; null is the top of My Drive. */
export function childrenOf(nodes: TreeNode[], parent: number | null): TreeNode[] {
  return parent === null ? nodes : (findNode(nodes, parent)?.children ?? []);
}

/** Why a folder may not be called this here, or null when it may (the server answers too). */
export function renameProblem(name: string, siblings: Array<Pick<DriveFolder, 'id' | 'name'>>, self: number | null): string | null {
  const n = name.trim();
  if (!n) return 'A folder needs a name.';
  if (/[/\\]/.test(n)) return 'A folder name can’t contain / or \\.';
  if (n === '.' || n === '..') return 'That name is not allowed.';
  if (n.length > 120) return 'Keep the name under 120 characters.';
  const lower = n.toLocaleLowerCase();
  if (siblings.some((s) => s.id !== self && s.name.toLocaleLowerCase() === lower)) return `There is already a folder called “${n}” here.`;
  return null;
}

/* ---- The tree on screen, and the keyboard ---- */

export interface RailRow {
  id: number;
  depth: number;
  parent: number | null;
  hasChildren: boolean;
  expanded: boolean;
  /** Its place among its siblings, from 1, and how many there are: aria-posinset and aria-setsize. */
  pos: number;
  size: number;
  node: TreeNode;
}

/** The rows a person can see: each folder, and the children of the expanded ones. */
export function visibleRows(nodes: TreeNode[], expanded: ReadonlySet<number>, depth = 0, parent: number | null = null): RailRow[] {
  return nodes.flatMap((n, i) => {
    const open = n.children.length > 0 && expanded.has(n.id);
    const row: RailRow = { id: n.id, depth, parent, hasChildren: n.children.length > 0, expanded: open, pos: i + 1, size: nodes.length, node: n };
    return [row, ...(open ? visibleRows(n.children, expanded, depth + 1, n.id) : [])];
  });
}

export type TreeMove =
  | { kind: 'focus'; id: number }
  | { kind: 'expand'; id: number }
  | { kind: 'collapse'; id: number }
  | { kind: 'open'; id: number }
  | { kind: 'rename'; id: number }
  | { kind: 'bin'; id: number }
  | { kind: 'menu'; id: number };

export interface TreeKey {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/**
 * What a key does in the folder tree (the WAI-ARIA tree pattern): ↑ ↓ Home End
 * move; → opens a closed folder, or moves into an open one; ← closes an open
 * folder, or moves to its parent; Enter opens it; F2 renames; ⌘⌫ (Ctrl+Delete
 * elsewhere, or Delete) moves it to the bin; ⇧F10 or the Menu key opens its menu.
 */
export function treeKey(rows: RailRow[], current: number | null, e: TreeKey, mac: boolean): TreeMove | null {
  if (!rows.length) return null;
  const i = rows.findIndex((r) => r.id === current);
  const row = i >= 0 ? rows[i]! : null;
  if (!row) return e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End' ? { kind: 'focus', id: (e.key === 'ArrowUp' || e.key === 'End' ? rows[rows.length - 1]! : rows[0]!).id } : null;
  switch (e.key) {
    case 'ArrowDown':
      return i < rows.length - 1 ? { kind: 'focus', id: rows[i + 1]!.id } : null;
    case 'ArrowUp':
      return i > 0 ? { kind: 'focus', id: rows[i - 1]!.id } : null;
    case 'Home':
      return { kind: 'focus', id: rows[0]!.id };
    case 'End':
      return { kind: 'focus', id: rows[rows.length - 1]!.id };
    case 'ArrowRight':
      if (!row.hasChildren) return null;
      return row.expanded ? { kind: 'focus', id: rows[i + 1]!.id } : { kind: 'expand', id: row.id };
    case 'ArrowLeft':
      if (row.expanded) return { kind: 'collapse', id: row.id };
      return row.parent !== null ? { kind: 'focus', id: row.parent } : null;
    case 'Enter':
      return { kind: 'open', id: row.id };
    case 'F2':
      return { kind: 'rename', id: row.id };
    case 'F10':
      return e.shiftKey ? { kind: 'menu', id: row.id } : null;
    case 'ContextMenu':
      return { kind: 'menu', id: row.id };
    case 'Backspace':
      return (mac ? e.metaKey : e.ctrlKey) ? { kind: 'bin', id: row.id } : null;
    case 'Delete':
      return { kind: 'bin', id: row.id };
    default:
      return null;
  }
}

/* ---- Dragging ---- */

/** A folder and every folder under it. */
export function subtreeIds(nodes: TreeNode[], id: number): Set<number> {
  const out = new Set<number>();
  const walk = (n: TreeNode) => {
    out.add(n.id);
    n.children.forEach(walk);
  };
  const root = findNode(nodes, id);
  if (root) walk(root);
  else out.add(id);
  return out;
}

/**
 * Whether dragged folders may be dropped into a target (null: the top of My
 * Drive): never into themselves or anything under them, and a system folder
 * never moves at all. Files go anywhere the server lets them.
 */
export function canDropInto(nodes: TreeNode[], folders: number[], target: number | null): boolean {
  for (const id of folders) {
    const n = findNode(nodes, id);
    if (n?.is_system) return false;
    if (target !== null && subtreeIds(nodes, id).has(target)) return false;
  }
  return true;
}

export type DropZone = 'before' | 'inside' | 'after';

/** Where on a row a drag is: its top or bottom quarter places a folder beside it (when reordering is allowed), the middle puts it inside. */
export function dropZone(offsetY: number, height: number, reorder: boolean): DropZone {
  if (!reorder || height <= 0) return 'inside';
  if (offsetY < height / 4) return 'before';
  if (offsetY > (height * 3) / 4) return 'after';
  return 'inside';
}

/** Siblings' ids after one is dragged before or after another (it may come from elsewhere, and joins them). */
export function reorderIds(siblings: number[], dragged: number, target: number, where: 'before' | 'after'): number[] {
  const rest = siblings.filter((id) => id !== dragged);
  const at = rest.indexOf(target);
  if (at < 0) return [...rest, dragged];
  rest.splice(where === 'before' ? at : at + 1, 0, dragged);
  return rest;
}
