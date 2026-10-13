import { DISCOVERY_MAX_BYTES, DISCOVERY_PATH, LEGACY_CORE_PATH, LEGACY_DESKTOP_PATH, discoveryDocumentV1, type DiscoveryDocument } from '@shared/discovery';

/**
 * Step 4: the discovery document (Connection & Startup §2), and the legacy documents on a 404 — the former
 * `probeServer` logic, moved here.
 *
 * Every request: `redirect:'error'` (a document is read where it was asked for, never where a redirect points),
 * a byte cap, and the run's AbortSignal.
 */

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class FetchFailed extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
    this.name = 'FetchFailed';
  }
}

export class TooLarge extends Error {
  constructor() {
    super('response too large');
    this.name = 'TooLarge';
  }
}

/** Reads a body up to `max` bytes; more is TooLarge. */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new TooLarge();
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export async function get(fetch: Fetch, url: string, signal: AbortSignal, accept = 'application/json', timeoutMs = 15_000): Promise<Response> {
  try {
    return await fetch(url, { method: 'GET', headers: { Accept: accept }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
  } catch (e) {
    throw new FetchFailed(e);
  }
}

export type DocumentResult =
  | { kind: 'v1'; doc: DiscoveryDocument; raw: Uint8Array }
  | { kind: 'missing'; status: number }
  | { kind: 'invalid'; reason: string };

export async function fetchDiscoveryDocument(fetch: Fetch, origin: string, signal: AbortSignal): Promise<DocumentResult> {
  const res = await get(fetch, origin + DISCOVERY_PATH, signal);
  if (res.status === 404 || res.status === 410) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: 'missing', status: res.status };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: 'missing', status: res.status };
  }
  let raw: Uint8Array;
  try {
    raw = await readCapped(res, DISCOVERY_MAX_BYTES);
  } catch (e) {
    if (e instanceof TooLarge) return { kind: 'invalid', reason: 'The discovery document is larger than allowed.' };
    throw new FetchFailed(e);
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return { kind: 'invalid', reason: 'The discovery document is not valid JSON.' };
  }
  const parsed = discoveryDocumentV1.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { kind: 'invalid', reason: `The discovery document is not valid${first ? ` (${first.path.join('.') || 'document'})` : ''}.` };
  }
  return { kind: 'v1', doc: parsed.data, raw };
}

export type JwsResult = { kind: 'found'; jws: string } | { kind: 'missing' };

export async function fetchJws(fetch: Fetch, url: string, signal: AbortSignal): Promise<JwsResult> {
  const res = await get(fetch, url, signal, 'application/jose, text/plain');
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: 'missing' };
  }
  try {
    return { kind: 'found', jws: new TextDecoder().decode(await readCapped(res, 8 * 1024)) };
  } catch (e) {
    if (e instanceof TooLarge) return { kind: 'found', jws: '' };
    throw new FetchFailed(e);
  }
}

async function jsonOrNull(res: Response): Promise<Record<string, unknown> | null> {
  try {
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const v = JSON.parse(new TextDecoder().decode(await readCapped(res, 64 * 1024))) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch (e) {
    if (e instanceof FetchFailed) throw e;
    return null;
  }
}

export interface LegacyDesktop {
  name: string | null;
  minimumVersions: Partial<Record<'windows' | 'macos' | 'linux', string>>;
  minimumVersion: string | null;
  passkey: { url: string; exchange: string } | null;
}

/** `/.well-known/worksuite-desktop` as the former probeServer read it, or null when it is not a desktop-v1 document. */
export function readLegacyDesktop(body: Record<string, unknown> | null): LegacyDesktop | null {
  if (!body || !(body.api === 'desktop-v1' || body.desktop_api === 'v1')) return null;
  const pk = body.passkey_sign_in as { url?: unknown; exchange?: unknown } | null | undefined;
  // Paths on this same server only: the app never opens, or posts to, an address the server names elsewhere.
  const passkey =
    pk && typeof pk.url === 'string' && typeof pk.exchange === 'string' && /^\/[A-Za-z0-9/_-]+$/.test(pk.url) && /^\/api\/[A-Za-z0-9/_-]+$/.test(pk.exchange)
      ? { url: pk.url, exchange: pk.exchange }
      : null;
  const mv = body.minimum_versions && typeof body.minimum_versions === 'object' ? (body.minimum_versions as Record<string, unknown>) : {};
  const minimumVersions: LegacyDesktop['minimumVersions'] = {};
  for (const k of ['windows', 'macos', 'linux'] as const) if (typeof mv[k] === 'string') minimumVersions[k] = mv[k] as string;
  return {
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : null,
    minimumVersions,
    minimumVersion: typeof body.minimum_version === 'string' ? body.minimum_version : null,
    passkey,
  };
}

export type LegacyResult =
  | { kind: 'legacy-desktop'; info: LegacyDesktop }
  | { kind: 'legacy-core'; name: string | null }
  | { kind: 'server-error'; status: number }
  | { kind: 'not-worksuite' };

/** The legacy documents, in the former probeServer's order. */
export async function fetchLegacy(fetch: Fetch, origin: string, signal: AbortSignal): Promise<LegacyResult> {
  const wk = await get(fetch, origin + LEGACY_DESKTOP_PATH, signal);
  if (wk.ok) {
    const info = readLegacyDesktop(await jsonOrNull(wk));
    if (info) return { kind: 'legacy-desktop', info };
  } else {
    await wk.body?.cancel().catch(() => undefined);
  }
  const cfg = await get(fetch, origin + LEGACY_CORE_PATH, signal);
  const body = await jsonOrNull(cfg);
  if (cfg.ok && body && body.status === 'success') {
    const data = (body.data ?? {}) as Record<string, unknown>;
    const brand = data.brand;
    const branded =
      typeof brand === 'string' ? brand : brand && typeof brand === 'object' && typeof (brand as { name?: unknown }).name === 'string' ? (brand as { name: string }).name : '';
    return { kind: 'legacy-core', name: branded.trim() ? branded.trim().slice(0, 200) : null };
  }
  if ((body && body.status === 'error') || cfg.status >= 500) return { kind: 'server-error', status: cfg.status };
  return { kind: 'not-worksuite' };
}

/** The passkey hand-off a v1 server still describes in its legacy desktop document (best effort, same origin). */
export async function fetchLegacyPasskey(fetch: Fetch, origin: string, path: unknown, signal: AbortSignal): Promise<LegacyDesktop | null> {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9/._-]+$/.test(path)) return null;
  try {
    const res = await get(fetch, origin + path, signal, 'application/json', 5_000);
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return readLegacyDesktop(await jsonOrNull(res));
  } catch {
    return null;
  }
}
