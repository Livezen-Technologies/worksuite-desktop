// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/core/api';
import { BLANK, adjustPixels as legacyAdjust, type Look } from '../../../src/modules/files/imaging';
import { editorOf, staleOf } from '../../../src/modules/files/image/api';
import { renamed, toSteps, DEFAULT_STEPS, previewRecipe } from '../../../src/modules/files/image/Batch';
import { offlineWords } from '../../../src/modules/files/image/local';
import {
  applyAiSteps,
  autoSummary,
  blankRecipe,
  checkLimits,
  cropForRatio,
  isBlank,
  outputSize,
  parseRecipe,
  ratioFromText,
  remapObjects,
  serialise,
  straightenScale,
  workingSize,
  type Recipe,
  type TextObject,
} from '../../../src/modules/files/image/recipe';
import { adjustPixels, areaMask, filterAdjust, assetKeys } from '../../../src/modules/files/image/render';
import { recolourSvg, sanitiseSvg, searchStickers, STICKERS, stickerSvg } from '../../../src/modules/files/image/stickers';
import { missingFonts, newText, TEXT_PRESETS } from '../../../src/modules/files/image/text';
import { cropBy, moveBy, resizeBy } from '../../../src/modules/files/image/Stage';

const text = (patch: Partial<TextObject> = {}): TextObject => ({ ...newText('Hello', TEXT_PRESETS[0]!), ...patch });

describe('the recipe, schema 2 (NFR-16, §14.2)', () => {
  it('opens a recipe saved by this app before ENH-03 unchanged: its look becomes a filter at 100%', () => {
    const old = { rotate: 90, flipH: true, flipV: false, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, adjust: { ...BLANK.adjust, contrast: 12 }, look: 'warm', watermark: { text: '© Livezen', pos: 8, opacity: 60, size: 30 }, resize: { w: 640, h: 400 } };
    const p = parseRecipe(JSON.stringify(old));
    expect(p.kind).toBe('ok');
    if (p.kind !== 'ok') return;
    expect(p.schema).toBe(1);
    expect(p.recipe).toMatchObject({ schema: 2, rotate: 90, flipH: true, crop: old.crop, filter: { name: 'warm', strength: 100, scope: 'image' }, resize: { w: 640, h: 400 }, watermark: { kind: 'text', text: '© Livezen', pos: 8 } });
    expect(p.recipe.adjust.contrast).toBe(12);
    // …and saves as schema 2, naming its base.
    expect(JSON.parse(serialise(p.recipe, 3))).toMatchObject({ schema: 2, base_version: 3 });
  });

  it('draws an old look at full strength exactly as the editor before ENH-03 did (AC-14)', () => {
    const looks: Look[] = ['mono', 'sepia', 'warm', 'cool', 'vivid', 'fade'];
    for (const look of looks) {
      const px = () => new Uint8ClampedArray([12, 90, 200, 255, 240, 30, 70, 255, 128, 128, 128, 255]);
      const a = px();
      const b = px();
      legacyAdjust(a, { ...BLANK.adjust, contrast: 20, brightness: -10 }, look);
      const p = parseRecipe(JSON.stringify({ adjust: { ...BLANK.adjust, contrast: 20, brightness: -10 }, look }));
      if (p.kind !== 'ok') throw new Error('not parsed');
      const sum: Record<string, number> = { ...p.recipe.adjust };
      for (const [k, v] of Object.entries(filterAdjust(p.recipe.filter))) sum[k] = (sum[k] ?? 0) + v;
      adjustPixels(b, sum, look === 'sepia' ? 1 : 0);
      expect(Array.from(b), look).toEqual(Array.from(a));
    }
  });

  it('recognises the web editor’s Fabric recipe rather than misreading it, and refuses a newer schema', () => {
    expect(parseRecipe(JSON.stringify({ v: 1, adjustments: {}, overlay: {} })).kind).toBe('foreign');
    expect(parseRecipe(JSON.stringify({ schema: 3 })).kind).toBe('bad');
    expect(parseRecipe('not json').kind).toBe('bad');
  });

  it('fills in what a schema-2 recipe leaves out, and clamps what it holds', () => {
    const p = parseRecipe(JSON.stringify({ schema: 2, base_version: 2, straighten: 80, filter: { name: 'dusk', strength: 140 }, corners: 500, objects: [text(), { nope: true }] }));
    if (p.kind !== 'ok') throw new Error('not parsed');
    expect(p.recipe.straighten).toBe(45);
    expect(p.recipe.filter).toMatchObject({ name: 'dusk', strength: 100 });
    expect(p.recipe.corners).toBe(200);
    expect(p.recipe.objects).toHaveLength(1);
    expect(p.recipe.base_version).toBe(2);
  });

  it('marks an autosaved recipe as a draft only when asked', () => {
    const r = blankRecipe(4);
    expect(JSON.parse(serialise(r, 4, '2026-10-10T13:42:00Z')).draft).toEqual({ saved_at: '2026-10-10T13:42:00Z' });
    expect(JSON.parse(serialise({ ...r, draft: { saved_at: 'x' } }, 4)).draft).toBeUndefined();
    expect(isBlank(r)).toBe(true);
    expect(isBlank({ ...r, straighten: 1 })).toBe(false);
  });
});

