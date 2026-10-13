import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { AccountRecord } from '@shared/accounts';
import type { ServerInfo, UserSummary } from '@shared/types';
import type { TrustedConfig } from '@shared/trusted-config';
import { Vault } from '../vault';
import { APP_KEYS, type AppDb } from './app-db';
import { DEFAULT_PROFILE_DIR, profilePaths } from './profile';
import { hostOf, initialsOf, kindForOrigin, newAccountId, uniqueHosts, type AccountRegistry } from './registry';

/**
 * The profile that was there before accounts becomes account #1 (Connection & Startup §1.5). Run at every start,
 * before any service is built, and safe to run again at any point:
 *
 *  1. app.db opened or made; `accounts_migrated` set → straight to reconcile.
 *  2. `profiles/default/worksuite.db` read (READ ONLY — never written here): `config.server`, `last-user`, and the
 *     cached bootstrap for the name shown (decrypted with the profile's `db-key`; skipped quietly without one).
 *  3. A server there → account #1: `profileDir:'default'`, `partition:''`, `deployment:'LEGACY'`, personal on
 *     worksuitecloud.com, signed in when `auth:refresh` is there.
 *  4. The device keys and window places copied into app.db; per-person keys re-keyed from `<origin>:<uid>` to
 *     `<account>:<uid>`. Nothing is copied out of the old database or deleted from it.
 *  5. `active_account` and `accounts_migrated={v:1}` in the same transaction as the insert.
 *  6. Reconcile: an older desktop that ran in between changed the server or user → account #1 follows the legacy
 *     database (it wins).
 * Plus the managed server (§1.7): a managed `server_url` makes (or marks) a `managed:true` account; with
 * `lockServer` it is the one opened.
 */

export interface LegacyProfile {
  server: ServerInfo | null;
  lastUser: string | null;
  user: UserSummary | null;
  /** Device-level keys of `config`, as stored (JSON text). */
  deviceConfig: Array<{ key: string; value: string }>;
  layouts: Array<{ kind: string; display_id: string | null; bounds: string; maximized: number; updated_at: string }>;
}

/** Device-level keys in an account database's `config` (§0 "profiles/default mixes device-level and account-level"). */
const DEVICE_KEYS = new Set(['preferences', 'interface_language_default', 'interface_languages', 'update_notices', 'security_preferences_legacy_owner']);
const DEVICE_PREFIXES = ['appearance_preferences:', 'security_preferences:'];

export function isDeviceKey(key: string): boolean {
  return DEVICE_KEYS.has(key) || DEVICE_PREFIXES.some((p) => key.startsWith(p));
}

function openReadOnly(path: string): DatabaseSync | null {
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
}

