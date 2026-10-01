import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.2.41' }, shell: {}, safeStorage: {} }));

import { Database } from '../../../electron/services/db';
import { HttpClient } from '../../../electron/services/http';
import { DriveSync } from '../../../electron/services/sync/engine';
import { FakeDrive } from './fake-drive';

const BLOCK = 4 * 1024 * 1024;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-sync-'));
  made.push(dir);
  const home = join(dir, 'home');
  mkdirSync(home);
  const db = new Database(join(dir, 'db.sqlite'));
  const drive = new FakeDrive();
  const http = new HttpClient({ fetch: drive.fetch, origin: () => 'https://ws.example', tokens: { accessToken: () => 'session', refresh: async () => 'ok' }, clientHeaders: () => ({}), onReachability: () => undefined, onAuthLost: () => undefined });
  const trashed: string[] = [];
  const sync = new DriveSync({
    db,
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
    trash: async (p) => {
      trashed.push(p);
      rmSync(p);
    },
    info: () => ({ app_version: '0.2.41', os_version: 'test', hostname: 'test' }),
    audit: () => undefined,
    home: () => home,
    settleMs: 0,
  });
  sync.attach('7');
  return { dir, home, db, drive, sync, trashed };
}

async function syncing(folderName = 'Tenders', mode: 'two_way' | 'upload_only' | 'download_only' = 'two_way') {
  const s = setup();
  const folder = s.drive.mkdir(folderName);
  const bids = s.drive.mkdir('Bids', folder);
  const a = s.drive.put('a.txt', folder, 'alpha');
  const b = s.drive.put('b.txt', bids, 'bravo');
  await s.sync.add({ folderId: folder, mode, localPath: null });
  await s.sync.syncNow();
  const root = s.sync.status().folders[0]!.localPath;
  const at = (...p: string[]) => join(root, ...p);
  return { ...s, folder, bids, a, b, root, at };
}

