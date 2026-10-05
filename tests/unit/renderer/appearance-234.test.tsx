// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../../../shared/types';
import { contrast, hexToOklch, oklchToHex } from '../../../shared/color';
import {
  appearanceOf,
  applyAppearance,
  cardTokens,
  DARK_PROFILES,
  exportProfileCode,
  exportProfileJson,
  generatePalette,
  importProfile,
  LIGHT_PROFILES,
  MAX_CUSTOM_PROFILES,
  normalizeAppearance,
  resolveAppearance,
  withOrganisation,
  type CustomProfile,
  type Mode,
  type OrgProfile,
  type Tint,
} from '../../../shared/theme-profiles';

/**
 * Appearance (worksuite-desktop#234): profiles that apply at once in every window, System that follows the computer,
 * custom profiles generated in OKLCH and checked for contrast, and the cards that choose them.
 */
const net = vi.hoisted(() => ({ call: vi.fn(), events: new Map<string, (value: unknown) => void>(), media: { matches: false, changed: () => {} } }));
vi.mock('../../../src/core/bridge', () => ({ call: net.call, hasDesktop: () => true, on: (name: string, cb: (value: unknown) => void) => { net.events.set(name, cb); return () => {}; }, errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ get matches() { return net.media.matches; }, addEventListener: (_: string, cb: () => void) => { net.media.changed = cb; } }) });

const { app, initAppState, updatePrefs } = await import('../../../src/core/app-state');
const { ColorProfiles } = await import('../../../src/modules/settings/Appearance');

const LOCK_REASON = 'Your organization sets the colour profile.';

/**
 * The main process's settings behind the bridge, as far as appearance goes (the service itself is tested in
 * tests/unit/electron/appearance-234.test.ts): a partial appearance merged into the saved one, `theme` the mode,
 * the organisation's profile standing in, and a locked key refused.
 */
function fakeSettings(initial: Partial<Preferences>) {
  let prefs = { theme: 'system', density: 'comfortable', language: 'en', ...initial } as Preferences;
  let stored = normalizeAppearance(initial.appearance, { theme: prefs.theme, darkColorProfile: prefs.darkColorProfile });
  let org: OrgProfile | null = null;
  let locked = false;
  const locks = () => (org && locked ? [{ key: 'appearance' as const, reason: LOCK_REASON }, { key: 'darkColorProfile' as const, reason: LOCK_REASON }] : []);
  return {
    raw: () => ({ ...prefs, appearance: stored, theme: stored.mode, darkColorProfile: stored.darkProfile as Preferences['darkColorProfile'] }),
    effective: (): Preferences => ({ ...prefs, theme: stored.mode, appearance: withOrganisation(stored, org, locked) }),
    locks,
    setPolicy(p: { accent: string; tint?: Tint; locked?: boolean } | null) {
      org = p ? { accent: p.accent, tint: p.tint ?? 'neutral', name: 'Organisation' } : null;
      locked = !!p?.locked;
    },
    update(patch: Partial<Preferences>) {
      const refused = new Set<string>(locks().map((l) => l.key));
      const { appearance, ...rest } = Object.fromEntries(Object.entries(patch).filter(([k]) => !refused.has(k))) as Partial<Preferences>;
      prefs = { ...prefs, ...rest };
      stored = normalizeAppearance({ ...stored, ...appearance, ...(rest.theme ? { mode: rest.theme } : {}) });
    },
  };
}

let settings: ReturnType<typeof fakeSettings>;
function serve(policy: { accent: string; tint?: Tint; locked?: boolean } | null = null, initial: Partial<Preferences> = {}) {
  settings = fakeSettings(initial);
  settings.setPolicy(policy);
  net.call.mockImplementation(async (channel: string, patch?: Partial<Preferences>) => {
    if (channel === 'app:info') return { platform: 'linux' };
    if (channel === 'auth:state') return { stage: 'signed-out' };
    if (channel === 'settings:set') settings.update(patch ?? {});
    if (channel === 'settings:get' || channel === 'settings:set') return { preferences: settings.effective(), locks: settings.locks() };
    return null;
  });
}

