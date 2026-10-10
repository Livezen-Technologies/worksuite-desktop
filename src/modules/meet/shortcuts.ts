import { useEffect, useRef } from 'react';
import { call, on } from '../../core/bridge';
import { registerCommand } from '../../core/commands';

/**
 * Meet's keyboard shortcuts in the renderer (WS-MEET-ENH-01 D06).
 *
 * The keys themselves live in the shell's one registry (`src/core/commands.ts`),
 * which is what makes them appear in Settings › Keyboard shortcuts, be
 * changeable, and show a clash with another part of WorkSuite instead of
 * quietly losing to it. This file only says what each one does.
 *
 * The rule worth keeping: **an in-call key does exactly what the call's own
 * button does**, by running that button, disabled state included. A shortcut
 * that can mute a microphone the host has locked, or raise a hand in a meeting
 * where hands are turned off, is a second implementation of a permission — and
 * the second one is always the one that is wrong.
 */

/** As much of the call's `ControlButton` as a shortcut needs. */
export interface ShortcutTarget {
  id: string;
  disabled?: boolean;
  onClick?: () => void;
}

/** A global key arriving from the main process. */
interface MeetShortcutEvent {
  id?: unknown;
}

/** The call's buttons, by the id the shortcut names. */
const BUTTON_FOR: Record<string, string> = {
  'meet-mute': 'mic',
  'meet-camera': 'camera',
  'meet-raise-hand': 'hand',
  'meet-share-screen': 'share',
};

/**
 * The in-call keys, for as long as the call is on screen.
 *
 * Registered on mount and given back on unmount, so the keys mean nothing
 * outside a meeting — and `runCommand` refuses an unregistered id, so a key
 * pressed in the main window while a meeting runs in its own window does
 * nothing rather than reaching the wrong call.
 */
export function useCallShortcuts(target: {
  buttons: ShortcutTarget[];
  /** Open one of the call's side panels, for the notes keys. */
  openPanel: (tab: string) => void;
  /** Shrink the call to a window that floats over other apps, or put it back. */
  popOut?: () => void;
  /** Pause or resume the share, for the sharing bar (D03). */
  pauseShare?: () => void;
  /** Stop sharing, for the sharing bar. */
  stopShare?: () => void;
}): void {
  // The buttons are rebuilt on every render; a ref keeps the commands stable
  // while still running against what is on screen now. Written in an effect,
  // not during render: a ref read during render is a bug waiting for a
  // concurrent re-render, and the commands only read it on a key press anyway.
  const latest = useRef(target);

  useEffect(() => {
    latest.current = target;
  });

  useEffect(() => {
    const press = (id: string): void => {
      const buttonId = BUTTON_FOR[id];
      const button = buttonId ? latest.current.buttons.find((b) => b.id === buttonId) : undefined;

      if (button) {
        // Disabled means the host has turned this off, or it is not available
        // in this meeting. The key says nothing; the button already explains why.
        if (!button.disabled) button.onClick?.();

        return;
      }
      if (id === 'meet-pop-out') latest.current.popOut?.();
      // The sharing bar's own buttons (D03), which arrive the same way a
      // global key does: it has no state of its own, so the call answers.
      if (id === 'meet-chat') latest.current.openPanel('Chat');
      if (id === 'meet-pause-share') latest.current.pauseShare?.();
      if (id === 'meet-stop-share') latest.current.stopShare?.();
      // The notes keys open Notes & Minutes, where the line is written. They
      // do not insert one: the minutes are a shared document with its own
      // editor, and a key that silently appends to somebody else's paragraph
      // is not a feature.
      if (id === 'meet-action-item' || id === 'meet-decision') latest.current.openPanel('Notes');
    };

    const offs = [
      registerCommand({ id: 'meet-mute', label: 'Meet: mute or unmute', group: 'Module', source: 'module', hidden: true, run: () => press('meet-mute') }),
      registerCommand({ id: 'meet-camera', label: 'Meet: camera on or off', group: 'Module', source: 'module', hidden: true, run: () => press('meet-camera') }),
      registerCommand({ id: 'meet-raise-hand', label: 'Meet: raise or lower my hand', group: 'Module', source: 'module', run: () => press('meet-raise-hand') }),
      registerCommand({ id: 'meet-share-screen', label: 'Meet: share my screen', group: 'Module', source: 'module', run: () => press('meet-share-screen') }),
      registerCommand({ id: 'meet-pop-out', label: 'Meet: float the call over other apps', group: 'Module', source: 'module', run: () => press('meet-pop-out') }),
      registerCommand({ id: 'meet-action-item', label: 'Meet: notes — add an action item', group: 'Module', source: 'module', run: () => press('meet-action-item') }),
      registerCommand({ id: 'meet-decision', label: 'Meet: notes — add a decision', group: 'Module', source: 'module', run: () => press('meet-decision') }),
      // The same actions arriving from a global key, pressed while WorkSuite
      // was behind something else. The main process sends them only to this
      // window, and only while a meeting is live here.
      on<MeetShortcutEvent>('meet:shortcut', (e) => {
        if (typeof e?.id === 'string') press(e.id);
      }),
    ];

    return () => offs.forEach((off) => off());
  }, []);
}

/**
 * The three keys that start something, answered by Meet's home.
 *
 * The main process navigates here first (`/meet?do=…`), because a key pressed
 * from another app has to open the page that can act before anything can.
 * The nonce makes a second press of the same key a second navigation.
 */
export type HomeAction = 'new' | 'join-next' | 'share';

export function homeAction(query: URLSearchParams): HomeAction | null {
  const value = query.get('do');

  return value === 'new' || value === 'join-next' || value === 'share' ? value : null;
}

/** Runs the action a `?do=` route asks for, once per navigation. */
export function useHomeAction(query: URLSearchParams, run: (action: HomeAction) => void): void {
  const done = useRef<string | null>(null);
  const latest = useRef(run);

  useEffect(() => {
    latest.current = run;
  });

  useEffect(() => {
    const action = homeAction(query);
    // The nonce distinguishes two presses of the same key; without one, the
    // same route would run once and never again.
    const key = action ? `${action}:${query.get('n') ?? ''}` : null;

    if (!action || !key || done.current === key) return;

    done.current = key;
    latest.current(action);
  }, [query]);
}

/**
 * Tells the main process what the sharing bar should show (D03), while this
 * window is sharing and only then.
 *
 * The clock counts from when this window saw the share begin, which is the
 * honest answer available here: the media server does not hand back a start
 * time, and a bar that counted from the meeting's start would read as though
 * the screen had been shared the whole time.
 */
export function useShareBarState(call_state: { sharing: boolean; paused: boolean; label: string | null; micOn: boolean; cameraOn: boolean }): void {
  const since = useRef(0);
  const { sharing, paused, label, micOn, cameraOn } = call_state;

  useEffect(() => {
    // Written here, not during render: a ref set while rendering is a bug
    // waiting for a re-render that never commits.
    if (!sharing) {
      since.current = 0;

      return;
    }
    if (since.current === 0) since.current = Date.now();

    void call('meet:barState', {
      label: (label ?? 'your screen').slice(0, 200),
      paused,
      micOn,
      cameraOn,
      // Unread chat is not counted in this window yet, so the bar shows no
      // badge rather than a made-up one.
      unreadChat: 0,
      since: since.current || Date.now(),
    }).catch(() => undefined);
  }, [sharing, paused, label, micOn, cameraOn]);
}
