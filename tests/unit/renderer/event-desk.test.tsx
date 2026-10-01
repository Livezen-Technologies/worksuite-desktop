// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), request: vi.fn() }));
const bridge = vi.hoisted(() => ({ handle: (_c: string, _i: unknown): unknown => undefined }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async (c: string, i: unknown) => bridge.handle(c, i)), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['events'] as string[], go: (_r: string) => undefined as void, win: (_r: string, _t?: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/${tab.path.join('/')}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: (r: string, t?: string) => tab.win(r, t), setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGetMeta, request, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { default: EventsShell, mayOpen } = await import('../../../src/modules/events/EventsShell');
const { screenOf, routeOf } = await import('../../../src/modules/events/routes');
const { fieldShows } = await import('../../../src/modules/events/WalkIn');
const { resolveWebLink } = await import('../../../shared/links');
const { parseDeepLink } = await import('../../../shared/deeplink');
const { categoryVisible } = await import('../../../shared/access');
await Promise.all(['DeskScreen', 'Setup', 'Overview', 'Registrations', 'SearchPanel', 'Counters', 'Review'].map((m) => import(`../../../src/modules/events/${m}.tsx`)));

const EVENT = { id: 7, org_id: 5, code: 'TS26', name: 'Tech Summit', summary: null, type_label: 'Conference', delivery_mode: 'PHYSICAL', status: 'LIVE', status_label: 'Live', registration_state_label: null, display_label: 'Live', timezone: 'Asia/Colombo', start: { utc: '2026-10-20T03:30:00Z', local: '2026-10-20 09:00', date: '2026-10-20', time: '09:00', zone: 'Asia/Colombo' }, end: null, capacity: 500, version: 3 };
const AGENT = ['events.access', 'events.event.view', 'events.checkin.use', 'events.checkout.use', 'events.walkin.create', 'events.badge.print'];
const REG = { event_id: 7, event_name: 'Tech Summit', org_id: 5, device_id: 31, device_name: 'Desk 1', gate_id: 3, gate_name: 'Main entrance', registered_at: '2026-10-20T03:00:00Z' };
const status = (over: Record<string, unknown> = {}) => ({ event_id: 7, registration: REG, device: null, reachable: true, last_contact: null, last_sync: null, copy: null, waiting: 0, rejected: 0, flagged: 0, others: 0, offline_blocked: null, problem: null, wiped: null, ...over });
const VALID = {
  result: 'VALID', action: 'CHECK_IN', colour: 'green', label: 'Valid', reason: 'Welcome.', warning: null, done: false, via: 'qr',
  attendee: { name: 'Dilani Perera', company: 'Lanka Tea', job_title: null, photo_file_id: null }, ticket: { id: 1, name: 'General', role: 'ATTENDEE', access_days: null },
  registration: { id: 101, number: 'EVT-REG-000101', status: 'CONFIRMED', status_label: 'Confirmed', payment_status: null }, presence: { state: 'NOT_ARRIVED', state_label: 'Not arrived', day: null, entries: 0, last_in: null },
  options: ['check_in', 'print_badge'], checkin_event_id: null,
};

type Route = (path: string, query?: Record<string, unknown>) => unknown;
let routes: Route = () => undefined;
let desk: Record<string, (i: unknown) => unknown> = {};

function serve(perms: string[], extra: Route = () => undefined) {
  routes = (path, query) => {
    if (path === '/api/events/v1/events/7') return EVENT;
    if (path === '/api/events/v1/options') return { permissions: perms };
    if (path === '/api/events/v1/events/7/checkin/summary') return { inside: 12, checked_in: 40, expected: 300, today: { checked_in: 41, checked_out: 3, denied: 2, walk_ins: 1, day: '2026-10-20' }, by_gate: {}, devices: { total: 2, online: 2, queued: 0 }, reconciliation_open: 0 };
    return extra(path, query);
  };
}

const show = (path: string[]) => {
  tab.path = path;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EventsShell tabId="t1" route={`/${path.join('/')}`} active />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(call).mockClear();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    const data = routes(path, query);
    if (data === undefined) return new Promise(() => undefined);
    if (data instanceof Error) throw data;
    return { data, offline: false, cachedAt: null };
  });
  desk = {
    'eventdesk:list': () => [REG],
    'eventdesk:status': () => status(),
    'eventdesk:printSettings': () => ({ badge_printer: 'Zebra', silent: true, page: 'template', printer_name: null, take_phone_jobs: false }),
  };
  bridge.handle = (c, i) => desk[c]?.(i);
  tab.query = new URLSearchParams();
  tab.go = vi.fn();
  tab.win = vi.fn();
  app.set({ status: null });
});
afterEach(cleanup);

