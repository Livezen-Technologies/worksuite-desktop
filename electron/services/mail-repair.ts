import { DatabaseSync } from 'node:sqlite';
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { MailRepairResult } from '@shared/types';
import { Database, type Row } from './db';

/**
 * Repair local mail data (worksuite-desktop#338).
 *
 * Mail's copy on this computer is the saved answers in `cached_records`, inside the profile's one SQLite database
 * (offline-cache.ts) — the same file that keeps the outbox of unsent mail (`offline_mutations`), drafts and the
 * settings (`config`). So a repair never throws the file away whole:
 *
 * - The database checks out (`PRAGMA quick_check`) and the person confirmed: a copy of it is kept as
 *   `worksuite.db.bak`, Mail's saved answers for the person are deleted and the page asks the server for everything
 *   again — a fresh full copy. Nothing else in the file is touched.
 * - The check fails: the database is rebuilt on the next start, before anything opens it. What can still be read of
 *   every table except the saved answers — the outbox, drafts, settings and the rest — is read out, the old file is
 *   renamed to `worksuite.db.bak`, and a fresh database is made with those rows put back. The saved answers come
 *   again from the server.
 */

/** Tables that only hold a copy of the server's answers: a rebuild leaves them behind, and syncing fills them again. */
export const REBUILT_TABLES: ReadonlySet<string> = new Set(['cached_records']);

/** Beside the database: a rebuild is waiting for the next start. */
export const repairMarker = (dbPath: string): string => `${dbPath}.repair`;

/** Where the old database is kept. */
export const backupPath = (dbPath: string): string => `${dbPath}.bak`;

export interface MailRepairDeps {
  db: Pick<Database, 'integrityCheck' | 'run' | 'get'>;
  dbPath: string;
  userId: string;
  /** Mail's bodies are fetched ahead again (mail-bodies.ts). */
  afterClear?: () => void;
}

/** The person's unsent mail and drafts, counted before and after: a repair must leave both as they were. */
export function keptCounts(db: Pick<Database, 'get'>, userId: string): { outbox: number; drafts: number } {
  const n = (sql: string): number => {
    try {
      return Number(db.get<{ n: number }>(sql, userId)?.n ?? 0);
    } catch {
      return 0;
    }
  };
  return {
    outbox: n("SELECT COUNT(*) AS n FROM offline_mutations WHERE user_id = ? AND module = 'mail' AND state != 'DONE'"),
    drafts: n("SELECT COUNT(*) AS n FROM drafts WHERE user_id = ? AND module = 'mail'"),
  };
}

function check(db: Pick<Database, 'integrityCheck'>): string {
  try {
    return db.integrityCheck();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Run the check, then clear Mail's copy (healthy) or ask for a rebuild on the next start (damaged). */
export function repairMail(deps: MailRepairDeps): MailRepairResult {
  const result = check(deps.db);
  const healthy = result === 'ok';
  const kept = keptCounts(deps.db, deps.userId);
  if (!healthy) {
    writeFileSync(repairMarker(deps.dbPath), JSON.stringify({ at: new Date().toISOString(), check: result }), { mode: 0o600 });
    return { check: result, healthy, action: 'restart', removed: 0, kept, backup: backupPath(deps.dbPath) };
  }
  let backup: string | null = backupPath(deps.dbPath);
  try {
    rmSync(backup, { force: true });
    deps.db.run('VACUUM INTO ?', backup);
  } catch {
    // No room for the copy, or an in-memory database: the repair goes on without it.
    backup = null;
  }
  const removed = deps.db.run("DELETE FROM cached_records WHERE user_id = ? AND module = 'mail'", deps.userId).changes;
  deps.afterClear?.();
  return { check: result, healthy, action: 'cleared', removed, kept: keptCounts(deps.db, deps.userId), backup };
}

function quoted(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A table's rows: all at once, or — where a damaged page stops that — one by one, skipping those that cannot be read. */
function readTable(db: DatabaseSync, table: string): Row[] | null {
  try {
    return db.prepare(`SELECT * FROM ${quoted(table)}`).all() as Row[];
  } catch {
    // Read on below, a row at a time.
  }
  let max = 0;
  try {
    max = Number((db.prepare(`SELECT MAX(rowid) AS n FROM ${quoted(table)}`).get() as { n: number | null } | undefined)?.n ?? 0);
  } catch {
    return null;
  }
  const one = db.prepare(`SELECT * FROM ${quoted(table)} WHERE rowid = ?`);
  const rows: Row[] = [];
  for (let id = 1; id <= Math.min(max, 1_000_000); id++) {
    try {
      const r = one.get(id) as Row | undefined;
      if (r) rows.push(r);
    } catch {
      // This row is lost; the rest are kept.
    }
  }
  return rows;
}

export interface RebuildReport {
  backup: string;
  /** Rows put back, by table. */
  kept: Record<string, number>;
  /** Tables nothing could be read from. */
  lost: string[];
}

/** Read what can be read, rename the old file to .bak, and make a fresh database with those rows. */
export function rebuildDatabase(dbPath: string): RebuildReport {
  const saved = new Map<string, Row[]>();
  const lost: string[] = [];
  try {
    const old = new DatabaseSync(dbPath);
    try {
      let tables: string[] = [];
      try {
        tables = (old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);
      } catch {
        lost.push('*');
      }
      for (const t of tables) {
        if (REBUILT_TABLES.has(t)) continue;
        const rows = readTable(old, t);
        if (rows) saved.set(t, rows);
        else lost.push(t);
      }
    } finally {
      old.close();
    }
  } catch {
    lost.push('*');
  }

  const backup = backupPath(dbPath);
  for (const ext of ['', '-wal', '-shm']) {
    rmSync(`${backup}${ext}`, { force: true });
    if (existsSync(`${dbPath}${ext}`)) renameSync(`${dbPath}${ext}`, `${backup}${ext}`);
  }

  const fresh = new Database(dbPath);
  const kept: Record<string, number> = {};
  try {
    for (const [table, rows] of saved) {
      const columns = new Set((fresh.raw.prepare(`PRAGMA table_info(${quoted(table)})`).all() as Array<{ name: string }>).map((c) => c.name));
      if (!columns.size) {
        lost.push(table);
        continue;
      }
      let n = 0;
      fresh.tx(() => {
        for (const row of rows) {
          const cols = Object.keys(row).filter((c) => columns.has(c));
          if (!cols.length) continue;
          try {
            n += fresh.run(`INSERT OR IGNORE INTO ${quoted(table)} (${cols.map(quoted).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => row[c] as string | number | null)).changes;
          } catch {
            // A row the fresh schema refuses is left in the backup.
          }
        }
      });
      kept[table] = n;
    }
  } finally {
    fresh.close();
  }
  return { backup, kept, lost };
}

/** At start, before the database opens: the rebuild a repair asked for, once. Never stops the app from starting. */
export function rebuildIfAsked(dbPath: string, log?: (msg: string, data?: Record<string, unknown>) => void): RebuildReport | null {
  const marker = repairMarker(dbPath);
  if (!existsSync(marker)) return null;
  rmSync(marker, { force: true });
  try {
    const r = rebuildDatabase(dbPath);
    log?.('local database rebuilt by Repair local mail data', { kept: r.kept, lost: r.lost });
    return r;
  } catch (e) {
    log?.('local database rebuild failed', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
