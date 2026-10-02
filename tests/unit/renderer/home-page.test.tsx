// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { aiWidget, ui } from '../../../src/core/ui';
import { visibleApps } from '../../../shared/apps';
import { resolveWebLink } from '../../../shared/links';
import HomePage from '../../../src/modules/home/HomePage';
import { current, ranked, type MyAnnouncement } from '../../../src/modules/home/Announcements';
import { touchesAnnouncements } from '../../../src/core/query';
import { assistantSession } from '../../../src/modules/ai/session';
import { compactCount, taskBuckets } from '../../../src/modules/home/today';
import type { Task } from '../../../src/modules/tasks/api';

/**
 * Home, optimized (on #104's widgets, #98's announcements and #97's invitations): four numbers that are the lists
 * they open, today's work in tabs, the day as a timeline with now and the next meeting, the brief, Waiting for me,
 * and a layout that can be changed and reset — a layout saved before keeps working.
 */
// The clock stands still at 10:30 on the WorkSuite clock (UTC here), Friday 2 October 2026.
const NOW = new Date('2026-10-02T10:30:00Z');
const today = '2026-10-02';
const shift = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const task = (id: number, due: string | null, over: Partial<Task> = {}) => ({ id, title: `Task ${id}`, status: 'todo', priority: 'medium', due_date: due, due_at: null, org_id: 1, org_name: 'Livezen', tags: [], assignee_id: 5, list_id: null, ...over }) as unknown as Task;

const TASKS = [task(1, shift(-2), { priority: 'urgent' }), task(2, today), task(3, today, { due_at: '2026-10-02T15:00:00Z', priority: 'high' }), task(4, shift(3)), task(5, shift(30)), task(6, today, { status: 'done' }), task(7, today, { org_id: 2 })];
const NOTICES = [
  { id: 10, title: 'Office closed Friday', preview: 'The office is closed.', priority: 'normal', pinned: false, requires_ack: false, published_at: '2026-09-30 09:00:00', expires_at: null, read: true, acknowledged: false, company: 'Livezen', author: 'Ann HR', companies: [{ id: 1, name: 'Livezen' }] },
  { id: 11, title: 'New security policy', preview: 'Please read and acknowledge.', priority: 'urgent', pinned: false, requires_ack: true, published_at: '2026-09-29 09:00:00', expires_at: null, read: false, acknowledged: false, company: 'Livezen', author: 'Ann HR', companies: [{ id: 1, name: 'Livezen' }, { id: 2, name: 'Asterix' }] },
  { id: 12, title: 'Asterix picnic', preview: null, priority: 'normal', pinned: false, requires_ack: false, published_at: '2026-09-28 09:00:00', expires_at: null, read: false, acknowledged: false, company: 'Asterix', author: 'Bo', companies: [{ id: 2, name: 'Asterix' }] },
];
const ev = (over: Record<string, unknown>) => ({ source: 'event', id: 1, title: 'x', color: null, start_at: `${today} 09:00:00`, end_at: `${today} 10:00:00`, all_day: false, editable: false, ...over });
const EVENTS = [
  ev({ source: 'subscription', id: 21, title: 'Adobe renewal', all_day: true, start_at: `${today} 00:00:00`, end_at: null }),
  ev({ source: 'subscription', id: 22, title: 'Slack renewal', all_day: true, start_at: `${today} 00:00:00`, end_at: null }),
  ev({ source: 'businessmeeting', id: 3, title: 'Design review', start_at: `${today} 09:00:00`, end_at: `${today} 09:30:00` }),
  ev({ source: 'event', id: 9, title: 'Weekly meeting', start_at: `${today} 11:25:00`, end_at: `${today} 11:55:00`, join_url: 'https://teams.microsoft.com/l/meetup/9' }),
  ev({
    source: 'businessmeeting',
    id: 4,
    title: 'Bid review',
    start_at: `${today} 16:00:00`,
    end_at: `${today} 17:00:00`,
    location: 'Ministry of Health, Colombo 10',
    source_type: 'tender',
    related: { kind_label: 'Tender Meeting', label: 'TND-2026-014 · Office equipment supply', link: '/tenders?open=14', open_label: 'Open Tender' },
  }),
];
const DETAIL = (id: number, over: Record<string, unknown> = {}) => ({
  meeting: { id, location_type: 'online', online_provider: 'google' },
  participants: [
    { id: 1, name: 'Hasini Mendis', rsvp: 'accepted' },
    { id: 2, name: 'Samali Silva', rsvp: 'accepted' },
    { id: 3, name: 'Ravi Tharuka', rsvp: 'accepted' },
    { id: 4, name: 'Dinuka K', rsvp: 'accepted' },
    { id: 5, name: 'Nope', rsvp: 'declined' },
  ],
  minutes: null,
  recordings: [],
  ...over,
});

