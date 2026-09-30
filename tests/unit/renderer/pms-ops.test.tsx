// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({ name: 'saved.csv' })), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['pms'] as string[], go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: '/pms', active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

// Lazy screens, a preview after a choice: under a full parallel run a second is not always enough.
configure({ asyncUtilTimeout: 5000 });

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiGetMeta, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { default: PmsShell } = await import('../../../src/modules/pms/PmsShell');
const { barSpan, daysBetween } = await import('../../../src/modules/pms/Calendar');
const { routeOf, screenOf } = await import('../../../src/modules/pms/routes');
// The shell's screens are lazy chunks: loaded once here, so a first render does not race their transform.
await Promise.all(['Reservation', 'Housekeeping', 'HkTask', 'Maintenance', 'Issue', 'LostFound', 'Requests', 'Guest', 'Invoices', 'Reports', 'Report', 'Calendar', 'Room'].map((m) => import(`../../../src/modules/pms/${m}.tsx`)));

const PROPERTY = { id: 1, org_id: 3, code: 'LAG', name: 'Lagoon Hotel', status: 'active', status_label: 'Active', currency: 'LKR', timezone: 'Asia/Colombo', check_in_time: '14:00', check_out_time: '12:00', business_date: '2026-09-18' };
const BD = { business_date: '2026-09-18', status: 'open', status_label: 'Open', calendar_date: '2026-09-18', days_behind: 0, night_audit_time: '01:00', timezone: 'Asia/Colombo', last_closed: '2026-09-17' };
const options = (permissions: string[]) => ({
  org_id: 3, permissions, scope: 'all', properties: [PROPERTY], business_date: BD, reservation_statuses: [], room_display: [], housekeeping_statuses: [], service_statuses: [], outage_kinds: [], night_audit_steps: [],
  booking_types: [], guarantees: [], vip_levels: [], document_kinds: [{ value: 'other', label: 'Other' }], sources: [],
});

type Route = (path: string, query?: Record<string, unknown>) => unknown;
let extra: Route = () => undefined;
let perms: string[] = [];
let offline = false;

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PmsShell tabId="t1" route="/pms" active />
    </QueryClientProvider>,
  );
const posted = () => vi.mocked(request).mock.calls.map(([method, path, o]) => ({ method, path, body: (o as { body?: Record<string, unknown> })?.body, headers: (o as { headers?: Record<string, string> })?.headers }));
const ok = (data: unknown, message = 'Done.') => ({ data, offline: false, cachedAt: null, message });
/** The open dialog titled so (the desktop's Modal names itself with its heading). */
const dialogWith = (title: string | RegExp) =>
  waitFor(() => {
    const d = screen.getAllByRole('dialog').find((x) => {
      const h = x.querySelector('h2')?.textContent ?? '';
      return typeof title === 'string' ? h === title : title.test(h);
    });
    if (!d) throw new Error(`No dialog titled ${String(title)}`);
    return d;
  });
const at = (route: string) => {
  const [p, q] = route.split('?');
  return screenOf((p ?? '').split('/').filter(Boolean), new URLSearchParams(q ?? ''));
};

beforeEach(() => {
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(call).mockClear();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    const data = path === '/api/pms/v1/properties' ? { items: [PROPERTY] } : path === '/api/pms/v1/options' ? options(perms) : extra(path, query);
    if (data === undefined) return new Promise(() => undefined);
    return { data, offline, cachedAt: offline ? '2026-09-18T07:00:00Z' : null };
  });
  vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/chat/directory' ? { users: [{ id: 7, name: 'Ruwan Silva' }, { id: 8, name: 'Amali Fernando' }] } : undefined));
  tab.query = new URLSearchParams();
  tab.path = ['pms'];
  tab.go = vi.fn();
  offline = false;
  app.set({ status: null, bootstrap: null, apps: [] });
});
afterEach(cleanup);

describe('the new addresses', () => {
  it('reads and writes the operations, the tape chart and the reports as the web names them', () => {
    expect(at('/pms/housekeeping/tasks/12')).toEqual({ kind: 'task', id: 12 });
    expect(at('/pms/maintenance/4')).toEqual({ kind: 'issue', id: 4 });
    expect(at('/pms/lost-found/9')).toEqual({ kind: 'lost', id: 9 });
    expect(at('/pms/reports/occupancy')).toEqual({ kind: 'report', key: 'occupancy' });
    expect(at('/pms/reports/../x')).toMatchObject({ kind: 'view' });
    for (const [path, view] of [['/pms/maintenance', 'maintenance'], ['/pms/lost-found', 'lostfound'], ['/pms/invoices', 'invoices'], ['/pms/reports', 'reports'], ['/pms/calendar', 'calendar']] as const) expect(at(path)).toMatchObject({ kind: 'view', view });
    for (const s of [{ kind: 'task', id: 12 }, { kind: 'issue', id: 4 }, { kind: 'lost', id: 9 }, { kind: 'report', key: 'occupancy' }] as const) expect(at(routeOf(s))).toEqual(s);
  });

  it('places a booking on the tape by its nights, cut to the days shown', () => {
    expect(daysBetween('2026-09-18', '2026-09-21')).toBe(3);
    expect(barSpan({ start: '2026-09-19', end: '2026-09-22' }, '2026-09-18', 7)).toEqual({ col: 1, span: 3 });
    expect(barSpan({ start: '2026-09-15', end: '2026-09-20' }, '2026-09-18', 7)).toEqual({ col: 0, span: 2 });
    expect(barSpan({ start: '2026-09-24', end: '2026-09-28' }, '2026-09-18', 7)).toEqual({ col: 6, span: 1 });
    expect(barSpan({ start: '2026-09-10', end: '2026-09-12' }, '2026-09-18', 7)).toBeNull();
  });
});

