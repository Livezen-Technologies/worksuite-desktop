import { ApiError, apiDelete, apiGet, apiPost } from '../../../core/api';

/**
 * WorkSuite Office on a WorkSuite server (`app/Modules/EuroOffice`, the
 * client contract in its README): the session a document window lives on,
 * saving, presence, locks, mentions, new documents and conversion — every
 * call the desktop makes, typed, in one place. The same routes the web uses,
 * with `client_type` DESKTOP_WIN / DESKTOP_MAC / DESKTOP_LINUX, which the
 * server checks against the company's "desktop" switch and names in its
 * audit ("Client: WorkSuite Desktop").
 *
 * THE SERVER DECIDES; THE WINDOW SHOWS. Nothing here builds editor
 * configuration or works out a permission: the session answers the signed
 * `config` the Document Server is given as it is, the `permissions` the
 * header hides buttons by, and — when it says no — a sentence and what the
 * person may do instead (`errors.actions`), read into `OfficeRefusal`.
 */

export type OfficeMode = 'VIEW' | 'EDIT' | 'COMMENT' | 'REVIEW';

export const OFFICE_MODES: OfficeMode[] = ['VIEW', 'EDIT', 'COMMENT', 'REVIEW'];

export interface OfficePermissions {
  edit: boolean; review: boolean; comment: boolean; download: boolean; print: boolean; copy: boolean;
  export: boolean; convert: boolean; share: boolean; rename: boolean; move: boolean;
  version_history: boolean; restore_version: boolean; mention: boolean; coedit: boolean; chat: boolean;
}

export interface OfficePerson { id: number; name: string }

/** Why a document opened read-only, in the words for the banner. */
export interface ReadOnlyReason { code: string; message: string; holder?: OfficePerson }

export interface OfficeLock {
  type: 'EXCLUSIVE_EDIT' | 'READ_ONLY_LOCK' | string;
  holder: OfficePerson | null;
  mine: boolean;
  reason: string | null;
  since: string | null;
  expires_at: string | null;
}

export interface Collaborator {
  user: { id: number; name: string; avatar: string | null };
  editing: boolean;
  modes: string[];
  clients: string[];
  since: string | null;
  last_active_at: string | null;
}

export type SaveState = 'saved' | 'saving' | 'save_pending' | 'save_failed';

export interface SaveStatus {
  state: SaveState;
  message: string;
  error_code: string | null;
  retry_available: boolean;
  actions: string[];
  pending_since: string | null;
  last_version: { version: number; at: string | null; by: OfficePerson | null } | null;
  last_commit?: { version: number | null; at: string | null; manual: boolean; label: string | null } | null;
  tried?: number;
}

/** POST …/office/session, GET …/config and POST …/mode. */
export interface OfficeBootstrap {
  session_id: string;
  replaced_session_id?: string;
  provider: string;
  document_server_url: string;
  api_url: string;
  document_type: string;
  document_key: string;
  /** The whole signed configuration, handed to the editor as it is. */
  config: Record<string, unknown>;
  permissions: OfficePermissions;
  mode: OfficeMode;
  available_modes: OfficeMode[];
  default_mode: OfficeMode;
  read_only_reason: ReadOnlyReason | null;
  expires_at: string;
  heartbeat_interval_s: number;
  session_idle_timeout_s: number;
  file: { id: number; name: string; extension: string; type: string; version: number; size: number };
  format?: { legacy: boolean; upgrade_to: string | null };
  lock: OfficeLock | null;
  collaborators: Collaborator[];
  new_version_available: boolean;
  save: SaveStatus;
}

export interface OfficeHeartbeat {
  session_id: string;
  status: string;
  mode: OfficeMode;
  available_modes: OfficeMode[];
  read_only_reason: ReadOnlyReason | null;
  reload: boolean;
  can_switch_to_edit: boolean;
  new_version_available: boolean;
  head_version: number;
  lock: OfficeLock | null;
  collaborators: Collaborator[];
  save: SaveStatus;
  next_heartbeat_s: number;
  session_expires_at: string;
}

export interface OfficeTemplate {
  id: string;
  name: string;
  kind: 'document' | 'spreadsheet' | 'presentation' | null;
  extension: string;
  type: string;
  scope: 'system' | 'organization';
  category: string | null;
}

export interface CreatedDocument {
  file: { id: number; name: string; extension: string; type: string; folder_id: number | null; version: number; size: number };
  open: { mode: OfficeMode; session: string };
}

export interface MentionableUser { id: string; name: string; email: string | null; mention_key: string; can_open: boolean }

export interface MentionAnswer { notified: OfficePerson[]; needs_share: OfficePerson[]; can_share: boolean; unmatched: string[] }

/* ─────────────────────────── refusals ─────────────────────────── */

/** A refusal, as the server said it. `status` 0: WorkSuite was not reached. */
export interface OfficeRefusal {
  status: number;
  code: string;
  message: string;
  actions: string[];
  details: Record<string, unknown>;
}

const UNREACHED = 'WorkSuite could not be reached. Check the connection and try again.';

export function officeRefusal(e: unknown, fallback = 'That could not be done.'): OfficeRefusal {
  if (!(e instanceof ApiError)) return { status: 0, code: 'NETWORK', message: UNREACHED, actions: ['retry'], details: {} };
  if (e.status === 0 || e.code === 'NETWORK_UNREACHABLE') return { status: 0, code: 'NETWORK', message: UNREACHED, actions: ['retry'], details: {} };
  const details = e.data && typeof e.data === 'object' && !Array.isArray(e.data) ? (e.data as Record<string, unknown>) : {};
  const code = typeof details.code === 'string' ? details.code : (e.code ?? `HTTP_${e.status}`);
  return {
    status: e.status,
    code: code.toUpperCase(),
    message: e.message && !/^The server answered \d+\.$/.test(e.message) ? e.message : fallback,
    actions: Array.isArray(details.actions) ? details.actions.filter((a): a is string => typeof a === 'string') : [],
    details,
  };
}

