/**
 * The image editor's pipeline, as plain functions over a canvas so it can be
 * tested: turn and flip, crop, resize, adjust the pixels, apply a look, and
 * stamp a watermark. The same recipe draws the preview (scaled down) and the
 * saved file (full size).
 */
export const ADJUSTMENTS = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'saturation', 'vibrance', 'temperature', 'tint', 'hue', 'gamma'] as const;
export type Adjustment = (typeof ADJUSTMENTS)[number];
export const LOOKS = ['none', 'mono', 'sepia', 'warm', 'cool', 'vivid', 'fade'] as const;
export type Look = (typeof LOOKS)[number];

export interface Recipe {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** Fractions of the turned image: 0..1. */
  crop: { x: number; y: number; w: number; h: number } | null;
  adjust: Record<Adjustment, number>;
  look: Look;
  watermark: { text: string; pos: number; opacity: number; size: number } | null;
  /** The output size in pixels; null keeps the (cropped) size. */
  resize: { w: number; h: number } | null;
}

export const BLANK: Recipe = {
  rotate: 0,
  flipH: false,
  flipV: false,
  crop: null,
  adjust: Object.fromEntries(ADJUSTMENTS.map((a) => [a, 0])) as Record<Adjustment, number>,
  look: 'none',
  watermark: null,
  resize: null,
};

export function isBlank(r: Recipe): boolean {
  return JSON.stringify(r) === JSON.stringify(BLANK);
}

/** What the recipe changes, in words: the version's note. */
export function summary(r: Recipe): string {
  const out: string[] = [];
  if (r.rotate) out.push(`turned ${r.rotate}°`);
  if (r.flipH || r.flipV) out.push('flipped');
  if (r.crop) out.push('cropped');
  const changed = ADJUSTMENTS.filter((a) => r.adjust[a] !== 0);
  if (changed.length) out.push(`adjusted ${changed.join(', ')}`);
  if (r.look !== 'none') out.push(`${r.look} look`);
  if (r.watermark?.text) out.push('watermarked');
  if (r.resize) out.push(`resized to ${r.resize.w} × ${r.resize.h}`);
  return out.length ? `Edited: ${out.join('; ')}` : 'Edited';
}

/** The turned size of an image. */
export function turned(w: number, h: number, rotate: number): { w: number; h: number } {
  return rotate === 90 || rotate === 270 ? { w: h, h: w } : { w, h };
}

/** The size the recipe produces. */
export function outputSize(w: number, h: number, r: Recipe): { w: number; h: number } {
  if (r.resize) return r.resize;
  const t = turned(w, h, r.rotate);
  return r.crop ? { w: Math.max(1, Math.round(t.w * r.crop.w)), h: Math.max(1, Math.round(t.h * r.crop.h)) } : t;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** The look's adjustments, added to the sliders'. */
function lookAdjust(look: Look): Partial<Record<Adjustment, number>> {
  switch (look) {
    case 'mono':
      return { saturation: -100 };
    case 'warm':
      return { temperature: 30, saturation: 8 };
    case 'cool':
      return { temperature: -30 };
    case 'vivid':
      return { saturation: 30, contrast: 12, vibrance: 20 };
    case 'fade':
      return { contrast: -25, brightness: 10, saturation: -15 };
    default:
      return {};
  }
}

/** Every pixel through the adjustments (each -100..100) and the look. Mutates `data`. */
export function adjustPixels(data: Uint8ClampedArray, adjust: Record<Adjustment, number>, look: Look): void {
  const extra = lookAdjust(look);
  const a = (k: Adjustment) => Math.max(-100, Math.min(100, (adjust[k] ?? 0) + (extra[k] ?? 0))) / 100;
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
  // Hue turned about the grey axis (the standard luminance-preserving matrix).
  const m = [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
  const turn = hue !== 0;
  const sepia = look === 'sepia';
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp(255 * Math.pow(i / 255, gamma));
  for (let p = 0; p < data.length; p += 4) {
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
    if (sepia) {
      const nr = 0.393 * r + 0.769 * g + 0.189 * b;
      const ng = 0.349 * r + 0.686 * g + 0.168 * b;
      const nb = 0.272 * r + 0.534 * g + 0.131 * b;
      r = nr;
      g = ng;
      b = nb;
    }
    data[p] = lut[clamp(Math.round(r))]!;
    data[p + 1] = lut[clamp(Math.round(g))]!;
    data[p + 2] = lut[clamp(Math.round(b))]!;
  }
}

type Source = CanvasImageSource & { width: number; height: number };

/**
 * Draw the recipe. `scale` shrinks the result (the preview); the saved file
 * uses 1. Returns a new canvas.
 */
export function render(img: Source, r: Recipe, scale = 1, doc: Document = document): HTMLCanvasElement {
  const w = img.width;
  const h = img.height;
  const t = turned(w, h, r.rotate);
  const crop = r.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const out = outputSize(w, h, r);
  const ow = Math.max(1, Math.round(out.w * scale));
  const oh = Math.max(1, Math.round(out.h * scale));
  const canvas = doc.createElement('canvas');
  canvas.width = ow;
  canvas.height = oh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  // Map the crop of the turned image onto the whole output.
  const sx = ow / (t.w * crop.w);
  const sy = oh / (t.h * crop.h);
  ctx.save();
  ctx.scale(sx, sy);
  ctx.translate(-crop.x * t.w, -crop.y * t.h);
  // Turn and flip about the turned image's centre.
  ctx.translate(t.w / 2, t.h / 2);
  ctx.rotate((r.rotate * Math.PI) / 180);
  ctx.scale(r.flipH ? -1 : 1, r.flipV ? -1 : 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
  const anything = r.look !== 'none' || ADJUSTMENTS.some((a) => r.adjust[a] !== 0);
  if (anything) {
    const d = ctx.getImageData(0, 0, ow, oh);
    adjustPixels(d.data, r.adjust, r.look);
    ctx.putImageData(d, 0, 0);
  }
  if (r.watermark?.text) {
    const wm = r.watermark;
    let size = Math.max(8, Math.round((Math.min(ow, oh) * wm.size) / 200));
    ctx.save();
    ctx.globalAlpha = wm.opacity / 100;
    ctx.font = `700 ${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
    // Never wider than the picture: a long text is made smaller to fit.
    const room = ow - size * 1.6;
    const wide = ctx.measureText(wm.text).width;
    if (wide > room && room > 0) {
      size = Math.max(6, Math.floor((size * room) / wide));
      ctx.font = `700 ${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = size / 6;
    const col = wm.pos % 3;
    const row = Math.floor(wm.pos / 3);
    ctx.textAlign = col === 0 ? 'left' : col === 1 ? 'center' : 'right';
    ctx.textBaseline = row === 0 ? 'top' : row === 1 ? 'middle' : 'bottom';
    const pad = size * 0.8;
    ctx.fillText(wm.text, col === 0 ? pad : col === 1 ? ow / 2 : ow - pad, row === 0 ? pad : row === 1 ? oh / 2 : oh - pad);
    ctx.restore();
  }
  return canvas;
}

/** The type a saved image keeps: its own where the browser can write it. */
export function outputType(ext: string): { mime: 'image/png' | 'image/jpeg' | 'image/webp'; ext: string } {
  if (ext === 'jpg' || ext === 'jpeg') return { mime: 'image/jpeg', ext };
  if (ext === 'webp') return { mime: 'image/webp', ext };
  return { mime: 'image/png', ext: 'png' };
}
