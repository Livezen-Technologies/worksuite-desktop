// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiPost } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const insight = await import('../../../src/modules/finance/insight');
const { default: FinancialOverview } = await import('../../../src/modules/finance/FinancialOverview');
const { default: CashOverview } = await import('../../../src/modules/finance/CashOverview');
const { default: Variance } = await import('../../../src/modules/finance/Variance');
const { default: Consolidated } = await import('../../../src/modules/finance/Consolidated');

/*
 * The reading screens of Finance, drawn from payloads shaped as the server
 * sends them (OverviewController, BudgetController, Outlook), to prove they
 * say what matters: the comparison window, a refused rate, favourability by
 * the kind of account, a company left out of a total — and that the files and
 * the print page are asked for with the right arguments.
 */

const company = { id: 2, name: 'CreativeFX', base_currency: 'LKR', fiscal_year_start_month: 4, books_opened_at: '2026-04-01', has_books: true };
const CURRENCIES = [
  { code: 'LKR', name: 'Sri Lankan rupee', symbol: 'Rs', decimals: 2 },
  { code: 'USD', name: 'US dollar', symbol: '$', decimals: 2 },
  { code: 'AUD', name: 'Australian dollar', symbol: '$', decimals: 2 },
];
const BASE_FX = { ok: true, translated: false, base: 'LKR', currency: 'LKR' };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const overview = (over: Record<string, unknown> = {}) => ({
  company: { id: 2, name: 'CreativeFX' },
  currency: 'LKR',
  base_currency: 'LKR',
  fx: BASE_FX,
  position_fx: BASE_FX,
  currencies: CURRENCIES,
  from: '2026-01-01',
  to: '2026-09-28',
  previous: { from: '2025-04-05', to: '2025-12-31' },
  kpis: [
    { key: 'revenue', label: 'Total revenue', value: '5400000.00', previous: '4800000.00', change_pct: '12.50' },
    { key: 'expenses', label: 'Total expenses', value: '3600000.00', previous: '3000000.00', change_pct: '20.00' },
    { key: 'gross_profit', label: 'Gross profit', value: '2000000.00', previous: '0.00', change_pct: null },
    { key: 'assets', label: 'Total assets', value: '9000000.00', previous: null, change_pct: null },
  ],
  months: ['2026-01', '2026-02'],
  series: {
    '2026-01': { revenue: '2000000.00', total_cost: '1500000.00', net_profit: '500000.00' },
    '2026-02': { revenue: '3400000.00', total_cost: '2100000.00', net_profit: '-100000.00' },
  },
  profitability: {
    subtotals: { revenue: '5400000.00', cogs: '1200000.00', gross_profit: '4200000.00', expenses: '2400000.00', operating_profit: '1800000.00', other_income: '0.00', other_expense: '0.00' },
    net_profit: '1800000.00',
    margins: { gross: '77.78', operating: '33.33', net: '33.33' },
  },
  costs: { months: [], accounts: [{ account_id: 62, code: '6200', name: 'Rent', type: 'expense', months: {}, total: '1500000.00' }] },
  cost_dimensions: [
    { dimension: 'cost_behaviour', label: 'Fixed or variable', rows: [], total: '3600000.00', attributed: '0.00', unattributed: '3600000.00', coverage_pct: '0.00', has_activity: true, available: true, why: null },
    { dimension: 'supplier', label: 'Supplier', rows: [{ key: '5', name: 'Dialog Axiata', total: '300000.00' }], total: '3600000.00', attributed: '300000.00', unattributed: '3300000.00', coverage_pct: '8.33', has_activity: true, available: true, why: null },
    { dimension: 'project', label: 'Project', rows: [], total: '0.00', attributed: '0.00', unattributed: '0.00', coverage_pct: null, has_activity: false, available: false, why: 'This installation does not record projects on journal lines yet.' },
  ],
  revenue: { months: [], accounts: [] },
  variance: [{ account_id: 62, code: '6200', name: 'Rent', current: '1500000.00', previous: '1000000.00', change: '500000.00', change_pct: '50.00' }],
  health: [
    { level: 'warn', text: 'Costs are more than 15% above the previous period.' },
    { level: 'good', text: 'The period is profitable.' },
  ],
  basis: 'Posted journals only (posted and reversed). Documents raised but not yet posted are excluded — see Not in the ledger.',
  unposted: [{ kind: 'invoice', id: 12 }],
  ...over,
});

