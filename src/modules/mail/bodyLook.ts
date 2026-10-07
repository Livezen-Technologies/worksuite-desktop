/**
 * Emails in dark mode (worksuite-desktop#287), decided for each email in the app — never by anything inside it:
 *
 * - plain words (plain text, or HTML with no colours of its own) take the app's colours: its surface, its ink and its
 *   accent for links, with no white card;
 * - an email with dark styles of its own (`prefers-color-scheme: dark`, or one that declares itself dark) is drawn
 *   with them: its media queries are switched on here, in its sanitised CSS;
 * - any other designed email is darkened carefully, element by element (like Apple Mail and Outlook): light
 *   backgrounds made dark in their own hue, dark text made light until it reads, brand colours, buttons and pictures
 *   left as they are, and a logo drawn for a white page given a soft light plate;
 * - one that would come out broken — laid over background pictures, positioned, with a palette too busy to map —
 *   stays light on a soft off-white card instead of a white block.
 *
 * Settings › Mail › Appearance & reading › Show emails in dark mode is Automatic, Always light or Always dark; the
 * header's ☀ / 🌙 overrides it for a sender, kept with the mail preferences. The colours are the app's own tokens
 * (styles.css and the colour profile, shared/theme-profiles.ts), read when the frame is drawn, so changing the theme or
 * the profile redraws the email at once. Every colour written here is a hex code worked out in the app.
 */
import { contrast, hexToOklch, normalizeHex, oklchToHex, shiftLightness, type Oklch } from '@shared/color';
import { renderPlainText, structureHtml } from './readable';
import { isDesignedMail } from './sanitize';
import type { MailPrefs } from './types';

export type BodyKind = 'plain' | 'simple' | 'designed' | 'native';
export type BodyTheme = NonNullable<MailPrefs['bodyTheme']>;
export type SenderTheme = 'light' | 'dark';

export interface BodyLook {
  /** What the email is drawn in: light (its own colours on white), dark (the app's, darkened if designed), or native (its own dark styles). */
  scheme: 'light' | 'dark' | 'native';
  /** A designed email darkened element by element. */
  darken: boolean;
  /** Kept light because darkening would not read well (a complex design under Automatic). */
  fallback: boolean;
}

// ── which kind of email ───────────────────────────────────────────────────────────────────────────────────

