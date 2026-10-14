import type { UnsyncedItem, UnsyncedSummary } from '@shared/accounts';
import type { OfficeLocalCopy } from '@shared/office';
import type { Database } from '../db';
import type { Vault } from '../vault';
import { createZip, type ZipEntry } from '../zip';

/**
 * What an account has not sent yet (Connection & Startup §5, screen 14), read from its own database: the offline
 * queue, Office copies with edits not yet back in Drive, uploads waiting, the Projects outbox, and the desks'
 * outboxes (SalonMate, Events, POS, Restaurant). Sign-out lists these; a plain sign-out keeps them.
 */

const QUEUE_STATES = ['PENDING', 'SYNCING', 'FAILED', 'CONFLICT'];
const OFFICE_STATES = new Set(['changed', 'uploading', 'conflict', 'failed', 'quota']);
const UPLOAD_STATES = ['queued', 'running', 'paused', 'failed'];

function tableExists(db: Database, name: string): boolean {
  return !!db.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name);
}

function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ');
}

export interface UnsyncedDeps {
  db: Database;
  /** The account's vault, to read sealed labels; null when its key cannot be had (the counts still show). */
  vault: Vault | null;
  accountId: string;
  /** Whose: the account's user (rows of others on a shared computer are theirs, not this account's). */
  userId: string | null;
}

export function unsyncedSummary(d: UnsyncedDeps): UnsyncedSummary {
  const { db, vault, userId } = d;
  const items: UnsyncedItem[] = [];
  if (userId && !db.isClosed) {
    for (const r of db.all<{ id: string; module: string; label: string; created_at: string; state: string }>(
      `SELECT id, module, label, created_at, state FROM offline_mutations WHERE user_id = ? AND state IN (${placeholders(QUEUE_STATES.length)}) ORDER BY seq ASC`,
      userId,
      ...QUEUE_STATES,
    )) {
      items.push({ id: `queue:${r.id}`, source: 'queue', module: r.module, label: r.label, at: r.created_at });
    }

    const copies = (() => {
      const stored = db.getConfig<string>(`office_local_copies:${userId}`);
      return stored && vault ? (vault.decrypt<OfficeLocalCopy[]>(stored) ?? []) : [];
    })();
    for (const c of copies) {
      if (OFFICE_STATES.has(c.state as string)) items.push({ id: `office:${c.id}`, source: 'office', module: 'files', label: c.name, at: c.changedAt ?? c.updatedAt });
    }

    for (const r of db.all<{ id: string; name: string; created_at: string }>(
      `SELECT id, name, created_at FROM transfers WHERE user_id = ? AND direction = 'upload' AND state IN (${placeholders(UPLOAD_STATES.length)}) ORDER BY created_at ASC`,
      userId,
      ...UPLOAD_STATES,
    )) {
      items.push({ id: `upload:${r.id}`, source: 'upload', module: 'files', label: r.name, at: r.created_at });
    }

    if (tableExists(db, 'projects_outbox')) {
      for (const r of db.all<{ id: string; item: string; created_at: string }>('SELECT id, item, created_at FROM projects_outbox WHERE user_id = ? ORDER BY seq ASC', userId)) {
        const label = vault?.decrypt<{ label?: string }>(r.item)?.label ?? 'A change in Projects';
        items.push({ id: `projects:${r.id}`, source: 'projects', module: 'projects', label, at: r.created_at });
      }
    }

    const desks: Array<[string, string, string]> = [
      ['salon_outbox', 'salon', "state NOT IN ('sent', 'done')"],
      ['event_desk_queue', 'events', "state IN ('waiting', 'rejected')"],
      ['restaurant_outbox', 'restaurant', "state = 'waiting'"],
    ];
    for (const [table, module, where] of desks) {
      if (!tableExists(db, table)) continue;
      const row = db.get<{ n: number; at: string | null }>(`SELECT COUNT(*) AS n, MIN(created_at) AS at FROM ${table} WHERE user_id = ? AND ${where}`, userId);
      if (row && row.n > 0) items.push({ id: `desk:${module}`, source: 'desk', module, label: `${module} changes`, at: row.at ?? new Date(0).toISOString(), count: row.n });
    }
  }
  // POS sales are the till's, not a person's: listed whoever is signed in.
  if (!db.isClosed && tableExists(db, 'pos_sales')) {
    const row = db.get<{ n: number; at: string | null }>("SELECT COUNT(*) AS n, MIN(created_at) AS at FROM pos_sales WHERE state = 'waiting'");
    if (row && row.n > 0) items.push({ id: 'desk:pos', source: 'desk', module: 'pos', label: 'pos sales', at: row.at ?? new Date(0).toISOString(), count: row.n });
  }

  const offline = userId && !db.isClosed
    ? db.get<{ n: number; bytes: number | null }>(
        "SELECT COUNT(*) AS n, SUM(e.size) AS bytes FROM sync_entries e JOIN sync_folders f ON f.id = e.folder WHERE f.user_id = ? AND e.kind = 'file'",
        userId,
      )
    : null;
  const cached = userId && !db.isClosed ? db.get<{ bytes: number | null }>('SELECT SUM(bytes) AS bytes FROM cached_records WHERE user_id = ?', userId) : null;
  return {
    accountId: d.accountId,
    items,
    offlineFiles: { count: offline?.n ?? 0, bytes: offline?.bytes ?? 0 },
    cachedBytes: cached?.bytes ?? 0,
  };
}

/** How many changes are waiting, for "N pending changes kept". */
export function pendingCount(summary: UnsyncedSummary): number {
  return summary.items.reduce((n, i) => n + (i.count ?? 1), 0);
}

/**
 * The export behind "Export" on screen 14: a zip with the list, and each queued change's request as it would be
 * sent (decrypted: the person is saving their own work to a place they chose).
 */
export function exportUnsyncedZip(d: UnsyncedDeps, summary: UnsyncedSummary, now = new Date()): Buffer {
  const entries: ZipEntry[] = [{ name: 'unsynced.json', data: Buffer.from(JSON.stringify(summary, null, 2), 'utf8') }];
  if (d.userId && d.vault && !d.db.isClosed) {
    for (const r of d.db.all<{ id: string; module: string; label: string; method: string; path: string; payload: string; created_at: string }>(
      `SELECT id, module, label, method, path, payload, created_at FROM offline_mutations WHERE user_id = ? AND state IN (${placeholders(QUEUE_STATES.length)}) ORDER BY seq ASC`,
      d.userId,
      ...QUEUE_STATES,
    )) {
      const body = d.vault.decrypt(r.payload);
      entries.push({ name: `queue/${r.id}.json`, data: Buffer.from(JSON.stringify({ module: r.module, label: r.label, method: r.method, path: r.path, created_at: r.created_at, body }, null, 2), 'utf8') });
    }
  }
  return createZip(entries, now);
}
