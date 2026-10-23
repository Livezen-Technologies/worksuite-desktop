/**
 * Turning this app's shortcuts into keys the operating system can hold
 * (WS-MEET-ENH-01 D06).
 *
 * The renderer writes accelerators as `Mod+Shift+M` — `Mod` being ⌘ on a Mac
 * and Ctrl elsewhere — because that is what a key event normalises to
 * (`src/core/commands.ts`). Electron's `globalShortcut` wants
 * `CommandOrControl+Shift+M`. This translates between the two, and refuses
 * anything it does not recognise rather than handing the OS a string to
 * interpret: these values come from a saved preference, which is to say from
 * somewhere a person typed, and a key the OS half-understands is worse than
 * no key at all.
 */

/** Keys Electron names rather than taking as a character. */
const NAMED = new Set([
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Esc',
  'Plus',
  'PrintScreen',
]);

/** What a key event's `key` is called in an accelerator. */
const EVENT_KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
};

const MODIFIERS: Record<string, string> = {
  Mod: 'CommandOrControl',
  // On a Mac the registry's `Ctrl` is the physical control key, which Electron
  // calls `Control`; off a Mac `Mod` already is it, so this appears only in
  // the Mac-only entries.
  Ctrl: 'Control',
  Alt: 'Alt',
  Shift: 'Shift',
  Super: 'Super',
};

/**
 * `"Mod+Shift+M"` → `"CommandOrControl+Shift+M"`, or null when it is not a
 * key this app would have written: an unknown modifier, no key, a key of more
 * than one character that is not one Electron names, or more parts than any
 * real chord has.
 */
export function electronAccelerator(acc: string | null | undefined): string | null {
  if (typeof acc !== 'string') return null;

  const parts = acc.split('+').filter((p) => p !== '');

  if (parts.length === 0 || parts.length > 5) return null;

  const key = parts[parts.length - 1]!;
  const mods = parts.slice(0, -1);
  const out: string[] = [];

  for (const m of mods) {
    const name = MODIFIERS[m];

    if (!name || out.includes(name)) return null;

    out.push(name);
  }

  if (NAMED.has(key)) return [...out, key].join('+');

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return [...out, key].join('+');

  // A single character: a letter, a digit, or punctuation such as `,` or `]`.
  if (key.length !== 1 || /\s/.test(key)) return null;

  return [...out, key.toUpperCase()].join('+');
}

/** The name an accelerator gives a key event's `key`, so both sides agree. */
export const acceleratorKeyName = (key: string): string => EVENT_KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);

/**
 * Meet's default keys (WS-MEET-ENH-01 D06), here rather than beside the
 * shell's because the main process holds five of them and cannot read the
 * renderer's module. `src/core/commands.ts` spreads these into the one
 * registry everything else reads.
 *
 * Four of the eleven keys that artboard lists were already WorkSuite's own:
 * ⌘⇧N is Move tab to new window (and Marketing's Next contact from outside
 * the app), ⌘⇧P the command palette, ⌘⇧A the assistant, ⌘⇧D Dock tab beside.
 * Those four keep the design's letter and take ⌘⌥ instead of ⌘⇧, which is
 * free: moving a key nobody has yet is a better answer than taking one away
 * from somebody who already uses it. The shortcuts page shows every clash, so
 * anybody who prefers the design's key can swap the two themselves.
 *
 * ⌘⇧N off a Mac is Ctrl+Shift+N, and Ctrl+Alt+N there is Marketing's, so the
 * new-meeting key needs the extra Shift on Windows and Linux. Marketing's own
 * entry splits by platform for the same reason in the other direction.
 *
 * Ten of the eleven are keys you press. The eleventh, push to talk, is one you
 * hold: it is listed here, so it is shown and changeable like the rest, but it
 * is answered by the call rather than by a command.
 */
export function meetShortcutDefaults(mac: boolean): Record<string, string> {
  return {
    'meet-mute': 'Mod+Shift+M',
    'meet-camera': 'Mod+Shift+V',
    'meet-join-next': 'Mod+Shift+J',
    'meet-share-screen': 'Mod+Shift+E',
    'meet-raise-hand': 'Mod+Shift+H',
    'meet-new': mac ? 'Mod+Alt+N' : 'Mod+Alt+Shift+N',
    'meet-pop-out': 'Mod+Alt+P',
    'meet-action-item': 'Mod+Alt+A',
    'meet-decision': 'Mod+Alt+D',
    // Held, not pressed. It is listed here so the shortcuts page shows it and
    // can change it, but nothing registers a command behind it:
    // `src/modules/meet/pushToTalk.ts` says why a bare Space under a registry
    // command would swallow every space bar press in the app.
    'meet-push-to-talk': 'Space',
  };
}

/**
 * Meet's keys that the main process holds for the whole computer, and what
 * each one needs to be worth holding.
 *
 * `inCall` keys are held only while this computer is in a meeting. Owning ⌘⇧M
 * system-wide while nobody is in a call would take the key from every other
 * app for nothing — and the first thing somebody does when a shortcut
 * mysteriously stops working in another app is blame us, correctly.
 */
export const MEET_GLOBAL_KEYS = {
  'meet-mute': 'inCall',
  'meet-camera': 'inCall',
  'meet-join-next': 'signedIn',
  'meet-share-screen': 'signedIn',
  'meet-new': 'signedIn',
} as const satisfies Record<string, 'inCall' | 'signedIn'>;

export type MeetGlobalKey = keyof typeof MEET_GLOBAL_KEYS;

export const MEET_GLOBAL_IDS = Object.keys(MEET_GLOBAL_KEYS) as MeetGlobalKey[];

export interface MeetKeyState {
  signedIn: boolean;
  locked: boolean;
  /** Meet is among the apps this person may open. */
  meet: boolean;
  /** This computer is in a meeting right now. */
  inCall: boolean;
  /**
   * Settings › Meet › Behaviour › Global mute and camera shortcuts (D05).
   * Off, the keys are the renderer's alone and nothing is held for the whole
   * computer — somebody who wants ⌘⇧M back for another app can have it.
   */
  globalKeys?: boolean;
}

/** Which of Meet's global keys should be held as things are now. */
export function wantedMeetKeys(s: MeetKeyState): MeetGlobalKey[] {
  // Locked, signed out, without Meet at all, or with the global keys switched
  // off: none of them. A locked computer must not answer a key that unmutes a
  // microphone.
  if (!s.signedIn || s.locked || !s.meet || s.globalKeys === false) return [];

  return MEET_GLOBAL_IDS.filter((id) => (MEET_GLOBAL_KEYS[id] === 'inCall' ? s.inCall : true));
}
