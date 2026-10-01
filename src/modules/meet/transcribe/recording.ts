import { apiPost } from '../../../core/api';
import { RATE, downsample, wav } from './audio';
import { transcribe, type SpeechLanguage } from './engine';
import type { TranscriptSegment } from '../../meetings/transcripts/api';

/**
 * A transcript made from a meeting's recording (worksuite-desktop#81).
 *
 * The recording's sound is taken out (decoded here, never sent anywhere whole), made 16 kHz mono and transcribed in
 * pieces of 25 seconds, each piece's segments sent as they are ready with how far it has got. A recording's sound is
 * everybody mixed together, so nobody's name is put on what they said: each segment is an unidentified speaker, to be
 * named in review if wanted. It can be cancelled at any point; what was transcribed so far stays.
 */

export const PIECE_SECONDS = 25;

/** The recording's sound as 16 kHz mono. */
export async function decode(file: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
    }
    return downsample(mono, buffer.sampleRate, RATE);
  } finally {
    void ctx.close();
  }
}

export interface RecordingRun {
  cancel(): void;
  done: Promise<'ready' | 'cancelled'>;
}

export function transcribeRecording(transcriptId: number, samples: Float32Array, language: SpeechLanguage, onProgress: (pct: number) => void): RecordingRun {
  let cancelled = false;
  const piece = PIECE_SECONDS * RATE;
  const done = (async () => {
    const pieces = Math.max(1, Math.ceil(samples.length / piece));
    for (let i = 0; i < pieces; i++) {
      if (cancelled) return 'cancelled' as const;
      const part = samples.subarray(i * piece, Math.min(samples.length, (i + 1) * piece));
      const r = await transcribe(wav(part), language);
      const at = Math.round((i * piece * 1000) / RATE);
      const segments: TranscriptSegment[] = r.segments.map((s) => ({ start_ms: at + s.start_ms, end_ms: at + s.end_ms, speaker: '', text: s.text, uncertain: s.uncertain }));
      const progress = Math.round(((i + 1) / pieces) * 100);
      await apiPost(`/api/meetings/transcripts/${transcriptId}/segments`, { segments, progress: Math.min(99, progress), engine: r.engine });
      onProgress(progress);
    }
    return 'ready' as const;
  })();
  return { cancel: () => (cancelled = true), done };
}
