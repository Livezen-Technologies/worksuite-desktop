import { shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, openAsBlob } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { PickedFile, UploadTarget } from '@shared/ipc/contract';
import type { DrivePrefs, Transfer, TransferState } from '@shared/types';
import { bytesPerSecond } from '@shared/transfers';
import { backoffDelay } from '@shared/backoff';
import { numberedName, safeFileName } from '@shared/filename';
import { mimeFor } from '@shared/mime';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import { isMediaPath } from './api-proxy';
import { OFFICE_EXPORT_TOKEN } from '@shared/office';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { Vault } from './vault';
import { TokenBucket } from './throttle';

const log = logger('transfers');

/**
 * DesktopDownloadManager / DesktopUploadManager (FR-XFR-01/02/03, AC-10).
 *
 * One queue for every module (worksuite-desktop#94): at most two files move at
 * once unless Drive › Settings says otherwise, the rest wait their turn in the
 * order they were asked for, and the next starts by itself whenever one ends,
 * is paused or is cancelled. A failure the network or a busy server caused is
 * tried again a few times, later, without holding a place from the files
 * behind it. The queue is kept in the database, so it carries on after a
 * restart, from where each file got to. Uploads are chunked through WorkSuite's upload
 * API (init → chunk × n → complete), resumable from the server's own list of
 * received chunks, with retry backoff. Downloads stream to a temporary file
 * beside the destination and are renamed into place only when complete, so
 * an interrupted download never leaves a half-written file under the real
 * name (FR-SYNC-10's atomic-move rule, applied to downloads too).
 *
 * The renderer never names a path. Uploads take handles this process issued
 * for a dialog result or a real drop; downloads go to the download folder.
 */

interface Handle {
  path: string;
  name: string;
  size: number;
  relativePath?: string;
}

interface Meta {
  path: string | null;
  fileId: string | null;
  /** API path the download is fetched from (built by the main process). */
  source?: string | null;
  uploadId: string | null;
  target: UploadTarget | null;
  chunkSize: number | null;
  totalChunks: number | null;
  sha256: string | null;
  tempPath: string | null;
  finalPath: string | null;
  openWhenDone: boolean;
  /** Inside an uploaded folder: where the server puts it, folders made as needed. */
  relativePath?: string | null;
  /** Kept inside the app, not in the downloads folder: the name of the sink that takes the bytes (`deps.sink`). */
  sink?: string | null;
  /** When it last joined the queue: the order it starts in, also after a restart. */
  queuedAt?: string | null;
  /** Waiting to be tried again by itself, from then. */
  retryAt?: string | null;
  /** Times it has been tried again by itself since it was last started by hand. */
  attempts?: number;
  /** Its last failure was the network's or a busy server's: worth trying again once the connection is back. */
  temporary?: boolean;
  /** Paused because the connection was lost, to be resumed by hand (Drive › Settings › auto-resume off). */
  waitingFor?: 'connection' | null;
  /** The place the person chose for it, when they were asked where to save (main-process dialog only). */
  exactPath?: string | null;
  /** The server has the whole upload (`complete` answered): trying again never sends it a second time. */
  completed?: boolean;
}

/**
 * Where a download kept inside the app goes instead of the downloads folder
 * (eLearning's offline copies): it takes the bytes as they arrive and says
 * how much an earlier attempt kept, so a resume asks the server from there.
 */
export interface DownloadSink {
  /** Bytes already kept that this attempt can go on after (0: start again). */
  resumeFrom(): Promise<number>;
  /** Opened at `offset`: what `resumeFrom` said, or 0 when the server sent the whole file again. */
  open(offset: number): Promise<SinkWriter>;
  discard(): Promise<void>;
}

export interface SinkWriter {
  write(b: Uint8Array): Promise<void>;
  /** `complete`: every byte arrived (`total` of them); otherwise what arrived whole is kept for a resume. */
  close(complete: boolean, total: number): Promise<void>;
}

interface Live {
  t: Transfer;
  meta: Meta;
  abort: AbortController | null;
  samples: Array<{ at: number; bytes: number }>;
}

/** A short-lived download grant the server minted for one file (`/d/{token}`, e.g. a task's attachment). */
export function isGrantPath(path: string): boolean {
  return /^\/d\/[A-Za-z0-9]{16,128}$/.test(path);
}

export interface TransferDeps {
  db: Database;
  vault: () => Vault;
  http: HttpClient;
  userId: () => string | null;
  downloadFolder: () => string;
  hash: (path: string) => Promise<{ sha256: string; bytes: number }>;
  canOpenFiles: () => boolean;
  audit: (action: string, details: Record<string, unknown>) => void;
  /** The sink a download kept inside the app writes to, by the name it was started with. */
  sink?: (name: string) => DownloadSink | null;
  /**
   * Opens a finished download inside WorkSuite when it can (PDFs in PDF
   * Studio); false leaves it to the system's own application.
   */
  openInApp?: (path: string) => boolean;
  /** Says that a transfer the person started has finished or failed (Drive › Settings › Notifications). */
  notify?: (t: Transfer, how: 'done' | 'failed') => void;
  /** How long before the n-th automatic retry (0 first); tests make it short. */
  retryDelay?: (attempt: number) => number;
}

/** How the queue runs: Drive › Settings, as the transfer manager takes it. */
export interface QueueConfig {
  maxConcurrent: number;
  maxUploads: number | null;
  maxDownloads: number | null;
  /** Combined bytes a second for every upload, every download; null is Unlimited. */
  uploadBps: number | null;
  downloadBps: number | null;
  autoRetry: boolean;
  autoResume: boolean;
  metered: 'normal' | 'limit' | 'pause';
}

export function queueConfig(p: DrivePrefs): QueueConfig {
  return {
    maxConcurrent: p.maxConcurrent,
    maxUploads: p.maxUploads,
    maxDownloads: p.maxDownloads,
    uploadBps: bytesPerSecond(p.uploadLimit),
    downloadBps: bytesPerSecond(p.downloadLimit),
    autoRetry: p.autoRetry,
    autoResume: p.autoResume,
    metered: p.metered,
  };
}

/** Automatic tries after a temporary failure, before it is left for the person to retry. */
export const MAX_AUTO_RETRIES = 4;

/** An answer worth asking again later: the server busy, overloaded or out of reach for a moment. */
export function isTemporaryStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/**
 * A failure the network or a busy server caused — a dropped connection, a
 * timeout, a 5xx — as opposed to one trying again would only repeat (a file
 * that is gone, a permission refused, a disk that is full).
 */
export function isTemporaryFailure(e: unknown): boolean {
  if (isDesktopError(e)) return e.code === 'NETWORK_UNREACHABLE' || e.code === 'RATE_LIMITED' || (e.code === 'SERVER_ERROR' && e.status !== null && isTemporaryStatus(e.status));
  const err = e as { message?: unknown; cause?: unknown; code?: unknown } | null;
  const text = `${String(err?.message ?? e)} ${String(err?.cause ?? '')} ${String(err?.code ?? '')}`;
  return /ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH|UND_ERR|socket|terminated|fetch failed|network|timed? ?out/i.test(text);
}

