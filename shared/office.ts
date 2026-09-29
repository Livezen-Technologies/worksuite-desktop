import { z } from 'zod';

/**
 * Office documents on the desktop (WorkSuite Drive — ONLYOFFICE Office File
 * Integration SRS, §7 desktop and §9 offline; the server is
 * `app/Modules/EuroOffice`, its client contract `office_docs/web-api.md`).
 *
 * What both sides of the app agree on: the shapes the server answers, the
 * route an Office tab lives at, which Document Server address the desktop
 * will load an editor from, the editor events that may cross from the
 * editor's own isolated page, and the commands that may go back to it.
 * Nothing here decides who may do what — the server's `permissions` do.
 */

// ── the server's answers ─────────────────────────────────────────────────

export const OFFICE_MODES = ['VIEW', 'EDIT', 'COMMENT', 'REVIEW'] as const;
export type OfficeMode = (typeof OFFICE_MODES)[number];

/** `client_type` for this computer (§1): the desktop names its OS. */
export type OfficeClientType = 'DESKTOP_WIN' | 'DESKTOP_MAC' | 'DESKTOP_LINUX';

/** `process.platform` or the app's own platform name → the client type the server records. */
export function officeClientType(platform: string): OfficeClientType {
  if (platform === 'darwin' || platform === 'macos') return 'DESKTOP_MAC';
  if (platform === 'win32' || platform === 'windows') return 'DESKTOP_WIN';
  return 'DESKTOP_LINUX';
}

export interface OfficePerson {
  id: number;
  name: string;
}

export interface OfficeReadOnlyReason {
  code: string;
  message: string;
  holder?: OfficePerson | null;
}

export interface OfficeLock {
  type: string;
  holder: OfficePerson | null;
  mine: boolean;
  reason: string | null;
  since: string | null;
  expires_at: string | null;
}

export interface OfficeCollaborator {
  user: { id: number; name: string; avatar: string | null };
  editing: boolean;
  modes: string[];
  clients: string[];
  since: string | null;
  last_active_at: string | null;
}

export type OfficeSaveState = 'saved' | 'saving' | 'save_pending' | 'save_failed';

export interface OfficeSaveStatus {
  state: OfficeSaveState;
  message: string;
  error_code: string | null;
  retry_available: boolean;
  actions: string[];
  pending_since: string | null;
  last_version: { version: number; at: string | null; by: OfficePerson | null } | null;
  last_commit: { version: number | null; at: string | null; manual: boolean; label: string | null; contributors: number[] } | null;
  session?: { session_id: string; status: string; mode: OfficeMode; new_version_available: boolean };
}

/** What this person may do in this document (§1): hide what is false. */
export interface OfficePermissions {
  edit: boolean;
  review: boolean;
  comment: boolean;
  download: boolean;
  print: boolean;
  copy: boolean;
  export: boolean;
  convert: boolean;
  share: boolean;
  rename: boolean;
  move: boolean;
  version_history: boolean;
  restore_version: boolean;
  mention: boolean;
  coedit: boolean;
  chat: boolean;
}

export interface OfficeFileInfo {
  id: number;
  name: string;
  extension: string;
  type: string;
  version: number;
  size: number;
}

export interface OfficeFormat {
  declared: string | null;
  mismatch: boolean;
  legacy: boolean;
  macro: boolean;
  upgrade_to: string | null;
  content_checked: boolean;
}

/** `POST …/office/session` (201) and `GET …/office/config` (200): the bootstrap. */
export interface OfficeBootstrap {
  session_id: string;
  provider: string;
  document_server_url: string;
  api_url: string;
  document_type: string;
  document_key: string;
  /** The whole signed configuration, handed to `new DocsAPI.DocEditor(id, config)` untouched. */
  config: Record<string, unknown>;
  permissions: OfficePermissions;
  mode: OfficeMode;
  available_modes: OfficeMode[];
  default_mode: OfficeMode;
  read_only_reason: OfficeReadOnlyReason | null;
  expires_at: string;
  heartbeat_interval_s: number;
  session_idle_timeout_s: number;
  file: OfficeFileInfo;
  format: OfficeFormat;
  lock: OfficeLock | null;
  collaborators: OfficeCollaborator[];
  new_version_available: boolean;
  save: OfficeSaveStatus;
  /** Set when the file changed underneath: the answer is a new session on the new key. */
  replaced_session_id?: string;
}

