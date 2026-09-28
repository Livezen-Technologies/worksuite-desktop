/**
 * Types shared by the main process and the renderer. Everything crossing the
 * IPC boundary is described here and validated by the zod schemas in
 * shared/ipc/contract.ts.
 */

export type Platform = 'windows' | 'macos' | 'linux';
export type Arch = 'x64' | 'arm64';

export type NetworkStatus = 'ONLINE' | 'LIMITED' | 'RECONNECTING' | 'OFFLINE';
export type RealtimeState = 'connected' | 'connecting' | 'disabled' | 'down' | 'idle';

export type ServiceHealth = 'STARTING' | 'HEALTHY' | 'DEGRADED' | 'RESTARTING' | 'FAILED' | 'STOPPED';

export type DeviceTrust = 'TRUSTED' | 'STANDARD' | 'RESTRICTED' | 'REVOKED';
export type DeviceClassification = 'MANAGED' | 'PERSONAL' | 'UNKNOWN';

export type NotificationPrivacy = 'FULL' | 'SENDER_ONLY' | 'GENERIC';
export type UpdateChannel = 'stable' | 'beta' | 'dev' | 'org';
export type Theme = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

export type UpdateState =
  | 'IDLE'
  | 'CHECKING'
  | 'AVAILABLE'
  | 'DOWNLOADING'
  | 'VERIFIED'
  | 'STAGED'
  | 'INSTALLING'
  | 'DONE'
  | 'FAILED';

export type MutationState = 'PENDING' | 'SYNCING' | 'DONE' | 'CONFLICT' | 'FAILED';

/** Which server API family this server speaks (§8.1 vs the existing WorkSuite API). */
export type ServerApi = 'desktop-v1' | 'core';

export interface ServerInfo {
  origin: string;
  name: string;
  api: ServerApi;
  minimumVersion: string | null;
  /** Set by an enterprise build or MDM policy: the user may not change the server. */
  locked: boolean;
  /**
   * Passkey sign-in, when the server offers it: the page to open in the
   * browser and the endpoint that exchanges the code it sends back. Absent on
   * servers without the desktop API, and on server records saved before it.
   */
  passkey?: { url: string; exchange: string } | null;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  timezone: string | null;
  locale: string | null;
  organizationId: string | null;
  organizationName: string | null;
  timeFormat: string | null;
  weekStart: number | null;
}

export interface Organization {
  id: string;
  name: string;
  /** The person's role in it ("owner", "asset_manager", "super-admin"), when the server says. */
  role?: string | null;
}

/** §11.2 desktop policy keys, with the defaults applied. */
export interface DesktopPolicy {
  version: number;
  signed: boolean;
  desktop_access: 'allowed' | 'disabled' | 'managed_only';
  minimum_version: Partial<Record<Platform, string>>;
  update_channel: UpdateChannel;
  auto_update: 'enforced' | 'user_choice';
  forced_update_deadline_hours: number;
  file_sync: 'allowed' | 'managed_only' | 'disabled';
  offline_files: 'allowed' | 'managed_only' | 'disabled';
  sync_folder_policy: string;
  removable_media_sync: boolean;
  offline_storage: boolean;
  offline_storage_max_mb: number;
  clipboard_paste: boolean;
  external_file_open: 'allowed' | 'managed_only' | 'disabled';
  downloads: 'allowed' | 'managed_only' | 'disabled';
  screen_capture_share: 'allowed' | 'disabled';
  app_lock_max_minutes: number;
  notification_min_privacy: NotificationPrivacy;
  required_background_services: string[];
  personal_device_mode: 'full' | 'online_only' | 'blocked';
  wipe_on_revoke: 'tokens' | 'cache' | 'cache+offline_files';
  proxy: 'system' | 'manual' | 'pac';
  allow_offline: boolean;
  /** Meet remote control on this computer (WS-MEET-ENH-01 §E.8). The server decides; these say what to offer. */
  remote_control_host: 'allowed' | 'managed_only' | 'disabled';
  remote_control_controller: 'allowed' | 'disabled';
  remote_clipboard: 'off' | 'text_only' | 'text_and_files';
  remote_file_receive: 'allowed' | 'managed_only' | 'disabled';
  /** Stops control at once, whatever the controller is doing: `Ctrl+Alt+Shift+Esc`. Never injected. */
  remote_emergency_stop_chord: string;
  /** How long the controller waits after the person at this computer moves the mouse (RC-INP-04). */
  remote_local_priority_hold_ms: number;
}