describe('Events: where things are', () => {
  it('reads the desk’s own addresses and the server’s notification links', () => {
    const q = new URLSearchParams();
    expect(screenOf(['events'], q)).toEqual({ kind: 'events' });
    expect(screenOf(['events', '7'], q)).toEqual({ kind: 'event', id: 7, view: null, list: null });
    expect(screenOf(['events', '7', 'desk'], q)).toMatchObject({ view: 'desk' });
    expect(screenOf(['events', '7', 'checkin', 'reconciliation'], q)).toMatchObject({ view: 'review' });
    expect(screenOf(['events', '7', 'devices'], q)).toMatchObject({ view: 'setup' });
    expect(screenOf(['events', '7', 'schedule'], q)).toMatchObject({ view: 'program' });
    expect(screenOf(['events', '7', 'waitlist'], q)).toMatchObject({ view: 'registrations', list: 'waitlist' });
    expect(screenOf(['events', '7', 'speakers', '4'], q)).toMatchObject({ view: 'overview' });
    expect(screenOf(['events', '7', 'registrations', '101'], q)).toEqual({ kind: 'registration', event: 7, id: 101 });
    expect(screenOf(['events', 'attendees', '9'], q)).toEqual({ kind: 'attendee', id: 9, event: null });
    expect(routeOf({ kind: 'event', id: 7, view: 'counters' })).toBe('/events/7/counters');
    expect(routeOf({ kind: 'event', id: 7, view: 'registrations', list: 'walkins' })).toBe('/events/7/registrations?list=walkins');
    expect(routeOf({ kind: 'event', id: 7, view: 'overview' })).toBe('/events/7');
  });

  it('opens the server’s links in the Events tab, and its notices only for people who have the app', () => {
    expect(resolveWebLink('/events/7/checkin/reconciliation')).toEqual({ kind: 'tab', route: '/events/7/checkin/reconciliation', app: 'events' });
    expect(resolveWebLink('/events/7/registrations/101')).toMatchObject({ kind: 'tab', app: 'events' });
    expect(categoryVisible('events', new Set(['events']))).toBe(true);
    expect(categoryVisible('events', new Set(['crm']))).toBe(false);
    const link = parseDeepLink('worksuite://events/7/desk');
    expect(link.ok && link.link.route).toBe('/events/7/desk');
  });

  it('shows each person what they may do', () => {
    expect(mayOpen('desk', AGENT)).toBe(true);
    expect(mayOpen('registrations', AGENT)).toBe(false);
    expect(mayOpen('badges', AGENT)).toBe(true);
    expect(mayOpen('overview', ['events.access'])).toBe(false);
    expect(mayOpen('setup', [])).toBe(true);
  });

  it('asks the form’s own conditions which fields a walk-in is asked', () => {
    const f = { key: 'diet', type: 'TEXT', label: 'Diet', ticket_type_ids: [2], condition: { field: 'lunch', op: 'checked' } };
    expect(fieldShows(f, 1, { lunch: true })).toBe(false);
    expect(fieldShows(f, 2, { lunch: false })).toBe(false);
    expect(fieldShows(f, 2, { lunch: true })).toBe(true);
    expect(fieldShows({ key: 'x', type: 'TEXT', label: 'X', condition: { field: 'kind', op: 'in', value: ['a', 'b'] } }, null, { kind: 'b' })).toBe(true);
  });
});

