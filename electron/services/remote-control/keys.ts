/**
 * Physical keys by `KeyboardEvent.code`, as each system's input API names them.
 *
 * The controller sends the key it pressed, not the character it made, so a
 * shortcut means the same on both ends whatever the keyboard layouts (the
 * controller can switch to sending text for a layout that differs). Only keys
 * in this table are ever injected; anything else is dropped.
 *
 *   win — a Windows virtual-key code; `ext` marks the extended keys
 *   mac — a macOS virtual key code (kVK_…)
 *   x11 — an X keysym name, as xdotool takes it
 */
export interface KeyCodes {
  win: number;
  ext?: boolean;
  mac: number;
  x11: string;
}

const LETTER_MAC: Record<string, number> = {
  A: 0x00, S: 0x01, D: 0x02, F: 0x03, H: 0x04, G: 0x05, Z: 0x06, X: 0x07, C: 0x08, V: 0x09, B: 0x0b, Q: 0x0c, W: 0x0d, E: 0x0e, R: 0x0f,
  Y: 0x10, T: 0x11, O: 0x1f, U: 0x20, I: 0x22, P: 0x23, L: 0x25, J: 0x26, K: 0x28, N: 0x2d, M: 0x2e,
};
const DIGIT_MAC = [0x1d, 0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1a, 0x1c, 0x19];
const NUMPAD_MAC = [0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5b, 0x5c];
const F_MAC = [0x7a, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6d, 0x67, 0x6f, 0x69, 0x6b, 0x71, 0x6a, 0x40, 0x4f, 0x50, 0x5a];

function table(): Record<string, KeyCodes> {
  // No prototype: `KEYS['constructor']` and the like must be undefined, not a function.
  const t = Object.create(null) as Record<string, KeyCodes>;
  for (const [l, mac] of Object.entries(LETTER_MAC)) t[`Key${l}`] = { win: l.charCodeAt(0), mac, x11: l.toLowerCase() };
  for (let d = 0; d <= 9; d++) {
    t[`Digit${d}`] = { win: 0x30 + d, mac: DIGIT_MAC[d]!, x11: String(d) };
    t[`Numpad${d}`] = { win: 0x60 + d, mac: NUMPAD_MAC[d]!, x11: `KP_${d}` };
  }
  for (let f = 1; f <= 20; f++) t[`F${f}`] = { win: 0x6f + f, mac: F_MAC[f - 1]!, x11: `F${f}` };
  Object.assign(t, {
    Enter: { win: 0x0d, mac: 0x24, x11: 'Return' },
    Escape: { win: 0x1b, mac: 0x35, x11: 'Escape' },
    Backspace: { win: 0x08, mac: 0x33, x11: 'BackSpace' },
    Tab: { win: 0x09, mac: 0x30, x11: 'Tab' },
    Space: { win: 0x20, mac: 0x31, x11: 'space' },
    ShiftLeft: { win: 0xa0, mac: 0x38, x11: 'Shift_L' },
    ShiftRight: { win: 0xa1, mac: 0x3c, x11: 'Shift_R' },
    ControlLeft: { win: 0xa2, mac: 0x3b, x11: 'Control_L' },
    ControlRight: { win: 0xa3, ext: true, mac: 0x3e, x11: 'Control_R' },
    AltLeft: { win: 0xa4, mac: 0x3a, x11: 'Alt_L' },
    AltRight: { win: 0xa5, ext: true, mac: 0x3d, x11: 'Alt_R' },
    MetaLeft: { win: 0x5b, ext: true, mac: 0x37, x11: 'Super_L' },
    MetaRight: { win: 0x5c, ext: true, mac: 0x36, x11: 'Super_R' },
    CapsLock: { win: 0x14, mac: 0x39, x11: 'Caps_Lock' },
    ContextMenu: { win: 0x5d, ext: true, mac: 0x6e, x11: 'Menu' },
    ArrowLeft: { win: 0x25, ext: true, mac: 0x7b, x11: 'Left' },
    ArrowUp: { win: 0x26, ext: true, mac: 0x7e, x11: 'Up' },
    ArrowRight: { win: 0x27, ext: true, mac: 0x7c, x11: 'Right' },
    ArrowDown: { win: 0x28, ext: true, mac: 0x7d, x11: 'Down' },
    Insert: { win: 0x2d, ext: true, mac: 0x72, x11: 'Insert' },
    Delete: { win: 0x2e, ext: true, mac: 0x75, x11: 'Delete' },
    Home: { win: 0x24, ext: true, mac: 0x73, x11: 'Home' },
    End: { win: 0x23, ext: true, mac: 0x77, x11: 'End' },
    PageUp: { win: 0x21, ext: true, mac: 0x74, x11: 'Prior' },
    PageDown: { win: 0x22, ext: true, mac: 0x79, x11: 'Next' },
    Minus: { win: 0xbd, mac: 0x1b, x11: 'minus' },
    Equal: { win: 0xbb, mac: 0x18, x11: 'equal' },
    BracketLeft: { win: 0xdb, mac: 0x21, x11: 'bracketleft' },
    BracketRight: { win: 0xdd, mac: 0x1e, x11: 'bracketright' },
    Backslash: { win: 0xdc, mac: 0x2a, x11: 'backslash' },
    Semicolon: { win: 0xba, mac: 0x29, x11: 'semicolon' },
    Quote: { win: 0xde, mac: 0x27, x11: 'apostrophe' },
    Backquote: { win: 0xc0, mac: 0x32, x11: 'grave' },
    Comma: { win: 0xbc, mac: 0x2b, x11: 'comma' },
    Period: { win: 0xbe, mac: 0x2f, x11: 'period' },
    Slash: { win: 0xbf, mac: 0x2c, x11: 'slash' },
    IntlBackslash: { win: 0xe2, mac: 0x0a, x11: 'less' },
    NumpadMultiply: { win: 0x6a, mac: 0x43, x11: 'KP_Multiply' },
    NumpadAdd: { win: 0x6b, mac: 0x45, x11: 'KP_Add' },
    NumpadSubtract: { win: 0x6d, mac: 0x4e, x11: 'KP_Subtract' },
    NumpadDecimal: { win: 0x6e, mac: 0x41, x11: 'KP_Decimal' },
    NumpadDivide: { win: 0x6f, ext: true, mac: 0x4b, x11: 'KP_Divide' },
    NumpadEnter: { win: 0x0d, ext: true, mac: 0x4c, x11: 'KP_Enter' },
    NumLock: { win: 0x90, ext: true, mac: 0x47, x11: 'Num_Lock' },
    ScrollLock: { win: 0x91, mac: 0x6b, x11: 'Scroll_Lock' },
    Pause: { win: 0x13, mac: 0x71, x11: 'Pause' },
    PrintScreen: { win: 0x2c, ext: true, mac: 0x69, x11: 'Print' },
  } satisfies Record<string, KeyCodes>);
  return t;
}

