import { MAX_CONCURRENT } from '../transfers';
import { DARK_PROFILE_IDS } from '../theme-profiles';
import { localProfileInput, type LocalOverview, type LocalProfile, type LocalStatus, type MoveOffer, type MoveResult, type RestorePreview } from '../local-workspace';
import type { GuestMeetInfo, GuestMeetToken } from '../guest-meet';
/**
 * The typed IPC contract (§3.4, §8.4, WF-05).
 *
 * Every channel declares:
 *  - `input`: a zod schema. Payloads are parsed with it and unknown keys are
 *    stripped; anything that fails is IPC_VALIDATION_FAILED.
 *  - `permission`: desktop permission key(s) required, resolved against the
 *    active bootstrap.
 *  - `session`: requires a signed-in, bootstrapped session.
 *  - `whileLocked`: may be called while the app lock is showing. Everything
 *    else is refused while locked, so a locked window cannot be scripted.
 *  - `sensitive`: emits an audit event (§9.1).
 *  - `rate`: calls per second allowed from one window before it is throttled.
 */
import { z } from 'zod';
import { garageDocSchema } from '../garage-docs';
import { pmsDownloadInput } from '../pms-files';
import { ELEARNING_MEDIA_TOKEN, elearningCourseRef, elearningDownloadInput, type OfflineCourse, type OfflineValidation } from '../elearning-offline';
import {
  deskEventRef,
  deskForgetInput,
  deskPrintJobsInput,
  deskPrintSettingsPatch,
  deskQueueAction,
  deskRegisterInput,
  deskScanInput,
  deskSearchInput,
  deskWalkInInput,
  type DeskPrintOutcome,
  type DeskPrintSettings,
  type DeskQueueItem,
  type DeskRegistration,
  type DeskScanOutcome,
  type DeskSearchHit,
  type DeskStatus,
} from '../event-desk';
import { localRequestSchema, type LocalAIStatus, type LocalModelView } from '../local-ai';
import { ocrRequestSchema, type OcrResult, type OcrStatus } from '../ocr';
import {
  restaurantOutboxAction,
  restaurantOutboxAdd,
  restaurantPairInput,
  restaurantPrintPatch,
  restaurantPrintTest,
  restaurantPrintText,
  restaurantUnpairInput,
  type RestaurantCopy,
  type RestaurantOutboxItem,
  type RestaurantPairing,
  type RestaurantPrintJobLog,
  type RestaurantPrintOutcome,
  type RestaurantPrintSettings,
  type RestaurantStatus,
} from '../restaurant';
import { MAX_OFFICE_LOCAL_BYTES, OFFICE_EDITOR_EVENTS, OFFICE_EXPORT_TOKEN, officeCommandSchema, type ExternalApp, type OfficeLocalCopy, type OfficeLocalPick } from '../office';
import { pmsLocksContract, type PmsLocksOutputs } from '../pms-locks';
import { posContract, type PosOutputs } from '../pos';
import { pdfEditOpSchema, pdfPrintSchema, pdfSearchOptionsSchema, pdfSourceSchema, SEARCH_MAX_QUERY, type PdfAnnotView, type PdfAttachmentView, type PdfBitmap, type PdfDiagnosticCheck, type PdfDriveDetails, type PdfFailureReport, type PdfLinkView, type PdfLocalPick, type PdfOutlineNode, type PdfRect, type PdfSessionView } from '../pdf';
import type { InvokeChannel } from './channels';
import type {
  ActiveCall,
  LocalRecording,
  SpeechSegment,
  SpeechStatus,
  AiRules,
  AiUpload,
  AppInfo,
  AuthState,
  Bootstrap,
  BusyReport,
  DeviceInfo,
  DiagnosticCheck,
  Draft,
  NotificationItem,
  NotificationPermission,
  OfflineMutation,
  Preferences,
  PreferenceLock,
  RemoteControlConsent,
  RemoteControlView,
  SalonDeskInfo,
  SalonDeskPairing,
  SalonPrintOutcome,
  SalonSyncStatus,
  SalonCopy,
  SalonCopyClient,
  SalonOutboxItem,
  SalonPrintSettings,
  ScreenSources,
  ServiceHealth,
  StatusSnapshot,
  SyncDevice,
  SyncLookup,
  SyncPolicy,
  SyncStatus,
  WebchatRingState,
  QuickAskContext,
  Transfer,
  UpdateStatus,
  MailStoreStats,
} from '../types';

const none = z.undefined().or(z.null()).optional();
const salonPaper = z.enum(['80mm', '58mm', 'a4']);
const idString = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const route = z
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

const bandwidthLimitSchema = z.object({ on: z.boolean(), value: z.number().positive().max(1_000_000), unit: z.enum(['KB', 'MB']) });

export const preferencesPatchSchema = z
  .object({
    startWithOs: z.boolean(),
    startMinimized: z.boolean(),
    minimizeToTray: z.boolean(),
    restoreTabs: z.boolean(),
    theme: z.enum(['system', 'light', 'dark']),
    darkColorProfile: z.enum(DARK_PROFILE_IDS),
    density: z.enum(['comfortable', 'compact']),
    hardwareAcceleration: z.boolean(),
    notificationSounds: z.boolean(),
    notificationPrivacy: z.enum(['FULL', 'SENDER_ONLY', 'GENERIC']),
    notificationsEnabled: z.boolean(),
    badgeCount: z.boolean(),
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
    mailCacheDaysByMailbox: z.record(z.string().regex(/^\d{1,12}$/), z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)])).refine((r) => Object.keys(r).length <= 200),
    tabSuspendMinutes: z.number().int().min(5).max(480),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    updateChannel: z.enum(['stable', 'beta', 'dev', 'org']),
    sidebarMode: z.enum(['expanded', 'collapsed', 'auto-hide']),
    pinnedApps: z.array(z.string().max(64)).max(64),
    shortcuts: z.record(z.string().max(64), z.string().max(64)),
    backgroundServices: z.object({ notifications: z.boolean(), realtime: z.boolean() }),
    webchatRinging: z.object({ window: z.boolean(), duringDnd: z.enum(['card', 'at_risk', 'ring']), shortcut: z.boolean(), volume: z.number().int().min(0).max(100) }),
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
  /** A chat attachment; the caption and the reply go with it (the first of several files carries them). */
  z.object({ kind: z.literal('chat'), roomId: z.string().max(64), caption: z.string().max(4000).optional(), replyTo: z.number().int().positive().optional(), clientMessageId: z.string().regex(/^desktop-[a-zA-Z0-9-]{1,80}$/).optional(), voice: z.boolean().optional(), durationMs: z.number().int().min(0).max(86400000).optional(), submittedAt: z.string().datetime().optional() }),
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
  /** Offered to the other end of a remote-control session (RC06): they accept or decline it there. */
  z.object({ kind: z.literal('remote'), sessionId: z.number().int().positive() }),
  // To a website visitor (ENH-WCHAT-02, RDC-04/14): one request to the conversation's attach, the widget's own store.
  z.object({ kind: z.literal('website'), conversationId: z.number().int().positive(), caption: z.string().max(400).optional() }),
]);
export type UploadTarget = z.infer<typeof uploadTargetSchema>;

const syncMode = z.enum(['two_way', 'upload_only', 'download_only']);
const pdfSession = z.string().regex(/^[0-9a-f-]{36}$/);
const pdfPage = z.number().int().min(0).max(1_000_000);
const pdfTicket = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const driveId = z.number().int().positive().max(2 ** 31);

interface ChannelSpec {
  input: z.ZodType;
  permission?: string;
  session?: boolean;
  whileLocked?: boolean;
  sensitive?: boolean;
  rate?: number;
}

function ch<S extends z.ZodType>(input: S, opts: Omit<ChannelSpec, 'input'> = {}): ChannelSpec & { input: S } {
  return { input, ...opts };
}

const localModelId = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/);

/** A Drive file's cover in the thumbnail cache: `drive:<file id>:<version or change time>`. */
const coverId = z.string().regex(/^drive:\d{1,12}:[A-Za-z0-9:.-]{1,40}$/);

/** An Office document's bytes from the editor (a ZIP package, an OLE file, RTF or CSV), at most the local limit. */
const officeBytes = z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= MAX_OFFICE_LOCAL_BYTES, 'The document is empty or too large.');

