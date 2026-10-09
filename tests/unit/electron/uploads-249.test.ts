import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: (k: string) => `/home/me/${k}`, getVersion: () => '0.1.0' }, safeStorage: {}, shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { DesktopError } from '../../../electron/main/errors';
import { HttpClient, TIMEOUT_MESSAGE, classifyNetworkError } from '../../../electron/services/http';
import { TransferManager, chunkSizeFor, isConnectionFailure, multipartPart } from '../../../electron/services/transfers';
import { CHUNK_BYTES, CONNECTION_LOST, MAIL_TOO_LARGE, MAX_UPLOAD_BYTES, PARALLEL_PARTS, PART_TOO_LARGE, STALLED, TOO_LARGE, TYPE_REFUSED, refusalMessage, uploadRefusal } from '../../../shared/uploads';
import { contract } from '../../../shared/ipc/contract';

/**
 * worksuite-desktop#249 — a ~50 MB PDF added to a tender's Documents failed with "The request was cancelled.", and
 * Retry failed the same way. The parts went up; the last step, `complete` (assemble, checksum, scan, store), ran on
 * the 30-second limit every request had, and the timeout's own message — "The operation was aborted due to
 * timeout" — was read as somebody cancelling. Now: no overall limit on an upload, only a 60-second stall; the slow
 * `complete` is waited out by asking `status`; parts go 8 MB at a time, three together; a dropped connection is
 * waited out and resumed from the parts the server has; and one size limit is said before anything is sent.
 */

// Real files and real streams: given room when the whole suite runs at once.
vi.setConfig({ testTimeout: 60_000 });

const WS = 'https://ws.example';
const MB = 1024 * 1024;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-249-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The part a request carried, read the way PHP reads it. */
async function readPart(init: { bodyFactory?: () => { body: BodyInit; contentType: string } }): Promise<{ index: number; bytes: number }> {
  const built = init.bodyFactory!();
  const form = await new Response(built.body, { headers: { 'content-type': built.contentType } }).formData();
  const chunk = form.get('chunk') as Blob;
  return { index: Number(form.get('chunk_index')), bytes: chunk.size };
}

function manager(http: unknown, over: Partial<ConstructorParameters<typeof TransferManager>[0]> = {}, db = new Database(':memory:'), vault = new Vault(Vault.generateKey())) {
  const t = new TransferManager({
    db,
    vault: () => vault,
    http: http as never,
    userId: () => 'u1',
    downloadFolder: () => dir,
    hash: async () => ({ sha256: 'f'.repeat(64), bytes: 0 }),
    canOpenFiles: () => true,
    audit: () => undefined,
    retryDelay: () => 5,
    partDelay: () => 1,
    stallMs: 2000,
    pollMs: 5,
    ...over,
  });
  return { t, db, vault };
}

function bigFile(name: string, size: number): string {
  const p = join(dir, name);
  writeFileSync(p, '');
  truncateSync(p, size);
  return p;
}

