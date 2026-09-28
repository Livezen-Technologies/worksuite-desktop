// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiPost, request, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const c = await import('../../../src/modules/expenses/claim-data');
const { default: Claims } = await import('../../../src/modules/expenses/Claims');
const { default: NewClaim } = await import('../../../src/modules/expenses/NewClaim');

/*
 * The claim lists, one claim, and filing one — drawn from payloads shaped as
 * the server sends them (ClaimController, Claims::listing/detail), with every
 * id, flag and count as the string MySQL returns.
 */

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const orgs = [
  { id: 2, name: 'CreativeFX', slug: 'creativefx', role: 'approver' as const, member: true, can_act: true, currency: 'LKR', favourite: false },
  { id: 4, name: 'TechHubiz', slug: 'techhubiz', role: 'member' as const, member: true, can_act: true, currency: 'LKR', favourite: false },
];

const ROWS = [
  { id: '12', claim_no: 'EXP-0012', kind: 'expense', spent_on: '2026-09-20', amount: '85.00', currency: 'USD', base_amount: '25500.00', base_currency: 'LKR', description: 'Airport taxi · voucher E-221 [cb:ONLINE_PAYMENTS:221]', status: 'submitted', policy_state: 'flagged', receipt_file_id: '7', user_id: '31', category: 'Travel', claimant: 'Priya Fernando', cost_centre: 'Sales', project: null, department: 'Sales' },
  { id: '11', claim_no: 'EXP-0011', kind: 'mileage', spent_on: '2026-09-18', amount: '4200.00', currency: 'LKR', base_amount: '4200.00', base_currency: 'LKR', description: 'Client visit, Kandy', status: 'submitted', policy_state: 'clear', receipt_file_id: '0', user_id: '31', category: 'Mileage', claimant: 'Priya Fernando', cost_centre: null, project: 'Kandy rollout', department: null },
];

const DETAIL = {
  ...ROWS[0],
  org_id: '2',
  organization: 'CreativeFX',
  exchange_rate: '300.000000',
  quantity: null,
  tax_amount: null,
  vendor: null,
  branch: null,
  cost_centre_code: 'CC-01',
  subscription_id: null,
  revision: '2',
  receipt: { name: 'taxi.jpg', mime: 'image/jpeg', size: '240311', previewable: true, is_image: true },
  approvals: [
    { id: 1, step: 1, label: 'Line manager', approver: 'Nuwan Perera', approver_id: 5, status: 'approved', decided_by: 'Nuwan Perera', decided_at: '2026-09-21 10:02:00', note: null, revision: 1, live: false },
    { id: 2, step: 2, label: 'Finance', approver: 'Gayani Silva', approver_id: 6, status: 'skipped', decided_by: null, decided_at: null, note: 'The claim was edited before this step was decided.', revision: 1, live: false },
    { id: 3, step: 1, label: 'Line manager', approver: 'Nuwan Perera', approver_id: 5, status: 'pending', decided_by: null, decided_at: null, note: null, revision: 2, live: true },
  ],
  versions: [{ id: 1, version: 1, event: 'edit', reason: 'The fare was in dollars, not rupees.', author: 'Priya Fernando', created_at: '2026-09-22 09:00:00' }],
  edit_block: 'Only the person who filed a claim can change what it says. If it is wrong, ask them to correct it — or decline it with a reason.',
  policy: [{ rule: 'daily_cap', severity: 'warn', message: 'The daily cap for Travel is LKR 20,000.00 and this claim is LKR 25,500.00.', policy: 'Travel policy' }],
  duplicates: [],
  activity: [{ action: 'edited', summary: 'Priya Fernando edited and resubmitted this claim (v2): The fare was in dollars, not rupees.', created_at: '2026-09-22 09:00:00', actor: 'Priya Fernando' }],
  card_txn: null,
  receipt_read: null,
};

