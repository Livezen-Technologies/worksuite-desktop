import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.2.252', isPackaged: false } }));

import type { AccountRecord } from '@shared/accounts';
import { parseDeepLink } from '@shared/deeplink';
import type { Bootstrap } from '@shared/types';
import { SessionController, type SessionHooks } from '../../../../electron/main/session';
import { Database } from '../../../../electron/services/db';
import { Vault } from '../../../../electron/services/vault';
import { openAppDb } from '../../../../electron/services/accounts/app-db';
import { AccountsService, type AccountsHost } from '../../../../electron/services/accounts/handlers';
import { routeLink, withoutServerParam } from '../../../../electron/services/accounts/links';
import { DEFAULT_PROFILE_DIR, partitionDir, profilePaths } from '../../../../electron/services/accounts/profile';
import { AccountRegistry, newAccountId } from '../../../../electron/services/accounts/registry';
import { processPendingRemovals, removeAccount } from '../../../../electron/services/accounts/removal';
import { exportUnsyncedZip, pendingCount, unsyncedSummary } from '../../../../electron/services/accounts/unsynced';
import type { AuthService } from '../../../../electron/services/auth';
import type { BootstrapService } from '../../../../electron/services/bootstrap';
import type { DeviceService } from '../../../../electron/services/device';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ws-acc-ops-'));
  dirs.push(d);
  return d;
}

function record(o: Partial<AccountRecord> = {}): AccountRecord {
  const id = o.id ?? newAccountId();
  const first = o.profileDir === 'default';
  return {
    id,
    kind: 'enterprise',
    serverOrigin: 'https://a.example',
    apiOrigin: 'https://a.example',
    serverId: null,
    serverName: 'A',
    deployment: 'ENTERPRISE',
    organizationId: null,
    organizationName: null,
    user: { id: '7', name: 'Ann', email: 'ann@a.example', avatar: null },
    branding: { logo: null, accent: null, initials: 'A' },
    linkHosts: ['a.example'],
    profileDir: first ? 'default' : id,
    partition: first ? '' : `persist:acct-${id}`,
    managed: false,
    trust: null,
    signInState: 'signed-in',
    addedAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: null,
    discoveredAt: null,
    signed: false,
    ...o,
  };
}

const queueRow = (db: Database, vault: Vault, id: string) =>
  db.run(
    "INSERT INTO offline_mutations (id, user_id, idempotency_key, module, entity, label, method, path, payload, state, seq, created_at, updated_at) VALUES (?, '7', ?, 'tasks', 'task', ?, 'POST', '/api/tasks', ?, 'PENDING', 1, '2026-10-01T00:00:00.000Z', 'now')",
    id,
    `k-${id}`,
    `Task ${id}`,
    vault.encrypt({ body: { title: id } }),
  );

