// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { ProjectsOutboxItem } from '@shared/projects';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGetMeta: vi.fn(), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() }));
const events = vi.hoisted(() => new Map<string, (p: unknown) => void>());
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (ch: string, cb: (p: unknown) => void) => (events.set(ch, cb), () => events.delete(ch)),
  hasDesktop: () => true,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['projects', '18', 'tasks', '412'], go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/${tab.path.join('/')}?${tab.query}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
  openRouteInWindow: vi.fn(),
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= () => undefined;

const { ApiError, apiGetMeta, apiGet, apiPost, apiPut } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { openRouteInWindow } = await import('../../../src/core/tab-context');
const { app } = await import('../../../src/core/app-state');
const { default: ProjectsPage } = await import('../../../src/modules/projects/ProjectsPage');
const { viewOf, boardRoute } = await import('../../../src/modules/projects/routes');
const editor = await import('../../../src/modules/projects/task-editor');
const { patchTask } = await import('../../../src/modules/tasks/actions');
const { TaskDetail } = await import('../../../src/modules/tasks/TaskDetail');

const ME = 7;
const today = new Date().toISOString().slice(0, 10);
const row = (id: number, status: string, over: Record<string, unknown> = {}) => ({
  id, task_number: `TSK-0${id}`, title: `Task ${id}`, description: null, status, priority: 'medium', task_type: 'task', project_id: 18, project: 'e-Auction portal', project_code: 'PRJ-0018',
  sprint_id: 7, sprint: 'Sprint 7', milestone_id: 5, milestone: 'Bidder onboarding live', assignee_id: ME, assignee: 'Asha Fernando', reviewer_id: null, reviewer: null, estimated_hours: null, logged_hours: '0', logged_minutes: 0,
  start_date: null, due_date: null, overdue: false, blocked_reason: null, is_billable: true, tags: null, progress: 0, position: id, completed_at: null,
  updated_at: '2026-10-09 08:00:00', updated_by: 'Asha', timer_running: false, ...over,
});

const ALL = ['title', 'status', 'priority', 'assignee_id', 'due_date', 'start_date', 'progress', 'description', 'org_id', 'list_id', 'tags', 'checklist', 'people', 'task_type', 'sprint_id', 'milestone_id', 'reviewer_id', 'parent_id', 'story_points', 'estimated_hours', 'is_billable', 'blocked_reason', 'dependencies'];
const MEMBER = ['status', 'progress', 'description', 'checklist'];

