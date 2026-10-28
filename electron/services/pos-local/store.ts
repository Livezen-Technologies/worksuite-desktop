import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Database } from '../db';
import { isLocked, lastOwnerProblem, lockUntil, LOCK_AFTER, passwordProblem, usernameProblem, type PosLocalUser, type PosRole, type PosSignInRefusal } from '@shared/pos-local';
import { DesktopError } from '../../main/errors';

/**
 * The offline till's own database and its people (ENH-POS-01 §1, phase 1).
 *
 * It is a SQLite file of its own, not the signed-in account's: an offline till has no account, and a computer that
 * later signs in to WorkSuite must not mix the two. Passwords are scrypt hashes with a per-password salt — never
 * the password, never something reversible — and the file itself is expected to sit on an encrypted disk, which
 * the till's setup checks and says.
 *
 * Everything here is synchronous, because node:sqlite is, and a till does one thing at a time.
 */

const MIGRATIONS: string[] = [
  // 1 — people, their sessions and what they did.
  `
  CREATE TABLE pos_local_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    suspended INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    last_sign_in_at TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE pos_local_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX pos_local_audit_at ON pos_local_audit(at);

  CREATE TABLE pos_local_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
];

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

/** `scrypt$N$r$p$salt$hash`, all base64url. The parameters travel with the hash, so they can be raised later. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Constant-time, and false for anything it cannot read rather than throwing on a hand-edited row. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  try {
    const expected = Buffer.from(hash!, 'base64url');
    const got = scryptSync(password, Buffer.from(salt!, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return expected.length === got.length && timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

interface Row {
  id: string;
  username: string;
  display_name: string;
  role: string;
  password_hash: string;
  suspended: number;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  must_change_password: number;
}

const view = (r: Row): PosLocalUser => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role as PosRole,
  suspended: !!r.suspended,
  createdAt: r.created_at,
  lastSignInAt: r.last_sign_in_at,
  lockedUntil: r.locked_until,
});

export interface SignedIn {
  user: PosLocalUser;
  mustChangePassword: boolean;
}

export class PosLocalStore {
  readonly db: Database;

  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, { migrations: MIGRATIONS });
  }

  close(): void {
    this.db.close();
  }

  /** Nobody has been made yet: the till shows its first-run screen. */
  get empty(): boolean {
    return this.count() === 0;
  }

  count(): number {
    return Number((this.db.raw.prepare('SELECT COUNT(*) AS n FROM pos_local_users').get() as unknown as { n: number }).n);
  }

  users(): PosLocalUser[] {
    return (this.db.raw.prepare('SELECT * FROM pos_local_users ORDER BY role = ? DESC, username').all('owner') as unknown as Row[]).map(view);
  }

  private row(username: string): Row | undefined {
    return this.db.raw.prepare('SELECT * FROM pos_local_users WHERE username = ?').get(username.trim().toLowerCase()) as unknown as Row | undefined;
  }

  private audit(action: string, user: { id?: string | null; username?: string | null } | null, detail = ''): void {
    this.db.raw.prepare('INSERT INTO pos_local_audit (at, user_id, username, action, detail) VALUES (?, ?, ?, ?, ?)').run(new Date(this.now()).toISOString(), user?.id ?? null, user?.username ?? null, action, detail);
  }

  /**
   * The first person on a till is always an owner — there is nobody to grant it — and after that only an owner
   * makes people. `by` is who is doing it; null is allowed only while the till is empty.
   */
  addUser(input: { username: string; displayName: string; password: string; role: PosRole }, by: PosLocalUser | null): PosLocalUser {
    const username = input.username.trim().toLowerCase();
    const first = this.empty;
    if (!first && by?.role !== 'owner') throw new DesktopError('PERMISSION_DENIED', 'Only an owner adds people to this till.');
    const nameWrong = usernameProblem(username);
    if (nameWrong) throw new DesktopError('CONFLICT', nameWrong);
    const pwWrong = passwordProblem(input.password, username);
    if (pwWrong) throw new DesktopError('INVALID_CREDENTIALS', pwWrong);
    if (this.row(username)) throw new DesktopError('CONFLICT', `Somebody on this till is already called ${username}.`);
    const role: PosRole = first ? 'owner' : input.role;
    const id = `posu_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    this.db.raw
      .prepare('INSERT INTO pos_local_users (id, username, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, username, input.displayName.trim().slice(0, 80) || username, role, hashPassword(input.password), new Date(this.now()).toISOString());
    this.audit(first ? 'till.opened' : 'user.added', by ?? { username }, first ? `${username} is this till's owner` : `${username} added as ${role}`);
    return view(this.db.raw.prepare('SELECT * FROM pos_local_users WHERE id = ?').get(id) as unknown as Row);
  }

  /**
   * Signing in. A wrong password counts towards the lock; a right one clears it. The refusal says which of the
   * four it was, because a shop needs to know whether to try again or find the owner — and the username itself is
   * never confirmed or denied to an unauthenticated caller beyond `unknown`.
   */
  signIn(username: string, password: string): SignedIn | { refused: PosSignInRefusal; lockedUntil?: string | null } {
    const now = this.now();
    const r = this.row(username);
    if (!r) {
      /* Spend the same time as a real check, so a missing username cannot be told apart by how fast it answers. */
      verifyPassword(password, hashPassword('decoy-password'));
      this.audit('signin.unknown', { username: username.trim().toLowerCase() });
      return { refused: 'unknown' };
    }
    if (isLocked(r.locked_until, now)) return { refused: 'locked', lockedUntil: r.locked_until };
    if (r.suspended) {
      this.audit('signin.suspended', r);
      return { refused: 'suspended' };
    }
    if (!verifyPassword(password, r.password_hash)) {
      const failed = Number(r.failed_attempts) + 1;
      const until = lockUntil(failed, now);
      this.db.raw.prepare('UPDATE pos_local_users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(failed, until, r.id);
      this.audit(until ? 'signin.locked' : 'signin.wrong', r, until ? `${failed} wrong passwords; held for five minutes` : `${failed} of ${LOCK_AFTER}`);
      return until ? { refused: 'locked', lockedUntil: until } : { refused: 'wrong' };
    }
    this.db.raw.prepare('UPDATE pos_local_users SET failed_attempts = 0, locked_until = NULL, last_sign_in_at = ? WHERE id = ?').run(new Date(now).toISOString(), r.id);
    this.audit('signin', r);
    return { user: view({ ...r, last_sign_in_at: new Date(now).toISOString(), failed_attempts: 0, locked_until: null }), mustChangePassword: !!r.must_change_password };
  }

  /** Changing your own password: the old one is required, whoever you are. */
  changePassword(userId: string, oldPassword: string, newPassword: string): void {
    const r = this.db.raw.prepare('SELECT * FROM pos_local_users WHERE id = ?').get(userId) as unknown as Row | undefined;
    if (!r) throw new DesktopError('NOT_FOUND', 'That person is not on this till.');
    if (!verifyPassword(oldPassword, r.password_hash)) throw new DesktopError('INVALID_CREDENTIALS', 'That is not your current password.');
    const wrong = passwordProblem(newPassword, r.username);
    if (wrong) throw new DesktopError('INVALID_CREDENTIALS', wrong);
    this.db.raw.prepare('UPDATE pos_local_users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(newPassword), userId);
    this.audit('password.changed', r);
  }

  /** An owner setting somebody else's password: they are asked to change it at their next sign-in. */
  resetPassword(userId: string, newPassword: string, by: PosLocalUser): void {
    if (by.role !== 'owner') throw new DesktopError('PERMISSION_DENIED', 'Only an owner sets somebody else’s password.');
    const r = this.db.raw.prepare('SELECT * FROM pos_local_users WHERE id = ?').get(userId) as unknown as Row | undefined;
    if (!r) throw new DesktopError('NOT_FOUND', 'That person is not on this till.');
    const wrong = passwordProblem(newPassword, r.username);
    if (wrong) throw new DesktopError('INVALID_CREDENTIALS', wrong);
    this.db.raw.prepare('UPDATE pos_local_users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hashPassword(newPassword), userId);
    this.audit('password.reset', by, `for ${r.username}`);
  }

  /** Role, suspension and removal, with the one rule that cannot be broken: a till keeps an owner who can run it. */
  update(userId: string, change: { role?: PosRole; suspended?: boolean }, by: PosLocalUser): PosLocalUser {
    if (by.role !== 'owner') throw new DesktopError('PERMISSION_DENIED', 'Only an owner changes who may do what.');
    const r = this.db.raw.prepare('SELECT * FROM pos_local_users WHERE id = ?').get(userId) as unknown as Row | undefined;
    if (!r) throw new DesktopError('NOT_FOUND', 'That person is not on this till.');
    const problem = lastOwnerProblem(this.users(), userId, change);
    if (problem) throw new DesktopError('CONFLICT', problem);
    this.db.raw.prepare('UPDATE pos_local_users SET role = ?, suspended = ? WHERE id = ?').run(change.role ?? r.role, change.suspended === undefined ? r.suspended : change.suspended ? 1 : 0, userId);
    this.audit('user.changed', by, `${r.username}: ${JSON.stringify(change)}`);
    return view(this.db.raw.prepare('SELECT * FROM pos_local_users WHERE id = ?').get(userId) as unknown as Row);
  }

  remove(userId: string, by: PosLocalUser): void {
    if (by.role !== 'owner') throw new DesktopError('PERMISSION_DENIED', 'Only an owner removes people from this till.');
    if (userId === by.id) throw new DesktopError('CONFLICT', 'You cannot remove yourself.');
    const r = this.db.raw.prepare('SELECT * FROM pos_local_users WHERE id = ?').get(userId) as unknown as Row | undefined;
    if (!r) throw new DesktopError('NOT_FOUND', 'That person is not on this till.');
    const problem = lastOwnerProblem(this.users(), userId, { removed: true });
    if (problem) throw new DesktopError('CONFLICT', problem);
    this.db.raw.prepare('DELETE FROM pos_local_users WHERE id = ?').run(userId);
    this.audit('user.removed', by, r.username);
  }

  /** The last hundred things that happened on this till, newest first. */
  audits(limit = 100): Array<{ at: string; username: string | null; action: string; detail: string }> {
    return this.db.raw.prepare('SELECT at, username, action, detail FROM pos_local_audit ORDER BY id DESC LIMIT ?').all(Math.min(limit, 500)) as unknown as Array<{ at: string; username: string | null; action: string; detail: string }>;
  }

  setting(key: string): string | null {
    const r = this.db.raw.prepare('SELECT value FROM pos_local_settings WHERE key = ?').get(key) as unknown as { value: string } | undefined;
    return r?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.raw.prepare('INSERT INTO pos_local_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, value, new Date(this.now()).toISOString());
  }
}
