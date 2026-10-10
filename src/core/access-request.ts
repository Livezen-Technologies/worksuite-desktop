import { createStore } from './store';

/**
 * "Ask for access" (the server's Users\Controllers\AccessRequestController, from commit 703fc97e): somebody refused an
 * app they were not given can ask their administrators for it from the refusal itself. One request at a time.
 */
export interface AccessAsk {
  /** The server's application slug (`applications.slug`). */
  slug: string;
  label: string;
  /** Where they were going, for the administrators. */
  path?: string;
}

export const accessRequest = createStore<{ ask: AccessAsk | null }>({ ask: null });

export function askForAccess(ask: AccessAsk): void {
  accessRequest.set({ ask });
}

export function closeAccessRequest(): void {
  accessRequest.set({ ask: null });
}
