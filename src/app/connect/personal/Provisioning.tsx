import { useEffect, useState } from 'react';
import type { ProvisioningStatus } from '@shared/cloud';
import type { AuthState } from '@shared/types';
import { app } from '../../../core/app-state';
import { call, errorMessage } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { Icon } from '../../../components/Icon';
import { ConnectCard, ConnectFrame } from '../ConnectFrame';

export interface ProvisioningProps {
  auth: AuthState;
}

/** Cloud's setup steps, in order, as the screen names them; `step` from `/provisioning/status` says which is running. */
const STEPS: Array<{ key: string; label: string }> = [
  { key: 'workspace', label: 'Workspace created' },
  { key: 'plan', label: 'WorkSuite Professional Free' },
  { key: 'apps', label: 'Apps turned on' },
  { key: 'drive', label: 'Creating your Drive folders' },
  { key: 'preferences', label: 'Preferences' },
];

/** Where `step` is in STEPS: an unknown step counts as the first after the plan. */
export function stepIndex(step: string | null | undefined): number {
  const i = STEPS.findIndex((s) => s.key === step);
  if (i >= 0) return i;
  return step === 'done' ? STEPS.length : 2;
}

/** "Next attempt in 4 minutes" / "in less than a minute" / "now". */
export function nextAttempt(retryAt: string | null, now: number): string | null {
  if (!retryAt) return null;
  const at = Date.parse(retryAt);
  if (Number.isNaN(at)) return null;
  const ms = at - now;
  if (ms <= 0) return 'Trying again now.';
  const min = Math.ceil(ms / 60_000);
  return ms < 60_000 ? 'Next attempt in less than a minute.' : `Next attempt in ${min} minute${min === 1 ? '' : 's'}.`;
}

/**
 * Screen 5 — setting up the workspace (`provisioning`), PROVISIONING_FAILED's countdown and Retry now. The desktop goes
 * on by itself when Cloud says the workspace is ACTIVE. [WP3]
 */
export function Provisioning({ auth }: ProvisioningProps) {
  const fromStore = useStore(app, (s) => s.cloud);
  const cloud = fromStore ?? auth.cloud ?? null;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Retry now's answer, until Cloud's next status (a new `provisioning`) arrives. */
  const [retried, setRetried] = useState<{ status: ProvisioningStatus; over: ProvisioningStatus | null } | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const current = cloud?.provisioning ?? null;
  const p = retried && retried.over === current ? retried.status : current;
  const failed = p?.state === 'PROVISIONING_FAILED' || (!p && cloud?.accountState === 'PROVISIONING_FAILED');
  const at = p ? stepIndex(p.step) : 1;
  const pct = Math.round((Math.min(at, STEPS.length) / STEPS.length) * 100);
  const name = auth.account?.organizationName ?? (auth.user?.name ? `${auth.user.name.split(' ')[0]}'s Workspace` : 'your workspace');

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      setRetried({ status: await call('cloud:retryProvisioning'), over: current });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const support = () => void call('cloud:openWeb', { page: 'support' }).catch(() => undefined);

  return (
    <ConnectFrame title="WorkSuite — Personal · WorkSuite Cloud">
      <div className="flex flex-wrap items-start justify-center gap-10">
        <ConnectCard width={520} className="gap-4">
          <h1 className="m-0 text-[26px] font-extrabold text-ink">Setting up {name}</h1>
          <p className="m-0 mb-1 text-[14px] text-ink-3">This usually takes a few seconds.</p>
          <div className="h-2 rounded-full bg-selection" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Workspace setup">
            <div className="h-2 rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-3 p-0 text-[14px]">
            {STEPS.map((s, i) => {
              const done = i < at;
              const running = i === at && !failed;
              return (
                <li key={s.key} className={done ? 'flex items-center gap-3 text-ink' : running ? 'flex items-center gap-3 font-bold text-ink' : 'flex items-center gap-3 text-ink-3'} data-state={done ? 'done' : running ? 'running' : 'waiting'}>
                  {done ? (
                    <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-success text-white">
                      <Icon name="check" size={13} strokeWidth={3} />
                    </span>
                  ) : running ? (
                    <span aria-hidden="true" className="h-[22px] w-[22px] animate-spin-slow rounded-full border-[3px] border-selection border-t-primary motion-reduce:animate-none" />
                  ) : (
                    <span aria-hidden="true" className="h-[22px] w-[22px] rounded-full border-2 border-line" />
                  )}
                  {s.label}
                </li>
              );
            })}
          </ul>
          {cloud?.unavailable ? <p className="m-0 text-[13px] text-ink-3">WorkSuite Cloud is not answering right now. We'll keep trying.</p> : null}
        </ConnectCard>
        {failed ? (
          <section className="flex w-[420px] max-w-full flex-col gap-3 rounded-[18px] border border-warning/40 bg-surface p-7" role="status" data-testid="provisioning-failed">
            <div className="text-[18px] font-bold text-ink">Your account was created, but workspace setup is still completing.</div>
            <p className="m-0 text-[14px] text-ink-3">
              We'll keep trying in the background. {nextAttempt(p?.retry_at ?? null, now) ?? ''}
            </p>
            {error ? (
              <div role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
                {error}
              </div>
            ) : null}
            <div className="flex items-center gap-2.5">
              <button type="button" disabled={busy} onClick={() => void retry()} className="flex h-[42px] items-center gap-2 rounded-[10px] bg-primary px-[18px] text-[14px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
                {busy ? <Icon name="spinner" size={15} className="animate-spin-slow" /> : null}
                Retry now
              </button>
              <button type="button" onClick={support} className="h-[42px] px-2 text-[14px] font-semibold text-primary hover:underline">
                Contact support
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </ConnectFrame>
  );
}
