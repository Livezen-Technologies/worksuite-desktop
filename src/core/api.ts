/**
 * The renderer's WorkSuite API client. Requests go to app://bundle/__api/…,
 * which the main process forwards with the session's credentials; the
 * renderer never sees a token. WorkSuite answers {status, message, data}.
 *
 * When the server cannot be reached, a module's last cached answer may come
 * back instead, marked offline (FR-OFF-01, FR-SRCH-02).
 */
import { app } from './app-state';
import { call } from './bridge';
import { text } from './i18n';

export const API_BASE = 'app://bundle/__api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null,
    readonly data: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get offline(): boolean {
    return this.code === 'NETWORK_UNREACHABLE' || this.status === 503;
  }
  get forbidden(): boolean {
    return this.status === 403;
  }
}

export interface ApiResult<T> {
  data: T;
  offline: boolean;
  cachedAt: string | null;
  /** The server's own sentence about what it did, when it sent one. */
  message?: string | null;
  /** Read from this computer while the server's answer is on its way (worksuite-desktop#162). */
  local?: boolean;
  /** Fetched ahead with `peek`, so opening it has not marked it read at the server. */
  peeked?: boolean;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

let mailboxHint: string | null = null;
/** Mail writes on a multi-mailbox account must name the mailbox. */
export function setDefaultMailbox(id: string | null): void {
  mailboxHint = id;
}

function buildUrl(path: string, query?: Query): string {
  const u = new URL(`${API_BASE}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

async function parse(res: Response): Promise<{ body: Record<string, unknown> | null }> {
  if (!(res.headers.get('content-type') ?? '').includes('json')) return { body: null };
  try {
    return { body: (await res.json()) as Record<string, unknown> };
  } catch {
    return { body: null };
  }
}

const LOCAL_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Guest mode's storage layer (#149): the same requests, answered from the Local Profile on this device
 * (electron/services/local-api.ts), so Notes, Tasks, Contacts and Calendar run the same screens in both modes.
 * Nothing in guest mode reaches a WorkSuite server.
 */
async function localRequest<T>(method: string, path: string, opts: { query?: Query; body?: unknown }): Promise<ApiResult<T>> {
  if (!LOCAL_METHODS.has(method) || opts.body instanceof FormData) throw new ApiError(403, text('This needs a WorkSuite account. Sign in to use it.'), 'GUEST');
  const query = opts.query ? (Object.fromEntries(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Record<string, string | number | boolean>) : undefined;
  let answer: { status: number; data: unknown; message: string | null };
  try {
    answer = await call('local:api', { method: method as 'GET', path, query, body: opts.body });
  } catch (e) {
    throw new ApiError(0, (e as Error).message || text('WorkSuite Desktop could not complete the request.'), 'INTERNAL');
  }
  if (answer.status >= 400) throw new ApiError(answer.status, text(answer.message ?? 'Something went wrong.'), answer.status === 403 ? 'GUEST' : null);
  return { data: answer.data as T, offline: false, cachedAt: null, message: null };
}

export async function request<T = unknown>(method: string, path: string, opts: { query?: Query; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  if (app.get().session.mode === 'guest') return localRequest<T>(method, path, opts);
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method, headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'INTERNAL');
  }
  const { body: json } = await parse(res);
  if (!res.ok || json?.status === 'error') {
    const message = typeof json?.message === 'string' ? json.message : `The server answered ${res.status}.`;
    throw new ApiError(res.status, message, typeof json?.code === 'string' ? json.code : null, json?.errors ?? json?.data ?? null);
  }
  return {
    data: (json && 'data' in json ? json.data : json) as T,
    offline: res.headers.get('x-ws-offline') === '1',
    cachedAt: res.headers.get('x-ws-cached-at'),
    message: typeof json?.message === 'string' ? json.message : null,
  };
}

export async function apiGet<T = unknown>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  return (await request<T>('GET', path, { query, signal })).data;
}

export function apiGetMeta<T = unknown>(path: string, query?: Query, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request<T>('GET', path, { query, signal });
}

export async function apiPost<T = unknown>(path: string, body?: unknown, query?: Query): Promise<T> {
  return (await request<T>('POST', path, { body, query })).data;
}

export async function apiPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return (await request<T>('PATCH', path, { body })).data;
}

export async function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  return (await request<T>('PUT', path, { body })).data;
}

export async function apiDelete<T = unknown>(path: string, body?: unknown): Promise<T> {
  return (await request<T>('DELETE', path, { body })).data;
}

/** The path the main process sees for a request — what its saved answers are keyed by. */
export function apiPathOf(path: string, query?: Query): string {
  const u = new URL(buildUrl(path, query));
  return u.pathname.slice('/__api'.length) + u.search;
}

/**
 * Saved answers for these GET requests, read from this computer without asking
 * the server (Mail only; `offline:peek`). Null for each one not saved, and for
 * all of them where there is no desktop shell or no account.
 */
export async function peekCached<T = unknown>(requests: Array<{ path: string; query?: Query }>): Promise<Array<ApiResult<T> | null>> {
  if (app.get().session.mode === 'guest' || !requests.length) return requests.map(() => null);
  try {
    const hits = await call('offline:peek', { paths: requests.map((r) => apiPathOf(r.path, r.query)) });
    return hits.map((h) => {
      if (!h) return null;
      try {
        const json = JSON.parse(h.body) as Record<string, unknown> | null;
        if (!json || json.status === 'error') return null;
        return { data: ('data' in json ? json.data : json) as T, offline: false, cachedAt: h.cachedAt, message: null, local: true };
      } catch {
        return null;
      }
    });
  } catch {
    return requests.map(() => null);
  }
}

export function withMailbox(query: Query = {}, mailbox?: string | null): Query {
  const m = mailbox ?? mailboxHint;
  return m ? { ...query, mailbox: m } : query;
}

/** A same-origin URL for an API resource (attachment, avatar) usable in <img>/<a>. */
export function apiUrl(path: string, query?: Query): string {
  return buildUrl(path, query);
}
