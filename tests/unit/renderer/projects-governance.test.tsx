// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
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

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['projects', 'budget'], go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/${tab.path.join('/')}?${tab.query}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
  openRouteInWindow: vi.fn(),
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= () => undefined;

const { apiGet, apiGetMeta, apiDelete, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { default: ProjectsPage } = await import('../../../src/modules/projects/ProjectsPage');

const company = { id: 1, name: 'TechHubiz', currency: 'LKR' };

const budget = (over: Record<string, unknown> = {}) => ({
  company,
  currency: 'LKR',
  rate_date: '2026-10-09',
  unconverted: [{ id: 21, code: 'PRJ-0021', currency: 'AED' }],
  totals: { budget: '42000000', spent: '31500000', labour: '28000000', expenses: '3500000', used_percent: 75, live_projects: 9, billable_minutes: 6000, claims: 14, over_budget: 1, over_budget_by: '496500', worst: { id: 18, code: 'PRJ-0018' } },
  projects: [
    { id: 18, code: 'PRJ-0018', name: 'e-Auction portal', currency: 'LKR', budget: '12400000', labour: '12100000', expenses: '796500', remaining: '-496500', used_percent: 104, over: true, eac: '13900000', warn_percent: 80 },
    { id: 24, code: 'PRJ-0024', name: 'SFCL website', currency: 'LKR', budget: '6000000', labour: '2000000', expenses: '0', remaining: '4000000', used_percent: 33, over: false, eac: null, warn_percent: 80 },
  ],
  can: { manage: true },
  ...over,
});

const risk = (id: number, score: number, over: Record<string, unknown> = {}) => ({
  id, project_id: 18, project: 'e-Auction portal', project_code: 'PRJ-0018', title: `Risk ${id}`, description: null, impact: 'high', probability: 'medium', score, level: score >= 12 ? 'critical' : score >= 6 ? 'high' : 'medium',
  status: 'open', mitigation: 'Keep the card-only fallback', owner: 'Asha Fernando', owner_id: 7, due_date: '2026-10-01', review_overdue: true, closed_at: null, ...over,
});

const change = (id: number, over: Record<string, unknown> = {}) => ({
  id, number: `CR-000${id}`, project_id: 18, project: 'e-Auction portal', project_code: 'PRJ-0018', title: `Change ${id}`, description: 'The bank moved to 3-DS 2.2.', kind: 'scope', status: 'submitted',
  budget_delta: '1200000', days_delta: 14, hours_delta: '120', requested_by: 'Nimal Perera', requested_by_id: 9, decided_by: null, decided_at: null, decision_note: null, created_at: '2026-10-09 10:15:00', currency: 'LKR',
  before: { budget: '12400000', end_date: '2026-11-30', hours: '1800' }, after: { budget: '13600000', end_date: '2026-12-14', hours: '1920' },
  after_used_percent: 95, health_now: 'at_risk', health_after: 'watch', moved_baseline: false, is_mine: false, can_decide: true, can_withdraw: false, ...over,
});

const schedule = { id: 5, name: null, title: 'Portfolio summary', kind: 'summary', kind_label: 'Portfolio summary', range: 'last_week', range_label: 'Last week', dated: true, client_id: null, project_id: null, org_id: 1, company: 'TechHubiz', format: 'pdf', frequency: 'weekly', weekday: 1, month_day: null, time: '08:00', timezone: 'Asia/Colombo', recipients: [{ id: 7, name: 'Asha Fernando' }], owner: { id: 7, name: 'Asha Fernando' }, is_active: true, next_run_at: '2026-10-12T02:30:00Z', last_run_at: null, last_sent_at: null, last_error: 'Kamal has no Projects access', mine: true };

let offline = false;
let manage = true;
let changes: unknown[] = [];
function answers(path: string, q: Record<string, unknown> = {}): unknown {
  // The company selector's list (company.tsx reads it through apiGetMeta): the caller's own company is shown.
  if (path === '/api/projects/companies') return { items: [company], current: 1 };
  if (path === '/api/projects') return { projects: [{ id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active', health: 'at_risk' }], total: 1 };
  if (path === '/api/projects/counts') return { projects: 1, my_work: 0, milestones_due: 0, time_waiting: 0, risks_open: 4, changes_waiting: 2 };
  if (path === '/api/projects/budget') return budget();
  if (path === '/api/projects/18/cost') return { history: [{ at: '2026-04-01', label: 'Baseline', kind: 'baseline', delta: null, amount: '11200000', ref: null }, { at: '2026-10-09', label: 'CR-0007 · 3-D Secure rework', kind: 'pending_change', delta: '1200000', amount: '13600000', ref: 'CR-0007' }, { at: null, label: 'Current budget', kind: 'current', delta: null, amount: '12400000', ref: null }], labour_by_person: [{ user_id: 7, name: 'Asha Fernando', amount: '4200000', minutes: 9000 }], currency: 'LKR' };
  if (path === '/api/projects/18') return { project: { id: 18, code: 'PRJ-0018', name: 'e-Auction portal', status: 'active' }, members: [{ id: 1, user_id: 7, name: 'Asha Fernando', role: 'manager' }] };
  if (path === '/api/projects/risks') return { risks: [risk(1, 6), risk(2, 12, { impact: 'critical', title: 'Bank certification slips' })], counts: { open: 2, mitigating: 1, realised: 0, closed: 3, all: 6 }, heat: { critical: { medium: 1 }, high: { medium: 1 } }, can: { manage } };
  if (path === '/api/projects/changes') return { changes, counts: { waiting: changes.filter((c) => (c as { status: string }).status === 'submitted').length, approved: 1, rejected: 0, withdrawn: 0, all: changes.length } };
  if (path === '/api/projects/reports')
    return { kind: q.kind, from: q.from, to: q.to, company, currency: 'LKR', rate_date: null, summary: [{ label: 'Hours', value: '1,240', sub: 'this period' }], columns: [{ key: 'person', label: 'Person' }, { key: 'hours', label: 'Hours', align: 'right', mono: true }], rows: [{ person: 'Asha Fernando', hours: 162.5 }], chart: [{ label: 'Asha Fernando', a: 140, b: 22.5 }], chart_legend: ['Billable', 'Non-billable'] };
  if (path === '/api/projects/report-schedules') return { schedules: [schedule], can_see_all: false };
  if (path === '/api/projects/clients') return { clients: [{ id: 3, name: 'Ceylon Tea Board' }] };
  if (path === '/api/projects/people') return { people: [{ id: 7, name: 'Asha Fernando', email: 'asha@example.com', employee_no: null }, { id: 9, name: 'Nimal Perera', email: 'nimal@example.com', employee_no: null }] };
  return {};
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectsPage tabId="t1" route={`/${tab.path.join('/')}`} active />
    </QueryClientProvider>,
  );

beforeEach(() => {
  offline = false;
  manage = true;
  changes = [change(7), change(8, { is_mine: true, can_decide: false, can_withdraw: true, title: 'My own change' }), change(3, { status: 'approved', decided_by: 'Asha Fernando', decided_at: '2026-10-02 09:00:00', decision_note: 'Agreed with CTB', moved_baseline: true })];
  tab.path = ['projects', 'budget'];
  tab.query = new URLSearchParams();
  tab.go = vi.fn();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockResolvedValue({} as never);
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string, q?: Record<string, unknown>) => ({ data: answers(path, q) as never, offline, cachedAt: offline ? '2026-10-09T08:00:00Z' : null }));
  vi.mocked(request).mockReset();
  vi.mocked(request).mockImplementation(async () => ({ data: { id: 31 } as never, offline: false, cachedAt: null, message: null }));
  vi.mocked(apiDelete).mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (ch: string) => {
    if (ch === 'projects:outbox') return [] as never;
    if (ch === 'projects:timer') return { available: true, running: null, paused: null, recent: [], todayMinutes: 0, weekMinutes: 0, idleSince: null, offline: false, error: null, checkedAt: null } as never;
    return undefined as never;
  });
  vi.mocked(toast).mockReset();
});
afterEach(cleanup);

describe('Budget & cost (W12)', () => {
  it('shows one company’s totals, each project in its own currency, the unconverted note and the picked row’s history', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Budget & cost' })).toBeTruthy();
    const totals = await screen.findByRole('region', { name: 'Totals' });
    expect(totals.textContent).toContain('Budget (live projects)42.0M');
    expect(totals.textContent).toContain('TechHubiz · LKR, 9 projects');
    expect(totals.textContent).toContain('Over budget1PRJ-0018 by 497K');
    expect(screen.getByText(/at Finance rates of 9 Oct/)).toBeTruthy();
    expect(screen.getByText('Company:').textContent).toContain('TechHubiz');
    expect(screen.getByRole('progressbar', { name: 'PRJ-0018 budget used' }).getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByText('−496,500')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('Finance has no rate for PRJ-0021 (AED)');
    // The worst project is picked first: its history and labour.
    expect(await screen.findByText('CR-0007 · 3-D Secure rework')).toBeTruthy();
    expect(screen.getByText('(waiting)')).toBeTruthy();
    expect(screen.getByText('+1,200,000?')).toBeTruthy();
    // Every portfolio read names the company.
    expect(apiGetMeta).toHaveBeenCalledWith('/api/projects/budget', { org: '1' }, expect.anything());
    fireEvent.click(within(screen.getByRole('note')).getByRole('button', { name: 'PRJ-0021' }));
    expect(tab.go).toHaveBeenCalledWith('/projects/21/budget');
  });

  it('exports the budget report through the download manager', async () => {
    show();
    const exp = await screen.findByRole('button', { name: 'Export' });
    await waitFor(() => expect((exp as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(exp);
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { projectsReport: { kind: 'budget', format: 'csv', query: { org: '1' } }, name: 'projects-budget.csv', open: false }));
  });

  it('one project’s budget: its own tiles, no company picker, no org on the request', async () => {
    tab.path = ['projects', '18', 'budget'];
    show();
    expect(await screen.findByRole('heading', { name: 'Budget' })).toBeTruthy();
    const totals = await screen.findByRole('region', { name: 'Totals' });
    expect(totals.textContent).toContain('At completion13.9Mover budget');
    expect(screen.queryByText('SFCL website')).toBeNull();
    expect(apiGetMeta).toHaveBeenCalledWith('/api/projects/budget', { project_id: '18' }, expect.anything());
  });

  it('offline: read from what was kept, Export waits for a connection', async () => {
    offline = true;
    show();
    const exp = await screen.findByRole('button', { name: 'Export' });
    await screen.findByText('e-Auction portal', { selector: 'button' });
    expect((exp as HTMLButtonElement).disabled).toBe(true);
    expect(exp.getAttribute('title')).toBe('Waits for a connection');
  });
});

describe('Risks (W13)', () => {
  it('the register by score with the heat map in words, and the rail’s count', async () => {
    tab.path = ['projects', 'risks'];
    show();
    await screen.findByRole('button', { name: 'Risk 1' });
    const titles = screen.getAllByRole('button', { name: /^(Risk 1|Bank certification slips)$/ }).map((b) => b.textContent);
    expect(titles).toEqual(['Bank certification slips', 'Risk 1']);
    expect(screen.getByText('Impact critical, probability medium: 1 risk, score 8, high')).toBeTruthy();
    expect(screen.getAllByText('1 Oct (overdue)').length).toBe(2);
    expect(screen.getByRole('tab', { name: 'Closed 3' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Projects' }).textContent).toContain('Risks4');
  });

  it('raises a risk on a project (manage)', async () => {
    tab.path = ['projects', '18', 'risks'];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Raise a risk' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Title/ }), { target: { value: 'Bidder KYC vendor exits' } });
    expect(within(dialog).getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Score 4 · Medium')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Raise risk' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/projects/risks', { body: expect.objectContaining({ project_id: 18, title: 'Bidder KYC vendor exits', impact: 'medium', probability: 'medium' }) }));
  });

  it('without manage: no Raise, and a risk opens read-only', async () => {
    manage = false;
    tab.path = ['projects', 'risks'];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Risk 1' }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Raise a risk' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect((within(dialog).getByRole('textbox', { name: /Title/ }) as HTMLInputElement).closest('fieldset')!.disabled).toBe(true);
  });

  it('deletes after asking', async () => {
    tab.path = ['projects', 'risks'];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Risk 1' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getAllByRole('dialog')[1]!).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/projects/risks/1'));
  });
});

describe('Change requests (W14)', () => {
  it('lists with tabs and counts, and shows what approval does', async () => {
    tab.path = ['projects', 'changes', '7'];
    show();
    const list = await screen.findByRole('navigation', { name: 'Change requests' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Change 7'), expect.stringContaining('My own change')]);
    expect(screen.getByRole('tab', { name: 'Waiting 2' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'What approval does to the project' })).toBeTruthy();
    expect(screen.getByText('13,600,000')).toBeTruthy();
    expect(screen.getByText('+14 days')).toBeTruthy();
    expect(screen.getByText(/the health check will move from “At risk” to “Watch”/)).toBeTruthy();
    expect(screen.getByText('Scope + budget + timeline')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Approved 1' }));
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Change 3')]);
    fireEvent.click(within(list).getByRole('button'));
    expect(tab.go).toHaveBeenCalledWith('/projects/changes/3');
  });

  it('rejecting needs a note; approving sends the baseline choice', async () => {
    tab.path = ['projects', 'changes', '7'];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Write a note to the requester to say why it is rejected.');
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and apply' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/projects/changes/7/decide', { body: { decision: 'approve', note: undefined, move_baseline: true } }));
  });

  it('four eyes: the raiser cannot decide, and may withdraw after confirming', async () => {
    tab.path = ['projects', 'changes', '8'];
    show();
    expect(await screen.findByText('You raised this request, so someone else decides it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and apply' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const confirm = await screen.findByRole('dialog');
    expect(confirm.textContent).toContain('Withdraw CR-0008? It will not be decided.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/projects/changes/8/withdraw', { body: undefined }));
  });

  it('a decided request says who decided and why', async () => {
    tab.path = ['projects', 'changes', '3'];
    show();
    expect(await screen.findByRole('heading', { name: 'What approval did to the project' })).toBeTruthy();
    expect(screen.getByText(/Approved by Asha Fernando, 2 Oct\./)).toBeTruthy();
    expect(screen.getByText('“Agreed with CTB”')).toBeTruthy();
    expect(screen.getByText('The baseline end date moved with this change.')).toBeTruthy();
  });

  it('raises a change request on a project, then shows it', async () => {
    tab.path = ['projects', '18', 'changes'];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Raise' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Title/ }), { target: { value: 'Add Tamil UI' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Budget change/ }), { target: { value: '250,000' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Days added/ }), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/projects/changes', { body: { project_id: 18, kind: 'scope', title: 'Add Tamil UI', description: '', budget_delta: '250000', days_delta: 5, hours_delta: 0 } }));
    expect(apiGetMeta).toHaveBeenCalledWith('/api/projects/changes', { status: 'all', project_id: '18' }, expect.anything());
  });

  it('offline: decisions and Raise wait for a connection', async () => {
    offline = true;
    tab.path = ['projects', 'changes', '7'];
    show();
    const approve = await screen.findByRole('button', { name: 'Approve and apply' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Raise' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Change-request decisions wait for a connection.')).toBeTruthy();
  });
});

describe('Reports (W15)', () => {
  it('draws the report on screen with its filters, chart and table, one address per report', async () => {
    tab.path = ['projects', 'reports', 'time_by_person'];
    show();
    expect(await screen.findByRole('heading', { name: 'Time by person' })).toBeTruthy();
    expect((await screen.findAllByText('162.5')).length).toBe(2);
    expect(screen.getByRole('region', { name: 'Summary' }).textContent).toContain('Hours1,240this period');
    expect(screen.getByText('Billable vs non-billable')).toBeTruthy();
    expect(apiGetMeta).toHaveBeenCalledWith('/api/projects/reports', expect.objectContaining({ kind: 'time_by_person', org: '1' }), expect.anything());
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Reports' })).getByRole('button', { name: /Risk register/ }));
    expect(tab.go).toHaveBeenCalledWith('/projects/reports/risks');
  });

  it('exports CSV, Excel or PDF through the download manager', async () => {
    tab.path = ['projects', 'reports', 'time_by_person'];
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Export/ }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Export format' })).getByRole('menuitem', { name: 'PDF' }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('transfers:download', { projectsReport: { kind: 'time_by_person', format: 'pdf', query: expect.objectContaining({ org: '1', from: expect.stringMatching(/^\d{4}-\d{2}-01$/) }) }, name: 'projects-time_by_person.pdf', open: false }),
    );
  });

  it('lists the scheduled emails with their problem, and sends one now', async () => {
    tab.path = ['projects', 'reports'];
    show();
    expect(await screen.findByRole('heading', { name: 'Scheduled emails' })).toBeTruthy();
    expect(screen.getByText('Mondays at 08:00')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText(/Kamal has no Projects access/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send Portfolio summary now' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/projects/report-schedules/5/send-now', { body: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause Portfolio summary' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/projects/report-schedules/5', { body: { is_active: false } }));
  });

  it('schedules the report on screen by email', async () => {
    tab.path = ['projects', 'reports', 'budget'];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule email' }));
    const dialog = await screen.findByRole('dialog');
    // Budget shows how things stand when sent: the period does not apply.
    expect(within(dialog).getByText('This report shows how things stand when it is sent.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Excel' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Monthly' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Choose at least one person to send it to.');
    expect(request).not.toHaveBeenCalled();
  });

  it('offline: Export and Schedule email wait for a connection', async () => {
    offline = true;
    tab.path = ['projects', 'reports'];
    show();
    await waitFor(() => expect((screen.getByRole('button', { name: /Export/ }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Schedule email' }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByRole('button', { name: 'Send Portfolio summary now' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
