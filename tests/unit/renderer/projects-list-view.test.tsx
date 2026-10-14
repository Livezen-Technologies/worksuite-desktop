// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiGet: vi.fn() }));
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

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['projects', '18', 'board'], go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/${tab.path.join('/')}?${tab.query}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
  openRouteInWindow: vi.fn(),
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= () => undefined;

const { apiGetMeta, apiPost, apiPut, apiGet } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { openRouteInWindow } = await import('../../../src/core/tab-context');
const { app } = await import('../../../src/core/app-state');
const { resetTaskViewForTests } = await import('../../../src/modules/projects/view-prefs');
const { default: ProjectsPage } = await import('../../../src/modules/projects/ProjectsPage');

const today = new Date().toISOString().slice(0, 10);
const t = (id: number, status: string, over: Record<string, unknown> = {}) => ({
  id, task_number: `TSK-0${id}`, title: `Task ${id}`, description: null, status, priority: 'medium', task_type: 'task', project_id: 18, project: 'e-Auction portal', project_code: 'PRJ-0018',
  sprint_id: 7, sprint: 'Sprint 7', assignee_id: 7, assignee: 'Asha Fernando', reviewer_id: null, reviewer: null, estimated_hours: null, logged_hours: '0', logged_minutes: 0,
  start_date: null, due_date: null, overdue: false, blocked_reason: null, is_billable: true, tags: null, progress: 0, position: id, completed_at: null,
  updated_at: '2026-10-09 08:00:00', updated_by: 'Asha', timer_running: false, ...over,
});

let offline = false;
function answers(path: string): unknown {
  if (path === '/api/projects') return { projects: [{ id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active', health: 'at_risk', tasks: 9, tasks_done: 4 }], total: 1 };
  if (path === '/api/projects/counts') return { projects: 1, my_work: 7, milestones_due: 0, time_waiting: 0, risks_open: 0, changes_waiting: 0 };
  if (path === '/api/projects/18') return { project: { id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active' }, members: [{ id: 1, user_id: 7, name: 'Asha Fernando', role: 'lead' }, { id: 2, user_id: 9, name: 'Kasun Silva', role: 'member' }], sprints: [{ id: 7, name: 'Sprint 7', status: 'active', start_date: today, end_date: today }] };
  if (path === '/api/projects/tasks')
    return { tasks: [t(418, 'todo'), t(421, 'todo', { task_type: 'bug' }), t(409, 'blocked', { blocked_reason: 'Bank sandbox', due_date: '2026-09-24' }), t(412, 'in_progress'), t(402, 'in_review'), t(398, 'testing'), t(396, 'completed')], wip_limits: { in_progress: 1 } };
  return {};
}

const tree = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ProjectsPage tabId="t1" route="/projects/18/board" active />
  </QueryClientProvider>
);
const key = (k: string, o: KeyboardEventInit = {}) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o })));
const rowOf = (n: number) => screen.getByRole('row', { name: new RegExp(`TSK-0${n}`) });

beforeEach(() => {
  offline = false;
  localStorage.clear();
  resetTaskViewForTests();
  app.set({ auth: { stage: 'ready', user: { id: 7 }, server: { origin: 'https://ws.example' } } as never, session: { mode: 'account' } as never });
  tab.path = ['projects', '18', 'board'];
  tab.query = new URLSearchParams();
  tab.go = vi.fn();
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string) => ({ data: answers(path) as never, offline, cachedAt: offline ? '2026-10-09T08:00:00Z' : null }));
  vi.mocked(apiGet).mockReset().mockResolvedValue({ prefs: null } as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiPost).mockReset();
  vi.mocked(toast).mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (ch: string) => {
    if (ch === 'projects:outbox') return [] as never;
    if (ch === 'projects:timer') return { available: true, running: null, paused: null, recent: [], todayMinutes: 0, weekMinutes: 0, idleSince: null, offline: false, error: null, checkedAt: null } as never;
    if (ch === 'projects:submit') return { delivered: true, queued: false, id: null, data: null, error: null } as never;
    if (ch === 'files:saveText') return '/home/me/Downloads/PRJ-0018 tasks.csv' as never;
    return undefined as never;
  });
});
afterEach(cleanup);

