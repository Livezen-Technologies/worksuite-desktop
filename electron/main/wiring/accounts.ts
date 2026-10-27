import { registerAppProtocol } from '../../protocols/app-protocol';
import { hardenSession } from '../../security/hardening';
import { BackgroundAccounts, type BackgroundClient } from '../../services/accounts/background';
import { AccountsService, serverInfoOf } from '../../services/accounts/handlers';
import { DEFAULT_PROFILE_DIR, allPartitions, partitionDir, partitionsFor, profilePaths } from '../../services/accounts/profile';
import type { AccountRegistry } from '../../services/accounts/registry';
import { queueRemoval, removeAccount, unqueueRemoval } from '../../services/accounts/removal';
import { ShellSessions, type ScopeHolder } from '../../services/accounts/scope';
import { AccountSwitcher, switchModeFrom } from '../../services/accounts/switcher';
import { exportUnsyncedZip, pendingCount, unsyncedSummary } from '../../services/accounts/unsynced';
import type { AuditService } from '../../services/audit';
import { AuthService, normalizeServerUrl, probeServer, type PublicUser, type SignInPayload } from '../../services/auth';
import type { TokenEndpoint } from '../../services/auth-tokens';
import type { BootstrapService } from '../../services/bootstrap';
import { Database } from '../../services/db';
import { platformName, type DeviceService } from '../../services/device';
import { netFetchWithRedirects } from '../../services/discovery/handlers';
import type { HealthMonitor } from '../../services/discovery/health';
import { installPinning, type PinsFor } from '../../services/discovery/pinning';
import { runDiscovery } from '../../services/discovery/pipeline';
import { CLIENT_TYPE, CLIENT_TYPE_HEADER, HttpClient, type FetchLike, withSafeHeaders } from '../../services/http';
import type { LockService } from '../../services/lock';
import type { MailBodies } from '../../services/mail-bodies';
import { rebuildIfAsked } from '../../services/mail-repair';
import { createNetFetch } from '../../services/net-fetch';
import type { OfficeExternal } from '../../services/office-external';
import type { OfflineQueue } from '../../services/offline-queue';
import { osDeviceServer, startOsSession, type BrokerTokenEndpoint } from '../../services/os-mode';
import type { RealtimeService } from '../../services/realtime';
import type { ScreenShare } from '../../services/screen-share';
import { SecureStore } from '../../services/secure-store';
import type { SettingsService } from '../../services/settings';
import type { DriveSync } from '../../services/sync/engine';
import type { TransferManager } from '../../services/transfers';
import { Vault } from '../../services/vault';
import { setDiscoveryKeysSink, setEntitlementKeysSink } from '../../updater/update-center';
import type { UpdaterService } from '../../updater/updater';
import type { WindowManager } from '../../windows/manager';
import { cloudOrigin, emitAccounts, installAccounts, seedServerConfig, type AccountsWiring } from '../accounts-wiring';
import { writeBootConfig } from '../boot';
import { DesktopError } from '../errors';
import { broadcast } from '../events';
import type { SessionController } from '../session';
import type { AccountRecord, ServiceHealthState } from '@shared/accounts';
import type { TrustedConfig } from '@shared/trusted-config';
import type { AuthState, UpdateActivity } from '@shared/types';
import { app, dialog, net as electronNet, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AccountPartitions } from '../../services/accounts/profile';
import type { AppContext } from '../context';
import type { BrokerCall } from '../../services/os-mode';
import type { IpcRouter } from '../../ipc/router';
import type { Paths } from '../paths';
import type { ProfilePaths } from '../../services/accounts/profile';
import type { Projects } from '../../services/projects/index';
import type { WebchatRinger } from '../../services/webchat-ring';

