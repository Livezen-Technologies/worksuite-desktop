// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, Preferences, StatusSnapshot } from '@shared/types';
import type { LockState } from '@shared/ipc/contract';
import type * as CoreApi from '../../../src/core/api';
import type { Tab } from '../../../src/core/tabs';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: true, platform: 'darwin' }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(async () => ({ data: null })), apiPost: vi.fn() }));

const { apiGet } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { tabsStore } = await import('../../../src/core/tabs');
const { aiMinimized, aiWidget, closePanelsOnSessionChange, closeTopPanel, openAssistant, openChatDrawer, openOverlay, resetFloatingPanels, toggleAssistant, toggleDock, ui } = await import('../../../src/core/ui');
const { closeMenuOnRouteChange } = await import('../../../src/app/overlays/panels');
const { Popover } = await import('../../../src/app/overlays/Popover');
const { ProfileMenu } = await import('../../../src/app/overlays/Popovers');
const { shownPresence } = await import('../../../src/core/presence');

const AI = { quickAsk: true, shortcut: 'Alt+Space', insert: true, dockAtStart: false, language: 'English', display: 'widget', sound: false, moduleAccess: { worksuite: {}, local: {} }, onlineFallback: true, autoMinimize: false, autoMinimizeWhenWorking: true } as Preferences['ai'];
const prefs = (ai: Partial<Preferences['ai']> = {}) => ({ ai: { ...AI, ...ai } }) as unknown as Preferences;
const user = { id: 'u1', name: 'Asha Perera', email: 'asha@example.lk' };
const auth = (stage: AuthState['stage'], who = user): AuthState => ({ stage, server: null, user: stage === 'ready' ? (who as AuthState['user']) : null, message: null, setupPending: false });
const lock = (locked: boolean) => ({ locked }) as LockState;
const tab = (id: string, route: string): Tab => ({ id, route, title: route, pinned: false, organizationId: null, app: route.slice(1).split('/')[0], lastActive: 0, suspended: false, reloadKey: 0 }) as Tab;

/** Everything a person could have left open: the profile menu, the assistant, the chat drawer and a minimised chat. */
function leaveEverythingOpen(): void {
  ui.set({ overlay: 'profile', dock: 'chat', chatRoom: '7', chatMinimised: ['3'], searchSeed: 'q' });
  aiWidget.set({ open: true, maximized: true });
  aiMinimized.set({ on: true });
}
function nothingOpen(): void {
  expect(ui.get()).toMatchObject({ overlay: null, dock: null, chatRoom: null, chatMinimised: [], searchSeed: '' });
  expect(aiWidget.get()).toEqual({ open: false, maximized: false });
  expect(aiMinimized.get().on).toBe(false);
}

beforeEach(() => {
  resetFloatingPanels();
  ui.set({ sidebarCollapsed: false });
  app.set({ prefs: prefs(), auth: auth('ready'), lock: lock(false), status: null, apps: [] });
  tabsStore.set({ tabs: [tab('t1', '/home')], activeId: 't1' });
});
afterEach(() => {
  cleanup();
  vi.mocked(apiGet).mockReset();
});

