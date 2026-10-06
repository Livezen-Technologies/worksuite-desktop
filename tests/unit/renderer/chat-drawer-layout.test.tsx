// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
// The conversation itself is Chat's; here only the drawer around it matters.
vi.mock('../../../src/modules/chat/Thread', () => ({ Thread: () => <div data-testid="thread" /> }));
vi.mock('../../../src/modules/chat/window', () => ({ openChatWindow: vi.fn(() => Promise.resolve()) }));

import { apiGetMeta } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { closeTopPanel, DOCK_MIN_WINDOW, ui } from '../../../src/core/ui';
import { ChatDrawer, DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN, DRAWER_MS, drawerWidthKey, useDrawerShown } from '../../../src/modules/chat/ChatDrawer';
import { openChatWindow } from '../../../src/modules/chat/window';

const room = { id: 5, type: 'direct', name: 'Dimuthu Abeysinghe Wickramasinghe', other_user_id: 9, unread: 0, mentions: 0, pinned: false, archived: false, muted: false };

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChatDrawer />
    </QueryClientProvider>,
  );
}

/** The window this wide, as Electron would report it. */
function windowWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  act(() => void window.dispatchEvent(new Event('resize')));
}

const slot = () => document.querySelector<HTMLElement>('[data-chat-drawer]')!;
const divider = () => screen.getByRole('separator', { name: 'Resize the chat drawer' });
const width = () => Number(divider().getAttribute('aria-valuenow'));
const KEY = 'ws.chatDrawer.width.5';

beforeEach(() => {
  localStorage.clear();
  windowWidth(1440);
  app.set({ auth: { stage: 'ready', user: { id: 5, name: 'Asha' } }, prefs: {} as Preferences } as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/rooms') return { data: { rooms: [room] }, offline: false };
    return { data: {}, offline: false };
  }) as typeof apiGetMeta);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string, patch: Partial<Preferences>) => (channel === 'settings:set' ? { preferences: { ...app.get().prefs, ...patch }, locks: [] } : null)) as never);
  ui.set({ dock: 'chat', chatRoom: '5', chatMinimised: [] } as never);
});
afterEach(() => cleanup());

describe('the chat drawer (#211)', () => {
  it('has a visible left edge, one container for header and messages', async () => {
    show();
    const drawer = screen.getByRole('complementary', { name: 'Chat drawer' });
    expect(drawer.className).toMatch(/\bborder-l\b/);
    expect(drawer.className).toMatch(/\bborder-line\b/);
    expect(drawer.className).toMatch(/overflow-hidden/);
    expect(within(drawer).getByTestId('thread')).toBeTruthy();
  });

  it('keeps the name readable: Pop out and Minimise move into More, Close stays', async () => {
    show();
    const name = await screen.findByText(room.name);
    expect(name.getAttribute('title')).toBe(room.name);
    expect(screen.queryByRole('button', { name: 'Open in new window' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Minimise' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Minimise to the corner/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Open in new window/ }));
    expect(openChatWindow).toHaveBeenCalledWith('5', room.name);
  });
});

describe('docked beside the page (#264)', () => {
  it('is a column of the window, not a layer: the page beside it gives up its width, and nothing is dimmed', () => {
    show();
    expect(slot().dataset.chatDrawer).toBe('docked');
    expect(slot().className.split(' ')).toEqual(expect.arrayContaining(['relative', 'shrink-0']));
    expect(slot().className).not.toMatch(/\babsolute\b/);
    expect(slot().style.width).toBe(`${DRAWER_DEFAULT}px`);
    // It comes in by growing from the window's edge, so the page eases to its new width.
    expect(slot().className).toContain('chat-dock-in');
    // Its content keeps the drawer's width while the column grows, so it slides rather than squeezes.
    expect(screen.getByRole('complementary', { name: 'Chat drawer' }).style.width).toBe(`${DRAWER_DEFAULT}px`);
    expect(screen.getByRole('complementary', { name: 'Chat drawer' }).className).not.toMatch(/shadow-/);
    expect(document.querySelector('[data-chat-scrim]')).toBeNull();
  });

  it('stays open on Esc: docked, it is part of the window', () => {
    show();
    expect(closeTopPanel()).toBe(false);
    expect(ui.get().dock).toBe('chat');
  });

  it('leaves the way it came, in 200ms, still showing the conversation', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ open }) => useDrawerShown(open), { initialProps: { open: true } });
      expect(result.current).toBe(true);
      rerender({ open: false });
      expect(result.current).toBe(true);
      act(() => void vi.advanceTimersByTime(DRAWER_MS - 1));
      expect(result.current).toBe(true);
      act(() => void vi.advanceTimersByTime(1));
      expect(result.current).toBe(false);
      // Opened again before it has gone: it simply stays.
      rerender({ open: true });
      expect(result.current).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChatDrawer closing />
      </QueryClientProvider>,
    );
    act(() => ui.set({ dock: null, chatRoom: null }));
    expect(slot().className).toContain('chat-dock-out');
    expect(slot().hasAttribute('inert')).toBe(true);
    expect(screen.getByTestId('thread')).toBeTruthy();
  });
});

