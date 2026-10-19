import type { UpdateStatus } from '@shared/types';
import { app } from './app-state';
import { call } from './bridge';

/** Explicit checks offer a choice even when automatic downloads are enabled or this version was dismissed. */
export function canOfferManualUpdate(u: UpdateStatus | null): boolean {
  return !!u?.availableVersion && ['AVAILABLE', 'STAGED'].includes(u.state) && u.installSupported && !u.installBlockedReason && !u.required && !u.critical && !u.immediate && !u.downgrade;
}

export async function checkForUpdates(): Promise<void> {
  if (app.get().manualUpdateCheck === 'checking') return;
  app.set({ manualUpdateCheck: 'checking' });
  try {
    const update = await call('updates:check');
    app.set({ ...(update ? { update } : {}), manualUpdateCheck: canOfferManualUpdate(update) ? 'offer' : null });
  } catch (error) {
    app.set({ manualUpdateCheck: null });
    throw error;
  }
}
