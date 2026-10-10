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
import { OfficeOpenHost } from '../modules/office/open-with';
import { ShowMeHost } from '../modules/ai/help/ShowMe';
import { LockScreen } from './screens/LockScreen';
import { AddPictureScreen } from './screens/AddPictureScreen';
import { LockBoundary } from './Boundaries';
import { ModulesLocked, useModulesLocked } from './screens/MandatoryUpdate';
import { WindowRoot } from './WindowRoot';
import { RemoteControlWindow } from './RemoteControlWindow';
import { WebchatRingWindow } from '../modules/chat/website/Ringing';
import { RingTrayWindow } from '../modules/chat/website/RingTray';
import { LiveMapWindow, WallWindow } from '../modules/chat/website/live/LiveMapWindow';
import { SupportWallWindow } from '../modules/support/Wallboard';
import { SlideShowRoot } from '../modules/office/slides/SlideShowRoot';
import { showFromHash } from '../modules/office/slides/protocol';
import { WallSheetWindow } from '../modules/chat/website/live/WallSheet';
import { QuickAskWindow } from './QuickAskWindow';
import { MailLinkGuard } from '../modules/mail/LinkGuard';
import { MailReminders } from '../modules/mail/Reminders';
import { MailBackgroundSync } from '../modules/mail/BackgroundSync';
import { canOpen } from '../core/access';

// The phone (WS-VOIP-SRS-001): its SIP engine and ring toast, loaded only for someone who has the Phone.
const PhoneHost = lazy(() => import('../modules/phone/softphone/PhoneHost'));
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
  // A required update past its deadline, or a version the server refuses: modules are locked until it is installed.
  const required = useModulesLocked();
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
  // The tray's ringing menu (R-06): what rings says nothing about who while locked, and main never opens it then.
  if (hash.startsWith('#/window/ring-tray')) return <RingTrayWindow />;

  const windowKind = hash.replace('#/window/', '').split('?')[0] ?? '';
  const scope = lockedScope(`app://bundle/${hash}`, windowKind);
  const callWindow = !!scope && scope.kind !== 'chat-mini';
  const lockedCall = callWindow && (!!prefs?.lockedAnswerCalls || scope?.kind === 'ring' && prefs?.lockedCallNotifications === true);
  if (locked && auth.stage === 'ready' && !required && scope?.kind === 'chat-mini' && prefs?.lockedAllowChat && scope.room) return <LockedChat room={scope.room} />;
  let body;
  const guest = session.mode === 'guest' && auth.stage !== 'ready' && !hash.startsWith('#/window/');
  if (required && auth.stage !== 'revoked') body = <ModulesLocked />;
  // A guest never meets the account's picture gate or setup wizard: guest mode is the shell with its own apps.
  else if (guest && !session.signingIn) body = !local?.profile || local.locked ? <GuestGate /> : <Shell key="guest" />;
  else if (auth.stage !== 'ready') body = <Onboarding auth={auth} />;
  else if (hash.startsWith('#/window/quick-ask')) body = <QuickAskWindow />;
  // The Live map window and wall mode on a display (L-04, L-05; MAP-21, MAP-24): Chat's, so only with Chat.
  // The support wallboard on a display (WS-SUPPORT-SRS-001 D-12): the desk's, so only with Support.
  else if (hash.startsWith('#/window/support-wall')) body = canOpen('support') ? <SupportWallWindow /> : null;
  // A presentation's slideshow and presenter view (#321): full screen, opened by Present in a slide viewer or the editor.
  else if (showFromHash(hash)) body = <SlideShowRoot hash={hash} />;
  else if (hash.startsWith('#/window/live-map')) body = canOpen('chat') ? <LiveMapWindow /> : null;
  // The Wall mode sheet before the wall itself: both start with "wall" (L-06, MAP-UI-06).
  else if (hash.startsWith('#/window/wall-sheet')) body = canOpen('chat') ? <WallSheetWindow /> : null;
  else if (hash.startsWith('#/window/wall')) body = canOpen('chat') ? <WallWindow /> : null;
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
      {/* Links clicked in a message are checked here, in the window they were clicked in (ENH-MAIL-03 DMO-SEC-03). */}
      {auth.stage === 'ready' && !locked ? <MailLinkGuard /> : null}
      {/* Due flags, snoozes and events, in the main window only (ENH-MAIL-03 DMO-NTF-05). */}
      {auth.stage === 'ready' && !locked && !guest && !hash.startsWith('#/window/') && canOpen('mail') ? <MailReminders /> : null}
      {/* Keeps mail syncing while the server's sync service is not running, on every screen. */}
      {auth.stage === 'ready' && !guest && !hash.startsWith('#/window/') && canOpen('mail') ? <MailBackgroundSync /> : null}
      {/* The phone stays registered while locked, so a call in progress is not cut off; it rings only when unlocked. */}
      {auth.stage === 'ready' && !guest && !required && !hash.startsWith('#/window/') && session.mode !== 'guest' && canOpen('phone') ? (
        <Suspense fallback={null}>
          <PhoneHost />
        </Suspense>
      ) : null}
      {/* "Open with" for Office files asks here: Ask every time, Save to Drive first?, not installed (#322). */}
      {auth.stage === 'ready' && !locked ? <OfficeOpenHost /> : null}
      <Toasts />
      <ShowMeHost />
    </Suspense>
  );
}
