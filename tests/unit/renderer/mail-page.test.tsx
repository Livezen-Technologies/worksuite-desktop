// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { ApiError, apiGet, apiGetMeta, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import MailPage from '../../../src/modules/mail/MailPage';
import { AddMailbox } from '../../../src/modules/mail/AddMailbox';
import { MailSettings } from '../../../src/modules/mail/MailSettings';

/**
 * Mail rebuilt to the WorkSuite Mail design: the sidebar's sections and counts,
 * the list's bands, chips and instant search, the reading pane's tabs and
 * actions (through the offline queue), offline with Undo, adding a mailbox,
 * and the mail body still sanitized.
 */

const NOW = new Date('2026-10-02T10:30:00Z');
const BOXES = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 5, in_unified: true, is_default: true, provider: 'local', provider_label: 'WorkSuite Local', account_type: 'local_mailbox', colour: 'blue', auth_state: 'ok' },
  { id: 2, email: 'me@contoso.test', display_name: 'me', shared: false, unread: 2, in_unified: true, provider: 'office365', provider_label: 'Microsoft 365', colour: 'indigo', auth_state: 'ok' },
  { id: 3, email: 'sales@example.test', display_name: 'Sales', shared: true, unread: null, in_unified: true, colour: 'teal', auth_state: 'ok' },
];
const tag = (id: number) => ({ id, email: BOXES[id - 1]!.email, name: BOXES[id - 1]!.display_name, colour: BOXES[id - 1]!.colour });
const ROWS = [
  { id: 101, from_name: 'Welcome Team', from_email: 'it@example.test', subject: 'Welcome to your mailbox', preview: 'Your new mailbox is ready', is_read: false, is_starred: false, has_attachment: false, created_at: '2026-10-02 09:58:00', mailbox: tag(1), uid_key: '1:101', folder_slug: 'inbox' },
  { id: 102, from_name: 'Pat Lee', from_email: 'pat@example.org', subject: 'Revised quotation', preview: 'Could you confirm', is_read: true, is_starred: true, has_attachment: true, created_at: '2026-10-02 08:41:00', mailbox: tag(2), uid_key: '2:102', folder_slug: 'inbox' },
  { id: 103, from_name: 'Billing', from_email: 'billing@example.org', subject: 'Invoice paid', preview: 'Payment received', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-01 08:00:00', mailbox: tag(3), uid_key: '3:103', folder_slug: 'inbox' },
];
const DETAIL = {
  ...ROWS[0],
  message_id: '<w@x>',
  to: ['me@example.test'],
  cc: [],
  body_html: '<p onclick="steal()">Hi there</p><script>alert(1)</script><img src="https://tracker.example/pixel.gif">',
  attachments: [],
};
let offline = false;
let pending: unknown[] = [];
const account = (id: number, over: Record<string, unknown> = {}) => ({ mailbox: id, email: BOXES[id - 1]!.email, name: BOXES[id - 1]!.display_name, included: true, paused: false, mode: 'push', interval_min: 5, last_ok_at: '2026-10-02 10:28:00', last_attempt_at: '2026-10-02 10:28:00', last_result: 'ok', error_code: null, error: null, running: false, mirror: true, pushed: true, folders: 9, folders_done: 9, ...over });
let syncAccounts: unknown[] = [];

function respond(path: string, params?: Record<string, unknown>) {
  if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
  if (path === '/api/mail/views') return { mailboxes: [{ id: 1, unread: 5, counted: true }, { id: 2, unread: 14, counted: true }, { id: 3, unread: 7, counted: true }], views: { unread: 21, starred: 6, today: 3, attachments: 1, drafts: 2, important: null, scheduled: 2 }, partial: false, unknown: [] };
  if (path === '/api/mail/folders') return { folders: [{ id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 9, unread: 5 }, { id: 2, name: 'Sent', slug: 'sent', type: 'system', total: 3, unread: 0 }, { id: 3, name: 'Clients/Acme', slug: 'label:Clients/Acme', type: 'custom', total: 3, unread: 3 }] };
  if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: BOXES.map((b) => ({ mailbox: b.id, status: 'live', serving: true, lag_seconds: 12, pushed: true, problem: null })), accounts: syncAccounts, overall: { state: 'up_to_date', syncing: 0, total: 3, last_ok_at: '2026-10-02 10:28:00', failed: [], stale: [], stale_minutes: 60 } };
  if (path === '/api/mail/prefs') return { prefs: [], filters: [] };
  if (path === '/api/mail/labels') return { labels: [] };
  if (path === '/api/mail/messages/101/context') return { sender: { email: 'it@example.test', name: null, contact_id: null, user_id: null, is_colleague: false, company: null }, security: { available: true, spf: 'pass', dkim: 'pass', dmarc: 'pass' } };
  if (path === '/api/mail/local-mailboxes') return { mailboxes: [{ id: 7, email: 'me@example.test', display_name: 'Me', type: 'user', account_type: 'local_mailbox', state: 'connected', connection_id: 1, quota_mb: 10240 }, { id: 8, email: 'sales@example.test', display_name: 'Sales', type: 'shared', account_type: 'shared_mailbox', state: 'available', connection_id: null, quota_mb: 0 }] };
  if (path === '/api/mail/oauth/providers') return { providers: ['microsoft'] };
  if (path === '/api/mail/templates') return { templates: [] };
  if (path === '/api/mail/signatures') return { signatures: [] };
  throw new ApiError(404, `no ${path} ${JSON.stringify(params ?? {})}`, null);
}