const root = () => document.documentElement;
const sheet = () => document.getElementById('ws-appearance')?.textContent ?? '';
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

beforeEach(() => {
  net.media.matches = false;
  net.events.clear();
  net.call.mockReset();
  serve();
  root().removeAttribute('style');
  for (const a of ['data-theme', 'data-profile', 'data-dark-profile', 'data-light-profile', 'data-theme-changing']) root().removeAttribute(a);
  document.getElementById('ws-appearance')?.remove();
});
afterEach(cleanup);

const ACCENTS = ['#ff0000', '#ffd400', '#00ff00', '#0000ff', '#ffffff', '#000000', '#7fffd4', '#808080', '#3b5bdb', '#ff69b4', '#ff8800', '#663399', '#e0e0e0'];
const TINT_LIST: Tint[] = ['neutral', 'accent', 'custom'];

describe('palette generation in OKLCH, and contrast (#234)', () => {
  it('converts sRGB to OKLCH and back without drift', () => {
    for (const hex of ['#3b5bdb', '#be123c', '#0e7c86', '#ffffff', '#000000', '#808080']) expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 3);
  });

  for (const mode of ['light', 'dark'] as Mode[])
    for (const tint of TINT_LIST)
      it(`${mode}, ${tint} tint: every text and the accent button pass 4.5:1, whatever the accent`, () => {
        for (const accent of ACCENTS) {
          const t = generatePalette({ accent, tint, tintColor: '#ff0066' }, mode).tokens;
          for (const bg of ['ground', 'surface', 'subtle', 'selection', 'well'])
            for (const ink of ['ink', 'ink-2', 'ink-3']) expect(contrast(t[`--ws-${ink}`]!, t[`--ws-${bg}`]!), `${accent} ${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
          for (const bg of ['ground', 'surface', 'subtle']) expect(contrast(t['--ws-indigo']!, t[`--ws-${bg}`]!), `${accent} accent on ${bg}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t['--ws-on-primary']!, t['--ws-indigo']!), `${accent} button text`).toBeGreaterThanOrEqual(4.5);
          expect(contrast('#ffffff', t['--ws-brand']!), `${accent} brand`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t['--ws-navy-ink']!, t['--ws-navy-3']!), `${accent} sidebar`).toBeGreaterThanOrEqual(4.5);
          expect(contrast('#ffffff', t['--ws-navy']!), `${accent} top bar`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t['--ws-cb-border']!, t['--ws-surface']!)).toBeGreaterThanOrEqual(3);
        }
      });

  it('generates light and dark separately: a light ground and white surfaces, a dark ground and light text', () => {
    const light = generatePalette({ accent: '#6d28d9', tint: 'accent' }, 'light').tokens;
    const dark = generatePalette({ accent: '#6d28d9', tint: 'accent' }, 'dark').tokens;
    expect(hexToOklch(light['--ws-ground']!).l).toBeGreaterThan(0.95);
    expect(light['--ws-surface']).toBe('#ffffff');
    expect(hexToOklch(dark['--ws-ground']!).l).toBeLessThan(0.2);
    expect(hexToOklch(dark['--ws-ink']!).l).toBeGreaterThan(0.9);
    // Neutral is near grey; Match accent leans to the accent's hue; Pick a colour to that colour's.
    expect(hexToOklch(generatePalette({ accent: '#6d28d9', tint: 'neutral' }, 'dark').tokens['--ws-surface']!).c).toBeLessThan(0.01);
    expect(Math.abs(hexToOklch(dark['--ws-surface']!).h - hexToOklch('#6d28d9').h)).toBeLessThan(15);
    const picked = generatePalette({ accent: '#6d28d9', tint: 'custom', tintColor: '#0e7c86' }, 'dark').tokens;
    expect(Math.abs(hexToOklch(picked['--ws-surface']!).h - hexToOklch('#0e7c86').h)).toBeLessThan(15);
  });

  it('keeps a readable accent as chosen, and moves the lightness of one that fails, keeping the original', () => {
    const fine = generatePalette({ accent: '#23349e', tint: 'neutral' }, 'light');
    expect(fine).toMatchObject({ accent: '#23349e', original: '#23349e', adjusted: false });
    const yellow = generatePalette({ accent: '#ffd400', tint: 'accent' }, 'light');
    expect(yellow.adjusted).toBe(true);
    expect(yellow.original).toBe('#ffd400');
    expect(hexToOklch(yellow.accent).l).toBeLessThan(hexToOklch('#ffd400').l);
    expect(Math.abs(hexToOklch(yellow.accent).h - hexToOklch('#ffd400').h)).toBeLessThan(8);
    const navy = generatePalette({ accent: '#1e1b4b', tint: 'accent' }, 'dark');
    expect(navy.adjusted).toBe(true);
    expect(hexToOklch(navy.accent).l).toBeGreaterThan(hexToOklch('#1e1b4b').l);
  });

  it('warns when the accent is close to the error red or the success green', () => {
    expect(generatePalette({ accent: '#dc2626', tint: 'accent' }, 'light').near).toEqual(['danger']);
    expect(generatePalette({ accent: '#16a34a', tint: 'accent' }, 'dark').near).toEqual(['success']);
    expect(generatePalette({ accent: '#3b5bdb', tint: 'accent' }, 'light').near).toEqual([]);
  });

  it('every built-in light profile is readable too, Light Blue being the light theme as it was', () => {
    expect(LIGHT_PROFILES.map((p) => p.id)).toEqual(DARK_PROFILES.map((p) => p.id));
    expect(LIGHT_PROFILES.find((p) => p.id === 'blue')!.tokens['--ws-indigo']).toBe('#23349e');
    for (const p of LIGHT_PROFILES) for (const bg of ['ground', 'surface', 'selection']) expect(contrast(p.tokens['--ws-ink-3']!, p.tokens[`--ws-${bg}`]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('applying a profile (#234)', () => {
  it('writes the theme, the profile and one stylesheet; Light Blue writes nothing over styles.css', () => {
    const a = normalizeAppearance({ mode: 'light', lightProfile: 'teal', darkProfile: 'purple' });
    applyAppearance(document, a, false);
    expect(root().dataset).toMatchObject({ theme: 'light', profile: 'teal', lightProfile: 'teal', darkProfile: 'purple' });
    expect(sheet()).toContain(`--ws-ground: ${LIGHT_PROFILES.find((p) => p.id === 'teal')!.tokens['--ws-ground']};`);
    // Parts of a page drawn dark on purpose (the full-screen launcher) get the Dark profile, not Dark Blue.
    expect(sheet()).toContain(":root [data-theme='dark']");
    expect(sheet()).toContain(`--ws-surface: ${DARK_PROFILES.find((p) => p.id === 'purple')!.tokens['--ws-surface']};`);
    applyAppearance(document, normalizeAppearance({ mode: 'light' }), false);
    expect(sheet()).not.toContain(":root[data-theme='light']");
    expect(root().style.length).toBe(0);
  });

  it('eases a change made now, and not the first paint', () => {
    vi.useFakeTimers();
    try {
      applyAppearance(document, normalizeAppearance({ mode: 'dark' }), false);
      expect(root().dataset.themeChanging).toBeUndefined();
      applyAppearance(document, normalizeAppearance({ mode: 'dark', darkProfile: 'green' }), false, { transition: true });
      expect(root().dataset.themeChanging).toBe('');
      vi.advanceTimersByTime(300);
      expect(root().dataset.themeChanging).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads profiles saved as a label or in capitals as the profile they name, and unknown ones as the default', () => {
    expect(normalizeAppearance({ darkProfile: 'Dark Purple ✓', lightProfile: 'TEAL' })).toMatchObject({ darkProfile: 'purple', lightProfile: 'teal' });
    expect(normalizeAppearance({ darkProfile: 'c-gone1', lightProfile: 'pink' })).toMatchObject({ darkProfile: 'blue', lightProfile: 'blue' });
    expect(appearanceOf({ theme: 'dark', darkColorProfile: 'red' })).toMatchObject({ mode: 'dark', darkProfile: 'red', lightProfile: 'blue' });
  });

  it('a profile picked updates this window at once, is saved, and Reset to Default brings back Dark Blue', async () => {
    serve(null, { theme: 'dark' });
    await initAppState();
    expect(root().dataset).toMatchObject({ theme: 'dark', profile: 'blue' });
    await updatePrefs({ appearance: { darkProfile: 'orange', chosen: true } } as Partial<Preferences>);
    expect(root().dataset.profile).toBe('orange');
    expect(sheet()).toContain(DARK_PROFILES.find((p) => p.id === 'orange')!.tokens['--ws-surface']!);
    expect(settings.raw().appearance).toMatchObject({ darkProfile: 'orange', chosen: true });
    await updatePrefs({ appearance: { lightProfile: 'blue', darkProfile: 'blue', chosen: false } } as Partial<Preferences>);
    expect(root().dataset.profile).toBe('blue');
    expect(sheet()).toContain('--ws-surface: #121a34;');
  });

  it('System uses the Light profile in light appearance and the Dark one in dark, switching live', async () => {
    serve(null, { theme: 'system', appearance: { lightProfile: 'green', darkProfile: 'purple' } as never });
    await initAppState();
    expect(root().dataset).toMatchObject({ theme: 'light', profile: 'green' });
    expect(app.get().resolvedTheme).toBe('light');
    net.media.matches = true;
    act(() => net.media.changed());
    expect(root().dataset).toMatchObject({ theme: 'dark', profile: 'purple' });
    expect(app.get().resolvedTheme).toBe('dark');
    net.media.matches = false;
    act(() => net.media.changed());
    expect(root().dataset).toMatchObject({ theme: 'light', profile: 'green' });
  });

  it('applies a change made in another window, from the window manager, at once', async () => {
    await initAppState();
    act(() => net.events.get('appearance:changed')!(normalizeAppearance({ mode: 'dark', darkProfile: 'teal' })));
    expect(root().dataset).toMatchObject({ theme: 'dark', profile: 'teal' });
    expect(app.get().prefs?.theme).toBe('dark');
  });

  it("the organisation's default stands in until the person picks their own; locked, it stays", async () => {
    serve({ accent: '#be123c', tint: 'accent' }, { theme: 'dark' });
    await initAppState();
    expect(root().dataset.profile).toBe('org');
    expect(sheet()).toContain(`--ws-indigo: ${generatePalette({ accent: '#be123c', tint: 'accent' }, 'dark').accent};`);
    await updatePrefs({ appearance: { darkProfile: 'green', chosen: true } } as Partial<Preferences>);
    expect(root().dataset.profile).toBe('green');
    settings.setPolicy({ accent: '#be123c', locked: true });
    await updatePrefs({ appearance: { darkProfile: 'red', chosen: true } } as Partial<Preferences>);
    expect(root().dataset.profile).toBe('org');
    expect(app.get().locks.map((l) => l.key)).toEqual(['appearance', 'darkColorProfile']);
    const r = resolveAppearance(appearanceOf(settings.effective()), true);
    expect(r.dark?.['--ws-indigo']).toBe(generatePalette({ accent: '#be123c', tint: 'neutral' }, 'dark').accent);
  });
});

function renderProfiles() {
  const view = render(<ColorProfiles prefs={app.get().prefs!} />);
  const unsubscribe = app.subscribe(() => view.rerender(<ColorProfiles prefs={app.get().prefs!} />));
  return { ...view, unsubscribe };
}

describe('the profile cards (#234)', () => {
  it('two radio groups of cards in their real colours, the selection a ring and a check badge', async () => {
    serve(null, { theme: 'dark', appearance: { darkProfile: 'purple' } as never });
    await initAppState();
    const view = renderProfiles();
    const dark = screen.getByRole('radiogroup', { name: 'Dark profiles' });
    const light = screen.getByRole('radiogroup', { name: 'Light profiles' });
    expect(within(dark).getAllByRole('radio')).toHaveLength(7);
    expect(within(light).getAllByRole('radio')).toHaveLength(7);
    const purple = within(dark).getByRole('radio', { name: 'Dark Purple' });
    expect(purple.getAttribute('aria-checked')).toBe('true');
    expect(purple.className).toContain('ring-2');
    expect(purple.querySelector('[data-check-badge]')).toBeTruthy();
    expect(purple.textContent).not.toContain('✓');
    expect(within(dark).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(within(dark).getByRole('radio', { name: 'Dark Red' }).querySelector('[data-check-badge]')).toBeNull();
    // Each card is drawn in its profile's own colours.
    for (const p of DARK_PROFILES) {
      const card = within(dark).getByRole('radio', { name: p.id === 'blue' ? 'Dark Blue (default)' : p.name });
      expect(card.style.background).toBe(rgb(p.tokens['--ws-ground']!));
    }
    expect(within(light).getByRole('radio', { name: 'Light Teal' }).style.background).toBe(rgb(cardTokens('teal', 'light', { custom: [] })['--ws-ground']!));
    // Only the selected card is in the tab order; the arrows choose the next one.
    expect(purple.tabIndex).toBe(0);
    fireEvent.keyDown(purple, { key: 'ArrowRight' });
    await waitFor(() => expect(root().dataset.profile).toBe('red'));
    expect(within(dark).getByRole('radio', { name: 'Dark Red' }).getAttribute('aria-checked')).toBe('true');
    view.unsubscribe();
  });

  it('a Dark profile picked while the app is set to Light switches to Dark, so it shows at once', async () => {
    serve(null, { theme: 'light' });
    await initAppState();
    const view = renderProfiles();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark Green' }));
    await waitFor(() => expect(root().dataset).toMatchObject({ theme: 'dark', profile: 'green' }));
    expect(settings.raw().theme).toBe('dark');
    view.unsubscribe();
  });

  it('Custom opens an editor with a picker, hex, presets, tint and a live preview; Save adds the profile and uses it', async () => {
    serve(null, { theme: 'dark' });
    await initAppState();
    const view = renderProfiles();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Dark profiles' }).parentElement!).getByRole('button', { name: 'Custom' }));
    const dialog = await screen.findByRole('dialog');
    const button = () => within(within(dialog).getByRole('figure', { name: 'Dark' })).getByText('Button');
    fireEvent.change(within(dialog).getByLabelText('Accent hex'), { target: { value: '#0e7c86' } });
    expect(button().style.background).toBe(rgb(generatePalette({ accent: '#0e7c86', tint: 'accent' }, 'dark').accent));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Violet' }));
    expect(button().style.background).toBe(rgb(generatePalette({ accent: '#6d28d9', tint: 'accent' }, 'dark').accent));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Pick a colour' }));
    fireEvent.change(within(dialog).getByLabelText('Background colour'), { target: { value: '#0f766e' } });
    expect(within(within(dialog).getByRole('figure', { name: 'Light' })).getByText('Selected row')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Brand' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const saved = settings.raw().appearance!.custom;
    expect(saved).toEqual([expect.objectContaining({ name: 'Brand', accent: '#6d28d9', tint: 'custom', tintColor: '#0f766e' })]);
    expect(root().dataset.profile).toBe(saved[0]!.id);
    expect(screen.getByRole('radio', { name: 'Brand', checked: true })).toBeTruthy();
    view.unsubscribe();
  });

  it('a colour that fails is adjusted, says so, and shows the original on request; one close to red is warned about', async () => {
    serve(null, { theme: 'light' });
    await initAppState();
    const view = renderProfiles();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Light profiles' }).parentElement!).getByRole('button', { name: 'Custom' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Accent hex'), { target: { value: '#ffd400' } });
    expect(within(dialog).getByText(/Adjusted for readability/)).toBeTruthy();
    const button = () => within(within(dialog).getByRole('figure', { name: 'Light' })).getByText('Button');
    expect(button().style.background).toBe(rgb(generatePalette({ accent: '#ffd400', tint: 'accent' }, 'light').accent));
    fireEvent.click(within(dialog).getByRole('button', { name: 'See original' }));
    expect(button().style.background).toBe(rgb('#ffd400'));
    fireEvent.change(within(dialog).getByLabelText('Accent hex'), { target: { value: '#dc2626' } });
    expect(within(dialog).getByText(/close to the red used for errors/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Accent hex'), { target: { value: 'nope' } });
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    view.unsubscribe();
  });

  it('keeps up to five custom profiles: edit, duplicate and delete them, and Custom gives way at five', async () => {
    const custom: CustomProfile[] = Array.from({ length: 4 }, (_, i) => ({ id: `c-abcd${i}`, name: `Mine ${i}`, accent: '#3b5bdb', tint: 'neutral' }));
    serve(null, { theme: 'dark', appearance: { custom, darkProfile: 'c-abcd0' } as never });
    await initAppState();
    const view = renderProfiles();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Mine 1' }));
    await waitFor(() => expect(settings.raw().appearance!.custom).toHaveLength(5));
    expect(settings.raw().appearance!.custom[4]!.name).toBe('Mine 1 copy');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Duplicate Mine 0' }) as HTMLButtonElement).disabled).toBe(true));
    for (const b of screen.getAllByRole('button', { name: 'Custom' })) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(MAX_CUSTOM_PROFILES).toBe(5);
    // Edit
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mine 2' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(settings.raw().appearance!.custom.find((p) => p.id === 'c-abcd2')!.name).toBe('Renamed'));
    // Delete the one in use: it gives way to the default.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Mine 0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(settings.raw().appearance!.custom.some((p) => p.id === 'c-abcd0')).toBe(false));
    expect(root().dataset.profile).toBe('blue');
    view.unsubscribe();
  });

  it('locked by the organisation: shown locked with the reason, nothing to pick or add', async () => {
    serve({ accent: '#be123c', locked: true }, { theme: 'dark' });
    await initAppState();
    const view = renderProfiles();
    expect(screen.getByText('Set by your organization')).toBeTruthy();
    expect(screen.getAllByText('Your organization sets the colour profile.').length).toBeGreaterThan(0);
    const org = screen.getAllByRole('radio', { name: 'Organisation default' });
    expect(org.every((r) => r.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(screen.getAllByRole('radio', { name: 'Dark Red' })[0]!.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Custom' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark Red' }));
    expect(root().dataset.profile).toBe('org');
    view.unsubscribe();
  });
});

describe('sharing profiles (#234)', () => {
  const p = { name: 'Team “blue”', accent: '#1d4ed8', tint: 'custom' as const, tintColor: '#0f172a' };

  it('as a short code and as JSON, both read back as the same profile', () => {
    const code = exportProfileCode(p);
    expect(code).toMatch(/^WS1\.[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(80);
    expect(importProfile(code)).toEqual(p);
    const json = exportProfileJson(p);
    expect(JSON.parse(json)).toMatchObject({ type: 'worksuite.colour-profile', version: 1, accent: '#1d4ed8' });
    expect(importProfile(json)).toEqual(p);
    expect(importProfile(exportProfileCode({ name: 'Plain', accent: '#be123c', tint: 'neutral' }))).toEqual({ name: 'Plain', accent: '#be123c', tint: 'neutral' });
  });

  it('refuses what is not a profile', () => {
    for (const bad of ['', 'WS1.!!!', 'WS1.' + btoa('zzzzzz|n||x'), '{"accent":"red"}', '{"name":"x"}', 'hello']) expect(importProfile(bad)).toBeNull();
  });

  it('imports from Settings and exports from a profile', async () => {
    serve(null, { theme: 'dark' });
    await initAppState();
    const view = renderProfiles();
    fireEvent.click(screen.getByRole('button', { name: /Import/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'not a code' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('not a colour profile');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: exportProfileCode(p) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(settings.raw().appearance!.custom).toEqual([expect.objectContaining(p)]));
    fireEvent.click(await screen.findByRole('button', { name: `Export ${p.name}` }));
    const share = await screen.findByRole('dialog');
    expect(within(share).getByLabelText('Short code').textContent).toBe(exportProfileCode(p));
    view.unsubscribe();
  });
});
