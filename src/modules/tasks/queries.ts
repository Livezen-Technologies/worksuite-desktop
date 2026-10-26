import type { QueryClient } from '@tanstack/react-query';
import { apiGetMeta } from '../../core/api';
import type { Status, Task } from './api';

/** The one request the Tasks page and Home both read (one cache), so Home's counts are the counts of the lists they open (#104). */
export const ALL_TASKS = {
  queryKey: ['tasks', 'all'] as const,
  queryFn: ({ signal }: { signal?: AbortSignal }) => apiGetMeta<{ tasks: Task[] }>('/api/tasks', undefined, signal),
};

/** The lists a status change shows in at once: everyone's own tasks and the shared ones. */
const LISTS = [ALL_TASKS.queryKey, ['tasks', 'shared'] as const];

/**
 * Shows tasks in their new status at once (#430, #433), before the server answers. A refetch already on its way —
 * the page asks again every 20 seconds — is stopped first: arriving after this, it carried the task's old status and
 * put a card dropped on Done back in its column, or a ticked task back among the open ones, until the next poll.
 */
export async function showStatus(qc: QueryClient, ids: ReadonlyArray<number>, status: Status): Promise<void> {
  const set = new Set(ids);
  await Promise.all(LISTS.map((queryKey) => qc.cancelQueries({ queryKey, exact: true })));
  for (const queryKey of LISTS) {
    qc.setQueryData<{ data: { tasks: Task[] } }>(queryKey, (old) => (old ? { ...old, data: { ...old.data, tasks: old.data.tasks.map((x) => (set.has(x.id) ? { ...x, status } : x)) } } : old));
  }
}
