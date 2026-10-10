import type { AppearancePrefs, DarkColorProfile, Tint } from './theme-profiles';
import type { ItemLink, ItemSource } from './item-links';
import type { LinkPrefs } from './link-prefs';
import type { MailMediaPrefs } from './mail-media';
import type { ConnectionStats } from './connection';
import type { SupportNoticePrefs } from './support';
/**
 * Types shared by the main process and the renderer. Everything crossing the
 * IPC boundary is described here and validated by the zod schemas in
 * shared/ipc/contract.ts.
 */

export type Platform = 'windows' | 'macos' | 'linux';
export type Arch = 'x64' | 'arm64';

export type NetworkStatus = 'ONLINE' | 'LIMITED' | 'RECONNECTING' | 'OFFLINE';
export type RealtimeState = 'connected' | 'connecting' | 'disabled' | 'down' | 'idle';

/**
 * How realtime reaches this computer (plan 2.7): the chat service's WebSocket (protocol v2), its SSE fallback, the
 * built-in service with the older gateway's socket (protocol v1) for live events, or the built-in service alone, polling.
 */
export type RealtimeTransport = 'websocket' | 'sse' | 'legacy' | 'polling';

export type ServiceHealth = 'STARTING' | 'HEALTHY' | 'DEGRADED' | 'RESTARTING' | 'FAILED' | 'STOPPED';

export type DeviceTrust = 'TRUSTED' | 'STANDARD' | 'RESTRICTED' | 'REVOKED';
export type DeviceClassification = 'MANAGED' | 'PERSONAL' | 'UNKNOWN';

export type NotificationPrivacy = 'FULL' | 'SENDER_ONLY' | 'GENERIC';

/** Whether the operating system shows WorkSuite's banners, as far as the app can tell (#114). `unknown`: the OS does not say. */
export interface NotificationPermission {
  state: 'unsupported' | 'blocked' | 'unknown';
  /** What to check, in the person's words. */
  detail: string;
  /** The system's own error for the last banner that failed to show (macOS, Windows). */
  failure: string | null;
}
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
  /** The channels people may pick while auto_update is user_choice (worksuite-desktop#205). Absent: all three. */
  allowed_update_channels?: UpdateChannel[];
  /** The channel a computer follows until its person picks one (user_choice); must be allowed, else Stable. */
  update_channel_default?: UpdateChannel;
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
  locked_answer_calls?: boolean;
  locked_show_caller_details?: boolean;
  locked_allow_chat?: boolean;
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
  /**
   * The app launcher's organization defaults (worksuite-desktop#201): the pinned apps (at most 8) and the order of the
   * grid, for everyone who has not chosen their own. Apps the person may not open are never shown, whatever is here.
   */
  launcher_pinned?: string[];
  launcher_order?: string[];
  /**
   * The organisation's colour profile (worksuite-desktop#234): its accent ('' or absent: none), how tinted the
   * backgrounds are, the background colour for `custom`, and whether everyone must use it. Unlocked, it is the
   * profile of everyone who has not picked their own.
   */
  appearance_accent?: string;
  appearance_tint?: Tint;
  appearance_tint_color?: string;
  appearance_locked?: boolean;
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
  /** Optional for compatibility with preferences saved before dark profiles existed. */
  darkColorProfile?: DarkColorProfile;
  /**
   * Colour profiles (worksuite-desktop#234): the mode (the same as `theme`), the Light and Dark profiles and up to
   * five custom ones. Absent in preferences saved before; read with `appearanceOf`.
   */
  appearance?: AppearancePrefs;
  density: Density;
  hardwareAcceleration: boolean;
  notificationSounds: boolean;
  notificationPrivacy: NotificationPrivacy;
  notificationsEnabled: boolean;
  /** The count of what needs you (chat + notifications) on the app's icon: the Dock, the taskbar. */
  badgeCount: boolean;
  /** The status bar's connection strength (worksuite-desktop#254); unset: shown. */
  statusConnectionStrength?: boolean;
  /** The response time in ms beside it; unset: shown. */
  statusResponseTime?: boolean;
  /** Per-module notification toggles; a missing key means enabled. */
  moduleNotifications: Record<string, boolean>;
  dndEnabled: boolean;
  dndFrom: string;
  dndTo: string;
  /** Minutes of inactivity while app locking is enabled; 0 = lock on loss of focus. */
  appLockMinutes: number;
  /** App locking is opt-in when no saved preference or enforced policy exists. */
  appLockEnabled?: boolean;
  lockOnSleep?: boolean;
  lockedChatNotifications?: boolean;
  lockedCallNotifications?: boolean;
  lockedNotificationSounds?: boolean;

  lockOnSystemLock: boolean;
  lockedAnswerCalls?: boolean;
  lockedShowCallerDetails?: boolean;
  lockedAllowChat?: boolean;
  /** While locked, a message banner may say who sent it (#114). Off by default; never more than `notificationPrivacy` shows. */
  lockedNotificationSender?: boolean;
  /** While locked, a message banner may show the message's text (#114). Off by default; never more than `notificationPrivacy` shows. */
  lockedNotificationPreview?: boolean;
  openFilesLocally: 'ask' | 'always' | 'never';
  downloadFolder: string;
  mailCacheDays: 7 | 30 | 90 | 0;
  /** Open mailto: links in WorkSuite: it registers as the system's mail app (Settings › Mail, D04). Off until the person turns it on. */
  mailtoHandler?: boolean;
  /** Settings › Desktop › Links (#170); unset fields take DEFAULT_LINK_PREFS (shared/link-prefs.ts). */
  links?: Partial<LinkPrefs>;
  /** Per mailbox, how long its mail is kept on this computer (D09), overriding `mailCacheDays`. */
  mailCacheDaysByMailbox?: Record<string, 7 | 30 | 90 | 0>;
  /** Per folder ("<mailbox>:<folder>"), what this computer keeps (ENH-MAIL-03 DMO-OFF-01); unset folders follow the defaults. */
  mailFolderOffline?: Record<string, 'all' | 'recent' | 'headers' | 'online'>;
  /** High contrast lines, text and focus ring, chosen here rather than by the system (ENH-MAIL-03 DMO-ACC-01). */
  highContrast?: boolean;
  /** New-mail banners on this computer (ENH-MAIL-03 DMO-NTF-02): every message, Focused only, VIPs only, or none. */
  mailAlerts?: 'all' | 'focused' | 'vip' | 'none';
  /** VIP mail shows a banner during quiet hours (DMO-NTF-03). */
  mailVipBreakthrough?: boolean;
  /** Settings › Mail › Images & media on this computer: attachments downloaded ahead (#163). Unset fields take DEFAULT_MAIL_MEDIA. */
  mailMedia?: Partial<MailMediaPrefs>;
  tabSuspendMinutes: number;
  language: string;
  updateChannel: UpdateChannel;
  /** The person picked the channel themselves (else the organisation's default channel applies). */
  updateChannelChosen?: boolean;
  /** New versions download by themselves and wait for a restart (Settings › Desktop › Updates). Unset: on. An organization that enforces updates keeps it on. */
  autoUpdate?: boolean;
  /** A system notification when a new version is available or ready to install. Unset: on. */
  updateNotifications?: boolean;
  /** A downloaded update installs when WorkSuite quits (worksuite-desktop#205). Unset: on. */
  updateInstallOnQuit?: boolean;
  /** "What's New in X" once after updating (Settings › Updates). Unset: on. */
  updateShowWhatsNew?: boolean;
  /** A downloaded update installs while the computer is idle between 02:00 and 04:00. Unset: off. */
  updateInstallWhenIdle?: boolean;
  sidebarMode: 'expanded' | 'collapsed' | 'auto-hide';
  pinnedApps: string[];
  shortcuts: Record<string, string>;
  backgroundServices: { notifications: boolean; realtime: boolean };
  /** Website chat ringing on this computer (WS-WCHAT ENH-01 §14.3). */
  webchatRinging: WebchatRingPrefs;
  /** When a visitor writes again in a chat I have and I am away from it (worksuite-desktop#230). Unset: the defaults. */
  webchatFollowUps?: WebchatFollowUpPrefs;
  /** Support's banners on this computer (Notification settings › Support, D-03): the defaults until chosen. */
  supportNotices?: SupportNoticePrefs;
  /** Wall mode on a display (L-06, MAP-24): saved by its sheet. Unset: WALL_MODE_DEFAULTS. */
  wallMode?: WallModePrefs;
  /**
   * Settings › Chat › Chat drawer opens as (worksuite-desktop#264): docked beside the page, which makes room for it,
   * or floating over it. Unset: docked. A window too narrow to dock it floats it either way.
   */
  chatDrawer?: ChatDrawerMode;
  /** The AI Assistant on this computer (Settings › AI Assistant). */
  ai: AiPrefs;
  /** Meet › Recording (worksuite-desktop#68). */
  meetRecording: MeetRecordingPrefs;
  /** Settings › Meet › Behaviour (WS-MEET-ENH-01 D05). */
  meetBehaviour: MeetBehaviourPrefs;
  /** Drive › Settings: transfers, bandwidth and what this computer keeps (worksuite-desktop#95). */
  drive: DrivePrefs;
}

