/**
 * The Projects app's addresses — the web's own (PRJ-INT-02), so a deep link, a notification, Mail, Calendar and
 * search land on the same record here as on the web:
 *
 *   /projects                       Dashboard
 *   /projects/my-work               My work
 *   /projects/time                  Time & approvals (my week)
 *   /projects/changes[/<id>]        Change requests waiting for a decision
 *   /projects/<id>[/board]          A project's board
 *   /projects/<id>/tasks/<task>     A task, open over its project's board
 *   ?project=<id> | ?id=<id>        The older links to a project (G-12)
 *   ?task=<id>                      A task, open over whatever view
 *   /projects/timer                 The mini timer window (D02)
 *
 * Anything else is a screen of the web's (timeline, sprints, budget…): shared/links.ts sends those links to the
 * browser, and a route that still lands here says so and offers the web page.
 */
export type ProjectsView =
  | { kind: 'dashboard' }
  | { kind: 'my-work' }
  | { kind: 'time' }
  | { kind: 'changes'; id: number | null }
  | { kind: 'board'; projectId: number }
  | { kind: 'timer' }
  | { kind: 'web'; path: string };

const num = (v: string | null | undefined): number | null => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);

export function viewOf(path: readonly string[], query: URLSearchParams): { view: ProjectsView; taskId: number | null } {
  const [, a, b, c] = path;
  const pathTask = b === 'tasks' ? num(c) : null;
  const taskId = num(query.get('task')) ?? pathTask;
  const legacy = num(query.get('project')) ?? num(query.get('id'));
  if (legacy && !a) return { view: { kind: 'board', projectId: legacy }, taskId };
  if (!a) return { view: { kind: 'dashboard' }, taskId };
  if (a === 'my-work') return { view: { kind: 'my-work' }, taskId };
  if (a === 'time') return { view: { kind: 'time' }, taskId };
  if (a === 'timer') return { view: { kind: 'timer' }, taskId: null };
  if (a === 'changes') return { view: { kind: 'changes', id: num(b) }, taskId };
  const project = num(a);
  if (project && (!b || b === 'board' || b === 'tasks')) return { view: { kind: 'board', projectId: project }, taskId };
  return { view: { kind: 'web', path: `/${path.join('/')}` }, taskId: null };
}

export const boardRoute = (projectId: number, taskId?: number | null): string => (taskId ? `/projects/${projectId}/tasks/${taskId}` : `/projects/${projectId}`);
