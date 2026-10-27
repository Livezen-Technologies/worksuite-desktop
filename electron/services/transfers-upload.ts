import type { UploadTarget } from '@shared/ipc/contract';
import type { Transfer, TransferState } from '@shared/types';
import { MAX_MAIL_ATTACHMENT_BYTES, MAX_UPLOAD_BYTES, uploadRefusal, STALLED, CONNECTION_LOST, CHUNKED_FROM, PARALLEL_PARTS, STALL_MS, PART_ATTEMPTS, refusalMessage } from '@shared/uploads';
import { DesktopError, isDesktopError } from '../main/errors';
import { randomUUID } from 'node:crypto';
import { type Meta, type Live, fileOnTender, isConnectionFailure, Temporary, isTemporaryFailure, Stalled, messageOf, chunkSizeFor, refusal, CHUNK, sleep, multipartPart, isTemporaryStatus, REMOTE_MAX } from './transfers-support';
import { stat, open } from 'node:fs/promises';
import { basename } from 'node:path';
import { mimeFor } from '@shared/mime';
import { backoffDelay } from '@shared/backoff';
import { openAsBlob } from 'node:fs';
import { TransferQueue } from './transfers-queue';

/**
 * Uploads (electron/services/transfers.ts): chunked through WorkSuite's upload API (init → chunk × n → complete),
 * resumable from the server's own list of received chunks, and the remote-control and website-visitor sends (audit D-G13).
 */
export abstract class TransferUploads extends TransferQueue {

  // ── uploads ────────────────────────────────────────────────────────────

