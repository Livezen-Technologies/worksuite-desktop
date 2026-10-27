import type { IpcRouter } from '../../ipc/router';
import { devOrigin } from '../../security/hardening';
import type { CallService } from '../../services/calls';
import type { Database } from '../../services/db';
import type { DeviceService } from '../../services/device';
import type { EventDesk } from '../../services/event-desk';
import type { AtRiskAlerts, LivePulse } from '../../services/live-desk';
import type { LockService } from '../../services/lock';
import { mailFilePathsInArgv } from '../../services/mail-files/argv';
import type { MarketingPulse } from '../../services/marketing-pulse';
import type { CallbackReminders } from '../../services/marketing-reminders';
import type { NextContactKey } from '../../services/marketing-shortcut';
import type { MeetKeys } from '../../services/meet-keys';
import type { MeetNext } from '../../services/meet-next';
import type { MeetingsDesk } from '../../services/meetings-desk';
import type { NotificationService } from '../../services/notifications';
import type { OfficeEditorHost } from '../../services/office-editor';
import type { OfficeExternal } from '../../services/office-external';
import { officePathsInArgv } from '../../services/office-local';
import type { OfflineQueue } from '../../services/offline-queue';
import { pdfPathsInArgv } from '../../services/pdf/local-files';
import type { QuickAsk } from '../../services/quick-ask';
import type { RealtimeService } from '../../services/realtime';
import { watchAccessibility } from '../../services/remote-control/accessibility-watch';
import { accessibility } from '../../services/remote-control/host';
import type { Injector } from '../../services/remote-control/input';
import type { SalonSync } from '../../services/salon-sync';
import type { SettingsService } from '../../services/settings';
import type { SpeechService } from '../../services/speech';
import type { ServiceSupervisor } from '../../services/supervisor';
import type { DriveSync } from '../../services/sync/engine';
import type { TransferManager } from '../../services/transfers';
import type { WebchatRinger } from '../../services/webchat-ring';
import { NO_TRAY_HINT, indicatorHostRunning, type TrayService } from '../../tray/tray';
import type { UpdaterService } from '../../updater/updater';
import type { WindowManager } from '../../windows/manager';
import { gatewayPairingArgs, startedAsGateway, startedHidden } from '../autostart';
import { markCleanExit } from '../boot';
import { broadcast } from '../events';
import type { SessionController } from '../session';
import type { AccountRecord } from '@shared/accounts';
import { findDeepLinkInArgv } from '@shared/deeplink';
import { findMailtoInArgv } from '@shared/mailto';
import { moduleLinkInArgv } from '@shared/os-mode';
import { SUPPORT_QUICK_SHORTCUT } from '@shared/support';
import type { AuthState } from '@shared/types';
import { app, globalShortcut, powerMonitor, screen } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { BootState } from '../boot';
import type { Label } from '../../services/label/index';
import type { Paths } from '../paths';
import type { PosDesk } from '../../services/pos-desk';
import type { PosDisplayMediaStore } from '../../services/pos-display-media';
import type { PosPrint } from '../../services/pos-print';
import type { PosTill } from '../../services/pos-till';
import type { Projects } from '../../services/projects/index';
import type { RemoteControlService } from '../../services/remote-control/service';
import type { Restaurant } from '../../services/restaurant/index';

