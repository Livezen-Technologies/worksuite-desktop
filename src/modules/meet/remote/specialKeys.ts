/**
 * The special-key menu (WS-MEET-ENH-01 RC-KBD-04): what can be sent, per the sharer's platform.
 *
 * Alt+Tab, the Windows or Command key, Esc and the task manager everywhere it
 * exists; Ctrl+Alt+Delete only on Windows, where the desktop has a secure
 * equivalent to raise it. What the platform cannot take is not offered, and
 * the menu says so instead of leaving somebody to wonder. The emergency stop
 * and lock chords are never on it — the sharer's desktop refuses them anyway.
 * The same list as the web's.
 */

export interface SpecialKey {
  label: string;
  /** The chord sent, in `chordOf()` form. */
  combo: string;
  /** How the key is written on that platform. */
  hint: string;
}

export function platformName(p: string | null | undefined): string {
  switch (p) {
    case 'macos':
      return 'Mac';
    case 'windows':
      return 'Windows PC';
    case 'linux':
      return 'Linux computer';
    default:
      return 'computer';
  }
}

export function specialKeys(platform: string | null | undefined): { available: SpecialKey[]; notes: string[] } {
  if (platform === 'macos') {
    return {
      available: [
        { label: 'Command + Tab', combo: 'Meta+Tab', hint: '⌘⇥' },
        { label: 'Command', combo: 'Meta', hint: '⌘' },
        { label: 'Escape', combo: 'Esc', hint: 'esc' },
        { label: 'Force quit…', combo: 'Alt+Meta+Esc', hint: '⌥⌘esc' },
      ],
      notes: ["Ctrl+Alt+Delete isn't available on macOS."],
    };
  }

  if (platform === 'linux') {
    return {
      available: [
        { label: 'Alt + Tab', combo: 'Alt+Tab', hint: 'Alt+Tab' },
        { label: 'Super', combo: 'Meta', hint: 'Super' },
        { label: 'Escape', combo: 'Esc', hint: 'Esc' },
      ],
      notes: ["Ctrl+Alt+Delete isn't sent to Linux desktops — each one does something different with it."],
    };
  }

  return {
    available: [
      { label: 'Alt + Tab', combo: 'Alt+Tab', hint: 'Alt+Tab' },
      { label: 'Windows key', combo: 'Meta', hint: '⊞' },
      { label: 'Escape', combo: 'Esc', hint: 'Esc' },
      { label: 'Task Manager', combo: 'Ctrl+Shift+Esc', hint: 'Ctrl+Shift+Esc' },
      { label: 'Ctrl + Alt + Delete', combo: 'Ctrl+Alt+Delete', hint: 'Ctrl+Alt+Del' },
    ],
    notes: ["Ctrl+Alt+Delete is raised by WorkSuite Desktop through Windows' secure path; the sign-in screen it opens is never controlled."],
  };
}
