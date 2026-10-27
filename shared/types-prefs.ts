import type { DarkColorProfile, AppearancePrefs } from './theme-profiles';
import type { LinkPrefs } from './link-prefs';
import type { MailPause } from './mail-alerts';
import type { MailMediaPrefs } from './mail-media';
import type { SupportNoticePrefs } from './support';
import type { Theme, Density, NotificationPrivacy, UpdateChannel } from './types';

/** The person's preferences, by area (Preferences, Drive, Meet, AI, website chat ringing and the Live wall). Re-exported by shared/types.ts (audit D-G13). */

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
  /** Spelling is checked as you type in every window (desktop settings `prefs.spellcheck`). Unset: on. */
  spellcheck?: boolean;
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
  /** Settings › Files › "Open Office files in", per kind (worksuite-desktop#322); unset kinds take DEFAULT_OFFICE_OPEN_PREFS (shared/office-open.ts). */
  officeOpen?: Partial<Record<'doc' | 'sheet' | 'slides', 'builtin' | 'worksuite-office' | 'ask' | 'system'>>;
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
  /** What a new-mail alert may show on this computer (ENH-MAIL-05 MNA-PRV-01); unset: the person's choice on the server, else Full. */
  mailAlertPreview?: 'full' | 'sender' | 'hidden';
  /** Mail sound (MNA-WIN-07): off makes new-mail alerts silent. Unset: on. */
  mailAlertSound?: boolean;
  /** Pause mail alerts (MNA-TRY-02), per person on this computer, by user id. */
  mailAlertPause?: Record<string, MailPause>;
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
  /** Show the workspace chooser at every start (screen 11, "Always show this at startup"). Unset: off. */
  chooserAlways?: boolean;
  /** How much this computer keeps cached for the account, MB; `auto` follows the policy's `offline_storage_max_mb`. Unset: auto. */
  desktopCacheLimitMb?: number | 'auto';
  /** Banners for accounts other than the open one. Unset: on. */
  otherAccountNotifications?: boolean;
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
