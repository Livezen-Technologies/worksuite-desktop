import { useEffect, useRef, useState, type FormEvent } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';

export interface InAppSignUpProps {
  /** The Personal account row this sign-up will become. */
  accountId: string;
  /** What was typed on the welcome screen, if anything. */
  prefill?: string;
  onBack: () => void;
}

/**
 * Creating a WorkSuite Cloud account without leaving the app (ENH-AUTH-01 §4), shown when the server publishes
 * `signup.mode = in_app`. Two steps: the details, then the code that was emailed. The app finishes signed in.
 *
 * The password is typed here only to create the account — the session that follows comes from an authorization
 * code the main process exchanges, exactly as a browser sign-in's does (electron/services/cloud/in-app-signup.ts).
 */
export function InAppSignUp({ accountId, prefill, onBack }: InAppSignUpProps) {
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [form, setForm] = useState({ firstName: '', lastName: '', email: prefill ?? '', password: '', country: countryGuess() });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [resentAt, setResentAt] = useState(0);
  const codeBox = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (step === 'code') codeBox.current?.focus();
  }, [step]);

  /* Leaving the screen drops the sign-up in the main process: nothing half-made is left waiting. */
  useEffect(() => () => void call('signup:cancel').catch(() => undefined), []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const details = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await call('signup:start', {
        accountId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
        country: form.country.toUpperCase(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      setSentTo(out.email);
      setStep('code');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call('signup:verify', { accountId, code: code.trim() });
      /* Signed in: the account's own screens take over from here. */
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      codeBox.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('signup:resend', { accountId });
      setResentAt(Date.now());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const field = 'h-11 rounded-[10px] border border-line bg-surface px-3.5 text-[14px] text-ink outline-none focus:border-primary';
  const ready = form.firstName.trim() && form.lastName.trim() && form.email.includes('@') && form.password.length >= 8 && form.country.length === 2;

  if (step === 'code')
    return (
      <form onSubmit={verify} className="flex w-[400px] max-w-full flex-col gap-3.5" aria-label="Confirm your email address">
        <h1 className="m-0 text-[28px] font-extrabold text-ink">Check your email</h1>
        <p className="m-0 text-[14px] text-ink-3">
          We sent a six-digit code to <span className="font-semibold text-ink">{sentTo}</span>. Enter it to finish setting up your account.
        </p>
        <label htmlFor="signup-code" className="text-[13px] font-semibold text-ink">
          Code
        </label>
        <input
          id="signup-code"
          ref={codeBox}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className={cx(field, 'text-center font-mono text-[20px] tracking-[8px]')}
        />
        <button type="submit" disabled={busy || code.length < 6} className="flex h-[46px] items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
          {busy ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : null}
          Create my account
        </button>
        {error ? (
          <div role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
            {error}
          </div>
        ) : null}
        <div className="flex items-center justify-between text-[13px]">
          <button type="button" disabled={busy} onClick={() => void resend()} className="text-primary hover:underline disabled:opacity-60">
            Send another code
          </button>
          {resentAt ? <span className="text-ink-3">Sent again just now</span> : null}
        </div>
        <button type="button" onClick={onBack} className="self-start text-[13px] text-ink-3 hover:underline">
          ← Back
        </button>
      </form>
    );

  return (
    <form onSubmit={details} className="flex w-[400px] max-w-full flex-col gap-3.5" aria-label="Create a WorkSuite Cloud account">
      <h1 className="m-0 text-[28px] font-extrabold text-ink">Create your account</h1>
      <p className="m-0 text-[14px] text-ink-3">It takes a minute, and stays in this app.</p>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="signup-first" className="text-[13px] font-semibold text-ink">
            First name
          </label>
          <input id="signup-first" autoComplete="given-name" maxLength={60} value={form.firstName} onChange={set('firstName')} className={field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="signup-last" className="text-[13px] font-semibold text-ink">
            Last name
          </label>
          <input id="signup-last" autoComplete="family-name" maxLength={60} value={form.lastName} onChange={set('lastName')} className={field} />
        </div>
      </div>
      <label htmlFor="signup-email" className="text-[13px] font-semibold text-ink">
        Email
      </label>
      <input id="signup-email" type="email" autoComplete="email" maxLength={254} value={form.email} onChange={set('email')} className={field} />
      <label htmlFor="signup-password" className="text-[13px] font-semibold text-ink">
        Password
      </label>
      <input id="signup-password" type="password" autoComplete="new-password" maxLength={256} value={form.password} onChange={set('password')} className={field} />
      <p className="m-0 text-[12px] text-ink-3">At least 8 characters. Your password is used to create the account and is never stored on this computer.</p>
      <label htmlFor="signup-country" className="text-[13px] font-semibold text-ink">
        Country
      </label>
      <input id="signup-country" autoComplete="country" maxLength={2} value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))} className={cx(field, 'uppercase')} />
      <button type="submit" disabled={busy || !ready} className="flex h-[46px] items-center justify-center gap-2 rounded-[10px] bg-teal text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60">
        {busy ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : null}
        Continue
      </button>
      {error ? (
        <div role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      ) : null}
      <p className="m-0 text-[12px] text-ink-3">Creating an account accepts WorkSuite Cloud's Terms of Service and Privacy Policy.</p>
      <button type="button" onClick={onBack} className="self-start text-[13px] text-ink-3 hover:underline">
        ← Back to sign in
      </button>
    </form>
  );
}

/** A starting guess for the country, from this computer's locale. The person can change it. */
function countryGuess(): string {
  const tag = typeof navigator === 'undefined' ? '' : navigator.language;
  const region = /-([A-Za-z]{2})$/.exec(tag ?? '')?.[1];
  return (region ?? '').toUpperCase();
}
