import type { DiscoveredServer, CompatInfo } from './discovery';
import type { Tint } from './theme-profiles';
import type { AccountView, ServiceHealthState } from './accounts';
import type { CloudStatus, BrowserSignIn } from './cloud';
import type { ConnectionStats } from './connection';
import type { ItemLink, ItemSource } from './item-links';
import type { Preferences } from './types-prefs';

// The types by area, in shared/types-*.ts (audit D-G13): every import of shared/types keeps working.
export * from './types-prefs';
export * from './types-webchat';
export * from './types-updates';
export * from './types-sync';
export * from './types-remote-control';
export * from './types-salon';
export * from './types-media';

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
  /** Hosts whose links belong to this server (Connection & Startup); absent on records saved before. */
  linkHosts?: string[];
  /** The other services the discovery document names. */
  endpoints?: DiscoveredServer['endpoints'];
  /** The account this server record belongs to (`acc_…`). */
  accountId?: string;
  deployment?: DiscoveredServer['deployment'];
  /** How the server signs people in (its discovery): `oidc` or a `browserSignIn` means the browser, else the form. */
  authMode?: DiscoveredServer['authMode'];
  /** Core's AppHandoff browser sign-in (server-relative paths), when the server offers it. */
  browserSignIn?: DiscoveredServer['browserSignIn'];
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

/** Public, masked server licence details; absent on older servers and Cloud-only entitlements. */
export interface LicenseDetails {
  status: string | null;
  edition: string | null;
  keyMasked: string | null;
  expiresAt: string | null;
  lastValidatedAt: string | null;
  graceEndsAt: string | null;
  graceDays: number | null;
  maxActivations: number | null;
}

