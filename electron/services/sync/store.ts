import { randomUUID } from 'node:crypto';
import type { SyncMode } from '@shared/types';
import type { Database } from '../db';
import type { BaseItem, Kind } from './plan';

/**
 * The sync index (SQLite, main process only): the folders kept in step, and
 * for each, what this computer and Drive last agreed on — the "base" every
 * pass compares both sides against.
 *
 * Written one entry at a time as each action completes, so a pass cut short
 * by a crash or a quit resumes from what was actually done.
 */

export interface SyncFolderRow {
  id: string;
  userId: string;
  folderId: number | null;
  folderName: string;
  localPath: string;
  mode: SyncMode;
  paused: boolean;
  lastSyncAt: string | null;
  error: string | null;
  createdAt: string;
}

interface FolderDbRow {
  id: string;
  user_id: string;
  folder_id: number | null;
  folder_name: string;
  local_path: string;
  mode: string;
  paused: number;
  last_sync_at: string | null;
  error: string | null;
  created_at: string;
}

interface EntryDbRow {
  key: string;
  rel: string;
  kind: string;
  remote_id: number;
  version: number;
  sha256: string | null;
  size: number;
  mtime_ms: number;
  ino: string | null;
}

const MODES: SyncMode[] = ['two_way', 'upload_only', 'download_only'];

function folderOf(r: FolderDbRow): SyncFolderRow {
  return {
    id: r.id,
    userId: r.user_id,
    folderId: r.folder_id === null ? null : Number(r.folder_id),
    folderName: r.folder_name,
    localPath: r.local_path,
    mode: MODES.includes(r.mode as SyncMode) ? (r.mode as SyncMode) : 'two_way',
    paused: Number(r.paused) === 1,
    lastSyncAt: r.last_sync_at,
    error: r.error,
    createdAt: r.created_at,
  };
}

export class SyncStore {
  constructor(
    private readonly db: Database,
    private readonly key: (rel: string) => string,
  ) {}

  // ── folders ────────────────────────────────────────────────────────────

  folders(userId: string): SyncFolderRow[] {
    return this.db.all<FolderDbRow>('SELECT * FROM sync_folders WHERE user_id = ? ORDER BY created_at', userId).map(folderOf);
  }

  folder(id: string): SyncFolderRow | null {
    const r = this.db.get<FolderDbRow>('SELECT * FROM sync_folders WHERE id = ?', id);
    return r ? folderOf(r) : null;
  }

