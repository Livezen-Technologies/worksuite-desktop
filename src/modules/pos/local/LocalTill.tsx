import { useCallback, useEffect, useState } from 'react';
import type { PosLocalState } from '@shared/pos';
import { call, errorMessage } from '../../../core/bridge';
import { Spinner } from '../../../components/ui';
import { screenFor, type TillScreen } from './state';
import { FirstRun } from './FirstRun';
import { SignIn } from './SignIn';
import { ChangePassword } from './ChangePassword';
import { RegisterClosed } from './RegisterClosed';
import { OfflineRegister } from './OfflineRegister';

/**
 * The offline till (ENH-POS-01 §1, phase 3): a shop's own computer, selling with no WorkSuite server and no Cloud
 * account. Addressed as `/pos?mode=offline`.
 *
 * Which screen shows is decided by what the main process says — whether anybody has been made yet, who is signed
 * in, whether they still owe a new password, and whether the register is open. The screens hide what a person may
 * not do, and the main process refuses it again whatever the screen believes.
 */
export interface OpenRegister {
  id: string;
  openedAt: string;
  openedBy: string;
  float: number;
}

export function LocalTill() {
  const [state, setState] = useState<PosLocalState | null>(null);
  const [register, setRegister] = useState<OpenRegister | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The till's state and its register, as one refresh: both decide the screen. */
  const refresh = useCallback(async () => {
    try {
      const next = await call('posLocal:state');
      setState(next);
      setRegister(next.signedIn && !next.mustChangePassword ? await call('posLocal:register') : null);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* The till signs itself out after ten quiet minutes; the screen finds out by asking. */
  useEffect(() => {
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const screen: TillScreen = screenFor(state, !!register);

  if (screen === 'loading')
    return (
      <div className="flex h-full items-center justify-center">
        {error ? <p className="text-[14px] text-danger">{error}</p> : <Spinner />}
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-ground">
      {screen === 'first-run' ? <FirstRun onDone={refresh} /> : null}
      {screen === 'sign-in' ? <SignIn onDone={refresh} /> : null}
      {screen === 'change-password' ? <ChangePassword onDone={refresh} /> : null}
      {screen === 'closed' ? <RegisterClosed state={state!} onDone={refresh} /> : null}
      {screen === 'selling' ? <OfflineRegister state={state!} register={register!} onDone={refresh} /> : null}
    </div>
  );
}
