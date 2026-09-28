// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { ApiError, apiGet, apiPost, apiPut } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { default: Budgets } = await import('../../../src/modules/finance/Budgets');
const { default: YearEnd } = await import('../../../src/modules/finance/YearEnd');
const close = await import('../../../src/modules/finance/close');

/*
 * Budgets and the year-end close, drawn from payloads shaped as the server
 * sends them — including its habit of answering every column as a string
 * (`numberNative` is off), so a version's `balanced` arrives as "0".
 */

const company = { id: 2, name: 'CreativeFX', base_currency: 'LKR', fiscal_year_start_month: 4, books_opened_at: '2025-04-01', has_books: true };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const M27 = close.monthsOf(2027);
const M26 = close.monthsOf(2026);

const LIST = {
  company: { id: 2, name: 'CreativeFX' },
  currency: 'LKR',
  rows: [
    { id: 3, year: 2027, name: 'Budget 2027', status: 'draft', note: 'Seeded from 2026', approved_at: null, lines: 4, total: '500000.00' },
    { id: 1, year: 2026, name: 'Budget 2026', status: 'approved', note: null, approved_at: '2026-01-10 09:00:00', lines: 2, total: '350000.00' },
  ],
  can_edit: true,
  // As `getResultArray()` returns them: ids are strings.
  accounts: [
    { id: '41', code: '4100', name: 'Sales', type: 'revenue' },
    { id: '51', code: '5100', name: 'Cost of sales', type: 'cogs' },
    { id: '62', code: '6200', name: 'Rent', type: 'expense' },
    { id: '63', code: '6300', name: 'Travel', type: 'expense' },
  ],
  types: ['revenue', 'cogs', 'expense', 'other_income', 'other_expense'],
};

const DRAFT = {
  id: 3,
  org_id: 2,
  year: 2027,
  name: 'Budget 2027',
  status: 'draft',
  note: 'Seeded from 2026',
  approved_at: null,
  months: M27,
  accounts: [
    { account_id: 41, code: '4100', name: 'Sales', type: 'revenue', months: { '2027-01': '200000.00' }, total: '200000.00' },
    { account_id: 62, code: '6200', name: 'Rent', type: 'expense', months: { '2027-01': '150000.00', '2027-02': '150000.00' }, total: '300000.00' },
    // Archived since its figure was entered: kept on the budget, no longer budgetable.
    { account_id: 70, code: '7000', name: 'Old rent', type: 'expense', months: { '2027-01': '50000.00' }, total: '50000.00' },
  ],
  currency: 'LKR',
  can_edit: true,
  can_manage: true,
};

const APPROVED = {
  id: 1,
  org_id: 2,
  year: 2026,
  name: 'Budget 2026',
  status: 'approved',
  note: null,
  approved_at: '2026-01-10 09:00:00',
  months: M26,
  accounts: [
    { account_id: 41, code: '4100', name: 'Sales', type: 'revenue', months: { '2026-01': '200000.00' }, total: '200000.00' },
    { account_id: 62, code: '6200', name: 'Rent', type: 'expense', months: { '2026-01': '150000.00' }, total: '150000.00' },
  ],
  currency: 'LKR',
  can_edit: false,
  can_manage: true,
};

const version = (o: Record<string, unknown>) => ({
  id: '9',
  version_no: '2',
  period_start: '2025-04-01',
  period_end: '2026-03-31',
  balanced: '1',
  net_profit: '-600000.00',
  total_assets: '12000000.00',
  status: 'generated',
  reason: 'Late bank charges',
  generated_at: '2026-09-20 10:00:00',
  max_journal_id: '345',
  journal_count: '120',
  generated_by_name: 'Nimal Perera',
  approved_by_name: null,
  approved_at: null,
  ...o,
});

