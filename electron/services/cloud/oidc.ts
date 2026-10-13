import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
export const LOOPBACK_PATH = '/oauth/callback';
/** How long fetched issuer metadata is used before it is fetched again. */
export const METADATA_TTL_MS = 24 * 60 * 60_000;
/** Clock skew allowed on the id_token's `exp` / `iat`. */
const SKEW_S = 120;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

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

const b64url = (buf: Buffer): string => buf.toString('base64url');
export const randomToken = (bytes = 32): string => b64url(randomBytes(bytes));
export const s256 = (verifier: string): string => b64url(createHash('sha256').update(verifier).digest());

/** https, or http on this computer only (the mock in unpackaged builds; a real OneAuth is always https). */
export function isAllowedEndpoint(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try {
    const u = new URL(raw);
    if (u.username || u.password) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
  } catch {
    return false;
  }
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

const metadataCache = new Map<string, { meta: OidcMetadata; at: number }>();

/** For the tests. */
export function clearMetadataCache(): void {
  metadataCache.clear();
}

/**
 * The issuer's metadata, cached 24 h. The answer must name the same issuer and only allowed endpoints; anything else
 * is NOT_WORKSUITE, never a partial sign-in.
 */
export async function fetchMetadata(issuer: string, fetch: FetchLike, now: () => number = Date.now): Promise<OidcMetadata> {
  if (!isAllowedEndpoint(issuer)) throw new DesktopError('NOT_WORKSUITE', 'The sign-in service address is not valid.');
  const key = trimSlash(issuer);
  const hit = metadataCache.get(key);
  if (hit && now() - hit.at < METADATA_TTL_MS) return hit.meta;
  let res: Response;
  try {
    res = await fetch(`${key}/.well-known/openid-configuration`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach the WorkSuite sign-in service. Check your connection and try again.');
  }
  if (!res.ok) throw new DesktopError(res.status >= 500 ? 'CLOUD_UNAVAILABLE' : 'NOT_WORKSUITE', `The sign-in service answered ${res.status}.`, res.status);
  const body = (await res.json().catch(() => null)) as Partial<OidcMetadata> | null;
  if (!body || trimSlash(String(body.issuer ?? '')) !== key || !isAllowedEndpoint(body.authorization_endpoint) || !isAllowedEndpoint(body.token_endpoint)) {
    throw new DesktopError('NOT_WORKSUITE', 'The sign-in service did not describe itself correctly.');
  }
  const meta: OidcMetadata = {
    issuer: String(body.issuer),
    authorization_endpoint: body.authorization_endpoint,
    token_endpoint: body.token_endpoint,
    ...(isAllowedEndpoint(body.revocation_endpoint) ? { revocation_endpoint: body.revocation_endpoint } : {}),
    ...(isAllowedEndpoint(body.end_session_endpoint) ? { end_session_endpoint: body.end_session_endpoint } : {}),
  };
  metadataCache.set(key, { meta, at: now() });
  return meta;
}

/** The authorize URL and the secrets to finish it with. `method` is `idp_hint`; sign-up adds `prompt=create`. */
export function buildAuthorize(meta: OidcMetadata, req: AuthorizeRequest): PendingAuthorize {
  const verifier = randomToken(32);
  const state = randomToken(32);
  const nonce = randomToken(32);
  const u = new URL(meta.authorization_endpoint);
  const q = u.searchParams;
  q.set('response_type', 'code');
  q.set('client_id', req.clientId);
  q.set('redirect_uri', req.redirectUri);
  q.set('scope', OIDC_SCOPE);
  q.set('state', state);
  q.set('nonce', nonce);
  q.set('code_challenge', s256(verifier));
  q.set('code_challenge_method', 'S256');
  if (req.method) q.set('idp_hint', req.method);
  const hint = req.loginHint?.trim();
  if (hint) q.set('login_hint', hint.slice(0, 320));
  if (req.purpose === 'sign-up') q.set('prompt', 'create');
  else if (req.purpose === 'reauth') q.set('prompt', 'login');
  return { url: u.toString(), state, nonce, verifier, redirectUri: req.redirectUri };
}

/** The claims of a compact JWT, unverified (the token came straight from the token endpoint over TLS). */
export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as unknown;
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** iss / aud / nonce / exp of an id_token from the code exchange. Throws PASSKEY_FAILED-style sign-in errors. */
export function checkIdToken(idToken: string, expect: { issuer: string; clientId: string; nonce: string }, now: number = Date.now()): Record<string, unknown> {
  const c = decodeJwtClaims(idToken);
  const bad = (why: string) => new DesktopError('INVALID_CREDENTIALS', `The sign-in could not be confirmed (${why}). Start again.`);
  if (!c) throw bad('unreadable');
  if (trimSlash(String(c.iss ?? '')) !== trimSlash(expect.issuer)) throw bad('issuer');
  const aud = Array.isArray(c.aud) ? c.aud.map(String) : [String(c.aud ?? '')];
  if (!aud.includes(expect.clientId)) throw bad('audience');
  if (typeof c.nonce !== 'string' || c.nonce !== expect.nonce) throw bad('nonce');
  const s = Math.floor(now / 1000);
  if (typeof c.exp !== 'number' || c.exp + SKEW_S <= s) throw bad('expired');
  if (typeof c.iat === 'number' && c.iat > s + SKEW_S) throw bad('issued in the future');
  return c;
}

interface TokenAnswer {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  id_token?: unknown;
  error?: unknown;
  error_description?: unknown;
}

async function postForm(fetch: FetchLike, url: string, form: Record<string, string>): Promise<{ status: number; body: TokenAnswer | null }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as TokenAnswer | null };
}

