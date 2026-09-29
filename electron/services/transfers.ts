import { shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, openAsBlob } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { PickedFile, UploadTarget } from '@shared/ipc/contract';
import type { Transfer, TransferState } from '@shared/types';
import { backoffDelay } from '@shared/backoff';
import { numberedName, safeFileName } from '@shared/filename';
import { mimeFor } from '@shared/mime';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { Vault } from './vault';

const log = logger('transfers');

/**
 * DesktopDownloadManager / DesktopUploadManager (FR-XFR-01/02/03, AC-10).
 *
 * One queue for every module. Uploads are chunked through WorkSuite's upload
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
}

interface Live {
  t: Transfer;
  meta: Meta;
  abort: AbortController | null;
  samples: Array<{ at: number; bytes: number }>;
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
}

const MAX_UPLOAD = 5 * 1024 * 1024 * 1024;
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

  // ── state ──────────────────────────────────────────────────────────────

  list(): Transfer[] {
    const uid = this.deps.userId();
    if (!uid) return [];
    const rows = this.deps.db.all<{ id: string; direction: string; name: string; meta: string; bytes: number; total: number; state: string; error: string | null; created_at: string }>(
      'SELECT * FROM transfers WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
      uid,
    );
    return rows.map((r) => {
      const l = this.live.get(r.id);
      if (l) return { ...l.t };
      const m = this.deps.vault().decrypt<Meta>(r.meta);
      return {
        id: r.id,
        direction: r.direction as Transfer['direction'],
        name: r.name,
        source: r.direction === 'upload' ? (m?.path ?? '') : 'WorkSuite',
        destination: r.direction === 'download' ? (m?.finalPath ?? '') : 'WorkSuite',
        bytes: Number(r.bytes),
        total: Number(r.total),
        state: r.state as TransferState,
        speed: 0,
        error: r.error,
        createdAt: r.created_at,
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
    this.persist(l);
    if (state !== 'running' && state !== 'queued') this.live.delete(l.t.id);
    this.emit();
  }

  // ── downloads ──────────────────────────────────────────────────────────

  async download(apiPath: string, name: string, openWhenDone: boolean, fileId: string | null): Promise<Transfer> {
    if (!apiPath.startsWith('/api/')) throw new DesktopError('IPC_VALIDATION_FAILED', 'Not a WorkSuite download.');
    const folder = this.deps.downloadFolder();
    await mkdir(folder, { recursive: true });
    const safe = safeFileName(name);
    const t: Transfer = {
      id: randomUUID(),
      direction: 'download',
      name: safe,
      source: 'WorkSuite Files',
      destination: folder,
      bytes: 0,
      total: 0,
      state: 'queued',
      speed: 0,
      error: null,
      createdAt: new Date().toISOString(),
    };
    const meta: Meta = { path: null, fileId, source: apiPath, uploadId: null, target: null, chunkSize: null, totalChunks: null, sha256: null, tempPath: join(folder, `.${t.id}.wsdownload`), finalPath: null, openWhenDone };
    const l: Live = { t, meta, abort: null, samples: [] };
    this.live.set(t.id, l);
    this.persist(l);
    this.deps.audit('file.download', fileId ? { file_id: fileId } : { kind: apiPath.startsWith('/api/meet/') ? 'meet-recording' : apiPath.startsWith('/api/files/') ? 'file-version' : apiPath.startsWith('/api/calendar/') || apiPath.startsWith('/api/contacts/') || apiPath.startsWith('/api/data/') || apiPath.startsWith('/api/finance/export/') || /^\/api\/expense\/(reports2?\/export|runs\/|postings\/)/.test(apiPath) ? 'export' : apiPath.startsWith('/api/expense/') ? 'expense-document' : apiPath.startsWith('/api/garage/') ? 'garage-document' : 'mail-attachment' });
    void this.runDownload(l);
    return { ...t };
  }

  private async runDownload(l: Live): Promise<void> {
    const { meta } = l;
    const source = meta.source ?? (meta.fileId ? `/api/files/${encodeURIComponent(meta.fileId)}/download` : null);
    if (!source || !meta.tempPath) return this.finish(l, 'failed', 'Nothing to download.');
    l.t.state = 'running';
    l.abort = new AbortController();
    this.emit();
    let offset = 0;
    try {
      if (existsSync(meta.tempPath)) offset = (await stat(meta.tempPath)).size;
      const headers: Record<string, string> = { Accept: '*/*' };
      if (offset > 0) headers.Range = `bytes=${offset}-`;
      const res = await this.deps.http.raw('GET', this.deps.http.url(source), {
        headers,
        signal: l.abort.signal,
        timeoutMs: 24 * 3600_000,
      });
      if (res.status === 403) return this.finish(l, 'failed', 'You can view this file but not download it.');
      if (res.status === 404) return this.finish(l, 'failed', 'That file no longer exists.');
      if (!res.ok || !res.body) return this.finish(l, 'failed', `The server answered ${res.status}.`);
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
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }
      if (l.t.total > 0 && written !== l.t.total) return this.finish(l, 'failed', 'The download was incomplete. Retry to continue it.');
      const final = await this.uniquePath(this.deps.downloadFolder(), l.t.name);
      await rename(meta.tempPath, final);
      meta.finalPath = final;
      meta.tempPath = null;
      l.t.destination = final;
      l.t.total = written;
      l.t.bytes = written;
      this.finish(l, 'done');
      if (meta.openWhenDone && this.deps.canOpenFiles()) void shell.openPath(final);
    } catch (e) {
      if ((l.t.state as TransferState) === 'paused' || (l.t.state as TransferState) === 'cancelled') return;
      const msg = isDesktopError(e) ? e.message : String((e as Error).message ?? e);
      this.finish(l, 'failed', msg);
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
      this.live.set(t.id, l);
      this.persist(l);
      out.push({ ...t });
      void this.runUpload(l);
    }
    return out;
  }

  private async runUpload(l: Live): Promise<void> {
    const { meta } = l;
    if (!meta.path || !meta.target) return this.finish(l, 'failed', 'Nothing to upload.');
    l.t.state = 'running';
    l.abort = new AbortController();
    this.emit();
    try {
      const st = await stat(meta.path);
      if (st.size !== l.t.total) return this.finish(l, 'failed', 'The file changed on disk; choose it again.');
      if (meta.target.kind === 'remote') return await this.offerRemote(l, meta.target.sessionId, meta.path, st.size);
      if (meta.target.kind === 'website') return await this.sendToVisitor(l, meta.target.conversationId, meta.path, meta.target.caption);
      if (!meta.sha256) meta.sha256 = (await this.deps.hash(meta.path)).sha256;
      let received = new Set<number>();
      if (meta.uploadId) {
        try {
          const s = await this.deps.http.get<{ received_chunks?: number[] }>(`/api/uploads/${meta.uploadId}/status`);
          received = new Set((s.received_chunks ?? []).map(Number));
        } catch {
          meta.uploadId = null; // expired session: start over
        }
      }
      if (!meta.uploadId) {
        const filename = (meta.target.kind === 'files' && meta.target.name) || basename(meta.path);
        const replacing = meta.target.kind === 'files' && meta.target.replaceFileId ? Number(meta.target.replaceFileId) : null;
        const init = await this.deps.http.post<{ upload_id: string; chunk_size: number; total_chunks: number; replaces?: number | string }>('/api/uploads/init', {
          filename,
          total_size: st.size,
          chunk_size: chunkSizeFor(st.size),
          sha256: meta.sha256,
          mime_type: mimeFor(filename) ?? undefined,
          ...(replacing ? { replace_file_id: replacing } : {}),
          ...(meta.relativePath ? { relative_path: meta.relativePath } : {}),
          // A task's files are Drive files (in the top folder, as the web's are), linked to the task once they are in.
          ...(meta.target.kind === 'files' ? { purpose: 'drive', folder_id: meta.target.folderId } : meta.target.kind === 'task' || meta.target.kind === 'tender' ? { purpose: 'drive', folder_id: null } : { purpose: 'chat', room_id: meta.target.roomId }),
        });
        // A server that does not know `replace_file_id` ignores it and would add a second file of the same
        // name: it says which file it will replace, and without that the upload stops before any bytes go.
        if (replacing && Number(init.replaces) !== replacing) {
          await this.deps.http.post(`/api/uploads/${init.upload_id}/abort`, {}).catch(() => undefined);
          throw new DesktopError('SERVER_ERROR', 'This WorkSuite server cannot replace a file by uploading yet. Upload it again and choose Keep both.');
        }
        meta.uploadId = init.upload_id;
        meta.chunkSize = Number(init.chunk_size) || chunkSizeFor(st.size);
        meta.totalChunks = Number(init.total_chunks) || Math.max(1, Math.ceil(st.size / meta.chunkSize));
        this.persist(l);
      }
      const size = meta.chunkSize ?? CHUNK;
      const total = meta.totalChunks ?? Math.max(1, Math.ceil(st.size / size));
      const fh = await open(meta.path, 'r');
      try {
        let sent = [...received].reduce((a, i) => a + Math.min(size, st.size - i * size), 0);
        this.progress(l, sent);
        for (let i = 0; i < total; i++) {
          if (received.has(i)) continue;
          if (l.abort?.signal.aborted) return;
          const len = Math.min(size, st.size - i * size);
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, i * size);
          await this.sendChunk(meta.uploadId!, i, buf, l.t.name, l.abort!.signal);
          received.add(i);
          sent += len;
          this.progress(l, sent);
        }
      } finally {
        await fh.close();
      }
      const done = await this.deps.http.post<{ file_id?: number | string }>(`/api/uploads/${meta.uploadId}/complete`, {});
      meta.fileId = done.file_id !== undefined ? String(done.file_id) : null;
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
          client_message_id: `desktop-${l.t.id}`,
          ...(meta.target.caption ? { caption: meta.target.caption } : {}),
          ...(meta.target.replyTo ? { reply_to: meta.target.replyTo } : {}),
        });
      }
      this.finish(l, 'done');
    } catch (e) {
      if ((l.t.state as TransferState) === 'paused' || (l.t.state as TransferState) === 'cancelled') return;
      this.finish(l, 'failed', isDesktopError(e) ? e.message : String((e as Error).message ?? e));
    }
  }

  private async sendChunk(uploadId: string, index: number, buf: Buffer, name: string, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const form = new FormData();
      form.set('chunk_index', String(index));
      form.set('chunk', new Blob([new Uint8Array(buf)]), name);
      try {
        const res = await this.deps.http.raw('POST', this.deps.http.url(`/api/uploads/${uploadId}/chunk`), { body: form, signal, timeoutMs: 10 * 60_000 });
        if (res.ok) return;
        if (res.status < 500 && res.status !== 429) {
          let message = `The server refused part ${index + 1} (${res.status}).`;
          try {
            message = ((await res.json()) as { message?: string }).message ?? message;
          } catch {
            /* keep default */
          }
          throw new DesktopError('SERVER_ERROR', message, res.status);
        }
      } catch (e) {
        if (signal.aborted) throw e;
        if (isDesktopError(e) && e.code === 'SERVER_ERROR' && e.status !== null && e.status < 500) throw e;
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
    const row = uid ? this.deps.db.get<{ id: string; direction: string; name: string; meta: string; bytes: number; total: number; state: string; created_at: string }>('SELECT * FROM transfers WHERE id = ? AND user_id = ?', id, uid) : undefined;
    const meta = row ? this.deps.vault().decrypt<Meta>(row.meta) : undefined;
    if (!row || !meta) throw new DesktopError('NOT_FOUND', 'That transfer is gone.');
    const t: Transfer = {
      id: row.id,
      direction: row.direction as Transfer['direction'],
      name: row.name,
      source: row.direction === 'upload' ? (meta.path ?? '') : 'WorkSuite Files',
      destination: meta.finalPath ?? this.deps.downloadFolder(),
      bytes: Number(row.bytes),
      total: Number(row.total),
      state: row.state as TransferState,
      speed: 0,
      error: null,
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
  private async offerRemote(l: Live, sessionId: number, path: string, size: number): Promise<void> {
    if (size > REMOTE_MAX) return this.finish(l, 'failed', 'Files offered in a remote session can be up to 512 MB. Share bigger ones through Drive.');
    const form = new FormData();
    // Read from disk as it is sent, not held in memory whole.
    form.append('file', await openAsBlob(path, { type: mimeFor(basename(path)) ?? 'application/octet-stream' }), basename(path));
    this.progress(l, 0);
    const res = await this.deps.http.raw('POST', this.deps.http.url(`/api/meet/control/sessions/${sessionId}/files`), { body: form, timeoutMs: 10 * 60_000, signal: l.abort?.signal });
    if (!res.ok) {
      let message = `The server answered ${res.status}.`;
      try {
        message = String(((await res.json()) as { message?: string }).message ?? message);
      } catch {
        /* not JSON */
      }
      return this.finish(l, 'failed', message);
    }
    this.progress(l, size);
    this.finish(l, 'done');
  }

  /**
   * A file for a website visitor: one multipart request to the conversation's
   * attach, which checks the widget's size limit and type list itself — the
   * chunked Drive uploader would put it in the Drive, not in the chat.
   */
  private async sendToVisitor(l: Live, conversationId: number, path: string, caption?: string): Promise<void> {
    const form = new FormData();
    form.append('file', await openAsBlob(path, { type: mimeFor(basename(path)) ?? 'application/octet-stream' }), basename(path));
    if (caption) form.append('caption', caption);
    this.progress(l, 0);
    const res = await this.deps.http.raw('POST', this.deps.http.url(`/api/chat/widget-admin/conversations/${conversationId}/attach`), { body: form, timeoutMs: 5 * 60_000, signal: l.abort?.signal });
    if (!res.ok) {
      let message = `The server answered ${res.status}.`;
      try {
        message = String(((await res.json()) as { message?: string }).message ?? message);
      } catch {
        /* not JSON */
      }
      return this.finish(l, 'failed', message);
    }
    this.progress(l, l.t.total);
    this.finish(l, 'done');
  }

  pause(id: string): void {
    const l = this.live.get(id);
    if (!l || l.t.state !== 'running') return;
    l.t.state = 'paused';
    l.abort?.abort();
    this.finish(l, 'paused');
  }

  resume(id: string): void {
    const l = this.liveOrLoad(id);
    if (l.t.state !== 'paused' && l.t.state !== 'failed') return;
    l.t.error = null;
    this.live.set(id, l);
    if (l.t.direction === 'upload') void this.runUpload(l);
    else void this.runDownload(l);
  }

  retry(id: string): void {
    this.resume(id);
  }

  async cancel(id: string): Promise<void> {
    const l = this.liveOrLoad(id);
    l.t.state = 'cancelled';
    l.abort?.abort();
    if (l.meta.tempPath) await unlink(l.meta.tempPath).catch(() => undefined);
    if (l.t.direction === 'upload' && l.meta.uploadId) {
      void this.deps.http.post(`/api/uploads/${l.meta.uploadId}/abort`, {}).catch(() => undefined);
    }
    this.finish(l, 'cancelled');
  }

  /** Canonical path of a finished download, only if it is inside the download folder. */
  private async finishedPath(id: string): Promise<string> {
    const l = this.liveOrLoad(id);
    const p = l.meta.finalPath;
    if (!p || l.t.state !== 'done') throw new DesktopError('NOT_FOUND', 'That download has not finished.');
    const real = await realpath(p).catch(() => null);
    const root = await realpath(this.deps.downloadFolder()).catch(() => resolve(this.deps.downloadFolder()));
    if (!real || (dirname(real) !== root && !real.startsWith(root + sep))) {
      throw new DesktopError('NOT_FOUND', 'That file has been moved or deleted.');
    }
    return real;
  }

  async openFile(id: string): Promise<boolean> {
    if (!this.deps.canOpenFiles()) throw new DesktopError('POLICY_DENIED', 'Your organization does not allow opening files in other applications.');
    const p = await this.finishedPath(id);
    const err = await shell.openPath(p);
    return err === '';
  }

  async reveal(id: string): Promise<boolean> {
    const p = await this.finishedPath(id);
    shell.showItemInFolder(p);
    return true;
  }

  clearFinished(): void {
    const uid = this.deps.userId();
    if (!uid) return;
    this.deps.db.run("DELETE FROM transfers WHERE user_id = ? AND state IN ('done', 'cancelled', 'failed')", uid);
    this.emit();
  }

  /** Transfers interrupted by a quit or crash are shown as paused, ready to resume. */
  recover(): void {
    const uid = this.deps.userId();
    if (!uid) return;
    this.deps.db.run("UPDATE transfers SET state = 'paused' WHERE user_id = ? AND state IN ('running', 'queued')", uid);
  }

  stopAll(): void {
    for (const l of this.live.values()) {
      if (l.t.state === 'running') {
        l.t.state = 'paused';
        l.abort?.abort();
        this.persist(l);
      }
    }
    this.live.clear();
  }

  wipe(userId: string): void {
    this.stopAll();
    this.deps.db.run('DELETE FROM transfers WHERE user_id = ?', userId);
    this.handles.clear();
  }
}
