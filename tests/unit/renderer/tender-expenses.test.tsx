// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn(), on: () => () => undefined }));
vi.mock('../../../src/core/tabs', () => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiPost, apiPut, request } = await import('../../../src/core/api');
const { navigate } = await import('../../../src/core/tabs');
const { app } = await import('../../../src/core/app-state');
const { touchesExpenses } = await import('../../../src/core/query');
const x = await import('../../../src/modules/tenders/bidcost');
const { default: Expenses } = await import('../../../src/modules/tenders/Expenses');
const { default: Workspace, MandatoryNotice } = await import('../../../src/modules/tenders/Workspace');
const { BidBudget } = await import('../../../src/modules/tenders/Budget');
const { default: Approvals } = await import('../../../src/modules/tenders/Approvals');
const { default: NewClaim } = await import('../../../src/modules/expenses/NewClaim');

/*
 * A tender's Expenses tab (worksuite-desktop#159), from payloads shaped as
 * `TenderMoneyController::expenses()` sends them — every id and figure the
 * string MySQL returns.
 */

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

const ROW = (over: Record<string, unknown>) => ({
  id: '101', claim_no: 'EXP-101', kind: 'expense', spent_on: '2026-09-11', amount: '2500.00', currency: 'LKR', base_amount: '2500.00', base_currency: 'LKR',
  description: 'Courier to the buyer', status: 'approved', policy_state: 'clear', receipt_file_id: null, user_id: '8', category_id: '6', category: 'Courier',
  claimant: 'Dimuthu Perera', tender_id: '7', refundable: '0', refunded_at: null, ...over,
});

const TAB = {
  items: [
    ROW({}),
    ROW({ id: '102', claim_no: 'EXP-102', amount: '10000.00', base_amount: '10000.00', description: 'Bid document fee', category: 'Bid document fee', status: 'paid', receipt_file_id: '9' }),
    ROW({ id: '103', claim_no: 'EXP-103', amount: '6000.00', base_amount: '6000.00', description: 'Bid bond', category: 'Bid bond / security', refundable: '1' }),
  ],
  total: '3', sum: '18500.00', visible: true, why: null, org_id: '1',
  can: { view: true, create: true, link: true, unlink: true, refund: true, budget: true },
  totals: {
    count: 3, currency: 'LKR', unconverted: 0, spent: '18500.00', pending: '0.00', reimbursable: '8500.00', paid: '10000.00', rejected: '0.00',
    refundable: '6000.00', refunded: '0.00', written_off: '12500.00',
    by_status: { approved: { count: 2, sum: '8500.00' }, paid: { count: 1, sum: '10000.00' } },
    by_category: [{ category_id: 3, name: 'Bid document fee', count: 1, sum: '10000.00' }],
  },
  currency: 'LKR',
  planned: { amount: '25000.00', currency: 'LKR' },
  variance: { spent: '18500.00', planned: '25000.00', percent: 74, over: false, remaining: '6500.00' },
  written_off: null,
  categories: x.QUICK.map((name, i) => ({ name, id: name === 'Stamp duty' ? null : 20 + i, refundable: name === 'Bid bond / security' })),
  prefill: { org_id: 1, tender_id: 7, project_id: 9 },
};

const ORGS = { items: [{ id: 1, name: 'Acme', slug: 'acme', role: 'finance', member: true, can_act: true, currency: 'LKR', favourite: false }], current: 1, empty_reason: null };

let tab: Record<string, unknown>;

