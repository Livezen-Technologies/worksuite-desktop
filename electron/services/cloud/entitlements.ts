import { verify } from 'node:crypto';
import type { EntitlementClaims } from '@shared/cloud';
import { logger } from '../../main/log';
import type { LicenceSnapshot } from '../bootstrap';
import { livezenKeyring, parseEd25519Key } from '../discovery/keys';

const log = logger('cloud-entitlements');

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

/** How far in the future `iat` may be (clock skew). */
const IAT_SKEW_S = 5 * 60;

/**
 * The key the test fixtures and tests/e2e/mock-cloud.mjs sign with (tests/fixtures/discovery/keys.json). Trusted
 * only by unpackaged builds — never by a packaged app.
 */
export const TEST_ENTITLEMENT_KEYS: Readonly<Record<string, string>> = Object.freeze({
  '397D:6320:671B:3B9B:8246:18E4:E379:2DEA': '5fCSK_lwWNcfMHIFcS6dAsILeZPVMynVFV1CbV4sBdY',
});

/** The entitlement keyring: Livezen's pinned (and rotated) keys, plus the test key in unpackaged builds only. */
export function entitlementKeyring(isPackaged: boolean, rotated: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { ...(isPackaged ? {} : TEST_ENTITLEMENT_KEYS), ...livezenKeyring('entitlements', rotated) };
}

function json(part: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function claimsOf(p: Record<string, unknown>): EntitlementClaims | null {
  if (typeof p.org !== 'string' || typeof p.iat !== 'number' || typeof p.exp !== 'number' || !p.apps || typeof p.apps !== 'object' || Array.isArray(p.apps)) return null;
  const apps: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(p.apps as Record<string, unknown>)) if (typeof v === 'boolean' && /^[a-z0-9_-]{1,64}$/i.test(k)) apps[k] = v;
  const limits = p.limits && typeof p.limits === 'object' ? (p.limits as { storage_bytes?: unknown }) : null;
  return {
    iss: String(p.iss ?? ''),
    org: p.org,
    plan: String(p.plan ?? ''),
    apps,
    ...(limits && typeof limits.storage_bytes === 'number' ? { limits: { storage_bytes: limits.storage_bytes } } : {}),
    iat: p.iat,
    exp: p.exp,
  };
}

/**
 * Checks a compact JWS against the keyring (`kid` → key). `allowExpired` reads a stored document that has run out
 * (it is kept, marked stale, while Cloud cannot be asked); everything else is checked as ever.
 */
