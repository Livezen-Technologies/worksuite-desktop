// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseItemLink, type ItemLink } from '@shared/item-links';
import type { Preferences, StatusSnapshot } from '@shared/types';

/**
 * Opening WorkSuite item links in the app (#170): organisation, access, offline, confirmation before anything that
 * changes data, the tab — and Mail's side of it: links in a message, the action card for verified WorkSuite mail
 * and the warning for mail that only claims to be, and Settings › Desktop › Links.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn() }));
const tabs = vi.hoisted(() => ({ navigate: vi.fn(), openTab: vi.fn(), setRoute: vi.fn(), activate: vi.fn() }));
const orgs = vi.hoisted(() => ({ switchOrganization: vi.fn() }));
const session = vi.hoisted(() => ({ openSignInPanel: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  platform: 'linux',
}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<Record<string, unknown>>()), apiGet: api.apiGet, apiPost: api.apiPost, apiPatch: api.apiPatch }));
vi.mock('../../../src/core/tabs', async () => {
  const { createStore } = await import('../../../src/core/store');
  const tabsStore = createStore({ tabs: [] as Array<{ id: string; route: string; app: string; pinned: boolean }>, activeId: null as string | null });
  return { tabsStore, ...tabs, activeTab: () => tabsStore.get().tabs.find((t) => t.id === tabsStore.get().activeId) ?? null };
});
vi.mock('../../../src/core/orgs', () => orgs);
vi.mock('../../../src/core/session', () => ({ ...session, closeSignInPanel: vi.fn(), signInPanel: { get: () => ({ app: null }) } }));
vi.mock('../../../src/core/access', () => ({ canOpen: () => true, canFollowLink: () => true, refuse: vi.fn(), NO_ACCESS: 'no' }));
vi.mock('../../../src/core/i18n', () => ({ t: (k: string) => k, text: (k: string, v?: Record<string, string>) => (v ? k.replace(/\{(\w+)\}/g, (_, n: string) => v[n] ?? '') : k), useLanguage: () => 'en', setLanguage: vi.fn() }));

const { app } = await import('../../../src/core/app-state');
const { tabsStore } = await import('../../../src/core/tabs');
const { itemDialog, needsConfirmation, openItemLink } = await import('../../../src/core/item-links');
const { ItemLinkDialog } = await import('../../../src/app/overlays/ItemLinkDialog');
const { WorkSuiteCard, buttonsFor, stateWords, workSuiteMailItem } = await import('../../../src/modules/mail/WorkSuiteCard');
const { openWorkSuiteLinkFromMail } = await import('../../../src/modules/mail/worksuiteLinks');
const { LinksSettings } = await import('../../../src/modules/settings/LinksSettings');

const link = (raw: string): ItemLink => {
  const r = parseItemLink(raw);
  if (!r.ok) throw new Error(r.reason);
  return r.link;
};
const prefs = (links?: Preferences['links']) => ({ links }) as unknown as Preferences;
const tab = (id: string, route: string, appId: string) => ({ id, route, app: appId, pinned: false, title: '', organizationId: '7', lastActive: 0, suspended: false, reloadKey: 0 });

beforeEach(() => {
  app.set({
    session: { mode: 'account', signingIn: false, moveOffer: false },
    organizationId: '7',
    bootstrap: { organizations: [{ id: '7', name: 'Acme' }, { id: '8', name: 'Beta' }] } as never,
    status: { network: 'ONLINE' } as StatusSnapshot,
    prefs: prefs(),
    auth: { server: { origin: 'https://work.example.lk' } } as never,
  });
  tabsStore.set({ tabs: [], activeId: null });
  bridge.call.mockResolvedValue(undefined);
  api.apiGet.mockResolvedValue({ allowed: true, state: 'ok', title: 'Q3 plan.xlsx' });
  api.apiPost.mockResolvedValue({});
  api.apiPatch.mockResolvedValue({});
  orgs.switchOrganization.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  itemDialog.set({ dialog: null });
  vi.clearAllMocks();
});

const audited = () => bridge.call.mock.calls.filter(([c]) => c === 'links:audit').map(([, p]) => p);

describe('opening an item link', () => {
  it('opens a plain link in its module, after the server says it may, and audits it', async () => {
    await openItemLink(link('worksuite://7/task/5'), { source: 'external' });
    expect(api.apiGet).toHaveBeenCalledWith('/api/links/items/7/task/5');
    expect(tabs.navigate).toHaveBeenCalledWith('/tasks?task=5', '7');
    expect(audited()).toEqual([{ org: '7', type: 'task', id: '5', action: 'open', source: 'external', outcome: 'opened' }]);
  });

  it('brings an already open tab to the front instead of another', async () => {
    tabsStore.set({ tabs: [tab('t1', '/notes?note=5', 'notes')], activeId: null });
    await openItemLink(link('worksuite://7/note/5'), { source: 'email' });
    expect(tabs.activate).toHaveBeenCalledWith('t1');
    expect(tabs.navigate).not.toHaveBeenCalled();
  });

  it('switches to the item’s organisation, and refuses one the person is not in', async () => {
    await openItemLink(link('worksuite://8/note/5'), { source: 'external' });
    expect(orgs.switchOrganization).toHaveBeenCalledWith('8');
    expect(tabs.navigate).toHaveBeenCalledWith('/notes?note=5', '8');

    vi.clearAllMocks();
    await openItemLink(link('worksuite://99/note/5'), { source: 'external' });
    expect(orgs.switchOrganization).not.toHaveBeenCalled();
    expect(tabs.navigate).not.toHaveBeenCalled();
    render(<ItemLinkDialog />);
    expect(screen.getByText("You don't have access to this organisation")).toBeTruthy();
  });

  it('says so in the app when there is no access, with Request access for a Drive item', async () => {
    api.apiGet.mockResolvedValue({ allowed: false, state: 'access_removed', can_request_access: true });
    await openItemLink(link('worksuite://7/file/12'), { source: 'email' });
    expect(tabs.navigate).not.toHaveBeenCalled();
    render(<ItemLinkDialog />);
    expect(screen.getByText("You don't have access to this file")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/links/items/7/file/12/request-access'));
  });

  it('never runs an action that changes data without a yes — and runs it after one', async () => {
    const pending = openItemLink(link('worksuite://7/task/5?action=done'), { source: 'email' });
    await waitFor(() => expect(itemDialog.get().dialog?.kind).toBe('confirm'));
    expect(api.apiPatch).not.toHaveBeenCalled();
    render(<ItemLinkDialog />);
    expect(screen.getByText('Mark as done?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await pending;
    expect(api.apiPatch).toHaveBeenCalledWith('/api/tasks/5', { field: 'status', value: 'done' });
    expect(tabs.navigate).toHaveBeenCalledWith('/tasks?task=5', '7');
    expect(audited().at(-1)).toMatchObject({ action: 'done', outcome: 'confirmed' });
  });

  it('does nothing to the data when the person cancels, and still shows the item', async () => {
    const pending = openItemLink(link('worksuite://7/event/3?action=decline'), { source: 'email' });
    await waitFor(() => expect(itemDialog.get().dialog?.kind).toBe('confirm'));
    render(<ItemLinkDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await pending;
    expect(api.apiPost).not.toHaveBeenCalled();
    expect(tabs.navigate).toHaveBeenCalledWith('/calendar?event=3', '7');
    expect(audited().at(-1)).toMatchObject({ outcome: 'cancelled' });
  });

  it('confirms data-changing actions even with "Ask before running actions" off; other actions follow the setting', () => {
    const off = { confirmActions: false };
    const on = { confirmActions: true };
    expect(needsConfirmation(link('worksuite://7/task/5?action=done'), off)).toBe(true);
    expect(needsConfirmation(link('worksuite://7/reminder/5?action=snooze&run=2'), off)).toBe(true);
    expect(needsConfirmation(link('worksuite://7/file/5?action=download'), off)).toBe(false);
    expect(needsConfirmation(link('worksuite://7/file/5?action=download'), on)).toBe(true);
    expect(needsConfirmation(link('worksuite://7/file/5'), on)).toBe(false);
  });

  it('runs a download without asking when the setting is off', async () => {
    app.set({ prefs: prefs({ confirmActions: false }) });
    await openItemLink(link('worksuite://7/file/12?action=download'), { source: 'email' });
    expect(itemDialog.get().dialog).toBeNull();
    expect(bridge.call).toHaveBeenCalledWith('transfers:download', { fileId: '12', name: 'Q3 plan.xlsx' });
  });

  it('opens a stored copy offline for what keeps one, else "Available when online"', async () => {
    app.set({ status: { network: 'OFFLINE' } as StatusSnapshot });
    await openItemLink(link('worksuite://7/note/5'), { source: 'external' });
    expect(tabs.navigate).toHaveBeenCalledWith('/notes?note=5', '7');
    expect(api.apiGet).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await openItemLink(link('worksuite://7/invoice/5'), { source: 'external' });
    expect(tabs.navigate).not.toHaveBeenCalled();
    render(<ItemLinkDialog />);
    expect(screen.getByText('Available when online')).toBeTruthy();
  });

  it('asks a guest to sign in, in the app', async () => {
    app.set({ session: { mode: 'guest', signingIn: false, moveOffer: false } });
    await openItemLink(link('worksuite://7/task/5'), { source: 'external' });
    expect(session.openSignInPanel).toHaveBeenCalledWith('tasks');
    expect(tabs.navigate).not.toHaveBeenCalled();
  });
});

describe('links in Mail', () => {
  it('opens a WorkSuite item link in a new tab, not the browser', async () => {
    expect(openWorkSuiteLinkFromMail('https://app.worksuite.lk/o/7/note/5')).toBe(true);
    await waitFor(() => expect(tabs.openTab).toHaveBeenCalledWith('/notes?note=5', { organizationId: '7' }));
  });

  it('opens in the current tab when Settings say so', async () => {
    app.set({ prefs: prefs({ mailLinks: 'current-tab' }) });
    tabsStore.set({ tabs: [tab('mail', '/mail', 'mail')], activeId: 'mail' });
    expect(openWorkSuiteLinkFromMail('https://work.example.lk/o/7/note/5')).toBe(true);
    await waitFor(() => expect(tabs.setRoute).toHaveBeenCalledWith('mail', '/notes?note=5'));
  });

  it('leaves other sites, and everything when links open in the browser, to the safe-links check', () => {
    expect(openWorkSuiteLinkFromMail('https://example.com/o/7/note/5')).toBe(false);
    app.set({ prefs: prefs({ openInApp: false }) });
    expect(openWorkSuiteLinkFromMail('https://app.worksuite.lk/o/7/note/5')).toBe(false);
  });

  it('refuses a WorkSuite link it does not know rather than guessing', () => {
    expect(openWorkSuiteLinkFromMail('https://app.worksuite.lk/o/7/file/5?action=delete')).toBe(true);
    expect(tabs.openTab).not.toHaveBeenCalled();
  });
});

describe('the action card', () => {
  const security = { available: true, spf: 'pass', dkim: 'pass', dmarc: 'pass' };
  const context = (verified: boolean, s = security) => ({ security: s, worksuite_item: { header: 'type=file;id=12;org=7', verified } });
  const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

  it('shows the item and its buttons for verified WorkSuite mail', async () => {
    api.apiGet.mockResolvedValue({ allowed: true, state: 'ok', title: 'Q3 plan.xlsx', kind_label: 'Spreadsheet', size: 2048, sharer: 'Nimal' });
    const mail = workSuiteMailItem('no-reply@worksuite.lk', context(true))!;
    expect(mail.verified).toBe(true);
    wrap(<WorkSuiteCard mail={mail} offline={false} />);
    expect(await screen.findByText('Q3 plan.xlsx')).toBeTruthy();
    expect(screen.getByText(/Shared by Nimal/)).toBeTruthy();
    for (const b of ['Open in WorkSuite', 'Download', 'Show in Files']) expect(screen.getByRole('button', { name: b })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show in Files' }));
    await waitFor(() => expect(tabs.openTab).toHaveBeenCalledWith('/files?file=12', { organizationId: '7' }));
  });

  it('warns about spoofed mail and never shows a button', () => {
    for (const mail of [
      workSuiteMailItem('no-reply@worksuite.lk', context(true, { ...security, dkim: 'fail' }))!,
      workSuiteMailItem('no-reply@worksuite.lk', context(false))!,
      workSuiteMailItem('attacker@example.com', context(true))!,
      workSuiteMailItem('no-reply@evil.example.lk', context(true))!,
    ]) {
      expect(mail.verified).toBe(false);
      wrap(<WorkSuiteCard mail={mail} offline={false} />);
      expect(screen.getByRole('alert').textContent).toMatch(/could not be verified/);
      expect(screen.queryByRole('button')).toBeNull();
      cleanup();
    }
    expect(api.apiGet).not.toHaveBeenCalled();
  });

  it('trusts the signed-in server’s own sender too (a self-hosted WorkSuite)', () => {
    expect(workSuiteMailItem('no-reply@work.example.lk', context(true))!.verified).toBe(true);
  });

  it('is no card at all for ordinary mail or a header off the allow-list', () => {
    expect(workSuiteMailItem('a@b.c', { security, worksuite_item: null })).toBeNull();
    expect(workSuiteMailItem('no-reply@worksuite.lk', { security, worksuite_item: { header: 'type=file;id=1;org=7;token=x', verified: true } })).toBeNull();
  });

  it('says the item’s state and drops buttons that no longer apply', () => {
    expect(stateWords('file', { allowed: false, state: 'access_removed' })).toBe('Access removed');
    expect(buttonsFor('file', { allowed: false, state: 'access_removed' })).toEqual([]);
    expect(stateWords('meeting', { allowed: true, state: 'ended' })).toBe('Meeting ended');
    expect(buttonsFor('meeting', { allowed: true, state: 'ended' })).toEqual(['details']);
    expect(stateWords('task', { allowed: true, state: 'completed' })).toBe('Task already completed');
    expect(buttonsFor('task', { allowed: true, state: 'completed' })).toEqual(['open']);
  });
});

describe('Settings › Desktop › Links', () => {
  it('shows the three settings with their defaults and saves each change', async () => {
    bridge.call.mockImplementation(async (ch: string, patch: unknown) => (ch === 'settings:set' ? { preferences: { ...(app.get().prefs ?? {}), ...(patch as object), language: 'en' }, locks: [] } : undefined));
    render(<LinksSettings prefs={prefs()} />);
    const open = screen.getByRole('switch', { name: 'Open WorkSuite links in the desktop app' });
    const ask = screen.getByRole('switch', { name: 'Ask before running actions from links' });
    expect(open.getAttribute('aria-checked')).toBe('true');
    expect(ask.getAttribute('aria-checked')).toBe('true');
    await act(async () => fireEvent.click(ask));
    const saved = bridge.call.mock.calls.find(([c]) => c === 'settings:set')?.[1] as { links: unknown };
    expect(saved.links).toEqual({ openInApp: true, mailLinks: 'new-tab', confirmActions: false });
  });
});
