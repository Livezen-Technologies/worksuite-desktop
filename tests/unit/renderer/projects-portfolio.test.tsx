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
const { setRegional } = await import('../../../src/core/time');

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

const counts0 = { phases: 3, tasks: 4, subtasks: 2, checklist: 2, dependencies: 1, roles: 2, folders: 2, documents: 1, budget_lines: 2, automations: 1, risks: 0, weeks: 2 };
const libItem = (over: Record<string, unknown> = {}) => ({
  key: 'pack.website-development', kind: 'pack', id: null, group: 'pack', name: 'Website development', icon: 'globe', category: 'Web development', summary: 'A company website, discovery to handover.',
  line: '3 phases · 6 tasks · 2 weeks', tags: ['Web', 'WordPress'], scope: 'builtin', version: 3, status: 'active', usage: 2, owner: null, org_id: null, org_name: null, editable: false,
  based_on: null, updated_at: null, code: null, anchor: 'start', anchor_label: '', duration_days: 10, counts: counts0, hours: 24, budget: 83500, ...over,
});
const LIBRARY = [
  libItem(),
  libItem({ key: 'pack.tender-bid', name: 'Tender bid submission', icon: 'landmark', category: 'Tenders', summary: 'A bid counted back from the closing date.', tags: ['Tender', 'Government'], line: '8 phases · 23 tasks · 3 weeks' }),
  libItem({ key: 'project.12', kind: 'project', id: 12, group: 'company', scope: 'company', name: 'Website build', code: 'TPL-0002', version: 1, icon: 'copy', tags: [], category: '' }),
  libItem({ key: 'tpl.31', kind: 'template', id: 31, group: 'mine', scope: 'personal', name: 'Our AMC', version: 2, editable: true, icon: 'life-buoy', category: 'Support', tags: ['AMC'], usage: 0, based_on: 'pack.it-support-amc' }),
  libItem({ key: 'tpl.40', kind: 'template', id: 40, group: 'company', scope: 'company', name: 'Old campaign', status: 'archived', editable: true, icon: 'megaphone', category: 'Marketing', tags: [] }),
];
const t = (key: string, phase: string, start: number, days: number, more: Record<string, unknown> = {}) => ({
  key, phase, title: key, description: '', role: null, hours: 0, priority: 'medium', from: 'start', start, days, depends_on: [], checklist: [], tags: [], subtasks: [], repeat: null, ...more,
});
const WEB_SPEC = {
  schema: 1, key: 'website-development', version: 3, name: 'Website development', icon: 'globe', category: 'Web development', summary: '', tags: ['Web'], anchor: 'start', anchor_label: '', duration_days: 10,
  roles: [
    { key: 'pm', name: 'Project manager', member_role: 'lead', rate: 5000, hours_per_week: 8 },
    { key: 'developer', name: 'Web developer', member_role: 'member', rate: 4000, hours_per_week: 30 },
  ],
  phases: [
    { key: 'discovery', name: 'Discovery', description: '', from: 'start', start: 0, days: 3 },
    { key: 'build', name: 'Development', description: '', from: 'start', start: 3, days: 5 },
    { key: 'launch', name: 'Launch', description: '', from: 'start', start: 8, days: 2 },
  ],
  tasks: [
    t('Kick-off meeting', 'discovery', 0, 1, { role: 'pm', hours: 2, checklist: ['Goals', 'Approvers'] }),
    t('Build the theme', 'build', 3, 5, { role: 'developer', hours: 16, depends_on: ['Kick-off meeting'], subtasks: [{ title: 'Header', description: '', role: 'developer', hours: 6, checklist: [] }, { title: 'Pages', description: '', role: 'developer', hours: 10, checklist: [] }] }),
    t('Point DNS and install SSL', 'launch', 8, 1, { role: 'developer', hours: 3 }),
    t('Go live', 'launch', 9, 1, { role: 'pm', hours: 3 }),
  ],
  folders: [{ path: '01 Brief', documents: [{ name: 'Project brief', type: 'docx' }] }, { path: '02 Design', documents: [] }],
  budget: [
    { label: 'Development', kind: 'labour', role: 'developer', hours: 20, rate: null, amount: null, note: '' },
    { label: '.lk domain', kind: 'expense', role: null, hours: 0, rate: null, amount: 3500, note: '' },
  ],
  risks: [], custom_fields: [{ name: 'Store URL', type: 'url' }], statuses: [], automations: [{ when: 'milestone_achieved', do: 'notify_client', title: 'Tell the client' }], portal: { client_can_view: ['milestones'] }, links: {},
  defaults: { name_pattern: '{client} website', category: 'Web platform', priority: 'high', billable: true, status: 'active', estimated_hours: null, budget: null, currency: 'LKR', description: 'Website for {client}.' },
};

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
  if (path === '/api/projects/template-library') return { templates: LIBRARY, can: { create: true, company: true, organisation: true } };
  if (path === '/api/projects/template-library/pack.website-development') return { template: LIBRARY[0], spec: WEB_SPEC };
  if (path === '/api/projects/template-library/project.18') return { template: libItem({ key: 'project.18', kind: 'project', id: 18, group: 'project', name: 'Ceylon Tea Board — e-Auction portal' }), spec: { ...WEB_SPEC, name: 'Ceylon Tea Board — e-Auction portal', defaults: { ...WEB_SPEC.defaults, name_pattern: '' } } };
  if (path === '/api/projects/template-library/tpl.31') return { template: LIBRARY[3], spec: { ...WEB_SPEC, name: 'Our AMC' } };
  if (path === '/api/projects/template-library/31/versions') return { versions: [{ version: 2, name: 'Our AMC', note: 'Quarterly reviews added', by: 'Nimal Perera', at: '2026-10-10 09:00:00', line: '3 phases · 6 tasks · 2 weeks' }, { version: 1, name: 'Our AMC', note: 'Duplicated', by: 'Nimal Perera', at: '2026-10-01 09:00:00', line: '3 phases · 5 tasks · 2 weeks' }], current: 2 };
  if (path === '/api/projects/template-library/pack.website-development/export') return { file_name: 'website-development-v3.worksuite-template.json', content: { worksuite_template: 1, template: WEB_SPEC } };
  if (path === '/api/projects/holidays') return { holidays: [{ date: '2026-10-20', name: 'Deepavali' }], working_days: [1, 2, 3, 4, 5] };
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

