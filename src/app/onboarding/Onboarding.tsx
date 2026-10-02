import { toast } from '../../core/toasts';
import { GuestJoinForm } from '../../modules/meet/GuestJoinForm';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthState } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage, isMac, on } from '../../core/bridge';
import { t, LANGUAGES, useLanguage } from '../../core/i18n';
import { Select } from '../../components/Select';
import { updatePrefs } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { Button, TextField, cx } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';

/**
 * Welcome, server selection, sign-in and two-step verification (UI-01,
 * UI-02, WF-01 steps 1–5). Everything that can fail says what to do next.
 */
export function Onboarding({ auth }: { auth: AuthState }) {
  const language = useLanguage();
  const [guest, setGuest] = useState(false);
  const [destination, setDestination] = useState<{ input: string; server?: string } | null>(null);
  useEffect(() => {
    let mounted = true;
    const receive = (next: { input: string; server?: string } | null) => { if (mounted && next) { setDestination(next); setGuest(true); } };
    void call('guest:pending').then(receive, () => undefined);
    const off = on('guest:destination', receive);
    return () => { mounted = false; off(); };
  }, []);
  return (
    <div className="drag flex h-full items-center justify-center bg-navy p-6">
      <div className="no-drag w-[440px] rounded-[16px] bg-surface p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-brand text-[16px] font-extrabold text-white">W</span>
          <span className="text-[18px] font-bold text-ink">WorkSuite</span>
        </div>
        <Select label="Language" aria-label="Choose your language" className="mb-4 w-full" value={language} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} onValueChange={(value) => void updatePrefs({ language: value }).catch((e) => toast('error', errorMessage(e)))} />
        {language !== 'en' ? <p className="mb-4 text-xs text-ink-3">Some screens still use English.</p> : null}
        {(auth.stage === 'no-server' || auth.stage === 'signed-out' || auth.stage === 'expired') ? <div className="mb-4">
          <Button className="w-full" variant="secondary" icon="user" onClick={() => void call('local:open').catch((e) => toast('error', errorMessage(e)))}>Continue as Guest</Button>
          <p className="mt-1 text-center text-[12px] text-ink-3">Notes, Tasks and Calendar in a Local Profile saved on this device. No account or email needed.</p>
        </div> : null}
        {guest ? <GuestJoinForm key={destination?.input} initialInput={destination?.input} server={destination?.server ?? auth.server?.origin} onBack={() => setGuest(false)} /> : null}
        {!guest ? <>
        {auth.stage === 'no-server' ? <ServerStep /> : null}
        {auth.stage === 'signed-out' || auth.stage === 'expired' ? <SignInStep auth={auth} /> : null}
        {auth.stage === 'mfa' ? <MfaStep /> : null}
        {auth.stage === 'passkey' ? <PasskeyStep auth={auth} /> : null}
        {auth.stage === 'registering' || auth.stage === 'bootstrapping' ? <Progress stage={auth.stage} /> : null}
        {auth.stage === 'blocked' || auth.stage === 'revoked' ? <Stopped auth={auth} /> : null}
        {(auth.stage === 'no-server' || auth.stage === 'signed-out' || auth.stage === 'expired') ? <Button className="mt-4 w-full" variant="secondary" onClick={() => setGuest(true)}>Join a Meeting</Button> : null}
        </> : null}
      </div>
      {isMac ? null : <div className="drag absolute top-0 right-0 left-0 h-10" />}
    </div>
  );
}

function ServerStep() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('auth:setServer', { url });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <div>
        <h1 className="text-[22px] font-bold text-ink">{t('auth.serverTitle')}</h1>
        <p className="mt-1 text-[13.5px] text-ink-3">{t('auth.serverHint')}</p>
      </div>
      <TextField label="Server address" placeholder="app.yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus error={error} spellCheck={false} autoCapitalize="off" />
      <Button variant="primary" size="lg" type="submit" loading={busy} disabled={!url.trim()}>
        {t('auth.continue')}
      </Button>
      <p className="text-[12px] text-ink-3">WorkSuite connects only over HTTPS and never ignores a certificate error.</p>
    </form>
  );
}