let failDash = false;
function answer() {
  vi.mocked(apiGetMeta).mockImplementation((async (path: string) => {
    if (path === '/api/tasks') return { data: { tasks: TASKS }, offline: false };
    if (path === '/api/calendar/events') return { data: { events: EVENTS }, offline: false };
    if (path === '/api/chat/rooms') return { data: { rooms: [{ id: 1, mentions: 2, unread: 5 }, { id: 2, mentions: 4, unread: 1 }] }, offline: false };
    if (path === '/api/dashboard/home') {
      if (failDash) throw new Error('The dashboard could not be loaded.');
      return {
        data: {
          user: { name: 'Ada' },
          stats: {},
          recent_files: [
            { id: 1, name: 'Plan.pdf', extension: 'pdf', size: 2_400_000, location: 'CreativeFx', at: '2026-10-02 09:00:00', kind: 'PDF', status: 'processing' },
            { id: 2, name: 'upload.part', extension: 'part', size: 10, location: 'My files', at: '2026-09-30 10:00:00' },
          ],
          activity: [{ id: 1, description: 'uploaded files to Marketing', user: 'Bo', at: '2026-09-30 10:00:00', count: 12 }],
        },
        offline: false,
      };
    }
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/hr/announcements/mine') return { items: NOTICES };
    if (path === '/api/hr/announcements/mine/11') return { ...NOTICES[1], body: '<p>Read <b>this</b>.</p>' };
    if (path === '/api/calendar/conflicts/invitations') return { invitations: [] };
    if (path === '/api/hr/approvals/pending') return { count: 1, items: [{ kind: 'request', id: 3, who: 'Cy', what: 'Expense claim', when: 'Today', as: 'approver', link: '/hr?tab=approvals' }] };
    if (path === '/api/dashboard/summary') return { total: 0, digest: { text: null, reason: null, points: [{ text: '2 tasks due today', link: '/tasks?scope=today' }], sources: [{ label: 'Tasks', link: '/tasks' }] } };
    if (path === '/api/meetings/3') return DETAIL(3, { recordings: [{ id: 1, status: 'ready' }], minutes: { summary: 'Agreed.', decisions: null, notes: null, finalised_at: null } });
    if (path === '/api/meetings/4') return DETAIL(4);
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

const regions = () => screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-US', timeFormat: '12' });
});
afterAll(() => {
  vi.useRealTimers();
  setRegional({});
});

beforeEach(() => {
  aiWidget.set({ open: false, maximized: false });
  failDash = false;
  localStorage.clear();
  nav.navigate.mockReset();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  answer();
  app.set({
    auth: { user: { id: '5', name: 'Ada Lovelace' } } as never,
    organizationId: '1',
    bootstrap: { organizations: [{ id: '1', name: 'Livezen' }, { id: '2', name: 'Asterix' }], user: {} } as never,
    apps: visibleApps({ apps: '*', permissions: ['*'] }),
    status: { unread: { chat: 120, mail: 3, notifications: 0, tasks: 0 } } as never,
  });
});
afterEach(cleanup);

describe('Home header', () => {
  it('says the day above the greeting, with the organization filter, Customize and New', async () => {
    show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Good morning, Ada');
    expect(screen.getByText('Friday, October 2')).toBeTruthy();
    expect((screen.getByLabelText('Organization') as HTMLSelectElement).value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(nav.navigate).toHaveBeenCalledWith('/tasks?new=1');
    fireEvent.click(screen.getByRole('button', { name: 'More new items' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'New' })).getByRole('menuitem', { name: 'Event' }));
    expect(nav.navigate).toHaveBeenCalledWith('/calendar?new=1');
  });
});

describe('Home stat tiles', () => {
  it('four numbers with their note, each opening its list, for the company chosen', async () => {
    show();
    const due = await screen.findByRole('button', { name: 'Due today: 2' });
    expect(within(due).getByText('1 overdue').className).toContain('text-danger');
    const meetings = await screen.findByRole('button', { name: 'Meetings today: 3' });
    expect(within(meetings).getByText('Next at 11:25 AM')).toBeTruthy();
    const waiting = await screen.findByRole('button', { name: 'Waiting for you: 2' });
    expect(within(waiting).getByText('1 approval · 1 acknowledgement')).toBeTruthy();
    const unread = screen.getByRole('button', { name: 'Unread messages: 123' });
    expect(within(unread).getByText('99+')).toBeTruthy();
    expect(await within(unread).findByText('6 mentions')).toBeTruthy();

    fireEvent.click(due);
    expect(nav.navigate).toHaveBeenCalledWith('/tasks?scope=today');
    fireEvent.click(meetings);
    expect(nav.navigate).toHaveBeenCalledWith('/meetings');
    fireEvent.click(unread);
    expect(nav.navigate).toHaveBeenCalledWith('/chat');

    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: '' } });
    expect(await screen.findByRole('button', { name: 'Due today: 3' })).toBeTruthy();
  });

  it('shows only the tiles of apps the person can open', async () => {
    app.set({ apps: visibleApps({ apps: '*', permissions: ['*'] }).filter((a) => a.id !== 'tasks' && a.id !== 'chat' && a.id !== 'mail') });
    show();
    expect(await screen.findByRole('button', { name: /^Meetings today/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Due today/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unread messages/ })).toBeNull();
    expect(screen.queryByRole('region', { name: "Today's work" })).toBeNull();
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

describe("Today's work", () => {
  it('Today, Overdue and Upcoming as tabs with their counts; a task is completed with the task API', async () => {
    vi.mocked(call).mockResolvedValue({ delivered: true } as never);
    show();
    const work = await screen.findByRole('region', { name: "Today's work" });
    const tabs = await within(work).findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Today2', 'Overdue1', 'Upcoming1']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    const panel = within(work).getByRole('tabpanel');
    expect(within(panel).getByText('Task 2')).toBeTruthy();
    const row3 = within(panel).getByText('Task 3').closest('li')!;
    expect(within(row3).getByText('3 PM')).toBeTruthy();
    expect(within(row3).getByText('High')).toBeTruthy();
    expect(within(row3).getAllByText('Livezen')).toHaveLength(1);

    fireEvent.click(tabs[1]!);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    const late = within(within(work).getByRole('tabpanel')).getByText('Task 1').closest('li')!;
    expect(within(late).getByText('Urgent')).toBeTruthy();
    expect(within(late).getByText(/Sep|Wed/).className).toContain('text-danger');
    fireEvent.click(within(late).getByRole('checkbox', { name: 'Mark “Task 1” done' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ method: 'PATCH', path: '/api/tasks/1', body: { field: 'status', value: 'done' } })));
    expect((within(late).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);

    fireEvent.keyDown(tabs[1]!, { key: 'ArrowRight' });
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
    expect(within(within(work).getByRole('tabpanel')).getByText('Task 4')).toBeTruthy();

    fireEvent.click(within(work).getByRole('button', { name: 'Add a task' }));
    expect(nav.navigate).toHaveBeenCalledWith('/tasks?new=1');
    fireEvent.click(within(work).getByRole('button', { name: 'All tasks' }));
    expect(nav.navigate).toHaveBeenCalledWith('/tasks');
  });
});

describe("Today's agenda", () => {
  it('folds the all-day entries, mutes what ended with its recording and notes, and marks now', async () => {
    show();
    const agenda = await screen.findByRole('region', { name: "Today's agenda" });
    const allDay = await within(agenda).findByRole('button', { name: /All day · 2 renewals/ });
    expect(allDay.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(allDay);
    expect(within(agenda).getByText('Adobe renewal')).toBeTruthy();

    const timeline = within(agenda).getByRole('list', { name: 'Timeline' });
    const items = within(timeline).getAllByRole('listitem').filter((li) => li.parentElement === timeline);
    expect(items.map((li) => li.getAttribute('aria-label') ?? li.querySelector('[title]')?.getAttribute('title'))).toEqual(['Design review', 'Now, 10:30 AM', 'Weekly meeting', 'Bid review']);
    const past = items[0]!;
    expect(within(past).getByText('Ended')).toBeTruthy();
    expect(within(past).getByText('30 min')).toBeTruthy();
    fireEvent.click(await within(past).findByRole('button', { name: 'Recording & notes' }));
    expect(nav.navigate).toHaveBeenCalledWith('/meetings?meeting=3');
  });

  it('draws out the next meeting: how soon, who and where, Join, Details and more', async () => {
    show();
    const agenda = await screen.findByRole('region', { name: "Today's agenda" });
    const card = (await within(agenda).findByText('Weekly meeting')).closest('[data-next-meeting]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).getByText('in 55 min')).toBeTruthy();
    expect(within(card).getByText('Microsoft Teams')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Join' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://teams.microsoft.com/l/meetup/9' });
    fireEvent.click(within(card).getByRole('button', { name: 'More options for Weekly meeting' }));
    fireEvent.click(within(card).getByRole('menuitem', { name: 'Open in Calendar' }));
    expect(nav.navigate).toHaveBeenCalledWith(`/calendar?date=${today}`);
  });

  it('a tender meeting says so, with its reference, Open tender and View meeting', async () => {
    show();
    const agenda = await screen.findByRole('region', { name: "Today's agenda" });
    const row = (await within(agenda).findByText('Bid review')).closest('li')!;
    expect(within(row).getByText('Tender meeting')).toBeTruthy();
    expect(within(row).getByText('TND-2026-014 · Office equipment supply · Ministry of Health, Colombo 10')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Open tender' }));
    const target = resolveWebLink('/tenders?open=14');
    if (target.kind === 'tab') expect(nav.navigate).toHaveBeenCalledWith(target.route);
    else expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/tenders?open=14' });
    fireEvent.click(within(row).getByRole('button', { name: 'View meeting' }));
    expect(nav.navigate).toHaveBeenCalledWith('/meetings?meeting=4');
  });

  it('the next meeting from a server with Meetings shows its people and provider', async () => {
    const base = vi.mocked(apiGetMeta).getMockImplementation()!;
    vi.mocked(apiGetMeta).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path === '/api/calendar/events') return { data: { events: [EVENTS[4]] }, offline: false };
      return (base as (p: string, ...r: unknown[]) => unknown)(path, ...rest);
    }) as never);
    show();
    const card = (await screen.findByText('Bid review')).closest('[data-next-meeting]') as HTMLElement;
    expect(within(card).getByText('in 5 hr 30 min')).toBeTruthy();
    expect(await within(card).findByRole('img', { name: '4 people: Hasini Mendis, Samali Silva, Ravi Tharuka, Dinuka K' })).toBeTruthy();
    expect(within(card).getByText('+1')).toBeTruthy();
    expect(within(card).getByText('Google Meet (link)')).toBeTruthy();
    expect(within(card).getByText('Tender meeting')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Open tender' })).toBeTruthy();
  });
});

describe('Home cards (#104)', () => {
  it('files without temporary artifacts, with their state and a menu; grouped activity', async () => {
    show();
    const files = await screen.findByRole('region', { name: 'Recent files' });
    expect(await within(files).findByText('Plan.pdf')).toBeTruthy();
    expect(within(files).queryByText('upload.part')).toBeNull();
    expect(within(files).getByText('Processing')).toBeTruthy();
    expect(within(files).getByText('CreativeFx · 2.3 MB')).toBeTruthy();
    fireEvent.click(within(files).getByRole('button', { name: 'More actions for Plan.pdf' }));
    fireEvent.click(within(files).getByRole('menuitem', { name: 'Download' }));
    expect(call).toHaveBeenCalledWith('transfers:download', { fileId: '1', name: 'Plan.pdf' });
    fireEvent.click(within(files).getByRole('button', { name: 'My Drive' }));
    expect(nav.navigate).toHaveBeenCalledWith('/files');
    expect(screen.getByTitle('12 updates').textContent).toBe('×12');
  });

  it('a card that fails says so with Retry; the others carry on', async () => {
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

  it('the brief is points, each going to where it comes from, with its sources; a question goes to the assistant', async () => {
    show();
    const brief = await screen.findByRole('region', { name: 'Your daily brief' });
    fireEvent.click(await within(brief).findByRole('button', { name: '2 tasks due today' }));
    expect(nav.navigate).toHaveBeenCalledWith('/tasks?scope=today');
    expect(within(brief).getByRole('button', { name: 'Tasks' })).toBeTruthy();
    expect(within(brief).getByText(/^Updated /)).toBeTruthy();
    fireEvent.change(within(brief).getByRole('textbox', { name: 'Ask AI' }), { target: { value: 'What is due this week?' } });
    fireEvent.click(within(brief).getByRole('button', { name: 'Send to AI' }));
    expect(assistantSession.store.get().text).toBe('What is due this week?');
    expect(aiWidget.get().open).toBe(true);
    expect(ui.get().dock).toBeNull();
  });
});

describe('Announcements on Home (#98, #104)', () => {
  it('urgent first, for the company chosen, with Acknowledge; acknowledgements also wait for me', async () => {
    show();
    const box = await screen.findByRole('region', { name: 'Announcements' });
    await within(box).findByText('New security policy');
    const titles = within(box).getAllByText(/Office closed Friday|New security policy|Asterix picnic/).map((n) => n.textContent);
    expect(titles).toEqual(['New security policy', 'Office closed Friday']);
    expect(within(box).getByText('2 companies')).toBeTruthy();
    expect(within(box).getAllByText(/^Ann HR · /)).toHaveLength(2);

    const waiting = screen.getByRole('region', { name: 'Waiting for me' });
    expect(within(waiting).getByText('Read announcement')).toBeTruthy();
    expect(within(waiting).getByText('New security policy · Livezen')).toBeTruthy();
    expect(within(waiting).getByText('Expense claim')).toBeTruthy();
    expect(within(waiting).getByText('Cy · Today')).toBeTruthy();

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

  it('Open on an acknowledgement waiting for me opens it', async () => {
    const { go } = show();
    const waiting = await screen.findByRole('region', { name: 'Waiting for me' });
    fireEvent.click(await within(waiting).findByRole('button', { name: 'Open New security policy' }));
    expect(go).toHaveBeenCalledWith('/home?announcement=11');
  });

  it('one no longer there says so', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path.startsWith('/api/hr/announcements/mine/')) throw new ApiError(404, 'That announcement is not available to you.', null);
      return { items: [], invitations: [], count: 0, total: 0, digest: { text: null, reason: null } };
    }) as never);
    show('/home?announcement=99');
    expect(await screen.findByText(/no longer available/)).toBeTruthy();
  });

  it('urgent and pinned come first; one past its expiry is gone; See all opens every one', async () => {
    const a = (id: number, over: Partial<MyAnnouncement>) => ({ ...NOTICES[0], id, title: `N${id}`, ...over }) as MyAnnouncement;
    const order = ranked([
      a(1, { priority: 'important', published_at: '2026-10-01 09:00:00' }),
      a(2, { priority: 'normal', pinned: true, published_at: '2026-09-01 09:00:00' }),
      a(3, { priority: 'urgent', published_at: '2026-09-02 09:00:00' }),
      a(4, { priority: 'normal', published_at: '2026-10-02 09:00:00' }),
      a(5, { priority: 'urgent', pinned: true, published_at: '2026-08-01 09:00:00' }),
    ]).map((n) => n.id);
    expect(order).toEqual([5, 3, 2, 1, 4]);
    const now = Date.parse('2026-10-02T10:30:00Z');
    expect(current([a(1, { expires_at: '2026-10-02 10:29:00' }), a(2, { expires_at: '2026-10-02 23:59:59' }), a(3, { expires_at: null })], now).map((n) => n.id)).toEqual([2, 3]);

    const { go } = show();
    const box = await screen.findByRole('region', { name: 'Announcements' });
    fireEvent.click(await within(box).findByRole('button', { name: 'See all announcements' }));
    expect(go).toHaveBeenCalledWith('/home?announcements=all');
  });

  it('an announcement published, edited or withdrawn elsewhere refreshes the lists', () => {
    expect(touchesAnnouncements({ type: 'hr.announcement.changed' })).toBe(true);
    expect(touchesAnnouncements({ type: 'notification', event: 'hr.announcement_published' })).toBe(true);
    expect(touchesAnnouncements({ type: 'notification', event: 'files.shared' })).toBe(false);
  });

  it('a notification link opens it on Home', () => {
    expect(resolveWebLink('/announcements?open=12')).toEqual({ kind: 'tab', route: '/home?announcement=12', app: 'home' });
    expect(resolveWebLink('/announcements')).toEqual({ kind: 'tab', route: '/home?announcements=all', app: 'home' });
  });
});

describe('Customize (#104, optimized)', () => {
  it('lays the cards out as designed: work beside the agenda, activity beside files, the rail on the right', async () => {
    show();
    await screen.findByRole('region', { name: 'Recent activity' });
    expect(regions()).toEqual(["Today's work", "Today's agenda", 'Recent activity', 'Recent files', 'Your daily brief', 'Waiting for me', 'Announcements']);
    expect(screen.getByRole('region', { name: "Today's work" }).className).toContain('md:col-span-5');
    expect(screen.getByRole('region', { name: "Today's agenda" }).className).toContain('md:col-span-4');
  });

  it('hides, widens, reorders and resets, kept for next time', async () => {
    show();
    await screen.findByRole('region', { name: 'Recent activity' });
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Recent activity' }));
    expect(screen.queryByRole('region', { name: 'Recent activity' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "Make Today's agenda wide" }));
    expect(screen.getByRole('region', { name: "Today's agenda" }).className).toContain('md:col-span-9');
    fireEvent.click(screen.getByRole('button', { name: 'Move Announcements up' }));
    expect(regions().slice(-3)).toEqual(['Your daily brief', 'Announcements', 'Waiting for me']);
    // The first of its zone cannot go further up, though a main card is above it in the list.
    expect((screen.getByRole('button', { name: 'Move Your daily brief up' }) as HTMLButtonElement).disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('ws.home.layout:5') ?? '{}')).toMatchObject({ version: 2, hidden: ['activity'], wide: ['calendar'] });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reset Layout' })));
    expect(screen.getByRole('region', { name: 'Recent activity' })).toBeTruthy();
    expect(screen.getByRole('region', { name: "Today's agenda" }).className).not.toContain('md:col-span-9');
    expect(regions().slice(-3)).toEqual(['Your daily brief', 'Waiting for me', 'Announcements']);
  });

  it('a layout saved before the optimized Home keeps what was hidden, and starts from the design', async () => {
    localStorage.setItem('ws.home.layout:5', JSON.stringify({ order: ['work', 'calendar', 'waiting', 'announcements', 'activity', 'files', 'summary'], hidden: ['files'], wide: ['calendar'] }));
    show();
    await screen.findByRole('region', { name: 'Recent activity' });
    expect(regions()).toEqual(["Today's work", "Today's agenda", 'Recent activity', 'Your daily brief', 'Waiting for me', 'Announcements']);
    expect(screen.getByRole('region', { name: "Today's agenda" }).className).toContain('md:col-span-4');
    // Alone in its row, activity takes all of it.
    expect(screen.getByRole('region', { name: 'Recent activity' }).className).toContain('md:col-span-9');
  });
});

