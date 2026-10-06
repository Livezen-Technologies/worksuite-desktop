import { createServer, type Server } from 'node:net';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiTimings,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  SPEED_DOWNLOAD_BYTES,
  SPEED_MAX_MS,
  SPEED_STREAMS,
  SPEED_UPLOAD_BYTES,
  connectionLabel,
  serverLabel,
  summarizeConnection,
  summarizeServer,
} from '@shared/connection';
import type { RealtimeState } from '@shared/types';
import { ConnectionMonitor, SPEED_UPLOAD_CHECK_BYTES, TCP_RETRY_MS, serverTimingMs, tcpHandshake, type RealtimeLike } from '../../../electron/services/connection-quality';
import type { HttpClient } from '../../../electron/services/http';
import { createNetFetch, type NetRequest } from '../../../electron/services/net-fetch';

/**
 * Connection strength measures your connection, not the server (worksuite-desktop#265): the network delay by the
 * realtime echo, else the time to open a TCP connection, else the server check as an upper bound (less the server's
 * own time where it says so); the WorkSuite server's median and slowest 5% apart; and a speed test that downloads up
 * to 25 MB over four connections for at most 8 s, and uploads only where the server takes it.
 */

class FakeRealtime implements RealtimeLike {
  state: RealtimeState = 'connected';
  /** False on SSE (one-way) or the built-in service: no echo can be sent. */
  canSend = true;
  sent: string[] = [];
  onPong: (id: string) => void = () => undefined;
  onReconnect: () => void = () => undefined;
  getState() {
    return this.state;
  }
  sendPing(id: string) {
    if (this.state !== 'connected' || !this.canSend) return false;
    this.sent.push(id);
    return true;
  }
  gatewayHost() {
    return 'rt.example.com';
  }
  reconnectNow() {}
}

const ORIGIN = 'https://ws.example.com';
const url = (p: string, q?: Record<string, unknown>) => `${ORIGIN}${p}${q ? `?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString()}` : ''}`;
type Raw = (method: string, url: string, init?: Record<string, unknown>) => Promise<Response>;

function monitor(opts: { rt?: FakeRealtime; raw?: Raw; tcpPing?: (origin: string) => Promise<number | null>; bulk?: Raw; clock?: () => number; now?: () => number } = {}) {
  const rt = opts.rt ?? new FakeRealtime();
  const raw = vi.fn(opts.raw ?? (async () => new Response('{"status":"success","data":{}}', { status: 200 })));
  const http = { raw, url } as unknown as Pick<HttpClient, 'raw' | 'url'>;
  const bulkRaw = opts.bulk ? vi.fn(opts.bulk) : null;
  const api = new ApiTimings();
  const m = new ConnectionMonitor({
    realtime: rt,
    http,
    ...(bulkRaw ? { bulk: { raw: bulkRaw, url } as unknown as Pick<HttpClient, 'raw' | 'url'> } : {}),
    ...(opts.tcpPing ? { tcpPing: opts.tcpPing } : {}),
    origin: () => ORIGIN,
    active: () => true,
    onChange: () => undefined,
    api,
    now: opts.now ?? (() => Date.now()),
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  return { m, rt, raw, bulkRaw, api };
}

const summary = (m: ConnectionMonitor, api?: ApiTimings) => summarizeConnection({ stats: { ...m.stats(), ...(api ? { api: api.summary() } : {}) }, realtime: 'connected', network: 'ONLINE', attempt: 0, now: Date.now() });

describe('the network delay without the realtime echo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T17:36:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('on SSE or the built-in service, times a TCP connection to the server — the slow server check is never sent', async () => {
    for (const setup of [(rt: FakeRealtime) => (rt.canSend = false), (rt: FakeRealtime) => (rt.state = 'disabled')]) {
      const rt = new FakeRealtime();
      setup(rt);
      const delays = [38, 40, 36];
      const tcpPing = vi.fn(async () => delays.shift() ?? 38);
      // The server takes 2 s for anything: were it asked, the connection would look slow.
      const { m, raw } = monitor({ rt, tcpPing, raw: () => new Promise((r) => setTimeout(() => r(new Response('{}')), 2_000)) });
      for (let i = 0; i < 3; i++) {
        m.tick();
        await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
      }
      expect(tcpPing).toHaveBeenCalledWith(ORIGIN);
      expect(raw).not.toHaveBeenCalled();
      expect(m.stats().samples.map((s) => [s.ms, s.via, !!s.upper])).toEqual([
        [38, 'tcp-connect', false],
        [40, 'tcp-connect', false],
        [36, 'tcp-connect', false],
      ]);
      const s = summary(m);
      expect(s).toMatchObject({ level: 'excellent', delayMs: 38, upperBound: false });
      expect(connectionLabel(s, true)).toBe('Excellent · 38 ms');
    }
  });

  it('an older gateway that never echoes: TCP once the echo goes unanswered', async () => {
    const tcpPing = vi.fn(async () => 52);
    const { m, rt, raw } = monitor({ tcpPing });
    m.tick();
    expect(rt.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PING_TIMEOUT_MS);
    expect(tcpPing).toHaveBeenCalledTimes(1);
    expect(raw).not.toHaveBeenCalled();
    expect(m.stats().probe).toBe('tcp-connect');
  });

  it('through a proxy (or refused) falls back to the server check, and rests TCP for five minutes after a second time', async () => {
    const rt = new FakeRealtime();
    rt.canSend = false;
    const tcpPing = vi.fn(async () => {
      throw new Error('reached through a proxy');
    });
    const { m, raw } = monitor({ rt, tcpPing });
    m.tick();
    await vi.advanceTimersByTimeAsync(0);
    m.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(tcpPing).toHaveBeenCalledTimes(2);
    expect(raw).toHaveBeenCalledTimes(2);
    expect(raw.mock.calls[0]![1]).toBe(`${ORIGIN}/api/health`);
    m.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(tcpPing).toHaveBeenCalledTimes(2);
    expect(raw).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(TCP_RETRY_MS);
    m.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(tcpPing).toHaveBeenCalledTimes(3);
  });

  it('a TCP connection that worked and then gets no answer in time is a lost reply', async () => {
    const rt = new FakeRealtime();
    rt.canSend = false;
    const answers: (number | null)[] = [40, null];
    const { m } = monitor({ rt, tcpPing: async () => answers.shift() ?? null });
    m.tick();
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    m.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.stats()).toMatchObject({ probe: 'tcp-connect', sent: 2, missed: 1 });
    expect(m.stats().samples.at(-1)).toMatchObject({ ms: null, via: 'tcp-connect' });
    expect(m.stats().samples.at(-1)!.upper).toBeUndefined();
  });
});

