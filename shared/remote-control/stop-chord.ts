import { canonicalChord, parseChord } from './channel';

/**
 * Which chord stops remote control (WS-MEET-ENH-01 RC09).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORGANISATION FIRST, THE PERSON ONLY IN ITS SILENCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `remote_emergency_stop_chord` is a policy field, so the chord is the
 * organisation's to set, and where they have set one it is not a person's to
 * change — a company that standardised on a chord did so to be able to tell
 * everybody the same thing in an incident. But almost nobody sets it, and the
 * cost of that silence falls on the person whose own keyboard already uses
 * `Ctrl+Alt+Shift+Esc` for something else: the emergency stop is then held by
 * another app and the one key that ends control does nothing.
 *
 * So: a person may choose their own **only while the policy is still at the
 * default**. The moment an organisation sets its own, that wins and the
 * screen says so. Nobody's choice can leave the stop unreachable, because
 * there is no "off" — only which chord.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE RULES ARE STRICTER THAN THE POLICY'S
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The policy accepts one modifier and a key. A person choosing from a settings
 * page gets a shorter leash: **two modifiers at least**, because a chord this
 * important must not be pressable by accident while somebody is typing, and
 * the receiver refuses to inject it — a chord that is easy to press is also a
 * chord a controller's keystrokes would keep tripping over.
 */

/** What the policy ships with. A policy still at this value has said nothing. */
export const DEFAULT_STOP_CHORD = 'Ctrl+Alt+Shift+Esc';

/**
 * The chords offered, with what each costs on a given keyboard. A list rather
 * than a recorder: every one of these is known to be free of the shell's own
 * shortcuts, and a free-text field would let somebody choose a chord that
 * silently fails to register.
 */
export const STOP_CHORD_CHOICES: Array<{ chord: string; note: string }> = [
  { chord: 'Ctrl+Alt+Shift+Esc', note: 'The default. Windows and Linux reach it easily; on a Mac it needs all three.' },
  { chord: 'Ctrl+Alt+Shift+F12', note: 'Where something else already holds Escape.' },
  { chord: 'Ctrl+Alt+Shift+Backspace', note: 'Easy to find without looking.' },
  { chord: 'Ctrl+Alt+Shift+Delete', note: 'Not the same as Ctrl+Alt+Delete, which the system keeps for itself.' },
  { chord: 'Ctrl+Shift+Alt+Home', note: 'On a keyboard with no function row.' },
];

/** Whether the organisation has chosen a chord of its own. */
export const policyChoseChord = (policyChord: string | null | undefined): boolean =>
  !!policyChord && canonicalChord(policyChord) !== DEFAULT_STOP_CHORD;

/**
 * Why a chord cannot be used, or empty when it can.
 *
 * Said as what it would cost rather than as a rule number: somebody reading
 * this is choosing a key, not studying a specification.
 */
export function chordRefusal(chord: string): string {
  const c = parseChord(String(chord ?? ''));
  const plain = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Esc|Tab|Space|Enter|Backspace|Delete|Home|End|PageUp|PageDown)$/.test(c.key);

  if (!c.key || !plain) return 'Choose a chord that ends in an ordinary key.';
  if (c.mods.size < 2) return 'Use at least two modifiers, so it cannot be pressed by accident while you type.';
  if (c.key === 'Tab' && (c.mods.has('Alt') || c.mods.has('Meta'))) return 'That chord switches apps on this computer, so it would never reach WorkSuite.';

  return '';
}

/**
 * The chord in force: the organisation's, else the person's, else the default.
 *
 * Every caller — the global shortcut, the receiver that refuses to inject it,
 * and the row in Settings — goes through this, so there is one answer to
 * "which chord" rather than three that can disagree.
 */
export function effectiveStopChord(policyChord: string | null | undefined, chosen: string | null | undefined): string {
  if (policyChoseChord(policyChord)) return canonicalChord(policyChord as string);

  if (chosen && !chordRefusal(chosen) && STOP_CHORD_CHOICES.some((c) => canonicalChord(c.chord) === canonicalChord(chosen))) {
    return canonicalChord(chosen);
  }

  return DEFAULT_STOP_CHORD;
}