const RESERVATION = {
  id: 40, property_id: 1, confirmation_no: 'LAG26-00040', status: 'confirmed', status_label: 'Confirmed', badge: ['#2563eb', 'check'], booking_type: 'phone', guest_id: 70, guest_name: 'Nimal Perera', vip_level: 'none',
  arrival_date: '2026-09-18', departure_date: '2026-09-20', nights: 2, adults: 2, children: 0, rooms: 1, total_amount: '50000.00', currency: 'LKR', channel_ref: null, option_date: null, version: 4,
  guest: { id: 70, name: 'Nimal Perera', vip_level: 'none', preferences: [] }, source: null, company_client_id: null, promo_code: null, special_requests: null, internal_notes: null, eta: null, guarantee_type: 'none', guarantee_ref: null,
  deposit_required: '10000.00', cancel_reason: null, cancel_fee: '0.00', cancelled_at: null, business_date: '2026-09-18', created_at: '2026-09-01 10:00:00', rooms_detail: [], addons: [], status_history: [], options: [], cancellation: null,
};
const DEPOSIT = { id: 3, reservation_id: 40, status: 'paid', status_label: 'Paid', required: '10000.00', due_date: null, paid: '10000.00', refunded: '0.00', applied: '0.00', forfeited: '0.00', available: '10000.00', remaining: '0.00', refundable: '10000.00', non_refundable: '0.00', currency: 'LKR', overdue: false, version: 1 };
const FOLIO = { id: 5, folio_no: 'FLAG-000005', property_id: 1, reservation_id: 40, stay_id: 90, label: 'Guest', payee_type: 'guest', payee_client_id: 70, payee_name: 'Nimal Perera', status: 'open', status_label: 'Open', balance: '26062.00', currency: 'LKR', opened_business_date: '2026-09-16', settled_at: null, closed_at: null, invoice_id: null, receipt_no: null, ar_reference: null, version: 3 };

