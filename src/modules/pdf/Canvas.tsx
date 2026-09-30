import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CSS_PER_POINT, type PdfBitmap, type PdfLinkView, type PdfPageSize, type PdfRect, type PdfSearchHit, type PdfViewMode } from '@shared/pdf';
import { call } from '../../core/bridge';
import { cx } from '../../components/ui';
import { paint, ticket } from './client';
import { currentPage, layoutPages, PREVIEW_WIDTH, tilesFor, visiblePages, WHOLE_PAGE_PIXELS, type Layout, type PlacedPage, type Tile } from './layout';

/**
 * The page canvas (§6.1, §6.2): only pages in view (plus one screen either
 * way) exist in the DOM; each is first drawn small and blurry, then sharp
 * once scrolling and zooming settle, and in tiles when a sharp page would be
 * too large to draw at once (high zoom, engineering drawings). A page that
 * leaves the view cancels whatever it was still waiting for (PDF-VIEW-014).
 */
export interface Jump {
  page: number;
  /** Points from the page's top, for a search hit or an outline entry. */
  y?: number;
  n: number;
}

export interface CanvasProps {
  session: string;
  pages: PdfPageSize[];
  zoom: number;
  mode: PdfViewMode;
  /** The page single and two-page modes show; kept in step by `onPage` in continuous modes. */
  page: number;
  /** `annotate`: the page overlay (annotation tools) takes the pointer; links and the hand are off. */
  tool: 'select' | 'hand' | 'annotate';
  hits: PdfSearchHit[];
  activeHit: PdfSearchHit | null;
  jump: Jump | null;
  onPage: (page: number) => void;
  onZoom: (zoom: number) => void;
  onLink: (page: number, link: PdfLinkView) => void;
  onViewport?: (w: number, h: number) => void;
  presentation?: boolean;
  /** Goes up with every edit: pages are drawn again (the old image stays until the new one arrives). */
  revision?: number;
  /** Drawn over each page (annotations, the tool being used), in CSS pixels; `k` is CSS pixels per point. */
  overlay?: (page: number, k: number) => ReactNode;
}

/** Render requests with tickets: those no longer wanted are cancelled together, a frame later. */
class Requests {
  private pending = new Set<string>();
  private dropping = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly session: string) {}

  render(args: { page: number; scale: number; tile?: Tile; thumbnail?: false }): { ticket: string; done: Promise<PdfBitmap> } {
    const t = ticket();
    this.pending.add(t);
    const done = call('pdf:render', { session: this.session, page: args.page, scale: args.scale, ...(args.tile ? { tile: args.tile } : {}), ticket: t }).finally(() => this.pending.delete(t));
    return { ticket: t, done };
  }

  cancel(tickets: string[]): void {
    for (const t of tickets) if (this.pending.has(t)) this.dropping.add(t);
    if (!this.dropping.size || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const list = [...this.dropping].filter((t) => this.pending.has(t));
      this.dropping.clear();
      if (list.length) void call('pdf:cancel', { session: this.session, tickets: list }).catch(() => undefined);
    }, 16);
  }
}

const quantize = (s: number) => Math.round(s * 1000) / 1000;
const EMPTY_LINKS = new Map<number, PdfLinkView[]>();
const noop = () => undefined;

function BitmapCanvas({ bitmap, style }: { bitmap: PdfBitmap; style: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void paint(ref.current, bitmap).catch(noop);
  }, [bitmap]);
  return <canvas ref={ref} aria-hidden="true" style={{ position: 'absolute', ...style }} />;
}

interface PageProps {
  revision: number;
  requests: Requests;
  placed: PlacedPage;
  size: PdfPageSize;
  zoom: number;
  dpr: number;
  settled: boolean;
  /** The part of the page on screen, in CSS pixels from its top-left corner. */
  visible: { x: number; y: number; w: number; h: number };
  children?: ReactNode;
}