describe('sizes', () => {
  it('a Polaroid frame makes the picture larger: 2400 × 1600 with 36 px → 2472 × 1744 (CRT-41)', () => {
    expect(outputSize(2400, 1600, { ...blankRecipe(), frame: { preset: 'polaroid', size: 36, colour: '#fff' } })).toEqual({ w: 2472, h: 1744 });
    expect(outputSize(2400, 1600, { ...blankRecipe(), frame: { preset: 'thin', size: 10, colour: '#fff' } })).toEqual({ w: 2420, h: 1620 });
    expect(outputSize(2400, 1600, { ...blankRecipe(), rotate: 90, crop: { x: 0, y: 0, w: 1, h: 0.5 } })).toEqual({ w: 1600, h: 1200 });
  });

  it('straightening enlarges the picture just enough that no empty corner shows (CRT-01)', () => {
    expect(straightenScale(1000, 1000, 0)).toBe(1);
    const s = straightenScale(1600, 900, 5);
    const t = (5 * Math.PI) / 180;
    // The frame's corner, turned back, lands inside the enlarged picture.
    const cx = 800 * Math.cos(t) + 450 * Math.sin(t);
    const cy = 800 * Math.sin(t) + 450 * Math.cos(t);
    expect(cx).toBeLessThanOrEqual(800 * s + 1e-9);
    expect(cy).toBeLessThanOrEqual(450 * s + 1e-9);
  });

  it('crops to a ratio as large as fits, centred; custom ratios are read (CRT-03)', () => {
    expect(cropForRatio(2000, 1000, 1)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    const insta = cropForRatio(2400, 1600, 4 / 5);
    expect((insta.w * 2400) / (insta.h * 1600)).toBeCloseTo(0.8);
    expect(ratioFromText('5:4')).toBeCloseTo(1.25);
    expect(ratioFromText('1.91:1')).toBeCloseTo(1.91);
    expect(ratioFromText('nonsense')).toBeNull();
  });

  it('works on a 4096 px proxy above 40 megapixels (EDT-E-13)', () => {
    expect(workingSize(6000, 4000)).toEqual({ w: 6000, h: 4000, proxy: false });
    expect(workingSize(9000, 6000)).toEqual({ w: 4096, h: 2731, proxy: true });
  });

  it('refuses sizes over the limits before uploading, with a smaller size to try (SAV-13)', () => {
    expect(checkLimits(10 * 1048576, 1000, { w: 4000, h: 3000 })).toBeNull();
    expect(checkLimits(80 * 1048576, 0, { w: 8000, h: 6000 })).toMatch(/over the 60 MB limit\. Save it smaller — about \d+ × \d+/);
    expect(checkLimits(1, 30 * 1048576, { w: 10, h: 10 })).toMatch(/over the 24 MB limit/);
  });
});

describe('layers', () => {
  it('stay on the same spot of the picture when the crop changes', () => {
    const o = text({ x: 0.5, y: 0.5, w: 0.2, h: 0.1, size: 50 });
    const [m] = remapObjects([o], null, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }) as TextObject[];
    expect(m).toMatchObject({ x: 0, y: 0, w: 0.4, h: 0.2, size: 100 });
  });

  it('move, resize by a handle (keeping a sticker’s shape) and crop by a handle', () => {
    expect(moveBy(text({ x: 0.1, y: 0.1 }), 0.1, 0.2)).toMatchObject({ x: 0.2, y: 0.30000000000000004 });
    const sticker = { id: 'k', kind: 'sticker' as const, sticker: 'badge-new', vector: true, colour: '#fff', outline: { on: false, width: 0, colour: '#000' }, shadow: { on: false, blur: 0, dx: 0, dy: 0, colour: '#000', opacity: 0 }, x: 0.1, y: 0.1, w: 0.2, h: 0.4, rotation: 0, opacity: 1 };
    const r = resizeBy(sticker, 'se', 0.1, 0, false, 1);
    expect(r.w).toBeCloseTo(0.3);
    expect(r.h).toBeCloseTo(0.6);
    // A text layer's side handles set where it wraps; its height follows its lines.
    expect(resizeBy(text({ w: 0.3, h: 0.1 }), 'e', 0.1, 0.5, false, 1)).toMatchObject({ h: 0.1 });
    const c = cropBy({ x: 0, y: 0, w: 1, h: 1 }, 'new', { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.5 }, 1);
    expect(c.w).toBeCloseTo(0.4);
    expect(c.h).toBeCloseTo(0.4);
  });

  it('names every picture a recipe draws, to load before saving', () => {
    const r: Recipe = { ...blankRecipe(), objects: [{ id: 'k1', kind: 'sticker', sticker: 'badge-new', vector: true, colour: '#F59E0B', outline: { on: false, width: 3, colour: '#fff' }, shadow: { on: false, blur: 0, dx: 0, dy: 0, colour: '#000', opacity: 0 }, x: 0, y: 0, w: 0.1, h: 0.1, rotation: 0, opacity: 1 }, { id: 'l1', kind: 'logo', asset: { file_id: 9, version: 2 }, shadow: { on: false, blur: 0, dx: 0, dy: 0, colour: '#000', opacity: 0 }, x: 0, y: 0, w: 0.1, h: 0.1, rotation: 0, opacity: 1 }], frame: { preset: 'library', size: 30, colour: '#fff', asset: { file_id: 11, version: 1 } } };
    expect(assetKeys(r)).toEqual(['builtin:badge-new:#F59E0B:-', 'asset:9:2', 'asset:11:1']);
  });

  it('says what changed, for the version note (SAV-02)', () => {
    const r: Recipe = { ...blankRecipe(), filter: { name: 'warm', strength: 60, scope: 'image', preset: null }, crop: { x: 0, y: 0, w: 0.5, h: 1 }, crop_ratio: '4:5', objects: [text()] };
    expect(autoSummary(r)).toBe('Warm filter 60%, 4:5 crop, 1 text layer');
    expect(autoSummary(blankRecipe())).toBe('Edited in the photo editor');
  });

  it('flags a font the recipe uses that is not on offer here (CRT-11)', () => {
    expect(missingFonts(['Georgia', 'Plus Jakarta Sans', 'Brandon'], [])).toEqual(['Brandon']);
    expect(missingFonts(['Brandon'], ['brandon'])).toEqual([]);
  });
});

