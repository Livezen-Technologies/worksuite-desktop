import { verify, type KeyObject } from 'node:crypto';
import { parseEd25519Key } from './keys';

/**
 * Detached JWS (RFC 7515 Appendix F) over the discovery document's exact bytes, as Core signs it:
 * `<b64url header>..<b64url signature>`, header `{"alg":"EdDSA","kid":…}`. The signing input is
 * `header + '.' + b64url(rawBytes)`; with `b64:false` (RFC 7797, listed in `crit`) it is `header + '.' + rawBytes`.
 * Verified with `crypto.verify(null, …)` — Ed25519 only, never `alg` from the header beyond checking it is EdDSA.
 */

export interface JwsHeader {
  alg: string;
  kid?: string;
  b64?: boolean;
  crit?: string[];
}

export type JwsVerdict = { ok: true; kid: string | null } | { ok: false; reason: 'malformed' | 'alg' | 'no-key' | 'signature' };

const B64URL = /^[A-Za-z0-9_-]+$/;
const MAX_JWS = 8 * 1024;

export function parseDetachedJws(text: string): { header: JwsHeader; protectedPart: string; signature: Buffer } | null {
  const t = text.trim();
  if (!t || t.length > MAX_JWS) return null;
  const parts = t.split('.');
  if (parts.length !== 3 || parts[1] !== '' || !B64URL.test(parts[0]!) || !B64URL.test(parts[2]!)) return null;
  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
  const h = header as Record<string, unknown>;
  if (typeof h.alg !== 'string') return null;
  if (h.kid !== undefined && typeof h.kid !== 'string') return null;
  if (h.b64 !== undefined && typeof h.b64 !== 'boolean') return null;
  if (h.crit !== undefined && !(Array.isArray(h.crit) && h.crit.every((c) => typeof c === 'string'))) return null;
  // b64:false must be understood as critical (RFC 7797 §6); any other critical extension is one we do not know.
  const crit = (h.crit as string[] | undefined) ?? [];
  if (crit.some((c) => c !== 'b64')) return null;
  if (h.b64 === false && !crit.includes('b64')) return null;
  const signature = Buffer.from(parts[2]!, 'base64url');
  if (signature.length !== 64) return null;
  return { header: h as unknown as JwsHeader, protectedPart: parts[0]!, signature };
}

/**
 * Verifies a detached JWS over `payload`. `keys` is one key (a trusted configuration's) or a keyring by `kid`
 * (Livezen's): with a keyring the header's `kid` must name a key in it.
 */
export function verifyDetachedJws(jws: string, payload: Uint8Array, keys: string | Readonly<Record<string, string>>): JwsVerdict {
  const parsed = parseDetachedJws(jws);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const { header, protectedPart, signature } = parsed;
  if (header.alg !== 'EdDSA') return { ok: false, reason: 'alg' };
  let key: KeyObject | null;
  if (typeof keys === 'string') {
    key = parseEd25519Key(keys);
  } else {
    const kid = header.kid;
    key = kid && Object.hasOwn(keys, kid) ? parseEd25519Key(keys[kid]!) : null;
  }
  if (!key) return { ok: false, reason: 'no-key' };
  const body = header.b64 === false ? Buffer.from(payload) : Buffer.from(Buffer.from(payload).toString('base64url'), 'ascii');
  const input = Buffer.concat([Buffer.from(protectedPart, 'ascii'), Buffer.from('.'), body]);
  try {
    return verify(null, input, key, signature) ? { ok: true, kid: header.kid ?? null } : { ok: false, reason: 'signature' };
  } catch {
    return { ok: false, reason: 'signature' };
  }
}
