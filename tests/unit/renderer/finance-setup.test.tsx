// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { AccessCell, Member, Opening } from '../../../src/modules/finance/setup';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { ApiError, apiDelete, apiGet, apiPost, apiPut } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { toasts } = await import('../../../src/core/toasts');
const { monthWords, todayInZone } = await import('../../../src/core/time');
const setup = await import('../../../src/modules/finance/setup');
const { default: TaxCodes } = await import('../../../src/modules/finance/TaxCodes');
const { default: Depreciation } = await import('../../../src/modules/finance/Depreciation');
const { default: Settings } = await import('../../../src/modules/finance/Settings');
const { default: Rates } = await import('../../../src/modules/finance/Rates');
const { default: Shares } = await import('../../../src/modules/finance/Shares');
const { default: AssetAccounts } = await import('../../../src/modules/finance/AssetAccounts');
const { default: PurchaseAccounts } = await import('../../../src/modules/finance/PurchaseAccounts');

/*
 * Finance setup, drawn from payloads shaped as the server sends them
 * (FinanceController, FxController, ReportExportController,
 * FinanceAccessAdminController) — raw `getResultArray()` rows keep their
 * string ids — to prove the screens say what matters and send what the
 * routes read, without a server.
 */

const company = { id: 2, name: 'CreativeFX', base_currency: 'LKR', fiscal_year_start_month: 4, books_opened_at: '2026-04-01', has_books: true };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const TAX = {
  codes: [
    { id: 5, code: 'VAT18', name: 'VAT standard', treatment: 'standard', direction: 'output', status: 'active', note: null, rate: '15.0000', rate_from: '2024-01-01', rate_to: null, configured: true },
    { id: 6, code: 'ZR', name: 'Zero-rated exports', treatment: 'zero_rated', direction: 'output', status: 'active', note: null, rate: null, rate_from: null, rate_to: null, configured: false },
    { id: 7, code: 'EX', name: 'Exempt financial services', treatment: 'exempt', direction: 'output', status: 'active', note: null, rate: null, rate_from: null, rate_to: null, configured: false },
  ],
  can: { view: true, edit: true, manage: true, level: 'manage' },
  treatments: { standard: 'Taxed at the standard rate', zero_rated: 'Taxable, at nil', exempt: 'Not taxable', out_of_scope: 'Outside the tax system', reverse_charge: 'The customer accounts for the tax' },
  empty_note: null,
  unconfigured: 2,
};

const OPENING: Opening = {
  expected: '50000.00',
  entered: '20000.00',
  difference: '30000.00',
  ties: false,
  missing: 1,
  posted: true,
  assets: [
    { id: 31, asset_code: 'AST-0031', name: 'Delivery van', cost: '4000000.00', status: 'active', opening_accumulated: '20000.00' },
    { id: 32, asset_code: 'AST-0032', name: 'Server rack', cost: '40000.00', status: 'active', opening_accumulated: null },
  ],
};

const DEPRECIATION = {
  runs: [{ id: '3', period: '2026-07', charged_on: '2026-07-31', asset_count: '2', total: '12000.00', status: 'posted', journal_id: '41', journal_no: 'DEP-2026-07', note: null }],
  preview: {
    ok: true,
    period: '2026-08',
    charged_on: '2026-08-31',
    posted: false,
    journal_no: null,
    considered: 3,
    rows: [
      { asset_id: 31, asset_code: 'AST-0031', name: 'Delivery van', amount: '11500.00' },
      { asset_id: 32, asset_code: 'AST-0032', name: 'Server rack', amount: '1000.00' },
    ],
    total: '12500.00',
    skipped: 1,
    reasons: { 'already fully depreciated, or acquired after this month.': 1 },
    why: null,
  },
  opening: OPENING,
  // The envelope as the server builds it for the unknown area 'post': always no.
  can: { view: false, edit: false, manage: false, level: 'none' },
};

