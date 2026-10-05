import { contrast, hexToOklch, hueDistance, normalizeHex, oklchToHex, shiftLightness, type Oklch } from './color';
import type { Theme } from './types';

/**
 * Colour profiles (#73, worksuite-desktop#234): one palette per appearance, used by every renderer — the main
 * window, torn-off tabs, call and meeting windows, the tray's windows and anything else drawn from the app's pages.
 *
 * The choice is `appearance { mode, lightProfile, darkProfile, custom }`: Light mode uses the light profile, Dark mode
 * the dark one, and System whichever the computer's appearance says, switching live. A profile is a set of `--ws-*`
 * colour variables written into one stylesheet (`#ws-appearance`) for `:root[data-theme]` — and for any part of a
 * page drawn dark on purpose (`[data-theme='dark']` inside it), which a variable set on the root element alone would
 * not reach — so changing profiles only swaps variables.
 */

export const DARK_PROFILE_IDS = ['purple', 'red', 'green', 'blue', 'orange', 'teal', 'gray'] as const;
export type DarkColorProfile = (typeof DARK_PROFILE_IDS)[number];
/** The built-in profiles, light and dark alike: the same seven hues. */
export const PROFILE_IDS = DARK_PROFILE_IDS;
export type BuiltinProfile = DarkColorProfile;
export const DEFAULT_DARK_PROFILE: DarkColorProfile = 'blue';
export const DEFAULT_LIGHT_PROFILE: BuiltinProfile = 'blue';
export const normalizeDarkProfile = (value: unknown): DarkColorProfile => (DARK_PROFILE_IDS.includes(value as DarkColorProfile) ? (value as DarkColorProfile) : DEFAULT_DARK_PROFILE);
export const isBuiltinProfile = (value: unknown): value is BuiltinProfile => DARK_PROFILE_IDS.includes(value as BuiltinProfile);

export type Tokens = Record<string, string>;
export type Mode = 'light' | 'dark';
/** How tinted the background, surfaces and sidebar are. */
export type Tint = 'neutral' | 'accent' | 'custom';
export const TINTS: readonly Tint[] = ['neutral', 'accent', 'custom'];

export interface ColourSpec {
  accent: string;
  tint: Tint;
  /** The background colour, for `tint: 'custom'`. */
  tintColor?: string | null;
}

/** A person's own profile: one accent, a palette generated from it for light and for dark. */
export interface CustomProfile extends ColourSpec {
  id: string;
  name: string;
}

/** The organisation's profile, from its desktop policy (`appearance_accent` …). */
export interface OrgProfile extends ColourSpec {
  name: string;
}

export interface AppearancePrefs {
  mode: Theme;
  lightProfile: string;
  darkProfile: string;
  custom: CustomProfile[];
  /** The person picked a profile: the organisation's default no longer stands in for one. */
  chosen?: boolean;
  /** When it last changed (ms), so the newer copy wins between devices. */
  updatedAt?: number;
  /** Effective only: the organisation's profile, and whether everyone must use it. */
  org?: OrgProfile | null;
  locked?: boolean;
}

export const MAX_CUSTOM_PROFILES = 5;
export const ORG_PROFILE = 'org';
const CUSTOM_ID = /^c-[a-z0-9]{4,16}$/;

