import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.2.41' }, shell: {}, safeStorage: {} }));

import { Database } from '../../../electron/services/db';
import { HttpClient } from '../../../electron/services/http';
import { DriveSync } from '../../../electron/services/sync/engine';
import { FakeDrive } from './fake-drive';

/**
 * What the image editor hears from Drive sync (ENH-03 DSK-02, DSK-03): which bytes reached Drive as which file, and
 * when both copies were kept — so an offline edit's recipe can follow its picture.
 */
const BLOCK = 4 * 1024 * 1024;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function syncing() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-sync-img-'));
  made.push(dir);
  const home = join(dir, 'home');
  mkdirSync(home);
  const drive = new FakeDrive();
  const http = new HttpClient({ fetch: drive.fetch, origin: () => 'https://ws.example', tokens: { accessToken: () => 'session', refresh: async () => 'ok' }, clientHeaders: () => ({}), onReachability: () => undefined, onAuthLost: () => undefined });
  const uploaded: Array<{ fileId: number; version: number; sha256: string; path: string }> = [];
  const conflicted: Array<{ fileId: number | null; copyId: number | null; sha256: string | null; path: string }> = [];
  const sync = new DriveSync({
    db: new Database(join(dir, 'db.sqlite')),
    http,
    platform: process.platform,
    userId: () => '7',
    userName: () => 'Hasarinda',
    deviceToken: () => drive.token,
    allowed: () => ({ ok: true, reason: null }),
    removableAllowed: () => false,
    hash: async (p) => {
      const b = await readFile(p);
      return { sha256: sha(b), bytes: b.length };
    },
    hashBlocks: async (p) => {
      const b = await readFile(p);
      const blocks: string[] = [];
      for (let i = 0; i < b.length; i += BLOCK) blocks.push(sha(b.subarray(i, i + BLOCK)));
      return { sha256: sha(b), bytes: b.length, blocks };
    },
    trash: async (p) => rmSync(p),
    info: () => ({ app_version: '0.2.41', os_version: 'test', hostname: 'test' }),
    audit: () => undefined,
    home: () => home,
    settleMs: 0,
    uploaded: (e) => uploaded.push(e),
    conflicted: (e) => conflicted.push(e),
  });
  sync.attach('7');
  const folder = drive.mkdir('Campaign');
  const pic = drive.put('ella.jpg', folder, 'v1 pixels');
  await sync.add({ folderId: folder, mode: 'two_way', localPath: null });
  await sync.syncNow();
  const root = sync.status().folders[0]!.localPath;
  return { sync, drive, pic, folder, at: (n: string) => join(root, n), uploaded, conflicted };
}

describe('Drive sync tells the image editor', { timeout: 20_000 }, () => {
  it('where a synced picture is, at which version, and whether an edit there goes up', async () => {
    const { sync, pic, at } = await syncing();
    expect(sync.localFile(pic)).toMatchObject({ path: at('ella.jpg'), version: 1, canUpload: true, paused: false });
    expect(sync.localFile(999)).toBeNull();
  });

  it('which bytes went up as the next version', async () => {
    const { sync, pic, at, uploaded, drive } = await syncing();
    writeFileSync(at('ella.jpg'), 'edited offline');
    await sync.syncNow();
    expect(drive.files.get(pic)!.version).toBe(2);
    expect(uploaded).toEqual([expect.objectContaining({ fileId: pic, version: 2, sha256: sha(Buffer.from('edited offline')) })]);
  });

  it('that both copies were kept when Drive moved on, and then where this computer’s copy went up', async () => {
    const { sync, pic, at, uploaded, conflicted, drive } = await syncing();
    writeFileSync(at('ella.jpg'), 'mine');
    drive.edit(pic, 'theirs');
    await sync.syncNow();
    expect(conflicted).toEqual([expect.objectContaining({ fileId: pic, copyId: null, sha256: sha(Buffer.from('mine')) })]);
    const copy = uploaded.find((u) => u.sha256 === sha(Buffer.from('mine')));
    expect(copy && copy.fileId).not.toBe(pic);
  });
});
