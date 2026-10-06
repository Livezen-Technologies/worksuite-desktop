import type { DesktopErrorCode } from '@shared/ipc/contract';
import { safeHeaders, UnsafeHeaderError } from '@shared/http-headers';
import { DesktopError, UNREACHABLE_MESSAGE } from '../main/errors';
import { logger } from '../main/log';

const log = logger('http');

/**
 * The main-process HTTP client for the WorkSuite API.
 *
 * Tokens never leave the main process: the renderer's requests reach the
 * server through the app:// proxy, which calls `raw()` here, and this is the
 * only place an Authorization header is written.
 *
 * WorkSuite answers `{status: "success"|"error", message, data|errors}`. Note
 * the body's `status` is a word, not the HTTP code — tools/device-check once
 * overwrote one with the other and asserted on the wrong thing.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TokenSource {
  accessToken(): string | null;
  /**
   * Refreshes once, single-flight. 'lost' means the server refused the
   * refresh token; 'offline' means it could not be asked.
   */
  refresh(): Promise<'ok' | 'offline' | 'lost'>;
}

export interface HttpDeps {
  fetch: FetchLike;
  origin: () => string | null;
  tokens: TokenSource;
  clientHeaders: () => Record<string, string>;
  onReachability: (reachable: boolean) => void;
  onAuthLost: (reason: string) => void;
  onDeviceDirective?: (code: DesktopErrorCode, message: string) => void;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface Envelope {
  status?: string;
  message?: string;
  data?: unknown;
  errors?: unknown;
  app?: string;
  code?: string;
}

const KNOWN_CODES = new Set<DesktopErrorCode>([
  'DEVICE_REVOKED',
  'DEVICE_NOT_REGISTERED',
  'DESKTOP_ACCESS_DISABLED',
  'VERSION_UNSUPPORTED',
  'UPDATE_REQUIRED',
  'ORG_ACCESS_DENIED',
  'FILE_LOCKED',
  'RATE_LIMITED',
]);

/**
 * The client type every request to the WorkSuite server names: the server picks the chat service's scope (poll
 * intervals, realtime transport) per client type from it, so desktop is told apart from the web app and the widget.
 */
export const CLIENT_TYPE_HEADER = 'X-WorkSuite-Client';
export const CLIENT_TYPE = 'desktop';

/** What a screen shows when a request could not even be put together (worksuite-desktop#238): it offers Retry. */
export const NOT_SENT_MESSAGE = "Couldn't send this request. Try again.";

/**
 * A request that could not be built — a header value no HTTP header may carry, most often (#238) — as the
 * ordinary error its screen shows with Retry. Never thrown past the caller, never a main-process crash.
 */
export function requestBuildError(e: unknown): DesktopError {
  if (e instanceof DesktopError) return e;
  const which = e instanceof UnsafeHeaderError ? e.header : null;
  log.error('request could not be built', { header: which, error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 160)}` : String(e) });
  return new DesktopError('INTERNAL', NOT_SENT_MESSAGE);
}

/**
 * A fetch whose every request goes through the header-safety helper, and that never throws synchronously: a request
 * that cannot be built is a rejected promise with a `DesktopError`, which the caller handles like any other failure.
 * The main process wraps `net.fetch` in this once, so no header with characters above 255 reaches undici (#238).
 */
export function withSafeHeaders<I extends object>(fetch: (url: string, init: I) => Promise<Response>): (url: string, init?: I) => Promise<Response> {
  return (url, init) => {
    try {
      const safe = { ...(init ?? {}) } as I & { headers?: unknown };
      if (safe.headers !== undefined) safe.headers = safeHeaders(safe.headers as Record<string, string>);
      return fetch(url, safe);
    } catch (e) {
      return Promise.reject(requestBuildError(e));
    }
  };
}

/**
 * A request that ran out of time (worksuite-desktop#249). Told apart from one somebody cancelled: a timeout's
 * DOMException reads "The operation was aborted due to timeout", and that word "aborted" once made every slow
 * request — a large upload's last step among them — say "The request was cancelled.", which nobody had done.
 */
export const TIMEOUT_MESSAGE = 'The server took too long to answer. Check your connection and try again.';

export function classifyNetworkError(e: unknown): DesktopError {
  const text = `${(e as Error)?.message ?? e} ${String((e as { cause?: unknown })?.cause ?? '')}`;
  // Not the network: a request that could not be built (a header no HTTP header may carry, #238).
  if (e instanceof DesktopError || e instanceof UnsafeHeaderError || /ByteString|Invalid value for header|Invalid header name/i.test(text)) return requestBuildError(e);
  // Before "aborted": a timeout's own message says it was aborted.
  if ((e as Error)?.name === 'TimeoutError' || /due to timeout|signal timed out/i.test(text)) {
    return new DesktopError('NETWORK_UNREACHABLE', TIMEOUT_MESSAGE);
  }
  if ((e as Error)?.name === 'AbortError' || /aborted/i.test(text)) {
    return new DesktopError('CANCELLED', 'The request was cancelled.');
  }
  if (/TimeoutError|timed out|ERR_TIMED_OUT/i.test(text)) {
    return new DesktopError('NETWORK_UNREACHABLE', UNREACHABLE_MESSAGE);
  }
  if (/ERR_CERT|ERR_SSL|certificate|CERT_/i.test(text)) {
    // NFR-SEC-02: certificate errors are reported, never bypassed.
    return new DesktopError('TLS_ERROR', "The server's security certificate isn't valid. Contact your administrator — WorkSuite will not connect to it.");
  }
  return new DesktopError('NETWORK_UNREACHABLE', UNREACHABLE_MESSAGE);
}

/**
 * A failure that says nothing about the session, the account or this computer, and may well be gone on the next try:
 * the server out of reach or too slow, the server — or the proxy in front of it — failing with a 5xx, a rate limit.
 */
export function isPassingFailure(e: unknown): boolean {
  if (!(e instanceof DesktopError)) return false;
  if (e.code === 'NETWORK_UNREACHABLE' || e.code === 'RATE_LIMITED') return true;
  return e.code === 'SERVER_ERROR' && e.status !== null && e.status >= 500;
}

export function errorFromResponse(status: number, body: Envelope | null, retryAfter: string | null): DesktopError {
  const message = (body?.message && String(body.message)) || `The server answered ${status}.`;
  const serverCode = body?.code && KNOWN_CODES.has(body.code as DesktopErrorCode) ? (body.code as DesktopErrorCode) : null;
  if (serverCode) return new DesktopError(serverCode, message, status, body?.errors ?? null);
  switch (status) {
    case 401:
      return new DesktopError('SESSION_EXPIRED', message, status);
    case 403:
      return new DesktopError(body?.app ? 'APP_ACCESS_DENIED' : 'PERMISSION_DENIED', message, status, body?.app ?? null);
    case 404:
      return new DesktopError('NOT_FOUND', message, status);
    case 409:
      return new DesktopError('CONFLICT', message, status, body?.data ?? body?.errors ?? null);
    case 410:
      return new DesktopError('NOT_FOUND', message, status);
    case 422:
      return new DesktopError('IPC_VALIDATION_FAILED', message, status, body?.errors ?? null);
    case 423:
      return new DesktopError('FILE_LOCKED', message, status, body?.data ?? null);
    case 426:
      return new DesktopError('VERSION_UNSUPPORTED', message, status);
    case 429:
      return new DesktopError('RATE_LIMITED', retryAfter ? `${message} (retry after ${retryAfter}s)` : message, status);
    default:
      return new DesktopError(status >= 500 ? 'SERVER_ERROR' : 'INTERNAL', message, status, body?.errors ?? null);
  }
}

async function readEnvelope(res: Response): Promise<Envelope | null> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null;
  try {
    return (await res.json()) as Envelope;
  } catch {
    return null;
  }
}

export class HttpClient {
  constructor(private readonly deps: HttpDeps) {}

  url(path: string, query?: RequestOptions['query']): string {
    const origin = this.deps.origin();
    if (!origin) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    if (!path.startsWith('/')) throw new DesktopError('INTERNAL', 'API paths must be absolute.');
    const u = new URL(path, origin);
    if (u.origin !== origin) throw new DesktopError('INTERNAL', 'Refusing to send credentials to another origin.');
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  /**
   * Sends a request with the session's bearer token and returns the raw
   * Response. On a 401 it refreshes once and retries once (FR-AUTH-08). A
   * refresh refused means the session is gone. A 401 that comes back after a
   * refresh that worked is this request's own answer — a locked folder's
   * wrong password answers 401 — so it is returned, not taken as a sign-out.
   *
   * A 401 to a request sent with a token that is no longer the session's —
   * sent with none while signed out and answered after a new sign-in, or with
   * the one a refresh by another request has since replaced — is about that
   * old token. The request is sent again with the current one, and nothing is
   * refreshed: a refresh spends the new session's refresh token (it rotates)
   * and ends the access token every other request is carrying, so stale 401s
   * landing just after a sign-in refreshed it away from under the sign-in's
   * own requests, whose refusals then sent the person back to the sign-in
   * screen (LOGIN-001).
   *
   * `timeoutMs` 0 sets no time limit at all: the caller watches the request
   * itself (an upload's part, stopped only when it stalls — #249).
   */
  async raw(method: string, url: string, init: RequestInit & { auth?: boolean; timeoutMs?: number; bodyFactory?: () => { body: BodyInit; contentType: string } } = {}): Promise<Response> {
    const auth = init.auth !== false;
    // A streamed body is read once: built afresh for every send, the one after a token refresh included (#249).
    const { bodyFactory, ...rest } = init;
    init = rest;
    // The bearer the last send carried (null: none), to tell a 401 about an old token from one about the current.
    let sent: string | null = null;
    const attempt = async (): Promise<Response> => {
      // Every header through the safety helper (#238); a request that cannot be built is this screen's error, not a crash.
      let headers: Headers;
      try {
        headers = new Headers(safeHeaders(init.headers as Record<string, string> | Headers | undefined));
        for (const [k, v] of Object.entries(safeHeaders(this.deps.clientHeaders()))) headers.set(k, v);
        headers.set(CLIENT_TYPE_HEADER, CLIENT_TYPE);
        if (!headers.has('Accept')) headers.set('Accept', 'application/json');
        if (auth) {
          const token = this.deps.tokens.accessToken();
          sent = token;
          if (token) headers.set('Authorization', `Bearer ${token}`);
        }
      } catch (e) {
        throw requestBuildError(e);
      }
      let body = init.body;
      if (bodyFactory) {
        const built = bodyFactory();
        body = built.body;
        headers.set('Content-Type', built.contentType);
      }
      const limit = init.timeoutMs === 0 ? null : AbortSignal.timeout(init.timeoutMs ?? 30_000);
      const signals: AbortSignal[] = limit ? [limit] : [];
      if (init.signal) signals.push(init.signal);
      try {
        const res = await this.deps.fetch(url, { ...init, body, method, headers, signal: signals.length ? AbortSignal.any(signals) : undefined, redirect: 'manual' });
        this.deps.onReachability(true);
        return res;
      } catch (e) {
        // Out of time, not cancelled by anybody: said so (#249). A slow answer is no sign the server is gone.
        if (limit?.aborted && !init.signal?.aborted) throw new DesktopError('NETWORK_UNREACHABLE', TIMEOUT_MESSAGE);
        const err = classifyNetworkError(e);
        if (err.code === 'NETWORK_UNREACHABLE') this.deps.onReachability(false);
        throw err;
      }
    };

    let res = await attempt();
    let refreshed = false;
    let resent = 0;
    while (res.status === 401 && auth) {
      const body = await readEnvelope(res.clone());
      const code = body?.code;
      if (code === 'DEVICE_REVOKED' || code === 'DEVICE_NOT_REGISTERED') {
        this.deps.onDeviceDirective?.(code, body?.message ?? code);
        return res;
      }
      // Answered for a token the session has since replaced: sent again with the current one, no refresh (LOGIN-001).
      const current = this.deps.tokens.accessToken();
      if (current && current !== sent && resent < 2) {
        resent++;
        res = await attempt();
        continue;
      }
      if (refreshed) break;
      const outcome = await this.deps.tokens.refresh();
      if (outcome === 'offline') throw new DesktopError('NETWORK_UNREACHABLE', UNREACHABLE_MESSAGE);
      if (outcome === 'lost') {
        this.deps.onAuthLost(body?.message ?? 'Session ended');
        return res;
      }
      refreshed = true;
      res = await attempt();
    }
    // A version the server no longer accepts may be refused with 426 or with any error carrying UPDATE_REQUIRED.
    if (res.status === 403 || res.status === 426 || (res.status >= 400 && res.status !== 401 && res.status < 500)) {
      const body = await readEnvelope(res.clone());
      if (body?.code === 'DESKTOP_ACCESS_DISABLED' || body?.code === 'VERSION_UNSUPPORTED' || body?.code === 'UPDATE_REQUIRED') {
        this.deps.onDeviceDirective?.(body.code as DesktopErrorCode, body.message ?? body.code);
      }
    }
    return res;
  }

  /** JSON request; returns the envelope's `data`. Throws DesktopError. */
  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.url(path, opts.query);
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await this.raw(method, url, {
      headers,
      body,
      auth: opts.auth,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    });
    const envelope = await readEnvelope(res);
    if (!res.ok) {
      const err = errorFromResponse(res.status, envelope, res.headers.get('retry-after'));
      log.debug('request failed', { method, path, status: res.status, code: err.code });
      throw err;
    }
    if (envelope && envelope.status === 'error') {
      throw new DesktopError('SERVER_ERROR', envelope.message ?? 'The server reported an error.', res.status);
    }
    return (envelope?.data ?? envelope ?? null) as T;
  }

  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, opts);
  }

  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...opts, body });
  }
}