function color(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100,
    l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function tinted(hue: number, gray = false): Tokens {
  const s = gray ? 0 : 24;
  return {
    '--ws-ground': color(hue, s, 7), '--ws-surface': color(hue, s, 11),
    '--ws-subtle': color(hue, s, 15), '--ws-well': color(hue, s, 17),
    '--ws-line': color(hue, gray ? 0 : 18, 27), '--ws-selection': color(hue, gray ? 0 : 35, 23),
    '--ws-navy': color(hue, s, 9), '--ws-navy-2': color(hue, s, 14), '--ws-navy-3': color(hue, s, 21),
    '--ws-navy-ink': color(hue, gray ? 0 : 25, 85),
    '--ws-indigo': color(hue, gray ? 0 : 65, 74), '--ws-indigo-hover': color(hue, gray ? 0 : 65, 82),
    '--ws-brand': color(hue, gray ? 0 : 55, gray ? 36 : 30), '--ws-focus': color(hue, gray ? 0 : 70, 80),
    '--ws-ink': color(hue, gray ? 0 : 20, 94), '--ws-ink-2': color(hue, gray ? 0 : 18, 80), '--ws-ink-3': color(hue, gray ? 0 : 14, 71),
    '--ws-cb-border': color(hue, gray ? 0 : 20, 55), '--ws-cb-border-hover': color(hue, gray ? 0 : 20, 75),
    '--ws-cb-mark': color(hue, s, 7), '--ws-on-primary': color(hue, s, 7),
    '--ws-edge': color(hue, gray ? 0 : 18, 27), '--ws-rail': color(hue, s, 11), '--launcher-bg': color(hue, s, 7),
    '--ws-chat-ground': color(hue, s, 6), '--ws-call-glow': color(hue, s, 28),
    '--ws-call-mid': color(hue, s, 14), '--ws-call-base': color(hue, s, 8),
  };
}

const DARK_BLUE: Tokens = {
  '--ws-ground': '#0b1124', '--ws-surface': '#121a34', '--ws-line': '#253052', '--ws-subtle': '#192343',
  '--ws-selection': '#1c2a5e', '--ws-well': '#1a2447', '--ws-indigo': '#5c7cfa', '--ws-indigo-hover': '#748ffc',
  '--ws-brand': '#3b5bdb', '--ws-focus': '#8da2fb', '--ws-navy': '#0f1b3d', '--ws-navy-2': '#17264f',
  '--ws-navy-3': '#22335f', '--ws-navy-ink': '#c9d1ea', '--ws-ink': '#e8ebf5', '--ws-ink-2': '#b6bdd4',
  '--ws-ink-3': '#9aa3bd', '--ws-cb-border': '#6b779c', '--ws-cb-border-hover': '#9aa3bd',
  '--ws-chat-ground': '#0a0f22', '--ws-call-glow': '#23407a', '--ws-call-mid': '#13224a', '--ws-call-base': '#0b1530',
  '--ws-cb-mark': '#0b1124', '--ws-on-primary': '#0b1124', '--ws-edge': 'rgba(160, 176, 225, 0.16)', '--ws-rail': '#121a34',
  '--launcher-bg': '#0b1124',
};

/** The light theme as styles.css draws it (Light Blue): the default, so it writes nothing. */
export const LIGHT_BLUE: Tokens = {
  '--ws-ground': '#f4f5f9', '--ws-surface': '#ffffff', '--ws-line': '#e3e6ee', '--ws-subtle': '#eef0f6',
  '--ws-selection': '#eef1fd', '--ws-well': '#f4f5f9', '--ws-rail': '#fbfbfd', '--ws-navy': '#0f1b3d',
  '--ws-navy-2': '#17264f', '--ws-navy-3': '#22335f', '--ws-navy-ink': '#c9d1ea', '--ws-indigo': '#23349e',
  '--ws-indigo-hover': '#16236e', '--ws-brand': '#3b5bdb', '--ws-focus': '#3b5bdb', '--ws-ink': '#151a2d',
  '--ws-ink-2': '#4a5168', '--ws-ink-3': '#5b6275', '--ws-on-primary': '#ffffff', '--ws-cb-border': '#8a91a6',
  '--ws-cb-border-hover': '#5b6275', '--ws-cb-mark': '#ffffff', '--ws-edge': 'rgba(15, 27, 61, 0.07)',
};

/** The status colours a custom accent must not be mistaken for. */
export const STATUS_COLOURS: Record<Mode, { danger: string; success: string }> = {
  light: { danger: '#b42318', success: '#1f7a4d' },
  dark: { danger: '#f07167', success: '#43b581' },
};

export interface Palette {
  tokens: Tokens;
  /** The accent as used: the one chosen, or one adjusted for readability. */
  accent: string;
  /** The accent as chosen. */
  original: string;
  adjusted: boolean;
  /** Status colours the accent is close to. */
  near: Array<'danger' | 'success'>;
}

const k = (l: number, c: number, h: number) => oklchToHex({ l, c, h });
const AA = 4.5;
/** White on the brand colour: 4.5:1 with a margin for the main action's hover (`brightness(1.05)`). */
const BRAND_AA = 5;

/**
 * The whole palette for one appearance from one accent (#234): fixed OKLCH lightness steps for each role
 * (background, surfaces, borders, hover, selected, the three text tones, the sidebar and top bar), the background's
 * hue and chroma from the tint, and the accent itself kept unless it fails the contrast checks — text and accent
 * text on the backgrounds 4.5:1, the accent button's own text on it 4.5:1 — when its lightness is moved until it
 * passes.
 */
export function generatePalette(spec: ColourSpec, mode: Mode): Palette {
  const original = normalizeHex(spec.accent) ?? '#3b5bdb';
  const a = hexToOklch(original);
  const ac = Math.min(a.c, 0.2);
  const tintColor = spec.tint === 'custom' ? normalizeHex(spec.tintColor) : null;
  const t = tintColor ? hexToOklch(tintColor) : null;
  const neutral = spec.tint === 'neutral' || (spec.tint === 'custom' && !t);
  const bh = t ? t.h : a.h;
  const tc = t ? Math.min(t.c, 0.14) : ac;
  const dark = mode === 'dark';
  // Background and chrome chroma: barely there for Neutral, a whisper of the accent for Match accent, more of
  // the picked colour for Pick a colour — never so much that text loses its contrast.
  const bgC = neutral ? (dark ? 0.006 : 0.003) : t ? Math.min(tc * (dark ? 0.32 : 0.22), dark ? 0.04 : 0.025) : Math.min(ac * (dark ? 0.18 : 0.1), dark ? 0.03 : 0.012);
  const chromeC = neutral ? 0.018 : t ? Math.min(tc * 0.55, 0.08) : Math.min(ac * 0.45, 0.08);
  const selC = Math.max(bgC, Math.min(ac * (dark ? 0.35 : 0.2), dark ? 0.06 : 0.035));

  const tokens: Tokens = dark
    ? {
        '--ws-ground': k(0.165, bgC, bh), '--ws-chat-ground': k(0.15, bgC, bh), '--launcher-bg': k(0.165, bgC, bh),
        '--ws-surface': k(0.205, bgC, bh), '--ws-rail': k(0.205, bgC, bh), '--ws-subtle': k(0.24, bgC, bh), '--ws-well': k(0.25, bgC, bh),
        '--ws-line': k(0.33, bgC * 1.2, bh), '--ws-edge': k(0.33, bgC * 1.2, bh), '--ws-selection': k(0.3, selC, a.h),
        '--ws-navy': k(0.185, chromeC * 0.6, bh), '--ws-navy-2': k(0.225, chromeC * 0.6, bh), '--ws-navy-3': k(0.285, chromeC * 0.6, bh),
        '--ws-navy-ink': k(0.88, 0.02, bh), '--ws-ink': k(0.955, 0.008, bh), '--ws-ink-2': k(0.84, 0.015, bh), '--ws-ink-3': k(0.76, 0.015, bh),
        '--ws-cb-border': k(0.56, 0.02, bh), '--ws-cb-border-hover': k(0.74, 0.02, bh),
        '--ws-call-glow': k(0.34, chromeC, bh), '--ws-call-mid': k(0.245, chromeC * 0.8, bh), '--ws-call-base': k(0.18, chromeC * 0.6, bh),
      }
    : {
        '--ws-ground': k(0.975, bgC, bh), '--ws-surface': k(1, 0, bh), '--ws-rail': k(0.99, bgC * 0.6, bh), '--launcher-bg': k(1, 0, bh),
        '--ws-subtle': k(0.955, bgC * 1.4, bh), '--ws-well': k(0.965, bgC, bh), '--ws-line': k(0.915, bgC * 1.4, bh),
        '--ws-edge': k(0.93, bgC, bh), '--ws-selection': k(0.95, selC, a.h),
        '--ws-navy': k(0.25, chromeC, neutral ? a.h : bh), '--ws-navy-2': k(0.31, chromeC, neutral ? a.h : bh), '--ws-navy-3': k(0.37, chromeC, neutral ? a.h : bh),
        '--ws-navy-ink': k(0.88, 0.03, neutral ? a.h : bh), '--ws-ink': k(0.2, 0.02, bh), '--ws-ink-2': k(0.42, 0.02, bh), '--ws-ink-3': k(0.49, 0.02, bh),
        '--ws-cb-border': k(0.62, 0.02, bh), '--ws-cb-border-hover': k(0.48, 0.02, bh), '--ws-cb-mark': '#ffffff', '--ws-on-primary': '#ffffff',
        '--ws-call-glow': k(0.34, chromeC, bh), '--ws-call-mid': k(0.245, chromeC * 0.8, bh), '--ws-call-base': k(0.18, chromeC * 0.6, bh),
      };
  if (dark) {
    tokens['--ws-cb-mark'] = tokens['--ws-ground']!;
    tokens['--ws-on-primary'] = tokens['--ws-ground']!;
  }

  // The accent: as text on every background and as a button with its own text on it, 4.5:1.
  const backs = ['--ws-surface', '--ws-ground', '--ws-subtle'].map((n) => tokens[n]!);
  const onPrimary = tokens['--ws-on-primary']!;
  const readable = (hex: string) => backs.every((b) => contrast(hex, b) >= AA) && contrast(onPrimary, hex) >= AA;
  const accent = readable(original) ? original : (shiftLightness({ ...a, c: ac }, dark ? 1 : -1, readable) ?? (dark ? '#ffffff' : '#000000'));
  const used: Oklch = hexToOklch(accent);
  tokens['--ws-indigo'] = accent;
  tokens['--ws-indigo-hover'] = k(Math.min(0.97, Math.max(0.05, used.l + (dark ? 0.06 : -0.07))), used.c, used.h);
  tokens['--ws-focus'] = dark ? (shiftLightness({ l: Math.max(0.8, used.l), c: Math.min(used.c, 0.12), h: used.h }, 1, (h) => contrast(h, tokens['--ws-navy-3']!) >= 3 && contrast(h, tokens['--ws-selection']!) >= 3) ?? '#ffffff') : accent;
  // The brand mark and the main action carry white text, in either appearance — with room for the action's hover,
  // which brightens it by 5%.
  const brandOk = (h: string) => contrast('#ffffff', h) >= BRAND_AA;
  tokens['--ws-brand'] = !dark && brandOk(accent) ? accent : (shiftLightness({ l: Math.min(used.l, 0.55), c: Math.min(used.c, 0.17), h: used.h }, -1, brandOk) ?? '#000000');

  const status = STATUS_COLOURS[mode];
  const near = (['danger', 'success'] as const).filter((s) => {
    const sc = hexToOklch(status[s]);
    return used.c >= 0.07 && hueDistance(used.h, sc.h) <= 22;
  });
  return { tokens, accent, original, adjusted: accent !== original, near };
}

const LIGHT_SEEDS: Record<BuiltinProfile, string> = { blue: '#23349e', purple: '#6d28d9', red: '#be123c', green: '#15803d', orange: '#c2410c', teal: '#0e7c86', gray: '#4b5563' };
const DARK_HUES: Record<BuiltinProfile, number> = { purple: 275, red: 355, green: 145, blue: 225, orange: 28, teal: 180, gray: 220 };
const titled = (id: string) => `${id[0]!.toUpperCase()}${id.slice(1)}`;

export interface ProfileDefinition {
  id: string;
  name: string;
  tokens: Tokens;
}

export const DARK_PROFILES: ProfileDefinition[] = DARK_PROFILE_IDS.map((id) => ({
  id,
  name: `Dark ${titled(id)}`,
  tokens: id === 'blue' ? DARK_BLUE : tinted(DARK_HUES[id], id === 'gray'),
}));

export const LIGHT_PROFILES: ProfileDefinition[] = PROFILE_IDS.map((id) => ({
  id,
  name: `Light ${titled(id)}`,
  tokens: id === 'blue' ? LIGHT_BLUE : generatePalette({ accent: LIGHT_SEEDS[id], tint: id === 'gray' ? 'neutral' : 'accent' }, 'light').tokens,
}));

export const builtinProfiles = (mode: Mode): ProfileDefinition[] => (mode === 'dark' ? DARK_PROFILES : LIGHT_PROFILES);

// ── preferences ────────────────────────────────────────────────────────────────────────────────────────────────

const MODES: readonly Theme[] = ['system', 'light', 'dark'];

export function normalizeSpec(value: unknown): ColourSpec | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const accent = normalizeHex(v.accent);
  if (!accent) return null;
  const tint = TINTS.includes(v.tint as Tint) ? (v.tint as Tint) : 'neutral';
  const tintColor = normalizeHex(v.tintColor);
  if (tint === 'custom' && !tintColor) return { accent, tint: 'neutral' };
  return tint === 'custom' ? { accent, tint, tintColor } : { accent, tint };
}

