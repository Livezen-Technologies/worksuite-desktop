// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { Org } from '../../../src/modules/expenses/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, request, ApiError } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const a = await import('../../../src/modules/expenses/admin');
const { default: Settings } = await import('../../../src/modules/expenses/Settings');
const { Organizations } = await import('../../../src/modules/expenses/Organizations');

/*
 * Expenses' settings and setting up a company, drawn from payloads shaped as
 * the server sends them (OrgController, RulesController, the module-settings
 * controller) — every id, flag and count a string where `getResultArray()`
 * would make it one.
 */

const org = (id: number, name: string, extra: Partial<Org> = {}): Org => ({ id, name, slug: name.toLowerCase(), role: 'member', member: true, currency: 'LKR', favourite: false, ...extra });
const ORGS: Org[] = [org(2, 'CreativeFX', { role: 'finance' }), org(4, 'TechHubiz', { role: 'admin' }), org(5, 'Flxware', { role: null, member: false, can_act: false })];

const EXTRAS = [
  { key: 'company', label: 'Company rules' },
  { key: 'centres', label: 'Cost centres' },
  { key: 'categories', label: 'Categories' },
  { key: 'rates', label: 'Rates' },
  { key: 'myaccess', label: 'My access' },
  { key: 'events', label: 'Who gets told' },
  { key: 'activity', label: 'Activity' },
  { key: 'companies', label: 'Set up a company' },
];

const SHOW = {
  module: 'Expense',
  slug: 'expense',
  label: 'Expenses',
  sections: { general: 'General', access: 'User Access', screens: 'Screens & components', organization: 'Organization', notifications: 'Notifications', advanced: 'Advanced' },
  extra_sections: EXTRAS,
  spec: {
    general: [{ key: 'claim_prefix', label: 'Claim number prefix', type: 'string', default: 'EXP', help: null, section: 'Numbering', options: null, min: null, max: null, placeholder: null }],
    advanced: [],
    unavailable: { advanced: 'Expenses holds no API key, webhook or sync schedule.' },
  },
  general: { claim_prefix: { value: 'EXP', stored: false, inherited: true } },
  advanced: {},
  advanced_open: false,
  can_edit: true,
  note: null,
};

const RULES = {
  organization: { id: '2', name: 'CreativeFX' },
  settings: { org_id: '2', currency: 'LKR', fiscal_start_month: '4', claim_prefix: 'EXP', advance_prefix: 'ADV', number_pad: '4', default_cost_centre_id: '9', tax_rate_id: null, gl_prefix: null, require_cost_centre: '0', require_project: '1', allow_self_approval: '0' },
  fiscal_year: { start: '2026-04-01', end: '2027-03-31', label: '2026/27' },
  role: 'admin',
  receipt_reading: { ok: true, message: 'Receipts are read on this server.', engine: 'tesseract', version: '5.3.0' },
};

const CENTRES = {
  items: [{ id: '3', code: 'OPS', name: 'Operations', kind: 'cost', manager: 'Nimal Perera', manager_id: '12', gl_code: '6100', status: 'active', spend: '125000.00', claims: '4', parent_id: null, branch_id: '1', department_id: null }],
  fiscal_year: { start: '2026-04-01', end: '2027-03-31', label: '2026/27' },
  currency: 'LKR',
};

const RATES = {
  currency: 'LKR',
  mileage: [{ id: '1', vehicle: 'car', unit: 'km', rate: '85.5000', threshold_units: null, rate_after: null, effective_from: '2026-01-01', effective_to: null, currency: 'LKR' }],
  per_diem: [],
  fx: [],
  note: 'No statutory mileage or per diem rates are shipped with this software.',
  can_edit: true,
};

const ACCESS = {
  role: 'finance',
  via_star: false,
  posting: { branch: null, department: 'Finance', cost_centre: null },
  configurable: { branch: false, department: true },
  personal_limit: null,
  scopes: {
    mine: { allowed: true, posted: null, why: 'Your own claims, always.' },
    team: { allowed: true, posted: null, why: 'You approve for this organization.' },
    department: { allowed: false, posted: null, why: 'Nobody has recorded which department you belong to.' },
    organization: { allowed: true, posted: null, why: 'Finance sees every claim in the organization.' },
  },
  permissions: [
    { slug: 'expense.view', name: 'View expenses', held: true },
    { slug: 'expense.admin', name: 'Administer expenses', held: false },
  ],
};

