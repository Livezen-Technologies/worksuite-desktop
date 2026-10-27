import { logger } from '../main/log';
import type { UploadTarget } from '@shared/ipc/contract';
import type { Transfer, DrivePrefs } from '@shared/types';
import type { Database } from './db';
import type { Vault } from './vault';
import type { HttpClient } from './http';
import { bytesPerSecond } from '@shared/transfers';
import { isDesktopError, DesktopError } from '../main/errors';
import { refusalMessage, CHUNK_BYTES, VOICE_CHUNKED_FROM, VOICE_CHUNK_BYTES, CHUNKED_FROM } from '@shared/uploads';
import { randomUUID } from 'node:crypto';
import { OFFICE_EXPORT_TOKEN } from '@shared/office';
import { basename, join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';

/** The transfer queue's types, retry rules, multipart and folder helpers (electron/services/transfers.ts; audit D-G13). */

export const log = logger('transfers');

export interface Handle {
  path: string;
  name: string;
  size: number;
  relativePath?: string;
  owned?: boolean;
}

export interface Meta {
  path: string | null;
  fileId: string | null;
  /** API path the download is fetched from (built by the main process). */
  source?: string | null;
  uploadId: string | null;
  target: UploadTarget | null;
  chunkSize: number | null;
  totalChunks: number | null;
  sha256: string | null;
  tempPath: string | null;
  finalPath: string | null;
  openWhenDone: boolean;
  /** Inside an uploaded folder: where the server puts it, folders made as needed. */
  relativePath?: string | null;
  /** Kept inside the app, not in the downloads folder: the name of the sink that takes the bytes (`deps.sink`). */
  sink?: string | null;
  /** When it last joined the queue: the order it starts in, also after a restart. */
  queuedAt?: string | null;
  /** Waiting to be tried again by itself, from then. */
  retryAt?: string | null;
  /** Times it has been tried again by itself since it was last started by hand. */
  attempts?: number;
  /** Its last failure was the network's or a busy server's: worth trying again once the connection is back. */
  temporary?: boolean;
  /**
   * Paused because the connection was lost, to be resumed by hand (Drive › Settings › auto-resume off) — or, still
   * queued, an upload the account's storage refused (QUOTA_EXCEEDED): it waits for `releaseQuota()`, nothing lost.
   */
  waitingFor?: 'connection' | 'quota' | null;
  /** The place the person chose for it, when they were asked where to save (main-process dialog only). */
  exactPath?: string | null;
  /** The server has the whole upload (`complete` answered): trying again never sends it a second time. */
  completed?: boolean;
  ownedSource?: boolean;
  phase?: Transfer['phase'];
  /** A mail attachment, staged on the server once its parts are in (#249): what Compose attaches. */
  attachment?: { token: string; name: string; size: number } | null;
}

/**
 * Where a download kept inside the app goes instead of the downloads folder
 * (eLearning's offline copies): it takes the bytes as they arrive and says
 * how much an earlier attempt kept, so a resume asks the server from there.
 */
export interface DownloadSink {
  /** Bytes already kept that this attempt can go on after (0: start again). */
  resumeFrom(): Promise<number>;
  /** Opened at `offset`: what `resumeFrom` said, or 0 when the server sent the whole file again. */
  open(offset: number): Promise<SinkWriter>;
  discard(): Promise<void>;
}

export interface SinkWriter {
  write(b: Uint8Array): Promise<void>;
  /** `complete`: every byte arrived (`total` of them); otherwise what arrived whole is kept for a resume. */
  close(complete: boolean, total: number): Promise<void>;
}

export interface Live {
  t: Transfer;
  meta: Meta;
  abort: AbortController | null;
  samples: Array<{ at: number; bytes: number }>;
  /** When bytes last moved (or it started): a run that has stopped moving is told from a slow one. */
  movedAt?: number;
}

/** A short-lived download grant the server minted for one file (`/d/{token}`, e.g. a task's attachment). */
export function isGrantPath(path: string): boolean {
  return /^\/d\/[A-Za-z0-9]{16,128}$/.test(path);
}

export interface TransferDeps {
  db: Database;
  vault: () => Vault;
  http: HttpClient;
  userId: () => string | null;
  downloadFolder: () => string;
  hash: (path: string) => Promise<{ sha256: string; bytes: number }>;
  canOpenFiles: () => boolean;
  audit: (action: string, details: Record<string, unknown>) => void;
  /** The sink a download kept inside the app writes to, by the name it was started with. */
  sink?: (name: string) => DownloadSink | null;
  /**
   * Opens a finished download inside WorkSuite when it can (PDFs in PDF
   * Studio); false leaves it to the system's own application.
   */
  openInApp?: (path: string) => boolean;
  /** Says that a transfer the person started has finished or failed (Drive › Settings › Notifications). */
  notify?: (t: Transfer, how: 'done' | 'failed') => void;
  /** A finished download, by where it was saved and where it came from: mail's attachments are marked as from the internet (ENH-MAIL-03 DMO-SEC-04). */
  downloaded?: (path: string, source: string) => void | Promise<void>;
  /** How long before the n-th automatic retry (0 first); tests make it short. */
  retryDelay?: (attempt: number) => number;
  /**
   * An upload was refused because the account's storage is full (Cloud's QUOTA_EXCEEDED): it waits, queued, for
   * `releaseQuota()` — the quota watcher asks Cloud more often meanwhile (Connection & Startup §3).
   */
  onQuotaHeld?: () => void;
  /** How long a request may go without moving a byte or answering before it counts as stalled (#249); tests make it short. */
  stallMs?: number;
  /** Between two questions about an upload the server is still putting together (#249); tests make it short. */
  pollMs?: number;
  /** Before the n-th new try of one part (0 first); tests make it short. */
  partDelay?: (attempt: number) => number;
  /**
   * A copy already on this computer, by the download's address: a mail
   * attachment kept in the local mail store (worksuite-desktop#163) opens
   * from there at once, also offline, instead of being fetched again.
   */
  localCopy?: (source: string) => Buffer | null;
  /** Whether there is one, without reading it: such a download starts offline too. */
  hasLocalCopy?: (source: string) => boolean;
}

/** How the queue runs: Drive › Settings, as the transfer manager takes it. */
export interface QueueConfig {
  maxConcurrent: number;
  maxUploads: number | null;
  maxDownloads: number | null;
  /** Combined bytes a second for every upload, every download; null is Unlimited. */
  uploadBps: number | null;
  downloadBps: number | null;
  autoRetry: boolean;
  autoResume: boolean;
  metered: 'normal' | 'limit' | 'pause';
  meteredConnection?: boolean;
}

export function queueConfig(p: DrivePrefs): QueueConfig {
  return {
    maxConcurrent: p.maxConcurrent,
    maxUploads: p.maxUploads,
    maxDownloads: p.maxDownloads,
    uploadBps: bytesPerSecond(p.uploadLimit),
    downloadBps: bytesPerSecond(p.downloadLimit),
    autoRetry: p.autoRetry,
    autoResume: p.autoResume,
    metered: p.metered,
    meteredConnection: p.meteredConnection,
  };
}

/** Automatic tries after a temporary failure, before it is left for the person to retry. */
export const MAX_AUTO_RETRIES = 4;

/** An answer worth asking again later: the server busy, overloaded or out of reach for a moment. */
export function isTemporaryStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/**
 * A failure the network or a busy server caused — a dropped connection, a
 * timeout, a 5xx — as opposed to one trying again would only repeat (a file
 * that is gone, a permission refused, a disk that is full).
 */
export function isTemporaryFailure(e: unknown): boolean {
  if (isDesktopError(e)) return e.code === 'NETWORK_UNREACHABLE' || e.code === 'RATE_LIMITED' || (e.code === 'SERVER_ERROR' && e.status !== null && isTemporaryStatus(e.status));
  const err = e as { message?: unknown; cause?: unknown; code?: unknown } | null;
  const text = `${String(err?.message ?? e)} ${String(err?.cause ?? '')} ${String(err?.code ?? '')}`;
  return /ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH|UND_ERR|socket|terminated|fetch failed|network|timed? ?out/i.test(text);
}

export class Temporary extends Error {}

export function messageOf(e: unknown): string {
  return isDesktopError(e) ? e.message : String((e as Error)?.message ?? e);
}

/** A failure that only means the connection went (or stalled): waited out however long it takes (#249). */
export function isConnectionFailure(e: unknown): boolean {
  if (e instanceof Stalled) return true;
  if (isDesktopError(e)) return e.code === 'NETWORK_UNREACHABLE' || e.code === 'CANCELLED';
  if (e instanceof Temporary) return false;
  return isTemporaryFailure(e);
}

export class Stalled extends Error {}

/** The words on an upload waiting for room (screen 13's promise: nothing is lost, it goes on by itself). */
export const QUOTA_HELD = 'Your storage is full. This upload continues as soon as there is room.';
/** An upload waiting for room tries again by itself this often, in case nobody says there is room. */
export const QUOTA_RETRY_MS = 30 * 60_000;

/** A refusal from the upload API in words a person can act on: the size limit, the file's type (#249). */
export function refusal(e: unknown): unknown {
  if (!isDesktopError(e) || e.status === null || isTemporaryStatus(e.status)) return e;
  if (e.status !== 413 && e.status !== 415 && e.status !== 422 && e.status !== 403) return e;
  const said = refusalMessage(e.status, e.message);
  return said === e.message ? e : new DesktopError(e.code, said, e.status);
}

/** What the renderer may know of an upload's destination: a mail attachment's staged copy, a tender's place (#249). */
export function uploadExtras(m: Meta): Pick<Transfer, 'attachment' | 'tender'> {
  const t = m.target;
  if (t?.kind === 'mail') return { attachment: m.attachment ?? null };
  if (t?.kind === 'tender') return { tender: { tenderId: t.tenderId, into: t.into, ...(t.id ? { id: t.id } : {}), ...(t.docKind ? { docKind: t.docKind } : {}) } };
  return {};
}

/** Waits `ms`, or less when the signal aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => (clearTimeout(timer), signal.removeEventListener('abort', done), resolve());
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * One part as `multipart/form-data`, streamed (#249): the bytes go out a slice
 * at a time as the connection takes them, so the caller sees them move — a
 * part that is slow is told from one that has stalled. Built afresh for every
 * try (a stream is read once).
 */
export function multipartPart(fields: Record<string, string>, fileField: string, fileName: string, data: Uint8Array, onSent: (bytes: number) => void, slice = 64 * 1024): { body: ReadableStream<Uint8Array>; contentType: string; length: number } {
  const boundary = `----WorkSuitePart${randomUUID().replace(/-/g, '')}`;
  const safe = (v: string) => v.replace(/["\r\n]/g, '_');
  let head = '';
  for (const [k, v] of Object.entries(fields)) head += `--${boundary}\r\nContent-Disposition: form-data; name="${safe(k)}"\r\n\r\n${v}\r\n`;
  head += `--${boundary}\r\nContent-Disposition: form-data; name="${safe(fileField)}"; filename="${safe(fileName)}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const start = Buffer.from(head, 'utf8');
  const end = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  let at = -1;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at < 0) {
        at = 0;
        c.enqueue(new Uint8Array(start));
        return;
      }
      // What was handed over before this pull has gone out (the connection asked for more).
      onSent(at);
      if (at < data.byteLength) {
        const next = Math.min(data.byteLength, at + slice);
        c.enqueue(data.subarray(at, next));
        at = next;
        return;
      }
      c.enqueue(new Uint8Array(end));
      c.close();
    },
  });
  return { body, contentType: `multipart/form-data; boundary=${boundary}`, length: start.byteLength + data.byteLength + end.byteLength };
}

/** An Office export's signed download (`/office/exports/{token}`, ten minutes, web-api §8): fetched from our own server. */
export function isOfficeExportPath(apiPath: string): boolean {
  const m = /^\/office\/exports\/([^/?#]+)$/.exec(apiPath);
  return !!m && OFFICE_EXPORT_TOKEN.test(m[1]!);
}

/** How a download that someone is waiting for ended (a copy to open in another app). */
export type DownloadOutcome = { path: string } | { error: string };
export const MAX_FOLDER_FILES = 2000;

/**
 * Every file under a folder, depth first, with its path inside the folder
 * (the folder's own name first). Hidden files, symbolic links and anything
 * past 20 levels are left out.
 */
export async function walkFolder(root: string): Promise<Array<{ path: string; size: number; relativePath: string }>> {
  const out: Array<{ path: string; size: number; relativePath: string }> = [];
  const top = basename(root);
  const visit = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > 20 || out.length > MAX_FOLDER_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await visit(full, `${rel}/${e.name}`, depth + 1);
      else if (e.isFile()) out.push({ path: full, size: (await stat(full)).size, relativePath: `${rel}/${e.name}` });
    }
  };
  await visit(root, top, 0);
  return out;
}
export const CHUNK = CHUNK_BYTES;
const MIN_CHUNK = 256 * 1024;

/**
 * The size of each part an upload is sent in. A file up to 8 MB goes in one
 * part: every part is its own request (and its own round trip), and a
 * document split into twentieths sent them one after another, so a 1 MB PDF
 * took four trips where one would do. Its progress still moves as the bytes
 * go (multipartPart reports every 64 KB). A large one (over 8 MB, #249) goes
 * in full 8 MB parts, several at a time: fewer requests, each one short
 * enough to try again cheaply.
 */
export function chunkSizeFor(size: number, target?: UploadTarget | null): number {
  // A voice message above 1 MB goes in small parts, so a dropped connection costs one part, not the recording (#300).
  if (target?.kind === 'chat' && target.voice) return size > VOICE_CHUNKED_FROM ? VOICE_CHUNK_BYTES : Math.max(MIN_CHUNK, Math.ceil(Math.max(0, size) / MIN_CHUNK) * MIN_CHUNK);
  if (size > CHUNKED_FROM) return CHUNK;
  return Math.min(CHUNK, Math.max(MIN_CHUNK, Math.ceil(Math.max(0, size) / MIN_CHUNK) * MIN_CHUNK));
}
/** The largest file offered in a remote-control session: it goes in one request. */
export const REMOTE_MAX = 512 * 1024 * 1024;

/**
 * Files an uploaded Drive file on a tender, the way the web's tender screens
 * do: a new document, a checklist line's next version, a document's
 * replacement, or a bond's copy. The server checks the tender, the caller's
 * attachment permission and that the file is theirs to attach.
 */
export async function fileOnTender(http: Pick<HttpClient, 'post' | 'request'>, target: Extract<UploadTarget, { kind: 'tender' }>, fileId: number, name: string): Promise<void> {
  if (target.into === 'document') {
    await http.post(`/api/tenders/${target.tenderId}/documents`, { file_id: fileId, kind: target.docKind ?? 'other', title: name });
    return;
  }
  if (!target.id) throw new DesktopError('IPC_VALIDATION_FAILED', 'Which line, document or bond is this for?');
  if (target.into === 'line') await http.post(`/api/tenders/checklist/${target.id}/file`, { file_id: fileId, name });
  else if (target.into === 'replace') await http.request('PUT', `/api/tenders/documents/${target.id}`, { body: { file_id: fileId } });
  else await http.request('PUT', `/api/tenders/securities/${target.id}`, { body: { file_id: fileId } });
}