const cell = (level: string, ceiling: string, extra: Partial<AccessCell> = {}) => ({ level, ceiling, via: 'role', granted: null, note: null, expires_at: null, ...extra });
const AREAS = [
  { key: 'dashboard', label: 'Overview', note: 'Figures need finance.reports.view' },
  { key: 'accounts', label: 'Chart of accounts', note: null },
  { key: 'journals', label: 'Journals', note: 'Approve and post are separate permissions' },
  { key: 'periods', label: 'Periods', note: null },
  { key: 'reports', label: 'Reports', note: 'A report is read-only by nature' },
  { key: 'settings', label: 'Settings and books', note: null },
];
const NIMAL: Member = {
  user_id: 12,
  name: 'Nimal Perera',
  email: 'nimal@creativefx.lk',
  company_role: 'finance',
  modules: {
    dashboard: cell('view', 'view'),
    accounts: cell('view', 'view'),
    journals: cell('view', 'manage', { via: 'company-grant', granted: 'view', expires_at: '2026-12-31 12:00:00' }),
    periods: cell('none', 'none'),
    reports: cell('view', 'view'),
    settings: cell('none', 'none'),
  },
  preset: null,
};
const MEMBERS = {
  company: { id: 2, name: 'CreativeFX' },
  members: [
    { user_id: 9, name: 'Hasa Admin', email: 'hasa@creativefx.lk', company_role: 'admin', modules: Object.fromEntries(AREAS.map((a) => [a.key, cell('manage', 'manage')])), preset: 'unrestricted' },
    NIMAL,
    { user_id: 14, name: 'Kasun Silva', email: null, company_role: 'member', modules: Object.fromEntries(AREAS.map((a) => [a.key, cell('none', 'none')])), preset: 'unrestricted' },
  ],
  matrix: {
    levels: ['none', 'view', 'edit', 'manage'],
    modules: AREAS,
    presets: [
      { key: 'unrestricted', label: 'No restriction', hint: 'Removes every cap. Their role alone decides.' },
      { key: 'read-only', label: 'Read only', hint: 'Can open and read everything, change nothing.' },
      { key: 'bookkeeper', label: 'Bookkeeper', hint: 'Writes journals and maintains accounts. Cannot post, lock periods or change settings.' },
    ],
  },
};

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'] } as never, auth: { stage: 'ready', user: { id: '9', name: 'Hasa Admin' } } as never });
  toasts.set({ items: [] });
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/finance/tax-codes') return TAX;
    if (path === '/api/finance/tax-codes/5/history') return { rates: [{ id: '11', rate: '15.0000', starts_on: '2024-01-01', ends_on: '9999-12-31', note: null }, { id: '4', rate: '12.0000', starts_on: '2020-01-01', ends_on: '2023-12-31', note: null }] };
    if (path === '/api/finance/depreciation') return DEPRECIATION;
    if (path === '/api/finance/access/members') return MEMBERS;
    if (path === '/api/finance/settings')
      return {
        company: { id: 2, name: 'CreativeFX', has_books: true },
        profile: [
          { key: 'base_currency', label: 'Base currency', value: 'LKR', editable: false, why: '14 journal(s) are already posted, so this cannot change without restating the books.' },
          { key: 'fiscal_year_start_month', label: 'Financial year starts', value: 4, editable: false, why: 'Set when the books were opened.' },
          { key: 'books_opened_at', label: 'Books opened', value: '2026-04-01', editable: false, why: 'The day the ledger began.' },
        ],
        counts: { accounts: 62, journals: 20, posted: 14, tax_codes: 3, years: 1 },
        roles: [
          { role: 'ar', label: 'Accounts receivable', code: '1130', name: 'Accounts Receivable', mapped: true },
          { role: 'tax_payable', label: 'Tax payable', code: null, name: null, mapped: false },
        ],
      };
    if (path === '/api/finance/exchange-rates')
      return {
        rows: [{ id: 3, from: 'USD', to: 'LKR', rate: '300.00000000', effective_on: '2026-09-01', source: 'manual' }],
        currencies: [
          { code: 'LKR', name: 'Sri Lankan rupee' },
          { code: 'USD', name: 'US dollar' },
          { code: 'GBP', name: 'Pound sterling' },
        ],
        base_currencies: ['LKR', 'USD'],
        can_edit: true,
        note: 'A rate holds until a later one supersedes it.',
      };
    if (path === '/api/finance/export/shares')
      return {
        rows: [
          { id: 8, report: 'profit-and-loss', from: '2026-04-01', to: '2026-08-31', expires_at: '2099-10-01 12:00:00', revoked_at: null, views: 3, max_views: 500, last_seen_at: '2026-09-27 12:00:00', live: true, why_dead: null },
          { id: 7, report: 'cash-flow', from: '2026-04-01', to: '2026-06-30', expires_at: '2026-07-08 12:00:00', revoked_at: null, views: 500, max_views: 500, last_seen_at: null, live: false, why_dead: 'view limit reached' },
        ],
        reports: { 'profit-and-loss': 'Profit and loss', 'cash-flow': 'Cash flow overview' },
        scope: 'mine',
        note: "The links you created. Seeing everybody's needs finance.reports.manage.",
      };
    if (path === '/api/finance/asset-accounts')
      return {
        categories: [
          { id: 1, name: 'Computers', account_id: 124, asset_count: 12, capitalised: 3, total: '2400000.00' },
          { id: 2, name: 'Vehicles', account_id: null, asset_count: 1, capitalised: 0, total: '4000000.00' },
        ],
        accounts: [
          { id: '121', code: '1210', name: 'Property' },
          { id: '123', code: '1230', name: 'Vehicles' },
          { id: '124', code: '1240', name: 'Computers' },
        ],
      };
    if (path === '/api/finance/purchase-accounts')
      return {
        categories: [{ category_id: 4, name: 'Stationery', depth: 0, account_id: null, code: null, account_name: null, revenue_account_id: null, revenue_code: null, revenue_name: null }],
        vendors: [{ vendor_id: 9, name: 'Dialog Axiata', status: 'active', account_id: null, code: null, account_name: null }],
        accounts: [{ id: '63', code: '6300', name: 'Utilities', type: 'expense' }],
        revenue_accounts: [{ id: '42', code: '4200', name: 'Service', type: 'revenue' }],
        fallback: { id: '51', code: '5100', name: 'Product Cost' },
        revenue_fallback: { id: '41', code: '4100', name: 'Product Sales' },
      };
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('finance setup helpers', () => {
  it('checks an exchange rate as text: positive, up to eight places, no float in between', () => {
    expect(setup.fxRateProblem('312.55')).toBeNull();
    expect(setup.fxRateProblem('0.00000001')).toBeNull();
    expect(setup.fxRateProblem('')).toBeNull();
    expect(setup.fxRateProblem('0.00000000', 'USD', 'LKR')).toBe('The rate must be a positive number with up to eight decimal places — how many LKR one USD buys.');
    expect(setup.fxRateProblem('1.123456789')).toMatch(/up to eight decimal places/);
    expect(setup.fxRateProblem('-3')).toMatch(/positive number/);
    expect(setup.fxRateProblem('1,234.5')).toMatch(/without commas/);
    expect(setup.trimDecimals('312.55000000')).toBe('312.55');
    expect(setup.trimDecimals('1.00000000', 2)).toBe('1.00');
    expect(setup.trimDecimals('0.00320000', 2)).toBe('0.0032');
    expect(setup.trimDecimals('12345678901.12345678')).toBe('12345678901.12345678');
  });

  it('checks a tax rate as text: 0 to 200, four places, and says why', () => {
    expect(setup.taxRateProblem('15')).toBeNull();
    expect(setup.taxRateProblem('200')).toBeNull();
    expect(setup.taxRateProblem('200.0000')).toBeNull();
    expect(setup.taxRateProblem('200.0001')).toBe('200.0001% is not a plausible tax rate. Enter it as a percentage, not a multiplier.');
    expect(setup.taxRateProblem('250')).toMatch(/not a plausible tax rate/);
    expect(setup.taxRateProblem('0250')).toMatch(/not a plausible tax rate/);
    expect(setup.taxRateProblem('2500')).toMatch(/not a plausible tax rate/);
    expect(setup.taxRateProblem('-1')).toBe('A tax rate cannot be negative.');
    expect(setup.taxRateProblem('15%')).toMatch(/plain percentage/);
    expect(setup.taxRateProblem('12.34567')).toMatch(/four decimal places/);
  });

  it('says which rate a new one closes, and refuses one slotted behind it', () => {
    const history = [
      { id: '11', rate: '15.0000', starts_on: '2024-01-01', ends_on: '9999-12-31' },
      { id: '4', rate: '12.0000', starts_on: '2020-01-01', ends_on: '2023-12-31' },
    ];
    expect(setup.rateChange(history, '2026-10-01')).toEqual({ closes: history[0], closesOn: '2026-09-30', problem: null });
    expect(setup.rateChange(history, '2024-01-01', 'VAT18').problem).toMatch(/A rate for VAT18 already starts on 1 Jan 2024/);
    expect(setup.rateChange(history, '2023-06-01').problem).toMatch(/has to start after it/);
    expect(setup.rateChange([], '2026-10-01')).toEqual({ closes: null, closesOn: null, problem: null });
  });

  it('spells a preset out per area, capped at the role the way the server caps it', () => {
    const keys = AREAS.map((a) => a.key);
    expect(setup.expandPreset('bookkeeper', NIMAL, keys)).toEqual({ dashboard: 'view', accounts: 'view', journals: 'edit', periods: 'inherit', reports: 'view', settings: 'inherit' });
    expect(setup.expandPreset('read-only', NIMAL, keys)).toEqual({ dashboard: 'view', accounts: 'view', journals: 'view', periods: 'inherit', reports: 'view', settings: 'inherit' });
    expect(setup.expandPreset('unrestricted', NIMAL, keys)).toEqual(Object.fromEntries(keys.map((k) => [k, 'inherit'])));
    expect(setup.expandPreset('auditor', NIMAL, keys)).toBeNull();
  });

  it('offers every level, and disables the ones above the ceiling', () => {
    expect(setup.levelChoices('view')).toEqual([
      { value: 'inherit', label: 'Inherit (view)' },
      { value: 'none', label: 'None' },
      { value: 'view', label: 'View' },
      { value: 'edit', label: 'Edit — above their role', disabled: true },
      { value: 'manage', label: 'Manage — above their role', disabled: true },
    ]);
    expect(setup.levelChoices('manage').some((c) => c.disabled)).toBe(false);
  });

  it('sends only the mappings that changed, and checks a brought-forward split against the whole', () => {
    const cats = [
      { id: 1, name: 'Computers', account_id: 124, asset_count: 12, capitalised: 3, total: '0' },
      { id: 2, name: 'Vehicles', account_id: null, asset_count: 1, capitalised: 0, total: '0' },
    ];
    expect(setup.mappingChanges(cats, { 1: 124, 2: 123 })).toEqual({ 2: 123 });
    expect(setup.mappingChanges(cats, { 1: null, 2: null })).toEqual({ 1: null });
    expect(setup.previousMonth('2026-01-15')).toBe('2025-12');
    expect(setup.previousMonth('2026-09-28')).toBe('2026-08');

    const ok = setup.openingSplit(OPENING, { 31: '20000.00', 32: '30000' });
    expect(ok).toEqual({ send: { 32: '30000' }, total: 5000000, expected: 5000000, problems: [] });
    expect(setup.openingSplit(OPENING, { 32: '40000.01' }).problems[0]).toMatch(/AST-0032: more depreciation than its cost/);
    expect(setup.openingSplit(OPENING, { 31: '30000', 32: '30000' }).problems[0]).toMatch(/cannot come to more than the whole/);
  });
});

