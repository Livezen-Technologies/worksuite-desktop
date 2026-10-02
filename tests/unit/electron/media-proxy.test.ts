import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));
import { createApiProxy, isMediaPath, isProxyPathAllowed } from '../../../electron/services/api-proxy';
import type { HttpClient } from '../../../electron/services/http';
import type { OfflineCache } from '../../../electron/services/offline-cache';
it('permits signed HLS playlists and segments only through the configured server read proxy', () => {
  for (const name of ['master.m3u8', '720.m3u8', '720_0001.ts']) {
    const path = `/media/hls/signed~capability/${name}`;
    expect(isMediaPath(path)).toBe(true);
    expect(isProxyPathAllowed(path)).toBe(true);
    expect(isProxyPathAllowed(path, 'POST')).toBe(false);
  }
  for (const path of ['/media/hls/signed~capability/../private.ts', '/media/hls/signed~capability/http://evil.test/master.m3u8', '/media/hls/signed~capability/720.mp4'])
    expect(isProxyPathAllowed(path)).toBe(false);
});
it('streams the upstream response body and forwards range and cancellation', async () => {
  const controller = new AbortController();
  const bytes = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([1, 2]));
      c.close();
    },
  });
  const raw = vi.fn(
    async (_method: string, _url: string, _options: RequestInit) =>
      new Response(bytes, { status: 206, headers: { 'Content-Range': 'bytes 0-1/100', 'Content-Type': 'video/mp2t' } }),
  );
  const proxy = createApiProxy({
    http: { raw, url: (p: string) => `https://configured.test${p}` } as unknown as HttpClient,
    cache: {} as OfflineCache,
    userId: () => '7',
    cacheModuleFor: () => null,
    cacheLimits: () => ({}) as never,
    mailBodiesCached: () => false,
  });
  const response = await proxy(
    new Request('app://bundle/__api/media/hls/signed~capability/720_0001.ts', { headers: { Range: 'bytes=0-1' }, signal: controller.signal }),
    '/media/hls/signed~capability/720_0001.ts',
  );
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 0-1/100');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  const options = raw.mock.calls[0]?.[2] as unknown as { headers: Headers; signal: AbortSignal };
  expect(options.headers.get('range')).toBe('bytes=0-1');
  controller.abort();
  expect(options.signal.aborted).toBe(true);
});
