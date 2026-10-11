import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { mailKeys } from './api';
import { detailsText, initialSteps, isAttemptId, isFinished, nextPoll, startBody, type OAuthAttempt, type OAuthExplained, type OAuthStart, type OAuthStep } from './oauth';

/**
 * The desktop half of a Microsoft / Google mailbox sign-in (see ./oauth.ts for the flow): start it, open the system
 * browser, watch the attempt, and show each step and any explanation.
 */

/**
 * Watch an attempt to its end without a component (the repair flow, which only toasts the outcome). Returns a
 * function that stops watching.
 */
export function watchAttempt(id: string, onDone: (a: OAuthAttempt) => void): () => void {
  const started = Date.now();
  let stopped = false;
  let handle: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const r = await apiGet<{ attempt: OAuthAttempt }>(`/api/mail/oauth/attempts/${id}`);
      if (stopped) return;
      if (isFinished(r.attempt)) return onDone(r.attempt);
    } catch {
      /* keep watching */
    }
    const wait = nextPoll(Date.now() - started);
    if (wait !== null && !stopped) handle = setTimeout(() => void tick(), wait);
  };
  handle = setTimeout(() => void tick(), nextPoll(0) ?? 2000);
  return () => {
    stopped = true;
    if (handle) clearTimeout(handle);
  };
}

export type SignInPhase = 'idle' | 'starting' | 'waiting' | 'legacy' | 'done' | 'timeout';

export function useOAuthSignIn(provider: string) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<SignInPhase>('idle');
  const [attempt, setAttempt] = useState<OAuthAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    run.current += 1;
  }, []);
  useEffect(() => stop, [stop]);

  const watch = useCallback(
    (id: string, mine: number, started: number) => {
      const tick = async () => {
        if (run.current !== mine) return;
        try {
          const r = await apiGet<{ attempt: OAuthAttempt }>(`/api/mail/oauth/attempts/${id}`);
          if (run.current !== mine) return;
          setAttempt(r.attempt);
          if (isFinished(r.attempt)) {
            setPhase('done');
            if (r.attempt.status === 'connected') void qc.invalidateQueries({ queryKey: mailKeys.mailboxes });
            return;
          }
        } catch {
          /* a blip while the person is in the browser is not a result: keep watching */
        }
        const wait = nextPoll(Date.now() - started);
        if (wait === null) setPhase('timeout');
        else timer.current = setTimeout(() => void tick(), wait);
      };
      timer.current = setTimeout(() => void tick(), nextPoll(0) ?? 2000);
    },
    [qc],
  );

  const start = useCallback(
    async (email?: string | null) => {
      stop();
      const mine = run.current;
      setPhase('starting');
      setError(null);
      setAttempt(null);
      try {
        const r = await apiPost<OAuthStart>(`/api/mail/oauth/${provider}/start`, startBody(email));
        await call('app:openExternal', { url: r.url });
        if (run.current !== mine) return;
        if (isAttemptId(r.attempt)) {
          setPhase('waiting');
          watch(r.attempt, mine, Date.now());
        } else {
          setPhase('legacy');
        }
      } catch (e) {
        setError(errorMessage(e));
        setPhase('idle');
      }
    },
    [provider, stop, watch],
  );

  const reset = useCallback(() => {
    stop();
    setPhase('idle');
    setAttempt(null);
    setError(null);
  }, [stop]);

  return { phase, attempt, error, start, reset };
}

const STEP_ICON: Record<OAuthStep['status'], { icon: string; tone: string }> = {
  pending: { icon: 'clock', tone: 'text-ink-3' },
  pass: { icon: 'check', tone: 'text-success' },
  warn: { icon: 'alert', tone: 'text-warning' },
  fail: { icon: 'x', tone: 'text-danger' },
  skipped: { icon: 'minus', tone: 'text-ink-3' },
};

export function OAuthSteps({ steps }: { steps: OAuthStep[] }) {
  return (
    <ol aria-label={text('Sign-in steps')} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
      {steps.map((s) => (
        <li key={s.id} className="inline-flex items-center gap-1" title={s.detail ?? undefined} data-status={s.status}>
          <Icon name={STEP_ICON[s.status].icon} size={14} className={STEP_ICON[s.status].tone} />
          <span className={cx(s.status === 'skipped' || s.status === 'pending' ? 'text-ink-3' : 'text-ink')}>{text(s.label)}</span>
          <span className="sr-only">{s.status}</span>
        </li>
      ))}
    </ol>
  );
}

