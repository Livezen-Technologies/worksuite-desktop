import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { localBackup, localItemInput, type LocalItem, type LocalItemInput, type LocalView } from '@shared/local-workspace';
import { DesktopError } from '../main/errors';
export function localFingerprint(item: LocalItemInput): string {
  return createHash('sha256').update(JSON.stringify([item.kind, item.title, item.body, item.completed, item.due, item.start, item.end, item.reminder])).digest('hex');
}
/** A separate device database, independent of account credentials, cache eviction and sign-out. */
export class LocalWorkspace {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS imported (account TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(account, fingerprint));`);
  }
  close(): void { this.db.close(); }
  read(): LocalView {
    const pref = (key: string) => (this.db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? '';
    return { items: (this.db.prepare('SELECT payload FROM items').all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as LocalItem), meetingInput: pref('meetingInput'), meetingServer: pref('meetingServer') };
  }
  get(id: string): LocalItem | undefined {
    const row = this.db.prepare('SELECT payload FROM items WHERE id = ?').get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as LocalItem : undefined;
  }
  save(input: LocalItemInput): LocalItem {
    const parsed = localItemInput.parse(input);
    const previous = parsed.id ? this.get(parsed.id) : undefined;
    if (parsed.id && (!previous || parsed.revision !== previous.revision)) throw new DesktopError('SERVER_ERROR', 'This item changed in another window. Reload it before saving.');
    const item: LocalItem = { ...parsed, id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), firedAt: previous?.reminder === parsed.reminder ? previous.firedAt : null };
    const totals = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(payload AS BLOB))), 0) AS bytes FROM items WHERE id != ?').get(item.id) as { count: number; bytes: number };
    // Reserve formatting/metadata space so every dataset fits its 20 MB backup format.
    if (totals.count >= 10_000 || totals.bytes + Buffer.byteLength(JSON.stringify(item)) + (totals.count + 1) * 512 > 19_700_000) {
      throw new DesktopError('SERVER_ERROR', 'Local guest storage reached its 20 MB backup limit. Export a backup and remove unused items before adding more.');
    }
    this.db.prepare('INSERT OR REPLACE INTO items (id, payload) VALUES (?, ?)').run(item.id, JSON.stringify(item));
    return item;
  }
  remove(id: string): void { this.db.prepare('DELETE FROM items WHERE id = ?').run(id); }
  meeting(input: string, server: string): void {
    const set = this.db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)');
    this.db.exec('BEGIN');
    try { set.run('meetingInput', input); set.run('meetingServer', server); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  export(): string { return JSON.stringify({ format: 'worksuite-local', version: 1, ...this.read() }, null, 2); }
  restore(text: string): { added: number; skipped: number } {
    const backup = localBackup.parse(JSON.parse(text));
    const fingerprints = new Set(this.read().items.map(localFingerprint));
    let added = 0, skipped = 0;
    this.db.exec('BEGIN');
    try {
      for (const input of backup.items) {
        const fingerprint = localFingerprint(input);
        if (fingerprints.has(fingerprint)) { skipped++; continue; }
        const restored = this.save({ ...input, id: undefined, revision: undefined });
        restored.firedAt = input.firedAt;
        this.db.prepare('UPDATE items SET payload = ? WHERE id = ?').run(JSON.stringify(restored), restored.id);
        fingerprints.add(fingerprint); added++;
      }
      const set = this.db.prepare('INSERT OR IGNORE INTO preferences (key, value) VALUES (?, ?)');
      set.run('meetingInput', backup.meetingInput); set.run('meetingServer', backup.meetingServer);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { added, skipped };
  }
  deleteAll(): void { this.db.exec('BEGIN; DELETE FROM items; DELETE FROM preferences; DELETE FROM imported; COMMIT; VACUUM;'); }
  wasImported(account: string, item: LocalItem): boolean { return !!this.db.prepare('SELECT 1 FROM imported WHERE account = ? AND fingerprint = ?').get(account, localFingerprint(item)); }
  markImported(account: string, item: LocalItem): void { this.db.prepare('INSERT OR IGNORE INTO imported VALUES (?, ?)').run(account, localFingerprint(item)); }
  reminders(now: number, notify: (item: LocalItem) => boolean): number {
    let sent = 0;
    for (const item of this.read().items) {
      if (item.kind === 'note' || item.completed || !item.reminder || item.firedAt || Date.parse(item.reminder) > now) continue;
      if (!notify(item)) continue;
      item.firedAt = new Date(now).toISOString();
      this.db.prepare('UPDATE items SET payload = ? WHERE id = ?').run(JSON.stringify(item), item.id); sent++;
    }
    return sent;
  }
}
