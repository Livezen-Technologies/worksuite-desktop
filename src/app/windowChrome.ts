import { useSyncExternalStore } from 'react';

/**
 * Whether a secondary window's slim title bar shows. A call surface
 * (CallWorkspace) draws its own header — with full screen, the floating
 * card and maximise — so while it is on screen the window's bar steps
 * aside; a meeting's lobby, before it, keeps the bar.
 */
let hidden = 0;
const listeners = new Set<() => void>();

export function hideWindowBar(): () => void {
  hidden++;
  listeners.forEach((f) => f());
  return () => {
    hidden = Math.max(0, hidden - 1);
    listeners.forEach((f) => f());
  };
}

export function useWindowBarHidden(): boolean {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => hidden > 0,
  );
}