describe('after sign-in, no menu or panel is open (worksuite-desktop#150)', () => {
  it('from the sign-in screen: signing out with the profile menu and the assistant open leaves nothing open for the next sign-in', () => {
    const off = closePanelsOnSessionChange();
    leaveEverythingOpen();
    // Sign out is pressed in the profile menu itself.
    act(() => app.set({ auth: auth('signed-out') }));
    nothingOpen();
    leaveEverythingOpen();
    act(() => app.set({ auth: auth('ready') }));
    nothingOpen();
    off();
  });

  it('from the lock screen: locking and unlocking both close every panel', () => {
    const off = closePanelsOnSessionChange();
    leaveEverythingOpen();
    act(() => app.set({ lock: lock(true) }));
    nothingOpen();
    leaveEverythingOpen();
    act(() => app.set({ lock: lock(false) }));
    nothingOpen();
    off();
  });

  it('from guest mode (a Local Profile): signing in afterwards starts clean, and another person signing in too', () => {
    app.set({ auth: auth('signed-out') });
    const off = closePanelsOnSessionChange();
    leaveEverythingOpen();
    act(() => app.set({ auth: auth('ready') }));
    nothingOpen();
    leaveEverythingOpen();
    act(() => app.set({ auth: auth('ready', { ...user, id: 'u2' }) }));
    nothingOpen();
    off();
  });

  it('keeps what is kept on purpose (the sidebar folded), and leaves panels alone while nothing about the session changes', () => {
    const off = closePanelsOnSessionChange();
    ui.set({ sidebarCollapsed: true, overlay: 'profile' });
    act(() => app.set({ status: { network: 'ONLINE' } as StatusSnapshot }));
    expect(ui.get().overlay).toBe('profile');
    act(() => app.set({ lock: lock(true) }));
    expect(ui.get().sidebarCollapsed).toBe(true);
    off();
  });

  it('the assistant opens at start-up only when the person switched that on, and only once — never again at a sign-in or unlock', async () => {
    vi.resetModules();
    const fresh = await import('../../../src/core/ui');
    // A restart: nothing of a panel's state is kept, so everything starts closed.
    expect(fresh.ui.get()).toMatchObject({ overlay: null, dock: null, chatRoom: null, chatMinimised: [] });
    expect(fresh.aiWidget.get().open).toBe(false);
    const { openAssistantAtStart: atStartOff } = await import('../../../src/app/overlays/panels');
    const freshApp = (await import('../../../src/core/app-state')).app;
    freshApp.set({ prefs: prefs({ dockAtStart: false }) });
    expect(atStartOff()).toBe(false);
    expect(fresh.aiWidget.get().open).toBe(false);

    vi.resetModules();
    const again = await import('../../../src/core/ui');
    const panels = await import('../../../src/app/overlays/panels');
    (await import('../../../src/core/app-state')).app.set({ prefs: prefs({ dockAtStart: true }) });
    expect(panels.openAssistantAtStart()).toBe(true);
    expect(again.aiWidget.get().open).toBe(true);
    again.resetFloatingPanels();
    // Signed out and in again, or unlocked: the Shell comes back, but the start-up is over.
    expect(panels.openAssistantAtStart()).toBe(false);
    expect(again.aiWidget.get().open).toBe(false);
  });
});

describe('one floating panel at a time', () => {
  it('opening the profile menu puts the assistant away, and opening the assistant closes the menu', () => {
    openAssistant();
    expect(aiWidget.get().open).toBe(true);
    openOverlay('profile');
    expect(ui.get().overlay).toBe('profile');
    expect(aiWidget.get().open).toBe(false);
    toggleAssistant();
    expect(aiWidget.get().open).toBe(true);
    expect(ui.get().overlay).toBeNull();
  });

  it('with the drawer: the same, and the drawer waits as its floating button', () => {
    app.set({ prefs: prefs({ display: 'drawer' }) });
    toggleDock('ai');
    expect(ui.get().dock).toBe('ai');
    openOverlay('notifications');
    expect(ui.get()).toMatchObject({ overlay: 'notifications', dock: null });
    expect(aiMinimized.get().on).toBe(true);
    openAssistant();
    expect(ui.get()).toMatchObject({ overlay: null, dock: 'ai' });
  });

  it('the chat drawer, the transfers panel and search take turns too; a conversation waits in the corner', () => {
    openChatDrawer('7');
    openOverlay('transfers');
    expect(ui.get()).toMatchObject({ overlay: 'transfers', dock: null, chatMinimised: ['7'] });
    openAssistant();
    expect(ui.get().overlay).toBeNull();
    openChatDrawer('7');
    expect(aiWidget.get().open).toBe(false);
    expect(ui.get()).toMatchObject({ dock: 'chat', chatRoom: '7' });
    openOverlay('search', 'invoice');
    expect(ui.get()).toMatchObject({ overlay: 'search', dock: null, searchSeed: 'invoice' });
    // Clicking the open menu's button again closes it and opens nothing else.
    openOverlay('search');
    expect(ui.get().overlay).toBeNull();
    expect(aiWidget.get().open).toBe(false);
  });
});

