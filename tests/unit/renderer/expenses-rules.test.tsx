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

const { ApiError, apiGet, apiPost, apiPut, request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const r = await import('../../../src/modules/expenses/rules');
const { default: Budgets } = await import('../../../src/modules/expenses/Budgets');
const { default: Policies } = await import('../../../src/modules/expenses/Policies');

/*
 * Budgets and Policies, drawn from payloads shaped as RulesController sends
 * them — flags as "0"/"1", counts as strings — to prove they render, say the
 * things that matter, and send the company as `?org=`.
 */

const org: Org = { id: 3, name: 'CreativeFX', slug: 'creativefx', role: 'admin', member: true, can_act: true, currency: 'LKR', favourite: false };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const TRAVEL = {
  id: 7,
  name: 'Travel — September',
  scope: 'department',
  scope_name: 'Sales',
  currency: 'LKR',
  amount: '100000.00',
  committed: '20000.00',
  approved: '30000.00',
  paid: '10000.00',
  used: '60000.00',
  remaining: '40000.00',
  pct: '60',
  claims: '4',
  hard_stop: '1',
  alert_at_pct: '80',
  period: 'September 2026',
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  forecast: { amount: '130000.00', basis: 'at the rate of the last 14 days, extended to all 30', over_by: '30000.00' },
};

const OFFICE = {
  id: 8,
  name: 'Office supplies',
  scope: 'organization',
  scope_name: 'The whole organization',
  currency: 'LKR',
  amount: '50000.00',
  committed: '0.00',
  approved: '0.00',
  paid: '55000.00',
  used: '55000.00',
  remaining: '-5000.00',
  pct: 110,
  claims: 2,
  hard_stop: '0',
  alert_at_pct: 80,
  period: 'quarter to 30 Sep 2026',
  period_start: '2026-07-01',
  period_end: '2026-09-30',
  forecast: null,
};

const NOTE = 'The "at this rate" figure is the current run rate extended to the end of the period. It is arithmetic, not a prediction.';

const POLICY = {
  id: '3',
  name: 'Travel spending',
  description: 'Flights, hotels and taxis',
  scope: 'everyone',
  scope_id: null,
  role_slug: null,
  category_id: '5',
  currency: 'LKR',
  max_per_claim: '5000.00',
  max_per_day: null,
  max_per_month: '50000.00',
  max_per_year: null,
  receipt_required_above: '2500.00',
  reason_required_above: null,
  max_age_days: null,
  block_weekends: '1',
  enforcement: 'hard',
  priority: '10',
  status: 'active',
  effective_from: null,
  effective_to: null,
};

const MEALS = { ...POLICY, id: '4', name: 'Meals', description: null, scope: 'role', role_slug: 'manager', category_id: null, max_per_claim: null, max_per_month: null, receipt_required_above: '0.00', block_weekends: '0', enforcement: 'warn', priority: '20' };
const OLD = { ...POLICY, id: '5', name: 'Old taxi rule', category_id: null, status: 'archived', priority: '30' };

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'] } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/expense/budgets') return { items: [TRAVEL, OFFICE], currency: 'LKR', can_edit: true, note: NOTE };
    if (path === '/api/expense/budgets/7') {
      const { scope_name: _drop, ...one } = TRAVEL;
      return { ...one, claim_list: [{ id: '41', claim_no: 'EXP-0041', spent_on: '2026-09-12', base_amount: '25000.00', description: 'Flights to Kandy', status: 'approved', claimant: 'Nimal Perera' }] };
    }
    if (path === '/api/expense/members') return { items: [{ id: 1, user_id: 21, name: 'Nimal Perera', email: 'nimal@example.test', role: 'approver' }], branches: [], departments: [{ id: 12, name: 'Sales' }, { id: 13, name: 'Support' }] };
    if (path === '/api/expense/categories2') return { items: [{ id: 5, name: 'Travel', org_id: 0, shared: true }] };
    if (path === '/api/expense/cost-centres') return { items: [] };
    if (path === '/api/expense/policies') return { items: [POLICY, MEALS, OLD], currency: 'LKR', can_edit: true, scopes: [] };
    if (path === '/api/expense/approval-rules')
      return {
        items: [{ id: '2', name: 'Anything over 50,000', entity: 'claim', min_amount: '50000.00', max_amount: null, priority: '10', status: 'active', category_id: null, department_id: null, cost_centre_id: null, project_id: null, steps: [{ id: 1, step: 1, resolver: 'manager', role: null, user_id: null, label: null, skip_if_unresolved: '1' }, { id: 2, step: 2, resolver: 'role', role: 'finance', user_id: null, label: null, skip_if_unresolved: '1' }] }],
        stalled: [{ approval_id: 90, entity_type: 'claim', entity_id: 55, label: 'Head of department', days_waiting: 9, reason: 'No approver could be matched to this step.' }],
        currency: 'LKR',
        can_edit: true,
        resolvers: [
          { key: 'manager', label: 'The claimant’s line manager' },
          { key: 'role', label: 'Anyone holding a role in this organization' },
        ],
      };
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('expenses rules: conversions and pure helpers', () => {
  it('never reads "0" as yes, and keeps a missing percentage missing', () => {
    expect(r.flag('0')).toBe(false);
    expect(r.flag('1')).toBe(true);
    expect(r.flag(true)).toBe(true);
    expect(r.flag(null)).toBe(false);
    const b = r.toBudget({ ...OFFICE, hard_stop: '0', pct: null, claims: '3' });
    expect(b.hard_stop).toBe(false);
    expect(b.pct).toBeNull();
    expect(b.claims).toBe(3);
    expect(r.toBudget(TRAVEL).pct).toBe(60);
  });

  it('reads a period’s kind back from the label the engine writes', () => {
    expect(r.periodKind('September 2026')).toBe('month');
    expect(r.periodKind('quarter to 30 Sep 2026')).toBe('quarter');
    expect(r.periodKind('year to 31 Mar 2027')).toBe('year');
    expect(r.periodKind('1 Sep – 15 Oct 2026')).toBe('custom');
  });

  it('finds a stored scope again by its one exact name, or the "#12" of a row that is gone — never guessing between two', () => {
    const opts = [
      { id: 12, name: 'Sales', label: 'Sales' },
      { id: 13, name: 'Support', label: 'Support' },
      { id: 14, name: 'Support', label: 'Support' },
    ];
    expect(r.scopeIdFor(opts, 'sales')).toBe(12);
    expect(r.scopeIdFor(opts, 'Support')).toBeNull();
    expect(r.scopeIdFor(null, '#44')).toBe(44);
    expect(r.scopeIdFor(opts, '')).toBeNull();
  });

  it('sorts most used first with the unscored last either way, and filters over, near and hard', () => {
    const list = [r.toBudget(TRAVEL), r.toBudget(OFFICE), r.toBudget({ ...OFFICE, id: 9, name: 'Nothing yet', pct: null, remaining: '10.00', hard_stop: false })];
    const f = { q: '', period: '', state: '' as const, sort: 'used' as const };
    expect(r.shownBudgets(list, { ...f, dir: 'desc' }).map((b) => b.id)).toEqual([8, 7, 9]);
    expect(r.shownBudgets(list, { ...f, dir: 'asc' }).map((b) => b.id)).toEqual([7, 8, 9]);
    expect(r.shownBudgets(list, { ...f, state: 'over', dir: 'desc' }).map((b) => b.id)).toEqual([8]);
    expect(r.shownBudgets(list, { ...f, state: 'hard', dir: 'desc' }).map((b) => b.id)).toEqual([7]);
    expect(r.shownBudgets(list, { ...f, sort: 'remaining', dir: 'asc' }).map((b) => b.id)).toEqual([8, 9, 7]);
    expect(r.shownBudgets(list, { ...f, q: 'sales', dir: 'desc' }).map((b) => b.id)).toEqual([7]);
  });

  it('keeps money as strings: signed cents for comparing, a shortfall without its minus, a bar clamped to its track', () => {
    expect(r.signedCents('-5000.00')).toBe(-500000);
    expect(r.signedCents('1,250.5')).toBe(125050);
    expect(r.signedCents('garbage')).toBe(0);
    expect(r.unsigned('-5000.00')).toBe('5000.00');
    expect(r.meterWidth(110)).toBe(100);
    expect(r.meterWidth(null)).toBe(0);
    expect(r.meterTone(r.toBudget(OFFICE))).toBe('over');
    expect(r.meterTone(r.toBudget({ ...TRAVEL, pct: 85 }))).toBe('near');
    expect(r.meterTone(r.toBudget(TRAVEL))).toBe('hard');
  });

  it('builds a budget body the engine reads: no id for the whole organization, an end only for chosen dates, the warning line checked', () => {
    const d = r.budgetDraft(null, '2026-09-28');
    expect(r.budgetBody({ ...d, name: ' Travel ', amount: '75000' }, 12)).toEqual({ name: 'Travel', scope: 'organization', scope_id: null, amount: '75000', period: 'month', period_start: '2026-09-28', alert_at_pct: 80, hard_stop: false });
    expect(r.budgetBody({ ...d, scope: 'department', period: 'custom', period_end: '2026-10-15' }, 12)).toMatchObject({ scope_id: 12, period_end: '2026-10-15' });
    expect(r.budgetProblems({ ...d, alert_at_pct: '' })).toEqual(['Warn at has to be a whole percentage from 1 to 100.']);
    expect(r.budgetProblems({ ...d, alert_at_pct: '101' }).length).toBe(1);
    const edit = r.budgetDraft(r.toBudget(OFFICE), '2026-09-28');
    expect(edit.period).toBe('quarter');
    expect(edit.period_start).toBe('2026-07-01');
  });

  it('says a policy’s rules in words, receipts at zero as always', () => {
    const p = r.toPolicy(POLICY);
    expect(r.policyLimits(p, 'LKR')).toEqual(['LKR 5,000.00 a claim', 'LKR 50,000.00 a month', 'receipt above LKR 2,500.00', 'no weekend dates']);
    expect(r.policyLimits(r.toPolicy(MEALS), 'LKR')).toEqual(['receipt always']);
    expect(r.policyLimits(r.toPolicy({ ...MEALS, receipt_required_above: null, max_age_days: '1' }), 'LKR')).toEqual(['nothing older than 1 day']);
    expect(r.policyScope(r.toPolicy({ ...POLICY, scope: 'department', scope_id: '12' }), { people: { users: [], branches: [], departments: [{ id: 12, name: 'Sales', label: 'Sales' }] } })).toBe('Department: Sales');
    expect(r.policyScope(r.toPolicy({ ...POLICY, scope: 'cost_centre', scope_id: '4' }), {})).toBe('Cost centre #4');
  });

  it('carries what the policy form does not show, so an archived policy edited stays archived', () => {
    const old = r.toPolicy({ ...OLD, effective_from: '2026-01-01' });
    const body = r.policyBody(r.policyDraft(old), old, null);
    expect(body).toMatchObject({ status: 'archived', effective_from: '2026-01-01', scope: 'everyone', scope_id: null, role_slug: null, category_id: null, block_weekends: true, priority: 30 });
    expect(r.policyProblems({ ...r.policyDraft(null), priority: '' })).toEqual(['Order has to be a whole number. Lower runs first.']);
  });

  it('sends a rule’s steps whole, a role step with its role and a skipped flag as the server stored it', () => {
    const rule = r.toRule({ id: 2, name: 'Big', entity: 'claim', priority: '5', status: 'active', category_id: '9', steps: [{ resolver: 'role', role: null, skip_if_unresolved: '0' }, { resolver: 'user', user_id: '21' }] });
    const body = r.ruleBody(r.ruleDraft(rule), rule);
    expect(body).toMatchObject({ category_id: 9, status: 'active', priority: 5 });
    expect(body.steps).toEqual([
      { resolver: 'role', role: 'approver', user_id: null, label: null, skip_if_unresolved: false },
      { resolver: 'user', role: null, user_id: 21, label: null, skip_if_unresolved: true },
    ]);
  });

  it('names the company on every write — the query string, as the server looks for it first', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ message: 'Budget saved.' });
    await r.saveBudget(3, { name: 'x' }, 7);
    expect(apiPut).toHaveBeenCalledWith('/api/expense/budgets/7?org=3', { name: 'x' });
    vi.mocked(apiPost).mockResolvedValueOnce({ message: 'Budget created.' });
    await r.saveBudget(3, { name: 'x' }, null);
    expect(apiPost).toHaveBeenCalledWith('/api/expense/budgets', { name: 'x' }, { org: 3 });
    vi.mocked(request).mockResolvedValueOnce({ data: null, offline: false, cachedAt: null, message: 'Budget closed. Its figures stay available in reports.' });
    expect(await r.closeBudget(3, 7)).toBe('Budget closed. Its figures stay available in reports.');
    expect(request).toHaveBeenCalledWith('DELETE', '/api/expense/budgets/7', { query: { org: 3 } });
  });
});

