import type { OfficeLocalFiles } from '../services/office-local';
import type { QuickAsk } from '../services/quick-ask';
import type { AiService } from '../services/ai';
import type { WebchatRinger } from '../services/webchat-ring';
import type { NavigateRequest } from '@shared/types';
import type { AuditService } from '../services/audit';
import type { AuthService } from '../services/auth';
import type { CallService } from '../services/calls';
import type { ScreenShare } from '../services/screen-share';
import type { RemoteControlService } from '../services/remote-control/service';
import type { BootstrapService } from '../services/bootstrap';
import type { Database } from '../services/db';
import type { DeviceService } from '../services/device';
import type { DiagnosticsService } from '../services/diagnostics';
import type { HttpClient } from '../services/http';
import type { LockService } from '../services/lock';
import type { LockPin } from '../services/lock-pin';
import type { NotificationService } from '../services/notifications';
import type { OfflineCache } from '../services/offline-cache';
import type { OfflineQueue } from '../services/offline-queue';
import type { SecureStore } from '../services/secure-store';
import type { SettingsService } from '../services/settings';
import type { ServiceSupervisor } from '../services/supervisor';
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
import type { StatusSnapshot } from '@shared/types';
import type { Vault } from '../services/vault';

/** Every main-process service, for the IPC handlers. */
export interface AppContext {
  boot: BootState;
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
  /** Office files on this computer opened in WorkSuite DOC / Sheet / Slides tabs (office-local.ts). */
  officeFiles: OfficeLocalFiles;
  settings: SettingsService;
  http: HttpClient;
  auth: AuthService;
  device: DeviceService;
  bootstrap: BootstrapService;
  session: SessionController;
  realtime: RealtimeService;
  notifications: NotificationService;
  cache: OfflineCache;
  queue: OfflineQueue;
  transfers: TransferManager;
  sync: DriveSync;
  supervisor: ServiceSupervisor;
  lock: LockService;
  lockPin: LockPin;
  updater: UpdaterService;
  diagnostics: DiagnosticsService;
  audit: AuditService;
  windows: WindowManager;
  calls: CallService;
  screenShare: ScreenShare;
  remoteControl: RemoteControlService;
  tray: TrayService;
  status: () => StatusSnapshot;
  setActiveCall: (active: boolean) => void;
  activeCall: () => boolean;
  lastPasteGesture: (webContentsId: number) => number;
  flushNavigation: () => void;
  /** Opens a route in the main window the way a deep link or a notification does (or queues it until it can). */
  navigate: (req: NavigateRequest) => void;
  /** Website chats ringing on this computer (ENH-WCHAT-01). */
  webchat: WebchatRinger;
  /** Quick Ask over any app (AI Assistant). */
  quickAsk: QuickAsk;
  /** The assistant's rules here, confirming its proposals, files from this computer (DSK-2…7). */
  ai: AiService;
  relaunch: (safeMode: boolean) => void;
  quit: () => void;
  /** Clock in or out (FR-TRAY-01): the tray, the title bar and the HR page all go through this. */
  clockAttendance: (direction: 'in' | 'out', extra?: ClockExtra) => Promise<void>;
  /** Start or end a break, the same way. */
  attendanceBreak: (action: 'start' | 'end') => Promise<void>;
}
