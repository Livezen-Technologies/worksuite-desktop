import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { OCR_LANGUAGE_FILES, OCR_LANGUAGES, type OcrLanguage, type OcrLanguageFile, type OcrLine, type OcrProgress, type OcrRequest, type OcrResult, type OcrStatus } from '@shared/ocr';

/**
 * Reading text in images on this computer (worksuite-desktop#59): Tesseract's LSTM engine as tesseract.js runs it in
 * Node — WebAssembly in a worker thread, so the main process is not held up while it reads.
 *
 *  · LANGUAGES. English, Sinhala and Tamil, each a file downloaded the first time it is needed, checked against the
 *    size and SHA-256 this build names (`OCR_LANGUAGE_FILES`), and only then put in place. A mixed-language image is
 *    read with all three at once, as Tesseract supports.
 *  · ONE AT A TIME. Jobs queue; the reader stays loaded for a couple of minutes for the next one, then goes away to give
 *    the memory back.
 *  · CANCEL. Tesseract cannot stop part-way through a page, so cancelling ends its worker; the next job starts another.
 *  · WHAT IT RETURNS is every word with Tesseract's own confidence, in reading order, lines and paragraphs kept. Deciding
 *    what counts as uncertain or unreadable is the window's (`src/modules/ai/vision.ts`), so it is said the same way
 *    everywhere it is shown.
 */

/** The part of a tesseract.js worker this uses. */
export interface TessWorker {
  recognize(image: Buffer, options: Record<string, unknown>, output: Record<string, boolean>): Promise<{ data: TessPage }>;
  terminate(): Promise<unknown>;
}

interface TessWord {
  text: string;
  confidence: number;
}
interface TessPage {
  confidence?: number;
  text?: string;
  blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: TessWord[] }> }> }> | null;
}

export interface OcrDeps {
  /** Where the language files are kept. */
  dir: string;
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  /** tesseract.js's `createWorker` for these languages, reading their files from `langPath`. */
  createWorker?: (languages: OcrLanguage[], langPath: string, onProgress: (p: number) => void) => Promise<TessWorker>;
  /** To the window that asked. */
  progress: (sender: number, p: OcrProgress) => void;
  idleMs?: number;
  /** The language files to fetch (tests name their own). */
  files?: Record<OcrLanguage, OcrLanguageFile>;
}

class Cancelled extends Error {}

/** The worker script, read from outside the asar archive in a packaged app (worker threads cannot start inside it). */
function workerPath(): string {
  const root = dirname(require.resolve('tesseract.js/package.json'));
  return join(root, 'src', 'worker-script', 'node', 'index.js').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
}

async function tesseractWorker(languages: OcrLanguage[], langPath: string, onProgress: (p: number) => void): Promise<TessWorker> {
  const T = await import('tesseract.js');
  return (await T.createWorker(languages, T.OEM.LSTM_ONLY, {
    langPath,
    // The files were checked here; tesseract.js only reads them.
    cacheMethod: 'none',
    gzip: true,
    workerPath: workerPath(),
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') onProgress(m.progress);
    },
  })) as unknown as TessWorker;
}

export class OcrService {
  private worker: { key: string; w: TessWorker } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private current: { id: string; abort: AbortController } | null = null;
  private cancelled = new Set<string>();
  private idle: NodeJS.Timeout | null = null;
  /** Progress of the job running now, for the worker's logger (which belongs to the worker, not the job). */
  private report: (p: number) => void = () => undefined;

  private readonly files: Record<OcrLanguage, OcrLanguageFile>;

  constructor(private readonly deps: OcrDeps) {
    this.files = deps.files ?? OCR_LANGUAGE_FILES;
  }

  private file(lang: OcrLanguage): string {
    return join(this.deps.dir, `${lang}.traineddata.gz`);
  }

  private async installed(lang: OcrLanguage): Promise<boolean> {
    return (await stat(this.file(lang)).catch(() => null))?.size === this.files[lang].bytes;
  }

  async status(): Promise<OcrStatus> {
    const languages = [];
    for (const id of OCR_LANGUAGES) {
      const f = this.files[id];
      languages.push({ id, label: f.label, bytes: f.bytes, installed: await this.installed(id) });
    }
    return { languages };
  }

