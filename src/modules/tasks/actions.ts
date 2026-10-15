import { isGuest } from '../../core/app-state';
import { apiPatch, apiPost } from '../../core/api';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import type { Task } from './api';

/** Writes one field of a task: now, or kept for later; a refusal is thrown as a sentence. */
export type FieldWriter = (task: Pick<Task, 'id' | 'title'>, field: string, value: unknown, label: string) => Promise<void>;

/**
 * Which endpoint owns a field (Projects SRS v1.2 §14.2): the Tasks app sends every field to /api/tasks; a task on a
 * project sends its project's fields and status to the project's rule instead (projects/task-editor.ts).
 */
export type FieldRouter = (field: string) => FieldWriter;

/**
 * A change to one field of a Tasks task, through the offline queue: it saves now, or when the connection is back
 * (PARTIAL_WRITE). The server checks the field against what this person may change and says no in a sentence when
 * they may not.
 */
export const writeTaskField: FieldWriter = async (task, field, value, label) => {
  // Guest mode (#149): saved on this device at once; there is no server to queue for.
  if (isGuest()) {
    await apiPatch(`/api/tasks/${task.id}`, { field, value });
    return;
  }
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
};

/** The Tasks app's router: every field to /api/tasks/{id}. */
export const tasksRouter: FieldRouter = () => writeTaskField;

/** A change to one field, through whichever endpoint the router says owns it (the Tasks app's by default). */
export async function patchTask(task: Pick<Task, 'id' | 'title'>, field: string, value: unknown, label: string, router: FieldRouter = tasksRouter): Promise<void> {
  await router(field)(task, field, value, label);
}

/** A new task, through the offline queue too. */
export async function createTask(body: Record<string, unknown>): Promise<{ queued: boolean; id: number | null }> {
  if (isGuest()) return { queued: false, id: (await apiPost<{ id: number }>('/api/tasks', body)).id };
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
