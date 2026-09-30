import { app, clipboard, crashReporter, dialog, globalShortcut, ipcMain, powerMonitor, screen, session, shell, systemPreferences, BrowserWindow, type WebContents } from 'electron';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { canOpenApp, canOpenLink, canOpenRoute, notificationAllowed, visibleAppIds } from '@shared/access';
import { findDeepLinkInArgv, parseDeepLink } from '@shared/deeplink';
import { resolveWebLink } from '@shared/links';
import { networkStatus } from '@shared/network';
import { redactUrl } from '@shared/redact';
import type { Bootstrap, NavigateRequest, RealtimeState, ServiceHealth, StatusSnapshot } from '@shared/types';
import { AccessWatch, NO_ACCESS } from './access';
import { applyAutostart, startedHidden } from './autostart';
import { evaluateBoot, markCleanExit, markRunning, clearCrashes, writeBootConfig } from './boot';
import type { AppContext, ClockExtra } from './context';
import { broadcast } from './events';
import { registerHandlers } from './handlers';
import { initLog, logger } from './log';
import { isDesktopError } from './errors';
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
import { createRemoteControl } from '../services/remote-control/host';
import { DEFAULT_POLICY } from '../services/policy';
import { Database } from '../services/db';
import { archName, DeviceService, platformName } from '../services/device';
import { SalonDesk } from '../services/salon-desk';
import { SalonPrint } from '../services/salon-print';
import { SalonSync } from '../services/salon-sync';
import { DiagnosticsService } from '../services/diagnostics';
import { readEnterpriseConfig } from '../services/enterprise';
import { HttpClient, type FetchLike } from '../services/http';
import { LockService } from '../services/lock';
import { NotificationService, inDnd } from '../services/notifications';
import { WebchatRinger, ringerHeight } from '../services/webchat-ring';
import { QuickAsk } from '../services/quick-ask';
import { AiService } from '../services/ai';
import { AI_CHANGES_LINK, AiPendingWatcher } from '../services/ai-pending';
import * as fsp from 'node:fs/promises';
import { createInjector, type Injector } from '../services/remote-control/input';
import { OfflineCache } from '../services/offline-cache';
import { OfflineQueue } from '../services/offline-queue';
import { RealtimeService } from '../services/realtime';
import { SecureStore } from '../services/secure-store';
import { SettingsService } from '../services/settings';
import { DriveSync } from '../services/sync/engine';
import { ServiceSupervisor } from '../services/supervisor';
import { TransferManager } from '../services/transfers';
import { Vault } from '../services/vault';
import { TrayService } from '../tray/tray';
import { POLICY_PUBLIC_KEY, RELEASE_PUBLIC_KEY } from '../updater/keys';
import { UpdaterService } from '../updater/updater';
import { OfficeEditors } from '../services/office/editors';
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
  const argvLink = findDeepLinkInArgv(process.argv);
  if (argvLink) pendingLinks.push(argvLink);

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
  if (enterprise.proxy && enterprise.proxy.mode !== 'system') {
    const cfg = enterprise.proxy.mode === 'pac' ? { pacScript: enterprise.proxy.url ?? '' } : { proxyRules: enterprise.proxy.rules ?? enterprise.proxy.url ?? '', proxyBypassRules: enterprise.proxy.bypass ?? '' };
    void net.setProxy(cfg);
    void session.defaultSession.setProxy(cfg);
  }
  const fetchImpl: FetchLike = (url, init) => net.fetch(url, init as RequestInit);

  const settings = new SettingsService(db);
  /** Media servers (LiveKit) the WorkSuite server announced; allowed in the page's CSP. */
  const mediaServers = (): string[] => db.getConfig<string[]>('media_servers') ?? [];
  const clientHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { 'X-WS-Client': `worksuite-desktop/${app.getVersion()} (${platformName()}; ${archName()})` };
    const dev = device?.current();
    if (dev) h['X-WS-Device'] = dev.id;
    return h;
  };

  const auth = new AuthService(db, secrets, fetchImpl, clientHeaders);

  let apiReachable = true;
  let reachabilityProbe: NodeJS.Timeout | null = null;
  const onReachability = (ok: boolean): void => {
    if (ok === apiReachable) return;
    apiReachable = ok;
    log.info(ok ? 'server reachable again' : 'server unreachable');
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
  const windows = new WindowManager(db, join(__dirname, '../preload/index.js'));
  // WorkSuite Office (OO-DSK): documents in windows of their own, the editor in an isolated view.
  const office = new OfficeEditors({
    preload: join(__dirname, '../preload/office-host.js'),
    allowHttp: !app.isPackaged,
    devTools: !app.isPackaged || process.argv.includes('--diagnostics-devtools'),
    endSession: async (fileId, sessionId, reason) => {
      await http.request('DELETE', `/api/files/${fileId}/office/session/${encodeURIComponent(sessionId)}`, { query: { reason } });
    },
    organizationId: () => sessionCtl.organizationScope(),
    locked: () => lock.isLocked(),
  });
  windows.minimizeToTray = () => settings.effective().minimizeToTray;
  // A call rings only for whoever may open Chat (calls are part of it).
  const calls = new CallService(windows, http, () => sessionCtl.isReady() && !lock.isLocked() && canOpenApp('calls', sessionCtl.visibleApps()));
  const screenShare = new ScreenShare(isTrustedShellUrl);
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

  const transfers = new TransferManager({
    db,
    vault: getVault,
    http,
    userId: () => sessionCtl.userId(),
    downloadFolder: () => settings.effective().downloadFolder,
    hash,
    canOpenFiles: () => sessionCtl.hasPermission('desktop.files.open_external'),
    audit: (action, details) => audit.record(sessionCtl.userId(), action, details),
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
  const navigate = (req: NavigateRequest): void => {
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
  const openLink = (link: string | null): void => {
    if (link === AI_CHANGES_LINK) return openAiChanges();
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
      network: networkStatus(apiReachable, realtime.getState(), realtimeDownSince),
      realtime: realtime.getState(),
      pendingChanges: uid ? queue.pendingCount(uid) + salonSync.pending() : 0,
      unread: counts,
      notificationsPausedUntil: notifications.pausedUntilIso(),
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
    realtimeDownSince = s === 'down' ? (realtimeDownSince ?? Date.now()) : null;
    emitStatus();
  };
  realtime.onEvent = (e) => {
    notifications.handleRealtime(e);
    webchat.handle(e);
    calls.handle(e);
    aiPending.handle(e as { type?: string });
    remoteControl.onRealtime(e as { type?: string; meeting?: string });
    broadcast('realtime:event', e);
    // `access.changed` (the person's apps changed) and `profile.updated`: fetch the bootstrap again.
    accessWatch.onEvent(e);
  };
  realtime.onResync = () => {
    broadcast('realtime:resync');
    // Events may have been missed while the socket was down, `access.changed` among them.
    if (sessionCtl.isReady()) void accessWatch.refresh('resync');
    void notifications.refreshList();
    void notifications.refreshCounts();
  };
  notifications.onChanged = () => {
    emitStatus();
    broadcast('notifications:changed');
  };
  notifications.onClick = (link) => openLink(link);
  // An app the person may not open never alerts (and Mail is not polled for them).
  notifications.moduleEnabled = (n) => notificationAllowed(n, sessionCtl.visibleApps());
  notifications.isLocked = () => lock.isLocked();
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
    quickAsk: () => void quickAsk.open(),
    aiChanges: () => openAiChanges(),
    ringingSettings: () => navigate({ route: '/settings/notifications', source: 'tray' }),
  });

  // ── website chats ring like calls (WS-WCHAT ENH-01, R3) ─────────────────
  const JOIN_SHORTCUT = 'CommandOrControl+Shift+J';
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
  const webchat: WebchatRinger = new WebchatRinger({
    http,
    signedIn: () => sessionCtl.isReady(),
    locked: () => lock.isLocked(),
    me: () => (sessionCtl.get().user?.id ? Number(sessionCtl.get().user?.id) : null),
    prefs: () => settings.effective().webchatRinging,
    quiet: () => {
      const p = settings.effective();
      return (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, new Date())) || notifications.pausedUntilIso() !== null;
    },
    open: (id) => navigate({ route: `/chat?view=website&website=${id}`, source: 'notification' }),
    onChanged: (s) => {
      broadcast('ring:changed', s);
      const prefs = settings.effective().webchatRinging;
      if ((s.chats.length || s.outcome) && prefs.window) windows.showRinger(ringerHeight(s));
      else windows.hideRinger();
      tray.update({ webchatRinging: s.chats.map((c) => ({ id: c.id, label: c.site ? `${c.visitor} · ${c.site}` : c.visitor })) });
      const live = s.chats.some((c) => !c.silenced);
      attention(live);
      webchat.shortcut = joinShortcut(live && prefs.shortcut);
    },
  });
  notifications.ringerShowing = () => settings.effective().webchatRinging.window && webchat.state().chats.length > 0;

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
    ['/api/dashboard/home', 'home'],
    ['/api/notifications', 'notifications'],
    // A workshop terminal opens with WorkSuite out of reach: the technician's work and the board as last seen.
    ['/api/garage/v1/options', 'garage'],
    ['/api/garage/v1/overview', 'garage'],
    ['/api/garage/v1/board', 'garage'],
    ['/api/garage/v1/my-work', 'garage'],
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
      return { pendingUp: queue.pendingCount(uid) + salonSync.pending() + c.uploads + s.pendingUp, pendingDown: c.downloads + s.pendingDown, lastError: s.lastError };
    };
    sync.start(uid);
    transfers.recover();
    void queue.replay(uid);
    salonSync.start();
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
    realtime.stop();
    notifications.stop();
    device.stop();
    transfers.stopAll();
    sync.stop();
    salonSync.stop();
    if (attendanceTimer) clearInterval(attendanceTimer);
    attendanceTimer = null;
    stopPresence();
    accessWatch.stop();
    tray.update({ attendance: null, apps: [] });
    rebuildMenu(new Set());
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
      db.run('DELETE FROM tab_sessions WHERE user_id = ?', uid);
      if (scope !== 'tokens') {
        queue.wipeUser(uid, includeDrafts);
        transfers.wipe(uid);
      }
      // What Drive sync put on this computer counts as offline files (§11.2 wipe_on_revoke).
      if (scope === 'cache+offline_files') void sync.wipe(uid, false);
      // A remote wipe, or signing out with "remove WorkSuite's data", forgets
      // the salon desk this computer was, and its printers; a plain sign-out keeps them.
      if (includeDrafts) {
        salonDesk.forgetAll();
        salonPrint.forgetAll();
        salonSync.forgetAll();
      }
      log.info('local data removed', { scope });
    },
    changed: (s) => {
      broadcast('auth:changed', s);
      // Signed out, expired, revoked: the documents close with the session.
      if (s.stage !== 'ready') office.closeAllNow();
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

  lock.enabled = () => sessionCtl.isReady();
  lock.minutes = () => settings.effective().appLockMinutes;
  lock.lockOnSystemLock = () => settings.effective().lockOnSystemLock;
  lock.user = () => ({ name: sessionCtl.get().user?.name ?? null, email: sessionCtl.get().user?.email ?? null });
  lock.onChanged = (s) => {
    broadcast('lock:changed', s);
    emitStatus();
    // Locked: the call window stops saying who is waiting, and Quick Ask stops answering its shortcut.
    webchat.refresh();
    syncQuickAsk();
    if (s.locked) windows.hideQuickAsk();
    // A document's editor is a view of its own, above the page: it goes while the lock shows.
    office.lockChanged();
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
    void notifications.refreshCounts();
    void audit.flush();
    void calls.check();
    device.poke();
    sync.kick('reconnected');
    void salonSync.sync();
    broadcast('realtime:resync');
  }

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
        const module = CACHE_PREFIXES.find(([prefix]) => clean === prefix || clean.startsWith(`${prefix}/`))?.[1] ?? null;
        // Neither saved nor served for an app the person may not open.
        return module && canOpenApp(module, sessionCtl.visibleApps()) ? module : null;
      },
      cacheLimits: () => {
        const caps = sessionCtl.capabilities();
        const pol = sessionCtl.current()?.policy;
        return { enabled: caps.offlineCache, maxBytes: (pol?.offline_storage_max_mb ?? 2048) * 1024 * 1024 };
      },
      mailBodiesCached: () => settings.effective().mailCacheDays !== 0,
      // SalonMate's desk calls carry the key this computer was paired with.
      extraHeaders: (path) => {
        const key = salonDesk.keyFor(path);
        return key ? { 'X-Salon-Desk-Key': key } : null;
      },
    }),
    // Read on each page load: the server chosen, and the media servers it announced.
    () => ({ server: auth.getServer()?.origin ?? null, media: mediaServers() }),
  );

  const pasteGestures = new Map<number, number>();
  app.on('web-contents-created', (_e, contents: WebContents) => {
    // A meeting window that goes away takes its share, and any control of it, with it.
    const id = contents.id;
    contents.once('destroyed', () => {
      remoteControl.windowGone(id);
      screenShare.forget(id);
    });
    contents.on('before-input-event', (_ev, input) => {
      if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'v') pasteGestures.set(contents.id, Date.now());
    });
  });

  const router = new IpcRouter(ipcMain, {
    isTrustedSender: (event) => {
      const frame = event.senderFrame;
      if (!frame || frame.parent !== null) return false; // main frame only; no iframes
      if (!windows.isOurs(BrowserWindow.fromWebContents(event.sender)?.id ?? -1)) return false;
      return isTrustedShellUrl(frame.url);
    },
    isLocked: () => lock.isLocked(),
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

  const relaunch = (safe: boolean): void => {
    const args = process.argv.slice(1).filter((a) => a !== '--safe-mode' && a !== '--updated' && a !== '--hidden');
    if (safe) args.push('--safe-mode');
    else clearCrashes(p.crashState);
    markCleanExit(p.runningMarker);
    app.relaunch({ args });
    windows.quitting = true;
    app.exit(0);
  };

  const ctx: AppContext = {
    office,
    boot,
    db,
    vault: getVault,
    secrets,
    salonDesk,
    salonPrint,
    salonSync,
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
    sync,
    supervisor,
    lock,
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
    quickAsk,
    ai,
    relaunch,
    quit,
    clockAttendance,
    attendanceBreak,
  };
  registerHandlers(router, ctx);
  router.install();
  const missing = router.missingHandlers();
  if (missing.length) log.warn('IPC channels without handlers', { missing });

  rebuildMenu(sessionCtl.visibleApps());

  settings.onChange((prefs) => {
    webchat.refresh();
    syncQuickAsk();
    broadcast('settings:changed', prefs);
    if (prefs.backgroundServices.realtime && sessionCtl.isReady()) realtime.start();
    if (!prefs.backgroundServices.realtime) realtime.stop();
  });
  writeBootConfig(p.bootConfig, { hardwareAcceleration: settings.effective().hardwareAcceleration });

  // ── lifecycle ──────────────────────────────────────────────────────────
  app.on('second-instance', (_e, argv) => {
    const link = findDeepLinkInArgv(argv);
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
    webchat.stop();
    quickAsk.release();
    void askHelper?.then((h) => h?.stop());
    // Windows' places are saved while the database is open; timers that read it stop first.
    windows.saveAllAndStop();
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = null;
    calls.stop();
    transfers.stopAll();
    sync.stop();
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
  powerMonitor.on('suspend', () => remoteControl.onSystem('suspend'));
  powerMonitor.on('user-did-resign-active', () => remoteControl.onSystem('user-did-resign-active'));
  powerMonitor.on('resume', () => {
    device.poke();
    sync.kick('resume');
    realtime.kick();
    const uid = sessionCtl.userId();
    if (uid) void queue.replay(uid);
    void salonSync.sync();
  });
  screen.on('display-removed', () => windows.refit());
  screen.on('display-metrics-changed', () => windows.refit());

  tray.start();
  lock.start();
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
