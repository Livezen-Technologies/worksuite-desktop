import type { InputAction, Rect } from './input';
import { KEYS, MODIFIERS, comboCodes, isModifier } from './keys';

/**
 * From a controller's message to what the input helper does (§E.3).
 *
 * Coordinates arrive as 0–1 across the shared picture. For a screen they
 * land inside that display's bounds (in the system's coordinates, converted
 * by the caller); for a window, inside the window's rectangle as it is now.
 * Nothing can be placed outside the shared surface: out-of-range values were
 * refused before this, and the result is clamped to the last pixel inside.
 */

export interface Point {
  x: number;
  y: number;
}

/** The point on `rect` at (nx, ny), never outside it. */
export function place(nx: number, ny: number, rect: Rect): Point {
  const x = rect.x + Math.min(Math.max(nx, 0), 1) * Math.max(0, rect.width - 1);
  const y = rect.y + Math.min(Math.max(ny, 0), 1) * Math.max(0, rect.height - 1);
  return { x: Math.round(x), y: Math.round(y) };
}

/** Wheel pixels as the controller's browser measured them → wheel units (120 a notch). */
export function wheelUnits(px: number): number {
  const n = Number(px);
  if (!Number.isFinite(n) || n === 0) return 0;
  return Math.max(-2400, Math.min(2400, Math.round(n * 1.2)));
}

const BUTTONS = new Set(['left', 'middle', 'right']);

/**
 * Keys and buttons this computer is holding down for the controller, so they
 * can all be let go at once — on pause, stop, the local person moving the
 * mouse, or a controller whose key-up never arrived.
 */
export class Held {
  keys = new Set<string>();
  buttons = new Set<'left' | 'middle' | 'right'>();

  releaseAll(): InputAction[] {
    const out: InputAction[] = [];
    for (const b of this.buttons) out.push({ t: 'button', button: b, down: false });
    for (const k of [...this.keys].reverse()) out.push({ t: 'key', code: k, down: false });
    this.keys.clear();
    this.buttons.clear();
    return out;
  }
}

/** A controller's pointer message, in the helper's space. `at` is where the pointer goes first. */
export function pointerActions(type: 'ptr.move' | 'ptr.button' | 'ptr.wheel', payload: Record<string, unknown>, at: Point | null, held: Held): InputAction[] {
  const out: InputAction[] = [];
  if (at) out.push({ t: 'move', x: at.x, y: at.y });
  if (type === 'ptr.button') {
    const button = String(payload.button ?? 'left');
    if (!BUTTONS.has(button)) return out;
    const b = button as 'left' | 'middle' | 'right';
    const down = payload.down === true;
    // A second "down" without an "up" is not pressed twice; an "up" for a button not held is dropped.
    if (down === held.buttons.has(b)) return out;
    if (down) held.buttons.add(b);
    else held.buttons.delete(b);
    out.push({ t: 'button', button: b, down });
  } else if (type === 'ptr.wheel') {
    const dx = wheelUnits(Number(payload.dx ?? 0));
    const dy = wheelUnits(Number(payload.dy ?? 0));
    if (dx || dy) out.push({ t: 'wheel', dx, dy });
  }
  return out;
}

/**
 * A controller's key message. The key is pressed or let go by its code; the
 * modifier flags it carries let go of any modifier this computer still holds
 * that the controller no longer does (its key-up was lost, say, when its
 * window lost focus). Text is typed as text.
 */
export function keyActions(payload: Record<string, unknown>, held: Held): InputAction[] {
  if (typeof payload.text === 'string') return payload.text ? [{ t: 'text', text: payload.text }] : [];
  const code = typeof payload.code === 'string' ? payload.code : '';
  if (!KEYS[code]) return [];
  const down = payload.down === true;
  const out: InputAction[] = [];
  for (const [flag, codes] of Object.entries(MODIFIERS) as Array<[keyof typeof MODIFIERS, readonly string[]]>) {
    if (payload[flag] === true || codes.includes(code)) continue;
    for (const c of codes) {
      if (held.keys.has(c)) {
        held.keys.delete(c);
        out.push({ t: 'key', code: c, down: false });
      }
    }
  }
  if (down) {
    // Auto-repeat arrives as repeated downs: pass them on, as the keyboard would.
    held.keys.add(code);
    out.push({ t: 'key', code, down: true });
  } else if (held.keys.has(code) || isModifier(code)) {
    held.keys.delete(code);
    out.push({ t: 'key', code, down: false });
  }
  return out;
}

/** A special-key menu item: pressed in order, let go in reverse. Unknown chords do nothing. */
export function comboActions(combo: string): InputAction[] {
  const codes = comboCodes(combo);
  if (!codes) return [];
  return [...codes.map((code): InputAction => ({ t: 'key', code, down: true })), ...[...codes].reverse().map((code): InputAction => ({ t: 'key', code, down: false }))];
}
