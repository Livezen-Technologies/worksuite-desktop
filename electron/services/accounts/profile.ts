import { join } from 'node:path';
import type { AccountRecord } from '@shared/accounts';

/**
 * Where an account keeps its data on this computer (Connection & Startup §1.1). Nothing is moved: account #1 is the
 * existing `profiles/default/`, so an older desktop can still open it, and each account added later gets
 * `profiles/<its id>/`.
 *
 *   profiles/<dir>/worksuite.db, secrets.json, elearning/, PDF/, pos-thumbs/      ← the account's
 *   profiles/default/guest-workspace.sqlite, guest-move-backup.json, LocalAI/speech ← the computer's, never removed
 */

/** The folder name account #1 (the profile that was there before accounts) keeps. */
export const DEFAULT_PROFILE_DIR = 'default';

export interface ProfilePaths {
  /** `userData/profiles/<dir>`. */
  dir: string;
  database: string;
  secrets: string;
  elearning: string;
  pdf: string;
  posThumbs: string;
}

export function profilePaths(userData: string, profileDir: string): ProfilePaths {
  if (!/^(default|acc_[a-z0-9]{20})$/.test(profileDir)) throw new Error(`not a profile folder: ${profileDir}`);
  const dir = join(userData, 'profiles', profileDir);
  return {
    dir,
    database: join(dir, 'worksuite.db'),
    secrets: join(dir, 'secrets.json'),
    elearning: join(dir, 'elearning'),
    pdf: join(dir, 'PDF'),
    posThumbs: join(dir, 'pos-thumbs'),
  };
}

/**
 * What in `profiles/default/` is account #1's, and goes when account #1 is removed from this computer. Everything
 * else there — the guest workspace, its move backup, Local AI's speech models — is the computer's and stays.
 */
export const DEFAULT_PROFILE_ACCOUNT_FILES: readonly string[] = [
  'worksuite.db',
  'worksuite.db-wal',
  'worksuite.db-shm',
  'secrets.json',
  'secrets.json.tmp',
  'elearning',
  'PDF',
  'pos-thumbs',
];

/** Kept with the computer, whatever happens to account #1. */
export const DEFAULT_PROFILE_DEVICE_FILES: readonly string[] = ['guest-workspace.sqlite', 'guest-move-backup.json', 'LocalAI'];

/** The Electron partitions an account's windows and network use (§1.1 "Electron partitions"). */
export interface AccountPartitions {
  /** Windows: '' is `session.defaultSession` (account #1, and guest mode). */
  shell: string;
  /** API traffic. */
  net: string;
  /** Uploads, downloads, mail bodies fetched ahead (#252). */
  bulk: string;
}

export function partitionsFor(record: Pick<AccountRecord, 'id' | 'partition'>): AccountPartitions {
  if (record.partition === '') return { shell: '', net: 'persist:ws-net', bulk: 'persist:ws-bulk' };
  return { shell: `persist:acct-${record.id}`, net: `persist:acct-${record.id}-net`, bulk: `persist:acct-${record.id}-bulk` };
}

/** Every partition of an account, the shell's first. */
export function allPartitions(record: Pick<AccountRecord, 'id' | 'partition'>): string[] {
  const p = partitionsFor(record);
  return [p.shell, p.net, p.bulk];
}

/**
 * Where Chromium keeps a `persist:` partition on disk, for removal once nothing holds it (`pending_removals`). The
 * default session's storage is userData itself, which is never removed.
 */
export function partitionDir(userData: string, partition: string): string | null {
  if (!partition.startsWith('persist:')) return null;
  const name = partition.slice('persist:'.length);
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
  return join(userData, 'Partitions', name);
}

/**
 * The default Drive sync folder for an account: `~/WorkSuite Drive` for account #1, `~/WorkSuite Drive (<label>)`
 * for the others, the label made safe for a folder name.
 */
export function driveRootName(record: Pick<AccountRecord, 'profileDir' | 'serverName' | 'organizationName'> | null): string {
  if (!record || record.profileDir === DEFAULT_PROFILE_DIR) return 'WorkSuite Drive';
  // eslint-disable-next-line no-control-regex
  const label = (record.organizationName || record.serverName || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return label ? `WorkSuite Drive (${label})` : 'WorkSuite Drive (2)';
}