const TASKS = [
  { id: '1', report_id: '5', org_id: '2', code: 'bank', title: 'Bank accounts reconciled', detail: 'Every bank account agreed to its statement for the whole year, and the reconciliation locked.', required: '1', status: 'open', note: null, completed_by: null, completed_by_name: null, completed_at: null, sort_order: '1' },
  { id: '5', report_id: '5', org_id: '2', code: 'accruals', title: 'Accruals and prepayments recorded', detail: null, required: '0', status: 'done', note: null, completed_by: '7', completed_by_name: 'Nimal Perera', completed_at: '2026-09-18 12:00:00', sort_order: '5' },
];

const YEAR = { id: '1', org_id: '2', name: 'FY 2025/26', starts_on: '2025-04-01', ends_on: '2026-03-31', status: 'open' };

function yearEnd(o: Record<string, unknown> = {}) {
  return {
    report: { id: '5', org_id: '2', fiscal_year_id: '1', title: 'Annual report FY 2025/26', status: 'draft', year_name: 'FY 2025/26' },
    year: YEAR,
    versions: [version({ balanced: '0' }), version({ id: '8', version_no: '1', status: 'superseded', reason: null })],
    tasks: TASKS,
    history: [{ action: 'generated', note: 'Late bank charges', created_at: '2026-09-20 10:00:00', actor_name: 'Nimal Perera' }],
    readiness: {
      ok: false,
      blockers: [
        { kind: 'reconciliation', detail: '1 bank reconciliation(s) covering this year are still open.' },
        { kind: 'draft_journals', detail: '2 journal(s) dated in this year are written but not posted.' },
        { kind: 'task', detail: 'Close task not done: Bank accounts reconciled' },
      ],
      warnings: [{ kind: 'depreciation', detail: 'Depreciation is charged for 4 of the 12 month(s) of this year that have ended.' }],
    },
    me: 7,
    base_currency: 'LKR',
    ...o,
  };
}

const READY = { ok: true, blockers: [], warnings: [] };

let yearEndPayload: Record<string, unknown> = yearEnd();