/** The color-scheme a body declares, by its <meta> or its CSS: "light dark", "dark", "light"… or null. */
export function declaredSchemes(raw: string): string | null {
  const meta = /<meta\b[^>]*\bname\s*=\s*["']?(?:color-scheme|supported-color-schemes)\b[^>]*>/i.exec(raw || '');
  const content = meta ? /\bcontent\s*=\s*["']([^"']*)["']/i.exec(meta[0])?.[1] : null;
  const css = /(?:^|[{;\s])(?:color-scheme|supported-color-schemes)\s*:\s*([^;}"']+)/i.exec(raw || '')?.[1] ?? null;
  const v = (content ?? css ?? '').toLowerCase().trim();
  return v || null;
}

/** It has dark styles of its own: `@media (prefers-color-scheme: dark)`, or it declares itself dark only. */
export function hasOwnDarkStyles(raw: string): boolean {
  if (/prefers-color-scheme\s*:\s*dark/i.test(raw || '')) return true;
  const declared = declaredSchemes(raw);
  return !!declared && /\bdark\b/.test(declared) && !/\blight\b/.test(declared);
}

/**
 * Plain text, its own dark styles, words in HTML, or a designed email — one with colours of its own (a background,
 * coloured text, a coloured table: sanitize.isDesignedMail).
 */
export function bodyKind({ raw, html, plain }: { raw: string; html: string; plain: boolean }): BodyKind {
  if (plain) return 'plain';
  if (hasOwnDarkStyles(raw)) return 'native';
  return isDesignedMail(html) ? 'designed' : 'simple';
}

/**
 * Would darkening come out broken? Background pictures (two or more, Outlook's VML ones included), positioned layers,
 * or more distinct background colours than a careful mapping keeps apart. Read from the email as it came — counting
 * only, nothing is loaded.
 */
export function darkeningRisk(raw: string): { risky: boolean; reasons: string[] } {
  const s = raw || '';
  const count = (re: RegExp) => (s.match(re) ?? []).length;
  const backgrounds = count(/\bbackground\s*=\s*["']?[^\s"'>]+/gi) + count(/background(?:-image)?\s*:[^;"'}]*url\(/gi) + count(/<v:(?:fill|image)\b/gi);
  const positioned = count(/position\s*:\s*absolute/gi);
  const palette = new Set((s.match(/(?:bgcolor\s*=\s*["']?|background(?:-color)?\s*:\s*)(#[0-9a-f]{3,6}\b|rgba?\([^)]*\))/gi) ?? []).map((m) => m.replace(/^.*?(#|rgb)/i, '$1').toLowerCase()));
  const reasons = [...(backgrounds >= 2 ? ['background-images'] : []), ...(positioned >= 2 ? ['positioned'] : []), ...(palette.size >= 14 ? ['palette'] : [])];
  return { risky: reasons.length > 0, reasons };
}

// ── the decision ──────────────────────────────────────────────────────────────────────────────────────────

/** Whether an email is to be dark: the sender's choice, else the setting, else the app's theme. */
export function wantsDark({ appDark, setting, sender }: { appDark: boolean; setting?: BodyTheme | null; sender?: SenderTheme | null }): boolean {
  if (sender) return sender === 'dark';
  if (setting === 'dark') return true;
  if (setting === 'light') return false;
  return appDark;
}

/**
 * How this email is drawn. Asked for dark (Always dark, or this sender's 🌙) a complex design is darkened anyway;
 * under Automatic it keeps its soft light card.
 */
export function decideLook(o: { kind: BodyKind; appDark: boolean; setting?: BodyTheme | null; sender?: SenderTheme | null; risky?: boolean }): BodyLook {
  if (!wantsDark(o)) return { scheme: 'light', darken: false, fallback: false };
  if (o.kind === 'native') return { scheme: 'native', darken: false, fallback: false };
  if (o.kind === 'designed') {
    const asked = o.sender === 'dark' || (!o.sender && o.setting === 'dark');
    return o.risky && !asked ? { scheme: 'light', darken: false, fallback: true } : { scheme: 'dark', darken: true, fallback: false };
  }
  return { scheme: 'dark', darken: false, fallback: false };
}

/** The most senders whose choice is kept; the oldest goes first. */
export const MAX_SENDER_THEMES = 500;

/**
 * The per-sender choices after ☀ / 🌙 on one of their emails: kept when it differs from what the email would get
 * anyway, forgotten when it is the same, so Automatic takes over again.
 */
export function withSenderTheme(current: MailPrefs['bodyThemeSenders'], sender: string, choice: SenderTheme, automatic: SenderTheme): Record<string, SenderTheme> {
  const key = sender.trim().toLowerCase();
  const next: Record<string, SenderTheme> = {};
  for (const [k, v] of Object.entries(current ?? {})) if (k !== key && (v === 'light' || v === 'dark')) next[k] = v;
  if (choice !== automatic && key) next[key] = choice;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SENDER_THEMES))) delete next[k];
  return next;
}

// ── the app's colours ─────────────────────────────────────────────────────────────────────────────────────

export interface FrameColours {
  surface: string;
  ink: string;
  ink2: string;
  ink3: string;
  link: string;
  line: string;
  subtle: string;
}

/** Light Blue and Dark Blue as styles.css draws them: what the frame falls back to for any token it cannot read. */
export const LIGHT_COLOURS: FrameColours = { surface: '#ffffff', ink: '#151a2d', ink2: '#4a5168', ink3: '#5b6275', link: '#23349e', line: '#e3e6ee', subtle: '#eef0f6' };
export const DARK_COLOURS: FrameColours = { surface: '#121a34', ink: '#e8ebf5', ink2: '#b6bdd4', ink3: '#9aa3bd', link: '#5c7cfa', line: '#253052', subtle: '#192343' };
/** The soft light card a light email sits on in the dark theme: slightly off-white, never a white block. */
export const CARD_COLOURS: FrameColours = { surface: '#f5f6f9', ink: '#151a2d', ink2: '#4a5168', ink3: '#5b6275', link: '#23349e', line: '#dfe3ec', subtle: '#eceef4' };

const TOKENS: Record<keyof FrameColours, string> = { surface: '--ws-surface', ink: '--ws-ink', ink2: '--ws-ink-2', ink3: '--ws-ink-3', link: '--ws-indigo', line: '--ws-line', subtle: '--ws-subtle' };

/**
 * The app's colours for light or dark, from its tokens as the page has them now (the profile's stylesheet
 * included). Dark ones are read under `[data-theme='dark']` even while the app is light; light ones only from a light
 * page. Anything that is not a plain hex colour falls back to the built-in palette, so nothing but a colour reaches
 * the frame's CSS.
 */
export function readFrameColours(mode: 'light' | 'dark', doc: Document | null = typeof document !== 'undefined' ? document : null): FrameColours {
  const base = mode === 'dark' ? DARK_COLOURS : LIGHT_COLOURS;
  const root = doc?.documentElement;
  if (!doc || !root || typeof getComputedStyle !== 'function') return base;
  const rootMode = root.dataset.theme === 'dark' ? 'dark' : 'light';
  if (rootMode !== mode && mode === 'light') return base;
  let probe: HTMLElement | null = null;
  let el: Element = root;
  if (rootMode !== mode) {
    probe = doc.createElement('span');
    probe.setAttribute('data-theme', 'dark');
    probe.hidden = true;
    (doc.body ?? root).appendChild(probe);
    el = probe;
  }
  try {
    const style = getComputedStyle(el);
    const out = { ...base };
    for (const key of Object.keys(TOKENS) as Array<keyof FrameColours>) out[key] = normalizeHex(style.getPropertyValue(TOKENS[key]).trim()) ?? base[key];
    return out;
  } finally {
    probe?.remove();
  }
}

// ── colours, light to dark ────────────────────────────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', navy: '#000080', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', purple: '#800080', teal: '#008080',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff', fuchsia: '#ff00ff', yellow: '#ffff00', orange: '#ffa500', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', dimgray: '#696969', dimgrey: '#696969', ghostwhite: '#f8f8ff', snow: '#fffafa', ivory: '#fffff0', beige: '#f5f5dc', aliceblue: '#f0f8ff', azure: '#f0ffff',
  linen: '#faf0e6', seashell: '#fff5ee', honeydew: '#f0fff0', mintcream: '#f5fffa', lavender: '#e6e6fa', floralwhite: '#fffaf0', oldlace: '#fdf5e6', cornsilk: '#fff8dc', lightyellow: '#ffffe0',
  lightblue: '#add8e6', lightcyan: '#e0ffff', darkblue: '#00008b', darkred: '#8b0000', darkgreen: '#006400', dodgerblue: '#1e90ff', royalblue: '#4169e1', steelblue: '#4682b4', crimson: '#dc143c',
  firebrick: '#b22222', orangered: '#ff4500', gold: '#ffd700', darkorange: '#ff8c00', slategray: '#708090', slategrey: '#708090', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', midnightblue: '#191970',
};

/** A CSS colour as hex and alpha, or null for what is not a plain colour (transparent, currentColor, var(), hsl()). */
export function parseColour(value: string): { hex: string; alpha: number } | null {
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return { hex: NAMED[v]!, alpha: 1 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? hex.split('').map((c) => c + c).join('') : hex;
    return { hex: `#${full.slice(0, 6)}`, alpha: full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*(\d{1,3}(?:\.\d+)?%?)[\s,]+(\d{1,3}(?:\.\d+)?%?)[\s,]+(\d{1,3}(?:\.\d+)?%?)(?:\s*[,/]\s*(\d*\.?\d+%?))?\s*\)$/.exec(v);
  if (!rgb) return null;
  const channel = (c: string) => Math.max(0, Math.min(255, Math.round(c.endsWith('%') ? (parseFloat(c) * 255) / 100 : parseFloat(c))));
  const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
  return { hex: `#${[rgb[1]!, rgb[2]!, rgb[3]!].map((c) => channel(c).toString(16).padStart(2, '0')).join('')}`, alpha: Math.max(0, Math.min(1, a)) };
}

/** A colour in an HTML attribute (bgcolor, font color), where old mail also writes hex without its "#". */
const attrColour = (v: string | null) => (v ? parseColour(/^[0-9a-f]{6}$|^[0-9a-f]{3}$/i.test(v.trim()) ? `#${v.trim()}` : v) : null);

const write = (hex: string, alpha: number) => {
  if (alpha >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(alpha * 1000) / 1000})`;
};

/** A colour as the person sees it on the page: mostly see-through over a light page is light. */
const isLight = (o: Oklch) => o.l >= 0.6;

/**
 * A background colour for the dark page. Dark ones and saturated brand colours (a button, a band) stay as they are;
 * light ones turn dark in their own hue — white becomes the app's surface, pale greys a step above it in the app's
 * tint, a pale blue a deep blue — lighter staying above darker, as it was.
 */
export function darkBackground(hex: string, surface: string): string {
  const o = hexToOklch(hex);
  if (!isLight(o) || (o.c >= 0.09 && o.l < 0.82)) return hex;
  const s = hexToOklch(surface);
  if (o.l >= 0.995 && o.c < 0.01) return normalizeHex(surface) ?? surface;
  const l = Math.min(0.48, s.l + (1 - o.l) * 0.55);
  return o.c < 0.03 ? oklchToHex({ l, c: s.c, h: s.h }) : oklchToHex({ l, c: Math.min(o.c * 0.6, 0.07), h: o.h });
}

/** A border: a light one becomes a dark line, a dark one stays. */
export function darkBorder(hex: string, surface: string): string {
  return isLight(hexToOklch(hex)) ? darkBackground(hex, surface) : hex;
}

/**
 * Text on `background` (already mapped). It stays when it reads (4.5:1, WCAG AA): white on a brand button, dark text
 * on an amber band, a light grey. Black and greys that do not read turn into the app's ink, lighter for lighter
 * greys; a coloured one (a link, a red amount) keeps its hue and only gets as much lighter as it needs.
 */
export function readableText(hex: string, background: string, ink: string): string {
  if (contrast(hex, background) >= 4.5) return hex;
  const o = hexToOklch(hex);
  const onDark = hexToOklch(background).l < 0.6;
  if (!onDark) return shiftLightness(o, -1, (h) => contrast(h, background) >= 4.5) ?? '#000000';
  const i = hexToOklch(ink);
  const target: Oklch = o.c < 0.06 ? { l: Math.max(0.72, i.l - o.l * 0.32), c: i.c, h: i.h } : o;
  const first = oklchToHex(target);
  if (contrast(first, background) >= 4.5) return first;
  return shiftLightness(hexToOklch(first), 1, (h) => contrast(h, background) >= 4.5) ?? ink;
}

const COLOUR_TOKEN = new RegExp(`#[0-9a-f]{3,8}\\b|rgba?\\([^)]*\\)|\\b(?:${Object.keys(NAMED).join('|')})\\b`, 'gi');
const DECLARATION = /(^|[;{])(\s*)(color|background-color|background|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline-color|text-decoration-color)(\s*:\s*)([^;{}]*)/gi;

type Role = 'text' | 'background' | 'border';
const roleOf = (prop: string): Role => (prop === 'color' || prop === 'text-decoration-color' ? 'text' : /^background/.test(prop) ? 'background' : 'border');

export interface DarkPalette {
  surface: string;
  ink: string;
}

/** Every colour in a value mapped for its role; anything that is not a plain colour is left as it was. */
function mapValue(value: string, role: Role, p: DarkPalette, onBackground: string): string {
  return value.replace(COLOUR_TOKEN, (token) => {
    const c = parseColour(token);
    if (!c) return token;
    const out = role === 'background' ? darkBackground(c.hex, p.surface) : role === 'border' ? darkBorder(c.hex, p.surface) : readableText(c.hex, onBackground, p.ink);
    return write(out, c.alpha);
  });
}

/** A stylesheet's colours mapped for the dark page: its text against the app's surface, its backgrounds and borders darkened. */
export function darkenCss(css: string, p: DarkPalette): string {
  return css.replace(DECLARATION, (_m, lead: string, space: string, prop: string, colon: string, value: string) => `${lead}${space}${prop}${colon}${mapValue(value, roleOf(prop.toLowerCase()), p, p.surface)}`);
}

/** The colour a declaration list gives a property (the last one wins, as in CSS). */
function declared(style: string, role: Role): { hex: string; alpha: number } | null {
  let found: { hex: string; alpha: number } | null = null;
  for (const m of style.matchAll(DECLARATION)) {
    if (roleOf(m[3]!.toLowerCase()) !== role) continue;
    const tokens = m[5]!.match(COLOUR_TOKEN);
    const c = tokens ? parseColour(tokens[tokens.length - 1]!) : null;
    if (c) found = c;
  }
  return found;
}

/** Could this picture have see-through parts? PNG, GIF and WebP by their type or their address; small, like a logo. */
function maybeTransparent(img: Element, remote: string[]): boolean {
  const w = Number(img.getAttribute('width')) || 0;
  const h = Number(img.getAttribute('height')) || 0;
  if (w > 400 || h > 300) return false;
  const src = img.getAttribute('src') ?? '';
  const n = img.getAttribute('data-ws-img');
  const address = n !== null ? (remote[Number(n)] ?? '') : src;
  if (/^data:image\/(png|gif|webp)[;,]/i.test(address)) return true;
  try {
    return /\.(png|gif|webp)$/i.test(new URL(address).pathname);
  } catch {
    return false;
  }
}

/**
 * A designed email darkened element by element (after sanitising; nothing in it runs). Walking down the tree with the
 * background each element sits on: its own background (a bgcolor, or background in its style) is darkened when light;
 * its text colour is made to read on that background; on a background the email keeps (a brand band, a button) the
 * text keeps the email's colours, as the designer paired them; borders follow. Pictures are left as they are, but one
 * that may be see-through and sat on a light page gets a soft light plate (`data-ws-plate`). Its stylesheets are
 * mapped too.
 */
export function darkenHtml(html: string, p: DarkPalette, remoteImages: string[] = []): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const cache = new Map<string, string>();
  const memo = (key: string, fn: () => string) => {
    let v = cache.get(key);
    if (v === undefined) {
      v = fn();
      cache.set(key, v);
    }
    return v;
  };
  const textOn = (hex: string, bg: string) => memo(`t${hex}${bg}`, () => readableText(hex, bg, p.ink));
  const bgOf = (hex: string) => memo(`b${hex}`, () => darkBackground(hex, p.surface));

  /**
   * What an element sits on and is written in: the background as drawn now and whether it is the email's own (a
   * brand colour or a dark band, kept), the text colour now and as the email had it, and whether the page behind was
   * light before.
   */
  interface At {
    bg: string;
    kept: boolean;
    fg: string;
    fgWas: string;
    lightBehind: boolean;
  }
  const walk = (el: Element, at: At) => {
    if (el.tagName === 'STYLE') {
      el.textContent = darkenCss(el.textContent ?? '', p);
      return;
    }
    if (el.tagName === 'IMG') {
      // Marked while still held back too: the plate shows once the picture does.
      if (at.lightBehind && maybeTransparent(el, remoteImages)) el.setAttribute('data-ws-plate', '');
      return;
    }
    const here = { ...at };
    const style = el.getAttribute('style') ?? '';
    const attrBg = attrColour(el.getAttribute('bgcolor'));
    const ownBg = declared(style, 'background') ?? attrBg;
    if (ownBg && ownBg.alpha > 0.5) {
      here.bg = bgOf(ownBg.hex);
      here.kept = here.bg === ownBg.hex;
      here.lightBehind = isLight(hexToOklch(ownBg.hex));
    }
    if (attrBg) el.setAttribute('bgcolor', bgOf(attrBg.hex));
    let ownText = false;
    const font = el.tagName === 'FONT' ? attrColour(el.getAttribute('color')) : null;
    if (font) {
      here.fgWas = font.hex;
      here.fg = here.kept ? font.hex : textOn(font.hex, here.bg);
      el.setAttribute('color', here.fg);
      ownText = true;
    }
    if (style) {
      // On a background the email keeps, its text keeps the email's colour too: white on a brand button stays white.
      const mapped = style.replace(DECLARATION, (whole, lead: string, space: string, prop: string, colon: string, value: string) => {
        const role = roleOf(prop.toLowerCase());
        return role === 'text' && here.kept ? whole : `${lead}${space}${prop}${colon}${mapValue(value, role, p, here.bg)}`;
      });
      if (mapped !== style) el.setAttribute('style', mapped);
      const given = declared(mapped, 'text');
      if (given) {
        here.fg = given.hex;
        here.fgWas = declared(style, 'text')?.hex ?? given.hex;
        ownText = true;
      }
    }
    // A light brand background kept as the email drew it, under text the dark page had lightened: the email's own
    // dark text, when that reads better there.
    if (ownBg && here.kept && !ownText && here.fg !== here.fgWas && contrast(here.fgWas, here.bg) > contrast(here.fg, here.bg)) {
      here.fg = here.fgWas;
      const now = (el.getAttribute('style') ?? '').trim();
      el.setAttribute('style', `${now}${now && !now.endsWith(';') ? ';' : ''}color:${here.fg}`);
    }
    for (const child of [...el.children]) walk(child, here);
  };
  // An email with no background of its own was drawn for a white page, in dark ink.
  for (const child of [...doc.body.children]) walk(child, { bg: p.surface, kept: false, fg: p.ink, fgWas: LIGHT_COLOURS.ink, lightBehind: true });
  return doc.body.innerHTML;
}

/**
 * An email's own `prefers-color-scheme` media queries, switched for the scheme it is drawn in: in dark its dark rules
 * apply and its light-only ones do not, and the other way round — whatever the computer's own setting is. Static
 * text in its sanitised stylesheet; nothing inside the email decides.
 */
export function forceColourScheme(css: string, scheme: 'light' | 'dark'): string {
  const on = '(min-width:0px)';
  const off = '(max-width:0px)';
  return css.replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi, (_m, which: string) => ((which.toLowerCase() === scheme) ? on : off));
}

/** The widest fixed width a designed email gives itself (a 600px newsletter), for its column; null when it flows. */
export function designedWidth(html: string): number | null {
  let widest = 0;
  for (const m of (html || '').matchAll(/<(?:table|div|td|center)\b[^>]*?(?:\swidth\s*=\s*["']?(\d{3,4})(?:px)?["'\s>]|\sstyle\s*=\s*["'](?:[^"']*?[;\s])?(?:max-)?width\s*:\s*(\d{3,4})px)/gi)) {
    const w = Number(m[1] ?? m[2]);
    if (w >= 320 && w <= 1400) widest = Math.max(widest, w);
  }
  return widest >= 480 ? widest : null;
}

/** The style elements in a body with their colour-scheme media queries switched (an email with dark styles). */
export function forceSchemeInHtml(html: string, scheme: 'light' | 'dark'): string {
  if (!/prefers-color-scheme/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('style').forEach((s) => {
    s.textContent = forceColourScheme(s.textContent ?? '', scheme);
  });
  return doc.body.innerHTML;
}

export interface ReadingBody {
  /** The body for the frame, folded, linked and coloured; pictures are still to be swapped in and linked. */
  html: string;
  kind: BodyKind;
  look: BodyLook;
  /** What this email gets with no choice for its sender: the ☀ / 🌙 switch forgets a choice that matches it. */
  automatic: SenderTheme;
  /** The frame's look, for mailFrameDoc. */
  frame: { scheme: BodyLook['scheme']; colours: FrameColours; outer: string; kind: BodyKind; width: number | null; css: string };
}

/**
 * One body, made ready to read: plain words laid out with their links (or the HTML kept, folded and linked), drawn in
 * the look this email gets — the app's dark colours, its own dark styles, darkened element by element, or light (on
 * a soft card in the dark theme). `plain`: the words, when the body is plain text or the reader asked for it.
 */
export function readingBody(o: { raw: string; html: string; styles: string; remoteImages: string[]; plain: string | null; appDark: boolean; setting?: BodyTheme | null; sender?: SenderTheme | null; light: FrameColours; dark: FrameColours }): ReadingBody {
  const kind = bodyKind({ raw: o.raw, html: o.html, plain: o.plain !== null });
  const risky = kind === 'designed' && darkeningRisk(o.raw).risky;
  const look = decideLook({ kind, appDark: o.appDark, setting: o.setting, sender: o.sender, risky });
  const automatic: SenderTheme = decideLook({ kind, appDark: o.appDark, setting: o.setting, sender: null, risky }).scheme === 'light' ? 'light' : 'dark';
  const scheme = look.scheme === 'light' ? 'light' : 'dark';
  let html = o.plain !== null ? renderPlainText(o.plain) : structureHtml(o.html, { linkify: kind === 'simple' });
  if (look.darken) html = darkenHtml(html, { surface: o.dark.surface, ink: o.dark.ink }, o.remoteImages);
  if (kind === 'native') html = forceSchemeInHtml(html, scheme);
  return {
    html,
    kind,
    look,
    automatic,
    frame: {
      scheme: look.scheme,
      colours: look.scheme === 'light' ? (o.appDark ? CARD_COLOURS : o.light) : o.dark,
      outer: o.appDark ? o.dark.surface : o.light.surface,
      kind,
      width: kind === 'designed' || kind === 'native' ? designedWidth(o.html) : null,
      // Only an email with dark styles of its own brings its stylesheets: they are what its dark look is made of.
      css: kind === 'native' ? forceColourScheme(o.styles, scheme) : '',
    },
  };
}
