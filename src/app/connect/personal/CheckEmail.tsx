import type { AuthState } from '@shared/types';
import { ConnectPlaceholder } from '../ConnectFrame';

export interface CheckEmailProps {
  auth: AuthState;
}

/**
 * Screen 4 — check your email (`verify-email`): the address, Resend after 60 s, Start again. [WP3]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function CheckEmail(_props: CheckEmailProps) {
  return <ConnectPlaceholder title="WorkSuite — Personal · WorkSuite Cloud" screen="Check your email" />;
}
CheckEmail.placeholder = true;
