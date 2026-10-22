// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Sanitize from '../../../src/modules/mail/sanitize';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/mail/OAuthSignIn', () => ({ openSignInUrl: vi.fn(async () => null), watchAttempt: vi.fn(() => () => undefined) }));
// A body the reader cannot draw (#338): cleaning it throws, as a bad answer did in the reader.
vi.mock('../../../src/modules/mail/sanitize', async (orig) => {
  const real = await orig<typeof Sanitize>();
  return {
    ...real,
    sanitizeMailHtml: (html: string, ...rest: unknown[]) => {
      if (html.includes('BOOM')) throw new TypeError("Cannot read properties of null (reading 'verdict')");
      return (real.sanitizeMailHtml as (h: string, ...r: unknown[]) => ReturnType<typeof real.sanitizeMailHtml>)(html, ...rest);
    },
  };
});

import { ApiError, apiDelete, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { screenErrors } from '../../../src/core/screen-errors';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { ModuleBoundary } from '../../../src/components/ui';
import { moduleRecovery } from '../../../src/components/moduleRecovery';
import MailPage from '../../../src/modules/mail/MailPage';
import { ScreenErrors } from '../../../src/modules/diagnostics/ScreenErrors';
import { RepairLocalMailButton } from '../../../src/modules/mail/RepairLocalMail';
import { toast } from '../../../src/core/toasts';
import { accountIssue, accountTitle, safeListData, safeMailboxes, safeMessage, safeRows } from '../../../src/modules/mail/safety';
import { oauthProviderOf, reconnectKind } from '../../../src/modules/mail/AccountAttention';
import { mailboxLetter } from '../../../src/modules/mail/model';
import { defaultTagLabel } from '../../../src/modules/mail/accountTags';
import { trayAccounts } from '../../../shared/mail-alerts';
import type { DesktopModule } from '../../../src/modules/registry';

/**
 * worksuite-desktop#338: one broken account, one bad message or one bad answer never takes all of Mail down.
 */

const NOW = new Date('2026-10-02T10:30:00Z');
const GOOD = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 5, in_unified: true, is_default: true, provider: 'local', provider_label: 'WorkSuite Local', account_type: 'local_mailbox', colour: 'blue', auth_state: 'ok' },
  { id: 2, email: 'me@contoso.test', display_name: 'me', shared: false, unread: 2, in_unified: true, provider: 'gmail', provider_label: 'Gmail', colour: 'indigo', auth_state: 'ok', auth_type: 'oauth', oauth_provider: 'google', imap_host: 'imap.gmail.com', smtp_host: 'smtp.gmail.com' },
];
/** A Microsoft 365 account whose sign-in never stored a token: the server refuses every refresh. */
const BROKEN_365 = { id: 9, email: 'name@company.com', display_name: null, shared: false, unread: null, in_unified: true, provider: 'microsoft365', provider_label: 'Microsoft 365', colour: 'sky', auth_state: 'problem', auth_type: 'oauth', oauth_provider: null, last_error: 'No refresh token stored for this mailbox', imap_host: 'outlook.office365.com', smtp_host: 'smtp.office365.com' };
/** Saved half-finished before #154: no address at all. */
const NO_EMAIL = { id: 10, email: null, display_name: null, shared: false, unread: null, provider: 'custom_imap', provider_label: 'Custom IMAP', auth_type: 'password', imap_host: null, smtp_host: null, pop3_host: null };
let boxes: unknown[] = [];

