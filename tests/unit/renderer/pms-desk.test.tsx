// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => true), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['pms'] as string[], go: (_r: string) => undefined as void, win: (_r: string, _t?: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/pms?${tab.query}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: (r: string, t?: string) => tab.win(r, t), setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGetMeta, request, ApiError } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { default: PmsShell } = await import('../../../src/modules/pms/PmsShell');
// The shell's screens are lazy chunks: loaded once here, so a first render does not race their transform.
await Promise.all(['Rack', 'Lists', 'CheckIn', 'CheckOut', 'WalkIn', 'Guests', 'Cashier', 'Folio', 'NewReservation'].map((m) => import(`../../../src/modules/pms/${m}.tsx`)));

const PROPERTY = { id: 1, org_id: 3, code: 'LAG', name: 'Lagoon Hotel', status: 'active', status_label: 'Active', currency: 'LKR', timezone: 'Asia/Colombo', check_in_time: '14:00', check_out_time: '12:00', business_date: '2026-09-18' };
const options = (permissions: string[]) => ({
  org_id: 3, permissions, scope: 'all', properties: [PROPERTY],
  business_date: { business_date: '2026-09-18', status: 'open', status_label: 'Open', calendar_date: '2026-09-18', days_behind: 0, night_audit_time: '01:00', timezone: 'Asia/Colombo', last_closed: '2026-09-17' },
  reservation_statuses: [{ value: 'confirmed', label: 'Confirmed', colour: '#2563eb', icon: 'check', consumes: true }],
  room_display: [], housekeeping_statuses: [{ value: 'dirty', label: 'Dirty' }, { value: 'inspected', label: 'Inspected' }], service_statuses: [], outage_kinds: [], night_audit_steps: [],
  booking_types: [{ value: 'phone', label: 'Phone' }], guarantees: [{ value: 'none', label: 'None' }, { value: 'card', label: 'Card' }], vip_levels: [], document_kinds: [{ value: 'other', label: 'Other' }], sources: [],
});

const badge = (status: string, label: string) => ({ status, label, colour: '#16a34a', icon: 'check-circle' });
const room = (id: number, number: string, over: Record<string, unknown> = {}) => ({
  id, number, name: null, room_type_id: 2, room_type: 'Deluxe King', building_id: 1, building: 'Main', floor_id: 1, floor: '1', hk_zone: null, beds: null,
  occupancy: 'vacant', hk_status: 'inspected', hk_status_label: 'Inspected', service_status: 'in_service', is_sellable: true, ready: true, badge: badge('available', 'Available'),
  vip: false, due_in: false, due_out: false, in_house: [], arriving: [], hk_task: null, open_issues: 0, status_at: null, version: 1,
  actions: [{ action: 'walk_in', label: 'Walk-in' }, { action: 'view_room', label: 'View room' }], ...over,
});
const RACK = {
  property_id: 1, business_date: '2026-09-18', server_time: '2026-09-18 08:00:00',
  rooms: [
    room(10, '101'),
    room(11, '102', {
      occupancy: 'occupied', ready: false, hk_status: 'dirty', hk_status_label: 'Dirty', badge: { status: 'occupied', label: 'Occupied', colour: '#7c3aed', icon: 'user' }, due_out: true,
      in_house: [{ guest: { name: 'Nimal Perera', vip_level: 'vip' }, reservation_id: 40, reservation_room_id: 60, confirmation_no: 'LAG26-00040', arrival_date: '2026-09-16', departure_date: '2026-09-18', balance: [{ currency: 'LKR', balance: '12500.00' }] }],
      actions: [{ action: 'view_room', label: 'View room' }, { action: 'open_folio', label: 'Open folio' }, { action: 'check_out', label: 'Check-out' }],
    }),
  ],
  floors: [{ building_id: 1, building: 'Main', floor_id: 1, floor: '1', rooms: [10, 11] }],
  counts: { available: 1, occupied: 1 },
  legend: [badge('available', 'Available'), { status: 'occupied', label: 'Occupied', colour: '#7c3aed', icon: 'user' }],
  room_types: [{ id: 2, code: 'DK', name: 'Deluxe King' }],
  lists: { arrivals: 3, departures: 1, in_house: 1 },
};