beforeEach(() => {
  tab = structuredClone(TAB) as Record<string, unknown>;
  app.set({ auth: { user: { id: '8' } } as never, bootstrap: { permissions: ['tender.view', 'expense.view'] } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/tenders/7/expenses') return tab as never;
    if (path === '/api/tenders/7/expenses/linkable') return { items: [ROW({ id: '110', claim_no: 'EXP-110', description: 'Taxi to the site visit', tender_id: null, status: 'submitted' })] } as never;
    if (path === '/api/expense/organizations') return ORGS as never;
    if (path === '/api/expense/categories2') return { items: [{ id: '20', org_id: '0', name: 'Bid document fee', status: 'active', shared: true }, { id: '23', org_id: '0', name: 'Courier', status: 'active', shared: true }] } as never;
    if (path === '/api/expense/settings2') return { settings: { currency: 'LKR', require_project: '0' } } as never;
    if (path === '/api/expense/cost-centres') return { items: [] } as never;
    if (path === '/api/expense/related')
      return {
        types: [
          { key: 'project', label: 'Project', field: 'project_id', scoped: false, empty: false, items: [{ id: 9, label: 'Galle roads' }] },
          { key: 'tender', label: 'Tender', field: 'tender_id', scoped: true, empty: false, items: [{ id: 7, label: 'Road resurfacing (RFQ/7)' }] },
        ],
      } as never;
    if (path === '/api/expense/advances') return { items: [] } as never;
    if (path === '/api/expense/rates') return { mileage: [], per_diem: [] } as never;
    if (path === '/api/tender/owners') return { items: [] } as never;
    throw new Error(`unexpected ${path}`);
  });
  vi.mocked(apiPost).mockResolvedValue({ id: 130, claim_no: 'EXP-130', message: 'Filed.', workings: [] } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the pieces', () => {
  it('says spending against the plan in words, and warns only when over', () => {
    const v = x.toVariance(TAB.variance)!;
    expect(x.varianceLine(v, 'LKR')).toBe('Spent LKR 18,500 of LKR 25,000 planned (74%)');
    expect(x.overBy(v, 'LKR')).toBeNull();
    expect(x.overBy({ ...v, over: true, remaining: '-3500.00', percent: 114 }, 'LKR')).toBe('Over the bid budget by LKR 3,500.');
    expect(x.whole('2500.50')).toBe('2,500.50');
    expect(x.amount(null, 'LKR')).toBe('—');
  });
  it('names the tab with how many are linked', () => {
    expect(x.expensesTabLabel(3)).toBe('Expenses · 3');
    expect(x.expensesTabLabel(0)).toBe('Expenses');
    expect(x.expensesTabLabel(undefined)).toBe('Expenses');
  });
  it('opens the Expense form with the tender, its project and a quick category', () => {
    expect(x.presetFor({ org_id: 1, tender_id: 7, project_id: 9 }, 21)).toEqual({ tender_id: 7, project_id: 9, category_id: 21 });
    expect(x.presetFor({ org_id: 1, tender_id: 7 }, null)).toEqual({ tender_id: 7 });
  });
  it('reads the server’s strings', () => {
    const d = x.toTenderExpenses(tab);
    expect(d.items.map((i) => [i.id, i.has_receipt, i.refundable])).toEqual([[101, false, false], [102, true, false], [103, false, true]]);
    expect(d.org_id).toBe(1);
    expect(d.can.create).toBe(true);
    expect(x.toTenderExpenses({ visible: false, why: 'No.' }).can).toEqual({ view: false, create: false, link: false, unlink: false, refund: false, budget: false });
  });
  it('refreshes on an expense claim changing, here or by notification', () => {
    expect(touchesExpenses({ type: 'expense.claim.changed' })).toBe(true);
    expect(touchesExpenses({ type: 'notification', event: 'expense.approved' })).toBe(true);
    expect(touchesExpenses({ type: 'notification', event: 'mail.received' })).toBe(false);
  });
});

describe('the Expenses tab', () => {
  const tender = { title: 'Road resurfacing', reference: 'RFQ/7', currency: 'LKR' };

  it('shows the cards, the variance against the bid budget and the rows', async () => {
    wrap(<Expenses id={7} tender={tender} />);
    const cards = await screen.findByLabelText('Bid cost');
    expect(within(cards).getByText('LKR 18,500')).toBeTruthy();
    expect(within(cards).getByText('LKR 8,500')).toBeTruthy();
    expect(within(cards).getByText('74%')).toBeTruthy();
    expect(screen.getByLabelText('Budget variance').textContent).toBe('Spent LKR 18,500 of LKR 25,000 planned (74%)');
    const table = screen.getByRole('table', { name: 'Expenses against this tender' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Bid document fee', { selector: 'button' })).toBeTruthy();
    expect(within(table).getByText('Refundable')).toBeTruthy();
    expect(within(table).getByLabelText('Has a receipt')).toBeTruthy();
    expect(screen.getByText('LKR 6,000 is refundable and has not come back yet.')).toBeTruthy();
  });

  it('warns when spending is over the bid budget, and shows a lost bid’s write-off', async () => {
    tab.variance = { spent: '28500.00', planned: '25000.00', percent: 114, over: true, remaining: '-3500.00' };
    tab.written_off = '12500.00';
    wrap(<Expenses id={7} tender={tender} />);
    expect((await screen.findByLabelText('Budget variance')).textContent).toBe('Spent LKR 28,500 of LKR 25,000 planned (114%) · Over the bid budget by LKR 3,500.');
    expect(screen.getByText('Bid cost written off:').textContent).toContain('LKR 12,500');
  });

  it('adds through the Expense module’s own form, with the tender locked in', async () => {
    wrap(<Expenses id={7} tender={tender} />);
    const chips = await screen.findByLabelText('Quick categories');
    expect((within(chips).getByText('Stamp duty') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(chips).getByText('Courier'));
    const form = await screen.findByRole('dialog', { name: 'File an expense' });
    expect(within(form).getByText('the tender RFQ/7 · Road resurfacing')).toBeTruthy();
    // The tender is decided, so its picker is not offered; the project still is.
    await within(form).findByRole('combobox', { name: 'Project' });
    expect(within(form).queryByRole('combobox', { name: 'Tender' })).toBeNull();
    expect(apiGet).toHaveBeenCalledWith('/api/expense/organizations', undefined, expect.anything());
  });

  it('files with the tender on the claim', async () => {
    vi.mocked(request).mockResolvedValue({ data: { ready: true, base_amount: '2500.00', base_currency: 'LKR', blocks: [], warnings: [], budgets: [] }, message: 'OK', offline: false, cachedAt: null });
    const onDone = vi.fn();
    wrap(<NewClaim orgId={1} orgs={ORGS.items as never} onClose={vi.fn()} onDone={onDone} preset={x.presetFor(TAB.prefill, 23)} fixed={['tender_id']} relatedLabel="the tender RFQ/7 · Road resurfacing" />);
    await screen.findByText('Before you file');
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '2500' } });
    fireEvent.change(screen.getByPlaceholderText("Taxi from the airport to the client's office"), { target: { value: 'Courier to the buyer' } });
    await screen.findByText('Nothing objects to this claim.', undefined, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(screen.getByText('File it'));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/expense/claims2', expect.objectContaining({ tender_id: '7', project_id: '9', category_id: '23', amount: '2500' }), { org: 1 });
    expect(onDone).toHaveBeenCalledWith(130);
  });

  it('links an existing expense that is on no tender yet', async () => {
    wrap(<Expenses id={7} tender={tender} />);
    fireEvent.click(await screen.findByText('Link existing expense'));
    const sheet = await screen.findByRole('dialog', { name: 'Link an existing expense' });
    expect(await within(sheet).findByText('Taxi to the site visit')).toBeTruthy();
    vi.mocked(apiPost).mockResolvedValueOnce({} as never);
    await act(async () => {
      fireEvent.click(within(sheet).getByText('Link'));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/tenders/7/expenses/link', { claim_id: 110 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Link an existing expense' })).toBeNull());
  });

  it('offers neither adding nor linking without the rights, and says why when it cannot be seen', async () => {
    tab.can = { view: true, create: false, link: false, unlink: false, refund: false, budget: false };
    const { unmount } = wrap(<Expenses id={7} tender={tender} />);
    await screen.findByLabelText('Bid cost');
    expect(screen.queryByText('Add expense')).toBeNull();
    expect(screen.queryByText('Link existing expense')).toBeNull();
    unmount();

    tab = { items: [], visible: false, why: 'Expenses against this tender are visible to people who can open the Expenses module.', can: {} };
    wrap(<Expenses id={7} tender={tender} />);
    expect(await screen.findByText('Expenses against this tender are visible to people who can open the Expenses module.')).toBeTruthy();
  });
});

