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
import { toast } from '../../../src/core/toasts';
import MailPage from '../../../src/modules/mail/MailPage';
import { TABS_STORAGE_KEY } from '../../../src/modules/mail/ReadingPane';
import { identityQuery, lookupProblem } from '../../../src/modules/mail/messageLookup';

/**
 * worksuite-desktop#209: opening a listed message never says "Message not
 * found" for a message that exists. It is asked for by its whole identity
 * (account, folder, UID, UIDVALIDITY, Message-ID); a message the server finds
 * elsewhere is followed there and the list updated; one that is gone is taken
 * off the list; each other failure says what it is, with its own way forward;
 * Retry runs the full lookup; and the reading-pane tabs survive a restart.
 */

const NOW = new Date('2026-10-03T10:30:00Z');
const BOXES = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 5, in_unified: true, is_default: true, provider: 'imap', colour: 'blue', auth_state: 'ok' },
  { id: 2, email: 'hasarinda@example.test', display_name: 'Hasarinda', shared: false, unread: 2, in_unified: true, provider: 'imap', colour: 'indigo', auth_state: 'ok' },
];
const tag = (id: number) => ({ id, email: BOXES[id - 1]!.email, name: 'me', colour: BOXES[id - 1]!.colour });
const ROWS = [
  { id: 101, from_name: 'Welcome Team', from_email: 'it@example.test', subject: 'Welcome', preview: 'Ready', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-03 09:58:00', mailbox: tag(1), folder_slug: 'inbox' },
  { id: 102, from_name: 'Dynadot Accounts', from_email: 'info@dynadot.example', subject: 'Account Info Verification', preview: 'Please verify your account details', is_read: false, is_starred: false, has_attachment: true, created_at: '2026-10-03 08:41:00', mailbox: tag(2), folder_slug: 'inbox', message_id: '<verify-1@dynadot.example>', uidvalidity: 5 },
];
const detail = (row: (typeof ROWS)[number], over: Record<string, unknown> = {}) => ({ ...row, to: ['hasarinda@example.test'], cc: [], body_html: '<p>Body of the message</p>', attachments: [], message_id: '<verify-1@dynadot.example>', ...over });

let readMessage: (uid: string, params: Record<string, unknown>) => Promise<unknown> = async () => ({ data: detail(ROWS[1]!), offline: false, cachedAt: null });

function respond(path: string) {
  if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
  if (path === '/api/mail/views') return { mailboxes: [], views: {}, partial: false, unknown: [] };
  if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: [] };
  if (path === '/api/mail/prefs') return { prefs: [], filters: [] };
  if (path === '/api/mail/labels') return { labels: [] };
  throw new ApiError(404, `no ${path}`, null);
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

/** Generous: other suites share this machine. */
const SLOW = { timeout: 8000 };
const route = () => screen.getByTestId('route').textContent ?? '';
const reads = () => vi.mocked(apiGetMeta).mock.calls.filter(([p]) => /^\/api\/mail\/messages\/\d+$/.test(String(p)));
async function open(subject = 'Account Info Verification') {
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(subject) }, SLOW));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  window.localStorage.clear();
  readMessage = async () => ({ data: detail(ROWS[1]!), offline: false, cachedAt: null });
  app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
  vi.mocked(toast).mockReset();
  nav.navigate.mockReset();
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => respond(path)) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string, params?: Record<string, unknown>) => {
    if (path === '/api/mail/views/all/inbox' || path === '/api/mail/messages') return { data: { messages: ROWS, total: 2, has_more: false, unified: true }, offline: false, cachedAt: null };
    const m = /^\/api\/mail\/messages\/(\d+)$/.exec(path);
    if (m) return readMessage(m[1]!, params ?? {});
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string) => (channel === 'offline:pending' ? [] : null)) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('opening a listed message (#209)', { timeout: 30_000 }, () => {
  it('asks the message’s own account and folder, with its Message-ID and UIDVALIDITY, from All Accounts', async () => {
    let answer: (v: unknown) => void = () => undefined;
    readMessage = () => new Promise((r) => (answer = r));
    show();
    await open();
    await waitFor(() => expect(reads().length).toBeGreaterThan(0), SLOW);
    expect(reads()[0]![0]).toBe('/api/mail/messages/102');
    expect(reads()[0]![1]).toMatchObject({ folder: 'inbox', mailbox: '2', message_id: '<verify-1@dynadot.example>', uidvalidity: 5 });
    // Downloading: the saved header at once, the body a placeholder.
    const pane = screen.getByRole('region', { name: 'Reading pane' });
    expect(within(pane).getByRole('status', { name: 'Downloading…' })).toBeTruthy();
    const header = pane.querySelector('[data-saved-header]') as HTMLElement;
    expect(within(header).getByText('Account Info Verification')).toBeTruthy();
    expect(within(header).getByText('Please verify your account details')).toBeTruthy();
    expect(within(header).getByText('Has attachments')).toBeTruthy();
    await act(async () => answer({ data: detail(ROWS[1]!), offline: false, cachedAt: null }));
    await waitFor(() => expect(within(pane).queryByRole('status', { name: 'Downloading…' })).toBeNull(), SLOW);
  });

  it('reads a message listed in a view of INBOX (Important) from INBOX, not from the view’s name', async () => {
    show('/mail?box=2&view=important');
    await open();
    await waitFor(() => expect(reads().length).toBeGreaterThan(0), SLOW);
    expect(reads()[0]![1]).toMatchObject({ folder: 'inbox', mailbox: '2' });
  });

  it('follows a message moved to Archive on another device, and takes the old row off the list', async () => {
    readMessage = async (uid) => (uid === '102' ? { data: detail(ROWS[1]!, { id: 77, moved: { folder: 'archive', uid: 77, name: 'Archive' } }), offline: false, cachedAt: null } : { data: detail(ROWS[1]!, { id: 77 }), offline: false, cachedAt: null });
    show();
    await open();
    await waitFor(() => expect(route()).toContain('msg=77'), SLOW);
    expect(route()).toContain('mf=archive');
    expect(toast).toHaveBeenCalledWith('info', 'This email was moved to Archive.');
    const list = screen.getByRole('listbox', { name: 'Messages' });
    await waitFor(() => expect(within(list).queryByText('Account Info Verification')).toBeNull(), SLOW);
    // One tab, now naming the message where it is.
    expect(within(screen.getByRole('tablist', { name: 'Open messages' })).getAllByRole('tab')).toHaveLength(1);
  });

  it('keeps an open tab working when the folder was renumbered (UIDVALIDITY changed)', async () => {
    readMessage = async (uid) => ({ data: detail(ROWS[1]!, uid === '102' ? { id: 4001, moved: { folder: 'inbox', uid: 4001, name: 'Inbox' } } : { id: 4001 }), offline: false, cachedAt: null });
    show();
    await open();
    await waitFor(() => expect(route()).toContain('msg=4001'), SLOW);
    expect(toast).not.toHaveBeenCalledWith('info', expect.stringContaining('moved'));
    const tabs = within(screen.getByRole('tablist', { name: 'Open messages' })).getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.textContent).toContain('Account Info Verification');
  });

  it('takes a deleted message off the list and offers Refresh folder', async () => {
    readMessage = async () => {
      throw new ApiError(404, 'This email was deleted or moved on another device', null, { code: 'message_gone' });
    };
    show();
    await open();
    expect(await screen.findByText('This email was deleted or moved on another device', {}, SLOW)).toBeTruthy();
    const list = screen.getByRole('listbox', { name: 'Messages' });
    await waitFor(() => expect(within(list).queryByText('Account Info Verification')).toBeNull(), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh folder' }));
    await waitFor(() => expect(route()).not.toContain('msg='), SLOW);
  });

  it('says the account’s sign-in failed, with the saved header and Fix account', async () => {
    readMessage = async () => {
      throw new ApiError(502, "Couldn't sign in to hasarinda@example.test", null, { code: 'mail_signin' });
    };
    show();
    await open();
    expect(await screen.findByText("Couldn't sign in to the account", {}, SLOW)).toBeTruthy();
    expect(document.querySelector('[data-saved-header]')!.textContent).toContain('Account Info Verification');
    fireEvent.click(screen.getByRole('button', { name: 'Fix account' }));
    expect(nav.navigate).toHaveBeenCalledWith('/settings/mail?tab=accounts');
  });

  it('shows the saved header only when offline', async () => {
    readMessage = async () => {
      throw new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'INTERNAL');
    };
    app.set({ status: { network: 'OFFLINE' } as never });
    show();
    await open();
    expect(await screen.findByText('Offline: showing the saved header only', {}, SLOW)).toBeTruthy();
    expect(document.querySelector('[data-saved-header]')).not.toBeNull();
  });

  it('shows a server error’s technical details with Copy, and Retry runs the full lookup', async () => {
    let n = 0;
    readMessage = async () => {
      n++;
      if (n === 1) throw new ApiError(500, 'IMAP: BAD command', null, null);
      return { data: detail(ROWS[1]!), offline: false, cachedAt: null };
    };
    show();
    await open();
    expect(await screen.findByText('The mail server could not open this email', {}, SLOW)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    const details = document.querySelector('[data-technical-details]')!.textContent!;
    expect(details).toContain('uid: 102');
    expect(details).toContain('uidvalidity: 5');
    expect(details).toContain('message-id: <verify-1@dynadot.example>');
    expect(details).toContain('server: IMAP: BAD command');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(reads()[0]![1]).not.toHaveProperty('locate');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(reads().length).toBe(2), SLOW);
    expect(reads()[1]![1]).toMatchObject({ locate: 1, message_id: '<verify-1@dynadot.example>', uidvalidity: 5 });
  });

  it('keeps the open tabs, with each message’s identity, across a restart', async () => {
    const first = show();
    await open();
    await waitFor(() => expect(within(screen.getByRole('tablist', { name: 'Open messages' })).getAllByRole('tab')).toHaveLength(1), SLOW);
    const saved = JSON.parse(window.localStorage.getItem(TABS_STORAGE_KEY) ?? '[]') as Array<{ ref: Record<string, unknown> }>;
    expect(saved).toHaveLength(1);
    expect(saved[0]!.ref).toMatchObject({ uid: '102', folder: 'inbox', mailbox: '2', mid: '<verify-1@dynadot.example>', uidvalidity: 5 });
    first.unmount();
    show();
    const tabs = await screen.findByRole('tablist', { name: 'Open messages' });
    expect(within(tabs).getByRole('tab').textContent).toContain('Account Info Verification');
    fireEvent.click(within(tabs).getByRole('tab'));
    await waitFor(() => expect(route()).toContain('msg=102'), SLOW);
    expect(route()).toContain('mid=');
  });
});

