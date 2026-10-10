// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The Projects app's DELIVERY screens (W08–W11 in the desktop): Timeline & Gantt, Milestones & billing, Sprints,
 * Team workload and Time & approvals' queue and summary — rendered in the tab, calling the web's endpoints, gated by
 * the server's `can`, and waiting for a connection offline.
 */

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGetMeta: vi.fn(), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['projects'], go: (_r: string) => undefined as void, openLink: (_l: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/${tab.path.join('/')}?${tab.query}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: (l: string) => tab.openLink(l) }),
  useTabTitle: () => undefined,
  openRouteInWindow: vi.fn(),
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= () => undefined;

const { apiGetMeta, apiGet, apiPost, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { default: ProjectsPage } = await import('../../../src/modules/projects/ProjectsPage');

const today = new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let offline = false;
let manage = true;
const queries: Array<{ path: string; query: unknown }> = [];

const milestone = (id: number, over: Record<string, unknown> = {}) => ({
  id, project_id: 18, project: 'e-Auction portal', project_code: 'PRJ-0018', name: `Milestone ${id}`, due_date: plusDays(6), status: 'open', owner: 'Nimal Perera', owner_id: 3,
  bill_amount: '2000000', currency: 'LKR', tasks: 29, tasks_done: 18, progress: 62, overdue: false, days: 6, achieved_at: null, description: null, achieved_note: null,
  invoice_status: 'not_invoiced', invoice_id: null, invoice_number: null, invoice_paid: false, ...over,
});
const sprint = (id: number, status: string, over: Record<string, unknown> = {}) => ({
  id, project_id: 18, project: 'e-Auction portal', project_code: 'PRJ-0018', name: `Sprint ${id}`, goal: id === 7 ? 'Bidders can register and pay' : null, status,
  start_date: today, end_date: plusDays(9), retrospective: null, started_at: status === 'active' ? today : null,
  total_points: 39, done_points: 21, total_tasks: 12, done_tasks: 7, committed_points: 34, added_points: 5, percent: 54,
  days: [{ date: today, remaining: 39, done: 0, ideal: 39 }, { date: plusDays(9), remaining: null, done: null, ideal: 0 }], ...over,
});
const entry = (id: number, user: string, userId: number, over: Record<string, unknown> = {}) => ({
  id, user, user_id: userId, project: 'e-Auction portal', project_code: 'PRJ-0018', project_id: 18, task: `Task ${id}`, task_number: `TSK-0${id}`, task_id: id,
  on_date: today, started_at: null, minutes: 135, duration: '2:15', is_billable: true, note: 'Reproduced on Safari', running: false, approved: false, state: 'pending', locked: false,
  is_mine: false, value: '14625', currency: 'LKR', ...over,
});

function answers(path: string): unknown {
  // The company selector's list (company.tsx): the caller's own company is the one the screens show.
  if (path === '/api/projects/companies') return { items: [{ id: 1, name: 'TechHubiz', currency: 'LKR' }], current: 1 };
  if (path === '/api/projects') return { projects: [{ id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active', health: 'on_track' }], total: 1 };
  if (path === '/api/projects/counts') return { projects: 1, my_work: 0, milestones_due: 2, time_waiting: 3, risks_open: 0, changes_waiting: 0 };
  if (path === '/api/projects/18/schedule')
    return {
      tasks: [
        { id: 396, task_number: 'TSK-0396', title: 'Lot catalogue search', status: 'completed', progress: 100, start_date: null, due_date: null, estimated_hours: '40', duration_days: 6, earliest_start: 0, earliest_finish: 6, latest_start: 0, latest_finish: 6, slack: 0, critical: true, start: plusDays(-7), finish: plusDays(-1), milestone_id: null },
        { id: 402, task_number: 'TSK-0402', title: 'Broker role permissions', status: 'in_review', progress: 90, start_date: null, due_date: null, estimated_hours: '24', duration_days: 4, earliest_start: 6, earliest_finish: 10, latest_start: 12, latest_finish: 16, slack: 6, critical: false, start: plusDays(0), finish: plusDays(4), milestone_id: null },
      ],
      dependencies: [{ id: 1, task_id: 402, depends_on_id: 396, type: 'finish_start', lag_days: 2 }],
      duration_days: 31, critical_path: [396], cycle: null, hours_per_day: 8, project_start: plusDays(-7), planned_end: plusDays(20), baseline_end: plusDays(14), forecast_finish: plusDays(34), working_days_late: 14,
      milestones: [{ id: 5, name: 'Bidder onboarding live', due_date: plusDays(10), status: 'open' }], holidays: [], working_days: [1, 2, 3, 4, 5],
    };
  if (path === '/api/projects/milestones')
    return {
      milestones: [milestone(1), milestone(2, { name: 'Workshop pilot', status: 'achieved', achieved_at: today, invoice_status: 'ready', tasks_done: 29 }), milestone(3, { name: 'Auction engine beta', status: 'achieved', invoice_status: 'invoiced', invoice_id: 388, invoice_number: 'INV-2026-0388', invoice_paid: true })],
      counts: { open: 9, overdue: 1, achieved: 14, missed: 2, all: 26 },
      ready: { total: '3350000', currency: 'LKR', count: 3 },
      can: { manage },
    };
  if (path === '/api/projects/sprints') return { sprints: [sprint(8, 'planned'), sprint(7, 'active')], can: { manage } };
  if (path === '/api/projects/sprints/7')
    return {
      sprint: sprint(7, 'active'),
      tasks: [{ id: 412, task_number: 'TSK-0412', title: 'Bidder KYC document upload', status: 'in_progress', assignee: 'Ayesha Fernando', story_points: 5 }],
      velocity: { sprints: [{ id: 6, name: 'Sprint 6', committed: 34, delivered: 31 }, { id: 7, name: 'Sprint 7', committed: 34, delivered: 21 }], average: 31.5 },
      forecast: { label: 'on_pace', needs_per_day: 4.5, ideal_today: 21.7 },
      day_of: { day: 4, of: 9 },
      can: { manage },
    };
  if (path === '/api/projects/workload')
    return { weeks: [today, plusDays(7)], people: [{ user_id: 1, name: 'Kasun Silva', cells: [{ hours: '48', capacity: '40', percent: 120 }, { hours: '20', capacity: '40', percent: 50 }] }] };
  if (path === '/api/projects/time') return { entries: [{ ...entry(90, 'Me', 9, { is_mine: true }), state: 'sent_back', sent_back_note: 'Wrong task' }], week_start: today, week_end: today, total_minutes: 135, can: { time: true, time_approve: true } };
  if (path === '/api/projects/time/queue')
    return {
      week_start: today, week_end: plusDays(6),
      entries: [entry(1, 'Kasun Silva', 1), entry(2, 'Kasun Silva', 1, { is_billable: false }), entry(3, 'Ayesha Fernando', 2, { running: true, state: 'running' })],
      skipped: { own: 2, running: 1 },
      projects: [{ id: 18, code: 'PRJ-0018', name: 'e-Auction portal' }],
      people: [{ id: 1, name: 'Kasun Silva' }, { id: 2, name: 'Ayesha Fernando' }],
      can: { time_approve: true },
    };
  if (path === '/api/projects/time/summary') return { from: today, to: today, by_project: [{ id: 18, name: 'e-Auction portal', code: 'PRJ-0018', minutes: 600, hours: '10', billable_hours: '8', duration: '10:00' }], by_user: [{ id: 1, name: 'Kasun Silva', code: null, minutes: 600, hours: '10', billable_hours: '8', duration: '10:00' }] };
  return {};
}

const show = (route: string) => {
  const [p, q] = route.split('?');
  tab.path = (p ?? '').split('/').filter(Boolean);
  tab.query = new URLSearchParams(q ?? '');
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectsPage tabId="t1" route={route} active />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  offline = false;
  manage = true;
  queries.length = 0;
  tab.go = vi.fn();
  tab.openLink = vi.fn();
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string, query?: unknown) => (queries.push({ path, query }), { data: answers(path) as never, offline, cachedAt: offline ? '2026-10-09T08:00:00Z' : null }));
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockResolvedValue({} as never);
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPost).mockResolvedValue({} as never);
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (ch: string) => {
    if (ch === 'projects:outbox') return [] as never;
    if (ch === 'projects:timer' || ch === 'projects:timerStart') return { available: true, running: null, paused: null, recent: [], todayMinutes: 0, weekMinutes: 0, idleSince: null, offline: false, error: null, checkedAt: null } as never;
    return undefined as never;
  });
});
afterEach(cleanup);