describe('expenses rules: the Budgets screen', () => {
  it('shows the over-budget row, a hard stop, and a budget heading over its figure at this rate', async () => {
    wrap(<Budgets org="3" orgId={3} orgs={[org]} onGo={vi.fn()} />);
    await screen.findByText('Travel — September');
    expect(apiGet).toHaveBeenCalledWith('/api/expense/budgets', { org: 3 }, expect.anything());
    // "0" is not a hard stop: only Travel carries the pill.
    expect(screen.getAllByText('Hard limit').length).toBe(1);
    expect(screen.getByText('LKR 5,000.00 over')).toBeTruthy();
    expect(screen.getByText('at this rate LKR 30,000.00 over')).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.getByText('New budget')).toBeTruthy();
  });

  it('opens one budget to its three figures, the run rate with its caveat, the hard stop said, and the claims that consumed it', async () => {
    const onGo = vi.fn();
    wrap(<Budgets org="3" orgId={3} orgs={[org]} onGo={onGo} />);
    fireEvent.click(await screen.findByText('Travel — September'));
    await screen.findByText('Flights to Kandy');
    expect(screen.getByText('LKR 60,000.00 of LKR 100,000.00 used across 4 claims.')).toBeTruthy();
    expect(screen.getByText(/A hard limit: a claim that would break it is refused\. It warns at 80% used\./)).toBeTruthy();
    expect(screen.getByText('At this rate, LKR 130,000.00 — LKR 30,000.00 over.')).toBeTruthy();
    expect(screen.getByText(/at the rate of the last 14 days, extended to all 30\. Arithmetic, not a prediction\./)).toBeTruthy();
    expect(screen.getByText('Submitted, not yet decided.')).toBeTruthy();
    fireEvent.click(screen.getByText('Flights to Kandy'));
    expect(onGo).toHaveBeenCalledWith('organization', '&claim=41');
  });

  it('offers nothing to change without expense.admin, even where the company would allow it', async () => {
    app.set({ bootstrap: { permissions: ['expense.view'] } as never });
    wrap(<Budgets org="3" orgId={3} orgs={[org]} onGo={vi.fn()} />);
    await screen.findByText('Travel — September');
    expect(screen.queryByText('New budget')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
  });

  it('shows the server’s refusal of a new budget as it said it', async () => {
    const said = 'This needs administrator rights in CreativeFX. You are an approver there.';
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(403, said, null));
    wrap(<Budgets org="3" orgId={3} orgs={[org]} onGo={vi.fn()} />);
    fireEvent.click(await screen.findByText('New budget'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Travel' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '75000' } });
    fireEvent.click(screen.getByText('Save'));
    await screen.findByText(said);
    expect(apiPost).toHaveBeenCalledWith('/api/expense/budgets', expect.objectContaining({ name: 'Travel', scope: 'organization', scope_id: null, amount: '75000', period: 'month', alert_at_pct: 80, hard_stop: false }), { org: 3 });
  });

  it('edits a budget with its scope found again by name and its period kept as the kind it is', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ message: 'Budget saved.' });
    wrap(<Budgets org="3" orgId={3} orgs={[org]} onGo={vi.fn()} />);
    const line = (await screen.findByText('Travel — September')).closest('[role="button"]') as HTMLElement;
    fireEvent.click(within(line).getByText('Edit'));
    await screen.findByText('Sales', { selector: 'span' });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/expense/budgets/7?org=3', expect.objectContaining({ scope: 'department', scope_id: 12, period: 'month', period_start: '2026-09-01', hard_stop: true, alert_at_pct: 80 })));
  });
});