type Route = (path: string, query?: Record<string, unknown>) => unknown;
let routes: Route = () => undefined;
let offline = false;

function serve(perms: string[], extra: Route = () => undefined) {
  routes = (path, query) => {
    if (path === '/api/pms/v1/properties') return { items: [PROPERTY] };
    if (path === '/api/pms/v1/options') return options(perms);
    if (path === '/api/pms/v1/properties/1/rack') return RACK;
    return extra(path, query);
  };
}

const posted = () => vi.mocked(request).mock.calls.map(([method, path, o]) => ({ method, path, body: (o as { body?: Record<string, unknown> })?.body, headers: (o as { headers?: Record<string, string> })?.headers }));

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PmsShell tabId="t1" route="/pms" active />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    const data = routes(path, query);
    if (data === undefined) return new Promise(() => undefined);
    if (data instanceof Error) throw data;
    return { data, offline, cachedAt: offline ? '2026-09-18T07:00:00Z' : null };
  });
  tab.query = new URLSearchParams();
  tab.path = ['pms'];
  tab.go = vi.fn();
  tab.win = vi.fn();
  offline = false;
  app.set({ status: null });
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
});
afterEach(cleanup);

describe('Hotel PMS, the shell', () => {
  it('shows a receptionist the desk and a cashier only the cashier — what each may do, nothing else', async () => {
    serve(['pms.access', 'pms.room.view', 'pms.reservation.view', 'pms.reservation.create', 'pms.checkin', 'pms.checkout', 'pms.guest.view']);
    const first = show();
    const rail = await screen.findByRole('navigation', { name: 'Hotel PMS' });
    for (const t of ['Room rack', 'Arrivals', 'Departures', 'In house', 'Reservations', 'New reservation', 'Walk-in', 'Guests']) expect(rail.textContent).toContain(t);
    for (const t of ['Cashier', 'Night audit', 'Dashboard']) expect(rail.textContent).not.toContain(t);
    fireEvent.click(within(rail).getByRole('button', { name: /Arrivals/ }));
    expect(tab.go).toHaveBeenCalledWith('/pms?view=arrivals');
    first.unmount();

    serve(['pms.access', 'pms.cashier.open', 'pms.cashier.close', 'pms.payment.view', 'pms.payment.process'], (p) => (p === '/api/pms/v1/properties/1/cashier-sessions' ? { items: [], mine: null } : undefined));
    show();
    const rail2 = await screen.findByRole('navigation', { name: 'Hotel PMS' });
    expect(rail2.textContent).toContain('Cashier');
    expect(rail2.textContent).not.toContain('Room rack');
    expect(rail2.textContent).not.toContain('New reservation');
    // The first screen a cashier may open is theirs.
    expect(await screen.findByRole('button', { name: 'Open shift' })).toBeTruthy();
  });

  it('opens a new reservation on Alt+N, and the rack on Alt+R', async () => {
    serve(['pms.access', 'pms.room.view', 'pms.reservation.view', 'pms.reservation.create']);
    show();
    await screen.findByRole('navigation', { name: 'Hotel PMS' });
    fireEvent.keyDown(window, { key: 'n', code: 'KeyN', altKey: true });
    expect(tab.go).toHaveBeenCalledWith('/pms?view=new');
    fireEvent.keyDown(window, { key: 'r', code: 'KeyR', altKey: true });
    expect(tab.go).toHaveBeenCalledWith('/pms?view=rack');
  });

  it('says so plainly when the person reaches no property', async () => {
    routes = (p) => (p === '/api/pms/v1/properties' ? { items: [] } : undefined);
    show();
    expect(await screen.findByText('No hotel property is open to you')).toBeTruthy();
  });
});

