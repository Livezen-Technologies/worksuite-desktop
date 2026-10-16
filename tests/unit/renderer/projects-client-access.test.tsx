// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
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

const tab = vi.hoisted(() => ({ path: ['projects', '18'], go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/${tab.path.join('/')}`, active: true, path: tab.path, query: new URLSearchParams(), go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
  openRouteInWindow: vi.fn(),
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= () => undefined;

const { apiGetMeta, apiPost, apiPut, apiDelete } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { app } = await import('../../../src/core/app-state');
const { contract } = await import('@shared/ipc/contract');
const { projectReportPath } = await import('@shared/projects');
const { ExternalMembers } = await import('../../../src/modules/projects/screens/Guests');
const { ShareDialog } = await import('../../../src/modules/projects/screens/ShareDialog');
const { generatePassword } = await import('../../../src/modules/projects/screens/client-api');
const { default: ProjectsPage } = await import('../../../src/modules/projects/ProjectsPage');

const GUEST = { id: 4, name: 'Ruwan Silva', email: 'ruwan@tea.lk', company: 'Ceylon Tea Board', role: 'client', note: 'Signs off releases', user_id: null, invited_at: '2026-10-01 09:00:00', removed_at: null, external: true };
const LINKS = [
  { id: 9, label: 'For Ruwan Silva', token_prefix: 'ab12cd34', guest_id: 4, guest: { id: 4, name: 'Ruwan Silva', email: 'ruwan@tea.lk' }, sections: ['progress', 'milestones'], expires_at: '2026-12-31 23:59:59', views: 3, last_viewed_at: '2026-10-15 10:00:00', created_at: '2026-10-01 09:00:00', revoked_at: null, state: 'active' },
  { id: 8, label: 'Board pack', token_prefix: 'ff00ee11', guest_id: null, guest: null, sections: ['progress'], expires_at: null, views: 0, last_viewed_at: null, created_at: '2026-09-01 09:00:00', revoked_at: '2026-09-10 09:00:00', state: 'revoked' },
];
const UPDATES = [{ id: 2, title: 'Bidder onboarding is live', body: 'Forty bidders are registered.', posted_by: 7, posted_by_name: 'Nimal Perera', created_at: '2026-10-10 09:00:00', updated_at: '2026-10-10 09:00:00' }];

let access: Record<string, unknown>;
const project = { id: 18, code: 'PRJ-0018', name: 'e-Auction portal', org_id: 3, org_name: 'TechHubiz', client: 'Ceylon Tea Board', client_id: 5, category: null, category_id: null, category_color: null, manager: 'Nimal Perera', manager_id: 7, priority: 'high', status: 'active', start_date: '2026-06-01', end_date: '2026-10-30', baseline_end_date: null, estimated_hours: '900', budget: '0', currency: 'LKR', hourly_rate: '0', is_billable: true, is_template: false, days_left: 14, description: null, completed_at: null };
let offline = false;
function answers(path: string): unknown {
  if (path === '/api/projects/18/client-access') return access;
  if (path === '/api/projects/18/guest-candidates') return { people: [{ user_id: 31, name: 'Ravi Kumar', email: 'ravi@partner.lk', company: 'Partner Co' }] };
  if (path === '/api/projects/18') return { project, progress: { total: 0, done: 0, overdue: 0, blocked: 0, progress: 0 }, members: [], former_members: [], milestones: [], risks: [], activity: [], baselines: [], budget_history: [], next_statuses: [], can: { manage: true } };
  if (path === '/api/projects/companies') return { items: [{ id: 3, name: 'TechHubiz', currency: 'LKR' }], current: 3 };
  return {};
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const topDialog = () => screen.getAllByRole('dialog').at(-1)!;
const pick = (within_: HTMLElement, name: string | RegExp, option: string | RegExp) => {
  fireEvent.click(within(within_).getByRole('combobox', { name }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const writeText = vi.fn();

beforeEach(() => {
  offline = false;
  access = { guests: [GUEST], links: LINKS, updates: UPDATES, sections: ['progress', 'milestones', 'timeline', 'updates', 'tasks'], can_manage: true, can_post_updates: true };
  tab.go = vi.fn();
  app.set({ bootstrap: { permissions: ['project.manage'] } as never, auth: { stage: 'ready', user: { id: '7', name: 'Nimal Perera' } } as never });
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string) => ({ data: answers(path) as never, offline, cachedAt: null }));
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPut).mockReset();
  vi.mocked(apiDelete).mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (ch: string) => {
    if (ch === 'projects:outbox') return [] as never;
    if (ch === 'projects:timer') return { available: true, running: null, paused: null, recent: [], todayMinutes: 0, weekMinutes: 0, idleSince: null, offline: false, error: null, checkedAt: null } as never;
    return undefined as never;
  });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(cleanup);

describe('External members on a project’s Team', () => {
  it('lists them with company and role, edits and removes', async () => {
    vi.mocked(apiPut).mockResolvedValue({});
    vi.mocked(apiDelete).mockResolvedValue({});
    wrap(<ExternalMembers projectId={18} offline={false} />);
    const list = await screen.findByRole('list', { name: 'External members' });
    expect(list.textContent).toContain('Ruwan Silva');
    expect(list.textContent).toContain('Ceylon Tea Board');
    expect(list.textContent).toContain('ruwan@tea.lk');
    expect(within(list).getByText('Client')).toBeTruthy();

    fireEvent.click(within(list).getByRole('button', { name: 'Edit Ruwan Silva' }));
    const dialog = topDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Company' }), { target: { value: 'Tea Board' } });
    pick(dialog, 'Role', 'Observer');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/projects/18/guests/4', { name: 'Ruwan Silva', company: 'Tea Board', role: 'observer', note: 'Signs off releases' }));

    fireEvent.click(within(list).getByRole('button', { name: 'Remove Ruwan Silva' }));
    fireEvent.click(within(topDialog()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/projects/18/guests/4'));
  });

  it('adds someone outside: name, email, company, role, note', async () => {
    vi.mocked(apiPost).mockResolvedValue({ guest: GUEST });
    wrap(<ExternalMembers projectId={18} offline={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    const dialog = topDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('Enter their name.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Name/ }), { target: { value: 'Mala Perera' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Email/ }), { target: { value: 'not-an-email' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('Enter a valid email address.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Email/ }), { target: { value: 'mala@consult.lk' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Company' }), { target: { value: 'Mala Consulting' } });
    pick(dialog, 'Role', 'Collaborator');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Note/ }), { target: { value: 'QA lead' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/18/guests', { name: 'Mala Perera', email: 'mala@consult.lk', company: 'Mala Consulting', role: 'collaborator', note: 'QA lead' }));
  });

  it('adds someone at another company found by search, by their account', async () => {
    vi.mocked(apiPost).mockResolvedValue({ guest: GUEST });
    wrap(<ExternalMembers projectId={18} offline={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    const dialog = topDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Someone at another company/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('Find and choose the person to add.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('searchbox', { name: /Find a person/ }), { target: { value: 'ra' } });
    const found = await within(dialog).findByRole('list', { name: 'People found' });
    expect(apiGetMeta).toHaveBeenCalledWith('/api/projects/18/guest-candidates', { q: 'ra' }, expect.anything());
    fireEvent.click(within(found).getByRole('button', { name: /Ravi Kumar/ }));
    expect(within(dialog).getByText(/Partner Co/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/18/guests', { user_id: 31, name: 'Ravi Kumar', email: 'ravi@partner.lk', company: 'Partner Co', role: 'client' }));
  });

  it('without manage, or offline: no changes', async () => {
    access = { ...access, can_manage: false };
    wrap(<ExternalMembers projectId={18} offline={false} />);
    await screen.findByRole('list', { name: 'External members' });
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Ruwan Silva' })).toBeNull();
    cleanup();
    access = { ...access, can_manage: true };
    wrap(<ExternalMembers projectId={18} offline />);
    await screen.findByRole('list', { name: 'External members' });
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Remove Ruwan Silva' }).getAttribute('title')).toBe('Removing an external member needs a connection');
  });
});

describe('Share with client', () => {
  it('lists links, withdraws one and changes a password', async () => {
    vi.mocked(apiDelete).mockResolvedValue({});
    vi.mocked(apiPut).mockResolvedValue({});
    wrap(<ShareDialog projectId={18} projectName="e-Auction portal" offline={false} onClose={() => undefined} />);
    let list = await screen.findByRole('list', { name: 'Status links' });
    expect(list.textContent).toContain('For Ruwan Silva (ruwan@tea.lk)');
    expect(list.textContent).toContain('Shows Progress, Milestones');
    expect(list.textContent).toContain('3 views');
    expect(list.textContent).toContain('Active');
    expect(list.textContent).toContain('Withdrawn');
    expect(within(list).queryByRole('button', { name: 'Withdraw Board pack' })).toBeNull(); // already withdrawn

    const onClose = vi.fn();
    cleanup();
    wrap(<ShareDialog projectId={18} projectName="e-Auction portal" offline={false} onClose={onClose} />);
    list = await screen.findByRole('list', { name: 'Status links' });
    fireEvent.click(within(list).getByRole('button', { name: 'Withdraw For Ruwan Silva' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    // Escape answers the question, not the dialog behind it.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(list).getByRole('button', { name: 'Withdraw For Ruwan Silva' }));
    fireEvent.click(within(topDialog()).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/projects/18/share-links/9'));

    fireEvent.click(within(list).getByRole('button', { name: 'Change the password of For Ruwan Silva' }));
    const form = await screen.findByRole('form', { name: 'Change password' });
    fireEvent.change(within(form).getByLabelText(/^Password/), { target: { value: 'short' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Change password' }));
    expect(await within(form).findByText('The password needs at least 8 characters.')).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Generate' }));
    const pw = (within(form).getByLabelText(/^Password/) as HTMLInputElement).value;
    expect(pw).toHaveLength(16);
    expect((within(form).getByLabelText(/^Confirm password/) as HTMLInputElement).value).toBe(pw);
    fireEvent.click(within(form).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(pw));
    fireEvent.click(within(form).getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/projects/18/share-links/9', { password: pw }));
  });

  it('makes a link for an external member, emails it and shows the address once', async () => {
    vi.mocked(apiPost).mockResolvedValue({ link: LINKS[0], url: 'https://ws.example.lk/ps/ab12cd34secret', emailed: true, warning: null });
    wrap(<ShareDialog projectId={18} projectName="e-Auction portal" offline={false} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New link' }));
    const form = await screen.findByRole('form', { name: 'New status link' });
    // The first four sections are on by default; tasks is not.
    expect((within(form).getByRole('checkbox', { name: 'Progress' }) as HTMLInputElement).checked).toBe(true);
    expect((within(form).getByRole('checkbox', { name: 'Updates' }) as HTMLInputElement).checked).toBe(true);
    expect((within(form).getByRole('checkbox', { name: 'Tasks' }) as HTMLInputElement).checked).toBe(false);
    // Emailing is offered only once an external member is chosen.
    expect(within(form).queryByRole('checkbox', { name: /Email the link/ })).toBeNull();

    fireEvent.change(within(form).getByLabelText(/^Password/), { target: { value: 'longenough1' } });
    fireEvent.change(within(form).getByLabelText(/^Confirm password/), { target: { value: 'different1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Make link' }));
    expect(await within(form).findByText('The two passwords are not the same.')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText(/^Confirm password/), { target: { value: 'longenough1' } });
    pick(form, 'For', /Ruwan Silva/);
    fireEvent.click(within(form).getByRole('checkbox', { name: /Email the link/ }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Tasks' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Timeline' }));
    fireEvent.change(within(form).getByRole('textbox', { name: /^Label/ }), { target: { value: 'Steering committee' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Make link' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/projects/18/share-links', { password: 'longenough1', sections: ['progress', 'milestones', 'updates', 'tasks'], label: 'Steering committee', guest_id: 4, send_email: true }),
    );

    const made = await screen.findByRole('region', { name: 'Link made' });
    expect((within(made).getByRole('textbox', { name: 'Link address' }) as HTMLInputElement).value).toBe('https://ws.example.lk/ps/ab12cd34secret');
    expect(made.textContent).toContain('Send the password separately');
    expect(made.textContent).toContain('emailed to Ruwan Silva');
    fireEvent.click(within(made).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://ws.example.lk/ps/ab12cd34secret'));
    fireEvent.click(within(made).getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('list', { name: 'Status links' })).toBeTruthy();
  });

  it('posts, edits and deletes client updates', async () => {
    vi.mocked(apiPost).mockResolvedValue({});
    vi.mocked(apiPut).mockResolvedValue({});
    vi.mocked(apiDelete).mockResolvedValue({});
    wrap(<ShareDialog projectId={18} projectName="e-Auction portal" offline={false} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole('tab', { name: /Client updates/ }));
    const list = await screen.findByRole('list', { name: 'Client updates' });
    expect(list.textContent).toContain('Forty bidders are registered.');
    expect(list.textContent).toContain('Nimal Perera');

    const composer = screen.getByRole('form', { name: 'New update' });
    fireEvent.click(within(composer).getByRole('button', { name: 'Post update' }));
    expect(await within(composer).findByText('Give the update a title.')).toBeTruthy();
    fireEvent.change(within(composer).getByRole('textbox', { name: /^Title/ }), { target: { value: 'Payments go live' } });
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Update' }), { target: { value: 'Bank sandbox passed.' } });
    fireEvent.click(within(composer).getByRole('button', { name: 'Post update' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/18/updates', { title: 'Payments go live', body: 'Bank sandbox passed.' }));

    fireEvent.click(within(list).getByRole('button', { name: 'Edit Bidder onboarding is live' }));
    const edit = await screen.findByRole('form', { name: 'Edit update' });
    expect((within(edit).getByRole('textbox', { name: /^Title/ }) as HTMLInputElement).value).toBe('Bidder onboarding is live');
    fireEvent.change(within(edit).getByRole('textbox', { name: 'Update' }), { target: { value: 'Forty-two bidders are registered.' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save update' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/projects/18/updates/2', { title: 'Bidder onboarding is live', body: 'Forty-two bidders are registered.' }));

    fireEvent.click(within(list).getByRole('button', { name: 'Delete Bidder onboarding is live' }));
    fireEvent.click(within(topDialog()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/projects/18/updates/2'));
  });

  it('only reads for someone who may not change links or post updates', async () => {
    access = { ...access, can_manage: false, can_post_updates: false };
    wrap(<ShareDialog projectId={18} projectName="e-Auction portal" offline={false} onClose={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Status links' });
    expect(screen.queryByRole('button', { name: 'New link' })).toBeNull();
    expect(within(list).queryByRole('button', { name: /^Withdraw/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Client updates/ }));
    await screen.findByRole('list', { name: 'Client updates' });
    expect(screen.queryByRole('form', { name: 'New update' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
  });
});

describe('the project header: Share with client and Export report', () => {
  const show = () => wrap(<ProjectsPage tabId="t1" route="/projects/18" active />);

  it('opens the share dialog and saves the report as PDF or Excel through the download manager', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Share with client' }));
    expect(await screen.findByRole('list', { name: 'Status links' })).toBeTruthy();
    fireEvent.click(within(topDialog()).getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Export the project report' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'PDF' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { projectReport: { project: 18, format: 'pdf' }, name: 'project-report-PRJ-0018.pdf', open: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Export the project report' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Excel (.xlsx)' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { projectReport: { project: 18, format: 'xlsx' }, name: 'project-report-PRJ-0018.xlsx', open: true }));
    expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('PRJ-0018 report as Excel'));
  });

  it('offline: the export waits for a connection', async () => {
    offline = true;
    show();
    const btn = await screen.findByRole('button', { name: 'Export the project report' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Exporting a report needs a connection');
  });
});

describe('the whole-project report download', () => {
  const input = contract['transfers:download'].input;

  it('is asked for by project and format; the main process builds the address', () => {
    expect(projectReportPath({ project: 18, format: 'pdf' })).toBe('/api/projects/18/report?format=pdf');
    expect(projectReportPath({ project: 18, format: 'xlsx' })).toBe('/api/projects/18/report?format=xlsx');
    const ok = { projectReport: { project: 18, format: 'xlsx' }, name: 'project-report-PRJ-0018.xlsx', open: true };
    expect(input.safeParse(ok).success).toBe(true);
    expect(input.safeParse({ ...ok, projectReport: { project: 18, format: 'csv' } }).success).toBe(false);
    expect(input.safeParse({ ...ok, projectReport: { project: '18/../x', format: 'pdf' } }).success).toBe(false);
    expect(input.safeParse({ ...ok, projectReport: { project: 18, format: 'pdf', path: '/etc' } }).success).toBe(false);
    expect(input.safeParse({ ...ok, fileId: '9' }).success).toBe(false);
  });

  it('generates strong link passwords', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[!#$%*+\-=?@]/);
      expect(p).not.toMatch(/[0O1lI]/);
      seen.add(p);
    }
    expect(seen.size).toBe(20);
  });
});
