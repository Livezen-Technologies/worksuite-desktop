import { app } from 'electron';
import type { AuthState, Bootstrap, DeviceTrust, ServerInfo } from '@shared/types';
import { DesktopError, isDesktopError, UNREACHABLE_MESSAGE } from './errors';
import { logger } from './log';
import type { AuthService, SignInPayload } from '../services/auth';
import { normalizeServerUrl, probeServer } from '../services/auth';
import type { BootstrapService } from '../services/bootstrap';
import type { Database } from '../services/db';
import type { DeviceService, Directive } from '../services/device';
import type { EnterpriseConfig } from '../services/enterprise';
import type { FetchLike } from '../services/http';
import { capabilitiesFor, type DeviceCapabilities } from '../services/policy';

const log = logger('session');

/**
 * The session lifecycle (WF-01, WF-02, WF-03, WF-23, WF-24):
 *
 *   no-server → signed-out → [mfa] → registering → bootstrapping → ready
 *
 * plus the ways out of `ready`: expired (refresh refused — re-login without
 * losing drafts), blocked (desktop access disabled / device limit), revoked
 * (remote revoke → local wipe).
 *
 * Nothing module-specific happens here; this decides who is signed in, on
 * which device, under which policy, and starts or stops the background
 * services accordingly.
 */

/** Desktop permissions a WorkSuite server without the desktop API implies (§10.1, Employee row). */
export const IMPLIED_DESKTOP_PERMISSIONS = [
  'desktop.access',
  'desktop.files.sync',
  'desktop.files.offline',
  'desktop.files.open_external',
  'desktop.downloads',
  'desktop.offline.write',
  'desktop.devices.view_own',
  'desktop.diagnostics.export',
];

export interface SessionHooks {
  started: (b: Bootstrap) => void;
  stopped: () => void;
  wiped: (userId: string, scope: 'tokens' | 'cache' | 'cache+offline_files', includeDrafts: boolean) => void;
  changed: (s: AuthState) => void;
  bootstrapChanged: (b: Bootstrap | null) => void;
  minimumVersion: (v: string | null) => void;
  /** An administrator requires an update (directive); the version may be unknown. */
  requireUpdate: (version: string | null, reason: string) => void;
  toast: (kind: 'info' | 'success' | 'warning' | 'error', text: string) => void;
  audit: (userId: string | null, action: string, details: Record<string, unknown>) => void;
}