/**
 * The app's lifecycle: activate, second instance, power and suspend, before-quit and the clean exit. Moved out of the
 * composition root (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wireLifecycle reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireLifecycleDeps {
  readonly applyAutostartOnce: (settings: SettingsService) => void;
  readonly askHelper: Promise<Injector | null> | null;
  readonly atRisk: AtRiskAlerts;
  readonly boot: BootState;
  readonly callbackReminders: CallbackReminders;
  readonly calls: CallService;
  readonly db: Database;
  readonly device: DeviceService;
  readonly emitStatus: () => void;
  readonly eventDesk: EventDesk;
  readonly firstAccount: AccountRecord | null;
  readonly handleDeepLink: (url: string) => void;
  readonly handMailFiles: (paths: string[]) => void;
  readonly handOffice: (paths: string[]) => void;
  readonly handPdfs: (paths: string[]) => void;
  readonly label: Label;
  readonly livePulse: LivePulse;
  readonly lock: LockService;
  readonly log: { debug: (msg: string, data?: unknown) => void; info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void; error: (msg: string, data?: unknown) => void; };
  readonly marketingPulse: MarketingPulse;
  readonly meetingsDesk: MeetingsDesk;
  readonly meetKeys: MeetKeys;
  readonly meetNext: MeetNext;
  readonly nextContactKey: NextContactKey;
  readonly notifications: NotificationService;
  readonly office: OfficeEditorHost;
  readonly officeLocal: OfficeExternal;
  readonly openOsSession: () => Promise<AuthState>;
  readonly OS_MODE: boolean;
  readonly p: Paths;
  readonly pendingLinks: string[];
  readonly pos: { desk: PosDesk; till: PosTill; print: PosPrint; media: PosDisplayMediaStore; register: (router: IpcRouter) => void; start: () => void; stop: () => void; sync: () => undefined; pending: () => number; serveThumb: (path: string) => Promise<Response>; forgetAll: () => void; };
  readonly projects: Projects;
  readonly queue: OfflineQueue;
  readonly quickAsk: QuickAsk;
  readonly quit: () => void;
  readonly realtime: RealtimeService;
  readonly remoteControl: RemoteControlService;
  readonly restaurant: Restaurant;
  readonly salonSync: SalonSync;
  readonly sessionCtl: SessionController;
  readonly settings: SettingsService;
  readonly speech: SpeechService;
  statusTimer: NodeJS.Timeout | null;
  readonly supervisor: ServiceSupervisor;
  readonly supportKeyHeld: boolean;
  readonly sync: DriveSync;
  readonly transfers: TransferManager;
  readonly tray: TrayService;
  readonly updater: UpdaterService;
  readonly useTokenEndpointFor: (account: AccountRecord | null) => Promise<void>;
  readonly webchat: WebchatRinger;
  readonly windows: WindowManager;
}

export function wireLifecycle(root: WireLifecycleDeps) {
  // ── lifecycle ──────────────────────────────────────────────────────────
  app.on('second-instance', (_e, argv) => {
    const link = findDeepLinkInArgv(argv) ?? findMailtoInArgv(argv) ?? moduleLinkInArgv(argv);
    const pdfs = pdfPathsInArgv(argv);
    if (pdfs.length) root.handPdfs(pdfs);
    const docs = officePathsInArgv(argv);
    if (docs.length) root.handOffice(docs);
    const mails = mailFilePathsInArgv(argv);
    if (mails.length) root.handMailFiles(mails);
    if (link) root.handleDeepLink(link);
    else root.windows.showMain();
  });
  app.on('activate', () => root.windows.showMain());
  app.on('window-all-closed', () => {
    // With minimize-to-tray the main window hides rather than closes, so this
    // runs only when the user chose Exit on close (FR-TRAY-02).
    if (process.platform !== 'darwin') root.quit();
  });
  app.on('before-quit', () => {
    root.windows.quitting = true;
    // Settings › Updates › Install when quitting (#205): the installer starts now and finishes after we exit.
    root.updater.installOnQuitSync();
    // The Document Server saves after the last editor leaves; the sessions are ended on the way out.
    root.office.closeAll(true);
    root.officeLocal.stop();
    root.webchat.stop();
    root.livePulse.stop();
    root.atRisk.clear();
    root.quickAsk.release();
    if (root.supportKeyHeld) globalShortcut.unregister(SUPPORT_QUICK_SHORTCUT);
    root.nextContactKey.release();
    root.meetKeys.releaseAll();
    root.marketingPulse.stop();
    root.meetNext.stop();
    root.meetingsDesk.stop();
    root.callbackReminders.stop();
    void root.askHelper?.then((h) => h?.stop());
    // Windows' places are saved while the database is open; timers that read it stop first.
    root.windows.saveAllAndStop();
    if (root.statusTimer) clearTimeout(root.statusTimer);
    root.statusTimer = null;
    root.calls.stop();
    root.speech.stop();
    root.transfers.stopAll();
    root.sync.stop();
    // What scans changed in an event desk's copy is written back before the database closes.
    root.eventDesk.stop();
    root.pos.stop();
    root.restaurant.stop();
    root.supervisor.stopAll();
    root.label.stop();
    root.realtime.stop();
    root.updater.stop();
    root.lock.stop();
    root.tray.destroy();
    root.db.close();
    markCleanExit(root.p.runningMarker);
  });
  // The screen locked, sleep, another user: control pauses on this computer (§E.6).
  powerMonitor.on('lock-screen', () => root.remoteControl.onSystem('lock-screen'));
  powerMonitor.on('suspend', () => {
    root.remoteControl.onSystem('suspend');
    // Asleep, the socket hears nothing: what arrives meanwhile is caught up on the resync (#114).
    root.notifications.markGap();
  });
  powerMonitor.on('user-did-resign-active', () => root.remoteControl.onSystem('user-did-resign-active'));
  // Back from System Settings, or WorkSuite brought to the front: Accessibility is asked again and every window told.
  watchAccessibility({ app, platform: process.platform, recheck: () => accessibility.refresh(), changed: () => broadcast('rc:changed', root.remoteControl.view()) });
  powerMonitor.on('resume', () => {
    // After waking: check for updates (#205).
    root.updater.wake();
    if (process.platform === 'darwin') void accessibility.refresh().then(() => broadcast('rc:changed', root.remoteControl.view()));
    root.device.poke();
    root.sync.kick('resume');
    // A socket or SSE stream silent through the sleep is replaced, resuming from its last sid (plan 2.12): the
    // gateway replays what came meanwhile, or says reset and every view syncs.
    root.realtime.kick();
    const uid = root.sessionCtl.userId();
    if (uid) void root.queue.replay(uid);
    void root.salonSync.sync();
    void root.eventDesk.sync();
    root.pos.sync();
    void root.restaurant.sync.sync();
    void root.projects.reconnected();
    // Callback reminders set again from the clock as it is now; the tray's counts asked again.
    root.callbackReminders.resume();
    root.marketingPulse.poke();
  });
  screen.on('display-removed', () => root.windows.refit());
  screen.on('display-metrics-changed', () => root.windows.refit());

  root.tray.start();
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
  if (root.OS_MODE) {
    root.updater.disable("WorkSuite OS keeps WorkSuite up to date with the system's own updates.");
    root.log.info('WorkSuite OS mode: sign-in through the OS, device from the OS enrolment, no self-updates, no app lock');
  }
  root.lock.start();
  // The till sends its sales with its own credential, whoever is signed in (or nobody).
  root.pos.start();
  // The Print Gateway runs with its own device identity, whoever is signed in (or nobody); a headless box pairs from its command line.
  root.label.gateway.start();
  const pairArgs = startedAsGateway() ? gatewayPairingArgs() : null;
  if (pairArgs && !root.label.gateway.status().paired) void root.label.gateway.pair({ ...pairArgs, name: pairArgs.name ?? os.hostname() }).catch((e) => root.log.warn('print gateway pairing failed', { error: String(e) }));
  root.updater.start();
  root.applyAutostartOnce(root.settings);

  const hidden = startedHidden() || root.settings.effective().startMinimized;
  const mainWindow = root.windows.createMain(!hidden);
  // The first-run health check (#205): the window loaded and stayed up, so an update that brought this version is good.
  mainWindow.webContents.once('did-finish-load', () => setTimeout(() => root.updater.healthy(), 10_000).unref?.());
  if (devOrigin()) root.log.info('development renderer', { url: process.env.ELECTRON_RENDERER_URL });

  const startSession = root.OS_MODE ? () => root.openOsSession().then(() => undefined) : () => root.useTokenEndpointFor(root.firstAccount).then(() => root.sessionCtl.init());
  void startSession().then(() => {
    for (const link of root.pendingLinks.splice(0)) root.handleDeepLink(link);
    root.emitStatus();
  });

  if (root.boot.safeMode) root.log.warn('running in safe mode', { reason: root.boot.safeModeReason });
}
