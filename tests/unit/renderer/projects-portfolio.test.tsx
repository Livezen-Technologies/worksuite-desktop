// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['projects', 'all'], go: (_r: string) => undefined as void, openLink: (_l: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/${tab.path.join('/')}?${tab.query}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: (l: string) => tab.openLink(l) }),
  useTabTitle: () => undefined,
  openRouteInWindow: vi.fn(),
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= () => undefined;

const { apiGetMeta, apiPost, apiPut, apiDelete, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { default: ProjectsPage } = await import('../../../src/modules/projects/ProjectsPage');
const { withOrg } = await import('../../../src/modules/projects/company');

const project = (over: Record<string, unknown> = {}) => ({
  id: 18, code: 'PRJ-0018', name: 'Ceylon Tea Board — e-Auction portal', org_id: 3, org_name: 'TechHubiz', client: 'Ceylon Tea Board', client_id: 5, category: 'Web platform', category_id: 2, category_color: null,
  manager: 'Nimal Perera', manager_id: 7, priority: 'high', status: 'active', start_date: '2026-06-01', end_date: '2026-10-30', baseline_end_date: '2026-10-20', estimated_hours: '900', budget: '12400000', currency: 'LKR', hourly_rate: '4500',
  is_billable: true, is_template: false, days_left: 21, description: null, completed_at: null, progress: 58, members: 9, budget_used_percent: 104, health: 'at_risk', ...over,
});

const detail = (can: Record<string, boolean> = { manage: true, time: true, budget: true }) => ({
  project: project(),
  progress: { total: 40, done: 22, overdue: 3, blocked: 1, progress: 58 },
  budget: { budget: '12400000', labour: '9800000', expenses: '3100000', spent: '12900000', remaining: '-500000', used_percent: 104, over: true, currency: 'LKR', expense_count: 4, eac: null, warn_percent: 80 },
  time: { minutes: 30000, billable_minutes: 28000, hours: '500', billable_hours: '466', cost: '0', estimate_hours: '900' },
  health: { status: 'at_risk', reasons: ['Budget used 104% (over)', '3 tasks overdue'] },
  members: [
    { id: 1, user_id: 7, name: 'Nimal Perera', email: 'nimal@x.lk', role: 'manager', capacity_hours: '40', hourly_rate: '5000', open_tasks: 4, open_estimate_hours: '30', load_percent: 75, joined_at: null },
    { id: 2, user_id: 8, name: 'Asha Fernando', email: 'asha@x.lk', role: 'member', capacity_hours: '20', hourly_rate: '0', open_tasks: 6, open_estimate_hours: '26', load_percent: 130, joined_at: null },
  ],
  former_members: [{ id: 3, user_id: 9, name: 'Kasun Silva', role: 'lead', left_at: '2026-09-01', minutes: 600 }],
  milestones: [{ id: 1, name: 'Bidder onboarding', due_date: '2026-10-12', status: 'open', bill_amount: '0', tasks: 8, tasks_done: 5, progress: 62, achieved_at: null, overdue: false, owner: null }],
  risks: [{ id: 1, title: 'Bank sandbox late', impact: 'high', probability: 'medium', score: 12, level: 'high', status: 'open', owner: null }],
  activity: [],
  baselines: [{ end_date: '2026-10-05', budget: '12400000', hours: '900', reason: 'Bank integration slipped', change_number: 'CR-0004', set_by: 'Nimal Perera', set_at: '2026-08-14' }],
  budget_history: [],
  linked: { drive_files: 6, expense_total: '3100000', expense_count: 4, asset_count: 0, next_event: null, tender: null },
  next_statuses: ['on_hold', 'completed', 'cancelled'],
  can,
});

let offline = false;
let can: Record<string, boolean> = { manage: true, time: true, budget: true };
let clientCan: Record<string, boolean> = { manage: true };
let settingsCan: Record<string, boolean> = { settings: true };
function answers(path: string): unknown {
  if (path === '/api/projects/companies') return { items: [{ id: 3, name: 'TechHubiz', currency: 'LKR' }, { id: 4, name: 'Livezen', currency: 'USD' }], current: 3 };
  if (path === '/api/projects') return { projects: [project(), project({ id: 21, code: 'PRJ-0021', name: 'SFCL enterprise website', status: 'planning', health: 'watch', days_left: -4, budget_used_percent: 77 })], total: 2, page: 1, per_page: 30, status_counts: { active: 14, planning: 6, on_hold: 1, completed: 2, archived: 3 }, can: { manage: true } };
  if (path === '/api/projects/counts') return { projects: 24, my_work: 7, milestones_due: 0, time_waiting: 0, risks_open: 0, changes_waiting: 0 };
  if (path === '/api/projects/18') return detail(can);
  if (path === '/api/projects/18/workload') return { weeks: ['2026-10-05', '2026-10-12'], people: [{ user_id: 8, name: 'Asha Fernando', cells: [{ hours: '26', capacity: '20', percent: 130 }, { hours: '4', capacity: '20', percent: 20 }] }] };
  if (path === '/api/projects/templates') return { templates: [{ id: 12, code: 'TPL-0002', name: 'Website build', description: 'Discovery to launch', milestones: 6, tasks: 38, checklists: 2, dependencies: 9, roles: 4, risks: 3, sprints: 0 }] };
  if (path === '/api/projects/people') return { people: [{ id: 7, name: 'Nimal Perera', email: 'nimal@x.lk', employee_no: 'E-7' }, { id: 10, name: 'Dilani Jayawardena', email: 'dilani@x.lk', employee_no: null }] };
  if (path === '/api/projects/clients') return { clients: [{ id: 5, name: 'Ceylon Tea Board', org_id: null, org_name: null, contact_person: 'R. Silva', email: 'r@tea.lk', phone: null, address: null, website: null, notes: null, status: 'active', live: 1, projects: 2, crm: { linked: true, account_id: 1, label: null }, contact_visible: true }, { id: 6, name: 'Mobitel', org_id: 3, org_name: 'TechHubiz', contact_person: null, email: null, phone: null, address: null, website: null, notes: null, status: 'active', live: 1, projects: 1, crm: { linked: false, account_id: null, label: null }, contact_visible: false }], can: clientCan };
  if (path === '/api/projects/clients/5') return { client: (answers('/api/projects/clients') as { clients: unknown[] }).clients[0], projects: [{ id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active' }], budget_live: '12400000', ready_to_invoice: '1500000', currency: 'LKR', company: null, can: clientCan };
  if (path === '/api/projects/categories') return { categories: [{ id: 2, name: 'Web platform', color: '#2563eb', status: 'active', projects: 4 }] };
  if (path === '/api/projects/settings') return { settings: { project_prefix: 'PRJ', task_prefix: 'TSK', change_prefix: 'CR', number_pad: 4, default_currency: 'LKR', reporting_currency: 'LKR', budget_warn_percent: 80, working_hours_per_day: 8, working_days: [1, 2, 3, 4, 5], time_approvers: 'manager_and_leads', max_entry_hours: 12, wip_limits: { in_progress: 6 }, alerts: { task_assigned: true }, holiday_calendar: 'Sri Lanka', next_code: 'PRJ-0028' }, can: settingsCan };
  if (path === '/api/projects/activity') return { activity: [{ id: 1, action: 'task_moved', detail: 'To do → In progress', actor: 'Asha Fernando', at: '2026-10-09 10:42:00', project: 'e-Auction portal', code: 'PRJ-0018', project_id: 18, task_id: 412, task_number: 'TSK-0412' }], total: 1, page: 1, per_page: 50 };
  if (path === '/api/projects/dashboard') return { company: { id: 3, name: 'TechHubiz', currency: 'LKR' }, currency: 'LKR', rate_date: null, kpi: { active: 14, total: 24, at_risk: 3, watch: 2, tasks_overdue: 5, tasks_open: 80, used_percent: 71, spent: '50000000', budget: '70000000' }, by_status: { active: 14 }, attention: [], upcoming_milestones: [], workload: [], recent: [] };
  return {};
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectsPage tabId="t1" route={`/${tab.path.join('/')}`} active />
    </QueryClientProvider>,
  );
const at = (path: string, query = '') => {
  tab.path = path.split('/').filter(Boolean);
  tab.query = new URLSearchParams(query);
};
const calledWith = (path: string) => vi.mocked(apiGetMeta).mock.calls.filter((c) => c[0] === path).map((c) => c[1] as Record<string, string> | undefined);

beforeEach(() => {
  offline = false;
  can = { manage: true, time: true, budget: true };
  clientCan = { manage: true };
  settingsCan = { settings: true };
  at('/projects/all');
  tab.go = vi.fn();
  tab.openLink = vi.fn();
  app.set({ bootstrap: { permissions: ['project.manage', 'project.settings'] } as never, auth: { stage: 'ready', user: { id: '7', name: 'Nimal Perera' } } as never });
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string) => ({ data: answers(path) as never, offline, cachedAt: offline ? '2026-10-09T08:00:00Z' : null }));
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPut).mockReset();
  vi.mocked(apiDelete).mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (ch: string) => {
    if (ch === 'projects:outbox') return [] as never;
    if (ch === 'projects:timer') return { available: true, running: null, paused: null, recent: [], todayMinutes: 0, weekMinutes: 0, idleSince: null, offline: false, error: null, checkedAt: null } as never;
    return undefined as never;
  });
});
afterEach(cleanup);

