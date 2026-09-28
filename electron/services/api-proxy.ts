import { UNREACHABLE_MESSAGE, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import type { CacheLimits, OfflineCache } from './offline-cache';

const log = logger('api-proxy');

/**
 * Renderer → WorkSuite API, via the main process.
 *
 * Only `/api/…` paths are forwarded, and never the ones that carry
 * credentials: sign-in, refresh and MFA answers contain tokens; realtime
 * tickets and the device-sync API are for the main process alone. Cookies and
 * Authorization headers from the renderer are dropped; the main process adds
 * its own.
 *
 * My account manages the person's own sign-in methods, so under /api/auth a
 * few calls pass, by method: reading and setting up two-factor (the setup's
 * key and the backup codes are the person's to see — no token is in them),
 * listing, renaming and revoking passkeys, and listing and ending ONE
 * session. Answering a sign-in (`POST /auth/mfa`), exchanging a passkey
 * code, ending every session at once and changing the password stay out:
 * the last goes through the main process, which keeps this app signed in
 * across it (`auth:changePassword`).
 */
const PATH_OK = /^\/api\/[A-Za-z0-9/_\-.,:@~]*(\?.*)?$/;

const ACCOUNT: Array<[RegExp, string[]]> = [
  [/^\/api\/auth\/mfa$/, ['GET', 'DELETE']],
  [/^\/api\/auth\/mfa\/(setup|confirm|backup-codes)$/, ['POST']],
  [/^\/api\/auth\/passkeys$/, ['GET']],
  [/^\/api\/auth\/passkeys\/\d+$/, ['PATCH', 'DELETE']],
  [/^\/api\/auth\/sessions$/, ['GET']],
  [/^\/api\/auth\/sessions\/\d+$/, ['DELETE']],
];

const DENY: RegExp[] = [
  /^\/api\/auth\/(login|refresh|mfa|logout|register|passkeys|password|sessions)(\/|\?|$)/,
  /^\/api\/notifications\/realtime-ticket/,
  /^\/api\/sync\//,
  /^\/api\/api-keys/,
  // Meet remote control, the shared computer's side: allowing control, resuming it, reporting what was
  // refused and saying what this computer can do are the main process's alone (it holds the proof of a
  // local click and the grant). The page can still ask, cancel, pause and stop.
  /^\/api\/meet\/control\/requests\/\d+\/answer\/?$/,
  /^\/api\/meet\/control\/sessions\/\d+\/(resume|security)\/?$/,
  /^\/api\/meet\/devices\/\d+\/capabilities\/?$/,
];

/** The shared computer's grant (`?end=sharer`): its key never reaches a page. */
function isSharerGrant(pathOnly: string, apiPath: string): boolean {
  if (!/^\/api\/meet\/control\/sessions\/\d+\/grant\/?$/.test(pathOnly)) return false;
  const q = apiPath.includes('?') ? apiPath.slice(apiPath.indexOf('?') + 1) : '';
  try {
    return [...new URLSearchParams(q).entries()].some(([k, v]) => k.startsWith('end') && v.trim().toLowerCase() === 'sharer');
  } catch {
    return true;
  }
}

const FORWARD_HEADERS = ['content-type', 'accept', 'if-match', 'if-none-match', 'idempotency-key', 'x-folder-password', 'range'];
const RETURN_HEADERS = ['content-type', 'content-disposition', 'content-length', 'etag', 'last-modified', 'accept-ranges', 'content-range', 'retry-after'];
const MAX_BODY = 25 * 1024 * 1024;

/**
 * A signed media address (`/media/{token}`), which the server serves without
 * credentials and without CORS headers. Reading one through here puts it on
 * the app's own origin, so a canvas can use the pixels (the image editor
 * saves what it draws). Read only.
 */
const MEDIA = /^\/media\/[A-Za-z0-9_\-~.]{8,512}(\?download=1)?$/;

export function isMediaPath(apiPath: string): boolean {
  return MEDIA.test(apiPath);
}

export function isProxyPathAllowed(apiPath: string, method = 'GET'): boolean {
  if (MEDIA.test(apiPath)) return ['GET', 'HEAD'].includes(method.toUpperCase());
  if (!PATH_OK.test(apiPath)) return false;
  const pathOnly = apiPath.split('?')[0]!;
  if (pathOnly.includes('..') || pathOnly.includes('//')) return false;
  const m = method.toUpperCase();
  if (ACCOUNT.some(([re, methods]) => re.test(pathOnly) && methods.includes(m))) return true;
  if (isSharerGrant(pathOnly, apiPath)) return false;
  return !DENY.some((re) => re.test(pathOnly));
}

export interface ProxyDeps {
  http: HttpClient;
  cache: OfflineCache;
  userId: () => string | null;
  /** Which module's READ_CACHE covers this GET path, if any. */
  cacheModuleFor: (path: string) => string | null;
  cacheLimits: () => CacheLimits;
  /** Mail bodies are cached only when the mail cache window is not "headers only". */
  mailBodiesCached: () => boolean;
}

function envelope(status: number, message: string, code: string): Response {
  return new Response(JSON.stringify({ status: 'error', message, code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createApiProxy(deps: ProxyDeps) {
  return async function proxy(request: Request, apiPath: string): Promise<Response> {
    if (!isProxyPathAllowed(apiPath, request.method)) {
      log.warn('proxy refused path', { path: apiPath.split('?')[0] });
      return envelope(403, 'This request is not available to the desktop shell.', 'IPC_FORBIDDEN_SENDER');
    }
    const userId = deps.userId();
    if (!userId) return envelope(401, 'Not signed in.', 'NOT_SIGNED_IN');

    const method = request.method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) return envelope(405, 'Method not allowed.', 'INTERNAL');
    if (isMediaPath(apiPath) && method !== 'GET' && method !== 'HEAD') return envelope(405, 'Media is read only.', 'INTERNAL');

    const headers = new Headers();
    for (const h of FORWARD_HEADERS) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    let body: ArrayBuffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY) return envelope(413, 'That request is too large; use the upload manager.', 'INTERNAL');
    }

    const cacheModule = method === 'GET' ? deps.cacheModuleFor(apiPath) : null;
    const isMailBody = /^\/api\/mail\/messages\/\d+/.test(apiPath);
    const cacheable = cacheModule !== null && (!isMailBody || deps.mailBodiesCached());

    let upstream: Response;
    try {
      upstream = await deps.http.raw(method, deps.http.url(apiPath), { headers, body, timeoutMs: 60_000 });
    } catch (e) {
      if (cacheable || cacheModule) {
        const hit = deps.cache.get(userId, apiPath);
        if (hit) {
          return new Response(hit.body, {
            status: hit.status,
            headers: { 'Content-Type': hit.contentType, 'X-WS-Offline': '1', 'X-WS-Cached-At': hit.cachedAt },
          });
        }
      }
      const code = isDesktopError(e) ? e.code : 'NETWORK_UNREACHABLE';
      const message = isDesktopError(e) ? e.message : UNREACHABLE_MESSAGE;
      return envelope(code === 'CANCELLED' ? 499 : 503, message, code);
    }

    const out = new Headers();
    for (const h of RETURN_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }

    const type = upstream.headers.get('content-type') ?? '';
    if (cacheable && upstream.status === 200 && type.includes('json')) {
      const text = await upstream.text();
      try {
        deps.cache.put(userId, cacheModule!, apiPath, { status: 200, contentType: type, body: text }, deps.cacheLimits());
      } catch (e) {
        log.warn('cache write failed', { error: String(e) });
      }
      out.delete('content-length');
      return new Response(text, { status: 200, headers: out });
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  };
}
