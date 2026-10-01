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
  /** The server requires a profile picture and this account has none: the app asks for one first (#46). */
  pictureRequired?: boolean;
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
  /**
   * The AI assistant on this computer (WS-AI-SRS-001 DSK-7): Quick Ask's
   * shortcut, Insert into other apps, and files picked from this computer as
   * context. Each is also switched by the company's AI policy on the server;
   * the stricter of the two wins.
   */
  ai_quick_ask: boolean;
  ai_insert: boolean;
  ai_local_files: boolean;
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
  /**
   * App slugs the person may open only in self-service mode, because they
   * lack the full app — today `expenses`, for filing their own claims.
   * Empty when the server does not say (older servers).
   */
  selfService: string[];
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
  /** Website chat ringing on this computer (WS-WCHAT ENH-01 §14.3). */
  webchatRinging: WebchatRingPrefs;
  /** The AI Assistant on this computer (Settings › AI Assistant). */
  ai: AiPrefs;
}

/** The AI Assistant's desktop settings (AI Assistant — Web + Desktop UIs, Settings). */
export interface AiPrefs {
  /** Quick Ask over any app with the selected text. */
  quickAsk: boolean;
  /** Its shortcut, as an Electron accelerator from QUICK_ASK_SHORTCUTS. */
  shortcut: string;
  /** Offer Insert, which pastes into the app Quick Ask was opened over — only when clicked. */
  insert: boolean;
  /** Open the AI dock beside the tabs when WorkSuite starts. */
  dockAtStart: boolean;
  /** The language Translate goes to unless another is chosen. */
  language: string;
  /** How the assistant is reached: the header button and its drawer, a floating widget, or neither (the shortcut still opens it). */
  display: AiDisplay;
  /** A short sound when an answer arrives while the assistant is closed or minimised. */
  sound: boolean;
  /**
   * Settings › AI Assistant › Module Access (worksuite-desktop#51): what this person lets each assistant use, per
   * module. A module missing here follows the default (on, as far as the organization allows). It can only narrow
   * what the organization and the person's own permissions allow, never widen it.
   */
  moduleAccess: AiModuleAccessPrefs;
  /**
   * Allow online fallback (worksuite-desktop#53): when the model on this computer is missing, fails, or cannot do what
   * was asked, WorkSuite AI answers instead — the question and the context it needs are then sent to it.
   */
  onlineFallback: boolean;
}

/** The two assistants Module Access is set for: the server's, and the model on this computer. */
export const AI_ENGINES = ['worksuite', 'local'] as const;
export type AiEngine = (typeof AI_ENGINES)[number];

/** Read Data, and Create or Update Records (always previewed and confirmed). */
export interface AiModuleToggle {
  read: boolean;
  write: boolean;
}

export type AiModuleAccessPrefs = Record<AiEngine, Record<string, AiModuleToggle>>;

export const AI_DISPLAYS = ['drawer', 'widget', 'hidden'] as const;
export type AiDisplay = (typeof AI_DISPLAYS)[number];

/** The shortcuts Quick Ask may use: ones no system or common app claims. */
export const QUICK_ASK_SHORTCUTS = ['Alt+Space', 'Control+Alt+Space', 'CommandOrControl+Shift+Space'] as const;

/** Quick Ask handing its text to the main window: the AI dock, a new task, or search. */
export interface AiHandoff {
  /** `changes`: a card to review in the main window, the only place one is confirmed. */
  to: 'dock' | 'task' | 'search' | 'changes';
  text: string;
  result: string | null;
}

/**
 * What this computer may do with the assistant (WS-AI-SRS-001 DSK-7): the
 * stricter of the device policy and the company's AI policy on the server.
 */
export interface AiRules {
  /** The assistant is on for this person here. */
  enabled: boolean;
  quickAsk: boolean;
  insert: boolean;
  localFiles: boolean;
  /** Why something is off on this computer, in a sentence, when it is. */
  note: string | null;
}

/** A file picked on this computer, as the assistant will read it (DSK-6). */
export interface AiUpload {
  ref: string;
  name: string;
  /** Its words, sent for a day — or, a synced Drive file, its Drive id and nothing sent. */
  via: 'upload' | 'drive';
}

/** What Quick Ask was opened with (the selection, read once, when the shortcut was pressed). */
export interface QuickAskContext {
  text: string;
  /** Where the text came from: the selection, what was copied last (no way to read the selection here), or nothing. */
  source: 'selection' | 'clipboard' | 'none';
  /** The app it was opened over, when the system says. */
  app: string | null;
  /** Insert can paste back into that app. */
  canInsert: boolean;
  /** Why the selection could not be read, in a sentence, when it could not. */
  note: string | null;
}