export function verifyEntitlements(jws: string, keys: Readonly<Record<string, string>>, organizationId: string, now: number = Date.now(), opts: { allowExpired?: boolean } = {}): EntitlementVerdict {
  if (typeof jws !== 'string' || jws.length > 64 * 1024) return { ok: false, reason: 'malformed' };
  const parts = jws.trim().split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || !parts[0] || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts as [string, string, string];
  const header = json(h);
  if (!header) return { ok: false, reason: 'malformed' };
  if (header.alg !== 'EdDSA') return { ok: false, reason: 'alg' };
  const kid = typeof header.kid === 'string' ? header.kid : null;
  const keyText = kid !== null && Object.prototype.hasOwnProperty.call(keys, kid) ? keys[kid] : undefined;
  const key = keyText ? parseEd25519Key(keyText) : null;
  if (!key) return { ok: false, reason: 'kid' };
  let good = false;
  try {
    good = verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'signature' };
  const payload = json(p);
  const claims = payload ? claimsOf(payload) : null;
  if (!claims) return { ok: false, reason: 'malformed' };
  if (claims.org !== organizationId) return { ok: false, reason: 'org' };
  const sec = Math.floor(now / 1000);
  if (claims.iat > sec + IAT_SKEW_S) return { ok: false, reason: 'future' };
  if (claims.exp <= sec && !opts.allowExpired) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

/** The licence the bootstrap takes from verified claims: each app as the plan says, and those set false locked. */
export function licenceFromClaims(claims: EntitlementClaims): LicenceSnapshot {
  const entitlements = { ...claims.apps };
  const locked = Object.entries(claims.apps)
    .filter(([, on]) => !on)
    .map(([app]) => app);
  return { entitlements, locked };
}

/** Where the last valid document is kept: the account's own database (`config`), by `entitlements:<org>`. */
export interface EntitlementKeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface EntitlementStoreDeps {
  /** The JWS for an organization, from Cloud. */
  fetch: (organizationId: string) => Promise<string>;
  keys: () => Readonly<Record<string, string>>;
  /** The active account's store; null keeps documents in memory only. */
  store: () => EntitlementKeyValue | null;
  onChange: () => void;
  now?: () => number;
}

interface Held {
  jws: string;
  claims: EntitlementClaims;
}

/** One organization's entitlements: the last valid document, refetched an hour before it runs out. */
export class EntitlementStore {
  private held = new Map<string, Held>();
  private timers = new Map<string, NodeJS.Timeout>();
  private lastFailure: EntitlementVerdict | null = null;

  constructor(private readonly deps: EntitlementStoreDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private static key(org: string): string {
    return `entitlements:${org}`;
  }

  /** The last valid document for `org`, from memory or the account's store (re-verified; an expired one is stale). */
  private load(org: string): Held | null {
    const mem = this.held.get(org);
    if (mem) return mem;
    let stored: string | null = null;
    try {
      stored = this.deps.store()?.get(EntitlementStore.key(org)) ?? null;
    } catch {
      stored = null;
    }
    if (!stored) return null;
    const v = verifyEntitlements(stored, this.deps.keys(), org, this.now(), { allowExpired: true });
    if (!v.ok) return null;
    const h = { jws: stored, claims: v.claims };
    this.held.set(org, h);
    return h;
  }

  /** What the renderer may know: verified, until when, and whether it has run out (kept while Cloud is away). */
  status(org: string | null): { verified: boolean; exp: number; stale: boolean } | null {
    if (!org) return null;
    const h = this.load(org);
    if (!h) return this.lastFailure ? { verified: false, exp: 0, stale: false } : null;
    return { verified: true, exp: h.claims.exp, stale: h.claims.exp * 1000 <= this.now() };
  }

  /** The licence for the bootstrap, or null (the server's own licence applies). */
  licence(org: string | null): LicenceSnapshot | null {
    const h = org ? this.load(org) : null;
    return h ? licenceFromClaims(h.claims) : null;
  }

  claims(org: string | null): EntitlementClaims | null {
    return org ? (this.load(org)?.claims ?? null) : null;
  }

  /**
   * Asks Cloud again. A document that verifies replaces the last one; one that does not is ignored (the last valid
   * one stays); no answer keeps the last one. Answers what this attempt found.
   */
  async refresh(org: string): Promise<EntitlementVerdict | { ok: false; reason: 'offline' }> {
    let jws: string;
    try {
      jws = await this.deps.fetch(org);
    } catch (e) {
      log.debug('entitlements not fetched; the last valid document stays', { error: String((e as Error)?.message ?? e) });
      this.schedule(org, 15 * 60_000);
      this.deps.onChange();
      return { ok: false, reason: 'offline' };
    }
    const v = verifyEntitlements(jws, this.deps.keys(), org, this.now());
    if (!v.ok) {
      log.warn('entitlements refused; the last valid document stays', { reason: v.reason });
      this.lastFailure = v;
      this.schedule(org, 60 * 60_000);
      this.deps.onChange();
      return v;
    }
    this.lastFailure = null;
    this.held.set(org, { jws, claims: v.claims });
    try {
      this.deps.store()?.set(EntitlementStore.key(org), jws);
    } catch (e) {
      log.debug('entitlements not stored', { error: String(e) });
    }
    // An hour before it runs out; never sooner than a minute, never further than a day.
    this.schedule(org, Math.min(24 * 60 * 60_000, Math.max(60_000, v.claims.exp * 1000 - 60 * 60_000 - this.now())));
    this.deps.onChange();
    return v;
  }

  private schedule(org: string, ms: number): void {
    const was = this.timers.get(org);
    if (was) clearTimeout(was);
    const t = setTimeout(() => void this.refresh(org), ms);
    t.unref?.();
    this.timers.set(org, t);
  }

  /** Stops refetching and forgets what is in memory (another account is active now). */
  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.held.clear();
    this.lastFailure = null;
  }
}