describe('the rail’s Delivery views', () => {
  it('lists Timeline, Milestones (with what is due), Sprints and Team workload, and goes to them in the tab', async () => {
    show('/projects/workload');
    const rail = screen.getByRole('navigation', { name: 'Projects' });
    await waitFor(() => expect(rail.textContent).toContain('Milestones2'));
    expect(within(rail).getByRole('button', { name: /Team workload/ }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(rail).getByRole('button', { name: /Timeline & Gantt/ }));
    expect(tab.go).toHaveBeenCalledWith('/projects/timeline');
  });
});

describe('Timeline & Gantt (W08)', () => {
  it('draws a project’s bars, the critical path and slack in words, the forecast against the plan, and the dependencies with their lag', async () => {
    show('/projects/18/timeline');
    const table = await screen.findByRole('table', { name: 'Timeline' });
    expect(queries.some((q) => q.path === '/api/projects/18/schedule')).toBe(true);
    expect(screen.getByText(/Finish forecast/).parentElement?.textContent).toMatch(/14 working days after the planned end/);
    expect(screen.getByText(/Critical path: 1 task · 31 days/)).toBeTruthy();
    expect(within(table).getByText('Critical')).toBeTruthy();
    expect(within(table).getByText('6 d slack')).toBeTruthy();
    expect(within(table).getByRole('img', { name: /Bidder onboarding live: due/ })).toBeTruthy();
    const deps = screen.getByRole('region', { name: 'Dependencies' });
    expect(deps.textContent).toContain('TSK-0402waits onTSK-0396');
    expect(deps.textContent).toContain('+2 d lag');
    fireEvent.click(within(table).getByRole('button', { name: 'Broker role permissions' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/18/timeline?task=402');
  });

  it('asks for a project when none is chosen', async () => {
    show('/projects/timeline');
    expect(await screen.findByText('Choose a project to see its timeline.')).toBeTruthy();
    expect(queries.some((q) => q.path.endsWith('/schedule'))).toBe(false);
  });
});

describe('Milestones & billing (W10)', () => {
  it('lists with tab counts, the company’s ready total, invoice links into Billing, and asks before achieving with open tasks', async () => {
    show('/projects/milestones');
    expect(await screen.findByText('Milestone 1')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Open\s*9/ }).getAttribute('aria-selected')).toBe('true');
    expect(queries.find((q) => q.path === '/api/projects/milestones')?.query).toEqual({ org: '1', status: 'open' });
    const billing = screen.getByRole('complementary', { name: 'Billing' });
    expect(billing.textContent).toContain('LKR 3,350,000');
    expect(billing.textContent).toContain('TechHubiz · LKR');
    fireEvent.click(screen.getByRole('button', { name: 'INV-2026-0388 · paid' }));
    expect(tab.openLink).toHaveBeenCalledWith('/billing?invoice=388');

    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(409, 'Milestone 1 has 11 open tasks.', null));
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark achieved' })[0]!);
    const ask = await screen.findByRole('region', { name: 'Mark achieved anyway?' });
    expect(ask.textContent).toContain('11 open tasks');
    const go = within(ask).getByRole('button', { name: 'Mark achieved' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(ask).getByRole('textbox'), { target: { value: 'Client accepted with known issues' } });
    fireEvent.click(go);
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith('/api/projects/milestones/1/status', { status: 'achieved', force: true, reason: 'Client accepted with known issues' }));
  });

  it('drafts invoices in Billing, names the drafts and what Billing refused; a row raises its own', async () => {
    show('/projects/milestones');
    await screen.findByText('Workshop pilot');
    vi.mocked(apiPost).mockResolvedValueOnce({ invoices: [{ id: 55, number: null }], count: 2, skipped: ['PRJ-0020 has no client'] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Draft invoices in Billing' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/milestones/invoice', { ids: undefined }));
    fireEvent.click(await screen.findByRole('button', { name: 'Draft #55' }));
    expect(tab.openLink).toHaveBeenCalledWith('/billing?invoice=55');
    expect(screen.getByRole('list', { name: 'Not drafted' }).textContent).toContain('PRJ-0020 has no client');
    fireEvent.click(screen.getByRole('button', { name: 'Raise invoice' }));
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith('/api/projects/milestones/invoice', { ids: [2] }));
  });

  it('shows no changes to someone who cannot manage, and waits for a connection offline', async () => {
    manage = false;
    const v = show('/projects/milestones');
    await screen.findByText('Milestone 1');
    expect(screen.queryByRole('button', { name: /New milestone/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark achieved' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draft invoices in Billing' })).toBeNull();
    v.unmount();
    manage = true;
    offline = true;
    show('/projects/milestones');
    await screen.findByText('Milestone 1');
    await waitFor(() => expect((screen.getByRole('button', { name: /New milestone/ }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getAllByRole('button', { name: 'Mark achieved' })[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Draft invoices in Billing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Billing hand-offs wait for a connection.')).toBeTruthy();
  });
});

describe('Sprints (W09)', () => {
  it('opens the active sprint with its figures, charts and backlog, and completes it carrying unfinished work to the next planned sprint', async () => {
    show('/projects/sprints');
    expect(await screen.findByText('Sprint 7 — Bidders can register and pay')).toBeTruthy();
    expect(screen.getByText(/PRJ-0018 · .* · day 4 of 9/)).toBeTruthy();
    const figures = screen.getByRole('region', { name: 'Sprint figures' });
    expect(figures.textContent).toContain('Committed at start34');
    expect(figures.textContent).toContain('+5 added');
    expect(figures.textContent).toContain('On pace');
    expect(screen.getByRole('img', { name: /Burndown: 34 points at start/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Velocity: .* average 31.5 delivered/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bidder KYC document upload' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/sprints?task=412');

    fireEvent.click(screen.getByRole('button', { name: 'Complete sprint…' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Move unfinished tasks to' }).textContent).toContain('Sprint 8'));
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Bank sandbox slowed us' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete sprint' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/sprints/7/status', { status: 'completed', retrospective: 'Bank sandbox slowed us', move_to_sprint_id: 8 }));
  });

  it('starts a planned sprint, opens another from the list, and waits for a connection offline', async () => {
    show('/projects/sprints/8');
    fireEvent.click(await screen.findByRole('button', { name: /Sprint 7/ }));
    expect(tab.go).toHaveBeenCalledWith('/projects/sprints/7');
    vi.mocked(apiGetMeta).mockImplementation(async (path: string) => ({ data: (path === '/api/projects/sprints/8' ? { ...(answers('/api/projects/sprints/7') as object), sprint: sprint(8, 'planned') } : answers(path)) as never, offline, cachedAt: null }));
    cleanup();
    show('/projects/sprints/8');
    fireEvent.click(await screen.findByRole('button', { name: 'Start sprint' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/sprints/8/status', { status: 'active' }));
    cleanup();
    offline = true;
    show('/projects/sprints/8');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start sprint' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'New sprint' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Team workload', () => {
  it('shows each person’s load by week with the percentage in every cell, and their totals', async () => {
    show('/projects/workload');
    const grid = await screen.findByRole('table', { name: /Load by week/ });
    const row = within(grid).getByRole('row', { name: /Kasun Silva/ });
    expect(row.textContent).toContain('120%');
    expect(row.textContent).toContain('50%');
    expect(row.textContent).toContain('85%');
    expect(queries.find((q) => q.path === '/api/projects/workload')?.query).toEqual({ org: '1' });
  });
});

describe('Time & approvals (W11)', () => {
  it('my week says why an entry was sent back, and Review opens the approval queue here', async () => {
    show('/projects/time');
    expect(await screen.findByText('Sent back: Wrong task')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Approval queue\s*3/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/time?tab=queue');
  });

  it('the queue groups by person: Approve all, select and send back with a note, mark billable; running timers cannot be chosen', async () => {
    show('/projects/time?tab=queue');
    const kasun = await screen.findByRole('region', { name: 'Kasun Silva' });
    expect(screen.getByText(/Skipped: 1 running timer · 2 of your own/)).toBeTruthy();
    expect((within(screen.getByRole('region', { name: 'Ayesha Fernando' })).getByRole('button', { name: /Approve all/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(kasun).getByRole('button', { name: /Approve all of Kasun Silva/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/time/approve', { ids: [1, 2] }));

    fireEvent.click(within(kasun).getAllByRole('checkbox')[1]!);
    expect(screen.getByRole('region', { name: 'Selection' }).textContent).toContain('1 selected · 2:15');
    fireEvent.click(screen.getByRole('button', { name: 'Mark billable' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/time/billable', { ids: [1], is_billable: true }));

    fireEvent.click(within(kasun).getAllByRole('checkbox')[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Send back with a note' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send back' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Log it on TSK-0402' } });
    fireEvent.click(send);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/time/send-back', { ids: [1], note: 'Log it on TSK-0402' }));
  });

  it('approvals wait for a connection offline', async () => {
    offline = true;
    show('/projects/time?tab=queue');
    const kasun = await screen.findByRole('region', { name: 'Kasun Silva' });
    await waitFor(() => expect((within(kasun).getByRole('button', { name: /Approve all/ }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/Approvals wait for a connection: the queue is the copy kept/)).toBeTruthy();
  });

  it('the summary totals time by project and by person for a range', async () => {
    show('/projects/time?tab=summary');
    const byProject = await screen.findByRole('region', { name: 'By project' });
    expect(byProject.textContent).toContain('Total 10:00');
    expect(screen.getByRole('region', { name: 'By person' }).textContent).toContain('Kasun Silva');
    expect(queries.find((q) => q.path === '/api/projects/time/summary')?.query).toEqual({ org: '1', from: `${today.slice(0, 8)}01`, to: today });
  });

  it('Start timer starts one on a chosen project through the tray timer', async () => {
    show('/projects/time');
    fireEvent.click(await screen.findByRole('button', { name: 'Start timer' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Project' }));
    fireEvent.click(await screen.findByRole('option', { name: /PRJ-0018 · e-Auction portal/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('projects:timerStart', { projectId: 18, taskId: null, billable: true }));
  });
});
