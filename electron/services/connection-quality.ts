import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Socket } from 'node:net';
import {
  ConnectionLedger,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  SPEED_DOWNLOAD_BYTES,
  SPEED_MAX_MS,
  SPEED_STREAMS,
  SPEED_UPLOAD_BYTES,
  summarizeConnection,
  type ApiTimings,
  type ConnectionDetails,
  type ConnectionSample,
  type ConnectionStats,
  type SpeedTestResult,
} from '@shared/connection';
import type { RealtimeState, RealtimeTransport } from '@shared/types';
import { logger } from '../main/log';
import type { FetchLike, HttpClient } from './http';

const log = logger('connection');

/**
 * Connection strength (worksuite-desktop#254, #265), measured here and shown by the status bar. It measures YOUR
 * CONNECTION — the network delay — and never the server's own time: a server that takes 2 s per request is the
 * server's problem, shown apart as "Server slow" (#265).
 *
 * HOW THE DELAY IS MEASURED. Every PING_INTERVAL_MS, while signed in, with the lightest round trip there is:
 *  1. Realtime connected over a socket: `ping:<id>` (`{"type":"ping","id"}` on protocol v2), which the gateway
 *     answers with `{"type":"pong"}` at once (worksuite realtime/server.js). The browser-style WebSocket the main
 *     process has cannot send a protocol ping frame, so this is an application-level echo. A gateway from before the
 *     echo never answers: after two unanswered pings on a socket that is otherwise alive, this stops asking (until the
 *     transport changes or sign-out).
 *  2. Otherwise (SSE, which is one-way; the built-in service, which polls; realtime off; an older gateway): the time
 *     to open a TCP connection to the server (`tcpHandshake`), which the server's operating system answers before any
 *     app work. Through a proxy that would measure the proxy, so it is not used there; where it does not work twice
 *     it rests for TCP_RETRY_MS.
 *  3. Only then: a GET of `/api/health`, which is public, tiny and touches no database — but still runs the server's
 *     app, so its round trip includes the server's own time. Less what the server says it spent (`Server-Timing`)
 *     where it says so; otherwise the sample is an upper bound (`upper`), and the status bar never calls the
 *     connection Poor on an upper bound.
 * A reply not back in PING_TIMEOUT_MS is a missed reply. While realtime is reconnecting nothing is sent: the status
 * bar says Reconnecting instead. Reconnects (the socket back after a drop) are counted as they happen.
 *
 * THE SERVER. The API's median and slowest 5% come from the HTTP client's own requests (`timeFetch`), timed to their
 * response headers — the server's time and the network's together, which is what a person waits for. Whether the
 * server is slow is judged with one measured network round trip taken off (`summarizeServer`).
 */

export interface RealtimeLike {
  getState(): RealtimeState;
  sendPing(id: string): boolean;
  gatewayHost(): string | null;
  reconnectNow(): void;
  onPong: (id: string) => void;
  onReconnect: () => void;
  /** How realtime reaches this computer (plan 2.7): WebSocket v2, SSE, the v1 socket, or polling. */
  getTransport?(): RealtimeTransport | null;
  onTransport?: (t: RealtimeTransport | null) => void;
}

/** The time to open a TCP connection to an origin, in ms; null when no answer came in time. Throws where it cannot be measured so. */
export type TcpPing = (origin: string) => Promise<number | null>;

export interface ConnectionMonitorDeps {
  realtime: RealtimeLike;
  http: Pick<HttpClient, 'raw' | 'url'>;
  /** The speed test's connection pool (#252: the bulk one, so a test never holds up chats); `http` when absent. */
  bulk?: Pick<HttpClient, 'raw' | 'url'>;
  /** The delay where the realtime echo cannot be sent (#265); absent: straight to the server check. */
  tcpPing?: TcpPing;
  origin: () => string | null;
  /** Signed in to a server: something to measure. */
  active: () => boolean;
  onChange: () => void;
  api: ApiTimings;
  now?: () => number;
  /** A steady clock in ms for timing the speed test (`performance.now` by default; tests drive their own). */
  clock?: () => number;
}

/** A TCP measurement that did not work twice (a proxy, a firewall) is tried again after this long. */
export const TCP_RETRY_MS = 5 * 60_000;

/** The small upload that asks whether the server takes test uploads at all, before any megabytes go to one that does not. */
export const SPEED_UPLOAD_CHECK_BYTES = 16 * 1024;
/** How long the server may take to answer an upload once the body is in: its own time, not the network's. */
const SPEED_ANSWER_MS = 20_000;
/** A test shorter than this cannot be timed by its pace; the whole time is used instead. */
const SPEED_MIN_SPAN_MS = 50;

