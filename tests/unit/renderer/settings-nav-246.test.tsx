// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '@shared/types';

/**
 * worksuite-desktop#246: the Settings sidebar fills the tab and only its list scrolls (min-h-0, overflow-y-auto, 16px
 * clear of the bottom); Admin Center is a footer outside the scroller, for whoever has `chat.widget.manage` only; the
 * list fades at the bottom only while there is more below.
 */
const tab = vi.hoisted(() => ({ go: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn(), go: tab.go, query: new URLSearchParams(), path: ['settings', 'about'], active: true }), useTabTitle: () => undefined }));

const { app } = await import('../../../src/core/app-state');
const SettingsPage = (await import('../../../src/modules/settings/SettingsPage')).default;
const { ADMIN_RINGING_ROUTE } = await import('../../../src/modules/settings/AdminRinging');

const PREFS = { sidebarMode: 'expanded', pinnedApps: [], shortcuts: {}, language: 'en', theme: 'light', density: 'comfortable', ai: { display: 'widget', dockAtStart: false } } as unknown as Preferences;

function show(permissions: string[]) {
  app.set({ ready: true, prefs: PREFS, apps: [], bootstrap: { permissions, user: { id: 1, name: 'Asha' }, organizations: [] } as never });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsPage tabId="t" route="/settings/about" active />
    </QueryClientProvider>,
  );
  const nav = screen.getByRole('navigation', { name: 'Settings sections' });
  return { nav, scroller: nav.querySelector<HTMLElement>('[data-settings-scroller]')! };
}

/** jsdom lays nothing out: the scroller's sizes, as a window this tall would give them. */
function size(el: HTMLElement, { scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: scrollTop });
}

beforeEach(() => tab.go.mockReset());
afterEach(() => cleanup());

describe('Settings sidebar (#246)', () => {
  it('fills the tab’s height and scrolls only its list: min-h-0, overflow-y-auto, 16px under the last item, never 100vh', () => {
    const { nav, scroller } = show(['chat.widget.manage']);
    expect(nav.className).toContain('h-full');
    expect(nav.className).toContain('flex-col');
    expect(nav.className).not.toMatch(/100vh|h-screen/);
    expect(scroller.className.split(' ')).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto', 'pb-4']));
    // Every section, through About › License, is in the scroller.
    expect(within(scroller).getByRole('button', { name: 'License' })).toBeTruthy();
    expect(within(scroller).getByRole('button', { name: 'General' })).toBeTruthy();
  });

  it('keeps Admin Center in a footer outside the scroller, under a divider, opening in the app (no ↗)', () => {
    const { nav, scroller } = show(['chat.widget.manage']);
    const admin = within(nav).getByRole('button', { name: 'Admin Center' });
    expect(scroller.contains(admin)).toBe(false);
    const footer = admin.closest<HTMLElement>('[data-settings-footer]')!;
    expect(footer).toBeTruthy();
    expect(footer.className.split(' ')).toEqual(expect.arrayContaining(['shrink-0', 'border-t', 'border-line']));
    // The last thing in the sidebar: under the scroll area, above the status bar.
    expect(nav.lastElementChild).toBe(footer);
    expect(admin.textContent).toBe(' Admin Center');
    expect(admin.textContent).not.toContain('↗');
    expect(admin.querySelector('svg')).toBeTruthy();
    fireEvent.click(admin);
    expect(tab.go).toHaveBeenCalledWith(ADMIN_RINGING_ROUTE);
  });

  it('shows the footer to admins only: `*` too, nobody else', () => {
    show(['*']);
    expect(screen.getByRole('button', { name: 'Admin Center' })).toBeTruthy();
    cleanup();
    const { nav } = show(['chat.view']);
    expect(within(nav).queryByRole('button', { name: 'Admin Center' })).toBeNull();
    expect(nav.querySelector('[data-settings-footer]')).toBeNull();
  });

  it('fades the bottom of the list only while there is more below, to the sidebar’s own background', () => {
    const { nav, scroller } = show(['chat.widget.manage']);
    const fade = () => nav.querySelector<HTMLElement>('[data-fade="bottom"]');
    // Everything fits: no fade.
    size(scroller, { scrollTop: 0, clientHeight: 600, scrollHeight: 600 });
    act(() => void fireEvent.scroll(scroller));
    expect(fade()).toBeNull();
    // A short window: more below, a fade.
    size(scroller, { scrollTop: 0, clientHeight: 300, scrollHeight: 900 });
    act(() => void fireEvent.scroll(scroller));
    expect(fade()).toBeTruthy();
    expect(fade()!.getAttribute('aria-hidden')).toBe('true');
    expect(fade()!.style.background).toContain('var(--ws-surface)');
    expect(fade()!.className).toContain('pointer-events-none');
    // The fade is beside the scroller, not over the footer.
    expect(scroller.contains(fade())).toBe(false);
    expect(nav.querySelector('[data-settings-footer]')!.contains(fade())).toBe(false);
    // Scrolled to the end: License is the last thing, and the fade goes.
    size(scroller, { scrollTop: 600, clientHeight: 300, scrollHeight: 900 });
    act(() => void fireEvent.scroll(scroller));
    expect(fade()).toBeNull();
  });
});