export const contract = {
  'app:info': ch(none, { whileLocked: true }),
  'app:quit': ch(none, { whileLocked: true }),
  'app:relaunch': ch(none, { whileLocked: true }),
  'app:openExternal': ch(z.object({ url: z.string().url().max(2048) }), { rate: 5 }),
  'app:openInBrowser': ch(z.object({ path: z.string().regex(/^\/[A-Za-z0-9/_\-.?=&]*$/).max(512) }), { session: true, rate: 5 }),
  /** macOS: the Dock icon with the unread count painted on (the renderer draws it; see core/dock-badge). */
  'app:setDockIcon': ch(z.object({ png: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(4_000_000) }), { whileLocked: true, rate: 30 }),

  // Guest mode runs in the main window (#149): entering it is refused while an account is signed in.
  'local:enter': ch(none, { rate: 4 }),
  'local:leave': ch(none),
  'local:status': ch(none),
  'local:profile': ch(localProfileInput, { rate: 2 }),
  'local:unlock': ch(z.object({ pin: z.string().max(8) }), { rate: 1 }),
  // The module screens' requests, answered from the Local Profile (electron/services/local-api.ts).
  'local:api': ch(z.object({ method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), path: z.string().regex(/^\/api\/[^\s#\\]*$/).max(1024), query: z.record(z.string().max(64), z.union([z.string().max(2048), z.number(), z.boolean()])).optional(), body: z.unknown().optional() }), { rate: 60 }),
  'local:overview': ch(none),
  'local:export': ch(none, { rate: 2 }),
  'local:restorePreview': ch(none, { rate: 2 }),
  'local:restore': ch(z.object({ token: z.string().uuid() }), { rate: 2 }),
  'local:deleteAll': ch(z.object({ confirmation: z.literal('DELETE LOCAL DATA') }), { rate: 1 }),
  'local:meeting': ch(z.object({ input: z.string().max(2048), server: z.string().max(512) })),
  'local:joinMeeting': ch(z.object({ input: z.string().trim().min(1).max(2048), server: z.string().max(512).optional() }), { rate: 2 }),
  // Signing in from guest mode: what may move into this account, moving it, or keeping it on the device.
  'local:moveOffer': ch(none, { session: true }),
  'local:move': ch(none, { session: true, rate: 1 }),
  'local:keep': ch(none, { session: true }),
  'guest:pending': ch(none),
  'guest:open': ch(z.object({ input: z.string().trim().min(1).max(2048), server: z.string().max(512).optional() }), { rate: 2 }),
  'guest:info': ch(none, { rate: 2 }),
  'guest:join': ch(z.object({ name: z.string().trim().min(1).max(40).regex(/^[^\p{C}]+$/u), pass: z.string().max(128).optional() }), { rate: 2 }),
  'guest:signIn': ch(none),
  'auth:state': ch(none, { whileLocked: true }),
  'auth:setServer': ch(z.object({ url: z.string().min(3).max(512) }), { rate: 2 }),
  'auth:signIn': ch(z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(512) }), { rate: 2 }),
  'auth:verifyMfa': ch(z.object({ code: z.string().regex(/^[A-Za-z0-9-]{4,32}$/) }), { rate: 2 }),
  'auth:cancelMfa': ch(none),
  // Opens the server's passkey page in the browser; the result returns through worksuite://auth/callback.
  'auth:passkeyStart': ch(none, { rate: 2 }),
  'auth:passkeyCancel': ch(none),
  /**
   * A page of the WorkSuite web app that needs nobody signed in — resetting a
   * password, or the web app itself from a screen that cannot go on. Named, so
   * nothing signed out can open an arbitrary path. `app:openInBrowser` needs a
   * session, so the sign-in screen's "Forgot password" was always refused.
   */
  'auth:openPage': ch(z.object({ page: z.enum(['forgot-password', 'account']) }), { rate: 5 }),
  'auth:signOut': ch(z.object({ wipe: z.boolean().optional() }).optional(), { whileLocked: true, sensitive: true }),
  'auth:completeSetup': ch(none, { session: true }),
  // My account › Security: which listed session is this app's, and a password change that keeps it signed in.
  'auth:sessionId': ch(none, { session: true }),
  'auth:changePassword': ch(z.object({ current: z.string().min(1).max(512), next: z.string().min(1).max(512) }), { session: true, sensitive: true, rate: 3 }),
  'auth:renewMfa': ch(z.object({ code: z.string().regex(/^[A-Za-z0-9-]{4,32}$/) }), { session: true, rate: 5 }),
  'auth:renewCancel': ch(none, { session: true }),

  'session:bootstrap': ch(none, { session: true, whileLocked: true }),
  'session:refresh': ch(none, { session: true, rate: 1 }),
  'session:switchOrganization': ch(z.object({ organizationId: z.string().max(64).nullable() }), { session: true, sensitive: true }),

  'windows:open': ch(
    z.object({
      kind: z.enum(['chat-mini', 'timer', 'record', 'call', 'video-call', 'ring', 'meet']),
      route,
      title: z.string().max(200).optional(),
      alwaysOnTop: z.boolean().optional(),
    }),
    { session: true, rate: 4 },
  ),
  'windows:setAlwaysOnTop': ch(z.object({ value: z.boolean() }), { session: true }),
  'windows:setCompact': ch(z.object({ value: z.boolean(), shape: z.enum(['bar', 'card']).optional() }), { session: true }),
  'windows:fitVideo': ch(none, { session: true }),
  'windows:minimize': ch(none, { whileLocked: true }),
  'windows:toggleMaximize': ch(none, { whileLocked: true }),
  'windows:close': ch(none, { whileLocked: true }),
  'windows:state': ch(none, { whileLocked: true }),
  // Quick Ask (AI Assistant): what it was opened with, Insert back into that app, and handing a result to WorkSuite.
  'quickask:context': ch(none, { session: true }),
  'quickask:open': ch(none, { session: true, rate: 2 }),
  'quickask:insert': ch(z.object({ text: z.string().min(1).max(20_000) }), { session: true, rate: 2 }),
  'quickask:close': ch(none, { session: true }),
  'quickask:handoff': ch(z.object({ to: z.enum(['dock', 'task', 'search', 'changes']), text: z.string().max(8000), result: z.string().max(20_000).nullable() }), { session: true, rate: 2 }),
  // The assistant (WS-AI-SRS-001 DSK-3): its rules here, confirming a proposal (the main window only, audited),
  // and a file picked on this computer as context.
  'ai:rules': ch(z.object({ refresh: z.boolean().optional() }).optional(), { session: true }),
  // Local AI (WS-SRS-LAI §18.4): typed, allow-listed, checked here; the window names models by id, never a path.
  'ai:localStatus': ch(none, { session: true }),
  'ai:localModels': ch(none, { session: true }),
  'ai:localRefresh': ch(none, { session: true, rate: 6 }),
  'ai:localInstall': ch(z.strictObject({ id: localModelId }), { session: true, rate: 10 }),
  'ai:localCancelInstall': ch(z.strictObject({ id: localModelId, discard: z.boolean().optional() }), { session: true, rate: 20 }),
  'ai:localRemove': ch(z.strictObject({ id: localModelId }), { session: true, rate: 10 }),
  'ai:localSetDefault': ch(z.strictObject({ id: localModelId }), { session: true, rate: 10 }),
  'ai:localCheck': ch(z.strictObject({ id: localModelId }), { session: true, rate: 5 }),
  /** Loads an installed model and asks it for a word: resolves true once it answered (worksuite-desktop#55). */
  'ai:localTest': ch(z.strictObject({ id: localModelId }), { session: true, rate: 5 }),
  'ai:localAsk': ch(localRequestSchema, { session: true, rate: 30, sensitive: true }),
  'ai:localCancel': ch(z.strictObject({ id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }), { session: true, rate: 60 }),
  'ai:localRestart': ch(none, { session: true, rate: 3 }),
  // Reading the text in an image on this computer (worksuite-desktop#59): the picture as a PNG the window drew.
  'ai:ocr': ch(ocrRequestSchema, { session: true, rate: 10 }),
  'ai:ocrCancel': ch(z.strictObject({ id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }), { session: true, rate: 30 }),
  'ai:ocrStatus': ch(none, { session: true }),
  'ai:confirm': ch(z.object({ id: z.number().int().positive(), nonce: z.string().regex(/^[a-f0-9]{16,64}$/) }), { session: true, sensitive: true, rate: 5 }),
  'ai:upload': ch(none, { session: true, rate: 3 }),
  /** An answer arrived while the assistant was minimised and the window is not in front (#126): a banner, as notifications allow. */
  'ai:answerReady': ch(z.strictObject({ kind: z.enum(['ready', 'input', 'failed']), preview: z.string().max(300) }), { session: true, rate: 20 }),
  // Website chats ringing like calls (WS-WCHAT ENH-01, RING-49): the call window, the main window's bar.
  'ring:state': ch(none, { session: true, whileLocked: true }),
  'ring:join': ch(z.object({ id: z.number().int().positive() }), { session: true, rate: 4 }),
  'ring:silence': ch(z.object({ id: z.number().int().positive(), on: z.boolean() }), { session: true, rate: 10 }),
  'ring:pass': ch(z.object({ id: z.number().int().positive() }), { session: true, rate: 4 }),
  // Multi-window docking (FR-NAV-05/07): tear a tab off into its own window, and dock it back.
  'windows:detach': ch(
    z.object({ route, title: z.string().max(200).optional(), at: z.object({ x: z.number().int(), y: z.number().int() }).optional() }),
    { session: true, rate: 4 },
  ),
  'windows:dock': ch(z.object({ side: z.boolean().optional() }).optional(), { session: true, rate: 4 }),
  // "Open in Main App" in a chat window (#103): the main window opens what this one shows, and this one closes.
  'windows:toMain': ch(z.object({ keep: z.boolean().optional() }).optional(), { session: true, rate: 4 }),
  'windows:adopt': ch(z.object({ windowId: z.number().int().positive() }), { session: true, rate: 4 }),
  'windows:describe': ch(z.object({ route, title: z.string().max(200) }), { session: true, rate: 10 }),
  'windows:restoreDetached': ch(none, { session: true, rate: 1 }),

  'tabs:save': ch(
    z.object({ tabs: z.array(tabRecordSchema).max(64), activeId: idString.nullable(), side: z.object({ id: idString, split: z.number().min(0.2).max(0.8) }).nullable().optional() }),
    { session: true, rate: 10 },
  ),
  'tabs:restore': ch(none, { session: true }),

  'files:pickFiles': ch(z.object({ multiple: z.boolean(), title: z.string().max(100).optional(), only: z.enum(['gif', 'document', 'image', 'video', 'audio']).optional() }), { session: true, rate: 2 }),
  // The dialog runs in the main process, which stores the chosen folder itself.
  'files:chooseDownloadFolder': ch(none, { rate: 2 }),
  /** A short text the page made (backup codes), saved where the person chooses in a save dialog. */
  'files:saveText': ch(z.object({ name: z.string().regex(/^[A-Za-z0-9 ._-]{1,80}\.txt$/), text: z.string().max(64_000) }), { session: true, rate: 2 }),
  'files:registerDropped': ch(z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(200) }), { session: true, rate: 5 }),
  /** A folder, with everything in it: each file carries its path inside the folder. */
  'files:pickFolder': ch(z.object({ title: z.string().max(100).optional() }), { session: true, rate: 2 }),

  'media:access': ch(z.object({ kind: z.enum(['microphone', 'camera']) }), { session: true, rate: 5 }),
  'media:screenSources': ch(none, { session: true, rate: 3 }),
  'media:screenPick': ch(z.object({ id: z.string().min(1).max(200), audio: z.boolean().optional() }), { session: true, rate: 6 }),
  'media:privacySettings': ch(z.object({ pane: z.enum(['microphone', 'camera', 'screen', 'accessibility']) }), { session: true, rate: 2 }),
  'calls:active': ch(
    z.object({
      uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).nullable(),
      /** A chat call (hung up on the server when its window closes) or a meeting. */
      kind: z.enum(['call', 'meet']).optional(),
      title: z.string().max(200).optional(),
    }),
    { session: true, rate: 10 },
  ),
  'calls:list': ch(none, { session: true }),

  /*
   * Meetings recorded on this computer (worksuite-desktop#68). The meeting's window records and hands the pieces
   * over; this process writes, finishes and uploads them. A page never names a path: the folder is chosen with the
   * dialog here, and recordings are named by their id.
   */
  'meetrec:preflight': ch(none, { session: true, rate: 10 }),
  'meetrec:start': ch(
    z.object({
      meeting: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
      title: z.string().max(190),
      layout: z.enum(['grid', 'speaker', 'screen']),
      mime: z.string().regex(/^video\/(webm|mp4)(;[A-Za-z0-9=,.\s-]{0,80})?$/),
    }),
    { session: true, rate: 4 },
  ),
  'meetrec:chunk': ch(z.object({ id: z.string().uuid(), data: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 16 * 1024 * 1024, 'A piece is at most 16 MB.') }), { session: true, whileLocked: true, rate: 120 }),
  'meetrec:active': ch(z.object({ id: z.string().uuid() }), { session: true, whileLocked: true, rate: 10 }),
  'meetrec:abort': ch(z.object({ id: z.string().uuid() }), { session: true, whileLocked: true, rate: 10 }),
  'meetrec:stop': ch(z.object({ id: z.string().uuid(), durationMs: z.number().int().min(0).max(24 * 3600 * 1000) }), { session: true, whileLocked: true, rate: 10 }),
  'meetrec:list': ch(none, { session: true }),
  'meetrec:retry': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10 }),
  'meetrec:discard': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10 }),
  'meetrec:reveal': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10 }),
  'meetrec:chooseFolder': ch(none, { session: true, rate: 3 }),
  /** Play the copy on this computer in the system's player (worksuite-desktop#89). */
  'meetrec:open': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10, permission: 'desktop.files.open_external' }),
  /** Downloads of Meet recordings, by the recording's id: the transfer that has (or is getting) each one. */
  'meetrec:downloads': ch(none, { session: true }),

  /*
   * Speech to text on this computer (worksuite-desktop#81). A meeting's window asks; the hidden speech page, loaded
   * with the person's whisper.cpp model, answers through the main process. Pieces are 16 kHz mono WAV.
   */
  'stt:status': ch(none, { session: true }),
  'stt:chooseModel': ch(none, { session: true, rate: 3 }),
  'stt:removeModel': ch(none, { session: true, rate: 3 }),
  'stt:transcribe': ch(
    z.object({ wav: z.instanceof(Uint8Array).refine((b) => b.byteLength > 44 && b.byteLength <= 12 * 1024 * 1024, 'A piece is at most 12 MB.'), language: z.enum(['en', 'si', 'ta', 'auto']) }),
    { session: true, rate: 120 },
  ),
  'speech:ready': ch(z.object({ ok: z.boolean(), error: z.string().max(500).optional() }), { session: true, rate: 10 }),
  'speech:result': ch(
    z.object({
      id: z.string().uuid(),
      segments: z.array(z.object({ start_ms: z.number().int().min(0), end_ms: z.number().int().min(0), text: z.string().max(4000), uncertain: z.boolean() })).max(1000).optional(),
      error: z.string().max(500).optional(),
    }),
    { session: true, rate: 240 },
  ),

  /*
   * Meet remote control on this computer (WS-MEET-ENH-01). The meeting window
   * says when it shares and relays what arrives on the data channel; it never
   * holds a key. Answering a request comes only from the consent window, and
   * resuming only from the control bar, each with a real click there. Stopping
   * works while WorkSuite is locked: stopping is never harder than starting.
   */
  'rc:state': ch(none, { session: true, whileLocked: true }),
  /** Asks macOS again whether WorkSuite may take input (Check again; back from System Settings — worksuite-desktop#47). */
  'rc:recheck': ch(none, { session: true, rate: 20 }),
  /** Restart WorkSuite after Accessibility was granted (worksuite-desktop#147): the app and its input helper start again. */
  'rc:restart': ch(none, { session: true, rate: 1 }),
  'rc:setAllowRequests': ch(z.object({ value: z.boolean() }), { session: true, rate: 5 }),
  'rc:shareStarted': ch(
    z.object({
      uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
      identity: z.string().min(1).max(64),
      quality: z.enum(['auto', 'quality', 'balanced', 'performance']).optional(),
      allowRequests: z.boolean().optional(),
    }),
    { session: true, rate: 4 },
  ),
  'rc:shareChanged': ch(z.object({ uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }), { session: true, whileLocked: true, rate: 4 }),
  'rc:shareStopped': ch(z.object({ uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }), { session: true, whileLocked: true, rate: 4 }),
  'rc:sharePaused': ch(z.object({ uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), paused: z.boolean() }), { session: true, whileLocked: true, rate: 4 }),
  'rc:packet': ch(
    z.object({ sender: z.string().min(1).max(128), topic: z.enum(['rc.ctl', 'rc.ctl.move']), data: z.string().min(2).max(16_384) }),
    { session: true, whileLocked: true, rate: 250 },
  ),
  'rc:consent': ch(none, { session: true, whileLocked: true, rate: 5 }),
  'rc:answer': ch(
    z.object({
      decision: z.enum(['allow', 'allow_5', 'deny', 'transfer']),
      caps: z
        .object({
          mouse: z.boolean(),
          keyboard: z.boolean(),
          clipboard: z.enum(['off', 'text', 'text_files']),
          file_transfer: z.boolean(),
          monitor_switch: z.boolean(),
        })
        .partial()
        .optional(),
      duration: z.enum(['until_stopped', '5', '15', '30', 'meeting_end']).optional(),
    }),
    { session: true, whileLocked: true, sensitive: true, rate: 3 },
  ),
  'rc:pause': ch(z.object({ sessionId: z.number().int().positive() }), { session: true, whileLocked: true, rate: 3 }),
  'rc:resume': ch(z.object({ sessionId: z.number().int().positive() }), { session: true, sensitive: true, rate: 3 }),
  'rc:stop': ch(z.object({ sessionId: z.number().int().positive().optional() }), { session: true, whileLocked: true, sensitive: true, rate: 3 }),
  /** A file the controller offered this computer (RC06), answered on the control bar; accepting needs a real click there. */
  'rc:fileAnswer': ch(z.object({ id: z.number().int().positive(), accept: z.boolean(), confirmExecutable: z.boolean().optional() }), { session: true, whileLocked: true, sensitive: true, rate: 5 }),
  /** Offer the controller a file from this computer, chosen in the system's dialog (nothing is injected while it is open). */
  'rc:sendFile': ch(z.object({ sessionId: z.number().int().positive() }), { session: true, sensitive: true, rate: 2 }),
  /** As the controller, take a file the shared computer offered (only files sent to the controller). */
  'rc:takeFile': ch(z.object({ sessionId: z.number().int().positive(), id: z.number().int().positive(), confirmExecutable: z.boolean().optional() }), { session: true, sensitive: true, rate: 5 }),
  'calls:focus': ch(z.object({ windowId: z.number().int().positive() }), { session: true }),
  'hr:clock': ch(
    z.object({
      direction: z.enum(['in', 'out']),
      note: z.string().max(500).optional(),
      /** Where the day is being worked (the company's list of work locations). */
      workLocation: z.string().min(1).max(60).optional(),
      /** What kind of day it was, on clocking out. */
      /** Why no location comes with it, where the company asks for one. */
      geoNote: z.string().min(1).max(200).optional(),
      noteType: z.enum(['normal', 'overtime', 'customer_visit', 'off_site', 'wfh', 'early_departure', 'missed_break', 'technical_issue', 'other']).optional(),
    }),
    { session: true, rate: 3 },
  ),
  'hr:break': ch(z.object({ action: z.enum(['start', 'end']) }), { session: true, rate: 3 }),
  'transfers:list': ch(none, { session: true }),
  'transfers:download': ch(
    z
      .object({
        fileId: idString.optional(),
        // A mail attachment: the main process builds the request from these
        // parts; the renderer never supplies a path.
        mail: z
          .object({
            uid: z.string().regex(/^\d{1,20}$/),
            ref: z.string().min(1).max(512),
            folder: z.string().regex(/^[A-Za-z0-9._\-/ :]{1,128}$/),
            mailbox: z.string().regex(/^\d{1,20}$/).nullable(),
          })
          .optional(),
        /** A message's original as the server holds it (.eml): the main process builds the request from these parts. */
        mailSource: z
          .object({
            uid: z.string().regex(/^\d{1,20}$/),
            folder: z.string().regex(/^[A-Za-z0-9._\-/ :]{1,128}$/),
            mailbox: z.string().regex(/^\d{1,20}$/).nullable(),
          })
          .optional(),
        /** A Meet recording (the owner's own; the server checks). */
        recording: z.number().int().positive().optional(),
        /** With a file id: the Meet recording it is, so the download shows on that recording (worksuite-desktop#89). */
        forRecording: z.number().int().positive().optional(),
        /** One of the fixed exports: your calendar (.ics) or your contacts (.csv / .vcf). */
        export: z.enum(['calendar', 'contacts-csv', 'contacts-vcf', 'contacts-template']).optional(),
        /** The rows an import could not take, as a CSV (a data job's errors). */
        importErrors: z.number().int().positive().optional(),
        /** An earlier version of a Drive file. */
        version: z.object({ fileId: z.number().int().positive(), versionId: z.number().int().positive() }).optional(),
        /** My payslip as a PDF, by its reference. */
        payslip: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
        /** An HR document (the main process asks for its one-time link) — mine, or with `hrEmployee` that employee's. */
        hrDocument: z.number().int().positive().optional(),
        hrEmployee: z.number().int().positive().optional(),
        /** A resignation letter: one being reviewed, by its resignation id, or my own. */
        hrLetter: z.union([z.number().int().positive(), z.literal('mine')]).optional(),
        /** An HR attendance report as a CSV, as the Reports screen filtered it. */
        hrReport: z
          .object({
            type: z.enum(['summary', 'late', 'early', 'overtime', 'absence', 'missing', 'remote']),
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            department_id: z.number().int().positive().optional(),
            employee_id: z.number().int().positive().optional(),
          })
          .optional(),
        /** One of my profile pictures, as it was kept (My account › Profile pictures). */
        picture: z.number().int().positive().optional(),
        /** A sales order as its PDF (the server's share of it). */
        orderPdf: z.number().int().positive().optional(),
        /** A meeting's minutes as PDF or Word (worksuite-desktop#80); the server checks who may read them. */
        minutesExport: z.object({ meeting: z.number().int().positive(), format: z.enum(['pdf', 'docx']) }).optional(),
        /** A meeting transcript as TXT or PDF (worksuite-desktop#81); the server checks who may read it. */
        transcriptExport: z.object({ id: z.number().int().positive(), format: z.enum(['txt', 'pdf']) }).optional(),
        /** An invoice as its PDF, on its company's letterhead (the server's share of it). */
        invoicePdf: z.number().int().positive().optional(),
        /** A bank slip attached to a payment (Billing › Payments). */
        paymentSlip: z.object({ payment: z.number().int().positive(), slip: z.number().int().positive() }).optional(),
        /** A tender's document, a checklist line's file (or an earlier version of it), or a generated letter. */
        tenderDocument: z.number().int().positive().optional(),
        tenderLine: z.object({ line: z.number().int().positive(), version: z.number().int().positive().optional() }).optional(),
        tenderLetter: z.object({ tender: z.number().int().positive(), letter: z.number().int().positive() }).optional(),
        /** A company document's file from the tender library. */
        tenderLibrary: z.number().int().positive().optional(),
        /** The order list as a CSV, as the Orders screen filtered it. */
        ordersCsv: z
          .object({
            org: z.string().regex(/^(\d+(,\d+)*)?$/).optional(),
            status: z.string().regex(/^[a-z_,]{1,200}$/).optional(),
            source: z.string().regex(/^[a-z_,]{1,100}$/).optional(),
            priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
            q: z.string().max(100).optional(),
            mine: z.boolean().optional(),
          })
          .optional(),
        /** An Orders report as a CSV, as the Reports screen set it. */
        omsReport: z
          .object({
            report: z.enum(['summary', 'sales', 'status', 'payment', 'aging', 'returns', 'coupons']),
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            org: z.string().regex(/^(\d+(,\d+)*)?$/).optional(),
            group: z.enum(['month', 'day', 'client', 'user', 'assignee', 'org', 'source', 'product', 'category', 'status', 'type', 'priority']).optional(),
          })
          .optional(),
        /** A Finance report as a CSV: its summary rows, or (`lines`) every journal line in the window. */
        financeCsv: z
          .object({
            report: z.enum(['financial-overview', 'cash-flow', 'budget-variance', 'profit-and-loss']),
            lines: z.boolean().optional(),
            company: z.number().int().positive(),
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            currency: z.string().regex(/^[A-Z]{3}$/).optional(),
          })
          .optional(),
        /**
         * An Expenses file: a claim's receipt, a receipt by its token (petty cash), a subscription's
         * document, a payment run's bank file, an accounting export, or a report as a CSV. The main
         * process builds the address; a report's query is short keys and values, nothing else.
         */
        expenseFile: z
          .discriminatedUnion('kind', [
            z.object({ kind: z.literal('claim-receipt'), claim: z.number().int().positive() }),
            z.object({ kind: z.literal('receipt'), token: z.string().regex(/^[A-Za-z0-9._-]{6,128}$/) }),
            z.object({ kind: z.literal('sub-document'), sub: z.number().int().positive(), doc: z.number().int().positive() }),
            z.object({ kind: z.literal('run-csv'), run: z.number().int().positive(), org: z.number().int().positive().optional() }),
            z.object({ kind: z.literal('posting'), posting: z.number().int().positive(), org: z.number().int().positive().optional() }),
            z.object({
              kind: z.literal('report'),
              which: z.enum(['insights', 'classic']),
              query: z.record(z.string().regex(/^[a-z_]{1,32}$/), z.string().max(200)).refine((q) => Object.keys(q).length <= 12, 'too many parameters'),
            }),
          ])
          .optional(),
        /**
         * A Garage document — a job's check-in sheet, an estimate version, a work order's sheet, the
         * delivery note — or a Garage report as a CSV (`shared/garage-docs.ts`). The main process builds
         * the address.
         */
        garageDoc: garageDocSchema.optional(),
        /**
         * An eLearning lesson's file where the lesson allows downloading: the signed token of the
         * address the server gave with the lesson (`file.urls.download`). The main process builds
         * `/media/{token}?download=1`; a protected lesson has no such address to give.
         */
        elearningMedia: z.string().regex(ELEARNING_MEDIA_TOKEN).optional(),
        /** An Office export's signed download (`POST …/office/export` → `download_url`): its token; the main process fetches `/office/exports/{token}` from the server. */
        officeExport: z.string().regex(OFFICE_EXPORT_TOKEN).optional(),
        /** A chat attachment: the signed token of its `download_url` (`/media/{token}?download=1`). */
        chatMedia: z.string().regex(ELEARNING_MEDIA_TOKEN).optional(),
        /** A task's attachment: the main process asks for its short-lived link (`POST /api/tasks/{task}/attachments/{id}/link`). */
        taskAttachment: z.object({ task: z.number().int().positive(), id: z.number().int().positive() }).optional(),
        name: z.string().min(1).max(255),
        open: z.boolean().optional(),
      })
      .refine((v) => [v.fileId, v.mail, v.mailSource, v.recording, v.export, v.importErrors, v.version, v.payslip, v.hrDocument, v.hrReport, v.hrLetter, v.picture, v.orderPdf, v.minutesExport, v.transcriptExport, v.invoicePdf, v.paymentSlip, v.ordersCsv, v.omsReport, v.tenderDocument, v.tenderLine, v.tenderLetter, v.tenderLibrary, v.financeCsv, v.expenseFile, v.garageDoc, v.elearningMedia, v.officeExport, v.chatMedia, v.taskAttachment].filter((x) => x !== undefined).length === 1 && (v.hrEmployee === undefined || v.hrDocument !== undefined), 'give a file id, a file version, a mail attachment or original, a recording, an export, an import job, a payslip, an HR document, an HR report, a resignation letter, a profile picture, an order or invoice PDF, the minutes or a transcript of a meeting, a payment slip, an order list, an Orders report, a tender document, checklist file, letter or library document, a Finance report, an Expenses file, a Garage document, an eLearning lesson file, an Office export, a chat attachment or a task attachment'),
    { session: true, permission: 'desktop.downloads', sensitive: true, rate: 10 },
  ),
  /**
   * Hotel PMS: a guest's document or a report's export through the download manager (shared/pms-files.ts). The
   * main process builds the address, refuses without `desktop.downloads` (here and in the handler) and audits it.
   */
  'pms:download': ch(pmsDownloadInput, { session: true, permission: 'desktop.downloads', sensitive: true, rate: 10 }),
  'transfers:prepareMedia': ch(
    z.strictObject({ handle: idString.optional(), data: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 100 * 1024 * 1024).optional(), name: z.string().min(1).max(255).regex(/^[^/\\]+$/), originalQuality: z.boolean() }).refine((v) => !!v.handle !== !!v.data, 'Give a picked handle or recorded bytes.'),
    { session: true, rate: 30 },
  ),
  'transfers:upload': ch(
    z.object({ handles: z.array(idString).min(1).max(200), target: uploadTargetSchema }),
    { session: true, rate: 5 },
  ),
  'transfers:pause': ch(z.object({ id: idString }), { session: true }),
  'transfers:resume': ch(z.object({ id: idString }), { session: true }),
  'transfers:cancel': ch(z.object({ id: idString }), { session: true }),
  'transfers:retry': ch(z.object({ id: idString }), { session: true }),
  'transfers:open': ch(z.object({ id: idString }), { session: true, permission: 'desktop.files.open_external' }),
  'transfers:reveal': ch(z.object({ id: idString }), { session: true }),
  'transfers:clearFinished': ch(none, { session: true }),
  'transfers:pauseAll': ch(none, { session: true }),
  'transfers:resumeAll': ch(none, { session: true }),
  'transfers:resetSettings': ch(none, { session: true }),

  /*
   * Drive sync. The renderer names Drive folders and this app's own ids; a
   * place on this computer is only ever chosen in the main process's dialog.
   */
  'sync:status': ch(none, { session: true }),
  'sync:devices': ch(none, { session: true, rate: 5 }),
  /** Another of my devices: rename it, sign it out of sync, wipe its synced copy, or remove it. Never this computer. */
  'sync:deviceAction': ch(z.object({ id: driveId, action: z.enum(['rename', 'sign-out', 'wipe', 'remove']), name: z.string().trim().min(1).max(160).optional() }), { session: true, sensitive: true, rate: 5 }),
  /** Sync a Drive folder (null: all of My Drive) — into ~/WorkSuite Drive, or, with `choose`, a folder picked in a dialog. */
  'sync:add': ch(z.object({ folderId: driveId.nullable(), mode: syncMode, choose: z.boolean() }), { session: true, permission: 'desktop.files.sync', sensitive: true, rate: 3 }),
  'sync:remove': ch(z.object({ id: idString }), { session: true, sensitive: true }),
  'sync:setMode': ch(z.object({ id: idString, mode: syncMode }), { session: true, permission: 'desktop.files.sync' }),
  /** One folder, or with `id` null every folder on this computer. */
  'sync:pause': ch(z.object({ id: idString.nullable(), paused: z.boolean() }), { session: true }),
  'sync:now': ch(none, { session: true, rate: 2 }),
  /** Deletions held back by the guard: carry them out, or bring the files back. */
  'sync:resolve': ch(z.object({ id: idString, choice: z.enum(['apply', 'restore']) }), { session: true, sensitive: true }),
  'sync:reveal': ch(
    z.object({ fileId: driveId.optional(), folderId: driveId.optional(), syncFolderId: idString.optional() }).refine((v) => [v.fileId, v.folderId, v.syncFolderId].filter((x) => x !== undefined).length === 1, 'name one file, folder or synced folder'),
    { session: true, rate: 5 },
  ),
  'sync:lookup': ch(z.object({ files: z.array(driveId).max(500), folders: z.array(driveId).max(500), context: driveId.nullable() }), { session: true, rate: 30 }),
  /** Registers this computer for sync again after it was signed out from elsewhere. */
  'sync:reconnect': ch(none, { session: true, permission: 'desktop.files.sync', sensitive: true, rate: 1 }),

  'notifications:list': ch(none, { session: true }),
  'notifications:markRead': ch(z.object({ ids: z.array(idString).min(1).max(200) }), { session: true }),
  'notifications:markAllRead': ch(none, { session: true }),
  'notifications:pause': ch(z.object({ minutes: z.number().int().min(0).max(60 * 24 * 7).nullable() }), { session: true }),
  'notifications:test': ch(none, { session: true, rate: 1 }),
  'notifications:permission': ch(none, { session: true }),
  /** The bell's count again, now: after the notification centre read, snoozed or archived something. */
  'notifications:refresh': ch(none, { session: true, rate: 10 }),

  'clipboard:readForPaste': ch(none, { session: true, rate: 5 }),

  'print:print': ch(z.object({ html: z.string().max(5_000_000), title: z.string().max(200), silent: z.boolean().optional(), deviceName: z.string().max(200).optional() }), { session: true, rate: 2 }),
  'print:printers': ch(none, { session: true }),
  'print:toPdf': ch(z.object({ html: z.string().max(5_000_000), title: z.string().max(200) }), { session: true, rate: 2 }),

  /*
   * PDF Studio (WorkSuite PDF Studio SRS §23.1). Unknown fields are refused,
   * not stripped (PDF-API-003). The renderer names a session it opened, pages
   * and tickets; files arrive as a Drive id, a mail attachment's parts or a
   * handle the main process issued — never a path (PDF-API-001).
   */
  'pdf:open': ch(z.strictObject({ source: pdfSourceSchema }), { session: true, rate: 5 }),
  'pdf:state': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  // The password goes to the engine and is kept, if asked, in memory for this session only (PDF-OPEN-008, PDF-SEC-013/014).
  'pdf:unlock': ch(z.strictObject({ session: pdfSession, password: z.string().min(1).max(1024), remember: z.boolean() }), { session: true, rate: 2, sensitive: true }),
  'pdf:retry': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 2 }),
  'pdf:close': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  'pdf:render': ch(
    z.strictObject({
      session: pdfSession,
      page: pdfPage,
      scale: z.number().positive().max(64),
      tile: z.strictObject({ x: z.number().int().min(0).max(1_000_000), y: z.number().int().min(0).max(1_000_000), w: z.number().int().min(1).max(4096), h: z.number().int().min(1).max(4096) }).optional(),
      ticket: pdfTicket,
    }),
    { session: true, rate: 400 },
  ),
  'pdf:thumbnail': ch(z.strictObject({ session: pdfSession, page: pdfPage, ticket: pdfTicket }), { session: true, rate: 400 }),
  'pdf:cancel': ch(z.strictObject({ session: pdfSession, tickets: z.array(pdfTicket).max(1000) }), { session: true, rate: 60 }),
  'pdf:search': ch(z.strictObject({ session: pdfSession, query: z.string().min(1).max(SEARCH_MAX_QUERY), options: pdfSearchOptionsSchema }), { session: true, rate: 10 }),
  'pdf:searchCancel': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  'pdf:outline': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 10 }),
  'pdf:links': ch(z.strictObject({ session: pdfSession, page: pdfPage }), { session: true, rate: 200 }),
  'pdf:followLink': ch(z.strictObject({ session: pdfSession, page: pdfPage, index: z.number().int().min(0).max(10_000) }), { session: true, rate: 5 }),
  'pdf:attachments': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 5 }),
  'pdf:details': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 5 }),
  /**
   * A Drive file's cover (its first page, a PDF's or an Office file's, drawn by the window) in PDF Studio's sealed
   * thumbnail cache, by the file and the version it shows: never a name, never readable without the database key.
   */
  'pdf:coverGet': ch(z.strictObject({ id: coverId }), { session: true, rate: 600 }),
  'pdf:coverPut': ch(z.strictObject({ id: coverId, jpeg: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 512 * 1024, 'A cover is at most 512 KB.') }), { session: true, rate: 300 }),
  'pdf:print': ch(pdfPrintSchema, { session: true, rate: 2 }),
  // The main process's open dialog; the chosen PDFs come back as handles.
  'pdf:pickLocal': ch(none, { session: true, rate: 2 }),
  // Paths only from a real drop, turned into paths in the preload (as files:registerDropped).
  'pdf:registerDropped': ch(z.strictObject({ paths: z.array(z.string().min(1).max(4096)).min(1).max(20) }), { session: true, rate: 5 }),
  'pdf:diagnostics': ch(none, { session: true, rate: 1 }),
  /*
   * Stage D2. A change is one operation (shared/pdf.ts) the main process checks
   * against the session's mode and the server's permissions before the engine
   * sees it; saving goes to WorkSuite (or this computer's own file) from the
   * main process, which alone holds the file.
   */
  'pdf:mode': ch(z.strictObject({ session: pdfSession, mode: z.enum(['VIEW', 'ANNOTATE', 'EDIT']), takeover: z.boolean().optional() }), { session: true, rate: 5 }),
  'pdf:edit': ch(z.strictObject({ session: pdfSession, op: pdfEditOpSchema }), { session: true, rate: 30 }),
  'pdf:undo': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  'pdf:redo': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  'pdf:annotations': ch(z.strictObject({ session: pdfSession, page: pdfPage }), { session: true, rate: 200 }),
  'pdf:textSpan': ch(
    z.strictObject({ session: pdfSession, page: pdfPage, from: z.tuple([z.number().min(-20_000).max(20_000), z.number().min(-20_000).max(20_000)]), to: z.tuple([z.number().min(-20_000).max(20_000), z.number().min(-20_000).max(20_000)]) }),
    { session: true, rate: 60 },
  ),
  'pdf:save': ch(z.strictObject({ session: pdfSession, target: z.enum(['version', 'copy']), note: z.string().max(200).optional() }), { session: true, rate: 3, sensitive: true }),
  'pdf:resolve': ch(z.strictObject({ session: pdfSession, answer: z.enum(['keep_both', 'upload_as_new_version', 'use_cloud']) }), { session: true, rate: 3, sensitive: true }),
  'pdf:discard': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 3 }),
  'pdf:extract': ch(z.strictObject({ session: pdfSession, pages: z.array(pdfPage).min(1).max(10_000) }), { session: true, rate: 3 }),

  // SalonMate's front desk: the key it is paired with stays in the main process.
  'salon:deskPairing': ch(none, { session: true }),
  'salon:deskPair': ch(
    z.object({ location_id: z.number().int().positive(), name: z.string().trim().min(1).max(80), pos_register_id: z.number().int().positive().nullable().optional() }),
    { session: true, rate: 3, sensitive: true },
  ),
  'salon:deskForget': ch(none, { session: true, rate: 3, sensitive: true }),
  // Its receipts go to the desk's own printer without a dialog; the drawer opens through it (salon-print.ts).
  'salon:printSettings': ch(none, { session: true }),
  'salon:printSettingsSet': ch(
    z
      .object({
        receipt_printer: z.string().trim().min(1).max(200).nullable(),
        a4_printer: z.string().trim().min(1).max(200).nullable(),
        paper: z.enum(['80mm', '58mm']),
        copies: z.number().int().min(1).max(3),
        auto_print: z.boolean(),
        silent: z.boolean(),
        drawer: z.enum(['off', 'printer']),
        drawer_pin: z.union([z.literal(2), z.literal(5)]),
      })
      .partial(),
    { session: true, rate: 5 },
  ),
  'salon:printReceipt': ch(z.object({ visit_id: z.number().int().positive(), paper: salonPaper.optional() }), { session: true, rate: 3 }),
  'salon:printTest': ch(z.object({ paper: salonPaper.optional() }), { session: true, rate: 2 }),
  'salon:printPage': ch(z.object({ html: z.string().max(500_000), paper: salonPaper.optional() }), { session: true, rate: 2 }),
  'salon:openDrawer': ch(none, { session: true, rate: 1, sensitive: true }),
  // Offline: the day's copy the screens fall back to, and what the counter did while WorkSuite was out of reach (salon-sync.ts).
  'salon:syncStatus': ch(none, { session: true }),
  'salon:syncNow': ch(none, { session: true, rate: 2 }),
  'salon:copy': ch(none, { session: true }),
  'salon:copyClients': ch(z.object({ q: z.string().max(120), limit: z.number().int().min(1).max(100).optional(), id: z.number().int().positive().optional() }), { session: true, rate: 20 }),
  'salon:outbox': ch(none, { session: true }),
  'salon:outboxAdd': ch(
    z.object({
      kind: z.enum(['client.create', 'visit.book', 'visit.check_in']),
      local_id: z.string().max(40).nullable().optional(),
      payload: z.record(z.string(), z.unknown()),
      label: z.string().trim().min(1).max(200),
      detail: z.string().max(300).nullable().optional(),
    }),
    { session: true, rate: 10 },
  ),
  'salon:outboxResolve': ch(
    z.union([
      z.object({ id: z.string().uuid(), action: z.enum(['drop', 'retry', 'take_next']) }),
      z.object({ id: z.string().uuid(), action: z.literal('time'), starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/) }),
      z.object({ id: z.string().uuid(), action: z.literal('client'), client_id: z.number().int().positive() }),
      z.object({ id: z.string().uuid(), action: z.literal('edit'), changes: z.record(z.string().max(40), z.union([z.string().max(2000), z.boolean(), z.null()])) }),
    ]),
    { session: true, rate: 5 },
  ),

  /*
   * eLearning's offline copies (shared/elearning-offline.ts): the course's files, as the server's download
   * manifest lists them, kept encrypted in the profile and played only inside WorkSuite; removed when the
   * server says the learning ended, when the licence runs out, or on request.
   */
  'elearning:offlineList': ch(none, { session: true }),
  'elearning:offlineDownload': ch(elearningDownloadInput, { session: true, rate: 2 }),
  'elearning:offlineRemove': ch(elearningCourseRef, { session: true, rate: 5 }),
  'elearning:offlineValidate': ch(none, { session: true, rate: 1 }),

  /*
   * WorkSuite Events' desk (shared/event-desk.ts, electron/services/event-desk.ts): this computer as a check-in
   * device. The key the server hands over when it is registered stays in the main process, which also matches
   * scans against the offline copy and keeps what was done offline for the server.
   */
  'eventdesk:list': ch(none, { session: true }),
  'eventdesk:status': ch(deskEventRef, { session: true, rate: 20 }),
  'eventdesk:register': ch(deskRegisterInput, { session: true, rate: 2, sensitive: true }),
  'eventdesk:rotateKey': ch(deskEventRef, { session: true, rate: 1, sensitive: true }),
  'eventdesk:forget': ch(deskForgetInput, { session: true, rate: 2, sensitive: true }),
  'eventdesk:sync': ch(deskEventRef, { session: true, rate: 2 }),
  'eventdesk:scan': ch(deskScanInput, { session: true, rate: 20 }),
  'eventdesk:search': ch(deskSearchInput, { session: true, rate: 30 }),
  'eventdesk:queue': ch(deskEventRef, { session: true, rate: 10 }),
  'eventdesk:queueResolve': ch(deskQueueAction, { session: true, rate: 10 }),
  'eventdesk:walkIn': ch(deskWalkInInput, { session: true, rate: 5 }),
  // Badges go to the desk's own printer, silently when it says so; the page is the server's (event-desk-print.ts).
  'eventdesk:printSettings': ch(none, { session: true }),
  'eventdesk:printSettingsSet': ch(deskPrintSettingsPatch, { session: true, rate: 5 }),
  'eventdesk:printJobs': ch(deskPrintJobsInput, { session: true, rate: 5 }),

  /*
   * Restaurant Manager (shared/restaurant.ts, electron/services/restaurant): this computer as a paired terminal.
   * The device key the server hands over at pairing stays in the main process, which also plays the offline
   * outbox back, beats, keeps the menu and floor copy, and runs the print agent for the printers plugged in here.
   */
  'restaurant:pairing': ch(none, { session: true }),
  'restaurant:pair': ch(restaurantPairInput, { session: true, rate: 2, sensitive: true }),
  'restaurant:unpair': ch(restaurantUnpairInput, { session: true, rate: 2, sensitive: true }),
  'restaurant:status': ch(none, { session: true, rate: 20 }),
  'restaurant:syncNow': ch(none, { session: true, rate: 2 }),
  'restaurant:copy': ch(none, { session: true, rate: 10 }),
  'restaurant:outbox': ch(none, { session: true, rate: 10 }),
  'restaurant:outboxAdd': ch(restaurantOutboxAdd, { session: true, rate: 20 }),
  'restaurant:outboxResolve': ch(restaurantOutboxAction, { session: true, rate: 10 }),
  'restaurant:printSettings': ch(none, { session: true }),
  'restaurant:printSettingsSet': ch(restaurantPrintPatch, { session: true, rate: 5 }),
  'restaurant:printJobs': ch(none, { session: true, rate: 10 }),
  'restaurant:printNow': ch(none, { session: true, rate: 2 }),
  'restaurant:printTest': ch(restaurantPrintTest, { session: true, rate: 2 }),
  'restaurant:printText': ch(restaurantPrintText, { session: true, rate: 3 }),
  'restaurant:openDrawer': ch(none, { session: true, rate: 1, sensitive: true }),

  /*
   * Office documents (shared/office.ts, electron/services/office-editor.ts): a tab lays the editor's
   * isolated view over its placeholder and talks to it; the session itself is the tab's, over the API.
   * The configuration is the server's signed one, passed through untouched; the main process loads an
   * editor only from a Document Server address it accepts (`documentServerOrigin`).
   */
  'office:open': ch(
    z.object({
      key: idString,
      fileId: driveId,
      sessionId: z.string().regex(/^[0-9a-f-]{36}$/),
      organizationId: z.string().max(64).nullable(),
      documentServerUrl: z.string().min(8).max(512),
      apiUrl: z.string().min(8).max(1024),
      config: z.record(z.string(), z.unknown()),
      events: z.array(z.enum(OFFICE_EDITOR_EVENTS)).max(OFFICE_EDITOR_EVENTS.length),
    }),
    { session: true, rate: 5 },
  ),
  'office:place': ch(
    z.object({
      viewId: z.string().uuid(),
      bounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().min(0).max(20_000), height: z.number().finite().min(0).max(20_000) }),
      visible: z.boolean(),
    }),
    { session: true, rate: 120 },
  ),
  /** A picture of the editor, shown in its place while a menu over it is open (worksuite-desktop#39). */
  'office:snapshot': ch(z.object({ viewId: z.string().uuid() }), { session: true, rate: 30 }),
  'office:command': ch(
    z.object({
      viewId: z.string().uuid(),
      command: officeCommandSchema,
      events: z.array(z.enum(OFFICE_EDITOR_EVENTS)).max(OFFICE_EDITOR_EVENTS.length).optional(),
      /** A reload on a new session (reopened, or a newer version): the view's session is that one now. */
      sessionId: z.string().regex(/^[0-9a-f-]{36}$/).optional(),
    }),
    { session: true, rate: 20 },
  ),
  'office:close': ch(z.object({ viewId: z.string().uuid() }), { session: true, rate: 20 }),
  'office:focusFile': ch(z.object({ fileId: driveId }), { session: true, rate: 10 }),
  'office:externalApps': ch(z.object({ extension: z.string().regex(/^[A-Za-z0-9]{0,10}$/) }), { session: true, rate: 10 }),
  'office:openExternal': ch(
    z.object({
      fileId: driveId,
      name: z.string().min(1).max(255),
      folderId: driveId.nullable(),
      version: z.number().int().min(0).max(2 ** 31),
      app: z.enum(['default', 'word', 'excel', 'powerpoint']),
    }),
    { session: true, rate: 3, sensitive: true },
  ),
  'office:localCopies': ch(none, { session: true }),
  'office:uploadLocal': ch(z.object({ id: z.string().uuid(), how: z.enum(['version', 'new_version', 'keep_both']) }), { session: true, rate: 3, sensitive: true }),
  'office:forgetLocal': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10 }),
  'office:revealLocal': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 5 }),
  /** Offline (OO-OFF-020): is this file on this computer — kept by Drive sync, or a copy opened in another app. */
  'office:localAvailable': ch(z.object({ fileId: driveId }), { session: true, rate: 10 }),
  'office:openLocal': ch(z.object({ fileId: driveId, preview: z.boolean().optional() }), { session: true, rate: 3 }),
  // WorkSuite DOC / Sheet / Slides on files from this computer (office-local.ts): handles only, never paths.
  'office:pickFile': ch(none, { session: true, rate: 5 }),
  'office:readFile': ch(z.strictObject({ handle: z.string().uuid() }), { session: true, rate: 20 }),
  'office:writeFile': ch(z.strictObject({ handle: z.string().uuid(), bytes: officeBytes }), { session: true, rate: 20, sensitive: true }),
  /**
   * A Drive file's copy on this computer (synced, or opened in another app) for editing offline in the built-in
   * editor; what is written there goes back to the Drive when WorkSuite is online again (sync, or the copy's upload).
   */
  'office:readOffline': ch(z.strictObject({ fileId: driveId }), { session: true, rate: 20 }),
  'office:writeOffline': ch(z.strictObject({ fileId: driveId, bytes: officeBytes }), { session: true, rate: 20, sensitive: true }),
  /** "Save a copy on this computer": the main process's save dialog, then the bytes where the person chose. */
  'office:saveCopy': ch(z.strictObject({ name: z.string().min(1).max(255).regex(/^[^/\\]+$/), bytes: officeBytes }), { session: true, rate: 10, sensitive: true }),

  'offline:status': ch(none, { session: true }),
  'offline:pending': ch(none, { session: true }),
  /** How much one app's saved answers take on this computer. */
  'offline:moduleBytes': ch(z.object({ module: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }), { session: true }),
  /** Remove one app's saved answers from this computer (Mail › Clear). */
  'offline:clearModule': ch(z.object({ module: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }), { session: true, sensitive: true, rate: 1 }),
  /** What Mail keeps on this computer, by kind and by mailbox (Settings › Mail). */
  'offline:mailStats': ch(none, { session: true }),
  'offline:submit': ch(mutationInputSchema, { session: true, rate: 20 }),
  'offline:retry': ch(z.object({ id: idString }), { session: true }),
  'offline:discard': ch(z.object({ id: idString }), { session: true }),
  'offline:saveDraft': ch(
    z.object({ module: z.string().max(64), context: z.string().max(256), content: z.unknown() }),
    { session: true, rate: 20 },
  ),
  'offline:getDraft': ch(z.object({ module: z.string().max(64), context: z.string().max(256) }), { session: true }),
  'offline:listDrafts': ch(z.object({ module: z.string().max(64).optional() }).optional(), { session: true }),
  'offline:deleteDraft': ch(z.object({ module: z.string().max(64), context: z.string().max(256) }), { session: true }),
  'offline:clearCache': ch(none, { session: true, sensitive: true, rate: 1 }),
  'offline:search': ch(z.object({ q: z.string().min(1).max(200) }), { session: true, rate: 10 }),

  'security:lock': ch(none, { session: true, whileLocked: true }),
  'security:unlockPassword': ch(z.object({ password: z.string().min(1).max(512) }), { whileLocked: true, rate: 1 }),
  'security:unlockBiometric': ch(none, { whileLocked: true, rate: 1 }),
  // A PIN for the app lock on this computer: setting one takes the WorkSuite password.
  'security:unlockPin': ch(z.strictObject({ pin: z.string().regex(/^\d{4,8}$/) }), { whileLocked: true, rate: 1 }),
  'security:setPin': ch(z.strictObject({ pin: z.string().regex(/^\d{4,8}$/), password: z.string().min(1).max(512) }), { session: true, sensitive: true, rate: 3 }),
  'security:clearPin': ch(z.strictObject({ password: z.string().min(1).max(512) }), { session: true, sensitive: true, rate: 3 }),
  'security:state': ch(none, { whileLocked: true }),
  'security:deviceInfo': ch(none, { session: true }),
  'security:activity': ch(none, { whileLocked: true, rate: 2 }),

  'updates:status': ch(none, { whileLocked: true }),
  'updates:check': ch(none, { whileLocked: true, rate: 1 }),
  'updates:installNow': ch(z.object({ force: z.boolean().optional() }).optional(), { whileLocked: true }),
  'updates:restartLater': ch(none),
  'updates:setChannel': ch(z.object({ channel: z.enum(['stable', 'beta', 'dev', 'org']) }), { session: true }),
  'updates:setActiveCall': ch(z.object({ active: z.boolean() }), { session: true }),
  'updates:busy': ch(none, { whileLocked: true }),

  'settings:get': ch(none, { whileLocked: true }),
  'settings:set': ch(preferencesPatchSchema.extend({ verificationPassword: z.string().min(1).max(512).optional() }), { sensitive: true, rate: 10 }),

  'status:snapshot': ch(none, { whileLocked: true }),

  'diagnostics:run': ch(none, { whileLocked: true, rate: 1 }),
  'diagnostics:previewBundle': ch(none, { permission: 'desktop.diagnostics.export', whileLocked: true, rate: 1 }),
  'diagnostics:saveBundle': ch(none, { permission: 'desktop.diagnostics.export', whileLocked: true, sensitive: true, rate: 1 }),
  'diagnostics:restartSafeMode': ch(z.object({ safe: z.boolean() }), { whileLocked: true }),
  'diagnostics:services': ch(none, { whileLocked: true }),

  // POS: the till on this computer — its credential stays in the main process (shared/pos.ts, pos-ipc.ts).
  ...posContract,
  ...pmsLocksContract,
} satisfies Record<InvokeChannel, ChannelSpec>;

