import { randomBytes } from 'node:crypto';
import { ACCOUNT_ID, type AccountKind, type AccountRecord } from '@shared/accounts';
import type { DiscoveredServer } from '@shared/discovery';
import type { TrustedConfig } from '@shared/trusted-config';
import { APP_KEYS, type AppDb } from './app-db';
import { DEFAULT_PROFILE_DIR } from './profile';

/**
 * The accounts on this computer (Connection & Startup §1.2), in `app.db`:
 *
 *   accounts(id TEXT PK, sort INTEGER, record TEXT JSON, updated_at)
 *   config: active_account, accounts_migrated, chooser_always
 *
 * Plain records; no secrets (those stay in each profile's secrets.json).
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newAccountId(): string {
  const bytes = randomBytes(20);
  let id = 'acc_';
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}

/** WorkSuite Cloud's host, or one under it: a Personal account. */
export function isCloudHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'worksuitecloud.com' || h.endsWith('.worksuitecloud.com');
}

export function kindForOrigin(origin: string): AccountKind {
  try {
    return isCloudHost(new URL(origin).hostname) ? 'personal' : 'enterprise';
  } catch {
    return 'enterprise';
  }
}

/** Up to two letters for the account's badge: "Livezen Technologies" → "LT", "acme.example" → "AC". */
export function initialsOf(name: string): string {
  const words = name
    .replace(/^https?:\/\//, '')
    .split(/[\s._-]+/)
    .filter((w) => /[A-Za-z0-9]/.test(w));
  if (!words.length) return 'WS';
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[1]![0]}`;
  return letters.toUpperCase();
}

export function hostOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export class AccountRegistry {
  private listeners = new Set<() => void>();

  constructor(
    private readonly db: AppDb,
    private readonly now: () => Date = () => new Date(),
  ) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* a listener's trouble is its own */
      }
    }
  }

  list(): AccountRecord[] {
    return this.db
      .all<{ record: string }>('SELECT record FROM accounts ORDER BY sort ASC, id ASC')
      .map((r) => parseRecord(r.record))
      .filter((r): r is AccountRecord => r !== null);
  }

  get(id: string): AccountRecord | null {
    const row = this.db.get<{ record: string }>('SELECT record FROM accounts WHERE id = ?', id);
    return row ? parseRecord(row.record) : null;
  }

  byProfile(profileDir: string): AccountRecord | null {
    return this.list().find((a) => a.profileDir === profileDir) ?? null;
  }

  /** The account already added for this server (and organization, when the server names one). */
  findServer(server: { origin: string; serverId?: string | null }, organizationId: string | null = null): AccountRecord | null {
    const host = hostOf(server.origin);
    return (
      this.list().find((a) => {
        const same = (server.serverId && a.serverId && a.serverId === server.serverId) || a.serverOrigin === server.origin || a.apiOrigin === server.origin || (!!host && hostOf(a.serverOrigin) === host);
        if (!same) return false;
        return organizationId === null || a.organizationId === null || a.organizationId === organizationId;
      }) ?? null
    );
  }

  activeId(): string | null {
    const id = this.db.getConfig<string>(APP_KEYS.activeAccount);
    return typeof id === 'string' && this.get(id) ? id : null;
  }

  active(): AccountRecord | null {
    const id = this.activeId();
    return id ? this.get(id) : null;
  }

  setActive(id: string | null): void {
    if (id === null) this.db.deleteConfig(APP_KEYS.activeAccount);
    else {
      if (!this.get(id)) throw new Error(`no account ${id}`);
      this.db.setConfig(APP_KEYS.activeAccount, id);
      this.touch(id);
    }
    this.changed();
  }

  /** Marks an account as just used (the chooser's order, "last used"). */
  touch(id: string): void {
    const r = this.get(id);
    if (r) this.write({ ...r, lastUsedAt: this.now().toISOString() });
  }

  insert(record: AccountRecord): AccountRecord {
    if (!ACCOUNT_ID.test(record.id)) throw new Error(`not an account id: ${record.id}`);
    const sort = (this.db.get<{ n: number | null }>('SELECT MAX(sort) AS n FROM accounts')?.n ?? 0) + 1;
    this.db.run('INSERT INTO accounts (id, sort, record, updated_at) VALUES (?, ?, ?, ?)', record.id, sort, JSON.stringify(record), this.now().toISOString());
    this.changed();
    return record;
  }

  update(id: string, patch: Partial<Omit<AccountRecord, 'id'>>): AccountRecord | null {
    const r = this.get(id);
    if (!r) return null;
    const next = { ...r, ...patch, id };
    this.write(next);
    this.changed();
    return next;
  }

  private write(r: AccountRecord): void {
    this.db.run('UPDATE accounts SET record = ?, updated_at = ? WHERE id = ?', JSON.stringify(r), this.now().toISOString(), r.id);
  }

  remove(id: string): void {
    this.db.run('DELETE FROM accounts WHERE id = ?', id);
    if (this.db.getConfig<string>(APP_KEYS.activeAccount) === id) this.db.deleteConfig(APP_KEYS.activeAccount);
    this.changed();
  }

  chooserAlways(): boolean {
    return this.db.getConfig<boolean>(APP_KEYS.chooserAlways) === true;
  }

  setChooserAlways(on: boolean): void {
    this.db.setConfig(APP_KEYS.chooserAlways, on);
    this.changed();
  }

  /**
   * A new account's record from a connect run (`connect:confirm`): signed out, its own profile folder and partitions
   * — or account #1's (`profiles/default`, the default session) when that place is free: on a computer where no
   * account was ever added, so the first one opens in the window already showing.
   */
  build(server: DiscoveredServer, kind: AccountKind, trust: TrustedConfig | null, opts: { useDefaultProfile: boolean; managed?: boolean; id?: string }): AccountRecord {
    const id = opts.id && ACCOUNT_ID.test(opts.id) && !this.get(opts.id) ? opts.id : newAccountId();
    const first = opts.useDefaultProfile && !this.byProfile(DEFAULT_PROFILE_DIR);
    const host = hostOf(server.origin);
    return {
      id,
      kind,
      serverOrigin: server.origin,
      apiOrigin: server.apiOrigin || server.origin,
      serverId: server.serverId,
      serverName: server.name || host || server.origin,
      deployment: server.deployment,
      organizationId: trust?.organizationId ?? null,
      organizationName: null,
      user: null,
      branding: { logo: server.branding.logo, accent: server.branding.accent, initials: initialsOf(server.name || host || 'WorkSuite') },
      linkHosts: uniqueHosts([host, ...server.linkHosts]),
      profileDir: first ? DEFAULT_PROFILE_DIR : id,
      partition: first ? '' : `persist:acct-${id}`,
      managed: opts.managed === true,
      trust,
      signInState: 'signed-out',
      addedAt: this.now().toISOString(),
      lastUsedAt: null,
      discoveredAt: this.now().toISOString(),
      signed: server.signed,
    };
  }
}

export function uniqueHosts(hosts: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const h of hosts) {
    const v = (h ?? '').trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function parseRecord(text: string): AccountRecord | null {
  try {
    const r = JSON.parse(text) as AccountRecord;
    return r && typeof r === 'object' && typeof r.id === 'string' ? r : null;
  } catch {
    return null;
  }
}
