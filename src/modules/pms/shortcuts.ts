import { createContext, useContext, useEffect, useRef } from 'react';

/**
 * The desk's Alt+letter shortcuts, answered by the screen in front when it
 * has something to do with them: Alt+I checks in the reservation open, Alt+P
 * posts a charge to the stay or folio open. A screen returns true when it
 * took the key; otherwise the shell does what the key does anywhere.
 */
export type Shortcut = 'new' | 'walkin' | 'search' | 'checkin' | 'charge' | 'rack' | 'arrivals' | 'departures' | 'inhouse';

export const ShortcutContext = createContext<Map<Shortcut, () => boolean> | null>(null);

/** While mounted, this screen answers `key` (when `fn` returns true). */
export function useShortcut(key: Shortcut, fn: () => boolean): void {
  const map = useContext(ShortcutContext);
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (!map) return;
    const handler = () => latest.current();
    map.set(key, handler);
    return () => {
      if (map.get(key) === handler) map.delete(key);
    };
  }, [map, key]);
}
