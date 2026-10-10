/**
 * The image editor's recipe, schema 2 (Drive ENH-03 SRS §14.2): everything done to a picture, in a form that can be
 * reapplied, saved with every version so reopening it brings back the crop, the filter at its strength, the text with
 * its styles, the stickers and the frame — all still editable.
 *
 * Positions and sizes of objects are fractions of the picture (or, for lengths like a font size, thousandths of its
 * height), so a recipe draws the same at preview size and at full size, and survives a resize.
 *
 * Schema 1 is what this app's editor saved before ENH-03 (no `schema` field; a bare `look`). It opens unchanged — its
 * look becomes a filter at 100% — and saves as schema 2. A recipe from the web editor's Fabric engine (`v: 1`) cannot
 * be redrawn here; it is recognised and the version opens as a flat picture, with a note.
 */
export const ADJUSTMENTS = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'saturation', 'vibrance', 'temperature', 'tint', 'hue', 'gamma', 'sharpness'] as const;
export type Adjustment = (typeof ADJUSTMENTS)[number];

export const FILTERS = ['none', 'vivid', 'warm', 'cool', 'mono', 'noir', 'fade', 'film', 'dusk', 'sepia'] as const;
export type FilterName = (typeof FILTERS)[number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AssetRef {
  file_id: number;
  version: number;
}

export interface Shadow {
  on: boolean;
  blur: number;
  dx: number;
  dy: number;
  colour: string;
  opacity: number;
}

interface ObjectBase {
  id: string;
  /** Fractions of the picture (before any frame). For text, `h` is worked out from its lines. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, about the object's centre. */
  rotation: number;
  /** 0..1 */
  opacity: number;
  hidden?: boolean;
  locked?: boolean;
  group?: string | null;
  style_preset?: string | null;
  asset?: AssetRef | null;
}

export interface TextObject extends ObjectBase {
  kind: 'text';
  text: string;
  font: string;
  /** Thousandths of the picture's height. */
  size: number;
  weight: number;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  colour: string;
  /** Em. */
  letterSpacing: number;
  lineHeight: number;
  uppercase?: boolean;
  shadow: Shadow;
  outline: { on: boolean; width: number; colour: string };
  pill: { on: boolean; padding: number; radius: number; colour: string };
}

export type ShapeKind = 'rect' | 'roundrect' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'pill' | 'star' | 'bubble' | 'path';

export interface ShapeObject extends ObjectBase {
  kind: 'shape';
  shape: ShapeKind;
  fill: { style: 'filled' | 'outline' | 'gradient'; colour: string; colour2: string; angle: number };
  /** Width in thousandths of the picture's height. */
  stroke: { width: number; colour: string; dash: 'solid' | 'dashed' | 'dotted' };
  radius: number;
  /** A drawn stroke (Draw): x,y pairs as fractions of the picture. */
  points?: number[];
  highlighter?: boolean;
  shadow?: Shadow;
}

export interface StickerObject extends ObjectBase {
  kind: 'sticker';
  /** A built-in sticker's id; null for one from a library (then `asset`). */
  sticker: string | null;
  vector: boolean;
  colour: string;
  outline: { on: boolean; width: number; colour: string };
  shadow: Shadow;
  name?: string;
}

export interface LogoObject extends ObjectBase {
  kind: 'logo';
  shadow: Shadow;
  name?: string;
  vector?: boolean;
}

export interface ImageObject extends ObjectBase {
  kind: 'image';
  /** A picture dropped in from this computer, kept in the recipe (downscaled). */
  data: string | null;
  shadow: Shadow;
  name?: string;
}

export type OverlayObject = TextObject | ShapeObject | StickerObject | LogoObject | ImageObject;

export const FRAME_PRESETS = ['none', 'thin', 'polaroid', 'film', 'shadow', 'brand', 'library'] as const;
export type FramePreset = (typeof FRAME_PRESETS)[number];

export interface Frame {
  preset: FramePreset;
  /** Output pixels, 0..200. */
  size: number;
  colour: string;
  caption?: string;
  asset?: AssetRef | null;
}

export interface Watermark {
  kind: 'text' | 'logo';
  text: string;
  asset?: AssetRef | null;
  /** 0..8, left to right, top to bottom. */
  pos: number;
  opacity: number;
  /** Size, 5..80. */
  size: number;
  tile: boolean;
  preset_id?: number | null;
}

export interface FilterState {
  name: FilterName;
  /** 0..100: how much of the preset. */
  strength: number;
  scope: 'image' | 'area';
  /** An organization's look (SET-06): its own adjustments, kept here so the recipe stands alone. */
  preset?: { id: number | string; name: string; adjust: Partial<Record<Adjustment, number>> } | null;
}

export interface AiStep {
  action: string;
  provider: string | null;
  at: string;
  summary?: string;
}

export interface Recipe {
  schema: 2;
  /** The version this edit was made on: reopening redraws it on those pixels. */
  base_version: number | null;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** Degrees, −45..45. */
  straighten: number;
  /** Null: the picture is enlarged so no empty corners show. A colour: the corners are filled with it. */
  straighten_fill: string | null;
  /** Fractions of the straightened picture. */
  crop: Rect | null;
  crop_ratio: string | null;
  adjust: Record<Adjustment, number>;
  filter: FilterState;
  /** Area (magic wand): where a click picked colours, and how near a colour counts. */
  area: { seeds: Array<{ x: number; y: number }>; tolerance: number } | null;
  resize: { w: number; h: number } | null;
  /** Output pixels, 0..200. */
  corners: number;
  corners_fill: string | null;
  frame: Frame | null;
  watermark: Watermark | null;
  /** Fractions of the picture: blacked out for good when saved. */
  redactions: Rect[];
  objects: OverlayObject[];
  ai_steps: AiStep[];
  /** Present only on a recipe autosaved without a version (EDT-E-10). */
  draft?: { saved_at: string };
}

export const NO_SHADOW: Shadow = { on: false, blur: 14, dx: 0, dy: 4, colour: '#000000', opacity: 40 };

export function blankRecipe(baseVersion: number | null = null): Recipe {
  return {
    schema: 2,
    base_version: baseVersion,
    rotate: 0,
    flipH: false,
    flipV: false,
    straighten: 0,
    straighten_fill: null,
    crop: null,
    crop_ratio: null,
    adjust: Object.fromEntries(ADJUSTMENTS.map((a) => [a, 0])) as Record<Adjustment, number>,
    filter: { name: 'none', strength: 100, scope: 'image', preset: null },
    area: null,
    resize: null,
    corners: 0,
    corners_fill: null,
    frame: null,
    watermark: null,
    redactions: [],
    objects: [],
    ai_steps: [],
  };
}

/** Nothing changed from the opened picture (the base version stamp aside). */
export function isBlank(r: Recipe): boolean {
  const { base_version: _b, draft: _d, ai_steps: _a, ...rest } = r;
  const { base_version: _b2, ai_steps: _a2, ...blank } = blankRecipe();
  return JSON.stringify(rest) === JSON.stringify(blank);
}

/* ==================================================================== *
 * Reading a stored recipe
 * ==================================================================== */

export type Parsed =
  | { kind: 'ok'; recipe: Recipe; schema: 1 | 2 }
  /** The web editor's Fabric recipe: its layers stay editable there; here the version opens flat. */
  | { kind: 'foreign'; reason: string }
  | { kind: 'bad'; reason: string };

const LEGACY_LOOKS: Record<string, FilterName> = { none: 'none', mono: 'mono', sepia: 'sepia', warm: 'warm', cool: 'cool', vivid: 'vivid', fade: 'fade' };

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.max(lo, Math.min(hi, n));
};
const rectOf = (v: unknown): Rect | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const x = num(r.x, 0, 0, 1);
  const y = num(r.y, 0, 0, 1);
  const w = num(r.w, 1, 0, 1 - x);
  const h = num(r.h, 1, 0, 1 - y);
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};
const turnOf = (v: unknown): Recipe['rotate'] => ([0, 90, 180, 270].includes(v as number) ? (v as Recipe['rotate']) : 0);

