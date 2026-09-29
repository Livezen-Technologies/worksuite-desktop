/**
 * The Office editor's isolation rules (OO-DSK-020/021, AC-21), as pure
 * functions the editor host and the tests share.
 *
 * The editor runs in a WebContentsView of its own: its own partition (one
 * per organisation, in memory, cleared when its last document closes), its
 * own renderer process, sandboxed, context-isolated, with no Node and no
 * `window.worksuite`. Its page is `wsoffice://editor/…`, served only inside
 * that partition, which has no `app://` handler — so no WorkSuite API proxy,
 * no token, nothing of the shell. From there it may reach the configured
 * Document Server's origin and, for the pictures the editor shows (people's
 * avatars), the WorkSuite server's; nothing else.
 */

export const OFFICE_SCHEME = 'wsoffice';
export const OFFICE_HOST = 'editor';
export const OFFICE_PAGE = `${OFFICE_SCHEME}://${OFFICE_HOST}/index.html`;

/** Where the editor's page may go and what it may fetch. */
export interface OfficeOrigins {
  /** The Document Server (`https://docs.example.com`). */
  documentServer: string;
  /** The WorkSuite server (avatars in the editor's user list); null when none is configured. */
  worksuite: string | null;
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** `https://docs.example.com` → `wss://docs.example.com` (the editor's socket). */
function socketOrigin(origin: string): string {
  return origin.replace(/^http/, 'ws');
}

function isOurPage(u: URL): boolean {
  return u.protocol === `${OFFICE_SCHEME}:` && u.host === OFFICE_HOST;
}

/**
 * A request from the editor's partition (`webRequest.onBeforeRequest`):
 * its own page, the Document Server (pages, scripts, fonts, the socket),
 * the WorkSuite server's pictures, and data/blob URLs the editor makes.
 */
export function officeRequestAllowed(raw: string, o: OfficeOrigins): boolean {
  if (raw.startsWith('data:') || raw.startsWith('blob:') || raw === 'about:blank' || raw === 'about:srcdoc') return true;
  const u = parse(raw);
  if (!u || u.username || u.password) return false;
  if (isOurPage(u)) return true;
  if (u.origin === o.documentServer || u.origin === socketOrigin(o.documentServer)) return true;
  // The avatars in the editor's user list; no credentials go with them (this partition has none).
  return o.worksuite !== null && u.origin === o.worksuite && (u.protocol === 'https:' || u.protocol === 'http:');
}

/**
 * A navigation in the editor's view: the page itself never navigates away
 * (links open in the system browser through the window-open handler, after
 * the usual check); its frames may be the Document Server's, or the
 * editor's own blank and blob frames.
 */
export function officeNavigationAllowed(raw: string, mainFrame: boolean, o: OfficeOrigins): boolean {
  const u = parse(raw);
  if (!u) return false;
  if (mainFrame) return isOurPage(u) && u.pathname === '/index.html';
  if (raw === 'about:blank' || raw === 'about:srcdoc') return true;
  if (u.protocol === 'blob:') return parse(u.pathname)?.origin === o.documentServer;
  return u.origin === o.documentServer && !u.username && !u.password;
}

/**
 * The editor page's Content-Security-Policy: its own script, the Document
 * Server's `api.js`, frames and connections to the Document Server only.
 */
export function officeHostCsp(o: OfficeOrigins): string {
  const ds = o.documentServer;
  const img = [`'self'`, 'data:', 'blob:', ds, ...(o.worksuite ? [o.worksuite] : [])].join(' ');
  return [
    "default-src 'none'",
    `script-src 'self' ${ds}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img}`,
    `font-src ${ds} data:`,
    `connect-src ${ds} ${socketOrigin(ds)}`,
    `frame-src ${ds} blob:`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * The editor's partition, one per organisation (OO-DSK-023): in memory (no
 * `persist:`), so nothing of it outlives the app, and cleared when its last
 * document closes and at sign-out.
 */
export function officePartition(organizationId: string | null): string {
  const id = organizationId && /^[A-Za-z0-9_-]{1,64}$/.test(organizationId) ? organizationId : 'personal';
  return `ws-office-${id}`;
}

/** A key press in the editor, as `before-input-event` reports it. */
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/**
 * Which of the app menu's shortcuts still work while the editor has the
 * keyboard: closing and opening tabs, and quitting. Every other one belongs
 * to the editor — ⌘/Ctrl+K is Insert link there, not Search; ⌘/Ctrl+L is
 * Align left, not Lock WorkSuite.
 */
export function menuKeepsShortcut(input: KeyInput, platform: string): boolean {
  const mod = platform === 'darwin' ? input.meta : input.control;
  if (!mod || input.alt) return false;
  const k = input.key.toLowerCase();
  if (k === 'w' || k === 't') return true;
  return platform === 'darwin' && k === 'q' && !input.shift;
}
