/**
 * WorkSuite Office on the desktop (Drive + ONLYOFFICE SRS, the desktop client,
 * OO-DSK): the parts both the main process and the renderer need.
 *
 * A document opens in a window of its own. The window's page (app://bundle) is
 * WorkSuite's header, save status and banners; the Document Server's editor
 * runs beside it in a view of its own — another origin (app://office), an
 * in-memory session, no bridge but the one below — so a Document Server's
 * script never reaches `window.worksuite`, a token or this computer.
 *
 *   window page ──office:editor──▶ main ──office-host:command──▶ editor view
 *   window page ◀─office:editorEvent── main ◀─office-host:event── editor view
 *
 * Plain data and small pure functions: the sandboxed preloads import it too.
 */

/** The editor's events the view passes on. Anything else it sends is dropped. */
export const OFFICE_EDITOR_EVENTS = [
  'onAppReady',
  'onDocumentReady',
  'onDocumentStateChange',
  'onError',
  'onWarning',
  'onInfo',
  'onRequestRefreshFile',
  'onOutdatedVersion',
  'onRequestClose',
  'onMetaChange',
  'onRequestSharingSettings',
  'onRequestRename',
  'onRequestUsers',
  'onRequestSendNotify',
  'onDownloadAs',
  /** Not the editor's: the view could not load the Document Server's script. */
  'scriptError',
] as const;

export type OfficeEditorEventName = (typeof OFFICE_EDITOR_EVENTS)[number];

/** One event from the editor, for the build (`load`) it belongs to. */
export interface OfficeEditorEvent {
  build: number;
  type: OfficeEditorEventName;
  data: unknown;
}

/** What the window page asks of its editor view. */
export type OfficeEditorCommand =
  | { op: 'load'; build: number; apiUrl: string; config: Record<string, unknown>; events: OfficeEditorEventName[] }
  | { op: 'destroy' }
  | { op: 'refreshFile'; config: Record<string, unknown> }
  | { op: 'setUsers'; data: Record<string, unknown> }
  | { op: 'downloadAs'; format?: string };

/** The largest event the view may pass on, as JSON (an @-list, a title). */
export const OFFICE_EVENT_MAX_BYTES = 64 * 1024;

/**
 * The Document Server's editor script, as the session named it (`api_url`):
 * https (http only in a development build, for a local Document Server), no
 * credentials, at the script's own path. Its origin is the only one the
 * editor view may load from or frame. Null when it is anything else.
 */
export function officeScriptOrigin(apiUrl: string, allowHttp: boolean): string | null {
  let u: URL;
  try {
    u = new URL(apiUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return null;
  if (u.username || u.password) return null;
  if (!/\/web-apps\/apps\/api\/documents\/api\.js$/.test(u.pathname)) return null;
  return u.origin;
}

/**
 * Whether the editor view may make a request: its own page, the Document
 * Server (its pages, scripts, fonts and its socket — wss for https), and
 * what the page makes itself (data:, blob:). Nothing else, anywhere.
 */
export function officeRequestAllowed(url: string, documentServer: string, hostUrl: string): boolean {
  if (url === hostUrl) return true;
  let u: URL;
  let ds: URL;
  try {
    u = new URL(url);
    ds = new URL(documentServer);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'about:') return true;
  if (u.protocol === 'blob:') return u.origin === ds.origin;
  const secure = ds.protocol === 'https:';
  const schemes = secure ? ['https:', 'wss:'] : ['http:', 'ws:'];
  if (!schemes.includes(u.protocol) || u.username || u.password) return false;
  const port = (x: URL) => x.port || (x.protocol === 'https:' || x.protocol === 'wss:' ? '443' : '80');
  return u.hostname === ds.hostname && port(u) === port(ds);
}

/** The route of a document's window: `/files/office/42`, `?mode=EDIT` when the person chose one. */
export function officeRoute(fileId: number, mode?: string | null): string {
  return `/files/office/${fileId}${mode ? `?mode=${encodeURIComponent(mode)}` : ''}`;
}

/** The file and mode a document window's route names; null for any other route. */
export function parseOfficeRoute(route: string): { fileId: number; mode: string | null } | null {
  const m = /^\/files\/office\/(\d{1,12})(?:\?(.*))?$/.exec(route);
  if (!m) return null;
  const fileId = Number(m[1]);
  if (!Number.isSafeInteger(fileId) || fileId <= 0) return null;
  const mode = new URLSearchParams(m[2] ?? '').get('mode');
  return { fileId, mode: mode && /^(VIEW|EDIT|COMMENT|REVIEW)$/.test(mode) ? mode : null };
}

/** A document open in a window, as the main process knows it. */
export interface OpenOfficeDocument {
  windowId: number;
  fileId: number;
  name: string;
  /** The organisation it was opened in. */
  organizationId: string | null;
  sessionId: string | null;
  /** The editor has changes its Document Server has not taken yet. */
  dirty: boolean;
}

/**
 * "Close documents from Organization A before switching?" (OO-DSK-060): the
 * question to ask before switching to `target`, or null when no open document
 * belongs to another organisation. Switching to All organizations closes
 * nothing.
 */
export function officeSwitchQuestion(
  docs: OpenOfficeDocument[],
  target: string | null,
  organizations: Array<{ id: string; name: string }>,
): { message: string; detail: string } | null {
  if (target === null) return null;
  const going = docs.filter((d) => d.organizationId !== target);
  if (!going.length) return null;
  const names = [...new Set(going.map((d) => organizations.find((o) => o.id === d.organizationId)?.name ?? 'another organization'))];
  const unsaved = going.some((d) => d.dirty);
  return {
    message: `Close documents from ${names.join(' and ')} before switching?`,
    detail: [going.map((d) => d.name).join('\n'), unsaved ? 'Some have changes that have not reached the Document Server yet.' : ''].filter(Boolean).join('\n\n'),
  };
}