export type Contract = typeof contract;
export type InputOf<C extends InvokeChannel> = z.input<Contract[C]['input']>;

export interface PickedFile {
  handle: string;
  name: string;
  size: number;
  /** For a file inside a chosen or dropped folder: "Photos/2026/IMG_1.jpg", the folder's own name first. */
  relativePath?: string;
}

export interface BundlePreview {
  files: Array<{ name: string; size: number; preview: string }>;
  redactions: number;
}

export interface OfflineStatus {
  pending: number;
  conflicts: number;
  failed: number;
  queueAllowed: boolean;
  reason: string | null;
  cacheBytes: number;
  cacheEntries: number;
}

export interface SubmitResult {
  delivered: boolean;
  queued: boolean;
  id: string | null;
  status: number | null;
  data: unknown;
  error: string | null;
  code: string | null;
}

export interface OfflineSearchResult {
  module: string;
  title: string;
  subtitle: string;
  route: string;
  cachedAt: string;
}

export interface LockState {
  locked: boolean;
  reason: 'timeout' | 'manual' | 'system' | null;
  since: string | null;
  biometric: 'touch-id' | null;
  /** A PIN is set for this person on this computer. */
  pin: boolean;
  /** Its number of digits, so the lock screen unlocks on the last one; null without a PIN, or until a PIN set before this was kept is next used. */
  pinLength: number | null;
  userName: string | null;
  userEmail: string | null;
  lockMinutes: number;
}

