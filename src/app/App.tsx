import { LockedChat } from './LockedChat';
import { lockedScope } from '@shared/locked-access';
import { ChatSendingStatus } from '../modules/chat/OutgoingMedia';
import { GuestGate } from '../modules/guest/GuestGate';
import { MoveLocalData } from '../modules/guest/MoveLocalData';
import { SignInPanel } from '../modules/guest/SignInPanel';
import { isGuestMeetingHash } from '@shared/guest-meet';
import { Suspense, lazy, useEffect, useState } from 'react';
import type { ToastMessage } from '@shared/types';
import { app } from '../core/app-state';
import { hasDesktop, on } from '../core/bridge';
import { useLanguage } from '../core/i18n';
import { useStore } from '../core/store';
import { toast } from '../core/toasts';
import { closePanelsOnSessionChange } from '../core/ui';
import { Shell } from '../layouts/Shell';
import { Spinner } from '../components/ui';
import { Onboarding, SetupWizard } from './onboarding/Onboarding';
import { Toasts } from './overlays/Toasts';
import { ShowMeHost } from '../modules/ai/help/ShowMe';
import { LockScreen } from './screens/LockScreen';
import { AddPictureScreen } from './screens/AddPictureScreen';
import { LockBoundary } from './Boundaries';
import { UpdateRequired } from './screens/UpdateScreens';
import { WindowRoot } from './WindowRoot';
import { RemoteControlWindow } from './RemoteControlWindow';
import { WebchatRingWindow } from '../modules/chat/website/Ringing';
import { QuickAskWindow } from './QuickAskWindow';

const GuestMeeting = lazy(() => import('../modules/meet/GuestMeeting').then((module) => ({ default: module.GuestMeeting })));

/**
 * Top level: which screen this window shows, from the session stage.
 * Lock and Update Required sit above everything, so a locked or unsupported
 * app never renders the workspace underneath.
 */
export function App() {
  // Messages from the main process, on every screen — including sign-in, where
  // a refused passkey callback or a server warning has to be seen too.
  useEffect(() => (hasDesktop() ? on<ToastMessage>('toast', (t) => toast(t.kind, t.text)) : undefined), []);
  // Signed in, out, locked or unlocked: the workspace comes back with no menu or panel open (worksuite-desktop#150).
  useEffect(() => closePanelsOnSessionChange(), []);
  useLanguage();
  const ready = useStore(app, (s) => s.ready);
  const auth = useStore(app, (s) => s.auth);
  const prefs = useStore(app, s => s.prefs);
  const locked = useStore(app, (s) => s.lock?.locked ?? false);
  const required = useStore(app, (s) => s.update?.required ?? false);
  // A profile picture the server requires (#46). Not from a copy kept offline: nothing could be sent, so it would only lock the app.
  const pictureOwedBy = useStore(app, (s) => (s.bootstrap?.user.pictureRequired === true && !s.bootstrap.offline ? s.bootstrap.user.id : null));
  // Who has just sent one, so a refresh that fails does not bring the screen back — for them, not the next person to sign in.
  const [pictureSentBy, setPictureSentBy] = useState<string | null>(null);
  // Guest mode (#149): this window, this shell; `signingIn` shows sign-in in front of it.
  const session = useStore(app, (s) => s.session);
  const local = useStore(app, (s) => s.local);
  const hash = window.location.hash;

  if (!hasDesktop()) {
    return <div className="flex h-full items-center justify-center p-8 text-center text-ink-2">WorkSuite Desktop's interface runs inside the desktop app.</div>;
  }
  if (isGuestMeetingHash(hash)) return <Suspense fallback={<Spinner />}><GuestMeeting /></Suspense>;
  if (!ready || !auth) return <Spinner label="Starting WorkSuite…" className="h-full" />;
  // Remote control's prompt and bar: above everything else, and never behind the lock screen — stopping control must always work.
  if (hash.startsWith('#/rc/')) return <RemoteControlWindow hash={hash} />;
  // The website-chat call window: above the lock screen too, saying only that a chat waits while locked (RING-40).
  if (hash.startsWith('#/window/webchat-ring')) return <WebchatRingWindow />;

  const windowKind = hash.replace('#/window/', '').split('?')[0] ?? '';
  const scope = lockedScope(`app://bundle/${hash}`, windowKind);
  const callWindow = !!scope && scope.kind !== 'chat-mini';
  const lockedCall = callWindow && (!!prefs?.lockedAnswerCalls || scope?.kind === 'ring' && prefs?.lockedCallNotifications === true);
  if (locked && auth.stage === 'ready' && !required && scope?.kind === 'chat-mini' && prefs?.lockedAllowChat && scope.room) return <LockedChat room={scope.room} />;
  let body;
  const guest = session.mode === 'guest' && auth.stage !== 'ready' && !hash.startsWith('#/window/');
  if (required && auth.stage !== 'revoked') body = <UpdateRequired />;
  // A guest never meets the account's picture gate or setup wizard: guest mode is the shell with its own apps.
  else if (guest && !session.signingIn) body = !local?.profile || local.locked ? <GuestGate /> : <Shell key="guest" />;
  else if (auth.stage !== 'ready') body = <Onboarding auth={auth} />;
  else if (hash.startsWith('#/window/quick-ask')) body = <QuickAskWindow />;
  else if (hash.startsWith('#/window/')) body = <WindowRoot hash={hash} />;
  else if (auth.setupPending) body = <SetupWizard />;
  else if (pictureOwedBy !== null && pictureOwedBy !== pictureSentBy) body = <AddPictureScreen onDone={() => setPictureSentBy(pictureOwedBy)} />;
  else body = <Shell key="account" />;

  return (
    <Suspense fallback={<Spinner className="h-full" />}>
      {callWindow ? <><div className={locked && !lockedCall ? 'hidden' : 'h-full'}>{body}</div>{locked && !lockedCall ? <LockScreen /> : null}</> : locked && auth.stage === 'ready' ? (
        <LockBoundary>
          <LockScreen />
        </LockBoundary>
      ) : (
        body
      )}
      {!locked && auth.stage === 'ready' ? <ChatSendingStatus /> : null}
      {guest ? <SignInPanel /> : null}
      {auth.stage === 'ready' && !locked && !hash.startsWith('#/window/') ? <MoveLocalData /> : null}
      <Toasts />
      <ShowMeHost />
    </Suspense>
  );
}