function SignInStep({ auth }: { auth: AuthState }) {
  const [email, setEmail] = useState(auth.user?.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const host = auth.server ? new URL(auth.server.origin).host : '';
  const startPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      await call('auth:passkeyStart');
    } catch (e) {
      setPasskeyError(errorMessage(e));
    } finally {
      setPasskeyBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('auth:signIn', { email, password });
    } catch (e) {
      setError(errorMessage(e));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <div>
        <h1 className="text-[22px] font-bold text-ink">{t('auth.signIn')}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-[13.5px] text-ink-3">
          <Icon name="server" size={14} /> {auth.server?.name && auth.server.name !== host ? `${auth.server.name} · ` : ''}
          {host}
          {!auth.server?.locked ? (
            <button type="button" className="ml-1 font-semibold text-primary hover:underline" onClick={() => void call('auth:setServer', { url: '' })}>
              Change
            </button>
          ) : null}
        </p>
      </div>
      {auth.message ? <div className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">{auth.message}</div> : null}
      <TextField label={t('auth.email')} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!email} />
      <TextField label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!!email} error={error} />
      <Button variant="primary" size="lg" type="submit" loading={busy} disabled={!email || !password}>
        {t('auth.signIn')}
      </Button>
      <button type="button" className="text-left text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void call('auth:openPage', { page: 'forgot-password' }).catch((e: unknown) => setError(errorMessage(e)))}>
        Forgot your password?
      </button>
      {auth.server?.passkey ? (
        <>
          <div className="flex items-center gap-3 text-[11.5px] text-ink-3" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <Button variant="secondary" size="lg" type="button" icon="fingerprint" loading={passkeyBusy} onClick={() => void startPasskey()}>
            Sign in with a passkey
          </Button>
          {passkeyError ? <p className="text-[12.5px] text-danger">{passkeyError}</p> : null}
        </>
      ) : null}
    </form>
  );
}

/**
 * Waiting for the browser. A passkey works only on a page from the server's own
 * address, so the ceremony happens in the person's browser (Touch ID, Windows
 * Hello, a phone or a security key) and the result comes back here through
 * worksuite://auth/callback. Nothing to type, so this screen only says where
 * to look and offers a way back.
 */
function PasskeyStep({ auth }: { auth: AuthState }) {
  const host = auth.server ? new URL(auth.server.origin).host : '';
  const [busy, setBusy] = useState(false);
  // Nothing back after a minute is, most often, an account with no passkey for this server:
  // Windows Hello then has nothing to offer, and says so only in the browser (QA-006).
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 60_000);
    return () => clearTimeout(t);
  }, []);
  const again = async () => {
    setBusy(true);
    try {
      await call('auth:passkeyStart');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-bold text-ink">Continue in your browser</h1>
        <p className="mt-1 text-[13.5px] text-ink-3">
          {host} opened in your browser. Use your passkey there — Touch ID, Windows Hello, your phone or a security key — and WorkSuite will finish signing you in here.
        </p>
      </div>
      <div className="flex items-center gap-2.5 rounded-[10px] bg-subtle px-3.5 py-3 text-[12.5px] text-ink-2">
        <Icon name="spinner" size={16} className="animate-spin-slow" /> Waiting for your passkey…
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" type="button" icon="external" loading={busy} onClick={() => void again()}>
          Open the browser again
        </Button>
        <Button variant="ghost" type="button" onClick={() => void call('auth:passkeyCancel')}>
          Use my password instead
        </Button>
      </div>
      {slow ? (
        <p className="rounded-[10px] bg-warning-bg px-3.5 py-2.5 text-[12.5px] text-[#7A4308] dark:text-warning">
          Nothing yet? A passkey works only once it has been added to your WorkSuite account for {host} — in the web app, under My account › Security. If Windows Hello said it found no passkey, add one there, or use your password.
        </p>
      ) : null}
      <p className="text-[12px] text-ink-3">If your browser asks whether to open WorkSuite, allow it. The sign-in expires after five minutes.</p>
    </div>
  );
}

