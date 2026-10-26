import { useState } from 'react';
import type { AccountView } from '@shared/accounts';
import { app, startAdding } from '../../core/app-state';
import { call, DesktopError, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Empty, cx } from '../../components/ui';
import { AccountBadge } from '../../app/accounts/AccountBadge';
import { openRemove, openSignOut } from '../../app/accounts/dialogs';
import { isSignedIn, settingsTitle, signInLabel } from '../../app/accounts/labels';
import { ConnectionHealth } from './ConnectionHealth';

/** The line under an account in Settings: who, and what state it is in. */
export function accountLine(a: AccountView): { text: string; warn: boolean } {
  const parts: string[] = [];
  if (a.user?.email) parts.push(a.user.email);
  const out = signInLabel(a);
  let warn = false;
  if (a.blockedReason) {
    parts.push(a.blockedReason);
    warn = true;
  } else if (out) {
    parts.push(out.toLowerCase());
    warn = true;
  } else if (a.active) parts.push('active now');
  if (a.managed) parts.push('managed by your organization');
  if (a.pendingChanges > 0) parts.push(`${a.pendingChanges} pending ${a.pendingChanges === 1 ? 'change' : 'changes'} kept`);
  if (a.syncPaused && !a.active && isSignedIn(a)) parts.push('Sync paused while another account is open');
  return { text: parts.join(' · '), warn };
}

const SB = 'h-8 shrink-0 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Settings › Accounts & Servers (screen 15): every account on this computer — Open (or Sign in), Sign out, Remove
 * from this device, or "Removal set by IT policy" for one IT set up — what each keeps that has not synced, + Add
 * Account, and the selected account's connection health.
 */
export function AccountsServers() {
  const accounts = useStore(app, (s) => s.accounts);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!accounts)
    return (
      <>
        <Heading />
        <Empty icon="server" title="Accounts aren’t available in this version" hint="This computer has one WorkSuite server. Change it from the sign-in screen." />
      </>
    );
  const list = accounts.accounts;
  const shown = list.find((a) => a.id === selected) ?? list.find((a) => a.active) ?? list[0] ?? null;
  const open = async (a: AccountView) => {
    setBusy(a.id);
    try {
      await call('accounts:switch', { accountId: a.id });
    } catch (e) {
      toast('error', e instanceof DesktopError && e.code === 'SWITCH_BLOCKED' ? e.message || 'Finish the call first, then switch.' : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Heading />
      <div className="flex flex-wrap items-start gap-6">
        <section aria-label="Accounts" className="min-w-[320px] flex-1 overflow-hidden rounded-[14px] border border-line bg-surface">
          <ul className="m-0 list-none p-0">
            {list.map((a) => {
              const line = accountLine(a);
              const signedIn = isSignedIn(a);
              return (
                <li
                  key={a.id}
                  className={cx('flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5', shown?.id === a.id && 'bg-selection/40')}
                  data-testid={`account-row-${a.id}`}
                >
                  <AccountBadge account={a} size={36} />
                  <button type="button" className="min-w-[160px] flex-1 text-left" aria-pressed={shown?.id === a.id} title="Show its connection health" onClick={() => setSelected(a.id)}>
                    <span className="block truncate text-[14px] font-bold text-ink">{settingsTitle(a)}</span>
                    <span className={cx('block truncate text-[12.5px]', line.warn ? 'text-warning' : 'text-ink-3')}>{line.text}</span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    {a.active && signedIn ? (
                      <button type="button" className={SB} disabled aria-label={`${settingsTitle(a)} is open`}>
                        Open
                      </button>
                    ) : (
                      <button type="button" className={SB} disabled={!!a.blockedReason || busy === a.id} onClick={() => void open(a)}>
                        {busy === a.id ? 'Opening…' : signedIn ? 'Open' : 'Sign in'}
                      </button>
                    )}
                    {signedIn ? (
                      <button type="button" className={SB} onClick={() => openSignOut(a.id)}>
                        Sign out
                      </button>
                    ) : null}
                    {a.removable ? (
                      <button type="button" className={cx(SB, 'text-danger')} onClick={() => openRemove(a.id)}>
                        Remove from this device
                      </button>
                    ) : (
                      <span className="w-[160px] text-[12px] text-ink-3">{a.removalReason ?? 'Removal set by IT policy'}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {accounts.allowPersonal || accounts.allowAddEnterprise ? (
            <div className="px-4 py-3">
              <button type="button" className={cx(SB, 'text-primary')} onClick={() => startAdding('choose')}>
                + Add Account
              </button>
            </div>
          ) : null}
        </section>
        {shown ? (
          <div className="w-[360px] max-w-full">
            <ConnectionHealth key={shown.id} account={shown} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function Heading() {
  return (
    <div className="mb-5">
      <h2 className="text-[20px] leading-tight font-bold text-ink">Accounts &amp; Servers</h2>
      <p className="mt-1 text-[13.5px] text-ink-3">Personal and Enterprise accounts on this computer, side by side. Each keeps its own data, sign-in and settings.</p>
    </div>
  );
}
