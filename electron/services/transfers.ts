import type { Transfer } from '@shared/types';
import type { PickedFile } from '@shared/ipc/contract';
import { DesktopError, isDesktopError } from '../main/errors';
import { join, basename, dirname, resolve, sep } from 'node:path';
import { app, nativeImage, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, realpath, lstat, rename, stat } from 'node:fs/promises';
import { safeFileName, numberedName } from '@shared/filename';
import { mimeFor } from '@shared/mime';
import { openAsBlob, existsSync, createWriteStream } from 'node:fs';
import { uploadRefusal } from '@shared/uploads';
import { isMediaPath } from './api-proxy';
import { type Live, type DownloadOutcome, walkFolder, MAX_FOLDER_FILES, log, type Meta, messageOf, isOfficeExportPath, isGrantPath, type SinkWriter, isTemporaryStatus, isTemporaryFailure } from './transfers-support';
import { TransferUploads } from './transfers-upload';

// Its types, retry rules and helpers are in transfers-support.ts, the queue and the uploads in transfers-queue.ts and transfers-upload.ts (audit D-G13).
export { type DownloadSink, type SinkWriter, isGrantPath, type TransferDeps, type QueueConfig, queueConfig, MAX_AUTO_RETRIES, isTemporaryStatus, isTemporaryFailure, isConnectionFailure, QUOTA_HELD, QUOTA_RETRY_MS, multipartPart, isOfficeExportPath, type DownloadOutcome, walkFolder, chunkSizeFor, fileOnTender } from './transfers-support';

