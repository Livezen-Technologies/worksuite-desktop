import type { NetworkStatus, RealtimeState, RealtimeTransport } from './types';

/**
 * Connection strength (worksuite-desktop#254, #265): how YOUR CONNECTION to the WorkSuite server is doing, measured in
 * the main process and shown in the status bar as four bars and a word — kept apart from how fast the SERVER answers.
 *
 * The main process measures the network delay every PING_INTERVAL_MS with the lightest round trip it has, in order:
 *  - the realtime connection's own echo (`ping:<id>` → `{"type":"pong","id"}`), which the gateway answers at once;
 *  - where that cannot be sent (SSE is one-way, the built-in service polls, an older gateway never answers): the
 *    time to open a TCP connection to the server — the network's round trip, answered before any app work;
 *  - and only where neither works (through a proxy, say): a GET of `/api/health`. That includes the server's own time,
 *    so it is an upper bound on the delay (`upper`) unless the server says how long it spent (`Server-Timing`).
 * The level is worked out from the last WINDOW_MS of them, so one slow answer does not make the bars jump.
 *
 * The API's own requests are timed apart (`ApiTimings`): the WorkSuite server's median and slowest 5%, shown as their
 * own "Server slow" marker. A slow server never makes the connection Poor (#265).
 */
export const PING_INTERVAL_MS = 10_000;
/** A ping not answered in this long is a missed reply. */
export const PING_TIMEOUT_MS = 5_000;
/** The level is the average of this window: smooth, never one sample. */
export const WINDOW_MS = 30_000;
/** Reconnects counted for "frequent drops". */
export const RECONNECT_WINDOW_MS = 5 * 60_000;
/** Poor this long before the toast says so (once per episode). */
export const POOR_TOAST_AFTER_MS = 30_000;

/**
 * The documented thresholds, on the network delay only (#254, #263, #265): under 100 ms Excellent, 100–250 Good,
 * 250–600 Fair, over 600 Poor. The bars, the word, the colour, the toast and the composer's warning all follow them.
 */
export const DELAY_EXCELLENT_BELOW_MS = 100;
export const DELAY_GOOD_UP_TO_MS = 250;
export const DELAY_FAIR_UP_TO_MS = 600;

/** The WorkSuite server's median response over this is "Server slow" (the target is under 300 ms). */
export const SERVER_SLOW_MS = 1_000;
/** Fewer timed requests than this say nothing about the server yet (the first after start-up are always slower). */
export const SERVER_MIN_REQUESTS = 3;

export type ConnectionLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'offline' | 'reconnecting' | 'checking';
export type ConnectionProbe = 'realtime-echo' | 'tcp-connect' | 'http-health';

export interface ConnectionSample {
  /** When the ping was sent (epoch ms). */
  at: number;
  /**
   * The network delay in ms; null when no reply came in time. For a server check, the round trip less the time the
   * server said it spent, or (with `upper`) the whole round trip.
   */
  ms: number | null;
  via: ConnectionProbe;
  /** The round trip includes the server's own time: the network delay is at most this (an HTTP check, #265). */
  upper?: boolean;
}

/** What the main process measured: on `StatusSnapshot.connection`. */
export interface ConnectionStats {
  /** How the latest ping was sent; null before the first. */
  probe: ConnectionProbe | null;
  /** The last minute of pings, oldest first. */
  samples: ConnectionSample[];
  /** When the realtime socket came back after a drop, within the last RECONNECT_WINDOW_MS. */
  reconnects: number[];
  lastReconnectAt: number | null;
  /** Since start: pings sent and not answered. */
  sent: number;
  missed: number;
  /** The WorkSuite server: the API's own requests, the last ApiTimings.KEEP of them. */
  api: ApiSummary;
  /** How realtime reaches this computer (plan 2.7); absent from a main process before it. */
  transport?: RealtimeTransport | null;
}

/** The API's requests, timed to their response headers: how fast the WorkSuite server answers. */
export interface ApiSummary {
  medianMs: number | null;
  /** The slowest 5% start here (the 95th percentile); absent from a main process before #265. */
  p95Ms?: number | null;
  count: number;
  failed: number;
}

/** The transport in words, for the status bar's popover. */
export const TRANSPORT_WORD: Record<RealtimeTransport, string> = {
  websocket: 'WebSocket',
  sse: 'SSE (WebSocket unavailable)',
  legacy: 'Built-in service · live events',
  polling: 'Built-in service · polling',
};