/** A stored recipe (the JSON text the server keeps), read for this editor. */
export function parseRecipe(json: string | null | undefined): Parsed {
  if (!json) return { kind: 'bad', reason: 'There is no saved edit.' };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { kind: 'bad', reason: 'The saved edit could not be read.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'bad', reason: 'The saved edit could not be read.' };
  const r = raw as Record<string, unknown>;
  if (r.v === 1 && 'adjustments' in r) return { kind: 'foreign', reason: 'This version was edited in the web editor. Its layers stay editable there; here it opens as a flat picture.' };
  if (r.schema === 2) return { kind: 'ok', recipe: normalise(r), schema: 2 };
  if (r.schema !== undefined) return { kind: 'bad', reason: 'This edit was saved by a newer WorkSuite. Update the app to reopen its layers.' };
  // Schema 1: this app's editor before ENH-03.
  if ('adjust' in r || 'look' in r || 'rotate' in r) {
    const base = blankRecipe(null);
    const look = typeof r.look === 'string' ? (LEGACY_LOOKS[r.look] ?? 'none') : 'none';
    const wm = r.watermark as { text?: unknown; pos?: unknown; opacity?: unknown; size?: unknown } | null | undefined;
    const resize = r.resize as { w?: unknown; h?: unknown } | null | undefined;
    const recipe: Recipe = {
      ...base,
      rotate: turnOf(r.rotate),
      flipH: r.flipH === true,
      flipV: r.flipV === true,
      crop: rectOf(r.crop),
      adjust: { ...base.adjust, ...adjustOf(r.adjust) },
      filter: { name: look, strength: 100, scope: 'image', preset: null },
      watermark: wm && typeof wm.text === 'string' && wm.text ? { kind: 'text', text: wm.text, pos: num(wm.pos, 8, 0, 8), opacity: num(wm.opacity, 60, 0, 100), size: num(wm.size, 30, 5, 80), tile: false } : null,
      resize: resize && typeof resize.w === 'number' && typeof resize.h === 'number' ? { w: Math.round(resize.w), h: Math.round(resize.h) } : null,
    };
    return { kind: 'ok', recipe, schema: 1 };
  }
  return { kind: 'bad', reason: 'The saved edit is not one this editor knows.' };
}

function adjustOf(v: unknown): Partial<Record<Adjustment, number>> {
  const out: Partial<Record<Adjustment, number>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const a of ADJUSTMENTS) {
    const n = (v as Record<string, unknown>)[a];
    if (typeof n === 'number' && Number.isFinite(n)) out[a] = Math.max(-100, Math.min(100, n));
  }
  return out;
}

