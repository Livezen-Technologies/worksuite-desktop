import { PayrollReminders } from '../services/payroll-reminders';
import { AssetAlerts } from '../services/assets-alerts';
import { assetsCached, type TrayAssets } from '@shared/assets';
import { lockedScope, lockedApi, lockedIpc } from '@shared/locked-access';
import { lockedClickTarget } from '../services/locked-notifications';
import { accessibilityDiagnostics } from '../services/remote-control/accessibility-diagnostics';
import { LocalSession, LocalWorkspace } from '../services/local-workspace';
import { LocalApi } from '../services/local-api';
import { LocalWorkspaceMove, type MoveAccount } from '../services/local-workspace-move';
import { createHash, randomUUID } from 'node:crypto';
import { localize } from '@shared/localization';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { GuestMeetService } from '../services/guest-meet';
import { app, net as electronNet, Notification, clipboard, crashReporter, desktopCapturer, dialog, globalShortcut, ipcMain, nativeTheme, powerMonitor, screen, session, shell, systemPreferences, BrowserWindow, type WebContents, webContents } from 'electron';
import os from 'node:os';
import { hkdfSync } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { canOpenApp, canOpenLink, canOpenRoute, notificationAllowed, visibleAppIds } from '@shared/access';
import { findDeepLinkInArgv, parseDeepLink } from '@shared/deeplink';
import { isOsMode, moduleLinkInArgv } from '@shared/os-mode';
import { isOfficeSignInLink, OFFICE_CLIENT } from '@shared/office-signin';
import { itemApp, itemRoute, looksLikeItemLink, parseItemLink } from '@shared/item-links';
import { linkPrefs } from '@shared/link-prefs';
import { findMailtoInArgv, mailBodiesKept, mailKeptForever, mailListKept, mailtoRoute, parseMailto } from '@shared/mailto';
import { websiteDraftKey, websiteReplyMutation } from '@shared/website-reply';
import { resolveWebLink } from '@shared/links';
import { redirectRoute } from '@shared/channels';
import { networkStatus } from '@shared/network';
import { pmsCached } from '@shared/pms-cache';
import { eventsCached } from '@shared/event-desk';
import { redactUrl } from '@shared/redact';
import { SUPPORT_QUICK_SHORTCUT, quickRoute, ringRoute, supportNoticePrefs } from '@shared/support';
import { FOLLOW_UP_DEFAULTS, type ActiveCall, type Bootstrap, type BusyReport, type UpdateActivity, type UpdateDiagnostics, type NavigateRequest, type RealtimeState, type ServiceHealth, type StatusSnapshot, type UpdateStatus, type WebchatOnCall, type WebchatRingState } from '@shared/types';
import { AccessWatch, NO_ACCESS } from './access';
import { applyAutostart, gatewayAutostart, gatewayPairingArgs, setGatewayAutostart, startedAsGateway, startedHidden } from './autostart';
import { evaluateBoot, markCleanExit, markRunning, clearCrashes, writeBootConfig } from './boot';
import type { AppContext, ClockExtra } from './context';
import { broadcast, guestWindowIds, sendTo } from './events';
import { installAppearance } from '../windows/appearance';
import { AppearanceSync } from '../services/appearance-sync';
import { registerHandlers } from './handlers';
import { cloudOrigin, emitAccounts, installAccounts, type AccountsWiring, policyKeyFor, seedServerConfig, trustedWithEnterprise } from './accounts-wiring';
import type { AccountRecord, ServiceHealthState } from '@shared/accounts';
import type { TrustedConfig } from '@shared/trusted-config';
import type { AuthState } from '@shared/types';
import { appDbPath, openAppDb } from '../services/accounts/app-db';
import { BackgroundAccounts, type BackgroundClient } from '../services/accounts/background';
import { AccountsService, serverInfoOf } from '../services/accounts/handlers';
import { routeLink, withoutServerParam } from '../services/accounts/links';
import { migrateAccounts } from '../services/accounts/migrate';
import { allPartitions, DEFAULT_PROFILE_DIR, partitionDir, partitionsFor, profilePaths } from '../services/accounts/profile';
import { AccountRegistry } from '../services/accounts/registry';
import { processPendingRemovals, queueRemoval, removeAccount, unqueueRemoval } from '../services/accounts/removal';
import { ScopeHolder, ShellSessions } from '../services/accounts/scope';
import { AccountSwitcher, switchModeFrom } from '../services/accounts/switcher';
import { exportUnsyncedZip, pendingCount, unsyncedSummary } from '../services/accounts/unsynced';
import type { TokenEndpoint } from '../services/auth-tokens';
import { netFetchWithRedirects } from '../services/discovery/handlers';
import { HealthMonitor } from '../services/discovery/health';
import { installPinning, type PinsFor } from '../services/discovery/pinning';
import { runDiscovery } from '../services/discovery/pipeline';
import { readTrustedConfig } from '../services/discovery/trusted-config';
import { initLog, logger } from './log';
import { DesktopError, isDesktopError } from './errors';
import { buildMenu } from './menu';
import { paths } from './paths';
import { SessionController, syncRefusal } from './session';
import { IpcRouter } from '../ipc/router';
import { registerAppProtocol } from '../protocols/app-protocol';
import { devOrigin, hardenSession, isTrustedShellUrl, openExternalSafely, registerPrivilegedSchemes, hardenWebContents, setExternalAllowList, setMediaGate } from '../security/hardening';
import { createApiProxy } from '../services/api-proxy';
import { AuditService } from '../services/audit';
import { AuthService, normalizeServerUrl, probeServer, type PublicUser, type SignInPayload } from '../services/auth';
import { DesktopAccountsFile, OfficeSignIn } from '../services/office-signin';
import { OfficeApp } from '../services/office-app';
import { OfficeAiPolicySync } from '../services/office-ai-policy';
import { BootstrapService } from '../services/bootstrap';
import { CallService } from '../services/calls';
import { ScreenShare } from '../services/screen-share';
import { accessibility, createRemoteControl } from '../services/remote-control/host';
import { AX_RESTARTED_ARG, watchAccessibility } from '../services/remote-control/accessibility-watch';
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
import { DiagnosticsService } from '../services/diagnostics';
import { MeetDiagnostics } from '../services/meet-diagnostics';
import { readEnterpriseConfig } from '../services/enterprise';
import { CLIENT_TYPE, CLIENT_TYPE_HEADER, HttpClient, withSafeHeaders, type FetchLike } from '../services/http';
import { createNetFetch } from '../services/net-fetch';
import { installProcessGuards } from './process-guards';
import { LockService } from '../services/lock';
import { LockPin } from '../services/lock-pin';
import { NotificationService, inDnd } from '../services/notifications';
import { MailAlertService } from '../services/mail-alerts';
import { previewOfPrivacy } from '@shared/mail-alerts';
import { SupportNotices } from '../services/support-notices';
import { SupportDesk } from '../services/support-desk';
import { SupportUrgent } from '../services/support-urgent';
import { WebchatRinger, announceEvent, ringerHeight } from '../services/webchat-ring';
import { SystemFocus } from '../services/system-focus';
import { AtRiskAlerts, LivePulse, wallDisplays, wallPrefsOf, wallTarget } from '../services/live-desk';
import { QuickAsk } from '../services/quick-ask';
import { AiService } from '../services/ai';
import { AI_ANSWER_LINK, AI_CHANGES_LINK, AiPendingWatcher } from '../services/ai-pending';
import { MarketingPulse } from '../services/marketing-pulse';
import { CallbackReminders } from '../services/marketing-reminders';
import { NextContactKey, nextContactRoute } from '../services/marketing-shortcut';
import { MeetKeys } from '../services/meet-keys';
import { MeetNext } from '../services/meet-next';
import { MeetingsDesk } from '../services/meetings-desk';
import { touchesInvitations } from '@shared/meeting-invitations';
import { ShareBar } from '../services/share-bar';
import { MEET_GLOBAL_IDS, electronAccelerator, meetShortcutDefaults, type MeetGlobalKey } from '@shared/shortcuts';
import * as fsp from 'node:fs/promises';
import { createInjector, type Injector } from '../services/remote-control/input';
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
import { SettingsService } from '../services/settings';
import { DriveSync } from '../services/sync/engine';
import { ServiceSupervisor } from '../services/supervisor';
import { MeetRecorder } from '../services/meet-recorder';
import { SpeechService } from '../services/speech';
import { TransferManager, queueConfig, type DownloadSink } from '../services/transfers';
import { ElearningOffline } from '../services/elearning-offline';
import { BoardVault } from '../services/board-vault';
import { createBrokerCall, osDeviceServer, readOsDevice, startOsSession, type BrokerTokenEndpoint } from '../services/os-mode';
import { EventDesk } from '../services/event-desk';
import { EventDeskPrint } from '../services/event-desk-print';
import { createRestaurant } from '../services/restaurant';
import { createLabel } from '../services/label';
import { createProjects } from '../services/projects';
import { SalesDesk } from '../services/sales-desk';
import { ChequeStation } from '../services/cheque-print';
import { SinhalaService, type SinhalaDocxRequest } from '../services/sinhala';
import type { DocxConvertStats } from '../services/sinhala-docx';
import { execFile as execFileCb } from 'node:child_process';
import { PurchaseDesk } from '../services/purchase-desk';
import { BillingBanners } from '@shared/billing';
import { listPrinters } from '../services/print';
import { OfficeEditorHost } from '../services/office-editor';
import { OfficeExternal } from '../services/office-external';
import { createPdfStudio } from '../services/pdf/host';
import { createMailFilesIpc } from '../services/mail-files/ipc';
import { attachSpellingMenu } from '../services/spellcheck';
import { markFromInternet } from '../services/quarantine';
import { mailFilePathsInArgv } from '../services/mail-files/argv';
import { createLocalAI } from '../services/local-ai/host';
import { OcrService } from '../services/ocr';
import { OfficeLocalFiles, officePathsInArgv } from '../services/office-local';
import { ImageLocal } from '../services/image-local';
import { writeAtomically as writeImageAtomically } from '../services/pdf/host';
import { officeDocRoute } from '@shared/office';
import { pdfPathsInArgv } from '../services/pdf/local-files';
import { DEFAULT_PDF_POLICY } from '../services/pdf/service';
import { Vault } from '../services/vault';
import { indicatorHostRunning, NO_TRAY_HINT, TrayService } from '../tray/tray';
import { POLICY_PUBLIC_KEY } from '../updater/keys';
import { linuxInstallKind } from '../updater/linux';
import { UPDATE_CENTER_RELEASE_KEYS, UPDATE_CENTER_RESPONSE_KEYS, UPDATE_CENTER_URL, ed25519Key, setDiscoveryKeysSink, setEntitlementKeysSink, ucInstallType, updateCheckUrl, reportProblemUrl } from '../updater/update-center';
import { announce, noticeText } from '../updater/notice';
import { runUpdateDiagnostics } from '../updater/diagnostics';
import type { TrayUpdate } from '../tray/tray';
import { UpdaterService } from '../updater/updater';
import { UpdateHealth, UpdateHistory, UpdateNotifier } from '../updater/update-flow';
import { CHANNEL_INFO, allowedChannels, channelLockReason, channelSource, idleInstallDue } from '@shared/updates';
import { WindowManager } from '../windows/manager';

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
  // eslint-disable-next-line prefer-const
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
  const bootstrap = new BootstrapService(db, getVault, http, () => policyKeyFor(scopes.current()?.account ?? null, POLICY_PUBLIC_KEY));
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

  // ── navigation (deep links, notifications, tray) ──────────────────────
  const pendingNav: NavigateRequest[] = [];
  const refuse = (): void => {
    windows.showMain();
    broadcast('toast', { kind: 'error', text: NO_ACCESS });
  };
  const navigate = (asked: NavigateRequest): void => {
    // A channel's old route (`/whatsapp?chat=5`) opens in its host now, on the same conversation (#35).
    const req = { ...asked, route: redirectRoute(asked.route) };
    // Locked: the workspace is not there to take it; it opens once WorkSuite is unlocked (#114).
    if (lock.isLocked()) {
      pendingNav.push(req);
      windows.showMain();
      return;
    }
    // Guest mode (#149): the main window's guard opens what guest mode has, or the sign-in panel for what needs an account.
    const main = windows.getMain();
    if (!sessionCtl.isReady() && main && localSession.isGuest(main.webContents.id) && !localSession.access.locked(main.webContents.id)) {
      windows.showMain().webContents.send('navigate', req);
      return;
    }
    if (!sessionCtl.isReady() || !windows.getMain()) {
      // Checked by the main window when it takes them (Shell).
      pendingNav.push(req);
      if (!sessionCtl.isReady()) windows.showMain();
      return;
    }
    // A deep link, the tray or a notification never opens an app the person was not given.
    if (!canOpenRoute(req.route, sessionCtl.visibleApps())) {
      refuse();
      return;
    }
    if (req.newWindow) {
      windows.open('record', req.route);
      return;
    }
    const w = windows.showMain();
    // A window just made (closed to the tray) is still loading: a route sent now is lost (#346). Send it once loaded.
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => w.webContents.send('navigate', req));
    else w.webContents.send('navigate', req);
  };
  // Marketing's Next contact (MKT-DSK-01): the global key and the tray's line — My call queue's workspace, on a new claim.
  const openNextContact = (source: 'shortcut' | 'tray'): void => navigate({ route: nextContactRoute(), source });

  /** The meeting this computer is in, if any: whose window answers mute and the camera. */
  const liveMeetWindow = (): BrowserWindow | null => {
    const live = calls.list().find((c) => c.kind === 'meet');
    const win = live ? BrowserWindow.fromId(live.windowId) : null;

    return win && !win.isDestroyed() ? win : null;
  };

  /**
   * One Meet action, however it was asked for (WS-MEET-ENH-01 D04, D06): a
   * global key, or the tray's own line. One implementation, because a tray
   * entry and a key that did subtly different things would be a bug nobody
   * would think to look for.
   */
  const meetAction = (id: string, source: 'shortcut' | 'tray'): void => {
    const win = liveMeetWindow();

    // In a meeting, these belong to its own window: muting the call you are in
    // is never the main window's business.
    if (win && (id === 'meet-mute' || id === 'meet-camera' || id === 'meet-share-screen')) {
      sendTo(win, 'meet:shortcut', { id });

      return;
    }
    // Without a meeting, mute and camera have nothing to act on. The keys are
    // held only while a call is live, so arriving here means it ended between
    // the press and the delivery; the tray does not offer them at all.
    if (id === 'meet-mute' || id === 'meet-camera') return;

    // The rest start something, which only the workspace can do, so it comes
    // forward with the action in the route.
    const action = id === 'meet-new' ? 'new' : id === 'meet-join-next' ? 'join-next' : 'share';

    navigate({ route: `/meet?do=${action}&n=${Date.now()}`, source });
  };
  const flushNavigation = (): void => {
    if (!sessionCtl.isReady()) return;
    const w = windows.getMain();
    if (!w) return;
    while (pendingNav.length) w.webContents.send('navigate', pendingNav.shift());
  };
  // The main window's Changes view: where a waiting change the assistant proposed is decided (DSK-5).
  const openAiChanges = (): void => {
    const w = windows.showMain();
    w.webContents.send('ai:open', { to: 'changes', text: '', result: null });
  };
  // The assistant's conversation, where an answer that arrived in the background is read (#126).
  const openAiAnswer = (): void => {
    const w = windows.showMain();
    w.webContents.send('ai:open', { to: 'ask', text: '', result: null });
  };
  const openLink = (link: string | null): void => {
    if (link === AI_CHANGES_LINK) return openAiChanges();
    if (link === AI_ANSWER_LINK) return openAiAnswer();
    const target = resolveWebLink(link);
    // Nor in the browser instead: a link into an app the person may not open is refused.
    if (!canOpenLink(link, sessionCtl.visibleApps())) refuse();
    else if (target.kind === 'tab') navigate({ route: target.route, source: 'notification' });
    else if (target.kind === 'browser') {
      const origin = auth.getServer()?.origin;
      if (origin) void openExternalSafely(`${origin}${target.path}`);
    } else windows.showMain();
  };
  /* WorkSuite Office's Local AI policy (W10): the company's policy from the server, written where Office's local
     AI service reads managed configuration. Refreshed with every bootstrap, removed on sign-out. */
  const officeAiPolicy = new OfficeAiPolicySync({
    platform: process.platform,
    env: process.env,
    home: app.getPath('home'),
    fetchPolicy: () => http.get<unknown>('/api/ai/office-policy'),
    run: (file, args) =>
      new Promise<string>((resolveRun, reject) => {
        execFileCb(file, args, { timeout: 30_000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolveRun(String(stdout))));
      }),
    readFile: (path) => fsp.readFile(path, 'utf8').catch(() => null),
    writeFile: async (path, data, mode) => {
      await fsp.mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, data, { mode });
      await fsp.rename(tmp, path);
    },
    removeFile: (path) => fsp.rm(path, { force: true }),
    log: logger('office-ai-policy'),
  });
  // WorkSuite Office, the desktop editor: "Open with ▸ WorkSuite Office" hands it a link this process builds (#322).
  const officeApp = new OfficeApp({
    protocolApp: (url) => app.getApplicationNameForProtocol(url),
    open: async (url) => {
      if (!app.isPackaged && process.env.WS_E2E_EXTERNAL_LOG) await fsp.writeFile(process.env.WS_E2E_EXTERNAL_LOG, `${url}\n`, { flag: 'a' });
      else await shell.openExternal(url);
    },
    account: () => {
      const origin = auth.getServer()?.origin;
      const uid = sessionCtl.userId();
      return origin && uid && sessionCtl.isReady() ? { origin, userId: String(uid) } : null;
    },
    canOpenFiles: () => sessionCtl.hasPermission('desktop.files.open_external'),
    audit: (action, details) => audit.record(sessionCtl.userId(), action, details),
  });
  // WorkSuite Office on this computer: who this app is signed in as, and its "Continue as" (worksuite-office#6).
  const desktopAccounts = new DesktopAccountsFile(join(p.userData, 'desktop-accounts.json'), log);
  const officeSignIn = new OfficeSignIn({
    account: () => {
      const origin = auth.getServer()?.origin;
      const uid = sessionCtl.userId();
      const user = sessionCtl.current()?.user ?? sessionCtl.get().user;
      if (!origin || !uid || !user || !sessionCtl.isReady()) return null;
      return { origin, userId: String(uid), name: user.name, organization: user.organizationName ?? null };
    },
    isLocked: () => lock.isLocked(),
    confirm: async ({ message, detail }) => {
      const parent = windows.getMain();
      const opts = { type: 'question' as const, buttons: ['Continue', 'Cancel'], defaultId: 1, cancelId: 1, message, detail };
      const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
      return response === 0;
    },
    handoff: (challenge) => http.post('/api/auth/apps/handoff', { client: OFFICE_CLIENT, code_challenge: challenge, code_challenge_method: 'S256' }),
    // A fixed address with this app's code: nothing from the link that asked (hardening.ts allows https only).
    open: async (url) => {
      if (!app.isPackaged && process.env.WS_E2E_EXTERNAL_LOG) await fsp.writeFile(process.env.WS_E2E_EXTERNAL_LOG, `${url}\n`, { flag: 'a' });
      else await shell.openExternal(url);
    },
    showMain: () => void windows.showMain(),
    toast: (kind, text) => broadcast('toast', { kind, text }),
    isNotFound: (e) => isDesktopError(e) && e.code === 'NOT_FOUND',
    log,
  });
  const handleDeepLink = (url: string): void => {
    // A mailto: link from another app (WorkSuite is the default mail app): a new message, prefilled, for the person to send.
    if (/^mailto:/i.test(url)) {
      const fields = parseMailto(url);
      if (fields) navigate({ route: mailtoRoute(fields), source: 'deep-link' });
      else windows.showMain();
      return;
    }
    // A browser sign-in (OIDC, Core's AppHandoff) coming back: its attempt takes it first (Connection & Startup §3).
    if (/^worksuite:\/\/auth\/(oidc|callback)\?/i.test(url) && accountsWiring?.handleAuthCallback(url)) {
      windows.showMain();
      return;
    }
    // A setup link from IT (§4 step 5): Add Account › Enterprise with it filled in; it still takes a click on Continue.
    if (/^worksuite:\/\/setup\?/i.test(url)) {
      windows.showMain();
      if (!accountsService.setupLink(url)) broadcast('toast', { kind: 'info', text: trustedNow().lockServer ? 'Your organization manages the server this computer connects to.' : 'That setup link could not be used.' });
      return;
    }
    // A passkey sign-in coming back from the browser. Handled before the link
    // grammar, and never logged: it carries a one-time code.
    if (/^worksuite:\/\/auth\/callback\?/i.test(url)) {
      windows.showMain();
      let code = '';
      let state = '';
      try {
        const q = new URL(url).searchParams;
        code = q.get('code') ?? '';
        state = q.get('state') ?? '';
      } catch {
        /* treated as not started below */
      }
      // Only the attempt waiting now; anything else is ignored and leaves that
      // attempt running — a stray or replayed link must not cancel it.
      if (!auth.isPendingPasskey(state)) {
        log.warn('passkey callback for no sign-in waiting');
        broadcast('toast', { kind: 'error', text: 'That sign-in was not started from this app.' });
        return;
      }
      void sessionCtl.completePasskey(code, state);
      return;
    }
    // WorkSuite Office asking to use this sign-in (worksuite-office#6). Before the link grammar, where
    // office/:id would take it for a document, and never logged: it carries a PKCE challenge and state.
    if (isOfficeSignInLink(url)) {
      void officeSignIn.handle(url);
      return;
    }
    const meeting = /^worksuite:\/\/meet\/([0-9a-f-]{36})(?:[?#]|$)/i.exec(url);
    if ((meeting && !sessionCtl.isReady()) || /^https:\/\/[^/]+\/meet\//i.test(url)) {
      const destination = { input: meeting ? meeting[1]! : url, server: meeting ? new URL(url).searchParams.get('server') ?? undefined : undefined };
      pendingGuest = destination;
      void openGuest(destination.input, destination.server).then(() => { pendingGuest = null; }, (e) => {
        const main = windows.showMain();
        main.webContents.send('guest:destination', destination);
        broadcast('toast', { kind: 'error', text: String(e.message) });
      });
      return;
    }
    // Which account the link is for (§4 step 5): another account's opens there once the person agrees; a server not
    // added on this computer is screen 16, and nothing is fetched from it.
    const routed = routeLink(url, registry.list(), registry.activeId());
    if (routed?.kind === 'unknown') {
      log.info('link for a server not added', { host: routed.host });
      windows.showMain();
      emitAccounts('accounts:unknownLink', { url: redactUrl(url), host: routed.host, label: routed.label });
      return;
    }
    if (routed?.kind === 'account') {
      const target = registry.get(routed.accountId);
      if (!target) return;
      const parent = windows.showMain();
      void dialog
        .showMessageBox(parent, { type: 'question', buttons: [`Open in ${target.organizationName ?? target.serverName}`, 'Cancel'], defaultId: 0, cancelId: 1, message: `Open in ${target.organizationName ?? target.serverName}?`, detail: 'This link belongs to another account on this computer.' })
        .then(({ response }) => {
          if (response !== 0) return;
          return accountsService.switchTo(target.id).then(() => handleDeepLink(withoutServerParam(url)));
        })
        .catch((e: unknown) => broadcast('toast', { kind: 'error', text: e instanceof Error ? e.message : 'That account could not be opened.' }));
      return;
    }
    if (routed?.kind === 'active' && url !== withoutServerParam(url)) url = withoutServerParam(url);
    // An item link (#170): worksuite://{org}/{type}/{id} or https://app.worksuite.lk/o/{org}/{type}/{id}.
    if (looksLikeItemLink(url)) {
      const serverHost = (() => {
        try {
          const origin = auth.getServer()?.origin;
          return origin ? new URL(origin).hostname : null;
        } catch {
          return null;
        }
      })();
      const item = parseItemLink(url, { hosts: [serverHost, ...(registry.active()?.linkHosts ?? [])] });
      if (!item.ok) {
        log.warn('item link rejected', { reason: item.reason, url: redactUrl(url) });
        windows.showMain();
        broadcast('toast', { kind: 'error', text: 'That WorkSuite link could not be opened.' });
        return;
      }
      // "Open WorkSuite links in the desktop app" off: a web link the system handed over goes on to the browser.
      if (item.link.format === 'web' && !linkPrefs(settings.effective()).openInApp) {
        void openExternalSafely(url);
        return;
      }
      log.info('item link', { type: item.link.type, action: item.link.action });
      navigate({ route: itemRoute(item.link), organizationId: item.link.org, source: 'deep-link', item: { link: item.link, source: item.link.source ?? 'external', app: itemApp(item.link) } });
      return;
    }
    const parsed = parseDeepLink(url);
    if (!parsed.ok) {
      log.warn('deep link rejected', { reason: parsed.reason, url: redactUrl(url) });
      navigate({ route: '/home', source: 'deep-link' });
      broadcast('toast', { kind: 'error', text: 'That WorkSuite link could not be opened.' });
      return;
    }
    log.info('deep link', { module: parsed.link.module, pattern: parsed.link.pattern });
    const go = (organizationId: string | null) =>
      navigate({ route: parsed.link.route, newWindow: parsed.link.newWindow, organizationId, source: 'deep-link' });
    // WF-04 step 3: a desktop-API server resolves the record — its module,
    // its organization, and whether this user may see it — before anything
    // opens. A refusal says only that, never what the record is.
    if (auth.getServer()?.api === 'desktop-v1' && sessionCtl.isReady()) {
      http
        .get<{ allowed?: boolean; organization_id?: string | number | null }>('/desktop/v1/links/resolve', { query: { url } })
        .then((r) => {
          if (r.allowed === false) {
            broadcast('toast', { kind: 'error', text: "You don't have access to this record." });
            windows.showMain();
            return;
          }
          const org = r.organization_id === null || r.organization_id === undefined ? parsed.link.organizationId : String(r.organization_id);
          go(org);
        })
        .catch(() => go(parsed.link.organizationId));
      return;
    }
    go(parsed.link.organizationId);
  };
  setLinkHandler(handleDeepLink);

  // A support ticket's quick-reply window (WS-SUPPORT-SRS-001 D-04, FR-DSK-03): floating over whatever is in front,
  // from a banner, the tray or the global shortcut. Never behind the lock, never for somebody without the desk.
  const openQuickReply = (ticketId: number): void => {
    if (lock.isLocked() || !sessionCtl.isReady() || !canOpenApp('support', sessionCtl.visibleApps())) return;
    windows.open('support-quick', quickRoute(ticketId), 'Quick reply', true);
  };
  // Support's banners and count (WS-SUPPORT-SRS-001 D-03, FR-DSK-02/04): the desk's notifications with their own buttons.
  const supportNotices = new SupportNotices({
    http,
    notify: (n) => notifications.notify(n),
    markRead: (ids) => notifications.markRead(ids),
    me: () => Number(sessionCtl.userId()) || null,
    enabled: () => canOpenApp('support', sessionCtl.visibleApps()),
    prefs: () => settings.effective(),
    open: (link) => notifications.onClick(link, 'support'),
    quickReply: (id) => openQuickReply(id),
    refused: (ticketId, text, mode, error) => {
      const me = sessionCtl.userId();
      // Kept as the ticket's draft, where its composer finds it (modules/support/Composer.tsx).
      if (me) queue.saveDraft(me, 'support', `ticket:${ticketId}`, { body: text, mode });
      openLink(`/tickets?ticket=${ticketId}`);
      broadcast('toast', { kind: 'error', text: `Your ${mode === 'note' ? 'note' : 'reply'} was not sent: ${error} It is in the ticket's message box to send again.` });
    },
    onChanged: () => {
      emitStatus();
      supportDesk.soon();
    },
  });
  // The desk in the tray / menu bar (D-05): my numbers, the next SLAs due, availability.
  const supportDesk: SupportDesk = new SupportDesk({
    http,
    enabled: () => canOpenApp('support', sessionCtl.visibleApps()),
    badges: () => supportNotices.badges(),
    onChanged: () => tray.update({ support: supportDesk.get() }),
  });
  // An urgent ticket nobody has rings as a centred card (D-07): one at a time, each once; it closes when it is taken.
  const supportUrgent: SupportUrgent = new SupportUrgent({
    http,
    allowed: () =>
      sessionCtl.isReady() && !lock.isLocked() && canOpenApp('support', sessionCtl.visibleApps()) && settings.effective().notificationsEnabled !== false && supportNoticePrefs(settings.effective().supportNotices).urgentPopup,
    ring: (id) => {
      const win = windows.open('support-ring', ringRoute(id), 'Urgent ticket', true);
      win.once('closed', () => supportUrgent.closed(id));
    },
    close: () => windows.closeKind('support-ring'),
  });
  // ⌃⌥R (Ctrl+Alt+R): the quick-reply window on my latest ticket, from any app (D-05). Held while signed in with the
  // desk and unlocked, unless turned off in Notification settings › Support.
  let supportKeyHeld = false;
  const quickLatest = (): void => {
    void supportDesk.latest().then((id) => (id ? openQuickReply(id) : navigate({ route: '/support?view=mine', source: 'tray' })));
  };
  const syncSupportKeys = (): void => {
    const want = sessionCtl.isReady() && !lock.isLocked() && canOpenApp('support', sessionCtl.visibleApps()) && supportNoticePrefs(settings.effective().supportNotices).quickShortcut;
    if (want && !supportKeyHeld) {
      try {
        supportKeyHeld = globalShortcut.register(SUPPORT_QUICK_SHORTCUT, quickLatest);
      } catch {
        supportKeyHeld = false;
      }
    } else if (!want && supportKeyHeld) {
      globalShortcut.unregister(SUPPORT_QUICK_SHORTCUT);
      supportKeyHeld = false;
    }
    tray.update({ supportShortcut: supportKeyHeld ? SUPPORT_QUICK_SHORTCUT : null });
  };
  // WorkSuite Projects (PRJ-DSK-02..04): the tray timer and its idle prompt, the offline outbox, banners with buttons.
  const projects = createProjects({
    db,
    vault: getVault,
    http,
    origin: () => auth.getServer()?.origin ?? null,
    user: () => (sessionCtl.isReady() && canOpenApp('projects', sessionCtl.visibleApps()) ? sessionCtl.userId() : null),
    notify: (n) => notifications.notify(n),
    markRead: (ids) => notifications.markRead(ids),
    open: (route) => navigate({ route, source: 'notification' }),
    openMini: () => {
      if (lock.isLocked() || !sessionCtl.isReady() || !canOpenApp('projects', sessionCtl.visibleApps())) return;
      windows.open('timer', '/projects/timer', 'Timer', true);
    },
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    changed: (c) => {
      broadcast('projects:changed', c);
      if (c.outbox) emitStatus();
    },
    tray: (t) => tray.update({ projectTimer: t }),
  });
  // A new email's bell entry is the new-mail alerts' to show (ENH-MAIL-05): never a plain banner as well.
  // Meetings' reminders and invitations (Meetings D07): their own buttons, and today's meetings in the tray.
  const meetingsDesk = new MeetingsDesk({
    get: (path, query, timeoutMs) => http.get(path, { query, timeoutMs }),
    post: (path, body) => http.post(path, body),
    notify: (n) => notifications.notify(n),
    markRead: (ids) => notifications.markRead(ids),
    allowed: () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('meetings', sessionCtl.visibleApps()),
    canMeet: () => canOpenApp('meet', sessionCtl.visibleApps()),
    open: (route) => notifications.onClick(route, 'meetings'),
    joinMeet: (uuid, title) => void windows.open('meet', `/meet/${uuid}`, title || 'WorkSuite Meet', false),
    openExternal: (url) => void openExternalSafely(url),
    onChange: (meetings) => tray.update({ meetings }),
  });
  // Cheque Manager's print station (D02–D06): the leaf's layout is fetched here from the server, printed at exact size.
  const chequeStation = new ChequeStation({
    http,
    deviceId: () => device.current()?.id ?? null,
    host: () => device.deviceName(),
    version: () => app.getVersion(),
    printers: (sender) => listPrinters(sender ? BrowserWindow.fromWebContents(sender) : null),
  });
  // Sales' approvals (WS-OMS-SRS-001 D-05, FR-APR-10): Approve and Open on the banner; printing on this computer.
  const salesDesk = new SalesDesk({
    http,
    config: db,
    origin: () => auth.getServer()?.origin ?? null,
    notify: (n) => notifications.notify(n),
    markRead: (ids) => notifications.markRead(ids),
    enabled: () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('sales', sessionCtl.visibleApps()),
    open: (route) => navigate({ route, source: 'notification' }),
    refreshCounts: () => void notifications.refreshCounts(),
    toast: (kind, text) => broadcast('toast', { kind, text }),
    printers: async (sender) => (await listPrinters(BrowserWindow.fromWebContents(sender))).map((p) => p.name),
    saveDialog: async (sender, defaultPath) => {
      const w = BrowserWindow.fromWebContents(sender);
      const opts: Electron.SaveDialogOptions = { title: 'Save as PDF', defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] };
      const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      return res.canceled || !res.filePath ? null : res.filePath;
    },
    documents: () => app.getPath('documents'),
    temp: () => app.getPath('temp'),
    openPath: async (path) => void (await shell.openPath(path)),
    reveal: (path) => shell.showItemInFolder(path),
  });
  // Billing's eight events (SRS-BIL-001 G-10): a banner in Billing's words whose Open goes to the invoice, payment, note or profile.
  const billingBanners = new BillingBanners({
    notify: (n) => notifications.notify(n),
    markRead: (ids) => notifications.markRead(ids),
    enabled: () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('billing', sessionCtl.visibleApps()),
    open: (route) => navigate({ route, source: 'notification' }),
  });
  // Purchasing's approvals (SRS-PUR-001 G-21): Approve and Open on the banner; the documents waiting on me on the badge.
  const purchaseDesk = new PurchaseDesk({
    get: (path, query) => http.get(path, { query }),
    post: (path, body) => http.post(path, body),
    notify: (n) => notifications.notify(n),
    markRead: (ids) => notifications.markRead(ids),
    enabled: () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('purchase', sessionCtl.visibleApps()),
    open: (route) => navigate({ route, source: 'notification' }),
    toast: (kind, text) => broadcast('toast', { kind, text }),
    changed: () => emitStatus(),
  });
  notifications.claim = (n) => supportNotices.claim(n) || projects.claim(n) || mailAlerts.claim(n) || meetingsDesk.claim(n) || salesDesk.claim(n) || purchaseDesk.claim(n) || billingBanners.claim(n);
  notifications.onRefresh = () => {
    void supportNotices.refreshBadges();
    void purchaseDesk.refresh();
  };

  // ── status ─────────────────────────────────────────────────────────────
  let statusTimer: NodeJS.Timeout | null = null;
  // Visitors waiting on me in my website chats (#230), from the ringer: on the Dock and taskbar badge.
  let followUpCount = 0;
  // Website chats and calls ringing for me and not silenced (R-05, R-06; RING-44): on the badge until joined or silenced.
  let ringingCount = 0;
  const snapshot = (): StatusSnapshot => {
    const uid = sessionCtl?.userId();
    const { supportNotices: supportBell, ...raw } = notifications.counts();
    const support = supportNotices.count();
    // Counts only of apps the person has: the badge, tray and title bar never count an app they cannot open.
    const visible = sessionCtl?.visibleApps() ?? new Set<string>();
    const hasMail = canOpenApp('mail', visible);
    const counts = { ...raw, mailBadge: hasMail ? mailAlerts.unread() : 0, mailNotices: hasMail ? raw.mailNotices : 0, chat: canOpenApp('chat', visible) ? raw.chat : 0, mail: hasMail ? raw.mail : 0, tasks: canOpenApp('tasks', visible) ? raw.tasks : 0, webchat: canOpenApp('chat', visible) ? followUpCount : 0, ringing: canOpenApp('chat', visible) ? ringingCount : 0, support, supportNotices: canOpenApp('support', visible) ? supportBell : 0, salesApprovals: canOpenApp('sales', visible) ? raw.salesApprovals : 0, salesNotices: canOpenApp('sales', visible) ? raw.salesNotices : 0, purchaseApprovals: canOpenApp('purchase', visible) ? purchaseDesk.count() : 0, purchaseNotices: canOpenApp('purchase', visible) ? raw.purchaseNotices : 0 };
    const services: Record<string, ServiceHealth> = { ...supervisor.health() };
    return {
      internetOnline: electronNet.isOnline(),
      realtimeDiagnostics: realtime.diagnostics(),
      network: networkStatus(apiReachable, realtime.getState(), realtimeDownSince),
      realtime: realtime.getState(),
      connection: connection.stats(),
      // The service banner (screen 16) and the switcher's dot for the accounts not open now.
      service: health.state(),
      otherAccountsUnread: background.totalUnread(),
      // The same list the sign-out dialog shows (accounts/unsynced.ts): one count, so the two never disagree.
      pendingChanges: uid ? pendingCount(unsyncedSummary({ db, vault, accountId: registry.activeId() ?? '', userId: uid, officeCopies: () => officeLocal.list(), itemsOnly: true })) : 0,
      unread: counts,
      notificationsPausedUntil: notifications.pausedUntilIso(),
      mailAlertsPaused: hasMail ? (mailAlerts.state().pauseLabel ?? null) : null,
      notificationsSupported: notifications.supported(),
      services,
      locked: lock.isLocked(),
      safeMode: boot.safeMode,
    };
  };
  function emitStatus(): void {
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      const s = snapshot();
      broadcast('status:changed', s);
      const st = sessionCtl?.get();
      const failed = Object.entries(s.services).find(([, h]) => h === 'FAILED');
      tray.update({
        signedIn: st?.stage === 'ready',
        userName: st?.user?.name ?? null,
        organization: st?.user?.organizationName ?? null,
        offline: s.network === 'OFFLINE',
        pending: s.pendingChanges,
        error: failed ? `${failed[0]} stopped — open Diagnostics` : null,
        unreadChat: s.unread.chat + (s.unread.webchat ?? 0),
        unreadMail: s.unread.mail,
        unreadOther: s.unread.notifications,
        unreadSupport: s.unread.support ?? 0,
        unreadSupportNotices: s.unread.supportNotices ?? 0,
        badge: settings.effective().badgeCount !== false,
        notificationsPausedUntil: s.notificationsPausedUntil,
        mailBadge: s.unread.mailBadge ?? 0,
        mailNotices: s.unread.mailNotices ?? 0,
        salesApprovals: s.unread.salesApprovals ?? 0,
        salesNotices: s.unread.salesNotices ?? 0,
        purchaseApprovals: s.unread.purchaseApprovals ?? 0,
        purchaseNotices: s.unread.purchaseNotices ?? 0,
        mail: trayMail(),
      });
    }, 300);
  }

  realtime.onState = (s: RealtimeState) => {
    notifications.realtimeState(s);
    connection.realtimeState(s);
    realtimeDownSince = s === 'down' || s === 'connecting' ? (realtimeDownSince ?? Date.now()) : null;
    emitStatus();
  };
  function scopeFor(sender: Electron.WebContents) {
    const win = BrowserWindow.fromWebContents(sender);
    const scope = lockedScope(sender.getURL(), win ? windows.kindOf(win.id) : null);
    if (scope && (!sessionCtl.isReady() || !canOpenApp(scope.kind === 'chat-mini' ? 'chat' : 'calls', sessionCtl.visibleApps()))) return null;
    if (scope && !scope.uuid && scope.kind !== 'chat-mini' && win) scope.uuid = calls.list().find(c => c.windowId === win.id && c.kind === 'call')?.uuid ?? null;
    return scope;
  }
  // Mail's lines in the tray (D28): accounts, the pause and its choices.
  const trayMail = () => {
    const m = mailAlerts.state();
    return { accounts: m.accounts, unread: m.unread, paused: m.paused, pauseLabel: m.pauseLabel, pauseSet: !!m.pause, choices: m.pauseChoices, hoursNote: m.hoursNote };
  };
  realtime.onEvent = (e) => {
    // My own status changed somewhere (the window, another device): the tray's status line follows (#346).
    const pe = e as { type?: string; who?: number | string; status?: string };
    if (pe.type === 'chat.presence' && String(pe.who ?? '') === String(sessionCtl.get().user?.id ?? '-') && pe.status) tray.update({ presence: pe.status === 'online' ? 'available' : pe.status });
    notifications.handleRealtime(e);
    mailAlerts.handleRealtime(e);
    supportNotices.handle(e);
    salesDesk.handle(e as { type?: string });
    purchaseDesk.handle(e as { type?: string });
    // An invitation answered, moved or cancelled anywhere: the tray's Meetings lines follow (Meetings D07).
    if (touchesInvitations(e as { type: string; event?: unknown })) meetingsDesk.poke();
    supportDesk.handle(e);
    supportUrgent.handle(e);
    webchat.handle(e);
    calls.handle(e);
    aiPending.handle(e as { type?: string });
    remoteControl.onRealtime(e as { type?: string; meeting?: string });
    if (!lock.isLocked()) broadcast('realtime:event', e);
    else for (const win of BrowserWindow.getAllWindows()) {
      const scope = scopeFor(win.webContents);
      const event = e as { type?: string; uuid?: string; outcome?: string; reason?: string };
      if (!guestWindowIds.has(win.webContents.id) && scope?.uuid && event.type === 'chat.call.stopped' && event.uuid === scope.uuid) win.webContents.send('realtime:event', { type: event.type, uuid: event.uuid, outcome: event.outcome, reason: event.reason });
    }
    // `access.changed` (the person's apps changed) and `profile.updated`: fetch the bootstrap again.
    accessWatch.onEvent(e);
    // A desktop release was published: ask the Update Center now rather than at the next 4-hourly check.
    if ((e as { type?: string }).type === 'desktop.release.published') void updater.check();
  };
  realtime.onResync = () => {
    broadcast('realtime:resync');
    // Events may have been missed while the socket was down, `access.changed` among them.
    if (sessionCtl.isReady()) void accessWatch.refresh('resync');
    // Announcing what the push missed, chat included: not just taking it as already seen (#114).
    void notifications.refreshList(true);
    void notifications.catchUpChat();
    void notifications.refreshCounts();
    // New mail the push missed (ENH-MAIL-05): from the server's recent alerts, each still once.
    void mailAlerts.catchUp();
  };
  notifications.onChanged = () => {
    emitStatus();
    broadcast('notifications:changed');
  };
  notifications.onClick = (link) => {
    if (!lock.isLocked()) return openLink(link);
    // Locked (#114): a conversation opens in the restricted chat window when that is allowed; anything else after the unlock.
    const target = lockedClickTarget(link, settings.effective());
    if (target.kind === 'restricted-chat' && canOpenLink(link, sessionCtl.visibleApps())) {
      windows.open('chat-mini', `/chat?room=${target.room}`, 'WorkSuite chat');
      return;
    }
    broadcast('toast', { kind: 'info', text: 'Unlock WorkSuite to open this.' });
    const web = resolveWebLink(link);
    // Never into the browser from behind the lock: only a tab, and it waits for the unlock.
    if (web.kind === 'tab' && canOpenLink(link, sessionCtl.visibleApps())) navigate({ route: web.route, source: 'notification' });
    else windows.showMain();
  };
  // An app the person may not open never alerts (and Mail is not polled for them).
  notifications.moduleEnabled = (n) => notificationAllowed(n, sessionCtl.visibleApps());
  notifications.isLocked = () => lock.isLocked();
  // A reply typed in a website visitor's banner goes the way the conversation's composer sends one (RDC-15).
  notifications.sendWebsiteReply = async (conversationId, text) => {
    const me = sessionCtl.userId();
    if (!me) return { delivered: false, queued: false, id: null, status: null, data: null, error: 'You are signed out.', code: 'NOT_SIGNED_IN' };
    // A chat still ringing: the reply joins it and is sent in one step, first come (#225). Too late, it is refused.
    if (webchat.isRinging(conversationId)) {
      const r = await webchat.joinAndSend(conversationId, text, { stay: false });
      return { delivered: r.ok, queued: false, id: null, status: r.ok ? 200 : 409, data: null, error: r.why, code: r.ok ? null : 'TAKEN' };
    }
    return queue.submit(me, websiteReplyMutation(conversationId, text));
  };
  notifications.websiteReplyRefused = (w, text, error) => {
    const me = sessionCtl.userId();
    const key = websiteDraftKey(w.conversationId);
    // Signed out meanwhile: there is no draft to keep it in.
    if (me) queue.saveDraft(me, key.module, key.context, text);
    openLink(`/chat?website=${w.conversationId}`);
    broadcast('toast', { kind: 'error', text: `Your reply to ${w.visitor} was not sent: ${error} It is in the message box to send again.` });
  };
  queue.onChanged = () => {
    emitStatus();
    broadcast('offline:changed');
  };
  transfers.onChanged = (list) => broadcast('transfers:changed', list);

  // ── attendance for the tray (FR-TRAY-01 Clock In) ─────────────────────
  let attendanceTimer: NodeJS.Timeout | null = null;
  // ── chat presence (FR-COM-02) ─────────────────────────────────────────
  // The server shows somebody offline 150 s after their last heartbeat, and
  // away after five minutes without input; the web sends one every 30 s.
  let presenceTimer: NodeJS.Timeout | null = null;
  const heartbeatPresence = async (): Promise<void> => {
    if (!sessionCtl.isReady() || lock.isLocked()) return;
    try {
      // In a meeting or on a call, the server counts me busy: a visitor writing again in my chat goes straight to the
      // team, and no new chat is given to me (worksuite-desktop#230). An older server ignores the field.
      const doing = updateActivity();
      await http.post('/api/chat/presence', { active: powerMonitor.getSystemIdleTime() < 300, busy_reason: doing.meeting ? 'meeting' : doing.call ? 'call' : null });
    } catch (e) {
      // No chat for this person (or no such endpoint): stop asking.
      if (isDesktopError(e) && (e.code === 'PERMISSION_DENIED' || e.code === 'APP_ACCESS_DENIED' || e.code === 'NOT_FOUND')) stopPresence();
    }
  };
  const stopPresence = (): void => {
    if (presenceTimer) clearInterval(presenceTimer);
    presenceTimer = null;
  };
  const refreshAttendance = async (): Promise<void> => {
    try {
      const a = await http.get<{ linked?: boolean; today?: { check_in?: string | null; check_out?: string | null } | null }>('/api/hr/attendance/me');
      const clockedIn = !!(a.today?.check_in && !a.today?.check_out);
      // Attendance stamps are wall-clock times on the company's clock, not UTC:
      // shown as the digits they are, never converted.
      const m = clockedIn && a.today?.check_in ? /[T ](\d{2}):(\d{2})/.exec(a.today.check_in) : null;
      const since = m ? new Date(Date.UTC(2000, 0, 1, +m[1]!, +m[2]!)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : null;
      tray.update({ attendance: { linked: !!a.linked, clockedIn, since } });
    } catch {
      tray.update({ attendance: null });
    }
  };
  /**
   * Clocking in or out, from anywhere in the app: the tray, the title bar or
   * the HR page. One implementation, so all three show the same state — the
   * tray menu, and every screen through the `hr.attendance.changed` event.
   * Errors are the caller's to show.
   */
  const clockAttendance = async (direction: 'in' | 'out', extra: ClockExtra = {}): Promise<void> => {
    try {
      await http.post(`/api/hr/attendance/check-${direction}`, {
        source: 'desktop',
        note: extra.note || undefined,
        work_location: direction === 'in' ? extra.workLocation || undefined : undefined,
        note_type: direction === 'out' ? extra.noteType || undefined : undefined,
        geo_note: extra.geoNote || undefined,
      });
      broadcast('realtime:event', { type: 'hr.attendance.changed' });
    } finally {
      void refreshAttendance();
    }
  };
  const attendanceBreak = async (action: 'start' | 'end'): Promise<void> => {
    try {
      await http.post('/api/hr/attendance/break', { action });
      broadcast('realtime:event', { type: 'hr.attendance.changed' });
    } finally {
      void refreshAttendance();
    }
  };
  const clock = async (direction: 'in' | 'out'): Promise<void> => {
    try {
      await clockAttendance(direction);
      broadcast('toast', { kind: 'success', text: direction === 'in' ? 'Clocked in. Have a good day.' : 'Clocked out.' });
    } catch (e) {
      broadcast('toast', { kind: 'error', text: (e as Error).message });
      windows.showMain();
    }
  };

  // ── the tray ───────────────────────────────────────────────────────────
  const quit = (): void => {
    // RC15: someone controls this computer or it is being shared — say what quitting ends first.
    if (remoteControl.isLive() || remoteControl.isSharing()) {
      const live = remoteControl.view().session;
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: [live ? 'Stop control and quit' : 'Stop sharing and quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Quit WorkSuite?',
        message: live ? `${live.controller} is controlling this computer.` : 'You are sharing your screen in a meeting.',
        detail: live ? 'Quitting stops remote control and screen sharing, and leaves the meeting.' : 'Quitting stops sharing and leaves the meeting.',
      });
      if (choice !== 0) return;
      void remoteControl.shutdown('stopped');
    }
    // A recording on this computer, or one still being finished or uploaded (worksuite-desktop#68): quitting pauses it.
    const rec = meetRecorder.pending();
    if (rec.recording || rec.working) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['Quit anyway', 'Keep WorkSuite open'],
        defaultId: 1,
        cancelId: 1,
        title: 'Quit WorkSuite?',
        message: rec.recording ? 'A meeting is being recorded on this computer.' : 'A meeting recording is still being finished and uploaded.',
        detail: rec.recording
          ? 'Quitting stops the recording. What was recorded so far is kept, finished and uploaded the next time you open WorkSuite.'
          : 'Quitting pauses it. It carries on from where it was the next time you open WorkSuite. Closing windows does not stop it — only quitting does.',
      });
      if (choice !== 0) return;
    }
    windows.quitting = true;
    // Leave any call first, so the other side is not left talking to nobody.
    void Promise.race([calls.endAll(), new Promise((r) => setTimeout(r, 2_000))]).finally(() => app.quit());
  };
  /** The status the tray shows, from the server (#346): at sign-in, and after a change from the tray did not go through. */
  const refreshTrayPresence = async (): Promise<void> => {
    try {
      const me = await http.get<{ status?: string; choice?: string }>('/api/chat/presence/me');
      tray.update({ presence: me?.choice ?? (me?.status === 'online' ? 'available' : (me?.status ?? null)) });
    } catch {
      /* the status line falls back to Online */
    }
  };
  const tray = new TrayService({
    open: () => windows.showMain(),
    openRoute: (route) => navigate({ route, source: 'tray' }),
    clockIn: () => void clock('in'),
    clockOut: () => void clock('out'),
    pauseNotifications: (m) => {
      notifications.pause(m);
      emitStatus();
    },
    mailPause: (mode) => void mailAlerts.pause(mode),
    openSettings: () => navigate({ route: '/settings', source: 'tray' }),
    checkUpdates: () => {
      if (updater.get().state === 'STAGED') void updater.install(false).then((r) => !r.started && navigate({ route: '/settings/updates', source: 'tray' }));
      else void updater.check().then(() => navigate({ route: '/settings/updates', source: 'tray' }));
    },
    updateNow: () => updateNow(),
    quit,
    lock: () => lock.lock('manual'),
    pauseRemoteControl: () => {
      const s = remoteControl.view().session;
      if (s) void remoteControl.pause(s.id, 'sharer');
    },
    stopRemoteControl: () => void remoteControl.stopAll('stopped'),
    joinWebchat: (id) => void webchat.join(id),
    answerWebchatCall: (id) => void webchat.answerCall(id, true),
    quickAsk: () => void quickAsk.open(),
    // Sinhala Tools (WF-SI-04): what is on the clipboard, converted to Unicode and put back.
    sinhalaClipboard: () => sinhala.pressed(),
    aiChanges: () => openAiChanges(),
    ringingSettings: () => navigate({ route: '/settings/notifications', source: 'tray' }),
    showRingMenu: (anchor) => ringTray.show(anchor),
    liveDashboard: () => liveDesk.open('dashboard'),
    liveMap: () => liveDesk.open('map'),
    supportQuickReply: (id) => openQuickReply(id),
    supportQuickLatest: () => quickLatest(),
    supportPresence: (status) => void supportDesk.setPresence(status),
    // The status line (worksuite-desktop#346): Chat's presence, sent now; the window hears it as a realtime event.
    setPresence: (status) => {
      tray.update({ presence: status });
      void http
        .post('/api/chat/presence', { status, active: true })
        .then(() => broadcast('realtime:event', { type: 'chat.presence', who: Number(sessionCtl.get().user?.id ?? 0), status: status === 'available' ? 'online' : status }))
        .catch((e) => {
          log.info('status not set from the tray', { error: String((e as Error)?.message ?? e) });
          void refreshTrayPresence();
        });
    },
    marketingNextContact: () => openNextContact('tray'),
    meetJoinNext: () => meetAction('meet-join-next', 'tray'),
    meetingOpen: (id) => meetingsDesk.openFromTray(id),
    meetStart: () => meetAction('meet-new', 'tray'),
    meetShare: () => meetAction('meet-share-screen', 'tray'),
    meetMute: () => meetAction('meet-mute', 'tray'),
    meetCamera: () => meetAction('meet-camera', 'tray'),
    projectTimerStop: () => void projects.timer.end().catch((e) => broadcast('toast', { kind: 'error', text: String((e as Error).message ?? e) })),
    projectTimerSwitch: (t) => void projects.timer.switchTo(t).catch((e) => broadcast('toast', { kind: 'error', text: String((e as Error).message ?? e) })),
    projectTimerResume: () => void projects.timer.resume().catch((e) => broadcast('toast', { kind: 'error', text: String((e as Error).message ?? e) })),
    projectTimerWindow: () => {
      if (lock.isLocked() || !sessionCtl.isReady()) return;
      windows.open('timer', '/projects/timer', 'Timer', true);
    },
  });
  assetsTray = (t) => tray.update({ assets: t });

  // ── website chats ring like calls (WS-WCHAT ENH-01, R3) ─────────────────
  const JOIN_SHORTCUT = 'CommandOrControl+Shift+J';
  // "Silence for 15 minutes" in the tray (MAP-22): website chats ring without the tone, and at-risk notifications
  // come without sound, until then — as Do not disturb kept to the card would (RING-47). Nothing else is paused.
  let liveSilencedUntil = 0;
  const liveSilenced = (): boolean => liveSilencedUntil > Date.now();
  // The system's own Focus / Do not disturb counts as Do not disturb for the ring, where it can be read (RING-47).
  const systemFocus = new SystemFocus({ onChange: () => webchat.refresh() });
  systemFocus.start();
  // Answers a visitor's voice call (ENH-WCHAT-05), held only while one rings.
  const ANSWER_SHORTCUT = 'CommandOrControl+Shift+A';
  let answerHeld = false;
  let onCall: WebchatOnCall | null = null;
  let bounceId: number | null = null;
  let flashing = false;
  let shortcutHeld = false;
  // Until joined or silenced: the Dock bounces (critical), the taskbar flashes, Linux sets urgency (RING-44).
  const attention = (on: boolean): void => {
    if (process.platform === 'darwin') {
      if (on && bounceId === null) bounceId = app.dock?.bounce('critical') ?? null;
      if (!on && bounceId !== null) {
        app.dock?.cancelBounce(bounceId);
        bounceId = null;
      }
      return;
    }
    const main = windows.getMain();
    if (main && flashing !== on) main.flashFrame(on);
    flashing = on;
  };
  // Registered only while something rings, released afterwards (RING-46).
  const joinShortcut = (on: boolean): boolean => {
    if (on && !shortcutHeld) {
      try {
        shortcutHeld = globalShortcut.register(JOIN_SHORTCUT, () => {
          const top = webchat.top();
          if (top) void webchat.join(top.id);
        });
      } catch {
        shortcutHeld = false;
      }
    } else if (!on && shortcutHeld) {
      globalShortcut.unregister(JOIN_SHORTCUT);
      shortcutHeld = false;
    }
    return shortcutHeld;
  };
  const answerShortcut = (on: boolean): boolean => {
    if (on && !answerHeld) {
      try {
        answerHeld = globalShortcut.register(ANSWER_SHORTCUT, () => {
          const top = webchat.topCall();
          if (top) void webchat.answerCall(top.id, true);
        });
      } catch {
        answerHeld = false;
      }
    } else if (!on && answerHeld) {
      globalShortcut.unregister(ANSWER_SHORTCUT);
      answerHeld = false;
    }
    return answerHeld;
  };
  const trayCalls = (s: WebchatRingState) => ({
    webchatRinging: s.chats.map((c) => ({ id: c.id, label: c.site ? `${c.visitor} · ${c.site}` : c.visitor, silenced: c.silenced })),
    webchatCalls: (s.calls ?? []).map((c) => ({ id: c.id, label: c.site ? `${c.visitor} · ${c.site}` : c.visitor })),
    webchatOnCall: onCall ? { conversationId: onCall.conversationId, label: onCall.visitor, held: onCall.held } : null,
  });
  const webchat: WebchatRinger = new WebchatRinger({
    http,
    signedIn: () => sessionCtl.isReady(),
    locked: () => lock.isLocked(),
    me: () => (sessionCtl.get().user?.id ? Number(sessionCtl.get().user?.id) : null),
    prefs: () => {
      const p = settings.effective();
      return { ...p.webchatRinging, ...(liveSilenced() ? { duringDnd: 'card' as const } : {}), volume: !p.notificationSounds || lock.isLocked() && p.lockedNotificationSounds === false ? 0 : p.webchatRinging.volume };
    },
    quiet: () => {
      const p = settings.effective();
      return (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, new Date())) || notifications.pausedUntilIso() !== null || liveSilenced() || systemFocus.active();
    },
    // With a call just answered, the thread joins its audio (`call=`).
    open: (id, callId, then) => navigate({ route: `/chat?view=website&website=${id}${callId ? `&call=${callId}` : ''}${then === 'transfer' ? '&transfer=1' : ''}`, source: 'notification' }),
    openInbox: () => navigate({ route: '/chat?view=website&section=inbox', source: 'notification' }),
    // A visitor who left before anyone joined (R-03): their chat in Missed chats, never opened in the inbox (which joins).
    openMissed: (id) => navigate({ route: `/chat?view=website&section=missed&website=${id}`, source: 'notification' }),
    // The ringing card's mini chat replies as the conversation's composer does (#225).
    reply: (conversationId, text) => notifications.sendWebsiteReply?.(conversationId, text) ?? Promise.resolve({ delivered: false, queued: false, id: null, status: null, data: null, error: 'You are signed out.', code: 'NOT_SIGNED_IN' }),
    // This installation as a ringing device (RING-10): the registered device's id, stable across restarts.
    deviceId: () => {
      const d = Number(device.current()?.id);
      return Number.isInteger(d) && d > 0 ? `desktop-${d}` : 'desktop-unregistered';
    },
    // Minimised counts as away from the conversation (#230): a minimised window is never focused.
    focused: () => {
      const w = BrowserWindow.getFocusedWindow();
      return (!!w && !w.isMinimized() && w.isFocused()) || powerMonitor.getSystemIdleTime() < 120;
    },
    followUpPrefs: () => ({ ...FOLLOW_UP_DEFAULTS, ...settings.effective().webchatFollowUps }),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    // While the live connection is down the list is read every 10 s (worksuite-desktop#251).
    realtimeUp: () => realtime.getState() === 'connected',
    // A chat found by reading the list is announced as its event would have been: the system notification with Join
    // and Reply when the card is not showing (#251).
    // Named by the ring's start, so a chat that rings again later is announced again (TRN-34).
    announce: (c) => notifications.handleRealtime(announceEvent(c)),
    testNotify: () => notifications.testChat(),
    onChanged: (s) => {
      broadcast('ring:changed', s);
      const prefs = settings.effective().webchatRinging;
      // A visitor who wrote again in my chat has the card too, when I keep it on (#230).
      const followUps = s.followUpCard !== false && !!s.followUps?.length;
      if ((s.followUps?.length ?? 0) !== followUpCount) {
        followUpCount = s.followUps?.length ?? 0;
        emitStatus();
      }
      // The card, or the mini chat on a chat just joined from it (#225), unless minimised; as tall as it measured itself.
      if ((s.chats.length || s.handoffs?.length || s.calls?.length || s.outcome || s.joined || followUps) && !s.minimised && prefs.window && (!lock.isLocked() || settings.effective().lockedChatNotifications !== false)) windows.showRinger(s.fit ?? ringerHeight(s));
      else windows.hideRinger();
      tray.update(trayCalls(s));
      // The Dock and taskbar badge count what rings until it is joined or silenced (RING-44).
      const nowRinging = s.chats.filter((c) => !c.silenced).length + (s.calls?.length ?? 0);
      if (nowRinging !== ringingCount) {
        ringingCount = nowRinging;
        emitStatus();
      }
      // The tray's ringing menu goes with the last chat ringing, and behind the lock (R-06) — unless it is the Live
      // mini-dashboard, which stays while it is open (L-05).
      if (s.hidden) windows.closeRingTray();
      else if (!s.chats.length && !livePulse.get()) windows.hideRingTray();
      // An at-risk chat as a system notification, withdrawn when somebody joins (MAP-23); the icon red while it lasts.
      atRisk.update(s);
      syncLive();
      const live = s.chats.some((c) => !c.silenced) || !!s.handoffs?.length;
      attention(live || !!s.calls?.length);
      webchat.shortcut = joinShortcut(live && prefs.shortcut);
      webchat.answerShortcut = answerShortcut(!!s.calls?.length && prefs.shortcut);
    },
  });
  // A visitor's message raises nothing while I look at that conversation; one writing again in my chat follows my
  // choice in Settings, and only while WorkSuite is not in front (worksuite-desktop#230).
  notifications.websiteAttending = (id) => webchat.attending(id);
  notifications.followUpDesktop = () => ({ ...FOLLOW_UP_DEFAULTS, ...settings.effective().webchatFollowUps }).desktop;
  notifications.lastInputAt = () => Date.now() - powerMonitor.getSystemIdleTime() * 1000;
  calls.attention = (key, context) => notifications.requestAttention(key, context);
  notifications.staffCallWindowOn = () => calls.canShowRing();
  notifications.isFocused = () => {
    const w = BrowserWindow.getFocusedWindow();
    return !!w && !w.isMinimized() && w.isFocused();
  };
  notifications.ringerShowing = () => settings.effective().webchatRinging.window && (webchat.state().chats.length > 0 || !!webchat.state().handoffs?.length || !!webchat.state().calls?.length);
  // The call window shows a visitor's call whenever it is on and the lock lets it (V-04): as onChanged decides.
  notifications.callWindowOn = () => settings.effective().webchatRinging.window && (!lock.isLocked() || settings.effective().lockedChatNotifications !== false);
  // The tray's ringing menu (R-06, RING-UI-07; UX-ALR-02): by the icon while chats ring, never behind the lock — the
  // plain menu says only what it always says there.
  let ringTrayHeight: number | null = null;
  const ringTray = {
    show: (anchor: Electron.Rectangle | null): boolean => {
      const s = webchat.state();
      // For website staff the menu is the Live mini-dashboard (L-05, MAP-22), ringing or not.
      const live = !!livePulse.get();
      if (lock.isLocked() || s.hidden || (!s.chats.length && !live)) return false;
      windows.showRingTray(anchor, ringTrayHeight ?? (live ? 640 : 120 + Math.min(4, s.chats.length) * 64), live);
      void livePulse.read();
      return true;
    },
    fit: (height: number): void => {
      ringTrayHeight = height;
      windows.fitRingTray(height);
    },
    act: (action: 'inbox' | 'settings' | 'quit' | 'close' | 'dashboard' | 'liveMap' | 'wall' | 'silence'): void => {
      windows.hideRingTray();
      if (action === 'inbox') navigate({ route: '/chat?view=website&section=inbox', source: 'tray' });
      else if (action === 'settings') navigate({ route: '/settings/notifications', source: 'tray' });
      else if (action === 'quit') quit();
      else if (action === 'dashboard') liveDesk.open('dashboard');
      else if (action === 'liveMap') liveDesk.open('map');
      // Wall mode on Display 2 asks first which screen and how (WF-M3); while the wall is up, the item closes it (MAP-24).
      else if (action === 'wall') liveDesk.open(windows.wallOpen() ? 'wallClose' : 'wallSheet');
      else if (action === 'silence') {
        liveSilencedUntil = Date.now() + 15 * 60_000;
        webchat.refresh();
      }
    },
  };

  // ── the Live dashboard outside the main window (L-04, L-05; MAP-21…25) ──
  // The figures the menu-bar icon carries, read with the main window closed (MAP-22).
  const livePulse = new LivePulse({
    http,
    allowed: () => sessionCtl.isReady() && canOpenApp('chat', sessionCtl.visibleApps()),
    onChanged: () => syncLive(),
  });
  const atRisk = new AtRiskAlerts({
    allowed: () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('chat', sessionCtl.visibleApps()) && settings.effective().notificationsEnabled !== false,
    quiet: () => {
      const p = settings.effective();
      return (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, new Date())) || notifications.pausedUntilIso() !== null || liveSilenced() || systemFocus.active();
    },
    duringDnd: () => (liveSilenced() ? 'card' : settings.effective().webchatRinging.duringDnd),
    sound: () => settings.effective().notificationSounds,
    join: (id) => void webchat.join(id),
    showOnMap: (id) => liveDesk.open('map', id),
  });
  // ⌘⇧M shows or hides the Live map window and ⌘⇧D opens the Live dashboard from other apps (MAP-21, MAP-22). Held
  // only while WorkSuite is not in front: in WorkSuite the keys keep their own meanings (Dock Tab Beside, mute on a call),
  // and the Live map window and the tray's mini-dashboard answer them themselves.
  const LIVE_MAP_SHORTCUT = 'CommandOrControl+Shift+M';
  const LIVE_DASHBOARD_SHORTCUT = 'CommandOrControl+Shift+D';
  let liveKeysHeld = false;
  const syncLiveKeys = (): void => {
    // Unless turned off in Settings › Notifications & calls › Shortcuts.
    const want = settings.effective().webchatRinging.liveShortcuts !== false && !!livePulse.get() && !lock.isLocked() && !BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
    if (want === liveKeysHeld) return;
    if (want) {
      try {
        const map = globalShortcut.register(LIVE_MAP_SHORTCUT, () => liveDesk.open('toggleMap'));
        const dash = globalShortcut.register(LIVE_DASHBOARD_SHORTCUT, () => liveDesk.open('dashboard'));
        liveKeysHeld = map || dash;
      } catch {
        liveKeysHeld = false;
      }
    } else {
      globalShortcut.unregister(LIVE_MAP_SHORTCUT);
      globalShortcut.unregister(LIVE_DASHBOARD_SHORTCUT);
      liveKeysHeld = false;
    }
  };
  app.on('browser-window-focus', () => syncLiveKeys());
  app.on('browser-window-blur', () => setImmediate(syncLiveKeys));
  // Open wall mode when WorkSuite starts (L-06, MAP-24): once a launch, as soon as the dashboard answers for somebody
  // who staffs website chat.
  let wallStarted = false;
  const syncLive = (): void => {
    const f = livePulse.get();
    if (f && !wallStarted) {
      wallStarted = true;
      if (wallPrefsOf(settings.effective().wallMode).openAtStart && !lock.isLocked()) liveDesk.open('wall');
    }
    tray.update({ live: f ? { online: f.online, atRisk: f.atRisk > 0 || webchat.state().chats.some((c) => c.atRisk) } : null });
    syncLiveKeys();
  };
  // When the wall's screen was last unplugged (MAP-24 "the tray says so"), until the wall opens again.
  let wallGoneAt: string | null = null;
  const wallTo = () => wallTarget(screen.getAllDisplays(), screen.getPrimaryDisplay().id, wallPrefsOf(settings.effective().wallMode).displayId);
  const liveDesk = {
    open: (to: 'map' | 'toggleMap' | 'dashboard' | 'wall' | 'wallSheet' | 'wallClose' | 'chat', id?: number): void => {
      windows.hideRingTray();
      if (to === 'map') windows.showLiveMap(id ?? null);
      else if (to === 'toggleMap') windows.toggleLiveMap();
      else if (to === 'dashboard') navigate({ route: '/chat?view=website&section=dashboard', source: 'tray' });
      else if (to === 'wall') {
        wallGoneAt = null;
        windows.showWall(wallTo()?.id ?? null, { keepAwake: wallPrefsOf(settings.effective().wallMode).keepAwake });
      } else if (to === 'wallSheet') windows.showWallSheet();
      else if (to === 'wallClose') windows.closeWall();
      else if (to === 'chat' && id) navigate({ route: `/chat?view=website&website=${id}`, source: 'tray' });
    },
    info: () => {
      const t = wallTo();
      const prefs = wallPrefsOf(settings.effective().wallMode);
      return {
        wall: t ? { display: t.display, name: t.name } : null,
        displays: wallDisplays(screen.getAllDisplays(), windows.mainDisplayId()),
        wallPrefs: { ...prefs, displayId: t?.id ?? prefs.displayId },
        wallOpen: windows.wallOpen(),
        wallGone: wallGoneAt,
        silencedUntil: liveSilenced() ? new Date(liveSilencedUntil).toISOString() : null,
        shortcuts: liveKeysHeld,
      };
    },
    // The sheet's Open on Display 2 (MAP-24): its choices kept for next time, the wall opened there, the sheet gone.
    wall: (choice: { displayId: number; keepAwake: boolean; cycle: boolean; openAtStart: boolean }): void => {
      settings.update({ wallMode: wallPrefsOf(choice) });
      windows.closeWallSheet();
      liveDesk.open('wall');
    },
  };
  // The wall's display was unplugged (MAP-24): its window has closed, and WorkSuite says so — a notification now, and
  // the tray's mini-dashboard until the wall opens again.
  windows.onWallGone = () => {
    wallGoneAt = new Date().toISOString();
    if (Notification.isSupported()) new Notification({ title: 'Wall mode closed', body: 'Its display was disconnected.', silent: true }).show();
  };
  const webchatOnCall = (c: WebchatOnCall | null): void => {
    onCall = c;
    webchatCallLive = !!c;
    tray.update(trayCalls(webchat.state()));
    onUpdateActivity();
  };

  // ── Quick Ask over any app (AI Assistant) ───────────────────────────────
  // The keyboard helper remote control uses, started once, on first use, for copy and paste only.
  let askHelper: Promise<Injector | null> | null = null;
  const quickAskHelper = (): Promise<Injector | null> => {
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) return Promise.resolve(null);
    askHelper ??= (async () => {
      const inj = createInjector(process.platform);
      if (!inj) return null;
      const ok = await inj.start().catch(() => false);
      if (!ok) {
        askHelper = null;
        return null;
      }
      inj.onExit = () => {
        askHelper = null;
      };
      return inj;
    })();
    return askHelper;
  };
  // The assistant's rules here (the device policy and the company's), confirming, local files (DSK-2…7).
  const ai = new AiService({
    get: (path, query) => http.get(path, { query }),
    post: (path, body) => http.post(path, body, { timeoutMs: 120_000 }),
    postStream: (path, body) => http.postStream(path, body, { timeoutMs: 180_000 }),
    policy: () => (sessionCtl.isReady() ? (sessionCtl.current()?.policy ?? null) : null),
    driveIdAt: (p) => sync.fileIdAt(p),
    realpath: (p) => fsp.realpath(p),
    size: async (p) => (await fsp.stat(p)).size,
    read: (p) => fsp.readFile(p),
  });
  const quickAsk: QuickAsk = new QuickAsk({
    clipboard,
    platform: process.platform,
    injector: quickAskHelper,
    // Insert only where the company and this computer's policy both allow it.
    prefs: () => ({ ...settings.effective().ai, insert: settings.effective().ai.insert && ai.rules().insert }),
    allowed: () => {
      const b = sessionCtl.isReady() && !lock.isLocked() ? sessionCtl.current() : null;
      const may = !!b && (b.permissions.includes('*') || b.permissions.includes('ai.write') || b.permissions.includes('ai.assistant.use'));
      return may && ai.rules().quickAsk;
    },
    register: (acc, fn) => globalShortcut.register(acc, fn),
    unregister: (acc) => globalShortcut.unregister(acc),
    show: () => windows.showQuickAsk(),
    hide: () => windows.hideQuickAsk(),
  });
  const aiPending = new AiPendingWatcher({
    get: (path, query) => http.get(path, { query }),
    notify: (n) => notifications.notify(n),
    enabled: () => ai.rules().enabled && !lock.isLocked(),
    onCount: (n) => tray.update({ aiChanges: n }),
  });
  // ── Marketing outside the window (WS-MKT-SRS-001 MKT-DSK-01, MKT-CAL-12) ──
  // The tray's counts, callback reminders to the minute, and the Next contact key — for somebody with Marketing.
  const marketingVisible = (): boolean => sessionCtl.isReady() && canOpenApp('marketing', sessionCtl.visibleApps());
  const marketingPulse: MarketingPulse = new MarketingPulse({
    get: (path, query) => http.get(path, { query }),
    allowed: marketingVisible,
    onChange: (m) => {
      tray.update({ marketing: m });
      // Whether the person has a call queue at all decides whether the key is worth holding.
      nextContactKey.sync();
    },
  });
  // ⌘⇧N / Ctrl+Shift+N from other apps (the D01 design). In WorkSuite the keys are "Move tab to new window", so — like
  // the Live keys — held only while no WorkSuite window is in front, and given back on focus, lock, sign-out and quit.
  const nextContactKey = new NextContactKey({
    register: (acc, fn) => globalShortcut.register(acc, fn),
    unregister: (acc) => globalShortcut.unregister(acc),
    state: () => {
      const pulse = marketingPulse.get();
      return {
        signedIn: sessionCtl.isReady(),
        locked: lock.isLocked(),
        marketing: marketingVisible(),
        agent: pulse ? pulse.queue !== null : null,
        focused: BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused()),
      };
    },
    press: () => openNextContact('shortcut'),
  });
  app.on('browser-window-focus', () => nextContactKey.sync());
  app.on('browser-window-blur', () => setImmediate(() => nextContactKey.sync()));

  /*
   * "Pop out the call when I switch apps" (D05): the meeting shrinks to a card
   * that floats over whatever you moved to, and goes back when you return.
   *
   * Only when no WorkSuite window is in front — moving between WorkSuite's own
   * windows is not switching apps, and a meeting that shrank every time
   * somebody clicked their inbox would be unusable. The same test the Next
   * contact key uses, for the same reason.
   */
  let poppedOut = false;
  const anyWindowFocused = (): boolean => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
  const syncPopOut = (): void => {
    if (settings.effective().meetBehaviour?.popOutOnSwitch !== true) {
      poppedOut = false;

      return;
    }

    const win = liveMeetWindow();

    if (!win) {
      poppedOut = false;

      return;
    }

    const away = !anyWindowFocused();

    if (away === poppedOut) return;

    poppedOut = away;
    // Only ever undoes what it did: a card the person shrank themselves is
    // left alone when they come back.
    windows.setCompact(win, away, 'card');
  };

  app.on('browser-window-focus', () => syncPopOut());
  app.on('browser-window-blur', () => setImmediate(() => syncPopOut()));

  /*
   * Meet's global keys (WS-MEET-ENH-01 D06): mute, camera, join the next
   * meeting, share a screen, start a meeting.
   *
   * Unlike Marketing's key these are not given back on focus — ⌘⇧M is not the
   * shell's anything, and muting yourself while WorkSuite is in front is the
   * ordinary case. They are held only while they can act: mute and camera
   * while a meeting is live on this computer, none of them while locked or
   * signed out.
   */
  const meetKeys = new MeetKeys({
    register: (acc, fn) => globalShortcut.register(acc, fn),
    unregister: (acc) => globalShortcut.unregister(acc),
    state: () => ({
      signedIn: sessionCtl.isReady(),
      locked: lock.isLocked(),
      meet: canOpenApp('meet', sessionCtl.visibleApps()),
      inCall: !!liveMeetWindow(),
      globalKeys: settings.effective().meetBehaviour?.globalKeys !== false,
    }),
    accelerators: () => {
      const defaults = meetShortcutDefaults(process.platform === 'darwin');
      const overrides = settings.effective().shortcuts ?? {};

      return Object.fromEntries(MEET_GLOBAL_IDS.map((id) => [id, overrides[id] ?? defaults[id]!])) as Partial<Record<MeetGlobalKey, string>>;
    },
    press: (id) => meetAction(id, 'shortcut'),
    warn: (message, detail) => log.warn(message, detail),
  });
  /*
   * What the tray shows for Meet (D04): the next meeting to join, and whether
   * this computer is in one. Polled in the main process because the tray is
   * read with every window closed — the same `GET /api/meet/upcoming` the Meet
   * home asks, and the same idea of "joinable", so the two never disagree.
   */
  const meetNext = new MeetNext({
    get: (path, query) => http.get(path, { query }),
    allowed: () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('meet', sessionCtl.visibleApps()),
    inCall: () => !!liveMeetWindow(),
    onChange: (meet) => tray.update({ meet, shortcutLabels: meetKeyLabels() }),
  });
  /** Each Meet key as a menu shows it, so a tray line can carry its shortcut without registering it. */
  const meetKeyLabels = (): Record<string, string> => {
    const defaults = meetShortcutDefaults(process.platform === 'darwin');
    const overrides = settings.effective().shortcuts ?? {};

    return Object.fromEntries(
      Object.keys(defaults)
        .map((id) => [id, electronAccelerator(overrides[id] ?? defaults[id])])
        .filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
    );
  };
  // A meeting starting or ending decides whether mute and camera are held.
  calls.onListChanged = ((previous) => (list: ActiveCall[]) => {
    previous(list);
    meetKeys.sync();
    // In or out of a meeting changes both the keys held and the tray's lines.
    meetNext.publish();
    meetNext.poke();
  })(calls.onListChanged);
  settings.onChange(() => {
    meetKeys.sync();
    meetNext.publish();
  });
  const callbackReminders = new CallbackReminders({
    get: (path, query) => http.get(path, { query }),
    notify: (n) => notifications.notify(n),
    allowed: marketingVisible,
  });
  notifications.snoozeCallback = (c) => callbackReminders.snooze(c);
  const syncQuickAsk = (): void => {
    quickAsk.sync();
    tray.update({ quickAsk: quickAsk.shortcut() });
    // Support's quick-reply shortcut follows the same moments: sign-in, the lock, the settings.
    syncSupportKeys();
  };

  // ── what the person may open (shared/access.ts) ───────────────────────
  // READ_CACHE: which module's answers a GET path is.
  const CACHE_PREFIXES: Array<[string, string]> = [
    // User guides: the list and each guide read, for reading offline.
    ['/api/help/guides', 'help'],
    ['/api/mail/folders', 'mail'],
    ['/api/mail/mailboxes', 'mail'],
    ['/api/mail/messages', 'mail'],
    // The sidebar's counts, labels, the list's layout and the sync card: Mail opens offline as it was left.
    ['/api/mail/views', 'mail'],
    ['/api/mail/labels', 'mail'],
    ['/api/mail/prefs', 'mail'],
    ['/api/mail/sync/status', 'mail'],
    // Mail protection (ENH-MAIL-04): the quarantine as last seen opens offline; releasing it waits for the connection.
    ['/api/mail/quarantine', 'mail'],
    ['/api/whatsapp/accounts', 'chat'],
    ['/api/whatsapp/chats', 'chat'],
    ['/api/chat/rooms', 'chat'],
    ['/api/chat/messages', 'chat'],
    // Website chats: the list and each conversation opened, so a thread opens at once from its last copy (#239).
    ['/api/chat/widget-admin/conversations', 'chat'],
    // Missed chats and Offline enquiries too, so every website list opens at once from its last copy (#252).
    ['/api/chat/widget-admin/missed', 'chat'],
    ['/api/chat/widget-admin/offline', 'chat'],
    // The Live dashboard (its summary, the full answer) and who is on the sites, so it opens at once from its last copy (#248).
    ['/api/chat/widget-admin/dashboard', 'chat'],
    ['/api/chat/widget-admin/visitors', 'chat'],
    ['/api/calendar/events', 'calendar'],
    // Social Media Manager (SMM-DSK-004): the calendar, drafts and the accounts they go to, as last seen, open offline.
    // Scheduling and publishing stay on the server; nothing here is sent from the cache.
    ['/api/social-media/posts', 'social-media'],
    ['/api/social-media/accounts', 'social-media'],
    ['/api/social-media/brands', 'social-media'],
    ['/api/tasks', 'tasks'],
    ['/api/task-lists', 'tasks'],
    // WorkSuite Projects (PRJ-DSK-04): the boards opened (the pinned ones are fetched ahead by the screens), my work,
    // my time for the last 30 days, the list and the counts, so the app opens offline as it was last seen.
    ['/api/projects', 'projects'],
    ['/api/crm/leads', 'crm'],
    ['/api/hr/attendance/me', 'hr'],
    ['/api/hr/leave', 'hr'],
    ['/api/hr/approvals/pending', 'hr'],
    ['/api/files/browse', 'files'],
    // How Drive opens each kind of Office file (web-api §6), so an Office file offline still goes to its tab.
    ['/api/files/office/types', 'files'],
    ['/api/dashboard/home', 'home'],
    ['/api/notifications', 'notifications'],
    // A workshop terminal opens with WorkSuite out of reach: the technician's work and the board as last seen,
    // and the job cards (with their check-in, estimate, work and delivery), vehicles, customers and workshop.
    ['/api/garage/v1/options', 'garage'],
    ['/api/garage/v1/overview', 'garage'],
    ['/api/garage/v1/board', 'garage'],
    ['/api/garage/v1/my-work', 'garage'],
    ['/api/garage/v1/jobs', 'garage'],
    ['/api/garage/v1/vehicles', 'garage'],
    ['/api/garage/v1/customers', 'garage'],
    ['/api/garage/v1/workshop', 'garage'],
    // A learner opens My Learning, the catalogue and their courses' outlines (with the lessons already opened)
    // from the last copy; a course's lesson files kept offline are elearning-offline.ts's, not this cache's.
    // A till opens with WorkSuite out of reach: what the cashier may do, the registers and their drawer as last seen.
    ['/api/pos/options', 'pos'],
    ['/api/pos/registers', 'pos'],
    ['/api/pos/sessions', 'pos'],
    ['/api/pos/setup', 'pos'],
    ['/api/elearning/v1/options', 'elearning'],
    ['/api/elearning/v1/me/learning', 'elearning'],
    ['/api/elearning/v1/me/courses', 'elearning'],
    ['/api/elearning/v1/me/lessons', 'elearning'],
    ['/api/elearning/v1/catalog', 'elearning'],
    ['/api/elearning/v1/categories', 'elearning'],
    // Support: the rail and its counts, the lists, every ticket opened and the desk's vocabulary, so the desk opens
    // offline as it was left; who else is on a ticket is never taken from this copy (modules/support/api.ts).
    ['/api/support/v1/meta', 'support'],
    ['/api/support/v1/views', 'support'],
    ['/api/support/v1/badges', 'support'],
    ['/api/support/v1/tickets', 'support'],
    ['/api/support/v1/agents', 'support'],
    ['/api/support/v1/canned', 'support'],
    // Sales (WS-OMS-SRS-001 FR-DSK-07): the dashboard, the companies and every order list and order opened, so recent
    // orders read offline as last seen. Read only: every write in the app waits for the connection.
    ['/api/oms/overview', 'sales'],
    ['/api/oms/organizations', 'sales'],
    ['/api/oms/orders', 'sales'],
    // Billing (SRS-BIL-001 §16, per Desktop offline mode): the dashboard, the companies, every invoice list and invoice
    // opened, payments and customers, so Billing reads offline as last seen. Read only: its writes wait for the connection.
    ['/api/billing/dashboard', 'billing'],
    ['/api/billing/organizations', 'billing'],
    ['/api/billing/invoices', 'billing'],
    ['/api/billing/payments', 'billing'],
    ['/api/billing/customers', 'billing'],
    // Purchasing (SRS-PUR-001 G-21): the dashboard, the approvals waiting on me, the order, receipt, request, RFQ, bill,
    // payment and return lists and every one opened, and the vendors, so Purchasing reads offline as last seen. Read
    // only: every write in the app waits for the connection.
    ['/api/inventory/purchase/dashboard', 'purchase'],
    ['/api/inventory/purchase-orders', 'purchase'],
    ['/api/inventory/receipts', 'purchase'],
    ['/api/inventory/requests', 'purchase'],
    ['/api/inventory/quotations', 'purchase'],
    ['/api/inventory/bills', 'purchase'],
    ['/api/inventory/payments', 'purchase'],
    ['/api/inventory/payables', 'purchase'],
    ['/api/inventory/returns', 'purchase'],
    ['/api/inventory/vendors', 'purchase'],
    ['/api/purchase/approvals', 'purchase'],
    ['/api/purchase/qc', 'purchase'],
    ['/api/purchase/agreements', 'purchase'],
    ['/api/purchase/payment-runs', 'purchase'],
    ['/api/purchase/payables', 'purchase'],
    ['/api/purchase/landed-costs', 'purchase'],
    // Inventory (the desktop's offline stock count): the dashboard, the companies' warehouses, the products and their
    // categories, and every count list and count sheet opened, so a count goes on from this computer's copy with
    // WorkSuite out of reach. The counts typed there are queued (offline:submit) and sent in order when it is back;
    // nothing is posted to stock offline.
    ['/api/inventory/companies', 'inventory'],
    ['/api/inventory/dashboard', 'inventory'],
    ['/api/inventory/warehouses', 'inventory'],
    ['/api/inventory/products', 'inventory'],
    ['/api/inventory/categories', 'inventory'],
    ['/api/inventory/counts', 'inventory'],
    // Hotel PMS keeps the rack and the front desk's lists per property (shared/pms-cache.ts: `pmsCached`), below;
    // the Events tab its options, the events and their gates (shared/event-desk.ts: `eventsCached`).
  ];
  const rebuildMenu = (visible: Set<string>): void =>
    buildMenu(
      (id, arg) => {
        windows.showMain();
        broadcast('command', { id, arg });
      },
      {
        checkUpdates: () => void updater.check().then(() => navigate({ route: '/settings/updates', source: 'menu' })),
        diagnostics: () => navigate({ route: '/diagnostics', source: 'menu' }),
        reportProblem: () => void shell.openExternal(reportProblemUrl(app.getVersion())),
        quit,
      },
      { ai: canOpenApp('ai', visible) },
    );
  /**
   * A new bootstrap: the tray and the menu offer only the apps it allows, and
   * what this computer saved of an app the person no longer has is removed.
   * (Every window gets it as `session:changed`; the Shell closes those tabs.)
   */
  const applyAccess = (b: Bootstrap | null): void => {
    const visible = visibleAppIds(b);
    tray.update({ apps: [...visible] });
    rebuildMenu(visible);
    // Marketing given or taken away (or another organisation): its counts, reminders and key follow.
    marketingPulse.poke();
    callbackReminders.poke();
    nextContactKey.sync();
    meetKeys.sync();
    meetNext.poke();
    meetingsDesk.poke();
    // Purchasing given or taken away: the documents waiting on me follow on the badge.
    void purchaseDesk.refresh();
    // Sinhala Tools turned on or off for the organisation, or this person: asked again (WF-SI-05).
    if (b) void sinhala.sync();
    if (b) {
      const closed = windows.closeWhere((route) => !canOpenRoute(route, visible));
      if (closed) log.info('windows closed: app no longer available', { closed });
    }
    if (b) {
      for (const module of cache.modules(b.user.id)) {
        if (!canOpenApp(module, visible) && cache.clearModule(b.user.id, module) > 0) log.info('offline data removed: app no longer available', { module });
      }
      // Courses kept offline go with the app.
      if (!canOpenApp('elearning', visible)) void elearning.wipeUser(b.user.id).catch((e) => log.warn('offline courses not removed', { error: String(e) }));
      // Board packs kept offline go with the Board app.
      if (!canOpenApp('board', visible)) board.wipe('policy');
      // So do an event desk's copies of the gates' tickets (scans still unsent wait, should the app come back).
      if (!canOpenApp('events', visible)) eventDesk.signedOut(b.user.id);
      if (!canOpenApp('restaurant', visible)) restaurant.signedOut(b.user.id);
      // The Phone's global shortcuts go with it.
      if (!canOpenApp('phone', visible)) phone.reset();
    }
    emitStatus();
  };

  // ── the session ────────────────────────────────────────────────────────
  const startServices = (b: Bootstrap): void => {
    const uid = b.user.id;
    setExternalAllowList([new URL(auth.getServer()!.origin).hostname]);
    if (settings.effective().backgroundServices.realtime) realtime.start();
    notifications.start(uid);
    payrollReminders.start();
    assetAlerts.start();
    mailAlerts.start();
    supportNotices.start();
    supportDesk.start();
    supportUrgent.start();
    webchat.start();
    livePulse.start();
    syncQuickAsk();
    // Sinhala Tools: profiles on sign-in and daily; the tools show once the server says they are on (blueprint §6.1).
    sinhala.start();
    void sinhala.sync();
    // Quick Ask waits on the company's rules; once they are known, it is offered (or not).
    void ai.refresh().then(() => {
      syncQuickAsk();
      aiPending.start();
    });
    marketingPulse.start();
    meetNext.start();
    meetingsDesk.start();
    callbackReminders.start();
    device.start();
    device.extras = () => {
      const c = transfers.activeCounts();
      const s = sync.health();
      return { pendingUp: queue.pendingCount(uid) + salonSync.pending() + eventDesk.pending() + pos.pending() + restaurant.sync.pending() + c.uploads + s.pendingUp, pendingDown: c.downloads + s.pendingDown, lastError: s.lastError };
    };
    sync.start(uid);
    transfers.recover();
    // Recordings carry on from where they were: a recording cut off by a crash is finished, uploads continue.
    void meetRecorder.recover().catch(() => undefined);
    void queue.replay(uid);
    salonSync.start();
    eventDesk.start();
    restaurant.start();
    projects.start();
    label.host.start();
    // Courses kept offline: the ones whose learning ended, or whose licence ran out, go.
    void elearning.validate().catch((e) => log.warn('offline courses not checked', { error: String(e) }));
    // Board: what waited offline goes up, revocations and expiries are applied.
    void board.sync().catch(() => undefined);
    void audit.flush();
    void refreshAttendance();
    attendanceTimer = setInterval(() => void refreshAttendance(), 5 * 60_000);
    attendanceTimer.unref?.();
    stopPresence();
    void heartbeatPresence();
    void refreshTrayPresence();
    presenceTimer = setInterval(() => void heartbeatPresence(), 30_000);
    presenceTimer.unref?.();
    // What this computer can do for Meet remote control (WF-RC-08), once the device is known.
    setTimeout(reportCapabilities, 5_000).unref?.();
    accessWatch.start();
    // FR-OFF-06: prune mail bodies beyond the cache window.
    const days = settings.effective().mailCacheDays;
    // A folder kept whole on this computer is not pruned by age (worksuite-desktop#162).
    const keepAll = (path: string) => mailKeptForever(settings.effective(), path);
    if (days > 0) cache.pruneModuleOlderThan('mail', days, keepAll);
    // A mailbox's own keep period (Settings › Mail › Storage & sync, D09).
    const me = sessionCtl.current()?.user?.id;
    for (const [box, d] of Object.entries(settings.effective().mailCacheDaysByMailbox ?? {})) if (me) cache.pruneMailbox(String(me), box, d, keepAll);
    mailBodies.start();
    emitStatus();
  };
  const stopServices = (): void => {
    sinhala.stop();
    sinhala.signedOut();
    mailBodies.stop();
    projects.stop();
    void remoteControl.shutdown('logout');
    webchat.stop();
    livePulse.stop();
    atRisk.clear();
    liveSilencedUntil = 0;
    windows.closeRingTray();
    quickAsk.release();
    ai.forget();
    aiPending.stop();
    marketingPulse.stop();
    meetNext.stop();
    meetingsDesk.stop();
    callbackReminders.stop();
    nextContactKey.release();
    meetKeys.releaseAll();
    windows.hideQuickAsk();
    tray.update({ quickAsk: null });
    // Torn-off windows show the person's data: they close, and come back at their next sign-in.
    windows.closeRecords();
    // So do chat windows and every other secondary window with someone's content in it (#103).
    windows.closeWhere(() => true);
    // Open documents close, and their editor partitions are cleared (OO-DSK-023).
    office.closeAll(true);
    officeLocal.stop();
    // Open PDFs close, and passwords remembered for the session are forgotten.
    void pdfStudio.closeAll();
    // Local AI's model stops; the models on this computer stay.
    void localAI.signedOut();
    // The compact phone's global shortcuts are released.
    phone.reset();
    realtime.stop();
    notifications.stop();
    payrollReminders.stop();
    assetAlerts.stop();
    purchaseDesk.reset();
    mailAlerts.stop();
    supportNotices.stop();
    supportDesk.stop();
    supportUrgent.stop();
    syncSupportKeys();
    device.stop();
    transfers.stopAll();
    sync.stop();
    salonSync.stop();
    eventDesk.stop();
    restaurant.stop();
    if (attendanceTimer) clearInterval(attendanceTimer);
    label.host.stop();
    attendanceTimer = null;
    stopPresence();
    accessWatch.stop();
    tray.update({ attendance: null, apps: [] });
    rebuildMenu(new Set());
    // Where a notification clicked while locked pointed: not for whoever signs in next.
    pendingNav.length = 0;
    lock.reset();
    emitStatus();
  };

  /** Who WorkSuite Office may offer to continue as: the signed-in person, or nobody. */
  const desktopAccountOf = (ready: boolean) => {
    const origin = auth.getServer()?.origin;
    const user = sessionCtl.current()?.user ?? sessionCtl.get().user;
    if (!ready || !origin || !user) return null;
    return { server: origin, user: { id: String(user.id), name: user.name, email: user.email ?? '', organization: user.organizationName ?? '' } };
  };

  sessionCtl = new SessionController(db, auth, device, bootstrap, fetchImpl, enterprise, {
    started: (b) => startServices(b),
    stopped: () => stopServices(),
    wiped: (uid, scope, includeDrafts, keepUnsynced) => {
      // WF-24 / FR-SEC-08: WorkSuite's own data only. Nothing outside the
      // profile is touched; downloaded files the user saved are theirs.
      cache.clearUser(uid);
      notifications.clearUser(uid);
      // The salon day's copy is cache; what the desk made waits for its maker (salon-sync.ts).
      salonSync.signedOut(uid);
      // So is an event desk's offline copy; the scans made offline wait for the person who made them (event-desk.ts).
      eventDesk.signedOut(uid);
      // And the till's menu and floor copy; orders kept offline wait for whoever took them (restaurant/sync.ts).
      restaurant.signedOut(uid);
      db.run('DELETE FROM tab_sessions WHERE user_id = ?', uid);
      if (scope !== 'tokens') {
        // A plain sign-out keeps what has not reached the server (Connection & Startup §5, "N pending changes
        // kept"): the queue, the Projects outbox, queued uploads and Office copies with edits wait for the next
        // sign-in. They go only when the person discards them, with a wipe, or by the `sign_out_wipe` policy.
        if (!keepUnsynced) {
          queue.wipeUser(uid, includeDrafts);
          // Projects' outbox and snoozed banners, as the offline queue's (PRJ-DSK-04: cleared on sign-out).
          projects.wipeUser(uid);
          transfers.wipe(uid);
          // Copies opened in other apps are no longer watched; the files stay the person's.
          officeLocal.forgetUser(uid);
        }
        officeFiles.forget();
        // The app-lock PIN goes with the rest of what this computer kept for the person.
        lockPin.clear(uid);
        // PDF Studio's working copies and thumbnails (PDF-OFF-005).
        void pdfStudio.wipe();
      }
      // What Drive sync put on this computer counts as offline files (§11.2 wipe_on_revoke).
      if (scope === 'cache+offline_files') void sync.wipe(uid, false);
      // So are the courses kept for offline learning.
      if (scope === 'cache+offline_files') void elearning.wipeUser(uid).catch(() => undefined);
      // And Board's offline vault (FR-DEV-02): its own folder and keys, never the person's files.
      if (scope === 'cache+offline_files') board.wipeAll();
      // A remote wipe, or signing out with "remove WorkSuite's data", forgets
      // the salon desk this computer was, and its printers; a plain sign-out keeps them.
      if (includeDrafts) {
        salonDesk.forgetAll();
        salonPrint.forgetAll();
        salonSync.forgetAll();
        // Every event this computer was a check-in device at: the keys, the copies, the queues, the badge printer.
        eventDesk.forgetAll();
        eventDeskPrint.forgetAll();
        salesDesk.forgetAll();
        // The till this computer was: its credential, catalogue, sales (sent or not) and printer settings.
        pos.forgetAll();
        // The restaurant terminal this computer was: its key, copy, outbox and printer mapping.
        restaurant.forgetAll();
        // Label Studio's printers, registration and print journal on this computer (the gateway's identity is the computer's).
        label.forgetAll();
        // The door-lock servers this computer's front desk talked to, and their secrets.
        pmsLocks.wipe();
        // The iCloud and CardDAV passwords contact sync kept for this computer.
        contactSync.wipe();
        // Sinhala Tools' profile cache, settings and queued uploads for this person.
        sinhala.forget();
      }
      log.info('local data removed', { scope });
    },
    changed: (s) => {
      desktopAccounts.update(desktopAccountOf(s.stage === 'ready'));
      // Signing in ends guest mode (the window may then offer to move its data here); signing out closes the Local Profile.
      if (s.stage === 'ready' && !wasSignedIn) localSession.signedIn(localAccountKey());
      else if (s.stage !== 'ready' && wasSignedIn) localSession.signedOut();
      wasSignedIn = s.stage === 'ready';
      lockPin.setServerScope(s.server?.origin ?? null);
      // Per person and account (`<account>:<uid>`, §1.5 step 4); the server's origin before any account exists.
      settings.setUserLanguageScope(registry.activeId() ?? s.server?.origin ?? null, s.user?.id ?? null);
      accountFollowsSession(s);
      broadcast('auth:changed', s);
      emitStatus();
      if (s.stage === 'ready') {
        flushNavigation();
        void calls.check();
      }
    },
    bootstrapChanged: (b) => {
      // A new name, picture or organisation for WorkSuite Office's "Continue as".
      desktopAccounts.update(desktopAccountOf(sessionCtl.isReady()));
      if (b) settings.setPolicy(b.policy);
      if (b) void appearanceSync.pull();
      // Office's Local AI policy follows the session: refreshed with the bootstrap, cleared when nobody is signed in.
      void (b ? officeAiPolicy.sync() : officeAiPolicy.clear()).catch(() => undefined);
      // Policy or trust may have turned sync on or off.
      sync.kick('policy');
      applyAccess(b);
      // Windows opened from now on allow the announced media server (calls
      // and Meet each open their own window, so none needs reloading).
      if (b?.source === 'desktop-v1' && b.mediaServers && JSON.stringify(b.mediaServers) !== JSON.stringify(mediaServers())) {
        db.setConfig('media_servers', b.mediaServers);
        log.info('media servers', { count: b.mediaServers.length });
      }
      broadcast('session:changed', b);
    },
    syncDisabled: (reason) => {
      try {
        sync.setPaused(null, true);
      } catch {
        /* not signed in: nothing is syncing */
      }
      broadcast('toast', { kind: 'warning', text: reason });
    },
    minimumVersion: (v) => updater.setMinimum(v),
    requireUpdate: (v) => updater.requireUpdate(v),
    toast: (kind, text) => broadcast('toast', { kind, text }),
    audit: (uid, action, details) => audit.record(uid, action, details),
    // The session expired: nothing signed in is left behind the lock, and signing in again must not be refused (LOGIN-001).
    unlock: () => lock.reset(),
  });

  auth.onDeviceRevoked = (message) => void sessionCtl.wipe(message);

  // Torn-off windows (FR-NAV-05/07) are remembered per person, encrypted like the tabs.
  windows.onRecordsChanged = (list) => {
    const uid = sessionCtl.userId();
    if (!uid || !sessionCtl.isReady()) return;
    db.run(
      'INSERT INTO tab_sessions (user_id, window, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, window) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      uid,
      'detached',
      vault.encrypt({ windows: list }),
      new Date().toISOString(),
    );
  };

  lock.enabled = () => sessionCtl.isReady() && settings.effective().appLockEnabled === true;
  app.on('browser-window-blur', () => {
    setImmediate(() => {
      if (lock.enabled() && lock.minutes() === 0 && !BrowserWindow.getAllWindows().some(win => win.isFocused())) lock.lock('timeout');
    });
  });
  lock.hasPin = () => lockPin.has(sessionCtl.userId());
  lock.pinLength = () => lockPin.length(sessionCtl.userId());
  lock.minutes = () => settings.effective().appLockMinutes;
  lock.lockOnSystemLock = () => settings.effective().lockOnSystemLock;
  lock.lockOnSleep = () => settings.effective().lockOnSleep !== false;
  lock.user = () => ({ name: sessionCtl.get().user?.name ?? null, email: sessionCtl.get().user?.email ?? null });
  lock.onChanged = (s) => {
    broadcast('lock:changed', s);
    emitStatus();
    // Locked: the call window stops saying who is waiting, and Quick Ask stops answering its shortcut.
    webchat.refresh();
    syncQuickAsk();
    // Locked, an urgent ticket's card comes down; unlocked, the desk is looked at again.
    void supportUrgent.check();
    nextContactKey.sync();
    meetKeys.sync();
    meetNext.publish();
    // The Sinhala clipboard key is let go while locked.
    sinhala.syncKey();
    if (s.locked) {
      windows.hideQuickAsk();
      if (!settings.effective().lockedShowCallerDetails) for (const win of BrowserWindow.getAllWindows()) {
        const scope = scopeFor(win.webContents);
        if (scope) win.setTitle(scope.kind === 'chat-mini' ? 'WorkSuite chat' : 'WorkSuite call');
      }
    } else {
      // Present again at once, not at the next heartbeat: no heartbeat went while locked (#150).
      void heartbeatPresence();
      broadcast('realtime:resync');
      // What a notification clicked while locked pointed at, now that the workspace is back (#114).
      if (pendingNav.length) setTimeout(() => flushNavigation(), 300);
      // And WorkSuite Office's "Continue as", if it asked while the app was locked.
      officeSignIn.unlocked();
    }
  };

  function onReconnect(): void {
    const uid = sessionCtl.userId();
    realtime.kick();
    mailBodies.kick();
    if (!uid) return;
    void webchat.reconcile();
    void sessionCtl.revalidate();
    // A session that started online asks again too: access may have changed while the server was out of reach.
    if (sessionCtl.current()?.offline === false) void accessWatch.refresh('reconnect');
    void queue.replay(uid);
    pdfOnline();
    // Converted offline copies go up as new versions (Sinhala Tools WF-SI-03).
    void sinhala.sync();
    void notifications.refreshCounts();
    void audit.flush();
    void calls.check();
    device.poke();
    sync.kick('reconnected');
    void salonSync.sync();
    void eventDesk.sync();
    pos.sync();
    void restaurant.sync.sync();
    void projects.reconnected();
    void elearning.validate().catch(() => undefined);
    void board.sync().catch(() => undefined);
    broadcast('realtime:resync');
  }

  // PDF Studio (services/pdf): engine workers, working copies, its IPC. Read-only viewing in this version.
  const pdfStudio = createPdfStudio({
    profile: () => accountPaths().dir,
    userData: p.userData,
    http,
    cacheKey: () => (secrets.getStatus().persistent ? Buffer.from(hkdfSync('sha256', Buffer.from(dbKey, 'base64'), 'worksuite-pdf', 'thumbnail-cache', 32)) : null),
    // The organisation's PDF policies (§21.2) come with the server's PDF Studio service (stage D2).
    policy: () => DEFAULT_PDF_POLICY,
    desktop: () => ({
      downloads: sessionCtl.current()?.policy.downloads !== 'disabled' && sessionCtl.hasPermission('desktop.downloads'),
      diskCache: sessionCtl.capabilities().offlineCache,
    }),
    audit: (action, details) => audit.record(sessionCtl.userId(), action, details),
    signedIn: () => sessionCtl.isReady(),
    dbCheck: () => db.integrityCheck(),
    navigate: (req) => navigate(req),
    appVersion: app.getVersion(),
    device: () => ({ id: device.installId(), name: device.deviceName() }),
    userName: () => sessionCtl.get().user?.name ?? '',
  });
  // Local AI (services/local-ai, WS-SRS-LAI): AI Studio's models from the signed-in server, llama.cpp in the ws-local-ai process.
  const localAI = createLocalAI({
    userData: p.userData,
    signedIn: () => sessionCtl.isReady(),
    serverCatalog: () => http.get('/api/ai/local/catalog'),
    changed: () => broadcast('ai:localChanged'),
  });
  app.on('will-quit', () => void localAI.stop());
  // Text read from images on this computer (worksuite-desktop#59): Tesseract, its language data fetched once when first needed.
  const ocr = new OcrService({
    dir: join(p.userData, 'LocalAI', 'ocr'),
    fetch: withSafeHeaders((url, init) => netFetch(url, { ...init, cache: 'no-store' } as RequestInit)),
    progress: (sender, ev) => {
      const wc = webContents.fromId(sender);
      if (wc && !wc.isDestroyed()) wc.send('ai:ocrProgress', ev);
    },
  });
  app.on('will-quit', () => void ocr.stop());
  handPdfs = (paths) => void pdfStudio.openFromOs(paths);
  pdfOnline = () => pdfStudio.online();
  if (pendingPdfs.length) handPdfs(pendingPdfs.splice(0));
  handOffice = (paths) =>
    void officeFiles.register(paths).then(
      ({ files }) => {
        for (const f of files) navigate({ route: officeDocRoute({ kind: 'local', handle: f.handle, name: f.name }), source: 'file', title: f.name });
      },
      (e: unknown) => log.warn('office file handed over by the system not opened', { error: String((e as Error)?.message ?? e) }),
    );
  if (pendingOffice.length) handOffice(pendingOffice.splice(0));
  // Mail data files, export, safe links and S/MIME (ENH-MAIL-03 P4).
  const mailFiles = createMailFilesIpc({
    http,
    broadcast: (channel, payload) => broadcast(channel, payload),
    navigate,
    audit: (action, details) => audit.record(sessionCtl.userId(), action, details),
    downloadFolder: () => settings.effective().downloadFolder,
  });
  handMailFiles = (paths) => mailFiles.openFromOs(paths);
  if (pendingMailFiles.length) handMailFiles(pendingMailFiles.splice(0));
  app.on('will-quit', () => mailFiles.closeAll());

  /*
   * The checks Settings › Remote control shows (RC09). Built here so the
   * support bundle carries the same rows: a person reading them on screen and
   * the engineer reading the bundle should not be looking at two answers.
   */
  const meetDiagnostics = new MeetDiagnostics({
    support: () => remoteControl.view().support,
    policy: () => sessionCtl.current()?.policy ?? null,
    realtime: () => realtime.getState(),
  });
  const diagnostics = new DiagnosticsService({
    serverOrigin: () => auth.getServer()?.origin ?? null,
    timedFetch: async (path) => {
      const origin = auth.getServer()?.origin;
      const t0 = Date.now();
      const res = await fetchImpl(`${origin}${path}`, { method: 'GET', headers: { [CLIENT_TYPE_HEADER]: CLIENT_TYPE }, signal: AbortSignal.timeout(15_000) });
      return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
    },
    signedIn: () => sessionCtl.isReady(),
    realtimeState: () => realtime.getState(),
    updaterState: () => {
      const u = updater.get();
      return { state: u.state, error: u.error, lastCheckedAt: u.lastCheckedAt, channel: u.channel };
    },
    updateHistory: () => updateHistory.entries(),
    services: () => supervisor.health(),
    dbCheck: () => db.integrityCheck(),
    secureStorage: () => secrets.getStatus(),
    policy: () => sessionCtl.current()?.policy ?? null,
    deviceInfo: () => device.info(secrets.getStatus()),
    accessibility: accessibilityDiagnostics,
    meet: () => meetDiagnostics.run(),
    settings: () => settings.effective(),
    offline: () => {
      const uid = sessionCtl.userId();
      return uid ? queue.status(uid, { bytes: cache.totalBytes(), entries: cache.count() }) : null;
    },
    crashes: () => ({ recent: boot.recentCrashes, uncleanExit: boot.uncleanExit, safeMode: boot.safeMode, reason: boot.safeModeReason }),
    safeMode: () => boot.safeMode,
    userDataPath: p.userData,
  });

  // ── protocol + IPC ─────────────────────────────────────────────────────
  // app:// for every account's windows (installShellSession): the API proxy, the page policy, what is kept locally.
  const apiProxy = createApiProxy({
      http,
      cache,
      userId: () => sessionCtl.userId(),
      cacheModuleFor: (path) => {
        const clean = path.split('?')[0]!;
        const module = CACHE_PREFIXES.find(([prefix]) => clean === prefix || clean.startsWith(`${prefix}/`))?.[1] ?? (pmsCached(clean) ? 'pms' : eventsCached(clean) ? 'events' : assetsCached(clean) ? 'assets' : null);
        // Neither saved nor served for an app the person may not open.
        return module && canOpenApp(module, sessionCtl.visibleApps()) ? module : null;
      },
      cacheLimits: () => {
        const caps = sessionCtl.capabilities();
        const pol = sessionCtl.current()?.policy;
        return { enabled: caps.offlineCache, maxBytes: (pol?.offline_storage_max_mb ?? 2048) * 1024 * 1024 };
      },
      cacheScope: () => `${auth.getServer()?.origin ?? ''}:${sessionCtl.current()?.user.organizationId ?? ''}`,
      mailBodiesCached: (path) => mailBodiesKept(settings.effective(), path),
      mailListCached: (path) => mailListKept(settings.effective(), path),
      // SalonMate's desk calls carry the key this computer was paired with.
      extraHeaders: (path) => {
        const key = salonDesk.keyFor(path);
        // A restaurant terminal's calls carry its key too (restaurant/terminal.ts).
        if (key) return { 'X-Salon-Desk-Key': key };
        // Board's calls name this computer (X-Board-Device), so a blocked or revoked device is refused (FR-DEV-03).
        const boardHeaders = board.headers(path.split('?')[0]!);
        return Object.keys(boardHeaders).length ? boardHeaders : restaurant.headers(path);
      },
    });
  // Read on each page load: the server chosen, and the media servers it announced.
  const cspSources = () => ({ server: auth.getServer()?.origin ?? null, media: [...mediaServers(), ...guests.media, ...phone.origins()] });
  // A course's lessons kept offline, played by the app's own pages.
  const localHandler = (request: Request, path: string): Promise<Response> =>
    path.startsWith('/chat-media/')
        ? (sessionCtl.isReady() ? transfers.serveMediaPreview(request, path) : Promise.resolve(new Response('Not found', { status: 404 })))
        : path.startsWith('/elearning/')
        ? elearning.serve(request, path)
        : // A till's product pictures kept for offline (worksuite-desktop#296).
          path.startsWith('/pos-thumb/')
          ? pos.serveThumb(path)
        : // The speech model, for the speech page only (worksuite-desktop#81).
          path === '/speech/model.bin'
          ? speech.serveModel()
          : Promise.resolve(new Response('Not found', { status: 404 }));

  const pasteGestures = new Map<number, number>();
  app.on('web-contents-created', (_e, contents: WebContents) => {
    // A meeting window that goes away takes its share, and any control of it, with it.
    const id = contents.id;
    contents.once('destroyed', () => {
      pdfStudio.senderGone(id);
      localAI.senderGone(id);
      remoteControl.windowGone(id);
      screenShare.forget(id);
    });
    contents.on('before-input-event', (_ev, input) => {
      if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'v') pasteGestures.set(contents.id, Date.now());
    });
    // A right-click on a misspelt word offers its corrections (worksuite-desktop#188).
    attachSpellingMenu(contents);
  });

  const router = new IpcRouter(ipcMain, {
    isGuestSender: (id) => guestWindowIds.has(id),
    isTrustedSender: (event) => {
      const frame = event.senderFrame;
      if (!frame || frame.parent !== null) return false; // main frame only; no iframes
      if (!windows.isOurs(BrowserWindow.fromWebContents(event.sender)?.id ?? -1)) return false;
      return isTrustedShellUrl(frame.url);
    },
    isLocked: () => lock.isLocked(),
    canUseWhileLocked: (channel, input, sender) => lockedIpc(scopeFor(sender), channel, input, settings.effective()),
    isSignedIn: () => sessionCtl.isReady(),
    hasPermission: (key) => sessionCtl.hasPermission(key),
    audit: (action, details) => {
      if (['auth:signOut', 'session:switchOrganization', 'transfers:download'].includes(action)) return; // audited by the service itself
      audit.record(sessionCtl.userId(), action, details);
    },
    onAbuse: (sender, reason) => {
      log.error('renderer IPC abuse; reloading window', { reason });
      if (!sender.isDestroyed()) sender.reload();
    },
  });

  const relaunch = (safe: boolean, extraArgs: string[] = []): void => {
    const args = process.argv.slice(1).filter((a) => a !== '--safe-mode' && a !== '--updated' && a !== '--hidden' && a !== AX_RESTARTED_ARG && !a.startsWith('--account='));
    if (safe) args.push('--safe-mode');
    else clearCrashes(p.crashState);
    args.push(...extraArgs);
    markCleanExit(p.runningMarker);
    app.relaunch({ args });
    windows.quitting = true;
    app.exit(0);
  };

  const ctx: AppContext = {
    boot,
    osMode: OS_MODE ? { signIn: () => openOsSession() } : undefined,
    db,
    vault: getVault,
    secrets,
    salonDesk,
    salonPrint,
    salonSync,
    elearning,
    board,
    eventDesk,
    eventDeskPrint,
    settings,
    http,
    auth,
    device,
    bootstrap,
    session: sessionCtl,
    realtime,
    notifications,
    mailAlerts,
    cache,
    mailBodies,
    mailMedia,
    queue,
    transfers,
    meetRecorder,
    speech,
    sync,
    supervisor,
    lock,
    lockPin,
    updater,
    diagnostics,
    meetDiagnostics,
    audit,
    windows,
    calls,
    screenShare,
    shareBar,
    remoteControl,
    tray,
    status: snapshot,
    setActiveCall: (a) => {
      activeCall = a;
      onUpdateActivity();
    },
    activeCall: () => activeCall,
    updateBusy: busy,
    updatePrepared,
    updateDiagnostics,
    lastPasteGesture: (id) => pasteGestures.get(id) ?? 0,
    flushNavigation,
    navigate,
    webchat,
    webchatOnCall,
    ringTray,
    liveDesk,
    quickAsk,
    ai,
    office,
    officeLocal,
    officeApp,
    officeFiles,
    imageLocal,
    relaunch,
    quit,
    clockAttendance,
    attendanceBreak,
  };
  registerHandlers(router, ctx);
  router.handle('connection:details', () => connection.details());
  router.handle('connection:speedTest', () => connection.speedTest());
  router.handle('connection:reconnect', () => {
    // Retry on the banner: the monitor probes now (backoff reset), and the realtime connection is tried again.
    void health.retryNow().catch(() => undefined);
    return connection.reconnect();
  });
  router.handle('connection:workOffline', (input) => {
    workOffline = input.on;
    health.setWorkOffline(input.on);
    if (input.on) onReachability(false);
    else void health.retryNow().then((st) => st.state === 'ok' && onReachability(true)).catch(() => undefined);
    emitStatus();
    return health.state();
  });
  // The QR scan dialog (screen 6): the main window may use the camera while it is open, before anyone signs in.
  let scanCamera = false;
  router.handle('connect:scanCamera', (input) => {
    scanCamera = input.open;
  });
  setMediaGate((wc, types) => {
    const main = windows.getMain();
    if (!wc || !main || wc.id !== main.webContents.id || sessionCtl.isReady()) return true;
    return scanCamera && types.length > 0 && types.every((t) => t === 'video');
  });
  pdfStudio.register(router);
  mailFiles.register(router);
  pos.register(router);
  phone.register(router);
  pmsLocks.register(router);
  contactSync.register(router);
  restaurant.register(router);
  label.register(router);
  projects.register(router);
  salesDesk.register(router);
  chequeStation.register(router);
  sinhala.register(router);
  localAI.register(router);
  router.handle('ai:ocr', (input, c) => ocr.recognize(c.sender.id, input));
  router.handle('ai:ocrCancel', (input) => ocr.cancel(input.id));
  router.handle('ai:ocrStatus', () => ocr.status());
  const openGuest = async (input: string, server?: string, localName?: string) => {
    const prepared = await guests.prepare(input, server);
    const info = localName ? { ...prepared, localName } : prepared;
    const w = windows.open('meet', `/guest-meet/${info.uuid}?server=${encodeURIComponent(info.origin)}`, info.title ?? 'WorkSuite Meet · Guest');
    const senderId = w.webContents.id;
    guests.bind(senderId, info);
    guestWindowIds.add(senderId);
    w.once('closed', () => { guests.forget(senderId); guestWindowIds.delete(senderId); });
    pendingGuest = null;
    return { id: w.id };
  };
  const localWindow = (senderId: number) => localSession.window(senderId);
  const localOnly = (senderId: number) => localSession.require(senderId);
  const localApi = new LocalApi(local, () => local.profile()?.name ?? '');
  const currentMoveAccount = (): MoveAccount | null => {
    const b = sessionCtl.current();
    const origin = auth.getServer()?.origin;
    if (!sessionCtl.isReady() || !b || !origin) return null;
    const orgId = sessionCtl.organizationScope();
    return { key: createHash('sha256').update(JSON.stringify([origin, b.user.id])).digest('hex'), orgId, timezone: b.user.timezone || 'UTC' };
  };
  localAccountKey = () => currentMoveAccount()?.key ?? null;
  const moveBackupPath = join(p.profile, 'guest-move-backup.json');
  const mover = new LocalWorkspaceMove(local, {
    exists: () => existsSync(moveBackupPath),
    write: (text) => writeFileSync(moveBackupPath, text, { mode: 0o600, flush: true }),
    remove: () => rmSync(moveBackupPath, { force: true }),
  });
  // Guest mode: only the main window, and only while no account is signed in.
  router.handle('local:enter', (_input, c) => {
    if (sessionCtl.isReady()) throw new DesktopError('PERMISSION_DENIED', 'Sign out of your account to use the Local Profile.');
    if (windows.getMain()?.webContents.id !== c.sender.id) throw new DesktopError('PERMISSION_DENIED', 'Guest mode opens in the main WorkSuite window.');
    localSession.enter(c.sender.id);
    return { profile: local.profile(), locked: localSession.access.locked(c.sender.id), language: settings.effective().language };
  });
  router.handle('local:leave', (_input, c) => { localSession.leave(c.sender.id); });
  router.handle('local:status', (_input, c) => {
    localWindow(c.sender.id);
    return { profile: local.profile(), locked: localSession.access.locked(c.sender.id), language: settings.effective().language };
  });
  router.handle('local:profile', (input, c) => {
    localWindow(c.sender.id);
    // Creating the profile needs nothing; changing one that has a PIN needs it entered first.
    if (local.profile()) localOnly(c.sender.id);
    const profile = local.saveProfile(input);
    localSession.access.grant(c.sender.id);
    return profile;
  });
  router.handle('local:unlock', (input, c) => { localWindow(c.sender.id); return localSession.access.unlock(c.sender.id, input.pin); });
  router.handle('local:api', (input, c) => { localOnly(c.sender.id); return localApi.handle(input); });
  router.handle('local:overview', (_input, c) => {
    localOnly(c.sender.id);
    const { items, contacts, meetingInput, meetingServer } = local.read();
    const count = (kind: string) => items.filter((item) => item.kind === kind).length;
    return { notes: count('note'), tasks: count('task'), events: count('event'), contacts: contacts.length, meetingInput, meetingServer };
  });
  router.handle('local:meeting', (input, c) => { localOnly(c.sender.id); local.meeting(input.input, input.server); });
  router.handle('local:deleteAll', (_input, c) => { localOnly(c.sender.id); local.deleteAll(); localSession.access.clear(); });
  // A guest joins with the Local Profile's name and no account token, where the meeting server allows guests.
  router.handle('local:joinMeeting', (input, c) => { localOnly(c.sender.id); return openGuest(input.input, input.server, local.profile()?.name); });
  router.handle('local:export', async (_input, c) => {
    localOnly(c.sender.id);
    const chosen = await dialog.showSaveDialog(BrowserWindow.fromWebContents(c.sender)!, { title: 'Back up guest workspace', defaultPath: 'worksuite-local-backup.json', filters: [{ name: 'Guest workspace backup', extensions: ['json'] }] });
    if (chosen.canceled || !chosen.filePath) return { saved: false };
    writeFileSync(chosen.filePath, local.export(), { mode: 0o600, flush: true });
    return { saved: true };
  });
  // Restore is two steps: choose and validate a file (counts only, nothing written), then confirm that preview.
  let pendingRestore: { token: string; sender: number; text: string } | null = null;
  router.handle('local:restorePreview', async (_input, c) => {
    localOnly(c.sender.id);
    const chosen = await dialog.showOpenDialog(BrowserWindow.fromWebContents(c.sender)!, { title: 'Restore guest workspace backup', properties: ['openFile'], filters: [{ name: 'Guest workspace backup', extensions: ['json'] }] });
    if (chosen.canceled || !chosen.filePaths[0]) return null;
    if (statSync(chosen.filePaths[0]).size > 20_000_000) throw new DesktopError('IPC_VALIDATION_FAILED', 'Backup files must be under 20 MB.');
    const text = readFileSync(chosen.filePaths[0], 'utf8');
    let counts: ReturnType<typeof local.preview>;
    try { counts = local.preview(text); }
    catch { throw new DesktopError('IPC_VALIDATION_FAILED', 'This is not a valid guest workspace backup. Nothing was changed.'); }
    pendingRestore = { token: randomUUID(), sender: c.sender.id, text };
    return { token: pendingRestore.token, ...counts };
  });
  router.handle('local:restore', (input, c) => {
    localOnly(c.sender.id);
    const pending = pendingRestore;
    if (!pending || pending.token !== input.token || pending.sender !== c.sender.id) throw new DesktopError('PERMISSION_DENIED', 'Choose the backup again before restoring.');
    pendingRestore = null;
    try { return local.restore(pending.text); }
    catch { throw new DesktopError('IPC_VALIDATION_FAILED', 'This is not a valid guest workspace backup. Nothing was changed.'); }
  });
  // Signing in from guest mode: only the window that was in guest mode (past its PIN), into the account it signed in to.
  router.handle('local:moveOffer', (_input, c) => {
    const account = localSession.moveAccount(c.sender.id, currentMoveAccount()?.key ?? null);
    if (!account) return null;
    const offer = mover.offer(account);
    return offer.total ? offer : null;
  });
  router.handle('local:keep', (_input, c) => { if (localSession.moveAccount(c.sender.id, currentMoveAccount()?.key ?? null)) localSession.endMove(); });
  router.handle('local:move', async (_input, c) => {
    const account = currentMoveAccount();
    if (!account || !localSession.moveAccount(c.sender.id, account.key)) throw new DesktopError('PERMISSION_DENIED', 'Sign in from guest mode to move your local data.');
    const origin = auth.getServer()?.origin;
    const token = auth.accessToken();
    if (!origin || !token) throw new DesktopError('NOT_SIGNED_IN', 'Refresh your sign-in before moving your data.');
    // Freeze credentials and origin: a later account switch can never redirect these writes to another user.
    const headers = clientHeaders();
    const client = new HttpClient({ fetch: fetchImpl, origin: () => origin, tokens: { accessToken: () => token, refresh: async () => 'lost' }, clientHeaders: () => headers, onReachability: () => undefined, onAuthLost: () => undefined });
    const result = await mover.run(account, {
      get: (path) => client.get(path),
      post: (path, body, key) => client.post(path, body, { headers: { 'Idempotency-Key': key } }),
      put: (path, body, key) => client.request('PUT', path, { body, headers: { 'Idempotency-Key': key } }),
    }, () => currentMoveAccount()?.key ?? null);
    if (!result.failures.length) localSession.endMove();
    return result;
  });
  const localReminderTimer = setInterval(() => local.reminders(Date.now(), (item) => {
    if (!Notification.isSupported()) return false;
    try { const reminder = new Notification({ title: `${localize('Local reminder', settings.effective().language)} · ${item.title}`, body: localize(item.kind === 'event' ? 'Your local calendar reminder is due.' : 'Your local task reminder is due.', settings.effective().language) }); reminder.on('click', () => { windows.showMain(); }); reminder.show(); return true; }
    catch { return false; }
  }), 15000);
  app.on('before-quit', () => { clearInterval(localReminderTimer); local.close(); });
  router.handle('guest:pending', () => pendingGuest);
  router.handle('guest:open', (input) => openGuest(input.input, input.server));
  router.handle('guest:info', (_input, c) => guests.info(c.sender.id));
  router.handle('guest:join', (input, c) => guests.join(c.sender.id, input.name, input.pass));
  router.handle('guest:signIn', (_input, c) => { windows.showMain(); BrowserWindow.fromWebContents(c.sender)?.close(); });
  // The app's own API and local files, per window: refused while locked (but what the lock allows), and never for a
  // guest meeting window or a window in guest mode (#149).
  const apiHook = (details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void): void => {
    const id = details.webContentsId;
    const sender = id === undefined ? null : webContents.fromId(id);
    let body: unknown;
    try { body = JSON.parse((details.uploadData ?? []).map(x => x.bytes?.toString('utf8') ?? '').join('')); } catch { /* no JSON body */ }
    const allowed = !lock.isLocked() || lockedApi(sender ? scopeFor(sender) : null, details.url, details.method, settings.effective(), body);
    // Guest meeting windows and a window in guest mode (#149) never reach the account's API or its local cache.
    callback({ cancel: !allowed || id !== undefined && (guestWindowIds.has(id) || localSession.isGuest(id)) });
  };

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
    registerAppProtocol(apiProxy, cspSources, localHandler, ses);
    ses.webRequest.onBeforeRequest({ urls: ['app://bundle/__api/*', 'app://bundle/__local/*'] }, apiHook);
    screenShare.install(ses);
    if (proxyConfig) void ses.setProxy(proxyConfig);
    installPinning(ses, (host) => pinsFor(host));
  };
  const shellSessions = new ShellSessions<Electron.Session>((partition) => (partition === '' ? session.defaultSession : session.fromPartition(partition)), (ses) => installShellSession(ses));
  shellSessions.ensure('');
  shellSessions.ensureAll(firstPartitions);
  const CONNECT_PARTITION = 'persist:ws-connect';
  // Livezen discovery keys rotated in through a verified Update Center answer (WP2), kept in app.db.
  const rotatedKeys = (): Readonly<Record<string, string>> => appDb.getConfig<Record<string, string>>('discovery_keys') ?? {};
  setDiscoveryKeysSink((keys) => appDb.setConfig('discovery_keys', { ...rotatedKeys(), ...keys }));
  // The same for Cloud's entitlement keys (Connection & Startup §3), read back by `rotatedEntitlementKeys` below.
  const rotatedEntitlementKeys = (): Readonly<Record<string, string>> => appDb.getConfig<Record<string, string>>('entitlement_keys') ?? {};
  setEntitlementKeysSink((keys) => appDb.setConfig('entitlement_keys', { ...rotatedEntitlementKeys(), ...keys }));

  /**
   * Who refreshes and revokes an account's tokens: OneAuth for a Personal (Cloud) account (WP3's OIDC endpoint),
   * WorkSuite's own `/api/auth/refresh` (null) otherwise. Asked before the session starts, never inside a switch's
   * bind budget (it may read the issuer's metadata).
   */
  const tokenEndpointFor = async (account: AccountRecord | null): Promise<TokenEndpoint | null> => {
    if (OS_MODE) return osEndpoint;
    if (!account || (account.kind !== 'personal' && account.deployment !== 'CLOUD')) return null;
    return (await accountsWiring?.cloud.tokenEndpoint(account.id).catch(() => null)) ?? null;
  };
  const useTokenEndpointFor = async (account: AccountRecord | null): Promise<void> => {
    const ep = await tokenEndpointFor(account);
    if (scopes.current()?.id === account?.id) auth.setTokenEndpoint(ep);
  };
  auth.rebind(null);
  sessionCtl.managedServerApplies = () => {
    const a = registry.active();
    return !a || a.managed;
  };

  /** The open account's database, secrets, vault, token holder, settings scope and partitions (§1.3 step 6). */
  const bindAccount = (account: AccountRecord): void => {
    const scope = scopes.bind(account);
    mkdirSync(scope.paths.dir, { recursive: true, mode: 0o700 });
    if (db.path !== scope.paths.database) rebuildIfAsked(scope.paths.database, (msg, data) => log.warn(msg, data));
    db.swap(scope.paths.database);
    seedServerConfig(db, account);
    secrets.rebind(scope.paths.secrets);
    dbKey = vaultKey();
    vault = new Vault(Buffer.from(dbKey, 'base64'));
    auth.rebind(null);
    device.rebind();
    settings.setUserLanguageScope(null, null);
    shellSessions.ensureAll(scope.partitions);
    bindNetwork(scope.partitions);
    windows.partition = scope.partitions.shell;
    updater.setMinimum(null);
    apiReachable = true;
    emitStatus();
  };

  const background = new BackgroundAccounts({
    account: (id) => registry.get(id),
    client: (account) => backgroundClient(account),
    lastRefresh: (id) => appDb.getConfig<number>(`bg_refresh:${id}`) ?? null,
    setLastRefresh: (id, at) => appDb.setConfig(`bg_refresh:${id}`, at),
    onUnread: () => {
      accountsService.emit();
      emitStatus();
    },
    onSignedOut: (id) => {
      registry.update(id, { signInState: 'expired' });
      accountsService.emit();
    },
  });
  /** A background account's own token holder and client (§1.4): its secrets, its server, its partition. */
  function backgroundClient(account: AccountRecord): BackgroundClient {
    const paths = profilePaths(p.userData, account.profileDir);
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
    const id = registry.activeId();
    const a = id ? registry.get(id) : null;
    if (!a) return;
    const signInState = s.stage === 'ready' ? 'signed-in' : s.stage === 'expired' ? 'expired' : s.stage === 'revoked' ? 'revoked' : s.stage === 'no-server' ? a.signInState : 'signed-out';
    const user = s.user ? { id: String(s.user.id), name: s.user.name, email: s.user.email, avatar: s.user.avatar ?? null } : a.user;
    const organizationId = a.kind === 'personal' ? a.organizationId : (s.user?.organizationId ?? a.organizationId);
    const organizationName = s.user?.organizationName ?? a.organizationName;
    if (signInState === a.signInState && JSON.stringify(user) === JSON.stringify(a.user) && organizationId === a.organizationId && organizationName === a.organizationName) return;
    const next = registry.update(a.id, { signInState, user, organizationId, organizationName });
    if (next) scopes.refresh(next);
    // Cloud follows the open account signing in or out (WP3).
    if (signInState !== a.signInState) accountsWiring?.cloud.accountChanged();
    accountsService?.emit();
  }

  /** The update / draft-saving handshake, capped (§1.3 step 3). */
  const prepareCapped = async (capMs: number): Promise<void> => {
    const token = Math.random().toString(36).slice(2, 12);
    const answered = new Promise<void>((resolve) => prepareWaits.set(token, resolve));
    broadcast('update:prepare', { token });
    await Promise.race([answered, new Promise((r) => setTimeout(r, capMs))]);
    prepareWaits.delete(token);
  };

  const switcher = new AccountSwitcher<ReturnType<WindowManager['prepareMain']>>({
    account: (id) => registry.get(id),
    activeId: () => registry.activeId(),
    setActive: (id) => registry.setActive(id),
    guard: () => {
      if (lock.isLocked()) return { code: 'APP_LOCKED', reason: 'Unlock WorkSuite first.' };
      const a = updateActivity();
      const until = a.meeting ? 'the meeting ends' : a.call ? 'the call ends' : a.screenShare ? 'screen sharing stops' : a.remoteControl ? 'remote control stops' : null;
      return until ? { code: 'SWITCH_BLOCKED', reason: `Another account can open once ${until}.` } : null;
    },
    switching: () => accountsService.emit(),
    prepare: (cap) => prepareCapped(cap),
    createWindow: (account) => {
      const shell = partitionsFor(account).shell;
      if (shell === windows.partition && windows.getMain()) return null;
      shellSessions.ensure(shell);
      return windows.prepareMain(shell);
    },
    suspend: () => {
      const was = registry.active();
      if (was) {
        try {
          accountsService.rememberPending(was.id, pendingCount(activeUnsynced(was)));
        } catch {
          /* the count is a convenience */
        }
      }
      sessionCtl.suspend();
      scopes.release();
      transfers.stopAll();
      windows.closeAllButMain();
    },
    background,
    bind: (account) => bindAccount(account),
    init: async () => {
      const open = registry.active();
      await useTokenEndpointFor(open);
      accountsWiring?.cloud.accountChanged();
      await sessionCtl.init({ cachedFirst: true });
    },
    show: (handle) => handle.commit(),
    discard: (handle) => handle.discard(),
    relaunch: (id) => relaunch(false, [`--account=${id}`]),
    mode: () => switchModeFrom(process.env),
    timing: (ms, how, failed) => log.info('accounts.switch', { ms, how, failed }),
  });

  /** An account not open now signs out: its refresh token revoked at its server and removed from its secrets. */
  async function signOutOther(account: AccountRecord): Promise<void> {
    const store = new SecureStore(profilePaths(p.userData, account.profileDir).secrets);
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
  const activeUnsynced = (account: AccountRecord) => unsyncedSummary({ db, vault, accountId: account.id, userId: sessionCtl.userId() ?? account.user?.id ?? null, officeCopies: sessionCtl.isReady() ? () => officeLocal.list() : undefined });
  /** Another account's, from its own database (opened for the read, closed after). */
  const otherUnsynced = (account: AccountRecord) => {
    const paths = profilePaths(p.userData, account.profileDir);
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
    registry,
    switcher: switcher as unknown as AccountSwitcher<unknown>,
    background,
    trusted: trustedNow,
    session: {
      get: () => sessionCtl.get(),
      signOut: (wipe, message, opts) => sessionCtl.signOut(wipe, message, opts),
      setServer: (input) => sessionCtl.setServer(input),
      forgetServer: () => sessionCtl.forgetServer(),
    },
    unsynced: (account) => (account.id === registry.activeId() ? activeUnsynced(account) : otherUnsynced(account)),
    syncNow: async () => {
      const uid = sessionCtl.userId();
      if (!uid) return;
      await queue.replay(uid);
      void projects.reconnected();
      sync.kick('sync-now');
      transfers.setOnline(true);
      // Uploads that stopped (failed or paused) go again; each keeps its error if it fails again.
      for (const t of transfers.list()) {
        if (t.direction !== 'upload' || (t.state !== 'failed' && t.state !== 'paused')) continue;
        try {
          transfers.retry(t.id);
        } catch (e) {
          log.warn('upload not retried', { error: String((e as Error)?.message ?? e) });
        }
      }
      // Copies edited in other apps go back as new versions; each that cannot keeps why on its row.
      await officeLocal.syncPending();
    },
    discardUnsynced: async (itemId) => {
      const uid = sessionCtl.userId();
      if (!uid) throw new DesktopError('NOT_SIGNED_IN', 'Sign in again to change this list.');
      const [kind, ...rest] = itemId.split(':');
      const id = rest.join(':');
      if (kind === 'queue') queue.discard(uid, id);
      // The copy stays in the downloads folder: only WorkSuite stops waiting to send it.
      else if (kind === 'office') officeLocal.forget(id);
      else if (kind === 'upload') await transfers.cancel(id);
      else throw new DesktopError('UNSUPPORTED', 'Open that app to review its changes.');
      audit.record(uid, 'accounts.unsynced.discarded', { kind });
      log.info('unsynced change discarded', { kind });
    },
    exportUnsynced: async (account) => {
      const parent = windows.getMain();
      const opts = { title: 'Export changes not yet synced', defaultPath: `worksuite-unsynced-${account.serverName.replace(/[^A-Za-z0-9.-]+/g, '-')}.zip`, filters: [{ name: 'Zip archive', extensions: ['zip'] }] };
      const chosen = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
      if (chosen.canceled || !chosen.filePath) return { path: null };
      const active = account.id === registry.activeId();
      const summary = active ? activeUnsynced(account) : otherUnsynced(account);
      const zip = active ? exportUnsyncedZip({ db, vault, accountId: account.id, userId: sessionCtl.userId() ?? account.user?.id ?? null }, summary) : exportUnsyncedZip({ db: new Database(':memory:'), vault: null, accountId: account.id, userId: null }, summary);
      await fsp.writeFile(chosen.filePath, zip, { mode: 0o600 });
      return { path: chosen.filePath };
    },
    signOutOther: (account) => signOutOther(account),
    remove: async (account, keepOfflineFiles) => {
      const wasActive = account.id === registry.activeId();
      if (wasActive) {
        // Another account opens first; with none left, the session ends and nothing is open.
        const next = registry.list().find((a) => a.id !== account.id && !accountsService.blockedReason(a));
        if (next) await switcher.switchTo(next.id);
      }
      const stillBound = scopes.current()?.id === account.id;
      await removeAccount(
        {
          userData: p.userData,
          appDb,
          registry,
          revoke: async (a) => {
            if (stillBound) await auth.signOut().catch(() => undefined);
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
            sessionCtl.suspend();
            scopes.release();
            db.swap(':memory:');
            secrets.rebind(join(defaultProfile.dir, 'secrets.json'));
          },
          trash: (path) => shell.trashItem(path),
        },
        account.id,
        { keepOfflineFiles },
      );
      for (const partition of allPartitions(account)) shellSessions.forget(partition);
      if (stillBound) {
        // Nothing open: the computer's default profile, as on a fresh install.
        mkdirSync(defaultProfile.dir, { recursive: true, mode: 0o700 });
        db.swap(defaultProfile.database);
        secrets.rebind(defaultProfile.secrets);
        dbKey = vaultKey();
        vault = new Vault(Buffer.from(dbKey, 'base64'));
        auth.rebind(null);
        device.rebind();
        windows.partition = '';
        await sessionCtl.init();
      }
    },
    reachable: () => apiReachable,
    health: (accountId) => health.components(accountId),
    seedServer: (account, server) => {
      if (scopes.current()?.paths.database === profilePaths(p.userData, account.profileDir).database || (!scopes.current() && account.profileDir === DEFAULT_PROFILE_DIR && db.path === defaultProfile.database)) {
        db.setConfig('server', server);
        return;
      }
      const paths = profilePaths(p.userData, account.profileDir);
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
            trusted: trustedNow,
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
      const origin = normalizeServerUrl(input, allowInsecure);
      return { ...(await probeServer(origin, fetchImpl)), locked: false };
    },
    emit: (state) => emitAccounts('accounts:changed', state),
    showMain: () => void windows.showMain(),
    reservePartition: (partition) => {
      const dir = partitionDir(p.userData, partition);
      if (dir) queueRemoval(appDb, dir, partition);
    },
    adoptPartition: (partition) => {
      const dir = partitionDir(p.userData, partition);
      if (dir) unqueueRemoval(appDb, dir);
    },
  });
  sessionCtl.osManaged = OS_MODE;
  sessionCtl.accountView = () => {
    const a = registry.active();
    return a ? accountsService.view(a, a.id) : null;
  };
  /** Plain network (no credentials) in an account's network partition (OneAuth, a logout for an account not open). */
  function fetchFor(accountId: string): (url: string, init: RequestInit) => Promise<Response> {
    const a = registry.get(accountId);
    const ses = shellSessions.ensure(a ? partitionsFor(a).net : CONNECT_PARTITION);
    const nf = createNetFetch((o) => electronNet.request(o), ses);
    return withSafeHeaders((url, init) => nf(url, init as RequestInit)) as (url: string, init: RequestInit) => Promise<Response>;
  }

  // Accounts side by side, connect, browser sign-in and WorkSuite Cloud (Connection & Startup).
  accountsWiring = installAccounts({
    router,
    ctx,
    accounts: {
      service: accountsService,
      registry,
      trusted: trustedNow,
      sessionFor: (partition) => shellSessions.ensure(partition),
      connectPartition: CONNECT_PARTITION,
      partitionFor: (target) => accountsService.partitionFor(target),
      rotatedKeys,
      accountPins: (host) => {
        const out: string[] = [];
        for (const a of registry.list()) if (a.trust?.source === 'setup-link' && a.linkHosts.includes(host.toLowerCase())) out.push(...a.trust.spkiPins);
        return out;
      },
      health: healthDeps,
      fetchFor,
      acceptTokens: async (accountId, tokens) => {
        if (registry.activeId() !== accountId) await accountsService.switchTo(accountId);
        const a = registry.get(accountId);
        if (!a) throw new DesktopError('NOT_FOUND', 'That account is no longer on this computer.');
        await useTokenEndpointFor(a);
        auth.acceptTokens(tokens);
        registry.update(a.id, { signInState: 'signed-in' });
        // A Personal account's workspace opens once Cloud says it is ready (`activated`); any other's now.
        if (a.kind !== 'personal') await sessionCtl.acceptSession({ user: await currentUser(), tokens: { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: tokens.expires_in } });
        accountsService.emit();
        return accountsService.view(registry.get(accountId) ?? a, registry.activeId());
      },
      cloud: {
        acceptLogin: async (accountId, payload) => {
          if (registry.activeId() !== accountId) await accountsService.switchTo(accountId);
          const tokens = payload.tokens as { access_token: string; refresh_token: string; expires_in: number };
          auth.acceptTokens(tokens);
          await sessionCtl.acceptSession(payload as unknown as SignInPayload);
          const a = registry.get(accountId);
          if (!a) throw new DesktopError('NOT_FOUND', 'That account is no longer on this computer.');
          return accountsService.view(a, registry.activeId());
        },
        onStage: (accountId, stage) => {
          if (accountId !== registry.activeId() || stage === 'ready') return;
          if (stage === 'browser' || stage === 'verify-email' || stage === 'provisioning' || stage === 'bootstrapping' || stage === 'signed-out') sessionCtl.setStage(stage);
        },
        activated: async (accountId, me) => {
          if (accountId !== registry.activeId() || sessionCtl.isReady()) return;
          if (me.active_organization_id) accountsWiring?.setOrganization(accountId, me.active_organization_id, me.organizations.find((o) => o.id === me.active_organization_id)?.name ?? null);
          const user = await currentUser();
          await sessionCtl.acceptSession({ user } as SignInPayload);
        },
        onSignInFailed: (accountId, error) => {
          if (accountId === registry.activeId()) sessionCtl.setStage('signed-out', error.message);
          else broadcast('toast', { kind: 'error', text: error.message });
        },
        store: () => ({ get: (key) => db.getConfig<string>(key) ?? null, set: (key, value) => db.setConfig(key, value) }),
        rotatedEntitlementKeys,
        onQuotaRoom: () => {
          transfers.releaseQuota();
          void officeLocal.retryQuota().catch(() => undefined);
        },
        onQuotaWarning: (level) => broadcast('toast', { kind: level === 'full' ? 'error' : 'warning', text: level === 'full' ? 'Your WorkSuite Cloud storage is full. Uploads wait until there is room.' : 'Your WorkSuite Cloud storage is almost full.' }),
        deviceName: () => device.deviceName(),
      },
    },
  });
  /** WorkSuite OS: the broker's account, opened in this app (os-mode.ts). One at a time. */
  let osOpening: Promise<AuthState> | null = null;
  function openOsSession(): Promise<AuthState> {
    if (osOpening) return osOpening;
    const run = startOsSession({
      call: brokerCall,
      deviceServer: () => osDeviceServer(),
      currentOrigin: () => auth.getServer()?.origin ?? null,
      setServer: async (url) => void (await accountsService.setServer(url)),
      useEndpoint: (ep) => {
        osEndpoint = ep;
        auth.setTokenEndpoint(ep);
      },
      acceptTokens: (t) => auth.acceptTokens(t),
      hasPreviousUser: () => !!bootstrap.lastUserId(),
      resume: () => sessionCtl.init(),
      acceptSession: async () => void (await sessionCtl.acceptSession({ user: await currentUser() } as SignInPayload)),
      setStage: (stage, message = null) => {
        if (!sessionCtl.isReady()) sessionCtl.setStage(stage, message);
      },
    })
      .then(() => sessionCtl.get())
      .finally(() => {
        osOpening = null;
      });
    osOpening = run;
    return run;
  }
  /** Who is signed in, from the server (a browser sign-in brings tokens, not the user). */
  async function currentUser(): Promise<PublicUser> {
    const me = await http.get<{ user?: PublicUser } & Partial<PublicUser>>('/api/auth/me');
    return (me && typeof me === 'object' && 'user' in me && me.user ? me.user : me) as PublicUser;
  }
  pinsFor = accountsWiring.discovery.pinsFor;
  if (accountsWiring.discovery.health) {
    health.stop();
    health = accountsWiring.discovery.health;
    healthFromDiscovery = true;
  }
  sessionCtl.cloudStatus = () => accountsWiring.cloud.status();
  health.start();
  app.on('before-quit', () => {
    background.stopAll();
    health.stop();
    accountsWiring.dispose();
  });
  // The other signed-in accounts poll in the background (§1.4).
  for (const a of registry.list()) if (a.id !== registry.activeId()) background.adopt(a.id);

  router.install();
  const missing = router.missingHandlers();
  if (missing.length) log.warn('IPC channels without handlers', { missing });

  rebuildMenu(sessionCtl.visibleApps());

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
      log.warn('mailto handler', { error: String(e) });
    }
  };
  applyMailtoHandler(settings.effective().mailtoHandler === true);
  // What Mail keeps offline changed: its bodies are listed and fetched again soon (#190).
  let bodyPrefs = JSON.stringify([settings.effective().mailCacheDays, settings.effective().mailCacheDaysByMailbox ?? {}, settings.effective().mailFolderOffline ?? {}]);
  settings.onChange((prefs) => {
    const now = JSON.stringify([prefs.mailCacheDays, prefs.mailCacheDaysByMailbox ?? {}, prefs.mailFolderOffline ?? {}]);
    if (now !== bodyPrefs) {
      bodyPrefs = now;
      mailBodies.kick(2_000, true);
    }
    applyMailtoHandler(prefs.mailtoHandler === true);
    webchat.refresh();
    syncLiveKeys();
    syncQuickAsk();
    broadcast('settings:changed', prefs);
    if (prefs.backgroundServices.realtime && sessionCtl.isReady()) realtime.start();
    if (!prefs.backgroundServices.realtime) realtime.stop();
  });
  writeBootConfig(p.bootConfig, { hardwareAcceleration: settings.effective().hardwareAcceleration });

  // ── lifecycle ──────────────────────────────────────────────────────────
  app.on('second-instance', (_e, argv) => {
    const link = findDeepLinkInArgv(argv) ?? findMailtoInArgv(argv) ?? moduleLinkInArgv(argv);
    const pdfs = pdfPathsInArgv(argv);
    if (pdfs.length) handPdfs(pdfs);
    const docs = officePathsInArgv(argv);
    if (docs.length) handOffice(docs);
    const mails = mailFilePathsInArgv(argv);
    if (mails.length) handMailFiles(mails);
    if (link) handleDeepLink(link);
    else windows.showMain();
  });
  app.on('activate', () => windows.showMain());
  app.on('window-all-closed', () => {
    // With minimize-to-tray the main window hides rather than closes, so this
    // runs only when the user chose Exit on close (FR-TRAY-02).
    if (process.platform !== 'darwin') quit();
  });
  app.on('before-quit', () => {
    windows.quitting = true;
    // Settings › Updates › Install when quitting (#205): the installer starts now and finishes after we exit.
    updater.installOnQuitSync();
    // The Document Server saves after the last editor leaves; the sessions are ended on the way out.
    office.closeAll(true);
    officeLocal.stop();
    webchat.stop();
    livePulse.stop();
    atRisk.clear();
    quickAsk.release();
    if (supportKeyHeld) globalShortcut.unregister(SUPPORT_QUICK_SHORTCUT);
    nextContactKey.release();
    meetKeys.releaseAll();
    marketingPulse.stop();
    meetNext.stop();
    meetingsDesk.stop();
    callbackReminders.stop();
    void askHelper?.then((h) => h?.stop());
    // Windows' places are saved while the database is open; timers that read it stop first.
    windows.saveAllAndStop();
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = null;
    calls.stop();
    speech.stop();
    transfers.stopAll();
    sync.stop();
    // What scans changed in an event desk's copy is written back before the database closes.
    eventDesk.stop();
    pos.stop();
    restaurant.stop();
    supervisor.stopAll();
    label.stop();
    realtime.stop();
    updater.stop();
    lock.stop();
    tray.destroy();
    db.close();
    markCleanExit(p.runningMarker);
  });
  // The screen locked, sleep, another user: control pauses on this computer (§E.6).
  powerMonitor.on('lock-screen', () => remoteControl.onSystem('lock-screen'));
  powerMonitor.on('suspend', () => {
    remoteControl.onSystem('suspend');
    // Asleep, the socket hears nothing: what arrives meanwhile is caught up on the resync (#114).
    notifications.markGap();
  });
  powerMonitor.on('user-did-resign-active', () => remoteControl.onSystem('user-did-resign-active'));
  // Back from System Settings, or WorkSuite brought to the front: Accessibility is asked again and every window told.
  watchAccessibility({ app, platform: process.platform, recheck: () => accessibility.refresh(), changed: () => broadcast('rc:changed', remoteControl.view()) });
  powerMonitor.on('resume', () => {
    // After waking: check for updates (#205).
    updater.wake();
    if (process.platform === 'darwin') void accessibility.refresh().then(() => broadcast('rc:changed', remoteControl.view()));
    device.poke();
    sync.kick('resume');
    // A socket or SSE stream silent through the sleep is replaced, resuming from its last sid (plan 2.12): the
    // gateway replays what came meanwhile, or says reset and every view syncs.
    realtime.kick();
    const uid = sessionCtl.userId();
    if (uid) void queue.replay(uid);
    void salonSync.sync();
    void eventDesk.sync();
    pos.sync();
    void restaurant.sync.sync();
    void projects.reconnected();
    // Callback reminders set again from the clock as it is now; the tray's counts asked again.
    callbackReminders.resume();
    marketingPulse.poke();
  });
  screen.on('display-removed', () => windows.refit());
  screen.on('display-metrics-changed', () => windows.refit());

  tray.start();
  // GNOME without the AppIndicator extension shows no tray icon at all (#346): say so once, with the fix.
  if (process.platform === 'linux') {
    const marker = join(app.getPath('userData'), 'tray-hint-shown');
    if (!existsSync(marker)) {
      void indicatorHostRunning().then((running) => {
        if (running !== false) return;
        try {
          writeFileSync(marker, new Date().toISOString());
        } catch {
          /* shown again next time */
        }
        setTimeout(() => broadcast('toast', { kind: 'info', text: NO_TRAY_HINT }), 8_000).unref?.();
      });
    }
  }
  if (OS_MODE) {
    updater.disable("WorkSuite OS keeps WorkSuite up to date with the system's own updates.");
    log.info('WorkSuite OS mode: sign-in through the OS, device from the OS enrolment, no self-updates, no app lock');
  }
  lock.start();
  // The till sends its sales with its own credential, whoever is signed in (or nobody).
  pos.start();
  // The Print Gateway runs with its own device identity, whoever is signed in (or nobody); a headless box pairs from its command line.
  label.gateway.start();
  const pairArgs = startedAsGateway() ? gatewayPairingArgs() : null;
  if (pairArgs && !label.gateway.status().paired) void label.gateway.pair({ ...pairArgs, name: pairArgs.name ?? os.hostname() }).catch((e) => log.warn('print gateway pairing failed', { error: String(e) }));
  updater.start();
  applyAutostartOnce(settings);

  const hidden = startedHidden() || settings.effective().startMinimized;
  const mainWindow = windows.createMain(!hidden);
  // The first-run health check (#205): the window loaded and stayed up, so an update that brought this version is good.
  mainWindow.webContents.once('did-finish-load', () => setTimeout(() => updater.healthy(), 10_000).unref?.());
  if (devOrigin()) log.info('development renderer', { url: process.env.ELECTRON_RENDERER_URL });

  const startSession = OS_MODE ? () => openOsSession().then(() => undefined) : () => useTokenEndpointFor(firstAccount).then(() => sessionCtl.init());
  void startSession().then(() => {
    for (const link of pendingLinks.splice(0)) handleDeepLink(link);
    emitStatus();
  });

  if (boot.safeMode) log.warn('running in safe mode', { reason: boot.safeModeReason });
}

function applyAutostartOnce(settings: SettingsService): void {
  const prefs = settings.effective();
  try {
    applyAutostart(prefs.startWithOs, prefs.startMinimized);
  } catch {
    /* unsupported desktop */
  }
}