function MfaStep() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (value = code) => {
    setBusy(true);
    setError(null);
    try {
      await call('auth:verifyMfa', { code: value.replace(/\s+/g, '') });
    } catch (e) {
      setError(errorMessage(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <div>
        <h1 className="text-[22px] font-bold text-ink">{t('auth.mfaTitle')}</h1>
        <p className="mt-1 text-[13.5px] text-ink-3">{t('auth.mfaHint')}</p>
      </div>
      <TextField
        label="Code"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          if (/^\d{6}$/.test(e.target.value)) void submit(e.target.value);
        }}
        autoFocus
        error={error}
        className="font-mono"
      />
      <Button variant="primary" size="lg" type="submit" loading={busy} disabled={code.length < 6}>
        {t('auth.verify')}
      </Button>
      <button type="button" className="text-left text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void call('auth:cancelMfa')}>
        Use a different account
      </button>
    </form>
  );
}

function Progress({ stage }: { stage: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Icon name="spinner" size={26} className="animate-spin-slow text-primary" />
      <div className="text-[15px] font-semibold text-ink">{stage === 'registering' ? 'Registering this computer…' : 'Loading your workspace…'}</div>
      <p className="text-[12.5px] text-ink-3">{stage === 'registering' ? 'WorkSuite registers each computer so your organization can see and manage it.' : 'Checking your apps, permissions and policies.'}</p>
    </div>
  );
}