function Page({ initial = '/mail' }: { initial?: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <span data-testid="route">{route}</span>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}

function show(initial?: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Page initial={initial} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  offline = false;
  pending = [];
  syncAccounts = [account(1), account(2), account(3)];
  window.localStorage.clear();
  app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string, params?: Record<string, unknown>) => respond(path, params)) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string, params?: Record<string, unknown>) => {
    if (path === '/api/mail/messages') {
      const f = String(params?.filters ?? '').split(',').filter(Boolean);
      const rows = ROWS.filter((r) => !f.includes('unread') || !r.is_read);
      return { data: { messages: rows, total: rows.length, has_more: false, unified: true }, offline, cachedAt: offline ? '2026-10-02 09:00:00' : null };
    }
    if (path === '/api/mail/messages/101') return { data: DETAIL, offline, cachedAt: null };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string, input?: { module?: string }) => {
    if (channel === 'offline:pending') return pending;
    if (channel === 'offline:submit') return { delivered: !offline, queued: offline, id: offline ? 'q9' : null, status: 200, data: null, error: null, code: null };
    if (channel === 'offline:moduleBytes') return input?.module === 'mail' ? 432_013_312 : 0;
    return null;
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the sidebar', () => {
  it('lists the mailboxes, smart views with their counts, the folders and the sync card', async () => {
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    // All Accounts › Inbox (the old Unified inbox): each account's count as the mirror counted it.
    const all = await within(nav).findByRole('list', { name: 'All Accounts' });
    await waitFor(() => expect(within(all).getByRole('button', { name: /^Inbox/ }).textContent).toContain('26'));
    expect(within(nav).getByRole('button', { name: /^sales@example.test · shared/ }).textContent).toContain('7');
    const views = within(nav).getByRole('button', { name: /^Unread/ });
    expect(views.textContent).toContain('21');
    expect(within(nav).getByRole('button', { name: /^Starred/ }).textContent).toContain('6');
    expect(within(nav).getByRole('button', { name: /^Scheduled/ }).textContent).toContain('2');
    // Importance is not something the mirror knows: no Important view rather than a wrong one.
    expect(within(nav).queryByRole('button', { name: /^Important/ })).toBeNull();
    expect(await within(nav).findByRole('button', { name: /Clients › Acme/ })).toBeTruthy();
    // One sync status in the footer and the status bar (DMO-SYN-05/07): no "mailboxes live" next to "synced".
    expect(within(nav).getByText('Synced 2 min ago')).toBeTruthy();
    expect(within(nav).getByText(/3 of 3 accounts · offline cache 30 days/)).toBeTruthy();
    const bar = screen.getByRole('status', { name: 'Mail status' });
    expect(within(bar).getByText('Synced 2 min ago · 3 of 3 accounts')).toBeTruthy();
    expect(within(bar).queryByText(/mailboxes live/)).toBeNull();
    expect(await screen.findByText('Local store 412 MB')).toBeTruthy();
  });

  it('leads with an accent New email button whose N chip is the wired shortcut, and a glass search button (#148)', async () => {
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    const compose = within(nav).getByRole('button', { name: 'New email' });
    // The chip is decoration; the shortcut is named for assistive tech, and N really composes.
    expect(compose.getAttribute('aria-keyshortcuts')).toBe('N');
    const chip = compose.querySelector('kbd')!;
    expect(chip.textContent).toBe('N');
    expect(chip.getAttribute('aria-hidden')).toBe('true');
    expect(compose.className).toContain('text-white');
    expect(compose.className).toContain('focus-visible:outline-2');
    expect(compose.className).toContain('motion-safe:enabled:hover:-translate-y-px');
    expect(compose.className).not.toMatch(/(^|\s)(enabled:)?hover:-translate-y-px/);
    const search = within(nav).getByRole('button', { name: 'Search mail' });
    expect(search.getAttribute('title')).toBe('Search mail (/)');
    expect(search.className).toContain('bg-glass');
    expect(search.className).toContain('h-11 w-11');
    expect(search.querySelector('kbd')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(await screen.findByRole('form', { name: 'New email' })).toBeTruthy();
  });

  it('opens a smart view as the combined list narrowed', async () => {
    show();
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Mail' })).getByRole('button', { name: /^Unread/ }));
    await waitFor(() => expect(vi.mocked(apiGetMeta)).toHaveBeenCalledWith('/api/mail/messages', expect.objectContaining({ unified: 1, folder: 'inbox', filters: 'unread' }), expect.anything()));
    expect(screen.getByTestId('route').textContent).toBe('/mail?view=unread');
  });
});

