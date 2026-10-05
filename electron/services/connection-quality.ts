import { randomBytes } from 'node:crypto';
import { ConnectionLedger, PING_INTERVAL_MS, PING_TIMEOUT_MS, type ApiTimings, type ConnectionDetails, type ConnectionStats, type SpeedTestResult } from '@shared/connection';
import type { RealtimeState, RealtimeTransport } from '@shared/types';
import { logger } from '../main/log';
import type { FetchLike, HttpClient } from './http';

const log = logger('connection');

/**
 * Connection strength (worksuite-desktop#254), measured here and shown by the status bar.
 *
 * HOW IT IS MEASURED. Every PING_INTERVAL_MS, while signed in:
 *  - realtime connected: `ping:<id>` over the realtime socket (`{"type":"ping","id"}` on protocol v2), which the
 *    gateway answers with `{"type":"pong"}`
 *    (worksuite realtime/server.js). The browser-style WebSocket the main process has cannot send a protocol ping
 *    frame, so this is an application-level echo. A gateway from before the echo never answers: after two
 *    unanswered pings on a socket that is otherwise alive, this falls back to HTTP for good (until sign-out);
 *  - otherwise (no gateway, realtime turned off, or an older gateway): a GET of `/api/health`, which is public,
 *    tiny and touches no database. Its round trip is the sample.
 * A reply not back in PING_TIMEOUT_MS is a missed reply. While realtime is reconnecting nothing is sent: the status
 * bar says Reconnecting instead. Reconnects (the socket back after a drop) are counted as they happen.
 *
 * The API's median comes from the HTTP client's own requests (`timeFetch`), timed to their response headers.
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

export interface ConnectionMonitorDeps {
  realtime: RealtimeLike;
  http: Pick<HttpClient, 'raw' | 'url'>;
  origin: () => string | null;
  /** Signed in to a server: something to measure. */
  active: () => boolean;
  onChange: () => void;
  api: ApiTimings;
  now?: () => number;
}

/** The download the speed test asks the probe endpoint for, and the upload it sends: small on purpose. */
export const SPEED_DOWNLOAD_KB = 512;
export const SPEED_UPLOAD_KB = 192;

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

export class ConnectionMonitor {
  private readonly ledger = new ConnectionLedger();
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  private pending = new Map<string, { at: number; timer: NodeJS.Timeout }>();
  /** Whether the gateway answers the echo: unknown until it does or twice does not. */
  private echo: boolean | null = null;
  private unanswered = 0;
  private origin: string | null | undefined = undefined;
  private httpInFlight = false;
  private serverTime: { iso: string; at: number } | null = null;
  private speedBusy: Promise<SpeedTestResult> | null = null;

  constructor(private readonly deps: ConnectionMonitorDeps) {
    this.now = deps.now ?? Date.now;
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

  /** Signed out or another server: start over, the echo included. */
  reset(): void {
    this.clearPending();
    this.ledger.reset();
    this.echo = null;
    this.unanswered = 0;
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
    void this.httpPing();
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
    // Never answered on this server: an older gateway. Measure over HTTP now, and from now on after a second time.
    if (++this.unanswered >= 2) {
      this.echo = false;
      log.info('realtime gateway does not echo pings; measuring with /api/health');
    }
    void this.httpPing();
  }

  private async httpPing(): Promise<void> {
    if (this.httpInFlight) return;
    this.httpInFlight = true;
    const at = this.now();
    let ms: number | null = null;
    try {
      const res = await this.deps.http.raw('GET', this.deps.http.url('/api/health'), { auth: false, timeoutMs: PING_TIMEOUT_MS, cache: 'no-store' });
      ms = Math.max(0, this.now() - at);
      if (res.ok) this.readServerTime(res);
    } catch {
      ms = null;
    } finally {
      this.httpInFlight = false;
    }
    if (!this.deps.active()) return;
    this.ledger.record({ at, ms, via: 'http-health' });
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
    void this.httpPing();
  }

  /**
   * Run speed test: one small download and one small upload to the WorkSuite server — SPEED_DOWNLOAD_KB from
   * `GET /api/health/probe` (or, on a server without it, the website widget script it serves anyway) and
   * SPEED_UPLOAD_KB to `POST /api/health/probe`. A rough figure, never a saturating test.
   */
  speedTest(): Promise<SpeedTestResult> {
    this.speedBusy ??= this.runSpeedTest().finally(() => {
      this.speedBusy = null;
    });
    return this.speedBusy;
  }

  private async runSpeedTest(): Promise<SpeedTestResult> {
    const { http } = this.deps;
    const result: SpeedTestResult = { downloadMbps: null, uploadMbps: null, downloadBytes: 0, uploadBytes: 0, source: null, error: null };
    const clock = () => performance.now();
    const mbps = (bytes: number, ms: number) => Math.round(((bytes * 8) / Math.max(ms, 1) / 1000) * 10) / 10;
    try {
      let t0 = clock();
      let res = await http.raw('GET', http.url('/api/health/probe', { kb: SPEED_DOWNLOAD_KB, t: Date.now() }), { timeoutMs: 20_000, cache: 'no-store', headers: { Accept: 'application/octet-stream' } });
      result.source = 'probe';
      if (!res.ok) {
        t0 = clock();
        res = await http.raw('GET', http.url('/widget.js', { speedtest: Date.now() }), { auth: false, timeoutMs: 20_000, cache: 'no-store', headers: { Accept: '*/*' } });
        result.source = 'static';
      }
      if (res.ok) {
        const bytes = (await res.arrayBuffer()).byteLength;
        result.downloadBytes = bytes;
        if (bytes > 0) result.downloadMbps = mbps(bytes, clock() - t0);
      } else result.source = null;
    } catch (e) {
      log.debug('speed test download failed', { error: String(e) });
    }
    try {
      const pad = randomBytes(Math.floor((SPEED_UPLOAD_KB * 1024 * 3) / 4)).toString('base64');
      const body = JSON.stringify({ pad });
      const t0 = clock();
      const res = await http.raw('POST', http.url('/api/health/probe'), { body, headers: { 'Content-Type': 'application/json' }, timeoutMs: 20_000 });
      if (res.ok) {
        await res.arrayBuffer();
        result.uploadBytes = body.length;
        result.uploadMbps = mbps(body.length, clock() - t0);
      }
    } catch (e) {
      log.debug('speed test upload failed', { error: String(e) });
    }
    if (result.downloadMbps === null && result.uploadMbps === null) result.error = "Couldn't reach the server for a speed test.";
    else if (result.uploadMbps === null) result.error = "This server doesn't take test uploads yet, so only the download was measured.";
    return result;
  }

  private clearPending(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }
}