  addFolder(userId: string, f: { folderId: number | null; folderName: string; localPath: string; mode: SyncMode }): SyncFolderRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      'INSERT INTO sync_folders (id, user_id, folder_id, folder_name, local_path, mode, paused, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
      id,
      userId,
      f.folderId,
      f.folderName,
      f.localPath,
      f.mode,
      now,
      now,
    );
    return this.folder(id)!;
  }

  updateFolder(id: string, patch: Partial<Pick<SyncFolderRow, 'folderName' | 'mode' | 'paused' | 'lastSyncAt' | 'error'>>): void {
    const sets: string[] = [];
    const vals: Array<string | number | null> = [];
    const set = (column: string, value: string | number | null) => {
      sets.push(`${column} = ?`);
      vals.push(value);
    };
    if (patch.folderName !== undefined) set('folder_name', patch.folderName);
    if (patch.mode !== undefined) set('mode', patch.mode);
    if (patch.paused !== undefined) set('paused', patch.paused ? 1 : 0);
    if (patch.lastSyncAt !== undefined) set('last_sync_at', patch.lastSyncAt);
    if (patch.error !== undefined) set('error', patch.error);
    if (!sets.length) return;
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());
    this.db.run(`UPDATE sync_folders SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
  }

  removeFolder(id: string): void {
    this.db.tx(() => {
      this.db.run('DELETE FROM sync_entries WHERE folder = ?', id);
      this.db.run('DELETE FROM sync_folders WHERE id = ?', id);
    });
  }

  clearUser(userId: string): void {
    for (const f of this.folders(userId)) this.removeFolder(f.id);
  }

  // ── entries ────────────────────────────────────────────────────────────

  entries(folder: string): Map<string, BaseItem> {
    const out = new Map<string, BaseItem>();
    for (const r of this.db.all<EntryDbRow>('SELECT * FROM sync_entries WHERE folder = ?', folder)) {
      out.set(r.key, {
        rel: r.rel,
        kind: r.kind === 'dir' ? 'dir' : 'file',
        remoteId: Number(r.remote_id),
        version: Number(r.version),
        sha256: r.sha256,
        size: Number(r.size),
        mtimeMs: Number(r.mtime_ms),
        ino: r.ino,
      });
    }
    return out;
  }

  put(folder: string, e: BaseItem): void {
    const k = this.key(e.rel);
    this.db.run(
      `INSERT INTO sync_entries (folder, key, rel, kind, remote_id, version, sha256, size, mtime_ms, ino) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(folder, key) DO UPDATE SET rel = excluded.rel, kind = excluded.kind, remote_id = excluded.remote_id, version = excluded.version,
         sha256 = excluded.sha256, size = excluded.size, mtime_ms = excluded.mtime_ms, ino = excluded.ino`,
      folder,
      k,
      e.rel,
      e.kind,
      e.remoteId,
      e.version,
      e.sha256,
      e.size,
      e.mtimeMs,
      e.ino,
    );
  }

  /** Forgets one path — and, for a folder, everything the index holds under it. */
  remove(folder: string, rel: string): void {
    const k = this.key(rel);
    this.db.run('DELETE FROM sync_entries WHERE folder = ? AND (key = ? OR substr(key, 1, ?) = ?)', folder, k, k.length + 1, `${k}/`);
  }

  /** A folder or file moved: its entry and everything under it take the new path. */
  rebase(folder: string, from: string, to: string): void {
    const fk = this.key(from);
    const rows = this.db.all<EntryDbRow>('SELECT * FROM sync_entries WHERE folder = ? AND (key = ? OR substr(key, 1, ?) = ?)', folder, fk, fk.length + 1, `${fk}/`);
    this.db.tx(() => {
      for (const r of rows) {
        const rel = r.rel.length === from.length ? to : `${to}${r.rel.slice(from.length)}`;
        this.db.run('DELETE FROM sync_entries WHERE folder = ? AND key = ?', folder, r.key);
        this.db.run(
          'INSERT OR REPLACE INTO sync_entries (folder, key, rel, kind, remote_id, version, sha256, size, mtime_ms, ino) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          folder,
          this.key(rel),
          rel,
          r.kind,
          r.remote_id,
          r.version,
          r.sha256,
          r.size,
          r.mtime_ms,
          r.ino,
        );
      }
    });
  }

  totals(folder: string): { files: number; bytes: number } {
    const r = this.db.get<{ n: number; b: number | null }>("SELECT COUNT(*) AS n, SUM(size) AS b FROM sync_entries WHERE folder = ? AND kind = 'file'", folder);
    return { files: Number(r?.n ?? 0), bytes: Number(r?.b ?? 0) };
  }

  /** Where these Drive items are on this computer, if anywhere. */
  located(userId: string, kind: Kind, ids: number[]): Map<number, { folder: string; rel: string }> {
    const out = new Map<number, { folder: string; rel: string }>();
    if (!ids.length) return out;
    const marks = ids.map(() => '?').join(',');
    const rows = this.db.all<{ folder: string; rel: string; remote_id: number }>(
      `SELECT e.folder, e.rel, e.remote_id FROM sync_entries e JOIN sync_folders f ON f.id = e.folder
       WHERE f.user_id = ? AND e.kind = ? AND e.remote_id IN (${marks})`,
      userId,
      kind,
      ...ids,
    );
    for (const r of rows) out.set(Number(r.remote_id), { folder: r.folder, rel: r.rel });
    return out;
  }
}
