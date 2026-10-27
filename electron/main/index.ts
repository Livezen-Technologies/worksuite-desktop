import { PayrollReminders } from '../services/payroll-reminders';
import { AssetAlerts } from '../services/assets-alerts';
import { type TrayAssets } from '@shared/assets';
import { HostingAlerts } from '../services/hosting-alerts';
import { type TrayHosting } from '@shared/hosting';
import { LocalSession, LocalWorkspace } from '../services/local-workspace';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { GuestMeetService } from '../services/guest-meet';
import { app, net as electronNet, Notification, clipboard, crashReporter, desktopCapturer, dialog, globalShortcut, ipcMain, nativeTheme, powerMonitor, screen, session, shell, systemPreferences, BrowserWindow } from 'electron';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { canOpenApp, notificationAllowed } from '@shared/access';
import { findDeepLinkInArgv } from '@shared/deeplink';
import { isOsMode, moduleLinkInArgv } from '@shared/os-mode';
import { findMailtoInArgv } from '@shared/mailto';
import { type BusyReport, type UpdateActivity, type UpdateDiagnostics, type UpdateStatus, type WebchatOnCall } from '@shared/types';
import { AccessWatch } from './access';
import { applyAutostart, gatewayAutostart, setGatewayAutostart, startedAsGateway } from './autostart';
import { evaluateBoot, markRunning } from './boot';
import { broadcast, sendTo } from './events';
import { installAppearance } from '../windows/appearance';
import { AppearanceSync } from '../services/appearance-sync';
import { type AccountsWiring, policyKeyFor, seedServerConfig, trustedWithEnterprise } from './accounts-wiring';
import type { ServiceHealthState } from '@shared/accounts';
import type { TrustedConfig } from '@shared/trusted-config';
import { appDbPath, openAppDb } from '../services/accounts/app-db';
import { migrateAccounts } from '../services/accounts/migrate';
import { DEFAULT_PROFILE_DIR, profilePaths } from '../services/accounts/profile';
import { AccountRegistry } from '../services/accounts/registry';
import { processPendingRemovals } from '../services/accounts/removal';
import { ScopeHolder } from '../services/accounts/scope';
import { HealthMonitor } from '../services/discovery/health';
import { readTrustedConfig } from '../services/discovery/trusted-config';
import { initLog, logger } from './log';
import { DesktopError } from './errors';
import { paths } from './paths';
import type { SessionController} from './session';
import { syncRefusal } from './session';
import { hardenSession, isTrustedShellUrl, registerPrivilegedSchemes, hardenWebContents } from '../security/hardening';
import { AuditService } from '../services/audit';
import { AuthService } from '../services/auth';
import { BootstrapService } from '../services/bootstrap';
import { CallService } from '../services/calls';
import { ScreenShare } from '../services/screen-share';
import { createRemoteControl } from '../services/remote-control/host';
import { DEFAULT_POLICY } from '../services/policy';
import { Database } from '../services/db';
import { rebuildIfAsked } from '../services/mail-repair';
import { archName, DeviceService, platformName } from '../services/device';
import { PmsLocks } from '../services/pms-locks';
import { ContactSync } from '../services/contact-sync';
import { createPos } from '../services/pos-ipc';
import { PhoneService } from '../services/phone';
import { SalonDesk } from '../services/salon-desk';
import { SalonPrint } from '../services/salon-print';
import { SalonSync } from '../services/salon-sync';
import { readEnterpriseConfig } from '../services/enterprise';
import { CLIENT_TYPE, CLIENT_TYPE_HEADER, HttpClient, withSafeHeaders, type FetchLike } from '../services/http';
import { createNetFetch } from '../services/net-fetch';
import { installProcessGuards } from './process-guards';
import { LockService } from '../services/lock';
import { LockPin } from '../services/lock-pin';
import { NotificationService, inDnd } from '../services/notifications';
import { MailAlertService } from '../services/mail-alerts';
import { previewOfPrivacy } from '@shared/mail-alerts';
import { ShareBar } from '../services/share-bar';
import * as fsp from 'node:fs/promises';
import { type Injector } from '../services/remote-control/input';
import { OfflineCache } from '../services/offline-cache';
import { MailBodies } from '../services/mail-bodies';
import { MailMedia, mailAttachmentKeepMax } from '../services/mail-media';
import { attachmentStorePathOf } from '@shared/mail-media';
import { mimeFor } from '@shared/mime';
import { OfflineQueue } from '../services/offline-queue';
import { RealtimeService } from '../services/realtime';
import { ConnectionMonitor, tcpHandshake, timeFetch } from '../services/connection-quality';
import { ApiTimings } from '@shared/connection';
import { SecureStore } from '../services/secure-store';
import { SettingsService, defaultPreferences } from '../services/settings';
import { DesktopSettingsService } from '../services/desktop-settings';
import { preferenceOverlay } from '@shared/desktop-settings';
import { DriveSync } from '../services/sync/engine';
import { ServiceSupervisor } from '../services/supervisor';
import { MeetRecorder } from '../services/meet-recorder';
import { SpeechService } from '../services/speech';
import { TransferManager, queueConfig, type DownloadSink } from '../services/transfers';
import { ElearningOffline } from '../services/elearning-offline';
import { BoardVault } from '../services/board-vault';
import { createBrokerCall, readOsDevice, type BrokerTokenEndpoint } from '../services/os-mode';
import { EventDesk } from '../services/event-desk';
import { EventDeskPrint } from '../services/event-desk-print';
import { createRestaurant } from '../services/restaurant';
import { createLabel } from '../services/label';
import { SinhalaService, type SinhalaDocxRequest } from '../services/sinhala';
import type { DocxConvertStats } from '../services/sinhala-docx';
import { execFile as execFileCb } from 'node:child_process';
import { OfficeEditorHost } from '../services/office-editor';
import { OfficeExternal } from '../services/office-external';
import { markFromInternet } from '../services/quarantine';
import { mailFilePathsInArgv } from '../services/mail-files/argv';
import { OfficeLocalFiles, officePathsInArgv } from '../services/office-local';
import { ImageLocal } from '../services/image-local';
import { writeAtomically as writeImageAtomically } from '../services/pdf/host';
import { pdfPathsInArgv } from '../services/pdf/local-files';
import { Vault } from '../services/vault';
import { POLICY_PUBLIC_KEY } from '../updater/keys';
import { linuxInstallKind } from '../updater/linux';
import { UPDATE_CENTER_RELEASE_KEYS, UPDATE_CENTER_RESPONSE_KEYS, UPDATE_CENTER_URL, ed25519Key, ucInstallType, updateCheckUrl } from '../updater/update-center';
import { announce, noticeText } from '../updater/notice';
import { runUpdateDiagnostics } from '../updater/diagnostics';
import type { TrayUpdate } from '../tray/tray';
import { UpdaterService } from '../updater/updater';
import { UpdateHealth, UpdateHistory, UpdateNotifier } from '../updater/update-flow';
import { CHANNEL_INFO, allowedChannels, channelLockReason, channelSource, idleInstallDue } from '@shared/updates';
import { WindowManager } from '../windows/manager';
import { wireLifecycle } from './wiring/lifecycle';
import { wireIpc } from './wiring/ipc';
import { wireAccess } from './wiring/access';
import { wireMarketing } from './wiring/marketing';
import { wireQuickAsk } from './wiring/quick-ask';
import { wireLiveDesk } from './wiring/live-desk';
import { wireWebchat } from './wiring/webchat';
import { wireTray } from './wiring/tray';
import { wirePresence } from './wiring/presence';
import { wireStatus } from './wiring/status';
import { wireNavigation } from './wiring/navigation';
import { wireAccounts } from './wiring/accounts';
import { wireSession } from './wiring/session';

/**
 * WorkSuite Desktop — main process.
 *
 * Owns the app lifecycle, windows, IPC, tray, protocols, notifications and
 * the secure-storage broker (§3.2). Business logic stays on the server; this
 * process caches, queues, routes and enforces device policy.
 */

// ── before ready ─────────────────────────────────────────────────────────

// Development and tests only: an isolated profile, so a test run never
// touches a real installation's data. Packaged builds ignore it.
if (!app.isPackaged && process.env.WS_USER_DATA_DIR) app.setPath('userData', process.env.WS_USER_DATA_DIR);
// Unpackaged test runs: a fake microphone and camera, and no permission prompt.
if (!app.isPackaged && process.env.WS_E2E_FAKE_MEDIA) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

/** PDFs handed over before PDF Studio is running wait here. */
const pendingPdfs: string[] = [];
let handPdfs: (paths: string[]) => void = (paths) => void pendingPdfs.push(...paths);
/** PDF Studio's saves waiting for WorkSuite go when it answers again (set once PDF Studio exists). */
let pdfOnline: () => void = () => undefined;
/** Office files handed over before the app is running wait here, then open in WorkSuite DOC / Sheet / Slides tabs. */
const pendingOffice: string[] = [];
let handOffice: (paths: string[]) => void = (paths) => void pendingOffice.push(...paths);
/** .eml and .msg files handed over before Mail's data-file service is running wait here (ENH-MAIL-03 DMO-DAT-04). */
const pendingMailFiles: string[] = [];
let handMailFiles: (paths: string[]) => void = (paths) => void pendingMailFiles.push(...paths);

/**
 * WorkSuite OS mode (docs/WORKSUITE_OS.md): the OS's credentials broker, device enrolment, package manager and screen
 * lock take the place of the app's own sign-in, registration, updater and app lock.
 */
const OS_MODE = isOsMode(process.argv, process.env, existsSync);

if (!app.requestSingleInstanceLock()) {
  // FR-DL-04: a second launch hands its arguments (and deep link) to the first.
  app.quit();
} else {
  main();
}

