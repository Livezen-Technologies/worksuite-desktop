import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DeviceCodeStep, ServerApi, ServerInfo, UserSummary } from '@shared/types';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import { classifyNetworkError, errorFromResponse, type FetchLike } from './http';
import type { SecureStore } from './secure-store';
import { challengeIsNewDevice, deviceStepFrom, gateFrom, isDeviceToken, SignInGateError } from './sign-in-gate';

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
  /** Servers since worksuite Users 1.1.0 (#46). */
  picture_required?: boolean | null;
}

export interface SignInPayload {
  user: PublicUser;
  permissions?: string[] | null;
  apps?: string[] | null;
  tokens: Tokens;
  password_expired?: boolean;
  mfa_enrollment_required?: boolean;
  /** A computer this sign-in verified (worksuite-desktop#301): sent back as X-Device-Token from now on. */
  device_token?: string;
}

export type SignInOutcome =
  | { kind: 'mfa'; newDevice: boolean }
  | { kind: 'device-code'; step: DeviceCodeStep }
  | { kind: 'signed-in'; payload: SignInPayload };

const REFRESH_KEY = 'auth:refresh';
/** Remembered-computer tokens, one per server and account (`auth:device:<hash>`), in OS secure storage. */
const DEVICE_PREFIX = 'auth:device:';
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
    pictureRequired: u.picture_required === true,
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
  private challenge: { token: string; email: string; expiresAt: number; newDevice: boolean } | null = null;
  /** A new computer's emailed-code step (worksuite-desktop#301): the server's challenge, and what the screen shows. */
  private deviceChallenge: { token: string; email: string; step: DeviceCodeStep } | null = null;
  /** A solved CAPTCHA, for the next password attempt only. */
  private captcha: { token: string; email: string | null; expiresAt: number } | null = null;
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

  private async post(path: string, body: unknown, bearer?: string, extra: Record<string, string> = {}): Promise<{ res: Response; json: Record<string, unknown> | null }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', ...this.clientHeaders(), ...extra };
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

  // ── remembered computers (worksuite-desktop#301) ─────────────────────

  private deviceKey(email: string): string | null {
    if (!this.server || !email.trim()) return null;
    return DEVICE_PREFIX + createHash('sha256').update(`${this.server.origin}\n${email.trim().toLowerCase()}`).digest('hex').slice(0, 40);
  }

  /** This computer's token for that account on this server, once it has been verified there. */
  private deviceTokenFor(email: string): string | null {
    const key = this.deviceKey(email);
    const token = key ? this.secrets.get(key) : null;
    return isDeviceToken(token) ? token : null;
  }

  private keepDeviceToken(email: string, token: unknown, remember: boolean): void {
    const key = this.deviceKey(email);
    if (!key) return;
    try {
      if (remember && isDeviceToken(token)) this.secrets.set(key, token);
      // Not remembered: the next sign-in here is verified again.
      else if (!remember) this.secrets.delete(key);
    } catch (e) {
      log.warn('remembered-computer token not saved', { error: String((e as Error)?.message ?? e) });
    }
    if (remember) this.db.setConfig('device_email', email.trim().toLowerCase());
  }

  /**
   * `X-Device-Token` for the account signed in on this computer, so the server can say which remembered device is
   * this one (the account's Security page). Only ever sent to the configured server.
   */
  deviceHeader(): Record<string, string> {
    const email = this.db.getConfig<string>('device_email');
    const token = email ? this.deviceTokenFor(email) : null;
    return token ? { 'X-Device-Token': token } : {};
  }

  /** Forget every remembered-computer token (a wipe): the next sign-in on each account is verified again. */
  forgetDevices(): void {
    try {
      this.secrets.deletePrefix(DEVICE_PREFIX);
    } catch (e) {
      // A wipe goes on whatever the OS store says.
      log.warn('remembered-computer tokens not removed', { error: String((e as Error)?.message ?? e) });
    }
    this.db.deleteConfig('device_email');
  }

  // ── sign-in ─────────────────────────────────────────────────────────────

  /** A solved CAPTCHA's token, sent with the next password attempt (and only that one). */
  setCaptchaToken(token: string, email: string | null): void {
    this.captcha = { token, email: email ? email.trim().toLowerCase() : null, expiresAt: Date.now() + 2 * 60_000 };
  }

  hasCaptchaToken(): boolean {
    return this.captcha !== null && this.captcha.expiresAt > Date.now();
  }

  private takeCaptcha(email: string): string | null {
    const c = this.captcha;
    this.captcha = null;
    if (!c || c.expiresAt < Date.now()) return null;
    return c.email === null || c.email === email.trim().toLowerCase() ? c.token : null;
  }

  /** A password post with this computer's remembered-device token, so a known computer is not asked to verify again. */
  private withDevice(email: string, body: Record<string, string>): [Record<string, string>, undefined, Record<string, string>] {
    const device = this.deviceTokenFor(email);
    return device ? [{ ...body, device_token: device }, undefined, { 'X-Device-Token': device }] : [body, undefined, {}];
  }

  /**
   * The password step. A wrong password throws INVALID_CREDENTIALS; a CAPTCHA, a wait or a block throws a
   * `SignInGateError` the session shows instead; two-factor or a new computer's emailed code is the next step.
   */
  async signIn(email: string, password: string): Promise<SignInOutcome> {
    const device = this.deviceTokenFor(email);
    const captcha = this.takeCaptcha(email);
    const [body, , headers] = this.withDevice(email, captcha ? { email, password, captcha_token: captcha } : { email, password });
    const { res, json } = await this.post('/api/auth/login', body, undefined, headers);
    if (!res.ok) {
      const gate = gateFrom(res.status, json, email, res.headers.get('retry-after'));
      if (gate) throw new SignInGateError(gate);
      if (res.status === 401) throw new DesktopError('INVALID_CREDENTIALS', 'That email and password don’t match.');
      throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    }
    const data = (json?.data ?? {}) as Record<string, unknown>;
    if (data.mfa_required === true && typeof data.challenge === 'string') {
      const newDevice = challengeIsNewDevice(data.challenge);
      this.challenge = { token: data.challenge, email, expiresAt: Date.now() + 5 * 60_000, newDevice };
      this.deviceChallenge = null;
      return { kind: 'mfa', newDevice };
    }
    const step = deviceStepFrom(data);
    if (step) {
      this.deviceChallenge = { token: step.challenge, email, step: step.step };
      this.challenge = null;
      return { kind: 'device-code', step: step.step };
    }
    const payload = this.accept(data);
    // Signed in on a computer the server already knows (or with the check off): it may have issued a token anyway.
    if (payload.device_token) this.keepDeviceToken(email, payload.device_token, true);
    else if (device) this.db.setConfig('device_email', email.trim().toLowerCase());
    return { kind: 'signed-in', payload };
  }

  hasPendingChallenge(): boolean {
    return this.challenge !== null && this.challenge.expiresAt > Date.now();
  }

  cancelChallenge(): void {
    this.challenge = null;
    this.deviceChallenge = null;
  }

  async verifyMfa(code: string, remember = true): Promise<SignInPayload> {
    if (!this.challenge || this.challenge.expiresAt < Date.now()) {
      this.challenge = null;
      throw new DesktopError('MFA_INVALID', 'That sign-in attempt expired. Start again.');
    }
    const { email } = this.challenge;
    const { res, json } = await this.post('/api/auth/mfa', ...this.withDevice(email, { challenge: this.challenge.token, code }));
    if (!res.ok) {
      const gate = gateFrom(res.status, json, email, res.headers.get('retry-after'));
      if (gate) {
        this.challenge = null;
        throw new SignInGateError(gate);
      }
      const message = typeof json?.message === 'string' ? json.message : 'That code is not valid.';
      if (res.status === 401) {
        if (/expired/i.test(message)) this.challenge = null;
        throw new DesktopError('MFA_INVALID', message);
      }
      // Too many codes for this challenge (MfaChallenge): this attempt is over.
      if (res.status === 429) {
        this.challenge = null;
        throw new DesktopError('MFA_INVALID', message);
      }
      throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    }
    this.challenge = null;
    const payload = this.accept((json?.data ?? {}) as Record<string, unknown>);
    if (payload.device_token || !remember) this.keepDeviceToken(email, payload.device_token, remember);
    return payload;
  }

  // ── a new computer's emailed code ──────────────────────────────────────

  deviceStep(): DeviceCodeStep | null {
    const d = this.deviceChallenge;
    return d && d.step.expiresAt > Date.now() ? { ...d.step } : null;
  }

  hasDeviceChallenge(): boolean {
    return this.deviceStep() !== null;
  }

  /**
   * The emailed code. A wrong one throws MFA_INVALID with the tries left and keeps the step; an expired or spent
   * code ends it (`hasDeviceChallenge()` is false afterwards: sign in again for a new one); a wait or a block throws
   * a `SignInGateError`.
   */
  async verifyDevice(code: string, remember: boolean): Promise<SignInPayload> {
    const d = this.deviceChallenge;
    if (!d || d.step.expiresAt < Date.now()) {
      this.deviceChallenge = null;
      throw new DesktopError('MFA_INVALID', 'That code has expired. Sign in again to get a new one.');
    }
    const { res, json } = await this.post('/api/auth/device', { challenge: d.token, code });
    if (!res.ok) {
      const gate = gateFrom(res.status, json, d.email, res.headers.get('retry-after'));
      if (gate) {
        this.deviceChallenge = null;
        throw new SignInGateError(gate);
      }
      const message = typeof json?.message === 'string' ? json.message : 'That code is not right.';
      const errors = json?.errors && typeof json.errors === 'object' ? (json.errors as Record<string, unknown>) : {};
      if (res.status === 401 && !/expired/i.test(message)) {
        const left = Math.max(0, d.step.attemptsLeft - 1);
        d.step = { ...d.step, attemptsLeft: left };
        if (left === 0) this.deviceChallenge = null;
        throw new DesktopError('MFA_INVALID', left > 0 ? `${message} ${left === 1 ? 'One try' : `${left} tries`} left.` : message);
      }
      if (res.status === 401 || errors.code === 'code_spent' || res.status === 429) {
        this.deviceChallenge = null;
        throw new DesktopError('MFA_INVALID', message);
      }
      throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    }
    this.deviceChallenge = null;
    const payload = this.accept((json?.data ?? {}) as Record<string, unknown>);
    this.keepDeviceToken(d.email, payload.device_token, remember);
    return payload;
  }

  /** Another code for the same step: at most one a minute and five an hour, which the server enforces and says. */
  async resendDevice(): Promise<DeviceCodeStep> {
    const d = this.deviceChallenge;
    if (!d || d.step.expiresAt < Date.now()) {
      this.deviceChallenge = null;
      throw new DesktopError('MFA_INVALID', 'That sign-in attempt expired. Start again.');
    }
    const { res, json } = await this.post('/api/auth/device/resend', { challenge: d.token });
    const message = typeof json?.message === 'string' ? json.message : null;
    if (!res.ok) {
      if (res.status === 401) {
        this.deviceChallenge = null;
        throw new DesktopError('MFA_INVALID', message ?? 'That sign-in attempt expired. Start again.');
      }
      if (res.status === 429) throw new DesktopError('RATE_LIMITED', message ?? 'Wait a moment before asking for another code.');
      throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    }
    const now = Date.now();
    // A new code is good for ten minutes, and five more tries.
    d.step = { ...d.step, sent: true, message, resendAt: now + 60_000, expiresAt: now + 10 * 60_000, attemptsLeft: 5 };
    return { ...d.step };
  }

  /** "Email me an unblock link" on the blocked screen. The same answer whatever happened, as the server's. */
  async requestUnblock(email: string): Promise<string> {
    const { res, json } = await this.post('/api/auth/unblock/request', { email });
    if (!res.ok && res.status !== 404) throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    return typeof json?.message === 'string' && res.ok ? json.message : 'If this account can be unblocked by email, a link is on its way.';
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
    // A refresh still under way belongs to the session this one replaces: what asks next refreshes this one, not waits on that.
    if (!this.held) this.refreshing = null;
    return data as unknown as SignInPayload;
  }

  private storeTokens(tokens: Tokens): void {
    try {
      this.secrets.set(REFRESH_KEY, tokens.refresh_token);
    } catch (e) {
      // The OS store refused the write (a keychain prompt denied, a file another program holds): the token is still
      // kept in memory, so this session carries on; only staying signed in across a restart is lost. Failing here
      // used to fail a sign-in whose password was right with "Something went wrong" (LOGIN-001).
      log.warn('refresh token not saved to secure storage; kept for this run only', { error: String((e as Error)?.message ?? e) });
    }
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

  /**
   * Single-flight refresh. 'lost' clears the stored refresh token.
   *
   * The answer is applied only to the session it was asked for. A sign-in
   * (or a sign-out) while the request was under way — two seconds and more
   * on a busy server — replaced that session, and the answer is about the old
   * one: refused, it used to delete the NEW refresh token and access token,
   * so the sign-in that had just succeeded failed on its next request and the
   * person was back at the sign-in screen; accepted, it put the old session's
   * tokens over the new ones (LOGIN-001). Such an answer is now dropped, and
   * the outcome is whether a session is there now.
   */
  refresh(): Promise<'ok' | 'offline' | 'lost'> {
    if (this.refreshing) return this.refreshing;
    const flight: Promise<'ok' | 'offline' | 'lost'> = (async () => {
      const token = this.secrets.get(REFRESH_KEY);
      if (!token || !this.server) return 'lost' as const;
      const replaced = () => this.secrets.get(REFRESH_KEY) !== token;
      const now = () => (this.secrets.get(REFRESH_KEY) ? ('ok' as const) : ('lost' as const));
      try {
        const { res, json } = await this.post('/api/auth/refresh', { refresh_token: token });
        if (replaced()) {
          log.info('refresh answered for a session already replaced; ignored', { status: res.status });
          return now();
        }
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
        if (replaced()) return now();
        log.info('refresh could not reach server', { error: String((e as Error).message) });
        return 'offline' as const;
      }
    })().finally(() => {
      // Only its own slot: a sign-in may have let go of this one and a newer refresh taken its place.
      if (this.refreshing === flight) this.refreshing = null;
    });
    this.refreshing = flight;
    return flight;
  }

  /**
   * Checks the password for the app lock (FR-SEC-04) with the sign-in API.
   * A correct password either opens a new session or, for MFA accounts,
   * returns the MFA challenge, which the server only issues after the
   * password matched; the challenge is discarded.
   *
   * THE NEW SESSION IS CLOSED AT ONCE, WITH ITS OWN TOKENS, AND THIS ONE
   * CARRIES ON. It used to be kept and the old one signed out — by posting
   * the old refresh token to `/api/auth/logout` with the NEW access token.
   * The server's logout also ends the session of the token it is called
   * with, so every unlock ended the session it had just opened: the next
   * request (within half a minute, whatever polled first) was refused with
   * "Session ended. Please sign in again." and the app went back to the
   * sign-in screen — QA-002 and QA-003. Nothing about this session needs
   * replacing: it was only locked, not ended.
   */
  async verifyPassword(email: string, password: string): Promise<boolean> {
    const { res, json } = await this.post('/api/auth/login', ...this.withDevice(email, { email, password }));
    if (res.status === 401) return false;
    if (!res.ok) throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    const data = (json?.data ?? {}) as Record<string, unknown>;
    if (data.mfa_required === true) return true;
    const tokens = data.tokens as Tokens | undefined;
    if (tokens?.refresh_token && tokens.access_token) {
      void this.post('/api/auth/logout', { refresh_token: tokens.refresh_token }, tokens.access_token).catch(() => undefined);
    }
    return true;
  }

  /**
   * Which of the account's sessions is this app's: the `sid` claim of the
   * access token, which is the id of the refresh token behind it (the rows
   * `GET /api/auth/sessions` lists). It changes whenever the session is
   * refreshed. Read without verifying — it is our own token, and the id is
   * only used to label "This device" and to leave it out of "Sign out others".
   */
  sessionId(): number | null {
    const token = this.access?.token;
    const payload = token?.split('.')[1];
    if (!payload) return null;
    try {
      const sid = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sid?: unknown }).sid;
      const n = typeof sid === 'string' ? Number(sid) : sid;
      return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * Stay signed in after a password change. The server ends every session of
   * the account when the password changes — this one too, at once (the auth
   * filter checks the token's session) — so the app signs in again with the
   * new password and carries on.
   *
   * Between the change and the new session, anything this app sends is
   * refused, and a refusal would normally spend the refresh token — which is
   * revoked — and end the session. So refreshes are HELD first: a request
   * refused meanwhile waits for the new session and is sent again with it.
   * `hold()` before the change; the change's outcome releases it.
   */
  private held: ((r: 'ok' | 'lost') => void) | null = null;

  hold(): void {
    if (this.held) return;
    let done!: (r: 'ok' | 'lost') => void;
    const waiting = new Promise<'ok' | 'offline' | 'lost'>((resolve) => {
      done = resolve;
    });
    // Nobody finishes it (a code never typed): the session is gone, as the server says.
    const timer = setTimeout(() => this.release('lost'), 5 * 60_000);
    timer.unref?.();
    this.held = (r) => {
      clearTimeout(timer);
      this.held = null;
      this.refreshing = null;
      if (r === 'lost') {
        this.secrets.delete(REFRESH_KEY);
        this.access = null;
      }
      done(r);
    };
    this.refreshing = waiting;
  }

  /** Ends a hold: 'ok' with a new session (or nothing changed), 'lost' when there is none. */
  release(r: 'ok' | 'lost'): void {
    this.held?.(r);
  }

  isHeld(): boolean {
    return this.held !== null;
  }

  /**
   * Sign in again with the new password. An account with two-factor gets the
   * code challenge back instead ('mfa') and stays held; `renewMfa` finishes.
   */
  async renew(email: string, password: string): Promise<'renewed' | 'mfa'> {
    const { res, json } = await this.post('/api/auth/login', ...this.withDevice(email, { email, password }));
    if (!res.ok) throw errorFromResponse(res.status, json as never, res.headers.get('retry-after'));
    const data = (json?.data ?? {}) as Record<string, unknown>;
    if (data.mfa_required === true && typeof data.challenge === 'string') {
      this.challenge = { token: data.challenge, email, expiresAt: Date.now() + 5 * 60_000, newDevice: false };
      return 'mfa';
    }
    this.accept(data);
    this.release('ok');
    return 'renewed';
  }

  /** The code for a renewal; a wrong one keeps the hold, so it can be typed again. */
  async renewMfa(code: string): Promise<void> {
    await this.verifyMfa(code);
    this.release('ok');
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
    this.deviceChallenge = null;
    this.captcha = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}