describe('the cause: a timeout read as "The request was cancelled."', () => {
  it('tells a timeout from a cancel', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const e = classifyNetworkError(timeout);
    expect(e.code).toBe('NETWORK_UNREACHABLE');
    expect(e.message).toBe(TIMEOUT_MESSAGE);
    expect(e.message).not.toMatch(/cancelled/);
    // Somebody really cancelling is still a cancel.
    expect(classifyNetworkError(new DOMException('The operation was aborted.', 'AbortError')).code).toBe('CANCELLED');
  });

  it('a request past its own limit says it took too long, and does not mark the server unreachable', async () => {
    const reach: boolean[] = [];
    const http = new HttpClient({
      fetch: (_url, init) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })),
      origin: () => WS,
      tokens: { accessToken: () => 't', refresh: async () => 'ok' },
      clientHeaders: () => ({}),
      onReachability: (r) => void reach.push(r),
      onAuthLost: () => undefined,
    });
    await expect(http.post('/api/uploads/u/complete', {}, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'NETWORK_UNREACHABLE', message: TIMEOUT_MESSAGE });
    expect(reach).not.toContain(false);
  });

  it('timeoutMs 0 sets no limit, and a streamed body is built again for the send after a token refresh', async () => {
    const seen: Array<{ signal: AbortSignal | undefined | null; type: string | null }> = [];
    let first = true;
    const http = new HttpClient({
      fetch: async (_url, init) => {
        seen.push({ signal: init.signal, type: new Headers(init.headers).get('content-type') });
        if (first) {
          first = false;
          return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 200 });
      },
      origin: () => WS,
      tokens: { accessToken: () => 't', refresh: async () => 'ok' },
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: () => undefined,
    });
    let built = 0;
    const res = await http.raw('POST', `${WS}/api/uploads/u/chunk`, { timeoutMs: 0, bodyFactory: () => ({ body: `part ${++built}`, contentType: `multipart/form-data; boundary=b${built}` }) });
    expect(res.status).toBe(200);
    expect(built).toBe(2);
    expect(seen.map((s) => s.signal)).toEqual([undefined, undefined]);
    expect(seen.map((s) => s.type)).toEqual(['multipart/form-data; boundary=b1', 'multipart/form-data; boundary=b2']);
  });

  it('never leaves a connection failure looking like something the person did', () => {
    expect(isConnectionFailure(new DesktopError('CANCELLED', 'The request was cancelled.'))).toBe(true);
    expect(isConnectionFailure(new DesktopError('NETWORK_UNREACHABLE', TIMEOUT_MESSAGE))).toBe(true);
    expect(isConnectionFailure(new DesktopError('SERVER_ERROR', 'Nope', 403))).toBe(false);
  });
});

describe('parts and limits', () => {
  it('sends a file over 8 MB in 8 MB parts; a smaller one in a single part', () => {
    expect(chunkSizeFor(50 * MB)).toBe(CHUNK_BYTES);
    expect(chunkSizeFor(1024 * MB)).toBe(8 * MB);
    expect(chunkSizeFor(2 * MB)).toBe(2 * MB);
    expect(PARALLEL_PARTS).toBeGreaterThanOrEqual(2);
    expect(PARALLEL_PARTS).toBeLessThanOrEqual(4);
  });

  it('streams one part as multipart/form-data the server reads, reporting the bytes as they go', async () => {
    const data = new Uint8Array(200 * 1024).fill(7);
    const sent: number[] = [];
    const m = multipartPart({ chunk_index: '3' }, 'chunk', 'part-3', data, (n) => void sent.push(n), 64 * 1024);
    const form = await new Response(m.body, { headers: { 'content-type': m.contentType } }).formData();
    expect(form.get('chunk_index')).toBe('3');
    expect((form.get('chunk') as Blob).size).toBe(200 * 1024);
    expect(sent).toEqual([0, 65536, 131072, 196608, 204800]);
  });

  it('one limit, said before anything is sent', () => {
    expect(MAX_UPLOAD_BYTES).toBe(2 * 1024 * MB);
    expect(TOO_LARGE).toBe('File is larger than the 2 GB limit');
    expect(uploadRefusal(MAX_UPLOAD_BYTES + 1)).toBe(TOO_LARGE);
    expect(uploadRefusal(1024 * MB)).toBeNull();
    expect(uploadRefusal(26 * MB, 25 * MB)).toBe(MAIL_TOO_LARGE);
  });

  it('says a server refusal as what it is', () => {
    expect(refusalMessage(415, 'Unsupported Media Type')).toBe(TYPE_REFUSED);
    expect(refusalMessage(422, 'This file type is not allowed.')).toBe(TYPE_REFUSED);
    expect(refusalMessage(413, null, 'part')).toBe(PART_TOO_LARGE);
    expect(refusalMessage(413, null)).toBe(TOO_LARGE);
    expect(refusalMessage(403, 'You may not attach files to this tender.')).toBe('You may not attach files to this tender.');
  });

  it('refuses a file over 2 GB when it is chosen, before any request', async () => {
    const http = { url: (p: string) => `${WS}${p}`, raw: vi.fn(), get: vi.fn(), post: vi.fn() };
    const { t } = manager(http);
    const path = bigFile('huge.iso', MAX_UPLOAD_BYTES + 1);
    await expect(t.register([path])).rejects.toThrow('huge.iso: File is larger than the 2 GB limit.');
    expect(http.post).not.toHaveBeenCalled();
    expect(http.raw).not.toHaveBeenCalled();
  });

  it('refuses a mail attachment over 25 MB before it is queued', async () => {
    const http = { url: (p: string) => `${WS}${p}`, raw: vi.fn(), get: vi.fn(), post: vi.fn() };
    const { t } = manager(http);
    const [picked] = await t.register([bigFile('scan.pdf', 26 * MB)]);
    await expect(t.upload([picked!.handle], { kind: 'mail' })).rejects.toThrow(MAIL_TOO_LARGE);
    expect(t.list()).toHaveLength(0);
  });

  it('the mail target is part of the upload contract', () => {
    expect(contract['transfers:upload'].input.safeParse({ handles: ['a'], target: { kind: 'mail' } }).success).toBe(true);
  });
});