function main(): void {
  const p = paths();
  initLog(p.logs);
  const log = logger('main');
  // #238: an error nothing caught is logged for Diagnostics and told to the person in the app — never the raw dialog.
  installProcessGuards({ notify: (text) => broadcast('toast', { kind: 'error', text }), report: (summary) => crashReporter.addExtraParameter('last-js-error', summary.slice(0, 120)) });
  const boot = evaluateBoot(p, process.argv);
  if (!boot.hardwareAcceleration) app.disableHardwareAcceleration();
  markRunning(p.runningMarker);
  log.info('starting', { version: app.getVersion(), platform: process.platform, arch: process.arch, safeMode: boot.safeMode, uncleanExit: boot.uncleanExit });

  app.enableSandbox();
  registerPrivilegedSchemes();
  app.on('web-contents-created', (_e, contents) => hardenWebContents(contents));
  if (process.platform === 'win32') app.setAppUserModelId('lk.worksuite.desktop');
  // Crash dumps stay on this machine; they are shared only through a diagnostic bundle (WF-27, Q4).
  crashReporter.start({ uploadToServer: false });

  // FR-DL-01: worksuite:// on every platform. A development build registers
  // itself only when asked, so running tests never takes over the system's
  // handler from an installed copy.
  if (OS_MODE) {
    // WorkSuite OS registers the handler itself (the package's .desktop entry and the start menu's mimeapps.list).
  } else if (app.isPackaged) {
    app.setAsDefaultProtocolClient('worksuite');
  } else if (process.env.WS_REGISTER_PROTOCOL === '1' && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('worksuite', process.execPath, [resolve(process.argv[1]!)]);
  }

  const pendingLinks: string[] = [];
  let handleLink: (url: string) => void = (url) => pendingLinks.push(url);
  app.on('open-url', (e, url) => {
    e.preventDefault();
    handleLink(url);
  });
  // Universal Links (#170): an https://app.worksuite.lk/o/… link macOS hands to the app instead of the browser,
  // once the server's apple-app-site-association names this app. Held to the same grammar as any other link.
  app.on('continue-activity', (e, type, details) => {
    const url = (details as { webpageURL?: unknown } | undefined)?.webpageURL;
    if (type !== 'NSUserActivityTypeBrowsingWeb' || typeof url !== 'string') return;
    e.preventDefault();
    handleLink(url);
  });
  // `--module=<id>` (the WorkSuite OS start menu) opens through the same path as worksuite://<id>.
  const argvLink = findDeepLinkInArgv(process.argv) ?? findMailtoInArgv(process.argv) ?? moduleLinkInArgv(process.argv);
  if (argvLink) pendingLinks.push(argvLink);
  // PDFs the operating system hands over ("Open with"; a file dropped on the Dock icon): PDF Studio opens each.
  app.on('open-file', (e, path) => {
    e.preventDefault();
    if (/\.(docx|xlsx|pptx)$/i.test(path)) handOffice([path]);
    else if (/\.(eml|msg)$/i.test(path)) handMailFiles([path]);
    else handPdfs([path]);
  });
  handPdfs(pdfPathsInArgv(process.argv));
  handOffice(officePathsInArgv(process.argv));
  handMailFiles(mailFilePathsInArgv(process.argv));

  app.whenReady().then(() => start(boot, pendingLinks, (fn) => (handleLink = fn)));
}

// ── ready ────────────────────────────────────────────────────────────────