export interface WindowState {
  id: number;
  kind: string;
  maximized: boolean;
  alwaysOnTop: boolean;
  platform: string;
  /** Shrunk to a floating bar or card (call and meeting windows). */
  compact?: boolean;
  fullScreen?: boolean;
}

export interface Outputs extends PosOutputs, PmsLocksOutputs {
  'app:info': AppInfo;
  'app:quit': void;
  'app:relaunch': void;
  'app:openExternal': boolean;
  'app:openInBrowser': boolean;
  'app:setDockIcon': boolean;
  'local:enter': LocalStatus;
  'local:leave': void;
  'local:status': LocalStatus;
  'local:profile': LocalProfile;
  'local:unlock': { unlocked: boolean; retryAfter: number };
  'local:api': { status: number; data: unknown; message: string | null };
  'local:overview': LocalOverview;
  'local:export': { saved: boolean };
  'local:restorePreview': RestorePreview | null;
  'local:restore': { added: number; skipped: number };
  'local:deleteAll': void;
  'local:meeting': void;
  'local:joinMeeting': { id: number };
  'local:moveOffer': MoveOffer | null;
  'local:move': MoveResult;
  'local:keep': void;
  'guest:pending': { input: string; server?: string } | null;
  'guest:open': { id: number };
  'guest:info': GuestMeetInfo;
  'guest:join': GuestMeetToken;
  'guest:signIn': void;
  'auth:state': AuthState;
  'auth:setServer': AuthState;
  'auth:signIn': AuthState;
  'auth:verifyMfa': AuthState;
  'auth:cancelMfa': AuthState;
  'auth:passkeyStart': AuthState;
  'auth:passkeyCancel': AuthState;
  'auth:openPage': boolean;
  'hr:clock': { ok: true };
  'hr:break': { ok: true };
  'media:access': { granted: boolean };
  'media:screenSources': ScreenSources;
  'media:screenPick': void;
  'media:privacySettings': void;
  'calls:active': void;
  'calls:list': ActiveCall[];
  'meetrec:preflight': { folder: string; free: number | null; ok: boolean; why: string | null };
  'meetrec:start': { id: string };
  'meetrec:active': void;
  'meetrec:abort': void;
  'meetrec:chunk': void;
  'meetrec:stop': void;
  'meetrec:list': LocalRecording[];
  'meetrec:retry': void;
  'meetrec:discard': void;
  'meetrec:reveal': void;
  'meetrec:chooseFolder': string | null;
  'meetrec:open': boolean;
  'meetrec:downloads': Record<string, string>;
  'stt:status': SpeechStatus;
  'stt:chooseModel': SpeechStatus;
  'stt:removeModel': SpeechStatus;
  'stt:transcribe': { segments: SpeechSegment[] };
  'speech:ready': void;
  'speech:result': void;
  'rc:state': RemoteControlView;
  'rc:recheck': RemoteControlView;
  'rc:restart': void;
  'rc:setAllowRequests': RemoteControlView;
  'rc:shareStarted': { shareId: number; controlOffered: boolean; why: string | null };
  'rc:shareChanged': void;
  'rc:shareStopped': void;
  'rc:sharePaused': void;
  'rc:packet': void;
  'rc:consent': RemoteControlConsent;
  'rc:answer': { status: string; stepUp?: boolean; message?: string };
  'rc:pause': void;
  'rc:resume': void;
  'rc:stop': void;
  'rc:fileAnswer': { status: string; confirmExecutable?: boolean; message?: string };
  'rc:sendFile': { sent: number };
  'rc:takeFile': { status: string; confirmExecutable?: boolean; message?: string };
  'calls:focus': boolean;
  'auth:signOut': AuthState;
  'auth:completeSetup': AuthState;
  'auth:sessionId': { sid: number | null };
  'auth:changePassword': { outcome: 'renewed' | 'mfa' | 'later' };
  'auth:renewMfa': { renewed: true };
  'auth:renewCancel': void;
  'session:bootstrap': Bootstrap | null;
  'session:refresh': Bootstrap | null;
  'session:switchOrganization': { organizationId: string | null; closedTabs: number };
  'windows:open': { id: number };
  'windows:setAlwaysOnTop': boolean;
  'windows:setCompact': boolean;
  'windows:fitVideo': boolean;
  'windows:minimize': void;
  'windows:toggleMaximize': boolean;
  'windows:close': void;
  'windows:state': WindowState;
  'quickask:context': QuickAskContext & { shortcut: string | null };
  'quickask:open': void;
  'quickask:insert': boolean;
  'quickask:close': void;
  'quickask:handoff': void;
  'ai:rules': AiRules;
  'ai:localStatus': LocalAIStatus;
  'ai:localModels': LocalModelView[];
  'ai:localRefresh': void;
  /** Resolves when the download started (progress comes as `ai:localChanged`). */
  'ai:localInstall': void;
  'ai:localCancelInstall': void;
  'ai:localRemove': void;
  'ai:localSetDefault': void;
  'ai:localCheck': boolean;
  'ai:localTest': boolean;
  /** Resolves once the request is running; its text comes as `ai:localEvent`. */
  'ai:localAsk': void;
  'ai:localCancel': void;
  'ai:localRestart': void;
  /** Resolves with the text once it is read (its progress comes as `ai:ocrProgress`), or `cancelled`. */
  'ai:ocr': OcrResult;
  'ai:ocrCancel': void;
  'ai:ocrStatus': OcrStatus;
  'ai:confirm': unknown;
  'ai:upload': AiUpload | null;
  'ai:answerReady': boolean;
  'ring:state': WebchatRingState;
  'ring:join': boolean;
  'ring:silence': void;
  'ring:pass': boolean;
  'windows:detach': { id: number };
  'windows:dock': void;
  'windows:toMain': void;
  'windows:adopt': { route: string; title: string } | null;
  'windows:describe': void;
  'windows:restoreDetached': number;
  'tabs:save': void;
  'tabs:restore': { tabs: TabRecord[]; activeId: string | null; side: { id: string; split: number } | null; restored: boolean };
  'files:pickFiles': PickedFile[];
  'files:registerDropped': PickedFile[];
  'files:pickFolder': PickedFile[];
  'files:chooseDownloadFolder': string | null;
  'files:saveText': string | null;
  'transfers:list': Transfer[];
  'transfers:download': Transfer;
  'pms:download': Transfer;
  'transfers:upload': Transfer[];
  'transfers:prepareMedia': PickedFile & { preview?: string; mime?: string };
  'transfers:pause': void;
  'transfers:resume': void;
  'transfers:cancel': void;
  'transfers:retry': void;
  'transfers:open': boolean;
  'transfers:reveal': boolean;
  'transfers:clearFinished': void;
  'transfers:pauseAll': void;
  'transfers:resumeAll': void;
  'transfers:resetSettings': { preferences: Preferences; locks: PreferenceLock[] };
  'sync:status': SyncStatus;
  'sync:devices': { devices: SyncDevice[]; policy: SyncPolicy | null; thisDevice: number | null };
  'sync:deviceAction': void;
  /** null: the dialog was cancelled. */
  'sync:add': SyncStatus | null;
  'sync:remove': SyncStatus;
  'sync:setMode': SyncStatus;
  'sync:pause': SyncStatus;
  'sync:now': SyncStatus;
  'sync:resolve': SyncStatus;
  'sync:reveal': boolean;
  'sync:lookup': SyncLookup;
  'sync:reconnect': SyncStatus;
  'notifications:list': { items: NotificationItem[]; unread: number };
  'notifications:markRead': void;
  'notifications:markAllRead': void;
  'notifications:pause': { pausedUntil: string | null };
  'notifications:test': boolean;
  'notifications:permission': NotificationPermission;
  'notifications:refresh': void;
  'clipboard:readForPaste': { text: string | null; image: string | null; files: PickedFile[] };
  'print:print': boolean;
  'print:printers': Array<{ name: string; displayName: string; isDefault: boolean }>;
  'print:toPdf': string | null;
  'pdf:open': PdfSessionView;
  'pdf:state': PdfSessionView;
  'pdf:unlock': PdfSessionView;
  'pdf:retry': PdfSessionView;
  'pdf:close': void;
  'pdf:render': PdfBitmap;
  'pdf:thumbnail': PdfBitmap;
  'pdf:cancel': number;
  'pdf:search': { searchId: string };
  'pdf:searchCancel': void;
  'pdf:outline': PdfOutlineNode[];
  'pdf:links': PdfLinkView[];
  'pdf:followLink': { opened: boolean; reason: string | null };
  'pdf:attachments': PdfAttachmentView[];
  'pdf:details': PdfDriveDetails | null;
  'pdf:coverGet': Uint8Array | null;
  'pdf:coverPut': void;
  'pdf:print': { printed: boolean; pages: number; reason: string | null };
  'pdf:pickLocal': PdfLocalPick[];
  'pdf:registerDropped': { files: PdfLocalPick[]; rejected: Array<{ name: string; reason: string }> };
  'pdf:diagnostics': { checks: PdfDiagnosticCheck[]; failures: PdfFailureReport[] };
  'pdf:mode': PdfSessionView;
  'pdf:edit': PdfSessionView;
  'pdf:undo': PdfSessionView;
  'pdf:redo': PdfSessionView;
  'pdf:annotations': PdfAnnotView[];
  'pdf:textSpan': { rects: PdfRect[]; text: string };
  'pdf:save': PdfSessionView;
  'pdf:resolve': PdfSessionView;
  'pdf:discard': PdfSessionView;
  'pdf:extract': { saved: boolean; name: string | null };
  'salon:deskPairing': SalonDeskPairing | null;
  'salon:deskPair': { desk: SalonDeskInfo; message: string | null };
  'salon:deskForget': void;
  'salon:printSettings': SalonPrintSettings;
  'salon:printSettingsSet': SalonPrintSettings;
  'salon:printReceipt': SalonPrintOutcome;
  'salon:printTest': SalonPrintOutcome;
  'salon:printPage': SalonPrintOutcome;
  'salon:openDrawer': SalonPrintOutcome;
  'salon:syncStatus': SalonSyncStatus;
  'salon:syncNow': SalonSyncStatus;
  'salon:copy': SalonCopy | null;
  'salon:copyClients': SalonCopyClient[];
  'salon:outbox': SalonOutboxItem[];
  'salon:outboxAdd': SalonOutboxItem;
  'salon:outboxResolve': SalonOutboxItem[];
  'elearning:offlineList': OfflineCourse[];
  'elearning:offlineDownload': OfflineCourse;
  'elearning:offlineRemove': void;
  'elearning:offlineValidate': OfflineValidation;
  'eventdesk:list': DeskRegistration[];
  'eventdesk:status': DeskStatus;
  'eventdesk:register': { registration: DeskRegistration; message: string; reregistered: boolean };
  'eventdesk:rotateKey': { message: string };
  'eventdesk:forget': number;
  'eventdesk:sync': DeskStatus;
  'eventdesk:scan': DeskScanOutcome;
  'eventdesk:search': DeskSearchHit[];
  'eventdesk:queue': DeskQueueItem[];
  'eventdesk:queueResolve': DeskQueueItem[];
  'eventdesk:walkIn': { provisional_number: string; message: string };
  'eventdesk:printSettings': DeskPrintSettings;
  'eventdesk:printSettingsSet': DeskPrintSettings;
  'eventdesk:printJobs': DeskPrintOutcome;
  'restaurant:pairing': RestaurantPairing | null;
  'restaurant:pair': { pairing: RestaurantPairing; message: string };
  'restaurant:unpair': { revoked: boolean; message: string | null; dropped: number };
  'restaurant:status': RestaurantStatus;
  'restaurant:syncNow': RestaurantStatus;
  'restaurant:copy': RestaurantCopy | null;
  'restaurant:outbox': RestaurantOutboxItem[];
  'restaurant:outboxAdd': RestaurantOutboxItem;
  'restaurant:outboxResolve': RestaurantOutboxItem[];
  'restaurant:printSettings': RestaurantPrintSettings;
  'restaurant:printSettingsSet': RestaurantPrintSettings;
  'restaurant:printJobs': RestaurantPrintJobLog[];
  'restaurant:printNow': number;
  'restaurant:printTest': RestaurantPrintOutcome;
  'restaurant:printText': RestaurantPrintOutcome;
  'restaurant:openDrawer': RestaurantPrintOutcome;
  'office:open': { viewId: string };
  'office:place': boolean;
  'office:snapshot': string | null;
  'office:command': boolean;
  'office:close': boolean;
  'office:focusFile': boolean;
  'office:externalApps': ExternalApp[];
  'office:openExternal': OfficeLocalCopy;
  'office:localCopies': OfficeLocalCopy[];
  'office:uploadLocal': { state: 'uploaded'; version: number | null } | { state: 'conflict'; conflict: NonNullable<OfficeLocalCopy['conflict']> } | { state: 'queued' };
  'office:forgetLocal': boolean;
  'office:revealLocal': boolean;
  'office:localAvailable': { available: boolean; synced: boolean; preview: boolean; openInApp: boolean };
  'office:openLocal': boolean;
  'office:pickFile': OfficeLocalPick[];
  'office:readFile': Uint8Array;
  'office:writeFile': { size: number };
  'office:readOffline': Uint8Array;
  'office:writeOffline': { size: number; synced: boolean };
  /** null: the dialog was cancelled. */
  'office:saveCopy': { name: string } | null;
  'offline:status': OfflineStatus;
  'offline:pending': OfflineMutation[];
  'offline:moduleBytes': number;
  'offline:clearModule': number;
  'offline:mailStats': MailStoreStats;
  'offline:submit': SubmitResult;
  'offline:retry': void;
  'offline:discard': void;
  'offline:saveDraft': Draft;
  'offline:getDraft': Draft | null;
  'offline:listDrafts': Draft[];
  'offline:deleteDraft': void;
  'offline:search': OfflineSearchResult[];
  'offline:clearCache': number;
  'security:lock': LockState;
  'security:unlockPassword': { ok: boolean; message: string | null };
  'security:unlockBiometric': { ok: boolean; message: string | null };
  'security:unlockPin': { ok: boolean; message: string | null };
  'security:setPin': { ok: boolean; message: string | null };
  'security:clearPin': LockState;
  'security:state': LockState;
  'security:deviceInfo': DeviceInfo;
  'security:activity': void;
  'updates:status': UpdateStatus;
  'updates:check': UpdateStatus;
  'updates:installNow': { started: boolean; busy: BusyReport | null; message: string | null };
  'updates:restartLater': UpdateStatus;
  'updates:setChannel': UpdateStatus;
  'updates:setActiveCall': void;
  'updates:busy': BusyReport;
  'settings:get': { preferences: Preferences; locks: PreferenceLock[] };
  'settings:set': { preferences: Preferences; locks: PreferenceLock[] };
  'status:snapshot': StatusSnapshot;
  'diagnostics:run': DiagnosticCheck[];
  'diagnostics:previewBundle': BundlePreview;
  'diagnostics:saveBundle': string | null;
  'diagnostics:restartSafeMode': void;
  'diagnostics:services': Record<string, ServiceHealth>;
}

