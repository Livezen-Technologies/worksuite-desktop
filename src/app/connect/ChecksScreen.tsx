import type { ConnectRun } from '@shared/discovery';
import { ConnectPlaceholder } from './ConnectFrame';

export interface ChecksScreenProps {
  run: ConnectRun;
}

/**
 * Screen 7 — the server checks, step by step from `connect:progress`; Change address, Try again, Details for IT. Never "proceed anyway". [WP4]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function ChecksScreen(_props: ChecksScreenProps) {
  return <ConnectPlaceholder title="WorkSuite — Enterprise" screen="Checking the server" />;
}
ChecksScreen.placeholder = true;