describe('the company selector (G-01)', () => {
  it('adds the company to portfolio reads, never to one project’s', () => {
    expect(withOrg({ project_id: 18 })).toEqual({ project_id: 18 });
    expect(withOrg({ org: 4 })).toMatchObject({ org: 4 });
  });
});

describe('All projects (W02)', () => {
  it('lists the register with its status tabs, health in words, and the company’s rows', async () => {
    show();
    const table = await screen.findByRole('table', { name: 'Projects' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain('PRJ-0018 · Web platform');
    expect(rows[1]!.textContent).toContain('At risk');
    expect(rows[2]!.textContent).toContain('4 days late');
    const tabs = screen.getByRole('navigation', { name: 'Status' });
    expect(within(tabs).getByRole('button', { name: /Active\s*14/ })).toBeTruthy();
    expect(within(tabs).queryByRole('button', { name: /Pending approval/ })).toBeNull();
    // The register asks for the company the selector shows (the caller's own, from /companies).
    await waitFor(() => expect(calledWith('/api/projects').some((q) => q?.org === '3' && q?.per_page === '30')).toBe(true));
    fireEvent.click(within(tabs).getByRole('button', { name: /Active/ }));
    expect(tab.go).toHaveBeenCalledWith('/projects/all?status=active');
    fireEvent.click(rows[1]!);
    expect(tab.go).toHaveBeenCalledWith('/projects/18');
    // The rail has the portfolio views.
    const rail = screen.getByRole('navigation', { name: 'Projects' });
    expect(rail.textContent).toContain('All projects24');
    expect(within(rail).getByRole('button', { name: 'Module settings' })).toBeTruthy();
  });

  it('sends the filters in the address to the server and offers to clear them', async () => {
    at('/projects/all', 'status=active&health=at_risk&q=tea');
    show();
    await screen.findByRole('table', { name: 'Projects' });
    expect(calledWith('/api/projects').some((q) => q?.status === 'active' && q?.health === 'at_risk' && q?.q === 'tea')).toBe(true);
  });

  it('New project opens the dialog over the register; it needs a connection', async () => {
    show();
    await screen.findByRole('table', { name: 'Projects' });
    // The rail's + and the register's own button.
    const [rail, page] = screen.getAllByRole('button', { name: 'New project' });
    fireEvent.click(page!);
    expect(tab.go).toHaveBeenCalledWith('/projects/all?new=blank');
    fireEvent.click(rail!);
    expect(tab.go).toHaveBeenCalledTimes(2);
    cleanup();
    offline = true;
    show();
    await screen.findByRole('table', { name: 'Projects' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'New project' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true));
    expect(screen.getAllByRole('button', { name: 'New project' })[1]!.getAttribute('title')).toBe('New project needs a connection');
  });

  it('hides New project from people who may not create projects', async () => {
    app.set({ bootstrap: { permissions: ['project.view'] } as never });
    show();
    await screen.findByRole('table', { name: 'Projects' });
    expect(screen.queryByRole('button', { name: 'New project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Module settings' })).toBeNull();
  });
});

describe('New project (W03)', () => {
  it('creates a blank project in the chosen company and opens it', async () => {
    at('/projects/all', 'new=blank');
    vi.mocked(apiPost).mockResolvedValue({ id: 77, code: 'PRJ-0028' });
    show();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Blank project').length).toBe(2); // the subtitle, and the choice
    await within(dialog).findByText('PRJ-0028');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(await within(dialog).findByText('Give the project a name.')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Project name/ }), { target: { value: 'NSB endpoint licences' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ org_id: 3, name: 'NSB endpoint licences', status: 'planning', is_billable: true, manager_id: 7, currency: 'LKR' })));
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/projects/77'));
  });

  it('from a template: copies the parts chosen, through from-template', async () => {
    at('/projects/templates', 'new=12');
    vi.mocked(apiPost).mockResolvedValue({ id: 78, code: 'PRJ-0029' });
    show();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('From the template “Website build”');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Standard risks/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Project name/ }), { target: { value: 'TSHDA site' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/from-template', expect.objectContaining({ template_id: 12, name: 'TSHDA site', copy: { milestones: true, tasks: true, dependencies: true, roles: true, risks: true } })));
  });
});

