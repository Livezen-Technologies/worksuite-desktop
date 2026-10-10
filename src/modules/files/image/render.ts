import { ADJUSTMENTS, contentSize, frameMargins, straightenScale, turned, type Adjustment, type FilterName, type FilterState, type OverlayObject, type Recipe, type Rect, type Shadow, type ShapeObject, type TextObject, type Watermark } from './recipe';
import { fontStack, layoutText } from './text';

/**
 * Drawing a recipe (Drive ENH-03): the same steps draw the preview, scaled down, and the saved picture, full size —
 * always from the untouched original, so nothing is lost between edits.
 *
 *   turn, flip, straighten, crop → adjustments and the filter at its strength (on the whole picture or the Area) →
 *   redactions (the pixels underneath are gone) → rounded corners → layers (text, shapes, stickers, logos, pictures)
 *   → watermark → frame.
 */
export type Drawable = CanvasImageSource & { width: number; height: number };

/** A library item or sticker picture: drawn when it has loaded; `missing` (no access, or gone) draws a grey block (CRT-34). */
export interface AssetLookup {
  get: (key: string) => Drawable | 'missing' | null;
}
export const NO_ASSETS: AssetLookup = { get: () => null };

export interface RenderOptions {
  /** Output pixels per picture pixel: 1 to save, less to preview. */
  scale: number;
  assets?: AssetLookup;
  doc?: Document;
  /** Leave the layers out (the before/after view and the Area tool draw without them). */
  noObjects?: boolean;
  /** Draws pixels in slices, saying how far it has got (the save's progress, EDT-E-13). */
  onProgress?: (fraction: number) => void;
}

/* ==================================================================== *
 * Filters and adjustments
 * ==================================================================== */

/** Each preset as adjustments; the six from before ENH-03 keep their exact values, so old recipes draw the same. */
export const FILTER_ADJUST: Record<FilterName, Partial<Record<Adjustment, number>>> = {
  none: {},
  mono: { saturation: -100 },
  sepia: {},
  warm: { temperature: 30, saturation: 8 },
  cool: { temperature: -30 },
  vivid: { saturation: 30, contrast: 12, vibrance: 20 },
  fade: { contrast: -25, brightness: 10, saturation: -15 },
  noir: { saturation: -100, contrast: 40, exposure: -10 },
  film: { contrast: -10, saturation: -12, temperature: 12, highlights: -15, shadows: 18 },
  dusk: { temperature: 18, tint: 16, saturation: 10, exposure: -12 },
};

