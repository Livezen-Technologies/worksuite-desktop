// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import { FADE_PX, FOOTER_NARROW_BELOW, footerNarrow, hasMoreAbove, scrollFades } from '@shared/launcher';
import type * as CoreApi from '../../../src/core/api';

/**
 * The full-screen app launcher's footer and scroll fades (worksuite-desktop#233): no dark band above the footer, a
 * fade only while there is more, within the column; one hairline; the footer attached to the bottom; sticky
 * category headings; one background, `--launcher-bg`, in both themes.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ prefs: null })), apiPut: vi.fn(async () => ({})) }));

window.worksuite = {
  platform: 'darwin',
  app: { openInBrowser: vi.fn(async () => true) },
  windows: { open: vi.fn(async () => ({ id: 2 })) },
  tabs: { save: vi.fn(async () => undefined) },
  settings: { set: vi.fn(async (p: object) => ({ preferences: { ...p }, locks: [] })) },
  files: { registerDropped: async () => [] },
  events: { on: () => () => undefined },
};
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
});
Element.prototype.scrollIntoView ??= () => undefined;

const { app } = await import('../../../src/core/app-state');
const { openOverlay } = await import('../../../src/core/ui');
const { resetTabs } = await import('../../../src/core/tabs');
const { resetLauncherPrefsForTests, updateLauncherPrefs } = await import('../../../src/core/launcher-prefs');
const { Launcher } = await import('../../../src/app/overlays/Launcher');

const grid = () => screen.getByRole('listbox', { name: 'Apps' });
const dialog = () => screen.getByRole('dialog', { name: 'Apps' });
const fade = (edge: 'top' | 'bottom') => dialog().querySelector<HTMLElement>(`[data-fade="${edge}"]`);
const footer = () => dialog().querySelector<HTMLElement>('[data-footer]')!;
const hints = () => footer().querySelector<HTMLElement>('[data-hints]')!;

function setSize(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}
function overflow(el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop = 0) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
}

beforeEach(() => {
  localStorage.clear();
  resetLauncherPrefsForTests();
  setSize(1280, 800);
  app.set({
    auth: { stage: 'ready', user: { id: '7' } } as never,
    session: { mode: 'account', signingIn: false, moveOffer: false },
    apps: visibleApps({ apps: ['mail', 'chat', 'tasks', 'calendar', 'billing', 'projects', 'drive', 'notes'], permissions: ['billing.view'] }),
    prefs: { pinnedApps: [] } as never,
    status: { unread: { mail: 0, chat: 0, tasks: 0, notifications: 0 } } as never,
    bootstrap: null,
  });
  resetTabs();
  openOverlay('launcher');
  updateLauncherPrefs((p) => ({ ...p, mode: 'fullscreen', size: 'comfortable' }));
});
afterEach(() => cleanup());

describe('when the fades show (worksuite-desktop#233)', () => {
  it('draws each fade only while there is more past its edge', () => {
    expect(scrollFades(null)).toEqual({ top: false, bottom: false });
    // Everything fits.
    expect(scrollFades({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toEqual({ top: false, bottom: false });
    // At the top of a longer list: only the bottom fade.
    expect(scrollFades({ scrollTop: 0, clientHeight: 400, scrollHeight: 900 })).toEqual({ top: false, bottom: true });
    // Part way down: both.
    expect(scrollFades({ scrollTop: 200, clientHeight: 400, scrollHeight: 900 })).toEqual({ top: true, bottom: true });
    // At the end, even a fraction of a pixel off: only the top fade.
    expect(scrollFades({ scrollTop: 499.5, clientHeight: 400, scrollHeight: 900 })).toEqual({ top: true, bottom: false });
    expect(hasMoreAbove({ scrollTop: 1 })).toBe(false);
    expect(hasMoreAbove({ scrollTop: 2 })).toBe(true);
  });

  it('shows no fade when the whole list shows, and none at the end of it', () => {
    render(<Launcher />);
    expect(fade('top')).toBeNull();
    expect(fade('bottom')).toBeNull();
    overflow(grid(), 900, 448);
    fireEvent.scroll(grid());
    expect(fade('bottom')).toBeTruthy();
    expect(fade('top')).toBeNull();
    overflow(grid(), 900, 448, 200);
    fireEvent.scroll(grid());
    expect(fade('bottom')).toBeTruthy();
    expect(fade('top')).toBeTruthy();
    overflow(grid(), 900, 448, 452);
    fireEvent.scroll(grid());
    expect(fade('bottom')).toBeNull();
    expect(fade('top')).toBeTruthy();
  });

  it('looks again when the launcher is laid out again, not only on a scroll', () => {
    render(<Launcher />);
    overflow(grid(), 900, 448);
    fireEvent.scroll(grid());
    expect(fade('bottom')).toBeTruthy();
    // A taller window: now all of it shows, and nothing has scrolled.
    overflow(grid(), 900, 900);
    setSize(1280, 1300);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(fade('bottom')).toBeNull();
  });

  it('fades to the launcher\'s own background, 32px, within the centred column', () => {
    render(<Launcher />);
    overflow(grid(), 900, 448, 200);
    fireEvent.scroll(grid());
    const bottom = fade('bottom')!;
    expect(FADE_PX).toBe(32);
    expect(bottom.style.height).toBe('32px');
    expect(bottom.style.background).toContain('linear-gradient(to bottom, transparent, var(--launcher-bg))');
    expect(bottom.className).toContain('pointer-events-none');
    expect(fade('top')!.style.background).toContain('linear-gradient(to top, transparent, var(--launcher-bg))');
    // In the column (at most 1160px), not across the window.
    const column = dialog().querySelector<HTMLElement>('[data-column]')!;
    expect(column.style.maxWidth).toBe('1160px');
    expect(column.contains(bottom)).toBe(true);
    expect(bottom.className).toContain('inset-x-0');
    expect(bottom.parentElement!.hasAttribute('data-grid-area')).toBe(true);
    // The top fade sits under a stuck heading, not over it.
    expect(fade('top')!.style.top).toBe('32px');
  });
});

describe('the footer (worksuite-desktop#233)', () => {
  it('runs along the bottom of the window, with one soft hairline and the launcher\'s background, its words in the column', () => {
    render(<Launcher />);
    const column = dialog().querySelector<HTMLElement>('[data-column]')!;
    expect(dialog().lastElementChild).toBe(footer());
    expect(column.style.paddingBottom).toBe('0px');
    expect(footer().className).toContain('border-t');
    expect(footer().className).toContain('border-launcher-line');
    expect(footer().className).not.toContain('border-line ');
    expect(footer().className).toContain('bg-launcher');
    // Its words line up with the column above: as wide, as far in.
    const inner = hints().parentElement!;
    expect(inner.style.maxWidth).toBe('1160px');
    expect(inner.style.paddingLeft).toBe('24px');
    expect(dialog().className).toContain('bg-launcher');
    // No second edge: the grid area draws no border of its own.
    expect(dialog().querySelector<HTMLElement>('[data-grid-area]')!.className).not.toMatch(/border/);
  });

  it('lists the keys the launcher has, as chips, with Customise on the right', () => {
    render(<Launcher />);
    expect(hints().textContent).toBe('13 apps · ↑↓←→ move · ↵ open · ⌘↵ new window · Esc close');
    expect(Array.from(hints().querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['↑', '↓', '←', '→', '↵', '⌘', '↵', 'Esc']);
    const customise = hints().parentElement!.lastElementChild!;
    expect(customise.textContent).toBe('Customise');
    expect(customise.className).toContain('h-11');
  });

  it('says only the count and Esc to close when it is narrow', () => {
    expect(footerNarrow(FOOTER_NARROW_BELOW - 1)).toBe(true);
    expect(footerNarrow(FOOTER_NARROW_BELOW)).toBe(false);
    expect(footerNarrow(900, true)).toBe(true);
    // 600px wide: a 536px column.
    setSize(600, 800);
    render(<Launcher />);
    expect(hints().textContent).toBe('13 apps · Esc to close');
    expect(hints().querySelector('kbd')).toBeNull();
    expect(hints().dataset.narrow).toBe('true');
  });

  it('is narrow in the bottom sheet, and not in the popover', () => {
    setSize(420, 800);
    render(<Launcher />);
    expect(dialog().dataset.layout).toBe('sheet');
    expect(hints().textContent).toBe('13 apps · Esc to close');
    cleanup();
    setSize(1280, 800);
    updateLauncherPrefs((p) => ({ ...p, mode: 'popover' }));
    render(<Launcher />);
    expect(dialog().dataset.layout).toBe('popover');
    expect(hints().textContent).toContain('↑↓←→ move');
  });
});

describe('section headings (worksuite-desktop#233)', () => {
  it('are 12px in full screen, letter-spaced and muted, 24px above and 8px below, and stick while their section scrolls by', () => {
    render(<Launcher />);
    const headings = Array.from(grid().querySelectorAll<HTMLElement>('[data-heading]'));
    expect(headings.length).toBeGreaterThan(1);
    for (const h of headings) {
      expect(h.className).toEqual(expect.stringContaining('sticky'));
      expect(h.className).toContain('top-0');
      expect(h.className).toContain('text-[12px]');
      expect(h.className).toMatch(/tracking-/);
      expect(h.className).toContain('text-ink-3');
      expect(h.className).toContain('bg-launcher');
      expect(parseInt(h.style.marginTop, 10) + parseInt(h.style.paddingTop, 10)).toBe(24);
      expect(h.style.paddingBottom).toBe('8px');
      // In its own section, so it sticks only while that section scrolls by.
      expect(h.parentElement!.getAttribute('role')).toBe('presentation');
    }
    // 24px under the last section, before the footer.
    expect(grid().style.paddingBottom).toBe('24px');
  });
});

describe('one background (worksuite-desktop#233)', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/styles.css'), 'utf8');
  const block = (selector: string) => {
    const i = css.indexOf(`${selector} {`);
    return css.slice(i, css.indexOf('\n}', i));
  };

  it('defines --launcher-bg and its hairline for the light and the dark theme', () => {
    expect(block(':root')).toMatch(/--launcher-bg: #[0-9a-f]{6};/);
    expect(block(':root')).toContain('--launcher-line: rgba(18, 22, 51, 0.06);');
    expect(block("[data-theme='dark']")).toMatch(/--launcher-bg: #[0-9a-f]{6};/);
    expect(block("[data-theme='dark']")).toContain('--launcher-line: rgba(255, 255, 255, 0.06);');
    // Solid, so a fade to it is never darker than what it fades over.
    expect(css).not.toContain('--ws-launcher-full');
  });
});
