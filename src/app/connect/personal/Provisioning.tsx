import type { AuthState } from '@shared/types';
import { ConnectPlaceholder } from '../ConnectFrame';

export interface ProvisioningProps {
  auth: AuthState;
}

/**
 * Screen 5 — setting up the workspace (`provisioning`), PROVISIONING_FAILED's countdown and Retry now. [WP3]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function Provisioning(_props: ProvisioningProps) {
  return <ConnectPlaceholder title="WorkSuite — Personal · WorkSuite Cloud" screen="Setting up your workspace" />;
}
Provisioning.placeholder = true;