export interface Bootstrap {
  license?: LicenseDetails | null;
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
  /**
   * Server app slug → whether the server's WorkSuite licence includes it (GET /api/system/entitlements),
   * or the organisation plan's modules from /desktop/v1. Empty when the server does not say.
   */
  entitlements: Record<string, boolean>;
  /**
   * App slugs the server's licence locks (it enforces entitlements and does not include them): hidden
   * everywhere — sidebar, launcher, home, search, links, notifications. Absent on older servers.
   */
  lockedApps?: string[];
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

/** `no-server`: no active account (Connection & Startup). */
export type AuthStage =
  | 'no-server'
  | 'signed-out'
  | 'mfa'
  /** A new computer, for somebody without two-factor: the code emailed to them (worksuite-desktop#301). */
  | 'device-code'
  /** Waiting for a passkey sign-in in the browser to come back through worksuite://auth/callback. */
  | 'passkey'
  | 'registering'
  | 'bootstrapping'
  | 'ready'
  | 'expired'
  | 'blocked'
  | 'revoked'
  // Connection & Startup: a browser sign-in (screen 3), Cloud's email check and workspace setup (screens 4, 5), and
  // the account's version gates (screen 9) — per account, the other accounts keep working.
  | 'browser'
  | 'verify-email'
  | 'provisioning'
  | 'update-required'
  | 'server-too-old';

export type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'recaptcha';

/**
 * What stands between the sign-in form and the next attempt (worksuite-desktop#301), from the server's answer:
 * a CAPTCHA to solve first, a wait with its end, or a block. Counted and decided on the server; the app only says so.
 */
export type SignInGate =
  | {
      kind: 'captcha';
      email: string;
      provider: CaptchaProvider | null;
      /** Solved in the CAPTCHA window; the token waits in the main process for the next attempt. */
      solved: boolean;
      message: string;
    }
  | {
      kind: 'restricted';
      email: string;
      /** When sign-in opens again (epoch ms). */
      until: number;
      /** The whole wait, seconds, when the server said. */
      total: number | null;
      failures: number | null;
      /** Minutes the next failure would wait; 0 when it would block the account. */
      nextWait: number | null;
      blockAfter: number | null;
      message: string;
    }
  | {
      kind: 'blocked';
      email: string;
      reference: string | null;
      failures: number | null;
      blockedAt: string | null;
      lastPlace: string | null;
      lastBrowser: string | null;
      /** Whether the account's company lets people unblock themselves with an emailed link. */
      selfUnblock: boolean;
      linkHours: number | null;
      message: string;
    };

/** The emailed-code step for a new computer (worksuite-desktop#301). */
export interface DeviceCodeStep {
  /** `sa**li@example.com`. */
  emailHint: string;
  /** False when the server could not send the code (it says why in `message`). */
  sent: boolean;
  message: string | null;
  /** When the code (and this step) expires (epoch ms). */
  expiresAt: number;
  /** When another code may be asked for (epoch ms). */
  resendAt: number;
  /** Wrong codes left before this one is spent. */
  attemptsLeft: number;
}

export interface AuthState {
  stage: AuthStage;
  server: ServerInfo | null;
  user: UserSummary | null;
  /** Human message for blocked / revoked / expired stages. */
  message: string | null;
  /** First-run wizard still to be completed for this user on this device. */
  setupPending: boolean;
  /** A CAPTCHA, a wait or a block before the next sign-in attempt (worksuite-desktop#301). */
  gate?: SignInGate | null;
  /** The `device-code` stage's step. */
  deviceCode?: DeviceCodeStep | null;
  /** The `mfa` stage on a computer the account has not verified: the code verifies it too. */
  mfaNewDevice?: boolean;
  /** The active account (Connection & Startup); absent before accounts. */
  account?: AccountView | null;
  /** A Personal account's Cloud side: account state, provisioning, storage, entitlements. */
  cloud?: CloudStatus | null;
  /** The `browser` stage's sign-in in progress. */
  browser?: BrowserSignIn | null;
  /** The `update-required` / `server-too-old` stages' versions. */
  compat?: CompatInfo | null;
  /** Signed in, but the workspace is read-only (suspended, restricted, pending deletion). */
  readOnly?: CloudStatus['readOnly'];
  /** WorkSuite OS mode: the OS signs in (its credentials broker); there is no password sign-in in this app. */
  osManaged?: boolean;
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
  unread: {
    mail: number;
    chat: number;
    notifications: number;
    tasks: number;
    webchat?: number;
    ringing?: number;
    support?: number;
    supportNotices?: number;
    /** Unread in the inboxes included in All Accounts: the badge's mail (ENH-MAIL-05 MNA-TRY-03). */
    mailBadge?: number;
    /** Unread bell entries about new mail: counted once, as mail, on the badge. */
    mailNotices?: number;
    /** Orders waiting on an approval decision I may make (WS-OMS-SRS-001 FR-DSK-05, the server's Badge::pending). */
    salesApprovals?: number;
    /** Unread bell entries about those approvals: counted once, as the approval queue, on the badge. */
    salesNotices?: number;
    /** Purchase documents (orders, requests, returns, bills) waiting on my decision (SRS-PUR-001 G-21, `GET /api/purchase/approvals?mine=1`). */
    purchaseApprovals?: number;
    /** Unread bell entries about those: counted once, as Purchasing's queue, on the badge. */
    purchaseNotices?: number;
    /** Hosting & Domains (HDM-DSK-04): monitors down plus domains, certificates and servers expiring within 7 days. */
    hosting?: number;
  };
  /** Mail alerts are paused on this computer (MNA-TRY-02): the Mail footer says so. */
  mailAlertsPaused?: string | null;
  notificationsPausedUntil: string | null;
  /** Whether the operating system lets this app show notifications (false: banners are blocked there). */
  notificationsSupported?: boolean;
  services: Record<string, ServiceHealth>;
  locked: boolean;
  safeMode: boolean;
  /** Connection strength's measurements (worksuite-desktop#254): pings, reconnects and the API's median. */
  connection?: ConnectionStats;
  /** The active account's server, for the service banner (screen 16). */
  service?: ServiceHealthState;
  /** Unread in the accounts not open now, for the switcher's dot. */
  otherAccountsUnread?: number;
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
  /** `preview`: a voice message's recording on this computer, playable until the server's copy is in — also after a restart (#300). */
  chat?: { roomId: string; clientMessageId: string; caption?: string; voice?: boolean; durationMs?: number; waveform?: number[]; preview?: string };
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
  /**
   * Waiting in the queue because the connection is lost, or a metered connection is set to wait — or, for an upload
   * to a Personal account, because its storage is full (`quota`: it goes on by itself when there is room).
   */
  held?: 'connection' | 'metered' | 'quota' | null;
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
  /**
   * Whether the GPU is actually being used for this run (WS-MEET-ENH-01 D02's
   * pill), which is not the same as the preference: turning it off takes a
   * restart, so the preference can say one thing while this run does another.
   * Read from the boot configuration the run started with.
   */
  hardwareAcceleration: boolean;
}

export type WindowKind = 'main' | 'chat-mini' | 'timer' | 'agenda' | 'record' | 'call' | 'video-call' | 'ring' | 'meet' | 'phone' | 'rc-consent' | 'rc-indicator' | 'rc-pointer' | 'share-bar' | 'webchat-ring' | 'ring-tray' | 'quick-ask' | 'live-map' | 'wall' | 'wall-sheet' | 'support-quick' | 'support-ring' | 'support-wall' | 'slideshow' | 'presenter';

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

/**
 * Repair local mail data (offline:repairMail, worksuite-desktop#338): the database's own check, and what was done —
 * Mail's copy cleared to be downloaded again, or (the check failed) a rebuild on restart. The outbox of unsent mail
 * and the drafts are counted to show they were kept.
 */
export interface MailRepairResult {
  /** `ok`, or what the check found. */
  check: string;
  healthy: boolean;
  action: 'cleared' | 'restart';
  /** Mail's saved answers removed. */
  removed: number;
  kept: { outbox: number; drafts: number };
  /** Where the old database is kept; null when no copy could be made. */
  backup: string | null;
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
