import { z } from 'zod';
import { DARK_PROFILE_IDS, MAX_CUSTOM_PROFILES } from '../theme-profiles';
import { MAX_CONCURRENT } from '../transfers';
import { MAX_OFFICE_LOCAL_BYTES } from '../office';

/**
 * The IPC contract's building blocks (shared/ipc/contract.ts): `ch`, the channel spec, and the schemas several
 * channels share. The channels themselves are in contract.ts and the contract-*.ts files beside it (audit D-G13).
 */

export const none = z.undefined().or(z.null()).optional();
export const salonPaper = z.enum(['80mm', '58mm', 'a4', 'letter']);
export const idString = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const route = z
  .string()
  .max(512)
  .regex(/^\/[A-Za-z0-9/_\-.:?=&%]*$/, 'route must be an app path');

export const tabRecordSchema = z.object({
  id: idString,
  route,
  title: z.string().max(200),
  pinned: z.boolean(),
  organizationId: z.string().max(64).nullable(),
  app: z.string().max(64),
});
export type TabRecord = z.infer<typeof tabRecordSchema>;

export const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const appearanceProfileId = z.string().regex(/^(purple|red|green|blue|orange|teal|gray|org|c-[a-z0-9]{4,16})$/);
const customProfileSchema = z.object({
  id: z.string().regex(/^c-[a-z0-9]{4,16}$/),
  name: z.string().max(40),
  accent: hexColour,
  tint: z.enum(['neutral', 'accent', 'custom']),
  tintColor: hexColour.nullable().optional(),
});

const supportNoticeChoice = z.object({ banner: z.boolean(), sound: z.boolean() });
const officeOpenChoice = z.enum(['builtin', 'worksuite-office', 'ask', 'system']);

const bandwidthLimitSchema = z.object({ on: z.boolean(), value: z.number().positive().max(1_000_000), unit: z.enum(['KB', 'MB']) });

