/**
 * The words the shell and its screens share about where things are: the
 * contact list's filters (the same keys as the web's address), where a
 * dashboard tile leads, and the tabs of the two screens that have them.
 */
export const FILTER_KEYS = ['q', 'status', 'list', 'segment', 'tag', 'owner', 'source', 'crm', 'subscribed', 'company'] as const;
export type Filter = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

/** Where a tile, a row or a link leads. */
export type Go =
  | { view: 'contacts'; filter?: Record<string, string> }
  | { view: 'campaign'; id: number; step?: string }
  | { view: 'campaigns' | 'queue' | 'calls' | 'consent' | 'import' | 'reports' | 'settings' };

export type ConsentTab = 'suppression' | 'ledger' | 'dnc' | 'topics';
export type QueueTab = 'queue' | 'callbacks' | 'work';
