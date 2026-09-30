import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, open, rm, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { licenceEnded, parseOfflinePath, type OfflineCourse, type OfflineFileState, type OfflineLessonFile, type OfflineValidation } from '@shared/elearning-offline';
import type { Transfer } from '@shared/types';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { DownloadSink, SinkWriter, TransferManager } from './transfers';
import type { Vault } from './vault';

const log = logger('elearning-offline');

/**
 * eLearning's offline copies (the server's download manifest, WS-ELN-SRS-001
 * P1): a course's lesson files kept on this computer so they play without
 * WorkSuite.
 *
 *  - WHAT is the server's: `GET me/courses/{id}/download-manifest` lists each
 *    open lesson's file, its size and a signed address, says which may never
 *    leave the app (`protected`), and refuses (`offline_off`) when the company
 *    keeps no offline copies. Asking for it starts the server's credit clock
 *    for progress played offline.
 *  - HOW is the download manager's: each file is a transfer (Transfers shows
 *    it, pauses it, resumes it), written not to the downloads folder but here,
 *    sealed as it arrives.
 *  - KEPT ENCRYPTED: AES-256-GCM in 1 MiB chunks, each with its own random
 *    nonce and its index as associated data, under a key made for that file
 *    and kept only in the profile database's encrypted column (whose key is in
 *    the OS credential store). A chunk can be opened on its own, so a video
 *    seeks without the whole file being decrypted, and nothing plain touches
 *    the disk.
 *  - PLAYED INSIDE: `app://bundle/__local/elearning/{course}/{lesson}` serves
 *    the plain bytes, with ranges, to WorkSuite's own pages only. A copy is
 *    never opened in another app or revealed in a folder, protected or not.
 *  - GONE WHEN THE SERVER SAYS: `POST me/downloads/validate` lists courses
 *    whose learning ended (withdrawn, suspended, archived, offline turned off);
 *    their copies are removed. A licence past its end (the course's end date)
 *    is removed without asking. Signing out with WorkSuite's data removed,
 *    losing the app, or a remote wipe takes every copy.
 */

export const CHUNK = 1024 * 1024;
const NONCE = 12;
const TAG = 16;
const STRIDE = NONCE + CHUNK + TAG;
const MAGIC = Buffer.from('WSL1');
const HEADER = 8; // magic, chunk size

const BASE = '/api/elearning/v1';

function indexAad(i: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(i, 0);
  return b;
}

/** One chunk sealed: nonce ‖ ciphertext ‖ tag, bound to its place in the file. */
export function sealChunk(key: Buffer, index: number, plain: Uint8Array): Buffer {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(indexAad(index));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([nonce, body, c.getAuthTag()]);
}

/** One chunk opened; throws when it was changed, moved or sealed under another key. */
export function openChunk(key: Buffer, index: number, sealed: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE));
  d.setAAD(indexAad(index));
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  return Buffer.concat([d.update(sealed.subarray(NONCE, sealed.length - TAG)), d.final()]);
}

function header(): Buffer {
  const h = Buffer.alloc(HEADER);
  MAGIC.copy(h, 0);
  h.writeUInt32BE(CHUNK, 4);
  return h;
}

/** Complete chunks a sealed file holds (an interrupted write's last part does not count). */
export async function sealedChunks(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size < HEADER ? 0 : Math.floor((s.size - HEADER) / STRIDE);
  } catch {
    return 0;
  }
}

/**
 * Writes a file sealed chunk by chunk. `from` is where the plain bytes
 * resume: 0 starts a new file; a whole number of chunks goes on after them
 * (anything after is cut away first).
 */
export class SealWriter implements SinkWriter {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private index: number;
  private closed = false;

  private constructor(
    private readonly fh: FileHandle,
    private readonly key: Buffer,
    from: number,
  ) {
    this.index = Math.floor(from / CHUNK);
  }

  static async create(path: string, key: Buffer, from = 0): Promise<SealWriter> {
    if (from % CHUNK !== 0) throw new DesktopError('INTERNAL', 'A sealed copy resumes on a chunk boundary.');
    const fh = await open(path, from === 0 ? 'w' : 'r+', 0o600);
    if (from === 0) await fh.write(header(), 0, HEADER, 0);
    else await fh.truncate(HEADER + (from / CHUNK) * STRIDE);
    return new SealWriter(fh, key, from);
  }

  private async flushChunk(plain: Buffer): Promise<void> {
    const sealed = sealChunk(this.key, this.index, plain);
    await this.fh.write(sealed, 0, sealed.length, HEADER + this.index * STRIDE);
    this.index++;
  }