export const preferencesPatchSchema = z
  .object({
    startWithOs: z.boolean(),
    startMinimized: z.boolean(),
    minimizeToTray: z.boolean(),
    restoreTabs: z.boolean(),
    theme: z.enum(['system', 'light', 'dark']),
    darkColorProfile: z.enum(DARK_PROFILE_IDS),
    // Colour profiles (worksuite-desktop#234). The mode is `theme`; a profile id is a built-in one, `org`, or one of
    // the custom ones (`c-…`), which the settings service checks against the list.
    appearance: z
      .object({
        mode: z.enum(['system', 'light', 'dark']),
        lightProfile: appearanceProfileId,
        darkProfile: appearanceProfileId,
        custom: z.array(customProfileSchema).max(MAX_CUSTOM_PROFILES),
        chosen: z.boolean(),
      })
      .partial(),
    density: z.enum(['comfortable', 'compact']),
    hardwareAcceleration: z.boolean(),
    spellcheck: z.boolean(),
    notificationSounds: z.boolean(),
    notificationPrivacy: z.enum(['FULL', 'SENDER_ONLY', 'GENERIC']),
    notificationsEnabled: z.boolean(),
    badgeCount: z.boolean(),
    statusConnectionStrength: z.boolean(),
    statusResponseTime: z.boolean(),
    moduleNotifications: z.record(z.string().max(64), z.boolean()),
    dndEnabled: z.boolean(),
    dndFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    dndTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    appLockMinutes: z.number().int().min(0).max(1440),
    appLockEnabled: z.boolean(),
    lockOnSleep: z.boolean(),
    lockedChatNotifications: z.boolean(),
    lockedCallNotifications: z.boolean(),
    lockedNotificationSounds: z.boolean(),
    lockOnSystemLock: z.boolean(),
    lockedAnswerCalls: z.boolean(),
    lockedShowCallerDetails: z.boolean(),
    lockedAllowChat: z.boolean(),
    lockedNotificationSender: z.boolean(),
    lockedNotificationPreview: z.boolean(),
    openFilesLocally: z.enum(['ask', 'always', 'never']),
    mailCacheDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]),
    mailtoHandler: z.boolean(),
    links: z.object({ openInApp: z.boolean(), mailLinks: z.enum(['new-tab', 'current-tab']), confirmActions: z.boolean() }).partial(),
    // Settings › Files › Open Office files in (worksuite-desktop#322).
    officeOpen: z.object({ doc: officeOpenChoice, sheet: officeOpenChoice, slides: officeOpenChoice }).partial(),
    mailCacheDaysByMailbox: z.record(z.string().regex(/^\d{1,12}$/), z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)])).refine((r) => Object.keys(r).length <= 200),
    mailFolderOffline: z.record(z.string().regex(/^(\d{1,12}|local):[A-Za-z0-9._\-/ :]{1,128}$/), z.enum(['all', 'recent', 'headers', 'online'])).refine((r) => Object.keys(r).length <= 500),
    mailAlerts: z.enum(['all', 'focused', 'vip', 'none']),
    mailVipBreakthrough: z.boolean(),
    // New-mail alerts (ENH-MAIL-05): the preview level and Mail sound. The pause has its own channel.
    mailAlertPreview: z.enum(['full', 'sender', 'hidden']),
    mailAlertSound: z.boolean(),
    // Settings › Mail › Images & media, this computer's part (worksuite-desktop#163).
    mailMedia: z
      .object({
        autoDownload: z.enum(['off', '5', '25', 'all']),
        network: z.enum(['any', 'unmetered']),
        types: z.array(z.enum(['images', 'pdf', 'office', 'all'])).min(1).max(4),
        saveTo: z.enum(['local', 'files']),
        filesFolder: z.object({ id: z.number().int().positive(), name: z.string().max(255) }).nullable(),
      })
      .partial(),
    highContrast: z.boolean(),
    tabSuspendMinutes: z.number().int().min(5).max(480),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    updateChannel: z.enum(['stable', 'beta', 'dev', 'org']),
    autoUpdate: z.boolean(),
    updateNotifications: z.boolean(),
    updateInstallOnQuit: z.boolean(),
    updateShowWhatsNew: z.boolean(),
    updateInstallWhenIdle: z.boolean(),
    sidebarMode: z.enum(['expanded', 'collapsed', 'auto-hide']),
    pinnedApps: z.array(z.string().max(64)).max(64),
    shortcuts: z.record(z.string().max(64), z.string().max(64)),
    backgroundServices: z.object({ notifications: z.boolean(), realtime: z.boolean() }),
    webchatRinging: z.object({ window: z.boolean(), duringDnd: z.enum(['card', 'at_risk', 'ring']), shortcut: z.boolean(), volume: z.number().int().min(0).max(100), ringOn: z.enum(['both', 'default']).optional(), liveShortcuts: z.boolean().optional() }),
    // Notification settings › Support (WS-SUPPORT-SRS-001 D-03): each kind's banner and sound here.
    supportNotices: z
      .object({
        assigned: supportNoticeChoice,
        reply: supportNoticeChoice,
        mention: supportNoticeChoice,
        sla: supportNoticeChoice,
        slaPersistent: z.boolean(),
        lowPriority: z.enum(['banner', 'digest']),
        quickShortcut: z.boolean(),
        urgentPopup: z.boolean(),
      })
      .partial(),
    webchatFollowUps: z.object({ card: z.boolean(), desktop: z.boolean(), sound: z.boolean(), idleMinutes: z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10)]) }),
    // Settings › Chat: the chat drawer docked beside the page or floating over it (worksuite-desktop#264).
    chatDrawer: z.enum(['docked', 'floating']),
    ai: z.object({
      quickAsk: z.boolean(),
      shortcut: z.enum(['Alt+Space', 'Control+Alt+Space', 'CommandOrControl+Shift+Space']),
      insert: z.boolean(),
      dockAtStart: z.boolean(),
      language: z.string().regex(/^[A-Za-z ]{2,40}$/),
      display: z.enum(['drawer', 'widget', 'hidden']),
      sound: z.boolean(),
      moduleAccess: z.object({
        worksuite: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.object({ read: z.boolean(), write: z.boolean() })),
        local: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.object({ read: z.boolean(), write: z.boolean() })),
      }),
      onlineFallback: z.boolean(),
      autoMinimize: z.boolean(),
      autoMinimizeWhenWorking: z.boolean(),
    }),
    // The local folder is not here: only the main process's folder dialog sets it.
    meetRecording: z.object({
      method: z.enum(['cloud', 'local']),
      quality: z.enum(['720p', '1080p']),
      layout: z.enum(['grid', 'speaker', 'screen']),
      folder: z.string().min(1).max(120).regex(/^[^\\/\p{C}]+$/u),
      keepLocal: z.enum(['keep', 'delete', '7', '30']),
    }).partial(),
    // Settings › Meet › Behaviour (WS-MEET-ENH-01 D05).
    meetBehaviour: z.object({
      popOutOnSwitch: z.boolean(),
      globalKeys: z.boolean(),
      shareComputerSound: z.boolean(),
      qualityOnBattery: z.enum(['auto', '720p', '360p']),
    }).partial(),
    // Drive › Settings (worksuite-desktop#95). The download folder is not here either: only its dialog sets it.
    drive: z.object({
      maxConcurrent: z.number().int().min(1).max(MAX_CONCURRENT),
      maxUploads: z.number().int().min(1).max(MAX_CONCURRENT).nullable(),
      maxDownloads: z.number().int().min(1).max(MAX_CONCURRENT).nullable(),
      uploadLimit: bandwidthLimitSchema,
      downloadLimit: bandwidthLimitSchema,
      autoRetry: z.boolean(),
      autoResume: z.boolean(),
      metered: z.enum(['normal', 'limit', 'pause']),
      meteredConnection: z.boolean(),
      askWhereToSave: z.boolean(),
      conflict: z.enum(['ask', 'both', 'skip', 'replace']),
      notifyComplete: z.boolean(),
      notifyFailed: z.boolean(),
    }).partial(),
    // Connection & Startup: the workspace chooser at every start, the desktop cache limit, other accounts' banners.
    chooserAlways: z.boolean(),
    desktopCacheLimitMb: z.union([z.literal('auto'), z.number().int().min(256).max(1_048_576)]),
    otherAccountNotifications: z.boolean(),
  })
  .partial();