/** The API's requests, timed to their response headers for the status bar's median (the pings themselves left out). */
export function timeFetch(fetch: FetchLike, timings: ApiTimings, now: () => number = () => performance.now()): FetchLike {
  return async (url, init) => {
    if (/\/api\/health(\/|\?|$)|\/realtime-ticket/.test(url)) return fetch(url, init);
    const t0 = now();
    try {
      const res = await fetch(url, init);
      timings.add(now() - t0, res.status < 500);
      return res;
    } catch (e) {
      timings.add(now() - t0, false);
      throw e;
    }
  };
}

/**
 * How long the server says it spent on a request: the largest `dur` of a `Server-Timing` header
 * (`app;dur=182.4, db;dur=40`), taken as its whole time. Parts that add up to more would be under-counted, which only
 * makes the network look slower, never faster. Null when it does not say.
 */
export function serverTimingMs(header: string | null | undefined): number | null {
  if (!header) return null;
  let best: number | null = null;
  for (const m of header.matchAll(/(?:^|[;,])\s*dur\s*=\s*"?(\d+(?:\.\d+)?)"?/gi)) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v >= 0 && v < 600_000) best = Math.max(best ?? 0, v);
  }
  return best;
}

/**
 * The time to open a TCP connection to the server (#265): one network round trip, answered by the server's operating
 * system (or the load balancer in front of it) before any app work — the delay where the realtime echo cannot be
 * sent. The name is looked up first, untimed, and the connection closed at once: no TLS, no request. Through a proxy
 * the server is not reached directly, so that throws and the caller measures another way; so does a refusal.
 */
export function tcpHandshake(opts: { resolveProxy?: (url: string) => Promise<string>; timeoutMs?: number } = {}): TcpPing {
  return async (origin) => {
    const u = new URL(origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('not a web origin');
    if (opts.resolveProxy && !/^\s*DIRECT\s*(;|$)/i.test(await opts.resolveProxy(u.origin))) throw new Error('reached through a proxy');
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    const { address, family } = await lookup(u.hostname.replace(/^\[(.*)\]$/, '$1'));
    return new Promise<number | null>((resolve, reject) => {
      const socket = new Socket();
      const t0 = performance.now();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(null);
      }, opts.timeoutMs ?? PING_TIMEOUT_MS);
      timer.unref?.();
      socket.once('connect', () => {
        const ms = performance.now() - t0;
        clearTimeout(timer);
        socket.destroy();
        resolve(ms);
      });
      socket.once('error', (e) => {
        clearTimeout(timer);
        socket.destroy();
        reject(e);
      });
      socket.connect({ host: address, port, family });
    });
  };
}