  async upload(handles: string[], target: UploadTarget): Promise<Transfer[]> {
    const out: Transfer[] = [];
    // Every file is measured against the limit before any of them is queued (#249): nothing starts to be refused later.
    const max = target.kind === 'mail' ? MAX_MAIL_ATTACHMENT_BYTES : MAX_UPLOAD_BYTES;
    for (const h of handles) {
      const file = this.handles.get(h);
      const refused = file ? uploadRefusal(file.size, max) : null;
      if (file && refused) throw new DesktopError('IPC_VALIDATION_FAILED', `${file.name}: ${refused}`.replace(/([^.])$/, '$1.'));
    }
    for (const h of handles) {
      if (target.kind === 'chat' && target.clientMessageId) {
        const existing = this.list().find((t) => t.chat?.clientMessageId === target.clientMessageId && t.chat?.roomId === target.roomId);
        if (existing) { out.push(existing); continue; }
      }
      const file = this.handles.get(h);
      if (!file) throw new DesktopError('IPC_VALIDATION_FAILED', 'That file is no longer available; choose it again.');
      // A handle is used once: asking twice never uploads the file twice.
      this.handles.delete(h);
      const t: Transfer = {
        id: randomUUID(),
        direction: 'upload',
        name: (target.kind === 'files' && target.name) || (file.relativePath ?? file.name),
        source: file.path,
        destination: target.kind === 'chat' ? 'Chat' : target.kind === 'task' ? 'Task' : target.kind === 'tender' ? 'Tender' : target.kind === 'mail' ? 'Mail' : target.kind === 'remote' ? 'Remote session' : target.kind === 'website' ? 'Website chat' : 'WorkSuite Files',
        bytes: 0,
        total: file.size,
        state: 'queued',
        speed: 0,
        error: null,
        createdAt: target.kind === 'chat' && target.submittedAt ? target.submittedAt : new Date().toISOString(),
      };
      const meta: Meta = { path: file.path, fileId: null, uploadId: null, target, chunkSize: null, totalChunks: null, sha256: null, tempPath: null, finalPath: null, openWhenDone: false, relativePath: target.kind === 'files' ? (file.relativePath ?? null) : null, ownedSource: file.owned };
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

  protected async runUpload(l: Live, abort: AbortController): Promise<void> {
    const { meta } = l;
    if (!meta.path || !meta.target) return this.settle(l, abort, 'failed', 'Nothing to upload.');
    try {
      this.phase(l, 'preparing');
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
        const roomId = meta.target.roomId;
        this.phase(l, 'waiting');
        this.pump();
        // Concurrent byte uploads, ordered posting within a room. A waiting post occupies no byte-upload slot.
        while (!abort.signal.aborted) {
          const rows = this.rows("direction = 'upload' AND state IN ('queued', 'running', 'paused')");
          const at = rows.findIndex((r) => r.id === l.t.id);
          const earlier = rows.slice(0, Math.max(0, at)).some((r) => {
            const m = this.deps.vault().decrypt<Meta>(r.meta);
            return m?.target?.kind === 'chat' && m.target.roomId === roomId;
          });
          if (!earlier) break;
          await new Promise<void>((resolve) => {
            const wake = () => { this.chatOrderWaiters.delete(wake); abort.signal.removeEventListener('abort', wake); resolve(); };
            this.chatOrderWaiters.add(wake);
            abort.signal.addEventListener('abort', wake, { once: true });
          });
        }
        if (abort.signal.aborted) return;
        this.phase(l, 'sending');
        await this.deps.http.post('/api/chat/messages/attachments', {
          room_id: meta.target.roomId,
          upload_id: meta.uploadId,
          // The same message id on every try: the server posts it once.
          client_message_id: meta.target.clientMessageId ?? `desktop-${l.t.id}`,
          // A voice message's length and loudness, measured while recording (#285); a server without `waveform` ignores it.
          ...(meta.target.voice ? { voice: true, duration_ms: meta.target.durationMs ?? 0, ...(meta.target.waveform?.length ? { waveform: meta.target.waveform } : {}) } : {}),
          ...(meta.target.caption ? { caption: meta.target.caption } : {}),
          ...(meta.target.replyTo ? { reply_to: meta.target.replyTo } : {}),
        });
      }
      this.settle(l, abort, 'done');
    } catch (e) {
      if (abort.signal.aborted) return;
      // The account's storage is full: held, queued, until there is room — never failed, never thrown away.
      if (isDesktopError(e) && e.code === 'QUOTA_EXCEEDED') return this.holdForQuota(l, abort);
      // Never a bare "The request was cancelled." (#249): a dropped or stalled connection is said as what it is,
      // and the upload waits for the connection, then carries on from the last part the server has.
      const connection = isConnectionFailure(e);
      const temporary = e instanceof Temporary || connection || isTemporaryFailure(e);
      const message = connection
        ? this.cfg.autoRetry
          ? e instanceof Stalled
            ? STALLED
            : CONNECTION_LOST
          : 'Connection lost. Retry to continue from where it stopped.'
        : messageOf(e);
      this.settle(l, abort, 'failed', message, temporary, connection);
    }
  }

  /**
   * The upload's bytes: init → parts → complete, going on from the parts the
   * server already has. An upload the server already completed (the answer
   * lost on the way back) is taken as done, never sent again.
   *
   * A large file's parts go several at a time (#249), each watched for
   * stalling rather than timed: a part is given up only when nothing has moved
   * for a minute, and tried again with backoff. The server checks the whole
   * file against the SHA-256 sent at the start before it keeps it.
   */
  private async sendParts(l: Live, abort: AbortController, path: string, size: number): Promise<void> {
    const { meta } = l;
    const target = meta.target!;
    if (!meta.sha256) meta.sha256 = (await this.deps.hash(path)).sha256;
    let received = new Set<number>();
    if (meta.uploadId) {
      try {
        const s = await this.deps.http.get<{ received_chunks?: number[]; status?: string; file_id?: number | string | null }>(`/api/uploads/${meta.uploadId}/status`, { timeoutMs: this.stallMs });
        if ((s.status === 'completed' || s.status === 'complete') && s.file_id !== undefined && s.file_id !== null) {
          meta.fileId = String(s.file_id);
          meta.completed = true;
          this.persist(l);
          this.progress(l, size);
          return;
        }
        // Thrown away by the server (aborted, or failed its checksum): start again.
        if (s.status === 'aborted' || s.status === 'failed') meta.uploadId = null;
        else received = new Set((s.received_chunks ?? []).map(Number));
      } catch (e) {
        // Out of reach: try again later with the same session. Anything else: the session expired, start over.
        if (isTemporaryFailure(e) || isConnectionFailure(e)) throw e;
        meta.uploadId = null;
      }
    }
    if (!meta.uploadId) {
      received = new Set();
      const filename = (target.kind === 'files' && target.name) || basename(path);
      const replacing = target.kind === 'files' && target.replaceFileId ? Number(target.replaceFileId) : null;
      let init: { upload_id: string; chunk_size: number; total_chunks: number; replaces?: number | string; received_chunks?: number[]; status?: string; file_id?: number | string | null };
      try {
        init = await this.deps.http.post<typeof init>('/api/uploads/init', {
          filename,
          total_size: size,
          chunk_size: chunkSizeFor(size, target),
          // The message's own id (#300): asked again — the answer lost, or the session forgotten — the server carries on
          // with the upload it already has instead of starting a second one.
          ...(target.kind === 'chat' && target.clientMessageId ? { client_key: target.clientMessageId } : {}),
          sha256: meta.sha256,
          mime_type: mimeFor(filename) ?? undefined,
          ...(replacing ? { replace_file_id: replacing } : {}),
          ...(meta.relativePath ? { relative_path: meta.relativePath } : {}),
          // A task's files are Drive files (in the top folder, as the web's are), linked to the task once they are in.
          // A mail attachment is staged for the message, never kept in Drive (#249).
          ...(target.kind === 'files' ? { purpose: 'drive', folder_id: target.folderId } : target.kind === 'task' || target.kind === 'tender' ? { purpose: 'drive', folder_id: null } : target.kind === 'mail' ? { purpose: 'mail' } : { purpose: 'chat', room_id: target.kind === 'chat' ? target.roomId : undefined }),
        });
      } catch (e) {
        throw refusal(e);
      }
      // A server that does not know `replace_file_id` ignores it and would add a second file of the same
      // name: it says which file it will replace, and without that the upload stops before any bytes go.
      if (replacing && Number(init.replaces) !== replacing) {
        await this.deps.http.post(`/api/uploads/${init.upload_id}/abort`, {}).catch(() => undefined);
        throw new DesktopError('SERVER_ERROR', 'This WorkSuite server cannot replace a file by uploading yet. Upload it again and choose Keep both.');
      }
      meta.uploadId = init.upload_id;
      meta.chunkSize = Number(init.chunk_size) || chunkSizeFor(size, target);
      meta.totalChunks = Number(init.total_chunks) || Math.max(1, Math.ceil(size / meta.chunkSize));
      // The same upload resumed by its client key (#300): finished already, or with some parts in.
      if ((init.status === 'completed' || init.status === 'complete') && init.file_id !== undefined && init.file_id !== null) {
        meta.fileId = String(init.file_id);
        meta.completed = true;
        this.persist(l);
        this.progress(l, size);
        return;
      }
      received = new Set((init.received_chunks ?? []).map(Number));
      this.persist(l);
    }
    const part = meta.chunkSize ?? CHUNK;
    const total = meta.totalChunks ?? Math.max(1, Math.ceil(size / part));
    this.phase(l, 'uploading');
    const fh = await open(path, 'r');
    try {
      let sent = [...received].reduce((a, i) => a + Math.max(0, Math.min(part, size - i * part)), 0);
      const moving = new Map<number, number>();
      const report = () => this.progress(l, Math.min(size, sent + [...moving.values()].reduce((a, b) => a + b, 0)));
      report();
      const todo: number[] = [];
      for (let i = 0; i < total; i++) if (!received.has(i)) todo.push(i);
      // One part going wrong stops the others: they are tried again from the server's list.
      const stop = new AbortController();
      const signal = AbortSignal.any([abort.signal, stop.signal]);
      let failure: unknown = null;
      const worker = async () => {
        while (!signal.aborted) {
          const i = todo.shift();
          if (i === undefined) return;
          const len = Math.max(0, Math.min(part, size - i * part));
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, i * part);
          await this.buckets.upload.take(len, signal);
          if (signal.aborted) return;
          try {
            await this.sendChunk(meta.uploadId!, i, buf, signal, (n) => {
              moving.set(i, n);
              report();
            });
          } finally {
            moving.delete(i);
          }
          received.add(i);
          sent += len;
          report();
        }
      };
      const lanes = size > CHUNKED_FROM ? Math.min(PARALLEL_PARTS, todo.length) : 1;
      await Promise.all(
        Array.from({ length: Math.max(1, lanes) }, () =>
          worker().catch((e) => {
            if (failure === null) failure = e;
            stop.abort();
          }),
        ),
      );
      if (abort.signal.aborted) return;
      if (failure !== null) throw failure;
    } finally {
      await fh.close();
    }
    this.phase(l, 'processing');
    if (target.kind === 'mail') return this.stageMail(l, abort);
    await this.finishUpload(l, abort);
  }

