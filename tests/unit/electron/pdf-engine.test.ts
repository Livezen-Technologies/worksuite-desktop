import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PdfSearchHit, PdfSearchOptions } from '../../../shared/pdf';
import { loadPdfium, PdfiumProvider, pdfDate, structureTokens } from '../../../electron/services/pdf/pdfium-provider';
import { SealedReader } from '../../../electron/services/pdf/file-reader';
import { isEngineError } from '../../../electron/services/pdf/engine';
import { makePdf } from './pdf-fixture';

/**
 * The real engine: PDFium compiled to WebAssembly, on PDFs written for each
 * test. These run the same code the pdf-worker runs, minus the process.
 */
const require = createRequire(import.meta.url);
let pdfium: Awaited<ReturnType<typeof loadPdfium>>;
let dir: string;

beforeAll(async () => {
  pdfium = await loadPdfium(readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')));
  dir = mkdtempSync(join(tmpdir(), 'ws-pdf-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function file(bytes: Buffer): { kind: 'plain'; path: string; size: number } {
  const path = join(dir, `f${++n}.pdf`);
  writeFileSync(path, bytes);
  return { kind: 'plain', path, size: bytes.length };
}

async function opened(bytes: Buffer, password: string | null = null) {
  const e = new PdfiumProvider(pdfium);
  const r = await e.open(file(bytes), password);
  return { e, r };
}

const SEARCH: PdfSearchOptions = { matchCase: false, wholeWord: false, regex: false, comments: false, bookmarks: false };

async function search(e: PdfiumProvider, q: string, o: Partial<PdfSearchOptions> = {}) {
  const hits: PdfSearchHit[] = [];
  let pages = 0;
  await e.search(q, { ...SEARCH, ...o }, (p) => {
    hits.push(...p.hits);
    pages = p.pagesDone;
  }, { cancelled: false });
  return { hits, pages };
}

/** Encrypts a PDF with PDFium itself (AES-256), the way a protected file arrives. */
function encrypt(bytes: Buffer, user: string, owner: string, permissions: number): Buffer {
  const P = pdfium.pdfium as unknown as { HEAPU8: Uint8Array; wasmExports: { malloc(n: number): number; free(p: number): void } };
  const mem = P.wasmExports.malloc(bytes.length);
  P.HEAPU8.set(bytes, mem);
  const doc = pdfium.FPDF_LoadMemDocument(mem, bytes.length, '');
  expect(pdfium.EPDF_SetEncryption(doc, user, owner, permissions)).toBe(true);
  const w = pdfium.PDFiumExt_OpenFileWriter();
  pdfium.PDFiumExt_SaveAsCopy(doc, w);
  const size = pdfium.PDFiumExt_GetFileWriterSize(w);
  const out = P.wasmExports.malloc(size);
  pdfium.PDFiumExt_GetFileWriterData(w, out, size);
  const result = Buffer.from(P.HEAPU8.slice(out, out + size));
  pdfium.PDFiumExt_CloseFileWriter(w);
  pdfium.FPDF_CloseDocument(doc);
  P.wasmExports.free(out);
  P.wasmExports.free(mem);
  return result;
}

describe('PDFium provider: opening and reading', () => {
  it('opens a document, its pages (rotation applied), its facts and its own permissions', async () => {
    const { e, r } = await opened(makePdf({ pages: 3, rotate: true, info: { title: 'Contract (final)', author: 'Hasarinda' } }));
    expect(r.pageCount).toBe(3);
    expect(r.pages[0]).toEqual([612, 792]);
    expect(r.pages[1]).toEqual([792, 612]);
    expect(r.info.title).toBe('Contract (final)');
    expect(r.info.author).toBe('Hasarinda');
    expect(r.info.version).toBe('1.7');
    expect(r.info.created).toBe('2026-09-29T12:12:00.000Z');
    expect(r.permissions).toMatchObject({ print: true, copy: true, modify: true });
    expect(r.security).toMatchObject({ encrypted: false, encryption: 'none', javascript: 0, embeddedFiles: 0, xfa: false });
    expect(e.capabilities()).toMatchObject({ render: true, search: true, javascript: false, layers: false, editText: false, aes256: true });
    await e.close();
  });

  it('refuses what is not a PDF, and a file it cannot read, by kind', async () => {
    await expect(opened(Buffer.from('this is not a pdf at all'))).rejects.toMatchObject({ code: 'format' });
    const e = new PdfiumProvider(pdfium);
    await expect(e.open({ kind: 'plain', path: join(dir, 'missing.pdf'), size: 10 }, null)).rejects.toMatchObject({ code: 'file' });
  });

  it('draws a page, and a tile of it, as pixels (text is dark on white)', async () => {
    const { e } = await opened(makePdf({ pages: 1 }));
    const full = await e.render({ page: 0, scale: 0.5, annotations: true, order: 'rgba' });
    expect([full.width, full.height]).toEqual([306, 396]);
    expect(full.data.length).toBe(306 * 396 * 4);
    const dark = (d: Uint8Array) => {
      let c = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 100) c++;
      return c;
    };
    expect(dark(full.data)).toBeGreaterThan(50);
    // The top-left corner is paper; the text sits 92 points down, 72 in.
    expect([...full.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    const tile = await e.render({ page: 0, scale: 2, tile: { x: 100, y: 150, w: 256, h: 256 }, annotations: true, order: 'rgba' });
    expect([tile.width, tile.height]).toEqual([256, 256]);
    expect(dark(tile.data)).toBeGreaterThan(50);
    // Past the page's edge a tile is trimmed to the page.
    const edge = await e.render({ page: 0, scale: 1, tile: { x: 600, y: 780, w: 256, h: 256 }, annotations: true, order: 'rgba' });
    expect([edge.width, edge.height]).toEqual([12, 12]);
    await expect(e.render({ page: 5, scale: 1, annotations: true, order: 'rgba' })).rejects.toMatchObject({ code: 'page' });
    await expect(e.render({ page: 0, scale: 40, annotations: true, order: 'rgba' })).rejects.toMatchObject({ code: 'unsupported' });
    await e.close();
  });
});

describe('PDFium provider: search (PDF-SRCH-001…004)', () => {
  it('finds text on every page with a snippet and its place, streaming as it goes', async () => {
    const { e } = await opened(makePdf({ pages: 4 }));
    const { hits, pages } = await search(e, 'needle');
    expect(pages).toBe(4);
    expect(hits.map((h) => h.page)).toEqual([0, 1, 2, 3]);
    expect(hits[1]).toMatchObject({ source: 'text', match: 'Needle' });
    expect(hits[1]!.before).toContain('fixture.');
    expect(hits[1]!.after).toContain('here on page 2');
    const [x, y, w, h] = hits[0]!.rects[0]!;
    expect(y).toBeGreaterThan(60);
    expect(y).toBeLessThan(100);
    expect(x).toBeGreaterThan(150);
    expect(w).toBeGreaterThan(20);
    expect(h).toBeGreaterThan(5);
    await e.close();
  });

  it('matches case, whole words and a regular expression when asked', async () => {
    const { e } = await opened(makePdf({ pages: 2, text: 'Page {n}: needle, needles and NEEDLE.' }));
    expect((await search(e, 'needle')).hits).toHaveLength(6);
    expect((await search(e, 'needle', { matchCase: true })).hits).toHaveLength(4);
    expect((await search(e, 'needle', { wholeWord: true })).hits).toHaveLength(4);
    const re = await search(e, 'need(le)s?\\b', { regex: true, matchCase: true });
    expect(re.hits.map((h) => h.match)).toEqual(['needle', 'needles', 'needle', 'needles']);
    await expect(e.search('(', { ...SEARCH, regex: true }, () => undefined, { cancelled: false })).rejects.toMatchObject({ code: 'unsupported' });
    await e.close();
  });

  it('searches comments and bookmarks too when asked (PDF-SRCH-002)', async () => {
    const { e } = await opened(makePdf({ pages: 3, outline: true, comment: 'Check the penalty clause' }));
    expect((await search(e, 'penalty')).hits).toHaveLength(0);
    const c = await search(e, 'penalty', { comments: true });
    expect(c.hits).toEqual([expect.objectContaining({ source: 'comment', page: 0, match: 'penalty' })]);
    const b = await search(e, 'chapter', { bookmarks: true });
    expect(b.hits.map((h) => [h.source, h.page])).toEqual([
      ['bookmark', 0],
      ['bookmark', 2],
    ]);
    await e.close();
  });

  it('stops when cancelled', async () => {
    const { e } = await opened(makePdf({ pages: 50 }));
    const token = { cancelled: false };
    let calls = 0;
    const p = e.search('needle', SEARCH, () => {
      calls++;
      token.cancelled = true;
    }, token);
    await p;
    expect(calls).toBeLessThanOrEqual(2);
    await e.close();
  });
});

describe('PDFium provider: outline, links, attachments', () => {
  it('reads the outline as a tree with target pages', async () => {
    const { e } = await opened(makePdf({ pages: 3, outline: true }));
    expect(await e.outline()).toEqual([
      { title: 'Chapter One', page: 0, children: [{ title: 'Section 1.1', page: 1, children: [] }] },
      { title: 'Chapter Two', page: 2, children: [] },
    ]);
    await e.close();
  });

  it('lists links with what they do: a page, a web address, a launch (never followed here)', async () => {
    const { e } = await opened(makePdf({ pages: 2, uri: 'https://example.com/terms', launch: true, internalLink: true }));
    const links = await e.links(0);
    expect(links.map((l) => l.kind).sort()).toEqual(['launch', 'page', 'uri']);
    expect(links.find((l) => l.kind === 'uri')?.uri).toBe('https://example.com/terms');
    expect(links.find((l) => l.kind === 'page')?.page).toBe(1);
    const uri = links.find((l) => l.kind === 'uri')!;
    // [72 600 300 620] in page space: 72 in, 172 down from the top, 228 × 20.
    expect(uri.rect).toEqual([72, 172, 228, 20]);
    expect(await e.links(1)).toEqual([]);
    await e.close();
  });

  it('lists embedded files and marks the ones that would run as programs', async () => {
    const { e, r } = await opened(makePdf({ attachment: { name: 'invoice-viewer.exe', body: 'MZ not really' } }));
    expect(await e.attachments()).toEqual([{ index: 0, name: 'invoice-viewer.exe', size: 13, dangerous: true }]);
    expect(r.security).toMatchObject({ embeddedFiles: 1, dangerousFiles: 1 });
    await e.close();
  });
});

describe('PDFium provider: active content is found and never run (§12.5)', () => {
  it('counts document scripts, launch actions and web links, page by page and in the structure', async () => {
    const { e, r } = await opened(makePdf({ pages: 2, javascript: true, launch: true, uri: 'https://example.com' }));
    expect(r.security.javascript).toBe(1);
    const seen: number[] = [];
    const s = await e.scan((p) => seen.push(p.pagesScanned), { cancelled: false });
    expect(s).toMatchObject({ launchActions: 1, externalLinks: 1, pagesScanned: 2, structureScanned: true });
    expect(s.javascript).toBeGreaterThanOrEqual(1);
    expect(seen.at(-1)).toBe(2);
    await e.close();
  });

  it('finds a script key hidden behind a #xx escape in the raw structure', async () => {
    const { e, r } = await opened(makePdf({ pages: 1, hiddenJavascript: true }));
    expect(r.security.javascript).toBe(0);
    const s = await e.scan(() => undefined, { cancelled: false });
    expect(s.javascript).toBe(1);
    expect(structureTokens('/J#53 (x) /Launch /GoToR /JavaScript', Infinity)).toEqual({ js: 1, launch: 1, other: 1 });
    await e.close();
  });
});

describe('PDFium provider: passwords (PDF-OPEN-008)', () => {
  it('asks for the password, refuses a wrong one, opens with the right one and reports AES-256 and the PDF’s own restrictions', async () => {
    // Printing and copying not allowed by the PDF's own flags.
    const protectedPdf = encrypt(makePdf({ pages: 2 }), 'open sesame', 'owner-secret', 0xfffff0c0);
    await expect(opened(protectedPdf)).rejects.toMatchObject({ code: 'password' });
    await expect(opened(protectedPdf, 'wrong')).rejects.toSatisfy((e: unknown) => isEngineError(e) && e.code === 'password' && !e.message.includes('wrong'));
    const { e, r } = await opened(protectedPdf, 'open sesame');
    expect(r.pageCount).toBe(2);
    expect(r.security).toMatchObject({ encrypted: true, encryption: 'aes-256' });
    expect(r.permissions).toMatchObject({ print: false, copy: false });
    await e.close();
  });
});

describe('sealed working copies (PDF-NFR-020)', () => {
  it('reads a sealed copy written by the eLearning sealer, and refuses a tampered chunk', async () => {
    const { SealWriter } = await import('../../../electron/services/elearning-offline');
    const bytes = makePdf({ pages: 5 });
    const key = Buffer.alloc(32, 3);
    const path = join(dir, 'sealed.wsl');
    const w = await SealWriter.create(path, key);
    await w.write(bytes);
    await w.close(true);
    expect(readFileSync(path).includes(Buffer.from('Needle'))).toBe(false);
    const r = new SealedReader(path, key, bytes.length);
    const into = new Uint8Array(40);
    expect(r.read(100, into)).toBe(true);
    expect(Buffer.from(into).equals(bytes.subarray(100, 140))).toBe(true);
    expect(r.read(bytes.length - 10, new Uint8Array(20))).toBe(false);
    r.close();
    const e = new PdfiumProvider(pdfium);
    const o = await e.open({ kind: 'sealed', path, size: bytes.length, key: key.toString('base64') }, null);
    expect(o.pageCount).toBe(5);
    expect((await search(e, 'needle')).hits).toHaveLength(5);
    await e.close();
    const raw = readFileSync(path);
    raw[40] = raw[40]! ^ 0xff;
    writeFileSync(path, raw);
    const bad = new PdfiumProvider(pdfium);
    await expect(bad.open({ kind: 'sealed', path, size: bytes.length, key: key.toString('base64') }, null)).rejects.toMatchObject({ code: expect.stringMatching(/format|file/) });
  });
});

describe('large documents (AC-03, PDF-NFR-002)', () => {
  it('opens a 2,000-page PDF without drawing it, then draws and searches one page far in', async () => {
    const bytes = makePdf({ pages: 2000 });
    const t0 = performance.now();
    const { e, r } = await opened(bytes);
    const openMs = performance.now() - t0;
    expect(r.pageCount).toBe(2000);
    expect(r.pages).toHaveLength(2000);
    const t1 = performance.now();
    const px = await e.render({ page: 1499, scale: 1, annotations: true, order: 'rgba' });
    const renderMs = performance.now() - t1;
    expect(px.width).toBe(612);
    // Generous ceilings for a shared CI machine; the SRS targets are ≤ 3 s to the first page and ≤ 250 ms a page.
    expect(openMs).toBeLessThan(3000);
    expect(renderMs).toBeLessThan(1000);
    expect(e.memoryBytes()).toBeLessThan(256 * 1024 * 1024);
    await e.close();
  });
});

describe('dates', () => {
  it('reads PDF dates with their zone', () => {
    expect(pdfDate("D:20260929174200+05'30'")).toBe('2026-09-29T12:12:00.000Z');
    expect(pdfDate('D:2026')).toBe('2026-01-01T00:00:00.000Z');
    expect(pdfDate('yesterday')).toBe('');
  });
});
