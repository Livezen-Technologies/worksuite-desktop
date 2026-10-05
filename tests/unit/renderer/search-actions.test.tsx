// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import { DARK_PROFILES, generatePalette, LIGHT_PROFILES } from '@shared/theme-profiles';
import type * as CoreApi from '../../../src/core/api';

/**
 * The palette's action footer (#148): an accent Open, glass New window and
 * Copy link with shortcut chips only for shortcuts that work, "Copied" for a
 * moment after copying (announced politely), focus rings and motion that
 * stays still when reduced motion is asked for.
 */
Element.prototype.scrollIntoView ??= vi.fn();
const apiGet = vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: (...a: unknown[]) => apiGet(...a) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => []),
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));

const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { SearchOverlay, COPIED_MS, isCopyChord } = await import('../../../src/app/overlays/SearchOverlay');

const writeText = vi.fn(async (_: string) => undefined);
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

const answer = {
  results: [{ group: 'Notes', key: 'notes', items: [{ id: 4, title: 'Solar budget', subtitle: null, route: '/notes?note=4', at: null }] }],
  terms: ['solar'],
  index: { state: 'ready', progress: 1, building: [] },
  companies: [],
};

async function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SearchOverlay mode="search" />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Search WorkSuite'), { target: { value: 'solar' } });
  await screen.findByRole('option', { name: /Solar budget/ });
  return within(screen.getByLabelText('Preview'));
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
  apiGet.mockReset().mockResolvedValue(answer);
  vi.mocked(call).mockReset().mockResolvedValue([] as never);
  writeText.mockClear();
  app.set({
    auth: { user: { id: 1 }, server: { origin: 'https://ws.example' } } as never,
    bootstrap: null,
    apps: visibleApps({ apps: ['notes'], permissions: [] }),
    status: { network: 'ONLINE' } as never,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
});

