import type { SyncMode } from '@shared/types';
import { depthOf, isUnder, nameOf, rebaseRel } from './rules';

/**
 * What one sync pass should do, decided from three pictures of one folder:
 *
 *   base   — what this computer and Drive last agreed on (the index);
 *   local  — what is in the folder on this computer now;
 *   remote — what is in the Drive folder now.
 *
 * A side "changed" a path when it differs from the base. Only a change is
 * carried to the other side; a path that changed on both is a conflict, and a
 * conflict keeps both copies. That is the whole of it, and the reason for it
 * is the server's own rule: never overwrite silently.
 *
 * WHY NOT THE SERVER'S JOURNAL ALONE. The journal (`/api/sync/delta`) tells a
 * device that something changed, and the engine uses it for exactly that. It
 * cannot carry a folder sync by itself: its events name a file without its
 * folder, trashing a file records nothing, and folders record nothing at all.
 * Comparing pictures needs none of that, and it also recovers from anything
 * a missed event would have lost.
 *
 * Pure. The engine takes the pictures and carries out what comes back.
 */

export type Kind = 'file' | 'dir';

export interface LocalItem {
  rel: string;
  kind: Kind;
  size: number;
  mtimeMs: number;
  /** Stable across a rename on the same volume: how a local rename is told from a delete and a new file. */
  ino: string | null;
  /** Of the whole file; null for folders, and for a file still being written. */
  sha256: string | null;
  /** Being written, or could not be read: left alone this pass. */
  unstable?: boolean;
}

export interface RemoteItem {
  rel: string;
  kind: Kind;
  id: number;
  version: number;
  size: number;
  sha256: string | null;
  /** The owner's own file: the sync protocol serves only those (SyncController::visible). */
  own: boolean;
  /** May be changed from here (a colleague's file this person may only view is not). */
  editable: boolean;
  /** May be moved to the recycle bin from here. */
  deletable: boolean;
  /** May be renamed and moved from here. */
  movable: boolean;
}

export interface BaseItem {
  rel: string;
  kind: Kind;
  remoteId: number;
  version: number;
  sha256: string | null;
  size: number;
  mtimeMs: number;
  ino: string | null;
}

/** One side's picture. `blind` holds keys (and everything under them) this pass cannot judge. */
export interface Picture<T> {
  items: Map<string, T>;
  blind: Set<string>;
}

export interface PlanOptions {
  mode: SyncMode;
  key: (rel: string) => string;
}

/**
 * `baseRel` is where the index has it (after any folder above it moved);
 * `from` is where it is now on the side being changed; `to` is where it goes.
 * Once done, the index entry at `baseRel`, and everything under it, moves to `to`.
 */
export type MoveAction =
  /** Drive moved or renamed it: do the same here. */
  | { op: 'move-local'; kind: Kind; baseRel: string; from: string; to: string }
  /** It was moved or renamed here: do the same in Drive. */
  | { op: 'move-remote'; kind: Kind; baseRel: string; from: string; to: string; remoteId: number }
  /** Both sides already moved it to the same place: only the index follows. */
  | { op: 'rebase'; kind: Kind; baseRel: string; from: string; to: string };

export type ContentAction =
  | { op: 'record'; rel: string; kind: Kind; remote: RemoteItem; local: LocalItem }
  | { op: 'forget'; rel: string }
  | { op: 'mkdir-local'; rel: string; remote: RemoteItem }
  | { op: 'mkdir-remote'; rel: string; local: LocalItem }
  | { op: 'download'; rel: string; remote: RemoteItem; local: LocalItem | null }
  /** `fileId` null: a new file in Drive. `baseVersion`: the version this edit started from (the server's conflict check). */
  | { op: 'upload'; rel: string; local: LocalItem; fileId: number | null; baseVersion: number | null }
  | { op: 'delete-local'; rel: string; kind: Kind; local: LocalItem }
  | { op: 'delete-remote'; rel: string; kind: Kind; remote: RemoteItem }
  /** Changed on both sides: this computer's copy is set aside under a conflicted-copy name, Drive's comes down. */
  | { op: 'conflict'; rel: string; local: LocalItem; remote: RemoteItem }
  | { op: 'skip'; rel: string; message: string };