export interface MonitoringPolicySummary {
  id: string;
  name: string;
  version: number;
}

export interface Bootstrap {
  source: ServerApi;
  user: UserSummary;
  organizations: Organization[];
  defaultOrganizationId: string | null;
  apps: string[] | '*' | null;
  serverApps: string[] | null;
  permissions: string[];
  entitlements: Record<string, boolean>;
  featureFlags: Record<string, boolean>;
  policy: DesktopPolicy;
  monitoringPolicy: MonitoringPolicySummary | null;
  minimumVersion: string | null;
  realtimeEndpoint: string | null;
  /** Media servers (LiveKit) calls and Meet connect to, as the server announced them. */
  mediaServers?: string[];
  cachedAt: string;
  /** True when the app started from the cached copy and has not revalidated yet. */
  offline: boolean;
}

export interface DeviceInfo {
  id: string | null;
  name: string;
  platform: Platform;
  arch: Arch;
  osVersion: string;
  appVersion: string;
  trust: DeviceTrust;
  classification: DeviceClassification;
  registeredAt: string | null;
  lastHeartbeatAt: string | null;
  secureStorage: SecureStorageStatus;
}

export interface SecureStorageStatus {
  available: boolean;
  backend: string;
  /** False when secrets live in memory only (no OS keyring). */
  persistent: boolean;
}

export type AuthStage =
  | 'no-server'
  | 'signed-out'
  | 'mfa'
  /** Waiting for a passkey sign-in in the browser to come back through worksuite://auth/callback. */
  | 'passkey'
  | 'registering'
  | 'bootstrapping'
  | 'ready'
  | 'expired'
  | 'blocked'
  | 'revoked';

export interface AuthState {
  stage: AuthStage;
  server: ServerInfo | null;
  user: UserSummary | null;
  /** Human message for blocked / revoked / expired stages. */
  message: string | null;
  /** First-run wizard still to be completed for this user on this device. */
  setupPending: boolean;
}

export interface Preferences {
  startWithOs: boolean;
  startMinimized: boolean;
  minimizeToTray: boolean;
  restoreTabs: boolean;
  theme: Theme;
  density: Density;
  hardwareAcceleration: boolean;
  notificationSounds: boolean;
  notificationPrivacy: NotificationPrivacy;
  notificationsEnabled: boolean;
  /** The count of what needs you (chat + notifications) on the app's icon: the Dock, the taskbar. */
  badgeCount: boolean;
  /** Per-module notification toggles; a missing key means enabled. */
  moduleNotifications: Record<string, boolean>;
  dndEnabled: boolean;
  dndFrom: string;
  dndTo: string;
  /** Minutes of inactivity before the app locks; 0 = never. */
  appLockMinutes: number;
  lockOnSystemLock: boolean;
  openFilesLocally: 'ask' | 'always' | 'never';
  downloadFolder: string;
  mailCacheDays: 7 | 30 | 90 | 0;
  tabSuspendMinutes: number;
  language: string;
  updateChannel: UpdateChannel;
  sidebarMode: 'expanded' | 'collapsed' | 'auto-hide';
  pinnedApps: string[];
  shortcuts: Record<string, string>;
  backgroundServices: { notifications: boolean; realtime: boolean };
}

export interface PreferenceLock {
  key: keyof Preferences;
  reason: string;
}

export interface NotificationItem {
  id: string;
  module: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
  actor: string | null;
}

export interface StatusSnapshot {
  network: NetworkStatus;
  realtime: RealtimeState;
  pendingChanges: number;
  unread: { mail: number; chat: number; notifications: number; tasks: number };
  notificationsPausedUntil: string | null;
  services: Record<string, ServiceHealth>;
  locked: boolean;
  safeMode: boolean;
}

export type TransferDirection = 'upload' | 'download';
export type TransferState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface Transfer {
  id: string;
  direction: TransferDirection;
  name: string;
  source: string;
  destination: string;
  bytes: number;
  total: number;
  state: TransferState;
  speed: number;
  error: string | null;
  createdAt: string;
}

export interface OfflineMutation {
  id: string;
  idempotencyKey: string;
  module: string;
  entity: string;
  entityId: string | null;
  label: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  state: MutationState;
  attempts: number;
  error: string | null;
  createdAt: string;
}

