import { useState, type FormEvent } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { field, Panel } from './parts';

const REFUSALS: Record<string, string> = {
  unknown: 'No such username on this till.',
  wrong: 'That password is not right.',
  suspended: 'This account is suspended. An owner can lift it.',
};

/** Signing in to the till. A held account says when it will let go rather than repeating "wrong". */
export function SignIn({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await call('posLocal:signIn', { username: username.trim().toLowerCase(), password });
      if ('refused' in out) {
        const until = out.lockedUntil ? new Date(out.lockedUntil) : null;
        setError(out.refused === 'locked' && until ? `Too many wrong passwords. Try again after ${until.toLocaleTimeString()}.` : (REFUSALS[out.refused] ?? 'That did not work.'));
        setPassword('');
        return;
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Sign in to the till">
      <form onSubmit={submit} className="flex w-[340px] max-w-full flex-col gap-3" aria-label="Sign in to the till">
        <label htmlFor="till-user" className="text-[13px] font-semibold text-ink">
          Username
        </label>
        <input id="till-user" autoFocus autoComplete="username" maxLength={32} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} className={field} />
        <label htmlFor="till-pass" className="text-[13px] font-semibold text-ink">
          Password
        </label>
        <input id="till-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} aria-invalid={error ? true : undefined} />
        <button type="submit" disabled={busy || !username.trim() || !password} className="mt-1 flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
          {busy ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : null}
          Sign in
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