  async write(b: Uint8Array): Promise<void> {
    this.pending.push(Buffer.from(b));
    this.pendingBytes += b.byteLength;
    while (this.pendingBytes >= CHUNK) {
      const all = Buffer.concat(this.pending);
      await this.flushChunk(all.subarray(0, CHUNK));
      const rest = all.subarray(CHUNK);
      this.pending = rest.length ? [Buffer.from(rest)] : [];
      this.pendingBytes = rest.length;
    }
  }

  /** Complete: the last short chunk is sealed too. Not complete: it is dropped, and a resume starts after the whole ones. */
  async close(complete: boolean): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (complete && this.pendingBytes > 0) await this.flushChunk(Buffer.concat(this.pending));
      await this.fh.sync();
    } finally {
      this.pending = [];
      await this.fh.close();
    }
  }
}

async function readChunk(fh: FileHandle, key: Buffer, i: number, size: number): Promise<Buffer> {
  const len = Math.min(CHUNK, size - i * CHUNK);
  const buf = Buffer.alloc(NONCE + len + TAG);
  const { bytesRead } = await fh.read(buf, 0, buf.length, HEADER + i * STRIDE);
  if (bytesRead !== buf.length) throw new DesktopError('NOT_FOUND', 'The offline copy is incomplete. Download the course again.');
  return openChunk(key, i, buf);
}

async function checkHeader(fh: FileHandle): Promise<void> {
  const h = Buffer.alloc(HEADER);
  await fh.read(h, 0, HEADER, 0);
  if (!h.subarray(0, 4).equals(MAGIC) || h.readUInt32BE(4) !== CHUNK) throw new DesktopError('NOT_FOUND', 'The offline copy cannot be read. Download the course again.');
}

/** Plain bytes `start`…`end` (inclusive) of a sealed file of `size` plain bytes. */
export async function readSealed(path: string, key: Buffer, size: number, start: number, end: number): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    await checkHeader(fh);
    const out: Buffer[] = [];
    for (let i = Math.floor(start / CHUNK); i <= Math.floor(end / CHUNK); i++) {
      const plain = await readChunk(fh, key, i, size);
      const from = Math.max(0, start - i * CHUNK);
      const to = Math.min(plain.length, end - i * CHUNK + 1);
      out.push(plain.subarray(from, to));
    }
    return Buffer.concat(out);
  } finally {
    await fh.close();
  }
}

/** The same bytes as a stream, a chunk at a time, for a whole video without holding it in memory. */
export function sealedStream(path: string, key: Buffer, size: number, start: number, end: number): ReadableStream<Uint8Array> {
  let fh: FileHandle | null = null;
  let i = Math.floor(start / CHUNK);
  const last = Math.floor(end / CHUNK);
  const done = async () => {
    const h = fh;
    fh = null;
    await h?.close().catch(() => undefined);
  };
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        if (!fh) {
          fh = await open(path, 'r');
          await checkHeader(fh);
        }
        if (i > last) {
          await done();
          ctrl.close();
          return;
        }
        const plain = await readChunk(fh, key, i, size);
        const from = Math.max(0, start - i * CHUNK);
        const to = Math.min(plain.length, end - i * CHUNK + 1);
        ctrl.enqueue(new Uint8Array(plain.subarray(from, to)));
        i++;
      } catch (e) {
        await done();
        ctrl.error(e);
      }
    },
    async cancel() {
      await done();
    },
  });
}