/** GET /api/tasks/{id} as Project 2.5 answers it for a project task. */
const tasksRead = (id: number, opts: { manager?: boolean; status?: string } = {}) => {
  const can = Object.fromEntries(ALL.map((f) => [f, opts.manager !== false || MEMBER.includes(f)]));
  return {
    id, task_key: `TSK-0${id}`, list_id: null, org_id: 1, org_name: 'TechHubiz', owner_id: 3, assignee_id: ME, assignee_name: 'Asha Fernando', title: `Task ${id}`, description: '<p>Upload the KYC files</p>',
    status: opts.status ?? 'todo', priority: 'high', tags: ['kyc'], start_date: null, start_at: null, due_date: null, due_at: null, estimated_hours: 6, progress: 0, position: 1, archived: false,
    completed_at: null, created_at: null, updated_at: '2026-10-09 08:00:00', comments: [{ id: 1, user_id: 3, user_name: 'Samali', body: '<p>Gallery first?</p>', created_at: '2026-10-09 08:00:00' }],
    checklist: [{ id: 1, title: 'Collect recordings', done: true }], can_edit: can, can_comment: true, project_id: 18,
    project: {
      id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active', archived: false, company: { id: 1, name: 'TechHubiz (Pvt) Ltd' }, task_number: `TSK-0${id}`, link: `/projects/18/tasks/${id}`,
      fields: { task_type: 'bug', sprint_id: 7, sprint: 'Sprint 7', milestone_id: 5, milestone: 'Bidder onboarding live', reviewer_id: null, reviewer: null, parent_id: null, parent: null, parent_number: null, story_points: 3, estimated_hours: 6, is_billable: true, blocked_reason: null },
      read_only: ['project', 'company', ...(opts.manager === false ? ALL.filter((f) => !MEMBER.includes(f)) : [])],
      statuses: [['backlog', 'Backlog'], ['todo', 'To do'], ['in_progress', 'In progress'], ['in_review', 'In review'], ['testing', 'Testing'], ['blocked', 'Blocked'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([key, label]) => ({ key, label, column: true, done: key === 'completed' })),
      columns: ['todo', 'in_progress', 'in_review', 'testing', 'completed'], priorities: ['critical', 'high', 'medium', 'low'], types: ['task', 'bug', 'story', 'chore'],
      options: { sprints: [{ id: 7, name: 'Sprint 7', status: 'active' }], milestones: [{ id: 5, name: 'Bidder onboarding live', status: 'open', due_date: today }], members: [{ id: ME, name: 'Asha Fernando', role: 'member' }, { id: 9, name: 'Kasun Silva', role: 'lead' }] },
      dependencies: { waits_on: [{ id: 31, task_id: 396, task_number: 'TSK-0396', title: 'Lot catalogue search', status: 'completed', type: 'finish_start', lag_days: 0 }], blocks: [{ id: 32, task_id: 421, task_number: 'TSK-0421', title: 'Task 421', status: 'todo', type: 'finish_start', lag_days: 0 }] },
      time: { entries: [{ id: 70, user: 'Asha Fernando', user_id: ME, on_date: '2026-10-13', minutes: 105, note: 'storyboard', running: false, approved: false, state: 'pending', lock_state: 'Pending', locked: false }, { id: 71, user: 'Kasun Silva', user_id: 9, on_date: '2026-10-12', minutes: 60, note: null, running: false, approved: true, state: 'invoiced', lock_state: 'Invoiced', locked: true }], minutes: 165, logged_hours: '2.75', estimate_minutes: 360, estimated_hours: 6, over_estimate: false, timer_running: false, all_people: true },
      can: { task: opts.manager !== false, time: true },
    },
  };
};

let offline = false;
let manager = true;
let outsider = false;
let statuses: Record<number, string> = {};
function answers(path: string): unknown {
  if (path === '/api/projects') return { projects: [{ id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active', health: 'at_risk' }, { id: 21, code: 'PRJ-0021', name: 'SFCL website', status: 'active' }], total: 2 };
  if (path === '/api/projects/counts') return { projects: 2, my_work: 2, milestones_due: 0, time_waiting: 0, risks_open: 0, changes_waiting: 0 };
  if (path === '/api/projects/companies') return { items: [{ id: 1, name: 'TechHubiz', currency: 'LKR' }], current: 1 };
  if (path === '/api/projects/18') return { project: { id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active' }, members: [], sprints: [] };
  if (path === '/api/projects/tasks') return { tasks: [row(418, statuses[418] ?? 'todo'), row(421, 'todo'), row(412, statuses[412] ?? 'in_progress'), row(396, 'completed')] };
  if (path === '/api/projects/my-work') return { overdue: [], today: [row(412, 'in_progress', { due_date: today })], this_week: [], later: [row(418, 'todo')], waiting: { approvals: 0, reviews: [], changes: [] }, today_minutes: 0 };
  if (path === '/api/projects/time') return { entries: [{ id: 70, user: 'Me', user_id: ME, project: 'e-Auction portal', project_code: 'PRJ-0018', project_id: 18, task: 'Task 412', task_number: 'TSK-0412', task_id: 412, on_date: today, started_at: null, minutes: 60, duration: '1:00', is_billable: true, note: null, running: false, approved: false, state: 'pending', locked: false, is_mine: true }], week_start: today, week_end: today, total_minutes: 60, can: { time: true } };
  if (path === '/api/projects/milestones')
    return {
      milestones: [{ id: 5, project_id: 18, project: 'e-Auction portal', project_code: 'PRJ-0018', name: 'Bidder onboarding live', due_date: today, status: 'open', owner: null, owner_id: null, bill_amount: '0', currency: 'LKR', tasks: 3, tasks_done: 1, progress: 33, overdue: false, days: 0, achieved_at: null, description: null, achieved_note: null, invoice_status: 'not_invoiced', invoice_id: null, invoice_number: null, invoice_paid: false }],
      counts: { open: 1, overdue: 0, achieved: 0, missed: 0, all: 1 },
      ready: { total: '0', currency: 'LKR', count: 0 },
      can: { manage: false },
    };
  const m = /^\/api\/tasks\/(\d+)$/.exec(path);
  if (m) {
    if (outsider) throw new ApiError(404, 'Task not found', null);
    const id = Number(m[1]);
    return tasksRead(id, { manager, status: statuses[id] ?? 'todo' });
  }
  if (/^\/api\/projects\/tasks\/\d+$/.test(path) && outsider) throw new ApiError(404, 'Task not found', null);
  return {};
}

let outbox: ProjectsOutboxItem[] = [];
let submitted: unknown[] = [];
const tree = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ProjectsPage tabId="t1" route={`/${tab.path.join('/')}`} active />
  </QueryClientProvider>
);
const show = (route: string) => {
  const [p, q = ''] = route.split('?');
  tab.path = p!.slice(1).split('/');
  tab.query = new URLSearchParams(q);
  return render(tree());
};
const modal = () => screen.findByRole('dialog', { name: 'Project task' });
const key = (k: string, o: KeyboardEventInit = {}) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o })));
const dialogOf = async (text: RegExp) => (await screen.findByText(text)).closest('[role="dialog"]') as HTMLElement;
const combo = (dialog: HTMLElement, name: string) => within(dialog).getByRole('combobox', { name }) as HTMLButtonElement;

beforeEach(() => {
  offline = false;
  manager = true;
  outsider = false;
  statuses = {};
  outbox = [];
  submitted = [];
  tab.go = vi.fn();
  app.set({ auth: { stage: 'ready', user: { id: ME }, server: { origin: 'https://ws.example' } } as never });
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string) => ({ data: answers(path) as never, offline, cachedAt: offline ? '2026-10-09T08:00:00Z' : null }));
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path.endsWith('/people')) return { owner_id: 3, people: [], can_manage: false, following: false } as never;
    if (path.endsWith('/attachments')) return { attachments: [] } as never;
    if (path.endsWith('/reminders')) return { reminders: [], recipients: [], timezone: 'UTC' } as never;
    return { users: [] } as never;
  });
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPut).mockReset();
  vi.mocked(apiPut).mockResolvedValue({} as never);
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (ch: string, input?: unknown) => {
    if (ch === 'projects:outbox') return outbox as never;
    if (ch.startsWith('projects:timer')) return { available: true, running: null, paused: null, recent: [], todayMinutes: 0, weekMinutes: 0, idleSince: null, offline: false, error: null, checkedAt: null } as never;
    if (ch === 'projects:submit') {
      submitted.push(input);
      const i = input as { kind: string; taskId: number; status?: string };
      if (offline) return { delivered: false, queued: true, id: 'q1', data: null, error: null } as never;
      if (i.kind === 'move' && i.status) statuses[i.taskId] = i.status;
      return { delivered: true, queued: false, id: null, data: { id: 99 }, error: null } as never;
    }
    if (ch === 'offline:submit') return { delivered: true, queued: false, data: null, error: null } as never;
    return undefined as never;
  });
});
afterEach(cleanup);