describe('the action footer (#148)', () => {
  it('shows a shortcut chip on New window and Copy link only when that shortcut works, in the platform style', async () => {
    const preview = await show();
    const open = preview.getByRole('button', { name: 'Open' });
    const win = preview.getByRole('button', { name: 'New window' });
    const link = preview.getByRole('button', { name: 'Copy link' });
    // Chips are decoration: hidden from the name, with the keys given in aria-keyshortcuts.
    expect(open.querySelector('kbd')?.textContent).toBe('↵');
    expect(win.querySelector('kbd')?.textContent).toBe('Ctrl+↵');
    expect(win.getAttribute('aria-keyshortcuts')).toBe('Control+Enter');
    expect(link.querySelector('kbd')?.textContent).toBe('Ctrl+C');
    expect(link.getAttribute('aria-keyshortcuts')).toBe('Control+C');
    for (const b of [open, win, link]) expect(b.querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows no Copy link chip when there is no link to copy', async () => {
    app.set({ auth: null });
    const preview = await show();
    const link = preview.getByRole('button', { name: 'Copy link' });
    expect(link).toHaveProperty('disabled', true);
    expect(link.querySelector('kbd')).toBeNull();
    expect(link.hasAttribute('aria-keyshortcuts')).toBe(false);
    // New window still works, so it keeps its chip.
    expect(preview.getByRole('button', { name: 'New window' }).querySelector('kbd')).not.toBeNull();
    // And Ctrl+C does nothing rather than copy nothing.
    fireEvent.keyDown(screen.getByLabelText('Search WorkSuite'), { key: 'c', ctrlKey: true });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says "Copied" with a check for 1.5 s after copying, announces it, then reverts', async () => {
    const preview = await show();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(preview.getByRole('button', { name: 'Copy link' }));
    });
    expect(writeText).toHaveBeenCalledWith('https://ws.example/notes?note=4');
    const copied = preview.getByRole('button', { name: 'Copied' });
    expect(copied.querySelector('svg')?.getAttribute('class')).toContain('lucide-check');
    const live = preview.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Copied.');
    act(() => vi.advanceTimersByTime(COPIED_MS - 1));
    expect(preview.getByRole('button', { name: 'Copied' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(preview.getByRole('button', { name: 'Copy link' }).querySelector('svg')?.getAttribute('class')).toContain('lucide-link');
    expect(preview.queryByRole('button', { name: 'Copied' })).toBeNull();
    expect(live.textContent).toBe('');
  });

  it('copies with Ctrl+C when no text is selected, and leaves a real text copy alone', async () => {
    await show();
    const box = screen.getByLabelText<HTMLInputElement>('Search WorkSuite');
    box.setSelectionRange(0, 3);
    fireEvent.keyDown(box, { key: 'c', ctrlKey: true });
    expect(writeText).not.toHaveBeenCalled();
    box.setSelectionRange(5, 5);
    fireEvent.keyDown(box, { key: 'c', ctrlKey: true, shiftKey: true });
    expect(writeText).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(box, { key: 'c', ctrlKey: true });
    });
    expect(writeText).toHaveBeenCalledWith('https://ws.example/notes?note=4');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('opens a new window with Ctrl+Enter, as its chip says', async () => {
    await show();
    fireEvent.keyDown(screen.getByLabelText('Search WorkSuite'), { key: 'Enter', ctrlKey: true });
    expect(call).toHaveBeenCalledWith('windows:open', expect.objectContaining({ kind: 'record', route: '/notes?note=4' }));
  });

  it('uses the platform copy chord: Cmd+C on macOS, Ctrl+C elsewhere', () => {
    const e = (over: Partial<KeyboardEvent>) => ({ key: 'c', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
    expect(isCopyChord(e({ metaKey: true }), true)).toBe(true);
    expect(isCopyChord(e({ ctrlKey: true }), true)).toBe(false);
    expect(isCopyChord(e({ ctrlKey: true }), false)).toBe(true);
    expect(isCopyChord(e({ metaKey: true }), false)).toBe(false);
    expect(isCopyChord(e({ ctrlKey: true, altKey: true }), false)).toBe(false);
  });

  it('gives all three a focus-visible ring and moves them only when motion is allowed', async () => {
    const preview = await show();
    const open = preview.getByRole('button', { name: 'Open' });
    const buttons = [open, preview.getByRole('button', { name: 'New window' }), preview.getByRole('button', { name: 'Copy link' })];
    for (const b of buttons) {
      const cls = b.className.split(/\s+/);
      expect(cls).toContain('focus-visible:outline-2');
      expect(cls).toContain('focus-visible:outline-[var(--ws-focus)]');
      expect(cls).toContain('motion-safe:enabled:hover:-translate-y-px');
      expect(cls).toContain('motion-safe:enabled:active:scale-[.98]');
      // No lift, scale or transition outside motion-safe.
      expect(cls.filter((c) => /translate|scale|^transition-\[/.test(c) && !c.startsWith('motion-safe:'))).toEqual([]);
      expect(cls).toContain('rounded-[12px]');
    }
    expect(open.className).toContain('h-11');
    expect(open.className).toContain('text-white');
    expect(buttons[1]!.className).toContain('h-10');
    expect(buttons[1]!.className).toContain('bg-glass');
    expect(buttons[1]!.parentElement!.className).toContain('grid-cols-2');
    expect(buttons[1]!.parentElement!.className).toContain('gap-2');
  });
});

/** sRGB channels of #rrggbb. */
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (c: number[]) => {
  const [r, g, b] = c.map((v) => Math.min(255, v) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

// Light and custom profiles too (worksuite-desktop#234): whatever accent a person picks, its brand keeps white text.
const CUSTOM_BRANDS = ['#ffd400', '#00ff00', '#ff69b4', '#7fffd4', '#e0e0e0'].flatMap((accent) => (['light', 'dark'] as const).map((mode) => [`Custom ${accent} ${mode}`, generatePalette({ accent, tint: 'accent' }, mode).tokens['--ws-brand']!]));
it.each([['Light', '#3b5bdb'], ...DARK_PROFILES.map((p) => [p.name, p.tokens['--ws-brand']!]), ...LIGHT_PROFILES.map((p) => [p.name, p.tokens['--ws-brand']!]), ...CUSTOM_BRANDS])(
  '%s: white text on the accent button stays AA across its gradient, hovered too',
  (_, brand) => {
    const base = rgb(brand);
    // The gradient runs from brand down to 84% brand (16% black); hover brightens by 1.05.
    for (const shade of [1, 0.92, 0.84]) {
      for (const bright of [1, 1.05]) {
        const c = base.map((v) => v * shade * bright);
        // The very top edge only carries the highlight; the label sits mid-way and below.
        const need = shade === 1 ? 4 : 4.5;
        expect(1.05 / (luminance(c) + 0.05)).toBeGreaterThanOrEqual(need);
      }
    }
  },
);
