import { type Handle, type Live, type DownloadOutcome, type QueueConfig, type TransferDeps, type Meta, uploadExtras, MAX_AUTO_RETRIES, QUOTA_RETRY_MS, QUOTA_HELD, log, messageOf } from './transfers-support';
import { TokenBucket } from './throttle';
import type { Transfer, TransferState } from '@shared/types';
import { MAX_CONCURRENT } from '@shared/transfers';
import type { UploadTarget } from '@shared/ipc/contract';
import { mimeFor } from '@shared/mime';
import { unlink } from 'node:fs/promises';
import { CHAT_RETRY_MS } from '@shared/uploads';
import { backoffDelay } from '@shared/backoff';
import { DesktopError } from '../main/errors';

/**
 * The transfer queue (electron/services/transfers.ts): its state, one queue for every module, the slots, the retries
 * and the quota hold. Uploads are in transfers-upload.ts and downloads in TransferManager itself (audit D-G13).
 */
export abstract class TransferQueue {
  protected handles = new Map<string, Handle>();
  protected live = new Map<string, Live>();
  protected emitTimer: NodeJS.Timeout | null = null;
  /** Downloads a service waits for (Office's copies for another app): told once, when they end. */
  protected whenDone = new Map<string, (outcome: DownloadOutcome) => void>();
  /** Uploads a service waits for (a meeting recording): told once, when they end. */
  protected uploadDone = new Map<string, (outcome: { fileId: string | null } | { error: string }) => void>();
  /** Transfers waiting for a free slot, first asked first started. */
  protected queue: string[] = [];
  protected cfg: QueueConfig = { maxConcurrent: 2, maxUploads: null, maxDownloads: null, uploadBps: null, downloadBps: null, autoRetry: true, autoResume: true, metered: 'limit' };
  /** One cap for every upload and one for every download, whatever module started them. */
  protected buckets = { upload: new TokenBucket(null), download: new TokenBucket(null) };
  protected chatOrderWaiters = new Set<() => void>();
  protected previewPaths = new Map<string, { path: string; owner: string; mime: string }>();
  private offline = false;
  private metered = false;
  protected retryTimer: NodeJS.Timeout | null = null;
  private pumping = false;
  private pumpAgain = false;
  onChanged: (list: Transfer[]) => void = () => undefined;

  constructor(protected readonly deps: TransferDeps) {}

  // ── settings ───────────────────────────────────────────────────────────

  /**
   * Drive › Settings, applied at once: a lower limit lets what is moving
   * finish and holds the next ones until there is room; a new cap slows (or
   * frees) the transfers already moving.
   */
  configure(cfg: QueueConfig): void {
    const connectionChanged = cfg.meteredConnection !== this.cfg.meteredConnection;
    const maxConcurrent = Number.isFinite(cfg.maxConcurrent) ? Math.min(MAX_CONCURRENT, Math.max(1, Math.round(cfg.maxConcurrent))) : MAX_CONCURRENT;
    this.cfg = { ...cfg, maxConcurrent };
    this.buckets.upload.setRate(cfg.uploadBps);
    this.buckets.download.setRate(cfg.downloadBps);
    if (connectionChanged && cfg.meteredConnection !== undefined) this.setMetered(cfg.meteredConnection);
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
      // What waits in the queue now waits for the connection, and says so.
      this.emit();
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
    this.emit();
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

  protected rows(where: string): Array<{ id: string; direction: string; name: string; meta: string; bytes: number; total: number; state: string; error: string | null; created_at: string }> {
    const uid = this.deps.userId();
    if (!uid) return [];
    return this.deps.db.all(`SELECT * FROM transfers WHERE user_id = ? AND ${where} ORDER BY created_at ASC`, uid);
  }

  protected view(l: Live): Transfer {
    const at = this.queue.indexOf(l.t.id);
    const held = l.t.state === 'queued' ? (l.meta.waitingFor === 'quota' ? 'quota' : this.offline ? 'connection' : this.metered && this.cfg.metered === 'pause' ? 'metered' : null) : null;
    return {
      ...l.t,
      fileId: l.meta.fileId,
      position: at >= 0 ? at + 1 : null,
      retryAt: l.meta.retryAt ?? null,
      attempts: l.meta.attempts ?? 0,
      movedAt: l.t.state === 'running' && l.movedAt ? new Date(l.movedAt).toISOString() : null,
      held,
      phase: l.meta.phase,
      ...(l.meta.target?.kind === 'chat' ? { chat: this.chatInfo(l.t.id, l.meta.target, l.meta) } : {}),
      ...uploadExtras(l.meta),
    };
  }

  private chatInfo(id: string, target: Extract<UploadTarget, { kind: 'chat' }>, meta?: Meta | null): NonNullable<Transfer['chat']> {
    return { roomId: target.roomId, clientMessageId: target.clientMessageId ?? `desktop-${id}`, caption: target.caption, voice: target.voice, durationMs: target.durationMs, waveform: target.waveform, ...this.voicePreview(id, target, meta) };
  }

  /**
   * A voice message's recording on this computer, played in its bubble until the server's copy is in (#300) — also in
   * another window, and after a restart, when the address the composer had is gone. The same capability-scoped
   * `chat-media` address as a fresh preview, named by the transfer, for this person only.
   */
  private voicePreview(id: string, target: Extract<UploadTarget, { kind: 'chat' }>, meta?: Meta | null): { preview?: string } {
    const uid = this.deps.userId();
    if (!target.voice || !meta?.ownedSource || !meta.path || !uid || !/^[a-f0-9-]{36}$/.test(id)) return {};
    if (!this.previewPaths.has(id)) this.previewPaths.set(id, { path: meta.path, owner: uid, mime: mimeFor(meta.path) ?? 'audio/webm' });
    return { preview: `app://bundle/__local/chat-media/${id}` };
  }

  protected phase(l: Live, phase: NonNullable<Transfer['phase']>): void {
    l.meta.phase = phase;
    this.persist(l); this.emit();
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
        fileId: m?.fileId ?? null,
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
        phase: m?.phase,
        ...(m?.target?.kind === 'chat' ? { chat: this.chatInfo(r.id, m.target, m) } : {}),
        ...(m ? uploadExtras(m) : {}),
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

  protected persist(l: Live): void {
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

  protected emit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.onChanged(this.list());
    }, 250);
  }

