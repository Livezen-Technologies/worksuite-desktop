/**
 * A voice message's loudness (worksuite-desktop#285): 64 equal slices of the recording, each 0–100 of the loudest, as
 * the sender's device measures it and sends it as `waveform`, and as it is worked out here for a message without one.
 * Nothing here touches the page, so the recorder and the player share it.
 */

/** The loudness a voice message carries: this many equal slices, each 0–100. */
export const WAVEFORM_STEPS = 64;

/** `values` as `n` bars: the loudest of each stretch when there are more of them, the nearest when there are fewer. */
export function resample(values: readonly number[], n: number): number[] {
  if (n <= 0) return [];
  if (!values.length) return Array.from({ length: n }, () => 0);
  if (values.length === n) return [...values];
  if (values.length < n) return Array.from({ length: n }, (_, i) => values[Math.floor((i * values.length) / n)]!);
  return Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * values.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / n));
    let top = 0;
    for (let j = from; j < to; j++) top = Math.max(top, values[j]!);
    return top;
  });
}

/** Each value as 0–100 of the loudest, so a quiet voice still shows its shape; silence stays at 0. */
export function scaled(values: readonly number[]): number[] {
  const top = values.reduce((a, v) => Math.max(a, v), 0);
  return values.map((v) => (top > 0 ? Math.round((Math.max(0, v) / top) * 100) : 0));
}

/**
 * A recording's loudness in `steps` equal slices (#285): the loudest sample of each slice, across its channels, as 0–100
 * of the loudest slice. `channels` are the decoded samples, -1 to 1. This is what the sender's device sends as
 * `waveform`, and what is worked out here for a message that came without one.
 */
export function peaksOf(channels: ReadonlyArray<ArrayLike<number>>, steps = WAVEFORM_STEPS): number[] {
  const length = channels.reduce((a, c) => Math.max(a, c.length), 0);
  const top = Array.from({ length: steps }, () => 0);
  if (!length) return top;
  for (let i = 0; i < steps; i++) {
    const from = Math.floor((i * length) / steps);
    const to = Math.max(from + 1, Math.floor(((i + 1) * length) / steps));
    for (const c of channels) {
      for (let j = from; j < Math.min(to, c.length); j++) {
        const v = Math.abs(c[j]!);
        if (v > top[i]!) top[i] = v;
      }
    }
  }
  return scaled(top);
}

/** The recorder's live levels (0–1, a tenth of a second apart) as the waveform sent with the message. */
export function levelsToWaveform(levels: readonly number[]): number[] {
  return scaled(resample(levels, WAVEFORM_STEPS));
}

/** A waveform from the server, if it is one: whole numbers 0–100. Anything else is worked out here instead. */
export function waveformOf(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.length || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return (value as number[]).map((v) => Math.min(100, Math.max(0, Math.round(v))));
}
