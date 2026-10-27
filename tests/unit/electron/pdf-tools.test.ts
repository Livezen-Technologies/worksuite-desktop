import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAPER, permissionBits, splitEvery, stampText, pdfEditOpSchema, summarize, type PdfStamp } from '../../../shared/pdf';
import { loadPdfium, PdfiumProvider } from '../../../electron/services/pdf/pdfium-provider';
import { isEngineError } from '../../../electron/services/pdf/engine';
import { makePdf } from './pdf-fixture';

/**
 * PDF Studio's tools on this computer (audit D-G12), on the real engine: duplicate pages, stamp words (header,
 * footer, watermark, Bates), redact, protect and unlock a copy, page text, and new PDFs combined, made from pictures
 * or of blank pages.
 */
const require = createRequire(import.meta.url);
let pdfium: Awaited<ReturnType<typeof loadPdfium>>;
let dir: string;
beforeAll(async () => {
  pdfium = await loadPdfium(readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')));
  dir = mkdtempSync(join(tmpdir(), 'ws-pdf-tools-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function file(bytes: Uint8Array) {
  const path = join(dir, `t${++n}.pdf`);
  writeFileSync(path, bytes);
  return { kind: 'plain' as const, path, size: bytes.length };
}
async function opened(bytes: Uint8Array, password: string | null = null) {
  const e = new PdfiumProvider(pdfium);
  const r = await e.open(file(bytes), password);
  return { e, r };
}
const all = (count: number) => Array.from({ length: count }, (_, i) => i);
const STAMP: PdfStamp = { text: 'Page {page} of {pages}', place: 'bottom-center', size: 10, color: [0, 0, 0], opacity: 1 };

describe('organise: duplicate pages', () => {
  it('copies pages, in order, to where they are asked', async () => {
    const { e } = await opened(makePdf({ pages: 3 }));
    const sizes = await e.apply({ op: 'page.duplicate', pages: [0, 2], at: 3 });
    expect(sizes).toHaveLength(5);
    const text = await e.pageText(all(5));
    expect(text[3]).toContain('Page 1 of the fixture');
    expect(text[4]).toContain('Page 3 of the fixture');
    await e.close();
  });
});

describe('stamps: header and footer, watermark, Bates', () => {
  it('writes the words of each page, filled in', async () => {
    const { e } = await opened(makePdf({ pages: 3 }));
    await e.apply({ op: 'page.stamp', pages: [0, 1, 2], stamp: STAMP });
    const text = await e.pageText(all(3));
    expect(text[0]).toContain('Page 1 of 3');
    expect(text[2]).toContain('Page 3 of 3');
    // The stamp is kept in the file.
    const again = await opened(await e.save());
    expect((await again.e.pageText([1]))[0]).toContain('Page 2 of 3');
    await e.close();
    await again.e.close();
  });

  it('numbers pages with Bates numbers across the pages stamped', async () => {
    const { e } = await opened(makePdf({ pages: 3 }));
    await e.apply({ op: 'page.stamp', pages: [1, 2], stamp: { ...STAMP, text: '{bates}', place: 'bottom-right', bates: { prefix: 'WS-', start: 41, digits: 5, suffix: '' } } });
    const text = await e.pageText(all(3));
    expect(text[0]).not.toContain('WS-');
    expect(text[1]).toContain('WS-00041');
    expect(text[2]).toContain('WS-00042');
    await e.close();
  });

  it('draws a diagonal watermark, and stamps a turned page upright', async () => {
    const { e } = await opened(makePdf({ pages: 2, rotate: true }));
    await e.apply({ op: 'page.stamp', pages: [0, 1], stamp: { ...STAMP, text: 'CONFIDENTIAL', place: 'center', size: 48, opacity: 0.25, diagonal: true, color: [180, 35, 24] } });
    const text = await e.pageText(all(2));
    expect(text[0]).toContain('CONFIDENTIAL');
    expect(text[1]).toContain('CONFIDENTIAL');
    await e.close();
  });

  it('fills a stamp the same way every time, so undo and recovery replay it', () => {
    expect(stampText({ text: '{bates} · {page}/{pages} · {date}', bates: { prefix: 'A', start: 9, digits: 3, suffix: 'Z' }, date: '2026-10-27' }, 4, 10, 2)).toBe('A011Z · 5/10 · 2026-10-27');
    expect(pdfEditOpSchema.safeParse({ op: 'page.stamp', pages: [0], stamp: { ...STAMP, text: '' } }).success).toBe(false);
  });
});

describe('redaction on this computer', () => {
  it('removes the text under the area from the page, not only covers it', async () => {
    const { e } = await opened(makePdf({ pages: 2, text: 'NIC 851234567V on page {n}' }));
    // The fixture's line sits 92 points from the top; the area covers the whole band.
    await e.apply({ op: 'page.redact', page: 0, rects: [[0, 60, 612, 60]] });
    const saved = await e.save();
    const again = await opened(saved);
    const text = await again.e.pageText([0, 1]);
    expect(text[0]).not.toContain('851234567V');
    expect(text[1]).toContain('851234567V');
    expect(Buffer.from(saved).includes('851234567V')).toBe(false);
    await e.close();
    await again.e.close();
  });
});

describe('protect and unlock a copy', () => {
  it('protects a copy with AES-256 and the permissions chosen; the document is unchanged', async () => {
    const { e } = await opened(makePdf({ pages: 2 }));
    const bytes = await e.protect('open me', 'owner pw', permissionBits({ print: true, copy: false, modify: false, annotate: false }));
    const refused = await opened(bytes).catch((x: unknown) => x);
    expect(isEngineError(refused) && refused.code).toBe('password');
    const { e: p, r } = await opened(bytes, 'open me');
    expect(r.security.encrypted).toBe(true);
    expect(r.security.encryption).toBe('aes-256');
    expect(r.permissions.print).toBe(true);
    expect(r.permissions.copy).toBe(false);
    // The open document is not encrypted by making the copy.
    const plain = await opened(await e.save());
    expect(plain.r.security.encrypted).toBe(false);
    await Promise.all([e.close(), p.close(), plain.e.close()]);
  });

  it('unlocks a copy of a protected PDF opened with its password', async () => {
    const { e } = await opened(makePdf({ pages: 1 }));
    const locked = await e.protect('pw', 'owner', permissionBits({ print: false, copy: false, modify: false, annotate: false }));
    const { e: le } = await opened(locked, 'pw');
    const { r } = await opened(await le.unprotect());
    expect(r.security.encrypted).toBe(false);
    expect(r.permissions.copy).toBe(true);
    await Promise.all([e.close(), le.close()]);
  });

  it('sets the reserved bits and only the permissions asked for', () => {
    expect(permissionBits({ print: false, copy: false, modify: false, annotate: false }) >>> 0).toBe(0xfffff0c0);
    expect((permissionBits({ print: true, copy: true, modify: true, annotate: true }) >>> 0) & 0xf3c).toBe(0xf3c);
  });
});

describe('new PDFs on this computer', () => {
  it('combines PDFs with page ranges, a bookmark per file', async () => {
    const e = new PdfiumProvider(pdfium);
    const bytes = await e.compose({ parts: [{ source: file(makePdf({ pages: 3, text: 'Alpha {n}' })), pages: [2, 0], title: 'Alpha' }, { source: file(makePdf({ pages: 2, text: 'Beta {n}' })), title: 'Beta' }], bookmarks: true });
    const { e: c, r } = await opened(bytes);
    expect(r.pageCount).toBe(4);
    const text = await c.pageText(all(4));
    expect(text.map((t) => t.trim())).toEqual(['Alpha 3', 'Alpha 1', 'Beta 1', 'Beta 2']);
    const outline = await c.outline();
    expect(outline.map((o) => [o.title, o.page])).toEqual([
      ['Alpha', 0],
      ['Beta', 2],
    ]);
    await c.close();
  });

  it('refuses a range past the end of a file', async () => {
    const e = new PdfiumProvider(pdfium);
    const err = await e.compose({ parts: [{ source: file(makePdf({ pages: 1 })), pages: [3] }] }).catch((x: unknown) => x);
    expect(isEngineError(err) && err.code).toBe('page');
  });

  it('makes a page per picture, fitted on the paper or its own size', async () => {
    const e = new PdfiumProvider(pdfium);
    const red = new Uint8Array(40 * 20 * 4).map((_, i) => (i % 4 === 2 || i % 4 === 3 ? 255 : 0));
    const bytes = await e.compose({ images: [{ width: 40, height: 20, bgra: red, page: PAPER.a4 }, { width: 40, height: 20, bgra: red, page: null }] });
    const { e: c, r } = await opened(bytes);
    expect(r.pages[0]).toEqual([595.28, 841.89]);
    expect(r.pages[1]).toEqual([30, 15]);
    const px = await c.render({ page: 1, scale: 1, annotations: false, order: 'rgba' });
    // The middle of the picture is red.
    const mid = (Math.floor(px.height / 2) * px.width + Math.floor(px.width / 2)) * 4;
    expect([px.data[mid], px.data[mid + 1], px.data[mid + 2]]).toEqual([255, 0, 0]);
    await c.close();
  });

  it('makes blank pages of a paper size', async () => {
    const e = new PdfiumProvider(pdfium);
    const { r } = await opened(await e.compose({ blank: { count: 2, size: [PAPER.letter[1], PAPER.letter[0]] } }));
    expect(r.pages).toEqual([
      [792, 612],
      [792, 612],
    ]);
  });

  it('splits pages into groups, and counts what a save declares', () => {
    expect(splitEvery(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(summarize([{ op: 'page.duplicate', pages: [0, 1] }, { op: 'page.stamp', pages: [0, 1, 2] }, { op: 'page.redact', rects: [1] }])).toMatchObject({ pages_inserted: 2, content_edits: 4 });
  });
});
