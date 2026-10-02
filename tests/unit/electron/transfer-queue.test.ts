import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: (k: string) => `/home/me/${k}`, getVersion: () => '0.1.0' }, safeStorage: {}, shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { DesktopError } from '../../../electron/main/errors';
import { MAX_AUTO_RETRIES, TransferManager, isTemporaryFailure, queueConfig, type QueueConfig } from '../../../electron/services/transfers';
import { TokenBucket } from '../../../electron/services/throttle';
import { SettingsService } from '../../../electron/services/settings';
import { bytesPerSecond, defaultDrivePrefs, normalizeDrivePrefs, transferSections, transferSummary } from '../../../shared/transfers';
import { contract } from '../../../shared/ipc/contract';
import type { Transfer } from '../../../shared/types';

const WS = 'https://ws.example';

/** A request the fake server is holding, answered when the test says. */
interface Held {
  url: string;
  range: string | null;
  signal: AbortSignal | undefined;
  answer: (status?: number, body?: string) => void;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-queue-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(over: Partial<QueueConfig> = {}, db = new Database(':memory:'), vault = new Vault(Vault.generateKey()), retryDelay = 20) {
  const held: Held[] = [];
  const asked: string[] = [];
  const notified: Array<[string, string]> = [];
  const http = {
    post: vi.fn(async () => ({ upload_id: 'upload-test', chunk_size: 256 * 1024, total_chunks: 1 })),
    url: (p: string) => `${WS}${p}`,
    raw: (_method: string, url: string, init: { headers?: Record<string, string>; signal?: AbortSignal }) =>
      new Promise<Response>((resolve, reject) => {
        asked.push(url.replace(WS, ''));
        init.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted.')), { once: true });
        const h: Held = {
          url: url.replace(WS, ''),
          range: init.headers?.Range ?? null,
          signal: init.signal,
          answer: (status = 200, body = 'hello') => {
            held.splice(held.indexOf(h), 1);
            resolve(new Response(status >= 400 ? null : body, { status, headers: { 'content-length': String(Buffer.byteLength(body)) } }));
          },
        };
        held.push(h);
      }),
  };
  const t = new TransferManager({
    db,
    vault: () => vault,
    http: http as never,
    userId: () => 'u1',
    downloadFolder: () => join(dir, 'Downloads'),
    hash: async () => ({ sha256: 'abc', bytes: 0 }),
    canOpenFiles: () => true,
    audit: () => undefined,
    notify: (x, how) => void notified.push([x.name, how]),
    retryDelay: () => retryDelay,
  });
  t.configure({ ...queueConfig(defaultDrivePrefs()), ...over });
  /** The request for a file, by the number in its name. */
  const req = (n: number) => held.find((h) => h.url === `/api/files/${n}/download` && !h.signal?.aborted);
  const add = (n: number) => t.download(`/api/files/${n}/download`, `f${n}.txt`, false, String(n));
  const state = () => Object.fromEntries(t.list().map((x) => [x.name, x.state]));
  const byName = (name: string) => t.list().find((x) => x.name === name)!;
  return { t, db, vault, held, asked, notified, req, add, state, byName };
}

const running = (list: Transfer[]) => list.filter((x) => x.state === 'running').map((x) => x.name).sort();

describe('the transfer queue (worksuite-desktop#94)', () => {
  it('moves two files at once and starts the rest in the order they were asked for', async () => {
    const q = setup();
    for (let n = 1; n <= 5; n++) await q.add(n);
    expect(running(q.t.list())).toEqual(['f1.txt', 'f2.txt']);
    expect(q.held).toHaveLength(2);
    // Waiting, with their places in the queue.
    expect([3, 4, 5].map((n) => q.byName(`f${n}.txt`).position)).toEqual([1, 2, 3]);
    expect(q.t.activeCounts()).toEqual({ uploads: 0, downloads: 5 });

    q.req(1)!.answer();
    await vi.waitFor(() => expect(q.byName('f1.txt').state).toBe('done'));
    expect(running(q.t.list())).toEqual(['f2.txt', 'f3.txt']);
    expect(q.byName('f4.txt').position).toBe(1);
    expect(readFileSync(join(dir, 'Downloads', 'f1.txt'), 'utf8')).toBe('hello');
  });

  it('starts the next one when one is paused, cancelled or fails', async () => {
    const q = setup();
    for (let n = 1; n <= 5; n++) await q.add(n);
    q.t.pause(q.byName('f1.txt').id);
    expect(q.state()['f1.txt']).toBe('paused');
    expect(running(q.t.list())).toEqual(['f2.txt', 'f3.txt']);

    await q.t.cancel(q.byName('f2.txt').id);
    expect(q.state()['f2.txt']).toBe('cancelled');
    expect(running(q.t.list())).toEqual(['f3.txt', 'f4.txt']);

    // A 404 is no use trying again: it fails, and the last one starts.
    q.req(3)!.answer(404);
    await vi.waitFor(() => expect(q.state()['f3.txt']).toBe('failed'));
    expect(q.byName('f3.txt').retryAt).toBeNull();
    expect(running(q.t.list())).toEqual(['f4.txt', 'f5.txt']);
  });

  it('resume and retry go back in the queue, behind the files already waiting', async () => {
    const q = setup();
    for (let n = 1; n <= 4; n++) await q.add(n);
    q.t.pause(q.byName('f1.txt').id);
    q.req(2)!.answer(404);
    await vi.waitFor(() => expect(q.state()['f2.txt']).toBe('failed'));
    expect(running(q.t.list())).toEqual(['f3.txt', 'f4.txt']);

    q.t.resume(q.byName('f1.txt').id);
    q.t.retry(q.byName('f2.txt').id);
    expect(q.state()).toMatchObject({ 'f1.txt': 'queued', 'f2.txt': 'queued' });
    expect([q.byName('f1.txt').position, q.byName('f2.txt').position]).toEqual([1, 2]);
    expect(running(q.t.list())).toEqual(['f3.txt', 'f4.txt']);

    // Asking again for one already waiting never starts it twice.
    q.t.resume(q.byName('f1.txt').id);
    expect(q.held.filter((h) => h.url === '/api/files/1/download')).toHaveLength(1);

    q.req(3)!.answer();
    await vi.waitFor(() => expect(running(q.t.list())).toEqual(['f1.txt', 'f4.txt']));
  });

  it('shares the two slots between uploads and downloads, including resumed uploads', async () => {
    const q = setup({ maxConcurrent: 6 });
    const path = join(dir, 'recording.mp4'); writeFileSync(path, 'video');
    await q.add(1);
    const upload = await q.t.uploadOwn(path, 'recording.mp4', { kind: 'files', folderId: null });
    await q.add(2); await q.add(3);
    expect(running(q.t.list())).toEqual(['f1.txt', 'recording.mp4']);
    q.t.pause(upload);
    expect(running(q.t.list())).toEqual(['f1.txt', 'f2.txt']);
    q.t.resume(upload); q.t.retry(upload);
    expect(q.byName('recording.mp4').position).toBe(2);
    q.req(1)!.answer();
    await vi.waitFor(() => expect(q.byName('f3.txt').state).toBe('running'));
    expect(q.byName('recording.mp4').state).toBe('queued');
    q.t.stopAll();
  });

  it('preserves a temporary failure retry deadline across restart', async () => {
    const db = new Database(':memory:'); const vault = new Vault(Vault.generateKey());
    const before = setup({}, db, vault, 60_000);
    await before.add(1); await before.add(2); await before.add(3);
    before.req(1)!.answer(503);
    await vi.waitFor(() => expect(before.byName('f1.txt').retryAt).toBeTruthy());
    const deadline = before.byName('f1.txt').retryAt;
    before.t.stopAll();
    const after = setup({}, db, vault);
    after.t.recover();
    expect(after.byName('f1.txt').retryAt).toBe(deadline);
    expect(after.byName('f1.txt').state).toBe('queued');
    expect(running(after.t.list())).toEqual(['f2.txt', 'f3.txt']);
    after.t.stopAll();
  });

  it('Pause All stops everything moving or waiting; Resume All puts it back in the queue, within the limit', async () => {
    const q = setup();
    for (let n = 1; n <= 4; n++) await q.add(n);
    q.t.pauseAll();
    expect(Object.values(q.state())).toEqual(['paused', 'paused', 'paused', 'paused']);
    expect(q.t.activeCounts()).toEqual({ uploads: 0, downloads: 0 });
    q.t.resumeAll();
    const list = q.t.list();
    expect(list.filter((x) => x.state === 'running')).toHaveLength(2);
    expect(list.filter((x) => x.state === 'queued')).toHaveLength(2);
    // The first paused download carries on from what it had (a range), never a second file.
    await vi.waitFor(() => expect(q.req(1)).toBeDefined());
  });

  it('Clear finished removes only the history: what is moving or waiting stays', async () => {
    const q = setup();
    for (let n = 1; n <= 6; n++) await q.add(n);
    q.t.pause(q.byName('f6.txt').id);
    q.req(1)!.answer();
    await vi.waitFor(() => expect(q.state()['f1.txt']).toBe('done'));
    await q.t.cancel(q.byName('f2.txt').id);
    q.t.clearFinished();
    expect(q.state()).toEqual({ 'f3.txt': 'running', 'f4.txt': 'running', 'f5.txt': 'queued', 'f6.txt': 'paused' });
  });

  it('tries a temporary failure again by itself, without holding a slot, and gives up after a few tries', async () => {
    const q = setup();
    for (let n = 1; n <= 3; n++) await q.add(n);
    q.req(1)!.answer(503);
    await vi.waitFor(() => expect(q.byName('f1.txt').attempts).toBe(1));
    const waiting = q.byName('f1.txt');
    expect(waiting.state).toBe('queued');
    expect(waiting.retryAt).not.toBeNull();
    expect(waiting.error).toMatch(/503/);
    // Its slot went to the next file meanwhile.
    expect(running(q.t.list())).toEqual(['f2.txt', 'f3.txt']);
    q.req(2)!.answer();
    // Due again, it takes the free slot.
    await vi.waitFor(() => expect(q.byName('f1.txt').state).toBe('running'));
    for (let i = 1; i < MAX_AUTO_RETRIES; i++) {
      q.req(1)!.answer(502);
      await vi.waitFor(() => expect(q.byName('f1.txt').attempts).toBe(i + 1));
      await vi.waitFor(() => expect(q.byName('f1.txt').state).toBe('running'));
    }
    q.req(1)!.answer(500);
    await vi.waitFor(() => expect(q.byName('f1.txt').state).toBe('failed'));
    expect(q.notified).toContainEqual(['f1.txt', 'failed']);
    expect(q.notified).toContainEqual(['f2.txt', 'done']);
  });

  it('knows a temporary failure from one that trying again would only repeat', () => {
    expect(isTemporaryFailure(new DesktopError('NETWORK_UNREACHABLE', 'x'))).toBe(true);
    expect(isTemporaryFailure(new DesktopError('SERVER_ERROR', 'x', 503))).toBe(true);
    expect(isTemporaryFailure(new DesktopError('RATE_LIMITED', 'x', 429))).toBe(true);
    expect(isTemporaryFailure(new TypeError('terminated'))).toBe(true);
    expect(isTemporaryFailure(Object.assign(new Error('read'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTemporaryFailure(new DesktopError('SERVER_ERROR', 'x', 413))).toBe(false);
    expect(isTemporaryFailure(new DesktopError('SERVER_ERROR', 'cannot replace'))).toBe(false);
    expect(isTemporaryFailure(new DesktopError('PERMISSION_DENIED', 'x', 403))).toBe(false);
    expect(isTemporaryFailure(Object.assign(new Error('no space left'), { code: 'ENOSPC' }))).toBe(false);
  });

  it('clamps oversized settings to two and still respects a lower limit', async () => {
    const q = setup({ maxConcurrent: 6 });
    for (let n = 1; n <= 5; n++) await q.add(n);
    expect(q.t.config().maxConcurrent).toBe(2);
    expect(running(q.t.list())).toHaveLength(2);
    q.t.configure({ ...q.t.config(), maxConcurrent: 1 });
    q.req(1)!.answer();
    await vi.waitFor(() => expect(q.state()['f1.txt']).toBe('done'));
    expect(running(q.t.list())).toEqual(['f2.txt']);
    q.t.configure({ ...q.t.config(), maxConcurrent: 4 });
    expect(running(q.t.list())).toEqual(['f2.txt', 'f3.txt']);
    expect(q.byName('f4.txt').state).toBe('queued');
    q.t.configure({ ...q.t.config(), maxConcurrent: NaN });
    expect(q.t.config().maxConcurrent).toBe(2);
  });

  it('keeps uploads and downloads within their own limits, inside the overall one', async () => {
    const q = setup({ maxConcurrent: 3, maxDownloads: 1 });
    for (let n = 1; n <= 3; n++) await q.add(n);
    expect(running(q.t.list())).toEqual(['f1.txt']);
  });

  it('waits while the server is out of reach and carries on when it is back', async () => {
    const q = setup();
    q.t.setOnline(false);
    await q.add(1);
    expect(q.state()['f1.txt']).toBe('queued');
    // Says what it waits for (worksuite-desktop#89).
    expect(q.byName('f1.txt').held).toBe('connection');
    q.t.setOnline(true);
    expect(q.state()['f1.txt']).toBe('running');
    expect(q.byName('f1.txt').held).toBeNull();
    // Running: when bytes last moved, so a run that has stopped moving can be told from a slow one.
    expect(Date.parse(q.byName('f1.txt').movedAt!)).toBeGreaterThan(Date.now() - 5000);
  });

  it('with auto-resume off, a lost connection pauses transfers until the person resumes them', async () => {
    const q = setup({ autoResume: false });
    await q.add(1);
    await q.add(2);
    await q.add(3);
    q.t.setOnline(false);
    expect(Object.values(q.state())).toEqual(['paused', 'paused', 'paused']);
    expect(q.byName('f1.txt').error).toMatch(/connection was lost/);
    q.t.setOnline(true);
    expect(Object.values(q.state())).toEqual(['paused', 'paused', 'paused']);
  });

  it('on a metered connection goes one at a time, or waits, as Drive settings say', async () => {
    const q = setup({ metered: 'limit' });
    q.t.setMetered(true);
    for (let n = 1; n <= 3; n++) await q.add(n);
    expect(running(q.t.list())).toEqual(['f1.txt']);
    q.t.configure({ ...q.t.config(), metered: 'pause' });
    // What was moving goes back to the front of the queue, to carry on later.
    expect(running(q.t.list())).toEqual([]);
    expect(q.byName('f1.txt').position).toBe(1);
    q.t.setMetered(false);
    expect(running(q.t.list())).toEqual(['f1.txt', 'f2.txt']);
  });

  it('keeps the queue across a restart, in its order, and carries on from where each file got to', async () => {
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    const before = setup({}, db, vault);
    for (let n = 1; n <= 4; n++) await before.add(n);
    before.t.pause(before.byName('f4.txt').id);
    before.t.stopAll();

    const after = setup({}, db, vault);
    expect(after.state()).toEqual({ 'f1.txt': 'queued', 'f2.txt': 'queued', 'f3.txt': 'queued', 'f4.txt': 'paused' });
    expect(after.byName('f4.txt').fileId).toBe('4');
    expect(after.byName('f1.txt').fileId).toBe('1');
    after.t.recover();
    expect(running(after.t.list())).toEqual(['f1.txt', 'f2.txt']);
    expect(after.byName('f3.txt').position).toBe(1);
    expect(after.state()['f4.txt']).toBe('paused');
    // A half-done download asks only for the rest.
    writeFileSync(join(dir, 'Downloads', `.${after.byName('f3.txt').id}.wsdownload`), 'he');
    after.req(1)!.answer();
    await vi.waitFor(() => expect(after.req(3)).toBeDefined());
    expect(after.req(3)!.range).toBe('bytes=2-');
  });
});

describe('an upload tried again is never a second file', () => {
  it('takes an upload the server already completed as done, without starting another', async () => {
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    const file = join(dir, 'Report.pdf');
    writeFileSync(file, 'x'.repeat(1000));
    const calls: string[] = [];
    let completeFails = true;
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: async (_m: string, url: string) => {
        calls.push(`chunk ${url.replace(WS, '')}`);
        return new Response('{}', { status: 200 });
      },
      get: async (path: string) => {
        calls.push(`GET ${path}`);
        return { received_chunks: [0], status: 'completed', file_id: 77 };
      },
      post: async (path: string) => {
        calls.push(`POST ${path}`);
        if (path === '/api/uploads/init') return { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 };
        if (path.endsWith('/complete') && completeFails) {
          completeFails = false;
          // The server finished it, but the answer was lost on the way back.
          throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
        }
        return { file_id: 77 };
      },
    };
    const t = new TransferManager({ db, vault: () => vault, http: http as never, userId: () => 'u1', downloadFolder: () => dir, hash: async () => ({ sha256: 'abc', bytes: 1000 }), canOpenFiles: () => true, audit: () => undefined, retryDelay: () => 5 });
    const [picked] = await t.register([file]);
    const [up] = await t.upload([picked!.handle], { kind: 'files', folderId: null });
    await vi.waitFor(() => expect(t.uploadStatus(up!.id)?.state).toBe('done'));
    expect(t.uploadStatus(up!.id)?.fileId).toBe('77');
    expect(calls.filter((c) => c === 'POST /api/uploads/init')).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('chunk'))).toHaveLength(1);
    expect(calls).toContain('GET /api/uploads/up1/status');
    // The handle was used: asking again with it uploads nothing.
    await expect(t.upload([picked!.handle], { kind: 'files', folderId: null })).rejects.toThrow(/no longer available/);
  });
});

describe('bandwidth caps (worksuite-desktop#95)', () => {
  const clock = () => {
    let now = 0;
    const slept: number[] = [];
    return {
      slept,
      tick: (ms: number) => (now += ms),
      c: {
        now: () => now,
        // Asleep, the takers' time passes only when the test says: they all ask at the same moment.
        sleep: async (ms: number) => void slept.push(ms),
      },
    };
  };

  it('turns Unlimited or a number of KB/s or MB/s into bytes a second', () => {
    expect(bytesPerSecond({ on: false, value: 5, unit: 'MB' })).toBeNull();
    expect(bytesPerSecond({ on: true, value: 512, unit: 'KB' })).toBe(512 * 1024);
    expect(bytesPerSecond({ on: true, value: 1.5, unit: 'MB' })).toBe(1.5 * 1024 * 1024);
    expect(bytesPerSecond({ on: true, value: 0, unit: 'MB' })).toBeNull();
  });

  it('holds every transfer going one way to the cap together', async () => {
    const k = clock();
    const b = new TokenBucket(1000, k.c);
    // A second's worth is there to start with; beyond it, each taker waits for its share.
    await b.take(1000);
    expect(k.slept).toEqual([]);
    await Promise.all([b.take(500), b.take(500)]);
    // Two transfers of 500 bytes at 1000 B/s: together they took one second.
    expect(k.slept).toEqual([500, 1000]);
    k.tick(3000);
    // The bucket holds at most one second: idle time is not saved up for a burst.
    expect(b.wouldWait(1000)).toBe(0);
    expect(b.wouldWait(2000)).toBe(1000);
  });

  it('lets a part bigger than the bucket through and pays for it afterwards', async () => {
    const k = clock();
    const b = new TokenBucket(1024, k.c);
    await b.take(4096);
    expect(k.slept).toEqual([3000]);
  });

  it('changes cap at once, and Unlimited never waits', async () => {
    const k = clock();
    const b = new TokenBucket(100, k.c);
    await b.take(1000);
    b.setRate(null);
    await b.take(10_000_000);
    expect(k.slept).toEqual([9000]);
    b.setRate(2000);
    expect(b.limit).toBe(2000);
    expect(b.wouldWait(4000)).toBe(1000);
  });

  it('a transfer manager shares one cap per direction, set from Drive settings', () => {
    const q = setup({ uploadBps: 1024, downloadBps: null });
    expect(q.t.throttles.upload.limit).toBe(1024);
    expect(q.t.throttles.download.limit).toBeNull();
    q.t.configure(queueConfig({ ...defaultDrivePrefs(), downloadLimit: { on: true, value: 2, unit: 'MB' } }));
    expect(q.t.throttles.download.limit).toBe(2 * 1024 * 1024);
    expect(q.t.throttles.upload.limit).toBeNull();
  });
});

describe('Drive settings, saved on this computer (worksuite-desktop#95)', () => {
  const store = () => {
    const config: Record<string, unknown> = {};
    return { config, db: { getConfig: <T,>(k: string) => config[k] as T, setConfig: (k: string, v: unknown) => void (config[k] = JSON.parse(JSON.stringify(v))) } };
  };

  it('starts at two transfers at once, no caps, asking about names already taken', () => {
    const d = defaultDrivePrefs();
    expect(d).toMatchObject({ maxConcurrent: 2, maxUploads: null, maxDownloads: null, autoRetry: true, autoResume: true, askWhereToSave: false, conflict: 'ask', notifyFailed: true });
    expect(d.uploadLimit.on).toBe(false);
    expect(d.downloadLimit.on).toBe(false);
    const s = new SettingsService(store().db as never);
    expect(s.effective().drive).toEqual(d);
  });

  it('keeps limits in range: 1 to 2 overall, and a direction never above the overall', () => {
    expect(normalizeDrivePrefs({ maxConcurrent: 40 }).maxConcurrent).toBe(2);
    expect(normalizeDrivePrefs({ maxConcurrent: 0 }).maxConcurrent).toBe(1);
    expect(normalizeDrivePrefs({ maxConcurrent: 3, maxUploads: 5 }).maxUploads).toBe(2);
    expect(normalizeDrivePrefs({ uploadLimit: { on: true } as never }).uploadLimit).toEqual({ on: true, value: 1, unit: 'MB' });
  });

  it('changes one setting at a time and resets them all, the download folder too', () => {
    const { db, config } = store();
    const s = new SettingsService(db as never);
    const changed = vi.fn();
    s.onChange(changed);
    s.update({ drive: { maxConcurrent: 4, meteredConnection: true } as never, downloadFolder: '/elsewhere' });
    s.update({ drive: { conflict: 'skip' } as never });
    expect(s.effective().drive).toMatchObject({ maxConcurrent: 2, conflict: 'skip', autoRetry: true, meteredConnection: true });
    expect((config.preferences as { drive: { maxConcurrent: number } }).drive.maxConcurrent).toBe(2);
    expect(changed).toHaveBeenCalledTimes(2);
    const reset = s.resetDrive();
    expect(reset.drive).toEqual(defaultDrivePrefs());
    expect(reset.downloadFolder).toBe(join('/home/me/downloads', 'WorkSuite'));
  });
});

describe('the Transfers panel’s sections and summary', () => {
  const tr = (id: string, state: Transfer['state'], position: number | null = null): Transfer => ({ id, direction: 'upload', name: id, source: '', destination: '', bytes: 0, total: 0, state, speed: 0, error: null, createdAt: '', position });

  it('splits active, queued (in queue order), paused and finished', () => {
    const s = transferSections([tr('a', 'running'), tr('b', 'queued', 2), tr('c', 'queued', 1), tr('d', 'done'), tr('e', 'failed'), tr('f', 'paused'), tr('g', 'cancelled')]);
    expect(s.active.map((x) => x.id)).toEqual(['a']);
    expect(s.queued.map((x) => x.id)).toEqual(['c', 'b']);
    expect(s.paused.map((x) => x.id)).toEqual(['f']);
    expect(s.finished.map((x) => x.id)).toEqual(['d', 'e', 'g']);
  });

  it('sums it up as “2 transferring · 8 queued”', () => {
    const list = [tr('a', 'running'), tr('b', 'running'), ...Array.from({ length: 8 }, (_, i) => tr(`q${i}`, 'queued', i + 1)), tr('d', 'done')];
    expect(transferSummary(list)).toBe('2 transferring · 8 queued');
    expect(transferSummary([tr('d', 'done')])).toBeNull();
  });
});

it('rejects IPC preferences above the shared two-transfer ceiling', () => {
  const schema = contract['settings:set'].input;
  expect(schema.safeParse({ drive: { maxConcurrent: 2 } }).success).toBe(true);
  expect(schema.safeParse({ drive: { maxConcurrent: 3 } }).success).toBe(false);
  expect(schema.safeParse({ drive: { maxUploads: 3 } }).success).toBe(false);
  expect(schema.safeParse({ drive: { maxDownloads: 3 } }).success).toBe(false);
});

it('applies the device metered override immediately and releases waiting files when disabled', async () => {
  const q = setup();
  for (let n = 1; n <= 3; n++) await q.add(n);
  q.t.configure({ ...q.t.config(), metered: 'pause', meteredConnection: true });
  expect(running(q.t.list())).toHaveLength(0);
  expect(q.byName('f1.txt').held).toBe('metered');
  q.t.configure({ ...q.t.config(), meteredConnection: false });
  expect(running(q.t.list())).toHaveLength(2);
  expect(q.byName('f3.txt').state).toBe('queued');
  q.t.stopAll();
});