describe('the room rack (PMS-FD-001…005)', () => {
  it('draws every room with the server’s badge in words, filters by status, and offers the server’s quick actions', async () => {
    serve(['pms.access', 'pms.room.view', 'pms.reservation.view', 'pms.folio.view', 'pms.checkout']);
    show();
    const r101 = await screen.findByRole('button', { name: /Room 101, Available/ });
    expect(screen.getByRole('button', { name: /Room 102, Occupied, Nimal Perera/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Arrivals 3/ })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Rooms by status' })).getByRole('button', { name: /Occupied/ }));
    expect(screen.queryByRole('button', { name: /Room 101, Available/ })).toBeNull();
    expect(r101.isConnected).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Room 102/ }));
    const panel = screen.getByRole('complementary', { name: 'Room 102' });
    expect(within(panel).getByRole('button', { name: 'Open folio' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Walk-in' })).toBeNull();
    expect(panel.textContent).toContain('Owes LKR 12,500.00');
    fireEvent.click(within(panel).getByRole('button', { name: 'Check-out' }));
    expect(tab.go).toHaveBeenCalledWith('/pms/reservations/40/check-out');
    // The rack on a second screen (PMS-DSK-004).
    fireEvent.click(screen.getByRole('button', { name: 'Window' }));
    expect(tab.win).toHaveBeenCalledWith('/pms?view=rack', 'Room rack · Lagoon Hotel');
  });

  it('offline: the last copy, a clear banner, and the actions that change something wait (PMS-DSK-003)', async () => {
    offline = true;
    app.set({ status: { network: 'OFFLINE' } as never });
    serve(['pms.access', 'pms.room.view', 'pms.reservation.view', 'pms.checkin', 'pms.reservation.create', 'pms.folio.view']);
    show();
    expect(await screen.findByText(/Offline — the room rack, arrivals, departures and in-house list are the last copy/)).toBeTruthy();
    expect(await screen.findByText(/Offline results/)).toBeTruthy();
    // No stale money on the tiles while offline.
    expect(screen.queryByText('LKR 12,500.00')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Room 101/ }));
    const panel = screen.getByRole('complementary', { name: 'Room 101' });
    expect((within(panel).getByRole('button', { name: 'Walk-in' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(panel).getByRole('button', { name: 'View room' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

const CHECKIN = (overrides: Record<string, unknown> = {}) => ({
  reservation_id: 40, confirmation_no: 'LAG26-00040', status: 'confirmed', status_label: 'Confirmed', guest_id: 7, guest_name: 'Nimal Perera', vip_level: 'none', eta: '15:00', special_requests: null,
  guarantee_type: 'none', id_verified: false, deposit: null, version: 4, business_date: '2026-09-18', preferences: [], id_required: true, has_identity: false,
  early_checkin: { offered: false, check_in_time: '14:00' }, can_override: false,
  rooms: [{ reservation_room_id: 60, line_no: 1, room_type_id: 2, room_type: 'Deluxe King', arrival_date: '2026-09-18', departure_date: '2026-09-20', adults: 2, children: 0, room_id: 11, room_number: '102',
    readiness: { assigned: true, in_service: true, vacant: true, ready: false, hk_status: 'dirty', blockers: ['Room 102 is dirty.'], overridable: true }, due_today: true, can_check_in: false, needs_override: true }],
  ...overrides,
});

describe('check-in (PMS-CKI-002/003, AC-06)', () => {
  it('blocks a dirty room for someone who may not override, and says why', async () => {
    tab.path = ['pms', 'reservations', '40', 'check-in'];
    serve(['pms.access', 'pms.checkin', 'pms.reservation.view'], (p) => (p === '/api/pms/v1/reservations/40/check-in' ? CHECKIN() : undefined));
    show();
    expect(await screen.findByText('Room 102 is dirty.')).toBeTruthy();
    expect(screen.getByText(/can be checked in only by someone who may override it/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Check in/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets someone who may override check in with a reason, once — the key goes with every press', async () => {
    tab.path = ['pms', 'reservations', '40', 'check-in'];
    serve(['pms.access', 'pms.checkin', 'pms.checkin.override', 'pms.reservation.view'], (p) => (p === '/api/pms/v1/reservations/40/check-in' ? CHECKIN({ can_override: true }) : undefined));
    vi.mocked(request).mockResolvedValueOnce({
      data: { stays: [{ stay_id: 90, reservation_room_id: 60, room_id: 11, room_number: '102', folio_id: 5, key: { ok: true, status: 'manual', message: 'Key handed over by hand' } }], reservation_status: 'checked_in' },
      offline: false, cachedAt: null, message: 'Checked in: room 102.',
    });
    show();
    const button = (await screen.findByRole('button', { name: /^Check in/ })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /ID has been checked/ }));
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Guest waited an hour; room cleaned but not inspected' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await screen.findByText(/is checked in/);
    const call = posted().find((c) => c.path === '/api/pms/v1/reservations/40/check-in')!;
    expect(call.method).toBe('POST');
    expect(call.body).toMatchObject({ rooms: [60], version: 4, id_verified: true, override_reason: 'Guest waited an hour; room cleaned but not inspected', keys: 1 });
    expect(call.headers?.['Idempotency-Key']).toMatch(/^checkin-/);
    expect(screen.getByText('Key handed over by hand')).toBeTruthy();
  });

  it('shows the server’s refusal in its own words', async () => {
    tab.path = ['pms', 'reservations', '40', 'check-in'];
    serve(['pms.access', 'pms.checkin', 'pms.reservation.view'], (p) => (p === '/api/pms/v1/reservations/40/check-in' ? CHECKIN({ rooms: [{ ...CHECKIN().rooms[0]!, readiness: { ...CHECKIN().rooms[0]!.readiness, ready: true, blockers: [] }, needs_override: false }] }) : undefined));
    vi.mocked(request).mockRejectedValueOnce(new ApiError(409, 'Room 102 is occupied.', null, { code: 'room_occupied' }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Check in/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Room 102 is occupied.');
  });
});

describe('check-out (PMS-CKO-002)', () => {
  it('names the folios that still owe when the server refuses, and presses once with its key', async () => {
    tab.path = ['pms', 'reservations', '40', 'check-out'];
    const folio = {
      id: 5, folio_no: 'FLAG-000005', property_id: 1, reservation_id: 40, stay_id: 90, label: 'Guest', payee_type: 'guest', payee_client_id: 70, payee_name: 'Nimal Perera', status: 'open', status_label: 'Open', balance: '1062.00', currency: 'LKR',
      opened_business_date: '2026-09-16', settled_at: null, closed_at: null, invoice_id: null, receipt_no: null, ar_reference: null, version: 3, items: [], payments: [],
      totals: { charges: '900.00', taxes: '162.00', payments: '0.00', refunds: '0.00', balance: '1062.00' }, tax_summary: [], options: [],
    };
    const stay = {
      id: 90, property_id: 1, reservation_id: 40, confirmation_no: 'LAG26-00040', reservation_room_id: 60, room_id: 11, room_number: '102', room_type_id: 2, room_type: 'Deluxe King', guest_id: 7, guest_name: 'Nimal Perera', vip_level: 'none',
      status: 'in_house', status_label: 'In house', arrival_date: '2026-09-16', departure_date: '2026-09-18', nights: 2, adults: 2, children: 0, currency: 'LKR', folios: [folio], routing: [], moves: [],
      folio_views: [folio], owed: '1062.00', early: false, blockers: ['The folios owe 1,062.00.'], minibar_waiting: [{ id: 3, product: 'Water 500 ml', quantity: 2, amount: '400.00', currency: 'LKR' }],
    };
    serve(['pms.access', 'pms.checkout', 'pms.folio.view'], (p) =>
      p === '/api/pms/v1/reservations/40/check-out'
        ? { reservation_id: 40, confirmation_no: 'LAG26-00040', business_date: '2026-09-18', stays: [stay], deposit: null, late_checkout: { offered: false }, apply_deposit: true }
        : p === '/api/pms/v1/folios/5'
          ? { folio }
          : undefined,
    );
    vi.mocked(request).mockRejectedValueOnce(new ApiError(409, 'Room 102 cannot be checked out: its folios owe LKR 1,062.00.', null, { code: 'balance', folios: [{ id: 5, folio_no: 'FLAG-000005', label: 'Guest', balance: '1062.00' }] }));
    show();
    expect(await screen.findByText('The folios owe 1,062.00.')).toBeTruthy();
    expect(screen.getByText(/Water 500 ml × 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check out room 102' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('its folios owe LKR 1,062.00');
    expect(alert.textContent).toContain('FLAG-000005 · Guest: 1,062.00');
    const call = posted().find((c) => c.path === '/api/pms/v1/reservations/40/check-out')!;
    expect(call.body).toEqual({ rooms: [60], apply_deposit: true });
    expect(call.headers?.['Idempotency-Key']).toMatch(/^checkout-/);
  });
});

describe('walk-in (PMS-WLK-001/002)', () => {
  it('books and checks in on one screen, once, with the payment', async () => {
    serve(['pms.access', 'pms.checkin', 'pms.reservation.create', 'pms.reservation.view', 'pms.guest.view', 'pms.payment.process'], (p, q) => {
      if (p === '/api/pms/v1/availability')
        return {
          property_id: 1, arrival: '2026-09-18', departure: q?.departure, nights: 1, adults: 1, children: 0, rooms: 1, currency: 'LKR', business_date: '2026-09-18',
          results: [{ room_type_id: 2, code: 'DK', name: 'Deluxe King', max_adults: 2, max_children: 1, max_occupancy: 3, is_dormitory: false, available: 3, enough: true, fits: true, why_not: null,
            rates: [{ rate_plan_id: 5, code: 'RO', name: 'Room only', meal_plan: 'room_only', refundable: true, available: true, reasons: [], total: '25000.00', per_room: '25000.00', average_nightly: '25000.00', nights: [] },
              { rate_plan_id: 6, code: 'NR', name: 'Non-refundable', meal_plan: 'room_only', refundable: false, available: false, reasons: ['Minimum stay 2 nights for arrivals on 18 Sep.'], total: '0.00', per_room: '0.00', average_nightly: '0.00', nights: [] }] }],
        };
      if (p === '/api/pms/v1/guests') return { items: [{ guest_id: 7, client_id: 70, name: 'Nimal Perera', email: 'nimal@x.lk', phone: null, vip_level: 'none' }] };
      if (p === '/api/pms/v1/properties/1/cashier-sessions') return { items: [], mine: null };
      return undefined;
    });
    tab.query = new URLSearchParams('view=walkin');
    vi.mocked(request).mockResolvedValueOnce({ data: { id: 41, confirmation_no: 'LAG26-00041', stays: [{ stay_id: 91, room_number: '101', key: { ok: true, status: 'manual', message: '' } }] }, offline: false, cachedAt: null, message: 'Walk-in checked in.' });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'What is free tonight' }));
    expect(await screen.findByText('Minimum stay 2 nights for arrivals on 18 Sep.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Room only/ }));
    fireEvent.change(screen.getByLabelText('Find the guest'), { target: { value: 'Nimal' } });
    fireEvent.click(await screen.findByRole('button', { name: /Nimal Perera/ }, { timeout: 2000 }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Take a payment now/ }));
    fireEvent.click(screen.getByRole('button', { name: /Check in Nimal Perera/ }));
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/pms/stays/91'));
    const call = posted().find((c) => c.path === '/api/pms/v1/properties/1/walk-ins')!;
    expect(call.body).toMatchObject({ guest_id: 7, room_type_id: 2, rate_plan_id: 5, adults: 1, departure_date: '2026-09-19', payment: { method: 'cash', amount: '25000.00', currency: 'LKR', terminal: 'Front desk' } });
    expect(call.headers?.['Idempotency-Key']).toMatch(/^walkin-/);
  });
});

describe('a new guest (PMS-DUP-001/002, AC-05)', () => {
  it('shows “Possible existing guest found” and lets the desk take the existing guest', async () => {
    serve(['pms.access', 'pms.reservation.create', 'pms.reservation.view', 'pms.guest.view', 'pms.guest.edit'], () => undefined);
    tab.query = new URLSearchParams('view=guests');
    vi.mocked(request).mockImplementation(async (_m: string, path: string) => {
      if (path === '/api/pms/v1/guests/check') return { data: { candidates: [{ guest_id: 7, client_id: 70, name: 'Nimal Perera', email: 'nimal@x.lk', phone: null, vip_level: 'none', matched_on: ['email'] }] }, offline: false, cachedAt: null, message: 'Possible existing guest found.' };
      throw new Error(`unexpected ${path}`);
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New guest' }));
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Nimal' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Perera' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'NIMAL@x.lk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add guest' }));
    expect(await screen.findByText('Possible existing guest found')).toBeTruthy();
    expect(screen.getByText('same email')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'This guest' }));
    expect(tab.go).toHaveBeenCalledWith('/pms/guests/7');
    expect(posted().some((c) => c.path === '/api/pms/v1/guests')).toBe(false);
  });
});
