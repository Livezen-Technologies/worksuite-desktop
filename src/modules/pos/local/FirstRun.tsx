import { useState, type FormEvent } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { field, Panel } from './parts';

/**
 * A till nobody has opened yet. The first person made is its owner, whatever is asked for — there is nobody to
 * grant it — and they are signed in straight away, because somebody has to be.
 */
export function FirstRun({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ username: '', displayName: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const ready = form.username.trim().length >= 2 && form.password.length >= 8 && form.password === form.confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call('posLocal:addUser', { username: form.username.trim().toLowerCase(), displayName: form.displayName.trim() || form.username.trim(), password: form.password, role: 'owner' });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Set up this till" sub="Everything stays on this computer. No WorkSuite account is needed, and the till works with no internet at all.">
      <form onSubmit={submit} className="flex w-[360px] max-w-full flex-col gap-3" aria-label="Set up this till">
        <label htmlFor="till-username" className="text-[13px] font-semibold text-ink">
          Username
        </label>
        <input id="till-username" autoFocus autoComplete="username" maxLength={32} value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))} className={field} />
        <label htmlFor="till-name" className="text-[13px] font-semibold text-ink">
          Name on receipts
        </label>
        <input id="till-name" maxLength={80} value={form.displayName} onChange={set('displayName')} className={field} />
        <label htmlFor="till-password" className="text-[13px] font-semibold text-ink">
          Password
        </label>
        <input id="till-password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} className={field} aria-describedby="till-password-hint" />
        <p id="till-password-hint" className="m-0 text-[12px] text-ink-3">
          At least eight characters. There is no way to reset it from outside this computer — an owner resets everybody else's.
        </p>
        <label htmlFor="till-confirm" className="text-[13px] font-semibold text-ink">
          Password again
        </label>
        <input id="till-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} className={field} />
        <button type="submit" disabled={busy || !ready} className="mt-1 flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
          {busy ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : null}
          Open the till
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
