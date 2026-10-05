import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiTimings, ConnectionLedger, PING_INTERVAL_MS, PING_TIMEOUT_MS, summarizeConnection } from '@shared/connection';
import type { RealtimeState } from '@shared/types';
import { ConnectionMonitor, timeFetch, type RealtimeLike } from '../../../electron/services/connection-quality';
import { RealtimeService } from '../../../electron/services/realtime';
import type { HttpClient } from '../../../electron/services/http';

/**
 * Connection strength's measuring (worksuite-desktop#254): the realtime echo ping and its round trip, the jitter,
 * missed replies, reconnects, the fallback to /api/health on a gateway that does not echo, and the API's median.
 */

class FakeRealtime implements RealtimeLike {
  state: RealtimeState = 'connected';
  sent: string[] = [];
  echoes = true;
  reconnects = 0;
  onPong: (id: string) => void = () => undefined;
  onReconnect: () => void = () => undefined;
  getState() {
    return this.state;
  }
  sendPing(id: string) {
    if (this.state !== 'connected') return false;
    this.sent.push(id);
    return true;
  }
  gatewayHost() {
    return 'rt.example.com';
  }
  reconnectNow() {
    this.reconnects++;
  }
  /** The gateway answers the last ping after `ms`. */
  answer(ms: number) {
    const id = this.sent.at(-1)!;
    vi.advanceTimersByTime(ms);
    if (this.echoes) this.onPong(id);
  }
}

