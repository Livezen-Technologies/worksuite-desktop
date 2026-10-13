import { useState } from 'react';
import type { AccountsState, AccountView } from '@shared/accounts';
import { startAdding } from '../../core/app-state';
import { call, DesktopError, errorMessage } from '../../core/bridge';
import { closeOverlay } from '../../core/ui';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import { hostOf, signInLabel, switcherLabel } from './labels';

export interface AccountSwitcherProps {
  accounts: AccountsState;
}

/** The accounts in the menu's two groups, in the registry's order. */
export function groupAccounts(list: AccountView[]): { personal: AccountView[]; enterprise: AccountView[] } {
  return { personal: list.filter((a) => a.kind === 'personal'), enterprise: list.filter((a) => a.kind === 'enterprise') };
}

/** What a switch refused says (a call in progress, the app lock), else the error's own words. */
function switchError(e: unknown): string {
  if (e instanceof DesktopError && e.code === 'SWITCH_BLOCKED') return e.message || 'Finish the call, meeting or screen share first, then switch.';
  return errorMessage(e);
}

/**
 * Screen 10's account switcher, in the account menu: PERSONAL and ENTERPRISE, the open account marked (●), the others'
 * unread ("3 new") or "Signed out", and + Add Account. Choosing another account opens it here (≤ 2 s); one signed out
 * opens on its sign-in screen. Blocked accounts are listed, not opened.
 */
export function AccountSwitcher({ accounts }: AccountSwitcherProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const { personal, enterprise } = groupAccounts(accounts.accounts);
  const canAdd = accounts.allowPersonal || accounts.allowAddEnterprise;
  const open = async (a: AccountView) => {
    if (a.active || a.blockedReason) return;
    setBusy(a.id);
    try {
      await call('accounts:switch', { accountId: a.id });
      closeOverlay();
    } catch (e) {
      toast('error', switchError(e));
    } finally {
      setBusy(null);
    }
  };
  const group = (label: string, list: AccountView[]) =>
    list.length ? (
      <div role="group" aria-label={label}>
        <div className="px-3 pt-2.5 pb-0.5 text-[10.5px] font-bold tracking-[1.5px] text-ink-3" aria-hidden>
          {label.toUpperCase()}
        </div>
        {list.map((a) => (
          <Row key={a.id} account={a} busy={busy === a.id} onOpen={() => void open(a)} />
        ))}
      </div>
    ) : null;
  return (
    <div className="flex flex-col border-t border-line px-2 py-1" role="menu" aria-label="Switch account" data-testid="account-switcher">
      {group('Personal', personal)}
      {group('Enterprise', enterprise)}
      {canAdd ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeOverlay();
            startAdding('choose');
          }}
          className="mt-1 flex h-9 items-center gap-2.5 rounded-[9px] px-3 text-left text-[13px] font-semibold text-primary hover:bg-subtle"
        >
          + Add Account
        </button>
      ) : null}
    </div>
  );
}

function Row({ account: a, busy, onOpen }: { account: AccountView; busy: boolean; onOpen: () => void }) {
  const out = signInLabel(a);
  const unread = !a.active && !a.blockedReason && !out && a.unread > 0 ? `${a.unread > 99 ? '99+' : a.unread} new` : null;
  const warn = a.active ? null : a.blockedReason ? 'Blocked' : out;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={a.active}
      aria-disabled={!!a.blockedReason || undefined}
      title={a.blockedReason ?? undefined}
      onClick={onOpen}
      className={cx('flex min-h-9 w-full items-center gap-2.5 rounded-[9px] px-3 py-1.5 text-left text-[13px] text-ink', a.active ? 'bg-selection' : 'hover:bg-subtle', a.blockedReason && 'cursor-not-allowed opacity-60')}
    >
      <span aria-hidden className={cx('h-4 w-4 shrink-0 rounded-full', a.active ? 'border-[5px] border-primary' : 'border-2 border-ink-3/60')} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{switcherLabel(a)}</span>
        {a.kind === 'enterprise' ? <span className="truncate font-mono text-[11.5px] text-ink-3">{hostOf(a.serverOrigin)}</span> : null}
      </span>
      {busy ? <span className="text-[11px] text-ink-3">Opening…</span> : null}
      {a.active ? (
        <span className="text-[11px] text-success" aria-label="Open now" title="Open now">
          ●
        </span>
      ) : null}
      {!busy && warn ? <span className="shrink-0 text-[11px] text-warning">{warn}</span> : null}
      {!busy && unread ? <span className="shrink-0 text-[11px] text-ink-3">{unread}</span> : null}
    </button>
  );
}
