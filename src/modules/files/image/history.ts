import { useCallback, useEffect, useRef, useState } from 'react';
import type { Recipe } from './recipe';

/**
 * Undo and redo over recipes (EDT-E-11). Every tool changes the recipe, so one history covers them all: text style
 * changes, sticker moves, frame changes. A recipe is small (layers share their parts between steps), so a hundred
 * steps stay well inside the editor's memory budget.
 *
 * `commit` is one step. `live` is a change still in progress — a slider dragged, a layer moved, a word typed — and
 * becomes one step when it settles, however many moments it passed through.
 */
export const MAX_STEPS = 100;
const SETTLE_MS = 450;

export interface History {
  recipe: Recipe;
  commit: (next: Recipe) => void;
  live: (next: Recipe) => void;
  /** Ends a live change now (a pointer let go). */
  settle: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** A fresh start: no history (a new picture, or after a reopen). */
  reset: (r: Recipe) => void;
}

export function useHistory(initial: Recipe): History {
  const [state, setState] = useState<{ recipe: Recipe; past: Recipe[]; future: Recipe[]; moving?: boolean }>({ recipe: initial, past: [], future: [] });
  const gesture = useRef<Recipe | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const from = gesture.current;
    gesture.current = null;
    if (!from) return;
    setState((s) => (JSON.stringify(from) === JSON.stringify(s.recipe) ? { ...s, moving: false } : { ...s, moving: false, past: [...s.past, from].slice(-MAX_STEPS), future: [] }));
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const commit = useCallback(
    (next: Recipe) => {
      settle();
      setState((s) => (next === s.recipe ? s : { recipe: next, past: [...s.past, s.recipe].slice(-MAX_STEPS), future: [] }));
    },
    [settle],
  );

  const live = useCallback((next: Recipe) => {
    setState((s) => {
      if (!gesture.current) gesture.current = s.recipe;
      return { ...s, recipe: next, moving: true };
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(settle, SETTLE_MS);
  }, [settle]);

  const undo = useCallback(() => {
    settle();
    setState((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { recipe: prev, past: s.past.slice(0, -1), future: [s.recipe, ...s.future].slice(0, MAX_STEPS) };
    });
  }, [settle]);

  const redo = useCallback(() => {
    settle();
    setState((s) => {
      const next = s.future[0];
      if (!next) return s;
      return { recipe: next, past: [...s.past, s.recipe].slice(-MAX_STEPS), future: s.future.slice(1) };
    });
  }, [settle]);

  const reset = useCallback((r: Recipe) => {
    gesture.current = null;
    if (timer.current) clearTimeout(timer.current);
    setState({ recipe: r, past: [], future: [] });
  }, []);

  return { recipe: state.recipe, commit, live, settle, undo, redo, canUndo: state.past.length > 0 || !!state.moving, canRedo: state.future.length > 0, reset };
}
