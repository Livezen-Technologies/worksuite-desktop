import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  emptySecurity,
  encryptionOf,
  isDangerousName,
  MAX_RENDER_PIXELS,
  MAX_RENDER_SIDE,
  SEARCH_MAX_HITS,
  textMatcher,
  type PdfAnnotKind,
  type PdfAnnotView,
  type PdfAttachmentView,
  type PdfDocInfo,
  type PdfEngineCapabilities,
  type PdfLinkView,
  type PdfOutlineNode,
  type PdfPageSize,
  type PdfPermissions,
  type PdfRect,
  type PdfSearchHit,
  type PdfSearchOptions,
  type PdfSecurityReport,
} from '@shared/pdf';
import { EngineError, ENGINE_MESSAGES, type CancelToken, type EngineEditOp, type EngineFile, type EngineOpened, type PDFEngine, type RenderedPixels, type RenderRequest, type SearchProgress, type TextSpan } from './engine';
import { openReader, type BlockReader } from './file-reader';

/**
 * PDFiumProvider (§3.4): PDFium, compiled to WebAssembly by @embedpdf/pdfium,
 * behind PDFEngineInterface. It runs in the pdf-worker utility process —
 * never in the renderer (§2.5) — one process per open document.
 *
 * Why this is a safe place to parse an untrusted file (PDF-SEC-034):
 *  - PDFium runs inside WebAssembly. A parser bug corrupts only the engine's
 *    own linear memory; it cannot execute native code or reach Node. The
 *    module's only way out is its imports: an in-memory file system (MEMFS),
 *    the clock, and the read callback below, which reads this one file.
 *  - The build has no JavaScript engine, and no form-fill environment is
 *    started, so a document's scripts cannot run (PDF-SEC-030). Actions are
 *    reported, never performed: following a link is the main process's
 *    decision after the person confirms (PDF-SEC-031/032).
 *  - Memory is capped per document (PDF-NFR-005): past the cap the engine
 *    refuses and its process is ended; a worker that stops answering is
 *    ended too, and the tab offers Retry (PDF-NFR-010).
 */

/** The Emscripten runtime helpers the wrapper re-exports (typed here; the package's own typings need @types/emscripten). */
interface Runtime {
  HEAPU8: Uint8Array;
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, type: string): number;
  setValue(ptr: number, value: number, type: string): void;
  addFunction(fn: (...args: number[]) => number, sig: string): number;
  removeFunction(ptr: number): void;
  UTF16ToString(ptr: number, maxBytes?: number): string;
  stringToUTF16(s: string, ptr: number, maxBytes: number): number;
}

type Pdfium = WrappedPdfiumModule;

export async function loadPdfium(wasm: Uint8Array): Promise<Pdfium> {
  const binary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer;
  const m = await init({ wasmBinary: binary } as Parameters<typeof init>[0]);
  m.PDFiumExt_Init();
  return m;
}

// PDFium's constants (fpdfview.h, fpdf_doc.h, fpdf_text.h, fpdf_annot.h).
const FPDF_ERR = { SUCCESS: 0, UNKNOWN: 1, FILE: 2, FORMAT: 3, PASSWORD: 4, SECURITY: 5, PAGE: 6 } as const;
const RENDER_ANNOT = 0x01;
const RENDER_REVERSE_BYTE_ORDER = 0x10;
const RENDER_PRINTING = 0x800;
const ACTION = { UNSUPPORTED: 0, GOTO: 1, REMOTEGOTO: 2, URI: 3, LAUNCH: 4, EMBEDDEDGOTO: 5 } as const;
const FIND_MATCHCASE = 0x1;
const FIND_WHOLEWORD = 0x2;
const ANNOT = { LINK: 2, POPUP: 16, FILEATTACHMENT: 17, SOUND: 18, MOVIE: 19, WIDGET: 20, SCREEN: 21, RICHMEDIA: 26 } as const;

/** The annotation subtypes WorkSuite creates (fpdf_annot.h FPDF_ANNOT_*), and back. A stamp is a bordered text box: PDFium draws no /Stamp appearance of its own. */
const SUBTYPE: Record<PdfAnnotKind, number> = { note: 1, text: 3, line: 4, square: 5, circle: 6, highlight: 9, underline: 10, squiggly: 11, strikeout: 12, ink: 15, stamp: 3 };
const KIND_OF: Record<number, PdfAnnotKind> = { 1: 'note', 3: 'text', 4: 'line', 5: 'square', 6: 'circle', 9: 'highlight', 10: 'underline', 11: 'squiggly', 12: 'strikeout', 15: 'ink' };
const COLOR_STROKE = 0;
const FLAG_PRINT = 4;
/** EPDFAnnot_SetDefaultAppearance's font: Helvetica. */
const FONT_HELVETICA = 4;
const NOTE_SIZE = 24;
/** Where a drag may start or end on text and still count (points). */
const TEXT_TOLERANCE = 6;

const OUTLINE_MAX_NODES = 20_000;
const OUTLINE_MAX_DEPTH = 64;
const PAGE_CACHE = 6;
const SNIPPET = 48;

