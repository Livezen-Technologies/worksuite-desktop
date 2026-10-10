import {
  officeClientType,
  type OfficeActions,
  type OfficeBootstrap,
  type OfficeHeartbeat,
  type OfficeLock,
  type OfficeMode,
  type OfficePresence,
  type OfficeSaveStatus,
  type OfficeTemplate,
  type OfficeTypes,
} from '@shared/office';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { platform } from '../../core/bridge';

/**
 * The Office API as the desktop speaks it (web-api.md, under Drive's
 * `/api/files/{id}/office/*`). The server decides everything: the mode,
 * what this person may do, what saving has reached. This side sends what
 * happened and shows what it answers, in the server's own words.
 */

/** `client_type` for this computer (OO-DSK: by OS). */
export const CLIENT_TYPE = officeClientType(platform);

/** The editor's language follows the app's (OO-NFR-013; core/i18n sets the document's `lang`). */
function officeLang(): string {
  const l = typeof document !== 'undefined' ? document.documentElement.lang : '';
  return /^[a-z]{2}(-[A-Za-z]{2})?$/.test(l) ? l : 'en';
}

/**
 * The editor's theme follows the app's light or dark mode (worksuite-desktop#326; the theme's `data-theme` on the
 * page). The server signs it into the configuration as `customization.uiTheme`, so it is asked for with each one.
 */
