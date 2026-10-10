import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImageLocal, withBase, type LocalFile } from '../../../electron/services/image-local';
import { conflictOf, listConflicts, resolveConflict } from '../../../electron/services/sync/conflicts';
import { DesktopError } from '../../../electron/main/errors';
import type { HttpClient } from '../../../electron/services/http';

/**
 * The image editor on this computer (Drive ENH-03 DSK-02…05): an edit saved offline waits beside the synced copy
 * with its recipe, and the recipe follows the bytes to whichever file sync sends them as.
 */
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup(over: Partial<{ located: LocalFile | null; post: (id: number, body: unknown) => Promise<void> }> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ws-image-'));
  made.push(dir);
  const synced = join(dir, 'drive', 'Campaign');
  mkdirSync(synced, { recursive: true });
  const path = join(synced, 'ella-sunrise.jpg');
  writeFileSync(path, 'original pixels');
  const located: LocalFile | null = over.located === undefined ? { path, version: 3, sha256: null, canUpload: true, paused: false } : over.located;
  const posted: Array<{ id: number; body: { recipe: string; summary: string } }> = [];
  const events: unknown[] = [];
  const kick = vi.fn();
  const opened: string[] = [];
  const local = new ImageLocal({
    root: () => join(dir, 'data'),
    tmp: () => join(dir, 'tmp'),
    userId: () => '7',
    locate: () => located,
    kick,
    postRecipe: over.post ?? (async (id, body) => void posted.push({ id, body })),
    write: async (p, bytes) => writeFileSync(p, bytes),
    openPath: async (p) => (opened.push(p), ''),
    changed: (e) => events.push(e),
  });
  return { dir, path, local, posted, events, kick, opened };
}

const RECIPE = JSON.stringify({ schema: 2, base_version: null, filter: { name: 'warm', strength: 60 } });

