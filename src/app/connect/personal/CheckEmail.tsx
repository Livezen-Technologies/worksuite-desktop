import { useEffect, useState } from 'react';
import type { AuthState } from '@shared/types';
import { call, errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { ConnectCard, ConnectFrame } from '../ConnectFrame';

export interface CheckEmailProps {
  auth: AuthState;
}

/** The resend countdown: 60 s from the screen opening (the email was just sent), then from each resend. */
export const RESEND_AFTER_MS = 60_000;

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The three steps of a new Personal account, the current one marked. */
export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Account created', 'Verify email', 'Set up workspace'];
  return (
    <ol className="m-0 grid list-none grid-cols-3 gap-2 p-0 text-[12px]" aria-label="Steps">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const cls = n < current ? 'bg-success-bg font-semibold text-success' : n === current ? 'bg-selection font-bold text-primary' : 'bg-ground text-ink-3';
        return (
          <li key={label} aria-current={n === current ? 'step' : undefined} className={`rounded-[10px] p-2.5 ${cls}`}>
            {n} · {label}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Screen 4 — check your email (`verify-email`): the address, Resend after 60 s, Start again. The desktop goes on by
 * itself once the address is verified (the main process polls `/me`). [WP3]
 */
export function CheckEmail({ auth }: CheckEmailProps) {
  const email = auth.user?.email ?? auth.account?.user?.email ?? null;
  const [nextAt, setNextAt] = useState(() => Date.now() + RESEND_AFTER_MS);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const wait = nextAt - now;

  const resend = async () => {
    setError(null);
    try {
      const r = await call('cloud:resendVerification');
      setNextAt(Math.max(r.nextAt, Date.now() + 1000));
      setNow(Date.now());
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const startAgain = async () => {
    setError(null);
    const id = auth.account?.id;
    if (!id) return;
    try {
      await call('accounts:signOut', { accountId: id, removeCachedData: true, keepOfflineFiles: false, discardUnsynced: false });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <ConnectFrame title="WorkSuite — Personal · WorkSuite Cloud">
      <ConnectCard width={540} className="gap-[18px]">
        <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-teal/12 text-teal">
          <Icon name="mail-check" size={28} />
        </div>
        <h1 className="m-0 text-[26px] font-extrabold text-ink">Check your email</h1>
        <p className="m-0 text-[15px] leading-[1.6] text-ink-3">
          We sent a link and a 6-digit code to {email ? <b className="text-ink">{email}</b> : 'your email address'}. Open the link, or enter the code on the browser page. Your workspace is created as soon as your address is verified.
        </p>
        <Steps current={2} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={wait > 0} onClick={() => void resend()} className="h-11 rounded-[10px] border border-primary bg-surface px-5 text-[14px] font-semibold text-primary hover:bg-selection disabled:cursor-not-allowed disabled:opacity-50">
            Resend email
          </button>
          <span className="text-[13px] text-ink-3" aria-live="polite">
            {wait > 0 ? `You can resend in ${countdown(wait)}` : sent ? 'Opened in your browser — ask for a new email there.' : null}
          </span>
        </div>
        {error ? (
          <div role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
            {error}
          </div>
        ) : null}
        <p className="m-0 text-[12px] text-ink-3">
          Wrong address?{' '}
          <button type="button" onClick={() => void startAgain()} className="text-primary hover:underline">
            Start again
          </button>
        </p>
      </ConnectCard>
    </ConnectFrame>
  );
}
