import type { PdfAnnotView, PdfAttachmentView, PdfEngineCapabilities, PdfLinkView, PdfOutlineNode, PdfPageSize, PdfSearchOptions, PdfSecurityReport } from '@shared/pdf';
import { EngineError, ENGINE_MESSAGES, type CancelToken, type EngineCompose, type EngineEditOp, type EngineFile, type EngineOpened, type PDFEngine, type RenderedPixels, type RenderRequest, type SearchProgress, type TextSpan } from './engine';
import type { WorkerMessage, WorkerRequest } from './worker-protocol';

/**
 * The main process's side of a pdf-worker: PDFEngineInterface over messages
 * (PDF-ARCH-001, PDF-ARCH-013).
 *
 *  - Cancelable: a search or a scan stops between pages when asked; renders
 *    are cancelled before they reach the worker (the service's queue).
 *  - Watched: pinged every few seconds; a worker that stops answering, or a
 *    request past its deadline, ends the process and fails everything
 *    waiting with `timeout`. A worker that exits fails it with `crashed`.
 *  - Restartable: the service makes a new worker for Retry; nothing here
 *    outlives its process.
 */
export interface WorkerChannel {
  post(msg: WorkerRequest): void;
  onMessage(cb: (m: WorkerMessage) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

/** A request without its id (the engine numbers them), kept per kind of request. */
type Req = Extract<WorkerRequest, { id: number }> extends infer T ? (T extends unknown ? Omit<T, 'id'> : never) : never;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: EngineError) => void;
  timer: NodeJS.Timeout | null;
  progress?: (v: unknown) => void;
}

export interface WorkerEngineOptions {
  /** A render or a small read; opening gets `openTimeoutMs`. Searches and scans have none: they answer pings as they go. */
  timeoutMs: number;
  openTimeoutMs: number;
  pingMs: number;
  /** No pong for this long ends the worker. */
  hungMs: number;
}

const DEFAULTS: WorkerEngineOptions = { timeoutMs: 30_000, openTimeoutMs: 120_000, pingMs: 4_000, hungMs: 20_000 };

export class WorkerEngine implements PDFEngine {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private caps: PdfEngineCapabilities | null = null;
  private dead: EngineError | null = null;
  private readonly ready: Promise<void>;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastPong = Date.now();
  private pingN = 0;
  /** The engine's memory at its last answer (for Diagnostics). */
  memory = 0;
  /** Told once, when the worker is gone for good (crashed, hung, over its memory, or closed). */
  onGone: (e: EngineError) => void = () => undefined;

  constructor(
    private readonly ch: WorkerChannel,
    private readonly opts: WorkerEngineOptions = DEFAULTS,
  ) {
    let started: () => void = () => undefined;
    let failed: (e: EngineError) => void = () => undefined;
    this.ready = new Promise<void>((res, rej) => {
      started = res;
      failed = rej;
    });
    // Nobody may be waiting when a worker fails to start; the next call sees it.
    this.ready.catch(() => undefined);
    ch.onMessage((m) => {
      if (m.type === 'ready') {
        this.caps = m.capabilities;
        this.lastPong = Date.now();
        started();
        return;
      }
      if (m.type === 'pong') {
        this.lastPong = Date.now();
        this.memory = m.memory;
        return;
      }
      if (m.type === 'fatal') {
        const e = new EngineError(m.code, m.message);
        failed(e);
        this.die(e);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') {
        p.progress?.(m.value);
        return;
      }
      this.pending.delete(m.id);
      if (p.timer) clearTimeout(p.timer);
      if (m.ok) p.resolve(m.value);
      else p.reject(new EngineError(m.code, m.message));
    });
    ch.onExit(() => {
      const e = this.dead ?? new EngineError('crashed', ENGINE_MESSAGES.crashed);
      failed(e);
      this.die(e, false);
    });
    this.pingTimer = setInterval(() => {
      if (this.dead) return;
      if (Date.now() - this.lastPong > opts.hungMs) {
        this.die(new EngineError('timeout', ENGINE_MESSAGES.timeout));
        return;
      }
      this.send({ type: 'ping', n: ++this.pingN });
    }, opts.pingMs);
    this.pingTimer.unref?.();
  }

  get alive(): boolean {
    return !this.dead;
  }

  private send(msg: WorkerRequest): void {
    try {
      this.ch.post(msg);
    } catch {
      this.die(new EngineError('crashed', ENGINE_MESSAGES.crashed));
    }
  }

  /** Ends the worker and fails everything waiting on it. */
  private die(e: EngineError, kill = true): void {
    if (this.dead) return;
    this.dead = e;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
    if (kill) {
      try {
        this.ch.kill();
      } catch {
        /* already gone */
      }
    }
    this.onGone(e);
  }