function parse<T>(text: string | undefined | null): T | null {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * What the legacy profile holds, read without writing to it. Null when there is no legacy database (a fresh
 * install) or it cannot be read at all.
 */
export function readLegacyProfile(dbPath: string, readSecret: (name: string) => string | null): LegacyProfile | null {
  if (!existsSync(dbPath)) return null;
  const db = openReadOnly(dbPath);
  if (!db) return null;
  try {
    const config = (key: string): string | null => {
      try {
        const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value ?? null;
      } catch {
        return null;
      }
    };
    const server = parse<ServerInfo>(config('server'));
    const lastUser = parse<string>(config('last-user'));
    let deviceConfig: LegacyProfile['deviceConfig'] = [];
    try {
      deviceConfig = (db.prepare('SELECT key, value FROM config').all() as Array<{ key: string; value: string }>).filter((r) => isDeviceKey(r.key));
    } catch {
      deviceConfig = [];
    }
    let layouts: LegacyProfile['layouts'] = [];
    try {
      layouts = db.prepare('SELECT kind, display_id, bounds, maximized, updated_at FROM window_layouts').all() as LegacyProfile['layouts'];
    } catch {
      layouts = [];
    }
    let user: UserSummary | null = null;
    if (lastUser) {
      // For the name on the account only: without the OS store the bootstrap stays sealed, and that is fine.
      try {
        const key = readSecret('db-key');
        const row = key ? (db.prepare('SELECT bootstrap FROM sessions WHERE user_id = ?').get(lastUser) as { bootstrap: string } | undefined) : undefined;
        const b = key && row ? new Vault(Buffer.from(key, 'base64')).decrypt<{ user?: UserSummary }>(row.bootstrap) : undefined;
        user = b?.user ?? null;
      } catch {
        user = null;
      }
    }
    return { server: server && typeof server.origin === 'string' ? server : null, lastUser: typeof lastUser === 'string' ? lastUser : null, user, deviceConfig, layouts };
  } finally {
    try {
      db.close();
    } catch {
      /* closed */
    }
  }
}

/** `<origin>:<uid>` → `<account>:<uid>` in a key's scope, for account #1's origin only. */
export function rekeyScope(scope: string, origin: string, accountId: string): string {
  return scope.startsWith(`${origin}:`) ? `${accountId}:${scope.slice(origin.length + 1)}` : scope;
}

function rekeyDeviceRow(key: string, value: string, origin: string | null, accountId: string | null): { key: string; value: string } {
  if (!origin || !accountId) return { key, value };
  for (const prefix of DEVICE_PREFIXES) {
    if (key.startsWith(prefix)) return { key: prefix + rekeyScope(key.slice(prefix.length), origin, accountId), value };
  }
  if (key === 'interface_languages') {
    const map = parse<Record<string, string>>(value);
    if (map && typeof map === 'object') {
      const out: Record<string, string> = {};
      for (const [scope, lang] of Object.entries(map)) out[rekeyScope(scope, origin, accountId)] = lang;
      return { key, value: JSON.stringify(out) };
    }
  }
  if (key === 'security_preferences_legacy_owner') {
    const owner = parse<string>(value);
    if (typeof owner === 'string') return { key, value: JSON.stringify(rekeyScope(owner, origin, accountId)) };
  }
  return { key, value };
}

export function legacyAccountRecord(legacy: LegacyProfile & { server: ServerInfo }, signedIn: boolean, now: Date, id = newAccountId()): AccountRecord {
  const origin = legacy.server.origin;
  const host = hostOf(origin);
  const user = legacy.user;
  return {
    id,
    kind: kindForOrigin(origin),
    serverOrigin: origin,
    apiOrigin: origin,
    serverId: null,
    serverName: legacy.server.name || host || origin,
    deployment: 'LEGACY',
    organizationId: user?.organizationId ?? null,
    organizationName: user?.organizationName ?? null,
    user: user ? { id: String(user.id), name: user.name, email: user.email, avatar: user.avatar ?? null } : legacy.lastUser ? { id: legacy.lastUser, name: '', email: '', avatar: null } : null,
    branding: { logo: null, accent: null, initials: initialsOf(legacy.server.name || host || 'WorkSuite') },
    linkHosts: uniqueHosts([host, ...(legacy.server.linkHosts ?? [])]),
    profileDir: DEFAULT_PROFILE_DIR,
    partition: '',
    managed: legacy.server.locked === true,
    trust: null,
    signInState: signedIn && legacy.lastUser ? 'signed-in' : 'signed-out',
    addedAt: now.toISOString(),
    lastUsedAt: now.toISOString(),
    discoveredAt: null,
    signed: false,
  };
}

export interface MigrateDeps {
  userData: string;
  appDb: AppDb;
  registry: AccountRegistry;
  /** A secret from `profiles/default/secrets.json`; null when it is not there or the OS store is not available. */
  readLegacySecret: (name: string) => string | null;
  /** This computer's managed configuration (registry, MDM, managed.json…); null or `source:null` for none. */
  trusted?: TrustedConfig | null;
  now?: () => Date;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface MigrateResult {
  /** This run moved the legacy profile into the registry. */
  migrated: boolean;
  /** Account #1 was brought up to date with the legacy database (an older desktop ran in between). */
  reconciled: boolean;
  /** Account #1, when there is one. */
  legacyId: string | null;
  /** The managed account, when IT configured a server. */
  managedId: string | null;
}

/** Normalises a managed `server_url` to an https origin, or null. */
export function managedOrigin(url: string | null | undefined, allowInsecureLocal = false): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(allowInsecureLocal && local && u.protocol === 'http:')) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function migrateAccounts(deps: MigrateDeps): MigrateResult {
  const now = deps.now ?? (() => new Date());
  const { appDb, registry } = deps;
  const log = deps.log ?? (() => undefined);
  const legacyPaths = profilePaths(deps.userData, DEFAULT_PROFILE_DIR);
  const legacy = readLegacyProfile(legacyPaths.database, (name) => safely(() => deps.readLegacySecret(name)));
  const signedIn = (): boolean => safely(() => deps.readLegacySecret('auth:refresh')) !== null;
  let migrated = false;
  let reconciled = false;

  if (!appDb.getConfig(APP_KEYS.migrated)) {
    appDb.tx(() => {
      // A run that stopped before its marker (a crash) left account #1 behind: it is the one, never a second.
      let first = registry.byProfile(DEFAULT_PROFILE_DIR);
      if (!first && legacy?.server) {
        first = registry.insert(legacyAccountRecord({ ...legacy, server: legacy.server }, signedIn(), now()));
      }
      // Device keys and window places: copied, never moved; what app.db has already stays.
      const origin = legacy?.server?.origin ?? null;
      for (const row of legacy?.deviceConfig ?? []) {
        const { key, value } = rekeyDeviceRow(row.key, row.value, origin, first?.id ?? null);
        appDb.run('INSERT OR IGNORE INTO config (key, value, updated_at) VALUES (?, ?, ?)', key, value, now().toISOString());
      }
      for (const l of legacy?.layouts ?? []) {
        appDb.run('INSERT OR IGNORE INTO window_layouts (kind, display_id, bounds, maximized, updated_at) VALUES (?, ?, ?, ?, ?)', l.kind, l.display_id, l.bounds, l.maximized, l.updated_at);
      }
      if (first && !appDb.getConfig(APP_KEYS.activeAccount)) appDb.setConfig(APP_KEYS.activeAccount, first.id);
      appDb.setConfig(APP_KEYS.migrated, { v: 1, at: now().toISOString() });
    });
    migrated = true;
    log('legacy profile migrated', { account: !!registry.byProfile(DEFAULT_PROFILE_DIR) });
  }

  // Reconcile, every start: the legacy database wins.
  let first = registry.byProfile(DEFAULT_PROFILE_DIR);
  if (legacy?.server) {
    if (!first) {
      first = registry.insert(legacyAccountRecord({ ...legacy, server: legacy.server }, signedIn(), now()));
      if (!registry.activeId()) registry.setActive(first.id);
      reconciled = true;
    } else if (first.serverOrigin !== legacy.server.origin) {
      const fresh = legacyAccountRecord({ ...legacy, server: legacy.server }, signedIn(), now(), first.id);
      first = registry.update(first.id, { ...fresh, addedAt: first.addedAt, managed: first.managed || fresh.managed }) ?? first;
      reconciled = true;
    } else if (legacy.lastUser && first.user?.id !== legacy.lastUser) {
      const fresh = legacyAccountRecord({ ...legacy, server: legacy.server }, signedIn(), now(), first.id);
      first = registry.update(first.id, { user: fresh.user, organizationId: fresh.organizationId, organizationName: fresh.organizationName, signInState: fresh.signInState }) ?? first;
      reconciled = true;
    }
    if (reconciled) log('account #1 reconciled with the legacy profile', { id: first.id });
  }

  const managedId = applyManaged(deps, now);
  return { migrated, reconciled, legacyId: first?.id ?? null, managedId };
}

function applyManaged(deps: MigrateDeps, now: () => Date): string | null {
  const t = deps.trusted;
  if (!t || !t.source || t.source === 'setup-link') return null;
  const origin = managedOrigin(t.serverUrl);
  if (!origin) return null;
  const { registry } = deps;
  let account = registry.findServer({ origin });
  if (account) {
    if (!account.managed || JSON.stringify(account.trust) !== JSON.stringify(t)) account = registry.update(account.id, { managed: true, trust: t }) ?? account;
  } else {
    const host = hostOf(origin);
    const id = newAccountId();
    const fresh = !registry.byProfile(DEFAULT_PROFILE_DIR) && !registry.list().length;
    account = registry.insert({
      id,
      kind: kindForOrigin(origin),
      serverOrigin: origin,
      apiOrigin: origin,
      serverId: null,
      serverName: host ?? origin,
      deployment: 'LEGACY',
      organizationId: t.organizationId,
      organizationName: null,
      user: null,
      branding: { logo: null, accent: null, initials: initialsOf(host ?? 'WorkSuite') },
      linkHosts: uniqueHosts([host]),
      profileDir: fresh ? DEFAULT_PROFILE_DIR : id,
      partition: fresh ? '' : `persist:acct-${id}`,
      managed: true,
      trust: t,
      signInState: 'signed-out',
      addedAt: now().toISOString(),
      lastUsedAt: null,
      discoveredAt: null,
      signed: false,
    });
    // IT's server replaces whatever was open (FR-AUTH-01); the account that was there is kept.
    registry.setActive(account.id);
    deps.log?.('managed account added', { id: account.id });
    return account.id;
  }
  // Locked to IT's server: another enterprise account is never the one opened (it stays, blocked, not deleted).
  const active = registry.active();
  if (t.lockServer && (!active || (active.id !== account.id && active.kind === 'enterprise'))) registry.setActive(account.id);
  return account.id;
}

function safely<T>(fn: () => T | null): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