describe('finance setup screens', () => {
  it('Tax codes: "not set" is not 0%, and a new rate says which one it closes', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce(null);
    wrap(<TaxCodes company={company} onGo={vi.fn()} />);
    await screen.findByText('VAT standard');
    expect(screen.getByText('15.00%')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(screen.getByText('No rate by definition')).toBeTruthy();
    expect(screen.getByText(/2 codes have no rate for/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Set the rate for VAT18'));
    await screen.findByText('Every rate it has carried');
    expect(screen.getByText('Current')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Rate %'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('In force from'), { target: { value: '2026-10-01' } });
    expect(screen.getByText('The current 15.00% (from 1 Jan 2024) closes on 30 Sep 2026; 18% applies from 1 Oct 2026.')).toBeTruthy();
    fireEvent.click(screen.getByText('Record it'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/tax-codes/5/rate', { company_id: 2, rate: '18', from: '2026-10-01', note: '' }));
  });

  it('Tax codes: a rate above 200 is refused before it is sent, and the server’s refusals are listed', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(422, 'A rate for VAT18 already starts on 2026-10-01.', null, { problems: ['A rate for VAT18 already starts on 2026-10-01. Rates are never edited — start a new one from a later date, so the change stays visible.'] }));
    wrap(<TaxCodes company={company} onGo={vi.fn()} />);
    await screen.findByText('VAT standard');
    fireEvent.click(screen.getByLabelText('Set the rate for VAT18'));
    await screen.findByText('Every rate it has carried');
    fireEvent.change(screen.getByLabelText('Rate %'), { target: { value: '250' } });
    expect(screen.getByText('250% is not a plausible tax rate. Enter it as a percentage, not a multiplier.')).toBeTruthy();
    expect((screen.getByText('Record it') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Rate %'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('In force from'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('Record it'));
    await screen.findByText(/Rates are never edited — start a new one from a later date/);
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('Tax codes: without finance.settings nothing offers to write', async () => {
    app.set({ bootstrap: { permissions: ['finance.view'] } as never });
    wrap(<TaxCodes company={company} onGo={vi.fn()} />);
    await screen.findByText('VAT standard');
    expect(screen.queryByText('New code')).toBeNull();
    expect(screen.queryByText('Set rate')).toBeNull();
  });

  it('Depreciation: the preview is the figure, and charging is gated on finance.journal.post, not the broken envelope', async () => {
    app.set({ bootstrap: { permissions: ['finance.view'] } as never });
    const month = monthWords(setup.previousMonth(todayInZone()));
    const { unmount } = wrap(<Depreciation company={company} onGo={vi.fn()} />);
    await screen.findByText(/would be charged across 2 of 3 assets, dated 31 Aug 2026/);
    expect(screen.getByText('LKR 12,500.00')).toBeTruthy();
    expect(screen.getByText('already fully depreciated, or acquired after this month.')).toBeTruthy();
    expect(screen.getByText('The brought-forward depreciation is not split across the assets yet.')).toBeTruthy();
    expect(screen.queryByText(`Charge ${month}`)).toBeNull();
    expect(screen.getByText(/Charging a month needs/)).toBeTruthy();
    expect(screen.queryByText('Record the split…')).toBeNull();
    unmount();

    app.set({ bootstrap: { permissions: ['finance.view', 'finance.journal.post'] } as never });
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 44, journal_no: 'DEP-2026-08' });
    const onGo = vi.fn();
    wrap(<Depreciation company={company} onGo={onGo} />);
    fireEvent.click(await screen.findByText(`Charge ${month}`));
    expect(screen.getByText(/LKR 12,500.00 across 2 assets, dated 31 Aug 2026. This writes one journal/)).toBeTruthy();
    fireEvent.click(screen.getByText('Charge it'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/depreciation', { company_id: 2, period: setup.previousMonth(todayInZone()) }));
    fireEvent.click(screen.getByText('DEP-2026-07'));
    expect(onGo).toHaveBeenCalledWith('journals', '&open=41');
  });

  it('Depreciation: the brought-forward split sends only what changed, and never more than the whole', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ written: 1 });
    wrap(<Depreciation company={company} onGo={vi.fn()} />);
    fireEvent.click(await screen.findByText('Record the split…'));
    fireEvent.change(screen.getByLabelText('AST-0032 brought forward'), { target: { value: '31000' } });
    expect(screen.getByText(/cannot come to more than the whole/)).toBeTruthy();
    expect((screen.getByText('Record 1 figure') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('AST-0032 brought forward'), { target: { value: '30000' } });
    expect(screen.getByText(/it ties/)).toBeTruthy();
    fireEvent.click(screen.getByText('Record 1 figure'));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/finance/depreciation/opening', { company_id: 2, assets: { 32: '30000' } }));
  });

  it('Area access: says it is not enforced, keeps your own row out of reach, and refuses a level above the role', async () => {
    vi.mocked(apiPut).mockRejectedValueOnce(new ApiError(422, "Their role only reaches 'view' here, so 'manage' would not take effect. Change the role in Directory to give them more.", null));
    wrap(<Settings company={company} onGo={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Area access' }));
    await screen.findByText('Nimal Perera');
    expect(screen.getByText('These levels are not enforced by the server yet.')).toBeTruthy();

    // Your own row: a sentence, no controls.
    expect(screen.getByText(/This is you\. Your own access here is set by somebody else/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Hasa Admin · Journals' })).toBeNull();
    // A role that reaches nothing: one sentence, not six dead controls.
    expect(screen.getByText(/Their role gives them no Finance access in this company/)).toBeTruthy();

    // Above the ceiling: offered, disabled, with the reason.
    fireEvent.click(screen.getByRole('combobox', { name: 'Nimal Perera · Chart of accounts' }));
    expect(screen.getByRole('option', { name: /Manage — above their role/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('option', { name: /Edit — above their role/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('option', { name: 'None' }).getAttribute('aria-disabled')).toBeNull();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    // The server still refuses (a role changed since the grid loaded), and its sentence is shown whole.
    expect(screen.getByText('until 31 Dec 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Nimal Perera · Journals' }));
    fireEvent.click(screen.getByRole('option', { name: 'Manage' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/finance/access/members/12?company=2', { module: 'journals', level: 'manage', expires_at: '2026-12-31 23:59:59' }));
    await waitFor(() => expect(toasts.get().items.some((t) => t.kind === 'error' && t.text.startsWith("Their role only reaches 'view' here"))).toBe(true));
  });

  it('Area access: a preset is spelled out for the person before it is applied', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ applied: ['dashboard', 'accounts', 'journals', 'periods', 'reports', 'settings'], skipped: [] });
    wrap(<Settings company={company} onGo={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Area access' }));
    await screen.findByText('Nimal Perera');
    expect(screen.getAllByText('Bookkeeper')).toHaveLength(1); // Nimal only: not on your own row, nor on one with nothing to narrow
    fireEvent.click(screen.getByText('Bookkeeper'));
    await screen.findByText('Bookkeeper for Nimal Perera?');
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Chart of accountsView');
    expect(dialog.textContent).toContain('JournalsEdit');
    expect(dialog.textContent).toContain('PeriodsInherit (none)');
    fireEvent.click(screen.getByText('Apply'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/access/members/12/preset', { preset: 'bookkeeper' }, { company: 2 }));
  });

  it('Settings: the profile says what is fixed and why, in words', async () => {
    app.set({ bootstrap: { permissions: ['finance.view'] } as never });
    const onGo = vi.fn();
    wrap(<Settings company={company} onGo={onGo} />);
    await screen.findByText('April');
    expect(screen.queryByRole('tab', { name: 'Area access' })).toBeNull();
    expect(screen.getByText('1 April 2026')).toBeTruthy();
    expect(screen.getByText(/14 journal\(s\) are already posted/)).toBeTruthy();
    expect(screen.getAllByText('Fixed')).toHaveLength(3);
    expect(screen.getByText('Not mapped')).toBeTruthy();
    fireEvent.click(screen.getByText('Tax codes'));
    expect(onGo).toHaveBeenCalledWith('tax');
  });

  it('Exchange rates: installation-wide, checked as typed, and a same-day pair replaces', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 3 });
    wrap(<Rates company={company} onGo={vi.fn()} />);
    await screen.findByText('300.00');
    expect(screen.getByText(/Shared across every company on this installation/)).toBeTruthy();
    expect(screen.getByText(/Your companies keep their books in/)).toBeTruthy();
    fireEvent.click(screen.getByText('Add a rate'));
    fireEvent.click(screen.getByRole('combobox', { name: 'One unit of' }));
    fireEvent.click(screen.getByRole('option', { name: /USD/ }));
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '0' } });
    expect(screen.getByText('The rate must be a positive number with up to eight decimal places — how many LKR one USD buys.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '301.25' } });
    fireEvent.change(screen.getByLabelText('From this date'), { target: { value: '2026-09-01' } });
    expect(screen.getByText(/There is already a USD → LKR rate from 1 Sep 2026 \(300.00\)\. Saving replaces it/)).toBeTruthy();
    fireEvent.click(screen.getByText('Replace the rate'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/exchange-rates', { from: 'USD', to: 'LKR', rate: '301.25', effective_on: '2026-09-01' }));
  });

  it('Exchange rates: not asked for without finance.settings', () => {
    app.set({ bootstrap: { permissions: ['finance.view', 'finance.reports.view'] } as never });
    wrap(<Rates company={company} onGo={vi.fn()} />);
    expect(screen.getByText(/Exchange rates are kept by people who hold/)).toBeTruthy();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('Shared reports: says which kind of dead, and revokes a live link', async () => {
    vi.mocked(apiDelete).mockResolvedValueOnce({ id: 8 });
    wrap(<Shares company={company} onGo={vi.fn()} />);
    await screen.findByText('Profit and loss');
    expect(screen.getByText('View limit reached')).toBeTruthy();
    expect(screen.getByText(/The links you created/)).toBeTruthy();
    expect(screen.getAllByText('Revoke')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Revoke the Profit and loss link'));
    fireEvent.click(screen.getAllByText('Revoke').at(-1)!);
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/finance/export/shares/8?company=2'));
  });

  it('Fixed-asset accounts: warns before splitting a capitalised category, and saves only the change', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce(null);
    wrap(<AssetAccounts company={company} onGo={vi.fn()} />);
    await screen.findByText('Computers');
    expect(screen.getByText('3 already in the books')).toBeTruthy();
    expect(screen.getByText('LKR 4,000,000.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Computers debited to' }));
    fireEvent.click(screen.getByRole('option', { name: '1210 Property' }));
    expect(screen.getByText(/3 of its assets are already in the books under 1240 Computers/)).toBeTruthy();
    fireEvent.click(screen.getByText('Save mapping'));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/finance/asset-accounts?company=2', { company_id: 2, map: { 1: 121 } }));
  });

  it('Purchase accounts: shows the default an unmapped row falls to, and saves one row per choice', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce(null);
    wrap(<PurchaseAccounts company={company} onGo={vi.fn()} />);
    await screen.findByText('Dialog Axiata');
    expect(screen.getByText('default · 5100 Product Cost')).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Stationery sold as' }));
    fireEvent.click(screen.getByRole('option', { name: '4200 Service' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/finance/purchase-accounts/revenue', { company_id: 2, category_id: 4, account_id: 42 }));
  });
});
