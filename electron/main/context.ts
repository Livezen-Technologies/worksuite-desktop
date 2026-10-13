import type { OfficeLocalFiles } from '../services/office-local';
import type { ImageLocal } from '../services/image-local';
import type { MailBodies } from '../services/mail-bodies';
import type { MailMedia } from '../services/mail-media';
import type { QuickAsk } from '../services/quick-ask';
import type { AiService } from '../services/ai';
import type { WebchatRinger } from '../services/webchat-ring';
import type { AuthState, NavigateRequest } from '@shared/types';
import type { AuditService } from '../services/audit';
import type { AuthService } from '../services/auth';
import type { CallService } from '../services/calls';
import type { ScreenShare } from '../services/screen-share';
import type { ShareBar } from '../services/share-bar';
import type { RemoteControlService } from '../services/remote-control/service';
import type { BootstrapService } from '../services/bootstrap';
import type { Database } from '../services/db';
import type { DeviceService } from '../services/device';
import type { DiagnosticsService } from '../services/diagnostics';
import type { MeetDiagnostics } from '../services/meet-diagnostics';
import type { HttpClient } from '../services/http';
import type { LockService } from '../services/lock';
import type { LockPin } from '../services/lock-pin';
import type { NotificationService } from '../services/notifications';
import type { MailAlertService } from '../services/mail-alerts';
import type { OfflineCache } from '../services/offline-cache';
import type { OfflineQueue } from '../services/offline-queue';
import type { SecureStore } from '../services/secure-store';
import type { SettingsService } from '../services/settings';
import type { ServiceSupervisor } from '../services/supervisor';
import type { MeetRecorder } from '../services/meet-recorder';
import type { SpeechService } from '../services/speech';
import type { TransferManager } from '../services/transfers';
import type { DriveSync } from '../services/sync/engine';
import type { RealtimeService } from '../services/realtime';
import type { SalonDesk } from '../services/salon-desk';
import type { SalonPrint } from '../services/salon-print';
import type { SalonSync } from '../services/salon-sync';
import type { ElearningOffline } from '../services/elearning-offline';
import type { EventDesk } from '../services/event-desk';
import type { EventDeskPrint } from '../services/event-desk-print';
import type { OfficeEditorHost } from '../services/office-editor';
import type { OfficeExternal } from '../services/office-external';
import type { OfficeApp } from '../services/office-app';
import type { TrayService } from '../tray/tray';
import type { UpdaterService } from '../updater/updater';

/** What else a clock-in or clock-out may carry. */
export interface ClockExtra {
  note?: string;
  workLocation?: string;
  geoNote?: string;
  noteType?: 'normal' | 'overtime' | 'customer_visit' | 'off_site' | 'wfh' | 'early_departure' | 'missed_break' | 'technical_issue' | 'other';
}
import type { WindowManager } from '../windows/manager';
import type { BootState } from './boot';
import type { SessionController } from './session';
import type { BusyReport, LiveDeskInfo, StatusSnapshot, UpdateDiagnostics, WallModePrefs, WebchatOnCall } from '@shared/types';
import type { Vault } from '../services/vault';

