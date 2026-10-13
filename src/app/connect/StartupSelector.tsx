import type { AccountsState } from '@shared/accounts';
import { ConnectPlaceholder } from './ConnectFrame';

export interface StartupSelectorProps {
  accounts: AccountsState | null;
}

/**
 * Screen 1 — the startup selector: Personal (WorkSuite Cloud) or Enterprise, guest mode and Join a meeting in the footer. [WP4]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function StartupSelector(_props: StartupSelectorProps) {
  return <ConnectPlaceholder title="WorkSuite" screen="How would you like to use WorkSuite?" />;
}
StartupSelector.placeholder = true;
