import { app, protocol } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
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

/**
 * app://bundle/…          → the signed renderer bundle (inside the asar).
 * app://bundle/__api/…    → the WorkSuite API, through the main process, which
 *                           adds the session's credentials. The renderer never
 *                           holds a token and never talks to the network itself.
 * app://bundle/__local/…  → what the app keeps for its own pages (a course's
 *                           offline lessons, decrypted as they are read).
 */
export function registerAppProtocol(apiProxy: ApiProxyHandler, cspSources: () => CspSources = () => ({}), local?: LocalHandler): void {
  const root = rendererRoot();
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
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
  });
}