/** How website chats ring here (Settings › Notifications › Website chats; RING-UI-08). */
export interface WebchatRingPrefs {
  /** The call window over other apps; off leaves the bar in the main window and the tray. */
  window: boolean;
  /** During Do not disturb: the window without the tone (default), the tone only at risk, or as usual (RING-47). */
  duringDnd: 'card' | 'at_risk' | 'ring';
  /** Ctrl/Cmd+Shift+J joins the top ringing chat, registered only while one rings (RING-46). */
  shortcut: boolean;
  /** Ringtone volume, 0–100. */
  volume: number;
}

/**
 * A website chat ringing for this person (ENH-WCHAT-01): who, where, and how
 * long, from the server's own pending list and events — never from opening
 * the conversation, which would join it.
 */
export interface WebchatRingChat {
  id: number;
  visitor: string;
  site: string | null;
  /** The page they are reading (its title, or its address). */
  page: string | null;
  /** City and country, when known. */
  place: string | null;
  device: string | null;
  returning: boolean;
  /** What they wrote, when an event said. */
  preview: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent' | 'vip';
  /** Started while nobody was answering: a card, not a continuous ring (RING-08, "once"). */
  offline: boolean;
  /** Waiting since, a server stamp (true UTC without a zone). */
  since: string;
  /** The escalation step that reached this person: first, priority, everyone, supervisor, released. */
  stage: string | null;
  atRisk: boolean;
  /** Assigned to me and not yet opened: I ring until I join (RING-05). */
  mine: boolean;
  /** Who assigned it, for a chat that is mine. */
  by: string | null;
  /** Silenced by me on this computer until it is at risk (RING-11, locally). */
  silenced: boolean;
}

