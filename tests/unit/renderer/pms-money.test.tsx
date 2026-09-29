// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => true), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['pms'] as string[], go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: '/pms', active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGetMeta, request, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { default: PmsShell } = await import('../../../src/modules/pms/PmsShell');
// The shell's screens are lazy chunks: loaded once here, so a first render does not race their transform.
await Promise.all(['Folio', 'Cashier', 'NightAudit', 'Rack'].map((m) => import(`../../../src/modules/pms/${m}.tsx`)));

const PROPERTY = { id: 1, org_id: 3, code: 'LAG', name: 'Lagoon Hotel', status: 'active', status_label: 'Active', currency: 'LKR', timezone: 'Asia/Colombo', check_in_time: '14:00', check_out_time: '12:00', business_date: '2026-09-18' };
const BD = { business_date: '2026-09-18', status: 'open', status_label: 'Open', calendar_date: '2026-09-19', days_behind: 1, night_audit_time: '01:00', timezone: 'Asia/Colombo', last_closed: '2026-09-17' };
const options = (permissions: string[]) => ({
  org_id: 3, permissions, scope: 'all', properties: [PROPERTY], business_date: BD, reservation_statuses: [], room_display: [], housekeeping_statuses: [], service_statuses: [], outage_kinds: [], night_audit_steps: [],
  booking_types: [], guarantees: [], vip_levels: [], document_kinds: [], sources: [],
});

const item = (id: number, description: string, over: Record<string, unknown> = {}) => ({
  id, folio_id: 5, item_type: 'charge', item_type_label: 'Charge', service_id: 3, package_id: null, night_id: null, description, quantity: '1', unit_price: '900.00', amount: '900.00', tax_amount: '162.00', total: '1062.00', currency: 'LKR',
  taxes: [{ name: 'VAT 18%', amount: '162.00' }], business_date: '2026-09-18', source: 'front_desk', source_ref: null, parent_item_id: null, routed_from_folio_id: null, is_void: false, void_reason: null, voided_at: null,
  terminal: 'Desk 1', cashier_session_id: 2, posted_by: 'Kasun', posted_at: '2026-09-18 09:00:00', locked: false, ...over,
});
const FOLIO = {
  id: 5, folio_no: 'FLAG-000005', property_id: 1, reservation_id: 40, stay_id: 90, label: 'Guest', payee_type: 'guest', payee_client_id: 70, payee_name: 'Nimal Perera', status: 'open', status_label: 'Open', balance: '26062.00', currency: 'LKR',
  opened_business_date: '2026-09-16', settled_at: null, closed_at: null, invoice_id: null, receipt_no: null, ar_reference: null, version: 3,
  items: [item(1, 'Room 102', { item_type: 'room', item_type_label: 'Room', source: 'night_audit', locked: true, amount: '25000.00', tax_amount: '0.00', total: '25000.00' }), item(2, 'Laundry')],
  payments: [], totals: { charges: '25900.00', taxes: '162.00', payments: '0.00', refunds: '0.00', balance: '26062.00' }, tax_summary: [{ name: 'VAT 18%', amount: '162.00' }],
  options: [],
};

type Route = (path: string) => unknown;
let extra: Route = () => undefined;
let perms: string[] = [];

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PmsShell tabId="t1" route="/pms" active />
    </QueryClientProvider>,
  );
const posted = () => vi.mocked(request).mock.calls.map(([method, path, o]) => ({ method, path, body: (o as { body?: Record<string, unknown> })?.body, headers: (o as { headers?: Record<string, string> })?.headers }));
const ok = (data: unknown, message = 'Done.') => ({ data, offline: false, cachedAt: null, message });

beforeEach(() => {
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(call).mockClear();
  vi.mocked(apiGetMeta).mockImplementation(async (path: string) => {
    const data = path === '/api/pms/v1/properties' ? { items: [PROPERTY] } : path === '/api/pms/v1/options' ? options(perms) : extra(path);
    if (data === undefined) return new Promise(() => undefined);
    return { data, offline: false, cachedAt: null };
  });
  tab.query = new URLSearchParams();
  tab.path = ['pms'];
  tab.go = vi.fn();
  app.set({ status: null });
});
afterEach(cleanup);