function PageView({ revision, requests, placed, size, zoom, dpr, settled, visible, children }: PageProps) {
  const target = quantize(zoom * CSS_PER_POINT * dpr);
  const previewScale = quantize(Math.min(target, PREVIEW_WIDTH / Math.max(1, size[0])));
  const tiled = Math.round(size[0] * target) * Math.round(size[1] * target) > WHOLE_PAGE_PIXELS;
  const [preview, setPreview] = useState<PdfBitmap | null>(null);
  const [sharp, setSharp] = useState<{ scale: number; rev: number; bmp: PdfBitmap } | null>(null);
  const [tiles, setTiles] = useState<Array<{ key: string; scale: number; tile: Tile; bmp: PdfBitmap }>>([]);
  const have = useRef(new Set<string>());

  // The quick first image (PDF-VIEW-011), as soon as the page is in view.
  useEffect(() => {
    let live = true;
    const r = requests.render({ page: placed.index, scale: previewScale });
    r.done.then((b) => live && setPreview(b), noop);
    return () => {
      live = false;
      requests.cancel([r.ticket]);
    };
  }, [requests, placed.index, previewScale, revision]);

  // The sharp page, once the view has settled.
  const sharpScale = sharp?.scale ?? 0;
  const sharpRev = sharp?.rev ?? -1;
  useEffect(() => {
    if (!settled || tiled || (sharpScale === target && sharpRev === revision) || previewScale >= target) return;
    let live = true;
    const r = requests.render({ page: placed.index, scale: target });
    r.done.then((bmp) => live && setSharp({ scale: target, rev: revision, bmp }), noop);
    return () => {
      live = false;
      requests.cancel([r.ticket]);
    };
  }, [requests, placed.index, settled, tiled, target, sharpScale, sharpRev, previewScale, revision]);

  // Tiles of the part on screen, when the page is too large to draw whole (PDF-VIEW-012).
  const wanted = useMemo(() => (tiled && settled ? tilesFor(size, target, dpr, visible) : []), [tiled, settled, size, target, dpr, visible]);
  const wantKey = wanted.map((t) => `${t.x},${t.y}`).join('|');
  useEffect(() => {
    if (!wanted.length) return;
    let live = true;
    const tickets: string[] = [];
    for (const tile of wanted) {
      const key = `${target}:${revision}:${tile.x},${tile.y}`;
      if (have.current.has(key)) continue;
      const r = requests.render({ page: placed.index, scale: target, tile });
      tickets.push(r.ticket);
      r.done.then((bmp) => {
        if (!live) return;
        have.current.add(key);
        setTiles((prev) => [...prev.filter((p) => p.scale === target && p.key !== key), { key, scale: target, tile, bmp }].slice(-48));
      }, noop);
    }
    return () => {
      live = false;
      requests.cancel(tickets);
    };
    // `wantKey` names the tiles; `wanted` itself is a new array each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, placed.index, target, wantKey, revision]);

  // A new zoom or an edit forgets the old tiles (the preview covers the gap until the new ones arrive).
  useEffect(() => {
    have.current = new Set([...have.current].filter((k) => k.startsWith(`${target}:${revision}:`)));
  }, [target, revision]);

  const k = zoom * CSS_PER_POINT;
  const whole: CSSProperties = { left: 0, top: 0, width: placed.w, height: placed.h };
  return (
    <div data-page={placed.index} className="absolute overflow-hidden bg-white shadow-[0_1px_4px_rgba(0,0,0,0.25)]" style={{ left: placed.x, top: placed.y, width: placed.w, height: placed.h }}>
      {preview ? <BitmapCanvas bitmap={preview} style={whole} /> : null}
      {/* An edit's new preview replaces an older sharp image: until the new sharp one arrives, the preview shows the change. */}
      {!tiled && sharp && (sharp.rev === revision || !preview) ? <BitmapCanvas bitmap={sharp.bmp} style={whole} /> : null}
      {tiled
        ? tiles
            .filter((t) => t.scale === target)
            .map((t) => <BitmapCanvas key={t.key} bitmap={t.bmp} style={{ left: (t.tile.x / t.scale) * k, top: (t.tile.y / t.scale) * k, width: (t.tile.w / t.scale) * k, height: (t.tile.h / t.scale) * k }} />)
        : null}
      {children}
    </div>
  );
}

function rectStyle(r: PdfRect, k: number): CSSProperties {
  return { left: r[0] * k, top: r[1] * k, width: Math.max(2, r[2] * k), height: Math.max(2, r[3] * k) };
}

export function PdfCanvas({ session, pages, zoom, mode, page, tool, hits, activeHit, jump, onPage, onZoom, onLink, onViewport, presentation, revision = 0, overlay }: CanvasProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  // Scrolling and zooming count as motion; the view has settled once none has happened for a moment.
  const [motion, setMotion] = useState(0);
  const [quiet, setQuiet] = useState(0);
  const settled = motion === quiet;
  const [dpr, setDpr] = useState(() => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
  // Links of the pages read so far, for the document as it was at `rev` (pages moved, turned or went: read again).
  const [linkState, setLinks] = useState<{ rev: number; map: Map<number, PdfLinkView[]> }>(() => ({ rev: revision, map: new Map() }));
  const links = linkState.rev === revision ? linkState.map : EMPTY_LINKS;
  const requests = useMemo(() => new Requests(session), [session]);
  const reported = useRef(-1);
  const last = useRef<{ layout: Layout; zoom: number; mode: PdfViewMode } | null>(null);
  const drag = useRef<{ x: number; y: number; top: number; left: number } | null>(null);

  const layout = useMemo(() => layoutPages(pages, zoom, mode, box.w, page), [pages, zoom, mode, box.w, page]);
  const continuous = mode === 'continuous' || mode === 'two-page-continuous';
  const shown = useMemo(() => visiblePages(layout, scroll.top, box.h, box.h), [layout, scroll.top, box.h]);
  const placed = useMemo(() => new Map(layout.pages.map((p) => [p.index, p])), [layout]);

  useEffect(() => {
    const t = setTimeout(() => setQuiet(motion), 140);
    return () => clearTimeout(t);
  }, [motion]);

  // A new zoom is motion too.
  const [seenZoom, setSeenZoom] = useState(zoom);
  if (seenZoom !== zoom) {
    setSeenZoom(zoom);
    setMotion(motion + 1);
  }

  // The view's size, and the screen's pixel density (a window moved to another screen).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      setBox({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
      setDpr(window.devicePixelRatio || 1);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  useEffect(() => {
    onViewport?.(box.w, box.h);
  }, [box.w, box.h, onViewport]);

  // A new zoom or view mode keeps the point in the middle of the view where it was: found in the old layout, placed in the new.
  useLayoutEffect(() => {
    const el = scroller.current;
    const prev = last.current;
    last.current = { layout, zoom, mode };
    if (!el || !prev || (prev.zoom === zoom && prev.mode === mode)) return;
    const cx0 = el.scrollLeft + el.clientWidth / 2;
    const cy0 = el.scrollTop + el.clientHeight / 2;
    const p = prev.layout.pages.find((x) => cy0 >= x.y - 8 && cy0 <= x.y + x.h + 8) ?? prev.layout.pages.find((x) => x.index === page);
    const q = p ? layout.pages.find((x) => x.index === p.index) : undefined;
    if (!p || !q) return;
    el.scrollTop = Math.max(0, q.y + ((cy0 - p.y) / p.h) * q.h - el.clientHeight / 2);
    el.scrollLeft = Math.max(0, q.x + ((cx0 - p.x) / p.w) * q.w - el.clientWidth / 2);
  }, [layout, zoom, mode, page]);

  // Presenting: the keys go to the pages at once (arrows, Page Up/Down, Home, End).
  useEffect(() => {
    if (presentation) scroller.current?.focus();
  }, [presentation]);

  // One page (or spread) at a time: a new page starts at its top.
  useEffect(() => {
    if (!continuous && scroller.current) scroller.current.scrollTop = 0;
  }, [page, continuous]);

  // Jumps: a page from the status bar, the outline, a search hit.
  useEffect(() => {
    const el = scroller.current;
    if (!jump || !el) return;
    const p = layoutPages(pages, zoom, mode, el.clientWidth || box.w, jump.page).pages.find((x) => x.index === jump.page);
    if (!p) return;
    const k = zoom * CSS_PER_POINT;
    const y = jump.y !== undefined ? p.y + jump.y * k - el.clientHeight / 3 : p.y - 12;
    el.scrollTop = Math.max(0, y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.n]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setScroll({ top: el.scrollTop, left: el.scrollLeft });
    setMotion((m) => m + 1);
    if (continuous) {
      const cur = currentPage(layout, el.scrollTop, el.clientHeight);
      if (cur !== reported.current) {
        reported.current = cur;
        onPage(cur);
      }
    }
  };

  // Links of the pages on screen, once they settle (read from the document by the main process).
  useEffect(() => {
    if (!settled) return;
    const missing = shown.filter((i) => !links.has(i)).slice(0, 12);
    if (!missing.length) return;
    let live = true;
    void Promise.all(missing.map((i) => call('pdf:links', { session, page: i }).then((l) => [i, l] as const, () => [i, [] as PdfLinkView[]] as const))).then((got) => {
      if (!live) return;
      setLinks((prev) => {
        const next = new Map(prev.rev === revision ? prev.map : undefined);
        for (const [i, l] of got) next.set(i, l);
        return { rev: revision, map: next };
      });
    });
    return () => {
      live = false;
    };
  }, [settled, shown, links, session, revision]);

  // Ctrl/⌘ + wheel zooms the page, not the app (a listener that may cancel the wheel: React's are passive).
  const wheelZoom = useRef({ zoom, onZoom });
  useEffect(() => {
    wheelZoom.current = { zoom, onZoom };
  });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const { zoom: z, onZoom: set } = wheelZoom.current;
      set(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = scroller.current;
    if (!el) return;
    const last = pages.length - 1;
    const step = mode === 'two-page' || mode === 'two-page-continuous' ? 2 : 1;
    if (e.key === 'Home') onPage(0);
    else if (e.key === 'End') onPage(last);
    else if (!continuous && (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey))) onPage(Math.min(last, page + step));
    else if (!continuous && (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey))) onPage(Math.max(0, page - step));
    else return;
    e.preventDefault();
  };

  const k = zoom * CSS_PER_POINT;
  const byPage = useMemo(() => {
    const m = new Map<number, PdfSearchHit[]>();
    for (const h of hits) if (h.source !== 'bookmark') m.set(h.page, [...(m.get(h.page) ?? []), h]);
    return m;
  }, [hits]);

  return (
    <div
      ref={scroller}
      role="document"
      aria-label="PDF pages"
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (tool !== 'hand' || !scroller.current) return;
        drag.current = { x: e.clientX, y: e.clientY, top: scroller.current.scrollTop, left: scroller.current.scrollLeft };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const el = scroller.current;
        if (!d || !el) return;
        el.scrollTop = d.top - (e.clientY - d.y);
        el.scrollLeft = d.left - (e.clientX - d.x);
      }}
      onPointerUp={() => (drag.current = null)}
      className={cx('relative min-h-0 flex-1 overflow-auto outline-none scroll-thin', presentation ? 'bg-black' : 'bg-[#E4E7EE] dark:bg-[#1B2233]', tool === 'hand' ? 'cursor-grab active:cursor-grabbing' : '')}
    >
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        {shown.map((i) => {
          const p = placed.get(i);
          if (!p) return null;
          const visible = { x: Math.max(0, scroll.left - p.x), y: Math.max(0, scroll.top - p.y), w: box.w, h: box.h };
          return (
            <PageView key={i} revision={revision} requests={requests} placed={p} size={pages[i]!} zoom={zoom} dpr={dpr} settled={settled} visible={visible}>
              {(byPage.get(i) ?? []).map((h, n) =>
                h.rects.map((r, m) => (
                  <span key={`${n}-${m}`} aria-hidden="true" className={cx('pointer-events-none absolute rounded-[2px] mix-blend-multiply', h === activeHit ? 'bg-[#FF9F1C]/70 ring-2 ring-[#E8590C]' : 'bg-[#FFE066]/60')} style={rectStyle(r, k)} />
                )),
              )}
              {tool === 'select'
                ? (links.get(i) ?? []).map((l) => (
                    <button
                      key={l.index}
                      type="button"
                      aria-label={l.kind === 'page' ? `Go to page ${(l.page ?? 0) + 1}` : l.kind === 'uri' ? `Link to ${l.uri ?? 'a web page'}` : 'Blocked link'}
                      title={l.kind === 'page' ? `Page ${(l.page ?? 0) + 1}` : l.kind === 'uri' ? (l.uri ?? '') : 'This link would start another program; it is blocked.'}
                      onClick={() => onLink(i, l)}
                      className={cx('absolute cursor-pointer rounded-[2px] hover:bg-primary/10', l.kind !== 'page' && l.kind !== 'uri' && 'cursor-not-allowed hover:bg-danger/10')}
                      style={rectStyle(l.rect, k)}
                    />
                  ))
                : null}
              {overlay?.(i, k)}
            </PageView>
          );
        })}
      </div>
    </div>
  );
}
