import { IpcRouter } from '../../ipc/router';
import { isTrustedShellUrl, setMediaGate } from '../../security/hardening';
import type { AiService } from '../../services/ai';
import { createApiProxy } from '../../services/api-proxy';
import type { AuditService } from '../../services/audit';
import type { AuthService } from '../../services/auth';
import type { BoardVault } from '../../services/board-vault';
import type { BootstrapService } from '../../services/bootstrap';
import type { CallService } from '../../services/calls';
import type { ChequeStation } from '../../services/cheque-print';
import type { ConnectionMonitor } from '../../services/connection-quality';
import type { ContactSync } from '../../services/contact-sync';
import type { Database } from '../../services/db';
import type { DesktopSettingsService } from '../../services/desktop-settings';
import type { DeviceService } from '../../services/device';
import type { DiagnosticsService } from '../../services/diagnostics';
import type { HealthMonitor } from '../../services/discovery/health';
import type { ElearningOffline } from '../../services/elearning-offline';
import type { EventDesk } from '../../services/event-desk';
import type { EventDeskPrint } from '../../services/event-desk-print';
import type { GuestMeetService } from '../../services/guest-meet';
import { HttpClient, type FetchLike } from '../../services/http';
import type { ImageLocal } from '../../services/image-local';
import { LocalApi } from '../../services/local-api';
import type { LocalSession, LocalWorkspace } from '../../services/local-workspace';
import { LocalWorkspaceMove, type MoveAccount } from '../../services/local-workspace-move';
import type { LockService } from '../../services/lock';
import type { LockPin } from '../../services/lock-pin';
import type { MailAlertService } from '../../services/mail-alerts';
import type { MailBodies } from '../../services/mail-bodies';
import type { MailMedia } from '../../services/mail-media';
import type { MeetDiagnostics } from '../../services/meet-diagnostics';
import type { MeetRecorder } from '../../services/meet-recorder';
import type { NotificationService } from '../../services/notifications';
import type { OcrService } from '../../services/ocr';
import type { OfficeApp } from '../../services/office-app';
import type { OfficeEditorHost } from '../../services/office-editor';
import type { OfficeExternal } from '../../services/office-external';
import type { OfficeLocalFiles } from '../../services/office-local';
import type { OfflineCache } from '../../services/offline-cache';
import type { OfflineQueue } from '../../services/offline-queue';
import type { PhoneService } from '../../services/phone';
import type { PmsLocks } from '../../services/pms-locks';
import type { QuickAsk } from '../../services/quick-ask';
import type { RealtimeService } from '../../services/realtime';
import { AX_RESTARTED_ARG } from '../../services/remote-control/accessibility-watch';
import type { SalesDesk } from '../../services/sales-desk';
import type { SalonDesk } from '../../services/salon-desk';
import type { SalonPrint } from '../../services/salon-print';
import type { SalonSync } from '../../services/salon-sync';
import type { ScreenShare } from '../../services/screen-share';
import type { SecureStore } from '../../services/secure-store';
import type { SettingsService } from '../../services/settings';
import type { ShareBar } from '../../services/share-bar';
import type { SinhalaService } from '../../services/sinhala';
import type { SpeechService } from '../../services/speech';
import { attachSpellingMenu } from '../../services/spellcheck';
import type { ServiceSupervisor } from '../../services/supervisor';
import type { DriveSync } from '../../services/sync/engine';
import type { TransferManager } from '../../services/transfers';
import type { Vault } from '../../services/vault';
import type { WebchatRinger } from '../../services/webchat-ring';
import type { TrayService } from '../../tray/tray';
import type { UpdaterService } from '../../updater/updater';
import type { WindowManager } from '../../windows/manager';
import { clearCrashes, markCleanExit } from '../boot';
import type { AppContext, ClockExtra } from '../context';
import { DesktopError } from '../errors';
import { guestWindowIds } from '../events';
import { registerHandlers } from '../handlers';
import type { SessionController } from '../session';
import { canOpenApp } from '@shared/access';
import { assetsCached } from '@shared/assets';
import { eventsCached } from '@shared/event-desk';
import { hostingCached } from '@shared/hosting';
import { localize } from '@shared/localization';
import { lockedApi, lockedIpc } from '@shared/locked-access';
import { mailBodiesKept, mailListKept } from '@shared/mailto';
import { offlineReadModule } from '@shared/offline-reads';
import { pmsCached } from '@shared/pms-cache';
import type { AuthState, BusyReport, NavigateRequest, StatusSnapshot, UpdateDiagnostics, WebchatOnCall } from '@shared/types';
import { BrowserWindow, Notification, app, dialog, ipcMain, type WebContents, webContents } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BootState } from '../boot';
import type { Label } from '../../services/label/index';
import type { LocalAIHost } from '../../services/local-ai/host';
import type { LockedScope } from '@shared/locked-access';
import type { MailFiles } from '../../services/mail-files/host';
import type { Paths } from '../paths';
import type { PdfStudio } from '../../services/pdf/host';
import type { PosDesk } from '../../services/pos-desk';
import type { PosDisplayMediaStore } from '../../services/pos-display-media';
import type { PosPrint } from '../../services/pos-print';
import type { PosTill } from '../../services/pos-till';
import type { Projects } from '../../services/projects/index';
import type { RemoteControlService } from '../../services/remote-control/service';
import type { Restaurant } from '../../services/restaurant/index';
import type { WallDisplay } from '@shared/types';