/** Fills in what a schema-2 recipe left out (new fields are additive), and clamps what it holds. */
function normalise(r: Record<string, unknown>): Recipe {
  const base = blankRecipe(typeof r.base_version === 'number' ? r.base_version : null);
  const f = (r.filter ?? {}) as Partial<FilterState>;
  const filter: FilterState = {
    name: (FILTERS as readonly string[]).includes(f.name as string) ? (f.name as FilterName) : 'none',
    strength: num(f.strength, 100, 0, 100),
    scope: f.scope === 'area' ? 'area' : 'image',
    preset: f.preset && typeof f.preset === 'object' ? { id: (f.preset as { id: number | string }).id, name: String((f.preset as { name?: unknown }).name ?? ''), adjust: adjustOf((f.preset as { adjust?: unknown }).adjust) } : null,
  };
  const area = r.area as Recipe['area'];
  return {
    ...base,
    rotate: turnOf(r.rotate),
    flipH: r.flipH === true,
    flipV: r.flipV === true,
    straighten: num(r.straighten, 0, -45, 45),
    straighten_fill: typeof r.straighten_fill === 'string' ? r.straighten_fill : null,
    crop: rectOf(r.crop),
    crop_ratio: typeof r.crop_ratio === 'string' ? r.crop_ratio : null,
    adjust: { ...base.adjust, ...adjustOf(r.adjust) },
    filter,
    area: area && Array.isArray(area.seeds) ? { seeds: area.seeds.filter((s) => s && typeof s.x === 'number' && typeof s.y === 'number').slice(0, 64), tolerance: num(area.tolerance, 32, 1, 255) } : null,
    resize: r.resize && typeof (r.resize as Record<string, unknown>).w === 'number' ? { w: Math.round((r.resize as { w: number }).w), h: Math.round((r.resize as { h: number }).h) } : null,
    corners: num(r.corners, 0, 0, 200),
    corners_fill: typeof r.corners_fill === 'string' ? r.corners_fill : null,
    frame: r.frame && typeof r.frame === 'object' ? { ...(r.frame as Frame), size: num((r.frame as Frame).size, 0, 0, 200) } : null,
    watermark: r.watermark && typeof r.watermark === 'object' ? { kind: 'text', text: '', pos: 8, opacity: 60, size: 30, tile: false, ...(r.watermark as Partial<Watermark>) } : null,
    redactions: Array.isArray(r.redactions) ? r.redactions.map(rectOf).filter((x): x is Rect => !!x) : [],
    objects: Array.isArray(r.objects) ? (r.objects as OverlayObject[]).filter((o) => o && typeof o === 'object' && typeof o.kind === 'string' && typeof o.id === 'string') : [],
    ai_steps: Array.isArray(r.ai_steps) ? (r.ai_steps as AiStep[]) : [],
    ...(r.draft && typeof r.draft === 'object' ? { draft: r.draft as { saved_at: string } } : {}),
  };
}

