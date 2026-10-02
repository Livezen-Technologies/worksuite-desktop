import type { LocalProfile } from '@shared/local-workspace';
import { GUEST_APPS } from '@shared/apps';
import { app, isGuest } from './app-state';
import { call } from './bridge';
import { setLanguage } from './i18n';
import { queryClient } from './query';
import { createStore, useStore } from './store';
import { setRegional } from './time';

/**
 * Guest mode (#149): the Local Profile in the main window, with the same shell and module screens as an account.
 * The session's mode is `app.session.mode`; this module moves between the two and keeps their data apart.
 */

/** Whether this window is in guest mode; re-renders when that changes. */
export function useGuest(): boolean {
  return useStore(app, (s) => s.session.mode === 'guest');
}

/** Where the shell starts: Home for an account, Notes for a guest (Home needs an account). */
export function startRoute(): string {
  return isGuest() ? '/notes' : '/home';
}

/** "Continue as Guest": the main window enters guest mode. Its PIN, if any, is asked next (LocalUnlock). */
export async function enterGuestMode(): Promise<void> {
  const status = await call('local:enter');
  // A guest's clock is this computer's; an account's regional settings never carry over.
  setRegional({});
  setLanguage(status.language);
  queryClient.clear();
  app.set({ session: { mode: 'guest', signingIn: false, moveOffer: false }, local: status, apps: GUEST_APPS });
}

/** Back to the sign-in screen, closing the Local Profile (its PIN is asked again next time). */
export async function leaveGuestMode(): Promise<void> {
  await call('local:leave').catch(() => undefined);
  queryClient.clear();
  app.set({ session: { mode: 'account', signingIn: false, moveOffer: false }, local: null, apps: [] });
}

/** The Local Profile was created, edited or unlocked in this window. */
export function setLocalProfile(profile: LocalProfile): void {
  const local = app.get().local;
  app.set({ local: { language: local?.language ?? 'en', ...local, profile, locked: false } });
}

/** Sign in / Create account from guest mode: the sign-in screen, in this window; guest mode stays open behind it. */
export function startSignIn(): void {
  closeSignInPanel();
  app.set({ session: { ...app.get().session, signingIn: true } });
}

/** Back from the sign-in screen to guest mode. */
export function backToGuest(): void {
  app.set({ session: { ...app.get().session, signingIn: false } });
}

/** The move-your-data question was answered (or there was nothing to move). */
export function moveAnswered(): void {
  app.set({ session: { ...app.get().session, moveOffer: false } });
}

/** The in-app "Sign in to use Mail" panel: which locked app a guest asked for. */
export const signInPanel = createStore<{ app: string | null }>({ app: null });
export function openSignInPanel(appId: string): void {
  signInPanel.set({ app: appId });
}
export function closeSignInPanel(): void {
  signInPanel.set({ app: null });
}

/**
 * Whose data the query cache holds: guest mode's, one account's, or nobody's. When that changes — entering or
 * leaving guest mode, signing in, signing out, another account — nothing cached for the previous one is shown.
 */
export function sessionIdentity(): string {
  const s = app.get();
  if (s.session.mode === 'guest') return 'guest';
  return s.auth?.stage === 'ready' ? `account:${s.auth.server?.origin ?? ''}:${s.auth.user?.id ?? ''}` : 'none';
}
export function wireSessionCache(): () => void {
  let last = sessionIdentity();
  return app.subscribe(() => {
    const next = sessionIdentity();
    if (next === last) return;
    last = next;
    queryClient.clear();
  });
}