function blinded(key: string, pictures: Array<Picture<unknown>>): boolean {
  for (const p of pictures) for (const b of p.blind) if (isUnder(key, b)) return true;
  return false;
}

/**
 * Phase one: moves and renames, so a renamed file keeps its id — its
 * versions, comments, shares and links — instead of becoming a new file.
 *
 * Drive's moves are found by id; this computer's by inode (a rename keeps it,
 * and keeps the modification time, which a file's check also asks for so a
 * reused inode is not taken for a move). When both sides moved the same item
 * to different places, Drive's place wins: the content is the same either
 * way, and only one of the two can be kept.
 *
 * Folders first, top down. A folder's move carries everything inside it, so
 * those are not moved again.
 */
export function planMoves(base: Map<string, BaseItem>, local: Picture<LocalItem>, remote: Picture<RemoteItem>, opts: PlanOptions): MoveAction[] {
  const { key } = opts;
  const remoteById = new Map<string, RemoteItem>();
  for (const r of remote.items.values()) remoteById.set(`${r.kind}:${r.id}`, r);
  const localByIno = new Map<string, LocalItem | null>();
  for (const l of local.items.values()) {
    if (!l.ino) continue;
    // Two paths with one inode are hard links: neither is a rename of the other.
    localByIno.set(l.ino, localByIno.has(l.ino) ? null : l);
  }

  const entries = [...base.values()].sort((a, b) => depthOf(a.rel) - depthOf(b.rel) || (a.rel < b.rel ? -1 : 1));
  const moved: Array<{ from: string; to: string }> = [];
  const takenLocal = new Set<string>();
  const takenRemote = new Set<string>();
  const out: MoveAction[] = [];

  for (const b of entries) {
    // Where it is now, if a folder above it has already been moved.
    const carried = moved.find((m) => isUnder(key(b.rel), key(m.from)));
    const rel = carried ? rebaseRel(b.rel, carried.from, carried.to) : b.rel;
    const k = key(rel);
    if (blinded(k, [local, remote])) continue;

    const r = remoteById.get(`${b.kind}:${b.remoteId}`);
    const l0 = b.ino ? localByIno.get(b.ino) : undefined;
    const l = l0 && l0.kind === b.kind && (b.kind === 'dir' || (l0.size === b.size && l0.mtimeMs === b.mtimeMs)) ? l0 : undefined;
    const here = local.items.get(k);

    const remoteMoved = !!r && key(r.rel) !== k;
    const localMoved = !!l && key(l.rel) !== k && !(here && here.ino === b.ino) && !base.has(key(l.rel));

    let action: MoveAction | null = null;
    if (remoteMoved && localMoved) {
      if (key(r.rel) === key(l.rel)) action = { op: 'rebase', kind: b.kind, baseRel: rel, from: rel, to: r.rel };
      else if (!local.items.has(key(r.rel)) && !takenLocal.has(key(r.rel))) action = { op: 'move-local', kind: b.kind, baseRel: rel, from: l.rel, to: r.rel };
    } else if (remoteMoved) {
      if (here && (!b.ino || !here.ino || here.ino === b.ino) && here.kind === b.kind && !local.items.has(key(r.rel)) && !takenLocal.has(key(r.rel))) {
        action = { op: 'move-local', kind: b.kind, baseRel: rel, from: rel, to: r.rel };
      }
    } else if (localMoved && r && opts.mode !== 'download_only' && r.movable) {
      if (!remote.items.has(key(l.rel)) && !takenRemote.has(key(l.rel))) action = { op: 'move-remote', kind: b.kind, baseRel: rel, from: rel, to: l.rel, remoteId: b.remoteId };
    }
    if (!action) continue;
    out.push(action);
    takenLocal.add(key(action.to));
    takenRemote.add(key(action.to));
    if (b.kind === 'dir') moved.push({ from: rel, to: action.to });
  }
  return out;
}

