import { apiUrl } from '../../core/api';
import { call } from '../../core/bridge';
import type { DriveFile } from './api';

/**
 * Covers — the first page of a PDF, Word, Excel or PowerPoint file — for Drive's grid, where the server has no
 * thumbnail (it makes them for pictures only). Drawn here, one at a time and only for cards on screen: PDFs by
 * pdf.js, presentations by BetterOffice's slide renderer, documents and workbooks by a hidden, read-only
 * BetterOffice editor whose first page is copied. Kept in PDF Studio's sealed thumbnail cache by file and version
 * (`pdf:coverGet` / `pdf:coverPut`), so each is drawn once.
 */
export type CoverKind = 'pdf' | 'docx' | 'xlsx' | 'pptx';

const MAX_BYTES = 25 * 1024 * 1024;
const WIDTH = 320;

export function coverKind(f: Pick<DriveFile, 'name' | 'extension' | 'size'>): CoverKind | null {
  if (f.size > MAX_BYTES) return null;
  const e = (f.extension || f.name.split('.').pop() || '').toLowerCase();
  return e === 'pdf' || e === 'docx' || e === 'xlsx' || e === 'pptx' ? e : null;
}

/** The cache's name for this version of the file. */
export function coverId(f: Pick<DriveFile, 'id' | 'version' | 'updated_at'>): string {
  const v = f.version ? `v${f.version}` : (f.updated_at ?? 'x').replace(/[^A-Za-z0-9:.-]/g, '').slice(0, 38) || 'x';
  return `drive:${f.id}:${v}`;
}

const urls = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

/** One cover at a time: drawing needs the page's canvas and, for Office files, an editor's worth of memory. */
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

