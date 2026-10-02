import { useSyncExternalStore } from 'react';

/**
 * Sends waiting out their undo window ("Sending … in 8 s · Undo"). Kept
 * outside the page, so leaving Mail before the window ends does not lose the
 * send; the draft is only cleared once the message has gone (or is queued), so
 * quitting inside the window loses nothing either.
 */
export const UNDO_SECONDS = 8;

export interface OutgoingSend {
  id: string;
  subject: string;
  /** When it goes, as epoch milliseconds. */
  at: number;
}

interface Entry extends OutgoingSend {
  timer: ReturnType<typeof setTimeout>;
  undo: () => void;
}

const entries = new Map<string, Entry>();
const subs = new Set<() => void>();
let snapshot: OutgoingSend[] = [];
let seq = 0;

function changed(): void {
  snapshot = [...entries.values()].map(({ id, subject, at }) => ({ id, subject, at }));
  for (const fn of subs) fn();
}

/** Send after the undo window; `undo` runs if the person takes it back. */
export function sendAfterUndoWindow(subject: string, send: () => Promise<void>, undo: () => void, seconds = UNDO_SECONDS): string {
  const id = `send-${Date.now()}-${++seq}`;
  const timer = setTimeout(() => {
    entries.delete(id);
    changed();
    void send();
  }, seconds * 1000);
  entries.set(id, { id, subject, at: Date.now() + seconds * 1000, timer, undo });
  changed();
  return id;
}

/** Take a send back before it goes. False when it has already gone. */
export function undoSend(id: string): boolean {
  const e = entries.get(id);
  if (!e) return false;
  clearTimeout(e.timer);
  entries.delete(id);
  changed();
  e.undo();
  return true;
}

export function useOutgoing(): OutgoingSend[] {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => snapshot,
    () => snapshot,
  );
}
