import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.2.252', isPackaged: false } }));
import { EMPTY_TRUSTED_CONFIG, type TrustedConfig } from '@shared/trusted-config';
import { Database } from '../../../../electron/services/db';
import { Vault } from '../../../../electron/services/vault';
import { APP_KEYS, openAppDb } from '../../../../electron/services/accounts/app-db';
import { migrateAccounts, readLegacyProfile } from '../../../../electron/services/accounts/migrate';
import { DEFAULT_PROFILE_DIR, profilePaths } from '../../../../electron/services/accounts/profile';
import { AccountRegistry } from '../../../../electron/services/accounts/registry';
import { removeAccount } from '../../../../electron/services/accounts/removal';
import { SettingsService } from '../../../../electron/services/settings';
import { BootstrapService } from '../../../../electron/services/bootstrap';
import type { HttpClient } from '../../../../electron/services/http';

/**
 * Connection & Startup §8.2: the profile that was there before accounts becomes account #1 — copied, never moved,
 * idempotent, reconciled on every start. Each case builds its fixture profile at runtime.
 */

const ORIGIN = 'https://ws.example';
const USER = { id: '7', name: 'Ann Perera', email: 'ann@ws.example', avatar: null, organizationId: '3', organizationName: 'Livezen Technologies' };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function userData(): string {
  const d = mkdtempSync(join(tmpdir(), 'ws-accounts-'));
  dirs.push(d);
  return d;
}

interface Legacy {
  server?: boolean;
  signedIn?: boolean;
  guest?: boolean;
  origin?: string;
  lastUser?: string;
}

