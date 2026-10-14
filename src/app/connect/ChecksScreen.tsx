import { useState } from 'react';
import { CHECK_IDS, CHECK_LABELS, type CheckResult, type ConnectErrorCode, type ConnectFailure, type ConnectRun } from '@shared/discovery';
import { app, startAdding } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { hostOf } from '../accounts/labels';
import { ServerTooOldCard, UpdateRequiredCard } from './Compatibility';
import { ConnectCard, ConnectFrame } from './ConnectFrame';
import { startConnect } from './EnterpriseAddress';

export interface ChecksScreenProps {
  run: ConnectRun;
}

/** The sentence in the failure panel: what happened, in words, and what to do. Never "proceed anyway". */
const FAILURE_TEXT: Partial<Record<ConnectErrorCode, { title: string; hint: string }>> = {
  INVALID_ADDRESS: { title: 'That address isn’t valid.', hint: 'Check the address your IT team gave you.' },
  HTTPS_REQUIRED: { title: 'Only https servers are accepted.', hint: 'Use the https:// address your IT team gave you.' },
  DNS_FAILED: { title: 'The address wasn’t found.', hint: 'Check the spelling, or that you’re on your company’s network or VPN.' },
  UNREACHABLE: { title: 'The server didn’t answer.', hint: 'Check your connection, VPN or proxy, then try again.' },
  TLS_UNTRUSTED: { title: 'The server’s security certificate is not trusted.', hint: 'Contact your IT administrator. WorkSuite never connects to a server it cannot verify.' },
  TLS_EXPIRED: { title: 'The server’s security certificate has expired.', hint: 'Contact your IT administrator. WorkSuite never connects to a server it cannot verify.' },
  TLS_HOSTNAME: { title: 'The server’s certificate is for another address.', hint: 'Contact your IT administrator. WorkSuite never connects to a server it cannot verify.' },
  TLS_PIN_MISMATCH: { title: 'The server’s certificate doesn’t match the one your IT team configured.', hint: 'Contact your IT administrator before you try again.' },
  DISCOVERY_MISSING: { title: 'This server doesn’t look like WorkSuite.', hint: 'Check the address your IT team gave you.' },
  DISCOVERY_INVALID: { title: 'The server’s WorkSuite information couldn’t be read.', hint: 'Contact your IT administrator.' },
  SIGNATURE_MISSING: { title: 'The server’s information isn’t signed, and your organization requires it.', hint: 'Contact your IT administrator.' },
  SIGNATURE_INVALID: { title: 'The server’s signature doesn’t match.', hint: 'Contact your IT administrator. WorkSuite never connects to a server it cannot verify.' },
  NOT_WORKSUITE: { title: 'This server isn’t a WorkSuite server.', hint: 'Check the address your IT team gave you.' },
  ORIGIN_MISMATCH: { title: 'The server points to services on another address.', hint: 'Contact your IT administrator.' },
  HEALTH_FAILED: { title: 'The server isn’t working right now.', hint: 'Try again in a few minutes.' },
  PERSONAL_NOT_ALLOWED: { title: 'Your organization doesn’t allow personal accounts on this computer.', hint: 'Use your organization’s server instead.' },
  SERVER_NOT_ALLOWED: { title: 'Your organization allows only its own WorkSuite server on this computer.', hint: 'Contact your IT administrator.' },
  SETUP_LINK_EXPIRED: { title: 'This setup link has expired.', hint: 'Ask your IT team for a new setup QR or link.' },
  SETUP_LINK_INVALID: { title: 'This setup link isn’t valid.', hint: 'Ask your IT team for a new setup QR or link.' },
  CLOUD_UNAVAILABLE: { title: 'WorkSuite Cloud is temporarily unavailable.', hint: 'Try again in a few minutes.' },
  ACCOUNT_EXISTS: { title: 'This account is already on this computer.', hint: 'Open it instead.' },
};

export function failureText(f: ConnectFailure): { title: string; hint: string } {
  return FAILURE_TEXT[f.code] ?? { title: f.message || 'The server couldn’t be verified.', hint: 'Contact your IT administrator.' };
}

