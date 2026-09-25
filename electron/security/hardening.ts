import { app, dialog, protocol, session, shell, type Session, type WebContents } from 'electron';
import { logger } from '../main/log';

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
 * Permission requests from renderer content (§13.2). Phase 1 has no camera,
 * microphone or screen capture: Meet arrives in Phase 2 with its own window
 * and an explicit user action. Geolocation is always denied.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

export function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const trusted = isTrustedShellUrl(details.requestingUrl ?? wc?.getURL() ?? '');
    const allow = trusted && ALLOWED_PERMISSIONS.has(permission);
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
 * shell.openExternal is only ever called here (§13.2): https or mailto, and a
 * host outside the allow-list is opened only after the user confirms it.
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

/** Applied to every WebContents the app creates. */
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    // New windows are created by the window manager, never by content.
    void openExternalSafely(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedShellUrl(url)) {
      event.preventDefault();
      log.warn('blocked navigation', { url: url.slice(0, 200) });
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedShellUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    // <webview> is forbidden (§3.3).
    event.preventDefault();
  });
  contents.on('will-frame-navigate', (event) => {
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

/** Content-Security-Policy for the shell (§3.3). */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'self' blob: about:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
