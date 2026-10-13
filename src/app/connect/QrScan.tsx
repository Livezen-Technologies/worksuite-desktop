import { ConnectPlaceholder } from './ConnectFrame';

export interface QrScanProps {
  /** A setup link read from the camera, an image or pasted. */
  onLink: (link: string) => void;
  onClose: () => void;
}

/**
 * Screen 6's dialog — scan the setup QR from Admin Center with the camera, choose an image, or paste a setup link. [WP4]
 *
 * WP0 placeholder: `placeholder` tells ConnectRoot to fall through to the existing Onboarding. The real screen
 * replaces this file and drops the marker.
 */
export function QrScan(_props: QrScanProps) {
  return <ConnectPlaceholder title="WorkSuite — Enterprise" screen="Scan setup QR" />;
}
QrScan.placeholder = true;
