import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import type { Task } from './api';

/**
 * A change to one field, through the offline queue: it saves now, or when the
 * connection is back (PARTIAL_WRITE). The server checks the field against what
 * this person may change and says no in a sentence when they may not.
 */
export async function patchTask(task: Pick<Task, 'id' | 'title'>, field: string, value: unknown, label: string): Promise<void> {
  const r = await call('offline:submit', {
    module: 'tasks',
    entity: 'task',
    entityId: String(task.id),
    label,
    method: 'PATCH',
    path: `/api/tasks/${task.id}`,
    body: { field, value },
    queueIfOffline: true,
  });
  if (!r.delivered && !r.queued) throw new Error(r.error ?? 'The task was not changed.');
  if (r.queued) toast('info', 'Offline — the change saves when you reconnect.');
}

/** A new task, through the offline queue too. */
export async function createTask(body: Record<string, unknown>): Promise<{ queued: boolean; id: number | null }> {
  const r = await call('offline:submit', {
    module: 'tasks',
    entity: 'task',
    entityId: null,
    label: `New task: ${String(body.title ?? '').slice(0, 120)}`,
    method: 'POST',
    path: '/api/tasks',
    body,
    queueIfOffline: true,
  });
  if (!r.delivered && !r.queued) throw new Error(r.error ?? 'The task was not created.');
  const id = (r.data as { id?: number } | null)?.id ?? null;
  return { queued: !!r.queued, id };
}
