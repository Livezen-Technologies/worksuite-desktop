import { playOnce } from '../calls/tones';
/** One announcement per confirmed transition; visual feedback remains when audio is unavailable. */
export function announceRecording(active: boolean): void {
  const message = active ? 'This meeting is being recorded.' : 'Recording has stopped.';
  try {
    if (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
      speechSynthesis.speak(new SpeechSynthesisUtterance(message));
      return;
    }
  } catch { /* A notification sound still works without a speech voice. */ }
  playOnce('hand');
}
