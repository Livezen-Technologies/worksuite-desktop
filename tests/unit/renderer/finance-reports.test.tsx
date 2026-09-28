// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';
import type { BalanceSheetStatement as BS, ProfitAndLossStatement as PL } from '../../../src/modules/finance/reports';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn() }));

// The ledger reads where it starts from the tab's address; the tests say what that address is.
const tab = vi.hoisted(() => ({ query: new URLSearchParams() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/finance?${tab.query}`, active: true, path: ['finance'], query: tab.query, go: () => undefined, navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const R = await import('../../../src/modules/finance/reports');
const { default: Ledger } = await import('../../../src/modules/finance/Ledger');
const { default: Trial } = await import('../../../src/modules/finance/Trial');
const { ProfitAndLoss, BalanceSheet } = await import('../../../src/modules/finance/Statements');
const { default: CashFlow } = await import('../../../src/modules/finance/CashFlow');

/*
 * The report screens of Finance, drawn from payloads shaped as the server
 * sends them (Reports::ledger/trialBalance, Financials::profitAndLoss/
 * balanceSheet/cashFlow/changesInEquity), to prove they say the things that
 * matter — the verdicts, the comparative, the truncation — without a server.
 */

const company = { id: 2, name: 'CreativeFX', base_currency: 'LKR', fiscal_year_start_month: 4, books_opened_at: '2025-04-01', has_books: true };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ACCOUNTS = [
  { id: 1, code: '1000', name: 'Assets', type: 'asset', normal_balance: 'debit', is_postable: false, is_system: false, status: 'active', children: [
    { id: 12, code: '1120', name: 'Bank', type: 'asset', normal_balance: 'debit', is_postable: true, is_system: true, status: 'active', children: [] },
  ] },
];

const TRIAL_BALANCED = {
  rows: [
    { account_id: 12, code: '1120', name: 'Bank', type: 'asset', normal_balance: 'debit', status: 'active', debit: '100000.00', credit: '0.00' },
    { account_id: 61, code: '6100', name: 'Stationery', type: 'expense', normal_balance: 'debit', status: 'archived', debit: '0.00', credit: '0.00' },
    { account_id: 62, code: '6200', name: 'Rent', type: 'expense', normal_balance: 'debit', status: 'active', debit: '150000.00', credit: '0.00' },
    { account_id: 40, code: '4000', name: 'Sales', type: 'revenue', normal_balance: 'credit', status: 'active', debit: '0.00', credit: '250000.00' },
  ],
  total_debit: '250000.00',
  total_credit: '250000.00',
  balanced: true,
  difference: '0.00',
  from: null,
  to: null,
  mode: 'position',
};

const group = (sections: Array<[string, Array<[number, string, string, string]>]>) => {
  const out = sections.map(([name, lines]) => {
    const cents = lines.reduce((a, [, , , amt]) => a + Math.round(Number(amt) * 100), 0);
    return { name, lines: lines.map(([account_id, code, n, amount]) => ({ account_id, code, name: n, amount })), total: (cents / 100).toFixed(2) };
  });
  return { sections: out, total: (out.reduce((a, s) => a + Math.round(Number(s.total) * 100), 0) / 100).toFixed(2) };
};
const none = { sections: [], total: '0.00' };

const PL_NOW: PL = {
  from: '2026-04-01',
  to: '2027-03-31',
  groups: {
    revenue: group([['Revenue', [[40, '4000', 'Sales', '900000.00'], [41, '4100', 'Services', '100000.00']]]]),
    cogs: group([['Cost of Sales', [[50, '5000', 'Cost of goods sold', '400000.00']]]]),
    expense: group([['Operating Expenses', [[62, '6200', 'Rent', '150000.00']]]]),
    other_income: none,
    other_expense: none,
  },
  subtotals: { revenue: '1000000.00', cogs: '400000.00', gross_profit: '600000.00', expenses: '150000.00', operating_profit: '450000.00', other_income: '0.00', other_expense: '0.00' },
  net_profit: '450000.00',
};

// Last year: Services had not started, and Travel moved then and not this year.
const PL_PRIOR: PL = {
  from: '2025-04-01',
  to: '2026-03-31',
  groups: {
    revenue: group([['Revenue', [[40, '4000', 'Sales', '700000.00']]]]),
    cogs: group([['Cost of Sales', [[50, '5000', 'Cost of goods sold', '300000.00']]]]),
    expense: group([['Operating Expenses', [[62, '6200', 'Rent', '120000.00'], [63, '6300', 'Travel', '20000.00']]]]),
    other_income: none,
    other_expense: none,
  },
  subtotals: { revenue: '700000.00', cogs: '300000.00', gross_profit: '400000.00', expenses: '140000.00', operating_profit: '260000.00', other_income: '0.00', other_expense: '0.00' },
  net_profit: '260000.00',
};

const PL_EMPTY: PL = { from: '2025-04-01', to: '2026-03-31', groups: { revenue: none, cogs: none, expense: none, other_income: none, other_expense: none }, subtotals: {}, net_profit: '0.00' };

const bs = (balanced: boolean): BS => ({
  as_of: '2026-09-30',
  year_start: '2026-04-01',
  groups: {
    asset: group([
      ['Current Assets', [[12, '1120', 'Bank', '1000000.00'], [13, '1130', 'Receivables', '300000.00']]],
      ['Fixed Assets', [[121, '1210', 'Equipment', '200000.00']]],
    ]),
    liability: group([['Current Liabilities', [[21, '2100', 'Payables', '400000.00']]]]),
    equity: group([['Equity', [[31, '3100', 'Share capital', '650000.00']]]]),
  },
  totals: {
    assets: '1500000.00',
    liabilities: '400000.00',
    equity_in_books: '650000.00',
    profit_for_the_year: '450000.00',
    profit_brought_forward: '0.00',
    equity: balanced ? '1100000.00' : '1099900.00',
    liabilities_and_equity: balanced ? '1500000.00' : '1499900.00',
  },
  difference: balanced ? '0.00' : '100.00',
  balanced,
});

const BS_PRIOR: BS = { as_of: '2025-09-30', year_start: '2025-04-01', groups: { asset: none, liability: none, equity: none }, totals: { assets: '0.00', liabilities: '0.00', profit_for_the_year: '0.00', profit_brought_forward: '0.00', equity: '0.00', liabilities_and_equity: '0.00' }, difference: '0.00', balanced: true };

const LEDGER = {
  ok: true,
  account: { id: 12, code: '1120', name: 'Bank', type: 'asset', normal_balance: 'debit', status: 'active' },
  opening: '100000.00',
  rows: [
    { journal_id: 3, journal_no: 'JE-000003', entry_date: '2026-04-10', reference: null, description: 'Office chairs', journal_description: 'Furniture', debit: '0.00', credit: '50000.00', balance: '50000.00', status: 'posted', source_type: 'manual', source_id: null, reverses_id: null, reversed_by_id: 5 },
    { journal_id: 5, journal_no: 'JE-000005', entry_date: '2026-04-12', reference: null, description: 'Office chairs', journal_description: 'Reversal of JE-000003', debit: '50000.00', credit: '0.00', balance: '100000.00', status: 'posted', source_type: 'reversal', source_id: null, reverses_id: 3, reversed_by_id: null },
  ],
  closing: '987654.32',
  truncated: true,
  limit: 5000,
};

const CASH = {
  from: '2026-04-01',
  to: '2027-03-31',
  activities: {
    operating: { name: 'Operating activities', lines: [{ account_id: 40, code: '4000', name: 'Sales', section: 'Revenue', amount: '900000.00' }, { account_id: 13, code: '1130', name: 'Receivables', section: 'Current Assets', amount: '-300000.00' }], total: '600000.00' },
    investing: { name: 'Investing activities', lines: [{ account_id: 121, code: '1210', name: 'Equipment', section: 'Fixed Assets', amount: '-200000.00' }], total: '-200000.00' },
    financing: { name: 'Financing activities', lines: [], total: '0.00' },
  },
  opening_cash: '600000.00',
  closing_cash: '1000000.00',
  movement: '400000.00',
  derived: '400000.00',
  difference: '0.00',
  reconciles: true,
};

const EQUITY = (reconciles: boolean) => ({
  from: '2026-04-01',
  to: '2027-03-31',
  opening: '650000.00',
  profit_brought_forward: '50000.00',
  movements: [{ account_id: 31, code: '3100', name: 'Share capital', section: 'Equity', amount: '100000.00' }],
  movements_total: '100000.00',
  profit: '450000.00',
  closing: '1200000.00',
  closing_per_balance_sheet: reconciles ? '1200000.00' : '1150000.00',
  reconciles,
});

/** What each path answers in the current test; an Error is thrown, as the client would. */
let answers: Record<string, unknown> = {};

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'] } as never });
  tab.query = new URLSearchParams();
  answers = {
    '/api/finance/accounts': { accounts: ACCOUNTS },
    '/api/finance/trial-balance': TRIAL_BALANCED,
    '/api/finance/ledger': LEDGER,
    '/api/finance/profit-and-loss': { statement: PL_NOW, comparative: PL_PRIOR, base_currency: 'LKR' },
    '/api/finance/balance-sheet': { statement: bs(true), comparative: BS_PRIOR, base_currency: 'LKR' },
    '/api/finance/cash-flow': { statement: CASH, base_currency: 'LKR' },
    '/api/finance/changes-in-equity': { statement: EQUITY(true), base_currency: 'LKR' },
  };
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (!(path in answers)) throw new Error(`unexpected ${path}`);
    const a = answers[path];
    if (a instanceof Error) throw a;
    return a;
  });
  vi.mocked(call).mockResolvedValue(undefined as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('finance reports, the pure parts', () => {
  it('captions a trial balance by the question the server says it answered', () => {
    expect(R.trialCaption({ mode: 'position', from: null, to: null })).toBe('Balances to date — everything posted.');
    expect(R.trialCaption({ mode: 'position', from: null, to: '2026-06-30' })).toBe('Balances as at 30 Jun 2026 — everything posted up to that date.');
    expect(R.trialCaption({ mode: 'movement', from: '2026-04-01', to: null })).toBe('Movements posted between 1 Apr 2026 and today — what changed in the window, not what each account stands at.');
    expect(R.trialCaption({ mode: 'movement', from: '2026-04-01', to: '2026-06-30' })).toMatch(/^Movements posted between 1 Apr 2026 and 30 Jun 2026/);
  });

  it('matches the comparative by account, and keeps an account that moved only last year', () => {
    const m = R.mergeSections(PL_NOW.groups.expense, PL_PRIOR.groups.expense);
    expect(m).toHaveLength(1);
    expect(m[0]!.lines).toEqual([
      { account_id: 62, code: '6200', name: 'Rent', amount: '150000.00', prior: '120000.00' },
      { account_id: 63, code: '6300', name: 'Travel', amount: null, prior: '20000.00' },
    ]);
    expect(m[0]!.total).toBe('150000.00');
    expect(m[0]!.prior).toBe('140000.00');
    // A section only last year had is kept, after this year's.
    const r = R.mergeSections(group([['A', [[1, '1', 'One', '1.00']]]]), group([['B', [[2, '2', 'Two', '2.00']]]]));
    expect(r.map((s) => [s.name, s.total, s.prior])).toEqual([
      ['A', '1.00', null],
      ['B', null, '2.00'],
    ]);
    expect(R.mergeSections(undefined, undefined)).toEqual([]);
  });

  it('knows a first year from a year that made nothing', () => {
    expect(R.hadPriorPL(PL_EMPTY)).toBe(false);
    expect(R.hadPriorPL(PL_PRIOR)).toBe(true);
    expect(R.hadPriorPL({ ...PL_EMPTY, net_profit: '-5.00' })).toBe(true);
    expect(R.hadPriorBS(BS_PRIOR)).toBe(false);
    expect(R.hadPriorBS(bs(true))).toBe(true);
  });

  it('reads and writes the ledger’s address, keeping only well-formed parts', () => {
    expect(R.readLedgerQuery(new URLSearchParams('account=12&from=2026-04-01&to=2026-09-30'))).toEqual({ account: '12', from: '2026-04-01', to: '2026-09-30' });
    expect(R.readLedgerQuery(new URLSearchParams('account=12x&from=April&to='))).toEqual({ account: '', from: '', to: '' });
    expect(R.ledgerExtra(12, '2026-04-01', '2026-09-30')).toBe('&account=12&from=2026-04-01&to=2026-09-30');
    expect(R.ledgerExtra(12, null, '2026-09-30')).toBe('&account=12&to=2026-09-30');
    expect(R.ledgerExtra('', '', '')).toBe('');
  });

  it('names the grant a refusal is about, and only for that kind of refusal', () => {
    expect(R.missingGrant(new ApiError(403, 'Missing permission: finance.reports.view', null))).toBe('finance.reports.view');
    expect(R.missingGrant(new ApiError(403, 'That company is not available to you.', null))).toBeNull();
    expect(R.missingGrant(new Error('Missing permission: finance.reports.view'))).toBeNull();
    expect(R.refusedWhy(new ApiError(404, 'No such account in this company.', null))).toBe('No such account in this company.');
    expect(R.refusedWhy(new ApiError(500, 'The server answered 500.', null))).toBeNull();
    expect(R.refusedWhy(new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'INTERNAL'))).toBeNull();
  });

  it('files, print pages, windows and counts', () => {
    expect(R.csvName('CreativeFX (Pvt) Ltd', 'profit-and-loss', '2026-04-01', '2027-03-31')).toBe('creativefx-pvt-ltd-profit-and-loss-2026-04-01-to-2027-03-31.csv');
    expect(R.csvName('', 'profit-and-loss', '2026-04-01', '2027-03-31', true)).toBe('profit-and-loss-transactions-2026-04-01-to-2027-03-31.csv');
    expect(R.printPath('profit-and-loss', 2, '2026-04-01', '2027-03-31')).toBe('/finance/print/profit-and-loss?company=2&from=2026-04-01&to=2027-03-31');
    expect(R.backwards('2026-05-01', '2026-04-01')).toBe(true);
    expect(R.backwards('2026-04-01', '')).toBe(false);
    expect(R.count(5000)).toBe('5,000');
    expect(R.count(1234567)).toBe('1,234,567');
    expect(R.RK.ledger(2, '12', '', '')).toEqual(['finance', 'c', 2, 'ledger', '12', '', '']);
  });
});

describe('finance reports, the screens', () => {
  it('a balanced trial balance: its caption, the archived code, the totals, the verdict — and an account opens its ledger', async () => {
    const onGo = vi.fn();
    wrap(<Trial company={company} onGo={onGo} />);
    await screen.findByText('Balances to date — everything posted.');
    expect(apiGet).toHaveBeenCalledWith('/api/finance/trial-balance', { company: 2, from: '', to: '' }, expect.anything());
    expect(screen.getByText('Archived')).toBeTruthy();
    expect(screen.getAllByText('LKR 250,000.00')).toHaveLength(2);
    expect(screen.getByText('Debits equal credits. The books balance.')).toBeTruthy();
    fireEvent.click(screen.getByText('Rent'));
    expect(onGo).toHaveBeenCalledWith('ledger', '&account=62');
  });

  it('an unbalanced trial balance says by how much, and that something is wrong', async () => {
    answers['/api/finance/trial-balance'] = { ...TRIAL_BALANCED, total_credit: '249990.00', balanced: false, difference: '10.00', from: '2026-04-01', to: '2026-06-30', mode: 'movement' };
    const onGo = vi.fn();
    wrap(<Trial company={company} onGo={onGo} />);
    await screen.findByText(/Something has been posted that should not have been/);
    expect(screen.getByText('LKR 10.00')).toBeTruthy();
    expect(screen.getByText(/^Movements posted between 1 Apr 2026 and 30 Jun 2026/)).toBeTruthy();
    // A movement line opens the ledger over the same window, where the same movement is.
    fireEvent.click(screen.getByText('Bank'));
    expect(onGo).toHaveBeenCalledWith('ledger', '&account=12&from=2026-04-01&to=2026-06-30');
  });

  it('a trial balance refused for the grant names the grant, not a failure', async () => {
    answers['/api/finance/trial-balance'] = new ApiError(403, 'Missing permission: finance.reports.view', null);
    const onGo = vi.fn();
    wrap(<Trial company={company} onGo={onGo} />);
    await screen.findByText(/Reading the trial balance needs/);
    expect(screen.getByText('finance.reports.view')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    fireEvent.click(screen.getByText('My access'));
    expect(onGo).toHaveBeenCalledWith('myaccess');
  });

  it('a trial balance that failed says it is not a statement about the books', async () => {
    answers['/api/finance/trial-balance'] = new ApiError(500, 'The server answered 500.', null);
    wrap(<Trial company={company} onGo={vi.fn()} />);
    await screen.findByText('The trial balance could not be loaded. This is a failed request, not a statement about the books.');
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('the ledger opens on the account and dates in its address, draws the opening row, and says it was cut short', async () => {
    tab.query = new URLSearchParams('tab=ledger&company=2&account=12&from=2026-04-01');
    const onGo = vi.fn();
    wrap(<Ledger company={company} onGo={onGo} />);
    await screen.findByText('Opening balance');
    expect(apiGet).toHaveBeenCalledWith('/api/finance/ledger', { company: 2, account: '12', from: '2026-04-01', to: '', limit: 5000 }, expect.anything());
    expect(screen.getByText('LKR 100,000.00')).toBeTruthy();
    expect(screen.getByText('Debits increase it')).toBeTruthy();
    expect(screen.getByText('Only the first 5,000 movements are shown, oldest first.')).toBeTruthy();
    expect(screen.getByText('LKR 987,654.32')).toBeTruthy();
    expect(screen.getByText('the whole window, not the last row shown')).toBeTruthy();
    // A journal, and both ends of a reversal, open in Journals.
    fireEvent.click(screen.getByText('JE-000005'));
    expect(onGo).toHaveBeenLastCalledWith('journals', '&open=5');
    fireEvent.click(screen.getByText(/reverses an earlier entry/));
    expect(onGo).toHaveBeenLastCalledWith('journals', '&open=3');
    fireEvent.click(screen.getByText('since reversed'));
    expect(onGo).toHaveBeenLastCalledWith('journals', '&open=5');
    // A change is written back to the address, so a restored tab reopens here.
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-06-30' } });
    expect(onGo).toHaveBeenLastCalledWith('ledger', '&account=12&from=2026-04-01&to=2026-06-30');
  });

  it('the ledger with no account asks for one, and asks the server nothing', async () => {
    wrap(<Ledger company={company} onGo={vi.fn()} />);
    expect(screen.getByText('Choose an account to see what has moved through it.')).toBeTruthy();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/finance/accounts', { company: 2 }, expect.anything()));
    expect(vi.mocked(apiGet).mock.calls.some(([p]) => p === '/api/finance/ledger')).toBe(false);
  });

  it('the ledger that was not cut short says nothing about it', async () => {
    tab.query = new URLSearchParams('account=12');
    answers['/api/finance/ledger'] = { ...LEDGER, truncated: false, closing: '100000.00' };
    wrap(<Ledger company={company} onGo={vi.fn()} />);
    await screen.findByText('JE-000003');
    expect(screen.queryByText('Opening balance')).toBeNull();
    expect(screen.queryByText(/Only the first/)).toBeNull();
    expect(screen.getByText('LKR 100,000.00')).toBeTruthy();
  });

  it('the profit and loss: sections, subtotals, the comparative by account, and the net line', async () => {
    const onGo = vi.fn();
    wrap(<ProfitAndLoss company={company} onGo={onGo} />);
    await screen.findByText('Gross profit');
    expect(screen.getByText('1 April 2026 to 31 March 2027, from posted journals only.')).toBeTruthy();
    expect(screen.getByText('1 Apr 2026 – 31 Mar 2027')).toBeTruthy();
    expect(screen.getByText('1 Apr 2025 – 31 Mar 2026')).toBeTruthy();
    expect(screen.getByText('Total revenue')).toBeTruthy();
    expect(screen.getByText('1,000,000.00')).toBeTruthy();
    expect(screen.getByText('600,000.00')).toBeTruthy();
    expect(screen.getAllByText('400,000.00')).toHaveLength(2); // cost of sales now, gross profit then
    expect(screen.getByText('Operating profit')).toBeTruthy();
    expect(screen.getByText('Net profit')).toBeTruthy();
    expect(screen.getAllByText('450,000.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('260,000.00').length).toBeGreaterThanOrEqual(2);
    // Services is new this year: a zero last year, not a missing year.
    expect(screen.getByText('Services')).toBeTruthy();
    // Travel moved only last year, and is still on the statement.
    expect(screen.getByText('Travel')).toBeTruthy();
    expect(screen.getByText('20,000.00')).toBeTruthy();
    expect(screen.queryByTitle('There was no last year to compare with')).toBeNull();
    fireEvent.click(screen.getByText('Sales'));
    expect(onGo).toHaveBeenCalledWith('ledger', '&account=40&from=2026-04-01&to=2027-03-31');
  });

  it('a first year has no comparative: dashes, not zeros', async () => {
    answers['/api/finance/profit-and-loss'] = { statement: PL_NOW, comparative: PL_EMPTY, base_currency: 'LKR' };
    wrap(<ProfitAndLoss company={company} onGo={vi.fn()} />);
    await screen.findByText('Gross profit');
    expect(screen.getAllByTitle('There was no last year to compare with').length).toBeGreaterThan(5);
    expect(screen.queryByText('0.00')).toBeNull();
  });

  it('the profit and loss exports, downloads its lines, and prints — for the window on screen', async () => {
    wrap(<ProfitAndLoss company={company} onGo={vi.fn()} />);
    await screen.findByText('Gross profit');
    fireEvent.click(screen.getByText('Export'));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('transfers:download', { financeCsv: { report: 'profit-and-loss', company: 2, from: '2026-04-01', to: '2027-03-31' }, name: 'creativefx-profit-and-loss-2026-04-01-to-2027-03-31.csv' }),
    );
    await waitFor(() => expect((screen.getByText('Transactions').closest('button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Transactions'));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('transfers:download', { financeCsv: { report: 'profit-and-loss', lines: true, company: 2, from: '2026-04-01', to: '2027-03-31' }, name: 'creativefx-profit-and-loss-transactions-2026-04-01-to-2027-03-31.csv' }),
    );
    fireEvent.click(screen.getByText('Print'));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/finance/print/profit-and-loss?company=2&from=2026-04-01&to=2027-03-31' });
  });

  it('offers only the ways out the person holds a grant for', async () => {
    app.set({ bootstrap: { permissions: ['finance.view', 'finance.reports.view', 'finance.reports.print'] } as never });
    wrap(<ProfitAndLoss company={company} onGo={vi.fn()} />);
    await screen.findByText('Gross profit');
    expect(screen.queryByText('Export')).toBeNull();
    expect(screen.queryByText('Transactions')).toBeNull();
    expect(screen.getByText('Print')).toBeTruthy();
  });

  it('the balance sheet states its check first, and opens an account’s ledger to the date', async () => {
    const onGo = vi.fn();
    wrap(<BalanceSheet company={company} onGo={onGo} />);
    await screen.findByText(/Assets equal liabilities plus equity, at/);
    expect(screen.getAllByText('LKR 1,500,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('As at 30 September 2026, from posted journals only.')).toBeTruthy();
    expect(screen.getByText('Current Assets')).toBeTruthy();
    expect(screen.getByText('Total Current Assets')).toBeTruthy();
    expect(screen.getByText('1,300,000.00')).toBeTruthy();
    expect(screen.getByText('Total liabilities and equity')).toBeTruthy();
    expect(screen.getByText('computed, until a year-end close writes it to 3300')).toBeTruthy();
    // A year before the books opened: no comparative.
    expect(screen.getAllByTitle('There was no last year to compare with').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Equipment'));
    expect(onGo).toHaveBeenCalledWith('ledger', '&account=121&to=2026-09-30');
  });

  it('a balance sheet that does not balance says not to issue it', async () => {
    answers['/api/finance/balance-sheet'] = { statement: bs(false), comparative: BS_PRIOR, base_currency: 'LKR' };
    wrap(<BalanceSheet company={company} onGo={vi.fn()} />);
    await screen.findByText(/This does not balance/);
    expect(screen.getByText(/Do not issue this/)).toBeTruthy();
    expect(screen.getByText('LKR 100.00')).toBeTruthy();
  });

  it('cash flow shows what each line was classified by, and both statements carry their check', async () => {
    const onGo = vi.fn();
    wrap(<CashFlow company={company} onGo={onGo} />);
    await screen.findByText(/The three activities add up to the movement in cash/);
    expect(screen.getByText('Fixed Assets')).toBeTruthy();
    expect(screen.getAllByText('Investing activities')).toHaveLength(2);
    expect(screen.queryByText('Financing activities')).toBeNull();
    expect(screen.getByText('LKR 1,000,000.00')).toBeTruthy();
    expect(screen.getByText(/Closing equity agrees with the balance sheet at/)).toBeTruthy();
    expect(screen.getByText(/including LKR 50,000.00 of earlier profit not yet closed into equity/)).toBeTruthy();
    fireEvent.click(screen.getByText('Equipment'));
    expect(onGo).toHaveBeenCalledWith('ledger', '&account=121&from=2026-04-01&to=2027-03-31');
  });

  it('changes in equity that disagree with the balance sheet say both figures', async () => {
    answers['/api/finance/changes-in-equity'] = { statement: EQUITY(false), base_currency: 'LKR' };
    wrap(<CashFlow company={company} onGo={vi.fn()} />);
    await screen.findByText(/against the balance sheet's/);
    expect(screen.getByText('LKR 1,150,000.00')).toBeTruthy();
  });
});
