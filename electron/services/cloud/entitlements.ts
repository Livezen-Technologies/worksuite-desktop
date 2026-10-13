import type { EntitlementClaims } from '@shared/cloud';
import type { LicenceSnapshot } from '../bootstrap';

/**
 * Cloud's signed entitlements (Connection & Startup §3 `entitlements.ts`). [WP3]
 *
 * `GET /api/v1/entitlements?organization_id=` answers a compact JWS. Checks: `alg EdDSA`, `kid` in the Livezen
 * keyring (`purpose:'entitlements'`, discovery/keys.ts), `org === requested`, `exp > now`, `iat ≤ now + 5 min`.
 * Stored in the account DB as `entitlements:<org>`, refetched at `exp - 1h`. A bad signature keeps the last valid
 * document (as policies do); expired while offline, the last valid one is kept and marked `stale`. The result reaches
 * the bootstrap through `BootstrapService.setLicenceSource`, so app tiles follow it.
 */

export type EntitlementVerdict =
  | { ok: true; claims: EntitlementClaims }
  | { ok: false; reason: 'malformed' | 'alg' | 'kid' | 'signature' | 'org' | 'expired' | 'future' };

/** Checks a compact JWS against the keyring (`kid` → key). Stub: refuses everything. */
export function verifyEntitlements(_jws: string, _keys: Readonly<Record<string, string>>, _organizationId: string, _now: number = Date.now()): EntitlementVerdict {
  return { ok: false, reason: 'malformed' };
}

/** The licence the bootstrap takes from verified claims: each app as the plan says, and those set false locked. */
export function licenceFromClaims(claims: EntitlementClaims): LicenceSnapshot {
  const entitlements = { ...claims.apps };
  const locked = Object.entries(claims.apps)
    .filter(([, on]) => !on)
    .map(([app]) => app);
  return { entitlements, locked };
}
