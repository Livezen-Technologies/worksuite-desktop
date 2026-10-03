import { lockedScope, lockedApi, lockedIpc } from '@shared/locked-access';
import { lockedClickTarget } from '../services/locked-notifications';
import { accessibilityDiagnostics } from '../services/remote-control/accessibility-diagnostics';
import { LocalSession, LocalWorkspace } from '../services/local-workspace';
import { LocalApi } from '../services/local-api';
import { LocalWorkspaceMove, type MoveAccount } from '../services/local-workspace-move';
import { createHash, randomUUID } from 'node:crypto';
import { localize } from '@shared/localization';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { GuestMeetService } from '../services/guest-meet';
import { app, net as electronNet, Notification, clipboard, crashReporter, dialog, globalShortcut, ipcMain, powerMonitor, screen, session, shell, systemPreferences, BrowserWindow, type WebContents, webContents } from 'electron';
import os from 'node:os';
import { hkdfSync } from 'node:crypto';
import { join, resolve } from 'node:path';
import { canOpenApp, canOpenLink, canOpenRoute, notificationAllowed, visibleAppIds } from '@shared/access';
import { findDeepLinkInArgv, parseDeepLink } from '@shared/deeplink';
import { findMailtoInArgv, mailBodiesKept, mailtoRoute, parseMailto } from '@shared/mailto';
import { websiteDraftKey, websiteReplyMutation } from '@shared/website-reply';
import { resolveWebLink } from '@shared/links';
import { redirectRoute } from '@shared/channels';
import { networkStatus } from '@shared/network';
import { pmsCached } from '@shared/pms-cache';
import { eventsCached } from '@shared/event-desk';
import { redactUrl } from '@shared/redact';
import type { Bootstrap, NavigateRequest, RealtimeState, ServiceHealth, StatusSnapshot, WebchatOnCall, WebchatRingState } from '@shared/types';
import { AccessWatch, NO_ACCESS } from './access';
import { applyAutostart, startedHidden } from './autostart';
import { evaluateBoot, markCleanExit, markRunning, clearCrashes, writeBootConfig } from './boot';
import type { AppContext, ClockExtra } from './context';
import { broadcast, guestWindowIds } from './events';
import { registerHandlers } from './handlers';
import { initLog, logger } from './log';
import { DesktopError, isDesktopError } from './errors';
import { buildMenu } from './menu';
import { paths } from './paths';
import { SessionController, syncRefusal } from './session';
import { IpcRouter } from '../ipc/router';
import { registerAppProtocol } from '../protocols/app-protocol';
import { devOrigin, hardenSession, isTrustedShellUrl, openExternalSafely, registerPrivilegedSchemes, hardenWebContents, setExternalAllowList } from '../security/hardening';
import { createApiProxy } from '../services/api-proxy';
import { AuditService } from '../services/audit';
import { AuthService } from '../services/auth';
import { BootstrapService } from '../services/bootstrap';
import { CallService } from '../services/calls';
import { ScreenShare } from '../services/screen-share';
import { accessibility, createRemoteControl } from '../services/remote-control/host';
import { AX_RESTARTED_ARG, watchAccessibility } from '../services/remote-control/accessibility-watch';
import { DEFAULT_POLICY } from '../services/policy';
import { Database } from '../services/db';
import { archName, DeviceService, platformName } from '../services/device';
import { PmsLocks } from '../services/pms-locks';
import { createPos } from '../services/pos-ipc';
import { SalonDesk } from '../services/salon-desk';
import { SalonPrint } from '../services/salon-print';
import { SalonSync } from '../services/salon-sync';
import { DiagnosticsService } from '../services/diagnostics';
import { readEnterpriseConfig } from '../services/enterprise';
import { HttpClient, type FetchLike } from '../services/http';
import { LockService } from '../services/lock';
import { LockPin } from '../services/lock-pin';
import { NotificationService, inDnd } from '../services/notifications';
import { WebchatRinger, ringerHeight } from '../services/webchat-ring';
import { QuickAsk } from '../services/quick-ask';
import { AiService } from '../services/ai';
import { AI_ANSWER_LINK, AI_CHANGES_LINK, AiPendingWatcher } from '../services/ai-pending';
import * as fsp from 'node:fs/promises';
import { createInjector, type Injector } from '../services/remote-control/input';
import { OfflineCache } from '../services/offline-cache';
import { OfflineQueue } from '../services/offline-queue';
import { RealtimeService } from '../services/realtime';
import { SecureStore } from '../services/secure-store';
import { SettingsService } from '../services/settings';
import { DriveSync } from '../services/sync/engine';
import { ServiceSupervisor } from '../services/supervisor';
import { MeetRecorder } from '../services/meet-recorder';
import { SpeechService } from '../services/speech';
import { TransferManager, queueConfig, type DownloadSink } from '../services/transfers';
import { ElearningOffline } from '../services/elearning-offline';
import { EventDesk } from '../services/event-desk';
import { EventDeskPrint } from '../services/event-desk-print';
import { createRestaurant } from '../services/restaurant';
import { OfficeEditorHost } from '../services/office-editor';
import { OfficeExternal } from '../services/office-external';
import { createPdfStudio } from '../services/pdf/host';
import { createLocalAI } from '../services/local-ai/host';
import { OcrService } from '../services/ocr';
import { OfficeLocalFiles, officePathsInArgv } from '../services/office-local';
import { officeDocRoute } from '@shared/office';
import { pdfPathsInArgv } from '../services/pdf/local-files';
import { DEFAULT_PDF_POLICY } from '../services/pdf/service';
import { Vault } from '../services/vault';
import { TrayService } from '../tray/tray';
import { POLICY_PUBLIC_KEY, RELEASE_PUBLIC_KEY } from '../updater/keys';
import { UpdaterService } from '../updater/updater';
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
  if (app.isPackaged) {
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
  const argvLink = findDeepLinkInArgv(process.argv) ?? findMailtoInArgv(process.argv);
  if (argvLink) pendingLinks.push(argvLink);
  // PDFs the operating system hands over ("Open with"; a file dropped on the Dock icon): PDF Studio opens each.
  app.on('open-file', (e, path) => {
    e.preventDefault();
    if (/\.(docx|xlsx|pptx)$/i.test(path)) handOffice([path]);
    else handPdfs([path]);
  });
  handPdfs(pdfPathsInArgv(process.argv));
  handOffice(officePathsInArgv(process.argv));

  app.whenReady().then(() => start(boot, pendingLinks, (fn) => (handleLink = fn)));
}

