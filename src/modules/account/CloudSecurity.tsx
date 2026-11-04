import { useCallback, useEffect, useState } from 'react';
import type { CloudTwoStep } from '@shared/cloud';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Spinner } from '../../components/ui';
import { Card, Head, Note } from '../../components/CardKit';
import { openWeb } from './Storage';
import { BackupCodes, CodeBoxes, Qr } from './TwoFactor';

type Step = { kind: 'idle' } | { kind: 'proof'; then: 'start' | 'codes' | 'off' } | { kind: 'scan'; secret: string; uri: string } | { kind: 'codes'; codes: string[] };

/**
 * A personal (WorkSuite Cloud) account's Security: two-step verification with an authenticator app, set up, moved,
 * given new recovery codes and turned off here. Each change asks for the password again, or a current code: the app's
 * sign-in is never "just now" to Cloud. Passkeys are added on the web, where WebAuthn knows the Cloud's address.
 */
export default function CloudSecurity() {
  const [state, setState] = useState<CloudTwoStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(() => {
    call('cloud:twoStep').then(
      (s) => {
        setError(null);
        setState(s);
      },
      (e) => setError(errorMessage(e)),
    );
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFailed(null);
    try {
      await fn();
    } catch (e) {
      setFailed(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const proof = () => (password ? { password } : { code });
  const prove = (then: 'start' | 'codes' | 'off') =>
    run(async () => {
      if (then === 'start') {
        const s = await call('cloud:twoStepStart', proof());
        setCode('');
        setStep({ kind: 'scan', ...s });
      } else if (then === 'codes') {
        const r = await call('cloud:twoStepRecoveryCodes', proof());
        setState(r);
        setStep({ kind: 'codes', codes: r.recoveryCodes });
      } else {
        setState(await call('cloud:twoStepDisable', proof()));
        setStep({ kind: 'idle' });
        toast('info', 'Two-step verification is off.');
      }
      setPassword('');
    });
  const confirm = (c: string) =>
    run(async () => {
      const r = await call('cloud:twoStepConfirm', { code: c });
      setState(r);
      setStep({ kind: 'codes', codes: r.recoveryCodes });
    });

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <Head title="Security" sub="How your WorkSuite Cloud account signs in." />
      <Card title="Two-step verification">
        {error ? (
          <div role="alert" className="flex items-center gap-3 text-[13px] text-danger">
            {error}
            <Button size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        ) : !state ? (
          <Spinner />
        ) : step.kind === 'proof' ? (
          <form
            className="flex max-w-[380px] flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void prove(step.then);
            }}
          >
            <p className="m-0 text-[13px] text-ink-2">Confirm it is you: enter your password{state.enabled ? ', or a current code from your authenticator' : ''}.</p>
            <label htmlFor="cloud-sec-password" className="text-[13px] font-semibold text-ink">
              Password
            </label>
            <input id="cloud-sec-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-primary" />
            {state.enabled ? (
              <>
                <label htmlFor="cloud-sec-code" className="text-[13px] font-semibold text-ink">
                  Or a code
                </label>
                <input id="cloud-sec-code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} className="h-10 rounded-[10px] border border-line bg-surface px-3 font-mono text-[14px] text-ink outline-none focus:border-primary" />
              </>
            ) : null}
            {failed ? <p role="alert" className="m-0 text-[12.5px] text-danger">{failed}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={busy || (!password && code.length < 6)}>
                {busy ? <Spinner /> : 'Continue'}
              </Button>
              <Button type="button" onClick={() => setStep({ kind: 'idle' })}>
                Cancel
              </Button>
            </div>
          </form>
        ) : step.kind === 'scan' ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[13px] text-ink-2">Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the 6-digit code it shows.</p>
            <div className="flex flex-wrap items-start gap-5">
              <Qr text={step.uri} />
              <div className="flex flex-col gap-2 text-[12.5px] text-ink-3">
                <span>Can&apos;t scan? Enter this key:</span>
                <code className="rounded-[8px] bg-subtle px-2 py-1 font-mono text-[13px] break-all text-ink">{step.secret}</code>
              </div>
            </div>
            <CodeBoxes value={code} onChange={setCode} onDone={(c) => void confirm(c)} disabled={busy} />
            {failed ? <p role="alert" className="m-0 text-[12.5px] text-danger">{failed}</p> : null}
            <div>
              <Button onClick={() => setStep({ kind: 'idle' })}>Cancel</Button>
            </div>
          </div>
        ) : step.kind === 'codes' ? (
          <div className="flex flex-col gap-3">
            <Note tone="green">Two-step verification is on. Keep these recovery codes somewhere safe: each one signs you in once if your phone is not to hand.</Note>
            <BackupCodes codes={step.codes} />
            <div>
              <Button variant="primary" onClick={() => setStep({ kind: 'idle' })}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[13.5px] text-ink">
              {state.enabled ? (
                <>
                  <b>On</b> — signing in asks for a code from your authenticator app. {state.recoveryCodesLeft} recovery code{state.recoveryCodesLeft === 1 ? '' : 's'} left.
                </>
              ) : (
                <>
                  <b>Off</b> — your password alone signs you in. Turn this on so a stolen password is not enough.
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {state.enabled ? (
                <>
                  <Button onClick={() => setStep({ kind: 'proof', then: 'start' })}>Move to a new phone</Button>
                  <Button onClick={() => setStep({ kind: 'proof', then: 'codes' })}>New recovery codes</Button>
                  <Button variant="danger" onClick={() => setStep({ kind: 'proof', then: 'off' })}>
                    Turn off
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => setStep({ kind: 'proof', then: 'start' })}>
                  Turn on two-step verification
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
      <Card title="Passkeys">
        <p className="m-0 text-[13px] text-ink-2">A passkey signs you in with your fingerprint, face or device PIN instead of a password. Passkeys are added in your browser, on your WorkSuite Cloud account page, because they belong to its web address.</p>
        <div className="mt-3">
          <Button onClick={() => void openWeb('security').catch(() => undefined)}>Manage passkeys in the browser</Button>
        </div>
      </Card>
    </div>
  );
}