describe('the server check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T17:36:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const slow = (ms: number[], headers: (i: number) => Record<string, string> = () => ({})): Raw => {
    let i = 0;
    return () => {
      const n = i++;
      return new Promise((r) => setTimeout(() => r(new Response('{"status":"success","data":{}}', { status: 200, headers: headers(n) })), ms[n] ?? 700));
    };
  };

  it('is an upper bound on the delay: the fastest answer, and a 2 s server never makes the connection Poor', async () => {
    const rt = new FakeRealtime();
    rt.state = 'disabled';
    const { m } = monitor({ rt, raw: slow([1_900, 2_100, 2_400]) });
    for (let i = 0; i < 3; i++) {
      m.tick();
      await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    }
    expect(m.stats().samples.every((s) => s.upper && s.via === 'http-health')).toBe(true);
    const s = summary(m);
    expect(s).toMatchObject({ level: 'fair', upperBound: true, delayMs: 1_900, jitterMs: null });
    expect(connectionLabel(s, true)).toBe('Fair · ≤ 1900 ms');
  });

  it('less the time the server says it spent (Server-Timing): then it is the network delay', async () => {
    const rt = new FakeRealtime();
    rt.state = 'disabled';
    const { m } = monitor({ rt, raw: slow([650, 700, 640], (i) => ({ 'Server-Timing': ['app;dur=610.5, db;dur=200', 'total;dur=660', 'app;desc="x";dur=600'][i]! })) });
    for (let i = 0; i < 3; i++) {
      m.tick();
      await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    }
    expect(m.stats().samples.map((s) => [s.ms, !!s.upper])).toEqual([
      [40, false],
      [40, false],
      [40, false],
    ]);
    expect(summary(m)).toMatchObject({ level: 'excellent', delayMs: 40, upperBound: false });
  });

  it('a server check that fails is not counted as the network losing replies', async () => {
    const rt = new FakeRealtime();
    rt.state = 'disabled';
    let n = 0;
    const { m } = monitor({
      rt,
      raw: async () => {
        if (n++ % 2) throw new Error('timed out');
        return new Response('{}');
      },
    });
    for (let i = 0; i < 3; i++) {
      m.tick();
      await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    }
    const s = summary(m);
    expect(s.missed).toBe(1);
    expect(s.level).not.toBe('poor');
    expect(s.reasons).toContain('1 reply lost');
  });

  it('reads Server-Timing as the largest duration', () => {
    expect(serverTimingMs('app;dur=182.4, db;dur=40')).toBe(182.4);
    expect(serverTimingMs('cache;desc="hit", total;dur=12')).toBe(12);
    expect(serverTimingMs('miss, db;desc="no time"')).toBeNull();
    expect(serverTimingMs(null)).toBeNull();
  });
});