export interface Draft {
  id: string;
  module: string;
  context: string;
  content: unknown;
  updatedAt: string;
}

export interface UpdateStatus {
  state: UpdateState;
  channel: UpdateChannel;
  currentVersion: string;
  availableVersion: string | null;
  minimumVersion: string | null;
  required: boolean;
  critical: boolean;
  progress: number;
  error: string | null;
  lastCheckedAt: string | null;
  deadline: string | null;
  signatureVerified: boolean;
  notesUrl: string | null;
  installSupported: boolean;
  /** Why the build cannot install updates itself, when it cannot. */
  installBlockedReason: string | null;
}

export interface BusyReport {
  uploads: number;
  downloads: number;
  pendingMutations: number;
  drafts: number;
  activeCall: boolean;
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail: string;
  ms?: number;
}

export interface AppInfo {
  version: string;
  platform: Platform;
  arch: Arch;
  osVersion: string;
  electron: string;
  chrome: string;
  node: string;
  channel: UpdateChannel;
  safeMode: boolean;
  isPackaged: boolean;
  locale: string;
  restoredFromCrash: boolean;
}

export type WindowKind = 'main' | 'chat-mini' | 'timer' | 'record' | 'call' | 'video-call' | 'ring' | 'meet' | 'rc-consent' | 'rc-indicator' | 'rc-pointer';

/** Screens and windows offered for sharing (FR-COM-05), and whether the OS lets us capture them. */
export interface ScreenSources {
  permission: string;
  sources: Array<{ id: string; name: string; kind: 'screen' | 'window'; thumbnail: string | null }>;
}

export interface NavigateRequest {
  route: string;
  newWindow?: boolean;
  organizationId?: string | null;
  source: 'deep-link' | 'notification' | 'tray' | 'menu' | 'shortcut';
}

