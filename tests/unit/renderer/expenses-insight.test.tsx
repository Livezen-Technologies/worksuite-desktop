// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';
import type { Org } from '../../../src/modules/expenses/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const i = await import('../../../src/modules/expenses/insight');
const { default: Dashboard } = await import('../../../src/modules/expenses/Dashboard');
const { default: Analytics } = await import('../../../src/modules/expenses/Analytics');
const { default: Consolidated } = await import('../../../src/modules/expenses/Consolidated');

/*
 * The insight screens, drawn from payloads shaped as the server sends them
 * (InsightsController, Insights::dashboardMany, ReportController) — flags and
 * counts as strings where PHP would send them so — to prove they render and
 * say the things that matter, without a server.
 */

const org = (id: number, name: string, extra: Partial<Org> = {}): Org => ({ id, name, slug: name.toLowerCase(), role: 'finance', member: true, currency: 'LKR', favourite: false, ...extra });
const ORGS = [org(1, 'Livezen'), org(3, 'CreativeFx', { role: 'member' }), org(5, 'Gulf Trading', { currency: 'AED', member: false, can_act: false, role: null })];

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const months = (totals: string[]) =>
  totals.map((t, k) => ({ month: `2026-${String(k + 1).padStart(2, '0')}`, label: `M${k + 1}`, total: t, count: String(k + 1) }));