export const cleanProfileName = (value: unknown): string => (typeof value === 'string' ? value.replace(/[\p{C}]/gu, '').trim().slice(0, 40) : '');

export function normalizeCustom(value: unknown): CustomProfile[] {
  if (!Array.isArray(value)) return [];
  const out: CustomProfile[] = [];
  for (const item of value) {
    if (out.length >= MAX_CUSTOM_PROFILES) break;
    const spec = normalizeSpec(item);
    const id = (item as { id?: unknown })?.id;
    const name = cleanProfileName((item as { name?: unknown })?.name);
    if (!spec || typeof id !== 'string' || !CUSTOM_ID.test(id) || out.some((p) => p.id === id)) continue;
    out.push({ id, name: name || 'Custom', ...spec });
  }
  return out;
}

const validProfile = (id: unknown, custom: CustomProfile[]): id is string =>
  typeof id === 'string' && (isBuiltinProfile(id) || id === ORG_PROFILE || custom.some((p) => p.id === id));

/**
 * Preferences saved in any earlier shape — none at all, only `theme` and `darkColorProfile` (#73), or a profile
 * saved as a label ("Dark Blue ✓") or in capitals — read as the profiles they meant, else the defaults.
 */
export function normalizeAppearance(value: unknown, legacy?: { theme?: unknown; darkColorProfile?: unknown }): AppearancePrefs {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const custom = normalizeCustom(v.custom);
  const readId = (raw: unknown, fallback: string): string => {
    if (validProfile(raw, custom)) return raw;
    if (typeof raw === 'string') {
      const word = raw.toLowerCase().replace(/[^a-z]/g, ' ').split(/\s+/).find((w) => isBuiltinProfile(w));
      if (word) return word;
    }
    return fallback;
  };
  const mode = MODES.includes(v.mode as Theme) ? (v.mode as Theme) : MODES.includes(legacy?.theme as Theme) ? (legacy!.theme as Theme) : 'system';
  const out: AppearancePrefs = {
    mode,
    lightProfile: readId(v.lightProfile, DEFAULT_LIGHT_PROFILE),
    darkProfile: readId(v.darkProfile, readId(legacy?.darkColorProfile, DEFAULT_DARK_PROFILE)),
    custom,
  };
  if (v.chosen === true) out.chosen = true;
  if (typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) && v.updatedAt > 0) out.updatedAt = Math.round(v.updatedAt);
  return out;
}

