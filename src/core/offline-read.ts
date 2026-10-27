import { offlineReadOwner, type OfflineReadModule } from '@shared/offline-reads';
import { useSyncExternalStore } from 'react';
import { app } from './app-state';

/**
 * Read-only offline for the modules in shared/offline-reads.ts (audit D-G14): while this computer is offline their
 * screens read the encrypted copy the main process kept, and every write is refused here, before it is sent, with
 * the sentence the screen shows — the server is the authority, so nothing is queued.
 *
 * "As of": the oldest copy any of the module's screens was served from in this offline spell, so the banner never
 * claims the data is newer than it is. Back online, it starts again.
 */
// A small store of its own (not core/store), so the screens that mock that module still load this one.
let asOfState: Record<string, string> = {};
const asOfSubs = new Set<() => void>();
const asOf = {
  get: () => asOfState,
  set(patch: Record<string, string> | ((s: Record<string, string>) => Record<string, string>)) {
    asOfState = { ...asOfState, ...(typeof patch === 'function' ? patch(asOfState) : patch) };
    for (const fn of asOfSubs) fn();
  },
  subscribe(fn: () => void) {
    asOfSubs.add(fn);
    return () => void asOfSubs.delete(fn);
  },
};
let wasOffline = false;

function offlineNow(): boolean {
  return app.get().status?.network === 'OFFLINE';
}

/** Called by the API client for each answer served from this computer's copy. */
export function noteServedFromCopy(path: string, cachedAt: string | null): void {
  const owner = offlineReadOwner(path);
  if (!owner || !cachedAt) return;
  const had = asOf.get()[owner.module];
  if (!had || Date.parse(cachedAt) < Date.parse(had)) asOf.set({ [owner.module]: cachedAt });
}

if (typeof app.subscribe === 'function') app.subscribe(() => {
  const off = offlineNow();
  if (wasOffline && !off) asOf.set(() => Object.fromEntries(Object.keys(asOf.get()).map((k) => [k, ''])));
  wasOffline = off;
});

/** Why a write to this path is refused now (offline, and its module is read-only offline), or null. */
export function offlineWriteRefusal(method: string, path: string): string | null {
  if (method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD' || !offlineNow()) return null;
  const owner = offlineReadOwner(path);
  return owner ? offlineReadOnlyText(owner.label) : null;
}

export const offlineReadOnlyText = (label: string) => `You are offline. ${label} is read-only until WorkSuite is back — nothing was changed.`;

/** For a module's screens: whether it is read-only now, and the time of the copy shown. */
export function useOfflineReadOnly(module: OfflineReadModule['module']): { readOnly: boolean; asOf: string | null } {
  const off = useSyncExternalStore(app.subscribe, () => app.get().status?.network === 'OFFLINE');
  const at = useSyncExternalStore(asOf.subscribe, () => asOf.get()[module] || null);
  return { readOnly: off, asOf: off ? at : null };
}
