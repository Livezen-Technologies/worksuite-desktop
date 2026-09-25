import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where WorkSuite keeps its local state. Everything lives under the OS
 * application-data directory; nothing is written next to the executable or
 * into the user's documents (except downloads, which go where they choose).
 *
 * One profile today. FR-SHL-07 (P4) adds more — one directory per server
 * account — which is why the database and secrets sit in a profile folder.
 */
export interface Paths {
  userData: string;
  profile: string;
  database: string;
  secrets: string;
  logs: string;
  updates: string;
  crashState: string;
  runningMarker: string;
  bootConfig: string;
}

let cached: Paths | null = null;

export function paths(): Paths {
  if (cached) return cached;
  const userData = app.getPath('userData');
  const profile = join(userData, 'profiles', 'default');
  const logs = join(userData, 'logs');
  const updates = join(userData, 'updates');
  for (const dir of [profile, logs, updates]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  cached = {
    userData,
    profile,
    database: join(profile, 'worksuite.db'),
    secrets: join(profile, 'secrets.json'),
    logs,
    updates,
    crashState: join(userData, 'crash-state.json'),
    runningMarker: join(userData, 'running.lock'),
    // Read before the app is ready (hardware acceleration must be decided
    // then), so it cannot live in the database.
    bootConfig: join(userData, 'boot.json'),
  };
  return cached;
}