/** A single `Range: bytes=…` over `size` bytes: the span, null for the whole file, or 'invalid' (416). */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  if (size === 0) return 'invalid';
  if (m[1] === '') {
    const n = Math.min(Number(m[2]), size);
    return n <= 0 ? 'invalid' : { start: size - n, end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start >= size || end < start ? 'invalid' : { start, end };
}

// ── what is kept ────────────────────────────────────────────────────────

interface KeptFile {
  lessonId: number;
  fileId: number;
  name: string;
  mime: string | null;
  bytes: number;
  protected: boolean;
  /** base64 of the file's own AES-256 key. */
  key: string;
  transferId: string | null;
  /** Plain bytes once kept whole. */
  kept: number | null;
  error: string | null;
}

interface KeptCourse {
  courseId: number;
  title: string;
  version: number;
  revision: number;
  totalBytes: number;
  expiresAt: string | null;
  downloadedAt: string;
  validatedAt: string | null;
  files: KeptFile[];
}

export interface Manifest {
  course_id: number;
  version: number;
  revision: number;
  total_bytes: number;
  files: Array<{ lesson_id: number; file_id: number; name: string; mime: string | null; bytes: number; url: string; protected: boolean }>;
  license: { expires_at: string | null; encrypted: boolean };
}

export interface ElearningOfflineDeps {
  db: Database;
  vault: () => Vault;
  http: Pick<HttpClient, 'get' | 'post'>;
  transfers: Pick<TransferManager, 'keep' | 'cancel' | 'list'>;
  /** Where copies live: inside the profile, never beside the person's own files. */
  root: string;
  userId: () => string | null;
  /** The device policy's word on offline data (a device may be barred from keeping any). */
  allowed: () => { ok: boolean; reason: string | null };
  changed: () => void;
  now?: () => number;
}

const SINK = /^elearning:(\d{1,10}):(\d{1,10}):(\d{1,10})$/;

export class ElearningOffline {
  constructor(private readonly deps: ElearningOfflineDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private dir(uid: string, courseId?: number): string {
    const who = createHash('sha256').update(uid).digest('hex').slice(0, 24);
    return courseId === undefined ? join(this.deps.root, who) : join(this.deps.root, who, String(courseId));
  }

  private pathOf(uid: string, courseId: number, f: Pick<KeptFile, 'fileId' | 'lessonId'>): string {
    return join(this.dir(uid, courseId), `${f.lessonId}-${f.fileId}.wsl`);
  }

  private load(uid: string, courseId: number): KeptCourse | null {
    const row = this.deps.db.get<{ meta: string }>('SELECT meta FROM elearning_offline WHERE user_id = ? AND course_id = ?', uid, courseId);
    return row ? (this.deps.vault().decrypt<KeptCourse>(row.meta) ?? null) : null;
  }

  private all(uid: string): KeptCourse[] {
    return this.deps.db
      .all<{ meta: string }>('SELECT meta FROM elearning_offline WHERE user_id = ? ORDER BY updated_at DESC', uid)
      .map((r) => this.deps.vault().decrypt<KeptCourse>(r.meta))
      .filter((c): c is KeptCourse => !!c);
  }

  private save(uid: string, c: KeptCourse): void {
    this.deps.db.run(
      `INSERT INTO elearning_offline (user_id, course_id, meta, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, course_id) DO UPDATE SET meta = excluded.meta, updated_at = excluded.updated_at`,
      uid,
      c.courseId,
      this.deps.vault().encrypt(c),
      new Date(this.now()).toISOString(),
    );
  }

  private me(): string {
    const uid = this.deps.userId();
    if (!uid) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to WorkSuite first.');
    return uid;
  }

  // ── what the renderer sees ────────────────────────────────────────────

  private view(c: KeptCourse, transfers: Map<string, Transfer>): OfflineCourse {
    const files: OfflineLessonFile[] = c.files.map((f) => {
      const t = f.transferId ? transfers.get(f.transferId) : undefined;
      const state: OfflineFileState = f.kept !== null ? 'done' : t ? (t.state === 'done' ? 'running' : t.state) : 'failed';
      return {
        lessonId: f.lessonId,
        fileId: f.fileId,
        name: f.name,
        mime: f.mime,
        bytes: f.bytes,
        protected: f.protected,
        state,
        kept: f.kept ?? t?.bytes ?? 0,
        error: f.kept !== null ? null : (t?.error ?? f.error ?? (t ? null : 'Stopped before it finished.')),
      };
    });
    const running = files.some((f) => f.state === 'queued' || f.state === 'running');
    return {
      courseId: c.courseId,
      title: c.title,
      version: c.version,
      revision: c.revision,
      totalBytes: c.totalBytes,
      files,
      expiresAt: c.expiresAt,
      downloadedAt: c.downloadedAt,
      validatedAt: c.validatedAt,
      state: files.every((f) => f.state === 'done') ? 'ready' : running ? 'downloading' : 'partial',
    };
  }

  list(): OfflineCourse[] {
    const uid = this.deps.userId();
    if (!uid) return [];
    const transfers = new Map(this.deps.transfers.list().map((t) => [t.id, t]));
    return this.all(uid).map((c) => this.view(c, transfers));
  }

  // ── taking a course offline ───────────────────────────────────────────

  async download(courseId: number, title: string): Promise<OfflineCourse> {
    const uid = this.me();
    const may = this.deps.allowed();
    if (!may.ok) throw new DesktopError('POLICY_DENIED', may.reason ?? 'This computer may not keep WorkSuite data offline.');
    let m: Manifest;
    try {
      m = await this.deps.http.get<Manifest>(`${BASE}/me/courses/${courseId}/download-manifest`);
    } catch (e) {
      // The company keeps no offline copies: what is here goes too.
      if (isDesktopError(e) && (e.data as { code?: string } | null)?.code === 'offline_off') await this.remove(courseId);
      throw e;
    }
    const before = this.load(uid, courseId);
    const keep = new Map((before?.files ?? []).map((f) => [`${f.lessonId}:${f.fileId}`, f]));
    await mkdir(this.dir(uid, courseId), { recursive: true, mode: 0o700 });
    const files: KeptFile[] = [];
    for (const f of m.files) {
      const had = keep.get(`${f.lesson_id}:${f.file_id}`);
      keep.delete(`${f.lesson_id}:${f.file_id}`);
      // Already kept whole, and the same size: kept as it is.
      if (had && had.kept !== null && had.bytes === f.bytes) {
        files.push({ ...had, name: f.name, mime: f.mime, protected: f.protected });
        continue;
      }
      if (had?.transferId) await this.deps.transfers.cancel(had.transferId).catch(() => undefined);
      files.push({
        lessonId: f.lesson_id,
        fileId: f.file_id,
        name: f.name,
        mime: f.mime,
        bytes: f.bytes,
        protected: f.protected,
        key: randomBytes(32).toString('base64'),
        transferId: null,
        kept: null,
        error: null,
      });
    }
    // Files the course no longer lists are not kept.
    for (const gone of keep.values()) await this.dropFile(uid, courseId, gone);
    const course: KeptCourse = {
      courseId,
      title,
      version: Number(m.version),
      revision: Number(m.revision),
      totalBytes: Number(m.total_bytes),
      expiresAt: m.license?.expires_at ?? null,
      downloadedAt: new Date(this.now()).toISOString(),
      validatedAt: new Date(this.now()).toISOString(),
      files,
    };
    this.save(uid, course);
    const byLesson = new Map(m.files.map((f) => [`${f.lesson_id}:${f.file_id}`, f]));
    for (const f of course.files) {
      if (f.kept !== null) continue;
      const src = byLesson.get(`${f.lessonId}:${f.fileId}`)!;
      try {
        const t = await this.deps.transfers.keep(src.url, f.name, `elearning:${courseId}:${f.lessonId}:${f.fileId}`);
        f.transferId = t.id;
      } catch (e) {
        f.error = isDesktopError(e) ? e.message : String(e);
      }
    }
    this.save(uid, course);
    this.deps.changed();
    log.info('course taken offline', { course: courseId, files: files.length });
    return this.view(course, new Map(this.deps.transfers.list().map((t) => [t.id, t])));
  }

  private async dropFile(uid: string, courseId: number, f: KeptFile): Promise<void> {
    if (f.transferId && f.kept === null) await this.deps.transfers.cancel(f.transferId).catch(() => undefined);
    await rm(this.pathOf(uid, courseId, f), { force: true });
  }

  async remove(courseId: number, uid = this.me()): Promise<void> {
    const c = this.load(uid, courseId);
    if (c) for (const f of c.files) await this.dropFile(uid, courseId, f);
    await rm(this.dir(uid, courseId), { recursive: true, force: true });
    this.deps.db.run('DELETE FROM elearning_offline WHERE user_id = ? AND course_id = ?', uid, courseId);
    this.deps.changed();
  }

  /**
   * The purge rules: licences past their end go at once; then the server says
   * which of the rest may stay. Offline, only the licences are applied.
   */
  async validate(): Promise<OfflineValidation> {
    const uid = this.deps.userId();
    if (!uid) return { kept: [], removed: [], asked: false };
    const removed: OfflineValidation['removed'] = [];
    let courses = this.all(uid);
    for (const c of courses) {
      if (licenceEnded(c.expiresAt, this.now())) {
        await this.remove(c.courseId, uid);
        removed.push({ courseId: c.courseId, reason: 'expired' });
      }
    }
    courses = this.all(uid);
    if (courses.length === 0) return { kept: [], removed, asked: false };
    let answer: { courses: Array<{ course_id: number; active: boolean }> };
    try {
      answer = await this.deps.http.post(`${BASE}/me/downloads/validate`, { course_ids: courses.map((c) => c.courseId) });
    } catch (e) {
      if (isDesktopError(e) && e.code === 'NETWORK_UNREACHABLE') return { kept: courses.map((c) => c.courseId), removed, asked: false };
      throw e;
    }
    const active = new Map((answer.courses ?? []).map((r) => [Number(r.course_id), r.active === true]));
    const kept: number[] = [];
    for (const c of courses) {
      // A course the server did not answer for is not one it vouched for.
      if (active.get(c.courseId) !== true) {
        await this.remove(c.courseId, uid);
        removed.push({ courseId: c.courseId, reason: 'ended' });
      } else {
        c.validatedAt = new Date(this.now()).toISOString();
        this.save(uid, c);
        kept.push(c.courseId);
      }
    }
    if (removed.length) log.info('offline courses removed', { removed: removed.length });
    this.deps.changed();
    return { kept, removed, asked: true };
  }

  /** Every copy a person has here (sign-out with data removed, a remote wipe, the app taken away). */
  async wipeUser(uid: string): Promise<void> {
    const n = Number(this.deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM elearning_offline WHERE user_id = ?', uid)?.n ?? 0);
    if (n === 0) return;
    for (const c of this.all(uid)) for (const f of c.files) if (f.transferId && f.kept === null) await this.deps.transfers.cancel(f.transferId).catch(() => undefined);
    this.deps.db.run('DELETE FROM elearning_offline WHERE user_id = ?', uid);
    await rm(this.dir(uid), { recursive: true, force: true });
    this.deps.changed();
  }

  // ── the download manager's side ───────────────────────────────────────

  /** Where a transfer named `elearning:{course}:{lesson}:{file}` writes, for whoever is signed in. */
  sink(name: string): DownloadSink | null {
    const m = SINK.exec(name);
    const uid = this.deps.userId();
    if (!m || !uid) return null;
    const courseId = Number(m[1]);
    const lessonId = Number(m[2]);
    const fileId = Number(m[3]);
    const find = () => this.load(uid, courseId)?.files.find((f) => f.lessonId === lessonId && f.fileId === fileId) ?? null;
    const f = find();
    if (!f) return null;
    const path = this.pathOf(uid, courseId, f);
    const key = Buffer.from(f.key, 'base64');
    return {
      resumeFrom: async () => (await sealedChunks(path)) * CHUNK,
      open: async (offset) => {
        await mkdir(this.dir(uid, courseId), { recursive: true, mode: 0o700 });
        const w = await SealWriter.create(path, key, offset);
        return {
          write: (b) => w.write(b),
          close: async (complete, total) => {
            await w.close(complete);
            if (!complete) return;
            const c = this.load(uid, courseId);
            const kept = c?.files.find((x) => x.lessonId === lessonId && x.fileId === fileId);
            if (!c || !kept) return;
            kept.kept = total;
            kept.bytes = total;
            kept.error = null;
            this.save(uid, c);
            this.deps.changed();
          },
        };
      },
      discard: () => rm(path, { force: true }),
    };
  }

  // ── playing a kept file ───────────────────────────────────────────────

  /** `app://bundle/__local/elearning/{course}/{lesson}` → the plain bytes (ranges honoured). */
  async serve(request: Request, path: string): Promise<Response> {
    const plain = (status: number, text: string) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Read only.');
    const ref = parseOfflinePath(path);
    if (!ref) return plain(404, 'Not found.');
    const uid = this.deps.userId();
    if (!uid) return plain(401, 'Not signed in.');
    if (!this.deps.allowed().ok) return plain(403, 'This computer may not keep WorkSuite data offline.');
    const c = this.load(uid, ref.courseId);
    if (!c) return plain(404, 'This course is not kept on this computer.');
    if (licenceEnded(c.expiresAt, this.now())) {
      await this.remove(c.courseId, uid);
      return plain(410, 'The offline copy of this course has expired.');
    }
    const f = c.files.find((x) => x.lessonId === ref.lessonId);
    if (!f || f.kept === null) return plain(404, 'This lesson is not kept on this computer yet.');
    const size = f.kept;
    const range = parseRange(request.headers.get('range'), size);
    const headers: Record<string, string> = {
      'Content-Type': f.mime || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    };
    if (range === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    const key = Buffer.from(f.key, 'base64');
    const file = this.pathOf(uid, c.courseId, f);
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    const body = request.method === 'HEAD' || size === 0 ? null : sealedStream(file, key, size, start, end);
    return new Response(body, { status: range ? 206 : 200, headers });
  }
}
