// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tabs = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: tabs.navigate }));

import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import MailPage from '../../../src/modules/mail/MailPage';
import { allCount, localDrafts, seedFromContext, slugRole } from '../../../src/modules/mail/allAccounts';
import { runSync, setSyncOne, syncAgo, syncRunner, syncSummary } from '../../../src/modules/mail/sync';
import type { AllCounts, SyncAccount, SyncStatus } from '../../../src/modules/mail/types';

/**
 * ENH-MAIL-03 v1.1: All Accounts folders (DMO-ALL, AC-DMO-17…19, 23) and
 * Sync all with one shared sync status (DMO-SYN, AC-DMO-20…22).
 */

const NOW = new Date('2026-10-04T10:00:00Z');
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString().replace('T', ' ').slice(0, 19);
const acct = (id: number, over: Partial<SyncAccount> = {}): SyncAccount => ({ mailbox: id, email: `box${id}@example.test`, name: `box${id}@example.test`, included: true, paused: false, mode: 'interval', interval_min: 5, last_ok_at: at(2), last_attempt_at: at(2), last_result: 'ok', error_code: null, error: null, running: false, mirror: true, pushed: false, folders: 6, folders_done: 6, ...over });
const status = (accounts: SyncAccount[]): SyncStatus => ({ enabled: true, mailboxes: [], accounts, overall: { state: 'up_to_date', syncing: 0, total: accounts.length, last_ok_at: null, failed: [], stale: [], stale_minutes: 60 } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  syncRunner.set({ running: new Set(), all: false, errors: {} });
});
afterEach(() => {
  cleanup();
  setSyncOne(null);
  vi.useRealTimers();
});

describe('the one sync status (DMO-SYN-05…07, 14)', () => {
  it('is up to date with the most recent successful sync', () => {
    const s = syncSummary(status([acct(1, { last_ok_at: at(5) }), acct(2, { last_ok_at: at(1) })]), { offline: false });
    expect(s.state).toBe('up_to_date');
    expect(s.headline).toBe('Synced 1 min ago');
    expect(s.detail).toBe('2 of 2 accounts');
    expect(s.warning).toBeNull();
  });

  it('says how many accounts are syncing, counting the ones this computer started', () => {
    const s = syncSummary(status([acct(1), acct(2), acct(3, { running: true, last_result: 'running' }), acct(4)]), { offline: false, running: new Set([1]) });
    expect(s.state).toBe('syncing');
    expect(s.headline).toBe('Syncing 2 of 4 accounts…');
  });

  it('needs attention when an account failed, and names a stale one by name (AC-DMO-22)', () => {
    const failed = syncSummary(status([acct(1), acct(2, { name: 'Personal', last_result: 'failed', error: 'Google sign-in expired — sign in again', last_ok_at: at(180) })]), { offline: false });
    expect(failed.state).toBe('attention');
    expect(failed.headline).toBe('Needs attention · Personal failed');
    expect(failed.detail).toBe('Other 1 accounts synced 2 min ago');
    expect(failed.warning).toBe('Personal not synced for 3 h');

    const stale = syncSummary(status([acct(1), acct(2, { name: 'Sales', last_ok_at: at(75) })]), { offline: false });
    expect(stale.state).toBe('attention');
    expect(stale.warning).toBe('Sales not synced for 1 h');
    // A wider threshold: not stale yet.
    expect(syncSummary(status([acct(1), acct(2, { last_ok_at: at(75) })]), { offline: false, staleMinutes: 180 }).state).toBe('up_to_date');
  });

  it('is amber, never green, for an account that is only out of date; red for a failure (#172)', () => {
    expect(syncSummary(status([acct(1), acct(2, { name: 'Sales', last_ok_at: at(5 * 24 * 60) })]), { offline: false }).tone).toBe('warning');
    expect(syncSummary(status([acct(1), acct(2, { last_result: 'failed', error: 'x' })]), { offline: false }).tone).toBe('danger');
  });

  it('counts live push connections from the real connection state (#172)', () => {
    const push = (id: number) => acct(id, { mode: 'push', pushed: true });
    const box = (id: number, up: boolean) => ({ mailbox: id, status: up ? 'live' : 'degraded', serving: true, lag_seconds: 0, pushed: up, problem: null, last_sync_at: null });
    const both = syncSummary({ ...status([push(1), push(2)]), mailboxes: [box(1, true), box(2, true)] }, { offline: false });
    expect([both.state, both.live, both.pushTotal, both.detail]).toEqual(['up_to_date', 2, 2, '2 of 2 mailboxes live']);
    const none = syncSummary({ ...status([push(1), push(2)]), mailboxes: [box(1, false), box(2, false)] }, { offline: false });
    expect([none.live, none.liveLine, none.detail]).toEqual([0, '0 of 2 mailboxes live', '2 of 2 accounts']);
    // An account checked on a schedule has no live connection to count.
    expect(syncSummary(status([acct(1)]), { offline: false }).liveLine).toBeNull();
  });

  it('is offline with the last successful sync, and paused when every account is (DMO-SYN-13)', () => {
    const off = syncSummary(status([acct(1, { last_ok_at: at(30) })]), { offline: true });
    expect([off.state, off.headline, off.detail]).toEqual(['offline', 'Offline', 'Last successful sync 30 min ago']);
    expect(syncSummary(status([acct(1, { paused: true })]), { offline: false }).state).toBe('paused');
  });

  it('says times relative under a day, the date and time after that (DMO-SYN-14)', () => {
    expect(syncAgo(at(0), NOW.getTime())).toBe('just now');
    expect(syncAgo(at(6), NOW.getTime())).toBe('6 min ago');
    expect(syncAgo(at(150), NOW.getTime())).toBe('2 h ago');
    expect(syncAgo(at(26 * 60), NOW.getTime())).toBe('3 Oct 2026 8:00');
  });
});