export const mutationInputSchema = z.object({
  module: z.string().max(64),
  entity: z.string().max(64),
  entityId: z.string().max(128).nullable(),
  label: z.string().max(200),
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().regex(/^\/api\/[A-Za-z0-9/_\-.]+$/).max(256),
  body: z.unknown().optional(),
  baseEtag: z.string().max(128).nullable().optional(),
  /** Only queue if the request cannot be delivered now. */
  queueIfOffline: z.boolean(),
});
export type MutationInput = z.infer<typeof mutationInputSchema>;

export const uploadTargetSchema = z.discriminatedUnion('kind', [
  /**
   * Into Drive. `replaceFileId`: the upload becomes a new version of that file (the answer to "a file with
   * this name is already here"); `name`: the name to give it instead of the file's own (keeping both).
   */
  z.object({
    kind: z.literal('files'),
    folderId: z.string().max(64).nullable(),
    replaceFileId: z.string().regex(/^\d{1,12}$/).optional(),
    name: z.string().min(1).max(255).regex(/^[^/\\]+$/).optional(),
  }),
  /**
   * A chat attachment; the caption and the reply go with it (the first of several files carries them). A voice
   * message carries its length and its loudness, 64 steps of 0–100, as they were measured while recording (#285).
   */
  z.object({ kind: z.literal('chat'), roomId: z.string().max(64), caption: z.string().max(4000).optional(), replyTo: z.number().int().positive().optional(), clientMessageId: z.string().regex(/^desktop-[a-zA-Z0-9-]{1,80}$/).optional(), voice: z.boolean().optional(), durationMs: z.number().int().min(0).max(86400000).optional(), waveform: z.array(z.number().int().min(0).max(100)).max(256).optional(), submittedAt: z.string().datetime().optional() }),
  /** A task's attachment (or a comment's, with its id): stored in Drive, then linked to the task. */
  z.object({ kind: z.literal('task'), taskId: z.number().int().positive(), commentId: z.number().int().positive().optional() }),
  /**
   * A tender's file: stored in Drive, then filed on the tender — as a new document (`docKind`), on a
   * checklist line (`id` = the line), as the new version of a document (`id` = the document), or as a
   * bond's copy (`id` = the security). The server checks the tender and the permission at the filing.
   */
  z.object({
    kind: z.literal('tender'),
    tenderId: z.number().int().positive(),
    into: z.enum(['document', 'line', 'replace', 'security']),
    id: z.number().int().positive().optional(),
    docKind: z.string().regex(/^[a-z_]{1,60}$/).optional(),
  }),
  /** A mail attachment (worksuite-desktop#249): sent in parts like any upload, then staged for the message — not kept in Drive. */
  z.object({ kind: z.literal('mail') }),
  /** Offered to the other end of a remote-control session (RC06): they accept or decline it there. */
  z.object({ kind: z.literal('remote'), sessionId: z.number().int().positive() }),
  // To a website visitor (ENH-WCHAT-02, RDC-04/14): one request to the conversation's attach, the widget's own store.
  z.object({ kind: z.literal('website'), conversationId: z.number().int().positive(), caption: z.string().max(400).optional() }),
]);
export type UploadTarget = z.infer<typeof uploadTargetSchema>;

export const syncMode = z.enum(['two_way', 'upload_only', 'download_only']);
export const pdfSession = z.string().regex(/^[0-9a-f-]{36}$/);
export const pdfPage = z.number().int().min(0).max(1_000_000);
export const pdfTicket = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const driveId = z.number().int().positive().max(2 ** 31);

export interface ChannelSpec {
  input: z.ZodType;
  permission?: string;
  session?: boolean;
  whileLocked?: boolean;
  sensitive?: boolean;
  rate?: number;
}

export function ch<S extends z.ZodType>(input: S, opts: Omit<ChannelSpec, 'input'> = {}): ChannelSpec & { input: S } {
  return { input, ...opts };
}

export const launcherAppId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);

export const localModelId = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/);

/** A Drive file's cover in the thumbnail cache: `drive:<file id>:<version or change time>`. */
export const coverId = z.string().regex(/^drive:\d{1,12}:[A-Za-z0-9:.-]{1,40}$/);

/** An Office document's bytes from the editor (a ZIP package, an OLE file, RTF or CSV), at most the local limit. */
/** A rendered picture: at most the server's render limit and a little over (60 MB). */
export const imageBytes = z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 64 * 1024 * 1024, 'The picture is empty or too large.');
export const officeBytes = z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= MAX_OFFICE_LOCAL_BYTES, 'The document is empty or too large.');

export const mailFileHandle = z.string().uuid();
