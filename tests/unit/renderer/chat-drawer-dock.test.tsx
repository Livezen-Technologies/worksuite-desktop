// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';

/**
 * worksuite-desktop#264: the chat drawer, docked, is a column of the window beside the workspace — under the title bar
 * and the tab strip, which keep the window's width — so the page gives up the drawer's width instead of being covered;
 * floating, it lies over the workspace, and a click on it or Esc closes the drawer.
 */

// The desktop bridge, answering every call with an empty value of any shape (as in boundaries.test).
const empty = (): unknown => new Proxy([] as unknown[], { get: (t, k) => (k in t || typeof k === 'symbol' ? (t as never)[k] : k === 'then' ? undefined : empty()) });
window.worksuite = new Proxy(
  { platform: 'darwin', files: { registerDropped: async () => [] }, events: { on: () => () => undefined } } as Record<string, unknown>,
  { get: (t, k: string) => (k in t ? t[k] : new Proxy({}, { get: () => async () => empty() })) },
) as never;
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;
Element.prototype.scrollIntoView ??= () => undefined;

const { app } = await import('../../../src/core/app-state');
const { queryClient } = await import('../../../src/core/query');
const { ui } = await import('../../../src/core/ui');
const { Shell } = await import('../../../src/layouts/Shell');

function windowWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  act(() => void window.dispatchEvent(new Event('resize')));
}

const signedIn = (chatDrawer?: 'docked' | 'floating') =>
  app.set({
    ready: true,
    prefs: { pinnedApps: [], ai: { display: 'drawer' }, chatDrawer } as never,
    apps: visibleApps({ apps: '*', permissions: ['*'] }),
    bootstrap: { permissions: ['*'], apps: ['*'], user: { id: '5', name: 'Hasarinda' } } as never,
    auth: { stage: 'ready', user: { id: '5', name: 'Hasarinda' } } as never,
  } as never);

const shell = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>,
  );

const openDrawer = async () => act(async () => fireEvent.click(document.querySelector('button[title="Chat"]') as HTMLElement));
const slot = () => document.querySelector<HTMLElement>('[data-chat-drawer]');

beforeEach(() => {
  localStorage.clear();
  ui.set({ dock: null, overlay: null, chatRoom: null, chatMinimised: [] } as never);
  windowWidth(1440);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the chat drawer in the window (#264)', () => {
  it('docks beside the workspace, in the row under the tab strip: the page shrinks by its width, the bars above do not', async () => {
    signedIn();
    shell();
    await openDrawer();
    const drawer = slot()!;
    expect(drawer.dataset.chatDrawer).toBe('docked');
    const main = document.querySelector('main')!;
    const row = drawer.parentElement!;
    // The drawer and the workspace (inside the AI widget's area) side by side in one flex row: the workspace is flex-1
    // and min-w-0, the drawer shrink-0 at its width, so the workspace is what gives way.
    expect(row.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'flex-1']));
    expect(row.contains(main)).toBe(true);
    expect(main.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
    expect(drawer.className.split(' ')).toEqual(expect.arrayContaining(['relative', 'shrink-0']));
    expect(drawer.style.width).toBe('400px');
    // The tab strip is above that row, not beside the drawer.
    expect(row.contains(screen.getByRole('tablist', { name: 'Open tabs' }))).toBe(false);
    expect(row.contains(document.querySelector('header'))).toBe(false);
    expect(document.querySelector('[data-chat-scrim]')).toBeNull();
  });

  it('floats over the workspace when chosen, or in a narrow window; a click on the page or Esc closes it', async () => {
    signedIn('floating');
    shell();
    await openDrawer();
    expect(slot()!.dataset.chatDrawer).toBe('floating');
    expect(slot()!.className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'right-0']));
    await act(async () => fireEvent.mouseDown(document.querySelector('[data-chat-scrim]')!));
    expect(ui.get().dock).toBeNull();
    // Leaving, then gone.
    expect(slot()!.className).toContain('chat-float-out');
    await act(async () => void (await new Promise((r) => setTimeout(r, 250))));
    expect(slot()).toBeNull();

    signedIn('docked');
    windowWidth(1100);
    await openDrawer();
    expect(slot()!.dataset.chatDrawer).toBe('floating');
    await act(async () => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(ui.get().dock).toBeNull();
  });

  it('stays docked on Esc', async () => {
    signedIn();
    shell();
    await openDrawer();
    await act(async () => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(ui.get().dock).toBe('chat');
  });
});
