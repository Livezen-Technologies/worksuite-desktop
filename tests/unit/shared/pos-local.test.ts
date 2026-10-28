import { describe, expect, it } from 'vitest';
import { lastOwnerProblem, lockUntil, isLocked, may, passwordProblem, usernameProblem, ROLE_PERMISSIONS } from '@shared/pos-local';

const u = (id: string, role: 'owner' | 'manager' | 'cashier', suspended = false) => ({ id, role, suspended });

describe('offline POS rules', () => {
  it('gives a cashier the till and nothing that can lose money or data', () => {
    expect(may('cashier', 'sell')).toBe(true);
    expect(may('cashier', 'refund')).toBe(false);
    expect(may('cashier', 'discount')).toBe(false);
    expect(may('cashier', 'manage_users')).toBe(false);
    expect(may('cashier', 'backup_restore')).toBe(false);
  });

  it('gives a manager the shop floor but not the till’s own settings', () => {
    expect(may('manager', 'refund')).toBe(true);
    expect(may('manager', 'view_reports')).toBe(true);
    expect(may('manager', 'manage_users')).toBe(false);
    expect(may('manager', 'sync_cloud')).toBe(false);
  });

  it('gives an owner everything', () => {
    expect(ROLE_PERMISSIONS.owner.length).toBeGreaterThan(ROLE_PERMISSIONS.manager.length);
    expect(may('owner', 'backup_restore')).toBe(true);
  });

  it('refuses the usernames a till would trip over', () => {
    expect(usernameProblem('')).toMatch(/Choose/);
    expect(usernameProblem('a')).toMatch(/two characters/);
    expect(usernameProblem('has space')).toMatch(/letters, digits/);
    expect(usernameProblem('.leading')).toMatch(/letters, digits/);
    expect(usernameProblem('till-2')).toBeNull();
  });

  it('refuses the three password habits a shop actually has', () => {
    expect(passwordProblem('1234')).toMatch(/eight characters/);
    expect(passwordProblem('11111111')).toMatch(/same character/);
    expect(passwordProblem('password')).toMatch(/too easy/);
    expect(passwordProblem('cashier1', 'cashier1')).toMatch(/cannot be the username/);
    expect(passwordProblem('till-of-the-day')).toBeNull();
  });

  it('holds an account after five wrong passwords, and only then', () => {
    const now = 1_000_000;
    expect(lockUntil(4, now)).toBeNull();
    const until = lockUntil(5, now);
    expect(until).not.toBeNull();
    expect(isLocked(until, now + 60_000)).toBe(true);
    expect(isLocked(until, now + 6 * 60_000)).toBe(false);
  });

  it('will not let the last owner be removed, suspended or demoted', () => {
    const one = [u('a', 'owner'), u('b', 'cashier')];
    expect(lastOwnerProblem(one, 'a', { removed: true })).toMatch(/only owner/);
    expect(lastOwnerProblem(one, 'a', { suspended: true })).toMatch(/nobody who can run/);
    expect(lastOwnerProblem(one, 'a', { role: 'manager' })).toMatch(/only owner/);
  });

  it('allows it once somebody else is an owner', () => {
    const two = [u('a', 'owner'), u('b', 'owner')];
    expect(lastOwnerProblem(two, 'a', { removed: true })).toBeNull();
    expect(lastOwnerProblem(two, 'a', { role: 'cashier' })).toBeNull();
  });

  it('does not count a suspended owner as one who can run the till', () => {
    const users = [u('a', 'owner'), u('b', 'owner', true)];
    expect(lastOwnerProblem(users, 'a', { removed: true })).toMatch(/only owner/);
  });
});