class Temporary extends Error {}

function messageOf(e: unknown): string {
  return isDesktopError(e) ? e.message : String((e as Error)?.message ?? e);
}

const MAX_UPLOAD = 5 * 1024 * 1024 * 1024;

/** An Office export's signed download (`/office/exports/{token}`, ten minutes, web-api §8): fetched from our own server. */
export function isOfficeExportPath(apiPath: string): boolean {
  const m = /^\/office\/exports\/([^/?#]+)$/.exec(apiPath);
  return !!m && OFFICE_EXPORT_TOKEN.test(m[1]!);
}

/** How a download that someone is waiting for ended (a copy to open in another app). */
export type DownloadOutcome = { path: string } | { error: string };
const MAX_FOLDER_FILES = 2000;

/**
 * Every file under a folder, depth first, with its path inside the folder
 * (the folder's own name first). Hidden files, symbolic links and anything
 * past 20 levels are left out.
 */
export async function walkFolder(root: string): Promise<Array<{ path: string; size: number; relativePath: string }>> {
  const out: Array<{ path: string; size: number; relativePath: string }> = [];
  const top = basename(root);
  const visit = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > 20 || out.length > MAX_FOLDER_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await visit(full, `${rel}/${e.name}`, depth + 1);
      else if (e.isFile()) out.push({ path: full, size: (await stat(full)).size, relativePath: `${rel}/${e.name}` });
    }
  };
  await visit(root, top, 0);
  return out;
}
const CHUNK = 8 * 1024 * 1024;
const MIN_CHUNK = 256 * 1024;

/**
 * The size of each part an upload is sent in. Progress moves when a part is
 * in, so a file smaller than one part sat at 0% until it was done: parts are
 * about a twentieth of the file (at least 256 KB, at most 8 MB), and a
 * document shows its way up instead of jumping from nothing to finished.
 */
export function chunkSizeFor(size: number): number {
  const twentieth = Math.ceil(Math.max(0, size) / 20);
  return Math.min(CHUNK, Math.max(MIN_CHUNK, Math.ceil(twentieth / MIN_CHUNK) * MIN_CHUNK));
}
/** The largest file offered in a remote-control session: it goes in one request. */
const REMOTE_MAX = 512 * 1024 * 1024;

/**
 * Files an uploaded Drive file on a tender, the way the web's tender screens
 * do: a new document, a checklist line's next version, a document's
 * replacement, or a bond's copy. The server checks the tender, the caller's
 * attachment permission and that the file is theirs to attach.
 */
export async function fileOnTender(http: Pick<HttpClient, 'post' | 'request'>, target: Extract<UploadTarget, { kind: 'tender' }>, fileId: number, name: string): Promise<void> {
  if (target.into === 'document') {
    await http.post(`/api/tenders/${target.tenderId}/documents`, { file_id: fileId, kind: target.docKind ?? 'other', title: name });
    return;
  }
  if (!target.id) throw new DesktopError('IPC_VALIDATION_FAILED', 'Which line, document or bond is this for?');
  if (target.into === 'line') await http.post(`/api/tenders/checklist/${target.id}/file`, { file_id: fileId, name });
  else if (target.into === 'replace') await http.request('PUT', `/api/tenders/documents/${target.id}`, { body: { file_id: fileId } });
  else await http.request('PUT', `/api/tenders/securities/${target.id}`, { body: { file_id: fileId } });
}

export class TransferManager {
  private handles = new Map<string, Handle>();
  private live = new Map<string, Live>();
  private emitTimer: NodeJS.Timeout | null = null;
  /** Downloads a service waits for (Office's copies for another app): told once, when they end. */
  private whenDone = new Map<string, (outcome: DownloadOutcome) => void>();
  /** Uploads a service waits for (a meeting recording): told once, when they end. */
  private uploadDone = new Map<string, (outcome: { fileId: string | null } | { error: string }) => void>();
  /** Transfers waiting for a free slot, first asked first started. */
  private queue: string[] = [];
  private cfg: QueueConfig = { maxConcurrent: 2, maxUploads: null, maxDownloads: null, uploadBps: null, downloadBps: null, autoRetry: true, autoResume: true, metered: 'limit' };
  /** One cap for every upload and one for every download, whatever module started them. */
  private buckets = { upload: new TokenBucket(null), download: new TokenBucket(null) };
  private offline = false;
  private metered = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private pumping = false;
  private pumpAgain = false;
  onChanged: (list: Transfer[]) => void = () => undefined;

  constructor(private readonly deps: TransferDeps) {}

  // ── handles ────────────────────────────────────────────────────────────

  /**
   * Validates user-chosen paths and returns opaque handles for them. A folder
   * is opened up: every file in it (not hidden ones, not through links) gets
   * a handle carrying its path inside the folder, the folder's name first.
   */
  async register(paths: string[]): Promise<PickedFile[]> {
    const out: PickedFile[] = [];
    const add = (real: string, size: number, relativePath?: string) => {
      if (size > MAX_UPLOAD) throw new DesktopError('IPC_VALIDATION_FAILED', `${basename(real)} is larger than 5 GB.`);
      const handle = randomUUID();
      this.handles.set(handle, { path: real, name: basename(real), size, ...(relativePath ? { relativePath } : {}) });
      out.push({ handle, name: basename(real), size, ...(relativePath ? { relativePath } : {}) });
    };
    for (const p of paths) {
      try {
        const real = await realpath(p);
        const st = await lstat(real);
        if (st.isFile()) add(real, st.size);
        else if (st.isDirectory()) {
          for (const f of await walkFolder(real)) {
            if (out.length >= MAX_FOLDER_FILES) throw new DesktopError('IPC_VALIDATION_FAILED', `That folder has more than ${MAX_FOLDER_FILES.toLocaleString()} files. Upload it in parts.`);
            add(f.path, f.size, f.relativePath);
          }
        }
      } catch (e) {
        if (isDesktopError(e)) throw e;
        log.info('dropped path rejected', { error: String(e) });
      }
    }
    // Handles expire: they are for the gesture that produced them.
    setTimeout(() => out.forEach((f) => this.handles.delete(f.handle)), 30 * 60_000).unref?.();
    return out;
  }

  // ── settings ───────────────────────────────────────────────────────────

  /**
   * Drive › Settings, applied at once: a lower limit lets what is moving
   * finish and holds the next ones until there is room; a new cap slows (or
   * frees) the transfers already moving.
   */
  configure(cfg: QueueConfig): void {
    this.cfg = { ...cfg };
    this.buckets.upload.setRate(cfg.uploadBps);
    this.buckets.download.setRate(cfg.downloadBps);
    if (this.metered && cfg.metered === 'pause') this.setAside();
    this.pump();
    this.emit();
  }