/**
 * Protocol and IPC: app:// for every account's windows (the API proxy, the page policy, what is kept locally), the
 * IPC router and the context the handlers get. Moved out of the composition root (electron/main/index.ts) unchanged
 * (audit D-G13).
 */
/** What wireIpc reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireIpcDeps {
  activeCall: boolean;
  readonly ai: AiService;
  readonly attendanceBreak: (action: "start" | "end") => Promise<void>;
  readonly audit: AuditService;
  readonly auth: AuthService;
  readonly board: BoardVault;
  readonly boot: BootState;
  readonly bootstrap: BootstrapService;
  readonly busy: () => BusyReport;
  readonly cache: OfflineCache;
  readonly CACHE_PREFIXES: [string, string][];
  readonly calls: CallService;
  readonly chequeStation: ChequeStation;
  readonly clientHeaders: () => Record<string, string>;
  readonly clockAttendance: (direction: "in" | "out", extra?: ClockExtra) => Promise<void>;
  readonly connection: ConnectionMonitor;
  readonly contactSync: ContactSync;
  readonly db: Database;
  readonly desktopSettings: DesktopSettingsService;
  readonly device: DeviceService;
  readonly diagnostics: DiagnosticsService;
  readonly elearning: ElearningOffline;
  readonly emitStatus: () => void;
  readonly eventDesk: EventDesk;
  readonly eventDeskPrint: EventDeskPrint;
  readonly fetchImpl: FetchLike;
  readonly flushNavigation: () => void;
  readonly getVault: () => Vault;
  readonly guests: GuestMeetService;
  readonly health: HealthMonitor;
  readonly http: HttpClient;
  readonly imageLocal: ImageLocal;
  readonly label: Label;
  readonly liveDesk: { open: (to: "map" | "toggleMap" | "dashboard" | "wall" | "wallSheet" | "wallClose" | "chat", id?: number) => void; info: () => { wall: { display: string; name: string | null; } | null; displays: WallDisplay[]; wallPrefs: { displayId: number | null; keepAwake: boolean; cycle: boolean; openAtStart: boolean; }; wallOpen: boolean; wallGone: string | null; silencedUntil: string | null; shortcuts: boolean; }; wall: (choice: { displayId: number; keepAwake: boolean; cycle: boolean; openAtStart: boolean; }) => void; };
  readonly local: LocalWorkspace;
  localAccountKey: () => string | null;
  readonly localAI: LocalAIHost;
  readonly localSession: LocalSession;
  readonly lock: LockService;
  readonly lockPin: LockPin;
  readonly log: { debug: (msg: string, data?: unknown) => void; info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void; error: (msg: string, data?: unknown) => void; };
  readonly mailAlerts: MailAlertService;
  readonly mailBodies: MailBodies;
  readonly mailFiles: { files: MailFiles; register: (router: IpcRouter) => void; openFromOs: (paths: string[]) => void; closeAll: () => void; };
  readonly mailMedia: MailMedia;
  readonly mediaServers: () => string[];
  readonly meetDiagnostics: MeetDiagnostics;
  readonly meetRecorder: MeetRecorder;
  readonly navigate: (asked: NavigateRequest) => void;
  readonly notifications: NotificationService;
  readonly ocr: OcrService;
  readonly office: OfficeEditorHost;
  readonly officeApp: OfficeApp;
  readonly officeFiles: OfficeLocalFiles;
  readonly officeLocal: OfficeExternal;
  readonly onReachability: (ok: boolean) => void;
  readonly onUpdateActivity: () => void;
  readonly openOsSession: () => Promise<AuthState>;
  readonly OS_MODE: boolean;
  readonly p: Paths;
  readonly pdfStudio: PdfStudio;
  pendingGuest: { input: string; server?: string; } | null;
  readonly phone: PhoneService;
  readonly pmsLocks: PmsLocks;
  readonly pos: { desk: PosDesk; till: PosTill; print: PosPrint; media: PosDisplayMediaStore; register: (router: IpcRouter) => void; start: () => void; stop: () => void; sync: () => undefined; pending: () => number; serveThumb: (path: string) => Promise<Response>; forgetAll: () => void; };
  readonly projects: Projects;
  readonly queue: OfflineQueue;
  readonly quickAsk: QuickAsk;
  readonly quit: () => void;
  readonly realtime: RealtimeService;
  readonly remoteControl: RemoteControlService;
  readonly restaurant: Restaurant;
  readonly ringTray: { show: (anchor: Electron.Rectangle | null) => boolean; fit: (height: number) => void; act: (action: "inbox" | "settings" | "quit" | "close" | "dashboard" | "liveMap" | "wall" | "silence") => void; };
  readonly salesDesk: SalesDesk;
  readonly salonDesk: SalonDesk;
  readonly salonPrint: SalonPrint;
  readonly salonSync: SalonSync;
  readonly scopeFor: (sender: Electron.WebContents) => LockedScope | null;
  readonly screenShare: ScreenShare;
  readonly secrets: SecureStore;
  readonly sessionCtl: SessionController;
  readonly settings: SettingsService;
  readonly shareBar: ShareBar;
  readonly sinhala: SinhalaService;
  readonly snapshot: () => StatusSnapshot;
  readonly speech: SpeechService;
  readonly supervisor: ServiceSupervisor;
  readonly sync: DriveSync;
  readonly transfers: TransferManager;
  readonly tray: TrayService;
  readonly updateDiagnostics: () => Promise<UpdateDiagnostics>;
  readonly updatePrepared: (token: string) => void;
  readonly updater: UpdaterService;
  readonly webchat: WebchatRinger;
  readonly webchatOnCall: (c: WebchatOnCall | null) => void;
  readonly windows: WindowManager;
  workOffline: boolean;
}

export function wireIpc(root: WireIpcDeps) {
  // ── protocol + IPC ─────────────────────────────────────────────────────
  // app:// for every account's windows (installShellSession): the API proxy, the page policy, what is kept locally.
  const apiProxy = createApiProxy({
      http: root.http,
      cache: root.cache,
      userId: () => root.sessionCtl.userId(),
      cacheModuleFor: (path) => {
        const clean = path.split('?')[0]!;
        const module = root.CACHE_PREFIXES.find(([prefix]) => clean === prefix || clean.startsWith(`${prefix}/`))?.[1] ?? (pmsCached(clean) ? 'pms' : eventsCached(clean) ? 'events' : assetsCached(clean) ? 'assets' : hostingCached(clean) ? 'hosting' : offlineReadModule(clean));
        // Neither saved nor served for an app the person may not open.
        return module && canOpenApp(module, root.sessionCtl.visibleApps()) ? module : null;
      },
      cacheLimits: () => {
        const caps = root.sessionCtl.capabilities();
        const pol = root.sessionCtl.current()?.policy;
        return { enabled: caps.offlineCache, maxBytes: (pol?.offline_storage_max_mb ?? 2048) * 1024 * 1024 };
      },
      cacheScope: () => `${root.auth.getServer()?.origin ?? ''}:${root.sessionCtl.current()?.user.organizationId ?? ''}`,
      mailBodiesCached: (path) => mailBodiesKept(root.settings.effective(), path),
      mailListCached: (path) => mailListKept(root.settings.effective(), path),
      // SalonMate's desk calls carry the key this computer was paired with.
      extraHeaders: (path) => {
        const key = root.salonDesk.keyFor(path);
        // A restaurant terminal's calls carry its key too (restaurant/terminal.ts).
        if (key) return { 'X-Salon-Desk-Key': key };
        // Board's calls name this computer (X-Board-Device), so a blocked or revoked device is refused (FR-DEV-03).
        const boardHeaders = root.board.headers(path.split('?')[0]!);
        return Object.keys(boardHeaders).length ? boardHeaders : root.restaurant.headers(path);
      },
    });
  // Read on each page load: the server chosen, and the media servers it announced.
  const cspSources = () => ({ server: root.auth.getServer()?.origin ?? null, media: [...root.mediaServers(), ...root.guests.media, ...root.phone.origins()] });
  // A course's lessons kept offline, played by the app's own pages.
  const localHandler = (request: Request, path: string): Promise<Response> =>
    path.startsWith('/chat-media/')
        ? (root.sessionCtl.isReady() ? root.transfers.serveMediaPreview(request, path) : Promise.resolve(new Response('Not found', { status: 404 })))
        : path.startsWith('/elearning/')
        ? root.elearning.serve(request, path)
        : // A till's product pictures kept for offline (worksuite-desktop#296).
          path.startsWith('/pos-thumb/')
          ? root.pos.serveThumb(path)
        : // The speech model, for the speech page only (worksuite-desktop#81).
          path === '/speech/model.bin'
          ? root.speech.serveModel()
          : Promise.resolve(new Response('Not found', { status: 404 }));

  const pasteGestures = new Map<number, number>();
  app.on('web-contents-created', (_e, contents: WebContents) => {
    // A meeting window that goes away takes its share, and any control of it, with it.
    const id = contents.id;
    contents.once('destroyed', () => {
      root.pdfStudio.senderGone(id);
      root.localAI.senderGone(id);
      root.remoteControl.windowGone(id);
      root.screenShare.forget(id);
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
      if (!root.windows.isOurs(BrowserWindow.fromWebContents(event.sender)?.id ?? -1)) return false;
      return isTrustedShellUrl(frame.url);
    },
    isLocked: () => root.lock.isLocked(),
    canUseWhileLocked: (channel, input, sender) => lockedIpc(root.scopeFor(sender), channel, input, root.settings.effective()),
    isSignedIn: () => root.sessionCtl.isReady(),
    hasPermission: (key) => root.sessionCtl.hasPermission(key),
    audit: (action, details) => {
      if (['auth:signOut', 'session:switchOrganization', 'transfers:download'].includes(action)) return; // audited by the service itself
      root.audit.record(root.sessionCtl.userId(), action, details);
    },
    onAbuse: (sender, reason) => {
      root.log.error('renderer IPC abuse; reloading window', { reason });
      if (!sender.isDestroyed()) sender.reload();
    },
  });

  const relaunch = (safe: boolean, extraArgs: string[] = []): void => {
    const args = process.argv.slice(1).filter((a) => a !== '--safe-mode' && a !== '--updated' && a !== '--hidden' && a !== AX_RESTARTED_ARG && !a.startsWith('--account='));
    if (safe) args.push('--safe-mode');
    else clearCrashes(root.p.crashState);
    args.push(...extraArgs);
    markCleanExit(root.p.runningMarker);
    app.relaunch({ args });
    root.windows.quitting = true;
    app.exit(0);
  };

  const ctx: AppContext = {
    boot: root.boot,
    desktopSettings: root.desktopSettings,
    osMode: root.OS_MODE ? { signIn: () => root.openOsSession() } : undefined,
    db: root.db,
    vault: root.getVault,
    secrets: root.secrets,
    salonDesk: root.salonDesk,
    salonPrint: root.salonPrint,
    salonSync: root.salonSync,
    elearning: root.elearning,
    board: root.board,
    eventDesk: root.eventDesk,
    eventDeskPrint: root.eventDeskPrint,
    settings: root.settings,
    http: root.http,
    auth: root.auth,
    device: root.device,
    bootstrap: root.bootstrap,
    session: root.sessionCtl,
    realtime: root.realtime,
    notifications: root.notifications,
    mailAlerts: root.mailAlerts,
    cache: root.cache,
    mailBodies: root.mailBodies,
    mailMedia: root.mailMedia,
    queue: root.queue,
    transfers: root.transfers,
    meetRecorder: root.meetRecorder,
    speech: root.speech,
    sync: root.sync,
    supervisor: root.supervisor,
    lock: root.lock,
    lockPin: root.lockPin,
    updater: root.updater,
    diagnostics: root.diagnostics,
    meetDiagnostics: root.meetDiagnostics,
    audit: root.audit,
    windows: root.windows,
    calls: root.calls,
    screenShare: root.screenShare,
    shareBar: root.shareBar,
    remoteControl: root.remoteControl,
    tray: root.tray,
    status: root.snapshot,
    setActiveCall: (a) => {
      root.activeCall = a;
      root.onUpdateActivity();
    },
    activeCall: () => root.activeCall,
    updateBusy: root.busy,
    updatePrepared: root.updatePrepared,
    updateDiagnostics: root.updateDiagnostics,
    lastPasteGesture: (id) => pasteGestures.get(id) ?? 0,
    flushNavigation: root.flushNavigation,
    navigate: root.navigate,
    webchat: root.webchat,
    webchatOnCall: root.webchatOnCall,
    ringTray: root.ringTray,
    liveDesk: root.liveDesk,
    quickAsk: root.quickAsk,
    ai: root.ai,
    office: root.office,
    officeLocal: root.officeLocal,
    officeApp: root.officeApp,
    officeFiles: root.officeFiles,
    imageLocal: root.imageLocal,
    relaunch,
    quit: root.quit,
    clockAttendance: root.clockAttendance,
    attendanceBreak: root.attendanceBreak,
  };
  registerHandlers(router, ctx);
  router.handle('connection:details', () => root.connection.details());
  router.handle('connection:speedTest', () => root.connection.speedTest());
  router.handle('connection:reconnect', () => {
    // Retry on the banner: the monitor probes now (backoff reset), and the realtime connection is tried again.
    void root.health.retryNow().catch(() => undefined);
    return root.connection.reconnect();
  });
  router.handle('connection:workOffline', (input) => {
    root.workOffline = input.on;
    root.health.setWorkOffline(input.on);
    if (input.on) root.onReachability(false);
    else void root.health.retryNow().then((st) => st.state === 'ok' && root.onReachability(true)).catch(() => undefined);
    root.emitStatus();
    return root.health.state();
  });
  // The QR scan dialog (screen 6): the main window may use the camera while it is open, before anyone signs in.
  let scanCamera = false;
  router.handle('connect:scanCamera', (input) => {
    scanCamera = input.open;
  });
  setMediaGate((wc, types) => {
    const main = root.windows.getMain();
    if (!wc || !main || wc.id !== main.webContents.id || root.sessionCtl.isReady()) return true;
    return scanCamera && types.length > 0 && types.every((t) => t === 'video');
  });
  root.pdfStudio.register(router);
  root.mailFiles.register(router);
  root.pos.register(router);
  root.phone.register(router);
  root.pmsLocks.register(router);
  root.contactSync.register(router);
  root.restaurant.register(router);
  root.label.register(router);
  root.projects.register(router);
  root.salesDesk.register(router);
  root.chequeStation.register(router);
  root.sinhala.register(router);
  root.localAI.register(router);
  router.handle('ai:ocr', (input, c) => root.ocr.recognize(c.sender.id, input));
  router.handle('ai:ocrCancel', (input) => root.ocr.cancel(input.id));
  router.handle('ai:ocrStatus', () => root.ocr.status());
  const openGuest = async (input: string, server?: string, localName?: string) => {
    const prepared = await root.guests.prepare(input, server);
    const info = localName ? { ...prepared, localName } : prepared;
    const w = root.windows.open('meet', `/guest-meet/${info.uuid}?server=${encodeURIComponent(info.origin)}`, info.title ?? 'WorkSuite Meet · Guest');
    const senderId = w.webContents.id;
    root.guests.bind(senderId, info);
    guestWindowIds.add(senderId);
    w.once('closed', () => { root.guests.forget(senderId); guestWindowIds.delete(senderId); });
    root.pendingGuest = null;
    return { id: w.id };
  };
  const localWindow = (senderId: number) => root.localSession.window(senderId);
  const localOnly = (senderId: number) => root.localSession.require(senderId);
  const localApi = new LocalApi(root.local, () => root.local.profile()?.name ?? '');
  const currentMoveAccount = (): MoveAccount | null => {
    const b = root.sessionCtl.current();
    const origin = root.auth.getServer()?.origin;
    if (!root.sessionCtl.isReady() || !b || !origin) return null;
    const orgId = root.sessionCtl.organizationScope();
    return { key: createHash('sha256').update(JSON.stringify([origin, b.user.id])).digest('hex'), orgId, timezone: b.user.timezone || 'UTC' };
  };
  root.localAccountKey = () => currentMoveAccount()?.key ?? null;
  const moveBackupPath = join(root.p.profile, 'guest-move-backup.json');
  const mover = new LocalWorkspaceMove(root.local, {
    exists: () => existsSync(moveBackupPath),
    write: (text) => writeFileSync(moveBackupPath, text, { mode: 0o600, flush: true }),
    remove: () => rmSync(moveBackupPath, { force: true }),
  });
  // Guest mode: only the main window, and only while no account is signed in.
  router.handle('local:enter', (_input, c) => {
    if (root.sessionCtl.isReady()) throw new DesktopError('PERMISSION_DENIED', 'Sign out of your account to use the Local Profile.');
    if (root.windows.getMain()?.webContents.id !== c.sender.id) throw new DesktopError('PERMISSION_DENIED', 'Guest mode opens in the main WorkSuite window.');
    root.localSession.enter(c.sender.id);
    return { profile: root.local.profile(), locked: root.localSession.access.locked(c.sender.id), language: root.settings.effective().language };
  });
  router.handle('local:leave', (_input, c) => { root.localSession.leave(c.sender.id); });
  router.handle('local:status', (_input, c) => {
    localWindow(c.sender.id);
    return { profile: root.local.profile(), locked: root.localSession.access.locked(c.sender.id), language: root.settings.effective().language };
  });
  router.handle('local:profile', (input, c) => {
    localWindow(c.sender.id);
    // Creating the profile needs nothing; changing one that has a PIN needs it entered first.
    if (root.local.profile()) localOnly(c.sender.id);
    const profile = root.local.saveProfile(input);
    root.localSession.access.grant(c.sender.id);
    return profile;
  });
  router.handle('local:unlock', (input, c) => { localWindow(c.sender.id); return root.localSession.access.unlock(c.sender.id, input.pin); });
  router.handle('local:api', (input, c) => { localOnly(c.sender.id); return localApi.handle(input); });
  router.handle('local:overview', (_input, c) => {
    localOnly(c.sender.id);
    const { items, contacts, meetingInput, meetingServer } = root.local.read();
    const count = (kind: string) => items.filter((item) => item.kind === kind).length;
    return { notes: count('note'), tasks: count('task'), events: count('event'), contacts: contacts.length, meetingInput, meetingServer };
  });
  router.handle('local:meeting', (input, c) => { localOnly(c.sender.id); root.local.meeting(input.input, input.server); });
  router.handle('local:deleteAll', (_input, c) => { localOnly(c.sender.id); root.local.deleteAll(); root.localSession.access.clear(); });
  // A guest joins with the Local Profile's name and no account token, where the meeting server allows guests.
  router.handle('local:joinMeeting', (input, c) => { localOnly(c.sender.id); return openGuest(input.input, input.server, root.local.profile()?.name); });
  router.handle('local:export', async (_input, c) => {
    localOnly(c.sender.id);
    const chosen = await dialog.showSaveDialog(BrowserWindow.fromWebContents(c.sender)!, { title: 'Back up guest workspace', defaultPath: 'worksuite-local-backup.json', filters: [{ name: 'Guest workspace backup', extensions: ['json'] }] });
    if (chosen.canceled || !chosen.filePath) return { saved: false };
    writeFileSync(chosen.filePath, root.local.export(), { mode: 0o600, flush: true });
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
    let counts: ReturnType<typeof root.local.preview>;
    try { counts = root.local.preview(text); }
    catch { throw new DesktopError('IPC_VALIDATION_FAILED', 'This is not a valid guest workspace backup. Nothing was changed.'); }
    pendingRestore = { token: randomUUID(), sender: c.sender.id, text };
    return { token: pendingRestore.token, ...counts };
  });
  router.handle('local:restore', (input, c) => {
    localOnly(c.sender.id);
    const pending = pendingRestore;
    if (!pending || pending.token !== input.token || pending.sender !== c.sender.id) throw new DesktopError('PERMISSION_DENIED', 'Choose the backup again before restoring.');
    pendingRestore = null;
    try { return root.local.restore(pending.text); }
    catch { throw new DesktopError('IPC_VALIDATION_FAILED', 'This is not a valid guest workspace backup. Nothing was changed.'); }
  });
  // Signing in from guest mode: only the window that was in guest mode (past its PIN), into the account it signed in to.
  router.handle('local:moveOffer', (_input, c) => {
    const account = root.localSession.moveAccount(c.sender.id, currentMoveAccount()?.key ?? null);
    if (!account) return null;
    const offer = mover.offer(account);
    return offer.total ? offer : null;
  });
  router.handle('local:keep', (_input, c) => { if (root.localSession.moveAccount(c.sender.id, currentMoveAccount()?.key ?? null)) root.localSession.endMove(); });
  router.handle('local:move', async (_input, c) => {
    const account = currentMoveAccount();
    if (!account || !root.localSession.moveAccount(c.sender.id, account.key)) throw new DesktopError('PERMISSION_DENIED', 'Sign in from guest mode to move your local data.');
    const origin = root.auth.getServer()?.origin;
    const token = root.auth.accessToken();
    if (!origin || !token) throw new DesktopError('NOT_SIGNED_IN', 'Refresh your sign-in before moving your data.');
    // Freeze credentials and origin: a later account switch can never redirect these writes to another user.
    const headers = root.clientHeaders();
    const client = new HttpClient({ fetch: root.fetchImpl, origin: () => origin, tokens: { accessToken: () => token, refresh: async () => 'lost' }, clientHeaders: () => headers, onReachability: () => undefined, onAuthLost: () => undefined });
    const result = await mover.run(account, {
      get: (path) => client.get(path),
      post: (path, body, key) => client.post(path, body, { headers: { 'Idempotency-Key': key } }),
      put: (path, body, key) => client.request('PUT', path, { body, headers: { 'Idempotency-Key': key } }),
    }, () => currentMoveAccount()?.key ?? null);
    if (!result.failures.length) root.localSession.endMove();
    return result;
  });
  const localReminderTimer = setInterval(() => root.local.reminders(Date.now(), (item) => {
    if (!Notification.isSupported()) return false;
    try { const reminder = new Notification({ title: `${localize('Local reminder', root.settings.effective().language)} · ${item.title}`, body: localize(item.kind === 'event' ? 'Your local calendar reminder is due.' : 'Your local task reminder is due.', root.settings.effective().language) }); reminder.on('click', () => { root.windows.showMain(); }); reminder.show(); return true; }
    catch { return false; }
  }), 15000);
  app.on('before-quit', () => { clearInterval(localReminderTimer); root.local.close(); });
  router.handle('guest:pending', () => root.pendingGuest);
  router.handle('guest:open', (input) => openGuest(input.input, input.server));
  router.handle('guest:info', (_input, c) => root.guests.info(c.sender.id));
  router.handle('guest:join', (input, c) => root.guests.join(c.sender.id, input.name, input.pass));
  router.handle('guest:signIn', (_input, c) => { root.windows.showMain(); BrowserWindow.fromWebContents(c.sender)?.close(); });
  // The app's own API and local files, per window: refused while locked (but what the lock allows), and never for a
  // guest meeting window or a window in guest mode (#149).
  const apiHook = (details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void): void => {
    const id = details.webContentsId;
    const sender = id === undefined ? null : webContents.fromId(id);
    let body: unknown;
    try { body = JSON.parse((details.uploadData ?? []).map(x => x.bytes?.toString('utf8') ?? '').join('')); } catch { /* no JSON body */ }
    const allowed = !root.lock.isLocked() || lockedApi(sender ? root.scopeFor(sender) : null, details.url, details.method, root.settings.effective(), body);
    // Guest meeting windows and a window in guest mode (#149) never reach the account's API or its local cache.
    callback({ cancel: !allowed || id !== undefined && (guestWindowIds.has(id) || root.localSession.isGuest(id)) });
  };
  return { apiHook, apiProxy, cspSources, ctx, localHandler, openGuest, relaunch, router };
}