/** Every main-process service, for the IPC handlers. */
export interface AppContext {
  boot: BootState;
  /**
   * Accounts side by side (Connection & Startup, WP1): the legacy server step (`auth:setServer`) goes through them —
   * connect and confirm. Set by `installAccounts`; absent, the session's own server step runs as before.
   */
  accounts?: { setServer: (url: string) => Promise<AuthState>; forgetServer: () => AuthState };
  db: Database;
  vault: () => Vault;
  secrets: SecureStore;
  salonDesk: SalonDesk;
  salonPrint: SalonPrint;
  salonSync: SalonSync;
  /** eLearning's courses kept offline: encrypted copies, played inside the app (elearning-offline.ts). */
  elearning: ElearningOffline;
  /** WorkSuite Events' desk: this computer as a check-in device, its key, offline copy and queue (event-desk.ts), and its badge printer. */
  eventDesk: EventDesk;
  eventDeskPrint: EventDeskPrint;
  /** Office documents: the editor views in tabs (office-editor.ts) and copies opened in other apps (office-external.ts). */
  office: OfficeEditorHost;
  officeLocal: OfficeExternal;
  /** WorkSuite Office, the desktop editor (#322). */
  officeApp: OfficeApp;
  /** Office files on this computer opened in WorkSuite DOC / Sheet / Slides tabs (office-local.ts). */
  officeFiles: OfficeLocalFiles;
  /** The image editor's offline edits, library cache and drag-out (Drive ENH-03). */
  imageLocal: ImageLocal;
  settings: SettingsService;
  http: HttpClient;
  auth: AuthService;
  device: DeviceService;
  bootstrap: BootstrapService;
  session: SessionController;
  realtime: RealtimeService;
  notifications: NotificationService;
  /** New-mail alerts (ENH-MAIL-05): native, in-app, the tray's mail lines, the pause and the badge's mail. */
  mailAlerts: MailAlertService;
  cache: OfflineCache;
  /** "Download message bodies": Mail's bodies fetched ahead into the offline cache (#190). */
  mailBodies?: MailBodies;
  /** Mail's pictures and attachments kept on this computer (#163). */
  mailMedia?: MailMedia;
  queue: OfflineQueue;
  transfers: TransferManager;
  /** Meetings recorded on this computer (worksuite-desktop#68). */
  meetRecorder: MeetRecorder;
  /** Speech to text on this computer (worksuite-desktop#81). */
  speech: SpeechService;
  sync: DriveSync;
  supervisor: ServiceSupervisor;
  lock: LockService;
  lockPin: LockPin;
  updater: UpdaterService;
  diagnostics: DiagnosticsService;
  /** The remote-control checks (RC09), read by `rc:checks` and by the support bundle. */
  meetDiagnostics: MeetDiagnostics;
  audit: AuditService;
  windows: WindowManager;
  calls: CallService;
  screenShare: ScreenShare;
  /** The sharing bar over what is being shared (WS-MEET-ENH-01 D03). */
  shareBar: ShareBar;
  remoteControl: RemoteControlService;
  tray: TrayService;
  status: () => StatusSnapshot;
  setActiveCall: (active: boolean) => void;
  activeCall: () => boolean;
  /** What a restart would interrupt: transfers, queued changes, drafts, a call, meeting, share or remote control (#205). */
  updateBusy: () => BusyReport;
  /** A window answered `update:prepare` (its drafts and tabs are saved). */
  updatePrepared: (token: string) => void;
  /** Settings › Updates › Diagnostics. */
  updateDiagnostics: () => Promise<UpdateDiagnostics>;
  lastPasteGesture: (webContentsId: number) => number;
  flushNavigation: () => void;
  /** Opens a route in the main window the way a deep link or a notification does (or queues it until it can). */
  navigate: (req: NavigateRequest) => void;
  /** Website chats ringing on this computer (ENH-WCHAT-01). */
  webchat: WebchatRinger;
  /** The website voice call the main window is on, or none: the tray says so (ENH-WCHAT-05). */
  webchatOnCall: (call: WebchatOnCall | null) => void;
  /** The tray's ringing menu (R-06, UX-ALR-02): its height as it measured itself, and its plain items. */
  ringTray: { fit: (height: number) => void; act: (action: 'inbox' | 'settings' | 'quit' | 'close' | 'dashboard' | 'liveMap' | 'wall' | 'silence') => void };
  /** The Live map window, the Live dashboard and wall mode on a display (L-04, L-05; MAP-21, MAP-22, MAP-24). */
  liveDesk: { open: (to: 'map' | 'toggleMap' | 'dashboard' | 'wall' | 'wallSheet' | 'wallClose' | 'chat', id?: number) => void; info: () => LiveDeskInfo; wall: (choice: Omit<WallModePrefs, 'displayId'> & { displayId: number }) => void };
  /** Quick Ask over any app (AI Assistant). */
  quickAsk: QuickAsk;
  /** The assistant's rules here, confirming its proposals, files from this computer (DSK-2…7). */
  ai: AiService;
  /** `extraArgs` are passed to the new process only (e.g. `--ax-restarted` after Restart WorkSuite). */
  relaunch: (safeMode: boolean, extraArgs?: string[]) => void;
  quit: () => void;
  /** Clock in or out (FR-TRAY-01): the tray, the title bar and the HR page all go through this. */
  clockAttendance: (direction: 'in' | 'out', extra?: ClockExtra) => Promise<void>;
  /** Start or end a break, the same way. */
  attendanceBreak: (action: 'start' | 'end') => Promise<void>;
}