/** Name tokens found in a file's raw structure (pdfid-style), `#xx` escapes decoded. */
export function structureTokens(latin1: string, limit = Infinity): { js: number; launch: number; other: number } {
  const out = { js: 0, launch: 0, other: 0 };
  const re = /\/([A-Za-z0-9#]{2,24})/g;
  for (let m = re.exec(latin1); m && m.index < limit; m = re.exec(latin1)) {
    const name = m[1]!.includes('#') ? m[1]!.replace(/#([0-9A-Fa-f]{2})/g, (_s, h: string) => String.fromCharCode(parseInt(h, 16))) : m[1]!;
    if (name === 'JS') out.js++;
    else if (name === 'Launch') out.launch++;
    else if (name === 'RichMedia' || name === 'SubmitForm' || name === 'ImportData' || name === 'GoToE' || name === 'GoToR') out.other++;
  }
  return out;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

export class PdfiumProvider implements PDFEngine {
  private readonly P: Runtime;
  private doc = 0;
  private reader: BlockReader | null = null;
  /** A second file being read while its pages are inserted (the read callback's param 1). */
  private importReader: BlockReader | null = null;
  private fileAccess = 0;
  private readCallback = 0;
  private sizes: PdfPageSize[] = [];
  /** Loaded pages, most recent last: [page handle, text page handle or 0]. */
  private pages = new Map<number, { page: number; text: number }>();

  constructor(
    private readonly m: Pdfium,
    private readonly limits: { memoryBytes: number } = { memoryBytes: 1024 * 1024 * 1024 },
  ) {
    this.P = m.pdfium as unknown as Runtime;
  }

  capabilities(): PdfEngineCapabilities {
    return {
      engine: 'PDFium (WebAssembly)',
      version: '@embedpdf/pdfium 2.15.1',
      render: true,
      tiles: true,
      text: true,
      search: true,
      regex: true,
      outline: true,
      links: true,
      attachments: true,
      // PDFium's public API has no optional-content (layers) calls, and it cannot reflow text or sign PAdES.
      layers: false,
      annotationsRead: true,
      annotationsWrite: true,
      pages: true,
      save: true,
      editText: false,
      aes256: true,
      pades: false,
      javascript: false,
    };
  }

  // ── memory ─────────────────────────────────────────────────────────────

  private malloc(n: number): number {
    const p = this.P.wasmExports.malloc(Math.max(1, n));
    if (!p) throw new EngineError('memory', ENGINE_MESSAGES.memory);
    return p;
  }

  private free(p: number): void {
    if (p) this.P.wasmExports.free(p);
  }

  /** The engine's memory now (WebAssembly memory only grows; the process ends with the document). */
  memoryBytes(): number {
    return this.P.HEAPU8.length;
  }

  private checkMemory(): void {
    if (this.memoryBytes() > this.limits.memoryBytes) throw new EngineError('memory', ENGINE_MESSAGES.memory);
  }

  private utf16(fn: (buf: number, len: number) => number): string {
    const need = fn(0, 0);
    if (need <= 2) return '';
    const buf = this.malloc(need);
    try {
      fn(buf, need);
      return this.P.UTF16ToString(buf, need);
    } finally {
      this.free(buf);
    }
  }

  // ── open ───────────────────────────────────────────────────────────────

  /**
   * An FPDF_FILEACCESS for a reader: `{ unsigned long m_FileLen; GetBlock*
   * m_GetBlock; void* m_Param; }`. One callback serves both files; its param
   * says which — 0 the open document, 1 a file whose pages are being inserted.
   */
  private access(reader: BlockReader, param: 0 | 1): number {
    const P = this.P;
    if (!this.readCallback) {
      // int GetBlock(void* param, unsigned long position, unsigned char* pBuf, unsigned long size)
      this.readCallback = P.addFunction((which: number, position: number, buf: number, size: number) => {
        const r = which === 1 ? this.importReader : this.reader;
        if (!r) return 0;
        // The heap may have grown since the last call: always take the current view.
        return r.read(position >>> 0, P.HEAPU8.subarray(buf, buf + (size >>> 0))) ? 1 : 0;
      }, 'iiiii');
    }
    const fa = this.malloc(12);
    P.setValue(fa, reader.size, 'i32');
    P.setValue(fa + 4, this.readCallback, 'i32');
    P.setValue(fa + 8, param, 'i32');
    return fa;
  }

  async open(file: EngineFile, password: string | null): Promise<EngineOpened> {
    if (this.doc) throw new EngineError('unsupported', 'A document is already open in this engine.');
    let reader: BlockReader;
    try {
      reader = openReader(file);
    } catch {
      throw new EngineError('file', ENGINE_MESSAGES.file);
    }
    this.reader = reader;
    this.fileAccess = this.access(reader, 0);
    const doc = this.m.FPDF_LoadCustomDocument(this.fileAccess, password ?? '');
    if (!doc) {
      const err = this.m.FPDF_GetLastError();
      this.release();
      if (err === FPDF_ERR.PASSWORD) throw new EngineError('password', ENGINE_MESSAGES.password);
      if (err === FPDF_ERR.SECURITY) throw new EngineError('security', ENGINE_MESSAGES.security);
      if (err === FPDF_ERR.FILE) throw new EngineError('file', ENGINE_MESSAGES.file);
      if (err === FPDF_ERR.FORMAT) throw new EngineError('format', ENGINE_MESSAGES.format);
      throw new EngineError('unknown', ENGINE_MESSAGES.unknown);
    }
    this.doc = doc;
    const sizes = this.refreshSizes();
    this.checkMemory();
    return { pageCount: sizes.length, pages: sizes, info: this.info(), permissions: this.permissions(), security: this.docSecurity() };
  }

  /** Every page's displayed size, read again (after pages came, went or turned). */
  private refreshSizes(): PdfPageSize[] {
    const count = this.m.FPDF_GetPageCount(this.doc);
    const size = this.malloc(8);
    const sizes: PdfPageSize[] = [];
    try {
      for (let i = 0; i < count; i++) {
        if (this.m.FPDF_GetPageSizeByIndexF(this.doc, i, size)) sizes.push([round2(this.P.getValue(size, 'float')), round2(this.P.getValue(size + 4, 'float'))]);
        else sizes.push([612, 792]);
      }
    } finally {
      this.free(size);
    }
    this.sizes = sizes;
    return sizes;
  }

  private info(): PdfDocInfo {
    const meta = (tag: string) => this.utf16((buf, len) => this.m.FPDF_GetMetaText(this.doc, tag, buf, len));
    const v = this.malloc(4);
    let version = '';
    try {
      if (this.m.FPDF_GetFileVersion(this.doc, v)) {
        const n = this.P.getValue(v, 'i32');
        version = `${Math.floor(n / 10)}.${n % 10}`;
      }
    } finally {
      this.free(v);
    }
    return {
      title: meta('Title'),
      author: meta('Author'),
      subject: meta('Subject'),
      keywords: meta('Keywords'),
      creator: meta('Creator'),
      producer: meta('Producer'),
      created: pdfDate(meta('CreationDate')),
      modified: pdfDate(meta('ModDate')),
      version,
    };
  }

  private permissions(): PdfPermissions {
    // The /P flags, bits counted from 1 (ISO 32000-2 table 22); unencrypted files answer "everything".
    const p = this.m.FPDF_GetDocPermissions(this.doc) >>> 0;
    const bit = (n: number) => (p & (1 << (n - 1))) !== 0;
    return { print: bit(3), printHighQuality: bit(3) && bit(12), modify: bit(4), copy: bit(5), annotate: bit(6), fillForms: bit(6) || bit(9), assemble: bit(4) || bit(11) };
  }

  private docSecurity(): PdfSecurityReport {
    const s = emptySecurity();
    const rev = this.m.FPDF_GetSecurityHandlerRevision(this.doc);
    s.encrypted = rev >= 0;
    s.encryption = encryptionOf(rev);
    s.javascript = Math.max(0, this.m.FPDFDoc_GetJavaScriptActionCount(this.doc));
    s.xfa = this.m.FPDF_GetXFAPacketCount(this.doc) > 0 || [2, 3].includes(this.m.FPDF_GetFormType(this.doc));
    s.signatures = Math.max(0, this.m.FPDF_GetSignatureCount(this.doc));
    const files = this.attachmentList();
    s.embeddedFiles = files.length;
    s.dangerousFiles = files.filter((f) => f.dangerous).length;
    return s;
  }

  // ── pages ──────────────────────────────────────────────────────────────

  private pageSize(i: number): PdfPageSize {
    const s = this.sizes[i];
    if (!this.doc || !s) throw new EngineError('page', ENGINE_MESSAGES.page);
    return s;
  }

  private loadPage(i: number, withText = false): { page: number; text: number } {
    this.pageSize(i);
    let hit = this.pages.get(i);
    if (hit) {
      this.pages.delete(i);
      this.pages.set(i, hit);
    } else {
      const page = this.m.FPDF_LoadPage(this.doc, i);
      if (!page) throw new EngineError('page', ENGINE_MESSAGES.page);
      hit = { page, text: 0 };
      this.pages.set(i, hit);
      while (this.pages.size > PAGE_CACHE) {
        const [oldest, h] = this.pages.entries().next().value!;
        this.pages.delete(oldest);
        this.closePage(h);
      }
    }
    if (withText && !hit.text) {
      hit.text = this.m.FPDFText_LoadPage(hit.page);
      if (!hit.text) throw new EngineError('page', ENGINE_MESSAGES.page);
    }
    return hit;
  }

  private closePage(h: { page: number; text: number }): void {
    if (h.text) this.m.FPDFText_ClosePage(h.text);
    this.m.FPDF_ClosePage(h.page);
  }

  /** A point in page space to points from the displayed page's top-left corner (rotation applied). */
  private toDisplay(page: number, size: PdfPageSize, x: number, y: number, out: number): [number, number] {
    const S = 64;
    this.m.FPDF_PageToDevice(page, 0, 0, Math.round(size[0] * S), Math.round(size[1] * S), 0, x, y, out, out + 4);
    return [this.P.getValue(out, 'i32') / S, this.P.getValue(out + 4, 'i32') / S];
  }

  private rect(page: number, size: PdfPageSize, left: number, top: number, right: number, bottom: number, scratch: number): PdfRect {
    const [x1, y1] = this.toDisplay(page, size, left, top, scratch);
    const [x2, y2] = this.toDisplay(page, size, right, bottom, scratch);
    return [round2(Math.min(x1, x2)), round2(Math.min(y1, y2)), round2(Math.abs(x2 - x1)), round2(Math.abs(y2 - y1))];
  }

  async render(req: RenderRequest): Promise<RenderedPixels> {
    const size = this.pageSize(req.page);
    if (!(req.scale > 0) || req.scale > 64) throw new EngineError('unsupported', 'That zoom is out of range.');
    const fullW = Math.max(1, Math.round(size[0] * req.scale));
    const fullH = Math.max(1, Math.round(size[1] * req.scale));
    const t = req.tile ?? { x: 0, y: 0, w: fullW, h: fullH };
    const x = Math.max(0, Math.min(t.x, fullW - 1));
    const y = Math.max(0, Math.min(t.y, fullH - 1));
    const w = Math.max(1, Math.min(t.w, fullW - x));
    const h = Math.max(1, Math.min(t.h, fullH - y));
    if (w * h > MAX_RENDER_PIXELS || w > MAX_RENDER_SIDE || h > MAX_RENDER_SIDE) throw new EngineError('unsupported', 'That area is too large to draw at once.');
    const { page } = this.loadPage(req.page);
    const bmp = this.m.FPDFBitmap_Create(w, h, 1);
    if (!bmp) throw new EngineError('memory', ENGINE_MESSAGES.memory);
    try {
      this.m.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff);
      const flags = (req.annotations ? RENDER_ANNOT : 0) | (req.order === 'rgba' ? RENDER_REVERSE_BYTE_ORDER : 0) | (req.printing ? RENDER_PRINTING : 0);
      this.m.FPDF_RenderPageBitmap(bmp, page, -x, -y, fullW, fullH, 0, flags);
      const buf = this.m.FPDFBitmap_GetBuffer(bmp);
      const stride = this.m.FPDFBitmap_GetStride(bmp);
      const heap = this.P.HEAPU8;
      const data = new Uint8Array(w * h * 4);
      if (stride === w * 4) data.set(heap.subarray(buf, buf + w * h * 4));
      else for (let row = 0; row < h; row++) data.set(heap.subarray(buf + row * stride, buf + row * stride + w * 4), row * w * 4);
      return { width: w, height: h, data };
    } finally {
      this.m.FPDFBitmap_Destroy(bmp);
      this.checkMemory();
    }
  }

  // ── text and search (§6.3) ─────────────────────────────────────────────

  private text(tp: number, start: number, count: number): string {
    if (count <= 0) return '';
    const buf = this.malloc((count + 1) * 2);
    try {
      this.m.FPDFText_GetText(tp, start, count, buf);
      return this.P.UTF16ToString(buf, (count + 1) * 2);
    } finally {
      this.free(buf);
    }
  }

  private hitAt(i: number, tp: number, page: number, start: number, count: number, scratch: number): PdfSearchHit {
    const size = this.pageSize(i);
    const total = this.m.FPDFText_CountChars(tp);
    const rects: PdfRect[] = [];
    const n = Math.min(64, this.m.FPDFText_CountRects(tp, start, count));
    for (let r = 0; r < n; r++) {
      if (this.m.FPDFText_GetRect(tp, r, scratch, scratch + 8, scratch + 16, scratch + 24)) {
        const [l, t, rt, b] = [this.P.getValue(scratch, 'double'), this.P.getValue(scratch + 8, 'double'), this.P.getValue(scratch + 16, 'double'), this.P.getValue(scratch + 24, 'double')];
        rects.push(this.rect(page, size, l, t, rt, b, scratch + 32));
      }
    }
    const from = Math.max(0, start - SNIPPET);
    const to = Math.min(total, start + count + SNIPPET);
    const tidy = (s: string) => s.replace(/\p{Cc}+/gu, ' ');
    return {
      source: 'text',
      page: i,
      index: start,
      before: from > 0 ? tidy(this.text(tp, from, start - from)).replace(/^\S*\s/, '… ') : tidy(this.text(tp, from, start - from)),
      match: tidy(this.text(tp, start, count)),
      after: to < total ? tidy(this.text(tp, start + count, to - start - count)).replace(/\s\S*$/, ' …') : tidy(this.text(tp, start + count, to - start - count)),
      rects,
    };
  }

  private searchPage(i: number, query: string, o: PdfSearchOptions, re: RegExp | null, room: number): PdfSearchHit[] {
    const { page, text: tp } = this.loadPage(i, true);
    const hits: PdfSearchHit[] = [];
    const scratch = this.malloc(48);
    try {
      if (o.regex && re) {
        const total = this.m.FPDFText_CountChars(tp);
        const all = this.text(tp, 0, total);
        re.lastIndex = 0;
        for (let m = re.exec(all); m && hits.length < room; m = re.exec(all)) {
          if (!m[0]) {
            re.lastIndex++;
            continue;
          }
          const start = this.m.FPDFText_GetCharIndexFromTextIndex(tp, m.index);
          const end = this.m.FPDFText_GetCharIndexFromTextIndex(tp, m.index + m[0].length - 1);
          if (start >= 0 && end >= start) hits.push(this.hitAt(i, tp, page, start, end - start + 1, scratch));
        }
      } else {
        const bytes = (query.length + 1) * 2;
        const q = this.malloc(bytes);
        try {
          this.P.stringToUTF16(query, q, bytes);
          const find = this.m.FPDFText_FindStart(tp, q, (o.matchCase ? FIND_MATCHCASE : 0) | (o.wholeWord ? FIND_WHOLEWORD : 0), 0);
          if (find) {
            try {
              while (hits.length < room && this.m.FPDFText_FindNext(find)) {
                hits.push(this.hitAt(i, tp, page, this.m.FPDFText_GetSchResultIndex(find), this.m.FPDFText_GetSchCount(find), scratch));
              }
            } finally {
              this.m.FPDFText_FindClose(find);
            }
          }
        } finally {
          this.free(q);
        }
      }
      if (o.comments && hits.length < room) hits.push(...this.commentHits(i, page, re, room - hits.length, scratch));
    } finally {
      this.free(scratch);
    }
    return hits;
  }

  private annotString(annot: number, key: string): string {
    return this.utf16((buf, len) => this.m.FPDFAnnot_GetStringValue(annot, key, buf, len));
  }

  private commentHits(i: number, page: number, re: RegExp | null, room: number, scratch: number): PdfSearchHit[] {
    if (!re) return [];
    const out: PdfSearchHit[] = [];
    const size = this.pageSize(i);
    const n = this.m.FPDFPage_GetAnnotCount(page);
    for (let a = 0; a < n && out.length < room; a++) {
      const annot = this.m.FPDFPage_GetAnnot(page, a);
      if (!annot) continue;
      try {
        const type = this.m.FPDFAnnot_GetSubtype(annot);
        if (type === ANNOT.LINK || type === ANNOT.POPUP || type === ANNOT.WIDGET) continue;
        const contents = this.annotString(annot, 'Contents');
        if (!contents) continue;
        re.lastIndex = 0;
        const m = re.exec(contents);
        if (!m) continue;
        let rect: PdfRect = [0, 0, 0, 0];
        if (this.m.FPDFAnnot_GetRect(annot, scratch)) {
          const g = (k: number) => this.P.getValue(scratch + k * 4, 'float');
          rect = this.rect(page, size, g(0), g(1), g(2), g(3), scratch + 32);
        }
        out.push({ source: 'comment', page: i, index: -1, before: contents.slice(Math.max(0, m.index - SNIPPET), m.index), match: m[0], after: contents.slice(m.index + m[0].length, m.index + m[0].length + SNIPPET), rects: [rect] });
      } finally {
        this.m.FPDFPage_CloseAnnot(annot);
      }
    }
    return out;
  }

  async search(query: string, o: PdfSearchOptions, onProgress: (p: SearchProgress) => void, cancel: CancelToken): Promise<void> {
    if (!this.doc) throw new EngineError('unsupported', ENGINE_MESSAGES.unsupported);
    const re = textMatcher(query, o);
    if (o.regex && !re) throw new EngineError('unsupported', 'That regular expression is not valid.');
    let found = 0;
    if (o.bookmarks && re) {
      const hits: PdfSearchHit[] = [];
      const walk = (nodes: PdfOutlineNode[]) => {
        for (const n of nodes) {
          re.lastIndex = 0;
          const m = re.exec(n.title);
          if (m && n.page !== null) hits.push({ source: 'bookmark', page: n.page, index: -1, before: n.title.slice(0, m.index), match: m[0], after: n.title.slice(m.index + m[0].length), rects: [] });
          walk(n.children);
        }
      };
      walk(await this.outline());
      found += hits.length;
      if (hits.length) onProgress({ hits: hits.slice(0, SEARCH_MAX_HITS), pagesDone: 0, truncated: false });
    }
    let batch: PdfSearchHit[] = [];
    let last = Date.now();
    for (let i = 0; i < this.sizes.length; i++) {
      if (cancel.cancelled) return;
      if (found < SEARCH_MAX_HITS) {
        const hits = this.searchPage(i, query, o, re, SEARCH_MAX_HITS - found);
        found += hits.length;
        batch.push(...hits);
      }
      // Partial results as pages are searched (PDF-SRCH-004): every 150 ms, or when it ends.
      const end = i === this.sizes.length - 1 || found >= SEARCH_MAX_HITS;
      if (end || Date.now() - last > 150) {
        onProgress({ hits: batch, pagesDone: i + 1, truncated: found >= SEARCH_MAX_HITS });
        batch = [];
        last = Date.now();
        this.checkMemory();
        await tick();
      }
      if (found >= SEARCH_MAX_HITS) return;
    }
    if (!this.sizes.length) onProgress({ hits: [], pagesDone: 0, truncated: false });
  }

  // ── outline, links, attachments ────────────────────────────────────────

  private destPage(dest: number): number | null {
    if (!dest) return null;
    const p = this.m.FPDFDest_GetDestPageIndex(this.doc, dest);
    return p >= 0 && p < this.sizes.length ? p : null;
  }

  /** What an action does; null for a go-to whose page is not in this file (it does nothing). */
  private actionKind(action: number): { kind: PdfLinkView['kind']; page?: number } | null {
    const type = this.m.FPDFAction_GetType(action);
    if (type === ACTION.GOTO) {
      const page = this.destPage(this.m.FPDFAction_GetDest(this.doc, action));
      return page === null ? null : { kind: 'page', page };
    }
    if (type === ACTION.URI) return { kind: 'uri' };
    if (type === ACTION.LAUNCH) return { kind: 'launch' };
    if (type === ACTION.REMOTEGOTO || type === ACTION.EMBEDDEDGOTO) return { kind: 'remote' };
    return { kind: 'other' };
  }

  async outline(): Promise<PdfOutlineNode[]> {
    if (!this.doc) return [];
    const seen = new Set<number>();
    let count = 0;
    const walk = (parent: number, depth: number): PdfOutlineNode[] => {
      const out: PdfOutlineNode[] = [];
      if (depth > OUTLINE_MAX_DEPTH) return out;
      for (let bm = this.m.FPDFBookmark_GetFirstChild(this.doc, parent); bm && !seen.has(bm) && count < OUTLINE_MAX_NODES; bm = this.m.FPDFBookmark_GetNextSibling(this.doc, bm)) {
        seen.add(bm);
        count++;
        const title = this.utf16((buf, len) => this.m.FPDFBookmark_GetTitle(bm, buf, len)).trim() || 'Untitled';
        let page = this.destPage(this.m.FPDFBookmark_GetDest(this.doc, bm));
        let action: PdfOutlineNode['action'];
        if (page === null) {
          const act = this.m.FPDFBookmark_GetAction(bm);
          const k = act ? this.actionKind(act) : null;
          if (k?.kind === 'page') page = k.page ?? null;
          else if (k) action = k.kind === 'uri' || k.kind === 'launch' || k.kind === 'remote' ? k.kind : 'other';
        }
        out.push({ title: title.slice(0, 500), page, ...(action ? { action } : {}), children: walk(bm, depth + 1) });
      }
      return out;
    };
    return walk(0, 0);
  }

  async links(i: number): Promise<PdfLinkView[]> {
    const size = this.pageSize(i);
    const { page } = this.loadPage(i);
    const out: PdfLinkView[] = [];
    const pos = this.malloc(4);
    const link = this.malloc(4);
    const rect = this.malloc(48);
    try {
      this.P.setValue(pos, 0, 'i32');
      for (let n = 0; n < 2000 && this.m.FPDFLink_Enumerate(page, pos, link); n++) {
        const l = this.P.getValue(link, 'i32');
        if (!this.m.FPDFLink_GetAnnotRect(l, rect)) continue;
        const g = (k: number) => this.P.getValue(rect + k * 4, 'float');
        const r = this.rect(page, size, g(0), g(1), g(2), g(3), rect + 16);
        const destPage = this.destPage(this.m.FPDFLink_GetDest(this.doc, l));
        if (destPage !== null) {
          out.push({ index: n, rect: r, kind: 'page', page: destPage });
          continue;
        }
        const action = this.m.FPDFLink_GetAction(l);
        const k = action ? this.actionKind(action) : null;
        if (!k) continue;
        const view: PdfLinkView = { index: n, rect: r, kind: k.kind, ...(k.page !== undefined ? { page: k.page } : {}) };
        if (k.kind === 'uri') {
          const need = this.m.FPDFAction_GetURIPath(this.doc, action, 0, 0);
          if (need > 1 && need < 8192) {
            const buf = this.malloc(need);
            try {
              this.m.FPDFAction_GetURIPath(this.doc, action, buf, need);
              view.uri = Buffer.from(this.P.HEAPU8.subarray(buf, buf + need - 1)).toString('latin1');
            } finally {
              this.free(buf);
            }
          }
        }
        out.push(view);
      }
    } finally {
      this.free(pos);
      this.free(link);
      this.free(rect);
    }
    return out;
  }

  private attachmentList(): PdfAttachmentView[] {
    const n = Math.min(1000, Math.max(0, this.m.FPDFDoc_GetAttachmentCount(this.doc)));
    const out: PdfAttachmentView[] = [];
    const len = this.malloc(4);
    try {
      for (let i = 0; i < n; i++) {
        const att = this.m.FPDFDoc_GetAttachment(this.doc, i);
        if (!att) continue;
        const name = this.utf16((buf, l) => this.m.FPDFAttachment_GetName(att, buf, l)).slice(0, 255) || `Attachment ${i + 1}`;
        this.P.setValue(len, 0, 'i32');
        const size = this.m.FPDFAttachment_GetFile(att, 0, 0, len) ? this.P.getValue(len, 'i32') >>> 0 : 0;
        out.push({ index: i, name, size, dangerous: isDangerousName(name) });
      }
    } finally {
      this.free(len);
    }
    return out;
  }

  async attachments(): Promise<PdfAttachmentView[]> {
    return this.doc ? this.attachmentList() : [];
  }

  // ── active content (§12.5) ─────────────────────────────────────────────

  async scan(onProgress: (s: PdfSecurityReport) => void, cancel: CancelToken): Promise<PdfSecurityReport> {
    if (!this.doc) throw new EngineError('unsupported', ENGINE_MESSAGES.unsupported);
    const s = this.docSecurity();
    const found = { js: s.javascript, launch: 0, other: 0, uri: 0, files: s.embeddedFiles };
    const tally = (k: PdfLinkView['kind'] | PdfOutlineNode['action'] | undefined) => {
      if (k === 'uri') found.uri++;
      else if (k === 'launch') found.launch++;
      else if (k === 'remote' || k === 'other') found.other++;
    };
    const walk = (nodes: PdfOutlineNode[]) => nodes.forEach((n) => (n.action && tally(n.action), walk(n.children)));
    walk(await this.outline());
    let raw = { js: 0, launch: 0, other: 0 };
    const report = (pages: number, structure: boolean): PdfSecurityReport => ({
      ...s,
      javascript: Math.max(found.js, raw.js),
      launchActions: Math.max(found.launch, raw.launch),
      otherActions: Math.max(found.other, raw.other),
      externalLinks: found.uri,
      embeddedFiles: found.files,
      pagesScanned: pages,
      structureScanned: structure,
    });
    let last = Date.now();
    for (let i = 0; i < this.sizes.length; i++) {
      if (cancel.cancelled) return report(i, false);
      // Its own page handle: a scan must not push the pages being looked at out of the cache.
      const page = this.m.FPDF_LoadPage(this.doc, i);
      if (page) {
        try {
          for (const l of await this.linksOf(page, i)) tally(l.kind);
          for (const aa of [0, 1]) {
            const act = this.m.FPDF_GetPageAAction(page, aa);
            if (act) {
              if (this.m.FPDFAction_GetType(act) === ACTION.UNSUPPORTED) found.js++;
              else tally(this.actionKind(act)?.kind);
            }
          }
          const n = this.m.FPDFPage_GetAnnotCount(page);
          for (let a = 0; a < n; a++) {
            const annot = this.m.FPDFPage_GetAnnot(page, a);
            if (!annot) continue;
            const t = this.m.FPDFAnnot_GetSubtype(annot);
            if (t === ANNOT.FILEATTACHMENT) found.files++;
            else if (t === ANNOT.SCREEN || t === ANNOT.RICHMEDIA || t === ANNOT.MOVIE || t === ANNOT.SOUND) found.other++;
            this.m.FPDFPage_CloseAnnot(annot);
          }
        } finally {
          this.m.FPDF_ClosePage(page);
        }
      }
      if (Date.now() - last > 200) {
        onProgress(report(i + 1, false));
        last = Date.now();
        await tick();
      }
    }
    // The raw structure: names a script or a launch can hide behind that no page walk sees.
    raw = await this.structureScan(cancel);
    const done = report(this.sizes.length, !cancel.cancelled);
    onProgress(done);
    return done;
  }

  private async linksOf(page: number, i: number): Promise<PdfLinkView[]> {
    // `links()` loads through the cache; the scan passes its own handle.
    const cached = this.pages.get(i);
    if (cached) return this.links(i);
    const out: PdfLinkView[] = [];
    const pos = this.malloc(4);
    const link = this.malloc(4);
    try {
      this.P.setValue(pos, 0, 'i32');
      for (let n = 0; n < 2000 && this.m.FPDFLink_Enumerate(page, pos, link); n++) {
        const l = this.P.getValue(link, 'i32');
        if (this.destPage(this.m.FPDFLink_GetDest(this.doc, l)) !== null) continue;
        const action = this.m.FPDFLink_GetAction(l);
        const k = action ? this.actionKind(action) : null;
        if (k) out.push({ index: n, rect: [0, 0, 0, 0], kind: k.kind });
      }
    } finally {
      this.free(pos);
      this.free(link);
    }
    return out;
  }

  private async structureScan(cancel: CancelToken): Promise<{ js: number; launch: number; other: number }> {
    const r = this.reader;
    const total = { js: 0, launch: 0, other: 0 };
    if (!r) return total;
    const WINDOW = 4 * 1024 * 1024;
    const OVERLAP = 64;
    const buf = new Uint8Array(WINDOW + OVERLAP);
    for (let pos = 0; pos < r.size; pos += WINDOW) {
      if (cancel.cancelled) break;
      const len = Math.min(WINDOW + OVERLAP, r.size - pos);
      if (!r.read(pos, buf.subarray(0, len))) break;
      // A token that starts in the overlap is counted by the next window.
      const text = Buffer.from(buf.buffer, buf.byteOffset, len).toString('latin1');
      const t = structureTokens(text, WINDOW);
      total.js += t.js;
      total.launch += t.launch;
      total.other += t.other;
      await tick();
    }
    return total;
  }


  // ── editing (stage D2) ─────────────────────────────────────────────────

  /** Points from the displayed page's top-left corner to page space (the inverse of `toDisplay`). */
  private toPage(page: number, size: PdfPageSize, x: number, y: number, out: number): [number, number] {
    const S = 64;
    this.m.FPDF_DeviceToPage(page, 0, 0, Math.round(size[0] * S), Math.round(size[1] * S), 0, Math.round(x * S), Math.round(y * S), out, out + 8);
    return [this.P.getValue(out, 'double'), this.P.getValue(out + 8, 'double')];
  }

  /** A displayed rectangle as page space `[left, bottom, right, top]`. */
  private pageRect(page: number, size: PdfPageSize, r: PdfRect, scratch: number): [number, number, number, number] {
    const [x1, y1] = this.toPage(page, size, r[0], r[1], scratch);
    const [x2, y2] = this.toPage(page, size, r[0] + r[2], r[1] + r[3], scratch);
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }

  /** FS_RECTF `{ left, top, right, bottom }` from `[left, bottom, right, top]`. */
  private writeRect(ptr: number, [l, b, r, t]: [number, number, number, number]): number {
    this.P.setValue(ptr, l, 'float');
    this.P.setValue(ptr + 4, t, 'float');
    this.P.setValue(ptr + 8, r, 'float');
    this.P.setValue(ptr + 12, b, 'float');
    return ptr;
  }

  private setString(annot: number, key: string, value: string): void {
    const bytes = (value.length + 1) * 2;
    const w = this.malloc(bytes);
    try {
      this.P.stringToUTF16(value, w, bytes);
      this.m.FPDFAnnot_SetStringValue(annot, key, w);
    } finally {
      this.free(w);
    }
  }

  /** The annotation's index on the page for a WorkSuite id (its /NM), or `idx:<n>`; -1 when it is not there. */
  private findAnnot(page: number, id: string): number {
    if (id.startsWith('idx:')) {
      const n = Number(id.slice(4));
      return n >= 0 && n < this.m.FPDFPage_GetAnnotCount(page) ? n : -1;
    }
    const count = this.m.FPDFPage_GetAnnotCount(page);
    for (let a = 0; a < count; a++) {
      const annot = this.m.FPDFPage_GetAnnot(page, a);
      if (!annot) continue;
      try {
        if (this.annotString(annot, 'NM') === id) return a;
      } finally {
        this.m.FPDFPage_CloseAnnot(annot);
      }
    }
    return -1;
  }

  async annotations(i: number): Promise<PdfAnnotView[]> {
    const size = this.pageSize(i);
    const { page } = this.loadPage(i);
    const out: PdfAnnotView[] = [];
    const scratch = this.malloc(48);
    try {
      const n = Math.min(2000, this.m.FPDFPage_GetAnnotCount(page));
      for (let a = 0; a < n; a++) {
        const annot = this.m.FPDFPage_GetAnnot(page, a);
        if (!annot) continue;
        try {
          const subtype = this.m.FPDFAnnot_GetSubtype(annot);
          if (subtype === ANNOT.LINK || subtype === ANNOT.POPUP || subtype === ANNOT.WIDGET) continue;
          const nm = this.annotString(annot, 'NM');
          let kind: PdfAnnotView['kind'] = KIND_OF[subtype] ?? 'other';
          if (subtype === 3 && this.annotString(annot, 'Subj') === 'Stamp') kind = 'stamp';
          let rect: PdfRect = [0, 0, 0, 0];
          if (this.m.FPDFAnnot_GetRect(annot, scratch)) {
            const g = (k: number) => this.P.getValue(scratch + k * 4, 'float');
            rect = this.rect(page, size, g(0), g(1), g(2), g(3), scratch + 32);
          }
          let color: PdfAnnotView['color'] = null;
          // /C itself: PDFium's own FPDFAnnot_GetColor refuses once an annotation has an appearance stream.
          if (this.m.EPDFAnnot_GetColor(annot, COLOR_STROKE, scratch, scratch + 4, scratch + 8)) {
            color = [this.P.getValue(scratch, 'i32') & 0xff, this.P.getValue(scratch + 4, 'i32') & 0xff, this.P.getValue(scratch + 8, 'i32') & 0xff];
          }
          const ca = this.m.EPDFAnnot_GetOpacity(annot, scratch) ? this.P.getValue(scratch, 'i32') / 255 : 1;
          out.push({
            id: nm.startsWith('ws-') ? nm : `idx:${a}`,
            page: i,
            kind,
            subtype,
            rect,
            color,
            opacity: Math.round(Math.min(1, Math.max(0, ca)) * 100) / 100,
            text: this.annotString(annot, 'Contents').slice(0, 10_000),
            author: this.annotString(annot, 'T').slice(0, 200),
            modified: pdfDate(this.annotString(annot, 'M')),
            editable: kind !== 'other',
          });
        } finally {
          this.m.FPDFPage_CloseAnnot(annot);
        }
      }
    } finally {
      this.free(scratch);
    }
    return out;
  }

  async textSpan(i: number, from: [number, number], to: [number, number]): Promise<TextSpan> {
    const size = this.pageSize(i);
    const { page, text: tp } = this.loadPage(i, true);
    const scratch = this.malloc(64);
    try {
      const at = (p: [number, number]) => {
        const [x, y] = this.toPage(page, size, p[0], p[1], scratch);
        return this.m.FPDFText_GetCharIndexAtPos(tp, x, y, TEXT_TOLERANCE, TEXT_TOLERANCE);
      };
      let a = at(from);
      let b = at(to);
      if (a < 0 || b < 0) return { rects: [], text: '' };
      if (a > b) [a, b] = [b, a];
      const count = b - a + 1;
      const rects: PdfRect[] = [];
      const n = Math.min(400, this.m.FPDFText_CountRects(tp, a, count));
      for (let r = 0; r < n; r++) {
        if (this.m.FPDFText_GetRect(tp, r, scratch, scratch + 8, scratch + 16, scratch + 24)) {
          const [l, t, rt, bt] = [this.P.getValue(scratch, 'double'), this.P.getValue(scratch + 8, 'double'), this.P.getValue(scratch + 16, 'double'), this.P.getValue(scratch + 24, 'double')];
          rects.push(this.rect(page, size, l, t, rt, bt, scratch + 32));
        }
      }
      return { rects, text: this.text(tp, a, count).replace(/\p{Cc}+/gu, ' ').slice(0, 10_000) };
    } finally {
      this.free(scratch);
    }
  }

  /** Every cached page handle goes: after a change, indexes and contents may have moved. */
  private dropPages(): void {
    for (const h of this.pages.values()) this.closePage(h);
    this.pages.clear();
  }

  async apply(op: EngineEditOp): Promise<PdfPageSize[]> {
    if (!this.doc) throw new EngineError('unsupported', ENGINE_MESSAGES.unsupported);
    try {
      switch (op.op) {
        case 'annot.add':
          this.addAnnot(op);
          break;
        case 'annot.update':
          this.updateAnnot(op);
          break;
        case 'annot.remove': {
          const { page } = this.loadPage(op.page);
          const idx = this.findAnnot(page, op.id);
          if (idx < 0 || !this.m.FPDFPage_RemoveAnnot(page, idx)) throw new EngineError('unsupported', 'That annotation is no longer on the page.');
          break;
        }
        case 'page.rotate':
          for (const p of new Set(op.pages)) {
            const { page } = this.loadPage(p);
            this.m.FPDFPage_SetRotation(page, (this.m.FPDFPage_GetRotation(page) + op.by / 90) % 4);
          }
          break;
        case 'page.delete': {
          const pages = [...new Set(op.pages)].sort((a, b) => b - a);
          if (pages.length >= this.sizes.length) throw new EngineError('unsupported', 'A PDF keeps at least one page.');
          this.dropPages();
          for (const p of pages) {
            this.pageSize(p);
            this.m.FPDFPage_Delete(this.doc, p);
          }
          break;
        }
        case 'page.move': {
          const pages = [...new Set(op.pages)];
          for (const p of pages) this.pageSize(p);
          if (op.to + pages.length > this.sizes.length) throw new EngineError('page', ENGINE_MESSAGES.page);
          this.dropPages();
          const ptr = this.malloc(pages.length * 4);
          try {
            pages.forEach((p, k) => this.P.setValue(ptr + k * 4, p, 'i32'));
            if (!this.m.FPDF_MovePages(this.doc, ptr, pages.length, op.to)) throw new EngineError('page', ENGINE_MESSAGES.page);
          } finally {
            this.free(ptr);
          }
          break;
        }
        case 'page.insertBlank': {
          if (op.at > this.sizes.length) throw new EngineError('page', ENGINE_MESSAGES.page);
          this.dropPages();
          const p = this.m.FPDFPage_New(this.doc, op.at, op.size[0], op.size[1]);
          if (!p) throw new EngineError('memory', ENGINE_MESSAGES.memory);
          this.m.FPDF_ClosePage(p);
          break;
        }
        case 'page.insertFile':
          this.insertFile(op);
          break;
      }
    } finally {
      this.dropPages();
    }
    const sizes = this.refreshSizes();
    this.checkMemory();
    return sizes;
  }

  private addAnnot(op: Extract<EngineEditOp, { op: 'annot.add' }>): void {
    const a = op.annot;
    const size = this.pageSize(op.page);
    const { page } = this.loadPage(op.page);
    if (this.findAnnot(page, a.id) >= 0) throw new EngineError('unsupported', 'That annotation is already on the page.');
    const annot = this.m.FPDFPage_CreateAnnot(page, SUBTYPE[a.kind]);
    if (!annot) throw new EngineError('unsupported', 'This kind of annotation cannot be added to this page.');
    const scratch = this.malloc(64);
    try {
      const [r, g, b] = a.color;
      let box: [number, number, number, number] | null = a.rect ? this.pageRect(page, size, a.rect, scratch) : null;
      const pad = a.width / 2 + 1;
      if (a.rects?.length && ['highlight', 'underline', 'strikeout', 'squiggly'].includes(a.kind)) {
        // One quadrilateral per line of text, in page space: top-left, top-right, bottom-left, bottom-right.
        const q = this.malloc(32);
        try {
          for (const rr of a.rects) {
            const [l, bt, rt, t] = this.pageRect(page, size, rr, scratch);
            [l, t, rt, t, l, bt, rt, bt].forEach((v, k) => this.P.setValue(q + k * 4, v, 'float'));
            this.m.FPDFAnnot_AppendAttachmentPoints(annot, q);
            box = box ? [Math.min(box[0], l), Math.min(box[1], bt), Math.max(box[2], rt), Math.max(box[3], t)] : [l, bt, rt, t];
          }
        } finally {
          this.free(q);
        }
      }
      if ((a.kind === 'ink' || a.kind === 'line') && a.strokes?.length) {
        const pts = a.strokes.map((st) => st.map((p) => this.toPage(page, size, p[0], p[1], scratch)));
        for (const st of pts) for (const [x, y] of st) box = box ? [Math.min(box[0], x - pad), Math.min(box[1], y - pad), Math.max(box[2], x + pad), Math.max(box[3], y + pad)] : [x - pad, y - pad, x + pad, y + pad];
        if (a.kind === 'ink') {
          for (const st of pts) {
            const buf = this.malloc(st.length * 8);
            try {
              st.forEach(([x, y], k) => {
                this.P.setValue(buf + k * 8, x, 'float');
                this.P.setValue(buf + k * 8 + 4, y, 'float');
              });
              if (this.m.FPDFAnnot_AddInkStroke(annot, buf, st.length) < 0) throw new EngineError('unsupported', 'The drawing could not be added.');
            } finally {
              this.free(buf);
            }
          }
        } else {
          const first = pts[0]![0]!;
          const last = pts[0]![pts[0]!.length - 1]!;
          const ends = this.malloc(16);
          try {
            this.P.setValue(ends, first[0], 'float');
            this.P.setValue(ends + 4, first[1], 'float');
            this.P.setValue(ends + 8, last[0], 'float');
            this.P.setValue(ends + 12, last[1], 'float');
            this.m.EPDFAnnot_SetLine(annot, ends, ends + 8);
          } finally {
            this.free(ends);
          }
        }
      }
      if (a.kind === 'note' && box) box = [box[0], box[3] - NOTE_SIZE, box[0] + NOTE_SIZE, box[3]];
      if (!box) throw new EngineError('unsupported', 'An annotation needs a place on the page.');
      this.m.FPDFAnnot_SetRect(annot, this.writeRect(scratch, box));
      this.m.EPDFAnnot_SetColor(annot, COLOR_STROKE, r, g, b);
      if (['ink', 'line', 'square', 'circle', 'stamp'].includes(a.kind)) this.m.FPDFAnnot_SetBorder(annot, 0, 0, a.width);
      if (a.kind === 'text' || a.kind === 'stamp') {
        this.m.EPDFAnnot_SetDefaultAppearance(annot, FONT_HELVETICA, a.fontSize ?? (a.kind === 'stamp' ? 18 : 12), r, g, b);
        if (a.kind === 'stamp') this.setString(annot, 'Subj', 'Stamp');
      }
      if (a.opacity < 1) this.m.EPDFAnnot_SetOpacity(annot, Math.round(a.opacity * 255));
      if (a.text !== undefined) this.setString(annot, 'Contents', a.kind === 'stamp' ? a.text.toUpperCase() : a.text);
      this.setString(annot, 'NM', a.id);
      this.setString(annot, 'T', op.author);
      this.setString(annot, 'M', pdfDateString(op.at));
      this.m.FPDFAnnot_SetFlags(annot, FLAG_PRINT);
      this.m.EPDFAnnot_GenerateAppearance(annot);
    } finally {
      this.free(scratch);
      this.m.FPDFPage_CloseAnnot(annot);
    }
  }

  private updateAnnot(op: Extract<EngineEditOp, { op: 'annot.update' }>): void {
    const size = this.pageSize(op.page);
    const { page } = this.loadPage(op.page);
    const idx = this.findAnnot(page, op.id);
    if (idx < 0) throw new EngineError('unsupported', 'That annotation is no longer on the page.');
    const annot = this.m.FPDFPage_GetAnnot(page, idx);
    if (!annot) throw new EngineError('unsupported', 'That annotation is no longer on the page.');
    const scratch = this.malloc(64);
    try {
      const subtype = this.m.FPDFAnnot_GetSubtype(annot);
      if (!KIND_OF[subtype]) throw new EngineError('unsupported', 'This kind of annotation cannot be changed here.');
      if (op.color) {
        // EPDF's: FPDFAnnot_SetColor refuses once there is an appearance stream, and every annotation drawn has one.
        this.m.EPDFAnnot_SetColor(annot, COLOR_STROKE, op.color[0], op.color[1], op.color[2]);
        if (subtype === 3) {
          const fs = this.m.FPDFAnnot_GetNumberValue(annot, 'FontSize', scratch) ? this.P.getValue(scratch, 'float') : 12;
          this.m.EPDFAnnot_SetDefaultAppearance(annot, FONT_HELVETICA, fs > 0 ? fs : 12, op.color[0], op.color[1], op.color[2]);
        }
      }
      if (op.opacity !== undefined) this.m.EPDFAnnot_SetOpacity(annot, Math.round(op.opacity * 255));
      if (op.text !== undefined) this.setString(annot, 'Contents', op.text);
      // Only boxes move: a highlight or a drawing belongs where it was made.
      if (op.rect && [1, 3, 5, 6].includes(subtype)) this.m.FPDFAnnot_SetRect(annot, this.writeRect(scratch, this.pageRect(page, size, op.rect, scratch + 32)));
      this.setString(annot, 'M', pdfDateString(new Date().toISOString()));
      this.m.EPDFAnnot_GenerateAppearance(annot);
    } finally {
      this.free(scratch);
      this.m.FPDFPage_CloseAnnot(annot);
    }
  }

  private insertFile(op: Extract<EngineEditOp, { op: 'page.insertFile' }>): void {
    if (op.at > this.sizes.length) throw new EngineError('page', ENGINE_MESSAGES.page);
    let reader: BlockReader;
    try {
      reader = openReader(op.source);
    } catch {
      throw new EngineError('file', ENGINE_MESSAGES.file);
    }
    this.importReader = reader;
    const fa = this.access(reader, 1);
    let src = 0;
    let idx = 0;
    try {
      src = this.m.FPDF_LoadCustomDocument(fa, '');
      if (!src) throw new EngineError(this.m.FPDF_GetLastError() === FPDF_ERR.PASSWORD ? 'password' : 'format', 'That PDF could not be read, or it is protected with a password.');
      const count = this.m.FPDF_GetPageCount(src);
      const pages = op.pages?.length ? op.pages : Array.from({ length: count }, (_, k) => k);
      if (pages.some((p) => p < 0 || p >= count)) throw new EngineError('page', ENGINE_MESSAGES.page);
      idx = this.malloc(pages.length * 4);
      pages.forEach((p, k) => this.P.setValue(idx + k * 4, p, 'i32'));
      this.dropPages();
      if (!this.m.FPDF_ImportPagesByIndex(this.doc, src, idx, pages.length, op.at)) throw new EngineError('format', 'Those pages could not be inserted.');
    } finally {
      this.free(idx);
      if (src) this.m.FPDF_CloseDocument(src);
      this.free(fa);
      reader.close();
      this.importReader = null;
    }
  }

  private writeOut(doc: number): Uint8Array {
    const w = this.m.PDFiumExt_OpenFileWriter();
    if (!w) throw new EngineError('memory', ENGINE_MESSAGES.memory);
    let out = 0;
    try {
      if (!this.m.PDFiumExt_SaveAsCopy(doc, w)) throw new EngineError('unknown', 'The PDF could not be written.');
      const size = this.m.PDFiumExt_GetFileWriterSize(w);
      out = this.malloc(size);
      this.m.PDFiumExt_GetFileWriterData(w, out, size);
      return this.P.HEAPU8.slice(out, out + size);
    } finally {
      this.free(out);
      this.m.PDFiumExt_CloseFileWriter(w);
    }
  }

  async save(): Promise<Uint8Array> {
    if (!this.doc) throw new EngineError('unsupported', ENGINE_MESSAGES.unsupported);
    this.dropPages();
    const bytes = this.writeOut(this.doc);
    this.checkMemory();
    return bytes;
  }

  async extract(pages: number[]): Promise<Uint8Array> {
    if (!this.doc) throw new EngineError('unsupported', ENGINE_MESSAGES.unsupported);
    if (!pages.length) throw new EngineError('page', ENGINE_MESSAGES.page);
    for (const p of pages) this.pageSize(p);
    const out = this.m.FPDF_CreateNewDocument();
    if (!out) throw new EngineError('memory', ENGINE_MESSAGES.memory);
    const idx = this.malloc(pages.length * 4);
    try {
      pages.forEach((p, k) => this.P.setValue(idx + k * 4, p, 'i32'));
      if (!this.m.FPDF_ImportPagesByIndex(out, this.doc, idx, pages.length, 0)) throw new EngineError('unknown', 'Those pages could not be copied.');
      return this.writeOut(out);
    } finally {
      this.free(idx);
      this.m.FPDF_CloseDocument(out);
    }
  }

  async unload(): Promise<void> {
    this.release();
  }

  // ── close ──────────────────────────────────────────────────────────────

  private release(): void {
    for (const h of this.pages.values()) this.closePage(h);
    this.pages.clear();
    if (this.doc) this.m.FPDF_CloseDocument(this.doc);
    this.doc = 0;
    this.free(this.fileAccess);
    this.fileAccess = 0;
    this.reader?.close();
    this.reader = null;
    this.sizes = [];
  }

  async close(): Promise<void> {
    this.release();
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** An ISO time as a PDF date, in UTC: "D:20260929174200Z". */
export function pdfDateString(iso: string): string {
  const d = new Date(iso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`;
}

/** "D:20260929174200+05'30'" → an ISO date where it can be read; empty otherwise. */
export function pdfDate(s: string): string {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/.exec(s.trim());
  if (!m) return '';
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz] = m;
  const zone = !tz || tz === 'Z' ? 'Z' : `${tz.slice(0, 3)}:${tz.replace(/'/g, '').slice(3, 5) || '00'}`;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`;
  return Number.isNaN(Date.parse(iso)) ? '' : new Date(iso).toISOString();
}