/** What is saved and synced: the person's own choices, without what the organisation adds. */
export function storedAppearance(a: AppearancePrefs): AppearancePrefs {
  const { org: _org, locked: _locked, ...rest } = a;
  return rest;
}

/** The appearance a set of preferences describes, whichever shape they were saved in. */
export function appearanceOf(prefs: { theme?: unknown; darkColorProfile?: unknown; appearance?: unknown } | null | undefined): AppearancePrefs {
  const a = normalizeAppearance(prefs?.appearance, { theme: prefs?.theme, darkColorProfile: prefs?.darkColorProfile });
  // `theme` is the mode as the rest of the app reads it; it wins when the two disagree.
  if (MODES.includes(prefs?.theme as Theme)) a.mode = prefs!.theme as Theme;
  const raw = prefs?.appearance as AppearancePrefs | undefined;
  if (raw?.org) {
    const org = normalizeSpec(raw.org);
    if (org) a.org = { ...org, name: cleanProfileName(raw.org.name) || 'Organisation' };
  }
  if (raw?.locked === true && a.org) a.locked = true;
  return a;
}

/** The organisation's default from its policy: in force unless the person chose their own, or always when locked. */
export function withOrganisation(a: AppearancePrefs, org: OrgProfile | null, locked: boolean): AppearancePrefs {
  if (!org) return { ...a, org: null };
  const out: AppearancePrefs = { ...a, org, ...(locked ? { locked: true } : {}) };
  if (locked || !a.chosen) {
    out.lightProfile = ORG_PROFILE;
    out.darkProfile = ORG_PROFILE;
  }
  return out;
}