/**
 * Accounts side by side (Connection & Startup §1, WP1): the accounts service, background accounts, the token endpoint
 * each account uses, the session following the open account, and WorkSuite OS sign-in. Moved out of the composition
 * root (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wireAccounts reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireAccountsDeps {
  accountsWiring: AccountsWiring | null;
  readonly allowInsecure: boolean;
  readonly apiHook: (details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void) => void;
  readonly apiProxy: (request: Request, apiPath: string) => Promise<Response>;
  apiReachable: boolean;
  readonly appDb: Database;
  readonly audit: AuditService;
  readonly auth: AuthService;
  readonly bindNetwork: (partitions: { net: string; bulk: string; }) => void;
  readonly bootstrap: BootstrapService;
  readonly brokerCall: BrokerCall;
  readonly cspSources: () => { server: string | null; media: string[]; };
  readonly ctx: AppContext;
  readonly db: Database;
  dbKey: string;
  readonly defaultProfile: ProfilePaths;
  readonly device: DeviceService;
  readonly emitStatus: () => void;
  readonly fetchImpl: FetchLike;
  readonly firstPartitions: AccountPartitions;
  health: HealthMonitor;
  readonly healthDeps: { healthUrl: () => string | null; fetch: (url: string, init: RequestInit) => Promise<Response>; internetOnline: () => boolean; onChange: (state: ServiceHealthState) => void; componentUrls: () => { auth: string | null; realtime: string | null; files: string | null; office: string | null; }; };
  healthFromDiscovery: boolean;
  readonly http: HttpClient;
  readonly localHandler: (request: Request, path: string) => Promise<Response>;
  readonly lock: LockService;
  readonly log: { debug: (msg: string, data?: unknown) => void; info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void; error: (msg: string, data?: unknown) => void; };
  readonly mailBodies: MailBodies;
  readonly officeLocal: OfficeExternal;
  readonly OS_MODE: boolean;
  osEndpoint: BrokerTokenEndpoint | null;
  readonly p: Paths;
  readonly prepareWaits: Map<string, () => void>;
  readonly projects: Projects;
  readonly proxyConfig: { pacScript: string; proxyRules?: undefined; proxyBypassRules?: undefined; } | { proxyRules: string; proxyBypassRules: string; pacScript?: undefined; } | null;
  readonly queue: OfflineQueue;
  readonly realtime: RealtimeService;
  readonly rebuildMenu: (visible: Set<string>) => void;
  readonly registry: AccountRegistry;
  readonly relaunch: (safe: boolean, extraArgs?: string[]) => void;
  readonly router: IpcRouter;
  readonly scopes: ScopeHolder;
  readonly screenShare: ScreenShare;
  readonly secrets: SecureStore;
  readonly sessionCtl: SessionController;
  readonly settings: SettingsService;
  readonly sync: DriveSync;
  readonly syncLiveKeys: () => void;
  readonly syncQuickAsk: () => void;
  readonly transfers: TransferManager;
  readonly trustedNow: () => TrustedConfig;
  readonly updateActivity: () => UpdateActivity;
  readonly updater: UpdaterService;
  vault: Vault;
  readonly vaultKey: () => string;
  readonly webchat: WebchatRinger;
  readonly windows: WindowManager;
}

export function wireAccounts(root: WireAccountsDeps) {
  // ── accounts side by side (Connection & Startup §1, WP1) ───────────────
  /*
   * installShellSession: everything every partition gets, once — hardening and the permission handler, app://, the
   * __api hook, screen sharing, the proxy, and certificate pinning (WP2). `shellSessions.ensure` is the only way a
   * partition is used (risk 2): the open account's three, the default session (guest mode), connect runs, background
   * pollers.
   */
  let pinsFor: PinsFor = () => null;
  const installShellSession = (ses: Electron.Session): void => {
    hardenSession(ses);
    registerAppProtocol(root.apiProxy, root.cspSources, root.localHandler, ses);
    ses.webRequest.onBeforeRequest({ urls: ['app://bundle/__api/*', 'app://bundle/__local/*'] }, root.apiHook);
    root.screenShare.install(ses);
    if (root.proxyConfig) void ses.setProxy(root.proxyConfig);
    installPinning(ses, (host) => pinsFor(host));
  };
  const shellSessions = new ShellSessions<Electron.Session>((partition) => (partition === '' ? session.defaultSession : session.fromPartition(partition)), (ses) => installShellSession(ses));
  shellSessions.ensure('');
  shellSessions.ensureAll(root.firstPartitions);
  const CONNECT_PARTITION = 'persist:ws-connect';
  // Livezen discovery keys rotated in through a verified Update Center answer (WP2), kept in app.db.
  const rotatedKeys = (): Readonly<Record<string, string>> => root.appDb.getConfig<Record<string, string>>('discovery_keys') ?? {};
  setDiscoveryKeysSink((keys) => root.appDb.setConfig('discovery_keys', { ...rotatedKeys(), ...keys }));
  // The same for Cloud's entitlement keys (Connection & Startup §3), read back by `rotatedEntitlementKeys` below.
  const rotatedEntitlementKeys = (): Readonly<Record<string, string>> => root.appDb.getConfig<Record<string, string>>('entitlement_keys') ?? {};
  setEntitlementKeysSink((keys) => root.appDb.setConfig('entitlement_keys', { ...rotatedEntitlementKeys(), ...keys }));

  /**
   * Who refreshes and revokes an account's tokens: OneAuth for a Personal (Cloud) account (WP3's OIDC endpoint),
   * WorkSuite's own `/api/auth/refresh` (null) otherwise. Asked before the session starts, never inside a switch's
   * bind budget (it may read the issuer's metadata).
   */
  const tokenEndpointFor = async (account: AccountRecord | null): Promise<TokenEndpoint | null> => {
    if (root.OS_MODE) return root.osEndpoint;
    if (!account || (account.kind !== 'personal' && account.deployment !== 'CLOUD')) return null;
    return (await root.accountsWiring?.cloud.tokenEndpoint(account.id).catch(() => null)) ?? null;
  };
  const useTokenEndpointFor = async (account: AccountRecord | null): Promise<void> => {
    const ep = await tokenEndpointFor(account);
    if (root.scopes.current()?.id === account?.id) root.auth.setTokenEndpoint(ep);
  };
  root.auth.rebind(null);
  root.sessionCtl.managedServerApplies = () => {
    const a = root.registry.active();
    return !a || a.managed;
  };

  /** The open account's database, secrets, vault, token holder, settings scope and partitions (§1.3 step 6). */
  const bindAccount = (account: AccountRecord): void => {
    const scope = root.scopes.bind(account);
    mkdirSync(scope.paths.dir, { recursive: true, mode: 0o700 });
    if (root.db.path !== scope.paths.database) rebuildIfAsked(scope.paths.database, (msg, data) => root.log.warn(msg, data));
    root.db.swap(scope.paths.database);
    seedServerConfig(root.db, account);
    root.secrets.rebind(scope.paths.secrets);
    root.dbKey = root.vaultKey();
    root.vault = new Vault(Buffer.from(root.dbKey, 'base64'));
    root.auth.rebind(null);
    root.device.rebind();
    root.settings.setUserLanguageScope(null, null);
    shellSessions.ensureAll(scope.partitions);
    root.bindNetwork(scope.partitions);
    root.windows.partition = scope.partitions.shell;
    root.updater.setMinimum(null);
    root.apiReachable = true;
    root.emitStatus();
  };

  const background = new BackgroundAccounts({
    account: (id) => root.registry.get(id),
    client: (account) => backgroundClient(account),
    lastRefresh: (id) => root.appDb.getConfig<number>(`bg_refresh:${id}`) ?? null,
    setLastRefresh: (id, at) => root.appDb.setConfig(`bg_refresh:${id}`, at),
    onUnread: () => {
      accountsService.emit();
      root.emitStatus();
    },
    onSignedOut: (id) => {
      root.registry.update(id, { signInState: 'expired' });
      accountsService.emit();
    },
  });
  /** A background account's own token holder and client (§1.4): its secrets, its server, its partition. */
  function backgroundClient(account: AccountRecord): BackgroundClient {
    const paths = profilePaths(root.p.userData, account.profileDir);
    const store = new SecureStore(paths.secrets);
    store.init();
    const ses = shellSessions.ensure(partitionsFor(account).net);
    const nf = createNetFetch((o) => electronNet.request(o), ses);
    const f: FetchLike = withSafeHeaders((url, init) => nf(url, init as RequestInit));
    const server = serverInfoOf(account);
    const config = { getConfig: <T>(key: string) => (key === 'server' ? (server as T) : undefined), setConfig: () => undefined, deleteConfig: () => undefined } as unknown as Database;
    const holder = new AuthService(config, store, f, () => ({ [CLIENT_TYPE_HEADER]: CLIENT_TYPE }));
    holder.rebind(null);
    let endpointAsked = false;
    const client = new HttpClient({
      fetch: f,
      origin: () => server.origin,
      tokens: { accessToken: () => holder.accessToken(), refresh: () => holder.refresh() },
      clientHeaders: () => ({ ...(account.kind === 'personal' && account.organizationId ? { 'X-WS-Org': account.organizationId } : {}) }),
      onReachability: () => undefined,
      onAuthLost: () => undefined,
    });
    const refresh = async (): Promise<'ok' | 'offline' | 'lost'> => {
      if (!endpointAsked) {
        endpointAsked = true;
        holder.setTokenEndpoint(await tokenEndpointFor(account));
      }
      return holder.refresh();
    };
    return { refresh, get: (path) => client.get(path), dispose: () => holder.rebind(null) };
  }

  /** The session's sign-in state, on the open account's record (the switcher's "Signed out", the chooser). */
  function accountFollowsSession(s: AuthState): void {
    const id = root.registry.activeId();
    const a = id ? root.registry.get(id) : null;
    if (!a) return;
    const signInState = s.stage === 'ready' ? 'signed-in' : s.stage === 'expired' ? 'expired' : s.stage === 'revoked' ? 'revoked' : s.stage === 'no-server' ? a.signInState : 'signed-out';
    const user = s.user ? { id: String(s.user.id), name: s.user.name, email: s.user.email, avatar: s.user.avatar ?? null } : a.user;
    const organizationId = a.kind === 'personal' ? a.organizationId : (s.user?.organizationId ?? a.organizationId);
    const organizationName = s.user?.organizationName ?? a.organizationName;
    if (signInState === a.signInState && JSON.stringify(user) === JSON.stringify(a.user) && organizationId === a.organizationId && organizationName === a.organizationName) return;
    const next = root.registry.update(a.id, { signInState, user, organizationId, organizationName });
    if (next) root.scopes.refresh(next);
    // Cloud follows the open account signing in or out (WP3).
    if (signInState !== a.signInState) root.accountsWiring?.cloud.accountChanged();
    accountsService?.emit();
  }

  /** The update / draft-saving handshake, capped (§1.3 step 3). */
  const prepareCapped = async (capMs: number): Promise<void> => {
    const token = Math.random().toString(36).slice(2, 12);
    const answered = new Promise<void>((resolve) => root.prepareWaits.set(token, resolve));
    broadcast('update:prepare', { token });
    await Promise.race([answered, new Promise((r) => setTimeout(r, capMs))]);
    root.prepareWaits.delete(token);
  };

  const switcher = new AccountSwitcher<ReturnType<WindowManager['prepareMain']>>({
    account: (id) => root.registry.get(id),
    activeId: () => root.registry.activeId(),
    setActive: (id) => root.registry.setActive(id),
    guard: () => {
      if (root.lock.isLocked()) return { code: 'APP_LOCKED', reason: 'Unlock WorkSuite first.' };
      const a = root.updateActivity();
      const until = a.meeting ? 'the meeting ends' : a.call ? 'the call ends' : a.screenShare ? 'screen sharing stops' : a.remoteControl ? 'remote control stops' : null;
      return until ? { code: 'SWITCH_BLOCKED', reason: `Another account can open once ${until}.` } : null;
    },
    switching: () => accountsService.emit(),
    prepare: (cap) => prepareCapped(cap),
    createWindow: (account) => {
      const shell = partitionsFor(account).shell;
      if (shell === root.windows.partition && root.windows.getMain()) return null;
      shellSessions.ensure(shell);
      return root.windows.prepareMain(shell);
    },
    suspend: () => {
      const was = root.registry.active();
      if (was) {
        try {
          accountsService.rememberPending(was.id, pendingCount(activeUnsynced(was)));
        } catch {
          /* the count is a convenience */
        }
      }
      root.sessionCtl.suspend();
      root.scopes.release();
      root.transfers.stopAll();
      root.windows.closeAllButMain();
    },
    background,
    bind: (account) => bindAccount(account),
    init: async () => {
      const open = root.registry.active();
      await useTokenEndpointFor(open);
      root.accountsWiring?.cloud.accountChanged();
      await root.sessionCtl.init({ cachedFirst: true });
    },
    show: (handle) => handle.commit(),
    discard: (handle) => handle.discard(),
    relaunch: (id) => root.relaunch(false, [`--account=${id}`]),
    mode: () => switchModeFrom(process.env),
    timing: (ms, how, failed) => root.log.info('accounts.switch', { ms, how, failed }),
  });

  /** An account not open now signs out: its refresh token revoked at its server and removed from its secrets. */
  async function signOutOther(account: AccountRecord): Promise<void> {
    const store = new SecureStore(profilePaths(root.p.userData, account.profileDir).secrets);
    store.init();
    const token = store.get('auth:refresh');
    if (!token) return;
    const endpoint = await tokenEndpointFor(account);
    if (endpoint) await endpoint.revoke(token).catch(() => undefined);
    else {
      await fetchFor(account.id)(`${account.apiOrigin}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', [CLIENT_TYPE_HEADER]: CLIENT_TYPE },
        body: JSON.stringify({ refresh_token: token }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
    store.delete('auth:refresh');
  }

  /** The open account's unsynced summary, live from the bound database. */
  const activeUnsynced = (account: AccountRecord) => unsyncedSummary({ db: root.db, vault: root.vault, accountId: account.id, userId: root.sessionCtl.userId() ?? account.user?.id ?? null, officeCopies: root.sessionCtl.isReady() ? () => root.officeLocal.list() : undefined });
  /** Another account's, from its own database (opened for the read, closed after). */
  const otherUnsynced = (account: AccountRecord) => {
    const paths = profilePaths(root.p.userData, account.profileDir);
    if (!existsSync(paths.database)) return { accountId: account.id, items: [], offlineFiles: { count: 0, bytes: 0 }, cachedBytes: 0 };
    const other = new Database(paths.database);
    try {
      const store = new SecureStore(paths.secrets);
      store.init();
      const key = store.get('db-key');
      return unsyncedSummary({ db: other, vault: key ? new Vault(Buffer.from(key, 'base64')) : null, accountId: account.id, userId: account.user?.id ?? null });
    } finally {
      other.close();
    }
  };

  const accountsService: AccountsService = new AccountsService({
    registry: root.registry,
    switcher: switcher as unknown as AccountSwitcher<unknown>,
    background,
    trusted: root.trustedNow,
    session: {
      get: () => root.sessionCtl.get(),
      signOut: (wipe, message, opts) => root.sessionCtl.signOut(wipe, message, opts),
      setServer: (input) => root.sessionCtl.setServer(input),
      forgetServer: () => root.sessionCtl.forgetServer(),
    },
    unsynced: (account) => (account.id === root.registry.activeId() ? activeUnsynced(account) : otherUnsynced(account)),
    syncNow: async () => {
      const uid = root.sessionCtl.userId();
      if (!uid) return;
      await root.queue.replay(uid);
      void root.projects.reconnected();
      root.sync.kick('sync-now');
      root.transfers.setOnline(true);
      // Uploads that stopped (failed or paused) go again; each keeps its error if it fails again.
      for (const t of root.transfers.list()) {
        if (t.direction !== 'upload' || (t.state !== 'failed' && t.state !== 'paused')) continue;
        try {
          root.transfers.retry(t.id);
        } catch (e) {
          root.log.warn('upload not retried', { error: String((e as Error)?.message ?? e) });
        }
      }
      // Copies edited in other apps go back as new versions; each that cannot keeps why on its row.
      await root.officeLocal.syncPending();
    },
    discardUnsynced: async (itemId) => {
      const uid = root.sessionCtl.userId();
      if (!uid) throw new DesktopError('NOT_SIGNED_IN', 'Sign in again to change this list.');
      const [kind, ...rest] = itemId.split(':');
      const id = rest.join(':');
      if (kind === 'queue') root.queue.discard(uid, id);
      // The copy stays in the downloads folder: only WorkSuite stops waiting to send it.
      else if (kind === 'office') root.officeLocal.forget(id);
      else if (kind === 'upload') await root.transfers.cancel(id);
      else throw new DesktopError('UNSUPPORTED', 'Open that app to review its changes.');
      root.audit.record(uid, 'accounts.unsynced.discarded', { kind });
      root.log.info('unsynced change discarded', { kind });
    },
    exportUnsynced: async (account) => {
      const parent = root.windows.getMain();
      const opts = { title: 'Export changes not yet synced', defaultPath: `worksuite-unsynced-${account.serverName.replace(/[^A-Za-z0-9.-]+/g, '-')}.zip`, filters: [{ name: 'Zip archive', extensions: ['zip'] }] };
      const chosen = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
      if (chosen.canceled || !chosen.filePath) return { path: null };
      const active = account.id === root.registry.activeId();
      const summary = active ? activeUnsynced(account) : otherUnsynced(account);
      const zip = active ? exportUnsyncedZip({ db: root.db, vault: root.vault, accountId: account.id, userId: root.sessionCtl.userId() ?? account.user?.id ?? null }, summary) : exportUnsyncedZip({ db: new Database(':memory:'), vault: null, accountId: account.id, userId: null }, summary);
      await fsp.writeFile(chosen.filePath, zip, { mode: 0o600 });
      return { path: chosen.filePath };
    },
    signOutOther: (account) => signOutOther(account),
    remove: async (account, keepOfflineFiles) => {
      const wasActive = account.id === root.registry.activeId();
      if (wasActive) {
        // Another account opens first; with none left, the session ends and nothing is open.
        const next = root.registry.list().find((a) => a.id !== account.id && !accountsService.blockedReason(a));
        if (next) await switcher.switchTo(next.id);
      }
      const stillBound = root.scopes.current()?.id === account.id;
      await removeAccount(
        {
          userData: root.p.userData,
          appDb: root.appDb,
          registry: root.registry,
          revoke: async (a) => {
            if (stillBound) await root.auth.signOut().catch(() => undefined);
            else await signOutOther(a);
          },
          clearStorage: async (partition) => {
            const ses = partition === '' ? session.defaultSession : session.fromPartition(partition);
            // The default session is guest mode's too: its localStorage stays (the guest workspace is the computer's).
            await ses.clearStorageData(partition === '' ? { storages: ['cookies', 'indexdb', 'cachestorage', 'serviceworkers', 'shadercache', 'filesystem'] } : {});
            await ses.clearCache().catch(() => undefined);
          },
          release: () => {
            if (!stillBound) return;
            root.sessionCtl.suspend();
            root.scopes.release();
            root.db.swap(':memory:');
            root.secrets.rebind(join(root.defaultProfile.dir, 'secrets.json'));
          },
          trash: (path) => shell.trashItem(path),
        },
        account.id,
        { keepOfflineFiles },
      );
      for (const partition of allPartitions(account)) shellSessions.forget(partition);
      if (stillBound) {
        // Nothing open: the computer's default profile, as on a fresh install.
        mkdirSync(root.defaultProfile.dir, { recursive: true, mode: 0o700 });
        root.db.swap(root.defaultProfile.database);
        root.secrets.rebind(root.defaultProfile.secrets);
        root.dbKey = root.vaultKey();
        root.vault = new Vault(Buffer.from(root.dbKey, 'base64'));
        root.auth.rebind(null);
        root.device.rebind();
        root.windows.partition = '';
        await root.sessionCtl.init();
      }
    },
    reachable: () => root.apiReachable,
    health: (accountId) => root.health.components(accountId),
    seedServer: (account, server) => {
      if (root.scopes.current()?.paths.database === profilePaths(root.p.userData, account.profileDir).database || (!root.scopes.current() && account.profileDir === DEFAULT_PROFILE_DIR && root.db.path === root.defaultProfile.database)) {
        root.db.setConfig('server', server);
        return;
      }
      const paths = profilePaths(root.p.userData, account.profileDir);
      mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
      const other = new Database(paths.database);
      try {
        other.setConfig('server', server);
      } finally {
        other.close();
      }
    },
    discover: async (input, target) => {
      try {
        const run = await runDiscovery(
          { runId: randomUUID().replace(/-/g, ''), input, target },
          {
            fetch: netFetchWithRedirects(shellSessions.ensure(CONNECT_PARTITION)),
            trusted: root.trustedNow,
            rotatedKeys,
            existingAccount: (server) => accountsService.existing(server),
            appVersion: app.getVersion(),
            platform: platformName() as 'windows' | 'macos' | 'linux',
            isPackaged: app.isPackaged,
            cloudOrigin: cloudOrigin(app.isPackaged),
          },
          () => undefined,
          AbortSignal.timeout(60_000),
        );
        return run.state === 'ok' ? run.server : null;
      } catch {
        // Discovery not in this build (or the server is legacy): the probe's answer stands.
        return null;
      }
    },
    probe: async (input) => {
      const origin = normalizeServerUrl(input, root.allowInsecure);
      return { ...(await probeServer(origin, root.fetchImpl)), locked: false };
    },
    emit: (state) => emitAccounts('accounts:changed', state),
    showMain: () => void root.windows.showMain(),
    reservePartition: (partition) => {
      const dir = partitionDir(root.p.userData, partition);
      if (dir) queueRemoval(root.appDb, dir, partition);
    },
    adoptPartition: (partition) => {
      const dir = partitionDir(root.p.userData, partition);
      if (dir) unqueueRemoval(root.appDb, dir);
    },
  });
  root.sessionCtl.osManaged = root.OS_MODE;
  root.sessionCtl.accountView = () => {
    const a = root.registry.active();
    return a ? accountsService.view(a, a.id) : null;
  };
  /** Plain network (no credentials) in an account's network partition (OneAuth, a logout for an account not open). */
  function fetchFor(accountId: string): (url: string, init: RequestInit) => Promise<Response> {
    const a = root.registry.get(accountId);
    const ses = shellSessions.ensure(a ? partitionsFor(a).net : CONNECT_PARTITION);
    const nf = createNetFetch((o) => electronNet.request(o), ses);
    return withSafeHeaders((url, init) => nf(url, init as RequestInit)) as (url: string, init: RequestInit) => Promise<Response>;
  }

  // Accounts side by side, connect, browser sign-in and WorkSuite Cloud (Connection & Startup).
  root.accountsWiring = installAccounts({
    router: root.router,
    ctx: root.ctx,
    accounts: {
      service: accountsService,
      registry: root.registry,
      trusted: root.trustedNow,
      sessionFor: (partition) => shellSessions.ensure(partition),
      connectPartition: CONNECT_PARTITION,
      partitionFor: (target) => accountsService.partitionFor(target),
      rotatedKeys,
      accountPins: (host) => {
        const out: string[] = [];
        for (const a of root.registry.list()) if (a.trust?.source === 'setup-link' && a.linkHosts.includes(host.toLowerCase())) out.push(...a.trust.spkiPins);
        return out;
      },
      health: root.healthDeps,
      fetchFor,
      acceptTokens: async (accountId, tokens) => {
        if (root.registry.activeId() !== accountId) await accountsService.switchTo(accountId);
        const a = root.registry.get(accountId);
        if (!a) throw new DesktopError('NOT_FOUND', 'That account is no longer on this computer.');
        await useTokenEndpointFor(a);
        root.auth.acceptTokens(tokens);
        root.registry.update(a.id, { signInState: 'signed-in' });
        // A Personal account's workspace opens once Cloud says it is ready (`activated`); any other's now.
        if (a.kind !== 'personal') await root.sessionCtl.acceptSession({ user: await currentUser(), tokens: { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: tokens.expires_in } });
        accountsService.emit();
        return accountsService.view(root.registry.get(accountId) ?? a, root.registry.activeId());
      },
      cloud: {
        acceptLogin: async (accountId, payload) => {
          if (root.registry.activeId() !== accountId) await accountsService.switchTo(accountId);
          const tokens = payload.tokens as { access_token: string; refresh_token: string; expires_in: number };
          root.auth.acceptTokens(tokens);
          await root.sessionCtl.acceptSession(payload as unknown as SignInPayload);
          const a = root.registry.get(accountId);
          if (!a) throw new DesktopError('NOT_FOUND', 'That account is no longer on this computer.');
          return accountsService.view(a, root.registry.activeId());
        },
        onStage: (accountId, stage) => {
          if (accountId !== root.registry.activeId() || stage === 'ready') return;
          if (stage === 'browser' || stage === 'verify-email' || stage === 'provisioning' || stage === 'bootstrapping' || stage === 'signed-out') root.sessionCtl.setStage(stage);
        },
        activated: async (accountId, me) => {
          if (accountId !== root.registry.activeId() || root.sessionCtl.isReady()) return;
          if (me.active_organization_id) root.accountsWiring?.setOrganization(accountId, me.active_organization_id, me.organizations.find((o) => o.id === me.active_organization_id)?.name ?? null);
          const user = await currentUser();
          await root.sessionCtl.acceptSession({ user } as SignInPayload);
        },
        onSignInFailed: (accountId, error) => {
          if (accountId === root.registry.activeId()) root.sessionCtl.setStage('signed-out', error.message);
          else broadcast('toast', { kind: 'error', text: error.message });
        },
        store: () => ({ get: (key) => root.db.getConfig<string>(key) ?? null, set: (key, value) => root.db.setConfig(key, value) }),
        rotatedEntitlementKeys,
        onQuotaRoom: () => {
          root.transfers.releaseQuota();
          void root.officeLocal.retryQuota().catch(() => undefined);
        },
        onQuotaWarning: (level) => broadcast('toast', { kind: level === 'full' ? 'error' : 'warning', text: level === 'full' ? 'Your WorkSuite Cloud storage is full. Uploads wait until there is room.' : 'Your WorkSuite Cloud storage is almost full.' }),
        deviceName: () => root.device.deviceName(),
      },
    },
  });
  /** WorkSuite OS: the broker's account, opened in this app (os-mode.ts). One at a time. */
  let osOpening: Promise<AuthState> | null = null;
  function openOsSession(): Promise<AuthState> {
    if (osOpening) return osOpening;
    const run = startOsSession({
      call: root.brokerCall,
      deviceServer: () => osDeviceServer(),
      currentOrigin: () => root.auth.getServer()?.origin ?? null,
      setServer: async (url) => void (await accountsService.setServer(url)),
      useEndpoint: (ep) => {
        root.osEndpoint = ep;
        root.auth.setTokenEndpoint(ep);
      },
      acceptTokens: (t) => root.auth.acceptTokens(t),
      hasPreviousUser: () => !!root.bootstrap.lastUserId(),
      resume: () => root.sessionCtl.init(),
      acceptSession: async () => void (await root.sessionCtl.acceptSession({ user: await currentUser() } as SignInPayload)),
      setStage: (stage, message = null) => {
        if (!root.sessionCtl.isReady()) root.sessionCtl.setStage(stage, message);
      },
    })
      .then(() => root.sessionCtl.get())
      .finally(() => {
        osOpening = null;
      });
    osOpening = run;
    return run;
  }
  /** Who is signed in, from the server (a browser sign-in brings tokens, not the user). */
  async function currentUser(): Promise<PublicUser> {
    const me = await root.http.get<{ user?: PublicUser } & Partial<PublicUser>>('/api/auth/me');
    return (me && typeof me === 'object' && 'user' in me && me.user ? me.user : me) as PublicUser;
  }
  pinsFor = root.accountsWiring.discovery.pinsFor;
  if (root.accountsWiring.discovery.health) {
    root.health.stop();
    root.health = root.accountsWiring.discovery.health;
    root.healthFromDiscovery = true;
  }
  root.sessionCtl.cloudStatus = () => root.accountsWiring!.cloud.status();
  root.health.start();
  app.on('before-quit', () => {
    background.stopAll();
    root.health.stop();
    root.accountsWiring!.dispose();
  });
  // The other signed-in accounts poll in the background (§1.4).
  for (const a of root.registry.list()) if (a.id !== root.registry.activeId()) background.adopt(a.id);

  root.router.install();
  const missing = root.router.missingHandlers();
  if (missing.length) root.log.warn('IPC channels without handlers', { missing });

  root.rebuildMenu(root.sessionCtl.visibleApps());

  // Open mailto: links in WorkSuite (D04): only when the person turned it on, and only for an installed copy.
  const applyMailtoHandler = (on: boolean): void => {
    const dev = !app.isPackaged && process.env.WS_REGISTER_PROTOCOL === '1' && process.argv.length >= 2;
    if (!app.isPackaged && !dev) return;
    const path = dev ? process.execPath : undefined;
    const args = dev ? [resolve(process.argv[1]!)] : undefined;
    try {
      const registered = app.isDefaultProtocolClient('mailto', path, args);
      if (on && !registered) app.setAsDefaultProtocolClient('mailto', path, args);
      else if (!on && registered) app.removeAsDefaultProtocolClient('mailto', path, args);
    } catch (e) {
      root.log.warn('mailto handler', { error: String(e) });
    }
  };
  applyMailtoHandler(root.settings.effective().mailtoHandler === true);
  // What Mail keeps offline changed: its bodies are listed and fetched again soon (#190).
  let bodyPrefs = JSON.stringify([root.settings.effective().mailCacheDays, root.settings.effective().mailCacheDaysByMailbox ?? {}, root.settings.effective().mailFolderOffline ?? {}]);
  root.settings.onChange((prefs) => {
    const now = JSON.stringify([prefs.mailCacheDays, prefs.mailCacheDaysByMailbox ?? {}, prefs.mailFolderOffline ?? {}]);
    if (now !== bodyPrefs) {
      bodyPrefs = now;
      root.mailBodies.kick(2_000, true);
    }
    applyMailtoHandler(prefs.mailtoHandler === true);
    root.webchat.refresh();
    root.syncLiveKeys();
    root.syncQuickAsk();
    broadcast('settings:changed', prefs);
    if (prefs.backgroundServices.realtime && root.sessionCtl.isReady()) root.realtime.start();
    if (!prefs.backgroundServices.realtime) root.realtime.stop();
  });
  writeBootConfig(root.p.bootConfig, { hardwareAcceleration: root.settings.effective().hardwareAcceleration });
  return { accountFollowsSession, accountsService, background, openOsSession, useTokenEndpointFor };
}
