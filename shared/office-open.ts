/**
 * "Open with" for Word, Excel and PowerPoint files (worksuite-desktop#322): where an Office file opens — WorkSuite
 * Office (the separate desktop editor), WorkSuite's built-in editor (an Office tab in this app) or the system's
 * default app — by the person's choice in the menu, or by Settings › Files › "Open Office files in" for a
 * double-click. Plain rules, shared by the renderer (menus, double-click) and the main process (the link it hands
 * to WorkSuite Office); nothing here touches the screen or the operating system.
 *
 * The link to WorkSuite Office (contract v1, the WorkSuite Office side implements it):
 *
 *   worksuiteoffice://open?v=1&server=<origin>&uid=<user id>[&org=<id>]&file=<Drive file id>&name=<name>[&mode=edit|view]
 *   worksuiteoffice://open?v=1&server=<origin>&uid=<user id>[&org=<id>]&src=</api/… or /media/… path>&name=<name>
 *
 *  - `file`: a Drive file. WorkSuite Office opens it through its own WorkSuite sign-in (the "Continue as" connection
 *    of worksuite-office#6, for `uid` on `server`), and Save writes a new version of that same file
 *    (`POST /api/files/{id}/versions` with `base_version`), never a downloaded copy.
 *  - `src`: a copy of a file that is not in Drive (a mail attachment, a chat upload) that the person chose to open
 *    without saving it to Drive first: WorkSuite Office reads it from this server with its own sign-in, and Save
 *    asks where to put it.
 *  - A file already open in WorkSuite Office is brought to the front rather than opened twice (it is one app per
 *    computer; a second launch hands it the link).
 */
import { routeParam } from './office';

// ── what kind of Office file ─────────────────────────────────────────────

export type OfficeOpenKind = 'doc' | 'sheet' | 'slides';

export const OFFICE_OPEN_KINDS: readonly OfficeOpenKind[] = ['doc', 'sheet', 'slides'];

/** How Settings names each kind. */
export const OFFICE_OPEN_KIND_LABELS: Record<OfficeOpenKind, string> = { doc: 'Documents', sheet: 'Spreadsheets', slides: 'Presentations' };

const EXTENSIONS: Record<OfficeOpenKind, readonly string[]> = {
  doc: ['docx', 'doc', 'docm', 'dotx', 'odt', 'rtf'],
  sheet: ['xlsx', 'xls', 'xlsm', 'xltx', 'ods', 'csv'],
  slides: ['pptx', 'ppt', 'pptm', 'potx', 'odp', 'ppsx'],
};

const KIND_OF = new Map<string, OfficeOpenKind>(OFFICE_OPEN_KINDS.flatMap((k) => EXTENSIONS[k].map((e) => [e, k] as const)));

/** Word, Excel or PowerPoint (or their OpenDocument cousins), by the extension or the name's; null for anything else. */
export function officeOpenKind(name: string, extension?: string | null): OfficeOpenKind | null {
  const e = (extension || (name.includes('.') ? name.split('.').pop() : '') || '').toLowerCase();
  return KIND_OF.get(e) ?? null;
}

/** Every extension "Open with" is offered for, by kind (WorkSuite Office registers the same ones with the system). */
export function officeOpenExtensions(kind: OfficeOpenKind): readonly string[] {
  return EXTENSIONS[kind];
}

// ── where it opens ───────────────────────────────────────────────────────

/** `builtin`: WorkSuite's own editor tab; `worksuite-office`: the desktop editor; `system`: the default app here. */
export type OfficeOpenTarget = 'builtin' | 'worksuite-office' | 'system';
export const OFFICE_OPEN_TARGETS: readonly OfficeOpenTarget[] = ['builtin', 'worksuite-office', 'system'];

/** What Settings may hold per kind: a place, or "Ask every time". */
export type OfficeOpenChoice = OfficeOpenTarget | 'ask';
export const OFFICE_OPEN_CHOICES: readonly OfficeOpenChoice[] = ['builtin', 'worksuite-office', 'ask', 'system'];

export const OFFICE_OPEN_CHOICE_LABELS: Record<OfficeOpenChoice, string> = {
  builtin: 'Built-in editor',
  'worksuite-office': 'WorkSuite Office',
  ask: 'Ask every time',
  system: 'Default app on this computer',
};

export const OFFICE_OPEN_TARGET_LABELS: Record<OfficeOpenTarget, string> = {
  builtin: 'WorkSuite (in app)',
  'worksuite-office': 'WorkSuite Office',
  system: 'Default app on this computer',
};