describe('Events: the check-in desk', () => {
  it('gives a check-in agent the desk, not the registrations', async () => {
    serve(AGENT);
    show(['events', '7']);
    const rail = await screen.findByRole('navigation', { name: 'Events' });
    for (const t of ['Check-in desk', 'Live counters', 'To review', 'Badges', 'Event 360', 'This computer']) expect(rail.textContent).toContain(t);
    expect(rail.textContent).not.toContain('Registrations');
    fireEvent.click(within(rail).getByRole('button', { name: /Counters in a window/ }));
    expect(tab.win).toHaveBeenCalledWith('/events/7/counters', 'Tech Summit · Live counters');
  });

  it('asks this computer to be registered at a gate before it scans', async () => {
    serve(AGENT);
    desk['eventdesk:status'] = () => status({ registration: null });
    desk['eventdesk:list'] = () => [];
    show(['events', '7', 'desk']);
    fireEvent.click(await screen.findByRole('button', { name: 'Register this computer' }));
    expect(tab.go).toHaveBeenCalledWith('/events/7/setup');
  });

  it('scans what the scanner types, shows the server’s answer, and checks in on Enter', async () => {
    serve(AGENT);
    desk['eventdesk:scan'] = (i) => {
      const x = i as { mode: string };
      return x.mode === 'scan'
        ? { source: 'server', view: VALID, message: 'Valid: Welcome.', badge: null }
        : { source: 'server', view: { ...VALID, done: true, options: ['check_out', 'print_badge'], presence: { state: 'INSIDE', state_label: 'Inside', day: null, entries: 1, last_in: null } }, message: 'Checked in: Dilani Perera.', badge: null };
    };
    show(['events', '7', 'desk']);
    const field = await screen.findByRole('textbox', { name: /Scan a ticket or type a registration number to check in/ });
    fireEvent.change(field, { target: { value: 'EV1-ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' } });
    fireEvent.submit(field.closest('form')!);
    expect(await screen.findByText('Dilani Perera')).toBeTruthy();
    expect(screen.getByText('Welcome.')).toBeTruthy();
    expect(vi.mocked(call)).toHaveBeenCalledWith('eventdesk:scan', { event_id: 7, code: 'EV1-ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', mode: 'scan' });

    // An empty Enter presses the result's button.
    fireEvent.submit(field.closest('form')!);
    expect(await screen.findByText('Checked in')).toBeTruthy();
    expect(vi.mocked(call)).toHaveBeenCalledWith('eventdesk:scan', { event_id: 7, code: 'EV1-ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', mode: 'check_in' });
    // The live counters are the server's.
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('says when the answer came from this computer’s offline copy, and shows a refusal in the server’s words', async () => {
    serve(AGENT);
    desk['eventdesk:scan'] = (i) =>
      (i as { code: string }).code === 'BAD'
        ? { source: 'refused', status: 409, code: 'not_inside', message: 'This ticket is not checked in.', wipe: false }
        : { source: 'local', view: { ...VALID, done: true }, message: 'Checked in on this computer: Dilani Perera.', queued: true, badge: null };
    show(['events', '7', 'desk']);
    const field = await screen.findByRole('textbox', { name: /check in/ });
    fireEvent.change(field, { target: { value: 'EVT-REG-000101' } });
    fireEvent.submit(field.closest('form')!);
    expect(await screen.findByText(/Answered by this computer from its offline copy/)).toBeTruthy();
    fireEvent.change(field, { target: { value: 'BAD' } });
    fireEvent.submit(field.closest('form')!);
    expect(await screen.findByText('This ticket is not checked in.')).toBeTruthy();
  });

  it('searches from the copy when WorkSuite does not answer (F2), and scans the one picked', async () => {
    serve(AGENT, (p) => (p === '/api/events/v1/events/7/checkin/search' ? new ApiError(503, 'Cannot reach WorkSuite server.', 'NETWORK_UNREACHABLE') : undefined));
    desk['eventdesk:search'] = () => [{ registration_id: 101, number: 'EVT-REG-000101', name: 'Dilani Perera', company: 'Lanka Tea', ticket: { id: 1, name: 'General' }, status: 'CONFIRMED', status_label: 'Confirmed', payment_due: false, presence: { state: 'NOT_ARRIVED', last_in: null } }];
    desk['eventdesk:scan'] = () => ({ source: 'server', view: VALID, message: null, badge: null });
    show(['events', '7', 'desk']);
    await screen.findByRole('textbox', { name: /check in/ });
    fireEvent.keyDown(window, { key: 'F2' });
    const box = await screen.findByRole('textbox', { name: 'Search attendees' });
    fireEvent.change(box, { target: { value: 'dilani' } });
    expect(await screen.findByText(/offline copy of the gate’s tickets/)).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('eventdesk:scan', { event_id: 7, registration_id: 101, mode: 'scan' }));
  });

  it('prints a badge on the desk’s printer, and asks why before a reprint', async () => {
    serve(AGENT);
    desk['eventdesk:scan'] = () => ({ source: 'server', view: VALID, message: null, badge: null });
    desk['eventdesk:printJobs'] = () => ({ ok: true, printed: [55], failed: [], message: 'Badge sent to Zebra.' });
    let tries = 0;
    vi.mocked(request).mockImplementation(async (_m: string, path: string, o?: { body?: unknown }) => {
      if (path === '/api/events/v1/registrations/101/badge/print') {
        tries++;
        const body = o?.body as { confirm?: boolean; reason?: string };
        if (!body.confirm) throw new ApiError(422, 'Confirm the reprint: the first badge stays valid until it is taken back.', null, { field: 'confirm', code: 'confirm' });
        return { data: { job: { id: 55 } }, offline: false, cachedAt: null, message: 'Reprint queued for printing.' };
      }
      throw new Error(`unexpected ${path}`);
    });
    show(['events', '7', 'desk']);
    const field = await screen.findByRole('textbox', { name: /check in/ });
    fireEvent.change(field, { target: { value: 'EVT-REG-000101' } });
    fireEvent.submit(field.closest('form')!);
    await screen.findByText('Dilani Perera');
    fireEvent.keyDown(window, { key: 'F4' });
    const why = await screen.findByRole('textbox', { name: /Why is it printed again/ });
    fireEvent.change(why, { target: { value: 'Lost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reprint' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('eventdesk:printJobs', { event_id: 7, job_ids: [55] }));
    expect(tries).toBe(2);
    expect(vi.mocked(request).mock.calls[1]![2]).toMatchObject({ body: { device_id: 31, confirm: true, reason: 'Lost' } });
  });
});
