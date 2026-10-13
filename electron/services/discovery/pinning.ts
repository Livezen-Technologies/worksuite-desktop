import type { Session } from 'electron';
import { DesktopError } from '../../main/errors';
import type { TlsDetails } from '@shared/discovery';

/**
 * TLS for every account partition (Connection & Startup §2 step 3). [WP2; WP1 calls `installPinning` from
 * `installShellSession` on every partition.]
 *
 * The verdict is Chromium's (the OS trust store). On top of it, `ses.setCertificateVerifyProc`:
 *  - pins exist for the host and no SPKI in the chain matches → refused (`TLS_PIN_MISMATCH`);
 *  - the OS does not trust the chain but a pin from MANAGED config matches → allowed (the only "IT can allow this"
 *    path);
 *  - pins from a QR or setup link only ever restrict.
 */

export interface HostPins {
  /** `sha256/<base64>` SPKI pins. */
  pins: string[];
  /** From managed configuration: may allow a chain the OS does not trust. */
  managed: boolean;
}

/** The pins for a host, or null when it has none. */
export type PinsFor = (host: string) => HostPins | null;

/** Installs the verify proc on `ses`. Stub: does nothing, so Chromium's own verdict stands (today's behaviour). */
export function installPinning(_ses: Session, _pinsFor: PinsFor): void {
  // WP2.
}

/** `sha256/<base64>` of a DER SubjectPublicKeyInfo. Stub: UNSUPPORTED. */
export function spkiPin(_spkiDer: Uint8Array): string {
  throw new DesktopError('UNSUPPORTED', 'Certificate pinning is not available in this version.');
}

/**
 * The "Details for IT" of a host's certificate, read with `node:tls.connect({ rejectUnauthorized:false })` and
 * `X509Certificate`; the trust verdict is never taken from here. Stub: UNSUPPORTED.
 */
export async function readTlsDetails(_host: string, _port: number, _reason: string, _signal?: AbortSignal): Promise<TlsDetails> {
  throw new DesktopError('UNSUPPORTED', 'Certificate details are not available in this version.');
}
