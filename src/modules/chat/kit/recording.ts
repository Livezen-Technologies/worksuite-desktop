/**
 * How a voice message is recorded (worksuite-desktop#300): small enough to go at once on a slow connection, and
 * uploaded exactly as recorded, never encoded again.
 *
 *   · OPUS, MONO, 32 KBIT/S where the system records it (Chromium, so Electron always): speech needs no more, and a
 *     minute is about 240 KB instead of the ~1 MB the recorder's own default (stereo, ~128 kbit/s) made. WebM first,
 *     then Ogg.
 *   · AAC IN MP4 at the same rate where Opus can't be recorded (Safari's engine), so the fallback is as light.
 *   · Whatever the recorder hands over is the file that uploads: no second pass on this computer.
 *
 * And what the recorder checks before and while it records: room on this computer for a full-length recording,
 * asked before the microphone is opened, and a countdown over the last half minute before the limit.
 */

/** The bit rate asked for, Opus or AAC. Inside the 24–32 kbit/s band speech stays clear in. */
export const VOICE_BITS_PER_SECOND = 32_000;

/** Opus where the system records it, in WebM and then Ogg; AAC in MP4 otherwise. */
export const VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'] as const;

/** The longest voice message the server keeps (ChatAttachments::VOICE_MAX_MS). */
export const VOICE_MAX_MS = 10 * 60_000;

/** The countdown shows over this last stretch before the limit. */
export const COUNTDOWN_MS = 30_000;

/**
 * One voice, cleaned the way a call is: the server and every player get a mono recording, so asking the microphone
 * for one channel halves what the encoder has to carry before it starts.
 */
export const VOICE_CONSTRAINTS: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** What the recorder is asked for: the first type this system records, at the voice bit rate (none: its own default). */
export function voiceRecorderOptions(supported: (type: string) => boolean = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)): MediaRecorderOptions {
  const mimeType = VOICE_TYPES.find((t) => {
    try {
      return supported(t);
    } catch {
      return false;
    }
  });
  return mimeType ? { mimeType, audioBitsPerSecond: VOICE_BITS_PER_SECOND } : { audioBitsPerSecond: VOICE_BITS_PER_SECOND };
}

/** The ending a recording of this type is named with. */
export function voiceExtension(mime: string): 'webm' | 'ogg' | 'm4a' {
  return /mp4|aac/i.test(mime) ? 'm4a' : /ogg/i.test(mime) ? 'ogg' : 'webm';
}

/** Milliseconds left before the limit, once inside the countdown; null before it. */
export function countdown(elapsedMs: number, maxMs = VOICE_MAX_MS): number | null {
  const left = Math.max(0, maxMs - elapsedMs);
  return left <= COUNTDOWN_MS ? left : null;
}

/** Bytes a recording of this length takes at the voice bit rate, with a quarter more for the container and slack. */
export function voiceBytes(ms: number, bitsPerSecond = VOICE_BITS_PER_SECOND): number {
  return Math.ceil(((ms / 1000) * bitsPerSecond) / 8 * 1.25);
}

export type StorageRoom =
  /** Room for a full-length recording, or the system can't say. */
  | { kind: 'ok' }
  /** Room for a shorter one only: about this many whole minutes. */
  | { kind: 'low'; minutes: number }
  /** Not even a minute: recording would only fail when it is sent. */
  | { kind: 'full' };

/**
 * Whether there is room to keep a recording until it is sent, from what `navigator.storage.estimate()` says. A
 * recording is kept on this computer until the server has it (worksuite-desktop#300), so it needs the room first.
 */
export function storageRoom(estimate: { usage?: number; quota?: number } | null | undefined, maxMs = VOICE_MAX_MS): StorageRoom {
  if (!estimate || typeof estimate.quota !== 'number' || !(estimate.quota > 0)) return { kind: 'ok' };
  const free = Math.max(0, estimate.quota - (estimate.usage ?? 0));
  // Twice the recording: one copy as it records, one kept for sending.
  const need = (ms: number) => voiceBytes(ms) * 2;
  if (free >= need(maxMs)) return { kind: 'ok' };
  if (free < need(60_000)) return { kind: 'full' };
  return { kind: 'low', minutes: Math.max(1, Math.floor(free / need(60_000))) };
}

/** Asks the system how much room there is; anything it can't say is room enough. */
export async function checkStorage(maxMs = VOICE_MAX_MS): Promise<StorageRoom> {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    return storageRoom(estimate, maxMs);
  } catch {
    return { kind: 'ok' };
  }
}
