/**
 * WorkSuite Cloud for a Personal account (Connection & Startup §3, screens 2–5, 12, 13): the OneAuth account, its
 * organization's lifecycle, provisioning, storage and the signed entitlements. Plain data and pure functions; the
 * main process talks to Cloud (electron/services/cloud), the renderer shows `CloudStatus`.
 *
 * The shapes follow WS-CLOUD-SRS-ENH-01; the open points are listed in the plan (§8.1 item 5).
 */

export type CloudAccountState =
  | 'REGISTERED'
  | 'EMAIL_VERIFICATION_PENDING'
  | 'VERIFIED'
  | 'PROVISIONING'
  | 'PROVISIONING_FAILED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'PENDING_DELETION';

export type OrgLifecycle = 'ACTIVE' | 'PAST_DUE' | 'GRACE' | 'RESTRICTED';

/** Which way to sign in, passed to OneAuth as `idp_hint`. `sso` is an enterprise IdP. */
export type IdpHint = 'email' | 'google' | 'microsoft' | 'apple' | 'passkey' | 'sso';
export const IDP_HINTS: readonly IdpHint[] = ['email', 'google', 'microsoft', 'apple', 'passkey', 'sso'];

/** Cloud's REST paths, relative to the account's API origin. */
export const CLOUD_API = {
  me: '/api/v1/me',
  provisioningStatus: '/api/v1/provisioning/status',
  provisioningRetry: '/api/v1/provisioning/retry',
  storageUsage: '/api/v1/storage/usage',
  entitlements: '/api/v1/entitlements',
  /** To confirm with the Cloud team (plan §8.1 item 5). */
  plans: '/api/v1/plans',
  /** The organization's startup screen configuration, for the periodic sync (ENH-AUTH-01 §3). */
  desktopAuthConfig: '/api/v1/desktop/auth-config',
  /** Beginning (and reading the state of) the deletion of this account, from inside the app. */
  accountDeletion: '/api/v1/account/deletion',
} as const;

/** `GET /api/v1/me`. */
export interface CloudMe {
  identity: { id: string; email: string; name: string | null; email_verified: boolean; avatar?: string | null };
  account_state: CloudAccountState;
  organizations: Array<{ id: string; name: string; plan: string; state: OrgLifecycle }>;
  active_organization_id: string | null;
  onboarding: { complete: boolean; step?: string | null };
}

/** `GET /api/v1/account/deletion`: what Apple's review calls account deletion, begun in the app. */
export interface AccountDeletion {
  /** When everything is removed, if it has been asked for. */
  scheduled_for: string | null;
  requested_at: string | null;
  /** What has to be settled first: an organization this person solely owns that has members or a paid plan. */
  blockers: Array<{ organization_id: string; name: string; reason: string; message: string }>;
  /** Where the deletion can be called off (the same link the confirmation email carries). */
  cancel_url: string;
}

/** `GET /api/v1/provisioning/status`. */
export interface ProvisioningStatus {
  state: 'PROVISIONING' | 'PROVISIONING_FAILED' | 'ACTIVE';
  /** The step running now ("drive", "apps", "preferences"). */
  step: string;
  attempts: number;
  /** When Cloud tries again after a failure (ISO): "Next attempt in 4 minutes". */
  retry_at: string | null;
}

/** `GET /api/v1/storage/usage`, bytes. */
export interface StorageUsage {
  limit: number;
  used: number;
  /** Held by uploads in progress. */
  reserved: number;
  categories: Array<{ key: string; bytes: number; label?: string; policy?: string }>;
  largest: Array<{ id: string; name: string; bytes: number }>;
}

export interface CloudPlan {
  id: string;
  name: string;
  storage_bytes: number;
  price?: string | null;
}

/** The claims of `GET /api/v1/entitlements` (a compact JWS, EdDSA, Livezen `entitlements` key). */
export interface EntitlementClaims {
  iss: string;
  org: string;
  plan: string;
  /** App slug → included. */
  apps: Record<string, boolean>;
  limits?: { storage_bytes?: number };
  iat: number;
  exp: number;
}

/** How full the storage is: <70 %, 70, 85, 95, 100 %. */
export type QuotaLevel = 'ok' | 'notice' | 'warning' | 'critical' | 'full';

/** The percentages at which each level starts. */
export const QUOTA_THRESHOLDS: ReadonlyArray<readonly [QuotaLevel, number]> = [
  ['full', 100],
  ['critical', 95],
  ['warning', 85],
  ['notice', 70],
];

/**
 * The level for `used` of `limit` bytes: notice at 70 %, a warning toast at 85 %, the banner at 95 %, full at 100 %.
 * No limit (0, negative, not a number) is `ok`: an unlimited plan never warns.
 */
export function quotaLevel(used: number, limit: number): QuotaLevel {
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used) || used <= 0) return 'ok';
  const pct = (used / limit) * 100;
  for (const [level, from] of QUOTA_THRESHOLDS) if (pct >= from) return level;
  return 'ok';
}

/** One browser sign-in in progress (screen 3): its 10-minute window drives the timer. */
export interface BrowserSignIn {
  attemptId: string;
  /** The host the browser was sent to ("auth.worksuitecloud.com"), shown on screen 3. */
  host: string;
  /** The authorize URL: holds no verifier and no token, so "Copy the sign-in link" may copy it. */
  url: string;
  startedAt: number;
  expiresAt: number;
  purpose: 'sign-in' | 'sign-up' | 'reauth';
  method: IdpHint | null;
}

/** A browser sign-in's window. */
export const BROWSER_SIGNIN_TTL_MS = 10 * 60_000;

/** The Personal account's Cloud side, as the renderer sees it. */
export interface CloudStatus {
  accountState: CloudAccountState | null;
  orgState: OrgLifecycle | null;
  provisioning: ProvisioningStatus | null;
  storage: { used: number; limit: number; level: QuotaLevel } | null;
  entitlements: { verified: boolean; exp: number; stale: boolean } | null;
  readOnly: { reason: 'suspended' | 'restricted' | 'pending_deletion'; message: string } | null;
  /** Cloud cannot be reached or answers 5xx (screen 16's banner). */
  unavailable: boolean;
}

/** Nothing known yet. */
export const EMPTY_CLOUD_STATUS: CloudStatus = Object.freeze({
  accountState: null,
  orgState: null,
  provisioning: null,
  storage: null,
  entitlements: null,
  readOnly: null,
  unavailable: false,
}) as CloudStatus;