function copy(value: string, what: string) {
  void navigator.clipboard?.writeText(value).then(
    () => toast('success', text('{what} copied.', { what })),
    () => toast('error', text('Could not copy.')),
  );
}

export function OAuthErrorCard({ error, attempt }: { error: OAuthExplained; attempt?: OAuthAttempt | null }) {
  const d = error.details ?? {};
  const code = error.code ?? d.code ?? null;
  return (
    <div role={error.quiet ? 'status' : 'alert'} className={cx('rounded-[10px] px-3 py-2.5 text-[13px]', error.quiet ? 'bg-subtle text-ink-2' : 'bg-danger-bg text-ink')}>
      <p className="font-semibold">{error.title}</p>
      <p className="mt-0.5 text-ink-2">{error.message}</p>
      {error.next_step ? <p className="mt-0.5 text-ink-2">{error.next_step}</p> : null}
      {error.admin_consent_url ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[8px] bg-surface px-2 py-1.5">
          <span className="text-[12px] text-ink-3">{text('Approval link for your Microsoft 365 admin')}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{error.admin_consent_url}</code>
          <Button size="sm" icon="copy" onClick={() => copy(error.admin_consent_url!, text('Approval link'))}>
            {text('Copy approval link')}
          </Button>
        </div>
      ) : null}
      {error.help_url ? (
        <button type="button" className="mt-1 text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void call('app:openExternal', { url: error.help_url! })}>
          {text('How to')}
        </button>
      ) : null}
      {!error.quiet ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
          {code ?? d.error ? <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink-2">{code ?? d.error}</code> : null}
          {d.request_id ? <span>{text('Request ID {id}', { id: d.request_id })}</span> : null}
          {d.correlation_id ? <span>{text('Correlation ID {id}', { id: d.correlation_id })}</span> : null}
          <Button size="sm" icon="copy" onClick={() => copy(detailsText(attempt ?? { request_id: d.request_id ?? '', provider: d.provider ?? '', status: 'failed', steps: [], email: null, error }), text('Details'))}>
            {text('Copy details')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Where a sign-in started from this app has got to. */
export function OAuthProgress({ phase, attempt, onRetry }: { phase: SignInPhase; attempt: OAuthAttempt | null; onRetry: () => void }) {
  if (phase === 'idle' || phase === 'starting') return null;
  if (phase === 'legacy') return <p className="mt-3 text-[12.5px] text-ink-3">{text('Finish in your browser. The mailbox appears here when you are done.')}</p>;
  const steps = attempt?.steps ?? initialSteps();
  return (
    <div className="mt-4 space-y-3" aria-live="polite">
      <OAuthSteps steps={steps} />
      {phase === 'waiting' ? <p className="text-[12.5px] text-ink-3">{text('Finish signing in in your browser. This updates by itself.')}</p> : null}
      {phase === 'timeout' ? (
        <p className="text-[12.5px] text-ink-3">
          {text('The sign-in was not finished in time.')}{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={onRetry}>
            {text('Start again')}
          </button>
        </p>
      ) : null}
      {phase === 'done' && attempt?.status === 'connected' ? (
        <p role="status" className="rounded-[10px] bg-success-bg px-3 py-2 text-[13px] text-success">
          {attempt.email ? text('{email} is connected.', { email: attempt.email }) : text('Mailbox connected.')}
        </p>
      ) : null}
      {phase === 'done' && attempt?.error ? <OAuthErrorCard error={attempt.error} attempt={attempt} /> : null}
      {phase === 'done' && attempt?.status === 'cancelled' && !attempt.error ? <p className="text-[13px] text-ink-2">{text('Sign-in was cancelled. Try again when you are ready.')}</p> : null}
      {phase === 'done' && attempt
        ? attempt.warnings.map((w, i) => (
            <div key={i} className="rounded-[10px] bg-warning-bg px-3 py-2 text-[13px] text-warning">
              <p className="font-semibold">{w.title}</p>
              <p>{w.message}</p>
              {w.next_step ? <p>{w.next_step}</p> : null}
            </div>
          ))
        : null}
      {phase === 'done' && attempt && attempt.status !== 'connected' ? (
        <Button variant="primary" icon="external" onClick={onRetry}>
          {text('Try again')}
        </Button>
      ) : null}
    </div>
  );
}
