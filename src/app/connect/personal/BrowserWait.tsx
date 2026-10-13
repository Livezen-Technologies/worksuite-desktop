import type { BrowserSignIn } from '@shared/cloud';
import { ConnectPlaceholder } from '../ConnectFrame';

export interface BrowserWaitProps {
  /** The attempt in progress (`signin:changed`); null once it ended. */
  attempt: BrowserSignIn | null;
  /** Personal (screen 3) or an enterprise `browser_sign_in` (screen 8's Sign in). */
  variant: 'personal' | 'enterprise';
  /** The window title's account name ("Livezen Technologies"), null for WorkSuite Cloud. */
  accountName: string | null;
}

/**
 * Screen 3 — waiting for the browser sign-in: the 10-minute timer, Open browser again, Copy the sign-in link, Cancel. Used by Personal and by an enterprise `browser_sign_in`. [WP3]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function BrowserWait(_props: BrowserWaitProps) {
  return <ConnectPlaceholder title="WorkSuite — Personal · WorkSuite Cloud" screen="Waiting for the browser" />;
}
BrowserWait.placeholder = true;
