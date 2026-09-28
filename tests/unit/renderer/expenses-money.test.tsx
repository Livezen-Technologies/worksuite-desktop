// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';
import type { Org } from '../../../src/modules/expenses/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const M = await import('../../../src/modules/expenses/money');
const { default: Cards } = await import('../../../src/modules/expenses/Cards');
const { default: Reimburse } = await import('../../../src/modules/expenses/Reimburse');
const { default: Petty } = await import('../../../src/modules/expenses/Petty');

/*
 * Money going out — cards, runs, the accounting export, petty cash — drawn
 * from payloads shaped as the server sends them (Cards, Reimbursements,
 * Postings, PettyCashController), every count and flag a string as MySQL
 * hands it back, to prove the screens say what matters without a server.
 */

const org: Org = { id: 3, name: 'CreativeFX', slug: 'cfx', role: 'finance', member: true, can_act: true, currency: 'LKR', favourite: false };
const props = { org: '3', orgId: 3, orgs: [org], onGo: vi.fn() };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const said = (message: string | null, data: unknown = null) => ({ data, offline: false, cachedAt: null, message });

const FUND_DETAIL = {
  id: 5,
  name: 'Front desk',
  custodian: 'Amali Silva',
  currency: 'LKR',
  status: 'open',
  balance: '3250.00',
  float: { balance: '3250.00', max: '10000.00', min: '2000.00', low: false, suggested: '6750.00' },
  has_opening: true,
  transactions: [
    { id: 2, txn_type: 'out', amount: '1750.00', category: null, description: 'Courier', txn_date: '2026-09-21' },
    { id: 1, txn_type: 'opening', amount: '5000.00', category: null, description: 'Opening float', txn_date: '2026-09-01' },
  ],
  reconciliations: [{ id: 1, counted: '4900.00', computed: '5000.00', variance: '-100.00', note: 'Short after the fair', at: '2026-09-10 17:00:00' }],
};

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'] } as never });
  vi.mocked(call).mockResolvedValue(undefined as never);
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/expense/cards')
      return {
        currency: 'LKR',
        note: 'Statements are imported from a CSV your bank provides.',
        items: [{ id: '4', label: 'Travel Visa', brand: 'visa', last4: '4242', status: 'active', holder: 'Nimal Perera', holder_user_id: '9', currency: 'LKR', credit_limit: '500000.00', statement_day: '25', expires_on: null, transactions: '12', unmatched: '1', unmatched_value: '1250.00' }],
      };
    if (path === '/api/expense/card-transactions')
      return {
        currency: 'LKR',
        total: '1',
        page: 1,
        per_page: 50,
        summary: { total: '12', unmatched: '1', unmatched_value: '1250.00', value: '50000.00' },
        items: [{ id: '31', card_id: '4', txn_date: '2026-09-20', merchant: 'KEELLS SUPER', amount: '1250.00', currency: 'LKR', reference: 'REF-889', status: 'unmatched', claim_id: null, claim_no: null, match_kind: null, card: 'Travel Visa', last4: '4242', description: null }],
      };
    if (path === '/api/expense/card-transactions/31/suggest')
      return { items: [{ id: '77', claim_no: 'EXP-2026-0077', spent_on: '2026-09-20', amount: '1250.00', currency: 'LKR', description: 'Groceries for the offsite', status: 'approved', claimant: 'Nimal Perera', vendor: null, score: '130', why: 'the amount is exactly the same, the same day' }] };
    if (path === '/api/expense/payable')
      return {
        currency: 'LKR',
        total: '1350.05',
        people: [
          {
            user_id: '9',
            name: 'Nimal Perera',
            email: 'nimal@example.com',
            total: '1350.05',
            count: 2,
            advance_outstanding: '5000.00',
            claims: [
              { id: '101', claim_no: 'EXP-101', user_id: '9', base_amount: '1250.10', spent_on: '2026-09-02', description: 'Taxi to the airport', status: 'approved', category: 'Travel' },
              { id: '102', claim_no: 'EXP-102', user_id: '9', base_amount: '99.95', spent_on: '2026-09-03', description: 'Parking', status: 'approved', category: 'Travel' },
            ],
          },
        ],
      };
    if (path === '/api/expense/runs')
      return { currency: 'LKR', items: [{ id: '8', reference: 'PR-2026-0008', method: 'bank_transfer', currency: 'LKR', total: '48250.50', claim_count: '3', status: 'draft', txn_reference: null, receipt_token: null, receipt_name: null, paid_at: null, created_name: 'Kasun' }] };
    if (path === '/api/expense/payment-methods') return { items: ['bank_transfer', 'cash', 'payroll', 'cheque', 'mobile_wallet'] };
    if (path === '/api/expense/postings')
      return {
        currency: 'LKR',
        note: 'This product has no general ledger.',
        items: [
          { id: '12', reference: 'EXP-JNL-0012', period_start: '2026-09-01', period_end: '2026-09-28', currency: 'LKR', total_debit: '1350.05', total_credit: '1350.05', line_count: '4', claim_count: '2', balanced: '1', status: 'draft' },
          { id: '11', reference: 'EXP-JNL-0011', period_start: '2026-08-01', period_end: '2026-08-31', currency: 'LKR', total_debit: '100.00', total_credit: '99.99', line_count: '2', claim_count: '1', balanced: '0', status: 'draft' },
        ],
      };
    if (path === '/api/expense/petty-cash') return [{ ...FUND_DETAIL, transactions: undefined, reconciliations: undefined, has_opening: undefined }];
    if (path === '/api/expense/petty-cash/5') return FUND_DETAIL;
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('money out — the pure part', () => {
  it('reads MySQL’s strings once: "0" is false, counts are numbers', () => {
    expect(M.flag('0')).toBe(false);
    expect(M.flag('1')).toBe(true);
    expect(M.int('12')).toBe(12);
    expect(M.int(null)).toBe(0);
    const p = M.toPosting({ id: '11', balanced: '0', line_count: '2', total_debit: '100.00', total_credit: '99.99', status: 'draft' });
    expect(p.balanced).toBe(false);
    expect(p.line_count).toBe(2);
    expect(M.voidable(p)).toBe(true);
    expect(M.voidable({ status: 'exported' })).toBe(false);
    expect(M.runOpen({ status: 'draft' })).toBe(true);
    expect(M.runOpen({ status: 'paid' })).toBe(false);
  });

  it('sums money in cents, never through a float', () => {
    expect(M.sumCents(['1250.10', '99.95'])).toBe(135005);
    expect(M.sumCents(['0.1', '0.2'])).toBe(30);
    expect(M.sumCents(['12', 'abc'])).toBeNull();
    expect(M.signedCents('-1250.00')).toBe(-125000);
    expect(M.centsMoney(135005, 'LKR')).toBe('LKR 1,350.05');
  });

  it('an edit to a card carries what is stored, so a save does not unassign it', () => {
    const c = M.toCard({ id: '4', label: 'Travel Visa', holder_user_id: '9', credit_limit: '500000.00', statement_day: '25', currency: 'LKR', unmatched: '0' });
    expect(c.keep).toEqual({ holder_user_id: 9, currency: 'LKR', credit_limit: '500000.00', statement_day: 25, expires_on: null });
    expect(c.unmatched).toBe(0);
    expect(M.isRefund({ amount: '-40.00' })).toBe(true);
  });

  it('says the fund’s rules while the amount is typed, in the server’s words', () => {
    const f = { balance: '3250.00', float: { max: '10000.00', min: '2000.00', low: false, suggested: '6750.00' } };
    expect(M.spendProblem('out', '4000', f.balance)).toBe('That is more than the fund holds — you cannot spend cash the tin does not have');
    expect(M.spendProblem('in', '4000', f.balance)).toBeNull();
    expect(M.spendProblem('out', '0', f.balance)).toBe('Enter a valid amount greater than zero');
    expect(M.refillProblem('7000', f)).toBe('That would put the fund above its maximum float of 10000.00');
    expect(M.refillProblem('6750', f)).toBeNull();
    expect(M.suggestedRefill(f)).toBe('6750.00');
    expect(M.countDifference('3000', '3250.00')).toBe(-25000);
    expect(M.countDifference('3,250', '3250.00')).toBe(0);
    expect(M.countDifference('3.555', '3250.00')).toBeNull();
    expect(M.varianceWords(-25000, 'LKR')).toBe('LKR 250.00 short');
    expect(M.varianceWords(1500, 'LKR')).toBe('LKR 15.00 more than the book');
    expect(M.varianceWords(0, 'LKR')).toMatch(/No difference/);
  });

  it('asks the company’s role the way the server does', () => {
    expect(M.atLeast(org, 'finance')).toBe(true);
    expect(M.atLeast({ ...org, role: 'member' }, 'finance')).toBe(false);
    expect(M.atLeast({ ...org, role: 'member' }, 'member')).toBe(true);
    // Acting with no membership is the super-admin grant.
    expect(M.atLeast({ ...org, role: null, member: false, can_act: true }, 'admin')).toBe(true);
    // Consolidated reading is not acting.
    expect(M.atLeast({ ...org, can_act: false }, 'member')).toBe(false);
    expect(M.fileName('PR/2026:8', 'csv')).toBe('PR-2026-8.csv');
    expect(M.monthStart('2026-09-28')).toBe('2026-09-01');
  });
});

