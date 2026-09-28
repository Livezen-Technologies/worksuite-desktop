import type { QuickAsk } from '../services/quick-ask';
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
  relaunch: (safeMode: boolean) => void;
  quit: () => void;
  /** Clock in or out (FR-TRAY-01): the tray, the title bar and the HR page all go through this. */
  clockAttendance: (direction: 'in' | 'out', extra?: ClockExtra) => Promise<void>;
  /** Start or end a break, the same way. */
  attendanceBreak: (action: 'start' | 'end') => Promise<void>;
}
