// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountsState, AccountView } from '@shared/accounts';
import type { ConnectRun } from '@shared/discovery';
import type { AuthState, Preferences } from '@shared/types';

/**
 * Connection & Startup's renderer skeleton (WP0): ConnectRoot's routing, and that it changes nothing for anyone
 * today — every screen still to be built falls through to the existing Onboarding.
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
const screens = [
  await import('../../../src/app/connect/StartupSelector'),
  await import('../../../src/app/connect/EnterpriseAddress'),
  await import('../../../src/app/connect/QrScan'),
  await import('../../../src/app/connect/ChecksScreen'),
  await import('../../../src/app/connect/BrandedSignIn'),
  await import('../../../src/app/connect/Compatibility'),
  await import('../../../src/app/connect/WorkspaceChooser'),
  await import('../../../src/app/connect/UnknownServerLink'),
  await import('../../../src/app/connect/personal/PersonalWelcome'),
  await import('../../../src/app/connect/personal/BrowserWait'),
  await import('../../../src/app/connect/personal/CheckEmail'),
  await import('../../../src/app/connect/personal/Provisioning'),
];

const auth = (stage: AuthState['stage'], extra: Partial<AuthState> = {}): AuthState => ({ stage, server: null, user: null, message: null, setupPending: false, ...extra });
const accounts = (extra: Partial<AccountsState> = {}): AccountsState => ({ accounts: [], activeId: null, switching: null, chooserPending: false, chooserAlways: false, allowPersonal: true, allowAddEnterprise: true, guestAvailable: true, ...extra });
const run = { runId: 'run_12345678', input: 'ws.example', target: 'enterprise', host: 'ws.example', candidates: [], steps: [], state: 'running', server: null, failure: null } as ConnectRun;
const route = (a: AuthState, more: Partial<Parameters<typeof connectRoute>[0]> = {}) => connectRoute({ auth: a, accounts: null, adding: null, connect: null, signin: null, ...more });

afterEach(() => cleanup());

describe('connectRoute', () => {
  it('leaves every stage there is today to Onboarding while accounts are not known', () => {
    for (const stage of ['no-server', 'signed-out', 'mfa', 'device-code', 'passkey', 'registering', 'bootstrapping', 'expired', 'blocked', 'revoked'] as const) {
      expect(route(auth(stage)), stage).toBe('onboarding');
    }
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
    expect(route(auth('signed-out'), { accounts: accounts({ chooserPending: true }) })).toBe('chooser');
    expect(route(auth('no-server'), { accounts: accounts() })).toBe('startup');
    expect(route(auth('signed-out', { account: { kind: 'enterprise' } as AccountView }))).toBe('branded-sign-in');
    expect(route(auth('expired', { account: { kind: 'personal' } as AccountView }))).toBe('personal-welcome');
  });
});

describe('ConnectRoot', () => {
  it('marks every WP0 screen as a placeholder', () => {
    for (const mod of screens) {
      const [component] = Object.values(mod).filter((v) => typeof v === 'function');
      expect(isPlaceholder(component)).toBe(true);
    }
  });

  it('shows the existing Onboarding, whatever the route, until the screens land', () => {
    app.set({ prefs: { language: 'en' } as Preferences, accounts: accounts(), session: { mode: 'account', signingIn: false, moveOffer: false, adding: { step: 'choose' } } });
    render(<ConnectRoot auth={auth('no-server')} />);
    expect(screen.getByText('Continue as Guest')).toBeTruthy();
    expect(screen.queryByTestId('connect-frame')).toBeNull();
    app.set({ accounts: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
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
