import { cpus, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { WindowLimiter } from '@shared/backoff';
import { tierFor, type LocalAIEvent, type LocalAIHardware, type LocalAIRequest, type LocalAIStatus, type LocalRuntimeState } from '@shared/local-ai';
import type { EngineInfo } from './engine';
import type { LocalAIModelManager } from './models';
import type { FromWorker, ToWorker } from './protocol';

/**
 * DesktopLocalAIService's main-process side (LAI-DSK, LAI-CORE): starts the `ws-local-ai` process on first use,
 * loads the default model, sends each request's text back to the window that asked, and handles the process
 * dying — its requests fail with a sentence, the next request starts it again, and more than 3 crashes in 10
 * minutes stops Local AI with an error until it is reset (LAI-DSK-008). An idle model is unloaded after 10
 * minutes to give the memory back.
 */
export interface WorkerLink {
  post(m: ToWorker): void;
  onMessage(cb: (m: FromWorker) => void): void;
  onExit(cb: (code: number) => void): void;
  kill(): void;
}

export interface RuntimeDeps {
  spawn: () => WorkerLink;
  models: LocalAIModelManager;
  modelsRoot: string;
  /** To the window that asked. */
  emit: (sender: number, ev: LocalAIEvent) => void;
  onChange?: () => void;
  idleMs?: number;
  startTimeoutMs?: number;
}

type Waiter = { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class LocalAIRuntime {
  private link: LocalAIRuntimeLink | null = null;
  private state: LocalRuntimeState = 'off';
  private error: string | null = null;
  private info: EngineInfo | null = null;
  private loadedPath: string | null = null;
  private loadedId: string | null = null;
  private pending = new Map<string, number>();
  private crashes = new WindowLimiter(3, 10 * 60_000);
  private idle: NodeJS.Timeout | null = null;
  private starting: Promise<void> | null = null;
  private loadWaiter: Waiter | null = null;

  constructor(private readonly deps: RuntimeDeps) {}

  private set(state: LocalRuntimeState, error: string | null = this.error): void {
    this.state = state;
    this.error = error;
    this.deps.onChange?.();
  }

  status(catalog: { at: string | null; error: string | null }, hardware: LocalAIHardware | null): LocalAIStatus {
    return { runtime: this.state, error: this.error, loaded: this.loadedId, hardware, catalogError: catalog.error, catalogAt: catalog.at };
  }

  /** This computer, for the tier and the model advice (LAI-HW-001…003). */
  async hardware(): Promise<LocalAIHardware> {
    const fs = await statfs(this.deps.modelsRoot).catch(() => null);
    const memoryBytes = totalmem();
    const gpu = this.info?.gpu ?? false;
    const vramBytes = this.info?.vramBytes ?? 0;
    return { platform: process.platform, arch: process.arch, memoryBytes, freeDiskBytes: fs ? fs.bavail * fs.bsize : null, cpuCores: this.info?.cpuCores ?? cpus().length, gpu, vramBytes, tier: tierFor(memoryBytes, vramBytes, gpu) };
  }

  /** Starts the process and llama.cpp, once. */
  private start(): Promise<void> {
    if (this.link) return Promise.resolve();
    if (this.state === 'error') return Promise.reject(new Error(this.error ?? 'Local AI stopped working.'));
    this.starting ??= new Promise<void>((resolve, reject) => {
      this.set('starting');
      const link = this.deps.spawn();
      this.link = new LocalAIRuntimeLink(link);
      const timer = setTimeout(() => reject(new Error('Local AI did not start in time.')), this.deps.startTimeoutMs ?? 60_000);
      link.onMessage((m) => {
        if (m.type === 'ready') {
          clearTimeout(timer);
          this.info = m.info;
          this.set('ready', null);
          resolve();
        } else if (m.type === 'error' && m.op === 'init') {
          clearTimeout(timer);
          reject(new Error(m.message));
        } else this.onMessage(m);
      });
      link.onExit((code) => this.onExit(code));
      link.post({ type: 'init' });
    }).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private onMessage(m: FromWorker): void {
    if (m.type === 'loaded' || m.type === 'unloaded' || (m.type === 'error' && m.op === 'load')) {
      const w = this.loadWaiter;
      this.loadWaiter = null;
      if (w) {
        clearTimeout(w.timer);
        if (m.type === 'error') w.reject(new Error(m.message));
        else w.resolve();
      }
      return;
    }
    if (m.type === 'chunk') {
      const sender = this.pending.get(m.id);
      if (sender !== undefined) this.deps.emit(sender, { id: m.id, type: 'chunk', text: m.text });
      return;
    }
    if (m.type === 'done' || (m.type === 'error' && m.id)) {
      const id = m.id!;
      const sender = this.pending.get(id);
      this.pending.delete(id);
      if (sender !== undefined) this.deps.emit(sender, m.type === 'done' ? { id, type: 'done', text: m.text, tokens: m.tokens, ms: m.ms, cancelled: m.cancelled } : { id, type: 'error', message: m.message });
      if (!this.pending.size) {
        this.set('ready');
        this.armIdle();
      }
    }
  }

  private onExit(code: number): void {
    this.link = null;
    this.loadedPath = null;
    this.loadedId = null;
    const w = this.loadWaiter;
    this.loadWaiter = null;
    if (w) {
      clearTimeout(w.timer);
      w.reject(new Error('Local AI stopped while loading the model.'));
    }
    for (const [id, sender] of this.pending) this.deps.emit(sender, { id, type: 'error', message: 'Local AI stopped unexpectedly. Try again.' });
    this.pending.clear();
    if (this.stopping) {
      this.stopping = false;
      this.set('off', null);
      return;
    }
    if (!this.crashes.hit()) this.set('error', `Local AI stopped ${this.crashes.count()} times in 10 minutes (exit ${code}), so it is off until you restart it.`);
    else this.set('off', null);
  }

  private stopping = false;

  private armIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.stop(), this.deps.idleMs ?? 10 * 60_000);
    this.idle.unref?.();
  }

  /** Ends the process (idle, a model removed, sign-out); the next request starts it again. */
  async stop(): Promise<void> {
    if (this.idle) clearTimeout(this.idle);
    if (!this.link) return;
    this.stopping = true;
    this.link.kill();
  }

  /** Clears an error state (Settings → Local AI → Restart). */
  async reset(): Promise<void> {
    this.crashes.reset();
    await this.stop();
    this.set('off', null);
  }

  private async ensureLoaded(): Promise<void> {
    const id = this.deps.models.defaultModel();
    const path = id ? await this.deps.models.path(id) : null;
    if (!id || !path) throw new Error('No model is installed on this computer. Choose one in Settings → Local AI.');
    await this.start();
    if (this.loadedPath === path) return;
    this.set('loading');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The model took too long to load.')), 5 * 60_000);
      this.loadWaiter = { resolve, reject, timer };
      this.link!.post({ type: 'load', path });
    });
    this.loadedPath = path;
    this.loadedId = id;
    this.set('ready');
  }

  /** Asks the default model; the answer comes to `sender` as events. */
  async ask(sender: number, req: LocalAIRequest): Promise<void> {
    if (this.idle) clearTimeout(this.idle);
    try {
      await this.ensureLoaded();
    } catch (e) {
      if (this.state !== 'error') this.set(this.link ? 'ready' : 'off');
      throw e;
    }
    this.pending.set(req.id, sender);
    this.set('busy');
    this.link!.post({ type: 'generate', req });
  }

  cancel(id: string): void {
    if (this.pending.has(id)) this.link?.post({ type: 'cancel', id });
  }

  /** A window that goes away cancels what it asked. */
  senderGone(sender: number): void {
    for (const [id, s] of this.pending) if (s === sender) this.cancel(id);
  }
}

/** The worker link, and nothing else, held while the process runs. */
class LocalAIRuntimeLink {
  constructor(private readonly l: WorkerLink) {}
  post(m: ToWorker): void {
    this.l.post(m);
  }
  kill(): void {
    this.l.kill();
  }
}