describe('expenses rules: the Policies screen', () => {
  it('lists active policies with their caps in a sentence, the category named, and what each does when it fires', async () => {
    wrap(<Policies org="3" orgId={3} orgs={[org]} onGo={vi.fn()} />);
    await screen.findByText('Travel spending');
    expect(apiGet).toHaveBeenCalledWith('/api/expense/policies', { org: 3 }, expect.anything());
    expect(screen.getByText('LKR 5,000.00 a claim · LKR 50,000.00 a month · receipt above LKR 2,500.00 · no weekend dates')).toBeTruthy();
    expect(await screen.findByText('only Travel')).toBeTruthy();
    expect(screen.getByText('Role: manager')).toBeTruthy();
    expect(screen.getByText('receipt always')).toBeTruthy();
    expect(screen.getByText('Refuses')).toBeTruthy();
    expect(screen.getByText('Flags')).toBeTruthy();
    // Archived policies are a filter, hidden by default.
    expect(screen.queryByText('Old taxi rule')).toBeNull();
    expect(screen.getByText('New policy')).toBeTruthy();
    expect(screen.getAllByText('Archive').length).toBe(2);
  });

  it('offers no new policy, edit or archive without expense.admin', async () => {
    app.set({ bootstrap: { permissions: ['expense.view'] } as never });
    wrap(<Policies org="3" orgId={3} orgs={[org]} onGo={vi.fn()} />);
    await screen.findByText('Travel spending');
    expect(screen.queryByText('New policy')).toBeNull();
    expect(screen.queryByText('Archive')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
  });

  it('archives behind a sentence saying the record of a refusal survives, and shows the server’s answer', async () => {
    vi.mocked(request).mockResolvedValueOnce({ data: null, offline: false, cachedAt: null, message: 'Policy archived. It stops applying now, and claims it already refused still name it.' });
    wrap(<Policies org="3" orgId={3} orgs={[org]} onGo={vi.fn()} />);
    await screen.findByText('Travel spending');
    fireEvent.click(screen.getAllByText('Archive')[0]!);
    expect(screen.getByText('It stops applying from now. Claims it already refused still name it, so the record of the refusal survives.')).toBeTruthy();
    fireEvent.click(screen.getByText('Archive it'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('DELETE', '/api/expense/policies/3', { query: { org: 3 } }));
  });

  it('shows routing: the stalled claims, the chain, and who a rule would ask', async () => {
    const onGo = vi.fn();
    vi.mocked(apiPost).mockResolvedValueOnce({
      ok: true,
      message: '1 of 2 steps resolve to nobody for this claimant.',
      steps: [
        { step: 1, label: 'Line manager', resolver: 'manager', resolves_to: 'Nimal Perera', problem: null },
        { step: 2, label: 'Finance', resolver: 'role', resolves_to: null, problem: 'Would be skipped: nobody holds the finance role here.' },
      ],
    });
    wrap(<Policies org="3" orgId={3} orgs={[org]} onGo={onGo} />);
    await screen.findByText('Travel spending');
    fireEvent.click(screen.getByText('Approval routing'));
    await screen.findByText('Anything over 50,000');
    expect(screen.getByText('1 claim is waiting on a step with nobody assigned')).toBeTruthy();
    expect(screen.getByText('Expense claims · from LKR 50,000.00 · order 10')).toBeTruthy();
    expect(screen.getByText('manager')).toBeTruthy();
    expect(screen.getByText('Finance role')).toBeTruthy();
    fireEvent.click(screen.getByText(/Head of department — 9 days/));
    expect(onGo).toHaveBeenCalledWith('organization', '&claim=55');
    fireEvent.click(screen.getByText('Who would it ask?'));
    await screen.findByText('would go to Nimal Perera');
    expect(apiPost).toHaveBeenCalledWith('/api/expense/approval-rules/2/preview', {}, { org: 3 });
    expect(screen.getByText('Would be skipped: nobody holds the finance role here.')).toBeTruthy();
    expect(screen.getByText(/Resolved against you as the claimant\. Nothing was created\./)).toBeTruthy();
  });
});