describe('tcpHandshake', () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });
  const listen = async (): Promise<{ port: number; received: () => number; opened: Promise<void> }> => {
    let bytes = 0;
    let opened: () => void = () => undefined;
    const openedP = new Promise<void>((r) => (opened = r));
    server = createServer((sock) => {
      opened();
      sock.on('data', (d) => (bytes += d.length));
      sock.on('error', () => undefined);
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    return { port: typeof addr === 'object' && addr ? addr.port : 0, received: () => bytes, opened: openedP };
  };

  it('times opening a TCP connection, sends nothing on it, and asks the proxy settings first', async () => {
    const { port, received, opened } = await listen();
    const resolveProxy = vi.fn(async () => 'DIRECT');
    const ms = await tcpHandshake({ resolveProxy })(`http://127.0.0.1:${port}`);
    await opened;
    expect(resolveProxy).toHaveBeenCalledWith(`http://127.0.0.1:${port}`);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThanOrEqual(0);
    expect(ms!).toBeLessThan(PING_TIMEOUT_MS);
    expect(received()).toBe(0);
  });

  it('does not measure through a proxy, and throws on a refusal', async () => {
    await expect(tcpHandshake({ resolveProxy: async () => 'PROXY proxy.example:8080; DIRECT' })(ORIGIN)).rejects.toThrow(/proxy/);
    const { port } = await listen();
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    await expect(tcpHandshake()(`http://127.0.0.1:${port}`)).rejects.toThrow();
  });
});

describe('createNetFetch: how much of an upload has gone', () => {
  /** Electron's ClientRequest, enough of it: takes the body at once (as Electron's does) and counts what has "gone". */
  class CountingRequest extends Writable {
    gone = 0;
    setHeader() {}
    abort() {}
    getUploadProgress() {
      return { active: true, started: true, current: this.gone, total: 0 };
    }
    override _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      this.gone += chunk.length;
      cb();
    }
    override _final(cb: () => void) {
      cb();
      setImmediate(() => this.emit('response', Object.assign(Readable.from([Buffer.from('{}')]), { statusCode: 200, statusMessage: 'OK', headers: {} })));
    }
  }

  it('reports Chromium’s count of the bytes gone, the last when the answer comes; nothing when not asked', async () => {
    const counts: number[] = [];
    const request = (() => new CountingRequest()) as unknown as NetRequest;
    const res = await createNetFetch(request)('https://ws.example.com/api/health/probe', { method: 'POST', body: new Uint8Array(300_000), onUploadProgress: (n) => counts.push(n) });
    expect(res.status).toBe(200);
    expect(counts.at(-1)).toBe(300_000);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    const plain = await createNetFetch(request)('https://ws.example.com/api/x', { method: 'POST', body: '{}' });
    expect(plain.status).toBe(200);
  });
});

describe('the WorkSuite server, apart from the connection', () => {
  it('keeps the last 50 requests: the median and the slowest 5%', () => {
    const t = new ApiTimings();
    for (let i = 1; i <= 100; i++) t.add(i * 10, true);
    expect(t.summary()).toEqual({ medianMs: 755, p95Ms: 980, count: 50, failed: 0 });
  });

  it('is Server slow over a second, Server errors when a quarter fail, and says nothing on too few requests', () => {
    expect(summarizeServer({ medianMs: 2_012, p95Ms: 4_300, count: 20, failed: 1 }).state).toBe('slow');
    expect(summarizeServer({ medianMs: 180, p95Ms: 400, count: 20, failed: 5 }).state).toBe('errors');
    expect(summarizeServer({ medianMs: 180, p95Ms: 400, count: 20, failed: 1 }).state).toBe('ok');
    expect(summarizeServer({ medianMs: 3_000, count: 2, failed: 0 }).state).toBe('unknown');
    expect(serverLabel(summarizeServer({ medianMs: 2_012, count: 20, failed: 1 }), true)).toBe('Server slow · 2.0 s');
    expect(serverLabel(summarizeServer({ medianMs: 2_140, count: 20, failed: 1 }), false)).toBe('Server slow');
    expect(serverLabel(summarizeServer({ medianMs: 180, count: 20, failed: 0 }), true)).toBeNull();
    // A slow line is not a slow server: one round trip of the measured delay is taken off first.
    expect(summarizeServer({ medianMs: 1_300, count: 20, failed: 0 }, 700).state).toBe('ok');
    expect(summarizeServer({ medianMs: 2_012, count: 20, failed: 1 }, 38).state).toBe('slow');
  });

  it('a slow server leaves the connection’s level alone (the issue: 93 Mbps, API median 2 s)', () => {
    const now = Date.now();
    const s = summarizeConnection({
      stats: { probe: 'realtime-echo', samples: [38, 40, 36].map((ms, i) => ({ at: now - (2 - i) * 10_000, ms, via: 'realtime-echo' as const })), reconnects: [], lastReconnectAt: null, sent: 3, missed: 0, api: { medianMs: 2_012, p95Ms: 2_267, count: 20, failed: 1 } },
      realtime: 'connected',
      network: 'ONLINE',
      attempt: 0,
      now,
    });
    expect(s).toMatchObject({ level: 'excellent', delayMs: 38 });
  });
});