/** The filter's adjustments at its strength. */
export function filterAdjust(f: FilterState): Partial<Record<Adjustment, number>> {
  const base = f.preset ? f.preset.adjust : FILTER_ADJUST[f.name];
  const k = f.strength / 100;
  const out: Partial<Record<Adjustment, number>> = {};
  for (const [a, v] of Object.entries(base) as Array<[Adjustment, number]>) out[a] = v * k;
  return out;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Every pixel through the adjustments (each −100..100) and, at `sepia` 0..1, the sepia tone. Mutates `data`. With
 * `mask`, only pixels whose mask byte is set change.
 */
export function adjustPixels(data: Uint8ClampedArray, adjust: Partial<Record<Adjustment, number>>, sepia = 0, mask?: Uint8Array | null, from = 0, to = data.length): void {
  const a = (k: Adjustment) => Math.max(-100, Math.min(100, adjust[k] ?? 0)) / 100;
  const exposure = Math.pow(2, a('exposure'));
  const bright = a('brightness') * 60;
  const c = a('contrast');
  const contrast = c >= 0 ? 1 + c * 1.5 : 1 + c;
  const hi = a('highlights') * 60;
  const sh = a('shadows') * 60;
  const sat = 1 + a('saturation');
  const vib = a('vibrance');
  const temp = a('temperature') * 40;
  const tint = a('tint') * 40;
  const gamma = Math.pow(2, -a('gamma'));
  const hue = a('hue') * Math.PI;
  const cos = Math.cos(hue);
  const sin = Math.sin(hue);
  const m = [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
  const turn = hue !== 0;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp(255 * Math.pow(i / 255, gamma));
  for (let p = from; p < to; p += 4) {
    if (mask && !mask[p >> 2]) continue;
    let r = data[p]! * exposure + bright;
    let g = data[p + 1]! * exposure + bright;
    let b = data[p + 2]! * exposure + bright;
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const lw = Math.max(0, Math.min(1, l / 255));
    const tone = hi * lw * lw + sh * (1 - lw) * (1 - lw);
    r += tone;
    g += tone;
    b += tone;
    const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let s = sat;
    if (vib) {
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const cur = mx > 0 ? (mx - mn) / mx : 0;
      s *= 1 + vib * (1 - cur);
    }
    r = grey + (r - grey) * s;
    g = grey + (g - grey) * s;
    b = grey + (b - grey) * s;
    r += temp;
    b -= temp;
    g -= tint;
    if (turn) {
      const nr = m[0]! * r + m[1]! * g + m[2]! * b;
      const ng = m[3]! * r + m[4]! * g + m[5]! * b;
      const nb = m[6]! * r + m[7]! * g + m[8]! * b;
      r = nr;
      g = ng;
      b = nb;
    }
    if (sepia > 0) {
      const nr = 0.393 * r + 0.769 * g + 0.189 * b;
      const ng = 0.349 * r + 0.686 * g + 0.168 * b;
      const nb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (nr - r) * sepia;
      g += (ng - g) * sepia;
      b += (nb - b) * sepia;
    }
    data[p] = lut[clamp(Math.round(r))]!;
    data[p + 1] = lut[clamp(Math.round(g))]!;
    data[p + 2] = lut[clamp(Math.round(b))]!;
  }
}

/** Sharpen (positive) or soften (negative) with a 3 × 3 kernel. */
export function sharpenPixels(data: Uint8ClampedArray, w: number, h: number, amount: number): void {
  if (!amount || w < 3 || h < 3) return;
  const k = amount / 100;
  const src = new Uint8ClampedArray(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const c = src[i + ch]!;
        const n = src[i - 4 + ch]! + src[i + 4 + ch]! + src[i - w * 4 + ch]! + src[i + w * 4 + ch]!;
        // Unsharp: the centre against its neighbours' mean, pushed apart (or pulled together for a negative amount).
        data[i + ch] = clamp(c + (c - n / 4) * (k > 0 ? k * 2 : k * 0.8));
      }
    }
  }
}

/**
 * The Area (EDT-E-07): pixels joined to a seed whose colour is within `tolerance` of the seed's, as a mask of the
 * picture `w` × `h` (one byte a pixel). Seeds are fractions of the picture.
 */
export function areaMask(data: Uint8ClampedArray, w: number, h: number, seeds: Array<{ x: number; y: number }>, tolerance: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const tol2 = tolerance * tolerance * 3;
  for (const s of seeds) {
    const sx = Math.max(0, Math.min(w - 1, Math.floor(s.x * w)));
    const sy = Math.max(0, Math.min(h - 1, Math.floor(s.y * h)));
    const si = (sy * w + sx) * 4;
    const r0 = data[si]!;
    const g0 = data[si + 1]!;
    const b0 = data[si + 2]!;
    let top = 0;
    stack[top++] = sy * w + sx;
    while (top > 0) {
      const p = stack[--top]!;
      if (mask[p]) continue;
      const q = p * 4;
      const dr = data[q]! - r0;
      const dg = data[q + 1]! - g0;
      const db = data[q + 2]! - b0;
      if (dr * dr + dg * dg + db * db > tol2) continue;
      mask[p] = 1;
      const x = p % w;
      if (x > 0 && !mask[p - 1]) stack[top++] = p - 1;
      if (x < w - 1 && !mask[p + 1]) stack[top++] = p + 1;
      if (p >= w && !mask[p - w]) stack[top++] = p - w;
      if (p < w * (h - 1) && !mask[p + w]) stack[top++] = p + w;
    }
  }
  return mask;
}

/** Whether the recipe changes any pixel's colour. */
export function changesPixels(r: Recipe): boolean {
  return r.filter.name !== 'none' || !!r.filter.preset || ADJUSTMENTS.some((a) => r.adjust[a] !== 0);
}

/* ==================================================================== *
 * The pipeline
 * ==================================================================== */

