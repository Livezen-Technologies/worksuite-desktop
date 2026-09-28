/**
 * Dragging for multi-window docking (FR-NAV-05/07): a tab dragged out of the
 * strip, and a torn-off window's handle dragged back onto the main window.
 *
 * The drag carries only an id — a tab's in this window, or a window's — and
 * never a route: what a dropped window shows is asked of the main process.
 */
export const TAB_DRAG = 'application/x-worksuite-tab';
export const WINDOW_DRAG = 'application/x-worksuite-window';

export function dragHas(e: { dataTransfer: DataTransfer | null }, type: string): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes(type);
}

/** A window id from a dropped handle, or null for anything else. */
export function droppedWindow(e: { dataTransfer: DataTransfer | null }): number | null {
  const raw = e.dataTransfer?.getData(WINDOW_DRAG) ?? '';
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

/*
 * Letting go of a tab outside the window tears it off. Inside, the window
 * takes any tab drag (so letting go over the page is a drop, not "nowhere");
 * outside, nothing does. Where it was let go is judged by the screen point
 * the drag ended at — Linux reports 0,0 for it, and then by whether the
 * pointer left the window and did not come back: `dragover` fires over the
 * window as long as the pointer is on it, and `dragleave` with nothing to go
 * to is the window's edge.
 */
let inside = true;
let watching = false;

export function watchDragPointer(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener(
    'dragover',
    (e) => {
      inside = true;
      if (!dragHas(e, TAB_DRAG)) return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.dropEffect === 'none') e.dataTransfer.dropEffect = 'move';
    },
    true,
  );
  window.addEventListener(
    'drop',
    (e) => {
      inside = true;
      if (dragHas(e, TAB_DRAG)) e.preventDefault();
    },
    true,
  );
  document.addEventListener(
    'dragleave',
    (e) => {
      if (e.relatedTarget === null) inside = false;
    },
    true,
  );
  window.addEventListener('dragstart', () => (inside = true), true);
}

/** Where on the screen a drag ended, when the platform says. */
export function dropPoint(e: { screenX: number; screenY: number }): { x: number; y: number } | undefined {
  return e.screenX === 0 && e.screenY === 0 ? undefined : { x: e.screenX, y: e.screenY };
}

/** Whether a drag ended outside this window. */
export function releasedOutside(e: { screenX: number; screenY: number }): boolean {
  const at = dropPoint(e);
  if (!at) return !inside;
  const { screenX: x, screenY: y, outerWidth: w, outerHeight: h } = window;
  return at.x < x || at.y < y || at.x >= x + w || at.y >= y + h;
}
