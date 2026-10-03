// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import type * as CoreApi from '../../../src/core/api';

/** The app launcher (worksuite-desktop#201): its size, search, categories, keyboard, tiles and menus. */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ prefs: null })), apiPut: vi.fn(async () => ({})) }));

const openInBrowser = vi.fn(async () => true);
const openWindow = vi.fn(async () => ({ id: 2 }));
window.worksuite = {
  platform: 'darwin',
  app: { openInBrowser },
  windows: { open: openWindow },
  tabs: { save: vi.fn(async () => undefined) },
  settings: { set: vi.fn(async (p: object) => ({ preferences: { ...p }, locks: [] })) },
  files: { registerDropped: async () => [] },
  events: { on: () => () => undefined },
};
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
Element.prototype.scrollIntoView ??= () => undefined;

const { app } = await import('../../../src/core/app-state');
const { ui, openOverlay } = await import('../../../src/core/ui');
const { resetTabs, tabsStore } = await import('../../../src/core/tabs');
const { currentLauncherPrefs, resetLauncherPrefsForTests, updateLauncherPrefs } = await import('../../../src/core/launcher-prefs');
const { Launcher } = await import('../../../src/app/overlays/Launcher');

const grid = () => screen.getByRole('listbox', { name: 'Apps' });
const names = () => within(grid()).queryAllByRole('option').map((o) => o.getAttribute('aria-label'));
const search = () => screen.getByLabelText('Find an app') as HTMLInputElement;
const dialog = () => screen.getByRole('dialog', { name: 'Apps' });

function setSize(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
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
    status: { unread: { mail: 5, chat: 0, tasks: 0, notifications: 0 } } as never,
    bootstrap: null,
  });
  openInBrowser.mockClear();
  openWindow.mockClear();
  resetTabs();
  openOverlay('launcher');
});
afterEach(() => cleanup());

