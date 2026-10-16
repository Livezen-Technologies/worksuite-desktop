// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '@shared/types';

/** WorkSuite OS mode's sign-in screen: the OS signs in; nothing here asks for a server or a password. */
const bridge = vi.hoisted(() => ({ call: vi.fn(async () => null) }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));

const { connectRoute } = await import('../../../src/app/connect/ConnectRoot');
const { OsSignIn } = await import('../../../src/app/connect/OsSignIn');

const auth = (over: Partial<AuthState>): AuthState => ({ stage: 'signed-out', server: null, user: null, message: null, setupPending: false, ...over });
const route = (a: AuthState) => connectRoute({ auth: a, accounts: null, adding: null, connect: null, signin: null });

afterEach(() => {
  cleanup();
  bridge.call.mockClear();
});

describe('OS sign-in routing', () => {
  it('replaces every server and password screen in OS mode', () => {
    for (const stage of ['no-server', 'signed-out', 'expired', 'mfa', 'browser', 'blocked'] as const) expect(route(auth({ stage, osManaged: true })), stage).toBe('os-sign-in');
  });
  it('leaves the workspace, loading and version screens alone', () => {
    expect(route(auth({ stage: 'ready', osManaged: true }))).toBe('onboarding');
    expect(route(auth({ stage: 'bootstrapping', osManaged: true }))).toBe('onboarding');
    expect(route(auth({ stage: 'update-required', osManaged: true }))).toBe('compatibility');
  });
  it('does nothing outside OS mode', () => {
    expect(route(auth({ stage: 'no-server' }))).toBe('startup');
  });
});

describe('OsSignIn', () => {
  it('has no password field and signs in through the OS', async () => {
    const { container } = render(<OsSignIn auth={auth({ stage: 'signed-out', message: 'Your WorkSuite OS session has ended. Sign in again.', osManaged: true })} />);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/session has ended/);
    fireEvent.click(screen.getByRole('button', { name: /Sign in with WorkSuite OS/ }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('auth:osSignIn'));
  });
  it('while the browser is out, says so without a button', () => {
    render(<OsSignIn auth={auth({ stage: 'browser', osManaged: true })} />);
    expect(screen.getByRole('heading').textContent).toMatch(/browser/);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
