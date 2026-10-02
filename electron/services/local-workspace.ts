import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { LOCAL_BACKUP_VERSION, localBackup, localContactInput, localItemInput, localProfileInput, type LocalContact, type LocalContactInput, type LocalItem, type LocalItemInput, type LocalProfile, type LocalProfileInput, type LocalView } from '@shared/local-workspace';
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
  // 3: guest mode in the main window (#149): personal contacts, the numbers the module screens address records by,
  // and which items were moved into which account (so a move resumes where it stopped and never uploads twice).
  `CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS numbers (n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE);
   CREATE TABLE IF NOT EXISTS moved (account TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, remote TEXT NOT NULL, PRIMARY KEY(account, id));`,
];
export const LOCAL_SCHEMA_VERSION = MIGRATIONS.length;
export function localFingerprint(item: LocalItemInput): string {
  return createHash('sha256').update(JSON.stringify([item.kind, item.title, item.body, item.completed, item.due, item.start, item.end, item.reminder])).digest('hex');
}
export function contactFingerprint(contact: LocalContactInput): string {
  return createHash('sha256').update(JSON.stringify(['contact', contact.display_name, contact.work_email ?? null, contact.personal_email ?? null, contact.mobile ?? null, contact.company ?? null])).digest('hex');
}
const LIMIT = 'Local guest storage reached its 20 MB backup limit. Export a backup and remove unused items before adding more.';
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
  private pref(key: string): string { return (this.db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? ''; }
  read(): LocalView {
    return { items: this.items(), contacts: this.contacts(), meetingInput: this.pref('meetingInput'), meetingServer: this.pref('meetingServer') };
  }
  items(): LocalItem[] {
    // Items saved before #149 have no meta: they read as plain-text records with defaults.
    return (this.db.prepare('SELECT payload FROM items').all() as Array<{ payload: string }>).map((row) => ({ meta: {}, ...JSON.parse(row.payload) }) as LocalItem);
  }
  get(id: string): LocalItem | undefined {
    const row = this.db.prepare('SELECT payload FROM items WHERE id = ?').get(id) as { payload: string } | undefined;
    return row ? { meta: {}, ...JSON.parse(row.payload) } as LocalItem : undefined;
  }
  /** Total size, so every dataset stays within its 20 MB backup format. */
  private fits(table: 'items' | 'contacts', id: string, payload: string): void {
    const totals = (other: 'items' | 'contacts', except: string) => this.db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(payload AS BLOB))), 0) AS bytes FROM ${other} WHERE id != ?`).get(except) as { count: number; bytes: number };
    const mine = totals(table, id);
    const theirs = totals(table === 'items' ? 'contacts' : 'items', '');
    // Reserve formatting/metadata space so every dataset fits its 20 MB backup format.
    if (mine.count >= 10_000 || mine.bytes + theirs.bytes + Buffer.byteLength(payload) + (mine.count + theirs.count + 1) * 512 > 19_700_000) throw new DesktopError('SERVER_ERROR', LIMIT);
  }
  save(input: LocalItemInput): LocalItem {
    const parsed = localItemInput.parse(input);
    const previous = parsed.id ? this.get(parsed.id) : undefined;
    if (parsed.id && (!previous || parsed.revision !== previous.revision)) throw new DesktopError('SERVER_ERROR', 'This item changed in another window. Reload it before saving.');
    const item: LocalItem = { ...parsed, id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), firedAt: previous?.reminder === parsed.reminder ? previous.firedAt : null };
    const payload = JSON.stringify(item);
    this.fits('items', item.id, payload);
    this.db.prepare('INSERT OR REPLACE INTO items (id, payload) VALUES (?, ?)').run(item.id, payload);
    return item;
  }
  remove(id: string): void { this.db.prepare('DELETE FROM items WHERE id = ?').run(id); }
  contacts(): LocalContact[] { return (this.db.prepare('SELECT payload FROM contacts').all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as LocalContact); }
  contact(id: string): LocalContact | undefined {
    const row = this.db.prepare('SELECT payload FROM contacts WHERE id = ?').get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as LocalContact : undefined;
  }
  saveContact(input: LocalContactInput): LocalContact {
    const parsed = localContactInput.parse(input);
    const previous = parsed.id ? this.contact(parsed.id) : undefined;
    if (parsed.id && (!previous || parsed.revision !== previous.revision)) throw new DesktopError('SERVER_ERROR', 'This contact changed in another window. Reload it before saving.');
    const now = new Date().toISOString();
    const contact: LocalContact = { ...parsed, id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now };
    const payload = JSON.stringify(contact);
    this.fits('contacts', contact.id, payload);
    this.db.prepare('INSERT OR REPLACE INTO contacts (id, payload) VALUES (?, ?)').run(contact.id, payload);
    return contact;
  }
  removeContact(id: string): void { this.db.prepare('DELETE FROM contacts WHERE id = ?').run(id); }
  /** The number a module screen addresses a record by: stable for the record's life on this device. */
  numberOf(id: string): number {
    this.db.prepare('INSERT OR IGNORE INTO numbers (id) VALUES (?)').run(id);
    return (this.db.prepare('SELECT n FROM numbers WHERE id = ?').get(id) as { n: number }).n;
  }
  idOf(n: number): string | null { return (this.db.prepare('SELECT id FROM numbers WHERE n = ?').get(n) as { id: string } | undefined)?.id ?? null; }
  /** A fresh number for something that lives inside a record (a contact's note). */
  nextNumber(): number { return this.numberOf(randomUUID()); }
  meeting(input: string, server: string): void {
    const set = this.db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)');
    this.db.exec('BEGIN');
    try { set.run('meetingInput', input); set.run('meetingServer', server); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  export(): string {
    const profile = this.profile();
    const strip = ({ createdAt: _c, updatedAt: _u, ...contact }: LocalContact) => contact;
    return JSON.stringify({ format: 'worksuite-local', version: LOCAL_BACKUP_VERSION, profile: profile ? { name: profile.name, picture: profile.picture } : null, ...this.read(), contacts: this.contacts().map(strip) }, null, 2);
  }
  /** Validates a whole backup and counts what a restore would add, writing nothing. */
  preview(text: string): { notes: number; tasks: number; events: number; contacts: number; duplicates: number; profileName: string | null } {
    const backup = localBackup.parse(JSON.parse(text));
    const fingerprints = new Set(this.items().map(localFingerprint));
    const people = new Set(this.contacts().map(contactFingerprint));
    const fresh = backup.items.filter((item) => !fingerprints.has(localFingerprint(item)));
    const contacts = backup.version === 3 ? backup.contacts : [];
    const freshContacts = contacts.filter((contact) => !people.has(contactFingerprint(contact)));
    return {
      notes: fresh.filter((item) => item.kind === 'note').length, tasks: fresh.filter((item) => item.kind === 'task').length, events: fresh.filter((item) => item.kind === 'event').length, contacts: freshContacts.length,
      duplicates: backup.items.length - fresh.length + contacts.length - freshContacts.length, profileName: backup.version === 1 ? null : backup.profile?.name ?? null,
    };
  }
  restore(text: string): { added: number; skipped: number } {
    const backup = localBackup.parse(JSON.parse(text));
    const fingerprints = new Set(this.items().map(localFingerprint));
    const people = new Set(this.contacts().map(contactFingerprint));
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
      for (const input of backup.version === 3 ? backup.contacts : []) {
        const fingerprint = contactFingerprint(input);
        if (people.has(fingerprint)) { skipped++; continue; }
        this.saveContact({ ...input, id: undefined, revision: undefined });
        people.add(fingerprint); added++;
      }
      const set = this.db.prepare('INSERT OR IGNORE INTO preferences (key, value) VALUES (?, ?)');
      set.run('meetingInput', backup.meetingInput); set.run('meetingServer', backup.meetingServer);
      // A restored backup names a profile only where this device has none yet; the PIN is never in a backup.
      if (backup.version !== 1 && backup.profile && !this.profileRow()) this.db.prepare('INSERT INTO profile (id, name, picture, pin, created_at) VALUES (1, ?, ?, NULL, ?)').run(backup.profile.name, backup.profile.picture, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { added, skipped };
  }
  deleteAll(): void { this.db.exec('BEGIN; DELETE FROM items; DELETE FROM contacts; DELETE FROM numbers; DELETE FROM moved; DELETE FROM preferences; DELETE FROM imported; DELETE FROM profile; COMMIT; VACUUM;'); }
  /** The revision of an item (or contact) already uploaded to this account, if it was. */
  movedRevision(account: string, id: string): number | null { return (this.db.prepare('SELECT revision FROM moved WHERE account = ? AND id = ?').get(account, id) as { revision: number } | undefined)?.revision ?? null; }
  movedRemote(account: string, id: string): string | null { return (this.db.prepare('SELECT remote FROM moved WHERE account = ? AND id = ?').get(account, id) as { remote: string } | undefined)?.remote ?? null; }
  markMoved(account: string, id: string, revision: number, remote: string): void { this.db.prepare('INSERT OR REPLACE INTO moved (account, id, revision, remote) VALUES (?, ?, ?, ?)').run(account, id, revision, remote); }
  /** Drops the local copies of what this account confirmed it holds; anything changed since its upload stays. */
  forgetMoved(account: string): number {
    let removed = 0;
    this.db.exec('BEGIN');
    try {
      for (const row of this.db.prepare('SELECT id, revision FROM moved WHERE account = ?').all(account) as Array<{ id: string; revision: number }>) {
        const current = this.get(row.id)?.revision ?? this.contact(row.id)?.revision;
        if (current === row.revision) { this.remove(row.id); this.removeContact(row.id); removed++; }
      }
      this.db.prepare('DELETE FROM moved WHERE account = ?').run(account);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return removed;
  }
  reminders(now: number, notify: (item: LocalItem) => boolean): number {
    let sent = 0;
    for (const item of this.items()) {
      if (item.kind === 'note' || item.completed || !item.reminder || item.firedAt || Date.parse(item.reminder) > now) continue;
      if (!notify(item)) continue;
      item.firedAt = new Date(now).toISOString();
      this.db.prepare('UPDATE items SET payload = ? WHERE id = ?').run(JSON.stringify(item), item.id); sent++;
    }
    return sent;
  }
}
/**
 * Which windows are past the Local Profile's PIN (#141). A window must enter the PIN once; wrong PINs
 * wait a minute after five.
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
/**
 * Guest mode in the main window (#149): which window is in guest mode, past the PIN, and — once that window signs
 * in — the one account it may move its local data into. Signing in or out ends guest mode, so an account (or the
 * next person at the sign-in screen) never reads the Local Profile without choosing guest mode and its PIN again.
 */
export class LocalSession {
  readonly access: LocalAccess;
  private windows = new Set<number>();
  private grant: { window: number; account: string | null } | null = null;
  constructor(private readonly store: LocalWorkspace, now?: () => number) { this.access = new LocalAccess(store, now); }
  enter(window: number): void { this.windows.add(window); }
  leave(window: number): void { this.windows.delete(window); this.access.forget(window); }
  isGuest(window: number): boolean { return this.windows.has(window); }
  /** Throws unless this window is in guest mode. */
  window(window: number): void { if (!this.windows.has(window)) throw new DesktopError('PERMISSION_DENIED', 'Choose Continue as Guest first.'); }
  /** Throws unless this window is in guest mode, has a profile and is past its PIN. */
  require(window: number): void { this.window(window); this.access.require(window); }
  /**
   * An account signed in: guest mode ends; the window that was in it (past its PIN) may offer to move its data there.
   * The account is known here when the session is already loaded, or else bound when that window first asks.
   */
  signedIn(account: string | null): void {
    const from = [...this.windows].find((window) => !this.access.locked(window) && !!this.store.profile());
    this.grant = from !== undefined ? { window: from, account } : null;
    this.windows.clear(); this.access.clear();
  }
  /** Signed out (or the session ended): nothing of the Local Profile stays open, and no move is offered to anyone. */
  signedOut(): void { this.grant = null; this.windows.clear(); this.access.clear(); }
  /** The account this window may move local data into, if it may. */
  moveAccount(window: number, account: string | null): string | null {
    if (!this.grant || this.grant.window !== window || !account) return null;
    this.grant.account ??= account;
    return this.grant.account === account ? account : null;
  }
  /** Keep on this device only, or a finished move. */
  endMove(): void { this.grant = null; }
}