/** `POST …/session/{sid}/heartbeat`. */
export interface OfficeHeartbeat {
  session_id: string;
  status: string;
  mode: OfficeMode;
  available_modes: OfficeMode[];
  read_only_reason: OfficeReadOnlyReason | null;
  reload: boolean;
  can_switch_to_edit: boolean;
  new_version_available: boolean;
  head_version: number;
  lock: OfficeLock | null;
  collaborators: OfficeCollaborator[];
  save: OfficeSaveStatus;
  next_heartbeat_s: number;
  session_expires_at: string;
}

/** `GET /api/files/office/types` — routing a Drive list without a request per file (§6). */
export interface OfficeFormatInfo {
  type: string;
  document_type?: string;
  editable: boolean;
  legacy: boolean;
  upgrade_to: string | null;
  macro: boolean;
  export_targets: string[];
  default_action: 'edit' | 'view' | 'preview' | string;
  route: 'office' | 'code_editor' | string;
}

export interface OfficeTypes {
  organization_id: number;
  formats: Record<string, OfficeFormatInfo>;
  new_document_types: Record<string, string>;
  provider: { name: string; available: boolean; reason: string | null; features: Record<string, boolean> };
  policy: {
    editing_enabled: boolean;
    desktop_enabled: boolean;
    export_enabled: boolean;
    exclusive_editing: boolean;
    max_file_size_mb: number;
    legacy_handling: 'new_file' | 'view_only' | string;
    heartbeat_interval_s: number;
  };
}

/** `GET /api/files/{id}/office/actions` — the decision for one file, by its content (§6). */
export interface OfficeActions {
  file_id: number;
  type: { kind: string; extension: string; declared: string | null; mismatch: boolean; legacy: boolean; macro: boolean; upgrade_to: string | null; supported: boolean; reason: string | null };
  route: 'office' | 'preview' | 'code_editor' | string;
  default_action: 'edit' | 'view' | 'preview' | 'code_editor' | string;
  reason: { code: string; message: string } | null;
  actions: Record<string, boolean>;
  editing: { editing: number; viewing: number; editors: OfficePerson[] };
}

export interface OfficeTemplate {
  id: string;
  name: string;
  kind: 'document' | 'spreadsheet' | 'presentation';
  extension: string;
  type: string;
  scope: 'system' | 'organization' | string;
  category: string | null;
  organization_id: number | null;
  file_id?: number;
  status?: string;
}

export interface OfficePresence {
  file_id: number;
  editing: number;
  viewing: number;
  collaborators: OfficeCollaborator[];
  recent_editors: Array<OfficePerson & { at: string | null }>;
}

// ── the Office tab's route ───────────────────────────────────────────────

/**
 * A route parameter the desktop's route grammar accepts (the tab store and
 * the window manager check routes against `[A-Za-z0-9/_\-.:?=&%]`):
 * everything else, `(`, `)`, `'`, `!`, `*` and `~` included, percent-encoded.
 */
