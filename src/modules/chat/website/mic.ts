import { call } from '../../../core/bridge';

/**
 * Whether this computer has a microphone (VOICE-11), told to the main process now and whenever devices change: a
 * computer without one is not rung for visitors' calls.
 */
export function watchMicrophone(): () => void {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.enumerateDevices) return () => undefined;
  let last: boolean | null = null;
  const check = () =>
    void md
      .enumerateDevices()
      .then((all) => {
        const has = all.some((d) => d.kind === 'audioinput');
        if (has === last) return;
        last = has;
        void call('ring:mic', { has }).catch(() => undefined);
      })
      .catch(() => undefined);
  check();
  md.addEventListener?.('devicechange', check);
  return () => md.removeEventListener?.('devicechange', check);
}