describe('filters and the Area', () => {
  it('scales a preset by its strength (EDT-E-06)', () => {
    expect(filterAdjust({ name: 'warm', strength: 50, scope: 'image', preset: null })).toEqual({ temperature: 15, saturation: 4 });
    expect(filterAdjust({ name: 'none', strength: 100, scope: 'image', preset: { id: 1, name: 'Campaign', adjust: { contrast: 20 } } })).toEqual({ contrast: 20 });
  });

  it('picks the pixels joined to a click whose colour is near the clicked one (EDT-E-07)', () => {
    // 3 × 1: blue, blue, red.
    const d = new Uint8ClampedArray([0, 0, 255, 255, 0, 10, 250, 255, 255, 0, 0, 255]);
    expect(Array.from(areaMask(d, 3, 1, [{ x: 0, y: 0 }], 20))).toEqual([1, 1, 0]);
    const masked = new Uint8ClampedArray(d);
    adjustPixels(masked, { brightness: 50 }, 0, areaMask(d, 3, 1, [{ x: 0, y: 0 }], 20));
    expect(masked[8]).toBe(255);
    expect(masked[9]).toBe(0);
    expect(masked[0]).toBeGreaterThan(0);
  });
});

describe('the AI assistant’s steps (AI-03)', () => {
  it('turns the server’s steps into the editor’s own, and leaves out what it has no tool for', () => {
    const { recipe, used, skipped } = applyAiSteps(blankRecipe(), [{ type: 'filter', name: 'warm', strength: 40 }, { type: 'adjust', values: { highlights: -12, clarity: 5 } }, { type: 'crop', ratio: '4:5', x: 0.2, y: 0, w: 0.53, h: 1 }, { type: 'rotate', degrees: 90 }, { type: 'remove_background' }], { w: 2400, h: 1600 });
    expect(recipe.filter).toMatchObject({ name: 'warm', strength: 40 });
    expect(recipe.adjust.highlights).toBe(-12);
    expect(recipe.rotate).toBe(90);
    expect(used).toContain('Filter · Warm 40%');
    expect(used).toContain('Highlights -12');
    expect(skipped).toBe(1);
  });
});

