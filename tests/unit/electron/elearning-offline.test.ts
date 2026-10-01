import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {}, shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));

import { licenceEnded, offlineLessonUrl, parseOfflinePath } from '../../../shared/elearning-offline';
import { contract } from '../../../shared/ipc/contract';
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { DesktopError } from '../../../electron/main/errors';
import { isProxyPathAllowed } from '../../../electron/services/api-proxy';
import { TransferManager } from '../../../electron/services/transfers';
import { CHUNK, ElearningOffline, SealWriter, openChunk, parseRange, readSealed, sealChunk, sealedChunks, type Manifest } from '../../../electron/services/elearning-offline';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-eln-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Bytes nobody would find by accident: a counter, so any slice is checkable. */
function payload(n: number, seed = 7): Buffer {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}

async function consume(s: ReadableStream<Uint8Array> | null): Promise<Buffer> {
  if (!s) return Buffer.alloc(0);
  const parts: Buffer[] = [];
  const r = s.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

describe('sealed copies: encrypted in chunks, each opened on its own', () => {
  const key = Buffer.alloc(32, 9);

  it('reads back any span of a file across chunk boundaries, and nothing plain is on disk', async () => {
    const data = payload(CHUNK * 2 + 12_345);
    const path = join(dir, 'a.wsl');
    const w = await SealWriter.create(path, key);
    for (let i = 0; i < data.length; i += 70_001) await w.write(data.subarray(i, i + 70_001));
    await w.close(true);
    // Two whole chunks and the short last one (a resume only trusts whole ones).
    expect(await sealedChunks(path)).toBe(2);
    const disk = readFileSync(path);
    expect(disk.indexOf(data.subarray(1000, 1064))).toBe(-1);
    expect((await readSealed(path, key, data.length, 0, data.length - 1)).equals(data)).toBe(true);
    const s = CHUNK - 10;
    expect((await readSealed(path, key, data.length, s, s + 40)).equals(data.subarray(s, s + 41))).toBe(true);
    expect((await readSealed(path, key, data.length, data.length - 5, data.length - 1)).equals(data.subarray(-5))).toBe(true);
  });

  it('refuses a changed chunk, a chunk moved to another place, or another key', () => {
    const sealed = sealChunk(key, 3, payload(100));
    expect(openChunk(key, 3, sealed).equals(payload(100))).toBe(true);
    const flipped = Buffer.from(sealed);
    flipped.writeUInt8(flipped.readUInt8(20) ^ 1, 20);
    expect(() => openChunk(key, 3, flipped)).toThrow();
    expect(() => openChunk(key, 4, sealed)).toThrow();
    expect(() => openChunk(Buffer.alloc(32, 1), 3, sealed)).toThrow();
  });

  it('keeps the whole chunks of an interrupted write, and goes on after them', async () => {
    const data = payload(CHUNK * 2 + 500);
    const path = join(dir, 'b.wsl');
    const w = await SealWriter.create(path, key);
    await w.write(data.subarray(0, CHUNK + 300));
    await w.close(false);
    expect(await sealedChunks(path)).toBe(1);
    const resume = await SealWriter.create(path, key, CHUNK);
    await resume.write(data.subarray(CHUNK));
    await resume.close(true);
    expect((await readSealed(path, key, data.length, 0, data.length - 1)).equals(data)).toBe(true);
  });

  it('reads one Range, as a video element asks for it', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=5-2', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
});

describe('addresses a page may ask for', () => {
  it('names a course and a lesson, nothing else', () => {
    expect(offlineLessonUrl(12, 40)).toBe('app://bundle/__local/elearning/12/40');
    expect(parseOfflinePath('/elearning/12/40')).toEqual({ courseId: 12, lessonId: 40 });
    for (const bad of ['/elearning/12/../40', '/elearning/12', '/elearning/a/1', '/elearning/0/1', '/elearning/1/2/3', '/../elearning/1/2']) expect(parseOfflinePath(bad)).toBeNull();
  });

  it('ends a licence at the course’s end date, read as UTC', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(licenceEnded(null, now)).toBe(false);
    expect(licenceEnded('2026-09-29 11:59:59', now)).toBe(true);
    expect(licenceEnded('2026-09-29 12:00:01', now)).toBe(false);
  });

  it('lets the eLearning screens through the API proxy, and a lesson file into the download manager by its token only', () => {
    for (const p of ['/api/elearning/v1/me/learning', '/api/elearning/v1/me/lessons/4/progress', '/api/elearning/v1/me/attempts/9/answers/3', '/api/elearning/v1/courses/5/structure', '/media/abcDEF123-_.token']) {
      expect(isProxyPathAllowed(p, p.endsWith('progress') ? 'POST' : 'GET')).toBe(true);
    }
    expect(isProxyPathAllowed('/media/abcDEF123', 'POST')).toBe(false);
    const input = contract['transfers:download'].input;
    expect(input.safeParse({ elearningMedia: 'abcDEF123-_.token', name: 'Handbook.pdf' }).success).toBe(true);
    expect(input.safeParse({ elearningMedia: '../api/users', name: 'x' }).success).toBe(false);
    expect(input.safeParse({ elearningMedia: 'abcDEF123/../x', name: 'x' }).success).toBe(false);
    expect(input.safeParse({ elearningMedia: 'abcDEF123-_.token', fileId: '4', name: 'x' }).success).toBe(false);
    expect(contract['elearning:offlineDownload'].input.safeParse({ courseId: 12, title: 'Cyber basics' }).success).toBe(true);
    expect(contract['elearning:offlineDownload'].input.safeParse({ courseId: '12/../1', title: 'x' }).success).toBe(false);
  });
});

/* ── the service over the real download manager, database and vault ───────────── */

interface Server {
  files: Map<string, Buffer>;
  manifest: Manifest | DesktopError;
  validate: Array<{ course_id: number; active: boolean }> | DesktopError;
  asked: string[];
  /** Cut a download off after this many bytes, once. */
  cutAt: number | null;
}

function setup(over: Partial<Server> = {}) {
  const db = new Database(join(dir, 'ws.db'));
  const vault = new Vault(Vault.generateKey());
  const server: Server = { files: new Map(), manifest: new DesktopError('NOT_FOUND', 'no'), validate: [], asked: [], cutAt: null, ...over };
  const http = {
    url: (p: string) => `https://ws.test${p}`,
    raw: async (_m: string, url: string, init: { headers?: Record<string, string>; signal?: AbortSignal }) => {
      const u = new URL(url);
      server.asked.push(`${u.pathname}${init.headers?.Range ? ` ${init.headers.Range}` : ''}`);
      const body = server.files.get(u.pathname);
      if (!body) return new Response('gone', { status: 403 });
      const m = /bytes=(\d+)-/.exec(init.headers?.Range ?? '');
      const from = m ? Number(m[1]) : 0;
      let slice = body.subarray(from);
      const len = slice.length;
      if (server.cutAt !== null) {
        slice = slice.subarray(0, server.cutAt);
        server.cutAt = null;
      }
      return new Response(new Uint8Array(slice), { status: m ? 206 : 200, headers: { 'content-length': String(len) } });
    },
    get: async (path: string) => {
      server.asked.push(`GET ${path}`);
      if (server.manifest instanceof DesktopError) throw server.manifest;
      return server.manifest;
    },
    post: async (path: string, body: unknown) => {
      server.asked.push(`POST ${path} ${JSON.stringify(body)}`);
      if (server.validate instanceof DesktopError) throw server.validate;
      return { courses: server.validate };
    },
  };
  let now = Date.parse('2026-09-29T08:00:00Z');
  const changed = vi.fn();
  // eslint-disable-next-line prefer-const
  let offline: ElearningOffline;
  const transfers = new TransferManager({
    db,
    vault: () => vault,
    http: http as never,
    userId: () => 'u7',
    downloadFolder: () => join(dir, 'Downloads'),
    hash: async () => ({ sha256: '', bytes: 0 }),
    canOpenFiles: () => true,
    audit: () => undefined,
    sink: (name) => offline.sink(name),
    retryDelay: () => 5,
  });
  offline = new ElearningOffline({
    db,
    vault: () => vault,
    http: http as never,
    transfers,
    root: join(dir, 'elearning'),
    userId: () => 'u7',
    allowed: () => ({ ok: true, reason: null }),
    changed,
    now: () => now,
  });
  return { db, server, transfers, offline, changed, tick: (ms: number) => (now += ms) };
}

const video = payload(CHUNK + 4321, 3);
const guide = payload(20_000, 5);

function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    course_id: 12,
    version: 1,
    revision: 7,
    total_bytes: video.length + guide.length,
    files: [
      { lesson_id: 40, file_id: 900, name: 'Welcome.mp4', mime: 'video/mp4', bytes: video.length, url: '/media/tokVideo123', protected: true },
      { lesson_id: 41, file_id: 901, name: 'Guide.pdf', mime: 'application/pdf', bytes: guide.length, url: '/media/tokGuide123', protected: false },
    ],
    license: { expires_at: '2026-12-31 23:59:59', encrypted: true },
    ...over,
  };
}