const CASH = {
  company: { id: 2, name: 'CreativeFX' },
  currency: 'LKR',
  base_currency: 'LKR',
  fx: BASE_FX,
  position_fx: BASE_FX,
  currencies: CURRENCIES,
  from: '2026-01-01',
  to: '2026-09-28',
  summary: { opening: '1000000.00', inflows: '5000000.00', outflows: '4200000.00', net: '800000.00', closing: '1800000.00', transfers: '250000.00' },
  inflows: [{ category: 'Customer receipts', amount: '5000000.00', entries: 12, accounts: [{ account_id: 1130, code: '1130', name: 'Accounts receivable' }] }],
  outflows: [{ category: 'Salaries', amount: '4200000.00', entries: 9, accounts: [] }],
  monthly: { '2026-01': { in: '2000000.00', out: '1800000.00', net: '200000.00' } },
  accounts: [{ account_id: 12, code: '1120', name: 'Bank', currency: 'LKR', reconcilable: true, opening: '1000000.00', in: '5000000.00', out: '4200000.00', net: '800000.00', closing: '1800000.00' }],
  statement: { currency: 'LKR', movement: '800000.00', derived: '800000.00', reconciles: true },
  agrees: true,
  note: null,
};

const FORECAST = {
  company: { id: 2, name: 'CreativeFX' },
  currency: 'LKR',
  base_currency: 'LKR',
  fx: BASE_FX,
  estimated: true,
  max_months: 12,
  method: 'trend',
  confidence: 'low',
  history_months: 8,
  months: [
    {
      month: '2026-10',
      revenue: '2000000.00',
      expenses: '2600000.00',
      profit: '-600000.00',
      closing_cash: '-200000.00',
      estimated: true,
      basis: { scheduled_in: '500000.00', scheduled_out: '1200000.00', extrapolated_in: '2000000.00', extrapolated_out: '2600000.00', method: 'trend' },
    },
  ],
  risks: [{ month: '2026-10', expected_closing: '-200000.00', shortfall: '200000.00', scheduled_out: '1200000.00', why: 'Expected outgoings exceed the cash expected to be available.' }],
  note: 'Each month is the average of the last six, with a straight-line trend applied forward.',
};

const VARIANCE = {
  ok: true,
  currency: 'LKR',
  budget: { id: 1, name: 'Plan 2026', year: 2026, status: 'approved' },
  from: '2026-01-01',
  to: '2026-09-28',
  months_elapsed: ['2026-01', '2026-09'],
  partial_month: { month: '2026-09', days_elapsed: 28, days_in_month: 30, fraction: '93.33' },
  rows: [
    { account_id: 62, code: '6200', name: 'Rent', type: 'expense', is_income: false, budget: '4800000.00', actual: '5200000.00', variance: '400000.00', variance_pct: '8.33', favourable: false, unbudgeted: false },
    { account_id: 41, code: '4100', name: 'Product sales', type: 'revenue', is_income: true, budget: '4800000.00', actual: '5200000.00', variance: '400000.00', variance_pct: '8.33', favourable: true, unbudgeted: false },
    { account_id: 65, code: '6500', name: 'Travel', type: 'expense', is_income: false, budget: '0.00', actual: '120000.00', variance: '120000.00', variance_pct: null, favourable: false, unbudgeted: true },
  ],
  totals: {
    income: { budget: '4800000.00', actual: '5200000.00', variance: '400000.00', favourable: true, remaining_plan: '1600000.00' },
    cost: { budget: '4800000.00', actual: '5320000.00', variance: '520000.00', favourable: false, remaining_plan: '1600000.00' },
    profit: { budget: '0.00', actual: '-120000.00', variance: '-120000.00' },
  },
  note: '9 of 12 month(s) compared. The rest of the plan is reported separately as remaining, not as an underspend.',
};

