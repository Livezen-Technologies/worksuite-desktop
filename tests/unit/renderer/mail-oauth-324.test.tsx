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
import { detailsText, initialSteps, isAttemptId, nextPoll, startBody, summaryLine, type OAuthAttempt } from '../../../src/modules/mail/oauth';

/**
 * Microsoft 365 mailbox sign-in from the desktop app (worksuite-desktop#324): the system browser opens, the app
 * watches the attempt and shows each step, and a failure says what went wrong — Microsoft's code, Copy details and
 * the admin approval link — instead of "check the server log".
 */

const ID = 'a'.repeat(32);
const attempt = (over: Partial<OAuthAttempt>): OAuthAttempt => ({
  id: ID, request_id: '7F3A9C21B04E', provider: 'microsoft', client: 'desktop', purpose: 'connect', status: 'pending', email: null, connection_id: null,
  steps: initialSteps(), error: null, warnings: [], created_at: null, finished_at: null, ...over,
});
const consent = attempt({
  status: 'failed',
  steps: initialSteps().map((s) => ({ ...s, status: s.id === 'signin' ? ('fail' as const) : ('skipped' as const) })),
  error: {
    kind: 'consent_required', code: 'AADSTS65001', error: 'consent_required', title: 'Your Microsoft 365 admin needs to approve WorkSuite',
    message: 'Your Microsoft 365 admin needs to approve WorkSuite once before mailboxes in your organisation can be connected.', next_step: 'Copy the approval link for your Microsoft 365 admin.',
    quiet: false, admin_consent_url: 'https://login.microsoftonline.com/contoso.com/adminconsent?client_id=cid', help_url: null,
    details: { request_id: '7F3A9C21B04E', code: 'AADSTS65001', trace_id: 'trace-1', correlation_id: 'corr-2', timestamp: '2026-10-08 10:11:12Z', stage: 'signin', provider: 'microsoft' },
  },
});

describe('the pieces', () => {
  it('starts as the desktop app, with the address when it is one', () => {
    expect(startBody('amal@contoso.com')).toEqual({ client: 'desktop', login_hint: 'amal@contoso.com' });
    expect(startBody('not an address')).toEqual({ client: 'desktop' });
    expect(startBody(null)).toEqual({ client: 'desktop' });
  });

  it('polls quickly, then slower, and stops after 15 minutes', () => {
    expect(nextPoll(0)).toBe(2000);
    expect(nextPoll(3 * 60_000)).toBe(5000);
    expect(nextPoll(15 * 60_000)).toBeNull();
  });

  it('only polls an attempt id the server could have minted', () => {
    expect(isAttemptId(ID)).toBe(true);
    expect(isAttemptId('../x')).toBe(false);
    expect(isAttemptId(undefined)).toBe(false);
  });

  it('copies the code and every id support asks for', () => {
    const t = detailsText(consent);
    expect(t).toContain('Error code: AADSTS65001');
    expect(t).toContain('Request ID: 7F3A9C21B04E');
    expect(t).toContain('Trace ID: trace-1');
    expect(t).toContain('Correlation ID: corr-2');
    expect(t).toContain('Signed in ✗');
  });

  it('sums an attempt up in one line, quietly for a cancel', () => {
    expect(summaryLine(attempt({ status: 'connected', email: 'amal@contoso.com' }))).toEqual({ kind: 'success', text: 'amal@contoso.com is connected.' });
    expect(summaryLine(attempt({ status: 'cancelled' })).kind).toBe('info');
    expect(summaryLine(consent).text).toContain('(AADSTS65001)');
    expect(summaryLine(consent).text).not.toMatch(/server log/);
  });
});

describe('adding a Microsoft 365 mailbox', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    vi.mocked(call).mockClear();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => undefined) } });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

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
  let replies: OAuthAttempt[] = [];
  const next = () => ({ attempt: replies.length > 1 ? replies.shift()! : replies[0]! });

  it('opens the browser, watches the steps, and explains a consent failure with the approval link', async () => {
    replies = [attempt({}), consent];
    vi.mocked(apiPost).mockResolvedValue({ url: 'https://login.microsoftonline.com/x', attempt: ID, request_id: '7F3A9C21B04E' } as never);
    const dialog = await open();

    fireEvent.change(within(dialog).getByLabelText(/Email address/), { target: { value: 'amal@contoso.com' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Sign in with Microsoft' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/oauth/microsoft/start', { client: 'desktop', login_hint: 'amal@contoso.com' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://login.microsoftonline.com/x' }));
    expect(await within(dialog).findByRole('list', { name: 'Sign-in steps' })).toBeTruthy();
    expect(within(dialog).getByText(/Finish signing in in your browser/)).toBeTruthy();

    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(2100);
    expect(await within(dialog).findByText('Your Microsoft 365 admin needs to approve WorkSuite')).toBeTruthy();
    expect(within(dialog).getByText('AADSTS65001')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith(`/api/mail/oauth/attempts/${ID}`);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy approval link' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://login.microsoftonline.com/contoso.com/adminconsent?client_id=cid'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(vi.mocked(navigator.clipboard.writeText).mock.calls[1]?.[0]).toContain('Correlation ID: corr-2'));
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('says it is connected when every step passed', async () => {
    replies = [attempt({ status: 'connected', email: 'amal@contoso.com', steps: initialSteps().map((s) => ({ ...s, status: 'pass' as const })) })];
    vi.mocked(apiPost).mockResolvedValue({ url: 'https://login.microsoftonline.com/x', attempt: ID } as never);
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Sign in with Microsoft' }));
    await vi.advanceTimersByTimeAsync(2100);
    expect(await within(dialog).findByText('amal@contoso.com is connected.')).toBeTruthy();
  });

  it('falls back to "finish in your browser" with an older server', async () => {
    replies = [attempt({})];
    vi.mocked(apiPost).mockResolvedValue({ url: 'https://login.microsoftonline.com/x' } as never);
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Sign in with Microsoft' }));
    expect(await within(dialog).findByText(/The mailbox appears here when you are done/)).toBeTruthy();
  });
});
