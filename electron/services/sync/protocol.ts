import type { SyncPolicy } from '@shared/types';
import { DesktopError } from '../../main/errors';
import type { HttpClient } from '../http';

/**
 * The server's sync protocol (`/api/sync/*`, SyncController), authenticated
 * by this computer's device credential rather than the session — the
 * credential registration returned and secure storage keeps. The order a
 * pass uses it in is the reference client's (tools/sync-client/wsync.py):
 *
 *   hello → delta → (manifest, block)* | (have, block*, commit)* → ack
 *
 * with a session opened around any pass that changes something.
 */

export type Hello =
  | { command: 'sync'; deviceId: number; cursor: number; head: number; policy: SyncPolicy }
  | { command: 'pause'; message: string }
  | { command: 'wipe'; message: string };

export interface Manifest {
  version: number;
  size: number;
  sha256: string | null;
  blocks: Array<{ idx: number; offset: number; size: number; sha256: string }>;
}

export interface CommitResult {
  fileId: number;
  version: number;
}

export function defaultPolicy(): SyncPolicy {
  return { max_devices: 10, max_file_bytes: 5 * 1024 ** 3, upload_kbps: 0, download_kbps: 0, blocked_types: [], ignored_patterns: [], allow_offline: true, require_encryption: false, block_size: 4 * 1024 * 1024 };
}

function policyOf(p: Partial<SyncPolicy> | undefined): SyncPolicy {
  const d = defaultPolicy();
  if (!p) return d;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    max_devices: Number(p.max_devices ?? d.max_devices),
    max_file_bytes: Number(p.max_file_bytes ?? d.max_file_bytes),
    upload_kbps: Number(p.upload_kbps ?? 0),
    download_kbps: Number(p.download_kbps ?? 0),
    blocked_types: list(p.blocked_types),
    ignored_patterns: list(p.ignored_patterns),
    allow_offline: p.allow_offline !== false,
    require_encryption: p.require_encryption === true,
    block_size: Number(p.block_size ?? d.block_size),
  };
}

export class SyncProtocol {
  constructor(
    private readonly http: HttpClient,
    private readonly token: () => string | null,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const t = this.token();
    if (!t) throw new DesktopError('DEVICE_NOT_REGISTERED', 'This computer has no sync credential yet.');
    return { 'X-Device-Token': t, ...extra };
  }

  async hello(info: { app_version: string; os_version: string; hostname: string; storage_used: number; file_count: number }): Promise<Hello> {
    const d = await this.http.post<{ command?: string; message?: string; device?: { id?: number; cursor?: number }; head?: number; policy?: Partial<SyncPolicy> }>('/api/sync/hello', info, { auth: false, headers: this.headers() });
    if (d.command === 'wipe') return { command: 'wipe', message: d.message ?? 'This computer has been told to remove its synced copy.' };
    if (d.command === 'pause') return { command: 'pause', message: d.message ?? 'Syncing is paused for this computer.' };
    return { command: 'sync', deviceId: Number(d.device?.id ?? 0), cursor: Number(d.device?.cursor ?? 0), head: Number(d.head ?? 0), policy: policyOf(d.policy) };
  }

  /** Whether anything changed after `since` that did not come from this computer. */
  async changedSince(since: number): Promise<boolean> {
    const d = await this.http.get<{ events?: unknown[]; more?: boolean }>('/api/sync/delta', { auth: false, headers: this.headers(), query: { since, limit: 1 } });
    return (d.events?.length ?? 0) > 0 || d.more === true;
  }

  async ack(cursor: number): Promise<void> {
    await this.http.post('/api/sync/ack', { cursor }, { auth: false, headers: this.headers() });
  }

  async have(hashes: string[]): Promise<Set<string>> {
    const missing = new Set<string>();
    for (let i = 0; i < hashes.length; i += 1000) {
      const part = hashes.slice(i, i + 1000);
      const d = await this.http.post<{ missing?: string[] }>('/api/sync/have', { hashes: part }, { auth: false, headers: this.headers() });
      for (const h of d.missing ?? part) missing.add(h);
    }
    return missing;
  }

  async putBlock(bytes: Buffer, sha256: string, signal?: AbortSignal): Promise<void> {
    const res = await this.http.raw('POST', this.http.url('/api/sync/block'), {
      auth: false,
      headers: this.headers({ 'X-Block-Hash': sha256, 'Content-Type': 'application/octet-stream' }),
      body: new Uint8Array(bytes),
      signal,
      timeoutMs: 10 * 60_000,
    });
    if (!res.ok) {
      let message = `The server refused a block (${res.status}).`;
      try {
        message = ((await res.json()) as { message?: string }).message ?? message;
      } catch {
        /* keep the default */
      }
      throw new DesktopError(res.status >= 500 ? 'SERVER_ERROR' : 'IPC_VALIDATION_FAILED', message, res.status);
    }
  }

  /** Throws DesktopError CONFLICT (409) with `data.conflict`/`copy_file_id` when Drive moved on, or `data.missing` for a block it lacks. */
  async commit(body: { name: string; blocks: string[]; sha256: string; mime_type: string; file_id?: number; base_version?: number; folder_id?: number | null }): Promise<CommitResult> {
    const d = await this.http.post<{ file_id?: number; version?: number }>('/api/sync/commit', body, { auth: false, headers: this.headers(), timeoutMs: 10 * 60_000 });
    return { fileId: Number(d.file_id), version: Number(d.version ?? 1) };
  }

  async manifest(fileId: number): Promise<Manifest> {
    const d = await this.http.get<{ version?: number; size?: number; sha256?: string | null; blocks?: Manifest['blocks'] }>(`/api/sync/files/${fileId}/manifest`, { auth: false, headers: this.headers(), timeoutMs: 5 * 60_000 });
    return { version: Number(d.version ?? 1), size: Number(d.size ?? 0), sha256: d.sha256 ?? null, blocks: d.blocks ?? [] };
  }

  async readBlock(fileId: number, idx: number, signal?: AbortSignal): Promise<Buffer> {
    const res = await this.http.raw('GET', this.http.url(`/api/sync/files/${fileId}/block/${idx}`), { auth: false, headers: this.headers({ Accept: '*/*' }), signal, timeoutMs: 10 * 60_000 });
    if (!res.ok) throw new DesktopError(res.status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR', `The server could not send part ${idx + 1} of the file (${res.status}).`, res.status);
    return Buffer.from(await res.arrayBuffer());
  }

  async openSession(): Promise<number | null> {
    try {
      const d = await this.http.post<{ session_id?: number }>('/api/sync/session', {}, { auth: false, headers: this.headers() });
      return d.session_id ? Number(d.session_id) : null;
    } catch {
      return null; // the record of a pass is a courtesy; the pass goes ahead without one
    }
  }

  async closeSession(id: number, stats: { cursor: number; pulled: number; pushed: number; bytes_up: number; bytes_down: number; conflicts: number; state: 'done' | 'failed' | 'cancelled'; error?: string }): Promise<void> {
    await this.http.post(`/api/sync/session/${id}/close`, stats, { auth: false, headers: this.headers() }).catch(() => undefined);
  }

  async wiped(): Promise<void> {
    await this.http.post('/api/sync/wiped', {}, { auth: false, headers: this.headers() });
  }
}
