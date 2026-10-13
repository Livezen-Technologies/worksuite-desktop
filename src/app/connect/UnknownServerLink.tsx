import type { UnknownLink } from '@shared/accounts';
import { ConnectPlaceholder } from './ConnectFrame';

export interface UnknownServerLinkProps {
  link: UnknownLink;
  onClose: () => void;
}

/**
 * Screen 16's dialog — a link to a server not added (`accounts:unknownLink`): Add Account or Cancel. Nothing was fetched from it. [WP4]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function UnknownServerLink(_props: UnknownServerLinkProps) {
  return <ConnectPlaceholder title="WorkSuite" screen="A link to a server you haven't added" />;
}
UnknownServerLink.placeholder = true;
