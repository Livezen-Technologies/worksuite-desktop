// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '@shared/types';

/**
 * worksuite-desktop#264: Settings › Chat › "Chat drawer opens as": Docked (the default) or Floating, kept with this
 * computer's preferences — the same choice as the button in the drawer's header. Only for someone who has Chat.
 */
const tab = vi.hoisted(() => ({ path: ['settings', 'chat'] as string[] }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn(), go: vi.fn(), query: new URLSearchParams(), path: tab.path, active: true }), useTabTitle: () => undefined }));

const { app } = await import('../../../src/core/app-state');
const { call } = await import('../../../src/core/bridge');
const SettingsPage = (await import('../../../src/modules/settings/SettingsPage')).default;

const PREFS = { sidebarMode: 'expanded', pinnedApps: [], shortcuts: {}, language: 'en', theme: 'light', density: 'comfortable', ai: { display: 'widget', dockAtStart: false } } as unknown as Preferences;

function show(apps: string[], prefs: Partial<Preferences> = {}) {
  app.set({ ready: true, prefs: { ...PREFS, ...prefs }, apps: apps.map((id) => ({ id })), bootstrap: { permissions: ['*'], apps: ['*'], user: { id: 1, name: 'Asha' }, organizations: [] } as never } as never);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsPage tabId="t" route="/settings/chat" active />
    </QueryClientProvider>,
  );
  return screen.getByRole('navigation', { name: 'Settings sections' });
}

beforeEach(() => {
  tab.path = ['settings', 'chat'];
  vi.mocked(call).mockReset().mockImplementation((async (channel: string, patch: Partial<Preferences>) => (channel === 'settings:set' ? { preferences: { ...app.get().prefs, ...patch }, locks: [] } : null)) as never);
});
afterEach(() => cleanup());

describe('Settings › Chat (#264)', () => {
  it('chooses how the chat drawer opens: Docked by default, or Floating', async () => {
    const nav = show(['chat']);
    expect(within(nav).getByRole('button', { name: 'Chat' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Chat drawer opens as' });
    expect(select.textContent).toContain('Docked (default)');
    expect(screen.getByText(/makes room for it/)).toBeTruthy();
    fireEvent.click(select);
    await act(async () => fireEvent.click(screen.getByRole('option', { name: 'Floating' })));
    expect(call).toHaveBeenCalledWith('settings:set', { chatDrawer: 'floating' });
    expect(app.get().prefs?.chatDrawer).toBe('floating');
    expect(screen.getByRole('combobox', { name: 'Chat drawer opens as' }).textContent).toContain('Floating');
    expect(screen.getByText(/A click on the page or Esc closes it/)).toBeTruthy();
  });

  it('is not offered without Chat', () => {
    tab.path = ['settings', 'general'];
    const nav = show([]);
    expect(within(nav).queryByRole('button', { name: 'Chat' })).toBeNull();
  });
});