/** Settings › Files › "Open Office files in", per kind. */
export type OfficeOpenPrefs = Record<OfficeOpenKind, OfficeOpenChoice>;

/** The built-in editor until the person chooses otherwise: nothing changes for anyone who never opens the setting. */
export const DEFAULT_OFFICE_OPEN_PREFS: OfficeOpenPrefs = { doc: 'builtin', sheet: 'builtin', slides: 'builtin' };

/** A saved value made whole: a missing or unknown kind takes its default. */
export function normalizeOfficeOpenPrefs(p: Partial<Record<string, unknown>> | null | undefined): OfficeOpenPrefs {
  const out = { ...DEFAULT_OFFICE_OPEN_PREFS };
  for (const k of OFFICE_OPEN_KINDS) {
    const v = p?.[k];
    if (typeof v === 'string' && (OFFICE_OPEN_CHOICES as readonly string[]).includes(v)) out[k] = v as OfficeOpenChoice;
  }
  return out;
}

/** What the main process says about WorkSuite Office here (`office:desktopApp`). */
export interface OfficeAppStatus {
  installed: boolean;
  /** The app the system hands `worksuiteoffice://` links to, as it names it; null when none. */
  appName: string | null;
  /** Links may be handed to it here: signed in, and the policy lets files open in other apps. */
  canOpen: boolean;
}

/** Whether WorkSuite Office is on this computer: true / false, or null while not yet known. */
export type OfficeAppInstalled = boolean | null;

export interface OfficeOpenRequest {
  name: string;
  extension?: string | null;
  /** In Drive (saves go back as versions), or a file shown by another module (a mail attachment, a chat upload). */
  inDrive: boolean;
  /** The person picked a place from "Open with"; absent for a double-click, which follows the setting. */
  chosen?: OfficeOpenTarget | null;
  prefs: Partial<OfficeOpenPrefs> | null | undefined;
  installed: OfficeAppInstalled;
  /** The built-in editor can open this file (the attachment editor handles .docx, .xlsx and .pptx only). */
  builtinOk?: boolean;
}

/**
 * What opening does:
 *  - `none`: not an Office file, the caller opens it its own way;
 *  - `ask`: "Ask every time" — show the choices;
 *  - `not-installed`: WorkSuite Office was wanted but is not here — offer Download, or the built-in editor;
 *  - `save-first`: WorkSuite Office for a file not in Drive — "Save to Drive first?";
 *  - `open`: open it there.
 */
export type OfficeOpenDecision =
  | { kind: 'none' }
  | { kind: 'ask'; officeKind: OfficeOpenKind; choices: OfficeOpenTarget[] }
  | { kind: 'not-installed'; officeKind: OfficeOpenKind; fallback: OfficeOpenTarget }
  | { kind: 'save-first'; officeKind: OfficeOpenKind }
  | { kind: 'open'; officeKind: OfficeOpenKind; target: OfficeOpenTarget };

export function decideOfficeOpen(r: OfficeOpenRequest): OfficeOpenDecision {
  const officeKind = officeOpenKind(r.name, r.extension);
  if (!officeKind) return { kind: 'none' };
  const builtinOk = r.builtinOk !== false;
  const choice: OfficeOpenChoice = r.chosen ?? normalizeOfficeOpenPrefs(r.prefs)[officeKind];
  if (choice === 'ask') return { kind: 'ask', officeKind, choices: OFFICE_OPEN_TARGETS.filter((t) => t !== 'builtin' || builtinOk) };
  if (choice === 'worksuite-office') {
    // Not known yet counts as here: the main process checks again and refuses if it is not.
    if (r.installed === false) return { kind: 'not-installed', officeKind, fallback: builtinOk ? 'builtin' : 'system' };
    if (!r.inDrive) return { kind: 'save-first', officeKind };
    return { kind: 'open', officeKind, target: 'worksuite-office' };
  }
  if (choice === 'builtin' && !builtinOk) return { kind: 'open', officeKind, target: 'system' };
  return { kind: 'open', officeKind, target: choice };
}

// ── the link to WorkSuite Office ─────────────────────────────────────────

export const OFFICE_APP_PROTOCOL = 'worksuiteoffice';
export const OFFICE_APP_NAME = 'WorkSuite Office';
/** Where WorkSuite Office is downloaded (the Update Center, electron/updater/update-center.ts). */
export const OFFICE_APP_DOWNLOAD_URL = 'https://download.worksuitecloud.com/worksuite-office';

