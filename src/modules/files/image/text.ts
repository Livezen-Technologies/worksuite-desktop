import { NO_SHADOW, newId, type TextObject } from './recipe';

/**
 * Text (CRT-10…14): the style presets, the fonts on offer, and laying text out into lines — shared by the canvas that
 * draws it and the handles that frame it, so both agree on its size.
 *
 * Complex scripts (Sinhala, Tamil) are shaped by the browser's text engine as they are drawn; the bundled Noto Sans
 * Sinhala and Noto Sans Tamil are listed after any chosen font, so their letters always have glyphs.
 */

export interface FontChoice {
  family: string;
  label: string;
  source: 'bundled' | 'system' | 'brand';
}

/** Open-licence fonts this app already ships (OFL): always here, offline too. */
export const BUNDLED_FONTS: FontChoice[] = [
  { family: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans', source: 'bundled' },
  { family: 'Noto Sans Sinhala', label: 'Noto Sans Sinhala', source: 'bundled' },
  { family: 'Noto Sans Tamil', label: 'Noto Sans Tamil', source: 'bundled' },
  { family: 'JetBrains Mono', label: 'JetBrains Mono', source: 'bundled' },
];

/** Fonts every desktop system has under one of these names; the browser picks the nearest when one is missing. */
export const SYSTEM_FONTS: FontChoice[] = [
  { family: 'Georgia', label: 'Georgia', source: 'system' },
  { family: 'Arial', label: 'Arial', source: 'system' },
  { family: 'Helvetica', label: 'Helvetica', source: 'system' },
  { family: 'Times New Roman', label: 'Times New Roman', source: 'system' },
  { family: 'Courier New', label: 'Courier New', source: 'system' },
  { family: 'Verdana', label: 'Verdana', source: 'system' },
  { family: 'Trebuchet MS', label: 'Trebuchet MS', source: 'system' },
  { family: 'Impact', label: 'Impact', source: 'system' },
];

const FALLBACK = '"Noto Sans Sinhala", "Noto Sans Tamil", system-ui, sans-serif';

export function fontStack(family: string): string {
  return `"${family.replace(/["\\]/g, '')}", ${FALLBACK}`;
}

export interface TextPreset {
  id: string;
  label: string;
  /** What the preset sets; the rest of the object stays. */
  style: Partial<TextObject>;
  sample: string;
}

const white = '#FFFFFF';
export const TEXT_PRESETS: TextPreset[] = [
  { id: 'headline', label: 'Headline', sample: 'Headline', style: { font: 'Georgia', size: 90, weight: 700, italic: false, colour: white, letterSpacing: 0, lineHeight: 1.1, uppercase: false, shadow: { ...NO_SHADOW, on: true, blur: 14, dy: 4, opacity: 40 }, outline: { on: false, width: 3, colour: '#000000' }, pill: { on: false, padding: 14, radius: 14, colour: '#000000' } } },
  { id: 'caption', label: 'Caption', sample: 'CAPTION', style: { font: 'Plus Jakarta Sans', size: 32, weight: 700, italic: false, colour: white, letterSpacing: 0.3, lineHeight: 1.3, uppercase: true, shadow: { ...NO_SHADOW }, outline: { on: false, width: 2, colour: '#000000' }, pill: { on: false, padding: 10, radius: 8, colour: '#000000' } } },
  { id: 'quote', label: 'Quote', sample: '“Quote”', style: { font: 'Georgia', size: 54, weight: 400, italic: true, colour: white, letterSpacing: 0, lineHeight: 1.25, uppercase: false, shadow: { ...NO_SHADOW, on: true, blur: 10, opacity: 35 }, outline: { on: false, width: 2, colour: '#000000' }, pill: { on: false, padding: 12, radius: 10, colour: '#000000' } } },
  { id: 'label', label: 'Label', sample: 'Label', style: { font: 'Plus Jakarta Sans', size: 36, weight: 800, italic: false, colour: '#1B1F2E', letterSpacing: 0, lineHeight: 1.2, uppercase: false, shadow: { ...NO_SHADOW }, outline: { on: false, width: 2, colour: '#000000' }, pill: { on: true, padding: 14, radius: 40, colour: '#F59E0B' } } },
  { id: 'outline', label: 'Outline', sample: 'Outline', style: { font: 'Plus Jakarta Sans', size: 80, weight: 800, italic: false, colour: '#FFFFFF00', letterSpacing: 0, lineHeight: 1.1, uppercase: false, shadow: { ...NO_SHADOW }, outline: { on: true, width: 4, colour: white }, pill: { on: false, padding: 12, radius: 10, colour: '#000000' } } },
  { id: 'price', label: 'Price', sample: 'Price', style: { font: 'Plus Jakarta Sans', size: 70, weight: 800, italic: false, colour: '#FDE68A', letterSpacing: 0, lineHeight: 1.1, uppercase: false, shadow: { ...NO_SHADOW, on: true, blur: 8, dy: 3, opacity: 50 }, outline: { on: false, width: 2, colour: '#000000' }, pill: { on: false, padding: 12, radius: 10, colour: '#000000' } } },
];

/** A new text layer, in a preset's style, near the top left of the picture. */
export function newText(text = 'Your text', preset: TextPreset = TEXT_PRESETS[0]!, aspect = 1.5): TextObject {
  return {
    id: newId('t'),
    kind: 'text',
    x: 0.08,
    y: 0.08,
    w: Math.min(0.84, 0.5 * Math.max(1, 1.5 / aspect)),
    h: 0.12,
    rotation: 0,
    opacity: 1,
    text,
    font: 'Plus Jakarta Sans',
    size: 60,
    weight: 700,
    italic: false,
    align: 'left',
    colour: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 1.2,
    shadow: { ...NO_SHADOW },
    outline: { on: false, width: 3, colour: '#000000' },
    pill: { on: false, padding: 12, radius: 12, colour: '#000000' },
    ...preset.style,
    style_preset: preset.id,
  };
}

export function applyPreset(o: TextObject, p: TextPreset): TextObject {
  return { ...o, ...p.style, style_preset: p.id };
}

export interface TextLayout {
  lines: string[];
  /** Pixels, at the size drawn. */
  fontPx: number;
  lineHeightPx: number;
  width: number;
  height: number;
  font: string;
}

/** The canvas font string for a text layer drawn on a picture `pictureH` pixels tall. */
export function fontOf(o: TextObject, pictureH: number): { font: string; px: number } {
  const px = Math.max(1, (o.size / 1000) * pictureH);
  return { font: `${o.italic ? 'italic ' : ''}${o.weight} ${px.toFixed(2)}px ${fontStack(o.font)}`, px };
}

/**
 * Lines for a text layer `boxW` pixels wide: the person's own line breaks first, then words wrapped to the width (a
 * word wider than the box stays whole on its line). `measure` is a 2D context's measureText with the font set.
 */
export function layoutText(o: TextObject, boxW: number, pictureH: number, ctx: Pick<CanvasRenderingContext2D, 'measureText' | 'font'> & { letterSpacing?: string }): TextLayout {
  const { font, px } = fontOf(o, pictureH);
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(o.letterSpacing * px).toFixed(2)}px`;
  const source = o.uppercase ? o.text.toLocaleUpperCase() : o.text;
  const lines: string[] = [];
  let widest = 0;
  for (const para of source.split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w !== '');
    let cur = '';
    for (const w of words) {
      const next = cur + w;
      if (cur.trim() && ctx.measureText(next.trimEnd()).width > boxW) {
        lines.push(cur.trimEnd());
        widest = Math.max(widest, ctx.measureText(cur.trimEnd()).width);
        cur = w.trimStart();
      } else cur = next;
    }
    lines.push(cur.trimEnd());
    widest = Math.max(widest, ctx.measureText(cur.trimEnd()).width);
  }
  const lineHeightPx = px * o.lineHeight;
  const pad = o.pill.on ? (o.pill.padding / 1000) * pictureH * 2 : 0;
  return { lines, fontPx: px, lineHeightPx, width: Math.min(boxW, widest), height: lineHeightPx * lines.length + pad, font };
}

/** Fonts a recipe uses that are not on offer here (CRT-11: they fall back to the bundled fonts, with a warning). */
export function missingFonts(families: string[], brand: string[]): string[] {
  const have = new Set([...BUNDLED_FONTS, ...SYSTEM_FONTS].map((f) => f.family.toLowerCase()).concat(brand.map((b) => b.toLowerCase())));
  return [...new Set(families)].filter((f) => !have.has(f.toLowerCase()));
}