export class SessionController {
  private state: AuthState = { stage: 'no-server', server: null, user: null, message: null, setupPending: false };
  private boot: Bootstrap | null = null;
  private orgScope: string | null = null;
  private pendingSignIn: SignInPayload | null = null;
  private revalidating = false;

  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly device: DeviceService,
    private readonly bootstrap: BootstrapService,
    private readonly rawFetch: FetchLike,
    private readonly enterprise: EnterpriseConfig,
    private readonly hooks: SessionHooks,
  ) {
    this.device.onDirective = (d) => this.handleDirective(d);
    this.device.onTrustChanged = (t) => this.onTrust(t);
  }

  get(): AuthState {
    return { ...this.state };
  }

  current(): Bootstrap | null {
    return this.boot;
  }

  userId(): string | null {
    return this.state.stage === 'ready' || this.state.stage === 'expired' ? (this.state.user?.id ?? null) : null;
  }

  isReady(): boolean {
    return this.state.stage === 'ready';
  }

  organizationScope(): string | null {
    return this.orgScope;
  }

  private set(patch: Partial<AuthState>): void {
    this.state = { ...this.state, ...patch };
    this.hooks.changed(this.get());
  }

  private allowInsecure(): boolean {
    return !app.isPackaged;
  }

  // ── start-up ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    let server = this.auth.getServer();
    const ent = this.enterprise;
    if (ent.server_url) {
      const origin = normalizeServerUrl(ent.server_url, this.allowInsecure());
      if (!server || server.origin !== origin) {
        // FR-AUTH-01: a preconfigured server replaces whatever was stored.
        server = { origin, name: new URL(origin).host, api: 'core', minimumVersion: null, locked: !!ent.disable_server_change };
        this.auth.setServer(server);
        void this.probeInBackground(origin);
      } else if (server.locked !== !!ent.disable_server_change) {
        server = { ...server, locked: !!ent.disable_server_change };
        this.auth.setServer(server);
      }
    }
    if (!server) {
      this.set({ stage: 'no-server', server: null });
      return;
    }
    this.set({ server });
    const last = this.bootstrap.lastUserId();
    if (last && this.auth.hasRefreshToken()) {
      await this.resume(last);
    } else {
      this.set({ stage: 'signed-out' });
    }
  }

  private async probeInBackground(origin: string): Promise<void> {
    try {
      const info = await probeServer(origin, this.rawFetch);
      const locked = this.auth.getServer()?.locked ?? false;
      this.auth.setServer({ ...info, locked });
      this.set({ server: { ...info, locked } });
    } catch {
      /* reachable later */
    }
  }

  private async resume(userId: string): Promise<void> {
    this.set({ stage: 'bootstrapping' });
    const r = await this.auth.refresh();
    if (r === 'ok') {
      await this.afterSignIn(null);
      return;
    }
    if (r === 'offline') {
      const cached = this.bootstrap.loadCached(userId);
      if (cached) {
        // WF-02: start offline from the cached bootstrap, read-only until revalidated.
        this.boot = cached;
        this.device.load(userId);
        this.set({ stage: 'ready', user: cached.user, message: null, setupPending: false });
        this.hooks.bootstrapChanged(cached);
        this.hooks.started(cached);
        return;
      }
      this.set({ stage: 'signed-out', message: UNREACHABLE_MESSAGE });
      return;
    }
    this.set({ stage: 'signed-out', message: 'Your session has ended. Sign in again.' });
  }

  // ── server and sign-in ─────────────────────────────────────────────────

  async setServer(input: string): Promise<AuthState> {
    if (this.state.server?.locked) throw new DesktopError('POLICY_DENIED', 'Your organization manages the server address.');
    const origin = normalizeServerUrl(input, this.allowInsecure());
    const info = await probeServer(origin, this.rawFetch);
    const server: ServerInfo = { ...info, locked: false };
    this.auth.setServer(server);
    this.set({ stage: 'signed-out', server, message: null });
    if (info.minimumVersion) this.hooks.minimumVersion(info.minimumVersion);
    return this.get();
  }

  forgetServer(): AuthState {
    if (this.state.server?.locked) throw new DesktopError('POLICY_DENIED', 'Your organization manages the server address.');
    this.auth.clearServer();
    this.set({ stage: 'no-server', server: null, message: null });
    return this.get();
  }

  async signIn(email: string, password: string): Promise<AuthState> {
    if (!this.state.server) throw new DesktopError('NOT_WORKSUITE', 'Choose a WorkSuite server first.');
    const outcome = await this.auth.signIn(email.trim(), password);
    if (outcome.kind === 'mfa') {
      this.set({ stage: 'mfa', message: null });
      return this.get();
    }
    await this.afterSignIn(outcome.payload);
    return this.get();
  }

  async verifyMfa(code: string): Promise<AuthState> {
    const payload = await this.auth.verifyMfa(code);
    await this.afterSignIn(payload);
    return this.get();
  }

  cancelMfa(): AuthState {
    this.auth.cancelChallenge();
    this.set({ stage: 'signed-out', message: null });
    return this.get();
  }

  private async afterSignIn(payload: SignInPayload | null): Promise<void> {
    this.pendingSignIn = payload;
    const api = this.state.server?.api ?? 'core';
    try {
      // FR-AUTH-03: the device registers before any module data is loaded.
      this.set({ stage: 'registering', message: null });
      const me = payload?.user ? String(payload.user.id) : this.bootstrap.lastUserId();
      if (!me) throw new DesktopError('SERVER_ERROR', 'The server did not identify the user.');
      await this.device.ensureRegistered(me, api);

      this.set({ stage: 'bootstrapping' });
      const b = await this.bootstrap.fetch(api, this.orgScope);
      if (b.policy.desktop_access === 'disabled') {
        throw new DesktopError('DESKTOP_ACCESS_DISABLED', 'Desktop access is disabled by your organization.');
      }
      if (b.policy.desktop_access === 'managed_only' && this.device.getTrust() !== 'TRUSTED') {
        throw new DesktopError('DESKTOP_ACCESS_DISABLED', 'Your organization allows WorkSuite Desktop only on managed computers.');
      }
      this.boot = b;
      this.bootstrap.setLastUser(b.user.id);
      if (!this.orgScope && b.defaultOrganizationId && b.organizations.length > 1) this.orgScope = null;
      const platformKey = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
      this.hooks.minimumVersion(b.minimumVersion ?? b.policy.minimum_version[platformKey] ?? null);
      const setupPending = !this.db.getConfig<boolean>(`setup-done:${b.user.id}`);
      this.set({ stage: 'ready', user: b.user, message: null, setupPending });
      this.hooks.bootstrapChanged(b);
      this.hooks.started(b);
      if (payload) this.hooks.audit(b.user.id, 'desktop.login', { method: payload.tokens ? 'password' : 'refresh' });
    } catch (e) {
      const err = isDesktopError(e) ? e : new DesktopError('INTERNAL', String((e as Error).message ?? e));
      log.warn('sign-in could not complete', { code: err.code });
      if (err.code === 'DEVICE_LIMIT' || err.code === 'DESKTOP_ACCESS_DISABLED') {
        await this.auth.signOut();
        this.set({ stage: 'blocked', message: err.message });
        throw err;
      }
      if (err.code === 'NETWORK_UNREACHABLE' && !payload) {
        const last = this.bootstrap.lastUserId();
        const cached = last ? this.bootstrap.loadCached(last) : null;
        if (cached) {
          this.boot = cached;
          this.set({ stage: 'ready', user: cached.user, message: null, setupPending: false });
          this.hooks.bootstrapChanged(cached);
          this.hooks.started(cached);
          return;
        }
      }
      this.auth.forget();
      this.set({ stage: 'signed-out', message: err.message });
      throw err;
    } finally {
      this.pendingSignIn = null;
    }
  }

  completeSetup(): AuthState {
    if (this.state.user) this.db.setConfig(`setup-done:${this.state.user.id}`, true);
    this.set({ setupPending: false });
    return this.get();
  }

  /** Revalidates an offline-started session once the server is reachable again. */
  async revalidate(): Promise<void> {
    if (this.revalidating || this.state.stage !== 'ready' || !this.boot?.offline) return;
    this.revalidating = true;
    try {
      const r = await this.auth.refresh();
      if (r === 'lost') {
        this.expired('Your session has ended. Sign in again to continue.');
        return;
      }
      if (r === 'ok') {
        const b = await this.bootstrap.fetch(this.state.server?.api ?? 'core', this.orgScope);
        this.boot = b;
        this.hooks.bootstrapChanged(b);
        void this.device.ensureRegistered(b.user.id, this.state.server?.api ?? 'core').catch(() => undefined);
      }
    } catch (e) {
      log.debug('revalidation failed', { error: String(e) });
    } finally {
      this.revalidating = false;
    }
  }

  async refreshBootstrap(): Promise<Bootstrap | null> {
    if (this.state.stage !== 'ready') return this.boot;
    const prev = this.boot;
    const b = await this.bootstrap.fetch(this.state.server?.api ?? 'core', this.orgScope);
    this.boot = b;
    this.hooks.bootstrapChanged(b);
    if (prev && prev.apps !== b.apps) log.info('app access changed on refresh');
    return b;
  }

  /** FR-AUTH-08: the refresh token was refused. Drafts and queued changes stay. */
  expired(message: string): void {
    if (this.state.stage !== 'ready') return;
    this.auth.forget();
    this.set({ stage: 'expired', message });
  }

  // ── organizations (WF-03) ──────────────────────────────────────────────

  async switchOrganization(orgId: string | null): Promise<string | null> {
    const b = this.boot;
    if (!b) throw new DesktopError('NOT_SIGNED_IN', 'Sign in first.');
    if (orgId !== null && !b.organizations.some((o) => o.id === orgId)) {
      throw new DesktopError('ORG_ACCESS_DENIED', 'You are not a member of that organization.');
    }
    const from = this.orgScope;
    this.orgScope = orgId;
    if (this.state.server?.api === 'desktop-v1' && !b.offline) {
      try {
        await this.refreshBootstrap();
      } catch (e) {
        this.orgScope = from;
        throw e;
      }
    }
    this.hooks.audit(b.user.id, 'desktop.organization.switch', { from, to: orgId });
    return orgId;
  }

  // ── permissions and policy ─────────────────────────────────────────────

  capabilities(): DeviceCapabilities {
    const b = this.boot;
    if (!b) return { offlineQueue: 'disabled', offlineCache: false, downloads: 'disabled' };
    return capabilitiesFor(this.device.getTrust(), b.policy);
  }

  hasPermission(key: string): boolean {
    const b = this.boot;
    if (key === 'desktop.diagnostics.export' && !b) return true;
    if (!b) return false;
    const granted =
      b.source === 'desktop-v1'
        ? b.permissions.includes('*') || b.permissions.includes(key)
        : IMPLIED_DESKTOP_PERMISSIONS.includes(key) || b.permissions.includes('*');
    if (!granted) return false;
    const caps = this.capabilities();
    switch (key) {
      case 'desktop.downloads':
        return caps.downloads !== 'disabled';
      case 'desktop.files.open_external':
        return b.policy.external_file_open !== 'disabled' && !(b.policy.external_file_open === 'managed_only' && this.device.getTrust() !== 'TRUSTED');
      case 'desktop.offline.write':
        return caps.offlineQueue === 'allowed';
      default:
        return true;
    }
  }

  private onTrust(t: DeviceTrust): void {
    log.info('device trust changed', { trust: t });
    if (this.boot) this.hooks.bootstrapChanged(this.boot);
  }

  // ── directives, revoke and wipe (WF-23, WF-24) ─────────────────────────

  handleDirective(d: Directive): void {
    switch (d.kind) {
      case 'none':
        if (this.boot && this.boot.policy.allow_offline !== d.allowOffline) {
          this.bootstrap.applyPolicyPatch({ allow_offline: d.allowOffline });
          this.boot = this.bootstrap.get();
          this.hooks.bootstrapChanged(this.boot);
        }
        return;
      case 'require-update':
        this.hooks.requireUpdate(d.version, d.reason);
        return;
      case 'block':
        void this.block(d.reason);
        return;
      case 'wipe':
        void this.wipe(d.reason);
        return;
    }
  }

  private async block(reason: string): Promise<void> {
    const uid = this.state.user?.id ?? null;
    this.hooks.stopped();
    this.auth.forget();
    this.boot = null;
    this.set({ stage: 'blocked', message: reason });
    this.hooks.audit(uid, 'desktop.device.blocked', { reason });
  }

  /** WF-24: stop services, clear credentials, remove restricted data. Unrelated files are never touched. */
  async wipe(reason: string): Promise<void> {
    const uid = this.state.user?.id ?? this.bootstrap.lastUserId();
    const scope = this.boot?.policy.wipe_on_revoke ?? 'cache+offline_files';
    log.warn('remote wipe', { scope });
    this.hooks.stopped();
    const deviceId = this.device.current()?.id ?? null;
    if (uid) {
      this.hooks.wiped(uid, scope, true);
      this.bootstrap.clear(uid);
      this.device.forget(uid);
    }
    this.auth.forget();
    this.bootstrap.setLastUser(null);
    this.boot = null;
    this.set({ stage: 'revoked', user: null, message: reason, setupPending: false });
    this.hooks.audit(uid, 'desktop.local_wipe', { scope, device_id: deviceId });
  }

  async signOut(wipe: boolean): Promise<AuthState> {
    const uid = this.state.user?.id ?? null;
    this.hooks.stopped();
    await this.auth.signOut();
    if (uid) {
      this.hooks.wiped(uid, wipe ? 'cache+offline_files' : 'cache', wipe);
      this.bootstrap.clear(uid);
      if (wipe) this.device.forget(uid);
      this.hooks.audit(uid, 'desktop.logout', { wipe });
    }
    this.bootstrap.setLastUser(null);
    this.boot = null;
    this.orgScope = null;
    this.set({ stage: this.state.server ? 'signed-out' : 'no-server', user: null, message: null, setupPending: false });
    return this.get();
  }

  pendingPayload(): SignInPayload | null {
    return this.pendingSignIn;
  }
}
