/**
 * Who refreshes and revokes an account's tokens (Connection & Startup §3, WP1/WP3).
 *
 * An Enterprise (or legacy) account uses WorkSuite's own `/api/auth/refresh` and `/api/auth/logout`, as
 * `AuthService` does today; a Personal account uses OneAuth's OIDC token endpoint (`OidcTokenEndpoint` in
 * electron/services/cloud/oidc.ts). `AuthService` keeps the single-flight refresh, the secure storage and the timers,
 * and asks its `TokenEndpoint` only for the network part — so the rotation rules (one refresher per account, a
 * refresh answered for a replaced session is dropped) stay in one place.
 */

/** A token answer, in WorkSuite's shape (`/api/auth/login`, `/api/auth/refresh`); OIDC's is mapped onto it. */
export interface Tokens {
  access_token: string;
  refresh_token: string;
  /** Seconds. */
  expires_in: number;
  /** OIDC only: checked for iss / aud / nonce / exp at sign-in, never stored. */
  id_token?: string;
}

/**
 * - `ok`: new tokens (the refresh token rotated).
 * - `refused`: the server refused this refresh token (expired, rotated away): sign in again.
 * - `revoked`: this device or grant was revoked (WF-24): the account's revoke handling applies.
 * - `offline`: no answer, or a 5xx: try again later; the session stands.
 */
export type RefreshOutcome = { status: 'ok'; tokens: Tokens } | { status: 'refused' | 'revoked' | 'offline'; message?: string };

export interface TokenEndpoint {
  kind: 'worksuite' | 'oidc';
  refresh(refreshToken: string): Promise<RefreshOutcome>;
  /** Best effort; never throws. `accessToken` lets WorkSuite's logout end the session it belongs to. */
  revoke(refreshToken: string, accessToken?: string): Promise<void>;
}
