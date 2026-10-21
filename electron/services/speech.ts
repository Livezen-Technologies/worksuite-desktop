import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { BrowserWindow, app, dialog } from 'electron';
import { logger } from '../main/log';
import { DesktopError } from '../main/errors';
import { APP_ORIGIN, devOrigin } from '../security/hardening';
import type { SpeechCatalog } from '@shared/types';

const log = logger('speech');

/** What one piece of audio said, when, and how sure the engine was. */
export interface SpeechSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  uncertain: boolean;
}

/** One speech model as the server lists it (G-11): pinned by size and SHA-256. */
interface ServerSpeechModel {
  id: string;
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  recommendedFor?: string[];
  languages?: string[];
}

const MAX_SPEECH_BYTES = 4 * 1024 * 1024 * 1024;

export interface SpeechStatus {
  local: { ready: boolean; model: { name: string; size: number } | null; why: string | null };
}

/** ggml model files start with this, little-endian: what whisper.cpp reads. */
const GGML = 0x67676d6c;
const LOAD_TIMEOUT = 180_000;
const JOB_TIMEOUT = 240_000;

/** Whether the start of a file is a whisper.cpp model. */
export function isGgml(head: Buffer): boolean {
  return head.length >= 4 && head.readUInt32LE(0) === GGML;
}

/**
 * Speech to text on this computer (worksuite-desktop#81): whisper.cpp in a hidden page of its own.
 *
 * The person adds a speech model once (Settings › Local AI › Speech): a whisper.cpp model file, kept in WorkSuite's
 * own folder. The first time something is to be transcribed, a hidden page loads it and stays, so later pieces go
 * straight through; it goes away when the model is changed or WorkSuite quits. Pieces are transcribed one at a time,
 * so a long recording cannot crowd out a live meeting.
 */