describe('Escape, a click outside and a route change close the open panel', () => {
  it('Escape closes the open menu first, then the assistant', () => {
    openAssistant();
    ui.set({ overlay: 'profile' });
    expect(closeTopPanel()).toBe(true);
    expect(ui.get().overlay).toBeNull();
    expect(aiWidget.get().open).toBe(true);
    expect(closeTopPanel()).toBe(true);
    expect(aiWidget.get().open).toBe(false);
    expect(closeTopPanel()).toBe(false);
  });

  it('a menu closes on Escape and on a click outside it, not on a click inside', async () => {
    vi.useFakeTimers();
    try {
      ui.set({ overlay: 'profile' });
      render(
        <>
          <button type="button">Outside</button>
          <Popover label="Account">
            <button type="button">Inside</button>
          </Popover>
        </>,
      );
      act(() => vi.runAllTimers());
      fireEvent.mouseDown(screen.getByText('Inside'));
      expect(ui.get().overlay).toBe('profile');
      fireEvent.mouseDown(screen.getByText('Outside'));
      expect(ui.get().overlay).toBeNull();
      ui.set({ overlay: 'profile' });
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(ui.get().overlay).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a menu sits above the assistant: fixed at z-40, over the widget at z-20', () => {
    ui.set({ overlay: 'profile' });
    render(<Popover label="Account">menu</Popover>);
    expect(screen.getByRole('dialog', { name: 'Account' }).className).toMatch(/\bfixed\b.*\bz-40\b/);
  });

  it('another tab, or another page in this one, closes the open menu', () => {
    const off = closeMenuOnRouteChange();
    ui.set({ overlay: 'profile' });
    tabsStore.set((s) => ({ tabs: s.tabs.map((t) => ({ ...t, title: 'Home!' })) }));
    expect(ui.get().overlay).toBe('profile');
    tabsStore.set({ tabs: [tab('t1', '/tasks')], activeId: 't1' });
    expect(ui.get().overlay).toBeNull();
    ui.set({ overlay: 'notifications' });
    tabsStore.set({ tabs: [tab('t1', '/tasks'), tab('t2', '/mail')], activeId: 't2' });
    expect(ui.get().overlay).toBeNull();
    off();
  });
});

describe('the profile menu and the title bar read the same presence (#150)', () => {
  it('connected, a server not yet told of this computer shows what the person chose, never Offline', () => {
    expect(shownPresence({ status: 'offline', choice: 'available' }, 'ONLINE')).toBe('online');
    expect(shownPresence({ status: 'offline', choice: 'busy' }, 'ONLINE')).toBe('busy');
    expect(shownPresence({ status: 'away', choice: 'available' }, 'ONLINE')).toBe('away');
    expect(shownPresence({ status: 'online', choice: 'available' }, 'LIMITED')).toBe('online');
    // Appear offline is the person's own choice.
    expect(shownPresence({ status: 'offline', choice: 'offline' }, 'ONLINE')).toBe('offline');
    // Not connected: Offline, as the pill says.
    expect(shownPresence({ status: 'online', choice: 'available' }, 'OFFLINE')).toBe('offline');
    // No Chat app: no presence line at all.
    expect(shownPresence(undefined, 'ONLINE')).toBeNull();
  });

  it('the menu says Online beside an Online pill even when the server still has the person offline', async () => {
    app.set({ apps: [{ id: 'chat' }] as never, status: { network: 'ONLINE', unread: { notifications: 0, chat: 0 } } as unknown as StatusSnapshot, auth: auth('ready') });
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/chat/presence/me' ? { status: 'offline', choice: 'available' } : { enabled: true }) as never);
    ui.set({ overlay: 'profile' });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ProfileMenu />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Online')).toBeTruthy());
    expect(screen.queryByText('Offline')).toBeNull();
  });
});
