import { app } from 'electron';
import { visibleAppIds } from '@shared/access';
import type { AuthState, Bootstrap, DeviceClassification, DeviceTrust, ServerApi, ServerInfo } from '@shared/types';
import { DesktopError, isDesktopError, UNREACHABLE_MESSAGE } from './errors';
import { logger } from './log';
import type { AuthService, SignInPayload } from '../services/auth';
import { normalizeServerUrl, probeServer } from '../services/auth';
import type { BootstrapService } from '../services/bootstrap';
import type { Database } from '../services/db';
import type { CommandOutcome, DeviceCommand, DeviceService, Directive } from '../services/device';
import type { EnterpriseConfig } from '../services/enterprise';
import { isPassingFailure, type FetchLike } from '../services/http';
import { capabilitiesFor, type DeviceCapabilities } from '../services/policy';
import { isGateError } from '../services/sign-in-gate';

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

/** Why policy keeps Drive sync off this computer (§11.2 file_sync, personal_device_mode), or null. */
export function syncRefusal(policy: Bootstrap['policy'], trust: DeviceTrust, classification: DeviceClassification): string | null {
  if (policy.file_sync === 'disabled') return 'Your organization has turned Drive sync off.';
  if (trust === 'RESTRICTED' || trust === 'REVOKED') return 'Your organization has restricted this computer, so it does not sync.';
  if (policy.file_sync === 'managed_only' && trust !== 'TRUSTED') return 'Drive sync is allowed only on computers your organization manages.';
  if (classification === 'PERSONAL' && policy.personal_device_mode !== 'full') return 'Your organization keeps Drive files online only on personal computers.';
  return null;
}

export interface SessionHooks {
  started: (b: Bootstrap) => void;
  stopped: () => void;
  /**
   * `keepUnsynced`: a plain sign-out (Connection & Startup §5) — the offline queue, the outboxes, queued uploads and
   * Office copies with edits wait for the person to sign in again ("N pending changes kept"); only cached data goes.
   */
  wiped: (userId: string, scope: 'tokens' | 'cache' | 'cache+offline_files', includeDrafts: boolean, keepUnsynced?: boolean) => void;
  /** An administrator's DISABLE_SYNC: every synced folder on this computer stops. */
  syncDisabled: (reason: string) => void;
  changed: (s: AuthState) => void;
  bootstrapChanged: (b: Bootstrap | null) => void;
  minimumVersion: (v: string | null) => void;
  /** An administrator requires an update (directive); the version may be unknown. */
  requireUpdate: (version: string | null, reason: string) => void;
  toast: (kind: 'info' | 'success' | 'warning' | 'error', text: string) => void;
  audit: (userId: string | null, action: string, details: Record<string, unknown>) => void;
  /**
   * The session ended without a sign-out (expired). The app lock guards a signed-in session; from here the sign-in
   * screen is the way back in, and a lock left on refused every sign-in from it with "WorkSuite is locked." (LOGIN-001).
   */
  unlock?: () => void;
}