describe('Sync all (DMO-SYN-01, 02, 12; AC-DMO-20)', () => {
  it('runs at most three accounts at a time, and a second Sync all while it runs starts nothing', async () => {
    let live = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const asked: number[] = [];
    setSyncOne(async (id) => {
      asked.push(id);
      live++;
      peak = Math.max(peak, live);
      await new Promise<void>((r) => release.push(r));
      live--;
    });
    const first = runSync([1, 2, 3, 4, 5], { all: true });
    await vi.waitFor(() => expect(asked).toEqual([1, 2, 3]));
    expect(syncRunner.get().all).toBe(true);
    // Pressed again while running: nothing new.
    expect(await runSync([1, 2, 3, 4, 5], { all: true })).toEqual({ started: [], failed: [] });
    // One account's own button while it already syncs: nothing either.
    expect(await runSync([2])).toEqual({ started: [], failed: [] });
    while (release.length || asked.length < 5) {
      release.shift()?.();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    await first;
    expect(peak).toBe(3);
    expect(asked).toEqual([1, 2, 3, 4, 5]);
    expect(syncRunner.get().all).toBe(false);
    expect(syncRunner.get().running.size).toBe(0);
  });

  it('keeps going when one account fails, and remembers why', async () => {
    setSyncOne(async (id) => {
      if (id === 2) throw new Error('Password or app password rejected');
    });
    const r = await runSync([1, 2, 3], { all: true });
    expect(r.failed).toEqual([2]);
    expect(syncRunner.get().errors[2]).toBe('Password or app password rejected');
  });

  it('does nothing offline', async () => {
    const one = vi.fn(async () => undefined);
    setSyncOne(one);
    expect(await runSync([1], { all: true, offline: true })).toEqual({ started: [], failed: [] });
    expect(one).not.toHaveBeenCalled();
  });
});

describe('All Accounts counts and folders (DMO-ALL-03, 07; AC-DMO-17)', () => {
  const counts = (over: Partial<Record<string, number | null>>): AllCounts => ({
    roles: Object.fromEntries(['inbox', 'drafts', 'outbox', 'archive', 'sent', 'snoozed', 'trash', 'junk'].map((r) => [r, { count: r === 'sent' ? null : (over[r] ?? 0), kind: r === 'inbox' || r === 'archive' ? 'unread' : r === 'sent' ? 'none' : 'total', mailboxes: [] }])) as unknown as AllCounts['roles'],
    unknown: [],
    partial: false,
  });

  it('shows 999+ above 999 with the exact number in the tooltip, nothing for Sent, and hides an empty Outbox', () => {
    const c = counts({ trash: 1250, inbox: 26 });
    expect(allCount('trash', c)).toMatchObject({ n: 1250, shown: '999+', title: '1,250 items' });
    expect(allCount('inbox', c)).toMatchObject({ n: 26, shown: '26', title: '26 unread' });
    expect(allCount('sent', c)).toMatchObject({ n: null, shown: null });
    expect(allCount('outbox', c).hidden).toBe(true);
    // A send waiting on this computer shows the Outbox.
    expect(allCount('outbox', c, { outbox: 1 })).toMatchObject({ hidden: false, n: 1 });
    // Drafts counts this computer's unsent drafts too.
    expect(allCount('drafts', counts({ drafts: 3 }), { drafts: 2 }).n).toBe(5);
  });

  it('names the role of a folder slug: Junk Email is the spam folder', () => {
    expect(slugRole('spam')).toBe('junk');
    expect(slugRole('trash')).toBe('trash');
    expect(slugRole('label:Clients')).toBeNull();
  });

  it('lists drafts kept only on this computer, newest first, and reopens them under the same draft', () => {
    const list = localDrafts([
      { id: 'a', module: 'mail', context: 'compose:new', content: { subject: 'Board pack', to: 'ceo@example.test', html: '<p>Hi</p>' }, updatedAt: '2026-10-04T09:00:00Z' },
      { id: 'b', module: 'mail', context: 'compose:reply:<m1@x>', content: { subject: 'Re: Plan', to: '', html: '' }, updatedAt: '2026-10-04T09:30:00Z' },
      { id: 'c', module: 'mail', context: 'compose:new-empty', content: { subject: '', to: '', html: '<p></p>' }, updatedAt: '2026-10-04T09:40:00Z' },
      { id: 'd', module: 'chat', context: 'compose:new', content: { subject: 'x' }, updatedAt: '2026-10-04T09:50:00Z' },
    ]);
    expect(list.map((d) => d.subject)).toEqual(['Re: Plan', 'Board pack']);
    expect(seedFromContext('compose:reply:<m1@x>')).toEqual({ mode: 'reply', inReplyTo: '<m1@x>' });
    expect(seedFromContext('compose:new')).toEqual({ mode: 'new' });
  });
});

// ---- the screen ----------------------------------------------------------------------------------

const BOXES = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 5, in_unified: true, is_default: true, provider: 'local', provider_label: 'WorkSuite Local', account_type: 'local_mailbox', colour: 'blue', auth_state: 'ok' },
  { id: 2, email: 'me@contoso.test', display_name: 'me', shared: false, unread: 2, in_unified: true, provider: 'office365', provider_label: 'Microsoft 365', colour: 'indigo', auth_state: 'ok' },
  { id: 3, email: 'me@gmail.test', display_name: 'me', shared: false, unread: 1, in_unified: true, provider: 'gmail', provider_label: 'Gmail', colour: 'red', auth_state: 'ok' },
];
const tag = (id: number) => ({ id, email: BOXES[id - 1]!.email, name: 'me', colour: BOXES[id - 1]!.colour });
const DELETED = [
  { id: 501, from_name: 'Pat Lee', from_email: 'pat@example.org', subject: 'Old draft', preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-04 09:30:00', mailbox: tag(1), uid_key: '1:501', folder_slug: 'trash' },
  { id: 502, from_name: 'Billing', from_email: 'billing@example.org', subject: 'Maintenance notice', preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-04 08:00:00', mailbox: tag(2), uid_key: '2:502', folder_slug: 'trash' },
];
const ALL_COUNTS = {
  roles: {
    inbox: { count: 26, kind: 'unread', mailboxes: [] },
    drafts: { count: 3, kind: 'total', mailboxes: [] },
    outbox: { count: 0, kind: 'total', mailboxes: [] },
    archive: { count: 3, kind: 'unread', mailboxes: [{ id: 1, count: 3, folder: 'archive', source: 'flag', ambiguous: false }, { id: 2, count: 0, folder: null, source: null, ambiguous: false }] },
    sent: { count: null, kind: 'none', mailboxes: [] },
    snoozed: { count: 2, kind: 'total', mailboxes: [] },
    trash: { count: 1250, kind: 'total', mailboxes: [] },
    junk: { count: 14, kind: 'total', mailboxes: [] },
  },
  unknown: [],
  partial: false,
};
let accounts: SyncAccount[] = [];

function respond(path: string) {
  if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
  if (path === '/api/mail/views') return { mailboxes: BOXES.map((b) => ({ id: b.id, unread: b.unread, counted: true })), views: { unread: 8, starred: 0, today: 0, attachments: 0, drafts: 0, important: null, scheduled: 0 }, partial: false, unknown: [] };
  if (path === '/api/mail/views/all/counts') return ALL_COUNTS;
  if (path === '/api/mail/folders') return { folders: [{ id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 9, unread: 5 }] };
  if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts, overall: { state: 'up_to_date', syncing: 0, total: 3, last_ok_at: null, failed: [], stale: [], stale_minutes: 60 } };
  if (path === '/api/mail/prefs') return { prefs: [], filters: [] };
  if (path === '/api/mail/outbox') return { messages: [{ id: 9, to: ['client@example.org'], subject: 'Quote', send_at: '2026-10-04 09:00:00', status: 'failed', error: 'Recipient address rejected', sent_at: null }, { id: 10, to: ['later@example.org'], subject: 'Monday note', send_at: '2026-10-06 08:00:00', status: 'queued', error: null, sent_at: null }] };
  throw new ApiError(404, path, null);
}

function Page({ initial }: { initial: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <span data-testid="route">{route}</span>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}

function show(initial = '/mail') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Page initial={initial} />
    </QueryClientProvider>,
  );
}

