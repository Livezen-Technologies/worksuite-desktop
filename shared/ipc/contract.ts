import { z } from 'zod';
import { localRequestSchema, type LocalAIStatus, type LocalModelView } from '../local-ai';
import { ocrRequestSchema, type OcrResult, type OcrStatus } from '../ocr';
import { projectsContract, type ProjectsOutputs } from '../projects';
import { elearningDownloadInput, elearningCourseRef, type OfflineCourse, type OfflineValidation } from '../elearning-offline';
import { pmsDownloadInput } from '../pms-files';
import { SETTING_KEY_PATTERN, type DesktopSettingsView } from '../desktop-settings';
import { posContract, type PosOutputs } from '../pos';
import { phoneContract, type PhoneOutputs } from '../phone';
import { pmsLocksContract, type PmsLocksOutputs } from '../pms-locks';
import { contactSyncContract, type ContactSyncOutputs } from '../contact-sync';
import { boardContract, type BoardOutputs } from '../board';
import { salesContract, type SalesOutputs } from '../sales';
import { labelContract, type LabelOutputs } from '../label';
import { chequeContract, type ChequeOutputs } from '../cheque';
import { sinhalaContract, type SinhalaOutputs } from '../sinhala';
import { accountsContract, type AccountsOutputs, type ServiceHealthState } from '../accounts';
import type { InvokeChannel } from './channels';
import type { ButtonLayout } from '../window-controls';
import type { AppInfo, AuthState, ScreenSources, DiagnosticCheck, Bootstrap, AiRules, AiUpload, Transfer, Preferences, PreferenceLock, NotificationItem, NotificationPermission, WallDisplay, DeviceInfo, UpdateStatus, BusyReport, UpdateDiagnostics, StatusSnapshot, ServiceHealth } from '../types';
import type { MeetPermissionRow } from '../meet-permissions';
import type { ConnectionDetails, SpeedTestResult } from '../connection';
import { ch, none, route, localModelId, tabRecordSchema, idString, preferencesPatchSchema, launcherAppId, hexColour, type ChannelSpec, type TabRecord } from './contract-kit';
import { transfersContract, type TransfersOutputs } from './contract-transfers';
import { documentsContract, type DocumentsOutputs } from './contract-documents';
import { remoteControlContract, type RemoteControlOutputs } from './contract-remote-control';
import { meetContract, type MeetOutputs } from './contract-meet';
import { desksContract, type DesksOutputs } from './contract-desks';
import { offlineContract, type OfflineOutputs } from './contract-offline';
import { ringingContract, type RingingOutputs } from './contract-ringing';
import { mailContract, type MailOutputs } from './contract-mail';

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

// The shared schemas and `ch` are in contract-kit.ts, the channels by area in contract-*.ts (audit D-G13).
export { tabRecordSchema, type TabRecord, preferencesPatchSchema, mutationInputSchema, type MutationInput, uploadTargetSchema, type UploadTarget } from './contract-kit';

