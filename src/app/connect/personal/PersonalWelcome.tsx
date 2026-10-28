import { useState, type FormEvent, type ReactNode } from 'react';
import type { AccountView } from '@shared/accounts';
import type { BrowserSignIn, IdpHint } from '@shared/cloud';
import { CLOUD_ORIGIN, type ConnectRun } from '@shared/discovery';
import { DEFAULT_STARTUP, signupMode, visibleCredentials, type StartupConfig, type StartupMethod } from '@shared/startup-config';
import { app } from '../../../core/app-state';
import { call, errorMessage } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { ConnectFrame } from '../ConnectFrame';
import { InAppSignUp } from './InAppSignUp';

export interface PersonalWelcomeProps {
  /** An email to start from (the optional login hint). */
  prefill?: string;
  /** The Personal account being signed in again, when there is one. */
  account: AccountView | null;
}

const TITLE = 'WorkSuite — Personal · WorkSuite Cloud';
const GiB = 1024 * 1024 * 1024;

/** "2 GB": the free plan's storage, from the discovery document. */
function gb(bytes: number): string {
  const n = bytes / GiB;
  return `${Number(n.toFixed(n >= 10 ? 0 : 1))} GB`;
}

/** Waits for a connect run to end: from `connect:progress` in the store, else by asking. */
async function finished(runId: string, timeoutMs = 60_000): Promise<ConnectRun> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const seen = app.get().connect;
    const run = seen?.runId === runId && seen.state !== 'running' ? seen : await call('connect:get', { runId });
    if (run.state !== 'running') return run;
    if (Date.now() > until) throw new Error('WorkSuite Cloud is taking too long to answer. Try again.');
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * The Personal account to sign in to: the one being signed in again, or a new one — WorkSuite Cloud checked like any
 * server (discovery, its Livezen signature, health) and added, signed out — before the browser opens.
 */
async function personalAccount(account: AccountView | null): Promise<string> {
  if (account) return account.id;
  const { runId } = await call('connect:start', { input: CLOUD_ORIGIN, target: 'personal' });
  const run = await finished(runId);
  if (run.state !== 'ok') throw new Error(run.failure?.message ?? 'WorkSuite Cloud could not be reached. Try again.');
  const view = await call('connect:confirm', { runId });
  return view.id;
}

/** The sign-in buttons' marks: plain letters in the providers' colours, no logos (theme tokens for the rest). */
const PROVIDERS: Array<{ id: IdpHint; label: string; mark: ReactNode }> = [
  { id: 'google', label: 'Google', mark: <span className="text-[15px] font-black text-[#4285F4]">G</span> },
  {
    id: 'microsoft',
    label: 'Microsoft',
    mark: (
      <span className="grid grid-cols-2 gap-[2px]" aria-hidden="true">
        <span className="h-[7px] w-[7px] bg-[#F25022]" />
        <span className="h-[7px] w-[7px] bg-[#7FBA00]" />
        <span className="h-[7px] w-[7px] bg-[#00A4EF]" />
        <span className="h-[7px] w-[7px] bg-[#FFB900]" />
      </span>
    ),
  },
  { id: 'apple', label: 'Apple', mark: <Icon name="laptop" size={16} className="text-ink" /> },
  { id: 'passkey', label: 'Passkey', mark: <Icon name="fingerprint" size={16} className="text-primary" /> },
];

/**
 * Screen 2 — Personal welcome: sign in or create a free account in the browser (email, Google, Microsoft, Apple,
 * passkey). Every option starts OneAuth's code flow with PKCE and an `idp_hint`; WorkSuite Desktop never sees a
 * password. [WP3]
 */
