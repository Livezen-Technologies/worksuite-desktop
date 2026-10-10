import { createStore } from '../../../core/store';

/**
 * How fast a voice message goes (worksuite-desktop#300), measured on this computer for each one sent:
 *
 *   · bubbleMs   Send pressed → the voice bubble on screen (target: within 200 ms).
 *   · confirmMs  Send pressed → the server confirmed the message ("Sent").
 *   · bytesPerMinute  how large the recording is for each minute of sound (≈ 240 KB at Opus 32 kbit/s).
 *   · retries    automatic retries it took.
 *
 * The last 200 are kept on this computer (never sent anywhere) and summed up as median and 95th percentile, per
 * connection type, in Help → Diagnostics, so a before-and-after comparison can be read off one machine. Each one is
 * also written to the console as `[voice] …` for a support session.
 */

export interface VoiceSample {
  id: string;
  at: string;
  bytes: number;
  durationMs: number;
  mime: string;
  bubbleMs: number | null;
  confirmMs: number | null;
  retries: number;
  failed: boolean;
  /** The connection's type as the system reports it (`4g`, `3g`, `wifi`…), or `unknown`. */
  network: string;
}

export interface VoiceSummary {
  count: number;
  bubble: { median: number | null; p95: number | null };
  confirm: { median: number | null; p95: number | null };
  bytesPerMinute: number | null;
  failureRate: number;
  retries: number;
}

const KEY = 'ws.chat.voice.metrics';
const KEEP = 200;

interface Pending {
  started: number;
  bytes: number;
  durationMs: number;
  mime: string;
  bubbleMs: number | null;
  retries: number;
  network: string;
}

const pending = new Map<string, Pending>();

function load(): VoiceSample[] {
  try {
    const list: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? (list as VoiceSample[]).filter((s) => s && typeof s.id === 'string').slice(-KEEP) : [];
  } catch {
    return [];
  }
}

export const voiceMetrics = createStore<{ samples: VoiceSample[] }>({ samples: load() });

function save(samples: VoiceSample[]): void {
  voiceMetrics.set({ samples });
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(samples));
  } catch {
    // Storage full or off: kept for this session.
  }
}

/** The connection's type, as far as the system says. */
export function networkType(): string {
  const c = (globalThis.navigator as unknown as { connection?: { effectiveType?: string; type?: string } } | undefined)?.connection;
  return c?.type && c.type !== 'unknown' ? c.type : (c?.effectiveType ?? 'unknown');
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Send was pressed for the voice message `id` (its client message id), at `pressedAt` (performance.now()). */
export function voiceSendStarted(id: string, info: { bytes: number; durationMs: number; mime: string; pressedAt?: number }): void {
  pending.set(id, { started: info.pressedAt ?? now(), bytes: info.bytes, durationMs: info.durationMs, mime: info.mime, bubbleMs: null, retries: 0, network: networkType() });
}

/** Its bubble is on screen: the first time only. */
export function voiceBubbleShown(id: string): void {
  const p = pending.get(id);
  if (p && p.bubbleMs === null) p.bubbleMs = Math.max(0, Math.round(now() - p.started));
}

/** It was tried again by itself. */
export function voiceRetried(id: string, attempts: number): void {
  const p = pending.get(id);
  if (p) p.retries = Math.max(p.retries, attempts);
}

/** It ended: confirmed by the server, or given up (failed, cancelled). Only what was measured from Send counts. */
export function voiceSendEnded(id: string, outcome: 'sent' | 'failed' | 'cancelled'): void {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (outcome === 'cancelled') return;
  const sample: VoiceSample = {
    id,
    at: new Date().toISOString(),
    bytes: p.bytes,
    durationMs: p.durationMs,
    mime: p.mime,
    bubbleMs: p.bubbleMs,
    confirmMs: outcome === 'sent' ? Math.max(0, Math.round(now() - p.started)) : null,
    retries: p.retries,
    failed: outcome === 'failed',
    network: p.network,
  };
  console.info(`[voice] ${outcome} · ${(sample.durationMs / 1000).toFixed(1)} s · ${sample.bytes} B · bubble ${sample.bubbleMs ?? '–'} ms · confirmed ${sample.confirmMs ?? '–'} ms · ${sample.retries} retries · ${sample.network}`);
  save([...voiceMetrics.get().samples, sample].slice(-KEEP));
}

/** Whether a message is being timed. */
export function isTimed(id: string): boolean {
  return pending.has(id);
}

/** The value at the q-th quantile (0–1), nearest-rank. */
export function quantile(values: number[], q: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

/** Median and 95th percentile of the timings, size per minute, failures and retries. */
export function summarize(samples: VoiceSample[]): VoiceSummary {
  const bubbles = samples.flatMap((s) => (s.bubbleMs === null ? [] : [s.bubbleMs]));
  const confirms = samples.flatMap((s) => (s.confirmMs === null ? [] : [s.confirmMs]));
  const sized = samples.filter((s) => s.durationMs > 0 && s.bytes > 0);
  const minutes = sized.reduce((n, s) => n + s.durationMs / 60_000, 0);
  return {
    count: samples.length,
    bubble: { median: quantile(bubbles, 0.5), p95: quantile(bubbles, 0.95) },
    confirm: { median: quantile(confirms, 0.5), p95: quantile(confirms, 0.95) },
    bytesPerMinute: minutes > 0 ? Math.round(sized.reduce((n, s) => n + s.bytes, 0) / minutes) : null,
    failureRate: samples.length ? samples.filter((s) => s.failed).length / samples.length : 0,
    retries: samples.reduce((n, s) => n + s.retries, 0),
  };
}

/** The summary per connection type, busiest first. */
export function summarizeByNetwork(samples: VoiceSample[]): Array<{ network: string; summary: VoiceSummary }> {
  const groups = new Map<string, VoiceSample[]>();
  for (const s of samples) groups.set(s.network, [...(groups.get(s.network) ?? []), s]);
  return [...groups.entries()].map(([network, list]) => ({ network, summary: summarize(list) })).sort((a, b) => b.summary.count - a.summary.count);
}

/** Forget them all (Diagnostics › Clear), e.g. before measuring a new baseline. */
export function clearVoiceMetrics(): void {
  pending.clear();
  save([]);
}