export interface WebchatRingState {
  /** Ordered: at risk, assigned to me, then oldest waiting (RING-23). */
  chats: WebchatRingChat[];
  /** What the tone does now: off (none left unsilenced, Do not disturb, the organisation's cap), or which tone. */
  tone: 'off' | 'normal' | 'strong';
  volume: number;
  /** How a ring ended, said for a few seconds (RING-28). */
  outcome: { id: number; text: string; at: number } | null;
  /** Locked: the window says a chat is waiting, and nothing about who. */
  hidden: boolean;
  /** Ctrl/Cmd+Shift+J is registered now. */
  shortcut: boolean;
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

export type WindowKind = 'main' | 'chat-mini' | 'timer' | 'record' | 'call' | 'video-call' | 'ring' | 'meet' | 'rc-consent' | 'rc-indicator' | 'rc-pointer' | 'webchat-ring' | 'quick-ask';

/** Screens and windows offered for sharing (FR-COM-05), and whether the OS lets us capture them. */
export interface ScreenSources {
  /** The system's Screen Recording permission (macOS); 'granted' where the system has no such gate. */
  permission: string;
  sources: Array<{ id: string; name: string; kind: 'screen' | 'window'; thumbnail: string | null }>;
  /**
   * What came of asking (worksuite-desktop#70), so the picker says one true thing: `denied` — the permission is
   * off; `failed` — the system would not list anything (with `problem`, its words); `partial` — screens listed but
   * windows could not be (or the other way round); `ok`. Absent from an older main process.
   */
  state?: 'ok' | 'denied' | 'failed' | 'partial';
  problem?: string | null;
  /** macOS applies a changed Screen Recording permission only to a newly started app. */
  restartMayHelp?: boolean;
  platform?: string;
}

export interface NavigateRequest {
  route: string;
  newWindow?: boolean;
  organizationId?: string | null;
  source: 'deep-link' | 'notification' | 'tray' | 'menu' | 'shortcut' | 'dock' | 'file';
  /** A window docked back into the main window (source 'dock'), or a file the OS handed over (source 'file', a tab of its own): its title, and whether it goes beside the open tab. */
  title?: string;
  side?: boolean;
}

/**
 * A tab torn off into its own window (FR-NAV-05/07): what it shows and where
 * it is, so it comes back where it was at the next start.
 */
export interface DetachedWindow {
  route: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ToastMessage {
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

/** A call or meeting this device is in, and the window it is in (the main window's "in a call" pill). */
export interface ActiveCall {
  windowId: number;
  /** The call's or meeting's uuid, so a card can offer "Return to meeting". */
  uuid?: string;
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
  /**
   * macOS, access still off after System Settings was opened from WorkSuite (worksuite-desktop#47): the entry there
   * may be an earlier version's, or macOS needs WorkSuite reopened.
   */
  accessibilityHint?: 'restart' | null;
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

/**
 * SalonMate's front desk, as the server shapes it (`Desk::shape`). The fields
 * the desktop reads; the rest travels with it.
 */
export interface SalonDeskInfo {
  id: number;
  org_id: number;
  location_id: number;
  location: string | null;
  name: string;
  status: 'requested' | 'active' | 'revoked';
  device_id: string | null;
  register: { id: number; code: string; name: string; open: boolean; session_id: number | null; opened_at: string | null } | null;
  approved_at: string | null;
  revoked_at: string | null;
  [field: string]: unknown;
}

/** Which desk this computer is on the signed-in server. The key never leaves the main process. */
export interface SalonDeskPairing {
  desk_id: number;
  name: string;
}

/** What the pairing screen sends (D01). The device id and app version are added in the main process. */
export interface SalonDeskPairInput {
  location_id: number;
  name: string;
  pos_register_id?: number | null;
}

/** What a SalonMate receipt is printed on: an 80 mm or 58 mm roll, or A4. */
export type SalonPaper = '80mm' | '58mm' | 'a4';

/** This computer's printers for SalonMate, on one server (salon-print.ts). */
export interface SalonPrintSettings {
  receipt_printer: string | null;
  a4_printer: string | null;
  paper: '80mm' | '58mm';
  copies: number;
  /** Print the receipt as soon as a payment is taken. */
  auto_print: boolean;
  /** Straight to the printer, without the print dialog. */
  silent: boolean;
  /** 'printer': a drawer plugged into the receipt printer, opened by the ESC/POS pulse. */
  drawer: 'off' | 'printer';
  drawer_pin: 2 | 5;
}

export type SalonPrintPatch = Partial<SalonPrintSettings>;

/** What the front desk does while WorkSuite is out of reach (salon-outbox.ts). */
export type SalonOutboxKind = 'client.create' | 'visit.book' | 'visit.check_in';

export interface SalonOutboxCandidate {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface SalonOutboxItem {
  id: string;
  seq: number;
  /** The Idempotency-Key it is sent under; a new one only for a new attempt. */
  key: string;
  kind: SalonOutboxKind;
  /** C-<uuid> or V-<uuid>, for a client or booking made here. */
  local_id: string | null;
  payload: Record<string, unknown>;
  /** The local ids it names, until the server has them. */
  needs: string[];
  /** What the counter sees: "Walk-in: Amaya Senanayake". */
  label: string;
  detail: string | null;
  created_at: string;
  updated_at: string;
  state: 'waiting' | 'refused';
  attempts: number;
  message: string | null;
  next: { starts_at: string; label?: string; date?: string } | { candidates: SalonOutboxCandidate[] } | null;
  choices: string[];
}

export interface SalonOutboxInput {
  kind: SalonOutboxKind;
  local_id?: string | null;
  payload: Record<string, unknown>;
  label: string;
  detail?: string | null;
}

export type SalonOutboxAction =
  | { id: string; action: 'drop' | 'retry' | 'take_next' }
  | { id: string; action: 'time'; starts_at: string }
  | { id: string; action: 'client'; client_id: number }
  | { id: string; action: 'edit'; changes: Record<string, string | boolean | null> };

export interface SalonSyncStatus {
  desk_id: number | null;
  /** The day's copy on this computer, for this person. */
  copy: { refreshed_at: string; pulled_at: string; visits: number; clients: number } | null;
  waiting: number;
  refused: number;
  /** Items somebody else signed in here made, waiting for them. */
  others: number;
  /** Whether WorkSuite answered the desk's last call. */
  reachable: boolean;
  last_contact: string | null;
  last_sync: { at: string; accepted: number; refused: number; duplicates: number } | null;
  problem: string | null;
  can_write: boolean;
  why_not: string | null;
  can_keep_copy: boolean;
}

/** A client in the day's copy: seen in the last year, with the worst allergy on file. */
export interface SalonCopyClient {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  tier?: string | null;
  points?: number;
  reliability?: string | null;
  allergy?: { severity: string; substance: string } | null;
}

/** The day's copy, as the screens read it offline (clients are searched separately). */
export interface SalonCopy {
  desk_id: number;
  refreshed_at: string;
  pulled_at: string;
  timezone: string;
  location: { id: number; name: string; hours: Array<{ weekday: number | string; opens: string; closes: string }> };
  menu: unknown[];
  stylists: unknown[];
  visits: unknown[];
  settings: Record<string, unknown>;
  options: { may: Record<string, boolean>; currency?: string; company?: string; ack_severity?: string; locations?: unknown[] } | null;
  desk: SalonDeskInfo | null;
}

export interface SalonPrintOutcome {
  ok: boolean;
  printer: string | null;
  silent: boolean;
  message: string;
}
