import { app } from '../../../core/app-state';
import { apiPost } from '../../../core/api';
import { text } from '../../../core/i18n';
import { createStore, useStore } from '../../../core/store';
import { previewKind } from '../AttachmentViewer';
import type { KitFile } from './model';
import { peaksOf } from './waveform';

/**
 * Voice messages (worksuite-desktop#285): what makes a file one, its length and its loudness, and whether this person
 * has played it. A voice message is decided by what the file is — sound by its type (`audio/webm`, `audio/ogg`,
 * `audio/mp4`, any `audio/*`) or by the server's word — and by the message being one, never by its extension: a
 * recording made here is WebM, which is just as often a video.
 */

/** A file this conversation plays as a voice message: sound, in a message that is one (or a channel whose sound is). */
export function isVoiceFile(f: Pick<KitFile, 'filename' | 'mime' | 'preview' | 'is_image' | 'kind'>, voice: boolean): boolean {
  return (voice || f.kind === 'voice') && previewKind(f) === 'audio';
}

/** What a screen reader says for the message: "Voice message, 12 seconds", "Voice message, 1 minute 5 seconds". */
export function voiceLabel(seconds: number | null | undefined): string {
  const s = Math.round(seconds ?? 0);
  if (!(s > 0)) return text('Voice message');
  const m = Math.floor(s / 60);
  const r = s % 60;
  const secs = r === 1 ? text('1 second') : text('{n} seconds', { n: r });
  const mins = m === 1 ? text('1 minute') : text('{n} minutes', { n: m });
  return text('Voice message, {length}', { length: m ? (r ? `${mins} ${secs}` : mins) : secs });
}

/** A voice message's length and loudness, once known. */
export interface VoiceInfo {
  ms: number | null;
  peaks: number[] | null;
}

const known = new Map<string, VoiceInfo>();
const reading = new Map<string, Promise<VoiceInfo | null>>();
/** Past this a recording is not read for its shape: its bars wait for the server's. */
const READ_LIMIT = 20 * 1024 * 1024;
/** Recordings read at once. */
const READ_AT_ONCE = 2;
let busy = 0;
const queue: Array<() => void> = [];

/** What is already known of a voice message, under any of its keys (its message, or the client id it was sent with). */
export function knownVoice(...keys: Array<string | null | undefined>): VoiceInfo | null {
  for (const k of keys) if (k && known.has(k)) return known.get(k)!;
  return null;
}

/** Keeps what the sender's device measured, so the sent message shows it at once, before the server has it. */
export function rememberVoice(key: string, info: VoiceInfo): void {
  known.set(key, info);
}

const turn = () =>
  new Promise<void>((go) => {
    const start = () => {
      busy++;
      go();
    };
    if (busy < READ_AT_ONCE) start();
    else queue.push(start);
  });
const done = () => {
  busy--;
  queue.shift()?.();
};

/**
 * A voice message's length and loudness read from the recording itself, once per message (#285): for a server that
 * sends no waveform, and for a WebM recording whose player cannot tell its length (it says Infinity). `url` is one the
 * page may fetch (the app's API proxy, as the preview reads a file). It is decoded at a low rate — only its shape and
 * length matter — and nothing is known when the system cannot decode it.
 */
export function readVoice(key: string, url: string, size?: number | null): Promise<VoiceInfo | null> {
  const had = known.get(key);
  if (had) return Promise.resolve(had);
  const going = reading.get(key);
  if (going) return going;
  if ((size ?? 0) > READ_LIMIT || typeof OfflineAudioContext === 'undefined' || typeof fetch === 'undefined') return Promise.resolve(null);
  const job = (async () => {
    await turn();
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const audio = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(await res.arrayBuffer());
      const info: VoiceInfo = {
        ms: Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : null,
        peaks: peaksOf(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))),
      };
      known.set(key, info);
      return info;
    } catch {
      return null;
    } finally {
      done();
      reading.delete(key);
    }
  })();
  reading.set(key, job);
  return job;
}

/** Played on this computer: kept per server and person, so a dot goes even where the server cannot say. */
const HEARD_KEY = 'ws.chat.voice.heard';
const HEARD_LIMIT = 2000;

function loadHeard(): string[] {
  try {
    const list: unknown = JSON.parse(globalThis.localStorage?.getItem(HEARD_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export const heard = createStore<{ keys: string[] }>({ keys: loadHeard() });
const posted = new Set<string>();
const scope = (key: string) => `${app.get().auth?.server?.origin ?? ''}|${app.get().auth?.user?.id ?? ''}|${key}`;

/** Whether this person played the voice message `key` on this computer. */
export function useHeard(key: string | null | undefined): boolean {
  return useStore(heard, (s) => !!key && s.keys.includes(scope(key)));
}

/**
 * The first play of somebody else's voice message (#285): its dot goes at once, and the server is told once, at `path`
 * (`POST /api/chat/messages/{id}/listened`), where the channel has such a mark. A server without it (404), or one
 * that cannot be reached, changes nothing here: the dot stays gone on this computer.
 */
export function markHeard(key: string, path?: string | null): void {
  const k = scope(key);
  if (!heard.get().keys.includes(k)) {
    const keys = [...heard.get().keys, k].slice(-HEARD_LIMIT);
    heard.set({ keys });
    try {
      globalThis.localStorage?.setItem(HEARD_KEY, JSON.stringify(keys));
    } catch {
      // Private storage full or turned off: remembered for this session.
    }
  }
  if (path && !posted.has(k)) {
    posted.add(k);
    void apiPost(path).catch(() => undefined);
  }
}
