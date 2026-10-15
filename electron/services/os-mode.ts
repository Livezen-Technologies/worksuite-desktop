import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import type { RefreshOutcome, TokenEndpoint, Tokens } from './auth-tokens';

/**
 * WorkSuite OS mode, main process (docs/WORKSUITE_OS.md): the OS credentials broker instead of the sign-in screen,
 * the OS device enrolment instead of registering again.
 *
 * - **Credentials broker** (`worksuite-credentials`, Worksuite-OS services/credentials): a 0600 Unix socket at
 *   `$XDG_RUNTIME_DIR/worksuite/credentials.sock`, one JSON request per line —
 *   `{"method":"Status"}` → `{"result":[{id, server_url, name?, state}]}`,
 *   `{"method":"GetAccessToken","params":{account_id, force_refresh}}` → `{"result":"<token>","expires_at":<ms>}`,
 *   `{"method":"SignIn","params":{server_url, mode}}` → `{"result":{id, name, server_url}}` (opens the system browser),
 *   or `{"error":"<code>"}`. The refresh token never leaves the broker (it is in the keyring); this app holds only a
 *   short-lived access token, in memory.
 * - **Device agent** (`worksuite-device-agent`, services/device-agent): `/run/worksuite-device-agent/status.json` and
 *   `/run/worksuite-device-agent/device-token`, both 0644 and readable by every user — the same files the broker and
 *   the sync service read to send `X-WS-Device`.
 */

export type BrokerReply = { ok: true; value: unknown; expiresAt?: number } | { ok: false; error: string };
export type BrokerCall = (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<BrokerReply>;

export function brokerSocketPath(env: Record<string, string | undefined> = process.env, uid: number | undefined = process.getuid?.()): string {
  return join(env.XDG_RUNTIME_DIR || `/run/user/${uid ?? 0}`, 'worksuite', 'credentials.sock');
}

/** One request per connection, as the OS shell's client does. Never throws: a dead broker is `broker_unavailable`. */
export function createBrokerCall(socketPath: string = brokerSocketPath()): BrokerCall {
  return (method, params = {}, timeoutMs = 15_000) =>
    new Promise((resolve) => {
      const sock = createConnection(socketPath);
      let buf = '';
      let settled = false;
      const finish = (r: BrokerReply) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        resolve(r);
      };
      sock.setEncoding('utf8');
      sock.setTimeout(timeoutMs, () => finish({ ok: false, error: 'broker_timeout' }));
      sock.on('connect', () => sock.write(JSON.stringify({ method, params }) + '\n'));
      sock.on('data', (c: string) => {
        buf += c;
        if (buf.length > 64 * 1024) return finish({ ok: false, error: 'bad_reply' });
        const nl = buf.indexOf('\n');
        if (nl < 0) return;
        finish(parseBrokerReply(buf.slice(0, nl)));
      });
      sock.on('error', () => finish({ ok: false, error: 'broker_unavailable' }));
    });
}

export function parseBrokerReply(line: string): BrokerReply {
  try {
    const res = JSON.parse(line) as { result?: unknown; error?: unknown; expires_at?: unknown };
    if (res === null || typeof res !== 'object') return { ok: false, error: 'bad_reply' };
    if ('error' in res && res.error !== undefined && res.error !== null) return { ok: false, error: String(res.error) };
    return typeof res.expires_at === 'number' ? { ok: true, value: res.result, expiresAt: res.expires_at } : { ok: true, value: res.result };
  } catch {
    return { ok: false, error: 'bad_reply' };
  }
}

export interface BrokerAccount {
  id: string;
  server_url: string;
  name: string | null;
  state: 'signed_in' | 'signed_out' | 'refresh_failed' | 'locked' | string;
}

export function brokerAccounts(v: unknown): BrokerAccount[] {
  if (!Array.isArray(v)) return [];
  const out: BrokerAccount[] = [];
  for (const a of v as Record<string, unknown>[]) {
    if (!a || typeof a.id !== 'string' || !a.id || typeof a.server_url !== 'string' || !httpsUrl(a.server_url)) continue;
    out.push({ id: a.id, server_url: a.server_url, name: typeof a.name === 'string' ? a.name : null, state: typeof a.state === 'string' ? a.state : '' });
  }
  return out;
}

function httpsUrl(s: string): URL | null {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password ? u : null;
  } catch {
    return null;
  }
}

/** The account to open: one on the enrolled organisation's server, else the first signed in, else the first. */
export function chooseOsAccount(accounts: BrokerAccount[], deviceServer: string | null): BrokerAccount | null {
  const host = deviceServer ? httpsUrl(deviceServer)?.host ?? null : null;
  const onDevice = host ? accounts.filter((a) => new URL(a.server_url).host === host) : [];
  return onDevice.find((a) => a.state === 'signed_in') ?? accounts.find((a) => a.state === 'signed_in') ?? onDevice[0] ?? accounts[0] ?? null;
}

