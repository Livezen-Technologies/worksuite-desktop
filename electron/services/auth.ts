import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ServerApi, ServerInfo, UserSummary } from '@shared/types';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import { classifyNetworkError, errorFromResponse, type FetchLike } from './http';
import type { SecureStore } from './secure-store';

const log = logger('auth');

/**
 * Sign-in, MFA and token lifecycle (FR-AUTH-01/02/08).
 *
 * WorkSuite issues a one-hour access JWT and a 14-day refresh token that is
 * rotated on every use (the old one is revoked). The access token lives only
 * in this process's memory; the refresh token only in OS secure storage.
 * Because refresh rotates, it is single-flight: two concurrent refreshes
 * would revoke each other.
 */

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface PublicUser {
  id: number | string;
  uuid?: string | null;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  organization?: string | { id?: unknown; name?: unknown } | null;
  org_id?: number | string | null;
  timezone?: string | null;
  locale?: string | null;
  time_format?: string | null;
  week_start?: number | null;
}

export interface SignInPayload {
  user: PublicUser;
  permissions?: string[] | null;
  apps?: string[] | null;
  tokens: Tokens;
  password_expired?: boolean;
  mfa_enrollment_required?: boolean;
}

export type SignInOutcome = { kind: 'mfa' } | { kind: 'signed-in'; payload: SignInPayload };

