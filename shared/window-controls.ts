/**
 * The window's own buttons on Linux (worksuite-desktop#409). Electron's drawn-over controls (`titleBarOverlay`) sit
 * out of line with our bar on GNOME desktops such as Zorin OS, change with the scaling setting and ignore where the
 * desktop puts its buttons, so on Linux the title bar draws minimise, maximise and close itself, in the order and
 * on the side GNOME's `org.gnome.desktop.wm.preferences button-layout` gives ("appmenu:minimize,maximize,close").
 */
export type WindowButton = 'minimize' | 'maximize' | 'close';

export interface ButtonLayout {
  /** The side the buttons sit on. */
  side: 'left' | 'right';
  /** Left to right. Empty: the desktop shows none (the bar still moves the window, double-click still maximises). */
  buttons: WindowButton[];
}

/** GNOME's default, and what a desktop that says nothing gets. */
export const DEFAULT_BUTTON_LAYOUT: ButtonLayout = { side: 'right', buttons: ['minimize', 'maximize', 'close'] };

const KNOWN = new Set<string>(['minimize', 'maximize', 'close']);

/**
 * `gsettings get org.gnome.desktop.wm.preferences button-layout` → where the buttons go. The value is
 * "<left>:<right>", each a comma list; quoted as gsettings prints it. Buttons we do not draw (appmenu, menu, icon,
 * spacer) are skipped. The side with close wins, else the side with any button; nothing readable → the default.
 */
export function parseButtonLayout(raw: string | null | undefined): ButtonLayout {
  const value = (raw ?? '').trim().replace(/^'(.*)'$/s, '$1').trim();
  if (!value.includes(':')) return DEFAULT_BUTTON_LAYOUT;
  const [left = '', right = ''] = value.split(':', 2);
  const pick = (s: string): WindowButton[] => {
    const seen = new Set<WindowButton>();
    for (const part of s.split(',')) {
      const b = part.trim();
      if (KNOWN.has(b)) seen.add(b as WindowButton);
    }
    return [...seen];
  };
  const l = pick(left);
  const r = pick(right);
  if (r.includes('close') || (r.length && !l.includes('close'))) return { side: 'right', buttons: r };
  if (l.length) return { side: 'left', buttons: l };
  // Both sides empty (":"): the person turned the buttons off.
  return { side: 'right', buttons: [] };
}
