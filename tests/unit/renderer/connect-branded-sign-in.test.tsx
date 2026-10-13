// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredServer } from '@shared/discovery';
import type { AuthState, Preferences, ServerInfo } from '@shared/types';
import { abc, auth, personal, run } from './accounts-fixtures';
import type * as Bridge from '../../../src/core/bridge';

/**
 * Screen 8 — the organization's branded sign-in (WP4): logo and accent from discovery, the browser sign-in where the
 * server has one, and the in-app form (SignInStep, with SignInProtection) for legacy servers.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { DesktopError } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { BrandedSignIn, signsInWithBrowser } = await import('../../../src/app/connect/BrandedSignIn');

const SERVER: ServerInfo = { origin: 'https://worksuite.abc.com', name: 'ABC WorkSuite', api: 'core', minimumVersion: null, locked: false };
const ATTEMPT = { attemptId: 'att_12345678', host: 'worksuite.abc.com', url: 'https://worksuite.abc.com/desktop/sign-in', startedAt: 1, expiresAt: 2, purpose: 'sign-in', method: null };
const browserRun = run({ state: 'ok', server: { origin: 'https://worksuite.abc.com', authMode: 'legacy', browserSignIn: { url: '/desktop/sign-in', exchange: '/x', client: 'worksuite-desktop' } } as DiscoveredServer });

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string) => (channel === 'signin:start' ? ATTEMPT : undefined));
  app.set({ prefs: { language: 'en' } as Preferences, connect: null, accounts: null, signin: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
});
afterEach(() => cleanup());

describe('signsInWithBrowser', () => {
  it('is the browser for Cloud, OIDC and browser_sign_in servers; the form for legacy ones', () => {
    expect(signsInWithBrowser(personal(), null, null)).toBe(true);
    expect(signsInWithBrowser(abc(), SERVER, null)).toBe(false);
    expect(signsInWithBrowser(abc(), { ...SERVER, authMode: 'oidc' } as ServerInfo, null)).toBe(true);
    expect(signsInWithBrowser(abc(), SERVER, browserRun)).toBe(true);
    expect(signsInWithBrowser(abc({ serverOrigin: 'https://other.example' }), SERVER, browserRun)).toBe(false);
  });

  it('follows the saved server record after a restart, when no connect run is left', () => {
    const bsi = { url: '/desktop/sign-in', exchange: '/api/auth/apps/exchange', client: 'worksuite-desktop' };
    expect(signsInWithBrowser(abc(), { ...SERVER, authMode: 'legacy', browserSignIn: bsi }, null)).toBe(true);
    expect(signsInWithBrowser(abc(), { ...SERVER, authMode: 'oidc', browserSignIn: null }, null)).toBe(true);
    expect(signsInWithBrowser(abc(), { ...SERVER, authMode: 'legacy', browserSignIn: null }, null)).toBe(false);
    // The record decides once it carries them: a stale run does not override it.
    expect(signsInWithBrowser(abc(), { ...SERVER, authMode: 'legacy', browserSignIn: null }, browserRun)).toBe(false);
  });
});

describe('BrandedSignIn', () => {
  it('draws the organization’s name, address, verified mark and accent', () => {
    render(<BrandedSignIn auth={auth('signed-out', { account: abc(), server: SERVER })} />);
    expect(screen.getByText('WorkSuite — Enterprise · ABC Client')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ABC Client WorkSuite' })).toBeTruthy();
    expect(screen.getByText('worksuite.abc.com')).toBeTruthy();
    expect(screen.getByText('· verified')).toBeTruthy();
    expect(screen.getByTestId('connect-accent').style.background).toMatch(/7a2e8e|rgb\(122, 46, 142\)/i);
  });

  it('signs in through the browser when the server offers it', async () => {
    app.set({ connect: browserRun });
    render(<BrandedSignIn auth={auth('signed-out', { account: abc(), server: SERVER })} />);
    expect(screen.getByText(/sign-in page opens in your browser/)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button.style.background).toMatch(/7a2e8e|rgb\(122, 46, 142\)/i);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(bridge.call).toHaveBeenCalledWith('signin:start', { accountId: abc().id, method: null, purpose: 'sign-in' });
    expect(app.get().signin).toEqual(ATTEMPT);
  });

  it('asks to sign in again (reauth) when the session expired', async () => {
    app.set({ connect: browserRun });
    render(<BrandedSignIn auth={auth('expired', { account: abc(), server: SERVER, user: { id: 'u', name: 'H', email: 'h@abc.com', avatar: null } as AuthState['user'], message: 'Your session expired.' })} />);
    expect(screen.getByText('Your session expired.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('signin:start', { accountId: abc().id, method: null, purpose: 'reauth', loginHint: 'h@abc.com' });
  });

  it('falls back to the in-app form when the browser sign-in is not available', async () => {
    bridge.call.mockImplementation(async (channel: string) => {
      if (channel === 'signin:start') throw new DesktopError('UNSUPPORTED', 'no');
      return undefined;
    });
    app.set({ connect: browserRun });
    render(<BrandedSignIn auth={auth('signed-out', { account: abc(), server: SERVER })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('keeps the existing password form for legacy servers', async () => {
    render(<BrandedSignIn auth={auth('signed-out', { account: abc(), server: SERVER })} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'h@abc.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('auth:signIn', { email: 'h@abc.com', password: 'secret' });
  });

  it('shows the CAPTCHA wait from SignInProtection in the branded screen', () => {
    render(<BrandedSignIn auth={auth('signed-out', { account: abc(), server: SERVER, gate: { kind: 'blocked', email: '', message: 'Too many attempts.', until: null } as never })} />);
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('offers another server and the server’s details', () => {
    render(<BrandedSignIn auth={auth('signed-out', { account: abc(), server: SERVER })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Server details' }));
    expect(screen.getByTestId('server-details').textContent).toContain('https://worksuite.abc.com');
    expect(screen.getByTestId('server-details').textContent).toContain('Signed and verified');
    fireEvent.click(screen.getByRole('button', { name: 'Use a different server' }));
    expect(app.get().session.adding).toEqual({ step: 'enterprise' });
  });

  it('hides “Use a different server” for a server IT set up', () => {
    render(<BrandedSignIn auth={auth('signed-out', { account: abc({ managed: true }), server: SERVER })} />);
    expect(screen.queryByRole('button', { name: 'Use a different server' })).toBeNull();
  });
});
