import { describe, expect, it } from 'vitest';
import { LockPin } from '../../../electron/services/lock-pin';
import { Vault } from '../../../electron/services/vault';
import type { Database } from '../../../electron/services/db';

/** The `config` table, in memory. */
function fakeDb() {
  const rows = new Map<string, string>();
  const db = {
    getConfig: (k: string) => (rows.has(k) ? JSON.parse(rows.get(k)!) : undefined),
    setConfig: (k: string, v: unknown) => void rows.set(k, JSON.stringify(v)),
    deleteConfig: (k: string) => void rows.delete(k),
  } as unknown as Database;
  return { db, rows };
}

describe('LockPin', () => {
  const vault = new Vault(Vault.generateKey());

  it('keeps only a sealed hash, and checks a PIN against it', () => {
    const { db, rows } = fakeDb();
    const pins = new LockPin(db, () => vault);
    expect(pins.has('7')).toBe(false);
    pins.set('7', '4821');
    expect(pins.has('7')).toBe(true);
    expect([...rows.values()].join('')).not.toContain('4821');
    expect(pins.verify('7', '4821')).toBe(true);
    expect(pins.verify('7', '4822')).toBe(false);
    expect(pins.verify('8', '4821')).toBe(false);
    pins.clear('7');
    expect(pins.has('7')).toBe(false);
    expect(pins.verify('7', '4821')).toBe(false);
  });

  it('refuses PINs that are too short, too long, or easy to guess', () => {
    const pins = new LockPin(fakeDb().db, () => vault);
    for (const bad of ['123', '123456789', '12a4', '0000', '1234', '9876']) expect(() => pins.set('1', bad)).toThrow();
  });

  it('knows how many digits the PIN has, for the lock screen, and never the digits', () => {
    const { db, rows } = fakeDb();
    const pins = new LockPin(db, () => vault);
    expect(pins.length('7')).toBeNull();
    expect(pins.length(null)).toBeNull();
    pins.set('7', '482159');
    expect(pins.length('7')).toBe(6);
    expect([...rows.values()].join('')).not.toContain('482159');
    pins.clear('7');
    expect(pins.length('7')).toBeNull();
  });

  it('learns the length of a PIN set before it was kept at its next right use — not a wrong one', () => {
    const { db } = fakeDb();
    const pins = new LockPin(db, () => vault);
    pins.set('7', '4821');
    // As an older version stored it: no length.
    const { length: _, ...legacy } = vault.decrypt<Record<string, unknown>>(db.getConfig<string>('lock_pin:7')!)!;
    db.setConfig('lock_pin:7', vault.encrypt(legacy));
    expect(pins.length('7')).toBeNull();
    expect(pins.verify('7', '48213')).toBe(false);
    expect(pins.length('7')).toBeNull();
    expect(pins.verify('7', '4821')).toBe(true);
    expect(pins.length('7')).toBe(4);
    expect(pins.verify('7', '4821')).toBe(true);
  });

  it('is unreadable under another key', () => {
    const { db } = fakeDb();
    new LockPin(db, () => vault).set('7', '4821');
    const other = new LockPin(db, () => new Vault(Vault.generateKey()));
    expect(other.has('7')).toBe(false);
    expect(other.verify('7', '4821')).toBe(false);
  });
});

it('isolates the same user ID on different servers and migrates legacy PINs only once', () => {
  const { db } = fakeDb();
  // Use a stable vault for all scoped reads.
  const vault = new Vault(Vault.generateKey()); const scoped = new LockPin(db, () => vault);
  scoped.set('7', '4821'); scoped.setServerScope('https://one.example');
  expect(scoped.verify('7', '4821')).toBe(true);
  scoped.setServerScope('https://two.example'); expect(scoped.has('7')).toBe(false);
  scoped.set('7', '5829'); expect(scoped.verify('7', '5829')).toBe(true);
  scoped.setServerScope('https://one.example'); expect(scoped.verify('7', '4821')).toBe(true);
  scoped.clear('7'); scoped.setServerScope('https://two.example'); expect(scoped.verify('7', '5829')).toBe(true);
});