describe('its width (#264)', () => {
  it(`opens at ${DRAWER_DEFAULT}px, between ${DRAWER_MIN} and ${DRAWER_MAX}px, on the shared divider of its left edge`, () => {
    show();
    const sep = divider();
    expect(width()).toBe(DRAWER_DEFAULT);
    expect(sep.getAttribute('aria-valuemin')).toBe(String(DRAWER_MIN));
    expect(sep.getAttribute('aria-valuemax')).toBe(String(DRAWER_MAX));
    expect(sep.className).toContain('cursor-col-resize');
    expect(sep.className).toContain('-left-[4px]');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(width()).toBe(DRAWER_DEFAULT + 16); // the left edge moves left: wider
    fireEvent.keyDown(sep, { key: 'End' });
    expect(width()).toBe(DRAWER_MAX);
    fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true });
    expect(width()).toBe(DRAWER_MAX);
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(width()).toBe(DRAWER_MIN);
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(width()).toBe(DRAWER_MIN);
    expect(slot().style.width).toBe(`${DRAWER_MIN}px`);
  });

  it('is kept for this person on this computer, and a double-click goes back to the default and forgets it', () => {
    show();
    fireEvent.keyDown(divider(), { key: 'End' });
    expect(localStorage.getItem(KEY)).toBe(String(DRAWER_MAX));
    cleanup();
    show();
    expect(width()).toBe(DRAWER_MAX);
    fireEvent.doubleClick(divider());
    expect(width()).toBe(DRAWER_DEFAULT);
    expect(localStorage.getItem(KEY)).toBeNull();
    // Someone else on this computer has their own.
    expect(drawerWidthKey(6)).toBe('ws.chatDrawer.width.6');
  });

  it('keeps a stored width within the limits, and takes over one kept before it was per person', () => {
    localStorage.setItem(KEY, '900');
    show();
    expect(width()).toBe(DRAWER_MAX);
    cleanup();
    localStorage.clear();
    localStorage.setItem('ws.chatDrawer.width', '500');
    show();
    expect(width()).toBe(500);
    expect(localStorage.getItem(KEY)).toBe('500');
    expect(localStorage.getItem('ws.chatDrawer.width')).toBeNull();
  });

  it('docked, leaves the page room to work in: a smaller window lowers the most it may take', () => {
    localStorage.setItem(KEY, String(DRAWER_MAX));
    windowWidth(1240);
    show();
    expect(width()).toBe(1240 - 720);
    windowWidth(1600);
    expect(width()).toBe(DRAWER_MAX);
  });
});

describe('floating over the page (#264)', () => {
  it(`floats in a window narrower than ${DOCK_MIN_WINDOW}px: over the page, with a shadow and a light dim`, () => {
    windowWidth(DOCK_MIN_WINDOW - 1);
    show();
    expect(slot().dataset.chatDrawer).toBe('floating');
    expect(slot().className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'right-0', 'z-30']));
    expect(screen.getByRole('complementary', { name: 'Chat drawer' }).className).toMatch(/shadow-\[-12px_0_32px_-16px/);
    expect(document.querySelector('[data-chat-scrim]')!.className).toContain('bg-scrim/40');
    // Wide again: back beside the page.
    windowWidth(DOCK_MIN_WINDOW);
    expect(slot().dataset.chatDrawer).toBe('docked');
  });

  it('floats when the person chose Floating, however wide the window', () => {
    app.set({ prefs: { chatDrawer: 'floating' } as Preferences });
    show();
    expect(slot().dataset.chatDrawer).toBe('floating');
  });

  it('closes on a click on the page, the conversation waiting in the corner', () => {
    windowWidth(1000);
    show();
    fireEvent.mouseDown(document.querySelector('[data-chat-scrim]')!);
    expect(ui.get()).toMatchObject({ dock: null, chatRoom: null, chatMinimised: ['5'] });
  });

  it('closes on Esc', () => {
    app.set({ prefs: { chatDrawer: 'floating' } as Preferences });
    show();
    expect(closeTopPanel()).toBe(true);
    expect(ui.get()).toMatchObject({ dock: null, chatMinimised: ['5'] });
  });
});

describe('Docked ⇄ Floating from the header (#264)', () => {
  it('switches the Settings › Chat choice', async () => {
    ui.set({ chatRoom: null });
    show();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Float over the page' })));
    expect(call).toHaveBeenCalledWith('settings:set', { chatDrawer: 'floating' });
    expect(slot().dataset.chatDrawer).toBe('floating');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dock beside the page' })));
    expect(call).toHaveBeenLastCalledWith('settings:set', { chatDrawer: 'docked' });
    expect(slot().dataset.chatDrawer).toBe('docked');
  });

  it('cannot dock in a window too narrow for it, and says why', () => {
    windowWidth(1100);
    ui.set({ chatRoom: null });
    show();
    const dock = screen.getByRole('button', { name: 'Dock beside the page' }) as HTMLButtonElement;
    expect(dock.disabled).toBe(true);
    expect(dock.title).toMatch(/wider/);
  });
});
