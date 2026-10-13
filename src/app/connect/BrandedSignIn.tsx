import { useState } from 'react';
import type { AccountView } from '@shared/accounts';
import type { ConnectRun } from '@shared/discovery';
import type { AuthState, ServerInfo } from '@shared/types';
import { app, startAdding } from '../../core/app-state';
import { call, DesktopError, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { SignInStep } from '../onboarding/Onboarding';
import { AccountBadge } from '../accounts/AccountBadge';
import { accountName, hostOf, inkOn, safeAccent } from '../accounts/labels';
import { ConnectFrame } from './ConnectFrame';

export interface BrandedSignInProps {
  auth: AuthState;
}

/** What the server record may say about its sign-in (the desktop fills these in where it knows them). */
type ServerAuthHints = ServerInfo & { authMode?: 'oidc' | 'legacy'; browserSignIn?: { url: string } | null };

/**
 * Whether this account signs in through the browser: WorkSuite Cloud always (OIDC); an enterprise server when its
 * discovery says `auth.mode: oidc` or offers `browser_sign_in` (Core's AppHandoff) — from the server record, or from
 * the connect run that just added it. Otherwise the in-app password form (legacy servers).
 */
export function signsInWithBrowser(account: AccountView | null | undefined, server: ServerInfo | null | undefined, run: ConnectRun | null | undefined): boolean {
  if (account?.deployment === 'CLOUD' || account?.kind === 'personal') return true;
  const hints = server as ServerAuthHints | null | undefined;
  if (hints?.authMode === 'oidc' || hints?.browserSignIn) return true;
  const found = run?.server;
  if (found && account && hostOf(found.origin) === hostOf(account.serverOrigin)) return found.authMode === 'oidc' || !!found.browserSignIn;
  return false;
}

/**
 * Screen 8 — the organization's own sign-in: its logo and accent colour from the server's discovery, its name and
 * address (verified when the discovery was signed). Servers with a browser sign-in open it there (the wait screen is
 * BrowserWait's); older servers keep the in-app form (SignInStep) with its CAPTCHA, wait and passkey hand-off.
 */
export function BrandedSignIn({ auth }: BrandedSignInProps) {
  const run = useStore(app, (s) => s.connect);
  const account = auth.account ?? null;
  const [forceForm, setForceForm] = useState(false);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = account ? accountName(account) : (auth.server?.name ?? 'WorkSuite');
  const host = hostOf(account?.serverOrigin ?? auth.server?.origin);
  const accent = safeAccent(account?.branding.accent);
  const browser = !forceForm && signsInWithBrowser(account, auth.server, run);
  const locked = !!auth.server?.locked || !!account?.managed;

  const signIn = async () => {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await call('signin:start', { accountId: account.id, method: null, purpose: auth.stage === 'expired' ? 'reauth' : 'sign-in', ...(auth.user?.email ? { loginHint: auth.user.email } : {}) });
      app.set({ signin: attempt });
    } catch (e) {
      // A desktop or server without the browser sign-in: the form, as before.
      if (e instanceof DesktopError && e.code === 'UNSUPPORTED') setForceForm(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConnectFrame title={`WorkSuite — Enterprise · ${name}`} accent={accent}>
      <section aria-labelledby="branded-title" className="flex w-[480px] max-w-full flex-col items-center gap-4 rounded-[18px] border border-line bg-surface p-11 text-center">
        {account ? <AccountBadge account={account} size={72} className="!rounded-[18px] text-[28px]" /> : null}
        <h1 id="branded-title" className="m-0 text-[26px] font-extrabold text-ink">
          {name} WorkSuite
        </h1>
        <div className={cx('flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[13px]', account?.signed ? 'bg-success-bg text-success' : 'bg-subtle text-ink-2')}>
          <Icon name={account?.signed ? 'shield-check' : 'server'} size={14} />
          <span className="truncate font-mono">{host}</span>
          {account?.signed ? <span>· verified</span> : null}
        </div>
        {auth.message ? <p className="m-0 w-full rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-ink">{auth.message}</p> : null}
        {browser ? (
          <>
            <p className="m-0 text-[14px] leading-relaxed text-ink-3">Sign in with your company account. Your organization’s sign-in page opens in your browser — Microsoft Entra ID, Google Workspace, passkey or SSO, as your IT team set it up.</p>
            <button
              type="button"
              autoFocus
              disabled={busy || !account}
              onClick={() => void signIn()}
              className={cx('flex h-12 w-full items-center justify-center gap-2 rounded-[10px] text-[15px] font-bold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ws-focus)] disabled:opacity-60', !accent && 'bg-primary text-white hover:bg-primary-hover')}
              style={accent ? { background: accent, color: inkOn(accent) } : undefined}
            >
              {busy ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : null}
              Sign in
            </button>
            {error ? (
              <p role="alert" className="m-0 text-[13px] text-danger">
                {error}
              </p>
            ) : null}
          </>
        ) : (
          <div className="w-full text-left">
            <SignInStep auth={auth} hideServer onChangeServer={() => startAdding('enterprise')} />
          </div>
        )}
        <div className="flex gap-4 text-[13px]">
          {!locked ? (
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => startAdding('enterprise')}>
              Use a different server
            </button>
          ) : null}
          <button type="button" className="font-semibold text-primary hover:underline" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
            Server details
          </button>
        </div>
        {details ? (
          <dl className="m-0 grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[10px] bg-subtle px-4 py-3 text-left text-[12.5px]" data-testid="server-details">
            <dt className="text-ink-3">Server</dt>
            <dd className="m-0 truncate text-ink">{account?.serverName ?? auth.server?.name ?? '—'}</dd>
            <dt className="text-ink-3">Address</dt>
            <dd className="m-0 truncate font-mono text-ink">{account?.serverOrigin ?? auth.server?.origin ?? '—'}</dd>
            {account?.apiOrigin && account.apiOrigin !== account.serverOrigin ? (
              <>
                <dt className="text-ink-3">API</dt>
                <dd className="m-0 truncate font-mono text-ink">{account.apiOrigin}</dd>
              </>
            ) : null}
            <dt className="text-ink-3">Signature</dt>
            <dd className="m-0 text-ink">{account?.signed ? 'Signed and verified' : 'Not configured'}</dd>
            {account?.serverId ? (
              <>
                <dt className="text-ink-3">Server ID</dt>
                <dd className="m-0 truncate font-mono text-ink">{account.serverId}</dd>
              </>
            ) : null}
            {account?.managed ? (
              <>
                <dt className="text-ink-3">Managed</dt>
                <dd className="m-0 text-ink">Set up by your organization</dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </section>
    </ConnectFrame>
  );
}
