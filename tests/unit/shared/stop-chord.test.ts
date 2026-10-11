import { describe, expect, it } from 'vitest';
import { DEFAULT_STOP_CHORD, STOP_CHORD_CHOICES, chordRefusal, effectiveStopChord, policyChoseChord } from '../../../shared/remote-control/stop-chord';

/**
 * Which chord stops remote control (RC09).
 *
 * The rule being protected is an order of authority: the organisation's choice
 * beats the person's, and the person's beats the default. Nothing anybody
 * chooses can leave the stop unreachable — there is no "off", only which
 * chord — and a chord that could be pressed by accident while typing is no
 * good for the one key that ends somebody else's control of your computer.
 */

describe('whose choice wins', () => {
  it('is the organisation’s, where they set one', () => {
    expect(effectiveStopChord('Ctrl+Alt+F9', 'Ctrl+Alt+Shift+F12')).toBe('Ctrl+Alt+F9');
    expect(policyChoseChord('Ctrl+Alt+F9')).toBe(true);
  });

  it('is the person’s, while the policy is still at the default', () => {
    expect(policyChoseChord(DEFAULT_STOP_CHORD)).toBe(false);
    expect(effectiveStopChord(DEFAULT_STOP_CHORD, 'Ctrl+Alt+Shift+F12')).toBe('Ctrl+Alt+Shift+F12');
  });

  it('is the default when nobody has chosen', () => {
    expect(effectiveStopChord(DEFAULT_STOP_CHORD, null)).toBe(DEFAULT_STOP_CHORD);
    expect(effectiveStopChord(null, null)).toBe(DEFAULT_STOP_CHORD);
    expect(effectiveStopChord(undefined, '')).toBe(DEFAULT_STOP_CHORD);
  });

  it('never ends up with no chord at all', () => {
    // Whatever arrives — a chord nobody offers, rubbish, an empty string —
    // something still stops control.
    for (const junk of ['', 'nonsense', 'Shift', 'A', 'Ctrl+Alt+Shift+Esc+Esc']) {
      expect(effectiveStopChord(DEFAULT_STOP_CHORD, junk)).toBeTruthy();
    }
  });

  it('ignores a chord that is not one of the offered ones', () => {
    // The list exists because each of its chords is known to register; a
    // free-text chord could silently fail to be held at all.
    expect(effectiveStopChord(DEFAULT_STOP_CHORD, 'Ctrl+Alt+Shift+K')).toBe(DEFAULT_STOP_CHORD);
  });

  it('reads the organisation’s chord however it was written', () => {
    expect(effectiveStopChord('alt+ctrl+shift+escape', null)).toBe('Ctrl+Alt+Shift+Esc');
  });
});

describe('what a person may choose', () => {
  it('offers chords that each say what they cost', () => {
    expect(STOP_CHORD_CHOICES.length).toBeGreaterThan(2);
    expect(STOP_CHORD_CHOICES.every((c) => c.note.length > 0)).toBe(true);
    expect(STOP_CHORD_CHOICES.every((c) => chordRefusal(c.chord) === '')).toBe(true);
    expect(STOP_CHORD_CHOICES[0]!.chord).toBe(DEFAULT_STOP_CHORD);
  });

  it('refuses one modifier, because it has to survive somebody typing', () => {
    expect(chordRefusal('Ctrl+Esc')).toMatch(/at least two modifiers/);
    expect(chordRefusal('Alt+F12')).toMatch(/at least two modifiers/);
  });

  it('refuses a chord with no ordinary key to end it', () => {
    expect(chordRefusal('Ctrl+Alt+Shift')).toMatch(/ends in an ordinary key/);
    expect(chordRefusal('')).toMatch(/ends in an ordinary key/);
  });

  it('refuses a chord the system takes before WorkSuite sees it', () => {
    // Every Tab chord with Alt or the Windows/Command key switches apps —
    // Ctrl+Alt+Tab included, which is the sticky app switcher on Windows.
    expect(chordRefusal('Alt+Shift+Tab')).toMatch(/switches apps/);
    expect(chordRefusal('Ctrl+Alt+Tab')).toMatch(/switches apps/);
    expect(chordRefusal('Meta+Shift+Tab')).toMatch(/switches apps/);
    // Ctrl+Shift+Tab is the browser's, not the system's, and WorkSuite does
    // get to see it — so the rule leaves it alone.
    expect(chordRefusal('Ctrl+Shift+Tab')).toBe('');
  });

  it('says nothing about a chord that is fine', () => {
    expect(chordRefusal('Ctrl+Alt+Shift+Esc')).toBe('');
    expect(chordRefusal('Ctrl+Alt+Shift+F12')).toBe('');
  });
});