/** A profile's palette for one appearance; null where styles.css already draws it (Light Blue). */
export function profileTokens(id: string, mode: Mode, a: Pick<AppearancePrefs, 'custom' | 'org'>): Tokens | null {
  if (id === ORG_PROFILE && a.org) return generatePalette(a.org, mode).tokens;
  const custom = a.custom.find((p) => p.id === id);
  if (custom) return generatePalette(custom, mode).tokens;
  const builtin = builtinProfiles(mode).find((p) => p.id === id) ?? builtinProfiles(mode).find((p) => p.id === 'blue')!;
  return mode === 'light' && builtin.id === 'blue' ? null : builtin.tokens;
}

/** A profile's colours for its card: always the full set, Light Blue's included. */
export function cardTokens(id: string, mode: Mode, a: Pick<AppearancePrefs, 'custom' | 'org'>): Tokens {
  return profileTokens(id, mode, a) ?? LIGHT_BLUE;
}

export interface ResolvedAppearance {
  theme: Mode;
  /** The profile in force now. */
  profile: string;
  lightProfile: string;
  darkProfile: string;
  light: Tokens | null;
  dark: Tokens | null;
}

export function resolveAppearance(a: AppearancePrefs, systemDark: boolean): ResolvedAppearance {
  const theme: Mode = a.mode === 'dark' || (a.mode === 'system' && systemDark) ? 'dark' : 'light';
  const fit = (id: string) => (validProfile(id, a.custom) && (id !== ORG_PROFILE || !!a.org) ? id : 'blue');
  const lightProfile = fit(a.lightProfile);
  const darkProfile = fit(a.darkProfile);
  return {
    theme,
    profile: theme === 'dark' ? darkProfile : lightProfile,
    lightProfile,
    darkProfile,
    light: profileTokens(lightProfile, 'light', a),
    dark: profileTokens(darkProfile, 'dark', a),
  };
}

