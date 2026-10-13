import type { AccountsState } from '@shared/accounts';
import { ConnectPlaceholder } from './ConnectFrame';

export interface WorkspaceChooserProps {
  accounts: AccountsState;
}

/**
 * Screen 11 — the workspace chooser at startup: every account, + Add Account, Always show this at startup. [WP4]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function WorkspaceChooser(_props: WorkspaceChooserProps) {
  return <ConnectPlaceholder title="WorkSuite" screen="Choose WorkSuite workspace" />;
}
WorkspaceChooser.placeholder = true;