/** Where the broker's sign-in goes — the same rule as the OS shell's `signInTarget` (shell/electron/webapps.ts). */
export function osSignInTarget(deviceServer: string | null, accounts: BrokerAccount[]): { server_url: string; mode: 'personal' | 'enterprise' } {
  if (deviceServer && httpsUrl(deviceServer)) return { server_url: deviceServer, mode: 'enterprise' };
  const prev = accounts[0];
  if (prev) return { server_url: prev.server_url, mode: new URL(prev.server_url).hostname.endsWith('worksuitecloud.com') ? 'personal' : 'enterprise' };
  return { server_url: 'https://worksuitecloud.com', mode: 'personal' };
}

/** How long the broker's sign-in may take: the person is in the browser. */
export const BROKER_SIGN_IN_TIMEOUT_MS = 10 * 60_000;

export type OsConnect = { ok: true; account: BrokerAccount } | { ok: false; error: string };

/**
 * The OS account this app opens: the one signed in, or — none — the broker's sign-in in the system browser. The app
 * never asks for a password in OS mode.
 */
export async function connectOsAccount(call: BrokerCall, deviceServer: string | null, onBrowser: () => void = () => undefined): Promise<OsConnect> {
  const st = await call('Status');
  if (!st.ok) return { ok: false, error: st.error };
  const accounts = brokerAccounts(st.value);
  const pick = chooseOsAccount(accounts, deviceServer);
  if (pick?.state === 'signed_in') return { ok: true, account: pick };
  if (pick?.state === 'locked') return { ok: false, error: 'locked' };
  const target = pick ? { server_url: pick.server_url, mode: osSignInTarget(null, [pick]).mode } : osSignInTarget(deviceServer, accounts);
  if (pick && deviceServer && httpsUrl(deviceServer)?.host === new URL(pick.server_url).host) target.mode = 'enterprise';
  onBrowser();
  const r = await call('SignIn', target, BROKER_SIGN_IN_TIMEOUT_MS);
  if (!r.ok) return { ok: false, error: r.error };
  const a = r.value as Record<string, unknown> | null;
  if (!a || typeof a.id !== 'string' || typeof a.server_url !== 'string' || !httpsUrl(a.server_url)) return { ok: false, error: 'bad_reply' };
  return { ok: true, account: { id: a.id, server_url: a.server_url, name: typeof a.name === 'string' ? a.name : null, state: 'signed_in' } };
}

/** What AuthService stores where a refresh token would be: a marker naming the broker account, not a secret. */
export const BROKER_REFRESH_PREFIX = 'wsos-broker:';

/**
 * The broker as this account's token endpoint (`TokenEndpoint`, auth-tokens.ts): AuthService keeps its single-flight
 * refresh and timers, and a "refresh" is a `GetAccessToken` from the broker. Sign-out never revokes: the session is
 * the OS's (Settings › Accounts in WorkSuite OS signs out everywhere).
 */
export class BrokerTokenEndpoint implements TokenEndpoint {
  readonly kind = 'broker' as const;
  constructor(
    private readonly call: BrokerCall,
    readonly accountId: string,
    private readonly now: () => number = Date.now,
  ) {}

  refreshMarker(): string {
    return BROKER_REFRESH_PREFIX + this.accountId;
  }

  /** The token to start with: the broker's cached one when it is still good. */
  token(force = false): Promise<RefreshOutcome> {
    return this.ask(force);
  }

  refresh(): Promise<RefreshOutcome> {
    // AuthService refreshes ahead of expiry and after a 401: either way the broker's cached token is not wanted.
    return this.ask(true);
  }

  async revoke(): Promise<void> {
    /* the OS owns the session */
  }

  private async ask(force: boolean): Promise<RefreshOutcome> {
    const r = await this.call('GetAccessToken', { account_id: this.accountId, force_refresh: force });
    if (!r.ok) {
      // The broker could not refresh (the grant is gone) or no longer knows the account: sign in again through it.
      if (r.error === 'sign_in_required' || r.error === 'unknown_account' || r.error === 'no_refresh_token' || r.error === 'invalid_argument') return { status: 'refused', message: brokerMessage(r.error) };
      // Locked, not running, slow: the session stands and is asked again later.
      return { status: 'offline', message: brokerMessage(r.error) };
    }
    if (typeof r.value !== 'string' || !r.value) return { status: 'offline', message: brokerMessage('bad_reply') };
    const expiresIn = r.expiresAt ? Math.max(60, Math.floor((r.expiresAt - this.now()) / 1000)) : 300;
    const tokens: Tokens = { access_token: r.value, refresh_token: this.refreshMarker(), expires_in: expiresIn };
    return { status: 'ok', tokens };
  }
}

