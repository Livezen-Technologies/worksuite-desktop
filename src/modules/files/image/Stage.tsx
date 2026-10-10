import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cx } from '../../../components/ui';
import type { RailTool } from './api';
import { contentSize, frameMargins, outputSize, turned, type OverlayObject, type Recipe, type Rect, type TextObject } from './recipe';
import { PreviewCache, type AssetLookup, type Drawable } from './render';
import { layoutText } from './text';

/**
 * The canvas (EDT-E-04's centre): the recipe drawn at preview size, and over it the handles — layers to select, move,
 * resize and turn, the crop box, the Area's picks, a redaction being drawn, a stroke being drawn — all in fractions
 * of the picture, so they match the drawing at any zoom.
 */

export interface StageProps {
  src: Drawable | null;
  /** The real picture's size (src may be a smaller proxy). */
  W: number;
  H: number;
  recipe: Recipe;
  /** What "before" shows (the opened picture), for Compare. */
  before: Recipe;
  compare: 'off' | 'peek' | 'split';
  tool: RailTool;
  assets: AssetLookup;
  assetsRev: number;
  zoom: number | 'fit';
  onFitScale: (s: number) => void;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onLive: (r: Recipe) => void;
  onSettle: () => void;
  /** The crop being chosen, in fractions of the straightened picture. */
  cropDraft: Rect | null;
  cropRatio: number | null;
  onCropDraft: (r: Rect) => void;
  showGrid: boolean;
  onAreaPick: (p: { x: number; y: number }, add: boolean) => void;
  onRedact: (r: Rect) => void;
  draw: { colour: string; width: number; highlighter: boolean; erase: boolean } | null;
  onStroke: (points: number[]) => void;
  onErase: (id: string) => void;
  editingText: string | null;
  onEditText: (id: string | null) => void;
  onDropFiles: (files: File[], at: { x: number; y: number }) => void;
  /** "Preview — not applied" (AI-03). */
  badge?: string | null;
  /** Suggested crops shown as frames (AI-05). */
  suggestions?: Rect[];
  onUseSuggestion?: (r: Rect) => void;
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

type Drag =
  | { kind: 'move'; start: { x: number; y: number }; from: Recipe; ids: string[] }
  | { kind: 'resize'; handle: Handle; start: { x: number; y: number }; from: Recipe; id: string }
  | { kind: 'rotate'; from: Recipe; id: string; centre: { x: number; y: number } }
  | { kind: 'crop'; handle: Handle | 'move' | 'new'; start: { x: number; y: number }; from: Rect }
  | { kind: 'redact'; start: { x: number; y: number }; now: { x: number; y: number } }
  | { kind: 'draw'; points: number[] };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measurer(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  return measureCtx;
}

/** A text layer's real height (its lines decide it), as a fraction of the picture. */
export function textHeight(o: TextObject, cw: number, ch: number): number {
  const ctx = measurer();
  if (!ctx || !cw || !ch) return o.h;
  return layoutText(o, o.w * cw, ch, ctx).height / ch;
}

export function Stage(p: StageProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const beforeCanvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const cache = useRef(new PreviewCache());
  const beforeCache = useRef(new PreviewCache());
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [split, setSplit] = useState(50);
  const [dropping, setDropping] = useState(false);

  const cropping = p.tool === 'crop';
  // While cropping, the whole straightened picture shows, without layers or frame, for the crop box to sit on.
  const shown: Recipe = useMemo(() => (cropping ? { ...p.recipe, crop: null, resize: null, frame: null, corners: 0, objects: [], watermark: null, redactions: [] } : p.recipe), [cropping, p.recipe]);
  const out = outputSize(p.W, p.H, shown);
  const content = contentSize(p.W, p.H, shown);
  const m = frameMargins(shown.frame);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setBox({ w: Math.max(100, el.clientWidth - 48), h: Math.max(100, el.clientHeight - 48) });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = Math.min(box.w / out.w, box.h / out.h, 4);
  const onFitScale = p.onFitScale;
  useEffect(() => onFitScale(fit), [fit, onFitScale]);
  const display = p.zoom === 'fit' ? fit : p.zoom;
  const dw = Math.max(1, Math.round(out.w * display));
  const dh = Math.max(1, Math.round(out.h * display));
  // Pixels drawn: as many as are shown (sharp on a high-density screen), never more than 2400 on the long edge.
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const scale = Math.min(1, (display * dpr * Math.max(out.w, out.h) > 2400 ? 2400 / Math.max(out.w, out.h) : display * dpr));

  useEffect(() => {
    const src = p.src;
    const el = canvas.current;
    if (!src || !el) return;
    const frame = requestAnimationFrame(() => {
      try {
        const c = cache.current.render(src, p.W, p.H, p.compare === 'peek' ? p.before : shown, scale, p.assets);
        el.width = c.width;
        el.height = c.height;
        el.getContext('2d')?.drawImage(c, 0, 0);
      } catch {
        /* a canvas this environment cannot draw */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [p.src, p.W, p.H, shown, scale, p.assets, p.assetsRev, p.compare, p.before]);

  useEffect(() => {
    const src = p.src;
    const el = beforeCanvas.current;
    if (!src || !el || p.compare !== 'split') return;
    const frame = requestAnimationFrame(() => {
      try {
        const c = beforeCache.current.render(src, p.W, p.H, p.before, (scale * Math.max(out.w, out.h)) / Math.max(outputSize(p.W, p.H, p.before).w, outputSize(p.W, p.H, p.before).h), p.assets);
        el.width = c.width;
        el.height = c.height;
        el.getContext('2d')?.drawImage(c, 0, 0);
      } catch {
        /* as above */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [p.src, p.W, p.H, p.before, p.compare, scale, out.w, out.h, p.assets]);

  /** A pointer's place as fractions of the content area (the picture without its frame). */
  const at = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const objects = p.recipe.objects;
  const selectable = !cropping && p.compare === 'off' && ['select', 'text', 'shapes', 'stickers', 'mark', 'ai'].includes(p.tool);
  const cw = content.w;
  const ch = content.h;
  const heightOf = (o: OverlayObject) => (o.kind === 'text' ? textHeight(o, cw, ch) : o.h);

  const startObject = (e: ReactPointerEvent, o: OverlayObject) => {
    if (!selectable) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    let ids = p.selected.includes(o.id) ? p.selected : add ? [...p.selected, o.id] : [o.id];
    if (add && p.selected.includes(o.id)) ids = p.selected.filter((x) => x !== o.id);
    // A group moves together.
    if (o.group) ids = [...new Set([...ids, ...objects.filter((x) => x.group === o.group).map((x) => x.id)])];
    p.onSelect(ids);
    if (o.locked || p.editingText === o.id) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ kind: 'move', start: at(e), from: p.recipe, ids: ids.filter((id) => !objects.find((x) => x.id === id)?.locked) });
  };

  const startHandle = (e: ReactPointerEvent, o: OverlayObject, h: Handle | 'rotate') => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (h === 'rotate') setDrag({ kind: 'rotate', from: p.recipe, id: o.id, centre: { x: o.x + o.w / 2, y: o.y + heightOf(o) / 2 } });
    else setDrag({ kind: 'resize', handle: h, start: at(e), from: p.recipe, id: o.id });
  };

  const cropRect = p.cropDraft ?? { x: 0, y: 0, w: 1, h: 1 };
  const t = turned(p.W, p.H, p.recipe.rotate);
  /** The ratio as fractions: w/h in fractions of a picture t.w × t.h. */
  const fracRatio = p.cropRatio ? (p.cropRatio * t.h) / t.w : null;

  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0 || p.compare !== 'off') return;
    const pt = at(e);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (cropping) setDrag({ kind: 'crop', handle: 'new', start: pt, from: cropRect });
    else if (p.tool === 'area') p.onAreaPick({ x: clamp01(pt.x), y: clamp01(pt.y) }, e.shiftKey);
    else if (p.tool === 'redact') setDrag({ kind: 'redact', start: pt, now: pt });
    else if (p.tool === 'draw' && p.draw && !p.draw.erase) setDrag({ kind: 'draw', points: [clamp01(pt.x), clamp01(pt.y)] });
    else {
      p.onSelect([]);
      p.onEditText(null);
    }
  };

  const move = (e: ReactPointerEvent) => {
    if (!drag) return;
    const pt = at(e);
    if (drag.kind === 'move') {
      const dx = pt.x - drag.start.x;
      const dy = pt.y - drag.start.y;
      p.onLive({ ...drag.from, objects: drag.from.objects.map((o) => (drag.ids.includes(o.id) ? moveBy(o, dx, dy) : o)) });
    } else if (drag.kind === 'resize') {
      p.onLive({ ...drag.from, objects: drag.from.objects.map((o) => (o.id === drag.id ? resizeBy(o, drag.handle, pt.x - drag.start.x, pt.y - drag.start.y, e.shiftKey, ch / cw) : o)) });
    } else if (drag.kind === 'rotate') {
      const deg = (Math.atan2((pt.y - drag.centre.y) * ch, (pt.x - drag.centre.x) * cw) * 180) / Math.PI + 90;
      const snapped = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
      p.onLive({ ...drag.from, objects: drag.from.objects.map((o) => (o.id === drag.id ? { ...o, rotation: ((snapped + 540) % 360) - 180 } : o)) });
    } else if (drag.kind === 'crop') {
      p.onCropDraft(cropBy(drag.from, drag.handle, drag.start, pt, fracRatio));
    } else if (drag.kind === 'redact') setDrag({ ...drag, now: pt });
    else if (drag.kind === 'draw') setDrag({ kind: 'draw', points: [...drag.points, clamp01(pt.x), clamp01(pt.y)] });
  };

  const up = () => {
    if (!drag) return;
    if (drag.kind === 'redact') {
      const r = norm(drag.start, drag.now);
      if (r.w > 0.005 && r.h > 0.005) p.onRedact(r);
    } else if (drag.kind === 'draw') {
      if (drag.points.length >= 4) p.onStroke(drag.points);
    } else if (drag.kind !== 'crop') p.onSettle();
    setDrag(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length) p.onDropFiles(files, at(e));
  };

  const pct = (v: number) => `${v * 100}%`;
  const area = { left: pct(m.l / out.w), top: pct(m.t / out.h), width: pct(content.w / out.w), height: pct(content.h / out.h) };
  const redactBox = drag?.kind === 'redact' ? norm(drag.start, drag.now) : null;
  const cursor = cropping ? 'cursor-crosshair' : p.tool === 'area' ? 'cursor-cell' : p.tool === 'redact' || p.tool === 'draw' ? 'cursor-crosshair' : '';

  return (
    <div
      ref={wrap}
      className={cx('relative flex min-h-0 min-w-0 flex-1 bg-[#0B1120] [background-image:radial-gradient(rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:18px_18px]', p.zoom === 'fit' ? 'items-center justify-center overflow-hidden' : 'overflow-auto')}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className={cx('relative shrink-0', p.zoom !== 'fit' && 'm-6')} style={{ width: dw, height: dh }}>
        <canvas ref={canvas} role="img" aria-label="The picture, with your edits" className={cx('block h-full w-full shadow-[0_18px_50px_rgba(0,0,0,.5)]', !p.src && 'invisible')} />
        {p.compare === 'split' ? (
          <>
            <canvas ref={beforeCanvas} aria-hidden className="pointer-events-none absolute inset-0 block h-full w-full" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
            <span className="pointer-events-none absolute top-2 left-2 rounded-[6px] bg-black/60 px-2 py-0.5 text-[11.5px] font-bold text-white">Before</span>
            <span className="pointer-events-none absolute top-2 right-2 rounded-[6px] bg-[#3B5BDB] px-2 py-0.5 text-[11.5px] font-bold text-white">After</span>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              aria-label="Before and after divider"
              onChange={(e) => setSplit(Number(e.target.value))}
              className="absolute inset-x-0 top-1/2 z-20 w-full -translate-y-1/2 cursor-ew-resize opacity-0"
            />
            <span className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white" style={{ left: `${split}%` }}>
              <span className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[13px] font-bold text-[#0F1B3D] shadow">⇆</span>
            </span>
          </>
        ) : null}
        {p.compare === 'peek' ? <span className="pointer-events-none absolute top-2 left-2 rounded-[6px] bg-black/60 px-2 py-0.5 text-[11.5px] font-bold text-white">Before</span> : null}
        {p.badge ? <span className="pointer-events-none absolute top-3 left-3 z-10 rounded-[8px] bg-[#C9D4FF] px-2.5 py-1 text-[12px] font-bold text-[#1B2980]">{p.badge}</span> : null}
        <div
          ref={overlay}
          data-testid="stage-overlay"
          className={cx('absolute touch-none select-none', cursor)}
          style={area}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          {p.showGrid || drag?.kind === 'crop' ? <Thirds /> : null}
          {cropping ? <CropBox r={cropRect} onHandle={(e, h) => (e.stopPropagation(), (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId), setDrag({ kind: 'crop', handle: h, start: at(e), from: cropRect }))} /> : null}
          {!cropping && p.compare === 'off'
            ? objects.map((o) => {
                if (o.hidden) return null;
                const h = heightOf(o);
                const on = p.selected.includes(o.id);
                const erasable = p.tool === 'draw' && !!p.draw?.erase && o.kind === 'shape' && o.shape === 'path';
                const editing = p.editingText === o.id && o.kind === 'text';
                return (
                  <div
                    key={o.id}
                    data-obj={o.id}
                    role="button"
                    tabIndex={-1}
                    aria-label={labelOf(o)}
                    aria-pressed={on}
                    onPointerDown={(e) => (erasable ? (e.stopPropagation(), p.onErase(o.id)) : startObject(e, o))}
                    onPointerMove={move}
                    onPointerUp={up}
                    onDoubleClick={() => o.kind === 'text' && !o.locked && p.onEditText(o.id)}
                    className={cx('absolute', selectable || erasable ? (o.locked ? 'cursor-not-allowed' : 'cursor-move') : 'pointer-events-none', on && 'outline-1 outline-dashed outline-white/90 [outline-offset:2px]')}
                    style={{ left: pct(o.x), top: pct(o.y), width: pct(o.w), height: pct(h), transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined }}
                  >
                    {on && p.selected.length === 1 && !o.locked && selectable && !editing ? (
                      <>
                        {(o.kind === 'text' ? (['e', 'w'] as Handle[]) : HANDLES).map((hd) => (
                          <span
                            key={hd}
                            aria-hidden
                            onPointerDown={(e) => startHandle(e, o, hd)}
                            onPointerMove={move}
                            onPointerUp={up}
                            className={cx('absolute h-2.5 w-2.5 rounded-[2px] border border-[#3B5BDB] bg-white', HANDLE_POS[hd])}
                          />
                        ))}
                        <span aria-hidden onPointerDown={(e) => startHandle(e, o, 'rotate')} onPointerMove={move} onPointerUp={up} className="absolute -top-7 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border-2 border-[#3B5BDB] bg-white" />
                      </>
                    ) : null}
                    {editing ? <TextEditor o={o as TextObject} ch={dh * (content.h / out.h)} onChange={(text) => p.onLive({ ...p.recipe, objects: objects.map((x) => (x.id === o.id ? { ...x, text } : x)) })} onDone={() => (p.onSettle(), p.onEditText(null))} /> : null}
                  </div>
                );
              })
            : null}
          {p.tool === 'area' && p.recipe.area
            ? p.recipe.area.seeds.map((s, i) => <span key={i} aria-hidden className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#3B5BDB]" style={{ left: pct(s.x), top: pct(s.y) }} />)
            : null}
          {redactBox ? <span aria-hidden className="pointer-events-none absolute bg-black/85 outline outline-1 outline-white" style={{ left: pct(redactBox.x), top: pct(redactBox.y), width: pct(redactBox.w), height: pct(redactBox.h) }} /> : null}
          {drag?.kind === 'draw' && p.draw ? (
            <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              <polyline points={pairs(drag.points)} fill="none" stroke={p.draw.colour} strokeOpacity={p.draw.highlighter ? 0.45 : 1} strokeWidth={Math.max(1, p.draw.width)} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
          {(p.suggestions ?? []).map((s, i) => (
            <button key={i} type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => p.onUseSuggestion?.(s)} className="absolute border-2 border-dashed border-white/90 text-left hover:bg-white/10" style={{ left: pct(s.x), top: pct(s.y), width: pct(s.w), height: pct(s.h) }}>
              <span className="m-1 inline-block rounded-[5px] bg-black/60 px-1.5 text-[11px] font-bold text-white">Suggested crop {i + 1}</span>
            </button>
          ))}
        </div>
      </div>
      {dropping ? (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-[14px] border-2 border-dashed border-[#7FA2FF] bg-[#3B5BDB]/15 text-[14px] font-bold text-white">Drop to place it as a layer</div>
      ) : null}
    </div>
  );
}

const HANDLE_POS: Record<Handle, string> = {
  nw: '-top-1.5 -left-1.5 cursor-nwse-resize',
  n: '-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize',
  ne: '-top-1.5 -right-1.5 cursor-nesw-resize',
  e: 'top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize',
  se: '-bottom-1.5 -right-1.5 cursor-nwse-resize',
  s: '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize',
  sw: '-bottom-1.5 -left-1.5 cursor-nesw-resize',
  w: 'top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize',
};

function pairs(points: number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push(`${points[i]! * 1000},${points[i + 1]! * 1000}`);
  return out.join(' ');
}

function norm(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = clamp01(Math.min(a.x, b.x));
  const y = clamp01(Math.min(a.y, b.y));
  return { x, y, w: clamp01(Math.max(a.x, b.x)) - x, h: clamp01(Math.max(a.y, b.y)) - y };
}

export function labelOf(o: OverlayObject): string {
  switch (o.kind) {
    case 'text':
      return `Text: ${o.text.slice(0, 40) || 'empty'}`;
    case 'shape':
      return o.shape === 'path' ? 'Drawing' : `Shape: ${o.shape}`;
    case 'sticker':
      return `Sticker: ${o.name ?? o.sticker ?? 'from the library'}`;
    case 'logo':
      return `Logo: ${o.name ?? 'from the library'}`;
    default:
      return `Picture: ${o.name ?? 'dropped in'}`;
  }
}

export function moveBy(o: OverlayObject, dx: number, dy: number): OverlayObject {
  const moved = { ...o, x: o.x + dx, y: o.y + dy };
  if (moved.kind === 'shape' && moved.points) return { ...moved, points: moved.points.map((v, i) => v + (i % 2 ? dy : dx)) };
  return moved;
}

/** A handle dragged by dx, dy (fractions). Stickers, logos and pictures keep their proportions; Shift keeps them for shapes. */
export function resizeBy(o: OverlayObject, h: Handle, dx: number, dy: number, shift: boolean, aspect: number): OverlayObject {
  let { x, y, w, h: hh } = o;
  if (h.includes('e')) w = Math.max(0.01, o.w + dx);
  if (h.includes('w')) {
    w = Math.max(0.01, o.w - dx);
    x = o.x + (o.w - w);
  }
  if (h.includes('s')) hh = Math.max(0.01, o.h + dy);
  if (h.includes('n')) {
    hh = Math.max(0.01, o.h - dy);
    y = o.y + (o.h - hh);
  }
  const keep = o.kind === 'sticker' || o.kind === 'logo' || o.kind === 'image' || (shift && o.kind === 'shape');
  if (keep && h.length === 2) {
    // The box's shape on screen (fractions differ by the picture's aspect) stays the same.
    const ratio = o.h / o.w;
    hh = w * ratio;
    if (h.includes('n')) y = o.y + (o.h - hh);
  }
  void aspect;
  if (o.kind === 'text') return { ...o, x, w };
  if (o.kind === 'shape' && o.points) {
    // A drawing scales its points with its box.
    const sx = w / o.w;
    const sy = hh / o.h;
    return { ...o, x, y, w, h: hh, points: o.points.map((v, i) => (i % 2 ? y + (v - o.y) * sy : x + (v - o.x) * sx)) };
  }
  return { ...o, x, y, w, h: hh };
}

/** The crop box dragged: by a handle, moved whole, or drawn new; held to a ratio when one is chosen. */
export function cropBy(from: Rect, handle: Handle | 'move' | 'new', start: { x: number; y: number }, now: { x: number; y: number }, ratio: number | null): Rect {
  const p = { x: clamp01(now.x), y: clamp01(now.y) };
  if (handle === 'move') {
    const x = Math.max(0, Math.min(1 - from.w, from.x + p.x - start.x));
    const y = Math.max(0, Math.min(1 - from.h, from.y + p.y - start.y));
    return { ...from, x, y };
  }
  let r: Rect;
  if (handle === 'new') r = norm(start, p);
  else {
    let x0 = from.x;
    let y0 = from.y;
    let x1 = from.x + from.w;
    let y1 = from.y + from.h;
    if (handle.includes('w')) x0 = Math.min(p.x, x1 - 0.02);
    if (handle.includes('e')) x1 = Math.max(p.x, x0 + 0.02);
    if (handle.includes('n')) y0 = Math.min(p.y, y1 - 0.02);
    if (handle.includes('s')) y1 = Math.max(p.y, y0 + 0.02);
    r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (ratio && r.w > 0 && r.h > 0) {
    if (r.w / r.h > ratio) r = { ...r, w: r.h * ratio };
    else r = { ...r, h: r.w / ratio };
    if (r.x + r.w > 1) r.w = 1 - r.x;
    if (r.y + r.h > 1) r.h = 1 - r.y;
    if (r.w / r.h > ratio) r.w = r.h * ratio;
    else r.h = r.w / ratio;
    // A box drawn up or left grows from the corner it started at.
    if (handle === 'new' && start.x > p.x) r.x = Math.max(0, start.x - r.w);
    if (handle === 'new' && start.y > p.y) r.y = Math.max(0, start.y - r.h);
  }
  return r;
}

function Thirds() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
      {[1, 2].map((i) => (
        <span key={`v${i}`} className="absolute inset-y-0 w-px bg-white/45" style={{ left: `${(i * 100) / 3}%` }} />
      ))}
      {[1, 2].map((i) => (
        <span key={`h${i}`} className="absolute inset-x-0 h-px bg-white/45" style={{ top: `${(i * 100) / 3}%` }} />
      ))}
    </span>
  );
}

function CropBox({ r, onHandle }: { r: Rect; onHandle: (e: ReactPointerEvent, h: Handle | 'move') => void }) {
  const pct = (v: number) => `${v * 100}%`;
  return (
    <div aria-label="Crop" role="group" className="absolute z-[2] border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,.5)]" style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}>
      <span aria-hidden className="absolute inset-0 cursor-move" onPointerDown={(e) => onHandle(e, 'move')} />
      <Thirds />
      {HANDLES.map((h) => (
        <span key={h} aria-hidden onPointerDown={(e) => onHandle(e, h)} className={cx('absolute z-[3] h-3 w-3 bg-white', HANDLE_POS[h])} />
      ))}
    </div>
  );
}

function TextEditor({ o, ch, onChange, onDone }: { o: TextObject; ch: number; onChange: (t: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const px = Math.max(10, (o.size / 1000) * ch);
  return (
    <textarea
      ref={ref}
      aria-label="Edit the text"
      value={o.text}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) onDone();
      }}
      className="absolute inset-0 z-10 resize-none overflow-hidden border border-[#7FA2FF] bg-black/40 p-0 text-white outline-none"
      style={{ fontFamily: `"${o.font}", "Noto Sans Sinhala", "Noto Sans Tamil", sans-serif`, fontSize: px, fontWeight: o.weight, fontStyle: o.italic ? 'italic' : 'normal', textAlign: o.align, lineHeight: o.lineHeight, minHeight: px * o.lineHeight }}
    />
  );
}