describe('an offline edit (DSK-02)', () => {
  it('goes to the synced copy, its recipe to a sidecar out of the synced folder; sync is asked to send it', async () => {
    const s = setup();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const r = await s.local.save({ fileId: 42, bytes, recipe: RECIPE, summary: 'Warm filter 60%', note: 'Warm', width: 10, height: 10 });
    expect(r).toEqual({ willBe: 4, name: 'ella-sunrise.jpg' });
    expect(new Uint8Array(readFileSync(s.path))).toEqual(bytes);
    expect(s.kick).toHaveBeenCalled();
    const info = await s.local.info(42);
    expect(info).toMatchObject({ synced: true, version: 3, pending: { baseVersion: 3, state: 'waiting', willBe: 4 } });
    expect(existsSync(join(s.dir, 'drive', 'Campaign', '42.json'))).toBe(false);
  });

  it('sends its recipe, naming its base, to the version sync made of exactly those bytes — then forgets it', async () => {
    const s = setup();
    const bytes = new Uint8Array([9, 9, 9]);
    await s.local.save({ fileId: 42, bytes, recipe: RECIPE, summary: 'Warm', note: '', width: 1, height: 1 });
    await s.local.uploaded({ fileId: 42, version: 4, sha256: 'something else' });
    expect(s.posted).toHaveLength(0);
    // Something else sent as the next version (the system editor): the recipe no longer fits it.
    await s.local.save({ fileId: 42, bytes, recipe: RECIPE, summary: 'Warm', note: '', width: 1, height: 1 });
    await s.local.uploaded({ fileId: 42, version: 4, sha256: sha(bytes) });
    expect(s.posted).toHaveLength(1);
    expect(s.posted[0]!.id).toBe(42);
    expect(JSON.parse(s.posted[0]!.body.recipe)).toMatchObject({ schema: 2, base_version: 3 });
    expect((await s.local.info(42)).pending).toBeNull();
    expect(s.events).toContainEqual({ fileId: 42, state: 'uploaded', version: 4, copyId: null });
  });

  it('drops a waiting recipe when other bytes were sent as the file (Open with › System editor, DSK-06)', async () => {
    const s = setup();
    await s.local.save({ fileId: 42, bytes: new Uint8Array([1]), recipe: RECIPE, summary: '', note: '', width: 1, height: 1 });
    await s.local.uploaded({ fileId: 42, version: 4, sha256: sha(new Uint8Array([2])) });
    expect(s.posted).toHaveLength(0);
    expect((await s.local.info(42)).pending).toBeNull();
  });

  it('when Drive moved on, the recipe goes to the conflicted copy the server kept (DSK-03)', async () => {
    const s = setup();
    const bytes = new Uint8Array([5, 6]);
    await s.local.save({ fileId: 42, bytes, recipe: RECIPE, summary: '', note: '', width: 1, height: 1 });
    await s.local.conflicted({ fileId: 42, copyId: 77, sha256: sha(bytes) });
    expect(s.posted.map((p) => p.id)).toEqual([77]);
    expect(s.events).toContainEqual(expect.objectContaining({ state: 'conflict', copyId: 77 }));
  });

  it('a copy set aside here waits as a conflict, and follows its bytes when they go up as a new file', async () => {
    const s = setup();
    const bytes = new Uint8Array([7]);
    await s.local.save({ fileId: 42, bytes, recipe: RECIPE, summary: '', note: '', width: 1, height: 1 });
    await s.local.conflicted({ fileId: 42, copyId: null, sha256: sha(bytes) });
    expect((await s.local.info(42)).pending?.state).toBe('conflict');
    await s.local.uploaded({ fileId: 90, version: 1, sha256: sha(bytes) });
    expect(s.posted.map((p) => p.id)).toEqual([90]);
  });

  it('keeps the recipe when it could not be sent, and sends it on the next try', async () => {
    let fail = true;
    const sent: number[] = [];
    const s = setup({ post: async (id) => (fail ? Promise.reject(new Error('offline')) : void sent.push(id)) });
    const bytes = new Uint8Array([3]);
    await s.local.save({ fileId: 42, bytes, recipe: RECIPE, summary: '', note: '', width: 1, height: 1 });
    await s.local.uploaded({ fileId: 42, version: 4, sha256: sha(bytes) });
    expect((await s.local.info(42)).pending?.state).toBe('recipe-pending');
    fail = false;
    await s.local.retry();
    expect(sent).toEqual([42]);
    expect((await s.local.info(42)).pending).toBeNull();
  });

  it('saves a copy beside the file, never over another, and only where edits go up', async () => {
    const s = setup();
    const r = await s.local.save({ fileId: 42, bytes: new Uint8Array([1]), recipe: RECIPE, summary: '', note: '', width: 1, height: 1, copyName: 'ella (edited).jpg' });
    expect(r.name).toBe('ella (edited).jpg');
    expect(existsSync(join(s.dir, 'drive', 'Campaign', 'ella (edited).jpg'))).toBe(true);
    await expect(s.local.save({ fileId: 42, bytes: new Uint8Array([1]), recipe: RECIPE, summary: '', note: '', width: 1, height: 1, copyName: 'ella (edited).jpg' })).rejects.toThrow(/already a file/);
    await expect(s.local.save({ fileId: 42, bytes: new Uint8Array([1]), recipe: RECIPE, summary: '', note: '', width: 1, height: 1, copyName: '../escape.jpg' })).rejects.toThrow(/not a usable file name/);
    const ro = setup({ located: { path: join(s.dir, 'x.jpg'), version: 1, sha256: null, canUpload: false, paused: false } });
    await expect(ro.local.save({ fileId: 1, bytes: new Uint8Array([1]), recipe: RECIPE, summary: '', note: '', width: 1, height: 1 })).rejects.toThrow(/only follows Drive/);
  });

  it('reads the synced copy, opens it in the system’s app, and refuses a picture not kept here', async () => {
    const s = setup();
    expect(Buffer.from(await s.local.read(42)).toString()).toBe('original pixels');
    expect(await s.local.openSystem(42)).toBe(true);
    expect(s.opened).toEqual([s.path]);
    const none = setup({ located: null });
    await expect(none.local.read(1)).rejects.toBeInstanceOf(DesktopError);
    expect((await none.local.info(1)).synced).toBe(false);
  });
});