export const KEYS: Readonly<Record<string, KeyCodes>> = Object.freeze(table());

/** A key this table knows, and only such a key. */
export function keyOf(code: unknown): KeyCodes | null {
  return typeof code === 'string' && Object.hasOwn(KEYS, code) ? KEYS[code]! : null;
}

/** The modifier keys, by the flag the controller's key events carry. */
export const MODIFIERS = {
  ctrl: ['ControlLeft', 'ControlRight'],
  alt: ['AltLeft', 'AltRight'],
  shift: ['ShiftLeft', 'ShiftRight'],
  meta: ['MetaLeft', 'MetaRight'],
} as const;

export function isModifier(code: string): boolean {
  return Object.values(MODIFIERS).some((list) => (list as readonly string[]).includes(code));
}

/** Special-key menu words (`Alt+Tab`, `Meta`, `Esc`) → the codes pressed, in order. */
export function comboCodes(combo: string): string[] | null {
  const names: Record<string, string> = { Ctrl: 'ControlLeft', Alt: 'AltLeft', Shift: 'ShiftLeft', Meta: 'MetaLeft', Esc: 'Escape', Tab: 'Tab', Enter: 'Enter', Space: 'Space', Delete: 'Delete', Del: 'Delete' };
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 5) return null;
  const codes: string[] = [];
  for (const p of parts) {
    const code = (Object.hasOwn(names, p) ? names[p] : undefined) ?? (/^[A-Z]$/.test(p) ? `Key${p}` : /^[0-9]$/.test(p) ? `Digit${p}` : /^F([1-9]|1[0-9]|20)$/.test(p) ? p : null);
    if (!code || !keyOf(code)) return null;
    codes.push(code);
  }
  return codes;
}