describe('the tender’s tabs and overview', () => {
  const show = (bidCost: Record<string, unknown> | null) => ({
    tender: { id: 7, org_id: 1, title: 'Road resurfacing', reference: 'RFQ/7', stage: 'lost', stage_label: 'Lost', outcome: 'lost', currency: 'LKR' },
    requirements: { summary: { total: 0, mandatory: 0, missing: 0, expired: 0, ready: false }, note: 'Nothing is marked mandatory yet, so nothing is blocking submission.' },
    history: [{ id: 1, from: 'Submitted', to: 'Lost', note: null, actor: 'Samali', at: '2026-09-20 06:00:00' }],
    expense_history: [{ id: 5, tender_id: 7, kind: 'expense.added', body: 'Expense LKR 2,500 (Courier) added by Dimuthu', actor_name: 'Dimuthu', created_at: '2026-09-21 06:00:00' }],
    ...(bidCost ? { bid_cost: bidCost } : {}),
  });
  const COST = { visible: true, why: null, totals: TAB.totals, currency: 'LKR', planned: TAB.planned, variance: TAB.variance, written_off: '12500.00' };

  const mount = (payload: Record<string, unknown>, tabName = 'overview', perms = ['tender.view', 'expense.view']) => {
    app.set({ bootstrap: { permissions: perms } as never });
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/tenders/7') return payload as never;
      if (path === '/api/tenders/7/contacts') return { count: 0, items: [], can: { manage: false } } as never;
      throw new Error(`unexpected ${path}`);
    });
    const onTab = vi.fn();
    wrap(<Workspace id={7} bands={[]} canManage={false} canApprove={false} tab={tabName} onTab={onTab} onBack={() => undefined} onEdit={() => undefined} />);
    return onTab;
  };

  it('shows the Expenses tab, counted, beside Budget — and the bid cost on the Overview', async () => {
    const onTab = mount(show(COST));
    const tabs = await screen.findByRole('tablist', { name: 'Tender' });
    const names = within(tabs).getAllByRole('tab').map((t) => t.textContent);
    expect(names.slice(names.indexOf('Budget'), names.indexOf('Budget') + 2)).toEqual(['Budget', 'Expenses · 3']);
    expect(screen.getByLabelText('Bid cost so far').textContent).toBe('LKR 18,500');
    expect(screen.getByText('Bid cost written off:').textContent).toContain('LKR 12,500');
    fireEvent.click(within(tabs).getByText('Expenses · 3'));
    expect(onTab).toHaveBeenCalledWith('expenses');
  });

  it('hides it without the Expenses permission, or when the server says this tender’s are not theirs', async () => {
    mount(show(COST), 'overview', ['tender.view']);
    await screen.findByRole('tablist', { name: 'Tender' });
    expect(screen.queryByRole('tab', { name: /Expenses/ })).toBeNull();
    expect(screen.queryByLabelText('Bid cost so far')).toBeNull();
    cleanup();

    mount(show({ ...COST, visible: false, why: 'Your part on this tender does not include its expenses.' }));
    await screen.findByRole('tablist', { name: 'Tender' });
    expect(screen.queryByRole('tab', { name: /Expenses/ })).toBeNull();
  });

  it('puts the expense lines in the History beside the moves', async () => {
    mount(show(COST), 'history');
    const h = await screen.findByLabelText('Stage history');
    expect(within(h).getByText('Expense LKR 2,500 (Courier) added by Dimuthu')).toBeTruthy();
    expect(within(h).getByText('Submitted → Lost')).toBeTruthy();
  });

  it('turns "nothing is mandatory" into a notice that leads to the Checklist', async () => {
    const onChecklist = vi.fn();
    wrap(<MandatoryNotice note="Nothing is marked mandatory yet, so nothing is blocking submission." onChecklist={onChecklist} />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Nothing is marked mandatory yet');
    fireEvent.click(within(note).getByText('Open the Checklist'));
    expect(onChecklist).toHaveBeenCalled();
  });
});

