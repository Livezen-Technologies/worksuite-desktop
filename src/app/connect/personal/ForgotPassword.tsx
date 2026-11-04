import { useEffect, useRef, useState, type FormEvent } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';

export interface ForgotPasswordProps {
  /** The Personal account row whose server resets the password. */
  accountId: string;
  prefill?: string;
  /** Back to sign-in; `done` after the password was changed. */
  onBack: (done?: boolean) => void;
}

/**
 * Forgot password without leaving the app: the address, then the 6-digit code the server emails with a new password
 * (POST /recover {headless:true}, POST /recover/code). Every session of the account ends; the person signs in again.
 */
export function ForgotPassword({ accountId, prefill, onBack }: ForgotPasswordProps) {
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState(prefill ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeBox = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (step === 'code') codeBox.current?.focus();
  }, [step]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    void run(async () => {
      await call('recover:send', { accountId, email: email.trim() });
      setStep('code');
    });
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await call('recover:reset', { accountId, email: email.trim(), code: code.trim(), password });
      setStep('done');
    });
  };

  const field = 'h-11 rounded-[10px] border border-line bg-surface px-3.5 text-[14px] text-ink outline-none focus:border-primary';
  const mismatch = confirm.length > 0 && confirm !== password;
  const alert = error ? (
    <div role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
      {error}
    </div>
  ) : null;
  const primary = 'flex h-[46px] items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60';
  const spinner = busy ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : null;

  if (step === 'done')
    return (
      <div className="flex w-[400px] max-w-full flex-col gap-3.5" role="status">
        <h1 className="m-0 text-[28px] font-extrabold text-ink">Password changed</h1>
        <p className="m-0 text-[14px] text-ink-3">You were signed out everywhere. Sign in with your new password.</p>
        <button type="button" onClick={() => onBack(true)} className={primary}>
          Sign in
        </button>
      </div>
    );

  if (step === 'code')
    return (
      <form onSubmit={reset} className="flex w-[400px] max-w-full flex-col gap-3.5" aria-label="Choose a new password">
        <h1 className="m-0 text-[28px] font-extrabold text-ink">Check your email</h1>
        <p className="m-0 text-[14px] text-ink-3">
          If <span className="font-semibold text-ink">{email.trim()}</span> has a WorkSuite Cloud account, we sent it a six-digit code. It expires in 15 minutes.
        </p>
        <label htmlFor="reset-code" className="text-[13px] font-semibold text-ink">
          Code
        </label>
        <input id="reset-code" ref={codeBox} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className={cx(field, 'text-center font-mono text-[20px] tracking-[8px]')} />
        <label htmlFor="reset-password" className="text-[13px] font-semibold text-ink">
          New password
        </label>
        <input id="reset-password" type="password" autoComplete="new-password" maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        <label htmlFor="reset-confirm" className="text-[13px] font-semibold text-ink">
          Confirm new password
        </label>
        <input id="reset-confirm" type="password" autoComplete="new-password" aria-invalid={mismatch ? true : undefined} maxLength={256} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={cx(field, mismatch && 'border-danger')} />
        {mismatch ? <p className="m-0 text-[12px] text-danger">The two passwords are not the same.</p> : <p className="m-0 text-[12px] text-ink-3">At least 8 characters.</p>}
        <button type="submit" disabled={busy || code.length < 6 || password.length < 8 || password !== confirm} className={primary}>
          {spinner}
          Change password
        </button>
        {alert}
        <div className="flex items-center justify-between text-[13px]">
          <button type="button" disabled={busy} onClick={() => send()} className="text-primary hover:underline disabled:opacity-60">
            Send another code
          </button>
          <button type="button" onClick={() => onBack()} className="text-ink-3 hover:underline">
            ← Back to sign in
          </button>
        </div>
      </form>
    );

  return (
    <form onSubmit={send} className="flex w-[400px] max-w-full flex-col gap-3.5" aria-label="Reset your password">
      <h1 className="m-0 text-[28px] font-extrabold text-ink">Reset your password</h1>
      <p className="m-0 text-[14px] text-ink-3">Enter the email you sign in with. We will send a code to choose a new password here.</p>
      <label htmlFor="reset-email" className="text-[13px] font-semibold text-ink">
        Email
      </label>
      <input id="reset-email" type="email" autoComplete="email" autoFocus maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
      <button type="submit" disabled={busy || !email.includes('@')} className={primary}>
        {spinner}
        Send code
      </button>
      {alert}
      <button type="button" onClick={() => onBack()} className="self-start text-[13px] text-ink-3 hover:underline">
        ← Back to sign in
      </button>
    </form>
  );
}
