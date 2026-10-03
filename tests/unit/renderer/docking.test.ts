// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));

import { call } from '../../../src/core/bridge';
import { activate, adoptWindow, closeTab, detachTab, dockSide, duplicateTab, insertTab, newRoute, openTab, resetTabs, restoreTabs, setSplit, suspendIdle, swapSides, tabsStore, undockSide } from '../../../src/core/tabs';
import { droppedWindow, dropPoint } from '../../../src/core/dock-drag';
import { app } from '../../../src/core/app-state';
import { visibleApps } from '@shared/apps';

const mocked = vi.mocked(call);
const ids = () => tabsStore.get().tabs.map((t) => t.route);
const state = () => tabsStore.get();

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue(undefined as never);
  app.set({ apps: visibleApps({ apps: '*', permissions: ['*'] }) });
  resetTabs();
});

describe('docking a tab beside the active one (FR-NAV-07)', () => {
  it('docks, swaps, resizes within bounds and undocks', () => {
    const home = state().activeId!;
    const mail = openTab('/mail')!;
    dockSide(home);
    expect(state()).toMatchObject({ activeId: mail, sideId: home });

    // Bringing the docked tab forward swaps the panes.
    activate(home);
    expect(state()).toMatchObject({ activeId: home, sideId: mail });
    swapSides();
    expect(state()).toMatchObject({ activeId: mail, sideId: home });

    setSplit(0.1);
    expect(state().split).toBe(0.25);
    setSplit(0.9);
    expect(state().split).toBe(0.75);
    setSplit(Number.NaN);
    expect(state().split).toBe(0.5);

    undockSide();
    expect(state()).toMatchObject({ activeId: mail, sideId: null });
  });

  it('docking the active tab brings the one used before it forward', () => {
    const home = state().activeId!;
    openTab('/mail');
    const tasks = openTab('/tasks')!;
    activate(home);
    activate(tasks);
    dockSide(tasks);
    expect(state()).toMatchObject({ activeId: home, sideId: tasks });
  });

  it('does nothing with a single tab', () => {
    const home = state().activeId!;
    dockSide(home);
    expect(state()).toMatchObject({ activeId: home, sideId: null });
  });

  it('closing the active tab never brings the docked one forward while another is left', () => {
    const home = state().activeId!;
    const mail = openTab('/mail')!;
    const tasks = openTab('/tasks')!;
    activate(mail);
    dockSide(tasks);
    expect(state()).toMatchObject({ activeId: mail, sideId: tasks });
    closeTab(mail);
    expect(state()).toMatchObject({ activeId: home, sideId: tasks });
    // With only the docked tab left, it becomes the active one.
    closeTab(home);
    expect(state()).toMatchObject({ activeId: tasks, sideId: null });
  });

  it('closing the docked tab undocks it, and it is never suspended', () => {
    const home = state().activeId!;
    const mail = openTab('/mail')!;
    dockSide(home);
    tabsStore.set((s) => ({ tabs: s.tabs.map((t) => ({ ...t, lastActive: 0 })) }));
    suspendIdle(1);
    expect(state().tabs.find((t) => t.id === home)?.suspended).toBe(false);
    closeTab(home);
    expect(state()).toMatchObject({ activeId: mail, sideId: null });
  });

  it('saves and restores the docked tab with its width', async () => {
    vi.useFakeTimers();
    const home = state().activeId!;
    openTab('/mail');
    dockSide(home);
    setSplit(0.6);
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();
    const saved = mocked.mock.calls.filter(([c]) => c === 'tabs:save').at(-1)?.[1] as { side: { id: string; split: number } };
    expect(saved.side).toEqual({ id: home, split: 0.6 });

    mocked.mockResolvedValueOnce({ tabs: [{ id: 'a', route: '/home', title: 'Home', pinned: false, organizationId: null, app: 'home' }, { id: 'b', route: '/mail', title: 'Mail', pinned: false, organizationId: null, app: 'mail' }], activeId: 'b', side: { id: 'a', split: 0.6 }, restored: true } as never);
    await restoreTabs(new Set(['home', 'mail']));
    expect(state()).toMatchObject({ activeId: 'b', sideId: 'a', split: 0.6 });
    expect(state().tabs.every((t) => !t.suspended)).toBe(true);

    // A docked tab whose app is no longer allowed is not restored beside.
    mocked.mockResolvedValueOnce({ tabs: [{ id: 'a', route: '/home', title: 'Home', pinned: false, organizationId: null, app: 'home' }, { id: 'b', route: '/mail', title: 'Mail', pinned: false, organizationId: null, app: 'mail' }], activeId: 'a', side: { id: 'b', split: 0.3 }, restored: true } as never);
    await restoreTabs(new Set(['home']));
    expect(state()).toMatchObject({ activeId: 'a', sideId: null });
  });
});

