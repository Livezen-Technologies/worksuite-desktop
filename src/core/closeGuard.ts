import { call } from './bridge';
import { flushDrafts, hasPendingDrafts } from './drafts';

/**
 * Closing a secondary window — a chat in its own window (#103) — never loses
 * what was in it: a draft still waiting to be saved is saved, and a picture or
 * voice message still going up finishes first. Until then the window steps out
 * of the way (minimised) and closes itself when done. Files picked from disk
 * already go through the main process, so they never depended on the window.
 *
 * Signing out and quitting close the window regardless (the main process
 * overrides the guard), so nothing holds those up.
 */
const sending = new Set<Promise<unknown>>();

/** Keeps a window open, if it is closed, until this has finished. */
export function holdWhileSending<T>(work: Promise<T>): Promise<T> {
  sending.add(work);
  const done = () => void sending.delete(work);
  work.then(done, done);
  return work;
}

export function busySending(): number {
  return sending.size;
}

/** Installs the guard on this window; returns what removes it. */
export function guardWindowClose(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  let closing = false;
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (closing || (!hasPendingDrafts() && !sending.size)) return;
    // Electron cancels the close, without asking anything, when the event is refused.
    e.preventDefault();
    e.returnValue = false;
    closing = true;
    if (sending.size) void call('windows:minimize').catch(() => undefined);
    void Promise.allSettled([flushDrafts(), ...sending]).then(() => call('windows:close').catch(() => undefined));
  };
  target.addEventListener('beforeunload', onBeforeUnload as EventListener);
  return () => target.removeEventListener('beforeunload', onBeforeUnload as EventListener);
}
