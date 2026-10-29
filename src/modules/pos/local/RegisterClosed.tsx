import { useState, type FormEvent } from 'react';
import type { PosLocalState } from '@shared/pos';
import { call, errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { can, money, parseMoney } from './state';
import { field, Panel } from './parts';

/**
 * The register is shut. Nothing can be sold until somebody opens it with what is in the drawer, because the
 * drawer's expected cash is counted from that float onwards — a till opened with a guess is a till that cannot
 * be reconciled at the end of the day.
 */
export function RegisterClosed({ state, onDone }: { state: PosLocalState; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const float = parseMoney(typed);
  const mayOpen = can(state, 'open_register');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (float === null) return;
    setBusy(true);
    setError(null);
    try {
      await call('posLocal:openRegister', { float });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="The register is closed" sub={mayOpen ? 'Count what is in the drawer and open it.' : 'Somebody who may open the register has to start the day.'}>
      <form onSubmit={submit} className="flex w-[320px] max-w-full flex-col gap-3" aria-label="Open the register">
        <label htmlFor="till-float" className="text-[13px] font-semibold text-ink">
          Cash in the drawer
        </label>
        <input id="till-float" inputMode="decimal" autoFocus={mayOpen} disabled={!mayOpen} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="0.00" className={`${field} text-right font-mono text-[18px]`} />
        {typed && float === null ? <p className="m-0 text-[12px] text-danger">That is not an amount.</p> : null}
        {float !== null && typed ? <p className="m-0 text-[12px] text-ink-3">Opening with {money(float)}.</p> : null}
        <button type="submit" disabled={!mayOpen || busy || float === null} className="mt-1 flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
          {busy ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : null}
          Open the register
        </button>
        {error ? (
          <div role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
            {error}
          </div>
        ) : null}
        <button type="button" onClick={() => void call('posLocal:signOut').then(onDone)} className="self-center text-[13px] text-ink-3 hover:underline">
          Sign out
        </button>
      </form>
    </Panel>
  );
}
