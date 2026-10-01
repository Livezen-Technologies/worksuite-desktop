import { FileTranscriber, type TranscribeResult } from '@transcribe/transcriber';
import { call, on } from '../core/bridge';

/**
 * The speech page (worksuite-desktop#81): whisper.cpp, built for the web, transcribing meeting audio on this computer.
 *
 * A hidden page of its own, served cross-origin isolated so whisper.cpp can run on several threads. The main process
 * hands it pieces of audio (16 kHz WAV) and it answers with what was said, when, and how sure it is. Nothing leaves
 * this computer from here: the model is read from the computer, and the page reaches nothing else.
 */

interface Job {
  id: string;
  wav: Uint8Array;
  language: string;
}

let transcriber: FileTranscriber | null = null;

/** WebAssembly SIMD, tested with the smallest module that uses it. */
function simd(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

/** Confidence of a segment: the mean of its words' probabilities. */
export function confidence(tokens: Array<{ p: number; text: string }>): number {
  const words = tokens.filter((t) => !/^\[_|^<\|/.test(t.text));
  return words.length ? words.reduce((a, t) => a + t.p, 0) / words.length : 1;
}

async function init(): Promise<void> {
  try {
    if (!self.crossOriginIsolated) throw new Error('This page is not isolated, so transcription cannot use several threads.');
    const file = simd() ? 'shout.wasm.js' : 'shout.wasm_no-simd.js';
    const mod = (await import(/* @vite-ignore */ new URL(`./speech/${file}`, location.href).href)) as { default: (arg?: object) => Promise<unknown> };
    transcriber = new FileTranscriber({ createModule: mod.default, model: new URL('/__local/speech/model.bin', location.href).href });
    await transcriber.init();
    await call('speech:ready', { ok: true });
  } catch (e) {
    transcriber = null;
    await call('speech:ready', { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 480) });
  }
}

on<Job>('speech:job', (job) => {
  void (async () => {
    try {
      if (!transcriber) throw new Error('The speech model is not loaded.');
      const res = (await transcriber.transcribe(new File([new Uint8Array(job.wav)], 'audio.wav', { type: 'audio/wav' }), {
        lang: job.language || 'auto',
        threads: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)),
        token_timestamps: true,
      })) as TranscribeResult;
      const segments = (res?.transcription ?? [])
        .map((s) => ({ start_ms: s.offsets.from, end_ms: s.offsets.to, text: s.text.trim(), uncertain: confidence(s.tokens) < 0.5 }))
        .filter((s) => s.text && !/^\[(BLANK_AUDIO|MUSIC|NOISE)\]$/i.test(s.text));
      await call('speech:result', { id: job.id, segments: segments.slice(0, 1000).map((s) => ({ ...s, text: s.text.slice(0, 4000) })) });
    } catch (e) {
      await call('speech:result', { id: job.id, error: (e instanceof Error ? e.message : String(e)).slice(0, 480) });
    }
  })();
});

void init();