describe('a deposit applied to a folio (PMS-DEP-002)', () => {
  beforeEach(() => {
    tab.path = ['pms', 'reservations', '40'];
    extra = (p) =>
      p === '/api/pms/v1/reservations/40'
        ? { reservation: RESERVATION }
        : p === '/api/pms/v1/reservations/40/deposit'
          ? { deposit: DEPOSIT, payments: [] }
          : p === '/api/pms/v1/properties/1/folios'
            ? { items: [FOLIO, { ...FOLIO, id: 6, folio_no: 'FLAG-000006', reservation_id: 41 }] }
            : undefined;
  });

  it('applies what the deposit holds to one of the reservation’s own open folios', async () => {
    perms = ['pms.access', 'pms.reservation.view', 'pms.payment.view', 'pms.payment.process', 'pms.folio.view'];
    vi.mocked(request).mockResolvedValue(ok({ applied: 1000000 }, 'Deposit 10,000.00 applied to FLAG-000005.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to folio' }));
    const dialog = await dialogWith('Apply the deposit');
    expect(dialog.textContent).toContain('LKR 10,000.00 of the deposit is available');
    // Only this reservation's folios are offered.
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Folio' }));
    expect(screen.queryByRole('option', { name: /FLAG-000006/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /FLAG-000005/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/pms/v1/reservations/40/deposit/apply', body: { folio_id: 5 } })));
  });

  it('is not offered to someone who may not process payments, nor when nothing is left to apply', async () => {
    perms = ['pms.access', 'pms.reservation.view', 'pms.payment.view', 'pms.folio.view'];
    const first = show();
    expect(await screen.findByText('Available to apply')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply to folio' })).toBeNull();
    first.unmount();

    perms = ['pms.access', 'pms.reservation.view', 'pms.payment.view', 'pms.payment.process', 'pms.folio.view'];
    const spent = extra;
    extra = (p) => (p === '/api/pms/v1/reservations/40/deposit' ? { deposit: { ...DEPOSIT, available: '0.00', applied: '10000.00' }, payments: [] } : spent(p));
    show();
    expect(await screen.findByText('Available to apply')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply to folio' })).toBeNull();
  });
});

const TASK = {
  id: 12, property_id: 1, room_id: 11, room_number: '102', room_type: 'Deluxe King', floor: '1', business_date: '2026-09-18', task_type: 'checkout', task_type_label: 'Checkout clean', priority: 'normal', priority_label: 'Normal',
  status: 'in_progress', status_label: 'In progress', assigned_to: 7, assigned_name: 'Ruwan Silva', credits: 1, checklist: [{ key: 'bed', label: 'Make the bed', required: true, done: false }], checklist_open: 1, notes: null,
  started_at: '2026-09-18 08:00:00', completed_at: null, minutes: null, inspected_by: null, inspected_at: null, inspection_result: null, version: 5,
  options: [{ action: 'pause', label: 'Pause', needs: [] }, { action: 'complete', label: 'Complete', needs: [] }, { action: 'cancel', label: 'Cancel', needs: ['reason'] }], primary: 'complete',
  room: { hk_status: 'dirty', hk_status_label: 'Dirty', badge: { status: 'occupied', label: 'Occupied', colour: '#7c3aed', icon: 'user' }, version: 2 },
};

describe('housekeeping writes (§11.1–11.2)', () => {
  it('moves a task the way the server offers, asks for a reason where one is needed, and gives it to someone', async () => {
    perms = ['pms.access', 'pms.housekeeping.view', 'pms.housekeeping.manage'];
    tab.path = ['pms', 'housekeeping', 'tasks', '12'];
    extra = (p) =>
      p === '/api/pms/v1/housekeeping-tasks/12'
        ? { task: TASK, history: [{ text: 'Started', by: 'Ruwan Silva', at: '2026-09-18 08:00:00' }], restocks: [] }
        : p === '/api/pms/v1/properties/1/housekeeping/staff'
          ? { items: [{ user_id: 8, name: 'Amali Fernando', department: 'housekeeping', tasks: 3, done: 1, credits: 3, credits_done: 1 }] }
          : undefined;
    vi.mocked(request).mockResolvedValue(ok({}, 'Done.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/housekeeping-tasks/12/complete', body: { version: 5 } })));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const ask = await dialogWith('Cancel');
    fireEvent.change(within(ask).getByLabelText('Reason'), { target: { value: 'Guest asked for no service' } });
    fireEvent.click(within(ask).getAllByRole('button', { name: 'Cancel' }).at(-1)!);
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/housekeeping-tasks/12/cancel', body: { version: 5, reason: 'Guest asked for no service' } })));

    fireEvent.click(screen.getByRole('combobox', { name: 'Attendant' }));
    fireEvent.click(screen.getByRole('option', { name: /Amali Fernando/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/housekeeping-tasks/12/assign', body: { assigned_to: 8, version: 5 } })));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Make the bed' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/housekeeping-tasks/12/checklist', body: { checklist: { bed: true } } })));
  });

  it('says a restock needs Inventory to someone without it, and never sends one', async () => {
    perms = ['pms.access', 'pms.housekeeping.view'];
    tab.path = ['pms', 'housekeeping', 'tasks', '12'];
    extra = (p) => (p === '/api/pms/v1/housekeeping-tasks/12' ? { task: { ...TASK, options: [] }, history: [], restocks: [{ id: 1, product: 'Water 500 ml', quantity: 2, kind: 'minibar', kind_label: 'Mini bar', chargeable: true }] } : undefined);
    show();
    expect(await screen.findByText(/Water 500 ml × 2/)).toBeTruthy();
    // An attendant does not give rooms out.
    expect(screen.queryByRole('combobox', { name: 'Attendant' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Record restock' }));
    const dialog = await dialogWith('What went into room 102');
    expect(dialog.textContent).toContain('needs Inventory');
    expect((within(dialog).getByRole('button', { name: 'Record' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a photo to the attendant’s own task, and offers none on someone else’s', async () => {
    perms = ['pms.access', 'pms.housekeeping.view'];
    tab.path = ['pms', 'housekeeping', 'tasks', '12'];
    app.set({ bootstrap: { user: { id: '7', name: 'Ruwan Silva' }, permissions: ['*'] } as never });
    extra = (p) => (p === '/api/pms/v1/housekeeping-tasks/12' ? { task: { ...TASK, photos: [{ id: 31, url: '/api/pms/v1/housekeeping-tasks/12/photos/31' }] }, history: [], restocks: [] } : undefined);
    vi.mocked(request).mockResolvedValue(ok({ file_id: 32 }, 'Photo added.'));
    const first = show();
    const img = await screen.findByRole('img', { name: 'Room 102, photo' });
    expect(img.getAttribute('src')).toContain('/api/pms/v1/housekeeping-tasks/12/photos/31');
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'bath.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Add a photo…'), { target: { files: [file] } });
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/pms/v1/housekeeping-tasks/12/photos' })));
    const body = posted().find((x) => x.path === '/api/pms/v1/housekeeping-tasks/12/photos')!.body as unknown as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('bath.jpg');
    first.unmount();

    app.set({ bootstrap: { user: { id: '9', name: 'Other' }, permissions: ['*'] } as never });
    show();
    expect(await screen.findByRole('img', { name: 'Room 102, photo' })).toBeTruthy();
    expect(screen.queryByLabelText('Add a photo…')).toBeNull();
  });

  it('waits for WorkSuite: a task shows no stale copy offline', async () => {
    perms = ['pms.access', 'pms.housekeeping.view'];
    tab.path = ['pms', 'housekeeping', 'tasks', '12'];
    app.set({ status: { network: 'OFFLINE' } as never });
    extra = () => ({ task: TASK, history: [], restocks: [] });
    show();
    expect(await screen.findByText(/shows when WorkSuite is back/)).toBeTruthy();
    expect(vi.mocked(apiGetMeta).mock.calls.some(([p]) => p === '/api/pms/v1/housekeeping-tasks/12')).toBe(false);
  });
});

const ISSUE = {
  id: 4, property_id: 1, room_id: 11, room_number: '102', room_service_status: 'in_service', title: 'AC not cooling', description: 'Blows warm air', category: 'hvac', category_label: 'Air conditioning', priority: 'high',
  status: 'reported', status_label: 'Reported', reported_by: 'Front desk', reported_via: 'staff', assigned_to: null, assigned_name: null, asset_id: null, task_ref: null, outage: null, parts_used: [], photos: [],
  resolution: null, business_date: '2026-09-18', resolved_at: null, inspected_by: null, inspected_at: null, closed_at: null, created_at: '2026-09-18 07:00:00', updated_at: '2026-09-18 07:00:00', version: 1,
  options: [{ action: 'assign', to: 'assigned', label: 'Assigned', needs: [] }, { action: 'start', to: 'in_progress', label: 'In progress', needs: [] }, { action: 'cancel', to: 'cancelled', label: 'Cancelled', needs: ['reason'] }],
};

describe('maintenance (§11.3)', () => {
  it('lists the technician’s own issues and reports a fault that takes the room out of order', async () => {
    perms = ['pms.access', 'pms.maintenance.manage', 'pms.room.view'];
    tab.path = ['pms', 'maintenance'];
    extra = (p) =>
      p === '/api/pms/v1/properties/1/maintenance'
        ? { items: [ISSUE], categories: {}, statuses: [], priorities: {} }
        : p === '/api/pms/v1/properties/1/maintenance/my'
          ? { items: [], categories: {}, statuses: [], priorities: {} }
          : p === '/api/pms/v1/properties/1/rack'
            ? { rooms: [{ id: 11, number: '102' }] }
            : undefined;
    vi.mocked(request).mockResolvedValue(ok({ id: 9, out_of_order: { reassign: [{ confirmation_no: 'LAG26-00041' }] } }, 'Reported.'));
    show();
    expect(await screen.findByRole('button', { name: 'AC not cooling' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(await screen.findByText('Nothing given to you.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Report a fault' }));
    const dialog = await dialogWith('Report a fault');
    fireEvent.change(within(dialog).getByLabelText('What is wrong'), { target: { value: 'Shower leaking' } });
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Room' }));
    fireEvent.click(await screen.findByRole('option', { name: '102' }));
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Take the room out' }));
    fireEvent.click(screen.getByRole('option', { name: /Out of order/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Report' }));
    await waitFor(() =>
      expect(posted()).toContainEqual(
        expect.objectContaining({ path: '/api/pms/v1/properties/1/maintenance', body: { title: 'Shower leaking', room_id: 11, category: 'general', priority: 'normal', out_of_order: { kind: 'out_of_order' } }, headers: expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^issue-/) }) }),
      ),
    );
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/pms/maintenance/9'));
  });

  it('takes an issue through its life: take it, start, cancel with a reason', async () => {
    perms = ['pms.access', 'pms.maintenance.manage'];
    tab.path = ['pms', 'maintenance', '4'];
    app.set({ bootstrap: { user: { id: '7', name: 'Ruwan Silva' }, permissions: ['*'] } as never });
    extra = (p) => (p === '/api/pms/v1/maintenance-issues/4' ? { issue: ISSUE, history: [{ text: 'Reported', by: 'Front desk', at: '2026-09-18 07:00:00' }] } : undefined);
    vi.mocked(request).mockResolvedValue(ok({}, 'Done.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/maintenance-issues/4/assign', body: { assigned_to: 7, version: 1 } })));
    // "Assigned" is not a bare button: a person is chosen.
    expect(screen.queryByRole('button', { name: 'Assigned' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'In progress' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/maintenance-issues/4/start', body: { version: 1 } })));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }));
    const ask = await dialogWith('Cancelled');
    fireEvent.change(within(ask).getByLabelText('Reason'), { target: { value: 'Reported twice' } });
    fireEvent.click(within(ask).getAllByRole('button', { name: 'Cancelled' }).at(-1)!);
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/maintenance-issues/4/cancel', body: { version: 1, reason: 'Reported twice' } })));
  });

  it('shows someone who only reads rooms the issues, and no moves', async () => {
    perms = ['pms.access', 'pms.room.view'];
    tab.path = ['pms', 'maintenance', '4'];
    extra = (p) => (p === '/api/pms/v1/maintenance-issues/4' ? { issue: { ...ISSUE, options: [] }, history: [] } : undefined);
    show();
    expect(await screen.findByText('Blows warm air')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take it' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Technician' })).toBeNull();
  });
});

const LOST = {
  id: 9, property_id: 1, item: 'Black wallet', description: 'Leather', location: null, room_id: 11, room_number: '102', found_by: 'Sita K.', found_at: '2026-09-18 09:00:00', photo: null, storage_place: null,
  guest: { id: 70, name: 'Nimal Perera', vip_level: 'none' }, status: 'found', status_label: 'Found', claimant: null, returned_to: null, returned_at: null, disposed_at: null, disposal_reason: null, keep_until: '2026-12-17', due_for_disposal: false, version: 1,
  options: [{ action: 'store', to: 'stored', label: 'Stored', needs: ['storage_place'] }, { action: 'claim', to: 'claimed', label: 'Claimed', needs: [] }],
};

describe('lost and found (§11.6)', () => {
  it('logs a found item once, and stores or hands it over with what each move needs', async () => {
    perms = ['pms.access', 'pms.housekeeping.manage'];
    tab.path = ['pms', 'lost-found', '9'];
    extra = (p) => (p === '/api/pms/v1/properties/1/lost-found' ? { items: [LOST], keep_days: 90 } : p === '/api/pms/v1/lost-found/9' ? { item: LOST, history: [] } : undefined);
    vi.mocked(request).mockResolvedValue(ok({ id: 10 }, 'Recorded.'));
    show();
    expect(await screen.findByText('Unclaimed items are kept 90 days.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Claimed' }));
    const claim = await dialogWith('Claimed');
    fireEvent.change(within(claim).getByLabelText('Claimed by'), { target: { value: 'Nimal Perera' } });
    fireEvent.click(within(claim).getAllByRole('button', { name: 'Claimed' }).at(-1)!);
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/lost-found/9/claim', body: { version: 1, claimant: 'Nimal Perera' } })));

    fireEvent.click(screen.getByRole('button', { name: 'Stored' }));
    const store = await dialogWith('Stored');
    fireEvent.change(within(store).getByLabelText('Stored at'), { target: { value: 'Safe 2' } });
    fireEvent.click(within(store).getAllByRole('button', { name: 'Stored' }).at(-1)!);
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/lost-found/9/store', body: { version: 1, storage_place: 'Safe 2' } })));

    fireEvent.click(screen.getByRole('button', { name: 'Record an item' }));
    const add = await dialogWith('Record a found item');
    fireEvent.change(within(add).getByLabelText('Item'), { target: { value: 'Sunglasses' } });
    fireEvent.change(within(add).getByLabelText('Or where'), { target: { value: 'Pool' } });
    fireEvent.click(within(add).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/properties/1/lost-found', body: { item: 'Sunglasses', location: 'Pool' }, headers: expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^lost-/) }) })));
  });
});

describe('guest requests: a person to do it (PMS-REQ-002)', () => {
  it('assigns a request to someone from the directory', async () => {
    perms = ['pms.access', 'pms.guest_request.manage'];
    tab.path = ['pms', 'requests'];
    const req = { id: 3, property_id: 1, request_type: 'extra_towels', type_label: 'Extra towels', department_label: 'Housekeeping', description: null, status: 'new', status_label: 'New', priority: 'normal', room_number: '102', confirmation_no: null, guest: null, assigned_name: null, due_at: null, overdue: false, created_at: '2026-09-18 08:00:00', version: 2, options: [{ action: 'assign', to: 'assigned', label: 'Assigned', needs: [] }, { action: 'accept', to: 'accepted', label: 'Accepted', needs: [] }] };
    extra = (p) => (p === '/api/pms/v1/properties/1/requests' ? { items: [req], types: {} } : p === '/api/pms/v1/properties/1/rack' ? { rooms: [] } : undefined);
    vi.mocked(request).mockResolvedValue(ok({}, 'Assigned.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Assign…' }));
    const dialog = await dialogWith(/Give the request for room 102 to/);
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Person' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Ruwan Silva' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/guest-requests/3/assign', body: { version: 2, assigned_to: 7 } })));
  });
});

describe('a guest: documents and a duplicate (PMS-DOC-001, PMS-DUP-003)', () => {
  const GUEST = { id: 70, org_id: 3, client_id: 700, name: 'Nimal Perera', email: 'nimal@x.lk', phone: null, address: null, nationality: null, country: null, language: null, vip_level: 'none', vip_note: null, guest_type: null, special_requirements: null, notes: null, preferences: [], has_identity: false, identity_verified: false, stays: 2, last_stay: '2026-08-01', version: 1 };
  beforeEach(() => {
    tab.path = ['pms', 'guests', '70'];
    extra = (p) =>
      p === '/api/pms/v1/guests/70'
        ? { guest: GUEST, documents: [{ id: 5, kind: 'other', kind_label: 'Other', is_identity: false, file_name: 'letter.pdf', mime: 'application/pdf', bytes: 2048, retain_until: null, redacted: false, note: null }], activity: [] }
        : p === '/api/pms/v1/guests/70/reservations'
          ? { items: [] }
          : p === '/api/pms/v1/guests'
            ? { items: [{ guest_id: 70, client_id: 700, name: 'Nimal Perera', email: null, phone: null, vip_level: 'none' }, { guest_id: 71, client_id: 701, name: 'Nimal Pereira', email: 'np@x.lk', phone: null, vip_level: 'none' }] }
            : undefined;
  });

  it('merges a duplicate into the guest with a reason, for whoever may merge', async () => {
    perms = ['pms.access', 'pms.guest.view', 'pms.guest.merge'];
    vi.mocked(request).mockResolvedValue(ok({ guest: GUEST }, 'Merged.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Merge a duplicate' }));
    const dialog = await dialogWith('Merge a duplicate into Nimal Perera');
    fireEvent.change(within(dialog).getByLabelText('Find the duplicate'), { target: { value: 'Nimal' } });
    // The guest kept is never offered as their own duplicate.
    fireEvent.click(await within(dialog).findByRole('radio'));
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Same passport' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/guests/70/merge', body: { from_guest_id: 71, reason: 'Same passport' } })));
  });

  it('saves a document through the main process where downloads are allowed, and offers no save where they are not', async () => {
    perms = ['pms.access', 'pms.guest.view'];
    app.set({ bootstrap: { user: { id: '7' }, permissions: ['pms.access'] } as never });
    const first = show();
    expect(await screen.findByText(/letter\.pdf/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    first.unmount();

    app.set({ bootstrap: { user: { id: '7' }, permissions: ['pms.access', 'desktop.downloads'] } as never });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('pms:download', { file: { kind: 'guest-document', document: 5 }, name: 'letter.pdf' }));
  });

  it('removes a document for whoever may edit guests, and offers no merge to those who may not', async () => {
    perms = ['pms.access', 'pms.guest.view', 'pms.guest.edit'];
    vi.mocked(request).mockResolvedValue(ok(null, 'Removed.'));
    show();
    expect(await screen.findByText(/letter\.pdf/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Merge a duplicate' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const ask = await dialogWith('Remove other');
    fireEvent.click(within(ask).getAllByRole('button', { name: 'Remove' }).at(-1)!);
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/api/pms/v1/guest-documents/5' })));
  });
});

describe('invoices and the billing outbox (§10.5)', () => {
  it('invoices a settled folio now, and retries a hand-off that gave up — for the settings manager only', async () => {
    perms = ['pms.access', 'pms.folio.view', 'pms.payment.process', 'pms.settings.manage'];
    tab.path = ['pms', 'invoices'];
    extra = (p) =>
      p === '/api/pms/v1/properties/1/folios'
        ? { items: [{ ...FOLIO, status: 'settled', status_label: 'Settled', balance: '0.00', settled_at: '2026-09-18 10:00:00' }] }
        : p === '/api/pms/v1/properties/1/outbox'
          ? { items: [{ id: 21, topic: 'invoice', ref_type: 'folio', ref_id: 5, status: 'dead', status_label: 'Needs attention', attempts: 5, next_attempt_at: null, last_error: 'Billing refused: no tax rate', done_at: null, created_at: '2026-09-18 10:00:00' }] }
          : undefined;
    vi.mocked(request).mockResolvedValue(ok({}, 'Sent again.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Invoice now' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/folios/5/invoice' })));
    expect(await screen.findByText('Billing refused: no tax rate')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/outbox/21/retry' })));
  });
});

describe('reports and KPIs (§13.6–13.7)', () => {
  const KPI = { rooms_available: 40, out_of_order: 1, house_use: 0, rooms_sold: 30, complimentary: 1, room_revenue: '750000.00', arrivals_expected: 10, arrivals: 9, departures: 8, stayovers: 21, no_shows: 1, cancellations: 2, created: 20, occupancy_pct: '75.00', adr: '25000.00', revpar: '18750.00', no_show_rate: '10.00', cancellation_rate: '10.00' };
  const CATALOGUE = { reports: [{ key: 'occupancy', title: 'Occupancy', group: 'rooms', group_label: 'Rooms', filters: ['from', 'to'] }], groups: { rooms: 'Rooms' }, export: true, formats: ['csv'] };

  it('shows the server’s KPIs and lists the reports this person may run', async () => {
    perms = ['pms.access', 'pms.reports.view'];
    tab.path = ['pms', 'reports'];
    extra = (p) => (p === '/api/pms/v1/properties/1/kpis' ? { days: [KPI], totals: KPI, currency: 'LKR' } : p === '/api/pms/v1/properties/1/reports' ? CATALOGUE : undefined);
    show();
    expect(await screen.findByText('75.00%')).toBeTruthy();
    expect(screen.getByText('LKR 25,000.00')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Occupancy' }));
    expect(tab.go).toHaveBeenCalledWith('/pms/reports/occupancy');
  });

  it('saves the server’s CSV through the download manager — only with the export permission and where files may be saved', async () => {
    tab.path = ['pms', 'reports', 'occupancy'];
    extra = (p) =>
      p === '/api/pms/v1/properties/1/reports'
        ? CATALOGUE
        : p === '/api/pms/v1/properties/1/reports/occupancy'
          ? { key: 'occupancy', title: 'Occupancy', property: 'Lagoon Hotel', period: { from: '2026-09-18', to: '2026-09-18' }, currency: 'LKR', columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'sold', label: 'Sold', type: 'int' }], rows: [{ date: '2026-09-18', sold: 30 }], totals: null, generated_at: '2026-09-18 10:00:00' }
          : p === '/api/pms/v1/properties/1/room-types' || p === '/api/pms/v1/properties/1/rate-plans'
            ? { items: [] }
            : undefined;
    {
      perms = ['pms.access', 'pms.reports.view'];
      const first = show();
      expect(await screen.findByText('30')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull();
      first.unmount();

      perms = ['pms.access', 'pms.reports.view', 'pms.reports.export'];
      app.set({ bootstrap: { user: { id: '7' }, permissions: ['pms.access'] } as never });
      const noDownloads = show();
      expect(await screen.findByText('30')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull();
      noDownloads.unmount();

      app.set({ bootstrap: { user: { id: '7' }, permissions: ['pms.access', 'desktop.downloads'] } as never });
      show();
      fireEvent.click(await screen.findByRole('button', { name: 'CSV' }));
      // The main process fetches it by what it is (no bytes over IPC) and checks `desktop.downloads` itself.
      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('pms:download', { file: { kind: 'report', property: 1, report: 'occupancy', format: 'csv', query: { from: '2026-09-18', to: '2026-09-18' } }, name: 'occupancy-2026-09-18.csv' }),
      );
      expect(call).not.toHaveBeenCalledWith('office:saveCopy', expect.anything());
    }
  });
});

describe('the tape chart (§6.4)', () => {
  const CAL = {
    property_id: 1, from: '2026-09-18', days: 14, business_date: '2026-09-18',
    dates: Array.from({ length: 14 }, (_, i) => `2026-09-${String(18 + i).padStart(2, '0')}`.replace('2026-09-31', '2026-10-01')),
    rooms: [{ id: 10, number: '101', room_type_id: 2, room_type: 'Deluxe King', floor: '1', building: 'Main', badge: { status: 'available', label: 'Available', colour: '#16a34a', icon: 'check' } }, { id: 11, number: '102', room_type_id: 2, room_type: 'Deluxe King', floor: '1', building: 'Main', badge: { status: 'occupied', label: 'Occupied', colour: '#7c3aed', icon: 'user' } }],
    bars: [{ reservation_id: 40, reservation_room_id: 60, confirmation_no: 'LAG26-00040', guest_name: 'Nimal Perera', vip_level: 'none', status: 'confirmed', status_label: 'Confirmed', colour: '#2563eb', room_id: 10, room_type_id: 2, start: '2026-09-19', end: '2026-09-21', nights: 2, arrival_date: '2026-09-19', departure_date: '2026-09-21', in_house: false, adults: 2, children: 0, version: 4, continues_before: false, continues_after: false }],
    unassigned: [{ reservation_id: 41, reservation_room_id: 61, confirmation_no: 'LAG26-00041', guest_name: 'Kamal Dias', vip_level: 'none', status: 'confirmed', status_label: 'Confirmed', colour: '#2563eb', room_id: null, room_type_id: 2, start: '2026-09-18', end: '2026-09-19', nights: 1, arrival_date: '2026-09-18', departure_date: '2026-09-19', in_house: false, adults: 1, children: 0, version: 2, continues_before: false, continues_after: false }],
    outages: [], room_types: [{ id: 2, code: 'DK', name: 'Deluxe King' }], legend: [{ status: 'confirmed', label: 'Confirmed', colour: '#2563eb' }],
  };

  it('draws each booking on its room in words, and moves one after the server says what it would cost', async () => {
    perms = ['pms.access', 'pms.reservation.view', 'pms.reservation.edit', 'pms.room.move'];
    tab.path = ['pms', 'calendar'];
    extra = (p) => (p === '/api/pms/v1/properties/1/calendar' ? CAL : undefined);
    vi.mocked(request).mockImplementation(async (_m: string, path: string) => (path.endsWith('/calendar/preview') ? ok({ impact: { before: '50000.00', after: '50000.00', difference: '0.00', currency: 'LKR' } }, 'Fine.') : ok({}, 'Moved.')) as never);
    show();
    const bar = await screen.findByRole('button', { name: /Nimal Perera, Confirmed, .* room 101/ });
    expect(within(screen.getByRole('region', { name: 'Without a room' })).getByText('LAG26-00041')).toBeTruthy();
    fireEvent.click(bar);
    fireEvent.click(within(screen.getByRole('region', { name: 'Chosen booking' })).getByRole('button', { name: 'Move…' }));
    const dialog = await dialogWith('Move LAG26-00040');
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Room' }));
    fireEvent.click(screen.getByRole('option', { name: /^102/ }));
    expect(await within(dialog).findByLabelText('Price impact')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/calendar/move', body: { reservation_room_id: 60, room_id: 11, version: 4 } })));
  });

  it('shows a reader the tape with no way to move a booking', async () => {
    perms = ['pms.access', 'pms.reservation.view'];
    tab.path = ['pms', 'calendar'];
    extra = (p) => (p === '/api/pms/v1/properties/1/calendar' ? CAL : undefined);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Nimal Perera, Confirmed/ }));
    expect(within(screen.getByRole('region', { name: 'Chosen booking' })).queryByRole('button', { name: 'Move…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Give a room' })).toBeNull();
  });
});

describe('a room’s housekeeping status (PMS-ROM-002, PMS-HK-002)', () => {
  const ROOM = {
    id: 11, number: '102', name: null, property_id: 1, room_type_id: 2, room_type: 'DK', room_type_name: 'Deluxe King', building_id: 1, building: 'Main', floor_id: 1, floor: '1', hk_zone: null, beds: 1, occupancy: 'vacant', hk_status: 'dirty', hk_status_label: 'Dirty',
    service_status: 'in_service', is_sellable: true, ready: false, badge: { status: 'dirty', label: 'Vacant dirty', colour: '#dc2626', icon: 'sparkles' }, vip: false, due_in: false, due_out: false, in_house: [], arriving: [], hk_task: null, open_issues: 0, status_at: null, version: 6, actions: [],
  };
  it('moves the room along the edges the server offers, a reason where one is needed', async () => {
    perms = ['pms.access', 'pms.room.view', 'pms.housekeeping.view'];
    tab.path = ['pms', 'rooms', '11'];
    extra = (p) =>
      p === '/api/pms/v1/rooms/11'
        ? { room: ROOM, housekeeping_options: [{ to: 'clean', on: 'clean', label: 'Clean', needs: [], perm: 'pms.housekeeping.view' }, { to: 'dirty', on: 'reject', label: 'Back to dirty', needs: ['reason'], perm: 'pms.housekeeping.view' }, { to: 'inspected', on: 'inspect', label: 'Inspected', needs: [], perm: 'pms.housekeeping.manage' }], outages: [] }
        : p === '/api/pms/v1/rooms/11/history'
          ? { items: [] }
          : p === '/api/pms/v1/rooms/11/maintenance'
            ? { items: [ISSUE], categories: {}, statuses: [], priorities: {} }
            : undefined;
    vi.mocked(request).mockResolvedValue(ok({}, 'Room 102 is clean.'));
    show();
    const group = await screen.findByRole('group', { name: 'Housekeeping status' });
    // Inspection is a supervisor's edge.
    expect(within(group).queryByRole('button', { name: 'Inspected' })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Clean' }));
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/rooms/11/housekeeping', body: { to: 'clean', version: 6 } })));
    fireEvent.click(within(group).getByRole('button', { name: 'Back to dirty' }));
    const ask = await dialogWith('Back to dirty');
    fireEvent.change(within(ask).getByLabelText('Reason'), { target: { value: 'Hair in the bath' } });
    fireEvent.click(within(ask).getAllByRole('button', { name: 'Back to dirty' }).at(-1)!);
    await waitFor(() => expect(posted()).toContainEqual(expect.objectContaining({ path: '/api/pms/v1/rooms/11/housekeeping', body: { to: 'dirty', version: 6, reason: 'Hair in the bath' } })));
    expect(await screen.findByRole('button', { name: 'AC not cooling' })).toBeTruthy();
  });
});