describe('corporate cards', () => {
  it('shows an unmatched line, its suggestions with their reasons, and matches one', async () => {
    vi.mocked(request).mockResolvedValue(said('Matched.'));
    wrap(<Cards {...props} />);
    await screen.findByText('KEELLS SUPER');
    expect(screen.getByText('LKR 1,250.00 nobody has explained')).toBeTruthy();
    expect(within(screen.getByText('KEELLS SUPER').closest('div')!).getByText('Unmatched')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/expense/card-transactions', expect.objectContaining({ org: 3, status: 'unmatched', page: 1, per_page: 50 }), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Match' }));
    const panel = await screen.findByRole('complementary', { name: 'Match a card line' });
    await within(panel).findByText('Groceries for the offsite');
    expect(within(panel).getByText('The amount is exactly the same, the same day')).toBeTruthy();
    expect(within(panel).getByText('EXP-2026-0077')).toBeTruthy();
    expect(within(panel).getByText(/set it aside/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Match' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/expense/card-transactions/31/match', { query: { org: 3 }, body: { claim_id: 77 } }));
  });

  it('a card with nobody holding it, and its unmatched value, on the Cards tab', async () => {
    wrap(<Cards {...props} />);
    await screen.findByText('KEELLS SUPER');
    fireEvent.click(screen.getByRole('tab', { name: 'Cards' }));
    expect(await screen.findByText('Travel Visa')).toBeTruthy();
    expect(screen.getByText('1 · LKR 1,250.00')).toBeTruthy();
    expect(screen.getByText('Statements are imported from a CSV your bank provides.')).toBeTruthy();
  });

  it('offers nothing to change to somebody whose role in the company is not finance', async () => {
    wrap(<Cards {...props} orgs={[{ ...org, role: 'member' }]} />);
    await screen.findByText('KEELLS SUPER');
    expect(screen.queryByRole('button', { name: 'Match' })).toBeNull();
    expect(screen.queryByText('Add a card')).toBeNull();
  });
});

