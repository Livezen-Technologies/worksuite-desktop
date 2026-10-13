import { app } from '../../core/app-state';
import { createStore, useStore } from '../../core/store';
import { RemoveAccountDialog } from './RemoveAccountDialog';
import { SignOutDialog } from './SignOutDialog';

/**
 * Sign out (screen 14) and Remove from this device, opened from the account menu or Settings: the dialogs live here,
 * outside the menu that opened them, so closing the menu never closes them.
 */
export const accountDialogs = createStore<{ signOut: string | null; remove: string | null }>({ signOut: null, remove: null });

export function openSignOut(accountId: string): void {
  accountDialogs.set({ signOut: accountId, remove: null });
}

export function openRemove(accountId: string): void {
  accountDialogs.set({ signOut: null, remove: accountId });
}

export function closeAccountDialogs(): void {
  accountDialogs.set({ signOut: null, remove: null });
}

export function AccountDialogsHost() {
  const { signOut, remove } = useStore(accountDialogs, (s) => s);
  const accounts = useStore(app, (s) => s.accounts?.accounts ?? null);
  const find = (id: string | null) => (id ? (accounts?.find((a) => a.id === id) ?? null) : null);
  const out = find(signOut);
  const rm = find(remove);
  if (out) return <SignOutDialog key={out.id} account={out} onClose={closeAccountDialogs} />;
  if (rm) return <RemoveAccountDialog key={rm.id} account={rm} onClose={closeAccountDialogs} />;
  return null;
}
