import { call } from '../../../core/bridge';
import { readPrefs } from '../../meet/devices';

/** What the main process is told about this computer's microphone (VOICE-11; V-04 device line). */
export interface MicReport {
  has: boolean;
  /** The microphone a call would use, by the system's name; null until the system names devices. */
  label: string | null;
  /** It shares its device with a speaker — a headset — so the call is heard through it too. */
  headset: boolean;
}

/** "Default - Jabra Evolve2 (0b0e:24c8)" is shown as "Jabra Evolve2": the system's prefix and USB ids say nothing. */
export function micName(label: string): string | null {
  const name = label.replace(/^(default|communications)\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  return name || null;
}

/**
 * The microphone a website call would use (V-04): the one chosen for calls on this computer when it is still there,
 * else the system's default, else the first. A headset is a microphone whose device also has a speaker.
 */
export function pickMic(all: MediaDeviceInfo[], chosen: string): MicReport {
  const mics = all.filter((d) => d.kind === 'audioinput');
  if (!mics.length) return { has: false, label: null, headset: false };
  const mic = mics.find((d) => chosen && d.deviceId === chosen) ?? mics.find((d) => d.deviceId === 'default') ?? mics[0]!;
  const headset = !!mic.groupId && all.some((d) => d.kind === 'audiooutput' && d.groupId === mic.groupId);
  return { has: true, label: micName(mic.label ?? ''), headset };
}

let recheck: (() => void) | null = null;

/** Look again now — another microphone was chosen for calls (call.ts useDevice), which no device event says. */
export function micChanged(): void {
  recheck?.();
}

/**
 * Whether this computer has a microphone (VOICE-11), and which (V-04), told to the main process now and whenever
 * devices change: a computer without one is not rung for visitors' calls, and the call card names the one it has.
 */
export function watchMicrophone(): () => void {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.enumerateDevices) return () => undefined;
  let last = '';
  const check = () =>
    void md
      .enumerateDevices()
      .then((all) => {
        const report = pickMic(all, readPrefs().micId);
        const key = JSON.stringify(report);
        if (key === last) return;
        last = key;
        // Only what is known: an unnamed microphone is sent as `{ has }`, as an older main process expects.
        void call('ring:mic', { has: report.has, ...(report.label ? { label: report.label } : {}), ...(report.headset ? { headset: true } : {}) }).catch(() => undefined);
      })
      .catch(() => undefined);
  check();
  recheck = check;
  md.addEventListener?.('devicechange', check);
  return () => {
    if (recheck === check) recheck = null;
    md.removeEventListener?.('devicechange', check);
  };
}