describe('Invitations waiting for me (#97)', () => {
  const invite = (id: number, title: string, my_rsvp: string) => ({
    source: 'meeting', id, title, start_at: `${shift(2)} 06:00:00`, end_at: `${shift(2)} 07:00:00`, all_day: false, my_rsvp,
    conflicts: [{ user_id: 5, source: 'meeting', id: 70, title: 'Quarterly planning prep', busy_only: false, start_at: `${shift(2)} 06:00:00`, end_at: `${shift(2)} 06:30:00`, all_day: false, status: 'accepted', tentative: false }],
    duplicates: [], duplicate: false,
    link: `/meetings?meeting=${id}`, organizer: 'Nadia Perera', timezone: 'Asia/Colombo', where: 'Board room, HQ', location_type: 'room', online_url: null,
  });

  it('lists only the unanswered, with who, when, where and what it overlaps, answered in place and counted', async () => {
    const base = vi.mocked(apiGet).getMockImplementation()!;
    vi.mocked(apiGet).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path === '/api/calendar/conflicts/invitations') return { invitations: [invite(7, 'Budget review', 'no_response'), invite(8, 'Standup', 'tentative')] };
      return (base as (p: string, ...r: unknown[]) => unknown)(path, ...rest);
    }) as never);
    const { go } = show();
    const waiting = await screen.findByRole('region', { name: 'Waiting for me' });
    const row = (await within(waiting).findByText('Budget review')).closest('li')!;
    expect(within(waiting).queryByText('Standup')).toBeNull();
    expect(within(row).getByText('Invitation from Nadia Perera')).toBeTruthy();
    expect(within(row).getByText(/ \(UTC\) · booked in Asia\/Colombo$/)).toBeTruthy();
    expect(within(row).getByText('Board room, HQ')).toBeTruthy();
    expect(within(row).getByRole('note').textContent).toContain('Overlaps “Quarterly planning prep”');
    // The approval, the acknowledgement and the one invitation not yet answered — "maybe" is an answer.
    const tile = await screen.findByRole('button', { name: 'Waiting for you: 3' });
    expect(within(tile).getByText('1 invitation · 1 approval · 1 acknowledgement')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Maybe' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/calendar/conflicts/invitations/meetings/7/rsvp', { rsvp: 'tentative' }));
    fireEvent.click(within(row).getByRole('button', { name: 'View meeting' }));
    expect(nav.navigate.mock.calls.flat().concat(go.mock.calls.flat())).toContain('/meetings?meeting=7');
    fireEvent.click(within(waiting).getByRole('button', { name: 'All invitations' }));
    expect(nav.navigate).toHaveBeenCalledWith('/meetings?tab=invitations');
  });
});
