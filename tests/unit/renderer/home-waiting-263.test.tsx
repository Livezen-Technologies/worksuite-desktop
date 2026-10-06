// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import { visibleApps } from '../../../shared/apps';
import { resetOrgPrefsForTests } from '../../../src/core/org-prefs';
import { resetCoverRule } from '../../../src/modules/hr/coverRule';
import HomePage from '../../../src/modules/home/HomePage';
import { facets, waitingItems, type Approval } from '../../../src/modules/home/waiting';

/**
 * Home's Waiting for me (#263): rows say who and what, then when, with small icon actions and the rest on hover; a
 * row opens its own item (the leave review, the announcement); Approve before the cover accepts asks first rather
 * than failing with a red toast; the cover person gets the cover to answer as an item of its own; and "All ›" opens
 * one page of everything, from every app, filtered by kind and organisation with counts.
 */
const NOW = new Date('2026-10-06T08:00:00Z');
const ME = 5;

const APPROVALS: Approval[] = [
  { kind: 'leave', id: 12, who: 'Nimal Perera', what: 'Annual leave', when: 'Oct 9', as: 'hr', link: '/hr?tab=approvals' },
  { kind: 'leave', id: 13, who: 'Sunil Fernando', what: 'Casual leave', when: 'Oct 12', as: 'responsible', link: '/hr?tab=approvals' },
  { kind: 'request', id: 3, who: 'Cy', what: 'Letter request', when: 'Today', as: 'approver', link: '/hr?tab=approvals' },
];
const LEAVE = [{ id: 12, employee_id: 40, employee: 'Nimal Perera', type: 'Annual leave', starts_on: '2026-10-09', ends_on: '2026-10-09', days: 1, reason: 'Personal matter', status: 'pending', note: null, as: 'hr', overdue: false }];
const COVER = [{ id: 13, employee_name: 'Sunil Fernando', employee_no: null, type_name: 'Casual leave', starts_on: '2026-10-12', ends_on: '2026-10-12', days: 1, reason: null, asked_at: null }];
const SHEETS = [
  { id: 5, employee_id: 41, employee: 'Ravi Kumar', starts_on: '2026-09-28', ends_on: '2026-10-04', status: 'submitted', note: null, submitted_at: '2026-10-05 09:00:00', decided_at: null, decided_by: null, decision_note: null, minutes: 2400, can_decide: true },
  { id: 6, employee_id: 42, employee: 'Someone else’s', starts_on: '2026-09-28', ends_on: '2026-10-04', status: 'submitted', note: null, submitted_at: null, decided_at: null, decided_by: null, decision_note: null, minutes: 600, can_decide: false },
];
const EXPENSES = [{ approval_id: 1, org_id: 2, org: 'Asterix', entity_type: 'claim', entity_id: 44, step: 1, label: 'Line manager', waiting_since: null, days_waiting: 2, ref: 'EXP-44', base_amount: '1200.00', base_currency: 'LKR', description: 'Taxi to the client', spent_on: '2026-10-01', claimant: 'Bo Silva', category: 'Travel', policy: [] }];
const NOTICES = [{ id: 11, title: 'New security policy', preview: 'Please read and acknowledge.', priority: 'urgent', pinned: false, requires_ack: true, published_at: '2026-10-01 09:00:00', expires_at: null, read: false, acknowledged: false, company: 'Livezen', author: 'Ann HR', companies: [{ id: 1, name: 'Livezen' }] }];
const review = (id: number, responsible: Record<string, unknown>) => ({
  request: { id, type_name: 'Annual leave', paid: true, starts_on: '2026-10-09', ends_on: '2026-10-09', days: 1, portion: 'full', minutes: null, starts_at: null, reason: null, status: 'pending', requested_on: '2026-10-01', notice_days: 8 },
  employee: { id: 40, name: id === 12 ? 'Nimal Perera' : 'Sunil Fernando' },
  balances: [],
  pending: { count: 1, days: 1 },
  history: { year: 2026, approved_days: 0, approved_count: 0, rejected_count: 0, cancelled_count: 0 },
  overlap: { department_known: true, items: [] },
  attendance: null,
  responsible,
  evidence: [],
});

