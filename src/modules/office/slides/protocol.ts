/**
 * How the windows of a slideshow talk (worksuite-desktop#321): the window the show was started from (the "host",
 * which holds the deck), the slideshow on the screen the audience sees, and the presenter view on the laptop.
 * All are windows of the app on its own origin, so a BroadcastChannel named for the show joins them; nothing leaves
 * the computer. Every message is checked here before it is acted on.
 */
export const SHOW_ID = /^[A-Za-z0-9-]{8,64}$/;

export const channelName = (id: string): string => `ws-slides:${id}`;

export type ShowRole = 'show' | 'presenter';

export type ShowMessage =
  /** A window opened and wants the deck. */
  | { t: 'hello'; role: ShowRole }
  /** The deck, from the host. */
  | { t: 'deck'; name: string; bytes: Uint8Array; index: number }
  /** The deck could not be handed over. */
  | { t: 'gone' }
  /** Go to a slide (any window to the others). */
  | { t: 'goto'; index: number }
  /** The screen goes black, or comes back. */
  | { t: 'black'; on: boolean }
  /** The laser pointer, as a fraction of the slide (0–1), or off. */
  | { t: 'laser'; x: number; y: number }
  | { t: 'laserOff' }
  /** The show ended, on this slide. */
  | { t: 'end'; index: number };

const MAX_DECK_BYTES = 200 * 1024 * 1024;

const unit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const slide = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 100_000;

export function parseShowMessage(raw: unknown): ShowMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return m.role === 'show' || m.role === 'presenter' ? { t: 'hello', role: m.role } : null;
    case 'deck':
      if (!(m.bytes instanceof Uint8Array) || m.bytes.byteLength === 0 || m.bytes.byteLength > MAX_DECK_BYTES || !slide(m.index)) return null;
      return { t: 'deck', name: typeof m.name === 'string' ? m.name.slice(0, 255) : 'Presentation', bytes: m.bytes, index: m.index };
    case 'gone':
      return { t: 'gone' };
    case 'goto':
      return slide(m.index) ? { t: 'goto', index: m.index } : null;
    case 'black':
      return typeof m.on === 'boolean' ? { t: 'black', on: m.on } : null;
    case 'laser':
      return unit(m.x) && unit(m.y) ? { t: 'laser', x: m.x, y: m.y } : null;
    case 'laserOff':
      return { t: 'laserOff' };
    case 'end':
      return slide(m.index) ? { t: 'end', index: m.index } : null;
    default:
      return null;
  }
}

/** The show's id and role from a slideshow window's address (`#/window/slideshow?id=…` or `#/window/presenter?id=…`). */
export function showFromHash(hash: string): { id: string; role: ShowRole } | null {
  const m = /^#\/window\/(slideshow|presenter)\?(.*)$/.exec(hash);
  if (!m) return null;
  const id = new URLSearchParams(m[2]).get('id') ?? '';
  if (!SHOW_ID.test(id)) return null;
  return { id, role: m[1] === 'presenter' ? 'presenter' : 'show' };
}
