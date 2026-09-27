import { useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';

/**
 * Drag-to-select (a marquee), as Finder and Drive do it: press on empty space
 * in the list or grid and drag, and every item the rectangle touches is
 * chosen. Shift or ⌘/Ctrl adds to what was already chosen; a plain click on
 * empty space lets go of the selection. Pressing on an item still starts the
 * item's own drag (to move it into a folder), so the two never meet.
 *
 * Positions are in the scrolling container's content coordinates, so the
 * rectangle stays put under the pointer while the list scrolls beneath it.
 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Box extends Rect {
  key: string;
}

/** The rectangle between two points, whichever way it was dragged. */
export const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) });

/** The items a rectangle touches — any overlap counts, as in Finder. */
export const within = (r: Rect, boxes: Box[]): string[] => boxes.filter((b) => b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top).map((b) => b.key);

/** Below this many pixels of travel a press is a click, not a drag. */
export const THRESHOLD = 4;

/** What a press on these is for, so it never starts a marquee. */
const NOT_SPACE = '[data-row], button, input, textarea, select, a, label, [role="menu"], [role="dialog"]';

export function useMarquee<K extends string>(ref: RefObject<HTMLElement | null>, { selected, onChange }: { selected: Set<K>; onChange: (next: Set<K>) => void }) {
  const [rect, setRect] = useState<Rect | null>(null);

  const onMouseDown = (e: ReactMouseEvent) => {
    const el = ref.current;
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest(NOT_SPACE)) return;
    const frame = el.getBoundingClientRect();
    // The scrollbar is inside the box but is not space to select from.
    if (e.clientX >= frame.left + el.clientWidth || e.clientY >= frame.top + el.clientHeight) return;
    e.preventDefault();
    // Pressing on the page takes the caret out of the search box, as a click would.
    const typing = document.activeElement as HTMLElement | null;
    if (typing && ['INPUT', 'TEXTAREA'].includes(typing.tagName)) typing.blur();

    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? new Set(selected) : new Set<K>();
    const at = (x: number, y: number) => {
      const b = el.getBoundingClientRect();
      return { x: x - b.left + el.scrollLeft, y: y - b.top + el.scrollTop };
    };
    const boxes = (): Box[] => {
      const b = el.getBoundingClientRect();
      return [...el.querySelectorAll<HTMLElement>('[data-row]')].map((n) => {
        const r = n.getBoundingClientRect();
        return { key: n.dataset.row ?? '', left: r.left - b.left + el.scrollLeft, top: r.top - b.top + el.scrollTop, right: r.right - b.left + el.scrollLeft, bottom: r.bottom - b.top + el.scrollTop };
      });
    };
    const start = at(e.clientX, e.clientY);
    let moved = false;

    const move = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < THRESHOLD) return;
      moved = true;
      // Near the top or bottom edge the list scrolls, to reach what is beyond it.
      const b = el.getBoundingClientRect();
      if (ev.clientY < b.top + 24) el.scrollTop -= 16;
      else if (ev.clientY > b.bottom - 24) el.scrollTop += 16;
      const r = rectOf(start, at(ev.clientX, ev.clientY));
      setRect(r);
      const next = new Set(base);
      for (const k of within(r, boxes())) next.add(k as K);
      onChange(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setRect(null);
      if (!moved && !additive) onChange(new Set());
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return { rect, onMouseDown };
}