describe('the list', () => {
  it('bands by date with counts, tags each account, and filters with the chips and instant search', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Welcome Team');
    expect(within(list).getByText('Today').parentElement!.textContent).toContain('2');
    expect(within(list).getByText('Yesterday')).toBeTruthy();
    expect(within(list).getByText('WS')).toBeTruthy();
    expect(within(list).getByText('SALES')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search mail' }), { target: { value: 'quotation' } });
    expect(within(list).queryByText('Welcome Team')).toBeNull();
    expect(within(list).getByText('Pat Lee')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search mail' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unread', pressed: false }));
    await waitFor(() => expect(within(list).queryByText('Pat Lee')).toBeNull());
    expect(vi.mocked(apiGetMeta)).toHaveBeenCalledWith('/api/mail/messages', expect.objectContaining({ filters: 'unread' }), expect.anything());
  });

  it('keeps the layout chosen in the density menu on the server, for this folder (DMO-INB-16)', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Layout and density' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Super compact/ }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { folderViews: { 'unified:inbox': { view: 'super' } } }));
    // …or for every folder.
    fireEvent.click(await screen.findByRole('button', { name: 'Layout and density' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Apply this view to all folders/ }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { view: 'super', folderViews: {} }));
  });
});

describe('the reading pane', () => {
  it('opens the message in a tab with its checks, and its body sanitized', async () => {
    show();
    fireEvent.click(await screen.findByText('Welcome Team'));
    const pane = await screen.findByRole('region', { name: 'Reading pane' });
    expect(await within(pane).findByRole('heading', { name: 'Welcome to your mailbox' })).toBeTruthy();
    expect(within(pane).getByRole('tab', { name: /Welcome to your mailbox/ })).toBeTruthy();
    expect(await within(pane).findByText('Verified · SPF, DKIM, DMARC')).toBeTruthy();
    expect(within(pane).getByText('WorkSuite Local')).toBeTruthy();
    expect(within(pane).getByText('1 remote image was blocked to protect your privacy.')).toBeTruthy();
    const doc = pane.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(doc).toContain('Hi there');
    expect(doc).not.toContain('<script');
    expect(doc).not.toContain('onclick');
    expect(doc).not.toContain('tracker.example');
    expect(pane.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox');
  });

  it('archives through the offline queue, from the toolbar and with E', async () => {
    show('/mail?msg=101&mbx=1');
    const pane = await screen.findByRole('region', { name: 'Reading pane' });
    await within(pane).findByRole('heading', { name: 'Welcome to your mailbox' });
    fireEvent.click(within(pane).getByRole('button', { name: 'Archive (E)' }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ module: 'mail', entity: 'message.archive', entityId: '1:inbox:101', method: 'POST', path: '/api/mail/messages/101/action', body: { action: 'archive', folder: 'inbox', mailbox: '1' }, queueIfOffline: true })),
    );
    // A fresh page: the first one is gone, so the key reaches the message that is open.
    cleanup();
    vi.mocked(call).mockClear();
    show('/mail?msg=101&mbx=1');
    await screen.findAllByRole('heading', { name: 'Welcome to your mailbox' });
    fireEvent.keyDown(document.body, { key: 'e' });
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ entity: 'message.archive' })));
  });

  it('moves through the list with j and k, and closes the message with Esc', async () => {
    show();
    await screen.findByText('Welcome Team');
    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/mail?msg=101&mbx=1'));
    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/mail?msg=102&mbx=2'));
    fireEvent.keyDown(document.body, { key: 'k' });
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/mail?msg=101&mbx=1'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/mail'));
  });
});