function newCanvas(doc: Document, w: number, h: number): HTMLCanvasElement {
  const c = doc.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Turn, flip, straighten and crop the picture onto a canvas the size of the (scaled) result. */
export function drawGeometry(src: Drawable, W: number, H: number, r: Recipe, scale: number, doc: Document = document): HTMLCanvasElement {
  const t = turned(W, H, r.rotate);
  const crop: Rect = r.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const content = contentSize(W, H, r);
  const canvas = newCanvas(doc, content.w * scale, content.h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.scale(canvas.width / (t.w * crop.w), canvas.height / (t.h * crop.h));
  ctx.translate(-crop.x * t.w, -crop.y * t.h);
  if (r.straighten && r.straighten_fill) {
    ctx.fillStyle = r.straighten_fill;
    ctx.fillRect(crop.x * t.w, crop.y * t.h, crop.w * t.w, crop.h * t.h);
  }
  ctx.translate(t.w / 2, t.h / 2);
  if (r.straighten) {
    ctx.rotate((r.straighten * Math.PI) / 180);
    if (!r.straighten_fill) {
      const s = straightenScale(t.w, t.h, r.straighten);
      ctx.scale(s, s);
    }
  }
  ctx.rotate((r.rotate * Math.PI) / 180);
  ctx.scale(r.flipH ? -1 : 1, r.flipV ? -1 : 1);
  ctx.drawImage(src, -W / 2, -H / 2, W, H);
  ctx.restore();
  return canvas;
}

/** Adjustments, the filter (whole picture or Area) and sharpness, on the canvas's own pixels. */
export function drawPixels(canvas: HTMLCanvasElement, r: Recipe, onProgress?: (f: number) => void): void {
  const sharp = r.adjust.sharpness ?? 0;
  if (!changesPixels(r)) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { sharpness: _s, ...manual } = r.adjust;
  const fa = filterAdjust(r.filter);
  const sepia = r.filter.name === 'sepia' && !r.filter.preset ? r.filter.strength / 100 : 0;
  const area = r.filter.scope === 'area' && r.area?.seeds.length ? areaMask(d.data, canvas.width, canvas.height, r.area.seeds, r.area.tolerance) : null;
  const slices = onProgress ? 8 : 1;
  const step = Math.ceil(d.data.length / 4 / slices) * 4;
  for (let i = 0; i < slices; i++) {
    const from = i * step;
    const to = Math.min(d.data.length, from + step);
    if (area) {
      // The sliders everywhere; the filter on top, only inside the Area.
      adjustPixels(d.data, manual, 0, null, from, to);
      adjustPixels(d.data, fa, sepia, area, from, to);
    } else {
      // One pass, the filter's adjustments added to the sliders' — exactly as recipes before ENH-03 drew.
      const sum: Partial<Record<Adjustment, number>> = { ...manual };
      for (const [k, v] of Object.entries(fa) as Array<[Adjustment, number]>) sum[k] = (sum[k] ?? 0) + v;
      adjustPixels(d.data, sum, sepia, null, from, to);
    }
    onProgress?.((i + 1) / slices);
  }
  if (sharp) sharpenPixels(d.data, canvas.width, canvas.height, sharp);
  ctx.putImageData(d, 0, 0);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexAlpha(colour: string, opacity: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour);
  if (!m) return colour;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, opacity))})`;
}

function applyShadow(ctx: CanvasRenderingContext2D, s: Shadow | undefined, unit: number): void {
  if (!s?.on) return;
  ctx.shadowColor = hexAlpha(s.colour, s.opacity / 100);
  ctx.shadowBlur = s.blur * unit;
  ctx.shadowOffsetX = s.dx * unit;
  ctx.shadowOffsetY = s.dy * unit;
}

/** The object's box in pixels on a picture cw × ch. */
export function boxOf(o: { x: number; y: number; w: number; h: number }, cw: number, ch: number): { x: number; y: number; w: number; h: number } {
  return { x: o.x * cw, y: o.y * ch, w: o.w * cw, h: o.h * ch };
}

export const stickerKey = (o: { sticker: string | null; colour: string; outline: { on: boolean; width: number; colour: string }; asset?: { file_id: number; version: number } | null; vector: boolean }) =>
  o.sticker ? `builtin:${o.sticker}:${o.colour}:${o.outline.on ? `${o.outline.width}:${o.outline.colour}` : '-'}` : `asset:${o.asset?.file_id}:${o.asset?.version}${o.vector ? `:${o.colour}` : ''}`;
export const assetKeyOf = (a: { file_id: number; version: number } | null | undefined) => (a ? `asset:${a.file_id}:${a.version}` : '');

function drawMissing(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }): void {
  ctx.save();
  ctx.fillStyle = 'rgba(128,128,140,.55)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.lineWidth = Math.max(1, Math.min(b.w, b.h) / 40);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}

function starPath(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }): void {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.4 : 1;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + (Math.cos(a) * b.w * r) / 2;
    const y = cy + (Math.sin(a) * b.h * r) / 2;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function shapePath(ctx: CanvasRenderingContext2D, o: ShapeObject, b: { x: number; y: number; w: number; h: number }, unit: number): void {
  switch (o.shape) {
    case 'rect':
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      return;
    case 'roundrect':
      roundRectPath(ctx, b.x, b.y, b.w, b.h, Math.max(1, o.radius * unit));
      return;
    case 'pill':
      roundRectPath(ctx, b.x, b.y, b.w, b.h, Math.min(b.w, b.h) / 2);
      return;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.abs(b.w / 2), Math.abs(b.h / 2), 0, 0, Math.PI * 2);
      return;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(b.x + b.w / 2, b.y);
      ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.lineTo(b.x, b.y + b.h);
      ctx.closePath();
      return;
    case 'star':
      starPath(ctx, b);
      return;
    case 'bubble': {
      const tail = b.h * 0.22;
      const body = b.h - tail;
      roundRectPath(ctx, b.x, b.y, b.w, body, Math.min(b.w, body) * 0.22);
      ctx.moveTo(b.x + b.w * 0.22, b.y + body - 1);
      ctx.lineTo(b.x + b.w * 0.18, b.y + b.h);
      ctx.lineTo(b.x + b.w * 0.42, b.y + body - 1);
      ctx.closePath();
      return;
    }
    default:
      ctx.beginPath();
  }
}

function drawShape(ctx: CanvasRenderingContext2D, o: ShapeObject, cw: number, ch: number, unit: number): void {
  const b = boxOf(o, cw, ch);
  const lw = Math.max(0.5, o.stroke.width * unit);
  ctx.lineWidth = lw;
  ctx.strokeStyle = o.stroke.colour;
  ctx.setLineDash(o.stroke.dash === 'dashed' ? [lw * 3, lw * 2] : o.stroke.dash === 'dotted' ? [lw * 0.1, lw * 2] : []);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (o.shape === 'path' && o.points && o.points.length >= 4) {
    ctx.beginPath();
    ctx.moveTo(o.points[0]! * cw, o.points[1]! * ch);
    for (let i = 2; i < o.points.length; i += 2) ctx.lineTo(o.points[i]! * cw, o.points[i + 1]! * ch);
    if (o.highlighter) ctx.globalCompositeOperation = 'multiply';
    ctx.stroke();
    return;
  }
  if (o.shape === 'line' || o.shape === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.h);
    ctx.lineTo(b.x + b.w, b.y);
    ctx.stroke();
    if (o.shape === 'arrow') {
      const ang = Math.atan2(-b.h, b.w);
      const head = Math.max(lw * 3.5, 8 * unit);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(b.x + b.w, b.y);
      ctx.lineTo(b.x + b.w - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
      ctx.moveTo(b.x + b.w, b.y);
      ctx.lineTo(b.x + b.w - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
      ctx.stroke();
    }
    return;
  }
  shapePath(ctx, o, b, unit);
  if (o.fill.style === 'filled' || o.fill.style === 'gradient') {
    if (o.fill.style === 'gradient') {
      const a = (o.fill.angle * Math.PI) / 180;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const r = Math.hypot(b.w, b.h) / 2;
      const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.addColorStop(0, o.fill.colour);
      g.addColorStop(1, o.fill.colour2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = o.fill.colour;
    ctx.fill();
    if (o.stroke.width > 0 && o.fill.style === 'filled' && o.stroke.colour !== o.fill.colour) {
      ctx.shadowColor = 'transparent';
      ctx.stroke();
    }
  } else ctx.stroke();
}

/** A text layer: its pill, then its outline, then its letters. */
export function drawText(ctx: CanvasRenderingContext2D, o: TextObject, cw: number, ch: number): void {
  const b = boxOf(o, cw, ch);
  const lay = layoutText(o, b.w, ch, ctx);
  const unit = ch / 1000;
  ctx.textBaseline = 'top';
  ctx.textAlign = o.align;
  const pad = o.pill.on ? o.pill.padding * unit : 0;
  const x = o.align === 'left' ? b.x + pad : o.align === 'center' ? b.x + b.w / 2 : b.x + b.w - pad;
  if (o.pill.on) {
    ctx.save();
    applyShadow(ctx, o.shadow, unit);
    ctx.fillStyle = o.pill.colour;
    const pw = lay.width + pad * 2;
    const px = o.align === 'left' ? b.x : o.align === 'center' ? b.x + (b.w - pw) / 2 : b.x + b.w - pw;
    roundRectPath(ctx, px, b.y, pw, lay.height, o.pill.radius * unit);
    ctx.fill();
    ctx.restore();
  }
  lay.lines.forEach((line, i) => {
    const y = b.y + pad + i * lay.lineHeightPx + (lay.lineHeightPx - lay.fontPx) / 2;
    if (o.outline.on && o.outline.width > 0) {
      ctx.save();
      if (!o.pill.on) applyShadow(ctx, o.shadow, unit);
      ctx.lineWidth = o.outline.width * unit * 2;
      ctx.strokeStyle = o.outline.colour;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, x, y);
      ctx.restore();
    }
    ctx.save();
    if (!o.pill.on && !(o.outline.on && o.outline.width > 0)) applyShadow(ctx, o.shadow, unit);
    ctx.fillStyle = o.colour;
    ctx.fillText(line, x, y);
    ctx.restore();
  });
}

export function drawObject(ctx: CanvasRenderingContext2D, o: OverlayObject, cw: number, ch: number, assets: AssetLookup): void {
  if (o.hidden) return;
  const unit = ch / 1000;
  const b = boxOf(o, cw, ch);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, o.opacity));
  if (o.rotation) {
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.rotate((o.rotation * Math.PI) / 180);
    ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
  }
  if (o.kind === 'text') drawText(ctx, o, cw, ch);
  else if (o.kind === 'shape') {
    applyShadow(ctx, o.shadow, unit);
    drawShape(ctx, o, cw, ch, unit);
  } else {
    const key = o.kind === 'sticker' ? stickerKey(o) : o.kind === 'image' && o.data ? `data:${o.id}` : assetKeyOf(o.asset);
    const pic = assets.get(key);
    if (pic === 'missing') drawMissing(ctx, b);
    else if (pic) {
      applyShadow(ctx, o.shadow, unit);
      ctx.drawImage(pic, b.x, b.y, b.w, b.h);
    }
  }
  ctx.restore();
}

/** The watermark: text or a logo, at one of nine places, or tiled across (CRT-50). */
export function drawWatermark(ctx: CanvasRenderingContext2D, wm: Watermark, cw: number, ch: number, assets: AssetLookup): void {
  if (!(wm.kind === 'text' ? wm.text : wm.asset)) return;
  ctx.save();
  ctx.globalAlpha = wm.opacity / 100;
  let size = Math.max(6, Math.round((Math.min(cw, ch) * wm.size) / 200));
  const logo = wm.kind === 'logo' ? assets.get(assetKeyOf(wm.asset)) : null;
  const logoBox = (s: number) => {
    const pic = logo && logo !== 'missing' ? logo : null;
    const w = pic ? (s * 2 * pic.width) / Math.max(1, pic.height) : s * 2;
    return { w, h: s * 2, pic };
  };
  if (wm.kind === 'text') {
    ctx.font = `700 ${size}px ${fontStack('Plus Jakarta Sans')}`;
    const room = cw - size * 1.6;
    const wide = ctx.measureText(wm.text).width;
    if (!wm.tile && wide > room && room > 0) {
      size = Math.max(6, Math.floor((size * room) / wide));
      ctx.font = `700 ${size}px ${fontStack('Plus Jakarta Sans')}`;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = size / 6;
  }
  const one = (x: number, y: number, align: CanvasTextAlign, base: CanvasTextBaseline) => {
    if (wm.kind === 'text') {
      ctx.textAlign = align;
      ctx.textBaseline = base;
      ctx.fillText(wm.text, x, y);
      return;
    }
    const lb = logoBox(size);
    const lx = align === 'left' ? x : align === 'center' ? x - lb.w / 2 : x - lb.w;
    const ly = base === 'top' ? y : base === 'middle' ? y - lb.h / 2 : y - lb.h;
    if (lb.pic) ctx.drawImage(lb.pic, lx, ly, lb.w, lb.h);
    else if (logo === 'missing') drawMissing(ctx, { x: lx, y: ly, w: lb.w, h: lb.h });
  };
  if (wm.tile) {
    const stepX = wm.kind === 'text' ? ctx.measureText(wm.text).width + size * 3 : logoBox(size).w + size * 3;
    const stepY = size * 4;
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(-Math.PI / 8);
    ctx.translate(-cw / 2, -ch / 2);
    for (let y = -ch; y < ch * 2; y += stepY) for (let x = -cw; x < cw * 2; x += Math.max(8, stepX)) one(x, y, 'left', 'top');
  } else {
    const col = wm.pos % 3;
    const row = Math.floor(wm.pos / 3);
    const pad = size * 0.8;
    one(col === 0 ? pad : col === 1 ? cw / 2 : cw - pad, row === 0 ? pad : row === 1 ? ch / 2 : ch - pad, col === 0 ? 'left' : col === 1 ? 'center' : 'right', row === 0 ? 'top' : row === 1 ? 'middle' : 'bottom');
  }
  ctx.restore();
}

/** The frame around the picture (CRT-40): a new, larger canvas. */
export function drawFrame(content: HTMLCanvasElement, r: Recipe, scale: number, assets: AssetLookup, doc: Document = document): HTMLCanvasElement {
  const f = r.frame;
  const m = frameMargins(f);
  if (!f || (!m.l && !m.t && !m.r && !m.b)) return content;
  const l = m.l * scale;
  const t = m.t * scale;
  const out = newCanvas(doc, content.width + (m.l + m.r) * scale, content.height + (m.t + m.b) * scale);
  const ctx = out.getContext('2d')!;
  const W = out.width;
  const H = out.height;
  if (f.preset === 'shadow') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = Math.max(2, m.l * scale * 0.6);
    ctx.shadowOffsetY = Math.max(1, m.l * scale * 0.2);
    ctx.fillStyle = '#000';
    ctx.fillRect(l, t, content.width, content.height);
    ctx.restore();
  } else if (f.preset === 'library') {
    const pic = assets.get(assetKeyOf(f.asset));
    if (pic && pic !== 'missing') nineSlice(ctx, pic, W, H, Math.max(l, t));
    else {
      ctx.fillStyle = pic === 'missing' ? 'rgba(128,128,140,.55)' : f.colour;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    ctx.fillStyle = f.colour;
    ctx.fillRect(0, 0, W, H);
    if (f.preset === 'film') {
      // Sprocket holes along the top and bottom.
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      const hole = Math.max(2, t * 0.32);
      for (let x = hole; x < W - hole; x += hole * 2.6) {
        roundRectPath(ctx, x, (t - hole) / 2, hole * 1.3, hole, hole * 0.2);
        ctx.fill();
        roundRectPath(ctx, x, H - (t + hole) / 2, hole * 1.3, hole, hole * 0.2);
        ctx.fill();
      }
    }
    if (f.preset === 'brand') {
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = Math.max(1, l * 0.08);
      ctx.strokeRect(l * 0.45, t * 0.45, W - l * 0.9, H - t * 0.9);
    }
  }
  ctx.drawImage(content, l, t);
  if (f.preset === 'polaroid' && f.caption) {
    const size = Math.max(6, m.b * scale * 0.32);
    ctx.fillStyle = '#3A3530';
    ctx.font = `italic 400 ${size}px ${fontStack('Georgia')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.caption, W / 2, t + content.height + (H - t - content.height) / 2, W - l * 2);
  }
  return out;
}

