/**
 * The keys of the slide viewer and the slideshow (worksuite-desktop#321). Pure: a key press in, what it does out.
 *
 * Viewer: ← → / ↑ ↓ / Page Up / Page Down / Space change slides, Home / End go to the first and last, ⌘+ ⌘− ⌘0
 * zoom (Ctrl elsewhere), ⌘⏎ or F5 present from the start, ⇧⌘⏎ or ⇧F5 from the current slide.
 * Slideshow: click / → / Space / Page Down next, ← / Page Up / Backspace back, Esc ends; L the laser pointer, B black.
 */
export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type NavAction = 'next' | 'prev' | 'first' | 'last';

export type ViewerAction =
  | { type: NavAction }
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'zoomReset' }
  | { type: 'present'; fromCurrent: boolean };

export type ShowAction = { type: NavAction } | { type: 'exit' } | { type: 'laser' } | { type: 'black' };

/** Whether the "command" key is down: ⌘ on a Mac, Ctrl elsewhere. */
export const modKey = (e: KeyLike, mac: boolean): boolean => (mac ? !!e.metaKey : !!e.ctrlKey);

/** The present shortcuts, shared by the viewer and the editor: ⌘⏎ / F5 from the start, ⇧⌘⏎ / ⇧F5 from here. */
export function presentShortcut(e: KeyLike, mac: boolean): { fromCurrent: boolean } | null {
  if (e.altKey) return null;
  if (e.key === 'F5' && !e.metaKey && !e.ctrlKey) return { fromCurrent: !!e.shiftKey };
  if (e.key === 'Enter' && modKey(e, mac)) return { fromCurrent: !!e.shiftKey };
  return null;
}

function nav(e: KeyLike): NavAction | null {
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return 'next';
    case ' ':
    case 'Spacebar':
      return e.shiftKey ? 'prev' : 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

export function viewerAction(e: KeyLike, mac: boolean): ViewerAction | null {
  const present = presentShortcut(e, mac);
  if (present) return { type: 'present', ...present };
  if (modKey(e, mac) && !e.altKey) {
    if (e.key === '+' || e.key === '=') return { type: 'zoomIn' };
    if (e.key === '-' || e.key === '_') return { type: 'zoomOut' };
    if (e.key === '0') return { type: 'zoomReset' };
    return null;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const n = nav(e);
  return n ? { type: n } : null;
}

export function showAction(e: KeyLike): ShowAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === 'Escape') return { type: 'exit' };
  if (e.key === 'Enter' || e.key === 'n' || e.key === 'N') return { type: 'next' };
  if (e.key === 'Backspace' || e.key === 'p' || e.key === 'P') return { type: 'prev' };
  if (e.key === 'l' || e.key === 'L') return { type: 'laser' };
  if (e.key === 'b' || e.key === 'B' || e.key === '.') return { type: 'black' };
  const n = nav(e);
  return n ? { type: n } : null;
}

/** A key typed into a field is the field's, never a slide change. */
export function typingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}