// Whole syncs against a Drive in memory, on disk: well under a second each here, but one took over the default 5 s
// on a busy CI runner (run 36820596258).
describe('Drive sync — end to end against a Drive', { timeout: 20_000 }, () => {
  it('brings a Drive folder down, into ~/WorkSuite Drive/<name>, and then has nothing left to do', async () => {
    const { sync, at, drive, root, home } = await syncing();
    expect(root.endsWith(join('home', 'WorkSuite Drive', 'Tenders'))).toBe(true);
    expect(root.startsWith(home) || root.includes('WorkSuite Drive')).toBe(true);
    expect(readFileSync(at('a.txt'), 'utf8')).toBe('alpha');
    expect(readFileSync(at('Bids', 'b.txt'), 'utf8')).toBe('bravo');
    const f = sync.status().folders[0]!;
    expect(f.files).toBe(2);
    expect(f.lastSyncAt).not.toBeNull();
    expect(drive.deviceCursor).toBe(drive.events.length); // caught up with the journal

    const before = drive.calls.length;
    await sync.syncNow();
    const writes = drive.calls.slice(before).filter((c) => /commit|block|POST \/api\/folders|DELETE|PUT \/api\/files/.test(c));
    expect(writes).toEqual([]);
  });

  it('sends new files and edits up, brings Drive’s edits down, and leaves out what policy and the OS say to', async () => {
    const { sync, at, drive, folder, bids, a, b } = await syncing();
    writeFileSync(at('new.txt'), 'new');
    writeFileSync(at('Bids', 'c.txt'), 'charlie');
    writeFileSync(at('draft.bak'), 'ignored by the policy');
    writeFileSync(at('setup.exe'), 'blocked by the policy');
    writeFileSync(at('.DS_Store'), 'never');
    mkdirSync(at('Offers', 'Q4'), { recursive: true });
    writeFileSync(at('Offers', 'Q4', 'd.txt'), 'delta');
    await sync.syncNow();
    expect(drive.byName('new.txt', folder)?.bytes.toString()).toBe('new');
    expect(drive.byName('c.txt', bids)?.bytes.toString()).toBe('charlie');
    const offers = drive.folderByName('Offers', folder)!;
    const q4 = drive.folderByName('Q4', offers.id)!;
    expect(drive.byName('d.txt', q4.id)?.bytes.toString()).toBe('delta');
    expect(drive.byName('draft.bak', folder)).toBeUndefined();
    expect(drive.byName('setup.exe', folder)).toBeUndefined();
    expect(drive.byName('.DS_Store', folder)).toBeUndefined();
    expect(sync.status().folders[0]!.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'setup.exe', kind: 'skipped' })]));

    writeFileSync(at('a.txt'), 'alpha, edited here');
    await sync.syncNow();
    expect(drive.files.get(a)!.bytes.toString()).toBe('alpha, edited here');
    expect(drive.files.get(a)!.version).toBe(2);

    drive.edit(b, 'bravo, edited in Drive');
    await sync.syncNow();
    expect(readFileSync(at('Bids', 'b.txt'), 'utf8')).toBe('bravo, edited in Drive');
  });

  it('keeps both copies when a file changed on both sides', async () => {
    const { sync, at, drive, folder, a, root } = await syncing();
    writeFileSync(at('a.txt'), 'mine');
    drive.edit(a, 'theirs');
    await sync.syncNow();
    expect(readFileSync(at('a.txt'), 'utf8')).toBe('theirs');
    const copy = readdirSync(root).find((n) => n.includes('conflicted copy'))!;
    expect(copy).toMatch(/^a \(Hasarinda's conflicted copy \d{4}-\d{2}-\d{2}\)\.txt$/);
    expect(readFileSync(join(root, copy), 'utf8')).toBe('mine');
    expect(drive.byName(copy, folder)?.bytes.toString()).toBe('mine');
    expect(drive.files.get(a)!.bytes.toString()).toBe('theirs');
    expect(sync.status().folders[0]!.issues.some((i) => i.kind === 'conflict')).toBe(true);
  });

  it('carries deletions both ways — to Drive’s recycle bin and to this computer’s Trash — and removes emptied folders', async () => {
    const { sync, at, drive, a, b, trashed, bids } = await syncing();
    rmSync(at('a.txt'));
    await sync.syncNow();
    expect(drive.files.get(a)!.deleted).toBe(true);

    drive.trash(b);
    await sync.syncNow();
    expect(existsSync(at('Bids', 'b.txt'))).toBe(false);
    expect(trashed).toEqual([at('Bids', 'b.txt')]);

    rmSync(at('Bids'), { recursive: true });
    await sync.syncNow();
    expect(drive.folders.get(bids)!.deleted).toBe(true);
  });

  it('follows renames and moves without sending the file again, keeping its id', async () => {
    const { sync, at, drive, a, folder, bids } = await syncing();
    const ino = statSync(at('a.txt')).ino;
    const reads = drive.blockReads;
    drive.rename(a, 'renamed.txt');
    await sync.syncNow();
    expect(existsSync(at('a.txt'))).toBe(false);
    expect(statSync(at('renamed.txt')).ino).toBe(ino);
    expect(drive.blockReads).toBe(reads);

    renameSync(at('renamed.txt'), at('Bids', 'moved.txt'));
    await sync.syncNow();
    expect(drive.files.get(a)).toMatchObject({ name: 'moved.txt', folder_id: bids, deleted: false });
    expect(drive.byName('moved.txt', folder)).toBeUndefined();

    drive.folders.get(bids)!.name = 'Offers';
    await sync.syncNow();
    expect(existsSync(at('Offers', 'moved.txt'))).toBe(true);
    expect(existsSync(at('Bids'))).toBe(false);
    expect(drive.blockReads).toBe(reads);
  });

  it('holds a mass deletion until somebody confirms it, and can bring the files back instead', async () => {
    const s = setup();
    const folder = s.drive.mkdir('Archive');
    for (let i = 0; i < 30; i++) s.drive.put(`doc-${i}.txt`, folder, `doc ${i}`);
    await s.sync.add({ folderId: folder, mode: 'two_way', localPath: null });
    await s.sync.syncNow();
    const root = s.sync.status().folders[0]!.localPath;
    for (const n of readdirSync(root)) rmSync(join(root, n));
    await s.sync.syncNow();
    expect([...s.drive.files.values()].filter((f) => !f.deleted)).toHaveLength(30);
    const f = s.sync.status().folders[0]!;
    expect(f.heldDeletions).toEqual({ side: 'drive', count: 30 });

    s.sync.resolveHeld(f.id, 'restore');
    await s.sync.syncNow();
    expect(readdirSync(root)).toHaveLength(30);

    for (const n of readdirSync(root)) rmSync(join(root, n));
    await s.sync.syncNow();
    s.sync.resolveHeld(f.id, 'apply');
    await s.sync.syncNow();
    expect([...s.drive.files.values()].filter((x) => !x.deleted)).toHaveLength(0);
  });

  it('stops, and deletes nothing in Drive, when the folder on this computer disappears', async () => {
    const { sync, root, drive } = await syncing();
    rmSync(root, { recursive: true });
    await sync.syncNow();
    expect([...drive.files.values()].every((f) => !f.deleted)).toBe(true);
    expect(sync.status().folders[0]!.error).toMatch(/not on this computer any more/);
  });

  it('stops, and deletes nothing here, when the Drive folder disappears', async () => {
    const { sync, at, drive, folder } = await syncing();
    drive.folders.get(folder)!.deleted = true;
    await sync.syncNow();
    expect(existsSync(at('a.txt'))).toBe(true);
    expect(sync.status().folders[0]!.error).toMatch(/deleted, moved to the recycle bin/);
  });

  it('sends only the 4 MiB blocks that changed, and fetches only those that differ', async () => {
    const { sync, at, drive, folder } = await syncing();
    const big = randomBytes(9 * 1024 * 1024);
    writeFileSync(at('video.bin'), big);
    await sync.syncNow();
    expect(drive.blockBytesIn).toBe(big.length);
    const id = drive.byName('video.bin', folder)!.id;

    big.writeUInt8(big.readUInt8(5 * 1024 * 1024) ^ 0xff, 5 * 1024 * 1024); // one byte in the second block
    writeFileSync(at('video.bin'), big);
    await sync.syncNow();
    expect(drive.blockBytesIn).toBe(9 * 1024 * 1024 + BLOCK);
    expect(sha(drive.files.get(id)!.bytes)).toBe(sha(big));

    const theirs = Buffer.from(big);
    theirs.writeUInt8(theirs.readUInt8(8.5 * 1024 * 1024) ^ 0xff, 8.5 * 1024 * 1024); // the third block, changed in Drive
    drive.edit(id, theirs);
    const reads = drive.blockReads;
    await sync.syncNow();
    expect(drive.blockReads - reads).toBe(1);
    expect(sha(readFileSync(at('video.bin')))).toBe(sha(theirs));
  });

  it('when Drive moves on mid-upload, takes the server’s conflicted copy as this computer’s file instead of sending it twice', async () => {
    const { sync, at, drive, folder, a, root } = await syncing();
    writeFileSync(at('a.txt'), 'mine, being sent');
    drive.beforeCommit = (fileId) => {
      if (fileId === a) {
        drive.beforeCommit = null;
        drive.edit(a, 'theirs, saved a moment earlier');
      }
    };
    await sync.syncNow();
    expect(readFileSync(at('a.txt'), 'utf8')).toBe('theirs, saved a moment earlier');
    const copies = [...drive.files.values()].filter((f) => !f.deleted && f.folder_id === folder && f.name.includes('conflicted copy'));
    expect(copies).toHaveLength(1);
    expect(readFileSync(join(root, copies[0]!.name), 'utf8')).toBe('mine, being sent');
  });

  it('removes what it synced — and only that — when told to wipe', async () => {
    const { sync, at, drive } = await syncing();
    drive.wipeOrdered = true;
    writeFileSync(at('mine-only.txt'), 'never synced');
    await sync.syncNow();
    expect(existsSync(at('a.txt'))).toBe(false);
    expect(existsSync(at('Bids', 'b.txt'))).toBe(false);
    expect(existsSync(at('Bids'))).toBe(false);
    expect(readFileSync(at('mine-only.txt'), 'utf8')).toBe('never synced');
    expect(drive.wipedConfirmed).toBe(true);
    expect(sync.status().folders).toEqual([]);
  });

  it('keeps a colleague’s file it may only view, and never sends an edit to it', async () => {
    const { sync, at, drive, folder } = await syncing();
    const id = drive.put('theirs.txt', folder, 'their words', 99);
    drive.files.get(id)!.readOnly = true;
    await sync.syncNow();
    expect(readFileSync(at('theirs.txt'), 'utf8')).toBe('their words');
    writeFileSync(at('theirs.txt'), 'my words');
    await sync.syncNow();
    expect(drive.files.get(id)!.bytes.toString()).toBe('their words');
    expect(sync.status().folders[0]!.issues.some((i) => i.path === 'theirs.txt' && i.kind === 'skipped')).toBe(true);
  });

  it('sends an empty file by the ordinary upload (the block protocol needs a block)', async () => {
    const { sync, at, drive, folder } = await syncing();
    writeFileSync(at('empty.txt'), '');
    await sync.syncNow();
    expect(drive.byName('empty.txt', folder)?.bytes.length).toBe(0);
  });

  it('answers where Drive items are on this computer, for the SYNC column and Details', async () => {
    const { sync, a, b, bids, folder, drive } = await syncing();
    const elsewhere = drive.put('elsewhere.txt', null, 'x');
    const look = sync.lookup([a, b, elsewhere], [bids, folder], folder);
    expect(look.files[String(a)]).toMatchObject({ state: 'synced' });
    expect(look.files[String(b)]!.path).toMatch(/Tenders[/\\]Bids$/);
    expect(look.files[String(elsewhere)]).toMatchObject({ state: 'pending' }); // looked at inside a synced folder
    expect(sync.lookup([elsewhere], [], null).files[String(elsewhere)]).toMatchObject({ state: 'online' });
    expect(look.folders[String(folder)]).toMatchObject({ state: 'synced', root: true });
    expect(look.folders[String(bids)]).toMatchObject({ state: 'synced', root: false });
  });

  it('refuses to sync a folder twice, inside another, or into a place that overlaps one', async () => {
    const { sync, folder, bids, root, drive, home } = await syncing();
    await expect(sync.add({ folderId: folder, mode: 'two_way', localPath: null })).rejects.toThrow(/already synced/);
    await expect(sync.add({ folderId: bids, mode: 'two_way', localPath: null })).rejects.toThrow(/as part of Tenders/);
    await expect(sync.add({ folderId: null, mode: 'two_way', localPath: null })).rejects.toThrow(/one by one/);
    const other = drive.mkdir('Business');
    await expect(sync.add({ folderId: other, mode: 'two_way', localPath: join(root, 'inside') })).rejects.toThrow(/overlaps/);
    await expect(sync.add({ folderId: other, mode: 'two_way', localPath: home })).rejects.toThrow(/home folder/);
    await expect(sync.add({ folderId: other, mode: 'two_way', localPath: null })).resolves.toMatchObject({ folders: [expect.anything(), expect.objectContaining({ folderName: 'Business' })] });
  });
});
