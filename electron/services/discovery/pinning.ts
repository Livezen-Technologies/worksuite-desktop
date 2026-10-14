import { createHash, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { connect as tlsConnect, type PeerCertificate } from 'node:tls';
import type { Certificate, Request as CertRequest, Session } from 'electron';
import type { ConnectErrorCode, TlsDetails } from '@shared/discovery';
import { logger } from '../../main/log';

const log = logger('discovery.tls');

/**
 * TLS for every account partition (Connection & Startup §2 step 3). [WP2; WP1 calls `installPinning` from
 * `installShellSession` on every partition.]
 *
 * The verdict is Chromium's (the OS trust store). On top of it, `ses.setCertificateVerifyProc`:
 *  - pins exist for the host and no SPKI in the chain matches → refused (`TLS_PIN_MISMATCH`, Chromium's
 *    ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN);
 *  - the OS does not trust the chain (authority invalid only) but a pin from MANAGED config matches → allowed (the
 *    only "IT can allow this" path);
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

/** Chromium's net error codes the verify proc answers with. */
export const NET_OK = 0;
export const NET_USE_CHROMIUM = -3;
export const NET_ERR_PINNED_KEY_NOT_IN_CERT_CHAIN = -150;
export const NET_ERR_CERT_AUTHORITY_INVALID = -202;

/** `sha256/<base64>` of a DER SubjectPublicKeyInfo. */
export function spkiPin(spkiDer: Uint8Array): string {
  return `sha256/${createHash('sha256').update(spkiDer).digest('base64')}`;
}

/** The SPKI pin of a certificate (PEM or DER), or null when it cannot be read. */
export function certPin(cert: string | Uint8Array): string | null {
  try {
    const x = new X509Certificate(typeof cert === 'string' ? cert : Buffer.from(cert));
    return spkiPin(x.publicKey.export({ type: 'spki', format: 'der' }));
  } catch {
    return null;
  }
}

/**
 * What the verify proc answers for a chain: the pure decision, shared by `installPinning` and the tests.
 * `chromiumError` is Chromium's own verdict (0 = trusted).
 */
export function pinVerdict(chainPins: readonly string[], chromiumError: number, hostPins: HostPins | null): number {
  if (!hostPins || hostPins.pins.length === 0) return NET_USE_CHROMIUM;
  const match = chainPins.some((p) => hostPins.pins.includes(p));
  if (!match) return NET_ERR_PINNED_KEY_NOT_IN_CERT_CHAIN;
  if (chromiumError === NET_OK) return NET_USE_CHROMIUM;
  // Managed pins vouch for a private CA, nothing more: an expired or wrong-host certificate stays refused.
  if (hostPins.managed && chromiumError === NET_ERR_CERT_AUTHORITY_INVALID) return NET_OK;
  return NET_USE_CHROMIUM;
}

function electronChainPins(...certs: Array<Certificate | undefined>): string[] {
  const out = new Set<string>();
  for (const start of certs) {
    let c: Certificate | undefined = start;
    for (let depth = 0; c && depth < 10; depth++) {
      const p = certPin(c.data);
      if (p) out.add(p);
      if (c.issuerCert === c || !c.issuerCert) break;
      c = c.issuerCert;
    }
  }
  return [...out];
}

/** Installs the verify proc on `ses`. Hosts without pins keep Chromium's own verdict (today's behaviour). */
export function installPinning(ses: Session, pinsFor: PinsFor): void {
  ses.setCertificateVerifyProc((request: CertRequest, callback: (verificationResult: number) => void) => {
    try {
      const hostPins = pinsFor(request.hostname);
      if (!hostPins || hostPins.pins.length === 0) {
        callback(NET_USE_CHROMIUM);
        return;
      }
      const chain = electronChainPins(request.certificate, request.validatedCertificate);
      const verdict = pinVerdict(chain, request.errorCode, hostPins);
      if (verdict === NET_ERR_PINNED_KEY_NOT_IN_CERT_CHAIN) log.warn('certificate pin mismatch', { host: request.hostname });
      if (verdict === NET_OK) log.info('certificate allowed by a managed pin', { host: request.hostname });
      callback(verdict);
    } catch (e) {
      log.warn('pinning check failed', { host: request.hostname, error: String(e) });
      callback(NET_USE_CHROMIUM);
    }
  });
}

/** Chromium (`net::ERR_…`) and Node (`CERT_…`) certificate errors as connect codes, or null when not TLS. */
export function classifyTlsError(e: unknown): Extract<ConnectErrorCode, 'TLS_UNTRUSTED' | 'TLS_EXPIRED' | 'TLS_HOSTNAME' | 'TLS_PIN_MISMATCH'> | null {
  const text = errorText(e);
  if (/ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN/i.test(text)) return 'TLS_PIN_MISMATCH';
  if (/ERR_CERT_DATE_INVALID|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|ERR_CERT_VALIDITY_TOO_LONG/i.test(text)) return 'TLS_EXPIRED';
  if (/ERR_CERT_COMMON_NAME_INVALID|ERR_TLS_CERT_ALTNAME_INVALID|ERR_CERT_NAME_CONSTRAINT_VIOLATION|does not match certificate/i.test(text)) return 'TLS_HOSTNAME';
  if (/ERR_CERT_|ERR_SSL_|ERR_BAD_SSL|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|CERT_UNTRUSTED|CERT_REVOKED|CERT_SIGNATURE_FAILURE|certificate/i.test(text)) return 'TLS_UNTRUSTED';
  return null;
}

/** An error's message, code and causes, flattened for matching. */
export function errorText(e: unknown, depth = 0): string {
  if (e === null || e === undefined || depth > 4) return '';
  if (typeof e !== 'object') return String(e);
  const o = e as { message?: unknown; code?: unknown; cause?: unknown };
  return [typeof o.message === 'string' ? o.message : '', typeof o.code === 'string' ? o.code : '', errorText(o.cause, depth + 1)].filter(Boolean).join(' ');
}

function trustStore(): TlsDetails['trustStore'] {
  return process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
}

function dn(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()
    .join(', ');
}

export interface PeerChain {
  /** The leaf first, DER. */
  chain: Buffer[];
  /** Node's own verdict against its bundled roots: for the log, never the trust decision. */
  authorized: boolean;
  authorizationError: string | null;
}

/** The certificate chain a host presents, read with `rejectUnauthorized:false` (details only, never trust). */
export function readPeerChain(host: string, port: number, signal?: AbortSignal, timeoutMs = 10_000): Promise<PeerChain> {
  return new Promise((resolve, reject) => {
    const bare = host.replace(/^\[|\]$/g, '');
    const socket = tlsConnect({ host: bare, port, servername: isIP(bare) ? undefined : bare, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] });
    const done = (fn: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      fn();
    };
    const onAbort = () => done(() => reject(new Error('aborted')));
    const timer = setTimeout(() => done(() => reject(new Error('timed out reading the certificate'))), timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.once('secureConnect', () => {
      const chain: Buffer[] = [];
      let c: PeerCertificate | undefined = socket.getPeerCertificate(true);
      const seen = new Set<string>();
      while (c && c.raw && !seen.has(c.fingerprint256) && chain.length < 10) {
        seen.add(c.fingerprint256);
        chain.push(c.raw);
        c = (c as PeerCertificate & { issuerCertificate?: PeerCertificate }).issuerCertificate;
      }
      const err = socket.authorizationError;
      done(() => resolve({ chain, authorized: socket.authorized, authorizationError: err ? String((err as Error).message ?? err) : null }));
    });
    socket.once('error', (e) => done(() => reject(e)));
  });
}

/** The "Details for IT" of a chain's leaf. */
export function detailsFromChain(host: string, port: number, chain: Buffer[], reason: string): TlsDetails {
  const leaf = new X509Certificate(chain[0]!);
  return {
    host,
    port,
    issuer: dn(leaf.issuer),
    subject: dn(leaf.subject),
    validFrom: new Date(leaf.validFrom).toISOString(),
    validTo: new Date(leaf.validTo).toISOString(),
    spki: spkiPin(leaf.publicKey.export({ type: 'spki', format: 'der' })),
    trustStore: trustStore(),
    reason,
  };
}

/**
 * The "Details for IT" of a host's certificate, read with `node:tls.connect({ rejectUnauthorized:false })` and
 * `X509Certificate`; the trust verdict is never taken from here.
 */
export async function readTlsDetails(host: string, port: number, reason: string, signal?: AbortSignal): Promise<TlsDetails> {
  const peer = await readPeerChain(host, port, signal);
  if (peer.chain.length === 0) throw new Error('the server presented no certificate');
  return detailsFromChain(host, port, peer.chain, reason);
}