const MAX_LINK = 2048;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** The paths this server serves a file at (the same grammar as an Office tab's `api` source, shared/office.ts). */
export const OFFICE_APP_SRC = /^\/(api|media)\/[A-Za-z0-9._~\-/%?=&+:,]{1,1500}$/;

export type OfficeAppDocument = { file: number; mode?: 'edit' | 'view' | null } | { src: string };

export interface OfficeAppLink {
  /** The WorkSuite server's origin. */
  server: string;
  uid: string;
  org?: string | null;
  name: string;
  doc: OfficeAppDocument;
}

/** The server's origin when it may go in a link: https (http only on this computer), no credentials, nothing after the host. */
export function officeAppServer(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
    if (u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return u.origin;
    return null;
  } catch {
    return null;
  }
}

const safeName = (n: string) => n.replace(/[/\\\p{C}]/gu, '-').slice(0, 200) || 'Document';

/** Builds the link; throws on anything that must not reach another program. */
export function officeAppLink(l: OfficeAppLink): string {
  const server = officeAppServer(l.server);
  if (!server) throw new Error('server');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(l.uid)) throw new Error('uid');
  if (l.org != null && !/^\d{1,12}$/.test(l.org)) throw new Error('org');
  const q: string[] = ['v=1', `server=${routeParam(server)}`, `uid=${routeParam(l.uid)}`];
  if (l.org != null) q.push(`org=${l.org}`);
  if ('file' in l.doc) {
    if (!Number.isInteger(l.doc.file) || l.doc.file <= 0 || l.doc.file > 2 ** 31) throw new Error('file');
    q.push(`file=${l.doc.file}`);
  } else {
    if (!OFFICE_APP_SRC.test(l.doc.src) || l.doc.src.includes('..')) throw new Error('src');
    q.push(`src=${routeParam(l.doc.src)}`);
  }
  q.push(`name=${routeParam(safeName(l.name))}`);
  if ('file' in l.doc && l.doc.mode) q.push(`mode=${l.doc.mode}`);
  const link = `${OFFICE_APP_PROTOCOL}://open?${q.join('&')}`;
  if (link.length > MAX_LINK) throw new Error('too-long');
  return link;
}

const KEYS = new Set(['v', 'server', 'uid', 'org', 'file', 'src', 'name', 'mode']);

/** Reads a link back (WorkSuite Office's side of the contract, and this app's tests): refuses anything else. */
export function parseOfficeAppLink(url: string): { ok: true; link: OfficeAppLink } | { ok: false; reason: string } {
  if (url.length > MAX_LINK) return { ok: false, reason: 'too-long' };
  const m = /^worksuiteoffice:\/\/open\?([^#]*)$/i.exec(url);
  if (!m) return { ok: false, reason: 'not-open' };
  const q = new URLSearchParams(m[1]);
  const seen = new Set<string>();
  for (const k of q.keys()) {
    if (!KEYS.has(k)) return { ok: false, reason: 'unknown-param' };
    if (seen.has(k)) return { ok: false, reason: 'duplicate-param' };
    seen.add(k);
  }
  if (q.get('v') !== '1') return { ok: false, reason: 'version' };
  const server = officeAppServer(q.get('server') ?? '');
  if (!server) return { ok: false, reason: 'server' };
  const uid = q.get('uid') ?? '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) return { ok: false, reason: 'uid' };
  const org = q.get('org');
  if (org !== null && !/^\d{1,12}$/.test(org)) return { ok: false, reason: 'org' };
  const file = q.get('file');
  const src = q.get('src');
  if ((file === null) === (src === null)) return { ok: false, reason: 'document' };
  let doc: OfficeAppDocument;
  if (file !== null) {
    if (!/^\d{1,10}$/.test(file) || Number(file) <= 0 || Number(file) > 2 ** 31) return { ok: false, reason: 'file' };
    const mode = q.get('mode');
    if (mode !== null && mode !== 'edit' && mode !== 'view') return { ok: false, reason: 'mode' };
    doc = { file: Number(file), mode: mode as 'edit' | 'view' | null };
  } else {
    if (!OFFICE_APP_SRC.test(src!) || src!.includes('..')) return { ok: false, reason: 'src' };
    if (q.has('mode')) return { ok: false, reason: 'mode' };
    doc = { src: src! };
  }
  return { ok: true, link: { server, uid, org, name: safeName(q.get('name') ?? ''), doc } };
}