// ── ready ────────────────────────────────────────────────────────────────

function start(boot: ReturnType<typeof evaluateBoot>, pendingLinks: string[], setLinkHandler: (fn: (url: string) => void) => void): void {
  const p = paths();
  const log = logger('main');
  const allowInsecure = !app.isPackaged;
  hardenSession(session.defaultSession);

  const enterprise = readEnterpriseConfig();
  const db = new Database(p.database);
  const secrets = new SecureStore(p.secrets);
  secrets.init();

  // The database key lives in the OS credential store; without one it lives
  // in memory, and nothing encrypted outlives the session.
  let dbKey = secrets.get('db-key');
  if (!dbKey) {
    dbKey = Vault.generateKey().toString('base64');
    secrets.set('db-key', dbKey);
  }
  const vault = new Vault(Buffer.from(dbKey, 'base64'));
  const getVault = () => vault;

  // A dedicated network session for API traffic: its own cookie jar and proxy.
  const net = session.fromPartition('persist:ws-net');
  const proxyConfig = enterprise.proxy && enterprise.proxy.mode !== 'system' ? (enterprise.proxy.mode === 'pac' ? { pacScript: enterprise.proxy.url ?? '' } : { proxyRules: enterprise.proxy.rules ?? enterprise.proxy.url ?? '', proxyBypassRules: enterprise.proxy.bypass ?? '' }) : null;
  if (proxyConfig) {
    void net.setProxy(proxyConfig);
    void session.defaultSession.setProxy(proxyConfig);
  }
  const fetchImpl: FetchLike = (url, init) => net.fetch(url, init as RequestInit);

  const local = new LocalWorkspace(join(p.profile, 'guest-workspace.sqlite'));
  // Guest mode runs in the main window (#149): which window is in it and past its PIN, and where a move may go.
  const localSession = new LocalSession(local);
  let localAccountKey: () => string | null = () => null;
  let wasSignedIn = false;
  const settings = new SettingsService(db);
  /** Media servers (LiveKit) the WorkSuite server announced; allowed in the page's CSP. */
  let pendingGuest: { input: string; server?: string } | null = null;
  const guests = new GuestMeetService({ fetch: fetchImpl, server: () => auth.getServer()?.origin ?? null });
  const mediaServers = (): string[] => db.getConfig<string[]>('media_servers') ?? [];
  const clientHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { 'X-WS-Client': `worksuite-desktop/${app.getVersion()} (${platformName()}; ${archName()})` };
    const dev = device?.current();
    if (dev) h['X-WS-Device'] = dev.id;
    return h;
  };

  const auth = new AuthService(db, secrets, fetchImpl, clientHeaders);

  let apiReachable = true;
  // Set once the transfer manager exists (below); the server can drop out before then.
  let transfersOnline: (ok: boolean) => void = () => undefined;
  let reachabilityProbe: NodeJS.Timeout | null = null;
  const onReachability = (ok: boolean): void => {
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
    } else if (!reachabilityProbe) {
      reachabilityProbe = setInterval(() => {
        const origin = auth.getServer()?.origin;
        if (!origin) return;
        fetchImpl(`${origin}/api/auth/config`, { method: 'GET', signal: AbortSignal.timeout(10_000) })
          .then(() => onReachability(true))
          .catch(() => undefined);
      }, 15_000);
      reachabilityProbe.unref?.();
    }
  };

  // Forward-declared so the HTTP client's callbacks can reach the session.
  // eslint-disable-next-line prefer-const
  let sessionCtl: SessionController;
  const http = new HttpClient({
    fetch: fetchImpl,
    origin: () => auth.getServer()?.origin ?? null,
    tokens: { accessToken: () => auth.accessToken(), refresh: () => auth.refresh() },
    clientHeaders,
    onReachability,
    onAuthLost: (reason) => sessionCtl?.expired(reason === 'Session ended' ? 'Your session has ended. Sign in again to continue.' : reason),
    onDeviceDirective: (code, message) => {
      if (code === 'DEVICE_REVOKED') void sessionCtl?.wipe(message);
      else if (code === 'DESKTOP_ACCESS_DISABLED') sessionCtl?.handleDirective({ kind: 'block', reason: message });
      else if (code === 'VERSION_UNSUPPORTED') updater.requireUpdate(null);
    },
  });

  const device: DeviceService = new DeviceService(db, secrets, http);
  const salonDesk = new SalonDesk(secrets, http, () => auth.getServer()?.origin ?? null);
  const salonPrint = new SalonPrint({ config: db, http, origin: () => auth.getServer()?.origin ?? null });
  const bootstrap = new BootstrapService(db, getVault, http, POLICY_PUBLIC_KEY);
  const cache = new OfflineCache(db, getVault);
  const audit = new AuditService(db, getVault, http, () => auth.getServer()?.api === 'desktop-v1');
  const supervisor = new ServiceSupervisor();
  const lock = new LockService();
  const lockPin = new LockPin(db, getVault);
  const windows = new WindowManager(db, join(__dirname, '../preload/index.js'));
  windows.minimizeToTray = () => settings.effective().minimizeToTray;
  // A call rings only for whoever may open Chat (calls are part of it).
  const calls = new CallService(
    windows,
    http,
    () => sessionCtl.isReady() && (!lock.isLocked() || settings.effective().lockedCallNotifications !== false) && canOpenApp('calls', sessionCtl.visibleApps()),
    () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('meet', sessionCtl.visibleApps()),
  );
  const screenShare = new ScreenShare(url => !lock.isLocked() && isTrustedShellUrl(url));
  screenShare.install(session.defaultSession);
  // Meet remote control on this computer (WS-MEET-ENH-01): the share, consent, grant and input live here.
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

  const notifications = new NotificationService(db, getVault, http, () => settings.effective());
  const queue = new OfflineQueue(db, getVault, http, () => sessionCtl.capabilities().offlineQueue);
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
    db,
    vault: getVault,
    http,
    userId: () => sessionCtl.userId(),
    downloadFolder: () => settings.effective().downloadFolder,
    hash,
    canOpenFiles: () => sessionCtl.hasPermission('desktop.files.open_external'),
    audit: (action, details) => audit.record(sessionCtl.userId(), action, details),
    // eLearning's offline copies are kept inside the app, sealed as they arrive.
    sink: (name): DownloadSink | null => elearning.sink(name),
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
  const speech = new SpeechService({ dir: join(p.profile, 'LocalAI', 'speech'), preload: join(__dirname, '../preload/index.js') });
  // eLearning: a course's lessons kept for offline learning, as the server's manifest lists them.
  const elearning: ElearningOffline = new ElearningOffline({
    db,
    vault: getVault,
    http,
    transfers,
    root: join(p.profile, 'elearning'),
    userId: () => (sessionCtl.isReady() ? sessionCtl.userId() : null),
    allowed: () =>
      sessionCtl.capabilities().offlineCache
        ? { ok: true, reason: null }
        : { ok: false, reason: 'Your organization does not allow WorkSuite data to be kept offline on this computer.' },
    changed: () => broadcast('elearning:offlineChanged'),
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
  });

  // Hotel PMS door locks: the on-site lock server this front desk talks to (its secret only in the OS keystore).
  const pmsLocks = new PmsLocks({
    config: db,
    secrets,
    origin: () => auth.getServer()?.origin ?? null,
    allowed: () => sessionCtl.isReady() && canOpenApp('pms', sessionCtl.visibleApps()),
  });

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
  });
  sync.onChanged = (s) => broadcast('sync:changed', s);

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
  });
  office.install();
  // Office files on this computer for WorkSuite DOC / Sheet / Slides tabs (office-local.ts): handles, never paths.
  const officeFiles = new OfficeLocalFiles({ forbidden: () => [p.userData] });
  const officeLocal = new OfficeExternal({
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

  let activeCall = false;
  // Updates wait while a call is on (FR-UPD); the call windows say when.
  calls.onActiveChanged = (a) => {
    activeCall = a;
  };
  calls.onListChanged = (list) => broadcast('calls:changed', list);
  const busy = () => {
    const id = sessionCtl.userId();
    const c = transfers.activeCounts();
    return { uploads: c.uploads, downloads: c.downloads, pendingMutations: id ? queue.pendingCount(id) : 0, drafts: id ? queue.draftCount(id) : 0, activeCall };
  };

  const updater = new UpdaterService({
    fetch: fetchImpl,
    platform: platformName(),
    arch: archName(),
    publicKeyPem: RELEASE_PUBLIC_KEY,
    feedUrl: (channel) => {
      if (allowInsecure && process.env.WS_UPDATE_FEED) return process.env.WS_UPDATE_FEED;
      const server = auth.getServer();
      if (!server) return null;
      if (server.api === 'desktop-v1') {
        return `${server.origin}/desktop/v1/releases/manifest?platform=${platformName()}&arch=${archName()}&channel=${channel}`;
      }
      // The existing API has no release endpoint: the server hosts the signed
      // manifest as a static file beside the installers.
      return `${server.origin}/desktop/releases/${channel}/manifest.json`;
    },
    channel: () => settings.effective().updateChannel,
    busy,
    deadlineHours: () => sessionCtl.current()?.policy.forced_update_deadline_hours ?? 24,
    allowInsecure,
    updatesDir: p.updates,
    onStatus: (s) => {
      broadcast('update:changed', s);
      tray.update({ updateReady: s.state === 'STAGED' });
    },
    onWarning: (text) => broadcast('toast', { kind: 'warning', text }),
    beforeQuit: async () => {
      // WF-26 step 6: queues and drafts are already durable; pause transfers cleanly.
      transfers.stopAll();
    },
  });

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
    w.webContents.send('navigate', req);
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
  const handleDeepLink = (url: string): void => {
    // A mailto: link from another app (WorkSuite is the default mail app): a new message, prefilled, for the person to send.
    if (/^mailto:/i.test(url)) {
      const fields = parseMailto(url);
      if (fields) navigate({ route: mailtoRoute(fields), source: 'deep-link' });
      else windows.showMain();
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

  // ── status ─────────────────────────────────────────────────────────────
  let statusTimer: NodeJS.Timeout | null = null;
  const snapshot = (): StatusSnapshot => {
    const uid = sessionCtl?.userId();
    const raw = notifications.counts();
    // Counts only of apps the person has: the badge, tray and title bar never count an app they cannot open.
    const visible = sessionCtl?.visibleApps() ?? new Set<string>();
    const counts = { ...raw, chat: canOpenApp('chat', visible) ? raw.chat : 0, mail: canOpenApp('mail', visible) ? raw.mail : 0, tasks: canOpenApp('tasks', visible) ? raw.tasks : 0 };
    const services: Record<string, ServiceHealth> = { ...supervisor.health() };
    return {
      internetOnline: electronNet.isOnline(),
      realtimeDiagnostics: realtime.diagnostics(),
      network: networkStatus(apiReachable, realtime.getState(), realtimeDownSince),
      realtime: realtime.getState(),
      pendingChanges: uid ? queue.pendingCount(uid) + salonSync.pending() + eventDesk.pending() + pos.pending() + restaurant.sync.pending() : 0,
      unread: counts,
      notificationsPausedUntil: notifications.pausedUntilIso(),
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
        unreadChat: s.unread.chat,
        unreadMail: s.unread.mail,
        unreadOther: s.unread.notifications,
        badge: settings.effective().badgeCount !== false,
        notificationsPausedUntil: s.notificationsPausedUntil,
      });
    }, 300);
  }

  realtime.onState = (s: RealtimeState) => {
    notifications.realtimeState(s);
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
  realtime.onEvent = (e) => {
    notifications.handleRealtime(e);
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
  };
  realtime.onResync = () => {
    broadcast('realtime:resync');
    // Events may have been missed while the socket was down, `access.changed` among them.
    if (sessionCtl.isReady()) void accessWatch.refresh('resync');
    // Announcing what the push missed, chat included: not just taking it as already seen (#114).
    void notifications.refreshList(true);
    void notifications.catchUpChat();
    void notifications.refreshCounts();
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
      await http.post('/api/chat/presence', { active: powerMonitor.getSystemIdleTime() < 300 });
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
  const tray = new TrayService({
    open: () => windows.showMain(),
    openRoute: (route) => navigate({ route, source: 'tray' }),
    clockIn: () => void clock('in'),
    clockOut: () => void clock('out'),
    pauseNotifications: (m) => {
      notifications.pause(m);
      emitStatus();
    },
    openSettings: () => navigate({ route: '/settings', source: 'tray' }),
    checkUpdates: () => {
      if (updater.get().state === 'STAGED') void updater.install(false).then((r) => !r.started && navigate({ route: '/settings/about', source: 'tray' }));
      else void updater.check().then(() => navigate({ route: '/settings/about', source: 'tray' }));
    },
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
    aiChanges: () => openAiChanges(),
    ringingSettings: () => navigate({ route: '/settings/notifications', source: 'tray' }),
  });

  // ── website chats ring like calls (WS-WCHAT ENH-01, R3) ─────────────────
  const JOIN_SHORTCUT = 'CommandOrControl+Shift+J';
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
    webchatRinging: s.chats.map((c) => ({ id: c.id, label: c.site ? `${c.visitor} · ${c.site}` : c.visitor })),
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
      return { ...p.webchatRinging, volume: !p.notificationSounds || lock.isLocked() && p.lockedNotificationSounds === false ? 0 : p.webchatRinging.volume };
    },
    quiet: () => {
      const p = settings.effective();
      return (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, new Date())) || notifications.pausedUntilIso() !== null;
    },
    // With a call just answered, the thread joins its audio (`call=`).
    open: (id, callId) => navigate({ route: `/chat?view=website&website=${id}${callId ? `&call=${callId}` : ''}`, source: 'notification' }),
    // This installation as a ringing device (RING-10): the registered device's id, stable across restarts.
    deviceId: () => {
      const d = Number(device.current()?.id);
      return Number.isInteger(d) && d > 0 ? `desktop-${d}` : 'desktop-unregistered';
    },
    focused: () => !!windows.getMain()?.isFocused(),
    onChanged: (s) => {
      broadcast('ring:changed', s);
      const prefs = settings.effective().webchatRinging;
      if ((s.chats.length || s.handoffs?.length || s.calls?.length || s.outcome) && prefs.window && (!lock.isLocked() || settings.effective().lockedChatNotifications !== false)) windows.showRinger(ringerHeight(s));
      else windows.hideRinger();
      tray.update(trayCalls(s));
      const live = s.chats.some((c) => !c.silenced) || !!s.handoffs?.length;
      attention(live || !!s.calls?.length);
      webchat.shortcut = joinShortcut(live && prefs.shortcut);
      webchat.answerShortcut = answerShortcut(!!s.calls?.length && prefs.shortcut);
    },
  });
  notifications.ringerShowing = () => settings.effective().webchatRinging.window && (webchat.state().chats.length > 0 || !!webchat.state().handoffs?.length || !!webchat.state().calls?.length);
  const webchatOnCall = (c: WebchatOnCall | null): void => {
    onCall = c;
    tray.update(trayCalls(webchat.state()));
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
  const syncQuickAsk = (): void => {
    quickAsk.sync();
    tray.update({ quickAsk: quickAsk.shortcut() });
  };

  // ── what the person may open (shared/access.ts) ───────────────────────
  // READ_CACHE: which module's answers a GET path is.
  const CACHE_PREFIXES: Array<[string, string]> = [
    ['/api/mail/folders', 'mail'],
    ['/api/mail/mailboxes', 'mail'],
    ['/api/mail/messages', 'mail'],
    // The sidebar's counts, labels, the list's layout and the sync card: Mail opens offline as it was left.
    ['/api/mail/views', 'mail'],
    ['/api/mail/labels', 'mail'],
    ['/api/mail/prefs', 'mail'],
    ['/api/mail/sync/status', 'mail'],
    ['/api/chat/rooms', 'chat'],
    ['/api/chat/messages', 'chat'],
    ['/api/calendar/events', 'calendar'],
    ['/api/tasks', 'tasks'],
    ['/api/task-lists', 'tasks'],
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
        checkUpdates: () => void updater.check().then(() => navigate({ route: '/settings/about', source: 'menu' })),
        diagnostics: () => navigate({ route: '/diagnostics', source: 'menu' }),
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
      // So do an event desk's copies of the gates' tickets (scans still unsent wait, should the app come back).
      if (!canOpenApp('events', visible)) eventDesk.signedOut(b.user.id);
      if (!canOpenApp('restaurant', visible)) restaurant.signedOut(b.user.id);
    }
    emitStatus();
  };

  // ── the session ────────────────────────────────────────────────────────
  const startServices = (b: Bootstrap): void => {
    const uid = b.user.id;
    setExternalAllowList([new URL(auth.getServer()!.origin).hostname]);
    if (settings.effective().backgroundServices.realtime) realtime.start();
    notifications.start(uid);
    webchat.start();
    syncQuickAsk();
    // Quick Ask waits on the company's rules; once they are known, it is offered (or not).
    void ai.refresh().then(() => {
      syncQuickAsk();
      aiPending.start();
    });
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
    // Courses kept offline: the ones whose learning ended, or whose licence ran out, go.
    void elearning.validate().catch((e) => log.warn('offline courses not checked', { error: String(e) }));
    void audit.flush();
    void refreshAttendance();
    attendanceTimer = setInterval(() => void refreshAttendance(), 5 * 60_000);
    attendanceTimer.unref?.();
    stopPresence();
    void heartbeatPresence();
    presenceTimer = setInterval(() => void heartbeatPresence(), 30_000);
    presenceTimer.unref?.();
    // What this computer can do for Meet remote control (WF-RC-08), once the device is known.
    setTimeout(reportCapabilities, 5_000).unref?.();
    accessWatch.start();
    // FR-OFF-06: prune mail bodies beyond the cache window.
    const days = settings.effective().mailCacheDays;
    if (days > 0) cache.pruneModuleOlderThan('mail', days);
    // A mailbox's own keep period (Settings › Mail › Storage & sync, D09).
    const me = sessionCtl.current()?.user?.id;
    for (const [box, d] of Object.entries(settings.effective().mailCacheDaysByMailbox ?? {})) if (me) cache.pruneMailbox(String(me), box, d);
    emitStatus();
  };
  const stopServices = (): void => {
    void remoteControl.shutdown('logout');
    webchat.stop();
    quickAsk.release();
    ai.forget();
    aiPending.stop();
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
    realtime.stop();
    notifications.stop();
    device.stop();
    transfers.stopAll();
    sync.stop();
    salonSync.stop();
    eventDesk.stop();
    restaurant.stop();
    if (attendanceTimer) clearInterval(attendanceTimer);
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

  sessionCtl = new SessionController(db, auth, device, bootstrap, fetchImpl, enterprise, {
    started: (b) => startServices(b),
    stopped: () => stopServices(),
    wiped: (uid, scope, includeDrafts) => {
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
        queue.wipeUser(uid, includeDrafts);
        transfers.wipe(uid);
        // Copies opened in other apps are no longer watched; the files stay the person's.
        officeLocal.forgetUser(uid);
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
      // A remote wipe, or signing out with "remove WorkSuite's data", forgets
      // the salon desk this computer was, and its printers; a plain sign-out keeps them.
      if (includeDrafts) {
        salonDesk.forgetAll();
        salonPrint.forgetAll();
        salonSync.forgetAll();
        // Every event this computer was a check-in device at: the keys, the copies, the queues, the badge printer.
        eventDesk.forgetAll();
        eventDeskPrint.forgetAll();
        // The till this computer was: its credential, catalogue, sales (sent or not) and printer settings.
        pos.forgetAll();
        // The restaurant terminal this computer was: its key, copy, outbox and printer mapping.
        restaurant.forgetAll();
        // The door-lock servers this computer's front desk talked to, and their secrets.
        pmsLocks.wipe();
      }
      log.info('local data removed', { scope });
    },
    changed: (s) => {
      // Signing in ends guest mode (the window may then offer to move its data here); signing out closes the Local Profile.
      if (s.stage === 'ready' && !wasSignedIn) localSession.signedIn(localAccountKey());
      else if (s.stage !== 'ready' && wasSignedIn) localSession.signedOut();
      wasSignedIn = s.stage === 'ready';
      lockPin.setServerScope(s.server?.origin ?? null);
      settings.setUserLanguageScope(s.server?.origin ?? null, s.user?.id ?? null);
      broadcast('auth:changed', s);
      emitStatus();
      if (s.stage === 'ready') {
        flushNavigation();
        void calls.check();
      }
    },
    bootstrapChanged: (b) => {
      if (b) settings.setPolicy(b.policy);
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

  lock.enabled = () => sessionCtl.isReady() && settings.effective().appLockEnabled !== false;
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
    }
  };

  function onReconnect(): void {
    const uid = sessionCtl.userId();
    realtime.kick();
    if (!uid) return;
    void webchat.reconcile();
    void sessionCtl.revalidate();
    // A session that started online asks again too: access may have changed while the server was out of reach.
    if (sessionCtl.current()?.offline === false) void accessWatch.refresh('reconnect');
    void queue.replay(uid);
    pdfOnline();
    void notifications.refreshCounts();
    void audit.flush();
    void calls.check();
    device.poke();
    sync.kick('reconnected');
    void salonSync.sync();
    void eventDesk.sync();
    pos.sync();
    void restaurant.sync.sync();
    void elearning.validate().catch(() => undefined);
    broadcast('realtime:resync');
  }

  // PDF Studio (services/pdf): engine workers, working copies, its IPC. Read-only viewing in this version.
  const pdfStudio = createPdfStudio({
    profile: p.profile,
    userData: p.userData,
    http,
    cacheKey: secrets.getStatus().persistent ? Buffer.from(hkdfSync('sha256', Buffer.from(dbKey, 'base64'), 'worksuite-pdf', 'thumbnail-cache', 32)) : null,
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
    fetch: (url, init) => net.fetch(url, { ...init, cache: 'no-store' } as RequestInit),
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

  const diagnostics = new DiagnosticsService({
    serverOrigin: () => auth.getServer()?.origin ?? null,
    timedFetch: async (path) => {
      const origin = auth.getServer()?.origin;
      const t0 = Date.now();
      const res = await fetchImpl(`${origin}${path}`, { method: 'GET', signal: AbortSignal.timeout(15_000) });
      return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
    },
    signedIn: () => sessionCtl.isReady(),
    realtimeState: () => realtime.getState(),
    updaterState: () => {
      const u = updater.get();
      return { state: u.state, error: u.error, lastCheckedAt: u.lastCheckedAt, channel: u.channel };
    },
    services: () => supervisor.health(),
    dbCheck: () => db.integrityCheck(),
    secureStorage: () => secrets.getStatus(),
    policy: () => sessionCtl.current()?.policy ?? null,
    deviceInfo: () => device.info(secrets.getStatus()),
    accessibility: accessibilityDiagnostics,
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
  registerAppProtocol(
    createApiProxy({
      http,
      cache,
      userId: () => sessionCtl.userId(),
      cacheModuleFor: (path) => {
        const clean = path.split('?')[0]!;
        const module = CACHE_PREFIXES.find(([prefix]) => clean === prefix || clean.startsWith(`${prefix}/`))?.[1] ?? (pmsCached(clean) ? 'pms' : eventsCached(clean) ? 'events' : null);
        // Neither saved nor served for an app the person may not open.
        return module && canOpenApp(module, sessionCtl.visibleApps()) ? module : null;
      },
      cacheLimits: () => {
        const caps = sessionCtl.capabilities();
        const pol = sessionCtl.current()?.policy;
        return { enabled: caps.offlineCache, maxBytes: (pol?.offline_storage_max_mb ?? 2048) * 1024 * 1024 };
      },
      mailBodiesCached: (path) => mailBodiesKept(settings.effective(), path),
      // SalonMate's desk calls carry the key this computer was paired with.
      extraHeaders: (path) => {
        const key = salonDesk.keyFor(path);
        // A restaurant terminal's calls carry its key too (restaurant/terminal.ts).
        return key ? { 'X-Salon-Desk-Key': key } : restaurant.headers(path);
      },
    }),
    // Read on each page load: the server chosen, and the media servers it announced.
    () => ({ server: auth.getServer()?.origin ?? null, media: [...mediaServers(), ...guests.media] }),
    // A course's lessons kept offline, played by the app's own pages.
    (request, path) =>
      path.startsWith('/chat-media/')
        ? (sessionCtl.isReady() ? transfers.serveMediaPreview(request, path) : Promise.resolve(new Response('Not found', { status: 404 })))
        : path.startsWith('/elearning/')
        ? elearning.serve(request, path)
        : // The speech model, for the speech page only (worksuite-desktop#81).
          path === '/speech/model.bin'
          ? speech.serveModel()
          : Promise.resolve(new Response('Not found', { status: 404 })),
  );

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
    const args = process.argv.slice(1).filter((a) => a !== '--safe-mode' && a !== '--updated' && a !== '--hidden' && a !== AX_RESTARTED_ARG);
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
    db,
    vault: getVault,
    secrets,
    salonDesk,
    salonPrint,
    salonSync,
    elearning,
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
    cache,
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
    audit,
    windows,
    calls,
    screenShare,
    remoteControl,
    tray,
    status: snapshot,
    setActiveCall: (a) => {
      activeCall = a;
    },
    activeCall: () => activeCall,
    lastPasteGesture: (id) => pasteGestures.get(id) ?? 0,
    flushNavigation,
    navigate,
    webchat,
    webchatOnCall,
    quickAsk,
    ai,
    office,
    officeLocal,
    officeFiles,
    relaunch,
    quit,
    clockAttendance,
    attendanceBreak,
  };
  registerHandlers(router, ctx);
  pdfStudio.register(router);
  pos.register(router);
  pmsLocks.register(router);
  restaurant.register(router);
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
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['app://bundle/__api/*', 'app://bundle/__local/*'] }, (details, callback) => {
    const id = details.webContentsId;
    const sender = id === undefined ? null : webContents.fromId(id);
    let body: unknown;
    try { body = JSON.parse((details.uploadData ?? []).map(x => x.bytes?.toString('utf8') ?? '').join('')); } catch { /* no JSON body */ }
    const allowed = !lock.isLocked() || lockedApi(sender ? scopeFor(sender) : null, details.url, details.method, settings.effective(), body);
    // Guest meeting windows and a window in guest mode (#149) never reach the account's API or its local cache.
    callback({ cancel: !allowed || id !== undefined && (guestWindowIds.has(id) || localSession.isGuest(id)) });
  });
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
  settings.onChange((prefs) => {
    applyMailtoHandler(prefs.mailtoHandler === true);
    webchat.refresh();
    syncQuickAsk();
    broadcast('settings:changed', prefs);
    if (prefs.backgroundServices.realtime && sessionCtl.isReady()) realtime.start();
    if (!prefs.backgroundServices.realtime) realtime.stop();
  });
  writeBootConfig(p.bootConfig, { hardwareAcceleration: settings.effective().hardwareAcceleration });

  // ── lifecycle ──────────────────────────────────────────────────────────
  app.on('second-instance', (_e, argv) => {
    const link = findDeepLinkInArgv(argv) ?? findMailtoInArgv(argv);
    const pdfs = pdfPathsInArgv(argv);
    if (pdfs.length) handPdfs(pdfs);
    const docs = officePathsInArgv(argv);
    if (docs.length) handOffice(docs);
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
    // The Document Server saves after the last editor leaves; the sessions are ended on the way out.
    office.closeAll(true);
    officeLocal.stop();
    webchat.stop();
    quickAsk.release();
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
    if (process.platform === 'darwin') void accessibility.refresh().then(() => broadcast('rc:changed', remoteControl.view()));
    device.poke();
    sync.kick('resume');
    realtime.kick();
    const uid = sessionCtl.userId();
    if (uid) void queue.replay(uid);
    void salonSync.sync();
    void eventDesk.sync();
    pos.sync();
    void restaurant.sync.sync();
  });
  screen.on('display-removed', () => windows.refit());
  screen.on('display-metrics-changed', () => windows.refit());

  tray.start();
  lock.start();
  // The till sends its sales with its own credential, whoever is signed in (or nobody).
  pos.start();
  updater.start();
  applyAutostartOnce(settings);

  const hidden = startedHidden() || settings.effective().startMinimized;
  windows.createMain(!hidden);
  if (devOrigin()) log.info('development renderer', { url: process.env.ELECTRON_RENDERER_URL });

  void sessionCtl.init().then(() => {
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
