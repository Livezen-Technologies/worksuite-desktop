import { useQuery } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { apiGet } from '../../core/api';

/**
 * Presence, from one place (worksuite-desktop#183). Every screen asks the server
 * about the people it shows — the list about everybody in it, the header and
 * the details panel about one conversation's members — and each answer used to
 * stay with the screen that asked. Asked at different moments, they disagreed:
 * the list showed a green dot while the header said Offline. Now every answer
 * goes into one store, person by person, the newest answer wins, and every
 * screen reads the store: whoever asked last, everybody shows the same thing.
 */
interface Seen {
  status: string;
  at: number;
}

const known = new Map<string, Seen>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const l of listeners) l();
}

/** What the server said about these people, at `at` (newer answers replace older ones; an older one never wins). */
export function recordPresence(presence: Record<string, string>, at = Date.now()): void {
  let any = false;
  for (const [id, status] of Object.entries(presence)) {
    const before = known.get(id);
    if (before && before.at > at) continue;
    if (before?.status !== status) any = true;
    known.set(id, { status, at });
  }
  if (any) changed();
}

/** What a person shows as now, or undefined before anybody asked. */
export function presenceOf(id: number | string | null | undefined): string | undefined {
  return id === null || id === undefined ? undefined : known.get(String(id))?.status;
}

/** Forget everybody (signing out, tests). */
export function forgetPresence(): void {
  known.clear();
  changed();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Ask about these people (every minute while shown) and read everybody's presence from the shared store.
 * Returns a lookup: `status(id)`.
 */
export function usePresence(ids: Array<number | null | undefined>, enabled = true): (id: number | string | null | undefined) => string | undefined {
  const list = [...new Set(ids.filter((id): id is number => typeof id === 'number' && id > 0))].sort((a, b) => a - b);
  const key = list.join(',');
  useQuery({
    queryKey: ['chat', 'presence', key],
    queryFn: async ({ signal }) => {
      const r = await apiGet<{ presence: Record<string, string> }>('/api/chat/presence', { ids: key }, signal);
      recordPresence(r?.presence ?? {});
      return r;
    },
    enabled: enabled && key !== '',
    refetchInterval: 60_000,
  });
  const v = useSyncExternalStore(subscribe, () => version);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` is what changes when the store does.
  return useCallback((id: number | string | null | undefined) => presenceOf(id), [v]);
}