beforeEach(() => {
  yearEndPayload = yearEnd();
  app.set({ bootstrap: { permissions: ['*'] } as never, auth: { stage: 'ready', user: { id: '7', name: 'Hasarinda Manjula' } } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/finance/budgets') return LIST;
    if (path === '/api/finance/budgets/3') return DRAFT;
    if (path === '/api/finance/budgets/1') return APPROVED;
    if (path === '/api/finance/annual-report') return yearEndPayload;
    if (path === '/api/finance/periods') return { years: [{ ...YEAR, id: 1 }], periods: [] };
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── the pure parts ───────────────────────────────────────────────────────

describe('budget grid arithmetic', () => {
  it('names the twelve months of a calendar year, and moves them onto another', () => {
    expect(close.monthsOf(2027)).toHaveLength(12);
    expect(close.monthsOf(2027)[0]).toBe('2027-01');
    expect(close.monthsOf(2027)[11]).toBe('2027-12');
    expect(close.monthLabel('2027-03')).toBe('Mar');
    expect(close.monthLabel('2027-03', true)).toBe('March 2027');
    expect(close.restamp('2026-07', 2027)).toBe('2027-07');
  });

  it('reads a typed cell as cents, and says why when it is not an amount', () => {
    expect(close.cellOf('1,234.5')).toEqual({ cents: 123450 });
    expect(close.cellOf('')).toEqual({ cents: 0 });
    expect(close.cellOf(undefined)).toEqual({ cents: 0 });
    expect(close.cellOf('-5')).toEqual({ bad: 'negative' });
    expect(close.cellOf('1.234')).toEqual({ bad: 'nan' });
    expect(close.cellOf('abc')).toEqual({ bad: 'nan' });
  });

  it('totals in cents — income and cost apart, and the planned profit between them', () => {
    const type: Record<number, string> = { 41: 'revenue', 51: 'cogs', 62: 'expense' };
    const t = close.gridTotals(
      { 41: { '2027-01': '0.10' }, 51: { '2027-01': '0.20' }, 62: { '2027-01': '12,345,678,901.23', '2027-02': 'x' } },
      (id) => type[id]!,
      M27,
    );
    expect(t.income.months[0]).toBe(10);
    expect(t.cost.months[0]).toBe(20 + 1234567890123);
    expect(t.cost.months[1]).toBe(0);
    expect(t.byType.expense!.total).toBe(1234567890123);
    expect(close.gridMoney(t.profit.total)).toBe('-12,345,678,901.33');
    expect(close.rowCents({ '2027-01': '0.10', '2027-02': '0.20' }, M27)).toBe(30);
  });

  it('saves every figure — not only the rows on screen — and stores no empty or nil cell', () => {
    const lines = close.gridLines({ 41: { '2027-01': '1,234.5', '2027-02': '', '2027-03': '0' }, 62: { '2027-12': '99', '2026-12': '5' } }, M27);
    expect(lines).toEqual([
      { account_id: 41, month: '2027-01', amount: '1234.50' },
      { account_id: 62, month: '2027-12', amount: '99.00' },
    ]);
  });

  it('refuses to save over a typo, a negative, or an archived account’s figure — and says which', () => {
    const label = (id: number) => ({ 62: '6200 Rent', 70: '7000 Old rent' })[id] ?? String(id);
    const p = close.gridProblems({ 62: { '2027-03': '1o0', '2027-04': '-5' }, 70: { '2027-01': '50,000.00' } }, M27, label, new Set([70]));
    expect(p[0]).toBe('1 cell is not an amount — check 6200 Rent, March 2027. Use digits and at most two decimal places.');
    expect(p[1]).toMatch(/1 cell is negative — 6200 Rent, April 2027\. Figures are entered as positive amounts/);
    expect(p[2]).toMatch(/^7000 Old rent is no longer an active, postable account\./);
    expect(close.gridProblems({ 70: { '2027-01': '' } }, M27, label, new Set([70]))).toEqual([]);
  });

  it('turns the server’s strings into numbers and flags', () => {
    const l = close.normaliseBudgetList(LIST as never);
    expect(l.accounts[0]!.id).toBe(41);
    const y = close.normaliseYearEnd(yearEnd({ readiness: { ok: true, blockers: [{ kind: 'balance', detail: 'Out by 1.00.' }], warnings: [] } }));
    expect(y.versions[0]!.balanced).toBe(false);
    expect(y.versions[0]!.version_no).toBe(2);
    expect(y.versions[0]!.journal_count).toBe(120);
    expect(y.tasks[1]!.required).toBe(false);
    expect(y.report!.id).toBe(5);
    // A blocker listed is a blocker, whatever `ok` says.
    expect(y.readiness.ok).toBe(false);
  });

  it('knows who generated a version — by id when sent, by name otherwise', () => {
    const v = close.normaliseYearEnd(yearEnd()).versions[0]!;
    expect(close.generatedByMe(v, 7, 'nimal perera')).toBe(true);
    expect(close.generatedByMe(v, 7, 'Hasarinda Manjula')).toBe(false);
    expect(close.generatedByMe({ ...v, generated_by: 7 }, 7, 'Somebody else')).toBe(true);
    expect(close.generatedByMe({ ...v, generated_by: 8 }, 7, 'Nimal Perera')).toBe(false);
  });

  it('keeps every blocker of a refused approval', () => {
    const e = new ApiError(422, 'This year is not ready to sign: A.', null, { blockers: [{ kind: 'x', detail: 'A.' }, { kind: 'y', detail: 'B.' }] });
    expect(close.approveRefusal(e)).toEqual(['This year is not ready to sign: A.', 'B.']);
  });
});

// ── the screens ──────────────────────────────────────────────────────────

describe('Budgets', () => {
  it('lists budgets and opens a draft as a grid that totals in cents and saves the whole of it', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ written: 4 });
    wrap(<Budgets company={company} onGo={vi.fn()} />);
    await screen.findByText('Budget 2027');
    expect(screen.getByText('Approved · the plan')).toBeTruthy();
    expect(screen.getByText('New budget')).toBeTruthy();
    fireEvent.click(screen.getByText('Budget 2027'));

    const rent = (await screen.findByLabelText('6200 Rent, January 2027')) as HTMLInputElement;
    expect(rent.value).toBe('150,000.00');
    expect(screen.getByText(/Saving replaces the whole budget with this grid/)).toBeTruthy();
    // Account ids from the list arrive as strings; the stored rows still find their names.
    expect(screen.getByLabelText('4100 Sales, January 2027')).toBeTruthy();

    // The archived account's figure stops the save until it is cleared.
    expect(screen.getByText(/7000 Old rent is no longer an active, postable account/)).toBeTruthy();
    expect((screen.getByText('Saved') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('7000 Old rent, January 2027'), { target: { value: '' } });

    fireEvent.change(screen.getByLabelText('6200 Rent, March 2027'), { target: { value: 'abc' } });
    expect(screen.getByText(/1 cell is not an amount — check 6200 Rent, March 2027/)).toBeTruthy();
    expect((screen.getByText('Save figures') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('6200 Rent, March 2027'), { target: { value: '0.10' } });
    fireEvent.change(screen.getByLabelText('4100 Sales, March 2027'), { target: { value: '0.20' } });

    // Planned profit: 200,000.20 of income less 300,000.10 of cost.
    const foot = screen.getByText('Planned profit').closest('tr')!;
    expect(within(foot).getByText('-99,999.90')).toBeTruthy();
    expect(within(screen.getByText('Income').closest('tr')!).getByText('200,000.20')).toBeTruthy();

    // Find hides Rent; the save still sends it.
    fireEvent.change(screen.getByLabelText('Find an account'), { target: { value: 'sales' } });
    expect(screen.queryByLabelText('6200 Rent, January 2027')).toBeNull();
    fireEvent.click(screen.getByText('Save figures'));
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/api/finance/budgets/3/lines', {
        company_id: 2,
        lines: [
          { account_id: 41, month: '2027-01', amount: '200000.00' },
          { account_id: 41, month: '2027-03', amount: '0.20' },
          { account_id: 62, month: '2027-01', amount: '150000.00' },
          { account_id: 62, month: '2027-02', amount: '150000.00' },
          { account_id: 62, month: '2027-03', amount: '0.10' },
        ],
      }),
    );
  });

  it('shows an approved budget read-only, with Copy and no Approve', async () => {
    wrap(<Budgets company={company} onGo={vi.fn()} />);
    fireEvent.click(await screen.findByText('Budget 2026'));
    await screen.findByText(/cannot be edited/);
    expect(screen.queryByLabelText('6200 Rent, January 2026')).toBeNull();
    expect(screen.getAllByText('150,000.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Copy to draft' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByText('Save figures')).toBeNull();
  });

  it('copies into the next year and opens the new draft', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 3, written: 2 });
    wrap(<Budgets company={company} onGo={vi.fn()} />);
    fireEvent.click(await screen.findByText('Budget 2026'));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy to draft' }));
    expect(screen.getByText(/stays the plan for 2026 until it is archived/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/budgets/1/copy', { company_id: 2, year: 2026 }));
    await screen.findByLabelText('6200 Rent, January 2027');
  });

  it('says what is missing rather than asking the server, without finance.reports.view', () => {
    app.set({ bootstrap: { permissions: ['finance.view'] } as never });
    wrap(<Budgets company={company} onGo={vi.fn()} />);
    expect(screen.getByText(/which you do not hold/)).toBeTruthy();
    expect(apiGet).not.toHaveBeenCalled();
  });
});

