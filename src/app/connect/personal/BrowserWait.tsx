import { useEffect, useState } from 'react';
import type { BrowserSignIn } from '@shared/cloud';
import { call, errorMessage } from '../../../core/bridge';
import { ConnectCard, ConnectFrame } from '../ConnectFrame';

export interface BrowserWaitProps {
  /** The attempt in progress (`signin:changed`); null once it ended. */
  attempt: BrowserSignIn | null;
  /** Personal (screen 3) or an enterprise `browser_sign_in` (screen 8's Sign in). */
  variant: 'personal' | 'enterprise';
  /** The window title's account name ("Livezen Technologies"), null for WorkSuite Cloud. */
  accountName: string | null;
}

/** "09:12": minutes and seconds left. */
export function timeLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Now, every second while mounted (the timer). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Screen 3 — waiting for the browser sign-in: the 10-minute timer, Open browser again, Copy the sign-in link, Cancel.
 * Used by Personal and by an enterprise `browser_sign_in`. [WP3]
 *
 * The link copied is the sign-in page's address only: it holds no verifier and no token, so it is no use to anyone
 * but the person finishing the sign-in on this computer.
 */
export function BrowserWait({ attempt, variant, accountName }: BrowserWaitProps) {
  const now = useNow();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = variant === 'enterprise' ? `WorkSuite — Enterprise · ${accountName ?? 'Sign in'}` : 'WorkSuite — Personal · WorkSuite Cloud';
  const left = attempt ? attempt.expiresAt - now : 0;
  const expired = !!attempt && left <= 0;
  const signUp = attempt?.purpose === 'sign-up';

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const copy = () =>
    act(async () => {
      if (!attempt) return;
      await call('signin:copyLink', { attemptId: attempt.attemptId });
      setCopied(true);
    });

  return (
    <ConnectFrame title={title}>
      <ConnectCard className="items-center gap-[18px] text-center" width={520}>
        <div
          aria-hidden="true"
          className={expired ? 'h-[72px] w-[72px] rounded-full border-[6px] border-line' : 'h-[72px] w-[72px] animate-spin-slow rounded-full border-[6px] border-selection border-t-primary motion-reduce:animate-none'}
        />
        <h1 className="m-0 text-[24px] font-extrabold text-ink">{expired ? 'The sign-in window closed' : signUp ? 'Finish creating your account in your browser' : 'Finish signing in in your browser'}</h1>
        {attempt ? (
          <p className="m-0 text-[15px] leading-[1.6] text-ink-3">
            {expired ? (
              'Nothing was signed in. Start again when you are ready.'
            ) : (
              <>
                We opened <span className="font-mono text-ink">{attempt.host}</span> in your default browser. {signUp ? 'Create your account there' : 'Sign in there'} — WorkSuite will continue here automatically.
              </>
            )}
          </p>
        ) : (
          <p className="m-0 text-[15px] text-ink-3">Opening your browser…</p>
        )}
        {attempt && !expired ? (
          <div className="flex w-full justify-between rounded-[12px] bg-ground px-4 py-3.5 text-[13px]" role="timer" aria-live="off">
            <span className="text-ink-3">Waiting for the browser</span>
            <span className="font-mono text-ink">{timeLeft(left)} left</span>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="w-full rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
            {error}
          </div>
        ) : null}
        <div className="flex gap-3">
          {attempt && !expired ? (
            <button type="button" onClick={() => void act(() => call('signin:reopen', { attemptId: attempt.attemptId }))} className="h-11 rounded-[10px] border border-primary bg-surface px-5 text-[14px] font-semibold text-primary hover:bg-selection">
              Open browser again
            </button>
          ) : null}
          <button
            type="button"
            disabled={!attempt}
            onClick={() => void act(() => (attempt ? call('signin:cancel', { attemptId: attempt.attemptId }) : Promise.resolve()))}
            className="h-11 rounded-[10px] px-5 text-[14px] font-semibold text-ink-3 hover:bg-subtle disabled:opacity-50"
          >
            {expired ? 'Start again' : 'Cancel'}
          </button>
        </div>
        {attempt && !expired ? (
          <p className="m-0 text-[12px] text-ink-3">
            Browser didn't open?{' '}
            <button type="button" onClick={() => void copy()} className="text-primary hover:underline">
              {copied ? 'Link copied' : 'Copy the sign-in link'}
            </button>
          </p>
        ) : null}
      </ConnectCard>
    </ConnectFrame>
  );
}