export function PersonalWelcome({ prefill, account }: PersonalWelcomeProps) {
  const adding = useStore(app, (s) => s.session.adding ?? null);
  const run = useStore(app, (s) => (s.connect?.target === 'personal' ? s.connect : null));
  const [email, setEmail] = useState(prefill ?? account?.user?.email ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The account row the in-app sign-up belongs to; set when `Create Free Account` opens it. */
  const [creating, setCreating] = useState<string | null>(null);

  const startup: StartupConfig = run?.server?.startup ?? DEFAULT_STARTUP;
  const credentials = visibleCredentials(startup);
  const buttons = PROVIDERS.filter((p) => credentials.includes(p.id as StartupMethod)).sort((a, b) => credentials.indexOf(a.id as StartupMethod) - credentials.indexOf(b.id as StartupMethod));
  const emailOn = credentials.includes('email');
  const signup = signupMode(startup, run?.server?.signup ?? true);
  const words = startup.text;
  const freeBytes = run?.server?.plans?.freeBytes ?? 2 * GiB;
  const host = (() => {
    try {
      return new URL(account?.serverOrigin ?? run?.server?.origin ?? CLOUD_ORIGIN).host;
    } catch {
      return 'worksuitecloud.com';
    }
  })();
  const verified = account?.signed ?? run?.server?.signed ?? true;

  const start = async (method: IdpHint | null, purpose: BrowserSignIn['purpose'], key: string) => {
    setBusy(key);
    setError(null);
    try {
      const accountId = await personalAccount(account);
      const hint = email.trim();
      await call('signin:start', { accountId, method, purpose, ...(hint ? { loginHint: hint } : {}) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /**
   * `Create Free Account`. In the app when the server publishes that mode: the Personal account row is made first,
   * exactly as a sign-in makes it, and the sign-up screens take over. Otherwise it is the browser, as before.
   */
  const createAccount = async () => {
    if (signup !== 'in_app') return start(email.trim() ? 'email' : null, 'sign-up', 'sign-up');
    setBusy('sign-up');
    setError(null);
    try {
      setCreating(await personalAccount(account));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    void start('email', 'sign-in', 'email');
  };

  const back = () => {
    const s = app.get().session;
    app.set({ session: { ...s, adding: { step: 'choose' } } });
  };

  const hero = (
    <>
      {adding ? (
        <button type="button" onClick={back} className="self-start text-[14px] text-stage-accent hover:underline">
          ← Back to choices
        </button>
      ) : (
        <span />
      )}
      <div className="flex flex-col gap-4">
        <div className="text-[12px] font-bold tracking-[2px] text-stage-accent">WORKSUITE CLOUD</div>
        <div className="text-[36px] leading-[1.15] font-extrabold">Your own workspace, on every device.</div>
        <div className="text-[15px] leading-[1.6] text-navy-ink">Mail, Chat, Calendar, Tasks, Files, DOC, Sheet and Slides — synced between Windows, macOS, Linux, the web and your phone.</div>
        <div className="mt-2 flex flex-wrap gap-2.5">
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-[13px]">WorkSuite Professional · Free</span>
          <span className="rounded-full bg-teal/35 px-3 py-1.5 text-[13px]">{gb(freeBytes)} storage</span>
        </div>
      </div>
      <div className="font-mono text-[12px] text-stage-accent">
        {host}
        {verified ? ' · verified by Livezen key' : ''}
      </div>
    </>
  );

  const idle = busy === null;
  if (creating)
    return (
      <ConnectFrame title={TITLE} aside={hero}>
        <InAppSignUp accountId={creating} prefill={email.trim() || undefined} onBack={() => setCreating(null)} />
      </ConnectFrame>
    );
  return (
    <ConnectFrame title={TITLE} aside={hero}>
      <form onSubmit={onEmail} className="flex w-[400px] max-w-full flex-col gap-3.5" aria-label="Sign in to WorkSuite Cloud">
        <h1 className="m-0 text-[28px] font-extrabold text-ink">{words.title ?? (account || !adding ? 'Welcome back' : 'Sign in to WorkSuite Cloud')}</h1>
        <p className="m-0 mb-1.5 text-[14px] text-ink-3">{words.subtitle ?? (signup === 'in_app' ? 'Sign in with your WorkSuite Cloud account, or create one here.' : 'Sign-in opens in your browser. WorkSuite Desktop never sees your password.')}</p>
        {emailOn ? (
          <>
        <label htmlFor="personal-email" className="text-[13px] font-semibold text-ink">
          Email (optional)
        </label>
        <input
          id="personal-email"
          type="email"
          autoComplete="email"
          value={email}
          maxLength={320}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 rounded-[10px] border border-line bg-surface px-3.5 text-[14px] text-ink outline-none focus:border-primary"
        />
        <button type="submit" disabled={!idle} className="flex h-[46px] items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
          {busy === 'email' ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : null}
          Continue with email
        </button>
          </>
        ) : null}
        {emailOn && buttons.length > 1 ? (
          <div className="flex items-center gap-3 text-[12px] text-ink-3">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2.5">
          {buttons.filter((p) => p.id !== 'email').map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!idle}
              onClick={() => void start(p.id, 'sign-in', p.id)}
              className={cx('flex h-11 items-center justify-center gap-2 rounded-[10px] border border-line bg-surface text-[14px] font-semibold text-ink hover:bg-subtle disabled:opacity-60')}
            >
              {busy === p.id ? <Icon name="spinner" size={15} className="animate-spin-slow" /> : p.mark}
              {p.label}
            </button>
          ))}
        </div>
        {error ? (
          <div role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
            {error}
          </div>
        ) : null}
        {signup === 'off' ? null : (
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-[12px] border border-line bg-surface p-4">
          <span className="text-[14px] text-ink">Don't have an account?</span>
          <button type="button" disabled={!idle} onClick={() => void createAccount()} className="flex items-center gap-2 rounded-[10px] bg-teal px-4 py-2.5 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-60">
            {busy === 'sign-up' ? <Icon name="spinner" size={15} className="animate-spin-slow" /> : null}
            Create Free Account
          </button>
        </div>
        )}
        <button type="button" onClick={() => void call('cloud:openWeb', { page: 'forgot' }).catch(() => undefined)} className="self-start text-[13px] text-primary hover:underline">
          Forgot password?
        </button>
      </form>
    </ConnectFrame>
  );
}
