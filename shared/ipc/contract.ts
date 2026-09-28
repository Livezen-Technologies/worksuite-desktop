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
import type { InvokeChannel } from './channels';
import type {
  ActiveCall,
  AppInfo,
  AuthState,
  Bootstrap,
  BusyReport,
  DeviceInfo,
  DiagnosticCheck,
  Draft,
  NotificationItem,
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
  Transfer,
  UpdateStatus,
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

export const preferencesPatchSchema = z
  .object({
    startWithOs: z.boolean(),
    startMinimized: z.boolean(),
    minimizeToTray: z.boolean(),
    restoreTabs: z.boolean(),
    theme: z.enum(['system', 'light', 'dark']),
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
    appLockMinutes: z.union([z.literal(0), z.literal(1), z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
    lockOnSystemLock: z.boolean(),
    openFilesLocally: z.enum(['ask', 'always', 'never']),
    mailCacheDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]),
    tabSuspendMinutes: z.number().int().min(5).max(480),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    updateChannel: z.enum(['stable', 'beta', 'dev', 'org']),
    sidebarMode: z.enum(['expanded', 'collapsed', 'auto-hide']),
    pinnedApps: z.array(z.string().max(64)).max(64),
    shortcuts: z.record(z.string().max(64), z.string().max(64)),
    backgroundServices: z.object({ notifications: z.boolean(), realtime: z.boolean() }),
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
  z.object({ kind: z.literal('chat'), roomId: z.string().max(64), caption: z.string().max(4000).optional(), replyTo: z.number().int().positive().optional() }),
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
]);
export type UploadTarget = z.infer<typeof uploadTargetSchema>;

const syncMode = z.enum(['two_way', 'upload_only', 'download_only']);
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

export const contract = {
  'app:info': ch(none, { whileLocked: true }),
  'app:quit': ch(none, { whileLocked: true }),
  'app:relaunch': ch(none, { whileLocked: true }),
  'app:openExternal': ch(z.object({ url: z.string().url().max(2048) }), { rate: 5 }),
  'app:openInBrowser': ch(z.object({ path: z.string().regex(/^\/[A-Za-z0-9/_\-.?=&]*$/).max(512) }), { session: true, rate: 5 }),
  /** macOS: the Dock icon with the unread count painted on (the renderer draws it; see core/dock-badge). */
  'app:setDockIcon': ch(z.object({ png: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(4_000_000) }), { whileLocked: true, rate: 30 }),

  'auth:state': ch(none, { whileLocked: true }),
  'auth:setServer': ch(z.object({ url: z.string().min(3).max(512) }), { rate: 2 }),
  'auth:signIn': ch(z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(512) }), { rate: 2 }),
  'auth:verifyMfa': ch(z.object({ code: z.string().regex(/^[A-Za-z0-9-]{4,32}$/) }), { rate: 2 }),
  'auth:cancelMfa': ch(none),
  // Opens the server's passkey page in the browser; the result returns through worksuite://auth/callback.
  'auth:passkeyStart': ch(none, { rate: 2 }),
  'auth:passkeyCancel': ch(none),
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

  'tabs:save': ch(z.object({ tabs: z.array(tabRecordSchema).max(64), activeId: idString.nullable() }), { session: true, rate: 10 }),
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
   * Meet remote control on this computer (WS-MEET-ENH-01). The meeting window
   * says when it shares and relays what arrives on the data channel; it never
   * holds a key. Answering a request comes only from the consent window, and
   * resuming only from the control bar, each with a real click there. Stopping
   * works while WorkSuite is locked: stopping is never harder than starting.
   */
  'rc:state': ch(none, { session: true, whileLocked: true }),
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
            folder: z.string().regex(/^[A-Za-z0-9._\-/ ]{1,128}$/),
            mailbox: z.string().regex(/^\d{1,20}$/).nullable(),
          })
          .optional(),
        /** A Meet recording (the owner's own; the server checks). */
        recording: z.number().int().positive().optional(),
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
        name: z.string().min(1).max(255),
        open: z.boolean().optional(),
      })
      .refine((v) => [v.fileId, v.mail, v.recording, v.export, v.importErrors, v.version, v.payslip, v.hrDocument, v.hrReport, v.hrLetter, v.picture, v.orderPdf, v.invoicePdf, v.paymentSlip, v.ordersCsv, v.omsReport, v.tenderDocument, v.tenderLine, v.tenderLetter, v.tenderLibrary, v.financeCsv, v.expenseFile].filter((x) => x !== undefined).length === 1 && (v.hrEmployee === undefined || v.hrDocument !== undefined), 'give a file id, a file version, a mail attachment, a recording, an export, an import job, a payslip, an HR document, an HR report, a resignation letter, a profile picture, an order or invoice PDF, a payment slip, an order list, an Orders report, a tender document, checklist file, letter or library document, a Finance report, or an Expenses file'),
    { session: true, permission: 'desktop.downloads', sensitive: true, rate: 10 },
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
  /** The bell's count again, now: after the notification centre read, snoozed or archived something. */
  'notifications:refresh': ch(none, { session: true, rate: 10 }),

  'clipboard:readForPaste': ch(none, { session: true, rate: 5 }),

  'print:print': ch(z.object({ html: z.string().max(5_000_000), title: z.string().max(200), silent: z.boolean().optional(), deviceName: z.string().max(200).optional() }), { session: true, rate: 2 }),
  'print:printers': ch(none, { session: true }),
  'print:toPdf': ch(z.object({ html: z.string().max(5_000_000), title: z.string().max(200) }), { session: true, rate: 2 }),

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

  'offline:status': ch(none, { session: true }),
  'offline:pending': ch(none, { session: true }),
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
  'settings:set': ch(preferencesPatchSchema, { rate: 10 }),

  'status:snapshot': ch(none, { whileLocked: true }),

  'diagnostics:run': ch(none, { whileLocked: true, rate: 1 }),
  'diagnostics:previewBundle': ch(none, { permission: 'desktop.diagnostics.export', whileLocked: true, rate: 1 }),
  'diagnostics:saveBundle': ch(none, { permission: 'desktop.diagnostics.export', whileLocked: true, sensitive: true, rate: 1 }),
  'diagnostics:restartSafeMode': ch(z.object({ safe: z.boolean() }), { whileLocked: true }),
  'diagnostics:services': ch(none, { whileLocked: true }),
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

