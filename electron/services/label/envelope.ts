import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { canonicalJson } from '@shared/canonical-json';

/**
 * The signed job envelope (WS-LABEL-SRS-001 §14.4, FR-GWY-04): every chunk of printer bytes comes with
 *
 *   {"job":"LJ-001481","chunk":3,"printer":"prn_7f2","org":12,"expires":"2026-10-25T05:20:00Z",
 *    "manifest_sha256":"41c9…e07b","payload_sha256":"…","key_id":"lbl-2026-10","sig":"ed25519:…"}
 *
 * `sig` is Ed25519 over the canonical JSON of the envelope without `sig` (keys sorted, no whitespace —
 * shared/canonical-json.ts, what release manifests are signed over), so it covers the manifest hash, the payload
 * hash, the printer, the company and the expiry together. Nothing is printed until all of these hold:
 *
 *  - the key id is one the server published to this host (`GET keys`, or the pairing answer for a gateway);
 *  - the signature verifies; the payload's SHA-256 is the one signed;
 *  - it is the job (its code, `LJ-…`) and chunk asked for, for the printer the job was claimed for, in this host's
 *    company (a gateway's; the desktop host's session already scopes it);
 *  - it has not expired.
 */
export interface Envelope {
  job: string;
  chunk: number;
  printer: string | number;
  org: number | null;
  expires: string;
  manifest_sha256: string;
  payload_sha256: string;
  key_id: string;
  sig: string;
  [extra: string]: unknown;
}

export type EnvelopeCheck = { ok: true } | { ok: false; reason: string };

/** A published key: base64 (or base64url) of the 32 raw Ed25519 bytes, or a PEM SPKI block. */
export function publicKey(text: string): KeyObject | null {
  try {
    if (text.includes('BEGIN PUBLIC KEY')) {
      const k = createPublicKey(text);
      return k.asymmetricKeyType === 'ed25519' ? k : null;
    }
    const raw = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (raw.length !== 32) return null;
    return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
  } catch {
    return null;
  }
}

export const sha256Hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

export function checkEnvelope(
  env: unknown,
  payload: Buffer,
  expect: { job: string; chunk: number; printer: string | number; org: number | null },
  keys: Readonly<Record<string, string>>,
  now: number = Date.now(),
): EnvelopeCheck {
  if (!env || typeof env !== 'object') return { ok: false, reason: 'The job came without its signed envelope.' };
  const e = env as Partial<Envelope>;
  if (typeof e.sig !== 'string' || !e.sig.startsWith('ed25519:')) return { ok: false, reason: 'The job is not signed.' };
  const pem = typeof e.key_id === 'string' ? keys[e.key_id] : undefined;
  const key = pem ? publicKey(pem) : null;
  if (!key) return { ok: false, reason: `The job is signed with a key this computer does not know (${String(e.key_id ?? 'none')}).` };
  const { sig, ...signed } = e as Envelope;
  let good = false;
  try {
    good = verify(null, Buffer.from(canonicalJson(signed), 'utf8'), key, Buffer.from(sig.slice('ed25519:'.length), 'base64'));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'The job’s signature does not verify.' };
  if (typeof e.payload_sha256 !== 'string' || e.payload_sha256.toLowerCase() !== sha256Hex(payload)) return { ok: false, reason: 'The printer data is not what was signed.' };
  if (typeof e.manifest_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(e.manifest_sha256)) return { ok: false, reason: 'The job has no manifest hash.' };
  if (e.job !== expect.job || e.chunk !== expect.chunk) return { ok: false, reason: 'The envelope is for another job or chunk.' };
  if (String(e.printer) !== String(expect.printer)) return { ok: false, reason: 'The job is for a printer this computer was not given it for.' };
  if (expect.org !== null && e.org !== expect.org) return { ok: false, reason: 'The job is for another company.' };
  const exp = typeof e.expires === 'string' ? Date.parse(e.expires) : NaN;
  if (!Number.isFinite(exp) || exp <= now) return { ok: false, reason: 'The job’s signature has expired.' };
  return { ok: true };
}
