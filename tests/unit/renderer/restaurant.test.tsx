// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
const bridge = vi.hoisted(() => ({ handle: (_c: string, _i: unknown): unknown => undefined }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async (c: string, i: unknown) => bridge.handle(c, i)), on: () => () => undefined, isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['restaurant'] as string[], go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/${tab.path.join('/')}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { request, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { default: RestaurantShell } = await import('../../../src/modules/restaurant/RestaurantShell');
const { screenOf, routeOf } = await import('../../../src/modules/restaurant/routes');
const { resolveWebLink } = await import('../../../shared/links');
const { APP_CATALOGUE } = await import('../../../shared/apps');
const { MODULES } = await import('../../../src/modules/registry');
await Promise.all(['Floor', 'Order', 'Bill', 'Kitchen', 'Connect', 'Outbox', 'Approvals', 'Cashier', 'Printers', 'Adjust'].map((m) => import(`../../../src/modules/restaurant/${m}.tsx`)));

const PAIRING = { terminal_id: 7, org_id: 17, branch_id: 3, name: 'Till 1', code: 'T1', mode: 'pos', station_id: null, area_id: null, counter_id: null, pos_register_id: 11, paired_at: '2026-09-30T09:00:00Z' };
const CAN = ['pos_access', 'order_create', 'order_edit', 'table_manage', 'payment_process', 'kitchen_view', 'kitchen_manage', 'cashier_open'];
const OPTIONS = { org: 17, companies: [{ id: 17, name: 'Spice Lane' }], currency: 'LKR', can: Object.fromEntries(CAN.map((c) => [c, true])), branches: [{ id: 1, branch_id: 3, name: 'Colombo 03' }], courses: { starter: 'Starter', main: 'Main' } };
const POS = { branch_id: 3, terminal: { id: 7, name: 'Till 1', code: 'T1', mode: 'pos', station_id: null }, area_id: null, counter_id: null, default_order_type: 'dine_in', order_types: ['dine_in', 'takeaway'], business_date: { id: 9, business_date: '2026-09-30', status: 'open' }, cashier_session: null, policy: { tenders: ['cash', 'card'], offline_actions: ['create_order', 'add_items', 'print_kot'] } };
const status = (over: Record<string, unknown> = {}) => ({ pairing: PAIRING, reachable: true, last_contact: null, last_sync: null, problem: null, waiting: 0, conflicts: 0, refused: 0, others: 0, can_queue: true, why_not: null, copy: null, last_seq: 0, agent: { enabled: true, mapped: 0, last_claim_at: null, problem: null, printers: [] }, ...over });

const TABLE = (over: Record<string, unknown>) => ({ area_id: 1, floor_id: 1, name: null, shape: 'square', capacity: 4, in_use: false, session_id: null, version: 3, party: null, order: null, next_reservation: null, ...over });
const FLOOR = {
  branch_id: 3,
  business_date: '2026-09-30',
  at: '2026-09-30T10:00:00Z',
  floors: [{ id: 1, name: 'Ground' }],
  areas: [{ id: 1, name: 'Main hall' }],
  tables: [
    TABLE({ id: 1, code: 'A1', status: 'available', status_label: 'Available' }),
    TABLE({ id: 2, code: 'A2', status: 'food_preparing', status_label: 'Food preparing', in_use: true, session_id: 40, party: { session_id: 40, guests: 3, opened_at: null, elapsed_minutes: 25, waiter_name: 'Kasun', tables: [2], primary_table_id: 2, version: 1 }, order: { id: 55, number: '0012', status: 'sent', status_label: 'Sent', total: '4500.00', currency: 'LKR', lines: 3, ready: 1, waiting: 2, held: 0, version: 4 } }),
  ],
  counts: { available: 1, food_preparing: 1 },
  statuses: { available: 'Available', food_preparing: 'Food preparing' },
};
const MENU = {
  branch_id: 3,
  channel: 'dine_in',
  business_date: '2026-09-30',
  categories: [{ id: 1, parent_id: null, name: 'Mains', course: 'main', sort: 1 }],
  items: [
    { id: 30, category_id: 1, kind: 'item', name: 'Chicken kottu', description: null, price: '1800.00', open_price: false, allergens: ['gluten'], course: 'main', station_id: 5, state: 'available', orderable: true, variants: [], combo: null,
      groups: [{ id: 8, name: 'Spice', kind: 'modifier', required: true, min: 1, max: 1, options: [{ id: 81, name: 'Mild', price_delta: '0.00', is_default: false, orderable: true, state: 'available', groups: [] }, { id: 82, name: 'Hot', price_delta: '100.00', is_default: false, orderable: true, state: 'available', groups: [] }] }] },
    { id: 31, category_id: 1, kind: 'item', name: 'Lamprais', description: null, price: '2200.00', open_price: false, allergens: [], course: 'main', station_id: 5, state: 'sold_out', orderable: false, variants: [], groups: [], combo: null },
  ],
};
const ORDER = {
  id: 55, uuid: 'x', number: '0012', branch_id: 3, order_type: 'dine_in', order_type_label: 'Dine-in', status: 'sent', status_label: 'Sent', session_id: 40, table_id: 2, table_label: 'A2', guests: 3, customer: { name: null, phone: null }, allergy_warning: null, waiter_name: 'Kasun', currency: 'LKR',
  subtotal: '4500.00', discount_total: '0.00', charge_total: '0.00', tax_total: '0.00', rounding: '0.00', total: '4500.00', paid_total: '0.00', balance: '4500.00', notes: null, offline: false, version: 4, courses: [], choices: ['serve'],
  lines: [{ id: 501, parent_id: null, item_id: 30, kind: 'item', name: 'Chicken kottu', variant_name: null, qty: '2.000', unit_price: '1800.00', modifiers_total: '0.00', line_total: '3600.00', course: 'main', seat: 1, notes: null, status: 'preparing', status_label: 'Preparing', comp: false, void_reason: null, version: 2, modifiers: [{ id: 1, name: 'Hot', qty: '1', price_delta: '100.00', group_name: 'Spice' }], choices: ['void'] }],
};

type Handler = (method: string, path: string, body: unknown, query: Record<string, unknown> | undefined) => unknown;
let routes: Handler = () => undefined;
let desk: Record<string, (i: unknown) => unknown> = {};

function serve(extra: Handler = () => undefined) {
  routes = (method, path, body, query) => {
    const r = extra(method, path, body, query);
    if (r !== undefined) return r;
    if (method === 'GET' && path === '/api/restaurant/v1/options') return OPTIONS;
    if (method === 'GET' && path === '/api/restaurant/v1/pos') return POS;
    if (method === 'GET' && path === '/api/restaurant/v1/floor') return FLOOR;
    if (method === 'GET' && path === '/api/restaurant/v1/menu/branch/3') return MENU;
    if (method === 'GET' && path === '/api/restaurant/v1/orders/55') return { order: ORDER };
    return undefined;
  };
}

const show = (path: string[], query = '') => {
  tab.path = path;
  tab.query = new URLSearchParams(query);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RestaurantShell tabId="t1" route={`/${path.join('/')}`} active />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(call).mockClear();
  vi.mocked(request).mockImplementation(async (method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown } = {}) => {
    const data = routes(method, path, opts.body, opts.query);
    if (data === undefined) return new Promise(() => undefined);
    if (data instanceof Error) throw data;
    return { data, offline: false, cachedAt: null, message: null };
  });
  desk = {
    'restaurant:pairing': () => PAIRING,
    'restaurant:status': () => status(),
    'restaurant:copy': () => null,
    'restaurant:outbox': () => [],
  };
  bridge.handle = (c, i) => desk[c]?.(i);
  tab.go = vi.fn();
  serve();
});
afterEach(cleanup);

