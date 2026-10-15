import { useEffect, useRef } from 'react';
import { createStore, useStore } from './store';

/**
 * Keyboard-wedge barcode scanners (USB or Bluetooth): to the computer a scanner is a keyboard that types the code very
 * fast and presses Enter. Shared by every screen that takes scans, so one rule decides what a scan is:
 *
 *  - a burst of at least `MIN_LEN` characters, each within `MAX_GAP_MS` of the one before, ended by Enter, is a scan;
 *  - anything slower is a person typing, and is left alone.
 *
 * `useWedge` takes the scans that arrive while nothing is focused to type into (the scanner fires wherever the focus
 * is), so a screen keeps working when the scan box has lost focus. A scan box of its own handles Enter itself; this
 * only notes that a scanner has been seen, which the dashboard's "This computer" card shows.
 */
export const MAX_GAP_MS = 50;
export const MIN_LEN = 3;

export class WedgeDetector {
  private buf = '';
  private last = 0;

  constructor(
    private readonly gap = MAX_GAP_MS,
    private readonly min = MIN_LEN,
  ) {}

  /** One key, as `KeyboardEvent.key`, pressed at `at` ms. The code when it ends a scan; null otherwise. */
  feed(key: string, at: number): string | null {
    const slow = this.buf.length > 0 && at - this.last > this.gap;
    this.last = at;
    if (key === 'Enter') {
      const code = this.buf;
      const ok = !slow && code.length >= this.min;
      this.reset();
      return ok ? code : null;
    }
    if (key.length !== 1) return null;
    if (slow) {
      // A pause: whatever came before was typed, not scanned. Start again from this key.
      this.buf = '';
    }
    this.buf += key;
    return null;
  }

  reset(): void {
    this.buf = '';
  }
}

/** When a scanner was last heard on this computer (ms), for the "This computer" card. */
export const scannerState = createStore<{ seenAt: number | null }>({ seenAt: null });

export function noteScanner(at = Date.now()): void {
  scannerState.set({ seenAt: at });
}

export function useScannerSeen(): number | null {
  return useStore(scannerState, (s) => s.seenAt);
}

/** True when the keystroke is going into something a person types in (a field, an editor, a dialog's control). */
export function typingTarget(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

/**
 * Scans that arrive with no field focused go to `onScan`; scans typed into a field are that field's (its own Enter),
 * but they too mark the scanner as seen. Off while `enabled` is false (a dialog is open, the tab is in the background).
 */
export function useWedge(onScan: (code: string) => void, enabled = true): void {
  const cb = useRef(onScan);
  useEffect(() => {
    cb.current = onScan;
  });
  useEffect(() => {
    if (!enabled) return;
    const loose = new WedgeDetector();
    const any = new WedgeDetector();
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const at = e.timeStamp || Date.now();
      if (any.feed(e.key, at) !== null) noteScanner();
      if (typingTarget(e.target)) {
        loose.reset();
        return;
      }
      const code = loose.feed(e.key, at);
      if (code !== null) {
        e.preventDefault();
        cb.current(code);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}
