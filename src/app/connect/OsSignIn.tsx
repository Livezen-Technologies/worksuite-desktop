import { useState } from 'react';
import type { AuthState } from '@shared/types';
import { Button } from '../../components/ui';
import { call, errorMessage } from '../../core/bridge';
import { ConnectCard, ConnectFrame } from './ConnectFrame';

/**
 * WorkSuite OS mode (docs/WORKSUITE_OS.md): the OS signs in, through its credentials broker in the system browser.
 * This screen never asks for a password; it says what is happening, or what went wrong, and offers to try again.
 */
export function OsSignIn({ auth }: { auth: AuthState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inBrowser = auth.stage === 'browser';
  const message = error ?? auth.message;
  const signIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await call('auth:osSignIn');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConnectFrame title="WorkSuite">
      <ConnectCard className="items-center gap-[18px] text-center" width={520}>
        <h1 className="m-0 text-[24px] font-extrabold text-ink">{inBrowser ? 'Finish signing in in your browser' : 'Sign in with WorkSuite OS'}</h1>
        <p className="m-0 text-[15px] leading-[1.6] text-ink-3">
          {inBrowser
            ? 'WorkSuite OS opened your WorkSuite sign-in page in the browser. Sign in there — WorkSuite will continue here automatically.'
            : 'WorkSuite uses the account you signed in to WorkSuite OS with. Your password is never entered here.'}
        </p>
        {message ? (
          <p role="alert" className="m-0 text-[14px] text-danger">
            {message}
          </p>
        ) : null}
        {inBrowser ? null : (
          <Button variant="primary" size="lg" loading={busy} onClick={() => void signIn()}>
            Sign in with WorkSuite OS
          </Button>
        )}
      </ConnectCard>
    </ConnectFrame>
  );
}