describe('the launcher\'s size and shape', () => {
  it('is a popover of at most 760×600, inside the window', () => {
    render(<Launcher />);
    const d = dialog();
    expect(d.dataset.layout).toBe('popover');
    expect(d.style.width).toBe('760px');
    expect(d.style.height).toBe('600px');
    expect(parseInt(d.style.top) + 600).toBeLessThanOrEqual(800);
  });

  it('shrinks to 90% of a small window', () => {
    setSize(1024, 640);
    render(<Launcher />);
    expect(dialog().style.height).toBe('576px');
  });

  it('is a bottom sheet with a category dropdown below 480px', () => {
    setSize(420, 800);
    render(<Launcher />);
    expect(dialog().dataset.layout).toBe('sheet');
    expect(screen.queryByRole('tablist', { name: 'Categories' })).toBeNull();
    expect(screen.getByLabelText('Category')).toBeTruthy();
    // Four columns of 48px icons.
    const rows = within(grid()).getAllByRole('presentation').filter((el) => el.style.gridTemplateColumns);
    expect(rows[0]!.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    expect((within(grid()).getAllByRole('option')[0]!.querySelector('[aria-hidden]') as HTMLElement).style.width).toBe('48px');
  });

  it('adapts its columns in the popover, and draws the size the person chose', () => {
    updateLauncherPrefs((p) => ({ ...p, size: 'large' }));
    render(<Launcher />);
    const rows = within(grid()).getAllByRole('presentation').filter((el) => el.style.gridTemplateColumns);
    expect(rows[0]!.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(88px, 1fr))');
    expect((within(grid()).getAllByRole('option')[0]!.querySelector('[aria-hidden]') as HTMLElement).style.width).toBe('64px');
    cleanup();
    updateLauncherPrefs((p) => ({ ...p, size: 'comfortable' }));
    render(<Launcher />);
    expect((within(grid()).getAllByRole('option')[0]!.querySelector('[aria-hidden]') as HTMLElement).style.width).toBe('52px');
  });

  it('covers the window in full-screen mode', () => {
    updateLauncherPrefs((p) => ({ ...p, mode: 'fullscreen' }));
    render(<Launcher />);
    expect(dialog().dataset.layout).toBe('fullscreen');
    expect(dialog().style.width).toBe('1280px');
    expect(dialog().style.height).toBe('800px');
  });
});

describe('finding an app', () => {
  it('focuses the search when it opens, and shows the launcher\'s own shortcut, not ⌘K', () => {
    render(<Launcher />);
    expect(document.activeElement).toBe(search());
    expect(dialog().textContent).toContain('⌘⇧K');
    expect(dialog().textContent).not.toContain('⌘K');
    expect(dialog().textContent).not.toContain('Desktop app');
  });

  it('finds Invoices for "bill"', () => {
    render(<Launcher />);
    fireEvent.change(search(), { target: { value: 'bill' } });
    expect(names()).toEqual(['Invoices']);
  });

  it('filters by a category chip, with its count', () => {
    render(<Launcher />);
    const comms = screen.getByRole('tab', { name: /Communication/ });
    expect(comms.textContent).toBe('Communication2');
    fireEvent.click(comms);
    expect(names()).toEqual(['Mail', 'Chat']);
    fireEvent.click(screen.getByRole('tab', { name: /All apps/ }));
    expect(names()).toHaveLength(11);
  });

  it('searches as soon as a key is typed, wherever the focus is', () => {
    render(<Launcher />);
    const tile = within(grid()).getAllByRole('option')[0]!;
    tile.focus();
    fireEvent.keyDown(tile, { key: 'm' });
    expect(document.activeElement).toBe(search());
  });

  it('still finds hidden apps', () => {
    updateLauncherPrefs((p) => ({ ...p, hidden: ['notes'] }));
    render(<Launcher />);
    expect(names()).not.toContain('Notes');
    fireEvent.change(search(), { target: { value: 'notes' } });
    expect(names()).toEqual(['Notes']);
  });
});

describe('the keyboard', () => {
  it('moves with the arrows, opens with Enter, and closes with Esc', () => {
    render(<Launcher />);
    const first = names()[0];
    fireEvent.keyDown(search(), { key: 'ArrowRight' });
    const sel = () => within(grid()).getAllByRole('option').findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(sel()).toBe(1);
    fireEvent.keyDown(search(), { key: 'ArrowLeft' });
    expect(sel()).toBe(0);
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(ui.get().overlay).toBeNull();
    expect(tabsStore.get().tabs.some((t) => t.title === first || t.app === 'mail')).toBe(true);
  });

  it('opens in a new window with ⌘Enter', () => {
    render(<Launcher />);
    fireEvent.keyDown(search(), { key: 'Enter', metaKey: true });
    expect(openWindow).toHaveBeenCalledWith(expect.objectContaining({ kind: 'record', route: '/mail' }));
  });

  it('closes with Esc', () => {
    render(<Launcher />);
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(ui.get().overlay).toBeNull();
  });

  it('counts uses for Most used', () => {
    render(<Launcher />);
    fireEvent.click(within(grid()).getByRole('option', { name: 'Tasks' }));
    expect(currentLauncherPrefs().usage.tasks).toBe(1);
  });
});

describe('tiles', () => {
  it('shows unread badges and the browser mark, each of which can be switched off', () => {
    render(<Launcher />);
    const mail = within(grid()).getByRole('option', { name: 'Mail' });
    expect(mail.querySelector('[data-badge]')?.textContent).toBe('5');
    const projects = within(grid()).getByRole('option', { name: 'Projects' });
    expect(projects.querySelector('[title="Opens in your browser"]')).toBeTruthy();
    cleanup();
    updateLauncherPrefs((p) => ({ ...p, toggles: { ...p.toggles, badges: false, browserMark: false, names: false } }));
    render(<Launcher />);
    expect(within(grid()).getByRole('option', { name: 'Mail' }).querySelector('[data-badge]')).toBeNull();
    expect(within(grid()).getByRole('option', { name: 'Projects' }).querySelector('[title="Opens in your browser"]')).toBeNull();
    expect(within(grid()).getByRole('option', { name: 'Mail' }).querySelector('.sr-only')?.textContent).toBe('Mail');
  });

  it('opens a browser app in the browser', () => {
    render(<Launcher />);
    fireEvent.click(within(grid()).getByRole('option', { name: 'Projects' }));
    expect(openInBrowser).toHaveBeenCalledWith({ path: '/projects' });
  });

  it('pins, hides and groups from a tile\'s menu', () => {
    render(<Launcher />);
    fireEvent.contextMenu(within(grid()).getByRole('option', { name: 'Tasks' }), { clientX: 10, clientY: 10 });
    const menu = screen.getByRole('menu', { name: 'Tasks options' });
    expect(within(menu).getByText('Open in new window')).toBeTruthy();
    fireEvent.click(within(menu).getByText('Pin'));
    expect(currentLauncherPrefs().pinned).toEqual(['tasks']);
    expect(screen.getByRole('button', { name: 'Open Tasks' })).toBeTruthy();

    fireEvent.contextMenu(within(grid()).getByRole('option', { name: 'Notes' }), { clientX: 10, clientY: 10 });
    fireEvent.click(within(screen.getByRole('menu')).getByText('Hide'));
    expect(names()).not.toContain('Notes');

    fireEvent.contextMenu(within(grid()).getByRole('option', { name: 'Mail' }), { clientX: 10, clientY: 10 });
    fireEvent.click(within(screen.getByRole('menu')).getByText('New group…'));
    const nameBox = screen.getByLabelText('New group name');
    fireEvent.change(nameBox, { target: { value: 'Inbox zero' } });
    fireEvent.submit(nameBox.closest('form')!);
    expect(currentLauncherPrefs()).toMatchObject({ groupBy: 'mine', groups: [{ name: 'Inbox zero', apps: ['mail'] }] });
    expect(screen.getByRole('tab', { name: /Inbox zero/ })).toBeTruthy();
  });

  it('pins by dragging a tile to the drop bar', () => {
    render(<Launcher />);
    const tile = within(grid()).getByRole('option', { name: 'Chat' });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(tile, { dataTransfer });
    const pin = dialog().querySelector('[data-drop="act:pin"]')!;
    expect(pin.textContent).toBe('Pin');
    expect(dialog().querySelector('[data-drop="act:hide"]')).toBeTruthy();
    expect(dialog().querySelector('[data-drop="act:window"]')).toBeTruthy();
    act(() => {
      fireEvent.dragOver(pin, { dataTransfer });
      fireEvent.drop(pin, { dataTransfer });
    });
    expect(currentLauncherPrefs().pinned).toEqual(['chat']);
  });

  it('reorders by dragging one tile onto another', () => {
    render(<Launcher />);
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '', dropEffect: '' };
    fireEvent.click(screen.getByRole('tab', { name: /Communication/ }));
    fireEvent.dragStart(within(grid()).getByRole('option', { name: 'Chat' }), { dataTransfer });
    const mail = within(grid()).getByRole('option', { name: 'Mail' });
    fireEvent.dragOver(mail, { dataTransfer });
    fireEvent.drop(mail, { dataTransfer });
    expect(names()).toEqual(['Chat', 'Mail']);
    expect(currentLauncherPrefs().sort).toBe('mine');
  });

  it('has a footer with the count, the keys and Customise', () => {
    render(<Launcher />);
    expect(dialog().textContent).toContain('11 apps · Arrow keys to move · Enter to open · ⌘Enter for a new window · Esc to close');
    fireEvent.click(screen.getByRole('button', { name: 'Customise' }));
    expect(ui.get().overlay).toBeNull();
    expect(tabsStore.get().tabs.some((t) => t.route === '/settings/launcher')).toBe(true);
  });
});