function monitor(opts: { rt?: FakeRealtime; raw?: ReturnType<typeof vi.fn> } = {}) {
  const rt = opts.rt ?? new FakeRealtime();
  const raw = opts.raw ?? vi.fn(async () => new Response(JSON.stringify({ status: 'success', data: { time: '2026-10-05T14:02:11+05:30' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const http = { raw, url: (p: string, q?: Record<string, unknown>) => `https://ws.example.com${p}${q ? `?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString()}` : ''}` } as unknown as Pick<HttpClient, 'raw' | 'url'>;
  const changed = vi.fn();
  const api = new ApiTimings();
  const m = new ConnectionMonitor({ realtime: rt, http, origin: () => 'https://ws.example.com', active: () => true, onChange: changed, api, now: () => Date.now() });
  return { m, rt, raw, changed, api };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('the realtime echo ping', () => {
  it('sends ping:<id> over the socket and takes the pong’s round trip', () => {
    const { m, rt, raw } = monitor();
    m.tick();
    expect(rt.sent).toHaveLength(1);
    rt.answer(42);
    const s = m.stats();
    expect(s.probe).toBe('realtime-echo');
    expect(s.samples).toEqual([expect.objectContaining({ ms: 42, via: 'realtime-echo' })]);
    expect(raw).not.toHaveBeenCalled();
  });

  it('works out the average and jitter over the window', () => {
    const { m, rt } = monitor();
    for (const ms of [100, 140, 180]) {
      m.tick();
      rt.answer(ms);
      vi.advanceTimersByTime(PING_INTERVAL_MS - ms);
    }
    const sum = summarizeConnection({ stats: m.stats(), realtime: 'connected', network: 'ONLINE', attempt: 0, now: Date.now() });
    expect(sum.avgMs).toBe(140);
    expect(sum.jitterMs).toBe(33); // the standard deviation of 100, 140, 180
    expect(sum.level).toBe('good');
  });

  it('counts a reply not back in time as missed, once the gateway is known to echo', () => {
    const { m, rt } = monitor();
    m.tick();
    rt.answer(30);
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    m.tick();
    vi.advanceTimersByTime(PING_TIMEOUT_MS + 1);
    const s = m.stats();
    expect(s.sent).toBe(2);
    expect(s.missed).toBe(1);
    expect(s.samples.at(-1)!.ms).toBeNull();
    // A late pong for a ping already counted lost changes nothing.
    rt.onPong(rt.sent.at(-1)!);
    expect(m.stats().samples).toHaveLength(2);
  });

  it('falls back to GET /api/health when the gateway never answers the echo (an older gateway)', async () => {
    const rt = new FakeRealtime();
    rt.echoes = false;
    const { m, raw } = monitor({ rt });
    m.tick();
    rt.answer(10);
    await vi.advanceTimersByTimeAsync(PING_TIMEOUT_MS);
    // The first unanswered echo is not a "missed reply": it is measured over HTTP instead.
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls[0]![1]).toBe('https://ws.example.com/api/health');
    expect(raw.mock.calls[0]![2]).toMatchObject({ auth: false });
    m.tick();
    await vi.advanceTimersByTimeAsync(PING_TIMEOUT_MS);
    expect(raw).toHaveBeenCalledTimes(2);
    // From now on: straight to HTTP, no more echoes sent.
    const before = rt.sent.length;
    m.tick();
    await vi.advanceTimersByTimeAsync(10);
    expect(rt.sent.length).toBe(before);
    expect(raw).toHaveBeenCalledTimes(3);
    const s = m.stats();
    expect(s.probe).toBe('http-health');
    expect(s.missed).toBe(0);
  });

  it('measures over HTTP when realtime is off on the server, and counts a failed check as missed', async () => {
    const rt = new FakeRealtime();
    rt.state = 'disabled';
    const raw = vi.fn(async () => {
      throw new Error('unreachable');
    });
    const { m } = monitor({ rt, raw });
    m.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(rt.sent).toHaveLength(0);
    expect(m.stats()).toMatchObject({ probe: 'http-health', sent: 1, missed: 1 });
  });

  it('sends nothing while realtime is reconnecting, and forgets pings in flight when the socket goes', () => {
    const { m, rt } = monitor();
    m.tick();
    rt.state = 'down';
    m.realtimeState('down');
    vi.advanceTimersByTime(PING_TIMEOUT_MS + 1);
    expect(m.stats().missed).toBe(0);
    m.tick();
    expect(rt.sent).toHaveLength(1);
  });

  it('counts reconnects and when the last one was, for five minutes', () => {
    const { m, rt, changed } = monitor();
    rt.onReconnect();
    vi.advanceTimersByTime(60_000);
    rt.onReconnect();
    expect(changed).toHaveBeenCalled();
    let s = m.stats();
    expect(s.reconnects).toHaveLength(2);
    expect(s.lastReconnectAt).toBe(Date.now());
    vi.advanceTimersByTime(4 * 60_000 + 1);
    s = m.stats();
    expect(s.reconnects).toHaveLength(1);
  });

  it('Reconnect now replaces the socket and measures at once', async () => {
    const { m, rt, raw } = monitor();
    m.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(rt.reconnects).toBe(1);
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('reads the server’s clock from /api/health for the popover', async () => {
    const { m } = monitor();
    const d = await m.details();
    expect(d).toMatchObject({ host: 'ws.example.com', realtimeHost: 'rt.example.com' });
    expect(d.serverTime).toBe('2026-10-05T14:02:11+05:30');
  });
});

describe('the speed test', () => {
  it('downloads from the probe, uploads to it, and says the figures in Mbps', async () => {
    vi.useRealTimers();
    const raw = vi.fn(async (method: string, _url?: string) => (method === 'GET' ? new Response(new Uint8Array(512 * 1024), { status: 200 }) : new Response('{"status":"success","data":{"bytes":1}}', { status: 200 })));
    const { m } = monitor({ raw });
    const r = await m.speedTest();
    expect(r.source).toBe('probe');
    expect(r.downloadBytes).toBe(512 * 1024);
    expect(r.downloadMbps).toBeGreaterThan(0);
    expect(r.uploadMbps).toBeGreaterThan(0);
    expect(r.error).toBeNull();
    expect(raw.mock.calls[0]![1]).toContain('/api/health/probe?kb=512');
    expect(raw.mock.calls[1]![0]).toBe('POST');
  });

  it('falls back to a static file the server already serves, and says when the upload could not be measured', async () => {
    vi.useRealTimers();
    const raw = vi.fn(async (method: string, url: string) => (url.includes('/widget.js') ? new Response(new Uint8Array(1000), { status: 200 }) : new Response('{}', { status: 404 })));
    const { m } = monitor({ raw });
    const r = await m.speedTest();
    expect(r.source).toBe('static');
    expect(r.uploadMbps).toBeNull();
    expect(r.error).toMatch(/only the download/);
  });
});

describe('RealtimeService: the echo and reconnects', () => {
  class Socket {
    static sockets: Socket[] = [];
    onmessage?: (m: { data: string }) => void;
    onclose?: (e: { code: number }) => void;
    onerror?: () => void;
    close = vi.fn();
    send = vi.fn();
    constructor() {
      Socket.sockets.push(this);
    }
    frame(o: object) {
      this.onmessage?.({ data: JSON.stringify(o) });
    }
  }
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('sends ping:<id>, hands the pong’s id over, and tells a reconnect apart from the first connect', async () => {
    Socket.sockets = [];
    const get = vi.fn(async () => ({ ticket: 't', enabled: true, url: 'wss://rt.example.com/realtime' }));
    const rt = new RealtimeService({ get } as unknown as HttpClient, () => 'https://ws.example.com', false, Socket as unknown as new (url: string) => WebSocket);
    const pong = vi.fn();
    const reconnect = vi.fn();
    rt.onPong = pong;
    rt.onReconnect = reconnect;
    expect(rt.sendPing('a1')).toBe(false); // not connected
    rt.start();
    await flush();
    Socket.sockets[0]!.frame({ type: 'ready' });
    expect(rt.gatewayHost()).toBe('rt.example.com');
    expect(rt.sendPing('a1')).toBe(true);
    expect(Socket.sockets[0]!.send).toHaveBeenCalledWith('ping:a1');
    expect(rt.sendPing('NOT valid')).toBe(false);
    Socket.sockets[0]!.frame({ type: 'pong', id: 'a1' });
    expect(pong).toHaveBeenCalledWith('a1');
    expect(reconnect).not.toHaveBeenCalled();
    Socket.sockets[0]!.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(2_000);
    Socket.sockets[1]!.frame({ type: 'ready' });
    expect(reconnect).toHaveBeenCalledTimes(1);
    // Reconnect now replaces even a healthy socket.
    rt.reconnectNow();
    await flush();
    expect(Socket.sockets[1]!.close).toHaveBeenCalled();
    expect(Socket.sockets).toHaveLength(3);
    rt.stop();
  });
});

describe('the API’s median', () => {
  it('is the median of the last 20 requests, failures counted but not timed, the pings left out', async () => {
    const api = new ApiTimings();
    let t = 0;
    const clock = () => t;
    const fetch = vi.fn(async (url: string) => {
      t += url.includes('slow') ? 900 : 100;
      if (url.includes('fail')) throw new Error('down');
      return new Response('{}', { status: url.includes('500') ? 500 : 200 });
    });
    const timed = timeFetch(fetch, api, clock);
    for (let i = 0; i < 25; i++) await timed('https://ws.example.com/api/x', {});
    await timed('https://ws.example.com/api/slow', {});
    await timed('https://ws.example.com/api/500', {});
    await expect(timed('https://ws.example.com/api/fail', {})).rejects.toThrow();
    await timed('https://ws.example.com/api/health', {});
    const s = api.summary();
    expect(s.count).toBe(20);
    expect(s.failed).toBe(2);
    expect(s.medianMs).toBe(100);
  });

  it('keeps the ledger to the last minute of pings', () => {
    const l = new ConnectionLedger();
    l.record({ at: 0, ms: 10, via: 'realtime-echo' });
    l.record({ at: 70_000, ms: 20, via: 'realtime-echo' });
    expect(l.stats({ medianMs: null, count: 0, failed: 0 }, 70_000).samples).toHaveLength(1);
  });
});