describe('Board ⇄ List (PRJ-LST-01/02, acceptance #13)', () => {
  it('switches with the filter and the selected task kept, and reopens the project on the view last used', async () => {
    const r = render(tree());
    await screen.findByRole('grid', { name: 'Board' });
    key('j');
    expect(screen.getByRole('gridcell', { name: /TSK-0418/ }).getAttribute('aria-selected')).toBe('true');
    key('f', { ctrlKey: true, code: 'KeyF' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter cards' }), { target: { value: '041' } });
    // Ctrl+Shift+L, the switch's own key.
    key('L', { ctrlKey: true, shiftKey: true, code: 'KeyL' });
    expect(tab.go).toHaveBeenCalledWith('/projects/18/board?view=list');
    tab.query = new URLSearchParams('view=list');
    r.rerender(tree());
    const grid = await screen.findByRole('treegrid', { name: 'Tasks' });
    expect(screen.getByText('e-Auction portal — List')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Filter tasks' }) as HTMLInputElement).value).toBe('041');
    expect(rowOf(418).getAttribute('aria-current')).toBe('true');
    expect(within(grid).queryByRole('row', { name: /TSK-0421/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');
    // New window keeps the view.
    key('o', { ctrlKey: true, altKey: true, code: 'KeyO' });
    expect(openRouteInWindow).toHaveBeenCalledWith('/projects/18/board?view=list', 'PRJ-0018 · e-Auction portal');
    // Remembered here and sent to /api/prefs, per project and as the default.
    await waitFor(() => expect(vi.mocked(apiPut).mock.calls.map((c) => c[0])).toContain('/api/prefs/projects.task_view.p18'), { timeout: 2000 });
    cleanup();
    // Reopened with no view in the address: the list, as left.
    tab.query = new URLSearchParams();
    render(tree());
    expect(await screen.findByRole('treegrid', { name: 'Tasks' })).toBeTruthy();
  });

  it('groups by status in board order with WIP warning and Completed collapsed, as a treegrid with aria-sort', async () => {
    tab.path = ['projects', '18', 'list'];
    render(tree());
    const grid = await screen.findByRole('treegrid', { name: 'Tasks' });
    const groups = within(grid).getAllByRole('row').filter((r) => r.getAttribute('aria-level') === '1');
    expect(groups.map((g) => g.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['▾To do2', '▾In progress2WIP 2 of 1', '▾In review1', '▾Testing1', '▸Completed1']);
    expect(groups[4]!.getAttribute('aria-expanded')).toBe('false');
    expect(within(grid).queryByRole('row', { name: /TSK-0396/ })).toBeNull();
    expect(rowOf(409).textContent).toContain('Blocked — Bank sandbox');
    expect(rowOf(421).textContent).toContain('Bug');
    const due = within(grid).getAllByRole('columnheader').find((h) => h.textContent?.startsWith('Due'))!;
    expect(due.getAttribute('aria-sort')).toBe('none');
    fireEvent.click(within(due).getByRole('button'));
    expect(due.getAttribute('aria-sort')).toBe('ascending');
    // ← / → on a group header collapse and expand it.
    key('End');
    key('ArrowRight');
    await waitFor(() => expect(rowOf(396)).toBeTruthy());
  });
});

describe('a long list (PRJ-LST accessibility: chunked beyond 150 rows)', () => {
  it('draws 150 rows at a time, more on request or as the keyboard reaches them', async () => {
    const many = Array.from({ length: 320 }, (_, i) => t(1000 + i, 'todo'));
    vi.mocked(apiGetMeta).mockImplementation(async (path: string) => ({ data: (path === '/api/projects/tasks' ? { tasks: many } : answers(path)) as never, offline: false, cachedAt: null }));
    tab.query = new URLSearchParams('view=list');
    render(tree());
    const grid = await screen.findByRole('treegrid', { name: 'Tasks' });
    const rows = () => within(grid).getAllByRole('row').filter((r) => r.getAttribute('aria-level') === '2').length;
    expect(rows()).toBe(149);
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    expect(rows()).toBe(299);
    key('End');
    await waitFor(() => expect(rows()).toBe(320));
    expect(screen.getByText(/320 tasks/)).toBeTruthy();
  });
});

describe('the list writes as the board does (PRJ-LST-07/08, acceptance #14)', () => {
  it('⇧→ in the list sends the board’s move, the same outbox entry', async () => {
    tab.query = new URLSearchParams('view=list');
    render(tree());
    await screen.findByRole('treegrid', { name: 'Tasks' });
    fireEvent.click(rowOf(409));
    key('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(call).toHaveBeenCalledWith('projects:submit', { kind: 'move', taskId: 409, status: 'in_review', baseUpdatedAt: '2026-10-09 08:00:00', label: 'Move TSK-0409 to In review' }));
  });

  it('Blocked from the row asks why, and the reason goes with the move', async () => {
    tab.query = new URLSearchParams('view=list');
    render(tree());
    await screen.findByRole('treegrid', { name: 'Tasks' });
    fireEvent.click(within(rowOf(418)).getByRole('button', { name: /^Status: To do/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Blocked/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Waiting for the bank' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark blocked' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('projects:submit', { kind: 'move', taskId: 418, status: 'blocked', blockedReason: 'Waiting for the bank', baseUpdatedAt: '2026-10-09 08:00:00', label: 'Move TSK-0418 to Blocked' }));
  });

  it('a bulk move of three tasks reports “2 updated, 1 refused” and names the task', async () => {
    vi.mocked(apiPost).mockImplementation(async (path: string) => (path === '/api/projects/tasks/bulk' ? { done: [418, 421], refused: [{ id: 412, number: 'TSK-0412', reason: 'Say why the task is blocked' }] } : {}) as never);
    tab.query = new URLSearchParams('view=list');
    render(tree());
    await screen.findByRole('treegrid', { name: 'Tasks' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick TSK-0418' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick TSK-0412' }), { shiftKey: true });
    const bar = screen.getByRole('toolbar', { name: 'Change the ticked tasks' });
    expect(bar.textContent).toContain('4 selected');
    // Space on the focused row unticks it: three left.
    fireEvent.click(rowOf(409));
    key(' ');
    expect(bar.textContent).toContain('3 selected');
    fireEvent.click(within(bar).getByRole('button', { name: /Move to status/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Blocked/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark blocked' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/tasks/bulk', { ids: [418, 421, 412], set: { status: 'blocked' } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('warning', '2 updated, 1 refused — TSK-0412: Say why the task is blocked.'));
    expect(screen.getByRole('status').textContent).toContain('2 updated, 1 refused');
    // The refused one stays ticked, to try again.
    expect(screen.getByRole('toolbar', { name: 'Change the ticked tasks' }).textContent).toContain('1 selected');
  });

  it('a server without tasks/bulk gets the same edits one at a time', async () => {
    const { ApiError } = await import('../../../src/core/api');
    vi.mocked(apiPost).mockImplementation(async (path: string) => {
      if (path === '/api/projects/tasks/bulk') throw new ApiError(404, 'Not found', null);
      if (path === '/api/projects/tasks/402/move') throw new ApiError(422, 'Say why the task is blocked', null);
      return {} as never;
    });
    tab.query = new URLSearchParams('view=list');
    render(tree());
    await screen.findByRole('treegrid', { name: 'Tasks' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick TSK-0418' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick TSK-0402' }));
    fireEvent.click(screen.getByRole('button', { name: /Move to status/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Testing/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('warning', '1 updated, 1 refused — TSK-0402: Say why the task is blocked.'));
  });

  it('exports the rows as shown through the save dialog, with a BOM', async () => {
    tab.query = new URLSearchParams('view=list');
    render(tree());
    await screen.findByRole('treegrid', { name: 'Tasks' });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('files:saveText', expect.objectContaining({ name: `PRJ-0018 tasks ${today}.csv` })));
    const text = (vi.mocked(call).mock.calls.find((c) => c[0] === 'files:saveText')![1] as { text: string }).text;
    expect(text.startsWith('﻿Number,Title,Status,Assignee,Priority,Due,Sprint,Pts,Logged / est.')).toBe(true);
    expect(text.split('\r\n')).toHaveLength(9);
  });

  it('offline: status still moves (queued), every other edit and bulk wait for a connection and say why', async () => {
    offline = true;
    tab.query = new URLSearchParams('view=list');
    render(tree());
    await screen.findByRole('treegrid', { name: 'Tasks' });
    expect((within(rowOf(418)).getByRole('button', { name: /^Status/ }) as HTMLButtonElement).disabled).toBe(false);
    const assignee = within(rowOf(418)).getByRole('button', { name: /^Assignee/ }) as HTMLButtonElement;
    expect(assignee.disabled).toBe(true);
    expect(assignee.title).toMatch(/needs? a connection|Waits for a connection/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick TSK-0418' }));
    const bulk = within(screen.getByRole('toolbar', { name: 'Change the ticked tasks' })).getByRole('button', { name: /Move to status/ }) as HTMLButtonElement;
    expect(bulk.disabled).toBe(true);
    expect(bulk.title).toBe('Changing several tasks at once needs a connection');
  });
});