/** The broker's error codes in words, for the sign-in screen. */
export function brokerMessage(code: string): string {
  switch (code) {
    case 'broker_unavailable':
      return 'The WorkSuite OS sign-in service is not running. Sign out of WorkSuite OS and sign in again, or restart the computer.';
    case 'broker_timeout':
    case 'sign_in_timeout':
      return 'Sign-in did not finish in time. Try again.';
    case 'locked':
      return 'WorkSuite OS is locked. Unlock the computer to continue.';
    case 'sign_in_required':
    case 'unknown_account':
    case 'no_refresh_token':
      return 'Your WorkSuite OS session has ended. Sign in again.';
    case 'insecure_url':
      return 'WorkSuite OS can sign in only to an https server.';
    case 'discovery_failed':
    case 'userinfo_failed':
      return 'The WorkSuite server could not be reached to sign in. Check the connection and try again.';
    case 'device_not_enrolled':
      return 'This computer is not enrolled with your organization yet. Ask your administrator to enrol it in WorkSuite OS Settings.';
    default:
      return 'WorkSuite OS could not sign you in. Try again.';
  }
}

// ── device enrolment ─────────────────────────────────────────────────────

export const OS_DEVICE_STATUS = '/run/worksuite-device-agent/status.json';
export const OS_DEVICE_TOKEN = '/run/worksuite-device-agent/device-token';

export interface OsDevice {
  /** The enrolled device's id (the agent's `device_id`). */
  id: string;
  /** The device credential the OS services send as `X-WS-Device`. Identifies the computer, not a person. */
  credential: string;
  /** `https://<host>/` of the organisation's server, when the agent says. */
  server: string | null;
  orgName: string | null;
}

type Read = (path: string) => string;
const readText: Read = (p) => readFileSync(p, 'utf8');

function readStatus(read: Read): Record<string, unknown> | null {
  try {
    const v = JSON.parse(read(OS_DEVICE_STATUS)) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The organisation's server the computer is enrolled with, or null (not enrolled, no agent). */
export function osDeviceServer(read: Read = readText): string | null {
  const st = readStatus(read);
  if (!st?.managed || typeof st.server !== 'string' || !/^[a-z0-9.-]+(:\d+)?$/i.test(st.server)) return null;
  return `https://${st.server}/`;
}

/** The OS enrolment, or null when the computer is not enrolled (or the agent has withdrawn the credential). */
export function readOsDevice(read: Read = readText): OsDevice | null {
  const st = readStatus(read);
  if (!st?.managed || st.wiped === true || typeof st.device_id !== 'string' || !st.device_id) return null;
  let credential = '';
  try {
    credential = read(OS_DEVICE_TOKEN).trim();
  } catch {
    return null;
  }
  if (!credential || credential.length > 4096 || /\s/.test(credential)) return null;
  return { id: st.device_id, credential, server: osDeviceServer(read), orgName: typeof st.org_name === 'string' ? st.org_name : null };
}

// ── the session ──────────────────────────────────────────────────────────

export interface OsSessionDeps {
  call: BrokerCall;
  deviceServer: () => string | null;
  /** The open account's server origin, or null. */
  currentOrigin: () => string | null;
  /** Makes `url` the open account's server (a new account on this computer if it is a new server). */
  setServer: (url: string) => Promise<void>;
  /** The broker as the open account's token endpoint. */
  useEndpoint: (ep: BrokerTokenEndpoint) => void;
  acceptTokens: (t: Tokens) => void;
  /** Someone signed in here before: resume as usual (refresh through the broker, the cached bootstrap offline). */
  hasPreviousUser: () => boolean;
  resume: () => Promise<void>;
  /** First time: who is signed in, from the server, then registration and bootstrap. */
  acceptSession: () => Promise<void>;
  setStage: (stage: 'browser' | 'bootstrapping' | 'signed-out', message?: string | null) => void;
}

/**
 * Opens the OS account in this app: broker account (signing in through the broker when none is), the account's
 * server, the broker as token endpoint, the first token, then the session. Any failure ends at the OS sign-in screen
 * with what went wrong — never at a password prompt.
 */
export async function startOsSession(d: OsSessionDeps): Promise<{ ok: boolean; error?: string }> {
  d.setStage('bootstrapping');
  const conn = await connectOsAccount(d.call, d.deviceServer(), () => d.setStage('browser'));
  if (!conn.ok) {
    d.setStage('signed-out', brokerMessage(conn.error));
    return { ok: false, error: conn.error };
  }
  const origin = new URL(conn.account.server_url).origin;
  try {
    if (d.currentOrigin() !== origin) await d.setServer(conn.account.server_url);
  } catch (e) {
    const msg = e instanceof Error && e.message ? e.message : 'The WorkSuite server could not be reached.';
    d.setStage('signed-out', msg);
    return { ok: false, error: 'server' };
  }
  const ep = new BrokerTokenEndpoint(d.call, conn.account.id);
  d.useEndpoint(ep);
  const first = await ep.token();
  if (first.status !== 'ok') {
    d.setStage('signed-out', first.message ?? brokerMessage(first.status));
    return { ok: false, error: first.status };
  }
  d.acceptTokens(first.tokens);
  try {
    if (d.hasPreviousUser()) await d.resume();
    else await d.acceptSession();
  } catch (e) {
    // The session controller has already said what happened on the sign-in screen.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true };
}