export interface ConnectionSummary {
  level: ConnectionLevel;
  bars: 0 | 1 | 2 | 3 | 4;
  /**
   * The network delay: the average round trip over the window, or — with `upperBound` — the fastest server check in
   * it, which the network delay is at most.
   */
  delayMs: number | null;
  /** Only server checks answered: `delayMs` includes the server's own time, and the level is never Poor on it. */
  upperBound: boolean;
  /** How much it varies (the standard deviation of the window's round trips); null on server checks alone. */
  jitterMs: number | null;
  samples: number;
  missed: number;
  reconnects: number;
  attempt: number;
  /** Poor because most replies were lost, not because of the delay: the label says so instead of a number. */
  lossy: boolean;
  /** Nothing lost, no reconnect, even replies. Stability is said in words; it does not move the level (#263, #265). */
  stable: boolean;
  /** What is unsteady, in words, for the popover. */
  reasons: string[];
}

export const LEVEL_BARS: Record<ConnectionLevel, ConnectionSummary['bars']> = { excellent: 4, good: 3, fair: 2, poor: 1, offline: 0, reconnecting: 0, checking: 4 };
export const LEVEL_WORD: Record<ConnectionLevel, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  offline: 'Offline',
  reconnecting: 'Reconnecting',
  checking: 'Connected',
};

