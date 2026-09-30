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

  it('is unreadable under another key', () => {
    const { db } = fakeDb();
    new LockPin(db, () => vault).set('7', '4821');
    const other = new LockPin(db, () => new Vault(Vault.generateKey()));
    expect(other.has('7')).toBe(false);
    expect(other.verify('7', '4821')).toBe(false);
  });
});