export interface Outputs {
  'app:info': AppInfo;
  'app:quit': void;
  'app:relaunch': void;
  'app:openExternal': boolean;
  'app:openInBrowser': boolean;
  'app:setDockIcon': boolean;
  'auth:state': AuthState;
  'auth:setServer': AuthState;
  'auth:signIn': AuthState;
  'auth:verifyMfa': AuthState;
  'auth:cancelMfa': AuthState;
  'auth:passkeyStart': AuthState;
  'auth:passkeyCancel': AuthState;
  'hr:clock': { ok: true };
  'hr:break': { ok: true };
  'media:access': { granted: boolean };
  'media:screenSources': ScreenSources;
  'media:screenPick': void;
  'media:privacySettings': void;
  'calls:active': void;
  'calls:list': ActiveCall[];
  'rc:state': RemoteControlView;
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
  'tabs:save': void;
  'tabs:restore': { tabs: TabRecord[]; activeId: string | null; restored: boolean };
  'files:pickFiles': PickedFile[];
  'files:registerDropped': PickedFile[];
  'files:pickFolder': PickedFile[];
  'files:chooseDownloadFolder': string | null;
  'files:saveText': string | null;
  'transfers:list': Transfer[];
  'transfers:download': Transfer;
  'transfers:upload': Transfer[];
  'transfers:pause': void;
  'transfers:resume': void;
  'transfers:cancel': void;
  'transfers:retry': void;
  'transfers:open': boolean;
  'transfers:reveal': boolean;
  'transfers:clearFinished': void;
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
  'notifications:refresh': void;
  'clipboard:readForPaste': { text: string | null; image: string | null; files: PickedFile[] };
  'print:print': boolean;
  'print:printers': Array<{ name: string; displayName: string; isDefault: boolean }>;
  'print:toPdf': string | null;
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
  'offline:status': OfflineStatus;
  'offline:pending': OfflineMutation[];
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
