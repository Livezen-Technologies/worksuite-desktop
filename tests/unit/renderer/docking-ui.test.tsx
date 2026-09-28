// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Registry from '../../../src/modules/registry';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ apps: [] as Array<{ id: string }> }) };
});
// Each tab shows its route, so a test can see which pane holds what.
vi.mock('../../../src/modules/registry', async (orig) => {
  const real = await orig<typeof Registry>();
  const Page = ({ route }: { route: string }) => <p>page {route}</p>;
  return { ...real, moduleFor: (id: string) => ({ manifest: { name: id }, component: Page, always: true }) };
});

import { call } from '../../../src/core/bridge';
import { app } from '../../../src/core/app-state';
import { dockSide, openTab, resetTabs, tabsStore } from '../../../src/core/tabs';
import { TAB_DRAG, WINDOW_DRAG } from '../../../src/core/dock-drag';
import { Workspace } from '../../../src/layouts/Workspace';
import { TabStrip } from '../../../src/layouts/TabStrip';
import { WindowRoot } from '../../../src/app/WindowRoot';

const mocked = vi.mocked(call);

/** A drag's data, as the browser hands it to dragover and drop. */
function transfer(data: Record<string, string>) {
  return { types: Object.keys(data), getData: (t: string) => data[t] ?? '', setData: vi.fn(), dropEffect: 'none', effectAllowed: 'all' };
}

