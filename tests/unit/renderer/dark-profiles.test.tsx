// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../../../shared/types';
import { applyDarkProfile, DARK_PROFILES } from '../../../shared/theme-profiles';

const net = vi.hoisted(() => ({ call: vi.fn(), events: new Map<string, (value: unknown) => void>(), media: { matches: false, changed: () => {} } }));
vi.mock('../../../src/core/bridge', () => ({ call: net.call, hasDesktop: () => true, on: (name: string, cb: (value: unknown) => void) => { net.events.set(name, cb); return () => {}; }, errorMessage: (e: Error) => e.message }));
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ get matches() { return net.media.matches; }, addEventListener: (_: string, cb: () => void) => { net.media.changed = cb; } }) });
const { app, initAppState, updatePrefs } = await import('../../../src/core/app-state');
const { DarkProfilePicker } = await import('../../../src/modules/settings/Appearance');
let prefs: Preferences;
beforeEach(() => {
  prefs = { theme: 'dark', darkColorProfile: 'blue', density: 'comfortable', language: 'en' } as Preferences;
  net.media.matches = false; net.events.clear(); net.call.mockReset();
  net.call.mockImplementation(async (channel: string, patch?: Partial<Preferences>) => {
    if (channel === 'app:info') return { platform: 'linux' };
    if (channel === 'auth:state') return { stage: 'signed-out' };
    if (channel === 'settings:set') prefs = { ...prefs, ...patch };
    if (channel === 'settings:get' || channel === 'settings:set') return { preferences: prefs, locks: [] };
    return null;
  });
  document.documentElement.removeAttribute('style');
});
afterEach(cleanup);

function luminance(hex: string) {
  const values = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe('Dark color profiles across renderer windows (#73)', () => {
  it.each(DARK_PROFILES)('$name has readable text, controls, focus and distinguishable semantic statuses', ({ tokens: t }) => {
    for (const bg of ['ground', 'surface', 'subtle', 'selection', 'well', 'navy', 'navy-2', 'navy-3']) {
      for (const ink of ['ink', 'ink-2', 'ink-3']) expect(contrast(t[`--ws-${ink}`]!, t[`--ws-${bg}`]!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--ws-focus']!, t[`--ws-${bg}`]!)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(t['--ws-indigo']!, t['--ws-surface']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--ws-on-primary']!, t['--ws-indigo']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', t['--ws-brand']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--ws-cb-border']!, t['--ws-surface']!)).toBeGreaterThanOrEqual(3);
    for (const [ink, bg] of [['#43b581', '#12301f'], ['#f0a04b', '#36240f'], ['#f07167', '#3a1614']]) expect(contrast(ink!, bg!)).toBeGreaterThanOrEqual(4.5);
  });
  it('loads the saved profile at startup, updates immediately, and receives changes from other windows', async () => {
    prefs.darkColorProfile = 'purple';
    await initAppState();
    expect(document.documentElement.dataset.darkProfile).toBe('purple');
    const purple = document.documentElement.style.getPropertyValue('--ws-surface');
    await updatePrefs({ darkColorProfile: 'green' });
    expect(document.documentElement.dataset.darkProfile).toBe('green');
    expect(document.documentElement.style.getPropertyValue('--ws-surface')).not.toBe(purple);
    net.events.get('settings:changed')!({ ...prefs, darkColorProfile: 'teal' });
    expect(app.get().prefs?.darkColorProfile).toBe('teal');
    expect(document.documentElement.dataset.darkProfile).toBe('teal');
  });
  it('applies a remembered profile when System switches dark and removes overrides on light', async () => {
    prefs = { ...prefs, theme: 'system', darkColorProfile: 'orange' };
    await initAppState();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--ws-surface')).toBe('');
    net.media.matches = true; net.media.changed();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.darkProfile).toBe('orange');
    expect(document.documentElement.style.getPropertyValue('--ws-surface')).not.toBe('');
    net.media.matches = false; net.media.changed();
    expect(document.documentElement.style.length).toBe(0);
    expect(app.get().prefs?.darkColorProfile).toBe('orange');
  });
  it('turns High contrast on and off for the whole window (ENH-MAIL-03 DMO-ACC-01)', async () => {
    await initAppState();
    expect(document.documentElement.dataset.contrast).toBeUndefined();
    await updatePrefs({ highContrast: true });
    expect(document.documentElement.dataset.contrast).toBe('more');
    await updatePrefs({ highContrast: false });
    expect(document.documentElement.dataset.contrast).toBeUndefined();
  });
  it('uses identical palettes in detached windows and restores every Blue token on reset', () => {
    const main = document.documentElement;
    const detached = document.implementation.createHTMLDocument().documentElement;
    applyDarkProfile(main, 'red', true); applyDarkProfile(detached, 'red', true);
    expect(main.style.cssText).toBe(detached.style.cssText);
    applyDarkProfile(main, 'blue', true);
    expect(main.style.getPropertyValue('--ws-surface')).toBe('#121a34');
    expect(main.style.getPropertyValue('--ws-ground')).toBe('#0b1124');
    expect(main.style.getPropertyValue('--ws-indigo')).toBe('#5c7cfa');
    applyDarkProfile(main, 'invalid', true);
    expect(main.dataset.darkProfile).toBe('blue');
  });
  it('offers seven accessible previews and resets the stored preference without changing theme mode', async () => {
    prefs = { ...prefs, theme: 'system', darkColorProfile: 'purple' };
    render(<DarkProfilePicker prefs={prefs} />);
    for (const p of DARK_PROFILES) expect(screen.getByRole('button', { name: p.name })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dark Purple' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Dark Red' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('settings:set', { darkColorProfile: 'red' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset to Default' })).not.toHaveProperty('disabled', true));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('settings:set', { darkColorProfile: 'blue' }));
    expect(prefs.theme).toBe('system');
  });
  it('shows save failures without changing the active profile', async () => {
    await initAppState();
    net.call.mockRejectedValueOnce(new Error('Could not save appearance.'));
    render(<DarkProfilePicker prefs={prefs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark Gray' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not save appearance.');
    expect(document.documentElement.dataset.darkProfile).toBe('blue');
    expect(app.get().prefs?.darkColorProfile).toBe('blue');
  });
});
