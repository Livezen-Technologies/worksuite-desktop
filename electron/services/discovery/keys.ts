import { createPublicKey, type KeyObject } from 'node:crypto';

/**
 * The keys discovery and entitlement documents are checked with (Connection & Startup §2 step 5, §3 entitlements).
 * [WP2]
 *
 * - WorkSuite Cloud (`deployment:'CLOUD'`): the discovery document must verify against a Livezen key pinned here by
 *   `kid`, or one rotated in through a signed Update Center response's `discovery_keys` (stored in app.db only after
 *   `verifyUcDocument` passed) — the same pinned-keyring pattern as electron/updater/update-center.ts.
 * - Enterprise with a trusted configuration key: that key only. Without one: unsigned is "Not configured" unless
 *   `require_signed`.
 * - A setup link's key is the trusted key for that one run.
 *
 * Accepted key formats: `ed25519:<base64 SPKI DER>` (Core's `keys.discovery`, managed.json `discovery_key`) and a raw
 * 32-byte public key in base64url (Update Center style).
 */

/** Livezen's pinned discovery keys, `kid` → raw base64url Ed25519 key. Empty until the Cloud team issues them (plan §8.1 item 5). */
export const LIVEZEN_DISCOVERY_KEYS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * The test key of tests/fixtures/discovery (keys.json), trusted for Cloud discovery in unpackaged builds only, so the
 * mock-cloud e2e can sign as "Livezen". Never consulted when `app.isPackaged`.
 */
export const TEST_DISCOVERY_KEYS: Readonly<Record<string, string>> = Object.freeze({
  '397D:6320:671B:3B9B:8246:18E4:E379:2DEA': '5fCSK_lwWNcfMHIFcS6dAsILeZPVMynVFV1CbV4sBdY',
});

/** Livezen's pinned entitlement keys (`purpose:'entitlements'`), `kid` → raw base64url Ed25519 key. */
export const LIVEZEN_ENTITLEMENT_KEYS: Readonly<Record<string, string>> = Object.freeze({});

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * An Ed25519 public key from either accepted format, or null when it is neither. Never throws.
 */
export function parseEd25519Key(key: string): KeyObject | null {
  try {
    const k = key.trim();
    if (k.startsWith('ed25519:')) {
      const der = Buffer.from(k.slice('ed25519:'.length), 'base64');
      if (der.length !== 44 || !der.subarray(0, 12).equals(SPKI_ED25519_PREFIX)) return null;
      return createPublicKey({ key: der, format: 'der', type: 'spki' });
    }
    if (!/^[A-Za-z0-9_-]{43}=?$/.test(k)) return null;
    const raw = Buffer.from(k.replace(/=$/, ''), 'base64url');
    if (raw.length !== 32) return null;
    return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/**
 * The Livezen keyring for one purpose: the pinned keys plus the rotated ones (pinned win on a clash, so a rotation
 * can add a key but never replace a pinned one).
 */
export function livezenKeyring(purpose: 'discovery' | 'entitlements', rotated: Readonly<Record<string, string>> = {}): Record<string, string> {
  const pinned = purpose === 'discovery' ? LIVEZEN_DISCOVERY_KEYS : LIVEZEN_ENTITLEMENT_KEYS;
  return { ...rotated, ...pinned };
}

/** The Cloud discovery keyring for this build: pinned + rotated, and the test key when unpackaged. */
export function discoveryKeyring(rotated: Readonly<Record<string, string>>, isPackaged: boolean): Record<string, string> {
  const ring = livezenKeyring('discovery', rotated);
  return isPackaged ? ring : { ...TEST_DISCOVERY_KEYS, ...ring };
}

/**
 * Rotated keys as an Update Center response carries them (`discovery_keys`, `kid` → key): only well-formed kids and
 * keys parseable as Ed25519 are kept, at most 16. Pure; the caller has already verified the Update Center document.
 */
export function sanitizeRotatedKeys(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [kid, key] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= 16) break;
    if (!/^[A-Za-z0-9:._-]{1,64}$/.test(kid) || typeof key !== 'string' || !parseEd25519Key(key)) continue;
    out[kid] = key.trim();
  }
  return out;
}

/** Two keys in any accepted format are the same Ed25519 key. */
export function sameKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = parseEd25519Key(a);
  const y = parseEd25519Key(b);
  return !!x && !!y && x.export({ type: 'spki', format: 'der' }).equals(y.export({ type: 'spki', format: 'der' }));
}