beforeEach(() => {
  // jsdom has no DragEvent: without one a drag's pointer (clientX, screenX, relatedTarget) never reaches the handler.
  vi.stubGlobal('DragEvent', class extends MouseEvent {});
  mocked.mockReset();
  mocked.mockResolvedValue(undefined as never);
  resetTabs();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the workspace, docked (FR-NAV-07)', () => {
  it('shows the docked tab beside the active one with a divider, and undocks from its bar', () => {
    const home = tabsStore.get().activeId!;
    openTab('/mail');
    dockSide(home);
    render(<Workspace />);

    const panes = screen.getAllByRole('tabpanel');
    expect(panes.filter((p) => !p.hidden)).toHaveLength(2);
    expect(screen.getByText('page /mail')).toBeTruthy();
    expect(screen.getByText('page /home')).toBeTruthy();

    const divider = screen.getByRole('separator', { name: 'Resize the docked tab' });
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(tabsStore.get().split).toBeCloseTo(0.55);

    fireEvent.click(screen.getByRole('button', { name: 'Undock' }));
    expect(tabsStore.get().sideId).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('docks a tab dragged to the right-hand side', () => {
    const home = tabsStore.get().activeId!;
    openTab('/mail');
    render(<Workspace />);
    const main = screen.getByRole('main');
    const dataTransfer = transfer({ [TAB_DRAG]: home });

    fireEvent.dragOver(main, { clientX: 800, clientY: 300, dataTransfer });
    expect(screen.getByText('Dock beside')).toBeTruthy();
    fireEvent.drop(main, { clientX: 800, clientY: 300, dataTransfer });
    expect(tabsStore.get().sideId).toBe(home);
  });

  it('takes a torn-off window back in beside, or as a tab', async () => {
    render(<Workspace />);
    const main = screen.getByRole('main');
    mocked.mockResolvedValueOnce({ route: '/notes', title: 'Notes' } as never);
    await act(async () => {
      fireEvent.drop(main, { clientX: 900, clientY: 300, dataTransfer: transfer({ [WINDOW_DRAG]: '7' }) });
    });
    expect(mocked).toHaveBeenCalledWith('windows:adopt', { windowId: 7 });
    const s = tabsStore.get();
    expect(s.tabs.find((t) => t.id === s.sideId)?.route).toBe('/notes');

    mocked.mockResolvedValueOnce({ route: '/tasks', title: 'Tasks' } as never);
    await act(async () => {
      fireEvent.drop(main, { clientX: 100, clientY: 300, dataTransfer: transfer({ [WINDOW_DRAG]: '8' }) });
    });
    expect(tabsStore.get().tabs.find((t) => t.id === tabsStore.get().activeId)?.route).toBe('/tasks');
  });
});

describe('the tab strip, torn off (FR-NAV-05)', () => {
  it('offers docking and a new window in the tab menu', async () => {
    openTab('/mail', { title: 'Mail' });
    render(<TabStrip />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Mail/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dock beside' }));
    expect(tabsStore.get().tabs.find((t) => t.id === tabsStore.get().sideId)?.route).toBe('/mail');

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Mail/ }));
    expect(screen.getByRole('menuitem', { name: 'Undock from beside' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move to new window' }));
    });
    expect(mocked).toHaveBeenCalledWith('windows:detach', { route: '/mail', title: 'Mail', at: undefined });
    expect(tabsStore.get().tabs.map((t) => t.route)).toEqual(['/home']);
  });

  it('tears a tab off only when it is let go outside the window', async () => {
    openTab('/mail', { title: 'Mail' });
    render(<TabStrip />);
    const tab = screen.getByRole('tab', { name: /Mail/ });
    const detached = () => mocked.mock.calls.filter(([c]) => c === 'windows:detach');

    // The window takes a tab dragged over any of it, so letting go over the page is not "outside".
    fireEvent.dragStart(tab, { dataTransfer: transfer({}) });
    expect(fireEvent.dragOver(document.body, { dataTransfer: transfer({ [TAB_DRAG]: 'x' }) })).toBe(false);
    expect(fireEvent.dragOver(document.body, { dataTransfer: transfer({ Files: '' }) })).toBe(true);

    // Let go inside the window's rectangle, on nothing (Escape, say): stays a tab.
    fireEvent.dragEnd(tab, { screenX: 500, screenY: 400, dataTransfer: transfer({}) });
    expect(detached()).toHaveLength(0);

    // Let go off the window: its own window, where it was let go.
    fireEvent.dragStart(tab, { dataTransfer: transfer({}) });
    await act(async () => {
      fireEvent.dragEnd(tab, { screenX: 1700, screenY: 300, dataTransfer: transfer({}) });
    });
    expect(detached().at(-1)?.[1]).toEqual({ route: '/mail', title: 'Mail', at: { x: 1700, y: 300 } });
  });

  it('where the platform gives no point (Linux), goes by whether the pointer left the window', async () => {
    openTab('/mail', { title: 'Mail' });
    render(<TabStrip />);
    const tab = screen.getByRole('tab', { name: /Mail/ });
    const detached = () => mocked.mock.calls.filter(([c]) => c === 'windows:detach');

    fireEvent.dragStart(tab, { dataTransfer: transfer({}) });
    fireEvent.dragOver(window, { dataTransfer: transfer({}) });
    fireEvent.dragEnd(tab, { screenX: 0, screenY: 0, dataTransfer: transfer({}) });
    expect(detached()).toHaveLength(0);

    fireEvent.dragStart(tab, { dataTransfer: transfer({}) });
    fireEvent.dragLeave(document.body, { relatedTarget: null, dataTransfer: transfer({}) });
    await act(async () => {
      fireEvent.dragEnd(tab, { screenX: 0, screenY: 0, dataTransfer: transfer({}) });
    });
    // Placed a step from the last torn-off window, as the main process decides.
    expect(detached().at(-1)?.[1]).toEqual({ route: '/mail', title: 'Mail', at: undefined });
  });

  it('takes a window dropped between two tabs in at that place', async () => {
    openTab('/mail', { title: 'Mail' });
    render(<TabStrip />);
    mocked.mockResolvedValueOnce({ route: '/notes', title: 'Notes' } as never);
    await act(async () => {
      fireEvent.drop(screen.getByRole('tab', { name: /Mail/ }), { dataTransfer: transfer({ [WINDOW_DRAG]: '9' }) });
    });
    expect(mocked).toHaveBeenCalledWith('windows:adopt', { windowId: 9 });
    expect(tabsStore.get().tabs.map((t) => t.route)).toEqual(['/home', '/notes', '/mail']);
  });
});

describe('a torn-off window (FR-NAV-05)', () => {
  it('docks back as a tab or beside, drags by its handle, and says where it is', async () => {
    app.set({ apps: [{ id: 'mail' }] } as never);
    mocked.mockImplementation(async (channel: string) => (channel === 'windows:state' ? { id: 12, kind: 'record', alwaysOnTop: false } : undefined) as never);
    render(<WindowRoot hash="#/window/record?route=%2Fmail%3Ffolder%3Dsent" />);
    const handle = await screen.findByTitle('Drag onto the main window to dock');

    const dataTransfer = transfer({});
    fireEvent.dragStart(handle, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(WINDOW_DRAG, '12');

    fireEvent.click(screen.getByRole('button', { name: 'Dock to main window' }));
    expect(mocked).toHaveBeenCalledWith('windows:dock', {});
    fireEvent.click(screen.getByRole('button', { name: "Dock beside the main window's tab" }));
    expect(mocked).toHaveBeenCalledWith('windows:dock', { side: true });

    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('windows:describe', { route: '/mail?folder=sent', title: 'mail' }));
  });

  it('a mini chat has no docking controls', async () => {
    mocked.mockImplementation(async (channel: string) => (channel === 'windows:state' ? { id: 13, kind: 'chat-mini', alwaysOnTop: true } : undefined) as never);
    render(<WindowRoot hash="#/window/chat-mini?route=%2Fchat" />);
    await screen.findByRole('button', { name: 'Stop keeping on top' });
    expect(screen.queryByRole('button', { name: 'Dock to main window' })).toBeNull();
  });
});
