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