const calls = (method: string, path: string) => vi.mocked(request).mock.calls.filter(([m, p]) => m === method && p === path);

describe('Restaurant: where things are', () => {
  it('reads its own addresses and the server’s notification links', () => {
    const q = new URLSearchParams();
    expect(screenOf(['restaurant'], q)).toMatchObject({ view: 'floor' });
    expect(screenOf(['restaurant'], q, 'kds')).toMatchObject({ view: 'kitchen' });
    expect(screenOf(['restaurant', 'orders', '41'], q)).toMatchObject({ view: 'order', order: 41 });
    expect(screenOf(['restaurant', 'kitchen'], new URLSearchParams('station=5'))).toMatchObject({ view: 'kitchen', station: 5 });
    expect(screenOf(['restaurant', 'cashier', '3'], q)).toMatchObject({ view: 'cashier' });
    expect(screenOf(['restaurant'], new URLSearchParams('view=order&type=takeaway'))).toMatchObject({ view: 'order', takeaway: true, order: null });
    expect(screenOf(['restaurant'], new URLSearchParams('view=nonsense'))).toMatchObject({ view: 'floor' });
    expect(routeOf('bill', { order: 55 })).toBe('/restaurant?view=bill&order=55');
    expect(resolveWebLink('/restaurant/orders/41')).toEqual({ kind: 'tab', route: '/restaurant/orders/41', app: 'restaurant' });
  });

  it('is a native app behind restaurant.access, with a validated module', () => {
    expect(APP_CATALOGUE.find((a) => a.id === 'restaurant')).toMatchObject({ perm: 'restaurant.access', webPath: '/restaurant', surface: 'native', sidebar: 'business' });
    expect(MODULES.find((m) => m.id === 'restaurant')?.manifest.offline.mode).toBe('PARTIAL_WRITE');
  });
});

