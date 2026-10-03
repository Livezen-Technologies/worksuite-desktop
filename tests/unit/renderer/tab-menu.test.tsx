// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../src/core/tabs', async () => {
  const { createStore } = await import('../../../src/core/store');
  return {
    tabsStore: createStore({
      tabs: [
        { id: 'a', title: 'Document', route: '/office/42?name=Proposal.docx', app: 'office', pinned: false },
        { id: 'b', title: 'Home', route: '/home', app: 'home', pinned: true },
      ],
      activeId: 'a',
      sideId: null,
      closed: [{ id: 'c' }],
    }),
    activate: vi.fn(),
    adoptWindow: vi.fn(),
    closeOthers: vi.fn(),
    closeTab: vi.fn(),
    closeToRight: vi.fn(),
    detachTab: vi.fn(),
    dockSide: vi.fn(),
    duplicateTab: vi.fn(),
    moveTab: vi.fn(),
    openTab: vi.fn(),
    reloadTab: vi.fn(),
    restoreClosed: vi.fn(),
    togglePin: vi.fn(),
    undockSide: vi.fn(),
  };
});
vi.mock('../../../src/core/dock-drag', () => ({
  TAB_DRAG: 'tab',
  WINDOW_DRAG: 'window',
  dragHas: vi.fn(),
  dropPoint: vi.fn(),
  droppedWindow: vi.fn(),
  releasedOutside: vi.fn(),
  watchDragPointer: () => () => undefined,
}));
vi.mock('../../../src/core/i18n', () => ({ t: (key: string) => key, text: (key: string) => key, useLanguage: () => 'en' }));
vi.mock('../../../src/core/bridge', () => ({ isMac: false }));
import { closeTab, moveTab, restoreClosed } from '../../../src/core/tabs';
import { TabStrip, tabLink } from '../../../src/layouts/TabStrip';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function open() {
  render(<TabStrip />);
  fireEvent.contextMenu(screen.getByRole('tab', { name: /Document/ }), { clientX: 1000, clientY: 700 });
}
it('portals the full menu outside the tab strip and keeps it scrollable inside the viewport', () => {
  open();
  const menu = screen.getByRole('menu');
  expect(menu.parentElement).toBe(document.body);
  expect(menu.style.maxHeight).toBe('calc(100vh - 16px)');
  expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
  for (const label of ['Close all tabs', 'Reopen closed tab', 'Copy link', 'Move tab right', 'Open in new window'])
    expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeTruthy();
  expect((screen.getByRole('menuitem', { name: 'Move tab left' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
});
it('closes only unpinned tabs through their existing close guard path', () => {
  open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Close all tabs' }));
  expect(closeTab).toHaveBeenCalledExactlyOnceWith('a');
  expect(screen.queryByRole('menu')).toBeNull();
});
it('uses the existing restore and reorder actions', () => {
  open();
  fireEvent.click(screen.getByRole('menuitem', { name: /Reopen closed tab/ }));
  expect(restoreClosed).toHaveBeenCalledOnce();
  fireEvent.contextMenu(screen.getByRole('tab', { name: /Document/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move tab right' }));
  expect(moveTab).toHaveBeenCalledWith(0, 1);
});

it('copies an accepted Office record link without transient name or mode parameters', async () => {
  const { parseDeepLink } = await import('../../../shared/deeplink');
  const link = tabLink({ route: '/office/42?name=Proposal.docx&mode=EDIT', organizationId: 'org-1' });
  expect(link).toBe('worksuite://office/42?org=org-1');
  expect(parseDeepLink(link!).ok).toBe(true);
  expect(tabLink({ route: '/office/doc/new/private-token', organizationId: null })).toBeNull();
});