/** "Details for IT": the failure as this computer saw it, aligned for a ticket. */
export function detailsForIt(run: ConnectRun): string {
  const f = run.failure;
  if (!f) return '';
  const tls = f.tls;
  const rows: Array<[string, string | null | undefined]> = [
    ['code', f.code],
    ['host', tls ? `${tls.host}:${tls.port}` : (f.host ?? run.host)],
    ['step', f.step ? CHECK_LABELS[f.step] : null],
    ['issuer', tls?.issuer],
    ['subject', tls?.subject],
    ['expires', tls?.validTo ? tls.validTo.slice(0, 10) : null],
    ['chain', tls ? (tls.reason || `not in ${tls.trustStore} trust store`) : null],
    ['spki', tls?.spki],
    ['desktop', f.compat?.installed],
    ['required', f.compat?.required],
    ['server', f.compat ? (f.compat.serverVersion ?? 'not reported') : null],
    ['tried', run.candidates.length ? run.candidates.join(', ') : null],
    ['request', f.requestId],
    ['time', f.at],
  ];
  return rows
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.padEnd(9)} ${v}`)
    .join('\n');
}

function StepIcon({ status }: { status: CheckResult['status'] }) {
  const base = 'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full';
  switch (status) {
    case 'ok':
      return (
        <span className={cx(base, 'bg-success text-white')}>
          <Icon name="check" size={13} strokeWidth={3} />
        </span>
      );
    case 'failed':
      return (
        <span className={cx(base, 'bg-danger text-white')}>
          <Icon name="x" size={13} strokeWidth={3} />
        </span>
      );
    case 'warning':
      return (
        <span className={cx(base, 'bg-warning text-white')}>
          <Icon name="warning" size={12} />
        </span>
      );
    case 'running':
      return (
        <span className={cx(base, 'text-primary')}>
          <Icon name="spinner" size={18} className="animate-spin-slow" />
        </span>
      );
    case 'skipped':
      return <span className={cx(base, 'border-2 border-line text-ink-3')}>–</span>;
    default:
      return <span className={cx(base, 'border-2 border-dashed border-line')} />;
  }
}

const STATUS_WORD: Record<CheckResult['status'], string> = { waiting: 'waiting', running: 'checking', ok: 'passed', warning: 'warning', skipped: 'not configured', failed: 'failed' };

function StepRow({ step, last }: { step: CheckResult; last: boolean }) {
  const failed = step.status === 'failed';
  const muted = step.status === 'waiting';
  const right = failed ? 'failed' : step.status === 'skipped' ? (step.note ?? 'Not configured') : step.status === 'warning' ? (step.note ?? 'warning') : step.ms !== null ? `${step.ms} ms` : step.status === 'running' ? 'checking…' : '';
  return (
    <li className={cx('flex items-center gap-3 py-2.5 text-[14px]', !last && 'border-b border-line', failed ? 'font-bold text-danger' : muted ? 'text-ink-3' : 'text-ink')} data-status={step.status}>
      <StepIcon status={step.status} />
      <span className="min-w-0 flex-1">
        {CHECK_LABELS[step.id]}
        <span className="sr-only">: {STATUS_WORD[step.status]}</span>
      </span>
      <span className={cx('shrink-0 text-[12.5px]', failed ? 'text-danger' : step.status === 'warning' ? 'text-warning' : 'text-ink-3')}>{right}</span>
    </li>
  );
}

/** Every check in order, whatever the run has sent so far. */
function stepsOf(run: ConnectRun): CheckResult[] {
  return CHECK_IDS.map((id) => run.steps.find((s) => s.id === id) ?? { id, status: 'waiting', ms: null, note: null });
}

/**
 * Screen 7 — the server checks, live from `connect:progress`: DNS, certificate, discovery document, signature,
 * product, version, health. On a failure: what happened, Change address and Try again, and "Details for IT" with
 * Copy details. There is no "proceed anyway" — only trusted-server configuration from IT can allow a server this
 * computer cannot verify. On success the server is named, and Continue adds the account.
 */
export function ChecksScreen({ run }: ChecksScreenProps) {
  const accounts = useStore(app, (s) => s.accounts);
  const [busy, setBusy] = useState<'retry' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = run.host ?? run.failure?.host ?? null;
  const steps = stepsOf(run);
  const failure = run.state === 'failed' ? run.failure : null;
  const server = run.state === 'ok' ? run.server : null;

  const changeAddress = () => startAdding('enterprise', run.input);
  const tryAgain = async () => {
    setBusy('retry');
    setError(null);
    try {
      await startConnect(run.input);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const cancel = () => {
    void call('connect:cancel', { runId: run.runId }).catch(() => undefined);
    changeAddress();
  };
  const confirm = async () => {
    setBusy('confirm');
    setError(null);
    try {
      await call('connect:confirm', { runId: run.runId });
      // The new account is open and signed out: its sign-in screen follows.
      app.set({ session: { ...app.get().session, adding: null }, connect: null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const copyDetails = async () => {
    const ok = await call('connect:copyDetails', { runId: run.runId }).catch(() => false);
    if (ok) toast('success', 'Details copied.');
    else
      await navigator.clipboard.writeText(detailsForIt(run)).then(
        () => toast('success', 'Details copied.'),
        () => toast('error', 'Couldn’t copy the details.'),
      );
  };
  const existing = failure?.code === 'ACCOUNT_EXISTS' ? (accounts?.accounts.find((a) => hostOf(a.serverOrigin) === (failure.host ?? host)) ?? null) : null;

  // A version gate found while connecting: the same cards as screen 9.
  if (failure && (failure.code === 'UPDATE_REQUIRED' || failure.code === 'SERVER_TOO_OLD'))
    return (
      <ConnectFrame title="WorkSuite — Enterprise">
        <div className="flex max-w-full flex-col items-center gap-5">
          {failure.code === 'UPDATE_REQUIRED' ? <UpdateRequiredCard name={host ?? 'This server'} compat={failure.compat} /> : <ServerTooOldCard compat={failure.compat} host={host} />}
          <div className="flex gap-3">
            <Button autoFocus onClick={changeAddress}>
              Change address
            </Button>
          </div>
        </div>
      </ConnectFrame>
    );

  const text = failure ? failureText(failure) : null;
  return (
    <ConnectFrame title="WorkSuite — Enterprise">
      <ConnectCard width={520} className="!gap-0 !p-9">
        <h1 className="m-0 mb-1 truncate text-[24px] font-extrabold text-ink">Checking {host ?? 'the server'}</h1>
        <p className="m-0 mb-3.5 text-[14px] text-ink-3">We verify every server before you sign in.</p>
        {run.candidates.length > 1 ? <p className="m-0 mb-2 text-[12.5px] text-ink-3">Tried: {run.candidates.map(hostOf).join(', ')}</p> : null}
        <ol className="m-0 list-none p-0" aria-label="Server checks" aria-live="polite" aria-busy={run.state === 'running'}>
          {steps.map((s, i) => (
            <StepRow key={s.id} step={s} last={i === steps.length - 1} />
          ))}
        </ol>
        {text ? (
          <div role="alert" className="mt-3.5 rounded-[12px] bg-danger-bg px-4 py-3.5 text-[14px] leading-normal text-danger">
            <b>{text.title}</b> {text.hint}
          </div>
        ) : null}
        {server ? (
          <div role="status" className="mt-3.5 flex items-start gap-3 rounded-[12px] bg-success-bg px-4 py-3.5 text-[14px] text-ink">
            <Icon name="shield-check" size={18} className="mt-0.5 shrink-0 text-success" />
            <div className="min-w-0">
              <b>{server.name}</b>
              <div className="truncate font-mono text-[12.5px] text-ink-2">
                {hostOf(server.origin)} · {server.signed ? 'verified' : 'signature not configured'}
              </div>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 mt-3 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3">
          {run.state === 'running' ? (
            <Button size="lg" className="h-11 rounded-[10px]" onClick={cancel}>
              Cancel
            </Button>
          ) : null}
          {server ? (
            <>
              <Button autoFocus variant="primary" size="lg" loading={busy === 'confirm'} className="h-11 rounded-[10px]" onClick={() => void confirm()}>
                Continue
              </Button>
              <Button size="lg" className="h-11 rounded-[10px]" onClick={changeAddress}>
                Change address
              </Button>
            </>
          ) : null}
          {failure ? (
            <>
              {existing ? (
                <Button variant="primary" size="lg" className="h-11 rounded-[10px]" onClick={() => void call('accounts:switch', { accountId: existing.id }).then(() => app.set({ session: { ...app.get().session, adding: null }, connect: null }), (e) => setError(errorMessage(e)))}>
                  Open
                </Button>
              ) : null}
              <Button autoFocus={!existing} variant={existing ? 'secondary' : 'primary'} size="lg" className="h-11 rounded-[10px]" onClick={changeAddress}>
                Change address
              </Button>
              <Button size="lg" className="h-11 rounded-[10px]" loading={busy === 'retry'} onClick={() => void tryAgain()}>
                Try again
              </Button>
            </>
          ) : null}
        </div>
      </ConnectCard>
      {failure ? (
        <section aria-labelledby="checks-it" className="flex w-[380px] max-w-full flex-col gap-2.5 rounded-[18px] bg-navy p-6 text-navy-ink">
          <h2 id="checks-it" className="m-0 text-[14px] font-bold text-white">
            Details for IT
          </h2>
          <pre className="m-0 font-mono text-[12px] leading-[1.6] break-all whitespace-pre-wrap" data-testid="details-for-it">
            {detailsForIt(run)}
          </pre>
          <button type="button" onClick={() => void copyDetails()} className="h-[38px] rounded-[8px] border border-white/25 bg-transparent text-[13px] font-semibold text-white hover:bg-white/10">
            Copy details
          </button>
          <p className="m-0 text-[11px] text-[#9FB0FF]">No “proceed anyway” — only trusted-server configuration from your IT team can allow this.</p>
        </section>
      ) : null}
    </ConnectFrame>
  );
}