/** A legacy `profiles/default` as an older desktop leaves it. Returns its secrets (what the OS store would hold). */
function legacyProfile(root: string, o: Legacy = {}): Map<string, string> {
  const paths = profilePaths(root, DEFAULT_PROFILE_DIR);
  mkdirSync(paths.dir, { recursive: true });
  const secrets = new Map<string, string>();
  const key = Vault.generateKey();
  secrets.set('db-key', key.toString('base64'));
  if (o.signedIn) secrets.set('auth:refresh', 'rt-legacy');
  const db = new Database(paths.database);
  const origin = o.origin ?? ORIGIN;
  if (o.server !== false) db.setConfig('server', { origin, name: 'Livezen Technologies', api: 'core', minimumVersion: null, locked: false });
  db.setConfig('last-user', o.lastUser ?? USER.id);
  db.setConfig('install-id', 'install-123');
  db.setConfig('preferences', { theme: 'dark', language: 'si', hardwareAcceleration: false });
  db.setConfig('interface_language_default', 'si');
  db.setConfig('interface_languages', { [`${origin}:7`]: 'ta', 'https://other.example:9': 'en' });
  db.setConfig(`security_preferences:${origin}:7`, { appLockEnabled: true, appLockMinutes: 5 });
  db.setConfig(`appearance_preferences:${origin}:7`, { lightProfile: 'paper' });
  db.setConfig('security_preferences_legacy_owner', `${origin}:7`);
  db.setConfig('update_notices', ['0.2.250:staged']);
  db.run('INSERT INTO window_layouts (kind, display_id, bounds, maximized, updated_at) VALUES (?, ?, ?, ?, ?)', 'main', '1', JSON.stringify({ x: 10, y: 20, width: 1200, height: 800 }), 1, '2026-10-01T00:00:00.000Z');
  const vault = new Vault(key);
  db.run('INSERT INTO sessions (user_id, bootstrap, cached_at) VALUES (?, ?, ?)', USER.id, vault.encrypt({ user: USER, policy: {}, apps: [], permissions: [], organizations: [], cachedAt: '2026-10-01T00:00:00.000Z' }), '2026-10-01T00:00:00.000Z');
  for (let i = 0; i < 3; i++) {
    db.run(
      'INSERT INTO offline_mutations (id, user_id, idempotency_key, module, entity, entity_id, label, method, path, payload, state, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      `m${i}`, USER.id, `k${i}`, 'tasks', 'task', String(i), `Change ${i}`, 'POST', '/api/tasks', vault.encrypt({ body: { i } }), 'PENDING', i, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
    );
  }
  db.run('INSERT INTO drafts (id, user_id, module, context, content, updated_at) VALUES (?, ?, ?, ?, ?, ?)', 'd1', USER.id, 'mail', 'new', vault.encrypt({ body: 'hi' }), '2026-10-01T00:00:00.000Z');
  db.run('INSERT INTO sync_folders (id, user_id, folder_id, folder_name, local_path, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'f1', USER.id, 4, 'Projects', join(root, 'Drive'), 'two-way', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
  db.close();
  if (o.guest) writeFileSync(join(paths.dir, 'guest-workspace.sqlite'), 'guest-data');
  return secrets;
}

function sha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(root: string, secrets: Map<string, string> | null, trusted: TrustedConfig | null = null) {
  const appDb = openAppDb(join(root, 'app.db'));
  const registry = new AccountRegistry(appDb);
  const result = migrateAccounts({ userData: root, appDb, registry, readLegacySecret: (n) => (secrets ? (secrets.get(n) ?? null) : null), trusted });
  return { appDb, registry, result, close: () => appDb.close() };
}

function counts(root: string) {
  const db = new Database(profilePaths(root, DEFAULT_PROFILE_DIR).database);
  try {
    return {
      queue: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM offline_mutations')!.n,
      drafts: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM drafts')!.n,
      sync: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_folders')!.n,
      installId: db.getConfig<string>('install-id'),
      server: db.getConfig<{ origin: string }>('server')?.origin ?? null,
    };
  } finally {
    db.close();
  }
}

describe('migrating the legacy profile into account #1 (§8.2)', () => {
  it('1 · a fresh install has no accounts (the startup selector)', () => {
    const root = userData();
    const m = run(root, null);
    expect(m.registry.list()).toEqual([]);
    expect(m.registry.activeId()).toBeNull();
    expect(m.result.migrated).toBe(true);
    expect(m.appDb.getConfig(APP_KEYS.migrated)).toMatchObject({ v: 1 });
    m.close();
  });

  it('2 · a signed-in Enterprise profile becomes account #1 in place, its data untouched, resuming from the cached bootstrap', () => {
    const root = userData();
    const secrets = legacyProfile(root, { signedIn: true });
    const before = sha(profilePaths(root, DEFAULT_PROFILE_DIR).database);
    const m = run(root, secrets);
    const [a] = m.registry.list();
    expect(m.registry.list()).toHaveLength(1);
    expect(a).toMatchObject({ profileDir: 'default', partition: '', serverOrigin: ORIGIN, apiOrigin: ORIGIN, deployment: 'LEGACY', kind: 'enterprise', signInState: 'signed-in', managed: false });
    expect(a!.user).toMatchObject({ id: '7', name: 'Ann Perera', email: 'ann@ws.example' });
    expect(a!.organizationName).toBe('Livezen Technologies');
    expect(m.registry.activeId()).toBe(a!.id);
    m.close();
    // Never written by the migration.
    expect(sha(profilePaths(root, DEFAULT_PROFILE_DIR).database)).toBe(before);
    expect(counts(root)).toEqual({ queue: 3, drafts: 1, sync: 1, installId: 'install-123', server: ORIGIN });
    // The offline start's cached bootstrap is still readable with the profile's own key.
    const db = new Database(profilePaths(root, DEFAULT_PROFILE_DIR).database);
    const boot = new BootstrapService(db, () => new Vault(Buffer.from(secrets.get('db-key')!, 'base64')), {} as HttpClient, null);
    expect(boot.lastUserId()).toBe('7');
    expect(boot.loadCached('7')?.user.name).toBe('Ann Perera');
    db.close();
  });

  it('3 · a signed-out profile is account #1, signed out', () => {
    const root = userData();
    const m = run(root, legacyProfile(root, { signedIn: false }));
    expect(m.registry.list()[0]!.signInState).toBe('signed-out');
    m.close();
  });

  it('4 · guest only: no account, the guest workspace untouched, and never removed with an account', async () => {
    const root = userData();
    mkdirSync(profilePaths(root, DEFAULT_PROFILE_DIR).dir, { recursive: true });
    const guest = join(profilePaths(root, DEFAULT_PROFILE_DIR).dir, 'guest-workspace.sqlite');
    writeFileSync(guest, 'guest-data');
    const m = run(root, null);
    expect(m.registry.list()).toEqual([]);
    expect(readFileSync(guest, 'utf8')).toBe('guest-data');
    m.close();
  });

  it('5 · legacy and guest together: both survive, and removing account #1 leaves the guest workspace', async () => {
    const root = userData();
    const secrets = legacyProfile(root, { signedIn: true, guest: true });
    const m = run(root, secrets);
    const a = m.registry.list()[0]!;
    const guest = join(profilePaths(root, DEFAULT_PROFILE_DIR).dir, 'guest-workspace.sqlite');
    expect(readFileSync(guest, 'utf8')).toBe('guest-data');
    await removeAccount(
      { userData: root, appDb: m.appDb, registry: m.registry, revoke: async () => undefined, clearStorage: async () => undefined, release: () => undefined, trash: async () => undefined },
      a.id,
      { keepOfflineFiles: true },
    );
    expect(readFileSync(guest, 'utf8')).toBe('guest-data');
    expect(existsSync(profilePaths(root, DEFAULT_PROFILE_DIR).database)).toBe(false);
    m.close();
  });

  it('6 · a managed server other than the stored one adds a managed account and keeps the legacy one; lockServer opens the managed one', () => {
    const root = userData();
    const secrets = legacyProfile(root, { signedIn: true });
    const managed: TrustedConfig = { ...EMPTY_TRUSTED_CONFIG, spkiPins: [], source: 'managed.json', serverUrl: 'https://it.example' };
    const m = run(root, secrets, managed);
    const list = m.registry.list();
    expect(list).toHaveLength(2);
    const legacy = list.find((a) => a.profileDir === 'default')!;
    const it2 = list.find((a) => a.managed)!;
    expect(legacy.serverOrigin).toBe(ORIGIN);
    expect(it2).toMatchObject({ serverOrigin: 'https://it.example', managed: true, profileDir: it2.id, partition: `persist:acct-${it2.id}` });
    expect(m.registry.activeId()).toBe(it2.id);
    // Locked: the legacy account is kept (blocked, not deleted), and stays out of the way at every start.
    m.registry.setActive(legacy.id);
    m.close();
    const again = run(root, secrets, { ...managed, lockServer: true });
    expect(again.registry.list()).toHaveLength(2);
    expect(again.registry.activeId()).toBe(it2.id);
    again.close();
    expect(counts(root).queue).toBe(3);
  });

  it('7 · a crash after the insert but before the marker: the rerun finds exactly one account', () => {
    const root = userData();
    const secrets = legacyProfile(root, { signedIn: true });
    const m = run(root, secrets);
    m.appDb.deleteConfig(APP_KEYS.migrated);
    m.close();
    const again = run(root, secrets);
    expect(again.result.migrated).toBe(true);
    expect(again.registry.list()).toHaveLength(1);
    again.close();
  });

  it('8 · secure storage unavailable (basic_text): signed out, nothing lost', () => {
    const root = userData();
    legacyProfile(root, { signedIn: true });
    const m = run(root, null);
    const a = m.registry.list()[0]!;
    expect(a.signInState).toBe('signed-out');
    expect(a.user?.id).toBe('7');
    m.close();
    expect(counts(root)).toMatchObject({ queue: 3, drafts: 1, sync: 1 });
  });

  it('9 · device preferences read the same from app.db, per-person keys re-keyed to the account', () => {
    const root = userData();
    const m = run(root, legacyProfile(root, { signedIn: true }));
    const id = m.registry.list()[0]!.id;
    const settings = new SettingsService(m.appDb);
    expect(settings.raw()).toMatchObject({ theme: 'dark', hardwareAcceleration: false });
    expect(m.appDb.getConfig(`security_preferences:${id}:7`)).toEqual({ appLockEnabled: true, appLockMinutes: 5 });
    expect(m.appDb.getConfig(`appearance_preferences:${id}:7`)).toEqual({ lightProfile: 'paper' });
    expect(m.appDb.getConfig('interface_languages')).toEqual({ [`${id}:7`]: 'ta', 'https://other.example:9': 'en' });
    expect(m.appDb.getConfig('security_preferences_legacy_owner')).toBe(`${id}:7`);
    expect(m.appDb.getConfig('update_notices')).toEqual(['0.2.250:staged']);
    settings.setUserLanguageScope(id, '7');
    expect(settings.raw()).toMatchObject({ language: 'ta', appLockEnabled: true, appLockMinutes: 5 });
    const row = m.appDb.get<{ bounds: string; maximized: number }>("SELECT bounds, maximized FROM window_layouts WHERE kind = 'main'");
    expect(JSON.parse(row!.bounds)).toEqual({ x: 10, y: 20, width: 1200, height: 800 });
    expect(row!.maximized).toBe(1);
    m.close();
  });

  it('10 · downgrade then upgrade: an older desktop changed the server and user, and account #1 follows the legacy database', () => {
    const root = userData();
    const secrets = legacyProfile(root, { signedIn: true });
    const first = run(root, secrets);
    const id = first.registry.list()[0]!.id;
    first.close();
    // The older desktop ran: another server, another person.
    const db = new Database(profilePaths(root, DEFAULT_PROFILE_DIR).database);
    db.setConfig('server', { origin: 'https://new.example', name: 'New Co', api: 'core', minimumVersion: null, locked: false });
    db.setConfig('last-user', '9');
    db.close();
    const again = run(root, secrets);
    expect(again.result.reconciled).toBe(true);
    expect(again.registry.list()).toHaveLength(1);
    expect(again.registry.get(id)).toMatchObject({ serverOrigin: 'https://new.example', serverName: 'New Co', user: { id: '9' } });
    expect(again.registry.activeId()).toBe(id);
    again.close();
    // And the run after that changes nothing more.
    const third = run(root, secrets);
    expect(third.result).toMatchObject({ migrated: false, reconciled: false });
    third.close();
  });

  it('reads nothing from a profile that is not there', () => {
    expect(readLegacyProfile(join(userData(), 'none.db'), () => null)).toBeNull();
  });
});