/** A frame picture stretched by its middle, its corners kept (9-slice). */
function nineSlice(ctx: CanvasRenderingContext2D, pic: Drawable, W: number, H: number, edge: number): void {
  const pw = pic.width;
  const ph = pic.height;
  const s = Math.min(pw, ph) / 3;
  const e = Math.max(1, edge);
  const sx = [0, s, pw - s, pw];
  const sy = [0, s, ph - s, ph];
  const dx = [0, e, W - e, W];
  const dy = [0, e, H - e, H];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ctx.drawImage(pic, sx[i]!, sy[j]!, sx[i + 1]! - sx[i]!, sy[j + 1]! - sy[j]!, dx[i]!, dy[j]!, dx[i + 1]! - dx[i]!, dy[j + 1]! - dy[j]!);
}

/** The whole recipe, drawn. `W` × `H` is the real picture's size; `src` may be a smaller proxy of it. */
export function renderRecipe(src: Drawable, W: number, H: number, r: Recipe, opts: RenderOptions): HTMLCanvasElement {
  const doc = opts.doc ?? document;
  const assets = opts.assets ?? NO_ASSETS;
  const canvas = drawGeometry(src, W, H, r, opts.scale, doc);
  drawPixels(canvas, r, opts.onProgress);
  const ctx = canvas.getContext('2d')!;
  const cw = canvas.width;
  const ch = canvas.height;
  if (r.redactions.length) {
    ctx.save();
    ctx.fillStyle = '#000000';
    for (const x of r.redactions) ctx.fillRect(Math.floor(x.x * cw), Math.floor(x.y * ch), Math.ceil(x.w * cw) + 1, Math.ceil(x.h * ch) + 1);
    ctx.restore();
  }
  if (r.corners > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    roundRectPath(ctx, 0, 0, cw, ch, r.corners * opts.scale);
    ctx.fill();
    ctx.restore();
    if (r.corners_fill) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = r.corners_fill;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
  }
  if (!opts.noObjects) {
    for (const o of r.objects) drawObject(ctx, o, cw, ch, assets);
    if (r.watermark) drawWatermark(ctx, r.watermark, cw, ch, assets);
  }
  return drawFrame(canvas, r, opts.scale, assets, doc);
}

