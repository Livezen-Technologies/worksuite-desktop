import { DesktopError } from '../../main/errors';
import type { IdpHint } from '@shared/cloud';
import type { RefreshOutcome, TokenEndpoint, Tokens } from '../auth-tokens';

/**
 * OneAuth (OIDC) for Personal accounts (Connection & Startup §3 `oidc.ts`). [WP3]
 *
 * - Issuer metadata from `<endpoints.auth>/.well-known/openid-configuration`, cached 24 h.
 * - Public client: `discovery.auth.client_id` (default `worksuite-desktop`); PKCE S256, 32-byte `state`, `nonce`;
 *   scope `openid profile email offline_access`; `idp_hint`, `login_hint`, and for sign-up `prompt=create`.
 * - Redirect `worksuite://auth/oidc` when the app is the default protocol client, else a one-shot loopback listener
 *   on `http://127.0.0.1:<ephemeral>/oauth/callback` (RFC 8252 §7.3) that answers a static "You can close this tab"
 *   page and closes after one hit or at the deadline.
 * - Code exchange at `token_endpoint`; the `id_token` is checked for iss / aud / nonce / exp (direct TLS exchange,
 *   no JWKS fetch). Refresh and revoke through `OidcTokenEndpoint`. The desktop never sees a password.
 */

export const OIDC_SCOPE = 'openid profile email offline_access';
export const OIDC_CALLBACK = 'worksuite://auth/oidc';

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
}

export interface AuthorizeRequest {
  issuer: string;
  clientId: string;
  redirectUri: string;
  purpose: 'sign-in' | 'sign-up' | 'reauth';
  method: IdpHint | null;
  loginHint?: string;
}

/** What an authorize URL needs to be finished later; kept in memory only. */
export interface PendingAuthorize {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
}

export async function fetchMetadata(_issuer: string, _fetch: (url: string, init: RequestInit) => Promise<Response>): Promise<OidcMetadata> {
  throw new DesktopError('UNSUPPORTED', 'WorkSuite Cloud sign-in is not available in this version.');
}

export function buildAuthorize(_meta: OidcMetadata, _req: AuthorizeRequest): PendingAuthorize {
  throw new DesktopError('UNSUPPORTED', 'WorkSuite Cloud sign-in is not available in this version.');
}

export async function exchangeCode(_meta: OidcMetadata, _pending: PendingAuthorize, _code: string, _clientId: string): Promise<Tokens> {
  throw new DesktopError('UNSUPPORTED', 'WorkSuite Cloud sign-in is not available in this version.');
}

/** A loopback redirect listener: resolves with the callback URL, or null at the deadline. */
export interface LoopbackListener {
  redirectUri: string;
  result: Promise<string | null>;
  close: () => void;
}

export async function listenLoopback(_deadline: number): Promise<LoopbackListener> {
  throw new DesktopError('UNSUPPORTED', 'WorkSuite Cloud sign-in is not available in this version.');
}

/** Refresh and revoke at OneAuth's token endpoint (WP0 `TokenEndpoint`). Stub: offline / no-op. */
export class OidcTokenEndpoint implements TokenEndpoint {
  readonly kind = 'oidc' as const;

  constructor(
    readonly meta: OidcMetadata,
    readonly clientId: string,
  ) {}

  async refresh(_refreshToken: string): Promise<RefreshOutcome> {
    return { status: 'offline' };
  }

  async revoke(_refreshToken: string, _accessToken?: string): Promise<void> {
    // WP3.
  }
}