describe('offline', () => {
  it('says what is shown, marks rows with a queued action, and lets a waiting change be undone', async () => {
    offline = true;
    app.set({ status: { network: 'OFFLINE' } as never });
    pending = [
      { id: 'q1', idempotencyKey: 'k', module: 'mail', entity: 'message.archive', entityId: '2:inbox:102', label: 'Archive “Revised quotation”', method: 'POST', path: '/api/mail/messages/102/action', state: 'PENDING', attempts: 0, error: null, createdAt: '2026-10-02T10:20:00Z' },
      { id: 'q2', idempotencyKey: 'k2', module: 'mail', entity: 'message.send', entityId: null, label: 'Send “Re: Payroll” to Ann', method: 'POST', path: '/api/mail/send', state: 'PENDING', attempts: 0, error: null, createdAt: '2026-10-02T10:21:00Z' },
    ];
    show();
    expect(await screen.findByText(/You're offline. Showing the last 30 days saved on this computer/)).toBeTruthy();
    expect(await screen.findByText('Archive queued')).toBeTruthy();
    const panel = await screen.findByRole('region', { name: 'Waiting to send' });
    expect(within(panel).getByText('Waiting to send · 2')).toBeTruthy();
    expect(screen.getByText('Offline · 2 actions waiting')).toBeTruthy();
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Undo' })[1]!);
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:discard', { id: 'q2' }));
  });

  it('queues an action taken offline and says so', async () => {
    offline = true;
    show('/mail?msg=101&mbx=1');
    const pane = await screen.findByRole('region', { name: 'Reading pane' });
    await within(pane).findByRole('heading', { name: 'Welcome to your mailbox' });
    expect(within(pane).getByText('Saved on this computer')).toBeTruthy();
    fireEvent.click(within(pane).getByRole('button', { name: 'Delete (#)' }));
    const { toast } = await import('../../../src/core/toasts');
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', expect.stringContaining('Offline')));
  });
});

describe('add a mailbox', () => {
  it('lists the WorkSuite Local mailboxes the admin made, and adds one — asking its password once when the server needs it', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(422, 'Enter this mailbox’s mail password once', null, { code: 'needs_password' }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AddMailbox onClose={() => undefined} />
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /WorkSuite Local Mail/ }).getAttribute('aria-checked')).toBe('true');
    expect(await within(dialog).findByText('Added')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add sales@example.test' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/local-mailboxes/8/connect', {}));
    fireEvent.change(await within(dialog).findByLabelText(/This mailbox's mail password/), { target: { value: 'pw' } });
    fireEvent.submit(within(dialog).getByLabelText(/This mailbox's mail password/).closest('form')!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/local-mailboxes/8/connect', { password: 'pw' }));
    // Microsoft 365: sign in in the browser.
    fireEvent.click(within(dialog).getByRole('radio', { name: /Microsoft 365/ }));
    vi.mocked(apiPost).mockResolvedValueOnce({ url: 'https://login.microsoftonline.com/x' } as never);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Sign in with Microsoft' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://login.microsoftonline.com/x' }));
  });
});