/** Two companies, one currency — what `dashboardMany()` returns. */
const TWO_LKR = {
  organization: null,
  organizations: [
    { id: 1, name: 'Livezen', currency: 'LKR', role: 'finance' },
    { id: 3, name: 'CreativeFx', currency: 'LKR', role: 'member' },
  ],
  consolidated: true,
  scope: 'consolidated',
  currency: 'LKR',
  mixed_currency: false,
  totals_by_currency: { LKR: '150000.00' },
  note: null,
  fiscal_year: { label: 'FY 2026/27', start: '2026-04-01', end: '2027-03-31' },
  month: { label: 'September 2026', total: '150000.00', by_status: {}, last_month: '100000.00', change_pct: 50 },
  awaiting_me: '4',
  my_unpaid: { count: '2', total: '12500.00' },
  advances: { count: 0, total: '0.00' },
  budgets: [{ id: 7, name: 'Travel', currency: 'LKR', amount: '100000.00', used: '120000.00', remaining: '-20000.00', pct: 120, hard_stop: '0', period: 'Sep 2026', forecast: null, org_id: 1, org_name: 'Livezen' }],
  cards_unmatched: { count: '3', value: '45000.00' },
  subscriptions_due: '9',
  subscriptions_upcoming: [
    { id: 9, name: 'Figma', vendor: 'Figma Inc', category: 'Software', amount: '36000.00', currency: 'USD', renews_on: '2026-10-01', days_until: '3', auto_renew: '0', org_id: 1, org_name: 'Livezen' },
  ],
  duplicates_open: '0',
  stalled: [{ approval_id: 11, entity_type: 'claim', entity_id: '41', label: 'EXP-0041 Taxi', days_waiting: '6', reason: 'No approver could be matched to this step.', org_id: 1, org_name: 'Livezen' }],
  overdue_advances: [],
  by_category: [
    { id: 1, name: 'Travel', n: '5', t: '90000.00' },
    { id: 2, name: 'Meals', n: '9', t: '60000.00' },
  ],
  trend: months(['0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '20000.00', '100000.00', '150000.00']),
  trend_categories: { months: [], categories: ['Travel', 'Meals', 'Other'], cells: { '2026-10': { Travel: 90000, Meals: 50000, Other: 10000 } } },
  petty_cash: null,
};

/** Two companies in different currencies. */
const MIXED = {
  ...TWO_LKR,
  organizations: [
    { id: 1, name: 'Livezen', currency: 'LKR', role: 'finance' },
    { id: 5, name: 'Gulf Trading', currency: 'AED', role: 'finance' },
  ],
  currency: null,
  mixed_currency: true,
  totals_by_currency: { LKR: '150000.00', AED: '2400.00' },
  note: 'These organizations report in different currencies, so there is no single group total.',
  fiscal_year: null,
  month: { label: 'September 2026', total: '152400.00', by_status: {}, last_month: '100000.00', change_pct: 52.4 },
};

const CATALOGUE = {
  catalogue: [
    { key: 'by_category', title: 'Category analysis' },
    { key: 'petty_cash', title: 'Petty cash' },
  ],
  fiscal_year: { label: 'FY 2026/27', start: '2026-04-01', end: '2027-03-31' },
};

const BY_CATEGORY = {
  ok: true,
  title: 'Category analysis',
  period: '2026-04-01 to 2027-03-31',
  currency: 'LKR',
  columns: ['Category', 'Claims', 'Total (LKR)', 'Paid (LKR)'],
  rows: [
    ['Travel', '5', '90000.00', '40000.00'],
    ['Meals', '9', '60000.00', '60000.00'],
  ],
  total: '150000.00',
};

const acts = (exportAllowed: boolean) => ({
  areas: [
    { key: 'analytics', components: [{ key: 'metrics', verbs: [{ verb: 'view', allowed: true }, { verb: 'export', allowed: exportAllowed }] }] },
    { key: 'reports', components: [{ key: 'reports', verbs: [{ verb: 'view', allowed: true }, { verb: 'export', allowed: '1' }] }] },
  ],
});

const CONSOLIDATED = {
  period: { from: '2026-01-01', to: '2026-09-28' },
  organizations: [
    { org_id: 1, name: 'Livezen', currency: 'LKR', member: '1', can_act: '1', claims: '12', total: '200000.00', pending: '10000.00', owed: '5000.00', paid: '185000.00' },
    { org_id: 3, name: 'CreativeFx', currency: 'LKR', member: '1', can_act: '1', claims: '4', total: '100000.00', pending: '0.00', owed: '0.00', paid: '100000.00' },
    { org_id: 5, name: 'Gulf Trading', currency: 'AED', member: '0', can_act: '0', claims: '2', total: '1500.00', pending: '0.00', owed: '0.00', paid: '1500.00' },
  ],
  totals: [
    { currency: 'LKR', total: '300000.00' },
    { currency: 'AED', total: '1500.00' },
  ],
  note: 'These organizations report in different currencies, so there is no single group total.',
};

let exportAllowed = true;
let dashboard: unknown = TWO_LKR;

beforeEach(() => {
  exportAllowed = true;
  dashboard = TWO_LKR;
  app.set({ bootstrap: { permissions: ['*'] } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    if (path === '/api/expense/dashboard2') return dashboard;
    if (path === '/api/module-areas/expense') return acts(exportAllowed);
    if (path === '/api/expense/reports2') return query?.report ? BY_CATEGORY : CATALOGUE;
    if (path === '/api/expense/consolidated') return CONSOLIDATED;
    throw new Error(`unexpected ${path}`);
  });
  vi.mocked(call).mockResolvedValue(undefined as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('expenses insight: the arithmetic', () => {
  it('never reads "0" as true, and converts counts and ids once', () => {
    expect(i.flag('0')).toBe(false);
    expect(i.flag('false')).toBe(false);
    expect(i.flag(null)).toBe(false);
    expect(i.flag('1')).toBe(true);
    expect(i.flag(1)).toBe(true);
    expect(i.idOf('41')).toBe(41);
    expect(i.idOf('0')).toBeNull();
    const d = i.shapeDashboard(TWO_LKR);
    expect(d.renewals[0]!.autoRenew).toBe(false);
    expect(d.budgets[0]!.hardStop).toBe(false);
    expect(d.awaitingMe).toBe(4);
    expect(d.stalled[0]!.entityId).toBe(41);
    expect(d.duplicates).toBe(0);
  });

  it('sums in cents, sign kept, rounded half away from zero', () => {
    expect(i.toCents('1234.565')).toBe(123457);
    expect(i.toCents('-0.10')).toBe(-10);
    expect(i.toCents('1,200')).toBe(120000);
    expect(i.toCents('')).toBe(0);
    expect(i.classicTotal({ paid: { count: 2, total: '0.10' }, submitted: { count: 1, total: '0.20' }, rejected: { count: 3, total: '999.00' } })).toEqual({ total: '0.30', rejected: 3 });
  });

  it('puts the gridlines on round figures, and averages only the months with spending', () => {
    expect(i.ceilingOf([1534331.89], false)).toBe(2000000);
    expect(i.ceilingOf([3], true)).toBe(4);
    expect(i.ceilingOf([0, 0], false)).toBe(1);
    expect(i.meanOfSpent([0, 100, 0, 300])).toBe(200);
    const rows = months(['100.10', '50.05']).map((r) => ({ ...r, count: Number(r.count) }));
    expect(i.monthDelta(rows, 'money')).toEqual({ more: false, diff: '50.05' });
    expect(i.monthDelta(rows, 'count')).toEqual({ more: true, diff: '1' });
  });

  it('keeps a consolidated payload honest about currencies', () => {
    const d = i.shapeDashboard(MIXED);
    expect(d.mixed).toBe(true);
    expect(d.currency).toBeNull();
    expect(d.monthByCurrency).toEqual([
      { currency: 'AED', total: '2400.00' },
      { currency: 'LKR', total: '150000.00' },
    ]);
    expect(i.narrowIn(i.shapeDashboard(TWO_LKR))).toEqual(['CreativeFx']);
    expect(i.dashTitle(i.shapeDashboard(TWO_LKR))).toBe('Livezen and CreativeFx');
  });

  it('says stalled approvals in words', () => {
    const s = (entityType: string) => ({ entityType, entityId: 1, label: '', daysWaiting: 1, orgId: null, orgName: null });
    expect(i.stalledText([s('claim')])).toBe('1 claim has nobody able to approve it');
    expect(i.stalledText([s('claim'), s('advance')])).toBe('1 claim and 1 advance have nobody able to approve them');
  });

  it('reads report cells, and refuses a total across currencies', () => {
    expect(i.reportCell('90000.00')).toEqual({ text: '90,000.00', numeric: true });
    expect(i.reportCell('5')).toEqual({ text: '5', numeric: true });
    expect(i.reportCell('Travel')).toEqual({ text: 'Travel', numeric: false });
    const petty = { title: 'Petty cash', period: null, currency: 'LKR', columns: ['Fund', 'Currency', 'Balance'], rows: [['Office', 'LKR', '1000.00'], ['Dubai', 'AED', '50.00']], total: '1050.00', note: null };
    expect(i.reportTotal(petty)).toBeNull();
    expect(i.reportTotal({ ...petty, rows: [['Office', 'LKR', '1000.00']] })).toBe('1050.00');
    const grouped = { ...petty, columns: ['Category', 'Claims', 'Total (LKR)'], rows: [['A', '1', '200.00'], ['B', '1', '50.00']] };
    expect(i.reportBars(grouped)?.map((b) => b.share)).toEqual([100, 25]);
    expect(i.reportQuery(2, 'by_category', '', '2026-06-30')).toEqual({ org: '2', report: 'by_category', to: '2026-06-30' });
    expect(i.classicQuery(2, { from: '', to: '', status: 'paid', category: '4', currency: 'LKR' })).toEqual({ org: '2', status: 'paid', category_id: '4', currency: 'LKR' });
  });

  it('ranks amounts within a currency and totals per currency', () => {
    const rows = [
      { orgId: 1, name: 'A', currency: 'LKR', canAct: true, claims: 1, total: '100000.00', pending: '0', owed: '0', paid: '0' },
      { orgId: 2, name: 'B', currency: 'USD', canAct: true, claims: 9, total: '5000.00', pending: '0', owed: '0', paid: '0' },
      { orgId: 3, name: 'C', currency: 'LKR', canAct: false, claims: 2, total: '200000.00', pending: '0', owed: '0', paid: '0' },
    ];
    expect(i.sortConsolidated(rows, 'total', 'desc').map((r) => r.name)).toEqual(['C', 'A', 'B']);
    expect(i.sortConsolidated(rows, 'claims', 'desc').map((r) => r.name)).toEqual(['B', 'C', 'A']);
    expect(i.totalsByCurrency(rows)).toEqual([
      { currency: 'LKR', total: '300000.00' },
      { currency: 'USD', total: '5000.00' },
    ]);
    expect(i.filterConsolidated(rows, '', 'read').map((r) => r.name)).toEqual(['C']);
    expect(i.topByCurrency(rows)).toEqual({ LKR: 200000, USD: 5000 });
  });

  it('draws an export only where the area map allows it, and while unsure only if the map failed', () => {
    expect(i.mayDo(undefined, false, 'analytics.metrics.export')).toBe(false);
    expect(i.mayDo(undefined, true, 'analytics.metrics.export')).toBe(true);
    expect(i.mayDo({ 'analytics.metrics.export': false }, false, 'analytics.metrics.export')).toBe(false);
    expect(i.mayDo({ 'analytics.metrics.export': true }, false, 'analytics.metrics.export')).toBe(true);
  });
});

describe('expenses insight: the screens', () => {
  it('the dashboard adds two companies up and says whose figures they are', async () => {
    wrap(<Dashboard org="1,3" orgId={null} orgs={ORGS} onGo={vi.fn()} />);
    expect(await screen.findByText('Livezen and CreativeFx')).toBeTruthy();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/api/expense/dashboard2', { org: '1,3' }, expect.anything());
    expect(screen.getByText(/Consolidated across 2 companies/)).toBeTruthy();
    // The month's figure, and the same in the chart's table for a screen reader.
    expect(screen.getAllByText('LKR 150,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('+50% against LKR 100,000.00 last month')).toBeTruthy();
    expect(screen.getByText('LKR 12,500.00')).toBeTruthy();
    expect(screen.getByText(/In CreativeFx only your own claims are counted/)).toBeTruthy();
    expect(screen.getByText('LKR 20,000.00 over', { exact: false })).toBeTruthy();
    expect(screen.getByText('will not auto-renew')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 9.', { exact: false })).toBeTruthy();
  });

  it('the dashboard across currencies shows each currency and counts the rest', async () => {
    dashboard = MIXED;
    wrap(<Dashboard org="1,5" orgId={null} orgs={ORGS} onGo={vi.fn()} />);
    expect(await screen.findByText('LKR 150,000.00')).toBeTruthy();
    expect(screen.getByText('AED 2,400.00')).toBeTruthy();
    expect(screen.queryByText(/152,400/)).toBeNull();
    expect(screen.getByText('2 claims')).toBeTruthy();
    expect(screen.getByText('Claims, month by month')).toBeTruthy();
    expect(screen.getByText(/different financial years/)).toBeTruthy();
    expect(screen.getByText(/no single group total/)).toBeTruthy();
  });

  it('a problem goes to the screen that fixes it, and a stalled claim opens itself', async () => {
    const onGo = vi.fn();
    wrap(<Dashboard org="1,3" orgId={null} orgs={ORGS} onGo={onGo} />);
    fireEvent.click(await screen.findByText('1 claim has nobody able to approve it'));
    expect(onGo).toHaveBeenLastCalledWith('policies');
    fireEvent.click(screen.getByText('EXP-0041 Taxi'));
    expect(onGo).toHaveBeenLastCalledWith('mine', '&claim=41');
    fireEvent.click(screen.getByText('3 card transactions with no claim against them'));
    expect(onGo).toHaveBeenLastCalledWith('cards');
    fireEvent.click(screen.getByText('Figma'));
    expect(onGo).toHaveBeenLastCalledWith('subs', '&sub=9');
  });

  it('a named report exports through the main process with the query it was run with', async () => {
    wrap(<Analytics org="2" orgId={2} orgs={[org(2, 'Livezen')]} onGo={vi.fn()} startOnReports />);
    // The table's row and the bar drawn from it.
    expect((await screen.findAllByText('Travel')).length).toBe(2);
    expect(screen.getByText('90,000.00')).toBeTruthy();
    expect(screen.getByText('LKR 150,000.00')).toBeTruthy();
    fireEvent.click(await screen.findByText('Export as CSV'));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalled());
    expect(vi.mocked(call)).toHaveBeenCalledWith('transfers:download', {
      expenseFile: { kind: 'report', which: 'insights', query: { org: '2', report: 'by_category' } },
      name: expect.stringMatching(/^by_category-\d{4}-\d{2}-\d{2}\.csv$/),
    });
  });

  it('no export button where the area map says no', async () => {
    exportAllowed = false;
    wrap(<Analytics org="2" orgId={2} orgs={[org(2, 'Livezen')]} onGo={vi.fn()} startOnReports />);
    expect((await screen.findAllByText('Travel')).length).toBe(2);
    await waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/api/module-areas/expense', { org: 2 }, expect.anything()));
    expect(screen.queryByText('Export as CSV')).toBeNull();
  });

  it('every organization: one total per currency, and read-only companies marked', async () => {
    wrap(<Consolidated org="1" orgId={1} orgs={ORGS} onGo={vi.fn()} />);
    expect(await screen.findByText('Gulf Trading')).toBeTruthy();
    expect(screen.getByText(/Every company you can report on/)).toBeTruthy();
    expect(screen.getByText('Total in LKR')).toBeTruthy();
    expect(screen.getByText('LKR 300,000.00')).toBeTruthy();
    expect(screen.getByText('Total in AED')).toBeTruthy();
    expect(screen.getAllByText('AED 1,500.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/you can read this one, not change it/)).toBeTruthy();
    expect(screen.getByText(/no single group total/)).toBeTruthy();
  });

  it('every organization says what it needs when the permission is missing', () => {
    app.set({ bootstrap: { permissions: ['expense.view'] } as never });
    wrap(<Consolidated org="1" orgId={1} orgs={ORGS} onGo={vi.fn()} />);
    expect(screen.getByText(/consolidated reporting permission/)).toBeTruthy();
    expect(vi.mocked(apiGet)).not.toHaveBeenCalledWith('/api/expense/consolidated', expect.anything(), expect.anything());
  });
});
