import { createHash } from 'node:crypto';
import type { PdfChangeSummary, PdfMode } from '@shared/pdf';
import { DesktopError, isDesktopError } from '../../main/errors';
import type { HttpLike } from './service';

/**
 * The server's CorePDFService for PDF Studio (`app/Modules/Pdf`, stage S;
 * its README is the contract): edit sessions, the edit lock, chunked
 * uploads and the commit into Drive. Every answer is the platform's
 * envelope; a refusal keeps its `errors.code` and `errors.actions`, so the
 * window shows the server's own sentence and offers what it offers.
 */

export type StudioClient = 'DESKTOP_WIN' | 'DESKTOP_MAC' | 'DESKTOP_LINUX';

export function studioClient(platform: NodeJS.Platform): StudioClient {
  return platform === 'win32' ? 'DESKTOP_WIN' : platform === 'darwin' ? 'DESKTOP_MAC' : 'DESKTOP_LINUX';
}

/** The permission flags a session answers (`PdfPermissions::evaluate`). */
export interface StudioFlags {
  open: boolean;
  annotate: boolean;
  edit: boolean;
  organize: boolean;
  save_version: boolean;
  save_copy: boolean;
  download: boolean;
  export: boolean;
  print: boolean;
  copy: boolean;
  offline: boolean;
  version_history: boolean;
  break_lock: boolean;
}

export interface StudioLock {
  type: string;
  holder: { id: number; name: string };
  mine: boolean;
  same_user: boolean;
  via: 'studio' | 'web';
  device: { name: string | null; client: string } | null;
  expires_in_s: number | null;
  warning: boolean;
}

export interface StudioPolicy {
  autosave_interval_s?: number;
  lock_timeout_min?: number;
  max_pdf_size_mb?: number;
  allow_print?: boolean;
  allow_copy?: boolean;
  allow_export?: boolean;
  external_links?: 'allow' | 'confirm' | 'block';
  [k: string]: unknown;
}

/** POST …/pdf/sessions, GET …/sessions/{sid}, POST …/mode and every heartbeat. */
export interface StudioState {
  session_id: string;
  status: string;
  mode: PdfMode;
  available_modes: PdfMode[];
  base_version: number;
  head_version: number;
  new_version_available: boolean;
  permissions: StudioFlags;
  read_only_reason: { code: string; message: string } | null;
  lock: StudioLock | null;
  policy: StudioPolicy;
  next_heartbeat_s: number;
}

export interface StudioBootstrap extends StudioState {
  file: { id: number; name: string; size: number; version: number; folder_id: number | null };
  content: { url: string; version: number; expires_at: string };
  timeouts: { heartbeat_interval_s: number; lock_timeout_s: number; lock_warning_s: number };
}

export interface StudioHeartbeat extends StudioState {
  lock_lost: { reason: string; by: { id: number; name: string } | null; at: string | null } | null;
  downgraded: boolean;
}

export interface StudioSaved {
  mode: 'new_version' | 'copy';
  changed: boolean;
  file: { id: number; name: string; version: number; size: number };
  version?: number;
}

/** A refusal from PDF Studio's server: its status, code, sentence and what it offers instead. */
export class StudioError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StudioError';
  }

  get actions(): string[] {
    return Array.isArray(this.details.actions) ? this.details.actions.filter((a): a is string => typeof a === 'string') : [];
  }
}

export function isStudioError(e: unknown): e is StudioError {
  return e instanceof Error && e.name === 'StudioError';
}

/** WorkSuite could not be reached (as opposed to refusing). */
export function isUnreachable(e: unknown): boolean {
  return isDesktopError(e) && (e.code === 'NETWORK_UNREACHABLE' || e.code === 'TLS_ERROR');
}

export const CHUNK = 4 * 1024 * 1024;

export class StudioApi {
  constructor(private readonly http: HttpLike) {}

