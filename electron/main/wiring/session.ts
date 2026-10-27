import { setExternalAllowList } from '../../security/hardening';
import type { AccountRegistry } from '../../services/accounts/registry';
import type { AppearanceSync } from '../../services/appearance-sync';
import type { AssetAlerts } from '../../services/assets-alerts';
import type { AuditService } from '../../services/audit';
import type { AuthService } from '../../services/auth';
import type { BoardVault } from '../../services/board-vault';
import type { BootstrapService } from '../../services/bootstrap';
import type { CallService } from '../../services/calls';
import type { ContactSync } from '../../services/contact-sync';
import type { Database } from '../../services/db';
import type { DesktopSettingsService } from '../../services/desktop-settings';
import type { DeviceService } from '../../services/device';
import { DiagnosticsService } from '../../services/diagnostics';
import type { ElearningOffline } from '../../services/elearning-offline';
import type { EventDesk } from '../../services/event-desk';
import type { EventDeskPrint } from '../../services/event-desk-print';
import type { HostingAlerts } from '../../services/hosting-alerts';
import { CLIENT_TYPE, CLIENT_TYPE_HEADER, type FetchLike, type HttpClient, withSafeHeaders } from '../../services/http';
import { createLocalAI } from '../../services/local-ai/host';
import type { LocalSession } from '../../services/local-workspace';
import type { LockService } from '../../services/lock';
import type { LockPin } from '../../services/lock-pin';
import type { MailAlertService } from '../../services/mail-alerts';
import type { MailBodies } from '../../services/mail-bodies';
import { createMailFilesIpc } from '../../services/mail-files/ipc';
import { MeetDiagnostics } from '../../services/meet-diagnostics';
import type { MeetRecorder } from '../../services/meet-recorder';
import type { NotificationService } from '../../services/notifications';
import { OcrService } from '../../services/ocr';
import type { OfficeEditorHost } from '../../services/office-editor';
import type { OfficeExternal } from '../../services/office-external';
import type { OfficeLocalFiles } from '../../services/office-local';
import type { OfflineCache } from '../../services/offline-cache';
import type { OfflineQueue } from '../../services/offline-queue';
import type { PayrollReminders } from '../../services/payroll-reminders';
import { createPdfStudio } from '../../services/pdf/host';
import { DEFAULT_PDF_POLICY } from '../../services/pdf/service';
import type { PhoneService } from '../../services/phone';
import type { PmsLocks } from '../../services/pms-locks';
import type { RealtimeService } from '../../services/realtime';
import { accessibilityDiagnostics } from '../../services/remote-control/accessibility-diagnostics';
import type { SalonDesk } from '../../services/salon-desk';
import type { SalonPrint } from '../../services/salon-print';
import type { SalonSync } from '../../services/salon-sync';
import type { SecureStore } from '../../services/secure-store';
import type { SettingsService } from '../../services/settings';
import type { SinhalaService } from '../../services/sinhala';
import type { ServiceSupervisor } from '../../services/supervisor';
import type { DriveSync } from '../../services/sync/engine';
import type { TransferManager } from '../../services/transfers';
import type { Vault } from '../../services/vault';
import type { UpdateHistory } from '../../updater/update-flow';
import type { UpdaterService } from '../../updater/updater';
import type { WindowManager } from '../../windows/manager';
import type { AccessWatch } from '../access';
import { applyAutostart } from '../autostart';
import { writeBootConfig } from '../boot';
import { broadcast } from '../events';
import { paths } from '../paths';
import { SessionController } from '../session';
import { preferenceOverlay } from '@shared/desktop-settings';
import { mailKeptForever } from '@shared/mailto';
import { officeDocRoute } from '@shared/office';
import type { Bootstrap } from '@shared/types';
import { BrowserWindow, app, webContents } from 'electron';
import { hkdfSync } from 'node:crypto';
import { join } from 'node:path';
import type { AiPendingWatcher } from '../../services/ai-pending';
import type { AiService } from '../../services/ai';
import type { AtRiskAlerts } from '../../services/live-desk';
import type { AuthState } from '@shared/types';
import type { BootState } from '../boot';
import type { CallbackReminders } from '../../services/marketing-reminders';
import type { DesktopAccountsFile } from '../../services/office-signin';
import type { EnterpriseConfig } from '../../services/enterprise';
import type { IpcRouter } from '../../ipc/router';
import type { Label } from '../../services/label/index';
import type { LivePulse } from '../../services/live-desk';
import type { LockedScope } from '@shared/locked-access';
import type { MarketingPulse } from '../../services/marketing-pulse';
import type { MeetKeys } from '../../services/meet-keys';
import type { MeetNext } from '../../services/meet-next';
import type { MeetingsDesk } from '../../services/meetings-desk';
import type { NavigateRequest } from '@shared/types';
import type { NetFetchInit } from '../../services/net-fetch';
import type { NextContactKey } from '../../services/marketing-shortcut';
import type { OfficeAiPolicySync } from '../../services/office-ai-policy';
import type { OfficeSignIn } from '../../services/office-signin';
import type { Paths } from '../paths';
import type { PosDesk } from '../../services/pos-desk';
import type { PosDisplayMediaStore } from '../../services/pos-display-media';
import type { PosPrint } from '../../services/pos-print';
import type { PosTill } from '../../services/pos-till';
import type { ProfilePaths } from '../../services/accounts/profile';
import type { Projects } from '../../services/projects/index';
import type { PurchaseDesk } from '../../services/purchase-desk';
import type { QuickAsk } from '../../services/quick-ask';
import type { RemoteControlService } from '../../services/remote-control/service';
import type { Restaurant } from '../../services/restaurant/index';
import type { SalesDesk } from '../../services/sales-desk';
import type { SupportDesk } from '../../services/support-desk';
import type { SupportNotices } from '../../services/support-notices';
import type { SupportUrgent } from '../../services/support-urgent';
import type { TrayService } from '../../tray/tray';
import type { WebchatRinger } from '../../services/webchat-ring';

