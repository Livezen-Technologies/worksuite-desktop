import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { scrollFades } from '@shared/launcher';

type Fades = { top: boolean; bottom: boolean };

/**
 * Which scroll fades a scroller should draw: each only while there is more past that edge (the launcher's
 * `scrollFades`, worksuite-desktop#233; the Settings sidebar, #246). Give the scroller `ref` and `onScroll`; it looks
 * again on scroll, after every render, and when the scroller or what is in it changes size (the window, fonts).
 */
export function useScrollFades<T extends HTMLElement>(): { ref: (el: T | null) => void; fades: Fades; onScroll: () => void } {
  const node = useRef<T | null>(null);
  const [el, setEl] = useState<T | null>(null);
  const [fades, setFades] = useState<Fades>({ top: false, bottom: false });
  const onScroll = useCallback(() => {
    const next = scrollFades(node.current);
    setFades((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
  }, []);
  const ref = useCallback((next: T | null) => {
    node.current = next;
    setEl(next);
  }, []);
  // What is listed may change on any render; unchanged fades keep the same state, so this settles at once.
  useLayoutEffect(onScroll);
  useEffect(() => {
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => onScroll());
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [el, onScroll]);
  return { ref, fades, onScroll };
}
