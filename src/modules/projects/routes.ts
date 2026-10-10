/**
 * The Projects app's addresses — the web's own (PRJ-INT-02), so a deep link, a notification, Mail, Calendar and
 * search land on the same record here as on the web:
 *
 *   /projects                       Dashboard
 *   /projects/my-work               My work
 *   /projects/time                  Time & approvals (my week)
 *   /projects/changes[/<id>]        Change requests waiting for a decision
 *   /projects/<id>                  A project's overview (PORTFOLIO)
 *   /projects/<id>/board            A project's board
 *   /projects/<id>/tasks/<task>     A task, open over its project's board
 *   /projects/<id>/<tab>            A project's team, settings, activity or files (PORTFOLIO)
 *   /projects/all · /templates      The register and the templates (PORTFOLIO; filters in the query)
 *   /projects/clients[/<id>]        Clients, one open on the right (PORTFOLIO)
 *   /projects/activity · /settings  The activity log and Module settings (PORTFOLIO)
 *   ?new=blank | ?new=<template>    The New project dialog, over any view (PORTFOLIO)
 *   ?project=<id> | ?id=<id>        The older links to a project (G-12)
 *   ?task=<id>                      A task, open over whatever view
 *   /projects/timer                 The mini timer window (D02)
 *   DELIVERY:
 *   /projects[/<id>]/timeline       Timeline & Gantt (a project's, or the remembered one's)
 *   /projects[/<id>]/milestones     Milestones & billing
 *   /projects[/<id>]/sprints[/<s>]  Sprints, one open
 *   /projects/workload              Team workload
 *   /projects/time?tab=queue|summary  Time & approvals' approval queue and summary
 *
 * Anything else is a screen of the web's (budget, risks, reports…): shared/links.ts sends those links to the
 * browser, and a route that still lands here says so and offers the web page.
 */
export type ProjectsView =
  | { kind: 'dashboard' }
  | { kind: 'my-work' }
  | { kind: 'time' }
  | { kind: 'changes'; id: number | null }
  | { kind: 'board'; projectId: number }
  /** `/projects/board`: the board of the project last worked in (the web's remembered project), else a choice. */
  | { kind: 'board-home' }
  | { kind: 'timer' }
  // ── PORTFOLIO ──
  | { kind: 'all' }
  | { kind: 'templates' }
  | { kind: 'clients'; id: number | null }
  | { kind: 'project'; projectId: number; tab: ProjectTab }
  | { kind: 'activity' }
  | { kind: 'settings' }
  // ── DELIVERY ──
  | { kind: 'timeline'; projectId: number | null }
  | { kind: 'milestones'; projectId: number | null }
  | { kind: 'sprints'; projectId: number | null; sprintId: number | null }
  | { kind: 'workload' }
  | { kind: 'web'; path: string };

/** A project's own sections drawn here (PORTFOLIO); its board is `board`. */
export type ProjectTab = 'overview' | 'team' | 'settings' | 'activity' | 'files';
const PROJECT_TABS: readonly string[] = ['team', 'settings', 'activity', 'files'];

const num = (v: string | null | undefined): number | null => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);

export function viewOf(path: readonly string[], query: URLSearchParams): { view: ProjectsView; taskId: number | null } {
  const [, a, b, c] = path;
  const pathTask = b === 'tasks' ? num(c) : null;
  const taskId = num(query.get('task')) ?? pathTask;
  const legacy = num(query.get('project')) ?? num(query.get('id'));
  if (legacy && !a) return { view: { kind: 'project', projectId: legacy, tab: 'overview' }, taskId };
  if (!a) return { view: { kind: 'dashboard' }, taskId };
  if (a === 'my-work') return { view: { kind: 'my-work' }, taskId };
  if (a === 'time') return { view: { kind: 'time' }, taskId };
  if (a === 'timer') return { view: { kind: 'timer' }, taskId: null };
  if (a === 'changes') return { view: { kind: 'changes', id: num(b) }, taskId };
  // ── PORTFOLIO ──
  if (a === 'all') return { view: { kind: 'all' }, taskId };
  if (a === 'templates') return { view: { kind: 'templates' }, taskId };
  if (a === 'clients') return { view: { kind: 'clients', id: num(b) }, taskId };
  if (a === 'activity') return { view: { kind: 'activity' }, taskId };
  if (a === 'settings') return { view: { kind: 'settings' }, taskId };
  // ── DELIVERY: the timeline, milestones, sprints and workload, module-wide ──
  if (a === 'timeline' && !b) return { view: { kind: 'timeline', projectId: null }, taskId };
  if (a === 'milestones' && !b) return { view: { kind: 'milestones', projectId: null }, taskId };
  if (a === 'sprints' && (!b || num(b)) && !c) return { view: { kind: 'sprints', projectId: null, sprintId: num(b) }, taskId };
  if (a === 'workload' && !b) return { view: { kind: 'workload' }, taskId };
  if (a === 'board' && !b) return { view: { kind: 'board-home' }, taskId };
  // ── one project: its overview, board, own tabs (PORTFOLIO) and delivery screens (DELIVERY) ──
  const [, , , , d] = path;
  const project = num(a);
  if (project && (b === 'board' || b === 'tasks')) return { view: { kind: 'board', projectId: project }, taskId };
  if (project && !b) return { view: { kind: 'project', projectId: project, tab: 'overview' }, taskId };
  if (project && b && PROJECT_TABS.includes(b) && !c) return { view: { kind: 'project', projectId: project, tab: b as ProjectTab }, taskId };
  if (project && b === 'timeline' && !c) return { view: { kind: 'timeline', projectId: project }, taskId };
  if (project && b === 'milestones' && !c) return { view: { kind: 'milestones', projectId: project }, taskId };
  if (project && b === 'sprints' && (!c || num(c)) && !d) return { view: { kind: 'sprints', projectId: project, sprintId: num(c) }, taskId };
  return { view: { kind: 'web', path: `/${path.join('/')}` }, taskId: null };
}

export const boardRoute = (projectId: number, taskId?: number | null): string => (taskId ? `/projects/${projectId}/tasks/${taskId}` : `/projects/${projectId}/board`);
