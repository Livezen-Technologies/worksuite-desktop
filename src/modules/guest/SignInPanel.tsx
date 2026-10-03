import { findApp } from '@shared/apps';
import { useStore } from '../../core/store';
import { closeSignInPanel, signInPanel, startSignIn } from '../../core/session';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Button, Modal } from '../../components/ui';

/** What guest mode calls an app it shows locked ("Drive & Files"). */
export function lockedLabel(id: string): string {
  const def = findApp(id);
  return def ? text(def.guestLabel ?? def.label) : '';
}

/**
 * "Sign in to use Mail" (#149): what a guest sees for an app that needs an account — from the sidebar, a link, a deep
 * link or ⌘K. In the app, in this window; signing in keeps the Local Profile's data until the user decides about it.
 */
export function SignInPanel() {
  const id = useStore(signInPanel, (s) => s.app);
  if (id === null) return null;
  const name = id ? lockedLabel(id) : '';
  const title = name ? text('Sign in to use {app}', { app: name }) : text('Sign in to use this');
  return (
    <Modal
      title={title}
      onClose={closeSignInPanel}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={closeSignInPanel}>
            Not now
          </Button>
          <Button variant="primary" icon="log-in" onClick={startSignIn}>
            Sign in / Create account
          </Button>
        </>
      }
    >
      <div className="flex gap-3 text-[13.5px] text-ink-2">
        <Icon name="lock" size={20} className="mt-0.5 shrink-0 text-ink-3" />
        <div className="flex flex-col gap-2">
          <p>{name ? text('{app} needs a WorkSuite account.', { app: name }) : text('This needs a WorkSuite account.')}</p>
          <p>Your notes, tasks, contacts and calendar stay on this device. After you sign in, you can move them to your account or keep them here.</p>
        </div>
      </div>
    </Modal>
  );
}
