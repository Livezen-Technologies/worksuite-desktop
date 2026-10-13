// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountsState, AccountView } from '@shared/accounts';
import type { ConnectRun } from '@shared/discovery';
import type { AuthState, Preferences } from '@shared/types';

/**
 * Connection & Startup's renderer routing: ConnectRoot's routes, the WP4 screens it shows (startup selector, enterprise
 * address, checks, branded sign-in, compatibility, chooser) and WP3's Personal screens, none of them placeholders now.
 */
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

const { app } = await import('../../../src/core/app-state');
const { ConnectRoot, connectRoute, isPlaceholder } = await import('../../../src/app/connect/ConnectRoot');
const { ConnectFrame, ConnectCard } = await import('../../../src/app/connect/ConnectFrame');
// WP4's screens (Enterprise, startup, chooser, version gates, unknown link).
const wp4Screens = [
  (await import('../../../src/app/connect/StartupSelector')).StartupSelector,
  (await import('../../../src/app/connect/EnterpriseAddress')).EnterpriseAddress,
  (await import('../../../src/app/connect/QrScan')).QrScan,
  (await import('../../../src/app/connect/ChecksScreen')).ChecksScreen,
  (await import('../../../src/app/connect/BrandedSignIn')).BrandedSignIn,
  (await import('../../../src/app/connect/Compatibility')).Compatibility,
  (await import('../../../src/app/connect/WorkspaceChooser')).WorkspaceChooser,
  (await import('../../../src/app/connect/UnknownServerLink')).UnknownServerLink,
];
// WP3's Personal screens (personal-screens.test.tsx).
const wp3Screens = [
  (await import('../../../src/app/connect/personal/PersonalWelcome')).PersonalWelcome,
  (await import('../../../src/app/connect/personal/BrowserWait')).BrowserWait,
  (await import('../../../src/app/connect/personal/CheckEmail')).CheckEmail,
  (await import('../../../src/app/connect/personal/Provisioning')).Provisioning,
];

const auth = (stage: AuthState['stage'], extra: Partial<AuthState> = {}): AuthState => ({ stage, server: null, user: null, message: null, setupPending: false, ...extra });
const accounts = (extra: Partial<AccountsState> = {}): AccountsState => ({ accounts: [], activeId: null, switching: null, chooserPending: false, chooserAlways: false, allowPersonal: true, allowAddEnterprise: true, guestAvailable: true, ...extra });
const run = { runId: 'run_12345678', input: 'ws.example', target: 'enterprise', host: 'ws.example', candidates: [], steps: [], state: 'running', server: null, failure: null } as ConnectRun;
const route = (a: AuthState, more: Partial<Parameters<typeof connectRoute>[0]> = {}) => connectRoute({ auth: a, accounts: null, adding: null, connect: null, signin: null, ...more });

afterEach(() => cleanup());

