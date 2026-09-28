// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';
import type { Org } from '../../../src/modules/expenses/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { ApiError, apiDelete, apiGet, apiPost, apiPut } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const s = await import('../../../src/modules/expenses/suppliers');
const { default: Subscriptions } = await import('../../../src/modules/expenses/Subscriptions');
const { default: Vendors } = await import('../../../src/modules/expenses/Vendors');

/*
 * Vendors and vendor subscriptions, drawn from payloads shaped as the server
 * sends them (SubscriptionController::shape, VendorController::index, the raw
 * claim rows under a subscription) — strings where the database sends strings.
 */

const org = (id: number, name: string, extra: Partial<Org> = {}): Org => ({ id, name, slug: name.toLowerCase(), role: 'admin', member: true, can_act: true, currency: 'LKR', favourite: false, ...extra });
const ORGS = [org(2, 'CreativeFX'), org(3, 'Livezen'), org(4, 'TechHubiz', { role: null, member: false, can_act: false })];

const M365 = {
  id: '5', name: 'Microsoft 365', org_id: '2', org: 'CreativeFX', description: null, vendor: 'Microsoft', vendor_id: '7', category: 'Software', category_id: '3',
  billing_cycle: 'monthly', amount: '1200.00', currency: 'LKR', quantity: '25', charge: '30000.00', monthly_equiv: '30000.00',
  exchange_rate: '1.000000', base_amount: '1200.00', base_currency: 'LKR', start_date: '2026-01-01', end_date: null,
  auto_renew: '0', status: 'active', next_renewal: '2026-10-01', days_until: '3', renews_on: null, renewal_is_set: false, overdue: false, domain_linked: false, domain: null,
};
const AWS = {
  ...M365, id: '6', name: 'AWS', org_id: null, org: null, vendor: 'Amazon', vendor_id: null, category: null, category_id: null,
  amount: '100.00', currency: 'USD', quantity: 1, charge: '100.00', monthly_equiv: '100.00', exchange_rate: '305.500000', base_amount: '30550.00',
  auto_renew: true, next_renewal: '2026-12-01', days_until: 64,
};
const CRM = { ...M365, id: '8', name: 'Old CRM', quantity: '1', charge: '500.00', monthly_equiv: '500.00', amount: '500.00', status: 'paused', next_renewal: null, days_until: null };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const props = { org: '2', orgId: 2, orgs: ORGS, onGo: vi.fn() };

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'] } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    if (path === '/api/expense/subscriptions') return [M365, AWS, CRM];
    if (path === '/api/expense/subscriptions/5') return { subscription: M365, documents: { invoice: '1', payment_receipt: 0, contract: 0, other: 0 } };
    if (path === '/api/expense/subscriptions/5/documents' && query?.kind === 'invoice')
      return { documents: [{ id: '11', kind: 'invoice', title: 'September invoice', amount: '30000.00', currency: 'LKR', document_date: '2026-09-01', reference: 'INV-9', notes: null, uploaded_by: 'Nuwan', created_at: '2026-09-02 10:00:00', has_file: '1', file_name: 'sept.pdf', file_size: '2048' }] };
    if (path === '/api/expense/subscriptions/5/documents') return { documents: [] };
    if (path === '/api/expense/subscriptions/5/expenses') return { items: [], total: 0, sum: '0.00', sum_currency: null, unconverted: 0, shown: 0, scoped: true };
    if (path === '/api/expense/vendors')
      return [
        { id: '7', name: 'Microsoft', contact_person: 'Anne', email: 'anne@ms.example', phone: null, tax_number: 'VAT-1', status: 'active', total_purchases: '125000.50', total_paid: '100000.00', last_transaction: '2026-09-20', claim_count: '3' },
        { id: '9', name: 'Old Printers', contact_person: null, email: null, phone: null, tax_number: null, status: 'archived', total_purchases: '0.00', total_paid: '0.00', last_transaction: null, claim_count: 0 },
      ];
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('suppliers: what arrives, converted once', () => {
  it('reads strings as the numbers and flags they are — "0" is false, and "0" is not an id', () => {
    const m = s.toSub(M365);
    expect(m).toMatchObject({ id: 5, org_id: 2, vendor_id: 7, quantity: 25, auto_renew: false, days_until: 3, overdue: false });
    expect(s.toSub(AWS)).toMatchObject({ org_id: null, auto_renew: true, days_until: 64 });
    expect(s.flag('0')).toBe(false);
    expect(s.flag('1')).toBe(true);
    expect(s.flag(0)).toBe(false);
    expect(s.idOf('0')).toBeNull();
    expect(s.idOf('12')).toBe(12);
    expect(s.toSub({ ...M365, days_until: '-4', overdue: '1' })).toMatchObject({ days_until: -4, overdue: true });
    expect(s.toDoc({ id: '3', has_file: '0', file_size: null })).toMatchObject({ id: 3, has_file: false, file_size: null });
    expect(s.toClaims({ items: [{ id: '4', amount: '10.00' }], total: '1', unconverted: '0' })).toMatchObject({ total: 1, unconverted: 0, items: [{ id: 4 }] });
  });

  it('adds the monthly and annual cost per currency, in cents, and never across currencies', () => {
    const sum = s.summarise([M365, AWS, CRM].map(s.toSub));
    expect(sum.active).toBe(2);
    expect(sum.dueSoon).toBe(1);
    expect(sum.costs).toEqual([
      { currency: 'LKR', monthly: 3_000_000, annual: 36_000_000 },
      { currency: 'USD', monthly: 10_000, annual: 120_000 },
    ]);
  });

  it('lists renewals soonest first, the overdue ones before all of them', () => {
    const late = s.toSub({ ...M365, id: '20', name: 'Late', days_until: '-4', overdue: true });
    const got = s.renewing([...[M365, AWS, CRM].map(s.toSub), late]);
    expect(got.map((x) => x.name)).toEqual(['Late', 'Microsoft 365']);
    expect(s.inDays(0)).toBe('today');
    expect(s.inDays(1)).toBe('tomorrow');
    expect(s.inDays(-4)).toBe('4 days ago');
    expect(s.inDays(12)).toBe('in 12 days');
    expect(s.renewalTone(3)).toBe('red');
    expect(s.renewalTone(20)).toBe('amber');
    expect(s.renewalTone(64)).toBe('grey');
    expect(s.renewalTone(64, true)).toBe('red');
  });

  it('works a converted amount as the server stores it — truncated, never through a float', () => {
    expect(s.mulTruncate('12.34', '305.5')).toBe('3769.87');
    expect(s.mulTruncate('100', '305.555555')).toBe('30555.55');
    expect(s.mulTruncate('1,000.10', '3')).toBe('3000.30');
    expect(s.mulTruncate('abc', '1')).toBeNull();
    expect(s.trimRate('305.500000')).toBe('305.5');
    expect(s.trimRate('1.000000')).toBe('1');
  });

  it('seeds the form from the row, keeping a hand-entered base amount only when it was one', () => {
    const aws = s.toSub(AWS);
    expect(s.seedDraft(aws, 'edit', '2026-09-28')).toMatchObject({ rate: '305.5', baseOverride: '', currency: 'USD', qty: '1' });
    expect(s.seedDraft({ ...aws, base_amount: '31000.00' }, 'edit', '2026-09-28').baseOverride).toBe('31000.00');
    expect(s.seedDraft(s.toSub(M365), 'copy', '2026-09-28')).toMatchObject({ name: 'Microsoft 365 (copy)', vendorId: '7', categoryId: '3', rate: '' });
    expect(s.seedDraft(undefined, 'create', '2026-09-28')).toMatchObject({ start: '2026-09-28', qty: '1', currency: '' });
  });

  it('sends blanks to clear and leaves auto-renew alone on an edit', () => {
    const d = { ...s.seedDraft(s.toSub(M365), 'edit', '2026-09-28'), qty: '', vendorId: '' };
    const edit = s.subBody(d, 'edit', 'LKR');
    expect(edit).toMatchObject({ quantity: '', vendor_id: '', end_date: '', exchange_rate: '1', base_amount: '', currency: 'LKR' });
    expect(edit).not.toHaveProperty('auto_renew');
    expect(s.subBody({ ...d, qty: '3' }, 'create', 'LKR')).toMatchObject({ quantity: 3, auto_renew: true });
    const usd = s.subBody(s.seedDraft(s.toSub(AWS), 'edit', '2026-09-28'), 'edit', 'LKR');
    expect(usd).toMatchObject({ currency: 'USD', exchange_rate: '305.5', base_amount: '' });
    expect(s.draftProblems({ ...d, currency: 'USD', rate: '' }, 'LKR')).toContain('Enter the exchange rate: what 1 USD is in LKR.');
    expect(s.draftProblems({ ...d, amount: '0' }, 'LKR')[0]).toMatch(/amount per cycle/);
  });

  it('offers writes only where the person may act, and says why filing is blocked in their own situation', () => {
    expect(s.mayWriteSub({ org_id: 2 }, ORGS, true)).toBe(true);
    expect(s.mayWriteSub({ org_id: 4 }, ORGS, true)).toBe(false);
    expect(s.mayWriteSub({ org_id: null }, ORGS, true)).toBe(true);
    expect(s.mayWriteSub({ org_id: 2 }, ORGS, false)).toBe(false);
    expect(s.moveTargets(ORGS).map((o) => o.id)).toEqual([2, 3]);
    expect(s.fileBlocked({ subOrgId: 2, subOrg: 'CreativeFX', orgId: 3, several: false, acting: ORGS[1]! })).toBe('This subscription belongs to CreativeFX. Switch to it to file an expense against it.');
    expect(s.fileBlocked({ subOrgId: null, subOrg: null, orgId: 4, several: false, acting: ORGS[2]! })).toMatch(/can read TechHubiz's figures/);
    expect(s.fileBlocked({ subOrgId: null, subOrg: null, orgId: null, several: true, acting: null })).toMatch(/several companies selected/);
    expect(s.fileBlocked({ subOrgId: 2, subOrg: 'CreativeFX', orgId: 2, several: false, acting: ORGS[0]! })).toBeNull();
    expect(s.claimPreset(s.toSub(M365))).toEqual({ subscription_id: 5, category_id: 3, vendor_id: 7, amount: '30000.00', currency: 'LKR', description: 'Microsoft 365' });
    expect(s.currencyChoices('LKR', 'usd').slice(0, 3)).toEqual(['LKR', 'USD', 'EUR']);
  });

  it('says what filing a receipt did to the renewal', () => {
    const m = s.toSub(M365);
    expect(s.filedSentence({ renewal: { to: '2026-11-01' } }, 'payment_receipt', m, (d) => `[${d}]`)).toBe('Filed. The next renewal moved to [2026-11-01].');
    expect(s.filedSentence({ renewal: null }, 'payment_receipt', { ...m, domain_linked: true, domain: null }, (d) => d)).toMatch(/follows its domain's expiry/);
    expect(s.filedSentence({}, 'invoice', m, (d) => d)).toBe('Filed.');
  });
});

describe('suppliers: the screens', () => {
  it('shows a renewal due soon, leading with the days, and the costs one currency to a line', async () => {
    const onGo = vi.fn();
    wrap(<Subscriptions {...props} onGo={onGo} openSub={null} />);
    const panel = (await screen.findByText('Upcoming renewals')).closest('section')!;
    const soon = within(panel).getByRole('button', { name: /Microsoft 365/ });
    expect(within(soon).getByText('3')).toBeTruthy();
    expect(within(soon).getByText('days')).toBeTruthy();
    expect(within(soon).getByText(/1 Oct 2026, in 3 days/)).toBeTruthy();
    expect(within(soon).getByText('will not auto-renew')).toBeTruthy();
    // AWS renews in 64 days: not "soon".
    expect(within(panel).queryByText('AWS')).toBeNull();
    // Monthly: LKR and USD apart. Annual: twelve of each.
    expect(screen.getByText('LKR 360,000.00')).toBeTruthy();
    expect(screen.getByText('USD 1,200.00')).toBeTruthy();
    expect(screen.getByText('One line per currency — not added across them')).toBeTruthy();
    // A subscription in no company says so.
    expect(screen.getByText('Every company')).toBeTruthy();
    fireEvent.click(soon);
    expect(onGo).toHaveBeenCalledWith('subs', '&sub=5');
  });

  it('reads this company by default, and every company only when asked', async () => {
    wrap(<Subscriptions {...props} openSub={null} />);
    await screen.findByText('Upcoming renewals');
    expect(apiGet).toHaveBeenCalledWith('/api/expense/subscriptions', { org: '2' }, expect.anything());
    expect(screen.getByText(/Showing CreativeFX, and those that belong to every company/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'All my companies' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/expense/subscriptions', undefined, expect.anything()));
    expect(screen.getByText(/Showing every company you belong to/)).toBeTruthy();
  });

  it('opens a filed invoice through the desktop, and files a new one as a form upload', async () => {
    vi.mocked(call).mockResolvedValue({ id: 't1' } as never);
    vi.mocked(apiPost).mockResolvedValue({ id: 12, renewal: null });
    wrap(<Subscriptions {...props} openSub={5} />);
    const drawer = await screen.findByRole('complementary', { name: 'Subscription Microsoft 365' });
    fireEvent.click(await within(drawer).findByRole('tab', { name: 'Invoices · 1' }));
    await within(drawer).findByText('September invoice');
    fireEvent.click(within(drawer).getByRole('button', { name: /Open/ }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { expenseFile: { kind: 'sub-document', sub: 5, doc: 11 }, name: 'sept.pdf', open: true }));

    fireEvent.click(within(drawer).getByRole('button', { name: /Add invoice/ }));
    const sheet = screen.getByRole('dialog', { name: 'Add invoice' });
    const file = new File(['%PDF'], 'October invoice.pdf', { type: 'application/pdf' });
    fireEvent.change(within(sheet).getByLabelText('Choose a file'), { target: { files: [file] } });
    expect((within(sheet).getByDisplayValue('October invoice') as HTMLInputElement).value).toBe('October invoice');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/expense/subscriptions/5/documents', expect.any(FormData), { org: 2 }));
    const body = vi.mocked(apiPost).mock.calls[0]![1] as FormData;
    expect(body.get('kind')).toBe('invoice');
    expect(body.get('title')).toBe('October invoice');
    expect((body.get('file') as File).name).toBe('October invoice.pdf');
    expect(body.get('amount')).toBeNull();
  });

  it('moves a subscription to another company only once the move is confirmed', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 5, org_id: 3, org: 'Livezen' });
    wrap(<Subscriptions {...props} openSub={5} />);
    const drawer = await screen.findByRole('complementary', { name: 'Subscription Microsoft 365' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Change' }));
    const sheet = screen.getByRole('dialog', { name: 'Move subscription' });
    fireEvent.click(within(sheet).getByRole('combobox', { name: 'Company' }));
    // Only companies this person may act in: TechHubiz is read-only for them.
    expect(screen.queryByRole('option', { name: /TechHubiz/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Livezen/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Move…' }));
    const confirm = screen.getByRole('dialog', { name: 'Move Microsoft 365?' });
    expect(within(confirm).getByText(/rather than CreativeFX’s/)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/expense/subscriptions/5/move', { org_id: 3 }));
  });

  it('corrects a foreign amount in place without losing the booked rate', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/expense/subscriptions') return [AWS];
      if (path === '/api/expense/subscriptions/6') return { subscription: AWS, documents: {} };
      throw new Error(`unexpected ${path}`);
    });
    vi.mocked(apiPut).mockResolvedValue({ id: 6 });
    wrap(<Subscriptions {...props} openSub={6} />);
    const drawer = await screen.findByRole('complementary', { name: 'Subscription AWS' });
    fireEvent.click(within(drawer).getByTitle('Edit amount'));
    const box = within(drawer).getByLabelText('Amount');
    fireEvent.change(box, { target: { value: '120.00' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    // A subscription in no company is written in the company on screen.
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/expense/subscriptions/6?org=2', { amount: '120.00', exchange_rate: '305.500000' }));
    expect(apiPut).toHaveBeenCalledTimes(1);
  });

  it('lists vendors with this company’s figures, and shows the server’s refusal to delete one in use', async () => {
    vi.mocked(apiDelete).mockRejectedValue(new ApiError(409, '3 claim(s) reference this vendor. Archive it instead, so the history keeps its meaning.', null));
    wrap(<Vendors {...props} />);
    const card = await screen.findByRole('region', { name: 'Microsoft' });
    expect(apiGet).toHaveBeenCalledWith('/api/expense/vendors', { org: 2 }, expect.anything());
    expect(within(card).getByText('125,000.50')).toBeTruthy();
    expect(within(card).getByText('Anne · anne@ms.example')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Old Printers' })).getByText('Restore')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete Microsoft?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await within(confirm).findByText(/3 claim\(s\) reference this vendor/);
    expect(apiDelete).toHaveBeenCalledWith('/api/expense/vendors/7?org=2');
  });
});