  private request<T>(msg: Req, timeoutMs: number | null, progress?: (v: unknown) => void): Promise<T> {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            if (this.pending.has(id)) this.die(new EngineError('timeout', ENGINE_MESSAGES.timeout));
          }, timeoutMs)
        : null;
      timer?.unref?.();
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, progress });
      this.send({ ...msg, id } as WorkerRequest);
    });
  }

  capabilities(): PdfEngineCapabilities {
    if (!this.caps) throw new EngineError('unsupported', 'The PDF engine has not started yet.');
    return this.caps;
  }

  async started(): Promise<PdfEngineCapabilities> {
    await this.ready;
    return this.capabilities();
  }

  async open(file: EngineFile, password: string | null): Promise<EngineOpened> {
    await this.ready;
    return this.request<EngineOpened>({ op: 'open', file, password }, this.opts.openTimeoutMs);
  }

  render(req: RenderRequest): Promise<RenderedPixels> {
    return this.request<RenderedPixels>({ op: 'render', req }, this.opts.timeoutMs);
  }

  private async streaming<T, R>(msg: Req, onProgress: (v: T) => void, cancel: CancelToken): Promise<R> {
    if (this.dead) throw this.dead;
    const id = this.seq + 1;
    let watch: NodeJS.Timeout | null = setInterval(() => {
      if (cancel.cancelled && watch) {
        clearInterval(watch);
        watch = null;
        void this.request({ op: 'cancel', target: id }, this.opts.timeoutMs).catch(() => undefined);
      }
    }, 50);
    watch.unref?.();
    try {
      return await this.request<R>(msg, null, (v) => {
        if (!cancel.cancelled) onProgress(v as T);
      });
    } finally {
      if (watch) clearInterval(watch);
    }
  }

  search(query: string, options: PdfSearchOptions, onProgress: (p: SearchProgress) => void, cancel: CancelToken): Promise<void> {
    return this.streaming<SearchProgress, void>({ op: 'search', query, options }, onProgress, cancel);
  }

  scan(onProgress: (s: PdfSecurityReport) => void, cancel: CancelToken): Promise<PdfSecurityReport> {
    return this.streaming<PdfSecurityReport, PdfSecurityReport>({ op: 'scan' }, onProgress, cancel);
  }

  outline(): Promise<PdfOutlineNode[]> {
    return this.request<PdfOutlineNode[]>({ op: 'outline' }, this.opts.timeoutMs);
  }

  links(page: number): Promise<PdfLinkView[]> {
    return this.request<PdfLinkView[]>({ op: 'links', page }, this.opts.timeoutMs);
  }

  attachments(): Promise<PdfAttachmentView[]> {
    return this.request<PdfAttachmentView[]>({ op: 'attachments' }, this.opts.timeoutMs);
  }

  annotations(page: number): Promise<PdfAnnotView[]> {
    return this.request<PdfAnnotView[]>({ op: 'annotations', page }, this.opts.timeoutMs);
  }

  apply(edit: EngineEditOp): Promise<PdfPageSize[]> {
    // Inserting another file's pages reads that file: as long as opening one may take.
    return this.request<PdfPageSize[]>({ op: 'apply', edit }, edit.op === 'page.insertFile' ? this.opts.openTimeoutMs : this.opts.timeoutMs);
  }

  textSpan(page: number, from: [number, number], to: [number, number]): Promise<TextSpan> {
    return this.request<TextSpan>({ op: 'textSpan', page, from, to }, this.opts.timeoutMs);
  }

  /** Writing out a large document takes as long as opening one may. */
  save(): Promise<Uint8Array> {
    return this.request<Uint8Array>({ op: 'save' }, this.opts.openTimeoutMs);
  }

  extract(pages: number[]): Promise<Uint8Array> {
    return this.request<Uint8Array>({ op: 'extract', pages }, this.opts.openTimeoutMs);
  }

  protect(userPassword: string, ownerPassword: string, permissions: number): Promise<Uint8Array> {
    return this.request<Uint8Array>({ op: 'protect', userPassword, ownerPassword, permissions }, this.opts.openTimeoutMs);
  }

  unprotect(): Promise<Uint8Array> {
    return this.request<Uint8Array>({ op: 'unprotect' }, this.opts.openTimeoutMs);
  }

  pageText(pages: number[]): Promise<string[]> {
    return this.request<string[]>({ op: 'pageText', pages }, this.opts.openTimeoutMs);
  }

  compose(req: EngineCompose): Promise<Uint8Array> {
    return this.request<Uint8Array>({ op: 'compose', req }, this.opts.openTimeoutMs);
  }

  unload(): Promise<void> {
    return this.request<void>({ op: 'unload' }, this.opts.timeoutMs);
  }

  /** Closes the document and ends the process (its memory goes with it). */
  async close(): Promise<void> {
    if (this.dead) return;
    await Promise.race([this.request({ op: 'close' }, 5_000).catch(() => undefined), new Promise((r) => setTimeout(r, 5_000).unref?.())]);
    this.die(new EngineError('cancelled', 'Closed.'));
  }
}