describe('Templates', () => {
  it('lists what each template brings and starts a project from one', async () => {
    at('/projects/templates');
    show();
    const list = await screen.findByRole('list', { name: 'Templates' });
    expect(list.textContent).toContain('6 milestones · 38 tasks · 4 roles · 3 risks');
    fireEvent.click(within(list).getByRole('button', { name: 'Use template Website build' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/templates?new=12');
  });
});

describe('Clients (W16)', () => {
  it('lists clients, hides contacts it may not show, and archives with a confirmation', async () => {
    at('/projects/clients/5');
    vi.mocked(apiPost).mockResolvedValue({});
    show();
    const table = await screen.findByRole('table', { name: 'Clients' });
    expect(table.textContent).toContain('Hidden: you work on none of this client’s projects');
    const panel = await screen.findByRole('region', { name: 'Ceylon Tea Board' });
    expect(panel.textContent).toContain('Shared by all companies');
    expect(panel.textContent).toContain('LKR 1.5M');
    fireEvent.click(within(panel).getByRole('button', { name: 'Archive' }));
    const ask = await screen.findByRole('dialog');
    fireEvent.click(within(ask).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/clients/5/archive', { archived: true }));
  });

  it('adds a client in the selector’s company', async () => {
    at('/projects/clients');
    vi.mocked(apiPost).mockResolvedValue({ id: 9 });
    show();
    await screen.findByRole('table', { name: 'Clients' });
    await waitFor(() => expect(calledWith('/api/projects/companies').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Add client' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Client name/ }), { target: { value: 'NSB' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/clients', expect.objectContaining({ name: 'NSB', org_id: 3 })));
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/projects/clients/9'));
  });

  it('without manage: no Add, Edit or Archive', async () => {
    at('/projects/clients/5');
    clientCan = { manage: false };
    show();
    const panel = await screen.findByRole('region', { name: 'Ceylon Tea Board' });
    expect(within(panel).queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add client' })).toBeNull();
  });
});

describe('A project’s page (W04)', () => {
  it('shows the overview: figures, why it is at risk, details, risks and the sections as routes', async () => {
    at('/projects/18');
    show();
    expect(await screen.findByRole('heading', { name: 'Ceylon Tea Board — e-Auction portal' })).toBeTruthy();
    const why = screen.getByRole('region', { name: 'Why this project is at risk' });
    expect(why.textContent).toContain('Budget used 104% (over)');
    const figures = screen.getByRole('region', { name: 'Figures' });
    expect(figures.textContent).toContain('22 / 40');
    expect(figures.textContent).toContain('baseline 20 Oct · +10 d');
    expect(screen.getByText('Bank sandbox late')).toBeTruthy();
    const sections = screen.getByRole('navigation', { name: 'Project sections' });
    fireEvent.click(within(sections).getByRole('button', { name: 'Board' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/18/board');
    fireEvent.click(within(sections).getByRole('button', { name: 'Team' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/18/team');
  });

  it('moves the status, asking with the server’s reason when it needs a confirmation (409 → force)', async () => {
    at('/projects/18');
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(409, '3 tasks are still open. Complete anyway?', null)).mockResolvedValueOnce({});
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to another status' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Completed' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/18/status', { status: 'completed', force: false }));
    const ask = await screen.findByRole('dialog');
    expect(ask.textContent).toContain('3 tasks are still open. Complete anyway?');
    fireEvent.click(within(ask).getByRole('button', { name: 'Move to Completed' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/18/status', { status: 'completed', force: true }));
  });

  it('without manage: no Edit, Move to or More', async () => {
    at('/projects/18');
    can = { time: true };
    show();
    await screen.findByRole('heading', { name: 'Ceylon Tea Board — e-Auction portal' });
    expect(screen.queryByRole('button', { name: 'Move to another status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start timer' })).toBeTruthy();
  });

  it('offline: reads the kept copy; every write waits for a connection', async () => {
    at('/projects/18');
    offline = true;
    show();
    await screen.findByRole('heading', { name: 'Ceylon Tea Board — e-Auction portal' });
    expect((screen.getByRole('button', { name: 'Start timer' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move to another status' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Start timer' }).getAttribute('title')).toBe('Starting a timer needs a connection');
    expect(await screen.findByText(/You’re working offline\./)).toBeTruthy();
  });

  it('saves as a template with the name asked for', async () => {
    at('/projects/18');
    vi.mocked(apiPost).mockResolvedValue({ id: 30, code: 'TPL-0003' });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save as template…' }));
    const ask = await screen.findByRole('dialog');
    fireEvent.click(within(ask).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/18/save-as-template', { name: 'Ceylon Tea Board — e-Auction portal template' }));
  });
});

describe('Team & members (W05)', () => {
  it('lists members with load in words, removes, re-adds and adds someone', async () => {
    at('/projects/18/team');
    vi.mocked(apiDelete).mockResolvedValue({});
    vi.mocked(apiPost).mockResolvedValue({});
    show();
    const table = await screen.findByRole('table', { name: /Members of/ });
    expect(table.textContent).toContain('130% overloaded');
    expect(within(table).queryByRole('button', { name: 'Remove Nimal Perera' })).toBeNull(); // the manager stays
    fireEvent.click(within(table).getByRole('button', { name: 'Remove Asha Fernando' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/projects/18/members/2'));
    fireEvent.click(screen.getByRole('button', { name: 'Re-add Kasun Silva' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/18/members/3/readd'));
    expect(await screen.findByRole('table', { name: 'Load by week, as a percentage of capacity' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to project' }));
    expect(await screen.findByText('Choose who to add.')).toBeTruthy();
  });

  it('edits a member’s role, capacity and rate', async () => {
    at('/projects/18/team');
    vi.mocked(apiPut).mockResolvedValue({});
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Asha Fernando' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Hours a week on this project' }), { target: { value: '30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/projects/18/members/2', { role: 'member', capacity_hours: '30', hourly_rate: '' }));
  });
});

describe('A project’s settings', () => {
  it('saves the edit, shows the baseline history and re-baselines with a reason', async () => {
    at('/projects/18/settings');
    vi.mocked(apiPut).mockResolvedValue({});
    vi.mocked(apiPost).mockResolvedValue({});
    show();
    const history = await screen.findByRole('list', { name: 'Baseline history' });
    expect(history.textContent).toContain('Bank integration slipped');
    expect(history.textContent).toContain('CR-0004');
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'e-Auction portal v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/projects/18', expect.objectContaining({ name: 'e-Auction portal v2', budget: '12400000', currency: 'LKR', is_billable: true })));
    fireEvent.click(screen.getByRole('button', { name: 'Re-baseline…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-baseline' }));
    expect(await within(dialog).findByText(/Say why the baseline is moving/)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Reason/ }), { target: { value: 'Client asked for a later launch' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-baseline' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/18/rebaseline', { reason: 'Client asked for a later launch', end_date: '2026-10-30' }));
  });

  it('keeps money as it was for someone who may not change budgets', async () => {
    at('/projects/18/settings');
    can = { manage: true };
    show();
    await screen.findByRole('list', { name: 'Baseline history' });
    expect((screen.getByRole('textbox', { name: 'Budget amount' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Only people who manage budgets can change the budget, currency or rate.')).toBeTruthy();
  });
});

describe('Activity log', () => {
  it('lists who did what and opens the task and the project', async () => {
    at('/projects/activity');
    show();
    const list = await screen.findByRole('list', { name: 'Activity' });
    expect(list.textContent).toContain('Asha Fernando');
    expect(list.textContent).toContain('Task moved');
    fireEvent.click(within(list).getByRole('button', { name: 'TSK-0412' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/activity?task=412');
    fireEvent.click(within(list).getByRole('button', { name: 'PRJ-0018' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/18');
  });
});

describe('Module settings (W17)', () => {
  it('saves the general settings and previews the next code', async () => {
    at('/projects/settings');
    vi.mocked(apiPut).mockResolvedValue({});
    show();
    const prefix = await screen.findByRole('textbox', { name: 'Project code prefix' });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(prefix, { target: { value: 'PX' } });
    expect(screen.getByText('PX-0028')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/projects/settings', expect.objectContaining({ project_prefix: 'PX', working_days: [1, 2, 3, 4, 5], wip_limits: { in_progress: 6 } })));
  });

  it('is read only without the settings permission', async () => {
    at('/projects/settings');
    settingsCan = { settings: false };
    show();
    expect(await screen.findByText('Read only: changing these needs the Projects settings permission.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Project code prefix' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('Dashboard (W01)', () => {
  it('shows the company’s figures with links to the screens behind them', async () => {
    at('/projects');
    show();
    const figures = await screen.findByRole('region', { name: 'Key figures' });
    expect(figures.textContent).toContain('TechHubiz · LKR');
    fireEvent.click(within(figures).getByRole('button', { name: /At risk/ }));
    expect(tab.go).toHaveBeenCalledWith('/projects/all?health=at_risk');
    await act(async () => undefined);
  });
});
