import { existsSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountRecord } from '@shared/accounts';
import { DesktopError } from '../../main/errors';
import type { AppDb } from './app-db';
import { DEFAULT_PROFILE_ACCOUNT_FILES, DEFAULT_PROFILE_DIR, allPartitions, partitionDir, profilePaths } from './profile';
import type { AccountRegistry } from './registry';

/**
 * "Remove from this device" (Connection & Startup §5, screen 14 footer): the account's refresh token revoked, its
 * profile folder deleted — for account #1 (`profiles/default`) only the files that are the account's, never the
 * guest workspace or Local AI's models — its partitions' storage cleared, and their folders queued in
 * `pending_removals`: Chromium holds them while the app runs, so they go at the next start, before any window.
 *
 * The other accounts and the guest workspace are never touched. The account on the server is not deleted (that is
 * "Delete account", a Cloud web page).
 */

export interface RemovalDeps {
  userData: string;
  appDb: AppDb;
  registry: AccountRegistry;
  /** Best effort: the refresh token revoked at its server. Never throws. */
  revoke: (account: AccountRecord) => Promise<void>;
  /** Cookies, caches and storage of a partition cleared now (`session.clearStorageData`). */
  clearStorage: (partition: string) => Promise<void>;
  /** The account's database closed if this process has it open (it is the bound one). */
  release: (account: AccountRecord) => void | Promise<void>;
  /** Drive sync's folders on this computer, to the system's trash (only when the person did not keep them). */
  trash: (path: string) => Promise<void>;
  rm?: (path: string) => void;
  now?: () => Date;
}

function syncRoots(dbPath: string): string[] {
  if (!existsSync(dbPath)) return [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return (db.prepare('SELECT local_path FROM sync_folders').all() as Array<{ local_path: string }>).map((r) => r.local_path).filter((p) => typeof p === 'string' && p.length > 0);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

function defaultRm(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 2 });
}

/** Paths that must never be removed, whatever a row in app.db says: userData itself and anything above it. */
function safeToRemove(userData: string, path: string): boolean {
  const root = resolve(userData);
  const p = resolve(path);
  return p !== root && p.startsWith(root + sep);
}

export function queueRemoval(appDb: AppDb, path: string, partition: string | null, now = new Date()): void {
  appDb.run('INSERT OR REPLACE INTO pending_removals (path, partition, queued_at) VALUES (?, ?, ?)', path, partition, now.toISOString());
}

export async function removeAccount(d: RemovalDeps, id: string, opts: { keepOfflineFiles: boolean }): Promise<void> {
  const account = d.registry.get(id);
  if (!account) throw new DesktopError('NOT_FOUND', 'That account is no longer on this computer.');
  if (account.managed) throw new DesktopError('POLICY_DENIED', 'Removal set by IT policy.');
  const rm = d.rm ?? defaultRm;
  const now = d.now ?? (() => new Date());
  const paths = profilePaths(d.userData, account.profileDir);
  const roots = opts.keepOfflineFiles ? [] : syncRoots(paths.database);

  await d.revoke(account).catch(() => undefined);
  await d.release(account);

  for (const partition of allPartitions(account)) {
    await d.clearStorage(partition).catch(() => undefined);
    const dir = partitionDir(d.userData, partition);
    if (dir) queueRemoval(d.appDb, dir, partition, now());
  }

  const targets = account.profileDir === DEFAULT_PROFILE_DIR ? DEFAULT_PROFILE_ACCOUNT_FILES.map((f) => join(paths.dir, f)) : [paths.dir];
  for (const target of targets) {
    if (!safeToRemove(d.userData, target)) continue;
    try {
      rm(target);
    } catch {
      // Held (Windows keeps a file another handle has open): the next start removes it.
      queueRemoval(d.appDb, target, null, now());
    }
  }
  for (const root of roots) await d.trash(root).catch(() => undefined);
  d.registry.remove(id);
}

/** At start, before any window or partition is opened: what a removal left for later. */
export function processPendingRemovals(appDb: AppDb, userData: string, rm: (path: string) => void = defaultRm): { removed: number; left: number } {
  let removed = 0;
  let left = 0;
  for (const row of appDb.all<{ path: string }>('SELECT path FROM pending_removals')) {
    if (!safeToRemove(userData, row.path)) {
      appDb.run('DELETE FROM pending_removals WHERE path = ?', row.path);
      continue;
    }
    try {
      rm(row.path);
      appDb.run('DELETE FROM pending_removals WHERE path = ?', row.path);
      removed++;
    } catch {
      left++;
    }
  }
  return { removed, left };
}
