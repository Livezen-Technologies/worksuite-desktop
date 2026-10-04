import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { isMac } from '../../core/bridge';

/**
 * Picking several conversations in a list (worksuite-desktop#183, UX-LIST-02): one way for every chat list —
 * WorkSuite's own conversations in Chat's rail and the Website chats table — so Ctrl/⌘-click, Shift-click, Select
 * mode and Esc behave the same everywhere.
 *
 * - Ctrl/⌘-click toggles a row (and becomes the anchor); with nothing picked yet, the open conversation (`current`)
 *   is picked with it, as a file list does.
 * - Shift-click picks the range from the anchor, in the list's `order`.
 * - In Select mode (`selecting`) a plain click toggles too.
 * - Esc ends it: `escape(e)` from the list's own key handler, or anywhere in the window with `globalEscape`.
 *
 * `onRowClick` answers whether the click was a selection gesture; when it was not, the caller opens the row.
 */
export interface MultiSelectOptions<T> {
  /** The conversation open now, if it is in the list: Ctrl/⌘-clicking another picks both. */
  current?: T | null;
  /** End the selection on Esc pressed anywhere while this list is in front, not only inside it. */
  globalEscape?: boolean;
}

export type PickState = 'none' | 'some' | 'all';

export function useMultiSelect<T extends string | number>(order: readonly T[], opts: MultiSelectOptions<T> = {}) {
  const [picked, setPicked] = useState<T[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [anchor, setAnchor] = useState<T | null>(null);
  const active = picked.length > 0 || selecting;

  const clear = () => {
    setPicked([]);
    setSelecting(false);
    setAnchor(null);
  };

  /** One row in or out of the selection; it becomes the anchor for a Shift-click. */
  const toggle = (id: T) => {
    setAnchor(id);
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  };

  const onRowClick = (e: Pick<ReactMouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>, id: T): boolean => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.shiftKey && anchor !== null) {
      const from = order.indexOf(anchor);
      const to = order.indexOf(id);
      if (from >= 0 && to >= 0) {
        setPicked(order.slice(Math.min(from, to), Math.max(from, to) + 1));
        return true;
      }
    }
    if (mod || selecting) {
      setAnchor(id);
      const current = opts.current ?? null;
      // Ctrl-clicking a second conversation picks the open one too, as a file list does.
      const base = picked.length === 0 && !selecting && current !== null && current !== id ? [current] : picked;
      setPicked(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
      return true;
    }
    setAnchor(id);
    if (picked.length) setPicked([]);
    return false;
  };

  const isPicked = (id: T) => picked.includes(id);
  const visible = picked.filter((id) => order.includes(id));
  const state: PickState = visible.length === 0 ? 'none' : visible.length === order.length ? 'all' : 'some';
  /** Every row in the list, or none: the header checkbox. */
  const selectAll = () => setPicked([...order]);
  const none = () => setPicked([]);
  const toggleAll = () => (state === 'all' ? none() : selectAll());

  /** Esc from the list's own key handler: true when it ended a selection. */
  const escape = (e: Pick<ReactKeyboardEvent | KeyboardEvent, 'key'>): boolean => {
    if (e.key !== 'Escape' || !active) return false;
    clear();
    return true;
  };

  const global = !!opts.globalEscape && active;
  useEffect(() => {
    if (!global) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A menu or a dialog takes its own Esc first.
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      setPicked([]);
      setSelecting(false);
      setAnchor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [global]);

  return { picked, setPicked, visible, state, selecting, setSelecting, active, anchor, isPicked, toggle, selectAll, none, toggleAll, onRowClick, clear, escape };
}
