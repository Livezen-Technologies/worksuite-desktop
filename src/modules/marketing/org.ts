import { app } from '../../core/app-state';
import { createStore, useStore } from '../../core/store';

/**
 * The company Marketing shows (the rail's company picker, design "Shell"). Contacts, suppression, campaigns and
 * queues belong to one company (constraint C5): every read names it as `org`, as the web does. Empty follows the
 * app's own organisation; a company picked in the rail holds until the app's organisation changes.
 */
const chosen = createStore<{ org: string | null; base: string | null }>({ org: null, base: null });

export function useMarketingOrg(): string {
  const appOrg = useStore(app, (s) => s.organizationId);
  const c = useStore(chosen, (s) => s);
  return c.org !== null && c.base === appOrg ? c.org : (appOrg ?? '');
}

export function setMarketingOrg(org: string): void {
  chosen.set({ org, base: app.get().organizationId });
}

/** The companies the person belongs to (bootstrap), for the picker. */
const NONE: ReadonlyArray<{ id: string; name: string }> = [];

export function useCompanies(): ReadonlyArray<{ id: string; name: string }> {
  return useStore(app, (s) => s.bootstrap?.organizations ?? NONE);
}
