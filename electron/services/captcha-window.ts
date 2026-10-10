import { BrowserWindow, session } from 'electron';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';
import { setNavigationRule } from '../security/hardening';

const log = logger('captcha');

/**
 * The sign-in CAPTCHA (worksuite-desktop#301), in a small window of its own.
 *
 * WHY A WINDOW, AND WHY THE SERVER'S PAGE. A CAPTCHA's site key is registered for the WorkSuite server's domain, and
 * Turnstile, hCaptcha and reCAPTCHA all refuse to draw their widget on any other — `app://bundle`, where the app's
 * screens come from, included. So the widget is shown on the server's own page, `/desktop/captcha`, in a modal
 * window: its own in-memory partition (no cookies, no storage, nothing of the shell's), sandboxed, no preload, no
 * Node, and no permissions. The shell's Content-Security-Policy is not loosened for any provider: no provider script
 * ever runs in the app's own pages.
 *
 * WHERE IT MAY GO. The page itself, only; its frames, only the configured providers' hosts. Links open in the system
 * browser after the usual check (hardening.ts).
 *
 * WHAT COMES BACK. The page puts the provider's token in its own fragment (`#captcha=…`); the window reads it from
 * there, closes, and the token goes with the next sign-in only, where the server checks it with the provider.
 */

export const CAPTCHA_PATH = '/desktop/captcha';
/** The partition: in memory (no `persist:`), so nothing the providers set outlives the app. */
export const CAPTCHA_PARTITION = 'ws-captcha';
const WINDOW_MS = 5 * 60_000;

/** The hosts the providers' frames and scripts come from. */
const PROVIDER_HOSTS = ['challenges.cloudflare.com', 'hcaptcha.com', 'www.google.com', 'www.gstatic.com', 'www.recaptcha.net'];

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function providerHost(host: string): boolean {
  return PROVIDER_HOSTS.some((h) => host === h || (h === 'hcaptcha.com' && host.endsWith('.hcaptcha.com')));
}

/** The page the window opens. */
export function captchaPageUrl(origin: string): string {
  return `${origin}${CAPTCHA_PATH}`;
}

/** A navigation in the CAPTCHA window: the page (main frame) or a provider's frame. */
export function captchaNavigationAllowed(raw: string, mainFrame: boolean, origin: string): boolean {
  if (!mainFrame && (raw === 'about:blank' || raw === 'about:srcdoc')) return true;
  const u = parse(raw);
  if (!u || u.username || u.password) return false;
  if (mainFrame) return u.origin === origin && u.pathname === CAPTCHA_PATH;
  return u.protocol === 'https:' && providerHost(u.hostname);
}

/** The token in the page's address once it has one, or null. Only from the page itself, on the configured server. */
export function captchaTokenFrom(raw: string, origin: string): string | null {
  const u = parse(raw);
  if (!u || u.origin !== origin || u.pathname !== CAPTCHA_PATH) return null;
  const m = /^#captcha=([^&]+)$/.exec(u.hash);
  if (!m) return null;
  let token: string;
  try {
    token = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9._:\-*]{10,4096}$/.test(token) ? token : null;
}

let open: Promise<string | null> | null = null;

/**
 * Show the CAPTCHA and wait for it. The token, or null when the window was closed without solving it (or took longer
 * than five minutes). One window at a time: a second ask joins the first.
 */
export function solveCaptcha(origin: string, opts: { parent?: BrowserWindow | null; devTools?: boolean } = {}): Promise<string | null> {
  if (open) return open;
  const flight = new Promise<string | null>((resolve, reject) => {
    const ses = session.fromPartition(CAPTCHA_PARTITION, { cache: false });
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault());

    const parent = opts.parent && !opts.parent.isDestroyed() ? opts.parent : undefined;
    const win = new BrowserWindow({
      ...(parent ? { parent, modal: true } : {}),
      width: 440,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'Confirm you are not a robot',
      autoHideMenuBar: true,
      webPreferences: {
        partition: CAPTCHA_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: false,
        safeDialogs: true,
        devTools: opts.devTools ?? false,
      },
    });
    win.setMenu(null);
    const wc = win.webContents;
    setNavigationRule(wc, (url, mainFrame) => captchaNavigationAllowed(url, mainFrame, origin));

    let settled = false;
    const finish = (token: string | null, error?: DesktopError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.close();
      if (error) reject(error);
      else resolve(token);
    };
    const timer = setTimeout(() => finish(null), WINDOW_MS);
    timer.unref?.();

    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      const token = captchaTokenFrom(url, origin);
      if (token) finish(token);
    });
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ABORTED: a navigation replaced it */) return;
      log.warn('captcha page did not load', { code, description, url: url.slice(0, 200) });
      finish(null, new DesktopError('NETWORK_UNREACHABLE', 'The CAPTCHA could not be loaded from your WorkSuite server. Check your connection and try again.'));
    });
    wc.on('render-process-gone', () => finish(null));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => finish(null));

    void win.loadURL(captchaPageUrl(origin)).catch(() => undefined);
  }).finally(() => {
    if (open === flight) open = null;
  });
  open = flight;
  return flight;
}
