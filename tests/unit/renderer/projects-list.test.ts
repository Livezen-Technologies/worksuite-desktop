// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { Task } from '../../../src/modules/projects/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn() }));

const { apiGet, apiPut } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const L = await import('../../../src/modules/projects/list');
const P = await import('../../../src/modules/projects/view-prefs');

let seq = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: ++seq,
  task_number: `TSK-${String(seq).padStart(4, '0')}`,
  title: `Task ${seq}`,
  description: null,
  status: 'todo',
  priority: 'medium',
  task_type: 'task',
  project_id: 18,
  project: 'e-Auction portal',
  project_code: 'PRJ-0018',
  sprint_id: null,
  sprint: null,
  assignee_id: null,
  assignee: null,
  reviewer_id: null,
  reviewer: null,
  estimated_hours: null,
  logged_hours: '0',
  logged_minutes: 0,
  start_date: null,
  due_date: null,
  overdue: false,
  blocked_reason: null,
  is_billable: true,
  tags: null,
  progress: 0,
  position: seq,
  completed_at: null,
  updated_at: null,
  updated_by: null,
  timer_running: false,
  ...over,
});
const nums = (ts: Task[]) => ts.map((t) => t.task_number);

describe('the list’s sorting (PRJ-LST-05)', () => {
  const a = task({ priority: 'low', due_date: '2026-10-20', status: 'testing', story_points: 3 });
  const b = task({ priority: 'critical', due_date: null, status: 'todo', story_points: 5 });
  const c = task({ priority: 'high', due_date: '2026-10-15', status: 'blocked', story_points: null });
  it('ranks priority critical → low, status in board order (blocked with In progress), and puts empty values last both ways', () => {
    expect(nums(L.sortTasks([a, b, c], ['priority']))).toEqual(nums([b, c, a]));
    expect(nums(L.sortTasks([a, b, c], ['-priority']))).toEqual(nums([a, c, b]));
    expect(nums(L.sortTasks([a, b, c], ['status']))).toEqual(nums([b, c, a]));
    expect(nums(L.sortTasks([a, b, c], ['due']))).toEqual(nums([c, a, b]));
    expect(nums(L.sortTasks([a, b, c], ['-due']))).toEqual(nums([a, c, b]));
    expect(nums(L.sortTasks([a, b, c], ['-points']))).toEqual(nums([b, a, c]));
  });
  it('defaults to the board position, and a header click goes asc → desc → off; shift-click adds a key', () => {
    expect(nums(L.sortTasks([a, b, c], []))).toEqual(nums([b, c, a]));
    expect(L.nextSort([], 'due', false)).toEqual(['due']);
    expect(L.nextSort(['due'], 'due', false)).toEqual(['-due']);
    expect(L.nextSort(['-due'], 'due', false)).toEqual([]);
    expect(L.nextSort(['due'], 'priority', false)).toEqual(['priority']);
    expect(L.nextSort(['due'], 'priority', true)).toEqual(['due', 'priority']);
    expect(L.nextSort(['due', 'priority'], 'priority', true)).toEqual(['due', '-priority']);
    expect(L.nextSort(['due', '-priority'], 'priority', true)).toEqual(['due']);
    expect(L.sortOf(['due', '-priority'], 'priority')).toBe('descending');
    expect(L.sortOf(['due'], 'title')).toBe('none');
  });
});

describe('the list’s groups and filters (PRJ-LST-04, 06)', () => {
  const today = '2026-10-14';
  const tasks = [
    task({ status: 'in_progress', story_points: 5, assignee_id: 7, assignee: 'Asha', estimated_hours: '30', due_date: '2026-10-12' }),
    task({ status: 'blocked', blocked_reason: 'Bank sandbox', story_points: 2, assignee_id: 7, assignee: 'Asha', estimated_hours: '10' }),
    task({ status: 'todo', task_type: 'bug', assignee_id: 9, assignee: 'Kasun' }),
    task({ status: 'completed', story_points: 8, due_date: '2026-10-01' }),
  ];
  it('groups by status in board order with counts, points and the WIP warning; blocked work sits under In progress', () => {
    const g = L.groupTasks(tasks, 'status', { wip: { in_progress: 1 } });
    expect(g.map((x) => [x.key, x.tasks.length, x.points, x.wip])).toEqual([
      ['status:todo', 1, 0, null],
      ['status:in_progress', 2, 7, 'WIP 2 of 1'],
      ['status:completed', 1, 8, null],
    ]);
  });
  it('groups by assignee with the open count and load, the unassigned last', () => {
    const g = L.groupTasks(tasks, 'assignee', { members: [{ user_id: 7, name: 'Asha', capacity_hours: '40' }] });
    expect(g.map((x) => [x.label, x.note])).toEqual([
      ['Asha', '2 open · load 100%'],
      ['Kasun', '1 open'],
      ['Unassigned', '0 open'],
    ]);
  });
  it('applies the quick filters, and the board’s text filter', () => {
    expect(L.chipFilter(tasks, ['mine'], 7, today)).toHaveLength(2);
    expect(L.chipFilter(tasks, ['overdue'], 7, today)).toEqual([tasks[0]]);
    expect(L.chipFilter(tasks, ['blocked'], 7, today)).toEqual([tasks[1]]);
    expect(L.chipFilter(tasks, ['bugs'], 7, today)).toEqual([tasks[2]]);
    expect(L.chipFilter(tasks, ['hide_completed'], 7, today)).toHaveLength(3);
    expect(L.textFilter(tasks, 'kasun')).toEqual([tasks[2]]);
  });
  it('says when a task is due, late in words, and logged against the estimate', () => {
    expect(L.dueWords({ due_date: '2026-10-12', status: 'todo' }, today)).toEqual({ label: '2 days late', late: true });
    expect(L.dueWords({ due_date: '2026-10-13', status: 'todo' }, today)).toEqual({ label: '1 day late', late: true });
    expect(L.dueWords({ due_date: '2026-10-17', status: 'todo' }, today)).toEqual({ label: '17 Oct', late: false });
    expect(L.loggedWords({ logged_minutes: 570, estimated_hours: '8.00' })).toEqual({ label: '9:30 / 8 h', over: true });
    expect(L.loggedWords({ logged_minutes: 70, estimated_hours: '3' })).toEqual({ label: '1:10 / 3 h', over: false });
  });
});

