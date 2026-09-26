import type { DesktopErrorCode } from '@shared/ipc/contract';
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
  'ORG_ACCESS_DENIED',
  'FILE_LOCKED',
  'RATE_LIMITED',
]);

export function classifyNetworkError(e: unknown): DesktopError {
  const text = `${(e as Error)?.message ?? e} ${String((e as { cause?: unknown })?.cause ?? '')}`;
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
   */
  async raw(method: string, url: string, init: RequestInit & { auth?: boolean; timeoutMs?: number } = {}): Promise<Response> {
    const auth = init.auth !== false;
    const attempt = async (): Promise<Response> => {
      const headers = new Headers(init.headers);
      for (const [k, v] of Object.entries(this.deps.clientHeaders())) headers.set(k, v);
      if (!headers.has('Accept')) headers.set('Accept', 'application/json');
      if (auth) {
        const token = this.deps.tokens.accessToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
      }
      const signals: AbortSignal[] = [AbortSignal.timeout(init.timeoutMs ?? 30_000)];
      if (init.signal) signals.push(init.signal);
      try {
        const res = await this.deps.fetch(url, { ...init, method, headers, signal: AbortSignal.any(signals), redirect: 'manual' });
        this.deps.onReachability(true);
        return res;
      } catch (e) {
        const err = classifyNetworkError(e);
        if (err.code === 'NETWORK_UNREACHABLE') this.deps.onReachability(false);
        throw err;
      }
    };

    let res = await attempt();
    if (res.status === 401 && auth) {
      const body = await readEnvelope(res.clone());
      const code = body?.code;
      if (code === 'DEVICE_REVOKED' || code === 'DEVICE_NOT_REGISTERED') {
        this.deps.onDeviceDirective?.(code, body?.message ?? code);
        return res;
      }
      const refreshed = await this.deps.tokens.refresh();
      if (refreshed === 'offline') throw new DesktopError('NETWORK_UNREACHABLE', UNREACHABLE_MESSAGE);
      if (refreshed === 'lost') {
        this.deps.onAuthLost(body?.message ?? 'Session ended');
        return res;
      }
      res = await attempt();
    }
    if (res.status === 403 || res.status === 426) {
      const body = await readEnvelope(res.clone());
      if (body?.code === 'DESKTOP_ACCESS_DISABLED' || body?.code === 'VERSION_UNSUPPORTED') {
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