export interface ToastMessage {
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

/** A call or meeting this device is in, and the window it is in (the main window's "in a call" pill). */
export interface ActiveCall {
  windowId: number;
  kind: 'call' | 'meet';
  title: string;
  /** Epoch ms the window said it joined. */
  since: number;
}

/*
 * Drive sync (Phase 2; WorkSuite Drive FR-SYN-01…06, WF-15). A Drive folder
 * kept in step with a folder on this computer.
 */

/** Which way changes travel. The server's `sync_roots.mode` uses the same words. */
export type SyncMode = 'two_way' | 'upload_only' | 'download_only';

export type SyncFolderState = 'idle' | 'scanning' | 'syncing' | 'paused' | 'waiting' | 'error';

/** Something one pass could not do, and why — shown against the folder until a pass clears it. */
export interface SyncIssue {
  path: string;
  kind: 'skipped' | 'conflict' | 'error';
  message: string;
  /** When it happened (conflicts are shown for a day, whatever passes follow). */
  at?: string;
}

export interface SyncFolder {
  id: string;
  /** The Drive folder; null is the whole of My Drive. */
  folderId: number | null;
  folderName: string;
  /** Where it is on this computer (display only: the renderer never hands a path back). */
  localPath: string;
  mode: SyncMode;
  paused: boolean;
  state: SyncFolderState;
  /** What the pass under way still has to do. */
  pending: { up: number; down: number };
  /** What is on this computer and in step. */
  files: number;
  bytes: number;
  lastSyncAt: string | null;
  error: string | null;
  issues: SyncIssue[];
  /** Deletions held back until somebody confirms them (see DriveSync's deletion guard). */
  heldDeletions: { side: 'computer' | 'drive'; count: number } | null;
}

export interface SyncActivity {
  at: string;
  folderId: string;
  action: 'uploaded' | 'downloaded' | 'deleted-here' | 'deleted-in-drive' | 'moved' | 'conflict' | 'folder';
  path: string;
}

export interface SyncStatus {
  /** Policy and permission allow Drive sync on this computer. */
  available: boolean;
  /** Why not, in words for the person. */
  reason: string | null;
  state: 'off' | 'idle' | 'syncing' | 'paused' | 'offline' | 'error' | 'disconnected' | 'blocked';
  message: string | null;
  /** Every folder paused from this computer. */
  paused: boolean;
  folders: SyncFolder[];
  activity: SyncActivity[];
  lastSyncAt: string | null;
  /** Where a new folder goes unless the person chooses elsewhere. */
  defaultRoot: string;
  /** Changes whenever what is on this computer changes; per-file answers are cached on it. */
  revision: number;
  /** This computer's id among the sync devices (the server's), once it has said hello. */
  deviceId: number | null;
}

export type SyncItemState = 'synced' | 'pending' | 'online' | 'conflict' | 'skipped';

/** Per-item answers for the rows on screen (the SYNC column, and "On this Mac" in Details). */
export interface SyncLookup {
  files: Record<string, { state: SyncItemState; path: string | null }>;
  folders: Record<string, { state: SyncItemState; path: string | null; syncFolderId: string | null; root: boolean }>;
}

/** A sync device as `/api/sync/devices` lists it. */
export interface SyncDevice {
  id: number;
  name: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  status: 'active' | 'paused' | 'disconnected' | 'wipe_pending' | 'wiped' | string;
  storageUsed: number;
  fileCount: number;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  wipeOrderedAt: string | null;
}

/** The sync policy the server applies (`SyncEngine::policy`). */
export interface SyncPolicy {
  max_devices: number;
  max_file_bytes: number;
  upload_kbps: number;
  download_kbps: number;
  blocked_types: string[];
  ignored_patterns: string[];
  allow_offline: boolean;
  require_encryption: boolean;
  block_size: number;
}

// ── Meet remote control on this computer (WS-MEET-ENH-01) ─────────────────

/** Whether this computer can be controlled, and if not, why — in a sentence. */
export interface RemoteControlSupport {
  available: boolean;
  method: 'sendinput' | 'cgevent' | 'xdotool' | null;
  displayServer: 'win32' | 'quartz' | 'x11' | 'wayland';
  reason: string | null;
  /** macOS: Accessibility, which injecting needs. Elsewhere 'not_required'. */
  accessibility: 'granted' | 'denied' | 'not_required';
  /** The computer's policy lets it be controlled at all (the server still decides each time). */
  policyAllows: boolean;
}

export interface RemoteControlRequestView {
  id: number;
  sessionId: number;
  kind: 'request' | 'handover' | 'increase';
  requester: string;
  reason: string | null;
  expiresIn: number;
}

export interface RemoteControlSessionView {
  id: number;
  status: 'CONTROL_APPROVED' | 'CONTROL_ACTIVE' | 'CONTROL_PAUSED';
  controller: string;
  /** The controller's connection in the meeting: the meeting window relays messages from it alone. */
  controllerIdentity: string;
  capsLabel: string;
  pauseReason: string | null;
  /** Why control is paused, as the indicator says it. */
  pauseText: string | null;
  /** When control became active here (ms), for the indicator's clock. */
  since: number | null;
  expiresAt: string | null;
  /** Control is on but this computer is holding the controller back: the person here moved the mouse, or the shared window is not in front. */
  waiting: 'local' | 'window' | null;
  type: 'meeting' | 'support' | 'call';
}

export interface RemoteControlView {
  support: RemoteControlSupport;
  /** "Let people ask to control my screen" when sharing starts. */
  allowRequests: boolean;
  emergencyChord: string;
  /** False when another app holds the emergency chord; the indicator's Stop still works. */
  chordRegistered: boolean;
  share: { uuid: string; shareId: number; label: string; kind: 'screen' | 'window'; allowRequests: boolean; paused: boolean } | null;
  requests: RemoteControlRequestView[];
  session: RemoteControlSessionView | null;
  /** Files the controller offered this computer, waiting for an answer (RC06). */
  offers: RemoteControlOffer[];
  /** This computer may offer the controller files (the grant allows file transfer). */
  canSendFiles: boolean;
}

export interface RemoteControlOffer {
  id: number;
  sessionId: number;
  name: string;
  size: number;
  from: string;
  executable: boolean;
  scan: 'clean' | 'not_scanned' | 'infected';
}

/** What the consent window (RC03) shows for one request. */
export interface RemoteControlConsent {
  id: number;
  kind: 'request' | 'handover' | 'increase';
  requester: string;
  reason: string | null;
  expiresIn: number;
  share: string;
  /** For a handover: who has control now. */
  current: string | null;
  clipboard: 'off' | 'text' | 'text_files';
  fileTransfer: boolean;
  locked: boolean;
}