/** Lines, secondary text and focus give way to High contrast (styles.css) when it is on. */
const CONTRAST_KEYS = new Set(['--ws-line', '--ws-ink-2', '--ws-ink-3', '--ws-focus']);

function rule(selector: string, tokens: Tokens, contrastKeys: boolean): string {
  const lines = Object.entries(tokens)
    .filter(([name]) => CONTRAST_KEYS.has(name) === contrastKeys)
    .map(([name, value]) => `  ${name}: ${value};`);
  return lines.length ? `${selector} {\n${lines.join('\n')}\n}` : '';
}

/** The stylesheet for a resolved appearance. */
export function appearanceCss(r: ResolvedAppearance): string {
  const parts: string[] = [];
  if (r.light) {
    parts.push(rule(":root[data-theme='light']", r.light, false));
    parts.push(rule(":root[data-theme='light']:not([data-contrast='more'])", r.light, true));
  }
  if (r.dark) {
    parts.push(rule(":root[data-theme='dark'],\n:root [data-theme='dark']", r.dark, false));
    parts.push(rule(":root[data-theme='dark']:not([data-contrast='more']),\n:root:not([data-contrast='more']) [data-theme='dark']", r.dark, true));
  }
  return parts.filter(Boolean).join('\n');
}

export const APPEARANCE_STYLE_ID = 'ws-appearance';
/** How long colours ease from one profile to the next. */
export const THEME_TRANSITION_MS = 180;
const timers = new WeakMap<Document, ReturnType<typeof setTimeout>>();