async function bytesOf(fileId: number): Promise<Uint8Array> {
  const res = await fetch(apiUrl(`/api/files/${fileId}/download`));
  if (!res.ok) throw new Error(`download ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function jpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? void b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('no image'))), 'image/jpeg', 0.82),
  );
}

/** A picture (a canvas or an image) scaled to the cover's width on white, as a JPEG. */
async function fit(source: CanvasImageSource & { width: number; height: number }, crop?: { width: number; height: number }): Promise<Uint8Array> {
  const w = crop?.width ?? source.width;
  const h = crop?.height ?? source.height;
  const scale = WIDTH / Math.max(1, w);
  const c = document.createElement('canvas');
  c.width = WIDTH;
  c.height = Math.max(1, Math.round(Math.min(h, w * 1.42) * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, w, Math.min(h, w * 1.42), 0, 0, c.width, c.height);
  return jpeg(c);
}

/**
 * pdf.js uses `Map.prototype.getOrInsertComputed` (and `WeakMap`'s), which older Chromium builds lack; the
 * standard behaviour, added only where missing.
 */
function upsertPolyfill(): void {
  for (const C of [Map, WeakMap] as unknown as Array<{ prototype: Record<string, unknown> }>) {
    const proto = C.prototype as { has(k: unknown): boolean; get(k: unknown): unknown; set(k: unknown, v: unknown): unknown; getOrInsert?: unknown; getOrInsertComputed?: unknown };
    proto.getOrInsert ??= function (this: typeof proto, k: unknown, v: unknown) {
      if (!this.has(k)) this.set(k, v);
      return this.get(k);
    };
    proto.getOrInsertComputed ??= function (this: typeof proto, k: unknown, make: (k: unknown) => unknown) {
      if (!this.has(k)) this.set(k, make(k));
      return this.get(k);
    };
  }
}

async function pdfCover(bytes: Uint8Array): Promise<Uint8Array> {
  upsertPolyfill();
  const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  // The document's own scripts and forms never run.
  const doc = await lib.getDocument({ data: bytes, enableXfa: false, disableAutoFetch: true, useSystemFonts: true }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: (WIDTH * 1.5) / page.getViewport({ scale: 1 }).width });
    const c = document.createElement('canvas');
    c.width = Math.ceil(viewport.width);
    c.height = Math.ceil(viewport.height);
    await page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport }).promise;
    return fit(c);
  } finally {
    void doc.destroy();
  }
}

async function slidesCover(bytes: Uint8Array): Promise<Uint8Array> {
  const [{ prepareFile }, pptx] = await Promise.all([import('../office/better/BetterEditor'), import('@betteroffice/pptx')]);
  const prepared = await prepareFile(bytes, 'pptx');
  const handle = pptx.openPresentation(bytes, { fonts: prepared.fonts ?? [] });
  try {
    const png = await pptx.slideToPng(handle.layoutSlide(0));
    const img = await createImageBitmap(png);
    return fit(img);
  } finally {
    handle.dispose();
  }
}

/** Word and Excel: a hidden, read-only editor draws the first page; its largest canvas is copied. */
async function editorCover(bytes: Uint8Array, format: 'docx' | 'xlsx'): Promise<Uint8Array> {
  const [{ createElement }, { createRoot }, mod] = await Promise.all([import('react'), import('react-dom/client'), import('../office/better/BetterEditor')]);
  const prepared = await mod.prepareFile(bytes, format);
  const host = document.createElement('div');
  // On screen for the editor's own visibility checks, but unseen and out of reach: no clicks, no focus kept.
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:1200px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden;contain:strict';
  document.body.appendChild(host);
  const before = document.activeElement as HTMLElement | null;
  const root = createRoot(host);
  try {
    root.render(createElement(mod.default, { file: prepared, name: `cover.${format}`, readOnly: true, author: null, onSave: () => undefined, onChange: () => undefined, onError: () => undefined, onReady: () => undefined }));
    const deadline = Date.now() + 12_000;
    let best: HTMLCanvasElement | null = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      const canvases = [...host.querySelectorAll('canvas')].filter((c) => c.width > 200 && c.height > 200);
      best = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
      if (best && painted(best)) break;
    }
    if (!best) throw new Error('nothing drawn');
    const rect = best.getBoundingClientRect();
    // A document page: the canvas as drawn. A workbook: its top-left corner, about a page's worth.
    return fit(best, format === 'xlsx' ? { width: Math.min(best.width, Math.round((best.width / Math.max(1, rect.width)) * 700)), height: best.height } : undefined);
  } finally {
    root.unmount();
    host.remove();
    if (before && document.activeElement !== before && typeof before.focus === 'function') before.focus();
  }
}

/** Whether a canvas has anything on it yet (not all one colour at a few sample points). */
function painted(c: HTMLCanvasElement): boolean {
  try {
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    const pts = [0.3, 0.5, 0.7].flatMap((x) => [0.2, 0.4, 0.6].map((y) => ctx.getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.join(',')));
    return new Set(pts).size > 1;
  } catch {
    return true;
  }
}

async function draw(f: DriveFile, kind: CoverKind): Promise<Uint8Array> {
  const bytes = await bytesOf(f.id);
  if (kind === 'pdf') return pdfCover(bytes);
  if (kind === 'pptx') return slidesCover(bytes);
  return editorCover(bytes, kind);
}

/**
 * The cover's address (a `blob:` URL) for a Drive file, or null when it has none: from the sealed cache, else
 * drawn now and kept. A file that cannot be drawn is remembered as having none for this session.
 */
export function coverFor(f: DriveFile): Promise<string | null> {
  const kind = coverKind(f);
  if (!kind) return Promise.resolve(null);
  const id = coverId(f);
  const known = urls.get(id);
  if (known) return known;
  const made = (async () => {
    const cached = await call('pdf:coverGet', { id }).catch(() => null);
    if (cached) return URL.createObjectURL(new Blob([cached as BlobPart], { type: 'image/jpeg' }));
    const img = await inTurn(() => draw(f, kind)).catch(() => null);
    if (!img) return null;
    void call('pdf:coverPut', { id, jpeg: new Uint8Array(img) }).catch(() => undefined);
    return URL.createObjectURL(new Blob([img as BlobPart], { type: 'image/jpeg' }));
  })();
  urls.set(id, made);
  return made;
}
