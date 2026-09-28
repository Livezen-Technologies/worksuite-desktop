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
const A = await import('../../../src/modules/expenses/approvals-api');
const { default: Approvals } = await import('../../../src/modules/expenses/Approvals');
const { default: Advances } = await import('../../../src/modules/expenses/Advances');

/*
 * The approval queue and cash advances, drawn from payloads shaped as the
 * server sends them (ClaimController::queue, bulkDecideQueue, duplicates;
 * MoneyController::advances, advance) — every column a string, as PHP's
 * driver hands them over — to prove the screens decide, refuse and settle
 * without a server.
 */

const ME = 7;

const ORGS: Org[] = [
  { id: 2, name: 'CreativeFX', slug: 'cfx', role: 'admin', member: true, can_act: true, currency: 'LKR', favourite: false },
  { id: 3, name: 'Livezen', slug: 'lz', role: 'approver', member: true, can_act: true, currency: 'AED', favourite: false },
];

const CLAIM_ROW = {
  approval_id: '51',
  org_id: '2',
  org: 'CreativeFX',
  entity_type: 'claim',
  entity_id: '12',
  step: '1',
  label: 'Line manager',
  waiting_since: '2026-09-19 08:00:00',
  days_waiting: '9',
  ref: 'EXP-0012',
  base_amount: '12500.00',
  base_currency: 'LKR',
  description: 'Taxi to the airport',
  spent_on: '2026-09-18',
  claimant: 'Nuwan Silva',
  category: 'Travel',
  policy: [{ rule: 'receipt', severity: 'warn', message: 'No receipt attached for a claim over LKR 5,000.', policy: 'Receipts' }],
};

const ADVANCE_ROW = {
  approval_id: '52',
  org_id: '3',
  org: 'Livezen',
  entity_type: 'advance',
  entity_id: '4',
  step: '1',
  label: 'Finance',
  waiting_since: '2026-09-27 08:00:00',
  days_waiting: '1',
  ref: 'ADV-0004',
  base_amount: '300.00',
  // The advance's own currency, which is not what `base_amount` is in.
  base_currency: 'USD',
  description: 'Dubai trade fair',
  spent_on: '2026-09-27 08:00:00',
  claimant: 'Gayani Fonseka',
  policy: [],
};

const ADVANCE = { id: '4', org_id: '2', user_id: '9', advance_no: 'ADV-0004', kind: 'travel', purpose: 'Kandy client visit', amount: '25000.00', currency: 'LKR', base_amount: '25000.00', status: 'approved', needed_by: '2026-10-02', claimant: 'Nuwan Silva', project: null, vendor: null, settled_amount: null, refund_amount: null, topup_amount: null };
const SETTLED = { ...ADVANCE, id: '3', user_id: String(ME), advance_no: 'ADV-0003', purpose: 'Galle workshop', amount: '20000.00', base_amount: '20000.00', status: 'settled', claimant: 'Kasun Dias', settled_amount: '18000.00', refund_amount: '2000.00', topup_amount: '0.00', settled_at: '2026-09-10 10:00:00' };

const position = (over: Record<string, unknown> = {}, advance: Record<string, unknown> = {}) => ({
  ok: true,
  advance: { ...ADVANCE, ...advance },
  lines: [{ claim_id: '40', claim_no: 'EXP-0040', status: 'approved', spent_on: '2026-09-21', description: 'Hotel, two nights', base_amount: '20000.00' }],
  currency: 'LKR',
  advanced: '25000.00',
  accounted: '20000.00',
  pending: '0.00',
  refund_due: '5000.00',
  company_due: '0.00',
  settleable: true,
  blocked_by: null,
  approvals: [{ id: '1', step: '1', label: 'Line manager', approver: 'Kasun Dias', approver_id: String(ME), status: 'approved', decided_by: 'Kasun Dias', decided_at: '2026-09-20 09:00:00', note: null, revision: '1', live: true }],
  ...over,
});

let advanceDetail: Record<string, unknown> = position();

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ok = (data: unknown, message: string | null = null) => ({ data, offline: false, cachedAt: null, message });

const pick = (name: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};

