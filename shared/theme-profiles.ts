/** One palette used by every renderer, including detached chat and meeting windows. */
export const DARK_PROFILE_IDS = ['purple', 'red', 'green', 'blue', 'orange', 'teal', 'gray'] as const;
export type DarkColorProfile = typeof DARK_PROFILE_IDS[number];
export const DEFAULT_DARK_PROFILE: DarkColorProfile = 'blue';
export const normalizeDarkProfile = (value: unknown): DarkColorProfile => DARK_PROFILE_IDS.includes(value as DarkColorProfile) ? value as DarkColorProfile : DEFAULT_DARK_PROFILE;

function color(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100, l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function tinted(hue: number, gray = false): Record<string, string> {
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
    '--ws-edge': color(hue, gray ? 0 : 18, 27),
    '--ws-chat-ground': color(hue, s, 6), '--ws-call-glow': color(hue, s, 28),
    '--ws-call-mid': color(hue, s, 14), '--ws-call-base': color(hue, s, 8),
  };
}

const blue: Record<string, string> = {
  '--ws-ground': '#0b1124', '--ws-surface': '#121a34', '--ws-line': '#253052', '--ws-subtle': '#192343',
  '--ws-selection': '#1c2a5e', '--ws-well': '#1a2447', '--ws-indigo': '#5c7cfa', '--ws-indigo-hover': '#748ffc',
  '--ws-brand': '#3b5bdb', '--ws-focus': '#8da2fb', '--ws-navy': '#0f1b3d', '--ws-navy-2': '#17264f',
  '--ws-navy-3': '#22335f', '--ws-navy-ink': '#c9d1ea', '--ws-ink': '#e8ebf5', '--ws-ink-2': '#b6bdd4',
  '--ws-ink-3': '#9aa3bd', '--ws-cb-border': '#6b779c', '--ws-cb-border-hover': '#9aa3bd',
  '--ws-chat-ground': '#0a0f22', '--ws-call-glow': '#23407a', '--ws-call-mid': '#13224a', '--ws-call-base': '#0b1530',
  '--ws-cb-mark': '#0b1124', '--ws-on-primary': '#0b1124', '--ws-edge': 'rgba(160, 176, 225, 0.16)',
};
export const DARK_PROFILES = DARK_PROFILE_IDS.map((id) => ({
  id,
  name: `Dark ${id[0]!.toUpperCase()}${id.slice(1)}`,
  tokens: id === 'blue' ? blue : tinted(({ purple: 275, red: 355, green: 145, orange: 28, teal: 180, gray: 220 } as Record<string, number>)[id]!, id === 'gray'),
}));

/** Clear all overrides on light mode so the original light palette stays intact. */
export function applyDarkProfile(root: HTMLElement, value: unknown, dark: boolean): void {
  const id = normalizeDarkProfile(value);
  root.dataset.darkProfile = id;
  const tokens = DARK_PROFILES.find((p) => p.id === id)!.tokens;
  for (const [name, color] of Object.entries(tokens)) {
    if (dark) root.style.setProperty(name, color);
    else root.style.removeProperty(name);
  }
}
