import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.2.285', isPackaged: false } }));

import { PosLocal } from '../../../electron/services/pos-local/ipc';

/*
 * Who is at the till is the main process's business: a screen that asks for something it may not do is refused
 * whatever it believes about itself, a quiet till signs itself out, and a role taken away takes effect at once.
 */
type Handler = (input: unknown) => unknown;

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'pos-ipc-'));
  let clock = Date.parse('2026-10-29T09:00:00Z');
  const pos = new PosLocal({ dataDir: dir, now: () => clock });
  const handlers = new Map<string, Handler>();
  pos.register({ handle: (ch: string, fn: Handler) => handlers.set(ch, fn) } as never);
  const call = (ch: string, input?: unknown) => handlers.get(ch)!(input);
  return { pos, call, dir, tick: (ms: number) => (clock += ms) };
}

let h: ReturnType<typeof harness>;
const OWNER = { username: 'sunil', displayName: 'Sunil', password: 'till-of-the-day', role: 'cashier' as const };

beforeEach(() => {
  h = harness();
});
afterEach(() => {
  h.pos.dispose();
  rmSync(h.dir, { recursive: true, force: true });
});

describe('offline till IPC', () => {
  it('starts empty, and the first person opened is signed in as the owner', () => {
    expect(h.call('posLocal:state')).toMatchObject({ empty: true, signedIn: null, permissions: [] });
    const after = h.call('posLocal:addUser', OWNER) as { empty: boolean; signedIn: { role: string } | null; permissions: string[] };
    expect(after.empty).toBe(false);
    expect(after.signedIn?.role).toBe('owner');
    expect(after.permissions).toContain('backup_restore');
  });

  it('refuses everything else until somebody signs in', () => {
    h.call('posLocal:addUser', OWNER);
    h.call('posLocal:signOut');
    expect(() => h.call('posLocal:users')).toThrow(/Sign in to the till/);
    expect(() => h.call('posLocal:audits')).toThrow(/Sign in to the till/);
  });

  it('refuses a cashier the things a cashier may not do, whatever the screen asks', () => {
    h.call('posLocal:addUser', OWNER);
    h.call('posLocal:addUser', { username: 'nimal', displayName: 'Nimal', password: 'second-person', role: 'cashier' });
    h.call('posLocal:signOut');
    h.call('posLocal:signIn', { username: 'nimal', password: 'second-person' });
    expect(() => h.call('posLocal:addUser', { username: 'third', displayName: 'T', password: 'third-person', role: 'cashier' })).toThrow(/Only an owner/);
    expect(() => h.call('posLocal:audits')).toThrow(/cashier does not read/);
  });

  it('signs the till out after ten quiet minutes', () => {
    h.call('posLocal:addUser', OWNER);
    h.tick(11 * 60 * 1000);
    expect(h.call('posLocal:state')).toMatchObject({ signedIn: null });
    expect(() => h.call('posLocal:users')).toThrow(/Sign in to the till/);
  });

  it('keeps the till open while it is being used', () => {
    h.call('posLocal:addUser', OWNER);
    for (let i = 0; i < 4; i++) {
      h.tick(8 * 60 * 1000);
      h.call('posLocal:users');
    }
    expect((h.call('posLocal:state') as { signedIn: unknown }).signedIn).not.toBeNull();
  });

  it('answers a wrong password without signing anybody in', () => {
    h.call('posLocal:addUser', OWNER);
    h.call('posLocal:signOut');
    expect(h.call('posLocal:signIn', { username: 'sunil', password: 'not-the-one' })).toMatchObject({ refused: 'wrong' });
    expect((h.call('posLocal:state') as { signedIn: unknown }).signedIn).toBeNull();
  });

  it('drops somebody the owner suspends while they are signed in', () => {
    /* Two tills on one shop's database: the owner suspends a cashier at one, who is using the other. */
    h.call('posLocal:addUser', OWNER);
    h.call('posLocal:addUser', { username: 'nimal', displayName: 'Nimal', password: 'second-person', role: 'manager' });
    const nimal = (h.call('posLocal:users') as Array<{ id: string; username: string }>).find((u) => u.username === 'nimal')!;

    const second = new PosLocal({ dataDir: h.dir });
    const handlers = new Map<string, Handler>();
    second.register({ handle: (ch: string, fn: Handler) => handlers.set(ch, fn) } as never);
    handlers.get('posLocal:signIn')!({ username: 'nimal', password: 'second-person' });
    expect((handlers.get('posLocal:state')!(undefined) as { signedIn: unknown }).signedIn).not.toBeNull();

    h.call('posLocal:update', { userId: nimal.id, suspended: true });
    expect(() => handlers.get('posLocal:users')!(undefined)).toThrow(/no longer signed in/);
    second.dispose();
  });

  it('asks for a new password after an owner resets one', () => {
    h.call('posLocal:addUser', OWNER);
    h.call('posLocal:addUser', { username: 'nimal', displayName: 'Nimal', password: 'second-person', role: 'cashier' });
    const list = h.call('posLocal:users') as Array<{ id: string; username: string }>;
    const nimal = list.find((u) => u.username === 'nimal')!;
    h.call('posLocal:resetPassword', { userId: nimal.id, newPassword: 'reset-password-1' });
    h.call('posLocal:signOut');
    expect(h.call('posLocal:signIn', { username: 'nimal', password: 'reset-password-1' })).toMatchObject({ mustChangePassword: true });
    h.call('posLocal:changePassword', { oldPassword: 'reset-password-1', newPassword: 'chosen-password' });
    expect(h.call('posLocal:state')).toMatchObject({ mustChangePassword: false });
  });
});
