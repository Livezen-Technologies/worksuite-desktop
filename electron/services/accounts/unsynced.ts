import type { UnsyncedItem, UnsyncedSummary } from '@shared/accounts';
import { copyHasUnsentEdits, type OfficeLocalCopy } from '@shared/office';
import type { Database } from '../db';
import type { Vault } from '../vault';
import { createZip, type ZipEntry } from '../zip';

/**
 * What an account has not sent yet (Connection & Startup §5, screen 14), read from its own database: the offline
 * queue, Office copies with edits not yet back in Drive, uploads waiting, the Projects outbox, and the desks'
 * outboxes (SalonMate, Events, POS, Restaurant). Sign-out lists these; a plain sign-out keeps them.
 */

const QUEUE_STATES = ['PENDING', 'SYNCING', 'FAILED', 'CONFLICT'];
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
  /** The open account's copies, from memory (OfficeExternal.list()); otherwise they are read from its database. */
  officeCopies?: () => OfficeLocalCopy[];
  /** The list only (the status bar's count): the offline-files and cache sizes are not summed. */
  itemsOnly?: boolean;
}

/**
 * One row per Drive file: two copies of the same file (an older one left behind when it was opened again) are one
 * change, the latest. Copies without edits waiting are not listed at all.
 */
export function pendingCopies(copies: OfficeLocalCopy[]): OfficeLocalCopy[] {
  const byFile = new Map<number, OfficeLocalCopy>();
  for (const c of copies) {
    if (!copyHasUnsentEdits(c)) continue;
    const had = byFile.get(c.fileId);
    if (!had || (c.updatedAt ?? '') > (had.updatedAt ?? '')) byFile.set(c.fileId, c);
  }
  return [...byFile.values()];
}

export function unsyncedSummary(d: UnsyncedDeps): UnsyncedSummary {
  const { db, vault, userId } = d;
  const items: UnsyncedItem[] = [];
  if (userId && !db.isClosed) {
    for (const r of db.all<{ id: string; module: string; label: string; created_at: string; state: string; error: string | null }>(
      `SELECT id, module, label, created_at, state, error FROM offline_mutations WHERE user_id = ? AND state IN (${placeholders(QUEUE_STATES.length)}) ORDER BY seq ASC`,
      userId,
      ...QUEUE_STATES,
    )) {
      items.push({ id: `queue:${r.id}`, source: 'queue', module: r.module, label: r.label, at: r.created_at, error: r.error ?? null, discardable: true });
    }

    const copies = d.officeCopies ? d.officeCopies() : (() => {
      const stored = db.getConfig<string>(`office_local_copies:${userId}`);
      return stored && vault ? (vault.decrypt<OfficeLocalCopy[]>(stored) ?? []) : [];
    })();
    for (const c of pendingCopies(copies)) {
      items.push({ id: `office:${c.id}`, source: 'office', module: 'files', label: c.name, at: c.changedAt ?? c.updatedAt, error: c.state === 'conflict' ? (c.conflict?.message ?? 'The cloud file changed while you were editing.') : (c.error ?? null), discardable: true });
    }

    for (const r of db.all<{ id: string; name: string; created_at: string; error: string | null }>(
      `SELECT id, name, created_at, error FROM transfers WHERE user_id = ? AND direction = 'upload' AND state IN (${placeholders(UPLOAD_STATES.length)}) ORDER BY created_at ASC`,
      userId,
      ...UPLOAD_STATES,
    )) {
      items.push({ id: `upload:${r.id}`, source: 'upload', module: 'files', label: r.name, at: r.created_at, error: r.error ?? null, discardable: true });
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

  if (d.itemsOnly) return { accountId: d.accountId, items, offlineFiles: { count: 0, bytes: 0 }, cachedBytes: 0 };
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

/** How many changes are waiting: "N pending changes kept", the status bar's "N pending changes", and the sign-out list. */
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
