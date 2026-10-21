// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTabTitle: () => undefined, useTab: () => ({}) }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiGetMeta: vi.fn(), apiPost: vi.fn(async () => ({ booked: [], refused: [] })) }));

import { apiGetMeta, apiPost } from '../../../src/core/api';
import { asPage, can, dropTime, LISTS, minutesOf, overduePm, pages, shiftDay, type Visit } from '../../../src/modules/amc/api';
import Dashboard from '../../../src/modules/amc/Dashboard';
import Dispatch from '../../../src/modules/amc/Dispatch';
import RequestWindow from '../../../src/modules/amc/RequestWindow';
import ListView from '../../../src/modules/amc/ListView';
import { amcNoticeActions, amcNoticeLink, amcRequestOf } from '../../../shared/amc';
import { parseDeepLink } from '../../../shared/deeplink';
import { APP_CATALOGUE } from '../../../shared/apps';

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
let offline = false;
function serve(map: Record<string, unknown>) {
  vi.mocked(apiGetMeta).mockImplementation(async (path: string) => {
    for (const [k, v] of Object.entries(map)) if (path.endsWith(k)) return { data: v, offline, cachedAt: offline ? '2026-10-20T08:00:00Z' : null } as never;
    throw new Error(`unexpected GET ${path}`);
  });
}
const OPTIONS = { companies: [{ id: 1, name: 'Acme', can: { assign: true, schedule: true } }] };

beforeEach(() => { offline = false; vi.mocked(apiPost).mockClear(); });
afterEach(() => cleanup());

describe('AMC links, notices and helpers', () => {
  it('gives a new request Open and Give to, and links it to the request', () => {
    expect(amcNoticeActions('amc.request.logged', null, { request_id: 12 })).toEqual({ buttons: [{ label: 'Open', link: '/amc?view=requests&request=12' }, { label: 'Give to', link: '/amc?view=dispatch&give=12' }] });
    expect(amcNoticeActions('amc.request.logged', '/amc?view=requests&request=7')?.buttons[1]?.link).toBe('/amc?view=dispatch&give=7');
    expect(amcNoticeActions('amc.customer.decided', null, { request_id: 1 })).toBeNull();
    expect(amcNoticeActions('amc.request.logged', null, {})).toBeNull();
    expect(amcNoticeLink('amc.request.logged', { request_id: '5' })).toBe('/amc?view=requests&request=5');
    expect(amcNoticeLink('mail.received', { request_id: 5 })).toBeNull();
    expect(amcRequestOf({}, '/elsewhere?request=3')).toBeNull();
  });
  it('is a native app with worksuite://amc deep links', () => {
    expect(APP_CATALOGUE.find((a) => a.id === 'amc')?.surface).toBe('native');
    expect(parseDeepLink('worksuite://amc/requests/9')).toMatchObject({ ok: true, link: { module: 'amc', route: '/amc?view=requests&request=9' } });
    expect(parseDeepLink('worksuite://amc/dispatch')).toMatchObject({ ok: true, link: { module: 'amc', route: '/amc?view=dispatch' } });
  });
  it('works out times, pages and overdue PMs for display only', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('2026-10-21T14:15:00')).toBe(855);
    expect(dropTime(64 * 2 + 10, 7, 64)).toBe('09:00');
    expect(dropTime(64 * 2 + 40, 7, 64)).toBe('09:30');
    expect(dropTime(-50, 7, 64)).toBe('07:00');
    expect(dropTime(Number.NaN, 7, 64)).toBe('07:00');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(pages(asPage({ items: [], total: 101, page: 1, per_page: 50 }))).toBe(3);
    expect(asPage([{ id: 1 }]).total).toBe(1);
    const v = (id: number, kind: string, standing: string) => ({ id, kind, standing }) as Visit;
    expect(overduePm([v(1, 'preventive', 'overdue'), v(2, 'breakdown', 'overdue'), v(3, 'preventive', 'scheduled')]).map((x) => x.id)).toEqual([1]);
    expect(can(OPTIONS, 'assign')).toBe(true);
    expect(can(OPTIONS, 'assign', 2)).toBe(false);
  });
});

describe('D-01 dashboard', () => {
  it('shows the server tiles and lists', async () => {
    serve({ '/dashboard': { requests: { open: 4, unassigned: 2, approval: 0, at_risk: 1, breached: 1 }, visits: { today: 3, overdue: 2, scheduled: 5, planned: 0, completed: 0 }, attention: [{ id: 8, number: 'SR-8', subject: 'Chiller down', client: 'Acme' }] } });
    const onRequest = vi.fn();
    wrap(<Dashboard onView={() => undefined} onRequest={onRequest} />);
    expect(await screen.findByText('2 unassigned · 0 need approval')).toBeTruthy();
    fireEvent.click(screen.getByText('SR-8 · Chiller down'));
    expect(onRequest).toHaveBeenCalledWith(8);
  });
});