const PREVIEW_BLOCKED = {
  ready: false,
  base_amount: '61200.00',
  base_currency: 'LKR',
  exchange_rate: { rate: '1.000000', source: 'same currency', on: '2026-09-28' },
  blocks: [{ rule: 'monthly_cap', policy: 'Travel policy', message: 'The monthly cap for Travel is LKR 50,000 and this takes you to LKR 61,200.' }],
  warnings: [],
  policies: [],
  budgets: [{ id: 3, name: 'Sales travel FY26', used: '41000.00', amount: '60000.00', currency: 'LKR', pct: 68.3 }],
  routing: 'It would be routed under "Sales claims".',
};

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['expense.view', 'expense.approve'] } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/expense/claims2') return { items: ROWS, total: '2', sum: '29700.00', page: 1, currency: 'LKR', mixed_currency: false };
    if (path === '/api/expense/claims2/12') return DETAIL;
    if (path === '/api/expense/categories2') return { items: [{ id: '3', org_id: '0', name: 'Travel', status: 'active', shared: true }] };
    if (path === '/api/expense/settings2') return { settings: { currency: 'LKR', require_project: '0' }, receipt_reading: { ok: false, message: 'Receipt reading is not available on this server — tesseract is not installed. Amounts and dates have to be typed in.' } };
    if (path === '/api/expense/cost-centres') return { items: [{ id: '1', code: 'CC-01', name: 'Sales', status: 'active' }] };
    if (path === '/api/expense/related') return { types: [{ key: 'project', label: 'Project', field: 'project_id', scoped: true, empty: false, items: [{ id: 9, label: 'Kandy rollout' }] }] };
    if (path === '/api/expense/advances') return { items: [] };
    if (path === '/api/expense/rates') return { mileage: [], per_diem: [] };
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('claims: reading what the server sends', () => {
  it('never takes "0" as yes, and converts every string column once', () => {
    expect(c.flag('0')).toBe(false);
    expect(c.flag('1')).toBe(true);
    expect(c.flag(true)).toBe(true);
    expect(c.idOf('0')).toBeNull();
    expect(c.idOf('12')).toBe(12);
    const [a, b] = ROWS.map(c.toRow);
    expect(a).toMatchObject({ id: 12, has_receipt: true, flagged: true, user_id: 31, kind: 'expense' });
    expect(b).toMatchObject({ id: 11, has_receipt: false, flagged: false, kind: 'mileage', project: 'Kandy rollout' });
  });

  it('strips the importer’s key from a description, for display only', () => {
    expect(c.clean(ROWS[0]!.description)).toBe('Airport taxi · voucher E-221');
    expect(c.clean('Plain')).toBe('Plain');
  });

  it('reads a refusal list the server sent as an object', () => {
    expect(c.asList({ 0: 'a', 1: 'b' })).toEqual(['a', 'b']);
    expect(c.asList(null)).toEqual([]);
    const p = c.toPreview({ ready: false, blocks: { x: { rule: 'r', message: 'No.' } } });
    expect(p.blocks).toEqual([{ rule: 'r', policy: null, message: 'No.' }]);
    expect(p.ready).toBe(false);
  });

  it('names what is still missing, per kind of claim', () => {
    expect(c.missingFor({ kind: 'expense', amount: '', category_id: '3', description: 'x', spent_on: '2026-09-01' })).toEqual(['an amount']);
    expect(c.missingFor({ kind: 'mileage', quantity: '', category_id: '', description: ' ' })).toEqual(['a distance', 'a category', 'what it was for']);
    expect(c.missingFor({ kind: 'per_diem', from_date: '2026-09-01', to_date: '', category_id: '3', description: 'Trip' })).toEqual(['an end date']);
  });

  it('adds a selection up in cents, and refuses to add different currencies', () => {
    const rows = ROWS.map(c.toRow);
    expect(c.selectionTotal(rows)).toBe('LKR 29,700.00');
    expect(c.selectionTotal([{ ...rows[0]!, base_amount: '0.10' }, { ...rows[1]!, base_amount: '0.20' }])).toBe('LKR 0.30');
    expect(c.selectionTotal([rows[0]!, { ...rows[1]!, base_currency: 'AED' }])).toBeNull();
    expect(c.selectionTotal([])).toBeNull();
  });

  it('pages until every matching claim is loaded', () => {
    const page = (n: number, items: number, total: number) => ({ items: Array.from({ length: items }, () => c.toRow(ROWS[0]!)), page: n, total, sum: null, currency: null, mixed: false });
    expect(c.nextPage([page(1, 50, 120)])).toBe(2);
    expect(c.nextPage([page(1, 50, 120), page(2, 50, 120), page(3, 20, 120)])).toBeUndefined();
    expect(c.nextPage([])).toBeUndefined();
  });

  it('says each approval step in words, and groups the trail by the version decided', () => {
    expect(c.approvalLine({ status: 'pending', approver: 'Nuwan', decided_by: null })).toBe('waiting with Nuwan');
    expect(c.approvalLine({ status: 'pending', approver: null, decided_by: null })).toBe('waiting, with nobody assigned');
    expect(c.approvalLine({ status: 'rejected', approver: 'Nuwan', decided_by: null })).toBe('rejected by somebody');
    const d = c.toDetail(DETAIL);
    expect(c.rounds(d.approvals).map((r) => [r.revision, r.live, r.steps.length])).toEqual([
      [1, false, 2],
      [2, true, 1],
    ]);
    expect(d.revision).toBe(2);
    expect(d.receipt).toMatchObject({ is_image: true, size: 240311 });
    expect(d.receipt_id).toBe(7);
  });

  it('offers the rate schedule’s own vehicles and destinations, and the company’s currency first', () => {
    const s = c.toSchedule({ mileage: [{ vehicle: 'car' }, { vehicle: 'motorbike' }, { vehicle: 'car' }], per_diem: [{ country: 'India', city: null }, { country: 'India', city: 'Chennai' }, { country: null, city: null }] });
    expect(s).toEqual({ vehicles: ['car', 'motorbike'], countries: ['India'], cities: [{ city: 'Chennai', country: 'India' }] });
    expect(c.currencyOptions('usd').map((o) => o.value).slice(0, 3)).toEqual(['USD', 'LKR', 'EUR']);
    expect(c.currencyOptions('XOF')[0]!.value).toBe('XOF');
  });

  it('sends only what was given, and reads a refused save’s rules', () => {
    expect(c.payloadOf({ kind: 'expense', amount: '10', project_id: '', cost_centre_id: '1' }, 'tok123')).toEqual({ kind: 'expense', amount: '10', cost_centre_id: '1', receipt_token: 'tok123' });
    const e = new ApiError(422, 'The monthly cap…', null, { blocks: PREVIEW_BLOCKED.blocks });
    expect(c.blocksOf(e).map((b) => b.message)).toEqual([PREVIEW_BLOCKED.blocks[0]!.message]);
    expect(c.blocksOf(new Error('x'))).toEqual([]);
    expect(c.toFields('{"total":{"value":"1,250.00","confidence":"high","why":"found on a line reading \\"TOTAL\\""}}')).toEqual({ total: { value: '1,250.00', confidence: 'high', why: 'found on a line reading "TOTAL"' } });
  });
});

