// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiGet, apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { AddMailbox } from '../../../src/modules/mail/AddMailbox';
import { OAuthErrorCard } from '../../../src/modules/mail/OAuthSignIn';
import { explained, initialSteps, mailboxProblemText, summaryLine, type OAuthAttempt, type OAuthExplained } from '../../../src/modules/mail/oauth';

/**
 * Adding a Microsoft 365 mailbox (worksuite#154), the window's half: the server's explanation — what went wrong, the
 * next step and its one action (copy the admin consent link, open a how-to) — with Microsoft's code and the reference
 * ID under a Details toggle. "Check the server log" is never shown, whatever an older server says.
 */

const ID = 'b'.repeat(32);
const SIGN_IN = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?response_type=code&state=st&code_challenge=ch&code_challenge_method=S256&scope=https%3A%2F%2Foutlook.office.com%2FIMAP.AccessAsUser.All%20https%3A%2F%2Foutlook.office.com%2FSMTP.Send%20offline_access%20openid%20email%20profile';
const CONSENT_URL = 'https://login.microsoftonline.com/contoso.com/adminconsent?client_id=test-client-id';

const attempt = (over: Partial<OAuthAttempt>): OAuthAttempt => ({
  id: ID, request_id: 'REQ7F3A9C21', provider: 'microsoft', client: 'desktop', purpose: 'connect', status: 'pending', email: null, connection_id: null,
  steps: initialSteps(), error: null, warnings: [], created_at: null, finished_at: null, ...over,
});

const consentError: OAuthExplained = {
  kind: 'consent_required',
  error_code: 'M365_ADMIN_CONSENT',
  code: 'AADSTS65001',
  aadsts: '65001',
  error: 'consent_required',
  title: 'Your Microsoft admin needs to approve WorkSuite',
  message: 'Your Microsoft 365 admin needs to approve WorkSuite once before mailboxes in your organisation can be connected.',
  next_step: 'Copy the admin consent link for your Microsoft 365 admin. After they approve it, sign in again.',
  quiet: false,
  for_admin: false,
  admin_consent_url: CONSENT_URL,
  help_url: 'https://learn.microsoft.com/entra/identity/enterprise-apps/grant-admin-consent',
  action: { type: 'copy', label: 'Copy admin consent link', value: CONSENT_URL },
  ref: 'REQ7F3A9C21',
  details: { provider: 'microsoft', stage: 'signin', request_id: 'REQ7F3A9C21', error: 'consent_required', code: 'AADSTS65001', description: 'AADSTS65001: The user or administrator has not consented.', trace_id: 'trace-1', correlation_id: 'corr-2', timestamp: null },
};

const imapError: OAuthExplained = {
  kind: 'imap_disabled',
  error_code: 'M365_IMAP_DISABLED',
  code: null,
  error: 'imap',
  title: 'IMAP is turned off for this mailbox',
  message: 'Signed in, but IMAP is turned off for this mailbox in Microsoft 365, so WorkSuite cannot read its mail.',
  next_step: 'Ask your Microsoft 365 admin to enable it: Exchange admin center › Recipients › Mailboxes › amal@contoso.com › Email apps › Manage email apps settings › turn on IMAP (and Authenticated SMTP, for sending). Then sign in again.',
  quiet: false,
  admin_consent_url: null,
  help_url: 'https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/pop3-and-imap4/enable-or-disable-pop3-or-imap4-access',
  action: { type: 'link', label: 'How to turn on IMAP', value: 'https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/pop3-and-imap4/enable-or-disable-pop3-or-imap4-access' },
  ref: 'REQ7F3A9C21',
  details: { stage: 'imap', request_id: 'REQ7F3A9C21', description: 'A1 NO AUTHENTICATE failed.' },
};

const failedAt = (error: OAuthExplained, stage: 'signin' | 'imap') =>
  attempt({
    status: 'failed',
    error,
    steps: initialSteps().map((s) => ({ ...s, status: stage === 'imap' ? (s.id === 'imap' ? ('fail' as const) : s.id === 'smtp' ? ('skipped' as const) : ('pass' as const)) : s.id === 'signin' ? ('fail' as const) : ('skipped' as const) })),
  });

let replies: OAuthAttempt[] = [];
const next = () => ({ attempt: replies.length > 1 ? replies.shift()! : replies[0]! });

function open() {
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/mail/oauth/providers') return { providers: ['microsoft'] } as never;
    if (path === '/api/mail/local-mailboxes') return { mailboxes: [] } as never;
    return next() as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AddMailbox initial="microsoft" onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return screen.findByRole('dialog');
}

