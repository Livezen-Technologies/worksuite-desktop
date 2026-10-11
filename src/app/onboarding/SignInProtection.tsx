import { useState } from 'react';
import type { AuthState, SignInGate } from '@shared/types';
import { call, errorMessage } from '../../core/bridge';
import { useNow } from '../../core/use-now';
import { Icon } from '../../components/Icon';
import { Button, TextField } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';

/**
 * The sign-in screen's protection states (worksuite-desktop#301): the CAPTCHA, "Too many attempts, try again in…"
 * with a live countdown, "Your account is locked" with "Email me an unblock link", and a new computer's emailed code.
 * Every one of them is the server's answer, counted on the server; nothing here decides anything, and nothing here
 * says whether an address has an account.
 */

type Gate<K extends SignInGate['kind']> = Extract<SignInGate, { kind: K }>;

/** "14:59", "1:04:12". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** "15 minutes", "1 hour", "5 hours", "1 hour 30 minutes". */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (h === 0) return part(m, 'minute');
  return m ? `${part(h, 'hour')} ${part(m, 'minute')}` : part(h, 'hour');
}

/** `ha****da@example.com`, as the server masks it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return email;
  const keep = local.length <= 4 ? 1 : 2;
  return `${local.slice(0, keep)}${'*'.repeat(Math.max(2, local.length - keep * 2))}${keep < local.length ? local.slice(-keep) : ''}@${domain}`;
}

/** Whether a gate is about the address in the form now (one for another address does not apply to it). */
export function gateFor(gate: SignInGate | null | undefined, email: string, now: number): SignInGate | null {
  if (!gate || gate.email.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  if (gate.kind === 'restricted' && gate.until <= now) return null;
  return gate;
}

/** The CAPTCHA, in the server's own page in a window of its own; the next attempt carries what it gave. */
export function CaptchaBox({ gate }: { gate: Gate<'captcha'> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('auth:solveCaptcha');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="group" aria-label="CAPTCHA" className="flex flex-col gap-2 rounded-[10px] border border-line bg-subtle px-3.5 py-3">
      {gate.solved ? (
        <p className="flex items-center gap-2 text-[13px] font-semibold text-success">
          <Icon name="check-circle" size={16} /> Verified. Sign in now.
        </p>
      ) : (
        <>
          <p className="text-[12.5px] text-ink-2">After several failed attempts, confirm you are not a robot before the next one.</p>
          <Button type="button" icon="shield-check" loading={busy} onClick={() => void open()}>
            Confirm you’re not a robot
          </Button>
        </>
      )}
      {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
    </div>
  );
}

/** "Too many attempts": the wait counts down; when it is over the sign-in screen shows the form again (`gateFor`). */
export function WaitPanel({ gate, onBack }: { gate: Gate<'restricted'>; onBack: () => void }) {
  const now = useNow(1000).getTime();
  const left = gate.until - now;
  const total = gate.total ?? null;
  const progress = total ? Math.min(100, Math.max(0, 100 - (left / (total * 1000)) * 100)) : null;
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-bg text-warning">
        <Icon name="clock" size={22} />
      </span>
      <div>
        <h1 className="text-[20px] font-bold text-ink">Too many attempts</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          To keep <b>{maskEmail(gate.email)}</b> safe, sign-in is paused. Try again in
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div role="timer" aria-label="Time left" className="text-[32px] font-bold tabular-nums text-ink">
          {clock(left)}
        </div>
        {progress !== null ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
            <div className="h-full bg-warning" style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1 text-[12.5px] text-ink-3">
        {gate.failures ? <li>{gate.failures} failed attempts in a row.</li> : null}
        {gate.nextWait === 0 ? (
          <li className="font-semibold text-danger">One more wrong password blocks the account until it is unblocked.</li>
        ) : gate.nextWait ? (
          <li>Another wrong password makes you wait {minutesLabel(gate.nextWait)}.</li>
        ) : null}
        {gate.blockAfter ? <li>The account is blocked after {gate.blockAfter} failed attempts.</li> : null}
      </ul>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => void call('auth:openPage', { page: 'forgot-password' }).catch(() => undefined)}>
          Forgot your password?
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Use a different account
        </Button>
      </div>
    </div>
  );
}

/** "Your account is locked", with what the server said about it and the emailed unblock link. */
export function BlockedPanel({ gate, onBack }: { gate: Gate<'blocked'>; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setSent((await call('auth:requestUnblock', { email: gate.email })).message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const when = gate.blockedAt ? new Date(gate.blockedAt) : null;
  const facts: Array<[string, string]> = [
    ...(gate.failures ? [['Failed attempts', String(gate.failures)] as [string, string]] : []),
    ...(when && !Number.isNaN(when.getTime()) ? [['Locked at', when.toLocaleString()] as [string, string]] : []),
    ...(gate.lastPlace || gate.lastBrowser ? [['Last attempt', [gate.lastPlace ? `${gate.lastPlace} (approximate)` : null, gate.lastBrowser].filter(Boolean).join(' · ')] as [string, string]] : []),
    ...(gate.reference ? [['Reference', gate.reference] as [string, string]] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-danger">
        <Icon name="lock" size={22} />
      </span>
      <div>
        <h1 className="text-[20px] font-bold text-ink">Your account is locked</h1>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
          To protect it, sign-in to <b>{maskEmail(gate.email)}</b> is blocked after too many failed attempts.{' '}
          {gate.selfUnblock ? 'Use the unblock link we emailed to the account, or ask your administrator.' : 'Ask your administrator to unblock it.'}
        </p>
      </div>
      {facts.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[10px] bg-subtle px-3.5 py-3 text-[12.5px]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {sent ? (
        <p role="status" className="flex items-start gap-2 rounded-[10px] bg-success-bg px-3.5 py-2.5 text-[12.5px] text-success">
          <Icon name="mail" size={15} className="mt-0.5 shrink-0" /> {sent}
        </p>
      ) : null}
      {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {gate.selfUnblock ? (
          <Button type="button" variant="primary" icon="mail" loading={busy} disabled={!!sent} onClick={() => void ask()}>
            Email me an unblock link
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onBack}>
          Use a different account
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        {gate.selfUnblock && gate.linkHours ? `The link works once, for ${gate.linkHours} hours. ` : ''}If these attempts were not you, change your password once you are back in.
      </p>
    </div>
  );
}

/** A new computer, for somebody without two-factor: the code emailed to them, with another on request. */
export function DeviceCodeStep({ auth }: { auth: AuthState }) {
  const step = auth.deviceCode;
  const now = useNow(1000).getTime();
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!step) return null;
  const expired = step.expiresAt <= now;
  const resendIn = step.resendAt - now;
  const submit = async (value = code) => {
    setBusy(true);
    setError(null);
    try {
      await call('auth:verifyDevice', { code: value, remember });
    } catch (e) {
      setError(errorMessage(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setResending(true);
    setError(null);
    setNote(null);
    try {
      const next = await call('auth:resendDevice');
      setNote(next.deviceCode?.message ?? 'We sent another code.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setResending(false);
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
        <h1 className="text-[22px] font-bold text-ink">Verify this computer</h1>
        <p className="mt-1 text-[13.5px] text-ink-3">
          This is the first time you’re signing in here.{' '}
          {step.sent ? (
            <>
              We emailed a six-digit code to <b className="text-ink-2">{step.emailHint || 'your email address'}</b>.
            </>
          ) : (
            'We could not email you a code just now.'
          )}
        </p>
      </div>
      {!step.sent && step.message ? <div className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">{step.message}</div> : null}
      <TextField
        label="Code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        disabled={expired}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(v);
          if (v.length === 6 && !busy) void submit(v);
        }}
        autoFocus
        error={error}
        className="font-mono"
      />
      <p className="flex flex-wrap gap-x-3 text-[12px] text-ink-3" aria-live="polite">
        <span>{expired ? 'This code has expired. Ask for a new one.' : `Expires in ${clock(step.expiresAt - now)}`}</span>
        <span>
          {step.attemptsLeft} {step.attemptsLeft === 1 ? 'try' : 'tries'} left
        </span>
      </p>
      <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink-2">
        <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember this computer, so it isn’t asked again
      </label>
      <Button variant="primary" size="lg" type="submit" loading={busy} disabled={code.length !== 6 || expired}>
        Verify
      </Button>
      {note ? <p className="text-[12.5px] text-success">{note}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline disabled:cursor-default disabled:text-ink-3 disabled:no-underline" disabled={resending || resendIn > 0} onClick={() => void resend()}>
          {resendIn > 0 ? `Send another code in ${clock(resendIn)}` : 'Send another code'}
        </button>
        <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void call('auth:cancelMfa')}>
          Use a different account
        </button>
      </div>
    </form>
  );
}
