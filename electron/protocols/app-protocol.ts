import { app, protocol, type Session } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { isSafeHeaderValue, normalizeContentDisposition, sanitizeHeaderValue } from '@shared/http-headers';
import { APP_HOST, contentSecurityPolicy, devOrigin, type CspSources } from '../security/hardening';
import { logger } from '../main/log';

const log = logger('app-protocol');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json; charset=utf-8',
};

export type ApiProxyHandler = (request: Request, apiPath: string) => Promise<Response>;
/** What the app keeps on this computer for its own pages (eLearning's offline copies), by path under `/__local`. */
export type LocalHandler = (request: Request, path: string) => Promise<Response>;

function rendererRoot(): string {
  return resolve(join(__dirname, '../renderer'));
}

/**
 * Resolves a bundle path to a file strictly inside the renderer output.
 * Exported for tests: `..`, encoded traversal and absolute paths all fail.
 */
export function resolveBundlePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = normalize(decoded.replace(/^\/+/, '') || 'index.html');
  const full = resolve(root, rel);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

function corsHeaders(request: Request): Record<string, string> {
  // Only the Vite dev server (development builds) is cross-origin.
  const dev = devOrigin();
  const origin = request.headers.get('origin');
  if (dev && origin === dev) {
    return {
      'Access-Control-Allow-Origin': dev,
      'Access-Control-Allow-Headers': 'Content-Type, If-Match, If-None-Match, Idempotency-Key, X-Folder-Password, Range',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
      'Access-Control-Expose-Headers': 'X-WS-Offline, X-WS-Cached-At, Content-Disposition',
    };
  }
  return {};
}

/** What a request that failed inside the handler answers: a plain 500, its headers fixed ASCII (#253). */
export function failedResponse(): Response {
  return new Response(JSON.stringify({ status: 'error', message: "Couldn't open this. Try again.", code: 'INTERNAL' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * A response as the protocol hands it to Chromium (worksuite-desktop#253): every header value in plain ASCII.
 * `Content-Disposition` carries a file name only as RFC 5987 (`filename*=UTF-8''…`, with an ASCII fallback); any
 * other value outside ASCII is cleaned. A response that is already plain goes as it is, body untouched.
 */
export function protocolSafeResponse(res: Response): Response {
  let plain = true;
  res.headers.forEach((v) => {
    if (!isSafeHeaderValue(v, 0x7e)) plain = false;
  });
  if (plain) return res;
  const headers = new Headers();
  res.headers.forEach((v, k) => {
    headers.append(k, k === 'content-disposition' ? normalizeContentDisposition(v) : sanitizeHeaderValue(v, { ascii: true }));
  });
  const nullBody = [101, 204, 205, 304].includes(res.status);
  return new Response(nullBody ? null : res.body, { status: res.status, statusText: sanitizeHeaderValue(res.statusText, { ascii: true }), headers });
}

/**
 * app://bundle/…          → the signed renderer bundle (inside the asar).
 * app://bundle/__api/…    → the WorkSuite API, through the main process, which
 *                           adds the session's credentials. The renderer never
 *                           holds a token and never talks to the network itself.
 * app://bundle/__local/…  → what the app keeps for its own pages (a course's
 *                           offline lessons, decrypted as they are read).
 *
 * The handler never throws (#253): whatever goes wrong building an answer — a header no header may carry, a proxy
 * that failed — is that request's 500, logged by path, and the page shows its own error with Retry.
 */
export function createAppHandler(root: string, apiProxy: ApiProxyHandler, cspSources: () => CspSources = () => ({}), local?: LocalHandler): (request: Request) => Promise<Response> {
  const serve = async (request: Request, url: URL): Promise<Response> => {
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });

    if (url.pathname.startsWith('/__api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
      const apiPath = url.pathname.slice('/__api'.length) + url.search;
      const res = await apiProxy(request, apiPath);
      const extra = corsHeaders(request);
      if (Object.keys(extra).length === 0) return res;
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(extra)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }

    if (url.pathname.startsWith('/__local/')) {
      if (!local) return new Response('Not found', { status: 404 });
      return local(request, url.pathname.slice('/__local'.length));
    }

    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const file = resolveBundlePath(root, url.pathname);
    if (!file) return new Response('Forbidden', { status: 403 });
    try {
      const s = await stat(file);
      if (!s.isFile()) return new Response('Not found', { status: 404 });
      const body = await readFile(file);
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const headers: Record<string, string> = {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      };
      if (type.startsWith('text/html')) {
        headers['Content-Security-Policy'] = contentSecurityPolicy(cspSources());
        headers['Cross-Origin-Opener-Policy'] = 'same-origin';
        headers['Referrer-Policy'] = 'no-referrer';
      }
      // The speech page (worksuite-desktop#81) is cross-origin isolated, so whisper.cpp can share memory between its
      // threads. Only it: the rest of the app embeds things isolation would refuse.
      if (url.pathname === '/speech.html' || url.pathname.startsWith('/speech/')) {
        headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
        headers['Cross-Origin-Resource-Policy'] = 'same-origin';
      }
      return new Response(body, { status: 200, headers });
    } catch (e) {
      if (!app.isPackaged) log.debug('bundle file missing', { path: url.pathname, error: String(e) });
      return new Response('Not found', { status: 404 });
    }
  };

  return async (request) => {
    let path = '';
    try {
      const url = new URL(request.url);
      path = url.pathname.split('/').slice(0, 4).join('/');
      const res = await serve(request, url);
      if (!(res instanceof Response)) throw new TypeError('the handler gave no response');
      return protocolSafeResponse(res);
    } catch (e) {
      // The path's first segments only: never a file name, a query or a token.
      log.error('app protocol request failed', { path, error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : String(e).slice(0, 200) });
      try {
        return failedResponse();
      } catch {
        return new Response(null, { status: 500 });
      }
    }
  };
}

/**
 * `app://` for a session's pages. Without `ses`, the default session's (`protocol` is its). Each account's window
 * partition gets its own (Connection & Startup §1.1, `installShellSession`): a protocol handler belongs to a session.
 */
export function registerAppProtocol(apiProxy: ApiProxyHandler, cspSources: () => CspSources = () => ({}), local?: LocalHandler, ses?: Session): void {
  const target = ses?.protocol ?? protocol;
  if (target.isProtocolHandled?.('app')) return;
  target.handle('app', createAppHandler(rendererRoot(), apiProxy, cspSources, local));
}
