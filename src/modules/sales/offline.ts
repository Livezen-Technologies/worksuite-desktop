import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { dateLabel, timeLabel } from '../../core/time';

/**
 * Recent orders offline, read only (WS-OMS-SRS-001 FR-DSK-07).
 *
 * Every order list and every order opened is kept on this computer, encrypted, by the app's READ_CACHE (the main
 * process's `/api/oms/orders`, `/api/oms/overview` and `/api/oms/organizations`): with WorkSuite out of reach the
 * screens read that copy, marked offline. Nothing is written from it — the server is the only place an order changes
 * — so every write in the app is disabled while offline, with this sentence on it.
 */
export const OFFLINE_WRITE = 'You are offline. Orders are shown as last seen; changing one waits for the connection.';

export interface ReadState {
  /** The app's own view of the connection. */
  network?: string | null;
  /** What the last read said: answered from this computer's copy. */
  servedOffline?: boolean;
}

/** Whether writes are allowed now: never while offline, or while what is on screen came from the offline copy. */
export function mayWrite(s: ReadState): boolean {
  return s.network !== 'OFFLINE' && !s.servedOffline;
}

/** The reason a write is disabled, for its tooltip; null when it is not. */
export function writeBlock(s: ReadState): string | null {
  return mayWrite(s) ? null : OFFLINE_WRITE;
}

/** "Offline · orders as of 14 Oct, 09:12". */
export function offlineLine(cachedAt: string | null | undefined): string {
  return cachedAt ? `Offline · orders as of ${dateLabel(cachedAt)}, ${timeLabel(cachedAt)}` : 'Offline · orders as last seen';
}

/** True while WorkSuite cannot be reached, or the screen is reading the offline copy. */
export function useSalesOffline(...served: Array<boolean | undefined>): boolean {
  const network = useStore(app, (s) => s.status?.network ?? null);
  return !mayWrite({ network, servedOffline: served.some(Boolean) });
}
