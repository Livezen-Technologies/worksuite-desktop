// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import type * as CoreApi from '../../../src/core/api';

/** The app launcher (worksuite-desktop#201, #206): its size and place, search, categories, keyboard, tiles and menus. */
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
/** Whether the tests' system asks for reduced motion. */
let reducedMotion = false;
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (q: string) => ({ matches: reducedMotion && q.includes('reduced-motion'), addEventListener: () => undefined, removeEventListener: () => undefined }),
});
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
  reducedMotion = false;
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
  const px = (v: string) => parseInt(v, 10);

  it('is a popover min(880px, 100vw − 48px) wide, centred, 12% down the window', () => {
    render(<Launcher />);
    const d = dialog();
    expect(d.dataset.layout).toBe('popover');
    expect(d.style.width).toBe('880px');
    expect(d.style.left).toBe('200px');
    expect(px(d.style.left) * 2 + 880).toBe(1280);
    expect(d.style.top).toBe('96px');
    expect(px(d.style.top) + px(d.style.height)).toBeLessThanOrEqual(800 - 24);
  });

  it('sizes the grid to whole rows of tiles, names and all', () => {
    render(<Launcher />);
    // 1280×800, compact: five rows of 84px tiles, 2px apart, in 8px + 12px of padding.
    const area = dialog().querySelector<HTMLElement>('[data-grid-area]')!;
    expect(area.style.height).toBe(`${8 + 5 * 84 + 4 * 2 + 12}px`);
    expect(within(grid()).getAllByRole('option')[0]!.style.height).toBe('84px');
    expect(dialog().style.height).toBe(`${149 + 448}px`);
  });

  it('lays itself out again when the window is resized while it is open', () => {
    render(<Launcher />);
    expect(dialog().style.left).toBe('200px');
    setSize(1024, 700);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const d = dialog();
    expect(d.style.left).toBe('72px');
    expect(d.style.top).toBe('84px');
    expect(d.style.height).toBe(`${149 + 362}px`);
    expect(dialog().querySelector<HTMLElement>('[data-grid-area]')!.style.height).toBe('362px');
    setSize(1440, 900);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(dialog().style.left).toBe('280px');
  });

  it('keeps search, the rows above the grid and the footer out of the grid\'s scroller', () => {
    updateLauncherPrefs((p) => ({ ...p, pinned: ['mail'] }));
    render(<Launcher />);
    const scroller = grid();
    expect(scroller.className).toContain('overflow-y-auto');
    expect(scroller.contains(search())).toBe(false);
    expect(scroller.contains(screen.getByRole('tablist', { name: 'Categories' }))).toBe(false);
    expect(scroller.contains(screen.getByRole('button', { name: 'Open Mail' }))).toBe(false);
    expect(scroller.contains(screen.getByRole('button', { name: 'Customise' }))).toBe(false);
    // Nothing else in the popover scrolls up and down.
    const others = Array.from(dialog().querySelectorAll<HTMLElement>('*')).filter((el) => el !== scroller && /overflow-(y-)?auto/.test(el.className) && !/overflow-x-auto/.test(el.className));
    expect(others).toEqual([]);
  });

  it('dims and blurs what is under it, and closes on a click outside', async () => {
    render(<Launcher />);
    const backdrop = dialog().parentElement!;
    expect(backdrop.className).toContain('bg-scrim');
    expect(backdrop.className).toContain('backdrop-blur');
    fireEvent.mouseDown(dialog());
    expect(ui.get().overlay).toBe('launcher');
    fireEvent.mouseDown(backdrop);
    await waitFor(() => expect(ui.get().overlay).toBeNull());
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

});