describe('tearing tabs off and docking windows back (FR-NAV-05)', () => {
  it('a torn-off tab leaves the strip, not into recently closed', async () => {
    const mail = openTab('/mail?folder=inbox', { title: 'Inbox' })!;
    expect(await detachTab(mail, { x: 400.4, y: 300.6 })).toBe(true);
    expect(mocked).toHaveBeenCalledWith('windows:detach', { route: '/mail?folder=inbox', title: 'Inbox', at: { x: 400, y: 301 } });
    expect(ids()).toEqual(['/home']);
    expect(state().closed).toEqual([]);
  });

  it('keeps the tab when the window could not be opened', async () => {
    const mail = openTab('/mail')!;
    mocked.mockRejectedValueOnce(new Error('rate limited'));
    expect(await detachTab(mail)).toBe(false);
    expect(ids()).toEqual(['/home', '/mail']);
  });

  it('a lone tab torn off leaves Home behind', async () => {
    const only = state().activeId!;
    expect(await detachTab(only)).toBe(true);
    expect(ids()).toEqual(['/home']);
    expect(state().activeId).not.toBe(only);
  });

  it('a window dropped on the strip comes back where it was dropped, with the route the main process gives', async () => {
    openTab('/mail');
    mocked.mockResolvedValueOnce({ route: '/tasks?task=7', title: 'Task 7' } as never);
    const id = await adoptWindow(42, { index: 1 });
    expect(mocked).toHaveBeenCalledWith('windows:adopt', { windowId: 42 });
    expect(ids()).toEqual(['/home', '/tasks?task=7', '/mail']);
    expect(state().activeId).toBe(id);
    expect(state().tabs[1]?.title).toBe('Task 7');

    // A window that is already gone adds nothing.
    mocked.mockResolvedValueOnce(null as never);
    expect(await adoptWindow(43)).toBeNull();
    expect(ids()).toHaveLength(3);
  });

  it('a window docked beside keeps the open tab active', () => {
    const home = state().activeId!;
    const side = insertTab('/notes', { side: true, title: 'Notes' });
    expect(state()).toMatchObject({ activeId: home, sideId: side });
  });
});

// worksuite-desktop#155: never two Home tabs.
describe('Home is one tab', () => {
  it('opening Home again — "+", ⌘T, Duplicate, a window taken back in — brings the Home tab forward', () => {
    const home = state().activeId!;
    const mail = openTab('/mail')!;
    expect(openTab('/home')).toBe(home);
    expect(ids()).toEqual(['/home', '/mail']);
    expect(state().activeId).toBe(home);

    activate(mail);
    duplicateTab(home);
    expect(ids()).toEqual(['/home', '/mail']);
    expect(state().activeId).toBe(home);

    activate(mail);
    expect(insertTab('/home', { index: 2 })).toBe(home);
    expect(ids()).toEqual(['/home', '/mail']);
    expect(state().activeId).toBe(home);

    // In the background it stays where it is; other apps still open as many tabs as asked.
    activate(mail);
    expect(openTab('/home', { background: true })).toBe(home);
    expect(state().activeId).toBe(mail);
    openTab('/mail');
    expect(ids()).toEqual(['/home', '/mail', '/mail']);
  });

  it('a closed Home tab can be opened again, once', () => {
    const home = state().activeId!;
    openTab('/mail');
    closeTab(home);
    expect(ids()).toEqual(['/mail']);
    const again = openTab('/home')!;
    expect(openTab('/home')).toBe(again);
    expect(ids()).toEqual(['/mail', '/home']);
  });

  it('two Home tabs saved by an older version come back as one', async () => {
    mocked.mockResolvedValueOnce({ tabs: [{ id: 'a', route: '/home', title: 'Home', pinned: false, organizationId: null, app: 'home' }, { id: 'b', route: '/mail', title: 'Mail', pinned: false, organizationId: null, app: 'mail' }, { id: 'c', route: '/home', title: 'Home', pinned: false, organizationId: null, app: 'home' }], activeId: 'c', side: null, restored: true } as never);
    await restoreTabs(new Set(['home', 'mail']));
    expect(ids()).toEqual(['/home', '/mail']);
    expect(state().activeId).toBe('a');
  });

  it('⌘N in Chat keeps the channel open, so WhatsApp starts a WhatsApp conversation', () => {
    expect(newRoute({ app: 'chat', route: '/chat?channel=whatsapp&wa=7' })).toBe('/chat?channel=whatsapp&wa=7&new=1');
    expect(newRoute({ app: 'chat', route: '/chat' })).toBe('/chat?new=1');
    expect(newRoute({ app: 'sales', route: '/sales?view=orders' })).toBe('/sales?new=1');
  });
});

describe('dock drag data', () => {
  const dt = (v: string) => ({ dataTransfer: { getData: () => v } as unknown as DataTransfer });
  it('takes only a window id from a drop', () => {
    expect(droppedWindow(dt('17'))).toBe(17);
    expect(droppedWindow(dt('0'))).toBeNull();
    expect(droppedWindow(dt('/mail'))).toBeNull();
    expect(droppedWindow(dt('17; drop table'))).toBeNull();
    expect(droppedWindow({ dataTransfer: null })).toBeNull();
  });
  it('treats 0,0 as "the platform did not say"', () => {
    expect(dropPoint({ screenX: 0, screenY: 0 })).toBeUndefined();
    expect(dropPoint({ screenX: 10, screenY: 0 })).toEqual({ x: 10, y: 0 });
  });
});