/**
 * Phase two: content, for every path any of the three pictures has.
 *
 * Modes: two-way carries both ways. Upload-only makes Drive follow this
 * computer (edits, new files and deletions go up; Drive's own changes are
 * not brought down). Download-only makes this computer follow Drive; an edit
 * made here is never uploaded, and never lost either — when Drive's version
 * would replace it, it is kept beside it as a conflicted copy.
 */
export function planContent(base: Map<string, BaseItem>, local: Picture<LocalItem>, remote: Picture<RemoteItem>, opts: PlanOptions): ContentAction[] {
  const { mode } = opts;
  const up = mode !== 'download_only';
  const down = mode !== 'upload_only';

  const keys = new Set<string>([...base.keys(), ...local.items.keys(), ...remote.items.keys()]);
  const files: ContentAction[] = [];
  const dirs: Array<{ k: string; b?: BaseItem; l?: LocalItem; r?: RemoteItem }> = [];
  const deletingRemote = new Set<string>();
  const deletingLocal = new Set<string>();

  for (const k of keys) {
    if (blinded(k, [local, remote])) continue;
    const b = base.get(k);
    const l = local.items.get(k);
    const r = remote.items.get(k);
    const rel = r?.rel ?? l?.rel ?? b!.rel;

    if (l && r && l.kind !== r.kind) {
      files.push({ op: 'skip', rel, message: 'A file and a folder here have the same name, so neither is synced. Rename one of them.' });
      continue;
    }
    const kind: Kind = (l ?? r ?? b)!.kind;
    if (kind === 'dir') {
      dirs.push({ k, b, l, r });
      continue;
    }
    if (l?.unstable) continue;

    const a = planFile(b, l, r, rel, up, down);
    if (!a) continue;
    if (a.op === 'delete-remote') deletingRemote.add(k);
    if (a.op === 'delete-local') deletingLocal.add(k);
    files.push(a);
  }

  // Folders, deepest first, so a folder knows what is about to leave it.
  dirs.sort((x, y) => depthOf(y.k) - depthOf(x.k));
  const dirActions: ContentAction[] = [];
  const everyUnder = (k: string, items: Map<string, unknown>, leaving: Set<string>) => {
    for (const other of items.keys()) if (other !== k && isUnder(other, k) && !leaving.has(other)) return false;
    return true;
  };
  for (const { k, b, l, r } of dirs) {
    const rel = r?.rel ?? l?.rel ?? b!.rel;
    let a: ContentAction | null = null;
    if (!b) {
      if (l && r) a = { op: 'record', rel, kind: 'dir', remote: r, local: l };
      else if (l && up) a = { op: 'mkdir-remote', rel, local: l };
      else if (r && down) a = { op: 'mkdir-local', rel, remote: r };
    } else if (l && r) {
      if (r.id !== b.remoteId || l.rel !== b.rel) a = { op: 'record', rel, kind: 'dir', remote: r, local: l };
    } else if (!l && r) {
      // Gone from this computer.
      if (mode === 'download_only') a = { op: 'mkdir-local', rel, remote: r };
      else if (r.deletable && everyUnder(k, remote.items, deletingRemote)) a = { op: 'delete-remote', rel, kind: 'dir', remote: r };
      else if (down) a = { op: 'mkdir-local', rel, remote: r };
      else a = { op: 'forget', rel };
      if (a.op === 'delete-remote') deletingRemote.add(k);
    } else if (l && !r) {
      // Gone from Drive.
      if (mode === 'upload_only') a = { op: 'mkdir-remote', rel, local: l };
      else if (everyUnder(k, local.items, deletingLocal)) a = { op: 'delete-local', rel, kind: 'dir', local: l };
      else if (up) a = { op: 'mkdir-remote', rel, local: l };
      else a = { op: 'forget', rel };
      if (a.op === 'delete-local') deletingLocal.add(k);
    } else {
      a = { op: 'forget', rel };
    }
    if (a) dirActions.push(a);
  }

  // Order: folders to create (top down), then files, then folders to delete (deepest first, as sorted).
  const creates = dirActions.filter((a) => a.op === 'mkdir-local' || a.op === 'mkdir-remote').sort((x, y) => depthOf(x.rel) - depthOf(y.rel));
  const rest = dirActions.filter((a) => a.op !== 'mkdir-local' && a.op !== 'mkdir-remote');
  return [...creates, ...files, ...rest];
}

