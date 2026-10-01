// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { TabProvider } from '../../../src/core/tab-context';
import { visibleApps } from '../../../shared/apps';
import { resolveWebLink } from '../../../shared/links';
import HomePage from '../../../src/modules/home/HomePage';
import { compactCount, taskBuckets } from '../../../src/modules/home/today';
import type { Task } from '../../../src/modules/tasks/api';

/**
 * Home, modernised (worksuite-desktop#104) with announcements (#98): counts
 * that are the lists they open, due today, overdue and upcoming apart, widgets
 * that load and fail on their own, announcements read and acknowledged here,
 * and a layout that can be changed and reset.
 */
const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const task = (id: number, due: string | null, over: Partial<Task> = {}) => ({ id, title: `Task ${id}`, status: 'todo', priority: 'normal', due_date: due, due_at: null, org_id: 1, org_name: 'Livezen', tags: [], assignee_id: 5, list_id: null, ...over }) as unknown as Task;

const TASKS = [task(1, shift(-2)), task(2, today), task(3, today), task(4, shift(3)), task(5, shift(30)), task(6, today, { status: 'done' }), task(7, today, { org_id: 2 })];
const NOTICES = [
  { id: 10, title: 'Office closed Friday', preview: 'The office is closed.', priority: 'normal', pinned: false, requires_ack: false, published_at: '2026-09-30 09:00:00', expires_at: null, read: true, acknowledged: false, company: 'Livezen', author: 'Ann HR', companies: [{ id: 1, name: 'Livezen' }] },
  { id: 11, title: 'New security policy', preview: 'Please read and acknowledge.', priority: 'urgent', pinned: false, requires_ack: true, published_at: '2026-09-29 09:00:00', expires_at: null, read: false, acknowledged: false, company: 'Livezen', author: 'Ann HR', companies: [{ id: 1, name: 'Livezen' }, { id: 2, name: 'Asterix' }] },
  { id: 12, title: 'Asterix picnic', preview: null, priority: 'normal', pinned: false, requires_ack: false, published_at: '2026-09-28 09:00:00', expires_at: null, read: false, acknowledged: false, company: 'Asterix', author: 'Bo', companies: [{ id: 2, name: 'Asterix' }] },
];

let failDash = false;
function answer() {
  vi.mocked(apiGetMeta).mockImplementation((async (path: string) => {
    if (path === '/api/tasks') return { data: { tasks: TASKS }, offline: false };
    if (path === '/api/calendar/events') return { data: { events: [{ source: 'businessmeeting', id: 4, title: 'Bid review', color: null, start_at: `${today} 23:00:00`, end_at: `${today} 23:30:00`, all_day: false, editable: false, join_url: 'https://meet.example/x', related: { kind_label: 'Tender Meeting' } }] }, offline: false };
    if (path === '/api/dashboard/home') {
      if (failDash) throw new Error('The dashboard could not be loaded.');
      return { data: { user: { name: 'Ada' }, stats: {}, recent_files: [{ id: 1, name: 'Plan.pdf', extension: 'pdf', size: 10, location: 'My files', at: '2026-09-30 10:00:00', kind: 'PDF', status: 'processing' }, { id: 2, name: 'upload.part', extension: 'part', size: 10, location: 'My files', at: '2026-09-30 10:00:00' }], activity: [{ id: 1, description: 'uploaded files to Marketing', user: 'Bo', at: '2026-09-30 10:00:00', count: 12 }] }, offline: false };
    }
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/hr/announcements/mine') return { items: NOTICES };
    if (path === '/api/hr/announcements/mine/11') return { ...NOTICES[1], body: '<p>Read <b>this</b>.</p>' };
    if (path === '/api/calendar/conflicts/invitations') return { invitations: [] };
    if (path === '/api/hr/approvals/pending') return { count: 1, items: [{ kind: 'request', id: 3, who: 'Cy', what: 'Expense claim', when: 'Today', as: 'approver', link: '/hr?tab=approvals' }] };
    if (path === '/api/dashboard/summary') return { total: 0, digest: { text: null, reason: null, points: [{ text: '2 tasks due today', link: '/tasks?scope=today' }], sources: [{ label: 'Tasks', link: '/tasks' }] } };
    throw new Error(`unexpected ${path}`);
  }) as never);
}

function show(route = '/home') {
  let current = route;
  const go = vi.fn((r: string) => {
    current = r;
    view.rerender(tree());
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <TabProvider tabId="t1" route={current} active onGo={go}>
        <HomePage tabId="t1" route={current} active />
      </TabProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { go };
}

beforeEach(() => {
  failDash = false;
  localStorage.clear();
  nav.navigate.mockReset();
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  answer();
  app.set({
    auth: { user: { id: '5', name: 'Ada Lovelace' } } as never,
    organizationId: '1',
    bootstrap: { organizations: [{ id: '1', name: 'Livezen' }, { id: '2', name: 'Asterix' }], user: {} } as never,
    apps: visibleApps({ apps: '*', permissions: ['*'] }),
  });
});
afterEach(cleanup);

describe('Home summary cards (#104)', () => {
  it('keeps due today, overdue and upcoming apart, counted as the Tasks page counts them, for the company chosen', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'Due today: 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Overdue: 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upcoming: 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Overdue: 1' }));
    expect(nav.navigate).toHaveBeenCalledWith('/tasks?scope=overdue');

    fireEvent.change(screen.getByLabelText('Company'), { target: { value: '' } });
    expect(await screen.findByRole('button', { name: 'Due today: 3' })).toBeTruthy();
  });

  it('formats a large count compactly with the exact one on hover', () => {
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1234)).toBe('1.2K');
    expect(compactCount(25_400_000)).toBe('25.4M');
  });

  it('sorts the buckets by when they are due', () => {
    const b = taskBuckets([task(8, shift(5)), task(9, shift(1))], today);
    expect(b.upcoming.map((t) => t.id)).toEqual([9, 8]);
  });
});