const REFRESH_KEY = 'auth:refresh';
/** How long the app waits for the browser to come back from a passkey sign-in. */
const PASSKEY_WINDOW_MS = 5 * 60_000;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function normalizeServerUrl(input: string, allowInsecureLocal: boolean): string {
  let raw = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DesktopError('NOT_WORKSUITE', 'That is not a valid server address.');
  }
  if (u.username || u.password) throw new DesktopError('NOT_WORKSUITE', 'Server addresses cannot contain a user name or password.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'http:' && !(allowInsecureLocal && local)) {
    throw new DesktopError('TLS_ERROR', 'WorkSuite Desktop connects only over HTTPS.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new DesktopError('NOT_WORKSUITE', 'Use an https:// address.');
  return u.origin;
}

export function toUserSummary(u: PublicUser): UserSummary {
  const org = u.organization;
  const orgName = typeof org === 'string' ? org : org && typeof org === 'object' && typeof org.name === 'string' ? org.name : null;
  const orgId =
    org && typeof org === 'object' && (typeof org.id === 'number' || typeof org.id === 'string')
      ? String(org.id)
      : u.org_id !== undefined && u.org_id !== null
        ? String(u.org_id)
        : null;
  return {
    id: String(u.id),
    name: (u.name ?? '').trim() || (u.email ?? 'WorkSuite user'),
    email: u.email ?? '',
    avatar: u.avatar ?? null,
    timezone: u.timezone ?? null,
    locale: u.locale ?? null,
    organizationId: orgId,
    organizationName: orgName,
    timeFormat: u.time_format ?? null,
    weekStart: typeof u.week_start === 'number' ? u.week_start : null,
  };
}

async function jsonOrNull(res: Response): Promise<Record<string, unknown> | null> {
  if (!(res.headers.get('content-type') ?? '').includes('json')) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function probeServer(origin: string, fetch: FetchLike): Promise<Omit<ServerInfo, 'locked'>> {
  const host = new URL(origin).hostname;
  const get = async (path: string) => {
    try {
      return await fetch(`${origin}${path}`, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw classifyNetworkError(e);
    }
  };

  // §WF-01 step 2: a server that speaks the desktop API describes itself here.
  const wk = await get('/.well-known/worksuite-desktop');
  if (wk.ok) {
    const body = await jsonOrNull(wk);
    if (body && (body.api === 'desktop-v1' || body.desktop_api === 'v1')) {
      const pk = body.passkey_sign_in as { url?: unknown; exchange?: unknown } | null | undefined;
      // Paths on this same server only: the app never opens, or posts to, an address the server names elsewhere.
      const passkey =
        pk && typeof pk.url === 'string' && typeof pk.exchange === 'string' && /^\/[A-Za-z0-9/_-]+$/.test(pk.url) && /^\/api\/[A-Za-z0-9/_-]+$/.test(pk.exchange)
          ? { url: pk.url, exchange: pk.exchange }
          : null;
      // Per platform (`minimum_versions`), or one version for all.
      const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
      const perPlatform = body.minimum_versions && typeof body.minimum_versions === 'object' ? (body.minimum_versions as Record<string, unknown>)[platform] : undefined;
      return {
        origin,
        name: typeof body.name === 'string' ? body.name : host,
        api: 'desktop-v1',
        minimumVersion: typeof perPlatform === 'string' ? perPlatform : typeof body.minimum_version === 'string' ? body.minimum_version : null,
        passkey,
      };
    }
  }

  // The existing WorkSuite API.
  const cfg = await get('/api/auth/config');
  const body = await jsonOrNull(cfg);
  if (cfg.ok && body && body.status === 'success') {
    const data = (body.data ?? {}) as Record<string, unknown>;
    const brand = data.brand;
    const branded =
      typeof brand === 'string' ? brand : brand && typeof brand === 'object' && typeof (brand as { name?: unknown }).name === 'string' ? (brand as { name: string }).name : '';
    return { origin, name: branded.trim() || host, api: 'core' as ServerApi, minimumVersion: null, passkey: null };
  }
  if (body && body.status === 'error') {
    // A WorkSuite server that is up but failing: say so, rather than
    // suggesting the address is wrong.
    throw new DesktopError('SERVER_ERROR', `${host} is a WorkSuite server, but it reported a problem. Try again in a few minutes, or contact your administrator.`);
  }
  if (cfg.status >= 500) throw new DesktopError('SERVER_ERROR', `${host} is not responding properly right now (error ${cfg.status}). Try again in a few minutes.`);
  throw new DesktopError('NOT_WORKSUITE', `${host} doesn't look like a WorkSuite server. Check the address with your administrator.`);
}

export class AuthService {
  private access: { token: string; expiresAt: number } | null = null;
  private challenge: { token: string; email: string; expiresAt: number } | null = null;
  /** A passkey sign-in started in the browser: the PKCE verifier and state, kept only in memory. */
  private passkeyPending: { verifier: string; state: string; expiresAt: number } | null = null;
  private refreshing: Promise<'ok' | 'offline' | 'lost'> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private server: ServerInfo | null = null;
  onTokens: (() => void) | null = null;
  /** The server refused a refresh because this device was revoked (WF-24). */
  onDeviceRevoked: ((message: string) => void) | null = null;

  constructor(
    private readonly db: Database,
    private readonly secrets: SecureStore,
    private readonly fetch: FetchLike,
    private readonly clientHeaders: () => Record<string, string>,
  ) {
    this.server = db.getConfig<ServerInfo>('server') ?? null;
  }

  getServer(): ServerInfo | null {
    return this.server;
  }

  setServer(info: ServerInfo): void {
    this.server = info;
    this.db.setConfig('server', info);
  }

  clearServer(): void {
    this.server = null;
    this.db.deleteConfig('server');
  }

  hasRefreshToken(): boolean {
    return this.secrets.get(REFRESH_KEY) !== null;
  }

  accessToken(): string | null {
    if (!this.access) return null;
    // A token within a minute of expiry is treated as expired; the 401 path refreshes.
    return this.access.expiresAt - Date.now() > 60_000 ? this.access.token : null;
  }

  private origin(): string {
    if (!this.server) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    return this.server.origin;
  }

  private async post(path: string, body: unknown, bearer?: string): Promise<{ res: Response; json: Record<string, unknown> | null }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', ...this.clientHeaders() };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    let res: Response;
    try {
      res = await this.fetch(`${this.origin()}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
    } catch (e) {
      throw classifyNetworkError(e);
    }
    return { res, json: await jsonOrNull(res) };
  }

  async signIn(email: string, password: string): Promise<SignInOutcome> {
    const { res, json } = await this.post('/api/auth/login', { email, password });
    if (!res.ok) {
      if (res.status === 401) throw new DesktopError('INVALID_CREDENTIALS', 'That email and password don’t match.');
      throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    }
    const data = (json?.data ?? {}) as Record<string, unknown>;
    if (data.mfa_required === true && typeof data.challenge === 'string') {
      this.challenge = { token: data.challenge, email, expiresAt: Date.now() + 5 * 60_000 };
      return { kind: 'mfa' };
    }
    return { kind: 'signed-in', payload: this.accept(data) };
  }

  hasPendingChallenge(): boolean {
    return this.challenge !== null && this.challenge.expiresAt > Date.now();
  }

  cancelChallenge(): void {
    this.challenge = null;
  }

  async verifyMfa(code: string): Promise<SignInPayload> {
    if (!this.challenge || this.challenge.expiresAt < Date.now()) {
      this.challenge = null;
      throw new DesktopError('MFA_INVALID', 'That sign-in attempt expired. Start again.');
    }
    const { res, json } = await this.post('/api/auth/mfa', { challenge: this.challenge.token, code });
    if (!res.ok) {
      const message = typeof json?.message === 'string' ? json.message : 'That code is not valid.';
      if (res.status === 401) {
        if (/expired/i.test(message)) this.challenge = null;
        throw new DesktopError('MFA_INVALID', message);
      }
      throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    }
    this.challenge = null;
    return this.accept((json?.data ?? {}) as Record<string, unknown>);
  }

  /**
   * Start a passkey sign-in in the browser (see the server's
   * Auth\Libraries\DesktopHandoff). A passkey only works on a page from the
   * server's own address, which this app's screens are not, so the browser
   * proves it and sends back a one-time code through worksuite://auth/callback.
   *
   * PKCE (RFC 7636, S256) binds that code to this app: only the challenge
   * leaves the process; the verifier stays in memory, and the code is useless
   * without it — so another program registered for worksuite:// that saw the
   * link could not use it. The state ties the callback to this attempt.
   *
   * @returns the page to open in the browser
   */
  startPasskey(deviceName: string): string {
    const pk = this.server?.passkey;
    if (!this.server || !pk) throw new DesktopError('UNSUPPORTED', 'This WorkSuite server does not offer passkey sign-in to the desktop app.');
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(24));
    this.passkeyPending = { verifier, state, expiresAt: Date.now() + PASSKEY_WINDOW_MS };
    const q = new URLSearchParams({ challenge: b64url(createHash('sha256').update(verifier).digest()), state, device: deviceName.slice(0, 80) });
    return `${this.origin()}${pk.url}?${q.toString()}`;
  }

  hasPendingPasskey(): boolean {
    return this.passkeyPending !== null && this.passkeyPending.expiresAt > Date.now();
  }

  /** Is this callback for the sign-in waiting now? A stray one must not cancel it. */
  isPendingPasskey(state: string): boolean {
    return this.passkeyPending !== null && sameSecret(this.passkeyPending.state, state);
  }

  cancelPasskey(): void {
    this.passkeyPending = null;
  }

  /** The browser came back with a code: exchange it, once, for a session. */
  async completePasskey(code: string, state: string): Promise<SignInPayload> {
    const pending = this.passkeyPending;
    const pk = this.server?.passkey;
    if (!pending || !pk || !sameSecret(pending.state, state)) {
      throw new DesktopError('PASSKEY_FAILED', 'That sign-in was not started from this app. Choose “Sign in with a passkey” to start again.');
    }
    // One attempt per start, right or wrong.
    this.passkeyPending = null;
    if (pending.expiresAt < Date.now()) throw new DesktopError('PASSKEY_FAILED', 'That sign-in took too long. Start again.');
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new DesktopError('PASSKEY_FAILED', 'That sign-in link is not valid. Start again.');
    const { res, json } = await this.post(pk.exchange, { code, code_verifier: pending.verifier });
    if (!res.ok) {
      if (res.status === 401) throw new DesktopError('PASSKEY_FAILED', typeof json?.message === 'string' ? json.message : 'That sign-in expired. Start again.');
      throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    }
    return this.accept((json?.data ?? {}) as Record<string, unknown>);
  }

  private accept(data: Record<string, unknown>): SignInPayload {
    const tokens = data.tokens as Tokens | undefined;
    if (!tokens?.access_token || !tokens.refresh_token) throw new DesktopError('SERVER_ERROR', 'The server did not return a session.');
    this.storeTokens(tokens);
    return data as unknown as SignInPayload;
  }

  private storeTokens(tokens: Tokens): void {
    this.secrets.set(REFRESH_KEY, tokens.refresh_token);
    const ttl = Math.max(60, Number(tokens.expires_in) || 3600) * 1000;
    this.access = { token: tokens.access_token, expiresAt: Date.now() + ttl };
    this.scheduleRefresh(ttl);
    this.onTokens?.();
  }

  private scheduleRefresh(ttlMs: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    // Refresh ahead of expiry so a quiet app is not caught by a 401.
    this.refreshTimer = setTimeout(() => void this.refresh(), Math.max(30_000, ttlMs - 120_000));
    this.refreshTimer.unref?.();
  }

  /** Single-flight refresh. 'lost' clears the stored refresh token. */
  refresh(): Promise<'ok' | 'offline' | 'lost'> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const token = this.secrets.get(REFRESH_KEY);
      if (!token || !this.server) return 'lost' as const;
      try {
        const { res, json } = await this.post('/api/auth/refresh', { refresh_token: token });
        if (res.status === 401 || res.status === 403) {
          if (json?.code === 'DEVICE_REVOKED') {
            this.secrets.delete(REFRESH_KEY);
            this.access = null;
            this.onDeviceRevoked?.(typeof json.message === 'string' ? json.message : 'This computer was removed from WorkSuite.');
            return 'lost' as const;
          }
          log.info('refresh refused; session ended');
          this.secrets.delete(REFRESH_KEY);
          this.access = null;
          return 'lost' as const;
        }
        if (!res.ok) return 'offline' as const;
        const data = (json?.data ?? {}) as { tokens?: Tokens };
        if (!data.tokens?.access_token) return 'offline' as const;
        this.storeTokens(data.tokens);
        return 'ok' as const;
      } catch (e) {
        log.info('refresh could not reach server', { error: String((e as Error).message) });
        return 'offline' as const;
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /**
   * Checks the password for the app lock (FR-SEC-04) with the sign-in API.
   * A correct password either opens a new session — which replaces this
   * one — or, for MFA accounts, returns the MFA challenge, which the server
   * only issues after the password matched; the challenge is discarded.
   */
  async verifyPassword(email: string, password: string): Promise<boolean> {
    const { res, json } = await this.post('/api/auth/login', { email, password });
    if (res.status === 401) return false;
    if (!res.ok) throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    const data = (json?.data ?? {}) as Record<string, unknown>;
    if (data.mfa_required === true) return true;
    const tokens = data.tokens as Tokens | undefined;
    if (tokens?.refresh_token) {
      const old = this.secrets.get(REFRESH_KEY);
      this.storeTokens(tokens);
      if (old) void this.post('/api/auth/logout', { refresh_token: old }, tokens.access_token).catch(() => undefined);
    }
    return true;
  }

  async signOut(): Promise<void> {
    const token = this.secrets.get(REFRESH_KEY);
    const bearer = this.access?.token;
    if (token && this.server) {
      try {
        await this.post('/api/auth/logout', { refresh_token: token }, bearer);
      } catch (e) {
        log.info('logout could not reach server; clearing locally', { error: String(e) });
      }
    }
    this.forget();
  }

  /** Clears credentials locally without contacting the server (revoke, wipe). */
  forget(): void {
    this.secrets.delete(REFRESH_KEY);
    this.access = null;
    this.challenge = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}
