// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));

import { call } from '../../../src/core/bridge';
import { activate, navigate, openTab, resetTabs, restoreTabs, tabsStore } from '../../../src/core/tabs';
import { app } from '../../../src/core/app-state';
import { visibleApps } from '@shared/apps';

/**
 * A support ticket in a tab of its own (D-02, FR-DSK-05, WF-12): a deep link, a notification or the inbox focuses the
 * ticket's tab when it is open and opens one when not; the inbox is a tab of its own that never takes a ticket's
 * place, nor a ticket the inbox's.
 */
const state = () => tabsStore.get();
const routes = () => state().tabs.map((t) => t.route);
const active = () => state().tabs.find((t) => t.id === state().activeId)!;

beforeEach(() => {
  vi.mocked(call).mockReset().mockResolvedValue(undefined as never);
  app.set({ apps: visibleApps({ apps: ['mail'], permissions: ['support.view'] }) });
  resetTabs();
});

describe('support ticket tabs', () => {
  it('opens a ticket in a tab, and brings it forward when it is asked for again', () => {
    navigate('/support/ticket/1284');
    const first = active();
    expect(first.route).toBe('/support/ticket/1284');
    navigate('/mail');
    navigate('/support/ticket/1284');
    expect(active().id).toBe(first.id);
    // The web's forms of the same ticket (a notification's `/tickets?ticket=`) are the same tab.
    navigate('/mail');
    navigate('/support?ticket=1284');
    expect(active().id).toBe(first.id);
    expect(routes().filter((r) => r.startsWith('/support'))).toEqual(['/support/ticket/1284']);
  });

  it('opens a second ticket beside the first, never in its place', () => {
    navigate('/support/ticket/1');
    navigate('/support/ticket/2');
    expect(routes().filter((r) => r.startsWith('/support'))).toEqual(['/support/ticket/1', '/support/ticket/2']);
  });

  it('keeps the inbox a tab of its own', () => {
    navigate('/support?view=mine');
    const inbox = active();
    navigate('/support/ticket/7');
    const tab7 = active();
    expect(tab7.id).not.toBe(inbox.id);
    // From the ticket's tab, a view opens in the inbox's tab, which comes forward.
    navigate('/support?view=unassigned');
    expect(active().id).toBe(inbox.id);
    expect(active().route).toBe('/support?view=unassigned');
    expect(state().tabs.find((t) => t.id === tab7.id)!.route).toBe('/support/ticket/7');
    // Within the inbox, a view is the same tab.
    navigate('/support?view=overdue');
    expect(active().id).toBe(inbox.id);
  });

  it('opens a new inbox when only tickets are open', () => {
    navigate('/support/ticket/7');
    activate(state().tabs[0]!.id);
    navigate('/support');
    expect(routes().filter((r) => r.startsWith('/support'))).toEqual(['/support/ticket/7', '/support']);
  });

  it('writes a ticket’s tab in one form, wherever it was opened from', () => {
    openTab('/support/4');
    expect(active().route).toBe('/support/ticket/4');
    expect(active().app).toBe('support');
  });

  it('restores ticket tabs after a relaunch', async () => {
    vi.mocked(call).mockResolvedValueOnce({ tabs: [{ id: 'a', route: '/support?ticket=9', title: 'CFX-000009', pinned: false, organizationId: null, app: 'support' }], activeId: 'a', side: null, restored: true } as never);
    await restoreTabs(new Set(['support', 'home']));
    expect(routes()).toEqual(['/support/ticket/9']);
    expect(active().title).toBe('CFX-000009');
  });

  it('refuses a ticket to somebody without the desk', () => {
    app.set({ apps: visibleApps({ apps: ['mail'], permissions: [] }) });
    navigate('/support/ticket/1284');
    expect(routes().some((r) => r.startsWith('/support'))).toBe(false);
  });
});