describe('the Budget tab', () => {
  it('shows the bid budget against what was spent, and saves a new one', async () => {
    const cost = x.toBidCost({ visible: true, totals: TAB.totals, currency: 'LKR', planned: TAB.planned, variance: TAB.variance, written_off: null });
    vi.mocked(apiPut).mockResolvedValue({ planned: { amount: '30000.00', currency: 'LKR' } } as never);
    wrap(<BidBudget id={7} bidCost={cost} currency="LKR" canManage onExpenses={vi.fn()} />);
    expect(screen.getByText('LKR 25,000')).toBeTruthy();
    expect(screen.getByLabelText('Budget variance').textContent).toBe('Spent LKR 18,500 of LKR 25,000 planned (74%)');
    fireEvent.click(screen.getByText('Change'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Bid budget' }), { target: { value: '30,000' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(apiPut).toHaveBeenCalledWith('/api/tenders/7/bid-budget', { amount: '30000' });
  });

  it('offers no change to somebody who may not manage the tender', () => {
    wrap(<BidBudget id={7} bidCost={x.toBidCost({ visible: true, totals: TAB.totals, currency: 'LKR', planned: null, variance: null })} currency="LKR" canManage={false} />);
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(screen.queryByText('Set a bid budget')).toBeNull();
    expect(screen.getByText('Spent LKR 18,500 so far; set a bid budget to see it against a plan.')).toBeTruthy();
  });
});

describe('the Approvals tab', () => {
  it('greys "Add the step" only while the step has no name', async () => {
    wrap(<Approvals id={7} org="1" rows={[]} canManage canApprove={false} />);
    const add = screen.getByText('Add the step') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe('Name the step first');
    fireEvent.change(screen.getByRole('textbox', { name: 'The step' }), { target: { value: 'Finance' } });
    expect(add.disabled).toBe(false);
    expect(add.title).toBe('');
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 1 } as never);
    await act(async () => {
      fireEvent.click(add);
    });
    expect(apiPost).toHaveBeenCalledWith('/api/tenders/7/approvals', { role_label: 'Finance', step: 1, approver_id: null });
  });
});

