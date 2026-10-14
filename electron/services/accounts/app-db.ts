import { join } from 'node:path';
import { Database } from '../db';

/**
 * `userData/app.db`, the computer's own database (Connection & Startup §1.1, §1.2): the accounts registry, the
 * device preferences (theme, language, hardware acceleration, update notices…), window places, and the partitions
 * waiting to be removed. Each account's own data stays in its profile's `worksuite.db`.
 *
 * The same `Database` class with its own schema, so `SettingsService` and `WindowManager` read it unchanged: a
 * `config` key/value table, and `window_layouts` as the account database has it.
 */
export const APP_DB_MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    sort INTEGER NOT NULL,
    record TEXT NOT NULL,             -- AccountRecord, JSON (no secrets: those are in the profile's secrets.json)
    updated_at TEXT NOT NULL
  );

  CREATE TABLE window_layouts (
    kind TEXT PRIMARY KEY,
    display_id TEXT,
    bounds TEXT NOT NULL,
    maximized INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  -- What Chromium or another process held while the app ran: removed at the next start, before any window opens.
  CREATE TABLE pending_removals (
    path TEXT NOT NULL,
    partition TEXT,
    queued_at TEXT NOT NULL,
    PRIMARY KEY (path)
  );
  `,
];

export type AppDb = Database;

export function appDbPath(userData: string): string {
  return join(userData, 'app.db');
}

export function openAppDb(path: string): AppDb {
  return new Database(path, { migrations: APP_DB_MIGRATIONS });
}

/** Config keys in app.db. */
export const APP_KEYS = {
  activeAccount: 'active_account',
  migrated: 'accounts_migrated',
  chooserAlways: 'chooser_always',
} as const;
