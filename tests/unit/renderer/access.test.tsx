// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import type * as CoreApi from '../../../src/core/api';

/**
 * An app the person was not given is not there: no tab, no link into it, no
 * browser as a way round, no shortcut, no notification row.
 */
const apiGet = vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: (...a: unknown[]) => apiGet(...a), apiPost: vi.fn() }));
vi.mock('../../../resources/icons/512x512.png', () => ({ default: 'icon.png' }));

// The preload's bridge, as the main window has it.
const openInBrowser = vi.fn(async () => true);
const openWindow = vi.fn(async () => ({ id: 2 }));
window.worksuite = {
  platform: 'darwin',
  app: { openInBrowser },
  windows: { open: openWindow },
  tabs: { save: vi.fn(async () => undefined) },
  notifications: { refresh: vi.fn(async () => undefined) },
  files: { registerDropped: async () => [] },
  events: { on: () => () => undefined },
};
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });

const { app } = await import('../../../src/core/app-state');
const { toasts } = await import('../../../src/core/toasts');
const { openWebLink } = await import('../../../src/core/tab-context');
const { closeTab, closeTabsForApps, navigate, openTab, resetTabs, restoreClosed, tabsStore } = await import('../../../src/core/tabs');
const { registerCommand, runCommand, allCommands } = await import('../../../src/core/commands');
const { allowedModules } = await import('../../../src/modules/registry');
const { visibleNotices, visibleCategories } = await import('../../../src/modules/notifications/api');
const { NotifDrawer } = await import('../../../src/modules/notifications/Drawer');

/** Somebody not set up: Home, HR and the everyday apps. */
const give = (apps: string[]) => app.set({ apps: visibleApps({ apps, permissions: [] }) });
const lastToast = () => toasts.get().items.at(-1)?.text;

beforeEach(() => {
  give(['mail', 'chat', 'calendar', 'tasks', 'notes', 'drive']);
  toasts.set({ items: [] });
  openInBrowser.mockClear();
  openWindow.mockClear();
  resetTabs();
});
afterEach(() => cleanup());

describe('links (openWebLink)', () => {
  it('refuses a link into a native app the person may not open, instead of opening it in the browser', () => {
    openWebLink('/crm/leads/4');
    expect(openInBrowser).not.toHaveBeenCalled();
    expect(tabsStore.get().tabs.some((t) => t.app === 'crm')).toBe(false);
    expect(lastToast()).toBe("You don't have access to this.");
  });

  it('refuses a link into a browser app the person may not open', () => {
    openWebLink('/finance/journal?entry=3');
    openWebLink('/tickets?ticket=9');
    expect(openInBrowser).not.toHaveBeenCalled();
    expect(lastToast()).toBe("You don't have access to this.");
  });

  it('still opens the person’s own apps, and pages of no app, as before', () => {
    openWebLink('/tasks?task=3');
    expect(tabsStore.get().tabs.some((t) => t.app === 'tasks' && t.route === '/tasks?task=3')).toBe(true);
    openWebLink('/users/12');
    expect(openInBrowser).toHaveBeenCalledWith({ path: '/users/12' });
    give(['mail', 'expenses']);
    openWebLink('/expenses?claim=2');
    expect(tabsStore.get().tabs.some((t) => t.app === 'expenses' && t.route === '/expenses?claim=2')).toBe(true);
  });
});

describe('their own claims and payslips', () => {
  it('opens a claim for somebody who has Expenses only for themselves, and a payslip in HR without Payroll', () => {
    app.set({ apps: visibleApps({ apps: ['mail'], permissions: [], selfService: ['expenses'] }) });
    expect(app.get().apps.find((a) => a.id === 'expenses')?.selfService).toBe(true);
    openWebLink('/expenses?claim=2');
    expect(tabsStore.get().tabs.some((t) => t.app === 'expenses' && t.route === '/expenses?claim=2')).toBe(true);
    openWebLink('/payroll/me/payslips/PS-1');
    expect(tabsStore.get().tabs.some((t) => t.app === 'hr' && t.route === '/hr?tab=mypay')).toBe(true);
    openWebLink('/payroll?tab=runs');
    expect(lastToast()).toBe("You don't have access to this.");
  });
});

