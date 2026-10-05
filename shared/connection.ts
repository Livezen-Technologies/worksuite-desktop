import type { NetworkStatus, RealtimeState, RealtimeTransport } from './types';

/**
 * Connection strength (worksuite-desktop#254): how the link to the WorkSuite server is doing, measured in the main
 * process and shown in the status bar as four bars and a word.
 *
 * The main process pings every PING_INTERVAL_MS — over the realtime socket when the gateway echoes (`ping:<id>` →
 * `{"type":"pong","id"}`), else with a GET of `/api/health` — and keeps the answers here. The level is worked out
 * from the last WINDOW_MS of them, so one slow answer does not make the bars jump.
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

export type ConnectionLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'offline' | 'reconnecting' | 'checking';
export type ConnectionProbe = 'realtime-echo' | 'http-health';

export interface ConnectionSample {
  /** When the ping was sent (epoch ms). */
  at: number;
  /** Round trip in ms; null when no reply came in time. */
  ms: number | null;
  via: ConnectionProbe;
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
  /** The API's own requests: the median of the last 20. */
  api: { medianMs: number | null; count: number; failed: number };
  /** How realtime reaches this computer (plan 2.7); absent from a main process before it. */
  transport?: RealtimeTransport | null;
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
  /** Average round trip over the window. */
  avgMs: number | null;
  /** How much it varies (the standard deviation of the window's round trips). */
  jitterMs: number | null;
  samples: number;
  missed: number;
  reconnects: number;
  attempt: number;
  /** Why it is not better, in words, for the popover. */
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
 * then the window's pings —
 *   Poor: over 600 ms on average, two or more replies lost, or three or more reconnects in five minutes;
 *   Fair: 250–600 ms, one lost reply, a reconnect in five minutes, or uneven (varies by more than half the average
 *         and more than 50 ms);
 *   Good: 100–250 ms;
 *   Excellent: under 100 ms with nothing lost and no reconnect.
 */
export function summarizeConnection(input: SummaryInput): ConnectionSummary {
  const { stats, now } = input;
  const windowed = (stats?.samples ?? []).filter((s) => s.at >= now - WINDOW_MS);
  const ok = windowed.flatMap((s) => (s.ms === null ? [] : [s.ms]));
  const missed = windowed.length - ok.length;
  const reconnects = (stats?.reconnects ?? []).filter((t) => t >= now - RECONNECT_WINDOW_MS).length;
  const avgMs = ok.length ? Math.round(mean(ok)) : null;
  const jitterMs = ok.length >= 2 ? Math.round(Math.sqrt(mean(ok.map((x) => (x - mean(ok)) ** 2)))) : null;
  const base = { avgMs, jitterMs, samples: windowed.length, missed, reconnects, attempt: input.attempt };
  const out = (level: ConnectionLevel, reasons: string[] = []): ConnectionSummary => ({ ...base, level, bars: LEVEL_BARS[level], reasons });

  if (input.network === 'OFFLINE' || input.internetOnline === false) return out('offline', ['No connection to the server']);
  if (input.realtime === 'down' || input.realtime === 'connecting') return out('reconnecting', ['Realtime is reconnecting']);
  if (!ok.length && !missed) return out('checking');

  const reasons: string[] = [];
  if (missed >= 2) reasons.push(`${missed} replies lost`);
  else if (missed === 1) reasons.push('1 reply lost');
  if (reconnects >= 3) reasons.push(`${reconnects} reconnects in 5 min`);
  else if (reconnects >= 1) reasons.push(reconnects === 1 ? '1 reconnect in 5 min' : `${reconnects} reconnects in 5 min`);
  if (avgMs === null) return out('poor', reasons);
  const uneven = jitterMs !== null && jitterMs > 50 && jitterMs > avgMs / 2;
  if (avgMs > 600) reasons.unshift('Slow replies');
  if (uneven) reasons.push('Uneven replies');
  if (avgMs > 600 || missed >= 2 || reconnects >= 3) return out('poor', reasons);
  if (avgMs > 250 || missed === 1 || reconnects >= 1 || uneven) return out('fair', reasons);
  if (avgMs >= 100) return out('good', reasons);
  return out('excellent', reasons);
}

/** The status bar's label: "Excellent · 42 ms", "Offline · working from saved data", "Reconnecting… (attempt 2)". */
export function connectionLabel(s: ConnectionSummary, showMs: boolean): string {
  switch (s.level) {
    case 'offline':
      return 'Offline · working from saved data';
    case 'reconnecting':
      return s.attempt > 0 ? `Reconnecting… (attempt ${s.attempt})` : 'Connecting…';
    case 'checking':
      return 'Connected · checking…';
    default:
      return showMs && s.avgMs !== null ? `${LEVEL_WORD[s.level]} · ${s.avgMs} ms` : LEVEL_WORD[s.level];
  }
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

/** The median of the API's last 20 requests (time to the response's headers). Failed requests are counted, not timed. */
export class ApiTimings {
  private recent: { ms: number; ok: boolean }[] = [];
  static readonly KEEP = 20;

  add(ms: number, ok: boolean): void {
    this.recent.push({ ms: Math.max(0, Math.round(ms)), ok });
    if (this.recent.length > ApiTimings.KEEP) this.recent.splice(0, this.recent.length - ApiTimings.KEEP);
  }

  summary(): ConnectionStats['api'] {
    const ok = this.recent.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
    const medianMs = ok.length ? (ok.length % 2 ? ok[(ok.length - 1) / 2]! : Math.round((ok[ok.length / 2 - 1]! + ok[ok.length / 2]!) / 2)) : null;
    return { medianMs, count: this.recent.length, failed: this.recent.length - ok.length };
  }
}

/** Run speed test's result: a small download and upload against the WorkSuite server. */
export interface SpeedTestResult {
  downloadMbps: number | null;
  uploadMbps: number | null;
  downloadBytes: number;
  uploadBytes: number;
  /** Where the download came from: the probe endpoint, or a static file on the server when that is missing. */
  source: 'probe' | 'static' | null;
  error: string | null;
}

/** The popover's extra facts, read when it opens. */
export interface ConnectionDetails {
  host: string | null;
  /** The server's own clock, ISO 8601 with its offset (from /api/health); null when unknown. */
  serverTime: string | null;
  realtimeHost: string | null;
}