describe('the list’s CSV and bulk answer (PRJ-LST-08, 10)', () => {
  it('exports the rows and columns as shown, UTF-8 with a BOM, quoted where needed and safe from formulas', () => {
    const csv = L.toCsv([task({ task_number: 'TSK-0042', title: 'ලියාපදිංචිය, "quoted"', status: 'blocked', blocked_reason: 'Bank' }), task({ task_number: 'TSK-0043', title: '=SUM(A1)' })], ['number', 'title', 'status'], '2026-10-14');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual(['Number,Title,Status', 'TSK-0042,"ලියාපදිංචිය, ""quoted"" (blocked: Bank)",Blocked', `TSK-0043,"'=SUM(A1)",To do`, '']);
    expect(L.csvFileName('PRJ-0018', '2026-10-14')).toBe('PRJ-0018 tasks 2026-10-14.csv');
  });
  it('reports a bulk answer as “2 updated, 1 refused” and names the task', () => {
    expect(L.bulkSummary({ done: [1, 2], refused: [{ id: 3, number: 'TSK-0409', reason: 'Say why the task is blocked' }] })).toBe('2 updated, 1 refused — TSK-0409: Say why the task is blocked');
    expect(L.bulkSummary({ done: [1], refused: [] }, 'deleted')).toBe('1 deleted');
  });
  it('reads a stored layout defensively, keeping Number and Title', () => {
    expect(L.normaliseTaskView({ view: 'list', group: 'nope', sort: ['due', '-bogus', '-due'], columns: ['status'], chips: ['mine', 'x'] })).toEqual({
      view: 'list',
      group: 'status',
      sort: ['-due'],
      columns: ['number', 'title', 'status'],
      collapsed: ['status:completed'],
      chips: ['mine'],
    });
    expect(L.normaliseTaskView(null)).toBeNull();
  });
});

describe('the remembered view (PRJ-LST-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    P.resetTaskViewForTests();
    app.set({ auth: { stage: 'ready', user: { id: 7 }, server: { origin: 'https://ws.example' } } as never, session: { mode: 'account' } as never });
    vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
    vi.mocked(apiGet).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('keeps a change here at once and as the person’s default, and sends both scopes a moment later', async () => {
    expect(P.recallTaskView(18).view).toBe('board');
    P.rememberTaskView(18, { view: 'list', group: 'assignee' });
    expect(P.recallTaskView(18)).toMatchObject({ view: 'list', group: 'assignee' });
    // Another project not opened yet starts from the default.
    expect(P.recallTaskView(21).view).toBe('list');
    await vi.advanceTimersByTimeAsync(P.TASK_VIEW_SEND_DELAY_MS + 10);
    expect(vi.mocked(apiPut).mock.calls.map((c) => c[0]).sort()).toEqual(['/api/prefs/projects.task_view', '/api/prefs/projects.task_view.p18']);
    expect(vi.mocked(apiPut).mock.calls[0]![1]).toMatchObject({ prefs: { view: 'list', group: 'assignee' } });
    // Read back from this computer (offline, a new window).
    P.resetTaskViewForTests();
    expect(P.recallTaskView(18).view).toBe('list');
  });

  it('takes the server’s copy when nothing here is unsent, and keeps the unsent one when the server is out of reach', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path.endsWith('.p18') ? { prefs: { view: 'list', group: 'sprint', sort: [], columns: [], collapsed: [], chips: [] } } : { prefs: null }) as never);
    await P.syncTaskView(18);
    expect(P.recallTaskView(18)).toMatchObject({ view: 'list', group: 'sprint' });
    vi.mocked(apiPut).mockRejectedValue(new Error('offline'));
    P.rememberTaskView(18, { view: 'board' });
    await vi.advanceTimersByTimeAsync(P.TASK_VIEW_SEND_DELAY_MS + 10);
    await P.syncTaskView(18);
    expect(P.recallTaskView(18).view).toBe('board');
  });
});