describe('connectRoute', () => {
  it('leaves the stages after the server is chosen to Onboarding while accounts are not known', () => {
    for (const stage of ['signed-out', 'mfa', 'device-code', 'passkey', 'registering', 'bootstrapping', 'expired', 'blocked', 'revoked'] as const) {
      expect(route(auth(stage)), stage).toBe('onboarding');
    }
  });

  it('starts with the startup selector when there is no account, known or not', () => {
    expect(route(auth('no-server'))).toBe('startup');
    expect(route(auth('no-server'), { accounts: accounts() })).toBe('startup');
  });

  it('routes the new stages to their screens', () => {
    expect(route(auth('browser'))).toBe('browser-wait');
    expect(route(auth('verify-email'))).toBe('check-email');
    expect(route(auth('provisioning'))).toBe('provisioning');
    expect(route(auth('update-required'))).toBe('compatibility');
    expect(route(auth('server-too-old'))).toBe('compatibility');
  });

  it('follows the add-account flow, the chooser and the active account', () => {
    expect(route(auth('ready'), { adding: { step: 'choose' } })).toBe('startup');
    expect(route(auth('no-server'), { adding: { step: 'personal' } })).toBe('personal-welcome');
    expect(route(auth('no-server'), { adding: { step: 'enterprise' } })).toBe('enterprise-address');
    expect(route(auth('no-server'), { adding: { step: 'enterprise' }, connect: run })).toBe('checks');
    expect(route(auth('no-server'), { adding: { step: 'enterprise' }, connect: { ...run, state: 'cancelled' } })).toBe('enterprise-address');
    const one = { id: 'acc_aaaaaaaaaaaaaaaaaaaa', kind: 'enterprise' } as AccountView;
    expect(route(auth('signed-out'), { accounts: accounts({ chooserPending: true, accounts: [one] }) })).toBe('chooser');
    // "Always show this at startup": over an account that is signed in too.
    expect(route(auth('ready'), { accounts: accounts({ chooserPending: true, accounts: [one] }) })).toBe('chooser');
    expect(route(auth('signed-out'), { accounts: accounts({ chooserPending: true }) })).toBe('onboarding');
    expect(route(auth('no-server'), { accounts: accounts() })).toBe('startup');
    expect(route(auth('signed-out', { account: { kind: 'enterprise' } as AccountView }))).toBe('branded-sign-in');
    expect(route(auth('expired', { account: { kind: 'personal' } as AccountView }))).toBe('personal-welcome');
  });
});

describe('ConnectRoot', () => {
  it('shows every built screen: no WP0 placeholder is left', () => {
    for (const component of [...wp4Screens, ...wp3Screens]) {
      expect(component, 'exported').toBeTypeOf('function');
      expect(isPlaceholder(component), (component as { name: string }).name).toBe(false);
    }
  });

  it('shows the Personal welcome for Add Account › Personal (WP3)', () => {
    app.set({ prefs: { language: 'en' } as Preferences, accounts: accounts(), session: { mode: 'account', signingIn: false, moveOffer: false, adding: { step: 'personal' } } });
    render(<ConnectRoot auth={auth('no-server')} />);
    expect(screen.getByTestId('connect-frame')).toBeTruthy();
    app.set({ accounts: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
  });

  it('shows the startup selector for Add Account', () => {
    app.set({ prefs: { language: 'en' } as Preferences, accounts: accounts(), session: { mode: 'account', signingIn: false, moveOffer: false, adding: { step: 'choose' } } });
    render(<ConnectRoot auth={auth('no-server')} />);
    expect(screen.getByRole('heading', { name: 'How would you like to use WorkSuite?' })).toBeTruthy();
    app.set({ accounts: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
  });

  it('shows the enterprise address, then the checks once a run starts', () => {
    app.set({ prefs: { language: 'en' } as Preferences, accounts: accounts(), connect: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: { step: 'enterprise' } } });
    const { rerender } = render(<ConnectRoot auth={auth('no-server')} />);
    expect(screen.getByRole('heading', { name: 'Connect to your organization' })).toBeTruthy();
    app.set({ connect: run });
    rerender(<ConnectRoot auth={auth('no-server')} />);
    expect(screen.getByRole('heading', { name: 'Checking ws.example' })).toBeTruthy();
    app.set({ accounts: null, connect: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
  });

  it('keeps the steps after sign-in in Onboarding', () => {
    app.set({ prefs: { language: 'en' } as Preferences });
    render(<ConnectRoot auth={auth('mfa')} />);
    expect(screen.queryByTestId('connect-frame')).toBeNull();
  });
});

describe('ConnectFrame', () => {
  it('draws the title bar, the server’s accent and the content', () => {
    render(
      <ConnectFrame title="WorkSuite — Enterprise · Livezen Technologies" accent="#0E7C86" aside={<div>Hero</div>}>
        <ConnectCard>Sign in</ConnectCard>
      </ConnectFrame>,
    );
    expect(screen.getByText('WorkSuite — Enterprise · Livezen Technologies')).toBeTruthy();
    expect(screen.getByTestId('connect-accent').style.background).toMatch(/0e7c86|rgb\(14, 124, 134\)/i);
    expect(screen.getByText('Hero')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
  });
});