describe('Run speed test', () => {
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const sizeOf = (init?: Record<string, unknown>) => (init?.body as Uint8Array).byteLength;
  const turn = () => new Promise<void>((r) => setImmediate(r));
  /**
   * An upload going out as the network would take it: 64 KB at a time, `ms` of the test's clock each, reported as
   * Chromium's count would be (`onUploadProgress`), the four connections taking turns. Stops when the request is.
   */
  const send = async (init: Record<string, unknown> | undefined, step: () => void): Promise<number> => {
    const size = sizeOf(init);
    const progress = init?.onUploadProgress as ((n: number) => void) | undefined;
    const signal = init?.signal as AbortSignal | undefined;
    let gone = 0;
    while (gone < size) {
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      step();
      gone = Math.min(size, gone + 64 * 1024);
      progress?.(gone);
      await turn();
    }
    return gone;
  };

  it('downloads 25 MB over four connections from the sized test download, and uploads 20 MB the server confirms — all on the bulk pool', async () => {
    let t = 0;
    const gets: string[] = [];
    const encodings: string[] = [];
    const posts: number[] = [];
    const bulk: Raw = async (method, u, init) => {
      if (method === 'GET') {
        gets.push(u);
        encodings.push((init?.headers as Record<string, string>)['Accept-Encoding']!);
        const kb = Number(new URL(u).searchParams.get('kb'));
        t += 100;
        return new Response(new Uint8Array(kb * 1024));
      }
      const got = init?.onUploadProgress ? await send(init, () => (t += 10)) : sizeOf(init);
      posts.push(got);
      // The server's own 2 s after the body is in: not part of the upload's time.
      t += 2_000;
      return json({ status: 'success', data: { bytes: got } });
    };
    const { m, raw, bulkRaw } = monitor({ bulk, clock: () => t });
    const r = await m.speedTest();
    expect(raw).not.toHaveBeenCalled();
    expect(bulkRaw).toHaveBeenCalled();
    // Four at once (one more may start as the first finishes); each asks for a quarter, uncompressed.
    expect(gets.length).toBeGreaterThanOrEqual(SPEED_STREAMS);
    expect(gets.every((g) => g.includes(`/api/health/probe?kb=${SPEED_DOWNLOAD_BYTES / 1024 / SPEED_STREAMS}`))).toBe(true);
    expect(new Set(encodings)).toEqual(new Set(['identity']));
    expect(r).toMatchObject({ source: 'probe', downloadBytes: SPEED_DOWNLOAD_BYTES, uploadSupported: true, uploadBytes: SPEED_UPLOAD_BYTES, streams: SPEED_STREAMS, error: null });
    expect(r.downloadMbps).toBeGreaterThan(0);
    // The check, then four uploads of 5 MB each.
    expect(posts).toEqual([SPEED_UPLOAD_CHECK_BYTES, ...Array(SPEED_STREAMS).fill(SPEED_UPLOAD_BYTES / SPEED_STREAMS)]);
    // 64 KB gone every 10 ms of the clock: 52.4 Mbps, timed by the bytes gone out — not by the server's answers after.
    expect(r.uploadMbps!).toBeCloseTo(52.4, 0);
  });

  it('stops after 8 seconds, timed from the first byte (the server’s wait to start is not the network’s)', async () => {
    let t = 0;
    let waited = false;
    const bulk: Raw = async (method) => {
      if (method === 'POST') return json({ status: 'error' }, 404);
      // The server takes 2 s to start answering (the four connections wait together), then 64 KB every 100 ms for as
      // long as it is read.
      if (!waited) t += 2_000;
      waited = true;
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(c) {
              t += 100;
              c.enqueue(new Uint8Array(64 * 1024));
            },
          },
          // Nothing read ahead: each chunk comes when asked for, 100 ms after the one before.
          { highWaterMark: 0 },
        ),
      );
    };
    const { m } = monitor({ bulk, clock: () => t });
    const r = await m.speedTest();
    expect(t).toBeLessThan(SPEED_MAX_MS + 2_000 + 500);
    expect(r.downloadBytes).toBeLessThan(SPEED_DOWNLOAD_BYTES);
    // 64 KB per 100 ms is 5.2 Mbps; the 2 s before the first byte left out.
    expect(r.downloadMbps!).toBeCloseTo(5.2, 0);
    expect(r).toMatchObject({ source: 'probe', uploadSupported: false, uploadMbps: null });
  });

  it('on a server without a test download: its static file again and again, said so — and no upload without the sink', async () => {
    let t = 0;
    let posts = 0;
    const bulk: Raw = async (method, u) => {
      if (method === 'POST') {
        posts++;
        return json({ status: 'error', message: 'Not found' }, 404);
      }
      // A server that routes the path to its health answer is not a test download either.
      if (u.includes('/api/health/probe')) return json({ status: 'success', data: { time: '2026-10-05T17:36:00Z' } });
      t += 250;
      return new Response(new Uint8Array(167 * 1024), { headers: { 'content-type': 'application/javascript' } });
    };
    const { m, bulkRaw } = monitor({ bulk, clock: () => t });
    const r = await m.speedTest();
    expect(r).toMatchObject({ source: 'static', uploadSupported: false, uploadMbps: null, uploadBytes: 0, error: null });
    expect(r.downloadMbps).toBeGreaterThan(0);
    expect(bulkRaw!.mock.calls.filter(([, u]) => String(u).includes('/widget.js')).length).toBeGreaterThan(SPEED_STREAMS);
    expect(bulkRaw!.mock.calls.find(([, u]) => String(u).includes('/widget.js'))![2]).toMatchObject({ auth: false });
    // Only the small check went: nothing more to a server that cannot take it.
    expect(posts).toBe(1);
  });

  it('stops the upload after 8 seconds and times what went by then', async () => {
    let t = 0;
    const bulk: Raw = async (method, _u, init) => {
      if (method === 'GET') return new Response(new Uint8Array(1024));
      if (!init?.onUploadProgress) return json({ data: { bytes: sizeOf(init) } });
      // A slow line: 64 KB every 100 ms of the clock, and the server never answers in time.
      await send(init, () => (t += 100));
      return json({ data: { bytes: sizeOf(init) } });
    };
    const { m } = monitor({ bulk, clock: () => (t += 1) });
    const r = await m.speedTest();
    expect(r.uploadBytes).toBeGreaterThan(0);
    expect(r.uploadBytes).toBeLessThan(SPEED_UPLOAD_BYTES);
    expect(r.uploadMbps!).toBeCloseTo(5.2, 0);
  });

  it('gives no upload figure when the server miscounts an upload', async () => {
    let t = 0;
    const bulk: Raw = async (method, _u, init) => {
      if (method === 'GET') return new Response(new Uint8Array(1024));
      if (!init?.onUploadProgress) return json({ data: { bytes: sizeOf(init) } });
      const got = await send(init, () => (t += 10));
      return json({ data: { bytes: got - 1 } });
    };
    const { m } = monitor({ bulk, clock: () => (t += 1) });
    const r = await m.speedTest();
    expect(r).toMatchObject({ uploadSupported: true, uploadMbps: null, uploadBytes: 0 });
  });

  it('says when the server could not be reached, and gives the delay and its variation beside the figures', async () => {
    let now = Date.parse('2026-10-05T17:36:00Z');
    const rt = new FakeRealtime();
    const { m } = monitor({
      rt,
      now: () => now,
      bulk: async () => {
        throw new Error('unreachable');
      },
    });
    for (const ms of [30, 50]) {
      m.tick();
      now += ms;
      rt.onPong(rt.sent.at(-1)!);
      now += PING_INTERVAL_MS;
    }
    const r = await m.speedTest();
    expect(r).toMatchObject({ downloadMbps: null, uploadMbps: null, uploadSupported: null, error: "Couldn't reach the server for a speed test.", delayMs: 40, jitterMs: 10, delayUpperBound: false });
  });
});