/**
 * The session: what happens when someone signs in, out or back in (the per-user services, PDF Studio, Local AI, OCR,
 * diagnostics, mail data files) and when the server is reachable again. Moved out of the composition root
 * (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wireSession reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireSessionDeps {
  readonly accessWatch: AccessWatch;
  readonly accountFollowsSession: (s: AuthState) => void;
  readonly accountPaths: () => ProfilePaths;
  readonly ai: AiService;
  readonly aiPending: AiPendingWatcher;
  readonly appearanceSync: AppearanceSync;
  readonly applyAccess: (b: Bootstrap | null) => void;
  readonly applySpellcheck: (wc: Electron.WebContents) => void;
  readonly assetAlerts: AssetAlerts;
  readonly atRisk: AtRiskAlerts;
  attendanceTimer: NodeJS.Timeout | null;
  readonly audit: AuditService;
  readonly auth: AuthService;
  readonly board: BoardVault;
  readonly boot: BootState;
  readonly bootstrap: BootstrapService;
  readonly cache: OfflineCache;
  readonly callbackReminders: CallbackReminders;
  readonly calls: CallService;
  readonly contactSync: ContactSync;
  readonly db: Database;
  readonly dbKey: string;
  readonly desktopAccounts: DesktopAccountsFile;
  readonly desktopSettings: DesktopSettingsService;
  readonly device: DeviceService;
  readonly elearning: ElearningOffline;
  readonly emitStatus: () => void;
  readonly enterprise: EnterpriseConfig;
  readonly eventDesk: EventDesk;
  readonly eventDeskPrint: EventDeskPrint;
  readonly fetchImpl: FetchLike;
  readonly flushNavigation: () => void;
  handMailFiles: (paths: string[]) => void;
  handOffice: (paths: string[]) => void;
  handPdfs: (paths: string[]) => void;
  readonly heartbeatPresence: () => Promise<void>;
  readonly hostingAlerts: HostingAlerts;
  readonly http: HttpClient;
  readonly label: Label;
  readonly livePulse: LivePulse;
  liveSilencedUntil: number;
  readonly localAccountKey: () => string | null;
  readonly localSession: LocalSession;
  readonly lock: LockService;
  readonly lockPin: LockPin;
  readonly log: { debug: (msg: string, data?: unknown) => void; info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void; error: (msg: string, data?: unknown) => void; };
  readonly mailAlerts: MailAlertService;
  readonly mailBodies: MailBodies;
  readonly marketingPulse: MarketingPulse;
  readonly mediaServers: () => string[];
  readonly meetingsDesk: MeetingsDesk;
  readonly meetKeys: MeetKeys;
  readonly meetNext: MeetNext;
  readonly meetRecorder: MeetRecorder;
  readonly navigate: (asked: NavigateRequest) => void;
  readonly netFetch: (input: string | URL | Request, init?: NetFetchInit) => Promise<Response>;
  readonly nextContactKey: NextContactKey;
  readonly notifications: NotificationService;
  readonly office: OfficeEditorHost;
  readonly officeAiPolicy: OfficeAiPolicySync;
  readonly officeFiles: OfficeLocalFiles;
  readonly officeLocal: OfficeExternal;
  readonly officeSignIn: OfficeSignIn;
  readonly p: Paths;
  readonly payrollReminders: PayrollReminders;
  pdfOnline: () => void;
  readonly pendingMailFiles: string[];
  readonly pendingNav: NavigateRequest[];
  readonly pendingOffice: string[];
  readonly pendingPdfs: string[];
  readonly phone: PhoneService;
  readonly pmsLocks: PmsLocks;
  readonly pos: { desk: PosDesk; till: PosTill; print: PosPrint; media: PosDisplayMediaStore; register: (router: IpcRouter) => void; start: () => void; stop: () => void; sync: () => undefined; pending: () => number; serveThumb: (path: string) => Promise<Response>; forgetAll: () => void; };
  presenceTimer: NodeJS.Timeout | null;
  readonly projects: Projects;
  readonly purchaseDesk: PurchaseDesk;
  readonly queue: OfflineQueue;
  readonly quickAsk: QuickAsk;
  readonly realtime: RealtimeService;
  readonly rebuildMenu: (visible: Set<string>) => void;
  readonly refreshAttendance: () => Promise<void>;
  readonly refreshTrayPresence: () => Promise<void>;
  readonly registry: AccountRegistry;
  readonly remoteControl: RemoteControlService;
  readonly reportCapabilities: () => void;
  readonly restaurant: Restaurant;
  readonly salesDesk: SalesDesk;
  readonly salonDesk: SalonDesk;
  readonly salonPrint: SalonPrint;
  readonly salonSync: SalonSync;
  readonly scopeFor: (sender: Electron.WebContents) => LockedScope | null;
  readonly secrets: SecureStore;
  sessionCtl: SessionController;
  readonly settings: SettingsService;
  readonly sinhala: SinhalaService;
  readonly stopPresence: () => void;
  readonly supervisor: ServiceSupervisor;
  readonly supportDesk: SupportDesk;
  readonly supportNotices: SupportNotices;
  readonly supportUrgent: SupportUrgent;
  readonly sync: DriveSync;
  readonly syncLiveKeys: () => void;
  readonly syncQuickAsk: () => void;
  readonly syncSupportKeys: () => void;
  readonly transfers: TransferManager;
  readonly tray: TrayService;
  readonly updateHistory: UpdateHistory;
  readonly updater: UpdaterService;
  readonly vault: Vault;
  wasSignedIn: boolean;
  readonly webchat: WebchatRinger;
  readonly windows: WindowManager;
}

export function wireSession(root: WireSessionDeps) {
  // ── the session ────────────────────────────────────────────────────────
  const startServices = (b: Bootstrap): void => {
    const uid = b.user.id;
    setExternalAllowList([new URL(root.auth.getServer()!.origin).hostname]);
    if (root.settings.effective().backgroundServices.realtime) root.realtime.start();
    root.notifications.start(uid);
    root.payrollReminders.start();
    root.assetAlerts.start();
    root.hostingAlerts.start();
    root.mailAlerts.start();
    root.supportNotices.start();
    root.supportDesk.start();
    root.supportUrgent.start();
    root.webchat.start();
    root.livePulse.start();
    root.syncQuickAsk();
    // Sinhala Tools: profiles on sign-in and daily; the tools show once the server says they are on (blueprint §6.1).
    root.sinhala.start();
    void root.sinhala.sync();
    // Quick Ask waits on the company's rules; once they are known, it is offered (or not).
    void root.ai.refresh().then(() => {
      root.syncQuickAsk();
      root.aiPending.start();
    });
    root.marketingPulse.start();
    root.meetNext.start();
    root.meetingsDesk.start();
    root.callbackReminders.start();
    root.device.start();
    root.device.extras = () => {
      const c = root.transfers.activeCounts();
      const s = root.sync.health();
      return { pendingUp: root.queue.pendingCount(uid) + root.salonSync.pending() + root.eventDesk.pending() + root.pos.pending() + root.restaurant.sync.pending() + c.uploads + s.pendingUp, pendingDown: c.downloads + s.pendingDown, lastError: s.lastError };
    };
    root.sync.start(uid);
    root.transfers.recover();
    // Recordings carry on from where they were: a recording cut off by a crash is finished, uploads continue.
    void root.meetRecorder.recover().catch(() => undefined);
    void root.queue.replay(uid);
    root.salonSync.start();
    root.eventDesk.start();
    root.restaurant.start();
    root.projects.start();
    root.label.host.start();
    // Courses kept offline: the ones whose learning ended, or whose licence ran out, go.
    void root.elearning.validate().catch((e) => root.log.warn('offline courses not checked', { error: String(e) }));
    // Board: what waited offline goes up, revocations and expiries are applied.
    void root.board.sync().catch(() => undefined);
    void root.audit.flush();
    void root.refreshAttendance();
    root.attendanceTimer = setInterval(() => void root.refreshAttendance(), 5 * 60_000);
    root.attendanceTimer.unref?.();
    root.stopPresence();
    void root.heartbeatPresence();
    void root.refreshTrayPresence();
    root.presenceTimer = setInterval(() => void root.heartbeatPresence(), 30_000);
    root.presenceTimer.unref?.();
    // What this computer can do for Meet remote control (WF-RC-08), once the device is known.
    setTimeout(root.reportCapabilities, 5_000).unref?.();
    root.accessWatch.start();
    // FR-OFF-06: prune mail bodies beyond the cache window.
    const days = root.settings.effective().mailCacheDays;
    // A folder kept whole on this computer is not pruned by age (worksuite-desktop#162).
    const keepAll = (path: string) => mailKeptForever(root.settings.effective(), path);
    if (days > 0) root.cache.pruneModuleOlderThan('mail', days, keepAll);
    // A mailbox's own keep period (Settings › Mail › Storage & sync, D09).
    const me = root.sessionCtl.current()?.user?.id;
    for (const [box, d] of Object.entries(root.settings.effective().mailCacheDaysByMailbox ?? {})) if (me) root.cache.pruneMailbox(String(me), box, d, keepAll);
    root.mailBodies.start();
    root.emitStatus();
  };
  const stopServices = (): void => {
    root.sinhala.stop();
    root.sinhala.signedOut();
    root.mailBodies.stop();
    root.projects.stop();
    void root.remoteControl.shutdown('logout');
    root.webchat.stop();
    root.livePulse.stop();
    root.atRisk.clear();
    root.liveSilencedUntil = 0;
    root.windows.closeRingTray();
    root.quickAsk.release();
    root.ai.forget();
    root.aiPending.stop();
    root.marketingPulse.stop();
    root.meetNext.stop();
    root.meetingsDesk.stop();
    root.callbackReminders.stop();
    root.nextContactKey.release();
    root.meetKeys.releaseAll();
    root.windows.hideQuickAsk();
    root.tray.update({ quickAsk: null });
    // Torn-off windows show the person's data: they close, and come back at their next sign-in.
    root.windows.closeRecords();
    // So do chat windows and every other secondary window with someone's content in it (#103).
    root.windows.closeWhere(() => true);
    // Open documents close, and their editor partitions are cleared (OO-DSK-023).
    root.office.closeAll(true);
    root.officeLocal.stop();
    // Open PDFs close, and passwords remembered for the session are forgotten.
    void pdfStudio.closeAll();
    // Local AI's model stops; the models on this computer stay.
    void localAI.signedOut();
    // The compact phone's global shortcuts are released.
    root.phone.reset();
    root.realtime.stop();
    root.notifications.stop();
    root.payrollReminders.stop();
    root.assetAlerts.stop();
    root.hostingAlerts.stop();
    root.purchaseDesk.reset();
    root.mailAlerts.stop();
    root.supportNotices.stop();
    root.supportDesk.stop();
    root.supportUrgent.stop();
    root.syncSupportKeys();
    root.device.stop();
    root.transfers.stopAll();
    root.sync.stop();
    root.salonSync.stop();
    root.eventDesk.stop();
    root.restaurant.stop();
    if (root.attendanceTimer) clearInterval(root.attendanceTimer);
    root.label.host.stop();
    root.attendanceTimer = null;
    root.stopPresence();
    root.accessWatch.stop();
    root.tray.update({ attendance: null, apps: [] });
    root.rebuildMenu(new Set());
    // Where a notification clicked while locked pointed: not for whoever signs in next.
    root.pendingNav.length = 0;
    root.lock.reset();
    root.emitStatus();
  };

  /** Who WorkSuite Office may offer to continue as: the signed-in person, or nobody. */
  const desktopAccountOf = (ready: boolean) => {
    const origin = root.auth.getServer()?.origin;
    const user = root.sessionCtl.current()?.user ?? root.sessionCtl.get().user;
    if (!ready || !origin || !user) return null;
    return { server: origin, user: { id: String(user.id), name: user.name, email: user.email ?? '', organization: user.organizationName ?? '' } };
  };

  root.sessionCtl = new SessionController(root.db, root.auth, root.device, root.bootstrap, root.fetchImpl, root.enterprise, {
    started: (b) => startServices(b),
    stopped: () => stopServices(),
    wiped: (uid, scope, includeDrafts, keepUnsynced) => {
      // WF-24 / FR-SEC-08: WorkSuite's own data only. Nothing outside the
      // profile is touched; downloaded files the user saved are theirs.
      root.cache.clearUser(uid);
      root.notifications.clearUser(uid);
      // The salon day's copy is cache; what the desk made waits for its maker (salon-sync.ts).
      root.salonSync.signedOut(uid);
      // So is an event desk's offline copy; the scans made offline wait for the person who made them (event-desk.ts).
      root.eventDesk.signedOut(uid);
      // And the till's menu and floor copy; orders kept offline wait for whoever took them (restaurant/sync.ts).
      root.restaurant.signedOut(uid);
      root.db.run('DELETE FROM tab_sessions WHERE user_id = ?', uid);
      if (scope !== 'tokens') {
        // A plain sign-out keeps what has not reached the server (Connection & Startup §5, "N pending changes
        // kept"): the queue, the Projects outbox, queued uploads and Office copies with edits wait for the next
        // sign-in. They go only when the person discards them, with a wipe, or by the `sign_out_wipe` policy.
        if (!keepUnsynced) {
          root.queue.wipeUser(uid, includeDrafts);
          // Projects' outbox and snoozed banners, as the offline queue's (PRJ-DSK-04: cleared on sign-out).
          root.projects.wipeUser(uid);
          root.transfers.wipe(uid);
          // Copies opened in other apps are no longer watched; the files stay the person's.
          root.officeLocal.forgetUser(uid);
        }
        root.officeFiles.forget();
        // The app-lock PIN goes with the rest of what this computer kept for the person.
        root.lockPin.clear(uid);
        // And their desktop settings' copy; waiting choices go only when unsynced work goes too.
        if (!keepUnsynced) root.desktopSettings.forget(`${root.registry.activeId() ?? root.auth.getServer()?.origin ?? ''}:${uid}`);
        // PDF Studio's working copies and thumbnails (PDF-OFF-005).
        void pdfStudio.wipe();
      }
      // What Drive sync put on this computer counts as offline files (§11.2 wipe_on_revoke).
      if (scope === 'cache+offline_files') void root.sync.wipe(uid, false);
      // So are the courses kept for offline learning.
      if (scope === 'cache+offline_files') void root.elearning.wipeUser(uid).catch(() => undefined);
      // And Board's offline vault (FR-DEV-02): its own folder and keys, never the person's files.
      if (scope === 'cache+offline_files') root.board.wipeAll();
      // A remote wipe, or signing out with "remove WorkSuite's data", forgets
      // the salon desk this computer was, and its printers; a plain sign-out keeps them.
      if (includeDrafts) {
        root.salonDesk.forgetAll();
        root.salonPrint.forgetAll();
        root.salonSync.forgetAll();
        // Every event this computer was a check-in device at: the keys, the copies, the queues, the badge printer.
        root.eventDesk.forgetAll();
        root.eventDeskPrint.forgetAll();
        root.salesDesk.forgetAll();
        // The till this computer was: its credential, catalogue, sales (sent or not) and printer settings.
        root.pos.forgetAll();
        // The restaurant terminal this computer was: its key, copy, outbox and printer mapping.
        root.restaurant.forgetAll();
        // Label Studio's printers, registration and print journal on this computer (the gateway's identity is the computer's).
        root.label.forgetAll();
        // The door-lock servers this computer's front desk talked to, and their secrets.
        root.pmsLocks.wipe();
        // The iCloud and CardDAV passwords contact sync kept for this computer.
        root.contactSync.wipe();
        // Sinhala Tools' profile cache, settings and queued uploads for this person.
        root.sinhala.forget();
      }
      root.log.info('local data removed', { scope });
    },
    changed: (s) => {
      root.desktopAccounts.update(desktopAccountOf(s.stage === 'ready'));
      // Signing in ends guest mode (the window may then offer to move its data here); signing out closes the Local Profile.
      if (s.stage === 'ready' && !root.wasSignedIn) root.localSession.signedIn(root.localAccountKey());
      else if (s.stage !== 'ready' && root.wasSignedIn) root.localSession.signedOut();
      root.wasSignedIn = s.stage === 'ready';
      root.lockPin.setServerScope(s.server?.origin ?? null);
      // Per person and account (`<account>:<uid>`, §1.5 step 4); the server's origin before any account exists.
      root.settings.setUserLanguageScope(root.registry.activeId() ?? s.server?.origin ?? null, s.user?.id ?? null);
      // Whose desktop settings apply: this person's copy, at once (before the server is asked).
      root.desktopSettings.load();
      root.accountFollowsSession(s);
      broadcast('auth:changed', s);
      root.emitStatus();
      if (s.stage === 'ready') {
        root.flushNavigation();
        void root.calls.check();
      }
    },
    bootstrapChanged: (b) => {
      // A new name, picture or organisation for WorkSuite Office's "Continue as".
      root.desktopAccounts.update(desktopAccountOf(root.sessionCtl.isReady()));
      if (b) root.settings.setPolicy(b.policy);
      if (b) void root.appearanceSync.pull();
      // The person's desktop settings and their organisation's policy, with every bootstrap (sign-in, a switch, the
      // periodic check); offline the copy kept here stands.
      if (b) void root.desktopSettings.refresh();
      // Office's Local AI policy follows the session: refreshed with the bootstrap, cleared when nobody is signed in.
      void (b ? root.officeAiPolicy.sync() : root.officeAiPolicy.clear()).catch(() => undefined);
      // Policy or trust may have turned sync on or off.
      root.sync.kick('policy');
      root.applyAccess(b);
      // Windows opened from now on allow the announced media server (calls
      // and Meet each open their own window, so none needs reloading).
      if (b?.source === 'desktop-v1' && b.mediaServers && JSON.stringify(b.mediaServers) !== JSON.stringify(root.mediaServers())) {
        root.db.setConfig('media_servers', b.mediaServers);
        root.log.info('media servers', { count: b.mediaServers.length });
      }
      broadcast('session:changed', b);
    },
    syncDisabled: (reason) => {
      try {
        root.sync.setPaused(null, true);
      } catch {
        /* not signed in: nothing is syncing */
      }
      broadcast('toast', { kind: 'warning', text: reason });
    },
    minimumVersion: (v) => root.updater.setMinimum(v),
    requireUpdate: (v) => root.updater.requireUpdate(v),
    toast: (kind, text) => broadcast('toast', { kind, text }),
    audit: (uid, action, details) => root.audit.record(uid, action, details),
    // The session expired: nothing signed in is left behind the lock, and signing in again must not be refused (LOGIN-001).
    unlock: () => root.lock.reset(),
  });

  root.auth.onDeviceRevoked = (message) => void root.sessionCtl.wipe(message);

  // Apps turned off leave what the person may open; a change is enforced at once — the tray, the menu, windows and
  // every window's navigation (`desktopSettings:changed`) — and preferences a feature holds off follow.
  root.sessionCtl.disabledApps = () => root.desktopSettings.disabledModules();
  root.sessionCtl.featureOn = (id) => root.desktopSettings.feature(id);
  let lastOff = [...root.desktopSettings.disabledModules()].sort().join(',');
  root.desktopSettings.onChange((view) => {
    const before = root.settings.effective();
    root.settings.setDesktopOverlay(preferenceOverlay(view.effective));
    const after = root.settings.effective();
    if (before.startWithOs !== after.startWithOs || before.startMinimized !== after.startMinimized) applyAutostart(after.startWithOs, after.startMinimized);
    if (before.hardwareAcceleration !== after.hardwareAcceleration) writeBootConfig(paths().bootConfig, { hardwareAcceleration: after.hardwareAcceleration });
    if (before.spellcheck !== after.spellcheck) for (const wc of webContents.getAllWebContents()) root.applySpellcheck(wc);
    // Global keys and Drive sync follow their features.
    root.nextContactKey.sync();
    root.syncSupportKeys();
    root.syncLiveKeys();
    root.sync.kick('policy');
    broadcast('desktopSettings:changed', view);
    const off = [...root.desktopSettings.disabledModules()].sort().join(',');
    if (off !== lastOff) {
      lastOff = off;
      root.applyAccess(root.sessionCtl.isReady() ? root.sessionCtl.current() : null);
    }
    root.quickAsk.sync();
  });

  // Torn-off windows (FR-NAV-05/07) are remembered per person, encrypted like the tabs.
  root.windows.onRecordsChanged = (list) => {
    const uid = root.sessionCtl.userId();
    if (!uid || !root.sessionCtl.isReady()) return;
    root.db.run(
      'INSERT INTO tab_sessions (user_id, window, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, window) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      uid,
      'detached',
      root.vault.encrypt({ windows: list }),
      new Date().toISOString(),
    );
  };

  root.lock.enabled = () => root.sessionCtl.isReady() && root.settings.effective().appLockEnabled === true;
  app.on('browser-window-blur', () => {
    setImmediate(() => {
      if (root.lock.enabled() && root.lock.minutes() === 0 && !BrowserWindow.getAllWindows().some(win => win.isFocused())) root.lock.lock('timeout');
    });
  });
  root.lock.hasPin = () => root.lockPin.has(root.sessionCtl.userId());
  root.lock.pinLength = () => root.lockPin.length(root.sessionCtl.userId());
  root.lock.minutes = () => root.settings.effective().appLockMinutes;
  root.lock.lockOnSystemLock = () => root.settings.effective().lockOnSystemLock;
  root.lock.lockOnSleep = () => root.settings.effective().lockOnSleep !== false;
  root.lock.user = () => ({ name: root.sessionCtl.get().user?.name ?? null, email: root.sessionCtl.get().user?.email ?? null });
  root.lock.onChanged = (s) => {
    broadcast('lock:changed', s);
    root.emitStatus();
    // Locked: the call window stops saying who is waiting, and Quick Ask stops answering its shortcut.
    root.webchat.refresh();
    root.syncQuickAsk();
    // Locked, an urgent ticket's card comes down; unlocked, the desk is looked at again.
    void root.supportUrgent.check();
    root.nextContactKey.sync();
    root.meetKeys.sync();
    root.meetNext.publish();
    // The Sinhala clipboard key is let go while locked.
    root.sinhala.syncKey();
    if (s.locked) {
      root.windows.hideQuickAsk();
      if (!root.settings.effective().lockedShowCallerDetails) for (const win of BrowserWindow.getAllWindows()) {
        const scope = root.scopeFor(win.webContents);
        if (scope) win.setTitle(scope.kind === 'chat-mini' ? 'WorkSuite chat' : 'WorkSuite call');
      }
    } else {
      // Present again at once, not at the next heartbeat: no heartbeat went while locked (#150).
      void root.heartbeatPresence();
      broadcast('realtime:resync');
      // What a notification clicked while locked pointed at, now that the workspace is back (#114).
      if (root.pendingNav.length) setTimeout(() => root.flushNavigation(), 300);
      // And WorkSuite Office's "Continue as", if it asked while the app was locked.
      root.officeSignIn.unlocked();
    }
  };

  function onReconnect(): void {
    const uid = root.sessionCtl.userId();
    root.realtime.kick();
    root.mailBodies.kick();
    if (!uid) return;
    void root.webchat.reconcile();
    void root.sessionCtl.revalidate();
    // A session that started online asks again too: access may have changed while the server was out of reach.
    if (root.sessionCtl.current()?.offline === false) void root.accessWatch.refresh('reconnect');
    void root.queue.replay(uid);
    root.pdfOnline();
    // Converted offline copies go up as new versions (Sinhala Tools WF-SI-03).
    void root.sinhala.sync();
    void root.notifications.refreshCounts();
    void root.audit.flush();
    void root.calls.check();
    root.device.poke();
    root.sync.kick('reconnected');
    void root.salonSync.sync();
    void root.eventDesk.sync();
    root.pos.sync();
    void root.restaurant.sync.sync();
    void root.projects.reconnected();
    void root.elearning.validate().catch(() => undefined);
    void root.board.sync().catch(() => undefined);
    broadcast('realtime:resync');
  }

  // PDF Studio (services/pdf): engine workers, working copies, its IPC. Read-only viewing in this version.
  const pdfStudio = createPdfStudio({
    profile: () => root.accountPaths().dir,
    userData: root.p.userData,
    http: root.http,
    cacheKey: () => (root.secrets.getStatus().persistent ? Buffer.from(hkdfSync('sha256', Buffer.from(root.dbKey, 'base64'), 'worksuite-pdf', 'thumbnail-cache', 32)) : null),
    // The organisation's PDF policies (§21.2) come with the server's PDF Studio service (stage D2).
    policy: () => DEFAULT_PDF_POLICY,
    desktop: () => ({
      downloads: root.sessionCtl.current()?.policy.downloads !== 'disabled' && root.sessionCtl.hasPermission('desktop.downloads'),
      diskCache: root.sessionCtl.capabilities().offlineCache,
    }),
    audit: (action, details) => root.audit.record(root.sessionCtl.userId(), action, details),
    signedIn: () => root.sessionCtl.isReady(),
    dbCheck: () => root.db.integrityCheck(),
    navigate: (req) => root.navigate(req),
    appVersion: app.getVersion(),
    device: () => ({ id: root.device.installId(), name: root.device.deviceName() }),
    userName: () => root.sessionCtl.get().user?.name ?? '',
  });
  // Local AI (services/local-ai, WS-SRS-LAI): AI Studio's models from the signed-in server, llama.cpp in the ws-local-ai process.
  const localAI = createLocalAI({
    userData: root.p.userData,
    signedIn: () => root.sessionCtl.isReady(),
    serverCatalog: () => root.http.get('/api/ai/local/catalog'),
    changed: () => broadcast('ai:localChanged'),
  });
  app.on('will-quit', () => void localAI.stop());
  // Text read from images on this computer (worksuite-desktop#59): Tesseract, its language data fetched once when first needed.
  const ocr = new OcrService({
    dir: join(root.p.userData, 'LocalAI', 'ocr'),
    fetch: withSafeHeaders((url, init) => root.netFetch(url, { ...init, cache: 'no-store' } as RequestInit)),
    progress: (sender, ev) => {
      const wc = webContents.fromId(sender);
      if (wc && !wc.isDestroyed()) wc.send('ai:ocrProgress', ev);
    },
  });
  app.on('will-quit', () => void ocr.stop());
  root.handPdfs = (paths) => void pdfStudio.openFromOs(paths);
  root.pdfOnline = () => pdfStudio.online();
  if (root.pendingPdfs.length) root.handPdfs(root.pendingPdfs.splice(0));
  root.handOffice = (paths) =>
    void root.officeFiles.register(paths).then(
      ({ files }) => {
        for (const f of files) root.navigate({ route: officeDocRoute({ kind: 'local', handle: f.handle, name: f.name }), source: 'file', title: f.name });
      },
      (e: unknown) => root.log.warn('office file handed over by the system not opened', { error: String((e as Error)?.message ?? e) }),
    );
  if (root.pendingOffice.length) root.handOffice(root.pendingOffice.splice(0));
  // Mail data files, export, safe links and S/MIME (ENH-MAIL-03 P4).
  const mailFiles = createMailFilesIpc({
    http: root.http,
    broadcast: (channel, payload) => broadcast(channel, payload),
    navigate: root.navigate,
    audit: (action, details) => root.audit.record(root.sessionCtl.userId(), action, details),
    downloadFolder: () => root.settings.effective().downloadFolder,
  });
  root.handMailFiles = (paths) => mailFiles.openFromOs(paths);
  if (root.pendingMailFiles.length) root.handMailFiles(root.pendingMailFiles.splice(0));
  app.on('will-quit', () => mailFiles.closeAll());

  /*
   * The checks Settings › Remote control shows (RC09). Built here so the
   * support bundle carries the same rows: a person reading them on screen and
   * the engineer reading the bundle should not be looking at two answers.
   */
  const meetDiagnostics = new MeetDiagnostics({
    support: () => root.remoteControl.view().support,
    policy: () => root.sessionCtl.current()?.policy ?? null,
    realtime: () => root.realtime.getState(),
  });
  const diagnostics = new DiagnosticsService({
    serverOrigin: () => root.auth.getServer()?.origin ?? null,
    timedFetch: async (path) => {
      const origin = root.auth.getServer()?.origin;
      const t0 = Date.now();
      const res = await root.fetchImpl(`${origin}${path}`, { method: 'GET', headers: { [CLIENT_TYPE_HEADER]: CLIENT_TYPE }, signal: AbortSignal.timeout(15_000) });
      return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
    },
    signedIn: () => root.sessionCtl.isReady(),
    realtimeState: () => root.realtime.getState(),
    updaterState: () => {
      const u = root.updater.get();
      return { state: u.state, error: u.error, lastCheckedAt: u.lastCheckedAt, channel: u.channel };
    },
    updateHistory: () => root.updateHistory.entries(),
    services: () => root.supervisor.health(),
    dbCheck: () => root.db.integrityCheck(),
    secureStorage: () => root.secrets.getStatus(),
    policy: () => root.sessionCtl.current()?.policy ?? null,
    deviceInfo: () => root.device.info(root.secrets.getStatus()),
    accessibility: accessibilityDiagnostics,
    meet: () => meetDiagnostics.run(),
    settings: () => root.settings.effective(),
    offline: () => {
      const uid = root.sessionCtl.userId();
      return uid ? root.queue.status(uid, { bytes: root.cache.totalBytes(), entries: root.cache.count() }) : null;
    },
    crashes: () => ({ recent: root.boot.recentCrashes, uncleanExit: root.boot.uncleanExit, safeMode: root.boot.safeMode, reason: root.boot.safeModeReason }),
    safeMode: () => root.boot.safeMode,
    userDataPath: root.p.userData,
  });
  return { diagnostics, localAI, mailFiles, meetDiagnostics, ocr, onReconnect, pdfStudio };
}
