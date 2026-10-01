/**
 * Audio for transcription (worksuite-desktop#81): 16 kHz mono, as speech models take it, cut where people pause.
 */

export const RATE = 16_000;

/** Average down to 16 kHz (or any lower rate): good enough for speech, and cheap. */
export function downsample(input: Float32Array, from: number, to = RATE): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** 16-bit PCM WAV of mono samples. */
export function wav(samples: Float32Array, rate = RATE): Uint8Array {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

export interface Utterance {
  /** When it started, in ms since the splitter started. */
  startMs: number;
  samples: Float32Array;
}

/**
 * Cuts one person's speech into utterances: it starts when they speak, and ends after a pause or at most
 * `maxMs` — so each piece is something said, and a long talk still arrives as it goes.
 */
export class UtteranceSplitter {
  private chunks: Float32Array[] = [];
  private length = 0;
  private startedAt: number | null = null;
  private quietFor = 0;
  private at = 0;

  constructor(
    private readonly emit: (u: Utterance) => void,
    private readonly opts: { threshold?: number; pauseMs?: number; maxMs?: number; minMs?: number } = {},
  ) {}

  /** 16 kHz samples, in order. */
  push(samples: Float32Array): void {
    const ms = (samples.length / RATE) * 1000;
    const loud = rms(samples) >= (this.opts.threshold ?? 0.012);
    if (this.startedAt === null) {
      if (loud) {
        this.startedAt = this.at;
        this.add(samples);
        this.quietFor = 0;
      }
    } else {
      this.add(samples);
      this.quietFor = loud ? 0 : this.quietFor + ms;
      const long = (this.length / RATE) * 1000 >= (this.opts.maxMs ?? 20_000);
      if (this.quietFor >= (this.opts.pauseMs ?? 800) || long) this.flush();
    }
    this.at += ms;
  }

  /** What is left, at the end. */
  flush(): void {
    if (this.startedAt !== null && (this.length / RATE) * 1000 >= (this.opts.minMs ?? 400)) {
      const out = new Float32Array(this.length);
      let o = 0;
      for (const c of this.chunks) {
        out.set(c, o);
        o += c.length;
      }
      this.emit({ startMs: Math.round(this.startedAt), samples: out });
    }
    this.chunks = [];
    this.length = 0;
    this.startedAt = null;
    this.quietFor = 0;
  }

  private add(samples: Float32Array): void {
    this.chunks.push(samples);
    this.length += samples.length;
  }
}
