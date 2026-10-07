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
  // 2 — Drive sync: the folders kept in step, and what each side last agreed on.
  // Paths are not encrypted: they name files that sit in plain sight in the folder itself.
  `
  CREATE TABLE sync_folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    folder_id INTEGER,                -- NULL: the whole of My Drive
    folder_name TEXT NOT NULL,
    local_path TEXT NOT NULL,
    mode TEXT NOT NULL,
    paused INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX sync_folders_user ON sync_folders(user_id);

  CREATE TABLE sync_entries (
    folder TEXT NOT NULL REFERENCES sync_folders(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    rel TEXT NOT NULL,
    kind TEXT NOT NULL,
    remote_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    sha256 TEXT,
    size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL,
    ino TEXT,
    PRIMARY KEY (folder, key)
  );
  CREATE INDEX sync_entries_remote ON sync_entries(kind, remote_id);
  `,
  // 3 — SalonMate: the desk's copy of its day, and what the counter did while
  // WorkSuite was out of reach. Each is kept per server, desk and person.
  `
  CREATE TABLE salon_copy (
    origin TEXT NOT NULL,
    desk_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    payload TEXT NOT NULL,            -- enc: visits, clients, menu, settings
    since TEXT,
    after INTEGER,
    refreshed_at TEXT NOT NULL,
    pulled_at TEXT NOT NULL,
    PRIMARY KEY (origin, desk_id, user_id)
  );

  CREATE TABLE salon_outbox (
    id TEXT PRIMARY KEY,
    origin TEXT NOT NULL,
    desk_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    state TEXT NOT NULL,
    item TEXT NOT NULL,               -- enc: key, payload, what the server said
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX salon_outbox_desk ON salon_outbox(origin, desk_id, user_id, seq);
  `,
  // 4 — eLearning's offline copies: per person and course, what the server's
  // manifest listed and each file's own key (the files themselves are sealed
  // under that key in the profile's elearning/ folder).
  `
  CREATE TABLE elearning_offline (
    user_id TEXT NOT NULL,
    course_id INTEGER NOT NULL,
    meta TEXT NOT NULL,               -- enc: title, version, licence, files with their keys
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, course_id)
  );
  `,
  // 5 — WorkSuite Events' desk: the device's offline copy of an event (its
  // gate's tickets, as HMACs under the device key), per server, event and
  // person, and the scans made while WorkSuite was out of reach, in the
  // device's own sequence (electron/services/event-desk.ts).
  `
  CREATE TABLE event_desk_copy (
    origin TEXT NOT NULL,
    event_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    device_id INTEGER NOT NULL,
    payload TEXT NOT NULL,            -- enc: the event, gate, rules, ticket types and registrations
    refreshed_at TEXT NOT NULL,
    pulled_at TEXT NOT NULL,
    PRIMARY KEY (origin, event_id, user_id)
  );

  CREATE TABLE event_desk_queue (
    client_uuid TEXT PRIMARY KEY,
    origin TEXT NOT NULL,
    event_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    device_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    state TEXT NOT NULL,
    item TEXT NOT NULL,               -- enc: the item as sent, what the desk showed, what the server said
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX event_desk_queue_event ON event_desk_queue(origin, event_id, user_id, seq);
  `,
  // 6 — POS: this computer as a till. Its copy of the catalogue, per server and till; its sales — the outbox and,
  // once sent, the history receipts are reprinted from — and each pairing's receipt counter
  // (electron/services/pos-till.ts). They are the till's, not a person's: a sign-out keeps them, a wipe does not.
  `
  CREATE TABLE pos_catalogue (
    origin TEXT NOT NULL,
    terminal_id INTEGER NOT NULL,
    version TEXT NOT NULL,
    payload TEXT NOT NULL,            -- enc: products, prices, barcodes
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (origin, terminal_id)
  );

  CREATE TABLE pos_sales (
    ref TEXT NOT NULL,
    origin TEXT NOT NULL,
    terminal_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    state TEXT NOT NULL,
    session_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    item TEXT NOT NULL,               -- enc: the sale — lines, customer, tenders — and what the server said
    updated_at TEXT NOT NULL,
    PRIMARY KEY (origin, ref)
  );
  CREATE INDEX pos_sales_till ON pos_sales(origin, terminal_id, state, seq);

  CREATE TABLE pos_counters (
    origin TEXT NOT NULL,
    prefix TEXT NOT NULL,
    last INTEGER NOT NULL,
    PRIMARY KEY (origin, prefix)
  );
  `,
  // 7 — POS's catalogue copy one product a row (worksuite-desktop#296), so what changed since the last sync is applied
  // a row at a time instead of the whole copy sealed again: `pos_catalogue` keeps the copy's head (version, cursor,
  // categories, tenders), `pos_products` its products. The codes a scan looks up and the category are plain (they are
  // printed on the goods); the product itself — name, price, tax, stock — is sealed. `gen` is the whole download a row
  // came from: one that finishes drops the rows of the one before. A copy kept as one sealed blob before this is split
  // into rows the first time it is read (pos-catalogue.ts). `pos_thumbs` is the products' small pictures kept for
  // offline, by size, the least recently shown dropped first.
  `
  CREATE TABLE pos_products (
    origin TEXT NOT NULL,
    terminal_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    gen INTEGER NOT NULL,
    barcode TEXT,
    code TEXT,
    category_id TEXT,
    payload TEXT NOT NULL,            -- enc: the product (name, price, tax, stock, picture, badge)
    updated_at TEXT NOT NULL,
    PRIMARY KEY (origin, terminal_id, product_id)
  );
  CREATE INDEX pos_products_barcode ON pos_products(origin, terminal_id, barcode);
  CREATE INDEX pos_products_code ON pos_products(origin, terminal_id, code);

  CREATE TABLE pos_thumbs (
    origin TEXT NOT NULL,
    terminal_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    used_at TEXT NOT NULL,
    PRIMARY KEY (origin, terminal_id, product_id)
  );
  CREATE INDEX pos_thumbs_used ON pos_thumbs(used_at);
  `,
];

export type Row = Record<string, unknown>;

export class Database {
  readonly raw: DatabaseSync;
  private closed = false;
  /** The schema version this start found, before its migrations ran ("What's New" after an update says what changed). */
  migratedFrom = 0;

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
    this.migratedFrom = current;
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

  /*
   * After close (the app is quitting) a late timer or window event may still
   * ask: it gets nothing back rather than an exception, which the main process
   * would otherwise show as an error dialog on the way out.
   */
  run(sql: string, ...params: Array<string | number | null>): { changes: number } {
    if (this.closed) return { changes: 0 };
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  }

  get<T = Row>(sql: string, ...params: Array<string | number | null>): T | undefined {
    if (this.closed) return undefined;
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: Array<string | number | null>): T[] {
    if (this.closed) return [];
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get isClosed(): boolean {
    return this.closed;
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
    this.closed = true;
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
