import { useState } from 'react';

/**
 * Picking several rows of a list (worksuite-desktop#290): the gestures every list with a checkbox on each row shares.
 *
 * - A row's checkbox, or Ctrl/⌘-click on the row, ticks or unticks that row; it becomes the anchor.
 * - Shift-click (on the row or its checkbox) adds every row from the anchor to the one clicked. With no anchor yet,
 *   the range starts at `from` — the row open now — so Shift-clicking after opening a message picks the run between.
 * - `state` is the Select-all box over the list: none, some or all of the rows listed. `toggleAll` ticks every row,
 *   or clears them when all are ticked already.
 * - `escape(e)`, from the list's own key handler, clears the selection and says whether there was one to clear.
 *
 * `selecting` is true while anything is picked: every row then shows its checkbox, not only the one under the mouse.
 * A key picked and then filtered out of `order` stays picked until cleared, but does not count towards `state`.
 */
export type SelectState = 'none' | 'some' | 'all';

/** How a row was picked: on its own (`toggle`), or the run from the anchor to it (`range`). */
export type PickHow = 'toggle' | 'range';

/** The pick a click with these keys held asks for: Ctrl/⌘ toggles, Shift picks a range; a plain click is none. */
export function pickOf(e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }): PickHow | null {
  if (e.metaKey || e.ctrlKey) return 'toggle';
  if (e.shiftKey) return 'range';
  return null;
}

export function useListSelection<K extends string | number>(order: readonly K[]) {
  const [selected, setSelected] = useState<ReadonlySet<K>>(() => new Set());
  const [anchor, setAnchor] = useState<K | null>(null);

  /** One row in or out — or, for a range, the run from the anchor (else `from`) to it, added to what is picked. */
  const pick = (key: K, how: PickHow, from: K | null = null) => {
    const start = how === 'range' ? (anchor ?? from) : null;
    setSelected((now) => {
      const next = new Set(now);
      const a = start === null ? -1 : order.indexOf(start);
      const b = order.indexOf(key);
      if (a >= 0 && b >= 0) for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(k);
      else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setAnchor(key);
  };

  const listed = order.reduce((n, k) => (selected.has(k) ? n + 1 : n), 0);
  const state: SelectState = listed === 0 ? 'none' : listed === order.length ? 'all' : 'some';
  const selectAll = () => setSelected(new Set(order));
  const clear = () => {
    setSelected(new Set());
    setAnchor(null);
  };
  const toggleAll = () => (state === 'all' ? clear() : selectAll());

  /** Esc from the list's key handler: true when it cleared a selection. */
  const escape = (e: { key: string }): boolean => {
    if (e.key !== 'Escape' || selected.size === 0) return false;
    clear();
    return true;
  };

  return { selected, setSelected, anchor, pick, state, selecting: selected.size > 0, selectAll, clear, toggleAll, escape };
}