function Stopped({ auth }: { auth: AuthState }) {
  return (
    <div className="flex flex-col gap-4">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-danger">
        <Icon name={auth.stage === 'revoked' ? 'shield-alert' : 'lock'} size={22} />
      </span>
      <div>
        <h1 className="text-[20px] font-bold text-ink">{auth.stage === 'revoked' ? 'This computer was removed from WorkSuite' : 'WorkSuite Desktop is not available'}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{auth.message ?? 'Your organization has turned off WorkSuite Desktop for this account or computer.'}</p>
        {auth.stage === 'revoked' ? <p className="mt-2 text-[12.5px] text-ink-3">WorkSuite's data on this computer has been removed. Files you saved yourself were not touched.</p> : null}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void call('auth:openPage', { page: 'account' }).catch(() => undefined)} icon="external">
          Open WorkSuite in browser
        </Button>
        <Button variant="primary" onClick={() => void call('auth:signOut', { wipe: false })}>
          Sign in again
        </Button>
      </div>
    </div>
  );
}

/**
 * First-run setup (UI-03, WF-01 steps 6–9). The step rail follows the design;
 * WorkSuite Drive and the monitoring acknowledgement join it when those
 * features ship (and the monitoring step only ever appears when a policy is
 * assigned).
 */
const STEPS = ['Server & sign in', 'Register device', 'Organization', 'Notifications', 'Startup', 'Finish'] as const;

export function SetupWizard() {
  const b = useStore(app, (s) => s.bootstrap);
  const prefs = useStore(app, (s) => s.prefs);
  const firstStep = (b?.organizations.length ?? 0) > 1 ? 2 : 3;
  const [step, setStep] = useState(firstStep);
  const [org, setOrg] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState(prefs?.notificationPrivacy ?? 'SENDER_ONLY');
  const [startWithOs, setStartWithOs] = useState(prefs?.startWithOs ?? true);
  const [startMinimized, setStartMinimized] = useState(prefs?.startMinimized ?? false);
  const [toTray, setToTray] = useState(prefs?.minimizeToTray ?? true);
  const tested = useRef(false);
  const orgs = b?.organizations ?? [];

  const finish = async () => {
    await call('settings:set', { notificationPrivacy: privacy, startWithOs, startMinimized, minimizeToTray: toTray });
    if (org !== null) await call('session:switchOrganization', { organizationId: org }).catch(() => undefined);
    await call('auth:completeSetup');
  };

  return (
    <div className="drag flex h-full items-center justify-center bg-ground p-6">
      <div className="no-drag flex h-[600px] w-[900px] overflow-hidden rounded-[16px] border border-line bg-surface shadow-xl">
        <aside className="w-[270px] shrink-0 bg-navy p-7 text-white">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-brand text-[15px] font-extrabold">W</span>
            <span className="text-[16px] font-bold">Set up WorkSuite</span>
          </div>
          <ol className="flex flex-col gap-4">
            {STEPS.map((s, i) => (
              <li key={s} className={cx('flex items-center gap-3 text-[14px]', i === step ? 'font-semibold text-white' : i < step ? 'text-navy-ink' : 'text-navy-ink/60')}>
                <span className={cx('flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold', i < step ? 'bg-success text-white' : i === step ? 'bg-white text-navy' : 'border border-white/25')}>{i < step ? <Icon name="check" size={14} /> : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col p-9">
          <div className="text-[12.5px] font-bold uppercase tracking-wide text-teal">
            Step {step + 1} of {STEPS.length}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {step === 2 ? (
              <WizardStep title="Organization" hint="You belong to more than one organization. Choose what WorkSuite shows first — you can switch at any time from the top bar.">
                <div className="flex flex-col gap-2">
                  {[{ id: null as string | null, name: 'All organizations' }, ...orgs].map((o) => (
                    <ChoiceCard key={o.id ?? 'all'} selected={org === o.id} onClick={() => setOrg(o.id)} title={o.name} />
                  ))}
                </div>
              </WizardStep>
            ) : null}
            {step === 3 ? (
              <WizardStep title="Notifications" hint="Choose how much a notification shows on your screen. Your organization may require more privacy.">
                <div className="flex flex-col gap-2">
                  <ChoiceCard selected={privacy === 'FULL'} onClick={() => setPrivacy('FULL')} title="Show full content" hint="Sender and message preview." />
                  <ChoiceCard selected={privacy === 'SENDER_ONLY'} onClick={() => setPrivacy('SENDER_ONLY')} title="Show sender only" hint="Who it is from, not what it says." />
                  <ChoiceCard selected={privacy === 'GENERIC'} onClick={() => setPrivacy('GENERIC')} title='Show "New WorkSuite notification"' hint="Nothing about the content." />
                </div>
                <Button
                  className="mt-4"
                  icon="bell"
                  onClick={() => {
                    tested.current = true;
                    void call('notifications:test');
                  }}
                >
                  Send a test notification
                </Button>
              </WizardStep>
            ) : null}
            {step === 4 ? (
              <WizardStep title="Startup" hint="WorkSuite can keep notifications and transfers running in the background.">
                <Toggle label="Start WorkSuite when I sign in to this computer" checked={startWithOs} onChange={setStartWithOs} />
                <Toggle label="Start minimized to the tray" checked={startMinimized} onChange={setStartMinimized} />
                <Toggle label="Closing the window keeps WorkSuite running in the tray" checked={toTray} onChange={setToTray} />
              </WizardStep>
            ) : null}
            {step === 5 ? (
              <WizardStep title="You're all set" hint="WorkSuite is ready. Your apps are in the sidebar; press the search shortcut to find anything.">
                <ul className="flex flex-col gap-2 text-[13.5px] text-ink-2">
                  <li className="flex items-center gap-2">
                    <Icon name="check-circle" size={16} className="text-success" /> This computer is registered with your organization.
                  </li>
                  <li className="flex items-center gap-2">
                    <Icon name="check-circle" size={16} className="text-success" /> Your sign-in is kept in the system's secure storage.
                  </li>
                  <li className="flex items-center gap-2">
                    <Icon name="info" size={16} className="text-primary" /> No activity monitoring policy is assigned to you.
                  </li>
                </ul>
              </WizardStep>
            ) : null}
          </div>
          <div className="flex items-center gap-2 pt-4">
            {step > firstStep ? (
              <Button size="lg" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : null}
            <div className="flex-1" />
            {step < 5 ? (
              <Button variant="primary" size="lg" onClick={() => setStep((s) => s + 1)}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => void finish()}>
                Open WorkSuite
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function WizardStep({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="pt-2">
      <h1 className="text-[28px] font-bold text-ink">{title}</h1>
      <p className="mt-2 mb-6 text-[15px] leading-relaxed text-ink-2">{hint}</p>
      {children}
    </div>
  );
}

function ChoiceCard({ selected, onClick, title, hint }: { selected: boolean; onClick: () => void; title: string; hint?: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick} className={cx('flex items-center gap-4 rounded-[12px] border px-5 py-3.5 text-left', selected ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
      <span className={cx('flex h-5 w-5 items-center justify-center rounded-full border-2', selected ? 'border-primary' : 'border-ink-3')}>{selected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}</span>
      <span>
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        {hint ? <span className="block text-[13px] text-ink-3">{hint}</span> : null}
      </span>
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-[10px] border border-line px-4 py-3 text-[14px] text-ink hover:bg-subtle">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