export class SessionController {
  private state: AuthState = { stage: 'no-server', server: null, user: null, message: null, setupPending: false };
  private boot: Bootstrap | null = null;
  private orgScope: string | null = null;
  private pendingSignIn: SignInPayload | null = null;
  private revalidating = false;
  /** The sign-in under way: a second submit (Enter and a click, a callback twice) joins it rather than signing in again. */
  private signingIn: Promise<AuthState> | null = null;
  /**
   * Which sign-in is the current one (LOGIN-001). Each attempt takes the next number, and so does everything that
   * ends a session: signing out, a wipe, a block, expiry. An attempt whose number has moved on stops where it is —
   * the stage and the tokens belong to whatever replaced it — and may neither carry on to `ready` nor, failing,
   * forget tokens that are no longer its own.
   */
  private attempt = 0;
  /** Who is signing in, before the session says so: a wipe or block that registration brings is about their computer. */
  private signingInUser: string | null = null;
  /** The pauses before a sign-in step is asked again after a passing failure (tests shorten them). */
  retryDelaysMs: number[] = [1_000, 3_000];
  /**
   * Whether IT's managed server (`enterprise.server_url`) is this account's (Connection & Startup §1.7): with
   * accounts side by side it replaces the stored server only in the managed account, never in another one.
   */
  managedServerApplies: () => boolean = () => true;

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
    this.device.onCommand = (c) => this.handleCommand(c);
  }

  /** Administrator commands queued for this device (§7.1 desktop_device_commands). */
  async handleCommand(c: DeviceCommand): Promise<CommandOutcome> {
    const reason = typeof c.payload.reason === 'string' ? c.payload.reason : null;
    switch (c.command) {
      case 'WIPE':
      case 'REVOKE': {
        const scope = this.boot?.policy.wipe_on_revoke ?? 'cache+offline_files';
        return { ok: true, result: { scope }, after: () => this.wipe(reason ?? 'Your administrator removed WorkSuite from this computer.') };
      }
      case 'SIGN_OUT':
        // Said on the sign-in screen: delivered by a sign-in's own heartbeat, it used to look like a sign-in that failed for nothing.
        return { ok: true, result: {}, after: async () => void (await this.signOut(false, reason ?? 'Your administrator signed you out of WorkSuite on this computer.')) };
      case 'REQUIRE_UPDATE':
        this.hooks.requireUpdate(typeof c.payload.version === 'string' ? c.payload.version : null, reason ?? 'An update is required.');
        return { ok: true, result: {} };
      case 'REFRESH_POLICY': {
        const b = await this.refreshBootstrap();
        return { ok: true, result: { policy_version: b?.policy.version ?? null } };
      }
      case 'DISABLE_SYNC':
        this.hooks.syncDisabled(reason ?? 'Your administrator turned Drive sync off for this computer.');
        return { ok: true, result: { sync: 'paused' } };
      default:
        return { ok: false, result: { error: `unsupported command ${c.command}` } };
    }
  }

  /** The open account as the renderer sees it (Connection & Startup), on every state; unset before accounts. */
  accountView: (() => AuthState['account']) | null = null;
  /** A Personal account's Cloud side (WP3), on every state. */
  cloudStatus: (() => AuthState['cloud']) | null = null;

  get(): AuthState {
    const out: AuthState = { ...this.state };
    if (this.accountView) out.account = this.accountView() ?? null;
    if (this.cloudStatus) {
      out.cloud = this.cloudStatus() ?? null;
      out.readOnly = out.cloud?.readOnly ?? null;
    }
    return out;
  }

  current(): Bootstrap | null {
    return this.boot;
  }

  private visible: { boot: Bootstrap | null; ids: Set<string> } = { boot: null, ids: new Set() };

  /**
   * The catalogue ids of the apps the person may open (shared/access.ts):
   * what the renderer shows as `app.apps`, for the main process's own
   * decisions — the browser, windows, the tray, the menu, notifications.
   * None without a bootstrap.
   */
  visibleApps(): Set<string> {
    if (this.visible.boot !== this.boot) this.visible = { boot: this.boot, ids: visibleAppIds(this.boot) };
    return this.visible.ids;
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

  private lastProbe = 0;

  private set(patch: Partial<AuthState>): void {
    const was = this.state.stage;
    this.state = { ...this.state, ...patch };
    this.hooks.changed(this.get());
    // Arriving at the sign-in screen — at start, after signing out, when a
    // session ends — is when what the server offers matters (passkey sign-in,
    // a minimum version). A description saved before the server offered
    // passkeys used to stay that way until the next start signed out.
    if (patch.stage === 'signed-out' && was !== 'signed-out' && this.state.server && Date.now() - this.lastProbe > 30_000) {
      this.lastProbe = Date.now();
      void this.probeInBackground(this.state.server.origin);
    }
  }

  private allowInsecure(): boolean {
    return !app.isPackaged;
  }

  // ── start-up ───────────────────────────────────────────────────────────

  /**
   * Start-up, and after an account switch. `cachedFirst` (a switch, Connection & Startup §1.3 step 7): `ready` at once
   * from the cached bootstrap when there is one, the token and the bootstrap refreshed behind it — a refresh first
   * is too slow for a two-second switch. Otherwise as before: refresh, then the bootstrap.
   */
  async init(opts: { cachedFirst?: boolean } = {}): Promise<void> {
    let server = this.auth.getServer();
    const ent = this.enterprise;
    if (ent.server_url && this.managedServerApplies()) {
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
    if (last && this.auth.hasRefreshToken() && opts.cachedFirst && this.fromCache(last)) {
      void this.revalidate();
    } else if (last && this.auth.hasRefreshToken()) {
      await this.resume(last);
    } else {
      // What the server offers can change between runs; set() re-reads it.
      this.set({ stage: 'signed-out' });
    }
  }

  private async probeInBackground(origin: string): Promise<void> {
    try {
      const info = await probeServer(origin, this.rawFetch);
      const had = this.auth.getServer();
      const locked = had?.locked ?? false;
      // What discovery said about the account (its id, link hosts, how it signs in) stays; the probe adds to it.
      const next: ServerInfo = had && had.origin === info.origin ? { ...had, ...info, locked } : { ...info, locked };
      this.auth.setServer(next);
      this.set({ server: next });
    } catch {
      /* reachable later */
    }
  }

  /** `ready` from the cached bootstrap (offline until revalidated); false when there is none. */
  private fromCache(userId: string): boolean {
    const cached = this.bootstrap.loadCached(userId);
    if (!cached) return false;
    this.boot = cached;
    this.device.load(userId);
    this.set({ stage: 'ready', user: cached.user, message: null, setupPending: false });
    this.hooks.bootstrapChanged(cached);
    this.hooks.started(cached);
    return true;
  }

  /**
   * Another account is being opened (Connection & Startup §1.3 step 4): this one's services stop, with nothing wiped
   * and no token revoked — it stays signed in, in the background. Whatever sign-in was under way is over.
   */
  suspend(): void {
    this.endAttempt();
    this.hooks.stopped();
    this.boot = null;
    this.orgScope = null;
    this.revalidating = false;
    this.state = { stage: 'no-server', server: null, user: null, message: null, setupPending: false };
    this.hooks.bootstrapChanged(null);
    this.hooks.changed(this.get());
  }

  /**
   * The account's version gates (screen 9), per account: the server needs a newer desktop, or the server is older
   * than this desktop supports. The other accounts keep working. Null clears it.
   */
  setCompat(kind: 'update-required' | 'server-too-old' | null, compat: AuthState['compat'] = null): AuthState {
    if (kind) this.set({ stage: kind, compat });
    else if (this.state.stage === 'update-required' || this.state.stage === 'server-too-old') this.set({ stage: this.state.server ? 'signed-out' : 'no-server', compat: null });
    return this.get();
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
    const had = this.auth.getServer();
    const server: ServerInfo = had && had.origin === info.origin ? { ...had, ...info, locked: false } : { ...info, locked: false };
    this.auth.setServer(server);
    this.lastProbe = Date.now();
    this.set({ stage: 'signed-out', server, message: null, gate: null, deviceCode: null });
    if (info.minimumVersion) this.hooks.minimumVersion(info.minimumVersion);
    return this.get();
  }

  forgetServer(): AuthState {
    if (this.state.server?.locked) throw new DesktopError('POLICY_DENIED', 'Your organization manages the server address.');
    this.auth.clearServer();
    this.set({ stage: 'no-server', server: null, message: null });
    return this.get();
  }

  /**
   * One sign-in at a time. A second one while the first is under way — Enter
   * and a click, a retry while a two-second server is still answering — gets
   * the first one's outcome. Each used to sign in on its own: two sessions,
   * two registrations racing, and whichever failed forgot the tokens the
   * other had just stored, so a right password could end at the sign-in
   * screen (LOGIN-001).
   */
  private once(run: () => Promise<AuthState>): Promise<AuthState> {
    if (this.signingIn) return this.signingIn;
    const flight = run().finally(() => {
      if (this.signingIn === flight) this.signingIn = null;
    });
    this.signingIn = flight;
    return flight;
  }

  /**
   * A CAPTCHA, a wait or a block the server answered with (worksuite-desktop#301): shown on the sign-in screen,
   * with whatever step was under way given up — not thrown, so the screen can draw it.
   */
  private gated(e: unknown): AuthState {
    if (!isGateError(e)) throw e;
    this.set({ stage: 'signed-out', gate: e.gate, deviceCode: null, mfaNewDevice: false, message: null });
    return this.get();
  }

  signIn(email: string, password: string): Promise<AuthState> {
    return this.once(async () => {
      if (!this.state.server) throw new DesktopError('NOT_WORKSUITE', 'Choose a WorkSuite server first.');
      let outcome;
      try {
        outcome = await this.auth.signIn(email.trim(), password);
      } catch (e) {
        if (isGateError(e)) return this.gated(e);
        // A wrong password after a CAPTCHA was asked for: the server says again whether one is still due.
        if (this.state.gate) this.set({ gate: null });
        throw e;
      }
      if (outcome.kind === 'mfa') {
        this.set({ stage: 'mfa', message: null, gate: null, deviceCode: null, mfaNewDevice: outcome.newDevice });
        return this.get();
      }
      if (outcome.kind === 'device-code') {
        this.set({ stage: 'device-code', message: null, gate: null, deviceCode: outcome.step, mfaNewDevice: false });
        return this.get();
      }
      this.set({ gate: null, deviceCode: null, mfaNewDevice: false });
      await this.afterSignIn(outcome.payload);
      return this.get();
    });
  }

  verifyMfa(code: string, remember = true): Promise<AuthState> {
    return this.once(async () => {
      let payload;
      try {
        payload = await this.auth.verifyMfa(code, remember);
      } catch (e) {
        if (isGateError(e)) return this.gated(e);
        // Too many codes, or the attempt expired: back to the password, saying why.
        if (this.state.stage === 'mfa' && !this.auth.hasPendingChallenge()) {
          this.set({ stage: 'signed-out', message: e instanceof Error ? e.message : null, mfaNewDevice: false });
          return this.get();
        }
        throw e;
      }
      this.set({ mfaNewDevice: false });
      await this.afterSignIn(payload);
      return this.get();
    });
  }

  cancelMfa(): AuthState {
    this.auth.cancelChallenge();
    this.set({ stage: 'signed-out', message: null, deviceCode: null, mfaNewDevice: false });
    return this.get();
  }

  /** A new computer's emailed code (worksuite-desktop#301). `remember`: keep this computer as verified. */
  verifyDevice(code: string, remember: boolean): Promise<AuthState> {
    return this.once(async () => {
      let payload;
      try {
        payload = await this.auth.verifyDevice(code, remember);
      } catch (e) {
        if (isGateError(e)) return this.gated(e);
        if (!this.auth.hasDeviceChallenge()) {
          // Expired or spent: a new sign-in sends a new code.
          this.set({ stage: 'signed-out', deviceCode: null, message: e instanceof Error ? e.message : null });
          return this.get();
        }
        this.set({ deviceCode: this.auth.deviceStep() });
        throw e;
      }
      this.set({ deviceCode: null });
      await this.afterSignIn(payload);
      return this.get();
    });
  }

  async resendDevice(): Promise<AuthState> {
    try {
      const step = await this.auth.resendDevice();
      this.set({ deviceCode: step });
    } catch (e) {
      if (!this.auth.hasDeviceChallenge()) {
        this.set({ stage: 'signed-out', deviceCode: null, message: e instanceof Error ? e.message : null });
        return this.get();
      }
      throw e;
    }
    return this.get();
  }

  /** The CAPTCHA was solved in its window: the next attempt carries it. */
  captchaSolved(token: string): AuthState {
    const gate = this.state.gate;
    this.auth.setCaptchaToken(token, gate?.email ?? null);
    if (gate?.kind === 'captcha') this.set({ gate: { ...gate, solved: true } });
    return this.get();
  }

  /** Back to the sign-in form from a wait or a block (the server still decides the next attempt). */
  clearGate(): AuthState {
    if (this.state.gate) this.set({ gate: null });
    return this.get();
  }

  /**
   * Passkey sign-in, started here and finished in the browser. Returns the
   * page to open; the stage waits until worksuite://auth/callback arrives
   * (`completePasskey`) or the person cancels.
   */
  startPasskey(deviceName: string): string {
    if (!this.state.server) throw new DesktopError('NOT_WORKSUITE', 'Choose a WorkSuite server first.');
    const url = this.auth.startPasskey(deviceName);
    this.set({ stage: 'passkey', message: null });
    return url;
  }

  cancelPasskey(): AuthState {
    this.auth.cancelPasskey();
    if (this.state.stage === 'passkey') this.set({ stage: 'signed-out', message: null });
    return this.get();
  }

  /**
   * A browser sign-in's and Cloud's own stages (Connection & Startup §3, WP3): `browser` while the browser is out,
   * `verify-email` / `provisioning` while Cloud gets the account ready, `bootstrapping` while tokens are exchanged,
   * `signed-out` when it ended without a sign-in. `ready` is reached through `acceptSession`, never set here.
   */
  setStage(stage: 'browser' | 'verify-email' | 'provisioning' | 'bootstrapping' | 'signed-out', message: string | null = null): AuthState {
    if (this.state.stage === 'ready') return this.get();
    this.set({ stage, message });
    return this.get();
  }

  /**
   * Tokens a browser sign-in brought (OIDC, Core's AppHandoff — Connection & Startup §3), already held by
   * AuthService (`acceptTokens`): the computer registers and the bootstrap loads, as after a password sign-in.
   */
  acceptSession(payload: SignInPayload): Promise<AuthState> {
    return this.once(async () => {
      this.set({ gate: null, deviceCode: null, mfaNewDevice: false, message: null });
      await this.afterSignIn(payload);
      return this.get();
    });
  }

  /** The browser sent the code back. Anything wrong returns to the sign-in screen, saying what. */
  async completePasskey(code: string, state: string): Promise<void> {
    try {
      await this.once(async () => {
        const payload = await this.auth.completePasskey(code, state);
        await this.afterSignIn(payload);
        return this.get();
      });
    } catch (e) {
      if (this.state.stage === 'passkey' || this.state.stage === 'signed-out') {
        this.set({ stage: 'signed-out', message: e instanceof Error ? e.message : 'Passkey sign-in did not finish. Try again.' });
      }
    }
  }

  private async afterSignIn(payload: SignInPayload | null): Promise<void> {
    const attempt = ++this.attempt;
    const current = () => attempt === this.attempt;
    this.pendingSignIn = payload;
    const api = this.state.server?.api ?? 'core';
    try {
      // FR-AUTH-03: the device registers before any module data is loaded.
      this.set({ stage: 'registering', message: null });
      const me = payload?.user ? String(payload.user.id) : this.bootstrap.lastUserId();
      if (!me) throw new DesktopError('SERVER_ERROR', 'The server did not identify the user.');
      this.signingInUser = me;
      await this.patiently(() => this.device.ensureRegistered(me, api), current);
      // Ended while registering — a wipe, block or sign-out the heartbeat brought, or a newer sign-in. That one has
      // said what happened; carrying on used to put "Loading your workspace…" over it, then fail without tokens.
      if (!current()) return;

      this.set({ stage: 'bootstrapping' });
      const b = await this.patiently(() => this.bootstrapFor(me, api), current);
      if (!current()) return;
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
      // Not this attempt's to end any more: the tokens and the stage are whatever replaced it.
      if (!current()) {
        log.info('a sign-in that was ended or replaced failed; left as it is', { code: err.code });
        return;
      }
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
      if (current()) {
        this.pendingSignIn = null;
        this.signingInUser = null;
      }
    }
  }

  /**
   * One step of signing in, asked again after a failure that is only passing
   * (`isPassingFailure`): a blip in the network, a slow or busy server's 5xx —
   * or its proxy's — a rate limit. Such a failure used to end the sign-in at
   * once, the new tokens forgotten and the person back at the sign-in screen
   * with a password that was right (LOGIN-001). What fails every time still
   * fails, and says why on the sign-in screen.
   */
  private async patiently<T>(step: () => Promise<T>, current: () => boolean): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await step();
      } catch (e) {
        const pause = this.retryDelaysMs[i];
        if (pause === undefined || !current() || !isPassingFailure(e)) throw e;
        log.info('sign-in step failed for now; asking again', { code: (e as DesktopError).code, status: (e as DesktopError).status, next: i + 2 });
        await new Promise((r) => setTimeout(r, pause));
        if (!current()) throw e;
      }
    }
  }

  /**
   * The bootstrap for a sign-in. DEVICE_NOT_REGISTERED means the server does
   * not know this computer (any more) — a registration kept because its
   * heartbeat could not be had just then, or one removed meanwhile — so the
   * computer registers again and asks once more, rather than ending a sign-in
   * whose password was right.
   */
  private async bootstrapFor(userId: string, api: ServerApi): Promise<Bootstrap> {
    try {
      return await this.bootstrap.fetch(api, this.orgScope);
    } catch (e) {
      if (!(isDesktopError(e) && e.code === 'DEVICE_NOT_REGISTERED')) throw e;
      log.info('the server does not know this computer; registering it again');
      await this.device.reenrol(userId, api);
      return this.bootstrap.fetch(api, this.orgScope);
    }
  }

  /** Whatever sign-in is under way is over: it stops at its next step and leaves the stage and tokens alone. */
  private endAttempt(): void {
    this.attempt++;
    this.pendingSignIn = null;
    this.signingInUser = null;
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
    this.endAttempt();
    this.auth.forget();
    this.set({ stage: 'expired', message });
    // After the stage: every window shows the sign-in panel before the lock lets go, so nothing behind it shows meanwhile.
    this.hooks.unlock?.();
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
      case 'desktop.files.sync':
        return syncRefusal(b.policy, this.device.getTrust(), this.device.getClassification()) === null;
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
    const uid = this.state.user?.id ?? this.signingInUser;
    this.endAttempt();
    this.hooks.stopped();
    this.auth.forget();
    this.boot = null;
    this.set({ stage: 'blocked', message: reason });
    this.hooks.audit(uid, 'desktop.device.blocked', { reason });
  }

  /** WF-24: stop services, clear credentials, remove restricted data. Unrelated files are never touched. */
  async wipe(reason: string): Promise<void> {
    // Signing in, the computer the server says was removed is the one registered for the person signing in. Without
    // their id the stale registration stayed, and every sign-in after it heartbeated it, was wiped and was back at the
    // sign-in screen (LOGIN-001); with it, it goes, and the next sign-in registers this computer anew (BACKEND.md).
    const uid = this.signingInUser ?? this.state.user?.id ?? this.bootstrap.lastUserId();
    const scope = this.boot?.policy.wipe_on_revoke ?? 'cache+offline_files';
    this.endAttempt();
    log.warn('remote wipe', { scope });
    this.hooks.stopped();
    const deviceId = this.device.current()?.id ?? null;
    if (uid) {
      this.hooks.wiped(uid, scope, true);
      this.bootstrap.clear(uid);
      this.device.forget(uid);
    }
    this.auth.forget();
    // A removed computer is not one anybody verified any more.
    this.auth.forgetDevices();
    this.bootstrap.setLastUser(null);
    this.boot = null;
    this.set({ stage: 'revoked', user: null, message: reason, setupPending: false });
    this.hooks.audit(uid, 'desktop.local_wipe', { scope, device_id: deviceId });
  }

  /**
   * `message` says why on the sign-in screen when it was not the person's own choice.
   *
   * What has not reached the server yet is never discarded silently (Connection & Startup §5): a plain sign-out keeps
   * the offline queue and the outboxes for the next sign-in. They go only with `wipe`, `discardUnsynced` (the person
   * chose so on the sign-out dialog), or the organization's `sign_out_wipe` policy.
   */
  async signOut(wipe: boolean, message: string | null = null, opts: { discardUnsynced?: boolean } = {}): Promise<AuthState> {
    const uid = this.state.user?.id ?? null;
    const policyWipe = (this.boot?.policy as { sign_out_wipe?: unknown } | undefined)?.sign_out_wipe === true;
    const keepUnsynced = !wipe && !opts.discardUnsynced && !policyWipe;
    this.endAttempt();
    this.hooks.stopped();
    await this.auth.signOut();
    if (uid) {
      this.hooks.wiped(uid, wipe ? 'cache+offline_files' : 'cache', wipe, keepUnsynced);
      this.bootstrap.clear(uid);
      if (wipe) this.device.forget(uid);
      this.hooks.audit(uid, 'desktop.logout', { wipe });
    }
    this.bootstrap.setLastUser(null);
    this.boot = null;
    this.orgScope = null;
    this.set({ stage: this.state.server ? 'signed-out' : 'no-server', user: null, message, setupPending: false });
    return this.get();
  }

  pendingPayload(): SignInPayload | null {
    return this.pendingSignIn;
  }
}
