import { useState, type FormEvent } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { field, Panel } from './parts';

/** An owner reset this password, so it is chosen here before anything is sold under this name. */
export function ChangePassword({ onDone }: { onDone: () => void }) {
  const [oldPassword, setOld] = useState('');
  const [password, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call('posLocal:changePassword', { oldPassword, newPassword: password });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Choose a new password" sub="An owner set the one you just used. Choose your own before you sell.">
      <form onSubmit={submit} className="flex w-[340px] max-w-full flex-col gap-3" aria-label="Choose a new password">
        <label htmlFor="pw-old" className="text-[13px] font-semibold text-ink">
          The password you were given
        </label>
        <input id="pw-old" type="password" autoFocus autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} className={field} />
        <label htmlFor="pw-new" className="text-[13px] font-semibold text-ink">
          New password
        </label>
        <input id="pw-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setNew(e.target.value)} className={field} />
        <label htmlFor="pw-confirm" className="text-[13px] font-semibold text-ink">
          New password again
        </label>
        <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
        <button type="submit" disabled={busy || password.length < 8 || password !== confirm} className="mt-1 flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
          {busy ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : null}
          Save and carry on
        </button>
        {error ? (
          <div role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
            {error}
          </div>
        ) : null}
      </form>
    </Panel>
  );
}