describe('a 50 MB tender document (the report)', () => {
  it('goes up in parts, several at a time, waits out a slow complete, and is filed on the tender', async () => {
    const size = 50 * MB;
    const path = bigFile('Specification.pdf', size);
    const calls: string[] = [];
    let inFlight = 0;
    let most = 0;
    const parts: number[] = [];
    let polls = 0;
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: async (_m: string, url: string, init: { bodyFactory?: () => { body: BodyInit; contentType: string }; timeoutMs?: number }) => {
        expect(init.timeoutMs).toBe(0);
        inFlight++;
        most = Math.max(most, inFlight);
        const part = await readPart(init);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        parts.push(part.index);
        calls.push(`chunk ${part.index} ${part.bytes}`);
        return new Response('{}', { status: 200 });
      },
      get: async (path: string) => {
        calls.push(`GET ${path}`);
        polls++;
        return polls < 3 ? { status: 'assembling' } : { status: 'completed', file_id: 501, received_chunks: [0, 1, 2, 3, 4, 5, 6] };
      },
      post: async (path: string, body: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
        calls.push(`POST ${path}`);
        if (path === '/api/uploads/init') {
          expect(body.chunk_size).toBe(8 * MB);
          return { upload_id: 'up50', chunk_size: body.chunk_size, total_chunks: Math.ceil(size / (8 * MB)) };
        }
        if (path.endsWith('/complete')) {
          // Waited for no longer than a stall, never the old 30-second request limit.
          expect(opts?.timeoutMs).toBe(2000);
          return { upload_id: 'up50', status: 'assembling' };
        }
        if (path === '/api/tenders/9/documents') {
          expect(body).toMatchObject({ file_id: 501, kind: 'tender_notice', title: 'Specification.pdf' });
          return { id: 1 };
        }
        throw new Error(`unexpected ${path}`);
      },
    };
    const { t } = manager(http);
    const [picked] = await t.register([path]);
    const [up] = await t.upload([picked!.handle], { kind: 'tender', tenderId: 9, into: 'document', docKind: 'tender_notice' });
    // Shown on the tender at once, by where it is going.
    expect(t.list()[0]!.tender).toEqual({ tenderId: 9, into: 'document', docKind: 'tender_notice' });
    await vi.waitFor(() => expect(t.uploadStatus(up!.id)?.state).toBe('done'), { timeout: 20_000 });
    expect(parts.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(calls.filter((c) => c.startsWith('chunk 6'))).toEqual([`chunk 6 ${size - 6 * 8 * MB}`]);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(PARALLEL_PARTS);
    expect(calls).toContain('POST /api/tenders/9/documents');
    expect(t.uploadStatus(up!.id)?.fileId).toBe('501');
    expect(t.list()[0]!.error).toBeNull();
  });
});