describe('Restaurant: pairing', () => {
  it('asks a manager to pair this computer to one of the branch’s terminals', async () => {
    desk['restaurant:pairing'] = () => null;
    desk['restaurant:pair'] = () => ({ pairing: PAIRING, message: 'This computer is Till 1.' });
    serve((m, p) => (m === 'GET' && p === '/api/restaurant/v1/options' ? { ...OPTIONS, can: { ...OPTIONS.can, device_manage: true } } : m === 'GET' && p === '/api/restaurant/v1/structure' ? { terminals: [{ id: 7, branch_id: 3, name: 'Till 1', code: 'T1', mode: 'pos', station_id: null, paired: false, active: true, last_seen_at: null }], printers: [], stations: [], branches: [] } : undefined));
    show(['restaurant']);
    expect(await screen.findByText('Pair this computer', { selector: 'h1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Branch' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Colombo 03' }));
    fireEvent.click(await screen.findByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: 'Pair this computer' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('restaurant:pair', { org_id: 17, branch_id: 3, terminal_id: 7 }));
  });
});

describe('Restaurant: the floor', () => {
  it('shows each table by area in its state, with its party and order', async () => {
    show(['restaurant']);
    const a2 = await screen.findByRole('button', { name: 'Table A2 · Food preparing' });
    expect(a2.textContent).toContain('3 guests');
    expect(a2.textContent).toContain('#0012');
    expect(a2.textContent).toContain('1 ready');
    expect(screen.getByRole('region', { name: 'Main hall' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Restaurant' }).textContent).toContain('Kitchen');
  });

  it('opens an order at a free table with the table’s version, and goes to it', async () => {
    serve((m, p) => (m === 'POST' && p === '/api/restaurant/v1/floor/tables/1/open' ? { order: { id: 77 }, table: {} } : undefined));
    show(['restaurant']);
    fireEvent.click(await screen.findByRole('button', { name: 'Table A1 · Available' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take the order' }));
    fireEvent.change(within(dialog).getByLabelText('Guests'), { target: { value: '4' } });
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Take the order' }).at(-1)!);
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/restaurant?view=order&order=77'));
    const [, , opts] = calls('POST', '/api/restaurant/v1/floor/tables/1/open')[0]!;
    expect(opts).toMatchObject({ body: { guests: 4, version: 3 }, query: { org: 17 } });
    expect((opts as { headers: Record<string, string> }).headers['Idempotency-Key']).toMatch(/^desk-/);
  });

  it('moves a party with every table’s version', async () => {
    serve((m, p) => (m === 'POST' && p === '/api/restaurant/v1/floor/sessions/40/move' ? { session: {}, order: null } : undefined));
    show(['restaurant']);
    fireEvent.click(await screen.findByRole('button', { name: 'Table A2 · Food preparing' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /A1/ }));
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Move' }).at(-1)!);
    await waitFor(() => expect(calls('POST', '/api/restaurant/v1/floor/sessions/40/move')).toHaveLength(1));
    expect(calls('POST', '/api/restaurant/v1/floor/sessions/40/move')[0]![2]).toMatchObject({ body: { to_table_id: 1, from_table_id: 2, versions: { 1: 3, 2: 3 } } });
  });
});

describe('Restaurant: the order', () => {
  it('takes an item with its required modifier and sends the new lines to the kitchen', async () => {
    serve((m, p) => (m === 'POST' && p === '/api/restaurant/v1/orders/55/items' ? { order: ORDER } : undefined));
    show(['restaurant', 'orders', '55']);
    expect(await screen.findByText('Order #0012', { selector: 'h1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Lamprais/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Chicken kottu/ }));
    const dialog = await screen.findByRole('dialog');
    const add = within(dialog).getByRole('button', { name: /^Add · / });
    expect(add.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: /Hot/ }));
    fireEvent.change(within(dialog).getByLabelText('Note for the kitchen'), { target: { value: 'no onion' } });
    fireEvent.click(add);
    fireEvent.click(screen.getByRole('button', { name: 'Send to the kitchen' }));
    await waitFor(() => expect(calls('POST', '/api/restaurant/v1/orders/55/items')).toHaveLength(1));
    const body = (calls('POST', '/api/restaurant/v1/orders/55/items')[0]![2] as { body: { lines: Array<Record<string, unknown>>; send: boolean; version: number } }).body;
    expect(body).toMatchObject({ send: true, version: 4 });
    expect(body.lines[0]).toMatchObject({ item_id: 30, qty: 1, notes: 'no onion', course: 'main', modifiers: [{ option_id: 82 }] });
    expect(String(body.lines[0]!.client_line_id)).toMatch(/^l-/);
    expect(body.lines[0]).not.toHaveProperty('preview');
  });

  it('asks for an approval when the server says a void is above the limit, and voids again with it', async () => {
    let voids = 0;
    serve((m, p, b) => {
      if (m === 'POST' && p === '/api/restaurant/v1/orders/55/items/501/void') {
        voids++;
        return (b as { approval_id?: number }).approval_id === 90 ? { order: ORDER } : new ApiError(422, 'Voiding this is above your limit.', null, { code: 'approval_required', approval: { action: 'void', amount: '3600.00', pct: 80, subject_type: 'order_item', subject_id: 501, order_id: 55, branch_id: 3 } });
      }
      if (m === 'POST' && p === '/api/restaurant/v1/approvals') return { request: { id: 90, status: 'pending' }, approvers: 2 };
      if (m === 'GET' && p === '/api/restaurant/v1/approvals/90') return { request: { id: 90, status: 'pending', status_label: 'Pending' } };
      if (m === 'POST' && p === '/api/restaurant/v1/approvals/90/approve') return { request: { id: 90, status: 'approved' } };
      return undefined;
    });
    show(['restaurant', 'orders', '55']);
    fireEvent.click(await screen.findByRole('button', { name: 'Take off or void Chicken kottu' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Guest changed their mind' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Void' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for approval' }));
    await waitFor(() => expect(calls('POST', '/api/restaurant/v1/approvals')).toHaveLength(1));
    expect(calls('POST', '/api/restaurant/v1/approvals')[0]![2]).toMatchObject({ body: { action: 'void', amount: '3600.00', subject_id: 501, reason: 'Guest changed their mind' } });
    fireEvent.change(await screen.findByLabelText('Manager’s PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve with the PIN' }));
    await waitFor(() => expect(voids).toBe(2));
    expect(calls('POST', '/api/restaurant/v1/orders/55/items/501/void')[1]![2]).toMatchObject({ body: { approval_id: 90, reason: 'Guest changed their mind' } });
  });

  it('keeps a takeaway for WorkSuite when it cannot be reached', async () => {
    const down = new ApiError(503, 'Cannot reach WorkSuite server.', 'NETWORK_UNREACHABLE');
    serve((m, p) => (p === '/api/restaurant/v1/pos' || p === '/api/restaurant/v1/options' || p.startsWith('/api/restaurant/v1/menu') ? down : undefined));
    desk['restaurant:status'] = () => status({ reachable: false });
    desk['restaurant:copy'] = () => ({ terminal_id: 7, branch_id: 3, taken_at: '2026-09-30T09:55:00Z', pos: POS, menu: MENU, floor: FLOOR });
    desk['restaurant:outboxAdd'] = (i) => ({ id: 'x', ...(i as object) });
    show(['restaurant'], 'view=order&type=takeaway');
    expect(await screen.findByText(/WorkSuite cannot be reached/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^Chicken kottu/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Mild/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add · / }));
    fireEvent.change(screen.getByLabelText('Customer’s name'), { target: { value: 'Nimal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to the kitchen' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('restaurant:outboxAdd', expect.objectContaining({ op: 'create_order', label: 'Takeaway for Nimal' })));
    const input = vi.mocked(call).mock.calls.find(([c]) => c === 'restaurant:outboxAdd')![1] as { data: { uuid: string; order_type: string; send: boolean; lines: unknown[] } };
    expect(input.data).toMatchObject({ order_type: 'takeaway', send: true, customer_name: 'Nimal' });
    expect(input.data.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls('POST', '/api/restaurant/v1/orders')).toHaveLength(0);
  });
});

describe('Restaurant: the bill and the payment', () => {
  it('takes cash with one idempotency key per attempt, shows the server’s change and opens the drawer', async () => {
    const BILL = { id: 12, number: 'B-0007', order_id: 55, split_mode: 'single', split_mode_label: 'Single', split_index: 1, split_count: 1, status: 'presented', status_label: 'Presented', currency: 'LKR', subtotal: '4500.00', discount_total: '0.00', charge_total: '0.00', tax_total: '0.00', rounding: '0.00', total: '4500.00', paid_total: '0.00', balance: '4500.00', printed_count: 0, version: 2 };
    let tries = 0;
    serve((m, p) => {
      if (m === 'GET' && p === '/api/restaurant/v1/bills/preview') return { order_id: 55, quote: { currency: 'LKR', subtotal: '4500.00', discount_total: '0.00', charge_total: '0.00', tax_total: '0.00', rounding: '0.00', total: '4500.00', prices_include_tax: false, lines: [], charges: [], taxes: [] }, bills: [BILL], stale: false };
      if (m === 'POST' && p === '/api/restaurant/v1/bills/12/payments') {
        tries++;
        return tries === 1 ? new ApiError(503, 'Cannot reach WorkSuite server.', 'NETWORK_UNREACHABLE') : { payments: [], bill: { ...BILL, balance: '0.00' }, change_given: '500.00', open_drawer: true };
      }
      return undefined;
    });
    desk['restaurant:openDrawer'] = () => ({ ok: true, device: 'EPSON', message: 'Drawer opened.' });
    show(['restaurant'], 'view=bill&order=55');
    fireEvent.click(await screen.findByRole('button', { name: 'Take payment' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Cash handed over'), { target: { value: '5000' } });
    expect(within(dialog).getByText(/Change about/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Take / }));
    expect(await within(dialog).findByText('Cannot reach WorkSuite server.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Take / }));
    expect(await screen.findByText('Change: LKR 500.00')).toBeTruthy();
    const [first, second] = calls('POST', '/api/restaurant/v1/bills/12/payments').map(([, , o]) => o as { headers: Record<string, string>; body: unknown });
    expect(first!.headers['Idempotency-Key']).toBe(second!.headers['Idempotency-Key']);
    expect(second!.body).toMatchObject({ tenders: [{ method: 'cash', amount: '5000.00' }], terminal_id: 7 });
    expect(vi.mocked(call)).toHaveBeenCalledWith('restaurant:openDrawer');
  });
});

describe('Restaurant: the kitchen', () => {
  it('shows a station’s tickets by age and colour, ticks a line off and bumps a ticket with its version', async () => {
    const T = { id: 4, number: 'K-0004', kind: 'add', mark: 'ADD', order_id: 55, order_number: '0012', station_id: 5, station_name: 'Grill', status: 'preparing', status_label: 'Preparing', table_label: 'A2', order_type: 'dine_in', course: null, received_at: null, elapsed_minutes: 23, tone: 'late', late: true, print_status: 'failed', version: 6, choices: ['bump'], allergy_warning: 'NUT ALLERGY',
      items: [{ id: 41, order_item_id: 501, name: 'Chicken kottu', variant_name: null, qty: '2.000', modifiers: ['Hot'], notes: 'no onion', seat: 1, course: null, allergens: [], status: 'pending' }] };
    serve((m, p) => {
      if (m === 'GET' && p === '/api/restaurant/v1/kitchen') return { branch_id: 3, station_id: 5, at: '', stations: [{ id: 5, name: 'Grill', kind: 'grill', kds: true, warn_minutes: 10, late_minutes: 20 }], tickets: [T], bumped: [], all_day: [{ name: 'Chicken kottu', variant_name: null, qty: '2.000' }], held: [] };
      if (m === 'POST' && p.startsWith('/api/restaurant/v1/kitchen/tickets/4/')) return { ticket: T };
      return undefined;
    });
    show(['restaurant', 'kitchen'], 'station=5');
    const card = await screen.findByRole('article', { name: 'Ticket K-0004' });
    expect(card.getAttribute('data-tone')).toBe('late');
    expect(card.textContent).toContain('ADD');
    expect(card.textContent).toContain('NUT ALLERGY');
    expect(card.textContent).toContain('Did not print');
    fireEvent.click(within(card).getByRole('button', { name: /Chicken kottu/ }));
    await waitFor(() => expect(calls('POST', '/api/restaurant/v1/kitchen/tickets/4/items/41/done')).toHaveLength(1));
    expect(calls('POST', '/api/restaurant/v1/kitchen/tickets/4/items/41/done')[0]![2]).toMatchObject({ body: { version: 6 } });
    fireEvent.click(within(card).getByRole('button', { name: 'Ready' }));
    await waitFor(() => expect(calls('POST', '/api/restaurant/v1/kitchen/tickets/4/bump')).toHaveLength(1));
    expect(screen.getByRole('region', { name: 'All day' }).textContent).toContain('2');
    expect(calls('GET', '/api/restaurant/v1/kitchen')[0]![2]).toMatchObject({ query: { branch_id: 3, station_id: 5 } });
  });
});

describe('Restaurant: discounts, comps, price overrides, refunds and invoices', () => {
  const MONEY_CAN = { ...OPTIONS, can: { ...OPTIONS.can, discount_apply: true, comp: true, price_override: true, refund: true } };
  const BILL = { id: 12, number: 'B-0007', order_id: 55, split_mode: 'single', split_mode_label: 'Single', split_index: 1, split_count: 1, status: 'paid', status_label: 'Paid', currency: 'LKR', subtotal: '4500.00', discount_total: '0.00', charge_total: '0.00', tax_total: '0.00', rounding: '0.00', total: '4500.00', paid_total: '4500.00', balance: '0.00', printed_count: 1, client_id: null, invoice_id: null, version: 3 };
  const PREVIEW = { order_id: 55, quote: { currency: 'LKR', subtotal: '4500.00', discount_total: '0.00', charge_total: '0.00', tax_total: '0.00', rounding: '0.00', total: '4500.00', prices_include_tax: false, lines: [], charges: [], taxes: [] }, bills: [BILL], stale: false };
  const PAYMENT = { id: 70, bill_id: 12, order_id: 55, method: 'cash', method_label: 'Cash', amount: '4500.00', tendered: '5000.00', change_given: '500.00', currency: 'LKR', status: 'captured', status_label: 'Received', provider_ref: null, refunded_total: '0.00', refund_of_id: null, created_at: null, version: 1 };

  it('discounts a line, asks for approval above the limit and sends it again with the approval’s id', async () => {
    let tries = 0;
    serve((m, p, b) => {
      if (m === 'GET' && p === '/api/restaurant/v1/options') return MONEY_CAN;
      if (m === 'GET' && p === '/api/restaurant/v1/adjustments') return { adjustments: [], kinds: {} };
      if (m === 'POST' && p === '/api/restaurant/v1/adjustments/discount') {
        tries++;
        return (b as { approval_id?: number }).approval_id === 91 ? { adjustment: { id: 5 }, bills_voided: 0, quote: null } : new ApiError(403, 'A 25% discount is above your limit of 10%.', null, { code: 'approval_needed', approval: { action: 'discount', amount: '900.00', pct: 25, order_id: 55, branch_id: 3 } });
      }
      if (m === 'POST' && p === '/api/restaurant/v1/approvals') return { request: { id: 91, status: 'pending' } };
      if (m === 'GET' && p === '/api/restaurant/v1/approvals/91') return { request: { id: 91, status: 'approved', status_label: 'Approved' } };
      return undefined;
    });
    show(['restaurant', 'orders', '55']);
    fireEvent.click(await screen.findByRole('button', { name: 'Discount Chicken kottu' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Percentage off'), { target: { value: '25' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Regular guest' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give the discount' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for approval' }));
    await waitFor(() => expect(tries).toBe(2));
    const [first, second] = calls('POST', '/api/restaurant/v1/adjustments/discount').map(([, , o]) => (o as { body: Record<string, unknown> }).body);
    expect(first).toMatchObject({ order_id: 55, order_item_id: 501, pct: 25, reason: 'Regular guest', terminal_id: 7 });
    expect(first).not.toHaveProperty('approval_id');
    expect(second).toMatchObject({ approval_id: 91, pct: 25 });
    expect(calls('POST', '/api/restaurant/v1/approvals')[0]![2]).toMatchObject({ body: { action: 'discount', amount: '900.00', reason: 'Regular guest' } });
  });

  it('offers no discount, comp or price change without the permission', async () => {
    show(['restaurant', 'orders', '55']);
    expect(await screen.findByRole('button', { name: 'Take off or void Chicken kottu' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Discount Chicken kottu' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make Chicken kottu complimentary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discount the order' })).toBeNull();
  });

  it('makes a line complimentary and overrides a price with a reason', async () => {
    serve((m, p) => {
      if (m === 'GET' && p === '/api/restaurant/v1/options') return MONEY_CAN;
      if (m === 'GET' && p === '/api/restaurant/v1/adjustments') return { adjustments: [{ id: 5, kind: 'comp', kind_label: 'Complimentary item', order_id: 55, order_item_id: 501, bill_id: null, payment_id: null, amount: '3600.00', pct: null, currency: 'LKR', reason: 'Birthday', requested_by_name: 'Kasun', approver_name: null, status: 'applied', removed_at: null, created_at: null }], kinds: {} };
      if (m === 'POST' && (p === '/api/restaurant/v1/adjustments/comp' || p === '/api/restaurant/v1/adjustments/price' || p === '/api/restaurant/v1/adjustments/5/remove')) return { adjustment: { id: 5 } };
      return undefined;
    });
    show(['restaurant', 'orders', '55']);
    fireEvent.click(await screen.findByRole('button', { name: 'Make Chicken kottu complimentary' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Birthday' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make it complimentary' }));
    await waitFor(() => expect(calls('POST', '/api/restaurant/v1/adjustments/comp')).toHaveLength(1));
    expect(calls('POST', '/api/restaurant/v1/adjustments/comp')[0]![2]).toMatchObject({ body: { order_item_id: 501, reason: 'Birthday' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Change the price of Chicken kottu' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('New unit price'), { target: { value: '1500' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Smaller portion' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change the price' }));
    await waitFor(() => expect(calls('POST', '/api/restaurant/v1/adjustments/price')).toHaveLength(1));
    expect(calls('POST', '/api/restaurant/v1/adjustments/price')[0]![2]).toMatchObject({ body: { order_item_id: 501, unit_price: '1500.00', reason: 'Smaller portion' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const list = await screen.findByRole('region', { name: 'Discounts and items on the house' });
    fireEvent.click(within(list).getByRole('button', { name: 'Take back' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Rang in by mistake' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take back' }));
    await waitFor(() => expect(calls('POST', '/api/restaurant/v1/adjustments/5/remove')).toHaveLength(1));
    expect(calls('POST', '/api/restaurant/v1/adjustments/5/remove')[0]![2]).toMatchObject({ body: { reason: 'Rang in by mistake' } });
  });

  it('refunds a payment with one key per attempt and opens the drawer when the server says so', async () => {
    let tries = 0;
    serve((m, p) => {
      if (m === 'GET' && p === '/api/restaurant/v1/options') return MONEY_CAN;
      if (m === 'GET' && p === '/api/restaurant/v1/bills/preview') return PREVIEW;
      if (m === 'GET' && p === '/api/restaurant/v1/payments') return { payments: [PAYMENT] };
      if (m === 'POST' && p === '/api/restaurant/v1/payments/70/refund') {
        tries++;
        return tries === 1 ? new ApiError(503, 'Cannot reach WorkSuite server.', 'NETWORK_UNREACHABLE') : { refund: {}, payment: PAYMENT, open_drawer: true };
      }
      return undefined;
    });
    desk['restaurant:openDrawer'] = () => ({ ok: true, device: 'EPSON', message: 'Drawer opened.' });
    show(['restaurant'], 'view=bill&order=55');
    fireEvent.click(await screen.findByRole('button', { name: 'Refund…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Amount to give back'), { target: { value: '1000' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Cold food' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Refund / }));
    expect(await within(dialog).findByText('Cannot reach WorkSuite server.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Refund / }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('restaurant:openDrawer'));
    const [a, b] = calls('POST', '/api/restaurant/v1/payments/70/refund').map(([, , o]) => o as { headers: Record<string, string>; body: unknown });
    expect(a!.headers['Idempotency-Key']).toBe(b!.headers['Idempotency-Key']);
    expect(b!.body).toMatchObject({ amount: '1000.00', reason: 'Cold food', method: 'cash', terminal_id: 7 });
  });

  it('makes a tax invoice from a bill for a customer looked up at the till', async () => {
    serve((m, p) => {
      if (m === 'GET' && p === '/api/restaurant/v1/bills/preview') return PREVIEW;
      if (m === 'GET' && p === '/api/restaurant/v1/payments') return { payments: [] };
      if (m === 'GET' && p === '/api/restaurant/v1/customers') return { customers: [{ client_id: 88, name: 'Acme Lanka', phone: '07•••••123', email: null, restaurant: true, has_allergies: false, visits: 3 }] };
      if (m === 'POST' && p === '/api/restaurant/v1/bills/12/invoice') return { invoice_id: 400, invoice_number: 'INV-0400', issued: true };
      return undefined;
    });
    show(['restaurant'], 'view=bill&order=55');
    fireEvent.click(await screen.findByRole('button', { name: 'Tax invoice…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Make the invoice' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Customer'), { target: { value: 'Acme' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Acme Lanka/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make the invoice' }));
    await waitFor(() => expect(calls('POST', '/api/restaurant/v1/bills/12/invoice')).toHaveLength(1));
    expect(calls('POST', '/api/restaurant/v1/bills/12/invoice')[0]![2]).toMatchObject({ body: { client_id: 88 } });
  });
});
