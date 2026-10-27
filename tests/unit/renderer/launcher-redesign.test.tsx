// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import { launcherLayout } from '@shared/launcher';
import type * as CoreApi from '../../../src/core/api';

/**
 * The popover launcher's redesign (light and dark reference boards): one card with the search and a close button,
 * Pinned and Recent chips, "All" and category pills with counts, the grid under uppercase category headings with
 * their counts, stars that pin, and a footer with the keys and how to pin and reorder.
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
const { closeOverlay, openOverlay } = await import('../../../src/core/ui');
const { resetTabs } = await import('../../../src/core/tabs');
const { currentLauncherPrefs, resetLauncherPrefsForTests, updateLauncherPrefs } = await import('../../../src/core/launcher-prefs');
const { noteRecentApp, readRecentApps } = await import('../../../src/core/recent-apps');
const { Launcher } = await import('../../../src/app/overlays/Launcher');

const grid = () => screen.getByRole('listbox', { name: 'Apps' });
const dialog = () => screen.getByRole('dialog', { name: 'Apps' });
const search = () => screen.getByLabelText('Find an app') as HTMLInputElement;
const tile = (name: string) => within(grid()).getByRole('option', { name });
const selectedTab = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')!;

beforeEach(() => {
  localStorage.clear();
  resetLauncherPrefsForTests();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  app.set({
    auth: { stage: 'ready', user: { id: '7' } } as never,
    session: { mode: 'account', signingIn: false, moveOffer: false },
    apps: visibleApps({ apps: ['mail', 'chat', 'tasks', 'calendar', 'billing', 'projects', 'drive', 'notes', 'telephony'], permissions: ['billing.view'] }),
    prefs: { pinnedApps: [] } as never,
    status: { unread: { mail: 5, chat: 0, tasks: 0, notifications: 0 } } as never,
    bootstrap: null,
  });
  resetTabs();
  // openOverlay toggles: start from none, so a test that left the launcher open does not close the next one's.
  closeOverlay();
  openOverlay('launcher');
});
afterEach(() => cleanup());

describe('the card', () => {
  it('is a dialog with a 16px radius over a dimmed, blurred backdrop', () => {
    render(<Launcher />);
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().className).toContain('rounded-[16px]');
    expect(dialog().parentElement!.className).toContain('backdrop-blur');
  });

  it('has the search, with its focus ring and the launcher\'s shortcut, and a square close button beside it', () => {
    render(<Launcher />);
    const row = search().closest('label')!.parentElement!;
    expect(Array.from(row.children).map((el) => el.getAttribute('aria-label') ?? el.tagName)).toEqual(['LABEL', 'Close launcher']);
    expect(search().closest('label')!.className).toContain('focus-within:shadow-');
    expect(search().getAttribute('placeholder')).toBe('Find an app');
    expect(row.textContent).toContain('⌘⇧K');
  });

  it('draws a compact tile\'s icon 48px', () => {
    render(<Launcher />);
    expect((tile('Mail').querySelector('[aria-hidden]') as HTMLElement).style.width).toBe('48px');
    expect(launcherLayout({ width: 1280, height: 800 }, { left: 0, top: 0, width: 1280, height: 800 }, { mode: 'popover', size: 'compact' }).icon).toBe(48);
  });
});

describe('Pinned and Recent', () => {
  it('shows the pinned apps and the recent ones as chips with the app\'s icon', () => {
    updateLauncherPrefs((p) => ({ ...p, pinned: ['mail', 'tasks'] }));
    noteRecentApp('7', 'notes');
    render(<Launcher />);
    const pinned = screen.getByRole('button', { name: 'Open Mail' }).parentElement!;
    expect(pinned.textContent).toMatch(/^Pinned/);
    expect(within(pinned).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mail', 'Tasks']);
    const recent = screen.getByRole('button', { name: 'Open Notes' }).parentElement!;
    expect(recent.textContent).toMatch(/^Recent/);
  });

  it('notes an app as recent when it is opened', () => {
    render(<Launcher />);
    fireEvent.click(tile('Tasks'));
    expect(readRecentApps('7')[0]!.id).toBe('tasks');
  });

  it('reorders the pinned chips by dragging one onto another', () => {
    updateLauncherPrefs((p) => ({ ...p, pinned: ['mail', 'tasks', 'notes'] }));
    render(<Launcher />);
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Open Notes' }), { dataTransfer });
    const mail = screen.getByRole('button', { name: 'Open Mail' });
    act(() => {
      fireEvent.dragOver(mail, { dataTransfer });
      fireEvent.drop(mail, { dataTransfer });
    });
    expect(currentLauncherPrefs().pinned).toEqual(['notes', 'mail', 'tasks']);
  });
});

describe('categories', () => {
  it('are pills, "All" first, each with its count; the one shown is solid', () => {
    render(<Launcher />);
    const pills = within(screen.getByRole('tablist', { name: 'Categories' })).getAllByRole('tab');
    expect(pills[0]!.textContent).toBe('All13');
    expect(pills.map((p) => p.className.includes('rounded-full'))).toEqual(pills.map(() => true));
    expect(pills[0]!.className).toContain('bg-primary');
    expect(pills[1]!.className).not.toContain('bg-primary');
    expect(screen.getByRole('tablist', { name: 'Categories' }).className).toContain('overflow-x-auto');
  });

  it('go round with Tab, and back with Shift+Tab', () => {
    render(<Launcher />);
    expect(selectedTab().textContent).toMatch(/^All/);
    fireEvent.keyDown(search(), { key: 'Tab' });
    expect(selectedTab().textContent).toMatch(/^Communication/);
    fireEvent.keyDown(search(), { key: 'Tab', shiftKey: true });
    fireEvent.keyDown(search(), { key: 'Tab', shiftKey: true });
    expect(selectedTab().textContent).toMatch(/^People/);
  });
});

describe('the grid', () => {
  it('reads category by category in the popover, each under its uppercase name and its count', () => {
    render(<Launcher />);
    const headings = Array.from(grid().querySelectorAll<HTMLElement>('[data-heading]'));
    expect(headings.map((h) => h.querySelector('[data-heading-label]')!.textContent)).toEqual(['Communication', 'Work', 'Business', 'People']);
    expect(headings.map((h) => h.querySelector('[data-heading-count]')!.textContent)).toEqual(['3', '7', '2', '1']);
    expect(headings[0]!.className).toContain('uppercase');
    expect(headings[0]!.className).toContain('sticky');
    // No rule after the count in the popover; full screen keeps its own.
    expect(headings[0]!.querySelector('[aria-hidden]')).toBeNull();
    // A search reads as one list, best first.
    fireEvent.change(search(), { target: { value: 'ma' } });
    expect(grid().querySelector('[data-heading]')).toBeNull();
  });

  it('marks a pinned app with a filled star, and the star pins and unpins', () => {
    updateLauncherPrefs((p) => ({ ...p, pinned: ['mail'] }));
    render(<Launcher />);
    const star = (name: string) => tile(name).querySelector<HTMLElement>('[data-star]')!;
    expect(star('Mail').dataset.star).toBe('on');
    expect(star('Mail').className).toContain('text-primary');
    expect(star('Tasks').dataset.star).toBe('off');
    // Only while pointed at, or selected, on an app not pinned.
    expect(star('Tasks').className).toContain('opacity-0');
    fireEvent.click(star('Tasks'));
    expect(currentLauncherPrefs().pinned).toEqual(['mail', 'tasks']);
    // The star does not open the app.
    expect(screen.getByRole('dialog', { name: 'Apps' })).toBeTruthy();
    fireEvent.click(star('Mail'));
    expect(currentLauncherPrefs().pinned).toEqual(['tasks']);
  });

  it('shows the unread count at the top right, and outlines the tile selected', () => {
    render(<Launcher />);
    expect(tile('Mail').querySelector('[data-badge]')!.textContent).toBe('5');
    expect(tile('Mail').getAttribute('aria-selected')).toBe('true');
    expect(tile('Mail').className).toContain('shadow-[inset_0_0_0_2px_var(--color-primary)]');
    fireEvent.keyDown(search(), { key: 'ArrowRight' });
    expect(tile('Chat').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(readRecentApps('7')[0]!.id).toBe('chat');
  });

  it('opens the selected tile\'s menu from the keyboard, its first item focused', () => {
    render(<Launcher />);
    fireEvent.keyDown(search(), { key: 'ArrowRight' });
    fireEvent.keyDown(search(), { key: 'ContextMenu' });
    const menu = screen.getByRole('menu', { name: 'Chat options' });
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(search(), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Chat options' })).toBeTruthy();
  });
});

describe('the footer', () => {
  it('lists the keys as chips on the left, and how to pin and reorder on the right', () => {
    render(<Launcher />);
    const hints = dialog().querySelector<HTMLElement>('[data-hints]')!;
    expect(Array.from(hints.querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['↑', '↓', '←', '→', '↵', 'Tab', 'Esc']);
    expect(hints.textContent).toBe('13 apps · ↑↓←→ move · ↵ open · Tab category · Esc close');
    expect(dialog().querySelector('[data-pin-hint]')!.textContent).toBe('pins an app · drag to reorder');
  });
});