export class SpeechService {
  private win: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private loaded: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private jobs = new Map<string, { resolve: (s: SpeechSegment[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private queue: Promise<unknown> = Promise.resolve();

  private listed: ServerSpeechModel[] = [];
  private installing: Promise<SpeechStatus> | null = null;

  constructor(
    private readonly deps: {
      dir: string;
      preload: string;
      /** The signed-in WorkSuite server (G-11): `ai/speech/status` and its speech catalogue. */
      get?: <T>(path: string) => Promise<T>;
      fetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
    },
  ) {}

  /**
   * The speech models the WorkSuite server offers (G-11, Q-05) and whether the company wants transcripts made on
   * this computer. Local speech stays off until the person downloads a model; nothing is fetched on its own.
   */
  async catalog(): Promise<SpeechCatalog> {
    const off: SpeechCatalog = { preferred: false, required: false, models: [], error: null };
    if (!this.deps.get) return { ...off, error: 'Sign in to WorkSuite to see its speech models.' };
    let path = '/api/ai/local/speech-catalog';
    try {
      const st = await this.deps.get<{ local?: { preferred?: unknown; required?: unknown; catalog?: unknown } }>('/api/ai/speech/status');
      off.preferred = st?.local?.preferred === true;
      off.required = st?.local?.required === true;
      if (typeof st?.local?.catalog === 'string' && /^\/api\/ai\/[a-z/-]+$/.test(st.local.catalog)) path = st.local.catalog;
    } catch {
      /* an older server: no company setting, the catalogue may still answer */
    }
    let body: { models?: unknown };
    try {
      body = await this.deps.get<{ models?: unknown }>(path);
    } catch (e) {
      const status = (e as { status?: unknown })?.status;
      return { ...off, error: status === 404 ? (e instanceof Error && /switched off/i.test(e.message) ? e.message : 'Your WorkSuite server does not offer speech models yet. You can still add a whisper.cpp model file.') : e instanceof Error ? e.message : String(e) };
    }
    this.listed = (Array.isArray(body?.models) ? body.models : []).filter(validSpeechModel);
    const installedId = await this.installedId();
    return {
      ...off,
      models: this.listed.map((m) => ({ id: m.id, name: m.name, bytes: m.bytes, recommendedFor: m.recommendedFor ?? [], languages: m.languages ?? [], installed: m.id === installedId })),
    };
  }

  private async installedId(): Promise<string | null> {
    try {
      const meta = JSON.parse(await readFile(this.metaFile, 'utf8')) as { id?: unknown };
      return typeof meta.id === 'string' ? meta.id : null;
    } catch {
      return null;
    }
  }

  /** Download one of the server's speech models, check its size and SHA-256, and only then keep it. */
  install(id: string): Promise<SpeechStatus> {
    this.installing ??= this.download(id).finally(() => {
      this.installing = null;
    });
    return this.installing;
  }

  private async download(id: string): Promise<SpeechStatus> {
    const m = this.listed.find((x) => x.id === id);
    if (!m) throw new DesktopError('IPC_VALIDATION_FAILED', 'That speech model is not in your WorkSuite server’s list. Check for models again.');
    const fetchImpl = this.deps.fetch ?? fetch;
    await mkdir(this.deps.dir, { recursive: true });
    const part = join(this.deps.dir, 'download.part');
    const res = await fetchImpl(m.url);
    if (!res.ok || !res.body) throw new DesktopError('SERVER_ERROR', `The speech model could not be downloaded (${res.status}).`);
    const hash = createHash('sha256');
    const fh = await open(part, 'w', 0o600);
    let received = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > m.bytes) throw new DesktopError('SERVER_ERROR', 'The speech model is larger than WorkSuite said. It was not kept.');
        hash.update(value);
        await fh.write(value);
      }
    } catch (e) {
      await fh.close().catch(() => undefined);
      await rm(part, { force: true });
      throw e;
    }
    await fh.close();
    const head = Buffer.alloc(4);
    const check = await open(part, 'r');
    try {
      await check.read(head, 0, 4, 0);
    } finally {
      await check.close();
    }
    if (received !== m.bytes || hash.digest('hex') !== m.sha256.toLowerCase() || !isGgml(head)) {
      await rm(part, { force: true });
      throw new DesktopError('SERVER_ERROR', 'The downloaded speech model did not match its SHA-256. It was not kept — try again.');
    }
    this.stop();
    await rename(part, this.modelFile);
    await writeFile(this.metaFile, JSON.stringify({ name: m.name, id: m.id, sha256: m.sha256, addedAt: new Date().toISOString() }));
    log.info('speech model downloaded', { id: m.id });
    return this.status();
  }

  private get modelFile(): string {
    return join(this.deps.dir, 'model.bin');
  }

  private get metaFile(): string {
    return join(this.deps.dir, 'model.json');
  }

  async status(): Promise<SpeechStatus> {
    try {
      const st = await stat(this.modelFile);
      const meta = JSON.parse(await readFile(this.metaFile, 'utf8').catch(() => '{}')) as { name?: string };
      return { local: { ready: true, model: { name: meta.name || 'Speech model', size: st.size }, why: null } };
    } catch {
      return { local: { ready: false, model: null, why: 'No speech model is on this computer. Add one in Settings › Local AI › Speech.' } };
    }
  }

  /** Choose a whisper.cpp model file (ggml): checked, then kept in WorkSuite's own folder. */
  async chooseModel(parent: BrowserWindow | null): Promise<SpeechStatus> {
    const opts: Electron.OpenDialogOptions = { title: 'Choose a speech model (whisper.cpp)', properties: ['openFile'], filters: [{ name: 'whisper.cpp models', extensions: ['bin'] }] };
    const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    const src = res.filePaths[0];
    if (res.canceled || !src) return this.status();
    const fh = await open(src, 'r');
    const head = Buffer.alloc(4);
    try {
      await fh.read(head, 0, 4, 0);
    } finally {
      await fh.close();
    }
    if (!isGgml(head)) throw new DesktopError('IPC_VALIDATION_FAILED', 'That is not a whisper.cpp model file. Choose a ggml model, such as ggml-base-q5_1.bin.');
    this.stop();
    await mkdir(this.deps.dir, { recursive: true });
    await copyFile(src, this.modelFile);
    await writeFile(this.metaFile, JSON.stringify({ name: basename(src), addedAt: new Date().toISOString() }));
    log.info('speech model added', { name: basename(src) });
    return this.status();
  }

