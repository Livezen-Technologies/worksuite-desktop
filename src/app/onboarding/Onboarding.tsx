import { toast } from '../../core/toasts';
import { GuestJoinForm } from '../../modules/meet/GuestJoinForm';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthState } from '@shared/types';
import { app, startAdding } from '../../core/app-state';
import { backToGuest, enterGuestMode } from '../../core/session';
import { call, errorMessage, isMac, on } from '../../core/bridge';
import { t, LANGUAGES, useLanguage } from '../../core/i18n';
import { Select } from '../../components/Select';
import { updatePrefs } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { Button, TextField, cx } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { useNow } from '../../core/use-now';
import { BlockedPanel, CaptchaBox, DeviceCodeStep, gateFor, WaitPanel } from './SignInProtection';
import { BrandLogo, BrandMark } from '../../components/BrandMark';

/**
 * Welcome, sign-in and two-step verification (UI-01, UI-02, WF-01 steps 1–5). Everything that can fail says what to
 * do next. Choosing a server is Connection & Startup's now (the startup selector and the enterprise address, screens
 * 1 and 6); this keeps the steps after it, and the password form for servers without a browser sign-in.
 */
export function Onboarding({ auth }: { auth: AuthState }) {
  const language = useLanguage();
  // Signing in from guest mode (#149): guest mode is still open behind this screen.
  const fromGuest = useStore(app, (s) => s.session.mode === 'guest' && s.session.signingIn);
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
          <BrandLogo height={36} />
        </div>
        <Select label="Language" aria-label="Choose your language" className="mb-4 w-full" value={language} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} onValueChange={(value) => void updatePrefs({ language: value }).catch((e) => toast('error', errorMessage(e)))} />
        {language !== 'en' ? <p className="mb-4 text-xs text-ink-3">Some screens still use English.</p> : null}
        {(auth.stage === 'no-server' || auth.stage === 'signed-out' || auth.stage === 'expired') ? <div className="mb-4">
          {fromGuest ? <Button className="w-full" variant="secondary" icon="chevron-left" onClick={backToGuest}>Back to your Local Profile</Button> : <Button className="w-full" variant="secondary" icon="user" onClick={() => void enterGuestMode().catch((e) => toast('error', errorMessage(e)))}>Continue as Guest</Button>}
          <p className="mt-1 text-center text-[12px] text-ink-3">{fromGuest ? 'Sign in or create an account on your WorkSuite server. You can move your local data to it afterwards.' : 'Notes, Tasks, Contacts and Calendar in a Local Profile saved on this device. No account or email needed.'}</p>
        </div> : null}
        {guest ? <GuestJoinForm key={destination?.input} initialInput={destination?.input} server={destination?.server ?? auth.server?.origin} onBack={() => setGuest(false)} /> : null}
        {!guest ? <>
        {/* No account yet: the startup selector (Connection & Startup screen 1) chooses Personal or Enterprise. */}
        {auth.stage === 'no-server' ? <Button className="w-full" variant="primary" size="lg" onClick={() => startAdding('choose')}>Add an account</Button> : null}
        {auth.stage === 'signed-out' || auth.stage === 'expired' ? <SignInStep auth={auth} /> : null}
        {auth.stage === 'mfa' ? <MfaStep newDevice={!!auth.mfaNewDevice} /> : null}
        {auth.stage === 'device-code' ? <DeviceCodeStep auth={auth} /> : null}
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

/**
 * The in-app password form, for servers without a browser sign-in (legacy auth): email, password, the CAPTCHA, wait
 * or block the server answered with (SignInProtection), Forgot your password, and a passkey through the browser
 * where the server offers one. `onChangeServer`: what Change does (the branded sign-in's "Use a different server");
 * without it, Change starts Add Account › Enterprise when accounts are known, else clears the server as before.
 */
export function SignInStep({ auth, onChangeServer, hideServer }: { auth: AuthState; onChangeServer?: () => void; hideServer?: boolean }) {
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
  // A CAPTCHA, a wait or a block the server answered with, for the address in the form (worksuite-desktop#301).
  const now = useNow(1000).getTime();
  const gate = gateFor(auth.gate, email, now);
  // A wait that has run out is over: the form is back, and the main process forgets it.
  const waitOver = auth.gate?.kind === 'restricted' && auth.gate.until <= now;
  useEffect(() => {
    if (waitOver) void call('auth:clearGate').catch(() => undefined);
  }, [waitOver]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('auth:signIn', { email, password });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      // A refused attempt never keeps the password: the next one is typed again.
      setPassword('');
      setBusy(false);
    }
  };
  const back = () => {
    setEmail('');
    setPassword('');
    setError(null);
    void call('auth:clearGate').catch(() => undefined);
  };
  if (gate?.kind === 'blocked') return <BlockedPanel gate={gate} onBack={back} />;
  if (gate?.kind === 'restricted') return <WaitPanel gate={gate} onBack={back} />;
  const captcha = gate?.kind === 'captcha' ? gate : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      {hideServer ? null : <div>
        <h1 className="text-[22px] font-bold text-ink">{t('auth.signIn')}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-[13.5px] text-ink-3">
          <Icon name="server" size={14} /> {auth.server?.name && auth.server.name !== host ? `${auth.server.name} · ` : ''}
          {host}
          {!auth.server?.locked ? (
            <button type="button" className="ml-1 font-semibold text-primary hover:underline" onClick={() => (onChangeServer ? onChangeServer() : changeServer())}>
              Change
            </button>
          ) : null}
        </p>
      </div>}
      {auth.message ? <div className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">{auth.message}</div> : null}
      <TextField label={t('auth.email')} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!email} />
      <TextField label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!!email} error={error ?? (captcha && !captcha.solved ? captcha.message : null)} />
      {captcha ? <CaptchaBox gate={captcha} /> : null}
      <Button variant="primary" size="lg" type="submit" loading={busy} disabled={!email || !password || (captcha !== null && !captcha.solved)}>
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

/** Change on the sign-in form: another server is another account once accounts are known; before, the old way. */
function changeServer(): void {
  if (app.get().accounts) startAdding('enterprise');
  else void call('auth:setServer', { url: '' });
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

/**
 * Two-factor. On a computer the account has not verified the same code verifies it (worksuite-desktop#301): nobody
 * with two-factor is asked for an emailed code as well, and the computer can be remembered.
 */
function MfaStep({ newDevice }: { newDevice: boolean }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const submit = async (value = code) => {
    setBusy(true);
    setError(null);
    try {
      await call('auth:verifyMfa', { code: value.replace(/\s+/g, ''), ...(newDevice ? { remember } : {}) });
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
        {newDevice ? <p className="mt-2 rounded-[8px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">This is the first time you’re signing in on this computer: the code verifies it too.</p> : null}
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
      {newDevice ? (
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink-2">
          <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember this computer
        </label>
      ) : null}
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
            <BrandMark size={30} />
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
