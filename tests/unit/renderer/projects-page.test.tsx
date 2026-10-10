// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { ProjectsOutboxItem } from '@shared/projects';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGetMeta: vi.fn(), apiPost: vi.fn() }));
const events = vi.hoisted(() => new Map<string, (p: unknown) => void>());
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (ch: string, cb: (p: unknown) => void) => (events.set(ch, cb), () => events.delete(ch)),
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String(e),
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

const { apiGetMeta } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
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
  if (path === '/api/projects/counts') return { projects: 1, my_work: 7, milestones_due: 0, time_waiting: 12, risks_open: 0, changes_waiting: 0 };
  if (path === '/api/projects/18') return { project: { id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active' }, sprints: [{ id: 7, name: 'Sprint 7', status: 'active', start_date: today, end_date: today }] };
  if (path === '/api/projects/tasks') return { tasks: [t(418, 'todo'), t(421, 'todo'), t(409, 'blocked', { blocked_reason: 'Bank sandbox', due_date: '2026-09-24' }), t(412, 'in_progress'), t(402, 'in_review'), t(398, 'testing'), t(396, 'completed')] };
  return {};
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectsPage tabId="t1" route="/projects/18/board" active />
    </QueryClientProvider>,
  );

beforeEach(() => {
  offline = false;
  tab.path = ['projects', '18', 'board'];
  tab.query = new URLSearchParams();
  tab.go = vi.fn();
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string) => ({ data: answers(path) as never, offline, cachedAt: offline ? '2026-10-09T08:00:00Z' : null }));
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (ch: string) => {
    if (ch === 'projects:outbox') return [] as never;
    if (ch === 'projects:timer') return { available: true, running: null, paused: null, recent: [], todayMinutes: 0, weekMinutes: 0, idleSince: null, offline: false, error: null, checkedAt: null } as never;
    if (ch === 'projects:submit') return { delivered: true, queued: false, id: null, data: null, error: null } as never;
    return undefined as never;
  });
});
afterEach(cleanup);

describe('Projects in a tab (D01)', () => {
  it('shows the board with its columns, counts, sprint line and cards', async () => {
    show();
    const board = await screen.findByRole('grid', { name: 'Board' });
    expect(screen.getByText('e-Auction portal — Board')).toBeTruthy();
    expect(screen.getByText(/PRJ-0018 · Sprint 7 · day 1 of 1/)).toBeTruthy();
    expect(within(board).getAllByRole('row').map((r) => r.getAttribute('aria-label'))).toEqual(['To do, 2', 'In progress, 2', 'In review, 1', 'Testing, 1', 'Completed, 1']);
    const blocked = within(board).getByRole('gridcell', { name: /TSK-0409/ });
    expect(blocked.textContent).toContain('Blocked');
    expect(blocked.textContent).toMatch(/\d+ d late/);
    const rail = screen.getByRole('navigation', { name: 'Projects' });
    expect(rail.textContent).toContain('My work7');
    expect(rail.textContent).toContain('Time & approvals12');
    expect(screen.getByText(/J \/ K move · ←\/→ change column/)).toBeTruthy();
  });

  it('is driven by the keyboard: J/K, ←/→, Shift+→ moves the card, Enter opens it', async () => {
    show();
    await screen.findByRole('grid', { name: 'Board' });
    const key = (k: string, o: KeyboardEventInit = {}) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o })));
    key('j');
    expect(screen.getByRole('gridcell', { name: /TSK-0418/ }).getAttribute('aria-selected')).toBe('true');
    key('j');
    expect(screen.getByRole('gridcell', { name: /TSK-0421/ }).getAttribute('aria-selected')).toBe('true');
    key('ArrowRight');
    expect(screen.getByRole('gridcell', { name: /TSK-0412/ }).getAttribute('aria-selected')).toBe('true');
    key('k');
    expect(screen.getByRole('gridcell', { name: /TSK-0409/ }).getAttribute('aria-selected')).toBe('true');
    key('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(call).toHaveBeenCalledWith('projects:submit', { kind: 'move', taskId: 409, status: 'in_review', baseUpdatedAt: '2026-10-09 08:00:00', label: 'Move TSK-0409 to In review' }));
    key('Enter');
    expect(tab.go).toHaveBeenCalledWith('/projects/18/tasks/409');
  });

  it('offline: says what is kept, lists the outbox in order and asks before overwriting (D04)', async () => {
    offline = true;
    const items: ProjectsOutboxItem[] = [
      { id: 'a', seq: 1, kind: 'move', taskId: 402, label: 'Move TSK-0402 to In review', state: 'conflict', message: null, createdAt: '2026-10-09T15:11:00Z', status: 'in_review', theirs: { status: 'completed', updatedAt: '2026-10-09 15:20:00', updatedBy: 'Sachini', number: 'TSK-0402', title: 'Broker role permissions' } },
      { id: 'b', seq: 2, kind: 'comment', taskId: 412, label: 'Comment on TSK-0412', state: 'waiting', message: null, createdAt: '2026-10-09T15:14:00Z', status: null, theirs: null },
    ];
    vi.mocked(call).mockImplementation(async (ch: string) => {
      if (ch === 'projects:outbox') return items as never;
      if (ch === 'projects:resolve') return [] as never;
      return undefined as never;
    });
    show();
    // The outbox as the main process announces it (projects:changed).
    act(() => events.get('projects:changed')!({ outbox: items }));
    expect(await screen.findByText(/You’re working offline\./)).toBeTruthy();
    expect(screen.getByText(/Approvals, budget changes and change-request decisions wait for a connection/)).toBeTruthy();
    const outbox = await screen.findByRole('complementary', { name: 'Outbox' });
    await waitFor(() => expect(within(outbox).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Move TSK-0402 to In reviewWill ask'), expect.stringContaining('Comment on TSK-0412Waiting')]));
    expect(within(outbox).getByText('Needs your choice when you reconnect')).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /TSK-0412/ }).textContent).toContain('Note waiting');
    expect((screen.getByRole('button', { name: /New task/ }) as HTMLButtonElement).disabled).toBe(true);
    // Applying mine needs the server; keeping theirs does not.
    expect((within(outbox).getByRole('button', { name: 'Reopen to In review' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(outbox).getByRole('button', { name: 'Keep Completed' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('projects:resolve', { id: 'a', choice: 'theirs' }));
  });
});