export function officeTheme(): 'dark' | 'light' {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

const base = (fileId: number) => `/api/files/${fileId}/office`;

export function openSession(fileId: number, mode: OfficeMode | null): Promise<OfficeBootstrap> {
  return apiPost<OfficeBootstrap>(`${base(fileId)}/session`, { client_type: CLIENT_TYPE, layout: 'desktop', lang: officeLang(), theme: officeTheme(), ...(mode ? { mode_requested: mode } : {}) });
}

/** The same session again: new tokens, the mode re-checked; a new session when the file changed underneath. */
export function renewSession(fileId: number, sessionId: string): Promise<OfficeBootstrap> {
  return apiGet<OfficeBootstrap>(`${base(fileId)}/config`, { session_id: sessionId, lang: officeLang(), layout: 'desktop', theme: officeTheme() });
}

export function switchMode(fileId: number, sessionId: string, mode: OfficeMode): Promise<OfficeBootstrap> {
  return apiPost<OfficeBootstrap>(`${base(fileId)}/session/${sessionId}/mode`, { mode, lang: officeLang(), layout: 'desktop', theme: officeTheme() });
}

export function heartbeat(fileId: number, sessionId: string, readyMs?: number): Promise<OfficeHeartbeat> {
  return apiPost<OfficeHeartbeat>(`${base(fileId)}/session/${sessionId}/heartbeat`, readyMs !== undefined ? { ready_ms: Math.round(readyMs) } : {});
}

export function endSession(fileId: number, sessionId: string, reason: 'CLOSED' | 'ORG_SWITCH'): Promise<unknown> {
  return apiDelete(`${base(fileId)}/session/${sessionId}?reason=${reason}`);
}

export function saveStatus(fileId: number, sessionId: string): Promise<OfficeSaveStatus> {
  return apiGet<OfficeSaveStatus>(`${base(fileId)}/status`, { session_id: sessionId });
}

export function retrySave(fileId: number): Promise<OfficeSaveStatus & { tried: number }> {
  return apiPost(`${base(fileId)}/save/retry`, {});
}

/** "Save now" (closing a tab, OO-DSK-006), or with a label "Save as version" (OO-VER-012). */
export function forceSave(fileId: number, sessionId: string, label?: { version_label: string; description?: string }): Promise<{ state: 'requested' | 'no_changes'; manual?: boolean; message?: string }> {
  return apiPost(`${base(fileId)}/force-save`, { session_id: sessionId, ...(label ?? {}) });
}

export function presence(fileId: number): Promise<OfficePresence> {
  return apiGet<OfficePresence>(`${base(fileId)}/presence`);
}

export function takeLock(fileId: number, sessionId: string): Promise<{ lock: OfficeLock | null }> {
  return apiPost(`${base(fileId)}/lock`, { type: 'EXCLUSIVE_EDIT', session_id: sessionId });
}

export function releaseLock(fileId: number): Promise<{ lock: null }> {
  return apiDelete(`${base(fileId)}/lock`);
}

export interface MentionableUser {
  id: string;
  name: string;
  email: string | null;
  mention_key: string;
  can_open: boolean;
}

export function mentionable(fileId: number, q: string): Promise<{ allowed: boolean; users: MentionableUser[] }> {
  return apiGet(`${base(fileId)}/mentionable`, { q });
}

/** A mention from a comment: who, and where the comment is — never its text. */
export function mention(fileId: number, emails: string[], actionLink: string | null): Promise<{ notified: Array<{ id: number; name: string }>; needs_share: Array<{ id: number; name: string }>; can_share: boolean; unmatched: string[] }> {
  return apiPost(`${base(fileId)}/mentions`, { emails, user_ids: [], ...(actionLink ? { action_link: actionLink } : {}) });
}

/** After a rename: every open session's title (OO-COL-060). */
export function refreshTitle(fileId: number): Promise<unknown> {
  return apiPost(`${base(fileId)}/meta`, {});
}

export function renameFile(fileId: number, name: string): Promise<unknown> {
  return apiPut(`/api/files/${fileId}`, { name });
}

export function officeActions(fileId: number): Promise<OfficeActions> {
  return apiGet<OfficeActions>(`${base(fileId)}/actions`, { client_type: CLIENT_TYPE });
}

export function officeTypes(orgId: string | null, signal?: AbortSignal): Promise<OfficeTypes> {
  return apiGet<OfficeTypes>('/api/files/office/types', orgId ? { org_id: orgId } : undefined, signal);
}

export function templates(kind?: 'document' | 'spreadsheet' | 'presentation'): Promise<{ templates: OfficeTemplate[] }> {
  return apiGet('/api/files/office/templates', kind ? { kind } : undefined);
}

export interface CreatedDocument {
  file: { id: number; name: string; extension: string; type: string; folder_id: number | null; version: number; size: number; org_id: number | null };
  template: { id: string; scope: string } | null;
  open: { mode: OfficeMode; session: string };
}

/** + New → Document / Spreadsheet / Presentation, or from a template (OO-DRV-050/051). */
export function createDocument(input: { type?: 'document' | 'spreadsheet' | 'presentation'; template_id?: string; folder_id: number | null; name?: string }): Promise<CreatedDocument> {
  return apiPost<CreatedDocument>('/api/files/office/new', input);
}

export interface ExportJob {
  job: { id: number; status: string; target_format: string; result_file_id: number | null };
  download_url?: string;
  file_name?: string;
  expires_at?: string;
  file?: { id: number; name: string; folder_id: number | null; extension: string };
}

export function exportDocument(fileId: number, target: string, destination: 'DOWNLOAD' | 'DRIVE'): Promise<ExportJob> {
  return apiPost<ExportJob>(`${base(fileId)}/export`, { target_format: target, destination });
}

/** Convert & Edit (OO-CNV-030/031): a new DOCX/XLSX/PPTX beside the original, which is kept. */
export function convertLegacy(fileId: number): Promise<{ file: CreatedDocument['file']; open: CreatedDocument['open'] }> {
  return apiPost(`${base(fileId)}/convert-legacy`, {});
}

export interface VersionRow {
  id?: number;
  version: number;
  size: number;
  author: string | null;
  made_at: string | null;
  label: string | null;
  is_head?: boolean;
}

export function versions(fileId: number): Promise<{ current: VersionRow; history: VersionRow[] }> {
  return apiGet(`/api/files/${fileId}/versions`);
}

export function restoreVersion(fileId: number, rowId: number): Promise<unknown> {
  return apiPost(`/api/files/${fileId}/versions/${rowId}/restore`, {});
}

// ── refusals ─────────────────────────────────────────────────────────────

/** A refusal as §5 describes it: the sentence to show, its code, and what it offers. */
export interface OfficeRefusal {
  status: number;
  code: string | null;
  message: string;
  actions: string[];
  offline: boolean;
  details: Record<string, unknown>;
}

export function refusalOf(e: unknown): OfficeRefusal {
  if (e instanceof ApiError) {
    const details = e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {};
    const code = typeof details.code === 'string' ? details.code : e.code;
    const offline = e.code === 'NETWORK_UNREACHABLE' || (e.status === 0 && !code);
    return { status: e.status, code, message: e.message, actions: Array.isArray(details.actions) ? details.actions.map(String) : [], offline, details };
  }
  return { status: 0, code: null, message: e instanceof Error ? e.message : String(e), actions: [], offline: false, details: {} };
}

/** "Samali, Ishan and 2 more". */
export function names(list: string[], max = 2): string {
  if (list.length <= max) return list.join(list.length === 2 ? ' and ' : ', ');
  return `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
}

/** 14:32 today, or 29 Sep 14:32. */
export function clock(at: number | string | null | undefined, now = Date.now()): string {
  if (at === null || at === undefined) return '';
  const d = typeof at === 'number' ? new Date(at) : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}
