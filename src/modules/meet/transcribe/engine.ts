import { apiGet, apiPost } from '../../../core/api';
import { app } from '../../../core/app-state';
import { call, errorMessage } from '../../../core/bridge';
import type { SpeechSegment } from '@shared/types';

/**
 * Who transcribes (worksuite-desktop#81): this computer first — whisper.cpp with the person's speech model — and the
 * WorkSuite server only when that cannot, and only when Settings › AI Assistant › Allow online fallback is on. Each
 * piece says which did it.
 */

export type SpeechLanguage = 'en' | 'si' | 'ta';

export const LANGUAGE_LABEL: Record<SpeechLanguage, string> = { en: 'English', si: 'Sinhala', ta: 'Tamil' };

export interface Transcribed {
  segments: SpeechSegment[];
  engine: 'local' | 'online';
}

/** Whether the server can transcribe, asked once per session. */
let online: Promise<{ online: boolean; why: string | null }> | null = null;
export function onlineStatus(): Promise<{ online: boolean; why: string | null }> {
  const asked = online ?? apiGet<{ online: boolean; why: string | null }>('/api/ai/speech/status').catch(() => ({ online: false, why: 'This WorkSuite server cannot transcribe yet.' }));
  online = asked;
  return asked;
}

/** Which engine will be used, and why not the other — said before transcription starts. */
export async function plan(): Promise<{ engine: 'local' | 'online' | null; note: string | null }> {
  const local = await call('stt:status').catch(() => null);
  if (local?.local.ready) return { engine: 'local', note: null };
  const fallback = app.get().prefs?.ai.onlineFallback ?? true;
  if (!fallback) return { engine: null, note: `${local?.local.why ?? 'This computer cannot transcribe.'} Online fallback is off in Settings › AI Assistant.` };
  const o = await onlineStatus();
  return o.online ? { engine: 'online', note: `${local?.local.why ?? 'This computer cannot transcribe.'} The WorkSuite server transcribes instead.` } : { engine: null, note: `${local?.local.why ?? 'This computer cannot transcribe.'} ${o.why ?? ''}`.trim() };
}

async function viaServer(audio: Uint8Array, language: SpeechLanguage): Promise<SpeechSegment[]> {
  const form = new FormData();
  form.set('audio', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'audio.wav');
  form.set('language', language);
  return (await apiPost<{ segments: SpeechSegment[] }>('/api/ai/speech/transcribe', form)).segments;
}

/** One piece of 16 kHz mono WAV: on this computer, else online if allowed. */
export async function transcribe(audio: Uint8Array, language: SpeechLanguage): Promise<Transcribed> {
  let localError: string | null = null;
  try {
    const local = await call('stt:status');
    if (local.local.ready) return { segments: (await call('stt:transcribe', { wav: new Uint8Array(audio), language })).segments, engine: 'local' };
    localError = local.local.why;
  } catch (e) {
    localError = errorMessage(e);
  }
  if (!(app.get().prefs?.ai.onlineFallback ?? true)) throw new Error(`${localError ?? 'This computer could not transcribe.'} Online fallback is off.`);
  const o = await onlineStatus();
  if (!o.online) throw new Error(`${localError ?? 'This computer could not transcribe.'} ${o.why ?? ''}`.trim());
  return { segments: await viaServer(audio, language), engine: 'online' };
}