describe('reimbursements', () => {
  it('adds the picked claims up in cents, and says what building a run does', async () => {
    wrap(<Reimburse {...props} mode="runs" />);
    await screen.findByText('Nimal Perera');
    expect(screen.getByText('also holds LKR 5,000.00 in unsettled advances')).toBeTruthy();
    expect(screen.getByText('2 claims across 1 person')).toBeTruthy();
    fireEvent.click(screen.getByText('Select everything'));
    fireEvent.click(screen.getByText(/Build a run of 2/));
    const sheet = await screen.findByRole('dialog', { name: 'Build a payment run' });
    // 1250.10 + 99.95 is 1350.05 in cents; through a float it is 1350.0499999999997.
    expect(within(sheet).getByText('LKR 1,350.05')).toBeTruthy();
    expect(within(sheet).getByText(/Nothing is paid by building it/)).toBeTruthy();
  });

  it('confirms paying a run with what it means, then records it', async () => {
    vi.mocked(request).mockResolvedValue(said('Run PR-2026-0008 marked paid. 3 claim(s) are now reimbursed.'));
    wrap(<Reimburse {...props} mode="runs" />);
    await screen.findByText('PR-2026-0008');
    expect(screen.getByText('LKR 48,250.50')).toBeTruthy();
    fireEvent.click(screen.getByText('Mark paid'));
    const sheet = await screen.findByRole('dialog', { name: 'Record PR-2026-0008 as paid' });
    expect(within(sheet).getByText('LKR 48,250.50')).toBeTruthy();
    expect(within(sheet).getByText(/3 claims,/)).toBeTruthy();
    expect(within(sheet).getByText(/no money moves through this software\. Every claim in the run becomes paid\./)).toBeTruthy();
    fireEvent.click(within(sheet).getByText('It has been paid'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/expense/runs/8/pay', { query: { org: 3 }, body: { txn_reference: null, receipt_file_id: null } }));
  });

  it('downloads a run’s bank file through the main process, in its company', async () => {
    wrap(<Reimburse {...props} mode="runs" />);
    await screen.findByText('PR-2026-0008');
    fireEvent.click(screen.getByRole('button', { name: 'Download the payment list for PR-2026-0008' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { expenseFile: { kind: 'run-csv', run: 8, org: 3 }, name: 'PR-2026-0008.csv' }));
    expect(screen.getByText(/generic list, not any one bank/)).toBeTruthy();
  });

  it('hides paying from somebody without expense.pay', async () => {
    app.set({ bootstrap: { permissions: ['expense.view'] } as never });
    wrap(<Reimburse {...props} mode="runs" />);
    await screen.findByText('PR-2026-0008');
    expect(screen.queryByText('Mark paid')).toBeNull();
    expect(screen.queryByText('Select everything')).toBeNull();
  });
});

describe('the accounting export', () => {
  it('says which batch does not balance, exports only the one that does, and confirms a void', async () => {
    vi.mocked(request).mockResolvedValue(said('Batch voided. Its claims are available to batch again.'));
    wrap(<Reimburse {...props} mode="postings" />);
    await screen.findByText('EXP-JNL-0012');
    expect(screen.getByText('does not balance')).toBeTruthy();
    expect(screen.getByText('This product has no general ledger.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export EXP-JNL-0011 as CSV' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export EXP-JNL-0012 as CSV' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { expenseFile: { kind: 'posting', posting: 12, org: 3 }, name: 'EXP-JNL-0012.csv' }));

    fireEvent.click(screen.getAllByText('Void…')[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'Void EXP-JNL-0012?' });
    expect(within(sheet).getByText(/2 claims are released to be batched again/)).toBeTruthy();
    fireEvent.click(within(sheet).getByText('Void the batch'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('DELETE', '/api/expense/postings/12', { query: { org: 3 }, body: undefined }));
  });
});

describe('petty cash', () => {
  it('shows a fund’s balance, and the difference a count makes as it is typed', async () => {
    vi.mocked(request).mockResolvedValue(said('Reconciliation recorded', { id: 2, variance: '-250.00' }));
    wrap(<Petty {...props} />);
    await screen.findByText('Front desk');
    expect(screen.getByText('LKR 3,250.00')).toBeTruthy();
    fireEvent.click(screen.getByText('Front desk'));
    const panel = await screen.findByRole('complementary', { name: 'Petty cash fund' });
    expect((await within(panel).findByTestId('fund-balance')).textContent).toBe('LKR 3,250.00');
    expect(within(panel).getByText('LKR 100.00 short')).toBeTruthy();
    expect(within(panel).getByText('Courier')).toBeTruthy();

    fireEvent.click(within(panel).getByText('Reconcile against a physical count'));
    const sheet = await screen.findByRole('dialog', { name: 'Reconcile against a physical count' });
    fireEvent.change(within(sheet).getByLabelText('Counted'), { target: { value: '3000' } });
    expect(within(sheet).getByTestId('count-difference').textContent).toBe('LKR 250.00 short');
    fireEvent.change(within(sheet).getByLabelText('Counted'), { target: { value: '3250' } });
    expect(within(sheet).getByTestId('count-difference').textContent).toMatch(/No difference/);
    fireEvent.change(within(sheet).getByLabelText('Counted'), { target: { value: '3000' } });
    fireEvent.click(within(sheet).getByText('Record the count'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/expense/petty-cash/5/reconcile', { query: { org: 3 }, body: { counted: '3000', note: null } }));
  });

  it('refuses a spend the tin cannot cover before it is sent', async () => {
    wrap(<Petty {...props} />);
    fireEvent.click(await screen.findByText('Front desk'));
    const panel = await screen.findByRole('complementary', { name: 'Petty cash fund' });
    await within(panel).findByTestId('fund-balance');
    fireEvent.change(within(panel).getByLabelText('Amount'), { target: { value: '4000' } });
    fireEvent.change(within(panel).getByLabelText('Description'), { target: { value: 'Printer toner' } });
    expect(within(panel).getByText(/more than the fund holds/)).toBeTruthy();
    expect((within(panel).getByText('Post') as HTMLButtonElement).disabled).toBe(true);
  });
});