  async removeModel(): Promise<SpeechStatus> {
    this.stop();
    await rm(this.modelFile, { force: true });
    await rm(this.metaFile, { force: true });
    return this.status();
  }

  /** The model, for the speech page only (`app://bundle/__local/speech/model.bin`). */
  async serveModel(): Promise<Response> {
    try {
      const st = await stat(this.modelFile);
      const body = Readable.toWeb(createReadStream(this.modelFile)) as ReadableStream;
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(st.size), 'Cross-Origin-Resource-Policy': 'same-origin' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }

  /** Transcribe a piece of audio (16 kHz mono WAV). One at a time. */
  transcribe(wav: Uint8Array, language: string): Promise<SpeechSegment[]> {
    const run = this.queue.then(() => this.run(wav, language));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(wav: Uint8Array, language: string): Promise<SpeechSegment[]> {
    if (!(await this.status()).local.ready) throw new DesktopError('UNSUPPORTED', 'No speech model is on this computer.');
    await this.ensure();
    const id = randomUUID();
    return new Promise<SpeechSegment[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.jobs.delete(id);
        reject(new DesktopError('SERVER_ERROR', 'Transcribing took too long on this computer.'));
      }, JOB_TIMEOUT);
      this.jobs.set(id, { resolve, reject, timer });
      this.win?.webContents.send('speech:job', { id, wav, language });
    });
  }

  /** The hidden page, loaded with the model, once. */
  private ensure(): Promise<void> {
    if (this.win && !this.win.isDestroyed() && this.loading) return this.loading;
    this.loading = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new DesktopError('SERVER_ERROR', 'The speech model did not load in time.')), LOAD_TIMEOUT);
      this.loaded = {
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
    });
    this.loading.catch(() => this.stop());
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      webPreferences: { preload: this.deps.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, devTools: !app.isPackaged },
    });
    this.win = win;
    win.on('closed', () => {
      if (this.win === win) this.win = null;
      this.loaded?.reject(new DesktopError('SERVER_ERROR', 'The speech page closed.'));
      for (const [, j] of this.jobs) j.reject(new DesktopError('SERVER_ERROR', 'The speech page closed.'));
      this.jobs.clear();
    });
    const dev = devOrigin();
    void win.loadURL(dev ? `${process.env.ELECTRON_RENDERER_URL}/speech.html` : `${APP_ORIGIN}/speech.html`);
    return this.loading;
  }

  /** The page says whether the model loaded. */
  onReady(senderId: number, input: { ok: boolean; error?: string }): void {
    if (!this.win || this.win.webContents.id !== senderId) return;
    if (input.ok) this.loaded?.resolve();
    else this.loaded?.reject(new DesktopError('SERVER_ERROR', `The speech model could not be loaded: ${input.error ?? 'unknown problem'}.`));
  }

  /** The page answers a piece. */
  onResult(senderId: number, input: { id: string; segments?: SpeechSegment[]; error?: string }): void {
    if (!this.win || this.win.webContents.id !== senderId) return;
    const job = this.jobs.get(input.id);
    if (!job) return;
    this.jobs.delete(input.id);
    clearTimeout(job.timer);
    if (input.error || !input.segments) job.reject(new DesktopError('SERVER_ERROR', input.error ?? 'Nothing came back.'));
    else job.resolve(input.segments);
  }

  stop(): void {
    const win = this.win;
    this.win = null;
    this.loading = null;
    this.loaded = null;
    if (win && !win.isDestroyed()) win.destroy();
  }
}

function validSpeechModel(x: unknown): x is ServerSpeechModel {
  const m = x as Partial<ServerSpeechModel> | null;
  return (
    !!m &&
    typeof m.id === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(m.id) &&
    typeof m.name === 'string' &&
    typeof m.url === 'string' && /^https:\/\//.test(m.url) &&
    typeof m.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(m.sha256) &&
    typeof m.bytes === 'number' && m.bytes > 0 && m.bytes <= MAX_SPEECH_BYTES
  );
}
