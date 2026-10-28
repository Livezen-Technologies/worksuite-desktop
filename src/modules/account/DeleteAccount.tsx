import { useEffect, useState } from 'react';
import type { AccountDeletion } from '@shared/cloud';
import { call, errorMessage } from '../../core/bridge';
import { Button, Card } from '../../components/ui';

/**
 * Deleting this WorkSuite Cloud account, begun here rather than on a web page: Apple's App Review 5.1.1(v) asks an
 * app that creates accounts to let a person start removing theirs from inside it. [ENH-AUTH-01 §5]
 *
 * Nothing goes at once — the server schedules it, emails the confirmation and keeps a grace period in which the
 * link in that email calls the whole thing off. Scheduling ends every sign-in this account has, this app's
 * included, so the app signs out as soon as it is done.
 */
export function DeleteAccount() {
  const [state, setState] = useState<AccountDeletion | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call('cloud:deletionState').then(setState, () => undefined);
  }, []);

  const blocked = (state?.blockers?.length ?? 0) > 0;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await call('cloud:requestDeletion', { confirm, password });
      setState((s) => (s ? { ...s, scheduled_for: out.scheduledFor } : s));
      setOpen(false);
      setPassword('');
      setConfirm('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (state?.scheduled_for)
    return (
      <Card title="Account deletion">
        <p className="m-0 text-[13.5px] leading-[1.55] text-ink-3">
          This account and everything in it will be deleted on <span className="font-semibold text-ink">{new Date(state.scheduled_for).toLocaleDateString()}</span>. The email we sent has the link that
          calls it off.
        </p>
      </Card>
    );

  return (
    <Card title="Delete this account">
      <p className="m-0 text-[13.5px] leading-[1.55] text-ink-3">
        Everything in this WorkSuite Cloud account — mail, files, chats and calendars — is removed after a short grace period. Invoices already issued are kept, as the law requires.
      </p>
      {blocked ? (
        <ul className="m-0 mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-ink-3">
          {state?.blockers.map((b) => (
            <li key={b.organization_id}>{b.message}</li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className="mt-3.5 flex flex-col gap-2.5">
          <label htmlFor="delete-confirm" className="text-[13px] font-semibold text-ink">
            Type DELETE to confirm
          </label>
          <input id="delete-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} maxLength={16} className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-danger" />
          <label htmlFor="delete-password" className="text-[13px] font-semibold text-ink">
            Your password
          </label>
          <input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={256} className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-danger" />
          {error ? (
            <div role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
              {error}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button size="lg" variant="danger" disabled={busy || confirm !== 'DELETE' || !password} onClick={() => void go()}>
              Delete my account
            </Button>
            <Button size="lg" onClick={() => (setOpen(false), setError(null))}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3.5">
          <Button size="lg" variant="danger" disabled={blocked} onClick={() => setOpen(true)}>
            Delete this account
          </Button>
        </div>
      )}
    </Card>
  );
}
