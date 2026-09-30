import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Database } from './db';
import type { Vault } from './vault';

/** 4 to 8 digits. */
export const PIN_PATTERN = /^\d{4,8}$/;

interface StoredPin {
  v: 1;
  salt: string;
  hash: string;
  /** How many digits: the lock screen unlocks on the last one. Absent on a PIN set before it was kept; learnt at its next use. */
  length?: number;
}

// scrypt's cost: ~50 ms a try on a laptop, so guessing is slow even with the database and its key.
const N = 1 << 15;
const KEYLEN = 32;
const hashOf = (pin: string, salt: Buffer): Buffer => scryptSync(pin, salt, KEYLEN, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

/**
 * A PIN for the app lock, per person on this computer (FR-SEC-05): it unlocks WorkSuite without the server, so
 * it also works offline. Only a salted scrypt hash is kept, and that sealed by the database's Vault key, which
 * lives in the OS credential store — the database file alone gives nothing to guess against. Wrong PINs count
 * with wrong passwords: five and the person is signed out.
 */
export class LockPin {
  constructor(
    private readonly db: Database,
    private readonly vault: () => Vault,
  ) {}

  private key(userId: string): string {
    return `lock_pin:${userId}`;
  }

  private read(userId: string): StoredPin | null {
    const sealed = this.db.getConfig<string>(this.key(userId));
    const p = typeof sealed === 'string' ? this.vault().decrypt<StoredPin>(sealed) : undefined;
    return p && p.v === 1 && typeof p.salt === 'string' && typeof p.hash === 'string' ? p : null;
  }

  has(userId: string | null): boolean {
    return !!userId && !!this.read(userId);
  }

  /** The PIN's number of digits, or null: no PIN, or one set before its length was kept. */
  length(userId: string | null): number | null {
    const n = userId ? this.read(userId)?.length : undefined;
    return typeof n === 'number' && Number.isInteger(n) && n >= 4 && n <= 8 ? n : null;
  }

  private write(userId: string, stored: StoredPin): void {
    this.db.setConfig(this.key(userId), this.vault().encrypt(stored));
  }

  set(userId: string, pin: string): void {
    if (!PIN_PATTERN.test(pin)) throw new Error('A PIN is 4 to 8 digits.');
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw new Error('Choose a PIN that is harder to guess than repeated or consecutive digits.');
    const salt = randomBytes(16);
    this.write(userId, { v: 1, salt: salt.toString('base64'), hash: hashOf(pin, salt).toString('base64'), length: pin.length });
  }

  clear(userId: string): void {
    this.db.deleteConfig(this.key(userId));
  }

  verify(userId: string, pin: string): boolean {
    const p = this.read(userId);
    if (!p || !PIN_PATTERN.test(pin)) return false;
    const want = Buffer.from(p.hash, 'base64');
    const got = hashOf(pin, Buffer.from(p.salt, 'base64'));
    const ok = want.length === got.length && timingSafeEqual(want, got);
    if (ok && p.length !== pin.length) this.write(userId, { ...p, length: pin.length });
    return ok;
  }
}