/** The recipe as stored with a version: schema 2, naming its base, never marked as a draft. */
export function serialise(r: Recipe, baseVersion: number | null, draft?: string): string {
  const { draft: _d, ...rest } = r;
  return JSON.stringify({ ...rest, schema: 2, base_version: baseVersion ?? r.base_version, ...(draft ? { draft: { saved_at: draft } } : {}) });
}

/* ==================================================================== *
 * Sizes
 * ==================================================================== */

export function turned(w: number, h: number, rotate: number): { w: number; h: number } {
  return rotate === 90 || rotate === 270 ? { w: h, h: w } : { w, h };
}

/**
 * How much a picture is enlarged so a turn of `deg` leaves no empty corners in the w × h frame (CRT-01): the frame's
 * corners must stay inside the turned, enlarged picture.
 */
export function straightenScale(w: number, h: number, deg: number): number {
  const t = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return Math.max((w * c + h * s) / w, (w * s + h * c) / h);
}

/** The picture's size before any frame: turned, cropped, resized. */
export function contentSize(w: number, h: number, r: Recipe): { w: number; h: number } {
  if (r.resize) return r.resize;
  const t = turned(w, h, r.rotate);
  return r.crop ? { w: Math.max(1, Math.round(t.w * r.crop.w)), h: Math.max(1, Math.round(t.h * r.crop.h)) } : t;
}

/** A frame's margins, in output pixels: a Polaroid keeps three times as much below, for its caption. */
export function frameMargins(f: Frame | null): { l: number; t: number; r: number; b: number } {
  if (!f || f.preset === 'none' || f.size <= 0) return { l: 0, t: 0, r: 0, b: 0 };
  const s = Math.round(f.size);
  return f.preset === 'polaroid' ? { l: s, t: s, r: s, b: s * 3 } : { l: s, t: s, r: s, b: s };
}

/** The saved picture's size (CRT-41: 2400 × 1600 with a 36 px Polaroid → 2472 × 1744). */
export function outputSize(w: number, h: number, r: Recipe): { w: number; h: number } {
  const c = contentSize(w, h, r);
  const m = frameMargins(r.frame);
  return { w: c.w + m.l + m.r, h: c.h + m.t + m.b };
}

/** A crop of the given ratio (w/h), as large as fits the picture, centred. Fractions. */
export function cropForRatio(w: number, h: number, ratio: number): Rect {
  const pic = w / h;
  if (ratio >= pic) {
    const ch = pic / ratio;
    return { x: 0, y: (1 - ch) / 2, w: 1, h: ch };
  }
  const cw = ratio / pic;
  return { x: (1 - cw) / 2, y: 0, w: cw, h: 1 };
}

export const CROP_RATIOS: Array<{ id: string; label: string; ratio: number | null; hint?: string }> = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '4:5', label: '4:5', ratio: 4 / 5, hint: 'Instagram portrait' },
  { id: '1.91:1', label: '1.91:1', ratio: 1.91, hint: 'Link preview' },
  { id: '3:1', label: '3:1', ratio: 3, hint: 'LinkedIn and Facebook cover' },
  { id: 'a4', label: 'A4 / A3', ratio: 1 / Math.SQRT2 },
  { id: 'a4l', label: 'A4 landscape', ratio: Math.SQRT2 },
];

/** "4:5", "1.91:1", "2:3", or null for anything else. */
export function ratioFromText(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 0 && b > 0 && a / b >= 0.05 && a / b <= 20 ? a / b : null;
}

/* ==================================================================== *
 * Words
 * ==================================================================== */

const FILTER_WORD: Record<FilterName, string> = { none: 'Original', vivid: 'Vivid', warm: 'Warm', cool: 'Cool', mono: 'Mono', noir: 'Noir', fade: 'Fade', film: 'Film', dusk: 'Dusk', sepia: 'Sepia' };
export const filterLabel = (n: FilterName): string => FILTER_WORD[n];