describe('the Expenses module', () => {
  it('shows what a claim is linked to, with the way back to the tender', async () => {
    const c = await import('../../../src/modules/expenses/claim-data');
    const d = c.toDetail({ id: '5', linked: { type: 'tender', id: '7', label: 'Road resurfacing', reference: 'RFQ/7' }, refundable: '1', refunded_at: null });
    expect(d.linked).toEqual({ type: 'tender', id: 7, label: 'Road resurfacing', reference: 'RFQ/7' });
    expect(c.linkedLine(d.linked!)).toBe('Tender: Road resurfacing (RFQ/7)');
    expect(d.refundable).toBe(true);
    expect(c.toDetail({ id: '6' }).linked).toBeNull();
  });

  it('opens a row in the Expense module’s drawer, with the tender’s own actions above it', async () => {
    const base = vi.mocked(apiGet).getMockImplementation()!;
    vi.mocked(apiGet).mockImplementation(async (path: string, ...rest: unknown[]) => {
      if (path === '/api/expense/claims2/103')
        return { ...ROW({ id: '103', claim_no: 'EXP-103', description: 'Bid bond', category: 'Bid bond / security', refundable: '1' }), org_id: '1', organization: 'Acme', approvals: [], versions: [], policy: [], duplicates: [], activity: [], linked: { type: 'tender', id: '7', label: 'Road resurfacing', reference: 'RFQ/7' } } as never;
      return base(path, ...(rest as []));
    });
    wrap(<Expenses id={7} tender={{ title: 'Road resurfacing', reference: 'RFQ/7', currency: 'LKR' }} />);
    fireEvent.click(await screen.findByText('Bid bond', { selector: 'button' }));
    const actions = await screen.findByLabelText('On this tender');
    expect(await screen.findByText('Tender: Road resurfacing (RFQ/7)')).toBeTruthy();
    fireEvent.click(within(actions).getByText('Open in Expenses'));
    expect(navigate).toHaveBeenCalledWith('/expenses?claim=103&org=1');
    vi.mocked(apiPost).mockResolvedValueOnce({} as never);
    await act(async () => {
      fireEvent.click(within(actions).getByText('Mark refunded'));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/tenders/7/expenses/103/refunded', {});
  });
});
