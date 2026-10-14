import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.2.252', isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import type { AccountRecord } from '@shared/accounts';
import { Database } from '../../../../electron/services/db';
import { HttpClient } from '../../../../electron/services/http';
import { SecureStore } from '../../../../electron/services/secure-store';
import { AuthService } from '../../../../electron/services/auth';
import { BackgroundAccounts } from '../../../../electron/services/accounts/background';
import { openAppDb } from '../../../../electron/services/accounts/app-db';
import { AccountRegistry, newAccountId } from '../../../../electron/services/accounts/registry';
import { allPartitions, profilePaths } from '../../../../electron/services/accounts/profile';
import { ScopeHolder, ShellSessions } from '../../../../electron/services/accounts/scope';
import { AccountSwitcher, BIND_BUDGET_MS, switchModeFrom, type SwitcherDeps } from '../../../../electron/services/accounts/switcher';
import { mkdirSync } from 'node:fs';

/** Connection & Startup §1.3 and risks 1–3: an in-process switch keeps accounts apart, and late answers out. */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function account(o: Partial<AccountRecord> & { id?: string } = {}): AccountRecord {
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

function world() {
  const root = mkdtempSync(join(tmpdir(), 'ws-switch-'));
  dirs.push(root);
  const appDb = openAppDb(join(root, 'app.db'));
  const registry = new AccountRegistry(appDb);
  const a = registry.insert(account({ profileDir: 'default', serverOrigin: 'https://a.example', apiOrigin: 'https://a.example' }));
  const b = registry.insert(account({ serverOrigin: 'https://b.example', apiOrigin: 'https://b.example', serverName: 'B', linkHosts: ['b.example'] }));
  registry.setActive(a.id);
  const scopes = new ScopeHolder(root);
  const pa = profilePaths(root, a.profileDir);
  const pb = profilePaths(root, b.profileDir);
  for (const p of [pa, pb]) mkdirSync(p.dir, { recursive: true });
  scopes.bind(a);
  const db = new Database(pa.database);
  db.setConfig('server', { origin: a.apiOrigin, name: 'A', api: 'core', minimumVersion: null, locked: false });
  const secrets = new SecureStore(pa.secrets);
  secrets.init();
  secrets.set('auth:refresh', 'rt-A');
  // B's profile as it was left when B was last open.
  const dbB = new Database(pb.database);
  dbB.setConfig('server', { origin: b.apiOrigin, name: 'B', api: 'core', minimumVersion: null, locked: false });
  dbB.close();
  const sB = new SecureStore(pb.secrets);
  sB.init();
  sB.set('auth:refresh', 'rt-B');
  const auth = new AuthService(db, secrets, async () => new Response('{}'), () => ({}));
  const background = new BackgroundAccounts({
    account: (id) => registry.get(id),
    client: () => ({ refresh: async () => 'ok', get: async () => 0, dispose: () => undefined }) as never,
    lastRefresh: () => Date.now(),
    setLastRefresh: () => undefined,
    onUnread: () => undefined,
    onSignedOut: () => undefined,
    setTimer: () => null,
    clearTimer: () => undefined,
  });
  const steps: string[] = [];
  const deps: SwitcherDeps<{ id: string }> = {
    account: (id) => registry.get(id),
    activeId: () => registry.activeId(),
    setActive: (id) => registry.setActive(id),
    guard: () => null,
    switching: (id) => steps.push(`switching:${id ?? '-'}`),
    prepare: async () => void steps.push('prepare'),
    createWindow: (acc) => ({ id: acc.id }),
    suspend: () => {
      steps.push('suspend');
      scopes.release();
    },
    background,
    bind: (acc) => {
      steps.push('bind');
      const s = scopes.bind(acc);
      db.swap(s.paths.database);
      secrets.rebind(s.paths.secrets);
      auth.rebind(null);
    },
    init: async () => void steps.push('init'),
    show: (w) => steps.push(`show:${w.id}`),
    discard: (w) => steps.push(`discard:${w.id}`),
    relaunch: (id) => steps.push(`relaunch:${id}`),
    mode: () => 'inprocess',
  };
  return { root, registry, scopes, db, secrets, auth, background, a, b, deps, steps };
}

describe('switching accounts in-process (§1.3)', () => {
  it('rebinds the database, secrets and token holder: each account sees only its own data', async () => {
    const w = world();
    w.db.run(
      "INSERT INTO offline_mutations (id, user_id, idempotency_key, module, entity, label, method, path, payload, state, seq, created_at, updated_at) VALUES ('q1', '7', 'k1', 'tasks', 'task', 'In A', 'POST', '/x', 'p', 'PENDING', 1, 'now', 'now')",
    );
    const switcher = new AccountSwitcher(w.deps);
    const out = await switcher.switchTo(w.b.id);
    expect(out.switched).toBe(true);
    expect(w.registry.activeId()).toBe(w.b.id);
    expect(w.steps).toEqual(['switching:' + w.b.id, 'prepare', 'suspend', 'bind', 'init', `show:${w.b.id}`, 'switching:-']);
    // B's own database and secrets; A's queue row is not there.
    expect(w.db.getConfig<{ origin: string }>('server')?.origin).toBe('https://b.example');
    expect(w.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM offline_mutations')!.n).toBe(0);
    expect(w.secrets.get('auth:refresh')).toBe('rt-B');
    expect(w.auth.getServer()?.origin).toBe('https://b.example');
    // And back: A's row is where it was.
    await switcher.switchTo(w.a.id);
    expect(w.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM offline_mutations')!.n).toBe(1);
    expect(w.secrets.get('auth:refresh')).toBe('rt-A');
    w.db.close();
  });

  it('drops an answer for the account open before the switch: aborted, CANCELLED, never written to the next database', async () => {
    const w = world();
    let release!: (r: Response) => void;
    let sentSignal: AbortSignal | undefined;
    const http = new HttpClient({
      fetch: (_url, init) => {
        sentSignal = init.signal ?? undefined;
        return new Promise<Response>((r) => (release = r));
      },
      origin: () => w.auth.getServer()?.origin ?? null,
      tokens: { accessToken: () => 'at', refresh: async () => 'ok' },
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: () => undefined,
      scope: () => w.scopes.requestScope(),
    });
    // A mail-body prefetch for A, writing what it gets into the database it thinks is A's.
    const prefetch = http.get<{ body: string }>('/api/mail/1').then((r) => {
      w.db.run("INSERT INTO cached_records (key, user_id, module, path, payload, bytes, cached_at, accessed_at) VALUES ('mail:1', '7', 'mail', '/api/mail/1', ?, 1, 'now', 'now')", r.body);
    });
    await new Promise((r) => setTimeout(r, 0));
    const switcher = new AccountSwitcher(w.deps);
    await switcher.switchTo(w.b.id);
    expect(sentSignal?.aborted).toBe(true);
    release(new Response(JSON.stringify({ status: 'success', data: { body: 'A secret' } }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(prefetch).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(w.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM cached_records')!.n).toBe(0);
    // A request for B, made after the switch, goes through.
    const fresh = http.get<{ ok: boolean }>('/api/ping');
    await new Promise((r) => setTimeout(r, 0));
    release(new Response(JSON.stringify({ status: 'success', data: { ok: true } }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(fresh).resolves.toEqual({ ok: true });
    w.db.close();
  });

  it('relaunches into the account when binding fails or is slow, and with WS_ACCOUNT_SWITCH=relaunch', async () => {
    const w = world();
    const failing = new AccountSwitcher({ ...w.deps, bind: () => { throw new Error('disk full'); } });
    await failing.switchTo(w.b.id);
    expect(w.steps).toContain(`relaunch:${w.b.id}`);
    expect(w.steps).toContain(`discard:${w.b.id}`);
    expect(w.registry.activeId()).toBe(w.b.id);

    const w2 = world();
    let t = 0;
    const slow = new AccountSwitcher({ ...w2.deps, now: () => t, bind: () => void (t += BIND_BUDGET_MS + 1) });
    await slow.switchTo(w2.b.id);
    expect(w2.steps).toContain(`relaunch:${w2.b.id}`);
    expect(w2.steps).not.toContain('init');

    const w3 = world();
    const killed = new AccountSwitcher({ ...w3.deps, mode: () => switchModeFrom({ WS_ACCOUNT_SWITCH: 'relaunch' }) });
    await killed.switchTo(w3.b.id);
    expect(w3.steps).toEqual([`relaunch:${w3.b.id}`]);
    expect(switchModeFrom({})).toBe('inprocess');
    for (const x of [w, w2, w3]) x.db.close();
  });

  it('refuses while locked or in a call, and one switch at a time', async () => {
    const w = world();
    const locked = new AccountSwitcher({ ...w.deps, guard: () => ({ code: 'SWITCH_BLOCKED', reason: 'Another account can open once the call ends.' }) });
    await expect(locked.switchTo(w.b.id)).rejects.toMatchObject({ code: 'SWITCH_BLOCKED' });
    expect(w.registry.activeId()).toBe(w.a.id);
    let open!: () => void;
    const s = new AccountSwitcher({ ...w.deps, prepare: () => new Promise<void>((r) => (open = r)) });
    const first = s.switchTo(w.b.id);
    expect(s.switching()).toBe(w.b.id);
    await expect(s.switchTo(w.a.id)).rejects.toMatchObject({ code: 'SWITCH_BLOCKED' });
    open();
    await first;
    expect(s.switching()).toBeNull();
    w.db.close();
  });

  it('hands the background poller’s refresh under way to the switch before binding (one refresher per account)', async () => {
    const w = world();
    let finish!: () => void;
    const order: string[] = [];
    const bg = new BackgroundAccounts({
      account: (id) => w.registry.get(id),
      client: () => ({
        refresh: () => new Promise<'ok'>((r) => (finish = () => { order.push('bg-refresh-done'); r('ok'); })),
        get: async <T,>() => 3 as T,
        dispose: () => order.push('bg-disposed'),
      }),
      lastRefresh: () => null,
      setLastRefresh: () => undefined,
      onUnread: () => undefined,
      onSignedOut: () => undefined,
      setTimer: () => null,
      clearTimer: () => undefined,
    });
    bg.adopt(w.b.id);
    void bg.poll(w.b.id);
    const s = new AccountSwitcher({ ...w.deps, background: bg, bind: (a) => { order.push('bind'); w.deps.bind(a); } });
    const done = s.switchTo(w.b.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    finish();
    await done;
    expect(order).toEqual(['bg-refresh-done', 'bg-disposed', 'bind']);
    expect(bg.isPolled(w.b.id)).toBe(false);
    // A, now in the background, is polled.
    expect(bg.isPolled(w.a.id)).toBe(true);
    w.db.close();
  });
});

describe('installShellSession on every partition (risk 2)', () => {
  it('every partition an account scope uses went through the installer, once', () => {
    const installed: string[] = [];
    const shells = new ShellSessions<{ name: string }>((p) => ({ name: p }), (_s, p) => installed.push(p));
    const root = mkdtempSync(join(tmpdir(), 'ws-shell-'));
    dirs.push(root);
    const scopes = new ScopeHolder(root);
    for (const a of [account({ profileDir: 'default' }), account(), account()]) {
      const s = scopes.bind(a);
      shells.ensureAll(s.partitions);
      shells.ensureAll(s.partitions);
      for (const p of s.allPartitions()) expect(shells.has(p)).toBe(true);
      expect(s.allPartitions()).toEqual(allPartitions(a));
    }
    expect(installed).toEqual(shells.installed());
    expect(new Set(installed).size).toBe(installed.length);
    expect(installed).toContain('');
    expect(installed).toContain('persist:ws-net');
    expect(installed.filter((p) => p.startsWith('persist:acct-'))).toHaveLength(6);
  });
});