  private get stallMs(): number {
    return this.deps.stallMs ?? STALL_MS;
  }

  /**
   * The server puts the parts together, checks them against the file's
   * SHA-256, scans and stores the file. That can take longer than any one
   * request should wait for a large file (#249: a 50 MB PDF's `complete`
   * outlived the 30-second limit every request had, and its "aborted due to
   * timeout" read as "The request was cancelled."). So `complete` is asked
   * with the stall limit, and when the answer is slow — or the server says it
   * is still at it — the upload asks where it got to until it is done.
   */
  private async finishUpload(l: Live, abort: AbortController): Promise<void> {
    const { meta } = l;
    const id = meta.uploadId!;
    const began = Date.now();
    const poll = this.deps.pollMs ?? 3000;
    for (;;) {
      if (abort.signal.aborted) return;
      let answer: { file_id?: number | string | null; status?: string } | null = null;
      try {
        answer = await this.deps.http.post<{ file_id?: number | string | null; status?: string }>(`/api/uploads/${id}/complete`, {}, { timeoutMs: this.stallMs, signal: abort.signal });
      } catch (e) {
        if (abort.signal.aborted) return;
        if (!(isTemporaryFailure(e) || isConnectionFailure(e))) {
          // The parts did not add up to the file: they are thrown away and the next try starts afresh.
          if (isDesktopError(e) && e.status === 422 && /checksum/i.test(e.message)) {
            meta.uploadId = null;
            this.persist(l);
            throw new DesktopError('SERVER_ERROR', 'The file arrived damaged (its checksum did not match). It will be sent again from the start when you retry.', 422);
          }
          throw refusal(e);
        }
      }
      if (answer && answer.status !== 'assembling') {
        meta.fileId = answer.file_id !== undefined && answer.file_id !== null ? String(answer.file_id) : null;
        meta.completed = true;
        this.persist(l);
        return;
      }
      // Still being put together (or the answer was slow): ask where it got to — at once after a lost answer.
      let wait = answer ? poll : 0;
      for (;;) {
        await sleep(wait, abort.signal);
        wait = poll;
        if (abort.signal.aborted) return;
        if (Date.now() - began > 30 * 60_000) throw new Temporary('The server is still processing this file. It will be checked again shortly.');
        const s = await this.deps.http.get<{ status?: string; file_id?: number | string | null }>(`/api/uploads/${id}/status`, { timeoutMs: this.stallMs, signal: abort.signal });
        if ((s.status === 'completed' || s.status === 'complete') && s.file_id !== undefined && s.file_id !== null) {
          meta.fileId = String(s.file_id);
          meta.completed = true;
          this.persist(l);
          return;
        }
        if (s.status === 'failed' || s.status === 'aborted') {
          meta.uploadId = null;
          this.persist(l);
          throw new DesktopError('SERVER_ERROR', 'The server could not finish this file. It will be sent again from the start when you retry.');
        }
        // Done but not saying which file (an older server), or not started: ask `complete` again, which answers at once.
        if (s.status !== 'assembling') break;
      }
    }
  }