/** A bandwidth cap: off (Unlimited) or a number of KB/s or MB/s, kept as the person typed it. */
export interface BandwidthLimit {
  on: boolean;
  value: number;
  unit: 'KB' | 'MB';
}

/**
 * Drive › Settings (worksuite-desktop#95), saved on this computer only: how many files move at once, how fast,
 * what happens on a metered connection, where downloads go, what an upload does with a name already taken,
 * and which transfers say so when they end. They govern transfers this app makes; they never change the
 * account's storage or the server's file-size limits.
 */
export interface DrivePrefs {
  /** Files moving at once, uploads and downloads together (1–6). */
  maxConcurrent: number;
  /** At most this many of them uploads (null: no separate limit). */
  maxUploads: number | null;
  /** At most this many of them downloads (null: no separate limit). */
  maxDownloads: number | null;
  /** The combined speed of every upload at once. */
  uploadLimit: BandwidthLimit;
  /** The combined speed of every download at once. */
  downloadLimit: BandwidthLimit;
  /** A transfer cut off by the network or a busy server is tried again by itself, a few times. */
  autoRetry: boolean;
  /** When the connection comes back, transfers it interrupted carry on by themselves. */
  autoResume: boolean;
  /** On a metered connection: carry on as usual, one file at a time, or wait. */
  metered: 'normal' | 'limit' | 'pause';
  /** Device-local override for hotspots and connections with a data allowance. */
  meteredConnection?: boolean;
  /** Ask for a place and name for each download instead of using the download folder. */
  askWhereToSave: boolean;
  /** An upload whose name is already in the folder. */
  conflict: 'ask' | 'both' | 'skip' | 'replace';
  notifyComplete: boolean;
  notifyFailed: boolean;
}

/**
 * How a meeting behaves on this computer (Settings › Meet › Behaviour,
 * WS-MEET-ENH-01 D05).
 *
 * Three of the six switches that artboard draws are not here, because
 * WorkSuite already has them and two settings for one thing is how they come
 * to disagree: hardware acceleration is in General, and opening WorkSuite
 * links — meetings among them — in the app rather than the browser is in
 * Links.
 */