describe('tabs', () => {
  it('never opens a tab on an app the person may not open', () => {
    expect(openTab('/crm')).toBeNull();
    navigate('/billing?invoice=3');
    expect(tabsStore.get().tabs.map((t) => t.app)).toEqual(['home']);
    expect(lastToast()).toBe("You don't have access to this.");
    expect(openTab('/mail')).not.toBeNull();
  });

  it('does not reopen a closed tab of an app the person has lost', () => {
    const id = openTab('/mail?msg=4')!;
    closeTab(id);
    give(['chat']);
    restoreClosed();
    expect(tabsStore.get().tabs.some((t) => t.app === 'mail')).toBe(false);
    expect(tabsStore.get().closed).toEqual([]);
  });

  it('closes the tabs of apps that left, and forgets them as closed tabs', () => {
    openTab('/mail');
    const chat = openTab('/chat')!;
    closeTab(chat);
    give(['tasks']);
    const gone = closeTabsForApps(allowedModules(new Set(app.get().apps.map((a) => a.id))));
    expect(gone).toEqual(['mail']);
    expect(tabsStore.get().tabs.map((t) => t.app)).toEqual(['home']);
    expect(tabsStore.get().closed.some((t) => t.app === 'chat')).toBe(false);
  });
});

describe('the registry', () => {
  it('opens a part of an app (calls) only with that app, and the shell screens to everyone', () => {
    expect(allowedModules(new Set(['chat'])).has('calls')).toBe(true);
    const none = allowedModules(new Set(['mail']));
    expect(none.has('calls')).toBe(false);
    expect(none.has('chat')).toBe(false);
    for (const id of ['home', 'notifications', 'settings', 'account', 'diagnostics']) expect(none.has(id)).toBe(true);
  });
});

describe('commands', () => {
  it('runs a shortcut’s command only while it is available — as the palette lists it', () => {
    const run = vi.fn();
    const off = registerCommand({ id: 'test-ai', label: 'AI', group: 'Shell', run, when: () => app.get().apps.some((a) => a.id === 'ai') });
    expect(runCommand('test-ai')).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(allCommands().some((c) => c.id === 'test-ai')).toBe(false);
    give(['ai']);
    expect(runCommand('test-ai')).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    off();
  });

  it('keeps a hidden command out of the palette but runs it from its keys', () => {
    const run = vi.fn();
    const off = registerCommand({ id: 'test-org', label: 'Org 1', group: 'Shell', run, hidden: true });
    expect(allCommands().some((c) => c.id === 'test-org')).toBe(false);
    expect(runCommand('test-org')).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    off();
  });
});

type N = Parameters<typeof visibleNotices>[0][number];
const notice = (id: number, over: Partial<N>): N => ({ id, event: 'x.y', category: 'system', title: `N${id}`, body: null, link: null, icon: null, level: 'info', priority: 'normal', count: 1, image_url: null, read: false, archived: false, pinned: false, snoozed_until: null, created_at: '2026-09-28 08:00:00', ...over });

describe('notifications', () => {
  const list = [
    notice(1, { category: 'crm', title: 'Lead assigned', link: '/crm/leads/4' }),
    notice(2, { category: 'projects', title: 'Task due', link: '/tasks?task=3' }),
    notice(3, { category: 'system', title: 'Maintenance tonight', link: null }),
    notice(4, { category: 'expenses', title: 'Claim approved', link: '/expenses?claim=2' }),
  ];

  it('leaves out rows of apps the person may not open, and keeps rows without a link', () => {
    const ids = new Set(app.get().apps.map((a) => a.id));
    expect(visibleNotices(list, ids).map((n) => n.id)).toEqual([2, 3]);
    expect(visibleCategories(Object.entries({ crm: 1, projects: 2, system: 3, oms: 4 }), ids).map(([c]) => c)).toEqual(['projects', 'system']);
  });

  it('does not show them in the bell’s drawer, nor their apps in its Apps list', async () => {
    apiGet.mockResolvedValue({ notifications: list, page: 1, per_page: 60, total: 4, counts: { total: 4, unread: 4, by_category: { crm: { total: 1, unread: 1 }, projects: { total: 1, unread: 1 } } }, categories: {} });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    render(<NotifDrawer />, { wrapper: wrap });
    await waitFor(() => expect(screen.getByText('Task due')).toBeTruthy());
    expect(screen.getByText('Maintenance tonight')).toBeTruthy();
    expect(screen.queryByText('Lead assigned')).toBeNull();
    expect(screen.queryByText('Claim approved')).toBeNull();
    screen.getByRole('button', { name: /Apps/ }).click();
    const menu = await screen.findByRole('menu', { name: 'Apps' });
    expect(menu.textContent).not.toContain('CRM');
    expect(menu.textContent).toContain('Projects');
  });
});
