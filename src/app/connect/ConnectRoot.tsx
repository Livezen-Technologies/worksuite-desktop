import type { AccountsState, AddingAccount } from '@shared/accounts';
import type { BrowserSignIn } from '@shared/cloud';
import type { ConnectRun } from '@shared/discovery';
import type { AuthState } from '@shared/types';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Onboarding } from '../onboarding/Onboarding';
import { BrandedSignIn } from './BrandedSignIn';
import { ChecksScreen } from './ChecksScreen';
import { Compatibility } from './Compatibility';
import { EnterpriseAddress } from './EnterpriseAddress';
import { StartupSelector } from './StartupSelector';
import { WorkspaceChooser } from './WorkspaceChooser';
import { BrowserWait } from './personal/BrowserWait';
import { CheckEmail } from './personal/CheckEmail';
import { PersonalWelcome } from './personal/PersonalWelcome';
import { Provisioning } from './personal/Provisioning';

/**
 * Connection & Startup: which screen the window shows before (or instead of) the workspace — the startup selector,
 * the Personal and Enterprise connect flows, the browser wait, Cloud's email check and setup, the version gates and
 * the workspace chooser — from `auth.stage`, `accounts.chooserPending`, `session.adding` and the connect run.
 *
 * A screen not built yet is a placeholder (`placeholder = true` on its component), and ConnectRoot falls through to
 * the existing Onboarding instead of showing it. The steps after the server is chosen (two-step verification, the
 * device code, the passkey wait, registering, loading) are still Onboarding's.
 */

export type ConnectScreen =
  | 'onboarding'
  | 'startup'
  | 'personal-welcome'
  | 'browser-wait'
  | 'check-email'
  | 'provisioning'
  | 'enterprise-address'
  | 'checks'
  | 'branded-sign-in'
  | 'compatibility'
  | 'chooser';

export interface ConnectRouteState {
  auth: AuthState;
  accounts: AccountsState | null;
  adding: AddingAccount | null | undefined;
  connect: ConnectRun | null;
  signin: BrowserSignIn | null;
}

/** The screen for this state. Pure, for the tests and for the packages that fill the screens in. */
export function connectRoute(s: ConnectRouteState): ConnectScreen {
  const stage = s.auth.stage;
  // An account's own stages come first: they belong to the account being signed in, wherever it was started.
  if (stage === 'browser') return 'browser-wait';
  if (stage === 'verify-email') return 'check-email';
  if (stage === 'provisioning') return 'provisioning';
  if (stage === 'update-required' || stage === 'server-too-old') return 'compatibility';
  if (s.adding) {
    if (s.adding.step === 'enterprise' && s.connect?.target === 'enterprise' && s.connect.state !== 'cancelled') return 'checks';
    if (s.adding.step === 'personal') return 'personal-welcome';
    if (s.adding.step === 'enterprise') return 'enterprise-address';
    return 'startup';
  }
  // The chooser at startup, before any account opens — also over an account that is signed in ("Always show this").
  if (s.accounts?.chooserPending && s.accounts.accounts.length > 0) return 'chooser';
  if (stage === 'ready') return 'onboarding';
  // `no-server`: no active account — the startup selector, Personal or Enterprise. A desktop without accounts gets
  // it too: the enterprise address falls back to `auth:setServer` there.
  if (stage === 'no-server') return 'startup';
  if ((stage === 'signed-out' || stage === 'expired') && s.auth.account) return s.auth.account.kind === 'personal' ? 'personal-welcome' : 'branded-sign-in';
  return 'onboarding';
}

/** A WP0 placeholder screen: not shown, Onboarding is. */
export function isPlaceholder(component: unknown): boolean {
  return (component as { placeholder?: unknown } | null)?.placeholder === true;
}

const SCREENS = {
  startup: StartupSelector,
  'personal-welcome': PersonalWelcome,
  'browser-wait': BrowserWait,
  'check-email': CheckEmail,
  provisioning: Provisioning,
  'enterprise-address': EnterpriseAddress,
  checks: ChecksScreen,
  'branded-sign-in': BrandedSignIn,
  compatibility: Compatibility,
  chooser: WorkspaceChooser,
} as const;

export function ConnectRoot({ auth }: { auth: AuthState }) {
  const accounts = useStore(app, (s) => s.accounts);
  const adding = useStore(app, (s) => s.session.adding ?? null);
  const connect = useStore(app, (s) => s.connect);
  const signin = useStore(app, (s) => s.signin);
  const screen = connectRoute({ auth, accounts, adding, connect, signin });
  if (screen === 'onboarding' || isPlaceholder(SCREENS[screen])) return <Onboarding auth={auth} />;
  switch (screen) {
    case 'startup':
      return <StartupSelector accounts={accounts} />;
    case 'personal-welcome':
      return <PersonalWelcome prefill={adding?.prefill} account={auth.account ?? null} />;
    case 'browser-wait':
      return <BrowserWait attempt={signin ?? auth.browser ?? null} variant={auth.account?.kind === 'enterprise' ? 'enterprise' : 'personal'} accountName={auth.account?.kind === 'enterprise' ? (auth.account.organizationName ?? auth.account.serverName) : null} />;
    case 'check-email':
      return <CheckEmail auth={auth} />;
    case 'provisioning':
      return <Provisioning auth={auth} />;
    case 'enterprise-address':
      return <EnterpriseAddress prefill={adding?.prefill} />;
    case 'checks':
      return connect ? <ChecksScreen run={connect} /> : <Onboarding auth={auth} />;
    case 'branded-sign-in':
      return <BrandedSignIn auth={auth} />;
    case 'compatibility':
      return <Compatibility auth={auth} />;
    case 'chooser':
      return accounts ? <WorkspaceChooser accounts={accounts} /> : <Onboarding auth={auth} />;
  }
}