describe('D-02 dispatch', () => {
  const data = {
    '/dispatch/timeline': { date: '2026-10-21', items: [{ id: 3, org_id: 1, name: 'Nimal', timeline: [{ visit_id: 50, from: '09:00', to: '10:00', label: 'PM', client: 'Acme' }] }] },
    '/dispatch': { date: '2026-10-21', unassigned: [{ id: 60, org_id: 1, kind: 'breakdown', status: 'planned', client: 'Beta', label: 'Leak', due_on: '2026-10-21' }], waiting: [{ id: 12, number: 'SR-12', subject: 'Noise', client: 'Gamma' }], technicians: [] },
    '/visits': { items: [{ id: 70, org_id: 1, kind: 'preventive', standing: 'overdue', status: 'planned', client: 'Delta', due_on: '2026-09-01' }] },
    '/dispatch/suggest/60': { items: [{ id: 3, name: 'Nimal', eligible: true, free: true, suggested: true, why: ['Has the skill'] }] },
  };
  it('suggests a technician and gives the job to them', async () => {
    serve(data);
    wrap(<Dispatch options={OPTIONS} offline={false} give={12} onRequest={() => undefined} />);
    fireEvent.click(await screen.findByText(/Leak/));
    expect(await screen.findByText('Has the skill')).toBeTruthy();
    fireEvent.click(screen.getByText('Give to'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/amc/visits/60/schedule', expect.objectContaining({ technician_id: 3, time: '08:30' })));
  });
  it('gives out ticked overdue PMs in one go', async () => {
    serve(data);
    wrap(<Dispatch options={OPTIONS} offline={false} give={null} onRequest={() => undefined} />);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByText(/Give out 1 overdue/));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/amc/dispatch/give-out', expect.objectContaining({ visit_ids: [70], start: '08:30' })));
  });
  it('gives a waiting request by dropping it on a row', async () => {
    serve(data);
    wrap(<Dispatch options={OPTIONS} offline={false} give={null} onRequest={() => undefined} />);
    fireEvent.dragStart(await screen.findByText(/SR-12/));
    const row = screen.getByTestId('row-3').lastElementChild!;
    fireEvent.dragOver(row);
    fireEvent.drop(row, { clientX: 64 * 3 });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/amc/requests/12/schedule', expect.objectContaining({ technician_id: 3, date: expect.any(String), time: expect.stringMatching(/^\d\d:[03]0$/) })));
  });
  it('gives nothing out offline', async () => {
    offline = true;
    serve(data);
    wrap(<Dispatch options={OPTIONS} offline give={null} onRequest={() => undefined} />);
    expect(((await screen.findByRole('checkbox')) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Offline results/)).toBeTruthy();
  });
});

describe('D-03 request window', () => {
  const detail = { request: { id: 12, org_id: 1, number: 'SR-12', subject: 'Noise', status: 'new', open: true, responded_at: null, client: 'Gamma' }, messages: [{ id: 1, event_label: 'Request received', status: 'sent' }], can: { assign: true } };
  it('acknowledges, pops out and shows tabs', async () => {
    serve({ '/requests/12': detail });
    const onPopOut = vi.fn();
    wrap(<RequestWindow id={12} options={OPTIONS} offline={false} onPopOut={onPopOut} onGive={() => undefined} />);
    fireEvent.click(await screen.findByText('Acknowledge'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/amc/requests/12/contact', { via: 'desk' }));
    fireEvent.click(screen.getByText('Pop out'));
    expect(onPopOut).toHaveBeenCalledWith(12);
    fireEvent.click(screen.getByRole('tab', { name: 'Messages' }));
    expect(screen.getByText('Request received')).toBeTruthy();
  });
  it('is read-only offline', async () => {
    offline = true;
    serve({ '/requests/12': detail });
    wrap(<RequestWindow id={12} options={OPTIONS} offline onGive={() => undefined} />);
    expect(((await screen.findByText('Acknowledge')).closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(((screen.getByText('Give to…')).closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('lists', () => {
  it('pages the server list and opens a record', async () => {
    serve({ '/contracts': { items: [{ id: 4, number: 'AMC-4', title: 'Chillers', client: 'Acme' }], total: 120, page: 1, per_page: 50 }, '/contracts/4': { contract: { id: 4, number: 'AMC-4', title: 'Chillers' }, documents: [] } });
    const onSelect = vi.fn();
    const { rerender } = wrap(<ListView def={LISTS.contracts!} selected={null} onSelect={onSelect} onWeb={() => undefined} />);
    expect(await screen.findByText('120 in all · page 1 of 3')).toBeTruthy();
    expect(vi.mocked(apiGetMeta).mock.calls[0]?.[1]).toMatchObject({ page: 1, per_page: 50, sort: 'number', dir: 'desc' });
    fireEvent.click(screen.getByText('Chillers'));
    expect(onSelect).toHaveBeenCalledWith(4);
    rerender(<QueryClientProvider client={new QueryClient()}><ListView def={LISTS.contracts!} selected={4} onSelect={onSelect} onWeb={() => undefined} /></QueryClientProvider>);
    expect(await screen.findByText('documents: 0')).toBeTruthy();
  });
});
