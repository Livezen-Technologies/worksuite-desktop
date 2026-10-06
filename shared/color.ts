/**
 * Colour maths for the colour profiles (worksuite-desktop#234): sRGB hex ⇄ OKLCH, gamut mapping and the WCAG
 * contrast ratio. OKLCH because its lightness is perceptual: one lightness step per role gives every hue the same
 * weight, which HSL does not (a yellow and a blue at "50%" are nowhere near each other).
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** `#abc`, `abc`, `#AABBCC` → `#aabbcc`; null when it is not a hex colour. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = HEX.exec(value.trim());
  if (!m) return null;
  const v = m[1]!.toLowerCase();
  return `#${v.length === 3 ? v.split('').map((c) => c + c).join('') : v}`;
}

function rgbOf(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? '#000000';
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = rgbOf(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH → hex, keeping lightness and hue and giving up chroma until the colour fits in sRGB. */
export function oklchToHex(color: Oklch): string {
  const l = Math.min(1, Math.max(0, color.l));
  let c = Math.max(0, color.c);
  if (!inGamut(oklchToLinear({ l, c, h: color.h }))) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  const rgb = oklchToLinear({ l, c, h: color.h }).map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The shortest way round the colour wheel between two hues, in degrees. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Moves a colour's lightness, a little at a time and in one direction, until `ok` holds; the colour as it was when
 * it already does. Null when no lightness in that direction makes it hold.
 */
export function shiftLightness(color: Oklch, direction: 1 | -1, ok: (hex: string) => boolean): string | null {
  for (let l = color.l, i = 0; i <= 200; i++, l += direction * 0.005) {
    if (l < 0 || l > 1) break;
    const hex = oklchToHex({ ...color, l });
    if (ok(hex)) return hex;
  }
  return null;
}
