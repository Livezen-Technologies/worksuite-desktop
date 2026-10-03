import { createHash } from 'node:crypto';
import { restaurantMainOnly } from '@shared/restaurant';
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
  // Taking an offered file, and fetching it, go through the main process too: the server checks only who
  // the receiver is, and the shared computer must answer on its red bar with a real click.
  /^\/api\/meet\/control\/files\/\d+\/(accept|download)\/?$/,
  // Pairing a salon desk answers with the desk's key: it is done in the main
  // process (salon-desk.ts), so the key never reaches a renderer.
  /^\/api\/salon\/v1\/desk\/pair(\/|\?|$)/,
  // Pairing a POS till answers with its credential, and the till's own door takes that credential: both are the
  // main process's (pos-desk.ts), so it never reaches a page.
  /^\/api\/pos\/terminals\/\d+\/pair\/?$/,
  /^\/api\/pos\/device(\/|\?|$)/,
  // An event desk's key is answered by a new key, and its copy and queue are made with it: this computer as a
  // check-in device is the main process's (event-desk.ts). Registering one is refused below, by method.
  /^\/api\/events\/v1\/devices\/\d+\/(key|heartbeat)\/?$/,
  /^\/api\/events\/v1\/events\/\d+\/checkin\/(bootstrap|changes|sync)\/?$/,
  // The assistant (WS-AI-SRS-001 DSK-3, DSK-6): confirming a proposal is `ai:confirm`, which checks the
  // request came from the main window and audits it; a file from this computer is `ai:upload`, picked
  // there under the device policy. No page — Quick Ask's included — does either for itself.
  /^\/api\/ai\/pending\/\d+\/confirm\/?$/,
  /^\/api\/ai\/context\/uploads\/?$/,
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

const HLS_MEDIA = /^\/media\/hls\/[A-Za-z0-9_\-~.]{8,512}\/[A-Za-z0-9_]{1,64}\.(m3u8|ts)$/;

export function isMediaPath(apiPath: string): boolean {
  return MEDIA.test(apiPath) || HLS_MEDIA.test(apiPath);
}

export function isProxyPathAllowed(apiPath: string, method = 'GET'): boolean {
  if (isMediaPath(apiPath)) return ['GET', 'HEAD'].includes(method.toUpperCase());
  if (!PATH_OK.test(apiPath)) return false;
  const pathOnly = apiPath.split('?')[0]!;
  // No dot segments at all: a URL parser folds `/./` away, and the deny list
  // must see the path the server will.
  if (pathOnly.includes('..') || pathOnly.includes('//') || /\/\.(\/|$)/.test(pathOnly)) return false;
  const m = method.toUpperCase();
  if (ACCOUNT.some(([re, methods]) => re.test(pathOnly) && methods.includes(m))) return true;
  if (isSharerGrant(pathOnly, apiPath)) return false;
  // Offering a file in a session is the upload manager's (files the person chose), never a page's own bytes.
  if (m !== 'GET' && m !== 'HEAD' && /^\/api\/meet\/control\/sessions\/\d+\/files\/?$/.test(pathOnly)) return false;
  // Registering an event device answers with its key: done by the main process, never a page (the list stays readable).
  if (m !== 'GET' && m !== 'HEAD' && /^\/api\/events\/v1\/events\/\d+\/devices\/?$/.test(pathOnly)) return false;
  // A Restaurant terminal's pairing answers with its key; its outbox playback, heartbeat and print agent run in the
  // main process with that key (electron/services/restaurant). Reading the print queue stays open to the screens.
  if (restaurantMainOnly(pathOnly, m)) return false;
  return !DENY.some((re) => re.test(pathOnly));
}

export interface ProxyDeps {
  http: HttpClient;
  cache: OfflineCache;
  userId: () => string | null;
  /** Which module's READ_CACHE covers this GET path, if any. */
  cacheModuleFor: (path: string) => string | null;
  cacheLimits: () => CacheLimits;
  cacheScope?: () => string;
  /** Mail bodies are cached only when the mail cache window is not "headers only". */
  mailBodiesCached: (path: string) => boolean;
  /** A folder that is online only keeps not even its list (ENH-MAIL-03 DMO-OFF-01). */
  mailListCached?: (path: string) => boolean;
  /** Headers the main process adds to a request — credentials the renderer must not hold (a salon desk's key). */
  extraHeaders?: (path: string) => Record<string, string> | null;
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
    for (const [h, v] of Object.entries(deps.extraHeaders?.(apiPath) ?? {})) headers.set(h, v);
    let body: ArrayBuffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY) return envelope(413, 'That request is too large; use the upload manager.', 'INTERNAL');
    }

    const cacheModule = method === 'GET' ? deps.cacheModuleFor(apiPath) : null;
    const isMailBody = /^\/api\/mail\/messages\/\d+/.test(apiPath);
    const cacheable = cacheModule !== null && (isMailBody ? deps.mailBodiesCached(apiPath) : (deps.mailListCached?.(apiPath) ?? true));

    const whatsapp = /^\/api\/whatsapp(?:\/|\?|$)/.test(apiPath);
    const scope = whatsapp ? (deps.cacheScope?.() ?? deps.http.url('/')) : '';
    const namespace = whatsapp ? `/scope/${createHash('sha256').update(scope).digest('hex')}` : '';
    const cachePath = `${namespace}${apiPath}`;

    // Explicit local-only read: no network, no writes and no arbitrary cache paths.
    if (request.headers.get('X-WS-Local-Read') === '1') {
      if (!cacheable || !deps.cacheLimits().enabled) return envelope(404, 'No saved conversation.', 'CACHE_MISS');
      const hit = deps.cache.get(userId, cachePath);
      return hit ? new Response(hit.body, { status: hit.status, headers: { 'Content-Type': hit.contentType, 'X-WS-Offline': '1', 'X-WS-Cached-At': hit.cachedAt } }) : envelope(404, 'No saved conversation.', 'CACHE_MISS');
    }

    let upstream: Response;
    try {
      upstream = await deps.http.raw(method, deps.http.url(apiPath), { headers, body, timeoutMs: 60_000, signal: request.signal });
    } catch (e) {
      if (whatsapp && (deps.userId() !== userId || (deps.cacheScope?.() ?? deps.http.url('/')) !== scope)) return envelope(401, 'The account changed.', 'NOT_SIGNED_IN');
      if ((cacheable || cacheModule) && (!whatsapp || deps.cacheLimits().enabled)) {
        const hit = deps.cache.get(userId, cachePath);
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

    if (whatsapp && (deps.userId() !== userId || (deps.cacheScope?.() ?? deps.http.url('/')) !== scope)) return envelope(401, 'The account changed.', 'NOT_SIGNED_IN');
    if (cacheModule && whatsapp && [403, 404].includes(upstream.status)) deps.cache.clearPrefix(userId, `${namespace}/api/whatsapp`);

    const out = new Headers();
    for (const h of RETURN_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }

    const type = upstream.headers.get('content-type') ?? '';
    if (cacheable && upstream.status === 200 && type.includes('json')) {
      const text = await upstream.text();
      try {
        deps.cache.put(userId, cacheModule!, cachePath, { status: 200, contentType: type, body: text }, deps.cacheLimits());
      } catch (e) {
        log.warn('cache write failed', { error: String(e) });
      }
      out.delete('content-length');
      return new Response(text, { status: 200, headers: out });
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  };
}