describe('the folder pane and lists (DMO-ALL-01…11, DMO-SYN-01…04)', () => {
  let pending: unknown[] = [];
  beforeEach(() => {
    pending = [];
    accounts = [acct(1, { email: BOXES[0]!.email, name: 'me' }), acct(2, { email: BOXES[1]!.email, name: 'me' }), acct(3, { email: BOXES[2]!.email, name: 'me', last_result: 'failed', error: 'Google sign-in expired — sign in again', last_ok_at: at(180) })];
    window.localStorage.clear();
    app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => respond(path)) as never);
    vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/views/all/trash') return { data: { messages: DELETED, total: 2, has_more: false, unified: true, role: 'trash' }, offline: false, cachedAt: null };
      if (path.startsWith('/api/mail/views/all/')) return { data: { messages: [], total: 0, has_more: false, unified: true }, offline: false, cachedAt: null };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string) => {
      if (channel === 'offline:pending') return pending;
      if (channel === 'offline:listDrafts') return [{ id: 'd1', module: 'mail', context: 'compose:new', content: { subject: 'Board pack', to: 'ceo@example.test', html: '<p>x</p>' }, updatedAt: '2026-10-04T09:00:00Z' }];
      return null;
    }) as never);
  });

  it('lists the eight All Accounts folders with their counts, 999+ with the exact number in the tooltip (AC-DMO-17)', async () => {
    show();
    const all = await screen.findByRole('list', { name: 'All Accounts' });
    await waitFor(() => expect(within(all).getByRole('button', { name: /^Inbox/ }).textContent).toContain('26'));
    // Outbox is hidden at 0; the others in order.
    expect(within(all).getAllByRole('button').map((b) => b.textContent?.replace(/\d+\+?$/, ''))).toEqual(['Inbox', 'Drafts', 'Archive', 'Sent', 'Snoozed', 'Deleted Items', 'Junk Email']);
    const trash = within(all).getByRole('button', { name: /^Deleted Items/ });
    expect(trash.textContent).toContain('999+');
    expect(trash.getAttribute('title')).toBe('Deleted Items · 1,250 items');
    // Drafts adds the one kept only on this computer.
    expect(within(all).getByRole('button', { name: /^Drafts/ }).textContent).toContain('4');
    expect(within(all).getByRole('button', { name: /^Sent/ }).textContent).toBe('Sent');
  });

  it('opens a combined folder as a query by role, with every row tagged with its account (AC-DMO-18)', async () => {
    show();
    fireEvent.click(within(await screen.findByRole('list', { name: 'All Accounts' })).getByRole('button', { name: /^Deleted Items/ }));
    await waitFor(() => expect(apiGetMeta).toHaveBeenCalledWith('/api/mail/views/all/trash', expect.objectContaining({ page: 1 }), expect.anything()));
    expect(screen.getByTestId('route').textContent).toBe('/mail?folder=trash');
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Old draft');
    expect(within(list).getByText('WS')).toBeTruthy();
    expect(within(list).getByText('CO')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'All Accounts · Deleted Items' })).toBeTruthy();
  });

  it('shows a failed account with Retry, and the Sync all tooltip lists each account’s last sync (DMO-SYN-03/04)', async () => {
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    const retry = await within(nav).findByRole('button', { name: 'Retry' });
    expect(retry.getAttribute('title')).toBe('Sync failed: Google sign-in expired — sign in again — retry');
    fireEvent.mouseEnter(within(nav).getByRole('button', { name: 'Sync all accounts' }).parentElement!);
    const card = await screen.findByRole('tooltip');
    expect(within(card).getAllByText('2 min ago')).toHaveLength(2);
    expect(within(card).getByText(/Failed .* — Google sign-in expired — sign in again/)).toBeTruthy();
    // The footer and the status bar say the same thing.
    expect(within(nav).getByText('Needs attention · me · Gmail failed')).toBeTruthy();
    const bar = screen.getByRole('status', { name: 'Mail status' });
    expect(within(bar).getByText('me · Gmail not synced for 3 h — fix')).toBeTruthy();
  });

  it('opens each account\'s details from the footer card, with Sync all, Sync now and Fix (#172)', async () => {
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    await within(nav).findByRole('button', { name: 'Retry' });
    fireEvent.click(within(nav).getByRole('button', { name: /Needs attention/ }));
    const details = await screen.findByRole('dialog', { name: 'Sync status' });
    expect(within(details).getByRole('button', { name: 'Sync all accounts' })).toBeTruthy();
    expect(within(details).getAllByRole('button', { name: /^Sync .* now$/ }).length).toBeGreaterThan(0);
    fireEvent.click(within(details).getAllByRole('button', { name: /^Fix / })[0]!);
    // Settings is another module: it opens through the app's tabs.
    await waitFor(() => expect(tabs.navigate).toHaveBeenCalledWith('/settings/mail'));
  });

  it('syncs every included account with Sync all and with Ctrl+Shift+R, and one account with its own button', async () => {
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    await within(nav).findByRole('button', { name: 'Retry' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Sync all accounts' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(3));
    for (const id of [1, 2, 3]) expect(apiPost).toHaveBeenCalledWith(`/api/mail/mailboxes/${id}/sync`, { by: 'all' });
    await waitFor(() => expect(syncRunner.get().all).toBe(false));
    vi.mocked(apiPost).mockClear();
    fireEvent.keyDown(document.body, { key: 'R', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(syncRunner.get().all).toBe(false));
    vi.mocked(apiPost).mockClear();
    fireEvent.click(within(nav).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/mailboxes/3/sync', { by: 'manual' }));
  });

  it('disables syncing offline and says why (DMO-SYN-13)', async () => {
    app.set({ status: { network: 'OFFLINE' } as never });
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    const btn = await within(nav).findByRole('button', { name: 'You’re offline — mail will sync when you reconnect' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(within(nav).getByText('Offline')).toBeTruthy();
  });

  it('lists failed and waiting sends in Outbox, not scheduled ones (DMO-ALL-08)', async () => {
    pending = [{ id: 'q1', module: 'mail', entity: 'message.send', entityId: null, label: 'Send “Minutes”', state: 'PENDING', attempts: 0, error: null, createdAt: '2026-10-04T09:55:00Z' }];
    show('/mail?folder=outbox');
    const box = await screen.findByRole('list', { name: 'Outbox' });
    await within(box).findByText('Quote');
    expect(within(box).getByText('Send “Minutes”')).toBeTruthy();
    expect(within(box).getByText('Recipient address rejected')).toBeTruthy();
    expect(within(box).queryByText('Monday note')).toBeNull();
    fireEvent.click(within(box).getAllByRole('button', { name: 'Retry' })[0]!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/outbox/9/retry'));
  });

  it('shows drafts kept on this computer above the server’s, marked as such (DMO-ALL-07)', async () => {
    show('/mail?folder=drafts');
    const local = await screen.findByRole('list', { name: 'Drafts on this computer' });
    expect(within(local).getByText('Board pack')).toBeTruthy();
    expect(within(local).getByText('On this computer')).toBeTruthy();
  });
});