/** What the recipe changes, in words: the version note's suggestion (SAV-02), e.g. "Warm filter, 4:5 crop, 1 text layer". */
export function autoSummary(r: Recipe): string {
  const out: string[] = [];
  if (r.filter.preset) out.push(`${r.filter.preset.name} look${r.filter.strength < 100 ? ` ${r.filter.strength}%` : ''}`);
  else if (r.filter.name !== 'none') out.push(`${FILTER_WORD[r.filter.name]} filter${r.filter.strength < 100 ? ` ${r.filter.strength}%` : ''}`);
  const changed = ADJUSTMENTS.filter((a) => r.adjust[a] !== 0);
  if (changed.length) out.push(changed.length > 2 ? `${changed.length} adjustments` : `adjusted ${changed.join(' and ')}`);
  if (r.crop) out.push(r.crop_ratio && r.crop_ratio !== 'free' ? `${r.crop_ratio} crop` : 'cropped');
  if (r.straighten) out.push(`straightened ${r.straighten > 0 ? '+' : ''}${r.straighten.toFixed(1)}°`);
  if (r.rotate) out.push(`turned ${r.rotate}°`);
  if (r.flipH || r.flipV) out.push('flipped');
  const count = (k: OverlayObject['kind'], one: string) => {
    const n = r.objects.filter((o) => o.kind === k).length;
    if (n) out.push(`${n} ${one}${n === 1 ? '' : 's'}`);
  };
  count('text', 'text layer');
  count('sticker', 'sticker');
  count('shape', 'shape');
  count('logo', 'logo');
  count('image', 'picture layer');
  if (r.frame && r.frame.preset !== 'none') out.push(`${r.frame.preset === 'library' ? 'library' : r.frame.preset} frame`);
  if (r.corners) out.push('rounded corners');
  if (r.watermark && (r.watermark.text || r.watermark.asset)) out.push('watermarked');
  if (r.redactions.length) out.push(`${r.redactions.length} redaction${r.redactions.length === 1 ? '' : 's'}`);
  if (r.resize) out.push(`resized to ${r.resize.w} × ${r.resize.h}`);
  if (!out.length) return 'Edited in the photo editor';
  const s = out.join(', ');
  return (s[0]!.toUpperCase() + s.slice(1)).slice(0, 500);
}

/* ==================================================================== *
 * Limits (SAV-13)
 * ==================================================================== */

export const MAX_RENDER_BYTES = 60 * 1024 * 1024;
export const MAX_RECIPE_BYTES = 24 * 1024 * 1024;
/** Above this many pixels the editor works on a 4096 px proxy and renders full size only when saving (EDT-E-13). */
export const PROXY_PIXELS = 40_000_000;
export const PROXY_EDGE = 4096;

export function checkLimits(renderBytes: number, recipeBytes: number, size: { w: number; h: number }, limits?: { render_bytes?: number; recipe_bytes?: number }): string | null {
  const maxRender = limits?.render_bytes ?? MAX_RENDER_BYTES;
  const maxRecipe = limits?.recipe_bytes ?? MAX_RECIPE_BYTES;
  if (renderBytes > maxRender) {
    const k = Math.sqrt(maxRender / renderBytes) * 0.9;
    return `The picture would be ${(renderBytes / 1048576).toFixed(0)} MB, over the ${Math.round(maxRender / 1048576)} MB limit. Save it smaller — about ${Math.floor(size.w * k)} × ${Math.floor(size.h * k)} — or as JPEG or WebP.`;
  }
  if (recipeBytes > maxRecipe) return `The editable layers come to ${(recipeBytes / 1048576).toFixed(0)} MB, over the ${Math.round(maxRecipe / 1048576)} MB limit. Remove a picture layer, or save without editable layers.`;
  return null;
}

/** The size the editor works at: the picture itself, or a 4096 px proxy for anything over 40 MP. */
export function workingSize(w: number, h: number): { w: number; h: number; proxy: boolean } {
  if (w * h <= PROXY_PIXELS) return { w, h, proxy: false };
  const k = PROXY_EDGE / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), proxy: true };
}

let seq = 0;
export function newId(prefix = 'o'): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

/**
 * Layers kept on the same spot of the picture when its crop changes: positions and sizes move from fractions of the
 * old crop to fractions of the new one (font sizes and stroke widths, thousandths of the height, follow).
 */