/** Pixels per picture pixel for a preview at most `max` pixels on its long edge. */
export function previewScale(W: number, H: number, r: Recipe, max: number): number {
  const c = contentSize(W, H, r);
  const m = frameMargins(r.frame);
  return Math.min(1, max / Math.max(c.w + m.l + m.r, c.h + m.t + m.b));
}

/** The keys of every picture a recipe draws (to load before saving). */
export function assetKeys(r: Recipe): string[] {
  const out: string[] = [];
  for (const o of r.objects) {
    if (o.kind === 'sticker') out.push(stickerKey(o));
    else if (o.kind === 'image' && o.data) out.push(`data:${o.id}`);
    else if ((o.kind === 'logo' || o.kind === 'image') && o.asset) out.push(assetKeyOf(o.asset));
  }
  if (r.watermark?.kind === 'logo' && r.watermark.asset) out.push(assetKeyOf(r.watermark.asset));
  if (r.frame?.preset === 'library' && r.frame.asset) out.push(assetKeyOf(r.frame.asset));
  return [...new Set(out)];
}

/**
 * The preview, quickly: the picture's pixels (turned, cropped, adjusted, filtered — the slow part) are kept while
 * only layers move, and drawn again only when something that changes them does (NFR-03).
 */
export class PreviewCache {
  private key = '';
  private raster: HTMLCanvasElement | null = null;

  render(src: Drawable, W: number, H: number, r: Recipe, scale: number, assets: AssetLookup, opts: { noObjects?: boolean; doc?: Document } = {}): HTMLCanvasElement {
    const doc = opts.doc ?? document;
    const key = JSON.stringify([src.width, src.height, W, H, scale, r.rotate, r.flipH, r.flipV, r.straighten, r.straighten_fill, r.crop, r.adjust, r.filter, r.area, r.resize, r.redactions, r.corners, r.corners_fill]);
    if (key !== this.key || !this.raster) {
      const bare: Recipe = { ...r, objects: [], watermark: null, frame: null };
      this.raster = renderRecipe(src, W, H, bare, { scale, doc, noObjects: true });
      this.key = key;
    }
    const out = newCanvas(doc, this.raster.width, this.raster.height);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(this.raster, 0, 0);
    if (!opts.noObjects) {
      for (const o of r.objects) drawObject(ctx, o, out.width, out.height, assets);
      if (r.watermark) drawWatermark(ctx, r.watermark, out.width, out.height, assets);
    }
    return drawFrame(out, r, scale, assets, doc);
  }

  clear(): void {
    this.key = '';
    this.raster = null;
  }
}