/** How many bytes the server says a test upload brought: `{"data":{"bytes":N}}` (or `{"bytes":N}`); null when it does not say. */
async function receivedBytes(res: Response): Promise<number | null> {
  if (!res.ok) {
    void res.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    const body = (await res.json()) as { bytes?: unknown; data?: { bytes?: unknown } } | null;
    const n = Number(body?.data?.bytes ?? body?.bytes);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

const mbps = (bytes: number, ms: number): number => Math.round(((bytes * 8) / Math.max(ms, 1) / 1000) * 10) / 10;

export class ConnectionMonitor {
  private readonly ledger = new ConnectionLedger();
  private readonly now: () => number;
  private readonly clock: () => number;
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  private pending = new Map<string, { at: number; timer: NodeJS.Timeout }>();
  /** Whether the gateway answers the echo: unknown until it does or twice does not. */
  private echo: boolean | null = null;
  private unanswered = 0;
  /** Whether a TCP connection to the server has been timed here; failures in a row; resting until. */
  private tcpWorks = false;
  private tcpFails = 0;
  private tcpOffUntil = 0;
  private tcpInFlight = false;
  private origin: string | null | undefined = undefined;
  private httpInFlight = false;
  private serverTime: { iso: string; at: number } | null = null;
  private speedBusy: Promise<SpeedTestResult> | null = null;

  constructor(private readonly deps: ConnectionMonitorDeps) {
    this.now = deps.now ?? Date.now;
    this.clock = deps.clock ?? (() => performance.now());
    deps.realtime.onPong = (id) => this.pong(id);
    deps.realtime.onReconnect = () => {
      this.ledger.reconnected(this.now());
      this.deps.onChange();
    };
    // Another transport answers the echo its own way (v2 `{"type":"ping"}`, none on SSE): learnt again.
    deps.realtime.onTransport = () => {
      this.clearPending();
      this.echo = null;
      this.unanswered = 0;
      this.deps.onChange();
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), PING_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearPending();
  }

  /** Signed out or another server: start over, the echo and TCP included. */
  reset(): void {
    this.clearPending();
    this.ledger.reset();
    this.echo = null;
    this.unanswered = 0;
    this.tcpWorks = false;
    this.tcpFails = 0;
    this.tcpOffUntil = 0;
    this.serverTime = null;
    this.deps.onChange();
  }

  /** The realtime state changed: pings in flight on a socket that went away are not "missed replies". */
  realtimeState(s: RealtimeState): void {
    if (s !== 'connected') this.clearPending();
    // Back (or newly) connected: measure now rather than up to ten seconds later.
    if (s === 'connected') setTimeout(() => this.tick(), 500).unref?.();
  }

  stats(): ConnectionStats {
    return { ...this.ledger.stats(this.deps.api.summary(), this.now()), transport: this.deps.realtime.getTransport?.() ?? null };
  }

  /** One round of measuring (on the timer; tests call it directly). */
  tick(): void {
    if (!this.deps.active()) return;
    const origin = this.deps.origin();
    if (origin !== this.origin) {
      if (this.origin !== undefined) this.reset();
      this.origin = origin;
    }
    const rt = this.deps.realtime.getState();
    if (rt === 'down' || rt === 'connecting') return;
    if (rt === 'connected' && this.echo !== false) {
      if (this.pending.size) return;
      const id = (++this.seq).toString(36);
      const at = this.now();
      if (this.deps.realtime.sendPing(id)) {
        const timer = setTimeout(() => this.timeout(id), PING_TIMEOUT_MS);
        timer.unref?.();
        this.pending.set(id, { at, timer });
        return;
      }
    }
    void this.fallbackPing();
  }

  private pong(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    this.echo = true;
    this.unanswered = 0;
    this.ledger.record({ at: p.at, ms: Math.max(0, this.now() - p.at), via: 'realtime-echo' });
    this.deps.onChange();
  }

  private timeout(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (this.echo === true) {
      this.ledger.record({ at: p.at, ms: null, via: 'realtime-echo' });
      this.deps.onChange();
      return;
    }
    // Never answered on this server: an older gateway. Measure another way now, and from now on after a second time.
    if (++this.unanswered >= 2) {
      this.echo = false;
      log.info('realtime gateway does not echo pings; measuring the delay another way');
    }
    void this.fallbackPing();
  }

  /** The delay without the realtime echo: a TCP connection where it can be timed, else the server check. */
  private async fallbackPing(): Promise<void> {
    const origin = this.deps.origin();
    if (this.deps.tcpPing && origin && this.now() >= this.tcpOffUntil && (await this.tcpPing(origin))) return;
    await this.httpPing();
  }

  /** @returns false when TCP could not measure (the server check goes instead) */
  private async tcpPing(origin: string): Promise<boolean> {
    if (this.tcpInFlight) return true;
    this.tcpInFlight = true;
    const at = this.now();
    let ms: number | null | undefined;
    try {
      ms = await this.deps.tcpPing!(origin);
    } catch (e) {
      ms = undefined;
      log.debug('tcp delay not measured', { error: String(e).slice(0, 120) });
    } finally {
      this.tcpInFlight = false;
    }
    if (!this.deps.active() || this.deps.origin() !== origin) return true;
    // Not measurable so here (a proxy, a refusal, never an answer): the server check now, and for a while after a second time.
    if (ms === undefined || (ms === null && !this.tcpWorks)) {
      if (++this.tcpFails >= 2) {
        this.tcpFails = 0;
        this.tcpWorks = false;
        this.tcpOffUntil = this.now() + TCP_RETRY_MS;
        log.info('tcp delay unavailable; measuring with /api/health for now');
      }
      return false;
    }
    this.tcpWorks = true;
    this.tcpFails = 0;
    this.ledger.record({ at, ms: ms === null ? null : Math.max(0, Math.round(ms)), via: 'tcp-connect' });
    this.deps.onChange();
    return true;
  }

  private async httpPing(): Promise<void> {
    if (this.httpInFlight) return;
    this.httpInFlight = true;
    const at = this.now();
    let ms: number | null = null;
    let serverMs: number | null = null;
    try {
      const res = await this.deps.http.raw('GET', this.deps.http.url('/api/health'), { auth: false, timeoutMs: PING_TIMEOUT_MS, cache: 'no-store' });
      ms = Math.max(0, this.now() - at);
      serverMs = serverTimingMs(res.headers.get('server-timing'));
      if (res.ok) this.readServerTime(res);
      else void res.body?.cancel().catch(() => undefined);
    } catch {
      ms = null;
    } finally {
      this.httpInFlight = false;
    }
    if (!this.deps.active()) return;
    // The round trip less the server's own time where it says so; else all of it, as an upper bound on the delay.
    // One that failed may be the server's fault too (a timeout on a slow one): never a lost reply of the network's.
    const sample: ConnectionSample =
      ms !== null && serverMs !== null ? { at, ms: Math.max(0, Math.round(ms - serverMs)), via: 'http-health' } : { at, ms: ms === null ? null : Math.round(ms), via: 'http-health', upper: true };
    this.ledger.record(sample);
    this.deps.onChange();
  }

  private readServerTime(res: Response): void {
    void res
      .json()
      .then((body: { data?: { time?: unknown } }) => {
        const iso = body?.data?.time;
        if (typeof iso === 'string' && iso.length <= 40 && !Number.isNaN(Date.parse(iso))) this.serverTime = { iso, at: this.now() };
      })
      .catch(() => undefined);
  }

  /** The popover's facts: the hosts, and the server's own clock (read now when not known in the last minute). */
  async details(): Promise<ConnectionDetails> {
    const origin = this.deps.origin();
    let host: string | null = null;
    try {
      host = origin ? new URL(origin).host : null;
    } catch {
      host = null;
    }
    if (origin && (!this.serverTime || this.now() - this.serverTime.at > 60_000)) {
      try {
        const res = await this.deps.http.raw('GET', this.deps.http.url('/api/health'), { auth: false, timeoutMs: PING_TIMEOUT_MS, cache: 'no-store' });
        if (res.ok) {
          const body = (await res.json()) as { data?: { time?: unknown } };
          const iso = body?.data?.time;
          if (typeof iso === 'string' && iso.length <= 40 && !Number.isNaN(Date.parse(iso))) this.serverTime = { iso, at: this.now() };
        }
      } catch {
        /* the clock is optional */
      }
    }
    return { host, serverTime: this.serverTimeNow(), realtimeHost: this.deps.realtime.gatewayHost() };
  }

  /** The server's clock as of now: what it said, moved on by the time since, in its own offset. */
  private serverTimeNow(): string | null {
    if (!this.serverTime) return null;
    const m = /([+-]\d{2}:?\d{2}|Z)$/.exec(this.serverTime.iso);
    const offset = m ? m[1]! : 'Z';
    const sign = offset === 'Z' ? 0 : offset.startsWith('-') ? -1 : 1;
    const digits = offset.replace(/[^\d]/g, '');
    const offMin = offset === 'Z' ? 0 : sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    const utc = Date.parse(this.serverTime.iso) + (this.now() - this.serverTime.at);
    const local = new Date(utc + offMin * 60_000).toISOString().slice(0, 19);
    return `${local}${offset === 'Z' ? 'Z' : `${sign < 0 ? '-' : '+'}${digits.slice(0, 2)}:${digits.slice(2, 4)}`}`;
  }

  /** "Reconnect now". */
  reconnect(): void {
    this.clearPending();
    this.deps.realtime.reconnectNow();
    void this.fallbackPing();
  }

  /**
   * Run speed test (#265): download, then upload, each over SPEED_STREAMS connections at once on the bulk pool, for at
   * most SPEED_MAX_MS — with the network delay and its variation from the last 30 s of pings beside them.
   *
   * DOWNLOAD. `GET /api/health/probe?kb=N` (the server's sized test download: N KB of incompressible bytes) until
   * SPEED_DOWNLOAD_BYTES have come or the time is up, timed from the first byte (the wait for the server to start
   * answering is its own time). A server without it serves its website widget script anyway: that is fetched again
   * and again instead, and the result says so — a small file reads low on a fast connection.
   *
   * UPLOAD. Only where the server takes test uploads: a SPEED_UPLOAD_CHECK_BYTES `POST /api/health/probe` first, which
   * must answer how many bytes it received. A server without that is sent nothing more, and the result says the upload
   * test needs a newer server — never a made-up figure. Then SPEED_UPLOAD_BYTES over the connections, timed by
   * Chromium's own count of the bytes gone out (the body is buffered at once, and the answer after it waits on the
   * server's own work), stopped at SPEED_MAX_MS. No figure where an upload fails or the server miscounts one.
   */
  speedTest(): Promise<SpeedTestResult> {
    this.speedBusy ??= this.runSpeedTest().finally(() => {
      this.speedBusy = null;
    });
    return this.speedBusy;
  }

  private async runSpeedTest(): Promise<SpeedTestResult> {
    const http = this.deps.bulk ?? this.deps.http;
    const result: SpeedTestResult = { downloadMbps: null, uploadMbps: null, downloadBytes: 0, uploadBytes: 0, streams: SPEED_STREAMS, source: null, uploadSupported: null, delayMs: null, jitterMs: null, delayUpperBound: false, error: null };
    // Whether the server takes test uploads, asked while the download runs (one small request beside four big ones).
    const takesUploads = this.uploadCheck(http);
    try {
      Object.assign(result, await this.download(http));
    } catch (e) {
      log.debug('speed test download failed', { error: String(e) });
    }
    result.uploadSupported = await takesUploads;
    if (result.uploadSupported) {
      try {
        Object.assign(result, await this.upload(http));
      } catch (e) {
        log.debug('speed test upload failed', { error: String(e) });
      }
    }
    const s = summarizeConnection({ stats: this.stats(), realtime: this.deps.realtime.getState(), network: 'ONLINE', attempt: 0, now: this.now() });
    result.delayMs = s.delayMs;
    result.jitterMs = s.jitterMs;
    result.delayUpperBound = s.upperBound;
    if (result.downloadMbps === null && result.uploadMbps === null) result.error = "Couldn't reach the server for a speed test.";
    return result;
  }

  private async download(http: Pick<HttpClient, 'raw' | 'url'>): Promise<Pick<SpeedTestResult, 'downloadMbps' | 'downloadBytes' | 'source'>> {
    const clock = this.clock;
    const started = clock();
    const deadline = started + SPEED_MAX_MS;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), SPEED_MAX_MS);
    timer.unref?.();
    const kb = Math.ceil(SPEED_DOWNLOAD_BYTES / 1024 / SPEED_STREAMS);
    let source: 'probe' | 'static' | null = null;
    let n = 0;
    let total = 0;
    // Bytes after the very first, from the time it came: the network's pace, without the server's wait to start.
    let counted = 0;
    let firstAt: number | null = null;
    let lastAt = started;
    const init = { signal: stop.signal, timeoutMs: SPEED_MAX_MS + 5_000, cache: 'no-store' as const };
    // Each request asks for an uncompressed answer: a file sent zipped would read faster than the line is.
    const bust = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

    /** One response to read: the server's test download, or — decided by the first answer — the static file. */
    const get = async (): Promise<Response | null> => {
      if (source !== 'static') {
        const res = await http.raw('GET', http.url('/api/health/probe', { kb, t: bust() }), { ...init, headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' } });
        // A JSON or HTML answer is not the test download (a server that routes the path elsewhere).
        if (res.ok && res.body && !/json|html|text\//i.test(res.headers.get('content-type') ?? '')) {
          source = 'probe';
          return res;
        }
        void res.body?.cancel().catch(() => undefined);
        if (source === 'probe') return null;
        source = 'static';
      }
      const res = await http.raw('GET', http.url('/widget.js', { speedtest: bust() }), { ...init, auth: false, headers: { Accept: '*/*', 'Accept-Encoding': 'identity' } });
      if (res.ok && res.body) return res;
      void res.body?.cancel().catch(() => undefined);
      return null;
    };
    const read = async (res: Response): Promise<void> => {
      const reader = res.body!.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          // Stopped (by time, or another connection reached the total): what comes after is not measured.
          if (done || stop.signal.aborted) return;
          const t = clock();
          total += value.byteLength;
          if (firstAt === null) firstAt = t;
          else counted += value.byteLength;
          lastAt = t;
          if (t >= deadline || total >= SPEED_DOWNLOAD_BYTES) {
            stop.abort();
            return;
          }
        }
      } finally {
        void reader.cancel().catch(() => undefined);
      }
    };
    let decided: () => void = () => undefined;
    const sourceKnown = new Promise<void>((r) => (decided = r));
    const stream = async (i: number): Promise<void> => {
      // The others wait for the first answer: it says which download this server has.
      if (i > 0) await sourceKnown;
      try {
        while (!stop.signal.aborted && total < SPEED_DOWNLOAD_BYTES && clock() < deadline && (i === 0 || source !== null)) {
          const res = await get();
          if (i === 0) decided();
          if (!res) return;
          await read(res);
        }
      } catch {
        /* stopped at the deadline, or the server went away */
      } finally {
        if (i === 0) decided();
      }
    };
    try {
      await Promise.all(Array.from({ length: SPEED_STREAMS }, (_, i) => stream(i)));
    } finally {
      clearTimeout(timer);
      stop.abort();
    }
    if (!total) return { downloadMbps: null, downloadBytes: 0, source: null };
    const span = firstAt !== null ? lastAt - firstAt : 0;
    return { downloadMbps: span >= SPEED_MIN_SPAN_MS && counted ? mbps(counted, span) : mbps(total, lastAt - started), downloadBytes: total, source };
  }

  /** Whether the server takes test uploads: true when it confirms a small one byte for byte, false when it does not, null without an answer. */
  private async uploadCheck(http: Pick<HttpClient, 'raw' | 'url'>): Promise<boolean | null> {
    try {
      const body = randomBytes(SPEED_UPLOAD_CHECK_BYTES);
      const res = await http.raw('POST', http.url('/api/health/probe'), { body, headers: { 'Content-Type': 'application/octet-stream' }, timeoutMs: SPEED_ANSWER_MS });
      return (await receivedBytes(res)) === body.byteLength;
    } catch (e) {
      log.debug('speed test upload check failed', { error: String(e) });
      return null;
    }
  }

  private async upload(http: Pick<HttpClient, 'raw' | 'url'>): Promise<Pick<SpeedTestResult, 'uploadMbps' | 'uploadBytes'>> {
    const clock = this.clock;
    const started = clock();
    const deadline = started + SPEED_MAX_MS;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), SPEED_MAX_MS);
    timer.unref?.();
    const share = Math.ceil(SPEED_UPLOAD_BYTES / SPEED_STREAMS);
    const body = randomBytes(share);
    // Each upload's bytes gone so far, by the network's own count (`onUploadProgress`): what is handed to the request is
    // buffered at once, whatever the line's speed, and the answer waits on the server's own work — neither is the pace.
    const gone = new Array<number>(SPEED_STREAMS).fill(0);
    type Count = { at: number; bytes: number };
    const marks: { first: Count | null; last: Count | null } = { first: null, last: null };
    const moved = (i: number, bytes: number): void => {
      if (stop.signal.aborted) return;
      const at = clock();
      // Out of time: what went after is not measured, and the uploads stop.
      if (at >= deadline) return stop.abort();
      gone[i] = bytes;
      const now = { at, bytes: gone.reduce((a, b) => a + b, 0) };
      // Timed from when every connection is up and has had its first fill of the socket's buffer (taken at once, not
      // at the line's pace); from then on the count goes up at the line's pace.
      if (marks.first) marks.last = now;
      else if (gone.every((b) => b > 0)) marks.first = now;
      else marks.last = now;
    };
    const one = async (i: number): Promise<'ok' | 'wrong'> => {
      const res = await http.raw('POST', http.url('/api/health/probe'), {
        body,
        headers: { 'Content-Type': 'application/octet-stream' },
        signal: stop.signal,
        timeoutMs: SPEED_MAX_MS + SPEED_ANSWER_MS,
        onUploadProgress: (bytes: number) => moved(i, bytes),
      } as RequestInit & { timeoutMs: number });
      return (await receivedBytes(res)) === share ? 'ok' : 'wrong';
    };
    // Out of time is fine (the bytes gone so far are the figure); an error, or a server that miscounts, gives none.
    const outcomes = await Promise.all(Array.from({ length: SPEED_STREAMS }, (_, i) => one(i).catch(() => (stop.signal.aborted ? ('stopped' as const) : ('failed' as const)))));
    clearTimeout(timer);
    stop.abort();
    const { first, last } = marks;
    const end = last && (!first || last.at >= first.at) ? last : first;
    if (outcomes.some((o) => o === 'wrong' || o === 'failed') || !end) return { uploadMbps: null, uploadBytes: 0 };
    const span = first && last ? last.at - first.at : 0;
    const uploadMbps = first && span >= SPEED_MIN_SPAN_MS ? mbps(end.bytes - first.bytes, span) : mbps(end.bytes, end.at - started);
    return { uploadMbps, uploadBytes: end.bytes };
  }

  private clearPending(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }
}