/**
 * DesktopDownloadManager / DesktopUploadManager (FR-XFR-01/02/03, AC-10).
 *
 * One queue for every module (worksuite-desktop#94): at most two files move at
 * once across uploads and downloads, the rest wait their turn in the
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
export class TransferManager extends TransferUploads {

  /** Native image decoding/thumbnails run asynchronously; picked paths never reach the renderer. */
  async prepareMedia(input: { handle?: string; data?: Uint8Array; name: string; originalQuality: boolean }): Promise<PickedFile & { preview?: string; mime?: string }> {
    let file = input.handle ? this.handles.get(input.handle) : undefined;
    const uid = this.deps.userId();
    if (!uid) throw new DesktopError('IPC_VALIDATION_FAILED', 'Sign in before sending media.');
    const make = async (data: Uint8Array, name: string): Promise<PickedFile> => {
      const folder = join(app.getPath('userData'), 'chat-media', randomUUID());
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const path = join(folder, safeFileName(name));
      await writeFile(path, data, { mode: 0o600 });
      const handle = randomUUID();
      this.handles.set(handle, { path, name: basename(path), size: data.byteLength, owned: true });
      setTimeout(() => {
        if (this.handles.delete(handle)) void unlink(path).catch(() => undefined);
      }, 30 * 60_000).unref?.();
      return { handle, name: basename(path), size: data.byteLength };
    };
    let picked: PickedFile;
    if (input.data) {
      picked = await make(input.data, input.name);
      file = this.handles.get(picked.handle);
    } else {
      if (!file || !input.handle) throw new DesktopError('IPC_VALIDATION_FAILED', 'That file is no longer available; choose it again.');
      picked = { handle: input.handle, name: file.name, size: file.size };
    }
    // Preserve animated GIFs, SVGs and unknown formats; optional processing never blocks delivery.
    const mime = mimeFor(picked.name) ?? '';
    if (/^(video|audio)\//.test(mime)) {
      const token = randomUUID();
      this.previewPaths.set(token, { path: file!.path, owner: uid, mime });
      setTimeout(() => this.previewPaths.delete(token), 12 * 60 * 60_000).unref?.();
      return { ...picked, mime, preview: `app://bundle/__local/chat-media/${token}` };
    }
    if (!/\.(jpe?g|png|webp)$/i.test(picked.name) || picked.size > 50 * 1024 * 1024) return picked;
    try {
      let image;
      try { image = await nativeImage.createThumbnailFromPath(file!.path, { width: 2048, height: 2048 }); }
      catch {
        // Electron's async OS thumbnail API is unavailable on Linux. Decode in main, never in the composer's UI thread.
        image = nativeImage.createFromPath(file!.path);
        const { width, height } = image.getSize();
        if (width > 2048 || height > 2048) image = image.resize(width >= height ? { width: 2048 } : { height: 2048 });
      }
      if (image.isEmpty()) return picked;
      const preview = image.resize({ width: 320 }).toDataURL();
      if (!input.originalQuality) {
        const jpeg = /\.jpe?g$/i.test(picked.name);
        const data = jpeg ? image.toJPEG(82) : image.toPNG();
        if (data.byteLength < picked.size) {
          const compressed = await make(data, picked.name.replace(/\.[^.]+$/, jpeg ? '.jpg' : '.png'));
          this.handles.delete(picked.handle);
          if (file!.owned) void unlink(file!.path).catch(() => undefined);
          return { ...compressed, preview };
        }
      }
      return { ...picked, preview };
    } catch { return picked; }
  }

  /** Capability-scoped local video/audio streams, with ranges; never accept a renderer path. */
  async serveMediaPreview(request: Request, path: string): Promise<Response> {
    const token = /^\/chat-media\/([a-f0-9-]{36})$/.exec(path)?.[1];
    const picked = token ? this.previewPaths.get(token) : undefined;
    if (!picked || picked.owner !== this.deps.userId()) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    try {
      const blob = await openAsBlob(picked.path, { type: picked.mime });
      const headers = { 'Content-Type': picked.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      const range = request.headers.get('Range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = match?.[1] ? Number(match[1]) : Math.max(0, blob.size - Number(match?.[2]));
        const end = match?.[2] && match[1] ? Math.min(blob.size - 1, Number(match[2])) : blob.size - 1;
        if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start > end || start >= blob.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
        return new Response(request.method === 'HEAD' ? null : blob.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${blob.size}`, 'Content-Length': String(end - start + 1) } });
      }
      return new Response(request.method === 'HEAD' ? null : blob, { headers: { ...headers, 'Content-Length': String(blob.size) } });
    } catch { return new Response('Not found', { status: 404 }); }
  }

  // ── handles ────────────────────────────────────────────────────────────

  /**
   * Validates user-chosen paths and returns opaque handles for them. A folder
   * is opened up: every file in it (not hidden ones, not through links) gets
   * a handle carrying its path inside the folder, the folder's name first.
   */
  async register(paths: string[]): Promise<PickedFile[]> {
    const out: PickedFile[] = [];
    const add = (real: string, size: number, relativePath?: string) => {
      // One limit for every module, said before anything is sent (#249).
      const refused = uploadRefusal(size);
      if (refused) throw new DesktopError('IPC_VALIDATION_FAILED', `${basename(real)}: ${refused}.`);
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

  protected async runDownload(l: Live, abort: AbortController): Promise<void> {
    const { meta } = l;
    if (meta.sink) return meta.source ? this.runKept(l, abort, meta.source, meta.sink) : this.settle(l, abort, 'failed', 'Nothing to download.');
    const source = meta.source ?? (meta.fileId ? `/api/files/${encodeURIComponent(meta.fileId)}/download` : null);
    if (!source || !meta.tempPath) return this.settle(l, abort, 'failed', 'Nothing to download.');
    let offset = 0;
    try {
      const local = this.deps.localCopy?.(source) ?? null;
      if (local) {
        await writeFile(meta.tempPath, local, { mode: 0o600 });
        if (abort.signal.aborted || l.abort !== abort) return;
        const final = meta.exactPath ?? (await this.uniquePath(this.deps.downloadFolder(), l.t.name));
        await rename(meta.tempPath, final);
        meta.finalPath = final;
        meta.tempPath = null;
        l.t.destination = final;
        l.t.total = local.byteLength;
        l.t.bytes = local.byteLength;
        this.settle(l, abort, 'done');
        if (meta.openWhenDone) void this.open(final).catch(() => undefined);
        return;
      }
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
    // A chat message cancelled is discarded (#300): its recording or copy made here goes too.
    if (l.meta.target?.kind === 'chat' && l.meta.ownedSource && l.meta.path) {
      await unlink(l.meta.path).catch(() => undefined);
      this.previewPaths.delete(id);
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
    for (const r of this.rows("state IN ('done', 'cancelled', 'failed')")) {
      const m = this.deps.vault().decrypt<Meta>(r.meta);
      // A chat message that did not go is not history: it stays, recording and all, until it is sent or its bubble's
      // Cancel discards it (#300).
      if (r.state === 'failed' && m?.target?.kind === 'chat') continue;
      if (m?.ownedSource && m.path) void unlink(m.path).catch(() => undefined);
      this.deps.db.run('DELETE FROM transfers WHERE user_id = ? AND id = ?', uid, r.id);
    }
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
    // A chat message that stopped on a temporary failure (its retries spent, or the connection gone) goes again at start (#300).
    for (const r of this.rows("state = 'failed' AND direction = 'upload'")) {
      if (this.live.has(r.id)) continue;
      let l: Live;
      try {
        l = this.liveOrLoad(r.id);
      } catch {
        continue;
      }
      if (l.meta.target?.kind !== 'chat' || !l.meta.temporary) continue;
      l.t.error = null;
      l.meta.attempts = 0;
      back.push(l);
    }
    back.sort((a, b) => (a.meta.queuedAt ?? a.t.createdAt).localeCompare(b.meta.queuedAt ?? b.t.createdAt));
    for (const l of back) {
      l.t.state = 'queued';
      // Preserve a pending retry deadline across restart so it cannot bypass backoff.
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
    this.previewPaths.clear();
  }
}