describe('Year-end close', () => {
  it('lists the blockers above everything, each linked to the screen that clears it, and withholds Approve', async () => {
    const onGo = vi.fn();
    wrap(<YearEnd company={company} onGo={onGo} />);
    await screen.findByText('Annual report FY 2025/26');
    expect(screen.getByText('3 things must be finished before this year can be signed.')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Open Reconciliation')[0]!);
    expect(onGo).toHaveBeenCalledWith('reconcile');
    fireEvent.click(screen.getAllByText('Open Journals')[0]!);
    expect(onGo).toHaveBeenCalledWith('journals');
    fireEvent.click(screen.getByText('Open Depreciation'));
    expect(onGo).toHaveBeenCalledWith('depreciation');
    expect(screen.getByText('Tick it on the checklist below.')).toBeTruthy();
    // "0" from the database is not balanced, and "0" is not required.
    expect(screen.getByText('does not balance')).toBeTruthy();
    expect(screen.getByText('The current version does not balance. Do not issue it.')).toBeTruthy();
    expect(screen.getByText('does not block signing')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve v2/ })).toBeNull();
    expect(screen.getByText('Approving waits until nothing above is blocking.')).toBeTruthy();
  });

  it('tells the person who generated a version that somebody else approves it', async () => {
    yearEndPayload = yearEnd({ readiness: READY, versions: [version({ generated_by_name: 'Hasarinda Manjula' })] });
    wrap(<YearEnd company={company} onGo={vi.fn()} />);
    await screen.findByText(/You generated this version, so somebody else has to approve it/);
    expect(screen.queryByRole('button', { name: /Approve v2/ })).toBeNull();
    expect(screen.getByText('Nothing is blocking approval.')).toBeTruthy();
  });

  it('keeps the server’s refusal on the version when the books have moved', async () => {
    yearEndPayload = yearEnd({ readiness: READY, versions: [version({ balanced: '1' })] });
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(422, 'The books have changed since this version was generated. Generate a fresh one and approve that, or it would be signed over figures that are no longer current.', null, { blockers: [] }));
    wrap(<YearEnd company={company} onGo={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve v2' }));
    expect(screen.getByText(/profit LKR -600,000.00, assets LKR 12,000,000.00/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/annual-report/versions/9/approve', { company_id: 2 }));
    await screen.findByText('Not approved.');
    expect(screen.getByText(/The books have changed since this version was generated/)).toBeTruthy();
  });

  it('once approved, offers Lock and points at Periods for closing the year', async () => {
    yearEndPayload = yearEnd({ readiness: READY, report: { id: '5', title: 'Annual report FY 2025/26', status: 'approved' }, versions: [version({ status: 'approved', approved_by_name: 'Kamal Silva', approved_at: '2026-09-25 09:00:00' })] });
    const onGo = vi.fn();
    wrap(<YearEnd company={company} onGo={onGo} />);
    await screen.findByText(/approved by Kamal Silva on 25 Sep 2026/);
    expect(screen.getByRole('button', { name: 'Lock' })).toBeTruthy();
    fireEvent.click(screen.getByText(/It does not close the year’s periods/));
    expect(onGo).toHaveBeenCalledWith('periods');
  });

  it('points out an earlier year that has ended and is still open, and switches the workspace to it', async () => {
    const older = { id: 1, org_id: 2, name: 'FY 1999/00', starts_on: '1999-04-01', ends_on: '2000-03-31', status: 'open' };
    const newer = { id: 2, org_id: 2, name: 'FY 2998/99', starts_on: '2998-04-01', ends_on: '2999-03-31', status: 'open' };
    vi.mocked(apiGet).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
      if (path === '/api/finance/periods') return { years: [older, newer], periods: [] };
      if (path === '/api/finance/annual-report') return query?.from === older.starts_on ? { ...yearEnd({ report: null, versions: [], tasks: [], history: [] }), year: older } : { ...yearEnd({ report: null, versions: [], tasks: [], history: [] }), year: newer };
      throw new Error(`unexpected ${path}`);
    });
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 6 });
    wrap(<YearEnd company={company} onGo={vi.fn()} />);
    await screen.findByText(/Opening the close workspace for/);
    fireEvent.click(await screen.findByText('Close FY 1999/00 instead'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/finance/annual-report', { company: 2, from: '1999-04-01', to: '2000-03-31' }, expect.anything()));
    await screen.findByText('FY 1999/00', { selector: 'b' });
    fireEvent.click(screen.getByText('Open the close workspace'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/annual-report', { company_id: 2 }, { from: '1999-04-01', to: '2000-03-31' }));
  });
});