const own = (r: string) => ({ revenue: r, expenses: '0.00', gross_profit: r, net_profit: r, cash: '0.00' });
const CONSOLIDATED = {
  from: '2026-01-01',
  to: '2026-12-31',
  rows: [
    { company: { id: 2, name: 'CreativeFX' }, has_books: true, currency: 'LKR', own: own('30000000.00'), translated: own('100000.00'), fx: { ok: true, translated: true, currency: 'USD', flow_rate: '0.00333333', position_rate: '0.00333333' } },
    { company: { id: 4, name: 'TechHubiz' }, has_books: true, currency: 'AUD', own: own('50000.00'), translated: null, fx: { ok: false, translated: false, currency: 'AUD', why: 'No AUD→USD rate is available.' } },
    { company: { id: 5, name: 'Livezen Labs' }, has_books: true, currency: 'USD', own: own('20000.00'), translated: own('20000.00'), fx: { ok: true, translated: false, currency: 'USD' } },
    { company: { id: 6, name: 'Dormant Ltd' }, has_books: false },
  ],
  currencies: ['LKR', 'AUD', 'USD'],
  currency_options: CURRENCIES,
  mixed_currency: true,
  presentation_currency: 'USD',
  total: { ...own('120000.00'), currency: 'USD', companies_counted: 2, companies_with_books: 3, complete: false },
  untranslated: [{ company: 'TechHubiz', currency: 'AUD', why: 'No AUD→USD rate is available.' }],
  note: '1 company/companies could not be translated and are excluded from the total. Add the missing rates under Exchange rates.',
};

let overviewPayload: ReturnType<typeof overview> = overview();

