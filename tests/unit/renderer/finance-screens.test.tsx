// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiPost } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { default: Overview } = await import('../../../src/modules/finance/Overview');
const { default: Journals } = await import('../../../src/modules/finance/Journals');
const { default: Accounts } = await import('../../../src/modules/finance/Accounts');
const { default: Periods } = await import('../../../src/modules/finance/Periods');
const { default: MyAccess } = await import('../../../src/modules/finance/MyAccess');
type Dashboard = import('../../../src/modules/finance/api').Dashboard;

/*
 * Each Finance screen of part one, drawn from payloads shaped as the server
 * sends them (see the web's finance screens and FinanceController), to prove
 * they render — and say the things that matter — without a server.
 */

const company = { id: 2, name: 'CreativeFX', base_currency: 'LKR', fiscal_year_start_month: 4, books_opened_at: '2026-04-01', has_books: true };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const done = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: vi.fn() }) as unknown as UseQueryResult<T>;

const ACCOUNTS = [
  { id: 1, code: '1000', name: 'Assets', type: 'asset', normal_balance: 'debit', is_postable: false, is_system: false, status: 'active', children: [
    { id: 11, code: '1110', name: 'Cash', type: 'asset', normal_balance: 'debit', is_postable: true, is_system: true, status: 'active', children: [] },
    { id: 12, code: '1120', name: 'Bank', type: 'asset', normal_balance: 'debit', is_postable: true, is_system: true, status: 'active', children: [] },
  ] },
  { id: 6, code: '6000', name: 'Expenses', type: 'expense', normal_balance: 'debit', is_postable: false, is_system: false, status: 'active', children: [
    { id: 62, code: '6200', name: 'Rent', type: 'expense', normal_balance: 'debit', is_postable: true, is_system: false, status: 'active', cost_behaviour: 'unclassified', children: [] },
  ] },
];

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'] } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/finance/accounts') return { accounts: ACCOUNTS };
    if (path === '/api/finance/journals')
      return {
        base_currency: 'LKR',
        may_read_figures: true,
        journals: [
          { id: 7, journal_no: 'JE-000007', entry_date: '2026-09-20', description: 'September rent', reference: null, status: 'pending', currency: 'LKR', total_debit: '150000.00', total_credit: '150000.00', source_type: 'manual', reverses_id: null, reversed_by_id: null },
          { id: 5, journal_no: 'INV-2026-0012', entry_date: '2026-09-02', description: 'Invoice 12', reference: 'INV-12', status: 'posted', currency: 'USD', total_debit: '30000.00', currency_total: '100.00', total_credit: '30000.00', source_type: 'invoice', reverses_id: null, reversed_by_id: null },
        ],
      };
    if (path === '/api/finance/journals/7')
      return {
        base_currency: 'LKR',
        journal: { id: 7, journal_no: 'JE-000007', entry_date: '2026-09-20', description: 'September rent', reference: null, status: 'pending', currency: 'LKR', total_debit: '150000.00', total_credit: '150000.00', source_type: 'manual', reverses_id: null, reversed_by_id: null },
        lines: [
          { id: 1, line_no: 1, account_id: 62, account_code: '6200', account_name: 'Rent', account_status: 'active', description: null, debit: '150000.00', credit: '0.00' },
          { id: 2, line_no: 2, account_id: 12, account_code: '1120', account_name: 'Bank', account_status: 'active', description: null, debit: '0.00', credit: '150000.00' },
        ],
      };
    if (path === '/api/finance/periods')
      return {
        years: [{ id: 1, name: 'FY 2026/27', starts_on: '2026-04-01', ends_on: '2026-10-31', status: 'open' }],
        periods: [
          { id: 1, fiscal_year_id: 1, name: 'Apr 2026', starts_on: '2026-04-01', ends_on: '2026-04-30', status: 'locked', note: null },
          { id: 2, fiscal_year_id: 1, name: 'May 2026', starts_on: '2026-05-01', ends_on: '2026-05-31', status: 'open', note: 'Reopened: late bank charges' },
        ],
      };
    if (path === '/api/finance/access')
      return {
        super: false,
        companies: [{ id: 2, name: 'CreativeFX', role: 'finance', has_books: true }],
        excluded: [{ id: 4, name: 'TechHubiz', role: 'member', why: 'A member files expense claims; the ledger needs the finance or admin role.' }],
        ledger_roles: ['finance', 'admin'],
        permissions: [{ slug: 'finance.view', name: 'Open Finance', held: true }],
      };
    if (path === '/api/finance/currencies') return { currencies: [{ code: 'LKR', name: 'Sri Lankan rupee' }, { code: 'USD', name: 'US dollar' }] };
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('finance screens, part one', () => {
  it('the Overview says what the result leaves out, and names what is outstanding', () => {
    const d: Dashboard = {
      has_books: true,
      as_of: '2026-09-28',
      currency: 'LKR',
      balanced: true,
      accounts_used: 41,
      unposted: 2,
      awaiting_post: 1,
      may_read_figures: true,
      total_debit: '9870000.00',
      unposted_documents: 3,
      unposted_split: { documents: 1, claims: 2 },
      year: { name: 'FY 2026/27', starts_on: '2026-04-01', ends_on: '2027-03-31', revenue: '5000000.00', cogs: '0.00', gross: '5000000.00', expenses: '5600000.00', net: '-600000.00' },
      receivables: { total: '1200000.00', tie_out: { agrees: false }, buckets: { current: '200000', d1_30: '0', d31_60: '0', d61_90: '0', d90plus: '1000000' } },
      payables: { total: '0.00', tie_out: { agrees: true } },
    };
    wrap(<Overview company={company} data={done(d)} onGo={vi.fn()} onOpened={vi.fn()} />);
    expect(screen.getByText('The ledger balances, but not everything is in it.')).toBeTruthy();
    expect(screen.getByText(/leaves out 1 issued document, and recognises nothing as cost of sales/)).toBeTruthy();
    expect(screen.getAllByText('LKR -600,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Net loss')).toBeTruthy();
    expect(screen.getByText('LKR 1,000,000.00 is over 90 days old')).toBeTruthy();
    expect(screen.getByText(/does not agree with its control account/)).toBeTruthy();
    expect(screen.getByText(/No supplier bills have ever been entered/)).toBeTruthy();
    expect(screen.getByText('2 journals not yet posted')).toBeTruthy();
  });

  it('a company without books is offered the form that opens them, picked not typed', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ message: 'The books are open.' });
    const opened = vi.fn();
    wrap(<Overview company={{ ...company, has_books: false, base_currency: null }} data={done({ has_books: false } as Dashboard)} onGo={vi.fn()} onOpened={opened} />);
    fireEvent.click(screen.getByText('Open the books'));
    await screen.findByText(/This happens once/);
    await waitFor(() => expect((screen.getAllByText('Open the books').at(-1) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByText('Open the books').at(-1)!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/companies/2/open-books', { base_currency: 'LKR', fiscal_year_start_month: 1, first_year: new Date().getFullYear() }));
    expect(opened).toHaveBeenCalled();
  });

  it('Journals lists with status and the books’ currency, and opens one to its lines and next step', async () => {
    const onOpen = vi.fn();
    const { rerender } = wrap(<Journals company={company} openId={null} making={false} onOpen={onOpen} onMake={vi.fn()} />);
    await screen.findByText('JE-000007');
    expect(screen.getByText('Awaiting approval')).toBeTruthy();
    expect(screen.getByText('USD 100.00 as struck')).toBeTruthy();
    fireEvent.click(screen.getByText('September rent'));
    expect(onOpen).toHaveBeenCalledWith(7);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <Journals company={company} openId={7} making={false} onOpen={onOpen} onMake={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByText('Approve');
    expect(screen.getAllByText('150,000.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Somebody other than the writer approves it.')).toBeTruthy();
  });

  it('the entry form refuses to save until debits equal credits', async () => {
    wrap(<Journals company={company} openId={null} making onOpen={vi.fn()} onMake={vi.fn()} />);
    await screen.findByText('New journal', { selector: 'h2' });
    const save = screen.getByText('Save draft') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Line 1 debit'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Line 2 credit'), { target: { value: '99.50' } });
    expect(screen.getAllByText(/no account chosen/).length).toBeGreaterThan(0);
  });

  it('the chart shows the tree, the system lock, and asks to classify cost accounts', async () => {
    wrap(<Accounts company={company} />);
    await screen.findByText('Rent');
    expect(screen.getByText('1 cost account is not classified as fixed or variable, so the cost breakdown leaves it out.')).toBeTruthy();
    expect(screen.getAllByTitle(/A system account/).length).toBe(2);
  });

  it('Periods warns when the calendar runs out, and keeps a reopened period’s reason on it', async () => {
    wrap(<Periods company={company} />);
    await screen.findByText('May 2026');
    expect(screen.getByText('Reopened: late bank charges')).toBeTruthy();
    expect(screen.getByText(/The calendar runs out on/)).toBeTruthy();
    expect(screen.getByText('Reopen…')).toBeTruthy();
  });

  it('My access explains the companies withheld, and why', async () => {
    wrap(<MyAccess />);
    await screen.findByText('Books you can open');
    expect(screen.getByText(/1 company you belong to whose books you cannot open/)).toBeTruthy();
    expect(screen.getByText(/A member files expense claims/)).toBeTruthy();
  });
});