describe('the server’s answers', () => {
  it('reads a stale save’s 409: who saved which version, and when (SAV-05)', () => {
    const e = new ApiError(409, 'Newer version', null, { code: 'IMAGE_VERSION_CONFLICT', base_version: 3, current_version: 4, saved_by: { id: 2, name: 'Kavindi' }, saved_at: '2026-10-10 13:38:00' });
    expect(staleOf(e)).toEqual({ version: 4, author: 'Kavindi', savedAt: '2026-10-10 13:38:00' });
    expect(staleOf(new ApiError(422, 'x', null, { code: 'IMAGE_TOO_LARGE' }))).toBeNull();
    expect(staleOf(new Error('x'))).toBeNull();
  });

  it('reads the editor block: tools on, AI only when enabled, the save defaults and limits', () => {
    const s = editorOf({ tools: ['select', 'crop', 'text'], ai: { enabled: false, actions: [], unavailable: { generative: 'Needs image model' } }, saving: { format: 'same', quality: 85, keep_layers: true, strip_gps: true }, limits: { max_render_mb: 60, max_recipe_mb: 24, batch_max_files: 500 } });
    expect(s.tools).toMatchObject({ select: true, crop: true, text: true, redact: false, mark: false });
    expect(s.ai?.available).toBe(false);
    expect(s.ai?.image_model).toBe(false);
    expect(s.limits).toEqual({ render_bytes: 60 * 1048576, recipe_bytes: 24 * 1048576, batch_files: 500 });
    expect(editorOf({ ai: { enabled: true, actions: ['alt_text'] } }).ai).toMatchObject({ available: true, actions: ['alt_text'] });
    expect(editorOf(null)).toEqual({});
  });

  it('says how an offline edit stands (DSK-02)', () => {
    expect(offlineWords({ synced: true, version: 3, canUpload: true, paused: false, pending: null }, true, 3)).toBe('Offline · will upload as v4');
    expect(offlineWords({ synced: true, version: 3, canUpload: true, paused: false, pending: { baseVersion: 3, savedAt: 'x', state: 'waiting', copyName: null, willBe: 4 } }, false, 3)).toBe('Saved here · will upload as v4');
    expect(offlineWords({ synced: true, version: 3, canUpload: true, paused: false, pending: { baseVersion: 3, savedAt: 'x', state: 'conflict', copyName: null, willBe: 4 } }, false, 3)).toMatch(/both copies kept/);
    expect(offlineWords(null, false, 3)).toBeNull();
  });
});

describe('batch edit (BAT-02)', () => {
  it('renames with {name}, {n}, {ext} and {date}', () => {
    const d = new Date(2026, 9, 10);
    expect(renamed('campaign-{n}', { name: 'IMG_1.jpg' }, 1, 12, d)).toBe('campaign-01.jpg');
    expect(renamed('{date}-{name}.{ext}', { name: 'a.png' }, 3, 3, d)).toBe('2026-10-10-a.png');
    expect(renamed('{name}', { name: 'a.png' }, 1, 1, d, 'webp')).toBe('a.webp');
  });

  it('sends the steps in order, in the server’s shape; a new version keeps its type', () => {
    const s = { ...DEFAULT_STEPS, filter: { on: true, name: 'warm' as const, strength: 60 }, watermark: { on: true, text: '© Livezen', pos: 8, opacity: 70 }, convert: { on: true, format: 'webp' as const, quality: 82 }, rename: { on: true, pattern: 'c-{n}' } };
    expect(toSteps(s, 'copies').map((x) => x.type)).toEqual(['resize', 'filter', 'watermark', 'convert', 'strip_gps', 'rename']);
    expect(toSteps(s, 'copies')[0]).toEqual({ type: 'resize', edge: 1600 });
    expect(toSteps(s, 'copies')[2]).toMatchObject({ position: 'br', opacity: 70 });
    expect(toSteps(s, 'versions').map((x) => x.type)).not.toContain('convert');
    expect(previewRecipe(s).filter).toMatchObject({ name: 'warm', strength: 60 });
  });
});

describe('stickers (CRT-30, NFR-08)', () => {
  it('has a built-in set in every category, searchable', () => {
    for (const c of ['badges', 'arrows', 'icons', 'seasonal'] as const) expect(searchStickers('', c).length).toBeGreaterThan(3);
    expect(searchStickers('heart', 'all').map((s) => s.id)).toEqual(['badge-heart']);
    expect(stickerSvg(STICKERS[0]!, '#123456', { on: true, width: 3, colour: '#fff' })).toContain('#123456');
  });

  it('takes scripts, foreignObject, handlers and outside references out of a library SVG', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><foreignObject><div/></foreignObject><image href="https://evil.example/a.png"/><rect fill="url(https://evil.example/#a)" width="5" height="5"/><circle fill="#f00" r="3"/></svg>';
    const clean = sanitiseSvg(dirty)!;
    expect(clean).not.toMatch(/script|foreignObject|onload|evil\.example/);
    expect(clean).toContain('circle');
    expect(sanitiseSvg('<html></html>')).toBeNull();
    expect(recolourSvg(clean, '#00FF00')).toContain('#00FF00');
  });
});
