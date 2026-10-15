import { useEffect, useRef } from 'react';
import { isMac } from '../../core/bridge';

/**
 * The Sales keyboard map (WS-OMS-SRS-001 FR-DSK-03, D-02, D-05):
 *
 *   ↑ / ↓          move through the list            Enter     open the order
 *   Space          select the row (bulk actions)    Esc       clear the selection, then close the drawer
 *   ⌘N / Ctrl+N    new order                        ⌘F / Ctrl+F  the search box
 *   A / R          approve / reject the order in focus, in the approvals queue
 *
 * Typing in a field is never a shortcut, except Esc and the ⌘ / Ctrl ones. The map is a pure function so it is the
 * same in every list and tested once; `useSalesKeys` listens while the tab is in front.
 */
export type SalesKeyAction =
  | { kind: 'move'; delta: 1 | -1 }
  | { kind: 'open' }
  | { kind: 'select' }
  | { kind: 'new' }
  | { kind: 'search' }
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'escape' };

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface KeyContext {
  mac?: boolean;
  /** Focus is in a text field, a select or an editor. */
  typing?: boolean;
  /** The approvals queue: A and R decide. */
  queue?: boolean;
  /** May create orders (⌘N), may decide approvals (A / R). */
  canCreate?: boolean;
  canDecide?: boolean;
}

export function salesKeyAction(e: KeyLike, c: KeyContext = {}): SalesKeyAction | null {
  const mod = (c.mac ?? isMac) ? !!e.metaKey : !!e.ctrlKey;
  const other = (c.mac ?? isMac) ? !!e.ctrlKey : !!e.metaKey;
  const k = e.key;
  if (mod && !other && !e.altKey && !e.shiftKey) {
    if (k.toLowerCase() === 'n') return c.canCreate ? { kind: 'new' } : null;
    if (k.toLowerCase() === 'f') return { kind: 'search' };
    return null;
  }
  if (k === 'Escape') return { kind: 'escape' };
  if (mod || other || e.altKey || c.typing) return null;
  if (k === 'ArrowDown') return { kind: 'move', delta: 1 };
  if (k === 'ArrowUp') return { kind: 'move', delta: -1 };
  if (k === 'Enter') return { kind: 'open' };
  if (k === ' ' || k === 'Spacebar') return { kind: 'select' };
  if (c.queue && c.canDecide && !e.shiftKey && (k === 'a' || k === 'A')) return { kind: 'approve' };
  if (c.queue && c.canDecide && !e.shiftKey && (k === 'r' || k === 'R')) return { kind: 'reject' };
  return null;
}

/** The row after a move: stays inside the list; from nothing in focus, ↓ is the first row and ↑ the last. */
export function moveFocus(at: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return -1;
  if (at < 0) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, at + delta));
}

/** Whether a key event comes from somewhere the person is typing. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true || !!el.closest?.('[role="dialog"]');
}

/** A focused button or link: Enter and Space press it. */
export function isControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'button' || tag === 'a' || el.getAttribute?.('role') === 'button';
}

/** Listen for the map while `active` (this tab in front); `on` returns true when it used the key. */
export function useSalesKeys(active: boolean, ctx: Omit<KeyContext, 'typing'>, on: (a: SalesKeyAction, e: KeyboardEvent) => boolean | void): void {
  const ref = useRef({ ctx, on });
  useEffect(() => {
    ref.current = { ctx, on };
  });
  useEffect(() => {
    if (!active) return;
    const listener = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const a = salesKeyAction(e, { ...ref.current.ctx, typing: isTyping(e.target) });
      if (!a) return;
      // Enter and Space on a focused button or link are that button's own.
      if ((a.kind === 'open' || a.kind === 'select') && isControl(e.target)) return;
      if (ref.current.on(a, e) !== false) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Capture: ⌘N and ⌘F are the list's here, before the shell's own New and the PDF viewer's Find.
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [active]);
}