describe('full screen', () => {
  beforeEach(() => {
    updateLauncherPrefs((p) => ({ ...p, mode: 'fullscreen', size: 'comfortable' }));
  });

  it('fills the window under the top bar, never over the window controls', () => {
    render(<Launcher />);
    const d = dialog();
    expect(d.dataset.layout).toBe('fullscreen');
    expect(d.style.top).toBe('52px');
    expect(d.style.left).toBe('0px');
    expect(d.style.width).toBe('1280px');
    expect(d.style.height).toBe('748px');
    // The top bar stays where it is, dimmed; a click on it closes the launcher.
    const scrim = document.querySelector<HTMLElement>('[data-scrim]')!;
    expect(scrim.style.height).toBe('52px');
    expect(scrim.contains(d)).toBe(false);
  });

  it('is one centred column at most 1160px wide, 40px from the top and 24px from the sides, the search with its settings and close beside it', () => {
    render(<Launcher />);
    const column = dialog().querySelector<HTMLElement>('[data-column]')!;
    expect(column.style.maxWidth).toBe('1160px');
    expect(column.style.paddingTop).toBe('40px');
    expect(column.style.paddingLeft).toBe('24px');
    expect(column.style.paddingRight).toBe('24px');
    expect(column.className).toContain('mx-auto');
    const field = search().closest('label')!;
    expect(field.style.height).toBe('56px');
    expect(field.style.maxWidth).toBe('');
    expect(field.className).toContain('flex-1');
    // The settings and the close buttons in the same row, after the search.
    const row = field.parentElement!;
    expect(Array.from(row.children).map((el) => el.getAttribute('aria-label') ?? el.tagName)).toEqual(['LABEL', 'App launcher settings', 'Close launcher']);
  });

  it('draws larger tiles in 116px columns, 8px apart', () => {
    render(<Launcher />);
    const rows = within(grid()).getAllByRole('presentation').filter((el) => el.style.gridTemplateColumns);
    expect(rows[0]!.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(116px, 1fr))');
    expect(rows[0]!.style.gap).toBe('8px');
    const tile = within(grid()).getAllByRole('option')[0]!;
    expect((tile.querySelector('[aria-hidden]') as HTMLElement).style.width).toBe('56px');
    expect(tile.style.height).toBe('116px');
    expect(tile.querySelector('[data-name]')!.className).toContain('text-[14px]');
  });

  it('lists the categories in a sidebar on the left, with each one\'s count, the one shown filled in', () => {
    render(<Launcher />);
    expect(dialog().dataset.categories).toBe('sidebar');
    const nav = dialog().querySelector<HTMLElement>('[data-sidebar]')!;
    expect(within(nav).getByRole('heading', { name: 'Categories' })).toBeTruthy();
    const list = within(nav).getByRole('tablist', { name: 'Categories' });
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    // The only categories there are: no chips above the apps as well.
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    const all = within(list).getByRole('tab', { name: /All apps/ });
    expect(all.getAttribute('aria-selected')).toBe('true');
    expect(all.className).toContain('bg-primary');
    expect(all.textContent).toMatch(/^All apps\d+$/);
    // It sits beside the apps, on the left.
    expect(nav.nextElementSibling).toBe(dialog().querySelector('[data-grid-area]'));
    fireEvent.click(within(list).getByRole('tab', { name: /Work/ }));
    expect(within(list).getByRole('tab', { name: /Work/ }).getAttribute('aria-selected')).toBe('true');
    const shown = within(grid()).getAllByRole('option').map((o) => o.getAttribute('aria-label'));
    expect(shown).toContain('Tasks');
    expect(shown).not.toContain('Mail');
  });

  it('puts the categories back as chips above the apps when the sidebar is off, or the window is too narrow for it', () => {
    updateLauncherPrefs((p) => ({ ...p, toggles: { ...p.toggles, sidebar: false } }));
    render(<Launcher />);
    expect(dialog().dataset.categories).toBe('chips');
    expect(dialog().querySelector('[data-sidebar]')).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Categories' }).getAttribute('aria-orientation')).toBeNull();
    cleanup();
    updateLauncherPrefs((p) => ({ ...p, toggles: { ...p.toggles, sidebar: true } }));
    setSize(800, 800);
    render(<Launcher />);
    expect(dialog().dataset.categories).toBe('chips');
  });

  it('has Pinned and Recent in one row of chips, each with a dot in the app\'s colour', () => {
    updateLauncherPrefs((p) => ({ ...p, pinned: ['mail', 'tasks'] }));
    render(<Launcher />);
    const row = dialog().querySelector<HTMLElement>('[data-recents]')!;
    expect(row.textContent).toContain('Pinned');
    const chip = within(row).getByRole('button', { name: 'Open Mail' });
    expect(chip.className).toContain('h-11');
    expect(chip.querySelector('[aria-hidden]')!.className).toContain('rounded-[3px]');
    // Searching: the row goes, as the results are what matters.
    fireEvent.change(search(), { target: { value: 'mail' } });
    expect(dialog().querySelector('[data-recents]')).toBeNull();
  });

  it('shows All apps category by category, under each one\'s name with its count and a rule; one category under its own name', () => {
    render(<Launcher />);
    const headings = () => Array.from(grid().querySelectorAll('[data-heading-label]')).map((h) => h.textContent);
    expect(headings()).toEqual(expect.arrayContaining(['Communication', 'Work', 'Business']));
    expect(headings()[0]).toBe('Communication');
    // Communication's apps under it, and how many.
    const first = grid().querySelector('[role="presentation"]')!;
    expect(within(first as HTMLElement).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Mail', 'Chat', 'Phone']);
    expect(first.querySelector('[data-heading-count]')!.textContent).toBe('3');
    expect(first.querySelector('[data-heading] > [aria-hidden]')!.className).toContain('bg-launcher-line');
    // One category from the sidebar: under its name; a search: no headings.
    fireEvent.click(screen.getByRole('tab', { name: /Work/ }));
    expect(headings()).toEqual(['Work']);
    fireEvent.click(screen.getByRole('tab', { name: /All apps/ }));
    fireEvent.change(search(), { target: { value: 'mail' } });
    expect(headings()).toEqual([]);
  });

  it('with the categories as chips, one category reads without a heading, as before', () => {
    updateLauncherPrefs((p) => ({ ...p, toggles: { ...p.toggles, sidebar: false } }));
    render(<Launcher />);
    const headings = () => Array.from(grid().querySelectorAll('[data-heading-label]')).map((h) => h.textContent);
    expect(headings()[0]).toBe('Communication');
    fireEvent.click(screen.getByRole('tab', { name: /Work/ }));
    expect(headings()).toEqual([]);
  });

  it('keeps the footer along the bottom of the window, with nothing under it; the grid takes what is left (worksuite-desktop#233)', () => {
    setSize(1280, 1000);
    render(<Launcher />);
    const column = dialog().querySelector<HTMLElement>('[data-column]')!;
    const area = dialog().querySelector<HTMLElement>('[data-grid-area]')!;
    const footer = dialog().querySelector<HTMLElement>('[data-footer]')!;
    // The column grows into the launcher, the grid into the column; the footer is the launcher's last child, across it.
    expect(column.className).toContain('flex-1');
    expect(column.style.paddingBottom).toBe('0px');
    expect(area.className).toContain('flex-1');
    expect(area.style.height).toBe('');
    expect(dialog().lastElementChild).toBe(footer);
    expect(column.contains(footer)).toBe(false);
    expect(footer.style.height).toBe('64px');
    // 24px under the last section, before the footer.
    expect(grid().style.paddingBottom).toBe('24px');
  });

  it('is drawn on the app\'s dark, and closes with × and with Esc', async () => {
    render(<Launcher />);
    expect(dialog().dataset.theme).toBe('dark');
    // One background for the grid, the headings and the footer (worksuite-desktop#233).
    expect(dialog().className).toContain('bg-launcher');
    fireEvent.click(screen.getByRole('button', { name: 'Close launcher' }));
    await waitFor(() => expect(ui.get().overlay).toBeNull());
    openOverlay('launcher');
    cleanup();
    render(<Launcher />);
    fireEvent.keyDown(search(), { key: 'Escape' });
    await waitFor(() => expect(ui.get().overlay).toBeNull());
  });

  it('closes on a click outside the column, or on the top bar', async () => {
    render(<Launcher />);
    fireEvent.mouseDown(within(grid()).getAllByRole('option')[0]!);
    fireEvent.mouseDown(search());
    expect(ui.get().overlay).toBe('launcher');
    fireEvent.mouseDown(dialog());
    await waitFor(() => expect(ui.get().overlay).toBeNull());
    openOverlay('launcher');
    cleanup();
    render(<Launcher />);
    fireEvent.mouseDown(document.querySelector('[data-scrim]')!);
    await waitFor(() => expect(ui.get().overlay).toBeNull());
  });
});

describe('the grid\'s scrolling', () => {
  const overflow = (el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop = 0) => {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
    Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
  };
  const fade = () => dialog().querySelector('[data-fade="bottom"]');

  it('fades out at the bottom only while there is more to scroll to', () => {
    render(<Launcher />);
    // Everything shows (jsdom draws nothing): no fade.
    expect(fade()).toBeNull();
    overflow(grid(), 900, 448);
    fireEvent.scroll(grid());
    expect(fade()).toBeTruthy();
    overflow(grid(), 900, 448, 452);
    fireEvent.scroll(grid());
    expect(fade()).toBeNull();
    overflow(grid(), 448, 448);
    fireEvent.scroll(grid());
    expect(fade()).toBeNull();
  });

  it('brings the tile the keys move to into view, clear of the fade', () => {
    const into = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Launcher />);
    into.mockClear();
    // 880px wide: nine 88px columns, so down goes from the first tile to the tenth.
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(into).toHaveBeenCalledWith({ block: 'nearest' });
    expect((into.mock.contexts.at(-1) as HTMLElement).dataset.index).toBe('9');
    expect(grid().style.scrollPaddingBottom).toBe('32px');
    into.mockRestore();
  });
});