  protected progress(l: Live, bytes: number): void {
    const now = Date.now();
    if (bytes !== l.t.bytes) l.movedAt = now;
    l.t.bytes = bytes;
    l.samples.push({ at: now, bytes });
    while (l.samples.length > 2 && now - l.samples[0]!.at > 3000) l.samples.shift();
    const first = l.samples[0]!;
    const dt = (now - first.at) / 1000;
    l.t.speed = dt > 0.2 ? Math.max(0, (bytes - first.bytes) / dt) : l.t.speed;
    this.emit();
  }

  protected finish(l: Live, state: TransferState, error: string | null = null): void {
    l.t.state = state;
    l.t.error = error;
    l.t.speed = 0;
    l.abort = null;
    if (state !== 'queued') l.meta.retryAt = null;
    this.dequeue(l.t.id);
    this.persist(l);
    for (const wake of [...this.chatOrderWaiters]) wake();
    if (state === 'done' && l.meta.finalPath && l.meta.source && this.deps.downloaded) void Promise.resolve(this.deps.downloaded(l.meta.finalPath, l.meta.source)).catch(() => undefined);
    if (state === 'done' && l.meta.ownedSource && l.meta.path) {
      const path = l.meta.path;
      // Keep the local preview usable until server history replaces the optimistic bubble.
      setTimeout(() => void unlink(path).catch(() => undefined), 30 * 60_000).unref?.();
    }
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
  protected settle(l: Live, abort: AbortController, state: 'done' | 'failed', error: string | null = null, temporary = false, patient = false): void {
    if (abort.signal.aborted || l.abort !== abort) return;
    if (state === 'failed') l.meta.temporary = temporary;
    if (state === 'done') {
      l.meta.attempts = 0;
      l.meta.temporary = false;
    }
    // An upload the connection interrupted waits for it however long it is gone (#249): a minute apart at most.
    // A chat message goes 2 s, 5 s, 15 s, 30 s, 60 s apart, then stops for its bubble's Retry and Cancel (#300); the
    // connection coming back, and the next start, try it again by themselves.
    const chat = l.meta.target?.kind === 'chat';
    const most = chat ? CHAT_RETRY_MS.length : MAX_AUTO_RETRIES;
    if (state === 'failed' && temporary && this.cfg.autoRetry && ((patient && !chat) || (l.meta.attempts ?? 0) < most)) return this.retryLater(l, error);
    this.finish(l, state, error);
  }

  /** QUOTA_EXCEEDED: back in the queue, where it was, waiting for `releaseQuota()`; what was sent stays. */
  protected holdForQuota(l: Live, abort: AbortController): void {
    if (abort.signal.aborted || l.abort !== abort) return;
    l.meta.waitingFor = 'quota';
    l.meta.attempts = 0;
    l.meta.temporary = false;
    l.meta.retryAt = new Date(Date.now() + QUOTA_RETRY_MS).toISOString();
    l.t.state = 'queued';
    l.t.error = QUOTA_HELD;
    l.t.speed = 0;
    l.abort = null;
    this.dequeue(l.t.id);
    this.queue.push(l.t.id);
    this.persist(l);
    this.emit();
    this.deps.onQuotaHeld?.();
    this.pump();
  }

  /** Uploads waiting for room. */
  quotaHeld(): number {
    let n = 0;
    for (const l of this.live.values()) if (l.t.state === 'queued' && l.meta.waitingFor === 'quota') n++;
    return n;
  }

  /** There is room again (the quota watcher says usage is below full): every upload waiting for it goes on, in order. */
  releaseQuota(): void {
    let any = false;
    for (const l of this.live.values()) {
      if (l.meta.waitingFor !== 'quota') continue;
      l.meta.waitingFor = null;
      l.meta.retryAt = null;
      if (l.t.error === QUOTA_HELD) l.t.error = null;
      this.persist(l);
      any = true;
    }
    if (!any) return;
    this.emit();
    this.pump();
  }

  private retryLater(l: Live, error: string | null): void {
    const attempt = l.meta.attempts ?? 0;
    l.meta.attempts = attempt + 1;
    const delay = this.deps.retryDelay
      ? this.deps.retryDelay(attempt)
      : l.meta.target?.kind === 'chat'
        ? CHAT_RETRY_MS[Math.min(attempt, CHAT_RETRY_MS.length - 1)]!
        : backoffDelay(attempt, { baseMs: 2000, maxMs: 60_000, jitter: 0.5 });
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
  protected enqueue(l: Live): void {
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

  protected dequeue(id: string): void {
    const at = this.queue.indexOf(id);
    if (at >= 0) this.queue.splice(at, 1);
  }

  private running(): { all: number; upload: number; download: number } {
    const n = { all: 0, upload: 0, download: 0 };
    for (const l of this.live.values()) {
      if (l.t.state !== 'running') continue;
      // Posting a chat message moves no file bytes; waiting for an earlier message must not hold an upload slot.
      if (l.meta.target?.kind === 'chat' && l.meta.completed) continue;
      n.all++;
      n[l.t.direction]++;
    }
    return n;
  }

  /** The overall limit as it applies now: one at a time on a metered connection, if asked. */
  private limit(): number {
    return this.metered && this.cfg.metered === 'limit' ? 1 : Math.min(MAX_CONCURRENT, Math.max(1, this.cfg.maxConcurrent));
  }

  private held(): boolean {
    return this.offline || (this.metered && this.cfg.metered === 'pause');
  }

  /** Starts whatever may start now, in queue order, and wakes again for the next retry that is due. */
  protected pump(): void {
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
      // Waiting for room in the account's storage: `releaseQuota()` lets it go — or, should nobody say, a try of its
      // own now and then (refused again, it waits again).
      if (l.meta.waitingFor === 'quota') {
        const at = l.meta.retryAt ? Date.parse(l.meta.retryAt) : Infinity;
        if (at > now) {
          soonest = Math.min(soonest, at);
          continue;
        }
        l.meta.waitingFor = null;
      }
      const due = l.meta.retryAt ? Date.parse(l.meta.retryAt) : 0;
      if (due > now) {
        soonest = Math.min(soonest, due);
        continue;
      }
      if (held && !(l.t.direction === 'download' && !l.meta.sink && l.meta.source && this.deps.hasLocalCopy?.(l.meta.source))) continue;
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
    l.movedAt = Date.now();
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

  // ── controls ───────────────────────────────────────────────────────────

  protected liveOrLoad(id: string): Live {
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

  /** Stops a running or waiting transfer where it is; what it already moved is kept for a resume. */
  protected pauseLive(l: Live, why: string | null = null): void {
    l.t.state = 'paused';
    l.abort?.abort();
    this.finish(l, 'paused', why);
  }

  protected abstract resume(id: string): void;
  protected abstract runUpload(l: Live, abort: AbortController): Promise<void>;
  protected abstract runDownload(l: Live, abort: AbortController): Promise<void>;
}
