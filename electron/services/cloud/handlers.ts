import { hostname } from 'node:os';
import type { AccountRecord, AccountView } from '@shared/accounts';
import { BROWSER_SIGNIN_TTL_MS, EMPTY_CLOUD_STATUS, type BrowserSignIn, type CloudMe, type CloudStatus, type QuotaLevel } from '@shared/cloud';
import { CLOUD_ORIGIN, DEFAULT_OIDC_CLIENT_ID, DISCOVERY_PATH, discoveryDocumentV1, isWorkSuiteV1, type DiscoveredServer } from '@shared/discovery';
import type { AuthStage } from '@shared/types';
import type { IpcRouter } from '../../ipc/router';
import { DesktopError, isDesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import type { LicenceSource } from '../bootstrap';
import type { HttpClient } from '../http';
import type { TokenEndpoint, Tokens } from '../auth-tokens';
import { BrowserSignInFlow, type TakenCallback } from './browser-signin';
import { CloudApi } from './cloud-api';
import { EntitlementStore, entitlementKeyring, type EntitlementKeyValue } from './entitlements';
import { buildAuthorize, exchangeCode, fetchMetadata, isAllowedEndpoint, listenLoopback, OIDC_CALLBACK, OidcTokenEndpoint, randomToken, s256, type LoopbackListener, type OidcMetadata, type PendingAuthorize } from './oidc';
import { ProvisioningFlow } from './provisioning';
import { QuotaWatcher } from './quota';

const log = logger('cloud');

/**
 * The browser sign-in and Cloud channels (`signin:*`, `cloud:*`). [WP3; registered by
 * electron/main/accounts-wiring.ts]
 *
 * - `signin:start` builds the OIDC authorize URL (oidc.ts) — or Core's AppHandoff page for an enterprise
 *   `browser_sign_in` — opens it, and answers the attempt (browser-signin.ts); `signin:changed` follows it.
 * - The callback (deep link or loopback) is exchanged for tokens, handed to `acceptTokens` (WP1 `AuthService`), then
 *   provisioning.ts takes the account from `/me` to ready.
 * - `cloud:*` read and act on the active Personal account; `cloud:changed` follows `CloudStatus`.
 */
export interface CloudDeps {
  /** Pushes an allow-listed event to the windows. */
  emit: {
    (channel: 'signin:changed', attempt: BrowserSignIn | null): void;
    (channel: 'cloud:changed', status: CloudStatus): void;
  };
  /** An account by id (any kind: an enterprise `browser_sign_in` uses the same flow). */
  account: (accountId: string) => AccountRecord | null;
  /** The active account, when it is a Personal one. */
  activePersonal: () => AccountRecord | null;
  /** The active account's HTTP client (tokens, `X-WS-Org`, error mapping). */
  http: () => HttpClient | null;
  /** Plain network for OneAuth (no credentials), in the account's network partition. */
  fetchFor: (accountId: string) => (url: string, init: RequestInit) => Promise<Response>;
  /** Signs the account in with tokens from the browser (WP1: AuthService.acceptTokens, then the session). */
  acceptTokens: (accountId: string, tokens: Tokens) => Promise<AccountView>;
  /** The bootstrap's licence hook (BootstrapService.setLicenceSource). */
  setLicenceSource: (source: LicenceSource | null) => void;
  openExternal: (url: string) => Promise<boolean>;
  copyText: (text: string) => void;
  /** `app.isDefaultProtocolClient('worksuite')`: the redirect is `worksuite://auth/oidc`, else loopback. */
  isDefaultProtocolClient: () => boolean;
  focused: () => boolean;
  now?: () => number;

  // ── Optional (WP3 additions; WP1 wires them, everything works without, more coarsely) ──
  /**
   * The account's discovered server (issuer, client id, `browser_sign_in`). Without it, `signin:start` reads the
   * server's discovery document again from the account's origin, in its partition.
   */
  server?: (accountId: string) => Pick<DiscoveredServer, 'oidc' | 'browserSignIn'> | null;
  /**
   * An enterprise browser sign-in's exchange answer — `/api/auth/login`'s payload `{user, tokens, …}` — for
   * `AuthService.accept()`. Without it, its `tokens` go to `acceptTokens`.
   */
  acceptLogin?: (accountId: string, payload: Record<string, unknown>) => Promise<AccountView>;
  /**
   * The stage the account's sign-in is at: `browser` while the browser is out, `signed-out` when that ended without
   * a sign-in, `verify-email` / `provisioning` / `ready` from Cloud's `/me`. WP1 puts it on `AuthState.stage`.
   */
  onStage?: (accountId: string, stage: AuthStage, status: CloudStatus | null) => void;
  /** Cloud says the account is ready (ACTIVE, or read-only): bootstrap the workspace (`SessionController.afterSignIn`). */
  activated?: (accountId: string, me: CloudMe) => Promise<void>;
  /** A browser sign-in ended in an error (refused, expired code, a bad id_token): shown on the welcome screen. */
  onSignInFailed?: (accountId: string, error: DesktopError) => void;
  /** The active account's own database, for the last valid entitlements (`entitlements:<org>`). */
  store?: () => EntitlementKeyValue | null;
  /** Unpackaged builds trust the test entitlement key too (the mock-cloud e2e). Default: packaged. */
  isPackaged?: boolean;
  /** Livezen entitlement keys rotated in through the Update Center (WP2 stores them). */
  rotatedEntitlementKeys?: () => Readonly<Record<string, string>>;
  /** Room again after QUOTA_EXCEEDED: `TransferManager.releaseQuota()`, `OfficeExternal.retryQuota()`. */
  onQuotaRoom?: () => void;
  /** Storage crossed 85 % (once per crossing): an OS notification or a toast. */
  onQuotaWarning?: (level: QuotaLevel, storage: { used: number; limit: number }) => void;
  /** WorkSuite Cloud's origin (WS_CLOUD_ORIGIN in unpackaged builds), for its web pages without an account. */
  cloudOrigin?: string;
  /** This computer's name, shown on Core's browser sign-in page. */
  deviceName?: () => string;
}

/** What WP1 uses from Cloud outside IPC. */
export interface CloudHandle {
  /** A `worksuite://auth/oidc` / `worksuite://auth/callback` link: whether a browser sign-in took it. */
  handleCallback: (url: string) => boolean;
  /** The active Personal account's Cloud side, for `AuthState.cloud`; null when none. */
  status: () => CloudStatus | null;
  /** Gateway `ORG_SUSPENDED` / `ORG_NOT_FOUND`: fetch /me again. */
  refetchMe: () => void;
  dispose: () => void;
  /** The active account changed, signed in or out: Cloud follows it (it also checks on every `cloud:*` call). */
  accountChanged: () => void;
  /** The organization for `X-WS-Org` on a Personal account (`/me`'s `active_organization_id`). */
  organizationId: () => string | null;
  /** An upload or a new version was refused with QUOTA_EXCEEDED: storage is full until Cloud says otherwise. */
  quotaExceeded: () => void;
  /** OneAuth's refresh / revoke for a Personal (or OIDC) account, for its `AuthService`; null when it has none. */
  tokenEndpoint: (accountId: string) => Promise<TokenEndpoint | null>;
}

interface ServerAuth {
  oidc: { issuer: string; clientId: string } | null;
  browserSignIn: { url: string; exchange: string; client: string } | null;
  recoveryUrl: string | null;
}

type Pending =
  | { kind: 'oidc'; accountId: string; state: string; meta: OidcMetadata; pending: PendingAuthorize; clientId: string; loop: LoopbackListener | null }
  | { kind: 'handoff'; accountId: string; state: string; verifier: string; exchange: string; client: string };

/** Where `cloud:openWeb` goes, under the account's (or Cloud's) web origin; `verify`/`forgot` under OneAuth. */
const WEB_PATHS = { storage: '/account/storage', upgrade: '/account/subscription', privacy: '/account/privacy', support: '/support' } as const;

/** Registers the sign-in and Cloud channels on `router`. */
export function registerCloudHandlers(router: IpcRouter, deps: CloudDeps): CloudHandle {
  const now = deps.now ?? Date.now;
  const api = new CloudApi(deps.http);
  const serverCache = new Map<string, ServerAuth>();
  let pending: Pending | null = null;
  let resendAt = 0;

  const flow = new BrowserSignInFlow({
    openExternal: deps.openExternal,
    copyText: deps.copyText,
    onChange: (a) => deps.emit('signin:changed', a),
    now,
  });

  // ── the active Personal account ──────────────────────────────────────

  let bound: { accountId: string; org: string | null } | null = null;
  let licenceSet = false;

  const status = (): CloudStatus | null => {
    if (!bound) return null;
    const s = provisioning.status();
    return { ...s, storage: quota.current(), entitlements: entitlements.status(bound.org) };
  };
  const emitStatus = () => {
    const s = status();
    if (s) deps.emit('cloud:changed', s);
  };

  const provisioning = new ProvisioningFlow({
    me: () => api.me(),
    status: () => api.provisioningStatus(),
    retry: () => api.retryProvisioning(),
    focused: deps.focused,
    now,
    onChange: (_cloud, stage) => {
      emitStatus();
      if (bound) deps.onStage?.(bound.accountId, stage, status());
    },
    onActive: async (me) => {
      const b = bound;
      if (!b) return;
      b.org = me.active_organization_id ?? b.org;
      quota.start();
      // The signed entitlements first, so the bootstrap that follows shows the plan's apps.
      if (b.org) await entitlements.refresh(b.org);
      emitStatus();
      await deps.activated?.(b.accountId, me);
    },
  });

  const quota = new QuotaWatcher({
    usage: () => api.storageUsage(),
    onChange: () => emitStatus(),
    warn: (level) => {
      const s = quota.current();
      if (s) deps.onQuotaWarning?.(level, { used: s.used, limit: s.limit });
    },
    onRoom: () => deps.onQuotaRoom?.(),
  });

  const entitlements = new EntitlementStore({
    fetch: (org) => api.entitlements(org),
    keys: () => entitlementKeyring(deps.isPackaged ?? true, deps.rotatedEntitlementKeys?.() ?? {}),
    store: () => deps.store?.() ?? null,
    onChange: () => emitStatus(),
    now,
  });

  const licence: LicenceSource = async () => (bound ? entitlements.licence(bound.org) : null);

  const unbind = () => {
    if (!bound) return;
    provisioning.stop();
    quota.stop();
    entitlements.stop();
    bound = null;
    if (licenceSet) {
      deps.setLicenceSource(null);
      licenceSet = false;
    }
  };

  const bind = (rec: AccountRecord) => {
    bound = { accountId: rec.id, org: rec.organizationId };
    deps.setLicenceSource(licence);
    licenceSet = true;
    provisioning.start();
  };

  /** Follows the active account: a signed-in Personal one is watched; anything else is not. */
  const ensureBound = () => {
    let rec: AccountRecord | null = null;
    try {
      rec = deps.activePersonal();
    } catch {
      rec = null;
    }
    const id = rec && rec.kind === 'personal' && rec.signInState === 'signed-in' ? rec.id : null;
    if ((bound?.accountId ?? null) === id) return;
    unbind();
    if (rec && id) bind(rec);
  };

  const needBound = () => {
    ensureBound();
    if (!bound) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to WorkSuite Cloud first.');
    return bound;
  };

  // ── the server's sign-in ─────────────────────────────────────────────

  const serverAuth = async (rec: AccountRecord): Promise<ServerAuth> => {
    const cached = serverCache.get(rec.id);
    if (cached) return cached;
    const known = deps.server?.(rec.id) ?? null;
    let out: ServerAuth | null = known ? { oidc: known.oidc, browserSignIn: known.browserSignIn, recoveryUrl: null } : null;
    if (out && (out.oidc || out.browserSignIn)) {
      serverCache.set(rec.id, out);
      return out;
    }
    try {
      const res = await deps.fetchFor(rec.id)(`${rec.serverOrigin}${DISCOVERY_PATH}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const doc = res.ok ? discoveryDocumentV1.safeParse(await res.json().catch(() => null)) : null;
      if (doc?.success && isWorkSuiteV1(doc.data)) {
        const a = doc.data.auth;
        const issuer = a.issuer ?? doc.data.endpoints.auth;
        out = {
          oidc: out?.oidc ?? (a.mode === 'oidc' || rec.kind === 'personal' ? { issuer, clientId: a.client_id ?? DEFAULT_OIDC_CLIENT_ID } : null),
          browserSignIn: out?.browserSignIn ?? a.browser_sign_in ?? null,
          recoveryUrl: a.recovery_url ?? null,
        };
      }
    } catch (e) {
      log.debug('discovery document not read for sign-in', { error: String((e as Error)?.message ?? e) });
      if (!out) throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach the server. Check your connection and try again.');
    }
    if (!out) out = { oidc: null, browserSignIn: null, recoveryUrl: null };
    serverCache.set(rec.id, out);
    return out;
  };

  const ended = (accountId: string, state: string) => (reason: 'cancelled' | 'expired' | 'replaced') => {
    if (pending?.state === state) {
      if (pending.kind === 'oidc') pending.loop?.close();
      pending = null;
    }
    if (reason !== 'replaced') deps.onStage?.(accountId, 'signed-out', null);
  };

  const startOidc = async (rec: AccountRecord, oidc: NonNullable<ServerAuth['oidc']>, input: { method: BrowserSignIn['method']; purpose: BrowserSignIn['purpose']; loginHint?: string }): Promise<BrowserSignIn> => {
    const meta = await fetchMetadata(oidc.issuer, deps.fetchFor(rec.id), now);
    let loop: LoopbackListener | null = null;
    let redirectUri = OIDC_CALLBACK;
    if (!deps.isDefaultProtocolClient()) {
      loop = await listenLoopback(now() + BROWSER_SIGNIN_TTL_MS, now);
      redirectUri = loop.redirectUri;
    }
    const auth = buildAuthorize(meta, { issuer: meta.issuer, clientId: oidc.clientId, redirectUri, purpose: input.purpose, method: input.method, loginHint: input.loginHint });
    const op: Pending = { kind: 'oidc', accountId: rec.id, state: auth.state, meta, pending: auth, clientId: oidc.clientId, loop };
    const attempt = flow.start({
      accountId: rec.id,
      host: new URL(meta.authorization_endpoint).host,
      url: auth.url,
      state: auth.state,
      purpose: input.purpose,
      method: input.method,
      callback: redirectUri,
      onEnd: ended(rec.id, auth.state),
    });
    pending = op;
    if (loop) void loop.result.then((url) => (url ? handleCallback(url) : undefined));
    return attempt;
  };

  const startHandoff = (rec: AccountRecord, bsi: NonNullable<ServerAuth['browserSignIn']>, input: { method: BrowserSignIn['method']; purpose: BrowserSignIn['purpose'] }): BrowserSignIn => {
    const page = new URL(bsi.url, rec.serverOrigin);
    const exchange = new URL(bsi.exchange, rec.apiOrigin || rec.serverOrigin);
    // The code and the verifier go only to the account's own server.
    const own = new Set([new URL(rec.serverOrigin).origin, new URL(rec.apiOrigin || rec.serverOrigin).origin]);
    if (!own.has(page.origin) || !own.has(exchange.origin) || !isAllowedEndpoint(page.toString())) throw new DesktopError('NOT_WORKSUITE', 'This server’s browser sign-in is not on its own address.');
    const verifier = randomToken(32);
    const state = randomToken(24);
    page.searchParams.set('challenge', s256(verifier));
    page.searchParams.set('state', state);
    page.searchParams.set('device', (deps.deviceName?.() ?? hostname()).slice(0, 80));
    const attempt = flow.start({
      accountId: rec.id,
      host: page.host,
      url: page.toString(),
      state,
      purpose: input.purpose,
      method: input.method,
      callback: 'worksuite://auth/callback',
      onEnd: ended(rec.id, state),
    });
    pending = { kind: 'handoff', accountId: rec.id, state, verifier, exchange: exchange.toString(), client: bsi.client || 'worksuite-desktop' };
    return attempt;
  };

  const failed = (accountId: string, e: unknown) => {
    const err = isDesktopError(e) ? e : new DesktopError('INTERNAL', String((e as Error)?.message ?? e));
    log.warn('browser sign-in did not finish', { code: err.code });
    deps.onSignInFailed?.(accountId, err);
    deps.onStage?.(accountId, 'signed-out', null);
  };

  const finish = async (op: Pending, taken: TakenCallback): Promise<void> => {
    const p = taken.params;
    const code = p.get('code');
    if (!code) {
      const why = p.get('error_description') ?? p.get('error') ?? 'The sign-in was not finished.';
      throw new DesktopError(p.get('error') === 'access_denied' ? 'CANCELLED' : 'INVALID_CREDENTIALS', why.slice(0, 300));
    }
    deps.onStage?.(op.accountId, 'bootstrapping', null);
    if (op.kind === 'oidc') {
      const tokens = await exchangeCode(op.meta, op.pending, code, op.clientId, deps.fetchFor(op.accountId), now);
      // The id_token was checked; it is never stored.
      const { id_token: _id, ...keep } = tokens;
      await deps.acceptTokens(op.accountId, keep);
      accountChanged();
      return;
    }
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(code)) throw new DesktopError('INVALID_CREDENTIALS', 'That sign-in link is not valid. Start again.');
    let res: Response;
    try {
      res = await deps.fetchFor(op.accountId)(op.exchange, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-WorkSuite-Client': 'desktop' },
        body: JSON.stringify({ client: op.client, code, code_verifier: op.verifier }),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach the server. Check your connection and try again.');
    }
    const json = (await res.json().catch(() => null)) as { message?: string; data?: Record<string, unknown> } | null;
    if (!res.ok) throw new DesktopError(res.status === 401 ? 'INVALID_CREDENTIALS' : res.status >= 500 ? 'SERVER_ERROR' : 'INVALID_CREDENTIALS', json?.message ?? `The server answered ${res.status}.`, res.status);
    const payload = (json?.data ?? json ?? {}) as Record<string, unknown>;
    const tokens = payload.tokens as Tokens | undefined;
    if (!tokens?.access_token || !tokens.refresh_token) throw new DesktopError('SERVER_ERROR', 'The server did not return a session.');
    if (deps.acceptLogin) await deps.acceptLogin(op.accountId, payload);
    else await deps.acceptTokens(op.accountId, { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: Number(tokens.expires_in) || 3600 });
    accountChanged();
  };

  function handleCallback(url: string): boolean {
    const taken = flow.take(url);
    if (!taken) return false;
    const op = pending;
    pending = null;
    if (!op || op.accountId !== taken.accountId) {
      failed(taken.accountId, new DesktopError('INVALID_CREDENTIALS', 'That sign-in is no longer waiting. Start again.'));
      return true;
    }
    if (op.kind === 'oidc') op.loop?.close();
    void finish(op, taken).catch((e) => failed(op.accountId, e));
    return true;
  }

  function accountChanged(): void {
    ensureBound();
    emitStatus();
  }

  // ── web pages ────────────────────────────────────────────────────────

  const webUrl = async (page: 'storage' | 'upgrade' | 'privacy' | 'support' | 'verify' | 'forgot'): Promise<string> => {
    const rec = deps.activePersonal();
    const base = rec?.serverOrigin ?? deps.cloudOrigin ?? CLOUD_ORIGIN;
    if (page !== 'verify' && page !== 'forgot') return `${base}${WEB_PATHS[page]}`;
    const auth = rec ? await serverAuth(rec).catch(() => null) : null;
    if (page === 'forgot' && auth?.recoveryUrl) return auth.recoveryUrl;
    const issuer = auth?.oidc?.issuer?.replace(/\/+$/, '') ?? base;
    return `${issuer}${page === 'verify' ? '/verify-email' : '/forgot-password'}`;
  };

  // ── IPC ──────────────────────────────────────────────────────────────

  router.handle('signin:start', async ({ accountId, method, purpose, loginHint }) => {
    const rec = deps.account(accountId);
    if (!rec) throw new DesktopError('NOT_FOUND', 'That account is no longer on this computer.');
    const auth = await serverAuth(rec);
    let attempt: BrowserSignIn;
    if (auth.oidc && (rec.kind === 'personal' || !auth.browserSignIn)) attempt = await startOidc(rec, auth.oidc, { method, purpose, loginHint });
    else if (auth.browserSignIn) attempt = startHandoff(rec, auth.browserSignIn, { method, purpose });
    else throw new DesktopError('UNSUPPORTED', 'This server does not offer signing in through the browser.');
    deps.onStage?.(accountId, 'browser', null);
    return attempt;
  });
  router.handle('signin:reopen', ({ attemptId }) => flow.reopen(attemptId));
  router.handle('signin:copyLink', ({ attemptId }) => flow.copyLink(attemptId));
  router.handle('signin:cancel', ({ attemptId }) => flow.cancel(attemptId));

  router.handle('cloud:status', () => {
    ensureBound();
    return status() ?? { ...EMPTY_CLOUD_STATUS };
  });
  router.handle('cloud:refresh', async () => {
    const b = needBound();
    await provisioning.refetch();
    await quota.refresh();
    if (b.org) await entitlements.refresh(b.org);
    emitStatus();
    return status() ?? { ...EMPTY_CLOUD_STATUS };
  });
  router.handle('cloud:resendVerification', async () => {
    needBound();
    if (now() < resendAt) return { nextAt: resendAt };
    await deps.openExternal(await webUrl('verify'));
    resendAt = now() + 60_000;
    return { nextAt: resendAt };
  });
  router.handle('cloud:retryProvisioning', () => {
    needBound();
    return provisioning.retryNow();
  });
  router.handle('cloud:storage', async () => {
    needBound();
    const u = await api.storageUsage();
    quota.take(u);
    return u;
  });
  router.handle('cloud:plans', () => {
    needBound();
    return api.plans();
  });
  router.handle('cloud:openWeb', async ({ page }) => {
    const url = await webUrl(page);
    if (!isAllowedEndpoint(url)) return false;
    return deps.openExternal(url);
  });

  return {
    handleCallback,
    status: () => {
      ensureBound();
      return status();
    },
    refetchMe: () => void provisioning.refetch(),
    dispose: () => {
      flow.cancelAll();
      unbind();
    },
    accountChanged,
    organizationId: () => bound?.org ?? provisioning.me()?.active_organization_id ?? null,
    quotaExceeded: () => {
      ensureBound();
      if (!bound) return;
      quota.exceeded();
      emitStatus();
    },
    tokenEndpoint: async (accountId) => {
      const rec = deps.account(accountId);
      if (!rec) return null;
      const auth = await serverAuth(rec);
      if (!auth.oidc) return null;
      const meta = await fetchMetadata(auth.oidc.issuer, deps.fetchFor(accountId), now);
      return new OidcTokenEndpoint(meta, auth.oidc.clientId, deps.fetchFor(accountId));
    },
  };
}