describe('a dropped connection, a stall, a restart', () => {
  it('waits out a connection that stays gone past the usual retries, then carries on from the parts the server has', async () => {
    const size = 20 * MB;
    const path = bigFile('Bid.pdf', size);
    let online = false;
    const sent: number[] = [];
    let attempts = 0;
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: async (_m: string, _url: string, init: { bodyFactory?: () => { body: BodyInit; contentType: string } }) => {
        const part = await readPart(init);
        if (!online) {
          attempts++;
          throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
        }
        sent.push(part.index);
        return new Response('{}', { status: 200 });
      },
      // Part 0 got through before the connection went.
      get: async () => ({ status: 'uploading', received_chunks: [0] }),
      post: async (path: string) => {
        if (path === '/api/uploads/init') return { upload_id: 'up20', chunk_size: 8 * MB, total_chunks: 3 };
        if (path.endsWith('/complete')) return { file_id: 33 };
        return {};
      },
    };
    // Backoff inside a part made short: the five tries of one part are not what is being tested.
    const { t } = manager(http, { retryDelay: () => 5 });
    const [picked] = await t.register([path]);
    const [up] = await t.upload([picked!.handle], { kind: 'files', folderId: null });
    // Far more automatic tries than MAX_AUTO_RETRIES (4): it never gives up while the connection is gone.
    await vi.waitFor(() => expect(attempts).toBeGreaterThanOrEqual(PARALLEL_PARTS * 5 * 2), { timeout: 20_000 });
    const waiting = t.list().find((x) => x.id === up!.id)!;
    expect(['queued', 'running']).toContain(waiting.state);
    if (waiting.state === 'queued') expect(waiting.error).toBe(CONNECTION_LOST);
    expect(t.list().find((x) => x.id === up!.id)!.error ?? CONNECTION_LOST).not.toMatch(/cancelled/i);
    online = true;
    await vi.waitFor(() => expect(t.uploadStatus(up!.id)?.state).toBe('done'), { timeout: 20_000 });
    // Resumed: part 0 was never sent again.
    expect(sent.sort()).toEqual([1, 2]);
  }, 60_000);

  it('gives up a part that stalls (nothing moved for the stall limit) and sends it again', async () => {
    const path = bigFile('Drawings.pdf', 300 * 1024);
    let tries = 0;
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: (_m: string, _url: string, init: { signal?: AbortSignal; bodyFactory?: () => { body: BodyInit; contentType: string } }) => {
        tries++;
        if (tries === 1) {
          // Accepts nothing and never answers: only the stall watchdog ends this.
          return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DesktopError('CANCELLED', 'The request was cancelled.')), { once: true }));
        }
        return readPart(init).then(() => new Response('{}', { status: 200 }));
      },
      get: async () => ({ status: 'uploading', received_chunks: [] }),
      post: async (path: string) => (path === '/api/uploads/init' ? { upload_id: 'st', chunk_size: 512 * 1024, total_chunks: 1 } : { file_id: 4 }),
    };
    const { t } = manager(http, { stallMs: 40 });
    const [picked] = await t.register([path]);
    const [up] = await t.upload([picked!.handle], { kind: 'files', folderId: null });
    await vi.waitFor(() => expect(t.uploadStatus(up!.id)?.state).toBe('done'), { timeout: 20_000 });
    expect(tries).toBe(2);
    expect(STALLED).toMatch(/60 seconds/);
  }, 30_000);

  it('after a restart, the queue carries on from the last part the server has', async () => {
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    const path = bigFile('Recording.mp4', 24 * MB);
    const sentBefore: number[] = [];
    const first = {
      url: (p: string) => `${WS}${p}`,
      raw: async (_m: string, _u: string, init: { signal?: AbortSignal; bodyFactory?: () => { body: BodyInit; contentType: string } }) => {
        const part = await readPart(init);
        if (part.index > 0) {
          return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted.')), { once: true }));
        }
        sentBefore.push(part.index);
        return new Response('{}', { status: 200 });
      },
      get: vi.fn(),
      post: async (p: string) => (p === '/api/uploads/init' ? { upload_id: 'rs', chunk_size: 8 * MB, total_chunks: 3 } : {}),
    };
    const a = manager(first, {}, db, vault);
    const [picked] = await a.t.register([path]);
    const [up] = await a.t.upload([picked!.handle], { kind: 'files', folderId: null });
    await vi.waitFor(() => expect(sentBefore).toEqual([0]), { timeout: 20_000 });
    // WorkSuite quits mid-upload.
    a.t.stopAll();

    const sentAfter: number[] = [];
    const posts: string[] = [];
    const second = {
      url: (p: string) => `${WS}${p}`,
      raw: async (_m: string, _u: string, init: { bodyFactory?: () => { body: BodyInit; contentType: string } }) => {
        sentAfter.push((await readPart(init)).index);
        return new Response('{}', { status: 200 });
      },
      get: async () => ({ status: 'uploading', received_chunks: [0] }),
      post: async (p: string) => (posts.push(p), p.endsWith('/complete') ? { file_id: 12 } : {}),
    };
    const b = manager(second, {}, db, vault);
    b.t.recover();
    await vi.waitFor(() => expect(b.t.uploadStatus(up!.id)?.state).toBe('done'), { timeout: 20_000 });
    expect(sentAfter.sort()).toEqual([1, 2]);
    // The same upload session: no second init.
    expect(posts).toEqual(['/api/uploads/rs/complete']);
  });

  it('a checksum that does not match starts the next try afresh, and says why', async () => {
    const path = bigFile('Annex.pdf', 300 * 1024);
    let inits = 0;
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: async () => new Response('{}', { status: 200 }),
      get: async () => ({ status: 'failed', received_chunks: [0] }),
      post: async (p: string) => {
        if (p === '/api/uploads/init') return (inits++, { upload_id: `c${inits}`, chunk_size: 512 * 1024, total_chunks: 1 });
        if (p === '/api/uploads/c1/complete') throw new DesktopError('IPC_VALIDATION_FAILED', 'Checksum mismatch — upload corrupted', 422);
        return { file_id: 8 };
      },
    };
    const { t } = manager(http);
    const [picked] = await t.register([path]);
    const [up] = await t.upload([picked!.handle], { kind: 'files', folderId: null });
    await vi.waitFor(() => expect(t.uploadStatus(up!.id)?.state).toBe('failed'), { timeout: 20_000 });
    expect(t.uploadStatus(up!.id)?.error).toMatch(/checksum did not match/);
    t.retry(up!.id);
    await vi.waitFor(() => expect(t.uploadStatus(up!.id)?.state).toBe('done'), { timeout: 20_000 });
    expect(inits).toBe(2);
  });
});

