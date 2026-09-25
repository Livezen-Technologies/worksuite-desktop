import { DatabaseSync } from 'node:sqlite';

/**
 * The per-profile SQLite database (§7.2), opened only in the main process —
 * the renderer never touches it. Sensitive columns hold Vault ciphertext.
 *
 * node:sqlite ships inside Electron's Node, so there is no native module to
 * rebuild per platform and architecture.
 *
 * synchronous=FULL: a queued mutation or a draft is acknowledged to the user
 * only after it is on disk (NFR-REL-02).
 */
const MIGRATIONS: string[] = [
  // 1 — Phase 1 schema.
  `
  CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    user_id TEXT PRIMARY KEY,
    bootstrap TEXT NOT NULL,          -- enc
    cached_at TEXT NOT NULL
  );

  CREATE TABLE cached_records (
    key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    module TEXT NOT NULL,
    path TEXT NOT NULL,
    payload TEXT NOT NULL,            -- enc
    etag TEXT,
    bytes INTEGER NOT NULL,
    cached_at TEXT NOT NULL,
    accessed_at TEXT NOT NULL
  );
  CREATE INDEX cached_records_user ON cached_records(user_id, module);
  CREATE INDEX cached_records_accessed ON cached_records(accessed_at);

  CREATE TABLE offline_mutations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    module TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    label TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    payload TEXT NOT NULL,            -- enc
    base_etag TEXT,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    response TEXT,                    -- enc
    seq INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    next_attempt_at TEXT
  );
  CREATE INDEX offline_mutations_state ON offline_mutations(user_id, state, seq);

  CREATE TABLE drafts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    module TEXT NOT NULL,
    context TEXT NOT NULL,
    content TEXT NOT NULL,            -- enc
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, module, context)
  );

  CREATE TABLE notification_cache (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    module TEXT NOT NULL,
    payload TEXT NOT NULL,            -- enc: title, body, actor, link
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE tab_sessions (
    user_id TEXT NOT NULL,
    window TEXT NOT NULL,
    payload TEXT NOT NULL,            -- enc
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, window)
  );

  CREATE TABLE window_layouts (
    kind TEXT PRIMARY KEY,
    display_id TEXT,
    bounds TEXT NOT NULL,
    maximized INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE transfers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    name TEXT NOT NULL,
    meta TEXT NOT NULL,               -- enc: source, destination, server ids
    bytes INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE realtime_cursors (
    channel TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE audit_outbox (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    details TEXT NOT NULL,            -- enc
    created_at TEXT NOT NULL,
    sent_at TEXT
  );
  `,
];

export type Row = Record<string, unknown>;

export class Database {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA synchronous = FULL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 3000;');
    this.migrate();
  }

  private migrate(): void {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    const current = row.user_version;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(MIGRATIONS[v]!);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
        this.raw.exec('COMMIT');
      } catch (e) {
        this.raw.exec('ROLLBACK');
        throw e;
      }
    }
  }

  get version(): number {
    return (this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  }

  run(sql: string, ...params: Array<string | number | null>): { changes: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  }

  get<T = Row>(sql: string, ...params: Array<string | number | null>): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: Array<string | number | null>): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  integrityCheck(): string {
    const r = this.raw.prepare('PRAGMA quick_check').get() as Record<string, string>;
    return Object.values(r)[0] ?? 'unknown';
  }

  close(): void {
    try {
      this.raw.close();
    } catch {
      /* already closed */
    }
  }

  // Small key/value helpers over `config` (not encrypted: no secrets here).
  getConfig<T>(key: string): T | undefined {
    const row = this.get<{ value: string }>('SELECT value FROM config WHERE key = ?', key);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  setConfig(key: string, value: unknown): void {
    this.run(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      key,
      JSON.stringify(value),
      new Date().toISOString(),
    );
  }

  deleteConfig(key: string): void {
    this.run('DELETE FROM config WHERE key = ?', key);
  }
}
