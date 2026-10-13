import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: (k: string) => `/home/me/${k}`, getVersion: () => '0.1.0' }, safeStorage: {}, shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));

import { Database } from '../../../../electron/services/db';
import { Vault } from '../../../../electron/services/vault';
import { DesktopError } from '../../../../electron/main/errors';
import { QUOTA_HELD, TransferManager } from '../../../../electron/services/transfers';
import { OfficeExternal, QUOTA_COPY_MESSAGE } from '../../../../electron/services/office-external';

/**
 * A full Personal account (Connection & Startup §3 quota): an upload refused with QUOTA_EXCEEDED waits, queued, and
 * goes on by itself when there is room; an Office copy's new version waits in `quota` (screen 13). Nothing is lost.
 */
const WS = 'https://ws.example';
let dir: string;
const managers: TransferManager[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-quota-'));
});
afterEach(() => {
  managers.splice(0).forEach((m) => m.stopAll());
  rmSync(dir, { recursive: true, force: true });
});

describe('uploads held for room', () => {
  function setup() {
    let full = true;
    const posts: string[] = [];
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: vi.fn(async () => new Response('{}', { status: 200 })),
      get: vi.fn(async () => ({ received_chunks: [0] })),
      post: vi.fn(async (path: string) => {
        posts.push(path);
        if (path === '/api/uploads/init') {
          if (full) throw new DesktopError('QUOTA_EXCEEDED', 'Your storage is full.', 507);
          return { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 };
        }
        return { file_id: 9 };
      }),
    };
    const held = vi.fn();
    const t = new TransferManager({ db, vault: () => vault, http: http as never, userId: () => 'u1', downloadFolder: () => dir, hash: async () => ({ sha256: 'abc', bytes: 1000 }), canOpenFiles: () => true, audit: () => undefined, retryDelay: () => 5, onQuotaHeld: held });
    managers.push(t);
    return { t, db, vault, posts, held, setFull: (v: boolean) => (full = v) };
  }

  it('waits, queued and said so, instead of failing; goes on when there is room', async () => {
    const q = setup();
    const file = join(dir, 'Survey.mp4');
    writeFileSync(file, Buffer.alloc(1000));
    const [picked] = await q.t.register([file]);
    const [up] = await q.t.upload([picked!.handle], { kind: 'files', folderId: null });
    await vi.waitFor(() => expect(q.held).toHaveBeenCalledTimes(1));
    const row = q.t.list().find((x) => x.id === up!.id)!;
    expect(row.state).toBe('queued');
    expect(row.held).toBe('quota');
    expect(row.error).toBe(QUOTA_HELD);
    expect(q.t.quotaHeld()).toBe(1);
    // Nothing else starts it: no retries against a full account.
    await new Promise((r) => setTimeout(r, 50));
    expect(q.posts.filter((p) => p === '/api/uploads/init')).toHaveLength(1);

    q.setFull(false);
    q.t.releaseQuota();
    await vi.waitFor(() => expect(q.t.uploadStatus(up!.id)?.state).toBe('done'));
    expect(q.t.uploadStatus(up!.id)?.fileId).toBe('9');
    expect(q.t.quotaHeld()).toBe(0);
  });

  it('stays held across a restart and goes on when released', async () => {
    const q = setup();
    const file = join(dir, 'Big.zip');
    writeFileSync(file, Buffer.alloc(1000));
    const [picked] = await q.t.register([file]);
    const [up] = await q.t.upload([picked!.handle], { kind: 'files', folderId: null });
    await vi.waitFor(() => expect(q.t.quotaHeld()).toBe(1));
    q.t.stopAll();

    const again = new TransferManager({ db: q.db, vault: () => q.vault, http: (q.t as unknown as { deps: { http: unknown } }).deps.http as never, userId: () => 'u1', downloadFolder: () => dir, hash: async () => ({ sha256: 'abc', bytes: 1000 }), canOpenFiles: () => true, audit: () => undefined, retryDelay: () => 5 });
    managers.push(again);
    again.recover();
    expect(again.quotaHeld()).toBe(1);
    expect(again.list().find((x) => x.id === up!.id)?.held).toBe('quota');
    q.setFull(false);
    again.releaseQuota();
    await vi.waitFor(() => expect(again.uploadStatus(up!.id)?.state).toBe('done'));
  });
});

describe('an Office copy when the storage is full (screen 13)', () => {
  it('keeps the edits in `quota`, and uploads them as a new version when there is room', async () => {
    const db = new Database(join(dir, 'db.sqlite'));
    const vault = new Vault(Vault.generateKey());
    let full = true;
    const posts: string[] = [];
    const quota = vi.fn();
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: async (_m: string, url: string) => {
        posts.push(url);
        return full
          ? new Response(JSON.stringify({ status: 'error', code: 'QUOTA_EXCEEDED', message: 'Your storage is full.' }), { status: 507, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({ status: 'success', data: { current: { version: 8 } } }), { status: 201, headers: { 'content-type': 'application/json' } });
      },
    };
    const x = new OfficeExternal({
      db,
      vault: () => vault,
      http: http as never,
      userId: () => '2',
      platform: 'linux',
      home: dir,
      canOpenFiles: () => true,
      syncedPath: () => null,
      download: async (_id, name, then) => {
        const p = join(dir, name);
        writeFileSync(p, 'v7');
        setTimeout(() => then({ path: p }), 0);
      },
      uploadNew: async () => undefined,
      openPath: async () => '',
      audit: () => undefined,
      onChanged: () => undefined,
      onQuota: quota,
      pollMs: 60_000,
    });
    try {
      const c = await x.open({ fileId: 42, name: 'Proposal.docx', folderId: 9, version: 7, app: 'default' });
      await vi.waitFor(() => expect(x.list()[0]!.state).toBe('open'));
      writeFileSync(join(dir, 'Proposal.docx'), 'edited, longer than before');
      await x.check();
      expect(x.list()[0]!.state).toBe('changed');

      await expect(x.upload(c.id, 'version')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
      expect(x.list()[0]).toMatchObject({ state: 'quota', error: QUOTA_COPY_MESSAGE });
      expect(quota).toHaveBeenCalledTimes(1);
      // Still full: it stays waiting.
      expect(await x.retryQuota()).toBe(0);
      expect(x.list()[0]!.state).toBe('quota');

      full = false;
      expect(await x.retryQuota()).toBe(1);
      expect(x.list()[0]).toMatchObject({ state: 'uploaded', baseVersion: 8 });
      expect(posts).toHaveLength(3);
    } finally {
      x.stop();
      db.raw.close();
    }
  });
});