  /**
   * A mail attachment's parts, staged for the message on the server (#249):
   * not kept in Drive. Asking again for the same upload gives the same staged
   * copy, so a lost answer never stages it twice.
   */
  private async stageMail(l: Live, abort: AbortController): Promise<void> {
    const { meta } = l;
    try {
      const r = await this.deps.http.post<{ token: string; name: string; size: number }>('/api/mail/upload/from-upload', { upload_id: meta.uploadId }, { timeoutMs: this.stallMs, signal: abort.signal });
      if (abort.signal.aborted) return;
      meta.attachment = { token: String(r.token), name: String(r.name ?? l.t.name), size: Number(r.size ?? l.t.total) };
      meta.completed = true;
      this.persist(l);
    } catch (e) {
      if (isDesktopError(e) && e.status === 422 && /checksum/i.test(e.message)) {
        meta.uploadId = null;
        this.persist(l);
      }
      if (isTemporaryFailure(e) || isConnectionFailure(e)) throw e;
      throw refusal(e);
    }
  }

  /**
   * One part, tried up to five times with backoff. No time limit: it is given
   * up only when no bytes have moved and no answer has come for a minute
   * (#249) — 8 MB on a slow line takes as long as it takes.
   */
  private async sendChunk(uploadId: string, index: number, buf: Buffer, signal: AbortSignal, onSent: (bytes: number) => void = () => undefined): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= PART_ATTEMPTS - 1;
      const stall = new AbortController();
      let timer: NodeJS.Timeout | null = null;
      const poke = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => stall.abort(), this.stallMs);
        timer.unref?.();
      };
      const both = AbortSignal.any([signal, stall.signal]);
      try {
        poke();
        // A part sent again replaces the one the server has under the same index: never a second copy.
        const res = await this.deps.http.raw('POST', this.deps.http.url(`/api/uploads/${uploadId}/chunk`), {
          // Built again for each send (the session's 401 refresh sends it twice).
          bodyFactory: () => {
            const m = multipartPart({ chunk_index: String(index) }, 'chunk', `part-${index}`, buf, (n) => (poke(), onSent(n)));
            return { body: m.body, contentType: m.contentType };
          },
          duplex: 'half',
          signal: both,
          timeoutMs: 0,
        } as RequestInit & { timeoutMs: number });
        if (res.ok) return;
        let said: string | undefined;
        try {
          said = ((await res.json()) as { message?: string }).message;
        } catch {
          /* no message */
        }
        if (!isTemporaryStatus(res.status)) throw new DesktopError('SERVER_ERROR', refusalMessage(res.status, said ?? `The server refused part ${index + 1} (${res.status}).`, res.status === 413 ? 'part' : 'file'), res.status);
        if (last) throw new Temporary(`The server answered ${res.status} for part ${index + 1}.`);
      } catch (e) {
        if (signal.aborted) throw e;
        if (isDesktopError(e) && e.code === 'SERVER_ERROR' && e.status !== null && !isTemporaryStatus(e.status)) throw e;
        if (last) throw stall.signal.aborted ? new Stalled(STALLED) : e;
      } finally {
        if (timer) clearTimeout(timer);
        onSent(0);
      }
      await sleep(this.deps.partDelay ? this.deps.partDelay(attempt) : backoffDelay(attempt, { baseMs: 1000, maxMs: 30_000 }), signal);
    }
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
}
