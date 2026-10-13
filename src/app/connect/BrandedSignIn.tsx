import type { AuthState } from '@shared/types';
import { ConnectPlaceholder } from './ConnectFrame';

export interface BrandedSignInProps {
  auth: AuthState;
}

/**
 * Screen 8 — the server's branded sign-in: its logo and accent; the browser for `oidc` / `browser_sign_in`, else the in-app form (SignInStep) for legacy servers. [WP4]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function BrandedSignIn(_props: BrandedSignInProps) {
  return <ConnectPlaceholder title="WorkSuite — Enterprise" screen="Sign in" />;
}
BrandedSignIn.placeholder = true;
