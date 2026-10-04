import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat, truncate } from 'node:fs/promises';
import type { FetchLike } from '../services/http';

/**
 * The update package download (Settings › Updates): resumable with HTTP Range, so Pause, a lost network or a
 * restart of WorkSuite carry on where they stopped instead of starting over. The partial file stays next to the
 * final one (`<name>.partial`); the SHA-256 is taken over the whole file once it is complete, so a resumed download
 * is checked exactly like one made in one go.
 */

export interface DownloadProgressEvent {
  received: number;
  total: number;
  bytesPerSecond: number;
  secondsLeft: number | null;
  retrying: boolean;
  resumable: boolean;
}

export type DownloadResult =
  | { ok: true; sha256: string; bytes: number }
  | { ok: false; reason: 'paused' | 'cancelled' }
  | { ok: false; reason: 'http'; status: number }
  | { ok: false; reason: 'too-large' | 'network' | 'range' };

export interface DownloadJob {
  url: string;
  /** Where the bytes go while downloading. */
  partial: string;
  /** The size the signed answer announced. */
  size: number;
  /** A fresh signed URL when the current one has expired (the Update Center's download grant). */
  refresh?: () => Promise<string | null>;
  onProgress?: (p: DownloadProgressEvent) => void;
}

export interface DownloaderDeps {
  fetch: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Network losses in a row before giving up. */
  maxRetries?: number;
  /** No bytes for this long counts as a lost connection. */
  stallMs?: number;
}

const BACKOFF_MS = [1_000, 3_000, 10_000, 30_000, 60_000];
const SPEED_WINDOW_MS = 5_000;
const PROGRESS_EVERY_MS = 250;

class Stopped extends Error {
  constructor(readonly why: 'paused' | 'cancelled' | 'stall') {
    super(why);
  }
}

export class ResumableDownload {
  private controller: AbortController | null = null;
  private stop: 'paused' | 'cancelled' | null = null;
  private samples: Array<{ t: number; bytes: number }> = [];
  private lastEmit = 0;
  private resumable = false;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly deps: DownloaderDeps,
    private readonly job: DownloadJob,
  ) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Stops, keeping what has arrived; run() again (or a new download of the same file) carries on from there. */
  pause(): void {
    this.stop = 'paused';
    this.controller?.abort(new Stopped('paused'));
  }

  /** Stops and deletes what has arrived. */
  cancel(): void {
    this.stop = 'cancelled';
    this.controller?.abort(new Stopped('cancelled'));
  }

  private async existing(): Promise<number> {
    try {
      return (await stat(this.job.partial)).size;
    } catch {
      return 0;
    }
  }

  private emit(received: number, retrying: boolean, force = false): void {
    const t = this.now();
    this.samples.push({ t, bytes: received });
    while (this.samples.length > 2 && t - this.samples[0]!.t > SPEED_WINDOW_MS) this.samples.shift();
    if (!force && t - this.lastEmit < PROGRESS_EVERY_MS) return;
    this.lastEmit = t;
    const first = this.samples[0]!;
    const dt = (t - first.t) / 1000;
    const speed = dt > 0 ? Math.max(0, (received - first.bytes) / dt) : 0;
    const left = this.job.size - received;
    this.job.onProgress?.({ received, total: this.job.size, bytesPerSecond: Math.round(speed), secondsLeft: speed > 0 ? Math.ceil(left / speed) : null, retrying, resumable: this.resumable });
  }

  async run(): Promise<DownloadResult> {
    this.stop = null;
    let url = this.job.url;
    let offset = await this.existing();
    if (offset > this.job.size) {
      await rm(this.job.partial, { force: true });
      offset = 0;
    }
    let failures = 0;
    let refreshed = false;
    const maxRetries = this.deps.maxRetries ?? 5;
    while (offset < this.job.size) {
      if (this.stop) return this.finishStopped();
      this.controller = new AbortController();
      const signal = this.controller.signal;
      try {
        const headers: Record<string, string> = offset > 0 ? { Range: `bytes=${offset}-` } : {};
        const res = await this.deps.fetch(url, { method: 'GET', headers, signal });
        if (!res.ok && res.status !== 416 && this.job.refresh && !refreshed) {
          refreshed = true;
          const fresh = await this.job.refresh();
          if (fresh) {
            url = fresh;
            continue;
          }
        }
        if (res.status === 416 && offset > 0) {
          // The server no longer agrees about what we have: start again.
          await rm(this.job.partial, { force: true });
          offset = 0;
          continue;
        }
        if (!res.ok || !res.body) {
          if (res.status >= 500 && failures < maxRetries) throw new Error(`server answered ${res.status}`);
          return { ok: false, reason: 'http', status: res.status };
        }
        if (offset > 0 && res.status !== 206) {
          // Ranges not honoured: the whole file is coming, so start the partial again.
          this.resumable = false;
          offset = 0;
          await truncate(this.job.partial, 0).catch(() => undefined);
        } else if (res.status === 206) {
          this.resumable = true;
          const m = /bytes (\d+)-/.exec(res.headers.get('content-range') ?? '');
          if (!m || Number(m[1]) !== offset) return { ok: false, reason: 'range' };
        } else {
          this.resumable = (res.headers.get('accept-ranges') ?? '').toLowerCase() === 'bytes';
        }
        offset = await this.receive(res.body, offset, signal);
        failures = 0;
        if (offset >= this.job.size) break;
        // The connection closed early: carry on from here.
        throw new Error('connection closed early');
      } catch (e) {
        if (e instanceof TooLarge) {
          await rm(this.job.partial, { force: true });
          return { ok: false, reason: 'too-large' };
        }
        if (this.stop) return this.finishStopped();
        offset = await this.existing();
        failures++;
        if (failures > maxRetries) return { ok: false, reason: 'network' };
        this.emit(offset, true, true);
        await this.sleep(BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]!);
      } finally {
        this.controller = null;
      }
    }
    this.emit(offset, false, true);
    return this.digest();
  }

  private async finishStopped(): Promise<DownloadResult> {
    if (this.stop === 'cancelled') {
      await rm(this.job.partial, { force: true });
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'paused' };
  }

  /** Appends the body to the partial file from `offset`; returns the new length. */
  private async receive(body: ReadableStream<Uint8Array>, offset: number, signal: AbortSignal): Promise<number> {
    const out = createWriteStream(this.job.partial, { flags: offset > 0 ? 'a' : 'w', mode: 0o600 });
    const reader = body.getReader();
    let received = offset;
    let stall: NodeJS.Timeout | null = null;
    const arm = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => this.controller?.abort(new Stopped('stall')), this.deps.stallMs ?? 60_000);
      stall.unref?.();
    };
    const onAbort = () => void reader.cancel().catch(() => undefined);
    signal.addEventListener('abort', onAbort);
    try {
      arm();
      for (;;) {
        const { done, value } = await reader.read();
        if (signal.aborted) throw signal.reason ?? new Error('aborted');
        if (done) break;
        arm();
        if (received + value.byteLength > this.job.size) throw new TooLarge();
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        received += value.byteLength;
        this.emit(received, false);
      }
      return received;
    } finally {
      if (stall) clearTimeout(stall);
      signal.removeEventListener('abort', onAbort);
      await new Promise<void>((r) => out.end(() => r()));
    }
  }

  private async digest(): Promise<DownloadResult> {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(this.job.partial)) {
      hash.update(chunk as Buffer);
      bytes += (chunk as Buffer).byteLength;
    }
    return { ok: true, sha256: hash.digest('hex'), bytes };
  }
}

class TooLarge extends Error {
  constructor() {
    super('update larger than announced');
  }
}