const pick = (within_: HTMLElement, name: string | RegExp, option: string | RegExp) => {
  fireEvent.click(within(within_).getByRole('combobox', { name }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};

describe('New project (W03)', () => {
  beforeEach(() => setRegional({ locale: 'en-GB' }));
  afterEach(() => setRegional({ locale: null }));

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

  it('has the budget amount beside the currency, and the app’s date picker in the local format', async () => {
    at('/projects/all', 'new=blank');
    vi.mocked(apiPost).mockResolvedValue({ id: 77, code: 'PRJ-0028' });
    show();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Currency' })).toBeTruthy();
    const amount = within(dialog).getByRole('textbox', { name: 'Budget amount' }) as HTMLInputElement;
    expect(amount.className).toContain('flex-1');
    expect(amount.className).not.toContain('w-full');
    expect(dialog.querySelectorAll('input[type="date"]').length).toBe(0);

    const starts = within(dialog).getByRole('textbox', { name: 'Starts' }) as HTMLInputElement;
    fireEvent.change(starts, { target: { value: '11/10/2026' } });
    fireEvent.blur(starts);
    expect(starts.value).toBe('11 Oct 2026');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ends: open the calendar' }));
    const cal = await screen.findByRole('dialog', { name: 'Ends: calendar' });
    expect((within(cal).getByRole('gridcell', { name: /^Saturday,? 10 October 2026$/ }) as HTMLButtonElement).disabled).toBe(true); // before the start
    fireEvent.click(within(cal).getByRole('gridcell', { name: /^Friday,? 30 October 2026$/ }));
    expect((within(dialog).getByRole('textbox', { name: 'Ends' }) as HTMLInputElement).value).toBe('30 Oct 2026');

    fireEvent.change(amount, { target: { value: '1,250,000' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Project name/ }), { target: { value: 'NSB' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ start_date: '2026-10-11', end_date: '2026-10-30', budget: '1250000' })));
  });

  it('Start from: blank, copy, company templates, my templates and the packs — with search', async () => {
    at('/projects/all', 'new=blank');
    show();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Blank project' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Copy an existing project' })).toBeTruthy();
    const company = await within(dialog).findByRole('region', { name: 'Company templates' });
    expect(within(company).getByRole('radio', { name: 'Website build' })).toBeTruthy();
    expect(within(company).queryByRole('radio', { name: 'Old campaign' })).toBeNull(); // archived
    expect(within(within(dialog).getByRole('region', { name: 'My templates' })).getByRole('radio', { name: 'Our AMC' })).toBeTruthy();
    const packs = within(dialog).getByRole('region', { name: 'Template packs' });
    expect(packs.textContent).toContain('Web development');
    expect(packs.textContent).toContain('3 phases · 6 tasks · 2 weeks');
    expect(packs.textContent).toContain('WordPress');
    expect(within(packs).getByRole('radio', { name: 'Tender bid submission' })).toBeTruthy();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Find a template' }), { target: { value: 'tender' } });
    expect(within(dialog).queryByRole('region', { name: 'Company templates' })).toBeNull();
    expect(within(dialog).getByRole('radio', { name: 'Tender bid submission' })).toBeTruthy();
    expect(within(dialog).queryByRole('radio', { name: 'Website development' })).toBeNull();
  });

  it('a pack fills the form, previews on the chosen dates, takes people for roles, and builds in one call', async () => {
    at('/projects/all', 'new=blank');
    settingsCan = { settings: true, budget: true };
    vi.mocked(apiPost).mockResolvedValue({ id: 79, code: 'PRJ-0030', start_date: '2026-10-12', end_date: '2026-10-26', template: { key: 'pack.website-development', name: 'Website development', version: 3 }, made: { phases: 3, tasks: 4, subtasks: 2 }, adapted: [], kept: [{ what: 'Client portal settings', why: 'No portal' }] });
    show();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Website development' }));
    await waitFor(() => expect((within(dialog).getByRole('textbox', { name: /Project name/ }) as HTMLInputElement).value).toBe('Website development'));
    expect(within(dialog).getByText('From the template “Website development”')).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Priority' }).getAttribute('data-value')).toBe('high');
    expect(within(dialog).getByRole('combobox', { name: 'Category' }).getAttribute('data-value')).toBe('2');
    expect((within(dialog).getByRole('textbox', { name: 'Budget amount' }) as HTMLInputElement).value).toBe('83500');
    expect((within(dialog).getByRole('textbox', { name: /Estimated hours/ }) as HTMLInputElement).value).toBe('24');
    expect((within(dialog).getByRole('radio', { name: 'Active now' }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole('checkbox', { name: 'Billable' }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole('textbox', { name: /Description/ }) as HTMLTextAreaElement).value).toBe('Website for the client.');
    expect(dialog.textContent).toContain('Created from template Website development v3');

    const starts = within(dialog).getByRole('textbox', { name: 'Starts' });
    fireEvent.change(starts, { target: { value: '12/10/2026' } });
    fireEvent.blur(starts);
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Preview' }));
    const preview = await within(dialog).findByRole('region', { name: 'Preview' });
    // Ten working days from Monday 12 October, skipping Deepavali (20 October).
    await waitFor(() => expect(preview.textContent).toContain('12 Oct 2026 → 26 Oct 2026'));
    expect(preview.textContent).toContain('Deepavali');
    const timeline = within(preview).getByRole('list', { name: 'Timeline' });
    expect(timeline.textContent).toContain('Discovery12 Oct 2026 – 14 Oct 2026 · Day 0');
    expect(timeline.textContent).toContain('Development15 Oct 2026 – 22 Oct 2026');
    expect(preview.textContent).toContain('LKR 83,500');
    expect(preview.textContent).toContain('Adapted: Projects cannot email a client');

    // The dates move with the start.
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Details' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Starts' }), { target: { value: '2/11/2026' } });
    fireEvent.blur(within(dialog).getByRole('textbox', { name: 'Starts' }));
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Preview' }));
    expect((await within(dialog).findByRole('region', { name: 'Preview' })).textContent).toContain('2 Nov 2026 → 13 Nov 2026');

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Details' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Folders and documents in Files \(2\)/ }));
    pick(dialog, 'Person for Web developer', /Dilani Jayawardena/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/api/projects/from-library',
        expect.objectContaining({
          template: 'pack.website-development', name: 'Website development', start_date: '2026-11-02', status: 'active', is_billable: true, priority: 'high', budget: '83500',
          include: { phases: true, tasks: true, folders: false, budget: true, automations: true, risks: true }, people: { developer: 10 }, skip_holidays: true,
        }),
      ),
    );
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/projects/79'));
  });

  it('copies an existing project with the parts chosen', async () => {
    at('/projects/all', 'new=blank');
    vi.mocked(apiPost).mockResolvedValue({ id: 80, code: 'PRJ-0031', template: { key: 'project.18', name: 'Ceylon Tea Board — e-Auction portal', version: 1 }, made: {}, adapted: [], kept: [] });
    show();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Copy an existing project' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(await within(dialog).findByText('Choose the project to copy.')).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Project to copy' })).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Project to copy' }));
    fireEvent.click(await screen.findByRole('option', { name: /PRJ-0018/ }));
    const what = await within(dialog).findByRole('group', { name: 'What to copy' });
    fireEvent.click(within(what).getByRole('checkbox', { name: /Budget lines/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Project name/ }), { target: { value: 'Tea auction phase 2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/from-library', expect.objectContaining({ template: 'project.18', name: 'Tea auction phase 2', include: expect.objectContaining({ budget: false }) })));
  });

  it('shows what it is building while a large template is created', async () => {
    at('/projects/all', 'new=pack.website-development');
    const big = { ...WEB_SPEC, tasks: Array.from({ length: 24 }, (_, i) => t(`Task ${i + 1}`, 'build', 3, 2)) };
    vi.mocked(apiGetMeta).mockImplementation(async (path: string) => ({ data: (path === '/api/projects/template-library/pack.website-development' ? { template: LIBRARY[0], spec: big } : answers(path)) as never, offline: false, cachedAt: null }));
    vi.mocked(apiPost).mockReturnValue(new Promise(() => undefined));
    show();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect((within(dialog).getByRole('textbox', { name: /Project name/ }) as HTMLInputElement).value).toBe('Website development'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(await within(dialog).findByRole('progressbar', { name: 'Creating the project' })).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toContain('Building 3 phases, 24 tasks, 2 budget lines, 2 folders');
  });

  it('opens on a template from the address: a number is a project marked as a template', async () => {
    at('/projects/templates', 'new=pack.website-development');
    show();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('From the template “Website development”');
    expect((within(dialog).getByRole('radio', { name: 'Website development' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('Templates', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  it('lists the packs, the company’s and mine, with usage and versions, and starts a project from one', async () => {
    at('/projects/templates');
    show();
    const list = await screen.findByRole('list', { name: 'Templates' });
    expect(list.textContent).toContain('Website development');
    expect(list.textContent).toContain('3 phases · 6 tasks · 2 weeks · used 2 times');
    expect(list.textContent).toContain('Our AMC');
    expect(list.textContent).not.toContain('Old campaign');
    fireEvent.click(within(list).getByRole('button', { name: 'Use template Website development' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/templates?new=pack.website-development');
    fireEvent.click(screen.getByRole('tab', { name: /Archived/ }));
    expect((await screen.findByRole('list', { name: 'Templates' })).textContent).toContain('Old campaign');
  });

  it('duplicates a built-in pack to customise it, and exports it as JSON', async () => {
    at('/projects/templates');
    vi.mocked(apiPost).mockResolvedValue({ template: libItem({ key: 'tpl.50', name: 'Copy of Website development' }) });
    show();
    const list = await screen.findByRole('list', { name: 'Templates' });
    fireEvent.click(within(list).getByRole('button', { name: 'More for Website development' }));
    expect(screen.queryByRole('menuitem', { name: 'Edit…' })).toBeNull(); // packs are never edited in place
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate…' }));
    const ask = await screen.findByRole('dialog');
    fireEvent.click(within(ask).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/template-library/pack.website-development/duplicate', { name: 'Copy of Website development', scope: 'personal' }));

    fireEvent.click(within(list).getByRole('button', { name: 'More for Website development' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export as JSON' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('edits, versions, restores and archives a template of my own, and imports a file', async () => {
    at('/projects/templates');
    vi.mocked(apiPost).mockResolvedValue({ version: 3, template: libItem({ key: 'tpl.60', name: 'Imported' }) });
    vi.mocked(apiPut).mockResolvedValue({ version: 2, template: libItem({ key: 'tpl.31', name: 'Our AMC 2027' }) });
    show();
    const list = await screen.findByRole('list', { name: 'Templates' });
    fireEvent.click(within(list).getByRole('button', { name: 'More for Our AMC' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit…' }));
    const edit = await screen.findByRole('dialog', { name: /Edit “Our AMC”/ });
    fireEvent.change(within(edit).getByRole('textbox', { name: /^Name/ }), { target: { value: 'Our AMC 2027' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/projects/template-library/31', expect.objectContaining({ name: 'Our AMC 2027' })));

    fireEvent.click(within(list).getByRole('button', { name: 'More for Our AMC' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Version history' }));
    const versions = await screen.findByRole('list', { name: 'Versions' });
    expect(versions.textContent).toContain('Quarterly reviews added');
    fireEvent.click(within(versions).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/template-library/31/versions/1/restore'));
    fireEvent.click(within(versions.closest('[role="dialog"]') as HTMLElement).getAllByRole('button', { name: 'Close' })[0]!);

    fireEvent.click(within(list).getByRole('button', { name: 'More for Our AMC' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive…' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/template-library/31/archive', { archived: true }));

    const json = JSON.stringify({ worksuite_template: 1, template: WEB_SPEC });
    const fileInput = screen.getByLabelText('Template file to import') as HTMLInputElement;
    const file = new File([json], 'web.worksuite-template.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => json });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/template-library/import', { json }));
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

  it('saves as a template: the parts chosen, dates made relative, for me or the company', async () => {
    at('/projects/18');
    vi.mocked(apiPost).mockResolvedValue({ template: libItem({ key: 'tpl.70', name: 'e-Auction template', line: '1 phase · 40 tasks · 22 weeks' }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save as template…' }));
    const ask = await screen.findByRole('dialog', { name: 'Save as template' });
    fireEvent.click(within(ask).getByRole('checkbox', { name: 'Budget lines' }));
    pick(ask, 'Who can use it', /Company templates/);
    fireEvent.click(within(ask).getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/projects/18/save-as-library-template', {
        name: 'Ceylon Tea Board — e-Auction portal template', scope: 'company',
        include: { phases: true, tasks: true, roles: true, budget: false, folders: true, automations: true, risks: true },
      }),
    );
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