const tag = (id: number, email: string) => ({ id, email, name: 'me', colour: 'blue' });
const ROWS = [
  { id: 101, from_name: 'Welcome Team', from_email: 'it@example.test', subject: 'Welcome to your mailbox', preview: 'Your new mailbox is ready', is_read: false, is_starred: false, has_attachment: false, created_at: '2026-10-02 09:58:00', mailbox: tag(1, 'me@example.test'), folder_slug: 'inbox' },
  { id: 102, from_name: 'Pat Lee', from_email: 'pat@example.org', subject: 'Revised quotation', preview: 'Could you confirm', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-02 08:41:00', mailbox: tag(2, 'me@contoso.test'), folder_slug: 'inbox' },
];
const detail = (row: (typeof ROWS)[number], body: string) => ({ ...row, message_id: `<${row.id}@x>`, to: ['me@example.test'], cc: [], body_html: body, attachments: [] });
let badBody = true;
let network = true;

function respond(path: string) {
  if (path === '/api/mail/mailboxes') return { mailboxes: boxes };
  if (path === '/api/mail/prefs') return { prefs: [], filters: [] };
  if (path === '/api/mail/labels') return { labels: [] };
  if (path === '/api/mail/templates') return { templates: [] };
  throw new ApiError(404, path, null);
}

function Page({ initial = '/mail' }: { initial?: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
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
  boxes = [...GOOD, BROKEN_365, NO_EMAIL, null, { email: 'no-id@example.test' }];
  badBody = true;
  network = true;
  screenErrors.set({ errors: [], accounts: {} });
  window.localStorage.clear();
  app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (!network) throw new ApiError(0, 'WorkSuite cannot be reached', 'NETWORK_UNREACHABLE');
    return respond(path);
  }) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
    if (!network) throw new ApiError(0, 'WorkSuite cannot be reached', 'NETWORK_UNREACHABLE');
    if (path === '/api/mail/messages') return { data: { messages: ROWS, total: ROWS.length, has_more: false, unified: true }, offline: false, cachedAt: null };
    if (path === '/api/mail/messages/101') return { data: detail(ROWS[0]!, '<p>Hello there</p>'), offline: false, cachedAt: null };
    if (path === '/api/mail/messages/102') return { data: detail(ROWS[1]!, badBody ? '<p>BOOM</p>' : '<p>The quotation, fixed</p>'), offline: false, cachedAt: null };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({ url: 'https://login.microsoftonline.com/x', attempt: null } as never);
  vi.mocked(apiDelete).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockImplementation((async () => null) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.spyOn(console, 'error').mockRestore();
});