describe('Home widgets (#104)', () => {
  it('shows the agenda with what kind of entry it is and Join; files without temporary artifacts, with their state; grouped activity', async () => {
    show();
    const agenda = await screen.findByRole('region', { name: 'Agenda' });
    expect(await within(agenda).findByText('Bid review')).toBeTruthy();
    expect(within(agenda).getByText('Tender Meeting')).toBeTruthy();
    expect(within(agenda).getByRole('button', { name: 'Join' })).toBeTruthy();
    expect(within(agenda).getByRole('button', { name: 'Open Meeting: Bid review' })).toBeTruthy();

    const files = screen.getByRole('region', { name: 'Recent files' });
    expect(await within(files).findByText('Plan.pdf')).toBeTruthy();
    expect(within(files).queryByText('upload.part')).toBeNull();
    expect(within(files).getByText('Processing')).toBeTruthy();
    expect(screen.getByTitle('12 updates').textContent).toBe('×12');
  });

  it('a widget that fails says so with Retry; the others carry on', async () => {
    failDash = true;
    show();
    const files = await screen.findByRole('region', { name: 'Recent files' });
    expect(await within(files).findByText('The dashboard could not be loaded.')).toBeTruthy();
    expect(within(files).getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Due today: 2' })).toBeTruthy();
    failDash = false;
    fireEvent.click(within(files).getByRole('button', { name: 'Retry' }));
    expect(await within(files).findByText('Plan.pdf')).toBeTruthy();
  });

  it('the summary is points, each going to where it comes from, with its sources', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: '2 tasks due today' }));
    expect(nav.navigate).toHaveBeenCalledWith('/tasks?scope=today');
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeTruthy();
  });
});

describe('Announcements on Home (#98, #104)', () => {
  it('urgent first, for the company chosen, with Acknowledge; acknowledgements also wait for me', async () => {
    show();
    const box = await screen.findByRole('region', { name: 'Announcements' });
    await within(box).findByText('New security policy');
    const titles = within(box).getAllByText(/Office closed Friday|New security policy|Asterix picnic/).map((n) => n.textContent);
    expect(titles).toEqual(['New security policy', 'Office closed Friday']);
    expect(within(box).getByText(/Ann HR · .* · 2 companies/)).toBeTruthy();

    const waiting = screen.getByRole('region', { name: 'Waiting for me' });
    expect(within(waiting).getByText('New security policy')).toBeTruthy();
    expect(within(waiting).getByText('Expense claim · Cy')).toBeTruthy();

    fireEvent.click(within(box).getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/announcements/mine/11/ack', {}));
  });

  it('opens one to read, and marks it read', async () => {
    const { go } = show();
    const box = await screen.findByRole('region', { name: 'Announcements' });
    fireEvent.click(await within(box).findByText('New security policy'));
    expect(go).toHaveBeenCalledWith('/home?announcement=11');
    expect(await screen.findByText('this')).toBeTruthy();
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/announcements/mine/11/read', {}));
  });

  it('one no longer there says so', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path.startsWith('/api/hr/announcements/mine/')) throw new ApiError(404, 'That announcement is not available to you.', null);
      return { items: [], invitations: [], count: 0, total: 0, digest: { text: null, reason: null } };
    }) as never);
    show('/home?announcement=99');
    expect(await screen.findByText(/no longer available/)).toBeTruthy();
  });

  it('a notification link opens it on Home', () => {
    expect(resolveWebLink('/announcements?open=12')).toEqual({ kind: 'tab', route: '/home?announcement=12', app: 'home' });
    expect(resolveWebLink('/announcements')).toEqual({ kind: 'tab', route: '/home?announcements=all', app: 'home' });
  });
});

describe('Customize (#104)', () => {
  it('hides, widens and resets, kept for next time', async () => {
    show();
    await screen.findByRole('region', { name: 'Activity' });
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Activity' }));
    expect(screen.queryByRole('region', { name: 'Activity' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Make Agenda wide' }));
    expect(screen.getByRole('region', { name: 'Agenda' }).className).toContain('col-span-2');
    expect(JSON.parse(localStorage.getItem('ws.home.layout:5') ?? '{}')).toMatchObject({ hidden: ['activity'], wide: ['calendar'] });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reset Layout' })));
    expect(screen.getByRole('region', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Agenda' }).className).not.toContain('col-span-2');
  });
});