let showRefused = false;

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const answered = (message: string, data: unknown = null) => ({ data, offline: false, cachedAt: null, message });

beforeEach(() => {
  showRefused = false;
  app.set({ bootstrap: { permissions: ['expense.view', 'expense.manage', 'expense.admin'] } as never, auth: { user: { id: '7' } } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/module-settings/expense') {
      if (showRefused) throw new ApiError(403, 'You do not administer Expenses.', null);
      return SHOW;
    }
    if (path === '/api/expense/settings2') return RULES;
    if (path === '/api/expense/cost-centres') return CENTRES;
    if (path === '/api/expense/members') return { items: [{ user_id: 12, name: 'Nimal Perera', role: 'finance' }] };
    if (path === '/api/expense/rates') return RATES;
    if (path === '/api/expense/access') return ACCESS;
    if (path === '/api/expense/organizations') return { items: ORGS, current: 2, empty_reason: null };
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('expenses admin: pure helpers', () => {
  it('reads columns once, and never takes "0" for true', () => {
    expect(a.flag('0')).toBe(false);
    expect(a.flag('1')).toBe(true);
    expect(a.flag(0)).toBe(false);
    expect(a.idOf('0')).toBeNull();
    expect(a.idOf('12')).toBe(12);
    expect(a.intOf('4')).toBe(4);
    const c = a.toCentre(CENTRES.items[0]!);
    expect(c.claims).toBe(4);
    expect(c.branchId).toBe(1);
    expect(a.toCategory({ id: '1', name: 'Travel', org_id: '0', requires_receipt: '0', status: 'active' })).toMatchObject({ shared: true, requiresReceipt: false });
    const r = a.toRules(RULES);
    expect(r).toMatchObject({ requireCostCentre: false, requireProject: true, allowSelfApproval: false, fiscalStartMonth: 4, defaultCostCentreId: 9 });
  });

  it('validates a rate as text, never through a float', () => {
    expect(a.positiveDecimal('12.3456', 4)).toBe(true);
    expect(a.positiveDecimal('12.34567', 4)).toBe(false);
    expect(a.positiveDecimal('0.0000', 4)).toBe(false);
    expect(a.positiveDecimal('1e3', 4)).toBe(false);
    expect(a.positiveDecimal('-2', 4)).toBe(false);
    expect(a.positiveDecimal('12.', 4)).toBe(false);
    expect(a.positiveDecimal('0.00000001', 8)).toBe(true);
    expect(a.rateText('85.5000')).toBe('85.50');
    expect(a.rateText('0.1250')).toBe('0.125');
    // Sent as typed: a float would turn "0.1000" into 0.1 and "300.10" into 300.1.
    expect(a.mileageBody({ ...a.mileageDraft('2026-10-01'), rate: '0.1000' }).rate).toBe('0.1000');
    expect(a.fxBody({ currency: 'usd', rate: '300.10', effectiveOn: '2026-10-01' })).toEqual({ currency: 'USD', rate: '300.10', effective_on: '2026-10-01' });
  });

  it('says what Rates.php would refuse before it is sent', () => {
    const d = a.mileageDraft('2026-10-01');
    expect(a.mileageProblems({ ...d, rate: '12.5', thresholdUnits: '100' })).toEqual(['A tier needs both a threshold and the rate that applies above it.']);
    expect(a.mileageProblems({ ...d, rate: '12.5', thresholdUnits: '100', rateAfter: '9.5' })).toEqual([]);
    expect(a.fxProblems({ currency: 'LKR', rate: '1', effectiveOn: '2026-10-01' }, 'LKR')).toEqual(["LKR is this organization's own currency, so its rate is always 1."]);
    expect(a.perDiemProblems({ ...a.perDiemDraft('2026-10-01'), dailyRate: '5,000.00', firstLastPct: '75' })).toEqual([]);
    expect(a.perDiemProblems({ ...a.perDiemDraft('2026-10-01'), dailyRate: '5000', firstLastPct: '120' })).toHaveLength(1);
  });

  it('carries back the columns a save writes but the screen does not draw', () => {
    const r = a.toRules(RULES);
    expect(a.rulesBody(r, { ...a.rulesDraft(r), allowSelfApproval: true })).toMatchObject({ allow_self_approval: 1, require_project: 1, default_cost_centre_id: 9, tax_rate_id: null, number_pad: 4 });
    expect(a.rulesProblems({ ...a.rulesDraft(r), currency: 'US', numberPad: '12' })).toEqual(['Give the currency as a three-letter code.', 'A claim number has between 1 and 10 digits.']);
    const c = a.toCentre(CENTRES.items[0]!);
    expect(a.centreBody({ ...a.centreDraft(c), status: 'archived' }, c)).toMatchObject({ code: 'OPS', manager_id: 12, status: 'archived', branch_id: 1, parent_id: null });
  });

  it('lists the sections as the web shell does: the standard six, the module’s own appended, the change log last', () => {
    const items = a.sectionList({ ...SHOW, extra_sections: [...EXTRAS, { key: 'future', label: 'Something new' }] });
    expect(items.map((i) => i.key)).toEqual(['general', 'access', 'screens', 'organization', 'notifications', 'company', 'centres', 'categories', 'rates', 'myaccess', 'events', 'activity', 'companies', 'future', 'history']);
    expect(items.filter((i) => !i.native).map((i) => i.key)).toEqual(['access', 'screens', 'organization', 'notifications', 'future', 'history']);
    expect(a.sectionList({ ...SHOW, advanced_open: true }).some((i) => i.key === 'advanced')).toBe(true);
    // Refused the shell: My access alone.
    expect(a.sectionList(null).map((i) => i.key)).toEqual(['myaccess']);
    expect(a.browserPath('access')).toBe('/module-settings?module=expense&section=access');
  });

  it('names the roles nobody holds', () => {
    expect(a.silentRoles({ admin: 1, finance: 0, approver: 2, member: 0 })).toEqual(['finance', 'members']);
  });
});

describe('expenses admin: the settings screen', () => {
  it('saves the company rules with every column, and reads "0" as off', async () => {
    vi.mocked(request).mockResolvedValue(answered('Settings saved. Self-approval is switched on: people in this organization can approve their own claims.', {}));
    wrap(<Settings org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Company rules' }));
    expect(await screen.findByText('This organization')).toBeTruthy();
    expect((screen.getByLabelText('Every claim must name a cost centre') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Every claim must be charged to a project') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/This financial year is 2026\/27/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'us' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Give the currency as a three-letter code.')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'LKR' } });
    fireEvent.click(screen.getByLabelText('Let people approve their own claims'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith('PUT', '/api/expense/settings2', {
      query: { org: 2 },
      body: expect.objectContaining({ name: 'CreativeFX', currency: 'LKR', allow_self_approval: 1, require_cost_centre: 0, require_project: 1, fiscal_start_month: 4, default_cost_centre_id: 9 }),
    });
  });

  it('refuses a mileage rate by its text, and sends the one that passes exactly as typed', async () => {
    vi.mocked(request).mockResolvedValue(answered('Mileage rate added.', { ok: true, id: 2 }));
    wrap(<Settings org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rates' }));
    expect(await screen.findByText('85.50 per km')).toBeTruthy();
    expect(screen.getByText('No exchange rates recorded.', { exact: false })).toBeTruthy();

    const add = () => fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '12.34567' } });
    add();
    expect(await screen.findByText('The rate has to be a number greater than zero, with up to four decimals.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '12.3450' } });
    fireEvent.change(screen.getByLabelText('Tier above'), { target: { value: '100' } });
    add();
    expect(await screen.findByText('A tier needs both a threshold and the rate that applies above it.')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Rate after'), { target: { value: '10.0000' } });
    add();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith('POST', '/api/expense/rates/mileage', { query: { org: 2 }, body: expect.objectContaining({ vehicle: 'car', unit: 'km', rate: '12.3450', threshold_units: '100', rate_after: '10.0000' }) });
  });

  it('adds a cost centre, and shows the refusal to remove one that claims are charged to', async () => {
    vi.mocked(request).mockResolvedValueOnce(answered('Cost centre added.', { id: 4 }));
    wrap(<Settings org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cost centres' }));
    expect(await screen.findByText('Operations')).toBeTruthy();
    expect(screen.getByText('Spend, 2026/27')).toBeTruthy();
    expect(screen.getByText('LKR 125,000.00')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    const sheet = await screen.findByRole('dialog', { name: 'New cost centre' });
    fireEvent.change(within(sheet).getByLabelText('Code'), { target: { value: 'fin' } });
    expect((within(sheet).getByLabelText('Code') as HTMLInputElement).value).toBe('FIN');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('A cost centre needs both a code and a name.')).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Finance' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith('POST', '/api/expense/cost-centres', {
      query: { org: 2 },
      body: { code: 'FIN', name: 'Finance', kind: 'cost', gl_code: '', manager_id: null, status: 'active', parent_id: null, branch_id: null, department_id: null },
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New cost centre' })).toBeNull());

    const why = '4 claim(s) are charged to this cost centre. Archive it instead — deleting it would change reports that have already been read.';
    vi.mocked(request).mockRejectedValueOnce(new ApiError(409, why, null));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove OPS?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await within(confirm).findByText(why)).toBeTruthy();
  });

  it('opens My access to somebody the shell refuses, with their role in each company', async () => {
    showRefused = true;
    app.set({ bootstrap: { permissions: ['expense.view'] } as never });
    const onGo = vi.fn();
    wrap(<Settings org="2" orgId={2} orgs={ORGS} onGo={onGo} />);
    expect(await screen.findByText(/You do not administer Expenses\./)).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['My access']);

    expect(await screen.findByText('Nobody has recorded which department you belong to.')).toBeTruthy();
    expect(screen.getByText('none defined yet')).toBeTruthy();
    expect(screen.getByText('Administer expenses')).toBeTruthy();
    expect(screen.getByText('not held')).toBeTruthy();

    const companies = screen.getByText('Your role in each company').closest('section')!;
    expect(within(companies).getByText('TechHubiz').closest('[data-company]')!.textContent).toContain('admin');
    expect(within(companies).getByText('CreativeFX').closest('[data-company]')!.textContent).toContain('finance');
    expect(within(companies).getByText('Flxware').closest('[data-company]')!.textContent).toContain('read only, through consolidated reporting');

    fireEvent.click(within(screen.getByText('Team').closest('[data-scope]') as HTMLElement).getByRole('button', { name: 'Open' }));
    expect(onGo).toHaveBeenCalledWith('team');
  });
});

describe('expenses admin: setting up a company', () => {
  it('is refused without expense.admin: no form, the reason instead', async () => {
    app.set({ bootstrap: { permissions: ['expense.view', 'expense.manage'] } as never });
    wrap(<Organizations onCreated={vi.fn()} />);
    expect(await screen.findByText('Organizations you can see')).toBeTruthy();
    expect(screen.getByText(/Creating an organization needs expense administration rights/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('creates one for an administrator, and shows the server’s refusal as said', async () => {
    const onCreated = vi.fn();
    vi.mocked(apiGet).mockResolvedValue({ items: [], current: null, empty_reason: 'You are not a member of any organization.' });
    vi.mocked(request).mockRejectedValueOnce(new ApiError(403, 'Creating an organization needs expense administration rights.', null)).mockResolvedValueOnce(answered('Acme created. You are its administrator.', { id: 9, name: 'Acme', slug: 'acme' }));
    wrap(<Organizations onCreated={onCreated} />);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'us' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Give the currency as a three-letter code.')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'usd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Creating an organization needs expense administration rights.')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenLastCalledWith('POST', '/api/expense/organizations', { query: undefined, body: { name: 'Acme', currency: 'USD', fiscal_start_month: 1 } });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });
});