describe('compose', () => {
  it('sends after the undo window, through the offline queue', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    show('/mail?compose=1&to=ann@example.org');
    const form = await screen.findByRole('form', { name: 'New email' });
    fireEvent.change(within(form).getByLabelText('Subject'), { target: { value: 'Hello' } });
    const message = within(form).getByRole('textbox', { name: 'Message' });
    message.innerHTML = '<div>Hi <b>Ann</b></div><img src=x onerror="alert(1)">';
    fireEvent.input(message);
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Sending “Hello” in \d s/)).toBeTruthy();
    expect(call).not.toHaveBeenCalledWith('offline:submit', expect.anything());
    await act(async () => {
      vi.advanceTimersByTime(8_500);
    });
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ entity: 'message.send', path: '/api/mail/send', body: expect.objectContaining({ to: ['ann@example.org'], subject: 'Hello', body_html: '<div>Hi <b>Ann</b></div>', body_text: 'Hi Ann', mailbox: '1' }) })));
  });

  it('schedules with Send later on the server', async () => {
    show('/mail?compose=1&to=ann@example.org');
    const form = await screen.findByRole('form', { name: 'New email' });
    fireEvent.change(within(form).getByLabelText('Subject'), { target: { value: 'Later' } });
    fireEvent.click(screen.getByRole('radio', { name: /Tomorrow morning/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send later…' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ subject: 'Later', schedule_at: '2026-10-03T08:00:00.000Z' })));
  });
});

describe('settings › mail', () => {
  it('lists the accounts with their state, repairs a refused sign-in, and keeps the layout', async () => {
    const problem = { ...BOXES[1]!, auth_state: 'problem', auth_type: 'password', last_error: 'Login failed' };
    vi.mocked(apiGet).mockImplementation((async (path: string, params?: Record<string, unknown>) => (path === '/api/mail/mailboxes' ? { mailboxes: [BOXES[0], problem] } : respond(path, params))) as never);
    syncAccounts = [account(1), account(2, { last_result: 'failed', error_code: 'auth', error: 'Password or app password rejected', last_ok_at: '2026-10-02 07:30:00', last_attempt_at: '2026-10-02 10:20:00' })];
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MailSettings />
      </QueryClientProvider>,
    );
    // Accounts & sync (D04 v1.1): last successful sync, last attempt and result, in plain words (DMO-SYN-09).
    const card = await screen.findByRole('listitem', { name: 'me@contoso.test' });
    expect(within(card).getByText('Sync failed')).toBeTruthy();
    expect(within(card).getByText(/Failed — Password or app password rejected/)).toBeTruthy();
    expect(within(card).getByText(/2 Oct 2026 7:30 \(3 h ago\)/)).toBeTruthy();
    expect(within(await screen.findByRole('listitem', { name: 'me@example.test' })).getByText('Up to date')).toBeTruthy();
    // The same one status as the folder pane and the status bar.
    expect(screen.getByText('Needs attention · me · Microsoft 365 failed')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Sign in again' }));
    const dialog = await screen.findByRole('dialog', { name: 'Repair me@contoso.test' });
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'new' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test and save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/mailboxes/2', { password: 'new' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance & reading' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Bottom' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { pane: 'bottom' }));
  });

  it("names every switch in a mailbox's Manage dialog on screen, not only to screen readers", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MailSettings />
      </QueryClientProvider>,
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    for (const name of ['Include in All Accounts', 'Notify me about new mail']) {
      expect(within(dialog).getByRole('switch', { name })).toBeTruthy();
      expect(within(dialog).getByText(name)).toBeTruthy();
    }
    expect(within(dialog).getByText('Show its Inbox, Drafts, Sent and other folders in All Accounts, and sync it with Sync all.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Include in All Accounts' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/mail\/mailboxes\/\d+$/), { in_unified: false }));
  });
});
