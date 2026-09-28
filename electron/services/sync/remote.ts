import type { SyncIssue, SyncPolicy } from '@shared/types';
import type { HttpClient } from '../http';
import type { Picture, RemoteItem } from './plan';
import { isIgnored, joinRel, localNameProblem, policyRefusal } from './rules';

/**
 * The picture of the Drive folder, from the same endpoints the Files screens
 * read: the folder tree (`/api/drive/tree`) and the folder's files with its
 * whole subtree (`/api/drive/list?folder_id=&deep=1`), which carry each
 * file's id, version and checksum.
 *
 * Only what this person may download is in the picture. Password-locked
 * folders are blind (their files are not listed without the password), as
 * is anything whose name this computer cannot hold, or that the sync policy
 * refuses — blind, so the copy on this computer is left alone rather than
 * taken for deleted.
 *
 * A listing is paged. When the folder's count moves between the first page
 * and the last, something changed under the listing and it is taken again: a
 * file missed between two pages would otherwise look deleted.
 */

interface Access {
  owner?: boolean;
  can_download?: boolean;
  capabilities?: string[];
}

interface TreeNode {
  id: number;
  parent_id: number | null;
  name: string;
  is_locked?: boolean;
  owner_id?: number;
  access?: Access | null;
  children?: TreeNode[];
}

interface FileRow {
  id: number;
  name: string;
  size: number;
  folder_id: number | null;
  sha256: string | null;
  version: number | null;
  owner_id: number | null;
  deleted_at: string | null;
  access?: Access | null;
}

export interface RemoteList {
  picture: Picture<RemoteItem>;
  issues: SyncIssue[];
  /** The synced Drive folder itself is gone (deleted, or no longer this person's). */
  missingRoot: boolean;
  /** The folder's current name, to keep the display in step with Drive. */
  rootName: string | null;
  /** Folder id → its path inside the synced folder ('' for the synced folder itself). */
  folders: Map<number, string>;
}

export interface ListOptions {
  rootId: number | null;
  userId: number;
  key: (rel: string) => string;
  patterns: readonly string[];
  policy: SyncPolicy | null;
  platform: NodeJS.Platform;
  /** Drive ids the index already knows: when two Drive items claim one name here, the known one keeps it. */
  known: { files: Set<number>; dirs: Set<number> };
}

const PAGE = 200;

function caps(a: Access | null | undefined, own: boolean, cap: string): boolean {
  if (a?.capabilities) return a.capabilities.includes(cap);
  return own;
}

async function listPages(http: Pick<HttpClient, 'get'>, query: Record<string, string | number>): Promise<FileRow[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const out: FileRow[] = [];
    let total: number | null = null;
    let moved = false;
    for (let page = 1; page < 1000; page++) {
      const r = await http.get<{ files?: FileRow[]; total?: number }>('/api/drive/list', { query: { ...query, per_page: PAGE, page, counts: 0, sort: 'created', dir: 'asc' }, timeoutMs: 60_000 });
      const rows = r.files ?? [];
      if (total === null) total = Number(r.total ?? rows.length);
      else if (Number(r.total ?? total) !== total) moved = true;
      out.push(...rows);
      if (rows.length < PAGE || out.length >= total) break;
    }
    if (!moved) return out;
  }
  throw new Error('Drive kept changing while this folder was being listed. It will be tried again shortly.');
}