export const contract = {
  'app:info': ch(none, { whileLocked: true }),
  'app:quit': ch(none, { whileLocked: true }),
  'app:relaunch': ch(none, { whileLocked: true }),
  'app:openExternal': ch(z.object({ url: z.string().url().max(2048) }), { rate: 5 }),
  'app:openInBrowser': ch(z.object({ path: z.string().regex(/^\/[A-Za-z0-9/_\-.?=&]*$/).max(512) }), { session: true, rate: 5 }),
  // An item link opened (#170): written to the audit outbox and sent to the server's audit trail — the item, the
  // action and where the link was found; never the link itself.
  'links:audit': ch(
    z.object({
      org: z.string().regex(/^[1-9]\d{0,11}$/),
      type: z.string().regex(/^[a-z]{2,16}$/),
      id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
      action: z.string().regex(/^[a-z-]{2,20}$/),
      source: z.enum(['email', 'chat', 'notification', 'external']),
      outcome: z.enum(['opened', 'confirmed', 'cancelled', 'refused', 'offline']),
    }),
    { session: true, rate: 20 },
  ),
  /** macOS: the Dock icon with the unread count painted on (the renderer draws it; see core/dock-badge). */
  'app:setDockIcon': ch(z.object({ png: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(4_000_000) }), { whileLocked: true, rate: 30 }),
  /** Windows: the taskbar's overlay icon with the unread count (MNA-TRY-03), painted by the renderer; null clears it. */
  'app:setOverlayIcon': ch(z.object({ png: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(200_000).nullable(), description: z.string().max(120) }), { whileLocked: true, rate: 30 }),
  ...offlineContract,
  'auth:state': ch(none, { whileLocked: true }),
  'auth:setServer': ch(z.object({ url: z.string().min(3).max(512) }), { rate: 2 }),
  'auth:signIn': ch(z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(512) }), { rate: 2 }),
  'auth:verifyMfa': ch(z.object({ code: z.string().regex(/^[A-Za-z0-9-]{4,32}$/), remember: z.boolean().optional() }), { rate: 2 }),
  'auth:cancelMfa': ch(none),
  // A new computer's emailed code, another code, the CAPTCHA window, the emailed unblock link (worksuite-desktop#301).
  'auth:verifyDevice': ch(z.object({ code: z.string().regex(/^\d{6}$/), remember: z.boolean() }), { rate: 2 }),
  'auth:resendDevice': ch(none, { rate: 2 }),
  'auth:solveCaptcha': ch(none, { rate: 2 }),
  'auth:requestUnblock': ch(z.object({ email: z.string().min(1).max(254) }), { rate: 2 }),
  'auth:clearGate': ch(none),
  // Opens the server's passkey page in the browser; the result returns through worksuite://auth/callback.
  'auth:passkeyStart': ch(none, { rate: 2 }),
  /** WorkSuite OS mode: sign in through the OS credentials broker (the system browser), never a password. */
  'auth:osSignIn': ch(none, { rate: 2 }),
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
      kind: z.enum(['chat-mini', 'timer', 'agenda', 'record', 'call', 'video-call', 'ring', 'meet', 'phone', 'support-quick']),
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
  ...ringingContract,
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
  // Levels 4–5 (Q-01): the typed phrase the card names and, when asked, an authenticator code (step-up).
  'ai:confirm': ch(
    z.object({
      id: z.number().int().positive(),
      nonce: z.string().regex(/^[a-f0-9]{16,64}$/),
      phrase: z.string().max(40).optional(),
      stepUpCode: z.string().regex(/^\d{6,8}$/).optional(),
    }),
    { session: true, sensitive: true, rate: 5 },
  ),
  'ai:upload': ch(none, { session: true, rate: 3 }),
  /** An answer arrived while the assistant was minimised and the window is not in front (#126): a banner, as notifications allow. */
  // An online question, streamed in the main process (G-22): deltas come as `ai:askDelta` {id, text}.
  'ai:ask': ch(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/), body: z.record(z.string(), z.unknown()) }), { session: true, rate: 30 }),
  'ai:answerReady': ch(z.strictObject({ kind: z.enum(['ready', 'input', 'failed']), preview: z.string().max(300) }), { session: true, rate: 20 }),
  // Website chats over realtime (plan 2.7, 2.9): a thread a window shows is heard on its own channels; what it has and
  // shows is acknowledged by seq, in batches.
  'realtime:watch': ch(z.strictObject({ conversationId: z.number().int().positive(), on: z.boolean() }), { session: true, rate: 60 }),
  'realtime:receipt': ch(
    z.strictObject({ conversationId: z.number().int().positive(), deliveredSeq: z.number().int().positive().optional(), readSeq: z.number().int().positive().optional(), delivered: z.number().int().positive().optional(), read: z.number().int().positive().optional() }),
    { session: true, rate: 60 },
  ),
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
  ...transfersContract,
  /** Payroll (docs/payroll-api.md): the OS's own check (Touch ID) before approving a run, where there is one (D07). */
  'payroll:verify': ch(z.strictObject({ reason: z.string().min(1).max(120) }), { session: true, rate: 2, sensitive: true }),
  /**
   * Payroll: a bank or return file the server produced (`POST payouts/{id}/file`), saved where the person chooses.
   * The main process checks the bytes against the server's SHA-256 before writing, and writes the file 0600 (D10).
   */
  'payroll:saveFile': ch(
    z.strictObject({ name: z.string().regex(/^[A-Za-z0-9 ._()-]{1,120}$/), base64: z.string().max(40_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/i) }),
    { session: true, permission: 'desktop.downloads', sensitive: true, rate: 5 },
  ),
  /**
   * Assets (D21): a register file chosen in the system's open dialog and read here, so nothing leaves the computer
   * until the person imports. CSV or tab-separated text only, at most 5 MB; null when the person cancelled.
   */
  'assets:openFile': ch(z.strictObject({ title: z.string().max(100).optional() }), { session: true, rate: 2 }),

  'media:access': ch(z.object({ kind: z.enum(['microphone', 'camera']) }), { session: true, rate: 5 }),
  'media:screenIndicator': ch(z.object({ active: z.boolean() }), { session: true, rate: 12 }),
  'media:screenSources': ch(none, { session: true, rate: 3 }),
  'media:screenPick': ch(z.object({ id: z.string().min(1).max(200), audio: z.boolean().optional() }), { session: true, rate: 6 }),
  // Whether this computer runs on its battery (WS-MEET-ENH-01 D05): what the
  // camera sends while it does is a preference.
  'media:power': ch(none, { session: true, rate: 6 }),
  ...meetContract,
  // The five rows of Settings › Meet › System permissions (WS-MEET-ENH-01 D05).
  'media:permissions': ch(none, { session: true, whileLocked: true, rate: 6 }),
  'media:privacySettings': ch(z.object({ pane: z.enum(['microphone', 'camera', 'screen', 'accessibility']) }), { session: true, rate: 2 }),
  ...remoteControlContract,
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
  /**
   * Hotel PMS: a guest's document or a report's export through the download manager (shared/pms-files.ts). The
   * main process builds the address, refuses without `desktop.downloads` (here and in the handler) and audits it.
   */
  'pms:download': ch(pmsDownloadInput, { session: true, permission: 'desktop.downloads', sensitive: true, rate: 10 }),
  ...documentsContract,

  'notifications:context': ch(z.object({ viewing: z.string().max(160) }), { session: true, rate: 30 }),
  'notifications:list': ch(none, { session: true }),
  'notifications:markRead': ch(z.object({ ids: z.array(idString).min(1).max(200) }), { session: true }),
  'notifications:markAllRead': ch(none, { session: true }),
  'notifications:pause': ch(z.object({ minutes: z.number().int().min(0).max(60 * 24 * 7).nullable() }), { session: true }),
  'notifications:test': ch(none, { session: true, rate: 1 }),
  'notifications:reminder': ch(
    z.strictObject({
      id: z.string().regex(/^[A-Za-z0-9:._\-/ ]{1,200}$/),
      title: z.string().max(200),
      body: z.string().max(300),
      // Mail's and Calendar's reminders; CRM's "customer is reading" alert (CRM SRS v1.3 §17).
      route: z.string().regex(/^\/(mail|calendar|crm)\?[A-Za-z0-9%=&._\-:]{1,400}$/),
      flag: z.strictObject({ mailbox: z.number().int().min(0), folder: z.string().regex(/^[A-Za-z0-9._\-/ :]{1,128}$/), uid: z.string().regex(/^\d{1,20}$/) }).optional(),
    }),
    { session: true, rate: 5 },
  ),
  'notifications:permission': ch(none, { session: true }),
  /** The operating system's notification settings for WorkSuite (#251): the banner's Open System Settings. */
  'notifications:openSettings': ch(none, { session: true, rate: 4 }),
  /** The bell's count again, now: after the notification centre read, snoozed or archived something. */
  'notifications:refresh': ch(none, { session: true, rate: 10 }),
  ...mailContract,

  'clipboard:readForPaste': ch(none, { session: true, rate: 5 }),
  ...desksContract,

  /*
   * eLearning's offline copies (shared/elearning-offline.ts): the course's files, as the server's download
   * manifest lists them, kept encrypted in the profile and played only inside WorkSuite; removed when the
   * server says the learning ended, when the licence runs out, or on request.
   */
  'elearning:offlineList': ch(none, { session: true }),
  'elearning:offlineDownload': ch(elearningDownloadInput, { session: true, rate: 2 }),
  'elearning:offlineRemove': ch(elearningCourseRef, { session: true, rate: 5 }),
  'elearning:offlineValidate': ch(none, { session: true, rate: 1 }),
  // Contact Support (D-11): a picture of the asking window, and the last day's redacted log — shown before they go.
  'support:displays': ch(none, { session: true }),
  'support:wall': ch(z.object({ displayId: z.number().int().nullable() }), { session: true, rate: 10 }),
  'support:wallClose': ch(none, { session: true }),
  'help:capture': ch(none, { session: true, rate: 5 }),
  'help:logs': ch(none, { session: true, rate: 10 }),

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
  'updates:download': ch(none, { whileLocked: true, rate: 1 }),
  'updates:restartLater': ch(none),
  // A less stable channel needs `confirmed` (Settings asks first); the organisation's policy limits the choice (#205).
  'updates:setChannel': ch(z.object({ channel: z.enum(['stable', 'beta', 'dev', 'org']), confirmed: z.boolean().optional() })),
  'updates:setActiveCall': ch(z.object({ active: z.boolean() }), { session: true }),
  'updates:busy': ch(none, { whileLocked: true }),
  'updates:later': ch(z.object({ choice: z.enum(['hour', 'four-hours', 'tomorrow', 'tonight', 'next-launch']) })),
  // Settings › Updates: the download's Pause, Resume and Cancel (it resumes with HTTP Range).
  'updates:pauseDownload': ch(none, { whileLocked: true }),
  'updates:resumeDownload': ch(none, { whileLocked: true, rate: 2 }),
  'updates:cancelDownload': ch(none, { whileLocked: true }),
  // The Update Ready dialog: restart as soon as nothing would be interrupted.
  'updates:installWhenFree': ch(none, { whileLocked: true }),
  // Settings › Updates › Diagnostics: run the checks, and save the report.
  'updates:diagnostics': ch(none, { whileLocked: true, rate: 1 }),
  'updates:exportDiagnostics': ch(z.object({ report: z.string().max(100_000) }), { whileLocked: true, rate: 1 }),
  // Diagnostics › Fix for the package repository checks (worksuite-desktop#351): rewrites the source and key via pkexec.
  'updates:fixRepo': ch(none, { rate: 1 }),
  'updates:reinstall': ch(none, { rate: 1 }),
  'updates:dismissNotice': ch(none),
  // A window saved its drafts and tabs before an update's restart (`update:prepare`).
  'updates:prepared': ch(z.object({ token: z.string().regex(/^[a-z0-9]{1,40}$/) }), { whileLocked: true }),

  'settings:get': ch(none, { whileLocked: true }),
  'settings:set': ch(preferencesPatchSchema.extend({ verificationPassword: z.string().min(1).max(512).optional() }), { sensitive: true, rate: 10 }),
  // Desktop settings (shared/desktop-settings.ts): what takes effect, and the person's choices — a managed key is refused.
  'desktopSettings:get': ch(none, { whileLocked: true }),
  'desktopSettings:set': ch(
    z.object({
      values: z
        .record(z.string().regex(SETTING_KEY_PATTERN), z.union([z.boolean(), z.number().finite(), z.string().max(300), z.null()]))
        .refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 200),
    }),
    { sensitive: true, rate: 20 },
  ),
  'desktopSettings:refresh': ch(none, { rate: 5 }),
  // The organization's app launcher defaults (#201): two keys of its desktop policy, for whoever may set that policy.
  'settings:launcherDefaults': ch(
    z.object({ organizationId: z.string().regex(/^\d{1,12}$/), pinned: z.array(launcherAppId).max(8), order: z.array(launcherAppId).max(300) }),
    { permission: 'desktop.policies.manage', session: true, sensitive: true, rate: 5 },
  ),

  // The organization's colour profile (#234): four keys of its desktop policy, for whoever may set that policy.
  'settings:appearanceDefaults': ch(
    z.object({
      organizationId: z.string().regex(/^\d{1,12}$/),
      accent: hexColour.nullable(),
      tint: z.enum(['neutral', 'accent', 'custom']),
      tintColor: hexColour.nullable(),
      locked: z.boolean(),
    }),
    { permission: 'desktop.policies.manage', session: true, sensitive: true, rate: 5 },
  ),

  'status:snapshot': ch(none, { whileLocked: true }),

  'diagnostics:run': ch(none, { whileLocked: true, rate: 1 }),
  'diagnostics:previewBundle': ch(none, { permission: 'desktop.diagnostics.export', whileLocked: true, rate: 1 }),
  'diagnostics:saveBundle': ch(none, { permission: 'desktop.diagnostics.export', whileLocked: true, sensitive: true, rate: 1 }),
  'diagnostics:restartSafeMode': ch(z.object({ safe: z.boolean() }), { whileLocked: true }),
  'diagnostics:services': ch(none, { whileLocked: true }),
  // Request, server and render times from the screens (worksuite-desktop#252), kept for the report's timings.json.
  'diagnostics:timings': ch(
    z.object({
      entries: z
        .array(
          z.object({
            what: z.string().regex(/^[a-z][a-z0-9:_-]{0,39}$/),
            at: z.string().max(40),
            ms: z.number().min(0).max(3_600_000),
            rows: z.number().int().min(0).max(1_000_000).nullable(),
            server: z.object({ ms: z.number(), db_ms: z.number(), queries: z.number().int(), rows: z.number().int() }).nullable(),
            render_ms: z.number().min(0).max(3_600_000).nullable().optional(),
            ok: z.boolean(),
          }),
        )
        .max(50),
    }),
    { whileLocked: true, rate: 2 },
  ),

  // Connection strength's popover (worksuite-desktop#254): the server's clock, a light speed test, Reconnect now.
  'connection:details': ch(none, { session: true, rate: 2 }),
  'connection:speedTest': ch(none, { session: true, rate: 1 }),
  'connection:reconnect': ch(none, { session: true, rate: 1 }),
  /** Work Offline on the service banner: writes queue, nothing is tried on the network until it is turned off. */
  'connection:workOffline': ch(z.strictObject({ on: z.boolean() })),
  /** The QR scan dialog is open (the camera may be used by the shell) or closed. */
  'connect:scanCamera': ch(z.strictObject({ open: z.boolean() })),

  // POS: the till on this computer — its credential stays in the main process (shared/pos.ts, pos-ipc.ts).
  ...posContract,
  // The Phone: what its page cannot do for itself (shared/phone.ts, electron/services/phone.ts).
  ...phoneContract,
  ...pmsLocksContract,
  ...contactSyncContract,
  // WorkSuite Projects: the tray timer and the offline outbox (shared/projects.ts, electron/services/projects).
  ...projectsContract,
  // WorkSuite Board: the encrypted offline pack vault (shared/board.ts, electron/services/board-vault.ts).
  ...boardContract,
  // WorkSuite Sales: approvals from a banner, printing on this computer, reports as PDF (shared/sales.ts, electron/services/sales-desk.ts).
  ...salesContract,
  // Label Studio: the print host's four calls, D04/D05 and the Print Gateway (shared/label.ts, electron/services/label/).
  ...labelContract,
  ...chequeContract,
  // Sinhala Tools: the engine, profile cache, fonts and clipboard on this computer (shared/sinhala.ts, electron/services/sinhala.ts).
  ...sinhalaContract,
  // Accounts side by side, connect, browser sign-in and WorkSuite Cloud (shared/accounts.ts, electron/main/accounts-wiring.ts).
  ...accountsContract,
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
  /**
   * Linux: the title bar draws the window's buttons itself (#409), in the desktop's order and on its side. Absent
   * where the system draws them (macOS traffic lights, the Windows overlay) or the window has none.
   */
  buttonLayout?: ButtonLayout;
}