describe('opening and closing', () => {
  it('fades and scales in and out, and focuses the search', async () => {
    render(<Launcher />);
    expect(dialog().className).toContain('launcher-in');
    expect(document.activeElement).toBe(search());
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(dialog().className).toContain('launcher-out');
    // Still there while it fades out, then gone.
    expect(ui.get().overlay).toBe('launcher');
    await waitFor(() => expect(ui.get().overlay).toBeNull());
  });

  it('does not move for reduced motion, and closes at once', () => {
    reducedMotion = true;
    render(<Launcher />);
    const backdrop = dialog().parentElement!;
    expect(backdrop.dataset.motion).toBe('reduce');
    expect(dialog().className).not.toMatch(/launcher-(in|out)/);
    expect(backdrop.className).not.toMatch(/launcher-scrim/);
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(ui.get().overlay).toBeNull();
  });

  it('opens Settings › App launcher from the settings button by the search', () => {
    render(<Launcher />);
    fireEvent.click(screen.getByRole('button', { name: 'App launcher settings' }));
    expect(ui.get().overlay).toBeNull();
    expect(tabsStore.get().tabs.some((t) => t.route === '/settings/launcher')).toBe(true);
  });
});

describe('long names', () => {
  it('are cut short on the tile, with the whole name in a tooltip', () => {
    app.set({ ...app.get(), apps: visibleApps({ apps: ['mail', 'oms', 'appointments'], permissions: ['oms.view'] }) });
    render(<Launcher />);
    const sales = within(grid()).getByRole('option', { name: 'Sales & Orders' });
    expect(sales.getAttribute('title')).toBe('Sales & Orders');
    expect(sales.querySelector('[data-name]')!.className).toContain('truncate');
    const appointments = within(grid()).getByRole('option', { name: 'Appointments' });
    expect(appointments.getAttribute('title')).toBe('Appointments · Opens in your browser');
    // The category chips and the pinned row say theirs too.
    expect(screen.getByRole('tab', { name: /Business/ }).getAttribute('title')).toBe('Business');
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
    expect(comms.textContent).toBe('Communication3');
    fireEvent.click(comms);
    expect(names()).toEqual(['Mail', 'Chat', 'Phone']);
    fireEvent.click(screen.getByRole('tab', { name: /All apps/ }));
    expect(names()).toHaveLength(13);
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

  it('closes with Esc, once it has faded out', async () => {
    render(<Launcher />);
    fireEvent.keyDown(search(), { key: 'Escape' });
    await waitFor(() => expect(ui.get().overlay).toBeNull());
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
    expect(names()).toEqual(['Chat', 'Mail', 'Phone']);
    expect(currentLauncherPrefs().sort).toBe('mine');
  });

  it('has a footer with the count, the keys and Customise', () => {
    render(<Launcher />);
    expect(dialog().textContent).toContain('13 apps · ↑↓←→ move · ↵ open · ⌘↵ new window · Esc close');
    fireEvent.click(screen.getByRole('button', { name: 'Customise' }));
    expect(ui.get().overlay).toBeNull();
    expect(tabsStore.get().tabs.some((t) => t.route === '/settings/launcher')).toBe(true);
  });
});