/** Typed error codes returned across IPC (§8.3 plus IPC-specific ones). */
export type DesktopErrorCode =
  | 'IPC_UNKNOWN_CHANNEL'
  | 'IPC_VALIDATION_FAILED'
  | 'IPC_FORBIDDEN_SENDER'
  | 'IPC_RATE_LIMITED'
  | 'APP_LOCKED'
  | 'NOT_SIGNED_IN'
  | 'PERMISSION_DENIED'
  | 'POLICY_DENIED'
  | 'NETWORK_UNREACHABLE'
  | 'TLS_ERROR'
  | 'NOT_WORKSUITE'
  | 'INVALID_CREDENTIALS'
  | 'MFA_INVALID'
  | 'PASSKEY_FAILED'
  | 'SESSION_EXPIRED'
  | 'DEVICE_REVOKED'
  | 'DEVICE_NOT_REGISTERED'
  | 'DEVICE_LIMIT'
  | 'DESKTOP_ACCESS_DISABLED'
  | 'VERSION_UNSUPPORTED'
  | 'ORG_ACCESS_DENIED'
  | 'APP_ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FILE_LOCKED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'CANCELLED'
  | 'UNSUPPORTED'
  | 'INTERNAL';

export interface IpcFailure {
  __wsError: true;
  code: DesktopErrorCode;
  message: string;
}

export function isIpcFailure(v: unknown): v is IpcFailure {
  return typeof v === 'object' && v !== null && (v as { __wsError?: unknown }).__wsError === true;
}