describe('the task modal (PRJ-TED-01, D06)', () => {
  it('opens centred over the board for /projects/{id}/tasks/{task}, with the header, the project fields, dependencies and time', async () => {
    show('/projects/18/tasks/412');
    const d = await modal();
    expect(await screen.findByRole('grid', { name: 'Board' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Task' })).toBeNull(); // the old side panel is gone
    await within(d).findByDisplayValue('Task 412');
    expect(d.textContent).toContain('PRJ-0018 · e-Auction portal ›');
    expect(d.textContent).toContain('TSK-0412');
    expect(d.textContent).toContain('Bug');
    expect(within(d).getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(within(d).getByRole('button', { name: /Open in a window of its own/ })).toBeTruthy();
    expect(within(d).getByRole('button', { name: 'Complete' })).toBeTruthy();
    // The project group: Project and Company read-only, the rest from the block.
    expect(d.textContent).toContain('PRJ-0018 · e-Auction portal');
    expect(d.textContent).toContain('TechHubiz (Pvt) Ltd (from project)');
    expect(combo(d, 'Status').textContent).toContain('To do');
    expect(combo(d, 'Sprint').textContent).toContain('Sprint 7');
    expect(combo(d, 'Milestone').textContent).toContain('Bidder onboarding live');
    expect((within(d).getByRole('spinbutton', { name: 'Points' }) as HTMLInputElement).value).toBe('3');
    // Dependencies and time with their lock state.
    expect(d.textContent).toContain('Waits on');
    expect(d.textContent).toContain('TSK-0396');
    expect(d.textContent).toContain('Blocks');
    expect(d.textContent).toMatch(/Time\s*2:45 of 6 h/);
    expect(d.textContent).toContain('Pending');
    expect(d.textContent).toContain('Invoiced');
    expect(within(d).getByRole('img', { name: 'Locked' })).toBeTruthy();
  });

  it('the status uses the project vocabulary and every project field routes to the project rule', async () => {
    show('/projects/18/tasks/412');
    const d = await modal();
    await within(d).findByDisplayValue('Task 412');
    fireEvent.click(combo(d, 'Status'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Backlog', 'To do', 'In progress', 'In review', 'Testing', 'Blocked', 'Completed', 'Cancelled']);
    fireEvent.click(screen.getByRole('option', { name: 'In review' }));
    await waitFor(() => expect(submitted).toContainEqual({ kind: 'move', taskId: 412, status: 'in_review', baseUpdatedAt: '2026-10-09 08:00:00', label: 'Move TSK-0412 to In review' }));
    fireEvent.click(combo(d, 'Assignee'));
    fireEvent.click(screen.getByRole('option', { name: 'Kasun Silva' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/projects/tasks/412', { assignee_id: 9 }));
    fireEvent.change(within(d).getByRole('spinbutton', { name: 'Estimate' }), { target: { value: '8' } });
    fireEvent.blur(within(d).getByRole('spinbutton', { name: 'Estimate' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/projects/tasks/412', { estimated_hours: 8 }));
    // A Tasks field goes to the Tasks app's endpoint.
    const title = within(d).getByDisplayValue('Task 412');
    fireEvent.change(title, { target: { value: 'Bidder KYC upload' } });
    fireEvent.blur(title);
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ method: 'PATCH', path: '/api/tasks/412', body: { field: 'title', value: 'Bidder KYC upload' } })));
    expect(await within(d).findByText('Saved')).toBeTruthy();
  });
});

describe('acceptance 15: one access rule, read-only never hidden', () => {
  it('a member without project.task changes status, progress, description and checklist; every other field is shown read-only', async () => {
    manager = false;
    show('/projects/18/tasks/412');
    const d = await modal();
    const title = (await within(d).findByDisplayValue('Task 412')) as HTMLInputElement;
    expect(title.readOnly).toBe(true);
    expect(combo(d, 'Status').disabled).toBe(false);
    expect((within(d).getByRole('slider', { name: 'Progress' }) as HTMLInputElement).disabled).toBe(true); // follows the checklist
    expect(within(d).getByRole('checkbox', { name: 'Collect recordings' })).toHaveProperty('disabled', false);
    expect(within(d).getByRole('button', { name: 'Edit' })).toBeTruthy(); // the description
    for (const name of ['Priority', 'Assignee', 'Reviewer', 'Type', 'Sprint', 'Milestone', 'Parent']) {
      expect(combo(d, name).disabled, name).toBe(true);
      expect(combo(d, name).title, name).toBe('You can see this but not change it');
    }
    for (const name of ['Points', 'Estimate']) expect((within(d).getByRole('spinbutton', { name }) as HTMLInputElement).disabled).toBe(true);
    expect((within(d).getByRole('checkbox', { name: 'Billable' }) as HTMLInputElement).disabled).toBe(true);
    expect((within(d).getByRole('textbox', { name: 'Tags' }) as HTMLInputElement).disabled).toBe(true);
    expect((within(d).getByRole('button', { name: '+ Add' }) as HTMLButtonElement).disabled).toBe(true);
    // Every value is still there.
    expect(combo(d, 'Sprint').textContent).toContain('Sprint 7');
    expect(combo(d, 'Type').textContent).toContain('Bug');
  });

  it('a manager may change all of them', async () => {
    show('/projects/18/tasks/412');
    const d = await modal();
    expect(((await within(d).findByDisplayValue('Task 412')) as HTMLInputElement).readOnly).toBe(false);
    for (const name of ['Status', 'Priority', 'Assignee', 'Reviewer', 'Type', 'Sprint', 'Milestone', 'Parent']) expect(combo(d, name).disabled, name).toBe(false);
    expect((within(d).getByRole('spinbutton', { name: 'Points' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('someone outside the project gets “not found”', async () => {
    outsider = true;
    show('/projects/18/tasks/412');
    const d = await modal();
    expect(await within(d).findByText('This task is not there, or it is not yours to open.')).toBeTruthy();
  });
});

describe('acceptance 16: Blocked, Complete and offline', () => {
  it('Blocked asks for a reason before saving, and the reason goes with the move', async () => {
    show('/projects/18/tasks/412');
    const d = await modal();
    await within(d).findByDisplayValue('Task 412');
    fireEvent.click(combo(d, 'Status'));
    fireEvent.click(screen.getByRole('option', { name: 'Blocked' }));
    const ask = await dialogOf(/Why is TSK-0412 blocked/);
    expect(submitted).toEqual([]);
    expect((within(ask).getByRole('button', { name: 'Mark blocked' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(ask).getByRole('textbox'), { target: { value: 'Waiting for the bank' } });
    fireEvent.click(within(ask).getByRole('button', { name: 'Mark blocked' }));
    await waitFor(() => expect(submitted).toEqual([{ kind: 'move', taskId: 412, status: 'blocked', blockedReason: 'Waiting for the bank', baseUpdatedAt: '2026-10-09 08:00:00', label: 'Move TSK-0412 to Blocked' }]));
  });

  it('Complete stores completed (never done) and moves the card; Reopen sets to do', async () => {
    show('/projects/18/tasks/412');
    const d = await modal();
    await within(d).findByDisplayValue('Task 412');
    fireEvent.click(within(d).getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(submitted).toEqual([{ kind: 'move', taskId: 412, status: 'completed', baseUpdatedAt: '2026-10-09 08:00:00', label: 'Move TSK-0412 to Completed' }]));
    expect(call).not.toHaveBeenCalledWith('offline:submit', expect.objectContaining({ body: expect.objectContaining({ value: 'done' }) }));
    const board = screen.getByRole('grid', { name: 'Board' });
    await waitFor(() => expect(within(within(board).getByRole('row', { name: /^Completed/ })).getByRole('gridcell', { name: /TSK-0412/ })).toBeTruthy());
    fireEvent.click(await within(d).findByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(submitted).toContainEqual(expect.objectContaining({ kind: 'move', taskId: 412, status: 'todo' })));
  });

  it('offline: opens from the cache with a banner; status, a comment and logged time queue; everything else says it needs a connection', async () => {
    offline = true;
    show('/projects/18/tasks/412');
    const d = await modal();
    await within(d).findByDisplayValue('Task 412');
    expect(d.textContent).toContain('Offline — from the copy kept on this computer.');
    expect(((within(d).getByDisplayValue('Task 412')) as HTMLInputElement).title).toBe('Needs a connection');
    for (const name of ['Priority', 'Assignee', 'Sprint', 'Milestone', 'Type']) {
      expect(combo(d, name).disabled, name).toBe(true);
      expect(combo(d, name).title, name).toBe('Needs a connection');
    }
    expect((within(d).getByRole('button', { name: /Start timer/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(d).getByRole('button', { name: 'More actions' }));
    for (const m of within(d).getAllByRole('menuitem')) expect((m as HTMLButtonElement).disabled, m.textContent ?? '').toBe(true);
    // The status queues.
    fireEvent.click(combo(d, 'Status'));
    fireEvent.click(screen.getByRole('option', { name: 'In review' }));
    await waitFor(() => expect(submitted).toContainEqual(expect.objectContaining({ kind: 'move', taskId: 412, status: 'in_review' })));
    // A comment queues through the outbox, without files.
    const box = within(d).getByRole('textbox', { name: 'Comment' });
    box.innerHTML = '<p>Bank is down</p>';
    fireEvent.input(box);
    expect(within(d).queryByRole('button', { name: 'Attach a file' })).toBeNull();
    fireEvent.click(within(d).getByRole('button', { name: 'Send comment' }));
    await waitFor(() => expect(submitted).toContainEqual(expect.objectContaining({ kind: 'comment', taskId: 412, label: 'Comment on TSK-0412' })));
    // Logged time queues too (L).
    key('l');
    const log = await dialogOf(/Log time on TSK-0412/);
    fireEvent.change(within(log).getByPlaceholderText('1:30, 90m, 1.5h'), { target: { value: '1:15' } });
    fireEvent.click(within(log).getByRole('button', { name: 'Log time' }));
    await waitFor(() => expect(submitted).toContainEqual(expect.objectContaining({ kind: 'log', duration: '1:15', taskId: 412, projectId: 18 })));
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('what waits in the outbox says so, and what the server refused needs my choice', async () => {
    outbox = [
      { id: 'a', seq: 1, kind: 'comment', taskId: 412, label: 'Comment on TSK-0412', state: 'waiting', message: null, createdAt: '2026-10-09T15:11:00Z', status: null, theirs: null },
      { id: 'b', seq: 2, kind: 'move', taskId: 412, label: 'Move TSK-0412 to Blocked', state: 'refused', message: 'Say why the task is blocked', createdAt: '2026-10-09T15:12:00Z', status: 'blocked', theirs: null },
    ];
    show('/projects/18/tasks/412');
    act(() => events.get('projects:changed')!({ outbox }));
    const d = await modal();
    await waitFor(() => expect(d.textContent).toContain('Waiting to send: Comment on TSK-0412'));
    expect(d.textContent).toContain('Needs your choice: Move TSK-0412 to Blocked — Say why the task is blocked');
  });
});

describe('dependencies (PRJ-TED-04)', () => {
  it('adds a dependency on the same project, refuses a loop naming the tasks, and says the server’s refusal', async () => {
    show('/projects/18/tasks/412');
    const d = await modal();
    await within(d).findByDisplayValue('Task 412');
    fireEvent.click(within(d).getByRole('button', { name: '+ Add' }));
    // Waiting on the task this one blocks is a loop.
    fireEvent.click(combo(d, 'Task on this project'));
    expect(screen.queryByRole('option', { name: /TSK-0412/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /TSK-0418/ }));
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(422, 'Adding TSK-0418 as “waits on” would close a loop (TSK-0418 → TSK-0421 → TSK-0412 → TSK-0418) — not allowed.', null));
    fireEvent.click(within(d).getByRole('button', { name: 'Add' }));
    expect(await within(d).findByRole('alert')).toHaveProperty('textContent', 'Adding TSK-0418 as “waits on” would close a loop (TSK-0418 → TSK-0421 → TSK-0412 → TSK-0418) — not allowed.');
    expect(apiPost).toHaveBeenCalledWith('/api/projects/tasks/412/dependencies', { depends_on_id: 418 });
  });

  it('refuses a plain loop before asking the server', () => {
    const p = { dependencies: { waits_on: [], blocks: [{ id: 1, task_id: 421, task_number: 'TSK-0421', title: '', status: 'todo' as const }] } };
    return import('../../../src/modules/projects/TaskModalParts').then(({ loopOf }) => {
      expect(loopOf(p, 'waits_on', 421)).toBe('blocks');
      expect(loopOf(p, 'waits_on', 418)).toBeNull();
    });
  });
});

describe('keyboard (PRJ-TED-09)', () => {
  it('J/K walk the board’s cards behind without closing; Esc closes; ⌘L copies the link; ⌘Enter completes; ⌥⌘O opens a window', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    show('/projects/18/tasks/418');
    const d = await modal();
    await within(d).findByDisplayValue('Task 418');
    await screen.findByRole('gridcell', { name: /TSK-0421/ });
    key('j');
    expect(tab.go).toHaveBeenLastCalledWith('/projects/18/tasks/421');
    key('k'); // the first card: nothing before it
    expect(tab.go).toHaveBeenCalledTimes(1);
    key('l', { ctrlKey: true, code: 'KeyL' });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://ws.example/projects/18/tasks/418'));
    key('o', { ctrlKey: true, altKey: true, code: 'KeyO' });
    expect(openRouteInWindow).toHaveBeenCalledWith('/projects/18/tasks/418', 'TSK-0418 · Task 418');
    key('Enter', { ctrlKey: true });
    await waitFor(() => expect(submitted).toContainEqual(expect.objectContaining({ kind: 'move', taskId: 418, status: 'completed' })));
    key('Escape');
    expect(tab.go).toHaveBeenLastCalledWith('/projects/18/board');
  });

  it('T starts the timer on the task', async () => {
    show('/projects/18/tasks/412');
    const d = await modal();
    await within(d).findByDisplayValue('Task 412');
    key('t');
    await waitFor(() => expect(call).toHaveBeenCalledWith('projects:timerStart', { taskId: 412, projectId: 18 }));
  });

  it('stepTask walks the ids of the view behind', () => {
    expect(editor.stepTask([418, 421, 412], 421, 1)).toBe(412);
    expect(editor.stepTask([418, 421, 412], 421, -1)).toBe(418);
    expect(editor.stepTask([418, 421, 412], 412, 1)).toBeNull();
    expect(editor.stepTask([418, 421], 999, 1)).toBeNull();
  });
});

describe('opening from each place (PRJ-TED-01)', () => {
  it('the addresses: a task over a board, the list, My work, Time, Milestones and any view', () => {
    const at = (route: string) => {
      const [p, q = ''] = route.split('?');
      return viewOf(p!.slice(1).split('/'), new URLSearchParams(q));
    };
    expect(at('/projects/18/tasks/412')).toEqual({ view: { kind: 'board', projectId: 18, display: null }, taskId: 412 });
    expect(at('/projects/18/tasks/412?view=list')).toEqual({ view: { kind: 'board', projectId: 18, display: 'list' }, taskId: 412 });
    expect(at('/projects/my-work?task=412').taskId).toBe(412);
    expect(at('/projects/time?task=412')).toEqual({ view: { kind: 'time' }, taskId: 412 });
    expect(at('/projects/milestones?task=412')).toEqual({ view: { kind: 'milestones', projectId: null }, taskId: 412 });
    expect(at('/projects?task=412').taskId).toBe(412);
    expect(boardRoute(18, 412, 'list')).toBe('/projects/18/tasks/412?view=list');
    // Notifications land on these addresses (electron/services/projects/notices.ts noticeRoute, projects-desk.test.ts).
  });

  it('opens over My work, and My work opens it', async () => {
    show('/projects/my-work?task=412'); // also noticeRoute('overdue', '/tasks?task=412')
    await modal();
    cleanup();
    show('/projects/my-work');
    fireEvent.click(await screen.findByRole('button', { name: /^Task 418/ }));
    expect(tab.go).toHaveBeenCalledWith('/projects/my-work?task=418');
  });

  it('a notification’s link opens it over its project', async () => {
    show('/projects/18/tasks/412'); // noticeRoute('overdue', '/projects/18/tasks/412')
    expect(await modal()).toBeTruthy();
  });

  it('Time opens the task of an entry', async () => {
    show('/projects/time');
    fireEvent.click(await screen.findByRole('button', { name: 'Task 412' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/time?task=412');
  });

  it('Milestones opens a task under a milestone', async () => {
    show('/projects/milestones');
    fireEvent.click(await screen.findByRole('button', { name: /Tasks of Bidder onboarding live/ }));
    const list = await screen.findByRole('list', { name: 'Tasks of Bidder onboarding live' });
    fireEvent.click(await within(list).findByRole('button', { name: 'Task 421' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/milestones?task=421');
  });

  it('the list opens the focused row with Enter', async () => {
    show('/projects/18/board?view=list');
    const grid = await screen.findByRole('treegrid', { name: 'Tasks' });
    fireEvent.click(within(grid).getAllByRole('row').find((r) => r.textContent?.includes('TSK-0421'))!);
    key('Enter');
    expect(tab.go).toHaveBeenCalledWith('/projects/18/tasks/421?view=list');
  });
});

describe('the field router (§14.2)', () => {
  it('sends the status to the move, project fields to the project rule and Tasks fields to /api/tasks', () => {
    expect(editor.routeOf('status', 'tasks')).toBe('move');
    for (const f of ['priority', 'assignee_id', 'reviewer_id', 'task_type', 'sprint_id', 'milestone_id', 'parent_id', 'story_points', 'estimated_hours', 'is_billable', 'blocked_reason']) expect(editor.routeOf(f, 'tasks'), f).toBe('project');
    for (const f of ['title', 'description', 'tags', 'start_date', 'due_date', 'progress']) {
      expect(editor.routeOf(f, 'tasks'), f).toBe('tasks');
      expect(editor.routeOf(f, 'projects'), f).toBe('project');
    }
    expect(editor.projectBody('tags', ['a', 'b'])).toEqual({ tags: 'a, b' });
    expect(editor.projectBody('sprint_id', '')).toEqual({ sprint_id: null });
    expect(editor.projectBody('due_date', '2026-10-19T11:30:00Z')).toEqual({ due_date: '2026-10-19' });
  });

  it('patchTask goes where the router says; without one, the Tasks app’s PATCH as before', async () => {
    const tasksWriter = vi.fn(async () => undefined);
    const router = editor.projectRouter({ id: 412, number: 'TSK-0412', title: 'T', updatedAt: 'u1' }, 'tasks', tasksWriter);
    await patchTask({ id: 412, title: 'T' }, 'sprint_id', 8, 'Sprint', router);
    expect(apiPut).toHaveBeenCalledWith('/api/projects/tasks/412', { sprint_id: 8 });
    await patchTask({ id: 412, title: 'T' }, 'status', { status: 'blocked', blocked_reason: 'Bank' }, 'Status', router);
    expect(submitted).toEqual([{ kind: 'move', taskId: 412, status: 'blocked', blockedReason: 'Bank', baseUpdatedAt: 'u1', label: 'Move TSK-0412 to Blocked' }]);
    await patchTask({ id: 412, title: 'T' }, 'title', 'New', 'Rename', router);
    expect(tasksWriter).toHaveBeenCalledWith({ id: 412, title: 'T' }, 'title', 'New', 'Rename');
    await patchTask({ id: 5, title: 'T' }, 'status', 'done', 'Complete');
    expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ module: 'tasks', method: 'PATCH', path: '/api/tasks/5', body: { field: 'status', value: 'done' } }));
  });

  it('reads the project block, and an older server through the Projects read', () => {
    const d = editor.fromTasksRead(tasksRead(412, { manager: false }))!;
    expect(d.project).toMatchObject({ id: 18, code: 'PRJ-0018', company: 'TechHubiz (Pvt) Ltd', task_type: 'bug', status: 'todo', priority: 'high', story_points: 3, sprint: 'Sprint 7' });
    expect(d.project.options?.members).toEqual([{ user_id: ME, name: 'Asha Fernando' }, { user_id: 9, name: 'Kasun Silva' }]);
    expect(editor.access(d, 'status', false)).toEqual({ ok: true, reason: null });
    expect(editor.access(d, 'sprint_id', false)).toEqual({ ok: false, reason: 'You can see this but not change it' });
    expect(editor.access(d, 'status', true)).toEqual({ ok: true, reason: null });
    expect(editor.access(d, 'description', true)).toEqual({ ok: false, reason: 'Needs a connection' });
    expect(editor.fromTasksRead({ id: 1, title: 'Not on a project' })).toBeNull();
    const old = editor.fromProjectsRead({ task: row(412, 'completed', { assignee_id: ME }) as never, can: {} }, ME);
    expect(old.task.status).toBe('done');
    expect(old.project.status).toBe('completed');
    expect(editor.access(old, 'checklist', false).ok).toBe(true);
    expect(editor.access(old, 'sprint_id', false).ok).toBe(false);
    expect(editor.entryState({ lock_state: 'Sent back', locked: false } as never)).toEqual({ key: 'sent_back', label: 'Sent back', locked: false });
  });
});

describe('the Tasks app keeps its own editor', () => {
  it('opens the Tasks task, completes it as done through the Tasks endpoint', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/tasks/5') return { ...tasksRead(5), project: undefined, project_id: null, status: 'todo', can_edit: Object.fromEntries(ALL.map((f) => [f, true])) } as never;
      if (path.endsWith('/people')) return { owner_id: 3, people: [], can_manage: false, following: false } as never;
      if (path.endsWith('/attachments')) return { attachments: [] } as never;
      if (path.endsWith('/reminders')) return { reminders: [], recipients: [], timezone: 'UTC' } as never;
      return { users: [], organizations: [] } as never;
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaskDetail id={5} lists={[]} onClose={() => undefined} onOpen={() => undefined} />
      </QueryClientProvider>,
    );
    const d = await screen.findByRole('dialog', { name: 'Task details' });
    await within(d).findByDisplayValue('Task 5');
    expect(d.textContent).toContain('Tasks ›');
    fireEvent.click(within(d).getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ path: '/api/tasks/5', body: { field: 'status', value: 'done' } })));
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything());
  });
});