  config(): QueueConfig {
    return { ...this.cfg };
  }

  /** The shared caps, for the transfers that move bytes (and tests). */
  get throttles(): { upload: TokenBucket; download: TokenBucket } {
    return this.buckets;
  }

  /**
   * The server went out of reach, or came back. While it is away nothing new
   * starts. When it is back, transfers it interrupted carry on — or, with
   * auto-resume off, wait paused for the person.
   */
  setOnline(online: boolean): void {
    if (online === !this.offline) return;
    this.offline = !online;
    if (!online) {
      if (!this.cfg.autoResume) {
        for (const l of [...this.live.values()]) {
          if (l.t.state !== 'running' && l.t.state !== 'queued') continue;
          l.meta.waitingFor = 'connection';
          this.pauseLive(l, 'The connection was lost. Resume to continue.');
        }
      }
      return;
    }
    if (this.cfg.autoResume) {
      // What the connection loss made fail, after its own tries, goes back in the queue too.
      for (const r of this.rows("state = 'failed'")) {
        const meta = this.deps.vault().decrypt<Meta>(r.meta);
        if (meta?.temporary) this.resume(r.id);
      }
    }
    this.pump();
  }

  /** The connection is metered (or no longer): Drive › Settings says whether to carry on, go one at a time, or wait. */
  setMetered(metered: boolean): void {
    if (metered === this.metered) return;
    this.metered = metered;
    if (metered && this.cfg.metered === 'pause') this.setAside();
    this.pump();
    this.emit();
  }

  // ── state ──────────────────────────────────────────────────────────────

  private rows(where: string): Array<{ id: string; direction: string; name: string; meta: string; bytes: number; total: number; state: string; error: string | null; created_at: string }> {
    const uid = this.deps.userId();
    if (!uid) return [];
    return this.deps.db.all(`SELECT * FROM transfers WHERE user_id = ? AND ${where} ORDER BY created_at ASC`, uid);
  }

  private view(l: Live): Transfer {
    const at = this.queue.indexOf(l.t.id);
    return { ...l.t, position: at >= 0 ? at + 1 : null, retryAt: l.meta.retryAt ?? null, attempts: l.meta.attempts ?? 0 };
  }

  list(): Transfer[] {
    const uid = this.deps.userId();
    if (!uid) return [];
    const rows = this.deps.db.all<{ id: string; direction: string; name: string; meta: string; bytes: number; total: number; state: string; error: string | null; created_at: string }>(
      'SELECT * FROM transfers WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
      uid,
    );
    return rows.map((r) => {
      const l = this.live.get(r.id);
      if (l) return this.view(l);
      const m = this.deps.vault().decrypt<Meta>(r.meta);
      return {
        id: r.id,
        direction: r.direction as Transfer['direction'],
        name: r.name,
        source: r.direction === 'upload' ? (m?.path ?? '') : 'WorkSuite',
        destination: r.direction === 'download' ? (m?.sink ? 'Kept in WorkSuite for offline learning' : (m?.finalPath ?? '')) : 'WorkSuite',
        bytes: Number(r.bytes),
        total: Number(r.total),
        state: r.state as TransferState,
        speed: 0,
        error: r.error,
        createdAt: r.created_at,
        position: null,
        retryAt: null,
        attempts: m?.attempts ?? 0,
      };
    });
  }

  activeCounts(): { uploads: number; downloads: number } {
    let uploads = 0;
    let downloads = 0;
    for (const l of this.live.values()) {
      if (l.t.state === 'running' || l.t.state === 'queued') {
        if (l.t.direction === 'upload') uploads++;
        else downloads++;
      }
    }
    return { uploads, downloads };
  }

  private persist(l: Live): void {
    const uid = this.deps.userId();
    if (!uid) return;
    this.deps.db.run(
      `INSERT INTO transfers (id, user_id, direction, name, meta, bytes, total, state, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET meta = excluded.meta, bytes = excluded.bytes, total = excluded.total,
         state = excluded.state, error = excluded.error, updated_at = excluded.updated_at`,
      l.t.id,
      uid,
      l.t.direction,
      l.t.name,
      this.deps.vault().encrypt(l.meta),
      l.t.bytes,
      l.t.total,
      l.t.state,
      l.t.error,
      l.t.createdAt,
      new Date().toISOString(),
    );
  }