export function remapObjects(objects: OverlayObject[], from: Rect | null, to: Rect | null): OverlayObject[] {
  const a = from ?? { x: 0, y: 0, w: 1, h: 1 };
  const b = to ?? { x: 0, y: 0, w: 1, h: 1 };
  if (a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h) return objects;
  const mx = (x: number) => (a.x + x * a.w - b.x) / b.w;
  const my = (y: number) => (a.y + y * a.h - b.y) / b.h;
  const k = a.h / b.h;
  return objects.map((o) => {
    const moved = { ...o, x: mx(o.x), y: my(o.y), w: (o.w * a.w) / b.w, h: (o.h * a.h) / b.h };
    if (moved.kind === 'text') return { ...moved, size: moved.size * k };
    if (moved.kind === 'shape') return { ...moved, stroke: { ...moved.stroke, width: moved.stroke.width * k }, radius: moved.radius * k, points: moved.points?.map((v, i) => (i % 2 ? my(v) : mx(v))) };
    return moved;
  });
}

/** An AI suggestion's steps on a recipe (AI-03): only steps that use the editor's own tools; anything else is left out. */
export function applyAiSteps(r: Recipe, steps: Array<{ type?: string; tool?: string; [k: string]: unknown }>, picture: { w: number; h: number }): { recipe: Recipe; used: string[]; skipped: number } {
  let next: Recipe = { ...r, adjust: { ...r.adjust } };
  const used: string[] = [];
  let skipped = 0;
  for (const raw of steps) {
    const s: { tool: string; [k: string]: unknown } = { ...raw, tool: String(raw.type ?? raw.tool ?? '') };
    if (s.tool === 'adjust' && s.values && typeof s.values === 'object') {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(s.values as Record<string, unknown>)) {
        if (!(ADJUSTMENTS as readonly string[]).includes(k) || typeof v !== 'number') continue;
        const value = k === 'hue' ? num((v / 180) * 100, 0, -100, 100) : num(v, 0, -100, 100);
        next.adjust[k as Adjustment] = Math.round(value);
        parts.push(`${k[0]!.toUpperCase()}${k.slice(1)} ${value > 0 ? '+' : ''}${Math.round(value)}`);
      }
      if (parts.length) used.push(...parts);
      else skipped++;
      continue;
    }
    if (s.tool === 'rotate' && [90, 180, 270].includes(Number(s.degrees))) {
      next = { ...next, rotate: (((next.rotate + Number(s.degrees)) % 360) as Recipe['rotate']), crop: null, crop_ratio: null };
      used.push(`Turn ${Number(s.degrees)}°`);
      continue;
    }
    if (s.tool === 'filter' && (FILTERS as readonly string[]).includes(String(s.name))) {
      next = { ...next, filter: { ...next.filter, name: s.name as FilterName, strength: num(s.strength, 100, 0, 100), preset: null } };
      used.push(`Filter · ${FILTER_WORD[s.name as FilterName]} ${num(s.strength, 100, 0, 100)}%`);
    } else if (s.tool === 'adjust' && (ADJUSTMENTS as readonly string[]).includes(String(s.key))) {
      const v = num(s.value, 0, -100, 100);
      next.adjust[s.key as Adjustment] = v;
      used.push(`${String(s.key)[0]!.toUpperCase()}${String(s.key).slice(1)} ${v > 0 ? '+' : ''}${v}`);
    } else if (s.tool === 'straighten') {
      next = { ...next, straighten: num(s.angle, 0, -45, 45) };
      used.push(`Straighten ${next.straighten}°`);
    } else if (s.tool === 'crop') {
      const t = turned(picture.w, picture.h, next.rotate);
      const ratio = typeof s.ratio === 'string' ? ratioFromText(s.ratio) : null;
      const given = rectOf({ x: s.x, y: s.y, w: s.w, h: s.h });
      const crop = given && typeof s.x === 'number' ? given : ratio ? cropForRatio(t.w, t.h, ratio) : null;
      if (!crop) {
        skipped++;
        continue;
      }
      next = { ...next, crop, crop_ratio: typeof s.ratio === 'string' ? s.ratio : null, objects: remapObjects(next.objects, next.crop, crop) };
      used.push(`Crop · ${typeof s.ratio === 'string' ? s.ratio : 'suggested'}`);
    } else skipped++;
  }
  return { recipe: next, used, skipped };
}