describe('mail attachments go the same way', () => {
  it('sends the parts with purpose mail, stages them for the message, and hands Compose the token', async () => {
    const path = bigFile('Contract.pdf', 12 * MB);
    const posts: Array<[string, unknown]> = [];
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: async (_m: string, _u: string, init: { bodyFactory?: () => { body: BodyInit; contentType: string } }) => (await readPart(init), new Response('{}', { status: 200 })),
      get: vi.fn(),
      post: async (p: string, body: unknown) => {
        posts.push([p, body]);
        if (p === '/api/uploads/init') return { upload_id: 'm1', chunk_size: 8 * MB, total_chunks: 2 };
        if (p === '/api/mail/upload/from-upload') return { token: 'tok', name: 'Contract.pdf', size: 12 * MB };
        throw new Error(`unexpected ${p}`);
      },
    };
    const { t } = manager(http);
    const [picked] = await t.register([path]);
    const [up] = await t.upload([picked!.handle], { kind: 'mail' });
    await vi.waitFor(() => expect(t.list().find((x) => x.id === up!.id)?.state).toBe('done'), { timeout: 20_000 });
    expect(posts[0]![1]).toMatchObject({ purpose: 'mail', total_size: 12 * MB });
    expect(posts.map((p) => p[0])).toEqual(['/api/uploads/init', '/api/mail/upload/from-upload']);
    expect(t.list().find((x) => x.id === up!.id)?.attachment).toEqual({ token: 'tok', name: 'Contract.pdf', size: 12 * MB });
  });

  it('a type the server refuses is said plainly', async () => {
    const path = bigFile('setup.exe', 1024);
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: vi.fn(),
      get: vi.fn(),
      post: async () => {
        throw new DesktopError('IPC_VALIDATION_FAILED', 'That file type is not allowed here.', 422);
      },
    };
    const { t } = manager(http);
    const [picked] = await t.register([path]);
    const [up] = await t.upload([picked!.handle], { kind: 'chat', roomId: '4' });
    await vi.waitFor(() => expect(t.uploadStatus(up!.id)?.state).toBe('failed'), { timeout: 20_000 });
    expect(t.uploadStatus(up!.id)?.error).toBe(TYPE_REFUSED);
  });
});