  private emit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.onChanged(this.list());
    }, 250);
  }

  private progress(l: Live, bytes: number): void {
    l.t.bytes = bytes;
    const now = Date.now();
    l.samples.push({ at: now, bytes });
    while (l.samples.length > 2 && now - l.samples[0]!.at > 3000) l.samples.shift();
    const first = l.samples[0]!;
    const dt = (now - first.at) / 1000;
    l.t.speed = dt > 0.2 ? Math.max(0, (bytes - first.bytes) / dt) : l.t.speed;
    this.emit();
  }

  private finish(l: Live, state: TransferState, error: string | null = null): void {
    l.t.state = state;
    l.t.error = error;
    l.t.speed = 0;
    l.abort = null;
    if (state !== 'queued') l.meta.retryAt = null;
    this.dequeue(l.t.id);
    this.persist(l);
    if (state !== 'running' && state !== 'queued') this.live.delete(l.t.id);
    this.emit();
    const waited = this.uploadDone.has(l.t.id) || this.whenDone.has(l.t.id);
    const up = this.uploadDone.get(l.t.id);
    if (up && (state === 'done' || state === 'failed' || state === 'cancelled')) {
      this.uploadDone.delete(l.t.id);
      up(state === 'done' ? { fileId: l.meta.fileId } : { error: error ?? (state === 'cancelled' ? 'The upload was cancelled.' : 'The upload did not finish.') });
    }
    const then = this.whenDone.get(l.t.id);
    if (then && (state === 'done' || state === 'failed' || state === 'cancelled')) {
      this.whenDone.delete(l.t.id);
      then(state === 'done' && l.meta.finalPath ? { path: l.meta.finalPath } : { error: error ?? (state === 'cancelled' ? 'The download was cancelled.' : 'The download did not finish.') });
    }
    // The person hears about their own transfers; a service waiting for one, or a course's lesson files, say so themselves.
    if ((state === 'done' || state === 'failed') && !waited && !l.meta.sink) this.deps.notify?.({ ...l.t }, state);
    // A slot is free: the next in line starts.
    this.pump();
  }

  /**
   * How a run ends, from inside it. A run that was paused, cancelled or set
   * aside since has nothing more to say. A temporary failure waits and is
   * tried again — at most a few times, each later than the last — without
   * keeping its slot from the files behind it.
   */
  private settle(l: Live, abort: AbortController, state: 'done' | 'failed', error: string | null = null, temporary = false): void {
    if (abort.signal.aborted || l.abort !== abort) return;
    if (state === 'failed') l.meta.temporary = temporary;
    if (state === 'done') {
      l.meta.attempts = 0;
      l.meta.temporary = false;
    }
    if (state === 'failed' && temporary && this.cfg.autoRetry && (l.meta.attempts ?? 0) < MAX_AUTO_RETRIES) return this.retryLater(l, error);
    this.finish(l, state, error);
  }

  private retryLater(l: Live, error: string | null): void {
    const attempt = l.meta.attempts ?? 0;
    l.meta.attempts = attempt + 1;
    const delay = this.deps.retryDelay ? this.deps.retryDelay(attempt) : backoffDelay(attempt, { baseMs: 2000, maxMs: 60_000, jitter: 0.5 });
    l.meta.retryAt = new Date(Date.now() + delay).toISOString();
    l.t.state = 'queued';
    l.t.error = error;
    l.t.speed = 0;
    l.abort = null;
    l.meta.queuedAt = new Date().toISOString();
    this.dequeue(l.t.id);
    this.queue.push(l.t.id);
    this.persist(l);
    this.emit();
    this.pump();
  }

  // ── the queue ──────────────────────────────────────────────────────────

  /** Into the queue, at the back; it starts when it is its turn and there is room. */
  private enqueue(l: Live): void {
    l.t.state = 'queued';
    l.t.speed = 0;
    l.meta.queuedAt = new Date().toISOString();
    l.meta.retryAt = null;
    this.live.set(l.t.id, l);
    this.dequeue(l.t.id);
    this.queue.push(l.t.id);
    this.persist(l);
    this.emit();
    this.pump();
  }

  private dequeue(id: string): void {
    const at = this.queue.indexOf(id);
    if (at >= 0) this.queue.splice(at, 1);
  }

  private running(): { all: number; upload: number; download: number } {
    const n = { all: 0, upload: 0, download: 0 };
    for (const l of this.live.values()) {
      if (l.t.state !== 'running') continue;
      n.all++;
      n[l.t.direction]++;
    }
    return n;
  }

  /** The overall limit as it applies now: one at a time on a metered connection, if asked. */
  private limit(): number {
    return this.metered && this.cfg.metered === 'limit' ? 1 : Math.max(1, this.cfg.maxConcurrent);
  }

  private held(): boolean {
    return this.offline || (this.metered && this.cfg.metered === 'pause');
  }

  /** Starts whatever may start now, in queue order, and wakes again for the next retry that is due. */
  private pump(): void {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        this.pumpOnce();
      } while (this.pumpAgain);
    } finally {
      this.pumping = false;
    }
  }

  private pumpOnce(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const now = Date.now();
    let soonest = Infinity;
    const held = this.held();
    for (const id of [...this.queue]) {
      const l = this.live.get(id);
      if (!l || l.t.state !== 'queued') {
        this.dequeue(id);
        continue;
      }
      const due = l.meta.retryAt ? Date.parse(l.meta.retryAt) : 0;
      if (due > now) {
        soonest = Math.min(soonest, due);
        continue;
      }
      if (held) continue;
      const n = this.running();
      if (n.all >= this.limit()) break;
      const own = l.t.direction === 'upload' ? this.cfg.maxUploads : this.cfg.maxDownloads;
      if (own !== null && n[l.t.direction] >= own) continue;
      this.dequeue(id);
      this.start(l);
    }
    if (soonest < Infinity) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.pump();
      }, Math.max(0, soonest - now));
      this.retryTimer.unref?.();
    }
  }

  /** Its turn: running, once. A transfer already running is never started a second time. */
  private start(l: Live): void {
    if (l.t.state === 'running') return;
    const abort = new AbortController();
    l.abort = abort;
    l.t.state = 'running';
    l.t.error = null;
    l.t.speed = 0;
    l.samples = [];
    l.meta.retryAt = null;
    this.persist(l);
    this.emit();
    const run = l.t.direction === 'upload' ? this.runUpload(l, abort) : this.runDownload(l, abort);
    void run.catch((e) => {
      log.warn('transfer stopped unexpectedly', { error: String(e) });
      this.settle(l, abort, 'failed', messageOf(e));
    });
  }

  /**
   * On a metered connection set to wait: what is moving stops where it is and
   * goes back to the front of the queue, in its order, to carry on later.
   */
  private setAside(): void {
    const moving = [...this.live.values()].filter((l) => l.t.state === 'running');
    for (const l of moving.reverse()) {
      l.abort?.abort();
      l.abort = null;
      l.t.state = 'queued';
      l.t.speed = 0;
      this.dequeue(l.t.id);
      this.queue.unshift(l.t.id);
      this.persist(l);
    }
    this.emit();
  }

  // ── downloads ──────────────────────────────────────────────────────────

  /**
   * A download into the download folder — or, when the person was asked where
   * to save it (`saveAs`, from the main process's own dialog), to that place.
   */
  async download(apiPath: string, name: string, openWhenDone: boolean, fileId: string | null, then?: (outcome: DownloadOutcome) => void, saveAs?: string): Promise<Transfer> {
    if (!apiPath.startsWith('/api/') && !isMediaPath(apiPath) && !isOfficeExportPath(apiPath) && !isGrantPath(apiPath)) throw new DesktopError('IPC_VALIDATION_FAILED', 'Not a WorkSuite download.');
    const folder = saveAs ? dirname(saveAs) : this.deps.downloadFolder();
    await mkdir(folder, { recursive: true });
    const safe = saveAs ? basename(saveAs) : safeFileName(name);
    const t: Transfer = {
      id: randomUUID(),
      direction: 'download',
      name: safe,
      source: 'WorkSuite Files',
      destination: saveAs ?? folder,
      bytes: 0,
      total: 0,
      state: 'queued',
      speed: 0,
      error: null,
      createdAt: new Date().toISOString(),
    };
    const meta: Meta = { path: null, fileId, source: apiPath, uploadId: null, target: null, chunkSize: null, totalChunks: null, sha256: null, tempPath: join(folder, `.${t.id}.wsdownload`), finalPath: null, openWhenDone, exactPath: saveAs ?? null };
    const l: Live = { t, meta, abort: null, samples: [] };
    if (then) this.whenDone.set(t.id, then);
    this.deps.audit('file.download', fileId ? { file_id: fileId } : { kind: isOfficeExportPath(apiPath) ? 'office-export' : apiPath.startsWith('/api/meetings/') ? 'meeting-minutes' : apiPath.startsWith('/api/meet/') ? 'meet-recording' : apiPath.startsWith('/api/files/') ? 'file-version' : apiPath.startsWith('/api/calendar/') || apiPath.startsWith('/api/contacts/') || apiPath.startsWith('/api/data/') || apiPath.startsWith('/api/finance/export/') || /^\/api\/expense\/(reports2?\/export|runs\/|postings\/)/.test(apiPath) ? 'export' : apiPath.startsWith('/api/expense/') ? 'expense-document' : apiPath.startsWith('/api/garage/') ? 'garage-document' : apiPath.startsWith('/api/pms/') ? (apiPath.includes('/reports/') ? 'pms-report' : 'pms-document') : isGrantPath(apiPath) ? 'task-attachment' : isMediaPath(apiPath) ? 'media' : 'mail-attachment' });
    this.enqueue(l);
    return this.view(l);
  }

  /**
   * A download kept inside the app (eLearning's offline copies): the same
   * queue, progress, pause and resume as any other, but the bytes go to the
   * named sink — never to the downloads folder — and the copy cannot be
   * opened in another app or shown in a folder.
   */
  async keep(source: string, name: string, sink: string): Promise<Transfer> {
    if (!source.startsWith('/api/') && !isMediaPath(source)) throw new DesktopError('IPC_VALIDATION_FAILED', 'Not a WorkSuite download.');
    if (!this.deps.sink?.(sink)) throw new DesktopError('INTERNAL', 'Nothing here keeps that download.');
    const t: Transfer = {
      id: randomUUID(),
      direction: 'download',
      name: safeFileName(name),
      source: 'WorkSuite eLearning',
      destination: 'Kept in WorkSuite for offline learning',
      bytes: 0,
      total: 0,
      state: 'queued',
      speed: 0,
      error: null,
      createdAt: new Date().toISOString(),
    };
    const meta: Meta = { path: null, fileId: null, source, uploadId: null, target: null, chunkSize: null, totalChunks: null, sha256: null, tempPath: null, finalPath: null, openWhenDone: false, sink };
    const l: Live = { t, meta, abort: null, samples: [] };
    this.deps.audit('file.download', { kind: 'elearning-offline-copy' });
    this.enqueue(l);
    return this.view(l);
  }

  /** A download into a sink (`keep`): resumed from what the sink already holds. */
  private async runKept(l: Live, abort: AbortController, source: string, sinkName: string): Promise<void> {
    const sink = this.deps.sink?.(sinkName);
    if (!sink) return this.settle(l, abort, 'failed', 'This copy is no longer wanted here.');
    let writer: SinkWriter | null = null;
    let written = 0;
    let complete = false;
    try {
      let offset = await sink.resumeFrom();
      const headers: Record<string, string> = { Accept: '*/*' };
      if (offset > 0) headers.Range = `bytes=${offset}-`;
      const res = await this.deps.http.raw('GET', this.deps.http.url(source), { headers, signal: abort.signal, timeoutMs: 24 * 3600_000 });
      // A signed address is good for an hour or so: an old one is refused, and a new manifest gives a fresh one.
      if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) return this.settle(l, abort, 'failed', 'The address for this file has expired. Download the course again to continue.');
      if (!res.ok || !res.body) return this.settle(l, abort, 'failed', `The server answered ${res.status}.`, isTemporaryStatus(res.status));
      if (res.status !== 206) offset = 0;
      const len = Number(res.headers.get('content-length') ?? 0);
      l.t.total = len > 0 ? len + offset : 0;
      writer = await sink.open(offset);
      written = offset;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
        written += value.byteLength;
        this.progress(l, written);
        await this.buckets.download.take(value.byteLength, abort.signal);
      }
      if (l.t.total > 0 && written !== l.t.total) return this.settle(l, abort, 'failed', 'The download was incomplete. Retry to continue it.', true);
      complete = true;
      await writer.close(true, written);
      writer = null;
      l.t.total = written;
      l.t.bytes = written;
      this.settle(l, abort, 'done');
    } catch (e) {
      if (abort.signal.aborted) return;
      this.settle(l, abort, 'failed', messageOf(e), isTemporaryFailure(e));
    } finally {
      // Interrupted: what arrived whole stays, for a resume.
      if (writer) await writer.close(complete, written).catch(() => undefined);
    }
  }

  private async runDownload(l: Live, abort: AbortController): Promise<void> {
    const { meta } = l;
    if (meta.sink) return meta.source ? this.runKept(l, abort, meta.source, meta.sink) : this.settle(l, abort, 'failed', 'Nothing to download.');
    const source = meta.source ?? (meta.fileId ? `/api/files/${encodeURIComponent(meta.fileId)}/download` : null);
    if (!source || !meta.tempPath) return this.settle(l, abort, 'failed', 'Nothing to download.');
    let offset = 0;
    try {
      if (existsSync(meta.tempPath)) offset = (await stat(meta.tempPath)).size;
      const headers: Record<string, string> = { Accept: '*/*' };
      if (offset > 0) headers.Range = `bytes=${offset}-`;
      const res = await this.deps.http.raw('GET', this.deps.http.url(source), {
        headers,
        signal: abort.signal,
        timeoutMs: 24 * 3600_000,
      });
      if (res.status === 403) return this.settle(l, abort, 'failed', 'You can view this file but not download it.');
      if (res.status === 404) return this.settle(l, abort, 'failed', 'That file no longer exists.');
      if (!res.ok || !res.body) return this.settle(l, abort, 'failed', `The server answered ${res.status}.`, isTemporaryStatus(res.status));
      const resumed = res.status === 206;
      if (!resumed) offset = 0;
      const len = Number(res.headers.get('content-length') ?? 0);
      l.t.total = len > 0 ? len + offset : 0;
      const out = createWriteStream(meta.tempPath, { flags: resumed ? 'a' : 'w', mode: 0o600 });
      let written = offset;
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
          written += value.byteLength;
          this.progress(l, written);
          await this.buckets.download.take(value.byteLength, abort.signal);
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }
      // Cut off part way: what arrived stays in the temporary file, and the next try asks for the rest.
      if (l.t.total > 0 && written !== l.t.total) return this.settle(l, abort, 'failed', 'The download was incomplete. Retry to continue it.', true);
      if (abort.signal.aborted || l.abort !== abort) return;
      const final = meta.exactPath ?? (await this.uniquePath(this.deps.downloadFolder(), l.t.name));
      await rename(meta.tempPath, final);
      meta.finalPath = final;
      meta.tempPath = null;
      l.t.destination = final;
      l.t.total = written;
      l.t.bytes = written;
      this.settle(l, abort, 'done');
      if (meta.openWhenDone) void this.open(final).catch(() => undefined);
    } catch (e) {
      if (abort.signal.aborted) return;
      this.settle(l, abort, 'failed', messageOf(e), isTemporaryFailure(e));
    }
  }

  private async uniquePath(folder: string, name: string): Promise<string> {
    for (let n = 0; n < 1000; n++) {
      const candidate = join(folder, numberedName(name, n));
      if (!existsSync(candidate)) return candidate;
    }
    return join(folder, `${randomUUID()}-${name}`);
  }

  // ── uploads ────────────────────────────────────────────────────────────

  async upload(handles: string[], target: UploadTarget): Promise<Transfer[]> {
    const out: Transfer[] = [];
    for (const h of handles) {
      const file = this.handles.get(h);
      if (!file) throw new DesktopError('IPC_VALIDATION_FAILED', 'That file is no longer available; choose it again.');
      // A handle is used once: asking twice never uploads the file twice.
      this.handles.delete(h);
      const t: Transfer = {
        id: randomUUID(),
        direction: 'upload',
        name: (target.kind === 'files' && target.name) || (file.relativePath ?? file.name),
        source: file.path,
        destination: target.kind === 'chat' ? 'Chat' : target.kind === 'task' ? 'Task' : target.kind === 'tender' ? 'Tender' : target.kind === 'remote' ? 'Remote session' : target.kind === 'website' ? 'Website chat' : 'WorkSuite Files',
        bytes: 0,
        total: file.size,
        state: 'queued',
        speed: 0,
        error: null,
        createdAt: new Date().toISOString(),
      };
      const meta: Meta = { path: file.path, fileId: null, uploadId: null, target, chunkSize: null, totalChunks: null, sha256: null, tempPath: null, finalPath: null, openWhenDone: false, relativePath: target.kind === 'files' ? (file.relativePath ?? null) : null };
      const l: Live = { t, meta, abort: null, samples: [] };
      this.enqueue(l);
      out.push(this.view(l));
    }
    return out;
  }

  /**
   * Upload a file this process made itself — a meeting recording (worksuite-desktop#68). No handle: the path is
   * this process's own. Resumable like any other upload, also after a restart (`resume`).
   */
  async uploadOwn(path: string, name: string, target: UploadTarget): Promise<string> {
    const st = await stat(path);
    const t: Transfer = {
      id: randomUUID(),
      direction: 'upload',
      name,
      source: path,
      destination: 'WorkSuite Files',
      bytes: 0,
      total: st.size,
      state: 'queued',
      speed: 0,
      error: null,
      createdAt: new Date().toISOString(),
    };
    const meta: Meta = { path, fileId: null, uploadId: null, target, chunkSize: null, totalChunks: null, sha256: null, tempPath: null, finalPath: null, openWhenDone: false, relativePath: null };
    const l: Live = { t, meta, abort: null, samples: [] };
    this.enqueue(l);
    return t.id;
  }

  /** How an upload stands, and the Drive file it made — after a restart too. Null when it is gone. */
  uploadStatus(id: string): { state: TransferState; fileId: string | null; error: string | null; bytes: number; total: number } | null {
    try {
      const l = this.liveOrLoad(id);
      return { state: l.t.state, fileId: l.meta.fileId, error: l.t.error, bytes: l.t.bytes, total: l.t.total };
    } catch {
      return null;
    }
  }

  /** Told once, when an upload ends: the file it made, or why not. */
  whenUploaded(id: string, then: (outcome: { fileId: string | null } | { error: string }) => void): void {
    this.uploadDone.set(id, then);
  }

  private async runUpload(l: Live, abort: AbortController): Promise<void> {
    const { meta } = l;
    if (!meta.path || !meta.target) return this.settle(l, abort, 'failed', 'Nothing to upload.');
    try {
      if (!meta.completed) {
        const st = await stat(meta.path);
        if (st.size !== l.t.total) return this.settle(l, abort, 'failed', 'The file changed on disk; choose it again.');
        if (meta.target.kind === 'remote') return await this.offerRemote(l, abort, meta.target.sessionId, meta.path, st.size);
        if (meta.target.kind === 'website') return await this.sendToVisitor(l, abort, meta.target.conversationId, meta.path, meta.target.caption);
        await this.sendParts(l, abort, meta.path, st.size);
        if (abort.signal.aborted) return;
      }
      if (meta.target.kind === 'task') {
        if (!meta.fileId) throw new DesktopError('SERVER_ERROR', 'The file was stored but WorkSuite did not say where.');
        await this.deps.http.post(`/api/tasks/${meta.target.taskId}/attachments/drive`, {
          file_ids: [Number(meta.fileId)],
          ...(meta.target.commentId ? { comment_id: meta.target.commentId } : {}),
        });
      }
      if (meta.target.kind === 'tender') {
        if (!meta.fileId) throw new DesktopError('SERVER_ERROR', 'The file was stored but WorkSuite did not say where.');
        await fileOnTender(this.deps.http, meta.target, Number(meta.fileId), basename(meta.path));
      }
      if (meta.target.kind === 'chat') {
        await this.deps.http.post('/api/chat/messages/attachments', {
          room_id: meta.target.roomId,
          upload_id: meta.uploadId,
          // The same message id on every try: the server posts it once.
          client_message_id: `desktop-${l.t.id}`,
          ...(meta.target.caption ? { caption: meta.target.caption } : {}),
          ...(meta.target.replyTo ? { reply_to: meta.target.replyTo } : {}),
        });
      }
      this.settle(l, abort, 'done');
    } catch (e) {
      if (abort.signal.aborted) return;
      this.settle(l, abort, 'failed', messageOf(e), e instanceof Temporary || isTemporaryFailure(e));
    }
  }

  /**
   * The upload's bytes: init → parts → complete, going on from the parts the
   * server already has. An upload the server already completed (the answer
   * lost on the way back) is taken as done, never sent again.
   */
  private async sendParts(l: Live, abort: AbortController, path: string, size: number): Promise<void> {
    const { meta } = l;
    const target = meta.target!;
    if (!meta.sha256) meta.sha256 = (await this.deps.hash(path)).sha256;
    let received = new Set<number>();
    if (meta.uploadId) {
      try {
        const s = await this.deps.http.get<{ received_chunks?: number[]; status?: string; file_id?: number | string | null }>(`/api/uploads/${meta.uploadId}/status`);
        if ((s.status === 'completed' || s.status === 'complete') && s.file_id !== undefined && s.file_id !== null) {
          meta.fileId = String(s.file_id);
          meta.completed = true;
          this.persist(l);
          this.progress(l, size);
          return;
        }
        received = new Set((s.received_chunks ?? []).map(Number));
      } catch (e) {
        // Out of reach: try again later with the same session. Anything else: the session expired, start over.
        if (isTemporaryFailure(e)) throw e;
        meta.uploadId = null;
      }
    }
    if (!meta.uploadId) {
      const filename = (target.kind === 'files' && target.name) || basename(path);
      const replacing = target.kind === 'files' && target.replaceFileId ? Number(target.replaceFileId) : null;
      const init = await this.deps.http.post<{ upload_id: string; chunk_size: number; total_chunks: number; replaces?: number | string }>('/api/uploads/init', {
        filename,
        total_size: size,
        chunk_size: chunkSizeFor(size),
        sha256: meta.sha256,
        mime_type: mimeFor(filename) ?? undefined,
        ...(replacing ? { replace_file_id: replacing } : {}),
        ...(meta.relativePath ? { relative_path: meta.relativePath } : {}),
        // A task's files are Drive files (in the top folder, as the web's are), linked to the task once they are in.
        ...(target.kind === 'files' ? { purpose: 'drive', folder_id: target.folderId } : target.kind === 'task' || target.kind === 'tender' ? { purpose: 'drive', folder_id: null } : { purpose: 'chat', room_id: target.kind === 'chat' ? target.roomId : undefined }),
      });
      // A server that does not know `replace_file_id` ignores it and would add a second file of the same
      // name: it says which file it will replace, and without that the upload stops before any bytes go.
      if (replacing && Number(init.replaces) !== replacing) {
        await this.deps.http.post(`/api/uploads/${init.upload_id}/abort`, {}).catch(() => undefined);
        throw new DesktopError('SERVER_ERROR', 'This WorkSuite server cannot replace a file by uploading yet. Upload it again and choose Keep both.');
      }
      meta.uploadId = init.upload_id;
      meta.chunkSize = Number(init.chunk_size) || chunkSizeFor(size);
      meta.totalChunks = Number(init.total_chunks) || Math.max(1, Math.ceil(size / meta.chunkSize));
      this.persist(l);
    }
    const part = meta.chunkSize ?? CHUNK;
    const total = meta.totalChunks ?? Math.max(1, Math.ceil(size / part));
    const fh = await open(path, 'r');
    try {
      let sent = [...received].reduce((a, i) => a + Math.min(part, size - i * part), 0);
      this.progress(l, sent);
      for (let i = 0; i < total; i++) {
        if (received.has(i)) continue;
        if (abort.signal.aborted) return;
        const len = Math.min(part, size - i * part);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, i * part);
        await this.buckets.upload.take(len, abort.signal);
        await this.sendChunk(meta.uploadId!, i, buf, l.t.name, abort.signal);
        received.add(i);
        sent += len;
        this.progress(l, sent);
      }
    } finally {
      await fh.close();
    }
    const done = await this.deps.http.post<{ file_id?: number | string }>(`/api/uploads/${meta.uploadId}/complete`, {});
    meta.fileId = done.file_id !== undefined ? String(done.file_id) : null;
    meta.completed = true;
    this.persist(l);
  }

  private async sendChunk(uploadId: string, index: number, buf: Buffer, name: string, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const form = new FormData();
      form.set('chunk_index', String(index));
      form.set('chunk', new Blob([new Uint8Array(buf)]), name);
      try {
        // A part sent again replaces the one the server has under the same index: never a second copy.
        const res = await this.deps.http.raw('POST', this.deps.http.url(`/api/uploads/${uploadId}/chunk`), { body: form, signal, timeoutMs: 10 * 60_000 });
        if (res.ok) return;
        if (!isTemporaryStatus(res.status)) {
          let message = `The server refused part ${index + 1} (${res.status}).`;
          try {
            message = ((await res.json()) as { message?: string }).message ?? message;
          } catch {
            /* keep default */
          }
          throw new DesktopError('SERVER_ERROR', message, res.status);
        }
        if (attempt >= 4) throw new Temporary(`The server answered ${res.status} for part ${index + 1}.`);
      } catch (e) {
        if (signal.aborted) throw e;
        if (isDesktopError(e) && e.code === 'SERVER_ERROR' && e.status !== null && !isTemporaryStatus(e.status)) throw e;
        if (attempt >= 4) throw e;
      }
      await new Promise((r) => setTimeout(r, backoffDelay(attempt, { baseMs: 1000, maxMs: 30_000 })));
    }
  }

  // ── controls ───────────────────────────────────────────────────────────

  private liveOrLoad(id: string): Live {
    const l = this.live.get(id);
    if (l) return l;
    const uid = this.deps.userId();
    const row = uid ? this.deps.db.get<{ id: string; direction: string; name: string; meta: string; bytes: number; total: number; state: string; error: string | null; created_at: string }>('SELECT * FROM transfers WHERE id = ? AND user_id = ?', id, uid) : undefined;
    const meta = row ? this.deps.vault().decrypt<Meta>(row.meta) : undefined;
    if (!row || !meta) throw new DesktopError('NOT_FOUND', 'That transfer is gone.');
    const t: Transfer = {
      id: row.id,
      direction: row.direction as Transfer['direction'],
      name: row.name,
      source: row.direction === 'upload' ? (meta.path ?? '') : meta.sink ? 'WorkSuite eLearning' : 'WorkSuite Files',
      destination: meta.sink ? 'Kept in WorkSuite for offline learning' : (meta.finalPath ?? meta.exactPath ?? this.deps.downloadFolder()),
      bytes: Number(row.bytes),
      total: Number(row.total),
      state: row.state as TransferState,
      speed: 0,
      error: row.error ?? null,
      createdAt: row.created_at,
    };
    const loaded: Live = { t, meta, abort: null, samples: [] };
    return loaded;
  }

  /**
   * A file for the other end of a remote-control session (RC06): one
   * multipart request, as the server takes it; they accept it or not there.
   * Offers are for passing a log or a document, not for moving a library.
   */
  private async offerRemote(l: Live, abort: AbortController, sessionId: number, path: string, size: number): Promise<void> {
    if (size > REMOTE_MAX) return this.settle(l, abort, 'failed', 'Files offered in a remote session can be up to 512 MB. Share bigger ones through Drive.');
    const form = new FormData();
    // Read from disk as it is sent, not held in memory whole.
    form.append('file', await openAsBlob(path, { type: mimeFor(basename(path)) ?? 'application/octet-stream' }), basename(path));
    this.progress(l, 0);
    await this.buckets.upload.take(size, abort.signal);
    const res = await this.deps.http.raw('POST', this.deps.http.url(`/api/meet/control/sessions/${sessionId}/files`), { body: form, timeoutMs: 10 * 60_000, signal: abort.signal });
    if (!res.ok) {
      let message = `The server answered ${res.status}.`;
      try {
        message = String(((await res.json()) as { message?: string }).message ?? message);
      } catch {
        /* not JSON */
      }
      return this.settle(l, abort, 'failed', message, isTemporaryStatus(res.status));
    }
    this.progress(l, size);
    this.settle(l, abort, 'done');
  }

  /**
   * A file for a website visitor: one multipart request to the conversation's
   * attach, which checks the widget's size limit and type list itself — the
   * chunked Drive uploader would put it in the Drive, not in the chat.
   */
  private async sendToVisitor(l: Live, abort: AbortController, conversationId: number, path: string, caption?: string): Promise<void> {
    const form = new FormData();
    form.append('file', await openAsBlob(path, { type: mimeFor(basename(path)) ?? 'application/octet-stream' }), basename(path));
    if (caption) form.append('caption', caption);
    this.progress(l, 0);
    await this.buckets.upload.take(l.t.total, abort.signal);
    const res = await this.deps.http.raw('POST', this.deps.http.url(`/api/chat/widget-admin/conversations/${conversationId}/attach`), { body: form, timeoutMs: 5 * 60_000, signal: abort.signal });
    if (!res.ok) {
      let message = `The server answered ${res.status}.`;
      try {
        message = String(((await res.json()) as { message?: string }).message ?? message);
      } catch {
        /* not JSON */
      }
      return this.settle(l, abort, 'failed', message, isTemporaryStatus(res.status));
    }
    this.progress(l, l.t.total);
    this.settle(l, abort, 'done');
  }

  /** Stops a running or waiting transfer where it is; what it already moved is kept for a resume. */
  private pauseLive(l: Live, why: string | null = null): void {
    l.t.state = 'paused';
    l.abort?.abort();
    this.finish(l, 'paused', why);
  }

  pause(id: string): void {
    const l = this.live.get(id);
    if (!l || (l.t.state !== 'running' && l.t.state !== 'queued')) return;
    this.pauseLive(l);
  }

  /**
   * Back in the queue, at the back, from where it stopped — it starts when
   * there is room, like any other. One already running or waiting is left as
   * it is: never started twice.
   */
  resume(id: string): void {
    const l = this.liveOrLoad(id);
    if (l.t.state !== 'paused' && l.t.state !== 'failed') return;
    l.t.error = null;
    l.meta.attempts = 0;
    l.meta.waitingFor = null;
    this.enqueue(l);
  }

  retry(id: string): void {
    this.resume(id);
  }

  /** Pause All: everything moving or waiting stops where it is. */
  pauseAll(): void {
    for (const l of [...this.live.values()]) if (l.t.state === 'running' || l.t.state === 'queued') this.pauseLive(l);
  }

  /** Resume All: every paused transfer goes back in the queue, oldest first, and starts as slots free. */
  resumeAll(): void {
    for (const r of this.rows("state = 'paused'")) {
      try {
        this.resume(r.id);
      } catch {
        /* gone meanwhile */
      }
    }
  }

  async cancel(id: string): Promise<void> {
    const l = this.liveOrLoad(id);
    if (l.t.state === 'done' || l.t.state === 'cancelled') return;
    l.t.state = 'cancelled';
    l.abort?.abort();
    this.dequeue(id);
    if (l.meta.tempPath) await unlink(l.meta.tempPath).catch(() => undefined);
    if (l.meta.sink) await this.deps.sink?.(l.meta.sink)?.discard().catch(() => undefined);
    if (l.t.direction === 'upload' && l.meta.uploadId && !l.meta.completed) {
      void this.deps.http.post(`/api/uploads/${l.meta.uploadId}/abort`, {}).catch(() => undefined);
    }
    this.finish(l, 'cancelled');
  }

  /** Canonical path of a finished download, only if it is inside the download folder (or where the person chose to save it). */
  private async finishedPath(id: string): Promise<string> {
    const l = this.liveOrLoad(id);
    // A copy kept inside the app is played there, and nowhere else.
    if (l.meta.sink) throw new DesktopError('POLICY_DENIED', 'This copy is kept inside WorkSuite for offline learning. Open it from eLearning.');
    const p = l.meta.finalPath;
    if (!p || l.t.state !== 'done') throw new DesktopError('NOT_FOUND', 'That download has not finished.');
    const real = await realpath(p).catch(() => null);
    const folder = l.meta.exactPath ? dirname(l.meta.exactPath) : this.deps.downloadFolder();
    const root = await realpath(folder).catch(() => resolve(folder));
    if (!real || (dirname(real) !== root && !real.startsWith(root + sep))) {
      throw new DesktopError('NOT_FOUND', 'That file has been moved or deleted.');
    }
    return real;
  }

  async openFile(id: string): Promise<boolean> {
    return this.open(await this.finishedPath(id), true);
  }

  /**
   * A downloaded file, opened where it belongs: PDFs in PDF Studio, inside
   * the app (so the policy on other applications does not apply); anything
   * else — Word, Excel, PowerPoint files included — in the application the
   * system has for it, when the organization allows that.
   */
  private async open(path: string, strict = false): Promise<boolean> {
    if (this.deps.openInApp?.(path)) return true;
    if (!this.deps.canOpenFiles()) {
      if (strict) throw new DesktopError('POLICY_DENIED', 'Your organization does not allow opening files in other applications.');
      return false;
    }
    return (await shell.openPath(path)) === '';
  }

  async reveal(id: string): Promise<boolean> {
    const p = await this.finishedPath(id);
    shell.showItemInFolder(p);
    return true;
  }

  /** Clear finished: the history of what ended goes; what is moving, waiting or paused stays. */
  clearFinished(): void {
    const uid = this.deps.userId();
    if (!uid) return;
    this.deps.db.run("DELETE FROM transfers WHERE user_id = ? AND state IN ('done', 'cancelled', 'failed')", uid);
    this.emit();
  }

  /**
   * After signing in: the queue as it was when WorkSuite closed. What was
   * moving or waiting goes back in the queue in its order and carries on from
   * where it got to; what was paused stays paused. A file offered in a
   * remote-control session is not offered again into a session that is over.
   */
  recover(): void {
    const back: Live[] = [];
    for (const r of this.rows("state IN ('running', 'queued')")) {
      if (this.live.has(r.id)) continue;
      let l: Live;
      try {
        l = this.liveOrLoad(r.id);
      } catch {
        continue;
      }
      if (l.meta.target?.kind === 'remote') {
        l.t.state = 'paused';
        this.persist(l);
        continue;
      }
      back.push(l);
    }
    back.sort((a, b) => (a.meta.queuedAt ?? a.t.createdAt).localeCompare(b.meta.queuedAt ?? b.t.createdAt));
    for (const l of back) {
      l.t.state = 'queued';
      l.meta.retryAt = null;
      this.live.set(l.t.id, l);
      this.dequeue(l.t.id);
      this.queue.push(l.t.id);
      this.persist(l);
    }
    this.emit();
    this.pump();
  }

  /**
   * Quitting or signing out: what is moving stops where it is and is kept as
   * waiting, so the queue carries on, in its order, the next time.
   */
  stopAll(): void {
    // A change notice still on its way would read the database after it closes (quitting, signing out).
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const l of this.live.values()) {
      if (l.t.state === 'running') {
        l.t.state = 'queued';
        l.abort?.abort();
        l.abort = null;
        this.persist(l);
      }
    }
    this.queue = [];
    this.live.clear();
  }

  wipe(userId: string): void {
    this.stopAll();
    this.deps.db.run('DELETE FROM transfers WHERE user_id = ?', userId);
    this.handles.clear();
  }
}
