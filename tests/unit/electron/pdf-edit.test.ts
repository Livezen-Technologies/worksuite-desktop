import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PdfNewAnnot } from '../../../shared/pdf';
import { loadPdfium, PdfiumProvider, pdfDateString } from '../../../electron/services/pdf/pdfium-provider';
import type { EngineEditOp } from '../../../electron/services/pdf/engine';
import { makePdf } from './pdf-fixture';

/**
 * PDF Studio stage D2 on the real engine: annotations, pages and saving,
 * each checked by saving the document and opening what was written again.
 */
const require = createRequire(import.meta.url);
let pdfium: Awaited<ReturnType<typeof loadPdfium>>;
let dir: string;

beforeAll(async () => {
  pdfium = await loadPdfium(readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')));
  dir = mkdtempSync(join(tmpdir(), 'ws-pdf-edit-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function file(bytes: Uint8Array | Buffer) {
  const path = join(dir, `e${++n}.pdf`);
  writeFileSync(path, bytes);
  return { kind: 'plain' as const, path, size: bytes.length };
}

async function open(bytes: Uint8Array | Buffer) {
  const e = new PdfiumProvider(pdfium);
  const r = await e.open(file(bytes), null);
  return { e, r };
}

/** Saves, then opens what was written in a new engine. */
async function roundTrip(e: PdfiumProvider) {
  const bytes = await e.save();
  expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  return open(bytes);
}

const AT = '2026-09-30T08:00:00.000Z';
let ids = 0;
const annot = (a: Partial<PdfNewAnnot> & Pick<PdfNewAnnot, 'kind'>): EngineEditOp => ({
  op: 'annot.add',
  page: 0,
  author: 'Hasarinda',
  at: AT,
  annot: { id: `ws-test-${String(++ids).padStart(4, '0')}`, color: [255, 200, 0], opacity: 1, width: 2, ...a },
});

/** Pixels on a rendered page that are not grey: annotations drawn in colour. */
async function coloured(e: PdfiumProvider, page = 0): Promise<number> {
  const px = await e.render({ page, scale: 1, annotations: true, order: 'rgba' });
  let c = 0;
  for (let i = 0; i < px.data.length; i += 4) if (!(px.data[i] === px.data[i + 1] && px.data[i + 1] === px.data[i + 2])) c++;
  return c;
}

describe('annotating', () => {
  it('highlights the text a drag covered, and the highlight survives a save', async () => {
    const { e } = await open(makePdf({ pages: 1 }));
    // The fixture's line sits at y = 700 from the bottom of a 792-point page: about 85–95 points from the top.
    const span = await e.textSpan(0, [74, 88], [300, 88]);
    expect(span.text).toContain('Page 1 of the fixture');
    expect(span.rects.length).toBeGreaterThan(0);
    expect(await coloured(e)).toBe(0);
    await e.apply(annot({ kind: 'highlight', rects: span.rects, text: 'Check this' }));
    const listed = await e.annotations(0);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ kind: 'highlight', text: 'Check this', author: 'Hasarinda', color: [255, 200, 0], editable: true, modified: AT });
    expect(listed[0]!.id).toMatch(/^ws-test-/);
    const { e: again } = await roundTrip(e);
    expect((await again.annotations(0))[0]).toMatchObject({ kind: 'highlight', text: 'Check this' });
    expect(await coloured(again)).toBeGreaterThan(100);
  });

  it('adds every kind WorkSuite draws, each listed as what it is', async () => {
    const { e } = await open(makePdf({ pages: 1, text: ' ' }));
    await e.apply(annot({ kind: 'note', rect: [500, 60, 24, 24], text: 'A sticky note' }));
    await e.apply(annot({ kind: 'ink', strokes: [[[100, 300], [150, 250], [200, 300]]], color: [255, 0, 0] }));
    await e.apply(annot({ kind: 'square', rect: [300, 400, 100, 80], color: [0, 0, 255] }));
    await e.apply(annot({ kind: 'circle', rect: [100, 400, 80, 80] }));
    await e.apply(annot({ kind: 'line', strokes: [[[72, 600], [300, 650]]] }));
    await e.apply(annot({ kind: 'text', rect: [72, 500, 228, 40], text: 'Typed words', fontSize: 14, color: [200, 0, 0] }));
    await e.apply(annot({ kind: 'stamp', rect: [350, 150, 160, 40], text: 'Approved', color: [0, 128, 0] }));
    const { e: again } = await roundTrip(e);
    const kinds = (await again.annotations(0)).map((a) => a.kind);
    expect(kinds).toEqual(['note', 'ink', 'square', 'circle', 'line', 'text', 'stamp']);
    const stamp = (await again.annotations(0)).find((a) => a.kind === 'stamp')!;
    expect(stamp.text).toBe('APPROVED');
    expect(await coloured(again)).toBeGreaterThan(500);
  });

  it('puts a box where it was drawn, on a page turned 90° as well', async () => {
    const { e } = await open(makePdf({ pages: 2, rotate: true }));
    await e.apply({ ...annot({ kind: 'square', rect: [100, 150, 200, 60] }), page: 1 } as EngineEditOp);
    const [sq] = await e.annotations(1);
    // Within the border's width of where it was asked for, in the page as displayed.
    expect(sq!.rect[0]).toBeCloseTo(100, -1);
    expect(sq!.rect[1]).toBeCloseTo(150, -1);
    expect(sq!.rect[2]).toBeCloseTo(200, -1);
    expect(sq!.rect[3]).toBeCloseTo(60, -1);
  });

  it('changes and removes an annotation by its id, its own or one the file had', async () => {
    const { e } = await open(makePdf({ pages: 1, comment: 'From another app' }));
    const before = await e.annotations(0);
    expect(before).toHaveLength(1);
    expect(before[0]!.id).toBe('idx:0');
    await e.apply({ op: 'annot.update', page: 0, id: 'idx:0', text: 'Answered', color: [0, 0, 255] });
    await e.apply(annot({ kind: 'square', rect: [300, 300, 50, 50] }));
    const mine = (await e.annotations(0))[1]!;
    await e.apply({ op: 'annot.update', page: 0, id: mine.id, rect: [320, 320, 50, 50], opacity: 0.5 });
    const moved = (await e.annotations(0))[1]!;
    expect(moved.rect[0]).toBeCloseTo(320, -1);
    expect(moved.opacity).toBeCloseTo(0.5, 1);
    await e.apply({ op: 'annot.remove', page: 0, id: mine.id });
    const { e: again } = await roundTrip(e);
    const after = await again.annotations(0);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ text: 'Answered', color: [0, 0, 255] });
  });

  it('refuses to change what is not there, and never lists links', async () => {
    const { e } = await open(makePdf({ pages: 2, internalLink: true }));
    expect(await e.annotations(0)).toEqual([]);
    await expect(e.apply({ op: 'annot.remove', page: 0, id: 'ws-nothing-here' })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('writes PDF dates in UTC', () => {
    expect(pdfDateString('2026-09-30T08:05:09.000Z')).toBe('D:20260930080509Z');
  });
});

describe('organising pages', () => {
  it('rotates, deletes, moves and inserts, and the saved file has the result', async () => {
    const { e, r } = await open(makePdf({ pages: 4, text: 'This is page {n} of four, with enough words to drag across.' }));
    expect(r.pages[0]).toEqual([612, 792]);
    let sizes = await e.apply({ op: 'page.rotate', pages: [0], by: 90 });
    expect(sizes[0]).toEqual([792, 612]);
    sizes = await e.apply({ op: 'page.delete', pages: [1] });
    expect(sizes).toHaveLength(3);
    // Now 1, 3, 4: move page 4 to the front.
    await e.apply({ op: 'page.move', pages: [2], to: 0 });
    sizes = await e.apply({ op: 'page.insertBlank', at: 3, size: [595, 842] });
    expect(sizes).toHaveLength(4);
    expect(sizes[3]).toEqual([595, 842]);
    const { e: again, r: r2 } = await roundTrip(e);
    expect(r2.pageCount).toBe(4);
    const firstWords = async (p: number) => (await again.textSpan(p, [74, 88], [200, 88])).text;
    expect(await firstWords(0)).toContain('page 4');
    expect(r2.pages[1]).toEqual([792, 612]);
    expect(await firstWords(2)).toContain('page 3');
  });

  it('keeps at least one page', async () => {
    const { e } = await open(makePdf({ pages: 2 }));
    await expect(e.apply({ op: 'page.delete', pages: [0, 1] })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('inserts another PDF’s pages, all or chosen ones', async () => {
    const { e } = await open(makePdf({ pages: 2, text: 'Main {n} and enough words to drag across.' }));
    const other = file(makePdf({ pages: 3, text: 'Other {n} and enough words to drag across.' }));
    let sizes = await e.apply({ op: 'page.insertFile', at: 1, source: other, pages: [2] });
    expect(sizes).toHaveLength(3);
    sizes = await e.apply({ op: 'page.insertFile', at: 3, source: other });
    expect(sizes).toHaveLength(6);
    expect((await e.textSpan(1, [74, 88], [200, 88])).text).toContain('Other 3');
    expect((await e.textSpan(3, [74, 88], [200, 88])).text).toContain('Other 1');
  });

  it('extracts pages as a new PDF, leaving the document as it was', async () => {
    const { e } = await open(makePdf({ pages: 5, text: 'Page {n} and enough words to drag across.' }));
    const bytes = await e.extract([4, 1]);
    const { e: out, r } = await open(bytes);
    expect(r.pageCount).toBe(2);
    expect((await out.textSpan(0, [74, 88], [200, 88])).text).toContain('Page 5');
    expect((await e.save()).length).toBeGreaterThan(0);
    const { r: whole } = await roundTrip(e);
    expect(whole.pageCount).toBe(5);
  });
});

describe('opening again', () => {
  it('unloads and opens the same file again in the same engine (how undo replays)', async () => {
    const f = file(makePdf({ pages: 2 }));
    const e = new PdfiumProvider(pdfium);
    await e.open(f, null);
    await e.apply({ op: 'page.rotate', pages: [0], by: 180 });
    await e.unload();
    const r = await e.open(f, null);
    expect(r.pageCount).toBe(2);
    expect(await e.annotations(0)).toEqual([]);
  });
});