function start(boot: ReturnType<typeof evaluateBoot>, pendingLinks: string[], setLinkHandler: (fn: (url: string) => void) => void): void {
  const p = paths();
  const log = logger('main');
  const allowInsecure = !app.isPackaged;
  hardenSession(session.defaultSession);

  const enterprise = readEnterpriseConfig();

  // ── accounts (Connection & Startup §1): app.db, the registry, account #1 from the legacy profile ─────────
  // Removals a previous run could not finish (Chromium held the partition), before any partition or window opens.
  const appDb = openAppDb(appDbPath(p.userData));
  const leftovers = processPendingRemovals(appDb, p.userData);
  if (leftovers.removed || leftovers.left) log.info('pending removals', leftovers);
  const registry = new AccountRegistry(appDb);
  const trustedNow = (): TrustedConfig => trustedWithEnterprise(readTrustedConfig(), enterprise);
  const defaultProfile = profilePaths(p.userData, DEFAULT_PROFILE_DIR);
  // One SecureStore, read first for the legacy profile (its refresh token, its db-key), then bound to the open account.
  const secrets = new SecureStore(defaultProfile.secrets);
  secrets.init();
  try {
    const result = migrateAccounts({ userData: p.userData, appDb, registry, readLegacySecret: (name) => secrets.get(name), trusted: trustedNow(), log: (m, d) => log.info(m, d) });
    if (result.migrated || result.reconciled) log.info('accounts', { migrated: result.migrated, reconciled: result.reconciled, legacy: !!result.legacyId, managed: !!result.managedId });
  } catch (e) {
    // Never a reason not to start: the legacy profile stays account #1's place whatever app.db says.
    log.error('account migration failed; starting with the profile as it is', { error: String((e as Error)?.message ?? e) });
  }
  // `--account=<id>` (a relaunch into another account, §1.3 step 9).
  const askedAccount = process.argv.find((a) => a.startsWith('--account='))?.slice('--account='.length) ?? null;
  if (askedAccount && registry.get(askedAccount)) registry.setActive(askedAccount);
  const scopes = new ScopeHolder(p.userData);
  /** Discovery's and Cloud's handles (installAccounts, below); null until then. */
  let accountsWiring: AccountsWiring | null = null;
  const firstAccount = registry.active();
  const firstScope = firstAccount ? scopes.bind(firstAccount) : null;
  const profile = firstScope?.paths ?? defaultProfile;
  mkdirSync(profile.dir, { recursive: true, mode: 0o700 });
  if (profile.secrets !== secrets.path) secrets.rebind(profile.secrets);

  // Repair local mail data asked for a rebuild (worksuite-desktop#338): done before anything opens the database.
  rebuildIfAsked(profile.database, (msg, data) => log.warn(msg, data));
  const db = new Database(profile.database);
  if (firstAccount) seedServerConfig(db, firstAccount);

  // The database key lives in the OS credential store; without one it lives
  // in memory, and nothing encrypted outlives the session.
  const vaultKey = (): string => {
    let key = secrets.get('db-key');
    if (!key) {
      key = Vault.generateKey().toString('base64');
      secrets.set('db-key', key);
    }
    return key;
  };
  let dbKey = vaultKey();
  let vault = new Vault(Buffer.from(dbKey, 'base64'));
  const getVault = () => vault;
  /** The open account's profile folders (getters follow a switch, §1.3 "Profile paths"). */
  const accountPaths = () => scopes.current()?.paths ?? defaultProfile;

  // The open account's network partitions (§1.1): API traffic, and bulk traffic (uploads, downloads, mail pictures
  // and bodies fetched ahead) with its own connection pool (worksuite-desktop#252): Chromium allows 6 connections per
  // host per session, and an upload's parts used to take all of them. Auth is a header, not a cookie, so the second
  // session needs no shared cookie jar. Account #1 keeps `persist:ws-net` / `persist:ws-bulk`.
  const firstPartitions = firstScope?.partitions ?? { shell: '', net: 'persist:ws-net', bulk: 'persist:ws-bulk' };
  let net = session.fromPartition(firstPartitions.net);
  let bulkNet = session.fromPartition(firstPartitions.bulk);
  const proxyConfig = enterprise.proxy && enterprise.proxy.mode !== 'system' ? (enterprise.proxy.mode === 'pac' ? { pacScript: enterprise.proxy.url ?? '' } : { proxyRules: enterprise.proxy.rules ?? enterprise.proxy.url ?? '', proxyBypassRules: enterprise.proxy.bypass ?? '' }) : null;
  if (proxyConfig) {
    void net.setProxy(proxyConfig);
    void bulkNet.setProxy(proxyConfig);
    void session.defaultSession.setProxy(proxyConfig);
  }
  // Every main-process request's headers go through the header-safety helper (#238): nothing above 255 reaches undici.
  // And every response's (#253): not `net.fetch`, whose own listener throws on a raw UTF-8 file name and never settles.
  // The fetches delegate to the open account's partitions: a switch rebinds them (§1.3 "Network").
  let netFetch = createNetFetch((o) => electronNet.request(o), net);
  let bulkNetFetch = createNetFetch((o) => electronNet.request(o), bulkNet);
  const fetchImpl: FetchLike = withSafeHeaders((url, init) => netFetch(url, init as RequestInit));
  const bulkFetchImpl: FetchLike = withSafeHeaders((url, init) => bulkNetFetch(url, init as RequestInit));
  const bindNetwork = (partitions: { net: string; bulk: string }): void => {
    net = session.fromPartition(partitions.net);
    bulkNet = session.fromPartition(partitions.bulk);
    netFetch = createNetFetch((o) => electronNet.request(o), net);
    bulkNetFetch = createNetFetch((o) => electronNet.request(o), bulkNet);
  };

  // Guest mode's workspace is the computer's, never an account's (§1.6): always profiles/default.
  const local = new LocalWorkspace(join(defaultProfile.dir, 'guest-workspace.sqlite'));
  // Guest mode runs in the main window (#149): which window is in it and past its PIN, and where a move may go.
  const localSession = new LocalSession(local);
  let localAccountKey: () => string | null = () => null;
  let wasSignedIn = false;
  // Device preferences are the computer's (§1.1): app.db, where the migration copied them.
  const settings = new SettingsService(appDb);
  /** Media servers (LiveKit) the WorkSuite server announced; allowed in the page's CSP. */
  let pendingGuest: { input: string; server?: string } | null = null;
  const guests = new GuestMeetService({ fetch: fetchImpl, server: () => auth.getServer()?.origin ?? null });
  const mediaServers = (): string[] => db.getConfig<string[]>('media_servers') ?? [];
  const clientHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      'X-WS-Client': `worksuite-desktop/${app.getVersion()} (${platformName()}; ${archName()})`,
      // The client type, for the server's per-client chat service scope; HttpClient sets it too.
      [CLIENT_TYPE_HEADER]: CLIENT_TYPE,
    };
    const dev = device?.current();
    if (dev) h['X-WS-Device'] = device.headerValue() ?? dev.id;
    // The remembered computer (worksuite-desktop#301): the server marks it as this one in the account's devices.
    Object.assign(h, auth.deviceHeader());
    // A Personal account: WorkSuite Cloud runs Core for its organization (Connection & Startup §3).
    const open = scopes.current()?.account;
    const org = open?.kind === 'personal' ? (accountsWiring?.cloud.organizationId() ?? open.organizationId) : null;
    if (org) h['X-WS-Org'] = org;
    return h;
  };

  const auth = new AuthService(db, secrets, fetchImpl, clientHeaders);

  let apiReachable = true;
  // Set once the transfer manager exists (below); the server can drop out before then.
  let transfersOnline: (ok: boolean) => void = () => undefined;
  let reachabilityProbe: NodeJS.Timeout | null = null;
  // The service banner's monitor (Connection & Startup §2 "Health monitor", WP2) in place of the fixed probe: it tells
  // offline, unreachable and unavailable apart and backs off up to five minutes. Discovery's own monitor replaces this
  // one once it has one (`installAccounts`); until then a monitor that does not probe keeps the old 15 s probe as the
  // way back.
  let healthFromDiscovery = false;
  /** Work Offline (the service banner, screen 16): writes queue and nothing is tried on the network until it is off. */
  let workOffline = false;
  const healthDeps = {
    healthUrl: (): string | null => {
      const server = auth.getServer();
      if (!server) return null;
      return server.endpoints?.health ?? `${server.origin}/api/health`;
    },
    fetch: (url: string, init: RequestInit) => fetchImpl(url, init),
    internetOnline: () => electronNet.isOnline(),
    onChange: (state: ServiceHealthState) => {
      if (state.state === 'ok') onReachability(true);
      emitStatus();
    },
    componentUrls: () => {
      const e = auth.getServer()?.endpoints;
      const origin = auth.getServer()?.origin ?? null;
      return { auth: origin ? `${origin}/api/auth/config` : null, realtime: e?.realtime ?? null, files: e?.files ?? null, office: e?.office ?? null };
    },
  };
  let health: HealthMonitor = new HealthMonitor(healthDeps);
  const onReachability = (ok: boolean): void => {
    // Working offline by choice: the server answering a probe does not end it.
    if (ok && workOffline) return;
    if (ok === apiReachable) return;
    apiReachable = ok;
    log.info(ok ? 'server reachable again' : 'server unreachable');
    // Nothing new starts while the server is out of reach; what it interrupted carries on when it is back.
    transfersOnline(ok);
    emitStatus();
    if (ok) {
      if (reachabilityProbe) clearInterval(reachabilityProbe);
      reachabilityProbe = null;
      onReconnect();
      return;
    }
    void health.retryNow().catch(() => undefined);
    if (!healthFromDiscovery && !reachabilityProbe) {
      reachabilityProbe = setInterval(() => {
        const origin = auth.getServer()?.origin;
        if (!origin) return;
        fetchImpl(`${origin}/api/auth/config`, { method: 'GET', headers: { [CLIENT_TYPE_HEADER]: CLIENT_TYPE }, signal: AbortSignal.timeout(10_000) })
          .then(() => onReachability(true))
          .catch(() => undefined);
      }, 15_000);
      reachabilityProbe.unref?.();
    }
  };

  // Forward-declared so the HTTP client's callbacks can reach the session.
  let sessionCtl: SessionController;
  /** WorkSuite OS mode: the credentials broker, and the open account's token endpoint through it. */
  const brokerCall = createBrokerCall();
  let osEndpoint: BrokerTokenEndpoint | null = null;
  // The API's last 20 requests, for connection strength's median (worksuite-desktop#254).
  const apiTimings = new ApiTimings();
  const httpDeps = (fetch: FetchLike): ConstructorParameters<typeof HttpClient>[0] => ({
    fetch,
    origin: () => auth.getServer()?.origin ?? null,
    tokens: { accessToken: () => auth.accessToken(), refresh: () => auth.refresh() },
    clientHeaders,
    onReachability,
    // The leak guard (§1.3): a request for the account that was open before a switch never lands in the next one.
    scope: () => scopes.requestScope(),
    workOffline: () => workOffline,
    onAuthLost: (reason) => sessionCtl?.expired(reason === 'Session ended' ? 'Your session has ended. Sign in again to continue.' : reason),
    onDeviceDirective: (code, message) => {
      if (code === 'DEVICE_REVOKED') void sessionCtl?.wipe(message);
      else if (code === 'DESKTOP_ACCESS_DISABLED') sessionCtl?.handleDirective({ kind: 'block', reason: message });
      else if (code === 'VERSION_UNSUPPORTED' || code === 'UPDATE_REQUIRED') updater.serverRejected();
      // WorkSuite Cloud's gateway: the organization was suspended or is gone — Cloud reads /me again (§3).
      else if (code === 'ORG_SUSPENDED' || code === 'ORG_NOT_FOUND') accountsWiring?.cloud.refetchMe();
    },
  });
  const http = new HttpClient(httpDeps(timeFetch(fetchImpl, apiTimings)));
  // The same client on the bulk pool (#252): uploads, downloads and mail's pictures and bodies fetched ahead.
  const bulkHttp = new HttpClient(httpDeps(bulkFetchImpl));

  const device: DeviceService = new DeviceService(db, secrets, http);
  if (OS_MODE) device.osEnrolment = () => readOsDevice();
  const salonDesk = new SalonDesk(secrets, http, () => auth.getServer()?.origin ?? null);
  const salonPrint = new SalonPrint({ config: db, http, origin: () => auth.getServer()?.origin ?? null, desk: () => salonDesk.pairing()?.desk_id ?? null });
  // The policy is verified with the account's own key when IT configured one (its trusted `discovery_key`).
  // A release build applies no unsigned policy, so none at all when it has no key (audit D-G05); a dev build does.
  const bootstrap = new BootstrapService(db, getVault, http, () => policyKeyFor(scopes.current()?.account ?? null, POLICY_PUBLIC_KEY), app.isPackaged);
  const cache = new OfflineCache(db, getVault);
  const mailLimits = () => {
    const caps = sessionCtl.capabilities();
    const pol = sessionCtl.current()?.policy;
    return { enabled: caps.offlineCache && canOpenApp('mail', sessionCtl.visibleApps()), maxBytes: (pol?.offline_storage_max_mb ?? 2048) * 1024 * 1024 };
  };
  // Mail's pictures and attachments kept on this computer (#163): pictures through WorkSuite's proxy, attachments ahead.
  const mailMedia = new MailMedia({
    http: bulkHttp,
    cache,
    userId: () => sessionCtl?.userId() ?? null,
    prefs: () => settings.effective(),
    limits: mailLimits,
    online: () => apiReachable && !!sessionCtl?.isReady(),
  });
  // "Download message bodies" (#190): Mail's bodies within the keep period, fetched ahead into the offline cache.
  const mailBodies = new MailBodies({
    afterBody: (user, path, body) => mailMedia.afterBody(user, path, body),
    http: bulkHttp,
    cache,
    userId: () => sessionCtl?.userId() ?? null,
    prefs: () => settings.effective(),
    limits: mailLimits,
    online: () => apiReachable && !!sessionCtl?.isReady(),
  });
  const audit = new AuditService(db, getVault, http, () => auth.getServer()?.api === 'desktop-v1');
  const supervisor = new ServiceSupervisor();
  const lock = new LockService();
  lock.disabled = OS_MODE;
  const lockPin = new LockPin(db, getVault);
  // Where windows were is the computer's (app.db); each account's windows open in its own partition.
  const windows = new WindowManager(appDb, join(__dirname, '../preload/index.js'));
  windows.partition = firstPartitions.shell;
  windows.minimizeToTray = () => settings.effective().minimizeToTray;
  // Colour profiles (worksuite-desktop#234): on every page before its first paint, to every page on a change, and
  // between the person's devices.
  installAppearance({ settings, windows, ipc: ipcMain, nativeTheme });
  const appearanceSync = new AppearanceSync({ http, settings, online: () => sessionCtl.isReady() });
  // Desktop settings (shared/desktop-settings.ts): features, apps and the startup screen, with the organisation's
  // policy over them, synced for the person and kept here "as of" the last read for offline. Kept per person in the
  // account's database.
  const desktopSettingsScope = (): string | null => {
    const s = sessionCtl?.get();
    return s && (s.stage === 'ready' || s.stage === 'expired') && s.user?.id ? `${registry.activeId() ?? s.server?.origin ?? ''}:${s.user.id}` : null;
  };
  const desktopSettings = new DesktopSettingsService({
    http,
    db,
    online: () => !!sessionCtl?.isReady(),
    scope: desktopSettingsScope,
    // The company open here; none (All organizations) is the person's home company, as the server picks it.
    organizationId: () => sessionCtl?.organizationScope() ?? null,
    deviceId: () => device.current()?.id ?? null,
    prefs: () => settings.raw(),
    defaults: () => defaultPreferences(),
    resetPrefs: (patch) => void settings.update(patch),
  });
  settings.setDesktopOverlay(preferenceOverlay(desktopSettings.effective()));
  /** `features.globalShortcut`: the keys held for the whole computer that bring WorkSuite up. */
  const globalKeysOn = (): boolean => desktopSettings.feature('globalShortcut');
  /** Spelling as you type (`prefs.spellcheck`), in every window's session. */
  const applySpellcheck = (wc: Electron.WebContents): void => {
    try {
      wc.session.setSpellCheckerEnabled(settings.effective().spellcheck !== false);
    } catch {
      /* a session that has no spell checker */
    }
  };
  app.on('web-contents-created', (_e, wc) => applySpellcheck(wc));
  // A call rings only for whoever may open Chat (calls are part of it).
  const calls = new CallService(
    windows,
    http,
    () => sessionCtl.isReady() && (!lock.isLocked() || settings.effective().lockedCallNotifications !== false) && canOpenApp('calls', sessionCtl.visibleApps()),
    () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('meet', sessionCtl.visibleApps()),
  );
  const screenShare = new ScreenShare(url => !lock.isLocked() && isTrustedShellUrl(url));
  /*
   * The sharing bar (WS-MEET-ENH-01 D03): the strip over what you are sharing.
   * Raised and dropped by the screen-share service, which is the one place
   * that already knows which window is sharing which source — the same signal
   * the share outline follows.
   */
  const shareBar = new ShareBar({
    open: (hash, bounds) => windows.openRemote('share-bar', hash, bounds),
    send: (win, state) => sendTo(win, 'meet:bar', state),
  });

  screenShare.onShare = (webContentsId, source) => {
    if (source) shareBar.start(webContentsId, source);
    else shareBar.stop(webContentsId);
  };
  // Screen sharing's display-media handler goes on every account partition (installShellSession, below).
  // Meet remote control on this computer (WS-MEET-ENH-01): the share, consent, grant and input live here.
  // A meeting, call, share or remote control started or ended: update notices wait for it (#205; set below).
  let onUpdateActivity: () => void = () => undefined;
  // A website visitor's call in progress (set by webchatOnCall below).
  let webchatCallLive = false;
  const remoteControl = createRemoteControl({
    db,
    http,
    windows,
    screenShare,
    get transfers() {
      return transfers;
    },
    deviceId: () => {
      const id = Number(device.current()?.id);
      return Number.isInteger(id) && id > 0 ? id : null;
    },
    policy: () => sessionCtl?.current()?.policy ?? DEFAULT_POLICY,
    pinnedKey: POLICY_PUBLIC_KEY,
    broadcast: (view) => {
      broadcast('rc:changed', view);
      tray.update({ remoteControl: view.session ? { controller: view.session.controller, paused: view.session.status === 'CONTROL_PAUSED' } : null });
      onUpdateActivity();
    },
    toast: (text) => broadcast('toast', { kind: 'info', text }),
  });
  const reportCapabilities = (): void => {
    const screenPermission = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'not_required';
    void remoteControl.reportCapabilities({
      platform: platformName() as 'windows' | 'macos' | 'linux',
      osVersion: `${process.getSystemVersion?.() ?? ''}`,
      desktopVersion: app.getVersion(),
      screenPermission,
      displays: screen.getAllDisplays().length,
    });
  };
  calls.poll(() => realtime.getState() === 'connected');

  const realtime = new RealtimeService(http, () => auth.getServer()?.origin ?? null, allowInsecure);
  let realtimeDownSince: number | null = null;
  // Connection strength (worksuite-desktop#254, #265): the network delay by the realtime socket's echo, else the time to
  // open a TCP connection to the server (not through a proxy), else /api/health as an upper bound. The speed test runs
  // on the bulk pool, so it never holds up chats (#252).
  const connection = new ConnectionMonitor({
    realtime,
    http,
    bulk: bulkHttp,
    tcpPing: tcpHandshake({ resolveProxy: (url) => net.resolveProxy(url) }),
    origin: () => auth.getServer()?.origin ?? null,
    active: () => !!sessionCtl?.isReady() && !!auth.getServer(),
    onChange: () => emitStatus(),
    api: apiTimings,
  });
  connection.start();

  const notifications = new NotificationService(db, getVault, http, () => settings.effective());
  // Payroll's tray reminders (D24): cut-off, approvals waiting and pay dates, even with the Payroll tab closed.
  const payrollReminders = new PayrollReminders(http, notifications);
  // Assets' alerts and tray line (D03): handovers to confirm, loans overdue, approvals waiting — with the tab closed.
  // The tray is made later in start(); its line follows the count once it exists.
  let assetsTray: ((t: TrayAssets | null) => void) | null = null;
  const assetAlerts = new AssetAlerts(http, notifications, (t) => assetsTray?.(t));
  // Hosting & Domains (HDM-DSK-04): monitors down and what expires within 7 days, on the tray badge and as notices.
  let hostingTray: ((t: TrayHosting | null) => void) | null = null;
  // The last counts, for the status snapshot: the renderer paints them onto the macOS Dock icon with the rest.
  let hostingCounts: TrayHosting | null = null;
  const hostingAlerts = new HostingAlerts(http, notifications, (t) => {
    hostingCounts = t;
    hostingTray?.(t);
  });
  const queue = new OfflineQueue(db, getVault, http, () => sessionCtl.capabilities().offlineQueue);
  // New-mail alerts (ENH-MAIL-05): one per message on this computer — the row's "New" in Mail, the in-app card while
  // WorkSuite is in front, the system's notification while it is not — and the tray's mail lines, pause and badge.
  const mailAlerts = new MailAlertService(http, {
    prefs: () => settings.effective(),
    userId: () => (sessionCtl.isReady() ? sessionCtl.userId() : null),
    deviceId: () => device.installId(),
    appVersion: () => app.getVersion(),
    window: () => {
      const w = windows.getMain();
      // Behind the lock nothing is "in front": a new email is the system's notification, with nothing of it shown.
      const visible = !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && !lock.isLocked();
      return { visible, focused: visible && !!w?.isFocused() };
    },
    osDnd: () => systemFocus.active(),
    appQuiet: () => {
      const p = settings.effective();
      return (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, new Date())) || notifications.pausedUntilIso() !== null;
    },
    locked: () => lock.isLocked(),
    sharing: () => screenShare.isSharing(),
    mailAllowed: () => notificationAllowed({ module: 'mail', link: '/mail' }, sessionCtl.visibleApps()),
    policyMinPreview: () => {
      const min = settings.policyMinPrivacy();
      return min ? previewOfPrivacy(min) : null;
    },
    send: (channel, payload) => sendTo(windows.getMain(), channel, payload),
    open: (route) => notifications.onClick(route, 'mail'),
    submit: (input) => {
      const me = sessionCtl.userId();
      return me ? queue.submit(me, input) : Promise.resolve({ delivered: false, queued: false, id: null, status: null, data: null, error: 'You are signed out.', code: 'NOT_SIGNED_IN' });
    },
    saveDraft: (context, content) => {
      const me = sessionCtl.userId();
      if (me) queue.saveDraft(me, 'mail', context, content);
    },
    savePause: (uid, pause) => {
      const all = { ...(settings.raw().mailAlertPause ?? {}) };
      if (pause) all[uid] = pause;
      else delete all[uid];
      settings.update({ mailAlertPause: all });
    },
    accept: async (a) => {
      const decision = await notifications.mailAccept(a);
      let sound = true;
      if (!decision.alert || !await notifications.requestAttention(`mail:${a.mailbox}:${a.uid}`, `mail:${a.mailbox}:${a.uid}`, (enabled) => { sound = enabled; })) return { alert: false, breakthrough: false };
      return { ...decision, sound };
    },
    dismiss: (a) => { void http.post('/api/notifications/devices/dismiss', { contextKey: `mail:${a.mailbox}:${a.uid}` }).catch(() => {}); },
    changed: () => {
      emitStatus();
      sendTo(windows.getMain(), 'mail-alert:state', mailAlerts.state());
    },
  });
  notifications.mailArrivals = (rows, quiet) => mailAlerts.ingestListed(rows, quiet);
  // SalonMate's front desk, while WorkSuite is out of reach: the day's copy and the outbox.
  const salonSync = new SalonSync({
    db,
    vault: getVault,
    http,
    origin: () => auth.getServer()?.origin ?? null,
    user: () => (sessionCtl.isReady() ? sessionCtl.userId() : null),
    desk: () => salonDesk.pairing(),
    deskKey: () => salonDesk.keyFor('/api/salon/v1/'),
    caps: () => {
      const c = sessionCtl.capabilities();
      return { offlineCache: c.offlineCache, offlineQueue: c.offlineQueue };
    },
    appVersion: app.getVersion(),
    notify: (n) => notifications.notify({ ...n, module: 'salon', category: null, sender: 'SalonMate', critical: false }),
    changed: () => {
      broadcast('salon:changed');
      emitStatus();
    },
  });
  // What the person may open stays current: on `access.changed`, and every ten minutes while signed in and online.
  const accessWatch = new AccessWatch({ refresh: () => sessionCtl.refreshBootstrap(), ready: () => sessionCtl.isReady(), online: () => apiReachable });

  // Hashing runs in a supervised utility process (FR-DIAG-07).
  type Hashed = { sha256: string; bytes: number; blocks?: string[] };
  const hashWaiters = new Map<string, { resolve: (v: Hashed) => void; reject: (e: Error) => void }>();
  supervisor.onHealth = () => emitStatus();
  supervisor.start({
    name: 'hash-worker',
    entry: join(__dirname, 'hash-worker.js'),
    onMessage: (msg) => {
      const m = msg as { type?: string; id?: string; ok?: boolean; sha256?: string; bytes?: number; blocks?: string[]; error?: string };
      if (m.type !== 'hash' || !m.id) return;
      const w = hashWaiters.get(m.id);
      if (!w) return;
      hashWaiters.delete(m.id);
      if (m.ok && m.sha256) w.resolve({ sha256: m.sha256, bytes: m.bytes ?? 0, blocks: m.blocks });
      else w.reject(new Error(m.error ?? 'hashing failed'));
    },
  });
  const hashWith = (type: 'hash' | 'blocks', path: string) =>
    new Promise<Hashed>((resolveHash, reject) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      hashWaiters.set(id, { resolve: resolveHash, reject });
      if (!supervisor.post('hash-worker', { type, id, path })) {
        hashWaiters.delete(id);
        reject(new Error('The hashing helper is not running.'));
      }
    });
  const hash = (path: string) => hashWith('hash', path);

  const transfers: TransferManager = new TransferManager({
    // A Personal account's storage is full: the upload waits, and Cloud asks for the usage more often (§3).
    onQuotaHeld: () => accountsWiring?.cloud.quotaExceeded(),
    db,
    vault: getVault,
    http: bulkHttp,
    userId: () => sessionCtl.userId(),
    downloadFolder: () => settings.effective().downloadFolder,
    hash,
    canOpenFiles: () => sessionCtl.hasPermission('desktop.files.open_external'),
    audit: (action, details) => audit.record(sessionCtl.userId(), action, details),
    // eLearning's offline copies are kept inside the app, sealed as they arrive.
    sink: (name): DownloadSink | null => elearning.sink(name),
    // An attachment saved from mail carries the system's "from the internet" mark (ENH-MAIL-03 DMO-SEC-04).
    downloaded: (path, source) => {
      if (!source.startsWith('/api/mail/messages/')) return;
      return markFromInternet(path).then(async () => {
        // Kept in the local mail store too, so the next open is instant and works offline (#163).
        const key = attachmentStorePathOf(source);
        const user = sessionCtl.userId();
        if (!key || !user || cache.has(user, key)) return;
        const info = await fsp.stat(path).catch(() => null);
        if (!info || info.size > mailAttachmentKeepMax()) return;
        mailMedia.keepDownloaded(user, key, mimeFor(path) ?? 'application/octet-stream', await fsp.readFile(path));
      });
    },
    // A mail attachment already kept here opens from the store, also offline (#163).
    localCopy: (source) => {
      const key = attachmentStorePathOf(source);
      const user = sessionCtl.userId();
      return key && user ? (mailMedia.localAttachment(user, key)?.bytes ?? null) : null;
    },
    hasLocalCopy: (source) => {
      const key = attachmentStorePathOf(source);
      const user = sessionCtl.userId();
      return !!key && !!user && cache.has(user, key);
    },
    // Every module's PDFs open in PDF Studio, never in another application.
    openInApp: (path) => {
      if (!/\.pdf$/i.test(path)) return false;
      handPdfs([path]);
      return true;
    },
    // Drive › Settings › Notifications: a transfer the person started says when it has finished or failed.
    notify: (t, how) => {
      const d = settings.effective().drive;
      if (how === 'done' ? !d.notifyComplete : !d.notifyFailed) return;
      const what = t.direction === 'upload' ? 'Upload' : 'Download';
      notifications.notify({
        id: `transfer:${t.id}:${how}`,
        module: 'transfers',
        title: how === 'done' ? `${what} finished` : `${what} failed`,
        body: how === 'done' ? t.name : `${t.name}: ${t.error ?? 'it did not finish.'}`,
        sender: null,
        link: null,
        critical: false,
      });
    },
  });
  // Drive › Settings (worksuite-desktop#95): limits, caps and retries apply as soon as they change, without a restart.
  transfers.configure(queueConfig(settings.effective().drive));
  settings.onChange((prefs) => transfers.configure(queueConfig(prefs.drive)));
  transfersOnline = (ok) => transfers.setOnline(ok);
  // Meetings recorded on this computer (worksuite-desktop#68): written, finished and uploaded here, in the background.
  const meetRecorder = new MeetRecorder({
    db,
    http,
    transfers,
    prefs: () => settings.effective().meetRecording,
    userId: () => (sessionCtl.isReady() ? sessionCtl.userId() : null),
    // The server tells the owner about cloud recordings; one made here is told from here (worksuite-desktop#89).
    // A recording without macOS Screen Recording permission is empty (worksuite-desktop#240). Never asked yet: listing
    // the screens once has macOS ask, and puts WorkSuite in System Settings' list to turn on.
    screenAccess: async () => {
      if (process.platform !== 'darwin' || (!app.isPackaged && process.env.WS_E2E_FAKE_MEDIA)) return 'not_required';
      let status = systemPreferences.getMediaAccessStatus('screen');
      if (status === 'not-determined') {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => undefined);
        status = systemPreferences.getMediaAccessStatus('screen');
      }
      return status === 'granted' ? 'granted' : 'missing';
    },
    notify: (r, how) =>
      notifications.notify({
        id: `meetrec:${r.id}:${how}`,
        module: 'meet',
        title: how === 'ready' ? 'Your recording is ready to play' : 'Your recording could not be finished',
        body: how === 'ready' ? `${r.title} is in your Drive.` : `${r.title}: ${r.error ?? 'it could not be finished.'}`,
        sender: null,
        link: how === 'ready' && r.driveFileId ? `/files?file=${r.driveFileId}&play=1` : '/meet',
        critical: false,
      }),
  });
  meetRecorder.onChanged = (list) => broadcast('meetrec:changed', list);
  // Speech to text on this computer (worksuite-desktop#81): whisper.cpp in a hidden page, with the person's model.
  const speech = new SpeechService({ dir: join(p.profile, 'LocalAI', 'speech'), preload: join(__dirname, '../preload/index.js'), get: (path) => http.get(path) });
  // eLearning: a course's lessons kept for offline learning, as the server's manifest lists them.
  const elearning: ElearningOffline = new ElearningOffline({
    db,
    vault: getVault,
    http,
    transfers,
    root: () => accountPaths().elearning,
    userId: () => (sessionCtl.isReady() ? sessionCtl.userId() : null),
    allowed: () =>
      sessionCtl.capabilities().offlineCache
        ? { ok: true, reason: null }
        : { ok: false, reason: 'Your organization does not allow WorkSuite data to be kept offline on this computer.' },
    changed: () => broadcast('elearning:offlineChanged'),
  });
  // WorkSuite Board: meeting packs kept offline in an encrypted vault, its queue and offline circular responses.
  const board = new BoardVault({
    http,
    download: async (path, headers) => {
      const res = await http.raw('GET', http.url(path), { headers });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    },
    secrets,
    root: () => join(accountPaths().dir, 'board'),
    userId: () => (sessionCtl.isReady() ? String(sessionCtl.userId()) : null),
    deviceId: () => device.current()?.id ?? null,
    deviceName: () => `WorkSuite Desktop (${platformName()})`,
    platform: () => platformName(),
    allowed: () =>
      sessionCtl.capabilities().offlineCache
        ? { ok: true, reason: null }
        : { ok: false, reason: 'Your organization does not allow WorkSuite data to be kept offline on this computer.' },
    changed: () => broadcast('board:vaultChanged'),
  });
  // WorkSuite Events' desk: this computer as a check-in device at an event, its key, offline copy and queue.
  const eventDesk = new EventDesk({
    db,
    vault: getVault,
    http,
    secrets,
    origin: () => auth.getServer()?.origin ?? null,
    // Nothing is sent, caught up or scanned for someone who does not have the Events app.
    user: () => (sessionCtl.isReady() && canOpenApp('events', sessionCtl.visibleApps()) ? sessionCtl.userId() : null),
    deviceRef: () => device.current()?.id ?? null,
    platform: platformName() as 'windows' | 'macos' | 'linux',
    appVersion: app.getVersion(),
    caps: () => {
      const c = sessionCtl.capabilities();
      return { offlineCache: c.offlineCache, offlineQueue: c.offlineQueue };
    },
    notify: (n) => notifications.notify({ ...n, module: 'events', category: 'events', sender: 'Events', critical: false }),
    changed: (eventId) => {
      broadcast('eventdesk:changed', { event_id: eventId });
      emitStatus();
    },
  });
  const eventDeskPrint = new EventDeskPrint({ config: db, http, origin: () => auth.getServer()?.origin ?? null });
  // POS: this computer as a paired till — its credential, catalogue copy, sales outbox, printer, customer display.
  const pos = createPos({
    db,
    vault: getVault,
    secrets,
    http,
    windows,
    origin: () => auth.getServer()?.origin ?? null,
    cashier: () => {
      const id = Number(sessionCtl.isReady() ? sessionCtl.userId() : NaN);
      return Number.isInteger(id) && id > 0 ? { id, name: sessionCtl.get().user?.name ?? null } : null;
    },
    allowed: () => sessionCtl.isReady() && canOpenApp('pos', sessionCtl.visibleApps()),
    caps: () => {
      const c = sessionCtl.capabilities();
      return { offlineCache: c.offlineCache, offlineQueue: c.offlineQueue };
    },
    installId: () => device.installId(),
    device: () => ({ name: device.deviceName(), info: `WorkSuite Desktop on ${platformName()}` }),
    appVersion: app.getVersion(),
    changed: () => {
      broadcast('pos:changed');
      emitStatus();
    },
    // The products' small pictures, kept for the till's grid offline (worksuite-desktop#296).
    thumbsDir: () => accountPaths().posThumbs,
  });

  // The Phone (WS-VOIP-SRS-001): its switch's WebSocket in the page policy, the compact phone's global shortcuts and
  // calls as native notifications. The SIP phone itself runs in the main window's page.
  const phone = new PhoneService({
    config: db,
    http,
    allowed: () => sessionCtl.isReady() && canOpenApp('phone', sessionCtl.visibleApps()),
    notify: (n) => notifications.notify(n),
    bell: (item) => void notifications.addLocal(item),
    mainWindow: () => windows.getMain(),
  });

  // Hotel PMS door locks: the on-site lock server this front desk talks to (its secret only in the OS keystore).
  const pmsLocks = new PmsLocks({
    config: db,
    secrets,
    origin: () => auth.getServer()?.origin ?? null,
    allowed: () => sessionCtl.isReady() && canOpenApp('pms', sessionCtl.visibleApps()),
  });

  // Contacts: iCloud, CardDAV and Mac Contacts synced from this computer (worksuite-desktop#175); passwords only in the OS keystore.
  const contactSync = new ContactSync({
    http,
    fetch: fetchImpl,
    secrets,
    origin: () => auth.getServer()?.origin ?? null,
    allowed: () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('contacts', sessionCtl.visibleApps()),
    deviceId: () => device.installId(),
  });
  contactSync.start();

  // Restaurant Manager: this computer as a paired terminal — its key, menu and floor copy, outbox and print agent.
  const restaurant = createRestaurant({
    db,
    vault: getVault,
    http,
    secrets,
    origin: () => auth.getServer()?.origin ?? null,
    user: () => (sessionCtl.isReady() && canOpenApp('restaurant', sessionCtl.visibleApps()) ? sessionCtl.userId() : null),
    caps: () => {
      const c = sessionCtl.capabilities();
      return { offlineCache: c.offlineCache, offlineQueue: c.offlineQueue };
    },
    appVersion: app.getVersion(),
    notify: (n) => notifications.notify({ ...n, module: 'restaurant', category: null, sender: 'Restaurant', critical: false }),
    changed: () => {
      broadcast('restaurant:changed');
      emitStatus();
    },
  });

  // Label Studio: this computer as a print host for the signed-in person, and the Print Gateway (tray mode, SRS Q-03).
  const label = createLabel({
    config: db,
    http,
    secrets,
    origin: () => auth.getServer()?.origin ?? null,
    active: () => sessionCtl.isReady() && canOpenApp('label', sessionCtl.visibleApps()),
    installId: () => device.installId(),
    userData: app.getPath('userData'),
    version: app.getVersion(),
    headless: startedAsGateway(),
    setHeadless: (on) => setGatewayAutostart(on, settings.effective()),
    autostart: gatewayAutostart,
    changed: (which) => broadcast(which === 'host' ? 'label:changed' : 'labelGateway:changed'),
  });

  // Drive sync (Phase 2): chosen Drive folders kept in step with folders here.
  const syncAllowed = (): { ok: boolean; reason: string | null } => {
    const b = sessionCtl.current();
    if (!b || !sessionCtl.isReady()) return { ok: false, reason: 'Sign in to WorkSuite to sync Drive folders.' };
    const why = syncRefusal(b.policy, device.getTrust(), device.getClassification());
    if (why) return { ok: false, reason: why };
    // `features.fileSync` (desktop settings): with the security policy above, the stricter wins.
    if (!desktopSettings.feature('fileSync')) return { ok: false, reason: desktopSettings.effective()['features.fileSync']?.locked ? 'Your organization has turned Drive sync off in WorkSuite Desktop.' : 'Drive sync is turned off in Settings › Features & apps.' };
    if (!sessionCtl.hasPermission('desktop.files.sync')) return { ok: false, reason: 'Drive sync on the desktop is not part of your role.' };
    return { ok: true, reason: null };
  };
  const sync = new DriveSync({
    db,
    http,
    platform: process.platform,
    userId: () => sessionCtl.userId(),
    userName: () => sessionCtl.get().user?.name ?? '',
    deviceToken: () => device.deviceToken(),
    allowed: syncAllowed,
    removableAllowed: () => sessionCtl.current()?.policy.removable_media_sync === true,
    hash,
    hashBlocks: async (path) => {
      const h = await hashWith('blocks', path);
      return { sha256: h.sha256, bytes: h.bytes, blocks: h.blocks ?? [] };
    },
    trash: (path) => shell.trashItem(path),
    info: () => ({ app_version: `WorkSuite Desktop ${app.getVersion()}`, os_version: `${os.type()} ${os.release()}`, hostname: os.hostname() }),
    audit: (action, details) => audit.record(sessionCtl.userId(), action, details),
    protectedPaths: () => [p.userData],
    uploaded: (e) => void imageLocal.uploaded(e).catch(() => undefined),
    conflicted: (e) => void imageLocal.conflicted(e).catch(() => undefined),
  });
  // The image editor on this computer (Drive ENH-03): offline edits wait in sidecars until sync sends their bytes.
  const imageLocal = new ImageLocal({
    root: () => join(p.userData, 'image-edits'),
    tmp: () => os.tmpdir(),
    userId: () => (sessionCtl.isReady() ? sessionCtl.userId() : null),
    locate: (fileId) => sync.localFile(fileId),
    kick: () => sync.kick('image-edit'),
    postRecipe: async (fileId, body) => {
      await http.post(`/api/drive/image/${fileId}/recipe`, body);
    },
    write: writeImageAtomically,
    openPath: (path) => shell.openPath(path),
    changed: (e) => broadcast('image:localChanged', e),
  });
  sync.onChanged = (s) => {
    broadcast('sync:changed', s);
    void imageLocal.retry().catch(() => undefined);
  };

  // Office documents (WorkSuite Drive — ONLYOFFICE SRS §7): the editor in a tab, isolated in a partition of
  // its own, and copies opened in Word, Excel, PowerPoint or the default app, taken back only on request.
  const office = new OfficeEditorHost({
    preload: join(__dirname, '../preload/office.js'),
    serverOrigin: () => auth.getServer()?.origin ?? null,
    allowInsecureLocal: allowInsecure,
    devTools: !app.isPackaged || process.argv.includes('--diagnostics-devtools'),
    platform: process.platform,
    // A window or the app going away with a document open: the session is ended for it (the Document Server saves anyway).
    endSession: (fileId, sessionId) =>
      void http.request('DELETE', `/api/files/${fileId}/office/session/${sessionId}`, { query: { reason: 'CLOSED' }, timeoutMs: 5000 }).catch(() => undefined),
    configureSession: (ses) => {
      if (proxyConfig) void ses.setProxy(proxyConfig);
    },
    dark: () => nativeTheme.shouldUseDarkColors,
  });
  office.install();
  nativeTheme.on('updated', () => office.setTheme(nativeTheme.shouldUseDarkColors));
  // Office files on this computer for WorkSuite DOC / Sheet / Slides tabs (office-local.ts): handles, never paths.
  const officeFiles = new OfficeLocalFiles({ forbidden: () => [p.userData] });
  const officeLocal = new OfficeExternal({
    onQuota: () => accountsWiring?.cloud.quotaExceeded(),
    db,
    vault: getVault,
    http,
    userId: () => (sessionCtl.isReady() ? sessionCtl.userId() : null),
    platform: process.platform,
    home: app.getPath('home'),
    canOpenFiles: () => sessionCtl.hasPermission('desktop.files.open_external'),
    syncedPath: (fileId) => {
      const at = sync.locate({ fileId });
      return at?.isFile ? at.path : null;
    },
    download: async (fileId, name, then) => {
      await transfers.download(`/api/files/${fileId}/download`, name, false, String(fileId), then);
    },
    uploadNew: async (path, name, folderId) => {
      const [picked] = await transfers.register([path]);
      if (!picked) throw new DesktopError('NOT_FOUND', 'The copy on this computer was moved or deleted.');
      await transfers.upload([picked.handle], { kind: 'files', folderId: folderId === null ? null : String(folderId), name });
    },
    openPath: (path) => shell.openPath(path),
    audit: (action, details) => audit.record(sessionCtl.userId(), action, details),
    onChanged: (copies) => broadcast('office:localChanged', copies),
  });

  // Sinhala Tools (Sinhala Tools blueprint §6): the engine here and in a worker, the profile cache, the clipboard key, fonts.
  const sinhalaWaiters = new Map<string, { resolve: (v: { stats: DocxConvertStats; bytes?: Uint8Array }) => void; reject: (e: Error) => void }>();
  supervisor.start({
    name: 'sinhala-worker',
    entry: join(__dirname, 'sinhala-worker.js'),
    onMessage: (msg) => {
      const m = msg as { type?: string; id?: string; ok?: boolean; stats?: DocxConvertStats; bytes?: Uint8Array; error?: string };
      if (m.type !== 'docx' || !m.id) return;
      const w = sinhalaWaiters.get(m.id);
      if (!w) return;
      sinhalaWaiters.delete(m.id);
      if (m.ok && m.stats) w.resolve({ stats: m.stats, bytes: m.bytes });
      else w.reject(new DesktopError('INTERNAL', m.error ?? 'The document could not be converted.'));
    },
  });
  const sinhala: SinhalaService = new SinhalaService({
    http: {
      get: (path, opts) => http.get(path, opts),
      post: (path, body) => http.post(path, body),
      download: async (path) => {
        const res = await http.raw('GET', http.url(path));
        if (!res.ok) throw new DesktopError('SERVER_ERROR', `The font could not be downloaded (${res.status}).`, res.status);
        return Buffer.from(await res.arrayBuffer());
      },
    },
    config: db,
    scope: () => (sessionCtl.isReady() && sessionCtl.userId() ? `${registry.activeId() ?? auth.getServer()?.origin ?? ''}:${sessionCtl.userId()}` : null),
    online: () => apiReachable,
    locked: () => lock.isLocked(),
    clipboard: { readText: () => clipboard.readText(), writeText: (t) => clipboard.writeText(t) },
    shortcuts: { register: (acc, fn) => globalShortcut.register(acc, fn), unregister: (acc) => globalShortcut.unregister(acc) },
    toast: (kind, text) => {
      broadcast('toast', { kind, text });
      // From another app (the key), the person is not looking at WorkSuite: a system notification says it too.
      if (!BrowserWindow.getFocusedWindow() && Notification.isSupported()) new Notification({ title: 'Sinhala Tools', body: text, silent: true }).show();
    },
    changed: () => {
      broadcast('sinhala:changed');
      tray.update({ sinhala: sinhala.available() ? { shortcut: sinhala.status().shortcutHeld } : null });
    },
    docx: (req: SinhalaDocxRequest) =>
      new Promise((resolveDocx, reject) => {
        const id = randomUUID();
        sinhalaWaiters.set(id, { resolve: resolveDocx, reject });
        if (!supervisor.post('sinhala-worker', { type: 'docx', id, ...req })) {
          sinhalaWaiters.delete(id);
          reject(new DesktopError('INTERNAL', 'The Sinhala conversion helper is not running. Try again in a moment.'));
        }
      }),
    offlinePath: (fileId) => officeLocal.localPath(fileId),
    uploadVersion: async (fileId, path, name) => {
      const form = new FormData();
      form.set('file', await fsp.readFile(path).then((b) => new Blob([b as BlobPart])), name);
      const res = await http.raw('POST', http.url(`/api/files/${fileId}/versions`), { body: form, timeoutMs: 15 * 60_000 });
      if (res.status === 409) return 'conflict';
      const body = (await res.json().catch(() => null)) as { message?: string; data?: { current?: { version?: number } } } | null;
      if (!res.ok) throw new DesktopError(res.status === 404 ? 'NOT_FOUND' : res.status >= 500 ? 'SERVER_ERROR' : 'INTERNAL', body?.message ?? `The server answered ${res.status}.`, res.status);
      return { version: Number(body?.data?.current?.version ?? 0) || null };
    },
    uploadNew: async (path, name) => {
      const [picked] = await transfers.register([path]);
      if (!picked) throw new DesktopError('NOT_FOUND', 'The converted copy was moved or deleted.');
      await transfers.upload([picked.handle], { kind: 'files', folderId: null, name });
    },
    pickFiles: async (sender) => {
      const win = BrowserWindow.fromWebContents(sender);
      const opts: Electron.OpenDialogOptions = { title: 'Convert a document', filters: [{ name: 'Word documents', extensions: ['docx'] }], properties: ['openFile', 'multiSelections'] };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return res.canceled ? [] : res.filePaths;
    },
    reveal: (path) => shell.showItemInFolder(path),
    fetch: (url) => fetchImpl(url, { method: 'GET' }),
    fonts: { platform: process.platform, home: app.getPath('home'), localAppData: process.env.LOCALAPPDATA ?? null },
    run: (file, args) =>
      new Promise<void>((resolveRun, reject) => {
        execFileCb(file, args, { timeout: 60_000, windowsHide: true }, (err) => (err ? reject(err) : resolveRun()));
      }),
    keys: UPDATE_CENTER_RELEASE_KEYS,
    ed25519Key,
  });

  let activeCall = false;
  // Updates wait while a call is on (FR-UPD); the call windows say when.
  calls.onActiveChanged = (a) => {
    activeCall = a;
    onUpdateActivity();
  };
  calls.onListChanged = (list) => broadcast('calls:changed', list);
  // What an update must not interrupt (#205): a meeting, a call (chat, website visitor), a screen share, remote control.
  const updateActivity = (): UpdateActivity => {
    const list = calls.list();
    return {
      meeting: list.some((c) => c.kind === 'meet'),
      call: activeCall || list.some((c) => c.kind === 'call') || webchatCallLive,
      screenShare: screenShare.isSharing(),
      remoteControl: !!remoteControl.view().session,
    };
  };
  screenShare.onSharingChanged = () => onUpdateActivity();
  const busy = (): BusyReport => {
    const id = sessionCtl.userId();
    const c = transfers.activeCounts();
    const running = c.uploads + c.downloads > 0 ? transfers.list().filter((t) => t.state === 'running' || t.state === 'queued') : [];
    return {
      uploads: c.uploads,
      downloads: c.downloads,
      pendingMutations: id ? queue.pendingCount(id) : 0,
      drafts: id ? queue.draftCount(id) : 0,
      activeCall,
      activity: updateActivity(),
      details: {
        calls: calls.list().map((x) => ({ kind: x.kind, title: x.title })),
        transfers: running.slice(0, 5).map((t) => ({ name: t.name, direction: t.direction === 'upload' ? 'upload' : 'download', percent: t.total > 0 ? Math.min(100, (t.bytes / t.total) * 100) : 0 })),
        draftModules: id ? queue.draftModules(id) : {},
      },
    };
  };

  // Before an update's restart every window saves its drafts and tabs (`update:prepare` → `updates:prepared`).
  const prepareWaits = new Map<string, () => void>();
  const updatePrepared = (token: string): void => {
    prepareWaits.get(token)?.();
  };
  const prepareRestart = async (): Promise<void> => {
    const token = Math.random().toString(36).slice(2, 12);
    const answered = new Promise<void>((resolve) => prepareWaits.set(token, resolve));
    broadcast('update:prepare', { token });
    // The main window answers once its drafts and tabs are written; secondary windows get a moment more.
    await Promise.race([answered, new Promise((r) => setTimeout(r, 5_000))]);
    await new Promise((r) => setTimeout(r, 400));
    prepareWaits.delete(token);
  };

  const updateHistory = new UpdateHistory(p.updates);
  const updateHealth = new UpdateHealth(p.updates);
  const updateNotifier: UpdateNotifier = new UpdateNotifier({
    store: { get: (k) => appDb.getConfig(k), set: (k, v) => appDb.setConfig(k, v) },
    now: () => new Date(),
    activity: updateActivity,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return t;
    },
    clear: (h) => clearTimeout(h as NodeJS.Timeout),
    onChange: () => updater.publish(),
    // A meeting, call, share or remote control ended: a held notice goes out now.
    announce: () => announceUpdate(updater.get()),
  });

  // One notification path (electron/updater/notice.ts): once per version and stage, a system notification and a
  // bell entry. Quiet hours, paused notifications and development builds stay silent (the title-bar icon still
  // shows); a meeting, call, screen share or remote control holds it until it ends.
  const announceUpdate = (s: UpdateStatus): void => {
    const p = settings.effective();
    announce(s, {
      autoDownload: p.autoUpdate !== false,
      held: () => updateNotifier.quietReason() !== null,
      silent: () => !app.isPackaged || (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, new Date())) || notifications.pausedUntilIso() !== null,
      systemEnabled: () => p.notificationsEnabled && p.updateNotifications !== false && Notification.isSupported(),
      told: { get: () => appDb.getConfig<string[]>('update_notices') ?? [], set: (keys) => appDb.setConfig('update_notices', keys) },
      show: (n) => {
        // What's new under the body; View What's New is the click, and Update Now a button where the system has them (macOS).
        const note = new Notification({
          title: n.title,
          body: noticeText(n),
          urgency: n.critical ? 'critical' : 'normal',
          timeoutType: n.critical ? 'never' : 'default',
          actions: n.action === 'update' ? [{ type: 'button', text: 'Update Now' }] : [],
        });
        note.on('click', () => navigate({ route: '/settings/updates', source: 'notification' }));
        note.on('action', () => updateNow());
        note.show();
      },
      bell: (n) => {
        notifications.addLocal({ id: `update:${n.key}`, title: n.title, body: n.body, link: '/settings/updates' });
        emitStatus();
      },
    });
  };

  let lastTray = '';
  const updater: UpdaterService = new UpdaterService({
    openPath: (path) => shell.openPath(path),
    fetch: fetchImpl,
    platform: platformName(),
    arch: archName(),
    responseKeys: UPDATE_CENTER_RESPONSE_KEYS,
    // The WorkSuite Update Center decides (a tenant policy there wins over the
    // channel asked for). WS_UPDATE_CENTER points a development build at a
    // local or staging Update Center.
    updateUrl: (channel, opts) =>
      updateCheckUrl({
        base: (allowInsecure && process.env.WS_UPDATE_CENTER) || UPDATE_CENTER_URL,
        version: app.getVersion(),
        platform: platformName(),
        arch: archName(),
        installType: ucInstallType(platformName(), platformName() === 'linux' ? linuxInstallKind() : null),
        channel,
        installId: device.installId(),
        osVersion: process.getSystemVersion(),
        allowDowngrade: opts?.allowDowngrade,
      }),
    channel: () => settings.effective().updateChannel,
    // Organisation policy (signed bootstrap policy, #205): which channels people may pick.
    channels: () => {
      const pol = sessionCtl?.current()?.policy ?? null;
      return { allowed: allowedChannels(pol), lockReason: channelLockReason(pol) };
    },
    savedChannel: () => settings.raw().updateChannel,
    autoDownload: () => settings.effective().autoUpdate !== false,
    installOnQuit: () => settings.effective().updateInstallOnQuit !== false,
    activity: updateActivity,
    busy,
    deadlineHours: () => sessionCtl.current()?.policy.forced_update_deadline_hours ?? 24,
    allowInsecure,
    updatesDir: p.updates,
    onStatus: (s) => {
      broadcast('update:changed', s);
      // The tray menu is rebuilt only when its update lines change (the download reports progress often).
      const t = { updateReady: s.state === 'STAGED', update: trayUpdate(s) };
      const key = JSON.stringify(t);
      if (key !== lastTray) {
        lastTray = key;
        tray.update(t);
      }
      announceUpdate(s);
    },
    schema: () => (db.migratedFrom > 0 && db.migratedFrom !== db.version ? { from: db.migratedFrom, to: db.version } : null),
    onWarning: (text) => broadcast('toast', { kind: 'warning', text }),
    prepareRestart,
    beforeQuit: async () => {
      // WF-26 step 6: queues and drafts are already durable; pause transfers cleanly.
      transfers.stopAll();
    },
    history: updateHistory,
    health: updateHealth,
    notifier: updateNotifier,
  });
  onUpdateActivity = () => {
    updateNotifier.activityChanged();
    void updater.workChanged();
  };

  // The tray's update lines (worksuite-desktop: Updates & License): on offer, ready, or required by a deadline.
  const trayUpdate = (s: UpdateStatus): TrayUpdate | null => {
    if (s.required) return { kind: 'required', version: s.availableVersion, deadline: s.mandatory?.deadline ?? null };
    if (s.state === 'STAGED') return { kind: 'ready', version: s.availableVersion, deadline: null };
    if (s.availableVersion && (s.state === 'AVAILABLE' || s.state === 'DOWNLOADING' || s.state === 'VERIFIED')) return { kind: 'available', version: s.availableVersion, deadline: null };
    return null;
  };
  // Update Now (tray, notification): restart when ready — asking in the window over work in progress — else download.
  const updateNow = (): void => {
    const s = updater.get();
    if (s.state === 'STAGED') void updater.install(false).then((r) => !r.started && navigate({ route: '/settings/updates', source: 'tray' }));
    else {
      void updater.downloadNow();
      navigate({ route: '/settings/updates', source: 'tray' });
    }
  };
  // A required update's countdown in the tray menu, kept current.
  setInterval(() => {
    if (updater.get().required) tray.update({});
  }, 60_000).unref?.();
  // Settings › Updates › Install automatically when idle: 02:00–04:00, the computer idle, nothing to interrupt.
  setInterval(() => {
    const prefs = settings.effective();
    if (!prefs.updateInstallWhenIdle || updater.get().state !== 'STAGED') return;
    // Nothing would be interrupted (drafts and queued changes are kept), so it installs without asking.
    if (idleInstallDue(new Date(), powerMonitor.getSystemIdleTime(), busy())) void updater.install(true);
  }, 5 * 60_000).unref?.();

  const updateDiagnostics = async (): Promise<UpdateDiagnostics> => {
    const s = updater.get();
    const pol = sessionCtl?.current()?.policy ?? null;
    const prefsNow = settings.effective();
    const platform = platformName();
    const installType = !app.isPackaged
      ? 'development build'
      : platform === 'windows'
        ? 'NSIS per-user'
        : platform === 'macos'
          ? 'app bundle'
          : (() => {
              // How this copy updates (worksuite-desktop#345): "Installed as: .deb package".
              const kind = linuxInstallKind();
              return kind === 'appimage' ? 'AppImage' : kind === 'deb' ? '.deb package' : kind === 'rpm' ? '.rpm package' : 'unknown package';
            })();
    const boot = sessionCtl?.current() ?? null;
    return runUpdateDiagnostics({
      now: () => new Date(),
      host: new URL((allowInsecure && process.env.WS_UPDATE_CENTER) || UPDATE_CENTER_URL).host,
      probe: () => updater.probe(),
      version: app.getVersion(),
      platform,
      arch: archName(),
      installType,
      required: s.required ? { minimum: s.minimumVersion } : null,
      channel: { label: CHANNEL_INFO[s.channel].label, source: channelSource(pol, !!settings.raw().updateChannelChosen), fallback: !!s.channelFallback },
      freeBytes: () => updater.freeBytes(),
      installWritable: () => updater.installWritable(),
      database: () => {
        try {
          return { result: db.integrityCheck(), schema: db.version };
        } catch (e) {
          return { result: String((e as Error)?.message ?? e), schema: null };
        }
      },
      license: () => ({ signedIn: sessionCtl?.isReady() ?? false, offline: !!boot?.offline, lastVerifiedAt: boot?.cachedAt ?? null }),
      // A .deb/.rpm install's package repository (worksuite-desktop#351): "Not set up yet" unless the build uses it.
      ...(platform === 'linux' && app.isPackaged ? { repo: (latest: string | null) => updater.repoDiagnostics(latest) } : {}),
    }).then((r) => {
      updateHistory.add('diagnostics', { detail: r.checks.map((c) => `${c.id}:${c.status}`).join(' '), channel: prefsNow.updateChannel });
      return r;
    });
  };
  // ⌃⌥R (Ctrl+Alt+R): the quick-reply window on my latest ticket, from any app (D-05). Held while signed in with the
  // desk and unlocked, unless turned off in Notification settings › Support.
  let supportKeyHeld = false;

  const { chequeStation, desktopAccounts, flushNavigation, handleDeepLink, liveMeetWindow, meetAction, meetingsDesk, navigate, officeAiPolicy, officeApp, officeSignIn, openAiChanges, openLink, openNextContact, openQuickReply, pendingNav, projects, purchaseDesk, quickLatest, salesDesk, supportDesk, supportNotices, supportUrgent, syncSupportKeys } = wireNavigation({
    audit, auth, calls, db, desktopSettings, device, getVault, globalKeysOn, http, localSession, lock, log, mailAlerts, notifications, p, queue,
    registry, setLinkHandler, settings, trustedNow, windows,
    // Read when used, not now: set later, or reassigned.
    get accountsService() { return accountsService; },
    get accountsWiring() { return accountsWiring; },
    get emitStatus() { return emitStatus; },
    get openGuest() { return openGuest; },
    get pendingGuest() { return pendingGuest; }, set pendingGuest(v) { pendingGuest = v; },
    get sessionCtl() { return sessionCtl; },
    get supportKeyHeld() { return supportKeyHeld; }, set supportKeyHeld(v) { supportKeyHeld = v; },
    get tray() { return tray; },
  });

  // ── status ─────────────────────────────────────────────────────────────
  let statusTimer: NodeJS.Timeout | null = null;
  // Visitors waiting on me in my website chats (#230), from the ringer: on the Dock and taskbar badge.
  let followUpCount = 0;
  // Website chats and calls ringing for me and not silenced (R-05, R-06; RING-44): on the badge until joined or silenced.
  let ringingCount = 0;

  const { emitStatus, scopeFor, snapshot } = wireStatus({
    accessWatch, boot, calls, connection, db, desktopSettings, lock, mailAlerts, meetingsDesk, navigate, notifications, officeLocal, openLink,
    purchaseDesk, queue, realtime, registry, remoteControl, salesDesk, settings, supervisor, supportDesk, supportNotices, supportUrgent, transfers,
    updater, windows,
    // Read when used, not now: set later, or reassigned.
    get aiPending() { return aiPending; },
    get apiReachable() { return apiReachable; },
    get background() { return background; },
    get followUpCount() { return followUpCount; },
    get health() { return health; },
    get hostingCounts() { return hostingCounts; },
    get realtimeDownSince() { return realtimeDownSince; }, set realtimeDownSince(v) { realtimeDownSince = v; },
    get ringingCount() { return ringingCount; },
    get sessionCtl() { return sessionCtl; },
    get statusTimer() { return statusTimer; }, set statusTimer(v) { statusTimer = v; },
    get tray() { return tray; },
    get vault() { return vault; },
    get webchat() { return webchat; },
  });

  // ── attendance for the tray (FR-TRAY-01 Clock In) ─────────────────────
  let attendanceTimer: NodeJS.Timeout | null = null;
  // ── chat presence (FR-COM-02) ─────────────────────────────────────────
  // The server shows somebody offline 150 s after their last heartbeat, and
  // away after five minutes without input; the web sends one every 30 s.
  let presenceTimer: NodeJS.Timeout | null = null;

  const { attendanceBreak, clock, clockAttendance, heartbeatPresence, refreshAttendance, stopPresence } = wirePresence({
    http, lock, updateActivity, windows,
    // Read when used, not now: set later, or reassigned.
    get presenceTimer() { return presenceTimer; }, set presenceTimer(v) { presenceTimer = v; },
    get sessionCtl() { return sessionCtl; },
    get tray() { return tray; },
  });

  const { quit, refreshTrayPresence, tray } = wireTray({
    calls, clock, emitStatus, http, lock, log, mailAlerts, meetAction, meetingsDesk, meetRecorder, navigate, notifications, openAiChanges,
    openNextContact, openQuickReply, projects, quickLatest, remoteControl, sinhala, supportDesk, updateNow, updater, windows,
    // Read when used, not now: set later, or reassigned.
    get assetsTray() { return assetsTray; }, set assetsTray(v) { assetsTray = v; },
    get hostingTray() { return hostingTray; }, set hostingTray(v) { hostingTray = v; },
    get liveDesk() { return liveDesk; },
    get quickAsk() { return quickAsk; },
    get ringTray() { return ringTray; },
    get sessionCtl() { return sessionCtl; },
    get webchat() { return webchat; },
  });

  // ── website chats ring like calls (electron/main/wiring/webchat.ts) ───────────────────────
  // "Silence for 15 minutes" in the tray (MAP-22): website chats ring without the tone, and at-risk notifications
  // come without sound, until then — as Do not disturb kept to the card would (RING-47). Nothing else is paused.
  let liveSilencedUntil = 0;
  let onCall: WebchatOnCall | null = null;

  const { liveSilenced, ringTray, systemFocus, trayCalls, webchat } = wireWebchat({
    calls, device, emitStatus, http, lock, navigate, notifications, quit, realtime, settings, tray, windows,
    // Read when used, not now: set later, or reassigned.
    get atRisk() { return atRisk; },
    get followUpCount() { return followUpCount; }, set followUpCount(v) { followUpCount = v; },
    get liveDesk() { return liveDesk; },
    get livePulse() { return livePulse; },
    get liveSilencedUntil() { return liveSilencedUntil; }, set liveSilencedUntil(v) { liveSilencedUntil = v; },
    get onCall() { return onCall; },
    get ringingCount() { return ringingCount; }, set ringingCount(v) { ringingCount = v; },
    get sessionCtl() { return sessionCtl; },
    get syncLive() { return syncLive; },
  });

  const { atRisk, liveDesk, livePulse, syncLive, syncLiveKeys, webchatOnCall } = wireLiveDesk({
    globalKeysOn, http, liveSilenced, lock, navigate, notifications, settings, systemFocus, tray, trayCalls, webchat, windows,
    // Read when used, not now: set later, or reassigned.
    get liveSilencedUntil() { return liveSilencedUntil; },
    get onCall() { return onCall; }, set onCall(v) { onCall = v; },
    get onUpdateActivity() { return onUpdateActivity; },
    get sessionCtl() { return sessionCtl; },
    get webchatCallLive() { return webchatCallLive; }, set webchatCallLive(v) { webchatCallLive = v; },
  });

  // ── Quick Ask over any app (AI Assistant) ───────────────────────────────
  // The keyboard helper remote control uses, started once, on first use, for copy and paste only.
  let askHelper: Promise<Injector | null> | null = null;

  const { ai, aiPending, quickAsk } = wireQuickAsk({
    globalKeysOn, http, lock, notifications, settings, sync, tray, windows,
    // Read when used, not now: set later, or reassigned.
    get askHelper() { return askHelper; }, set askHelper(v) { askHelper = v; },
    get sessionCtl() { return sessionCtl; },
  });

  const { callbackReminders, marketingPulse, meetKeys, meetNext, nextContactKey, syncQuickAsk } = wireMarketing({
    calls, globalKeysOn, http, liveMeetWindow, lock, log, meetAction, notifications, openNextContact, quickAsk, settings, syncSupportKeys, tray,
    windows,
    // Read when used, not now: set later, or reassigned.
    get sessionCtl() { return sessionCtl; },
  });

  const { CACHE_PREFIXES, applyAccess, rebuildMenu } = wireAccess({
    board, cache, callbackReminders, desktopSettings, elearning, emitStatus, eventDesk, log, marketingPulse, meetingsDesk, meetKeys, meetNext,
    navigate, nextContactKey, phone, purchaseDesk, quit, restaurant, sinhala, tray, updater, windows,
  });

  const { diagnostics, localAI, mailFiles, meetDiagnostics, ocr, onReconnect, pdfStudio } = wireSession({
    accessWatch, accountPaths, ai, aiPending, appearanceSync, applyAccess, applySpellcheck, assetAlerts, atRisk, audit, auth, board, boot, bootstrap,
    cache, callbackReminders, calls, contactSync, db, desktopAccounts, desktopSettings, device, elearning, emitStatus, enterprise, eventDesk,
    eventDeskPrint, fetchImpl, flushNavigation, heartbeatPresence, hostingAlerts, http, label, livePulse, localSession, lock, lockPin, log,
    mailAlerts, mailBodies, marketingPulse, mediaServers, meetingsDesk, meetKeys, meetNext, meetRecorder, navigate, nextContactKey, notifications,
    office, officeAiPolicy, officeFiles, officeLocal, officeSignIn, p, payrollReminders, pendingMailFiles, pendingNav, pendingOffice, pendingPdfs,
    phone, pmsLocks, pos, projects, purchaseDesk, queue, quickAsk, realtime, rebuildMenu, refreshAttendance, refreshTrayPresence, registry,
    remoteControl, reportCapabilities, restaurant, salesDesk, salonDesk, salonPrint, salonSync, scopeFor, secrets, settings, sinhala, stopPresence,
    supervisor, supportDesk, supportNotices, supportUrgent, sync, syncLiveKeys, syncQuickAsk, syncSupportKeys, transfers, tray, updateHistory,
    updater, webchat, windows,
    // Read when used, not now: set later, or reassigned.
    get accountFollowsSession() { return accountFollowsSession; },
    get attendanceTimer() { return attendanceTimer; }, set attendanceTimer(v) { attendanceTimer = v; },
    get dbKey() { return dbKey; },
    get handMailFiles() { return handMailFiles; }, set handMailFiles(v) { handMailFiles = v; },
    get handOffice() { return handOffice; }, set handOffice(v) { handOffice = v; },
    get handPdfs() { return handPdfs; }, set handPdfs(v) { handPdfs = v; },
    get liveSilencedUntil() { return liveSilencedUntil; }, set liveSilencedUntil(v) { liveSilencedUntil = v; },
    get localAccountKey() { return localAccountKey; },
    get netFetch() { return netFetch; },
    get pdfOnline() { return pdfOnline; }, set pdfOnline(v) { pdfOnline = v; },
    get presenceTimer() { return presenceTimer; }, set presenceTimer(v) { presenceTimer = v; },
    get sessionCtl() { return sessionCtl; }, set sessionCtl(v) { sessionCtl = v; },
    get vault() { return vault; },
    get wasSignedIn() { return wasSignedIn; }, set wasSignedIn(v) { wasSignedIn = v; },
  });

  const { apiHook, apiProxy, cspSources, ctx, localHandler, openGuest, relaunch, router } = wireIpc({
    ai, attendanceBreak, audit, auth, board, boot, bootstrap, busy, cache, CACHE_PREFIXES, calls, chequeStation, clientHeaders, clockAttendance,
    connection, contactSync, db, desktopSettings, device, diagnostics, elearning, emitStatus, eventDesk, eventDeskPrint, fetchImpl, flushNavigation,
    getVault, guests, http, imageLocal, label, liveDesk, local, localAI, localSession, lock, lockPin, log, mailAlerts, mailBodies, mailFiles,
    mailMedia, mediaServers, meetDiagnostics, meetRecorder, navigate, notifications, ocr, office, officeApp, officeFiles, officeLocal,
    onReachability, OS_MODE, p, pdfStudio, phone, pmsLocks, pos, projects, queue, quickAsk, quit, realtime, remoteControl, restaurant, ringTray,
    salesDesk, salonDesk, salonPrint, salonSync, scopeFor, screenShare, secrets, settings, shareBar, sinhala, snapshot, speech, supervisor, sync,
    transfers, tray, updateDiagnostics, updatePrepared, updater, webchat, webchatOnCall, windows,
    // Read when used, not now: set later, or reassigned.
    get openOsSession() { return openOsSession; },
    get activeCall() { return activeCall; }, set activeCall(v) { activeCall = v; },
    get health() { return health; },
    get localAccountKey() { return localAccountKey; }, set localAccountKey(v) { localAccountKey = v; },
    get onUpdateActivity() { return onUpdateActivity; },
    get pendingGuest() { return pendingGuest; }, set pendingGuest(v) { pendingGuest = v; },
    get sessionCtl() { return sessionCtl; },
    get workOffline() { return workOffline; }, set workOffline(v) { workOffline = v; },
  });

  const { accountFollowsSession, accountsService, background, openOsSession, useTokenEndpointFor } = wireAccounts({
    allowInsecure, apiHook, apiProxy, appDb, audit, auth, bindNetwork, bootstrap, brokerCall, cspSources, ctx, db, defaultProfile, device,
    emitStatus, fetchImpl, firstPartitions, healthDeps, http, localHandler, lock, log, mailBodies, officeLocal, OS_MODE, p, prepareWaits, projects,
    proxyConfig, queue, realtime, rebuildMenu, registry, relaunch, router, scopes, screenShare, secrets, settings, sync, syncLiveKeys, syncQuickAsk,
    transfers, trustedNow, updateActivity, updater, vaultKey, webchat, windows,
    // Read when used, not now: set later, or reassigned.
    get accountsWiring() { return accountsWiring; }, set accountsWiring(v) { accountsWiring = v; },
    get apiReachable() { return apiReachable; }, set apiReachable(v) { apiReachable = v; },
    get dbKey() { return dbKey; }, set dbKey(v) { dbKey = v; },
    get health() { return health; }, set health(v) { health = v; },
    get healthFromDiscovery() { return healthFromDiscovery; }, set healthFromDiscovery(v) { healthFromDiscovery = v; },
    get osEndpoint() { return osEndpoint; }, set osEndpoint(v) { osEndpoint = v; },
    get sessionCtl() { return sessionCtl; },
    get vault() { return vault; }, set vault(v) { vault = v; },
  });

  wireLifecycle({
    applyAutostartOnce, atRisk, boot, callbackReminders, calls, db, device, emitStatus, eventDesk, firstAccount, handleDeepLink, label, livePulse,
    lock, log, marketingPulse, meetingsDesk, meetKeys, meetNext, nextContactKey, notifications, office, officeLocal, openOsSession, OS_MODE, p,
    pendingLinks, pos, projects, queue, quickAsk, quit, realtime, remoteControl, restaurant, salonSync, settings, speech, supervisor, sync,
    transfers, tray, updater, useTokenEndpointFor, webchat, windows,
    // Read when used, not now: set later, or reassigned.
    get askHelper() { return askHelper; },
    get handMailFiles() { return handMailFiles; },
    get handOffice() { return handOffice; },
    get handPdfs() { return handPdfs; },
    get sessionCtl() { return sessionCtl; },
    get statusTimer() { return statusTimer; }, set statusTimer(v) { statusTimer = v; },
    get supportKeyHeld() { return supportKeyHeld; },
  });
}

function applyAutostartOnce(settings: SettingsService): void {
  const prefs = settings.effective();
  try {
    applyAutostart(prefs.startWithOs, prefs.startMinimized);
  } catch {
    /* unsupported desktop */
  }
}