describe('claims: the screens', () => {
  it('lists team claims with the flag, the person, the receipt state and the whole set’s total', async () => {
    wrap(<Claims org="2" orgId={2} orgs={orgs} onGo={vi.fn()} scope="team" openClaim={null} />);
    await screen.findByText('EXP-0012');
    expect(screen.getByText('Team expenses')).toBeTruthy();
    expect(screen.getByText('Airport taxi · voucher E-221')).toBeTruthy();
    expect(screen.getByLabelText('Flagged by a policy rule')).toBeTruthy();
    expect(screen.getAllByText('Priya Fernando').length).toBe(2);
    expect(screen.getByText('attached')).toBeTruthy();
    expect(screen.getByText('no receipt')).toBeTruthy();
    expect(screen.getByText('paid USD 85.00')).toBeTruthy();
    expect(screen.getByText('mileage')).toBeTruthy();
    expect(screen.getByText('LKR 29,700.00')).toBeTruthy();
    expect(screen.getByText('2 of 2 claims')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/expense/claims2', expect.objectContaining({ scope: 'team', org: '2', page: 1, per_page: 50 }), expect.anything());
  });

  it('offers no bulk decision on My expenses, nor to somebody without expense.approve', async () => {
    const { unmount } = wrap(<Claims org="2" orgId={2} orgs={orgs} onGo={vi.fn()} scope="mine" openClaim={null} />);
    await screen.findByText('EXP-0012');
    expect(screen.queryByLabelText('Select every claim shown')).toBeNull();
    expect(screen.queryByText('Person')).toBeNull();
    unmount();
    app.set({ bootstrap: { permissions: ['expense.view'] } as never });
    wrap(<Claims org="2" orgId={2} orgs={orgs} onGo={vi.fn()} scope="organization" openClaim={null} />);
    await screen.findByText('EXP-0012');
    expect(screen.queryByLabelText('Select every claim shown')).toBeNull();
  });

  it('rejects a selection with one reason, and lists every claim the server refused with its sentence', async () => {
    vi.mocked(request).mockResolvedValueOnce({ data: { done: [{ id: 11 }], failed: [{ id: 12, why: 'You are not the approver on the current step of this claim.' }] }, message: '1 rejected, 1 could not be.', offline: false, cachedAt: null });
    const onGo = vi.fn();
    wrap(<Claims org="2" orgId={2} orgs={orgs} onGo={onGo} scope="team" openClaim={null} />);
    await screen.findByText('EXP-0012');
    fireEvent.click(screen.getByLabelText('Select every claim shown'));
    const bar = screen.getByLabelText('Selected claims');
    expect(within(bar).getByText('2 selected · LKR 29,700.00')).toBeTruthy();
    fireEvent.click(within(bar).getByText('Reject'));
    await screen.findByText('Reject 2 claims?');
    const go = screen.getByText('Reject them') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why are these being rejected?'), { target: { value: 'Duplicates of the September run.' } });
    fireEvent.click(go);
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/expense/claims2/bulk-decide', { body: { ids: [12, 11], decision: 'rejected', note: 'Duplicates of the September run.' } }));
    await screen.findByText('1 rejected, 1 could not be.');
    expect(screen.getByText('EXP-0012 — You are not the approver on the current step of this claim.')).toBeTruthy();
    fireEvent.click(screen.getByText('Client visit, Kandy'));
    expect(onGo).toHaveBeenCalledWith('team', '&claim=11');
  });

  it('opens a claim to its receipt, the rules’ sentence and the approval trail, and decides it against the version shown', async () => {
    vi.mocked(call).mockResolvedValue({} as never);
    vi.mocked(apiPost).mockResolvedValueOnce({ ok: true, status: 'submitted', message: 'Step approved. It now waits with Finance.' });
    const onGo = vi.fn();
    wrap(<Claims org="2" orgId={2} orgs={orgs} onGo={onGo} scope="team" openClaim={12} />);
    await screen.findByText('What the rules said');
    expect(screen.getByText('The daily cap for Travel is LKR 20,000.00 and this claim is LKR 25,500.00.')).toBeTruthy();
    expect(screen.getByText('USD 85.00 at 300.000000')).toBeTruthy();
    // The trail, both rounds, the earlier one said to be before the change.
    expect(screen.getByText('Version 1 — before it was changed')).toBeTruthy();
    expect(screen.getByText('Version 2 — the one being decided')).toBeTruthy();
    expect(screen.getByText(/waiting with Nuwan Perera/)).toBeTruthy();
    expect(screen.getByText(/approved by Nuwan Perera/)).toBeTruthy();
    expect(screen.getByText('The claim was edited before this step was decided.')).toBeTruthy();
    expect(screen.getByText(/Only the person who filed a claim can change what it says/)).toBeTruthy();
    expect(screen.getByText('The fare was in dollars, not rupees.')).toBeTruthy();
    // The receipt, drawn in place through the proxy, and saved through Transfers.
    const img = screen.getByAltText('taxi.jpg') as HTMLImageElement;
    expect(img.src).toContain('/__api/api/expense/claims2/12/receipt');
    fireEvent.click(screen.getByText('Save a copy'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { expenseFile: { kind: 'claim-receipt', claim: 12 }, name: 'taxi.jpg' }));
    // Approve, with the revision the drawer rendered.
    fireEvent.click(screen.getByText('Approve'));
    await screen.findByText('Add a note, if you want one on the record.');
    fireEvent.click(screen.getAllByText('Approve').at(-1)!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/expense/claims2/12/decide', { decision: 'approved', note: '', revision: 2 }));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onGo).toHaveBeenCalledWith('team');
  });

  it('shows what the rules say before filing, and will not file what a rule refuses', async () => {
    vi.mocked(request).mockResolvedValue({ data: PREVIEW_BLOCKED, message: 'OK', offline: false, cachedAt: null });
    const onDone = vi.fn();
    wrap(<NewClaim orgId={2} orgs={orgs} onClose={vi.fn()} onDone={onDone} preset={{ category_id: 3 }} />);
    await screen.findByText('Before you file');
    expect(screen.getByText('Still needs an amount, what it was for.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '61200' } });
    fireEvent.change(screen.getByPlaceholderText("Taxi from the airport to the client's office"), { target: { value: 'Colombo–Kandy return, client workshop' } });
    await screen.findByText('The monthly cap for Travel is LKR 50,000 and this takes you to LKR 61,200.', undefined, { timeout: 3000 });
    expect(request).toHaveBeenCalledWith('POST', '/api/expense/claims2/preview', expect.objectContaining({ query: { org: 2 }, body: expect.objectContaining({ amount: '61200', category_id: '3', currency: 'LKR' }) }));
    expect(screen.getByText('It would be routed under "Sales claims".')).toBeTruthy();
    expect(screen.getByText('LKR 41,000.00 of LKR 60,000.00 used (68.3%)')).toBeTruthy();
    expect(screen.getByText('Something in the panel refuses this claim.')).toBeTruthy();
    expect((screen.getByText('File it') as HTMLButtonElement).disabled).toBe(true);
    expect(apiPost).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows a refused save’s rules, and files in the one company it was opened for', async () => {
    vi.mocked(request).mockResolvedValue({ data: { ...PREVIEW_BLOCKED, ready: true, blocks: [], budgets: [] }, message: 'OK', offline: false, cachedAt: null });
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(422, 'The monthly cap for Travel is LKR 50,000 and this takes you to LKR 61,200.', null, { blocks: PREVIEW_BLOCKED.blocks }));
    wrap(<NewClaim orgId={2} orgs={orgs} onClose={vi.fn()} onDone={vi.fn()} preset={{ category_id: 3 }} />);
    await screen.findByText('Before you file');
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '61200' } });
    fireEvent.change(screen.getByPlaceholderText("Taxi from the airport to the client's office"), { target: { value: 'Workshop' } });
    await screen.findByText('Nothing objects to this claim.', undefined, { timeout: 3000 });
    fireEvent.click(screen.getByText('File it'));
    await screen.findByText('The monthly cap for Travel is LKR 50,000 and this takes you to LKR 61,200.');
    expect(apiPost).toHaveBeenCalledWith('/api/expense/claims2', expect.objectContaining({ kind: 'expense', amount: '61200', category_id: '3', description: 'Workshop' }), { org: 2 });
    expect((screen.getByText('File it') as HTMLButtonElement).disabled).toBe(true);
  });
});