export function routeParam(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `/office/42?mode=edit&name=Proposal.docx` — one tab per document (OO-DSK-004). */
export function officeRoute(fileId: number, opts: { mode?: OfficeMode | null; name?: string | null } = {}): string {
  const q: string[] = [];
  if (opts.mode) q.push(`mode=${opts.mode.toLowerCase()}`);
  if (opts.name) q.push(`name=${routeParam(opts.name.slice(0, 120))}`);
  return `/office/${fileId}${q.length ? `?${q.join('&')}` : ''}`;
}

export function parseOfficeRoute(route: string): { fileId: number; mode: OfficeMode | null; name: string | null } | null {
  const [path, query] = route.split('?');
  const m = /^\/office\/(\d{1,12})\/?$/.exec(path ?? '');
  if (!m) return null;
  const q = new URLSearchParams(query ?? '');
  const mode = (q.get('mode') ?? '').toUpperCase();
  return { fileId: Number(m[1]), mode: (OFFICE_MODES as readonly string[]).includes(mode) ? (mode as OfficeMode) : null, name: q.get('name') };
}

// ── the Document Server the editor is loaded from ────────────────────────

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The Document Server's origin, when the desktop will load an editor from
 * it: HTTPS (plain HTTP only on this computer, in a development build), no
 * credentials in the address, and `api_url` its own
 * `…/web-apps/apps/api/documents/api.js`. Anything else is refused — the
 * editor's page is allowed to reach this origin and no other.
 */
export function documentServerOrigin(documentServerUrl: string, apiUrl: string, opts: { allowInsecureLocal: boolean }): { origin: string; apiUrl: string } | { error: string } {
  let ds: URL;
  let api: URL;
  try {
    ds = new URL(documentServerUrl);
    api = new URL(apiUrl);
  } catch {
    return { error: 'The Office editor address is not valid. Ask your administrator to check the Document Server URL.' };
  }
  if (ds.username || ds.password || api.username || api.password) return { error: 'The Office editor address must not carry a user name or password.' };
  const secure = ds.protocol === 'https:' || (opts.allowInsecureLocal && ds.protocol === 'http:' && LOOPBACK.has(ds.hostname));
  if (!secure) return { error: 'The Office editor must be served over HTTPS for WorkSuite Desktop. Ask your administrator to check the Document Server URL.' };
  if (api.origin !== ds.origin) return { error: 'The Office editor script is not on the Document Server. Ask your administrator to check the Document Server URL.' };
  const base = ds.pathname.replace(/\/+$/, '');
  if (!api.pathname.startsWith(`${base}/`) || !api.pathname.endsWith('/web-apps/apps/api/documents/api.js') || api.search || api.hash) {
    return { error: 'The Office editor script address is not the Document Server’s own. Ask your administrator to check the Document Server URL.' };
  }
  return { origin: ds.origin, apiUrl: api.toString() };
}

// ── the editor's page ↔ the desktop ─────────────────────────────────────

/**
 * The ONLYOFFICE editor events the editor's page may report (DocsAPI
 * `events.on…`). The shell chooses which of the optional ones to wire: a
 * handler that exists makes the editor show the feature (Share, rename,
 * mentions, "Edit current file"), so each is wired only with the permission
 * behind it.
 */
export const OFFICE_EDITOR_EVENTS = [
  'onAppReady',
  'onDocumentReady',
  'onDocumentStateChange',
  'onError',
  'onWarning',
  'onInfo',
  'onRequestRefreshFile',
  'onOutdatedVersion',
  'onCollaborativeChanges',
  'onMetaChange',
  'onRequestEditRights',
  'onRequestSharingSettings',
  'onRequestRename',
  'onRequestUsers',
  'onRequestSendNotify',
] as const;
export type OfficeEditorEventName = (typeof OFFICE_EDITOR_EVENTS)[number];

/** Always wired: the editor's life and the save status. */
export const OFFICE_BASE_EVENTS: OfficeEditorEventName[] = ['onAppReady', 'onDocumentReady', 'onDocumentStateChange', 'onError', 'onWarning', 'onInfo', 'onOutdatedVersion', 'onCollaborativeChanges', 'onMetaChange'];

const short = (n: number) => z.string().max(n);

/**
 * What each event may carry across. Unknown keys are dropped — notably a
 * mention's comment text (`onRequestSendNotify.message`): comment text never
 * leaves the editor (web-api §4).
 */
const EVENT_DATA: Record<OfficeEditorEventName, z.ZodType> = {
  onAppReady: z.null(),
  onDocumentReady: z.null(),
  onDocumentStateChange: z.boolean(),
  onError: z.object({ errorCode: z.number().int().optional(), errorDescription: short(500).optional() }).nullable(),
  onWarning: z.object({ warningCode: z.number().int().optional(), warningDescription: short(500).optional() }).nullable(),
  onInfo: z.object({ mode: short(16).optional() }).nullable(),
  onRequestRefreshFile: z.null(),
  onOutdatedVersion: z.null(),
  onCollaborativeChanges: z.null(),
  onMetaChange: z.object({ title: short(255).optional(), favorite: z.boolean().optional() }).nullable(),
  onRequestEditRights: z.null(),
  onRequestSharingSettings: z.null(),
  onRequestRename: short(255),
  onRequestUsers: z.object({ c: z.enum(['mention', 'protect', 'info']).optional(), search: short(100).optional() }).nullable(),
  onRequestSendNotify: z.object({ emails: z.array(short(254)).max(50), actionLink: short(4000).nullable() }),
};

/** A message from the editor's page, checked: the event must be known, its data its own shape. */
export function parseEditorEvent(raw: unknown): { type: OfficeEditorEventName; data: unknown } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { type, data } = raw as { type?: unknown; data?: unknown };
  if (typeof type !== 'string' || !(OFFICE_EDITOR_EVENTS as readonly string[]).includes(type)) return null;
  const schema = EVENT_DATA[type as OfficeEditorEventName];
  const parsed = schema.safeParse(data === undefined ? null : data);
  return parsed.success ? { type: type as OfficeEditorEventName, data: parsed.data ?? null } : null;
}

