import { useEffect, useRef } from 'react';
import { acceleratorKeyName } from '@shared/shortcuts';

/**
 * Push to talk (WS-MEET-ENH-01 D06, the eleventh row of that artboard).
 *
 * Hold a key to be heard, let go to go back to muted. The other ten keys on
 * that artboard were built as registry commands; this one could not be, and
 * the reason is worth writing down, because the obvious implementation breaks
 * the space bar for the whole app:
 *
 *  - **It is not a command.** `src/core/commands.ts` runs a command once per
 *    key *press*; a hold needs the release too. Worse, `Shell.tsx` calls
 *    `preventDefault()` for any accelerator that resolves to a *registered*
 *    command — so registering `meet-push-to-talk` under a bare `Space` would
 *    swallow every space bar press in every WorkSuite window. It therefore
 *    lives in `DEFAULT_SHORTCUTS` for the shortcuts page (so it is listed,
 *    changeable, and shows a clash) with no command behind it, and this hook
 *    listens for the key itself, in the window the meeting is in.
 *
 *  - **It only ever unmutes.** If the microphone is already live when the key
 *    goes down, the hold is not taken at all — otherwise letting go would mute
 *    somebody in the middle of a sentence they were already saying out loud.
 *
 *  - **It is not a second permission.** A host who has turned participants'
 *    microphones off has turned them off; the key asks `mayMic` and does
 *    nothing when the answer is no, exactly as the mute *button* does. A
 *    shortcut that can open a microphone the host closed is a second
 *    implementation of a permission, and the second one is always wrong.
 *
 *  - **Losing the key counts as letting go.** A key held while you switch
 *    apps, or while the window is hidden, never delivers its `keyup` — and
 *    the failure mode of missing one is a microphone left open in a meeting
 *    after its owner walked away. Blur, a hidden document and unmount all
 *    release the hold.
 */

/**
 * The key name both spellings of an accelerator agree on.
 *
 * The default is written `Space`, which is what Electron and
 * `electronAccelerator` call it. But the shortcuts page records a new key with
 * `accelerator()`, which takes the event's own `key` — so somebody who records
 * the space bar themselves gets `' '` stored instead. Both mean the same key,
 * so both are accepted here rather than one of them silently never matching.
 */
export const holdKeyName = (part: string): string => (part === ' ' ? 'Space' : acceleratorKeyName(part));

/** As much of a key event as the match needs. */
export type HoldEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat'>;

/**
 * Whether this key event is the push-to-talk key going down.
 *
 * A hold key carries no modifiers: ⌘Space is Spotlight, ⌃Space an input
 * switcher, and a configured chord would make those ambiguous. `repeat` is
 * ignored because a held key fires over and over, and the second one must not
 * look like a fresh press.
 */
export function isHoldKey(e: HoldEvent, configured: string | null | undefined): boolean {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;

  return typeof e.key === 'string' && holdKeyOf(configured) === holdKeyName(e.key);
}

/**
 * The single key an accelerator names, or null when it names anything else.
 *
 * A hold key cannot be a chord, whatever Settings was set to: there is no
 * sensible release for `⌘Space` once the ⌘ comes up first.
 */
export function holdKeyOf(configured: string | null | undefined): string | null {
  if (typeof configured !== 'string') return null;

  const parts = configured.split('+').filter((p) => p !== '');

  return parts.length === 1 ? holdKeyName(parts[0]!) : null;
}

/** Whether the focused element wants the key for itself — the chat composer, a name field. */
export function typingIn(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

export interface PushToTalkTarget {
  /** The accelerator from the person's own shortcuts, e.g. `Space`. */
  accelerator: string | null | undefined;
  /** Whether the microphone is live right now. */
  micOn: boolean;
  /** Whether this meeting lets this person use a microphone at all. */
  mayMic: boolean;
  /** Turn the microphone on or off. Must be a set, not a toggle: a toggle on a key that can fire twice drifts. */
  setMic: (on: boolean) => void;
}

/**
 * Holds the key for as long as the call is on screen.
 *
 * Everything is read through a ref at press time rather than captured in the
 * listener's closure, so the hold reads the meeting as it is now — `mayMic`
 * can change mid-call when the host locks microphones, and a listener bound to
 * the old value would open one anyway.
 */
export function usePushToTalk(target: PushToTalkTarget): void {
  const latest = useRef(target);
  const holding = useRef(false);

  useEffect(() => {
    latest.current = target;
  });

  useEffect(() => {
    const release = (): void => {
      if (!holding.current) return;
      holding.current = false;
      latest.current.setMic(false);
    };

    const down = (e: KeyboardEvent): void => {
      const t = latest.current;

      if (holding.current || typingIn(e.target) || !isHoldKey(e, t.accelerator)) return;
      // Already live, or not allowed one: the key does nothing, and says
      // nothing — the mute button already explains why it is disabled.
      if (t.micOn || !t.mayMic) return;
      // The space bar scrolls, and the call's own buttons answer it: neither
      // should happen while it is being used to talk.
      e.preventDefault();
      holding.current = true;
      t.setMic(true);
    };

    /*
     * Release on the bare key name, with the modifiers deliberately ignored.
     *
     * `isHoldKey` is not reused here, and a `{ ...e }` of a DOM KeyboardEvent
     * to reuse it is how this was first written and why it threw: a key event's
     * properties live on its prototype, so the spread is an empty object and
     * `e.key` comes out undefined. A release also has to survive a modifier
     * being pressed during the hold — ⇧Space while talking is still the space
     * bar coming up — and the far worse mistake is missing a release.
     */
    const up = (e: KeyboardEvent): void => {
      if (holding.current && holdKeyOf(latest.current.accelerator) === holdKeyName(e.key)) release();
    };

    const hidden = (): void => {
      if (document.visibilityState === 'hidden') release();
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', hidden);

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', hidden);
      // Unmounting with the key down — the meeting window closing mid-hold —
      // must not leave the microphone open in whatever comes next.
      release();
    };
  }, []);
}
