import { useEffect, useRef } from 'react';

/**
 * A USB or Bluetooth barcode scanner is a keyboard ("wedge"): it types the code, fast, and presses Enter. This tells
 * a scan from a person typing by speed — every key within `gapMs` of the last, at least `minLength` characters, ended
 * by Enter — so the register takes a scan wherever the keyboard's focus is, and a person typing in the search box is
 * never mistaken for one. Pure, so it is tested without a keyboard.
 */
export interface WedgeOptions {
  gapMs?: number;
  minLength?: number;
}

export class WedgeDetector {
  private buf = '';
  private last = 0;
  private readonly gap: number;
  private readonly min: number;

  constructor(o: WedgeOptions = {}) {
    this.gap = o.gapMs ?? 35;
    this.min = o.minLength ?? 4;
  }

  /** Feed one key; answers the code when a scan has just ended. */
  key(key: string, at: number): string | null {
    if (key === 'Enter') {
      const code = this.buf;
      const quick = at - this.last <= this.gap * 3;
      this.buf = '';
      return code.length >= this.min && quick ? code : null;
    }
    if (key.length !== 1) return null;
    if (at - this.last > this.gap) this.buf = '';
    this.buf += key;
    this.last = at;
    return null;
  }

  /** Whether the keys so far look like a scan in progress (long enough and fast). */
  scanning(): boolean {
    return this.buf.length >= 2;
  }

  reset(): void {
    this.buf = '';
  }
}

/**
 * Listen for scans while `active` (the register is the tab in front). A scan typed into a field is taken back out
 * of it, so the code does not land in the search box as well.
 */
export function useBarcodeScanner(active: boolean, onScan: (code: string) => void): void {
  const cb = useRef(onScan);
  useEffect(() => {
    cb.current = onScan;
  }, [onScan]);
  useEffect(() => {
    if (!active) return;
    const d = new WedgeDetector();
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const code = d.key(e.key, e.timeStamp || performance.now());
      if (!code) return;
      e.preventDefault();
      e.stopPropagation();
      const t = e.target as HTMLInputElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && typeof t.value === 'string' && t.value.endsWith(code)) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(t), 'value')?.set;
        setter?.call(t, t.value.slice(0, -code.length));
        t.dispatchEvent(new Event('input', { bubbles: true }));
      }
      cb.current(code);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}