/** A mentionable user as the editor takes it (`setUsers`): `email` is the real address or the mention key. */
export const officeUserSchema = z.object({ id: short(64), name: short(200), email: short(254) });

/** Commands to the editor's page (the shell → the main process → the page). */
export const officeCommandSchema = z.discriminatedUnion('type', [
  /** Reload the editor with a (renewed or re-moded) configuration. */
  z.object({ type: z.literal('start'), config: z.record(z.string(), z.unknown()) }),
  /** `docEditor.refreshFile(config)`, when the editor asked for fresh tokens. */
  z.object({ type: z.literal('refresh'), config: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('setUsers'), c: z.enum(['mention', 'protect', 'info']), users: z.array(officeUserSchema).max(100) }),
  z.object({ type: z.literal('denyEditingRights'), message: short(500) }),
  z.object({ type: z.literal('showMessage'), message: short(500) }),
]);
export type OfficeCommand = z.infer<typeof officeCommandSchema>;

/** What the main process tells a tab about its editor (`office:event`). */
export interface OfficeViewEvent {
  viewId: string;
  type: OfficeEditorEventName | 'hostReady' | 'scriptFailed' | 'crashed' | 'downloadBlocked' | 'focus';
  data: unknown;
}

// ── external apps and local copies (OO-DSK-050, OO-OFF-030) ─────────────

export type ExternalAppId = 'default' | 'word' | 'excel' | 'powerpoint';

export const EXTERNAL_APP_LABELS: Record<ExternalAppId, string> = {
  default: 'the default app',
  word: 'Microsoft Word',
  excel: 'Microsoft Excel',
  powerpoint: 'Microsoft PowerPoint',
};

const WORD = ['doc', 'docx', 'docm', 'odt', 'rtf'];
const EXCEL = ['xls', 'xlsx', 'xlsm', 'ods', 'csv'];
const POWERPOINT = ['ppt', 'pptx', 'pptm', 'odp'];

/** The Microsoft app that edits this kind of file, if any. */
export function microsoftAppFor(extension: string): Exclude<ExternalAppId, 'default'> | null {
  const e = extension.toLowerCase();
  if (WORD.includes(e)) return 'word';
  if (EXCEL.includes(e)) return 'excel';
  if (POWERPOINT.includes(e)) return 'powerpoint';
  return null;
}

export interface ExternalApp {
  id: ExternalAppId;
  label: string;
}

export type LocalCopyState = 'downloading' | 'open' | 'changed' | 'uploading' | 'uploaded' | 'conflict' | 'failed' | 'missing';

/** A copy of a Drive file opened in another app on this computer, watched for edits to bring back. */
export interface OfficeLocalCopy {
  id: string;
  fileId: number;
  name: string;
  folderId: number | null;
  /** The Drive version the copy was made from (`base_version` when it goes back). */
  baseVersion: number;
  app: ExternalAppId;
  state: LocalCopyState;
  /** Drive sync keeps this file here: its changes go back through sync, not an upload (OO-DSK-051). */
  syncOwned: boolean;
  error: string | null;
  conflict: { message: string; baseVersion: number; serverVersion: number; actions: string[] } | null;
  changedAt: string | null;
  updatedAt: string;
}

export type OfficeUploadHow = 'version' | 'new_version' | 'keep_both';

/** "Proposal.docx" → "Proposal (edited on this computer).docx", for Keep Both. */
export function keepBothName(name: string, label = 'edited on this computer'): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${label})${name.slice(dot)}` : `${name} (${label})`;
}

/** `download_url` of an export (`https://…/office/exports/<token>`) → the path the desktop fetches from its own server. */
export const OFFICE_EXPORT_TOKEN = /^[A-Za-z0-9._~-]{8,512}$/;

export function officeExportToken(downloadUrl: string): string | null {
  try {
    const u = new URL(downloadUrl, 'https://placeholder.invalid');
    const m = /^\/office\/exports\/([^/]+)$/.exec(u.pathname);
    return m && OFFICE_EXPORT_TOKEN.test(m[1]!) && !u.search ? m[1]! : null;
  } catch {
    return null;
  }
}
