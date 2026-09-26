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
  ScreenSources,
  ServiceHealth,
  StatusSnapshot,
  Transfer,
  UpdateStatus,
} from '../types';

const none = z.undefined().or(z.null()).optional();
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
  z.object({ kind: z.literal('files'), folderId: z.string().max(64).nullable() }),
  /** A chat attachment; the caption and the reply go with it (the first of several files carries them). */
  z.object({ kind: z.literal('chat'), roomId: z.string().max(64), caption: z.string().max(4000).optional(), replyTo: z.number().int().positive().optional() }),
  /** A task's attachment (or a comment's, with its id): stored in Drive, then linked to the task. */
  z.object({ kind: z.literal('task'), taskId: z.number().int().positive(), commentId: z.number().int().positive().optional() }),
]);
export type UploadTarget = z.infer<typeof uploadTargetSchema>;

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
  'windows:minimize': ch(none, { whileLocked: true }),
  'windows:toggleMaximize': ch(none, { whileLocked: true }),
  'windows:close': ch(none, { whileLocked: true }),
  'windows:state': ch(none, { whileLocked: true }),

  'tabs:save': ch(z.object({ tabs: z.array(tabRecordSchema).max(64), activeId: idString.nullable() }), { session: true, rate: 10 }),
  'tabs:restore': ch(none, { session: true }),

  'files:pickFiles': ch(z.object({ multiple: z.boolean(), title: z.string().max(100).optional(), only: z.enum(['gif', 'document', 'image', 'video', 'audio']).optional() }), { session: true, rate: 2 }),
  // The dialog runs in the main process, which stores the chosen folder itself.
  'files:chooseDownloadFolder': ch(none, { rate: 2 }),
  'files:registerDropped': ch(z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(200) }), { session: true, rate: 5 }),

  'media:access': ch(z.object({ kind: z.enum(['microphone', 'camera']) }), { session: true, rate: 5 }),
  'media:screenSources': ch(none, { session: true, rate: 3 }),
  'media:screenPick': ch(z.object({ id: z.string().min(1).max(200) }), { session: true, rate: 3 }),
  'media:privacySettings': ch(z.object({ pane: z.enum(['microphone', 'camera', 'screen']) }), { session: true, rate: 2 }),
  'calls:active': ch(z.object({ uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).nullable() }), { session: true, rate: 10 }),
  'hr:clock': ch(z.object({ direction: z.enum(['in', 'out']), note: z.string().max(500).optional() }), { session: true, rate: 3 }),
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
        name: z.string().min(1).max(255),
        open: z.boolean().optional(),
      })
      .refine((v) => [v.fileId, v.mail, v.recording, v.export, v.importErrors, v.version].filter((x) => x !== undefined).length === 1, 'give a file id, a file version, a mail attachment, a recording, an export or an import job'),
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

  'notifications:list': ch(none, { session: true }),
  'notifications:markRead': ch(z.object({ ids: z.array(idString).min(1).max(200) }), { session: true }),
  'notifications:markAllRead': ch(none, { session: true }),
  'notifications:pause': ch(z.object({ minutes: z.number().int().min(0).max(60 * 24 * 7).nullable() }), { session: true }),
  'notifications:test': ch(none, { session: true, rate: 1 }),

  'clipboard:readForPaste': ch(none, { session: true, rate: 5 }),

  'print:print': ch(z.object({ html: z.string().max(5_000_000), title: z.string().max(200), silent: z.boolean().optional(), deviceName: z.string().max(200).optional() }), { session: true, rate: 2 }),
  'print:printers': ch(none, { session: true }),
  'print:toPdf': ch(z.object({ html: z.string().max(5_000_000), title: z.string().max(200) }), { session: true, rate: 2 }),

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
}

export interface Outputs {
  'app:info': AppInfo;
  'app:quit': void;
  'app:relaunch': void;
  'app:openExternal': boolean;
  'app:openInBrowser': boolean;
  'auth:state': AuthState;
  'auth:setServer': AuthState;
  'auth:signIn': AuthState;
  'auth:verifyMfa': AuthState;
  'auth:cancelMfa': AuthState;
  'auth:passkeyStart': AuthState;
  'auth:passkeyCancel': AuthState;
  'hr:clock': { ok: true };
  'media:access': { granted: boolean };
  'media:screenSources': ScreenSources;
  'media:screenPick': void;
  'media:privacySettings': void;
  'calls:active': void;
  'auth:signOut': AuthState;
  'auth:completeSetup': AuthState;
  'session:bootstrap': Bootstrap | null;
  'session:refresh': Bootstrap | null;
  'session:switchOrganization': { organizationId: string | null; closedTabs: number };
  'windows:open': { id: number };
  'windows:setAlwaysOnTop': boolean;
  'windows:minimize': void;
  'windows:toggleMaximize': boolean;
  'windows:close': void;
  'windows:state': WindowState;
  'tabs:save': void;
  'tabs:restore': { tabs: TabRecord[]; activeId: string | null; restored: boolean };
  'files:pickFiles': PickedFile[];
  'files:registerDropped': PickedFile[];
  'files:chooseDownloadFolder': string | null;
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
  'notifications:list': { items: NotificationItem[]; unread: number };
  'notifications:markRead': void;
  'notifications:markAllRead': void;
  'notifications:pause': { pausedUntil: string | null };
  'notifications:test': boolean;
  'clipboard:readForPaste': { text: string | null; image: string | null; files: PickedFile[] };
  'print:print': boolean;
  'print:printers': Array<{ name: string; displayName: string; isDefault: boolean }>;
  'print:toPdf': string | null;
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