function kept(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk : (f: string) => out.push(f))(join(d, e.name));
  };
  try {
    walk(root);
  } catch {
    /* none */
  }
  return out;
}

describe('a course kept offline', () => {
  it('downloads the manifest’s files through the download manager, sealed, and plays them back with ranges', async () => {
    const { server, offline, transfers } = setup({ files: new Map([['/media/tokVideo123', video], ['/media/tokGuide123', guide]]), manifest: manifest() });
    const first = await offline.download(12, 'Cyber basics');
    expect(server.asked[0]).toBe('GET /api/elearning/v1/me/courses/12/download-manifest');
    expect(first.files.map((f) => [f.lessonId, f.protected])).toEqual([[40, true], [41, false]]);
    await vi.waitFor(() => expect(offline.list()[0]?.state).toBe('ready'));
    const course = offline.list()[0]!;
    expect(course).toMatchObject({ courseId: 12, title: 'Cyber basics', version: 1, revision: 7, expiresAt: '2026-12-31 23:59:59' });
    expect(course.files.every((f) => f.state === 'done')).toBe(true);

    // Both show in Transfers, kept inside WorkSuite — never in the downloads folder, never opened elsewhere.
    const list = transfers.list();
    expect(list).toHaveLength(2);
    expect(list.every((t) => t.destination === 'Kept in WorkSuite for offline learning' && t.state === 'done')).toBe(true);
    await expect(transfers.openFile(list[0]!.id)).rejects.toThrow(/kept inside WorkSuite/);
    await expect(transfers.reveal(list[0]!.id)).rejects.toThrow(/kept inside WorkSuite/);
    expect(() => statSync(join(dir, 'Downloads'))).toThrow();

    // On disk: sealed, nothing plain.
    const files = kept(join(dir, 'elearning'));
    expect(files).toHaveLength(2);
    for (const f of files) {
      const disk = readFileSync(f);
      expect(disk.indexOf(video.subarray(500, 564))).toBe(-1);
      expect(disk.indexOf(guide.subarray(500, 564))).toBe(-1);
    }

    const whole = await offline.serve(new Request('app://bundle/__local/elearning/12/40'), '/elearning/12/40');
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect((await consume(whole.body)).equals(video)).toBe(true);
    const part = await offline.serve(new Request('app://bundle/__local/elearning/12/40', { headers: { Range: `bytes=${CHUNK - 3}-${CHUNK + 9}` } }), '/elearning/12/40');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes ${CHUNK - 3}-${CHUNK + 9}/${video.length}`);
    expect((await consume(part.body)).equals(video.subarray(CHUNK - 3, CHUNK + 10))).toBe(true);
    expect((await offline.serve(new Request('app://x', { headers: { Range: 'bytes=99999999-' } }), '/elearning/12/40')).status).toBe(416);
    expect((await offline.serve(new Request('app://x'), '/elearning/12/99')).status).toBe(404);
    expect((await offline.serve(new Request('app://x', { method: 'POST' }), '/elearning/12/40')).status).toBe(405);
  });

  it('resumes an interrupted file from its last whole chunk, asking the server for the rest only', async () => {
    const { server, offline, transfers } = setup({ files: new Map([['/media/tokVideo123', video], ['/media/tokGuide123', guide]]), manifest: manifest(), cutAt: CHUNK + 100 });
    // Retried by hand here; the queue's own retries are the next test's.
    transfers.configure({ ...transfers.config(), autoRetry: false });
    await offline.download(12, 'Cyber basics');
    await vi.waitFor(() => expect(offline.list()[0]?.files[0]?.state).toBe('failed'));
    const failed = transfers.list().find((t) => t.state === 'failed')!;
    transfers.resume(failed.id);
    await vi.waitFor(() => expect(offline.list()[0]?.state).toBe('ready'));
    expect(server.asked).toContain(`/media/tokVideo123 bytes=${CHUNK}-`);
    const back = await offline.serve(new Request('app://x'), '/elearning/12/40');
    expect((await consume(back.body)).equals(video)).toBe(true);
  });

  it('an interrupted file is tried again by itself, from its last whole chunk', async () => {
    const { server, offline } = setup({ files: new Map([['/media/tokVideo123', video], ['/media/tokGuide123', guide]]), manifest: manifest(), cutAt: CHUNK + 100 });
    await offline.download(12, 'Cyber basics');
    await vi.waitFor(() => expect(offline.list()[0]?.state).toBe('ready'));
    expect(server.asked).toContain(`/media/tokVideo123 bytes=${CHUNK}-`);
  });

  it('keeps what it has when asked again, and drops what the course no longer lists', async () => {
    const { server, offline } = setup({ files: new Map([['/media/tokVideo123', video], ['/media/tokGuide123', guide]]), manifest: manifest() });
    await offline.download(12, 'Cyber basics');
    await vi.waitFor(() => expect(offline.list()[0]?.state).toBe('ready'));
    server.asked.length = 0;
    server.manifest = manifest({ files: [manifest().files[0]!] });
    await offline.download(12, 'Cyber basics');
    expect(server.asked.filter((a) => a.startsWith('/media/'))).toEqual([]);
    expect(offline.list()[0]!.files.map((f) => f.lessonId)).toEqual([40]);
    expect(kept(join(dir, 'elearning'))).toHaveLength(1);
  });

  it('removes a copy when the company turns offline copies off, and says the server’s sentence', async () => {
    const { server, offline } = setup({ files: new Map([['/media/tokVideo123', video], ['/media/tokGuide123', guide]]), manifest: manifest() });
    await offline.download(12, 'Cyber basics');
    await vi.waitFor(() => expect(offline.list()[0]?.state).toBe('ready'));
    server.manifest = new DesktopError('CONFLICT', 'Courses are not kept offline in this company.', 409, { code: 'offline_off' });
    await expect(offline.download(12, 'Cyber basics')).rejects.toThrow('Courses are not kept offline in this company.');
    expect(offline.list()).toEqual([]);
    expect(kept(join(dir, 'elearning'))).toEqual([]);
  });

  it('purges what the server says ended, and what it did not vouch for; an expired licence goes even offline', async () => {
    const { server, offline, tick } = setup({ files: new Map([['/media/tokVideo123', video], ['/media/tokGuide123', guide]]), manifest: manifest() });
    await offline.download(12, 'Cyber basics');
    server.manifest = manifest({ course_id: 13, license: { expires_at: '2026-09-30 00:00:00', encrypted: true } });
    await offline.download(13, 'Fire safety');
    await vi.waitFor(() => expect(offline.list().every((c) => c.state === 'ready')).toBe(true));

    server.validate = [{ course_id: 12, active: true }, { course_id: 13, active: true }];
    expect(await offline.validate()).toEqual({ kept: expect.arrayContaining([12, 13]), removed: [], asked: true });

    // Offline, a day later: course 13's licence has run out.
    tick(24 * 3600_000);
    server.validate = new DesktopError('NETWORK_UNREACHABLE', 'offline');
    const off = await offline.validate();
    expect(off).toEqual({ kept: [12], removed: [{ courseId: 13, reason: 'expired' }], asked: false });

    // Back online: the learner was withdrawn from 12.
    server.validate = [{ course_id: 12, active: false }];
    expect((await offline.validate()).removed).toEqual([{ courseId: 12, reason: 'ended' }]);
    expect(offline.list()).toEqual([]);
    expect(kept(join(dir, 'elearning'))).toEqual([]);
  });

  it('forgets everything a person kept here (a wipe, the app taken away)', async () => {
    const { offline, db } = setup({ files: new Map([['/media/tokVideo123', video], ['/media/tokGuide123', guide]]), manifest: manifest() });
    await offline.download(12, 'Cyber basics');
    await vi.waitFor(() => expect(offline.list()[0]?.state).toBe('ready'));
    await offline.wipeUser('u7');
    expect(offline.list()).toEqual([]);
    expect(db.all('SELECT * FROM elearning_offline')).toEqual([]);
    expect(kept(join(dir, 'elearning'))).toEqual([]);
  });

  it('keeps nothing where the device policy forbids offline data, and never serves a tampered copy', async () => {
    const { offline, server } = setup({ files: new Map([['/media/tokVideo123', video], ['/media/tokGuide123', guide]]), manifest: manifest() });
    await offline.download(12, 'Cyber basics');
    await vi.waitFor(() => expect(offline.list()[0]?.state).toBe('ready'));
    const file = kept(join(dir, 'elearning')).find((f) => statSync(f).size > CHUNK)!;
    const bytes = readFileSync(file);
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 40) ^ 1, bytes.length - 40);
    writeFileSync(file, bytes);
    const res = await offline.serve(new Request('app://x'), '/elearning/12/40');
    await expect(consume(res.body)).rejects.toThrow();

    const barred = new ElearningOffline({
      db: new Database(join(dir, 'other.db')),
      vault: () => new Vault(Vault.generateKey()),
      http: { get: vi.fn(), post: vi.fn() } as never,
      transfers: { keep: vi.fn(), cancel: vi.fn(), list: () => [] } as never,
      root: join(dir, 'x'),
      userId: () => 'u7',
      allowed: () => ({ ok: false, reason: 'Not on this computer.' }),
      changed: () => undefined,
    });
    await expect(barred.download(12, 'x')).rejects.toThrow('Not on this computer.');
    expect(server.asked.filter((a) => a.startsWith('GET')).length).toBe(1);
  });
});
