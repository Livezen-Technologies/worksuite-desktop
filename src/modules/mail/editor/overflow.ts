import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * A row of buttons that never overflows (worksuite-desktop#188): what does
 * not fit goes into a "More" menu at the end. Each button's width is
 * measured while it shows and remembered, so the row can be worked out
 * again whenever the space changes (a ResizeObserver on the row) without
 * putting everything back first.
 */

/** How many items, from the start, fit in `available` px — leaving room for the More button when not all do. */
export function fitCount(widths: number[], available: number, moreWidth: number, gap = 0, separators: boolean[] = []): number {
  const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available) return widths.length;
  let used = moreWidth;
  let n = 0;
  for (const w of widths) {
    if (used + w + gap > available) break;
    used += w + gap;
    n++;
  }
  // A divider is never the last thing before More.
  while (n > 0 && separators[n - 1]) n--;
  return n;
}

/**
 * The number of `keys` that fit in the row `ref`. Items carry
 * `data-ov="<key>"`; they are measured whenever they show.
 */
export function useOverflow(ref: RefObject<HTMLElement | null>, keys: string[], opts: { moreWidth?: number; gap?: number; reserve?: number; epoch?: number } = {}): number {
  const widths = useRef(new Map<string, number>());
  const [count, setCount] = useState(keys.length);
  const sig = keys.join('|');
  const { moreWidth = 36, gap = 2, reserve = 0, epoch = 0 } = opts;
  useLayoutEffect(() => {
    const list = sig ? sig.split('|') : [];
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      el.querySelectorAll<HTMLElement>('[data-ov]').forEach((item) => {
        const w = item.offsetWidth;
        if (w > 0) widths.current.set(item.dataset.ov!, w);
      });
      const available = el.clientWidth - reserve;
      // Not laid out (hidden, or a test without layout): everything shows.
      if (available <= 0) return setCount(list.length);
      setCount(fitCount(list.map((k) => widths.current.get(k) ?? (k.startsWith('sep') ? 9 : 34)), available, moreWidth, gap, list.map((k) => k.startsWith('sep'))));
    };
    compute();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    return () => ro.disconnect();
    // `epoch`: the buttons changed size (their captions came or went), so they are measured again.
  }, [ref, sig, moreWidth, gap, reserve, epoch]);
  return Math.min(count, keys.length);
}

/**
 * Captions first, then icons alone, then More (worksuite-desktop#213): true
 * while the row is narrower than its buttons need with their captions. The
 * captioned widths are remembered from when they last showed, so the row
 * takes its captions back as soon as there is room for them again.
 */
export function useCompact(ref: RefObject<HTMLElement | null>, keys: string[], enabled: boolean, gap = 2): boolean {
  const labelled = useRef(new Map<string, number>());
  const [compact, setCompact] = useState(false);
  const sig = keys.join('|');
  useLayoutEffect(() => {
    if (!enabled) return;
    const list = sig ? sig.split('|') : [];
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      const available = el.clientWidth;
      if (available <= 0) return setCompact(false);
      setCompact((was) => {
        if (!was) {
          el.querySelectorAll<HTMLElement>('[data-ov]').forEach((item) => {
            const w = item.offsetWidth;
            if (w > 0) labelled.current.set(item.dataset.ov!, w);
          });
        }
        const need = list.reduce((n, k) => n + (labelled.current.get(k) ?? (k.startsWith('sep') ? 9 : 96)), 0) + gap * Math.max(0, list.length - 1);
        return need > available;
      });
    };
    compute();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, sig, enabled, gap]);
  return enabled && compact;
}