describe('sign-out keeps what has not been sent (§5, screen 14)', () => {
  function session(policy: Record<string, unknown> = {}) {
    const boot = { user: { id: '7', name: 'Ann', email: 'a@x', avatar: null }, policy: { wipe_on_revoke: 'cache', ...policy }, offline: true } as unknown as Bootstrap;
    const auth = { getServer: () => ({ origin: 'https://a.example', name: 'A', api: 'core', minimumVersion: null, locked: false }), hasRefreshToken: () => true, refresh: async () => 'offline', signOut: vi.fn(async () => undefined), forget: vi.fn() } as unknown as AuthService;
    const bootstrap = { lastUserId: () => '7', loadCached: () => boot, clear: vi.fn(), setLastUser: vi.fn() } as unknown as BootstrapService;
    const device = { load: vi.fn(), forget: vi.fn() } as unknown as DeviceService;
    const hooks = { started: vi.fn(), stopped: vi.fn(), wiped: vi.fn(), syncDisabled: vi.fn(), changed: vi.fn(), bootstrapChanged: vi.fn(), minimumVersion: vi.fn(), requireUpdate: vi.fn(), toast: vi.fn(), audit: vi.fn() } satisfies SessionHooks;
    const s = new SessionController(new Database(':memory:'), auth, device, bootstrap, async () => new Response(''), { source: null }, hooks);
    return { s, hooks };
  }

  it('a plain sign-out keeps the queue; discarding, a wipe or the sign_out_wipe policy does not', async () => {
    const a = session();
    await a.s.init({ cachedFirst: true });
    expect(a.s.isReady()).toBe(true);
    await a.s.signOut(false);
    expect(a.hooks.wiped).toHaveBeenCalledWith('7', 'cache', false, true);

    const b = session();
    await b.s.init({ cachedFirst: true });
    await b.s.signOut(false, null, { discardUnsynced: true });
    expect(b.hooks.wiped).toHaveBeenCalledWith('7', 'cache', false, false);

    const c = session({ sign_out_wipe: true });
    await c.s.init({ cachedFirst: true });
    await c.s.signOut(false);
    expect(c.hooks.wiped).toHaveBeenCalledWith('7', 'cache', false, false);

    const d = session();
    await d.s.init({ cachedFirst: true });
    await d.s.signOut(true);
    expect(d.hooks.wiped).toHaveBeenCalledWith('7', 'cache+offline_files', true, false);
  });

  it('suspend stops the services without a wipe or a revoke (another account opens)', async () => {
    const a = session();
    await a.s.init({ cachedFirst: true });
    a.s.suspend();
    expect(a.hooks.stopped).toHaveBeenCalled();
    expect(a.hooks.wiped).not.toHaveBeenCalled();
    expect(a.s.get().stage).toBe('no-server');
  });

  it('lists the queue, uploads and desk outboxes, and exports them as a zip', () => {
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    queueRow(db, vault, 'q1');
    queueRow(db, vault, 'q2');
    db.run("INSERT INTO transfers (id, user_id, direction, name, meta, state, created_at, updated_at) VALUES ('t1', '7', 'upload', 'Report.pdf', 'm', 'queued', 'now', 'now')");
    db.run("INSERT INTO salon_outbox (id, origin, desk_id, user_id, seq, state, item, created_at, updated_at) VALUES ('s1', 'o', 1, '7', 1, 'waiting', 'x', 'now', 'now')");
    db.run("INSERT INTO offline_mutations (id, user_id, idempotency_key, module, entity, label, method, path, payload, state, seq, created_at, updated_at) VALUES ('other', '9', 'k9', 'tasks', 'task', 'Not mine', 'POST', '/x', 'p', 'PENDING', 1, 'now', 'now')");
    const summary = unsyncedSummary({ db, vault, accountId: 'acc_x', userId: '7' });
    expect(summary.items.map((i) => i.source)).toEqual(['queue', 'queue', 'upload', 'desk']);
    expect(pendingCount(summary)).toBe(4);
    const zip = exportUnsyncedZip({ db, vault, accountId: 'acc_x', userId: '7' }, summary);
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zip.includes(Buffer.from('queue/q1.json'))).toBe(true);
  });

  it('the account shows "N pending changes kept" after a plain sign-out', async () => {
    const root = tmp();
    const appDb = openAppDb(join(root, 'app.db'));
    const registry = new AccountRegistry(appDb);
    const a = registry.insert(record({ profileDir: 'default' }));
    registry.setActive(a.id);
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    queueRow(db, vault, 'q1');
    queueRow(db, vault, 'q2');
    const host = {
      registry,
      switcher: { switching: () => null, switchTo: vi.fn() },
      background: { unread: () => 0, release: async () => undefined },
      trusted: () => ({ allowPersonal: true, lockServer: false }),
      session: { signOut: vi.fn(async () => ({})) },
      unsynced: () => unsyncedSummary({ db, vault, accountId: a.id, userId: '7' }),
      reachable: () => true,
      emit: vi.fn(),
    } as unknown as AccountsHost;
    const service = new AccountsService(host);
    const state = await service.signOut({ accountId: a.id, removeCachedData: true, keepOfflineFiles: true, discardUnsynced: false });
    expect(host.session.signOut).toHaveBeenCalledWith(false, null, { discardUnsynced: false });
    expect(registry.get(a.id)?.signInState).toBe('signed-out');
    registry.setActive(null);
    expect(service.state().accounts[0]!.pendingChanges).toBe(2);
    expect(state.accounts[0]!.signInState).toBe('signed-out');
    appDb.close();
  });
});

