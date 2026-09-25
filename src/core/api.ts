/**
 * The renderer's WorkSuite API client. Requests go to app://bundle/__api/…,
 * which the main process forwards with the session's credentials; the
 * renderer never sees a token. WorkSuite answers {status, message, data}.
 *
 * When the server cannot be reached, a module's last cached answer may come
 * back instead, marked offline (FR-OFF-01, FR-SRCH-02).
 */
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
}

type Query = Record<string, string | number | boolean | null | undefined>;

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

export async function request<T = unknown>(method: string, path: string, opts: { query?: Query; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
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

export function withMailbox(query: Query = {}, mailbox?: string | null): Query {
  const m = mailbox ?? mailboxHint;
  return m ? { ...query, mailbox: m } : query;
}

/** A same-origin URL for an API resource (attachment, avatar) usable in <img>/<a>. */
export function apiUrl(path: string, query?: Query): string {
  return buildUrl(path, query);
}