describe('the lookup’s pieces (#209)', () => {
  it('sends the identity it has, and the full lookup on Retry', () => {
    expect(identityQuery({ uid: '9', folder: 'inbox', mailbox: '2', mid: '<a@b>', uidvalidity: 5 })).toEqual({ message_id: '<a@b>', uidvalidity: 5 });
    expect(identityQuery({ uid: '9', folder: 'inbox', mailbox: '2', midHash: 'abc' }, true)).toEqual({ mid_hash: 'abc', locate: 1 });
    expect(identityQuery({ uid: '9', folder: 'inbox', mailbox: '2' })).toEqual({});
  });

  it('tells the failures apart', () => {
    expect(lookupProblem(new ApiError(404, 'x', null, { code: 'message_gone' }), false)).toBe('gone');
    expect(lookupProblem(new ApiError(404, 'Message not found', null), false)).toBe('gone');
    expect(lookupProblem(new ApiError(502, 'x', null, { code: 'mail_signin' }), false)).toBe('signin');
    // Every connection busy for ten seconds, and a row without a server ID (#228).
    expect(lookupProblem(new ApiError(503, 'x', null, { code: 'mail_busy' }), false)).toBe('busy');
    expect(lookupProblem(new ApiError(409, 'x', null, { code: 'needs_resync' }), false)).toBe('resync');
    expect(lookupProblem(new ApiError(0, 'x', 'INTERNAL'), true)).toBe('offline');
    expect(lookupProblem(new ApiError(503, 'x', 'NETWORK_UNREACHABLE'), false)).toBe('offline');
    expect(lookupProblem(new ApiError(503, 'busy', null, { code: 'mail_busy' }), false)).toBe('busy');
    expect(lookupProblem(new ApiError(500, 'x', null), false)).toBe('server');
  });
});
