import { app } from '../../core/app-state';
import { useStore } from '../../core/store';

/**
 * Billing offline, read only (SRS-BIL-001 §16, "per Desktop offline mode"). The app's READ_CACHE keeps the
 * dashboard, the companies, the invoice lists and every invoice opened, payments and customers on this computer,
 * encrypted; with WorkSuite out of reach the screens read that copy. Nothing is written from it — the server is the
 * only place an invoice changes — so every write is disabled while offline, with this sentence on it.
 */
export const OFFLINE_WRITE = 'You are offline. Billing is shown as last seen; changing it waits for the connection.';

/** True while WorkSuite cannot be reached, or what is on screen came from the offline copy. */
export function useBillingOffline(...served: Array<boolean | undefined>): boolean {
  const network = useStore(app, (s) => s.status?.network ?? null);
  return network === 'OFFLINE' || served.some(Boolean);
}
