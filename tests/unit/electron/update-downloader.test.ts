import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ResumableDownload, type DownloadProgressEvent } from '../../../electron/updater/downloader';
import type { FetchLike } from '../../../electron/services/http';

/**
 * The update package download (Settings › Updates): Pause, Cancel, and carrying on after a lost network or a
 * restart with HTTP Range, checked by SHA-256 over the whole file.
 */

const PACKAGE = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
const SHA = createHash('sha256').update(PACKAGE).digest('hex');

function partialPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'ws-dl-')), 'WorkSuite.AppImage.partial');
}

/** A server that honours Range (206), or not (200), and can drop the connection after `dropAfter` bytes once. */
function server(opts: { ranges?: boolean; dropAfter?: number | null; status?: number } = {}) {
  const ranges = opts.ranges ?? true;
  let drop = opts.dropAfter ?? null;
  const seen: Array<string | null> = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const range = (init.headers as Record<string, string> | undefined)?.Range ?? null;
    seen.push(range);
    if (opts.status) return new Response('nope', { status: opts.status });
    const from = ranges && range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    const body = PACKAGE.subarray(from);
    const cut = drop;
    drop = null;
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        if (cut !== null) return;
        for (let i = 0; i < body.length; i += 1024) c.enqueue(new Uint8Array(body.subarray(i, i + 1024)));
        c.close();
      },
      // The dropped connection: some bytes arrive, then the socket resets.
      pull(c) {
        if (cut === null) return;
        if (!sent) {
          sent = true;
          c.enqueue(new Uint8Array(body.subarray(0, cut)));
        } else c.error(new Error('ECONNRESET'));
      },
    });
    return ranges && range
      ? new Response(stream, { status: 206, headers: { 'content-range': `bytes ${from}-${PACKAGE.length - 1}/${PACKAGE.length}` } })
      : new Response(stream, { status: 200, headers: { 'accept-ranges': ranges ? 'bytes' : 'none' } });
  }) as unknown as FetchLike;
  return { fetch, seen };
}

describe('ResumableDownload', () => {
  it('downloads the whole file and hashes it', async () => {
    const { fetch } = server();
    const events: DownloadProgressEvent[] = [];
    const partial = partialPath();
    const r = await new ResumableDownload({ fetch }, { url: 'https://cdn.example/x', partial, size: PACKAGE.length, onProgress: (p) => events.push(p) }).run();
    expect(r).toEqual({ ok: true, sha256: SHA, bytes: PACKAGE.length });
    expect(readFileSync(partial).equals(PACKAGE)).toBe(true);
    expect(events.at(-1)).toMatchObject({ received: PACKAGE.length, total: PACKAGE.length, retrying: false, resumable: true });
  });

  it('carries on from a partial file with a Range request', async () => {
    const { fetch, seen } = server();
    const partial = partialPath();
    writeFileSync(partial, PACKAGE.subarray(0, 1500));
    const r = await new ResumableDownload({ fetch }, { url: 'https://cdn.example/x', partial, size: PACKAGE.length }).run();
    expect(seen).toEqual(['bytes=1500-']);
    expect(r).toEqual({ ok: true, sha256: SHA, bytes: PACKAGE.length });
  });

  it('starts again when the server ignores the Range', async () => {
    const { fetch } = server({ ranges: false });
    const partial = partialPath();
    writeFileSync(partial, Buffer.from('stale bytes'));
    const r = await new ResumableDownload({ fetch }, { url: 'https://cdn.example/x', partial, size: PACKAGE.length }).run();
    expect(r).toEqual({ ok: true, sha256: SHA, bytes: PACKAGE.length });
  });

  it('resumes after the network drops, from where it stopped', async () => {
    const { fetch, seen } = server({ dropAfter: 1000 });
    const sleep = vi.fn(async () => undefined);
    const events: DownloadProgressEvent[] = [];
    const r = await new ResumableDownload({ fetch, sleep }, { url: 'https://cdn.example/x', partial: partialPath(), size: PACKAGE.length, onProgress: (p) => events.push(p) }).run();
    expect(r).toEqual({ ok: true, sha256: SHA, bytes: PACKAGE.length });
    expect(seen).toEqual([null, 'bytes=1000-']);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.retrying)).toBe(true);
  });

  it('gives up after repeated network losses', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as FetchLike;
    const r = await new ResumableDownload({ fetch, sleep: async () => undefined, maxRetries: 2 }, { url: 'https://cdn.example/x', partial: partialPath(), size: PACKAGE.length }).run();
    expect(r).toEqual({ ok: false, reason: 'network' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('pauses, keeping what arrived, and cancel deletes it', async () => {
    const partial = partialPath();
    let job: ResumableDownload | null = null;
    const { fetch } = server();
    job = new ResumableDownload({ fetch }, { url: 'https://cdn.example/x', partial, size: PACKAGE.length, onProgress: (p) => p.received > 0 && job!.pause() });
    expect(await job.run()).toEqual({ ok: false, reason: 'paused' });
    const kept = readFileSync(partial).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(PACKAGE.length);
    // Resume: a fresh run carries on with a Range.
    const again = server();
    expect(await new ResumableDownload({ fetch: again.fetch }, { url: 'https://cdn.example/x', partial, size: PACKAGE.length }).run()).toEqual({ ok: true, sha256: SHA, bytes: PACKAGE.length });
    expect(again.seen).toEqual([`bytes=${kept}-`]);
    // Cancel.
    const c = server();
    const cancelled = new ResumableDownload({ fetch: c.fetch }, { url: 'https://cdn.example/x', partial: partialPath(), size: PACKAGE.length, onProgress: () => cancelled.cancel() });
    const part = (cancelled as unknown as { job: { partial: string } }).job.partial;
    expect(await cancelled.run()).toEqual({ ok: false, reason: 'cancelled' });
    expect(existsSync(part)).toBe(false);
  });

  it('refuses more bytes than announced, and asks for a fresh URL once when refused', async () => {
    const { fetch } = server();
    expect(await new ResumableDownload({ fetch }, { url: 'https://cdn.example/x', partial: partialPath(), size: 100 }).run()).toEqual({ ok: false, reason: 'too-large' });
    const refused = server({ status: 403 });
    const refresh = vi.fn(async () => null);
    expect(await new ResumableDownload({ fetch: refused.fetch }, { url: 'https://cdn.example/x', partial: partialPath(), size: PACKAGE.length, refresh }).run()).toEqual({ ok: false, reason: 'http', status: 403 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
