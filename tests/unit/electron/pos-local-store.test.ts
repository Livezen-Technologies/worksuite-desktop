import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.2.285', isPackaged: false } }));

import { PosLocalStore, hashPassword, verifyPassword } from '../../../electron/services/pos-local/store';
import type { PosLocalUser } from '@shared/pos-local';

/*
 * The offline till's own people: the first one is always the owner, a wrong password is held after five, and the
 * last owner cannot be taken away — on a machine with no server to ask.
 */
let dir: string;
let store: PosLocalStore;
let clock = Date.parse('2026-10-29T08:00:00Z');

const owner = (): PosLocalUser => store.users().find((u) => u.role === 'owner')!;
const open = () => store.addUser({ username: 'sunil', displayName: 'Sunil', password: 'till-of-the-day', role: 'cashier' }, null);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pos-local-'));
  clock = Date.parse('2026-10-29T08:00:00Z');
  store = new PosLocalStore(join(dir, 'pos.sqlite'), () => clock);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('offline till people', () => {
  it('starts empty and makes the first person an owner, whatever was asked for', () => {
    expect(store.empty).toBe(true);
    const first = open();
    expect(first.role).toBe('owner');
    expect(store.empty).toBe(false);
  });

  it('will not let anybody but an owner add people', () => {
    open();
    const cashier = store.addUser({ username: 'nimal', displayName: 'Nimal', password: 'second-person', role: 'cashier' }, owner());
    expect(cashier.role).toBe('cashier');
    expect(() => store.addUser({ username: 'third', displayName: 'Third', password: 'third-person', role: 'cashier' }, cashier)).toThrow(/Only an owner/);
  });

  it('refuses a username already on the till', () => {
    open();
    expect(() => store.addUser({ username: 'Sunil', displayName: 'Other', password: 'another-password', role: 'cashier' }, owner())).toThrow(/already called/);
  });

  it('signs in, and clears the failed count', () => {
    open();
    store.signIn('sunil', 'wrong-password-1');
    const out = store.signIn('sunil', 'till-of-the-day');
    expect('user' in out && out.user.username).toBe('sunil');
    const again = store.signIn('sunil', 'wrong-password-2');
    expect('refused' in again && again.refused).toBe('wrong');
  });

  it('holds the account after five wrong passwords, and lets it go after five minutes', () => {
    open();
    for (let i = 0; i < 4; i++) expect(store.signIn('sunil', `no-${i}-wrong`)).toMatchObject({ refused: 'wrong' });
    expect(store.signIn('sunil', 'no-5-wrong')).toMatchObject({ refused: 'locked' });
    /* The right password is still refused while it is held. */
    expect(store.signIn('sunil', 'till-of-the-day')).toMatchObject({ refused: 'locked' });
    clock += 6 * 60 * 1000;
    expect(store.signIn('sunil', 'till-of-the-day')).toHaveProperty('user');
  });

  it('answers an unknown username without saying so twice', () => {
    open();
    expect(store.signIn('nobody', 'whatever-password')).toMatchObject({ refused: 'unknown' });
  });

  it('refuses a suspended person', () => {
    open();
    const o = owner();
    const c = store.addUser({ username: 'nimal', displayName: 'Nimal', password: 'second-person', role: 'cashier' }, o);
    store.update(c.id, { suspended: true }, o);
    expect(store.signIn('nimal', 'second-person')).toMatchObject({ refused: 'suspended' });
  });

  it('keeps an owner who can run the till', () => {
    open();
    const o = owner();
    expect(() => store.update(o.id, { role: 'cashier' }, o)).toThrow(/only owner/);
    expect(() => store.remove(o.id, o)).toThrow(/cannot remove yourself/);
    const second = store.addUser({ username: 'ranjan', displayName: 'Ranjan', password: 'second-owner', role: 'owner' }, o);
    expect(store.update(o.id, { role: 'manager' }, second).role).toBe('manager');
  });

  it('changes a password only with the old one, and a reset asks for a new one next time', () => {
    open();
    const o = owner();
    expect(() => store.changePassword(o.id, 'not-the-password', 'a-new-password')).toThrow(/current password/);
    store.changePassword(o.id, 'till-of-the-day', 'a-new-password');
    expect(store.signIn('sunil', 'a-new-password')).toHaveProperty('user');
    const c = store.addUser({ username: 'nimal', displayName: 'Nimal', password: 'second-person', role: 'cashier' }, store.users().find((u) => u.role === 'owner')!);
    store.resetPassword(c.id, 'reset-password-1', store.users().find((u) => u.role === 'owner')!);
    const out = store.signIn('nimal', 'reset-password-1');
    expect('mustChangePassword' in out && out.mustChangePassword).toBe(true);
  });

  it('writes down what happened on the till', () => {
    open();
    store.signIn('sunil', 'wrong-one-here');
    const actions = store.audits().map((a) => a.action);
    expect(actions).toContain('till.opened');
    expect(actions).toContain('signin.wrong');
  });

  it('keeps passwords only as a salted scrypt hash', () => {
    const h = hashPassword('till-of-the-day');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('till-of-the-day');
    expect(verifyPassword('till-of-the-day', h)).toBe(true);
    expect(verifyPassword('till-of-the-dax', h)).toBe(false);
    expect(hashPassword('till-of-the-day')).not.toBe(h);
    expect(verifyPassword('x', 'nonsense')).toBe(false);
  });
});