describe('the library cache and the drag out (DSK-04, DSK-05)', () => {
  it('keeps library items for offline use, oldest out first past its size', async () => {
    const s = setup();
    await s.local.cachePut('item:5:1', new Uint8Array([1, 2]), 'image/svg+xml');
    expect(await s.local.cacheGet('item:5:1')).toMatchObject({ bytes: new Uint8Array([1, 2]), type: 'image/svg+xml' });
    expect(await s.local.cacheGet('item:6:1')).toBeNull();
  });

  it('writes the canvas as a PNG to drag, and takes nothing else', async () => {
    const s = setup();
    const token = await s.local.prepareDrag(PNG, 'ella-sunrise.jpg');
    const file = s.local.dragFile(token);
    expect(file.endsWith('ella-sunrise.png')).toBe(true);
    expect(new Uint8Array(readFileSync(file))).toEqual(PNG);
    await expect(s.local.prepareDrag(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'x.png')).rejects.toThrow(/PNG/);
    expect(() => s.local.dragFile('00000000-0000-0000-0000-000000000000')).toThrow();
  });

  it('names the base a recipe was made from, and never sends a draft mark', () => {
    expect(JSON.parse(withBase(JSON.stringify({ schema: 2, base_version: null, draft: { saved_at: 'x' } }), 5))).toEqual({ schema: 2, base_version: 5 });
    expect(JSON.parse(withBase(JSON.stringify({ schema: 2, base_version: 2 }), 5)).base_version).toBe(2);
    expect(withBase('not json', 5)).toBe('not json');
  });
});

describe('sync conflicts (DSK-03)', () => {
  const row = { id: 3, file_id: 42, file_name: 'ella-sunrise.jpg', copy_file_id: 77, copy_name: 'ella-sunrise (conflicted copy).jpg', device_name: 'MacBook', base_version: 3, server_version: 4, server_size: 100, local_size: 120, server_updated_at: '2026-10-10 13:38:00', created_at: '2026-10-10 13:40:00' };

  it('are listed from /api/drive/conflicts, or the older /api/sync/conflicts where that is all there is', async () => {
    const asked: string[] = [];
    const http = {
      get: async (p: string) => {
        asked.push(p);
        if (p === '/api/drive/conflicts') throw new DesktopError('NOT_FOUND', 'Not found', 404);
        return { conflicts: [row] };
      },
    } as unknown as HttpClient;
    expect(await listConflicts(http)).toEqual([conflictOf(row)]);
    expect(asked).toEqual(['/api/drive/conflicts', '/api/sync/conflicts']);
    expect(conflictOf(row)).toMatchObject({ fileId: 42, copyFileId: 77, baseVersion: 3, serverVersion: 4, deviceName: 'MacBook' });
  });

  it('are decided with one of four resolutions; a missing conflict is not retried elsewhere', async () => {
    const posted: Array<[string, unknown]> = [];
    const http = { post: async (p: string, b: unknown) => (posted.push([p, b]), { message: 'Both versions were kept.' }) } as unknown as HttpClient;
    expect(await resolveConflict(http, 3, 'keep_both')).toEqual({ message: 'Both versions were kept.' });
    expect(posted).toEqual([['/api/drive/conflicts/3/resolve', { resolution: 'keep_both' }]]);
    const gone = { post: async () => Promise.reject(new DesktopError('NOT_FOUND', 'Conflict not found.', 404)) } as unknown as HttpClient;
    await expect(resolveConflict(gone, 9, 'dismiss')).rejects.toThrow('Conflict not found.');
  });
});
