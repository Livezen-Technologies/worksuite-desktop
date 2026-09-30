import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PdfSearchHit } from '../../../shared/pdf';
import type { EngineError } from '../../../electron/services/pdf/engine';
import { loadPdfium, PdfiumProvider } from '../../../electron/services/pdf/pdfium-provider';
import { WorkerEngine, type WorkerChannel } from '../../../electron/services/pdf/worker-engine';
import { workerHandler, type WorkerEngineLike, type WorkerMessage, type WorkerRequest } from '../../../electron/services/pdf/worker-protocol';
import { makePdf } from './pdf-fixture';

/**
 * The worker protocol end to end — the main process's WorkerEngine talking to
 * the worker's handler over a channel that copies every message as the real
 * one does — with the real PDFium engine, and with engines that crash, hang
 * or run out of memory.
 */
const require = createRequire(import.meta.url);
let pdfium: Awaited<ReturnType<typeof loadPdfium>>;
let dir: string;
let file: { kind: 'plain'; path: string; size: number };

beforeAll(async () => {
  pdfium = await loadPdfium(readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')));
  dir = mkdtempSync(join(tmpdir(), 'ws-pdfw-'));
  const bytes = makePdf({ pages: 40, javascript: true });
  const path = join(dir, 'doc.pdf');
  writeFileSync(path, bytes);
  file = { kind: 'plain', path, size: bytes.length };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function inProcess(engine: Promise<WorkerEngineLike>, opts: { dropPings?: boolean } = {}) {
  let onMsg: ((m: WorkerMessage) => void) | null = null;
  let onExit: ((c: number | null) => void) | null = null;
  let dead = false;
  const handle = workerHandler(engine, (m) => setTimeout(() => !dead && onMsg?.(structuredClone(m)), 0));
  const ch: WorkerChannel = {
    post: (m: WorkerRequest) => {
      if ('type' in m && opts.dropPings) return;
      setTimeout(() => !dead && handle(structuredClone(m)), 0);
    },
    onMessage: (cb) => (onMsg = cb),
    onExit: (cb) => (onExit = cb),
    kill: () => {
      if (dead) return;
      dead = true;
      setTimeout(() => onExit?.(null), 0);
    },
  };
  return {
    ch,
    crash: () => {
      dead = true;
      onExit?.(134);
    },
    killed: () => dead,
  };
}

const fast = { timeoutMs: 5_000, openTimeoutMs: 5_000, pingMs: 20, hungMs: 200 };

describe('WorkerEngine ⇄ pdf-worker, with PDFium', () => {
  it('starts, reports the engine’s capabilities, opens, draws and searches with progress', async () => {
    const { ch } = inProcess(Promise.resolve(new PdfiumProvider(pdfium)));
    const w = new WorkerEngine(ch, fast);
    expect((await w.started()).engine).toBe('PDFium (WebAssembly)');
    const o = await w.open(file, null);
    expect(o.pageCount).toBe(40);
    expect(o.security.javascript).toBe(1);
    const px = await w.render({ page: 39, scale: 0.25, annotations: true, order: 'rgba' });
    expect(px.data).toBeInstanceOf(Uint8Array);
    expect(px.data.length).toBe(px.width * px.height * 4);
    const hits: PdfSearchHit[] = [];
    let last = 0;
    await w.search('needle', { matchCase: false, wholeWord: false, regex: false, comments: false, bookmarks: false }, (p) => {
      hits.push(...p.hits);
      last = p.pagesDone;
    }, { cancelled: false });
    expect(hits).toHaveLength(40);
    expect(last).toBe(40);
    const scan = await w.scan(() => undefined, { cancelled: false });
    expect(scan.structureScanned).toBe(true);
    let gone: EngineError | null = null;
    w.onGone = (e) => (gone = e);
    await w.close();
    expect(w.alive).toBe(false);
    expect(gone).not.toBeNull();
  });

  it('cancels a search between pages', async () => {
    const { ch } = inProcess(Promise.resolve(new PdfiumProvider(pdfium)));
    // In one process the "worker" shares the test's thread, so it cannot answer pings while it opens 4,000 pages.
    const w = new WorkerEngine(ch, { ...fast, hungMs: 30_000 });
    const big = join(dir, 'big.pdf');
    const bytes = makePdf({ pages: 4000 });
    writeFileSync(big, bytes);
    await w.open({ kind: 'plain', path: big, size: bytes.length }, null);
    const token = { cancelled: false };
    let pages = 0;
    await w.search('needle', { matchCase: false, wholeWord: false, regex: false, comments: false, bookmarks: false }, (p) => {
      pages = p.pagesDone;
      token.cancelled = true;
    }, token);
    expect(pages).toBeGreaterThan(0);
    expect(pages).toBeLessThan(4000);
    await w.close();
  });
});

describe('WorkerEngine: a worker that fails never takes the app with it (PDF-NFR-010, PDF-ARCH-013)', () => {
  const never = (): WorkerEngineLike =>
    ({
      memoryBytes: () => 1,
      capabilities: () => new PdfiumProvider(pdfium).capabilities(),
      open: async () => ({}) as never,
      render: () => new Promise(() => undefined),
      search: async () => undefined,
      outline: async () => [],
      links: async () => [],
      attachments: async () => [],
      scan: async () => ({}) as never,
      close: async () => undefined,
    }) as unknown as WorkerEngineLike;

  it('fails what was waiting with "crashed" when the process exits, and says so once', async () => {
    const { ch, crash } = inProcess(Promise.resolve(never()));
    const w = new WorkerEngine(ch, fast);
    await w.started();
    const gone: string[] = [];
    w.onGone = (e) => gone.push(e.code);
    const r = w.render({ page: 0, scale: 1, annotations: true, order: 'rgba' });
    crash();
    await expect(r).rejects.toMatchObject({ code: 'crashed' });
    await expect(w.outline()).rejects.toMatchObject({ code: 'crashed' });
    expect(gone).toEqual(['crashed']);
  });

  it('ends a worker that stops answering, and one whose request runs past its deadline', async () => {
    const hung = inProcess(Promise.resolve(never()), { dropPings: true });
    const w = new WorkerEngine(hung.ch, { ...fast, hungMs: 80 });
    await w.started();
    const r = w.render({ page: 0, scale: 1, annotations: true, order: 'rgba' });
    await expect(r).rejects.toMatchObject({ code: 'timeout' });
    expect(hung.killed()).toBe(true);

    const slow = inProcess(Promise.resolve(never()));
    const w2 = new WorkerEngine(slow.ch, { ...fast, timeoutMs: 60 });
    await w2.started();
    await expect(w2.render({ page: 0, scale: 1, annotations: true, order: 'rgba' })).rejects.toMatchObject({ code: 'timeout' });
    expect(slow.killed()).toBe(true);
  });

  it('ends a worker past its memory ceiling (PDF-NFR-005)', async () => {
    const { ch, killed } = inProcess(Promise.resolve(new PdfiumProvider(pdfium, { memoryBytes: 1024 })));
    const w = new WorkerEngine(ch, fast);
    const gone: string[] = [];
    w.onGone = (e) => gone.push(e.code);
    await expect(w.open(file, null)).rejects.toMatchObject({ code: 'memory' });
    await new Promise((r) => setTimeout(r, 20));
    expect(gone).toEqual(['memory']);
    expect(killed()).toBe(true);
  });

  it('reports an engine that cannot start', async () => {
    const { ch } = inProcess(Promise.reject(new Error('no wasm')));
    const w = new WorkerEngine(ch, fast);
    await expect(w.open(file, null)).rejects.toMatchObject({ code: 'unknown' });
  });
});