/* ─────────────────────────── sessions ─────────────────────────── */

/** DESKTOP_WIN, DESKTOP_MAC or DESKTOP_LINUX — this computer, as the server counts clients. */
export function clientType(platform: string): 'DESKTOP_WIN' | 'DESKTOP_MAC' | 'DESKTOP_LINUX' {
  if (platform === 'win32') return 'DESKTOP_WIN';
  if (platform === 'darwin') return 'DESKTOP_MAC';
  return 'DESKTOP_LINUX';
}

/** The editor's language: the app's, as `en` or `en-GB`. */
export function editorLang(lang: string = typeof navigator === 'undefined' ? 'en' : navigator.language || 'en'): string {
  const m = /^([a-z]{2})(?:-([A-Za-z]{2}))?/.exec(lang);
  return m ? (m[2] ? `${m[1]}-${m[2].toUpperCase()}` : m[1]!) : 'en';
}

const base = (fileId: number) => `/api/files/${fileId}/office`;

export interface OfficeApi {
  openSession(fileId: number, mode?: OfficeMode | null): Promise<OfficeBootstrap>;
  reloadSession(fileId: number, sessionId: string): Promise<OfficeBootstrap>;
  switchMode(fileId: number, sessionId: string, mode: OfficeMode): Promise<OfficeBootstrap>;
  heartbeat(fileId: number, sessionId: string, readyMs?: number): Promise<OfficeHeartbeat>;
  endSession(fileId: number, sessionId: string): Promise<void>;
  forceSave(fileId: number, sessionId: string, label?: string): Promise<{ state: 'requested' | 'no_changes'; message: string }>;
  retrySave(fileId: number): Promise<SaveStatus>;
  mentionable(fileId: number, q: string): Promise<{ allowed: boolean; users: MentionableUser[] }>;
  mention(fileId: number, body: { emails: string[]; action_link?: string }): Promise<MentionAnswer>;
}

export function officeApi(platform: string): OfficeApi {
  const client = clientType(platform);
  // The full editor: a desktop window is never a phone, however narrow it is made.
  const shape = { client_type: client, layout: 'desktop', lang: editorLang() };
  return {
    openSession: (fileId, mode) => apiPost<OfficeBootstrap>(`${base(fileId)}/session`, { ...shape, ...(mode ? { mode_requested: mode } : {}) }),
    reloadSession: (fileId, sessionId) => apiGet<OfficeBootstrap>(`${base(fileId)}/config`, { session_id: sessionId, lang: shape.lang, layout: shape.layout }),
    switchMode: (fileId, sessionId, mode) => apiPost<OfficeBootstrap>(`${base(fileId)}/session/${encodeURIComponent(sessionId)}/mode`, { mode }),
    heartbeat: (fileId, sessionId, readyMs) => apiPost<OfficeHeartbeat>(`${base(fileId)}/session/${encodeURIComponent(sessionId)}/heartbeat`, readyMs !== undefined ? { ready_ms: readyMs } : {}),
    endSession: async (fileId, sessionId) => {
      await apiDelete(`${base(fileId)}/session/${encodeURIComponent(sessionId)}?reason=CLOSED`);
    },
    forceSave: (fileId, sessionId, label) => apiPost(`${base(fileId)}/force-save`, { session_id: sessionId, ...(label ? { version_label: label } : {}) }),
    retrySave: (fileId) => apiPost<SaveStatus>(`${base(fileId)}/save/retry`, {}),
    mentionable: (fileId, q) => apiGet(`${base(fileId)}/mentionable`, { q }),
    mention: (fileId, body) => apiPost<MentionAnswer>(`${base(fileId)}/mentions`, body),
  };
}

/* ─────────────────────────── routing, new documents, conversion ─────────────────────────── */

/**
 * Whether this server has WorkSuite Office's session API. An older server
 * answers 404 for `office/types`: Office files then open on the web, as
 * before. Asked once per run; an unreachable server is asked again later.
 */
let hasOffice: Promise<boolean> | null = null;

export function serverHasOffice(): Promise<boolean> {
  if (!hasOffice) {
    hasOffice = apiGet('/api/files/office/types').then(
      () => true,
      (e: unknown) => {
        // Any other answer (a 403, the Document Server down) means the API is there: the document window explains it.
        if (e instanceof ApiError && e.status !== 0) return e.status !== 404 && e.status !== 405;
        // Not reached: ask again next time.
        hasOffice = null;
        return false;
      },
    );
  }
  return hasOffice;
}

/** Test hook: forget what was learned about the server. */
export function resetOfficeProbe(): void {
  hasOffice = null;
}

export function templates(): Promise<OfficeTemplate[]> {
  return apiGet<{ templates: OfficeTemplate[] }>('/api/files/office/templates').then((r) => r.templates ?? []);
}

export function createDocument(body: { type?: 'document' | 'spreadsheet' | 'presentation'; template_id?: string; folder_id?: number | null; name?: string }): Promise<CreatedDocument> {
  return apiPost<CreatedDocument>('/api/files/office/new', body);
}

export function exportPdf(fileId: number, destination: 'DOWNLOAD' | 'DRIVE'): Promise<{ download_url?: string; file_name?: string; file?: { id: number; name: string } }> {
  return apiPost(`${base(fileId)}/export`, { target_format: 'pdf', destination });
}

export function convertLegacy(fileId: number): Promise<{ file: { id: number; name: string; folder_id: number | null; extension: string } }> {
  return apiPost(`${base(fileId)}/convert-legacy`, {});
}
