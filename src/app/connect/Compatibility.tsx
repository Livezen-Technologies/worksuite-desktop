import type { AuthState } from '@shared/types';
import { ConnectPlaceholder } from './ConnectFrame';

export interface CompatibilityProps {
  auth: AuthState;
}

/**
 * Screen 9 — UPDATE_REQUIRED (Update now) and SERVER_TOO_OLD (Copy details, Re-run discovery), for this account only. [WP4]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function Compatibility(_props: CompatibilityProps) {
  return <ConnectPlaceholder title="WorkSuite — Enterprise" screen="Update required" />;
}
Compatibility.placeholder = true;
