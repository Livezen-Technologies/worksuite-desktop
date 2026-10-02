import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { LOCAL_BACKUP_VERSION, localBackup, localItemInput, localProfileInput, type LocalItem, type LocalItemInput, type LocalProfile, type LocalProfileInput, type LocalView } from '@shared/local-workspace';
import { DesktopError } from '../main/errors';
import { hashPin, pinMatches, pinProblem } from './lock-pin';
/**
 * Schema steps, applied in order and recorded in PRAGMA user_version, so an app update opens
 * an older file in place. Never edit a released step; add the next one.
 */
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS imported (account TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(account, fingerprint));`,
  // 2: the Local Profile (#141). One row; the PIN is a salted scrypt hash.
  `CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, picture TEXT, pin TEXT, created_at TEXT NOT NULL);`,
];
export const LOCAL_SCHEMA_VERSION = MIGRATIONS.length;
export function localFingerprint(item: LocalItemInput): string {
  return createHash('sha256').update(JSON.stringify([item.kind, item.title, item.body, item.completed, item.due, item.start, item.end, item.reminder])).digest('hex');
}
/** A separate device database, independent of account credentials, cache eviction and sign-out. */
export class LocalWorkspace {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > MIGRATIONS.length) throw new DesktopError('UNSUPPORTED', 'Local Profile data was saved by a newer WorkSuite. Update WorkSuite to open it.');
    for (let step = version; step < MIGRATIONS.length; step++) {
      this.db.exec('BEGIN');
      try { this.db.exec(MIGRATIONS[step]!); this.db.exec(`PRAGMA user_version = ${step + 1}`); this.db.exec('COMMIT'); }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }
  close(): void { this.db.close(); }
  schemaVersion(): number { return (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; }
  private profileRow() {
    return this.db.prepare('SELECT name, picture, pin, created_at FROM profile WHERE id = 1').get() as { name: string; picture: string | null; pin: string | null; created_at: string } | undefined;
  }
  profile(): LocalProfile | null {
    const row = this.profileRow();
    return row ? { name: row.name, picture: row.picture, hasPin: !!row.pin, createdAt: row.created_at } : null;
  }
  /** Creates the profile on first use, or edits it. No email, verification or server is involved. */
  saveProfile(input: LocalProfileInput): LocalProfile {
    const parsed = localProfileInput.parse(input);
    const problem = parsed.pin ? pinProblem(parsed.pin) : null;
    if (problem) throw new DesktopError('IPC_VALIDATION_FAILED', problem);
    const previous = this.profileRow();
    const pin = parsed.pin === undefined ? previous?.pin ?? null : parsed.pin === null ? null : JSON.stringify(hashPin(parsed.pin));
    this.db.prepare('INSERT OR REPLACE INTO profile (id, name, picture, pin, created_at) VALUES (1, ?, ?, ?, ?)').run(parsed.name, parsed.picture, pin, previous?.created_at ?? new Date().toISOString());
    return this.profile()!;
  }
  /** True when the PIN matches, or when no PIN is set. */
  checkPin(pin: string): boolean {
    const stored = this.profileRow()?.pin;
    if (!stored) return true;
    try { return pinMatches(pin, JSON.parse(stored) as { salt: string; hash: string }); } catch { return false; }
  }
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
  export(): string {
    const profile = this.profile();
    return JSON.stringify({ format: 'worksuite-local', version: LOCAL_BACKUP_VERSION, profile: profile ? { name: profile.name, picture: profile.picture } : null, ...this.read() }, null, 2);
  }
  /** Validates a whole backup and counts what a restore would add, writing nothing. */
  preview(text: string): { notes: number; tasks: number; events: number; duplicates: number; profileName: string | null } {
    const backup = localBackup.parse(JSON.parse(text));
    const fingerprints = new Set(this.read().items.map(localFingerprint));
    const fresh = backup.items.filter((item) => !fingerprints.has(localFingerprint(item)));
    return {
      notes: fresh.filter((item) => item.kind === 'note').length, tasks: fresh.filter((item) => item.kind === 'task').length, events: fresh.filter((item) => item.kind === 'event').length,
      duplicates: backup.items.length - fresh.length, profileName: backup.version === 2 ? backup.profile?.name ?? null : null,
    };
  }
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
      // A restored backup names a profile only where this device has none yet; the PIN is never in a backup.
      if (backup.version === 2 && backup.profile && !this.profileRow()) this.db.prepare('INSERT INTO profile (id, name, picture, pin, created_at) VALUES (1, ?, ?, NULL, ?)').run(backup.profile.name, backup.profile.picture, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { added, skipped };
  }
  deleteAll(): void { this.db.exec('BEGIN; DELETE FROM items; DELETE FROM preferences; DELETE FROM imported; DELETE FROM profile; COMMIT; VACUUM;'); }
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
/**
 * Which Local Profile windows are past the PIN (#141). A window must enter the PIN once; wrong PINs,
 * from any window or an account's import review, wait a minute after five.
 */
export class LocalAccess {
  private unlocked = new Set<number>();
  private failures = { count: 0, until: 0 };
  constructor(private readonly store: LocalWorkspace, private readonly now: () => number = Date.now) {}
  locked(window: number): boolean { return !!this.store.profile()?.hasPin && !this.unlocked.has(window); }
  /** Throws unless the profile exists and this window may read it. */
  require(window: number): void {
    if (!this.store.profile()) throw new DesktopError('PERMISSION_DENIED', 'Create your Local Profile first.');
    if (this.locked(window)) throw new DesktopError('PERMISSION_DENIED', 'Enter your Local Profile PIN first.');
  }
  tryPin(pin: string): { unlocked: boolean; retryAfter: number } {
    const now = this.now();
    if (this.failures.until > now) return { unlocked: false, retryAfter: Math.ceil((this.failures.until - now) / 1000) };
    if (!this.store.checkPin(pin)) {
      if (++this.failures.count >= 5) { this.failures = { count: 0, until: now + 60_000 }; return { unlocked: false, retryAfter: 60 }; }
      return { unlocked: false, retryAfter: 0 };
    }
    this.failures.count = 0;
    return { unlocked: true, retryAfter: 0 };
  }
  unlock(window: number, pin: string): { unlocked: boolean; retryAfter: number } {
    const result = this.tryPin(pin);
    if (result.unlocked) this.unlocked.add(window);
    return result;
  }
  /** After creating or editing the profile in this window. */
  grant(window: number): void { this.unlocked.add(window); }
  forget(window: number): void { this.unlocked.delete(window); }
  clear(): void { this.unlocked.clear(); }
}