function planFile(b: BaseItem | undefined, l: LocalItem | undefined, r: RemoteItem | undefined, rel: string, up: boolean, down: boolean): ContentAction | null {
  const same = !!l && !!r && !!l.sha256 && l.sha256 === r.sha256;
  const localChanged = !!l && (!b || l.sha256 !== b.sha256);
  const remoteChanged = !!r && (!b || r.version !== b.version || r.id !== b.remoteId || (r.sha256 !== null && b.sha256 !== null && r.sha256 !== b.sha256));
  const mayUpload = (x: RemoteItem | undefined) => !x || x.editable;
  const readOnly = (): ContentAction => ({ op: 'skip', rel, message: `You can view ${nameOf(rel)} in Drive but not change it, so the change made on this computer stays here.` });

  if (!b) {
    if (l && !r) return up ? { op: 'upload', rel, local: l, fileId: null, baseVersion: null } : null;
    if (!l && r) return down ? { op: 'download', rel, remote: r, local: null } : null;
    if (l && r) {
      if (same) return { op: 'record', rel, kind: 'file', remote: r, local: l };
      if (!down) return mayUpload(r) ? { op: 'upload', rel, local: l, fileId: r.id, baseVersion: r.version } : readOnly();
      return { op: 'conflict', rel, local: l, remote: r };
    }
    return null;
  }

  if (l && r) {
    if (!localChanged && !remoteChanged) {
      // Same content; a touched modification time or a new inode only refreshes the index.
      return l.mtimeMs !== b.mtimeMs || l.ino !== b.ino || l.size !== b.size ? { op: 'record', rel, kind: 'file', remote: r, local: l } : null;
    }
    if (same) return { op: 'record', rel, kind: 'file', remote: r, local: l };
    if (localChanged && !remoteChanged) {
      if (!up) return null;
      return mayUpload(r) ? { op: 'upload', rel, local: l, fileId: r.id, baseVersion: r.version } : readOnly();
    }
    if (!localChanged && remoteChanged) return down ? { op: 'download', rel, remote: r, local: l } : null;
    // Both changed.
    if (!down) return mayUpload(r) ? { op: 'upload', rel, local: l, fileId: r.id, baseVersion: r.version } : readOnly();
    return { op: 'conflict', rel, local: l, remote: r };
  }

  if (!l && r) {
    // Deleted on this computer.
    if (remoteChanged) return down ? { op: 'download', rel, remote: r, local: null } : { op: 'forget', rel };
    if (!up) return { op: 'download', rel, remote: r, local: null };
    return r.deletable ? { op: 'delete-remote', rel, kind: 'file', remote: r } : down ? { op: 'download', rel, remote: r, local: null } : { op: 'forget', rel };
  }

  if (l && !r) {
    // Gone from Drive.
    if (localChanged) return up ? { op: 'upload', rel, local: l, fileId: null, baseVersion: null } : { op: 'forget', rel };
    if (!down) return { op: 'upload', rel, local: l, fileId: null, baseVersion: null };
    return { op: 'delete-local', rel, kind: 'file', local: l };
  }

  return { op: 'forget', rel };
}