  /** Downloads a language's file, checks it, and puts it in place; nothing unchecked is ever read. */
  private async download(lang: OcrLanguage, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
    const f = this.files[lang];
    await mkdir(this.deps.dir, { recursive: true, mode: 0o700 });
    let res: Response;
    try {
      res = await this.deps.fetch(f.url, { signal });
    } catch (e) {
      if (signal.aborted) throw new Cancelled();
      throw new Error(`The ${f.label} text-reading data could not be downloaded. Check you are online, then try again. (${e instanceof Error ? e.message : String(e)})`);
    }
    if (!res.ok || !res.body) throw new Error(`The ${f.label} text-reading data could not be downloaded (${res.status}). Try again later.`);
    const chunks: Uint8Array[] = [];
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read().catch((e: unknown) => {
        if (signal.aborted) throw new Cancelled();
        throw e;
      });
      if (done) break;
      got += value.byteLength;
      if (got > f.bytes) throw new Error(`The ${f.label} text-reading data is larger than expected, so it was not used.`);
      chunks.push(value);
      onBytes(value.byteLength);
    }
    const data = Buffer.concat(chunks);
    if (data.byteLength !== f.bytes || createHash('sha256').update(data).digest('hex') !== f.sha256) {
      throw new Error(`The ${f.label} text-reading data did not match what WorkSuite expects, so it was not used. Try again.`);
    }
    const part = `${this.file(lang)}.part`;
    await writeFile(part, data, { mode: 0o600 });
    await rename(part, this.file(lang));
  }

  /** Reads the text in a picture (a PNG the window drew). One job at a time. */
  recognize(sender: number, req: OcrRequest): Promise<OcrResult> {
    const run = this.queue.then(() => this.run(sender, req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(sender: number, req: OcrRequest): Promise<OcrResult> {
    const started = Date.now();
    const languages = [...new Set(req.languages ?? OCR_LANGUAGES)].sort((a, b) => OCR_LANGUAGES.indexOf(a) - OCR_LANGUAGES.indexOf(b));
    const stopped = (): OcrResult => ({ lines: [], confidence: 0, languages, ms: Date.now() - started, cancelled: true });
    if (this.cancelled.delete(req.id)) return stopped();
    if (this.idle) clearTimeout(this.idle);
    const abort = new AbortController();
    this.current = { id: req.id, abort };
    const say = (stage: OcrProgress['stage'], progress: number | null) => this.deps.progress(sender, { id: req.id, stage, progress });
    try {
      const missing: OcrLanguage[] = [];
      for (const l of languages) if (!(await this.installed(l))) missing.push(l);
      if (missing.length) {
        const total = missing.reduce((n, l) => n + this.files[l].bytes, 0);
        let got = 0;
        say('downloading', 0);
        for (const l of missing) {
          await this.download(l, abort.signal, (n) => {
            got += n;
            say('downloading', Math.min(1, got / total));
          });
        }
      }
      if (abort.signal.aborted) return stopped();
      const key = languages.join('+');
      if (this.worker?.key !== key) {
        await this.end();
        say('loading', null);
        const make = this.deps.createWorker ?? tesseractWorker;
        this.worker = { key, w: await make(languages, this.deps.dir, (p) => this.report(p)) };
      }
      if (abort.signal.aborted) return stopped();
      say('recognizing', 0);
      this.report = (p) => say('recognizing', p);
      const worker = this.worker!.w;
      const out = await Promise.race([
        worker.recognize(Buffer.from(req.png), {}, { text: true, blocks: true }),
        new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Cancelled()), { once: true })),
      ]);
      return { lines: linesOf(out.data), confidence: Math.round(out.data.confidence ?? 0), languages, ms: Date.now() - started, cancelled: false };
    } catch (e) {
      if (e instanceof Cancelled || abort.signal.aborted) return stopped();
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      this.report = () => undefined;
      this.current = null;
      this.armIdle();
    }
  }

  /** Stops a job: one waiting is skipped; the one reading ends its worker, so it stops at once. */
  cancel(id: string): void {
    if (this.current?.id === id) {
      this.current.abort.abort();
      void this.end();
    } else {
      this.cancelled.add(id);
      // Forgotten after a while if it never ran (it may already have finished).
      setTimeout(() => this.cancelled.delete(id), 60_000).unref?.();
    }
  }

  private armIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.end(), this.deps.idleMs ?? 2 * 60_000);
    this.idle.unref?.();
  }

  private async end(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await w.w.terminate().catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.idle) clearTimeout(this.idle);
    this.current?.abort.abort();
    await this.end();
  }
}

/** Tesseract's page as lines of words in reading order, with an empty line between paragraphs. */
export function linesOf(page: TessPage): OcrLine[] {
  const out: OcrLine[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      if (out.length && out[out.length - 1]!.words.length) out.push({ words: [] });
      for (const line of para.lines ?? []) {
        const words = (line.words ?? []).filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), confidence: Math.round(w.confidence) }));
        if (words.length) out.push({ words });
      }
    }
  }
  // Text without the layout (an engine that did not give blocks): its lines, every word at the page's confidence.
  if (!out.length && page.text?.trim()) {
    for (const l of page.text.split('\n')) out.push({ words: l.split(/\s+/).filter(Boolean).map((text) => ({ text, confidence: Math.round(page.confidence ?? 0) })) });
  }
  while (out.length && !out[out.length - 1]!.words.length) out.pop();
  return out;
}
