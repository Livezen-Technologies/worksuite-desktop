import type { AccountView } from '@shared/accounts';
import { ConnectPlaceholder } from '../ConnectFrame';

export interface PersonalWelcomeProps {
  /** An email to start from (the optional login hint). */
  prefill?: string;
  /** The Personal account being signed in again, when there is one. */
  account: AccountView | null;
}

/**
 * Screen 2 — Personal welcome: sign in or create a free account in the browser (email, Google, Microsoft, Apple, passkey). [WP3]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function PersonalWelcome(_props: PersonalWelcomeProps) {
  return <ConnectPlaceholder title="WorkSuite — Personal · WorkSuite Cloud" screen="Welcome back" />;
}
PersonalWelcome.placeholder = true;
