import { useRef, useState, type KeyboardEvent } from 'react';
import type { AccountsState, AccountView } from '@shared/accounts';
import { app, startAdding } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { enterGuestMode } from '../../core/session';
import { Checkbox } from '../../components/Checkbox';
import { cx } from '../../components/ui';
import { AccountBadge } from '../accounts/AccountBadge';
import { chooserName, hostOf, isSignedIn, signInLabel, usedAgo } from '../accounts/labels';
import { ConnectFrame } from './ConnectFrame';

export interface WorkspaceChooserProps {
  accounts: AccountsState;
}

/** The line under an account's name on screen 11. */
export function chooserLine(a: AccountView, now = Date.now()): { text: string; warn: boolean } {
  const parts: string[] = [a.kind === 'personal' ? 'Personal · WorkSuite Cloud' : `Enterprise · ${hostOf(a.serverOrigin)}`];
  const signedOut = signInLabel(a);
  let warn = false;
  if (a.blockedReason) {
    parts.push(a.blockedReason);
    warn = true;
  } else if (signedOut) {
    parts.push(signedOut.toLowerCase());
    warn = true;
  } else if (a.reachability === 'offline') parts.push('offline until reconnect');
  else {
    const ago = usedAgo(a.lastUsedAt, now);
    if (ago) parts.push(`last used ${ago}`);
  }
  if (a.pendingChanges > 0) parts.push(`${a.pendingChanges} pending ${a.pendingChanges === 1 ? 'change' : 'changes'}`);
  return { text: parts.join(' · '), warn };
}

/**
 * Screen 11 — the workspace chooser at startup (two or more accounts, and "Always show this at startup" or the last
 * account signed out or out of reach): every account with Open or Sign in, + Add Account, and the checkbox.
 * ↑ ↓ move between the accounts.
 */
export function WorkspaceChooser({ accounts }: WorkspaceChooserProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [always, setAlways] = useState(accounts.chooserAlways);
  const list = useRef<HTMLUListElement>(null);
  const shown = accounts.accounts;
  const first = shown.find((a) => a.active && !a.blockedReason) ?? shown.find((a) => !a.blockedReason) ?? null;

  const open = async (a: AccountView) => {
    setBusy(a.id);
    setError(null);
    try {
      const next = await call('accounts:startupChoice', { accountId: a.id });
      app.set({ accounts: next });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const guest = async () => {
    setError(null);
    try {
      app.set({ accounts: await call('accounts:startupChoice', { accountId: null }) });
      await enterGuestMode();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const toggleAlways = (v: boolean) => {
    setAlways(v);
    void call('accounts:setChooser', { always: v }).then(
      (next) => app.set({ accounts: next }),
      (e) => {
        setAlways(!v);
        setError(errorMessage(e));
      },
    );
  };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-account]:not(:disabled)') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <ConnectFrame title="WorkSuite">
      <div className="flex w-[640px] max-w-full flex-col items-center gap-3.5">
        <h1 id="chooser-title" className="m-0 mb-2.5 text-[30px] font-extrabold text-ink">
          Choose WorkSuite workspace
        </h1>
        <ul ref={list} aria-labelledby="chooser-title" className="m-0 flex w-full list-none flex-col gap-3 p-0" onKeyDown={onKey}>
          {shown.map((a) => {
            const line = chooserLine(a);
            const signIn = !isSignedIn(a);
            return (
              <li key={a.id} className={cx('flex items-center gap-4 rounded-[14px] border border-line bg-surface px-5 py-4', a.blockedReason && 'opacity-60')}>
                <AccountBadge account={a} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-bold text-ink">{chooserName(a)}</div>
                  <div className={cx('truncate text-[13px]', line.warn ? 'text-warning' : 'text-ink-3')}>{line.text}</div>
                </div>
                <button
                  type="button"
                  data-account={a.id}
                  autoFocus={a.id === first?.id}
                  disabled={!!a.blockedReason || busy !== null}
                  aria-label={`${signIn ? 'Sign in to' : 'Open'} ${chooserName(a)}`}
                  onClick={() => void open(a)}
                  className={cx(
                    'h-10 min-w-[96px] rounded-[10px] px-4 text-[14px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ws-focus)] disabled:cursor-not-allowed disabled:opacity-60',
                    signIn ? 'border border-primary bg-surface text-primary hover:bg-selection' : 'bg-primary text-white hover:bg-primary-hover',
                  )}
                >
                  {busy === a.id ? 'Opening…' : signIn ? 'Sign in' : 'Open'}
                </button>
              </li>
            );
          })}
        </ul>
        {accounts.allowPersonal || accounts.allowAddEnterprise ? (
          <button type="button" onClick={() => startAdding('choose')} className="h-14 w-full rounded-[14px] border-[1.5px] border-dashed border-ink-3/60 bg-transparent text-[15px] font-semibold text-primary hover:bg-subtle">
            + Add Account
          </button>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-[13.5px] text-ink-3">
          <Checkbox checked={always} onChange={(e) => toggleAlways(e.target.checked)} />
          Always show this at startup
        </label>
        {accounts.guestAvailable ? (
          <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void guest()}>
            Use without an account
          </button>
        ) : null}
      </div>
    </ConnectFrame>
  );
}