export interface MeetBehaviourPrefs {
  /** Shrink the call to a floating card when you switch to another app, and put it back when you return. */
  popOutOnSwitch: boolean;
  /** Whether mute, the camera and the three starting keys are held for the whole computer. */
  globalKeys: boolean;
  /** Include this computer's own sound when you present, unless the picker says otherwise for one share. */
  shareComputerSound: boolean;
  /** What the camera sends while this computer runs on its battery. */
  qualityOnBattery: 'auto' | '720p' | '360p';
}

/**
 * How meetings are recorded from this computer (Settings › Meet › Recording, worksuite-desktop#68).
 *
 * `cloud`: the WorkSuite media server records the room. `local`: this computer records what the meeting shows and
 * sounds like, finishes the file here and uploads it to the host's Drive in the background. Either way the
 * recording goes to `folder` in the recorder's own Drive, shared with nobody by being made.
 */
export interface MeetRecordingPrefs {
  method: 'cloud' | 'local';
  quality: '720p' | '1080p';
  /** The room as a grid, the person speaking large, or a shared screen large. */
  layout: 'grid' | 'speaker' | 'screen';
  /** The Drive folder (one level, in the recorder's Drive). */
  folder: string;
  /** Where a local recording is written: chosen with a dialog in the main process, never typed by a page. */
  localFolder: string;
  /** The local copy once the upload is verified: kept, deleted at once, or deleted after 7 or 30 days. */
  keepLocal: 'keep' | 'delete' | '7' | '30';
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
  /**
   * Auto-minimize after sending (worksuite-desktop#110): the floating widget goes down to its launcher once a question
   * is sent; the answer carries on, and the launcher says when it is ready.
   */
  autoMinimize: boolean;
  /**
   * Auto-minimize when I continue working (worksuite-desktop#126): while a question is on its way, switching tabs,
   * opening another module or clicking the workspace outside the assistant puts it down to its floating button; the
   * answer carries on, and the button says when it is ready. Never while the person is using the assistant itself.
   */
  autoMinimizeWhenWorking: boolean;
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

/** How the chat drawer opens (worksuite-desktop#264): beside the page, which makes room, or over it. */
export type ChatDrawerMode = 'docked' | 'floating';

/** The shortcuts Quick Ask may use: ones no system or common app claims. */
export const QUICK_ASK_SHORTCUTS = ['Alt+Space', 'Control+Alt+Space', 'CommandOrControl+Shift+Space'] as const;

/** Quick Ask handing its text to the main window: the AI dock, a new task, or search. */
export interface AiHandoff {
  /** `changes`: a card to review in the main window, the only place one is confirmed. `ask`: the conversation, from an answer's banner (#126). */
  to: 'dock' | 'task' | 'search' | 'changes' | 'ask';
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
  /**
   * Where the ring plays (RING-42, RING-UI-08 "Ring on"): the system's output and the computer's own speakers when the
   * output is a headset (default), or the system's output only. Unset: both.
   */
  ringOn?: 'both' | 'default';
  /** ⌘⇧M (Live map) and ⌘⇧D (Live dashboard) from other apps (MAP-21, MAP-22). Unset: on. */
  liveShortcuts?: boolean;
}

/**
 * A visitor writing again in a chat I have while I am away from it (worksuite-desktop#230): how it gets my attention.
 * Do not disturb (quiet hours) silences the chime as it does every sound.
 */
export interface WebchatFollowUpPrefs {
  /** The card over other apps, with the visitor's words, a reply box, Open chat and Snooze. */
  card: boolean;
  /** A system notification, with Reply, while WorkSuite is not in front. */
  desktop: boolean;
  /** A short chime, unlike the new-chat ring. */
  sound: boolean;
  /** Minutes without keyboard or mouse in the conversation before I count as away from it. */
  idleMinutes: 1 | 2 | 5 | 10;
}

/** One screen as the Wall mode sheet shows it (L-06, MAP-UI-06). */
export interface WallDisplay {
  id: number;
  /** "Display 2": its place in the system's list. */
  display: string;
  /** "Built-in · this window", or the screen's own name ("LG UltraFine 27″"), or "External". */
  detail: string;
}

/**
 * Wall mode on a display (L-06; MAP-24, MAP-UI-06), as the sheet saves it on this computer. Names are always hidden on
 * the wall, so there is no choice for it.
 */
export interface WallModePrefs {
  /** The screen picked; null, or one no longer connected: the first that is not the main one. */
  displayId: number | null;
  /** Keep the display awake while the wall is up. */
  keepAwake: boolean;
  /** Cycle the map World → region → home country every 60 s. */
  cycle: boolean;
  /** Open wall mode when WorkSuite starts (a dedicated support-room screen). */
  openAtStart: boolean;
}

export const WALL_MODE_DEFAULTS: WallModePrefs = { displayId: null, keepAwake: true, cycle: true, openAtStart: false };

export const FOLLOW_UP_DEFAULTS: WebchatFollowUpPrefs = { card: true, desktop: true, sound: true, idleMinutes: 2 };

/**
 * A visitor wrote again in a chat I have, or am in, and nobody has answered (worksuite-desktop#230): from the
 * `chat.widget.message` and `chat.widget.followup` events. Several messages make one entry.
 */
export interface WebchatFollowUp {
  /** The conversation. */
  id: number;
  visitor: string;
  site: string | null;
  /** The visitor's latest message and the one or two before it (theirs or ours), oldest first. */
  recent: Array<{ from: 'visitor' | 'agent'; body: string; at: string | null }>;
  /** Since when the visitor has waited for an answer. */
  since: string;
  /** New messages from the visitor since the card came up. */
  count: number;
  /** replied: the visitor wrote; reminder: still no answer; team: the team was alerted (Take over is offered). */
  stage: 'replied' | 'reminder' | 'team';
  /** The chat is mine (assigned to me), rather than one the team was alerted about. */
  mine: boolean;
  /** Who has it, when that is not me. */
  agent: string | null;
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
  /** Silenced by me until it is at risk: on all my devices where the server keeps ring sessions, else on this computer (RING-11). */
  silenced: boolean;
  /** A chat given to me that I have not joined passes on to the next available agent at this server stamp (RING-05, RING-12). */
  handoverAt?: string | null;
  /** How many times the visitor has visited, for "3rd visit" (R-01); null where the server does not say. */
  visits?: number | null;
  /** How many colleagues it rings for besides me, for "2 others ringing" (R-01); null where the server does not say. */
  othersRinging?: number | null;
  /**
   * A returning visitor (worksuite-desktop#291): their closed chat reopened when they wrote again, or a new one on the
   * same profile, and who had the last one when. Absent for a first chat, and from a server without it.
   */
  returnVisit?: WebchatReturnVisit | null;
}

/**
 * A visitor back after a closed chat (worksuite-desktop#291), as the ring says it: "Returning visitor · last chat with
 * you on 16 Aug". The server routes it to the agent of the last chat first, then the team.
 */
export interface WebchatReturnVisit {
  /** The closed conversation was reopened; false: a new one, linked to the last. */
  reopened: boolean;
  /** When the last chat was, a server stamp; null where it is not known. */
  previousAt: string | null;
  previousAgentId: number | null;
  previousAgentName: string | null;
  previousConversationId: number | null;
  /** The last chat was with me, as the ringer knows who I am. */
  withYou?: boolean;
}

/**
 * A colleague asks me into a website chat (WS-WCHAT ENH-WCHAT-03): an invitation to join it, or a transfer of it to
 * me — warm (they keep it until I accept) or handed over now. It rings like a chat until I answer it, it is cancelled,
 * or `expiresAt` passes (TEAM-23, TEAM-41).
 */
export interface WebchatHandoff {
  id: number;
  conversationId: number;
  kind: 'invite' | 'transfer';
  mode: 'warm' | 'cold';
  visitor: string;
  site: string | null;
  page: string | null;
  /** Who asks; null when WorkSuite sends it (a transfer nobody took, back to everybody). */
  from: string | null;
  /** The department it rings, when it was sent to one. */
  department: string | null;
  /** The next available agent, or everybody covering the website. */
  toAny: boolean;
  /** The note for staff, shown on the card (TEAM-22, TEAM-43). */
  note: string | null;
  /** Server stamp; null rings until somebody takes it. */
  expiresAt: string | null;
  createdAt: string | null;
  /**
   * When it runs out by this computer's clock (ms), from the server's own count of seconds left (C-09): the INVITATION
   * and TRANSFER TO YOU countdowns run true on a computer whose clock is off. Absent from an older server.
   */
  endsAt?: number | null;
  /** A voice call is on in the chat (V-03, WF-V3): joining the chat joins the call too, and the card says so. */
  onCall?: boolean;
}

/** A visitor's voice call ringing for me (WS-WCHAT ENH-WCHAT-05, VOICE-10). */
export interface WebchatCall {
  /** The call's id. */
  id: number;
  conversationId: number;
  visitor: string;
  site: string | null;
  page: string | null;
  place: string | null;
  /** The visitor's latest words, for context. */
  preview: string | null;
  /** Who owns the chat, if anybody. */
  owner: string | null;
  /** Rung as one of the chat's people, or as one of everybody who takes calls. */
  stage: 'first' | 'everyone';
  /** Server stamp. */
  requestedAt: string | null;
  /** What the visitor gave before calling, or the chat already knew (UX-WGT-10); absent on an older server. */
  email?: string | null;
  phone?: string | null;
}

/** The microphone a visitor's call would use on this computer, as the main window found it (V-04, VOICE-11, VOICE-14). */
export interface WebchatMic {
  /** This computer has a microphone at all: without one it is not rung, and cannot answer. */
  ready: boolean;
  /** The device's name ("Jabra Evolve2"), once the system names it; null before the microphone was ever allowed. */
  label: string | null;
  /** The microphone has a speaker of its own — a headset — so the call is heard through it. */
  headset: boolean;
}

/** The website call this computer is on, as the tray says it (VOICE-UI-03). */
export interface WebchatOnCall {
  conversationId: number;
  visitor: string;
  /** Epoch ms it was answered. */
  since: number;
  held: boolean;
}

export interface WebchatRingState {
  /** Ordered: at risk, assigned to me, then oldest waiting (RING-23). */
  chats: WebchatRingChat[];
  /** Invitations and transfers waiting for me, oldest first (TEAM-23). */
  handoffs?: WebchatHandoff[];
  /** Visitors' voice calls ringing for me, oldest first: shown before everything else (VOICE-10). */
  calls?: WebchatCall[];
  /** Ctrl/Cmd+Shift+A answers the top call now. */
  answerShortcut?: boolean;
  /** The microphone a call would use (V-04 device line); null until the main window has looked. */
  mic?: WebchatMic | null;
  /** What the tone does now: off (none left unsilenced, Do not disturb, the organisation's cap), or which tone. */
  tone: 'off' | 'normal' | 'strong';
  volume: number;
  /** My ringtone, kept on the server with my other ringing settings so every device sounds the same (RING-29). */
  ringtone?: string;
  /** Where the ring plays (RING-42): with a headset on, the speakers too, unless I chose the system's output only. */
  ringOn?: 'both' | 'default';
  /** How a ring ended, said for a few seconds (RING-28); `kind` and the rest draw it as R-03 does. */
  outcome: WebchatRingOutcome | null;
  /**
   * The chat I just joined, and how many colleagues its ring stopped for (R-03 "You joined the chat · ringing stopped
   * for 2 colleagues"); null where the count is not known.
   */
  youJoined?: { id: number; colleagues: number | null } | null;
  /** Locked: the window says a chat is waiting, and nothing about who. */
  hidden: boolean;
  /** Ctrl/Cmd+Shift+J is registered now. */
  shortcut: boolean;
  /** Another of my devices plays the ring — the browser I chose, say — so this computer shows it without sound (RING-10). */
  elsewhere?: boolean;
  /** Whether the server has this computer play my ring (RING-10, RING-49); null where it does not choose. */
  ringHere?: boolean | null;
  /** The chat I just joined from the card (worksuite-desktop#225): the card is a mini chat on it until I open the full chat or minimise it. */
  joined?: WebchatJoined | null;
  /** The card is minimised while these chats ring; a new one brings it back. The tone goes on. */
  minimised?: boolean;
  /** The card's own height, as it measured itself: the window fits it, so there is no empty space under it. */
  fit?: number | null;
  /** Visitors who wrote again in my chats while I was away from them, longest waiting first (worksuite-desktop#230). */
  followUps?: WebchatFollowUp[];
  /** Goes up by one each time the "visitor replied" chime should play once. */
  chime?: number;
  /** Whether the follow-up card shows over other apps (Settings › Website chats). */
  followUpCard?: boolean;
  /**
   * What I have typed to each ringing visitor, by conversation (R-05, R-06; UX-ALR-04): the call window and the tray's
   * menu share it, and it is kept if a colleague joins first. Empty behind the lock.
   */
  drafts?: Record<number, string>;
}

/**
 * What the tray's mini-dashboard and the Live map window need from this computer (L-04, L-05; MAP-21, MAP-22, MAP-24).
 */
export interface LiveDeskInfo {
  /**
   * Where "Wall mode on Display 2" opens: the display in words ("Display 2") and the screen's own name ("LG 27″") when
   * the system says it. The first screen that is not the main one; the main one when there is only one.
   */
  wall: { display: string; name: string | null } | null;
  /**
   * The screens the Wall mode sheet offers (L-06, MAP-UI-06 "SHOW ON"), in the system's order: "Display 1" and what it
   * is — "Built-in · this window", or the screen's own name ("LG UltraFine 27″"). Optional for an older main process.
   */
  displays?: WallDisplay[];
  /** The sheet's choices as last saved (MAP-24): the screen, keep awake, cycle the map, open when WorkSuite starts. */
  wallPrefs?: WallModePrefs;
  /** Wall mode is up on a screen now: the tray's item closes it (MAP-24 "Esc or the tray menu closes it"). */
  wallOpen?: boolean;
  /** When the wall's screen was unplugged and its window closed (MAP-24 "the tray says so"); null once opened again. */
  wallGone?: string | null;
  /** "Silence for 15 minutes" from the tray: until this ISO time; null when not silenced. */
  silencedUntil: string | null;
  /** ⌘⇧M and ⌘⇧D answer from other apps (registered while WorkSuite is not in front). */
  shortcuts: boolean;
}

/**
 * How a ring ended, as the call window tells it (R-03, RING-UI-03; RING-02, RING-03, RING-28). `text` is the whole
 * thing in plain words (the tray, a screen reader, an older window); `kind` and the rest are what the card draws:
 *
 * - `joined`: a colleague (`by`) joined the chat with `visitor` — a toast with View;
 * - `late`: I pressed Join a moment late — `by` already has it;
 * - `visitor_left`: the visitor left the site before anyone joined — in Missed chats when `missed`, with the `email`
 *   they left, Open in Missed and Dismiss;
 * - `visitor_ended`: the visitor ended the chat;
 * - `note`: anything else (closed, blocked, a pass, a call or an invitation resolving, an error).
 */
export interface WebchatRingOutcome {
  id: number;
  text: string;
  at: number;
  kind?: 'joined' | 'late' | 'visitor_left' | 'visitor_ended' | 'note';
  visitor?: string | null;
  by?: string | null;
  email?: string | null;
  missed?: boolean;
  /**
   * What I had typed to the visitor when a colleague got there first (R-05, UX-ALR-04): kept, never sent unless I
   * choose "Send to the chat" — then it goes as a participant's reply (TEAM-02). Absent behind the lock.
   */
  draft?: string | null;
}

/** A chat joined from the ringing card, shown there as a mini chat (worksuite-desktop#225). */
export interface WebchatJoined {
  conversationId: number;
  visitor: string;
  site: string | null;
  place: string | null;
  device: string | null;
  page: string | null;
  /** What the visitor wrote, as the card showed it. */
  preview: string | null;
  since: string;
  /** What I have sent from the card, oldest first. */
  sent: string[];
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
  internetOnline?: boolean;
  realtimeDiagnostics?: { attempt: number; lastDisconnect: string | null };
  network: NetworkStatus;
  realtime: RealtimeState;
  pendingChanges: number;
  /** `webchat`: visitors who wrote again in my website chats while I was away from them (worksuite-desktop#230), on the badge. */
  /** `ringing`: website chats and visitors' calls ringing for me and not silenced (R-05, R-06; RING-44), on the badge too. */
  /**
   * `support`: my live support tickets with something unread (the desk's `GET badges`); `supportNotices`: the unread
   * notifications about support tickets, which the badge leaves to `support` so a ticket counts once.
   */
  unread: { mail: number; chat: number; notifications: number; tasks: number; webchat?: number; ringing?: number; support?: number; supportNotices?: number };
  notificationsPausedUntil: string | null;
  /** Whether the operating system lets this app show notifications (false: banners are blocked there). */
  notificationsSupported?: boolean;
  services: Record<string, ServiceHealth>;
  locked: boolean;
  safeMode: boolean;
  /** Connection strength's measurements (worksuite-desktop#254): pings, reconnects and the API's median. */
  connection?: ConnectionStats;
}

export type TransferDirection = 'upload' | 'download';
export type TransferState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface Transfer {
  /** Drive file identity for associating downloads without matching display names. */
  fileId?: string | null;
  id: string;
  direction: TransferDirection;
  name: string;
  source: string;
  destination: string;
  bytes: number;
  total: number;
  state: TransferState;
  /** Chat upload lifecycle; completion means the attachment message was confirmed. */
  phase?: 'preparing' | 'uploading' | 'processing' | 'waiting' | 'sending';
  chat?: { roomId: string; clientMessageId: string; caption?: string; voice?: boolean; durationMs?: number; waveform?: number[] };
  speed: number;
  error: string | null;
  createdAt: string;
  /** While it waits for a free slot: its place in the queue, 1 being next. */
  position?: number | null;
  /** Waiting to be tried again after a temporary failure: when. */
  retryAt?: string | null;
  /** Times it has been tried again by itself after a temporary failure. */
  attempts?: number;
  /** While it runs: when bytes last moved, so one that has stopped moving can be told from one that is slow (worksuite-desktop#89). */
  movedAt?: string | null;
  /** Waiting in the queue because the connection is lost, or a metered connection is set to wait. */
  held?: 'connection' | 'metered' | null;
  /** A mail attachment's staged copy once its parts are in (worksuite-desktop#249): what Compose attaches. */
  attachment?: { token: string; name: string; size: number } | null;
  /** Where a tender's upload goes, so the tender's tabs show it as it moves — also after a restart (#249). */
  tender?: { tenderId: number; into: 'document' | 'line' | 'replace' | 'security'; id?: number; docKind?: string } | null;
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
  /** The channels this computer may follow (organisation policy), and why it may not choose, when it may not. */
  allowedChannels?: UpdateChannel[];
  channelLockReason?: string | null;
  /** "What's new" for the version on offer, from the Update Center's signed answer. */
  notes?: ReleaseNotes | null;
  /** A security fix (the Update Center's release type SECURITY or CRITICAL). */
  security?: boolean;
  /** The channel this computer was on is no longer allowed: it follows `to` now, without a downgrade. */
  channelFallback?: { from: UpdateChannel; to: UpdateChannel } | null;
  /** Later: when the reminder comes back (ISO), or 'next-launch'. */
  snoozedUntil?: string | null;
  /** How many times this version was put off. */
  postponed?: number;
  /** A critical update put off more than once installs when WorkSuite next starts. */
  installOnNextLaunch?: boolean;
  /** Moved to a more stable channel: this build is ahead of it until it catches up. */
  waitingForChannel?: { channel: UpdateChannel; version: string } | null;
  /** The offer is an older build, asked for with "Reinstall …" (a downgrade). */
  downgrade?: boolean;
  /** Updated and started: shown once as "Updated to X · What's new". */
  justUpdated?: { version: string; notesUrl: string | null } | null;
  /** The last update failed to start and the previous version came back (or could not). */
  rollback?: { failedVersion: string; restored: boolean; message: string } | null;
  /** Notifications wait while this is going on (a meeting, a call, a screen share, remote control). */
  quietReason?: string | null;
  /** What the Update Center's signed answer says about the version on offer (Settings › Updates, the update dialog). */
  release?: ReleaseInfo | null;
  /** The download in progress: bytes, speed, time left, paused, retrying after a network loss. */
  download?: DownloadProgress | null;
  /** Manifest signature → Download → SHA-256 → Code signature → Stage, each with where it stands. */
  pipeline?: PipelineStep[] | null;
  /** This version must be replaced: since when, by when, and whether modules are locked now. */
  mandatory?: MandatoryUpdate | null;
  /** The last update that failed: a code, the rollback state and a reference for support. */
  failure?: UpdateFailure | null;
  /** When the next scheduled check runs (ISO). */
  nextCheckAt?: string | null;
  /** "Restart when work finishes": WorkSuite restarts once nothing would be interrupted. */
  restartWhenFree?: boolean;
  /** A critical release installs after a short grace period (the release's `grace_minutes`, default 5). */
  immediate?: ImmediateUpdate | null;
  /** "What's New in X" after the restart, shown once: the highlights and the local database steps that ran. */
  justUpdatedNotes?: { highlights: string[]; summary: string | null; schema: { from: number; to: number } | null } | null;
}

export interface ReleaseInfo {
  buildNumber: number | null;
  /** When the release was published (ISO), when the Update Center says. */
  publishedAt: string | null;
  /** RECOMMENDED, OPTIONAL, SECURITY, CRITICAL … as the Update Center says. */
  releaseType: string | null;
  /** The Update Center's channel for the answer (stable, beta, dev). */
  channel: string | null;
  packageType: string | null;
  packageSize: number | null;
  /** The key that signed the answer (`key_id`). */
  keyId: string | null;
  /** Who signed the build, when the Update Center says. */
  publisher: string | null;
  securityFixes: number | null;
  knownIssues: string[];
}

export interface DownloadProgress {
  received: number;
  total: number;
  bytesPerSecond: number;
  /** Seconds left at the current speed, or null when unknown. */
  secondsLeft: number | null;
  paused: boolean;
  /** Lost the network and trying again (it resumes where it stopped). */
  retrying: boolean;
  /** The server accepts ranges: a pause or a lost connection carries on where it stopped. */
  resumable: boolean;
}

export type PipelineStepId = 'manifest' | 'download' | 'sha256' | 'codesign' | 'stage';
export interface PipelineStep {
  id: PipelineStepId;
  state: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  detail: string;
}

export interface MandatoryUpdate {
  /** Why: below the policy's minimum version, the release says required, or the server refused this version. */
  reason: 'minimum' | 'release' | 'server';
  /** The lowest version that is still allowed, when known. */
  requiredVersion: string | null;
  since: string;
  /** Install by (ISO): first required + the policy's `forced_update_deadline_hours`, or the release's own date. */
  deadline: string | null;
  /** The server refuses this version on business APIs (UPDATE_REQUIRED): modules lock now, whatever the deadline. */
  serverRejected: boolean;
  /** How many times it may be put off. */
  maxDeferrals: number;
}

export interface UpdateFailure {
  code: string;
  message: string;
  version: string | null;
  /** Rollback state: none needed, put back, could not put back, or not possible on this platform. */
  rollback: 'none' | 'ok' | 'failed' | 'not-possible';
  /** A short reference for support, also in the update history. */
  ref: string;
  at: string;
}

export interface ImmediateUpdate {
  version: string;
  graceMinutes: number;
  graceEndsAt: string;
  /** What was saved before the restart, once it has been. */
  saved: { flushed: boolean; drafts: number; pendingMutations: number } | null;
}

export interface ReleaseNotes {
  version: string;
  summary: string | null;
  highlights: string[];
  url: string | null;
}

/** What would be interrupted by a restart right now. */
export interface UpdateActivity {
  meeting: boolean;
  call: boolean;
  screenShare: boolean;
  remoteControl: boolean;
}

export interface BusyReport {
  uploads: number;
  downloads: number;
  pendingMutations: number;
  drafts: number;
  activeCall: boolean;
  /** A meeting, screen share or remote-control session (worksuite-desktop#205); absent from older callers. */
  activity?: UpdateActivity;
  /** What exactly is going on, for the Update Ready dialog; absent from older callers. */
  details?: BusyDetails;
}

export interface BusyDetails {
  /** Calls and meetings in progress, by their window's title. */
  calls: Array<{ kind: 'call' | 'meet'; title: string }>;
  /** Transfers still running: name, direction and how far along. */
  transfers: Array<{ name: string; direction: 'upload' | 'download'; percent: number }>;
  /** Saved drafts by module (mail, chat, notes …). */
  draftModules: Record<string, number>;
}

/** One check on Settings › Updates › Diagnostics. */
export interface UpdateDiagnosticCheck {
  id: 'service' | 'version' | 'channel' | 'signature' | 'download' | 'disk' | 'permissions' | 'database' | 'license';
  label: string;
  status: 'pass' | 'low' | 'fail' | 'skip';
  detail: string;
  /** A fix for this check in particular, when the generic one does not fit. */
  fix?: string;
}

export interface UpdateDiagnostics {
  ranAt: string;
  checks: UpdateDiagnosticCheck[];
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

export type WindowKind = 'main' | 'chat-mini' | 'timer' | 'record' | 'call' | 'video-call' | 'ring' | 'meet' | 'phone' | 'rc-consent' | 'rc-indicator' | 'rc-pointer' | 'share-bar' | 'webchat-ring' | 'ring-tray' | 'quick-ask' | 'live-map' | 'wall' | 'wall-sheet' | 'support-quick' | 'support-ring' | 'support-wall';

/** Screens and windows offered for sharing (FR-COM-05), and whether the OS lets us capture them. */
export interface ScreenSources {
  permissionStatus?: 'granted' | 'denied' | 'checking' | 'unknown' | 'not_required';
  permissionProblem?: string | null;
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
  /** Permission changed during this run, but capture remains unavailable; a restart may help. */
  restartMayHelp?: boolean;
  platform?: string;
}

export interface NavigateRequest {
  route: string;
  newWindow?: boolean;
  organizationId?: string | null;
  source: 'deep-link' | 'notification' | 'tray' | 'menu' | 'shortcut' | 'dock' | 'file' | 'window';
  /** A window docked back into the main window (source 'dock'), or a file the OS handed over (source 'file', a tab of its own): its title, and whether it goes beside the open tab. */
  title?: string;
  side?: boolean;
  /** A WorkSuite item link (#170): opened, org-switched, access-checked and its action confirmed by the main window. */
  item?: { link: ItemLink; source: ItemSource; app: string };
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

/** A sync conflict the server holds open (Drive ENH-03 DSK-03): both versions kept, one to be made current. */
export interface DriveConflict {
  id: number;
  fileId: number;
  fileName: string;
  copyFileId: number | null;
  copyName: string | null;
  deviceName: string | null;
  baseVersion: number;
  serverVersion: number;
  serverSize: number | null;
  localSize: number | null;
  serverUpdatedAt: string | null;
  createdAt: string | null;
}

/** A synced picture on this computer, for the image editor (ENH-03 DSK-02). */
export interface LocalImageInfo {
  synced: boolean;
  version: number | null;
  canUpload: boolean;
  paused: boolean;
  pending: { baseVersion: number; savedAt: string; state: 'waiting' | 'conflict' | 'recipe-pending'; copyName: string | null; willBe: number } | null;
}

/** An offline edit's progress, as the image editor hears it. */
export interface LocalImageEvent {
  fileId: number;
  state: 'uploaded' | 'conflict' | 'saved';
  version?: number;
  copyId?: number | null;
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

/** macOS: who the running WorkSuite is, to compare with its entry in Privacy & Security › Accessibility. */
export interface RemoteControlIdentity {
  executable: string;
  bundle: string;
  bundleId: string | null;
  teamId: string | null;
  authority: string | null;
  adhoc: boolean;
  translocated: boolean;
  otherInstalledCopy: boolean;
  development: boolean;
  signingUnavailable: boolean;
}

/** Whether this computer can be controlled, and if not, why — in a sentence. */
export interface RemoteControlSupport {
  available: boolean;
  method: 'sendinput' | 'cgevent' | 'xdotool' | null;
  displayServer: 'win32' | 'quartz' | 'x11' | 'wayland';
  reason: string | null;
  /** macOS: Accessibility, which injecting needs. Elsewhere 'not_required'. */
  accessibility: 'granted' | 'denied' | 'checking' | 'unknown' | 'not_required';
  /**
   * macOS: the running app reports access but its input helper reports denial.
   *  - restart: granted while WorkSuite was running; restarting WorkSuite (and so its helper) finishes it.
   *  - helper: a restart has already been tried; the helper is not being counted as WorkSuite's.
   */
  accessibilityHint?: 'restart' | 'helper' | null;
  accessibilityDetails?: {
    appTrusted: boolean | null;
    helperTrusted: boolean | null;
    helperAccessibility: boolean | null;
    problem: string | null;
    checkedAt: number | null;
    runningApp: string;
    /** The input helper's executable, and whether the last answer came from the running helper or a new one. */
    helperPath?: string;
    helperSource?: 'injector' | 'probe' | null;
    /** Signing and location of the running copy (worksuite-desktop#147); null until known. */
    identity?: RemoteControlIdentity | null;
  };
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
  /** The POS till it is paired as, when it is one (POS-01). */
  till?: { id: number; code: string; name: string; revoked: boolean } | null;
  /** Where its checkouts and retail take stock from (DSK-02). */
  warehouse?: { id: number; code: string | null; name: string } | null;
  /** The receipt layout it prints with — `salon_80` or `salon_short` (POS-08). */
  receipt_template?: string;
  receipt_template_name?: string;
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
  /** The stock location it takes from; none for the location's own. */
  warehouse_id?: number | null;
  /** The receipt layout it prints with; none for the salon receipt. */
  receipt_template?: string | null;
}

/** What a SalonMate receipt is printed on: an 80 mm or 58 mm roll, or a full page (A4, Letter). */
export type SalonPaper = '80mm' | '58mm' | 'a4' | 'letter';

/** This computer's printers for SalonMate, on one server (salon-print.ts). */
export interface SalonPrintSettings {
  receipt_printer: string | null;
  a4_printer: string | null;
  /** The receipt's paper (PRN-02): a roll, or a full page that goes to the A4 printer when there is one. */
  paper: SalonPaper;
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
export type SalonOutboxKind = 'client.create' | 'visit.book' | 'visit.check_in' | 'visit.checkout';

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

/** A meeting recorded on this computer, through its steps (worksuite-desktop#68). */
export type LocalRecordingState = 'starting' | 'recording' | 'processing' | 'uploading' | 'ready' | 'failed';

export interface LocalRecording {
  id: string;
  /** The meeting's uuid. */
  meeting: string;
  title: string;
  state: LocalRecordingState;
  /** What went wrong, in a sentence, with what to do. */
  error: string | null;
  /** The step Retry starts again from. */
  failedAt: 'recording' | 'processing' | 'uploading' | 'registering' | null;
  /** Written so far. */
  bytes: number;
  /** Uploaded so far, while uploading. */
  uploaded: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  /** The file's name in the local folder, while it is kept. */
  fileName: string | null;
  /** The copy in the recorder's Drive, once there and checked. */
  driveFileId: number | null;
  /** When the local copy will be deleted, when the retention setting says so. */
  deleteAfter: string | null;
  /** Recovered after WorkSuite closed while it was recording. */
  recovered: boolean;
  /** When it entered the step it is in (worksuite-desktop#89): a step that goes on far too long is said to be stuck. */
  stepAt?: string | null;
  /** Its upload in the transfer queue, while there is one: its progress, Pause, Resume and Cancel are the queue's. */
  transferId?: string | null;
  /**
   * Why its file cannot be used (worksuite-desktop#240): nothing was recorded because Screen Recording permission
   * was off, no video reached the file, or the file is not a whole video. Trying again cannot fix any of these, so it
   * is never offered Try again — only Delete, and Fix permission when that is the cause.
   */
  problem?: LocalRecordingProblem | null;
}

/** Why a recording made here cannot be used, when trying again would not help (worksuite-desktop#240). */
export type LocalRecordingProblem = 'screen-permission' | 'no-video' | 'unplayable';

/** Whether this computer lets WorkSuite record the screen (macOS Screen Recording); elsewhere there is no such gate. */
export type ScreenRecordingAccess = 'granted' | 'missing' | 'not_required';

/** What a piece of speech said, when, and whether it was unclear (worksuite-desktop#81). */
export interface SpeechSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  uncertain: boolean;
}

/** Whether this computer can transcribe on its own, and if not why. */
export interface SpeechStatus {
  local: { ready: boolean; model: { name: string; size: number } | null; why: string | null };
}

/** What Mail keeps on this computer (offline:mailStats; Settings › Mail, D04 and D09). */
export interface MailStoreStats {
  total: number;
  /** Opened messages and what is read beside them. */
  messages: number;
  /** Message lists, folders, labels and counts. */
  lists: number;
  search: number;
  other: number;
  /** Per mailbox id: messages kept to read offline, and their bytes. */
  byMailbox: Record<string, { messages: number; bytes: number }>;
  /** The organization's limit for everything this computer keeps offline (all apps). */
  limitBytes?: number;
  /**
   * "Download message bodies" (#190): per mailbox id, the bodies within the
   * offline window this computer has (`stored`) of those it wants
   * (`wanted`), and whether it is downloading them now.
   */
  bodies?: Record<string, MailBodiesProgress>;
}

/** One mailbox's body download on this computer (#190). */
export interface MailBodiesProgress {
  stored: number;
  wanted: number;
  running: boolean;
  /** ISO time of the last pass that finished. */
  doneAt: string | null;
  error: string | null;
}

/** What the system did with the test chat notification (Settings › Ringing, worksuite-desktop#251). */
export interface RingTestNotice {
  state: 'shown' | 'failed' | 'unknown' | 'unsupported' | 'off';
  detail: string | null;
}

/** One step of "Send a test chat notification" (worksuite-desktop#251): routed · received · notification shown · sound. */
export interface RingTestStep {
  id: 'routed' | 'received' | 'notification' | 'sound';
  label: string;
  state: 'ok' | 'warn' | 'fail' | 'pending';
  detail: string | null;
}