async function signInAndFail(error: OAuthExplained, stage: 'signin' | 'imap') {
  replies = [attempt({}), failedAt(error, stage)];
  vi.mocked(apiPost).mockResolvedValue({ url: SIGN_IN, attempt: ID, request_id: 'REQ7F3A9C21' } as never);
  const dialog = await open();
  fireEvent.change(await within(dialog).findByLabelText(/Email address/), { target: { value: 'amal@contoso.com' } });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Sign in with Microsoft' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('app:openExternal', { url: SIGN_IN }));
  await vi.advanceTimersByTimeAsync(2100);
  await vi.advanceTimersByTimeAsync(2100);
  return within(dialog).findByRole('alert');
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation((async () => null) as never);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => undefined) } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a failed Microsoft 365 sign-in', () => {
  it('says the admin must approve, copies the admin consent link, and keeps the code and reference under Details', async () => {
    const alert = await signInAndFail(consentError, 'signin');
    expect(within(alert).getByText('Your Microsoft admin needs to approve WorkSuite')).toBeTruthy();
    expect(alert.textContent).not.toMatch(/server log/i);

    fireEvent.click(within(alert).getByRole('button', { name: 'Copy admin consent link' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CONSENT_URL));
    // The consent link is the action: it is not offered twice.
    expect(within(alert).getAllByRole('button', { name: /Copy admin consent link/ })).toHaveLength(1);

    const toggle = within(alert).getByRole('button', { name: 'Details' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(alert).queryByRole('button', { name: 'Copy details' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(alert).getByText('AADSTS65001')).toBeTruthy();
    expect(within(alert).getByText('WorkSuite code M365_ADMIN_CONSENT')).toBeTruthy();
    expect(within(alert).getByText('Reference ID REQ7F3A9C21')).toBeTruthy();

    fireEvent.click(within(alert).getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(vi.mocked(navigator.clipboard.writeText).mock.calls[1]?.[0]).toContain('Reference ID: REQ7F3A9C21'));
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[1]?.[0] ?? '';
    expect(copied).toContain('Error code: AADSTS65001');
    expect(copied).toContain('WorkSuite code: M365_ADMIN_CONSENT');
    expect(copied).toContain('Correlation ID: corr-2');

    fireEvent.click(toggle);
    expect(within(alert).queryByRole('button', { name: 'Copy details' })).toBeNull();
  });

  it('says IMAP is off, names the setting and links the how-to', async () => {
    const alert = await signInAndFail(imapError, 'imap');
    expect(within(alert).getByText('IMAP is turned off for this mailbox')).toBeTruthy();
    expect(within(alert).getByText(/Email apps › Manage email apps settings › turn on IMAP/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'How to turn on IMAP' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: imapError.help_url });
    expect(screen.getByRole('list', { name: 'Sign-in steps' }).querySelector('[data-status="fail"]')?.textContent).toContain('Reading mail');
  });

  it('does not open a sign-in page without PKCE, and says so with a reference', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(apiPost).mockResolvedValue({ url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?response_type=code&state=st', attempt: ID } as never);
    replies = [attempt({})];
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Sign in with Microsoft' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toMatch(/isn't one WorkSuite can safely open/);
    expect(call).not.toHaveBeenCalledWith('app:openExternal', expect.anything());
    expect(err.mock.calls[0]?.[0]).toMatch(/\[[0-9A-F]{12}\]: no_pkce/);
    expect(err.mock.calls[0]?.[0]).not.toContain('state=st');
  });

  it('explains a start that failed, without the server log', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(apiPost).mockRejectedValue(new Error('OAuth sign-in failed — check the server log'));
    replies = [attempt({})];
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Sign in with Microsoft' }));
    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByText("The sign-in couldn't start")).toBeTruthy();
    expect(alert.textContent).not.toMatch(/server log/i);
    fireEvent.click(within(alert).getByRole('button', { name: 'Details' }));
    expect(within(alert).getByText(/^Reference ID [0-9A-F]{12}$/)).toBeTruthy();
  });

  it('tells a personal Outlook.com address what it needs', async () => {
    const dialog = await open();
    fireEvent.change(await within(dialog).findByLabelText(/Email address/), { target: { value: 'kasun@outlook.com' } });
    expect(within(dialog).getByRole('note').textContent).toMatch(/personal Microsoft account/);
  });
});

describe('never "check the server log"', () => {
  const old: OAuthExplained = {
    kind: 'unknown',
    code: 'AADSTS50011',
    error: 'invalid_request',
    title: 'OAuth sign-in failed',
    message: 'OAuth sign-in failed — check the server log',
    next_step: null,
    quiet: false,
    admin_consent_url: null,
    help_url: null,
    details: { request_id: 'REQ1', code: 'AADSTS50011' },
  };

  it('replaces an older server’s words with what the code means, keeping the IDs', () => {
    const e = explained(old)!;
    expect(e.kind).toBe('redirect_mismatch');
    expect(`${e.title} ${e.message} ${e.next_step ?? ''}`).not.toMatch(/server log/i);
    expect(e.details.request_id).toBe('REQ1');
    expect(summaryLine(attempt({ status: 'failed', error: old })).text).not.toMatch(/server log/i);
    expect(explained(consentError)).toBe(consentError);
  });

  it('shows the card without it', () => {
    render(<OAuthErrorCard error={old} />);
    expect(screen.getByRole('alert').textContent).not.toMatch(/server log/i);
  });

  it('says a mailbox whose Microsoft sign-in was refused needs signing in again', () => {
    expect(mailboxProblemText({ auth_type: 'oauth', last_error: 'invalid_grant: AADSTS700082 The refresh token has expired' })).toMatch(/Sign in again/);
    expect(mailboxProblemText({ auth_type: 'oauth', last_error: 'Microsoft sign-in expired — sign in again' })).toMatch(/Sign in again/);
    expect(mailboxProblemText({ auth_type: 'oauth', last_error: 'OAuth sign-in failed — check the server log' })).not.toMatch(/server log/i);
    expect(mailboxProblemText({ auth_type: 'password', last_error: 'Password rejected' })).toBe('Password rejected');
  });
});