beforeEach(() => {
  overviewPayload = overview();
  app.set({ bootstrap: { permissions: ['*'] } as never, auth: { server: { origin: 'https://ws.example.com' } } as never });
  vi.mocked(call).mockResolvedValue(true as never);
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/finance/overview/financial') return overviewPayload;
    if (path === '/api/finance/overview/cash-flow') return CASH;
    if (path === '/api/finance/overview/forecast') return FORECAST;
    if (path === '/api/finance/overview/budget-variance') return VARIANCE;
    if (path === '/api/finance/overview/consolidated') return CONSOLIDATED;
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('finance insight helpers', () => {
  it('named periods resolve from today’s digits, not through UTC', () => {
    const t = '2026-09-28';
    expect(insight.periodRange('this_year', t)).toEqual({ from: '2026-01-01', to: t });
    expect(insight.periodRange('this_month', t)).toEqual({ from: '2026-09-01', to: t });
    expect(insight.periodRange('last_month', t)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(insight.periodRange('last_month', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(insight.periodRange('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(insight.periodRange('this_quarter', t)).toEqual({ from: '2026-07-01', to: t });
    expect(insight.periodRange('this_quarter', '2026-02-10')).toEqual({ from: '2026-01-01', to: '2026-02-10' });
    expect(insight.periodRange('last_year', t)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(insight.periodRange('twelve', t)).toEqual({ from: '2025-10-01', to: t });
    expect(insight.rangeProblem({ from: '2026-05-01', to: '2026-04-01' })).toBe('The start of the period is after its end.');
    expect(insight.rangeProblem({ from: '', to: '2026-04-01' })).toBe('Give both dates.');
    expect(insight.rangeProblem({ from: '2026-01-01', to: '2026-04-01' })).toBeNull();
  });

  it('a change is coloured by what it means: up is bad for a cost, and no base means no comparison', () => {
    expect(insight.pctText('12.50')).toBe('+12.5%');
    expect(insight.pctText('-3')).toBe('-3.0%');
    expect(insight.pctText(null)).toBeNull();
    expect(insight.deltaTone('12.5')).toBe('good');
    expect(insight.deltaTone('12.5', true)).toBe('bad');
    expect(insight.deltaTone('-4', true)).toBe('good');
    expect(insight.deltaTone('0')).toBe('flat');
    expect(insight.deltaTone(null)).toBe('none');
  });

  it('budget colour follows favourable, and profit its own sign', () => {
    expect(insight.favourTone(false)).toBe('bad');
    expect(insight.favourTone(true)).toBe('good');
    expect(insight.favourTone(null)).toBe('none');
    expect(insight.profitTone('-120000.00')).toBe('bad');
    expect(insight.profitTone('5.00')).toBe('good');
    expect(insight.profitTone('0.00')).toBe('flat');
    expect(insight.signedMoney('400000', 'LKR')).toBe('LKR +400,000.00');
    expect(insight.signedMoney('-1250.5', 'LKR')).toBe('LKR -1,250.50');
    expect(insight.signedMoney('0', 'JPY', 0)).toBe('JPY 0');
  });

  it('report buttons follow the route filters, including the dashboards’ own export slugs', () => {
    const general = ['finance.reports.view', 'finance.reports.export', 'finance.reports.print'];
    expect(insight.reportGates(general, 'financial-overview')).toEqual({ export: false, lines: false, print: true, share: false });
    expect(insight.reportGates(general, 'budget-variance').export).toBe(true);
    expect(insight.reportGates(['finance.reports.view', 'finance.cashflow.export'], 'cash-flow').export).toBe(true);
    expect(insight.reportGates(['finance.cashflow.export', 'finance.reports.download'], 'cash-flow')).toEqual({ export: false, lines: false, print: false, share: false });
    expect(insight.reportGates(['*'], 'financial-overview')).toEqual({ export: true, lines: true, print: true, share: true });
    expect(insight.horizons(['finance.forecast.view'])).toEqual([3]);
    expect(insight.horizons(['finance.forecast.manage'])).toEqual([3, 6, 12]);
    expect(insight.missingSlugs(['finance.reports.view'], insight.SCREEN_SLUGS.consolidated)).toEqual(['finance.consolidated.view']);
  });

  it('print and share addresses', () => {
    expect(insight.printPath('cash-flow', 2, '2026-01-01', '2026-09-28', 'USD')).toBe('/finance/print/cash-flow?company=2&from=2026-01-01&to=2026-09-28&currency=USD');
    expect(insight.printPath('budget-variance', 2, '2026-01-01', '2026-09-28')).toBe('/finance/print/budget-variance?company=2&from=2026-01-01&to=2026-09-28');
    expect(insight.shareLink('https://ws.example.com/', '/finance/shared/abc')).toBe('https://ws.example.com/finance/shared/abc');
    expect(insight.shareLink(null, '/finance/shared/abc')).toBeNull();
  });

  it('what the translation did: base, translated, refused, or a mix it must not show', () => {
    expect(insight.fxState(undefined)).toBe('base');
    expect(insight.fxState(BASE_FX)).toBe('base');
    expect(insight.fxState({ ...BASE_FX, ok: false, requested: 'USD', why: 'none' })).toBe('refused');
    const usd = { ok: true, translated: true, base: 'LKR', currency: 'USD', rate: '0.0033' };
    expect(insight.fxState(usd, usd)).toBe('translated');
    expect(insight.fxState(usd, { ...BASE_FX, ok: false, requested: 'USD' })).toBe('mixed');
  });

  it('dimensions rank by coverage, with a missing column last; a consolidated row says whether it is counted', () => {
    const ranked = insight.rankDimensions(overview().cost_dimensions as never);
    expect(ranked.map((d) => d.dimension)).toEqual(['supplier', 'cost_behaviour', 'project']);
    const r = insight.companyRow(CONSOLIDATED.rows[1] as never, CONSOLIDATED.untranslated);
    expect(r).toMatchObject({ currency: 'AUD', counted: false, notes: ['Books in AUD', 'not translated', 'not in the total'] });
    expect(r.figures.revenue).toBe('50000.00');
    const t = insight.companyRow(CONSOLIDATED.rows[0] as never, CONSOLIDATED.untranslated);
    expect(t).toMatchObject({ currency: 'USD', counted: true, notes: ['Books in LKR', 'shown in USD'] });
  });

  it('chart scale keeps zero inside and never divides by nothing', () => {
    expect(insight.chartScale([['100', '-50'], ['20']])).toEqual({ max: 100, min: -50, span: 150 });
    expect(insight.chartScale([['0']])).toEqual({ max: 0, min: 0, span: 1 });
    expect(insight.axisShort(1250000)).toBe('1.3M');
    expect(insight.axisShort(-4200)).toBe('-4K');
    expect(insight.monthShort('2026-09')).toBe('Sep');
    expect(insight.monthShort('2026-09', true)).toBe('Sep 26');
    expect(insight.monthLong('2026-10')).toBe('October 2026');
    expect(insight.shareOf('-50', '200')).toBe(25);
    expect(insight.unpostedCount([{}, {}])).toBe(2);
  });
});

describe('the financial overview', () => {
  it('compares each KPI with the window before it, and says which are balances', async () => {
    wrap(<FinancialOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Total revenue');
    expect(apiGet).toHaveBeenCalledWith('/api/finance/overview/financial', expect.objectContaining({ company: 2 }), expect.anything());
    const pill = (t: string) => screen.getByText(t).closest('[data-stat-trend]')!;
    expect(pill('+12.5%').getAttribute('data-stat-trend')).toBe('up');
    expect(pill('+12.5%').className).toContain('is-good');
    // Costs up is bad: the same arrow, and the pill says it is bad news.
    expect(pill('+20.0%').getAttribute('data-stat-trend')).toBe('up');
    expect(pill('+20.0%').className).toContain('is-bad');
    expect(screen.getByText('No comparison — nothing in the previous period')).toBeTruthy();
    expect(screen.getByText('A balance on 28 Sep 2026 — not compared')).toBeTruthy();
    expect(screen.getByText(/Compared with 5 Apr 2025 to 31 Dec 2025 — the same length of time immediately before this period\. Posted journals only/)).toBeTruthy();
    expect(screen.getByText('1 document is waiting to post')).toBeTruthy();
    expect(screen.getByText('Costs are more than 15% above the previous period.')).toBeTruthy();
    expect(screen.getByText('77.8% margin')).toBeTruthy();
    expect(screen.getByText('(LKR 1,200,000.00)')).toBeTruthy();
    // The best-covered dimension opens first, with its coverage said.
    expect(screen.getByText('8.3% of cost carries a supplier.')).toBeTruthy();
  });

  it('offers to classify the accounts from the fixed-or-variable tab', async () => {
    const onGo = vi.fn();
    wrap(<FinancialOverview company={company} onGo={onGo} />);
    await screen.findByText('Total revenue');
    fireEvent.click(screen.getByRole('tab', { name: /Fixed or variable/ }));
    expect(screen.getByText('Nothing carries a fixed or variable.')).toBeTruthy();
    fireEvent.click(screen.getByText('Classify the accounts'));
    expect(onGo).toHaveBeenCalledWith('accounts');
  });

  it('exports and prints with the company, the window and nothing else', async () => {
    wrap(<FinancialOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Total revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('transfers:download', { financeCsv: { report: 'financial-overview', company: 2, from: '2026-01-01', to: '2026-09-28' }, name: 'financial-overview.csv' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('transfers:download', { financeCsv: { report: 'financial-overview', lines: true, company: 2, from: '2026-01-01', to: '2026-09-28' }, name: 'financial-overview-transactions.csv' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/finance/print/financial-overview?company=2&from=2026-01-01&to=2026-09-28' });
  });

  it('a translated page exports in the currency it shows; the transactions stay in the books’ own', async () => {
    const usd = { ok: true, translated: true, base: 'LKR', currency: 'USD', rate: '0.00333333', method: 'average', rate_date: '2026-09-28', note: 'Nothing is posted.' };
    overviewPayload = overview({ currency: 'USD', fx: usd, position_fx: { ...usd, method: 'closing' } });
    wrap(<FinancialOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Total revenue');
    expect(screen.getByText(/translated from LKR at 0.00333333/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', expect.objectContaining({ financeCsv: expect.objectContaining({ currency: 'USD' }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', expect.objectContaining({ financeCsv: { report: 'financial-overview', lines: true, company: 2, from: '2026-01-01', to: '2026-09-28' } })));
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/finance/print/financial-overview?company=2&from=2026-01-01&to=2026-09-28&currency=USD' });
  });

  it('a missing rate is refused and said, and every figure stays in the books’ currency', async () => {
    overviewPayload = overview({ fx: { ok: false, translated: false, base: 'LKR', currency: 'LKR', requested: 'USD', why: 'No LKR→USD rate is available for this period.' } });
    wrap(<FinancialOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Total revenue');
    expect(screen.getByText('Still showing LKR — not USD.')).toBeTruthy();
    expect(screen.getByText(/No LKR→USD rate is available for this period\. Nothing on this page has been converted/)).toBeTruthy();
    expect(screen.getAllByText('LKR 5,400,000.00').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^USD /)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { financeCsv: { report: 'financial-overview', company: 2, from: '2026-01-01', to: '2026-09-28' }, name: 'financial-overview.csv' }));
  });

  it('flows translated and balances not is shown as neither', async () => {
    const usd = { ok: true, translated: true, base: 'LKR', currency: 'USD', rate: '0.0033' };
    overviewPayload = overview({ currency: 'USD', fx: usd, position_fx: { ok: false, translated: false, base: 'LKR', currency: 'LKR', requested: 'USD', why: 'No LKR→USD rate on or before 28 September 2026.' } });
    wrap(<FinancialOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('This cannot be shown in USD.');
    expect(screen.queryByText('Total revenue')).toBeNull();
    expect(screen.getByText('Show it in LKR')).toBeTruthy();
  });

  it('the Export button follows the overview’s own slug, not the general one', async () => {
    app.set({ bootstrap: { permissions: ['finance.view', 'finance.reports.view', 'finance.financial_overview.view', 'finance.reports.export', 'finance.reports.print'] } as never });
    wrap(<FinancialOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Total revenue');
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share link' })).toBeNull();
  });

  it('without the grants, says which and asks for nothing', () => {
    app.set({ bootstrap: { permissions: ['finance.view'] } as never });
    wrap(<FinancialOverview company={company} onGo={vi.fn()} />);
    expect(screen.getByText('finance.reports.view')).toBeTruthy();
    expect(screen.getByText('finance.financial_overview.view')).toBeTruthy();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('a share link is confirmed, made, and copied from the server’s address', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 9, url: '/finance/shared/abc123', expires_at: '2026-10-05 10:00:00' });
    wrap(<FinancialOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Total revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    expect(screen.getByText(/without signing in\. It expires in 7 days/)).toBeTruthy();
    expect(screen.getByText(/It shows the figures in LKR, the currency the books are kept in/)).toBeTruthy();
    fireEvent.click(screen.getByText('Create the link'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/export/financial-overview/share', { days: 7 }, { company: 2, from: '2026-01-01', to: '2026-09-28' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://ws.example.com/finance/shared/abc123'));
  });

  it('a link the clipboard would not take is shown to copy by hand', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 9, url: '/finance/shared/abc123' });
    wrap(<FinancialOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Total revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    fireEvent.click(screen.getByText('Create the link'));
    await screen.findByText('Copy this link now');
    expect((screen.getByLabelText('Share link') as HTMLInputElement).value).toBe('https://ws.example.com/finance/shared/abc123');
  });
});

describe('the cash flow overview', () => {
  it('shows the direct method, the check against the statement, and the transfers left out', async () => {
    wrap(<CashOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Opening balance');
    expect(screen.getByText('Agrees with the indirect cash flow statement under Reports.')).toBeTruthy();
    expect(screen.getByText(/LKR 250,000.00 moved between this company’s own accounts/)).toBeTruthy();
    expect(screen.getByText('Opening + in − out = closing.')).toBeTruthy();
    expect(screen.getByText('Customer receipts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { financeCsv: { report: 'cash-flow', company: 2, from: '2026-01-01', to: '2026-09-28' }, name: 'cash-flow.csv' }));
  });

  it('the forecast is estimated, names a shortfall, and looks further only with forecast.manage', async () => {
    wrap(<CashOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Possible shortfall in October 2026.');
    expect(screen.getByText('estimated', { selector: 'span.inline-flex' })).toBeTruthy();
    expect(screen.getByText('LKR 500,000.00 in · LKR 1,200,000.00 out')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/finance/overview/forecast', { company: 2, months: 3, currency: undefined }, expect.anything());
    fireEvent.click(screen.getByRole('tab', { name: '12 months' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/finance/overview/forecast', { company: 2, months: 12, currency: undefined }, expect.anything()));
  });

  it('without forecast.manage only three months are offered; without forecast.view the actuals still show', async () => {
    app.set({ bootstrap: { permissions: ['finance.reports.view', 'finance.cashflow.view', 'finance.forecast.view'] } as never });
    const { unmount } = wrap(<CashOverview company={company} onGo={vi.fn()} />);
    await screen.findByText(/Three months ahead\. Further needs/);
    expect(screen.queryByRole('tab', { name: '12 months' })).toBeNull();
    // No export slug held: no Export button.
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    unmount();
    app.set({ bootstrap: { permissions: ['finance.reports.view', 'finance.cashflow.view'] } as never });
    wrap(<CashOverview company={company} onGo={vi.fn()} />);
    await screen.findByText('Opening balance');
    expect(screen.getByText('finance.forecast.view')).toBeTruthy();
    expect(vi.mocked(apiGet).mock.calls.filter(([p]) => p === '/api/finance/overview/forecast').length).toBe(1);
  });
});

describe('budget against actual', () => {
  it('colours by favourable: over plan is red on a cost and green on income', async () => {
    wrap(<Variance company={company} onGo={vi.fn()} />);
    await screen.findByText('Rent');
    const rent = screen.getByText('Rent').closest('[data-favourable]') as HTMLElement;
    const sales = screen.getByText('Product sales').closest('[data-favourable]') as HTMLElement;
    expect(within(rent).getByText('+8.3%').className).toContain('text-danger');
    expect(within(sales).getByText('+8.3%').className).toContain('text-success');
    expect(within(screen.getByText('Travel').closest('[data-favourable]') as HTMLElement).getByText('not budgeted')).toBeTruthy();
    // The totals are stat cards; their variance is the trend pill, which says good or bad news in words and an arrow.
    // Profit has no favourable: behind plan is bad news by its sign.
    const pill = (el: HTMLElement) => el.closest('[data-stat-trend]') as HTMLElement;
    const profit = screen.getByRole('group', { name: 'Profit against plan' });
    const profitPill = profit.querySelector('[data-stat-trend]') as HTMLElement;
    expect(profitPill.textContent).toContain('LKR -120,000.00');
    expect(profitPill.className).toContain('is-bad');
    expect(profitPill.getAttribute('data-stat-trend')).toBe('down');
    expect(pill(screen.getByText('LKR +400,000.00')).className).toContain('is-good');
    expect(pill(screen.getByText('LKR +520,000.00')).className).toContain('is-bad');
    expect(screen.getByRole('group', { name: 'Cost' }).getAttribute('data-favourable')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { financeCsv: { report: 'budget-variance', company: 2, from: '2026-01-01', to: '2026-09-28' }, name: 'budget-variance.csv' }));
  });

  it('a year with no approved plan is a sentence, not an error', async () => {
    vi.mocked(apiGet).mockResolvedValue({ ok: false, year: 2027, currency: 'LKR', message: 'No approved budget for 2027. Create one under Budgets and approve it, and this will compare against it.' });
    const onGo = vi.fn();
    wrap(<Variance company={company} onGo={onGo} />);
    await screen.findByText(/No approved budget for 2027/);
    fireEvent.click(screen.getByText('Go to Budgets'));
    expect(onGo).toHaveBeenCalledWith('budgets');
  });
});

describe('all companies', () => {
  it('lists an untranslated company with its own figures and leaves it out of the total, saying so', async () => {
    wrap(<Consolidated company={company} onGo={vi.fn()} />);
    await screen.findByText('Consolidated total');
    expect(apiGet).toHaveBeenCalledWith('/api/finance/overview/consolidated', expect.not.objectContaining({ company: expect.anything() }), expect.anything());
    expect(screen.getByText(/not only CreativeFX/)).toBeTruthy();
    expect(screen.getByText('1 company is not in the total.')).toBeTruthy();
    expect(screen.getByText('TechHubiz (AUD) — No AUD→USD rate is available.')).toBeTruthy();
    expect(screen.getByText('incomplete')).toBeTruthy();
    expect(screen.getByText(/2 of 3 companies with books/)).toBeTruthy();
    const tech = screen.getByText('TechHubiz', { selector: 'b' }).closest('[data-counted]') as HTMLElement;
    expect(tech.dataset.counted).toBe('no');
    expect(within(tech).getByText('Books in AUD · not translated · not in the total')).toBeTruthy();
    expect(within(tech).getAllByText('AUD 50,000.00').length).toBeGreaterThan(0);
    const cfx = screen.getByText('CreativeFX', { selector: 'b' }).closest('[data-counted]') as HTMLElement;
    expect(within(cfx).getByText('Books in LKR · shown in USD')).toBeTruthy();
    expect(within(cfx).getAllByText('USD 100,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('USD 120,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('No books opened.')).toBeTruthy();
  });
});
