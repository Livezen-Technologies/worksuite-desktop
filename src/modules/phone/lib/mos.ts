/**
 * Call quality as a MOS (VOIP-SP-10, design W02 "HD · Opus · MOS 4.3"), estimated from the browser's own RTP
 * statistics with the simplified ITU-T G.107 E-model: R = 93.2 − Id(latency) − Ie(loss), MOS from R.
 *
 * An estimate, labelled as one. With no packets measured yet there is no number at all (NFR-10).
 */

export interface QualitySample {
  /** Round-trip time in milliseconds. */
  rttMs: number | null;
  /** Interarrival jitter in milliseconds. */
  jitterMs: number | null;
  /** Fraction of packets lost, 0–1. */
  loss: number | null;
}

export function rFactor({ rttMs, jitterMs, loss }: QualitySample): number | null {
  if (rttMs === null && jitterMs === null && loss === null) return null;
  // One-way effective latency: half the round trip, plus jitter buffer (2× jitter) and 10 ms codec delay.
  const effective = (rttMs ?? 0) / 2 + 2 * (jitterMs ?? 0) + 10;
  const id = effective < 160 ? effective / 40 : (effective - 120) / 10;
  const ie = 100 * Math.min(1, Math.max(0, loss ?? 0)) * 2.5;
  return Math.max(0, Math.min(100, 93.2 - id - ie));
}

export function mosFromR(r: number): number {
  if (r <= 0) return 1;
  if (r >= 100) return 4.5;
  const mos = 1 + 0.035 * r + 7e-6 * r * (r - 60) * (100 - r);
  return Math.round(Math.min(4.5, Math.max(1, mos)) * 10) / 10;
}

export function mos(sample: QualitySample): number | null {
  const r = rFactor(sample);
  return r === null ? null : mosFromR(r);
}

export type QualityLabel = 'good' | 'fair' | 'poor';

export function qualityLabel(m: number | null): QualityLabel | null {
  if (m === null) return null;
  return m >= 4 ? 'good' : m >= 3.4 ? 'fair' : 'poor';
}

/** The parts of `RTCPeerConnection.getStats()` the estimate reads; kept loose so a test can hand in plain objects. */
type StatLike = { type: string; kind?: string; mediaType?: string; [k: string]: unknown };

/**
 * One sample from a stats report, and the codec in use (`opus`, `PCMA`). Loss is measured over the interval since
 * `prev` when it is given, so one bad second early in a call does not colour the whole call.
 */
export function sampleFromStats(
  stats: Iterable<StatLike>,
  prev?: { received: number; lost: number } | null,
): { sample: QualitySample; codec: string | null; counters: { received: number; lost: number } } {
  let rtt: number | null = null;
  let jitter: number | null = null;
  let received = 0;
  let lost = 0;
  let codecId: string | null = null;
  const codecs = new Map<string, string>();
  for (const s of stats) {
    if (s.type === 'codec' && typeof s.mimeType === 'string' && typeof s.id === 'string') codecs.set(s.id, s.mimeType.replace(/^audio\//i, ''));
    if (s.type === 'inbound-rtp' && (s.kind ?? s.mediaType) === 'audio') {
      if (typeof s.jitter === 'number') jitter = s.jitter * 1000;
      if (typeof s.packetsReceived === 'number') received = s.packetsReceived;
      if (typeof s.packetsLost === 'number') lost = Math.max(0, s.packetsLost);
      if (typeof s.codecId === 'string') codecId = s.codecId;
    }
    if (s.type === 'remote-inbound-rtp' && typeof s.roundTripTime === 'number') rtt = s.roundTripTime * 1000;
    if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated && rtt === null && typeof s.currentRoundTripTime === 'number') {
      rtt = s.currentRoundTripTime * 1000;
    }
  }
  const dRecv = prev ? received - prev.received : received;
  const dLost = prev ? lost - prev.lost : lost;
  const total = dRecv + dLost;
  const loss = total > 0 ? Math.max(0, dLost) / total : received + lost > 0 ? 0 : null;
  return {
    sample: { rttMs: rtt, jitterMs: jitter, loss },
    codec: codecId ? (codecs.get(codecId) ?? null) : null,
    counters: { received, lost },
  };
}