export interface Outputs extends PosOutputs, PhoneOutputs, PmsLocksOutputs, ContactSyncOutputs, ProjectsOutputs, BoardOutputs, SalesOutputs, LabelOutputs, SinhalaOutputs, AccountsOutputs, ChequeOutputs, MailOutputs, RingingOutputs, OfflineOutputs, DesksOutputs, MeetOutputs, RemoteControlOutputs, DocumentsOutputs, TransfersOutputs {
  'app:info': AppInfo;
  'app:quit': void;
  'app:relaunch': void;
  'app:openExternal': boolean;
  'app:openInBrowser': boolean;
  'links:audit': void;
  'app:setDockIcon': boolean;
  'app:setOverlayIcon': boolean;
  'auth:state': AuthState;
  'auth:setServer': AuthState;
  'auth:signIn': AuthState;
  'auth:verifyMfa': AuthState;
  'auth:cancelMfa': AuthState;
  'auth:verifyDevice': AuthState;
  'auth:resendDevice': AuthState;
  'auth:solveCaptcha': AuthState;
  'auth:requestUnblock': { message: string };
  'auth:clearGate': AuthState;
  'auth:passkeyStart': AuthState;
  'auth:osSignIn': AuthState;
  'auth:passkeyCancel': AuthState;
  'auth:openPage': boolean;
  'hr:clock': { ok: true };
  'hr:break': { ok: true };
  'media:access': { granted: boolean };
  'media:permissions': { rows: MeetPermissionRow[] };
  'media:power': { onBattery: boolean };
  'media:screenIndicator': void;
  'media:screenSources': ScreenSources;
  'media:screenPick': void;
  'media:privacySettings': void;
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
  'ai:ask': unknown;
  'realtime:watch': void;
  'realtime:receipt': void;
  'windows:detach': { id: number };
  'windows:dock': void;
  'windows:toMain': void;
  'windows:adopt': { route: string; title: string } | null;
  'windows:describe': void;
  'windows:restoreDetached': number;
  'tabs:save': void;
  'tabs:restore': { tabs: TabRecord[]; activeId: string | null; side: { id: string; split: number } | null; restored: boolean };
  'payroll:verify': { verified: boolean; method: 'touch-id' | 'none' };
  /** The path written, or null when the person cancelled. */
  'payroll:saveFile': string | null;
  /** The chosen file's name, folder and text, or null when cancelled. */
  'assets:openFile': { name: string; folder: string; text: string } | null;
  'pms:download': Transfer;
  'notifications:context': void;
  'notifications:list': { items: NotificationItem[]; unread: number };
  'notifications:markRead': void;
  'notifications:markAllRead': void;
  'notifications:pause': { pausedUntil: string | null };
  'notifications:test': boolean;
  'notifications:reminder': void;
  'notifications:permission': NotificationPermission;
  'notifications:openSettings': boolean;
  'notifications:refresh': void;
  'clipboard:readForPaste': { text: string | null; image: string | null; files: PickedFile[] };
  'elearning:offlineList': OfflineCourse[];
  'elearning:offlineDownload': OfflineCourse;
  'elearning:offlineRemove': void;
  'elearning:offlineValidate': OfflineValidation;
  'support:displays': { displays: WallDisplay[]; open: boolean };
  'support:wall': void;
  'support:wallClose': void;
  'help:capture': { name: string; data: string; width: number; height: number };
  'help:logs': { text: string; lines: number; bytes: number };
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
  'updates:download': UpdateStatus;
  'updates:restartLater': UpdateStatus;
  'updates:setChannel': UpdateStatus;
  'updates:setActiveCall': void;
  'updates:busy': BusyReport;
  'updates:later': UpdateStatus;
  'updates:reinstall': UpdateStatus;
  'updates:dismissNotice': UpdateStatus;
  'updates:prepared': void;
  'updates:pauseDownload': UpdateStatus;
  'updates:resumeDownload': UpdateStatus;
  'updates:cancelDownload': UpdateStatus;
  'updates:installWhenFree': UpdateStatus;
  'updates:diagnostics': UpdateDiagnostics;
  'updates:exportDiagnostics': string | null;
  'updates:fixRepo': { ok: boolean; message: string };
  'settings:get': { preferences: Preferences; locks: PreferenceLock[] };
  'settings:set': { preferences: Preferences; locks: PreferenceLock[] };
  'settings:launcherDefaults': { pinned: string[]; order: string[] };
  'desktopSettings:get': DesktopSettingsView;
  'desktopSettings:set': DesktopSettingsView;
  'desktopSettings:refresh': DesktopSettingsView;
  'settings:appearanceDefaults': { accent: string | null; tint: 'neutral' | 'accent' | 'custom'; tintColor: string | null; locked: boolean };
  'status:snapshot': StatusSnapshot;
  'diagnostics:run': DiagnosticCheck[];
  'diagnostics:previewBundle': BundlePreview;
  'diagnostics:saveBundle': string | null;
  'diagnostics:restartSafeMode': void;
  'diagnostics:services': Record<string, ServiceHealth>;
  'diagnostics:timings': void;
  'connection:details': ConnectionDetails;
  'connection:speedTest': SpeedTestResult;
  'connection:reconnect': void;
  'connection:workOffline': ServiceHealthState;
  'connect:scanCamera': void;
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
  /** Board (FR-DEV-03): an administrator blocked this device; its Board offline vault is wiped. */
  | 'DEVICE_BLOCKED'
  | 'DEVICE_NOT_REGISTERED'
  | 'DEVICE_LIMIT'
  | 'DESKTOP_ACCESS_DISABLED'
  | 'VERSION_UNSUPPORTED'
  | 'UPDATE_REQUIRED'
  | 'ORG_ACCESS_DENIED'
  | 'APP_ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FILE_LOCKED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'CANCELLED'
  | 'UNSUPPORTED'
  | 'INTERNAL'
  // Connection & Startup: accounts side by side and WorkSuite Cloud.
  /** An account switch refused: a call, meeting, screen share or remote control is on. */
  | 'SWITCH_BLOCKED'
  /** The account's storage is full (Cloud gateway, at upload create / new version). */
  | 'QUOTA_EXCEEDED'
  /** The Cloud organization is suspended: `/me` is fetched again. */
  | 'ORG_SUSPENDED'
  /** The Cloud organization named in X-WS-Org does not exist (any more). */
  | 'ORG_NOT_FOUND'
  | 'SERVER_TOO_OLD'
  | 'CLOUD_UNAVAILABLE'
  | 'PERSONAL_NOT_ALLOWED'
  | 'ACCOUNT_EXISTS'
  | 'TLS_UNTRUSTED'
  /** `connect:parseSetup`: a setup link that is malformed or not signed by its server / one past its expiry. */
  | 'SETUP_LINK_INVALID'
  | 'SETUP_LINK_EXPIRED';

export interface IpcFailure {
  __wsError: true;
  code: DesktopErrorCode;
  message: string;
}

export function isIpcFailure(v: unknown): v is IpcFailure {
  return typeof v === 'object' && v !== null && (v as { __wsError?: unknown }).__wsError === true;
}
