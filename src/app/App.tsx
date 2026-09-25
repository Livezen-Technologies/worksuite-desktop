import { Suspense } from 'react';
import { app } from '../core/app-state';
import { hasDesktop } from '../core/bridge';
import { useLanguage } from '../core/i18n';
import { useStore } from '../core/store';
import { Shell } from '../layouts/Shell';
import { Spinner } from '../components/ui';
import { Onboarding, SetupWizard } from './onboarding/Onboarding';
import { Toasts } from './overlays/Toasts';
import { LockScreen } from './screens/LockScreen';
import { UpdateRequired } from './screens/UpdateScreens';
import { WindowRoot } from './WindowRoot';

/**
 * Top level: which screen this window shows, from the session stage.
 * Lock and Update Required sit above everything, so a locked or unsupported
 * app never renders the workspace underneath.
 */
export function App() {
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

  let body;
  if (required && auth.stage !== 'revoked') body = <UpdateRequired />;
  else if (auth.stage !== 'ready') body = <Onboarding auth={auth} />;
  else if (hash.startsWith('#/window/')) body = <WindowRoot hash={hash} />;
  else if (auth.setupPending) body = <SetupWizard />;
  else body = <Shell />;

  return (
    <Suspense fallback={<Spinner className="h-full" />}>
      {locked && auth.stage === 'ready' ? <LockScreen /> : body}
      <Toasts />
    </Suspense>
  );
}
