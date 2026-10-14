// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountView } from '@shared/accounts';
import type { BrowserSignIn, CloudStatus, StorageUsage } from '@shared/cloud';
import type { ConnectRun } from '@shared/discovery';
import type { AuthState, Preferences } from '@shared/types';

/**
 * Connection & Startup's Personal screens (WP3): welcome, waiting for the browser, check your email, workspace
 * setup; the read-only and storage banners, Account › Storage, the Home card and the storage-full dialog.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn(async (..._a: unknown[]): Promise<unknown> => null) }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
const tabs = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<object>()), navigate: tabs.navigate }));

const { app } = await import('../../../src/core/app-state');
const { ConnectRoot } = await import('../../../src/app/connect/ConnectRoot');
const { PersonalWelcome } = await import('../../../src/app/connect/personal/PersonalWelcome');
const { BrowserWait, timeLeft } = await import('../../../src/app/connect/personal/BrowserWait');
const { CheckEmail } = await import('../../../src/app/connect/personal/CheckEmail');
const { Provisioning, nextAttempt, stepIndex } = await import('../../../src/app/connect/personal/Provisioning');
const { ReadOnlyBanner } = await import('../../../src/app/accounts/ReadOnlyBanner');
const Storage = await import('../../../src/modules/account/Storage');
const { StorageFullDialog } = await import('../../../src/modules/office/StorageFullDialog');

const GiB = 1024 ** 3;
const account = (extra: Partial<AccountView> = {}): AccountView =>
  ({ id: 'acc_personal0000000001', kind: 'personal', serverOrigin: 'https://worksuitecloud.com', serverName: 'WorkSuite Cloud', organizationName: "Hasarinda's Workspace", user: { id: 'u1', name: 'Hasarinda Manjula', email: 'hasarinda@email.example', avatar: null }, signed: true, ...extra }) as AccountView;
const auth = (stage: AuthState['stage'], extra: Partial<AuthState> = {}): AuthState => ({ stage, server: null, user: null, message: null, setupPending: false, ...extra });
const cloud = (extra: Partial<CloudStatus> = {}): CloudStatus => ({ accountState: 'ACTIVE', orgState: 'ACTIVE', provisioning: null, storage: null, entitlements: null, readOnly: null, unavailable: false, ...extra });
const attempt = (extra: Partial<BrowserSignIn> = {}): BrowserSignIn => ({ attemptId: 'att_12345678', host: 'auth.worksuitecloud.com', url: 'https://auth.worksuitecloud.com/authorize?x=1', startedAt: Date.now(), expiresAt: Date.now() + 9 * 60_000 + 12_000, purpose: 'sign-up', method: 'email', ...extra });

beforeEach(() => {
  bridge.call.mockReset().mockResolvedValue(null);
  tabs.navigate.mockReset();
  app.set({ prefs: { language: 'en' } as Preferences, auth: null, cloud: null, connect: null, signin: null, accounts: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PersonalWelcome (screen 2)', () => {
  it('signs in again through the browser with the idp hint and the email as login hint', async () => {
    render(<PersonalWelcome account={account()} />);
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(screen.getByText(/worksuitecloud\.com · verified by Livezen key/)).toBeTruthy();
    expect((screen.getByLabelText('Email (optional)') as HTMLInputElement).value).toBe('hasarinda@email.example');
    fireEvent.click(screen.getByRole('button', { name: /Microsoft/ }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('signin:start', { accountId: 'acc_personal0000000001', method: 'microsoft', purpose: 'sign-in', loginHint: 'hasarinda@email.example' }));
    expect(bridge.call).not.toHaveBeenCalledWith('connect:start', expect.anything());
  });

  it('adds WorkSuite Cloud first (checked like any server), then creates the account in the browser', async () => {
    app.set({ session: { mode: 'account', signingIn: false, moveOffer: false, adding: { step: 'personal' } } });
    const run = { runId: 'run_12345678', input: 'https://worksuitecloud.com', target: 'personal', state: 'ok', server: { plans: { freeBytes: 2 * GiB } }, failure: null } as unknown as ConnectRun;
    bridge.call.mockImplementation(async (ch: unknown) => {
      if (ch === 'connect:start') return { runId: 'run_12345678' };
      if (ch === 'connect:get') return run;
      if (ch === 'connect:confirm') return account({ id: 'acc_new00000000000000001' });
      return attempt();
    });
    render(<PersonalWelcome account={null} />);
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'new@email.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Free Account' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('signin:start', { accountId: 'acc_new00000000000000001', method: 'email', purpose: 'sign-up', loginHint: 'new@email.example' }));
    expect(bridge.call).toHaveBeenCalledWith('connect:start', { input: 'https://worksuitecloud.com', target: 'personal' });
    expect(bridge.call).toHaveBeenCalledWith('connect:confirm', { runId: 'run_12345678' });
    fireEvent.click(screen.getByText('← Back to choices'));
    expect(app.get().session.adding).toEqual({ step: 'choose' });
  });

  it('says why when WorkSuite Cloud could not be added', async () => {
    app.set({ session: { mode: 'account', signingIn: false, moveOffer: false, adding: { step: 'personal' } } });
    bridge.call.mockImplementation(async (ch: unknown) => {
      if (ch === 'connect:start') return { runId: 'run_12345678' };
      return { runId: 'run_12345678', state: 'failed', failure: { code: 'CLOUD_UNAVAILABLE', message: 'WorkSuite Cloud is temporarily unavailable.' } };
    });
    render(<PersonalWelcome account={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with email' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/temporarily unavailable/);
    expect(bridge.call).not.toHaveBeenCalledWith('signin:start', expect.anything());
  });

  it('Forgot password opens OneAuth’s page', () => {
    render(<PersonalWelcome account={account()} />);
    fireEvent.click(screen.getByText('Forgot password?'));
    expect(bridge.call).toHaveBeenCalledWith('cloud:openWeb', { page: 'forgot' });
  });
});

describe('BrowserWait (screen 3)', () => {
  it('shows the host, the time left, and opens, copies and cancels the attempt', async () => {
    render(<BrowserWait attempt={attempt()} variant="personal" accountName={null} />);
    expect(screen.getByText('Finish creating your account in your browser')).toBeTruthy();
    expect(screen.getByText('auth.worksuitecloud.com')).toBeTruthy();
    expect(screen.getByText(/09:1[12] left/)).toBeTruthy();
    fireEvent.click(screen.getByText('Open browser again'));
    expect(bridge.call).toHaveBeenCalledWith('signin:reopen', { attemptId: 'att_12345678' });
    fireEvent.click(screen.getByText('Copy the sign-in link'));
    expect(await screen.findByText('Link copied')).toBeTruthy();
    expect(bridge.call).toHaveBeenCalledWith('signin:copyLink', { attemptId: 'att_12345678' });
    fireEvent.click(screen.getByText('Cancel'));
    expect(bridge.call).toHaveBeenCalledWith('signin:cancel', { attemptId: 'att_12345678' });
    expect(timeLeft(9 * 60_000 + 12_000)).toBe('09:12');
    expect(timeLeft(-5)).toBe('00:00');
  });

  it('serves an enterprise browser sign-in too, and says when the window closed', () => {
    render(<BrowserWait attempt={attempt({ purpose: 'sign-in', expiresAt: Date.now() - 1 })} variant="enterprise" accountName="Livezen Technologies" />);
    expect(screen.getByText('WorkSuite — Enterprise · Livezen Technologies')).toBeTruthy();
    expect(screen.getByText('The sign-in window closed')).toBeTruthy();
    expect(screen.queryByText('Open browser again')).toBeNull();
    expect(screen.getByText('Start again')).toBeTruthy();
  });

  it('is what ConnectRoot shows for the browser stage', () => {
    app.set({ signin: attempt({ purpose: 'sign-in' }) });
    render(<ConnectRoot auth={auth('browser', { account: account() })} />);
    expect(screen.getByText('Finish signing in in your browser')).toBeTruthy();
  });
});

describe('CheckEmail (screen 4)', () => {
  it('names the address, counts down 60 s before Resend, then resends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    bridge.call.mockResolvedValue({ nextAt: Date.now() + 120_000 });
    render(<CheckEmail auth={auth('verify-email', { account: account() })} />);
    expect(screen.getByText('hasarinda@email.example')).toBeTruthy();
    expect(screen.getByText(/You can resend in 1:00|You can resend in 0:59/)).toBeTruthy();
    const resend = screen.getByRole('button', { name: 'Resend email' }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(resend.disabled).toBe(false);
    fireEvent.click(resend);
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('cloud:resendVerification'));
    await waitFor(() => expect(resend.disabled).toBe(true));
    expect(screen.getByText('2 · Verify email').getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByText('Start again'));
    expect(bridge.call).toHaveBeenCalledWith('accounts:signOut', { accountId: 'acc_personal0000000001', removeCachedData: true, keepOfflineFiles: false, discardUnsynced: false });
  });

  it('is what ConnectRoot shows for verify-email', () => {
    render(<ConnectRoot auth={auth('verify-email', { account: account() })} />);
    expect(screen.getByText('Check your email')).toBeTruthy();
  });
});

describe('Provisioning (screen 5)', () => {
  it('shows the steps done and running', () => {
    app.set({ cloud: cloud({ accountState: 'PROVISIONING', provisioning: { state: 'PROVISIONING', step: 'drive', attempts: 1, retry_at: null } }) });
    render(<Provisioning auth={auth('provisioning', { account: account() })} />);
    expect(screen.getByText("Setting up Hasarinda's Workspace")).toBeTruthy();
    expect(screen.getByText('Apps turned on').closest('li')?.dataset.state).toBe('done');
    expect(screen.getByText('Creating your Drive folders').closest('li')?.dataset.state).toBe('running');
    expect(screen.getByText('Preferences').closest('li')?.dataset.state).toBe('waiting');
    expect(screen.queryByTestId('provisioning-failed')).toBeNull();
  });

  it('PROVISIONING_FAILED: the next attempt, Retry now and Contact support', async () => {
    const retryAt = new Date(Date.now() + 4 * 60_000 - 1000).toISOString();
    app.set({ cloud: cloud({ accountState: 'PROVISIONING_FAILED', provisioning: { state: 'PROVISIONING_FAILED', step: 'apps', attempts: 3, retry_at: retryAt } }) });
    bridge.call.mockResolvedValue({ state: 'PROVISIONING', step: 'apps', attempts: 4, retry_at: null });
    render(<Provisioning auth={auth('provisioning', { account: account() })} />);
    expect(screen.getByText(/Next attempt in 4 minutes/)).toBeTruthy();
    fireEvent.click(screen.getByText('Contact support'));
    expect(bridge.call).toHaveBeenCalledWith('cloud:openWeb', { page: 'support' });
    fireEvent.click(screen.getByText('Retry now'));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('cloud:retryProvisioning'));
    await waitFor(() => expect(screen.queryByTestId('provisioning-failed')).toBeNull());
    expect(stepIndex('preferences')).toBe(4);
    expect(nextAttempt(new Date(Date.now() + 30_000).toISOString(), Date.now())).toMatch(/less than a minute/);
    expect(nextAttempt(null, Date.now())).toBeNull();
  });

  it('is what ConnectRoot shows for provisioning', () => {
    render(<ConnectRoot auth={auth('provisioning', { account: account() })} />);
    expect(screen.getByText("Setting up Hasarinda's Workspace")).toBeTruthy();
  });
});

describe('ReadOnlyBanner', () => {
  it('says read-only and offers Cancel deletion for a deletion under way', () => {
    render(<ReadOnlyBanner cloud={cloud({ accountState: 'PENDING_DELETION', readOnly: { reason: 'pending_deletion', message: 'Your account is scheduled for deletion.' } })} />);
    expect(screen.getByTestId('read-only-banner').textContent).toMatch(/scheduled for deletion/);
    fireEvent.click(screen.getByText('Cancel deletion'));
    expect(bridge.call).toHaveBeenCalledWith('cloud:openWeb', { page: 'privacy' });
  });

  it('a suspended workspace has no Cancel deletion; a late payment is a warning only; full storage is the storage banner', () => {
    const { rerender } = render(<ReadOnlyBanner cloud={cloud({ readOnly: { reason: 'suspended', message: 'You can still open and download your files.' } })} />);
    expect(screen.getByText('Your workspace is read-only.')).toBeTruthy();
    expect(screen.queryByText('Cancel deletion')).toBeNull();
    rerender(<ReadOnlyBanner cloud={cloud({ orgState: 'PAST_DUE' })} />);
    expect(screen.getByTestId('billing-banner')).toBeTruthy();
    rerender(<ReadOnlyBanner cloud={cloud({ storage: { used: 1.96 * GiB, limit: 2 * GiB, level: 'critical' } })} />);
    expect(screen.getByTestId('storage-banner').textContent).toMatch(/You have used 1\.96 GB of your 2 GB storage/);
    rerender(<ReadOnlyBanner cloud={cloud({ storage: { used: 0.5 * GiB, limit: 2 * GiB, level: 'ok' } })} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows nothing for an enterprise account', () => {
    app.set({ auth: auth('ready', { account: account({ kind: 'enterprise' }) }), cloud: cloud({ readOnly: { reason: 'suspended', message: 'x' } }) });
    render(<ReadOnlyBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Account › Storage (screen 12), the Home card and the sidebar meter', () => {
  const usage: StorageUsage = {
    limit: 2 * GiB,
    used: 2093796557,
    reserved: 0,
    categories: [
      { key: 'files', bytes: 1245540515, label: 'Files' },
      { key: 'versions', bytes: 429916160, label: 'Versions', policy: 'keeps 20 versions or 30 days' },
      { key: 'trash', bytes: 178257920, label: 'Trash' },
    ],
    largest: [{ id: 'f_1', name: 'Site survey.mp4', bytes: 412000000 }],
  };

  it('formats sizes as the design does', () => {
    expect(Storage.size(2 * GiB)).toBe('2 GB');
    expect(Storage.size(620 * 1024 * 1024)).toBe('620 MB');
    expect(Storage.size(2093796557)).toBe('1.95 GB');
    expect(Storage.percent(620, 2048)).toBe(30);
  });

  it('lists the categories, what is free and reserved, the banner at 95 %, and the actions', async () => {
    app.set({ auth: auth('ready', { account: account() }), cloud: cloud({ storage: { used: usage.used, limit: usage.limit, level: 'critical' } }) });
    bridge.call.mockImplementation(async (ch: unknown) => (ch === 'cloud:storage' ? usage : ch === 'offline:status' ? { cacheBytes: 3.4 * GiB } : null));
    render(<Storage.default />);
    expect(await screen.findByText('Storage — 2 GB total')).toBeTruthy();
    expect(screen.getByText(/51.2 MB free · 0 B reserved by uploads in progress/)).toBeTruthy();
    expect(screen.getByText(/keeps 20 versions or 30 days/)).toBeTruthy();
    expect(screen.getByText(/Empty Trash to recover storage/)).toBeTruthy();
    expect(screen.getByTestId('storage-banner')).toBeTruthy();
    expect(await screen.findByText('3.4 GB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Review Large Files/ }));
    expect(tabs.navigate).toHaveBeenCalledWith('/files?view=storage');
    fireEvent.click(screen.getByRole('button', { name: /Delete Old Versions/ }));
    expect(bridge.call).toHaveBeenCalledWith('cloud:openWeb', { page: 'storage' });
  });

  it('the Home card and the meter show for a Personal account only', async () => {
    app.set({ auth: auth('ready', { account: account() }), cloud: cloud({ storage: { used: 620 * 1024 * 1024, limit: 2 * GiB, level: 'ok' } }) });
    const { unmount } = render(
      <>
        <Storage.StorageCard />
        <Storage.StorageMeter />
      </>,
    );
    expect(screen.getByTestId('storage-card').textContent).toMatch(/620 MB \/ 2 GB · 30%/);
    expect(screen.getByTestId('storage-meter').textContent).toMatch(/Storage 620 MB of 2 GB/);
    fireEvent.click(screen.getByText('Manage storage'));
    expect(tabs.navigate).toHaveBeenCalledWith('/account/storage');
    unmount();
    app.set({ auth: auth('ready', { account: account({ kind: 'enterprise' }) }) });
    render(<Storage.StorageCard />);
    expect(screen.queryByTestId('storage-card')).toBeNull();
  });

  it('asks the desktop for the status when the store has none yet', async () => {
    app.set({ auth: auth('ready', { account: account() }), cloud: null });
    bridge.call.mockResolvedValue(cloud({ storage: { used: GiB, limit: 2 * GiB, level: 'ok' } }));
    render(<Storage.StorageCard />);
    expect(await screen.findByTestId('storage-card')).toBeTruthy();
    expect(bridge.call).toHaveBeenCalledWith('cloud:status');
  });
});

describe('StorageFullDialog (screen 13)', () => {
  it('promises nothing is lost and offers the ways out', () => {
    app.set({ cloud: cloud({ storage: { used: 2 * GiB, limit: 2 * GiB, level: 'full' } }) });
    const close = vi.fn();
    render(<StorageFullDialog copy={{ id: '0d5c1f43-8a5e-4f3e-9d65-1b5a0a3c2a10', name: 'Proposal.docx' }} onClose={close} />);
    expect(screen.getByText('Your 2 GB is full')).toBeTruthy();
    expect(screen.getByText(/are safe on this computer/)).toBeTruthy();
    fireEvent.click(screen.getByText('Upgrade for more space'));
    expect(bridge.call).toHaveBeenCalledWith('cloud:openWeb', { page: 'upgrade' });
    fireEvent.click(screen.getByText('Save a copy on this computer…'));
    expect(bridge.call).toHaveBeenCalledWith('office:revealLocal', { id: '0d5c1f43-8a5e-4f3e-9d65-1b5a0a3c2a10' });
    fireEvent.click(screen.getByText('Keep editing'));
    expect(close).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Manage storage'));
    expect(tabs.navigate).toHaveBeenCalledWith('/account/storage');
  });
});