describe('remove from this device (§5)', () => {
  function setup() {
    const root = tmp();
    const appDb = openAppDb(join(root, 'app.db'));
    const registry = new AccountRegistry(appDb);
    const first = registry.insert(record({ profileDir: 'default' }));
    const other = registry.insert(record({ serverOrigin: 'https://b.example', apiOrigin: 'https://b.example' }));
    const it2 = registry.insert(record({ serverOrigin: 'https://it.example', apiOrigin: 'https://it.example', managed: true }));
    for (const a of [first, other, it2]) {
      const p = profilePaths(root, a.profileDir);
      mkdirSync(p.elearning, { recursive: true });
      writeFileSync(p.database, 'db');
      writeFileSync(p.secrets, '{}');
    }
    writeFileSync(join(profilePaths(root, 'default').dir, 'guest-workspace.sqlite'), 'guest');
    mkdirSync(join(root, 'Partitions', `acct-${other.id}`), { recursive: true });
    const revoked: string[] = [];
    const cleared: string[] = [];
    const deps = { userData: root, appDb, registry, revoke: async (a: AccountRecord) => void revoked.push(a.id), clearStorage: async (p: string) => void cleared.push(p), release: () => undefined, trash: async () => undefined };
    return { root, appDb, registry, first, other, it2, deps, revoked, cleared };
  }

  it('revokes, clears its partitions, deletes its profile, queues the partition folders; other accounts and the guest workspace stay', async () => {
    const w = setup();
    await removeAccount(w.deps, w.other.id, { keepOfflineFiles: true });
    expect(w.revoked).toEqual([w.other.id]);
    expect(w.cleared).toEqual([`persist:acct-${w.other.id}`, `persist:acct-${w.other.id}-net`, `persist:acct-${w.other.id}-bulk`]);
    expect(existsSync(profilePaths(w.root, w.other.id).dir)).toBe(false);
    expect(w.registry.get(w.other.id)).toBeNull();
    expect(existsSync(profilePaths(w.root, DEFAULT_PROFILE_DIR).database)).toBe(true);
    expect(readFileSync(join(profilePaths(w.root, 'default').dir, 'guest-workspace.sqlite'), 'utf8')).toBe('guest');
    const queued = w.appDb.all<{ path: string }>('SELECT path FROM pending_removals').map((r) => r.path);
    expect(queued).toContain(partitionDir(w.root, `persist:acct-${w.other.id}`));
    // The next start removes them, before any window.
    expect(processPendingRemovals(w.appDb, w.root).left).toBe(0);
    expect(existsSync(join(w.root, 'Partitions', `acct-${w.other.id}`))).toBe(false);
    expect(w.appDb.all('SELECT path FROM pending_removals')).toEqual([]);
  });

  it('removes only account #1’s own files from profiles/default', async () => {
    const w = setup();
    await removeAccount(w.deps, w.first.id, { keepOfflineFiles: true });
    const dir = profilePaths(w.root, 'default').dir;
    expect(existsSync(join(dir, 'worksuite.db'))).toBe(false);
    expect(existsSync(join(dir, 'secrets.json'))).toBe(false);
    expect(existsSync(join(dir, 'elearning'))).toBe(false);
    expect(readFileSync(join(dir, 'guest-workspace.sqlite'), 'utf8')).toBe('guest');
    expect(w.cleared).toEqual(['', 'persist:ws-net', 'persist:ws-bulk']);
  });

  it('refuses a managed account (Removal set by IT policy), and a file still held is removed at the next start', async () => {
    const w = setup();
    await expect(removeAccount(w.deps, w.it2.id, { keepOfflineFiles: true })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(w.registry.get(w.it2.id)).not.toBeNull();
    await removeAccount({ ...w.deps, rm: () => { throw new Error('EBUSY'); } }, w.other.id, { keepOfflineFiles: true });
    expect(w.appDb.all<{ path: string }>('SELECT path FROM pending_removals').map((r) => r.path)).toContain(profilePaths(w.root, w.other.id).dir);
    processPendingRemovals(w.appDb, w.root);
    expect(existsSync(profilePaths(w.root, w.other.id).dir)).toBe(false);
  });

  it('never removes userData itself or anything outside it', () => {
    const w = setup();
    w.appDb.run('INSERT INTO pending_removals (path, partition, queued_at) VALUES (?, NULL, ?)', w.root, 'now');
    w.appDb.run('INSERT INTO pending_removals (path, partition, queued_at) VALUES (?, NULL, ?)', tmpdir(), 'now');
    processPendingRemovals(w.appDb, w.root);
    expect(existsSync(w.root)).toBe(true);
    expect(w.appDb.all('SELECT path FROM pending_removals')).toEqual([]);
  });
});

describe('links by account (§4 step 5)', () => {
  const a = record({ id: 'acc_aaaaaaaaaaaaaaaaaaaa', linkHosts: ['a.example', 'files.a.example'] });
  const b = record({ id: 'acc_bbbbbbbbbbbbbbbbbbbb', serverOrigin: 'https://b.example', apiOrigin: 'https://b.example', linkHosts: ['b.example'] });

  it('routes by host to the open account, another account, or screen 16', () => {
    expect(routeLink('https://files.a.example/o/3/task/12', [a, b], a.id)).toEqual({ kind: 'active' });
    expect(routeLink('https://b.example/o/3/task/12', [a, b], a.id)).toEqual({ kind: 'account', accountId: b.id });
    expect(routeLink('https://evil.example/o/3/task/12', [a, b], a.id)).toEqual({ kind: 'unknown', host: 'evil.example', label: 'Task #12' });
    expect(routeLink('https://app.worksuite.lk/o/3/task/12', [a, b], a.id)).toEqual({ kind: 'active' });
  });

  it('a worksuite:// link goes to the open account unless it names a server', () => {
    expect(routeLink('worksuite://tasks/12', [a, b], a.id)).toEqual({ kind: 'active' });
    expect(routeLink('worksuite://tasks/12?server=b.example', [a, b], a.id)).toEqual({ kind: 'account', accountId: b.id });
    expect(routeLink('worksuite://tasks/12?server=c.example', [a, b], a.id)).toMatchObject({ kind: 'unknown', host: 'c.example' });
    expect(parseDeepLink('worksuite://tasks/12?server=B.example')).toMatchObject({ ok: true, link: { route: '/tasks/12', server: 'b.example' } });
    expect(parseDeepLink('worksuite://tasks/12?server=b.example/x')).toMatchObject({ ok: false });
    expect(withoutServerParam('worksuite://tasks/12?server=b.example')).toBe('worksuite://tasks/12');
  });

  it('leaves mail, sign-in callbacks, setup links and guest meetings to their own paths', () => {
    for (const u of ['mailto:a@b.c', 'worksuite://auth/callback?code=1', 'worksuite://setup?d=x&s=y', 'https://x.example/meet/123']) expect(routeLink(u, [a, b], a.id)).toBeNull();
  });
});