/**
 * Applies an appearance to a page, synchronously: `data-theme`, `data-profile` and `data-dark-profile` on the root,
 * and the profile stylesheet. `transition`: colours ease over a moment (a change made now, not the first paint).
 */
export function applyAppearance(doc: Document, a: AppearancePrefs, systemDark: boolean, opts: { transition?: boolean } = {}): ResolvedAppearance {
  const r = resolveAppearance(a, systemDark);
  const root = doc.documentElement;
  const css = appearanceCss(r);
  let style = doc.getElementById(APPEARANCE_STYLE_ID) as HTMLStyleElement | null;
  const changed = root.dataset.theme !== r.theme || root.dataset.profile !== r.profile || (style?.textContent ?? '') !== css;
  if (changed && opts.transition) {
    root.dataset.themeChanging = '';
    const prev = timers.get(doc);
    if (prev) clearTimeout(prev);
    timers.set(
      doc,
      setTimeout(() => delete root.dataset.themeChanging, THEME_TRANSITION_MS + 60),
    );
  }
  root.dataset.theme = r.theme;
  root.dataset.profile = r.profile;
  root.dataset.darkProfile = r.darkProfile;
  root.dataset.lightProfile = r.lightProfile;
  if (!style) {
    style = doc.createElement('style');
    style.id = APPEARANCE_STYLE_ID;
    (doc.head ?? root).appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
  return r;
}

/** What a window is filled with before its page paints, and its title bar's colour. */
export function lookOf(r: ResolvedAppearance): { ground: string; surface: string; chrome: string } {
  const t = r.theme === 'dark' ? (r.dark ?? DARK_BLUE) : (r.light ?? LIGHT_BLUE);
  const solid = (v: string | undefined, fallback: string) => normalizeHex(v) ?? fallback;
  return { ground: solid(t['--ws-ground'], '#f4f5f9'), surface: solid(t['--ws-surface'], '#ffffff'), chrome: solid(t['--ws-navy'], '#0f1b3d') };
}

// ── sharing ───────────────────────────────────────────────────────────────────────────────────────────────────

const CODE_PREFIX = 'WS1.';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export interface SharedProfile extends ColourSpec {
  name: string;
}

/** A short code to paste: `WS1.` and the profile, compactly. */
export function exportProfileCode(p: SharedProfile): string {
  const tint = p.tint === 'custom' ? 'c' : p.tint === 'accent' ? 'a' : 'n';
  const body = [p.accent.replace('#', ''), tint, p.tint === 'custom' ? (p.tintColor ?? '').replace('#', '') : '', p.name].join('|');
  return CODE_PREFIX + toBase64Url(body);
}

export function exportProfileJson(p: SharedProfile): string {
  const spec = normalizeSpec(p) ?? { accent: p.accent, tint: 'neutral' as const };
  return JSON.stringify({ type: 'worksuite.colour-profile', version: 1, name: p.name, ...spec }, null, 2);
}

/** A profile from a short code or its JSON; null when it is neither. */
export function importProfile(text: string): SharedProfile | null {
  const raw = text.trim();
  try {
    if (raw.startsWith(CODE_PREFIX)) {
      const [accent, t, tintColor, ...name] = fromBase64Url(raw.slice(CODE_PREFIX.length)).split('|');
      const tint: Tint = t === 'c' ? 'custom' : t === 'a' ? 'accent' : 'neutral';
      const spec = normalizeSpec({ accent: `#${accent}`, tint, tintColor: tintColor ? `#${tintColor}` : null });
      return spec ? { ...spec, name: cleanProfileName(name.join('|')) || 'Imported' } : null;
    }
    const json = JSON.parse(raw) as Record<string, unknown>;
    const spec = normalizeSpec(json);
    return spec ? { ...spec, name: cleanProfileName(json.name) || 'Imported' } : null;
  } catch {
    return null;
  }
}

/** A new custom profile's id. */
export function newProfileId(taken: readonly { id: string }[], random: () => number = Math.random): string {
  for (;;) {
    const id = `c-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
    if (!taken.some((p) => p.id === id)) return id;
  }
}
