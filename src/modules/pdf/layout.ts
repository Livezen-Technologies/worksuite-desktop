import { CSS_PER_POINT, TILE_SIZE, clampZoom, type PdfPageSize, type PdfViewMode } from '@shared/pdf';

/**
 * Where each page sits in the scroller, in CSS pixels, for a view mode and
 * zoom (PDF-VIEW-001/002) — and which pages and tiles are on screen
 * (PDF-VIEW-010/012). Pure, so a 2,000-page layout is tested without a
 * browser: nothing here touches the DOM.
 */
export interface PlacedPage {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  pages: PlacedPage[];
  /** Rows in order of `y`: one page each, or a spread of two. */
  rows: Array<{ y: number; h: number; pages: number[] }>;
  width: number;
  height: number;
  /** Which pages this layout shows at all (single and two-page modes show one row). */
  shown: number[];
}

export const GAP = 16;
export const PAD = 24;

/** Pages as rows: one each, or spreads of two (1–2, 3–4 …). */
export function rowsOf(count: number, mode: PdfViewMode): number[][] {
  const rows: number[][] = [];
  const two = mode === 'two-page' || mode === 'two-page-continuous';
  for (let i = 0; i < count; i += two ? 2 : 1) rows.push(two && i + 1 < count ? [i, i + 1] : [i]);
  return rows;
}

export function rowOfPage(page: number, mode: PdfViewMode): number {
  return mode === 'two-page' || mode === 'two-page-continuous' ? Math.floor(page / 2) : page;
}

export function layoutPages(sizes: PdfPageSize[], zoom: number, mode: PdfViewMode, viewportW: number, current = 0): Layout {
  const k = clampZoom(zoom) * CSS_PER_POINT;
  const all = rowsOf(sizes.length, mode);
  const continuous = mode === 'continuous' || mode === 'two-page-continuous';
  const cur = Math.min(Math.max(0, rowOfPage(current, mode)), Math.max(0, all.length - 1));
  const rows = continuous ? all : all.length ? [all[cur]!] : [];
  let widest = 0;
  for (const r of rows) {
    const w = r.reduce((n, i) => n + sizes[i]![0] * k, 0) + GAP * (r.length - 1);
    if (w > widest) widest = w;
  }
  const width = Math.max(viewportW, widest + PAD * 2);
  const pages: PlacedPage[] = [];
  const outRows: Layout['rows'] = [];
  let y = PAD;
  for (const r of rows) {
    const h = Math.max(...r.map((i) => sizes[i]![1] * k));
    const w = r.reduce((n, i) => n + sizes[i]![0] * k, 0) + GAP * (r.length - 1);
    let x = (width - w) / 2;
    for (const i of r) {
      const [pw, ph] = sizes[i]!;
      pages.push({ index: i, x, y: y + (h - ph * k) / 2, w: pw * k, h: ph * k });
      x += pw * k + GAP;
    }
    outRows.push({ y, h, pages: r });
    y += h + GAP;
  }
  return { pages, rows: outRows, width, height: y - GAP + PAD, shown: rows.flat() };
}

/** Rows (and so pages) that meet the band [top − overscan, top + height + overscan]; a binary search, not a scan. */
export function visiblePages(layout: Layout, top: number, height: number, overscan = 0): number[] {
  const rows = layout.rows;
  const from = top - overscan;
  const to = top + height + overscan;
  let lo = 0;
  let hi = rows.length - 1;
  let first = rows.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.y + rows[mid]!.h >= from) {
      first = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  const out: number[] = [];
  for (let r = first; r < rows.length && rows[r]!.y <= to; r++) out.push(...rows[r]!.pages);
  return out;
}

/** The page that holds the middle of the view — the one the status bar names. */
export function currentPage(layout: Layout, top: number, height: number): number {
  const mid = top + height / 3;
  const vis = visiblePages(layout, top, height);
  if (!vis.length) return layout.shown[0] ?? 0;
  const pos = new Map(layout.pages.map((p) => [p.index, p]));
  for (const i of vis) {
    const p = pos.get(i)!;
    if (p.y <= mid && p.y + p.h >= mid) return i;
  }
  return vis[0]!;
}

/** The zoom that fits a page (or a spread) to the view's width, or wholly inside it (PDF-VIEW-002). */
export function fitZoom(sizes: PdfPageSize[], page: number, mode: PdfViewMode, viewportW: number, viewportH: number, fit: 'width' | 'page'): number {
  if (!sizes.length) return 1;
  const row = rowsOf(sizes.length, mode)[rowOfPage(Math.min(page, sizes.length - 1), mode)] ?? [0];
  const w = row.reduce((n, i) => n + sizes[i]![0], 0) * CSS_PER_POINT + GAP * (row.length - 1);
  const h = Math.max(...row.map((i) => sizes[i]![1])) * CSS_PER_POINT;
  const zw = (viewportW - PAD * 2) / w;
  const zh = (viewportH - PAD * 2) / h;
  return clampZoom(Math.floor((fit === 'width' ? zw : Math.min(zw, zh)) * 1000) / 1000);
}

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The device-pixel tiles of a page drawn at `scale` (device px per point)
 * that meet the visible part of it. `visible` is in CSS pixels relative to
 * the page's top-left corner.
 */
export function tilesFor(size: PdfPageSize, scale: number, dpr: number, visible: { x: number; y: number; w: number; h: number }): Tile[] {
  const fullW = Math.max(1, Math.round(size[0] * scale));
  const fullH = Math.max(1, Math.round(size[1] * scale));
  const x0 = Math.max(0, Math.floor((visible.x * dpr) / TILE_SIZE));
  const y0 = Math.max(0, Math.floor((visible.y * dpr) / TILE_SIZE));
  const x1 = Math.min(Math.ceil(fullW / TILE_SIZE) - 1, Math.floor(((visible.x + visible.w) * dpr) / TILE_SIZE));
  const y1 = Math.min(Math.ceil(fullH / TILE_SIZE) - 1, Math.floor(((visible.y + visible.h) * dpr) / TILE_SIZE));
  const out: Tile[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const x = tx * TILE_SIZE;
      const y = ty * TILE_SIZE;
      out.push({ x, y, w: Math.min(TILE_SIZE, fullW - x), h: Math.min(TILE_SIZE, fullH - y) });
    }
  }
  return out;
}

/** Whole pages up to this many device pixels are drawn in one piece; larger ones in tiles. */
export const WHOLE_PAGE_PIXELS = 4 * 1024 * 1024;

/** A quick, blurry first image of a page (PDF-VIEW-011): at most this wide in device pixels. */
export const PREVIEW_WIDTH = 400;