describe('one account’s bad data (#338)', () => {
  it('is read an account at a time: a broken one is kept and marked, a record that is no account is left out', () => {
    const { mailboxes } = safeMailboxes({ mailboxes: boxes });
    expect(mailboxes.map((b) => b.id)).toEqual([1, 2, 9, 10]);
    expect(mailboxes.map((b) => b.health)).toEqual([
      { status: 'ok', code: null, needs_reconnect: false },
      { status: 'ok', code: null, needs_reconnect: false },
      { status: 'error', code: 'missing_token', needs_reconnect: true },
      { status: 'error', code: 'missing_email', needs_reconnect: true },
    ]);
    // A missing address is an empty one: nothing reading it throws.
    expect(mailboxes[3]!.email).toBe('');
    expect(mailboxLetter(mailboxes[3]!)).toBe('?');
    expect(defaultTagLabel({ email: null as never, display_name: null })).toBe('');
    expect(safeMailboxes(null)).toEqual({ mailboxes: [] });
    expect(safeMailboxes({ mailboxes: 'nope' })).toEqual({ mailboxes: [] });
    // The tray reads the same list in the main process.
    expect(trayAccounts({ mailboxes: [null, ...GOOD] }).map((a) => a.id)).toEqual([1, 2]);
  });

  it('knows each kind of broken account, and how Reconnect goes for it', () => {
    expect(accountIssue({ email: 'a@b.test', auth_state: 'problem', last_error: 'invalid_grant' })).toBe('auth_failed');
    expect(accountIssue({ email: 'a@b.test', auth_type: 'oauth', oauth_provider: null })).toBe('missing_token');
    expect(accountIssue({ email: 'a@b.test', imap_host: '', smtp_host: null, pop3_host: null })).toBe('missing_host');
    expect(accountIssue({ email: 'a@b.test', imap_host: '', smtp_host: 'smtp.b.test' })).toBeNull();
    // Read through its provider's API (Admin Center › Mail Services): no IMAP or SMTP host is needed.
    expect(accountIssue({ email: 'a@b.test', imap_host: '', smtp_host: '', pop3_host: null, transport: { driver: 'ews', label: 'Exchange Web Services (EWS)', native: true, incoming_only: false } })).toBeNull();
    expect(accountIssue({ email: 'a@b.test', imap_host: '', smtp_host: '', transport: { driver: null, label: 'IMAP / SMTP', native: false, incoming_only: false } })).toBe('missing_host');
    // An older server says nothing of hosts: nothing is concluded from that.
    expect(accountIssue({ email: 'a@b.test' })).toBeNull();
    const [, , m365, noEmail] = safeMailboxes({ mailboxes: boxes }).mailboxes;
    expect(oauthProviderOf(m365!)).toBe('microsoft');
    expect(reconnectKind(m365!)).toBe('oauth');
    expect(reconnectKind(noEmail!)).toBe('setup');
    expect(accountTitle(m365!)).toBe('Microsoft 365 (name@company.com)');
  });

  it('reads a page and a message with their gaps filled, never a crash', () => {
    expect(safeRows([null, { id: 1, from_email: null, subject: null }, { subject: 'no id' }])).toEqual([expect.objectContaining({ id: 1, from_email: '', subject: '', preview: '', from_name: '' })]);
    const data = safeListData({ pages: [{ data: null }, { data: { messages: [ROWS[0]], total: 1, has_more: true } }], pageParams: [] });
    expect(data.pages.map((p) => p.data.messages.length)).toEqual([0, 1]);
    expect(data.pages[0]!.data).toMatchObject({ total: 0, has_more: false });
    expect(safeMessage(null)).toBeNull();
    expect(safeMessage({ id: 5, body_html: null, from_email: null, to: null, attachments: [null] })).toMatchObject({ id: 5, body_html: '', from_email: '', to: [], cc: [], attachments: [] });
  });

  it('With a broken Microsoft 365 account, Mail still opens and every other account works', async () => {
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    // The other accounts are listed and their mail shows.
    expect(await within(nav).findByRole('button', { name: /^me@example\.test/ })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: /^me@contoso\.test/ })).toBeTruthy();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    expect(await within(list).findByText('Welcome Team')).toBeTruthy();
    // The broken one is in the sidebar with a red marker.
    const brokenRow = nav.querySelector('[data-attention="missing_token"]');
    expect(brokenRow?.textContent).toContain('name@company.com');
    expect(nav.querySelector('[data-attention="missing_email"]')).toBeTruthy();
    // The bar at the top of the list names it, with Reconnect and Remove.
    const bar = screen.getByRole('alert', { name: 'Accounts that need attention' });
    const row = bar.querySelector('[data-account="9"]') as HTMLElement;
    expect(row.textContent).toContain('Microsoft 365 (name@company.com) needs attention');
    expect(within(row).getByRole('button', { name: 'Reconnect' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(screen.queryByText(/failed to load/)).toBeNull();
  });

  it('Reconnect signs the broken Microsoft 365 account in again, and sets up one saved without an address', async () => {
    show();
    const bar = await screen.findByRole('alert', { name: 'Accounts that need attention' });
    fireEvent.click(within(bar.querySelector('[data-account="9"]') as HTMLElement).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/oauth/microsoft/start', { client: 'desktop', login_hint: 'name@company.com' }));
    const { openSignInUrl } = await import('../../../src/modules/mail/OAuthSignIn');
    await waitFor(() => expect(openSignInUrl).toHaveBeenCalledWith('https://login.microsoftonline.com/x', 'microsoft'));
    fireEvent.click(within(bar.querySelector('[data-account="10"]') as HTMLElement).getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByRole('heading', { name: 'Add a mailbox' })).toBeTruthy();
  });

  it('Remove takes the broken account out of WorkSuite and its mail off this computer', async () => {
    show();
    const bar = await screen.findByRole('alert', { name: 'Accounts that need attention' });
    const row = bar.querySelector('[data-account="9"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    // Asked once: it goes from every computer.
    expect(within(row).getByText('Remove it from WorkSuite on every computer?')).toBeTruthy();
    boxes = [...GOOD, NO_EMAIL];
    fireEvent.click(within(row).getByRole('button', { name: 'Remove for good' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/mail/mailboxes/9'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:clearMailbox', { mailbox: '9' }));
    // The list is asked again and the account is gone from the bar.
    await waitFor(() => expect(screen.getByRole('alert', { name: 'Accounts that need attention' }).querySelector('[data-account="9"]')).toBeNull());
  });
});

describe('Mail from this computer (#338)', () => {
  it('opens from the local copy while the server cannot be reached: the accounts and the list, before any answer', async () => {
    network = false;
    app.set({ status: { network: 'OFFLINE' } as never });
    vi.mocked(call).mockImplementation((async (channel: string, input?: { paths?: string[] }) => {
      if (channel === 'offline:peek') return (input?.paths ?? []).map((p) => (p === '/api/mail/mailboxes' ? { body: JSON.stringify({ status: 'success', data: { mailboxes: boxes } }), cachedAt: '2026-10-02T09:00:00Z' } : null));
      if (channel === 'offline:mailList') return { messages: ROWS, total: ROWS.length };
      if (channel === 'offline:pending') return [];
      return null;
    }) as never);
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    expect(await within(nav).findByRole('button', { name: /^me@contoso\.test/ })).toBeTruthy();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    expect(await within(list).findByText('Welcome Team')).toBeTruthy();
    expect(within(list).getByText('Pat Lee')).toBeTruthy();
    expect(call).toHaveBeenCalledWith('offline:mailList', expect.objectContaining({ mailbox: null, folder: 'inbox', role: 'inbox' }));
    // The broken account is still named, from the same copy.
    expect(screen.getByRole('alert', { name: 'Accounts that need attention' }).textContent).toContain('Microsoft 365 (name@company.com) needs attention');
  });
});

describe('a message that cannot be drawn (#338)', () => {
  it('shows inline in the reading pane — Try again · Details — and the list and the folders go on working', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    show('/mail?msg=102&mbx=2');
    const pane = await screen.findByRole('region', { name: 'Reading pane' });
    const note = await within(pane).findByRole('alert');
    expect(note.textContent).toContain("This message couldn't be shown");
    // Details: the reference and the error, also kept for Diagnostics with the account.
    fireEvent.click(within(note).getByRole('button', { name: 'Details' }));
    const ref = screenErrors.get().errors[0]!;
    expect(ref).toMatchObject({ module: 'Mail · message', where: 'pane', account: '2', name: 'TypeError' });
    expect(note.textContent).toContain(`Reference ${ref.ref}`);
    expect(note.textContent).toContain("Cannot read properties of null (reading 'verdict')");
    // The list and the sidebar still work: another message opens.
    const nav = screen.getByRole('navigation', { name: 'Mail' });
    expect(within(nav).getByRole('button', { name: /^me@example\.test/ })).toBeTruthy();
    const list = screen.getByRole('listbox', { name: 'Messages' });
    fireEvent.click(await within(list).findByText('Welcome Team'));
    expect(await within(pane).findByRole('heading', { name: 'Welcome to your mailbox' })).toBeTruthy();
    expect(screen.queryByText(/failed to load/)).toBeNull();
  });

  it('Try again asks for the message again and draws it once the answer is good', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    show('/mail?msg=102&mbx=2');
    const pane = await screen.findByRole('region', { name: 'Reading pane' });
    const note = await within(pane).findByRole('alert');
    const asked = vi.mocked(apiGetMeta).mock.calls.filter((c) => c[0] === '/api/mail/messages/102').length;
    badBody = false;
    fireEvent.click(within(note).getByRole('button', { name: 'Try again' }));
    expect(await within(pane).findByText('Revised quotation', { selector: 'h1, h2, [role="heading"]' })).toBeTruthy();
    expect(vi.mocked(apiGetMeta).mock.calls.filter((c) => c[0] === '/api/mail/messages/102').length).toBeGreaterThan(asked);
  });
});

describe('the module’s own error screen (#338)', () => {
  const mod = { id: 'mail', manifest: { name: 'Mail' } } as unknown as DesktopModule;

  /** A module whose answer is bad until the server is asked again. */
  function Flaky({ mounts }: { mounts: { n: number } }) {
    const [mountedAt] = useState(() => ++mounts.n);
    const q = useQuery({ queryKey: ['mail', 'probe'], queryFn: async () => (fetches++ === 0 ? null : { ok: true }) });
    if (q.isPending) return <p>Loading</p>;
    if (!q.data) throw new TypeError("Cannot read properties of null (reading 'verdict')");
    return <p>{`Mail is back (mount ${mountedAt})`}</p>;
  }
  let fetches = 0;

  it('logs the module, the account and a reference, shows the reference, and opens Diagnostics on it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetches = 0;
    screenErrors.set({ accounts: { mail: '9' } });
    const open = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ModuleBoundary name="Mail" {...moduleRecovery(mod, qc, open)}>
          <Flaky mounts={{ n: 0 }} />
        </ModuleBoundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Mail failed to load')).toBeTruthy();
    const e = screenErrors.get().errors[0]!;
    expect(e).toMatchObject({ module: 'Mail', where: 'module', account: '9', message: "Cannot read properties of null (reading 'verdict')" });
    expect(e.ref).toMatch(/^E-[0-9A-F]{6}$/);
    expect(screen.getByText(`Reference ${e.ref}`)).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith(`[module:Mail] ref=${e.ref} account=9`, expect.any(TypeError), expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Open Diagnostics' }));
    expect(open).toHaveBeenCalledWith(`/diagnostics?error=${e.ref}`);
    // Diagnostics, opened on it, shows that error.
    cleanup();
    render(<ScreenErrors focus={e.ref} />);
    expect(screen.getByRole('heading', { name: `Error ${e.ref}` })).toBeTruthy();
    expect(document.querySelector(`[data-error-ref="${e.ref}"]`)?.textContent).toContain('account 9');
  });

  it('Retry really starts Mail again: the answers are asked for again and the module is mounted afresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetches = 0;
    const mounts = { n: 0 };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ModuleBoundary name="Mail" {...moduleRecovery(mod, qc, vi.fn())}>
          <Flaky mounts={mounts} />
        </ModuleBoundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Mail failed to load')).toBeTruthy();
    const before = mounts.n;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // Before #338 Retry drew the same cached null again and failed the same way.
    expect(await screen.findByText(/^Mail is back/)).toBeTruthy();
    expect(fetches).toBe(2);
    expect(mounts.n).toBeGreaterThan(before);
  });

  it('offers Mail’s own way out, Repair local mail data', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetches = 0;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { lazy } = await import('react');
    const withRepair = { ...mod, recover: lazy(() => import('../../../src/modules/mail/RepairLocalMail')) } as DesktopModule;
    render(
      <QueryClientProvider client={qc}>
        <ModuleBoundary name="Mail" {...moduleRecovery(withRepair, qc, vi.fn())}>
          <Flaky mounts={{ n: 0 }} />
        </ModuleBoundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Repair local mail data' })).toBeTruthy();
  });
});

describe('Repair local mail data (#338)', () => {
  const answer = (action: 'cleared' | 'restart') => ({ check: action === 'cleared' ? 'ok' : 'malformed', healthy: action === 'cleared', action, removed: action === 'cleared' ? 12 : 0, kept: { outbox: 2, drafts: 1 }, backup: '/p/worksuite.db.bak' });

  it('asks first, then clears Mail’s copy, asks the server again and says the unsent mail and settings were kept', async () => {
    vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'offline:repairMail' ? answer('cleared') : null)) as never);
    const qc = new QueryClient();
    qc.setQueryData(['mail', 'messages', 'unified', 'inbox'], { pages: [] });
    qc.setQueryData(['calendar', 'events'], [1]);
    const done = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <RepairLocalMailButton onDone={done} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Repair local mail data' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Unsent mail in your outbox, drafts and your account settings are kept.');
    expect(call).not.toHaveBeenCalledWith('offline:repairMail');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Repair' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith('offline:repairMail');
    expect(qc.getQueryData(['mail', 'messages', 'unified', 'inbox'])).toBeUndefined();
    expect(qc.getQueryData(['calendar', 'events'])).toEqual([1]);
    expect(toast).toHaveBeenCalledWith('success', 'Mail on this computer was cleared and is being downloaded again. 2 unsent messages and your account settings were kept.');
    // A fresh full sync of every account that can sync.
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/mailboxes/1/sync', { by: 'all' }));
  });

  it('a damaged database: WorkSuite restarts to rebuild it, and says so', async () => {
    vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'offline:repairMail' ? answer('restart') : null)) as never);
    const done = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RepairLocalMailButton onDone={done} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Repair local mail data' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Repair' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', 'The local mail database is damaged. WorkSuite restarts to rebuild it from the server. 2 unsent messages and your account settings were kept.'));
    expect(done).not.toHaveBeenCalled();
  });
});
