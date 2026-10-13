import { ConnectPlaceholder } from './ConnectFrame';

export interface EnterpriseAddressProps {
  /** An address or setup link to start from. */
  prefill?: string;
}

/**
 * Screen 6 — the enterprise address: a server address, a work email, or Scan Server QR Code (QrScan). [WP4]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function EnterpriseAddress(_props: EnterpriseAddressProps) {
  return <ConnectPlaceholder title="WorkSuite — Enterprise" screen="Connect to your organization" />;
}
EnterpriseAddress.placeholder = true;
