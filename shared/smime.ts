/**
 * S/MIME in Mail (ENH-MAIL-03 DMO-SEC-05, §10.1).
 *
 * A signature is checked in the main process against the message's own
 * bytes: the signature over exactly the signed part, the signer's
 * certificate chained to a root this computer trusts, in date, and naming
 * the address the message is From. "Verified" is said only when all of that
 * holds; anything less says what failed. Nothing is ever shown as verified
 * on a header's word.
 */

export type SmimeState =
  /** Signature, chain, dates and address all check. */
  | 'verified'
  /** The signature matches the content, but the certificate is not one this computer trusts (self-signed, unknown issuer). */
  | 'untrusted'
  /** The content was changed after it was signed, or the signature is broken. */
  | 'invalid'
  /** The certificate does not name the address the message is From. */
  | 'mismatch'
  /** The certificate had expired (or was not yet valid) when it was checked. */
  | 'expired'
  /** Encrypted: WorkSuite does not decrypt S/MIME (no private keys are kept). */
  | 'encrypted'
  /** Not signed with S/MIME, or in a form this cannot check. */
  | 'none';

export interface SmimeVerdict {
  state: SmimeState;
  signer: { name: string | null; email: string | null; issuer: string | null; notAfter: string | null; fingerprint: string | null } | null;
  /** In plain words, for the reader's info bar. */
  detail: string;
  /** The signer's public certificate (base64 DER), to keep for encrypting to them later. */
  certificate: string | null;
}