describe('a folio (§10.1–10.3)', () => {
  beforeEach(() => {
    tab.path = ['pms', 'folios', '5'];
    extra = (p) => (p === '/api/pms/v1/folios/5' ? { folio: FOLIO } : p === '/api/pms/v1/properties/1/services' ? { items: [{ id: 3, code: 'LAUNDRY', name: 'Laundry', department: 'housekeeping', charge_type: 'laundry', default_price: '900.00', currency: 'LKR', active: true }] } : p === '/api/pms/v1/properties/1/cashier-sessions' ? { items: [], mine: null } : undefined);
  });

  it('posts a charge once — its key travels with it — and shows the lines and taxes the server keeps', async () => {
    perms = ['pms.access', 'pms.folio.view', 'pms.folio.post', 'pms.folio.void', 'pms.payment.view'];
    vi.mocked(request).mockResolvedValueOnce(ok({ item: {}, folio_id: 5, balance: '27124.00', replayed: false }, 'Laundry posted.'));
    show();
    expect(await screen.findByText('Room 102')).toBeTruthy();
    expect(screen.getAllByText('VAT 18%').length).toBeGreaterThan(0);
    // A closed day's line is locked: it cannot be voided; today's can.
    const rows = screen.getAllByRole('row');
    expect(within(rows.find((r) => r.textContent?.includes('Room 102'))!).queryByRole('button', { name: 'Void' })).toBeNull();
    expect(within(rows.find((r) => r.textContent?.includes('Laundry'))!).getByRole('button', { name: 'Void' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Post charge' }));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Charge' }));
    fireEvent.click(screen.getByRole('option', { name: /Laundry/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Post charge' }));
    await waitFor(() => expect(posted().some((c) => c.path === '/api/pms/v1/folios/5/charges')).toBe(true));
    const c = posted().find((x) => x.path === '/api/pms/v1/folios/5/charges')!;
    expect(c.body).toEqual({ service_code: 'LAUNDRY', quantity: '1' });
    expect(c.headers?.['Idempotency-Key']).toMatch(/^charge-/);
    // No payment button for someone who may not take money.
    expect(screen.queryByRole('button', { name: 'Take payment' })).toBeNull();
  });

  it('takes a card payment with the slip’s reference and last four digits — never a card number', async () => {
    perms = ['pms.access', 'pms.folio.view', 'pms.payment.process', 'pms.payment.view'];
    vi.mocked(request).mockResolvedValueOnce(ok({ id: 77, payment: {}, replayed: false }, 'Payment taken.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Take payment' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('26062.00');
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Method' }));
    fireEvent.click(screen.getByRole('option', { name: 'Credit / debit card' }));
    fireEvent.change(within(dialog).getByLabelText('Last four digits'), { target: { value: '4242 1234' } });
    expect((within(dialog).getByLabelText('Last four digits') as HTMLInputElement).value).toBe('4242');
    fireEvent.change(within(dialog).getByLabelText('Reference'), { target: { value: 'APPR-991' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take payment' }));
    await waitFor(() => expect(posted().some((c) => c.path === '/api/pms/v1/folios/5/payments')).toBe(true));
    const p = posted().find((x) => x.path === '/api/pms/v1/folios/5/payments')!;
    expect(p.body).toMatchObject({ method: 'card', amount: '26062.00', currency: 'LKR', card_last4: '4242', provider_ref: 'APPR-991', terminal: 'Front desk' });
    expect(p.headers?.['Idempotency-Key']).toMatch(/^payment-/);
  });

  it('waits for WorkSuite before any money moves (PMS-DSK-003)', async () => {
    perms = ['pms.access', 'pms.folio.view', 'pms.folio.post', 'pms.payment.process'];
    app.set({ status: { network: 'OFFLINE' } as never });
    show();
    expect(((await screen.findByRole('button', { name: 'Take payment' })) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Post charge' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says who may do it when a void is over the limit', async () => {
    perms = ['pms.access', 'pms.folio.view', 'pms.folio.void'];
    vi.mocked(request).mockRejectedValueOnce(new ApiError(403, 'Voiding 1,062.00 is above your limit.', null, { code: 'over_limit' }));
    show();
    await screen.findByText('Laundry');
    fireEvent.click(screen.getByRole('button', { name: 'Void' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Posted twice' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Void' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Voiding 1,062.00 is above your limit. Someone who manages Hotel PMS settings can do it.');
  });
});

describe('the cashier (§10.7)', () => {
  it('opens a shift at this terminal, then closes it by counting the drawer', async () => {
    perms = ['pms.access', 'pms.cashier.open', 'pms.cashier.close', 'pms.payment.view'];
    tab.query = new URLSearchParams('view=cashier');
    let mine: unknown = null;
    extra = (p) => (p === '/api/pms/v1/properties/1/cashier-sessions' ? { items: mine ? [mine] : [], mine } : undefined);
    vi.mocked(request).mockImplementation(async (_m: string, path: string) => {
      if (path === '/api/pms/v1/properties/1/cashier-sessions') {
        mine = { id: 2, property_id: 1, user_id: 9, cashier: 'Kasun', terminal: 'Desk 1', status: 'open', status_label: 'Open', business_date: '2026-09-18', opened_at: '2026-09-18 06:00:00', closed_at: null, opening_cash: '10000.00', counted_cash: null, expected_cash: '12500.00', variance: null, variance_reason: null, approved_by: null, approved_at: null, currency: 'LKR', totals: { cash_in: '2500.00', cash_out: '0.00', postings: 1, count: 1, methods: [{ method: 'cash', label: 'Cash', in: '2500.00', out: '0.00', count: 1 }] } };
        return ok({ id: 2, session: mine }, 'Shift opened.');
      }
      if (path === '/api/pms/v1/cashier-sessions/2/close') return ok({ shift_status: 'closed', variance: '-200.00', needs_approval: true, session: mine }, 'Shift closed.');
      throw new Error(path);
    });
    show();
    fireEvent.change(await screen.findByLabelText('Terminal'), { target: { value: 'Desk 1' } });
    fireEvent.change(screen.getByLabelText('Opening cash'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(await screen.findByText('LKR 12,500.00')).toBeTruthy();
    expect(posted()[0]).toMatchObject({ path: '/api/pms/v1/properties/1/cashier-sessions', body: { terminal: 'Desk 1', opening_cash: '10000' } });
    fireEvent.change(screen.getByLabelText('Cash counted'), { target: { value: '12300.00' } });
    fireEvent.change(screen.getByLabelText('Why it differs'), { target: { value: 'Change given twice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close shift' }));
    expect(await screen.findByText(/someone else approves it/)).toBeTruthy();
    expect(posted()[1]).toMatchObject({ path: '/api/pms/v1/cashier-sessions/2/close', body: { counted_cash: '12300.00', reason: 'Change given twice' } });
  });
});

const AUDIT = (over: Record<string, unknown> = {}) => ({
  business_date: BD,
  audit: { id: 12, property_id: 1, business_date: '2026-09-18', status: 'pending', status_label: 'Not started', current_step: null, attempts: 0, started_by: null, started_at: null, completed_at: null, failed_at: null, failure: null, steps: [{ key: 'validate_arrivals', label: 'Validate arrivals', done: false, failed: false, result: null }, { key: 'post_taxes', label: 'Post taxes', done: false, failed: false, result: null }], report: null },
  blockers: [{ id: 31, kind: 'unpaid_folio', kind_label: 'Unpaid folios', ref_type: 'folio', ref_id: 5, text: 'Folio FLAG-000005 (Guest) owes LKR 26,062.00', status: 'open', reason: null, resolved_by: null, resolved_at: null }],
  checks: [{ kind: 'arrival', label: 'Arrivals not checked in', open: 0, overridden: 0 }, { kind: 'unpaid_folio', label: 'Unpaid folios', open: 1, overridden: 0 }],
  can_start: false,
  history: [],
  ...over,
});

describe('the night audit (§13.1, AC-10, AC-11)', () => {
  it('lists what blocks the close with a link to it; the GM overrides it with a reason; Run waits until nothing is open', async () => {
    perms = ['pms.access', 'pms.night_audit.execute', 'pms.night_audit.override', 'pms.folio.view'];
    tab.query = new URLSearchParams('view=audit');
    extra = (p) => (p === '/api/pms/v1/properties/1/night-audit' ? AUDIT() : undefined);
    vi.mocked(request).mockResolvedValueOnce(ok({}, 'Overridden.'));
    show();
    expect(await screen.findByText('Folio FLAG-000005 (Guest) owes LKR 26,062.00')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run the night audit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(tab.go).toHaveBeenCalledWith('/pms/folios/5');
    fireEvent.click(screen.getByRole('button', { name: 'Override' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Company pays on Monday; confirmed by the GM' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Override' }));
    await waitFor(() => expect(posted()[0]).toMatchObject({ path: '/api/pms/v1/night-audit-blockers/31/override', body: { reason: 'Company pays on Monday; confirmed by the GM' } }));
  });

  it('shows a failed step in the server’s words and offers to resume from it', async () => {
    perms = ['pms.access', 'pms.night_audit.execute'];
    tab.query = new URLSearchParams('view=audit');
    const failed = AUDIT({ can_start: true, blockers: [], audit: { ...AUDIT().audit, status: 'failed', status_label: 'Failed', current_step: 'post_taxes', attempts: 1, failure: 'Billing tax rate 4 is inactive.', steps: [{ key: 'validate_arrivals', label: 'Validate arrivals', done: true, failed: false, result: null }, { key: 'post_taxes', label: 'Post taxes', done: false, failed: true, result: null }] } });
    extra = (p) => (p === '/api/pms/v1/properties/1/night-audit' ? failed : undefined);
    vi.mocked(request).mockRejectedValueOnce(new ApiError(500, 'The step "Post taxes" failed: Billing tax rate 4 is inactive.', null, { code: 'step_failed', step: 'post_taxes' }));
    show();
    expect(await screen.findByText('Billing tax rate 4 is inactive.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume the audit' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The step "Post taxes" failed');
    expect(alert.textContent).toContain('carries on from that step');
    expect(posted()[0]!.path).toBe('/api/pms/v1/properties/1/night-audit/run');
  });

  it('is not there for someone without the night audit', async () => {
    perms = ['pms.access', 'pms.room.view'];
    extra = (p) => (p === '/api/pms/v1/properties/1/rack' ? { property_id: 1, business_date: '2026-09-18', rooms: [], floors: [], counts: {}, legend: [], room_types: [], lists: {}, server_time: '' } : undefined);
    show();
    const rail = await screen.findByRole('navigation', { name: 'Hotel PMS' });
    expect(rail.textContent).not.toContain('Night audit');
  });
});