  private async call<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const res = await this.http.raw(method, this.http.url(path, query), {
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      timeoutMs: 60_000,
    });
    return this.envelope<T>(res);
  }

  private async envelope<T>(res: Response): Promise<T> {
    type Envelope = { status?: string; message?: string; data?: unknown; errors?: Record<string, unknown> };
    const json = (await res.json().catch(() => null)) as Envelope | null;
    if (!res.ok || json?.status === 'error') {
      const errors = json?.errors && typeof json.errors === 'object' ? json.errors : {};
      const code = typeof errors.code === 'string' ? errors.code : `HTTP_${res.status}`;
      throw new StudioError(res.status, code, typeof json?.message === 'string' && json.message ? json.message : `WorkSuite answered ${res.status}.`, errors);
    }
    return (json?.data ?? null) as T;
  }

  /** Opening a PDF in PDF Studio. `null` when the server has no PDF Studio (an older WorkSuite: 404 on the route itself). */
  async open(fileId: number, body: { mode: PdfMode; client_type: StudioClient; device_id?: string; device_name?: string; lock_type?: string; takeover?: boolean }): Promise<StudioBootstrap | null> {
    try {
      return await this.call<StudioBootstrap>('POST', `/api/files/${fileId}/pdf/sessions`, body);
    } catch (e) {
      // The route missing answers the framework's own 404, without PDF Studio's code.
      if (isStudioError(e) && e.status === 404 && !e.code.startsWith('PDF_')) return null;
      throw e;
    }
  }

  /** The PDF's bytes at the version the session opened, from its ten-minute address (no sign-in: the token is the grant). */
  content(url: string, timeoutMs: number): Promise<Response> {
    const path = `/${url.replace(/^\/+/, '')}`;
    if (!/^\/pdf\/content\/[A-Za-z0-9._~-]+$/.test(path)) throw new DesktopError('SERVER_ERROR', 'WorkSuite answered an address that is not a PDF’s.');
    return this.http.raw('GET', this.http.url(path), { headers: { Accept: 'application/pdf' }, auth: false, timeoutMs });
  }

  heartbeat(fileId: number, sid: string, active: boolean): Promise<StudioHeartbeat> {
    return this.call('POST', `/api/files/${fileId}/pdf/sessions/${sid}/heartbeat`, { active });
  }

  mode(fileId: number, sid: string, mode: PdfMode, lockType?: 'EDIT' | 'STRUCTURAL_EDIT', takeover?: boolean): Promise<StudioState> {
    return this.call('POST', `/api/files/${fileId}/pdf/sessions/${sid}/mode`, { mode, ...(mode === 'EDIT' ? { lock_type: lockType ?? 'STRUCTURAL_EDIT' } : {}), ...(takeover ? { takeover: true } : {}) });
  }

  async end(fileId: number, sid: string, reason = 'CLOSED'): Promise<void> {
    await this.call('DELETE', `/api/files/${fileId}/pdf/sessions/${sid}`, undefined, { reason });
  }

  /**
   * Uploads a PDF in chunks (4 MiB, each with its SHA-256 so a damaged one is
   * sent again) and answers the upload's id, to commit with `save`.
   */
  async upload(fileId: number, bytes: Uint8Array, sid: string | null, onProgress?: (sent: number) => void): Promise<string> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const started = await this.call<{ upload_id: string; chunk_size: number; total_chunks: number }>('POST', `/api/files/${fileId}/pdf/uploads`, {
      size: bytes.byteLength,
      sha256,
      chunk_size: CHUNK,
      ...(sid ? { session_id: sid } : {}),
    });
    const size = started.chunk_size || CHUNK;
    for (let i = 0; i < started.total_chunks; i++) {
      const chunk = bytes.subarray(i * size, Math.min(bytes.byteLength, (i + 1) * size));
      let sent = false;
      for (let attempt = 0; attempt < 3 && !sent; attempt++) {
        const res = await this.http.raw('PUT', this.http.url(`/api/files/${fileId}/pdf/uploads/${started.upload_id}/chunks/${i}`), {
          headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': createHash('sha256').update(chunk).digest('hex') },
          body: chunk as unknown as BodyInit,
          timeoutMs: 5 * 60_000,
        });
        try {
          await this.envelope(res);
          sent = true;
        } catch (e) {
          // Damaged on the way: once more. Anything else is the answer.
          if (!(isStudioError(e) && e.code === 'PDF_UPLOAD_INVALID') || attempt === 2) throw e;
        }
      }
      onProgress?.(Math.min(bytes.byteLength, (i + 1) * size));
    }
    return started.upload_id;
  }

  save(
    fileId: number,
    body: {
      upload_id: string;
      mode: 'new_version' | 'copy';
      base_version?: number;
      session_id?: string;
      summary: PdfChangeSummary;
      client_type: StudioClient;
      device_id?: string;
      offline?: boolean;
      edited_at?: string;
      resolution?: 'upload_after_review';
      name?: string;
      note?: string;
    },
  ): Promise<StudioSaved> {
    // Only the counts that are there: the server takes an object of counts from 0.
    const summary = Object.fromEntries(Object.entries(body.summary).filter(([, v]) => v > 0));
    return this.call('POST', `/api/files/${fileId}/pdf/save`, { ...body, summary });
  }

  async abort(fileId: number, uploadId: string): Promise<void> {
    await this.call('DELETE', `/api/files/${fileId}/pdf/uploads/${uploadId}`).catch(() => undefined);
  }
}
