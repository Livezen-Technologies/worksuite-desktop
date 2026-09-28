import { createHash, createPublicKey, verify } from 'node:crypto';
import type { GrantClaims } from '@shared/remote-control/channel';

/**
 * The grant a shared computer takes control under (WS-MEET-ENH-01 §E.2, SEC-03).
 *
 * The server hands each end the grant once: a token — the claims as
 * canonical JSON, signed with Ed25519 — and the 32-byte channel key. This
 * computer checks the signature over the exact bytes that were signed, then
 * that the grant is for this share, this computer and this meeting, and has
 * not run out. A grant that fails any of it is never used.
 *
 * The key to check it with is the policy key pinned in this build when there
 * is one (the server signs grants and desktop policies with the same key);
 * otherwise the one the server sent, over the same TLS session.
 */
export interface GrantDelivery {
  token: string;
  key: string;
  claims: GrantClaims;
  public_key: string | null;
}

export interface Expected {
  sessionId: number;
  meeting: string;
  sharerIdentity: string;
  deviceId: number | null;
  now?: number;
}

export type GrantCheck = { ok: true; claims: GrantClaims; key: Uint8Array; pinned: boolean } | { ok: false; why: string };

function unb64url(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function checkGrant(d: GrantDelivery, expected: Expected, pinnedKey: string | null): GrantCheck {
  const pem = pinnedKey ?? d.public_key;
  if (!pem) return { ok: false, why: 'The server sent no key to check the grant with.' };
  const parts = typeof d.token === 'string' ? d.token.split('.') : [];
  if (parts.length !== 2) return { ok: false, why: 'The grant is not in the expected form.' };
  const body = unb64url(parts[0]!);
  const sig = unb64url(parts[1]!);
  if (!body || !sig || sig.length !== 64) return { ok: false, why: 'The grant is not in the expected form.' };

  let signed = false;
  try {
    const key = createPublicKey(pem);
    // Only Ed25519: a server-supplied key of another kind is not the grant signer's.
    signed = key.asymmetricKeyType === 'ed25519' && verify(null, body, key, sig);
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, why: 'The grant’s signature does not check out.' };

  let claims: GrantClaims;
  try {
    claims = JSON.parse(body.toString('utf8')) as GrantClaims;
  } catch {
    return { ok: false, why: 'The grant could not be read.' };
  }
  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  // The signer also signs desktop policies: a grant must say it is one.
  if (claims.typ !== 'meet.remote_control.grant') return { ok: false, why: 'That is not a remote-control grant.' };
  if (claims.session_id !== expected.sessionId) return { ok: false, why: 'The grant is for another session.' };
  if (claims.meeting_id !== expected.meeting) return { ok: false, why: 'The grant is for another meeting.' };
  if (claims.sharer_identity !== expected.sharerIdentity) return { ok: false, why: 'The grant is for another share.' };
  if (expected.deviceId !== null && claims.sharer_device_id !== expected.deviceId) return { ok: false, why: 'The grant is for another computer.' };
  if (!(claims.exp > now)) return { ok: false, why: 'The grant has run out.' };
  if (!claims.controller_identity || !claims.grant_id || !claims.caps) return { ok: false, why: 'The grant is missing what it allows.' };

  const key = Buffer.from(typeof d.key === 'string' ? d.key : '', 'base64');
  if (key.length !== 32) return { ok: false, why: 'The grant’s key is not the right length.' };
  // The key comes beside the token; the token names it. Required when this build pins the signer.
  const named = (claims as GrantClaims & { key_sha256?: unknown }).key_sha256;
  if (named !== undefined || pinnedKey !== null) {
    const actual = createHash('sha256').update('meet.remote_control.key|').update(key).digest('hex');
    if (named !== actual) return { ok: false, why: 'The grant’s key is not the one the grant names.' };
  }
  return { ok: true, claims, key: new Uint8Array(key), pinned: pinnedKey !== null };
}
