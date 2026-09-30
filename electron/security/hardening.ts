import { app, dialog, protocol, session, shell, type Session, type WebContents } from 'electron';
import { logger } from '../main/log';
import { OFFICE_SCHEME } from './office-policy';

const log = logger('security');

export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Must run before `app.ready`. `app://` is the only origin the shell UI is
 * ever loaded from (FR-SHL-03); it is registered as a standard, secure scheme
 * so the renderer gets a real origin, fetch and CORS semantics.
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
    },
    // The Office editor's own page (office-policy.ts): served only inside the editor's partition, a secure
    // origin of its own so the Document Server's frames run as a secure context.
    { scheme: OFFICE_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

/** The dev server origin, when running under `electron-vite dev`. */
export function devOrigin(): string | null {
  const url = process.env.ELECTRON_RENDERER_URL;
  if (!url || app.isPackaged) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isTrustedShellUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST) return true;
    const dev = devOrigin();
    return dev !== null && u.origin === dev;
  } catch {
    return false;
  }
}

/**
 * Permission requests from renderer content (§13.2). Only the app's own
 * signed pages may ask for anything. The microphone and camera are for voice
 * notes, calls and meetings, which the person starts themselves; screen
 * capture never goes through here (it has its own picker, FR-COM-05).
 * Geolocation, notifications-from-web and every device API stay denied.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen', 'media']);

/** `media` only for the microphone and camera — never `display` capture. */
export function mediaTypesAllowed(types: readonly string[] | undefined): boolean {
  return (types ?? []).every((t) => t === 'audio' || t === 'video');
}

export function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const trusted = isTrustedShellUrl(details.requestingUrl ?? wc?.getURL() ?? '');
    const media = permission === 'media' ? mediaTypesAllowed((details as { mediaTypes?: string[] }).mediaTypes) : true;
    const allow = trusted && ALLOWED_PERMISSIONS.has(permission) && media;
    if (!allow) log.info('permission denied', { permission, url: details.requestingUrl });
    callback(allow);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return isTrustedShellUrl(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission);
  });
  // No devices of any kind are exposed to web content.
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event) => {
    // Downloads go through the transfer manager, never the default handler.
    event.preventDefault();
  });
}

let externalAllowList: string[] = ['worksuite.lk', 'livezen.lk'];

export function setExternalAllowList(hosts: string[]): void {
  externalAllowList = [...new Set(['worksuite.lk', 'livezen.lk', ...hosts])];
}

function hostAllowed(host: string): boolean {
  return externalAllowList.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * shell.openExternal is only ever called here (§13.2): https, mailto, or a
 * phone number to call (tel: with nothing but digits and a leading +, which
 * macOS hands to FaceTime to confirm); a host outside the allow-list is
 * opened only after the user confirms it.
 */
export async function openExternalSafely(raw: string, parent?: Electron.BrowserWindow | null): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === 'mailto:') {
    await shell.openExternal(u.toString());
    return true;
  }
  if (u.protocol === 'tel:') {
    if (!/^\+?\d{3,20}$/.test(u.pathname) || u.search || u.hash) return false;
    await shell.openExternal(`tel:${u.pathname}`);
    return true;
  }
  if (u.protocol !== 'https:' || u.username || u.password) {
    log.warn('blocked external open', { protocol: u.protocol });
    return false;
  }
  if (!hostAllowed(u.hostname)) {
    const opts = {
      type: 'question' as const,
      buttons: ['Open in browser', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Open this link in your browser?',
      detail: u.toString().slice(0, 500),
    };
    const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (response !== 0) return false;
  }
  await shell.openExternal(u.toString());
  return true;
}

/**
 * Where a WebContents that is not the shell may go: the Office editor's view
 * (office-policy.ts) names its own rules — its page, and the Document
 * Server's frames. Every other WebContents keeps the shell's.
 */
export type NavigationRule = (url: string, mainFrame: boolean) => boolean;
const navigationRules = new WeakMap<WebContents, NavigationRule>();

export function setNavigationRule(contents: WebContents, rule: NavigationRule): void {
  navigationRules.set(contents, rule);
}

/** Applied to every WebContents the app creates. */
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    // New windows are created by the window manager, never by content.
    void openExternalSafely(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    const rule = navigationRules.get(contents);
    if (rule ? !rule(url, true) : !isTrustedShellUrl(url)) {
      event.preventDefault();
      log.warn('blocked navigation', { url: url.slice(0, 200) });
    }
  });
  contents.on('will-redirect', (event, url) => {
    const rule = navigationRules.get(contents);
    if (rule ? !rule(event.url, event.isMainFrame) : !isTrustedShellUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    // <webview> is forbidden (§3.3).
    event.preventDefault();
  });
  contents.on('will-frame-navigate', (event) => {
    const rule = navigationRules.get(contents);
    if (rule) {
      if (!event.isMainFrame && !rule(event.url, false)) {
        event.preventDefault();
        log.warn('blocked frame navigation', { url: event.url.slice(0, 200) });
      }
      return;
    }
    // Subframes (mail bodies, previews) are sandboxed srcdoc/blob frames; they
    // may not navigate anywhere.
    if (!event.isMainFrame && !event.url.startsWith('about:')) event.preventDefault();
  });
}

export function installGlobalHardening(): void {
  app.enableSandbox();
  app.on('web-contents-created', (_e, contents) => hardenWebContents(contents));
  hardenSession(session.defaultSession);
}

/** An origin fit for a CSP source list: scheme and host (and port) only, nothing else. */
export function cspOrigin(raw: string | null | undefined, schemes: readonly string[]): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!schemes.includes(u.protocol) || u.username || u.password) return null;
    if (u.pathname !== '/' && u.pathname !== '') return null;
    return u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin;
  } catch {
    return null;
  }
}

export interface CspSources {
  /** The configured WorkSuite server: its signed /media links (images, voice notes, video). */
  server?: string | null;
  /** Media servers the server announced (LiveKit), for calls and meetings. */
  media?: string[];
}

/**
 * Content-Security-Policy for the shell (§3.3). Everything the renderer
 * fetches goes through app://bundle/__api; the only other addresses are the
 * configured server's own media links and the media servers it names.
 */
export function contentSecurityPolicy(sources: CspSources = {}): string {
  const server = cspOrigin(sources.server, ['https:', 'http:']);
  const media = (sources.media ?? []).flatMap((m) => {
    const o = cspOrigin(m, ['wss:', 'https:', 'ws:', 'http:']);
    if (!o) return [];
    // The client signals over wss:// and validates over https:// on the same host.
    const host = o.replace(/^[a-z]+:/, '');
    return o.startsWith('ws') ? [o, `${o.startsWith('wss') ? 'https' : 'http'}:${host}`] : [o, `${o.startsWith('https') ? 'wss' : 'ws'}:${host}`];
  });
  const extra = (list: Array<string | null>) => list.filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${extra([server])}`.trim(),
    "font-src 'self' data:",
    `media-src 'self' blob: ${extra([server])}`.trim(),
    `connect-src 'self' ${extra([...new Set(media)])}`.trim(),
    "frame-src 'self' blob: about:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