/** The level a network delay has on the documented thresholds: 99 Excellent, 100 and 250 Good, 251 and 600 Fair, 601 Poor. */
export function levelForDelay(ms: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (ms > DELAY_FAIR_UP_TO_MS) return 'poor';
  if (ms > DELAY_GOOD_UP_TO_MS) return 'fair';
  if (ms >= DELAY_EXCELLENT_BELOW_MS) return 'good';
  return 'excellent';
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface SummaryInput {
  stats: ConnectionStats | null | undefined;
  realtime: RealtimeState;
  network: NetworkStatus;
  internetOnline?: boolean;
  /** The realtime client's reconnect attempt (0: none failed yet). */
  attempt: number;
  now: number;
}

/**
 * The level from what was measured. In order: no network → Offline; the realtime socket coming back → Reconnecting;
 * then the window's pings, on the documented thresholds of the network delay alone (`levelForDelay`), so the word
 * always matches the number beside it: "Fair · 312 ms", never "Poor · 312 ms" (#263, #265).
 *  - The delay is the window's average. Where only server checks answered it is the fastest of them, an upper bound:
 *    the server's own time may be all of it, so that is never Poor ("Fair · ≤ 700 ms" at worst).
 *  - Most replies lost (more lost than answered, on a ping the server answers at once) is Poor, said in words:
 *    "Poor · 2 of 3 replies lost". A server check that failed may be the server's fault, and does not count for it:
 *    with none answered the level stays "checking" (a network that is down shows as Offline instead).
 *  - Lost replies, reconnects in five minutes and uneven replies (varying by more than half the average and more
 *    than 50 ms) are stability, said in the popover; they do not move the level.
 */
export function summarizeConnection(input: SummaryInput): ConnectionSummary {
  const { stats, now } = input;
  const windowed = (stats?.samples ?? []).filter((s) => s.at >= now - WINDOW_MS);
  const exact = windowed.filter((s) => !s.upper);
  const exactOk = exact.flatMap((s) => (s.ms === null ? [] : [s.ms]));
  const upperOk = windowed.flatMap((s) => (s.upper && s.ms !== null ? [s.ms] : []));
  const okCount = exactOk.length + upperOk.length;
  const missed = windowed.length - okCount;
  const exactMissed = exact.length - exactOk.length;
  const reconnects = (stats?.reconnects ?? []).filter((t) => t >= now - RECONNECT_WINDOW_MS).length;
  const upperBound = !exactOk.length && upperOk.length > 0;
  const delayMs = exactOk.length ? Math.round(mean(exactOk)) : upperOk.length ? Math.round(Math.min(...upperOk)) : null;
  const jitterMs = exactOk.length >= 2 ? Math.round(Math.sqrt(mean(exactOk.map((x) => (x - mean(exactOk)) ** 2)))) : null;

  const reasons: string[] = [];
  if (missed) reasons.push(missed === 1 ? '1 reply lost' : `${missed} replies lost`);
  if (reconnects) reasons.push(reconnects === 1 ? '1 reconnect in 5 min' : `${reconnects} reconnects in 5 min`);
  if (delayMs !== null && jitterMs !== null && jitterMs > 50 && jitterMs > delayMs / 2) reasons.push('Uneven replies');

  const base = { delayMs, upperBound, jitterMs, samples: windowed.length, missed, reconnects, attempt: input.attempt, stable: !reasons.length, reasons };
  const out = (level: ConnectionLevel, lossy = false): ConnectionSummary => ({ ...base, level, bars: LEVEL_BARS[level], lossy });

  if (input.network === 'OFFLINE' || input.internetOnline === false) return out('offline');
  if (input.realtime === 'down' || input.realtime === 'connecting') return out('reconnecting');
  if (!windowed.length) return out('checking');
  if (exactMissed > 0 && exactMissed > exactOk.length) return out('poor', true);
  // Only server checks, and none answered in time: the server's slowness, with no delay to put a number on.
  if (delayMs === null) return out('checking');
  const level = levelForDelay(delayMs);
  return out(upperBound && level === 'poor' ? 'fair' : level);
}

/** "312 ms", "≤ 312 ms" for an upper bound. */
export function delayText(s: Pick<ConnectionSummary, 'delayMs' | 'upperBound'>): string | null {
  if (s.delayMs === null) return null;
  return `${s.upperBound ? '≤ ' : ''}${s.delayMs} ms`;
}

/**
 * The status bar's label: "Excellent · 42 ms", "Fair · ≤ 312 ms" (server checks only), "Poor · 2 of 3 replies lost",
 * "Offline · working from saved data", "Reconnecting… (attempt 2)".
 */
export function connectionLabel(s: ConnectionSummary, showMs: boolean): string {
  switch (s.level) {
    case 'offline':
      return 'Offline · working from saved data';
    case 'reconnecting':
      return s.attempt > 0 ? `Reconnecting… (attempt ${s.attempt})` : 'Connecting…';
    case 'checking':
      return 'Connected · checking…';
    default: {
      const word = LEVEL_WORD[s.level];
      if (!showMs) return word;
      if (s.lossy) return s.missed < s.samples ? `${word} · ${s.missed} of ${s.samples} replies lost` : `${word} · no replies`;
      const delay = delayText(s);
      return delay ? `${word} · ${delay}` : word;
    }
  }
}

export type ServerState = 'ok' | 'slow' | 'errors' | 'unknown';

/** The WorkSuite server's side, apart from the connection (#265). */
export interface ServerSummary {
  state: ServerState;
  medianMs: number | null;
  p95Ms: number | null;
  count: number;
  failed: number;
}

/**
 * How the WorkSuite server is answering, from the API's own requests: Server errors when at least two and a quarter
 * of them failed, Server slow when their median is over SERVER_SLOW_MS, else OK — once SERVER_MIN_REQUESTS of them
 * are in. A request takes at least one network round trip, so the measured network delay (`networkDelayMs`, never an
 * upper bound that has the server's own time in it) is taken off before judging: a slow line is not a slow server.
 */
export function summarizeServer(api: ApiSummary | null | undefined, networkDelayMs: number | null = null): ServerSummary {
  const s: ServerSummary = { state: 'unknown', medianMs: api?.medianMs ?? null, p95Ms: api?.p95Ms ?? null, count: api?.count ?? 0, failed: api?.failed ?? 0 };
  if (s.count < SERVER_MIN_REQUESTS) return s;
  if (s.failed >= 2 && s.failed * 4 >= s.count) return { ...s, state: 'errors' };
  if (s.medianMs !== null && s.medianMs - (networkDelayMs ?? 0) > SERVER_SLOW_MS) return { ...s, state: 'slow' };
  return { ...s, state: 'ok' };
}

/** "180 ms", "2.1 s". */
export function durationText(ms: number): string {
  const r = Math.round(ms);
  return r >= 1000 ? `${(Math.round(r / 100) / 10).toFixed(1)} s` : `${r} ms`;
}

/** The status bar's amber marker beside the connection: "Server slow · 2.1 s", "Server errors"; null when there is nothing to say. */
export function serverLabel(s: ServerSummary, showMs: boolean): string | null {
  if (s.state === 'slow') return showMs && s.medianMs !== null ? `Server slow · ${durationText(s.medianMs)}` : 'Server slow';
  if (s.state === 'errors') return showMs ? `Server errors · ${s.failed} of ${s.count} failed` : 'Server errors';
  return null;
}

/** Round-trip and reconnect accounting for the pings (main process; pure, so tests can drive it with a clock). */
export class ConnectionLedger {
  private samples: ConnectionSample[] = [];
  private reconnects: number[] = [];
  private lastReconnectAt: number | null = null;
  private sent = 0;
  private missed = 0;
  private probe: ConnectionProbe | null = null;

  /** A ping and its answer (or none). */
  record(sample: ConnectionSample): void {
    this.sent++;
    if (sample.ms === null) this.missed++;
    this.probe = sample.via;
    this.samples.push(sample);
    this.trim(sample.at);
  }

  reconnected(at: number): void {
    this.reconnects.push(at);
    this.lastReconnectAt = at;
    this.trim(at);
  }

  /** Forget the pings (signed out, server changed). Reconnects are kept: they are about the network. */
  reset(): void {
    this.samples = [];
    this.probe = null;
  }

  stats(api: ConnectionStats['api'], now: number): ConnectionStats {
    this.trim(now);
    return { probe: this.probe, samples: [...this.samples], reconnects: [...this.reconnects], lastReconnectAt: this.lastReconnectAt, sent: this.sent, missed: this.missed, api };
  }

  private trim(now: number): void {
    this.samples = this.samples.filter((s) => s.at >= now - 2 * WINDOW_MS);
    this.reconnects = this.reconnects.filter((t) => t >= now - RECONNECT_WINDOW_MS);
  }
}

/**
 * The WorkSuite server's response times: the API's last KEEP requests (time to the response's headers), their median
 * and the slowest 5%. Failed requests are counted, not timed.
 */
export class ApiTimings {
  private recent: { ms: number; ok: boolean }[] = [];
  static readonly KEEP = 50;

  add(ms: number, ok: boolean): void {
    this.recent.push({ ms: Math.max(0, Math.round(ms)), ok });
    if (this.recent.length > ApiTimings.KEEP) this.recent.splice(0, this.recent.length - ApiTimings.KEEP);
  }

  summary(): ApiSummary {
    const ok = this.recent.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
    const medianMs = ok.length ? (ok.length % 2 ? ok[(ok.length - 1) / 2]! : Math.round((ok[ok.length / 2 - 1]! + ok[ok.length / 2]!) / 2)) : null;
    // Nearest rank: of 50, the 48th; of 20, the 19th.
    const p95Ms = ok.length ? ok[Math.ceil(ok.length * 0.95) - 1]! : null;
    return { medianMs, p95Ms, count: this.recent.length, failed: this.recent.length - ok.length };
  }
}

/** Run speed test (#265): this many connections at once each way, for at most SPEED_MAX_MS each way. */
export const SPEED_STREAMS = 4;
export const SPEED_MAX_MS = 8_000;
/**
 * The download stops at this much (25 MB), the upload at this much (20 MB, 5 MB a connection): enough to fill a fast
 * line for a while, so the socket's own buffer is a small part of what is timed.
 */
export const SPEED_DOWNLOAD_BYTES = 25 * 1024 * 1024;
export const SPEED_UPLOAD_BYTES = 20 * 1024 * 1024;
/** What the speed test does, under its button. */
export const SPEED_TEST_LIMITS = `The speed test downloads up to ${SPEED_DOWNLOAD_BYTES / 1024 / 1024} MB and uploads up to ${SPEED_UPLOAD_BYTES / 1024 / 1024} MB over ${SPEED_STREAMS} connections, ${SPEED_MAX_MS / 1000} s at most each way.`;

/** Run speed test's result (#265): several parallel downloads and uploads against the WorkSuite server, 8 s each at most. */
export interface SpeedTestResult {
  downloadMbps: number | null;
  uploadMbps: number | null;
  downloadBytes: number;
  uploadBytes: number;
  /** Parallel connections each way; absent from a main process before #265. */
  streams?: number;
  /**
   * Where the download came from: the server's sized test download (`probe`), or — on a server without one — a static
   * file it serves anyway, fetched again and again (`static`), which reads low on a fast connection.
   */
  source: 'probe' | 'static' | null;
  /** Whether the server takes test uploads (and says how much it received); false: "Upload test needs a newer server". */
  uploadSupported?: boolean | null;
  /** The network delay and how much it varies when the test ran (the status bar's last 30 s). */
  delayMs?: number | null;
  jitterMs?: number | null;
  delayUpperBound?: boolean;
  error: string | null;
}

/** The popover's extra facts, read when it opens. */
export interface ConnectionDetails {
  host: string | null;
  /** The server's own clock, ISO 8601 with its offset (from /api/health); null when unknown. */
  serverTime: string | null;
  realtimeHost: string | null;
}
