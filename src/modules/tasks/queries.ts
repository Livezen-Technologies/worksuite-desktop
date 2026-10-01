import { apiGetMeta } from '../../core/api';
import type { Task } from './api';

/** The one request the Tasks page and Home both read (one cache), so Home's counts are the counts of the lists they open (#104). */
export const ALL_TASKS = {
  queryKey: ['tasks', 'all'] as const,
  queryFn: ({ signal }: { signal?: AbortSignal }) => apiGetMeta<{ tasks: Task[] }>('/api/tasks', undefined, signal),
};