beforeEach(() => {
  advanceDetail = position();
  app.set({ bootstrap: { permissions: ['expense.view', 'expense.approve', 'expense.pay', 'expense.admin'] } as never, auth: { stage: 'ready', user: { id: ME } } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    if (path === '/api/expense/approvals') return { items: [CLAIM_ROW, ADVANCE_ROW], total: 2 };
    if (path === '/api/expense/duplicates')
      return {
        items:
          query?.org === 2
            ? [{ id: '31', reason: 'Same amount (LKR 12,500.00) on the same day as EXP-0011.', claim_id: '12', other_claim_id: '11', claim_no: 'EXP-0012', amount: '12500.00', currency: 'LKR', spent_on: '2026-09-18', claimant: 'Nuwan Silva', other_no: 'EXP-0011' }]
            : [],
        note: 'These are claims that look arithmetically alike — same amount, same day, or same amount and vendor within three days. It is not an accusation and nothing has been rejected.',
      };
    if (path === '/api/expense/members')
      return {
        items: [
          { user_id: String(ME), name: 'Kasun Dias', role: 'admin', status: 'active' },
          { user_id: '8', name: 'Priya Perera', role: 'approver', status: 'active' },
          { user_id: '9', name: 'Nuwan Silva', role: 'member', status: 'active' },
        ],
      };
    if (path === '/api/expense/advances') return { items: query?.scope === 'organization' ? [ADVANCE, SETTLED] : [ADVANCE, SETTLED], currency: 'LKR', outstanding: { count: '1', total: '25000.00' }, role: 'finance' };
    if (path === '/api/expense/advances/4') return advanceDetail;
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── the pure helpers ─────────────────────────────────────────────────────

describe('approvals helpers', () => {
  it('converts every string column once, and never reads "0" as true', () => {
    const r = A.toQueueItem(CLAIM_ROW);
    expect(r).toMatchObject({ key: 'claim-12', approval_id: 51, org_id: 2, entity_id: 12, step: 1, days_waiting: 9, base_amount: '12500.00' });
    expect(r.policy).toEqual([{ rule: 'receipt', severity: 'warn', message: 'No receipt attached for a claim over LKR 5,000.', policy: 'Receipts' }]);
    expect(A.flag('0')).toBe(false);
    expect(A.flag('1')).toBe(true);
    expect(A.toPosition(position({ settleable: '0' })).settleable).toBe(false);
    expect(A.toPosition(position({ settleable: true })).settleable).toBe(true);
  });

  it('honours the selection and counts what it hides', () => {
    const items = [A.toQueueItem(CLAIM_ROW), A.toQueueItem(ADVANCE_ROW)];
    expect(A.scopeQueue(items, [2])).toMatchObject({ elsewhere: 1 });
    expect(A.scopeQueue(items, [2]).shown.map((i) => i.ref)).toEqual(['EXP-0012']);
    expect(A.scopeQueue(items, []).elsewhere).toBe(0);
  });

  it('filters and sorts: oldest first by default, amounts in cents', () => {
    const items = [A.toQueueItem(ADVANCE_ROW), A.toQueueItem(CLAIM_ROW), A.toQueueItem({ ...CLAIM_ROW, entity_id: '13', ref: 'EXP-0013', base_amount: '999.99', days_waiting: '3', policy: [] })];
    expect(A.sortQueue(items, 'waiting', 'desc').map((i) => i.ref)).toEqual(['EXP-0012', 'EXP-0013', 'ADV-0004']);
    expect(A.sortQueue(items, 'amount', 'asc').map((i) => i.ref)).toEqual(['ADV-0004', 'EXP-0013', 'EXP-0012']);
    expect(A.filterQueue(items, { q: '', kind: '', only: 'flagged' }).map((i) => i.ref)).toEqual(['EXP-0012']);
    expect(A.filterQueue(items, { q: '', kind: '', only: 'week' }).map((i) => i.ref)).toEqual(['EXP-0012']);
    expect(A.filterQueue(items, { q: 'livezen', kind: '', only: '' }).map((i) => i.ref)).toEqual(['ADV-0004']);
    expect(A.filterQueue(items, { q: '', kind: 'advance', only: '' }).map((i) => i.ref)).toEqual(['ADV-0004']);
    expect(A.waited(0)).toBe('today');
    expect(A.waited(1)).toBe('1 day');
    expect(A.centsOf('1,000.50')).toBe(100050);
  });

  it('labels an advance in the company’s currency, which is what its base amount is in', () => {
    expect(A.currencyOf(A.toQueueItem(ADVANCE_ROW), ORGS)).toBe('AED');
    expect(A.currencyOf(A.toQueueItem(CLAIM_ROW), ORGS)).toBe('LKR');
  });

  it('names a settled balance from each side, and a negative zero as even', () => {
    expect(A.settledBalance({ status: 'settled', refund_amount: '2000.00', topup_amount: '0.00' })).toEqual({ side: 'due_back', amount: '2000.00' });
    expect(A.settledBalance({ status: 'settled', refund_amount: '0.00', topup_amount: '150.00' })).toEqual({ side: 'owed', amount: '150.00' });
    expect(A.settledBalance({ status: 'settled', refund_amount: '-0.00', topup_amount: null })).toEqual({ side: 'even', amount: null });
    expect(A.settledBalance({ status: 'disbursed', refund_amount: '2000.00', topup_amount: null }).side).toBe('open');
  });

  it('lets the named approver or an administrator decide an advance still asked for', () => {
    const asked = A.toPosition(position({ approvals: [{ id: 1, step: 1, approver_id: 8, status: 'approved', live: true }, { id: 2, step: 2, approver_id: String(ME), status: 'pending', live: true }] }, { status: 'requested' }));
    expect(A.mayDecideAdvance(asked, ME, ORGS[1])).toBe(true);
    expect(A.mayDecideAdvance(asked, 8, ORGS[1])).toBe(false);
    expect(A.mayDecideAdvance(asked, 8, ORGS[0])).toBe(true);
    // A pending step from a round that ended is not the step waiting.
    const stale = A.toPosition(position({ approvals: [{ id: 1, step: 1, approver_id: String(ME), status: 'pending', live: '0' }] }, { status: 'requested' }));
    expect(A.mayDecideAdvance(stale, ME, ORGS[1])).toBe(false);
    expect(A.mayDecideAdvance(A.toPosition(position()), ME, ORGS[0])).toBe(false);
  });

  it('says what settling will record, and that it freezes', () => {
    const p = A.toPosition(position());
    expect(A.settleSummary(p, 'Nuwan Silva')).toEqual(['LKR 25,000.00 advanced, LKR 20,000.00 accounted for.', 'LKR 5,000.00 is due back from Nuwan Silva.', 'These figures are frozen once settled — a later correction to a claim will not change them.']);
    expect(A.settleSummary({ ...p, refund_due: '0.00', company_due: '800.00' }, null)[1]).toBe('The company owes them a further LKR 800.00.');
    expect(A.settleSummary({ ...p, refund_due: '0.00', company_due: '0.00' }, null)[1]).toBe('It comes out exactly even.');
  });

  it('checks a request as the server will', () => {
    const d = A.blankDraft();
    expect(A.draftProblem(d)).toBe('Enter an amount greater than zero.');
    expect(A.draftProblem({ ...d, amount: '12.345' })).toMatch(/not a number/);
    expect(A.draftProblem({ ...d, amount: '5000', purpose: 'Taxi' })).toMatch(/Say what the advance is for/);
    expect(A.draftProblem({ ...d, amount: '5000', purpose: 'Site visit', kind: 'project' })).toBe('A project advance has to name the project.');
    expect(A.draftProblem({ ...d, amount: '5000', purpose: 'Site visit' })).toBeNull();
    expect(A.isOutstandingGuard('You have 1 advance(s) still to settle, totalling LKR 25,000.00.')).toBe(true);
  });

  it('names refusals by reference, offers only approvers to hand a step to, and narrows "mine"', () => {
    const items = [A.toQueueItem(CLAIM_ROW), A.toQueueItem(ADVANCE_ROW)];
    expect(A.namedRefusals([{ id: 4, type: 'advance', why: 'Refused.' }], items)).toEqual([{ key: 'advance-4-0', ref: 'ADV-0004', why: 'Refused.' }]);
    expect(A.namedRefusals([{ id: 99, type: null, why: 'Not something this queue can decide.' }], items)[0]!.ref).toBe('#99');
    const people = [
      { user_id: ME, name: 'Kasun', email: null, role: 'admin', active: true },
      { user_id: 8, name: 'Priya', email: null, role: 'approver', active: true },
      { user_id: 9, name: 'Nuwan', email: null, role: 'member', active: true },
      { user_id: 10, name: 'Imesha', email: null, role: 'finance', active: false },
    ];
    expect(A.reassignable(people, ME).map((m) => m.user_id)).toEqual([8]);
    expect(A.mineOnly([A.toAdvance(ADVANCE), A.toAdvance(SETTLED)], ME).map((a) => a.advance_no)).toEqual(['ADV-0003']);
    const p = A.toPosition(position());
    expect(A.chargeable([{ id: 40, claim_no: 'EXP-0040', spent_on: null, description: '', base_amount: null, base_currency: null, status: 'approved', user_id: 9 }, { id: 41, claim_no: 'EXP-0041', spent_on: null, description: '', base_amount: null, base_currency: null, status: 'rejected', user_id: 9 }, { id: 42, claim_no: 'EXP-0042', spent_on: null, description: '', base_amount: null, base_currency: null, status: 'submitted', user_id: 9 }], p.lines).map((c) => c.id)).toEqual([42]);
  });

  it('holds: a super-administrator acts everywhere, a reader nowhere', () => {
    expect(A.holds({ ...ORGS[0]!, role: null, member: false, can_act: true }, 'admin')).toBe(true);
    expect(A.holds({ ...ORGS[0]!, role: null, member: false, can_act: false }, 'member')).toBe(false);
    expect(A.holds(ORGS[1], 'finance')).toBe(false);
  });
});

// ── the queue ────────────────────────────────────────────────────────────

describe('the approval queue', () => {
  it('shows the selected company’s items, counts the rest, and shows every company on one click', async () => {
    wrap(<Approvals org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} />);
    await screen.findByText('EXP-0012');
    expect(screen.queryByText('ADV-0004')).toBeNull();
    expect(screen.getByText('1 more approval is waiting on you in your other companies')).toBeTruthy();
    expect(screen.getByText('9 days')).toBeTruthy();
    expect(screen.getByText('No receipt attached for a claim over LKR 5,000.')).toBeTruthy();
    expect(screen.getByText('LKR 12,500.00')).toBeTruthy();
    fireEvent.click(screen.getByText('Show every company'));
    expect(screen.getByText('ADV-0004')).toBeTruthy();
    expect(screen.getByText('AED 300.00')).toBeTruthy();
    expect(screen.getByText('Cash advance')).toBeTruthy();
  });

  it('opens a claim on the team screen', async () => {
    const onGo = vi.fn();
    wrap(<Approvals org="" orgId={null} orgs={ORGS} onGo={onGo} />);
    fireEvent.click(await screen.findByText('Open the full claim'));
    expect(onGo).toHaveBeenCalledWith('team', '&claim=12');
  });

  it('decides a selection in one request and names every refusal', async () => {
    vi.mocked(request).mockResolvedValueOnce(ok({ done: [{ id: 12, type: 'claim' }], failed: [{ id: 4, type: 'advance', why: 'You cannot approve your own claim, even as an administrator.' }] }, '1 approved, 1 could not be.'));
    wrap(<Approvals org="" orgId={null} orgs={ORGS} onGo={vi.fn()} />);
    await screen.findByText('ADV-0004');
    fireEvent.click(screen.getByLabelText('Choose every item shown'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(within(screen.getByText('2 selected').parentElement!).getByText('Approve'));
    await screen.findByText('Approve 2 item(s)?');
    expect(screen.getByText(/Anything you cannot decide — your own, or a step that has moved on — is refused and named/)).toBeTruthy();
    fireEvent.click(screen.getByText('Approve them'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', '/api/expense/approvals/bulk-decide', {
        body: {
          items: [
            { type: 'claim', id: 12 },
            { type: 'advance', id: 4 },
          ],
          decision: 'approved',
          note: '',
        },
      }),
    );
    await screen.findByText(/One item was not decided/);
    expect(screen.getByText(/You cannot approve your own claim, even as an administrator\.$/)).toBeTruthy();
  });

  it('will not decline without a reason, and sends the reason as said', async () => {
    vi.mocked(request).mockResolvedValueOnce(ok({ ok: true, message: 'Rejected.' }, 'Rejected.'));
    wrap(<Approvals org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} />);
    await screen.findByText('EXP-0012');
    fireEvent.click(screen.getByText('Decline'));
    await screen.findByText('Decline EXP-0012');
    expect(screen.getByText('Say why. The person who filed it sees exactly this.')).toBeTruthy();
    const go = screen.getAllByText('Decline').at(-1) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Claimed last week as well' } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/expense/claims2/12/decide', { body: { decision: 'rejected', note: 'Claimed last week as well' } }));
  });

  it('hands a step to somebody who approves there, and only to them', async () => {
    vi.mocked(request).mockResolvedValueOnce(ok(null, 'Now with Priya Perera.'));
    wrap(<Approvals org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} />);
    fireEvent.click(await screen.findByText('Hand to somebody else'));
    await screen.findByRole('combobox', { name: 'Hand it to' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Hand it to' }));
    expect(screen.queryByRole('option', { name: /Nuwan Silva/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Kasun Dias/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Priya Perera/ }));
    fireEvent.click(screen.getByText('Hand it over'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/expense/approvals/51/reassign', { body: { user_id: 8 } }));
  });

  it('shows no decisions or reassigning to somebody without the permissions', async () => {
    app.set({ bootstrap: { permissions: ['expense.view'] } as never });
    wrap(<Approvals org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} />);
    await screen.findByText('EXP-0012');
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Hand to somebody else')).toBeNull();
    expect(screen.queryByLabelText('Choose EXP-0012')).toBeNull();
    expect(screen.queryByText('Claims that look like the same expense twice')).toBeNull();
  });

  it('records a judgement on look-alike claims, with the server’s caution above them', async () => {
    vi.mocked(request).mockResolvedValueOnce(ok(null, 'Recorded as the same expense twice. Reject whichever claim should not stand — this flag does not reject anything by itself.'));
    wrap(<Approvals org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} />);
    await screen.findByText('Claims that look like the same expense twice');
    expect(screen.getByText(/It is not an accusation and nothing has been rejected/)).toBeTruthy();
    expect(screen.getByText('Same amount (LKR 12,500.00) on the same day as EXP-0011.')).toBeTruthy();
    fireEvent.click(screen.getByText('Same expense twice'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/expense/duplicates/31/decide', { body: { duplicate: true } }));
  });
});

// ── advances ─────────────────────────────────────────────────────────────

describe('cash advances', () => {
  it('lists what this person holds, narrows "Mine" for finance, and names a settled balance', async () => {
    wrap(<Advances org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} openAdvance={null} />);
    await screen.findByText('ADV-0003');
    expect(screen.queryByText('ADV-0004')).toBeNull();
    expect(screen.getByText('LKR 2,000.00 due back')).toBeTruthy();
    expect(screen.getByText('1 advance(s) not yet settled')).toBeTruthy();
    expect(screen.getByText(/No money moves through this software/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Everyone' }));
    await screen.findByText('ADV-0004');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/expense/advances', { org: 2, scope: 'organization' }, expect.anything()));
  });

  it('opens the advance a link names, and closing it goes back to the plain list', async () => {
    const onGo = vi.fn();
    wrap(<Advances org="2" orgId={2} orgs={ORGS} onGo={onGo} openAdvance={4} />);
    const panel = await screen.findByRole('complementary', { name: 'Advance ADV-0004' });
    await within(panel).findByText('Spending charged to it');
    expect(within(panel).getByText('EXP-0040')).toBeTruthy();
    expect(within(panel).getByText('LKR 5,000.00')).toBeTruthy();
    fireEvent.click(within(panel).getByLabelText('Close'));
    expect(onGo).toHaveBeenCalledWith('advances');
  });

  it('opens a row without touching the address, and a claim on it by whose it is', async () => {
    const onGo = vi.fn();
    wrap(<Advances org="2" orgId={2} orgs={ORGS} onGo={onGo} openAdvance={null} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Everyone' }));
    fireEvent.click(await screen.findByText('Kandy client visit'));
    const panel = await screen.findByRole('complementary', { name: 'Advance ADV-0004' });
    fireEvent.click(await within(panel).findByText('EXP-0040'));
    expect(onGo).toHaveBeenCalledWith('team', '&claim=40');
    fireEvent.click(within(panel).getByLabelText('Close'));
    expect(onGo).not.toHaveBeenCalledWith('advances');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('records a payout only for somebody who pays, and says no money moved', async () => {
    vi.mocked(request).mockResolvedValueOnce(ok(null, 'Recorded as paid out. This is a bookkeeping record — no money moved through this software.'));
    wrap(<Advances org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} openAdvance={4} />);
    fireEvent.click(await screen.findByText('Record it as paid out'));
    await screen.findByText('Record the payout');
    pick('How was it handed over?', 'Cash');
    fireEvent.click(screen.getAllByText('Record it as paid out').at(-1)!);
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/expense/advances/4/disburse', { body: { method: 'cash' } }));
  });

  it('hides the payout and settlement from somebody without expense.pay', async () => {
    app.set({ bootstrap: { permissions: ['expense.view', 'expense.approve'] } as never });
    wrap(<Advances org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} openAdvance={4} />);
    await screen.findByText('Kandy client visit', { selector: 'span.truncate' });
    await screen.findByText('Spending charged to it');
    expect(screen.queryByText('Record it as paid out')).toBeNull();
    expect(screen.queryByText('Settle it')).toBeNull();
  });

  it('hides them too where the person is not finance in that company', async () => {
    wrap(<Advances org="2" orgId={2} orgs={[{ ...ORGS[0]!, role: 'approver' }]} onGo={vi.fn()} openAdvance={4} />);
    await screen.findByText('Spending charged to it');
    expect(screen.queryByText('Record it as paid out')).toBeNull();
  });

  it('settles with the figures and who owes whom said first', async () => {
    advanceDetail = position({}, { status: 'disbursed' });
    vi.mocked(request).mockResolvedValueOnce(ok(null, 'ADV-0004 settled: LKR 25,000.00 advanced, LKR 20,000.00 accounted for.'));
    wrap(<Advances org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} openAdvance={4} />);
    fireEvent.click(await screen.findByText('Settle it'));
    await screen.findByText('Settle this advance');
    expect(screen.getByText('LKR 25,000.00 advanced, LKR 20,000.00 accounted for.')).toBeTruthy();
    expect(screen.getByText('LKR 5,000.00 is due back from Nuwan Silva.')).toBeTruthy();
    expect(screen.getByText(/These figures are frozen once settled/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('Settle it').at(-1)!);
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/expense/advances/4/settle', { body: {} }));
  });

  it('will not settle while charged claims are still waiting, and says why', async () => {
    advanceDetail = position({ pending: '3000.00', settleable: false, blocked_by: '1 claim(s) charged to this advance are still awaiting approval. Settling now would close it against figures that may change.' }, { status: 'disbursed' });
    wrap(<Advances org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} openAdvance={4} />);
    const settle = (await screen.findByText('Settle it')) as HTMLButtonElement;
    expect(settle.disabled).toBe(true);
    expect(screen.getByText(/are still awaiting approval/)).toBeTruthy();
  });

  it('asks before a second advance when one is still to settle, and sends it on a yes', async () => {
    const guard = 'You have 1 advance(s) still to settle, totalling LKR 25,000.00. Settle those before asking for another.';
    vi.mocked(request)
      .mockRejectedValueOnce(new ApiError(422, guard, null))
      .mockResolvedValueOnce(ok({ id: 5, advance_no: 'ADV-0005' }, 'Advance ADV-0005 requested.'));
    wrap(<Advances org="2" orgId={2} orgs={ORGS} onGo={vi.fn()} openAdvance={null} />);
    fireEvent.click(await screen.findByText('Request an advance'));
    await screen.findByText('Request a cash advance');
    const send = screen.getByText('Request it') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '15000' } });
    fireEvent.change(screen.getByLabelText('What it is for'), { target: { value: 'Colombo port inspection' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await screen.findByText('You already hold an advance');
    expect(screen.getByText(guard)).toBeTruthy();
    fireEvent.click(screen.getByText('Ask anyway'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(vi.mocked(request).mock.calls[1]).toEqual(['POST', '/api/expense/advances', { body: { org_id: 2, kind: 'travel', amount: '15000', purpose: 'Colombo port inspection', needed_by: null, project_id: null, vendor_id: null, allow_multiple: true } }]);
  });
});