function tokensOf(body: TokenAnswer | null, fallbackRefresh?: string): Tokens | null {
  if (!body || typeof body.access_token !== 'string' || !body.access_token) return null;
  const refresh = typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : fallbackRefresh;
  if (!refresh) return null;
  return {
    access_token: body.access_token,
    refresh_token: refresh,
    expires_in: Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600,
    ...(typeof body.id_token === 'string' ? { id_token: body.id_token } : {}),
  };
}

/** The authorization code for tokens, with the PKCE verifier; the id_token is checked before anything is kept. */
export async function exchangeCode(meta: OidcMetadata, pending: PendingAuthorize, code: string, clientId: string, fetch: FetchLike, now: () => number = Date.now): Promise<Tokens> {
  if (!/^[A-Za-z0-9._~-]{8,2048}$/.test(code)) throw new DesktopError('INVALID_CREDENTIALS', 'That sign-in link is not valid. Start again.');
  let answer: { status: number; body: TokenAnswer | null };
  try {
    answer = await postForm(fetch, meta.token_endpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: clientId,
      code_verifier: pending.verifier,
    });
  } catch {
    throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach the WorkSuite sign-in service. Check your connection and try again.');
  }
  if (answer.status >= 500) throw new DesktopError('CLOUD_UNAVAILABLE', 'WorkSuite Cloud is temporarily unavailable. Try again in a few minutes.', answer.status);
  if (answer.status !== 200) throw new DesktopError('INVALID_CREDENTIALS', 'That sign-in expired or was already used. Start again.', answer.status);
  const tokens = tokensOf(answer.body);
  if (!tokens) throw new DesktopError('SERVER_ERROR', 'The sign-in service did not return a session.');
  if (!tokens.id_token) throw new DesktopError('INVALID_CREDENTIALS', 'The sign-in could not be confirmed (no id_token). Start again.');
  checkIdToken(tokens.id_token, { issuer: meta.issuer, clientId, nonce: pending.nonce }, now());
  return tokens;
}

/** A loopback redirect listener: resolves with the callback URL, or null at the deadline. */
export interface LoopbackListener {
  redirectUri: string;
  result: Promise<string | null>;
  close: () => void;
}

const DONE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>WorkSuite</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px system-ui,sans-serif;margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#F4F5F9;color:#151A2D}
@media (prefers-color-scheme:dark){body{background:#0F1424;color:#E6E9F2}}main{text-align:center;max-width:420px;padding:24px}h1{font-size:22px}</style>
</head><body><main><h1>You can close this tab</h1><p>WorkSuite Desktop is finishing your sign-in.</p></main></body></html>`;

/**
 * A one-shot listener on 127.0.0.1 (never on another interface) for the browser's redirect: the first request to
 * `/oauth/callback` resolves `result` with its full URL and closes the listener; anything else is a 404. At the
 * deadline it closes and resolves null.
 */
export async function listenLoopback(deadline: number, now: () => number = Date.now): Promise<LoopbackListener> {
  let resolveResult!: (url: string | null) => void;
  const result = new Promise<string | null>((r) => (resolveResult = r));
  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (settled || req.method !== 'GET' || url.pathname !== LOOPBACK_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' });
    res.end(DONE_PAGE);
    finish(`${redirectUri}${url.search}`);
  });
  const finish = (url: string | null) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
    resolveResult(url);
  };
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}${LOOPBACK_PATH}`;
  timer = setTimeout(() => finish(null), Math.max(0, deadline - now()));
  timer.unref?.();
  return { redirectUri, result, close: () => finish(null) };
}

/** Refresh and revoke at OneAuth's token endpoint (WP0 `TokenEndpoint`). */
export class OidcTokenEndpoint implements TokenEndpoint {
  readonly kind = 'oidc' as const;

  constructor(
    readonly meta: OidcMetadata,
    readonly clientId: string,
    private readonly fetch: FetchLike = (url, init) => globalThis.fetch(url, init),
  ) {}

  async refresh(refreshToken: string): Promise<RefreshOutcome> {
    let answer: { status: number; body: TokenAnswer | null };
    try {
      answer = await postForm(this.fetch, this.meta.token_endpoint, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.clientId });
    } catch {
      return { status: 'offline' };
    }
    if (answer.status >= 500 || answer.status === 429) return { status: 'offline' };
    if (answer.status !== 200) {
      const error = String(answer.body?.error ?? '');
      const message = typeof answer.body?.error_description === 'string' ? answer.body.error_description : undefined;
      // OneAuth answers invalid_grant for an expired, rotated or revoked grant alike; a revoked device says so.
      return { status: /revoked/i.test(`${error} ${message ?? ''}`) ? 'revoked' : 'refused', ...(message ? { message } : {}) };
    }
    // A server that does not rotate keeps the refresh token it had.
    const tokens = tokensOf(answer.body, refreshToken);
    return tokens ? { status: 'ok', tokens } : { status: 'offline' };
  }

  async revoke(refreshToken: string, _accessToken?: string): Promise<void> {
    if (!this.meta.revocation_endpoint) return;
    try {
      await postForm(this.fetch, this.meta.revocation_endpoint, { token: refreshToken, token_type_hint: 'refresh_token', client_id: this.clientId });
    } catch {
      // Best effort: the grant expires on its own.
    }
  }
}