export async function listRemote(http: Pick<HttpClient, 'get'>, opts: ListOptions): Promise<RemoteList> {
  const { key } = opts;
  const items = new Map<string, RemoteItem>();
  const blind = new Set<string>();
  const issues: SyncIssue[] = [];
  const folders = new Map<number, string>();

  const tree = await http.get<{ tree?: TreeNode[] }>('/api/drive/tree', { timeoutMs: 60_000 });
  const roots = tree.tree ?? [];

  let top: TreeNode[];
  let rootName: string | null = 'My Drive';
  if (opts.rootId === null) {
    top = roots;
  } else {
    const find = (nodes: TreeNode[]): TreeNode | null => {
      for (const n of nodes) {
        if (n.id === opts.rootId) return n;
        const hit = find(n.children ?? []);
        if (hit) return hit;
      }
      return null;
    };
    const root = find(roots);
    if (!root) return { picture: { items, blind }, issues, missingRoot: true, rootName: null, folders };
    if (root.is_locked) {
      issues.push({ path: '', kind: 'error', message: 'This folder is locked with a password, and locked folders are not synced.' });
      blind.add('');
      return { picture: { items, blind }, issues, missingRoot: false, rootName: root.name, folders };
    }
    rootName = root.name;
    folders.set(root.id, '');
    top = root.children ?? [];
  }

  // Place one item under a name, or say why it cannot have it.
  const claim = (item: RemoteItem, known: boolean): boolean => {
    const k = key(item.rel);
    const held = items.get(k);
    if (held) {
      const heldKnown = held.kind === 'dir' ? opts.known.dirs.has(held.id) : opts.known.files.has(held.id);
      const keep = heldKnown || (!known && held.id < item.id) ? held : item;
      const drop = keep === held ? item : held;
      items.set(k, keep);
      issues.push({ path: drop.rel, kind: 'skipped', message: `Another item in Drive already has this name${drop.rel.toLowerCase() === keep.rel.toLowerCase() && drop.rel !== keep.rel ? ' (apart from capital letters, which this computer does not tell apart)' : ''}, and only one of them can be here.` });
      return keep === item;
    }
    items.set(k, item);
    return true;
  };

  const walk = (nodes: TreeNode[], parentRel: string) => {
    for (const n of nodes) {
      const rel = joinRel(parentRel, n.name);
      if (isIgnored(rel, opts.patterns)) continue;
      const problem = localNameProblem(n.name, opts.platform);
      if (problem) {
        blind.add(key(rel));
        issues.push({ path: rel, kind: 'skipped', message: problem });
        continue;
      }
      if (n.is_locked) {
        blind.add(key(rel));
        issues.push({ path: rel, kind: 'skipped', message: 'Locked with a password: locked folders are not synced.' });
        continue;
      }
      const own = n.owner_id === undefined || n.owner_id === opts.userId || n.access?.owner === true;
      const item: RemoteItem = { rel, kind: 'dir', id: n.id, version: 0, size: 0, sha256: null, own, editable: caps(n.access, own, 'add_files'), deletable: caps(n.access, own, 'delete'), movable: caps(n.access, own, 'move') && caps(n.access, own, 'rename') };
      if (!claim(item, opts.known.dirs.has(n.id))) continue;
      folders.set(n.id, rel);
      walk(n.children ?? [], rel);
    }
  };
  walk(top, '');

  // The files: the synced folder with everything under it, or, for all of My Drive, the loose files at the top and each top folder in turn.
  const rows: FileRow[] = [];
  if (opts.rootId === null) {
    rows.push(...(await listPages(http, {})));
    for (const n of top) if (folders.has(n.id)) rows.push(...(await listPages(http, { folder_id: n.id, deep: 1 })));
  } else {
    rows.push(...(await listPages(http, { folder_id: opts.rootId, deep: 1 })));
  }

  const seen = new Set<number>();
  for (const f of rows) {
    if (seen.has(f.id) || f.deleted_at) continue;
    seen.add(f.id);
    const parent = f.folder_id === null ? (opts.rootId === null ? '' : undefined) : folders.get(f.folder_id);
    if (parent === undefined) continue; // inside a folder that is not synced (hidden, archived, locked, skipped)
    const rel = joinRel(parent, f.name);
    if (isIgnored(rel, opts.patterns)) continue;
    const own = f.owner_id === opts.userId;
    if (!own && !(f.access?.can_download ?? false)) continue;
    const problem = localNameProblem(f.name, opts.platform) ?? policyRefusal(opts.policy, f.name, Number(f.size));
    if (problem) {
      blind.add(key(rel));
      issues.push({ path: rel, kind: 'skipped', message: problem });
      continue;
    }
    claim(
      {
        rel,
        kind: 'file',
        id: Number(f.id),
        version: Number(f.version ?? 1),
        size: Number(f.size),
        sha256: f.sha256 ?? null,
        own,
        editable: caps(f.access, own, 'upload_version'),
        deletable: caps(f.access, own, 'delete'),
        movable: caps(f.access, own, 'move') && caps(f.access, own, 'rename'),
      },
      opts.known.files.has(Number(f.id)),
    );
  }

  return { picture: { items, blind }, issues, missingRoot: false, rootName, folders };
}