let approvals: Approval[];
function answer() {
  vi.mocked(apiGetMeta).mockImplementation((async (path: string) => {
    if (path === '/api/tasks') return { data: { tasks: [] }, offline: false };
    if (path === '/api/calendar/events') return { data: { events: [] }, offline: false };
    if (path === '/api/chat/rooms') return { data: { rooms: [] }, offline: false };
    if (path === '/api/dashboard/home') return { data: { user: { name: 'Ada' }, stats: {}, recent_files: [], activity: [] }, offline: false };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/hr/announcements/mine') return { items: NOTICES };
    if (path === '/api/hr/announcements/mine/11') return { ...NOTICES[0], body: '<p>Read this.</p>' };
    if (path === '/api/calendar/conflicts/invitations') return { invitations: [] };
    if (path === '/api/hr/approvals/pending') return { count: approvals.length, items: approvals };
    if (path === '/api/hr/leave/approvals') return { today: '2026-10-06', cards: {}, leave: LEAVE, requests: [] };
    if (path === '/api/hr/leave/cover/mine') return { requests: COVER };
    if (path === '/api/hr/access') return { timesheets: { review: true } };
    if (path === '/api/hr/timesheets') return SHEETS;
    if (path === '/api/expense/approvals') return { items: EXPENSES };
    if (path === '/api/hr/leave/requests/12/review') return review(12, { user_id: 77, name: 'Kamala Silva', status: 'pending', note: null, can_remind: true });
    if (path === '/api/hr/leave/requests/13/review') return review(13, { user_id: ME, name: 'Ada Lovelace', status: 'pending', note: null });
    if (path === '/api/dashboard/summary') return { total: 0, digest: { text: null, reason: null } };
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
const card = () => screen.findByRole('region', { name: 'Waiting for me' });
const errors = () => vi.mocked(toast).mock.calls.filter(([kind]) => kind === 'error');

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
  localStorage.clear();
  resetOrgPrefsForTests();
  resetCoverRule();
  approvals = [...APPROVALS];
  nav.navigate.mockReset();
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  answer();
  app.set({
    auth: { user: { id: String(ME), name: 'Ada Lovelace' } } as never,
    organizationId: null,
    bootstrap: { organizations: [{ id: '1', name: 'Livezen' }, { id: '2', name: 'Asterix' }], user: {}, permissions: ['*'] } as never,
    apps: visibleApps({ apps: '*', permissions: ['*'] }),
    status: { unread: { chat: 0, mail: 0, notifications: 0, tasks: 0 } } as never,
  });
});
afterEach(cleanup);

describe('the Waiting for me card', () => {
  it('says who and what, then when and why, with small icon actions; the rest is in the tooltip', async () => {
    show();
    const box = await card();
    const open = await within(box).findByRole('button', { name: 'Open Nimal Perera · Annual leave' });
    // Its dates, length and reason come from HR's leave queue, asked for once there is leave to show.
    await waitFor(() => expect(open.textContent).toBe('Nimal Perera · Annual leaveOct 9 · 1 day · Personal matter'));
    expect(open.getAttribute('title')).toContain('Waiting for your approval');
    const approve = within(box).getByRole('button', { name: 'Approve Nimal Perera · Annual leave' });
    expect(approve.getAttribute('title')).toBe('Approve');
    expect(approve.className).toContain('w-7');
    expect(within(box).getByRole('button', { name: 'Decline Nimal Perera · Annual leave' }).getAttribute('title')).toBe('Decline');
    // Asked to cover: its own item, with Accept and Decline; the same leave is not listed again as an approval.
    expect(within(box).getByRole('button', { name: 'Accept cover: Accept cover for Sunil Fernando · Oct 12' }).getAttribute('title')).toBe('Accept cover');
    expect(within(box).queryByRole('button', { name: /^Open Sunil Fernando/ })).toBeNull();
    // The tile counts the same things.
    expect(await screen.findByRole('button', { name: 'Waiting for you: 6' })).toBeTruthy();
    expect(screen.getByText('4 approvals · 1 cover request · 1 acknowledgement')).toBeTruthy();
    // Five rows on the card; the rest are a click away.
    expect(within(box).getByRole('button', { name: '1 more waiting for you' })).toBeTruthy();
  });

  it('a row opens its own item: the leave review, the announcement', async () => {
    const { go } = show();
    const box = await card();
    fireEvent.click(await within(box).findByRole('button', { name: 'Open Nimal Perera · Annual leave' }));
    expect(go).toHaveBeenCalledWith('/home?leave=12');
    expect(await screen.findByRole('complementary', { name: 'Review leave' }, { timeout: 8000 })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(go).toHaveBeenLastCalledWith('/home');
    fireEvent.click(within(await card()).getByRole('button', { name: 'Open Accept cover for Sunil Fernando · Oct 12' }));
    expect(go).toHaveBeenLastCalledWith('/home?leave=13');
  });

  it('Approve before the cover accepts asks — Approve anyway · Remind · Open request — instead of a red toast', async () => {
    const { go } = show();
    const box = await card();
    fireEvent.click(await within(box).findByRole('button', { name: 'Approve Nimal Perera · Annual leave' }));
    const ask = await screen.findByRole('dialog', { name: 'Approve before cover?' });
    expect(ask.textContent).toContain('Kamala Silva hasn’t accepted cover yet. Approve anyway?');
    expect(within(ask).getAllByRole('button').map((b) => b.textContent).slice(1)).toEqual(['Cancel', 'Open request', 'Remind Kamala Silva', 'Approve anyway']);
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Open request' }));
    expect(go).toHaveBeenCalledWith('/home?leave=12');
  });

  it('a server that needs the cover first: no red toast, and the row shows a disabled "Waiting for cover"', async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError(422, 'The person responsible for cover has not accepted this yet.', null));
    show();
    const box = await card();
    fireEvent.click(await within(box).findByRole('button', { name: 'Approve Nimal Perera · Annual leave' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Approve before cover?' })).getByRole('button', { name: 'Approve anyway' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/leave/requests/12/decide', { decision: 'approved', approve_without_cover: true }));
    const blocked = await screen.findByRole('dialog', { name: 'Waiting for cover' });
    expect(errors()).toEqual([]);
    fireEvent.click(within(blocked).getAllByRole('button', { name: 'Close' }).at(-1)!);
    const waiting = within(box).getByRole('button', { name: /^Waiting for cover/ });
    expect(waiting.getAttribute('aria-disabled')).toBe('true');
    expect(waiting.getAttribute('title')).toContain('Your organisation needs the cover to accept');
    expect(within(box).queryByRole('button', { name: 'Approve Nimal Perera · Annual leave' })).toBeNull();
  });

  it('the cover person who also approves: the cover to answer, and the approval with "Accept cover & approve"', async () => {
    approvals = [...APPROVALS, { kind: 'leave', id: 13, who: 'Sunil Fernando', what: 'Casual leave', when: 'Oct 12', as: 'hr', link: '' }];
    show();
    const box = await card();
    expect(await within(box).findByRole('button', { name: 'Accept cover: Accept cover for Sunil Fernando · Oct 12' })).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'Approve Sunil Fernando · Casual leave' }));
    const ask = await screen.findByRole('dialog', { name: 'Approve before cover?' });
    expect(ask.textContent).toContain('You haven’t accepted cover for this yet.');
    fireEvent.click(within(ask).getByRole('button', { name: 'Accept cover & approve' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/leave/requests/13/decide', { decision: 'approved' }));
    expect(vi.mocked(apiPost).mock.calls.map(([p]) => p)).toEqual(['/api/hr/leave/requests/13/cover', '/api/hr/leave/requests/13/decide']);
  });

  it('answers a cover and approves a timesheet right there', async () => {
    show('/home?waiting=all');
    fireEvent.click(await screen.findByRole('button', { name: 'Accept cover: Accept cover for Sunil Fernando · Oct 12' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/leave/requests/13/cover', { answer: 'accepted' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Ravi Kumar · Timesheet' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/timesheets/5/approve', { note: '' }));
  });
});

describe('All › — the Waiting for me page', () => {
  it('opens from the card, with every item from every app, filtered by kind and organisation with counts', async () => {
    const { go } = show();
    fireEvent.click(await within(await card()).findByRole('button', { name: 'All waiting for me' }));
    expect(go).toHaveBeenCalledWith('/home?waiting=all');
    expect(await screen.findByRole('heading', { level: 1, name: 'Waiting for me' })).toBeTruthy();
    const kinds = screen.getByRole('group', { name: 'Type' });
    await waitFor(() => expect(within(kinds).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['All (6)', 'Cover to answer (1)', 'Leave (1)', 'Timesheets (1)', 'Expenses (1)', 'HR requests (1)', 'Announcements (1)']));
    // Another reviewer's timesheet is not waiting for me.
    expect(screen.queryByText(/Someone else/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Bo Silva · Expense claim' }).textContent).toContain('EXP-44 · LKR 1,200.00 · Taxi to the client');

    const orgs = screen.getByRole('group', { name: 'Organisation' });
    expect(within(orgs).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['All organisations (6)', 'Asterix (5)', 'Livezen (5)']);
    fireEvent.click(within(orgs).getByRole('button', { name: 'Livezen (5)' }));
    expect(screen.queryByRole('region', { name: 'Expenses' })).toBeNull();
    expect(within(kinds).getByRole('button', { name: 'All (5)' })).toBeTruthy();
    fireEvent.click(within(orgs).getByRole('button', { name: 'All organisations (6)' }));
    fireEvent.click(within(kinds).getByRole('button', { name: 'Expenses (1)' }));
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Expenses']);
    fireEvent.click(screen.getByRole('button', { name: 'Open Bo Silva · Expense claim' }));
    expect(nav.navigate).toHaveBeenCalledWith('/expenses?tab=team&claim=44');

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(go).toHaveBeenLastCalledWith('/home');
  });

  it('an item opened from the page comes back to the page', async () => {
    const { go } = show('/home?waiting=all');
    fireEvent.click(await screen.findByRole('button', { name: 'Open New security policy' }));
    expect(go).toHaveBeenCalledWith('/home?waiting=all&announcement=11');
    fireEvent.click(await screen.findByRole('button', { name: 'Open Nimal Perera · Annual leave' }));
    expect(go).toHaveBeenLastCalledWith('/home?waiting=all&leave=12');
    // HR's generic approvals address is Timesheet approvals: an HR request goes to Waiting on me instead.
    fireEvent.click(screen.getByRole('button', { name: 'Open Cy · Letter request' }));
    expect(nav.navigate).toHaveBeenCalledWith('/hr?tab=waiting');
  });
});

describe('the list itself', () => {
  it('counts each organisation as the list it filters to', () => {
    const items = waitingItems({ approvals: [], leave: [], cover: [], timesheets: [], expenses: [], invitations: [], acknowledgements: NOTICES as never });
    expect(facets(items, '', '').orgs).toEqual([{ id: '1', name: 'Livezen', n: 1 }]);
  });
});
