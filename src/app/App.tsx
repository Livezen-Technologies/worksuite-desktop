import { Suspense, useEffect } from 'react';
import type { ToastMessage } from '@shared/types';
import { app } from '../core/app-state';
import { hasDesktop, on } from '../core/bridge';
import { useLanguage } from '../core/i18n';
import { useStore } from '../core/store';
import { toast } from '../core/toasts';
import { Shell } from '../layouts/Shell';
import { Spinner } from '../components/ui';
import { Onboarding, SetupWizard } from './onboarding/Onboarding';
import { Toasts } from './overlays/Toasts';
import { ShowMeHost } from '../modules/ai/help/ShowMe';
import { LockScreen } from './screens/LockScreen';
import { LockBoundary } from './Boundaries';
import { UpdateRequired } from './screens/UpdateScreens';
import { WindowRoot } from './WindowRoot';
import { RemoteControlWindow } from './RemoteControlWindow';
import { WebchatRingWindow } from '../modules/chat/website/Ringing';
import { QuickAskWindow } from './QuickAskWindow';

/**
 * Top level: which screen this window shows, from the session stage.
 * Lock and Update Required sit above everything, so a locked or unsupported
 * app never renders the workspace underneath.
 */
export function App() {
  // Messages from the main process, on every screen — including sign-in, where
  // a refused passkey callback or a server warning has to be seen too.
  useEffect(() => (hasDesktop() ? on<ToastMessage>('toast', (t) => toast(t.kind, t.text)) : undefined), []);
  useLanguage();
  const ready = useStore(app, (s) => s.ready);
  const auth = useStore(app, (s) => s.auth);
  const locked = useStore(app, (s) => s.lock?.locked ?? false);
  const required = useStore(app, (s) => s.update?.required ?? false);
  const hash = window.location.hash;

  if (!hasDesktop()) {
    return <div className="flex h-full items-center justify-center p-8 text-center text-ink-2">WorkSuite Desktop's interface runs inside the desktop app.</div>;
  }
  if (!ready || !auth) return <Spinner label="Starting WorkSuite…" className="h-full" />;
  // Remote control's prompt and bar: above everything else, and never behind the lock screen — stopping control must always work.
  if (hash.startsWith('#/rc/')) return <RemoteControlWindow hash={hash} />;
  // The website-chat call window: above the lock screen too, saying only that a chat waits while locked (RING-40).
  if (hash.startsWith('#/window/webchat-ring')) return <WebchatRingWindow />;

  let body;
  if (required && auth.stage !== 'revoked') body = <UpdateRequired />;
  else if (auth.stage !== 'ready') body = <Onboarding auth={auth} />;
  else if (hash.startsWith('#/window/quick-ask')) body = <QuickAskWindow />;
  else if (hash.startsWith('#/window/')) body = <WindowRoot hash={hash} />;
  else if (auth.setupPending) body = <SetupWizard />;
  else body = <Shell />;

  return (
    <Suspense fallback={<Spinner className="h-full" />}>
      {locked && auth.stage === 'ready' ? (
        <LockBoundary>
          <LockScreen />
        </LockBoundary>
      ) : (
        body
      )}
      <Toasts />
      <ShowMeHost />
    </Suspense>
  );
}
